// ============================================================================
// 01 ユーティリティ・定数
// ============================================================================
const APP_VERSION = '1.0.1';

const VEHICLES = {
  car:   { label: '車',       icon: '🚗' },
  train: { label: '電車',     icon: '🚃' },
  plane: { label: '飛行機',   icon: '✈️' },
  ferry: { label: 'フェリー', icon: '⛴️' }
};
const VEHICLE_KEYS = ['car', 'train', 'plane', 'ferry'];

const STATUS_LIST = ['検討中', '計画中', '確定', '旅行中', '精算・記録中', '完了', '中止'];
const STATUS_STYLE = {
  '検討中': 'st-idea', '計画中': 'st-plan', '確定': 'st-fixed', '旅行中': 'st-go',
  '精算・記録中': 'st-settle', '完了': 'st-done', '中止': 'st-cancel'
};

const EXPENSE_CATS = ['宿', '交通', '食費', '入場・体験', '土産', '給油', 'その他'];
const EXPENSE_CAT_ICON = { '宿': '🏨', '交通': '🚃', '食費': '🍜', '入場・体験': '🎟️', '土産': '🎁', '給油': '⛽', 'その他': '🧾' };
const BOOKING_TYPES = ['宿', '交通', '食事', 'アクティビティ', 'その他'];
const BOOKING_ICON = { '宿': '🏨', '交通': '🎫', '食事': '🍽️', 'アクティビティ': '🎯', 'その他': '📌' };
const BOOKING_TO_EXPENSE_CAT = { '宿': '宿', '交通': '交通', '食事': '食費', 'アクティビティ': '入場・体験', 'その他': 'その他' };
const BOOKING_STATUS = ['要予約', '予約済', 'キャンセル'];
const PACK_CATS = ['衣類', '洗面', 'ガジェット', '書類・貴重品', '車載', 'その他'];
const PACK_ICON = { '衣類': '👕', '洗面': '🪥', 'ガジェット': '🔌', '書類・貴重品': '🪪', '車載': '🚙', 'その他': '🎒' };

const CURRENCIES = {
  JPY: { name: '日本円', sym: '¥', dec: 0 }, USD: { name: '米ドル', sym: '$', dec: 2 },
  EUR: { name: 'ユーロ', sym: '€', dec: 2 }, TWD: { name: '台湾ドル', sym: 'NT$', dec: 0 },
  KRW: { name: '韓国ウォン', sym: '₩', dec: 0 }, CNY: { name: '人民元', sym: '元', dec: 2 },
  HKD: { name: '香港ドル', sym: 'HK$', dec: 2 }, THB: { name: 'タイバーツ', sym: '฿', dec: 2 },
  SGD: { name: 'シンガポールドル', sym: 'S$', dec: 2 }, VND: { name: 'ベトナムドン', sym: '₫', dec: 0 },
  PHP: { name: 'フィリピンペソ', sym: '₱', dec: 2 }, MYR: { name: 'マレーシアリンギット', sym: 'RM', dec: 2 },
  IDR: { name: 'インドネシアルピア', sym: 'Rp', dec: 0 }, GBP: { name: '英ポンド', sym: '£', dec: 2 },
  AUD: { name: '豪ドル', sym: 'A$', dec: 2 }, CAD: { name: 'カナダドル', sym: 'C$', dec: 2 },
  CHF: { name: 'スイスフラン', sym: 'CHF', dec: 2 }, NZD: { name: 'NZドル', sym: 'NZ$', dec: 2 },
  MOP: { name: 'マカオパタカ', sym: 'MOP', dec: 2 }, INR: { name: 'インドルピー', sym: '₹', dec: 2 }
};
const COUNTRY_CURRENCY = {
  JP: 'JPY', US: 'USD', TW: 'TWD', KR: 'KRW', CN: 'CNY', HK: 'HKD', TH: 'THB', SG: 'SGD',
  VN: 'VND', PH: 'PHP', MY: 'MYR', ID: 'IDR', GB: 'GBP', AU: 'AUD', CA: 'CAD', CH: 'CHF',
  NZ: 'NZD', MO: 'MOP', IN: 'INR', GU: 'USD', MP: 'USD',
  FR: 'EUR', DE: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR',
  FI: 'EUR', IE: 'EUR', GR: 'EUR', LU: 'EUR', SK: 'EUR', SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', HR: 'EUR', MT: 'EUR', CY: 'EUR'
};

const WEATHER_ICON = (code) => {
  if (code == null) return '—';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '🌨️';
  return '⛈️';
};

const WD = ['日', '月', '火', '水', '木', '金', '土'];

// ---------------------------------------------------------------------------
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }
function num(v, d) { const n = Number(String(v == null ? '' : v).replace(/[,，\s]/g, '')); return isFinite(n) && String(v).trim() !== '' ? n : (d === undefined ? 0 : d); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function sum(arr, f) { return arr.reduce((s, x) => s + (f ? f(x) : x), 0); }
function debounce(fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); }; }
function nowMs() { return Date.now(); }

// ---- 日付（'YYYY-MM-DD' ローカル） ----
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function parseYmd(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
function diffDays(a, b) { return Math.round((parseYmd(b) - parseYmd(a)) / 86400000); }
function dateRange(a, b) { const out = []; if (!a) return out; b = b || a; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
function weekday(s) { return parseYmd(s).getDay(); }
function fmtDate(s, withWd) {
  if (!s) return '未定';
  const d = parseYmd(s);
  return (d.getMonth() + 1) + '/' + d.getDate() + (withWd === false ? '' : '(' + WD[d.getDay()] + ')');
}
function fmtDateFull(s) { if (!s) return '未定'; const d = parseYmd(s); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + '(' + WD[d.getDay()] + ')'; }
function todayStr() { return ymd(new Date()); }

// ---- 時刻（分） ----
function toMin(hhmm) {
  if (hhmm == null || hhmm === '') return null;
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function fromMin(m) {
  if (m == null || !isFinite(m)) return '';
  m = Math.round(m);
  const neg = m < 0; m = Math.abs(m);
  const h = Math.floor(m / 60), mm = m % 60;
  return (neg ? '-' : '') + pad2(h) + ':' + pad2(mm);
}
function fmtMinLabel(m) { // 翌日表記つき
  if (m == null) return '';
  if (m >= 1440) return '翌' + fromMin(m - 1440);
  return fromMin(m);
}
function fmtDuration(min) {
  if (min == null || !isFinite(min)) return '—';
  min = Math.round(min);
  if (min < 60) return min + '分';
  const h = Math.floor(min / 60), m = min % 60;
  return h + '時間' + (m ? m + '分' : '');
}
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; }

// ---- 距離 ----
function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function fmtKm(km) {
  if (km == null || !isFinite(km)) return '—';
  if (km < 1) return Math.round(km * 1000) + 'm';
  if (km < 10) return km.toFixed(1) + 'km';
  return Math.round(km) + 'km';
}
// 直線距離からの概算所要時間（分）
function estimateMinutes(km, mode) {
  if (km == null) return null;
  switch (mode) {
    case 'train': return Math.round(km * 1.3 / 45 * 60 + 15);
    case 'plane': return Math.round(km / 650 * 60 + 90);
    case 'ferry': return Math.round(km / 30 * 60 + 30);
    case 'walk': return Math.round(km * 1.3 / 4.5 * 60);
    default: return Math.round(km * 1.35 / 40 * 60);
  }
}

// ---- 金額 ----
function curDec(cur) { return (CURRENCIES[cur] || { dec: 2 }).dec; }
function roundCur(v, cur) { const p = Math.pow(10, curDec(cur)); return Math.round(v * p) / p; }
function fmtMoney(v, cur) {
  cur = cur || 'JPY';
  const c = CURRENCIES[cur] || { sym: cur + ' ', dec: 2 };
  if (v == null || !isFinite(v)) return '—';
  const neg = v < 0;
  const s = Math.abs(v).toLocaleString('ja-JP', { minimumFractionDigits: c.dec, maximumFractionDigits: c.dec });
  return (neg ? '−' : '') + c.sym + s;
}
function currencyOptions(sel) {
  return Object.keys(CURRENCIES).map(k => `<option value="${k}" ${k === sel ? 'selected' : ''}>${k} ${esc(CURRENCIES[k].name)}</option>`).join('');
}

// 安全な電卓式評価（+ − × ÷ と括弧）
function evalExpr(src) {
  const s = String(src).replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '').replace(/\s/g, '');
  let i = 0;
  function peek() { return s[i]; }
  function number() {
    let st = i;
    while (i < s.length && /[0-9.]/.test(s[i])) i++;
    if (st === i) throw new Error('式が不正です');
    return parseFloat(s.slice(st, i));
  }
  function factor() {
    if (peek() === '-') { i++; return -factor(); }
    if (peek() === '+') { i++; return factor(); }
    if (peek() === '(') { i++; const v = expr(); if (peek() !== ')') throw new Error('括弧が閉じていません'); i++; return v; }
    let v = number();
    if (peek() === '%') { i++; v = v / 100; }
    return v;
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') {
      const op = s[i++]; const r = factor();
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') {
      const op = s[i++]; const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  if (!s) return 0;
  const v = expr();
  if (i !== s.length) throw new Error('式が不正です');
  if (!isFinite(v)) throw new Error('計算できません');
  return v;
}

function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return (h >>> 0).toString(36); }

function mapsDirUrl(dest, mode) {
  if (!dest) return '#';
  const tm = mode === 'train' ? 'transit' : (mode === 'walk' ? 'walking' : 'driving');
  const d = dest.lat != null ? (dest.lat + ',' + dest.lng) : encodeURIComponent(dest.address || dest.name || '');
  return 'https://www.google.com/maps/dir/?api=1&destination=' + d + '&travelmode=' + tm;
}
function mapsSearchUrl(p) {
  if (!p) return '#';
  const q = p.lat != null ? (p.lat + ',' + p.lng) : (p.address || p.name || '');
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
}
