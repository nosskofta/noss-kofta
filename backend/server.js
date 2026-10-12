import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();

// =========================
// CORS
// =========================
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// =========================
// Category Schema
// =========================
const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  order: {
    type: Number,
    default: 0
  }
});

const Category = mongoose.model("Category", categorySchema);

// =========================
// Item Schema
// =========================
const itemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  price: {
    type: Number,
    required: true
  },
  discount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  image: {
    type: String
  },
  description: {
    type: String
  },
  extras: {
    type: String
  },
  category: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: "normal"
  },
  maxItems: {
    type: Number
  },
  isOffer: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  },
  addons: [
    {
      name: String,
      price: Number
    }
  ],
  boxItems: [
    {
      name: String
    }
  ],
  sizes: [
    {
      name: String,
      price: Number
    }
  ]
});

const Item = mongoose.model("Item", itemSchema);

// =========================
// Delivery Zones
// =========================
const zoneSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  fee: {
    type: Number,
    required: true
  }
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
  heroTitleAr: {
    type: String,
    default: "أقوى العروض 🔥"
  },
  heroTitleEn: {
    type: String,
    default: "Strongest Offers 🔥"
  },
  logoImage: {
    type: String,
    default: ""
  },
  promoBannerImage: {
    type: String,
    default: ""
  }
});

const Settings = mongoose.model("Settings", settingsSchema);

// =========================
// Orders (شاشة الكاشير)
// =========================
const orderSchema = new mongoose.Schema({
  orderId: { type: String, required: true, unique: true },
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
  completedAt: { type: Date }
});

const Order = mongoose.model("Order", orderSchema);

// =========================
// AUTH (الكاشير / الأدمن)
// =========================
const AUTH_SECRET = process.env.AUTH_SECRET || "change-me-please";

const staffSchema = new mongoose.Schema({
  name: { type: String, required: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["cashier", "admin"], default: "cashier" },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const Staff = mongoose.model("Staff", staffSchema);

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  try {
    if (typeof stored !== "string") return false;
    const [salt, hash] = stored.split(":");
    if (!salt || !hash || !/^[0-9a-f]{128}$/i.test(hash)) return false;
    const expected = Buffer.from(hash, "hex");
    const test = crypto.scryptSync(String(password), salt, 64);
    return expected.length === test.length && crypto.timingSafeEqual(expected, test);
  } catch {
    return false;
  }
};

const signToken = (payload) => {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + 12 * 60 * 60 * 1000 })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
};

const verifyToken = (token) => {
  try {
    const [body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", AUTH_SECRET).update(body).digest("base64url");
    if (
      !sig ||
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

// دالة إنشاء الأدمن التلقائية
async function seedAdmin() {
  try {
    const username = "admin";
    const password = "123456";

    const existingAdmin = await Staff.findOne({ username });
    
    if (existingAdmin) {
      // لا تغيّر كلمة المرور في كل Restart/Deploy حتى لا تتعطل حسابات الإدارة.
      console.log("ℹ️ حساب الأدمن موجود بالفعل؛ تم الحفاظ على بياناته.");
    } else {
      await Staff.create({
        name: "المدير",
        username,
        password: hashPassword(password),
        role: "admin",
        active: true
      });
      console.log("✅ تم إنشاء حساب الأدمن الجديد بنجاح (الباسورد: 123456)");
    }
  } catch (err) {
    console.error("❌ خطأ في سكريبت الأدمن:", err);
  }
}

// =========================
// MongoDB Connection
// =========================
const MONGO_URI = process.env.MONGO_URI;
// Middlewares
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return res.status(401).json({ error: "غير مصرح" });

    const user = await Staff.findById(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: "الحساب غير مفعل" });

    req.user = user;
    next();
  } catch (err) {
    res.status(401).json({ error: "غير مصرح" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "للأدمن فقط" });
  }
  next();
};

// تسجيل الدخول
app.post("/api/auth/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").toLowerCase().trim();
    const password = String(req.body.password || "");

    const user = await Staff.findOne({ username });
    if (!user || !user.active || !verifyPassword(password, user.password)) {
      return res.status(401).json({ error: "اليوزر أو الباسورد غلط" });
    }

    const token = signToken({ id: user._id });
    res.json({
      token,
      user: { id: user._id, name: user.name, username: user.username, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// إدارة الموظفين
app.get("/api/staff", requireAuth, requireAdmin, async (req, res) => {
  try {
    const staff = await Staff.find().select("-password").sort({ createdAt: 1 });
    res.json(staff);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/staff", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!name || !username || !password || String(password).length < 4) {
      return res.status(400).json({ error: "الاسم واليوزر والباسورد مطلوبين" });
    }
    const created = await Staff.create({
      name: String(name).trim(),
      username: String(username).trim(),
      password: hashPassword(String(password)),
      role: "cashier"
    });
    res.status(201).json({
      _id: created._id,
      name: created.name,
      username: created.username,
      role: created.role,
      active: created.active
    });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: "اليوزر ده موجود قبل كده" });
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/staff/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const update = {};
    if (req.body.password) {
      update.password = hashPassword(String(req.body.password));
    }
    if (typeof req.body.active === "boolean") {
      update.active = req.body.active;
    }
    if (req.body.name) update.name = String(req.body.name).trim();

    const updated = await Staff.findByIdAndUpdate(req.params.id, update, { new: true }).select("-password");
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/staff/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await Staff.findByIdAndDelete(req.params.id);
    res.json({ message: "تم المسح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SETTINGS & ZONES & CATEGORIES & ITEMS & ORDERS ROUTES (كما هي)
app.get("/api/settings", async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      settings.heroImage = req.body.heroImage || settings.heroImage;
      settings.heroTitleAr = req.body.heroTitleAr || settings.heroTitleAr;
      settings.heroTitleEn = req.body.heroTitleEn || settings.heroTitleEn;
      settings.logoImage = req.body.logoImage !== undefined ? req.body.logoImage : settings.logoImage;
      settings.promoBannerImage = req.body.promoBannerImage !== undefined ? req.body.promoBannerImage : settings.promoBannerImage;
    }
    await settings.save();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/zones", async (req, res) => {
  try {
    const zones = await DeliveryZone.find();
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/zones", async (req, res) => {
  try {
    const newZone = new DeliveryZone(req.body);
    const savedZone = await newZone.save();
    res.json(savedZone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/zones/:id", async (req, res) => {
  try {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح المنطقة بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/categories", async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1, _id: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/categories", async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const newCat = new Category({ ...req.body, order: count });
    const savedCat = await newCat.save();
    res.json(savedCat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/categories/:id", async (req, res) => {
  try {
    const updatedCat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    res.json(updatedCat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:id", async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح القسم بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/items", async (req, res) => {
  try {
    const items = await Item.find().sort({ order: 1, _id: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/items", async (req, res) => {
  try {
    const count = await Item.countDocuments({ category: req.body.category });
    const discountValue = Number(req.body.discount) || 0;
    const newItem = new Item({
      ...req.body,
      price: Number(req.body.price),
      discount: discountValue,
      maxItems: req.body.maxItems ? Number(req.body.maxItems) : undefined,
      isOffer: Boolean(req.body.isOffer),
      order: count,
      addons: req.body.addons || [],
      boxItems: req.body.boxItems || [],
      sizes: req.body.sizes || []
    });
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/items/:id", async (req, res) => {
  try {
    const discountValue = Number(req.body.discount) || 0;
    const updateData = { ...req.body, price: Number(req.body.price), discount: discountValue };
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true, runValidators: true });
    if (!updatedItem) return res.status(404).json({ error: "الصنف غير موجود" });
    res.json(updatedItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/items/:id", async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح الصنف بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    const savedOrder = await newOrder.save();
    res.status(201).json(savedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/orders/:id", requireAuth, async (req, res) => {
  try {
    const query = mongoose.Types.ObjectId.isValid(req.params.id)
      ? { $or: [{ _id: req.params.id }, { orderId: req.params.id }] }
      : { orderId: req.params.id };

    const update = { status: req.body.status };
    if (req.body.status === "accepted") {
      update.acceptedBy = req.user.name;
      update.acceptedAt = new Date();
    }
    if (req.body.status === "completed") {
      update.completedBy = req.user.name;
      update.completedAt = new Date();
    }

    if (!req.body.status || !["pending", "accepted", "completed"].includes(req.body.status)) {
      return res.status(400).json({ error: "حالة الأوردر غير صحيحة" });
    }
    const updatedOrder = await Order.findOneAndUpdate(query, update, { new: true });
    if (!updatedOrder) return res.status(404).json({ error: "الأوردر غير موجود" });
    res.json(updatedOrder);
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

// فحص سريع لمعرفة هل الـ API وقاعدة البيانات شغالين
app.get("/api/health", (req, res) => {
  res.status(mongoose.connection.readyState === 1 ? 200 : 503).json({
    ok: mongoose.connection.readyState === 1,
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

// =========================
// SERVER + DATABASE STARTUP
// =========================
const PORT = process.env.PORT || 5000;

async function startServer() {
  if (!MONGO_URI) {
    console.error("❌ MONGO_URI غير موجود في Environment Variables على Railway");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 15000,
    });

    console.log("✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح");

    mongoose.connection.on("disconnected", () => {
      console.error("❌ اتصال MongoDB انقطع");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB error:", err.message);
    });

    await seedAdmin();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
    });
  } catch (err) {
    console.error("❌ فشل الاتصال بقاعدة بيانات MongoDB:", err.message);
    process.exit(1);
  }
}

startServer();