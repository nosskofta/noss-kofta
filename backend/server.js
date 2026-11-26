import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';
import './reset-once.js';

dotenv.config();

const scrypt = promisify(crypto.scrypt);
const app = express();

// Railway شغال ورا proxy، ده عشان نعرف IP الزبون الحقيقي (بنستخدمه في الحماية من التكرار)
app.set('trust proxy', 1);

// =========================
// CORS
// =========================
app.disable("x-powered-by");
// دومينين المطعمين بس — لو ضفت ALLOWED_ORIGINS في Railway (روابط مفصولة بفاصلة) هي اللي بتتطبق بدل القايمة دي. من غيرها السيرفر بيقبل دومينين المطعمين بس، وعمره ما بيقبل أي موقع (*).
const DEFAULT_ALLOWED_ORIGINS = ["https://noss-kofta.vercel.app", "https://bahbah-burger.vercel.app"];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((v) => v.trim().replace(/\/$/, "")).filter(Boolean);
const EFFECTIVE_ALLOWED_ORIGINS = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && EFFECTIVE_ALLOWED_ORIGINS.includes(origin)) { res.header("Access-Control-Allow-Origin", origin); res.header("Vary", "Origin"); }
  res.header("X-Content-Type-Options", "nosniff");
  res.header("X-Frame-Options", "DENY");
  res.header("Referrer-Policy", "no-referrer");
  res.header("Strict-Transport-Security", "max-age=15552000");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  if (req.method === "OPTIONS") return res.status(200).end();
  next();
});

// حجم الطلب: الصور بس (أصناف/إعدادات/أقسام) بتاخد حد كبير، وباقي السيرفر 1 ميجا (كان 50 ميجا = أي حد يقدر يوقع السيرفر بطلبات تقيلة)
app.use(["/api/items", "/api/settings", "/api/categories"], express.json({ limit: "15mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));

// ضغط ردود JSON (gzip): الصفحات والأوردرات بتوصل أسرع وبنت أقل
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers["accept-encoding"] || "")) return next();
  const origJson = res.json.bind(res);
  res.json = (obj) => {
    let body;
    try { body = JSON.stringify(obj); } catch (e) { return origJson(obj); }
    res.type("json");
    if (body === undefined || body.length < 1024) return res.send(body);
    zlib.gzip(Buffer.from(body), { level: 4 }, (err, buf) => {
      if (err) return res.send(body);
      res.set({ "Content-Encoding": "gzip", Vary: "Accept-Encoding" });
      res.send(buf);
    });
    return res;
  };
  next();
});

// =========================
// كاش في الذاكرة لقائمة الأصناف والإعدادات (بيتمسح لوحده أول ما الأدمن يعدّل أي حاجة)
// =========================
const LIST_CACHE_TTL = 30 * 1000;
const listCache = { items: null, settings: null };
const readListCache = (key) => (listCache[key] && Date.now() - listCache[key].at < LIST_CACHE_TTL ? listCache[key].body : null);
const writeListCache = (key, body) => { listCache[key] = { at: Date.now(), body }; };
app.use(["/api/items", "/api/settings"], (req, res, next) => {
  if (req.method !== "GET") res.on("finish", () => { listCache.items = null; listCache.settings = null; });
  next();
});

// =========================
// Category Schema
// =========================
const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  order: { type: Number, default: 0 }
});
const Category = mongoose.model("Category", categorySchema);

// =========================
// Item Schema
// =========================
const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  discount: { type: Number, default: 0, min: 0, max: 100 },
  image: { type: String },
  description: { type: String },
  extras: { type: String },
  category: { type: String, required: true },
  type: { type: String, default: "normal" },
  maxItems: { type: Number },
  isOffer: { type: Boolean, default: false },
  available: { type: Boolean, default: true },
  order: { type: Number, default: 0 },
  code: { type: Number }, // رمز الصنف للمحاسب (نص كفتة 1..300، ثابت ومش بيتغير)

  // النظام القديم (متروك عشان الأصناف القديمة تفضل شغالة)
  addons: [{ name: String, price: Number }],
  boxItems: [{ name: String }],
  sizes: [{ name: String, price: Number }],

  // النظام الجديد: مجموعات التعديلات
  modifierGroups: [
    {
      name: String,
      min: Number,
      max: Number,
      options: [{ name: String, price: Number }]
    }
  ]
});
const Item = mongoose.model("Item", itemSchema);

// رموز الأصناف للمحاسب: نص كفتة 1..300 وبحبح 301..600 — عشان الرمز يبقى واحد
// في الداش بورد المجمعة من غير تضارب. كل صنف ليه رمز ثابت حسب ترتيب إضافته،
// والمسح مش بيعيد الترقيم عشان الرمز يفضل ثابت في التقارير القديمة.
const ITEM_CODE_START = 1;
const ITEM_CODE_END = 1000;
const ensureItemCodes = async () => {
  const valid = (n) => Number.isInteger(n) && n >= ITEM_CODE_START && n <= ITEM_CODE_END;
  const all = await Item.find().sort({ createdAt: 1, _id: 1 }).select("_id code").lean();
  // أعلى رمز صحيح موجود — الجديد بياخد اللي بعده
  let next = ITEM_CODE_START - 1;
  for (const doc of all) {
    const c = Number(doc.code);
    if (valid(c)) next = Math.max(next, c);
  }
  // أول ظهور للرمز الصحيح بيفضل زي ما هو؛ الناقص والمكرر واللي برّه النطاق بياخد رمز جديد
  const seen = new Set();
  let assigned = 0;
  for (const doc of all) {
    const c = Number(doc.code);
    if (valid(c) && !seen.has(c)) { seen.add(c); continue; }
    next += 1;
    if (next > ITEM_CODE_END) console.warn(`\u26A0\uFE0F رموز الأصناف: عدد الأصناف عدّى ${ITEM_CODE_END}، والرمز ${next} برّه النطاق`);
    await Item.updateOne({ _id: doc._id }, { $set: { code: next } });
    seen.add(next);
    assigned += 1;
  }
  if (assigned > 0) console.log(`\u{1F522} رموز أصناف المحاسب: اتعيّن ${assigned} رمز جديد`);
  return assigned;
};

// رموز محتويات البوكسات للمحاسب: نطاق منفصل 2001..3000 — كل محتوى (زي "كفتة" جوه بوكس)
// ليه رمز ثابت خاص بيه، مختلف عن أي رمز صنف في المنيو، عشان الجرد يفرّق بين الكفتة
// اللي طلعت جوه بوكس والكفتة اللي اتباعت ساندوتش عادي. المحتوى ملوش سعر لوحده.
const BOX_CONTENT_CODE_START = 2001;
const BOX_CONTENT_CODE_END = 3000;
const boxContentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  code: { type: Number }
});
const BoxContent = mongoose.model("BoxContent", boxContentSchema);

// أسماء محتويات البوكسات بترتيب أول ظهور: الموجود بيفضل برمزه، والجديد بياخد اللي بعده.
// الكود بيتاخد من أعلى رمز صحيح موجود — عشان ميتكررش رمز مع محتوى تاني.
const ensureBoxContentCodes = async (namesInOrder) => {
  const out = new Map();
  const names = [];
  const seenNames = new Set();
  for (const raw of namesInOrder || []) {
    const n = String(raw || "").trim();
    if (!n || seenNames.has(n)) continue;
    seenNames.add(n);
    names.push(n);
  }
  if (names.length === 0) return out;
  const all = await BoxContent.find().select("name code").lean();
  const byName = new Map(all.map((d) => [d.name, d]));
  const valid = (n) => Number.isInteger(n) && n >= BOX_CONTENT_CODE_START && n <= BOX_CONTENT_CODE_END;
  let next = BOX_CONTENT_CODE_START - 1;
  for (const d of all) {
    const c = Number(d.code);
    if (valid(c)) next = Math.max(next, c);
  }
  const inBatch = new Set(names);
  const seen = new Set();
  for (const d of all) {
    const c = Number(d.code);
    if (valid(c) && !inBatch.has(d.name)) seen.add(c);
  }
  let assigned = 0;
  for (const name of names) {
    const doc = byName.get(name);
    const c = doc ? Number(doc.code) : NaN;
    if (doc && valid(c) && !seen.has(c)) {
      seen.add(c);
      out.set(name, c);
      continue;
    }
    next += 1;
    if (next > BOX_CONTENT_CODE_END) console.warn(`\u26A0\uFE0F رموز محتويات البوكسات: عدد المحتويات عدّى ${BOX_CONTENT_CODE_END}، والرمز ${next} برّه النطاق`);
    if (doc) await BoxContent.updateOne({ _id: doc._id }, { $set: { code: next } });
    else await new BoxContent({ name, code: next }).save();
    seen.add(next);
    out.set(name, next);
    assigned += 1;
  }
  if (assigned > 0) console.log(`\u{1F522} رموز محتويات البوكسات: اتعيّن ${assigned} رمز جديد`);
  return out;
};
// =========================
// Delivery Zones
// =========================
const zoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fee: { type: Number, required: true }
});
const DeliveryZone = mongoose.model("DeliveryZone", zoneSchema);

// =========================
// Settings
// =========================
const settingsSchema = new mongoose.Schema({
  heroImage: {
    type: String,
    default: "https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=1920&auto=format&fit=crop"
  },
  heroTitleAr: { type: String, default: "أقوى العروض 🔥" },
  heroTitleEn: { type: String, default: "Strongest Offers 🔥" },
  logoImage: { type: String, default: "" },
  promoBannerImage: { type: String, default: "" },

  // مواعيد استقبال الأوردرات (فتح / قفل)
  orderingMode: { type: String, enum: ["auto", "open", "closed"], default: "auto" },
  openTime: { type: String, default: "12:00" },
  closeTime: { type: String, default: "03:00" },
  closedMessage: { type: String, default: "" },

  // العهد القديمة للسواقين قبل التاريخ ده مش بتتحسب
  driverBalancesFrom: { type: Date }
});
const Settings = mongoose.model("Settings", settingsSchema);

// =========================
// Orders (شاشة الكاشير)
// =========================
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
  // رقم إيصال داخل الوردية فقط؛ لا يغيّر رقم أوردر الموقع أو رقم طلبات اليدوي
  shiftReceiptNo: { type: Number },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" },
  customerName: { type: String, required: true },
  customerPhone: { type: String, required: true },
  orderType: { type: String, required: true },
  customerAddress: { type: String },
  zoneName: { type: String },
  deliveryFee: { type: Number, default: 0 },
  items: { type: Array, required: true },
  itemsTotal: { type: Number, required: true },
  grandTotal: { type: Number, required: true },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  acceptedBy: { type: String },
  acceptedAt: { type: Date },
  completedBy: { type: String },
  completedAt: { type: Date },

  // أوردرات الكاشير (POS) + الإلغاء + السواق
  source: { type: String, default: "web" },
  paymentMethod: { type: String },
  talabatNo: { type: String },
  discountPercent: { type: Number, default: 0 },
  discountAmount: { type: Number, default: 0 },
  discountReason: { type: String, default: "" },
  orderNote: { type: String, default: "" },
  printedAt: { type: Date },
  printedBy: { type: String },
  cancelledAfterPrint: { type: Boolean, default: false },
  editedAt: { type: Date },
  editedBy: { type: String },
  editLog: { type: Array, default: [] },
  createdBy: { type: String },
  driverName: { type: String },
  driverFeePaid: { type: Boolean, default: false },
  clientRef: { type: String },
  // دفع مقسّم (كاش + انستا مثلًا): paymentMethod بيبقى "split" والتفاصيل هنا، ومجموعها لازم = إجمالي الأوردر
  paymentSplit: { type: [new mongoose.Schema({ method: String, amount: Number }, { _id: false })], default: undefined },
  // أوردر دليفري كاش خرج مع السواق ومستني النقدية: بيفضل في النشطة ومش بيتحسب مبيعات لحد ما الكاشير يستلم الفلوس
  awaitingCash: { type: Boolean, default: false },
  driverOutAt: { type: Date },
  cashReceivedAt: { type: Date },
  cashReceivedBy: { type: String },
  cancelReason: { type: String },
  cancelledBy: { type: String },
  cancelledAt: { type: Date },
  // تقييم العميل للأوردر (نجوم + تعليق) — بيتسجل من حساب العميل بس وبعد اكتمال الأوردر
  rating: { type: new mongoose.Schema({ stars: Number, comment: String, at: Date }, { _id: false }), default: undefined }
});
orderSchema.index({ clientRef: 1 }, { sparse: true });
// فهارس سرّعت البحث في الأوردرات (من غيرها كل طلب بيقلّب كل الأوردرات ويبطّأ كل ما الداتا تكبر)
orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ completedAt: 1 });
orderSchema.index({ cancelledAt: 1 }, { sparse: true });
orderSchema.index({ shiftId: 1 });
const Order = mongoose.model("Order", orderSchema);

// قاعدة العملاء (للتسويق والإعلانات + تعبئة بيانات العميل لوحده في الدليفري)
const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  address: { type: String, default: "" },
  zoneName: { type: String, default: "" },
  // الرقم السري لحساب العميل (مشفر بـ scrypt زي باسوردات الكاشير — عمره ما يتخزن نص صريح)
  pinHash: { type: String, default: "" },
  pinSetAt: { type: Date },
  pinResetAt: { type: Date },
  pinResetBy: { type: String, default: "" },
  ordersCount: { type: Number, default: 0 },
  lastOrderAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});
const Customer = mongoose.model("Customer", customerSchema);
const chatMessageSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  name: { type: String, default: "" },
  from: { type: String, enum: ["customer", "staff"], required: true },
  staffName: { type: String, default: "" },
  text: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
chatMessageSchema.index({ phone: 1, createdAt: 1 });
const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

// عدّاد أرقام أوردرات الكاشير
const counterSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model("Counter", counterSchema);

// الشيفتات (فتح / حركات الدرج / تقفيل)
const shiftSchema = new mongoose.Schema({
  status: { type: String, default: "closed" },
  openedAt: { type: Date },
  openedBy: { type: String },
  openedById: { type: String },
  handoverTo: { type: String, default: "" },
  handoverCash: { type: Number },
  handoverStatus: { type: String, default: "none" },
  autoClosed: { type: Boolean, default: false },
  handoverAcceptedBy: { type: String, default: "" },
  handoverAcceptedAt: { type: Date },
  openingCash: { type: Number, default: 0 },
  receiptSeq: { type: Number, default: 0 },
  movements: { type: Array, default: [] },
  closedAt: { type: Date },
  closedBy: { type: String },
  from: { type: Date },
  count: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
  delivery: { type: Number, default: 0 },
  orders: { type: Array, default: [] },
  payments: { type: Object, default: {} },
  talabat: { type: Number, default: 0 },
  discounts: { type: Number, default: 0 },
  cancelled: { type: Number, default: 0 },
  report: { type: Object },
  countedCash: { type: Number },
  expectedCash: { type: Number },
  difference: { type: Number },
  notes: { type: String }
});
// وردية واحدة مفتوحة بس لكل كاشير (بيمنع الوردية المكررة لو دوست مرتين بسرعة)
shiftSchema.index({ openedBy: 1 }, { unique: true, partialFilterExpression: { status: "open" } });
const Shift = mongoose.model("Shift", shiftSchema);

// =========================
// AUTH (الكاشير / الأدمن)
// =========================
const AUTH_SECRET = process.env.AUTH_SECRET || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_PIN = process.env.ADMIN_PIN || "";
const ACCOUNTANT_PIN = process.env.ACCOUNTANT_PIN || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const ADMIN_USERNAME = "admin";

const authReady = AUTH_SECRET.length >= 24 && ADMIN_PASSWORD.length >= 8;

if (!authReady) {
  console.error(
    "⚠️ نظام الدخول مقفول: لازم تضيف AUTH_SECRET (24 حرف أو أكتر) و ADMIN_PASSWORD (8 حروف أو أكتر) في Variables بتاعة Railway."
  );
}

const ADMIN_TOKEN_TTL = 12 * 60 * 60 * 1000;
const CASHIER_TOKEN_TTL = 14 * 24 * 60 * 60 * 1000;

const adminStamp = authReady
  ? crypto.createHmac("sha256", AUTH_SECRET).update(`admin:${ADMIN_PASSWORD}`).digest("hex").slice(0, 16)
  : "";

// ختم توكن المحاسب: بيتغير لما يتغير ACCOUNTANT_PIN، فأي توكن قديم بيبطل لوحده
const accountantStamp = ACCOUNTANT_PIN.length >= 4
  ? crypto.createHmac("sha256", AUTH_SECRET).update(`accountant:${ACCOUNTANT_PIN}`).digest("hex").slice(0, 16)
  : "";

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["cashier", "admin"], default: "cashier" },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});
const Staff = mongoose.model("Staff", staffSchema);

const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(String(password), salt, 64);
  return `${salt}:${key.toString("hex")}`;
};

const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

const verifyPassword = async (password, stored) => {
  try {
    if (typeof stored !== "string") return false;
    const [salt, hash] = stored.split(":");
    if (!salt || !hash || !/^[0-9a-f]{128}$/i.test(hash)) return false;
    const expected = Buffer.from(hash, "hex");
    const test = await scrypt(String(password), salt, 64);
    return expected.length === test.length && crypto.timingSafeEqual(expected, test);
  } catch {
    return false;
  }
};

const safeEqual = (a, b) => {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const adminPinIsValid = (pin) => ADMIN_PIN.length >= 4 && safeEqual(String(pin ?? ""), ADMIN_PIN);

const signToken = (payload, ttlMs) => {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
};

const verifyToken = (token) => {
  try {
    if (typeof token !== "string") return null;
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

// ---------- حماية من التخمين والطلبات المتكررة ----------
const buckets = new Map();

const hitBucket = (key, windowMs) => {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    bucket = { count: 0, reset: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket;
};

// حد عام لكل الـ API: الزائر العادي 150 طلب في الدقيقة، والكاشير/الأدمن (معاه توكن) 900 (الكاشير بيعمل تحديث تلقائي كل كام ثانية)
app.use("/api", (req, res, next) => {
  if (req.path === "/health" || req.method === "OPTIONS") return next();
  const authed = !!req.headers.authorization;
  const bucket = hitBucket(`api:${req.ip}:${authed ? "a" : "p"}`, 60 * 1000);
  if (bucket.count > (authed ? 900 : 150)) {
    res.set("Retry-After", "30");
    return res.status(429).json({ error: "طلبات كتير أوي في وقت قصير، استنى شوية وحاول تاني" });
  }
  next();
});

const peekBucket = (key) => {
  const bucket = buckets.get(key);
  return bucket && bucket.reset > Date.now() ? bucket : null;
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.reset < now) buckets.delete(key);
}, 60 * 1000).unref();

const PIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_PIN_FAILS = 5;

// فحص PIN الأدمن مع حدّ محاولات: 5 محاولات غلط لنفس المستخدم في 15 دقيقة = قفل + تنبيه للأدمن
const checkAdminPin = (req, pin) => {
  const key = `pin:${req.user?.id || req.user?.username || req.ip}`;
  if ((peekBucket(key)?.count || 0) >= MAX_PIN_FAILS) return { locked: true };
  if (adminPinIsValid(pin)) { buckets.delete(key); return { ok: true }; }
  const bucket = hitBucket(key, PIN_WINDOW_MS);
  if (bucket.count >= MAX_PIN_FAILS) {
    void sendTelegramAlert(`🔐 محاولات PIN غلط كتير\nالمستخدم: ${req.user?.name || "-"} (${req.user?.username || "-"})\nاتقفل 15 دقيقة بعد ${MAX_PIN_FAILS} محاولات فاشلة`);
  }
  return { ok: false };
};

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILS_PER_USER = 5;
const MAX_LOGIN_FAILS_PER_IP = 30;

const orderLimiter = (req, res, next) => {
  const bucket = hitBucket(`order:${req.ip}`, 10 * 60 * 1000);
  if (bucket.count > 15) {
    return res.status(429).json({ error: "طلبات كتير في وقت قصير، حاول بعد شوية" });
  }
  next();
};

// ---------- Middlewares ----------
const requireAuth = async (req, res, next) => {
  try {
    if (!authReady) return res.status(503).json({ error: "نظام الدخول لسه مش متظبط على السيرفر" });

    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: "غير مصرح" });

    if (payload.role === "admin") {
      if (payload.s !== adminStamp) return res.status(401).json({ error: "غير مصرح" });
      req.user = { _id: "admin", name: "المدير", username: ADMIN_USERNAME, role: "admin" };
      return next();
    }

    const user = await Staff.findById(payload.id);
    if (!user || !user.active || user.role !== "cashier") {
      return res.status(401).json({ error: "الحساب غير مفعل" });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "غير مصرح" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "للأدمن فقط" });
  next();
};

// المحاسب بس — للتقارير بس. توكن المحاسب مينفعش في requireAuth/requireAdmin،
// فمش بيوصل لأي حاجة غير راوتات المحاسب اللي تحت. توكن الأدمن مرفوض هنا.
const requireAccountant = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: "غير مصرح" });
  if (payload.role !== "accountant") return res.status(401).json({ error: "غير مصرح" });
  if (!accountantStamp || payload.s !== accountantStamp) return res.status(401).json({ error: "غير مصرح" });
  req.user = { _id: "accountant", name: "المحاسب", role: "accountant" };
  return next();
};

// ---------- حسابات العملاء (رقم تليفون + رقم سري) ----------
// العميل بيثبت إن الرقم رقمه بالرقم السري، فمحدش غريب يقدر يكتب رقم حد ويشوف عنوانه أو طلباته.
const CUSTOMER_TOKEN_TTL = 90 * 24 * 60 * 60 * 1000;

// الرقم السري: 4-6 أرقام، وممنوع الأرقام السهلة المتوقعة
const isValidCustomerPin = (pin) => {
  const p = String(pin ?? "");
  if (!/^\d{4,6}$/.test(p)) return false;
  if (/^(\d)\1+$/.test(p)) return false;
  if (["1234", "4321", "12345", "54321", "123456", "654321"].includes(p)) return false;
  return true;
};

const signCustomerToken = (phone) => signToken({ phone, role: "customer" }, CUSTOMER_TOKEN_TTL);

const requireCustomerAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== "customer" || !payload.phone) {
    return res.status(401).json({ error: "سجّل دخول بحسابك الأول" });
  }
  req.customerPhone = normPhone(payload.phone);
  if (!/^\d{8,15}$/.test(req.customerPhone)) return res.status(401).json({ error: "سجّل دخول بحسابك الأول" });
  next();
};

// حدّ محاولات دخول العملاء: 5 محاولات غلط في 15 دقيقة — على الرقم لوحده وعلى الـ IP لوحده، وأي واحد فيهم بيقفل (نفس نمط قفل دخول الكاشير)
const MAX_CUSTOMER_LOGIN_FAILS = 5;
const customerLoginPhoneKey = (phone) => `custlogin:phone:${phone}`;
const customerLoginIpKey = (req) => `custlogin:ip:${req.ip}`;
const customerLoginLocked = (req, phone) => (peekBucket(customerLoginPhoneKey(phone))?.count || 0) >= MAX_CUSTOMER_LOGIN_FAILS || (peekBucket(customerLoginIpKey(req))?.count || 0) >= MAX_CUSTOMER_LOGIN_FAILS;
const recordCustomerLoginFail = (req, phone) => { hitBucket(customerLoginPhoneKey(phone), LOGIN_WINDOW_MS); hitBucket(customerLoginIpKey(req), LOGIN_WINDOW_MS); };
const clearCustomerLoginFails = (req, phone) => { buckets.delete(customerLoginPhoneKey(phone)); buckets.delete(customerLoginIpKey(req)); };

// ---------- شات دعم العملاء (كول سنتر) ----------
// توكن شات للضيوف: بيثبت إن المتصفح ده هو صاحب الرقم اللي بدأ المحادثة، من غير رقم سري
const CHAT_TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;
const signChatToken = (phone) => signToken({ phone, role: "chat" }, CHAT_TOKEN_TTL);

// قراءة رسايل الشات: توكن حساب عميل أو توكن شات (ضيف) — كل واحد يشوف رسايل رقمه بس
const requireChatAuth = (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload || (payload.role !== "customer" && payload.role !== "chat") || !payload.phone) {
    return res.status(401).json({ error: "افتح الشات من الأول" });
  }
  req.chatPhone = normPhone(payload.phone);
  if (!/^\d{8,15}$/.test(req.chatPhone)) return res.status(401).json({ error: "افتح الشات من الأول" });
  next();
};

// حدّ إرسال الشات: 10 رسايل لكل رقم+IP في الدقيقة (عشان محدش يسبّم الكاشير)
const chatSendLimiter = (req, res, next) => {
  const phone = normPhone(req.body?.phone || "");
  const bucket = hitBucket(`chat:${req.ip}:${phone}`, 60 * 1000);
  if (bucket.count > 10) {
    return res.status(429).json({ error: "بعتّ رسايل كتير أوي، استنى دقيقة وحاول تاني" });
  }
  next();
};

// ---------- تسجيل الدخول ----------
app.post("/api/auth/login", async (req, res) => {
  try {
    if (!authReady) return res.status(503).json({ error: "نظام الدخول لسه مش متظبط على السيرفر" });

    const username = String(req.body?.username || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!username || !password || password.length > 200) {
      return res.status(400).json({ error: "اكتب اليوزر والباسورد" });
    }

    const userKey = `login:${req.ip}:${username}`;
    const ipKey = `loginip:${req.ip}`;
    if (
      (peekBucket(userKey)?.count || 0) >= MAX_LOGIN_FAILS_PER_USER ||
      (peekBucket(ipKey)?.count || 0) >= MAX_LOGIN_FAILS_PER_IP
    ) {
      return res.status(429).json({ error: "محاولات غلط كتير، استنى 15 دقيقة وحاول تاني" });
    }

    let session = null;

    if (username === ADMIN_USERNAME) {
      if (safeEqual(password, ADMIN_PASSWORD)) {
        session = {
          token: signToken({ id: "admin", role: "admin", s: adminStamp }, ADMIN_TOKEN_TTL),
          user: { id: "admin", name: "المدير", username: ADMIN_USERNAME, role: "admin" }
        };
      }
    } else {
      const staff = await Staff.findOne({ username, role: "cashier" });
      const passwordOk = await verifyPassword(password, staff ? staff.password : DUMMY_HASH);
      if (staff && passwordOk && staff.active) {
        session = {
          token: signToken({ id: String(staff._id), role: "cashier" }, CASHIER_TOKEN_TTL),
          user: { id: staff._id, name: staff.name, username: staff.username, role: "cashier" }
        };
      }
    }

    if (!session) {
      hitBucket(userKey, LOGIN_WINDOW_MS);
      hitBucket(ipKey, LOGIN_WINDOW_MS);
      return res.status(401).json({ error: "اليوزر أو الباسورد غلط" });
    }

    buckets.delete(userKey);
    buckets.delete(ipKey);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- دخول المحاسب (رقم سري بس من Railway، قراءة تقارير بس) ----------
app.post("/api/auth/accountant-login", async (req, res) => {
  try {
    if (!ACCOUNTANT_PIN || ACCOUNTANT_PIN.length < 4) return res.status(503).json({ error: "حساب المحاسب لسه متظبطش في Railway — ضيف ACCOUNTANT_PIN" });
    const pin = String(req.body?.pin || "");
    if (!pin || pin.length > 200) return res.status(400).json({ error: "اكتب الرقم السري" });
    const userKey = `acctlogin:${req.ip}`;
    const ipKey = `acctloginip:${req.ip}`;
    if (
      (peekBucket(userKey)?.count || 0) >= MAX_LOGIN_FAILS_PER_USER ||
      (peekBucket(ipKey)?.count || 0) >= MAX_LOGIN_FAILS_PER_IP
    ) {
      return res.status(429).json({ error: "محاولات غلط كتير، استنى 15 دقيقة وحاول تاني" });
    }
    if (!safeEqual(pin, ACCOUNTANT_PIN)) {
      hitBucket(userKey, LOGIN_WINDOW_MS);
      hitBucket(ipKey, LOGIN_WINDOW_MS);
      if ((peekBucket(userKey)?.count || 0) >= MAX_LOGIN_FAILS_PER_USER) {
        void sendTelegramAlert(`\u{1F510} محاولات دخول محاسب غلط كتير\nاتقفل 15 دقيقة بعد ${MAX_LOGIN_FAILS_PER_USER} محاولات فاشلة`);
      }
      return res.status(401).json({ error: "الرقم السري غلط" });
    }
    buckets.delete(userKey);
    buckets.delete(ipKey);
    res.json({
      token: signToken({ id: "accountant", role: "accountant", s: accountantStamp }, 12 * 60 * 60 * 1000),
      user: { id: "accountant", name: "المحاسب", role: "accountant" }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- إدارة الكاشيرات ----------
const USERNAME_RE = /^[a-z0-9_.-]{3,30}$/;

app.get("/api/staff", requireAuth, requireAdmin, async (req, res) => {
  try {
    const staff = await Staff.find({ role: "cashier" }).select("-password").sort({ createdAt: 1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff", requireAuth, requireAdmin, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim().slice(0, 50);
    const username = String(req.body?.username || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!name) return res.status(400).json({ error: "اكتب اسم الكاشير" });
    if (!USERNAME_RE.test(username)) return res.status(400).json({ error: "اسم المستخدم لازم يكون إنجليزي وأرقام من 3 لـ 30 حرف" });
    if (username === ADMIN_USERNAME) return res.status(400).json({ error: "اسم المستخدم ده محجوز" });
    if (password.length < 6 || password.length > 100) return res.status(400).json({ error: "الباسورد لازم يكون 6 حروف أو أرقام على الأقل" });

    const created = await Staff.create({
      name,
      username,
      password: await hashPassword(password),
      role: "cashier"
    });

    res.status(201).json({ _id: created._id, name: created.name, username: created.username, role: created.role, active: created.active });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "اليوزر ده موجود قبل كده" });
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/staff/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "رقم الحساب غير صحيح" });
    const update = {};
    if (req.body?.password !== undefined) {
      const password = String(req.body.password);
      if (password.length < 6 || password.length > 100) return res.status(400).json({ error: "الباسورد لازم يكون 6 حروف على الأقل" });
      update.password = await hashPassword(password);
    }
    if (typeof req.body?.active === "boolean") update.active = req.body.active;
    if (req.body?.name) update.name = String(req.body.name).trim().slice(0, 50);

    const updated = await Staff.findOneAndUpdate({ _id: req.params.id, role: "cashier" }, update, { new: true }).select("-password");
    if (!updated) return res.status(404).json({ error: "الحساب غير موجود" });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/staff/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "رقم الحساب غير صحيح" });
    await Staff.findOneAndDelete({ _id: req.params.id, role: "cashier" });
    res.json({ message: "تم المسح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// SETTINGS
// =========================
const SETTINGS_IMAGE_FIELDS = { hero: "heroImage", logo: "logoImage", banner: "promoBannerImage" };

const presentSettings = (doc) => {
  const d = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  Object.entries(SETTINGS_IMAGE_FIELDS).forEach(([key, field]) => {
    if (typeof d[field] === "string" && d[field].startsWith("data:")) d[field] = `${PUBLIC_URL}/api/settings/image/${key}?v=${d[field].length}`;
  });
  return d;
};

app.get("/api/settings", async (req, res) => {
  try {
    const cached = readListCache("settings");
    if (cached) return res.type("json").send(cached);
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    const body = JSON.stringify(presentSettings(settings));
    writeListCache("settings", body);
    res.type("json").send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/settings/image/:key", async (req, res) => {
  try {
    const field = SETTINGS_IMAGE_FIELDS[req.params.key];
    if (!field) return res.status(404).end();
    const settings = await Settings.findOne().lean();
    if (!settings) return res.status(404).end();
    sendImageFromDataUri(res, settings[field]);
  } catch (err) {
    res.status(500).end();
  }
});

app.put("/api/settings", requireAuth, requireAdmin, async (req, res) => {
  try {
    const body = { ...req.body };
    Object.values(SETTINGS_IMAGE_FIELDS).forEach((f) => { if (isOwnImageUrl(body[f])) delete body[f]; });
    let settings = await Settings.findOne();
    if (!settings) settings = new Settings(body);
    else Object.assign(settings, body);
    await settings.save();
    res.json(presentSettings(settings));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// DELIVERY ZONES
// =========================
app.get("/api/zones", async (req, res) => {
  try {
    res.json(await DeliveryZone.find());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/zones", requireAuth, requireAdmin, async (req, res) => {
  try {
    const saved = await new DeliveryZone(req.body).save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/zones/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح المنطقة بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// CATEGORIES
// =========================
app.get("/api/categories", async (req, res) => {
  try {
    res.json(await Category.find().sort({ order: 1, _id: 1 }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/categories", requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const saved = await new Category({ ...req.body, order: count }).save();
    res.json(saved);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/categories/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updated = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح القسم بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// ITEMS
// =========================
// ---- الصور: بدل ما نبعت الصور (base64) جوه رد الأصناف، بنبعت لينك صغير والمتصفح يحمّل الصورة لوحدها ويخزّنها ----
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://noss-kofta-production-d57f.up.railway.app").replace(/\/$/, "");
const DATA_URI_RE = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;
// لينك صورة بتاعنا (لو الأدمن رجّعه في التعديل، ما نحفظوش مكان الصورة الأصلية)
const isOwnImageUrl = (v) => typeof v === "string" && v.startsWith(`${PUBLIC_URL}/api/`) && v.includes("/image");

const presentItem = (doc) => {
  const d = doc && typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  if (typeof d.image === "string" && d.image.startsWith("data:")) d.image = `${PUBLIC_URL}/api/items/${d._id}/image?v=${d.image.length}`;
  return d;
};
const sendImageFromDataUri = (res, dataUri) => {
  const m = DATA_URI_RE.exec(dataUri || "");
  if (!m) return res.status(404).end();
  const buf = Buffer.from(m[2], "base64");
  res.set({ "Content-Type": m[1], "Content-Length": buf.length, "Cache-Control": "public, max-age=31536000, immutable" });
  res.send(buf);
};

app.get("/api/items", async (req, res) => {
  try {
    const cached = readListCache("items");
    if (cached) return res.type("json").send(cached);
    // الصور بتتشال جوه MongoDB نفسه (من غير ما تتنقل للسيرفر) ونسيب مكانها لينك
    const docs = await Item.aggregate([
      { $sort: { order: 1, _id: 1 } },
      {
        $addFields: {
          _imgLen: { $strLenCP: { $ifNull: ["$image", ""] } },
          _isData: { $eq: [{ $substrCP: [{ $ifNull: ["$image", ""] }, 0, 5] }, "data:"] }
        }
      },
      { $addFields: { image: { $cond: ["$_isData", "", "$image"] } } }
    ]);
    const body = JSON.stringify(docs.map((d) => {
      const out = { ...d };
      if (d._isData) out.image = `${PUBLIC_URL}/api/items/${d._id}/image?v=${d._imgLen}`;
      if (out.available === undefined) out.available = true;
      delete out._imgLen; delete out._isData;
      return out;
    }));
    writeListCache("items", body);
    res.type("json").send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/items/:id/image", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) return res.status(404).end();
    const item = await Item.findById(req.params.id).select("image").lean();
    if (!item) return res.status(404).end();
    sendImageFromDataUri(res, item.image);
  } catch (err) {
    res.status(500).end();
  }
});

app.post("/api/items", requireAuth, requireAdmin, async (req, res) => {
  try {
    const count = await Item.countDocuments({ category: req.body.category });
    const coded = await Item.find({ code: { $ne: null } }).select("code").lean();
    const inRange = coded.map((i) => Number(i.code)).filter((n) => Number.isInteger(n) && n >= ITEM_CODE_START && n <= ITEM_CODE_END);
    const nextCode = (inRange.length ? Math.max(...inRange) : ITEM_CODE_START - 1) + 1;
    if (nextCode > ITEM_CODE_END) console.warn(`\u26A0\uFE0F رموز الأصناف: عدد الأصناف عدّى ${ITEM_CODE_END}، والرمز ${nextCode} برّه النطاق`);
    const newItem = new Item({ ...req.body, order: count, code: nextCode });
    res.json(await newItem.save());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تعديل الخصم لأكتر من صنف مرة واحدة (للأدمن) — لازم يكون قبل راوت /api/items/:id
app.put("/api/items/bulk-discount", requireAuth, requireAdmin, async (req, res) => {
  try {
    const discount = Number(req.body?.discount);
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
      return res.status(400).json({ error: "الخصم لازم يكون رقم من 0 لـ 100" });
    }
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.filter((id) => mongoose.Types.ObjectId.isValid(id))
      : [];
    if (ids.length === 0) return res.status(400).json({ error: "اختار صنف واحد على الأقل" });

    const result = await Item.updateMany({ _id: { $in: ids } }, { $set: { discount } });
    res.json({ ok: true, matched: result.matchedCount, modified: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/items/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const updateData = { ...req.body };
    delete updateData._id;
    delete updateData.code; // رمز الصنف ثابت ومش بيتغير من التعديل
    delete updateData.available;
    if (isOwnImageUrl(updateData.image)) delete updateData.image;
    if (req.body.price !== undefined) updateData.price = Number(req.body.price);
    else delete updateData.price;
    if (req.body.discount !== undefined) updateData.discount = Number(req.body.discount) || 0;
    else delete updateData.discount;

    const updated = await Item.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: "الصنف غير موجود" });
    res.json(presentItem(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/items/:id/availability", requireAuth, async (req, res) => {
  try {
    if (typeof req.body.available !== "boolean") return res.status(400).json({ error: "القيمة غير صحيحة" });
    const updated = await Item.findByIdAndUpdate(req.params.id, { $set: { available: req.body.available } }, { new: true });
    if (!updated) return res.status(404).json({ error: "الصنف غير موجود" });
    res.json({ _id: updated._id, name: updated.name, available: updated.available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/items/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح الصنف بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// ORDERS
// =========================
const cleanText = (value, max) => String(value ?? "").trim().slice(0, max);
const clampNumber = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
};

// أرقام التليفونات: بنشيل أي رموز، ونحوّل +20 لـ 0 عشان نفس العميل ما يتسجلش مرتين
const normPhone = (v) => {
  let d = String(v ?? "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("20")) d = "0" + d.slice(2);
  return d;
};
const isValidPhone = (v) => /^\d{8,15}$/.test(normPhone(v));
const upsertCustomer = async ({ phone, name, address, zoneName }) => {
  try {
    const p = normPhone(phone);
    if (!/^\d{8,15}$/.test(p)) return;
    const set = { lastOrderAt: new Date() };
    const n = cleanText(name, 80);
    if (n && n !== "-" && n !== "طلبات") set.name = n;
    const a = cleanText(address, 300);
    if (a && a !== "استلام من الفرع" && a !== "طلبات" && a !== "-") set.address = a;
    const z = cleanText(zoneName, 80);
    if (z && z !== "استلام من الفرع" && z !== "طلبات") set.zoneName = z;
    await Customer.findOneAndUpdate({ phone: p }, { $set: set, $inc: { ordersCount: 1 }, $setOnInsert: { phone: p } }, { upsert: true });
  } catch (err) {
    if (err?.code !== 11000) console.error("upsertCustomer error:", err.message);
  }
};

// =========================
// STORE HOURS (فتح / قفل استقبال الأوردرات)
// =========================
const STORE_TZ = "Africa/Cairo";
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_CLOSED_MSG = "قفلنا دلوقتي 🌙 هنفتح تاني الصبح بإذن الله، تنوّر نص كفتة في مواعيدنا!";

const toMin = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
const cairoMinutes = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: STORE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour").value) % 24;
  const m = Number(parts.find((p) => p.type === "minute").value);
  return h * 60 + m;
};
// بيدعم الميعاد اللي بعد نص الليل (مثلاً 12:00 ← 03:00)
const inWindow = (now, open, close) => (open === close ? true : open < close ? now >= open && now < close : now >= open || now < close);

let storeCfgCache = { at: 0, cfg: null };
const loadStoreCfg = async () => {
  if (storeCfgCache.cfg && Date.now() - storeCfgCache.at < 5000) return storeCfgCache.cfg;
  const s = await Settings.findOne().lean();
  const cfg = {
    mode: ["auto", "open", "closed"].includes(s?.orderingMode) ? s.orderingMode : "auto",
    openTime: TIME_RE.test(s?.openTime || "") ? s.openTime : "12:00",
    closeTime: TIME_RE.test(s?.closeTime || "") ? s.closeTime : "03:00",
    customMessage: s?.closedMessage || ""
  };
  storeCfgCache = { at: Date.now(), cfg };
  return cfg;
};

const getStoreStatus = async () => {
  try {
    const cfg = await loadStoreCfg();
    const isOpen = cfg.mode === "open" ? true : cfg.mode === "closed" ? false : inWindow(cairoMinutes(), toMin(cfg.openTime), toMin(cfg.closeTime));
    return { isOpen, mode: cfg.mode, openTime: cfg.openTime, closeTime: cfg.closeTime, customMessage: cfg.customMessage, message: isOpen ? "" : (cfg.customMessage || DEFAULT_CLOSED_MSG) };
  } catch (err) {
    // لو قاعدة البيانات فيها مشكلة ما نوقفش الأوردرات
    return { isOpen: true, mode: "auto", openTime: "12:00", closeTime: "03:00", customMessage: "", message: "" };
  }
};

const saveStoreCfg = async (patch) => {
  let s = await Settings.findOne();
  if (!s) s = new Settings({});
  Object.assign(s, patch);
  await s.save();
  storeCfgCache = { at: 0, cfg: null };
  listCache.settings = null;
};

// عام: الموقع بيسأله كل دقيقة
app.get("/api/store-status", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await getStoreStatus());
});

// الكاشير والأدمن: فتح / قفل / تلقائي
app.put("/api/store-mode", requireAuth, requireAdmin, async (req, res) => {
  try {
    const mode = req.body?.mode;
    if (!["auto", "open", "closed"].includes(mode)) return res.status(400).json({ error: "الوضع غير صحيح" });
    await saveStoreCfg({ orderingMode: mode });
    void sendTelegramAlert(`🌐 تغيير استقبال الموقع\nبواسطة: ${req.user.name}\nالوضع: ${mode === "open" ? "مفتوح يدويًا" : mode === "closed" ? "مغلق يدويًا" : "تلقائي حسب المواعيد"}`);
    res.json(await getStoreStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الأدمن فقط: المواعيد ورسالة القفل
app.put("/api/store-hours", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { openTime, closeTime, closedMessage } = req.body || {};
    if (!TIME_RE.test(String(openTime)) || !TIME_RE.test(String(closeTime))) return res.status(400).json({ error: "اكتب الوقت بشكل صحيح" });
    await saveStoreCfg({ openTime, closeTime, closedMessage: cleanText(closedMessage, 200) });
    res.json(await getStoreStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const POS_PAYMENTS = ["cash", "visa", "instapay", "wallet"];
const WEBSITE_PAYMENTS = ["cash", "visa", "instapay", "wallet"];
const PAY_LABEL_AR = { cash: "كاش", visa: "فيزا", instapay: "انستا باي", wallet: "محفظة", split: "مقسّم" };
const splitOf = (o) => (Array.isArray(o?.paymentSplit) && o.paymentSplit.length ? o.paymentSplit.map((p) => ({ method: p.method, amount: Number(p.amount) || 0 })) : null);
// الجزء الكاش من الأوردر (اللي بيدخل الدرج أو اللي السواق بيحصّله)
const cashPartOf = (o) => {
  const sp = splitOf(o);
  if (sp) return sp.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0);
  return o?.paymentMethod === "cash" ? Number(o.grandTotal) || 0 : 0;
};
const describePayment = (o) => {
  const sp = splitOf(o);
  return sp ? sp.map((p) => `${PAY_LABEL_AR[p.method] || p.method} ${p.amount}`).join(" + ") : (PAY_LABEL_AR[o?.paymentMethod] || o?.paymentMethod || "-");
};
// تحقق صارم من تقسيم الدفع: 2-4 طرق مختلفة، كل مبلغ موجب، والمجموع = الإجمالي بالظبط
const validateSplit = (raw, grand, orderType, fee) => {
  if (orderType === "talabat") return { error: "طلبات: كاش أو فيزا بس، مفيش تقسيم" };
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return { error: "تقسيم الدفع لازم يكون من 2 لـ 4 طرق دفع" };
  const seen = new Set();
  const split = [];
  for (const p of raw) {
    const method = String(p?.method || "");
    if (!POS_PAYMENTS.includes(method)) return { error: "طريقة دفع غير صحيحة في التقسيم" };
    if (seen.has(method)) return { error: "نفس طريقة الدفع مكررة في التقسيم" };
    seen.add(method);
    const amount = Math.round(Number(p?.amount) * 100) / 100;
    if (!(amount > 0) || amount > 10000000) return { error: "كل مبلغ في التقسيم لازم يكون أكبر من صفر" };
    split.push({ method, amount });
  }
  const sum = Math.round(split.reduce((a, p) => a + p.amount, 0) * 100) / 100;
  if (Math.abs(sum - grand) > 0.009) return { error: `مجموع التقسيم (${sum} ج) مش بيساوي إجمالي الأوردر (${grand} ج)` };
  if (orderType === "delivery") {
    const cash = split.filter((p) => p.method === "cash").reduce((a, p) => a + p.amount, 0);
    if (cash > 0 && cash < (Number(fee) || 0) - 0.009) return { error: `الكاش في الدليفري لازم يغطي أجرة التوصيل (${fee} ج) أو يبقى صفر` };
  }
  return { split };
};
const sendTelegramAlert = async (message) => {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) console.error("Telegram alert failed:", response.status);
  } catch (err) {
    console.error("Telegram alert error:", err.message);
  }
};

// نص تنبيه الخصم: الأوردر كامل (الأصناف والأسعار والإجمالي والدفع والكاشير والعميل)
const discountAlertText = (o, cashierName) => {
  const lines = (o.items || []).map((it) => `• ${it.name} ×${it.quantity} — ${Number(it.price) || 0} ج`);
  return [
    `🏷️ خصم على أوردر #${o.orderId}`,
    ...lines,
    `المجموع قبل الخصم: ${Number(o.itemsTotal) || 0} ج`,
    `الخصم: ${Number(o.discountPercent) || 0}% (${Number(o.discountAmount) || 0} ج) — السبب: ${o.discountReason || "-"}`,
    `الإجمالي: ${Number(o.grandTotal) || 0} ج`,
    `الدفع: ${describePayment(o)}`,
    `الكاشير: ${cashierName}`,
    `العميل: ${o.customerName || "-"} (${o.customerPhone || "-"})`,
    `الوقت: ${new Date().toLocaleString("ar-EG")}`
  ].join("\n");
};

const groupsForItem = (item) => {
  const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];
  if (groups.length > 0) return groups;
  const legacy = [];
  if (Array.isArray(item.sizes) && item.sizes.length > 0) legacy.push({ name: "اختر الحجم", min: 1, max: 1, options: item.sizes });
  if (Array.isArray(item.addons) && item.addons.length > 0) legacy.push({ name: "الإضافات الاختيارية", min: 0, max: item.addons.length, options: item.addons });
  return legacy;
};

const discountedComponentPrice = (price, discount) => Math.round((Number(price) || 0) * (1 - (Number(discount) || 0) / 100));

// السعر لا يُؤخذ من المتصفح؛ يُعاد بناؤه من الصنف والاختيارات المحفوظة في MongoDB.
const priceOrderItemsFromCatalog = async (rawItems, maxItems = 80, applyMenuDiscount = true) => {
  if (!Array.isArray(rawItems)) return { error: "الأوردر فاضي" };
  const limited = rawItems.slice(0, maxItems);
  if (limited.length === 0) return { error: "الأوردر فاضي" };

  const ids = [...new Set(limited.map((it) => String(it?.itemId || it?._id || "")).filter((id) => mongoose.Types.ObjectId.isValid(id)))];
  const catalog = ids.length ? await Item.find({ _id: { $in: ids } }).lean() : [];
  const byId = new Map(catalog.map((it) => [String(it._id), it]));
  const output = [];

  for (const raw of limited) {
    const itemId = String(raw?.itemId || raw?._id || "");
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return { error: "فيه صنف بياناته قديمة في السلة. امسحه وأضفه من المنيو تاني." };
    }
    const item = byId.get(itemId);
    if (!item) return { error: "فيه صنف لم يعد موجودًا في المنيو. حدّث المنيو وحاول تاني." };
    if (item.available === false) return { error: `الصنف ${item.name} غير متاح حاليًا` };

    const groups = groupsForItem(item);

    // بوكس (نص كفتة): الاختيارات جاية كـ "2× اسم الصنف" ولازم مجموعها = عدد الأصناف المطلوب
    if (item.type === "box" && Array.isArray(item.boxItems) && item.boxItems.length > 0 && groups.length === 0) {
      const boxMax = Number(item.maxItems) || 0;
      const allowedNames = new Set(item.boxItems.map((b) => String(b.name || "").trim()));
      const picks = [];
      let boxTotal = 0;
      for (const m of Array.isArray(raw?.modifiers) ? raw.modifiers : []) {
        const mm = /^\s*(\d+)\s*×\s*(.+?)\s*$/.exec(String(m || ""));
        if (!mm) continue;
        const cnt = Number(mm[1]);
        if (!allowedNames.has(mm[2]) || cnt < 1) return { error: `اختيارات البوكس ${item.name} غير صحيحة. امسحه وأضفه من المنيو تاني.` };
        picks.push(`${cnt}× ${mm[2]}`);
        boxTotal += cnt;
      }
      if (boxMax > 0 && boxTotal !== boxMax) return { error: `لازم تختار ${boxMax} أصناف في ${item.name}` };
      if (boxMax === 0 && boxTotal === 0) return { error: `اختار محتويات ${item.name}` };
      const boxDiscount = applyMenuDiscount ? (Number(item.discount) || 0) : 0;
      output.push({
        itemId: String(item._id), name: item.name, price: discountedComponentPrice(item.price, boxDiscount),
        quantity: Math.round(clampNumber(raw?.quantity, 1, 99)), modifiers: picks, notes: cleanText(raw?.notes, 300)
      });
      continue;
    }

    const selectionsByGroup = groups.map(() => []);
    let hasStructuredSelections = Array.isArray(raw?.selections);

    if (hasStructuredSelections) {
      for (const selection of raw.selections) {
        const gi = Number(selection?.groupIndex);
        if (!Number.isInteger(gi) || gi < 0 || gi >= groups.length) continue;
        const indices = Array.isArray(selection?.optionIndices) ? selection.optionIndices : [];
        selectionsByGroup[gi] = [...new Set(indices.map(Number).filter((oi) => Number.isInteger(oi) && oi >= 0 && oi < (groups[gi].options || []).length))];
      }
    } else {
      // توافق مع السلال القديمة: نطابق اسم المجموعة والاختيار فقط، ونتجاهل أي سعر مكتوب في النص.
      const modifiers = Array.isArray(raw?.modifiers) ? raw.modifiers : [];
      for (const modifier of modifiers) {
        const text = String(modifier || "").trim();
        const colon = text.indexOf(":");
        if (colon < 0) continue;
        const groupName = text.slice(0, colon).trim();
        const optionName = text.slice(colon + 1).replace(/\s*\(\s*\+?\s*\d+(?:\.\d+)?\s*ج\s*\)\s*$/, "").trim();
        let gi = groups.findIndex((g) => String(g.name || "").trim() === groupName);
        if (gi < 0) gi = groups.findIndex((g) => (g.options || []).some((o) => String(o.name || "").trim() === optionName));
        if (gi >= 0) {
          const oi = (groups[gi].options || []).findIndex((o) => String(o.name || "").trim() === optionName);
          if (oi >= 0 && !selectionsByGroup[gi].includes(oi)) selectionsByGroup[gi].push(oi);
        }
      }
    }

    for (let gi = 0; gi < groups.length; gi += 1) {
      const group = groups[gi];
      const selectedCount = selectionsByGroup[gi].length;
      const min = Number.isFinite(Number(group.min)) ? Number(group.min) : 0;
      const max = Number.isFinite(Number(group.max)) ? Number(group.max) : (group.options || []).length;
      if (selectedCount < min || selectedCount > max) {
        return { error: `اختيارات الصنف ${item.name} غير مكتملة. امسحه وأضفه من المنيو تاني.` };
      }
    }

    // طلبات الموقع تطبق خصم المنيو، أما الكاشير فيستخدم السعر الأصلي دائمًا.
    const discount = applyMenuDiscount ? (Number(item.discount) || 0) : 0;
    // الأصناف القديمة (أحجام/إضافات): سعر الحجم هو السعر الأساسي، والإضافة بتتحسب من غير خصم
    const legacyMode = !(Array.isArray(item.modifierGroups) && item.modifierGroups.length > 0);
    const legacySized = legacyMode && Array.isArray(item.sizes) && item.sizes.length > 0;
    let unitPrice = !legacySized && Number(item.price) > 0 ? discountedComponentPrice(item.price, discount) : 0;
    const modifiers = [];
    for (let gi = 0; gi < groups.length; gi += 1) {
      const group = groups[gi];
      for (const oi of selectionsByGroup[gi]) {
        const option = (group.options || [])[oi];
        if (!option) continue;
        const optionPrice = legacyMode && group.name === "الإضافات الاختيارية" ? Math.round(Number(option.price) || 0) : discountedComponentPrice(option.price, discount);
        unitPrice += optionPrice;
        modifiers.push(`${group.name}: ${option.name}${optionPrice > 0 ? ` (+${optionPrice} ج)` : ""}`);
      }
    }

    const quantity = Math.round(clampNumber(raw?.quantity, 1, 99));
    output.push({
      itemId: String(item._id),
      name: item.name,
      price: unitPrice,
      quantity,
      modifiers,
      notes: cleanText(raw?.notes, 300)
    });
  }
  return { items: output };
};

const buildOrderFromBody = async (body = {}, zone = null) => {
  const orderId = cleanText(body.orderId, 30);
  if (!/^[A-Za-z0-9-]{4,30}$/.test(orderId)) return { error: "رقم الأوردر غير صحيح" };

  const customerName = cleanText(body.customerName, 80);
  if (!customerName) return { error: "الاسم مطلوب" };
  const customerPhone = cleanText(body.customerPhone, 20);
  if (!/^\+?\d{8,15}$/.test(customerPhone)) return { error: "رقم التليفون غير صحيح" };

  const orderType = body.orderType === "delivery" ? "delivery" : body.orderType === "pickup" ? "pickup" : null;
  if (!orderType) return { error: "نوع الاستلام غير صحيح" };
  if (orderType === "delivery" && !cleanText(body.customerAddress, 300)) return { error: "العنوان مطلوب" };
  if (orderType === "delivery" && !zone) return { error: "اختار منطقة توصيل صحيحة من القائمة" };

  const priced = await priceOrderItemsFromCatalog(body.items, 60);
  if (priced.error) return { error: priced.error };
  const items = priced.items;
  const itemsTotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const deliveryFee = orderType === "delivery" ? Number(zone.fee) || 0 : 0;

  return {
    order: {
      orderId, customerName, customerPhone, orderType,
      customerAddress: orderType === "delivery" ? cleanText(body.customerAddress, 300) : "استلام من الفرع",
      zoneName: orderType === "delivery" ? zone.name : "استلام من الفرع",
      deliveryFee, items, itemsTotal, grandTotal: itemsTotal + deliveryFee, status: "pending", source: "web"
    }
  };
};

app.post("/api/orders", orderLimiter, async (req, res) => {
  try {
    const status = await getStoreStatus();
    if (!status.isOpen) return res.status(403).json({ error: status.message, closed: true });

    const body = req.body || {};
    let zone = null;
    if (body.orderType === "delivery") {
      zone = await DeliveryZone.findOne({ name: cleanText(body.zoneName, 80) }).lean();
    }
    const { order, error } = await buildOrderFromBody(body, zone);
    if (error) return res.status(400).json({ error });

    // رقم سري اختياري: لو العميل عنده رقم سري مسجل لازم يطابق، ولو أول مرة وبيبعت رقم سري بيتسجل لحسابه
    const pinRaw = String(body.pin ?? "").trim();
    const phoneNorm = normPhone(order.customerPhone);
    let customerToken = null;
    let pinIsNew = false;
    if (pinRaw) {
      if (customerLoginLocked(req, phoneNorm)) {
        return res.status(429).json({ error: "محاولات غلط كتير، استنى 15 دقيقة وحاول تاني" });
      }
      const existingCustomer = await Customer.findOne({ phone: phoneNorm }).select("pinHash").lean();
      if (existingCustomer?.pinHash) {
        const pinOk = await verifyPassword(pinRaw, existingCustomer.pinHash);
        if (!pinOk) {
          recordCustomerLoginFail(req, phoneNorm);
          return res.status(401).json({ error: "الرقم السري غلط. اتأكد منه، أو امسحه واطلب كضيف من غير رقم سري" });
        }
        customerToken = signCustomerToken(phoneNorm);
        clearCustomerLoginFails(req, phoneNorm);
      } else {
        if (!isValidCustomerPin(pinRaw)) {
          return res.status(400).json({ error: "الرقم السري لازم يكون من 4 لـ 6 أرقام، ومش أرقام سهلة زي 1234" });
        }
        pinIsNew = true;
      }
    }

    const saved = await new Order(order).save();
    if (pinIsNew) {
      // حفظ الرقم السري مشفراً (محاولتين عشان سباق الإنشاء مع upsertCustomer)
      const pinHash = await hashPassword(pinRaw);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await Customer.updateOne({ phone: phoneNorm }, { $set: { pinHash, pinSetAt: new Date() } }, { upsert: attempt === 0 });
          break;
        } catch (err) {
          if (err?.code !== 11000 || attempt === 1) console.error("save customer PIN error:", err.message);
        }
      }
      customerToken = signCustomerToken(phoneNorm);
    }
    void upsertCustomer({ phone: saved.customerPhone, name: saved.customerName, address: saved.orderType === "delivery" ? saved.customerAddress : "", zoneName: saved.orderType === "delivery" ? saved.zoneName : "" });
    console.log(`✅ New website order saved: #${saved.orderId}`);
    res.status(201).json({
      ok: true,
      ...(customerToken ? { customerToken } : {}),
      orderId: saved.orderId,
      order: {
        orderId: saved.orderId, customerName: saved.customerName, customerPhone: saved.customerPhone,
        orderType: saved.orderType, customerAddress: saved.customerAddress, zoneName: saved.zoneName,
        deliveryFee: saved.deliveryFee, items: saved.items, itemsTotal: saved.itemsTotal, grandTotal: saved.grandTotal
      }
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "الأوردر ده اتبعت قبل كده" });
    res.status(500).json({ error: err.message });
  }
});

// =========================
// حسابات العملاء: دخول / بياناتي / تغيير الرقم السري / تقييم
// =========================

// دخول العميل برقمه ورقمه السري — رسالة واحدة عامة للرقم الغلط والرقم السري الغلط (عشان محدش يعرف الرقم متسجل ولا لأ)
app.post("/api/customers/login", async (req, res) => {
  try {
    if (!authReady) return res.status(503).json({ error: "الخدمة مش متاحة دلوقتي، حاول بعد شوية" });
    const phone = normPhone(req.body?.phone);
    const pin = String(req.body?.pin || "");
    const wrong = () => res.status(401).json({ error: "الرقم أو الرقم السري غلط" });
    if (!/^\d{8,15}$/.test(phone) || !pin) return wrong();
    if (customerLoginLocked(req, phone)) {
      return res.status(429).json({ error: "محاولات غلط كتير، استنى 15 دقيقة وحاول تاني" });
    }
    const customer = await Customer.findOne({ phone }).lean();
    const ok = await verifyPassword(pin, customer?.pinHash || DUMMY_HASH);
    if (!customer?.pinHash || !ok) {
      recordCustomerLoginFail(req, phone);
      return wrong();
    }
    clearCustomerLoginFails(req, phone);
    res.json({
      token: signCustomerToken(phone),
      profile: { name: customer.name || "", phone, address: customer.address || "", zoneName: customer.zoneName || "" }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// بيانات العميل وطلباته — رقم تليفونه بس، مفيش وصول لأي رقم تاني
app.get("/api/customers/me", requireCustomerAuth, async (req, res) => {
  try {
    const phone = req.customerPhone;
    const customer = await Customer.findOne({ phone }).lean();
    const phoneVariants = [phone, `+2${phone}`, `20${phone.slice(1)}`];
    const orders = await Order.find({ customerPhone: { $in: phoneVariants } })
      .sort({ createdAt: -1 }).limit(20)
      .select("orderId items itemsTotal deliveryFee grandTotal status orderType zoneName createdAt completedAt rating")
      .lean();
    res.json({
      profile: { name: customer?.name || "", phone, address: customer?.address || "", zoneName: customer?.zoneName || "" },
      orders: orders.map((o) => ({
        orderId: o.orderId, items: o.items || [], itemsTotal: o.itemsTotal, deliveryFee: o.deliveryFee,
        grandTotal: o.grandTotal, status: o.status, orderType: o.orderType, zoneName: o.zoneName,
        createdAt: o.createdAt, completedAt: o.completedAt,
        rating: o.rating?.stars ? { stars: o.rating.stars, comment: o.rating.comment || "" } : null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تغيير الرقم السري — لازم يكون داخل بحسابه ويعرف القديم
app.post("/api/customers/change-pin", requireCustomerAuth, async (req, res) => {
  try {
    const oldPin = String(req.body?.oldPin || "");
    const newPin = String(req.body?.newPin || "");
    if (!isValidCustomerPin(newPin)) {
      return res.status(400).json({ error: "الرقم السري الجديد لازم يكون من 4 لـ 6 أرقام، ومش أرقام سهلة زي 1234" });
    }
    const customer = await Customer.findOne({ phone: req.customerPhone });
    if (!customer?.pinHash || !(await verifyPassword(oldPin, customer.pinHash))) {
      return res.status(401).json({ error: "الرقم السري القديم غلط" });
    }
    customer.pinHash = await hashPassword(newPin);
    customer.pinSetAt = new Date();
    await customer.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسح الرقم السري لعميل نسيه وكلّم المطعم — للكاشير/الأدمن من داخل النظام (العميل يعمل رقم جديد مع أوردره الجاي)
app.post("/api/customers/:phone/reset-pin", requireAuth, async (req, res) => {
  try {
    const phone = normPhone(req.params.phone);
    if (!/^\d{8,15}$/.test(phone)) {
      return res.status(400).json({ error: "رقم التليفون مش صحيح" });
    }
    const customer = await Customer.findOne({ phone });
    if (!customer) {
      return res.status(404).json({ error: "مفيش عميل مسجل بالرقم ده" });
    }
    await Customer.updateOne({ phone }, { $set: { pinResetAt: new Date(), pinResetBy: req.user.name }, $unset: { pinHash: "", pinSetAt: "" } });
    void sendTelegramAlert(`🔓 مسح الرقم السري لعميل\nالرقم: ${phone}\nالاسم: ${customer.name || "-"}\nبواسطة: ${req.user.name}\nالوقت: ${new Date().toLocaleString("ar-EG", { timeZone: "Africa/Cairo" })}`);
    res.json({ ok: true, message: "تم مسح الرقم السري، العميل يقدر يعمل رقم جديد مع أوردره الجاي" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تقييم الأوردر — لازم يكون أوردر العميل نفسه ومكتمل. التقييم يتعدل (العميل يقدر يغيّر تقييمه)
app.post("/api/orders/:id/rate", requireCustomerAuth, async (req, res) => {
  try {
    const query = mongoose.Types.ObjectId.isValid(req.params.id)
      ? { $or: [{ _id: req.params.id }, { orderId: req.params.id }] }
      : { orderId: req.params.id };
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: "الأوردر غير موجود" });
    if (normPhone(order.customerPhone) !== req.customerPhone) {
      return res.status(403).json({ error: "الأوردر ده مش بتاعك" });
    }
    if (order.status !== "completed") {
      return res.status(409).json({ error: "التقييم متاح بعد ما الأوردر يكمل بس" });
    }
    const stars = Number(req.body?.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
      return res.status(400).json({ error: "اختار من نجمة لـ 5 نجوم" });
    }
    order.rating = { stars, comment: cleanText(req.body?.comment, 300), at: new Date() };
    await order.save();
    res.json({ ok: true, rating: { stars: order.rating.stars, comment: order.rating.comment } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= شات دعم العملاء (كول سنتر) =================
// رسالة من العميل — عامة (من غير رقم سري)، لكن مقيدة بعدد الرسايل. لو معاه توكن حساب عميل، رقمه بيتاخد من التوكن.
app.post("/api/chat/send", chatSendLimiter, async (req, res) => {
  try {
    let phone = normPhone(req.body?.phone);
    let isCustomerToken = false;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (payload && payload.role === "customer" && payload.phone) {
      phone = normPhone(payload.phone);
      isCustomerToken = true;
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: "رقم التليفون مش صحيح" });
    }
    const text = cleanText(req.body?.text, 500);
    if (!text) {
      return res.status(400).json({ error: "اكتب رسالة الأول" });
    }
    let name = cleanText(req.body?.name, 40);
    if (!name) {
      const existing = await Customer.findOne({ phone }).lean();
      name = existing?.name || "";
    }
    const msg = await ChatMessage.create({ phone, name, from: "customer", text });
    const out = { ok: true, message: { _id: msg._id, from: msg.from, staffName: "", text: msg.text, createdAt: msg.createdAt, read: msg.read } };
    if (!isCustomerToken) out.chatToken = signChatToken(phone);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// رسايل العميل — رقمه بس (توكن حساب أو توكن شات)
app.get("/api/chat/messages", requireChatAuth, async (req, res) => {
  try {
    const msgs = await ChatMessage.find({ phone: req.chatPhone }).sort({ createdAt: 1 }).limit(50).lean();
    res.json(msgs.map((m) => ({ _id: m._id, from: m.from, staffName: m.staffName || "", text: m.text, createdAt: m.createdAt, read: m.read })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// قايمة محادثات العملاء للكاشير — من غير أي بيانات حساسة (لا عناوين ولا مواقع)
app.get("/api/chat/conversations", requireAuth, async (req, res) => {
  try {
    const convs = await ChatMessage.aggregate([
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$phone",
          name: { $max: "$name" },
          lastText: { $first: "$text" },
          lastFrom: { $first: "$from" },
          lastAt: { $first: "$createdAt" },
          unread: { $sum: { $cond: [{ $and: [{ $eq: ["$from", "customer"] }, { $eq: ["$read", false] }] }, 1, 0] } }
        }
      },
      { $sort: { lastAt: -1 } },
      { $limit: 50 }
    ]);
    res.json(convs.map((c) => ({ phone: c._id, name: c.name || "", lastText: c.lastText, lastFrom: c.lastFrom, lastAt: c.lastAt, unread: c.unread })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// محادثة رقم معين — وبيعلم رسايل العميل كمقروءة
app.get("/api/chat/conversations/:phone/messages", requireAuth, async (req, res) => {
  try {
    const phone = normPhone(req.params.phone);
    if (!isValidPhone(phone)) return res.status(400).json({ error: "رقم التليفون مش صحيح" });
    const msgs = await ChatMessage.find({ phone }).sort({ createdAt: 1 }).limit(100).lean();
    await ChatMessage.updateMany({ phone, from: "customer", read: false }, { $set: { read: true } });
    res.json(msgs.map((m) => ({ _id: m._id, from: m.from, staffName: m.staffName || "", text: m.text, createdAt: m.createdAt, read: m.read })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// رد الكاشير على عميل
app.post("/api/chat/conversations/:phone/reply", requireAuth, async (req, res) => {
  try {
    const phone = normPhone(req.params.phone);
    if (!isValidPhone(phone)) return res.status(400).json({ error: "رقم التليفون مش صحيح" });
    const text = cleanText(req.body?.text, 500);
    if (!text) return res.status(400).json({ error: "اكتب الرد الأول" });
    const msg = await ChatMessage.create({ phone, from: "staff", staffName: req.user.name || "", text });
    res.json({ ok: true, message: { _id: msg._id, from: msg.from, staffName: msg.staffName, text: msg.text, createdAt: msg.createdAt, read: msg.read } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الأدمن والكاشير: كل الأوردرات (الكاشير للعرض والطباعة فقط، الإلغاء بعد الإنهاء ممنوع في PUT)
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    if (req.user?.role === "admin") return res.json(await Order.find({}).sort({ createdAt: -1 }).limit(2000).lean());
    // الكاشير: الأوردرات النشطة + أوردرات ورديته الحالية بس. الأيام اللي فاتت للأدمن فقط.
    const myShift = await Shift.findOne({ status: "open", openedBy: req.user.name }).select("openedAt").lean();
    const since = myShift?.openedAt;
    const cashierFilter = since
      ? { $or: [{ status: { $in: ["pending", "accepted"] } }, { createdAt: { $gte: since } }, { completedAt: { $gte: since } }, { cancelledAt: { $gte: since } }] }
      : { status: { $in: ["pending", "accepted"] } };
    res.json(await Order.find(cashierFilter).sort({ createdAt: -1 }).limit(1000));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// الحالات المسموحة للكاشير: لقدام بس. الأدمن بس يرجّع للخلف.
const FORWARD_STATUS = {
  pending: ["accepted", "completed", "cancelled"],
  accepted: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

app.put("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status || !["pending", "accepted", "completed", "cancelled"].includes(status)) return res.status(400).json({ error: "حالة الأوردر غير صحيحة" });
    const query = mongoose.Types.ObjectId.isValid(req.params.id) ? { $or: [{ _id: req.params.id }, { orderId: req.params.id }] } : { orderId: req.params.id };
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: "الأوردر غير موجود" });

    // نفس الحالة تاني: ما نغيرش حاجة (يمنع تكرار التسليم أو الحساب)
    if (order.status === status) return res.json(order);

    const isAdminUser = req.user?.role === "admin";
    if (!isAdminUser && !(FORWARD_STATUS[order.status] || []).includes(status)) {
      return res.status(403).json({ error: "مينفعش ترجّع أو تعدّل أوردر خلص. اطلب من الأدمن" });
    }

    const update = { status };
    const unset = {};
    if (status === "accepted") { update.acceptedBy = req.user.name; update.acceptedAt = new Date(); }

    if (status === "completed") {
      if (req.user?.role !== "admin") {
        const cashierShift = await Shift.findOne({ status: "open", openedBy: req.user.name }).select("_id").lean();
        if (!cashierShift) return res.status(400).json({ error: "افتح ورديتك قبل تسليم الأوردر" });
      }
      if (order.awaitingCash) {
        // السواق رجّع الفلوس: دلوقتي بس الأوردر يتقفل ويتحسب مبيعات وكاش في الدرج
        if (req.body.cashReceived !== true) return res.status(400).json({ error: "الأوردر مع السواق ومستني النقدية. اضغط (استلمت النقدية من السواق)" });
        update.completedBy = req.user.name; update.completedAt = new Date();
        update.awaitingCash = false; update.cashReceivedAt = new Date(); update.cashReceivedBy = req.user.name;
        // السواق خلّى أجرته من الكاش اللي حصّله: الأجرة اتسوّت من غير حركة درج
        if (order.orderType === "delivery" && (Number(order.deliveryFee) || 0) > 0) update.driverFeePaid = true;
      } else {
        let driverNameNow = "";
        if (order.orderType === "delivery") {
          driverNameNow = cleanText(req.body.driverName, 40);
          if (!driverNameNow) return res.status(400).json({ error: "اكتب اسم السواق قبل خروج الأوردر" });
          update.driverName = driverNameNow;
        }
        if (order.source !== "pos" || !order.paymentMethod) {
          const paymentMethod = WEBSITE_PAYMENTS.includes(req.body.paymentMethod) ? req.body.paymentMethod : null;
          if (!paymentMethod) return res.status(400).json({ error: "اختار طريقة الدفع قبل تأكيد التسليم" });
          update.paymentMethod = paymentMethod;
        }
        const cashNow = update.paymentMethod ? update.paymentMethod === "cash" : cashPartOf(order) > 0;
        if (order.orderType === "delivery" && cashNow) {
          // دليفري كاش: الأوردر يخرج مع السواق ويفضل في النشطة مستني النقدية (مش بيتحسب مبيعات لسه)
          update.status = "accepted";
          update.awaitingCash = true; update.driverOutAt = new Date();
          if (!order.acceptedBy) { update.acceptedBy = req.user.name; update.acceptedAt = new Date(); }
        } else {
          update.completedBy = req.user.name; update.completedAt = new Date();
        }
      }
    }

    if (status === "cancelled") {
      const reason = cleanText(req.body.cancelReason, 200);
      if (reason.length < 2) return res.status(400).json({ error: "اكتب سبب الإلغاء" });
      const needsPin = !isAdminUser && (order.source === "pos" || !!order.printedAt || !!order.paymentMethod);
      if (needsPin) {
        const pinCheck = checkAdminPin(req, req.body.adminPin);
        if (pinCheck.locked) return res.status(429).json({ error: "محاولات PIN غلط كتير، استنى 15 دقيقة وحاول تاني" });
        // للكاشير: رسالة عامة من غير ما نكشف هل الـPIN مش متظبط ولا غلط
        if (!pinCheck.ok) return res.status(403).json({ error: (req.user?.role === "admin" && ADMIN_PIN.length < 4) ? "اضبط ADMIN_PIN في Railway أولًا" : "إلغاء أوردر مدفوع أو مطبوع يحتاج PIN الأدمن الصحيح" });
      }
      update.cancelReason = reason; update.cancelledBy = req.user.name; update.cancelledAt = new Date();
      update.cancelledAfterPrint = !!order.printedAt;
      update.awaitingCash = false;
    }

    if (status !== "completed") { unset.completedAt = ""; unset.completedBy = ""; unset.driverName = ""; update.awaitingCash = false; }
    if (status !== "cancelled") { unset.cancelReason = ""; unset.cancelledBy = ""; unset.cancelledAt = ""; }

    const op = { $set: update };
    if (Object.keys(unset).length) op.$unset = unset;

    // الشرط على الحالة القديمة عشان لو دوسين في نفس اللحظة ما يتسجلوش مرتين
    const updatedOrder = await Order.findOneAndUpdate({ _id: order._id, status: order.status }, op, { new: true });
    if (!updatedOrder) return res.status(409).json({ error: "الأوردر اتغيّر قبل كده، حدّث الصفحة" });
    // أوردر توصيل مدفوع مش كاش: العميل دفع للمطعم، والسواق بياخد أجرته كاش من الدرج
    if (status === "completed" && updatedOrder.status === "completed" && updatedOrder.orderType === "delivery" && updatedOrder.paymentMethod && cashPartOf(updatedOrder) <= 0
        && !updatedOrder.driverFeePaid && (Number(updatedOrder.deliveryFee) || 0) > 0) {
      const fee = Number(updatedOrder.deliveryFee) || 0;
      const feeShift = await Shift.findOneAndUpdate(
        { status: "open", openedBy: req.user.name },
        { $push: { movements: { type: "out", amount: fee, reason: `أجرة سواق ${updatedOrder.driverName || ""} - أوردر #${updatedOrder.orderId}`.trim(), by: req.user.name, at: new Date(), category: "driver_fee" } } }
      );
      if (feeShift) await Order.updateOne({ _id: updatedOrder._id }, { $set: { driverFeePaid: true } });
    }
    if (status === "cancelled") {
      void sendTelegramAlert(`⚠️ إلغاء أوردر #${updatedOrder.orderId}\nبواسطة: ${req.user.name}\nبعد الطباعة: ${updatedOrder.cancelledAfterPrint ? "نعم" : "لا"}\nالسبب: ${updatedOrder.cancelReason || "-"}`);
    }
    res.json(updatedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// البحث عن عميل برقم التليفون (للدليفري): بيرجّع الاسم والعنوان والمنطقة لو العميل اتعامل معانا قبل كده
app.get("/api/pos/customers/:phone", requireAuth, async (req, res) => {
  try {
    const phone = normPhone(req.params.phone);
    if (!/^\d{8,15}$/.test(phone)) return res.json({ found: false });
    const c = await Customer.findOne({ phone }).lean();
    if (c) return res.json({ found: true, name: c.name || "", address: c.address || "", zoneName: c.zoneName || "", ordersCount: c.ordersCount || 0 });
    // عملاء قدام (قبل قاعدة العملاء): نجيب آخر أوردر بنفس الرقم
    const tail = phone.slice(-10);
    const o = await Order.findOne({ customerPhone: new RegExp(`${tail}$`), orderType: "delivery" }).sort({ createdAt: -1 }).select("customerName customerAddress zoneName").lean();
    if (!o) return res.json({ found: false });
    const nm = o.customerName && o.customerName !== "-" && o.customerName !== "طلبات" ? o.customerName : "";
    res.json({ found: true, name: nm, address: o.customerAddress || "", zoneName: o.zoneName || "", ordersCount: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/pos/orders", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const openShift = await Shift.findOne({ status: "open", openedBy: req.user.name }).select("_id openedAt").lean();
    if (!openShift) return res.status(400).json({ error: "افتح ورديتك الأول" });
    // أوردر اتسجل أوفلاين: لو اتبعت قبل كده (clientRef) نرجّع نفس الأوردر بدل ما نكرره
    const clientRef = cleanText(body.clientRef, 60);
    if (clientRef) {
      const dup = await Order.findOne({ clientRef });
      if (dup) return res.status(200).json(dup);
    }
    const offlineAtRaw = body.offlineAt ? new Date(body.offlineAt) : null;
    const offlineAt = offlineAtRaw && !isNaN(offlineAtRaw) && offlineAtRaw >= new Date(openShift.openedAt) && offlineAtRaw <= new Date() ? offlineAtRaw : null;

    const orderType = ["pickup", "delivery", "talabat"].includes(body.orderType) ? body.orderType : null;
    if (!orderType) return res.status(400).json({ error: "نوع الأوردر غير صحيح" });

    const wantsSplit = body.paymentMethod === "split";
    const paymentMethod = wantsSplit ? "split" : (POS_PAYMENTS.includes(body.paymentMethod) ? body.paymentMethod : null);
    if (!paymentMethod) return res.status(400).json({ error: "اختار طريقة الدفع" });
    if (orderType === "talabat" && !["cash", "visa"].includes(paymentMethod)) return res.status(400).json({ error: "طلبات: كاش أو فيزا بس" });

    const talabatNo = orderType === "talabat" ? cleanText(body.talabatNo, 30) : undefined;
    if (orderType === "talabat" && !talabatNo) return res.status(400).json({ error: "اكتب رقم أوردر طلبات" });
    if (orderType === "talabat") {
      const duplicate = await Order.findOne({ orderType: "talabat", talabatNo }).select("_id").lean();
      if (duplicate) return res.status(409).json({ error: "رقم أوردر طلبات ده متسجل قبل كده" });
    }

    const priced = await priceOrderItemsFromCatalog(body.items, 80, false);
    if (priced.error) return res.status(400).json({ error: priced.error });
    const items = priced.items;

    // الخصم متاح للكاشير بأي نسبة من غير PIN، لكن لازم سبب، وبيظهر في تقرير التقفيل
    const discountPercent = clampNumber(body.discountPercent, 0, 100);
    const discountReason = cleanText(body.discountReason, 200);
    const orderNote = cleanText(body.orderNote, 300);
    if (discountPercent > 0 && discountReason.length < 2) return res.status(400).json({ error: "سبب الخصم إجباري" });

    const itemsTotal = items.reduce((sum, it) => sum + it.price * it.quantity, 0);
    const discountAmount = Math.round(itemsTotal * discountPercent / 100);

    let customerName = cleanText(body.customerName, 80) || "-";
    const rawPhone = cleanText(body.customerPhone, 20);
    // الدليفري: التليفون إجباري. استلام وطلبات: اختياري (لجمع داتا للإعلانات) بس لو اتكتب لازم يكون صحيح
    if (orderType === "delivery" && !rawPhone) return res.status(400).json({ error: "اكتب رقم تليفون العميل الأول (إجباري في الدليفري)" });
    if (rawPhone && !isValidPhone(rawPhone)) return res.status(400).json({ error: "رقم التليفون غير صحيح. اتركه فاضي لو مش عايز تسجله" });
    let customerPhone = rawPhone || "-";
    let customerAddress = "استلام من الفرع";
    let zoneName = "استلام من الفرع";
    let deliveryFee = 0;
    if (orderType === "delivery") {
      customerAddress = cleanText(body.customerAddress, 300);
      if (!customerAddress) return res.status(400).json({ error: "اكتب عنوان التوصيل" });
      zoneName = cleanText(body.zoneName, 80) || "توصيل";
      const zone = zoneName ? await DeliveryZone.findOne({ name: zoneName }).lean() : null;
      deliveryFee = zone ? Number(zone.fee) || 0 : clampNumber(body.deliveryFee, 0, 500);
    } else if (orderType === "talabat") {
      customerName = cleanText(body.customerName, 80) || "طلبات"; customerAddress = "طلبات"; zoneName = "طلبات";
    }

    const grandTotal = itemsTotal - discountAmount + deliveryFee;
    let paymentSplit = null;
    if (wantsSplit) {
      const v = validateSplit(body.paymentSplit, grandTotal, orderType, deliveryFee);
      if (v.error) return res.status(400).json({ error: v.error });
      paymentSplit = v.split;
    }
    // رقم قاعدة البيانات يظل فريدًا، أما رقم الإيصال فيبدأ من 1 في كل وردية.
    const currentShift = await Shift.findOneAndUpdate(
      { _id: openShift._id, status: "open", openedBy: req.user.name },
      { $inc: { receiptSeq: 1 } },
      { new: true }
    );
    if (!currentShift) return res.status(409).json({ error: "الوردية اتقفلت، افتح وردية جديدة قبل تسجيل الأوردر" });
    const counter = await Counter.findOneAndUpdate({ key: "pos" }, { $inc: { seq: 1 } }, { new: true, upsert: true });
    const orderId = `P${counter.seq}`;
    const saved = await new Order({
      orderId, shiftReceiptNo: currentShift.receiptSeq, shiftId: currentShift._id,
      customerName, customerPhone, orderType, customerAddress, zoneName, deliveryFee,
      items, itemsTotal, grandTotal, status: "accepted", source: "pos", paymentMethod, ...(paymentSplit ? { paymentSplit } : {}),
      talabatNo, discountPercent, discountAmount, discountReason, orderNote,
      createdBy: req.user.name, acceptedBy: req.user.name, acceptedAt: offlineAt || new Date(),
      ...(clientRef ? { clientRef } : {}), ...(offlineAt ? { createdAt: offlineAt } : {})
    }).save();

    if (paymentSplit) {
      void sendTelegramAlert(`💳 دفع مقسّم - أوردر #${saved.orderId}\nالإجمالي: ${grandTotal} ج\nالتقسيم: ${describePayment(saved)}\nالكاشير: ${req.user.name}`);
    }
    console.log(`✅ POS order saved: #${saved.orderId} by ${req.user.name}`);
    if (customerPhone !== "-") void upsertCustomer({ phone: customerPhone, name: customerName, address: orderType === "delivery" ? customerAddress : "", zoneName: orderType === "delivery" ? zoneName : "" });
    if (discountPercent > 0) {
      void sendTelegramAlert(discountAlertText(saved, req.user.name));
    }
    if (orderType === "talabat") {
      void sendTelegramAlert(`🛍️ أوردر طلبات جديد #${saved.orderId}\nرقم طلبات: ${talabatNo}\nالقيمة: ${grandTotal} ج\nالدفع: ${paymentMethod === "cash" ? "كاش في الدرج" : "فيزا مستحقة عند طلبات"}\nسجله: ${req.user.name}`);
    }
    res.status(201).json(saved);
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: "رقم الأوردر متكرر" });
    res.status(500).json({ error: err.message });
  }
});

// تعديل أوردر كاشير بعد الإرسال: إضافة/حذف أصناف، تغيير الكمية، طريقة الدفع، الكومنت.
// مسموح فقط طول ما وردية الأوردر مفتوحة، وكل تعديل بيتسجل ويوصل تنبيه تليجرام.
app.put("/api/pos/orders/:id", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const query = mongoose.Types.ObjectId.isValid(req.params.id)
      ? { $or: [{ _id: req.params.id }, { orderId: req.params.id }] }
      : { orderId: req.params.id };
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: "الأوردر غير موجود" });
    if (order.source !== "pos") return res.status(400).json({ error: "التعديل لأوردرات الكاشير بس" });
    if (order.status === "cancelled") return res.status(400).json({ error: "الأوردر ملغي، مينفعش يتعدّل" });
    if (order.status === "completed" && req.user?.role !== "admin") return res.status(403).json({ error: "الأوردر مكتمل، التعديل للأدمن بس" });

    const shift = order.shiftId ? await Shift.findById(order.shiftId).lean() : null;
    if (!shift || shift.status !== "open") return res.status(400).json({ error: "وردية الأوردر اتقفلت، مينفعش تعدّله" });
    if (req.user?.role !== "admin" && shift.openedBy !== req.user.name) return res.status(403).json({ error: "تعديل الأوردر من كاشير وردية الأوردر بس" });

    // طريقة الدفع
    let paymentMethod = order.paymentMethod;
    let paymentSplit = splitOf(order);
    if (body.paymentMethod !== undefined) {
      if (body.paymentMethod === "split") {
        if (order.orderType === "talabat") return res.status(400).json({ error: "طلبات: كاش أو فيزا بس" });
        paymentMethod = "split";
      } else {
        if (!POS_PAYMENTS.includes(body.paymentMethod)) return res.status(400).json({ error: "طريقة الدفع غير صحيحة" });
        if (order.orderType === "talabat" && !["cash", "visa"].includes(body.paymentMethod)) return res.status(400).json({ error: "طلبات: كاش أو فيزا بس" });
        paymentMethod = body.paymentMethod;
        paymentSplit = null;
      }
    }

    // الأصناف: السطور القديمة (keepIndex) بتفضل بسعرها الأصلي، والجديدة بتتسعّر من المنيو
    let items = order.items;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ error: "الأوردر لازم يفضل فيه صنف. لو عايز تلغيه استخدم زرار الإلغاء" });
      const slots = [];
      const toPrice = [];
      for (const raw of body.items.slice(0, 80)) {
        if (typeof raw?.keepIndex === "number" && Number.isInteger(raw.keepIndex)) {
          const orig = order.items[raw.keepIndex];
          if (!orig) return res.status(409).json({ error: "الأوردر اتغيّر، حدّث الصفحة وحاول تاني" });
          slots.push({ keep: { itemId: orig.itemId, name: orig.name, price: orig.price, quantity: Math.round(clampNumber(raw.quantity, 1, 99)), modifiers: orig.modifiers || [], notes: cleanText(raw.notes, 300) } });
        } else {
          slots.push({ fresh: toPrice.length });
          toPrice.push(raw);
        }
      }
      let pricedNew = [];
      if (toPrice.length) {
        const priced = await priceOrderItemsFromCatalog(toPrice, 80, false);
        if (priced.error) return res.status(400).json({ error: priced.error });
        pricedNew = priced.items;
      }
      items = slots.map((s) => (s.keep ? s.keep : pricedNew[s.fresh]));
    }

    // الخصم والكومنت
    let discountPercent = order.discountPercent || 0;
    let discountReason = order.discountReason || "";
    if (body.discountPercent !== undefined) {
      discountPercent = clampNumber(body.discountPercent, 0, 100);
      discountReason = discountPercent > 0 ? cleanText(body.discountReason ?? order.discountReason, 200) : "";
      if (discountPercent > 0 && discountReason.length < 2) return res.status(400).json({ error: "سبب الخصم إجباري" });
    }
    const orderNote = body.orderNote !== undefined ? cleanText(body.orderNote, 300) : (order.orderNote || "");

    const itemsTotal = items.reduce((sum, it) => sum + (Number(it.price) || 0) * (Number(it.quantity) || 0), 0);
    const discountAmount = Math.round(itemsTotal * discountPercent / 100);
    const grandTotal = itemsTotal - discountAmount + (Number(order.deliveryFee) || 0);

    if (paymentMethod === "split") {
      const raw = body.paymentSplit !== undefined ? body.paymentSplit : order.paymentSplit;
      const v = validateSplit(raw, grandTotal, order.orderType, Number(order.deliveryFee) || 0);
      if (v.error) return res.status(400).json({ error: body.paymentSplit === undefined && Math.abs(grandTotal - order.grandTotal) > 0.009 ? "إجمالي الأوردر اتغيّر. قسّم الدفع من جديد (زرار 💳 الدفع)" : v.error });
      paymentSplit = v.split;
    }

    const sig = (list) => JSON.stringify((list || []).map((it) => [String(it.itemId || ""), it.name, Number(it.price) || 0, Number(it.quantity) || 0, it.modifiers || [], it.notes || ""]));
    const itemsChanged = sig(items) !== sig(order.items);
    const changed = itemsChanged || paymentMethod !== order.paymentMethod || JSON.stringify(paymentSplit || []) !== JSON.stringify(splitOf(order) || []) || orderNote !== (order.orderNote || "")
      || discountPercent !== (order.discountPercent || 0) || grandTotal !== order.grandTotal;
    if (!changed) return res.json({ order, itemsChanged: false, changed: false });

    const entry = {
      by: req.user.name, at: new Date(), afterPrint: !!order.printedAt,
      beforeTotal: order.grandTotal, afterTotal: grandTotal,
      beforePayment: describePayment(order), afterPayment: describePayment({ paymentMethod, paymentSplit }), itemsChanged
    };
    const setDoc = { items, itemsTotal, discountPercent, discountAmount, discountReason, grandTotal, paymentMethod, orderNote, editedAt: new Date(), editedBy: req.user.name, ...(paymentSplit ? { paymentSplit } : {}) };
    // أوردر دليفري كان مستني نقدية من السواق واتغيّر دفعه لفيزا/انستا/محفظة: الفلوس وصلت للمطعم، فيتقفل دلوقتي
    const closesNow = !!order.awaitingCash && cashPartOf({ paymentMethod, paymentSplit, grandTotal }) <= 0;
    if (closesNow) Object.assign(setDoc, { status: "completed", completedAt: new Date(), completedBy: req.user.name, awaitingCash: false });
    const updated = await Order.findOneAndUpdate(
      { _id: order._id, status: order.status },
      {
        $set: setDoc,
        ...(paymentSplit ? {} : { $unset: { paymentSplit: "" } }),
        $push: { editLog: { $each: [entry], $slice: -20 } }
      },
      { new: true }
    );
    if (!updated) return res.status(409).json({ error: "الأوردر اتغيّر قبل كده، حدّث الصفحة" });
    if (closesNow && !updated.driverFeePaid && (Number(updated.deliveryFee) || 0) > 0) {
      const fee = Number(updated.deliveryFee) || 0;
      const feeShift = await Shift.findOneAndUpdate(
        { _id: shift._id, status: "open" },
        { $push: { movements: { type: "out", amount: fee, reason: `أجرة سواق ${updated.driverName || ""} - أوردر #${updated.orderId}`.trim(), by: req.user.name, at: new Date(), category: "driver_fee" } } }
      );
      if (feeShift) await Order.updateOne({ _id: updated._id }, { $set: { driverFeePaid: true } });
    }

    const payLabel = { cash: "كاش", visa: "فيزا", instapay: "انستا باي", wallet: "محفظة" };
    // لو الأوردر المعدّل عليه خصم: تنبيه واحد بالأوردر كامل بدل تنبيه التعديل العادي
    if (discountPercent > 0) {
      void sendTelegramAlert(discountAlertText(updated, req.user.name));
    } else {
      void sendTelegramAlert(`✏️ تعديل أوردر #${updated.orderId}\nبواسطة: ${req.user.name}\nالإجمالي: ${order.grandTotal} ← ${grandTotal} ج\nالدفع: ${entry.beforePayment} ← ${entry.afterPayment}\nالأصناف اتغيّرت: ${itemsChanged ? "نعم" : "لا"}\nبعد الطباعة: ${entry.afterPrint ? "نعم" : "لا"}`);
    }
    res.json({ order: updated, itemsChanged, changed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders/:id/printed", requireAuth, async (req, res) => {
  try {
    const query = mongoose.Types.ObjectId.isValid(req.params.id)
      ? { $or: [{ _id: req.params.id }, { orderId: req.params.id }] }
      : { orderId: req.params.id };
    const order = await Order.findOne(query);
    if (!order) return res.status(404).json({ error: "الأوردر غير موجود" });
    if (!order.printedAt) {
      order.printedAt = new Date();
      order.printedBy = req.user.name;
      await order.save();
    }
    res.json({ ok: true, printedAt: order.printedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/orders/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح الأوردر" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// SHIFTS + REPORTS
// =========================
// ---------- تجميع الأوردرات (نفس قواعد الفلوس بتاعة buildReport بالظبط — بتتستخدم في تقرير الوردية وتقرير الفترة) ----------
const newOrderAcc = () => ({ count: 0, total: 0, delivery: 0, discounts: 0, talabat: 0, talabatCash: 0, talabatVisa: 0, driverCash: 0, payments: {}, byType: {}, byCashier: {}, catMap: new Map(), boxMap: new Map() });
const accumulateOrderInto = (acc, o, ctx) => {
  const g = Number(o.grandTotal) || 0;
  // أجرة التوصيل بتروح للسواق مباشرة، فمش بتتحسب ضمن المبيعات
  const fee = o.orderType === "delivery" ? Math.min(g, Number(o.deliveryFee) || 0) : 0;
  const sale = g - fee;
  acc.count += 1;
  acc.total += sale;
  acc.delivery += fee;
  acc.discounts += Number(o.discountAmount) || 0;
  if (o.orderType === "talabat") {
    acc.talabat += g;
    if (o.paymentMethod === "cash") {
      acc.talabatCash += g;
      acc.payments.cash = (acc.payments.cash || 0) + g;
    } else {
      acc.talabatVisa += g;
    }
  } else {
    // كاش: اللي دخل الدرج فعلاً = الجزء الكاش − الأجرة. فيزا/انستا/محفظة: اللي العميل دفعه للمطعم. المقسّم بيتوزّع على طرقه
    const parts = splitOf(o) || [{ method: o.paymentMethod || "cash", amount: g }];
    for (const p of parts) acc.payments[p.method] = (acc.payments[p.method] || 0) + (p.method === "cash" ? Math.max(0, p.amount - fee) : p.amount);
  }
  const type = (acc.byType[o.orderType] = acc.byType[o.orderType] || { count: 0, total: 0 });
  type.count += 1; type.total += sale;
  const who = o.source === "pos" ? (o.createdBy || o.completedBy || "-") : (o.completedBy || o.createdBy || "-");
  const cashier = (acc.byCashier[who] = acc.byCashier[who] || { count: 0, total: 0, discounts: 0 });
  cashier.count += 1; cashier.total += sale; cashier.discounts += Number(o.discountAmount) || 0;
  for (const it of o.items || []) {
    const baseName = String(it.name || "صنف بدون اسم");
    const catName = ctx.catOf.get(baseName) || "أخرى";
    const qty = Number(it.quantity) || 0;
    const revenue = (Number(it.price) || 0) * qty;
    if (!acc.catMap.has(catName)) acc.catMap.set(catName, { name: catName, qty: 0, total: 0, items: new Map() });
    const cat = acc.catMap.get(catName);
    cat.qty += qty; cat.total += revenue;
    // افصل أحجام/أنواع الدابل والتربل في تقرير المطبخ بدل دمجها تحت اسم واحد.
    // التفصيل: نفصل كل اختيار إجباري (زي الحجم: ربع صدر / ربع ورك / نص فرخة) في سطر لوحده بدل دمجهم تحت اسم الصنف
    const modList = Array.isArray(it.modifiers) ? it.modifiers : [];
    const catItem = ctx.itemByName.get(baseName);
    // أي اختيار إجباري، أو مجموعة اسمها حجم / نوع / سنجل دابل تربل، بيتفصل في سطر لوحده في الجرد
    const requiredGroups = new Set(catItem ? groupsForItem(catItem).filter((g) => Number(g.min) > 0 || /حجم|حجمه|size|نوع|وزن|سنجل|دابل|تربل/i.test(String(g.name || ""))).map((g) => String(g.name || "").trim()) : []);
    const variantParts = [];
    const boxParts = [];
    for (const mod of modList) {
      const text = String(mod || "");
      // محتويات البوكس ("2× كفتة"): بتتجمع في قسم لوحدها عشان الجرد يعرف الكميات الفعلية
      const boxM = /^\s*(\d+)\s*×\s*(.+?)\s*$/.exec(text);
      if (boxM) { acc.boxMap.set(boxM[2], (acc.boxMap.get(boxM[2]) || 0) + Number(boxM[1]) * qty); boxParts.push(`${boxM[1]}× ${boxM[2]}`); continue; }
      const colon = text.indexOf(":");
      if (colon < 0) continue;
      if (!requiredGroups.has(text.slice(0, colon).trim())) continue;
      variantParts.push(text.slice(colon + 1).replace(/\s*\(\s*\+?\s*\d+(?:\.\d+)?\s*ج\s*\)\s*$/, "").trim());
    }
    let variant = variantParts.filter(Boolean).join(" + ");
    if (!variant) {
      const variantMatch = `${baseName} ${modList.join(" ")}`.match(/\b(double|triple|single|دابل|تربل|سنجل)\b/i);
      variant = variantMatch ? variantMatch[0] : "";
    }
    let kitchenName = variant && !baseName.toLowerCase().includes(variant.toLowerCase()) ? `${baseName} - ${variant}` : baseName;
    // البوكس: نظهر محتوياته جنب اسمه ("بوكس 3 (2× كفتة، 1× ...)")
    if (boxParts.length) kitchenName = `${kitchenName} (${boxParts.join("، ")})`;
    const row = cat.items.get(kitchenName) || { name: kitchenName, qty: 0, total: 0 };
    row.qty += qty; row.total += revenue;
    cat.items.set(kitchenName, row);
  }
};
const categoriesOfAcc = (acc) => {
  const catMap = new Map(acc.catMap);
  if (acc.boxMap.size) {
    const boxItems = new Map([...acc.boxMap.entries()].map(([name, qty]) => [name, { name, qty, total: 0 }]));
    catMap.set("محتويات البوكسات", { name: "محتويات البوكسات", qty: [...acc.boxMap.values()].reduce((a, b) => a + b, 0), total: 0, items: boxItems });
  }
  return [...catMap.values()]
    .map((c) => ({ name: c.name, qty: c.qty, total: c.total, items: [...c.items.values()].sort((a, b) => b.qty - a.qty) }))
    .sort((a, b) => b.total - a.total);
};

const buildReport = async (from, to, shift = null) => {
  const fromD = new Date(from), toD = new Date(to);
  const [orders, cancelledList, catalog] = await Promise.all([
    Order.find({
      $or: [
        { source: "pos", orderType: { $in: ["pickup", "talabat"] }, status: { $ne: "cancelled" }, createdAt: { $gt: fromD, $lte: toD } },
        { status: "completed", completedAt: { $gt: fromD, $lte: toD }, $or: [{ source: { $ne: "pos" } }, { source: "pos", orderType: "delivery" }] }
      ]
    }).select("orderId grandTotal orderType deliveryFee discountAmount paymentMethod paymentSplit source createdBy completedBy createdAt completedAt status items").lean(),
    Order.find({ status: "cancelled", cancelledAt: { $gt: fromD, $lte: toD } }).select("grandTotal orderId cancelledAfterPrint cancelledBy").lean(),
    Item.find().select("name category modifierGroups sizes addons").lean()
  ]);

  const ctx = { catOf: new Map(catalog.map((i) => [i.name, i.category])), itemByName: new Map(catalog.map((i) => [i.name, i])) };
  const acc = newOrderAcc();

  // كل تقرير وردية يخص الكاشير الذي فتحها فقط، ولا يخلط مبيعات الكاشير الآخر.
  const shiftOrders = shift
    ? orders.filter((o) => {
        const cashierName = String(shift.openedBy || "");
        if (!cashierName) return true;
        if (o.source === "pos") return String(o.createdBy || o.completedBy || "") === cashierName;
        return String(o.completedBy || "") === cashierName;
      })
    : orders;
  const shiftCancelled = shift
    ? cancelledList.filter((o) => !o.cancelledBy || String(o.cancelledBy) === String(shift.openedBy || ""))
    : cancelledList;
  shiftOrders.sort((a, b) => new Date(a.completedAt || a.createdAt) - new Date(b.completedAt || b.createdAt));
  for (const o of shiftOrders) accumulateOrderInto(acc, o, ctx);

  const categories = categoriesOfAcc(acc);

  // المصروفات (كل حركة "out" من الدرج) بتتخصم من كاش الدرج بس، مش من المبيعات، وتتكتب بالتفصيل في التقرير
  let expenseMoves = [];
  if (shift) {
    expenseMoves = (shift.movements || []).filter((m) => m.type === "out");
  } else {
    const shiftDocs = await Shift.find({ $or: [{ status: "open" }, { closedAt: { $gt: fromD } }] }).select("movements").lean();
    for (const sd of shiftDocs) for (const m of sd.movements || []) if (m.type === "out" && new Date(m.at) > fromD && new Date(m.at) <= toD) expenseMoves.push(m);
  }
  const expenses = expenseMoves.map((m) => ({ reason: String(m.reason || ""), amount: Number(m.amount) || 0, by: m.by || "", at: m.at }));
  const expensesTotal = expenses.reduce((sum, e) => sum + e.amount, 0);

  const report = {
    from: fromD, to: toD, count: acc.count, total: acc.total, grossSales: acc.total, netSales: acc.total, expenses, expensesTotal, delivery: acc.delivery, discounts: acc.discounts, talabat: acc.talabat, talabatCash: acc.talabatCash, talabatVisa: acc.talabatVisa, driverCash: acc.driverCash,
    payments: acc.payments, byType: acc.byType, byCashier: acc.byCashier, cancelled: shiftCancelled.length,
    cancelledTotal: shiftCancelled.reduce((sum, order) => sum + (Number(order.grandTotal) || 0), 0),
    cancelledPrinted: shiftCancelled.filter((order) => order.cancelledAfterPrint).length,
    categories,
    orders: shiftOrders.map((o) => ({ id: o.orderId, total: (Number(o.grandTotal) || 0) - (o.orderType === "delivery" ? (Number(o.deliveryFee) || 0) : 0) }))
  };

  if (shift) {
    const moves = shift.movements || [];
    const cashIn = moves.filter((m) => m.type === "in").reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    const cashOut = moves.filter((m) => m.type === "out").reduce((sum, m) => sum + (Number(m.amount) || 0), 0);
    // أوردرات دليفري كاش خرجت مع السواق ولسه النقدية ما اتسلمتش (مش محسوبة في المبيعات ولا الدرج)
    const awaiting = await Order.find({ status: "accepted", awaitingCash: true }).select("orderId shiftReceiptNo driverName grandTotal deliveryFee paymentMethod paymentSplit").lean();
    const awaitingOrders = awaiting.map((o) => ({ id: o.orderId, no: o.shiftReceiptNo || null, driverName: o.driverName || "", amount: Math.max(0, cashPartOf(o) - (Number(o.deliveryFee) || 0)) }));
    Object.assign(report, {
      openedBy: shift.openedBy, openingCash: shift.openingCash || 0, movements: moves, cashIn, cashOut,
      awaitingOrders, awaitingTotal: awaitingOrders.reduce((sum, o) => sum + o.amount, 0),
      expectedCash: (shift.openingCash || 0) + (acc.payments.cash || 0) + cashIn - cashOut
    });
  }
  return report;
};

// ---------- تقارير المحاسب (قراءة بس — مفيش بيانات عملاء هنا، تجميعات بس) ----------
// نفس طلب الأوردرات ونفس قواعد الفلوس بتاعة buildReport بالظبط (أجرة التوصيل برّه المبيعات،
// الدفع المقسّم بيتوزّع على طرقه، طلبات إجماليها الكامل وكاش طلبات في الكاش)، عشان الأرقام تطابق تقرير المبيعات.
// كاش صغير في الذاكرة (30 ثانية): تبويب الأصناف وتبويب القنوات بيطلبوا نفس الفترة ورا بعض، فالمسح التقيل يتعمل مرة واحدة بس
const accountantSummaryCache = new Map();
// نفس ريجيكس محتويات البوكس اللي في buildReport ("2× كفتة") — عشان الجرد يطابق تقرير المطبخ
const BOX_CONTENT_RE = /^\s*(\d+)\s*×\s*(.+?)\s*$/;
// تجميع محتويات البوكس من تعديلات صنف في أوردر: "2× كفتة" × كمية الصنف
const addBoxContents = (contentsMap, rowKey, modifiers, qty) => {
  const mods = Array.isArray(modifiers) ? modifiers : [];
  for (const mod of mods) {
    const boxM = BOX_CONTENT_RE.exec(String(mod || ""));
    if (!boxM) continue;
    const cName = boxM[2].trim();
    const cQty = Number(boxM[1]) * qty;
    if (!cName || !cQty) continue;
    if (!contentsMap.has(rowKey)) contentsMap.set(rowKey, new Map());
    const cm = contentsMap.get(rowKey);
    cm.set(cName, (cm.get(cName) || 0) + cQty);
  }
};
const buildAccountantSummary = async (from, to, typeFilter = "all") => {
  const fromD = new Date(from), toD = new Date(to);
  const cacheKey = `${fromD.getTime()}|${toD.getTime()}|${typeFilter}`;
  const cacheHit = accountantSummaryCache.get(cacheKey);
  if (cacheHit && Date.now() - cacheHit.at < 30000) return cacheHit.data;
  const allOrders = await Order.find({
    $or: [
      { source: "pos", orderType: { $in: ["pickup", "talabat"] }, status: { $ne: "cancelled" }, createdAt: { $gt: fromD, $lte: toD } },
      { status: "completed", completedAt: { $gt: fromD, $lte: toD }, $or: [{ source: { $ne: "pos" } }, { source: "pos", orderType: "delivery" }] }
    ]
  }).select("grandTotal orderType deliveryFee discountAmount paymentMethod paymentSplit items").lean();
  const catalog = await Item.find().select("name category code").lean();
  const orders = typeFilter === "all" ? allOrders : allOrders.filter((o) => o.orderType === typeFilter);

  const channelOf = (key) => ({ key, label: key === "delivery" ? "توصيل" : key === "talabat" ? "طلبات" : "استلام", count: 0, total: 0, delivery: 0, discounts: 0, payments: {} });
  const channelsMap = new Map([["pickup", channelOf("pickup")], ["delivery", channelOf("delivery")], ["talabat", channelOf("talabat")]]);
  const totals = { count: 0, total: 0, delivery: 0, discounts: 0, payments: {}, talabat: 0, talabatCash: 0, talabatVisa: 0 };

  // تجميع الأصناف على الصنف الأساسي: الاسم زي ما هو، أو بعد شيل أقواس الأحجام/الأنواع من آخره،
  // أو أطول اسم صنف في الكتالوج بيبدأ بيه اسم الأوردر. البوكس نفسه هو الصنف المباع (مش محتوياته)،
  // والأنواع/الأحجام مش بتتفصل في سطور لوحدها هنا.
  const byName = new Map(catalog.map((i) => [i.name, i]));
  const stripTrailingParens = (n) => {
    let s = String(n || "").trim();
    for (;;) {
      const cut = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
      if (cut === s) return s;
      s = cut;
    }
  };
  const resolveBase = (rawName) => {
    const name = String(rawName || "صنف بدون اسم");
    if (byName.has(name)) return byName.get(name);
    const stripped = stripTrailingParens(name);
    if (byName.has(stripped)) return byName.get(stripped);
    let best = null;
    for (const item of catalog) {
      if (item.name && name.startsWith(item.name) && (!best || item.name.length > best.name.length)) best = item;
    }
    return best;
  };
  const itemRows = new Map();
  const contentsMap = new Map(); // مفتاح الصف ← (اسم المحتوى ← الكمية)
  const addItemRow = (base, qty, revenue) => {
    const key = base ? `cat:${base.name}` : `raw:${String(base?.name || "صنف بدون اسم")}`;
    const row = itemRows.get(key) || { code: base?.code ?? null, name: base?.name || String(base?.name || "صنف بدون اسم"), category: base?.category || "أخرى", qty: 0, total: 0 };
    row.qty += qty;
    row.total += revenue;
    itemRows.set(key, row);
    return key;
  };

  for (const o of orders) {
    const g = Number(o.grandTotal) || 0;
    const fee = o.orderType === "delivery" ? Math.min(g, Number(o.deliveryFee) || 0) : 0;
    const sale = g - fee;
    const disc = Number(o.discountAmount) || 0;
    totals.count += 1;
    totals.total += sale;
    totals.delivery += fee;
    totals.discounts += disc;
    const ch = channelsMap.get(o.orderType) || channelsMap.get("pickup");
    ch.count += 1;
    ch.total += sale;
    ch.delivery += fee;
    ch.discounts += disc;
    if (o.orderType === "talabat") {
      totals.talabat += g;
      if (o.paymentMethod === "cash") {
        totals.talabatCash += g;
        totals.payments.cash = (totals.payments.cash || 0) + g;
        ch.payments.cash = (ch.payments.cash || 0) + g;
      } else {
        totals.talabatVisa += g;
        // فيزا طلبات بتتحط في عمود الفيزا بتاع قناة طلبات عشان أعمدة الدفع في كل قناة تجمّع إجمالي القناة
        ch.payments.visa = (ch.payments.visa || 0) + g;
      }
    } else {
      const parts = splitOf(o) || [{ method: o.paymentMethod || "cash", amount: g }];
      for (const p of parts) {
        const amt = p.method === "cash" ? Math.max(0, p.amount - fee) : p.amount;
        totals.payments[p.method] = (totals.payments[p.method] || 0) + amt;
        ch.payments[p.method] = (ch.payments[p.method] || 0) + amt;
      }
    }
    for (const it of o.items || []) {
      const qty = Number(it.quantity) || 0;
      const revenue = (Number(it.price) || 0) * qty;
      const rowKey = addItemRow(resolveBase(it.name), qty, revenue);
      // محتويات البوكس ("2× كفتة" في التعديلات): بتتجمع تحت الصنف الأب عشان الجرد
      addBoxContents(contentsMap, rowKey, it.modifiers, qty);
    }
  }

  // أكواد محتويات البوكسات: كل محتوى ليه رمز ثابت من نطاق منفصل (2001..3000)
  const contentNames = [];
  for (const cm of contentsMap.values()) for (const n of cm.keys()) contentNames.push(n);
  const contentCodes = await ensureBoxContentCodes(contentNames);
  const items = [...itemRows.entries()].map(([rowKey, r]) => {
    const cm = contentsMap.get(rowKey);
    if (cm && cm.size) {
      r.contents = [...cm.entries()]
        .map(([name, qty]) => ({ code: contentCodes.get(name) ?? null, name, qty }))
        .sort((a, b) => b.qty - a.qty || String(a.name).localeCompare(String(b.name)));
    }
    return r;
  }).sort((a, b) => {
    if (a.code == null && b.code == null) return b.total - a.total || String(a.name).localeCompare(String(b.name));
    if (a.code == null) return 1;
    if (b.code == null) return -1;
    return a.code - b.code;
  });
  const channels = [...channelsMap.values()];
  const result = {
    from, to, type: typeFilter,
    totals,
    channels,
    items,
    itemsTotals: { qty: items.reduce((a, r) => a + r.qty, 0), total: items.reduce((a, r) => a + r.total, 0) }
  };
  accountantSummaryCache.set(cacheKey, { at: Date.now(), data: result });
  if (accountantSummaryCache.size > 20) accountantSummaryCache.delete(accountantSummaryCache.keys().next().value);
  return result;
};

// التقارير القديمة اتحفظت بصافي مبيعات = المبيعات − المصروفات. هنا بنصححها وقت القراءة بس (الداتابيز زي ما هي)
const normalizeShiftReport = (shiftDoc) => {
  const doc = shiftDoc?.toObject ? shiftDoc.toObject() : shiftDoc;
  if (!doc?.report) return doc;
  const r = doc.report;
  const gross = Number(r.grossSales ?? r.total ?? doc.total) || 0;
  return { ...doc, report: { ...r, grossSales: gross, netSales: gross } };
};

const redactCurrentShiftForCashier = (payload) => {
  if (!payload?.report) return payload;
  const report = { ...payload.report };
  delete report.expectedCash;
  delete report.openingCash;
  delete report.cashIn;
  delete report.cashOut;
  delete report.driverCash;
  delete report.movements;
  report.payments = { ...(report.payments || {}) };
  delete report.payments.cash;
  const shift = payload.shift ? { ...payload.shift } : payload.shift;
  if (shift) delete shift.openingCash;
  return { ...payload, shift, report };
};

// الشيفت المفتوح دلوقتي + تقرير X لحظي
app.get("/api/shifts/current", requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findOne({ status: "open", openedBy: req.user.name }).lean();
    if (!shift) {
      const pendingHandover = await Shift.findOne({ status: "closed", handoverTo: req.user.name, handoverStatus: "pending" }).sort({ closedAt: -1 }).lean();
      return res.json({ shift: null, pendingHandover: pendingHandover ? { shiftId: pendingHandover._id, from: pendingHandover.closedBy, amount: pendingHandover.handoverCash, closedAt: pendingHandover.closedAt } : null });
    }
    const payload = { shift, report: await buildReport(shift.openedAt, new Date(), shift) };
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/shifts/open", requireAuth, async (req, res) => {
  try {
    if (await Shift.findOne({ status: "open", openedBy: req.user.name })) return res.status(400).json({ error: "عندك وردية مفتوحة بالفعل" });
    const otherOpen = await Shift.findOne({ status: "open", openedBy: { $ne: req.user.name } }).select("openedBy openedAt").lean();
    if (otherOpen) return res.status(400).json({ error: `مينفعش تفتح وردية: ${otherOpen.openedBy} فاتح وردية لسه. لازم ${otherOpen.openedBy} يقفل ورديته الأول وبعدها تفتح إنت.` });

    const openingCash = clampNumber(req.body?.openingCash, 0, 10000000);
    const pendingHandover = await Shift.findOne({ status: "closed", handoverTo: req.user.name, handoverStatus: "pending" }).sort({ closedAt: -1 });
    if (pendingHandover) {
      const transferred = Number(pendingHandover.handoverCash) || 0;
      if (Math.abs(openingCash - transferred) > 0.009) return res.status(400).json({ error: `مبلغ الاستلام لازم يطابق النقدية المسلّمة (${transferred} ج.م)` });
      pendingHandover.handoverStatus = "accepted";
      pendingHandover.handoverAcceptedBy = req.user.name;
      pendingHandover.handoverAcceptedAt = new Date();
      await pendingHandover.save();
    }
    let shift;
    try {
      shift = await Shift.create({ status: "open", openedAt: new Date(), openedBy: req.user.name, openedById: String(req.user.id || ""), openingCash });
    } catch (e) {
      if (e?.code === 11000) return res.status(400).json({ error: "عندك وردية مفتوحة بالفعل" });
      throw e;
    }
    void sendTelegramAlert(`🟢 فتح وردية\nبواسطة: ${req.user.name}\nرصيد الافتتاح: ${openingCash} ج.م`);
    res.status(201).json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إيداع / مصروف من الدرج
app.post("/api/shifts/movement", requireAuth, async (req, res) => {
  try {
    const type = req.body?.type === "in" ? "in" : req.body?.type === "out" ? "out" : null;
    const amount = clampNumber(req.body?.amount, 0, 10000000);
    const reason = cleanText(req.body?.reason, 100);
    // السلفة: نوع مخصوص من حركات الدرج عشان تقرير الفترة يجمّعها بالاسم.
    // بتتحدد من الـ category اللي بيبعتها الكاشير، أو تلقائيًا لو السبب فيه كلمة "سلف".
    const wantsAdvance = String(req.body?.category || "").trim() === "advance";
    const reasonMentionsAdvance = /سلف/.test(reason);
    const movementCategory = type === "out" && (wantsAdvance || reasonMentionsAdvance) ? "advance" : "cash_movement";
    let advanceRecipient = cleanText(req.body?.recipient, 60);
    if (movementCategory === "advance" && !advanceRecipient) {
      // "سلفة أحمد" / "سلفة: أحمد" / "سلفة لـ أحمد" → نطلع الاسم من السبب نفسه
      const nameMatch = /سلف[ةه]?\s*(?:لـ?|:|-)?\s*(.+)$/.exec(reason);
      if (nameMatch && nameMatch[1].trim() && nameMatch[1].trim() !== reason) advanceRecipient = nameMatch[1].trim().slice(0, 60);
    }
    if (!type || amount <= 0) return res.status(400).json({ error: "اكتب مبلغ صحيح" });
    if (reason.length < 2) return res.status(400).json({ error: "اكتب السبب" });
    if (movementCategory === "advance" && advanceRecipient.length < 2) return res.status(400).json({ error: "اكتب اسم اللي خد السلفة (مثال: سلفة أحمد)" });
    // المصروف بيطلع من كاش الدرج بس: لو الدرج مفيهوش كاش كفاية (مثلاً كل الأوردرات انستا أو طلبات فيزا) نرفضه
    if (type === "out") {
      const openShift = await Shift.findOne({ status: "open", openedBy: req.user.name }).lean();
      if (!openShift) return res.status(400).json({ error: "مفيش شيفت مفتوح" });
      const drawer = await buildReport(openShift.openedAt, new Date(), openShift);
      const available = Math.round((Number(drawer.expectedCash) || 0) * 100) / 100;
      if (amount > available + 0.009) {
        return res.status(400).json({ error: `الدرج مفيهوش كاش كفاية. المتاح في الدرج دلوقتي ${available} ج بس` + " لو الفلوس موجودة فعلاً من برا الدرج سجّلها كإيداع الأول." });
      }
    }
    const movement = { type, amount, reason, by: req.user.name, at: new Date(), category: movementCategory };
    if (movementCategory === "advance" && advanceRecipient) movement.recipient = advanceRecipient;
    const shift = await Shift.findOneAndUpdate(
      { status: "open", openedBy: req.user.name },
      { $push: { movements: movement } },
      { new: true }
    );
    if (!shift) return res.status(400).json({ error: "مفيش شيفت مفتوح" });
    if (type === "out") void sendTelegramAlert(movementCategory === "advance" ? `💰 سلفة من الدرج\nالمبلغ: ${amount} ج.م\nلـ: ${advanceRecipient}\nالسبب: ${reason}\nبواسطة: ${req.user.name}` : `💸 مصروف من الدرج\nالمبلغ: ${amount} ج.م\nالسبب: ${reason}\nبواسطة: ${req.user.name}`);
    res.json(shift);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/shifts/close", requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findOne({ status: "open", openedBy: req.user.name });
    if (!shift) return res.status(400).json({ error: "مفيش وردية مفتوحة لحسابك" });
    const awaitingNow = await Order.find({ status: "accepted", awaitingCash: true }).select("orderId shiftReceiptNo driverName").lean();
    if (awaitingNow.length > 0) {
      const list = awaitingNow.map((o) => `#${o.shiftReceiptNo || o.orderId}${o.driverName ? ` (${o.driverName})` : ""}`).join("، ");
      return res.status(400).json({ error: `مينفعش تقفل الوردية: فيه ${awaitingNow.length} أوردر دليفري مع السواق ومستني النقدية: ${list}. استلم الفلوس من السواق الأول (أو ألغي الأوردر لو ماتسلّمش).` });
    }
    const now = new Date();
    const report = await buildReport(shift.openedAt, now, shift);
    const closeNotes = cleanText(req.body?.notes, 300);
    const closed = await Shift.findOneAndUpdate(
      { _id: shift._id, status: "open", openedBy: req.user.name },
      { $set: {
        status: "closed", closedAt: now, closedBy: req.user.name, from: shift.openedAt,
        count: report.count, total: report.total, delivery: report.delivery, payments: report.payments,
        talabat: report.talabat, discounts: report.discounts, cancelled: report.cancelled, orders: report.orders,
        report, expectedCash: report.expectedCash, notes: closeNotes, handoverTo: "", handoverStatus: "none"
      }, $unset: { countedCash: 1, difference: 1, handoverCash: 1 } },
      { new: true }
    );
    if (!closed) return res.status(409).json({ error: "الوردية اتقفلت قبل كده، حدّث الصفحة" });
    void sendTelegramAlert(`🔒 تقفيل وردية\nبواسطة: ${req.user.name}\nإجمالي المبيعات: ${Number(report.total) || 0} ج.م\nالمصروفات (من الدرج): ${Number(report.expensesTotal) || 0} ج.م\nالمتوقع في الدرج: ${Number(report.expectedCash) || 0} ج.م\nإجمالي الخصومات: ${Number(report.discounts) || 0} ج.م`);
    res.json(normalizeShiftReport(closed));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/shifts", requireAuth, async (req, res) => {
  try {
    // سجل الورديات المقفولة للأدمن فقط
    if (req.user?.role !== "admin") return res.json([]);
    const filter = { status: { $ne: "open" } };
    res.json((await Shift.find(filter).sort({ closedAt: -1 }).limit(60)).map(normalizeShiftReport));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تقرير اليوم: بيجمّع كل ورديات اليوم (الصبح والليل) في تقرير واحد.
// اليوم بيتحسب من وقت "فتح" الوردية بتوقيت القاهرة، فشيفت الليل اللي بيقفل 3 أو 5 الفجر بيتحسب على نفس اليوم.
const DAY_TZ = "Africa/Cairo";
const DAY_START_HOUR = 6;
const cairoYMDH = (date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DAY_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(date));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: g("year"), m: g("month"), d: g("day"), h: g("hour") % 24 };
};
const businessDayKey = (date) => {
  const { y, m, d, h } = cairoYMDH(date);
  return new Date(Date.UTC(y, m - 1, d - (h < DAY_START_HOUR ? 1 : 0))).toISOString().slice(0, 10);
};
const shiftDayLabel = (openedAt) => {
  const { h } = cairoYMDH(openedAt);
  return h >= DAY_START_HOUR && h < 18 ? "شيفت الصبح" : "شيفت الليل";
};

// بداية اليوم (6 الصبح بتوقيت القاهرة) كوقت حقيقي، بيشتغل صح مع التوقيت الصيفي والشتوي
const cairoDayStart = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  for (const off of [2, 3, 1, 0]) {
    const t = new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR - off));
    const c = cairoYMDH(t);
    if (c.y === y && c.m === m && c.d === d && c.h === DAY_START_HOUR) return t;
  }
  return new Date(Date.UTC(y, m - 1, d, DAY_START_HOUR - 2));
};
const addDaysKey = (key, days) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};
const dayWindow = (key) => ({ from: cairoDayStart(key), to: cairoDayStart(addDaysKey(key, 1)) });
const dayNum = (x) => Number(x) || 0;
const dayTotalsOf = (r) => {
  const talabat = dayNum(r.talabat), talabatCash = dayNum(r.talabatCash);
  return {
    count: dayNum(r.count), total: dayNum(r.grossSales ?? r.total), delivery: dayNum(r.delivery), discounts: dayNum(r.discounts),
    talabat, talabatCash, talabatVisa: r.talabatVisa !== undefined ? dayNum(r.talabatVisa) : Math.max(0, talabat - talabatCash),
    expensesTotal: dayNum(r.expensesTotal), cancelled: dayNum(r.cancelled), cancelledTotal: dayNum(r.cancelledTotal), payments: r.payments || {}
  };
};

// تقرير اليوم: كل أوردرات اليوم (من 6 الصبح لـ 6 الصبح) + تفصيل كل وردية.
// الإجمالي بيتحسب من الأوردرات نفسها، فلو في أوردرات اتعملت من غير وردية أو وردية عدّت من يوم للتاني، بتظهر ومش بتضيع.
// الكاشير يشوف النهارده بس، والأدمن يختار أي يوم
app.get("/api/reports/day", requireAuth, async (req, res) => {
  try {
    const todayKey = businessDayKey(new Date());
    const asked = String(req.query.date || "");
    const key = req.user?.role === "admin" && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : todayKey;
    if (isNaN(new Date(`${key}T00:00:00Z`).getTime())) return res.status(400).json({ error: "التاريخ غير صحيح" });
    const now = new Date();
    const { from: dayFrom, to: dayTo } = dayWindow(key);
    const upTo = dayTo > now ? now : dayTo;

    // كل وردية بتتحسب كاملة على اليوم اللي اتفتحت فيه (شيفت الليل اللي بيقفل بعد 6 الصبح بيفضل في يومه)
    const docs = await Shift.find({ openedAt: { $gte: dayFrom, $lt: dayTo } }).sort({ openedAt: 1 }).lean();
    const shifts = [];
    const seenShift = new Set();
    for (const s of docs) {
      const isOpen = s.status === "open";
      const endsAt = isOpen ? now : new Date(s.closedAt || now);
      const r = isOpen ? await buildReport(s.openedAt, now, s) : (s.report || await buildReport(s.openedAt, endsAt, s));
      const moves = s.movements || [];
      const cashIn = moves.filter((m) => m.type === "in").reduce((sum, m) => sum + dayNum(m.amount), 0);
      const cashOut = moves.filter((m) => m.type === "out").reduce((sum, m) => sum + dayNum(m.amount), 0);
      const t = dayTotalsOf({ ...r, count: r.count ?? s.count, total: r.grossSales ?? r.total ?? s.total, delivery: r.delivery ?? s.delivery, discounts: r.discounts ?? s.discounts, talabat: r.talabat ?? s.talabat, cancelled: r.cancelled ?? s.cancelled, expensesTotal: r.expensesTotal !== undefined ? r.expensesTotal : cashOut, payments: r.payments || s.payments });
      // نشيل الورديات الفاضية (وردية اتنسى تقفيلها من غير أوردرات ولا فلوس) والمكرر
      const empty = !t.count && !dayNum(t.total) && !cashIn && !cashOut && !dayNum(s.openingCash);
      const sig = `${s.openedBy}|${new Date(s.openedAt).getTime()}|${isOpen ? "open" : new Date(s.closedAt).getTime()}`;
      if (empty || seenShift.has(sig)) continue;
      seenShift.add(sig);
      shifts.push({
        id: String(s._id), label: shiftDayLabel(s.openedAt), openedBy: s.openedBy || "", closedBy: s.closedBy || "",
        openedAt: s.openedAt, closedAt: isOpen ? null : s.closedAt, isOpen, partial: false, ...t,
        openingCash: dayNum(s.openingCash), cashIn, cashOut, driverCash: dayNum(r.driverCash),
        expectedCash: dayNum(isOpen ? r.expectedCash : (s.expectedCash ?? r.expectedCash))
      });
    }

    // نجمّع الورديات في صف واحد لكل نوع: شيفت الصبح / شيفت الليل (لو أكتر من كاشير في نفس الشيفت بيتجمعوا)
    const merged = new Map();
    const numKeys = ["count", "total", "delivery", "discounts", "talabat", "talabatCash", "talabatVisa", "expensesTotal", "cancelled", "cancelledTotal", "cashIn", "cashOut", "driverCash"];
    for (const sh of shifts) {
      const m = merged.get(sh.label);
      if (!m) { merged.set(sh.label, { ...sh, payments: { ...(sh.payments || {}) }, names: [sh.openedBy], _open0: sh.openingCash, _net: sh.expectedCash - sh.openingCash }); continue; }
      for (const k of numKeys) m[k] = dayNum(m[k]) + dayNum(sh[k]);
      for (const [pk, pv] of Object.entries(sh.payments || {})) m.payments[pk] = (m.payments[pk] || 0) + dayNum(pv);
      m._net += sh.expectedCash - sh.openingCash;
      if (sh.openedBy && !m.names.includes(sh.openedBy)) m.names.push(sh.openedBy);
      if (new Date(sh.openedAt) < new Date(m.openedAt)) m.openedAt = sh.openedAt;
      m.isOpen = m.isOpen || sh.isOpen;
      m.closedAt = m.isOpen ? null : (new Date(sh.closedAt) > new Date(m.closedAt) ? sh.closedAt : m.closedAt);
    }
    shifts.length = 0;
    for (const m of merged.values()) {
      m.openedBy = m.names.join(" + ");
      m.openingCash = m._open0;
      m.expectedCash = dayNum(m._open0 + m._net);
      delete m._open0; delete m._net; delete m.names;
      shifts.push(m);
    }
    shifts.sort((a, b) => new Date(a.openedAt) - new Date(b.openedAt));
    const whole = await buildReport(dayFrom, upTo, null);
    // إجمالي اليوم من كل أوردرات اليوم نفسها (مش مجموع الورديات) عشان ما يتحسبش أوردر مرتين
    const totals = dayTotalsOf(whole);
    const sumTotal = shifts.reduce((a, x) => a + dayNum(x.total), 0), sumCount = shifts.reduce((a, x) => a + dayNum(x.count), 0);
    const outside = totals.total - sumTotal > 0.5 || totals.count - sumCount > 0
      ? { count: Math.max(0, totals.count - sumCount), total: Math.round((totals.total - sumTotal) * 100) / 100 } : null;
    res.json({ day: key, isToday: key === todayKey, generatedAt: now, from: dayFrom, to: upTo, shifts, totals, outside, categories: whole.categories || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// داش بورد اليوم (للأدمن فقط): كل أوردرات اليوم كله، مش وردية معينة
app.get("/api/reports/dashboard", requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const todayKey = businessDayKey(now);
    const asked = String(req.query.date || "");
    const key = /^\d{4}-\d{2}-\d{2}$/.test(asked) && !isNaN(new Date(`${asked}T00:00:00Z`).getTime()) ? asked : todayKey;
    const { from, to } = dayWindow(key);
    const upTo = to > now ? now : to;
    const prevKey = addDaysKey(key, -1);
    const pw = dayWindow(prevKey);
    const [r, pr, openShifts] = await Promise.all([
      buildReport(from, upTo, null),
      buildReport(pw.from, pw.to, null),
      Shift.find({ status: "open" }).select("openedBy openedAt").lean()
    ]);
    const items = [];
    for (const c of r.categories || []) for (const it of c.items || []) items.push({ name: it.name, qty: dayNum(it.qty), total: dayNum(it.total) });
    items.sort((a, b) => b.qty - a.qty);
    res.json({
      day: key, isToday: key === todayKey, from, to: upTo, generatedAt: now,
      totals: dayTotalsOf(r), byType: r.byType || {}, byCashier: r.byCashier || {},
      prev: { day: prevKey, count: dayNum(pr.count), total: dayNum(pr.grossSales ?? pr.total) },
      openShifts: openShifts.map((s) => ({ openedBy: s.openedBy, openedAt: s.openedAt })),
      topItems: items.slice(0, 6)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// تقرير فترة تفصيلي (يوم بيوم) + السلف — للأدمن فقط
// اليوم التجاري بيتحسب من 6 الصبح لـ 6 الصبح بتوقيت القاهرة (نفس منطق تقرير اليوم)،
// فشيفت الليل اللي بيقفل الفجر بيتحسب على يوم فتحه، والسلفة بتتحسب على يوم/وقت تسجيلها.
// السلفة = أي حركة "out" من الدرج متسجلة كـ category: "advance" أو السبب فيه كلمة "سلف"،
// فالسلف القديمة اللي اتكتبت في السبب بتظهر برضه من غير ما تحتاج تعديل.
// =========================
const ADVANCE_WORD_RE = /سلف/;
const periodMovementIsAdvance = (m) => m?.type === "out" && (m?.category === "advance" || ADVANCE_WORD_RE.test(String(m?.reason || "")));
const periodAdvancePerson = (m) => {
  const fromField = cleanText(m?.recipient || "", 60);
  if (fromField) return fromField;
  const reason = String(m?.reason || "").trim();
  const mm = /سلف[ةه]?\s*(?:لـ?|:|-)?\s*(.+)$/.exec(reason);
  const name = mm ? mm[1].trim() : "";
  return name && name !== reason ? name.slice(0, 60) : "غير محدد";
};
const periodNormalizeMovement = (m, shift) => ({
  at: m?.at || null,
  day: m?.at ? businessDayKey(m.at) : null,
  type: m?.type || "out",
  category: m?.category || "cash_movement",
  amount: Number(m?.amount) || 0,
  reason: String(m?.reason || ""),
  recipient: String(m?.recipient || ""),
  person: periodMovementIsAdvance(m) ? periodAdvancePerson(m) : "",
  by: m?.by || "",
  shiftBy: shift?.openedBy || "",
  shiftOpenedAt: shift?.openedAt || null,
  isAdvance: periodMovementIsAdvance(m)
});

// مفتاح اليوم التجاري لأي لحظة، بنفس حدود استعلامات buildReport بالظبط ($gt من بداية اليوم، $lte نهايته):
// أوردر متسجّل 6 الصبح بالظبط بيتحسب على اليوم اللي قبله، فبنرجّع مفتاح (اللحظة ناقص 1 مللي ثانية)
const dayKeyForInstant = (t) => businessDayKey(new Date(new Date(t).getTime() - 1));

// تقرير الفترة في مرور واحد على الداتابيز بدل مرور لكل يوم:
// استعلام واحد للأوردرات + واحد للملغي + واحد للكتالوج، وبعدين كل أوردر بيتحط في يومه
// (أوردرات الكاشير استلام/طلبات بيوم إنشائها، والدليفري والأونلاين بيوم إتمامها — زي فرعين استعلام buildReport بالظبط)
const buildPeriodDays = async (fromKey, toKey) => {
  const { from: periodFrom } = dayWindow(fromKey);
  const { to: periodTo } = dayWindow(toKey);
  const now = new Date();
  const toD = periodTo > now ? now : periodTo; // زي زمان: آخر يوم بيتقفل على دلوقتي مش على 6 الصبح بتاع بكره
  const [orders, cancelledList, catalog] = await Promise.all([
    Order.find({
      $or: [
        { source: "pos", orderType: { $in: ["pickup", "talabat"] }, status: { $ne: "cancelled" }, createdAt: { $gt: periodFrom, $lte: toD } },
        { status: "completed", completedAt: { $gt: periodFrom, $lte: toD }, $or: [{ source: { $ne: "pos" } }, { source: "pos", orderType: "delivery" }] }
      ]
    }).select("orderId grandTotal orderType deliveryFee discountAmount paymentMethod paymentSplit source createdBy completedBy createdAt completedAt status items").lean(),
    Order.find({ status: "cancelled", cancelledAt: { $gt: periodFrom, $lte: toD } }).select("grandTotal orderId cancelledAfterPrint cancelledBy").lean(),
    Item.find().select("name category modifierGroups sizes addons").lean()
  ]);
  const ctx = { catOf: new Map(catalog.map((i) => [i.name, i.category])), itemByName: new Map(catalog.map((i) => [i.name, i])) };
  const keys = [];
  for (let k = fromKey; ; k = addDaysKey(k, 1)) { keys.push(k); if (k === toKey) break; }
  const slots = new Map(keys.map((k) => [k, { acc: newOrderAcc(), cancelled: 0, cancelledTotal: 0 }]));
  orders.sort((a, b) => new Date(a.completedAt || a.createdAt) - new Date(b.completedAt || b.createdAt));
  for (const o of orders) {
    const ts = (o.source === "pos" && (o.orderType === "pickup" || o.orderType === "talabat") && o.status !== "cancelled") ? o.createdAt : o.completedAt;
    if (!ts) continue;
    const slot = slots.get(dayKeyForInstant(ts));
    if (!slot) continue;
    accumulateOrderInto(slot.acc, o, ctx);
  }
  for (const c of cancelledList) {
    if (!c.cancelledAt) continue;
    const slot = slots.get(dayKeyForInstant(c.cancelledAt));
    if (!slot) continue;
    slot.cancelled += 1;
    slot.cancelledTotal += Number(c.grandTotal) || 0;
  }
  return keys.map((key) => {
    const slot = slots.get(key);
    const a = slot.acc;
    return {
      date: key, count: a.count, total: a.total, delivery: a.delivery, discounts: a.discounts,
      talabat: a.talabat, talabatCash: a.talabatCash, talabatVisa: a.talabatVisa,
      cancelled: slot.cancelled, cancelledTotal: slot.cancelledTotal,
      payments: a.payments, categories: categoriesOfAcc(a)
    };
  });
};

const handlePeriodReport = async (req, res) => {
  try {
    const fromKey = String(req.query.from || "");
    const toKey = String(req.query.to || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
      return res.status(400).json({ error: "اختار تاريخ البداية والنهاية" });
    }
    const fromD0 = new Date(`${fromKey}T00:00:00Z`);
    const toD0 = new Date(`${toKey}T00:00:00Z`);
    if (isNaN(fromD0) || isNaN(toD0) || toD0 < fromD0) return res.status(400).json({ error: "الفترة غير صحيحة" });
    const spanDays = Math.round((toD0 - fromD0) / 86400000) + 1;
    if (spanDays > 92) return res.status(400).json({ error: "الفترة أقصاها 92 يوم، قسّمها على فترتين" });

    const keys = [];
    for (let k = fromKey; ; k = addDaysKey(k, 1)) { keys.push(k); if (k === toKey) break; }
    const now = new Date();
    const { from: periodFrom } = dayWindow(fromKey);
    const { to: periodTo } = dayWindow(toKey);

    // الورديات اللي اتفتحت في الفترة (زائد اللي اتفتحت قبلها بيومين) عشان حركات الدرج اللي اتسجلت جوّه الفترة ماتضيعش
    const shiftDocs = await Shift.find({ openedAt: { $gte: new Date(periodFrom.getTime() - 2 * 86400000), $lt: periodTo } }).sort({ openedAt: 1 }).lean();
    const allMovements = [];
    const shiftSummaries = [];
    for (const s of shiftDocs) {
      const moves = (s.movements || []).map((m) => periodNormalizeMovement(m, s)).filter((m) => m.at && new Date(m.at) >= periodFrom && new Date(m.at) < periodTo);
      allMovements.push(...moves);
      const dayKey = businessDayKey(s.openedAt);
      if (dayKey < fromKey || dayKey > toKey) continue; // وردية من قبل الفترة: حركاتها بس اللي تتحسب
      const r = s.report || {};
      const cashIn = (s.movements || []).filter((m) => m.type === "in").reduce((a, m) => a + (Number(m.amount) || 0), 0);
      const cashOut = (s.movements || []).filter((m) => m.type === "out").reduce((a, m) => a + (Number(m.amount) || 0), 0);
      shiftSummaries.push({
        id: String(s._id), day: dayKey, label: shiftDayLabel(s.openedAt),
        openedBy: s.openedBy || "", closedBy: s.closedBy || "", status: s.status,
        openedAt: s.openedAt, closedAt: s.status === "open" ? null : (s.closedAt || null),
        count: Number(r.count ?? s.count) || 0,
        total: Number(r.grossSales ?? r.total ?? s.total) || 0,
        openingCash: Number(s.openingCash) || 0, cashIn, cashOut,
        expectedCash: s.status === "open" ? null : (Number(s.expectedCash ?? r.expectedCash) || 0),
        advancesTotal: moves.filter((m) => m.isAdvance).reduce((a, m) => a + m.amount, 0),
        expensesTotal: moves.filter((m) => m.type === "out").reduce((a, m) => a + m.amount, 0),
        notes: s.notes || ""
      });
    }
    allMovements.sort((a, b) => new Date(a.at) - new Date(b.at));

    const periodDays = await buildPeriodDays(fromKey, toKey);
    const days = [];
    for (const pd of periodDays) {
      const key = pd.date;
      const { from: dayFrom, to: dayTo } = dayWindow(key);
      const upTo = dayTo > now ? now : dayTo;
      const t = pd;
      const dayMoves = allMovements.filter((m) => m.day === key);
      const advances = dayMoves.filter((m) => m.isAdvance);
      const expenses = dayMoves.filter((m) => m.type === "out");
      const deposits = dayMoves.filter((m) => m.type === "in");
      days.push({
        date: key,
        from: dayFrom, to: upTo,
        count: t.count, total: t.total, delivery: t.delivery, discounts: t.discounts,
        talabat: t.talabat, talabatCash: t.talabatCash, talabatVisa: t.talabatVisa,
        cancelled: t.cancelled, cancelledTotal: t.cancelledTotal,
        payments: t.payments || {},
        advances, advancesTotal: advances.reduce((a, m) => a + m.amount, 0), advancesCount: advances.length,
        expenses, expensesTotal: expenses.reduce((a, m) => a + m.amount, 0),
        otherExpensesTotal: expenses.reduce((a, m) => a + (m.isAdvance ? 0 : m.amount), 0),
        deposits, depositsTotal: deposits.reduce((a, m) => a + m.amount, 0),
        shifts: shiftSummaries.filter((s) => s.day === key),
        categories: pd.categories || []
      });
    }

    const advancesAll = allMovements.filter((m) => m.isAdvance);
    const byPersonMap = new Map();
    for (const a of advancesAll) {
      const row = byPersonMap.get(a.person) || { person: a.person, count: 0, total: 0, lastAt: null };
      row.count += 1; row.total += a.amount;
      if (!row.lastAt || new Date(a.at) > new Date(row.lastAt)) row.lastAt = a.at;
      byPersonMap.set(a.person, row);
    }
    const advancesByPerson = [...byPersonMap.values()].sort((a, b) => b.total - a.total);
    const payments = {};
    for (const d of days) for (const [k, v] of Object.entries(d.payments || {})) payments[k] = (payments[k] || 0) + (Number(v) || 0);
    const sum = (k) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);
    res.json({
      from: fromKey, to: toKey, daysCount: spanDays, generatedAt: now,
      totals: {
        count: sum("count"), total: sum("total"), delivery: sum("delivery"), discounts: sum("discounts"),
        talabat: sum("talabat"), talabatCash: sum("talabatCash"), talabatVisa: sum("talabatVisa"),
        cancelled: sum("cancelled"), cancelledTotal: sum("cancelledTotal"),
        payments, advancesTotal: sum("advancesTotal"), advancesCount: sum("advancesCount"),
        expensesTotal: sum("expensesTotal"), otherExpensesTotal: sum("otherExpensesTotal"), depositsTotal: sum("depositsTotal")
      },
      advances: advancesAll, advancesByPerson,
      expenses: allMovements.filter((m) => m.type === "out"),
      shifts: shiftSummaries, days
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
app.get("/api/reports/period", requireAuth, requireAdmin, handlePeriodReport);
app.get("/api/accountant/reports/period", requireAccountant, handlePeriodReport);

// ---------- راوتات المحاسب (تجميعات بس — مفيش أسماء ولا تليفونات ولا عناوين عملاء) ----------
const validateAccountantPeriod = (req, res) => {
  const fromKey = String(req.query.from || "");
  const toKey = String(req.query.to || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey) || !/^\d{4}-\d{2}-\d{2}$/.test(toKey)) {
    res.status(400).json({ error: "اختار تاريخ البداية والنهاية" });
    return null;
  }
  const fromD0 = new Date(`${fromKey}T00:00:00Z`);
  const toD0 = new Date(`${toKey}T00:00:00Z`);
  if (isNaN(fromD0) || isNaN(toD0) || toD0 < fromD0) {
    res.status(400).json({ error: "الفترة غير صحيحة" });
    return null;
  }
  const spanDays = Math.round((toD0 - fromD0) / 86400000) + 1;
  if (spanDays > 92) {
    res.status(400).json({ error: "الفترة أقصاها 92 يوم، قسّمها على فترتين" });
    return null;
  }
  const { from: periodFrom } = dayWindow(fromKey);
  const { to: periodTo } = dayWindow(toKey);
  return { fromKey, toKey, periodFrom, periodTo };
};

app.get("/api/accountant/reports/summary", requireAccountant, async (req, res) => {
  try {
    const p = validateAccountantPeriod(req, res);
    if (!p) return;
    const s = await buildAccountantSummary(p.periodFrom, p.periodTo, "all");
    res.json({ ...s, from: p.fromKey, to: p.toKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/accountant/reports/items", requireAccountant, async (req, res) => {
  try {
    const p = validateAccountantPeriod(req, res);
    if (!p) return;
    await ensureItemCodes(); // أي صنف جديد من غير رمز ياخد رقمه قبل ما يطلع في التقرير
    const type = ["pickup", "delivery", "talabat"].includes(String(req.query.type || "")) ? String(req.query.type) : "all";
    const s = await buildAccountantSummary(p.periodFrom, p.periodTo, type);
    res.json({ from: p.fromKey, to: p.toKey, type, items: s.items, itemsTotals: s.itemsTotals, totals: { count: s.totals.count, total: s.totals.total, discounts: s.totals.discounts } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// دليل الأصناف والأكواد للمحاسب: كل الأصناف حتى اللي متباعش — مرجع بس، من غير فترة
app.get("/api/accountant/reports/catalog", requireAccountant, async (req, res) => {
  try {
    await ensureItemCodes(); // أي صنف جديد من غير رمز ياخد رقمه قبل ما يطلع في الدليل
    const items = await Item.find().select("code name category price available").sort({ code: 1, _id: 1 }).lean();
    items.sort((a, b) => (a.code == null ? 1 : b.code == null ? -1 : Number(a.code) - Number(b.code)));
    const boxContents = await BoxContent.find().select("code name").sort({ code: 1, _id: 1 }).lean();
    boxContents.sort((a, b) => (a.code == null ? 1 : b.code == null ? -1 : Number(a.code) - Number(b.code)));
    res.json({
      items: items.map((i) => ({ code: i.code ?? null, name: i.name, category: i.category, price: Number(i.price) || 0, available: i.available !== false })),
      boxContents: boxContents.map((c) => ({ code: c.code ?? null, name: c.name }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// تقرير فترة (يوم كامل) - للأدمن
app.get("/api/reports/range", requireAuth, requireAdmin, async (req, res) => {
  try {
    const from = new Date(String(req.query.from)), to = new Date(String(req.query.to));
    if (isNaN(from) || isNaN(to) || to <= from || to - from > 40 * 86400000) return res.status(400).json({ error: "الفترة غير صحيحة" });
    res.json(await buildReport(from, to, null));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (req, res) => {
  const dbOk = mongoose.connection.readyState === 1;
  res.status(dbOk ? 200 : 503).json({
    ok: dbOk, database: dbOk ? "connected" : "disconnected", auth: authReady ? "ready" : "not-configured"
  });
});

// =========================
// SERVER STARTUP
// =========================
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;

process.on("unhandledRejection", (err) => console.error("⚠️ unhandledRejection:", err));
mongoose.connection.on("disconnected", () => console.error("❌ اتصال MongoDB انقطع"));
mongoose.connection.on("error", (err) => console.error("❌ MongoDB error:", err.message));

const removeLegacyAdminAccounts = async () => {
  try {
    const result = await Staff.deleteMany({ role: "admin" });
    if (result.deletedCount > 0) console.log(`🧹 اتمسح ${result.deletedCount} حساب أدمن قديم`);
  } catch (err) {}
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// لو كاشير اتفتحله وردية مرتين (دوسة مكررة): ندمجهم في وردية واحدة (المصروفات والأوردرات بتتنقل للأساسية) ونمسح المكررة
const mergeDuplicateOpenShifts = async () => {
  try {
    const opens = await Shift.find({ status: "open" }).sort({ openedAt: 1 });
    const byUser = new Map();
    for (const sh of opens) {
      const k = sh.openedBy || "";
      if (!byUser.has(k)) byUser.set(k, []);
      byUser.get(k).push(sh);
    }
    for (const [user, list] of byUser) {
      if (list.length < 2) continue;
      list.sort((a, b) => (b.movements?.length || 0) - (a.movements?.length || 0) || new Date(a.openedAt) - new Date(b.openedAt));
      const primary = list[0];
      for (const dup of list.slice(1)) {
        console.log("🧹 دمج وردية مكررة:", JSON.stringify(dup));
        for (const m of dup.movements || []) primary.movements.push(m);
        primary.markModified("movements");
        primary.receiptSeq = Math.max(primary.receiptSeq || 0, dup.receiptSeq || 0);
        if (!primary.openingCash && dup.openingCash) primary.openingCash = dup.openingCash;
        await Order.updateMany({ shiftId: dup._id }, { $set: { shiftId: primary._id } });
        await Shift.deleteOne({ _id: dup._id });
      }
      await primary.save();
      void sendTelegramAlert(`🧹 اتدمجت ${list.length - 1} وردية مكررة للكاشير ${user} في وردية واحدة`);
    }
    await Shift.createIndexes();
  } catch (err) {
    console.error("mergeDuplicateOpenShifts failed:", err.message);
  }
};

// وردية نسيها الكاشير مفتوحة: أي وردية فاتحة من قبل بداية اليوم (6 الصبح) بتتقفل تلقائي على 6 الصبح بتقريرها،
// فلما الكاشير يجي الصبح يفتح وردية جديدة نضيفة ومفيش لخبطة بين اليومين.
const autoCloseForgottenShifts = async () => {
  try {
    const now = new Date();
    const dayStart = cairoDayStart(businessDayKey(now));
    const stale = await Shift.find({ status: "open", openedAt: { $lt: dayStart } });
    for (const shift of stale) {
      const report = await buildReport(shift.openedAt, dayStart, shift);
      const note = "اتقفلت تلقائي الساعة 6 الصبح لأن الكاشير نسي يقفلها";
      const closed = await Shift.findOneAndUpdate(
        { _id: shift._id, status: "open" },
        { $set: {
          status: "closed", closedAt: dayStart, closedBy: "تقفيل تلقائي", from: shift.openedAt, autoClosed: true,
          count: report.count, total: report.total, delivery: report.delivery, payments: report.payments,
          talabat: report.talabat, discounts: report.discounts, cancelled: report.cancelled, orders: report.orders,
          report, expectedCash: report.expectedCash, notes: note, handoverTo: "", handoverStatus: "none"
        }, $unset: { countedCash: 1, difference: 1, handoverCash: 1 } },
        { new: true }
      );
      if (closed) {
        console.log(`🔒 تقفيل تلقائي لوردية ${shift.openedBy}`);
        void sendTelegramAlert(`⚠️ وردية ${shift.openedBy} اتقفلت تلقائي (نسي يقفلها)\nالمبيعات: ${Number(report.total) || 0} ج.م\nالمصروفات (من الدرج): ${Number(report.expensesTotal) || 0} ج.م\nالمتوقع في الدرج: ${Number(report.expectedCash) || 0} ج.م\nراجع الدرج الفعلي مع الكاشير`);
      }
    }
  } catch (err) {
    console.error("autoCloseForgottenShifts failed:", err.message);
  }
};
setInterval(autoCloseForgottenShifts, 5 * 60 * 1000);

const connectToDatabase = async () => {
  while (true) {
    try {
      await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
      console.log("✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح");
      await removeLegacyAdminAccounts();
      await autoCloseForgottenShifts();
      await mergeDuplicateOpenShifts();
      // رموز الأصناف للمحاسب: أي صنف من غير رمز ياخد الرقم اللي بعده
      void ensureItemCodes().catch((e) => console.error("ensureItemCodes failed:", e.message));
      return;
    } catch (err) {
      console.error("❌ فشل الاتصال بقاعدة البيانات، هحاول تاني بعد 5 ثواني:", err.message);
      await sleep(5000);
    }
  }
};

if (!MONGO_URI) {
  console.error("❌ MONGO_URI غير موجود في Environment Variables على Railway");
  process.exit(1);
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
});
//1234
connectToDatabase();