// 旅帳ロジックの単体テスト: node tabicho/test/logic.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const dir = path.join(__dirname, '..', 'src', 'js');
const ctx = {
  console, setTimeout, clearTimeout, setInterval: () => 0, Date, Math, JSON,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  window: { addEventListener() {} }, navigator: { onLine: true }, document: { getElementById: () => null, addEventListener() {}, querySelectorAll: () => [] },
  location: { origin: 'null', protocol: 'file:', hostname: '', href: 'file:///x' }, ACT: undefined,
  render() {}, toast() {}, confirmDialog: async () => true
};
vm.createContext(ctx);
['01_util.js', '02_api.js', '03_store.js', '04_schedule.js', '05_money.js', '06_ui_common.js', '14_media.js', '15_visual.js', '16_collection.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
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

t('v2.0 英語タイトル：入力 → 自動英語化 → かなのローマ字', () => {
  const r = run(`(() => {
    const a = newTrip({ title: 'ほっかいどう' }); const b = newTrip({ title: 'トーキョー' });
    const c = newTrip({ title: '北海道旅行' }); c.titleEnAuto = 'Hokkaido trip'; c.titleEnAutoSrc = '北海道旅行';
    const d = newTrip({ title: '北海道旅行' }); d.titleEn = 'Snow Days';
    const e = newTrip({ title: '北海道旅行' }); e.titleEnAuto = 'Hokkaido trip'; e.titleEnAutoSrc = '別のタイトル';
    return [displayTitleEn(a), displayTitleEn(b), displayTitleEn(c), displayTitleEn(d), kanaToRomaji('きょうと'), kanaToRomaji('ほっかいどう')];
  })()`);
  assert.deepStrictEqual(r, ['HOKKAIDOU', 'TOOKYOO', 'HOKKAIDO TRIP', 'SNOW DAYS', 'kyouto', 'hokkaidou']);
});
t('v2.0 国内／海外の自動判定', () => {
  const r = run(`[detectRegion({ area: '淡路島' }), detectRegion({ area: '台北・九份' }), detectRegion({ area: '', title: 'ハワイ旅行' }), detectRegion({ area: '沖縄', currency: 'USD' })]`);
  assert.deepStrictEqual(r, ['domestic', 'overseas', 'overseas', 'overseas']);
});
t('v2.0 日別セクション：日程外・日付なしは「日付未設定」、代表写真の優先', () => {
  const r = run(`(() => {
    const tr = newTrip({ startDate: '2026-11-24', endDate: '2026-11-25' });
    const m = (o) => Object.assign({ id: uid('md'), fileId: uid('f'), kind: 'photo', favorite: false, cover: false, createdAt: '2026-11-24T00:00:00Z' }, o);
    tr.media = [m({ id: 'a', date: '2026-11-24', takenAt: '2026-11-24T10:00:00' }), m({ id: 'b', date: '2026-11-24', takenAt: '2026-11-24T09:00:00', favorite: true }),
      m({ id: 'c', date: '2026-12-01' }), m({ id: 'd', date: '' }), m({ id: 'v', kind: 'video', date: '2026-11-25' })];
    const g = mediaByDay(tr);
    const cov1 = coverMedia(tr).id;
    tr.media.find(x => x.id === 'a').cover = true;
    return { d1: g.by['2026-11-24'].map(x => x.id), d2: g.by['2026-11-25'].map(x => x.id), unset: g.unset.map(x => x.id), cov1, cov2: coverMedia(tr).id };
  })()`);
  assert.deepStrictEqual(r, { d1: ['b', 'a'], d2: ['v'], unset: ['c', 'd'], cov1: 'b', cov2: 'a' });
});
t('v2.0 日別ページの写真：手動 → お気に入り → 代表 → 時系列（V3）', () => {
  const r = run(`(() => {
    const tr = newTrip({ startDate: '2026-11-24', endDate: '2026-11-24' });
    const m = (id, o) => Object.assign({ id, fileId: 'f' + id, kind: 'photo', date: '2026-11-24', favorite: false, cover: false, takenAt: '2026-11-24T0' + id.length + ':00:00' }, o);
    tr.media = [m('x1', { takenAt: '2026-11-24T08:00:00' }), m('x2', { takenAt: '2026-11-24T09:00:00', cover: true }), m('x3', { takenAt: '2026-11-24T10:00:00', favorite: true }), m('x4', { takenAt: '2026-11-24T07:00:00' })];
    const auto = visualDayPicks(tr, '2026-11-24').map(x => x.id);
    tr.visual.dayPicks['2026-11-24'] = ['x4'];
    const manual = visualDayPicks(tr, '2026-11-24').map(x => x.id);
    return { auto, manual, cover: visualCover(tr).id };
  })()`);
  assert.deepStrictEqual(r, { auto: ['x3', 'x2', 'x4'], manual: ['x4', 'x3', 'x2'], cover: 'x2' });
});
t('v2.0 コレクションの対象（C1）：旅行中・精算・記録中・完了だけ', () => {
  const r = run(`(() => {
    const mk = (o) => { const t = newTrip(o); S.trips[t.id] = t; return t; };
    S.trips = {};
    mk({ title: '検討' }); mk({ title: '計画', startDate: addDays(todayStr(), 10), endDate: addDays(todayStr(), 11) });
    const go = mk({ title: '旅行中', startDate: todayStr(), endDate: addDays(todayStr(), 1) });
    const done = mk({ title: '完了', startDate: '2025-05-01', endDate: '2025-05-02' }); done.manualStatus = '完了';
    const past = mk({ title: '精算中', startDate: '2026-01-10', endDate: '2026-01-12' });
    past.items.push(newItem({ spotId: 'SP1', visited: { date: '2026-01-10', rating: 4 } }));
    go.items.push(newItem({ spotId: 'SP1', visited: { date: todayStr(), rating: 5 } }));
    return { titles: collectionTrips().map(t => t.title).sort(), st: statsOf(collectionTrips()) };
  })()`);
  assert.deepStrictEqual(r.titles, ['完了', '旅行中', '精算中']);
  assert.strictEqual(r.st.trips, 3); assert.strictEqual(r.st.days, 7); assert.strictEqual(r.st.spots, 1, '同じスポットは1件と数える');
});

t('v2.0.2 場所ごとの振り分け（700m 以内をまとめる・位置情報なしは別）', () => {
  const r = run(`(() => {
    const m = (id, lat, lng) => ({ id, kind: 'photo', lat, lng });
    const cl = placeClusters([m('a', 34.5636, 135.0103), m('b', 34.5660, 135.0120), m('c', 34.3401, 134.9046), m('d', null, null)]);
    return cl.map(c => c.items.map(x => x.id).join(''));
  })()`);
  assert.deepStrictEqual(r, ['ab', 'c']);
});
t('v2.0.2 ビジュアルのレイアウト：枚数（1〜4）と比率の箱', () => {
  const r = run(`(() => {
    const tr = newTrip({ startDate: '2026-11-24', endDate: '2026-11-24' });
    const lim = [dayLimit(tr, '2026-11-24')];
    tr.visual.defaultCount = '4'; lim.push(dayLimit(tr, '2026-11-24'));
    tr.visual.dayCount['2026-11-24'] = '1'; lim.push(dayLimit(tr, '2026-11-24'));
    const cells = layoutCells(4, 0, 0, 100, 100, 10).map(c => c.map(Math.round));
    const box = fitRatio([0, 0, 100, 200], ratioValue('1:1')).map(Math.round);
    const wide = fitRatio([0, 0, 200, 100], ratioValue('4:5')).map(Math.round);
    return { lim, cells, box, wide, fill: fitRatio([1, 2, 3, 4], ratioValue('fill')) };
  })()`);
  assert.deepStrictEqual(r.lim, [3, 4, 1]);
  assert.deepStrictEqual(r.cells, [[0, 0, 45, 45], [55, 0, 45, 45], [0, 55, 45, 45], [55, 55, 45, 45]]);
  assert.deepStrictEqual(r.box, [0, 50, 100, 100], '縦長の枠に 1:1 は中央に正方形');
  assert.deepStrictEqual(r.wide, [60, 0, 80, 100], '横長の枠に 4:5 は中央に縦長');
  assert.deepStrictEqual(r.fill, [1, 2, 3, 4], '枠いっぱいはそのまま');
});
t('v2.0.3 タイムゾーン：現地の日付・時刻と、現地時刻→絶対時刻', () => {
  const r = run(`(() => {
    const at = Date.UTC(2026, 10, 26, 20, 30);   // 日本 11/27 05:30、ハワイ 11/26 10:30
    const hon = tzParts('Pacific/Honolulu', new Date(at)), tok = tzParts('Asia/Tokyo', new Date(at));
    return {
      hon: hon.year + '-' + hon.month + '-' + hon.day + ' ' + hon.hour + ':' + hon.minute,
      tok: tok.year + '-' + tok.month + '-' + tok.day + ' ' + tok.hour + ':' + tok.minute,
      offHon: tzOffsetMin('Pacific/Honolulu', at), offTok: tzOffsetMin('Asia/Tokyo', at),
      diff: tzDiffHours('Pacific/Honolulu', 'Asia/Tokyo'),
      z1: zonedEpoch('2026-11-26', 630, 'Pacific/Honolulu') === at,
      z2: zonedEpoch('2026-11-27', 330, 'Asia/Tokyo') === at,
      // 夏時間：ロサンゼルス 2026-03-08 は 2:00 → 3:00。10:00 は PDT（UTC-7）
      z3: zonedEpoch('2026-03-08', 600, 'America/Los_Angeles') === Date.UTC(2026, 2, 8, 17, 0),
      z4: zonedEpoch('2026-01-08', 600, 'America/Los_Angeles') === Date.UTC(2026, 0, 8, 18, 0),
      bad: zonedEpoch('2026-11-26', 60, 'Not/AZone') === parseYmd('2026-11-26').getTime() + 3600000,
      valid: [validTz('Europe/Paris'), validTz('Mars/Base')]
    };
  })()`);
  assert.strictEqual(r.hon, '2026-11-26 10:30');
  assert.strictEqual(r.tok, '2026-11-27 05:30');
  assert.strictEqual(r.offHon, -600); assert.strictEqual(r.offTok, 540);
  assert.strictEqual(r.diff, -19);
  assert.ok(r.z1 && r.z2, '現地の日付＋分 → 絶対時刻');
  assert.ok(r.z3 && r.z4, '夏時間と冬時間');
  assert.ok(r.bad, '不正なタイムゾーンは端末の時刻で計算');
  assert.deepStrictEqual(r.valid, [true, false]);
});
t('v2.0.3 旅のタイムゾーン：未設定は日本／海外は精算通貨から推定／指定が最優先', () => {
  const r = run(`(() => {
    const a = newTrip({ title: '淡路島' });
    const b = newTrip({ title: 'ハワイ' }); b.region = 'overseas'; b.currency = 'USD';
    const c = newTrip({ title: 'NY' }); c.region = 'overseas'; c.currency = 'USD'; c.timeZone = 'America/New_York';
    const d = newTrip({ title: '壊れ' }); d.timeZone = 'Bad/Zone';
    return [tripTz(a), tripTz(b), tripTz(c), tripTz(d), typeof tripToday(b), typeof tripNowMin(b)];
  })()`);
  assert.deepStrictEqual(r, ['Asia/Tokyo', 'Pacific/Honolulu', 'America/New_York', 'Asia/Tokyo', 'string', 'number']);
});
t('v2.0.3 旅の状態（旅行中かどうか）は現地の日付で決まる', () => {
  const r = run(`(() => {
    const t = newTrip({ title: 'ハワイ' }); t.region = 'overseas'; t.currency = 'USD'; t.startDate = '2026-11-20'; t.endDate = '2026-11-26';
    return [tripStatus(t, '2026-11-26'), tripStatus(t, '2026-11-27')];
  })()`);
  assert.notStrictEqual(r[0], r[1], '日本で翌日になっても、現地がまだ最終日なら旅行中のまま');
});
console.log(`\n${n} tests passed`);
