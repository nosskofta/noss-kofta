import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(cors());

// MongoDB
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error("❌ MONGO_URI غير موجود في Environment Variables");
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log("🔥 تم الاتصال بقاعدة البيانات MongoDB بنجاح!");

    // إضافة discount = 0 تلقائيًا للأصناف القديمة
    // التي لا تحتوي على حقل discount
    try {
      const result = await Item.updateMany(
        { discount: { $exists: false } },
        { $set: { discount: 0 } }
      );

      console.log(
        `✅ تم تحديث ${result.modifiedCount} صنف وإضافة discount = 0`
      );
    } catch (err) {
      console.log("❌ خطأ في تحديث الخصومات القديمة:", err);
    }
  })
  .catch((err) => {
    console.log("❌ خطأ في الاتصال:", err);
  });

// =========================
// Categories
// =========================

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  order: { type: Number, default: 0 }
});

const Category = mongoose.model('Category', categorySchema);

// =========================
// Items
// =========================

const itemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  discount: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  image: { type: String },
  description: { type: String },
  extras: { type: String },
  category: {
    type: String,
    required: true
  },
  type: {
    type: String,
    default: 'normal'
  },
  maxItems: { type: Number },
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
}, { strict: false }); 

const Item = mongoose.model('Item', itemSchema);

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

const DeliveryZone = mongoose.model('DeliveryZone', zoneSchema);

// =========================
// Settings
// =========================

const settingsSchema = new mongoose.Schema({
  heroImage: {
    type: String,
    default:
      'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?q=80&w=1920&auto=format&fit=crop'
  },
  heroTitleAr: {
    type: String,
    default: 'أقوى العروض 🔥'
  },
  heroTitleEn: {
    type: String,
    default: 'Strongest Offers 🔥'
  },
  logoImage: {
    type: String,
    default: ''
  },
  promoBannerImage: {
    type: String,
    default: ''
  }
});

const Settings = mongoose.model('Settings', settingsSchema);


// =========================
// 🔴 إضافة نظام الأوردرات (Cashier Dashboard) 🔴
// =========================
const orderSchema = new mongoose.Schema({
  orderId: String,
  customerName: String,
  customerPhone: String,
  customerAddress: String,
  orderType: String,
  zoneName: String,
  deliveryFee: Number,
  items: Array,
  itemsTotal: Number,
  grandTotal: Number,
  status: { type: String, default: 'جديد' }, // جديد, جاري التجهيز, دليفري, تم التسليم, ملغي
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.model('Order', orderSchema);

// مسار استقبال أوردر جديد
app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    const savedOrder = await newOrder.save();
    res.status(201).json(savedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسار جلب الأوردرات للكاشير
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// مسار تحديث حالة الأوردر
app.put('/api/orders/:id/status', async (req, res) => {
  try {
    const updatedOrder = await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(updatedOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ====================================================

// =========================
// Settings Routes
// =========================

app.get('/api/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();

    if (!settings) {
      settings = await Settings.create({});
    }

    res.json(settings);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
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
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// =========================
// Delivery Zones Routes
// =========================

app.get('/api/zones', async (req, res) => {
  try {
    const zones = await DeliveryZone.find();
    res.json(zones);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/zones', async (req, res) => {
  try {
    const newZone = new DeliveryZone(req.body);
    const savedZone = await newZone.save();
    res.json(savedZone);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/zones/:id', async (req, res) => {
  try {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح المنطقة بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// Categories Routes
// =========================

app.get('/api/categories', async (req, res) => {
  try {
    const cats = await Category
      .find()
      .sort({ order: 1, _id: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const count = await Category.countDocuments();
    const newCat = new Category({ ...req.body, order: count });
    const savedCat = await newCat.save();
    res.json(savedCat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const updatedCat = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updatedCat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح القسم بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// Items Routes
// =========================

app.get('/api/items', async (req, res) => {
  try {
    const items = await Item.find().sort({ order: 1, _id: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/items', async (req, res) => {
  try {
    const count = await Item.countDocuments({ category: req.body.category });
    const newItem = new Item({
      ...req.body,
      price: Number(req.body.price),
      discount: Number(req.body.discount) || 0,
      order: count
    });
    const savedItem = await newItem.save();
    console.log(`✅ Item created: ${savedItem.name} | discount: ${savedItem.discount}%`);
    res.json(savedItem);
  } catch (err) {
    console.error("❌ Create item error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/items/:id', async (req, res) => {
  try {
    const updatedItem = await Item.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        price: Number(req.body.price),
        discount: Number(req.body.discount) || 0
      },
      { new: true, runValidators: true }
    );
    console.log(`✅ Item updated: ${updatedItem.name} | discount: ${updatedItem.discount}%`);
    res.json(updatedItem);
  } catch (err) {
    console.error("❌ Update item error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/items/:id', async (req, res) => {
  try {
    await Item.findByIdAndDelete(req.params.id);
    res.json({ message: "تم مسح الصنف بنجاح" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// Start Server
// =========================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 السيرفر شغال على البورت ${PORT}`);
});