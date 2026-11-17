require('dotenv').config();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// حط رابط الداتا بيز بتاعك هنا لو مش موجود في ملف .env
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://noskoftaeg_db_user:NOSSkofta2026@cluster0.5zgvg7b.mongodb.net/?appName=Cluster0";

const itemSchema = new mongoose.Schema({
  name: String,
  price: Number,
  image: String,
  description: String,
  extras: String,
  category: String,
  available: Boolean,
  order: Number,
  addons: [{ name: String, price: Number }],
  sizes: [{ name: String, price: Number }],
  modifierGroups: [
    {
      name: String,
      options: [{ name: String, price: Number }]
    }
  ]
});
const Item = mongoose.model("Item", itemSchema);

async function exportMenu() {
  try {
    console.log("⏳ جاري الاتصال بالداتا بيز...");
    await mongoose.connect(MONGO_URI);
    
    const items = await Item.find({}).sort({ category: 1, order: 1 });
    console.log(`✅ تم سحب ${items.length} صنف. جاري تجهيز ملف الإكسيل بالصور...`);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Menu');

    // نفس أعمدة شيت بريدفاست + عمود للصورة
    sheet.columns = [
      { header: 'category', key: 'category', width: 20 },
      { header: 'item', key: 'item', width: 25 },
      { header: 'description', key: 'description', width: 35 },
      { header: 'size', key: 'size', width: 15 },
      { header: 'price', key: 'price', width: 12 },
      { header: 'add', key: 'add', width: 40 },
      { header: 'image', key: 'image', width: 18 }
    ];

    // تنسيق الهيدر باللون الأخضر زي شيت بريدفاست
    sheet.getRow(1).eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F7942' } };
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    });

    let currentRow = 2;

    for (const item of items) {
      // تجميع كل الإضافات (القديمة والجديدة) في نص واحد واضح
      let addonsList = [];
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach(a => addonsList.push(`${a.name} (${a.price} ج)`));
      }
      if (item.modifierGroups && item.modifierGroups.length > 0) {
        item.modifierGroups.forEach(g => {
          const opts = g.options.map(o => `${o.name}: ${o.price} ج`).join(' | ');
          addonsList.push(`[${g.name}: ${opts}]`);
        });
      }
      if (item.extras) addonsList.push(item.extras);
      const addText = addonsList.join(' - ');

      // لو الصنف ليه أحجام متعددة، يتعمل لكل حجم صف لوحده بنفس الصورة والبيانات
      const variations = (item.sizes && item.sizes.length > 0)
        ? item.sizes.map(s => ({ size: s.name, price: s.price }))
        : [{ size: 'عادي', price: item.price }];

      // تحميل الصورة مرة واحدة للصنف
      let imageId = null;
      if (item.image) {
        try {
          if (item.image.startsWith('http')) {
            const response = await axios.get(item.image, { responseType: 'arraybuffer', timeout: 10000 });
            const ext = item.image.toLowerCase().includes('.png') ? 'png' : 'jpeg';
            imageId = workbook.addImage({ buffer: response.data, extension: ext });
          } else if (item.image.startsWith('data:image')) {
            const ext = item.image.includes('png') ? 'png' : 'jpeg';
            const base64Data = item.image.split(',')[1];
            imageId = workbook.addImage({ base64: base64Data, extension: ext });
          } else {
            const localPath = path.join(__dirname, item.image.replace(/^\//, ''));
            if (fs.existsSync(localPath)) {
              const ext = localPath.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
              imageId = workbook.addImage({ filename: localPath, extension: ext });
            }
          }
        } catch (imgErr) {
          console.log(`⚠️ تعذر تحميل صورة الصنف: ${item.name}`);
        }
      }

      for (const v of variations) {
        const row = sheet.getRow(currentRow);
        row.values = {
          category: item.category || '',
          item: item.name || '',
          description: item.description || '',
          size: v.size,
          price: v.price,
          add: addText
        };
        row.alignment = { vertical: 'middle', wrapText: true };

        if (imageId !== null) {
          row.height = 80; // توسيع ارتفاع الصف عشان الصورة تبان واضحة
          sheet.addImage(imageId, {
            tl: { col: 6, row: currentRow - 1 }, // عمود G (العمود السابع)
            ext: { width: 95, height: 95 }
          });
        } else {
          row.height = 25;
        }

        currentRow++;
      }
    }

    const fileName = 'Noss_Kofta_Breadfast_Menu.xlsx';
    await workbook.xlsx.writeFile(fileName);
    console.log(`🎉 تم بنجاح! الملف جاهز باسم: ${fileName}`);
    process.exit(0);
  } catch (err) {
    console.error("❌ حصل خطأ:", err);
    process.exit(1);
  }
}

exportMenu();