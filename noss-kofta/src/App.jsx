import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';

const API_BASE = 'https://noss-kofta-production-d57f.up.railway.app';
const RESTAURANT_NAME = 'نص كفتة';
const OTHER_API_BASE = 'https://bahbah-backend-production-7ef2.up.railway.app';
const OTHER_RESTAURANT_NAME = 'بحبح برجر';
const RESTAURANT_PHONE = '01042258982';
const WHATSAPP_NUMBER = '201042258982';

// ================= الدخول والجلسات (كاشير / أدمن) =================
const SESSION_KEY = 'cashierSession';

const readSession = () => {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
  catch { return null; }
};
const saveSession = (session) => {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch {}
};
const clearSession = () => {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
};

// ================= جلسة العميل (حساب «طلباتي») — مفتاح منفصل تماماً عن جلسة الكاشير =================
const CUSTOMER_KEY = 'nossKoftaCustomer';
const readCustomer = () => {
  try { return JSON.parse(localStorage.getItem(CUSTOMER_KEY)) || null; }
  catch { return null; }
};
const saveCustomer = (data) => {
  try { localStorage.setItem(CUSTOMER_KEY, JSON.stringify(data)); } catch {}
};
const clearCustomer = () => {
  try { localStorage.removeItem(CUSTOMER_KEY); } catch {}
};

// ================= توكن شات الضيوف — مفتاح منفصل عن جلسة الكاشير وحساب العميل =================
const CHAT_KEY = 'nossKoftaChat';
const readChatIdentity = () => {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY)) || null; }
  catch { return null; }
};
const saveChatIdentity = (data) => {
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(data)); } catch {}
};
const clearChatIdentity = () => {
  try { localStorage.removeItem(CHAT_KEY); } catch {}
};

// ================= سلة العميل — بتتحفظ في المتصفح وبترجع لما الصفحة تتفتح تاني =================
const CUSTOMER_CART_KEY = 'noss-kofta-cart-v1';
const readCustomerCart = () => {
  try {
    const raw = localStorage.getItem(CUSTOMER_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((line) => line && typeof line === 'object' && typeof line._id === 'string' && line._id.length > 0 && typeof line.name === 'string' && typeof line.price === 'number');
  } catch { return []; }
};
const saveCustomerCart = (cart) => {
  try { localStorage.setItem(CUSTOMER_CART_KEY, JSON.stringify(cart)); } catch {}
};
const clearCustomerCart = () => {
  try { localStorage.removeItem(CUSTOMER_CART_KEY); } catch {}
};

// أرقام الموبايل المصري — زي بحبح: تطبيع (أرقام عربي و+20) + فحص إنه رقم موبايل حقيقي
const normalizePhoneDigits = (v) => String(v || '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\D/g, '');
const normalizeEgPhoneInput = (v) => {
  let d = normalizePhoneDigits(v);
  if (d.startsWith('0020')) d = '0' + d.slice(4);
  else if (d.startsWith('20') && d.length >= 12) d = '0' + d.slice(2);
  return d.slice(0, 11);
};
const isEgMobile = (p) => /^01[0125]\d{8}$/.test(p);
const isFakeEgPhone = (p) => {
  if (!isEgMobile(p)) return false;
  const tail = p.slice(3);
  return /^(\d)\1+$/.test(tail) || /(\d)\1{6,}/.test(p) || '01234567890123456789'.includes(tail) || '98765432109876543210'.includes(tail) || /^(\d{2})\1{3}$/.test(tail) || /^(\d{4})\1$/.test(tail);
};

// صوت تنبيه الشات عند العميل (بيشتغل بعد أول تفاعل مع الصفحة — قيد المتصفح)
let chatAudioCtx = null;
const unlockChatAudio = () => {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!chatAudioCtx) chatAudioCtx = new AudioCtx();
    if (chatAudioCtx.state === 'suspended') chatAudioCtx.resume();
  } catch {}
};
// صوت رسايل الشات — مختلف تماماً عن جرس الأوردرات: نغمتان سريعتان صاعدتان
// (دو6 ثم صول6) بموجة triangle وصوت أهدى ومدة أقصر، عشان اللي يسمعه يعرف
// إن دي رسالة مش أوردر. نفس الصوت عند العميل وعند الكاشير.
const playChatSound = (ctx) => {
  try {
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const chime = (start, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    };
    chime(0, 1046.5); chime(0.14, 1568);
  } catch {}
};
const chatTime = (v) => (v ? new Date(v).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '');

// طلب للسيرفر ومعاه التوكن. لو السيرفر رد "غير مصرح" بنقفل الجلسة ونرجّع لشاشة الدخول.
const authRequest = async (token, path, options = {}, onUnauthorized) => {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  if (res.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new Error('unauthorized');
  }
  return res;
};

const loginRequest = async (username, password) => {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error(data.error || 'بيانات الدخول غلط!');
  return data;
};

// شاشة تسجيل الدخول (بتتستخدم للكاشير ولوحة الإدارة)
const StaffLogin = ({ title, onLogin, onBeforeSubmit, requireAdmin = false }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (onBeforeSubmit) onBeforeSubmit(); // لازم يتنفذ فوراً مع الضغطة (عشان الصوت)
    setError('');
    setLoading(true);
    try {
      const data = await loginRequest(username, password);
      if (requireAdmin && data.user?.role !== 'admin') {
        setError('الحساب ده مش أدمن، ادخل بحساب الأدمن.');
        return;
      }
      setPassword('');
      onLogin(data);
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'مشكلة في الاتصال بالسيرفر' : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#12080A] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[#1C0D10] border border-[#800020] p-8 rounded-2xl w-full max-w-md shadow-2xl text-center">
        <h2 className="text-2xl font-black text-[#FFD700] mb-6">{title}</h2>
        <input
          type="text"
          placeholder="اسم المستخدم"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoComplete="username"
          className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-center mb-4 text-lg"
        />
        <input
          type="password"
          placeholder="كلمة المرور"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-center mb-4 text-lg tracking-widest"
        />
        {error && <p className="text-red-400 text-sm font-bold mb-4">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-[#800020] text-white font-bold py-3 rounded-xl hover:bg-[#990026] transition shadow disabled:opacity-60">
          {loading ? 'جاري الدخول...' : 'دخول النظام'}
        </button>
      </form>
    </div>
  );
};

const translations = {
  ar: {
    home: "الرئيسية",
    menu: "المنيو",
    cart: "السلة",
    admin: "لوحة الإدارة",
    all: "الكل",
    orderNow: "اطلب دلوقتي",
    ourMenu: "المنيو بتاعنا",
    bestOffers: "أفضل العروض",
    seeMore: "رؤية المزيد ➔",
    hotlineText: "الخط الساخن",
    rights: "جميع الحقوق محفوظة © 2026 نص كفتة",
    addToCart: "أضف للسلة",
    customizeBox: "شكل البوكس بمزاجك ⚙️",
    details: "عرض التفاصيل والطلب",
    emptyCart: "السلة فارغة",
    backToMenu: "ارجع للمنيو واختار أكلتك",
    total: "الإجمالي:",
    whatsappOrder: "📲 ابعت الطلب واتساب",
    delete: "مسح",
    edit: "تعديل",
    save: "حفظ",
    cancel: "إلغاء",
    addItem: "➕ إضافة صنف جديد",
    addCat: "➕ إضافة قسم",
    catManage: "📁 إدارة وتنسيق أقسام المنيو",
    itemManage: "🍔 إدارة وترتيب أصناف المنيو",
    siteSettings: "🖼️ تحكم في لوجو الموقع وواجهة الرئيسية",
  },
  en: {
    home: "Home",
    menu: "Menu",
    cart: "Cart",
    admin: "Admin",
    all: "All",
    orderNow: "Order Now",
    ourMenu: "Our Menu",
    bestOffers: "Best Offers",
    seeMore: "See More ➔",
    hotlineText: "HOTLINE",
    addToCart: "Add to Cart",
    customizeBox: "Customize Box ⚙️",
    details: "View Details & Order",
    emptyCart: "Cart is Empty",
    backToMenu: "Back to menu to choose your meal",
    total: "Total:",
    whatsappOrder: "📲 Send Order via WhatsApp",
    delete: "Delete",
    edit: "Edit",
    save: "Save",
    cancel: "Cancel",
    addItem: "➕ Add New Item",
    addCat: "➕ Add Category",
    catManage: "📁 Manage & Reorder Menu Categories",
    itemManage: "🍔 Manage & Reorder Menu Items",
    siteSettings: "🖼️ Control Website Logo & Hero",
  }
};

const getDiscountedPrice = (price, discountPercent) => {
  if (!discountPercent || discountPercent <= 0) return price;
  return Math.round(price * (1 - discountPercent / 100));
};

// Meta Pixel (الـ Pixel نفسه متركّب في index.html) — أي حدث هنا محمي:
// لو fbq مش موجود (أدبلوك أو لسه محمّلش) مبيحصلش حاجة ومفيش خطأ
const trackFbq = (event, params) => {
  try { if (typeof window !== 'undefined' && window.fbq) window.fbq('track', event, params || {}); } catch (e) {}
};

// UTM بتاع مصدر الإعلان: بيتسجل من أول زيارة في الـ session وبيتبعت مع الأوردر
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const captureUtmParams = () => {
  try {
    const params = new URLSearchParams(window.location.search);
    UTM_KEYS.forEach((k) => { const v = params.get(k); if (v) sessionStorage.setItem('nk_utm_' + k, v); });
  } catch (e) {}
};
const getStoredUtm = () => {
  const out = {};
  try {
    const map = { utm_source: 'utmSource', utm_medium: 'utmMedium', utm_campaign: 'utmCampaign', utm_content: 'utmContent', utm_term: 'utmTerm' };
    UTM_KEYS.forEach((k) => { const v = sessionStorage.getItem('nk_utm_' + k); if (v) out[map[k]] = v; });
  } catch (e) {}
  return out;
};

// أقل سعر متاح للصنف (للأصناف اللي سعرها الأساسي 0 وبتتسعر بالاختيارات — زي المشويات بالكيلو).
// بياخد أقل سعر من الاختيارات الإجبارية (الحجم/الوزن) وبيطبق خصم المنيو عليه زي باقي الأسعار.
// الإضافات الاختيارية مش محسوبة هنا لأنها زيادة فوق السعر مش سعر البداية.
const minOptionPrice = (item, applyDiscount = true) => {
  if (!item) return 0;
  const prices = [];
  const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];
  if (groups.length > 0) {
    const required = groups.filter((g) => Number(g?.min) >= 1);
    const src = required.length > 0 ? required : groups;
    src.forEach((g) => (Array.isArray(g?.options) ? g.options : []).forEach((o) => { const p = Number(o?.price); if (p > 0) prices.push(p); }));
  } else if (Array.isArray(item.sizes)) {
    item.sizes.forEach((s) => { const p = Number(s?.price); if (p > 0) prices.push(p); });
  }
  if (prices.length === 0) return 0;
  const min = Math.min(...prices);
  return applyDiscount ? getDiscountedPrice(min, item.discount) : min;
};

// سعر الصنف في كارت المنيو: لو السعر الأساسي 0 بس فيه اختيارات بأسعار، يعرض "من X ج" بدل "0 ج"
const MenuPrice = ({ item }) => {
  const base = Number(item?.price) || 0;
  const min = minOptionPrice(item);
  if (base <= 0 && min > 0) {
    if (Number(item?.discount) > 0) {
      return (<>
        <span className="text-zinc-400 line-through text-xs font-bold">من {minOptionPrice(item, false)} ج</span>
        <span className="text-[#FFD700] text-lg font-black">من {min} ج</span>
      </>);
    }
    return <span className="text-[#FFD700] text-lg font-black">من {min} ج</span>;
  }
  if (Number(item?.discount) > 0) {
    return (<>
      <span className="text-zinc-400 line-through text-xs font-bold">{item.price} ج</span>
      <span className="text-[#FFD700] text-lg font-black">{getDiscountedPrice(item.price, item.discount)} ج</span>
    </>);
  }
  return <span className="text-[#FFD700] text-lg font-black">{item.price} ج</span>;
};

// نص الخصم على الأوردر: نسبة % (مع المبلغ) أو مبلغ ثابت بالجنيه — الأوردرات القديمة من غير نوع بتتعرض نسبة زي الأول
const discountLabel = (o) => (o.discountType === 'amount' ? `${Number(o.discountAmount) || 0} ج` : `${Number(o.discountPercent) || 0}% (${Number(o.discountAmount) || 0} ج)`);

// ================= مواعيد الطلب (فتح / قفل) =================
const fmtTime = (hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'م' : 'ص'}`;
};

const useStoreStatus = () => {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/store-status`, { cache: 'no-store' });
        const d = await r.json();
        if (alive) setStatus(d);
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 60000);
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  return status;
};

const StoreClosedBanner = ({ status }) => {
  if (!status || status.isOpen) return null;
  return (
    <div className="bg-gradient-to-l from-[#800020] via-[#990026] to-[#800020] text-[#FFD700] text-center px-4 py-2.5 text-sm md:text-base font-black leading-relaxed">
      🌙 {status.message}
      {status.mode === 'auto' && <span className="block md:inline md:mr-3 text-white/85 font-bold text-xs md:text-sm">مواعيد الطلب: {fmtTime(status.openTime)} – {fmtTime(status.closeTime)}</span>}
    </div>
  );
};

// زراير سريعة في شاشة الكاشير
const StoreToggle = ({ authFetch }) => {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try { const r = await fetch(`${API_BASE}/api/store-status`, { cache: 'no-store' }); const d = await r.json(); if (alive) setSt(d); } catch (e) {}
    };
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const setMode = async (mode) => {
    if (busy || st?.mode === mode) return;
    const msgs = { open: 'تفتح استقبال الأوردرات دلوقتي؟', closed: 'تقفل استقبال الأوردرات من الموقع دلوقتي؟', auto: 'ترجّعه تلقائي حسب المواعيد؟' };
    if (!window.confirm(msgs[mode])) return;
    setBusy(true);
    try {
      const r = await authFetch('/api/store-mode', { method: 'PUT', body: JSON.stringify({ mode }) });
      const d = await r.json();
      if (r.ok) setSt(d); else alert(d.error || 'حصل خطأ');
    } catch (e) {}
    setBusy(false);
  };

  if (!st) return null;
  const btn = (mode, label, on) => (
    <button type="button" disabled={busy} onClick={() => setMode(mode)} className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${st.mode === mode ? on : 'bg-[#12080A] text-zinc-400 hover:text-white'}`}>{label}</button>
  );
  return (
    <div className="flex items-center gap-1 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-1">
      <span className={`px-3 py-1.5 rounded-lg text-xs font-black text-white ${st.isOpen ? 'bg-green-600' : 'bg-red-600'}`}>{st.isOpen ? '🟢 الموقع مفتوح' : '🔴 الموقع مقفول'}</span>
      {btn('open', 'فتح', 'bg-green-700 text-white')}
      {btn('closed', 'قفل', 'bg-red-700 text-white')}
      {btn('auto', '⏰ تلقائي', 'bg-[#800020] text-white')}
    </div>
  );
};

// لوحة الأدمن: المواعيد ورسالة القفل
const StoreHoursPanel = ({ adminFetch }) => {
  const [st, setSt] = useState(null);
  const [openTime, setOpenTime] = useState('12:00');
  const [closeTime, setCloseTime] = useState('03:00');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/store-status`, { cache: 'no-store' });
        const d = await r.json();
        setSt(d); setOpenTime(d.openTime); setCloseTime(d.closeTime); setMessage(d.customMessage || '');
      } catch (e) {}
    })();
  }, []);

  const setMode = async (mode) => {
    setBusy(true);
    try {
      const r = await adminFetch('/api/store-mode', { method: 'PUT', body: JSON.stringify({ mode }) });
      const d = await r.json();
      if (r.ok) setSt(d); else alert(d.error || 'حصل خطأ');
    } catch (e) {}
    setBusy(false);
  };

  const saveHours = async () => {
    setBusy(true);
    try {
      const r = await adminFetch('/api/store-hours', { method: 'PUT', body: JSON.stringify({ openTime, closeTime, closedMessage: message }) });
      const d = await r.json();
      if (r.ok) { setSt(d); alert('تم حفظ المواعيد ✅'); } else alert(d.error || 'حصل خطأ');
    } catch (e) {}
    setBusy(false);
  };

  const modeBtn = (mode, label, on) => (
    <button type="button" disabled={busy} onClick={() => setMode(mode)} className={`flex-1 py-3 rounded-2xl font-black text-sm border transition ${st?.mode === mode ? on : 'bg-[#12080A] text-zinc-400 border-[#3A1218] hover:border-zinc-500'}`}>{label}</button>
  );

  return (
    <div className="bg-[#1C0D10] p-8 rounded-[2.5rem] border border-[#800020]/40 mb-8 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-xl font-bold text-[#FFD700]">⏰ مواعيد استقبال الأوردرات</h3>
        {st && <span className={`px-4 py-1.5 rounded-full text-sm font-black text-white ${st.isOpen ? 'bg-green-600' : 'bg-red-600'}`}>{st.isOpen ? '🟢 مفتوح دلوقتي' : '🔴 مقفول دلوقتي'}</span>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {modeBtn('open', '🟢 فتح (يدوي)', 'bg-green-700 text-white border-green-400')}
        {modeBtn('closed', '🔴 قفل (يدوي)', 'bg-red-700 text-white border-red-400')}
        {modeBtn('auto', '⏰ تلقائي حسب المواعيد', 'bg-[#800020] text-white border-[#FFD700]')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-300 mb-1">بنفتح الساعة</label>
          <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-2xl p-4 text-white text-sm" />
        </div>
        <div>
          <label className="block text-xs text-zinc-300 mb-1">بنقفل الساعة (ممكن تكون بعد نص الليل)</label>
          <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-2xl p-4 text-white text-sm" />
        </div>
      </div>

      <label className="block text-xs text-zinc-300 mb-1">رسالة القفل (اختياري — لو سبتها فاضية هتظهر الرسالة الافتراضية)</label>
      <textarea rows="2" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="قفلنا دلوقتي 🌙 هنفتح الصبح بإذن الله" className="w-full bg-[#12080A] border border-[#3A1218] rounded-2xl p-4 text-white text-sm mb-4" />

      <button type="button" disabled={busy} onClick={saveHours} className="w-full bg-[#800020] hover:bg-[#990026] disabled:opacity-60 text-white font-black py-4 rounded-2xl transition shadow-lg">💾 حفظ المواعيد والرسالة</button>
      <p className="text-zinc-500 text-xs mt-3">الوضع اليدوي (فتح/قفل) بيفضل زي ما هو لحد ما ترجّعه "تلقائي".</p>
    </div>
  );
};

// ================= 1. صفحة الرئيسية =================
const HomePage = ({ lang, siteSettings, menuItems, handleOpenItemDetails, cart, setCart }) => {
  const t = translations[lang];
  const title = lang === 'ar' ? siteSettings.heroTitleAr : siteSettings.heroTitleEn;
  const offerItems = menuItems.filter(item => item.isOffer);

  const [currentIndex, setCurrentIndex] = useState(0);

  const nextSlide = () => {
    if (offerItems.length <= 3) return;
    setCurrentIndex((prev) => (prev + 1) % (offerItems.length - 2));
  };

  const prevSlide = () => {
    if (offerItems.length <= 3) return;
    setCurrentIndex((prev) => (prev === 0 ? offerItems.length - 3 : prev - 1));
  };

  useEffect(() => {
    if (offerItems.length <= 3) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % Math.max(1, offerItems.length - 2));
    }, 3000);
    return () => clearInterval(interval);
  }, [offerItems.length]);

  return (
    <div className="bg-[#12080A] min-h-screen text-white">
      <header className="relative w-full min-h-[520px] md:min-h-[620px] bg-[#12080A] flex flex-col items-center justify-center overflow-hidden border-b-4 border-[#800020] shadow-2xl py-12">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-70 scale-105 transition duration-700"
          style={{ backgroundImage: `url(${siteSettings.heroImage})` }}
        ></div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#12080A] via-[#12080A]/50 to-transparent"></div>
        
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto flex flex-col items-center">
          <h1 className="text-4xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-[#FFD700] via-[#E6C687] to-[#C5A059] drop-shadow-[0_5px_5px_rgba(0,0,0,0.9)] mb-4 nkfx-rise">
            {title}
          </h1>
          <Link to="/menu" className="inline-block bg-[#800020] hover:bg-[#990026] text-white border-2 border-[#FFD700] px-8 py-3 text-xl font-black rounded-2xl hover:scale-105 transition shadow-[0_0_30px_rgba(255,215,0,0.4)] mb-6 active:scale-95 nkfx-rise">
            {t.orderNow}
          </Link>

          {siteSettings.promoBannerImage && (
            <div className="w-full max-w-xl mt-3 px-4">
              <img 
                src={siteSettings.promoBannerImage} 
                alt="Banner Offer" 
                className="w-full h-auto max-h-[320px] object-cover rounded-2xl border-2 border-[#FFD700] shadow-[0_0_30px_rgba(255,215,0,0.4)]" 
              />
            </div>
          )}
        </div>
      </header>

      <section className="px-8 py-14 max-w-7xl mx-auto relative">
        <div className="flex justify-between items-center mb-8 border-b border-[#3A1218] pb-4">
          <h2 className="text-3xl font-bold text-[#FFD700]">{t.bestOffers}</h2>
          <Link to="/menu" className="text-[#FFD700] font-bold hover:underline text-lg flex items-center gap-1 hover:text-white transition">
            {t.seeMore}
          </Link>
        </div>

        {offerItems.length > 0 ? (
          <div className="relative overflow-hidden px-4">
            {offerItems.length > 3 && (
              <>
                <button onClick={prevSlide} className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-[#800020] text-white w-10 h-10 rounded-full font-black text-xl flex items-center justify-center shadow-lg hover:bg-[#990026] transition active:scale-90">❮</button>
                <button onClick={nextSlide} className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-[#800020] text-white w-10 h-10 rounded-full font-black text-xl flex items-center justify-center shadow-lg hover:bg-[#990026] transition active:scale-90">❯</button>
              </>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 transition-all duration-300 nkfx-stagger">
              {offerItems.slice(currentIndex, currentIndex + 3).map((item) => {
                const finalPrice = getDiscountedPrice(item.price, item.discount);
                const cartItem = cart.find(i => i.name === item.name);
                const quantity = cartItem ? cart.filter(i => i.name === item.name).length : 0;
                const soldOut = item.available === false;

                return (
                  <div
                    key={item._id}
                    className={`bg-[#1C0D10] border border-[#3A1218] rounded-2xl overflow-hidden shadow-2xl hover:border-[#800020] transition duration-300 group flex flex-col relative nkfx-rise ${soldOut ? 'opacity-60' : ''}`}
                  >
                    <div onClick={() => { if (!soldOut) handleOpenItemDetails(item); }} className={`relative w-full aspect-[4/3] bg-[#12080A] overflow-hidden shrink-0 ${soldOut ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                      <img src={item.image} alt={item.name} loading="lazy" decoding="async" className={`w-full h-full object-cover group-hover:scale-105 transition duration-300 ${soldOut ? 'grayscale' : ''}`} />
                      {soldOut && (
                        <div className="absolute top-2 left-2 z-30 bg-red-600 text-white text-[11px] font-black px-2 py-0.5 rounded-full shadow-lg">⛔ غير متاح</div>
                      )}
                      {!soldOut && item.discount > 0 && (
                        <div className="absolute top-2 right-2 z-20 bg-[#FFD700] text-black text-xs font-black px-2.5 py-1 rounded-full shadow-lg">خصم {item.discount}%</div>
                      )}
                    </div>
                    <div className="p-2.5 sm:p-3 flex-1 flex flex-col bg-[#1C0D10] gap-1.5">
                      <h4 className="text-[15px] font-extrabold leading-snug text-white">{item.name}</h4>
                      {item.description && <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{item.description}</p>}
                      <div className="flex items-baseline gap-2 mt-auto">
                        <MenuPrice item={item} />
                      </div>
                      {soldOut ? (
                        <button disabled className="w-full bg-zinc-700 text-zinc-300 font-bold py-2 rounded-xl cursor-not-allowed text-sm">خلص حالياً ⛔</button>
                      ) : quantity === 0 ? (
                        <button onClick={() => handleOpenItemDetails(item)} className="w-full bg-[#800020] text-white font-bold py-2 rounded-xl hover:bg-[#990026] transition shadow active:scale-[0.97] text-sm">
                          أضف للسلة 🛒
                        </button>
                      ) : (
                        <div className="flex items-center justify-between bg-[#12080A] border border-[#800020] rounded-xl px-2 py-1">
                          <button onClick={() => {
                            const idx = cart.findIndex(i => i.name === item.name);
                            if (idx !== -1) { const nc = [...cart]; nc.splice(idx, 1); setCart(nc); }
                          }} className="w-8 h-8 bg-[#800020] rounded-lg text-white font-black hover:bg-[#990026] transition active:scale-90">-</button>
                          <span className="font-black text-[#FFD700]">{quantity}</span>
                          <button onClick={() => setCart([...cart, { ...item, price: finalPrice }])} className="w-8 h-8 bg-[#800020] rounded-lg text-white font-black hover:bg-[#990026] transition active:scale-90">+</button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="text-center text-zinc-500 py-10">لا توجد عروض رئيسية مضافة حالياً.</div>
        )}
      </section>
    </div>
  );
};

// ================= 2. صفحة المنيو =================
const MenuPage = ({ menuItems, categories, lang, handleOpenBox, handleOpenItemDetails, cart, setCart }) => {
  const t = translations[lang];
  const [selectedCategory, setSelectedCategory] = useState('الكل');
  const catRowRef = useRef(null);
  useEffect(() => {
    try {
      const el = catRowRef.current && catRowRef.current.querySelector('[data-active-cat="true"]');
      if (el) el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    } catch {}
  }, [selectedCategory]);

  const categoriesToShow = selectedCategory === 'الكل' || selectedCategory === 'All'
    ? categories 
    : categories.filter(cat => cat.name === selectedCategory);

  return (
    <section className="px-8 py-12 max-w-7xl mx-auto min-h-screen relative bg-[#12080A] text-white">
      <h2 className="text-3xl font-bold text-[#FFD700] mb-6 border-b border-[#3A1218] pb-4">{t.ourMenu}</h2>
      
      <div className="relative mb-12 sticky top-20 z-30">
      <div ref={catRowRef} className="flex gap-3 overflow-x-auto pb-4 scrollbar-none bg-[#12080A]/95 py-3 backdrop-blur-md">
        <button
          data-active-cat={(selectedCategory === 'الكل' || selectedCategory === 'All') ? 'true' : undefined}
          onClick={() => setSelectedCategory(lang === 'ar' ? 'الكل' : 'All')}
          className={`px-6 py-2.5 rounded-full font-bold whitespace-nowrap transition duration-300 active:scale-95 border ${
            selectedCategory === 'الكل' || selectedCategory === 'All'
              ? 'bg-[#800020] text-white border-[#FFD700] shadow-[0_0_15px_rgba(128,0,32,0.5)]' 
              : 'bg-[#1C0D10] text-zinc-300 border-[#3A1218] hover:border-[#800020]'
          }`}
        >
          {t.all}
        </button>
        {categories.map(cat => (
          <button
            key={cat._id}
            data-active-cat={selectedCategory === cat.name ? 'true' : undefined}
            onClick={() => setSelectedCategory(cat.name)}
            className={`px-6 py-2.5 rounded-full font-bold whitespace-nowrap transition duration-300 active:scale-95 border ${
              selectedCategory === cat.name 
                ? 'bg-[#800020] text-white border-[#FFD700] shadow-[0_0_15px_rgba(128,0,32,0.5)]' 
                : 'bg-[#1C0D10] text-zinc-300 border-[#3A1218] hover:border-[#800020]'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-[#12080A] to-transparent" />
      </div>

      {categoriesToShow.length === 0 ? (
        <div className="text-zinc-400 text-center py-20 text-xl">لا توجد أقسام مضافة بعد... ⏳</div>
      ) : (
        <div className="space-y-16">
          {categoriesToShow.map(cat => {
            const catItems = menuItems.filter(item => item.category === cat.name).sort((a, b) => (a.order || 0) - (b.order || 0));
            
            if (catItems.length === 0 && selectedCategory !== 'الكل' && selectedCategory !== 'All') {
              return (
                <div key={cat._id} className="border-b border-[#3A1218] pb-10">
                  <h3 className="text-2xl font-black text-[#FFD700] mb-6 border-r-4 border-[#800020] pr-3">{cat.name}</h3>
                  <p className="text-zinc-500 text-sm">لا توجد أصناف في هذا القسم حالياً.</p>
                </div>
              );
            }
            if (catItems.length === 0) return null;

            return (
              <div key={cat._id} className="border-b border-[#3A1218] pb-12">
                <h3 className="text-2xl font-black text-[#FFD700] mb-6 border-r-4 border-[#800020] pr-3">
                  {cat.name}
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 nkfx-stagger">
                  {catItems.map(item => {
                    const finalPrice = getDiscountedPrice(item.price, item.discount);
                    const cartItem = cart.find(i => i.name === item.name);
                    const quantity = cartItem ? cart.filter(i => i.name === item.name).length : 0;
                    const soldOut = item.available === false;

                    return (
                      <div
                        key={item._id}
                        className={`bg-[#1C0D10] border border-[#3A1218] rounded-2xl overflow-hidden flex flex-col hover:border-[#800020] transition group shadow-xl relative nkfx-rise ${soldOut ? 'opacity-60' : ''}`}
                      >
                        <div onClick={() => { if (soldOut) return; item.type === 'box' ? handleOpenBox(item) : handleOpenItemDetails(item); }} className={`relative w-full aspect-[4/3] bg-[#12080A] overflow-hidden shrink-0 ${soldOut ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                          <img src={item.image || "https://via.placeholder.com/400x300/222/FFD700?text=Noss+Kofta"} alt={item.name} loading="lazy" decoding="async" className={`w-full h-full object-cover group-hover:scale-105 transition duration-300 ${soldOut ? 'grayscale' : ''}`} />
                          {soldOut && (
                            <div className="absolute top-2 left-2 z-30 bg-red-600 text-white text-[11px] font-black px-2 py-0.5 rounded-full shadow-lg">⛔ غير متاح</div>
                          )}
                          {!soldOut && item.discount > 0 && (
                            <div className="absolute top-2 right-2 z-20 bg-[#FFD700] text-black text-xs font-black px-2.5 py-1 rounded-full shadow-lg">خصم {item.discount}%</div>
                          )}
                        </div>
                        <div className="p-2.5 sm:p-3 flex-1 flex flex-col bg-[#1C0D10] gap-1.5">
                          <h3 className="text-[15px] font-extrabold leading-snug text-white">{item.name}</h3>
                          {item.description && <p className="text-xs text-zinc-400 leading-relaxed line-clamp-2">{item.description}</p>}
                          <div className="flex items-baseline gap-2 mt-auto">
                            <MenuPrice item={item} />
                          </div>
                          {soldOut ? (
                            <button disabled className="w-full bg-zinc-700 text-zinc-300 font-bold py-2 rounded-xl cursor-not-allowed text-sm">خلص حالياً ⛔</button>
                          ) : item.type === 'box' ? (
                            <button onClick={() => handleOpenBox(item)} className="w-full bg-[#800020] text-white font-bold py-2 rounded-xl hover:bg-[#990026] transition shadow active:scale-[0.97] text-sm">
                              {t.customizeBox}
                            </button>
                          ) : (
                            quantity === 0 ? (
                              <button onClick={() => handleOpenItemDetails(item)} className="w-full border-2 border-[#800020] text-[#FFD700] font-bold py-2 rounded-xl hover:bg-[#800020] hover:text-white transition shadow active:scale-[0.97] text-sm">
                                {t.details} 🛒
                              </button>
                            ) : (
                              <div className="flex items-center justify-between bg-[#12080A] border border-[#800020] rounded-xl px-2 py-1">
                                <button onClick={() => {
                                  const idx = cart.findIndex(i => i.name === item.name);
                                  if (idx !== -1) { const nc = [...cart]; nc.splice(idx, 1); setCart(nc); }
                                }} className="w-8 h-8 bg-[#800020] rounded-lg text-white font-black hover:bg-[#990026] transition active:scale-90">-</button>
                                <span className="font-black text-[#FFD700]">{quantity}</span>
                                <button onClick={() => setCart([...cart, { ...item, price: finalPrice }])} className="w-8 h-8 bg-[#800020] rounded-lg text-white font-black hover:bg-[#990026] transition active:scale-90">+</button>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

// ================= 3. لوحة التحكم الشاملة =================
// ================= تصغير الصور (للجديد وللي مرفوع قبل كده) =================
const supportsWebp = (() => {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); } catch (e) { return false; }
})();

// بياخد صورة (لينك أو Blob) ويرجّع Data URL أصغر
const shrinkImage = (blobOrUrl, maxW, maxH, quality = 0.78) => new Promise((resolve, reject) => {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const img = new Image();
  img.onload = () => {
    let w = img.width; let h = img.height;
    const ratio = Math.min(1, maxW / w, maxH / h);
    w = Math.round(w * ratio); h = Math.round(h * ratio);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(url);
    resolve(canvas.toDataURL(supportsWebp ? 'image/webp' : 'image/jpeg', quality));
  };
  img.onerror = () => reject(new Error('image load failed'));
  img.src = url;
});

const ImageOptimizerPanel = ({ menuItems, siteSettings, adminFetch, fetchItems, fetchSettings }) => {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const [summary, setSummary] = useState('');

  const kb = (n) => `${Math.round(n / 1024)} ك.ب`;

  const run = async () => {
    if (!window.confirm('هيصغّر صور الأصناف والهيرو والبانر الكبيرة. مفيش رجوع للصورة الأصلية. تكمل؟')) return;
    setRunning(true); setLog([]); setSummary('');
    let before = 0; let after = 0; let done = 0;
    const add = (line) => setLog(prev => [...prev, line]);

    const handle = async (label, src, maxW, maxH, save) => {
      if (!src) return;
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        if (blob.size < 70 * 1024) { add(`⏭️ ${label}: صغيرة أصلاً (${kb(blob.size)})`); return; }
        const small = await shrinkImage(blob, maxW, maxH);
        const newSize = Math.round(small.length * 0.75);
        if (newSize > blob.size * 0.85) { add(`⏭️ ${label}: مفيش فرق كبير`); return; }
        const ok = await save(small);
        if (!ok) { add(`❌ ${label}: فشل الحفظ`); return; }
        before += blob.size; after += newSize; done += 1;
        add(`✅ ${label}: ${kb(blob.size)} ← ${kb(newSize)}`);
      } catch (e) {
        add(`❌ ${label}: ${e.message}`);
      }
    };

    for (const it of menuItems) {
      if (!it.image || !/^https?:\/\//.test(it.image) || !it.image.startsWith(API_BASE)) continue;
      await handle(it.name, it.image, 700, 700, async (data) => {
        const r = await adminFetch(`/api/items/${it._id}`, { method: 'PUT', body: JSON.stringify({ image: data }) });
        return r.ok;
      });
    }
    const settingsJobs = [['صورة الهيرو', 'heroImage', 1400, 900], ['صورة البانر', 'promoBannerImage', 900, 600]];
    for (const [label, field, mw, mh] of settingsJobs) {
      const src = siteSettings?.[field];
      if (!src || !src.startsWith(API_BASE)) continue;
      await handle(label, src, mw, mh, async (data) => {
        const r = await adminFetch('/api/settings', { method: 'PUT', body: JSON.stringify({ [field]: data }) });
        return r.ok;
      });
    }

    await fetchItems(); if (fetchSettings) await fetchSettings();
    setSummary(done === 0 ? 'مفيش صور محتاجة تصغير.' : `تم تصغير ${done} صورة: من ${kb(before)} لـ ${kb(after)} (وفّرت ${kb(before - after)})`);
    setRunning(false);
  };

  return (
    <div className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5 mb-6">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-right">
        <span className="font-black text-[#FFD700] text-lg">🖼️ تصغير الصور الحالية (لتسريع الموقع)</span>
        <span className="text-zinc-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-zinc-400 text-sm">بيمر على كل صورة كبيرة (أكتر من 70 ك.ب) ويصغّرها ويحفظها. اترك الصفحة مفتوحة لحد ما يخلص.</p>
          <button type="button" disabled={running} onClick={run} className={`px-5 py-3 rounded-xl font-black text-white ${running ? 'bg-zinc-600' : 'bg-[#800020] hover:bg-[#990026]'}`}>{running ? '...جاري التصغير' : '🚀 ابدأ التصغير'}</button>
          {summary && <p className="text-green-400 font-bold text-sm">{summary}</p>}
          {log.length > 0 && <div className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 max-h-60 overflow-y-auto text-xs text-zinc-300 space-y-1">{log.map((l, i) => <p key={i}>{l}</p>)}</div>}
        </div>
      )}
    </div>
  );
};

// ================= تعديل الخصم لأكتر من صنف مرة واحدة =================
const BulkDiscountPanel = ({ menuItems, categories, adminFetch, fetchItems }) => {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([]);
  const [newDiscount, setNewDiscount] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [saving, setSaving] = useState(false);

  const visible = menuItems
    .filter(i => catFilter === 'all' || i.category === catFilter)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const currentDiscounts = [...new Set(menuItems.map(i => Number(i.discount) || 0).filter(d => d > 0))].sort((a, b) => b - a);

  const toggle = (id) => setSelected(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  const selectAllVisible = () => setSelected(prev => [...new Set([...prev, ...visible.map(i => i._id)])]);
  const selectByDiscount = (d) => setSelected(visible.filter(i => (Number(i.discount) || 0) === d).map(i => i._id));

  const apply = async () => {
    const value = Number(newDiscount);
    if (newDiscount === '' || !Number.isFinite(value) || value < 0 || value > 100) return alert('اكتب نسبة الخصم الجديدة (من 0 لـ 100)');
    if (selected.length === 0) return alert('اختار صنف واحد على الأقل');
    const msg = value === 0
      ? `هتشيل الخصم من ${selected.length} صنف. متأكد؟`
      : `هتغير الخصم لـ ${value}% على ${selected.length} صنف. متأكد؟`;
    if (!window.confirm(msg)) return;
    setSaving(true);
    try {
      const res = await adminFetch('/api/items/bulk-discount', {
        method: 'PUT',
        body: JSON.stringify({ ids: selected, discount: value })
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error || 'حصل خطأ'); }
      else {
        alert(`تم تعديل الخصم على ${data.matched} صنف ✅`);
        setSelected([]); setNewDiscount('');
        fetchItems();
      }
    } catch (err) { alert('تعذر الاتصال بالسيرفر'); }
    setSaving(false);
  };

  return (
    <div className="bg-[#1C0D10] border border-[#800020]/40 rounded-[2rem] p-6 mt-10">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-right">
        <span className="text-xl font-black text-[#FFD700]">🏷️ تعديل الخصم لأكتر من صنف مرة واحدة</span>
        <span className="text-zinc-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="bg-[#0A0407] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm">
              <option value="all">كل الأقسام</option>
              {categories.map(c => <option key={c._id} value={c.name}>{c.name}</option>)}
            </select>
            <button type="button" onClick={selectAllVisible} className="bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold">✔ حدد كل الظاهر</button>
            <button type="button" onClick={() => setSelected([])} className="bg-zinc-800 text-white px-4 py-2 rounded-xl text-sm font-bold">✖ إلغاء التحديد</button>
          </div>

          {currentDiscounts.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-zinc-400 text-sm">تحديد سريع:</span>
              {currentDiscounts.map(d => (
                <button key={d} type="button" onClick={() => selectByDiscount(d)} className="bg-[#800020]/20 text-[#FFD700] border border-[#800020]/40 px-3 py-1.5 rounded-xl text-xs font-black">
                  كل اللي عليه خصم {d}%
                </button>
              ))}
            </div>
          )}

          <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
            {visible.length === 0 && <p className="text-zinc-500 text-sm">مفيش أصناف.</p>}
            {visible.map(item => {
              const on = selected.includes(item._id);
              const d = Number(item.discount) || 0;
              return (
                <label key={item._id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 border cursor-pointer transition ${on ? 'bg-[#800020]/15 border-[#800020]' : 'bg-[#0A0407] border-[#3A1218] hover:border-zinc-600'}`}>
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={on} onChange={() => toggle(item._id)} className="w-4 h-4 accent-[#800020]" />
                    <span className="font-bold text-white text-sm">{item.name}</span>
                    <span className="text-xs text-zinc-500">{item.category}</span>
                  </span>
                  <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${d > 0 ? 'bg-[#FFD700] text-black' : 'bg-zinc-800 text-zinc-400'}`}>{d > 0 ? `خصم ${d}%` : 'من غير خصم'}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 items-center border-t border-[#3A1218] pt-5">
            <span className="text-white font-bold text-sm">محدد: {selected.length} صنف</span>
            <input
              type="number" min="0" max="100" value={newDiscount} onChange={(e) => setNewDiscount(e.target.value)}
              placeholder="الخصم الجديد %"
              className="bg-[#0A0407] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm w-40"
            />
            <button type="button" onClick={apply} disabled={saving} className="bg-[#800020] hover:bg-[#990026] disabled:opacity-60 text-white font-black px-6 py-2.5 rounded-xl">
              {saving ? '...' : '✅ تطبيق الخصم على المحدد'}
            </button>
            <span className="text-zinc-500 text-xs">اكتب 0 لو عايز تشيل الخصم.</span>
          </div>
        </div>
      )}
    </div>
  );
};


// ---------- تقرير ساعات الذروة (للأدمن) ----------
const PeakHoursPanel = ({ adminFetch }) => {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dailyMsg, setDailyMsg] = useState('');
  const load = async (d) => {
    setBusy(true); setErr('');
    try {
      const r = await adminFetch(`/api/admin/reports/peak-hours?days=${d}`);
      const j = await r.json();
      if (!r.ok) return setErr(j.error || 'تعذر تحميل التقرير');
      setData(j);
    } catch { setErr('تعذر تحميل التقرير'); }
    finally { setBusy(false); }
  };
  useEffect(() => { load(days); }, []);
  const maxHour = data ? Math.max(1, ...data.byHour) : 1;
  const sendDaily = async () => {
    setDailyMsg('... جاري الإرسال');
    try {
      const r = await adminFetch('/api/reports/daily', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      setDailyMsg(r.ok ? `✅ اتبعت تقرير يوم ${j.day || ''} (تليجرام: ${j.telegramSent ? 'وصل' : 'متظبطش — اتأكد من إعدادات التليجرام'})` : `❌ ${j.error || 'فشل الإرسال'}`);
    } catch { setDailyMsg('❌ تعذر الإرسال'); }
  };
  return (
    <div className="bg-[#1C0D10] p-6 rounded-2xl border border-[#800020]/60 mb-8 shadow-xl">
      <h3 className="text-xl font-bold text-[#FFD700] mb-4">📊 ساعات الذروة</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        {[7, 30].map((d) => (
          <button key={d} type="button" onClick={() => { setDays(d); load(d); }} className={`px-4 py-2 rounded-xl text-sm font-bold ${days === d ? 'bg-[#800020] text-white' : 'bg-[#12080A] text-zinc-300 border border-[#3A1218]'}`}>آخر {d} يوم</button>
        ))}
        <button type="button" onClick={sendDaily} className="px-4 py-2 rounded-xl text-sm font-bold bg-[#25D366] text-black mr-auto">📩 ابعت تقرير النهارده دلوقتي</button>
      </div>
      {dailyMsg && <p className="text-xs font-bold text-zinc-300 mb-3">{dailyMsg}</p>}
      {err && <p className="text-sm text-red-400 font-bold">{err}</p>}
      {busy && !data && <p className="text-sm text-zinc-400">... جاري التحميل</p>}
      {data && (
        <div>
          <p className="text-sm text-zinc-300 mb-2">إجمالي الأوردرات: <b className="text-white">{data.total}</b> · أعلى ساعة: <b className="text-[#FFD700]">{data.busiestHour}:00</b> · أعلى يوم: <b className="text-[#FFD700]">{data.weekdayLabels[data.busiestDay]}</b></p>
          <div className="flex items-end gap-1 h-28 mb-1" dir="ltr">
            {data.byHour.map((c, h) => (
              <div key={h} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-[9px] text-zinc-400">{c > 0 ? c : ''}</span>
                <div className="w-full bg-[#FFD700] rounded-t" style={{ height: `${Math.max(c > 0 ? 4 : 0, (c / maxHour) * 80)}%` }} title={`${h}:00 — ${c}`} />
              </div>
            ))}
          </div>
          <div className="flex gap-1" dir="ltr">{data.byHour.map((_, h) => (<span key={h} className="flex-1 text-center text-[9px] text-zinc-500">{h}</span>))}</div>
          <div className="mt-4 space-y-1">
            {data.weekdayLabels.map((label, i) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <span className="w-20 text-zinc-300 font-bold">{label}</span>
                <div className="flex-1 bg-[#12080A] rounded h-4 overflow-hidden"><div className="bg-[#800020] h-4" style={{ width: `${data.total ? Math.round((data.byWeekday[i] / Math.max(1, ...data.byWeekday)) * 100) : 0}%` }} /></div>
                <span className="w-8 text-left font-bold text-white">{data.byWeekday[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------- أكواد الخصم (للأدمن) ----------
const PromoCodesPanel = ({ adminFetch }) => {
  const [codes, setCodes] = useState([]);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ code: '', type: 'percent', value: '', startDate: '', endDate: '', maxUses: '', minOrder: '' });
  const load = async () => {
    try { const r = await adminFetch('/api/admin/promo-codes'); const j = await r.json(); if (Array.isArray(j)) setCodes(j); } catch {}
  };
  useEffect(() => { load(); }, []);
  const create = async (e) => {
    e.preventDefault(); setMsg('');
    try {
      const r = await adminFetch('/api/admin/promo-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setMsg(j.error || 'فشل إنشاء الكود');
      setMsg(`✅ اتعمل الكود ${j.code}`);
      setForm({ code: '', type: 'percent', value: '', startDate: '', endDate: '', maxUses: '', minOrder: '' });
      load();
    } catch { setMsg('تعذر إنشاء الكود'); }
  };
  const toggle = async (c) => { try { await adminFetch(`/api/admin/promo-codes/${c._id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !c.active }) }); load(); } catch {} };
  const remove = async (c) => { if (!window.confirm(`تمسح الكود ${c.code}؟`)) return; try { await adminFetch(`/api/admin/promo-codes/${c._id}`, { method: 'DELETE' }); load(); } catch {} };
  const inp = 'bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm flex-1 min-w-[160px]';
  return (
    <div className="bg-[#1C0D10] p-6 rounded-2xl border border-[#800020]/60 mb-8 shadow-xl">
      <h3 className="text-xl font-bold text-[#FFD700] mb-4">🎟️ أكواد الخصم</h3>
      <form onSubmit={create} className="flex flex-wrap gap-3 mb-4">
        <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="الكود (مثال: RAMADAN10)" className={inp} dir="ltr" />
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={inp}>
          <option value="percent">نسبة %</option>
          <option value="amount">مبلغ ثابت (ج)</option>
        </select>
        <input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'amount' ? 'المبلغ (ج)' : 'النسبة %'} className={inp} dir="ltr" />
        <input type="number" value={form.minOrder} onChange={(e) => setForm({ ...form, minOrder: e.target.value })} placeholder="حد أدنى للأوردر (ج) — اختياري" className={inp} dir="ltr" />
        <input type="datetime-local" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inp} dir="ltr" />
        <input type="datetime-local" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inp} dir="ltr" />
        <input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })} placeholder="حد أقصى للاستخدام — اختياري" className={inp} dir="ltr" />
        <button type="submit" className="bg-[#800020] hover:bg-[#990026] text-white font-bold px-4 py-2 rounded-xl text-sm">➕ إنشاء الكود</button>
      </form>
      {msg && <p className="text-sm font-bold text-zinc-300 mb-3">{msg}</p>}
      {codes.length === 0 ? (
        <p className="text-zinc-500 text-sm">مفيش أكواد لسه.</p>
      ) : (
        <div className="space-y-2">
          {codes.map((c) => (
            <div key={c._id} className="bg-[#12080A] border border-[#3A1218] px-4 py-3 rounded-xl flex flex-wrap items-center gap-3 text-sm">
              <span className="font-black text-[#FFD700]" dir="ltr">{c.code}</span>
              <span className="text-white font-bold">{c.type === 'amount' ? `${c.value} ج` : `${c.value}%`}</span>
              <span className="text-zinc-400 text-xs">{new Date(c.startDate).toLocaleDateString('ar-EG')} ← {new Date(c.endDate).toLocaleDateString('ar-EG')}</span>
              <span className="text-zinc-300 text-xs">استخدم {c.usedCount || 0}{c.maxUses ? ` من ${c.maxUses}` : ''} مرة · خصم إجمالي {c.totalDiscounted || 0} ج</span>
              <span className="mr-auto flex gap-2">
                <button type="button" onClick={() => toggle(c)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${c.active ? 'bg-green-600/20 text-green-400' : 'bg-zinc-700 text-zinc-300'}`}>{c.active ? 'شغال — إيقاف' : 'موقوف — تشغيل'}</button>
                <button type="button" onClick={() => remove(c)} className="text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-bold">🗑️ مسح</button>
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-zinc-500 mt-3">الكود مش بيتجمع مع خصم المنيو الحالي ولا مع خصم النقاط — خصم واحد بس في الأوردر.</p>
    </div>
  );
};

const AdminPanel = ({ menuItems, categories, siteSettings, lang, fetchItems, fetchCategories, fetchSettings, token, onUnauthorized, onLogout }) => {
  const t = translations[lang];

  // كل طلبات لوحة الإدارة بتتبعت ومعاها توكن الأدمن
  const adminFetch = (path, options = {}) => authRequest(token, path, options, onUnauthorized);

  const [heroImg, setHeroImg] = useState(siteSettings.heroImage);
  const [bannerImg, setBannerImg] = useState(siteSettings.promoBannerImage || '');
  const [titleAr, setTitleAr] = useState(siteSettings.heroTitleAr);
  const [titleEn, setTitleEn] = useState(siteSettings.heroTitleEn);
  const [logoImg, setLogoImg] = useState(siteSettings.logoImage || '');

  const [deliveryZones, setDeliveryZones] = useState([]);
  const [zoneName, setZoneName] = useState('');
  const [zoneFee, setZoneFee] = useState('');

  const fetchZones = async () => {
    try {
      const res = await adminFetch(`/api/zones`);
      const data = await res.json();
      setDeliveryZones(data);
    } catch (err) {}
  };

  useEffect(() => {
    fetchZones();
  }, []);

  const handleAddZone = async (e) => {
    e.preventDefault();
    if (!zoneName.trim() || !zoneFee) return;
    try {
      const res = await adminFetch(`/api/zones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: zoneName.trim(), fee: Number(zoneFee) })
      });
      if (res.ok) {
        setZoneName('');
        setZoneFee('');
        fetchZones();
      }
    } catch (err) {}
  };

  const handleDeleteZone = async (id) => {
    if (!window.confirm("حذف هذه المنطقة؟")) return;
    try {
      const res = await adminFetch(`/api/zones/${id}`, { method: 'DELETE' });
      if (res.ok) fetchZones();
    } catch (err) {}
  };

  const handleHeroImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width; let height = img.height;
          const MAX_WIDTH = 1200; const MAX_HEIGHT = 800;
          if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          setHeroImg(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBannerImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width; let height = img.height;
          const MAX_WIDTH = 1000; const MAX_HEIGHT = 600;
          if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.85);
          setBannerImg(compressed);
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width; let height = img.height;
          const MAX_WIDTH = 300; const MAX_HEIGHT = 300;
          if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          setLogoImg(canvas.toDataURL('image/png', 0.9));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await adminFetch(`/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          heroImage: heroImg, 
          heroTitleAr: titleAr, 
          heroTitleEn: titleEn, 
          logoImage: logoImg, 
          promoBannerImage: bannerImg 
        })
      });
      if (res.ok) {
        alert("تم تحديث الواجهة واللوجو وصورة العرض بنجاح! 🚀🔥");
        fetchSettings();
      }
    } catch (err) {
      alert("خطأ أثناء الحفظ");
    }
  };

  const handleMoveCategory = async (index, direction) => {
    const newCategories = [...categories];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newCategories.length) return;
    const temp = newCategories[index];
    newCategories[index] = newCategories[targetIndex];
    newCategories[targetIndex] = temp;

    try {
      await Promise.all(
        newCategories.map((cat, idx) => 
          adminFetch(`/api/categories/${cat._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: idx })
          })
        )
      );
      fetchCategories();
    } catch (err) {}
  };

  const handleMoveItem = async (index, direction, catItems) => {
    const newItems = [...catItems];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const temp = newItems[index];
    newItems[index] = newItems[targetIndex];
    newItems[targetIndex] = temp;

    try {
      await Promise.all(
        newItems.map((itm, idx) => 
          adminFetch(`/api/items/${itm._id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...itm, order: idx })
          })
        )
      );
      fetchItems();
    } catch (err) {}
  };

  const [editCatId, setEditCatId] = useState(null);
  const [catName, setCatName] = useState('');

  const [editId, setEditId] = useState(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState(''); 
  const [image, setImage] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(categories[0]?.name || '');
  const [type, setType] = useState('normal');
  const [maxItems, setMaxItems] = useState('');
  const [isOffer, setIsOffer] = useState(false);
  
  const [addonName, setAddonName] = useState('');
  const [addonPrice, setAddonPrice] = useState('');
  const [addonsList, setAddonsList] = useState([]);

  const [boxItemNameInput, setBoxItemNameInput] = useState('');
  const [boxItemsList, setBoxItemsList] = useState([]);

  const [sizeNameInput, setSizeNameInput] = useState('');
  const [sizePriceInput, setSizePriceInput] = useState('');
  const [sizesList, setSizesList] = useState([]);

  const handleAddSize = () => {
    if (!sizeNameInput.trim() || !sizePriceInput) return;
    setSizesList([...sizesList, { name: sizeNameInput.trim(), price: Number(sizePriceInput) }]);
    setSizeNameInput('');
    setSizePriceInput('');
  };

  const handleRemoveSize = (index) => {
    setSizesList(sizesList.filter((_, i) => i !== index));
  };

  const handleAddBoxItemName = () => {
    if (!boxItemNameInput.trim()) return;
    setBoxItemsList([...boxItemsList, { name: boxItemNameInput.trim() }]);
    setBoxItemNameInput('');
  };

  const handleRemoveBoxItemName = (index) => {
    setBoxItemsList(boxItemsList.filter((_, i) => i !== index));
  };

  const handleAddAddon = () => {
    if (!addonName.trim() || !addonPrice) return;
    setAddonsList([...addonsList, { name: addonName.trim(), price: Number(addonPrice) }]);
    setAddonName('');
    setAddonPrice('');
  };

  const handleRemoveAddon = (index) => {
    setAddonsList(addonsList.filter((_, i) => i !== index));
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      let res;
      if (editCatId) {
        res = await adminFetch(`/api/categories/${editCatId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: catName.trim() })
        });
      } else {
        res = await adminFetch(`/api/categories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: catName.trim() })
        });
      }

      if (res.ok) {
        setCatName('');
        setEditCatId(null);
        fetchCategories();
      }
    } catch (err) {}
  };

  const handleEditCategoryClick = (cat) => {
    setEditCatId(cat._id);
    setCatName(cat.name);
  };

  const handleDeleteCategory = async (id) => {
    if (!window.confirm("Delete?")) return;
    try {
      const res = await adminFetch(`/api/categories/${id}`, { method: 'DELETE' });
      if (res.ok) fetchCategories();
    } catch (err) {}
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width; let height = img.height;
          const MAX_WIDTH = 800; const MAX_HEIGHT = 800;
          if (width > height) { if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; } }
          else { if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; } }
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          setImage(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const itemData = {
      name,
      price: Number(price),
      discount: Number(discount) || 0,
      image: image || "https://via.placeholder.com/400x300/222/FFD700?text=Noss+Kofta",
      description,
      category: category || categories[0]?.name || 'General',
      type,
      maxItems: type === 'box' ? Number(maxItems) : undefined,
      isOffer,
      addons: addonsList,
      boxItems: type === 'box' ? boxItemsList : [],
      sizes: sizesList
    };

    try {
      let res;
      if (editId) {
        res = await adminFetch(`/api/items/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemData)
        });
      } else {
        res = await adminFetch(`/api/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(itemData)
        });
      }

      if (res.ok) {
        resetForm();
        fetchItems();
        alert("تم حفظ الصنف بنجاح! 🚀");
      }
    } catch (err) {}
  };

  const handleEditItemClick = (item) => {
    setEditId(item._id);
    setName(item.name);
    setPrice(item.price);
    setDiscount(item.discount || '');
    setImage(item.image);
    setDescription(item.description || '');
    setCategory(item.category);
    setType(item.type || 'normal');
    setMaxItems(item.maxItems || '');
    setIsOffer(item.isOffer || false);
    setAddonsList(item.addons || []);
    setBoxItemsList(item.boxItems || []);
    setSizesList(item.sizes || []);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditId(null);
    setName(''); setPrice(''); setDiscount(''); setImage(''); setDescription(''); setMaxItems(''); setType('normal');
    setIsOffer(false);
    setAddonsList([]);
    setBoxItemsList([]);
    setSizesList([]);
  };

  const handleToggleAvailable = async (item) => {
    try {
      const res = await adminFetch(`/api/items/${item._id}/availability`, {
        method: 'PUT',
        body: JSON.stringify({ available: item.available === false })
      });
      if (res.ok) fetchItems();
    } catch (err) {}
  };

  const handleDeleteItem = async (id) => {
    if (!window.confirm("Delete item?")) return;
    try {
      const res = await adminFetch(`/api/items/${id}`, { method: 'DELETE' });
      if (res.ok) fetchItems();
    } catch (err) {}
  };

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto min-h-[80vh] bg-[#12080A] text-white">
      <div className="flex justify-between items-center mb-8 border-b border-[#3A1218] pb-4">
        <h2 className="text-3xl font-bold text-[#FFD700]">⚙️ لوحة الإدارة</h2>
        <div className="flex items-center gap-4">
          <Link className="text-zinc-400 hover:text-white underline" to="/cashier">شاشة الكاشير</Link>
          <Link className="text-zinc-400 hover:text-white underline" to="/menu">{t.menu}</Link>
          <button type="button" onClick={onLogout} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-xl text-sm font-bold text-white">🚪 خروج</button>
        </div>
      </div>

      <StoreHoursPanel adminFetch={adminFetch} />

      <PeakHoursPanel adminFetch={adminFetch} />
      <PromoCodesPanel adminFetch={adminFetch} />

      <div className="bg-[#1C0D10] p-6 rounded-2xl border border-[#800020]/60 mb-8 shadow-xl">
        <h3 className="text-xl font-bold text-[#FFD700] mb-4">🚚 إدارة مناطق التوصيل وأسعارها</h3>
        <form onSubmit={handleAddZone} className="flex flex-col md:flex-row gap-4 mb-6">
          <input 
            type="text" 
            placeholder="اسم المنطقة (مثل: الشروق)" 
            value={zoneName} 
            onChange={(e) => setZoneName(e.target.value)}
            className="flex-1 bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm"
          />
          <input 
            type="number" 
            placeholder="سعر التوصيل (مثل: 30)" 
            value={zoneFee} 
            onChange={(e) => setZoneFee(e.target.value)}
            className="w-full md:w-40 bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm"
          />
          <button type="submit" className="bg-[#800020] text-white font-bold px-6 py-3 rounded-xl hover:bg-[#990026] transition shadow cursor-pointer">
            ➕ إضافة منطقة
          </button>
        </form>

        <div className="space-y-3">
          {deliveryZones.length === 0 ? (
            <p className="text-zinc-500 text-sm">لم يتم إضافة مناطق توصيل بعد.</p>
          ) : (
            deliveryZones.map((zone) => (
              <div key={zone._id} className="bg-[#12080A] border border-[#3A1218] px-4 py-3 rounded-xl flex items-center justify-between text-sm">
                <span className="font-bold text-[#FFD700]">{zone.name} — <span className="text-white">{zone.fee} جنيه</span></span>
                <button onClick={() => handleDeleteZone(zone._id)} className="text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg font-bold text-xs">✕ مسح</button>
              </div>
            ))
          )}
        </div>
      </div>

      <form onSubmit={handleSaveSettings} className="bg-[#1C0D10] p-6 rounded-2xl border border-[#800020]/50 mb-8 shadow-xl">
        <h3 className="text-xl font-bold text-[#FFD700] mb-4">{t.siteSettings}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
          <div>
            <label className="block text-sm mb-2 text-zinc-300">شعار المطعم (اللوجو)</label>
            <input type="file" accept="image/*" onChange={handleLogoUpload} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-1 text-white text-sm cursor-pointer mb-2" />
            {logoImg && <img src={logoImg} alt="Logo Preview" className="w-20 h-20 object-contain rounded-xl border border-[#3A1218] bg-[#12080A]" />}
          </div>
          <div>
            <label className="block text-sm mb-2 text-zinc-300">خلفية الهيدر الثابتة فوق</label>
            <input type="file" accept="image/*" onChange={handleHeroImageUpload} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-1 text-white text-sm cursor-pointer mb-2" />
            <img src={heroImg} alt="Hero" className="w-full h-20 object-cover rounded-xl border border-[#3A1218]" />
          </div>

          <div className="md:col-span-2 bg-[#12080A] p-4 rounded-xl border border-[#FFD700]/30">
            <label className="block text-sm mb-2 text-[#FFD700] font-bold">🖼️ صورة العرض الكبيرة (البوستر تحت زرار اطلب دلوقتي)</label>
            <input type="file" accept="image/*" onChange={handleBannerImageUpload} className="w-full bg-[#1C0D10] border border-[#3A1218] rounded-xl p-1 text-white text-sm cursor-pointer mb-2" />
            <div className="flex items-center gap-4 mt-2">
              {bannerImg ? (
                <>
                  <img src={bannerImg} alt="Banner Preview" className="w-40 h-24 object-cover rounded-xl border border-[#FFD700]" />
                  <button type="button" onClick={() => { setBannerImg(''); }} className="bg-red-600/20 text-red-400 px-4 py-2 rounded-xl text-xs font-bold border border-red-500/30">🗑️ إزالة البوستر</button>
                </>
              ) : (
                <span className="text-zinc-500 text-xs">لا توجد صورة بوستر مفعلة حالياً.</span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1 text-zinc-300">العنوان بالعربي</label>
            <input type="text" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-2 text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs mb-1 text-zinc-300">العنوان بالإنجليزي</label>
            <input type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-2 text-white text-sm" />
          </div>
        </div>
        <button type="submit" className="w-full bg-[#800020] text-white font-bold py-3 rounded-xl hover:bg-[#990026] transition shadow">
          💾 حفظ تعديلات اللوجو والواجهة وصورة العرض
        </button>
      </form>

      <div className="bg-[#1C0D10] p-6 rounded-2xl border border-[#3A1218] mb-8 shadow-xl">
        <h3 className="text-xl font-bold text-[#FFD700] mb-4">{t.catManage}</h3>
        <form onSubmit={handleSaveCategory} className="flex gap-4 mb-6">
          <input 
            type="text" 
            placeholder="Category Name..." 
            value={catName} 
            onChange={(e) => setCatName(e.target.value)}
            className="flex-1 bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white"
          />
          <button type="submit" className="bg-[#800020] text-white font-bold px-6 py-3 rounded-xl hover:bg-[#990026] transition shadow">
            {editCatId ? t.save : t.addCat}
          </button>
          {editCatId && (
            <button type="button" onClick={() => { setEditCatId(null); setCatName(''); }} className="bg-zinc-700 text-white px-4 rounded-xl font-bold">
              {t.cancel}
            </button>
          )}
        </form>

        <div className="space-y-3">
          {categories.map((cat, index) => (
            <div key={cat._id} className="bg-[#12080A] border border-[#3A1218] px-4 py-3 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-zinc-500 font-bold text-sm">#{index + 1}</span>
                <span className="font-bold text-[#FFD700]">{cat.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  type="button" 
                  onClick={() => handleMoveCategory(index, 'up')}
                  disabled={index === 0}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold ${index === 0 ? 'bg-[#1C0D10] text-zinc-600 cursor-not-allowed' : 'bg-[#220E13] text-[#FFD700] hover:bg-[#2A080D]'}`}
                >
                  ◀ تحريك للخارج
                </button>
                <button 
                  type="button" 
                  onClick={() => handleMoveCategory(index, 'down')}
                  disabled={index === categories.length - 1}
                  className={`px-3 py-1.5 rounded-lg text-sm font-bold ${index === categories.length - 1 ? 'bg-[#1C0D10] text-zinc-600 cursor-not-allowed' : 'bg-[#220E13] text-[#FFD700] hover:bg-[#2A080D]'}`}
                >
                  تحريك للداخل ▶
                </button>
                <button onClick={() => handleEditCategoryClick(cat)} className="text-[#FFD700] bg-[#800020]/20 px-3 py-1.5 rounded-lg text-xs font-bold">✏️</button>
                <button onClick={() => handleDeleteCategory(cat._id)} className="text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-bold">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    
      <form onSubmit={handleSaveItem} className="bg-[#1C0D10] p-6 rounded-2xl border border-[#3A1218] mb-8 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-xl">
        <h3 className="md:col-span-2 text-xl font-bold text-[#FFD700] mb-2">{t.itemManage}</h3>
        <div>
          <label className="block text-sm mb-2 text-zinc-300">Item Name *</label>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white" placeholder="Name" />
        </div>
        <div>
          <label className="block text-sm mb-2 text-zinc-300">Price *</label>
          <input type="number" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white" placeholder="Price" />
        </div>
        <div>
          <label className="block text-sm mb-2 text-[#FFD700]">نسبة الخصم % (اختياري)</label>
          <input type="number" placeholder="مثال: 20" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full bg-[#12080A] border border-[#800020] rounded-xl p-3 text-white" />
        </div>
        <div>
          <label className="block text-sm mb-2 text-zinc-300">Category *</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white">
            {categories.map(cat => (
              <option key={cat._id} value={cat.name}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-2 text-zinc-300">Image</label>
          <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-1 text-white text-sm cursor-pointer" />
        </div>

        <div className="md:col-span-2 bg-[#12080A] p-4 rounded-xl border border-[#800020]/30 flex items-center gap-3">
          <input 
            type="checkbox" 
            id="isOfferCheck" 
            checked={isOffer} 
            onChange={(e) => setIsOffer(e.target.checked)}
            className="w-5 h-5 accent-[#800020] cursor-pointer" 
          />
          <label htmlFor="isOfferCheck" className="text-[#FFD700] font-bold cursor-pointer">
            🔥 عرض في الصفحة الرئيسية (اجعل هذا الصنف يظهر كعرض متحرك في الواجهة)
          </label>
        </div>

        <div>
          <label className="block text-sm mb-2 text-zinc-300">Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white">
            <option value="normal">Normal (سندوتش أو وجبة عادية)</option>
            <option value="box">Box (بوكس مخصص قابل للاختيار)</option>
          </select>
        </div>

        {type === 'box' && (
          <div>
            <label className="block text-sm mb-2 text-[#FFD700]">Max Items in Box *</label>
            <input type="number" value={maxItems} onChange={(e) => setMaxItems(e.target.value)} className="w-full bg-[#12080A] border border-[#800020] rounded-xl p-3 text-white" placeholder="3" />
          </div>
        )}

        {type === 'box' && (
          <div className="md:col-span-2 bg-[#12080A] p-4 rounded-xl border border-[#800020]/50">
            <label className="block text-sm mb-2 text-[#FFD700] font-bold">📦 أسماء المكونات التي تظهر داخل البوكس</label>
            <div className="flex gap-2 mb-3">
              <input 
                type="text" 
                placeholder="اسم المكون" 
                value={boxItemNameInput} 
                onChange={(e) => setBoxItemNameInput(e.target.value)}
                className="flex-1 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-2.5 text-white text-sm"
              />
              <button type="button" onClick={handleAddBoxItemName} className="bg-[#800020] text-white px-5 rounded-xl font-bold text-sm hover:bg-[#990026]">
                ➕ إضافة
              </button>
            </div>

            {boxItemsList.length > 0 && (
              <div className="space-y-2 mt-2">
                {boxItemsList.map((bItem, index) => (
                  <div key={index} className="flex justify-between items-center bg-[#12080A] px-3 py-2 rounded-xl border border-[#3A1218] text-sm">
                    <span className="text-[#FFD700] font-bold">{bItem.name}</span>
                    <button type="button" onClick={() => handleRemoveBoxItemName(index)} className="text-red-400 font-bold text-xs">✕ مسح</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="md:col-span-2 bg-[#12080A] p-4 rounded-xl border border-[#800020]/50">
            <label className="block text-sm mb-2 text-[#FFD700] font-bold">⚖️ أحجام الصنف وأسعارها (مثل: كيلو، نص، ربع)</label>
            <div className="flex gap-2 mb-3">
              <input 
                type="text" 
                placeholder="اسم الحجم (مثل: كيلو)" 
                value={sizeNameInput} 
                onChange={(e) => setSizeNameInput(e.target.value)}
                className="flex-1 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-2.5 text-white text-sm"
              />
              <input 
                type="number" 
                placeholder="السعر (مثل: 400)" 
                value={sizePriceInput} 
                onChange={(e) => setSizePriceInput(e.target.value)}
                className="w-32 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-2.5 text-white text-sm"
              />
              <button type="button" onClick={handleAddSize} className="bg-[#800020] text-white px-4 rounded-xl font-bold text-sm hover:bg-[#990026]">
                ➕ إضافة حجم
              </button>
            </div>

            {sizesList.length > 0 && (
              <div className="space-y-2 mt-2">
                {sizesList.map((sz, index) => (
                  <div key={index} className="flex justify-between items-center bg-[#12080A] px-3 py-2 rounded-xl border border-[#3A1218] text-sm">
                    <span className="text-[#FFD700] font-bold">{sz.name} — {sz.price} ج</span>
                    <button type="button" onClick={() => handleRemoveSize(index)} className="text-red-400 font-bold text-xs">✕ مسح</button>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className="md:col-span-2 bg-[#12080A] p-4 rounded-xl border border-[#3A1218]">
            <label className="block text-sm mb-2 text-[#FFD700] font-bold">✨ الإضافات الاختيارية</label>
            <div className="flex gap-2 mb-3">
              <input 
                type="text" 
                placeholder="اسم الإضافة (مثلاً: إضافة بطاطس)" 
                value={addonName} 
                onChange={(e) => setAddonName(e.target.value)}
                className="flex-1 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-2.5 text-white text-sm"
              />
              <input 
                type="number" 
                placeholder="السعر (مثلاً: 10)" 
                value={addonPrice} 
                onChange={(e) => setAddonPrice(e.target.value)}
                className="w-32 bg-[#1C0D10] border border-[#3A1218] rounded-xl p-2.5 text-white text-sm"
              />
              <button type="button" onClick={handleAddAddon} className="bg-[#800020] text-white px-4 rounded-xl font-bold text-sm hover:bg-[#990026]">
                ➕ إضافة
              </button>
            </div>

            {addonsList.length > 0 && (
              <div className="space-y-2 mt-2">
                {addonsList.map((addon, index) => (
                  <div key={index} className="flex justify-between items-center bg-[#12080A] px-3 py-2 rounded-xl border border-[#3A1218] text-sm">
                    <span>{addon.name} (+{addon.price} ج)</span>
                    <button type="button" onClick={() => handleRemoveAddon(index)} className="text-red-400 font-bold text-xs">✕ مسح</button>
                  </div>
                ))}
              </div>
            )}
        </div>

        <div className="md:col-span-2">
            <label className="block text-sm mb-2 text-[#FFD700] font-bold">Description *</label>
            <textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white" placeholder="Description..." />
        </div>

        <div className="md:col-span-2 mt-4 flex gap-4">
            <button type="submit" className="flex-1 bg-[#800020] text-white font-bold py-3.5 rounded-xl hover:bg-[#990026] transition shadow">
              {editId ? t.save : t.addItem}
            </button>
            {editId && (
              <button type="button" onClick={resetForm} className="bg-zinc-700 text-white px-6 rounded-xl font-bold">
                {t.cancel}
              </button>
            )}
        </div>
      </form>

    <BulkDiscountPanel menuItems={menuItems} categories={categories} adminFetch={adminFetch} fetchItems={fetchItems} />
    <ImageOptimizerPanel menuItems={menuItems} siteSettings={siteSettings} adminFetch={adminFetch} fetchItems={fetchItems} fetchSettings={fetchSettings} />

    <div className="space-y-10 mt-10">
      <h3 className="text-2xl font-bold text-[#FFD700] border-b border-[#3A1218] pb-3">📋 إدارة وترتيب الأصناف حسب الأقسام</h3>
        
      {categories.map(cat => {
        const catItems = menuItems.filter(item => item.category === cat.name).sort((a, b) => (a.order || 0) - (b.order || 0));
          
        return (
          <div key={cat._id} className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-6 shadow-xl">
            <h4 className="text-xl font-black text-[#FFD700] mb-4 border-r-4 border-[#800020] pr-3">
              📁 قسم: {cat.name} ({catItems.length} صنف)
            </h4>

            {catItems.length === 0 ? (
              <p className="text-zinc-500 text-sm">لا توجد أصناف في هذا القسم حالياً.</p>
            ) : (
              <div className="space-y-3">
                {catItems.map((item, itemIndex) => (
                  <div key={item._id} className="bg-[#12080A] border border-[#3A1218] p-3.5 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="text-zinc-500 font-bold text-sm">#{itemIndex + 1}</span>
                      <img src={item.image} alt="" className="w-14 h-10 object-cover rounded-lg bg-[#1C0D10]" />
                      <div>
                        <h4 className="font-bold text-white">
                          {item.name} 
                          {item.code ? <span className="bg-zinc-700 text-zinc-200 text-xs px-2 py-0.5 rounded-md font-black mr-2">رمز {item.code}</span> : null}
                          {item.available === false && <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-md font-black mr-2">⛔ خلص</span>}
                          {item.discount > 0 && <span className="bg-[#FFD700] text-black text-xs px-2 py-0.5 rounded-md font-black mr-2">خصم {item.discount}%</span>}
                        </h4>
                        <span className="text-xs text-[#FFD700]">
                          {item.discount > 0 ? `${getDiscountedPrice(item.price, item.discount)} ج (بدل ${item.price})` : `${item.price} ج`}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button 
                        type="button" 
                        onClick={() => handleMoveItem(itemIndex, 'up', catItems)}
                        disabled={itemIndex === 0}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${itemIndex === 0 ? 'bg-[#1C0D10] text-zinc-600 cursor-not-allowed' : 'bg-[#220E13] text-[#FFD700] hover:bg-[#2A080D]'}`}
                      >
                        ▲
                      </button>
                      <button 
                        type="button" 
                        onClick={() => handleMoveItem(itemIndex, 'down', catItems)}
                        disabled={itemIndex === catItems.length - 1}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold ${itemIndex === catItems.length - 1 ? 'bg-[#1C0D10] text-zinc-600 cursor-not-allowed' : 'bg-[#220E13] text-[#FFD700] hover:bg-[#2A080D]'}`}
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggleAvailable(item)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-black ${item.available === false ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}
                      >
                        {item.available === false ? '⛔ خلص (شغّله)' : '✅ متاح'}
                      </button>
                      <button onClick={() => handleEditItemClick(item)} className="text-[#FFD700] bg-[#800020]/30 px-3.5 py-1.5 rounded-lg text-xs font-bold">✏️ تعديل</button>
                      <button onClick={() => handleDeleteItem(item._id)} className="text-red-400 bg-red-500/10 px-3.5 py-1.5 rounded-lg text-xs font-bold">✕ مسح</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  </section>
);
};

// بوابة لوحة الإدارة: لازم دخول بحساب الأدمن (الباسورد بيتراجع في السيرفر مش في الموقع)
const AdminDashboard = (props) => {
  const [session, setSession] = useState(readSession);

  const handleLogout = () => {
    clearSession();
    setSession(null);
  };

  if (!session?.token || session.user?.role !== 'admin') {
    return (
      <StaffLogin
        title="🔒 دخول لوحة الإدارة"
        requireAdmin
        onLogin={(data) => { saveSession(data); setSession(data); }}
      />
    );
  }

  return <AdminPanel {...props} token={session.token} onUnauthorized={handleLogout} onLogout={handleLogout} />;
};



// ================= صفحة «طلباتي» — حساب العميل (رقم + رقم سري) =================
const ORDER_STATUS_AR = { pending: '⏳ قيد الانتظار', accepted: '👨‍🍳 قيد التحضير', ready: '🛵 خرج للتوصيل', completed: '✅ تم', cancelled: '✖ ملغي' };

// مراحل تتبع الأوردر للعميل: اتأكد → بيتحضر → جاهز للاستلام / خرج للتوصيل → اتسلم
const TRACK_STAGES = (orderType) => (orderType === 'pickup' ? ['اتأكد', 'بيتحضر', 'جاهز للاستلام', 'اتسلم'] : ['اتأكد', 'بيتحضر', 'خرج للتوصيل', 'اتسلم']);
const orderStage = (o) => {
  if (o.status === 'cancelled') return { done: 0, current: -1, cancelled: true };
  if (o.status === 'completed') return { done: 4, current: -1 };
  if (o.status === 'ready') return { done: 2, current: 2 };
  if (o.status === 'accepted') return o.awaitingCash ? { done: 2, current: 2 } : { done: 1, current: 1 };
  return { done: 0, current: 0 };
};
const orderStatusText = (o) => {
  if (o.status === 'cancelled') return '✖ ملغي';
  if (o.status === 'completed') return '✅ تم';
  if (o.status === 'ready') return o.orderType === 'pickup' ? '✅ جاهز للاستلام' : '🛵 خرج للتوصيل';
  if (o.status === 'accepted') return o.awaitingCash ? '🛵 خرج للتوصيل' : '👨‍🍳 قيد التحضير';
  return '⏳ قيد الانتظار';
};
const OrderTracker = ({ order }) => {
  const st = orderStage(order);
  if (st.cancelled) return <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-xl px-3 py-2 text-sm font-bold text-center mb-3">✖ الأوردر ملغي</div>;
  const stages = TRACK_STAGES(order.orderType);
  return (
    <div className="mb-3">
      <div className="flex items-start">
        {stages.map((label, i) => (
          <div key={i} className="flex-1 flex flex-col items-center relative">
            {i > 0 && <div className={`absolute top-4 left-1/2 w-full h-0.5 ${i <= st.done ? 'bg-[#FFD700]' : 'bg-[#3A1218]'}`} />}
            <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black border-2 ${i < st.done ? 'bg-[#FFD700] text-black border-[#FFD700]' : i === st.current ? 'bg-[#800020] text-white border-[#FFD700] animate-pulse' : 'bg-[#12080A] text-zinc-500 border-[#3A1218]'}`}>{i < st.done ? '✓' : i + 1}</div>
            <span className={`text-[11px] font-bold mt-1 text-center leading-tight ${i === st.current ? 'text-[#FFD700]' : i < st.done ? 'text-zinc-300' : 'text-zinc-500'}`}>{label}</span>
          </div>
        ))}
      </div>
      {order.status === 'pending' && <p className="text-xs text-zinc-400 text-center mt-2">تم استلام طلبك، مستني تأكيد المطعم…</p>}
      {order.status === 'completed' && <p className="text-xs text-green-400 font-bold text-center mt-2">✅ طلبك اتسلم — بالهنا والشفا!</p>}
    </div>
  );
};

// إعادة الطلب بالأسعار الحالية: بنبني سعر الوحدة والاختيارات من المنيو الحالي،
// بنفس منطق السيرفر (priceOrderItemsFromCatalog) — السعر القديم مبيتاخدش أبداً.
const reorderGroupsForItem = (item) => {
  const groups = Array.isArray(item.modifierGroups) ? item.modifierGroups : [];
  if (groups.length > 0) return groups;
  const legacy = [];
  if (Array.isArray(item.sizes) && item.sizes.length > 0) legacy.push({ name: 'اختر الحجم', min: 1, max: 1, options: item.sizes });
  if (Array.isArray(item.addons) && item.addons.length > 0) legacy.push({ name: 'الإضافات الاختيارية', min: 0, max: item.addons.length, options: item.addons });
  return legacy;
};

const stripModPrice = (text) => String(text || '').replace(/\s*\(\s*\+?\s*\d+(?:\.\d+)?\s*ج\s*\)\s*$/, '').trim();

// يرجع { price, mods, name } بسعر اليوم، أو null لو الصنف مينفعش يتعاد زي ما هو
// (مثلاً حجم إجباري اتشال من المنيو، أو محتوى بوكس اتشال فبقى ناقص)
const buildReorderUnit = (cat, oldMods) => {
  const groups = reorderGroupsForItem(cat);
  // بوكس: الاختيارات "2× اسم الصنف" ولازم مجموعها = عدد الأصناف المطلوب
  if (cat.type === 'box' && Array.isArray(cat.boxItems) && cat.boxItems.length > 0 && groups.length === 0) {
    const allowed = new Set(cat.boxItems.map((b) => String(b.name || '').trim()));
    const picks = [];
    let total = 0;
    (Array.isArray(oldMods) ? oldMods : []).forEach((m) => {
      const mm = /^\s*(\d+)\s*×\s*(.+?)\s*$/.exec(String(m || ''));
      if (!mm) return;
      const name = mm[2].trim();
      const cnt = Number(mm[1]);
      if (!allowed.has(name) || cnt < 1) return;
      picks.push(`${cnt}× ${name}`);
      total += cnt;
    });
    const boxMax = Number(cat.maxItems) || 0;
    if (boxMax > 0 ? total !== boxMax : total === 0) return null;
    const detailsStr = picks.map((p) => { const mm = /^(\d+)× (.+)$/.exec(p); return `${mm[2]}: ${mm[1]}`; }).join(', ');
    return { price: getDiscountedPrice(cat.price, cat.discount), mods: picks, name: `${cat.name} (${detailsStr})` };
  }
  const selectionsByGroup = groups.map(() => []);
  (Array.isArray(oldMods) ? oldMods : []).forEach((modifier) => {
    const text = String(modifier || '').trim();
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const groupName = text.slice(0, colon).trim();
    const optionName = stripModPrice(text.slice(colon + 1));
    let gi = groups.findIndex((g) => String(g.name || '').trim() === groupName);
    if (gi < 0) gi = groups.findIndex((g) => (g.options || []).some((o) => String(o.name || '').trim() === optionName));
    if (gi < 0) return;
    const oi = (groups[gi].options || []).findIndex((o) => String(o.name || '').trim() === optionName);
    if (oi >= 0 && !selectionsByGroup[gi].includes(oi)) selectionsByGroup[gi].push(oi);
  });
  const legacyMode = !(Array.isArray(cat.modifierGroups) && cat.modifierGroups.length > 0);
  const legacySized = legacyMode && Array.isArray(cat.sizes) && cat.sizes.length > 0;
  let unitPrice = !legacySized && Number(cat.price) > 0 ? getDiscountedPrice(cat.price, cat.discount) : 0;
  const mods = [];
  let displayName = cat.name;
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    const selectedCount = selectionsByGroup[gi].length;
    const min = Number.isFinite(Number(group.min)) ? Number(group.min) : 0;
    const max = Number.isFinite(Number(group.max)) ? Number(group.max) : (group.options || []).length;
    if (selectedCount < min || selectedCount > max) return null;
    selectionsByGroup[gi].forEach((oi) => {
      const option = (group.options || [])[oi];
      if (!option) return;
      const optionPrice = legacyMode && group.name === 'الإضافات الاختيارية' ? Math.round(Number(option.price) || 0) : getDiscountedPrice(option.price, cat.discount);
      unitPrice += optionPrice;
      mods.push(`${group.name}: ${option.name}${optionPrice > 0 ? ` (+${optionPrice} ج)` : ''}`);
      if (legacyMode && group.name === 'اختر الحجم') displayName += ` (${option.name})`;
      if (legacyMode && group.name === 'الإضافات الاختيارية') displayName += ` - ${option.name}`;
    });
  }
  return { price: unitPrice, mods, name: displayName };
};

const MyOrdersPage = ({ cart, setCart }) => {
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(readCustomer);
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [loginPin, setLoginPin] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [ratings, setRatings] = useState({});
  const [ratingBusy, setRatingBusy] = useState('');
  const [ratingMsg, setRatingMsg] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinMsg, setPinMsg] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [reorderNote, setReorderNote] = useState('');

  const loadMe = async (token, silent = false) => {
    if (!silent) setLoading(true);
    setLoadError('');
    try {
      const res = await fetch(`${API_BASE}/api/customers/me`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        clearCustomer();
        setCustomer(null);
        return;
      }
      const data = await res.json();
      setProfile(data.profile || null);
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      const initial = {};
      (data.orders || []).forEach((o) => {
        if (o.rating) initial[o.orderId] = { stars: o.rating.stars, comment: o.rating.comment || '' };
      });
      setRatings(initial);
    } catch (err) {
      setLoadError('تعذر تحميل بياناتك، حاول تاني.');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (customer?.token) loadMe(customer.token);
  }, []);

  // تحديث حالة الطلبات لوحده كل 20 ثانية والصفحة مفتوحة (نفس أسلوب الشات — polling من غير WebSockets)
  useEffect(() => {
    if (!customer?.token) return undefined;
    const t = setInterval(() => { loadMe(customer.token, true); }, 20000);
    return () => clearInterval(t);
  }, [customer?.token]);

  const handleLogin = async () => {
    if (loginPhone.length !== 11 || !loginPin) return setLoginError('اكتب رقم التليفون (11 رقم) والرقم السري.');
    setLoginBusy(true);
    setLoginError('');
    try {
      const res = await fetch(`${API_BASE}/api/customers/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: loginPhone, pin: loginPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setLoginError(data.error || 'حصل خطأ، حاول تاني');
      const saved = { token: data.token, phone: loginPhone };
      saveCustomer(saved);
      setCustomer(saved);
      setLoginPin('');
      loadMe(data.token);
    } catch (err) {
      setLoginError('تعذر الاتصال بالسيرفر، حاول تاني.');
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = () => {
    clearCustomer();
    setCustomer(null);
    setProfile(null);
    setOrders([]);
  };

  const handleReorder = async (order) => {
    setReorderNote('');
    let fresh = [];
    try {
      const res = await fetch(`${API_BASE}/api/items`);
      fresh = await res.json();
    } catch (err) {
      return alert('تعذر تحميل المنيو، حاول تاني.');
    }
    if (!Array.isArray(fresh)) return alert('تعذر تحميل المنيو، حاول تاني.');
    const byId = new Map(fresh.map((i) => [String(i._id), i]));
    const added = [];
    const skipped = [];
    (order.items || []).forEach((it) => {
      const cat = byId.get(String(it.itemId));
      if (!cat || cat.available === false) { skipped.push(it.name); return; }
      // السعر والاختيارات من المنيو الحالي بسعر اليوم، مش من الأوردر القديم
      const built = buildReorderUnit(cat, it.modifiers);
      if (!built) { skipped.push(it.name); return; }
      const qty = Math.max(1, Math.min(99, Number(it.quantity) || 1));
      for (let q = 0; q < qty; q += 1) {
        added.push({ ...cat, name: built.name, price: built.price, _mods: built.mods });
      }
    });
    const skippedNote = skipped.length > 0 ? ('الأصناف دي مش متاحة دلوقتي ومتضافتش: ' + [...new Set(skipped)].join('، ')) : '';
    if (added.length > 0) {
      setCart([...cart, ...added]);
      // التنبيه بيسافر مع العميل لصفحة السلة عشان يشوفه (مبيفضلش على صفحة طلباتي بعد ما يمشي منها)
      navigate('/cart', skippedNote ? { state: { reorderNote: skippedNote } } : undefined);
      return;
    }
    if (skippedNote) setReorderNote(skippedNote);
    else setReorderNote('مفيش أصناف في الأوردر ده.');
  };

  const saveRating = async (orderId) => {
    const draft = ratings[orderId] || {};
    if (!draft.stars) return setRatingMsg('اختار عدد النجوم الأول.');
    setRatingBusy(orderId);
    setRatingMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/orders/${orderId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ stars: draft.stars, comment: draft.comment || '' })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setRatingMsg(data.error || 'حصل خطأ، حاول تاني');
      setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, rating: data.rating } : o)));
      setRatingMsg('شكراً! تقييمك اتسجل ✅');
    } catch (err) {
      setRatingMsg('تعذر الاتصال بالسيرفر، حاول تاني.');
    } finally {
      setRatingBusy('');
    }
  };

  const handleChangePin = async () => {
    if (!oldPin || !newPin) return setPinMsg('اكتب الرقم السري القديم والجديد.');
    setPinBusy(true);
    setPinMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/customers/change-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${customer.token}` },
        body: JSON.stringify({ oldPin, newPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setPinMsg(data.error || 'حصل خطأ، حاول تاني');
      setOldPin('');
      setNewPin('');
      setPinMsg('تم تغيير الرقم السري ✅');
    } catch (err) {
      setPinMsg('تعذر الاتصال بالسيرفر، حاول تاني.');
    } finally {
      setPinBusy(false);
    }
  };

  if (!customer?.token) {
    return (
      <section className="px-4 sm:px-8 py-12 max-w-lg mx-auto min-h-[60vh] bg-[#12080A] text-white">
        <h2 className="text-3xl font-black text-[#FFD700] mb-2 text-center">📋 طلباتي</h2>
        <p className="text-zinc-400 text-sm text-center mb-8 leading-relaxed">ادخل برقم تليفونك والرقم السري، وهتلاقي عنوانك وطلباتك القديمة.<br />لسه معندكش رقم سري؟ اكتبه وانت بتطلب أول أوردر وهيتحفظ لحسابك.</p>
        <div className="bg-[#1C0D10] rounded-2xl p-6 border border-[#3A1218] space-y-4 shadow-xl nkfx-rise">
          <div>
            <label className="block text-xs text-zinc-300 mb-1">رقم التليفون (11 رقم)</label>
            <input type="text" maxLength="11" placeholder="010xxxxxxxx" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value.replace(/\D/g, ''))} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-wider" />
          </div>
          <div>
            <label className="block text-xs text-zinc-300 mb-1">الرقم السري</label>
            <input type="password" inputMode="numeric" maxLength="6" placeholder="••••" value={loginPin} onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ''))} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-widest" />
          </div>
          {loginError && <p className="text-red-400 text-sm font-bold text-center">{loginError}</p>}
          <button onClick={handleLogin} disabled={loginBusy} className="w-full bg-[#800020] hover:bg-[#990026] disabled:opacity-50 text-white font-black py-3.5 rounded-xl transition shadow-lg active:scale-[0.97]">دخول</button>
          <p className="text-center text-zinc-500 text-xs">نسيت الرقم السري؟ كلّم المطعم وهنمسحهولك وتعمل واحد جديد مع أوردرك الجاي.</p>
          <Link to="/menu" className="block text-center text-[#FFD700] underline text-sm">أو اطلب من غير حساب ← المنيو</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 sm:px-8 py-12 max-w-4xl mx-auto min-h-screen bg-[#12080A] text-white">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-3xl font-black text-[#FFD700]">📋 طلباتي</h2>
        <button onClick={handleLogout} className="text-zinc-300 bg-[#1C0D10] border border-[#3A1218] px-4 py-2 rounded-xl text-sm font-bold transition active:scale-95">تسجيل الخروج</button>
      </div>

      {loading && <p className="text-center text-zinc-400">جارٍ التحميل...</p>}
      {loadError && <p className="text-center text-red-400 font-bold mb-4">{loadError}</p>}

      {profile && (
        <div className="bg-[#1C0D10] rounded-2xl p-5 border border-[#3A1218] mb-6 shadow-xl nkfx-rise">
          <h3 className="text-lg font-black text-[#FFD700] mb-3">👤 بياناتك المحفوظة</h3>
          <p className="text-sm text-zinc-300">الاسم: <strong className="text-white">{profile.name || '-'}</strong></p>
          <p className="text-sm text-zinc-300">التليفون: <strong className="text-white" dir="ltr">{profile.phone}</strong></p>
          <p className="text-sm text-zinc-300">العنوان: <strong className="text-white">{profile.address || '-'}</strong></p>
          <p className="text-sm text-zinc-300">المنطقة: <strong className="text-white">{profile.zoneName || '-'}</strong></p>
          <p className="text-xs text-zinc-500 mt-2">بياناتك دي هتتملي لوحدها وانت بتطلب الأوردر الجاي.</p>
        </div>
      )}

      {reorderNote && <div className="bg-[#FFD700]/10 border border-[#FFD700]/40 text-[#FFD700] rounded-xl p-3 text-sm font-bold mb-4 nkfx-fade">{reorderNote}</div>}
      {ratingMsg && <div className="bg-green-500/10 border border-green-500/40 text-green-400 rounded-xl p-3 text-sm font-bold mb-4 nkfx-fade">{ratingMsg}</div>}

      {profile && (
        <div className="bg-[#FFD700]/10 border border-[#FFD700]/40 rounded-2xl p-4 mb-4 flex flex-wrap justify-between items-center gap-2 nkfx-rise">
          <span className="font-black text-[#FFD700]">⭐ نقاطك: {Number(profile.points) || 0} نقطة</span>
          <span className="text-xs text-zinc-300">كل 10 جنيه في أوردر اتسلم = نقطة، وكل 100 نقطة = خصم 10 جنيه في أوردرك الجاي</span>
        </div>
      )}
      <h3 className="text-xl font-bold text-[#FFD700] mb-4">طلباتك اللي فاتت</h3>
      {!loading && orders.length === 0 && <p className="text-zinc-400 text-center py-8">لسه مفيش طلبات على الرقم ده.</p>}
      <div className="space-y-4 nkfx-stagger">
        {orders.map((o) => (
          <div key={o.orderId} className="bg-[#1C0D10] rounded-2xl p-5 border border-[#3A1218] shadow-xl nkfx-rise">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <span className="font-black text-[#FFD700]">#{o.orderId}</span>
              <span className="text-xs bg-[#12080A] border border-[#3A1218] px-2.5 py-1 rounded-full font-bold">{orderStatusText(o)}</span>
              <span className="text-xs text-zinc-500">{o.createdAt ? new Date(o.createdAt).toLocaleString('ar-EG') : ''}</span>
            </div>
            <OrderTracker order={o} />
            {o.status === 'completed' && (Number(o.pointsEarned) || 0) > 0 && (
              <p className="text-xs text-green-400 font-bold text-center mb-3">⭐ تم إضافة {o.pointsEarned} نقطة، تقدر تستبدلهم بخصم</p>
            )}
            <div className="space-y-1 text-sm text-zinc-300 mb-3">
              {(o.items || []).map((it, idx) => (
                <div key={idx} className="flex justify-between gap-2">
                  <span>{it.quantity}× {it.name}</span>
                  <span className="text-[#FFD700] font-bold">{(Number(it.price) || 0) * (Number(it.quantity) || 1)} ج</span>
                </div>
              ))}
              <div className="flex justify-between pt-2 border-t border-[#3A1218] font-bold">
                <span>الإجمالي:</span>
                <span className="text-[#FFD700]">{o.grandTotal} ج</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleReorder(o)} className="flex-1 min-w-[140px] bg-[#800020] hover:bg-[#990026] text-white font-black py-2.5 rounded-xl text-sm transition active:scale-[0.97]">🔁 اطلب نفس الطلب</button>
            </div>
            {o.status === 'completed' && !o.rating && (
              <div className="mt-4 pt-4 border-t border-[#3A1218]">
                <p className="text-sm font-bold text-[#FFD700] mb-2">قيّم الأوردر:</p>
                <div className="flex gap-1.5 mb-3">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} onClick={() => setRatings((prev) => ({ ...prev, [o.orderId]: { ...(prev[o.orderId] || {}), stars: s } }))} className="text-3xl leading-none transition hover:scale-110 active:scale-125">
                      {((ratings[o.orderId]?.stars) || 0) >= s ? '⭐' : '☆'}
                    </button>
                  ))}
                </div>
                <textarea rows="2" maxLength="300" placeholder="تعليق اختياري..." value={ratings[o.orderId]?.comment || ''} onChange={(e) => setRatings((prev) => ({ ...prev, [o.orderId]: { ...(prev[o.orderId] || {}), comment: e.target.value } }))} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm mb-2" />
                <button onClick={() => saveRating(o.orderId)} disabled={ratingBusy === o.orderId} className="bg-[#FFD700] text-black font-black px-6 py-2.5 rounded-xl text-sm disabled:opacity-50 transition active:scale-[0.97]">
                  إرسال التقييم
                </button>
              </div>
            )}
            {o.status === 'completed' && o.rating && (
              <div className="mt-4 pt-4 border-t border-[#3A1218]">
                <span className="text-xs text-zinc-400">تقييمك الحالي: {'★'.repeat(o.rating.stars)}{'☆'.repeat(5 - o.rating.stars)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-[#1C0D10] rounded-2xl p-5 border border-[#3A1218] mt-8 shadow-xl nkfx-rise">
        <h3 className="text-lg font-black text-[#FFD700] mb-3">🔐 تغيير الرقم السري</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input type="password" inputMode="numeric" maxLength="6" placeholder="الرقم السري القديم" value={oldPin} onChange={(e) => setOldPin(e.target.value.replace(/\D/g, ''))} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-widest" />
          <input type="password" inputMode="numeric" maxLength="6" placeholder="الرقم السري الجديد (4-6 أرقام)" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-widest" />
        </div>
        {pinMsg && <p className="text-sm font-bold mt-3 text-center text-zinc-300">{pinMsg}</p>}
        <button onClick={handleChangePin} disabled={pinBusy} className="mt-3 bg-[#1C0D10] border border-[#FFD700] text-[#FFD700] font-black px-6 py-2.5 rounded-xl text-sm disabled:opacity-50 transition active:scale-[0.97]">تغيير الرقم السري</button>
      </div>
    </section>
  );
};

// ================= 4. صفحة السلة وإدخال بيانات التوصيل =================
// وقت التوصيل المتوقع: 30 دقيقة أساس + 5 دقايق لكل أوردر نشط في المطبخ، بحد أقصى 90 دقيقة — بيتعرض كنطاق
const deliveryEtaMinutes = (activeOrders) => Math.min(90, 30 + 5 * Math.max(0, Number(activeOrders) || 0));
const deliveryEtaText = (activeOrders) => {
  const eta = deliveryEtaMinutes(activeOrders);
  if (eta >= 90) return 'حوالي 90 دقيقة';
  return `${eta}–${Math.min(90, eta + 15)} دقيقة`;
};

const CartPage = ({ cart, setCart, lang, storeStatus }) => {
  const storeClosed = !!storeStatus && storeStatus.isOpen === false;
  const t = translations[lang];
  const location = useLocation();
  // تنبيه إعادة الطلب: الأصناف اللي متضافتش لأنها مش متاحة دلوقتي
  const [reorderNotice, setReorderNotice] = useState(location.state?.reorderNote || '');
  const itemsTotal = cart.reduce((sum, item) => sum + item.price, 0);

  const [orderType, setOrderType] = useState('delivery');
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState(null);

  // عدد الأوردرات النشطة في المطبخ دلوقتي — عشان وقت التوصيل المتوقع (رقم بس من السيرفر، ولو مجاش بنعرض الوقت الأساسي ومفيش حاجة بتوقف الطلب)
  const [activeOrders, setActiveOrders] = useState(null);
  useEffect(() => {
    fetch(`${API_BASE}/api/delivery-eta`)
      .then((r) => r.json().catch(() => null))
      .then((d) => { if (d && typeof d.activeOrders === 'number') setActiveOrders(d.activeOrders); })
      .catch(() => {});
  }, []);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  const [placedOrderId, setPlacedOrderId] = useState(null);
  const [phoneInfo, setPhoneInfo] = useState(null);
  // آخر بيانات اتعبّت لوحدها من البحث بالرقم — عشان نمسحها بس لو الرقم اتغيّر، ومنمسحش اللي العميل كتبه بنفسه
  const autofilledRef = useRef({ name: '', address: '' });
  const [confirmOpen, setConfirmOpen] = useState(false);

  // حساب العميل (اختياري): لو داخل بحسابه بنملا بياناته المحفوظة، ولو كتب رقم سري جديد بيتحفظ لحسابه
  const [customerPin, setCustomerPin] = useState('');
  const [accountSaved, setAccountSaved] = useState(false);
  const [loggedInCustomer, setLoggedInCustomer] = useState(() => readCustomer());
  const [savedZoneName, setSavedZoneName] = useState('');

  // نقاط الولاء وكود الخصم
  const [customerPoints, setCustomerPoints] = useState(0);
  const [loyaltyBlocks, setLoyaltyBlocks] = useState(0);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null); // {code,type,value,discountAmount}
  const [promoMsg, setPromoMsg] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/zones`)
      .then(res => res.json())
      .then(data => {
        setDeliveryZones(data);
        if (data.length > 0) setSelectedZone(data[0]);
      })
      .catch(err => {});
  }, []);

  // لو العميل داخل بحسابه: نملا بياناته المحفوظة لوحده (من غير ما نمسح حاجة كتبها بنفسه)
  useEffect(() => {
    const saved = readCustomer();
    if (!saved?.token) return;
    fetch(`${API_BASE}/api/customers/me`, { headers: { Authorization: `Bearer ${saved.token}` } })
      .then((res) => {
        if (res.status === 401) { clearCustomer(); setLoggedInCustomer(null); return null; }
        return res.json();
      })
      .then((data) => {
        if (!data?.profile) return;
        const p = data.profile;
        setCustomerName((prev) => (prev.trim() ? prev : (p.name || '')));
        setCustomerPhone((prev) => (prev.trim() ? prev : (p.phone || '')));
        setCustomerAddress((prev) => (prev.trim() ? prev : (p.address || '')));
        if (p.zoneName) setSavedZoneName(p.zoneName);
        setCustomerPoints(Number(p.points) || 0);
      })
      .catch(() => {});
  }, []);

  // لو الرقم ده عميل سابق: نجيب اسمه (ولو موثّق بيتعبّى لوحده)، ولو رقم جديد بننبّه إن الكاشير هيتصل لتأكيده — زي بحبح
  useEffect(() => {
    setPhoneInfo(null);
    // امسح بس البيانات اللي كانت متعبّية من الرقم السابق — لو العميل كتب اسمه/عنوانه بنفسه متتمسحش
    setCustomerName((prev) => (prev === autofilledRef.current.name ? '' : prev));
    setCustomerAddress((prev) => (prev === autofilledRef.current.address ? '' : prev));
    autofilledRef.current = { name: '', address: '' };
    if (!isEgMobile(customerPhone) || isFakeEgPhone(customerPhone)) return;
    let cancelled = false;
    const runPublicLookup = () => {
      fetch(`${API_BASE}/api/customers/lookup?phone=${customerPhone}`).then(r => {
        // لو اتقفلنا من كتر الطلبات (429) نكمّل كأن الرقم جديد — البحث ميوقفش الطلب أبداً
        if (r.status === 429) return { ok: true, name: '' };
        return r.json().catch(() => null);
      }).then(d => {
        if (cancelled || !d) return;
        // الرد الموحّد: اسم فاضي = رقم جديد → مسار توثيق المكالمة، اسم موجود = عميل راجع
        if (!d.name) { setPhoneInfo({ needsCallVerification: true }); return; }
        setPhoneInfo(d);
        setCustomerName(d.name || '');
        autofilledRef.current.name = d.name || '';
        if (orderType === 'delivery') {
          setCustomerAddress(d.address || '');
          autofilledRef.current.address = d.address || '';
          const z = d.zoneName ? deliveryZones.find(x => x.name === d.zoneName) : null;
          if (z) setSelectedZone(z);
        }
      }).catch(() => {});
    };
    // عميل مسجّل دخول برقمه: نجيب بياناته الكاملة المحفوظة من حسابه (مش البحث العام اللي بيرجع الاسم بس)
    const session = readCustomer();
    if (session && session.token && session.phone === customerPhone) {
      fetch(`${API_BASE}/api/customers/me`, { headers: { Authorization: `Bearer ${session.token}` } }).then(async (r) => {
        if (r.status === 401) { clearCustomer(); setLoggedInCustomer(null); return null; }
        return r.json().catch(() => null);
      }).then(d => {
        if (cancelled) return;
        if (!d || !d.profile) { runPublicLookup(); return; }
        const p = d.profile;
        setPhoneInfo({ known: true, name: p.name || '' });
        setCustomerName(p.name || '');
        autofilledRef.current.name = p.name || '';
        if (orderType === 'delivery') {
          setCustomerAddress(p.address || '');
          autofilledRef.current.address = p.address || '';
          const z = p.zoneName ? deliveryZones.find(x => x.name === p.zoneName) : null;
          if (z) setSelectedZone(z);
        }
      }).catch(() => { if (!cancelled) runPublicLookup(); });
      return () => { cancelled = true; };
    }
    runPublicLookup();
    return () => { cancelled = true; };
  }, [customerPhone, deliveryZones, orderType]);

  useEffect(() => {
    if (savedZoneName && deliveryZones.length > 0) {
      const match = deliveryZones.find((z) => z.name === savedZoneName);
      if (match) setSelectedZone(match);
    }
  }, [deliveryZones, savedZoneName]);

  const groupedCart = cart.reduce((acc, item) => {
    const existing = acc.find(i => i.name === item.name);
    if (existing) {
      existing.quantity += 1;
    } else {
      acc.push({ ...item, quantity: 1 });
    }
    return acc;
  }, []);

  const deliveryFee = orderType === 'delivery' && selectedZone ? selectedZone.fee : 0;
  const grandTotal = itemsTotal + deliveryFee;

  // خصم الكود والنقاط (خصم واحد بس في الأوردر) — السيرفر بيراجعهم تاني قبل الحفظ
  const promoDiscount = appliedPromo ? Math.min(Number(appliedPromo.discountAmount) || 0, itemsTotal) : 0;
  const maxLoyaltyBlocks = Math.max(0, Math.min(Math.floor((Number(customerPoints) || 0) / 100), Math.floor(Math.max(0, itemsTotal - promoDiscount) / 10)));
  const loyaltyDiscount = Math.min(loyaltyBlocks, maxLoyaltyBlocks) * 10;
  const finalTotal = Math.max(0, itemsTotal - promoDiscount - loyaltyDiscount + deliveryFee);

  const setCartNoteForName = (name, text) => {
    const note = String(text || '').slice(0, 200);
    setCart((prev) => prev.map((l) => (l.name === name ? { ...l, notes: note } : l)));
  };

  const applyPromo = async () => {
    const code = promoInput.trim().toUpperCase();
    if (!code) return setPromoMsg('اكتب الكود الأول');
    if (loyaltyBlocks > 0) return setPromoMsg('اختار خصم واحد بس: الكود أو النقاط');
    setPromoBusy(true); setPromoMsg('');
    try {
      const r = await fetch(`${API_BASE}/api/promo-codes/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, itemsTotal, itemIds: cart.map((c) => c._id) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setPromoMsg(d.error || 'الكود مش صحيح');
      setAppliedPromo(d); setPromoMsg(`✅ اتطبق خصم ${d.type === 'amount' ? `${d.discountAmount} ج` : `${d.value}% (${d.discountAmount} ج)`}`);
    } catch { setPromoMsg('تعذر التحقق من الكود، حاول تاني'); }
    finally { setPromoBusy(false); }
  };

  // لو الأصناف اتغيرت بعد تطبيق الكود/النقاط، نلغي الخصم عشان العميل يطبقه من جديد على المجموع الجديد
  const cartSig = cart.map((l) => `${l._id}:${l.price}`).sort().join('|');
  useEffect(() => { setAppliedPromo(null); setPromoMsg(''); setLoyaltyBlocks(0); }, [cartSig]);

  const handleIncrease = (itemName) => {
    const itemToAdd = cart.find(i => i.name === itemName);
    if (itemToAdd) setCart([...cart, { ...itemToAdd }]);
  };

  const handleDecrease = (itemName) => {
    const indexToRemove = cart.findIndex(i => i.name === itemName);
    if (indexToRemove !== -1) {
      const newCart = [...cart];
      newCart.splice(indexToRemove, 1);
      setCart(newCart);
    }
  };

  const handleRemoveCompletely = (itemName) => {
    setCart(cart.filter(i => i.name !== itemName));
  };

  // قبل الإرسال: نراجع البيانات ونطلب من العميل يتأكد من رقمه — زي بحبح
  const requestSend = () => {
    if (cart.length === 0) return alert("السلة فارغة!");
    if (!customerName.trim()) return alert("من فضلك اكتب اسمك الكامل.");
    if (!isEgMobile(customerPhone)) return alert("من فضلك اكتب رقم موبايل صحيح مكون من 11 رقم بيبدأ بـ 01.");
    if (isFakeEgPhone(customerPhone)) return alert("الرقم ده شكله مش حقيقي. اكتب رقمك الصح عشان نقدر نتواصل معاك.");
    if (orderType === 'delivery' && !customerAddress.trim()) return alert("من فضلك اكتب عنوان الاستلام بالتفصيل.");
    if (customerPin && (customerPin.length < 4 || customerPin.length > 6)) return alert("الرقم السري لازم يكون من 4 لـ 6 أرقام، أو سيبه فاضي.");
    trackFbq('InitiateCheckout', { value: Number(finalTotal) || Number(itemsTotal) || 0, currency: 'EGP', num_items: cart.length });
    setConfirmOpen(true);
  };

  const sendOrderToWhatsApp = async () => {
    if (cart.length === 0) return alert("السلة فارغة!");
    if (!customerName.trim()) return alert("من فضلك اكتب اسمك الكامل.");
    if (!isEgMobile(customerPhone) || isFakeEgPhone(customerPhone)) {
      return alert("من فضلك اكتب رقم تليفون صحيح مكون من 11 رقم.");
    }
    if (customerPin && (customerPin.length < 4 || customerPin.length > 6)) {
      return alert("الرقم السري لازم يكون من 4 لـ 6 أرقام، أو سيبه فاضي.");
    }
    if (orderType === 'delivery' && !customerAddress.trim()) {
      return alert("من فضلك اكتب عنوان الاستلام بالتفصيل.");
    }

    // نفتح نافذة الواتساب فوراً (قبل أي انتظار) عشان المتصفح مايحجبهاش
    const waWindow = window.open('', '_blank');

    // نتأكد إن مفيش صنف في السلة خلص بعد ما العميل ضافه
    try {
      const freshRes = await fetch(`${API_BASE}/api/items`);
      const fresh = await freshRes.json();
      if (Array.isArray(fresh)) {
        const offIds = fresh.filter(i => i.available === false).map(i => String(i._id));
        const bad = cart.filter(c => offIds.includes(String(c._id)));
        if (bad.length > 0) {
          if (waWindow) waWindow.close();
          return alert('للأسف الأصناف دي خلصت حالياً: ' + [...new Set(bad.map(b => b.name))].join('، ') + '\nشيلها من السلة وكمّل الطلب.');
        }
      }
    } catch (err) {}

    const orderId = 'NK-' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90);

    const orderPayload = {
      orderId,
      customerName,
      customerPhone,
      pin: customerPin || undefined,
      orderType,
      customerAddress: orderType === 'delivery' ? customerAddress : 'استلام من الفرع',
      zoneName: orderType === 'delivery' && selectedZone ? selectedZone.name : 'استلام من الفرع',
      deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
      items: groupedCart.map(({ _id, name, price, quantity, _mods, notes }) => ({ itemId: _id, name, price, quantity, modifiers: _mods || [], notes: notes || '' })),
      itemsTotal,
      grandTotal: finalTotal,
      promoCode: appliedPromo?.code || undefined,
      loyaltyBlocks: loyaltyBlocks > 0 ? loyaltyBlocks : undefined,
      customerToken: loggedInCustomer?.token || undefined,
      ...getStoredUtm()
    };

    // إرسال الأوردر لشاشة الكاشير (السيرفر)
    try {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderPayload)
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        if (response.status >= 400 && response.status < 500) {
          if (waWindow) waWindow.close();
          return alert(errData.error || 'حصل خطأ، حاول تاني');
        }
        console.warn("Server error when saving order, WhatsApp will still open.");
      } else {
        const savedData = await response.json().catch(() => null);
        trackFbq('Purchase', { value: Number(finalTotal) || 0, currency: 'EGP', content_ids: groupedCart.map((i) => String(i._id || i.name)), content_type: 'product', num_items: groupedCart.length });
        if (savedData?.customerToken) {
          saveCustomer({ token: savedData.customerToken, phone: customerPhone });
          setLoggedInCustomer({ token: savedData.customerToken, phone: customerPhone });
          setAccountSaved(true);
        }
      }
    } catch (err) {
      console.error("Network error while saving order to database:", err);
    }

    let message = `🔥 أهلاً (نص كفتة)، عندي أوردر جديد!\n`;
    message += `🆔 *رقم الأوردر:* #${orderId}\n\n`;
    message += `👤 *الاسم:* ${customerName}\n`;
    message += `📞 *التليفون:* ${customerPhone}\n`;
    message += `📦 *نوع الاستلام:* ${orderType === 'delivery' ? 'توصيل دليفري 🛵' : 'استلام من الفرع 🏪'}\n`;
    
    if (orderType === 'delivery') {
      message += `📍 *العنوان:* ${customerAddress}\n`;
      if (selectedZone) {
        message += `🚚 *منطقة التوصيل:* ${selectedZone.name} (${selectedZone.fee} ج)\n`;
      }
    }

    message += `\n🛒 *الأصناف المطلوبة:*\n`;
    groupedCart.forEach((item) => {
      message += `▪️ ${item.quantity}× ${item.name} — (${item.price * item.quantity} ج)\n`;
      if (item.notes) message += `   📝 ${item.notes}\n`;
    });

    message += `\n-------------------\n`;
    message += `🏷️ *قيمة الأصناف:* ${itemsTotal} ج\n`;
    if (promoDiscount > 0) message += `🎟️ *خصم الكود (${appliedPromo.code}):* -${promoDiscount} ج\n`;
    if (loyaltyDiscount > 0) message += `⭐ *خصم النقاط:* -${loyaltyDiscount} ج\n`;
    if (orderType === 'delivery') {
      message += `🚚 *سعر التوصيل:* ${deliveryFee} ج\n`;
    }
    message += `💰 *الإجمالي النهائي: ${finalTotal} جنيه*\n`;
    
    const whatsappUrl = `https://wa.me/201042258982?text=${encodeURIComponent(message)}`;
    if (waWindow) {
      waWindow.location.href = whatsappUrl;
    } else {
      window.location.href = whatsappUrl;
    }

    setCart([]);
    clearCustomerCart();
    setAppliedPromo(null); setPromoInput(''); setPromoMsg(''); setLoyaltyBlocks(0);
    setPlacedOrderId(orderId);
  };

  if (placedOrderId) {
    return (
      <section className="px-8 py-12 max-w-4xl mx-auto min-h-[60vh] bg-[#12080A] text-white flex flex-col items-center justify-center">
        <div className="bg-[#1C0D10] border border-[#25D366] rounded-2xl p-10 text-center shadow-[0_0_20px_rgba(37,211,102,0.2)] nkfx-panel w-full">
          <div className="text-7xl mb-4">✅</div>
          <h2 className="text-3xl font-black text-[#25D366] mb-4">تم إرسال طلبك بنجاح!</h2>
          <p className="text-xl mb-6 text-zinc-300">رقم الأوردر بتاعك هو:</p>
          <div className="bg-[#12080A] border-2 border-[#FFD700] text-[#FFD700] text-4xl font-black py-4 px-8 rounded-xl inline-block mb-8 tracking-widest">
            {placedOrderId}
          </div>
          <p className="text-sm text-zinc-400 mb-8">تم تحويلك للواتساب لإرسال الطلب للمطعم.</p>
          {accountSaved && <p className="text-sm text-green-400 font-bold mb-8">🔐 بياناتك اتحفظت في حسابك — المرة الجاية ادخل من «طلباتي» وهتلاقي عنوانك وطلباتك جاهزة.</p>}
          <button 
            onClick={() => setPlacedOrderId(null)} 
            className="text-white bg-[#800020] hover:bg-[#990026] px-8 py-3 rounded-xl font-bold transition shadow-lg active:scale-[0.97]"
          >
            رجوع للسلة
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto min-h-screen bg-[#12080A] text-white">
      <h2 className="text-3xl font-bold text-[#FFD700] mb-8 border-b border-[#3A1218] pb-4">{t.cart}</h2>
      {reorderNotice && (
        <div className="bg-[#FFD700]/10 border border-[#FFD700]/40 text-[#FFD700] rounded-xl p-3 text-sm font-bold mb-4 nkfx-fade flex justify-between items-start gap-3">
          <span>{reorderNotice}</span>
          <button onClick={() => setReorderNotice('')} className="text-[#FFD700] font-black shrink-0">✕</button>
        </div>
      )}
      
      {cart.length === 0 ? (
        <div className="border border-[#3A1218] bg-[#1C0D10] rounded-2xl p-10 text-center shadow-xl nkfx-rise">
          <div className="text-zinc-600 text-6xl mb-4">🛒</div>
          <h2 className="text-2xl font-bold text-zinc-400 mb-4">{t.emptyCart}</h2>
          <Link to="/menu" className="text-[#FFD700] underline hover:text-white">{t.backToMenu}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-[#1C0D10] rounded-2xl p-6 border border-[#3A1218] shadow-xl nkfx-rise">
            <h3 className="text-xl font-bold text-[#FFD700] mb-4">محتويات السلة</h3>
            <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
              {groupedCart.map((item, index) => (
                <div key={index} className="flex justify-between items-center border-b border-[#3A1218] pb-3 nkfx-fade">
                  <div className="flex-1">
                    <h4 className="text-base font-bold text-white">{item.name}</h4>
                    <p className="text-[#FFD700] font-bold text-sm">{item.price * item.quantity} ج</p>
                    {item._mods && item._mods.length > 0 && <p className="text-[11px] text-zinc-400">{item._mods.join('، ')}</p>}
                    <input value={item.notes || ''} onChange={(e) => setCartNoteForName(item.name, e.target.value)} placeholder="📝 ملاحظة للصنف (اختياري) — مثال: من غير بصل" className="mt-1 w-full bg-[#12080A] border border-[#3A1218] rounded-lg px-2 py-1.5 text-white text-[11px]" />
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-[#12080A] border border-[#3A1218] rounded-xl px-2 py-1 gap-3">
                      <button onClick={() => handleDecrease(item.name)} className="text-[#FFD700] font-black text-lg hover:text-white transition active:scale-90">-</button>
                      <span className="font-black text-white">{item.quantity}</span>
                      <button onClick={() => handleIncrease(item.name)} className="text-[#FFD700] font-black text-lg hover:text-white transition active:scale-90">+</button>
                    </div>
                    
                    <button onClick={() => handleRemoveCompletely(item.name)} className="text-red-400 bg-red-500/10 px-2.5 py-1.5 rounded-lg text-xs font-bold hover:bg-red-500/20 transition active:scale-90">❌</button>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="mt-6 pt-4 border-t border-[#3A1218] space-y-2 text-sm text-zinc-300">
              <div className="flex justify-between"><span>سعر الأصناف:</span><span className="font-bold text-white">{itemsTotal} ج</span></div>
              {orderType === 'delivery' && (
                <div className="flex justify-between"><span>سعر التوصيل:</span><span className="font-bold text-[#FFD700]">{deliveryFee} ج</span></div>
              )}
              {orderType === 'delivery' && (
                <div className="flex justify-between"><span>⏱️ وقت التوصيل المتوقع:</span><span className="font-bold text-[#FFD700]">{deliveryEtaText(activeOrders)}</span></div>
              )}
              {promoDiscount > 0 && (
                <div className="flex justify-between"><span>🎟️ خصم الكود ({appliedPromo.code}):</span><span className="font-bold text-green-400">-{promoDiscount} ج</span></div>
              )}
              {loyaltyDiscount > 0 && (
                <div className="flex justify-between"><span>⭐ خصم النقاط:</span><span className="font-bold text-green-400">-{loyaltyDiscount} ج</span></div>
              )}
              <div className="pt-2 border-t border-[#3A1218]">
                <label className="block text-xs text-zinc-300 mb-1">🎟️ عندك كود خصم؟</label>
                {appliedPromo ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 bg-[#12080A] border border-green-500/50 rounded-xl px-3 py-2 text-green-400 text-sm font-bold">✅ {appliedPromo.code}</span>
                    <button type="button" onClick={() => { setAppliedPromo(null); setPromoMsg(''); }} className="text-red-400 text-xs font-bold underline">إلغاء</button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input value={promoInput} onChange={(e) => setPromoInput(e.target.value.toUpperCase())} placeholder="اكتب الكود" className="flex-1 bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm tracking-widest" dir="ltr" />
                    <button type="button" onClick={applyPromo} disabled={promoBusy || loyaltyBlocks > 0} className="bg-[#800020] hover:bg-[#990026] disabled:opacity-50 text-white font-bold px-4 rounded-xl text-sm">تطبيق</button>
                  </div>
                )}
                {promoMsg && <p className="text-[11px] mt-1 font-bold text-zinc-300">{promoMsg}</p>}
                {loyaltyBlocks > 0 && !appliedPromo && <p className="text-[11px] mt-1 text-zinc-500">الكود مش بيتجمع مع خصم النقاط.</p>}
              </div>
              {loggedInCustomer?.token ? (
                <div className="pt-2 border-t border-[#3A1218]">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-zinc-300">⭐ نقاطك: <b className="text-[#FFD700]">{Number(customerPoints) || 0} نقطة</b></span>
                    <span className="text-[11px] text-zinc-500">كل 100 نقطة = خصم 10 ج</span>
                  </div>
                  {maxLoyaltyBlocks > 0 ? (
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={loyaltyBlocks <= 0 || !!appliedPromo} onClick={() => setLoyaltyBlocks((b) => Math.max(0, b - 1))} className="w-8 h-8 bg-[#12080A] border border-[#3A1218] rounded-lg text-[#FFD700] font-black disabled:opacity-40">-</button>
                      <span className="flex-1 text-center text-sm font-bold text-white">{loyaltyBlocks > 0 ? `هتستبدل ${loyaltyBlocks * 100} نقطة ← خصم ${loyaltyDiscount} ج` : 'استبدل نقاطك بخصم'}</span>
                      <button type="button" disabled={loyaltyBlocks >= maxLoyaltyBlocks || !!appliedPromo} onClick={() => setLoyaltyBlocks((b) => Math.min(maxLoyaltyBlocks, b + 1))} className="w-8 h-8 bg-[#12080A] border border-[#3A1218] rounded-lg text-[#FFD700] font-black disabled:opacity-40">+</button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-500">لسه معندكش نقاط كفاية للاستبدال (100 نقطة = خصم 10 جنيه).</p>
                  )}
                  {appliedPromo && <p className="text-[11px] mt-1 text-zinc-500">النقاط مش بتتجمع مع كود الخصم.</p>}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-500 pt-2 border-t border-[#3A1218]">💡 سجّل دخول من «طلباتي» عشان تجمع نقاط وتستبدلها بخصم.</p>
              )}
              {orderType === 'delivery' && !selectedZone && (
                <p className="text-[11px] text-zinc-400">الوقت تقريبي وبيعتمد على منطقة التوصيل.</p>
              )}
          </div>

          <div className="mt-4 pt-4 border-t-2 border-[#800020] flex justify-between items-center">
            <span className="text-lg font-bold">{t.total}</span>
            <span className="text-2xl font-black text-[#FFD700]">{finalTotal} جنيه</span>
          </div>
        </div>

        <div className="bg-[#1C0D10] rounded-2xl p-6 border border-[#3A1218] flex flex-col justify-between shadow-xl nkfx-rise">
          <div className="space-y-4">
            <h3 className="text-xl font-bold text-[#FFD700] mb-2">بيانات التوصيل والاستلام</h3>
            
            <div className="grid grid-cols-2 gap-3 mb-2">
              <button 
                type="button"
                onClick={() => setOrderType('delivery')}
                className={`py-3 rounded-xl font-bold text-sm transition active:scale-[0.97] ${orderType === 'delivery' ? 'bg-[#800020] text-white border border-[#FFD700]' : 'bg-[#12080A] text-zinc-400 border border-[#3A1218]'}`}
              >
                🛵 توصيل دليفري
              </button>
              <button 
                type="button"
                onClick={() => setOrderType('pickup')}
                className={`py-3 rounded-xl font-bold text-sm transition active:scale-[0.97] ${orderType === 'pickup' ? 'bg-[#800020] text-white border border-[#FFD700]' : 'bg-[#12080A] text-zinc-400 border border-[#3A1218]'}`}
              >
                🏪 استلام من الفرع
              </button>
          </div>

          <div>
            <label className="block text-xs text-zinc-300 mb-1">الاسم الكامل *</label>
            <input type="text" placeholder="اكتب اسمك..." value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs text-zinc-300 mb-1">رقم التليفون (11 رقم) *</label>
            <input type="text" inputMode="numeric" maxLength="11" autoComplete="tel" placeholder="010xxxxxxxx" value={customerPhone} onChange={(e) => setCustomerPhone(normalizeEgPhoneInput(e.target.value))} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-wider" dir="ltr" />
                {customerPhone.length === 11 && isFakeEgPhone(customerPhone) && <p className="text-xs text-red-400 mt-1">الرقم ده شكله مش حقيقي، اكتب رقمك الصح.</p>}
                {customerPhone.length === 11 && !isEgMobile(customerPhone) && <p className="text-xs text-red-400 mt-1">لازم يبدأ بـ 010 أو 011 أو 012 أو 015.</p>}
                {customerPhone.length === 11 && isEgMobile(customerPhone) && !isFakeEgPhone(customerPhone) && phoneInfo?.needsCallVerification && <p className="text-xs text-amber-300 mt-1">أول مرة؟ الكاشير هيتصل لتأكيد الرقم، وبعدها بياناتك هتتحفظ للطلبات الجاية.</p>}
                {phoneInfo?.name && <p className="text-xs text-green-400 mt-1">✅ أهلاً بيك تاني{phoneInfo.name ? ` يا ${phoneInfo.name}` : ''}! جبنالك بياناتك المحفوظة.</p>}
          </div>

          {!loggedInCustomer?.token && (
            <div>
              <label className="block text-xs text-zinc-300 mb-1">رقم سري (4 أرقام) — اختياري</label>
              <input type="password" inputMode="numeric" maxLength="6" placeholder="••••" value={customerPin} onChange={(e) => setCustomerPin(e.target.value.replace(/\D/g, ''))} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm tracking-widest" />
              <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">اختياري — احفظ بياناتك وطلباتك، وادخل بيه المرة الجاية من «طلباتي». من غيره الطلب بيتبعت كضيف عادي.</p>
            </div>
          )}

          {orderType === 'delivery' && (
            <>
              <div>
                <label className="block text-xs text-zinc-300 mb-1">اختر منطقة التوصيل *</label>
                <select 
                  value={selectedZone ? selectedZone._id : ''}
                  onChange={(e) => {
                    const zone = deliveryZones.find(z => z._id === e.target.value);
                    setSelectedZone(zone);
                  }}
                  className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm cursor-pointer"
                >
                  {deliveryZones.map(zone => (
                    <option key={zone._id} value={zone._id}>
                      {zone.name} ({zone.fee} جنيه)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-zinc-300 mb-1">العنوان بالتفصيل *</label>
                <textarea rows="2" placeholder="الشارع، رقم العمارة، الدور..." value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm" />
              </div>
            </>
          )}
        </div>

        {confirmOpen && (
          <div className="nkfx-fade fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
            <div dir="rtl" className="nkfx-rise bg-[#1C0D10] border border-[#800020] rounded-3xl w-full max-w-sm p-6 text-center space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-xl font-black text-[#FFD700]">تأكيد رقم التليفون</h3>
              <p className="text-zinc-300 text-sm">هنتواصل معاك على الرقم ده لتأكيد الأوردر. اتأكد إنه صح:</p>
              <div className="text-3xl font-black text-white tracking-widest" dir="ltr">{customerPhone}</div>
              <p className="text-xs text-zinc-400">{customerName}{orderType === 'delivery' ? ` — ${customerAddress}` : ' — استلام من الفرع'}</p>
              <div className="flex gap-3">
                <button type="button" onClick={() => setConfirmOpen(false)} className="flex-1 py-3 rounded-xl bg-zinc-700 text-white font-bold transition active:scale-[0.98]">✏️ تعديل</button>
                <button type="button" onClick={() => { setConfirmOpen(false); sendOrderToWhatsApp(); }} className="flex-1 py-3 rounded-xl bg-[#25D366] text-black font-black transition active:scale-[0.98]">✅ الرقم صح، ابعت</button>
              </div>
            </div>
          </div>
        )}
        {storeClosed && (
          <div className="mt-6 bg-[#800020]/20 border border-[#800020] text-[#FFD700] rounded-xl p-4 text-sm font-bold text-center leading-relaxed">🌙 {storeStatus.message}</div>
        )}
        <button onClick={requestSend} disabled={storeClosed} className={`w-full font-black text-lg py-4 rounded-xl transition mt-4 flex items-center justify-center gap-2 shadow-lg active:scale-[0.97] ${storeClosed ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-[#25D366] text-black hover:bg-[#20bd5a] cursor-pointer'}`}>
          {storeClosed ? '🌙 الطلب مقفول دلوقتي' : t.whatsappOrder}
        </button>
      </div>
    </div>
  )}
    </section>
  );
};

// ================= مساعدات الأرشيف والشيفت =================
const dayKeyOf = (v) => {
  const d = new Date(v);
  d.setHours(d.getHours() - 6); // يوم الشغل من 6 الصبح لـ 6 الصبح زي السيرفر، مش اليوم الميلادي
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayLabelOf = (v) => new Date(v).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
const PAY_LABELS = { cash: 'كاش', visa: 'فيزا', instapay: 'انستا باي', wallet: 'محفظة' };
const typeLabel = (o) => (o.orderType === 'delivery' ? '🛵 توصيل' : o.orderType === 'talabat' ? `🛍️ طلبات${o.talabatNo ? ' #' + o.talabatNo : ''}` : '🏪 استلام');
// تقسيم الإيراد: كاش/فيزا/انستا/محفظة (طلبات لوحدها لأنها مش بتدخل الدرج)
const paySplit = (list) => {
  const payments = {}; let talabat = 0; let talabatCash = 0; let talabatVisa = 0; let discounts = 0;
  list.forEach(o => {
    discounts += Number(o.discountAmount) || 0;
    const amount = Number(o.grandTotal) || 0;
    const dFee = o.orderType === 'delivery' ? (Number(o.deliveryFee) || 0) : 0;
    if (o.orderType === 'talabat') {
      talabat += amount;
      if (o.paymentMethod === 'cash') { talabatCash += amount; payments.cash = (payments.cash || 0) + amount; }
      else { talabatVisa += amount; }
      return;
    }
    // زي السيرفر بالظبط: الدفع المقسّم بيتوزّع على طرقه، والكاش من غير أجرة السواق
    const parts = (Array.isArray(o.paymentSplit) && o.paymentSplit.length) ? o.paymentSplit : [{ method: o.paymentMethod || 'cash', amount }];
    parts.forEach(p => { const pa = Number(p.amount) || 0; payments[p.method] = (payments[p.method] || 0) + (p.method === 'cash' ? Math.max(0, pa - dFee) : pa); });
  });
  return { payments, talabat, talabatCash, talabatVisa, discounts };
};
const sumOrders = (list) => ({
  count: list.length,
  total: list.reduce((sum, o) => sum + (Number(o.grandTotal) || 0) - (o.orderType === 'delivery' ? (Number(o.deliveryFee) || 0) : 0), 0),
  delivery: list.reduce((sum, o) => sum + (o.orderType === 'delivery' ? (Number(o.deliveryFee) || 0) : 0), 0),
  ...paySplit(list)
});

// ================= أدوات الورديات والتقارير =================
const money = (n) => `${Math.round((Number(n) || 0) * 100) / 100} ج`;
const diffLabel = (v) => { const n = Number(v) || 0; return Math.abs(n) < 0.005 ? 'مظبوط ✓' : n < 0 ? `عجز ${money(-n)}` : `زيادة ${money(n)}`; };
const fmtDT = (v) => (v ? new Date(v).toLocaleString('ar-EG') : '-');
const TYPE_LABELS = { pickup: 'استلام', delivery: 'توصيل', talabat: 'طلبات' };

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

// تقرير قديم (ورديات اتقفلت قبل التحديث) بنحوّله لنفس الشكل
const legacyReport = (c) => ({
  from: c.from || c.openedAt, to: c.closedAt, count: c.count || 0, total: c.total || 0, delivery: c.delivery || 0,
  discounts: c.discounts || 0, talabat: c.talabat || 0, payments: c.payments || {}, cancelled: c.cancelled || 0,
  categories: [], byType: {}, byCashier: {}, movements: [], orders: c.orders || []
});

const makePrint = (title, report, meta = {}) => ({ title, report, meta, createdAt: new Date().toISOString() });
// شيفت الصبح (6 الصبح لـ 6 المغرب) أو الليل، حسب وقت فتح الوردية
const shiftNameOf = (from) => { if (!from) return ''; const h = new Date(from).getHours(); return h >= 6 && h < 18 ? 'شيفت الصبح' : 'شيفت الليل'; };
const printForClosed = (c, title) => makePrint(title || `تقفيل ${shiftNameOf(c.from || c.openedAt)}`.trim(), c.report || legacyReport(c), {
  closedBy: c.closedBy, closedAt: c.closedAt, countedCash: c.countedCash, expectedCash: c.expectedCash, difference: c.difference, notes: c.notes
});

// أقل سعر لصنف سعره 0 وليه اختيارات إجبارية (عشان ما يظهرش 0 ج)
const lowestPrice = (item) => {
  if (item.price > 0) return item.price;
  return posGroupsOf(item).filter(g => g.min > 0).reduce((s, g) => {
    const prices = (g.options || []).map(o => Number(o.price) || 0);
    return s + (prices.length ? Math.min(...prices) : 0);
  }, 0);
};

// ================= فاتورة الطباعة (ورق حراري) =================
// ورقة المطبخ (big) من غير أي أسعار: بنشيل "(+122 ج)" من تعديلات الصنف
const stripMoney = (m) => String(m).replace(/\s*\(\s*\+?\s*\d+(?:\.\d+)?\s*ج\s*\)/g, '').replace(/^[^:]*:\s*/, '').trim();

const ItemExtras = ({ it, big = false }) => (
  <>
    {(it.modifiers || []).map((m, i) => (
      <small key={i} style={{ display: 'block', fontSize: big ? '14px' : '10px', fontWeight: 600 }}>- {stripMoney(m)}</small>
    ))}
    {it.notes && <small style={{ display: 'block', fontSize: big ? '14px' : '10px', fontWeight: 700 }}>📝 {it.notes}</small>}
  </>
);

// ورقة تقرير الوردية (X لحظي / Z تقفيل / تقرير فترة) — فيها المبيعات والدفع والدرج وجرد الأصناف
const ReportBodyFull = ({ order }) => {
  const r = order.report || {};
  const m = order.meta || {};
  const pays = r.payments || {};
  const num = (v) => Number(v) || 0;
  const row = (label, value, cls = '') => <div className={`rc-row ${cls}`}><span>{label}</span><span>{value}</span></div>;
  const section = (t) => (<><div className="rc-line" /><div className="rc-big rc-center">{t}</div></>);
  const talabatCash = num(r.talabatCash);
  const talabatVisa = r.talabatVisa !== undefined ? num(r.talabatVisa) : Math.max(0, num(r.talabat) - talabatCash);
  const hasTalabatSplit = r.talabatCash !== undefined || r.talabatVisa !== undefined;
  const net = r.grossSales ?? r.total; // التقارير القديمة كان netSales فيها مطروح منه المصروفات، فبنتجاهله
  const hasDrawer = r.openingCash !== undefined;
  const expected = m.expectedCash ?? r.expectedCash;
  const hasCounted = m.countedCash !== undefined && m.countedCash !== null;
  const diff = hasCounted ? (m.difference ?? (num(m.countedCash) - num(expected))) : null;
  const diffText = diff === null ? '' : Math.abs(diff) < 0.005 ? 'مظبوط ✓' : diff < 0 ? `عجز ${money(-diff)}` : `زيادة ${money(diff)}`;

  return (
    <>
      <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">{order.title}</p></div>
      <div className="rc-line" />
      <div>من: {fmtDT(r.from)}</div>
      <div>إلى: {fmtDT(r.to)}</div>
      {r.openedBy && <div>الكاشير: {r.openedBy}{m.closedBy && m.closedBy !== r.openedBy ? ` (قفلها ${m.closedBy})` : ''}</div>}

      <div className="rc-line" />
      <div className="rc-center rc-sub">إجمالي المبيعات (بعد الخصم، من غير أجرة التوصيل)</div>
      <div className="rc-center rc-total">{money(net)}</div>
      {row('عدد الأوردرات', r.count || 0, 'rc-big')}
      {row('أجرة توصيل (مش في المبيعات)', money(r.delivery))}
      {num(r.discounts) > 0 && row('خصومات اتحسبت فعلاً', money(r.discounts))}
      {num(r.cancelled) > 0 && row(`ملغي (${r.cancelled}) مش محسوب`, money(r.cancelledTotal))}

      {(r.expenses || []).length > 0 && (<>
        {section('المصروفات')}
        {r.expenses.map((e, i) => <div key={i} className="rc-row rc-small"><span>- {e.reason} ({e.by})</span><span>{money(e.amount)}</span></div>)}
        {row('إجمالي المصروفات', money(r.expensesTotal), 'rc-big')}
        <div className="rc-center rc-sub">بتتخصم من كاش الدرج مش من المبيعات</div>
      </>)}
      {section('طرق الدفع')}
      {pays.cash !== undefined && row('كاش', money(pays.cash))}
      {pays.cash !== undefined && hasTalabatSplit && talabatCash > 0 && <div className="rc-row rc-small"><span>· منه طلبات كاش</span><span>{money(talabatCash)}</span></div>}
      {num(pays.visa) > 0 && row('فيزا', money(pays.visa))}
      {num(pays.instapay) > 0 && row('انستا باي', money(pays.instapay))}
      {num(pays.wallet) > 0 && row('محفظة', money(pays.wallet))}
      {(hasTalabatSplit ? talabatVisa > 0 : num(r.talabat) > 0) && row(hasTalabatSplit ? 'طلبات فيزا (مستحق من طلبات)' : 'طلبات', money(hasTalabatSplit ? talabatVisa : r.talabat))}

      {Object.keys(r.byType || {}).length > 0 && (
        <>
          {section('حسب نوع الأوردر')}
          {Object.entries(r.byType).map(([k, v]) => row(`${TYPE_LABELS[k] || k} (${v.count})`, money(v.total)))}
        </>
      )}

      {Object.keys(r.byCashier || {}).length > 1 && (
        <>
          {section('حسب الكاشير')}
          {Object.entries(r.byCashier).map(([k, v]) => row(`${k} (${v.count})`, money(v.total)))}
        </>
      )}

      {hasDrawer && (
        <>
          {section('حساب الدرج (كاش)')}
          {row('رصيد الافتتاح', money(r.openingCash))}
          {row('+ كاش المبيعات', money(pays.cash || 0))}
          {num(r.cashIn) > 0 && row('+ إيداعات', money(r.cashIn))}
          {num(r.cashOut) > 0 && row('- مصروفات وسحب', money(r.cashOut))}
          {num(r.driverCash) > 0 && row('- كاش مع السواقين', money(r.driverCash))}
          <div className="rc-line" />
          {row('المتوقع في الدرج', money(expected), 'rc-big')}
          <div className="rc-center rc-sub">الفيزا والانستا والمحفظة وطلبات فيزا مش في الدرج</div>
          {hasCounted && row('اللي اتعدّ فعلاً', money(m.countedCash), 'rc-big')}
          {hasCounted && row('الفرق', diffText, 'rc-total')}
        </>
      )}
      {m.notes && <div className="rc-note">ملاحظة: {m.notes}</div>}

      {(r.movements || []).length > 0 && (
        <>
          {section('حركات الدرج')}
          {r.movements.map((mv, i) => <div key={i} className="rc-row rc-small"><span>{mv.type === 'in' ? '+' : '-'} {mv.reason} ({mv.by})</span><span>{money(mv.amount)}</span></div>)}
        </>
      )}

      {m.showItems && (r.categories || []).length > 0 && (
        <>
          {section('جرد الأصناف المباعة')}
          {r.categories.map((c, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <div className="rc-row rc-big"><span>{c.name}</span><span>{c.qty} قطعة</span></div>
              {(c.items || []).map((it, j) => <div key={j} className="rc-row rc-small"><span>{it.name}</span><span>× {it.qty}</span></div>)}
            </div>
          ))}
        </>
      )}

      <div className="rc-line" />
      <div className="rc-center rc-sub">طُبع: {fmtDT(order.createdAt)}</div>
    </>
  );
};


// ورقة التقفيل المختصرة (X لحظي / Z تقفيل شيفت): الأوردرات والمبيعات والدرج بس، وفي آخر اليوم ملخص الشيفتين
const ReportBodyCompact = ({ order }) => {
  const r = order.report || {};
  const m = order.meta || {};
  const pays = r.payments || {};
  const num = (v) => Number(v) || 0;
  const row = (label, value, cls = '') => <div className={`rc-row ${cls}`}><span>{label}</span><span>{value}</span></div>;
  const net = r.grossSales ?? r.total;
  const hasDrawer = r.openingCash !== undefined;
  const expected = m.expectedCash ?? r.expectedCash;
  const hasCounted = m.countedCash !== undefined && m.countedCash !== null;
  const diff = hasCounted ? (m.difference ?? (num(m.countedCash) - num(expected))) : null;
  const diffText = diff === null ? '' : Math.abs(diff) < 0.005 ? 'مظبوط ✓' : diff < 0 ? `عجز ${money(-diff)}` : `زيادة ${money(diff)}`;
  const talabatVisa = r.talabatVisa !== undefined ? num(r.talabatVisa) : Math.max(0, num(r.talabat) - num(r.talabatCash));
  const nonCash = [['فيزا', pays.visa], ['انستا باي', pays.instapay], ['محفظة', pays.wallet], ['طلبات فيزا', talabatVisa]].filter(([, v]) => num(v) > 0);
  const d = m.day;

  return (
    <>
      <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">{order.title}</p></div>
      <div className="rc-line" />
      {r.openedBy && <div>الكاشير: {r.openedBy}{m.closedBy && m.closedBy !== r.openedBy ? ` (قفلها ${m.closedBy})` : ''}</div>}
      <div>من: {fmtDT(r.from)}</div>
      <div>إلى: {fmtDT(r.to)}</div>
      <div className="rc-line" />
      {row('عدد الأوردرات', r.count || 0, 'rc-big')}
      {row('إجمالي المبيعات', money(net), 'rc-big')}
      <div className="rc-center rc-sub">بعد الخصم، من غير أجرة التوصيل</div>
      {nonCash.length > 0 && nonCash.map(([label, v]) => <div key={label} className="rc-row rc-small"><span>· منها {label}</span><span>{money(v)}</span></div>)}

      {hasDrawer && (
        <>
          <div className="rc-line" />
          {row('رصيد الافتتاح', money(r.openingCash))}
          {row('+ كاش المبيعات', money(pays.cash || 0))}
          {num(r.cashIn) > 0 && row('+ إيداعات', money(r.cashIn))}
          {(r.expenses || []).map((e, i) => <div key={i} className="rc-row rc-small"><span>- {e.reason}</span><span>{money(e.amount)}</span></div>)}
          {num(r.expensesTotal) > 0 && row('- إجمالي المصروفات', money(r.expensesTotal))}
          {num(r.driverCash) > 0 && row('- كاش مع السواقين', money(r.driverCash))}
          <div className="rc-line" />
          {row('المتوقع في الدرج', money(expected), 'rc-total')}
          {hasCounted && row('اللي اتعدّ فعلاً', money(m.countedCash), 'rc-big')}
          {hasCounted && row('الفرق', diffText, 'rc-total')}
        </>
      )}
      {m.notes && <div className="rc-note">ملاحظة: {m.notes}</div>}

      {d && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">ملخص اليوم (الشيفتين)</div>
          {row('إجمالي الأوردرات', d.orders, 'rc-big')}
          {row('إجمالي المبيعات', money(d.sales), 'rc-big')}
          {row('صافي كاش الشيفتين', money(d.net))}
          <div className="rc-line" />
          {row('المتوقع في الدرج آخر اليوم', money(d.last), 'rc-total')}
        </>
      )}

      <div className="rc-line" />
      <div className="rc-center rc-sub">طُبع: {fmtDT(order.createdAt)}</div>
    </>
  );
};

const ReportBody = ({ order }) => (order.meta?.full ? <ReportBodyFull order={order} /> : <ReportBodyCompact order={order} />);

// ================= تقرير اليوم (كل الشيفتات) =================
const dayTime = (v) => (v ? new Date(v).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '-');
const dayLines = (v, drawer) => {
  const n = (x) => Number(x) || 0;
  const p = v.payments || {};
  const L = [['عدد الأوردرات', v.count || 0], ['إجمالي المبيعات', money(v.total)], ['أجرة توصيل (مش في المبيعات)', money(v.delivery)]];
  if (n(v.discounts) > 0) L.push(['خصومات', money(v.discounts)]);
  L.push(['كاش', money(p.cash || 0)]);
  if (n(v.talabatCash) > 0) L.push(['· منه طلبات كاش', money(v.talabatCash)]);
  L.push(['فيزا', money(p.visa || 0)], ['انستا باي', money(p.instapay || 0)], ['محفظة', money(p.wallet || 0)]);
  if (n(v.talabatVisa) > 0) L.push(['طلبات فيزا', money(v.talabatVisa)]);
  if (n(v.expensesTotal) > 0) L.push(['مصروفات (من الدرج)', money(v.expensesTotal)]);
  if (n(v.cancelled) > 0) L.push([`ملغي (${v.cancelled})`, money(v.cancelledTotal)]);
  if (drawer) { L.push(['رصيد الافتتاح', money(v.openingCash)], ['المتوقع في الدرج', money(v.expectedCash)]); }
  return L;
};
const dayShiftSub = (s) => `${s.openedBy} · ${dayTime(s.openedAt)} ← ${s.isOpen ? 'لسه مفتوح' : dayTime(s.closedAt)}`;
// ملخص اليوم المختصر: صافي كاش الشيفتين (اللي اتضاف للدرج بعد المصروفات) والمتوقع في الدرج آخر اليوم
const dayCashSummary = (d) => {
  const sh = d.shifts || [];
  const net = sh.reduce((sum, s) => sum + (Number(s.expectedCash) || 0) - (Number(s.openingCash) || 0), 0);
  const last = sh.length ? (Number(sh[sh.length - 1].expectedCash) || 0) : 0;
  return { net, last };
};
const dayShortLines = (s) => [['عدد الأوردرات', s.count || 0], ['المبيعات', money(s.total)], ['المتوقع في الدرج', money(s.expectedCash)]];
const dayText = (d) => {
  const out = [`📅 تقرير يوم ${d.day} — ${RESTAURANT_NAME}`];
  (d.shifts || []).forEach((s) => {
    out.push('', `${s.label} (${dayShiftSub(s)})`);
    dayShortLines(s).forEach(([a, b]) => out.push(`${a}: ${b}`));
  });
  if (d.outside) out.push('', `⚠️ ${d.outside.count} أوردر (${money(d.outside.total)}) من غير وردية، محسوبين في الإجمالي`);
  const c = dayCashSummary(d);
  out.push('', '━━━━━━━━', 'إجمالي اليوم', `إجمالي الأوردرات: ${(d.totals || {}).count || 0}`, `إجمالي المبيعات: ${money((d.totals || {}).total)}`, `صافي كاش الشيفتين: ${money(c.net)}`, `المتوقع في الدرج آخر اليوم: ${money(c.last)}`);
  return out.join('\n');
};

const DayReportBody = ({ order }) => {
  const d = order.day || { shifts: [], totals: {} };
  const row = (label, value, cls = '') => <div className={`rc-row ${cls}`}><span>{label}</span><span>{value}</span></div>;
  const c = dayCashSummary(d);
  const t = d.totals || {};
  return (
    <>
      <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">تقرير اليوم {d.day}</p></div>
      {(d.shifts || []).map((s) => (
        <div key={s.id}>
          <div className="rc-line" />
          <div className="rc-big rc-center">{s.label}</div>
          <div className="rc-center rc-sub">{dayShiftSub(s)}</div>
          {dayShortLines(s).map(([a, b], i) => <React.Fragment key={i}>{row(a, b)}</React.Fragment>)}
        </div>
      ))}
      {d.outside && <div className="rc-note">⚠️ {d.outside.count} أوردر ({money(d.outside.total)}) من غير وردية، محسوبين في الإجمالي</div>}
      <div className="rc-line" />
      <div className="rc-big rc-center">إجمالي اليوم</div>
      {row('إجمالي الأوردرات', t.count || 0, 'rc-big')}
      {row('إجمالي المبيعات', money(t.total), 'rc-big')}
      {row('صافي كاش الشيفتين', money(c.net))}
      <div className="rc-line" />
      {row('المتوقع في الدرج آخر اليوم', money(c.last), 'rc-total')}
      <div className="rc-line" />
      <div className="rc-center rc-sub">طُبع: {fmtDT(order.createdAt)}</div>
    </>
  );
};

// ================= داش بورد اليوم (للأدمن فقط) =================
const DayDashboardCard = ({ authFetch, card, inp }) => {
  const [date, setDate] = useState('');
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const n = (x) => Number(x) || 0;

  const load = async (silent = false) => {
    if (!silent) setBusy(true);
    setMsg('');
    try {
      const r = await authFetch(`/api/reports/dashboard${date ? `?date=${date}` : ''}`);
      const j = await r.json().catch(() => ({}));
      if (r.ok) setD(j); else { setD(null); setMsg(j.error || 'حصل خطأ'); }
    } catch (e) { if (e.message !== 'unauthorized') setMsg('تعذر الاتصال بالسيرفر'); }
    setBusy(false);
  };
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!date) load(true); }, 60000);
    return () => clearInterval(t);
  }, [date]);

  const t = d?.totals || {};
  const p = t.payments || {};
  const cashNoTalabat = Math.max(0, n(p.cash) - n(t.talabatCash));
  const payBoxes = [
    ['💵 كاش (من غير طلبات)', cashNoTalabat],
    ['🛍️ طلبات كاش', n(t.talabatCash)],
    ['💳 فيزا', n(p.visa)],
    ['🛍️ طلبات فيزا', n(t.talabatVisa)],
    ['📱 انستا باي', n(p.instapay)],
    ['👛 محفظة', n(p.wallet)]
  ];
  const paySum = payBoxes.reduce((a, b) => a + b[1], 0);
  // الفرق بين مجموع الدفع والمبيعات = أجرة توصيل اتدفعت إلكترونيًا للمطعم (متفسّرة، مش غلط): لازم يبقى بين صفر وإجمالي الأجرة
  const payGap = paySum - n(t.total);
  const payGapExplained = payGap >= -0.5 && payGap <= n(t.delivery) + 0.5;
  const avg = n(t.count) > 0 ? n(t.total) / n(t.count) : 0;
  const prevTotal = n(d?.prev?.total);
  const growth = prevTotal > 0 ? Math.round(((n(t.total) - prevTotal) / prevTotal) * 100) : null;

  return (
    <div className={card + ' space-y-4'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-black text-[#FFD700] text-lg">📊 داش بورد اليوم <span className="text-xs font-bold text-zinc-400">(للأدمن فقط)</span></h4>
        <div className="flex items-center gap-2">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp + ' !w-auto'} />
          <button type="button" disabled={busy} onClick={() => load()} className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-black">{busy ? '...' : '🔄 تحديث'}</button>
        </div>
      </div>
      {msg && <p className="text-sm font-bold text-orange-300">{msg}</p>}
      {d && (
        <>
          <p className="text-[11px] text-zinc-500">يوم {d.day} (من 6 الصبح لـ 6 الصبح) · كل الأوردرات في كل الورديات{d.isToday ? ' · بيتحدث لوحده كل دقيقة' : ''}</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-2 rounded-2xl border border-[#FFD700]/40 bg-black/20 p-5">
              <p className="text-sm font-bold text-zinc-400">إجمالي مبيعات اليوم</p>
              <p className="text-4xl font-black text-[#FFD700] mt-1">{money(t.total)}</p>
              <p className="text-xs text-zinc-400 mt-1">
                {growth === null ? 'مفيش أرقام أمس للمقارنة' : growth === 0 ? 'زي أمس بالظبط' : (<span className={growth > 0 ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>{growth > 0 ? '▲' : '▼'} {Math.abs(growth)}% {growth > 0 ? 'أكتر' : 'أقل'} من أمس ({money(prevTotal)})</span>)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-center flex flex-col justify-center">
              <p className="text-xs font-bold text-zinc-400">الأوردرات</p>
              <p className="text-3xl font-black text-white">{n(t.count)}</p>
              <p className="text-[11px] text-zinc-400">متوسط {money(avg)}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-black text-white mb-2">طرق الدفع</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {payBoxes.map(([label, v]) => (
                <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                  <p className="text-[11px] font-bold text-zinc-400">{label}</p>
                  <p className="text-lg font-black text-white">{money(v)}</p>
                </div>
              ))}
            </div>
            {!payGapExplained && <p className="text-[11px] text-orange-300 mt-1">⚠️ مجموع طرق الدفع ({money(paySum)}) مختلف عن إجمالي اليوم بفرق مش مفسّر برسوم التوصيل، راجع الأوردرات.</p>}
          </div>

          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">🛵 أجرة توصيل (مش في المبيعات): <span className="text-white">{money(t.delivery)}</span></span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">🏷️ خصومات: <span className="text-orange-300">{money(t.discounts)}</span></span>
            <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">✖ ملغي ({n(t.cancelled)}): <span className="text-red-300">{money(t.cancelledTotal)}</span></span>
            {n(t.expensesTotal) > 0 && <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-zinc-300">💸 مصروفات الدرج: <span className="text-red-300">{money(t.expensesTotal)}</span></span>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-black text-white mb-1">📦 حسب نوع الأوردر</p>
              {Object.keys(d.byType || {}).length === 0 ? <p className="text-xs text-zinc-500">لسه مفيش أوردرات.</p> : Object.entries(d.byType).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm py-1 border-b border-white/5 last:border-0"><span className="text-zinc-300">{TYPE_LABELS[k] || k} ({v.count})</span><span className="font-bold text-white">{money(v.total)}</span></div>
              ))}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-black text-white mb-1">👥 حسب الكاشير</p>
              {Object.keys(d.byCashier || {}).length === 0 ? <p className="text-xs text-zinc-500">لسه مفيش أوردرات.</p> : Object.entries(d.byCashier).map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm py-1 border-b border-white/5 last:border-0"><span className="text-zinc-300">{k} ({v.count})</span><span className="font-bold text-white">{money(v.total)}</span></div>
              ))}
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <p className="text-sm font-black text-white mb-1">🔥 الأكتر مبيعاً</p>
              {(d.topItems || []).length === 0 ? <p className="text-xs text-zinc-500">لسه مفيش مبيعات.</p> : d.topItems.map((it) => (
                <div key={it.name} className="flex justify-between text-sm py-1 border-b border-white/5 last:border-0"><span className="text-zinc-300">{it.name}</span><span className="font-bold text-white">× {it.qty}</span></div>
              ))}
            </div>
          </div>
          {d.isToday && (d.openShifts || []).length > 0 && <p className="text-xs text-zinc-400">🟢 ورديات مفتوحة دلوقتي: {d.openShifts.map((s) => `${s.openedBy} (من ${dayTime(s.openedAt)})`).join(' · ')}</p>}
        </>
      )}
    </div>
  );
};

const DayReportCard = ({ authFetch, isAdmin, requestPrint, card, inp }) => {
  const [date, setDate] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async () => {
    setBusy(true); setMsg('');
    let result = null;
    try {
      const r = await authFetch(`/api/reports/day${isAdmin && date ? `?date=${date}` : ''}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setData(d); result = d; } else { setData(null); setMsg(d.error || 'حصل خطأ'); }
    } catch (e) { if (e.message !== 'unauthorized') setMsg('تعذر الاتصال بالسيرفر'); }
    setBusy(false);
    return result;
  };
  const printIt = async () => {
    const d = await load();
    if (!d) return;
    if ((d.shifts || []).length === 0) return setMsg('مفيش ورديات في اليوم ده');
    requestPrint({ title: 'تقرير اليوم', day: d, createdAt: new Date().toISOString() }, 'day');
  };
  const copyIt = async () => {
    const d = await load();
    if (!d) return;
    const text = dayText(d);
    try { await navigator.clipboard.writeText(text); setMsg('✅ اتنسخ، الصقه في الجروب'); }
    catch (e) { window.prompt('انسخ التقرير:', text); }
  };

  const box = (key, title, sub, lines, gold) => (
    <div key={key} className={`bg-[#12080A] border border-[#3A1218] rounded-xl p-4 ${gold ? 'border-2 !border-[#FFD700]' : ''}`}>
      <p className="font-black text-white text-base">{title}</p>
      {sub && <p className="text-[11px] text-zinc-400 mb-2">{sub}</p>}
      {lines.map(([a, b], i) => (
        <div key={i} className={`flex justify-between gap-2 py-1 text-sm border-b border-white/5 last:border-0 ${i === 1 ? 'font-black text-[#FFD700]' : 'text-zinc-300'}`}><span>{a}</span><span className="font-bold text-white">{b}</span></div>
      ))}
    </div>
  );

  return (
    <div className={card + ' space-y-4'}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-black text-[#FFD700] text-lg">📅 تقرير اليوم (كل الشيفتات)</h4>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">اليوم (فاضي = النهارده)</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp + ' !w-auto'} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={load} className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-black">{busy ? '...' : '👁️ عرض'}</button>
        <button type="button" disabled={busy} onClick={printIt} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-black">🖨️ طباعة تقرير اليوم</button>
        <button type="button" disabled={busy} onClick={copyIt} className="bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl text-sm font-black">📋 نسخ للجروب</button>
      </div>
      <p className="text-[11px] text-zinc-500">إجمالي اليوم بيتحسب من كل أوردرات اليوم (من 6 الصبح لـ 6 الصبح)، وتحته تفصيل كل وردية. لو وردية لسه مفتوحة بتاخد أرقامها لحد دلوقتي.</p>
      {msg && <p className="text-sm font-bold text-orange-300">{msg}</p>}
      {data && data.outside && <p className="text-sm font-bold text-orange-300 bg-orange-500/10 border border-orange-500/30 rounded-xl p-3">⚠️ في {data.outside.count} أوردر بقيمة {money(data.outside.total)} اتعملوا في اليوم ده من غير ما يتحسبوا على أي وردية (مثلاً أوردر اتسلّم والكاشير مش فاتح وردية). هما محسوبين في إجمالي اليوم تحت.</p>}
      {data && ((data.shifts || []).length === 0 ? (
        <p className="text-zinc-500 text-sm">مفيش ورديات في يوم {data.day}.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {data.shifts.map((s) => box(s.id, s.label, dayShiftSub(s), dayLines(s, true), false))}
          {box('total', `إجمالي اليوم ${data.day}`, `${data.shifts.length} ورديات`, dayLines(data.totals || {}, false), true)}
        </div>
      ))}
    </div>
  );
};

const Receipt80 = ({ order, type, cashierName }) => {
  if (!order) return null;
  const items = order.items || [];
  const fee = Number(order.deliveryFee) || 0;
  const total = Number(order.grandTotal) || 0;
  const discount = Number(order.discountAmount) || 0;
  const subtotal = total - fee + discount;
  const dt = order.createdAt ? new Date(order.createdAt) : new Date();
  const dateText = dt.toLocaleDateString('ar-EG');
  const timeText = dt.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  const isDelivery = order.orderType === 'delivery';

  return createPortal(
    <div id="receipt-print" dir="rtl">
      <style>{`
        #receipt-print { display: none; }
        @page { margin: 0; }
        @media print {
          body > *:not(#receipt-print) { display: none !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
          #receipt-print {
            display: block; box-sizing: border-box; width: 60mm; margin: 0 auto; padding: 3mm 0 6mm;
            background: #fff; color: #000; font-family: Tahoma, Arial, sans-serif;
            font-size: 12px; line-height: 1.45; font-weight: 600; overflow-wrap: anywhere;
          }
          #receipt-print .rc-center { text-align: center; }
          #receipt-print .rc-title { font-size: 24px; font-weight: 900; margin: 0; }
          #receipt-print .rc-sub { font-size: 12px; margin: 2px 0; }
          #receipt-print .rc-small { font-size: 11px; }
          #receipt-print .rc-line { border-top: 1px dashed #000; margin: 6px 0; }
          #receipt-print .rc-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 6px; }
          #receipt-print table { width: 100%; border-collapse: collapse; }
          #receipt-print th { font-size: 12px; text-align: right; border-bottom: 1px solid #000; padding: 2px 0; }
          #receipt-print td { padding: 3px 0; vertical-align: top; }
          #receipt-print .rc-num { text-align: left; white-space: nowrap; padding-right: 4px; }
          #receipt-print .rc-total { font-size: 18px; font-weight: 900; }
          #receipt-print .rc-big { font-size: 15px; font-weight: 900; }
          #receipt-print .rc-kid { font-size: 28px; font-weight: 900; text-align: center; margin: 4px 0; }
          #receipt-print .rc-kitem { display: flex; gap: 8px; font-size: 18px; font-weight: 900; padding: 4px 0; border-bottom: 1px dotted #000; }
          #receipt-print .rc-kqty { min-width: 30px; }
        }
      `}</style>

      {type === 'day' ? (
        <DayReportBody order={order} />
      ) : type === 'report' ? (
        <ReportBody order={order} />
      ) : type === 'kitchen-summary' ? (
        <>
          <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">تقرير المطبخ - جرد {shiftNameOf(order.report?.from)}</p></div>
          <div className="rc-line" />
          <div>من: {fmtDT(order.report?.from)}</div>
          <div>إلى: {fmtDT(order.report?.to)}</div>
          <div>الكاشير: {order.meta?.closedBy || order.report?.openedBy || '-'}</div>
          <div className="rc-line" />
          <div className="rc-row rc-big"><span>عدد الأوردرات</span><span>{order.report?.count || 0}</span></div>
          <div className="rc-row rc-big"><span>إجمالي المبيعات</span><span>{money(order.report?.grossSales ?? order.report?.total ?? 0)}</span></div>
          <div className="rc-line" />
          <div className="rc-center rc-big">الأصناف المباعة والكميات</div>
          {(order.report?.categories || []).length === 0 ? <div className="rc-center">مفيش أصناف مباعة في الوردية</div> : (order.report.categories || []).map((c, i) => (
            <div key={i} style={{ marginTop: 7 }}>
              <div className="rc-row rc-big"><span>{c.name}</span><span>{c.qty} قطعة</span></div>
              {(c.items || []).map((it, j) => <div key={j} className="rc-row rc-small"><span>{it.name}</span><span style={{fontWeight:900}}>× {it.qty}</span></div>)}
            </div>
          ))}
          <div className="rc-line" />
          <div className="rc-center rc-sub">الكميات تخص الوردية دي فقط</div>
        </>
      ) : type === 'kitchen' ? (
        <>
          <div className="rc-center rc-big">🍳 أوردر المطبخ{order.editedAt ? ' — ✏️ معدّل' : ''}</div>
          <div className="rc-kid" dir="ltr">#{order.source === 'pos' && order.shiftReceiptNo ? order.shiftReceiptNo : order.orderId}</div>
          {order.source === 'pos' && order.shiftReceiptNo && <div className="rc-center rc-small">رقم النظام: #{order.orderId}{order.orderType === 'talabat' && order.talabatNo ? ` | رقم طلبات: ${order.talabatNo}` : ''}</div>}
          <div className="rc-row rc-big"><span>{typeLabel(order)}</span><span>{timeText}</span></div>
          <div className="rc-line" />
          {items.map((it, i) => (
            <div key={i} className="rc-kitem">
              <span className="rc-kqty">{it.quantity}×</span>
              <span>{it.name}<ItemExtras it={it} big /></span>
            </div>
          ))}
          {order.orderNote && <div className="rc-big" style={{ border: '2px solid #000', padding: '4px', marginTop: '4px', whiteSpace: 'pre-wrap' }}>📝 {order.orderNote}</div>}
          <div className="rc-line" />
          <div className="rc-center rc-sub">{dateText}</div>
        </>
      ) : (
        <>
          <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-sub">📞 {RESTAURANT_PHONE}</p></div>
          <div className="rc-line" />
          <div className="rc-row rc-big"><span>رقم الإيصال</span><span dir="ltr">#{order.source === 'pos' && order.shiftReceiptNo ? order.shiftReceiptNo : order.orderId}</span></div>
          {order.source === 'pos' && order.shiftReceiptNo && <div className="rc-small">رقم النظام: #{order.orderId}{order.orderType === 'talabat' && order.talabatNo ? ` | رقم طلبات: ${order.talabatNo}` : ''}</div>}
          <div className="rc-row"><span>التاريخ: {dateText}</span><span>الوقت: {timeText}</span></div>
          {cashierName && <div className="rc-row"><span>الكاشير: {cashierName}</span></div>}
          <div className="rc-line" />
          <div className="rc-big">{typeLabel(order)}</div>
          {order.orderType !== 'talabat' && order.customerName && order.customerName !== '-' && <div>الاسم: {order.customerName}</div>}
          {order.orderType !== 'talabat' && order.customerPhone && order.customerPhone !== '-' && <div>التليفون: <span dir="ltr">{order.customerPhone}</span></div>}
          {isDelivery && order.zoneName && <div>المنطقة: {order.zoneName}</div>}
          {isDelivery && order.customerAddress && <div>العنوان: {order.customerAddress}</div>}
          {isDelivery && order.driverName && <div>السواق: {order.driverName}</div>}
          <div className="rc-line" />
          <table>
            <thead><tr><th>الصنف</th><th style={{ textAlign: 'center' }}>كمية</th><th className="rc-num">السعر</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={i}>
                  <td>{it.name}<ItemExtras it={it} /></td>
                  <td style={{ textAlign: 'center' }}>{it.quantity}</td>
                  <td className="rc-num">{(Number(it.price) || 0) * (Number(it.quantity) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {order.orderNote && <div style={{ border: '1px solid #000', padding: '3px', marginTop: '4px', whiteSpace: 'pre-wrap', fontWeight: 700 }}>📝 {order.orderNote}</div>}
          <div className="rc-line" />
          <div className="rc-row"><span>المجموع</span><span>{subtotal} ج</span></div>
          {discount > 0 && <div className="rc-row"><span>خصم {discountLabel(order)}</span><span>- {discount} ج</span></div>}
          {isDelivery && <div className="rc-row"><span>التوصيل</span><span>{fee} ج</span></div>}
          <div className="rc-row rc-total"><span>الإجمالي</span><span>{total} ج</span></div>
          {order.paymentMethod && <div className="rc-row"><span>الدفع</span><span>{payText(order)}</span></div>}
          <div className="rc-line" />
          <div className="rc-center rc-sub">شكراً لاختياركم {RESTAURANT_NAME} ❤️</div>
          <div className="rc-center rc-sub">بالهنا والشفا</div>
        </>
      )}
    </div>,
    document.body
  );
};

// ================= الثيم الفاتح / الداكن لشاشة الكاشير =================
const LIGHT_THEME_CSS = (() => {
  const rule = (attr, css) => `.pos-light[class*="${attr}"], .pos-light [class*="${attr}"] { ${css} !important; }`;
  return [
    rule('bg-[#12080A]', 'background-color:#eceff3'),
    rule('bg-[#1C0D10]', 'background-color:#ffffff'),
    rule('bg-[#220E13]', 'background-color:#f3f4f6'),
    rule('bg-[#2E1016]', 'background-color:#ffe4d3'),
    rule('bg-[#2B1015]', 'background-color:#fff0e6'),
    rule('bg-red-950', 'background-color:#fee2e2'),
    rule('bg-zinc-800', 'background-color:#e4e4e7'),
    rule('bg-zinc-700', 'background-color:#d4d4d8'),
    rule('bg-zinc-600', 'background-color:#c4c4cc'),
    rule('border-[#3A1218]', 'border-color:#d4d4d8'),
    rule('text-white', 'color:#111827'),
    rule('text-zinc-200', 'color:#374151'),
    rule('text-zinc-300', 'color:#374151'),
    rule('text-zinc-400', 'color:#52525b'),
    rule('text-zinc-500', 'color:#71717a'),
    rule('text-zinc-600', 'color:#71717a'),
    rule('text-[#FFD700]', 'color:#b45309'),
    rule('text-orange-200', 'color:#9a3412'),
    rule('text-green-400', 'color:#15803d'),
    rule('text-red-400', 'color:#dc2626'),
    rule('text-red-300', 'color:#dc2626'),
    rule('text-yellow-400', 'color:#a16207'),
    // الأزرار الملونة تفضل نصها أبيض
    rule('bg-[#800020]', 'color:#ffffff'),
    rule('bg-green-6', 'color:#ffffff'),
    rule('bg-green-7', 'color:#ffffff'),
    rule('bg-red-6', 'color:#ffffff'),
    rule('bg-red-7', 'color:#ffffff'),
    rule('bg-blue-6', 'color:#ffffff'),
    // الأزرار الشفافة الملونة
    rule('bg-[#800020]/', 'color:#9a3412'),
    '.pos-light input::placeholder, .pos-light textarea::placeholder { color:#9ca3af !important; }',
    '.pos-light { color-scheme: light; }'
  ].join('\n');
})();

// ================= شاشة فتح الوردية =================
const OpenShiftForm = ({ authFetch, onDone, pendingHandover = null }) => {
  const [cash, setCash] = useState(pendingHandover ? String(pendingHandover.amount ?? 0) : '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (pendingHandover) setCash(String(pendingHandover.amount ?? 0)); }, [pendingHandover?.shiftId]);

  const submit = async () => {
    if (busy) return;
    if (cash === '' || Number(cash) < 0) return alert('اكتب الكاش اللي في الدرج دلوقتي (لو مفيش اكتب 0)');
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/open', { method: 'POST', body: JSON.stringify({ openingCash: Number(cash) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || 'حصل خطأ'); else { setCash(''); await onDone(); }
    } catch (e) {}
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      {pendingHandover && <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-200">استلام وردية من {pendingHandover.from}. النقدية المسلّمة المسجلة: <strong>{money(pendingHandover.amount)}</strong>. لازم تأكد نفس المبلغ عند الاستلام.</div>}
      <label className="block text-sm font-bold text-zinc-300">{pendingHandover ? 'أكد النقدية اللي استلمتها فعليًا' : 'الكاش الموجود في الدرج وقت الاستلام (رصيد الافتتاح)'}</label>
      <input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="مثال: 500" className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white text-lg text-center" dir="ltr" />
      <button type="button" disabled={busy} onClick={submit} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl">{busy ? '...' : '🟢 فتح الوردية'}</button>
    </div>
  );
};

// ================= تقرير فترة تفصيلي + السلف (للأدمن) =================
// بيجيب تقرير يوم بيوم من السيرفر (GET /api/reports/period)، وبيطبع ورقة A4
// أو ينزّل ملف CSV بيفتح في Excel. اليوم بيتحسب من 6 الصبح لـ 6 الصبح زي تقرير اليوم.
const periodLocalYMD = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const periodBizToday = () => { const n = new Date(); if (n.getHours() < 6) n.setDate(n.getDate() - 1); return periodLocalYMD(n); };
const periodAddDays = (key, n) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + n); return periodLocalYMD(d); };
const periodWeekday = (key) => { try { return new Date(`${key}T12:00:00`).toLocaleDateString('ar-EG', { weekday: 'long' }); } catch (e) { return ''; } };
const periodTime = (v) => (v ? new Date(v).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '-');
const periodDateTime = (v) => (v ? new Date(v).toLocaleString('ar-EG') : '-');
const periodEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const periodCsvCell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const periodDownload = (filename, content, type) => {
  const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const PeriodReportPanel = ({ authFetch, card, inp, base, period, onPeriodChange, hidePickers, fetchReport }) => {
  const [fromInner, setFromInner] = useState(() => periodAddDays(periodBizToday(), -6));
  const [toInner, setToInner] = useState(() => periodBizToday());
  // لو اتبعتت فترة من برّه (صفحة المحاسب) بتكون هي المتحكمة؛ غير كده الحالة الداخلية زي ما هي
  const from = period ? period.from : fromInner;
  const to = period ? period.to : toInner;
  const setFrom = (v) => { if (onPeriodChange) onPeriodChange({ from: v, to }); else setFromInner(v); };
  const setTo = (v) => { if (onPeriodChange) onPeriodChange({ from, to: v }); else setToInner(v); };
  const [rep, setRep] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = async (f, t) => {
    const ff = f || from, tt = t || to;
    if (!ff || !tt || tt < ff) return alert('اختار فترة صحيحة (تاريخ النهاية بعد البداية)');
    setBusy(true); setMsg(''); setRep(null);
    try {
      const r = fetchReport ? await fetchReport(ff, tt) : await authFetch(`${base || '/api/reports/period'}?from=${encodeURIComponent(ff)}&to=${encodeURIComponent(tt)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d.error || 'حصل خطأ'); else setRep(d);
    } catch (e) { setMsg('تعذر الاتصال بالسيرفر'); }
    setBusy(false);
  };

  // في صفحة المحاسب الفترة بتيجي من برّه: أول ما تتغير، التقرير يتحمّل لوحده
  useEffect(() => { if (hidePickers && period?.from && period?.to) load(period.from, period.to); }, [hidePickers, period?.from, period?.to]);

  const preset = (kind) => {
    const today = periodBizToday();
    let f = today, t = today;
    if (kind === 'week') f = periodAddDays(today, -6);
    if (kind === 'month') f = periodAddDays(today, -29);
    if (kind === 'thisMonth') f = `${today.slice(0, 7)}-01`;
    if (kind === 'lastMonth') { const d = new Date(`${today.slice(0, 7)}-01T12:00:00`); d.setDate(0); t = periodLocalYMD(d); f = `${t.slice(0, 7)}-01`; }
    setFrom(f); setTo(t); load(f, t);
  };

  // ملخص الفترة ببساطة — جمل عادية من الأرقام اللي راجعة من /api/reports/period،
  // بتتستخدم في الشاشة وفي الطباعة. طلبات جزء من المبيعات مش زيادة عليها،
  // وصافي كاش الفترة = كاش الفترة ناقص الخارج من الدرج زائد الإيداعات،
  // وده غير الفلوس اللي كانت في الدرج قبل الفترة.
  const plainNum = (v) => Number(v) || 0;
  const plainTotalsLines = (r) => {
    if (!r) return [];
    const tt = r.totals || {}; const pp = tt.payments || {};
    const cash = plainNum(pp.cash); const exp = plainNum(tt.expensesTotal); const dep = plainNum(tt.depositsTotal);
    const net = cash - exp + dep;
    return [
      `في الفترة من ${r.from} إلى ${r.to}، بعت بـ ${money(tt.total)} في ${plainNum(tt.count)} أوردر.`,
      `منهم كاش ${money(pp.cash)}، فيزا ${money(pp.visa)}، انستا باي ${money(pp.instapay)}، محفظة ${money(pp.wallet)}.`,
      `ومنهم طلبات بـ ${money(tt.talabat)} (كاش طلبات ${money(tt.talabatCash)} وفيزا طلبات ${money(tt.talabatVisa)})، ودي من ضمن المبيعات اللي فوق مش زيادة عليها.`,
      `طلع من الدرج ${money(tt.expensesTotal)}: سلف ${money(tt.advancesTotal)} (${plainNum(tt.advancesCount)} سلفة)، ومصروفات تانية ${money(tt.otherExpensesTotal)}.`,
      `دخل الدرج إيداعات ${money(tt.depositsTotal)}.`,
      `صافي كاش الفترة = كاش ${money(pp.cash)} ناقص اللي طلع من الدرج ${money(tt.expensesTotal)} زائد الإيداعات ${money(tt.depositsTotal)} = ${money(net)}. ده صافي كاش الفترة بس، غير الفلوس اللي كانت في الدرج قبل الفترة.`,
      `خصومات ${money(tt.discounts)}، وأوردرات ملغية ${plainNum(tt.cancelled)} بقيمة ${money(tt.cancelledTotal)}.`
    ];
  };
  const plainDayLine = (d) => {
    const dp = d.payments || {};
    let line = `يوم ${d.date} (${periodWeekday(d.date)}): بعت بـ ${money(d.total)} في ${plainNum(d.count)} أوردر، كاش ${money(dp.cash)}، فيزا ${money(dp.visa)}، انستا ${money(dp.instapay)}، سلف ${money(d.advancesTotal)}، مصروفات تانية ${money(d.otherExpensesTotal)}.`;
    const shifts = d.shifts || [];
    const closed = shifts.filter((s) => s.status === 'closed' && s.expectedCash !== null && s.expectedCash !== undefined);
    if (closed.length > 0) line += ` والوردية قفلت والمتوقع في الدرج ${money(closed[closed.length - 1].expectedCash)}.`;
    else if (shifts.length > 0) line += ` والوردية لسه مفتوحة.`;
    return line;
  };
  const plainDayLines = (r) => (r?.days || []).map(plainDayLine);
  const plainDayClose = (d) => {
    const shifts = d.shifts || [];
    const closed = shifts.filter((s) => s.status === 'closed' && s.expectedCash !== null && s.expectedCash !== undefined);
    if (closed.length > 0) return { kind: 'closed', amount: Number(closed[closed.length - 1].expectedCash) || 0 };
    if (shifts.length > 0) return { kind: 'open', amount: null };
    return { kind: 'none', amount: null };
  };
  const plainNetCash = (r) => {
    const tt = r?.totals || {}; const pp = tt.payments || {};
    return plainNum(pp.cash) - plainNum(tt.expensesTotal) + plainNum(tt.depositsTotal);
  };

  const printReport = () => {
    if (!rep) return;
    const t = rep.totals || {};
    const pays = t.payments || {};
    const tbl = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`;
    const advRows = (list) => list.map((a) => `<tr><td>${periodEsc(a.day || '')}</td><td>${periodTime(a.at)}</td><td><strong>${periodEsc(a.person)}</strong></td><td>${money(a.amount)}</td><td>${periodEsc(a.reason)}</td><td>${periodEsc(a.by)}</td><td>${periodEsc(a.shiftBy)}</td></tr>`).join('');
    const expRows = (list) => list.filter((m) => !m.isAdvance).map((m) => `<tr><td>${periodTime(m.at)}</td><td>${periodEsc(m.reason)}</td><td>${money(m.amount)}</td><td>${periodEsc(m.by)}</td></tr>`).join('');
    const daysHtml = (rep.days || []).map((d) => {
      const dp = d.payments || {};
      const parts = [];
      parts.push(`<div class="day"><h2>📅 ${d.date} — ${periodWeekday(d.date)}</h2>`);
      parts.push(`<p class="line">أوردرات: <strong>${d.count || 0}</strong> · مبيعات: <strong>${money(d.total)}</strong> · كاش ${money(dp.cash || 0)} · فيزا ${money(dp.visa || 0)} · انستا ${money(dp.instapay || 0)} · محفظة ${money(dp.wallet || 0)} · طلبات ${money(d.talabat)} · خصومات ${money(d.discounts)} · ملغي ${d.cancelled || 0} (${money(d.cancelledTotal)}) · مصروفات ${money(d.expensesTotal)} · سلف ${money(d.advancesTotal)}</p>`);
      if ((d.shifts || []).length > 0) {
        parts.push('<h3>الورديات</h3>' + tbl(['الكاشير', 'الشيفت', 'فتح', 'قفل', 'أوردرات', 'مبيعات', 'متوقع الدرج', 'سلف الوردية'], (d.shifts || []).map((s) => `<tr><td>${periodEsc(s.openedBy)}</td><td>${periodEsc(s.label)}</td><td>${periodDateTime(s.openedAt)}</td><td>${s.closedAt ? periodDateTime(s.closedAt) : 'لسه مفتوحة'}</td><td>${s.count || 0}</td><td>${money(s.total)}</td><td>${s.expectedCash === null || s.expectedCash === undefined ? '-' : money(s.expectedCash)}</td><td>${money(s.advancesTotal)}</td></tr>`).join('')));
      }
      if ((d.advances || []).length > 0) parts.push('<h3>💰 السلف</h3>' + tbl(['التاريخ', 'الوقت', 'الاسم', 'المبلغ', 'السبب', 'سجّلها', 'وردية'], advRows(d.advances)));
      const others = (d.expenses || []).filter((m) => !m.isAdvance);
      if (others.length > 0) parts.push('<h3>💸 مصروفات أخرى</h3>' + tbl(['الوقت', 'البيان', 'المبلغ', 'سجّلها'], expRows(d.expenses)));
      if ((d.advances || []).length === 0 && others.length === 0 && (d.shifts || []).length === 0 && !(d.count > 0)) parts.push('<p class="muted">مفيش نشاط مسجل في اليوم ده.</p>');
      parts.push('</div>');
      return parts.join('');
    }).join('');

    const plainNet = plainNetCash(rep);
    const plainTotalsRows = [
      ['إجمالي المبيعات', `${money(t.total)} (${plainNum(t.count)} أوردر)`],
      ['كاش', money(pays.cash || 0)],
      ['فيزا', money(pays.visa || 0)],
      ['انستا باي', money(pays.instapay || 0)],
      ['محفظة', money(pays.wallet || 0)],
      ['طلبات (من ضمن المبيعات)', `${money(t.talabat)} — كاش طلبات ${money(t.talabatCash)} · فيزا طلبات ${money(t.talabatVisa)}`],
      ['إجمالي السلف', `${money(t.advancesTotal)} (${plainNum(t.advancesCount)} سلفة)`],
      ['مصروفات أخرى', money(t.otherExpensesTotal)],
      ['خارج من الدرج', money(t.expensesTotal)],
      ['إيداعات', money(t.depositsTotal)],
      ['خصومات', money(t.discounts)],
      ['ملغي', `${plainNum(t.cancelled)} أوردر بقيمة ${money(t.cancelledTotal)}`],
      ['صافي كاش الفترة', money(plainNet)],
    ].map(([a, b]) => `<tr><td>${periodEsc(a)}</td><td><strong>${periodEsc(b)}</strong></td></tr>`).join('');
    const plainDaysRows = (rep.days || []).map((d) => {
      const dp = d.payments || {};
      const c = plainDayClose(d);
      const closeTxt = c.kind === 'closed' ? money(c.amount) : (c.kind === 'open' ? 'لسه مفتوحة' : '-');
      const noActivity = !(d.count > 0) && (d.shifts || []).length === 0 && (d.expenses || []).length === 0 && (d.deposits || []).length === 0;
      return `<tr><td><strong>${periodEsc(d.date)}</strong> — ${periodEsc(periodWeekday(d.date))}${noActivity ? ' (مفيش نشاط)' : ''}</td><td>${plainNum(d.count)}</td><td>${money(d.total)}</td><td>${money(dp.cash || 0)}</td><td>${money(dp.visa || 0)}</td><td>${money(dp.instapay || 0)}</td><td>${money(d.advancesTotal)}</td><td>${money(d.otherExpensesTotal)}</td><td><strong>${periodEsc(closeTxt)}</strong></td></tr>`;
    }).join('');
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير فترة ${rep.from} - ${rep.to}</title><style>
      body{font-family:Tahoma,Arial,sans-serif;color:#111;margin:24px} h1{font-size:22px;margin:0} h2{font-size:17px;margin:22px 0 6px} h3{font-size:14px;margin:14px 0 4px}
      .sub{color:#555;font-size:13px} table{width:100%;border-collapse:collapse;margin:6px 0 10px} th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:right} th{background:#eee}
      .line{font-size:13px;line-height:1.9} .muted{color:#777;font-size:13px} .day{page-break-inside:avoid} hr{border:none;border-top:2px solid #333;margin:14px 0}
      .hero{border:2px solid #059669;border-radius:12px;padding:18px;text-align:center;margin:10px 0} .hero-label{color:#047857;font-size:13px;font-weight:bold;margin:0} .hero-num{font-size:34px;font-weight:900;margin:6px 0} .hero-sub{color:#444;font-size:13px;margin:0} .hero-note{color:#777;font-size:12px;margin:4px 0 0}
      @media print{ body{margin:12px} }
    </style></head><body>
      <h1>${periodEsc(RESTAURANT_NAME)} — تقرير فترة تفصيلي</h1>
      <p class="sub">من ${rep.from} إلى ${rep.to} (${rep.daysCount} يوم) · اتعمل بتاريخ ${periodDateTime(rep.generatedAt)} · اليوم بيتحسب من 6 الصبح لـ 6 الصبح</p>
      <hr>
      <div class="hero">
        <p class="hero-label">صافي كاش الفترة</p>
        <p class="hero-num">${money(plainNet)}</p>
        <p class="hero-sub">كاش ${money(pays.cash || 0)} − اللي طلع من الدرج ${money(t.expensesTotal)} + إيداعات ${money(t.depositsTotal)} · من ${rep.from} إلى ${rep.to} · ${plainNum(t.count)} أوردر</p>
        <p class="hero-note">ده صافي كاش الفترة بس، غير الفلوس اللي كانت في الدرج قبل الفترة.</p>
      </div>
      <h2>ملخص الفترة ببساطة</h2>
      ${tbl(['البيان', 'المبلغ'], plainTotalsRows)}
      <h2>الخلاصة</h2>
      ${plainTotalsLines(rep).map((l) => `<p class="line">${periodEsc(l)}</p>`).join('')}
      <h2>كل يوم في سطر</h2>
      ${tbl(['اليوم', 'أوردرات', 'مبيعات', 'كاش', 'فيزا', 'انستا', 'سلف', 'مصروفات أخرى', 'المتوقع في الدرج'], plainDaysRows)}
      <hr>
      <h2>📌 إجمالي الفترة</h2>
      <p class="line">أوردرات: <strong>${t.count || 0}</strong> · مبيعات: <strong>${money(t.total)}</strong> · كاش ${money(pays.cash || 0)} · فيزا ${money(pays.visa || 0)} · انستا ${money(pays.instapay || 0)} · محفظة ${money(pays.wallet || 0)} · طلبات ${money(t.talabat)} · خصومات ${money(t.discounts)} · ملغي ${t.cancelled || 0} (${money(t.cancelledTotal)}) · إيداعات ${money(t.depositsTotal)}</p>
      <p class="line">💰 إجمالي السلف: <strong>${money(t.advancesTotal)}</strong> (${t.advancesCount || 0} سلفة) · 💸 مصروفات أخرى: <strong>${money(t.otherExpensesTotal)}</strong> · إجمالي الخارج من الدرج: <strong>${money(t.expensesTotal)}</strong></p>
      ${(rep.advancesByPerson || []).length > 0 ? `<h2>💰 السلف حسب الشخص</h2>` + tbl(['الاسم', 'عدد السلف', 'الإجمالي', 'آخر سلفة'], (rep.advancesByPerson || []).map((p) => `<tr><td><strong>${periodEsc(p.person)}</strong></td><td>${p.count}</td><td>${money(p.total)}</td><td>${periodDateTime(p.lastAt)}</td></tr>`).join('')) : ''}
      ${(rep.advances || []).length > 0 ? `<h2>💰 كل السلف بالتفصيل</h2>` + tbl(['التاريخ', 'الوقت', 'الاسم', 'المبلغ', 'السبب', 'سجّلها', 'وردية'], advRows(rep.advances)) : '<p class="muted">مفيش سلف في الفترة دي.</p>'}
      <hr>
      ${daysHtml}
      <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };<\/script>
    </body></html>`;
    const w = window.open('', '_blank');
    if (!w) return alert('المتصفح منع فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول تاني.');
    w.document.write(html);
    w.document.close();
    w.focus();
  };

  const downloadExcel = () => {
    if (!rep) return;
    const t = rep.totals || {};
    const lines = [];
    lines.push(['التاريخ', 'اليوم', 'نوع الصف', 'الوقت', 'البيان / الاسم', 'المبلغ (ج)', 'سجّلها', 'ملاحظات'].map(periodCsvCell).join(','));
    lines.push([rep.from, '', 'إجمالي الفترة', '', `مبيعات ${t.total || 0} — أوردرات ${t.count || 0} — سلف ${t.advancesTotal || 0} (${t.advancesCount || 0}) — مصروفات أخرى ${t.otherExpensesTotal || 0}`, t.total || 0, '', ''].map(periodCsvCell).join(','));
    (rep.days || []).forEach((d) => {
      const dp = d.payments || {};
      lines.push([d.date, periodWeekday(d.date), 'ملخص يوم', '', `أوردرات ${d.count || 0} — كاش ${dp.cash || 0} — فيزا ${dp.visa || 0} — انستا ${dp.instapay || 0} — محفظة ${dp.wallet || 0} — طلبات ${d.talabat || 0} — خصومات ${d.discounts || 0} — ملغي ${d.cancelled || 0}`, d.total || 0, '', ''].map(periodCsvCell).join(','));
      (d.shifts || []).forEach((s) => lines.push([d.date, periodWeekday(d.date), 'وردية', `${periodTime(s.openedAt)} - ${s.closedAt ? periodTime(s.closedAt) : 'مفتوحة'}`, `${s.label} — ${s.openedBy}`, s.total || 0, s.openedBy, `متوقع الدرج: ${s.expectedCash ?? '-'} — سلف الوردية: ${s.advancesTotal || 0} — ${s.notes || ''}`].map(periodCsvCell).join(',')));
      (d.advances || []).forEach((a) => lines.push([d.date, periodWeekday(d.date), 'سلفة', periodTime(a.at), a.person, a.amount, a.by, `${a.reason} — وردية: ${a.shiftBy}`].map(periodCsvCell).join(',')));
      (d.expenses || []).filter((m) => !m.isAdvance).forEach((m) => lines.push([d.date, periodWeekday(d.date), 'مصروف', periodTime(m.at), m.reason, m.amount, m.by, `وردية: ${m.shiftBy}`].map(periodCsvCell).join(',')));
      (d.deposits || []).forEach((m) => lines.push([d.date, periodWeekday(d.date), 'إيداع', periodTime(m.at), m.reason, m.amount, m.by, `وردية: ${m.shiftBy}`].map(periodCsvCell).join(',')));
    });
    periodDownload(`period-report-${rep.from}_to_${rep.to}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  };

  const downloadAdvances = () => {
    if (!rep) return;
    const lines = [];
    lines.push(['التاريخ', 'اليوم', 'الوقت', 'الاسم', 'المبلغ (ج)', 'السبب', 'سجّلها', 'وردية الكاشير'].map(periodCsvCell).join(','));
    (rep.advances || []).forEach((a) => lines.push([a.day || '', periodWeekday(a.day || rep.from), periodTime(a.at), a.person, a.amount, a.reason, a.by, a.shiftBy].map(periodCsvCell).join(',')));
    lines.push(['', '', '', 'الإجمالي', rep.totals?.advancesTotal || 0, '', '', ''].map(periodCsvCell).join(','));
    periodDownload(`advances-${rep.from}_to_${rep.to}.csv`, '\uFEFF' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  };

  const t = rep?.totals || {};
  const plainNet = plainNetCash(rep);
  const kpi2 = (label, value, hot, sub) => (
    <div className={`rounded-xl px-4 py-3 border ${hot ? 'bg-amber-500/10 border-amber-500/50' : 'bg-black/20 border-white/10'}`}>
      <p className="text-xs text-zinc-400 font-bold">{label}</p>
      <p className={`text-xl font-black mt-1 ${hot ? 'text-amber-300' : 'text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 mt-1 leading-4">{sub}</p>}
    </div>
  );

  return (
    <div className={card + ' space-y-4'}>
      <div>
        <h4 className="font-black text-lg text-white">📋 تقرير فترة تفصيلي + السلف</h4>
        <p className="text-xs text-zinc-400 mt-1 leading-5">اختار أي فترة (أسبوع، شهر كامل، لحد 92 يوم) وشوف كل يوم لوحده: المبيعات والورديات والمصروفات، والسلف بالاسم والمبلغ والوقت ومين سجّلها. اليوم بيتحسب من 6 الصبح لـ 6 الصبح.</p>
      </div>

      {!hidePickers && (<>
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="block text-xs text-zinc-400 mb-1">من يوم</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inp} /></div>
        <div><label className="block text-xs text-zinc-400 mb-1">إلى يوم</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inp} /></div>
        <button type="button" disabled={busy} onClick={() => load()} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">{busy ? '... جاري التحميل' : '📈 عرض التقرير'}</button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => preset('today')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">اليوم</button>
        <button type="button" onClick={() => preset('week')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">آخر 7 أيام</button>
        <button type="button" onClick={() => preset('month')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">آخر 30 يوم</button>
        <button type="button" onClick={() => preset('thisMonth')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">الشهر الحالي</button>
        <button type="button" onClick={() => preset('lastMonth')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">الشهر اللي فات</button>
      </div>
      </>)}

      {msg && <p className="text-red-400 text-sm font-bold">{msg}</p>}

      {rep && (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={printReport} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-black text-sm">🖨️ طباعة التقرير (A4 / PDF)</button>
            <button type="button" onClick={downloadExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl font-black text-sm">📥 تحميل Excel — كل التفاصيل</button>
            <button type="button" onClick={downloadAdvances} className="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2.5 rounded-xl font-black text-sm">💰 تحميل السلف فقط (Excel)</button>
          </div>
          <p className="text-[11px] text-zinc-500">ملف الـ Excel بصيغة CSV وبيفتح في Excel و Google Sheets بالعربي عادي. من الطباعة تقدر تختار "حفظ كـ PDF".</p>

          <div className="rounded-2xl border border-emerald-500/40 bg-gradient-to-b from-emerald-500/15 to-emerald-500/5 p-5 md:p-6 text-center space-y-1.5">
            <p className="text-xs font-bold text-emerald-300">صافي كاش الفترة</p>
            <p className="text-4xl md:text-5xl font-black text-white leading-tight">{money(plainNet)}</p>
            <p className="text-xs text-zinc-300 leading-5">كاش {money(t.payments?.cash || 0)} − اللي طلع من الدرج {money(t.expensesTotal)} + إيداعات {money(t.depositsTotal)} · من {rep.from} إلى {rep.to} · {t.count || 0} أوردر</p>
            <p className="text-[11px] text-zinc-500">ده صافي كاش الفترة بس، غير الفلوس اللي كانت في الدرج قبل الفترة.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {kpi2('إجمالي المبيعات', money(t.total), false, `${t.count || 0} أوردر`)}
            {kpi2('💵 كاش', money(t.payments?.cash || 0))}
            {kpi2('💳 فيزا', money(t.payments?.visa || 0))}
            {kpi2('📱 انستا باي', money(t.payments?.instapay || 0))}
            {kpi2('👛 محفظة', money(t.payments?.wallet || 0))}
            {kpi2('🛍️ طلبات', money(t.talabat), false, `كاش طلبات ${money(t.talabatCash)} · فيزا طلبات ${money(t.talabatVisa)} — من ضمن المبيعات`)}
            {kpi2('💰 إجمالي السلف', money(t.advancesTotal), true, `${t.advancesCount || 0} سلفة`)}
            {kpi2('💸 مصروفات أخرى', money(t.otherExpensesTotal))}
            {kpi2('خارج من الدرج', money(t.expensesTotal))}
            {kpi2('➕ إيداعات', money(t.depositsTotal))}
            {kpi2('🏷️ خصومات', money(t.discounts))}
            {kpi2('❌ ملغي', `${t.cancelled || 0} · ${money(t.cancelledTotal)}`)}
          </div>

          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4 md:p-5 space-y-2.5">
            <h5 className="font-black text-emerald-300 text-base">الخلاصة</h5>
            {plainTotalsLines(rep).map((line, i) => (
              <p key={i} className="text-sm text-white leading-7">{line}</p>
            ))}
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h5 className="font-black text-white">كل يوم في سطر</h5>
              <span className="text-xs text-zinc-400">{(rep.days || []).length} يوم</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="text-zinc-400 text-xs border-b border-white/10">
                    <th className="text-right font-bold px-4 py-2.5">اليوم</th>
                    <th className="text-center font-bold px-2 py-2.5">أوردرات</th>
                    <th className="text-center font-bold px-2 py-2.5">مبيعات</th>
                    <th className="text-center font-bold px-2 py-2.5">كاش</th>
                    <th className="text-center font-bold px-2 py-2.5">فيزا</th>
                    <th className="text-center font-bold px-2 py-2.5">انستا</th>
                    <th className="text-center font-bold px-2 py-2.5">سلف</th>
                    <th className="text-center font-bold px-2 py-2.5">مصروفات أخرى</th>
                    <th className="text-center font-bold px-4 py-2.5">المتوقع في الدرج</th>
                  </tr>
                </thead>
                <tbody>
                  {(rep.days || []).map((d, i) => {
                    const dp = d.payments || {};
                    const close = plainDayClose(d);
                    const noActivity = !(d.count > 0) && (d.shifts || []).length === 0 && (d.expenses || []).length === 0 && (d.deposits || []).length === 0;
                    return (
                      <tr key={d.date} className={i % 2 === 1 ? 'bg-white/[0.03]' : ''}>
                        <td className="px-4 py-2.5 whitespace-nowrap"><span className="font-black text-white">{d.date}</span> <span className="text-zinc-400 text-xs">({periodWeekday(d.date)})</span>{noActivity && <span className="text-zinc-500 text-xs"> · مفيش نشاط</span>}</td>
                        <td className="text-center px-2 py-2.5 text-zinc-200">{d.count || 0}</td>
                        <td className="text-center px-2 py-2.5 font-bold text-white">{money(d.total)}</td>
                        <td className="text-center px-2 py-2.5 text-zinc-200">{money(dp.cash || 0)}</td>
                        <td className="text-center px-2 py-2.5 text-zinc-200">{money(dp.visa || 0)}</td>
                        <td className="text-center px-2 py-2.5 text-zinc-200">{money(dp.instapay || 0)}</td>
                        <td className="text-center px-2 py-2.5 text-amber-300 font-bold">{money(d.advancesTotal)}</td>
                        <td className="text-center px-2 py-2.5 text-zinc-200">{money(d.otherExpensesTotal)}</td>
                        <td className="text-center px-4 py-2.5 font-bold text-emerald-300">{close.kind === 'closed' ? money(close.amount) : close.kind === 'open' ? <span className="text-amber-300">لسه مفتوحة</span> : <span className="text-zinc-500">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {(rep.advancesByPerson || []).length > 0 && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-2">
              <h5 className="font-black text-amber-300">💰 السلف حسب الشخص — {money(t.advancesTotal)}</h5>
              {(rep.advancesByPerson || []).map((p) => (
                <div key={p.person} className="flex flex-wrap items-center justify-between gap-2 text-sm py-1.5 border-b border-white/5 last:border-0">
                  <span className="font-black text-white">{p.person}</span>
                  <span className="text-zinc-400 text-xs">{p.count} سلفة · آخر سلفة {periodDateTime(p.lastAt)}</span>
                  <span className="font-black text-amber-300">{money(p.total)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            {(rep.days || []).map((d) => (
              <details key={d.date} open={(rep.days || []).length <= 7} className="rounded-xl border border-white/10 bg-black/20 p-4">
                <summary className="cursor-pointer flex flex-wrap items-center justify-between gap-2 font-black text-white text-sm">
                  <span>📅 {d.date} — {periodWeekday(d.date)}</span>
                  <span className="text-xs font-bold text-zinc-300">{d.count || 0} أوردر · مبيعات {money(d.total)} · سلف <span className="text-amber-300">{money(d.advancesTotal)}</span></span>
                </summary>
                <div className="mt-3 space-y-3 text-sm">
                  <p className="text-xs text-zinc-400 leading-5">كاش {money(d.payments?.cash || 0)} · فيزا {money(d.payments?.visa || 0)} · انستا {money(d.payments?.instapay || 0)} · محفظة {money(d.payments?.wallet || 0)} · طلبات {money(d.talabat)} · خصومات {money(d.discounts)} · ملغي {d.cancelled || 0} ({money(d.cancelledTotal)}) · إيداعات {money(d.depositsTotal)}</p>

                  {(d.shifts || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="font-black text-white text-xs">🕒 الورديات</p>
                      {(d.shifts || []).map((s) => (
                        <div key={s.id} className="flex flex-wrap justify-between gap-2 text-xs bg-black/30 rounded-lg px-3 py-2">
                          <span className="text-zinc-200">{s.label} — <strong className="text-white">{s.openedBy}</strong> · {periodTime(s.openedAt)} ← {s.closedAt ? periodTime(s.closedAt) : 'لسه مفتوحة'}</span>
                          <span className="text-zinc-300">{s.count || 0} أوردر · {money(s.total)}{s.expectedCash !== null && s.expectedCash !== undefined ? ` · متوقع الدرج ${money(s.expectedCash)}` : ''} · سلف {money(s.advancesTotal)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(d.advances || []).length > 0 && (
                    <div className="space-y-1">
                      <p className="font-black text-amber-300 text-xs">💰 سلف اليوم — {money(d.advancesTotal)}</p>
                      {(d.advances || []).map((a, i) => (
                        <div key={i} className="flex flex-wrap justify-between gap-2 text-xs bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                          <span className="text-zinc-200"><strong className="text-white">{a.person}</strong> · {periodTime(a.at)} · {a.reason} <span className="text-zinc-500">(سجّلها {a.by} · وردية {a.shiftBy})</span></span>
                          <span className="font-black text-amber-300">{money(a.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {(d.expenses || []).filter((m) => !m.isAdvance).length > 0 && (
                    <div className="space-y-1">
                      <p className="font-black text-white text-xs">💸 مصروفات أخرى — {money(d.otherExpensesTotal)}</p>
                      {(d.expenses || []).filter((m) => !m.isAdvance).map((m, i) => (
                        <div key={i} className="flex flex-wrap justify-between gap-2 text-xs px-3 py-1.5 border-b border-white/5 last:border-0">
                          <span className="text-zinc-300">{m.reason} <span className="text-zinc-500">({periodTime(m.at)} · {m.by})</span></span>
                          <span className="font-black text-red-400">- {money(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!(d.count > 0) && (d.shifts || []).length === 0 && (d.expenses || []).length === 0 && (d.deposits || []).length === 0 && (
                    <p className="text-xs text-zinc-500">مفيش نشاط مسجل في اليوم ده.</p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
};


// ================= تنزيل Excel حقيقي (.xlsx) من غير أي مكتبة =================
// ملف xlsx هو ZIP فيه ملفات XML. هنا بنبنيه يدويًا (تخزين من غير ضغط) عشان
// المحاسب ينزّل شيت جاهز يفتح في Excel على طول، بالأرقام أرقام مش نص.
const xlsxXmlEsc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xlsxColLetter = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const xlsxCrcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
const xlsxCrc32 = (bytes) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = xlsxCrcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const xlsxZipStore = (files) => {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  const dosDate = ((2024 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const data = enc.encode(f.data);
    const name = enc.encode(f.name);
    const crc = xlsxCrc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, 0, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);
  const all = [...parts, ...central, new Uint8Array(eocd.buffer)];
  const total = all.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
};

// rows: صفوف، كل خلية نص أو رقم. titleRows: سطور عنوان في الأول.
// totalsRow: صف إجمالي عريض. summaryLines: [[نص، رقم], ...] بعد سطر فاضي.
// الأنماط: 0 عادي، 1 عنوان الجدول (أصفر وعريض)، 2 عريض، 3 عنوان كبير.
const buildXlsxFile = ({ titleRows = [], headers, rows, widths = [], totalsRow = null, summaryLines = [], extraSections = [] }) => {
  const strings = [];
  const strIdx = new Map();
  const sIdx = (v) => { const s = String(v ?? ''); if (!strIdx.has(s)) { strIdx.set(s, strings.length); strings.push(s); } return strIdx.get(s); };
  const sheetRows = [];
  titleRows.forEach((t, i) => sheetRows.push([{ v: t, s: i === 0 ? 3 : 2 }]));
  if (titleRows.length) sheetRows.push([]);
  sheetRows.push(headers.map((h) => ({ v: h, s: 1 })));
  rows.forEach((r) => sheetRows.push(r.map((c) => ({ v: c, s: 0 }))));
  if (totalsRow) sheetRows.push(totalsRow.map((c) => ({ v: c, s: 2 })));
  if (summaryLines.length) {
    sheetRows.push([]);
    summaryLines.forEach(([label, val]) => sheetRows.push([{ v: label, s: 2 }, { v: val, s: 2 }]));
  }
  for (const sec of extraSections) {
    sheetRows.push([]);
    sheetRows.push([{ v: sec.title, s: 3 }]);
    sheetRows.push(sec.headers.map((h) => ({ v: h, s: 1 })));
    sec.rows.forEach((r) => sheetRows.push(r.map((c) => ({ v: c, s: 0 }))));
  }
  const body = sheetRows.map((row, ri) => {
    const cells = row.map((cell, ci) => {
      const ref = `${xlsxColLetter(ci)}${ri + 1}`;
      if (cell == null) return `<c r="${ref}"/>`;
      if (typeof cell.v === 'number') return `<c r="${ref}"${cell.s ? ` s="${cell.s}"` : ''}><v>${Math.round(cell.v * 100) / 100}</v></c>`;
      return `<c r="${ref}"${cell.s ? ` s="${cell.s}"` : ''} t="s"><v>${sIdx(cell.v)}</v></c>`;
    }).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" tabSelected="1" workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
  const sharedXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xlsxXmlEsc(s)}</t></si>`).join('')}</sst>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor rgb="FFFFFF00"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="التقرير" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  return xlsxZipStore([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'xl/workbook.xml', data: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
    { name: 'xl/sharedStrings.xml', data: sharedXml },
    { name: 'xl/styles.xml', data: stylesXml }
  ]);
};
const xlsxDownload = (filename, bytes) => {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const acctRound = (v) => Math.round((Number(v) || 0) * 100) / 100;

// ================= الداش بورد المجمعة (مطعمين) =================
// دوال دمج نقية (من غير React): بتجمع تقارير المطعمين في شكل واحد زي تقرير مطعم واحد،
// عشان التبويبات تعرضها من غير ما تعرف إن الداتا جاية من سيرفرين.
const acctNum = (v) => Number(v) || 0;
const acctSumPayments = (a = {}, b = {}) => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = acctNum(out[k]) + acctNum(v);
  return out;
};
const acctSumTotals = (a, b) => ({
  count: acctNum(a?.count) + acctNum(b?.count),
  total: acctNum(a?.total) + acctNum(b?.total),
  delivery: acctNum(a?.delivery) + acctNum(b?.delivery),
  discounts: acctNum(a?.discounts) + acctNum(b?.discounts),
  talabat: acctNum(a?.talabat) + acctNum(b?.talabat),
  talabatCash: acctNum(a?.talabatCash) + acctNum(b?.talabatCash),
  talabatVisa: acctNum(a?.talabatVisa) + acctNum(b?.talabatVisa),
  cancelled: acctNum(a?.cancelled) + acctNum(b?.cancelled),
  cancelledTotal: acctNum(a?.cancelledTotal) + acctNum(b?.cancelledTotal),
  payments: acctSumPayments(a?.payments, b?.payments),
  advancesTotal: acctNum(a?.advancesTotal) + acctNum(b?.advancesTotal),
  advancesCount: acctNum(a?.advancesCount) + acctNum(b?.advancesCount),
  expensesTotal: acctNum(a?.expensesTotal) + acctNum(b?.expensesTotal),
  otherExpensesTotal: acctNum(a?.otherExpensesTotal) + acctNum(b?.otherExpensesTotal),
  depositsTotal: acctNum(a?.depositsTotal) + acctNum(b?.depositsTotal)
});
const acctDayNums = ['count', 'total', 'delivery', 'discounts', 'talabat', 'talabatCash', 'talabatVisa', 'cancelled', 'cancelledTotal', 'advancesTotal', 'advancesCount', 'expensesTotal', 'otherExpensesTotal', 'depositsTotal'];
const mergePeriodReports = (a, b) => {
  if (!a) return b || null;
  if (!b) return a;
  const daysMap = new Map();
  const addDay = (d) => {
    const key = d.date;
    const cur = daysMap.get(key);
    if (!cur) {
      daysMap.set(key, { ...d, payments: { ...(d.payments || {}) }, advances: [...(d.advances || [])], expenses: [...(d.expenses || [])], deposits: [...(d.deposits || [])], shifts: [...(d.shifts || [])], categories: (d.categories || []).map((c) => ({ ...c, items: [...(c.items || [])] })) });
      return;
    }
    for (const k of acctDayNums) cur[k] = acctNum(cur[k]) + acctNum(d[k]);
    cur.payments = acctSumPayments(cur.payments, d.payments);
    cur.advances = [...cur.advances, ...(d.advances || [])];
    cur.expenses = [...cur.expenses, ...(d.expenses || [])];
    cur.deposits = [...cur.deposits, ...(d.deposits || [])];
    cur.shifts = [...cur.shifts, ...(d.shifts || [])];
    for (const c of d.categories || []) {
      const ex = cur.categories.find((x) => x.name === c.name);
      if (!ex) { cur.categories.push({ ...c, items: [...(c.items || [])] }); continue; }
      ex.qty = acctNum(ex.qty) + acctNum(c.qty);
      ex.total = acctNum(ex.total) + acctNum(c.total);
      for (const it of c.items || []) {
        const ei = ex.items.find((x) => x.name === it.name);
        if (!ei) ex.items.push({ ...it });
        else { ei.qty = acctNum(ei.qty) + acctNum(it.qty); ei.total = acctNum(ei.total) + acctNum(it.total); }
      }
    }
  };
  (a.days || []).forEach(addDay);
  (b.days || []).forEach(addDay);
  const days = [...daysMap.values()].sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const byPerson = new Map();
  for (const p of [...(a.advancesByPerson || []), ...(b.advancesByPerson || [])]) {
    const cur = byPerson.get(p.person) || { person: p.person, count: 0, total: 0, lastAt: null };
    cur.count += acctNum(p.count);
    cur.total += acctNum(p.total);
    if (p.lastAt && (!cur.lastAt || new Date(p.lastAt) > new Date(cur.lastAt))) cur.lastAt = p.lastAt;
    byPerson.set(p.person, cur);
  }
  return {
    from: a.from, to: a.to,
    daysCount: Math.max(a.daysCount || 0, b.daysCount || 0),
    generatedAt: new Date().toISOString(),
    totals: acctSumTotals(a.totals, b.totals),
    advances: [...(a.advances || []), ...(b.advances || [])],
    advancesByPerson: [...byPerson.values()].sort((x, y) => y.total - x.total),
    expenses: [...(a.expenses || []), ...(b.expenses || [])],
    shifts: [...(a.shifts || []), ...(b.shifts || [])],
    days
  };
};
// صفوف الأصناف/الدليل: كل صف بيتوسم باسم مطعمه، وبتترتب بالرمز (نص كفتة 1..300 وبعدها بحبح 301..)
const mergeItemsRows = (ownRows, otherRows, ownName, otherName) => {
  const all = [
    ...(ownRows || []).map((r) => ({ ...r, restaurant: ownName })),
    ...(otherRows || []).map((r) => ({ ...r, restaurant: otherName }))
  ];
  all.sort((a, b) => (a.code == null ? 1 : b.code == null ? -1 : Number(a.code) - Number(b.code)));
  return all;
};
// القنوات: سطر لكل مطعم × قناة، والاسم بيبقى "المطعم — القناة"
const mergeChannels = (ownChannels, otherChannels, ownName, otherName) => {
  const out = [];
  for (const [rows, name] of [[ownChannels, ownName], [otherChannels, otherName]]) {
    for (const c of rows || []) out.push({ ...c, restaurant: name, label: `${name} — ${c.label}` });
  }
  return out;
};

// ================= صفحة المحاسب =================
// صفحة منفصلة تمامًا: مفيش أي لينك ليها من الكاشير ولا الإدارة ولا صفحات العملاء،
// والدخول ليها بجلسة لوحدها (accountantSession) غير جلسة الكاشير.
const ACCOUNTANT_KEY = 'accountantSession';
// الجلسة فيها توكن لكل مطعم: { own, other } — والشكل القديم { token } بيتحوّل لـ own بس
const readAccountant = () => { try { const d = JSON.parse(localStorage.getItem(ACCOUNTANT_KEY)) || null; if (!d) return null; if (d.token && !d.own) return { own: d.token, other: null }; return d; } catch { return null; } };
const saveAccountant = (data) => { try { localStorage.setItem(ACCOUNTANT_KEY, JSON.stringify(data)); } catch {} };
const clearAccountant = () => { try { localStorage.removeItem(ACCOUNTANT_KEY); } catch {} };

const AccountantLogin = ({ onLogin }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // نفس الرقم السري بيتجرّب على المطعمين: لو المطعم ده اتقبل والتاني لأ (رقم مختلف أو لسه متظبطش)،
  // بندخل عادي والمطعم التاني بيتوصّل بعدين من جوه الصفحة.
  const submit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      let ownFailed = false;
      const tryLogin = async (base, isOwn) => {
        try {
          const res = await fetch(`${base}/api/auth/accountant-login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin })
          });
          const data = await res.json().catch(() => ({}));
          return res.ok ? data.token : null;
        } catch { if (isOwn) ownFailed = true; return null; }
      };
      const [ownToken, otherToken] = await Promise.all([tryLogin(API_BASE, true), tryLogin(OTHER_API_BASE, false)]);
      if (ownFailed) throw new Error('مشكلة في الاتصال بالسيرفر');
      if (!ownToken) throw new Error('الرقم السري غلط');
      setPin('');
      onLogin({ own: ownToken, other: otherToken });
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? 'مشكلة في الاتصال بالسيرفر' : err.message);
    } finally { setLoading(false); }
  };
  return (
    <div dir="rtl" className="min-h-screen bg-[#12080A] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[#1C0D10] border border-[#800020] p-8 rounded-2xl w-full max-w-md shadow-2xl text-center">
        <h2 className="text-2xl font-black text-[#FFD700] mb-2">📊 صفحة المحاسب — {RESTAURANT_NAME}</h2>
        <p className="text-sm text-zinc-400 mb-6 leading-6">دخول المحاسب بس. نفس الرقم السري بيدخّل على المطعمين. التقارير هنا مش بتظهر للكاشير ولا للعملاء.</p>
        <input type="password" placeholder="الرقم السري" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" inputMode="numeric" className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-center mb-4 text-lg tracking-widest" />
        {error && <p className="text-red-400 text-sm font-bold mb-4">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-[#800020] text-white font-bold py-3 rounded-xl hover:bg-[#990026] transition shadow disabled:opacity-60">{loading ? 'جاري الدخول...' : 'دخول'}</button>
      </form>
    </div>
  );
};

const ACCOUNTANT_TYPES = [
  { key: 'all', label: 'الكل' },
  { key: 'pickup', label: 'استلام' },
  { key: 'delivery', label: 'توصيل' },
  { key: 'talabat', label: 'طلبات' }
];
const acctTypeLabel = (k) => (ACCOUNTANT_TYPES.find((t) => t.key === k) || {}).label || 'الكل';

const AccountantReports = ({ session, onSessionChange, onLogout }) => {
  const card = 'bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5';
  const inp = 'w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm';
  const [tab, setTab] = useState('sales');
  const [scope, setScope] = useState('both');
  const [otherPin, setOtherPin] = useState('');
  const [otherMsg, setOtherMsg] = useState('');
  const [otherBusy, setOtherBusy] = useState(false);
  const [catKey, setCatKey] = useState('');
  // كاش تقارير المحاسب: التبديل بين المطعمين أو الرجوع لتبويب اتفتح قبل كده يعرض البيانات على طول من غير ما يرجع للسيرفر
  const reportCache = useRef(new Map());
  const cachePut = (k, v) => { const m = reportCache.current; if (m.size >= 60) m.delete(m.keys().next().value); m.set(k, v); };
  const otherConnected = !!session.other;
  const effectiveScope = otherConnected ? scope : 'own';
  const scopeName = effectiveScope === 'both' ? `${RESTAURANT_NAME} + ${OTHER_RESTAURANT_NAME}` : effectiveScope === 'other' ? OTHER_RESTAURANT_NAME : RESTAURANT_NAME;
  const [period, setPeriod] = useState(() => ({ from: periodAddDays(periodBizToday(), -6), to: periodBizToday() }));
  const [type, setType] = useState('all');
  const [itemsData, setItemsData] = useState(null);
  const [itemsBusy, setItemsBusy] = useState(false);
  const [itemsMsg, setItemsMsg] = useState('');
  const [itemsKey, setItemsKey] = useState('');
  const [sumData, setSumData] = useState(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sumMsg, setSumMsg] = useState('');
  const [sumKey, setSumKey] = useState('');
  const [catData, setCatData] = useState(null);
  const [catBusy, setCatBusy] = useState(false);
  const [catMsg, setCatMsg] = useState('');

  // جلب من مطعم واحد (own = نص كفتة، other = بحبح) بالتوكن بتاعه
  const acctFetch = async (site, path, opts = {}) => {
    const base = site === 'other' ? OTHER_API_BASE : API_BASE;
    const tok = site === 'other' ? session.other : session.own;
    const res = await fetch(`${base}${path}`, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok}` } });
    if (res.status === 401) {
      if (site === 'own') { onLogout(); throw new Error('unauthorized'); }
      throw new Error('other-unauthorized');
    }
    return res;
  };
  const accountantFetch = (path, opts = {}) => acctFetch('own', path, opts);

  const fetchSiteJson = async (site, path) => {
    try {
      const r = await acctFetch(site, path);
      const d = await r.json().catch(() => ({}));
      return r.ok ? d : null;
    } catch (e) {
      if (e.message === 'unauthorized') throw e;
      if (e.message === 'other-unauthorized') return { __otherExpired: true };
      return null;
    }
  };

  // جلب نفس التقرير من المطعم/المطعمين حسب النطاق — المطعم اللي واقع مش بيوقف التاني
  const loadScoped = async (path) => {
    const sites = effectiveScope === 'both' ? ['own', 'other'] : [effectiveScope];
    const out = {};
    let otherExpired = false;
    await Promise.all(sites.map(async (s) => {
      const d = await fetchSiteJson(s, path);
      if (d && d.__otherExpired) { otherExpired = true; out[s] = null; }
      else out[s] = d;
    }));
    if (otherExpired) onSessionChange({ own: session.own, other: null });
    return out;
  };

  // تقرير المبيعات للمطعم/المطعمين — بيرجع شكل زي Response عشان PeriodReportPanel يعرضه زي ما هو
  const fetchPeriodReport = async (f, t) => {
    const cacheKey = `period|${effectiveScope}|${f}|${t}`;
    const hit = reportCache.current.get(cacheKey);
    if (hit) return { ok: true, json: async () => hit };
    const q = `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    if (effectiveScope !== 'both') {
      const r = await acctFetch(effectiveScope, `/api/accountant/reports/period${q}`);
      if (!r.ok) return r;
      const d = (await r.json().catch(() => null)) || {};
      if (d && !d.error) cachePut(cacheKey, d);
      return { ok: true, json: async () => d };
    }
    const got = await loadScoped(`/api/accountant/reports/period${q}`);
    const merged = mergePeriodReports(got.own, got.other);
    if (!merged) return { ok: false, json: async () => ({ error: 'تعذر الاتصال بالسيرفر' }) };
    cachePut(cacheKey, merged);
    return { ok: true, json: async () => merged };
  };

  const connectOther = async () => {
    setOtherBusy(true); setOtherMsg('');
    try {
      const res = await fetch(`${OTHER_API_BASE}/api/auth/accountant-login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: otherPin })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'الرقم السري غلط');
      setOtherPin('');
      onSessionChange({ own: session.own, other: data.token });
      setScope('both');
    } catch (e) { setOtherMsg(e.message === 'Failed to fetch' ? 'مشكلة في الاتصال بالسيرفر' : e.message); }
    setOtherBusy(false);
  };

  const loadItems = async (f, t, ty) => {
    const key = `${f}|${t}|${ty}|${effectiveScope}`;
    const cachedItems = reportCache.current.get(`items|${key}`);
    if (cachedItems) { setItemsData(cachedItems); setItemsKey(key); return; }
    setItemsBusy(true); setItemsMsg('');
    try {
      const got = await loadScoped(`/api/accountant/reports/items?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}&type=${encodeURIComponent(ty)}`);
      if (!got.own && !got.other) { setItemsMsg('تعذر الاتصال بالسيرفر'); setItemsData(null); }
      else {
        const rows = mergeItemsRows(got.own?.items, got.other?.items, RESTAURANT_NAME, OTHER_RESTAURANT_NAME);
        const data = {
          items: rows,
          itemsTotals: { qty: rows.reduce((a, r) => a + (Number(r.qty) || 0), 0), total: rows.reduce((a, r) => a + (Number(r.total) || 0), 0) },
          totals: { count: (got.own?.totals?.count || 0) + (got.other?.totals?.count || 0), discounts: (got.own?.totals?.discounts || 0) + (got.other?.totals?.discounts || 0) },
          type: ty
        };
        cachePut(`items|${key}`, data);
        setItemsData(data);
        setItemsKey(key);
      }
    } catch (e) { if (e.message !== 'unauthorized') setItemsMsg('تعذر الاتصال بالسيرفر'); }
    setItemsBusy(false);
  };

  const loadSummary = async (f, t) => {
    const key = `${f}|${t}|${effectiveScope}`;
    const cachedSum = reportCache.current.get(`summary|${key}`);
    if (cachedSum) { setSumData(cachedSum); setSumKey(key); return; }
    setSumBusy(true); setSumMsg('');
    try {
      const got = await loadScoped(`/api/accountant/reports/summary?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
      if (!got.own && !got.other) { setSumMsg('تعذر الاتصال بالسيرفر'); setSumData(null); }
      else {
        const data = {
          channels: mergeChannels(got.own?.channels, got.other?.channels, RESTAURANT_NAME, OTHER_RESTAURANT_NAME),
          totals: acctSumTotals(got.own?.totals, got.other?.totals)
        };
        cachePut(`summary|${key}`, data);
        setSumData(data);
        setSumKey(key);
      }
    } catch (e) { if (e.message !== 'unauthorized') setSumMsg('تعذر الاتصال بالسيرفر'); }
    setSumBusy(false);
  };

  useEffect(() => {
    if (tab === 'items' && itemsKey !== `${period.from}|${period.to}|${type}|${effectiveScope}`) loadItems(period.from, period.to, type);
    if (tab === 'channels' && sumKey !== `${period.from}|${period.to}|${effectiveScope}`) loadSummary(period.from, period.to);
    if (tab === 'catalog' && catKey !== effectiveScope) loadCatalog();
  }, [tab, period, type, effectiveScope]);

  const preset = (kind) => {
    const today = periodBizToday();
    let f = today, t = today;
    if (kind === 'yesterday') { f = periodAddDays(today, -1); t = f; }
    if (kind === 'week') f = periodAddDays(today, -6);
    if (kind === 'month') f = periodAddDays(today, -29);
    if (kind === 'thisMonth') f = `${today.slice(0, 7)}-01`;
    setPeriod({ from: f, to: t });
  };

  const downloadItemsXlsx = () => {
    if (!itemsData) return;
    const rows = [];
    (itemsData.items || []).forEach((it) => {
      rows.push([it.restaurant || '-', it.code ?? '-', it.name, '—', it.qty, acctRound(it.total)]);
      (it.contents || []).forEach((c) => rows.push([it.restaurant || '-', c.code ?? '-', `↳ ${c.name}`, `${c.boxName || it.name}${(c.box ?? it.code) != null ? ` (${c.box ?? it.code})` : ''}`, c.qty, '']));
    });
    const bytes = buildXlsxFile({
      titleRows: [
        `${scopeName} — تقرير مبيعات الأصناف`,
        `الفترة: من ${period.from} إلى ${period.to} (اليوم بيتحسب من 6 الصبح لـ 6 الصبح)`,
        `القناة: ${acctTypeLabel(type)}`,
        `اتعمل بتاريخ ${new Date().toLocaleString('ar-EG')}`
      ],
      headers: ['المطعم', 'الرمز', 'اسم الصنف', 'البوكس', 'عدد الأصناف', 'مجموع سعر المبيعات (ج)'],
      rows,
      widths: [16, 10, 45, 22, 14, 22],
      totalsRow: ['', '', 'الإجمالي', '', itemsData.itemsTotals?.qty || 0, acctRound(itemsData.itemsTotals?.total)],
      summaryLines: [
        ['إجمالي مبيعات الأصناف', acctRound(itemsData.itemsTotals?.total)],
        ['الخصومات', acctRound(itemsData.totals?.discounts)],
        ['صافي المبيعات بعد الخصم', acctRound((itemsData.itemsTotals?.total || 0) - (itemsData.totals?.discounts || 0))]
      ]
    });
    xlsxDownload(`items-sales-${period.from}_to_${period.to}-${type}-${effectiveScope}.xlsx`, bytes);
  };

  const downloadChannelsXlsx = () => {
    if (!sumData) return;
    const rows = (sumData.channels || []).map((c) => [c.label, c.count, acctRound(c.total), acctRound(c.payments?.cash), acctRound(c.payments?.visa), acctRound(c.payments?.instapay), acctRound(c.payments?.wallet), acctRound(c.delivery), acctRound(c.discounts)]);
    const tot = rows.reduce((a, r) => { for (let i = 1; i < r.length; i += 1) a[i] = (a[i] || 0) + (Number(r[i]) || 0); return a; }, []);
    const bytes = buildXlsxFile({
      titleRows: [
        `${scopeName} — تقرير قنوات البيع`,
        `الفترة: من ${period.from} إلى ${period.to} (اليوم بيتحسب من 6 الصبح لـ 6 الصبح)`,
        `اتعمل بتاريخ ${new Date().toLocaleString('ar-EG')}`
      ],
      headers: ['القناة', 'عدد الأوردرات', 'إجمالي المبيعات (ج)', 'كاش (ج)', 'فيزا (ج)', 'انستا باي (ج)', 'محفظة (ج)', 'رسوم توصيل (ج)', 'خصومات (ج)'],
      rows,
      widths: [14, 14, 18, 14, 14, 14, 14, 14, 14],
      totalsRow: ['الإجمالي', ...tot.slice(1)]
    });
    xlsxDownload(`channels-sales-${period.from}_to_${period.to}-${effectiveScope}.xlsx`, bytes);
  };

  const loadCatalog = async () => {
    const cachedCat = reportCache.current.get(`catalog|${effectiveScope}`);
    if (cachedCat) { setCatData(cachedCat); setCatKey(effectiveScope); return; }
    setCatBusy(true); setCatMsg('');
    try {
      const got = await loadScoped('/api/accountant/reports/catalog');
      if (!got.own && !got.other) { setCatMsg('تعذر الاتصال بالسيرفر'); setCatData(null); }
      else {
        const data = {
          items: mergeItemsRows(got.own?.items, got.other?.items, RESTAURANT_NAME, OTHER_RESTAURANT_NAME),
          boxContents: mergeItemsRows(got.own?.boxContents, got.other?.boxContents, RESTAURANT_NAME, OTHER_RESTAURANT_NAME)
        };
        cachePut(`catalog|${effectiveScope}`, data);
        setCatData(data);
        setCatKey(effectiveScope);
      }
    } catch (e) { if (e.message !== 'unauthorized') setCatMsg('تعذر الاتصال بالسيرفر'); }
    setCatBusy(false);
  };

  const downloadCatalogXlsx = () => {
    if (!catData) return;
    const rows = (catData.items || []).map((it) => [it.restaurant || '-', it.code ?? '-', it.name, it.category || '-', acctRound(it.price), it.available ? 'متاح' : 'موقوف']);
    const bytes = buildXlsxFile({
      titleRows: [
        `${scopeName} — دليل الأصناف والأكواد`,
        `كل الأصناف المسجلة (${(catData.items || []).length} صنف) — مرجع بأسماء الأصناف وأكوادها`,
        `اتعمل بتاريخ ${new Date().toLocaleString('ar-EG')}`
      ],
      headers: ['المطعم', 'الرمز', 'اسم الصنف', 'التصنيف', 'السعر (ج)', 'الحالة'],
      rows,
      widths: [16, 10, 45, 22, 14, 12],
      extraSections: (catData.boxContents || []).length ? [{
        title: `📦 محتويات البوكسات وأكوادها (${(catData.boxContents || []).length} محتوى)`,
        headers: ['المطعم', 'الرمز', 'البوكس', 'اسم المحتوى'],
        rows: (catData.boxContents || []).map((c) => [c.restaurant || '-', c.code ?? '-', c.boxName ? `${c.boxName}${c.box != null ? ` (${c.box})` : ''}` : '-', c.name])
      }] : []
    });
    xlsxDownload(`items-catalog-${effectiveScope}.xlsx`, bytes);
  };

  const tabBtn = (key, label) => (
    <button type="button" onClick={() => setTab(key)} className={`px-5 py-2.5 rounded-xl font-black text-sm transition border ${tab === key ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>{label}</button>
  );

  const itemsNet = (itemsData?.itemsTotals?.total || 0) - (itemsData?.totals?.discounts || 0);

  return (
    <div dir="rtl" className="min-h-screen bg-[#12080A] text-white px-4 py-8 md:px-8">
      <div className="max-w-7xl mx-auto space-y-5">
        <div className="flex flex-wrap gap-3 justify-between items-center border-b border-[#3A1218] pb-4">
          <div>
            <h2 className="text-3xl font-black text-[#FFD700]">📊 صفحة المحاسب</h2>
            <p className="text-sm text-zinc-400 mt-1">{scopeName} · التقارير دي قراءة بس — مفيش تعديل ولا بيانات عملاء.</p>
          </div>
          <button type="button" onClick={onLogout} className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded-xl text-sm font-bold">🚪 خروج</button>
        </div>

        {otherConnected && (
        <div className={card + ' flex flex-wrap gap-2 items-center'}>
          <span className="text-sm font-black text-white">المطعم:</span>
          <button type="button" onClick={() => setScope('both')} className={`px-4 py-2 rounded-xl font-black text-sm transition border ${effectiveScope === 'both' ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>الكل (المطعمين)</button>
          <button type="button" onClick={() => setScope('own')} className={`px-4 py-2 rounded-xl font-black text-sm transition border ${effectiveScope === 'own' ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>{RESTAURANT_NAME}</button>
          <button type="button" onClick={() => setScope('other')} className={`px-4 py-2 rounded-xl font-black text-sm transition border ${effectiveScope === 'other' ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>{OTHER_RESTAURANT_NAME}</button>
        </div>
        )}

        {!otherConnected && (
        <div className={card + ' space-y-3 border-[#FFD700]/50'}>
          <p className="text-sm text-zinc-200 leading-6">⚠️ <strong>{OTHER_RESTAURANT_NAME} غير متصل</strong> — التقارير دلوقتي من {RESTAURANT_NAME} بس. لو الرقم السري هناك مختلف أو لسه متظبطش، اكتبه هنا عشان توصّله.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input type="password" placeholder={`الرقم السري بتاع ${OTHER_RESTAURANT_NAME}`} value={otherPin} onChange={(e) => setOtherPin(e.target.value)} autoComplete="current-password" inputMode="numeric" className={inp + ' max-w-xs'} />
            <button type="button" disabled={otherBusy} onClick={connectOther} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-4 py-2.5 rounded-xl font-black text-sm">{otherBusy ? '... جاري التوصيل' : 'توصيل'}</button>
          </div>
          {otherMsg && <p className="text-red-400 text-sm font-bold">{otherMsg}</p>}
        </div>
        )}

{tab !== 'catalog' && (
        <div className={card + ' space-y-3'}>
          <div className="flex flex-wrap gap-3 items-end">
            <div><label className="block text-xs text-zinc-400 mb-1">من يوم</label><input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} className={inp} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">إلى يوم</label><input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} className={inp} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => preset('today')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">اليوم</button>
            <button type="button" onClick={() => preset('yesterday')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">أمس</button>
            <button type="button" onClick={() => preset('week')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">آخر 7 أيام</button>
            <button type="button" onClick={() => preset('month')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">آخر 30 يوم</button>
            <button type="button" onClick={() => preset('thisMonth')} className="bg-zinc-700 hover:bg-zinc-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">الشهر ده</button>
          </div>
          <p className="text-[11px] text-zinc-500">الفترة أقصاها 92 يوم. اليوم بيتحسب من 6 الصبح لـ 6 الصبح.</p>
        </div>
        )}

        <div className="flex flex-wrap gap-2">
          {tabBtn('sales', '📈 تقرير المبيعات')}
          {tabBtn('items', '🍽️ تقرير مبيعات الأصناف')}
          {tabBtn('channels', '🛵 تقرير قنوات البيع')}
          {tabBtn('catalog', '📋 الأصناف والأكواد')}
        </div>

        {tab === 'sales' && (
          <PeriodReportPanel authFetch={accountantFetch} card={card} inp={inp} base="/api/accountant/reports/period" period={period} onPeriodChange={setPeriod} hidePickers fetchReport={fetchPeriodReport} key={effectiveScope} />
        )}

        {tab === 'items' && (
          <div className={card + ' space-y-4'}>
            <div>
              <h4 className="font-black text-lg text-white">🍽️ تقرير مبيعات الأصناف</h4>
              <p className="text-xs text-zinc-400 mt-1 leading-5">نفس شكل الورقة الصفراء: الرمز واسم الصنف والعدد ومجموع المبيعات. اختار القناة الأول (الكل / استلام / توصيل / طلبات) — الجدول وملف الـ Excel هيطلعوا بنفس القناة اللي اخترتها.</p>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">القناة</label>
                <select value={type} onChange={(e) => setType(e.target.value)} className={inp}>
                  {ACCOUNTANT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </div>
              <button type="button" disabled={itemsBusy} onClick={() => loadItems(period.from, period.to, type)} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">{itemsBusy ? '... جاري التحميل' : '🔄 عرض'}</button>
              <button type="button" disabled={!itemsData} onClick={downloadItemsXlsx} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">⬇ تنزيل Excel</button>
            </div>
            {itemsMsg && <p className="text-red-400 text-sm font-bold">{itemsMsg}</p>}
            {itemsData && (
              <>
                {(itemsData.items || []).length === 0 ? (
                  <p className="text-sm text-zinc-400">مفيش مبيعات أصناف في الفترة دي.</p>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[680px]">
                        <thead>
                          <tr className="bg-[#FFFF00] text-black text-xs">
                            <th className="text-right font-black px-4 py-2.5">المطعم</th>
                            <th className="text-center font-black px-4 py-2.5">الرمز</th>
                            <th className="text-right font-black px-4 py-2.5">اسم الصنف</th>
                            <th className="text-center font-black px-2 py-2.5">عدد الأصناف</th>
                            <th className="text-center font-black px-4 py-2.5">مجموع سعر المبيعات (ج)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(itemsData.items || []).map((it, i) => (
                            <React.Fragment key={`${it.restaurant}-${it.code ?? it.name}`}>
                              <tr className={i % 2 === 1 ? 'bg-white/[0.03]' : ''}>
                                <td className="px-4 py-2.5 font-black text-white">{it.restaurant || '-'}</td>
                                <td className="px-4 py-2.5 text-center font-black text-white">{it.code ?? '-'}</td>
                                <td className="px-4 py-2.5 text-white">{it.name}</td>
                                <td className="px-2 py-2.5 text-center text-white">{it.qty}</td>
                                <td className="px-4 py-2.5 text-center font-black text-white">{money(it.total)}</td>
                              </tr>
                              {(it.contents || []).map((c, j) => (
                                <tr key={`c-${j}`} className="bg-white/[0.015]">
                                  <td className="px-4 py-2 text-zinc-400 text-xs">{it.restaurant || '-'}</td>
                                  <td className="px-4 py-2 text-center font-black text-zinc-300 text-xs">{c.code ?? '-'}</td>
                                  <td className="px-4 py-2 text-zinc-300 text-xs">↳ {c.name}</td>
                                  <td className="px-2 py-2 text-center text-zinc-300 text-xs">{c.qty}</td>
                                  <td className="px-4 py-2 text-center text-zinc-500 text-xs">—</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          ))}
                          <tr className="border-t-2 border-[#FFD700]/40 bg-white/[0.05]">
                            <td className="px-4 py-2.5" />
                            <td className="px-4 py-2.5" />
                            <td className="px-4 py-2.5 font-black text-white">الإجمالي</td>
                            <td className="px-2 py-2.5 text-center font-black text-white">{itemsData.itemsTotals?.qty || 0}</td>
                            <td className="px-4 py-2.5 text-center font-black text-[#FFD700]">{money(itemsData.itemsTotals?.total)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <div className="space-y-1.5 text-sm">
                  <p className="text-zinc-200">إجمالي مبيعات الأصناف: <strong className="text-white">{money(itemsData.itemsTotals?.total)}</strong></p>
                  <p className="text-zinc-200">الخصومات: <strong className="text-white">{money(itemsData.totals?.discounts)}</strong></p>
                  <p className="text-zinc-200">صافي المبيعات بعد الخصم: <strong className="text-[#FFD700]">{money(itemsNet)}</strong></p>
                  <p className="text-xs text-zinc-400">{(itemsData.items || []).length} صنف · {itemsData.totals?.count || 0} أوردر في الفترة · القناة: {acctTypeLabel(itemsData.type)} · النطاق: {scopeName}</p>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'channels' && (
          <div className={card + ' space-y-4'}>
            <div>
              <h4 className="font-black text-lg text-white">🛵 تقرير قنوات البيع</h4>
              <p className="text-xs text-zinc-400 mt-1 leading-5">كل قناة لوحدها: استلام من الفرع، وتوصيل، وطلبات — بعدد الأوردرات والمبيعات وطريقة الدفع.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={sumBusy} onClick={() => loadSummary(period.from, period.to)} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">{sumBusy ? '... جاري التحميل' : '🔄 عرض'}</button>
              <button type="button" disabled={!sumData} onClick={downloadChannelsXlsx} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">⬇ تنزيل Excel</button>
            </div>
            {sumMsg && <p className="text-red-400 text-sm font-bold">{sumMsg}</p>}
            {sumData && (
              <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead>
                      <tr className="text-zinc-400 text-xs border-b border-white/10">
                        <th className="text-right font-bold px-4 py-2.5">القناة</th>
                        <th className="text-center font-bold px-2 py-2.5">عدد الأوردرات</th>
                        <th className="text-center font-bold px-2 py-2.5">إجمالي المبيعات</th>
                        <th className="text-center font-bold px-2 py-2.5">كاش</th>
                        <th className="text-center font-bold px-2 py-2.5">فيزا</th>
                        <th className="text-center font-bold px-2 py-2.5">انستا باي</th>
                        <th className="text-center font-bold px-2 py-2.5">محفظة</th>
                        <th className="text-center font-bold px-2 py-2.5">رسوم توصيل</th>
                        <th className="text-center font-bold px-2 py-2.5">خصومات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sumData.channels || []).map((c, i) => (
                        <tr key={c.key} className={i % 2 === 1 ? 'bg-white/[0.03]' : ''}>
                          <td className="px-4 py-2.5 font-black text-white">{c.label}</td>
                          <td className="px-2 py-2.5 text-center text-white">{c.count}</td>
                          <td className="px-2 py-2.5 text-center font-black text-white">{money(c.total)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.payments?.cash)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.payments?.visa)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.payments?.instapay)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.payments?.wallet)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.delivery)}</td>
                          <td className="px-2 py-2.5 text-center text-white">{money(c.discounts)}</td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-[#FFD700]/40 bg-white/[0.05]">
                        <td className="px-4 py-2.5 font-black text-white">الإجمالي</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{sumData.totals?.count || 0}</td>
                        <td className="px-2 py-2.5 text-center font-black text-[#FFD700]">{money(sumData.totals?.total)}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money(sumData.totals?.payments?.cash)}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money((sumData.totals?.payments?.visa || 0) + (sumData.totals?.talabatVisa || 0))}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money(sumData.totals?.payments?.instapay)}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money(sumData.totals?.payments?.wallet)}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money(sumData.totals?.delivery)}</td>
                        <td className="px-2 py-2.5 text-center font-black text-white">{money(sumData.totals?.discounts)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {sumData && <p className="text-xs text-zinc-400">طلبات من ضمن المبيعات: {money(sumData.totals?.talabat)} (كاش طلبات {money(sumData.totals?.talabatCash)} · فيزا طلبات {money(sumData.totals?.talabatVisa)}). عمود الفيزا في جدول القنوات بيجمع فيزا طلبات مع باقي الفيزا عشان كل قناة تجمّع إجماليها.</p>}
          </div>
        )}

        {tab === 'catalog' && (
          <div className={card + ' space-y-4'}>
            <div>
              <h4 className="font-black text-lg text-white">📋 الأصناف والأكواد</h4>
              <p className="text-xs text-zinc-400 mt-1 leading-5">دليل كل الأصناف المسجلة — كل صنف جنبه رمزه — حتى اللي متباعش. نزّله Excel عشان يفضل معاك مرجع.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" disabled={catBusy} onClick={loadCatalog} className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">{catBusy ? '... جاري التحميل' : '🔄 عرض'}</button>
              <button type="button" disabled={!catData} onClick={downloadCatalogXlsx} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl font-black text-sm">⬇ تنزيل Excel</button>
            </div>
            {catMsg && <p className="text-red-400 text-sm font-bold">{catMsg}</p>}
            {catData && (
              <>
                <p className="text-sm text-zinc-300">{(catData.items || []).length} صنف مسجل</p>
                {(catData.items || []).length === 0 ? (
                  <p className="text-sm text-zinc-400">مفيش أصناف مسجلة.</p>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[680px]">
                        <thead>
                          <tr className="bg-[#FFFF00] text-black text-xs">
                            <th className="text-right font-black px-4 py-2.5">المطعم</th>
                            <th className="text-center font-black px-4 py-2.5">الرمز</th>
                            <th className="text-right font-black px-4 py-2.5">اسم الصنف</th>
                            <th className="text-right font-black px-4 py-2.5">التصنيف</th>
                            <th className="text-center font-black px-4 py-2.5">السعر (ج)</th>
                            <th className="text-center font-black px-4 py-2.5">الحالة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(catData.items || []).map((it, i) => (
                            <tr key={`${it.restaurant}-${it.code ?? it.name}`} className={i % 2 === 1 ? 'bg-white/[0.03]' : ''}>
                              <td className="px-4 py-2.5 font-black text-white">{it.restaurant || '-'}</td>
                              <td className="px-4 py-2.5 text-center font-black text-white">{it.code ?? '-'}</td>
                              <td className="px-4 py-2.5 text-white">{it.name}</td>
                              <td className="px-4 py-2.5 text-zinc-300">{it.category || '-'}</td>
                              <td className="px-4 py-2.5 text-center font-black text-white">{money(it.price)}</td>
                              <td className="px-4 py-2.5 text-center text-white">{it.available ? 'متاح' : 'موقوف'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                <p className="text-sm text-zinc-300 mt-6">📦 محتويات البوكسات وأكوادها — {(catData.boxContents || []).length} محتوى</p>
                {(catData.boxContents || []).length === 0 ? (
                  <p className="text-sm text-zinc-400">مفيش محتويات بوكسات مسجلة.</p>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[560px]">
                        <thead>
                          <tr className="bg-[#FFFF00] text-black text-xs">
                            <th className="text-right font-black px-4 py-2.5">المطعم</th>
                            <th className="text-center font-black px-4 py-2.5">الرمز</th>
                            <th className="text-right font-black px-4 py-2.5">البوكس</th>
                            <th className="text-right font-black px-4 py-2.5">اسم المحتوى</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(catData.boxContents || []).map((c, i) => (
                            <tr key={`${c.restaurant}-${c.box ?? ''}-${c.code ?? c.name}`} className={i % 2 === 1 ? 'bg-white/[0.03]' : ''}>
                              <td className="px-4 py-2.5 font-black text-white">{c.restaurant || '-'}</td>
                              <td className="px-4 py-2.5 text-center font-black text-white">{c.code ?? '-'}</td>
                              <td className="px-4 py-2.5 text-white">{c.boxName ? `${c.boxName}${c.box != null ? ` (${c.box})` : ''}` : '-'}</td>
                              <td className="px-4 py-2.5 text-white">{c.name}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const AccountantPage = () => {
  const [session, setSession] = useState(readAccountant);
  const handleLogout = () => { clearAccountant(); setSession(null); };
  if (!session?.own) return <AccountantLogin onLogin={(data) => { saveAccountant(data); setSession(data); }} />;
  return <AccountantReports session={session} onSessionChange={(next) => { saveAccountant(next); setSession(next); }} onLogout={handleLogout} />;
};


// ================= تبويب الوردية والتقفيل =================
const ShiftPanel = ({ authFetch, isAdmin, shiftData, refreshShift, closedShifts, refreshClosed, requestPrint, activeCount }) => {
  const shift = shiftData?.shift;
  const rep = shiftData?.report;

  const [mv, setMv] = useState({ type: 'out', kind: 'expense', amount: '', reason: '', recipient: '' });
  const [closeOpen, setCloseOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [counted, setCounted] = useState('');
  const [busy, setBusy] = useState(false);

  const defRange = () => {
    const n = new Date(); const f = new Date(n); f.setHours(6, 0, 0, 0);
    if (n < f) f.setDate(f.getDate() - 1);
    return [toLocalInput(f), toLocalInput(new Date(f.getTime() + 24 * 3600 * 1000))];
  };
  const [rangeFrom, setRangeFrom] = useState(() => defRange()[0]);
  const [rangeTo, setRangeTo] = useState(() => defRange()[1]);
  const [rangeRep, setRangeRep] = useState(null);
  const [rangeBusy, setRangeBusy] = useState(false);

  const inp = 'w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm';
  const card = 'bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5';
  const pays = rep?.payments || {};
  const num = (v) => Number(v) || 0;

  const addMovement = async () => {
    if (busy) return;
    const amount = Number(mv.amount);
    const isAdvance = mv.type === 'out' && mv.kind === 'advance';
    const recipient = (mv.recipient || '').trim();
    if (!(amount > 0)) return alert('اكتب مبلغ صحيح');
    if (isAdvance && recipient.length < 2) return alert('اكتب اسم اللي خد السلفة');
    const note = mv.reason.trim();
    if (!isAdvance && note.length < 2) return alert('اكتب السبب');
    // السبب بيتكتب فيه اسم اللي خد السلفة عشان يظهر في كل التقارير القديمة والجديدة
    const reason = isAdvance ? (note ? `سلفة ${recipient} — ${note}` : `سلفة: ${recipient}`) : note;
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/movement', { method: 'POST', body: JSON.stringify({ type: mv.type, amount, reason, category: isAdvance ? 'advance' : 'cash_movement', recipient: isAdvance ? recipient : '' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || 'حصل خطأ'); else { setMv({ type: mv.type, kind: mv.kind, amount: '', reason: '', recipient: '' }); await refreshShift(); }
    } catch (e) {}
    setBusy(false);
  };

  // طباعة ملخص المبيعات من غير تقفيل — متاحة للكاشير والأدمن
  const printNet = () => {
    if (!rep) return;
    requestPrint(makePrint(`تقرير ${shiftNameOf(rep.from)} (لحظي)`, rep, { expectedCash: rep.expectedCash }), 'report');
  };

  const doClose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/close', { method: 'POST', body: JSON.stringify({ notes: notes.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error || 'حصل خطأ أثناء تقفيل الوردية');
      } else {
        const closedReport = d.report || d.reportSnapshot || rep || {};
        const netSales = Number(closedReport.grossSales ?? closedReport.total ?? d.total ?? 0);
        const closedMeta = { closedBy: d.closedBy || '', closedAt: d.closedAt || new Date().toISOString(), expectedCash: d.expectedCash ?? closedReport.expectedCash, notes: d.notes };
        // لو اليوم فيه شيفتين (الصبح والليل) بنضيف ملخص اليوم في آخر ورقة التقفيل
        try {
          const rr = await authFetch('/api/reports/day');
          const dd = await rr.json().catch(() => ({}));
          if (rr.ok && (dd.shifts || []).length >= 2) {
            const cs = dayCashSummary(dd);
            closedMeta.day = { orders: dd.totals?.count || 0, sales: dd.totals?.total || 0, net: cs.net, last: cs.last };
          }
        } catch (e) {}
        // ورقتين: تقفيل الشيفت (مختصر) ثم تقرير المطبخ (الأصناف والكميات بالتفصيل)
        requestPrint(makePrint(`تقفيل ${shiftNameOf(closedReport.from)}`.trim(), closedReport, closedMeta), 'report');
        requestPrint(makePrint(`جرد ${shiftNameOf(closedReport.from)}`.trim() || 'تقرير المطبخ - جرد الوردية', closedReport, closedMeta), 'kitchen-summary');
        setCloseOpen(false);
        alert(`تم تقفيل الوردية\nإجمالي المبيعات: ${money(netSales)}`);
        setNotes(''); setCounted('');
        await refreshShift(); await refreshClosed();
      }
    } catch (e) {
      alert('تعذر الاتصال بالسيرفر. جرّب مرة تانية.');
    }
    setBusy(false);
  };

  const loadRange = async () => {
    setRangeBusy(true); setRangeRep(null);
    try {
      const q = `from=${encodeURIComponent(new Date(rangeFrom).toISOString())}&to=${encodeURIComponent(new Date(rangeTo).toISOString())}`;
      const r = await authFetch(`/api/reports/range?${q}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || 'حصل خطأ'); else setRangeRep(d);
    } catch (e) {}
    setRangeBusy(false);
  };

  const kpi = (label, value, extra = '') => (
    <div className={`bg-[#1C0D10] border border-[#3A1218] rounded-xl px-4 py-3 ${extra}`}>
      <p className="text-xs text-zinc-400 font-bold">{label}</p>
      <p className="text-xl font-black text-[#FFD700] mt-1">{value}</p>
    </div>
  );

  const payRow = (label, value, sub = false) => (
    <div className={`flex justify-between items-center py-2 border-b border-[#3A1218] last:border-0 ${sub ? 'pr-4 text-xs text-zinc-400' : 'text-sm'}`}>
      <span className={sub ? '' : 'text-zinc-200 font-bold'}>{label}</span>
      <span className={sub ? '' : 'font-black text-white'}>{money(value)}</span>
    </div>
  );

  const expected = num(rep?.expectedCash);
  const talabatCash = num(rep?.talabatCash);
  const talabatVisa = num(rep?.talabatVisa);

  return (
    <div className="space-y-5">
      {!shift ? (
        <div className="max-w-md mx-auto bg-[#1C0D10] border border-[#800020]/50 rounded-2xl p-6 space-y-4">
          <h3 className="text-xl font-black text-[#FFD700] text-center">🕒 مفيش وردية مفتوحة</h3>
          <p className="text-zinc-400 text-sm text-center">افتح وردية عشان تقدر تبيع من الكاشير ويتحسب الدرج والتقارير.</p>
          <OpenShiftForm authFetch={authFetch} onDone={async () => { await refreshShift(); await refreshClosed(); }} pendingHandover={shiftData?.pendingHandover || null} />
        </div>
      ) : (
        <>
          {/* الشريط العلوي: حالة الوردية + الأزرار */}
          <div className="bg-[#1C0D10] border border-green-600/50 rounded-2xl p-4 md:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-black text-green-400 text-lg">🟢 وردية مفتوحة</p>
                <p className="text-zinc-300 text-sm mt-1">فتحها <strong className="text-white">{shift.openedBy}</strong> · {fmtDT(shift.openedAt)}{` · افتتاح ${money(shift.openingCash)}`}</p>
              </div>
              <button type="button" onClick={refreshShift} className="bg-zinc-700 text-white px-4 py-2 rounded-xl text-sm font-bold">🔄 تحديث</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={printNet} disabled={!rep} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl font-black text-sm">🖨️ اطبع ملخص المبيعات<span className="block text-[11px] font-bold text-blue-100">من غير ما تقفل الوردية</span></button>
              <button type="button" onClick={() => { if ((rep?.awaitingOrders || []).length > 0) return alert(`مينفعش تقفل الوردية: فيه ${rep.awaitingOrders.length} أوردر دليفري مع السواق ومستني النقدية. استلم الفلوس من السواق الأول من الأوردرات النشطة.`); setCloseOpen(true); }} className="bg-red-600 hover:bg-red-700 text-white py-3 rounded-xl font-black text-sm">🔒 تقفيل الوردية<span className="block text-[11px] font-bold text-red-100">وطباعة تقرير الوردية</span></button>
            </div>
          </div>

          {rep && (
            <>
              {/* الرقم الأهم: إجمالي المبيعات (بعد الخصم) */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 bg-[#1C0D10] border border-[#FFD700]/40 rounded-2xl p-5">
                  <p className="text-sm text-zinc-400 font-bold">إجمالي المبيعات (بعد الخصم)</p>
                  <p className="text-4xl font-black text-[#FFD700] mt-1">{money(rep.grossSales ?? rep.total)}</p>
                  <p className="text-[11px] text-zinc-500 mt-1">كل اللي اتباع بأي طريقة دفع (بعد الخصم، من غير أجرة التوصيل ومن غير الملغي). المصروفات بتتخصم من كاش الدرج مش من المبيعات</p>
                </div>
                <div className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5 flex flex-col justify-center text-center">
                  <p className="text-sm text-zinc-400 font-bold">الأوردرات</p>
                  <p className="text-4xl font-black text-white mt-1">{rep.count}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-xs font-bold">
                <span className="bg-[#1C0D10] border border-[#3A1218] rounded-full px-3 py-1.5 text-zinc-300">🛵 أجرة توصيل (مش في المبيعات): <span className="text-white">{money(rep.delivery)}</span></span>
                <span className="bg-[#1C0D10] border border-[#3A1218] rounded-full px-3 py-1.5 text-zinc-300">🏷️ خصومات: <span className="text-orange-300">{money(rep.discounts)}</span></span>
                <span className="bg-[#1C0D10] border border-[#3A1218] rounded-full px-3 py-1.5 text-zinc-300">✖ ملغي ({rep.cancelled}): <span className="text-red-300">{money(rep.cancelledTotal)}</span></span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* المبيعات حسب طريقة الدفع */}
                <div className={card}>
                  <h4 className="font-black text-[#FFD700] text-lg mb-2">💳 المبيعات حسب الدفع</h4>
                  {payRow('💵 كاش', pays.cash || 0)}
                  {talabatCash > 0 && payRow('منه طلبات كاش', talabatCash, true)}
                  {payRow('💳 فيزا', pays.visa || 0)}
                  {payRow('📱 انستا باي', pays.instapay || 0)}
                  {payRow('👛 محفظة', pays.wallet || 0)}
                  {payRow('🛍️ طلبات فيزا (مستحق من طلبات)', talabatVisa)}
                </div>

                {/* الدرج */}
                <div className={card + ' space-y-3'}>
                  <h4 className="font-black text-[#FFD700] text-lg">💰 الدرج</h4>
                  {rep.openingCash !== undefined ? (
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between"><span className="text-zinc-400">رصيد الافتتاح</span><span className="font-bold text-white">{money(rep.openingCash)}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-400">+ كاش المبيعات</span><span className="font-bold text-white">{money(pays.cash || 0)}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-400">+ إيداعات</span><span className="font-bold text-green-400">{money(rep.cashIn)}</span></div>
                      <div className="flex justify-between"><span className="text-zinc-400">- مصروفات وسحب</span><span className="font-bold text-red-400">{money(rep.cashOut)}</span></div>
                      {num(rep.driverCash) > 0 && <div className="flex justify-between"><span className="text-zinc-400">- كاش مع السواقين</span><span className="font-bold text-orange-300">{money(rep.driverCash)}</span></div>}
                      <div className="flex justify-between border-t border-[#3A1218] pt-2 text-base"><span className="font-black text-white">المتوقع في الدرج</span><span className="font-black text-[#FFD700]">{money(rep.expectedCash)}</span></div>
                    </div>
                  ) : <p className="text-xs text-zinc-500">أي مصروف أو إيداع من الدرج سجّله هنا عشان الحساب يتظبط وقت التقفيل.</p>}

                  <div className={`${'border-t border-[#3A1218] pt-3'} space-y-2`}>
                    <p className="text-xs font-bold text-zinc-400">تسجيل مصروف أو إيداع</p>
                    <div className="flex flex-wrap gap-1.5 items-center"><span className="text-[11px] text-zinc-500">مصروف سريع:</span>{['أجرة سواق', 'ثلج', 'غاز', 'خضار', 'بقشيش', 'صيانة', 'مواصلات', 'أخرى'].map(x => <button key={x} type="button" onClick={() => setMv({ ...mv, type: 'out', kind: 'expense', reason: x })} className="px-2.5 py-1 rounded-lg text-[11px] font-black border border-red-500/40 text-red-300">{x}</button>)}</div>

                    <div className="flex gap-2">
                      <button type="button" onClick={() => setMv({ ...mv, type: 'out' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.type === 'out' ? 'bg-red-600 text-white border-red-400' : 'bg-[#12080A] text-zinc-400 border-[#3A1218]'}`}>➖ مصروف / سحب</button>
                      <button type="button" onClick={() => setMv({ ...mv, type: 'in' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.type === 'in' ? 'bg-green-600 text-white border-green-400' : 'bg-[#12080A] text-zinc-400 border-[#3A1218]'}`}>➕ إيداع</button>
                    </div>
                    {mv.type === 'out' && (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setMv({ ...mv, kind: 'expense' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.kind === 'advance' ? 'bg-zinc-800 text-zinc-300 border-zinc-600' : 'bg-red-600 text-white border-red-400'}`}>💸 مصروف عادي</button>
                        <button type="button" onClick={() => setMv({ ...mv, kind: 'advance' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.kind === 'advance' ? 'bg-amber-600 text-white border-amber-400' : 'bg-zinc-800 text-zinc-300 border-zinc-600'}`}>💰 سلفة لشخص</button>
                      </div>
                    )}
                    {mv.type === 'out' && mv.kind === 'advance' && (
                      <input value={mv.recipient} onChange={(e) => setMv({ ...mv, recipient: e.target.value })} placeholder="اسم اللي خد السلفة (مثال: أحمد)" className={inp} />
                    )}
                    <div className="flex gap-2">
                      <input type="number" min="0" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} placeholder="المبلغ" className={inp + ' !w-24'} dir="ltr" />
                      <input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addMovement(); }} placeholder={mv.type === 'out' && mv.kind === 'advance' ? 'ملاحظة اختيارية عن السلفة' : 'السبب (ثلج، غاز، بقشيش...)'} className={inp} />
                      <button type="button" disabled={busy} onClick={addMovement} className="bg-[#800020] text-white px-4 rounded-lg text-sm font-black shrink-0">حفظ</button>
                    </div>
                    <p className="text-[11px] text-orange-400 font-bold">المصروف بيطلع من كاش الدرج بس. لو الدرج مفيهوش كاش كفاية هيترفض. لو الفلوس موجودة فعلاً من برا الدرج سجّلها كإيداع الأول وبعدها سجّل المصروف.</p>
                  </div>

                  {(rep.movements || []).length > 0 && (
                    <div className="border-t border-[#3A1218] pt-3 space-y-1.5 max-h-40 overflow-y-auto">
                      {rep.movements.map((m, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-zinc-300">{m.type === 'in' ? '➕' : (m.category === 'advance' ? '💰' : '➖')} {m.reason} <span className="text-zinc-500">({m.by} · {new Date(m.at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })})</span></span>
                          <span className={`font-black ${m.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>{money(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {(rep.expenses || []).length > 0 && (
                <div className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5 space-y-2">
                  <h4 className="font-black text-[#FFD700] text-lg">💸 مصروفات الوردية — {money(rep.expensesTotal)}</h4>
                  {rep.expenses.map((e, i) => (
                    <div key={i} className="flex justify-between text-sm py-1 border-b border-[#3A1218] last:border-0"><span className="text-zinc-300">{e.reason} <span className="text-zinc-500 text-xs">({e.by} · {new Date(e.at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })})</span></span><span className="font-black text-red-400">- {money(e.amount)}</span></div>
                  ))}
                  <p className="text-[11px] text-zinc-500">بتتخصم من كاش الدرج مش من المبيعات.</p>
                </div>
              )}
              {(rep.awaitingOrders || []).length > 0 && (
                <div className="bg-orange-500/10 border border-orange-500/40 rounded-2xl p-5 space-y-2">
                  <h4 className="font-black text-orange-300 text-lg">🛵 أوردرات مع السواقين — مستنية النقدية ({rep.awaitingOrders.length})</h4>
                  <p className="text-[11px] text-zinc-300 leading-5">دي مش محسوبة في المبيعات ولا في الدرج لحد ما تدوس "استلمت النقدية من السواق" من تبويب الأوردرات النشطة. مينفعش تقفل الوردية وهي موجودة.</p>
                  {rep.awaitingOrders.map((o) => (
                    <div key={o.id} className="flex justify-between text-sm py-1 border-b border-orange-500/20 last:border-0"><span className="text-white font-bold">#{o.no || o.id} · {o.driverName || 'سواق'}</span><span className="font-black text-orange-300">{money(o.amount)}</span></div>
                  ))}
                  <div className="flex justify-between text-sm pt-1"><span className="text-zinc-300 font-bold">المفروض يرجعلك</span><span className="font-black text-[#FFD700]">{money(rep.awaitingTotal)}</span></div>
                </div>
              )}

              {/* تفاصيل إضافية (مطوية عشان الصفحة تفضل بسيطة) */}
              <details className={card}>
                <summary className="cursor-pointer font-black text-[#FFD700] text-base">📊 تفاصيل أكتر (حسب الكاشير ونوع الأوردر)</summary>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-4">
                  <div>
                    <h5 className="font-black text-white text-sm mb-2">👥 حسب الكاشير</h5>
                    {Object.keys(rep.byCashier || {}).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش أوردرات.</p> : Object.entries(rep.byCashier).map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center gap-3 text-sm py-1.5 border-b border-[#3A1218] last:border-0"><span className="text-white font-bold">{k} <span className="text-zinc-500 font-normal">({v.count})</span></span><span className="text-[#FFD700] font-black">{money(v.total)}</span></div>
                    ))}
                  </div>
                  <div>
                    <h5 className="font-black text-white text-sm mb-2">📦 حسب نوع الأوردر</h5>
                    {Object.keys(rep.byType || {}).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش أوردرات.</p> : Object.entries(rep.byType).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-1.5 border-b border-[#3A1218] last:border-0"><span className="text-white font-bold">{TYPE_LABELS[k] || k} <span className="text-zinc-500 font-normal">({v.count})</span></span><span className="text-[#FFD700] font-black">{money(v.total)}</span></div>
                    ))}
                  </div>
                </div>
              </details>

              <details className={card}>
                <summary className="cursor-pointer font-black text-[#FFD700] text-base">📦 جرد الأصناف المباعة في الوردية</summary>
                <p className="text-zinc-500 text-xs my-3">كل قسم اتباع منه كام قطعة — للمطابقة مع المخزون.</p>
                {(rep.categories || []).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش مبيعات.</p> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rep.categories.map((c, i) => (
                      <div key={i} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3">
                        <div className="flex justify-between items-center font-black text-white text-sm"><span>{c.name}</span><span className="text-[#FFD700]">{c.qty} قطعة · {money(c.total)}</span></div>
                        <div className="mt-2 space-y-1">
                          {(c.items || []).map((it, j) => <div key={j} className="flex justify-between text-xs text-zinc-300"><span>{it.name}</span><span className="font-black text-white">× {it.qty}</span></div>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            </>
          )}
        </>
      )}

      {isAdmin && <DayDashboardCard authFetch={authFetch} card={card} inp={inp} />}
      <DayReportCard authFetch={authFetch} isAdmin={isAdmin} requestPrint={requestPrint} card={card} inp={inp} />

      {/* سجل الورديات (الأدمن فقط) */}
      {isAdmin && (
      <div className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5">
        <h4 className="font-black text-[#FFD700] text-lg mb-3">📜 سجل الورديات المقفولة</h4>
        {(closedShifts || []).length === 0 ? <p className="text-zinc-500 text-sm">مفيش ورديات مقفولة لسه.</p> : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {closedShifts.map(c => {
              return (
                <div key={c._id} className="flex flex-wrap items-center justify-between gap-2 bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-zinc-300">{fmtDT(c.openedAt || c.from)} ← {fmtDT(c.closedAt)} · {c.closedBy}</span>
                  <span className="text-zinc-400">{c.count} أوردر</span>
                  <span className="text-[#FFD700] font-black">{money(c.report?.grossSales ?? c.total)}</span>
                  <button type="button" onClick={() => requestPrint(printForClosed(c), 'report')} className="bg-zinc-700 text-white px-3 py-1 rounded-lg text-xs font-bold">🖨️ طباعة</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      )}

      {/* تقرير فترة (أدمن) */}
      {isAdmin && (
        <div className="bg-[#1C0D10] border border-[#800020]/40 rounded-2xl p-5 space-y-4">
          <h4 className="font-black text-[#FFD700] text-lg">📊 تقرير فترة / يوم كامل (للأدمن)</h4>
          <div className="flex flex-wrap gap-3 items-end">
            <div><label className="block text-xs text-zinc-400 mb-1">من</label><input type="datetime-local" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">إلى</label><input type="datetime-local" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={inp} /></div>
            <button type="button" disabled={rangeBusy} onClick={loadRange} className="bg-[#800020] text-white px-5 py-2.5 rounded-xl font-black text-sm">{rangeBusy ? '...' : '📈 عرض التقرير'}</button>
            {rangeRep && <button type="button" onClick={() => requestPrint(makePrint('تقرير فترة', rangeRep, { showItems: true, full: true }), 'report')} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm">🖨️ طباعة</button>}
          </div>
          {rangeRep && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpi('عدد الأوردرات', rangeRep.count)}
                {kpi('إجمالي المبيعات', money(rangeRep.grossSales ?? rangeRep.total))}{kpi('💸 مصروفات (من الدرج)', money(rangeRep.expensesTotal))}
                {kpi('💵 كاش', money(rangeRep.payments?.cash || 0))}
                {kpi('💳 فيزا', money(rangeRep.payments?.visa || 0))}
                {kpi('📱 انستا باي', money(rangeRep.payments?.instapay || 0))}
                {kpi('👛 محفظة', money(rangeRep.payments?.wallet || 0))}
                {kpi('🛍️ طلبات', money(rangeRep.talabat))}
                {kpi('🏷️ خصومات', money(rangeRep.discounts))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(rangeRep.categories || []).map((c, i) => (
                  <details key={i} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3">
                    <summary className="cursor-pointer flex justify-between font-black text-white text-sm"><span>{c.name}</span><span className="text-[#FFD700]">{c.qty} قطعة · {money(c.total)}</span></summary>
                    <div className="mt-2 space-y-1">{(c.items || []).map((it, j) => <div key={j} className="flex justify-between text-xs text-zinc-300"><span>{it.name}</span><span className="font-black text-white">× {it.qty}</span></div>)}</div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && <PeriodReportPanel authFetch={authFetch} card={card} inp={inp} />}

      {/* نافذة التقفيل */}
      {closeOpen && shift && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => !busy && setCloseOpen(false)}>
          <div dir="rtl" className="bg-[#1C0D10] border border-red-500/60 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-red-400">🔒 تقفيل الوردية</h3>
            <div className="bg-[#12080A] border border-[#3A1218] rounded-xl p-4 text-center space-y-1">
              <div className="text-sm text-zinc-400">إجمالي المبيعات (بعد الخصم)</div>
              <div className="text-3xl font-black text-[#FFD700]">{money(rep?.grossSales ?? rep?.total ?? 0)}</div>
              <div className="text-xs text-zinc-400">{rep?.count || 0} أوردر{Number(rep?.discounts) > 0 ? ` · خصومات ${money(rep.discounts)}` : ''}</div>
            </div>
            {<div className="text-xs bg-[#12080A] border border-[#3A1218] rounded-lg p-2 text-zinc-400">المتوقع في الدرج: <b className="text-white">{money(expected)}</b></div>}
            <div className="space-y-2">
              <label className="block text-sm font-black text-white">ملاحظة (اختياري)</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اكتب هنا لو في حاجة" className={inp} />
            </div>
            <p className="text-[11px] text-zinc-500 text-center">هتطلع ورقتين: تقرير التقفيل وتقرير المطبخ.</p>
            <div className="flex gap-3">
              <button type="button" disabled={busy} onClick={doClose} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-black py-3 rounded-xl">{busy ? 'جاري التقفيل...' : 'تقفيل الوردية'}</button>
              <button type="button" disabled={busy} onClick={() => setCloseOpen(false)} className="px-5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ================= شاشة البيع (POS) داخل الكاشير =================
const POS_PAYS = [['cash', '💵 كاش'], ['visa', '💳 فيزا'], ['instapay', '📱 انستا باي'], ['wallet', '👛 محفظة']];
const cashPartOf = (o) => {
  if (Array.isArray(o?.paymentSplit) && o.paymentSplit.length) return o.paymentSplit.filter(p => p.method === 'cash').reduce((a, p) => a + (Number(p.amount) || 0), 0);
  return o?.paymentMethod === 'cash' ? (Number(o.grandTotal) || 0) : 0;
};
// تطبيع رقم التليفون: +20 أو 0020 اللي اتلصقوا بيتشالوا قبل ما نقصّ لـ 11 رقم
const normalizePhoneInput = (v) => {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0020')) d = d.slice(4);
  else if (d.startsWith('20') && d.length > 11) d = d.slice(2);
  return d.slice(0, 11);
};
const payText = (o) => (Array.isArray(o?.paymentSplit) && o.paymentSplit.length)
  ? o.paymentSplit.map(p => `${PAY_LABELS[p.method] || p.method} ${p.amount}`).join(' + ')
  : (PAY_LABELS[o?.paymentMethod] || o?.paymentMethod || '');
const splitLeft = (rows, total) => Math.round((Number(total) - rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)) * 100) / 100;
const splitError = (rows, total) => {
  if (rows.length < 2) return 'اختار طريقتين دفع على الأقل';
  const ms = rows.map(r => r.method);
  if (new Set(ms).size !== ms.length) return 'طريقة الدفع متكررة، اختار طرق مختلفة';
  if (rows.some(r => !(Number(r.amount) > 0))) return 'اكتب مبلغ لكل طريقة دفع';
  const left = splitLeft(rows, total);
  if (left !== 0) return left > 0 ? `لسه ناقص ${left} ج في التقسيم` : `التقسيم زيادة ${-left} ج عن الإجمالي`;
  return '';
};
// محرر تقسيم الدفع: المجموع لازم يساوي إجمالي الأوردر بالظبط
const SplitEditor = ({ total, rows, setRows }) => {
  const left = splitLeft(rows, total);
  const setRow = (i, patch) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setAmount = (i, v) => {
    const clean = v.replace(/[^\d.]/g, '');
    if (rows.length === 2) {
      const other = Math.max(0, Math.round((Number(total) - (Number(clean) || 0)) * 100) / 100);
      setRows(rows.map((r, j) => (j === i ? { ...r, amount: clean } : { ...r, amount: clean === '' ? '' : String(other) })));
    } else setRow(i, { amount: clean });
  };
  return (
    <div className="space-y-2 bg-[#050304] border border-green-500/40 rounded-xl p-2.5">
      <p className="text-[11px] text-zinc-400 font-bold">✂️ قسّم {total} ج على طرق الدفع (المجموع لازم يساوي الإجمالي)</p>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <select value={r.method} onChange={(e) => setRow(i, { method: e.target.value })} className="bg-[#100609] border border-[#1F0A0E] rounded-lg px-2 py-2 text-white text-xs">
            {POS_PAYS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input value={r.amount} onChange={(e) => setAmount(i, e.target.value)} inputMode="decimal" placeholder="المبلغ" className="flex-1 min-w-0 bg-[#100609] border border-[#1F0A0E] rounded-lg px-2 py-2 text-white text-sm" dir="ltr" />
          {rows.length > 2 && <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-red-400 px-2 font-black">✖</button>}
        </div>
      ))}
      {rows.length < 4 && <button type="button" onClick={() => setRows([...rows, { method: POS_PAYS.map(p => p[0]).find(k => !rows.some(r => r.method === k)) || 'wallet', amount: left > 0 ? String(left) : '' }])} className="text-xs text-green-300 font-bold">＋ طريقة دفع تالتة</button>}
      <div className={`text-xs font-black ${left === 0 && !splitError(rows, total) ? 'text-green-400' : 'text-red-400'}`}>{left === 0 ? (splitError(rows, total) || '✅ التقسيم مظبوط') : left > 0 ? `⚠️ المتبقي ${left} ج` : `⚠️ زيادة ${-left} ج`}</div>
    </div>
  );
};

const readPosPresets = () => {
  try {
    const a = JSON.parse(localStorage.getItem('nossKoftaPosDiscounts'));
    if (Array.isArray(a) && a.length) return a.map(Number).filter(n => n > 0 && n <= 100).slice(0, 8);
  } catch (e) {}
  return [10, 15, 20, 30];
};

const posBase = (item) => {
  const legacySized = !(item.modifierGroups || []).length && (item.sizes || []).length > 0;
  return legacySized ? 0 : (Number(item.price) > 0 ? Number(item.price) : 0);
};

const posGroupsOf = (item) => {
  let groups = [...(item.modifierGroups || [])];
  if (groups.length === 0 && (item.sizes?.length > 0 || item.addons?.length > 0)) {
    if (item.sizes?.length > 0) groups.push({ name: 'اختر الحجم', min: 1, max: 1, options: item.sizes });
    if (item.addons?.length > 0) groups.push({ name: 'الإضافات الاختيارية', min: 0, max: item.addons.length, options: item.addons });
  }
  return groups;
};

const PosScreen = ({ authFetch, isAdmin, onCreated, shiftOpen, onShiftOpened, editOrder, onEditFinished, onEditSaved }) => {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(null);
  const [search, setSearch] = useState('');
  const [boxModal, setBoxModal] = useState(null);
  const [boxPicks, setBoxPicks] = useState({});

  const [cart, setCart] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem('nossKoftaPosCart')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  });
  const [modal, setModal] = useState(null); // { item, groups }
  const [selMods, setSelMods] = useState({});
  const [modalNotes, setModalNotes] = useState('');
  const [modalQty, setModalQty] = useState(1);

  const [orderType, setOrderType] = useState('pickup'); // pickup | delivery | talabat
  const [pay, setPay] = useState('cash');
  const [splitRows, setSplitRows] = useState([{ method: 'cash', amount: '' }, { method: 'instapay', amount: '' }]);
  const [talabatNo, setTalabatNo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState('percent'); // percent | amount
  const switchDiscountType = (t) => { if (t === discountType) return; setDiscountType(t); setDiscount(0); };
  const [discountReason, setDiscountReason] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [showOrderNote, setShowOrderNote] = useState(false);
  const [noteKey, setNoteKey] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [presets, setPresets] = useState(readPosPresets);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [address, setAddress] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [manualFee, setManualFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const stashRef = useRef(null);
  const lookedRef = useRef('');
  // رقم منع تكرار ثابت لنفس الأوردر: لو الإرسال فشل والكاشير حاولت تاني، السيرفر بيرجّع نفس الأوردر بدل ما يكرره
  const clientRefRef = useRef({ sig: '', ref: '' });
  const getSubmitClientRef = (sig) => {
    if (clientRefRef.current.sig !== sig) clientRefRef.current = { sig, ref: `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` };
    return clientRefRef.current.ref;
  };
  const [custLookup, setCustLookup] = useState(null);
  const [resettingPin, setResettingPin] = useState(false);
  // مسح الرقم السري لعميل نسيه وكلّم المطعم — العميل يعمل رقم جديد مع أوردره الجاي
  const resetCustomerPin = async () => {
    const digits = normalizePhoneInput(custPhone);
    if (digits.length !== 11 || resettingPin) return;
    if (!window.confirm(`هتمسح الرقم السري للعميل${custLookup?.name ? ` (${custLookup.name})` : ''} رقم ${digits}؟\nالعميل هيعمل رقم سري جديد مع أوردره الجاي.`)) return;
    setResettingPin(true);
    try {
      const r = await authFetch(`/api/customers/${digits}/reset-pin`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { alert(d.error || 'حصل خطأ'); return; }
      alert('✅ تم مسح الرقم السري — العميل يقدر يعمل رقم جديد مع أوردره الجاي');
    } catch (e) {
      alert('تعذر الاتصال بالسيرفر');
    } finally {
      setResettingPin(false);
    }
  };

  // أول ما يتكتب رقم من 11 رقم: لو العميل موجود عندنا بنملّي الاسم والعنوان والمنطقة لوحدهم
  useEffect(() => {
    const digits = normalizePhoneInput(custPhone);
    if (digits.length !== 11) { lookedRef.current = ''; setCustLookup(null); return; }
    if (editOrder || lookedRef.current === digits) return;
    lookedRef.current = digits;
    (async () => {
      try {
        const r = await authFetch(`/api/pos/customers/${digits}`);
        const d = await r.json().catch(() => ({}));
        if (d && d.found) {
          setCustLookup(d);
          // بنملّي الفراغات بس: لو الكاشير كتبت اسم/عنوان بإيدها منمسحهمش
          if (d.name) setCustName(prev => prev.trim() ? prev : d.name);
          if (orderType === 'delivery') {
            if (d.address) setAddress(prev => prev.trim() ? prev : d.address);
            const z = zones.find(x => x.name === d.zoneName);
            if (z) setZoneId(prev => prev || z._id);
          }
        } else {
          setCustLookup({ found: false });
        }
      } catch (e) {}
    })();
  }, [custPhone]);

  const resetForm = () => {
    setDiscount(0); setDiscountType('percent'); setDiscountReason(''); setOrderNote(''); setShowOrderNote(false); setNoteKey(null); setTalabatNo(''); setCustName(''); setCustPhone(''); setAddress(''); setManualFee(''); setPay('cash'); setSplitRows([{ method: 'cash', amount: '' }, { method: 'instapay', amount: '' }]); setOrderType('pickup');
  };
  const cancelEdit = () => {
    setCart(stashRef.current || []); stashRef.current = null; resetForm();
    if (onEditFinished) onEditFinished();
  };
  // وضع تعديل أوردر: نحمّل الأوردر في السلة ونحتفظ بالسلة العادية لحد ما نخلّص
  useEffect(() => {
    if (!editOrder) return;
    stashRef.current = cart;
    setCart((editOrder.items || []).map((it, i) => ({
      key: `edit|${i}`, _id: it.itemId, name: it.name, unit: Number(it.price) || 0, qty: Number(it.quantity) || 1,
      modifiersInfo: it.modifiers || [], modifierSelections: undefined, notes: it.notes || '', keepIndex: i
    })));
    setOrderType(editOrder.orderType === 'delivery' ? 'delivery' : editOrder.orderType === 'talabat' ? 'talabat' : 'pickup');
    setPay(editOrder.paymentMethod || 'cash');
    if (editOrder.paymentMethod === 'split' && Array.isArray(editOrder.paymentSplit)) setSplitRows(editOrder.paymentSplit.map(p => ({ method: p.method, amount: String(p.amount) })));
    setTalabatNo(editOrder.talabatNo || '');
    setDiscountType(editOrder.discountType === 'amount' ? 'amount' : 'percent');
    setDiscount(editOrder.discountType === 'amount' ? (Number(editOrder.discountAmount) || 0) : (Number(editOrder.discountPercent) || 0));
    setDiscountReason(editOrder.discountReason || '');
    setOrderNote(editOrder.orderNote || '');
    setShowOrderNote(!!editOrder.orderNote);
  }, [editOrder && editOrder._id]);

  const load = async () => {
    try {
      const [ri, rc, rz] = await Promise.all([fetch(`${API_BASE}/api/items`), fetch(`${API_BASE}/api/categories`), fetch(`${API_BASE}/api/zones`)]);
      const di = await ri.json(); const dc = await rc.json(); const dz = await rz.json();
      if (Array.isArray(di)) setItems(di);
      if (Array.isArray(dc)) setCats(dc);
      if (Array.isArray(dz)) setZones(dz);
    } catch (e) {}
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);

  const posCartRepriced = useRef(false);

  useEffect(() => {
    if (!items.length || posCartRepriced.current) return;
    posCartRepriced.current = true;
    setCart((current) => current.map((line) => {
      if (line.keepIndex !== undefined) return line;
      const item = items.find((candidate) => String(candidate._id) === String(line._id));
      if (!item) return line;
      const groups = posGroupsOf(item);
      let unit = posBase(item);
      const info = [];
      for (const selection of (Array.isArray(line.modifierSelections) ? line.modifierSelections : [])) {
        const gi = Number(selection.groupIndex);
        if (!Number.isInteger(gi) || gi < 0 || gi >= groups.length) continue;
        for (const oi of (Array.isArray(selection.optionIndices) ? selection.optionIndices : [])) {
          const option = groups[gi]?.options?.[Number(oi)];
          if (!option) continue;
          const optionPrice = Number(option.price) || 0;
          unit += optionPrice;
          info.push(`${groups[gi].name}: ${option.name}${optionPrice > 0 ? ` (+${optionPrice} ج)` : ''}`);
        }
      }
      return { ...line, unit, modifiersInfo: info.length ? info : (line.modifiersInfo || []) };
    }));
  }, [items]);

  useEffect(() => {
    if (editOrder) return;
    try { localStorage.setItem('nossKoftaPosCart', JSON.stringify(cart)); } catch (e) {}
  }, [cart]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const sortedCats = [...cats].sort((a, b) => (a.order || 0) - (b.order || 0));
  const catName = activeCat ?? (sortedCats.find(c => items.some(i => i.category === c.name))?.name || sortedCats[0]?.name);
  const q = search.trim().toLowerCase();
  const shownItems = (q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.filter(i => i.category === catName))
    .sort((a, b) => (a.order || 0) - (b.order || 0));

  const countInCart = (id) => cart.filter(l => String(l._id) === String(id)).reduce((s, l) => s + l.qty, 0);

  const addLine = (item, modifiersInfo, notes, unit, qty, modifierSelections = []) => {
    const key = [item._id, modifiersInfo.join('¦'), notes || ''].join('|');
    setCart(prev => {
      const i = prev.findIndex(l => l.key === key);
      if (i !== -1) { const next = [...prev]; next[i] = { ...next[i], qty: next[i].qty + qty }; return next; }
      return [...prev, { key, _id: item._id, name: item.name, unit, qty, modifiersInfo, modifierSelections, notes: notes || '' }];
    });
  };

  const pickItem = (item) => {
    if (item.available === false) return;
    if (item.type === 'box' && (item.boxItems || []).length > 0) { setBoxModal(item); setBoxPicks({}); return; }
    const groups = posGroupsOf(item);
    if (groups.length > 0) {
      setModal({ item, groups }); setSelMods({}); setModalNotes(''); setModalQty(1);
    } else {
      addLine(item, [], '', (Number(item.price) || 0), 1, []);
    }
  };

  const toggleOpt = (gIndex, oIndex, max) => {
    const cur = selMods[gIndex] || [];
    if (max === 1) setSelMods({ ...selMods, [gIndex]: [oIndex] });
    else if (cur.includes(oIndex)) setSelMods({ ...selMods, [gIndex]: cur.filter(i => i !== oIndex) });
    else if (cur.length < max) setSelMods({ ...selMods, [gIndex]: [...cur, oIndex] });
  };

  const modalValid = modal ? modal.groups.every((g, gi) => { const c = (selMods[gi] || []).length; return c >= g.min && c <= g.max; }) : false;
  let modalUnit = 0;
  if (modal) {
    modalUnit += posBase(modal.item);
    modal.groups.forEach((g, gi) => (selMods[gi] || []).forEach(oi => { modalUnit += (Number(g.options[oi].price) || 0); }));
  }

  const confirmModal = () => {
    if (!modalValid) return;
    const info = [];
    modal.groups.forEach((g, gi) => (selMods[gi] || []).forEach(oi => {
      const opt = g.options[oi];
      const p = (Number(opt.price) || 0);
      info.push(`${g.name}: ${opt.name}${p > 0 ? ` (+${p} ج)` : ''}`);
    }));
    const modifierSelections = modal.groups.map((g, groupIndex) => ({
      groupIndex, optionIndices: [...(selMods[groupIndex] || [])]
    })).filter(selection => selection.optionIndices.length > 0);
    addLine(modal.item, info, modalNotes.trim(), modalUnit, modalQty, modifierSelections);
    setModal(null);
  };

  const changeQty = (key, d) => setCart(prev => prev.map(l => (l.key === key ? { ...l, qty: l.qty + d } : l)).filter(l => l.qty > 0));
  const removeLine = (key) => setCart(prev => prev.filter(l => l.key !== key));
  const startNote = (l) => { setNoteKey(l.key); setNoteText(l.notes || ''); };
  const saveNote = () => {
    const text = noteText.trim().slice(0, 200);
    setCart(prev => {
      const i = prev.findIndex(l => l.key === noteKey);
      if (i === -1) return prev;
      const cur = prev[i];
      const newKey = [cur._id, cur.modifiersInfo.join('¦'), text].join('|');
      const j = prev.findIndex((l, idx) => idx !== i && l.key === newKey);
      const next = [...prev];
      if (j !== -1) { next[j] = { ...next[j], qty: next[j].qty + cur.qty }; return next.filter((_, idx) => idx !== i); }
      next[i] = { ...cur, key: newKey, notes: text };
      return next;
    });
    setNoteKey(null); setNoteText('');
  };
  const clearCart = () => { if (cart.length === 0) return; if (window.confirm('تمسح كل الأصناف من السلة؟')) setCart([]); };

  const itemsTotal = cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const discountAmount = discountType === 'amount' ? Math.min(Math.max(0, Math.round(discount) || 0), itemsTotal) : Math.round(itemsTotal * discount / 100);
  const zone = zones.find(z => z._id === zoneId);
  const fee = editOrder ? (Number(editOrder.deliveryFee) || 0) : (orderType === 'delivery' ? (zone ? Number(zone.fee) || 0 : Number(manualFee) || 0) : 0);
  const total = itemsTotal - discountAmount + fee;

  const chooseType = (t) => {
    if (editOrder) return;
    setOrderType(t);
    if (t === 'talabat' && !['cash', 'visa'].includes(pay)) setPay('cash');
    if (t === 'delivery' || t === 'pickup') setSplitRows(rows => rows);
  };

  const editPresets = () => {
    const txt = window.prompt('اكتب نسب الخصم المحفوظة مفصولة بفاصلة (مثال: 10,20,30,50)', presets.join(','));
    if (txt === null) return;
    const list = txt.split(/[,،\s]+/).map(Number).filter(n => n > 0 && n <= 100).slice(0, 8);
    if (list.length === 0) return alert('اكتب رقم واحد على الأقل');
    setPresets(list);
    try { localStorage.setItem('nossKoftaPosDiscounts', JSON.stringify(list)); } catch (e) {}
  };

  const setCustomDiscount = (v) => {
    const n = Number(String(v).replace(/[^\d.]/g, '')) || 0;
    setDiscount(discountType === 'amount' ? Math.max(0, Math.min(Math.round(n), itemsTotal)) : Math.max(0, Math.min(100, n)));
  };

  const submitEdit = async () => {
    if (busy) return;
    if (cart.length === 0) return alert('الأوردر لازم يفضل فيه صنف. لو عايز تلغيه استخدم زرار الإلغاء');
    if (discount > 0 && discountReason.trim().length < 2) return alert('اكتب سبب الخصم');
    if (pay === 'split') { const se = splitError(splitRows, total); if (se) return alert(se); }
    setBusy(true);
    try {
      const payload = {
        ...(pay === 'split' ? { paymentSplit: splitRows.map(r => ({ method: r.method, amount: Number(r.amount) })) } : {}),
        paymentMethod: pay, orderNote: orderNote.trim(), discountType, discountPercent: discountType === 'percent' ? discount : 0, discountAmount: discountType === 'amount' ? discount : 0, discountReason: discountReason.trim(),
        items: cart.map(l => (l.keepIndex !== undefined
          ? { keepIndex: l.keepIndex, quantity: l.qty, notes: l.notes }
          : { itemId: l._id, name: l.name, quantity: l.qty, selections: Array.isArray(l.modifierSelections) ? l.modifierSelections : undefined, modifiers: l.modifiersInfo, notes: l.notes }))
      };
      const res = await authFetch(`/api/pos/orders/${editOrder._id || editOrder.orderId}`, { method: 'PUT', body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'التعديل ما اتحفظش');
      } else {
        const done = data.order;
        setCart(stashRef.current || []); stashRef.current = null; resetForm();
        setToast(data.changed === false ? 'مفيش تغيير يتحفظ' : `✅ اتعدّل أوردر #${done.shiftReceiptNo || done.orderId}`);
        if (onEditSaved) onEditSaved(done, data);
      }
    } catch (e) {
      if (e.message === 'unauthorized') alert('انتهت الجلسة، سجّل دخول تاني'); else alert('تعذر الوصول للسيرفر، اتأكد من النت وحاول تاني.');
    }
    setBusy(false);
  };

  const submit = async () => {
    if (editOrder) return submitEdit();
    if (busy) return;
    if (shiftOpen === false) return alert('افتح وردية الأول');
    if (cart.length === 0) return alert('السلة فاضية');
    if (orderType === 'talabat' && !talabatNo.trim()) return alert('اكتب رقم أوردر طلبات');
    const phoneDigits = normalizePhoneInput(custPhone);
    if (orderType === 'delivery' && !phoneDigits) return alert('اكتب رقم تليفون العميل الأول (إجباري في الدليفري)');
    if (phoneDigits && (phoneDigits.length < 8 || phoneDigits.length > 15)) return alert('رقم العميل غير صحيح. صححه أو امسحه (اختياري في الاستلام وطلبات)');
    if (orderType === 'delivery' && !address.trim()) return alert('اكتب عنوان التوصيل');
    if (pay === 'split') { const se = splitError(splitRows, total); if (se) return alert(se); }
    setBusy(true);
    try {
      const submitSig = JSON.stringify([cart.map(l => [l._id, l.qty, l.unit, l.modifiersInfo, l.notes]), orderType, pay, splitRows, discount, discountType, custPhone, fee, total]);
      const payload = {
        clientRef: getSubmitClientRef(submitSig),
        ...(pay === 'split' ? { paymentSplit: splitRows.map(r => ({ method: r.method, amount: Number(r.amount) })) } : {}),
        orderType, paymentMethod: pay, talabatNo: talabatNo.trim(), discountType, discountPercent: discountType === 'percent' ? discount : 0, discountAmount: discountType === 'amount' ? discount : 0,
        discountReason: discountReason.trim(), orderNote: orderNote.trim(),
        customerName: custName.trim(), customerPhone: custPhone.trim(), customerAddress: address.trim(),
        zoneName: zone ? zone.name : (orderType === 'delivery' ? 'توصيل' : ''), deliveryFee: fee,
        offlineSnapshot: { items: cart.map(l => ({ name: l.name, quantity: l.qty, price: l.unit, modifiers: l.modifiersInfo, notes: l.notes })), itemsTotal, discountAmount, deliveryFee: fee, grandTotal: total },
        items: cart.map(l => ({ itemId: l._id, name: l.name, quantity: l.qty, selections: Array.isArray(l.modifierSelections) ? l.modifierSelections : undefined, modifiers: l.modifiersInfo, notes: l.notes }))
      };
      const res = await authFetch('/api/pos/orders', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'حصل خطأ، الأوردر ما اتسجلش');
      } else {
        onCreated(data);
        setToast(`✅ أوردر #${data.orderId} اتبعت للمطبخ`);
        setCart([]); setDiscount(0); setDiscountType('percent'); setDiscountReason(''); setOrderNote(''); setShowOrderNote(false); setNoteKey(null); setTalabatNo(''); setCustName(''); setCustPhone(''); setAddress(''); setManualFee(''); setPay('cash'); setSplitRows([{ method: 'cash', amount: '' }, { method: 'instapay', amount: '' }]); setCustLookup(null); clientRefRef.current = { sig: '', ref: '' };
      }
    } catch (e) {
      if (e.message === 'unauthorized') alert('انتهت الجلسة، سجّل دخول تاني'); else alert('تعذر الوصول للسيرفر، اتأكد من النت وحاول تاني — لو الأوردر اتسجل قبل كده مش هيتكرر.');
    }
    setBusy(false);
  };

  const typeBtn = (key, label) => (
    <button type="button" onClick={() => chooseType(key)} className={`flex-1 py-3 rounded-xl font-black text-sm border transition ${orderType === key ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>{label}</button>
  );

  const inp = 'w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm';

  return (
    <div dir="rtl" className="relative flex gap-3 items-stretch" style={{ height: 'calc(100vh - 128px)', minHeight: 560 }}>
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] bg-green-600 text-white font-black px-6 py-3 rounded-2xl shadow-2xl">{toast}</div>}

      {shiftOpen === false && (
        <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm rounded-2xl flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1C0D10] border border-[#800020]/60 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-xl font-black text-[#FFD700] text-center">🕒 لازم تفتح وردية الأول</h3>
            <p className="text-zinc-400 text-sm text-center">عشان الأوردرات والكاش يتحسبوا صح في تقرير الوردية.</p>
            <OpenShiftForm authFetch={authFetch} onDone={onShiftOpened} />
          </div>
        </div>
      )}

      {/* المنيو */}
      <div className="flex-1 flex gap-3 min-w-0">
        <div className="w-32 shrink-0 overflow-y-auto space-y-2 pr-1">
          {sortedCats.map(c => (
            <button key={c._id} type="button" onClick={() => { setActiveCat(c.name); setSearch(''); }} className={`w-full min-h-[64px] px-2 py-3 rounded-2xl font-black text-sm leading-tight transition border-2 ${!q && catName === c.name ? 'bg-[#800020] text-white border-[#FFD700] shadow-[0_0_12px_rgba(128,0,32,0.6)]' : 'bg-[#2E1016] text-orange-200 border-transparent hover:border-[#800020]'}`}>{c.name}</button>
          ))}
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex gap-2 mb-3">
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 دوّر على صنف" className={inp} />
            <button type="button" onClick={load} className="bg-zinc-800 text-white px-4 rounded-xl text-sm font-bold shrink-0">🔄</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? <p className="text-zinc-500 text-center py-16">جاري تحميل المنيو...</p> : shownItems.length === 0 ? (
              <p className="text-zinc-500 text-center py-16">مفيش أصناف هنا</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {shownItems.map(it => {
                  const off = it.available === false;
                  const n = countInCart(it._id);
                  const hasOpts = posGroupsOf(it).length > 0;
                  const base = lowestPrice(it);
                  return (
                    <button key={it._id} type="button" disabled={off} onClick={() => pickItem(it)} className={`relative min-h-[96px] rounded-2xl p-3 text-center border-2 transition flex flex-col items-center justify-center gap-1 ${off ? 'bg-red-950/50 border-red-900 opacity-60 cursor-not-allowed' : n > 0 ? 'bg-[#2B1015] border-[#800020]' : 'bg-[#1C0D10] border-[#3A1218] hover:border-[#800020] active:scale-95'}`}>
                      {n > 0 && <span className="absolute top-1.5 left-1.5 bg-[#800020] text-white text-xs font-black min-w-[1.5rem] h-6 px-1 rounded-full flex items-center justify-center">{n}</span>}
                      <span className="font-black text-white text-sm leading-tight">{it.name}</span>
                      {off ? <span className="text-red-400 text-xs font-black">⛔ خلص</span> : (
                        <span className="text-[#FFD700] text-sm font-black">
                          {it.price > 0 ? <>{Number(it.price) || 0} ج</> : base > 0 ? <>من {base} ج</> : <span className="text-zinc-400 text-xs">حسب الاختيار</span>}
                        </span>
                      )}
                      {hasOpts && !off && <span className="text-[10px] text-zinc-500">اختيارات</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* السلة */}
      <div className="w-[420px] max-w-[46vw] shrink-0 bg-[#1C0D10] border border-[#800020]/40 rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#3A1218] bg-[#220E13]">
          <span className="font-black text-[#FFD700]">{editOrder ? `✏️ تعديل أوردر #${editOrder.shiftReceiptNo || editOrder.orderId}` : '🧾 الأوردر'} ({cart.reduce((s, l) => s + l.qty, 0)})</span>
          {editOrder
            ? <button type="button" onClick={cancelEdit} className="text-xs bg-zinc-700 text-white px-3 py-1.5 rounded-lg font-bold">✖ إلغاء التعديل</button>
            : <button type="button" onClick={clearCart} className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg font-bold">🗑️ مسح الكل</button>}
        </div>

        <div className="flex-1 overflow-y-auto min-h-[110px]">
          {cart.length === 0 ? <p className="text-zinc-600 text-center py-10 text-sm">اختار أصناف من المنيو</p> : cart.map(l => (
            <div key={l.key} className="px-3 py-1.5 border-b border-[#3A1218]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white text-sm flex-1">{l.name}</span>
                <span className="text-[#FFD700] font-black text-sm shrink-0">{l.unit * l.qty} ج</span>
              </div>
              {l.modifiersInfo.length > 0 && <p className="text-[11px] text-zinc-400">{l.modifiersInfo.map(stripMoney).join(' · ')}</p>}
              {l.notes && noteKey !== l.key && <p className="text-[11px] text-[#FFD700]">📝 {l.notes}</p>}
              {noteKey === l.key && (
                <div className="flex gap-1.5 mt-1">
                  <input autoFocus value={noteText} onChange={(e) => setNoteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(); } }} placeholder="مثال: من غير طماطم" maxLength={200} className={inp} />
                  <button type="button" onClick={saveNote} className="px-3 rounded-lg bg-green-600 text-white text-xs font-black shrink-0">حفظ</button>
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1">
                <button type="button" onClick={() => changeQty(l.key, -1)} className="w-8 h-8 rounded-lg bg-zinc-800 text-white text-lg font-black">−</button>
                <span className="min-w-[1.8rem] text-center text-white font-black">{l.qty}</span>
                <button type="button" onClick={() => changeQty(l.key, 1)} className="w-8 h-8 rounded-lg bg-zinc-800 text-white text-lg font-black">+</button>
                <span className="text-[11px] text-zinc-500 mr-1">{l.unit} ج للواحد</span>
                <button type="button" onClick={() => startNote(l)} title="ملاحظة على الصنف" className="w-8 h-8 rounded-lg bg-zinc-800 text-[#FFD700] text-sm font-black">📝</button>
                <button type="button" onClick={() => removeLine(l.key)} className="mr-auto w-8 h-8 rounded-lg bg-red-500/15 text-red-400 font-black">✕</button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#3A1218] p-3 space-y-2 overflow-y-auto max-h-[40%]">
          <div className="flex gap-2">
            {typeBtn('pickup', '🏪 استلام')}
            {typeBtn('delivery', '🛵 دليفيري')}
            {typeBtn('talabat', '🛍️ طلبات')}
          </div>

          {orderType === 'talabat' && (
            <input value={talabatNo} onChange={(e) => setTalabatNo(e.target.value)} placeholder="رقم أوردر طلبات (اكتبه بإيدك)" className={inp} dir="ltr" />
          )}

          <div className="grid grid-cols-4 gap-1.5">
            {POS_PAYS.filter(([k]) => orderType !== 'talabat' || ['cash', 'visa'].includes(k)).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setPay(k)} className={`py-2.5 rounded-xl text-xs font-black border transition ${orderType === 'talabat' ? 'col-span-2' : ''} ${pay === k ? 'bg-green-600 text-white border-green-400' : 'bg-[#12080A] text-zinc-300 border-[#3A1218] hover:border-green-500'}`}>{label}</button>
            ))}
            {orderType !== 'talabat' && <button type="button" onClick={() => setPay('split')} className={`col-span-4 py-2 rounded-xl text-xs font-black border transition ${pay === 'split' ? 'bg-green-600 text-white border-green-400' : 'bg-[#12080A] text-green-300 border-green-500/40 hover:border-green-500'}`}>✂️ دفع مقسّم (كاش + انستا / محفظة...)</button>}
          </div>
          {pay === 'split' && orderType !== 'talabat' && <SplitEditor total={total} rows={splitRows} setRows={setSplitRows} />}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400 font-bold">خصم يدوي على أوردر الكاشير</span>
              {isAdmin && <button type="button" onClick={editPresets} className="text-[11px] text-zinc-500 underline">✏️ تعديل القيم</button>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <button type="button" onClick={() => setDiscount(0)} className={`px-3 py-2 rounded-lg text-xs font-black border ${discount === 0 ? 'bg-zinc-600 text-white border-zinc-400' : 'bg-[#12080A] text-zinc-400 border-[#3A1218]'}`}>بدون</button>
              <span className="flex rounded-lg overflow-hidden border border-[#3A1218]">
                <button type="button" onClick={() => switchDiscountType('percent')} className={`px-3 py-2 text-xs font-black ${discountType === 'percent' ? 'bg-[#800020] text-white' : 'bg-[#12080A] text-zinc-400'}`}>%</button>
                <button type="button" onClick={() => switchDiscountType('amount')} className={`px-3 py-2 text-xs font-black ${discountType === 'amount' ? 'bg-[#800020] text-white' : 'bg-[#12080A] text-zinc-400'}`}>ج</button>
              </span>
              {discountType === 'percent' && presets.map(p => (
                <button key={p} type="button" onClick={() => setDiscount(p)} className={`px-3 py-2 rounded-lg text-xs font-black border ${discount === p ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-[#FFD700] border-[#3A1218] hover:border-[#800020]'}`}>{p}%</button>
              ))}
              <input value={discount || ''} onChange={(e) => setCustomDiscount(e.target.value)} placeholder={discountType === 'amount' ? 'ج' : '%'} className="w-16 bg-[#12080A] border border-[#3A1218] rounded-lg px-2 py-2 text-white text-xs text-center" dir="ltr" />
            </div>
            {discount > 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-zinc-500">ده خصم منفصل عن خصم الموقع، ومش بيتطبق إلا لما تختار خصم هنا.</p>
                <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="سبب الخصم (إجباري)" className={inp} />
              </div>
            )}
          </div>

          <div>
            {!showOrderNote && !orderNote ? (
              <button type="button" onClick={() => setShowOrderNote(true)} className="w-full py-2 rounded-xl text-xs font-black border border-dashed border-[#FFD700]/60 text-[#FFD700] hover:bg-[#FFD700]/10">📝 كومنت على الأوردر</button>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-zinc-400 font-bold">📝 كومنت (بيتطبع في الورقة)</span>
                  <button type="button" onClick={() => { setOrderNote(''); setShowOrderNote(false); }} className="text-[11px] text-zinc-500 underline">مسح</button>
                </div>
                <textarea value={orderNote} onChange={(e) => setOrderNote(e.target.value.slice(0, 300))} rows={2} placeholder="مثال: من غير طماطم، زيادة صوص، الباب التاني..." className={inp} />
              </div>
            )}
          </div>

          {orderType !== 'delivery' && !editOrder && (
            <div className="space-y-1">
              <input value={custPhone} onChange={(e) => setCustPhone(normalizePhoneInput(e.target.value))} placeholder="📞 رقم العميل " className={inp} dir="ltr" />
              {custLookup?.found && <p className="text-[11px] text-green-400 font-bold">✅ عميل قديم{custLookup.name ? `: ${custLookup.name}` : ''}</p>}
              {custLookup?.found && <button type="button" onClick={resetCustomerPin} disabled={resettingPin} className="text-[11px] text-zinc-500 underline disabled:opacity-50">🔓 مسح الرقم السري</button>}
            </div>
          )}

          {orderType === 'delivery' && (
            <div className="space-y-2">
              <input autoFocus={!editOrder} value={custPhone} onChange={(e) => setCustPhone(normalizePhoneInput(e.target.value))} placeholder="📞 رقم التليفون الأول * (إجباري)" className={inp + (custPhone ? '' : ' !border-red-500/60')} dir="ltr" />
              {custLookup?.found && <p className="text-[11px] text-green-400 font-bold">✅ عميل قديم{custLookup.ordersCount > 0 ? ` (${custLookup.ordersCount} أوردر)` : ''} — الاسم والعنوان اتملّوا، راجعهم</p>}
              {custLookup?.found && <button type="button" onClick={resetCustomerPin} disabled={resettingPin} className="text-[11px] text-zinc-500 underline disabled:opacity-50">🔓 مسح الرقم السري</button>}
              {custLookup && custLookup.found === false && <p className="text-[11px] text-zinc-400 font-bold">عميل جديد — اكتب بياناته</p>}
              <input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="اسم العميل (اختياري)" className={inp} />
              <div className="flex gap-2">
                <select value={zoneId} onChange={(e) => setZoneId(e.target.value)} className={inp + ' !w-[42%]'}>
                  <option value="">رسوم يدوي</option>
                  {zones.map(z => <option key={z._id} value={z._id}>{z.name} ({z.fee} ج)</option>)}
                </select>
                {!zone ? <input value={manualFee} onChange={(e) => setManualFee(e.target.value.replace(/\D/g, ''))} placeholder="رسوم التوصيل" className={inp} dir="ltr" /> : null}
              </div>
              <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="العنوان بالتفصيل *" className={inp} />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[#800020]/40 bg-[#220E13] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
            <span>المجموع {itemsTotal} ج</span>
            {discountAmount > 0 && <span className="text-green-400 font-bold">خصم {discountType === 'amount' ? `${discountAmount} ج` : `${discount}%`}: - {discountAmount} ج</span>}
            {fee > 0 && <span>توصيل {fee} ج</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[#FFD700] text-3xl font-black whitespace-nowrap">{total} ج</div>
            <button type="button" onClick={submit} disabled={busy || cart.length === 0} className={`flex-1 py-3.5 rounded-2xl font-black text-base transition ${busy || cart.length === 0 ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white shadow-lg'}`}>{busy ? '...جاري الحفظ' : (editOrder ? '💾 حفظ التعديل' : '✅ تأكيد وإرسال للمطبخ')}</button>
          </div>
        </div>
      </div>

      {/* اختيارات الصنف */}
      {modal && (
        <div className="fixed inset-0 z-[110] bg-black/75 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div dir="rtl" className="bg-[#1C0D10] border border-[#800020]/60 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#3A1218] flex items-center justify-between">
              <span className="font-black text-white text-lg">{modal.item.name}</span>
              <button type="button" onClick={() => setModal(null)} className="text-zinc-400 text-xl px-2">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {modal.groups.map((g, gi) => {
                const sel = selMods[gi] || [];
                return (
                  <div key={gi}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-[#FFD700] text-sm">{g.name}{g.min > 0 && <span className="text-red-400"> *</span>}</span>
                      <span className={`text-[11px] font-bold ${sel.length >= g.min && sel.length <= g.max ? 'text-green-400' : 'text-red-400'}`}>{sel.length}/{g.max}{g.min > 0 ? ' (مطلوب)' : ' (اختياري)'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {g.options.map((opt, oi) => {
                        const on = sel.includes(oi);
                        const p = (Number(opt.price) || 0);
                        const disabled = g.max > 1 && !on && sel.length >= g.max;
                        return (
                          <button key={oi} type="button" disabled={disabled} onClick={() => toggleOpt(gi, oi, g.max)} className={`px-3 py-3 rounded-xl text-sm font-bold border-2 text-right transition ${on ? 'bg-[#800020] text-white border-[#FFD700]' : disabled ? 'opacity-40 bg-[#12080A] border-[#3A1218] text-zinc-500' : 'bg-[#12080A] border-[#3A1218] text-zinc-200 hover:border-[#800020]'}`}>
                            {opt.name}{p > 0 && <span className="block text-[11px] opacity-80">+{p} ج</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              <input value={modalNotes} onChange={(e) => setModalNotes(e.target.value)} placeholder="📝 ملاحظات (اختياري)" className={inp} />
            </div>
            <div className="p-4 border-t border-[#3A1218] flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setModalQty(q2 => Math.max(1, q2 - 1))} className="w-10 h-10 rounded-lg bg-zinc-800 text-white text-xl font-black">−</button>
                <span className="min-w-[2rem] text-center text-white font-black text-xl">{modalQty}</span>
                <button type="button" onClick={() => setModalQty(q2 => q2 + 1)} className="w-10 h-10 rounded-lg bg-zinc-800 text-white text-xl font-black">+</button>
              </div>
              <button type="button" onClick={confirmModal} disabled={!modalValid} className={`flex-1 py-3 rounded-xl font-black ${modalValid ? 'bg-green-600 text-white' : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'}`}>إضافة · {modalUnit * modalQty} ج</button>
            </div>
          </div>
        </div>
      )}
      {boxModal && (() => {
        const maxN = Number(boxModal.maxItems) || 0;
        const total = Object.values(boxPicks).reduce((a, b) => a + b, 0);
        const ok = maxN === 0 ? total > 0 : total === maxN;
        const setPick = (n, d) => setBoxPicks(p => { const c = (p[n] || 0) + d; if (c < 0) return p; if (d > 0 && maxN > 0 && total >= maxN) return p; return { ...p, [n]: c }; });
        return (
          <div className="fixed inset-0 z-[110] bg-black/75 flex items-center justify-center p-4" onClick={() => setBoxModal(null)}>
            <div dir="rtl" className="bg-[#1C0D10] border border-[#800020]/60 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-[#3A1218] flex items-center justify-between">
                <span className="font-black text-white text-lg">{boxModal.name} {maxN > 0 && <span className="text-[#FFD700] text-sm">({total} / {maxN})</span>}</span>
                <button type="button" onClick={() => setBoxModal(null)} className="text-zinc-400 text-xl px-2">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                {boxModal.boxItems.map(b => (
                  <div key={b.name} className="flex items-center justify-between bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-2">
                    <span className="font-bold text-white">{b.name}</span>
                    <span className="flex items-center gap-3">
                      <button type="button" onClick={() => setPick(b.name, -1)} className="w-9 h-9 rounded-lg bg-zinc-800 text-white text-xl font-black">-</button>
                      <span className="w-6 text-center font-black text-white">{boxPicks[b.name] || 0}</span>
                      <button type="button" onClick={() => setPick(b.name, 1)} className="w-9 h-9 rounded-lg bg-zinc-800 text-white text-xl font-black">+</button>
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-4 border-t border-[#3A1218]">
                <button type="button" disabled={!ok} onClick={() => {
                  const info = Object.entries(boxPicks).filter(([, c]) => c > 0).map(([n, c]) => `${c}× ${n}`);
                  addLine(boxModal, info, '', Number(boxModal.price) || 0, 1, []);
                  setBoxModal(null);
                }} className={`w-full py-3 rounded-xl font-black ${ok ? 'bg-green-600 text-white' : 'bg-zinc-700 text-zinc-400 cursor-not-allowed'}`}>إضافة · {Number(boxModal.price) || 0} ج</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};


// ================= شات دعم العملاء — شاشة الكاشير =================
const ChatPanel = ({ authFetch, onActivity }) => {
  const [convs, setConvs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [thread, setThread] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);
  const sendingRef = useRef(false);

  const loadConvs = async () => {
    try {
      const res = await authFetch('/api/chat/conversations');
      const data = await res.json();
      if (Array.isArray(data)) setConvs(data);
    } catch (err) {}
  };

  const loadThread = async (phone) => {
    try {
      const res = await authFetch(`/api/chat/conversations/${phone}/messages`);
      const data = await res.json();
      if (Array.isArray(data)) setThread(data);
    } catch (err) {}
  };

  useEffect(() => { loadConvs(); }, []);
  useEffect(() => {
    const t = setInterval(loadConvs, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!selected) return;
    loadThread(selected);
    const t = setInterval(() => loadThread(selected), 5000);
    return () => clearInterval(t);
  }, [selected]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [thread, selected]);

  const openConv = (phone) => {
    setSelected(phone);
    setThread([]);
    setLoading(true);
    loadThread(phone).finally(() => { setLoading(false); loadConvs(); if (onActivity) onActivity(); });
  };

  const sendReply = async () => {
    const text = reply.trim();
    if (!text || !selected || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const res = await authFetch(`/api/chat/conversations/${selected}/reply`, { method: 'POST', body: JSON.stringify({ text: text.slice(0, 500) }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return alert(data.error || 'حصل خطأ، حاول تاني');
      setReply('');
      await loadThread(selected);
      loadConvs();
    } catch (err) {
      alert(err.message === 'unauthorized' ? 'انتهت الجلسة، سجّل دخول تاني.' : 'تعذّر الوصول للسيرفر، حاول تاني.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const selectedConv = convs.find(c => c.phone === selected);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className={`bg-[#1C0D10] border border-[#3A1218] rounded-2xl overflow-hidden ${selected ? 'hidden md:block' : ''}`}>
        <h3 className="text-lg font-black text-[#FFD700] px-4 py-3 border-b border-[#3A1218]">💬 محادثات العملاء</h3>
        {convs.length === 0 ? (
          <p className="text-zinc-500 text-center py-10 text-sm">لسه مفيش رسايل من العملاء</p>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {convs.map(c => (
              <button key={c.phone} type="button" onClick={() => openConv(c.phone)} className={`w-full text-right px-4 py-3 border-b border-[#3A1218] hover:bg-[#800020]/20 transition ${selected === c.phone ? 'bg-[#800020]/30' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-white text-sm">{c.name || 'عميل'} <span className="text-zinc-400 font-normal" dir="ltr">{c.phone}</span></span>
                  {c.unread > 0 && <span className="bg-red-600 text-white text-xs font-black px-2 py-0.5 rounded-full shrink-0">{c.unread} جديد</span>}
                </div>
                <p className="text-zinc-400 text-xs truncate mt-1">{c.lastFrom === 'staff' ? 'أنت: ' : ''}{c.lastText}</p>
                <p className="text-zinc-500 text-[11px] mt-1">{chatTime(c.lastAt)}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={`md:col-span-2 bg-[#1C0D10] border border-[#3A1218] rounded-2xl flex flex-col overflow-hidden ${!selected ? 'hidden md:flex' : ''}`}>
        {!selected ? (
          <p className="text-zinc-500 text-center py-20">اختار محادثة من القايمة عشان ترد عليها</p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-[#3A1218]">
              <button type="button" onClick={() => setSelected(null)} className="md:hidden text-zinc-300 font-bold">→ رجوع</button>
              <p className="font-black text-white">{selectedConv?.name || 'عميل'} <span className="text-zinc-400 font-normal text-sm" dir="ltr">{selected}</span></p>
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[55vh] min-h-[300px] bg-[#12080A]">
              {loading && thread.length === 0 ? <p className="text-zinc-500 text-center py-10 text-sm">بيحمّل...</p> : thread.map(m => (
                <div key={m._id} className={`flex ${m.from === 'staff' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-6 whitespace-pre-wrap break-words ${m.from === 'staff' ? 'bg-[#800020] text-white rounded-tr-sm' : 'bg-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
                    {m.from === 'staff' && m.staffName && <p className="text-[11px] text-[#FFD700] font-bold mb-0.5">{m.staffName}</p>}
                    <p>{m.text}</p>
                    <p className="text-[10px] opacity-60 mt-1 text-left">{chatTime(m.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 p-3 border-t border-[#3A1218]">
              <input value={reply} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendReply(); }} maxLength={500} placeholder="اكتب الرد..." className="flex-1 bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white text-sm" />
              <button type="button" onClick={sendReply} disabled={sending || !reply.trim()} className="bg-[#800020] text-white font-black px-5 rounded-xl disabled:opacity-50">إرسال 📩</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ================= 5. شاشة الكاشير (بحسابات وأدوار) =================
const CashierDashboard = ({ initialTab = 'active' }) => {
  const [session, setSession] = useState(readSession);
  const [orders, setOrders] = useState([]);
  const [archive, setArchive] = useState(null);
  const [editingOrder, setEditingOrder] = useState(null);
  const [cashierTab, setCashierTab] = useState(initialTab === 'archive' ? 'active' : initialTab); // pos | active | shift | archive | stock | staff | chat
  const [soundReady, setSoundReady] = useState(false);

  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('nossKoftaPosTheme') || 'light'; } catch (e) { return 'light'; } });
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem('nossKoftaPosTheme', next); } catch (e) {}
  };

  const [shiftData, setShiftData] = useState(null); // { shift, report } | null (لسه بيتحمل)

  const [stockItems, setStockItems] = useState([]);
  const [stockCats, setStockCats] = useState([]);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLoading, setStockLoading] = useState(false);

  const [driverModal, setDriverModal] = useState(null);
  const [driverModalTarget, setDriverModalTarget] = useState('completed');
  const [driverName, setDriverName] = useState('');
  const [completionPay, setCompletionPay] = useState('cash');
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelPin, setCancelPin] = useState('');
  const [payModal, setPayModal] = useState(null);
  const [paySplitRows, setPaySplitRows] = useState(null);
  const orderBusyRef = useRef(new Set());
  const [busyOrderIds, setBusyOrderIds] = useState([]);
  const driverBusyRef = useRef(false);
  const cancelBusyRef = useRef(false);
  const payBusyRef = useRef(false);

  const [staff, setStaff] = useState([]);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const audioCtxRef = useRef(null);
  const token = session?.token;
  const user = session?.user;
  const isAdmin = user?.role === 'admin';


  // ===== الطباعة =====
  const [shiftClosings, setShiftClosings] = useState([]);
  const [openDay, setOpenDay] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [printTick, setPrintTick] = useState(0);
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem('nossKoftaAutoPrint') !== 'off'; } catch (e) { return true; }
  });
  const autoPrintRef = useRef(autoPrint);
  const printQueueRef = useRef([]);
  const printedRef = useRef(null);
  const seededRef = useRef(false);

  const loadPrinted = () => {
    if (printedRef.current) return printedRef.current;
    let arr = null;
    try { arr = JSON.parse(localStorage.getItem('nossKoftaPrintedOrderIds')); } catch (e) {}
    printedRef.current = new Set(Array.isArray(arr) ? arr : []);
    printedRef.current.hadStorage = Array.isArray(arr);
    return printedRef.current;
  };

  const savePrinted = () => {
    try { localStorage.setItem('nossKoftaPrintedOrderIds', JSON.stringify(Array.from(printedRef.current).slice(-500))); } catch (e) {}
  };

  const requestPrint = (ord, type = 'customer') => {
    printQueueRef.current.push({ order: ord, type });
    setPrintTick(t => t + 1);
  };

  const toggleAutoPrint = () => {
    const next = !autoPrint;
    setAutoPrint(next);
    autoPrintRef.current = next;
    try { localStorage.setItem('nossKoftaAutoPrint', next ? 'on' : 'off'); } catch (e) {}
  };

  const handleAutoPrint = (list) => {
    const printed = loadPrinted();
    if (!seededRef.current) {
      seededRef.current = true;
      if (!printed.hadStorage) {
        list.forEach(o => printed.add(o._id || o.orderId));
        savePrinted();
        return;
      }
    }
    // نتخطى الأوردرات المتعلّمة "اتطبعت" على السيرفر (جهاز تاني طبعها) مش القايمة المحلية بس
    const fresh = list.filter(o => !o.printedAt && !printed.has(o._id || o.orderId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (fresh.length === 0) return;
    fresh.forEach(o => {
      const terminal = o.status === 'completed' || o.status === 'cancelled';
      if (autoPrintRef.current && !terminal) {
        printed.add(o._id || o.orderId);
        requestPrint(o, 'kitchen');
      } else if (terminal) {
        printed.add(o._id || o.orderId);
      }
      // الطباعة التلقائية مقفولة وأوردر نشط: منعلّموش، عشان يطبع لما تشتغل تاني (كان بيضيع ورق المطبخ)
    });
    savePrinted();
  };

  useEffect(() => {
    if (printJob || printQueueRef.current.length === 0) return;
    setPrintJob(printQueueRef.current.shift());
  }, [printTick, printJob]);

  useEffect(() => {
    if (!printJob) return;
    const t1 = setTimeout(() => {
      try { window.print(); } catch (e) {}
      // "اتطبع" بتتسجل بعد تشغيل الطباعة فقط، مش قبلها (عشان إلغاء الطباعة ما يعلّمش الأوردر مطبوع)
      const ord = printJob.order;
      if (printJob.type !== 'report' && token && (ord?._id || ord?.orderId)) {
        void authFetch(`/api/orders/${ord._id || ord.orderId}/printed`, { method: 'POST' }).catch(() => {});
      }
      setTimeout(() => setPrintJob(null), 1200);
    }, 400);
    return () => clearTimeout(t1);
  }, [printJob]);

  useEffect(() => {
    if (!token) return;
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    unlockAudio();
    const t = setTimeout(() => {
      if (audioCtxRef.current && audioCtxRef.current.state === 'running') setSoundReady(true);
    }, 400);
    return () => clearTimeout(t);
  }, [token]);

  const logout = () => {
    clearSession();
    setSession(null);
    setOrders([]);
    setArchive(null);
    setStaff([]);
    setShiftData(null);
    setSoundReady(false);
    setCashierTab('active');
  };

  const authFetch = (path, options = {}) => authRequest(token, path, options, logout);

  const unlockAudio = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        const c = new AudioCtx();
        c.onstatechange = () => setSoundReady(c.state === 'running');
        audioCtxRef.current = c;
      }
      audioCtxRef.current.resume();
      if (audioCtxRef.current.state === 'running') setSoundReady(true);
    } catch (err) {}
  };

  const enableSound = async () => {
    unlockAudio();
    try {
      await audioCtxRef.current.resume();
      setSoundReady(audioCtxRef.current.state === 'running');
    } catch (err) { setSoundReady(false); }
  };

  const playBeep = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const beep = (start, freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = ctx.currentTime + start;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.8, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    };
    beep(0, 880); beep(0.5, 1100); beep(1.0, 880);
  };

  const handleLoggedIn = (data) => {
    saveSession(data);
    setSession(data);
    enableSound();
  };

  const fetchOrders = async () => {
    try {
      const res = await authFetch('/api/orders?scope=live');
      const data = await res.json();
      if (Array.isArray(data)) { setOrders(data); handleAutoPrint(data); }
    } catch (err) {}
  };

  // الأرشيف الكامل (كل الأيام) — للعرض والطباعة فقط، بيتحمّل لما التبويب يتفتح
  const fetchArchive = async () => {
    try {
      const res = await authFetch('/api/orders');
      const data = await res.json();
      if (Array.isArray(data)) setArchive(data);
    } catch (err) {}
  };

  useEffect(() => {
    if (!token || cashierTab !== 'archive') return;
    fetchArchive();
    const iv = setInterval(fetchArchive, 20000);
    return () => clearInterval(iv);
  }, [token, cashierTab]);

  // الوردية المفتوحة + تقرير X اللحظي
  const refreshShift = async () => {
    try {
      const res = await authFetch('/api/shifts/current');
      const d = await res.json();
      if (res.ok) setShiftData(d);
    } catch (err) {}
  };

  // سجل الورديات المقفولة
  const fetchShifts = async () => {
    if (!isAdmin) return;
    try {
      const res = await authFetch('/api/shifts');
      const data = await res.json();
      if (Array.isArray(data)) setShiftClosings(data);
    } catch (err) {}
  };

  const fetchStock = async () => {
    setStockLoading(true);
    try {
      const [ri, rc] = await Promise.all([fetch(`${API_BASE}/api/items`), fetch(`${API_BASE}/api/categories`)]);
      const di = await ri.json();
      const dc = await rc.json();
      if (Array.isArray(di)) setStockItems(di.map(({ _id, name, category, available, order }) => ({ _id, name, category, available, order })));
      if (Array.isArray(dc)) setStockCats(dc);
    } catch (err) {}
    setStockLoading(false);
  };

  const toggleStock = async (item) => {
    const next = item.available === false;
    setStockItems(prev => prev.map(i => (i._id === item._id ? { ...i, available: next } : i)));
    try {
      const res = await authFetch(`/api/items/${item._id}/availability`, { method: 'PUT', body: JSON.stringify({ available: next }) });
      if (!res.ok) throw new Error('fail');
    } catch (err) {
      setStockItems(prev => prev.map(i => (i._id === item._id ? { ...i, available: !next } : i)));
      alert('تعذر تغيير حالة الصنف، حاول تاني');
    }
  };

  const fetchStaff = async () => {
    if (!isAdmin) return;
    try {
      const res = await authFetch('/api/staff');
      const data = await res.json();
      if (Array.isArray(data)) setStaff(data);
    } catch (err) {}
  };

  // ===== شات العملاء: عدّاد الرسايل غير المقروءة + صوت عند رسالة جديدة (من غير أي تغيير في جرس الأوردرات) =====
  const [chatUnread, setChatUnread] = useState(0);
  const chatUnreadRef = useRef(0);
  const chatSeededRef = useRef(false);
  const fetchChatSummary = async () => {
    try {
      const res = await authFetch('/api/chat/conversations');
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const total = data.reduce((s, c) => s + (c.unread || 0), 0);
      if (chatSeededRef.current && total > chatUnreadRef.current) playChatSound(audioCtxRef.current);
      chatUnreadRef.current = total;
      chatSeededRef.current = true;
      setChatUnread(total);
    } catch (err) {}
  };
  useEffect(() => {
    if (!token) return;
    chatSeededRef.current = false;
    fetchChatSummary();
    const interval = setInterval(fetchChatSummary, 5000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchOrders();
    if (isAdmin) fetchShifts();
    const interval = setInterval(fetchOrders, 3000);
    return () => clearInterval(interval);
  }, [token]);

  // الوردية: كل 20 ثانية، وكل 6 ثواني لو فاتح تبويب الوردية
  useEffect(() => {
    if (!token) return;
    refreshShift();
    const interval = setInterval(refreshShift, cashierTab === 'shift' ? 6000 : 20000);
    return () => clearInterval(interval);
  }, [token, cashierTab]);

  useEffect(() => {
    if (token && isAdmin && cashierTab === 'shift') fetchShifts();
    if (token && cashierTab === 'stock') fetchStock();
  }, [token, cashierTab]);

  useEffect(() => {
    if (token && isAdmin && cashierTab === 'staff') fetchStaff();
  }, [token, cashierTab]);

  const updateOrderStatus = async (orderId, newStatus, extra = {}) => {
    const busyKey = String(orderId);
    if (orderBusyRef.current.has(busyKey)) return false;
    orderBusyRef.current.add(busyKey);
    setBusyOrderIds(prev => [...prev, busyKey]);
    try {
      try {
        const res = await authFetch(`/api/orders/${orderId}`, { method: 'PUT', body: JSON.stringify({ status: newStatus, ...extra }) });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          alert(d.error || 'حصل خطأ، حاول تاني');
          fetchOrders();
          return false;
        }
        fetchOrders();
        refreshShift();
        return true;
      } catch (err) {
        if (err.message !== 'unauthorized') alert('تعذر الاتصال بالسيرفر، حاول تاني');
        return false;
      }
    } finally {
      orderBusyRef.current.delete(busyKey);
      setBusyOrderIds(prev => prev.filter(k => k !== busyKey));
    }
  };

  // إنهاء الأوردر: الدليفيري بيسأل عن اسم السواق الأول
  const doFinish = async (ord, extra = {}) => {
    const ok = await updateOrderStatus(ord._id || ord.orderId, 'completed', extra);
    if (ok && autoPrint) requestPrint({ ...ord, ...extra }, 'customer');
    return ok;
  };
  // السواق رجّع الفلوس: دلوقتي بس الأوردر يتقفل ويتحسب مبيعات وكاش في الدرج
  const receiveCash = async (ord) => {
    const amount = Math.max(0, cashPartOf(ord) - (Number(ord.deliveryFee) || 0));
    if (!window.confirm(`استلمت ${amount} ج من السواق ${ord.driverName || ''} على أوردر #${ord.orderId}؟`)) return;
    await updateOrderStatus(ord._id || ord.orderId, 'completed', { cashReceived: true });
  };
  // من "مقبول" للمرحلة الجاية: دليفري → خروج مع السواق، طلبات → خروج، استلام → جاهز للاستلام
  const advanceOrder = (ord) => {
    if (ord.orderType === 'delivery') {
      setDriverName('');
      setCompletionPay(ord.paymentMethod || '');
      setDriverModal(ord);
      setDriverModalTarget('ready');
      return;
    }
    if (ord.orderType === 'talabat') {
      updateOrderStatus(ord._id || ord.orderId, 'ready');
      return;
    }
    if (!ord.paymentMethod) {
      setDriverName('');
      setCompletionPay('');
      setDriverModal(ord);
      setDriverModalTarget('completed');
      return;
    }
    updateOrderStatus(ord._id || ord.orderId, 'ready');
  };
  // من "جاهز" للتسليم النهائي
  const completeReady = (ord) => {
    if (!ord.paymentMethod || (ord.orderType === 'delivery' && !ord.driverName)) {
      setDriverName('');
      setCompletionPay(ord.paymentMethod || '');
      setDriverModal(ord);
      setDriverModalTarget('completed');
      return;
    }
    doFinish(ord, ord.orderType === 'delivery' ? { driverName: ord.driverName } : {});
  };
  const readDrivers = () => { try { const a = JSON.parse(localStorage.getItem('nossKoftaDrivers')); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const confirmDriver = async () => {
    if (driverBusyRef.current) return;
    const ord = driverModal;
    if (!ord) return;
    const extra = {};
    if (ord.orderType === 'delivery') {
      const name = driverName.trim();
      if (!name) return alert('اكتب اسم السواق');
      extra.driverName = name;
      try { localStorage.setItem('nossKoftaDrivers', JSON.stringify([name, ...readDrivers().filter(d => d !== name)].slice(0, 12))); } catch (e) {}
    }
    if (!ord.paymentMethod) {
      if (!['cash', 'visa', 'instapay', 'wallet'].includes(completionPay)) return alert('اختار طريقة الدفع قبل تأكيد التسليم');
      extra.paymentMethod = completionPay;
    }
    driverBusyRef.current = true;
    setDriverModal(null);
    try {
      if (driverModalTarget === 'ready') { await updateOrderStatus(ord._id || ord.orderId, 'ready', extra); }
      else { await doFinish(ord, extra); }
    } finally { driverBusyRef.current = false; }
  };
  const knownDrivers = Array.from(new Set([...readDrivers(), ...orders.map(o => o.driverName).filter(Boolean)])).slice(0, 8);

  const startCancel = (ord) => {
    setCancelReason(''); setCancelPin('');
    setCancelModal({ ...ord, requiresPin: !isAdmin && (ord.source === 'pos' || !!ord.printedAt || !!ord.paymentMethod) });
  };
  const submitCancel = async () => {
    if (cancelBusyRef.current) return;
    const reason = cancelReason.trim();
    if (reason.length < 2) return alert('اكتب سبب الإلغاء');
    if (cancelModal?.requiresPin && !cancelPin.trim()) return alert('اكتب PIN الأدمن لإلغاء الأوردر المدفوع أو المطبوع');
    cancelBusyRef.current = true;
    const ord = cancelModal;
    setCancelModal(null);
    try { await updateOrderStatus(ord._id || ord.orderId, 'cancelled', { cancelReason: reason, adminPin: ord.requiresPin ? cancelPin.trim() : undefined }); } finally { cancelBusyRef.current = false; }
    setCancelPin('');
  };

  const saveSplitPayment = async (ord) => {
    if (payBusyRef.current) return;
    const se = splitError(paySplitRows || [], Number(ord.grandTotal) || 0);
    if (se) return alert(se);
    const rows = paySplitRows.map(r => ({ method: r.method, amount: Number(r.amount) }));
    payBusyRef.current = true;
    setPayModal(null); setPaySplitRows(null);
    try {
      const res = await authFetch(`/api/pos/orders/${ord._id || ord.orderId}`, { method: 'PUT', body: JSON.stringify({ paymentMethod: 'split', paymentSplit: rows }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return alert(d.error || 'تعذر حفظ التقسيم');
      fetchOrders(); refreshShift();
    } catch (err) { if (err.message !== 'unauthorized') alert('تعذر الاتصال بالسيرفر'); } finally { payBusyRef.current = false; }
  };
  const changePayment = async (ord, method) => {
    if (payBusyRef.current) return;
    setPayModal(null); setPaySplitRows(null);
    if (!method || method === ord.paymentMethod) return;
    payBusyRef.current = true;
    try {
      const res = await authFetch(`/api/pos/orders/${ord._id || ord.orderId}`, { method: 'PUT', body: JSON.stringify({ paymentMethod: method }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return alert(d.error || 'تعذر تغيير طريقة الدفع');
      fetchOrders(); refreshShift();
    } catch (err) { if (err.message !== 'unauthorized') alert('تعذر الاتصال بالسيرفر'); } finally { payBusyRef.current = false; }
  };

  const handleOrderEdited = (ord, info) => {
    setEditingOrder(null);
    if (info && info.changed === false) return;
    if (info && info.itemsChanged && autoPrintRef.current) requestPrint(ord, 'kitchen');
    if (window.confirm('اطبع فاتورة العميل المعدّلة؟')) requestPrint(ord, 'customer');
    fetchOrders();
    refreshShift();
  };

  // أوردر اتعمل من شاشة الـPOS: نطبع المطبخ على طول ونعلّمه متطبوع عشان الاستعلام ما يطبعوش تاني
  const handlePosCreated = (ord) => {
    const printed = loadPrinted();
    printed.add(ord._id || ord.orderId);
    savePrinted();
    if (autoPrintRef.current) requestPrint(ord, 'kitchen');
    fetchOrders();
  };

  const deleteOrder = async (id) => {
    if (!window.confirm('مسح الأوردر نهائياً؟')) return;
    try { await authFetch(`/api/orders/${id}`, { method: 'DELETE' }); fetchOrders(); } catch (err) {}
  };

  // ===== إدارة الموظفين =====
  const handleAddStaff = async (e) => {
    e.preventDefault();
    try {
      const res = await authFetch('/api/staff', { method: 'POST', body: JSON.stringify({ name: newName, username: newUsername, password: newPassword }) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'حصل خطأ');
      setNewName(''); setNewUsername(''); setNewPassword('');
      fetchStaff();
    } catch (err) {}
  };

  const handleResetPassword = async (s) => {
    const pass = window.prompt(`باسورد جديد لـ ${s.name}:`);
    if (!pass) return;
    try {
      const res = await authFetch(`/api/staff/${s._id}`, { method: 'PUT', body: JSON.stringify({ password: pass }) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'حصل خطأ');
      alert('تم تغيير الباسورد ✅');
    } catch (err) {}
  };

  const handleToggleStaff = async (s) => {
    try {
      const res = await authFetch(`/api/staff/${s._id}`, { method: 'PUT', body: JSON.stringify({ active: !s.active }) });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'حصل خطأ');
      fetchStaff();
    } catch (err) {}
  };

  const handleDeleteStaff = async (s) => {
    if (!window.confirm(`مسح حساب ${s.name}؟`)) return;
    try {
      const res = await authFetch(`/api/staff/${s._id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return alert(data.error || 'حصل خطأ');
      fetchStaff();
    } catch (err) {}
  };

  const newCount = orders.filter(o => o.status === 'pending').length;
  const preparingCount = orders.filter(o => o.status === 'accepted' && !o.awaitingCash).length;
  const awaitingCount = orders.filter(o => o.status === 'accepted' && o.awaitingCash).length;
  const readyCount = orders.filter(o => o.status === 'ready').length;
  const hasNewOrders = newCount > 0;

  useEffect(() => {
    if (!token || !soundReady || !hasNewOrders) return;
    playBeep();
    const ringInterval = setInterval(playBeep, 2500);
    return () => clearInterval(ringInterval);
  }, [token, soundReady, hasNewOrders]);

  // الأوردرات اللي مع السواقين ومستنية النقدية بتفضل في أول القائمة عشان ما تتنساش
  const activeOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled').sort((x, y) => (y.awaitingCash ? 1 : 0) - (x.awaitingCash ? 1 : 0));
  const archiveSrc = archive || orders;
  const doneOrders = archiveSrc.filter(o => o.status === 'completed');
  const cancelledOrders = archiveSrc.filter(o => o.status === 'cancelled');

  const dayGroups = (() => {
    const m = {};
    doneOrders.forEach(o => { const k = dayKeyOf(o.createdAt); (m[k] = m[k] || []).push(o); });
    return Object.keys(m).sort().reverse().map(k => ({
      key: k,
      label: dayLabelOf(`${k}T12:00:00`),
      orders: [...m[k]].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      ...sumOrders(m[k])
    }));
  })();

  const shiftOpen = shiftData ? !!shiftData.shift : null;

  const renderOrderCard = (ord) => (
    <div key={ord._id || ord.orderId} className={`bg-[#1C0D10] border rounded-2xl p-5 shadow-xl flex flex-col justify-between ${ord.status === 'cancelled' && ord.cancelledAfterPrint ? 'border-red-500 border-2 bg-red-950/30' : ord.status === 'cancelled' ? 'border-zinc-700 opacity-70' : ord.status === 'completed' ? 'border-[#3A1218]' : ord.awaitingCash ? 'border-orange-500 border-2' : ord.status === 'ready' ? 'border-blue-500/60' : ord.status === 'accepted' ? 'border-yellow-500/60' : 'border-red-500 animate-pulse'}`}>
      <div>
        <div className="flex justify-between items-center mb-3 border-b border-[#3A1218] pb-2">
          <span className="font-black text-[#FFD700] text-lg">#{ord.orderId}</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${ord.status === 'cancelled' ? 'bg-zinc-700 text-zinc-300' : ord.status === 'completed' ? 'bg-green-500/20 text-green-400' : ord.awaitingCash ? 'bg-orange-500/20 text-orange-300' : ord.status === 'ready' ? 'bg-blue-500/20 text-blue-300' : ord.status === 'accepted' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
            {ord.status === 'cancelled' && ord.cancelledAfterPrint ? '⚠️ ملغي بعد الطباعة' : ord.status === 'cancelled' ? 'ملغي ✖' : ord.status === 'completed' ? 'مكتمل ✅' : ord.awaitingCash ? '🛵 مع السواق — مستني النقدية' : ord.status === 'ready' ? (ord.orderType === 'pickup' ? 'جاهز للاستلام ✅' : '🛵 خرج للتوصيل') : ord.status === 'accepted' ? 'قيد التحضير 👨‍🍳' : 'جديد 🔔'}
          </span>
        </div>

        <div className="text-sm space-y-1 mb-4 text-zinc-300">
          {ord.orderType !== 'talabat' && ord.customerName && ord.customerName !== '-' && <p>👤 <strong className="text-white">{ord.customerName}</strong></p>}
          {ord.customerPhone && ord.customerPhone !== '-' && <p>📞 <strong className="text-white">{ord.customerPhone}</strong></p>}
          <p>📦 <strong className="text-white">{ord.orderType === 'delivery' ? `توصيل (${ord.zoneName})` : typeLabel(ord)}</strong>{ord.source === 'pos' && <span className="text-[10px] text-zinc-500 mr-2">من الكاشير</span>}</p>
          {ord.utmSource && <p>🔗 المصدر: <strong className="text-white">{ord.utmSource}</strong></p>}
          {ord.paymentMethod && <p>💰 <span className="text-zinc-300 text-xs">{payText(ord)}{ord.discountAmount > 0 ? ` · خصم ${discountLabel(ord)}` : ''}{ord.promoCode ? ` · 🎟️ كود ${ord.promoCode}` : ''}{ord.loyaltyDiscount > 0 ? ` · ⭐ نقاط -${ord.loyaltyDiscount} ج` : ''}</span></p>}
          {ord.orderNote && <p className="bg-[#FFD700]/10 border border-[#FFD700]/40 rounded-lg px-2 py-1">📝 <strong className="text-[#FFD700]">{ord.orderNote}</strong></p>}
          {ord.driverName && <p>🛵 <span className="text-zinc-300 text-xs">السواق: {ord.driverName}</span></p>}
          {ord.status === 'cancelled' && <p>✖ <span className="text-red-400 text-xs">سبب الإلغاء: {ord.cancelReason} ({ord.cancelledBy})</span></p>}
          {ord.orderType === 'delivery' && <p>📍 <span className="text-zinc-400 text-xs">{ord.customerAddress}</span></p>}
          {ord.orderType === 'delivery' && ord.customerPhone && ord.customerPhone !== '-' && ord.phoneStatus !== 'verified' && ord.phoneStatus !== 'known' && <p className="bg-orange-500/15 border border-orange-500/50 text-orange-300 rounded-lg px-2 py-1 text-xs font-bold">🆕 رقم غير موثّق — اتصل بالعميل، وبعد التأكيد اضغط زر توثيق الرقم</p>}
          {(ord.phoneStatus === 'verified' || ord.phoneStatus === 'known') && <p className="text-green-400 text-xs font-bold">✅ رقم موثّق ({ord.phoneOrders || 0} أوردر مكتمل)</p>}
          {ord.createdAt && <p>🕒 <span className="text-zinc-400 text-xs">{new Date(ord.createdAt).toLocaleString('ar-EG')}</span></p>}
          {ord.acceptedBy && <p>✅ <span className="text-zinc-400 text-xs">قبله: {ord.acceptedBy}</span></p>}
          {ord.completedBy && <p>🏁 <span className="text-zinc-400 text-xs">أنهاه: {ord.completedBy}</span></p>}
          {ord.editedAt && <p className="text-orange-300 text-xs">✏️ معدّل بواسطة {ord.editedBy}</p>}
          {ord.rating?.stars > 0 && <p>⭐ <span className="text-[#FFD700] text-xs">{'★'.repeat(ord.rating.stars)}{'☆'.repeat(5 - ord.rating.stars)}{ord.rating.comment ? ` — ${ord.rating.comment}` : ''}</span></p>}
        </div>

        <div className="bg-[#12080A] p-3 rounded-xl border border-[#3A1218] mb-4 space-y-2 max-h-48 overflow-y-auto">
          {ord.items && ord.items.map((it, idx) => (
            <div key={idx} className="text-xs">
              <div className="flex justify-between">
                <span className="text-white font-medium">{it.quantity}× {it.name}</span>
                <span className="text-[#FFD700]">{it.price * it.quantity} ج</span>
              </div>
              {(it.modifiers || []).map((m, i) => (<p key={i} className="text-zinc-400 pr-3">- {stripMoney(m)}</p>))}
              {it.notes && <p className="text-[#FFD700] pr-3">📝 {it.notes}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center pt-3 border-t border-[#3A1218] mb-4 text-sm font-bold">
          <span>الإجمالي:</span>
          <span className="text-[#FFD700] text-lg font-black">{ord.grandTotal} ج</span>
        </div>

        <div className="flex gap-2 flex-wrap">
          {ord.orderType === 'delivery' && ord.customerPhone && ord.customerPhone !== '-' && ord.phoneStatus !== 'verified' && ord.phoneStatus !== 'known' && ord.status !== 'cancelled' && (
            <button onClick={async () => {
              const confirmed = window.confirm(`هل اتصلت فعلاً بالعميل ${ord.customerPhone} وتأكدت إن الرقم يخصه؟`);
              if (!confirmed) return;
              try {
                const r = await authFetch('/api/customers/verify-by-call', { method: 'POST', body: JSON.stringify({ phone: ord.customerPhone }) });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) return alert(d.error || 'تعذر توثيق الرقم');
                alert('تم توثيق الرقم وحفظ بيانات العميل');
                fetchOrders();
              } catch { alert('تعذر الاتصال بالسيرفر'); }
            }} className="w-full bg-emerald-700 hover:bg-emerald-600 text-white py-2 rounded-xl text-xs font-black">📞 اتصلت بالعميل — توثيق الرقم</button>
          )}
          {ord.status === 'pending' && (
            <button disabled={(ord.orderType === 'delivery' && ord.customerPhone && ord.customerPhone !== '-' && ord.phoneStatus !== 'verified' && ord.phoneStatus !== 'known') || busyOrderIds.includes(String(ord._id || ord.orderId))} title={ord.orderType === 'delivery' && ord.customerPhone && ord.customerPhone !== '-' && ord.phoneStatus !== 'verified' && ord.phoneStatus !== 'known' ? 'اتصل بالعميل وأكّد الرقم الأول' : 'قبول الأوردر'} onClick={() => updateOrderStatus(ord._id || ord.orderId, 'accepted')} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-black transition shadow-lg">✅ قبول الأوردر (إيقاف الصوت)</button>
          )}
          {ord.status === 'accepted' && ord.awaitingCash && (
            <button disabled={busyOrderIds.includes(String(ord._id || ord.orderId))} onClick={() => receiveCash(ord)} className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3 rounded-xl text-sm font-black transition shadow-lg">💵 استلمت النقدية من السواق ({Math.max(0, cashPartOf(ord) - (Number(ord.deliveryFee) || 0))} ج)</button>
          )}
          {ord.status === 'accepted' && !ord.awaitingCash && (
            <button disabled={busyOrderIds.includes(String(ord._id || ord.orderId))} onClick={() => advanceOrder(ord)} className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-bold transition">{ord.orderType === 'pickup' ? '✅ جاهز للاستلام' : '🛵 جاهز للتوصيل'}</button>
          )}
          {ord.status === 'ready' && (
            <button disabled={busyOrderIds.includes(String(ord._id || ord.orderId))} onClick={() => completeReady(ord)} className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-bold transition">🏁 تم التسليم</button>
          )}
          {ord.status === 'cancelled' && <span className="flex-1 text-center text-zinc-400 text-xs font-bold py-2">الأوردر ملغي</span>}
          {ord.status === 'completed' && <span className="flex-1 text-center text-green-400 text-xs font-bold py-2">تم تسليم الأوردر</span>}
          {(ord.status === 'pending' || ord.status === 'accepted' || ord.status === 'ready') && <button onClick={() => startCancel(ord)} title="إلغاء الأوردر" className="text-red-300 bg-red-500/15 hover:bg-red-500/30 px-3 rounded-xl text-xs font-bold">✖ إلغاء</button>}
          {ord.source === 'pos' && ord.status !== 'cancelled' && shiftData?.shift && String(ord.shiftId) === String(shiftData.shift._id) && (
            <button onClick={() => { setEditingOrder(ord); setCashierTab('pos'); }} title="تعديل الأوردر (أصناف / دفع)" className="text-yellow-300 bg-yellow-500/15 hover:bg-yellow-500/30 px-3 rounded-xl text-xs font-bold">✏️ تعديل</button>
          )}
          {ord.source === 'pos' && ord.status !== 'cancelled' && shiftData?.shift && String(ord.shiftId) === String(shiftData.shift._id) && (
            <button onClick={() => setPayModal(ord)} title="تغيير طريقة الدفع" className="text-green-300 bg-green-500/15 hover:bg-green-500/30 px-3 rounded-xl text-xs font-bold">💳 الدفع</button>
          )}
          <button onClick={() => requestPrint(ord, 'kitchen')} title="طباعة ورقة المطبخ" className="text-white bg-zinc-700 hover:bg-zinc-600 px-3 rounded-xl text-sm font-bold">🍳</button>
          <button onClick={() => requestPrint(ord, 'customer')} title="طباعة فاتورة العميل" className="text-white bg-zinc-700 hover:bg-zinc-600 px-3 rounded-xl text-sm font-bold">🧾</button>
          {isAdmin && <button onClick={() => deleteOrder(ord._id)} className="text-red-400 bg-red-500/10 px-3 rounded-xl text-xs font-bold">🗑️</button>}
        </div>
      </div>
    </div>
  );

  if (!token) {
    return <StaffLogin title="🔒 دخول شاشة الكاشير" onBeforeSubmit={unlockAudio} onLogin={handleLoggedIn} />;
  }

  const tabBtn = (key, label) => (
    <button type="button" onClick={() => setCashierTab(key)} className={`flex-1 md:flex-none ${cashierTab === 'pos' ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-base'} rounded-xl font-black transition border ${cashierTab === key ? 'bg-[#800020] text-white border-[#FFD700] shadow-[0_0_15px_rgba(128,0,32,0.5)]' : 'bg-[#1C0D10] text-zinc-300 border-[#3A1218] hover:border-[#800020]'}`}>{label}</button>
  );

  return (
    <section className={`${theme === 'light' ? 'pos-light' : ''} ${cashierTab === 'pos' ? 'px-3 py-3 w-full' : 'px-8 py-12 max-w-7xl mx-auto'} min-h-screen bg-[#12080A] text-white`}>
      <style>{LIGHT_THEME_CSS}</style>
      <div className={`flex flex-wrap gap-3 justify-between items-center border-b border-[#3A1218] ${cashierTab === 'pos' ? 'mb-2 pb-2' : 'mb-8 pb-4'}`}>
        <h2 className={`${cashierTab === 'pos' ? 'text-xl' : 'text-3xl'} font-bold text-[#FFD700]`}>
          🖥️ شاشة الكاشير
          {newCount > 0 && <span className="bg-red-600 text-white text-base px-3 py-1 rounded-full mr-3 animate-pulse">🔔 {newCount} جديد</span>}
          {preparingCount > 0 && <span className="bg-yellow-500/20 text-yellow-400 text-base px-3 py-1 rounded-full mr-2">{preparingCount} قيد التحضير</span>}
          {awaitingCount > 0 && <span className="bg-orange-500/20 text-orange-300 text-base px-3 py-1 rounded-full mr-2">🛵 {awaitingCount} مستني نقدية</span>}
          {readyCount > 0 && <span className="bg-blue-500/20 text-blue-300 text-base px-3 py-1 rounded-full mr-2">✅ {readyCount} جاهز للتسليم</span>}
        </h2>
        <div className="flex flex-wrap gap-2 items-center">
          {shiftData && (shiftData.shift ? (
            <button type="button" onClick={() => setCashierTab('shift')} className="bg-green-600 text-white px-3 py-2 rounded-xl text-xs font-black" title="الوردية المفتوحة">🟢 ورديتك: {shiftData.shift.openedBy}{` · درج ${money(shiftData.report?.expectedCash)}`}</button>
          ) : (
            <button type="button" onClick={() => setCashierTab('shift')} className="bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-black animate-pulse">🔴 مفيش وردية — افتح</button>
          ))}
          {isAdmin && <StoreToggle authFetch={authFetch} />}
          <button type="button" onClick={toggleTheme} className="bg-[#1C0D10] border border-[#3A1218] text-white px-3 py-2 rounded-xl text-xs font-black">{theme === 'light' ? '🌙 داكن' : '☀️ فاتح'}</button>
          <span className="text-sm text-zinc-300 bg-[#1C0D10] border border-[#3A1218] px-3 py-2 rounded-xl">
            👤 {user.name} {isAdmin && <span className="text-[#FFD700] font-bold">(أدمن)</span>}
          </span>
          {soundReady && <button onClick={playBeep} className="bg-zinc-800 px-4 py-2 rounded-xl text-sm font-bold text-white">🔊 تجربة الصوت</button>}
          <button onClick={toggleAutoPrint} className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${autoPrint ? 'bg-green-700' : 'bg-zinc-700'}`}>🖨️ طباعة تلقائية: {autoPrint ? 'شغالة' : 'مقفولة'}</button>
          <button onClick={() => { fetchOrders(); refreshShift(); }} className="bg-[#800020] px-4 py-2 rounded-xl text-sm font-bold text-white">🔄 تحديث</button>
          {isAdmin && <Link to="/secret-admin-dashboard" className="bg-zinc-800 px-4 py-2 rounded-xl text-sm font-bold text-white">⚙️ الإدارة</Link>}
          <button onClick={logout} className="bg-zinc-700 px-4 py-2 rounded-xl text-sm font-bold text-white">🚪 خروج</button>
        </div>
      </div>

      {!soundReady && (
        <button type="button" onClick={enableSound} className="w-full mb-6 bg-red-600 hover:bg-red-700 animate-pulse text-white font-black text-lg py-4 rounded-2xl shadow-lg">
          🔕 الصوت مقفول — اضغط هنا عشان تسمع تنبيه الأوردرات الجديدة
        </button>
      )}

      <div className={`flex flex-wrap gap-3 ${cashierTab === 'pos' ? 'mb-2' : 'mb-8'}`}>
        {tabBtn('pos', '🧾 كاشير (POS)')}
        {tabBtn('active', `🔥 الأوردرات النشطة (${activeOrders.length})`)}
        {tabBtn('shift', '🕒 الوردية والتقفيل')}
        {tabBtn('archive', `📦 الأرشيف (${doneOrders.length + cancelledOrders.length})`)}
        {tabBtn('stock', '🍽️ الأصناف المتاحة')}
        {isAdmin && tabBtn('staff', '👥 إدارة الكاشيرات')}
        {tabBtn('chat', `💬 رسايل العملاء${chatUnread > 0 ? ` (${chatUnread})` : ''}`)}
      </div>

      {cashierTab === 'pos' && <PosScreen authFetch={authFetch} isAdmin={isAdmin} onCreated={(o) => { handlePosCreated(o); refreshShift(); }} shiftOpen={shiftOpen} onShiftOpened={refreshShift} editOrder={editingOrder} onEditFinished={() => setEditingOrder(null)} onEditSaved={handleOrderEdited} />}

      {cashierTab === 'active' && (
        activeOrders.length === 0 ? (
          <p className="text-zinc-500 text-center py-20 text-xl bg-[#1C0D10] border border-[#3A1218] rounded-2xl">لا توجد أوردرات نشطة حالياً ✨</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{activeOrders.map(renderOrderCard)}</div>
        )
      )}

      {cashierTab === 'shift' && (
        <ShiftPanel
          authFetch={authFetch} isAdmin={isAdmin} shiftData={shiftData} refreshShift={refreshShift}
          closedShifts={shiftClosings} refreshClosed={fetchShifts} requestPrint={requestPrint} activeCount={activeOrders.length}
        />
      )}

      {cashierTab === 'archive' && (
        <div className="space-y-6">
          <p className="text-zinc-400 text-sm bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-4">📌 أرشيف الأوردرات المكتملة حسب اليوم. حسابات الوردية والدرج والتقفيل في تبويب <strong className="text-white">🕒 الوردية والتقفيل</strong>.</p>
          {dayGroups.length === 0 ? (
            <p className="text-zinc-500 text-center py-20 text-xl bg-[#1C0D10] border border-[#3A1218] rounded-2xl">لا توجد أوردرات منتهية بعد.</p>
          ) : (
            dayGroups.map(g => {
              const isOpen = (openDay === null ? dayGroups[0].key : openDay) === g.key;
              return (
                <div key={g.key} className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl overflow-hidden">
                  <button type="button" onClick={() => setOpenDay(isOpen ? '' : g.key)} className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-right hover:bg-[#220E13] transition">
                    <span className="font-black text-white text-lg">📅 {g.label}</span>
                    <span className="flex items-center gap-4 text-sm">
                      <span className="text-zinc-300">{g.count} أوردر</span>
                      {isAdmin && <span className="text-zinc-400">توصيل {g.delivery} ج</span>}
                      {isAdmin && <span className="text-[#FFD700] text-xl font-black">{g.total} ج</span>}
                      <span className="text-zinc-400">{isOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="p-5 border-t border-[#3A1218] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-95">
                      {g.orders.map(renderOrderCard)}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {cancelledOrders.length > 0 && (
            <details className="bg-[#1C0D10] border border-red-900/50 rounded-2xl p-4">
              <summary className="cursor-pointer font-bold text-red-300">✖ أوردرات ملغية ({cancelledOrders.length})</summary>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{cancelledOrders.map(renderOrderCard)}</div>
            </details>
          )}
        </div>
      )}

      {cashierTab === 'stock' && (
        <div className="space-y-6">
          <div className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
            <div>
              <p className="font-black text-[#FFD700] text-lg">🍽️ إدارة الأصناف</p>
              <p className="text-zinc-400 text-sm mt-1">
                اضغط على الصنف عشان تقفله (خلص) أو تفتحه. الصنف الخالص بيظهر للعميل "غير متاح" ومايقدرش يطلبه.
                {' '}<span className="text-red-400 font-bold">{stockItems.filter(i => i.available === false).length} صنف خالص حالياً</span>
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="🔍 دوّر على صنف" className="bg-[#12080A] border border-[#3A1218] rounded-xl px-3 py-2 text-white text-sm" />
              <button onClick={fetchStock} className="bg-[#800020] px-4 py-2 rounded-xl text-sm font-bold text-white">{stockLoading ? '...' : '🔄 تحديث'}</button>
            </div>
          </div>

          {stockCats.map(cat => {
            const list = stockItems
              .filter(i => i.category === cat.name && (!stockSearch.trim() || i.name.toLowerCase().includes(stockSearch.trim().toLowerCase())))
              .sort((a, b) => (a.order || 0) - (b.order || 0));
            if (list.length === 0) return null;
            return (
              <div key={cat._id} className="bg-[#1C0D10] border border-[#3A1218] rounded-2xl p-5">
                <h4 className="text-lg font-black text-[#FFD700] mb-4 border-r-4 border-[#800020] pr-3">{cat.name}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map(it => {
                    const off = it.available === false;
                    return (
                      <button key={it._id} type="button" onClick={() => toggleStock(it)} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border text-right transition ${off ? 'bg-red-950/60 border-red-500/60' : 'bg-[#12080A] border-[#3A1218] hover:border-green-500/60'}`}>
                        <span className={`font-bold ${off ? 'text-zinc-400 line-through' : 'text-white'}`}>{it.name}</span>
                        <span className={`shrink-0 text-xs font-black px-3 py-1.5 rounded-full ${off ? 'bg-red-600 text-white' : 'bg-green-600 text-white'}`}>{off ? '⛔ خلص' : '✅ متاح'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {stockItems.length === 0 && !stockLoading && (
            <p className="text-zinc-500 text-center py-16 bg-[#1C0D10] border border-[#3A1218] rounded-2xl">مفيش أصناف متحملة. اضغط تحديث.</p>
          )}
        </div>
      )}

      {cashierTab === 'staff' && isAdmin && (
        <div className="space-y-8">
          <form onSubmit={handleAddStaff} className="bg-[#1C0D10] border border-[#800020]/50 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <h3 className="md:col-span-4 text-xl font-bold text-[#FFD700]">➕ إضافة كاشير جديد</h3>
            <input required type="text" placeholder="الاسم (مثلاً: أحمد)" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm" />
            <input required type="text" placeholder="اسم المستخدم (إنجليزي)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoCapitalize="none" className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm" />
            <input required type="text" placeholder="الباسورد" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-[#12080A] border border-[#3A1218] rounded-xl p-3 text-white text-sm" />
            <button type="submit" className="bg-[#800020] text-white font-bold rounded-xl hover:bg-[#990026] transition">إضافة</button>
          </form>

          <div className="space-y-3">
            {staff.map((s) => (
              <div key={s._id} className="bg-[#1C0D10] border border-[#3A1218] rounded-xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <span className="font-bold text-white">{s.name}</span>
                  <span className="text-zinc-400 text-sm mr-3">@{s.username}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold mr-2 ${s.role === 'admin' ? 'bg-[#FFD700] text-black' : 'bg-zinc-700 text-zinc-200'}`}>{s.role === 'admin' ? 'أدمن' : 'كاشير'}</span>
                  {!s.active && <span className="text-xs text-red-400 font-bold mr-2">⛔ موقوف</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResetPassword(s)} className="text-[#FFD700] bg-[#800020]/20 px-3 py-1.5 rounded-lg text-xs font-bold">🔑 تغيير الباسورد</button>
                  {s._id !== user.id && (
                    <>
                      <button onClick={() => handleToggleStaff(s)} className="text-yellow-400 bg-yellow-500/10 px-3 py-1.5 rounded-lg text-xs font-bold">{s.active ? '⏸️ إيقاف' : '▶️ تفعيل'}</button>
                      <button onClick={() => handleDeleteStaff(s)} className="text-red-400 bg-red-500/10 px-3 py-1.5 rounded-lg text-xs font-bold">✕ مسح</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cashierTab === 'chat' && <ChatPanel authFetch={authFetch} onActivity={fetchChatSummary} />}

      {driverModal && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => setDriverModal(null)}>
          <div dir="rtl" className="bg-[#1C0D10] border border-[#800020]/60 rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#FFD700]">{driverModal.orderType === 'delivery' ? (driverModalTarget === 'ready' ? `🛵 خروج أوردر للتوصيل #${driverModal.orderId}` : `🏁 تسليم أوردر التوصيل #${driverModal.orderId}`) : `💳 تأكيد الدفع للأوردر #${driverModal.orderId}`}</h3>
            {!driverModal.paymentMethod && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-300 font-bold">اختار طريقة الدفع *</p>
                <div className="grid grid-cols-3 gap-2">
                  {[['cash', '💵 كاش'], ['visa', '💳 فيزا'], ['instapay', '📱 انستا باي'], ['wallet', '👛 محفظة']].map(([key, label]) => <button key={key} type="button" onClick={() => setCompletionPay(key)} className={`py-3 rounded-xl text-xs font-black border ${completionPay === key ? 'bg-green-600 text-white border-green-400' : 'bg-[#12080A] text-zinc-300 border-[#3A1218]'}`}>{label}</button>)}
                </div>
              </div>
            )}
            {driverModal.orderType === 'delivery' && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-300 font-bold">اسم السواق *</p>
                {knownDrivers.length > 0 && <div className="flex flex-wrap gap-2">{knownDrivers.map(d => <button key={d} type="button" onClick={() => setDriverName(d)} className={`px-4 py-2 rounded-xl text-sm font-bold border ${driverName === d ? 'bg-[#800020] text-white border-[#FFD700]' : 'bg-[#12080A] text-zinc-200 border-[#3A1218]'}`}>{d}</button>)}</div>}
                <input autoFocus value={driverName} onChange={(e) => setDriverName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmDriver(); }} placeholder="اكتب اسم السواق" className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white" />
              </div>
            )}
            {driverModal.orderType === 'delivery' && (driverModal.paymentMethod || completionPay) === 'cash' && (
              <p className="text-[12px] text-orange-300 font-bold leading-5">الأوردر هيفضل في النشطة "مع السواق — مستني النقدية" ومش هيتحسب مبيعات لحد ما تدوس "استلمت النقدية من السواق". السواق بيخلّي أجرته ويسلّمك الباقي ({Math.max(0, (Number(driverModal.grandTotal) || 0) - (Number(driverModal.deliveryFee) || 0))} ج).</p>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={confirmDriver} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-xl">{driverModal.orderType === 'delivery' ? (driverModalTarget === 'ready' ? '✅ تأكيد خروج الأوردر' : '✅ تأكيد التسليم') : '✅ تأكيد الدفع والتسليم'}</button>
              <button type="button" onClick={() => setDriverModal(null)} className="px-5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
            </div>
          </div>
        </div>
      )}

      {cancelModal && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => setCancelModal(null)}>
          <div dir="rtl" className="bg-[#1C0D10] border border-red-500/60 rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-red-400">✖ إلغاء أوردر #{cancelModal.orderId}</h3>
            <p className="text-zinc-400 text-xs">الأوردر مش هيتمسح، هيفضل في الأرشيف بحالة "ملغي" وسببه ومين لغاه، ومش بيتحسب في الإيراد.</p>
            <div className="flex flex-wrap gap-2">
              {['العميل لغى', 'غلط في الأوردر', 'الصنف خلص', 'اتأخر', 'تجربة'].map(r => <button key={r} type="button" onClick={() => setCancelReason(r)} className={`px-3 py-2 rounded-xl text-sm font-bold border ${cancelReason === r ? 'bg-red-600 text-white border-red-400' : 'bg-[#12080A] text-zinc-200 border-[#3A1218]'}`}>{r}</button>)}
            </div>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="سبب الإلغاء (إجباري)" className="w-full bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white" />
            {cancelModal.requiresPin && <input type="password" inputMode="numeric" value={cancelPin} onChange={(e) => setCancelPin(e.target.value)} placeholder="PIN الأدمن لإتمام الإلغاء" className="w-full bg-[#12080A] border border-red-500/40 rounded-xl px-4 py-3 text-white" dir="ltr" />}
            <div className="flex gap-3">
              <button type="button" onClick={submitCancel} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl">تأكيد الإلغاء</button>
              <button type="button" onClick={() => setCancelModal(null)} className="px-5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
            </div>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => setPayModal(null)}>
          <div dir="rtl" className="bg-[#1C0D10] border border-green-500/60 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-green-400">💳 تغيير طريقة الدفع — أوردر #{payModal.shiftReceiptNo || payModal.orderId}</h3>
            <p className="text-xs text-zinc-400">الحالية: {payText(payModal) || '-'} · الإجمالي {payModal.grandTotal} ج</p>
            <div className="grid grid-cols-2 gap-2">
              {POS_PAYS.filter(([k]) => payModal.orderType !== 'talabat' || ['cash', 'visa'].includes(k)).map(([k, label]) => (
                <button key={k} type="button" onClick={() => changePayment(payModal, k)} className={`py-3 rounded-xl text-sm font-black border ${payModal.paymentMethod === k ? 'bg-green-600 text-white border-green-400' : 'bg-[#12080A] text-zinc-300 border-[#3A1218]'}`}>{label}</button>
              ))}
            </div>
            {payModal.orderType !== 'talabat' && !payModal.outForDeliveryAt && (
              <div className="space-y-2">
                <button type="button" onClick={() => setPaySplitRows(payModal.paymentSplit && payModal.paymentSplit.length ? payModal.paymentSplit.map(p => ({ method: p.method, amount: String(p.amount) })) : (paySplitRows || [{ method: 'cash', amount: '' }, { method: 'instapay', amount: '' }]))} className="w-full py-2.5 rounded-xl text-sm font-black border bg-[#050304] text-green-300 border-green-500/40">✂️ دفع مقسّم</button>
                {paySplitRows && (
                  <>
                    <SplitEditor total={Number(payModal.grandTotal) || 0} rows={paySplitRows} setRows={setPaySplitRows} />
                    <button type="button" onClick={() => saveSplitPayment(payModal)} className="w-full py-2.5 bg-green-600 text-white font-black rounded-xl">حفظ التقسيم</button>
                  </>
                )}
              </div>
            )}
            <button type="button" onClick={() => { setPayModal(null); setPaySplitRows(null); }} className="w-full py-2.5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
          </div>
        </div>
      )}

      <Receipt80 order={printJob?.order} type={printJob?.type} cashierName={user?.name} />
    </section>
  );
};

// ================= شاشة التحميل: سيخ كفتة بيتشوي ودخان =================
const KoftaLoader = () => {
  const messages = [
    'بنولّع الفحم 🔥',
    'بنلف الكفتة على السيخ...',
    'الدخان طالع والريحة جاية 😋',
    'لسه شوية وتبقى جاهزة'
  ];
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % messages.length), 2200);
    return () => clearInterval(t);
  }, []);

  const pieces = [0, 1, 2, 3];
  const flames = [78, 134, 190, 246];
  const smokes = [
    { x: 95, d: 0 }, { x: 150, d: 0.9 }, { x: 205, d: 1.8 },
    { x: 250, d: 0.5 }, { x: 120, d: 2.4 }, { x: 180, d: 3.0 }
  ];

  return (
    <div className="min-h-screen bg-[#12080A] flex flex-col items-center justify-center text-white px-4" dir="rtl">
      <style>{`
        .nkl-svg { width: min(92vw, 420px); height: auto; overflow: visible; }
        .nkl-box { transform-box: fill-box; }
        .nkl-piece { transform-box: fill-box; transform-origin: center; animation: nkl-build 5.2s ease-in-out infinite; }
        .nkl-cook { animation: nkl-cook 5.2s ease-in-out infinite; }
        .nkl-roll { animation: nkl-roll 0.9s linear infinite; }
        .nkl-flame { transform-box: fill-box; transform-origin: 50% 100%; animation: nkl-flame 0.7s ease-in-out infinite alternate; }
        .nkl-coal { animation: nkl-coal 1.4s ease-in-out infinite alternate; }
        .nkl-smoke { transform-box: fill-box; transform-origin: center; filter: blur(7px); opacity: 0; animation: nkl-smoke 4.2s ease-out infinite; }
        .nkl-spark { opacity: 0; animation: nkl-spark 2.2s ease-out infinite; }
        .nkl-msg { animation: nkl-fade 2.2s ease-in-out infinite; }
        @keyframes nkl-build { 0%, 3% { transform: scaleX(0); opacity: 0; } 14%, 90% { transform: scaleX(1); opacity: 1; } 100% { transform: scaleX(1); opacity: 0; } }
        @keyframes nkl-cook { 0%, 35% { opacity: 0; } 80%, 100% { opacity: 1; } }
        @keyframes nkl-roll { from { transform: translateY(0); } to { transform: translateY(10px); } }
        @keyframes nkl-flame { from { transform: scale(0.85, 0.8) skewX(-4deg); } to { transform: scale(1.1, 1.25) skewX(5deg); } }
        @keyframes nkl-coal { from { opacity: 0.55; } to { opacity: 1; } }
        @keyframes nkl-smoke {
          0% { transform: translate(0, 0) scale(0.5); opacity: 0; }
          15% { opacity: 0.5; }
          60% { transform: translate(14px, -70px) scale(1.4); opacity: 0.28; }
          100% { transform: translate(-10px, -135px) scale(2.1); opacity: 0; }
        }
        @keyframes nkl-spark {
          0% { transform: translate(0, 0); opacity: 0; }
          15% { opacity: 1; }
          100% { transform: translate(var(--dx, 8px), -90px); opacity: 0; }
        }
        @keyframes nkl-fade { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .nkl-piece, .nkl-cook, .nkl-roll, .nkl-flame, .nkl-coal, .nkl-smoke, .nkl-spark, .nkl-msg { animation: none; }
          .nkl-cook { opacity: 1; } .nkl-smoke, .nkl-spark { opacity: 0; }
        }
      `}</style>

      <svg className="nkl-svg" viewBox="0 0 320 230" role="img" aria-label="جاري تجهيز المنيو">
        <defs>
          <linearGradient id="nklRaw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#d9786c" /><stop offset="1" stopColor="#a4473f" />
          </linearGradient>
          <linearGradient id="nklCooked" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a8622f" /><stop offset="0.6" stopColor="#6e3418" /><stop offset="1" stopColor="#3d1b0c" />
          </linearGradient>
          <linearGradient id="nklFlame" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff3d00" /><stop offset="0.6" stopColor="#ff8f00" /><stop offset="1" stopColor="#ffe082" />
          </linearGradient>
          <radialGradient id="nklCoal" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#ffb300" /><stop offset="0.6" stopColor="#ff4d00" /><stop offset="1" stopColor="#7a1500" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="nklSteel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f2f2f2" /><stop offset="1" stopColor="#8a8a8a" />
          </linearGradient>
          <clipPath id="nklClip">
            {pieces.map(i => <rect key={i} x={60 + i * 54} y={104} width={50} height={28} rx={14} />)}
          </clipPath>
        </defs>

        {/* دخان */}
        {smokes.map((sm, i) => (
          <ellipse key={i} className="nkl-smoke" cx={sm.x} cy={108} rx={22} ry={16} fill="#e9e1dc" style={{ animationDelay: `${sm.d}s` }} />
        ))}

        {/* شرار */}
        {[70, 120, 175, 225, 265].map((x, i) => (
          <circle key={i} className="nkl-spark" cx={x} cy={165} r={1.8} fill="#ffb300"
            style={{ animationDelay: `${i * 0.42}s`, ['--dx']: `${(i % 2 ? 1 : -1) * (6 + i * 2)}px` }} />
        ))}

        {/* الشواية: فحم */}
        <rect x={14} y={170} width={292} height={42} rx={12} fill="#1b0e0a" stroke="#3a1a12" strokeWidth={2} />
        {[34, 66, 98, 130, 162, 194, 226, 258, 288].map((x, i) => (
          <ellipse key={i} className="nkl-coal" cx={x} cy={184 + (i % 3) * 6} rx={15} ry={8} fill="url(#nklCoal)"
            style={{ animationDelay: `${(i % 4) * 0.25}s` }} />
        ))}

        {/* لهب */}
        {flames.map((x, i) => (
          <g key={i} transform={`translate(${x} 176)`}>
            <path className="nkl-flame" d="M0 0 C -13 -12 -8 -26 0 -44 C 8 -26 13 -12 0 0 Z" fill="url(#nklFlame)" opacity={0.9}
              style={{ animationDelay: `${i * 0.15}s`, animationDuration: `${0.55 + i * 0.1}s` }} />
          </g>
        ))}

        {/* حوامل السيخ */}
        <path d="M46 168 L46 126 L38 118 M46 126 L54 118" stroke="#4a4a4f" strokeWidth={4} fill="none" strokeLinecap="round" />
        <path d="M286 168 L286 126 L278 118 M286 126 L294 118" stroke="#4a4a4f" strokeWidth={4} fill="none" strokeLinecap="round" />

        {/* السيخ */}
        <rect x={14} y={116} width={288} height={5} rx={2.5} fill="url(#nklSteel)" />
        <rect x={0} y={111} width={26} height={15} rx={7} fill="#6b3f1d" />
        <rect x={2} y={113} width={22} height={4} rx={2} fill="#8a5a2f" opacity={0.7} />

        {/* قطع الكفتة */}
        {pieces.map(i => (
          <g key={i} className="nkl-piece" style={{ animationDelay: `${i * 0.55}s` }}>
            <rect x={60 + i * 54} y={104} width={50} height={28} rx={14} fill="url(#nklRaw)" />
            <rect className="nkl-cook" x={60 + i * 54} y={104} width={50} height={28} rx={14} fill="url(#nklCooked)"
              style={{ animationDelay: `${i * 0.55}s` }} />
            <rect x={64 + i * 54} y={107} width={42} height={5} rx={2.5} fill="#fff" opacity={0.18} />
          </g>
        ))}

        {/* علامات الشوي وهي بتلف */}
        <g clipPath="url(#nklClip)">
          <g className="nkl-roll">
            {[-10, 0, 10].map((dy, k) => (
              <rect key={k} x={58} y={100 + dy + k * 4} width={218} height={3} fill="#1a0a04" opacity={0.28} />
            ))}
            {[-10, 0, 10].map((dy, k) => (
              <rect key={'b' + k} x={58} y={112 + dy + k * 4} width={218} height={3} fill="#1a0a04" opacity={0.22} />
            ))}
          </g>
        </g>
      </svg>

      <h2 className="text-[#FFD700] font-black text-2xl italic tracking-wider mt-2">جاري تجهيز المنيو... 🔥</h2>
      <p key={msgIdx} className="nkl-msg text-zinc-300 text-sm mt-3 h-5">{messages[msgIdx]}</p>
    </div>
  );
};

// ================= التطبيق الرئيسي =================

// ================= شات دعم العملاء — ودجت العميل (شاشات العملاء بس) =================
const CustomerChatWidget = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [unread, setUnread] = useState(0);
  const [chatName, setChatName] = useState('');
  const [chatPhone, setChatPhone] = useState('');
  const [formError, setFormError] = useState('');
  const [guestInfo, setGuestInfo] = useState(null);
  const [identity, setIdentity] = useState(readChatIdentity);
  const seenRef = useRef(new Set());
  const seededRef = useRef(false);
  const sendingRef = useRef(false);
  const scrollRef = useRef(null);
  const openRef = useRef(false);
  openRef.current = open;

  const customer = readCustomer();
  const token = customer?.token || identity?.token || null;
  const identified = !!token;
  const showForm = !identified && !guestInfo;

  const loadMessages = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/messages`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 401) {
        if (!customer?.token) { clearChatIdentity(); setIdentity(null); }
        return;
      }
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const freshStaff = data.filter(m => m.from === 'staff' && !seenRef.current.has(String(m._id)));
      if (seededRef.current && freshStaff.length > 0) {
        if (chatAudioCtx && chatAudioCtx.state === 'running') playChatSound(chatAudioCtx);
        else unlockChatAudio();
        if (!openRef.current) setUnread(u => u + freshStaff.length);
      }
      data.forEach(m => seenRef.current.add(String(m._id)));
      if (openRef.current) setUnread(0);
      seededRef.current = true;
      setMessages(data);
    } catch (err) {}
  };

  useEffect(() => {
    if (!identified) return;
    seededRef.current = false;
    loadMessages();
    const t = setInterval(loadMessages, open ? 5000 : 15000);
    return () => clearInterval(t);
  }, [identified, open, token]);

  useEffect(() => {
    window.addEventListener('pointerdown', unlockChatAudio, { once: true });
    window.addEventListener('keydown', unlockChatAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlockChatAudio);
      window.removeEventListener('keydown', unlockChatAudio);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  const toggleOpen = () => {
    if (!open) { setUnread(0); if (token) loadMessages(); }
    setOpen(!open);
  };

  const startChat = () => {
    let d = String(chatPhone || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('20')) d = '0' + d.slice(2);
    if (!/^01\d{9}$/.test(d)) return setFormError('اكتب رقم تليفون صحيح (11 رقم بيبدأ بـ 01).');
    setFormError('');
    setGuestInfo({ phone: d, name: chatName.trim() });
  };

  const sendMessage = async () => {
    const body = text.trim();
    if (!body || sendingRef.current) return;
    const phone = customer?.phone || identity?.phone || guestInfo?.phone || '';
    if (!phone) return;
    sendingRef.current = true;
    setSending(true);
    setSendError('');
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (customer?.token) headers.Authorization = `Bearer ${customer.token}`;
      const res = await fetch(`${API_BASE}/api/chat/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ phone, name: guestInfo?.name || '', text: body.slice(0, 500) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setSendError(data.error || 'حصل خطأ، حاول تاني'); return; }
      if (data.chatToken) {
        const ident = { token: data.chatToken, phone, name: guestInfo?.name || '' };
        saveChatIdentity(ident);
        setIdentity(ident);
        setGuestInfo(null);
      }
      if (data.message) {
        seenRef.current.add(String(data.message._id));
        setMessages(prev => [...prev, data.message]);
      }
      setText('');
    } catch (err) {
      setSendError('تعذّر الوصول للسيرفر، اتأكد من النت وحاول تاني.');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button type="button" onClick={toggleOpen} className="fixed bottom-5 left-5 z-40 w-14 h-14 rounded-full bg-[#800020] border-2 border-[#FFD700] shadow-[0_4px_20px_rgba(128,0,32,0.6)] text-2xl text-white flex items-center justify-center hover:scale-105 transition nkfx-panel" aria-label="كلم المطعم">
          💬
          {unread > 0 && <span key={unread} className="absolute -top-1 -right-1 bg-red-600 text-white text-xs font-black min-w-[22px] h-[22px] px-1 rounded-full flex items-center justify-center nkfx-pop">{unread}</span>}
        </button>
      )}
      {open && (
        <div className="fixed z-40 bottom-0 left-0 right-0 sm:bottom-5 sm:left-5 sm:right-auto w-full sm:w-[380px] h-[75vh] sm:h-[520px] bg-[#1C0D10] border border-[#800020] sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col overflow-hidden nkfx-panel">
          <div className="flex items-center justify-between px-4 py-3 bg-[#800020] text-white">
            <div>
              <p className="font-black">💬 كلم المطعم</p>
              <p className="text-[11px] text-white/80">اسأل عن أي حاجة والكاشير هيرد عليك</p>
            </div>
            <button type="button" onClick={toggleOpen} className="text-xl font-black px-2">✕</button>
          </div>

          {showForm ? (
            <div className="flex-1 flex flex-col justify-center p-5 gap-3">
              <p className="text-zinc-300 text-sm text-center leading-6">عندك سؤال؟ اكتب اسمك ورقمك وابدأ المحادثة مع الكاشير 👇</p>
              <input value={chatName} onChange={(e) => setChatName(e.target.value)} maxLength={40} placeholder="الاسم" className="bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white text-sm" />
              <input value={chatPhone} onChange={(e) => setChatPhone(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') startChat(); }} placeholder="رقم التليفون (11 رقم)" inputMode="tel" dir="ltr" className="bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white text-sm text-right" />
              {formError && <p className="text-red-400 text-xs font-bold text-center">{formError}</p>}
              <button type="button" onClick={startChat} className="bg-[#800020] text-white font-black py-3 rounded-xl hover:bg-[#990026] transition active:scale-[0.97]">ابدأ المحادثة 💬</button>
            </div>
          ) : (
            <>
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-[#12080A]">
                {messages.length === 0 ? (
                  <p className="text-zinc-500 text-center text-sm py-8">اكتب رسالتك والكاشير هيرد عليك هنا 💬</p>
                ) : messages.map(m => (
                  <div key={m._id} className={`flex ${m.from === 'customer' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-6 whitespace-pre-wrap break-words nkfx-fade ${m.from === 'customer' ? 'bg-[#800020] text-white rounded-tr-sm' : 'bg-zinc-800 text-zinc-100 rounded-tl-sm'}`}>
                      {m.from === 'staff' && <p className="text-[11px] text-[#FFD700] font-bold mb-0.5">🍽️ {m.staffName || 'المطعم'}</p>}
                      <p>{m.text}</p>
                      <p className="text-[10px] opacity-60 mt-1 text-left">{chatTime(m.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {sendError && <p className="text-red-400 text-xs font-bold text-center px-3 pt-2">{sendError}</p>}
              <div className="flex gap-2 p-3 border-t border-[#3A1218]">
                <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }} maxLength={500} placeholder="اكتب رسالتك..." className="flex-1 bg-[#12080A] border border-[#3A1218] rounded-xl px-4 py-3 text-white text-sm" />
                <button type="button" onClick={sendMessage} disabled={sending || !text.trim()} className="bg-[#800020] text-white font-black px-4 rounded-xl disabled:opacity-50 transition active:scale-95">إرسال 📩</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
};

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const isStaffPage = location.pathname === '/pos' || location.pathname === '/cashier' || location.pathname === '/accountant';
  const storeStatus = useStoreStatus();
  const [cart, setCart] = useState(() => readCustomerCart());
  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [siteSettings, setSiteSettings] = useState({ heroImage: '', heroTitleAr: 'أقوى العروض 🔥', heroTitleEn: 'Strongest Offers 🔥', logoImage: '' });
  const [logoClicks, setLogoClicks] = useState(0);
  const [lang, setLang] = useState('ar');

  const [selectedItemDetail, setSelectedItemDetail] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedAddon, setSelectedAddon] = useState(null);

  const [isLoading, setIsLoading] = useState(true);

  const t = translations[lang];

  const fetchItems = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/items`);
      let data = await res.json();
      
      data = data.map(item => ({
        ...item,
        discount: Number(item.discount) || 0
      }));

      setMenuItems(data);
    } catch (err) {}
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/categories`);
      const data = await res.json();
      setCategories(data);
    } catch (err) {}
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/settings`);
      const data = await res.json();
      setSiteSettings(data);
    } catch (err) {}
  };

  // UTM بتاع مصدر الإعلان: بيتسجل من أول زيارة وبيتبعت مع الأوردر
  useEffect(() => { captureUtmParams(); }, []);

  useEffect(() => {
    const fetchAllData = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          fetchItems(),
          fetchCategories(),
          fetchSettings()
        ]);
      } catch (err) {
        console.error("Error fetching data:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAllData();
  }, []);

  // سلة العميل: بتتحفظ مع كل تغيير، وأي صنف اتشال من المنيو بيتمسح من السلة المحفوظة
  useEffect(() => { saveCustomerCart(cart); }, [cart]);

  // Meta Pixel — AddToCart: أي زيادة في عدد سطور سلة العميل معناها صنف اتضاف
  // (بيغطي كل طرق الإضافة: من كارت المنيو، من مودال التفاصيل، من البوكس، ومن "اطلب نفس الطلب")
  const prevCartLenRef = useRef(cart.length);
  useEffect(() => {
    if (cart.length > prevCartLenRef.current) {
      const last = cart[cart.length - 1];
      if (last) trackFbq('AddToCart', { content_name: last.name, content_ids: [String(last._id || last.name)], content_type: 'product', value: Number(last.price) || 0, currency: 'EGP' });
    }
    prevCartLenRef.current = cart.length;
  }, [cart]);
  useEffect(() => {
    if (!menuItems || menuItems.length === 0) return;
    setCart((prev) => {
      if (!prev || prev.length === 0) return prev;
      const validIds = new Set(menuItems.map((m) => String(m._id)));
      const pruned = prev.filter((line) => line && validIds.has(String(line._id)));
      return pruned.length === prev.length ? prev : pruned;
    });
  }, [menuItems]);

  const handleSecretLogoClick = () => {
    setLogoClicks(prev => {
      const newCount = prev + 1;
      if (newCount === 3) {
        navigate('/secret-admin-dashboard'); // صفحة الإدارة بتطلب تسجيل دخول بنفسها
        return 0;
      }
      return newCount;
    });
  };

  const [isBoxModalOpen, setIsBoxModalOpen] = useState(false);
  const [activeBox, setActiveBox] = useState(null);
  const [boxSelections, setBoxSelections] = useState({});

  const handleOpenBox = (boxItem) => {
    if (boxItem.available === false) return;
    setActiveBox(boxItem);
    const initialSelections = {};
    if (boxItem.boxItems && boxItem.boxItems.length > 0) {
      boxItem.boxItems.forEach(b => { initialSelections[b.name] = 0; });
    }
    setBoxSelections(initialSelections);
    setIsBoxModalOpen(true);
  };

  const totalSelected = Object.values(boxSelections).reduce((a, b) => a + b, 0);

  const handleUpdateSelection = (name, operation) => {
    if (operation === 'add' && totalSelected < activeBox.maxItems) {
      setBoxSelections({ ...boxSelections, [name]: boxSelections[name] + 1 });
    } else if (operation === 'remove' && boxSelections[name] > 0) {
      setBoxSelections({ ...boxSelections, [name]: boxSelections[name] - 1 });
    }
  };

  const handleAddBoxToCart = () => {
    if (totalSelected === activeBox.maxItems) {
      const detailsStr = Object.entries(boxSelections)
        .filter(([_, count]) => count > 0)
        .map(([name, count]) => `${name}: ${count}`)
        .join(', ');

      const finalBoxPrice = getDiscountedPrice(activeBox.price, activeBox.discount);

      const customBoxItem = { 
        ...activeBox, 
        name: `${activeBox.name} (${detailsStr})`, 
        price: finalBoxPrice,
        _mods: Object.entries(boxSelections).filter(([_, count]) => count > 0).map(([n, count]) => `${count}× ${n}`)
      };
      
      setCart([...cart, customBoxItem]);
      setIsBoxModalOpen(false);
    }
  };

  const handleOpenItemDetailsModal = (item) => {
    if (item.available === false) return;
    const finalPrice = getDiscountedPrice(item.price, item.discount);
    trackFbq('ViewContent', { content_name: item.name, content_ids: [String(item._id || item.name)], content_type: 'product', value: Number(finalPrice) > 0 ? Number(finalPrice) : minOptionPrice(item), currency: 'EGP' });
    const hasSizes = item.sizes && item.sizes.length > 0;
    const hasAddons = item.addons && item.addons.length > 0;
    if (hasSizes || hasAddons) {
      setSelectedItemDetail(item);
      setSelectedSize(hasSizes ? item.sizes[0] : null);
      setSelectedAddon(null);
    } else {
      setCart([...cart, { ...item, price: finalPrice }]);
    }
  };

  const basePrice = selectedSize ? selectedSize.price : (selectedItemDetail ? selectedItemDetail.price : 0);
  const currentItemTotalPrice = getDiscountedPrice(basePrice, selectedItemDetail?.discount) + (selectedAddon ? selectedAddon.price : 0);

  const handleAddCustomizedItemToCart = () => {
    if (!selectedItemDetail) return;
    let itemName = selectedItemDetail.name;
    if (selectedSize) itemName += ` (${selectedSize.name})`;
    if (selectedAddon) itemName += ` - ${selectedAddon.name}`;

    const mods = [];
    if (selectedSize) mods.push(`اختر الحجم: ${selectedSize.name}`);
    if (selectedAddon) mods.push(`الإضافات الاختيارية: ${selectedAddon.name}`);
    const finalItem = { ...selectedItemDetail, name: itemName, price: currentItemTotalPrice, _mods: mods };
    setCart([...cart, finalItem]);
    setSelectedItemDetail(null); setSelectedSize(null); setSelectedAddon(null);
  };

  if (isLoading) return <KoftaLoader />;

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-[#12080A] text-white font-sans flex flex-col justify-between relative">
      <style>{`
        @keyframes nkfx-rise { from { opacity: 0; transform: translateY(10px); } }
        @keyframes nkfx-panel { from { opacity: 0; transform: translateY(14px) scale(0.98); } }
        @keyframes nkfx-fade { from { opacity: 0; } }
        @keyframes nkfx-pop { 0% { transform: scale(1); } 40% { transform: scale(1.35); } 100% { transform: scale(1); } }
        .nkfx-rise { animation: nkfx-rise 0.35s ease-out backwards; }
        .nkfx-panel { animation: nkfx-panel 0.3s ease-out backwards; }
        .nkfx-fade { animation: nkfx-fade 0.25s ease-out backwards; }
        .nkfx-pop { animation: nkfx-pop 0.3s ease-out; }
        .nkfx-stagger > :nth-child(2) { animation-delay: 0.05s; }
        .nkfx-stagger > :nth-child(3) { animation-delay: 0.1s; }
        .nkfx-stagger > :nth-child(4) { animation-delay: 0.15s; }
        .nkfx-stagger > :nth-child(5) { animation-delay: 0.2s; }
        .nkfx-stagger > :nth-child(n+6) { animation-delay: 0.25s; }
        @media (prefers-reduced-motion: reduce) {
          .nkfx-rise, .nkfx-panel, .nkfx-fade, .nkfx-pop { animation: none !important; }
        }
      `}</style>
      {!isStaffPage && <nav className="bg-[#1C0D10] border-b border-[#800020]/60 sticky top-0 z-50 shadow-2xl">
        <div className="flex items-center justify-between px-8 py-3">
          <Link to="/" className="flex items-center cursor-pointer select-none">
            {siteSettings.logoImage ? (
              <img src={siteSettings.logoImage} alt="Logo" style={{ height: '75px', width: 'auto' }} className="object-contain" />
            ) : (
              <span className="text-3xl font-black text-[#FFD700] tracking-tighter">نص كفتة <span className="text-white text-sm">🔥</span></span>
            )}
          </Link>
          
          <ul className="hidden md:flex gap-4 text-base font-bold">
            <li><Link to="/" className="bg-[#12080A] hover:bg-[#800020] text-zinc-300 hover:text-white border border-[#3A1218] px-6 py-2 rounded-xl transition shadow">{t.home}</Link></li>
            <li><Link to="/menu" className="bg-[#12080A] hover:bg-[#800020] text-zinc-300 hover:text-white border border-[#3A1218] px-6 py-2 rounded-xl transition shadow">{t.menu}</Link></li>
          </ul>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex flex-col text-center border-l border-[#3A1218] pl-4 ml-2">
              <span className="text-[#FFD700] text-[10px] font-black tracking-widest">{t.hotlineText}</span>
              <span className="text-white font-bold text-sm tracking-wider">01042258982</span>
            </div>
            
            <button 
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} 
              className="bg-[#12080A] text-zinc-300 border border-[#3A1218] px-3 py-2 rounded-xl text-sm font-bold hover:text-white hover:border-[#800020] transition active:scale-95"
            >
              {lang === 'ar' ? 'EN' : 'عربي'}
            </button>

            <Link to="/my-orders" className="bg-[#12080A] text-zinc-300 border border-[#3A1218] px-4 py-2.5 rounded-xl text-sm font-bold hover:text-white hover:border-[#800020] transition whitespace-nowrap active:scale-[0.97]">
              📋 طلباتي
            </Link>

            <Link to="/cart" className="flex items-center gap-2 bg-[#800020] text-white px-5 py-2.5 rounded-xl font-bold hover:bg-[#990026] transition shadow-lg active:scale-[0.97]">
              <span>🛒 {t.cart}</span>
              <span key={cart.length} className="bg-[#12080A] text-[#FFD700] px-2 py-0.5 rounded-full text-xs font-black nkfx-pop">{cart.length}</span>
            </Link>
          </div>
        </div>
      </nav>}
      {!isStaffPage && <StoreClosedBanner status={storeStatus} />}

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage lang={lang} siteSettings={siteSettings} menuItems={menuItems} handleOpenItemDetails={handleOpenItemDetailsModal} cart={cart} setCart={setCart} />} />
          <Route path="/menu" element={<MenuPage menuItems={menuItems} categories={categories} lang={lang} handleOpenBox={handleOpenBox} handleOpenItemDetails={handleOpenItemDetailsModal} cart={cart} setCart={setCart} />} />
          <Route path="/secret-admin-dashboard" element={<AdminDashboard menuItems={menuItems} categories={categories} siteSettings={siteSettings} lang={lang} fetchItems={fetchItems} fetchCategories={fetchCategories} fetchSettings={fetchSettings} />} />
          <Route path="/cashier" element={<CashierDashboard />} />
          <Route path="/accountant" element={<AccountantPage />} />
          <Route path="/pos" element={<CashierDashboard initialTab="pos" />} />
          <Route path="/cart" element={<CartPage cart={cart} setCart={setCart} lang={lang} storeStatus={storeStatus} />} />
          <Route path="/my-orders" element={<MyOrdersPage cart={cart} setCart={setCart} />} />
        </Routes>
      </div>

      {selectedItemDetail && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 nkfx-fade">
          <div className="bg-[#1C0D10] border border-[#800020] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl nkfx-panel">
            <button onClick={() => setSelectedItemDetail(null)} className="absolute top-4 left-4 text-red-400 text-xl font-bold">✕</button>
            <h3 className="text-3xl font-black text-white mb-4">{selectedItemDetail.name}</h3>
              
            {selectedItemDetail.sizes && selectedItemDetail.sizes.length > 0 && (
              <div className="mb-6 space-y-3">
                <h4 className="text-sm font-bold text-[#FFD700]">اختر الحجم:</h4>
                <div className="grid grid-cols-2 gap-3">
                  {selectedItemDetail.sizes.map((sz, idx) => {
                    const finalSzPrice = getDiscountedPrice(sz.price, selectedItemDetail.discount);
                    return (
                      <div key={idx} onClick={() => setSelectedSize(sz)} className={`p-3 rounded-xl border cursor-pointer flex flex-col items-center justify-center transition active:scale-[0.98] ${selectedSize === sz ? 'bg-[#800020]/30 border-[#FFD700] text-[#FFD700]' : 'bg-[#12080A] border-[#3A1218] text-zinc-300'}`}>
                        <span className="font-bold">{sz.name}</span>
                        {selectedItemDetail.discount > 0 ? (
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-zinc-400 line-through font-bold">{sz.price} ج</span>
                            <span className="text-sm font-black text-[#FFD700]">{finalSzPrice} ج</span>
                          </div>
                        ) : (
                          <span className="text-sm font-black text-[#FFD700]">{sz.price} ج</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {selectedItemDetail.addons && selectedItemDetail.addons.length > 0 && (
              <div className="mb-6 space-y-3">
                <h4 className="text-sm font-bold text-[#FFD700]">✨ الإضافات الاختيارية:</h4>
                <div className="flex flex-col gap-3">
                    
                  <label className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition active:scale-[0.98] ${!selectedAddon ? 'bg-[#800020]/30 border-[#FFD700] text-[#FFD700]' : 'bg-[#12080A] border-[#3A1218] text-zinc-300'}`}>
                    <div className="flex items-center gap-3">
                      <input type="radio" name="addon" checked={!selectedAddon} onChange={() => setSelectedAddon(null)} className="hidden" />
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${!selectedAddon ? 'border-[#FFD700]' : 'border-[#3A1218]'}`}>
                        {!selectedAddon && <div className="w-2.5 h-2.5 bg-[#FFD700] rounded-full"></div>}
                      </div>
                      <span className="font-bold text-sm">بدون إضافات</span>
                    </div>
                    <span className="text-sm font-black">+0 ج</span>
                  </label>

                  {selectedItemDetail.addons.map((addon, idx) => (
                    <label key={idx} className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition active:scale-[0.98] ${selectedAddon === addon ? 'bg-[#800020]/30 border-[#FFD700] text-[#FFD700]' : 'bg-[#12080A] border-[#3A1218] text-zinc-300'}`}>
                      <div className="flex items-center gap-3">
                        <input type="radio" name="addon" checked={selectedAddon === addon} onChange={() => setSelectedAddon(addon)} className="hidden" />
                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selectedAddon === addon ? 'border-[#FFD700]' : 'border-[#3A1218]'}`}>
                          {selectedAddon === addon && <div className="w-2.5 h-2.5 bg-[#FFD700] rounded-full"></div>}
                        </div>
                        <span className="font-bold text-sm">{addon.name}</span>
                      </div>
                      <span className="text-sm font-black text-[#FFD700]">+{addon.price} ج</span>
                    </label>
                  ))}

                </div>
              </div>
            )}
            <button onClick={handleAddCustomizedItemToCart} className="w-full bg-[#800020] text-white font-black py-4 rounded-xl hover:bg-[#990026] transition text-lg shadow-lg active:scale-[0.97] hover:-translate-y-0.5">
              أضف للسلة • {currentItemTotalPrice} ج
            </button>
          </div>
        </div>
      )}

      {isBoxModalOpen && activeBox && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 nkfx-fade">
          <div className="bg-[#1C0D10] border border-[#800020] rounded-2xl w-full max-w-lg p-6 relative shadow-2xl nkfx-panel">
            <button onClick={() => setIsBoxModalOpen(false)} className="absolute top-4 left-4 text-red-400 text-xl font-bold">✕</button>
              
            <h3 className="text-3xl font-black text-[#FFD700] mb-1">{activeBox.name}</h3>
            <p className="text-zinc-300 mb-6 border-b border-[#3A1218] pb-4 text-sm">
              اختر {activeBox.maxItems} أصناف. 
              <span className={`block mt-1 font-bold text-base ${totalSelected === activeBox.maxItems ? 'text-green-400' : 'text-[#FFD700]'}`}>
                تم اختيار: ({totalSelected} / {activeBox.maxItems})
              </span>
            </p>

            <div className="space-y-4 mb-8 max-h-[50vh] overflow-y-auto pr-1">
              {activeBox.boxItems && activeBox.boxItems.map((bItem, idx) => (
                <div key={idx} className="flex justify-between items-center bg-[#12080A] p-3.5 rounded-xl border border-[#3A1218]">
                  <span className="font-bold text-base text-white">{bItem.name}</span>
                  <div className="flex items-center gap-4">
                    <button onClick={() => handleUpdateSelection(bItem.name, 'remove')} className="w-8 h-8 bg-[#1C0D10] rounded-lg text-[#FFD700] font-bold transition active:scale-90">-</button>
                    <span className="text-xl w-4 text-center font-black text-white">{boxSelections[bItem.name] || 0}</span>
                    <button onClick={() => handleUpdateSelection(bItem.name, 'add')} className="w-8 h-8 bg-[#1C0D10] rounded-lg text-[#FFD700] font-bold transition active:scale-90">+</button>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleAddBoxToCart} disabled={totalSelected !== activeBox.maxItems} className={`w-full py-4 rounded-xl font-black text-lg transition active:scale-[0.97] ${totalSelected === activeBox.maxItems ? 'bg-[#800020] text-white hover:bg-[#990026] cursor-pointer shadow-lg' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}>
              أضف للسلة • {getDiscountedPrice(activeBox.price, activeBox.discount)} ج
            </button>
          </div>
        </div>
      )}

      {['/', '/menu', '/cart', '/my-orders'].includes(location.pathname) && <CustomerChatWidget />}

      {!isStaffPage && <footer onClick={handleSecretLogoClick} className="bg-[#1C0D10] border-t border-[#3A1218] mt-20 text-zinc-400 py-6 text-center text-xs cursor-default select-none">
        جميع الحقوق محفوظة © 2026 نص كفتة
      </footer>}
    </div>
  );
}
//123
export default App;