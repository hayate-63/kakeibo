// 計算エンジン自己検証（引き継ぎメモ §7 T1〜T6 ＋ 追加ケース）
// 実行: node trader-tax/tests/engine-test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index-v1.0.html'), 'utf8');
const m = html.match(/<script id="tax-engine">([\s\S]*?)<\/script>/);
if (!m) throw new Error('tax-engine script block not found');
const ctx = { module: { exports: {} }, TextDecoder, console };
vm.createContext(ctx);
vm.runInContext(m[1], ctx);
const { TaxEngine: E, CSV_CONFIG } = ctx.module.exports;

let pass = 0, fail = 0;
const results = [];
function eq(label, actual, expected) {
  const ok = actual === expected;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}: 期待 ${expected} / 実際 ${actual}`);
  ok ? pass++ : fail++;
}
function section(t) { results.push('', '■ ' + t); }
function db(over) {
  return Object.assign({ trades: [], holdings: [], margin_positions: [], margin_settlements: [], annual_reports: [], dividends: [], carryover: [], settings: [] }, over);
}
let seq = 1;
function tr(date, side, qty, price, fee, code = '1111', extra = {}) {
  return Object.assign({ id: 't' + seq, seq: seq++, tradeDate: date, settleDate: date, account: '一般', code, name: 'テスト', side, qty, price, fee }, extra);
}

/* ---------------- T1 ---------------- */
section('T1 現物の総平均');
{
  const trades = [tr('2027-03-01', '買', 100, 1000, 0), tr('2027-03-02', '買', 100, 1200, 0), tr('2027-03-03', '売', 100, 1500, 0)];
  const sp = E.calcSpot(trades, [], [], '受渡日');
  const L = sp.ledgers['一般|1111'];
  eq('T1 2回目の買い後の平均単価', L[1].avgAfter, 1100);
  eq('T1 譲渡損益', sp.sales[0].pnl, 40000);
  eq('T1 残株数', sp.states['一般|1111'].qty, 100);
  eq('T1 取得費残', sp.states['一般|1111'].cost, 110000);
}

/* ---------------- T1b ---------------- */
section('T1b 端数処理');
{
  // 取得費総額 10,001円・3株 を「買い 3株 @3,333＋手数料2」で作る
  const trades = [tr('2027-03-01', '買', 3, 3333, 2, '2222'), tr('2027-03-02', '売', 1, 4000, 0, '2222')];
  const sp = E.calcSpot(trades, [], [], '受渡日');
  const L = sp.ledgers['一般|2222'];
  eq('T1b 取得費総額', L[0].costAfter, 10001);
  eq('T1b 平均単価（円未満切上げ）', L[0].avgAfter, 3334);
  eq('T1b 1株売却の譲渡原価', sp.sales[0].cogs, 3334);
  eq('T1b 取得費残（2株分）', sp.states['一般|2222'].cost, 6667);
  eq('T1b 残株数', sp.states['一般|2222'].qty, 2);
  // 追加確認: 残り2株を全量売却 → 原価は取得費残 6,667（丸めで残高がずれない）
  const sp2 = E.calcSpot(trades.concat([tr('2027-03-03', '売', 2, 4000, 0, '2222')]), [], [], '受渡日');
  eq('T1b+ 残2株の全量売却の譲渡原価（取得費残を吸収）', sp2.sales[1].cogs, 6667);
  eq('T1b+ 全量売却後の取得費残', sp2.states['一般|2222'].cost, 0);
  // 期首保有で 10,001円・3株 を登録した場合も同じ
  const sp3 = E.calcSpot([tr('2027-03-02', '売', 1, 4000, 0, '3333')], [{ asOfDate: '2027-01-01', account: '一般', code: '3333', name: 'x', qty: 3, costTotal: 10001 }], [], '受渡日');
  eq('T1b+ 期首登録経由の譲渡原価', sp3.sales[0].cogs, 3334);
  eq('T1b+ 期首登録経由の取得費残', sp3.states['一般|3333'].cost, 6667);
}

/* ---------------- T2 ---------------- */
section('T2 損益通算と還付（配当との通算）');
{
  const trades = [tr('2027-04-01', '買', 100, 10000, 0, '4444'), tr('2027-05-01', '売', 100, 6000, 0, '4444')];
  const d = db({
    trades,
    annual_reports: [{ year: 2027, kind: '上場分', proceeds: 1300000, cost: 1000000, net: 300000 }],
    dividends: [{ id: 'd1', date: '2027-06-01', code: '9', name: 'x', amount: 150000, withholdIncome: 22972, withholdResident: 7500, account: '一般' }],
    settings: [{ key: 'divChoice_2027', value: '申告分離' }]
  });
  const R = E.computeAll(d, { currentYear: 2027 }).byYear[2027];
  eq('T2 モードG現物', R.inputs.gSpot.pnl, -400000);
  eq('T2 譲渡ネット', R.transferNet, -100000);
  eq('T2 配当の課税対象', R.taxableDiv, 50000);
  eq('T2 所得税（国税合計）', R.tax.national, 7600);
  eq('T2 住民税', R.tax.resident, 2500);
  eq('T2 税額合計', R.tax.total, 10100);
  eq('T2 精算（還付見込み＝マイナス）', R.settle.total, -20372);
  eq('T2 繰越発生（通算で吸収）', R.newLoss, 0);
}

/* ---------------- T3 ---------------- */
section('T3 繰越控除（3年間）');
{
  const reps = [
    { year: 2027, kind: '上場分', net: -300000 },
    { year: 2028, kind: '上場分', net: 200000 },
    { year: 2029, kind: '上場分', net: 150000 }
  ];
  const carry = [2027, 2028, 2029].map(y => ({ year: y, filed: 'TRUE' }));
  const A = E.computeAll(db({ annual_reports: reps, carryover: carry }), { currentYear: 2029 });
  const y27 = A.byYear[2027], y28 = A.byYear[2028], y29 = A.byYear[2029];
  eq('T3 2027 繰越発生', y27.newLoss, 300000);
  eq('T3 2027 使用期限（失効年）', y27.poolAfter[0].expireYear, 2030);
  eq('T3 2028 控除', y28.carryDeducted, 200000);
  eq('T3 2028 課税対象', y28.tax.taxable, 0);
  eq('T3 2028 繰越残', y28.carryForwardTotal, 100000);
  eq('T3 2029 控除', y29.carryDeducted, 100000);
  eq('T3 2029 課税対象', y29.tax.taxable, 50000);
  eq('T3 2029 所得税（国税合計）', y29.tax.national, 7600);
  eq('T3 2029 住民税', y29.tax.resident, 2500);
  eq('T3 2029 税額合計', y29.tax.total, 10100);
  eq('T3 2029 繰越残', y29.carryForwardTotal, 0);
  eq('T3 申告済みチェックありで連続申告警告なし', y29.warnings.filter(w => w.includes('連続申告')).length, 0);
  // 追加: 2028年の申告済みチェックが無い → 2029年に警告
  const B = E.computeAll(db({ annual_reports: reps, carryover: [{ year: 2027, filed: 'TRUE' }] }), { currentYear: 2029 });
  eq('T3+ 申告済み欠落時に連続申告警告が出る', B.byYear[2029].warnings.some(w => w.includes('2028') && w.includes('連続申告')), true);
  // 追加: 3年で失効（2027損失は2031年分では使えない）
  const C = E.computeAll(db({ annual_reports: [{ year: 2027, kind: '上場分', net: -300000 }, { year: 2031, kind: '上場分', net: 100000 }] }), { currentYear: 2031 });
  eq('T3+ 2030年分で失効警告', C.byYear[2030].warnings.some(w => w.includes('失効')), true);
  eq('T3+ 2031年分は控除不可', C.byYear[2031].carryDeducted, 0);
  eq('T3+ 2031年分の課税対象', C.byYear[2031].tax.taxable, 100000);
}

/* ---------------- T4 ---------------- */
section('T4 信用・買建');
{
  const pos = [{ id: 'p1', openDate: '2027-02-01', account: '一般', code: '5555', name: 'x', side: '買建', qty: 100, openPrice: 2000, openFee: 110 }];
  const set = [{ id: 's1', positionId: 'p1', settleDate: '2027-03-01', type: '返済', qty: 100, closePrice: 2200, openFee: 110, closeFee: 110, interestPaid: 1000, gyakuhibuReceived: 0, divAdjReceived: 3000 }];
  const M = E.calcMargin(pos, set, '受渡日');
  eq('T4 決済損益', M.details[0].pnl, 21780);
  // 建手数料を空欄にして按分ルートでも同じになること
  const M2 = E.calcMargin(pos, [Object.assign({}, set[0], { openFee: '' })], '受渡日');
  eq('T4+ 建手数料を建玉から按分しても同じ', M2.details[0].pnl, 21780);
}

/* ---------------- T5 ---------------- */
section('T5 信用・売建');
{
  const pos = [{ id: 'p2', openDate: '2027-02-01', account: '一般', code: '6666', name: 'x', side: '売建', qty: 100, openPrice: 2000, openFee: 110 }];
  const set = [{ id: 's2', positionId: 'p2', settleDate: '2027-03-01', type: '返済', qty: 100, closePrice: 1800, openFee: 110, closeFee: 110, lendingFee: 500, gyakuhibuPaid: 2000, interestReceived: 0, divAdjPaid: 3000 }];
  const M = E.calcMargin(pos, set, '受渡日');
  eq('T5 決済損益', M.details[0].pnl, 14280);
}

/* ---------------- T6 ---------------- */
section('T6 モードTの合算と端数');
{
  const d = db({ annual_reports: [{ year: 2027, kind: '上場分', net: -50000 }, { year: 2027, kind: '特定信用分', net: 80000 }] });
  const R = E.computeAll(d, { currentYear: 2027 }).byYear[2027];
  eq('T6 課税対象', R.tax.taxable, 30000);
  eq('T6 所得税＋復興（端数前）×10', Math.round((R.tax.incomeTax + R.tax.recon) * 10), 45945);
  eq('T6 所得税（国税合計・100円未満切捨て）', R.tax.national, 4500);
  eq('T6 住民税', R.tax.resident, 1500);
  eq('T6 合計', R.tax.total, 6000);
}

/* ---------------- 追加ケース ---------------- */
section('追加 課税年の判定・現引・現渡・期首不一致・CSV');
{
  // 年末約定（受渡が翌年）→ 受渡日基準では翌年分、約定日基準では当年分
  const t = [tr('2027-06-01', '買', 100, 1000, 0, '7777'), tr('2027-12-30', '売', 100, 1100, 0, '7777', { settleDate: '2028-01-05' })];
  eq('受渡日基準: 年末約定は翌年分', E.calcSpot(t, [], [], '受渡日').sales[0].taxYear, 2028);
  eq('約定日基準: 年末約定は当年分', E.calcSpot(t, [], [], '約定日').sales[0].taxYear, 2027);
  eq('受渡日の初期値: 2027-12-30(木)+2営業日', E.addBusinessDays('2027-12-30', 2), '2028-01-05');

  // 現引 → 現物の取得費＝建代金＋諸経費、その後の現物売却で損益
  const pos = [{ id: 'p3', openDate: '2027-02-01', account: '一般', code: '8888', name: 'x', side: '買建', qty: 100, openPrice: 1000, openFee: 100 }];
  const set = [{ id: 's3', positionId: 'p3', settleDate: '2027-03-01', type: '現引', qty: 100, openFee: 100, closeFee: 0, interestPaid: 400 }];
  const d = db({ margin_positions: pos, margin_settlements: set, trades: [tr('2027-04-01', '売', 100, 1200, 0, '8888')] });
  const A = E.computeAll(d, { currentYear: 2027 });
  eq('現引: 現物の取得費（100,000+100+400）', A.spot.ledgers['一般|8888'][0].costAfter, 100500);
  eq('現引後の現物売却損益', A.spot.sales[0].pnl, 19500);
  eq('現引: 建玉の状態', A.margin.positions[0].status, '現引');

  // 現渡: 保有現物（平均900）を売建（建値1,000）に渡す
  const pos2 = [{ id: 'p4', openDate: '2027-02-01', account: '一般', code: '9999', name: 'x', side: '売建', qty: 100, openPrice: 1000, openFee: 100 }];
  const set2 = [{ id: 's4', positionId: 'p4', settleDate: '2027-03-01', type: '現渡', qty: 100, openFee: 100, closeFee: 0, lendingFee: 200 }];
  const d2 = db({ margin_positions: pos2, margin_settlements: set2, trades: [tr('2027-01-10', '買', 100, 900, 0, '9999')] });
  const A2 = E.computeAll(d2, { currentYear: 2027 });
  eq('現渡: 譲渡損益（100,000−90,000−300）', A2.spot.sales[0].pnl, 9700);

  // 期首不一致の警告
  const sp = E.calcSpot([tr('2026-05-01', '買', 100, 1000, 0, '1212')], [{ asOfDate: '2027-01-01', account: '一般', code: '1212', name: 'x', qty: 200, costTotal: 210000 }], [], '受渡日');
  eq('期首保有が再計算と食い違うと警告', sp.warnings.some(w => w.includes('期首保有の不一致')), true);
  eq('期首登録を正として採用', sp.states['一般|1212'].qty, 200);

  // 分割（数量調整）: 取得費総額不変・単価再計算
  const sp2 = E.calcSpot([tr('2027-01-05', '買', 100, 1001, 0, '1313'), tr('2027-02-01', '数量調整', 200, '', 0, '1313')], [], [], '受渡日');
  eq('1:3分割後の平均単価（100,100/300 切上げ）', sp2.states['一般|1313'].avg, 334);
  eq('分割後も取得費総額は不変', sp2.states['一般|1313'].cost, 100100);

  // 特定預りの現物取引はモードG計算から除外
  const sp3 = E.calcSpot([tr('2027-01-05', '買', 100, 1000, 0, '1414', { account: '特定' })], [], [], '受渡日');
  eq('特定預りはモードG計算対象外', Object.keys(sp3.states).length, 0);

  // 総合課税の比較（給与所得 300万、控除 58万/43万、配当 10万）
  const comp = E.comprehensiveIncrement(100000, { salaryIncome: 3000000, deductionsIncome: 580000, deductionsResident: 430000 }, { income: 15, recon: 2.1, resident: 5 });
  // 課税所得 2,420,000 → 2,520,000：税額 144,500 → 154,500（+10,000）、配当控除 10,000 → 増分 0
  eq('総合課税: 所得税増分（配当控除で相殺）', comp.incomeInc, 0);
  // 住民税: 10% 増分 10,000 − 配当控除 2.8% 2,800 = 7,200
  eq('総合課税: 住民税増分', comp.resident, 7200);

  // 損失年は分離を推奨
  const R = E.computeAll(db({ annual_reports: [{ year: 2027, kind: '上場分', net: -100000 }], dividends: [{ date: '2027-06-01', amount: 50000, withholdIncome: 7657, withholdResident: 2500, account: '一般' }] }), { currentYear: 2027 }).byYear[2027];
  eq('損失年の推奨方式', R.recommendation.choice, '申告分離');
  eq('申告不要を選ぶと損失は全額繰越', R.comparison['申告不要'].newLoss, 100000);
  eq('分離を選ぶと配当と通算した残りを繰越', R.comparison['申告分離'].newLoss, 50000);

  // 配当台帳の特定分は報告書に配当があれば二重計上しない
  const R2 = E.computeAll(db({ annual_reports: [{ year: 2027, kind: '上場分', net: 0, dividends: 10000, divWithholdIncome: 1531, divWithholdResident: 500 }], dividends: [{ date: '2027-06-01', amount: 10000, withholdIncome: 1531, withholdResident: 500, account: '特定' }] }), { currentYear: 2027 }).byYear[2027];
  eq('特定配当の二重計上防止', R2.dividends.amount, 10000);

  // 数値パース
  eq('△表記のマイナス', E.int('△50,000'), -50000);
  eq('全角数字', E.int('１２，３４５'), 12345);
}

section('追加 CSV（仮Config・合成サンプル）');
{
  const sjisPath = path.join(__dirname, 'sample-spot-sjis.csv');
  if (fs.existsSync(sjisPath)) {
    const dec = E.decodeBytes(new Uint8Array(fs.readFileSync(sjisPath)));
    eq('Shift_JIS 自動判定', dec.encoding, 'Shift_JIS');
    const existing = [{ tradeDate: '2027-01-10', code: '7203', side: '買', qty: 100, price: 2500, account: '一般' }];
    const res = E.importSpotCsv(dec.text, existing, null, 1000);
    const by = s => res.rows.filter(r => r._status === s).length;
    eq('ヘッダー検出', res.headerRow > 1, true);
    eq('未検出列なし', res.missing.length, 0);
    eq('新規（登録側）', by('new'), 2);
    eq('重複候補（除外側）', by('dup'), 1);
    eq('NISA 自動除外', by('nisa'), 1);
    eq('特定（参考・除外側）', by('tokutei'), 1);
    eq('信用行は除外', by('margin'), 1);
    eq('新しい順→古い順に並べ替え', res.rows[0].tradeDate <= res.rows[res.rows.length - 1].tradeDate, true);
    eq('重複候補は初期状態で除外', res.rows.filter(r => r._status === 'dup')[0]._include, false);
    const sell = res.rows.filter(r => r.side === '売' && r._status === 'new')[0];
    eq('手数料＝手数料＋税額', sell.fee, 110);
  }
  const utf8Path = path.join(__dirname, 'sample-margin-utf8.csv');
  if (fs.existsSync(utf8Path)) {
    const dec = E.decodeBytes(new Uint8Array(fs.readFileSync(utf8Path)));
    eq('UTF-8 自動判定', dec.encoding.startsWith('UTF-8'), true);
    const res = E.importMarginCsv(dec.text, [], [], null, 1000);
    eq('信用CSV 未検出列なし', res.missing.length, 0);
    const longRow = res.rows.filter(r => r.position.side === '買建')[0];
    const shortRow = res.rows.filter(r => r.position.side === '売建')[0];
    const pl = E.marginPnl('買建', longRow.position.openAmount, longRow.settlement.closeAmount, E.marginCosts(longRow.settlement)).pnl;
    const ps = E.marginPnl('売建', shortRow.position.openAmount, shortRow.settlement.closeAmount, E.marginCosts(shortRow.settlement)).pnl;
    eq('信用CSV 買建の損益（T4相当）', pl, 21780);
    eq('信用CSV 売建の損益（T5相当）', ps, 14280);
    eq('信用CSV CSV記載損益と一致→差異注記なし', res.rows.every(r => !r._note.includes('差異')), true);
  }
  eq('CSV_CONFIG は仮設定のまま', CSV_CONFIG.status, 'PROVISIONAL');
}

console.log(results.join('\n'));
console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
