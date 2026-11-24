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
const kk = { rev: 5, logs: [{ id: 100, amount: -500, date: '2026-11-01', memo: 'コンビニ', category: 'PayPay', usageCat: 'コンビニ・飲料', isLegacy: false }], posts: 0, conflictOnce: true };
props.KAKEIBO_URL = 'https://kakeibo/exec'; props.KAKEIBO_PIN = '9999';
ctx.Utilities.sleep = () => {};
ctx.UrlFetchApp.fetch = (url, opt) => {
  const reply = (o) => ({ getContentText: () => JSON.stringify(o), getResponseCode: () => 200 });
  if (!opt || opt.method !== 'post') {
    const q = Object.fromEntries(new URL(url).searchParams);
    if (q.pin !== '9999') return reply({ status: 'unauthorized' });
    if (q.action === 'loadAll') return reply({ status: 'ok', rev: kk.rev, logs: JSON.parse(JSON.stringify(kk.logs)) });
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
const inc = kk.logs.find(l => l.srcRef === 't1:e:x:inc');
assert.ok(!inc.catLock, '割り勘の収入は家計簿の判定に任せる');
const k2 = call('kakeiboSend', { logs });
assert.strictEqual(k2.sent, 0); assert.strictEqual(k2.skipped, 2, '同じ明細は二重に入らない');
assert.strictEqual(kk.logs.length, 4);
props.KAKEIBO_PIN = 'bad';
assert.ok(/PINが一致しません/.test(call('kakeiboSend', { logs }).error));
console.log('kakeibo integration tests passed');
