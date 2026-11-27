// النسخة الاحتياطية اليومية لقاعدة البيانات.
// السيرفر نفسه (Railway) مبيحتفظش بنسخة لأن الديسك بتاعه مش ثابت —
// النسختين هما: التليجرام (تلقائي يومي من الكرون + عند الطلب من الأدمن)
// والكمبيوتر (تحميل يدوي من الأدمن بزر "نزّل نسخة على الكمبيوتر").
// من غير أي مكتبة جديدة: الـ dump بيتعمل من اتصال mongoose الموجود،
// والإرسال للتليجرام بـ fetch/FormData/Blob الأصليين في Node.
import mongoose from 'mongoose';

// يوم الشغل (6 الصبح بتوقيت القاهرة) — نفس قاعدة السيرفر
const businessDayKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(date));
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  const y = g('year'), m = g('month'), d = g('day'), h = g('hour') % 24;
  return new Date(Date.UTC(y, m - 1, d - (h < 6 ? 1 : 0))).toISOString().slice(0, 10);
};

// بيفرّغ كل الكوليكشنز من اتصال mongoose: { day, collections: { name: { count, docs: [...] } } }
export const buildBackupPayload = async (mg = mongoose) => {
  const db = mg?.connection?.db;
  if (!db) throw new Error('قاعدة البيانات مش متصلة');
  const day = businessDayKey(new Date());
  const cols = await db.listCollections().toArray();
  const collections = {};
  for (const c of cols) {
    const name = c.name;
    if (name.startsWith('system.')) continue;
    const docs = await db.collection(name).find({}).toArray();
    collections[name] = { count: docs.length, docs };
  }
  return { day, collections };
};

const sendBackupToTelegram = async (json, filename, day) => {
  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!token || !chatId) return false;
  try {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', `💾 نسخة احتياطية — ${day}`);
    form.append('document', new Blob([json], { type: 'application/json' }), filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
    if (!res.ok) console.error('Backup Telegram failed:', res.status);
    return res.ok;
  } catch (err) {
    console.error('Backup Telegram error:', err.message);
    return false;
  }
};

// POST /api/admin/backup — بيعمل الـ dump ويبعته للتليجرام كملف
export const backupHandler = async (req, res) => {
  try {
    const payload = await buildBackupPayload(mongoose);
    const json = JSON.stringify(payload);
    const filename = `backup-${payload.day}.json`;
    const telegramSent = await sendBackupToTelegram(json, filename, payload.day);
    const collections = Object.fromEntries(Object.entries(payload.collections).map(([k, v]) => [k, v.count]));
    res.json({ ok: true, day: payload.day, collections, bytes: Buffer.byteLength(json), telegramSent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /api/admin/backup/download — بيرجع نفس الـ dump كملف للتحميل على الكمبيوتر (أدمن فقط)
export const backupDownloadHandler = async (req, res) => {
  try {
    const payload = await buildBackupPayload(mongoose);
    const json = JSON.stringify(payload, null, 2);
    const filename = `backup-${payload.day}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(json);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
