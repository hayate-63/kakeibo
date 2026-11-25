// ============================================================================
// 03 状態・保存・同期・スポット帳参照・旅ステータス
// ============================================================================
const CACHE_KEY = 'tabicho_cache_v1';

const DEFAULT_SETTINGS = () => ({
  myName: '自分',
  home: { name: '自宅（亀山）', lat: 34.8556, lng: 136.4517 },
  dayStart: '09:00',
  departMarginMin: 10,
  memberPresets: [{ id: 'pr1', name: 'ひとり旅', members: ['自分'] }],
  // 家計簿 v7.0 のカテゴリー（支払方法）に合わせた初期値
  payMethods: [
    { id: 'cash', name: '現金', kakeiboCategory: 'その他（支出）', isCard: false, isCash: true },
    { id: 'paypay', name: 'PayPay', kakeiboCategory: 'PayPay', isCard: false },
    { id: 'smbc', name: '三井住友ゴールド(NL)', kakeiboCategory: '三井住友ゴールド(NL)', isCard: true },
    { id: 'olive', name: 'Olive クレジット', kakeiboCategory: 'Olive クレジット', isCard: true },
    { id: 'paypaycard', name: 'PayPayカード', kakeiboCategory: 'PayPayカード', isCard: true },
    { id: 'amazon', name: 'Amazonマスター', kakeiboCategory: 'Amazonマスター', isCard: true },
    { id: 'mercard', name: 'mercard', kakeiboCategory: 'mercard', isCard: true },
    { id: 'gas', name: 'ガソリン代（給油用カード）', kakeiboCategory: 'ガソリン代', isCard: true },
    { id: 'supay', name: 'SU-PAY', kakeiboCategory: 'SU-PAY', isCard: false },
    { id: 'olivedebit', name: 'Oliveデビット', kakeiboCategory: 'Oliveデビット', isCard: false }
  ],  kakeiboUsage: 'イベント・旅行・レジャー',
  kakeiboBudget: '特別費・レジャー',
  kakeiboIncomeCategory: '割り勘',
  fuelEfficiency: 15,   // km/L（提案の概算用）
  fuelPrice: 170,       // 円/L
  mealPerPerson: 1500,  // 1食あたり（提案の概算用）
  lodgingPerPerson: 10000,
  packCustom: [],       // 自分用の持ち物テンプレ追加 [{cat,name,when}]
  // v2.0 メディア：既定は保留（手動送信）。写真と動画で別々に自動送信へ切替できる
  media: { autoPhoto: false, autoVideo: false, confirmMB: 100, chunkMB: 4 }
});

const S = {
  settings: DEFAULT_SETTINGS(),
  trips: {},
  curTripId: null,
  tab: 'home',
  spots: {},            // spotId -> spot（スポット帳の最新）
  hours: {},            // spotId -> { week, at }（place_id から取った営業時間。オフライン用に端末にも保存）
  spotsState: 'idle',   // idle|loading|ok|error|off
  spotsError: '',
  spotsAt: 0,
  geo: null,            // {lat,lng,acc,at}
  geoError: '',
  routeCache: {},
  weatherCache: {},
  fx: null,             // {toJpy:{}, at}
  sync: 'idle',         // idle|saving|ok|offline|error
  dirty: {},            // tripId -> true
  settingsDirty: false,
  serverMock: false,
  ui: {
    shioriSub: 'plan', shioriDay: {}, listSort: 'distance', listCollapsed: false, doneCollapsed: true,
    moneySub: 'list', recordDay: null, drivePick: null, homeShowArchive: false, fxCalc: { cur: null, amount: '' }
  }
};

function curTrip() { return S.curTripId ? S.trips[S.curTripId] : null; }

// ---------------------------------------------------------------------------
// 旅の雛形
// ---------------------------------------------------------------------------
function newTrip(o) {
  o = o || {};
  const me = S.settings.myName || '自分';
  const t = {
    id: uid('tr'),
    createdAt: new Date().toISOString(),
    updatedAt: '',
    title: o.title || '新しい旅',
    emoji: o.emoji || '',
    startDate: o.startDate || null,
    endDate: o.endDate || null,
    mode: o.mode || 'list',
    members: (o.members && o.members.length ? o.members : [me]).map(n => typeof n === 'string' ? { id: uid('m'), name: n, isMe: n === me } : n),
    area: o.area || '',
    origin: o.origin || clone(S.settings.home),
    budget: o.budget || null,
    vehicles: o.vehicles || ['car'],
    memo: o.memo || '',
    manualStatus: null,       // 中止／完了 だけ手動
    currency: o.currency || 'JPY',
    settleJpyRate: null,      // 精算通貨が円以外の時の円換算
    listTransport: { mode: (o.vehicles && o.vehicles[0]) || 'car', highway: true, toll: true },
    items: [],
    bookings: [],
    packing: [],
    expenses: [],
    fuel: [],
    odometer: [],             // [{date, depart, arrive}]
    exchanges: [],            // [{id,date,dir:'buy'|'sell',jpy,amount,currency}]
    fxClose: {},              // currency -> 'open'|'returned'|'carry'
    settlement: { signature: '', transfers: {}, notice: '' },
    record: { days: {}, rating: 0, comment: '', photoUrl: '', done: false },
    driveTargetId: null,
    // v2.0
    titleEn: '',              // 英語タイトル（ビジュアルの表紙文字。V2）
    titleEnAuto: '', titleEnAutoSrc: '',  // 未入力時の自動英語化の控え（元のタイトルが変わったら作り直す）
    region: '',               // 'domestic' | 'overseas'（作成時に行き先から自動判定、手動変更可）
    regionManual: false,
    driveFolderId: '', driveFolderName: '', driveFolderRegion: '',  // 最初のメディア追加時に作成。以後は固定（M7）
    media: [],                // 写真・動画 [{id,fileId,kind,name,size,mimeType,takenAt,date,dateSource,spotId,itemId,favorite,cover,comment,createdAt,...}]
    albums: [],               // 外部アルバム URL（複数・タイトル付き。M6）
    coverLink: '',            // 代表写真のリンク指定（任意）
    visual: { dayPicks: {}, coverMediaId: '' }
  };
  t.region = t.region || detectRegion(t);
  if (!t.members.some(m => m.isMe) && t.members.length) t.members[0].isMe = true;
  return t;
}

function newItem(o) {
  return Object.assign({
    id: uid('it'), kind: 'spot', spotId: null, nameCache: '', name: '', lat: null, lng: null, address: '',
    hoursText: '', date: null, start: null, startManual: false, stay: 60, moveAfter: null, moveAuto: true, moveInfo: null,
    locked: false, hiddenTime: null, priority: 'maybe', stayEst: null, priceEst: null, needsBooking: false,
    bookingId: null, memo: '', parkingMemo: '', visited: null, order: Date.now(), transport: null, wantSpotRegister: false
  }, o || {});
}

// 国内／海外の自動判定（行き先エリア・精算通貨から）
const OVERSEAS_RE = /台湾|台北|台中|台南|高雄|韓国|ソウル|釜山|済州|中国|上海|北京|香港|マカオ|タイ|バンコク|プーケット|ベトナム|ハノイ|ホーチミン|ダナン|シンガポール|マレーシア|クアラルンプール|インドネシア|バリ|フィリピン|セブ|マニラ|インド|ハワイ|ホノルル|グアム|サイパン|アメリカ|米国|ニューヨーク|ロサンゼルス|ラスベガス|サンフランシスコ|カナダ|バンクーバー|メキシコ|イギリス|英国|ロンドン|フランス|パリ|イタリア|ローマ|ミラノ|ベネチア|スペイン|バルセロナ|ドイツ|スイス|オーストリア|ウィーン|オランダ|ベルギー|チェコ|プラハ|ギリシャ|トルコ|イスタンブール|ドバイ|エジプト|オーストラリア|シドニー|メルボルン|ケアンズ|ニュージーランド|海外/;
function detectRegion(t) {
  if (t.currency && t.currency !== 'JPY') return 'overseas';
  if (OVERSEAS_RE.test(String(t.area || '') + ' ' + String(t.title || ''))) return 'overseas';
  return 'domestic';
}

function meMember(trip) { return trip.members.find(m => m.isMe) || trip.members[0]; }
function memberName(trip, id) { const m = trip.members.find(x => x.id === id); return m ? m.name : '（削除済み）'; }
function tripDays(trip) { return trip.startDate ? dateRange(trip.startDate, trip.endDate || trip.startDate) : []; }
function isDayTrip(trip) { return trip.startDate && (!trip.endDate || trip.endDate === trip.startDate); }
function nights(trip) { return trip.startDate ? diffDays(trip.startDate, trip.endDate || trip.startDate) : 0; }
function tripEmoji(trip) { return trip.emoji || (VEHICLES[trip.vehicles[0]] || VEHICLES.car).icon; }
function hasVehicle(trip, v) { return (trip.vehicles || []).includes(v); }

// ---------------------------------------------------------------------------
// ステータス自動判定（検討中への登録と完了／中止だけ手動）
// ---------------------------------------------------------------------------
function pendingBookingCount(trip) {
  let n = trip.bookings.filter(b => b.status === '要予約').length;
  n += trip.items.filter(it => it.needsBooking && !(it.bookingId && trip.bookings.some(b => b.id === it.bookingId && b.status === '予約済'))
    && !(it.bookingId && trip.bookings.some(b => b.id === it.bookingId && b.status === '要予約'))).length;
  return n;
}
function tripStatus(trip, today) {
  today = today || todayStr();
  if (trip.manualStatus === '中止') return '中止';
  if (trip.manualStatus === '完了') return '完了';
  if (!trip.startDate) return '検討中';
  const end = trip.endDate || trip.startDate;
  if (today < trip.startDate) {
    const booked = trip.bookings.some(b => b.status === '予約済');
    return (pendingBookingCount(trip) === 0 && booked) ? '確定' : '計画中';
  }
  if (today <= end) return '旅行中';
  return '精算・記録中';
}

// ---------------------------------------------------------------------------
// スポット参照（参照方式：名前・座標・営業時間は常にスポット帳の最新）
// ---------------------------------------------------------------------------
function itemInfo(trip, it) {
  const sp = it.spotId ? S.spots[it.spotId] : null;
  const deleted = !!(it.spotId && S.spotsState === 'ok' && !sp);
  const base = {
    name: it.name || it.nameCache || '（名称未設定）', lat: it.lat, lng: it.lng, address: it.address,
    hoursText: it.hoursText || '', tags: [], priority: it.priority, stay: it.stayEst, price: it.priceEst,
    parking: null, station: '', url: '', spot: null, deleted, area: ''
  };
  if (sp) {
    base.name = sp.name || base.name;
    base.lat = sp.lat != null && sp.lat !== '' ? Number(sp.lat) : base.lat;
    base.lng = sp.lng != null && sp.lng !== '' ? Number(sp.lng) : base.lng;
    base.address = sp.address || base.address;
    // 営業時間：旅帳で手入力したもの → Google（place_id）から取ったもの の順
    if (!it.hoursText && S.hours[sp.id] && S.hours[sp.id].week) { base.hoursRaw = S.hours[sp.id].week; base.hoursFrom = 'Google'; }
    base.tags = sp.tags || [];
    base.stay = it.stayEst != null ? it.stayEst : sp.stayMin;
    base.price = it.priceEst != null ? it.priceEst : sp.price;
    base.parking = sp.parking;
    base.station = sp.station || '';
    base.url = sp.url || '';
    base.area = sp.area || '';
    base.spot = sp;
  } else if (deleted) {
    base.name = it.nameCache || it.name || '（削除済みスポット）';
  }
  if (base.lat === '' || base.lat == null || isNaN(base.lat)) { base.lat = null; base.lng = null; }
  base.hours = parseHours(base.hoursRaw || base.hoursText);
  if (base.hoursRaw) base.hoursText = hoursSummary(base.hours);
  return base;
}
function itemPoint(trip, it) { const i = itemInfo(trip, it); return i.lat != null ? { lat: i.lat, lng: i.lng, name: i.name, address: i.address } : null; }

async function loadSpots(force) {
  if (S.spotsState === 'loading') return;
  if (!force && S.spotsState === 'ok' && Date.now() - S.spotsAt < 60 * 1000) return;
  S.spotsState = 'loading';
  try {
    const r = await api('spotList');
    const map = {};
    (r.spots || []).forEach(s => { map[String(s.id)] = normalizeSpot(s); });
    S.spots = map; S.spotsState = 'ok'; S.spotsAt = Date.now(); S.spotsError = '';
    reconcileVisits();
    loadHours();
  } catch (e) {
    S.spotsState = 'error'; S.spotsError = e.message || String(e);
  }
  render();
}
function normalizeSpot(s) {
  const o = Object.assign({}, s);
  o.id = String(o.id);
  o.lat = o.lat === '' || o.lat == null ? null : Number(o.lat);
  o.lng = o.lng === '' || o.lng == null ? null : Number(o.lng);
  if (typeof o.tags === 'string') o.tags = o.tags.split(/[,、\s#]+/).filter(Boolean);
  o.tags = o.tags || [];
  if (o.priority === '絶対行きたい') o.priority = 'must';
  if (o.priority === '行けたら') o.priority = 'maybe';
  if (o.status === '行った') o.status = 'visited';
  if (o.status === '行きたい') o.status = 'want';
  if (typeof o.parking === 'string') o.parking = /有|あり|○|true|yes/i.test(o.parking) ? true : (/無|なし|×|false|no/i.test(o.parking) ? false : o.parking);
  o.stayMin = o.stayMin != null && o.stayMin !== '' ? Number(o.stayMin) : null;
  o.price = o.price != null && o.price !== '' ? Number(o.price) : null;
  o.visits = o.visits || [];
  return o;
}

// 旅帳が作った訪問記録（visit_id）をスポット帳の最新に合わせる。
// 旅帳の書き戻しは即時なので、書き戻し済みの記録はスポット帳側を正とする（スポット帳で編集・削除された分を取り込む）。
// 未送信（_visitPending）のものは旅帳側を正として次回再送する
function reconcileVisits() {
  Object.values(S.trips).forEach(trip => {
    let changed = false;
    trip.items.forEach(it => {
      if (!it.spotId) return;
      const sp = S.spots[it.spotId];
      if (!sp) return;
      if (sp.name && it.nameCache !== sp.name) { it.nameCache = sp.name; changed = true; }
      const local = it.visited;
      if (!local || !local.visitId || it._visitPending) return;
      const remote = (sp.visits || []).find(v => v.visitId === local.visitId);
      if (!remote) { it.visited = null; changed = true; return; }   // スポット帳で訪問記録が消された
      const next = Object.assign({}, local, { date: remote.date, rating: Number(remote.rating) || 0, comment: remote.comment || '', companions: remote.companions && remote.companions.length ? remote.companions : (local.companions || []) });
      if (JSON.stringify(next) !== JSON.stringify(local)) { it.visited = next; changed = true; }
    });
    if (changed) commitTrip(trip, { silent: true });
  });
}

// 営業時間：旅に入っているスポットだけ、place_id から取る（1日1回。結果は端末にも保存）
let hoursLoading = false;
async function loadHours(force) {
  if (hoursLoading) return;
  const need = {};
  Object.values(S.trips).forEach(t => {
    if (t._deleted || ['完了', '中止'].includes(tripStatus(t))) return;
    t.items.forEach(it => {
      const sp = it.spotId && S.spots[it.spotId];
      if (!sp || !sp.placeId) return;
      const h = S.hours[sp.id];
      if (!force && h && Date.now() - h.at < 24 * 3600e3) return;
      need[sp.id] = { id: sp.id, placeId: sp.placeId };
    });
  });
  const list = Object.values(need);
  if (!list.length) return;
  hoursLoading = true;
  try {
    for (let i = 0; i < list.length; i += 40) {
      const r = await api('placeHours', { spots: list.slice(i, i + 40) });
      Object.keys(r.hours || {}).forEach(id => { S.hours[id] = { week: r.hours[id], at: Date.now() }; });
    }
    saveCache();
    render();
  } catch (e) { /* 営業時間は任意。取れなければ情報なし表示 */ }
  hoursLoading = false;
}

// ---------------------------------------------------------------------------
// 保存：ローカルキャッシュ（オフライン可）→ サーバへ遅延保存（他端末更新の衝突検知つき）
// ---------------------------------------------------------------------------
function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      settings: S.settings, trips: S.trips, curTripId: S.curTripId, dirty: S.dirty, settingsDirty: S.settingsDirty, ui: { listSort: S.ui.listSort }, hours: S.hours
    }));
  } catch (e) { console.warn(e); }
}
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (!c) return false;
    S.settings = Object.assign(DEFAULT_SETTINGS(), c.settings || {});
    S.trips = c.trips || {};
    S.curTripId = c.curTripId || null;
    S.dirty = c.dirty || {};
    S.settingsDirty = !!c.settingsDirty;
    S.hours = c.hours || {};
    if (c.ui && c.ui.listSort) S.ui.listSort = c.ui.listSort;
    Object.values(S.trips).forEach(migrateTrip);
    return true;
  } catch (e) { return false; }
}
function migrateTrip(t) {
  const d = newTrip({});
  Object.keys(d).forEach(k => { if (t[k] === undefined) t[k] = clone(d[k]); });
  t.items = (t.items || []).map(i => Object.assign(newItem(), i));
  if (!t.record.days) t.record.days = {};
  // v1 の「代表写真のリンク」はアルバム URL へ移す（Q9 の置き換え）
  if (t.record.photoUrl && !t.albums.some(a => a.url === t.record.photoUrl)) {
    t.albums.push({ id: uid('al'), title: 'アルバム', url: t.record.photoUrl });
    t.record.photoUrl = '';
  }
  if (!t.region) t.region = detectRegion(t);
  if (!t.visual) t.visual = { dayPicks: {}, coverMediaId: '' };
  if (!t.visual.dayPicks) t.visual.dayPicks = {};
  return t;
}

function commitTrip(trip, opt) {
  opt = opt || {};
  S.trips[trip.id] = trip;
  // 精算チェック後の支出変更検知（どの画面で変えても）
  if (typeof reconcileSettlement === 'function') reconcileSettlement(trip);
  trip._rev = (trip._rev || 0) + 1;
  S.dirty[trip.id] = true;
  saveCache();
  queueSave();
  // 新しく入ったスポットの営業時間（足りない分だけ取る）
  if (typeof loadHours === 'function' && S.spotsState === 'ok') setTimeout(() => loadHours(), 0);
  if (!opt.silent && !opt.noRender) render();
}
function commitSettings() {
  S.settingsDirty = true; saveCache(); queueSave(); render();
}

const queueSave = debounce(flushSaves, 900);
let saving = false;
async function flushSaves() {
  if (saving) { setTimeout(flushSaves, 800); return; }
  const ids = Object.keys(S.dirty);
  if (!ids.length && !S.settingsDirty) return;
  saving = true; setSync('saving');
  let failed = false;
  try {
    if (S.settingsDirty) {
      await api('saveSettings', { settings: S.settings });
      S.settingsDirty = false;
    }
    for (const id of ids) {
      const trip = S.trips[id];
      if (!trip) { delete S.dirty[id]; continue; }
      if (trip._deleted) {
        await api('deleteTrip', { id });
        delete S.trips[id]; delete S.dirty[id];
        continue;
      }
      const rev = trip._rev;
      const payload = stripPrivate(trip);
      const r = await api('saveTrip', { trip: payload, baseUpdatedAt: trip._base || '' });
      if (r.conflict) {
        const useMine = await confirmDialog(`「${trip.title}」は他の端末で更新されています。\n\nOK＝この端末の内容で上書き\nキャンセル＝他の端末の最新を読み込む`);
        if (useMine) {
          const r2 = await api('saveTrip', { trip: payload, force: true });
          trip.updatedAt = r2.updatedAt; trip._base = r2.updatedAt;
        } else {
          const t = migrateTrip(r.trip); t._base = t.updatedAt; S.trips[id] = t;
          delete S.dirty[id]; render(); continue;
        }
      } else {
        trip.updatedAt = r.updatedAt; trip._base = r.updatedAt;
      }
      // 保存中にさらに編集されていなければ dirty を外す
      if (S.trips[id] && S.trips[id]._rev === rev) delete S.dirty[id];
    }
  } catch (e) {
    failed = true; console.warn('save failed', e);
  }
  saving = false;
  saveCache();
  setSync(failed ? (navigator.onLine === false ? 'offline' : 'error') : 'ok');
}
function stripPrivate(trip) {
  const o = {};
  Object.keys(trip).forEach(k => { if (k[0] !== '_') o[k] = trip[k]; });
  return clone(o);
}
function setSync(s) {
  S.sync = s;
  const b = document.getElementById('syncBadge');
  if (!b) return;
  const label = { idle: '', saving: '⬆️ 保存中', ok: '☁️ 保存済', offline: '📴 オフライン（端末に保存）', error: '⚠️ 未保存・再試行します' }[s] || '';
  b.textContent = label;
  b.className = 'sync-badge sb-' + s;
}
window.addEventListener('online', () => { if (Object.keys(S.dirty).length || S.settingsDirty) flushSaves(); loadSpots(true); });
setInterval(() => { if ((Object.keys(S.dirty).length || S.settingsDirty) && !saving) flushSaves(); }, 60000);

async function bootstrapFromServer() {
  try {
    const r = await api('bootstrap');
    S.serverMock = !!r.mock;
    if (r.settings) {
      if (!S.settingsDirty) S.settings = Object.assign(DEFAULT_SETTINGS(), r.settings);
    } else {
      S.settingsDirty = true;
    }
    const serverIds = new Set();
    (r.trips || []).forEach(t => {
      serverIds.add(t.id);
      const local = S.trips[t.id];
      if (local && S.dirty[t.id]) return;   // 未送信のローカル変更を優先し、送信時に衝突判定
      const m = migrateTrip(t); m._base = m.updatedAt; S.trips[t.id] = m;
    });
    // サーバに無く、ローカルでも未送信でない旅は他端末で削除されたもの
    Object.keys(S.trips).forEach(id => { if (!serverIds.has(id) && !S.dirty[id]) delete S.trips[id]; });
    if (S.curTripId && !S.trips[S.curTripId]) S.curTripId = null;
    saveCache();
    setSync(Object.keys(S.dirty).length || S.settingsDirty ? 'saving' : 'ok');
    if (Object.keys(S.dirty).length || S.settingsDirty) flushSaves();
  } catch (e) {
    setSync(navigator.onLine === false ? 'offline' : 'error');
    toast('サーバに接続できません。端末に保存された内容で表示しています');
  }
}

function pickDefaultTrip() {
  if (S.curTripId && S.trips[S.curTripId] && !S.trips[S.curTripId]._deleted) return;
  const list = Object.values(S.trips).filter(t => !t._deleted);
  const order = ['旅行中', '確定', '計画中', '精算・記録中', '検討中'];
  for (const st of order) {
    const c = list.filter(t => tripStatus(t) === st).sort((a, b) => (a.startDate || '9') < (b.startDate || '9') ? -1 : 1);
    if (c.length) { S.curTripId = c[0].id; return; }
  }
  S.curTripId = list[0] ? list[0].id : null;
}

// ---------------------------------------------------------------------------
// 現在地
// ---------------------------------------------------------------------------
let geoWatch = null;
function startGeo() {
  if (!navigator.geolocation || geoWatch != null) return;
  try {
    geoWatch = navigator.geolocation.watchPosition(p => {
      const prev = S.geo;
      S.geo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() };
      S.geoError = '';
      if (!prev || haversineKm(prev, S.geo) > 0.3) render();
    }, err => { S.geoError = err.message || '現在地を取得できません'; }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 20000 });
  } catch (e) { S.geoError = String(e); }
}
function originPoint(trip) {
  if (S.geo) return { lat: S.geo.lat, lng: S.geo.lng, name: '現在地' };
  const o = (trip && trip.origin) || S.settings.home;
  return o && o.lat != null ? { lat: o.lat, lng: o.lng, name: o.name || '出発地' } : null;
}
