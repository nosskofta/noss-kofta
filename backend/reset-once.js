// تصفير الأوردرات والورديات مرة واحدة (مع نسخة احتياطية جوه نفس قاعدة البيانات).
// بيشتغل بس لو في Railway متغير اسمه RESET_TOKEN قيمته بالشكل ده: RESET-2026-11-01
// ومش بيتكرر: لو نفس التوكن اتنفذ قبل كده بيتجاهله. بعد ما يخلص امسح المتغير من Railway.
// مش بيلمس: الأصناف، الأقسام، الصور، مناطق التوصيل، الإعدادات، الكاشيرات.
import mongoose from 'mongoose';

const TARGETS = [
  { name: 'orders', filter: {}, label: 'الأوردرات' },
  { name: 'shifts', filter: {}, label: 'الورديات' },
  { name: 'counters', filter: { key: 'pos' }, label: 'عداد أرقام أوردرات الكاشير' }
];

export const runReset = async (db, token, log = console.log) => {
  const resets = db.collection('_resets');
  const already = await resets.findOne({ token });
  if (already) {
    log(`ℹ️ التصفير ${token} اتنفذ قبل كده. امسح RESET_TOKEN من Railway.`);
    return { skipped: true };
  }
  const stamp = token.replace('RESET-', '').replace(/-/g, '');
  const summary = {};

  // 1) نسخة احتياطية الأول، ولو أي نسخة مطلعتش مظبوطة بنوقف من غير ما نمسح حاجة
  for (const t of TARGETS) {
    const count = await db.collection(t.name).countDocuments(t.filter);
    summary[t.name] = count;
    if (count === 0) continue;
    const backupName = `${t.name}_backup_${stamp}`;
    await db.collection(t.name).aggregate([{ $match: t.filter }, { $out: backupName }]).toArray();
    const backedUp = await db.collection(backupName).countDocuments({});
    if (backedUp !== count) throw new Error(`النسخة الاحتياطية لـ ${t.name} ناقصة (${backedUp}/${count}) — اتوقف التصفير`);
    log(`💾 نسخة احتياطية: ${backupName} (${count})`);
  }

  // 2) المسح
  for (const t of TARGETS) {
    if (!summary[t.name]) continue;
    const r = await db.collection(t.name).deleteMany(t.filter);
    log(`🧹 اتمسح ${r.deletedCount} من ${t.label}`);
  }

  // 3) علامة إن التصفير ده اتعمل (عشان ما يتكررش لو السيرفر عمل ريستارت)
  await resets.insertOne({ token, at: new Date(), deleted: summary });
  log(`✅ التصفير خلص. أول أوردر كاشير هيبقى P1 وأول وردية إيصالها رقم 1. امسح RESET_TOKEN من Railway.`);
  return { skipped: false, summary };
};

const token = String(process.env.RESET_TOKEN || '').trim();
let started = false;
const start = async () => {
  if (started) return;
  started = true;
  try { await runReset(mongoose.connection.db, token); }
  catch (err) { console.error('❌ التصفير فشل ومفيش حاجة اتمسحت:', err.message); }
};
if (token) {
  if (!/^RESET-\d{4}-\d{2}-\d{2}$/.test(token)) {
    console.error('⚠️ RESET_TOKEN شكله غلط. لازم يبقى زي: RESET-2026-11-01');
  } else if (mongoose.connection.readyState === 1) {
    start();
  } else {
    mongoose.connection.once('connected', start);
  }
}