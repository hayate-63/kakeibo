// GAS-v1.0.txt の動作確認（SpreadsheetApp 等をメモリ上のモックで置き換えて実行）
// 実行: node trader-tax/tests/gas-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const cells = []; // 2D, 1-based via helpers
  const sh = {
    name,
    _cells: cells,
    getLastRow() { for (let r = cells.length; r >= 1; r--) { if ((cells[r - 1] || []).some(v => v !== '' && v !== undefined)) return r; } return 0; },
    getLastColumn() { let m = 0; cells.forEach(row => { for (let c = row.length; c >= 1; c--) { if (row[c - 1] !== '' && row[c - 1] !== undefined) { m = Math.max(m, c); break; } } }); return m; },
    getMaxRows() { return 1000; },
    setFrozenRows() {},
    deleteRow(r) { cells.splice(r - 1, 1); },
    getRange(r, c, nr = 1, nc = 1) {
      const rng = {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) { const v = (cells[r - 1 + i] || [])[c - 1 + j]; row.push(v === undefined ? '' : v); } out.push(row); } return out; },
        setValues(vals) { vals.forEach((row, i) => { cells[r - 1 + i] = cells[r - 1 + i] || []; row.forEach((v, j) => { cells[r - 1 + i][c - 1 + j] = v; }); }); return rng; },
        setValue(v) { cells[r - 1] = cells[r - 1] || []; cells[r - 1][c - 1] = v; return rng; },
        clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) { if (cells[r - 1 + i]) cells[r - 1 + i][c - 1 + j] = ''; } return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; }, setBackground() { return rng; }
      };
      return rng;
    }
  };
  return sh;
}
const sheets = {};
const ss = {
  getSheetByName: n => sheets[n] || null,
  insertSheet: n => (sheets[n] = makeSheet(n)),
  getSheets: () => Object.values(sheets),
  deleteSheet: s => { delete sheets[s.name]; }
};
const props = {};
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); }, flush() {} },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  Utilities: { formatDate: d => d.toISOString().slice(0, 10) },
  Session: { getScriptTimeZone: () => 'Asia/Tokyo' },
  Logger: { log() {} },
  JSON, Number, String, Object, Array, Math, Date, isFinite
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'GAS-v1.0.txt'), 'utf8'), ctx);

let pass = 0, fail = 0;
const lines = [];
function eq(label, a, b) { const ok = JSON.stringify(a) === JSON.stringify(b); lines.push(`${ok ? 'PASS' : 'FAIL'}  ${label}: 期待 ${JSON.stringify(b)} / 実際 ${JSON.stringify(a)}`); ok ? pass++ : fail++; }
function post(body) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).s); }

ctx.initializeSheets();
eq('初期化で8タブ作成', Object.keys(sheets).sort(), ['annual_reports', 'carryover', 'dividends', 'holdings', 'margin_positions', 'margin_settlements', 'settings', 'trades']);
eq('PIN未設定はエラー', post({ action: 'getAll', pin: '1234' }).code, 'NO_PIN');
props.APP_PIN = '1234';
eq('PIN不一致はエラー', post({ action: 'getAll', pin: '9999' }).code, 'PIN');
let r = post({ action: 'getAll', pin: '1234' });
eq('getAll ok / rev 0', [r.status, r.rev], ['ok', 0]);

r = post({ action: 'addTrade', pin: '1234', rev: 0, payload: { row: { id: 'T1', seq: 1, tradeDate: '2027-01-05', settleDate: '2027-01-07', account: '一般', code: '130A', name: 'x', side: '買', qty: 100, price: 1000.5, amount: 100050, fee: 0, realizedPnl: '', source: '手入力' } } });
eq('addTrade 成功で rev+1', [r.status, r.rev], ['ok', 1]);
r = post({ action: 'addDividend', pin: '1234', rev: 0, payload: { row: { id: 'D1', date: '2027-03-01', amount: 1000 } } });
eq('古い rev は conflict', r.status, 'conflict');
r = post({ action: 'bulkAddTrades', pin: '1234', rev: 1, payload: { rows: [{ id: 'T2', tradeDate: '2027-02-01', side: '売', qty: 50, price: 1100 }, { id: 'T3', tradeDate: '2027-02-02', side: '売', qty: 50, price: 1200 }] } });
eq('bulkAddTrades', r.rev, 2);
r = post({ action: 'deleteTrade', pin: '1234', rev: 2, payload: { id: 'T2' } });
r = post({ action: 'addMarginPosition', pin: '1234', rev: 3, payload: { row: { id: 'P1', openDate: '2027-01-10', side: '買建', qty: 100, openPrice: 2000, status: '未決済' } } });
r = post({ action: 'addMarginSettlement', pin: '1234', rev: 4, payload: { row: { id: 'S1', positionId: 'P1', settleDate: '2027-02-10', type: '返済', qty: 100, closePrice: 2200 }, positionStatuses: { P1: '決済済' } } });
r = post({ action: 'saveAnnualReport', pin: '1234', rev: 5, payload: { row: { id: '2027_上場分', year: 2027, kind: '上場分', net: -50000 } } });
r = post({ action: 'saveAnnualReport', pin: '1234', rev: 6, payload: { row: { id: '2027_上場分', year: 2027, kind: '上場分', net: -60000 } } });
r = post({ action: 'saveCarryover', pin: '1234', rev: 7, payload: { row: { year: 2027, filed: 'TRUE', allocOverride: '{}' } } });
r = post({ action: 'saveSettings', pin: '1234', rev: 8, payload: { items: [{ key: 'salaryIncome', value: '3000000' }, { key: 'divChoice_2027', value: '申告分離' }] } });
r = post({ action: 'saveSettings', pin: '1234', rev: 9, payload: { items: [{ key: 'salaryIncome', value: '3200000' }] } });
r = post({ action: 'saveHoldings', pin: '1234', rev: 10, payload: { rows: [{ id: 'H1', asOfDate: '2027-01-01', account: '一般', code: '1111', qty: 3, costTotal: 10001 }] } });
r = post({ action: 'addDividend', pin: '1234', rev: 11, payload: { row: { id: 'D1', date: '2027-03-01', amount: 1000 } } });
r = post({ action: 'deleteMarginPosition', pin: '1234', rev: 12, payload: { id: 'P1' } });
eq('一連の書込み後の rev', r.rev, 13);
r = post({ action: 'unknown', pin: '1234', rev: 13, payload: {} });
eq('不明アクションはエラー', r.status, 'error');

const all = post({ action: 'getAll', pin: '1234' });
const d = all.data;
eq('trades: T2 削除・T1/T3 残存', d.trades.map(t => t.id), ['T1', 'T3']);
eq('英字入り銘柄コードは文字列のまま', d.trades[0].code, '130A');
eq('単価の小数保持', d.trades[0].price, 1000.5);
eq('空欄の数値は空欄', d.trades[0].realizedPnl, '');
eq('annual_reports は年×勘定で1レコード（上書き）', d.annual_reports.map(x => [x.year, x.kind, x.net]), [[2027, '上場分', -60000]]);
eq('settings upsert', d.settings.filter(s => s.key === 'salaryIncome').map(s => s.value), ['3200000']);
eq('carryover filed', d.carryover[0].filed, 'TRUE');
eq('holdings 置換', d.holdings.map(h => [h.code, h.costTotal]), [['1111', 10001]]);
eq('建玉削除で決済も削除', [d.margin_positions.length, d.margin_settlements.length], [0, 0]);
eq('dividends', d.dividends.length, 1);

// 決済で建玉の状態が更新されること（削除前の確認を別系統で）
post({ action: 'addMarginPosition', pin: '1234', rev: 13, payload: { row: { id: 'P2', side: '売建', qty: 100, status: '未決済' } } });
post({ action: 'addMarginSettlement', pin: '1234', rev: 14, payload: { row: { id: 'S2', positionId: 'P2', type: '返済', qty: 40 }, positionStatuses: { P2: '一部決済' } } });
eq('positionStatuses で建玉の状態更新', post({ action: 'getAll', pin: '1234' }).data.margin_positions[0].status, '一部決済');

console.log(lines.join('\n'));
console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
