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
