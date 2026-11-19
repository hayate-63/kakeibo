// GASコード（prototype-gas-v10.txt）を、SpreadsheetApp等の簡易モックの上で実行し、
// テスト手順シートのシナリオを自動で確認する。実環境（Googleスプレッドシート）の代わりではない。
// 実行: TZ=Asia/Tokyo node dev/mock_run.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(ROOT, 'prototype-gas-v10.txt'), 'utf8');
const INITIAL = JSON.parse(fs.readFileSync(path.join(__dirname, 'sheets.json'), 'utf8'));
let NOW = new Date('2026-11-19T12:00:00');

// ---------------- モック ----------------
function colToN(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
function nToCol(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const v = this.cells.get(this.key(r, c)); return v === undefined ? '' : v; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), v); }
  getName() { return this.name; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getRange(a, b, nr, nc) {
    if (typeof a === 'string') { const m = /^([A-Z]+)(\d+)$/.exec(a); return new Range(this, +m[2], colToN(m[1]), 1, 1); }
    return new Range(this, a, b, nr || 1, nc || 1);
  }
}
class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
  getValue() { return this.sh.get(this.r, this.c); }
  setValues(v) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, v[i][j] instanceof Date || (v[i][j] && v[i][j].getTime) ? new Date(v[i][j].getTime()) : v[i][j]); return this; }
  setValue(v) { this.sh.set(this.r, this.c, v && v.getTime ? new Date(v.getTime()) : v); return this; }
  setNumberFormat() { return this; }
  setNumberFormats() { return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
}

let book, alerts, answers, toasts;
function loadBook() {
  book = new Map();
  for (const [name, cells] of Object.entries(INITIAL)) {
    const sh = new Sheet(name);
    for (const [a1, v] of Object.entries(cells)) {
      const m = /^([A-Z]+)(\d+)$/.exec(a1);
      sh.set(+m[2], colToN(m[1]), v && typeof v === 'object' && v.d ? new Date(v.d) : v);
    }
    book.set(name, sh);
  }
}
const ss = {
  getSheetByName: (n) => book.get(n) || null,
  getSpreadsheetTimeZone: () => 'Asia/Tokyo',
  toast: (msg, title) => { toasts.push(title + '：' + msg); },
};
const Button = { YES: 'YES', NO: 'NO', OK: 'OK' };
const ui = {
  Button, ButtonSet: { OK: 'OK', YES_NO: 'YES_NO' },
  alert: (title, msg, set) => { alerts.push(`[${title}]\n${msg}`); if (set === 'YES_NO') return answers.length ? answers.shift() : 'YES'; return 'OK'; },
  createMenu: () => { const m = { addItem: () => m, addSeparator: () => m, addToUi: () => m }; return m; },
};
function pad(n) { return String(n).padStart(2, '0'); }
function fmt(d) { return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }

class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW.getTime()); } }
const ctx = {
  SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui, flush: () => {} },
  LockService: { getDocumentLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  Utilities: { formatDate: (d) => fmt(d) },
  Date: FakeDate, Math, String, Number, Object, Error, parseInt, isNaN,
};
vm.createContext(ctx);
vm.runInContext(CODE, ctx);

// ---------------- 検証ヘルパ ----------------
let fails = 0, passes = 0;
function show(v) { return v instanceof Date || (v && v.getTime) ? fmt(v) : String(v); }
function rows(sheet, fromRow, nCols) {
  const sh = book.get(sheet); const out = [];
  for (let r = fromRow; r <= sh.getLastRow(); r++) out.push(Array.from({ length: nCols }, (_, j) => show(sh.get(r, 1 + j))).join('｜'));
  return out;
}
function cell(sheet, a1) { const m = /^([A-Z]+)(\d+)$/.exec(a1); return show(book.get(sheet).get(+m[2], colToN(m[1]))); }
function eq(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passes++; console.log('  OK   ' + label); }
  else { fails++; console.log('  NG   ' + label + '\n       期待: ' + e + '\n       実際: ' + a); }
}
function has(label, text, sub) { eq(label + ' ⊃ "' + sub + '"', text.includes(sub), true); }
function run(fn, ans) { alerts = []; toasts = []; answers = ans || []; ctx[fn](); return alerts; }
function set(sheet, a1, v) { const m = /^([A-Z]+)(\d+)$/.exec(a1); book.get(sheet).set(+m[2], colToN(m[1]), v); }
function init() { run('initPrototype', ['YES']); }

const S1_1 = [
  '2026/11/17 08:10:00｜2026/11/17 08:10:00｜1010',
  '2026/11/17 09:00:00｜2026/11/17 09:00:00｜1030',
  '2026/11/17 13:05:00｜2026/11/17 13:05:00｜1100',
  '2026/11/17 13:07:00｜2026/11/17 13:07:00｜1101',
  '2026/11/17 13:09:00｜2026/11/17 13:09:00｜1102',
  '2026/11/17 16:00:00｜2026/11/17 16:00:00｜1200',
  '2026/11/18 09:00:00｜2026/11/18 09:00:10｜1300'];
const S1_2 = [
  '2026/11/17 10:15:00｜2026/11/17 10:14:30｜2000',
  '2026/11/17 12:00:00｜2026/11/17 11:59:20｜2020'];
const S1_3 = ['2026/11/18 08:00:00｜2026/11/18 08:00:00｜3010'];
const DEST1 = ['記録先1-1', '記録先1-2', '記録先1-3'], DEST2 = ['記録先2-1', '記録先2-2', '記録先2-3'];
const ALL_DEST = [...DEST1, ...DEST2, '記録先3-1'];

// ---------------- シナリオ ----------------
loadBook();

console.log('X9 開いた時の通知');
alerts = []; toasts = []; ctx.onOpen({});
eq('記録はしない', ALL_DEST.map(d => rows(d, 2, 3).length), [0, 0, 0, 0, 0, 0, 0]);
has('トースト', toasts.join(''), '系列1 7件／系列2 2件／系列3 1件　合計 10件');

console.log('S1 初回の記録実行');
let a = run('recordAll', ['YES']);
has('確認', a[0], '系列1：記録予定 7件');
has('確認', a[0], '系列2：記録予定 2件（照合できず記録しない 1件）');
has('確認', a[0], '系列3：記録予定 1件（照合できず記録しない 1件）');
has('確認', a[0], '合計：10件');
DEST1.forEach(d => eq(d, rows(d, 2, 3), S1_1));
DEST2.forEach(d => eq(d, rows(d, 2, 3), S1_2));
eq('記録先3-1', rows('記録先3-1', 2, 3), S1_3);
eq('設定1 管理欄', [cell('設定1', 'B24'), cell('設定1', 'B25'), cell('設定1', 'B26'), cell('設定1', 'B27')], ['2026/11/18 09:30:00', '18', '2026/11/19 12:00:00', '7']);
eq('設定2 管理欄', [cell('設定2', 'B24'), cell('設定2', 'B25'), cell('設定2', 'B27')], ['2026/11/17 12:30:00', '8', '2']);
eq('設定3 管理欄', [cell('設定3', 'B24'), cell('設定3', 'B25'), cell('設定3', 'B27')], ['2026/11/18 10:30:00', '14', '1']);

console.log('S2 2回目の記録実行');
a = run('recordAll', ['YES']);
has('確認', a[0], '合計：0件');
has('結果', a[1], '系列1：記録 0件');
DEST1.forEach(d => eq(d + ' 変化なし', rows(d, 2, 3), S1_1));
eq('設定1 B24 変化なし', cell('設定1', 'B24'), '2026/11/18 09:30:00');
eq('設定1 B27=0', cell('設定1', 'B27'), '0');

console.log('X5 ポインタを消して再実行（重複チェック）');
set('設定1', 'B24', ''); set('設定1', 'B25', '');
a = run('recordAll', ['YES']);
has('確認', a[0], '系列1：記録予定 7件');
has('結果', a[1], '系列1：記録 0件（重複のため書かなかった 7件）');
DEST1.forEach(d => eq(d + ' 7行のまま', rows(d, 2, 3).length, 7));

console.log('S3 プレビュー（系列2）');
init();
a = run('previewSeries2');
has('表示', a[0], '記録予定：2件');
has('表示', a[0], '期間：2026/11/17 10:15:00 〜 2026/11/17 12:00:00');
has('表示', a[0], '照合できず記録しない：1件');
has('表示', a[0], '2026/11/17 11:00:00 → 記録しない（許容差 60秒 以内に流量計記録なし）');
eq('書き込みなし', ALL_DEST.map(d => rows(d, 2, 3).length), [0, 0, 0, 0, 0, 0, 0]);
eq('管理欄空欄', ['設定1', '設定2', '設定3'].map(s => cell(s, 'B24') + cell(s, 'B26')), ['', '', '']);

console.log('S4 除外期間リセット（系列1）→ 記録実行');
init();
set('操作', 'B7', new Date('2026-11-17T13:00:00'));
set('操作', 'B8', new Date('2026-11-17T14:00:00'));
a = run('resetSeries1');
eq('ダイアログは完了表示1回だけ（確認・警告なし）', a.length, 1);
eq('リセットログ', rows('リセットログ', 2, 5), ['2026/11/19 12:00:00｜系列1｜2026/11/17 13:00:00｜2026/11/17 14:00:00｜2026/11/17 14:00:00']);
eq('設定1 B24/B25', [cell('設定1', 'B24'), cell('設定1', 'B25')], ['2026/11/17 14:00:00', '14']);
eq('設定2/3 は空欄', [cell('設定2', 'B24'), cell('設定3', 'B24')], ['', '']);
a = run('recordAll', ['YES']);
has('確認', a[0], '合計：5件');
DEST1.forEach(d => eq(d, rows(d, 2, 3), S1_1.slice(5)));
DEST2.forEach(d => eq(d, rows(d, 2, 3), S1_2));
eq('記録先3-1', rows('記録先3-1', 2, 3), S1_3);

console.log('S5 設定2 の許容差を120秒に');
init();
set('設定2', 'B19', 120);
a = run('recordAll', ['YES']);
has('確認', a[0], '系列2：記録予定 3件');
has('確認', a[0], '合計：11件');
DEST2.forEach(d => eq(d, rows(d, 2, 3), [S1_2[0], '2026/11/17 11:00:00｜2026/11/17 11:01:30｜2011', S1_2[1]]));
DEST1.forEach(d => eq(d + ' 影響なし', rows(d, 2, 3), S1_1));
eq('記録先3-1 影響なし', rows('記録先3-1', 2, 3), S1_3);
set('設定2', 'B19', 60);

console.log('S6 テスト初期化');
set('操作', 'B12', new Date('2026-11-17T10:00:00'));
run('resetSeries2');
init();
eq('記録先が空', ALL_DEST.map(d => rows(d, 2, 3).length), [0, 0, 0, 0, 0, 0, 0]);
eq('管理欄が空', ['設定1', '設定2', '設定3'].map(s => ['B24', 'B25', 'B26', 'B27'].map(x => cell(s, x)).join('')), ['', '', '']);
eq('リセットログ見出しのみ', book.get('リセットログ').getLastRow(), 1);
eq('除外期間セルが空', ['B7', 'B8', 'B12', 'B13', 'B17', 'B18'].map(x => cell('操作', x)).join(''), '');
eq('抽出は変わらない', cell('抽出1', 'A2'), '2026/11/17 08:00:00');

console.log('X1 走査範囲の先頭（T4）');
set('設定1', 'B24', new Date('2026-11-17T08:00:00'));
has('直前0→記録', run('previewSeries1')[0], '記録予定：7件');
set('設定1', 'B24', new Date('2026-11-17T08:10:00'));
has('直前1→記録しない', run('previewSeries1')[0], '記録予定：6件');
init();

console.log('X2 列の割り当て変更（T11）');
{ // 抽出2 の列を1つ右へずらす
  const sh = book.get('抽出2'); const old = new Map(sh.cells); sh.cells = new Map();
  for (const [k, v] of old) { const [r, c] = k.split(',').map(Number); sh.set(r, c + 1, v); }
  ['B8', 'B9', 'B10', 'B11'].forEach((x, i) => set('設定2', x, 'BCDE'[i]));
  a = run('previewSeries2');
  has('同じ結果', a[0], '記録予定：2件');
  has('同じ結果', a[0], '照合できず記録しない：1件');
  sh.cells = old; ['B8', 'B9', 'B10', 'B11'].forEach((x, i) => set('設定2', x, 'ABCD'[i]));
}

console.log('X3 データ抽出シート名変更（T12）');
{
  const copy = new Sheet('抽出1改'); copy.cells = new Map(book.get('抽出1').cells); book.set('抽出1改', copy);
  set('設定1', 'B6', '抽出1改');
  has('1回目', run('previewSeries1')[0], '記録予定：7件');
  copy.set(3, 2, 0);
  a = run('previewSeries1');
  has('2回目', a[0], '記録予定：6件');
  has('2回目', a[0], '照合できず記録しない：1件');
  set('設定1', 'B6', '抽出1'); book.delete('抽出1改');
}

console.log('X4 有効フラグOFF（T14）');
set('設定3', 'B5', 'OFF');
a = run('recordAll', ['YES']);
has('確認', a[0], '系列3：有効フラグOFFのため対象外');
eq('記録先3-1 空', rows('記録先3-1', 2, 3).length, 0);
eq('系列1は記録', rows('記録先1-1', 2, 3).length, 7);
has('プレビュー', run('previewSeries3')[0], '対象外');
set('操作', 'B17', new Date('2026-11-17T10:00:00')); set('操作', 'B18', new Date('2026-11-17T11:00:00'));
has('リセット', run('resetSeries3')[0], '対象外');
eq('設定3 管理欄変化なし', cell('設定3', 'B24'), '');
set('設定3', 'B5', 'ON'); init();

console.log('X6 記録停止フラグ');
set('設定', 'B8', 'ON');
has('停止', run('recordAll')[0], '記録停止フラグがONのため');
eq('書き込みなし', rows('記録先1-1', 2, 3).length, 0);
set('設定', 'B8', 'OFF');

console.log('X7 確認ダイアログでキャンセル');
a = run('recordAll', ['NO']);
has('キャンセル', a[1], 'キャンセルしました');
eq('書き込みなし', ALL_DEST.map(d => rows(d, 2, 3).length), [0, 0, 0, 0, 0, 0, 0]);
eq('ポインタ変化なし', cell('設定1', 'B24'), '');

console.log('X8 リセットの入力チェック');
set('操作', 'B7', new Date('2026-11-17T14:00:00')); set('操作', 'B8', new Date('2026-11-17T13:00:00'));
has('開始＞終了', run('resetSeries1')[0], '除外開始が除外終了より後');
set('操作', 'B8', '');
has('未入力', run('resetSeries1')[0], '除外終了（操作!B8）が未入力');
eq('変化なし', [cell('設定1', 'B24'), book.get('リセットログ').getLastRow()], ['', 1]);
init();

console.log('追加：実行前確認OFF・遡り日数・上書き防止・設定異常の系列だけ飛ばす');
set('設定', 'B7', 'OFF');
a = run('recordAll');
eq('確認なしで結果だけ', a.length, 1);
set('設定', 'B7', 'ON'); init();
NOW = new Date('2026-11-25T08:00:00'); // 7日の窓から 11/18 08:00 より前が外れる
has('遡り日数で古い分は対象外', run('previewSeries1')[0], '記録予定：1件');
NOW = new Date('2026-11-19T12:00:00');
set('記録先1-2', 'A2', new Date('2026-01-01T00:00:00')); set('記録先1-2', 'B2', 'x'); set('記録先1-2', 'A3', ''); set('記録先1-2', 'B4', '既存');
set('記録先1-2', 'A5', new Date('2026-01-02T00:00:00'));
a = run('recordAll', ['YES']);
has('上書きを避けて中断', a[1], '上書きを避けて中断');
has('どこまで書いたか', a[1], '記録先1 2行、記録先2 1行、記録先3 1行'); console.log(a[1]);
eq('系列1 ポインタは進まない', cell('設定1', 'B24'), '');
eq('既存セルは無傷', [cell('記録先1-2', 'B4'), cell('記録先1-2', 'A4')], ['既存', '']);
eq('他の系列は記録', rows('記録先2-1', 2, 3), S1_2);
init();
set('記録先1-2', 'A2', 'メモ'); set('記録先1-2', 'A3', ''); // 開始セル埋まり→最初の空白（A3）から
set('設定3', 'B12', '存在しないシート');
a = run('recordAll', ['YES']);
has('設定異常の系列', a[0], '設定3：設定に異常があるため記録しません');
eq('開始セル埋まり→A3から', rows('記録先1-2', 2, 3).slice(0, 2), ['メモ｜｜', S1_1[0]]);
eq('系列2は記録', rows('記録先2-1', 2, 3), S1_2);
set('設定3', 'B12', '記録先3-1'); init();

console.log(`\n合計: OK ${passes} / NG ${fails}`);
process.exit(fails ? 1 : 0);
