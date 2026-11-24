// Code.gs の保存処理を、偽のスプレッドシートで検証する: node tabicho/test/gas.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
function fakeSheet(name) {
  const data = [];
  return {
    name, data,
    getLastRow: () => data.length,
    getLastColumn: () => Math.max(0, ...data.map(r => r.length)),
    getMaxColumns: () => 26 + (this.extra || 0),
    insertColumnsAfter() {},
    appendRow: (r) => data.push(r.slice()),
    deleteRow: (i) => data.splice(i - 1, 1),
    setFrozenRows() {},
    getRange(r, c, nr = 1, nc = 1) {
      return {
        getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((data[r - 1 + i] || [])[c - 1 + j]) ?? '')),
        setValues: (v) => v.forEach((row, i) => { data[r - 1 + i] = data[r - 1 + i] || []; row.forEach((x, j) => { data[r - 1 + i][c - 1 + j] = x; }); }),
        setValue: (x) => { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = x; },
        setNumberFormat() {}
      };
    }
  };
}
const sheets = {};
const ss = { getId: () => 'SS', getUrl: () => 'url', getSheets: () => Object.values(sheets), getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = fakeSheet(n)), deleteSheet() {} };
const props = {};
const ctx = {
  console, JSON, Date, Math, Number, String, Object,
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  SpreadsheetApp: { create: () => ss, openById: () => ss },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  HtmlService: {}, CacheService: {}, Utilities: {}, Maps: {}, UrlFetchApp: {}, CalendarApp: {}, ContentService: {}
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx);
const call = (n, a) => JSON.parse(ctx.apiCall(n, JSON.stringify(a)));

const big = { id: 't1', title: '大きい旅', expenses: Array.from({ length: 900 }, (_, i) => ({ id: 'e' + i, desc: '支出'.repeat(20) + i })) };
const r1 = call('saveTrip', { trip: big });
assert.ok(r1.ok);
assert.ok(sheets.trips.data[1].length > 6, '45,000字を超えるJSONは複数セルに分割');
let b = call('bootstrap', {});
assert.strictEqual(b.trips.length, 1);
assert.strictEqual(b.trips[0].expenses.length, 900);
// 衝突検知：古い updatedAt を基準にした保存は conflict
const r2 = call('saveTrip', { trip: Object.assign({}, big, { title: 'B' }), baseUpdatedAt: '2000-01-01T00:00:00.000Z' });
assert.ok(r2.conflict);
const r3 = call('saveTrip', { trip: Object.assign({}, big, { title: 'C', expenses: [] }), baseUpdatedAt: r1.updatedAt });
assert.ok(r3.ok);
b = call('bootstrap', {});
assert.strictEqual(b.trips[0].title, 'C');
assert.strictEqual(b.trips[0].expenses.length, 0, '短くなった時に古い分割セルが残らない');
call('saveSettings', { settings: { myName: 'テスト' } });
assert.strictEqual(call('bootstrap', {}).settings.myName, 'テスト');
call('deleteTrip', { id: 't1' });
assert.strictEqual(call('bootstrap', {}).trips.length, 0);
assert.ok(call('nope', {}).error);
console.log('gas storage tests passed');

// ---- 家計簿連携：家計簿GAS v7.0 の振る舞いを真似た偽サーバ ----
const kk = { rev: 5, logs: [{ id: 100, amount: -500, date: '2026-11-01', memo: 'コンビニ', category: 'PayPay', usageCat: 'コンビニ・飲料', isLegacy: false, bigCat: '支出（即時）', payDate: '2026-11-01', payYM: '2026-11', useYM: '2026-11', useDate: '2026-11-01', budgetCat: '変動費（食費）', absAmount: 500, catLock: '', src: '', srcRef: '' }], posts: 0, conflictOnce: true,
  categories: [
    { name: '三井住友ゴールド(NL)', mode: '支出', bigCat: '支出（クレカ）', closeDay: 31, payMonthOffset: 1, payDay: 26, active: 1, adjust: 'next' },
    { name: 'PayPay', mode: '支出', bigCat: '支出（即時）', closeDay: 0, payMonthOffset: 0, payDay: 0, active: 1, adjust: 'none' },
    { name: 'イオンカード', mode: '支出', bigCat: '支出（クレカ）', closeDay: 10, payMonthOffset: 1, payDay: 2, active: 0 },
    { name: '割り勘', mode: '収入', bigCat: '精算・移動', closeDay: 0, payMonthOffset: 0, payDay: 0, active: 1 }
  ], holidays: ['2026-11-03', '2026-11-23'] };
props.KAKEIBO_URL = 'https://kakeibo/exec'; props.KAKEIBO_PIN = '9999';
ctx.Utilities.sleep = () => {};
ctx.UrlFetchApp.fetch = (url, opt) => {
  const reply = (o) => ({ getContentText: () => JSON.stringify(o), getResponseCode: () => 200 });
  if (!opt || opt.method !== 'post') {
    const q = Object.fromEntries(new URL(url).searchParams);
    if (q.pin !== '9999') return reply({ status: 'unauthorized' });
    if (q.action === 'loadAll') return reply({ status: 'ok', rev: kk.rev, logs: kk.emptyOnce ? [] : JSON.parse(JSON.stringify(kk.logs)), categories: kk.categories, holidays: kk.holidays });
    return reply({ status: 'error', message: '不明な action です' });
  }
  const body = JSON.parse(opt.payload);
  if (body.pin !== '9999') return reply({ status: 'unauthorized' });
  kk.posts++;
  if (kk.conflictOnce) { kk.conflictOnce = false; kk.rev++; kk.logs.push({ id: 101, amount: -300, date: '2026-11-02', memo: '他端末', category: 'PayPay' }); return reply({ status: 'conflict' }); }
  if (Number(body.baseRev) !== kk.rev) return reply({ status: 'conflict' });
  kk.logs = body.logs; kk.rev++;
  return reply({ status: 'saved', rev: kk.rev });
};
const logs = [
  { sourceKey: 't1:e:x:exp', date: '2026-11-30', amount: -30001, memo: '旅館 #淡路島', category: '三井住友ゴールド(NL)', usage: 'イベント・旅行・レジャー', budget: '特別費・レジャー' },
  { sourceKey: 't1:e:x:inc', date: '2026-11-30', amount: 15000, memo: '旅館（割り勘分） #淡路島', category: '割り勘', usage: '', budget: '精算・移動' }
];
let k1 = call('kakeiboSend', { logs });
assert.ok(k1.ok, JSON.stringify(k1));
assert.strictEqual(k1.sent, 2);
assert.strictEqual(kk.posts, 2, '1回目は conflict → 読み直して再送');
assert.ok(kk.logs.some(l => l.id === 101), '他端末で増えた明細を消さない');
assert.ok(kk.logs.some(l => l.id === 100 && l.usageCat === 'コンビニ・飲料'), '既存の明細はそのまま');
const exp = kk.logs.find(l => l.srcRef === 't1:e:x:exp');
assert.strictEqual(exp.catLock, '1'); assert.strictEqual(exp.usageCat, 'イベント・旅行・レジャー'); assert.strictEqual(exp.src, 'tabicho');
// 引落日などの派生項目（家計簿 evaluateEntry と同じ計算）：11/30 利用 → 12/26(土) → 翌営業日 12/28(月)
assert.strictEqual(exp.bigCat, '支出（クレカ）'); assert.strictEqual(exp.payDate, '2026-12-28'); assert.strictEqual(exp.payYM, '2026-12');
assert.strictEqual(exp.useYM, '2026-11'); assert.strictEqual(exp.absAmount, 30001);
assert.deepStrictEqual(Object.keys(kk.logs[0]).filter(k => !(k in exp)), [], '既存明細と同じ列を持つ');
const inc = kk.logs.find(l => l.srcRef === 't1:e:x:inc');
assert.strictEqual(inc.bigCat, '精算・移動');
assert.ok(!inc.catLock, '割り勘の収入は家計簿の判定に任せる');
const k2 = call('kakeiboSend', { logs });
assert.strictEqual(k2.sent, 0); assert.strictEqual(k2.skipped, 2, '同じ明細は二重に入らない');
assert.strictEqual(kk.logs.length, 4);
// 0件で返ってきたら書かない
kk.emptyOnce = true; const before = kk.posts;
assert.ok(/0件/.test(call('kakeiboSend', { logs: [{ sourceKey: 'z1', date: '2026-11-30', amount: -100, memo: 'x', category: 'PayPay', usage: 'u', budget: 'b' }] }).error));
assert.strictEqual(kk.posts, before); kk.emptyOnce = false;
// 無効・存在しないカテゴリーは送らない
assert.ok(/有効なマスタにありません/.test(call('kakeiboSend', { logs: [{ sourceKey: 'z2', date: '2026-11-30', amount: -100, memo: 'x', category: 'イオンカード', usage: 'u', budget: 'b' }] }).error));
assert.strictEqual(kk.posts, before);
props.KAKEIBO_PIN = 'bad';
assert.ok(/PINが一致しません/.test(call('kakeiboSend', { logs }).error));
console.log('kakeibo integration tests passed');

// ---- スポット帳連携：スポット帳 GAS v3.1 の振る舞いを真似た偽サーバ ----
const sp = {
  spots: [
    { id: 'SP0001', place_id: 'ChIJ1', name: '淡路夢舞台', prefecture: '兵庫県', city: '淡路市', categories: '観光地', tags: '建築/絶対行きたい', regions: '淡路島', rep_tag: '建築', address: '兵庫県淡路市夢舞台2', lat: '34.5636', lng: '135.0103', maps_url: 'u', status: '行きたい', rating: '', memo: '', google_saved: '済', coord_source: '', source_lists: '', created_at: '2026-11-01', updated_at: '2026-11-01' },
    { id: 'SP0002', place_id: '', name: '座標なしカフェ', prefecture: '三重県', city: '亀山市', categories: 'カフェ', tags: 'カフェ', regions: '', rep_tag: '', address: '', lat: '', lng: '', maps_url: '', status: '行きたい', rating: '', memo: '', google_saved: '未', coord_source: '', source_lists: '', created_at: '2026-11-01', updated_at: '2026-11-01' }
  ],
  visits: [], seq: 0, calls: []
};
props.SPOTCHO_URL = 'https://spotcho/exec'; props.SPOTCHO_PIN = 'Abc!9';
const spotStatus = (id) => { const s = sp.spots.find(x => x.id === id); s.status = sp.visits.some(v => v.spot_id === id) ? '行った' : '行きたい'; return s; };
ctx.UrlFetchApp.fetch = (url, opt) => {
  const reply = (o) => ({ getContentText: () => JSON.stringify(o), getResponseCode: () => 200 });
  if (url.indexOf('places.googleapis.com') >= 0) {
    return reply({ regularOpeningHours: { periods: [1, 2, 4, 5, 6].map(d => ({ open: { day: d, hour: 9, minute: 0 }, close: { day: d, hour: 17, minute: 30 } })).concat([{ open: { day: 0, hour: 18, minute: 0 }, close: { day: 1, hour: 2, minute: 0 } }]) } });
  }
  const req = JSON.parse(opt.payload);
  sp.calls.push(req.action);
  if (req.pin !== 'Abc!9') return reply({ status: 'error', code: 'AUTH', message: 'PINが一致しません' });
  const V = ['visit_id', 'spot_id', 'date', 'rating', 'menu', 'price', 'companions', 'people', 'comment', 'photos', 'repeat', 'created_at', 'updated_at'];
  switch (req.action) {
    case 'ping': return reply({ status: 'ok' });
    case 'getAll': return reply({ status: 'ok', spots: sp.spots, visits: sp.visits, tags: [], config: {}, serverDate: '2026-11-30' });
    case 'addVisit': {
      const v = {}; V.forEach(h => v[h] = String(req.visit[h] == null ? '' : req.visit[h]));
      if (!/^[1-5]$/.test(v.rating)) return reply({ status: 'error', code: 'VALIDATION', message: '評価（1〜5）を選んでください' });
      v.visit_id = 'V' + String(++sp.seq).padStart(4, '0'); sp.visits.push(v);
      return reply({ status: 'ok', visit: v, spot: spotStatus(v.spot_id) });
    }
    case 'updateVisit': {
      const i = sp.visits.findIndex(x => x.visit_id === req.visit.visit_id);
      if (i < 0) return reply({ status: 'error', code: 'NOT_FOUND', message: 'なし' });
      const v = {}; V.forEach(h => v[h] = String(req.visit[h] == null ? '' : req.visit[h])); sp.visits[i] = v;
      return reply({ status: 'ok', visit: v, spot: spotStatus(v.spot_id) });
    }
    case 'deleteVisit': {
      const v = sp.visits.find(x => x.visit_id === req.visit_id);
      sp.lastDeletePhotos = req.deletePhotos;
      sp.visits = sp.visits.filter(x => x.visit_id !== req.visit_id);
      return reply({ status: 'ok', spot: spotStatus(v.spot_id) });
    }
    case 'addSpot': {
      const s = Object.assign({}, req.spot, { id: 'SP0003', status: '行きたい', regions: '', place_id: '', updated_at: '2026-11-30' });
      sp.spots.push(s); return reply({ status: 'ok', spot: s });
    }
    default: return reply({ status: 'error', code: 'UNKNOWN_ACTION', message: '不明' });
  }
};
const L1 = call('spotList', {});
const s1 = L1.spots.find(x => x.id === 'SP0001');
assert.strictEqual(s1.area, '淡路島'); assert.strictEqual(s1.priority, 'must'); assert.strictEqual(s1.lat, 34.5636);
assert.ok(!s1.tags.includes('絶対行きたい') && s1.tags.includes('建築') && s1.tags.includes('淡路島'));
const s2 = L1.spots.find(x => x.id === 'SP0002');
assert.strictEqual(s2.lat, null); assert.strictEqual(s2.area, '亀山市');
// 評価なしの「行った」は送らない（スポット帳と同じく評価は必須）
assert.ok(/評価/.test(call('spotSetVisited', { spotId: 'SP0001', visit: { date: '2026-11-30', rating: 0 } }).error));
const w1 = call('spotSetVisited', { spotId: 'SP0001', visit: { date: '2026-11-30', rating: 4, comment: '花がきれい', companions: ['自分', '相方'], people: 2 } });
assert.strictEqual(w1.visitId, 'V0001'); assert.strictEqual(w1.spot.status, 'visited');
assert.strictEqual(sp.visits[0].companions, '自分、相方'); assert.strictEqual(sp.visits[0].rating, '4');
// スポット帳で写真・金額を書き足した後、旅帳から編集しても消えない
sp.visits[0].photos = 'file1'; sp.visits[0].price = '1200';
const w2 = call('spotSetVisited', { spotId: 'SP0001', visitId: 'V0001', visit: { date: '2026-11-30', rating: 5, comment: '最高', companions: ['自分'] } });
assert.strictEqual(w2.visitId, 'V0001'); assert.strictEqual(sp.visits.length, 1);
assert.strictEqual(sp.visits[0].photos, 'file1'); assert.strictEqual(sp.visits[0].price, '1200'); assert.strictEqual(sp.visits[0].rating, '5');
assert.ok(w2.spot.visits[0].hasExtras);
// 写真などがある訪問は旅帳から取り消せない
assert.ok(/取り消せません/.test(call('spotSetVisited', { spotId: 'SP0001', visitId: 'V0001', visit: null }).error));
assert.strictEqual(sp.visits.length, 1);
// 書き足しの無い訪問は取り消せる。写真は消さない指定で送る
sp.visits[0].photos = ''; sp.visits[0].price = '';
const w3 = call('spotSetVisited', { spotId: 'SP0001', visitId: 'V0001', visit: null });
assert.ok(w3.ok); assert.strictEqual(sp.visits.length, 0); assert.strictEqual(sp.lastDeletePhotos, false); assert.strictEqual(w3.spot.status, 'want');
// 手入力スポットの登録
const c1 = call('spotCreate', { spot: { name: '旅帳の店', lat: 34.1, lng: 135.1, priority: 'must' } });
assert.strictEqual(c1.spot.id, 'SP0003'); assert.ok(/旅帳から登録/.test(sp.spots[2].memo)); assert.strictEqual(sp.spots[2].tags, '絶対行きたい'); assert.strictEqual(c1.spot.priority, 'must');
// 営業時間（Places の periods → 週の表。期間に無い曜日＝定休、日をまたぐ営業）
props.PLACES_API_KEY = 'k';
ctx.CacheService = { getScriptCache: () => ({ get: () => null, put() {} }) };
const h = call('placeHours', { spots: [{ id: 'SP0001', placeId: 'ChIJ1' }, { id: 'SP0002', placeId: '' }] });
assert.deepStrictEqual(h.hours.SP0001[1], [['09:00', '17:30']]);
assert.strictEqual(h.hours.SP0001[3], 'closed');
assert.deepStrictEqual(h.hours.SP0001[0], [['18:00', '26:00']]);
assert.ok(!('SP0002' in h.hours));
props.SPOTCHO_PIN = 'bad';
assert.ok(/PINが一致しません/.test(call('spotList', {}).error));
console.log('spotcho integration tests passed');
