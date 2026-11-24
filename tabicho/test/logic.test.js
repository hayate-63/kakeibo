// 旅帳ロジックの単体テスト: node tabicho/test/logic.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const dir = path.join(__dirname, '..', 'src', 'js');
const ctx = {
  console, setTimeout, clearTimeout, setInterval: () => 0, Date, Math, JSON,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: { addEventListener() {} }, navigator: { onLine: true }, document: { getElementById: () => null },
  render() {}, toast() {}, confirmDialog: async () => true
};
vm.createContext(ctx);
['01_util.js', '02_api.js', '03_store.js', '04_schedule.js', '05_money.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
const run = (code) => { const v = vm.runInContext(code, ctx); return v === undefined ? v : JSON.parse(JSON.stringify(v)); };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('✓', name); };

t('営業時間: 定休日', () => {
  const h = run(`parseHours('9:00-17:00 水曜定休')`);
  assert.deepStrictEqual(h.week[3], []);
  assert.deepStrictEqual(h.week[1], [[540, 1020]]);
});
t('営業時間: 平日/土日', () => {
  const h = run(`parseHours('平日10:00〜18:00／土日9:00〜17:00')`);
  assert.deepStrictEqual(h.week[2], [[600, 1080]]);
  assert.deepStrictEqual(h.week[0], [[540, 1020]]);
});
t('営業時間: 深夜', () => {
  const h = run(`parseHours('18:00-翌2:00 月曜休み')`);
  assert.deepStrictEqual(h.week[2], [[1080, 1560]]);
  assert.deepStrictEqual(h.week[1], []);
});
t('営業時間: 構造化', () => {
  const h = run(`parseHours({0:[["10:00","16:00"]], 1:"closed"})`);
  assert.deepStrictEqual(h.week[0], [[600, 960]]);
  assert.deepStrictEqual(h.week[1], []);
});
t('電卓', () => {
  assert.strictEqual(run(`evalExpr('1200×3+(500−100)÷2')`), 3800);
});
t('割り勘の端数は払った人', () => {
  const r = run(`(() => {
    const tr = newTrip({ members: ['A','B','C'] });
    const [a,b,c] = tr.members;
    tr.expenses.push({ id:'e1', date:'2026-11-30', desc:'昼', cat:'食費', money: newMoney(tr, { amount: 1000, payer: b.id }) });
    const s = sharesOf(tr, tr.expenses[0].money);
    return [s.shares[a.id], s.shares[b.id], s.shares[c.id]];
  })()`);
  assert.deepStrictEqual(r, [333, 334, 333]);
});
t('精算：最小送金', () => {
  const r = run(`(() => {
    const tr = newTrip({ members: ['A','B','C','D'] });
    const [a,b,c,d] = tr.members;
    const add = (amt, payer, split) => tr.expenses.push({ id: uid('e'), date:'2026-11-30', desc:'x', cat:'その他', money: newMoney(tr, { amount: amt, payer, split }) });
    add(12000, a.id); add(4000, b.id); add(2000, c.id, [c.id, d.id]);
    const { transfers, bal } = computeTransfers(tr);
    const net = {}; tr.members.forEach(m => net[m.id] = bal[m.id].diff);
    transfers.forEach(t => { net[t.from] += t.amount; net[t.to] -= t.amount; });
    return { n: transfers.length, zero: Object.values(net).every(v => v === 0), total: transfers.reduce((s,t)=>s+t.amount,0) };
  })()`);
  assert.ok(r.n <= 3); assert.ok(r.zero);
});
t('精算チェックは支出変更でリセット', () => {
  const r = run(`(() => {
    const tr = newTrip({ members: ['A','B'] });
    const [a,b] = tr.members;
    tr.expenses.push({ id:'e1', date:'2026-11-30', desc:'宿', cat:'宿', money: newMoney(tr, { amount: 20000, payer: a.id }) });
    const r1 = reconcileSettlement(tr);
    tr.settlement.transfers[r1.transfers[0].key] = { checked: true };
    const ok1 = settlementComplete(tr);
    tr.expenses[0].money.amount = 22000;
    reconcileSettlement(tr);
    return [ok1, settlementComplete(tr), !!tr.settlement.notice];
  })()`);
  assert.deepStrictEqual(r, [true, false, true]);
});
t('実効レート（設計メモの例）', () => {
  const r = run(`(() => {
    const tr = newTrip({ members: ['自分'] });
    const me = tr.members[0];
    tr.exchanges.push({ id:'x1', dir:'buy', jpy:50000, amount:10000, currency:'TWD' });
    tr.expenses.push({ id:'e1', date:'2026-12-01', desc:'夜市', cat:'食費', money: newMoney(tr, { amount: 6000, currency:'TWD', rate:4.8, payer: me.id, method:'cash' }) });
    const open = effectiveRate(tr, 'TWD');
    tr.exchanges.push({ id:'x2', dir:'sell', jpy:18400, amount:4000, currency:'TWD' });
    tr.fxClose.TWD = 'returned';
    const fin = effectiveRate(tr, 'TWD');
    tr.expenses[0].money.amount = 600; tr.expenses.push({ id:'e2', date:'2026-12-01', desc:'他', cat:'食費', money: newMoney(tr, { amount: 5400, currency:'TWD', rate:4.8, payer: me.id, method:'cash' }) });
    const k = kakeiboEntries(tr);
    return { open: open.rate, fin: fin.rate, final: fin.final, k600: k.find(r => r.e.key === 'e:e1').entries[0].amount };
  })()`);
  assert.strictEqual(r.open, 5);
  assert.ok(Math.abs(r.fin - 31600 / 6000) < 1e-9);
  assert.strictEqual(r.k600, -3160);
});
t('家計簿：カード払いは引落額＋割り勘収入の2本', () => {
  const r = run(`(() => {
    const tr = newTrip({ members: ['自分','B'] });
    const [me,b] = tr.members;
    tr.expenses.push({ id:'e1', date:'2026-11-30', desc:'宿', cat:'宿', money: newMoney(tr, { amount: 30001, payer: me.id, method:'smbc' }) });
    tr.expenses.push({ id:'e2', date:'2026-11-30', desc:'昼', cat:'食費', money: newMoney(tr, { amount: 3000, payer: b.id }) });
    return kakeiboEntries(tr).map(r => r.entries.map(e => e.amount));
  })()`);
  assert.deepStrictEqual(r, [[-30001, 15000], [-1500]]);
});
t('工程：自動提案・固定枠の間に合わない警告・絵文字位置', () => {
  const r = run(`(() => {
    const tr = newTrip({ startDate:'2026-11-30', endDate:'2026-11-30', mode:'shiori' });
    tr.items.push(newItem({ name:'A', date:'2026-11-30', start:'09:00', stay:60, moveAfter:30, order:1 }));
    tr.items.push(newItem({ name:'B', date:'2026-11-30', stay:90, moveAfter:20, order:2 }));
    tr.items.push(newItem({ name:'C', date:'2026-11-30', start:'12:00', locked:true, startManual:true, stay:60, order:3 }));
    const rows = daySchedule(tr, '2026-11-30');
    const p = progressOnRows(rows, 9*60+45);
    const p2 = progressOnRows(rows, 10*60+15);
    return { starts: rows.map(r=>r.start), warn: rows[2].warns.map(w=>w.t), p, p2 };
  })()`);
  assert.deepStrictEqual(r.starts, [540, 630, 720]);
  assert.ok(r.warn[0].includes('間に合いません'));
  assert.strictEqual(r.p.index, 0); assert.strictEqual(r.p.frac, 0.5); assert.strictEqual(r.p.state, 'stay');
  assert.strictEqual(r.p2.state, 'move');
});
t('ステータス自動判定', () => {
  const r = run(`(() => {
    const tr = newTrip({});
    const a = tripStatus(tr, '2026-11-24');
    tr.startDate = '2026-11-30'; tr.endDate = '2026-12-01';
    const b = tripStatus(tr, '2026-11-24');
    tr.bookings.push({ id:'b1', status:'予約済' });
    const c = tripStatus(tr, '2026-11-24');
    return [a, b, c, tripStatus(tr, '2026-11-30'), tripStatus(tr, '2026-12-02')];
  })()`);
  assert.deepStrictEqual(r, ['検討中', '計画中', '確定', '旅行中', '精算・記録中']);
});
console.log(`\n${n} tests passed`);
