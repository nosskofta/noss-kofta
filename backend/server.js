import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// 🚨 إعدادات الـ CORS الشاملة والنهائية 🚨
const corsOptions = {
  origin: ['https://noss-kofta.vercel.app', 'http://localhost:5173'], // السماح لموقعك فقط
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200 // حل سحري لبعض المتصفحات
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // الرد التلقائي على طلبات الاستكشاف (Preflight)

const MONGO_URI = "mongodb+srv://noskoftaeg_db_user:F6I5ieUXbGcBiEEt@cluster0.5zgvg7b.mongodb.net/?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI)
  .then(() => console.log("🔥 تم الاتصال بقاعدة البيانات MongoDB بنجاح!"))
  .catch((err) => console.log("❌ خطأ في الاتصال:", err));

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  order: { type: Number, default: 0 }
});
const Category = mongoose.model('Category', categorySchema);

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String },
  description: { type: String },
  extras: { type: String },
  category: { type: String, required: true },
  type: { type: String, default: 'normal' },
  maxItems: { type: Number },
  isOffer: { type: Boolean, default: false },
  order: { type: Number, default: 0 },
  addons: [{ name: String, price: Number }],
  boxItems: [{ name: String }],
  sizes: [{ name: String, price: Number }]
});
const Item = mongoose.model('Item', itemSchema);

// جدول مناطق التوصيل وأسعارها
const zoneSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fee: { type: Number, required: true }
});
const DeliveryZone = mongoose.model('DeliveryZone', zoneSchema);

const settingsSchema = new mongoose.Schema({
  heroImage: { type: String, default: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=1920&auto=format&fit=crop' },
  heroTitleAr: { type: String, default: 'أقوى العروض 🔥' },
  heroTitleEn: { type: String, default: 'Strongest Offers 🔥' },
  logoImage: { type: String, default: '' },
  promoBannerImage: { type: String, default: '' }
});
const Settings = mongoose.model('Settings', settingsSchema);

// إعدادات الموقع
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) { settings = await Settings.create({}); }
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/settings', async (req, res) => {
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// مناطق التوصيل
app.get('/api/zones', async (req, res) => {
  try {
    const zones = await DeliveryZone.find();
    res.json(zones);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/zones', async (req, res) => {
  try {
    const newZone = new DeliveryZone(req.body);
    const savedZone = await newZone.save();
    res.json(savedZone);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/zones/:id', async (req, res) => {
  try {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح المنطقة بنجاح" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// الأقسام
app.get('/api/categories', async (req, res) => {
  try {
    const cats = await Category.find().sort({ order: 1, _id: 1 });
    res.json(cats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/categories', async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const newCat = new Category({ ...req.body, order: count });
    const savedCat = await newCat.save();
    res.json(savedCat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const updatedCat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedCat);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح القسم بنجاح" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// الأصناف
app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ order: 1, _id: 1 });
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/items', async (req, res) => {
  try {
    const count = await Item.countDocuments({ category: req.body.category });
    const newItem = new Item({ ...req.body, order: count });
    const savedItem = await newItem.save();
    res.json(savedItem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const updatedItem = await Item.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedItem);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح الصنف بنجاح" });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
});