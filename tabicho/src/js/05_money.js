// ============================================================================
// 05 お金：支出の統合・割り勘・精算・多通貨・実効レート・家計簿連携
// ============================================================================
function newMoney(trip, o) {
  const me = meMember(trip);
  return Object.assign({
    amount: null, currency: trip.currency || 'JPY', rate: 1, rateAuto: true,
    payer: me ? me.id : null, split: trip.members.map(m => m.id), solo: false,
    method: 'cash', payState: '支払済', cardJpy: null
  }, o || {});
}
function payMethod(id) { return (S.settings.payMethods || []).find(p => p.id === id) || null; }
function isCardMethod(id) { const p = payMethod(id); return !!(p && p.isCard); }
function isCashMethod(id) { const p = payMethod(id); return id === 'cash' || !!(p && (p.isCash || p.name === '現金')); }

function participants(trip, m) {
  const ids = new Set(trip.members.map(x => x.id));
  if (m.solo) return m.payer && ids.has(m.payer) ? [m.payer] : [];
  const sp = (m.split || []).filter(id => ids.has(id));
  return sp.length ? sp : trip.members.map(x => x.id);
}

// 支出・予約の事前支払い・給油を1本の明細リストに統合（予約・給油は自動で流れ、二重入力させない）
function allExpenses(trip) {
  const out = [];
  trip.expenses.forEach(e => out.push({ key: 'e:' + e.id, source: 'expense', ref: e, date: e.date, desc: e.desc || '（内容なし）', cat: e.cat || 'その他', memo: e.memo || '', money: e.money }));
  trip.bookings.forEach(b => {
    if (b.status === 'キャンセル' || !b.money || b.money.amount == null || b.money.amount === '') return;
    out.push({ key: 'b:' + b.id, source: 'booking', ref: b, date: b.payDate || b.date || trip.startDate || todayStr(), desc: (BOOKING_ICON[b.type] || '') + ' ' + (b.title || '予約') + '（事前支払い）', cat: BOOKING_TO_EXPENSE_CAT[b.type] || 'その他', memo: b.memo || '', money: b.money });
  });
  trip.fuel.forEach(f => {
    if (!f.money || f.money.amount == null || f.money.amount === '') return;
    out.push({ key: 'f:' + f.id, source: 'fuel', ref: f, date: f.date, desc: '⛽ 給油' + (f.liters ? ' ' + f.liters + 'L' : '') + (f.station ? '（' + f.station + '）' : ''), cat: '給油', memo: f.memo || '', money: f.money });
  });
  out.sort((a, b) => (a.date || '') < (b.date || '') ? -1 : (a.date || '') > (b.date || '') ? 1 : 0);
  return out;
}

function settleUnit(trip) { return Math.pow(10, curDec(trip.currency)); }
function toSettle(trip, m) {
  const amt = num(m.amount, 0);
  const rate = m.currency === trip.currency ? 1 : num(m.rate, 1);
  return Math.round(amt * rate * settleUnit(trip)); // 最小通貨単位の整数
}

// 1件の割り勘：割り切れない端数は払った人が負担し、その人の負担額に乗る
function sharesOf(trip, m) {
  const total = toSettle(trip, m);
  const ps = participants(trip, m);
  const shares = {};
  if (!ps.length) return { total, shares, ps };
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / ps.length);
  const rem = abs - base * ps.length;
  ps.forEach(id => { shares[id] = sign * base; });
  if (rem) shares[m.payer] = (shares[m.payer] || 0) + sign * rem;
  return { total, shares, ps, remainder: rem };
}
function perPersonPreview(trip, m) {
  const ps = participants(trip, m);
  if (!ps.length || m.amount == null || m.amount === '') return null;
  const amt = num(m.amount, 0);
  const cur = m.currency || trip.currency;
  const p = Math.pow(10, curDec(cur));
  const tot = Math.round(amt * p);
  const base = Math.floor(Math.abs(tot) / ps.length);
  const rem = Math.abs(tot) - base * ps.length;
  return { n: ps.length, each: base / p, rem: rem / p, cur, solo: !!m.solo || ps.length === 1 };
}

function computeBalances(trip) {
  const unit = settleUnit(trip);
  const ex = allExpenses(trip);
  const bal = {};
  trip.members.forEach(m => { bal[m.id] = { paid: 0, owed: 0, paidItems: [], owedItems: [] }; });
  ex.forEach(e => {
    const { total, shares } = sharesOf(trip, e.money);
    if (bal[e.money.payer]) {
      bal[e.money.payer].paid += total;
      bal[e.money.payer].paidItems.push({ e, total, others: total - (shares[e.money.payer] || 0) });
    }
    Object.keys(shares).forEach(id => {
      if (!bal[id]) return;
      bal[id].owed += shares[id];
      bal[id].owedItems.push({ e, share: shares[id], self: id === e.money.payer });
    });
  });
  Object.values(bal).forEach(b => { b.diff = b.paid - b.owed; });
  return { bal, unit, ex };
}

// 受け取り最大の人へ、払う側を大きい順に当てる（送金回数を最小化、n人で最大n−1回）
function computeTransfers(trip) {
  const { bal, unit } = computeBalances(trip);
  const cred = [], debt = [];
  Object.keys(bal).forEach(id => {
    const d = bal[id].diff;
    if (d > 0) cred.push({ id, v: d });
    else if (d < 0) debt.push({ id, v: -d });
  });
  const out = [];
  let guard = 0;
  while (cred.length && debt.length && guard++ < 100) {
    cred.sort((a, b) => b.v - a.v);
    debt.sort((a, b) => b.v - a.v);
    const c = cred[0], d = debt[0];
    const v = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, amount: v / unit, key: d.id + '>' + c.id });
    c.v -= v; d.v -= v;
    if (!c.v) cred.shift();
    if (!d.v) debt.shift();
  }
  return { transfers: out, bal, unit };
}

// 精算済みチェック後に支出が変わったらリセットして再計算した旨を出す
function reconcileSettlement(trip) {
  const { transfers } = computeTransfers(trip);
  const sig = hashStr(transfers.map(t => t.key + ':' + t.amount).join('|') + '#' + trip.currency);
  const st = trip.settlement || (trip.settlement = { signature: '', transfers: {}, notice: '' });
  if (st.signature !== sig) {
    const hadChecks = Object.values(st.transfers || {}).some(x => x.checked || x.actualRecv != null || x.actualPaid != null);
    if (st.signature && hadChecks) {
      st.transfers = {};
      st.notice = '支出が変更されたため精算を再計算しました（精算済みチェックをリセットしました）';
    }
    st.signature = sig;
    return { transfers, changed: true };
  }
  return { transfers, changed: false };
}
function transferState(trip, t) {
  const st = (trip.settlement.transfers || {})[t.key] || {};
  const rcv = st.actualRecv != null && st.actualRecv !== '' ? convert(num(st.actualRecv), st.actualRecvCur || trip.currency, trip.currency) : null;
  const pay = st.actualPaid != null && st.actualPaid !== '' ? convert(num(st.actualPaid), st.actualPaidCur || trip.currency, trip.currency) : null;
  const basis = rcv != null ? rcv : pay;
  const remain = basis != null ? roundCur(Math.max(0, t.amount - basis), trip.currency) : t.amount;
  const adjust = basis != null ? roundCur(basis - t.amount, trip.currency) : 0;
  return { st, rcv, pay, remain, adjust };
}
function settlementComplete(trip) {
  const { transfers } = computeTransfers(trip);
  if (!transfers.length) return true;
  return transfers.every(t => ((trip.settlement.transfers || {})[t.key] || {}).checked);
}

// 通貨換算（市場レート。S.fx.toJpy：1単位が何円か）
function marketToJpy(cur) {
  if (cur === 'JPY') return 1;
  return S.fx && S.fx.toJpy && S.fx.toJpy[cur] ? S.fx.toJpy[cur] : null;
}
function convert(v, from, to) {
  if (from === to) return v;
  const a = marketToJpy(from), b = marketToJpy(to);
  if (a == null || b == null) return v;
  return v * a / b;
}
function settleToJpy(trip) {
  if (trip.currency === 'JPY') return 1;
  return num(trip.settleJpyRate, 0) || marketToJpy(trip.currency) || null;
}

// ---------------------------------------------------------------------------
// 実効レート：（両替で払った円 − 戻して得た円 − 繰越分×取得レート）÷ 使った外貨現金
// ---------------------------------------------------------------------------
function foreignCurrencies(trip) {
  const set = new Set();
  allExpenses(trip).forEach(e => { if (e.money.currency && e.money.currency !== 'JPY') set.add(e.money.currency); });
  trip.exchanges.forEach(x => { if (x.currency && x.currency !== 'JPY') set.add(x.currency); });
  return [...set];
}
function cashUsedForeign(trip, cur) {
  const me = meMember(trip);
  return sum(allExpenses(trip).filter(e => e.money.currency === cur && e.money.payer === (me && me.id) && isCashMethod(e.money.method) && e.money.payState !== '現地で払う予定'), e => num(e.money.amount, 0));
}
function effectiveRate(trip, cur) {
  const xs = trip.exchanges.filter(x => x.currency === cur);
  const buys = xs.filter(x => x.dir === 'buy'), sells = xs.filter(x => x.dir === 'sell');
  const jpyBuy = sum(buys, x => num(x.jpy)), fBuy = sum(buys, x => num(x.amount));
  const jpySell = sum(sells, x => num(x.jpy)), fSell = sum(sells, x => num(x.amount));
  const used = cashUsedForeign(trip, cur);
  const close = (trip.fxClose || {})[cur] || 'open';
  const buyRate = fBuy ? jpyBuy / fBuy : null;
  const left = fBuy - fSell - used;
  const r = { cur, jpyBuy, fBuy, jpySell, fSell, used, close, buyRate, left, rate: null, final: false, note: '' };
  if (!fBuy) { r.note = '両替の記録がありません'; r.rate = marketToJpy(cur); return r; }
  if (!used) { r.note = '外貨現金の支出がまだありません'; r.rate = buyRate; return r; }
  if (close === 'open') { r.rate = buyRate; r.note = '暫定（両替レート）。戻し両替を入力して確定してください'; return r; }
  const carry = close === 'carry' ? Math.max(0, left) : 0;
  r.carry = carry;
  r.rate = (jpyBuy - jpySell - carry * buyRate) / used;
  r.final = true;
  if (close === 'returned' && Math.abs(left) > 0.009) r.note = '外貨の残高が ' + fmtMoney(left, cur) + ' 合いません（戻し両替・支出の入力漏れ？）';
  return r;
}

// ---------------------------------------------------------------------------
// 家計簿へ送る明細：自分の負担分だけを支出明細ごとに。自分がカードで払った分は
// 「支出＝引落額（全額）」＋「収入＝割り勘分（自分以外の負担分）」の2本
// ---------------------------------------------------------------------------
function kakeiboEntries(trip) {
  const me = meMember(trip);
  if (!me) return [];
  const out = [];
  const stj = settleToJpy(trip);
  const tag = '#' + trip.title;
  const usage = S.settings.kakeiboUsage, budget = S.settings.kakeiboBudget;
  allExpenses(trip).forEach(e => {
    const m = e.money;
    const { total, shares } = sharesOf(trip, m);
    const unit = settleUnit(trip);
    const myS = (shares[me.id] || 0);
    const iPaid = m.payer === me.id;
    const row = { e, entries: [], disabled: '', note: '' };
    const memo = e.desc.replace(/（事前支払い）/, '') + ' ' + tag;
    const date = e.date || trip.startDate || todayStr();
    const sentInfo = e.ref.kakeibo || null;
    if (m.payState === '現地で払う予定') row.disabled = '未払い（現地で払う予定）';
    if (!iPaid && !myS) return;
    if (iPaid && isCardMethod(m.method)) {
      const pm = payMethod(m.method);
      let full = m.currency === 'JPY' ? num(m.amount) : (m.cardJpy != null && m.cardJpy !== '' ? num(m.cardJpy) : null);
      if (full == null) { row.disabled = row.disabled || 'カード明細の円額（引落額）を入力してください'; full = 0; }
      const ratio = total ? myS / total : 1;
      const others = Math.round(full * (1 - ratio));
      row.entries.push({ sourceKey: e.key + ':exp', date, amount: -Math.round(full), memo, category: pm ? pm.kakeiboCategory : 'その他（支出）', usage, budget, tag, kind: '支出（引落額）' });
      if (others > 0) row.entries.push({ sourceKey: e.key + ':inc', date, amount: others, memo: memo + '（割り勘分）', category: S.settings.kakeiboIncomeCategory || '割り勘', usage: '', budget: '精算・移動', tag, kind: '収入（割り勘分）' });
      row.note = 'カード払い：引落額 ' + fmtMoney(full) + '／自分の負担 ' + fmtMoney(full - others);
    } else {
      let jpy;
      if (iPaid && m.currency !== 'JPY' && isCashMethod(m.method)) {
        const er = effectiveRate(trip, m.currency);
        const myForeign = total ? num(m.amount) * myS / total : 0;
        if (!er.final) { row.disabled = row.disabled || '外貨現金：戻し両替（または繰越）を入力して実効レートを確定してから送れます'; }
        jpy = er.rate ? Math.round(myForeign * er.rate) : 0;
        row.note = '実効レート ' + (er.rate ? er.rate.toFixed(3) : '—') + '円/' + m.currency + (er.final ? '' : '（暫定）');
      } else if (iPaid && m.currency !== 'JPY' && !isCashMethod(m.method)) {
        // 現金でもカードでもない外貨払い（電子決済など）：引落円額があれば比率で
        if (m.cardJpy != null && m.cardJpy !== '') jpy = Math.round(num(m.cardJpy) * (total ? myS / total : 1));
        else { jpy = stj ? Math.round(myS / unit * stj) : 0; row.note = '市場レート換算'; }
      } else {
        jpy = stj ? Math.round(myS / unit * stj) : 0;
        if (!stj) row.disabled = row.disabled || '精算通貨の円換算レートがありません';
      }
      if (!jpy && !row.disabled) return;
      const pm = iPaid ? payMethod(m.method) : null;
      row.entries.push({ sourceKey: e.key + ':exp', date, amount: -jpy, memo, category: pm ? pm.kakeiboCategory : (S.settings.kakeiboSettleCategory || 'その他（支出）'), usage, budget, tag, kind: iPaid ? '支出（自分の負担分）' : '支出（立替てもらった自分の負担分）' });
    }
    const sig = hashStr(JSON.stringify(row.entries.map(x => [x.sourceKey, x.amount, x.date, x.category])));
    row.sig = sig;
    row.sent = sentInfo;
    row.changedAfterSend = !!(sentInfo && sentInfo.sig !== sig);
    out.push(row);
  });
  return out;
}

function budgetSummary(trip) {
  const ex = allExpenses(trip);
  const unit = settleUnit(trip);
  const byCat = {};
  EXPENSE_CATS.forEach(c => byCat[c] = 0);
  let total = 0, planned = 0;
  ex.forEach(e => {
    const v = toSettle(trip, e.money) / unit;
    byCat[e.cat] = (byCat[e.cat] || 0) + v;
    total += v;
    if (e.money.payState === '現地で払う予定') planned += v;
  });
  const budget = trip.budget != null && trip.budget !== '' ? num(trip.budget) : null;
  return { total, byCat, planned, budget, remain: budget != null ? budget - total : null };
}

function totalDistance(trip) {
  return sum(trip.odometer || [], o => (o.arrive != null && o.depart != null && o.arrive !== '' && o.depart !== '') ? Math.max(0, num(o.arrive) - num(o.depart)) : 0);
}
