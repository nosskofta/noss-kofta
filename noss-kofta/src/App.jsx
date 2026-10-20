import React, { useState, useEffect, useRef } from 'react';
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';

const API_BASE = 'https://noss-kofta-production-d57f.up.railway.app';
const RESTAURANT_NAME = 'نص كفتة';
const RESTAURANT_PHONE = '01042258982';
const WHATSAPP_NUMBER = '201042258982';

// ================= الدخول والجلسات (كاشير / أدمن) =================
const SESSION_KEY = 'nossKoftaCashierSession';

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

const StaffLogin = ({ title, onLogin, onBeforeSubmit, requireAdmin = false }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (onBeforeSubmit) onBeforeSubmit();
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
    <div className="min-h-screen bg-[#050304] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-[#100609] border border-[#FF4500]/50 p-8 rounded-[2rem] w-full max-w-md shadow-2xl text-center">
        <h2 className="text-2xl font-black text-[#FFB800] mb-6">{title}</h2>
        <input type="text" placeholder="اسم المستخدم" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-center mb-4 text-lg" />
        <input type="password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-center mb-4 text-lg tracking-widest" />
        {error && <p className="text-red-400 text-sm font-bold mb-4">{error}</p>}
        <button type="submit" disabled={loading} className="w-full bg-[#FF4500] text-white font-bold py-3 rounded-xl hover:bg-[#E03D00] transition shadow disabled:opacity-60">
          {loading ? 'جاري الدخول...' : 'دخول النظام'}
        </button>
      </form>
    </div>
  );
};

const translations = {
  ar: {
    home: "الرئيسية", menu: "المنيو", cart: "السلة", admin: "الإدارة", all: "الكل",
    orderNow: "اطلب دلوقتي 🍔", ourMenu: "قائمة العظمة (المنيو)", bestOffers: "العروض النارية 🔥",
    seeMore: "عرض الكل ➔", hotlineText: "الخط الساخن",
    rights: "جميع الحقوق محفوظة © 2026 نص كفتة - Noss Kofta",
    addToCart: "أضف للسلة 🛒", customizeBox: "صمم بوكس الأحلام ⚙️", details: "اختيار و تخصيص",
    emptyCart: "السلة فاضية خالص!", backToMenu: "رجعني للمنيو", total: "إجمالي الطلب:",
    whatsappOrder: "📲 إرسال الطلب عبر الواتساب", delete: "حذف", edit: "تعديل", save: "حفظ", cancel: "إلغاء",
    addItem: "➕ إضافة صنف جديد للمنيو", addCat: "➕ إضافة قسم جديد",
    catManage: "📁 تنظيم وترتيب أقسام المنيو", itemManage: "🍔 إدارة وتعديل أصناف البرجر",
    siteSettings: "🖼️ تخصيص اللوجو والواجهة",
  },
  en: {
    home: "Home", menu: "Menu", cart: "Cart", admin: "Admin", all: "All",
    orderNow: "Order Now 🍔", ourMenu: "Our Menu", bestOffers: "Hot Offers 🔥", seeMore: "See All ➔",
    hotlineText: "HOTLINE", addToCart: "Add to Cart 🛒", customizeBox: "Customize Box ⚙️",
    details: "Customize & Order", emptyCart: "Your cart is empty!", backToMenu: "Back to menu",
    total: "Total:", whatsappOrder: "📲 Send Order via WhatsApp", delete: "Delete", edit: "Edit",
    save: "Save", cancel: "Cancel", addItem: "➕ Add New Item", addCat: "➕ Add Category",
    catManage: "📁 Manage Menu Categories", itemManage: "🍔 Manage Menu Items",
    siteSettings: "🖼️ Control Website Settings",
  }
};

const getDiscountedPrice = (price, discountPercent) => {
  if (!discountPercent || discountPercent <= 0) return price;
  return Math.round(price * (1 - discountPercent / 100));
};

// ================= Meta Pixel: تتبع الأحداث =================
// بيبعت الحدث لفيسبوك (لو البكسل متحمل). مفيش أي بيانات شخصية بتتبعت (لا اسم ولا تليفون ولا عنوان).
const track = (event, data, eventId) => {
  try {
    if (window.fbq) window.fbq('track', event, data, eventId ? { eventID: eventId } : undefined);
  } catch (e) {}
};

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
    <div className="bg-gradient-to-l from-[#8d1710] via-[#ef321b] to-[#8d1710] text-white text-center px-4 py-2.5 text-sm md:text-base font-black leading-relaxed">
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
    <button type="button" disabled={busy} onClick={() => setMode(mode)} className={`px-3 py-1.5 rounded-lg text-xs font-black transition ${st.mode === mode ? on : 'bg-[#050304] text-zinc-400 hover:text-white'}`}>{label}</button>
  );
  return (
    <div className="flex items-center gap-1 bg-[#100609] border border-[#1F0A0E] rounded-xl p-1">
      <span className={`px-3 py-1.5 rounded-lg text-xs font-black text-white ${st.isOpen ? 'bg-green-600' : 'bg-red-600'}`}>{st.isOpen ? '🟢 الموقع مفتوح' : '🔴 الموقع مقفول'}</span>
      {btn('open', 'فتح', 'bg-green-700 text-white')}
      {btn('closed', 'قفل', 'bg-red-700 text-white')}
      {btn('auto', '⏰ تلقائي', 'bg-[#FF4500] text-white')}
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
    <button type="button" disabled={busy} onClick={() => setMode(mode)} className={`flex-1 py-3 rounded-2xl font-black text-sm border transition ${st?.mode === mode ? on : 'bg-[#050304] text-zinc-400 border-[#1F0A0E] hover:border-zinc-500'}`}>{label}</button>
  );

  return (
    <div className="bg-[#100609] p-8 rounded-[2.5rem] border border-[#FF4500]/40 mb-8 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-xl font-bold text-[#FFB800]">⏰ مواعيد استقبال الأوردرات</h3>
        {st && <span className={`px-4 py-1.5 rounded-full text-sm font-black text-white ${st.isOpen ? 'bg-green-600' : 'bg-red-600'}`}>{st.isOpen ? '🟢 مفتوح دلوقتي' : '🔴 مقفول دلوقتي'}</span>}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {modeBtn('open', '🟢 فتح (يدوي)', 'bg-green-700 text-white border-green-400')}
        {modeBtn('closed', '🔴 قفل (يدوي)', 'bg-red-700 text-white border-red-400')}
        {modeBtn('auto', '⏰ تلقائي حسب المواعيد', 'bg-[#FF4500] text-white border-[#FFB800]')}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs text-zinc-300 mb-1">بنفتح الساعة</label>
          <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" />
        </div>
        <div>
          <label className="block text-xs text-zinc-300 mb-1">بنقفل الساعة (ممكن تكون بعد نص الليل)</label>
          <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" />
        </div>
      </div>

      <label className="block text-xs text-zinc-300 mb-1">رسالة القفل (اختياري — لو سبتها فاضية هتظهر الرسالة الافتراضية)</label>
      <textarea rows="2" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="قفلنا دلوقتي 🌙 هنفتح الصبح بإذن الله" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm mb-4" />

      <button type="button" disabled={busy} onClick={saveHours} className="w-full bg-[#FF4500] hover:bg-[#E03D00] disabled:opacity-60 text-white font-black py-4 rounded-2xl transition shadow-lg">💾 حفظ المواعيد والرسالة</button>
      <p className="text-zinc-500 text-xs mt-3">الوضع اليدوي (فتح/قفل) بيفضل زي ما هو لحد ما ترجّعه "تلقائي".</p>
    </div>
  );
};

// ================= عدّاد الكمية على كارت الصنف (بدل علامة +) =================
const CardQty = ({ item, cart, setCart, soldOut }) => {
  const count = (cart || []).filter(c => String(c._id) === String(item._id)).length;
  const hasOptions = (item.modifierGroups?.length > 0) || (item.sizes?.length > 0) || (item.addons?.length > 0);
  const box = "w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center shrink-0";

  if (soldOut) return <span className={`${box} border border-white/15 text-sm sm:text-xl`}>⛔</span>;

  if (count === 0) {
    return <span className={`${box} border border-white/15 text-sm sm:text-xl group-hover:bg-[#ef321b] group-hover:border-[#ef321b] transition`}>+</span>;
  }

  // صنف له اختيارات (حجم/إضافات): نعرض العدد بس، والدوس على الكارت يفتح الاختيارات ويضيف نسخة تانية
  if (hasOptions) {
    return (
      <span className="flex items-center gap-1.5 shrink-0" title="موجود في السلة">
        <span className="bg-[#ef321b] text-white font-black text-xs sm:text-sm px-2 h-7 sm:h-9 flex items-center justify-center min-w-[2.2rem]">✓ {count}</span>
      </span>
    );
  }

  const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
  const inc = (e) => {
    stop(e);
    track('AddToCart', { content_name: item.name, content_ids: [String(item._id)], content_type: 'product', value: getDiscountedPrice(item.price, item.discount), currency: 'EGP' });
    setCart([...cart, { ...item, cartId: Date.now() + Math.random(), price: getDiscountedPrice(item.price, item.discount) }]);
  };
  const dec = (e) => {
    stop(e);
    let idx = -1;
    for (let i = cart.length - 1; i >= 0; i--) { if (String(cart[i]._id) === String(item._id)) { idx = i; break; } }
    if (idx !== -1) { const next = [...cart]; next.splice(idx, 1); setCart(next); }
  };

  return (
    <span className="flex items-center border border-[#ef321b] bg-[#ef321b]/10 shrink-0" onClick={stop}>
      <span role="button" tabIndex={0} onClick={dec} className="w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center text-lg sm:text-xl font-black hover:bg-[#ef321b] cursor-pointer select-none">−</span>
      <span className="min-w-[1.6rem] sm:min-w-[2rem] text-center font-black text-sm sm:text-lg">{count}</span>
      <span role="button" tabIndex={0} onClick={inc} className="w-7 h-7 sm:w-9 sm:h-9 flex items-center justify-center text-lg sm:text-xl font-black hover:bg-[#ef321b] cursor-pointer select-none">+</span>
    </span>
  );
};

// ================= 1. صفحة الرئيسية =================
const HomePage = ({ lang, siteSettings, menuItems, categories, handleOpenItemDetails, menuRef, cart, setCart }) => {
  const t = translations[lang];
  const [selectedHomeCat, setSelectedHomeCat] = useState('');

  useEffect(() => {
    if (categories.length > 0 && !selectedHomeCat) {
      const smashCat = categories.find(c => c.name.toLowerCase().includes('smash') || c.name.includes('سماش'));
      setSelectedHomeCat(smashCat ? smashCat.name : categories[0].name);
    }
  }, [categories, selectedHomeCat]);

  const scrollToMenu = () => {
    if (menuRef.current) menuRef.current.scrollIntoView({ behavior: 'smooth' });
  };

  const filteredHomeItems = menuItems.filter(item => item.category === selectedHomeCat).slice(0, 6);

  return (
    <div className="bg-[#050505] text-white overflow-hidden">
      <section className="relative min-h-[580px] md:min-h-[calc(100vh-78px)] flex items-center overflow-hidden border-b border-[#8d1710] py-8 md:py-0" dir="ltr">
        <div className="absolute inset-0 bg-[#050505]" />
        <div className="absolute inset-y-0 right-0 w-full md:w-[67%] bg-cover bg-center opacity-30 md:opacity-100" style={{ backgroundImage: `url(${siteSettings.heroImage || menuItems[0]?.image || ''})` }} />
        <div className="absolute inset-y-0 right-0 w-full md:w-[72%] bg-gradient-to-r from-[#050505] via-[#050505]/95 md:to-transparent" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_40%,rgba(255,65,10,.28),transparent_34%)]" />
        <div className="absolute left-0 top-0 bottom-0 w-2 bg-[#e62c16]" />
        <div className="absolute left-0 top-0 w-64 h-64 bg-[#e62c16]/20 blur-3xl" />

        <div className="relative z-10 w-full max-w-[1500px] mx-auto px-6 md:px-12 flex items-center">
          <div className="w-full md:w-[60%] py-4 md:py-20">
            <div className="font-black italic uppercase tracking-[0.22em] text-[#ff4a22] text-xs md:text-base mb-2">BIGGER · JUICIER · HOTTER</div>
            <div className="leading-[0.82] uppercase italic font-black tracking-[-0.05em] my-4 transform -rotate-6 origin-left">
              <div className="text-[48px] sm:text-[72px] md:text-[98px] lg:text-[115px] text-white drop-shadow-[0_10px_20px_rgba(0,0,0,0.9)]">THE FIRE</div>
              <div className="text-[48px] sm:text-[72px] md:text-[98px] lg:text-[115px] text-[#ef321b] mt-1 drop-shadow-[0_10px_20px_rgba(239,50,27,0.5)]">IS COMING</div>
            </div>
            <div className="mt-6 text-[#ef321b] italic font-black text-lg sm:text-2xl md:text-3xl tracking-wide drop-shadow-md" style={{ fontFamily: 'cursive' }}>Smash Burgers & Nashville Chicken</div>
            <p className="mt-3 md:mt-5 text-white/90 text-sm sm:text-base md:text-xl font-bold max-w-md leading-relaxed" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
              {lang === 'ar' ? 'مش مجرد برجر.. ده نص كفتة! 🔥' : "Not just a burger... This is Noss Kofta! 🔥"}
            </p>
            <button onClick={scrollToMenu} dir={lang === 'ar' ? 'rtl' : 'ltr'} className="inline-flex items-center justify-center gap-5 mt-4 md:mt-7 bg-[#ed321c] hover:bg-[#ff4528] text-white px-8 md:px-10 py-3.5 md:py-4 font-black text-base md:text-lg transition-all duration-300 shadow-[0_12px_40px_rgba(237,50,28,.28)] cursor-pointer" style={{ clipPath: 'polygon(3% 0, 97% 0, 100% 18%, 98% 84%, 94% 100%, 4% 100%, 0 78%, 2% 14%)' }}>
              {t.orderNow}<span className="text-xl leading-none">→</span>
            </button>
          </div>
        </div>
      </section>

      <div className="relative border-y border-[#8c2118] bg-[#0a0909] h-16 overflow-hidden flex items-center">
        <div className="whitespace-nowrap flex items-center gap-12 md:gap-20 text-[#ef321b] italic font-black text-xl md:text-2xl animate-[bahbah-marquee_22s_linear_infinite]">
          {Array.from({ length: 4 }).map((_, i) => (
            <React.Fragment key={i}>
              <span>BAHBAH</span><span>♛</span><span>BIGGER</span><span>•</span><span>JUICIER</span><span>•</span><span>HOTTER</span><span>♛</span>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div ref={menuRef} className="scroll-mt-[78px]"></div>
      
      <section className="relative max-w-[1500px] mx-auto px-5 md:px-10 py-16 md:py-20">
        <div className="absolute left-0 top-10 w-40 h-80 bg-[#ef321b]/10 blur-3xl pointer-events-none" />
        
        <div className="flex flex-col gap-10">
          <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-[#ef321b]/20 pb-8">
            <div>
              <div className="text-[#ef321b] italic font-black text-3xl md:text-4xl">OUR</div>
              <div className="text-white uppercase italic font-black leading-[.82] text-6xl md:text-7xl">MENU</div>
              <div className="mt-5 text-xl font-black">قائمة العظمة</div>
              <p className="mt-4 text-white/55 text-sm leading-7">من البرجر الكلاسيك لحد التركيبات الخاصة.. كل لقمة في نص كفتة ليها حكاية.</p>
            </div>
            {siteSettings.promoBannerImage && (
              <div className="relative w-full md:w-80 h-32 rounded-2xl overflow-hidden border border-[#ef321b]/35 shadow-lg">
                <img src={siteSettings.promoBannerImage} alt="Noss Kofta Offer" className="absolute inset-0 w-full h-full object-cover" />
              </div>
            )}
          </div>

          <div className="w-full">
            <div className="flex gap-2 overflow-x-auto pb-5 mb-4 scrollbar-none">
              {categories.map((cat) => (
                <button key={cat._id} onClick={() => setSelectedHomeCat(cat.name)} className={`shrink-0 px-7 py-3 font-bold border transition-all ${selectedHomeCat === cat.name ? 'bg-[#ef321b] text-white border-[#ef321b]' : 'bg-[#111] text-white/60 border-white/5 hover:border-white/20'}`} style={selectedHomeCat === cat.name ? { clipPath: 'polygon(4% 0,96% 0,100% 22%,97% 90%,91% 100%,5% 97%,0 80%,2% 12%)' } : {}}>
                  {cat.name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
              {filteredHomeItems.length > 0 ? filteredHomeItems.map((item) => {
                const basePrice = item.price > 0 ? item.price : (item.modifierGroups?.[1]?.options?.[0]?.price || 0);
                const price = getDiscountedPrice(basePrice, item.discount);
                const soldOut = item.available === false;
                return (
                  <article key={item._id} className={`bg-[#0d0d0d] border border-white/10 hover:border-[#ef321b]/80 transition group flex flex-col overflow-hidden ${soldOut ? 'opacity-60' : ''}`}>
                    <button onClick={() => handleOpenItemDetails(item)} disabled={soldOut} className={`w-full text-left flex flex-col h-full ${soldOut ? 'cursor-not-allowed' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                      <div className="relative h-32 sm:h-52 overflow-hidden bg-black shrink-0 w-full">
                        {soldOut && <span className="absolute top-2 right-2 z-20 bg-red-600 px-2 py-0.5 text-[10px] sm:text-xs font-black">⛔ غير متاح</span>}
                        {item.discount > 0 && <span className="absolute top-2 left-2 z-10 bg-[#ef321b] px-3 py-1.5 text-xs sm:text-sm md:text-base font-black shadow-lg rounded-sm">خصم {item.discount}%</span>}
                        <img src={item.image} alt={item.name} loading="lazy" decoding="async" className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${soldOut ? 'grayscale' : ''}`} />
                      </div>
                      <div className="p-3 sm:p-5 flex flex-col flex-1 justify-between w-full">
                        <div>
                          <h3 className="text-sm sm:text-xl font-black italic uppercase truncate">{item.name}</h3>
                          <p className="text-[11px] sm:text-sm text-white/45 mt-1 sm:mt-2 line-clamp-2 min-h-[32px] sm:min-h-[40px]">{item.description || ''}</p>
                        </div>
                        <div className="flex items-center justify-between mt-3 sm:mt-6">
                          <div className="text-[#ef321b] text-sm sm:text-xl font-black">
                            {item.discount > 0 && basePrice > 0 ? (
                              <div className="flex items-center gap-1 sm:gap-2">
                                <span>EGP {price}</span>
                                <span className="text-[9px] sm:text-xs text-zinc-500 line-through">EGP {basePrice}</span>
                              </div>
                            ) : `EGP ${basePrice}`}
                          </div>
                          <CardQty item={item} cart={cart} setCart={setCart} soldOut={soldOut} />
                        </div>
                      </div>
                    </button>
                  </article>
                );
              }) : (
                <div className="col-span-full py-10 text-center text-white/40 font-bold border border-white/5 bg-[#111]">لا توجد أصناف في هذا القسم حالياً.</div>
              )}
            </div>

            <div className="mt-8 text-center lg:text-left">
              <Link to="/menu" className="inline-block border border-[#ef321b] text-white px-8 py-3 font-black hover:bg-[#ef321b] transition">{t.seeMore}</Link>
            </div>
          </div>
        </div>
      </section>

      <style>{`@keyframes bahbah-marquee { from { transform: translateX(0); } to { transform: translateX(-25%); } }`}</style>
    </div>
  );
};

// ================= 2. صفحة المنيو =================
const MenuPage = ({ menuItems, categories, lang, handleOpenItemDetails, cart, setCart }) => {
  const t = translations[lang];
  const [selectedCategory, setSelectedCategory] = useState('');

  useEffect(() => {
    if (categories.length > 0 && !selectedCategory) {
      const smashCat = categories.find(c => c.name.toLowerCase().includes('smash') || c.name.includes('سماش'));
      setSelectedCategory(smashCat ? smashCat.name : categories[0].name);
    }
  }, [categories, selectedCategory]);

  const categoriesToShow = categories.filter(cat => cat.name === selectedCategory);

  return (
    <section className="bg-[#050505] text-white min-h-screen overflow-hidden">
      <div className="max-w-[1500px] mx-auto px-5 md:px-10 pt-14 pb-24">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 border-b border-white/10 pb-8">
          <div>
            <div className="text-[#ef321b] italic font-black text-3xl">OUR</div>
            <h1 className="text-6xl md:text-8xl uppercase italic font-black leading-[.8]">MENU</h1>
            <p className="mt-5 text-white/50"> اختارعلي  مزاجك وخلي الباقي على نص كفتة.</p>
          </div>
        </div>

        <div className="flex gap-2 overflow-x-auto py-7 scrollbar-none border-b border-white/5">
          {categories.map(cat => (
            <button key={cat._id} onClick={() => setSelectedCategory(cat.name)} className={`shrink-0 px-8 py-3 font-black transition-all ${selectedCategory === cat.name ? 'bg-[#ef321b] text-white' : 'bg-[#111] text-white/55 border border-white/10 hover:border-white/30'}`} style={selectedCategory === cat.name ? { clipPath: 'polygon(4% 0,96% 0,100% 22%,97% 90%,91% 100%,5% 97%,0 80%,2% 12%)' } : {}}>{cat.name}</button>
          ))}
        </div>

        {categoriesToShow.length === 0 ? (
          <div className="py-28 text-center text-white/40">لا توجد أقسام مضافة بعد.</div>
        ) : (
          <div className="space-y-20 pt-10">
            {categoriesToShow.map(cat => {
              const catItems = menuItems.filter(item => item.category === cat.name).sort((a, b) => (a.order || 0) - (b.order || 0));
              if (!catItems.length) return <div className="text-center text-white/40 py-10" key={cat._id}>لا توجد أصناف في {cat.name}</div>;
              return (
                <div key={cat._id}>
                  <div className="flex items-center gap-5 mb-7">
                    <h2 className="text-4xl md:text-5xl font-black italic uppercase">{cat.name}</h2>
                    <div className="h-px flex-1 bg-gradient-to-r from-[#ef321b]/60 to-transparent" />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-5">
                    {catItems.map(item => {
                      const basePrice = item.price > 0 ? item.price : (item.modifierGroups?.[1]?.options?.[0]?.price || 0);
                      const price = getDiscountedPrice(basePrice, item.discount);
                      const soldOut = item.available === false;
                      return (
                        <article key={item._id} className={`bg-[#0d0d0d] border border-white/10 hover:border-[#ef321b] transition flex flex-col overflow-hidden group ${soldOut ? 'opacity-60' : ''}`}>
                          <button onClick={() => handleOpenItemDetails(item)} disabled={soldOut} className={`w-full text-left flex flex-col h-full ${soldOut ? 'cursor-not-allowed' : ''}`} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
                            <div className="relative h-32 sm:h-56 bg-black overflow-hidden shrink-0 w-full">
                              {soldOut && <span className="absolute top-2 right-2 z-20 bg-red-600 px-2 py-0.5 text-[10px] sm:text-xs font-black">⛔ غير متاح</span>}
                              {item.discount > 0 && <span className="absolute top-2 left-2 z-10 bg-[#ef321b] px-3 py-1.5 text-xs sm:text-sm md:text-base font-black shadow-lg rounded-sm">خصم {item.discount}%</span>}
                              <img src={item.image || "https://via.placeholder.com/400x300/0D0D0D/EF321B?text=Noss Kofta"} alt={item.name} loading="lazy" decoding="async" className={`w-full h-full object-cover group-hover:scale-105 transition duration-500 ${soldOut ? 'grayscale' : ''}`} />
                            </div>
                            <div className="p-3 sm:p-5 flex flex-col flex-1 justify-between w-full">
                              <div>
                                <h3 className="text-sm sm:text-xl font-black italic uppercase truncate">{item.name}</h3>
                                <p className="text-[11px] sm:text-sm text-white/45 mt-1 sm:mt-2 line-clamp-2 min-h-[32px] sm:min-h-[40px]">{item.description || ''}</p>
                              </div>
                              <div className="flex items-center justify-between mt-3 sm:mt-6">
                                <div className="flex items-center gap-1.5 sm:gap-2" dir="ltr">
                                  <span className="text-[#ef321b] text-sm sm:text-xl font-black whitespace-nowrap">
                                    EGP {item.discount > 0 && basePrice > 0 ? price : basePrice}
                                  </span>
                                  {item.discount > 0 && basePrice > 0 && (
                                    <span className="text-[10px] sm:text-sm text-zinc-500 line-through whitespace-nowrap">
                                      EGP {basePrice}
                                    </span>
                                  )}
                                </div>
                                <CardQty item={item} cart={cart} setCart={setCart} soldOut={soldOut} />
                              </div>
                            </div>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};

// ================= 3. لوحة التحكم =================
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
    <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5 mb-6">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between text-right">
        <span className="font-black text-[#FFB800] text-lg">🖼️ تصغير الصور الحالية (لتسريع الموقع)</span>
        <span className="text-zinc-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          <p className="text-zinc-400 text-sm">بيمر على كل صورة كبيرة (أكتر من 70 ك.ب) ويصغّرها ويحفظها. اترك الصفحة مفتوحة لحد ما يخلص.</p>
          <button type="button" disabled={running} onClick={run} className={`px-5 py-3 rounded-xl font-black text-white ${running ? 'bg-zinc-600' : 'bg-[#FF4500] hover:bg-[#E03D00]'}`}>{running ? '...جاري التصغير' : '🚀 ابدأ التصغير'}</button>
          {summary && <p className="text-green-400 font-bold text-sm">{summary}</p>}
          {log.length > 0 && <div className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 max-h-60 overflow-y-auto text-xs text-zinc-300 space-y-1">{log.map((l, i) => <p key={i}>{l}</p>)}</div>}
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
    <div className="bg-[#100609] border border-[#FF4500]/40 rounded-[2rem] p-6 mt-10">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-right">
        <span className="text-xl font-black text-[#FFB800]">🏷️ تعديل الخصم لأكتر من صنف مرة واحدة</span>
        <span className="text-zinc-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="bg-[#0A0407] border border-[#1F0A0E] rounded-xl px-3 py-2 text-white text-sm">
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
                <button key={d} type="button" onClick={() => selectByDiscount(d)} className="bg-[#FF4500]/20 text-[#FFB800] border border-[#FF4500]/40 px-3 py-1.5 rounded-xl text-xs font-black">
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
                <label key={item._id} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 border cursor-pointer transition ${on ? 'bg-[#FF4500]/15 border-[#FF4500]' : 'bg-[#0A0407] border-[#1F0A0E] hover:border-zinc-600'}`}>
                  <span className="flex items-center gap-3">
                    <input type="checkbox" checked={on} onChange={() => toggle(item._id)} className="w-4 h-4 accent-[#FF4500]" />
                    <span className="font-bold text-white text-sm">{item.name}</span>
                    <span className="text-xs text-zinc-500">{item.category}</span>
                  </span>
                  <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${d > 0 ? 'bg-[#FFB800] text-black' : 'bg-zinc-800 text-zinc-400'}`}>{d > 0 ? `خصم ${d}%` : 'من غير خصم'}</span>
                </label>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-3 items-center border-t border-[#1F0A0E] pt-5">
            <span className="text-white font-bold text-sm">محدد: {selected.length} صنف</span>
            <input
              type="number" min="0" max="100" value={newDiscount} onChange={(e) => setNewDiscount(e.target.value)}
              placeholder="الخصم الجديد %"
              className="bg-[#0A0407] border border-[#1F0A0E] rounded-xl px-3 py-2 text-white text-sm w-40"
            />
            <button type="button" onClick={apply} disabled={saving} className="bg-[#FF4500] hover:bg-[#E03D00] disabled:opacity-60 text-white font-black px-6 py-2.5 rounded-xl">
              {saving ? '...' : '✅ تطبيق الخصم على المحدد'}
            </button>
            <span className="text-zinc-500 text-xs">اكتب 0 لو عايز تشيل الخصم.</span>
          </div>
        </div>
      )}
    </div>
  );
};

const AdminPanel = ({ menuItems, categories, siteSettings, lang, fetchItems, fetchCategories, fetchSettings, token, onUnauthorized, onLogout }) => {
  const t = translations[lang];
  const adminFetch = (path, options = {}) => authRequest(token, path, options, onUnauthorized);

  const [heroImg, setHeroImg] = useState(siteSettings.heroImage);
  const [bannerImg, setBannerImg] = useState(siteSettings.promoBannerImage || '');
  const [titleAr, setTitleAr] = useState(siteSettings.heroTitleAr || '');
  const [titleEn, setTitleEn] = useState(siteSettings.heroTitleEn || '');
  const [logoImg, setLogoImg] = useState(siteSettings.logoImage || '');

  const [deliveryZones, setDeliveryZones] = useState([]);
  const [zoneName, setZoneName] = useState('');
  const [zoneFee, setZoneFee] = useState('');

  const fetchZones = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/zones`);
      setDeliveryZones(await res.json());
    } catch (err) {}
  };
  useEffect(() => { fetchZones(); }, []);

  const handleAddZone = async (e) => {
    e.preventDefault();
    if (!zoneName.trim() || !zoneFee) return;
    try {
      const res = await adminFetch('/api/zones', { method: 'POST', body: JSON.stringify({ name: zoneName.trim(), fee: Number(zoneFee) }) });
      if (res.ok) { setZoneName(''); setZoneFee(''); fetchZones(); }
    } catch (err) {}
  };

  const handleDeleteZone = async (id) => {
    if (!window.confirm("حذف هذه المنطقة؟")) return;
    try { const res = await adminFetch(`/api/zones/${id}`, { method: 'DELETE' }); if (res.ok) fetchZones(); } catch (err) {}
  };

  const compressImage = (file, maxWidth, maxHeight, callback) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width; let height = img.height;
        if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
        else { if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; } }
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        callback(canvas.toDataURL(supportsWebp ? 'image/webp' : 'image/jpeg', 0.78));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleHeroImageUpload = (e) => { if (e.target.files[0]) compressImage(e.target.files[0], 1400, 900, setHeroImg); };
  const handleBannerImageUpload = (e) => { if (e.target.files[0]) compressImage(e.target.files[0], 900, 600, setBannerImg); };
  const handleLogoUpload = (e) => { if (e.target.files[0]) compressImage(e.target.files[0], 300, 300, setLogoImg); };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      const res = await adminFetch('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ heroImage: heroImg, heroTitleAr: titleAr, heroTitleEn: titleEn, logoImage: logoImg, promoBannerImage: bannerImg })
      });
      if (res.ok) { alert("تم تحديث الواجهة واللوجو بنجاح! 🚀🔥"); fetchSettings(); }
    } catch (err) { alert("خطأ أثناء الحفظ"); }
  };

  const [editCatId, setEditCatId] = useState(null);
  const [catName, setCatName] = useState('');

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    if (!catName.trim()) return;
    try {
      const res = editCatId
        ? await adminFetch(`/api/categories/${editCatId}`, { method: 'PUT', body: JSON.stringify({ name: catName.trim() }) })
        : await adminFetch('/api/categories', { method: 'POST', body: JSON.stringify({ name: catName.trim() }) });
      if (res.ok) { setCatName(''); setEditCatId(null); fetchCategories(); }
    } catch (err) {}
  };
  const handleEditCategoryClick = (cat) => { setEditCatId(cat._id); setCatName(cat.name); };
  const handleDeleteCategory = async (id) => {
    if (!window.confirm("Delete?")) return;
    try { const res = await adminFetch(`/api/categories/${id}`, { method: 'DELETE' }); if (res.ok) fetchCategories(); } catch (err) {}
  };
  const handleMoveCategory = async (index, direction) => {
    const newCategories = [...categories];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newCategories.length) return;
    const temp = newCategories[index]; newCategories[index] = newCategories[targetIndex]; newCategories[targetIndex] = temp;
    try {
      await Promise.all(newCategories.map((cat, idx) => adminFetch(`/api/categories/${cat._id}`, { method: 'PUT', body: JSON.stringify({ order: idx }) })));
      fetchCategories();
    } catch (err) {}
  };

  const [editId, setEditId] = useState(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [image, setImage] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [isOffer, setIsOffer] = useState(false);

  const [modifierGroups, setModifierGroups] = useState([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMin, setNewGroupMin] = useState(1);
  const [newGroupMax, setNewGroupMax] = useState(1);
  const [newOptionNames, setNewOptionNames] = useState({});
  const [newOptionPrices, setNewOptionPrices] = useState({});

  const [editingGrp, setEditingGrp] = useState({ gIndex: -1, name: '', min: 0, max: 0 });
  const [editingOpt, setEditingOpt] = useState({ gIndex: -1, oIndex: -1, name: '', price: 0 });
  const [importFromId, setImportFromId] = useState('');

  useEffect(() => {
    if (categories.length > 0 && !category) setCategory(categories[0].name);
  }, [categories, category]);

  const handleAddGroup = () => {
    if (!newGroupName.trim()) return;
    setModifierGroups([...modifierGroups, { name: newGroupName, min: Number(newGroupMin), max: Number(newGroupMax), options: [] }]);
    setNewGroupName(''); setNewGroupMin(1); setNewGroupMax(1);
  };

  const handleAddOption = (gIndex) => {
    const optName = newOptionNames[gIndex];
    const optPrice = newOptionPrices[gIndex] || 0;
    if (!optName?.trim()) return;
    const updatedGroups = [...modifierGroups];
    updatedGroups[gIndex].options.push({ name: optName, price: Number(optPrice) });
    setModifierGroups(updatedGroups);
    setNewOptionNames({ ...newOptionNames, [gIndex]: '' });
    setNewOptionPrices({ ...newOptionPrices, [gIndex]: '' });
  };

  const handleRemoveGroup = (gIndex) => setModifierGroups(modifierGroups.filter((_, idx) => idx !== gIndex));
  const handleRemoveOption = (gIndex, oIndex) => {
    const updatedGroups = [...modifierGroups];
    updatedGroups[gIndex].options = updatedGroups[gIndex].options.filter((_, idx) => idx !== oIndex);
    setModifierGroups(updatedGroups);
  };

  const saveEditedGroup = () => {
    if (!editingGrp.name.trim()) return;
    const updated = [...modifierGroups];
    updated[editingGrp.gIndex] = { ...updated[editingGrp.gIndex], name: editingGrp.name, min: Number(editingGrp.min), max: Number(editingGrp.max) };
    setModifierGroups(updated);
    setEditingGrp({ gIndex: -1, name: '', min: 0, max: 0 });
  };

  const saveEditedOption = () => {
    if (!editingOpt.name.trim()) return;
    const updated = [...modifierGroups];
    updated[editingOpt.gIndex].options[editingOpt.oIndex] = { name: editingOpt.name, price: Number(editingOpt.price) };
    setModifierGroups(updated);
    setEditingOpt({ gIndex: -1, oIndex: -1, name: '', price: 0 });
  };

  const handleImportModifiers = () => {
    if (!importFromId) return alert("اختار الصنف الأول من القائمة!");
    const sourceItem = menuItems.find(i => i._id === importFromId);
    if (sourceItem && sourceItem.modifierGroups && sourceItem.modifierGroups.length > 0) {
      setModifierGroups(JSON.parse(JSON.stringify(sourceItem.modifierGroups)));
      alert("تم استيراد الاختيارات بنجاح! 🎉");
    } else {
      alert("الصنف ده مفيهوش اختيارات متسجلة عشان تنسخها!");
    }
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    const itemData = {
      name, price: Number(price), discount: Number(discount) || 0,
      image: image || "https://via.placeholder.com/400x300/0D0507/FF4500?text=Noss+Kofta",
      description, category: category || (categories.length > 0 ? categories[0].name : 'General'),
      isOffer, modifierGroups
    };
    try {
      const res = editId
        ? await adminFetch(`/api/items/${editId}`, { method: 'PUT', body: JSON.stringify(itemData) })
        : await adminFetch('/api/items', { method: 'POST', body: JSON.stringify(itemData) });
      if (res.ok) { resetForm(); fetchItems(); alert("تم حفظ الصنف بنجاح! 🚀"); }
    } catch (err) {}
  };

  const handleEditItemClick = (item) => {
    setEditId(item._id); setName(item.name); setPrice(item.price); setDiscount(item.discount || '');
    setImage(item.image); setDescription(item.description || ''); setCategory(item.category);
    setIsOffer(item.isOffer || false);

    if (item.modifierGroups && item.modifierGroups.length > 0) {
      setModifierGroups(JSON.parse(JSON.stringify(item.modifierGroups)));
    } else {
      let migratedGroups = [];
      if (item.sizes && item.sizes.length > 0) migratedGroups.push({ name: "اختر الحجم", min: 1, max: 1, options: item.sizes });
      if (item.addons && item.addons.length > 0) migratedGroups.push({ name: "الإضافات الاختيارية", min: 0, max: item.addons.length, options: item.addons });
      setModifierGroups(migratedGroups);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const resetForm = () => {
    setEditId(null); setName(''); setPrice(''); setDiscount(''); setImage(''); setDescription(''); setIsOffer(false); setModifierGroups([]); setImportFromId('');
    if (categories.length > 0) setCategory(categories[0].name);
  };

  const handleDeleteItem = async (id) => {
    if (!window.confirm("Delete item?")) return;
    try { const res = await adminFetch(`/api/items/${id}`, { method: 'DELETE' }); if (res.ok) fetchItems(); } catch (err) {}
  };

  const handleToggleAvailable = async (item) => {
    try {
      const res = await adminFetch(`/api/items/${item._id}/availability`, { method: 'PUT', body: JSON.stringify({ available: item.available === false }) });
      if (res.ok) fetchItems();
    } catch (err) {}
  };

  const handleMoveItem = async (catName, index, direction) => {
    const catItems = menuItems.filter(item => item.category === catName).sort((a, b) => (a.order || 0) - (b.order || 0));
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= catItems.length) return;

    const reordered = [...catItems];
    const tmp = reordered[index]; reordered[index] = reordered[targetIndex]; reordered[targetIndex] = tmp;
    try {
      await Promise.all(reordered.map((itm, idx) => adminFetch(`/api/items/${itm._id}`, { method: 'PUT', body: JSON.stringify({ order: idx }) })));
      fetchItems();
    } catch (err) {}
  };

  const renderItemCard = (item, itemIndex, list) => (
    <div key={item._id} className="bg-[#050304] border border-[#1F0A0E] p-4 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1 bg-[#100609] px-2 py-1.5 rounded-lg border border-[#1F0A0E]">
          <button type="button" onClick={() => handleMoveItem(item.category, itemIndex, 'up')} disabled={itemIndex === 0} className={`text-xs ${itemIndex === 0 ? 'text-zinc-700' : 'text-[#FFB800] hover:text-white transition'}`}>▲</button>
          <span className="text-zinc-500 font-black text-xs leading-none">{itemIndex + 1}</span>
          <button type="button" onClick={() => handleMoveItem(item.category, itemIndex, 'down')} disabled={itemIndex === list.length - 1} className={`text-xs ${itemIndex === list.length - 1 ? 'text-zinc-700' : 'text-[#FFB800] hover:text-white transition'}`}>▼</button>
        </div>
        <img src={item.image} alt="" loading="lazy" decoding="async" className="w-16 h-12 object-cover rounded-xl bg-[#100609]" />
        <div>
          <h4 className="font-bold text-white">
            {item.name}
            {item.available === false && <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-lg font-black mr-2">⛔ خلص</span>}
            {item.discount > 0 && <span className="bg-[#FF4500] text-white text-xs px-2.5 py-0.5 rounded-lg font-black mr-2">خصم {item.discount}%</span>}
          </h4>
          <span className="text-xs text-[#FFB800]">
            {item.discount > 0 ? `${getDiscountedPrice(item.price, item.discount)} ج (بدل ${item.price})` : `${item.price} ج`}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 md:mt-0 w-full md:w-auto">
        <button onClick={() => handleToggleAvailable(item)} className={`flex-1 md:flex-none px-4 py-2 rounded-xl text-xs font-black text-white ${item.available === false ? 'bg-red-600' : 'bg-green-600'}`}>
          {item.available === false ? '⛔ خلص (شغّله)' : '✅ متاح'}
        </button>
        <button onClick={() => handleEditItemClick(item)} className="flex-1 md:flex-none text-[#FFB800] bg-[#FF4500]/20 px-4 py-2 rounded-xl text-xs font-bold text-center">✏️ تعديل</button>
        <button onClick={() => handleDeleteItem(item._id)} className="flex-1 md:flex-none text-red-400 bg-red-500/10 px-4 py-2 rounded-xl text-xs font-bold text-center">✕ مسح</button>
      </div>
    </div>
  );

  return (
    <section className="px-6 py-12 max-w-5xl mx-auto min-h-[80vh] bg-[#050304] text-white">
      <div className="flex flex-wrap gap-3 justify-between items-center mb-8 border-b border-[#1A0B0E] pb-4">
        <h2 className="text-3xl font-black text-[#FFB800]">⚙️ لوحة الإدارة الذكية</h2>
        <div className="flex items-center gap-4">
          <Link className="text-zinc-400 hover:text-white underline font-bold" to="/cashier">شاشة الكاشير</Link>
          <Link className="text-zinc-400 hover:text-white underline font-bold" to="/menu">{t.menu}</Link>
          <button type="button" onClick={onLogout} className="bg-zinc-700 hover:bg-zinc-600 px-4 py-2 rounded-xl text-sm font-bold text-white">🚪 خروج</button>
        </div>
      </div>

      <StoreHoursPanel adminFetch={adminFetch} />

      <div className="bg-[#100609] p-8 rounded-[2.5rem] border border-[#FF4500]/40 mb-8 shadow-2xl">
        <h3 className="text-xl font-bold text-[#FFB800] mb-4">🚚 إدارة مناطق التوصيل وأسعارها</h3>
        <form onSubmit={handleAddZone} className="flex flex-col md:flex-row gap-4 mb-6">
          <input type="text" placeholder="اسم المنطقة (مثل: الشروق)" value={zoneName} onChange={(e) => setZoneName(e.target.value)} className="flex-1 bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" />
          <input type="number" placeholder="سعر التوصيل (مثل: 30)" value={zoneFee} onChange={(e) => setZoneFee(e.target.value)} className="w-full md:w-40 bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" />
          <button type="submit" className="bg-[#FF4500] text-white font-bold px-8 py-4 rounded-2xl hover:bg-[#E03D00] transition shadow cursor-pointer">➕ إضافة</button>
        </form>
        <div className="space-y-3">
          {deliveryZones.length === 0 ? <p className="text-zinc-500 text-sm">لم يتم إضافة مناطق توصيل بعد.</p> : deliveryZones.map((zone) => (
            <div key={zone._id} className="bg-[#050304] border border-[#1F0A0E] px-5 py-3.5 rounded-2xl flex items-center justify-between text-sm">
              <span className="font-bold text-[#FFB800]">{zone.name} — <span className="text-white">{zone.fee} جنيه</span></span>
              <button onClick={() => handleDeleteZone(zone._id)} className="text-red-400 bg-red-500/10 px-3.5 py-1.5 rounded-xl font-bold text-xs">✕ مسح</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-[#100609] p-8 rounded-[2.5rem] border border-[#FF4500]/40 mb-8 shadow-2xl">
        <h3 className="text-xl font-bold text-[#FFB800] mb-4">🖼️ تحكم في لوجو الموقع وواجهة الرئيسية</h3>
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#050304] p-5 rounded-2xl border border-[#1F0A0E]">
              <label className="block text-sm text-[#FFB800] font-bold mb-2">شعار المطعم (اللوجو)</label>
              <input type="file" accept="image/*" onChange={handleLogoUpload} className="w-full bg-black border border-[#1F0A0E] rounded-xl p-2 text-white text-xs cursor-pointer mb-3" />
              {logoImg && <img src={logoImg} alt="Logo Preview" className="h-16 object-contain bg-black/50 p-2 rounded-lg border border-white/10" />}
            </div>
            <div className="bg-[#050304] p-5 rounded-2xl border border-[#1F0A0E]">
              <label className="block text-sm text-[#FFB800] font-bold mb-2">خلفية الهيدر الثابتة فوق</label>
              <input type="file" accept="image/*" onChange={handleHeroImageUpload} className="w-full bg-black border border-[#1F0A0E] rounded-xl p-2 text-white text-xs cursor-pointer mb-3" />
              {heroImg && <img src={heroImg} alt="Hero Preview" className="h-16 w-full object-cover rounded-lg border border-white/10" />}
            </div>
          </div>

          <div className="bg-[#050304] p-5 rounded-2xl border border-[#FF4500]/30">
            <label className="block text-sm text-[#FFB800] font-bold mb-2">🖼️ صورة العرض الكبيرة (البوستر)</label>
            <input type="file" accept="image/*" onChange={handleBannerImageUpload} className="w-full bg-black border border-[#1F0A0E] rounded-xl p-2 text-white text-xs cursor-pointer mb-3" />
            <div className="flex items-center gap-4">
              {bannerImg && <img src={bannerImg} alt="Banner Preview" className="h-20 w-32 object-cover rounded-xl border border-[#FF4500]" />}
              {bannerImg && <button type="button" onClick={() => setBannerImg('')} className="bg-red-500/20 text-red-400 px-4 py-2 rounded-xl text-xs font-bold border border-red-500/30">🗑️ إزالة البوستر</button>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-300 mb-1">العنوان بالعربي 🔥</label>
              <input type="text" value={titleAr} onChange={(e) => setTitleAr(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" placeholder="أقوى العروض 🔥" />
            </div>
            <div>
              <label className="block text-xs text-zinc-300 mb-1">العنوان بالإنجليزي ⚡</label>
              <input type="text" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" placeholder="Strongest Offers ⚡" />
            </div>
          </div>
          <button type="submit" className="w-full bg-[#FF4500] text-white font-black py-4 rounded-2xl hover:bg-[#E03D00] transition shadow-lg cursor-pointer">💾 حفظ تعديلات اللوجو والواجهة وصورة العرض</button>
        </form>
      </div>

      <div className="bg-[#100609] p-8 rounded-[2.5rem] border border-[#1F0A0E] mb-8 shadow-2xl">
        <h3 className="text-xl font-bold text-[#FFB800] mb-4">{t.catManage}</h3>
        <form onSubmit={handleSaveCategory} className="flex gap-4 mb-6">
          <input type="text" placeholder="Category Name..." value={catName} onChange={(e) => setCatName(e.target.value)} className="flex-1 bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white" />
          <button type="submit" className="bg-[#FF4500] text-white font-bold px-8 py-4 rounded-2xl hover:bg-[#E03D00] transition shadow">{editCatId ? t.save : t.addCat}</button>
          {editCatId && <button type="button" onClick={() => { setEditCatId(null); setCatName(''); }} className="bg-zinc-700 text-white px-5 rounded-2xl font-bold">{t.cancel}</button>}
        </form>
        <div className="space-y-3">
          {categories.map((cat, index) => (
            <div key={cat._id} className="bg-[#050304] border border-[#1F0A0E] px-5 py-4 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-3"><span className="text-zinc-500 font-bold text-sm">#{index + 1}</span><span className="font-bold text-[#FFB800]">{cat.name}</span></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => handleMoveCategory(index, 'up')} disabled={index === 0} className={`px-3 py-1.5 rounded-xl text-sm font-bold ${index === 0 ? 'bg-[#100609] text-zinc-600' : 'bg-[#180A0E] text-[#FF4500] hover:bg-[#1F0A0E]'}`}>◀</button>
                <button type="button" onClick={() => handleMoveCategory(index, 'down')} disabled={index === categories.length - 1} className={`px-3 py-1.5 rounded-xl text-sm font-bold ${index === categories.length - 1 ? 'bg-[#100609] text-zinc-600' : 'bg-[#180A0E] text-[#FF4500] hover:bg-[#1F0A0E]'}`}>▶</button>
                <button onClick={() => handleEditCategoryClick(cat)} className="text-[#FFB800] bg-[#FF4500]/20 px-3.5 py-1.5 rounded-xl text-xs font-bold">✏️</button>
                <button onClick={() => handleDeleteCategory(cat._id)} className="text-red-400 bg-red-500/10 px-3.5 py-1.5 rounded-xl text-xs font-bold">✕</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <form onSubmit={handleSaveItem} className="bg-[#100609] p-8 rounded-[2.5rem] border border-[#1F0A0E] mb-8 grid grid-cols-1 md:grid-cols-2 gap-4 shadow-2xl">
        <h3 className="md:col-span-2 text-2xl font-black text-[#FFB800] mb-2 border-b border-[#1F0A0E] pb-4">{t.itemManage}</h3>
        <div><label className="block text-sm mb-2 text-zinc-300">اسم الصنف *</label><input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white" placeholder="مثال: برجر دبل" /></div>
        <div><label className="block text-sm mb-2 text-zinc-300">السعر الأساسي *</label><input type="number" required value={price} onChange={(e) => setPrice(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white" placeholder="مثال: 150" /></div>
        <div><label className="block text-sm mb-2 text-[#FFB800]">نسبة الخصم %</label><input type="number" placeholder="مثال: 20" value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-full bg-[#050304] border border-[#FF4500]/50 rounded-2xl p-4 text-white" /></div>
        <div><label className="block text-sm mb-2 text-zinc-300">القسم *</label><select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white">{categories.map(cat => (<option key={cat._id} value={cat.name}>{cat.name}</option>))}</select></div>
        <div><label className="block text-sm mb-2 text-zinc-300">صورة الصنف</label><input type="file" accept="image/*" onChange={(e) => { if (e.target.files[0]) compressImage(e.target.files[0], 700, 700, setImage); }} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-1 text-white text-sm cursor-pointer" /></div>

        <div className="md:col-span-2 bg-[#050304] p-4 rounded-2xl border border-[#FF4500]/30 flex items-center gap-3">
          <input type="checkbox" id="isOfferCheck" checked={isOffer} onChange={(e) => setIsOffer(e.target.checked)} className="w-5 h-5 accent-[#FF4500] cursor-pointer" />
          <label htmlFor="isOfferCheck" className="text-[#FFB800] font-bold cursor-pointer">🔥 عرض في الصفحة الرئيسية (اجعل هذا الصنف يظهر كعرض في الواجهة)</label>
        </div>

        <div className="md:col-span-2 bg-[#050304] p-6 rounded-[2rem] border border-[#1F0A0E] mt-4">
          <h4 className="text-xl font-bold text-white mb-4">🛠️ مجموعات الاختيارات والتعديلات (Modifier Groups)</h4>

          <div className="bg-[#180A0E] p-4 rounded-2xl border border-[#FF4500]/30 mb-6 flex flex-col md:flex-row items-end gap-3">
            <div className="flex-1 w-full">
              <label className="block text-sm text-[#FFB800] font-bold mb-2">🔄 توفير للوقت: استيراد الاختيارات من صنف تاني</label>
              <select value={importFromId} onChange={(e) => setImportFromId(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-sm cursor-pointer">
                <option value="">-- اختار صنف عشان تنسخ كل الاختيارات بتاعته --</option>
                {menuItems.filter(i => i.modifierGroups && i.modifierGroups.length > 0).map(item => (<option key={item._id} value={item._id}>{item.name}</option>))}
              </select>
            </div>
            <button type="button" onClick={handleImportModifiers} className="bg-[#FF4500] text-white px-6 py-3 rounded-xl font-bold text-sm h-[46px] hover:bg-[#E03D00] shadow-lg w-full md:w-auto">استيراد الأن</button>
          </div>

          <p className="text-zinc-400 text-sm mb-6 border-t border-[#1F0A0E] pt-4">لو الحد الأدنى (Min) = 1، المجموعة دي هتبقى إجباري على العميل. ولو (Min) = 0 هتبقى اختياري.</p>

          <div className="flex flex-wrap gap-2 mb-6 items-end bg-[#100609] p-4 rounded-2xl border border-[#1F0A0E]">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs text-zinc-400 mb-1">اسم المجموعة (مثال: Sandwich أو بدون)</label>
              <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-sm" />
            </div>
            <div className="w-24">
              <label className="block text-xs text-[#FFB800] font-bold mb-1">الحد الأدنى (Min)</label>
              <input type="number" min="0" value={newGroupMin} onChange={(e) => setNewGroupMin(e.target.value)} className="w-full bg-[#050304] border border-[#FF4500]/50 rounded-xl p-3 text-white text-sm font-bold" />
            </div>
            <div className="w-24">
              <label className="block text-xs text-[#FFB800] font-bold mb-1">الحد الأقصى (Max)</label>
              <input type="number" min="1" value={newGroupMax} onChange={(e) => setNewGroupMax(e.target.value)} className="w-full bg-[#050304] border border-[#FF4500]/50 rounded-xl p-3 text-white text-sm font-bold" />
            </div>
            <button type="button" onClick={handleAddGroup} className="bg-zinc-800 text-white px-6 py-3 rounded-xl font-bold text-sm h-[46px] hover:bg-zinc-700 shadow-lg">➕ إضافة مجموعة</button>
          </div>

          <div className="space-y-6">
            {modifierGroups.map((group, gIndex) => (
              <div key={gIndex} className="bg-[#100609] p-5 rounded-2xl border border-[#FF4500]/20 relative mt-8">
                <div className="absolute -top-3 left-4 flex gap-2">
                  <button type="button" onClick={() => setEditingGrp({ gIndex, name: group.name, min: group.min, max: group.max })} className="bg-[#FFB800] text-black px-3 py-1 rounded-lg text-xs font-bold shadow-lg">✏️ تعديل المجموعة</button>
                  <button type="button" onClick={() => handleRemoveGroup(gIndex)} className="bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-bold shadow-lg">🗑️ حذف المجموعة</button>
                </div>

                {editingGrp.gIndex === gIndex ? (
                  <div className="flex flex-wrap gap-2 mb-4 items-end bg-[#050304] p-3 rounded-xl border border-[#FFB800]">
                    <div className="flex-1 min-w-[150px]">
                      <label className="text-xs text-zinc-400 block mb-1">تعديل الاسم</label>
                      <input value={editingGrp.name} onChange={e => setEditingGrp({ ...editingGrp, name: e.target.value })} className="w-full bg-[#100609] border border-[#1F0A0E] rounded p-2 text-white text-sm focus:border-[#FFB800] outline-none" />
                    </div>
                    <div className="w-16">
                      <label className="text-xs text-zinc-400 block mb-1">أدنى</label>
                      <input type="number" value={editingGrp.min} onChange={e => setEditingGrp({ ...editingGrp, min: e.target.value })} className="w-full bg-[#100609] border border-[#1F0A0E] rounded p-2 text-white text-sm text-center" />
                    </div>
                    <div className="w-16">
                      <label className="text-xs text-zinc-400 block mb-1">أقصى</label>
                      <input type="number" value={editingGrp.max} onChange={e => setEditingGrp({ ...editingGrp, max: e.target.value })} className="w-full bg-[#100609] border border-[#1F0A0E] rounded p-2 text-white text-sm text-center" />
                    </div>
                    <button type="button" onClick={saveEditedGroup} className="bg-[#25D366] text-black px-4 py-2 rounded font-bold text-sm h-[38px]">حفظ</button>
                    <button type="button" onClick={() => setEditingGrp({ gIndex: -1, name: '', min: 0, max: 0 })} className="bg-zinc-700 text-white px-4 py-2 rounded font-bold text-sm h-[38px]">إلغاء</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mb-1 mt-2">
                      <h5 className="font-bold text-[#FFB800] text-lg">{group.name}</h5>
                      {group.min > 0 ? (
                        <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded border border-red-500/30">إجباري</span>
                      ) : (
                        <span className="bg-zinc-800 text-zinc-400 text-xs px-2 py-0.5 rounded border border-zinc-700">اختياري</span>
                      )}
                    </div>
                    <p className="text-zinc-500 text-xs mb-4">الحد الأدنى: {group.min} | الحد الأقصى: {group.max}</p>
                  </>
                )}

                <div className="flex gap-2 mb-4 items-end border-b border-[#1F0A0E] pb-4">
                  <input type="text" placeholder="اسم الخيار الجديد (مثال: بدون جبنة)" value={newOptionNames[gIndex] || ''} onChange={(e) => setNewOptionNames({ ...newOptionNames, [gIndex]: e.target.value })} className="flex-1 bg-[#050304] border border-[#1F0A0E] rounded-xl p-2.5 text-white text-sm" />
                  <input type="number" placeholder="السعر الإضافي (0 لو مجاني)" value={newOptionPrices[gIndex] || ''} onChange={(e) => setNewOptionPrices({ ...newOptionPrices, [gIndex]: e.target.value })} className="w-32 bg-[#050304] border border-[#1F0A0E] rounded-xl p-2.5 text-white text-sm" />
                  <button type="button" onClick={() => handleAddOption(gIndex)} className="bg-zinc-800 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-zinc-700">➕ خيار</button>
                </div>

                {group.options.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
                    {group.options.map((opt, oIndex) => (
                      <div key={oIndex} className={`px-4 py-2 rounded-xl text-sm transition-all ${editingOpt.gIndex === gIndex && editingOpt.oIndex === oIndex ? 'bg-[#100609] border border-[#FFB800]' : 'bg-[#050304] border border-[#1F0A0E] hover:border-zinc-700'}`}>
                        {editingOpt.gIndex === gIndex && editingOpt.oIndex === oIndex ? (
                          <div className="flex gap-2 items-center w-full">
                            <input value={editingOpt.name} onChange={e => setEditingOpt({ ...editingOpt, name: e.target.value })} className="flex-1 bg-black border border-[#1F0A0E] rounded p-1 text-white text-xs outline-none focus:border-[#FFB800]" placeholder="الاسم" />
                            <input type="number" value={editingOpt.price} onChange={e => setEditingOpt({ ...editingOpt, price: e.target.value })} className="w-16 bg-black border border-[#1F0A0E] rounded p-1 text-white text-xs outline-none focus:border-[#FFB800] text-center" placeholder="السعر" />
                            <button type="button" onClick={saveEditedOption} className="text-[#25D366] font-bold text-xs bg-[#25D366]/10 px-2 py-1 rounded">حفظ</button>
                            <button type="button" onClick={() => setEditingOpt({ gIndex: -1, oIndex: -1, name: '', price: 0 })} className="text-zinc-500 font-bold text-xs bg-zinc-800 px-2 py-1 rounded">✕</button>
                          </div>
                        ) : (
                          <div className="flex justify-between items-center w-full">
                            <span className="font-medium">{opt.name} {opt.price > 0 && <span className="text-[#FFB800]">(+{opt.price} ج)</span>}</span>
                            <div className="flex gap-1.5">
                              <button type="button" onClick={() => setEditingOpt({ gIndex, oIndex, name: opt.name, price: opt.price })} className="text-[#FFB800] bg-[#FFB800]/10 hover:bg-[#FFB800]/20 w-7 h-7 rounded flex items-center justify-center transition">✏️</button>
                              <button type="button" onClick={() => handleRemoveOption(gIndex, oIndex)} className="text-red-400 bg-red-500/10 hover:bg-red-500/20 w-7 h-7 rounded flex items-center justify-center transition">✕</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm mb-2 text-[#FFB800] font-bold">وصف الصنف *</label>
          <textarea rows="3" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white" placeholder="طعم ولا في الخيال..." />
        </div>

        <div className="md:col-span-2 mt-4 flex gap-4">
          <button type="submit" className="flex-1 bg-[#FF4500] text-white font-bold py-4 rounded-2xl hover:bg-[#E03D00] transition shadow-lg">{editId ? t.save : t.addItem}</button>
          {editId && <button type="button" onClick={resetForm} className="bg-zinc-700 text-white px-6 rounded-2xl font-bold">{t.cancel}</button>}
        </div>
      </form>

      <BulkDiscountPanel menuItems={menuItems} categories={categories} adminFetch={adminFetch} fetchItems={fetchItems} />
      <ImageOptimizerPanel menuItems={menuItems} siteSettings={siteSettings} adminFetch={adminFetch} fetchItems={fetchItems} fetchSettings={fetchSettings} />

      <div className="space-y-12 mt-12">
        <h3 className="text-2xl font-bold text-[#FFB800] border-b border-[#1A0B0E] pb-3">📋 إدارة وترتيب الأصناف حسب الأقسام</h3>
        {categories.map(cat => {
          const catItems = menuItems.filter(item => item.category === cat.name).sort((a, b) => (a.order || 0) - (b.order || 0));
          return (
            <div key={cat._id} className="bg-[#100609] border border-[#1F0A0E] rounded-[2.5rem] p-8 shadow-2xl">
              <h4 className="text-xl font-black text-[#FFB800] mb-6 border-r-4 border-[#FF4500] pr-4">📁 قسم: {cat.name} ({catItems.length} صنف)</h4>
              {catItems.length === 0 ? <p className="text-zinc-500 text-sm">لا توجد أصناف في هذا القسم حالياً.</p> : <div className="space-y-4">{catItems.map((item, itemIndex) => renderItemCard(item, itemIndex, catItems))}</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const AdminDashboard = (props) => {
  const [session, setSession] = useState(readSession);
  const handleLogout = () => { clearSession(); setSession(null); };

  if (!session?.token || session.user?.role !== 'admin') {
    return <StaffLogin title="🔒 دخول لوحة الإدارة" requireAdmin onLogin={(data) => { saveSession(data); setSession(data); }} />;
  }
  return <AdminPanel {...props} token={session.token} onUnauthorized={handleLogout} onLogout={handleLogout} />;
};

// ================= 4. صفحة السلة =================
const CartPage = ({ cart, setCart, lang, storeStatus }) => {
  const t = translations[lang];
  const itemsTotal = cart.reduce((sum, item) => sum + item.price, 0);
  const [orderType, setOrderType] = useState('delivery');
  const [deliveryZones, setDeliveryZones] = useState([]);
  const [selectedZone, setSelectedZone] = useState(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [placedOrderId, setPlacedOrderId] = useState(null);
  const storeClosed = !!(storeStatus && storeStatus.isOpen === false);

  useEffect(() => {
    fetch(`${API_BASE}/api/zones`).then(res => res.json()).then(data => { setDeliveryZones(data); if (data.length > 0) setSelectedZone(data[0]); }).catch(err => {});
  }, []);

  // Meta Pixel: العميل فتح السلة وفيها أصناف
  useEffect(() => {
    if (cart.length > 0) track('InitiateCheckout', { value: itemsTotal, currency: 'EGP', num_items: cart.length });
  }, []);

  const deliveryFee = orderType === 'delivery' && selectedZone ? selectedZone.fee : 0;
  const grandTotal = itemsTotal + deliveryFee;

  const handleRemoveCompletely = (cartId) => { setCart(cart.filter(i => i.cartId !== cartId)); };

  // نجمّع الأصناف المتطابقة بالظبط (نفس الصنف ونفس الاختيارات والملاحظات) في سطر واحد بعدد
  const cartKey = (i) => [i._id, i.name, i.price, (i.modifiersInfo || []).join('¦'), i.notes || ''].join('|');
  const groupedCart = (() => {
    const map = new Map();
    cart.forEach((i) => {
      const k = cartKey(i);
      if (!map.has(k)) map.set(k, { key: k, item: i, qty: 0, ids: [] });
      const g = map.get(k);
      g.qty += 1;
      g.ids.push(i.cartId);
    });
    return [...map.values()];
  })();
  const addOneMore = (g) => setCart([...cart, { ...g.item, cartId: Date.now() + Math.random() }]);
  const removeOne = (g) => { const id = g.ids[g.ids.length - 1]; setCart(cart.filter(i => i.cartId !== id)); };
  const removeGroup = (g) => setCart(cart.filter(i => !g.ids.includes(i.cartId)));

  const sendOrderToWhatsApp = async () => {
    if (cart.length === 0) return alert("السلة فارغة!");
    if (!customerName.trim()) return alert("من فضلك اكتب اسمك الكامل.");
    if (!customerPhone.trim() || customerPhone.length !== 11 || isNaN(customerPhone)) return alert("من فضلك اكتب رقم تليفون صحيح مكون من 11 رقم.");
    if (orderType === 'delivery' && !customerAddress.trim()) return alert("من فضلك اكتب عنوان الاستلام بالتفصيل.");

    const waWindow = window.open('', '_blank');

    // لو الموقع اتقفل (يدوي أو حسب المواعيد) نوقف الطلب قبل ما يتبعت
    try {
      const sr = await fetch(`${API_BASE}/api/store-status`, { cache: 'no-store' });
      const st = await sr.json();
      if (st && st.isOpen === false) { if (waWindow) waWindow.close(); return alert(st.message); }
    } catch (err) {}

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

    const orderId = 'BB-' + Date.now().toString().slice(-4) + Math.floor(10 + Math.random() * 90);

    const orderPayload = {
      orderId, customerName, customerPhone, orderType,
      customerAddress: orderType === 'delivery' ? customerAddress : 'استلام من الفرع',
      zoneName: orderType === 'delivery' && selectedZone ? selectedZone.name : 'استلام من الفرع',
      deliveryFee: orderType === 'delivery' ? deliveryFee : 0,
      items: groupedCart.map((g) => ({
        itemId: g.item._id, name: g.item.name, price: g.item.price, quantity: g.qty,
        selections: Array.isArray(g.item.modifierSelections) ? g.item.modifierSelections : undefined,
        modifiers: g.item.modifiersInfo || [], notes: g.item.notes || ''
      })),
      itemsTotal, grandTotal
    };

    let savedOrder = null;
    try {
      const response = await fetch(`${API_BASE}/api/orders`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(orderPayload)
      });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (waWindow) waWindow.close();
        return alert(responseData.error || 'ماقدرناش نسجل الأوردر. راجع المنيو وحاول تاني.');
      }
      savedOrder = responseData.order;
      if (!savedOrder || !Array.isArray(savedOrder.items)) {
        if (waWindow) waWindow.close();
        return alert('السيرفر ما رجعش تفاصيل الأوردر المعتمدة. حاول تاني.');
      }
    } catch (err) {
      console.error('Network error while saving order:', err);
      if (waWindow) waWindow.close();
      return alert('تعذر الاتصال بالسيرفر، والأوردر ما اتسجلش. اتأكد من النت وحاول تاني.');
    }

    const savedOrderId = savedOrder.orderId || orderId;
    const savedItems = savedOrder.items;
    const savedItemsTotal = Number(savedOrder.itemsTotal) || 0;
    const savedDeliveryFee = Number(savedOrder.deliveryFee) || 0;
    const savedGrandTotal = Number(savedOrder.grandTotal) || 0;

    let message = `🍔 أهلاً (نص كفتة)، عندي أوردر جديد!\n🆔 *رقم الأوردر:* #${savedOrderId}\n\n👤 *الاسم:* ${savedOrder.customerName || customerName}\n📞 *التليفون:* ${savedOrder.customerPhone || customerPhone}\n📦 *نوع الاستلام:* ${savedOrder.orderType === 'delivery' ? 'توصيل دليفري 🛵' : 'استلام من الفرع 🏪'}\n`;
    if (savedOrder.orderType === 'delivery') {
      message += `📍 *العنوان:* ${savedOrder.customerAddress || customerAddress}\n`;
      message += `🚚 *منطقة التوصيل:* ${savedOrder.zoneName || selectedZone?.name || 'توصيل'} (${savedDeliveryFee} ج)\n`;
    }
    message += `\n🛒 *الأصناف المطلوبة:*\n`;
    savedItems.forEach((item) => {
      const qty = Number(item.quantity) || 1;
      const unitPrice = Number(item.price) || 0;
      message += `▪️ ${qty}× ${item.name} — (${unitPrice} ج${qty > 1 ? ` × ${qty} = ${unitPrice * qty} ج` : ''})\n`;
      if (Array.isArray(item.modifiers) && item.modifiers.length > 0) item.modifiers.forEach(mod => { message += `   - ${stripMoney(mod)}\n`; });
      if (item.notes) message += `   📝 ملاحظات: ${item.notes}\n`;
    });
    message += `\n-------------------\n🏷️ *قيمة الأصناف:* ${savedItemsTotal} ج\n`;
    if (savedOrder.orderType === 'delivery') message += `🚚 *سعر التوصيل:* ${savedDeliveryFee} ج\n`;
    message += `💰 *الإجمالي النهائي: ${savedGrandTotal} جنيه*\n`;
    // Meta Pixel: تم إرسال الأوردر (الـ orderId بيمنع تسجيل نفس الأوردر مرتين)
    track('Purchase', { value: savedGrandTotal, currency: 'EGP', content_type: 'product', content_ids: savedItems.map(item => String(item.itemId || item._id || '')), num_items: savedItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) }, savedOrderId);

    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
    if (waWindow) waWindow.location.href = whatsappUrl;
    else window.location.href = whatsappUrl;

    setCart([]);
    setPlacedOrderId(savedOrderId);
  };

  if (placedOrderId) {
    return (
      <section className="px-6 py-12 max-w-4xl mx-auto min-h-[60vh] bg-[#050304] text-white flex flex-col items-center justify-center">
        <div className="bg-[#100609] border border-[#25D366] rounded-[2.5rem] p-12 text-center shadow-[0_0_35px_rgba(37,211,102,0.2)] w-full">
          <div className="text-7xl mb-4">✅</div><h2 className="text-3xl font-black text-[#25D366] mb-4">تم إرسال طلبك بنجاح!</h2>
          <div className="bg-[#050304] border-2 border-[#FFB800] text-[#FFB800] text-4xl font-black py-4 px-8 rounded-2xl inline-block mb-8">{placedOrderId}</div>
          <p className="text-sm text-zinc-400 mb-8">تم تحويلك للواتساب لإرسال الطلب للمطعم.</p>
          <button onClick={() => setPlacedOrderId(null)} className="text-white bg-[#FF4500] px-8 py-4 rounded-2xl font-bold transition">رجوع للسلة</button>
        </div>
      </section>
    );
  }

  return (
    <section className="px-6 py-12 max-w-4xl mx-auto min-h-screen bg-[#050304] text-white">
      <h2 className="text-3xl font-black text-[#FFB800] mb-8 border-b border-[#1A0B0E] pb-4">{t.cart}</h2>
      {cart.length === 0 ? (
        <div className="border border-[#1F0A0E] bg-[#100609] rounded-[2.5rem] p-16 text-center">
          <h2 className="text-2xl font-bold text-zinc-400 mb-4">{t.emptyCart}</h2>
          <Link to="/menu" className="text-[#FFB800] underline hover:text-white">{t.backToMenu}</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-[#100609] rounded-[2.5rem] p-8 border border-[#1F0A0E]">
            <h3 className="text-xl font-bold text-[#FFB800] mb-6">محتويات السلة</h3>
            <div className="space-y-4 max-h-[320px] overflow-y-auto pr-2">
              {groupedCart.map((g) => {
                const item = g.item;
                return (
                  <div key={g.key} className="flex justify-between items-start border-b border-[#1F0A0E] pb-4">
                    <div className="flex-1">
                      <h4 className="text-base font-bold text-white">{g.qty > 1 && <span className="text-[#FF4500] font-black ml-1">{g.qty}×</span>} {item.name}</h4>
                      {item.modifiersInfo && item.modifiersInfo.map((mod, idx) => (<p key={idx} className="text-xs text-zinc-400">- {stripMoney(mod)}</p>))}
                      {item.notes && <p className="text-xs text-[#FFB800] mt-1">📝 {item.notes}</p>}
                      <p className="text-[#FFB800] font-bold text-sm mt-1">
                        {item.price * g.qty} ج{g.qty > 1 && <span className="text-zinc-500 font-normal text-xs"> ({item.price} ج للواحد)</span>}
                      </p>
                      <div className="inline-flex items-center border border-[#FF4500]/60 mt-2 rounded-lg overflow-hidden">
                        <button type="button" onClick={() => removeOne(g)} className="w-8 h-8 text-lg font-black hover:bg-[#FF4500]">−</button>
                        <span className="min-w-[2rem] text-center font-black text-sm">{g.qty}</span>
                        <button type="button" onClick={() => addOneMore(g)} className="w-8 h-8 text-lg font-black hover:bg-[#FF4500]">+</button>
                      </div>
                    </div>
                    <button onClick={() => removeGroup(g)} className="text-red-400 bg-red-500/10 px-3 py-2 rounded-xl text-xs font-bold ml-3">❌</button>
                  </div>
                );
              })}
            </div>
            <div className="mt-6 pt-4 border-t border-[#1F0A0E] space-y-2 text-sm text-zinc-300">
              <div className="flex justify-between"><span>سعر الأصناف:</span><span className="font-bold text-white">{itemsTotal} ج</span></div>
              {orderType === 'delivery' && <div className="flex justify-between"><span>سعر التوصيل:</span><span className="font-bold text-[#FFB800]">{deliveryFee} ج</span></div>}
            </div>
            <div className="mt-4 pt-4 border-t-2 border-[#FF4500] flex justify-between items-center"><span className="text-lg font-bold">{t.total}</span><span className="text-2xl font-black text-[#FFB800]">{grandTotal} جنيه</span></div>
          </div>
          <div className="bg-[#100609] rounded-[2.5rem] p-8 border border-[#1F0A0E] flex flex-col justify-between">
            <div className="space-y-4">
              <h3 className="text-xl font-bold text-[#FFB800] mb-2">بيانات التوصيل والاستلام</h3>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <button type="button" onClick={() => setOrderType('delivery')} className={`py-4 rounded-2xl font-bold text-sm transition ${orderType === 'delivery' ? 'bg-[#FF4500] text-white border border-[#FF4500]' : 'bg-[#050304] text-zinc-400 border border-[#1F0A0E]'}`}>🛵 توصيل دليفري</button>
                <button type="button" onClick={() => setOrderType('pickup')} className={`py-4 rounded-2xl font-bold text-sm transition ${orderType === 'pickup' ? 'bg-[#FF4500] text-white border border-[#FF4500]' : 'bg-[#050304] text-zinc-400 border border-[#1F0A0E]'}`}>🏪 استلام من الفرع</button>
              </div>
              <div><label className="block text-xs text-zinc-300 mb-1">الاسم الكامل *</label><input type="text" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" /></div>
              <div><label className="block text-xs text-zinc-300 mb-1">رقم التليفون (11 رقم) *</label><input type="text" maxLength="11" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, ''))} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" /></div>
              {orderType === 'delivery' && (
                <>
                  <div><label className="block text-xs text-zinc-300 mb-1">منطقة التوصيل *</label><select value={selectedZone?._id || ''} onChange={(e) => setSelectedZone(deliveryZones.find(z => z._id === e.target.value))} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm cursor-pointer">{deliveryZones.map(z => (<option key={z._id} value={z._id}>{z.name} ({z.fee} ج)</option>))}</select></div>
                  <div><label className="block text-xs text-zinc-300 mb-1">العنوان بالتفصيل *</label><textarea value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} className="w-full bg-[#050304] border border-[#1F0A0E] rounded-2xl p-4 text-white text-sm" /></div>
                </>
              )}
            </div>
            {storeClosed && (
              <div className="mt-6 bg-red-500/10 border border-red-500/40 text-red-300 rounded-2xl p-4 text-sm font-bold text-center leading-relaxed">🌙 {storeStatus.message}</div>
            )}
            <button onClick={sendOrderToWhatsApp} disabled={storeClosed} className={`w-full font-black text-lg py-4 rounded-2xl mt-4 ${storeClosed ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-[#25D366] text-black'}`}>{storeClosed ? '🌙 الطلب مقفول دلوقتي' : t.whatsappOrder}</button>
          </div>
        </div>
      )}
    </section>
  );
};

// ================= مساعدات الأرشيف والشيفت =================
const dayKeyOf = (v) => {
  const d = new Date(v);
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
    if (o.orderType === 'talabat') {
      talabat += amount;
      if (o.paymentMethod === 'cash') { talabatCash += amount; payments.cash = (payments.cash || 0) + amount; }
      else { talabatVisa += amount; }
      return;
    }
    const k = o.paymentMethod || 'cash';
    payments[k] = (payments[k] || 0) + amount;
  });
  return { payments, talabat, talabatCash, talabatVisa, discounts };
};
const sumOrders = (list) => ({
  count: list.length,
  total: list.reduce((sum, o) => sum + (Number(o.grandTotal) || 0), 0),
  delivery: list.reduce((sum, o) => sum + (Number(o.deliveryFee) || 0), 0),
  ...paySplit(list)
});

// ================= أدوات الورديات والتقارير =================
const money = (n) => `${Math.round((Number(n) || 0) * 100) / 100} ج`;
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
const printForClosed = (c, title = 'تقفيل وردية (Z)') => makePrint(title, c.report || legacyReport(c), {
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
const ReportBody = ({ order }) => {
  const r = order.report || {};
  const m = order.meta || {};
  const pays = r.payments || {};
  const row = (label, value, cls = '') => <div className={`rc-row ${cls}`}><span>{label}</span><span>{value}</span></div>;
  const hasDrawer = r.openingCash !== undefined || m.countedCash !== undefined;

  return (
    <>
      <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">{order.title}</p></div>
      <div className="rc-line" />
      <div>من: {fmtDT(r.from)}</div>
      <div>إلى: {fmtDT(r.to)}</div>
      {r.openedBy && <div>فتحها: {r.openedBy}</div>}
      {m.closedBy && <div>قفلها: {m.closedBy}</div>}
      <div className="rc-line" />

      {row('عدد الأوردرات', r.count || 0)}
      {row('إجمالي المبيعات', money(r.total), 'rc-total')}
      {r.netSales !== undefined && row('صافي المبيعات (Net Sales)', money(r.netSales), 'rc-total')}
      {row('منها رسوم توصيل', money(r.delivery))}
      {Number(r.discounts) > 0 && row('إجمالي الخصومات', money(r.discounts))}
      {Number(r.cancelled) > 0 && row(`أوردرات ملغية (${r.cancelled})`, money(r.cancelledTotal))}
      <div className="rc-line" />

      <div className="rc-big rc-center">طرق الدفع</div>
      {row('كاش من غير طلبات', money(Math.max(0, (pays.cash || 0) - (r.talabatCash || 0))))}
      {['visa', 'instapay', 'wallet'].map(k => row(PAY_LABELS[k], money(pays[k] || 0)))}
      {r.talabatCash !== undefined || r.talabatVisa !== undefined ? (
        <>
          {row('طلبات كاش (داخل الدرج)', money(r.talabatCash))}
          {row('طلبات فيزا (مستحقات)', money(r.talabatVisa))}
        </>
      ) : row('طلبات (تفصيل الدفع القديم غير متاح)', money(r.talabat))}

      {hasDrawer && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">حساب الدرج (كاش)</div>
          {row('رصيد الافتتاح', money(r.openingCash))}
          {row('+ مبيعات كاش', money(pays.cash || 0))}
          {Number(r.cashIn) > 0 && row('+ إيداعات', money(r.cashIn))}
          {Number(r.cashOut) > 0 && row('- مصروفات', money(r.cashOut))}
          {Number(r.driverCash) > 0 && row('- كاش في عهدة السواقين', money(r.driverCash))}
          {row('المتوقع في الدرج', money(m.expectedCash ?? r.expectedCash), 'rc-big')}
          {m.countedCash !== undefined && m.countedCash !== null && row('المعدود فعلاً', money(m.countedCash), 'rc-big')}
          {m.notes && row('ملاحظات التقفيل', m.notes)}
        </>
      )}

      {(r.movements || []).length > 0 && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">حركات الدرج</div>
          {r.movements.map((mv, i) => <div key={i} className="rc-row rc-small"><span>{mv.type === 'in' ? '+' : '-'} {mv.reason} ({mv.by})</span><span>{money(mv.amount)}</span></div>)}
        </>
      )}

      {Object.keys(r.byType || {}).length > 0 && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">حسب نوع الأوردر</div>
          {Object.entries(r.byType).map(([k, v]) => row(`${TYPE_LABELS[k] || k} (${v.count})`, money(v.total)))}
        </>
      )}

      {Object.keys(r.byCashier || {}).length > 0 && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">حسب الكاشير</div>
          {Object.entries(r.byCashier).map(([k, v]) => row(`${k} (${v.count})`, `${money(v.total)} · خصومات ${money(v.discounts || 0)}`))}
        </>
      )}

      {(r.categories || []).length > 0 && (
        <>
          <div className="rc-line" />
          <div className="rc-big rc-center">📦 جرد الأصناف المباعة</div>
          {r.categories.map((c, i) => (
            <div key={i} style={{ marginTop: 6 }}>
              <div className="rc-row rc-big"><span>{c.name}</span><span>{c.qty} قطعة</span></div>
              {(c.items || []).map((it, j) => <div key={j} className="rc-row rc-small"><span>{it.name}</span><span>× {it.qty}</span></div>)}
            </div>
          ))}
        </>
      )}

      {m.notes && (<><div className="rc-line" /><div>ملاحظات: {m.notes}</div></>)}
      <div className="rc-line" />
      <div className="rc-center rc-sub">طُبع: {fmtDT(order.createdAt)}</div>
    </>
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

      {type === 'report' ? (
        <ReportBody order={order} />
      ) : type === 'kitchen-summary' ? (
        <>
          <div className="rc-center"><h1 className="rc-title">{RESTAURANT_NAME}</h1><p className="rc-big">تقرير المطبخ - جرد الوردية</p></div>
          <div className="rc-line" />
          <div>من: {fmtDT(order.report?.from)}</div>
          <div>إلى: {fmtDT(order.report?.to)}</div>
          <div>الكاشير: {order.meta?.closedBy || order.report?.openedBy || '-'}</div>
          <div className="rc-line" />
          <div className="rc-row rc-big"><span>عدد الأوردرات</span><span>{order.report?.count || 0}</span></div>
          <div className="rc-row rc-total"><span>Net Sales</span><span>{money(order.report?.netSales ?? order.report?.total ?? 0)}</span></div>
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
          <div className="rc-center rc-big">🍳 أوردر المطبخ</div>
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
          <div className="rc-line" />
          <div className="rc-row"><span>المجموع</span><span>{subtotal} ج</span></div>
          {discount > 0 && <div className="rc-row"><span>خصم {order.discountPercent}%</span><span>- {discount} ج</span></div>}
          {isDelivery && <div className="rc-row"><span>التوصيل</span><span>{fee} ج</span></div>}
          <div className="rc-row rc-total"><span>الإجمالي</span><span>{total} ج</span></div>
          {order.paymentMethod && <div className="rc-row"><span>الدفع</span><span>{PAY_LABELS[order.paymentMethod] || order.paymentMethod}</span></div>}
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
    rule('bg-[#050304]', 'background-color:#eceff3'),
    rule('bg-[#100609]', 'background-color:#ffffff'),
    rule('bg-[#180A0E]', 'background-color:#f3f4f6'),
    rule('bg-[#2a120a]', 'background-color:#ffe4d3'),
    rule('bg-[#2b1208]', 'background-color:#fff0e6'),
    rule('bg-red-950', 'background-color:#fee2e2'),
    rule('bg-zinc-800', 'background-color:#e4e4e7'),
    rule('bg-zinc-700', 'background-color:#d4d4d8'),
    rule('bg-zinc-600', 'background-color:#c4c4cc'),
    rule('border-[#1F0A0E]', 'border-color:#d4d4d8'),
    rule('text-white', 'color:#111827'),
    rule('text-zinc-200', 'color:#374151'),
    rule('text-zinc-300', 'color:#374151'),
    rule('text-zinc-400', 'color:#52525b'),
    rule('text-zinc-500', 'color:#71717a'),
    rule('text-zinc-600', 'color:#71717a'),
    rule('text-[#FFB800]', 'color:#b45309'),
    rule('text-orange-200', 'color:#9a3412'),
    rule('text-green-400', 'color:#15803d'),
    rule('text-red-400', 'color:#dc2626'),
    rule('text-red-300', 'color:#dc2626'),
    rule('text-yellow-400', 'color:#a16207'),
    // الأزرار الملونة تفضل نصها أبيض
    rule('bg-[#FF4500]', 'color:#ffffff'),
    rule('bg-green-6', 'color:#ffffff'),
    rule('bg-green-7', 'color:#ffffff'),
    rule('bg-red-6', 'color:#ffffff'),
    rule('bg-red-7', 'color:#ffffff'),
    rule('bg-blue-6', 'color:#ffffff'),
    // الأزرار الشفافة الملونة
    rule('bg-[#FF4500]/', 'color:#9a3412'),
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
      <input type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="مثال: 500" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl px-4 py-3 text-white text-lg text-center" dir="ltr" />
      <button type="button" disabled={busy} onClick={submit} className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-black py-3.5 rounded-xl">{busy ? '...' : '🟢 فتح الوردية'}</button>
    </div>
  );
};

// ================= تبويب الوردية والتقفيل =================
const ShiftPanel = ({ authFetch, isAdmin, shiftData, refreshShift, closedShifts, refreshClosed, requestPrint, activeCount }) => {
  const shift = shiftData?.shift;
  const rep = shiftData?.report;

  const [mv, setMv] = useState({ type: 'out', amount: '', reason: '' });
  const [settleDriver, setSettleDriver] = useState('');
  const [settleAmount, setSettleAmount] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [differenceReason, setDifferenceReason] = useState('');
  const [handoverTo, setHandoverTo] = useState('');
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

  const inp = 'w-full bg-[#050304] border border-[#1F0A0E] rounded-xl px-3 py-2 text-white text-sm';
  const pays = rep?.payments || {};

  const addMovement = async () => {
    const amount = Number(mv.amount);
    if (!(amount > 0)) return alert('اكتب مبلغ صحيح');
    if (mv.reason.trim().length < 2) return alert('اكتب السبب');
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/movement', { method: 'POST', body: JSON.stringify({ type: mv.type, amount, reason: mv.reason.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || 'حصل خطأ'); else { setMv({ type: mv.type, amount: '', reason: '' }); await refreshShift(); }
    } catch (e) {}
    setBusy(false);
  };

  const submitDriverSettlement = async () => {
    const driverName = settleDriver.trim();
    const amount = Number(settleAmount);
    if (!driverName) return alert('اكتب اسم السواق');
    if (!(amount > 0)) return alert('اكتب مبلغ التسوية');
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/driver-settlement', { method: 'POST', body: JSON.stringify({ driverName, amount }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) alert(d.error || 'حصل خطأ');
      else { setSettleAmount(''); await refreshShift(); alert(`تم تسجيل تسوية ${money(amount)} للسواق ${driverName}`); }
    } catch (e) {}
    setBusy(false);
  };

  const doClose = async () => {
    if (!window.confirm('تأكيد تقفيل الوردية؟ هيتم حفظ صافي المبيعات وتقرير الوردية.')) return;
    setBusy(true);
    try {
      const r = await authFetch('/api/shifts/close', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(d.error || 'حصل خطأ أثناء تقفيل الوردية');
      } else {
        const closedReport = d.report || d.reportSnapshot || rep || {};
        const netSales = Number(closedReport.netSales ?? closedReport.total ?? d.total ?? 0);
        const closedMeta = { closedBy: d.closedBy || user?.name || '', closedAt: d.closedAt || new Date().toISOString(), expectedCash: closedReport.expectedCash };
        // اطبع ورقتين منفصلتين: تقرير تقفيل الكاشير، ثم تقرير المطبخ للأصناف والكميات.
        requestPrint(makePrint('تقرير تقفيل الكاشير (Z)', closedReport, closedMeta), 'report');
        requestPrint(makePrint('تقرير المطبخ - جرد الوردية', closedReport, closedMeta), 'kitchen-summary');
        setCloseOpen(false);
        alert(`تم تقفيل الوردية بنجاح\nصافي المبيعات: ${money(netSales)}\nهيتم طباعة تقرير الكاشير وتقرير المطبخ.`);
        setCounted(''); setNotes(''); setDifferenceReason(''); setHandoverTo('');
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
    <div className={`bg-[#100609] border border-[#1F0A0E] rounded-xl px-4 py-3 ${extra}`}>
      <p className="text-xs text-zinc-400 font-bold">{label}</p>
      <p className="text-xl font-black text-[#FFB800] mt-1">{value}</p>
    </div>
  );

  const expected = rep?.expectedCash || 0;
  const diffLive = counted === '' ? null : Number(counted) - expected;

  return (
    <div className="space-y-6">
      {!shift ? (
        <div className="max-w-md mx-auto bg-[#100609] border border-[#FF4500]/50 rounded-2xl p-6 space-y-4">
          <h3 className="text-xl font-black text-[#FFB800] text-center">🕒 مفيش وردية مفتوحة</h3>
          <p className="text-zinc-400 text-sm text-center">افتح وردية عشان تقدر تبيع من الكاشير ويتحسب الدرج والتقارير.</p>
          <OpenShiftForm authFetch={authFetch} onDone={async () => { await refreshShift(); await refreshClosed(); }} pendingHandover={shiftData?.pendingHandover || null} />
        </div>
      ) : (
        <>
          <div className="bg-[#100609] border border-green-600/50 rounded-2xl p-5 flex flex-wrap gap-4 items-center justify-between">
            <div>
              <p className="font-black text-green-400 text-lg">🟢 وردية مفتوحة</p>
              <p className="text-zinc-300 text-sm mt-1">فتحها: <strong className="text-white">{shift.openedBy}</strong> · {fmtDT(shift.openedAt)}</p>
              {isAdmin && <p className="text-zinc-400 text-xs mt-1">رصيد الافتتاح: {money(shift.openingCash)}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={refreshShift} className="bg-zinc-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold">🔄 تحديث</button>
              {isAdmin && <button type="button" onClick={() => rep && requestPrint(makePrint('تقرير الوردية (X) - لحظي', rep, { expectedCash: rep.expectedCash }), 'report')} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold">🖨️ طباعة تقرير X</button>}
              <button type="button" onClick={() => setCloseOpen(true)} className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-xl text-sm font-black">🔒 تقفيل الوردية</button>
            </div>
          </div>

          {rep && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpi('عدد الأوردرات', rep.count)}
                {kpi('صافي المبيعات (Net Sales)', money(rep.netSales ?? rep.total))}
                {isAdmin && kpi('💵 كاش من غير طلبات', money(Math.max(0, (pays.cash || 0) - (rep.talabatCash || 0))))}
                {kpi('💳 فيزا', money(pays.visa || 0))}
                {kpi('📱 انستا باي', money(pays.instapay || 0))}
                {kpi('👛 محفظة', money(pays.wallet || 0))}
                {kpi('🛍️ طلبات كاش (الدرج)', money(rep.talabatCash || 0))}
                {kpi('🛍️ طلبات فيزا (مستحقات)', money(rep.talabatVisa || 0))}
                {kpi('🛵 رسوم توصيل', money(rep.delivery))}
                {kpi('🏷️ خصومات', money(rep.discounts))}
                {kpi(`✖ ملغي (${rep.cancelled})`, money(rep.cancelledTotal))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5 space-y-3">
                  <h4 className="font-black text-[#FFB800] text-lg">💰 حساب الدرج (الكاش)</h4>
                  {isAdmin && <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-zinc-400">رصيد الافتتاح</span><span className="font-bold text-white">{money(rep.openingCash)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">+ مبيعات كاش (شاملة طلبات كاش)</span><span className="font-bold text-white">{money(pays.cash || 0)}</span></div>
                    {Number(rep.driverCash) > 0 && <div className="flex justify-between"><span className="text-zinc-400">- كاش في عهدة السواقين</span><span className="font-bold text-orange-300">{money(rep.driverCash)}</span></div>}
                    <div className="flex justify-between"><span className="text-zinc-400">+ إيداعات</span><span className="font-bold text-green-400">{money(rep.cashIn)}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">- مصروفات / سحب</span><span className="font-bold text-red-400">{money(rep.cashOut)}</span></div>
                    <div className="flex justify-between border-t border-[#1F0A0E] pt-2 text-base"><span className="font-black text-white">المتوقع في الدرج</span><span className="font-black text-[#FFB800]">{money(rep.expectedCash)}</span></div>
                  </div>}

                  <div className="border-t border-[#1F0A0E] pt-3 space-y-2">
                    <p className="text-xs font-bold text-zinc-400">تسجيل حركة في الدرج</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => setMv({ ...mv, type: 'out' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.type === 'out' ? 'bg-red-600 text-white border-red-400' : 'bg-[#050304] text-zinc-400 border-[#1F0A0E]'}`}>➖ مصروف / سحب</button>
                      <button type="button" onClick={() => setMv({ ...mv, type: 'in' })} className={`flex-1 py-2 rounded-lg text-xs font-black border ${mv.type === 'in' ? 'bg-green-600 text-white border-green-400' : 'bg-[#050304] text-zinc-400 border-[#1F0A0E]'}`}>➕ إيداع</button>
                    </div>
                    <div className="flex gap-2">
                      <input type="number" min="0" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} placeholder="المبلغ" className={inp + ' !w-28'} dir="ltr" />
                      <input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') addMovement(); }} placeholder="السبب (مثال: ثلج، غاز، بقشيش)" className={inp} />
                      <button type="button" disabled={busy} onClick={addMovement} className="bg-[#FF4500] text-white px-4 rounded-lg text-sm font-black shrink-0">حفظ</button>
                    </div>
                  </div>

                  {isAdmin && (rep.movements || []).length > 0 && (
                    <div className="border-t border-[#1F0A0E] pt-3 space-y-1.5 max-h-48 overflow-y-auto">
                      {rep.movements.map((m, i) => (
                        <div key={i} className="flex justify-between text-xs">
                          <span className="text-zinc-300">{m.type === 'in' ? '➕' : '➖'} {m.reason} <span className="text-zinc-500">({m.by} · {new Date(m.at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })})</span></span>
                          <span className={`font-black ${m.type === 'in' ? 'text-green-400' : 'text-red-400'}`}>{money(m.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-6">
                  <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5">
                    <h4 className="font-black text-[#FFB800] text-lg mb-3">👥 حسب الكاشير</h4>
                    {Object.keys(rep.byCashier || {}).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش أوردرات.</p> : Object.entries(rep.byCashier).map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center gap-3 text-sm py-1.5 border-b border-[#1F0A0E] last:border-0"><span className="text-white font-bold">{k} <span className="text-zinc-500 font-normal">({v.count} أوردر)</span></span><span className="text-[#FFB800] font-black text-left">{money(v.total)}<span className="block text-[11px] text-orange-300">خصومات: {money(v.discounts || 0)}</span></span></div>
                    ))}
                  </div>
                  <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5">
                    <h4 className="font-black text-[#FFB800] text-lg mb-3">📦 حسب نوع الأوردر</h4>
                    {Object.keys(rep.byType || {}).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش أوردرات.</p> : Object.entries(rep.byType).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm py-1.5 border-b border-[#1F0A0E] last:border-0"><span className="text-white font-bold">{TYPE_LABELS[k] || k} <span className="text-zinc-500 font-normal">({v.count})</span></span><span className="text-[#FFB800] font-black">{money(v.total)}</span></div>
                    ))}
                  </div>
                </div>
              </div>

              {(rep.driverBalances || []).length > 0 && (
                <div className="bg-[#100609] border border-orange-500/30 rounded-2xl p-5 space-y-3">
                  <h4 className="font-black text-[#FFB800] text-lg">🛵 عهدة السواقين (كاش أوردرات الدليفري غير المُسوّى)</h4>
                  <div className="space-y-2">
                    {rep.driverBalances.map((d) => (
                      <div key={d.driverName} className="flex flex-wrap items-center justify-between gap-3 bg-[#050304] border border-[#1F0A0E] rounded-xl p-3">
                        <div><p className="font-black text-white">{d.driverName}</p><p className="text-xs text-zinc-400">{d.orders} أوردر · مستحق {money(d.due)} · متسدد {money(d.settled)}</p></div>
                        <div className="flex items-center gap-2"><strong className="text-orange-300">متبقي {money(d.balance)}</strong><button type="button" onClick={() => { setSettleDriver(d.driverName); setSettleAmount(String(d.balance)); }} className="px-3 py-2 rounded-lg bg-orange-600 text-white text-xs font-black">تسوية كاملة</button></div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input value={settleDriver} onChange={(e) => setSettleDriver(e.target.value)} placeholder="اسم السواق" className={inp} />
                    <input type="number" min="0.01" step="0.01" value={settleAmount} onChange={(e) => setSettleAmount(e.target.value)} placeholder="مبلغ التسوية" className={inp} dir="ltr" />
                    <button type="button" disabled={busy} onClick={submitDriverSettlement} className="bg-green-600 text-white rounded-xl py-2 font-black disabled:opacity-50">تسجيل استلام الفلوس</button>
                  </div>
                </div>
              )}

              <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5">
                <h4 className="font-black text-[#FFB800] text-lg mb-1">📦 جرد الأصناف المباعة في الوردية</h4>
                <p className="text-zinc-500 text-xs mb-3">كل قسم اتباع منه كام قطعة — للمطابقة مع المخزون.</p>
                {(rep.categories || []).length === 0 ? <p className="text-zinc-500 text-sm">لسه مفيش مبيعات.</p> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rep.categories.map((c, i) => (
                      <details key={i} className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3" open={i < 2}>
                        <summary className="cursor-pointer flex justify-between items-center font-black text-white text-sm"><span>{c.name}</span><span className="text-[#FFB800]">{c.qty} قطعة · {money(c.total)}</span></summary>
                        <div className="mt-2 space-y-1">
                          {(c.items || []).map((it, j) => <div key={j} className="flex justify-between text-xs text-zinc-300"><span>{it.name}</span><span className="font-black text-white">× {it.qty}</span></div>)}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* سجل الورديات (الأدمن فقط) */}
      {isAdmin && (
      <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5">
        <h4 className="font-black text-[#FFB800] text-lg mb-3">📜 سجل الورديات المقفولة</h4>
        {(closedShifts || []).length === 0 ? <p className="text-zinc-500 text-sm">مفيش ورديات مقفولة لسه.</p> : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {closedShifts.map(c => {
              return (
                <div key={c._id} className="flex flex-wrap items-center justify-between gap-2 bg-[#050304] border border-[#1F0A0E] rounded-xl px-4 py-2.5 text-sm">
                  <span className="text-zinc-300">{fmtDT(c.openedAt || c.from)} ← {fmtDT(c.closedAt)} · {c.closedBy}</span>
                  <span className="text-zinc-400">{c.count} أوردر</span>
                  <span className="text-[#FFB800] font-black">{money(c.total)}</span>
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
        <div className="bg-[#100609] border border-[#FF4500]/40 rounded-2xl p-5 space-y-4">
          <h4 className="font-black text-[#FFB800] text-lg">📊 تقرير فترة / يوم كامل (للأدمن)</h4>
          <div className="flex flex-wrap gap-3 items-end">
            <div><label className="block text-xs text-zinc-400 mb-1">من</label><input type="datetime-local" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs text-zinc-400 mb-1">إلى</label><input type="datetime-local" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} className={inp} /></div>
            <button type="button" disabled={rangeBusy} onClick={loadRange} className="bg-[#FF4500] text-white px-5 py-2.5 rounded-xl font-black text-sm">{rangeBusy ? '...' : '📈 عرض التقرير'}</button>
            {rangeRep && <button type="button" onClick={() => requestPrint(makePrint('تقرير فترة', rangeRep), 'report')} className="bg-blue-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm">🖨️ طباعة</button>}
          </div>
          {rangeRep && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpi('عدد الأوردرات', rangeRep.count)}
                {kpi('إجمالي المبيعات', money(rangeRep.total))}
                {kpi('💵 كاش', money(rangeRep.payments?.cash || 0))}
                {kpi('💳 فيزا', money(rangeRep.payments?.visa || 0))}
                {kpi('📱 انستا باي', money(rangeRep.payments?.instapay || 0))}
                {kpi('👛 محفظة', money(rangeRep.payments?.wallet || 0))}
                {kpi('🛍️ طلبات', money(rangeRep.talabat))}
                {kpi('🏷️ خصومات', money(rangeRep.discounts))}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(rangeRep.categories || []).map((c, i) => (
                  <details key={i} className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3">
                    <summary className="cursor-pointer flex justify-between font-black text-white text-sm"><span>{c.name}</span><span className="text-[#FFB800]">{c.qty} قطعة · {money(c.total)}</span></summary>
                    <div className="mt-2 space-y-1">{(c.items || []).map((it, j) => <div key={j} className="flex justify-between text-xs text-zinc-300"><span>{it.name}</span><span className="font-black text-white">× {it.qty}</span></div>)}</div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* نافذة تقفيل بسيطة: صافي المبيعات فقط */}
      {closeOpen && shift && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => !busy && setCloseOpen(false)}>
          <div dir="rtl" className="bg-[#100609] border border-red-500/60 rounded-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-red-400">🔒 تقفيل الوردية</h3>
            <div className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-5 text-center space-y-2">
              <div className="text-sm text-zinc-400">صافي المبيعات (Net Sales)</div>
              <div className="text-3xl font-black text-[#FFB800]">{money(rep?.total || 0)}</div>
            </div>
            <p className="text-xs text-zinc-400 text-center">اضغط تقفيل لحفظ تقرير الوردية وإنهائها.</p>
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
const POS_MAX_CASHIER_DISCOUNT = 15;

const readPosPresets = () => {
  try {
    const a = JSON.parse(localStorage.getItem('bahbahPosDiscounts'));
    if (Array.isArray(a) && a.length) return a.map(Number).filter(n => n > 0 && n <= 100).slice(0, 8);
  } catch (e) {}
  return [10, 15, 20, 30];
};

const posGroupsOf = (item) => {
  let groups = [...(item.modifierGroups || [])];
  if (groups.length === 0 && (item.sizes?.length > 0 || item.addons?.length > 0)) {
    if (item.sizes?.length > 0) groups.push({ name: 'اختر الحجم', min: 1, max: 1, options: item.sizes });
    if (item.addons?.length > 0) groups.push({ name: 'الإضافات الاختيارية', min: 0, max: item.addons.length, options: item.addons });
  }
  return groups;
};

const PosScreen = ({ authFetch, isAdmin, onCreated, shiftOpen, onShiftOpened }) => {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState(null);
  const [search, setSearch] = useState('');

  const [cart, setCart] = useState(() => {
    try { const a = JSON.parse(localStorage.getItem('bahbahPosCart')); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  });
  const [modal, setModal] = useState(null); // { item, groups }
  const [selMods, setSelMods] = useState({});
  const [modalNotes, setModalNotes] = useState('');
  const [modalQty, setModalQty] = useState(1);

  const [orderType, setOrderType] = useState('pickup'); // pickup | delivery | talabat
  const [pay, setPay] = useState('cash');
  const [talabatNo, setTalabatNo] = useState('');
  const [discount, setDiscount] = useState(0);
  const [discountReason, setDiscountReason] = useState('');
  const [discountPin, setDiscountPin] = useState('');
  const [presets, setPresets] = useState(readPosPresets);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [address, setAddress] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [manualFee, setManualFee] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

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
      const item = items.find((candidate) => String(candidate._id) === String(line._id));
      if (!item) return line;
      const groups = posGroupsOf(item);
      let unit = Number(item.price) > 0 ? Number(item.price) : 0;
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
    try { localStorage.setItem('bahbahPosCart', JSON.stringify(cart)); } catch (e) {}
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
    if (modal.item.price > 0) modalUnit += (Number(modal.item.price) || 0);
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
  const clearCart = () => { if (cart.length === 0) return; if (window.confirm('تمسح كل الأصناف من السلة؟')) setCart([]); };

  const itemsTotal = cart.reduce((s, l) => s + l.unit * l.qty, 0);
  const discountAmount = Math.round(itemsTotal * discount / 100);
  const zone = zones.find(z => z._id === zoneId);
  const fee = orderType === 'delivery' ? (zone ? Number(zone.fee) || 0 : Number(manualFee) || 0) : 0;
  const total = itemsTotal - discountAmount + fee;

  const chooseType = (t) => {
    setOrderType(t);
    if (t === 'talabat' && !['cash', 'visa'].includes(pay)) setPay('cash');
  };

  const editPresets = () => {
    const txt = window.prompt('اكتب نسب الخصم المحفوظة مفصولة بفاصلة (مثال: 10,20,30,50)', presets.join(','));
    if (txt === null) return;
    const list = txt.split(/[,،\s]+/).map(Number).filter(n => n > 0 && n <= 100).slice(0, 8);
    if (list.length === 0) return alert('اكتب رقم واحد على الأقل');
    setPresets(list);
    try { localStorage.setItem('bahbahPosDiscounts', JSON.stringify(list)); } catch (e) {}
  };

  const setCustomDiscount = (v) => {
    const n = Math.max(0, Math.min(100, Number(String(v).replace(/[^\d.]/g, '')) || 0));
    setDiscount(n);
  };

  const submit = async () => {
    if (busy) return;
    if (shiftOpen === false) return alert('افتح وردية الأول');
    if (cart.length === 0) return alert('السلة فاضية');
    if (orderType === 'talabat' && !talabatNo.trim()) return alert('اكتب رقم أوردر طلبات');
    if (orderType === 'delivery' && !address.trim()) return alert('اكتب عنوان التوصيل');
    if (discount > 0 && discountReason.trim().length < 2) return alert('اكتب سبب الخصم');
    if (!isAdmin && discount > POS_MAX_CASHIER_DISCOUNT && !discountPin.trim()) return alert('خصم أعلى من 15% يحتاج PIN الأدمن');
    setBusy(true);
    try {
      const payload = {
        orderType, paymentMethod: pay, talabatNo: talabatNo.trim(), discountPercent: discount,
        discountReason: discountReason.trim(), adminPin: discountPin.trim(),
        customerName: custName.trim(), customerPhone: custPhone.trim(), customerAddress: address.trim(),
        zoneName: zone ? zone.name : (orderType === 'delivery' ? 'توصيل' : ''), deliveryFee: fee,
        items: cart.map(l => ({ itemId: l._id, name: l.name, quantity: l.qty, selections: Array.isArray(l.modifierSelections) ? l.modifierSelections : undefined, modifiers: l.modifiersInfo, notes: l.notes }))
      };
      const res = await authFetch('/api/pos/orders', { method: 'POST', body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || 'حصل خطأ، الأوردر ما اتسجلش');
      } else {
        onCreated(data);
        setToast(`✅ أوردر #${data.orderId} اتبعت للمطبخ`);
        setCart([]); setDiscount(0); setDiscountReason(''); setDiscountPin(''); setTalabatNo(''); setCustName(''); setCustPhone(''); setAddress(''); setManualFee(''); setPay('cash');
      }
    } catch (e) {
      alert('النت قاطع، الأوردر ما اتسجلش. استخدم الكاشير الأوفلاين لحد ما النت يرجع.');
    }
    setBusy(false);
  };

  const typeBtn = (key, label) => (
    <button type="button" onClick={() => chooseType(key)} className={`flex-1 py-3 rounded-xl font-black text-sm border transition ${orderType === key ? 'bg-[#FF4500] text-white border-[#FFB800]' : 'bg-[#050304] text-zinc-300 border-[#1F0A0E] hover:border-[#FF4500]'}`}>{label}</button>
  );

  const inp = 'w-full bg-[#050304] border border-[#1F0A0E] rounded-xl px-3 py-2 text-white text-sm';

  return (
    <div dir="rtl" className="relative flex gap-3 items-stretch" style={{ height: 'calc(100vh - 128px)', minHeight: 560 }}>
      {toast && <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[120] bg-green-600 text-white font-black px-6 py-3 rounded-2xl shadow-2xl">{toast}</div>}

      {shiftOpen === false && (
        <div className="absolute inset-0 z-30 bg-black/60 backdrop-blur-sm rounded-2xl flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#100609] border border-[#FF4500]/60 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="text-xl font-black text-[#FFB800] text-center">🕒 لازم تفتح وردية الأول</h3>
            <p className="text-zinc-400 text-sm text-center">عشان الأوردرات والكاش يتحسبوا صح في تقرير الوردية.</p>
            <OpenShiftForm authFetch={authFetch} onDone={onShiftOpened} />
          </div>
        </div>
      )}

      {/* المنيو */}
      <div className="flex-1 flex gap-3 min-w-0">
        <div className="w-32 shrink-0 overflow-y-auto space-y-2 pr-1">
          {sortedCats.map(c => (
            <button key={c._id} type="button" onClick={() => { setActiveCat(c.name); setSearch(''); }} className={`w-full min-h-[64px] px-2 py-3 rounded-2xl font-black text-sm leading-tight transition border-2 ${!q && catName === c.name ? 'bg-[#FF4500] text-white border-[#FFB800] shadow-[0_0_12px_rgba(255,69,0,0.6)]' : 'bg-[#2a120a] text-orange-200 border-transparent hover:border-[#FF4500]'}`}>{c.name}</button>
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
                    <button key={it._id} type="button" disabled={off} onClick={() => pickItem(it)} className={`relative min-h-[96px] rounded-2xl p-3 text-center border-2 transition flex flex-col items-center justify-center gap-1 ${off ? 'bg-red-950/50 border-red-900 opacity-60 cursor-not-allowed' : n > 0 ? 'bg-[#2b1208] border-[#FF4500]' : 'bg-[#100609] border-[#1F0A0E] hover:border-[#FF4500] active:scale-95'}`}>
                      {n > 0 && <span className="absolute top-1.5 left-1.5 bg-[#FF4500] text-white text-xs font-black min-w-[1.5rem] h-6 px-1 rounded-full flex items-center justify-center">{n}</span>}
                      <span className="font-black text-white text-sm leading-tight">{it.name}</span>
                      {off ? <span className="text-red-400 text-xs font-black">⛔ خلص</span> : (
                        <span className="text-[#FFB800] text-sm font-black">
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
      <div className="w-[420px] max-w-[46vw] shrink-0 bg-[#100609] border border-[#FF4500]/40 rounded-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1F0A0E] bg-[#180A0E]">
          <span className="font-black text-[#FFB800]">🧾 الأوردر ({cart.reduce((s, l) => s + l.qty, 0)})</span>
          <button type="button" onClick={clearCart} className="text-xs bg-red-500/15 text-red-400 px-3 py-1.5 rounded-lg font-bold">🗑️ مسح الكل</button>
        </div>

        <div className="flex-1 overflow-y-auto min-h-[110px]">
          {cart.length === 0 ? <p className="text-zinc-600 text-center py-10 text-sm">اختار أصناف من المنيو</p> : cart.map(l => (
            <div key={l.key} className="px-3 py-1.5 border-b border-[#1F0A0E]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-white text-sm flex-1">{l.name}</span>
                <span className="text-[#FFB800] font-black text-sm shrink-0">{l.unit * l.qty} ج</span>
              </div>
              {l.modifiersInfo.length > 0 && <p className="text-[11px] text-zinc-400">{l.modifiersInfo.map(stripMoney).join(' · ')}</p>}
              {l.notes && <p className="text-[11px] text-[#FFB800]">📝 {l.notes}</p>}
              <div className="flex items-center gap-1.5 mt-1">
                <button type="button" onClick={() => changeQty(l.key, -1)} className="w-8 h-8 rounded-lg bg-zinc-800 text-white text-lg font-black">−</button>
                <span className="min-w-[1.8rem] text-center text-white font-black">{l.qty}</span>
                <button type="button" onClick={() => changeQty(l.key, 1)} className="w-8 h-8 rounded-lg bg-zinc-800 text-white text-lg font-black">+</button>
                <span className="text-[11px] text-zinc-500 mr-1">{l.unit} ج للواحد</span>
                <button type="button" onClick={() => removeLine(l.key)} className="mr-auto w-8 h-8 rounded-lg bg-red-500/15 text-red-400 font-black">✕</button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#1F0A0E] p-3 space-y-2 overflow-y-auto max-h-[40%]">
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
              <button key={k} type="button" onClick={() => setPay(k)} className={`py-2.5 rounded-xl text-xs font-black border transition ${orderType === 'talabat' ? 'col-span-2' : ''} ${pay === k ? 'bg-green-600 text-white border-green-400' : 'bg-[#050304] text-zinc-300 border-[#1F0A0E] hover:border-green-500'}`}>{label}</button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-zinc-400 font-bold">خصم يدوي على أوردر الكاشير</span>
              {isAdmin && <button type="button" onClick={editPresets} className="text-[11px] text-zinc-500 underline">✏️ تعديل القيم</button>}
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <button type="button" onClick={() => setDiscount(0)} className={`px-3 py-2 rounded-lg text-xs font-black border ${discount === 0 ? 'bg-zinc-600 text-white border-zinc-400' : 'bg-[#050304] text-zinc-400 border-[#1F0A0E]'}`}>بدون</button>
              {presets.map(p => (
                <button key={p} type="button" onClick={() => setDiscount(p)} className={`px-3 py-2 rounded-lg text-xs font-black border ${discount === p ? 'bg-[#FF4500] text-white border-[#FFB800]' : 'bg-[#050304] text-[#FFB800] border-[#1F0A0E] hover:border-[#FF4500]'}`}>{p}%</button>
              ))}
              <input value={discount || ''} onChange={(e) => setCustomDiscount(e.target.value)} placeholder="%" className="w-16 bg-[#050304] border border-[#1F0A0E] rounded-lg px-2 py-2 text-white text-xs text-center" dir="ltr" />
            </div>
            {discount > 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-[11px] text-zinc-500">ده خصم منفصل عن خصم الموقع، ومش بيتطبق إلا لما تختار نسبة هنا.</p>
                <input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="سبب الخصم (إجباري)" className={inp} />
                {!isAdmin && discount > POS_MAX_CASHIER_DISCOUNT && <input type="password" inputMode="numeric" value={discountPin} onChange={(e) => setDiscountPin(e.target.value)} placeholder="PIN الأدمن للخصم فوق 15%" className={inp} dir="ltr" />}
              </div>
            )}
          </div>

          {orderType === 'delivery' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={custName} onChange={(e) => setCustName(e.target.value)} placeholder="اسم العميل (اختياري)" className={inp} />
                <input value={custPhone} onChange={(e) => setCustPhone(e.target.value.replace(/[^\d+]/g, ''))} placeholder="التليفون" className={inp} dir="ltr" />
              </div>
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

        <div className="shrink-0 border-t border-[#FF4500]/40 bg-[#180A0E] p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-zinc-400 gap-2">
            <span>المجموع {itemsTotal} ج</span>
            {discountAmount > 0 && <span className="text-green-400 font-bold">خصم {discount}%: - {discountAmount} ج</span>}
            {fee > 0 && <span>توصيل {fee} ج</span>}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[#FFB800] text-3xl font-black whitespace-nowrap">{total} ج</div>
            <button type="button" onClick={submit} disabled={busy || cart.length === 0} className={`flex-1 py-3.5 rounded-2xl font-black text-base transition ${busy || cart.length === 0 ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white shadow-lg'}`}>{busy ? '...جاري الحفظ' : '✅ تأكيد وإرسال للمطبخ'}</button>
          </div>
        </div>
      </div>

      {/* اختيارات الصنف */}
      {modal && (
        <div className="fixed inset-0 z-[110] bg-black/75 flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div dir="rtl" className="bg-[#100609] border border-[#FF4500]/60 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1F0A0E] flex items-center justify-between">
              <span className="font-black text-white text-lg">{modal.item.name}</span>
              <button type="button" onClick={() => setModal(null)} className="text-zinc-400 text-xl px-2">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {modal.groups.map((g, gi) => {
                const sel = selMods[gi] || [];
                return (
                  <div key={gi}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-bold text-[#FFB800] text-sm">{g.name}{g.min > 0 && <span className="text-red-400"> *</span>}</span>
                      <span className={`text-[11px] font-bold ${sel.length >= g.min && sel.length <= g.max ? 'text-green-400' : 'text-red-400'}`}>{sel.length}/{g.max}{g.min > 0 ? ' (مطلوب)' : ' (اختياري)'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {g.options.map((opt, oi) => {
                        const on = sel.includes(oi);
                        const p = (Number(opt.price) || 0);
                        const disabled = g.max > 1 && !on && sel.length >= g.max;
                        return (
                          <button key={oi} type="button" disabled={disabled} onClick={() => toggleOpt(gi, oi, g.max)} className={`px-3 py-3 rounded-xl text-sm font-bold border-2 text-right transition ${on ? 'bg-[#FF4500] text-white border-[#FFB800]' : disabled ? 'opacity-40 bg-[#050304] border-[#1F0A0E] text-zinc-500' : 'bg-[#050304] border-[#1F0A0E] text-zinc-200 hover:border-[#FF4500]'}`}>
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
            <div className="p-4 border-t border-[#1F0A0E] flex items-center gap-3">
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
    </div>
  );
};

// ================= 5. شاشة الكاشير (بحسابات وأدوار) =================
const CashierDashboard = ({ initialTab = 'active' }) => {
  const [session, setSession] = useState(readSession);
  const [orders, setOrders] = useState([]);
  const [cashierTab, setCashierTab] = useState(initialTab === 'archive' ? 'active' : initialTab); // pos | active | shift | archive | stock | staff
  const [soundReady, setSoundReady] = useState(false);

  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('bahbahPosTheme') || 'light'; } catch (e) { return 'light'; } });
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try { localStorage.setItem('bahbahPosTheme', next); } catch (e) {}
  };

  const [shiftData, setShiftData] = useState(null); // { shift, report } | null (لسه بيتحمل)

  const [stockItems, setStockItems] = useState([]);
  const [stockCats, setStockCats] = useState([]);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLoading, setStockLoading] = useState(false);

  const [driverModal, setDriverModal] = useState(null);
  const [driverName, setDriverName] = useState('');
  const [completionPay, setCompletionPay] = useState('cash');
  const [cancelModal, setCancelModal] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelPin, setCancelPin] = useState('');

  const [staff, setStaff] = useState([]);
  const [newName, setNewName] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const audioCtxRef = useRef(null);
  const token = session?.token;
  const user = session?.user;
  const isAdmin = user?.role === 'admin';

  useEffect(() => { if (!isAdmin && cashierTab === 'archive') setCashierTab('active'); }, [isAdmin, cashierTab]);

  // ===== الطباعة =====
  const [shiftClosings, setShiftClosings] = useState([]);
  const [openDay, setOpenDay] = useState(null);
  const [printJob, setPrintJob] = useState(null);
  const [printTick, setPrintTick] = useState(0);
  const [autoPrint, setAutoPrint] = useState(() => {
    try { return localStorage.getItem('bahbahAutoPrint') !== 'off'; } catch (e) { return true; }
  });
  const autoPrintRef = useRef(autoPrint);
  const printQueueRef = useRef([]);
  const printedRef = useRef(null);
  const seededRef = useRef(false);

  const loadPrinted = () => {
    if (printedRef.current) return printedRef.current;
    let arr = null;
    try { arr = JSON.parse(localStorage.getItem('bahbahPrintedOrderIds')); } catch (e) {}
    printedRef.current = new Set(Array.isArray(arr) ? arr : []);
    printedRef.current.hadStorage = Array.isArray(arr);
    return printedRef.current;
  };

  const savePrinted = () => {
    try { localStorage.setItem('bahbahPrintedOrderIds', JSON.stringify(Array.from(printedRef.current).slice(-500))); } catch (e) {}
  };

  const requestPrint = (ord, type = 'customer') => {
    if (type !== 'report' && token && (ord?._id || ord?.orderId)) {
      const printId = ord._id || ord.orderId;
      void authFetch(`/api/orders/${printId}/printed`, { method: 'POST' }).catch(() => {});
    }
    printQueueRef.current.push({ order: ord, type });
    setPrintTick(t => t + 1);
  };

  const toggleAutoPrint = () => {
    const next = !autoPrint;
    setAutoPrint(next);
    autoPrintRef.current = next;
    try { localStorage.setItem('bahbahAutoPrint', next ? 'on' : 'off'); } catch (e) {}
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
    const fresh = list.filter(o => !printed.has(o._id || o.orderId)).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    if (fresh.length === 0) return;
    fresh.forEach(o => {
      printed.add(o._id || o.orderId);
      if (autoPrintRef.current && o.status !== 'completed' && o.status !== 'cancelled') requestPrint(o, 'kitchen');
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
      const res = await authFetch('/api/orders');
      const data = await res.json();
      if (Array.isArray(data)) { setOrders(data); handleAutoPrint(data); }
    } catch (err) {}
  };

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
  };

  // إنهاء الأوردر: الدليفيري بيسأل عن اسم السواق الأول
  const doFinish = async (ord, extra = {}) => {
    const ok = await updateOrderStatus(ord._id || ord.orderId, 'completed', extra);
    if (ok && autoPrint) requestPrint({ ...ord, ...extra }, 'customer');
    return ok;
  };
  const finishOrder = (ord) => {
    if (ord.orderType === 'delivery' || !ord.paymentMethod) {
      setDriverName('');
      setCompletionPay(ord.paymentMethod || '');
      setDriverModal(ord);
      return;
    }
    doFinish(ord);
  };
  const readDrivers = () => { try { const a = JSON.parse(localStorage.getItem('bahbahDrivers')); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
  const confirmDriver = async () => {
    const ord = driverModal;
    if (!ord) return;
    const extra = {};
    if (ord.orderType === 'delivery') {
      const name = driverName.trim();
      if (!name) return alert('اكتب اسم السواق');
      extra.driverName = name;
      try { localStorage.setItem('bahbahDrivers', JSON.stringify([name, ...readDrivers().filter(d => d !== name)].slice(0, 12))); } catch (e) {}
    }
    if (!ord.paymentMethod) {
      if (!['cash', 'visa', 'instapay'].includes(completionPay)) return alert('اختار طريقة الدفع قبل تأكيد التسليم');
      extra.paymentMethod = completionPay;
    }
    setDriverModal(null);
    await doFinish(ord, extra);
  };
  const knownDrivers = Array.from(new Set([...readDrivers(), ...orders.map(o => o.driverName).filter(Boolean)])).slice(0, 8);

  const startCancel = (ord) => {
    setCancelReason(''); setCancelPin('');
    setCancelModal({ ...ord, requiresPin: !isAdmin && (ord.source === 'pos' || !!ord.printedAt || !!ord.paymentMethod) });
  };
  const submitCancel = async () => {
    const reason = cancelReason.trim();
    if (reason.length < 2) return alert('اكتب سبب الإلغاء');
    if (cancelModal?.requiresPin && !cancelPin.trim()) return alert('اكتب PIN الأدمن لإلغاء الأوردر المدفوع أو المطبوع');
    const ord = cancelModal;
    setCancelModal(null);
    await updateOrderStatus(ord._id || ord.orderId, 'cancelled', { cancelReason: reason, adminPin: ord.requiresPin ? cancelPin.trim() : undefined });
    setCancelPin('');
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
  const preparingCount = orders.filter(o => o.status === 'accepted').length;
  const hasNewOrders = newCount > 0;

  useEffect(() => {
    if (!token || !soundReady || !hasNewOrders) return;
    playBeep();
    const ringInterval = setInterval(playBeep, 2500);
    return () => clearInterval(ringInterval);
  }, [token, soundReady, hasNewOrders]);

  const activeOrders = orders.filter(o => o.status !== 'completed' && o.status !== 'cancelled');
  const doneOrders = orders.filter(o => o.status === 'completed');
  const cancelledOrders = orders.filter(o => o.status === 'cancelled');

  const dayGroups = (() => {
    const m = {};
    doneOrders.forEach(o => { const k = dayKeyOf(o.createdAt); (m[k] = m[k] || []).push(o); });
    return Object.keys(m).sort().reverse().map(k => ({
      key: k,
      label: dayLabelOf(m[k][0].createdAt),
      orders: [...m[k]].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      ...sumOrders(m[k])
    }));
  })();

  const shiftOpen = shiftData ? !!shiftData.shift : null;

  const renderOrderCard = (ord) => (
    <div key={ord._id || ord.orderId} className={`bg-[#100609] border rounded-2xl p-5 shadow-xl flex flex-col justify-between ${ord.status === 'cancelled' && ord.cancelledAfterPrint ? 'border-red-500 border-2 bg-red-950/30' : ord.status === 'cancelled' ? 'border-zinc-700 opacity-70' : ord.status === 'completed' ? 'border-[#1F0A0E]' : ord.status === 'accepted' ? 'border-yellow-500/60' : 'border-red-500 animate-pulse'}`}>
      <div>
        <div className="flex justify-between items-center mb-3 border-b border-[#1F0A0E] pb-2">
          <span className="font-black text-[#FFB800] text-lg">#{ord.orderId}</span>
          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${ord.status === 'cancelled' ? 'bg-zinc-700 text-zinc-300' : ord.status === 'completed' ? 'bg-green-500/20 text-green-400' : ord.status === 'accepted' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
            {ord.status === 'cancelled' && ord.cancelledAfterPrint ? '⚠️ ملغي بعد الطباعة' : ord.status === 'cancelled' ? 'ملغي ✖' : ord.status === 'completed' ? 'مكتمل ✅' : ord.status === 'accepted' ? 'قيد التحضير 👨‍🍳' : 'جديد 🔔'}
          </span>
        </div>

        <div className="text-sm space-y-1 mb-4 text-zinc-300">
          {ord.orderType !== 'talabat' && ord.customerName && ord.customerName !== '-' && <p>👤 <strong className="text-white">{ord.customerName}</strong></p>}
          {ord.orderType !== 'talabat' && ord.customerPhone && ord.customerPhone !== '-' && <p>📞 <strong className="text-white">{ord.customerPhone}</strong></p>}
          <p>📦 <strong className="text-white">{ord.orderType === 'delivery' ? `توصيل (${ord.zoneName})` : typeLabel(ord)}</strong>{ord.source === 'pos' && <span className="text-[10px] text-zinc-500 mr-2">من الكاشير</span>}</p>
          {ord.paymentMethod && <p>💰 <span className="text-zinc-300 text-xs">{PAY_LABELS[ord.paymentMethod] || ord.paymentMethod}{ord.discountAmount > 0 ? ` · خصم ${ord.discountPercent}% (${ord.discountAmount} ج)` : ''}</span></p>}
          {ord.driverName && <p>🛵 <span className="text-zinc-300 text-xs">السواق: {ord.driverName}</span></p>}
          {ord.status === 'cancelled' && <p>✖ <span className="text-red-400 text-xs">سبب الإلغاء: {ord.cancelReason} ({ord.cancelledBy})</span></p>}
          {ord.orderType === 'delivery' && <p>📍 <span className="text-zinc-400 text-xs">{ord.customerAddress}</span></p>}
          {ord.createdAt && <p>🕒 <span className="text-zinc-400 text-xs">{new Date(ord.createdAt).toLocaleString('ar-EG')}</span></p>}
          {ord.acceptedBy && <p>✅ <span className="text-zinc-400 text-xs">قبله: {ord.acceptedBy}</span></p>}
          {ord.completedBy && <p>🏁 <span className="text-zinc-400 text-xs">أنهاه: {ord.completedBy}</span></p>}
        </div>

        <div className="bg-[#050304] p-3 rounded-xl border border-[#1F0A0E] mb-4 space-y-2 max-h-48 overflow-y-auto">
          {ord.items && ord.items.map((it, idx) => (
            <div key={idx} className="text-xs">
              <div className="flex justify-between">
                <span className="text-white font-medium">{it.quantity}× {it.name}</span>
                <span className="text-[#FFB800]">{it.price * it.quantity} ج</span>
              </div>
              {(it.modifiers || []).map((m, i) => (<p key={i} className="text-zinc-400 pr-3">- {stripMoney(m)}</p>))}
              {it.notes && <p className="text-[#FFB800] pr-3">📝 {it.notes}</p>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center pt-3 border-t border-[#1F0A0E] mb-4 text-sm font-bold">
          <span>الإجمالي:</span>
          <span className="text-[#FFB800] text-lg font-black">{ord.grandTotal} ج</span>
        </div>

        <div className="flex gap-2">
          {ord.status === 'pending' && (
            <button onClick={() => updateOrderStatus(ord._id || ord.orderId, 'accepted')} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-xl text-sm font-black transition shadow-lg">✅ قبول الأوردر (إيقاف الصوت)</button>
          )}
          {ord.status === 'accepted' && (
            <button onClick={() => finishOrder(ord)} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-bold transition">{ord.orderType === 'delivery' ? '🛵 جاهز للتوصيل' : '🏁 تم التسليم'}</button>
          )}
          {ord.status === 'cancelled' && <span className="flex-1 text-center text-zinc-400 text-xs font-bold py-2">الأوردر ملغي</span>}
          {ord.status === 'completed' && <span className="flex-1 text-center text-green-400 text-xs font-bold py-2">تم تسليم الأوردر</span>}
          {(ord.status === 'pending' || ord.status === 'accepted') && <button onClick={() => startCancel(ord)} title="إلغاء الأوردر" className="text-red-300 bg-red-500/15 hover:bg-red-500/30 px-3 rounded-xl text-xs font-bold">✖ إلغاء</button>}
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
    <button type="button" onClick={() => setCashierTab(key)} className={`flex-1 md:flex-none ${cashierTab === 'pos' ? 'px-4 py-2 text-sm' : 'px-6 py-3 text-base'} rounded-xl font-black transition border ${cashierTab === key ? 'bg-[#FF4500] text-white border-[#FFB800] shadow-[0_0_15px_rgba(255,69,0,0.5)]' : 'bg-[#100609] text-zinc-300 border-[#1F0A0E] hover:border-[#FF4500]'}`}>{label}</button>
  );

  return (
    <section className={`${theme === 'light' ? 'pos-light' : ''} ${cashierTab === 'pos' ? 'px-3 py-3 w-full' : 'px-8 py-12 max-w-7xl mx-auto'} min-h-screen bg-[#050304] text-white`}>
      <style>{LIGHT_THEME_CSS}</style>
      <div className={`flex flex-wrap gap-3 justify-between items-center border-b border-[#1F0A0E] ${cashierTab === 'pos' ? 'mb-2 pb-2' : 'mb-8 pb-4'}`}>
        <h2 className={`${cashierTab === 'pos' ? 'text-xl' : 'text-3xl'} font-bold text-[#FFB800]`}>
          🖥️ شاشة الكاشير
          {newCount > 0 && <span className="bg-red-600 text-white text-base px-3 py-1 rounded-full mr-3 animate-pulse">🔔 {newCount} جديد</span>}
          {preparingCount > 0 && <span className="bg-yellow-500/20 text-yellow-400 text-base px-3 py-1 rounded-full mr-2">{preparingCount} قيد التحضير</span>}
        </h2>
        <div className="flex flex-wrap gap-2 items-center">
          {shiftData && (shiftData.shift ? (
            <button type="button" onClick={() => setCashierTab('shift')} className="bg-green-600 text-white px-3 py-2 rounded-xl text-xs font-black" title="الوردية المفتوحة">🟢 ورديتك: {shiftData.shift.openedBy}{isAdmin ? ` · درج ${money(shiftData.report?.expectedCash)}` : ''}</button>
          ) : (
            <button type="button" onClick={() => setCashierTab('shift')} className="bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-black animate-pulse">🔴 مفيش وردية — افتح</button>
          ))}
          {isAdmin && <StoreToggle authFetch={authFetch} />}
          <button type="button" onClick={toggleTheme} className="bg-[#100609] border border-[#1F0A0E] text-white px-3 py-2 rounded-xl text-xs font-black">{theme === 'light' ? '🌙 داكن' : '☀️ فاتح'}</button>
          <span className="text-sm text-zinc-300 bg-[#100609] border border-[#1F0A0E] px-3 py-2 rounded-xl">
            👤 {user.name} {isAdmin && <span className="text-[#FFB800] font-bold">(أدمن)</span>}
          </span>
          {soundReady && <button onClick={playBeep} className="bg-zinc-800 px-4 py-2 rounded-xl text-sm font-bold text-white">🔊 تجربة الصوت</button>}
          <button onClick={toggleAutoPrint} className={`px-4 py-2 rounded-xl text-sm font-bold text-white ${autoPrint ? 'bg-green-700' : 'bg-zinc-700'}`}>🖨️ طباعة تلقائية: {autoPrint ? 'شغالة' : 'مقفولة'}</button>
          <button onClick={() => { fetchOrders(); refreshShift(); }} className="bg-[#FF4500] px-4 py-2 rounded-xl text-sm font-bold text-white">🔄 تحديث</button>
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
        {isAdmin && tabBtn('archive', `📦 الأرشيف (${doneOrders.length + cancelledOrders.length})`)}
        {tabBtn('stock', '🍽️ الأصناف المتاحة')}
        {isAdmin && tabBtn('staff', '👥 إدارة الكاشيرات')}
      </div>

      {cashierTab === 'pos' && <PosScreen authFetch={authFetch} isAdmin={isAdmin} onCreated={(o) => { handlePosCreated(o); refreshShift(); }} shiftOpen={shiftOpen} onShiftOpened={refreshShift} />}

      {cashierTab === 'active' && (
        activeOrders.length === 0 ? (
          <p className="text-zinc-500 text-center py-20 text-xl bg-[#100609] border border-[#1F0A0E] rounded-2xl">لا توجد أوردرات نشطة حالياً ✨</p>
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

      {isAdmin && cashierTab === 'archive' && (
        <div className="space-y-6">
          <p className="text-zinc-400 text-sm bg-[#100609] border border-[#1F0A0E] rounded-2xl p-4">📌 أرشيف الأوردرات المكتملة حسب اليوم. حسابات الوردية والدرج والتقفيل في تبويب <strong className="text-white">🕒 الوردية والتقفيل</strong>.</p>
          {dayGroups.length === 0 ? (
            <p className="text-zinc-500 text-center py-20 text-xl bg-[#100609] border border-[#1F0A0E] rounded-2xl">لا توجد أوردرات منتهية بعد.</p>
          ) : (
            dayGroups.map(g => {
              const isOpen = (openDay === null ? dayGroups[0].key : openDay) === g.key;
              return (
                <div key={g.key} className="bg-[#100609] border border-[#1F0A0E] rounded-2xl overflow-hidden">
                  <button type="button" onClick={() => setOpenDay(isOpen ? '' : g.key)} className="w-full flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-right hover:bg-[#180A0E] transition">
                    <span className="font-black text-white text-lg">📅 {g.label}</span>
                    <span className="flex items-center gap-4 text-sm">
                      <span className="text-zinc-300">{g.count} أوردر</span>
                      <span className="text-zinc-400">توصيل {g.delivery} ج</span>
                      <span className="text-[#FFB800] text-xl font-black">{g.total} ج</span>
                      <span className="text-zinc-400">{isOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="p-5 border-t border-[#1F0A0E] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 opacity-95">
                      {g.orders.map(renderOrderCard)}
                    </div>
                  )}
                </div>
              );
            })
          )}

          {cancelledOrders.length > 0 && (
            <details className="bg-[#100609] border border-red-900/50 rounded-2xl p-4">
              <summary className="cursor-pointer font-bold text-red-300">✖ أوردرات ملغية ({cancelledOrders.length})</summary>
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{cancelledOrders.map(renderOrderCard)}</div>
            </details>
          )}
        </div>
      )}

      {cashierTab === 'stock' && (
        <div className="space-y-6">
          <div className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-4 flex flex-wrap gap-3 items-center justify-between">
            <div>
              <p className="font-black text-[#FFB800] text-lg">🍽️ إدارة الأصناف</p>
              <p className="text-zinc-400 text-sm mt-1">
                اضغط على الصنف عشان تقفله (خلص) أو تفتحه. الصنف الخالص بيظهر للعميل "غير متاح" ومايقدرش يطلبه.
                {' '}<span className="text-red-400 font-bold">{stockItems.filter(i => i.available === false).length} صنف خالص حالياً</span>
              </p>
            </div>
            <div className="flex gap-2 items-center">
              <input value={stockSearch} onChange={(e) => setStockSearch(e.target.value)} placeholder="🔍 دوّر على صنف" className="bg-[#050304] border border-[#1F0A0E] rounded-xl px-3 py-2 text-white text-sm" />
              <button onClick={fetchStock} className="bg-[#FF4500] px-4 py-2 rounded-xl text-sm font-bold text-white">{stockLoading ? '...' : '🔄 تحديث'}</button>
            </div>
          </div>

          {stockCats.map(cat => {
            const list = stockItems
              .filter(i => i.category === cat.name && (!stockSearch.trim() || i.name.toLowerCase().includes(stockSearch.trim().toLowerCase())))
              .sort((a, b) => (a.order || 0) - (b.order || 0));
            if (list.length === 0) return null;
            return (
              <div key={cat._id} className="bg-[#100609] border border-[#1F0A0E] rounded-2xl p-5">
                <h4 className="text-lg font-black text-[#FFB800] mb-4 border-r-4 border-[#FF4500] pr-3">{cat.name}</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {list.map(it => {
                    const off = it.available === false;
                    return (
                      <button key={it._id} type="button" onClick={() => toggleStock(it)} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-3 border text-right transition ${off ? 'bg-red-950/60 border-red-500/60' : 'bg-[#050304] border-[#1F0A0E] hover:border-green-500/60'}`}>
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
            <p className="text-zinc-500 text-center py-16 bg-[#100609] border border-[#1F0A0E] rounded-2xl">مفيش أصناف متحملة. اضغط تحديث.</p>
          )}
        </div>
      )}

      {cashierTab === 'staff' && isAdmin && (
        <div className="space-y-8">
          <form onSubmit={handleAddStaff} className="bg-[#100609] border border-[#FF4500]/50 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-4 gap-4">
            <h3 className="md:col-span-4 text-xl font-bold text-[#FFB800]">➕ إضافة كاشير جديد</h3>
            <input required type="text" placeholder="الاسم (مثلاً: أحمد)" value={newName} onChange={(e) => setNewName(e.target.value)} className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-sm" />
            <input required type="text" placeholder="اسم المستخدم (إنجليزي)" value={newUsername} onChange={(e) => setNewUsername(e.target.value)} autoCapitalize="none" className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-sm" />
            <input required type="text" placeholder="الباسورد" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="bg-[#050304] border border-[#1F0A0E] rounded-xl p-3 text-white text-sm" />
            <button type="submit" className="bg-[#FF4500] text-white font-bold rounded-xl hover:bg-[#E03D00] transition">إضافة</button>
          </form>

          <div className="space-y-3">
            {staff.map((s) => (
              <div key={s._id} className="bg-[#100609] border border-[#1F0A0E] rounded-xl px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
                <div>
                  <span className="font-bold text-white">{s.name}</span>
                  <span className="text-zinc-400 text-sm mr-3">@{s.username}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold mr-2 ${s.role === 'admin' ? 'bg-[#FFB800] text-black' : 'bg-zinc-700 text-zinc-200'}`}>{s.role === 'admin' ? 'أدمن' : 'كاشير'}</span>
                  {!s.active && <span className="text-xs text-red-400 font-bold mr-2">⛔ موقوف</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleResetPassword(s)} className="text-[#FFB800] bg-[#FF4500]/20 px-3 py-1.5 rounded-lg text-xs font-bold">🔑 تغيير الباسورد</button>
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

      {driverModal && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => setDriverModal(null)}>
          <div dir="rtl" className="bg-[#100609] border border-[#FF4500]/60 rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-[#FFB800]">{driverModal.orderType === 'delivery' ? `🛵 خروج أوردر للتوصيل #${driverModal.orderId}` : `💳 تأكيد الدفع للأوردر #${driverModal.orderId}`}</h3>
            {!driverModal.paymentMethod && (
              <div className="space-y-2">
                <p className="text-sm text-zinc-300 font-bold">اختار طريقة الدفع *</p>
                <div className="grid grid-cols-3 gap-2">
                  {[['cash', '💵 كاش'], ['visa', '💳 فيزا'], ['instapay', '📱 انستا باي']].map(([key, label]) => <button key={key} type="button" onClick={() => setCompletionPay(key)} className={`py-3 rounded-xl text-xs font-black border ${completionPay === key ? 'bg-green-600 text-white border-green-400' : 'bg-[#050304] text-zinc-300 border-[#1F0A0E]'}`}>{label}</button>)}
                </div>
              </div>
            )}
            {driverModal.orderType === 'delivery' && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-300 font-bold">اسم السواق *</p>
                {knownDrivers.length > 0 && <div className="flex flex-wrap gap-2">{knownDrivers.map(d => <button key={d} type="button" onClick={() => setDriverName(d)} className={`px-4 py-2 rounded-xl text-sm font-bold border ${driverName === d ? 'bg-[#FF4500] text-white border-[#FFB800]' : 'bg-[#050304] text-zinc-200 border-[#1F0A0E]'}`}>{d}</button>)}</div>}
                <input autoFocus value={driverName} onChange={(e) => setDriverName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirmDriver(); }} placeholder="اكتب اسم السواق" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl px-4 py-3 text-white" />
              </div>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={confirmDriver} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3 rounded-xl">{driverModal.orderType === 'delivery' ? '✅ تأكيد خروج الأوردر' : '✅ تأكيد الدفع والتسليم'}</button>
              <button type="button" onClick={() => setDriverModal(null)} className="px-5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
            </div>
          </div>
        </div>
      )}

      {cancelModal && (
        <div className="fixed inset-0 z-[130] bg-black/75 flex items-center justify-center p-4" onClick={() => setCancelModal(null)}>
          <div dir="rtl" className="bg-[#100609] border border-red-500/60 rounded-2xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-xl font-black text-red-400">✖ إلغاء أوردر #{cancelModal.orderId}</h3>
            <p className="text-zinc-400 text-xs">الأوردر مش هيتمسح، هيفضل في الأرشيف بحالة "ملغي" وسببه ومين لغاه، ومش بيتحسب في الإيراد.</p>
            <div className="flex flex-wrap gap-2">
              {['العميل لغى', 'غلط في الأوردر', 'الصنف خلص', 'اتأخر', 'تجربة'].map(r => <button key={r} type="button" onClick={() => setCancelReason(r)} className={`px-3 py-2 rounded-xl text-sm font-bold border ${cancelReason === r ? 'bg-red-600 text-white border-red-400' : 'bg-[#050304] text-zinc-200 border-[#1F0A0E]'}`}>{r}</button>)}
            </div>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="سبب الإلغاء (إجباري)" className="w-full bg-[#050304] border border-[#1F0A0E] rounded-xl px-4 py-3 text-white" />
            {cancelModal.requiresPin && <input type="password" inputMode="numeric" value={cancelPin} onChange={(e) => setCancelPin(e.target.value)} placeholder="PIN الأدمن لإتمام الإلغاء" className="w-full bg-[#050304] border border-red-500/40 rounded-xl px-4 py-3 text-white" dir="ltr" />}
            <div className="flex gap-3">
              <button type="button" onClick={submitCancel} className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black py-3 rounded-xl">تأكيد الإلغاء</button>
              <button type="button" onClick={() => setCancelModal(null)} className="px-5 bg-zinc-700 text-white font-bold rounded-xl">رجوع</button>
            </div>
          </div>
        </div>
      )}

      <Receipt80 order={printJob?.order} type={printJob?.type} cashierName={user?.name} />
    </section>
  );
};

// ================= شاشة التحميل =================
const Noss KoftaLoader = () => {
  const messages = ['مش مجرد برجر دا نص كفتة🔥', 'اطلب دلوقت ...', 'الريحة جاية 😋', 'لسه شوية ويبقى جاهز'];
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % messages.length), 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center text-white px-4" dir="rtl">
      <style>{`
        @keyframes bbl-bounce { 0%,100% { transform: translateY(0) rotate(-4deg); } 50% { transform: translateY(-18px) rotate(4deg); } }
        @keyframes bbl-flame { from { transform: scale(0.9,0.85); opacity: .8; } to { transform: scale(1.15,1.3); opacity: 1; } }
        @keyframes bbl-fade { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
        .bbl-burger { animation: bbl-bounce 1.2s ease-in-out infinite; }
        .bbl-flame { display: inline-block; transform-origin: 50% 100%; animation: bbl-flame .5s ease-in-out infinite alternate; }
        .bbl-msg { animation: bbl-fade 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .bbl-burger, .bbl-flame, .bbl-msg { animation: none; } }
      `}</style>
      <div className="bbl-burger text-[110px] leading-none">🍔</div>
      <div className="flex gap-2 text-4xl mt-2">
        <span className="bbl-flame">🔥</span><span className="bbl-flame" style={{ animationDelay: '.15s' }}>🔥</span><span className="bbl-flame" style={{ animationDelay: '.3s' }}>🔥</span>
      </div>
      <h2 className="text-[#ef321b] font-black text-3xl italic tracking-wider mt-6">BAHBAH BURGER</h2>
      <p key={msgIdx} className="bbl-msg text-white/60 text-sm mt-3 h-5">{messages[msgIdx]}</p>
    </div>
  );
};

// ================= التطبيق الرئيسي =================
function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // صفحات الكاشير/الـPOS: من غير هيدر وفوتر الموقع عشان الشاشة كلها للشغل
  const isStaffPage = location.pathname === '/pos' || location.pathname === '/cashier';
  const menuRef = useRef(null);
  const [cart, setCart] = useState([]);
  const menuCache = (() => { try { const c = JSON.parse(localStorage.getItem('bahbahMenuCache')); return c && Array.isArray(c.items) && c.items.length ? c : null; } catch (e) { return null; } })();
  const [menuItems, setMenuItems] = useState(menuCache ? menuCache.items : []);
  const [categories, setCategories] = useState(menuCache && Array.isArray(menuCache.categories) ? menuCache.categories : []);
  const [siteSettings, setSiteSettings] = useState(menuCache && menuCache.settings ? menuCache.settings : { heroImage: '', heroTitleAr: '', heroTitleEn: '', logoImage: '' });
  const [lang, setLang] = useState('ar');
  const [logoClicks, setLogoClicks] = useState(0);
  const [isLoading, setIsLoading] = useState(!menuCache);
  const storeStatus = useStoreStatus();

  const [selectedItemDetail, setSelectedItemDetail] = useState(null);
  const [selectedModifiers, setSelectedModifiers] = useState({});
  const [itemNotes, setItemNotes] = useState('');

  const fetchItems = async () => { try { const res = await fetch(`${API_BASE}/api/items`); const data = await res.json(); const list = data.map(item => ({ ...item, discount: Number(item.discount) || 0 })); setMenuItems(list); return list; } catch (err) { return null; } };
  const fetchCategories = async () => { try { const res = await fetch(`${API_BASE}/api/categories`); const data = await res.json(); setCategories(data); return data; } catch (err) { return null; } };
  const fetchSettings = async () => { try { const res = await fetch(`${API_BASE}/api/settings`); const data = await res.json(); setSiteSettings(data); return data; } catch (err) { return null; } };

  useEffect(() => {
    const loadAll = async () => {
      // لو فيه نسخة محفوظة من آخر زيارة بنعرضها فوراً ونحدّثها في الخلفية
      if (!menuCache) setIsLoading(true);
      try {
        const [items, cats, settings] = await Promise.all([fetchItems(), fetchCategories(), fetchSettings()]);
        if (Array.isArray(items) && items.length) {
          try { localStorage.setItem('bahbahMenuCache', JSON.stringify({ items, categories: cats, settings })); } catch (e) {}
        }
      }
      finally { setIsLoading(false); }
    };
    loadAll();
  }, []);

  // Meta Pixel: PageView مع كل تنقل بين الصفحات (من غير صفحات الكاشير والأدمن)
  useEffect(() => {
    const p = location.pathname;
    if (p === '/pos' || p === '/cashier' || p === '/secret-admin-dashboard') return;
    track('PageView');
  }, [location.pathname]);

  const handleSecretLogoClick = () => {
    setLogoClicks(prev => {
      const newCount = prev + 1;
      if (newCount === 3) { navigate('/secret-admin-dashboard'); return 0; }
      return newCount;
    });
  };

  const handleOpenItemDetailsModal = (item) => {
    if (item.available === false) return;
    let migratedGroups = [...(item.modifierGroups || [])];
    if (migratedGroups.length === 0 && (item.sizes?.length > 0 || item.addons?.length > 0)) {
      if (item.sizes?.length > 0) migratedGroups.push({ name: "اختر الحجم", min: 1, max: 1, options: item.sizes });
      if (item.addons?.length > 0) migratedGroups.push({ name: "الإضافات الاختيارية", min: 0, max: item.addons.length, options: item.addons });
    }

    if (migratedGroups.length > 0) {
      setSelectedItemDetail({ ...item, modifierGroups: migratedGroups });
      setSelectedModifiers({});
      setItemNotes('');
      track('ViewContent', { content_name: item.name, content_ids: [String(item._id)], content_type: 'product', value: getDiscountedPrice(item.price, item.discount), currency: 'EGP' });
    } else {
      const p = getDiscountedPrice(item.price, item.discount);
      setCart([...cart, { ...item, cartId: Date.now() + Math.random(), price: p }]);
      track('AddToCart', { content_name: item.name, content_ids: [String(item._id)], content_type: 'product', value: p, currency: 'EGP' });
    }
  };

  const handleModifierSelection = (gIndex, oIndex, groupMax) => {
    const currentSelected = selectedModifiers[gIndex] || [];
    if (groupMax === 1) {
      setSelectedModifiers({ ...selectedModifiers, [gIndex]: [oIndex] });
    } else if (currentSelected.includes(oIndex)) {
      setSelectedModifiers({ ...selectedModifiers, [gIndex]: currentSelected.filter(i => i !== oIndex) });
    } else if (currentSelected.length < groupMax) {
      setSelectedModifiers({ ...selectedModifiers, [gIndex]: [...currentSelected, oIndex] });
    }
  };

  const isFormValid = () => {
    if (!selectedItemDetail || !selectedItemDetail.modifierGroups) return true;
    return selectedItemDetail.modifierGroups.every((group, gIndex) => {
      const count = (selectedModifiers[gIndex] || []).length;
      return count >= group.min && count <= group.max;
    });
  };

  let modalFinalPrice = 0;
  if (selectedItemDetail) {
    if (selectedItemDetail.price > 0) modalFinalPrice += getDiscountedPrice(selectedItemDetail.price, selectedItemDetail.discount);
    if (selectedItemDetail.modifierGroups) {
      selectedItemDetail.modifierGroups.forEach((group, gIndex) => {
        (selectedModifiers[gIndex] || []).forEach(oIndex => {
          modalFinalPrice += getDiscountedPrice(group.options[oIndex].price, selectedItemDetail.discount);
        });
      });
    }
  }

  const handleAddCustomizedItemToCart = () => {
    if (!isFormValid()) return;
    let modifiersInfo = [];
    selectedItemDetail.modifierGroups.forEach((group, gIndex) => {
      (selectedModifiers[gIndex] || []).forEach(oIndex => {
        const opt = group.options[oIndex];
        const finalOptPrice = getDiscountedPrice(opt.price, selectedItemDetail.discount);
        modifiersInfo.push(`${group.name}: ${opt.name} ${finalOptPrice > 0 ? `(+${finalOptPrice} ج)` : ''}`.trim());
      });
    });

    const modifierSelections = selectedItemDetail.modifierGroups.map((group, groupIndex) => ({
      groupIndex, optionIndices: [...(selectedModifiers[groupIndex] || [])]
    })).filter(selection => selection.optionIndices.length > 0);
    setCart([...cart, { ...selectedItemDetail, cartId: Date.now() + Math.random(), price: modalFinalPrice, modifiersInfo, modifierSelections, notes: itemNotes }]);
    track('AddToCart', { content_name: selectedItemDetail.name, content_ids: [String(selectedItemDetail._id)], content_type: 'product', value: modalFinalPrice, currency: 'EGP' });
    setSelectedItemDetail(null); setSelectedModifiers({}); setItemNotes('');
  };

  if (isLoading) return <Noss KoftaLoader />;

  return (
    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-[#050304] text-white font-sans flex flex-col justify-between relative selection:bg-[#FF4500] selection:text-white">
      {!isStaffPage && <nav className="sticky top-0 z-50 bg-[#050505]/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-[1500px] mx-auto h-[78px] px-5 md:px-10 flex items-center justify-between">
          <Link to="/" className="shrink-0 flex items-center">
            {siteSettings.logoImage ? <img src={siteSettings.logoImage} alt="Noss Kofta" className="h-14 md:h-16 w-auto object-contain" /> : <span className="text-3xl font-black italic text-white">Noss Kofta</span>}
          </Link>
          <div className="hidden md:flex items-center gap-10 text-sm font-black">
            <Link to="/" className="relative py-7 hover:text-[#ef321b] transition">الرئيسية</Link>
            <Link to="/menu" className="py-7 hover:text-[#ef321b] transition">المنيو</Link>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} className="text-xs font-black border border-white/15 px-3 py-1.5 hover:border-[#ef321b] transition">{lang === 'ar' ? 'EN' : 'عربي'}</button>
            <Link to="/cart" className="relative flex items-center gap-2 hover:text-[#ef321b] transition">
              <span className="text-2xl">🛒</span>
              <span className="absolute -top-2 -right-3 bg-[#ef321b] text-white text-[10px] w-5 h-5 flex items-center justify-center rounded-full font-black">{cart.length}</span>
            </Link>
          </div>
        </div>
        <StoreClosedBanner status={storeStatus} />
      </nav>}

      <div className="flex-1">
        <Routes>
          <Route path="/" element={<HomePage lang={lang} siteSettings={siteSettings} menuItems={menuItems} categories={categories} handleOpenItemDetails={handleOpenItemDetailsModal} menuRef={menuRef} cart={cart} setCart={setCart} />} />
          <Route path="/menu" element={<MenuPage menuItems={menuItems} categories={categories} lang={lang} handleOpenItemDetails={handleOpenItemDetailsModal} cart={cart} setCart={setCart} />} />
          <Route path="/secret-admin-dashboard" element={<AdminDashboard menuItems={menuItems} categories={categories} siteSettings={siteSettings} lang={lang} fetchItems={fetchItems} fetchCategories={fetchCategories} fetchSettings={fetchSettings} />} />
          <Route path="/cashier" element={<CashierDashboard />} />
          <Route path="/pos" element={<CashierDashboard initialTab="pos" />} />
          <Route path="/cart" element={<CartPage cart={cart} setCart={setCart} lang={lang} storeStatus={storeStatus} />} />
        </Routes>
      </div>

      {selectedItemDetail && (
        <div className="fixed inset-0 bg-black/80 flex items-end md:items-center justify-center z-50 p-0 md:p-4 backdrop-blur-sm">
          <div className="bg-[#f4f4f5] w-full max-w-md md:rounded-3xl rounded-t-3xl relative flex flex-col max-h-[90vh] md:max-h-[85vh] shadow-2xl overflow-hidden text-black">

            {/* 1. صورة الصنف وزر الإغلاق العائم */}
            <div className="relative w-full h-24 md:h-32 shrink-0 bg-white border-b border-gray-200">
              <button onClick={() => setSelectedItemDetail(null)} className="absolute top-2 right-2 z-10 bg-black/50 hover:bg-black/70 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition backdrop-blur-md">✕</button>
              <img src={selectedItemDetail.image || "https://via.placeholder.com/800x600/0D0D0D/EF321B?text=Noss Kofta"} alt={selectedItemDetail.name} className="w-full h-full object-cover" />
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {/* 2. اسم السندوتش والسعر والوصف */}
              <div className="bg-white rounded-2xl border border-gray-200 p-3 shadow-sm">
                <div className="flex justify-between items-start gap-3">
                  <h3 className="text-xl font-black text-gray-900 leading-tight">{selectedItemDetail.name}</h3>
                  <span className="text-lg font-black text-[#FF4500] whitespace-nowrap" dir="ltr">
                    {selectedItemDetail.discount > 0 ? getDiscountedPrice(selectedItemDetail.price, selectedItemDetail.discount) : selectedItemDetail.price} ج.م
                  </span>
                </div>
                {selectedItemDetail.description && (
                  <p className="text-gray-500 text-xs mt-1.5 leading-relaxed">{selectedItemDetail.description}</p>
                )}
              </div>

              {/* 3. الإضافات والاختيارات */}
              {selectedItemDetail.modifierGroups && selectedItemDetail.modifierGroups.map((group, gIndex) => {
                const selectedCount = (selectedModifiers[gIndex] || []).length;
                const isSatisfied = selectedCount >= group.min && selectedCount <= group.max;
                return (
                  <div key={gIndex} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                      <div>
                        <h4 className="font-bold text-gray-800 text-[14px] flex items-center gap-1">
                          {group.name}
                          {group.min > 0 && <span className="text-red-500 text-base leading-none">*</span>}
                        </h4>
                        {group.min > 0 ? (
                          <p className={`text-[10px] font-bold mt-0.5 ${isSatisfied ? 'text-green-600' : 'text-red-500'}`}>
                            {isSatisfied ? '✓ تم الاختيار' : `يجب اختيار على الأقل ${group.min} من ${group.name}`}
                          </p>
                        ) : (
                          <p className="text-[10px] font-bold text-gray-400 mt-0.5">اختياري</p>
                        )}
                      </div>
                      <span className="text-xs font-bold text-gray-500 bg-gray-200 px-2 py-0.5 rounded-md">{selectedCount}/{group.max}</span>
                    </div>

                    <div className="flex flex-col">
                      {group.options.map((opt, oIndex) => {
                        const isSelected = (selectedModifiers[gIndex] || []).includes(oIndex);
                        const isDisabled = group.max > 1 ? (!isSelected && selectedCount >= group.max) : false;
                        const discountedOptPrice = getDiscountedPrice(opt.price, selectedItemDetail.discount);
                        return (
                          <label key={oIndex} className={`flex items-center justify-between p-3 border-b border-gray-100 last:border-0 cursor-pointer transition ${isSelected ? 'bg-orange-50' : ''} ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}>
                            <div className="flex items-center gap-2.5">
                              {group.max === 1 ? (
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-[#FF4500]' : 'border-gray-300'}`}>
                                  {isSelected && <div className="w-2 h-2 bg-[#FF4500] rounded-full"></div>}
                                </div>
                              ) : (
                                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${isSelected ? 'border-[#FF4500] bg-[#FF4500]' : 'border-gray-300 bg-white'}`}>
                                  {isSelected && <span className="text-white text-[10px] font-bold">✓</span>}
                                </div>
                              )}
                              <span className={`text-[14px] ${isSelected ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{opt.name}</span>
                            </div>
                            {opt.price > 0 ? (
                              <span className="text-[13px] text-gray-600 font-medium flex items-center gap-1.5">
                                {selectedItemDetail.discount > 0 ? (
                                  <>
                                    <span className="text-[#FF4500] font-bold">+ ج.م {discountedOptPrice}</span>
                                    <span className="text-[10px] text-gray-400 line-through">+ ج.م {opt.price}</span>
                                  </>
                                ) : `+ ج.م ${opt.price}`}
                              </span>
                            ) : (
                              <span className="text-[13px] text-gray-400 font-medium">أساسي</span>
                            )}
                            <input type={group.max === 1 ? 'radio' : 'checkbox'} checked={isSelected} disabled={isDisabled} onChange={() => handleModifierSelection(gIndex, oIndex, group.max)} className="hidden" />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {/* 4. الملاحظات */}
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm p-3">
                <h4 className="font-bold text-gray-800 text-[14px] mb-2">الملاحظات</h4>
                <textarea rows="2" placeholder="أي ملاحظات خاصة بالطلب..." value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-gray-800 text-xs focus:outline-none focus:border-[#FF4500]" />
              </div>
            </div>

            {/* 5. زر الإضافة للسلة */}
            <div className="bg-white p-3 border-t border-gray-200 shrink-0">
              <button onClick={handleAddCustomizedItemToCart} disabled={!isFormValid()} className={`w-full flex items-center justify-between font-bold py-3 px-5 rounded-xl transition ${isFormValid() ? 'bg-[#FF4500] text-white hover:bg-[#E03D00] shadow-lg shadow-orange-500/30' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}>
                <span className="text-sm">{modalFinalPrice} ج.م</span>
                <span className="text-sm">إضافة للسلة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {!isStaffPage && <footer id="footer" onClick={handleSecretLogoClick} className="bg-[#080808] border-t border-[#8d1710] mt-0 text-white/45 py-12 text-center text-xs cursor-default select-none">
        <div className="text-[#ef321b] text-3xl font-black italic mb-3">BAHBAH BURGER</div>
        جميع الحقوق محفوظة © 2026 نص كفتة — Noss Kofta
      </footer>}
    </div>
  );
}

export default App;
