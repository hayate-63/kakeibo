// ============================================================================
// 10 お金タブ：為替計算機（常設）／予算／支出／精算／両替・実効レート／家計簿連携
// ============================================================================
function renderMoney(trip) {
  if (reconcileSettlement(trip).changed) commitTrip(trip, { noRender: true });
  const sub = S.ui.moneySub;
  let h = fxCalcCardHTML(trip, false);
  h += segHTML('moneySub', [{ v: 'list', l: '🧾 支出' }, { v: 'settle', l: '🤝 精算' }, { v: 'kakeibo', l: '📒 両替・家計簿' }], sub, 'moneySub');
  if (sub === 'list') h += renderExpenseList(trip);
  else if (sub === 'settle') h += renderSettlement(trip);
  else h += renderKakeibo(trip);
  return h;
}
ACT.moneySub = (el) => { S.ui.moneySub = el.dataset.v; render(); };

// ---------------------------------------------------------------------------
// 為替計算機：現在地からその国の通貨を判定し、市場レートで円換算（買い物中の目安）
// ---------------------------------------------------------------------------
function fxCalcCardHTML(trip, inModal) {
  const st = S.ui.fxCalc;
  const cur = st.cur || (trip.currency !== 'JPY' ? trip.currency : (foreignCurrencies(trip)[0] || 'USD'));
  st.cur = cur;
  const rate = marketToJpy(cur);
  const amt = num(st.amount, 0);
  if (!S.fx) ensureFx().then(() => render());
  return `<div class="card fxcalc ${inModal ? 'in-modal' : ''}">
    <div class="row between"><b>💱 為替計算機</b><span class="muted small">${st.detected ? '📍' + esc(st.detected) : ''}${S.fx ? ' レート：' + esc(S.fx.at || '') : ' 取得中…'}</span></div>
    <div class="fx-row">
      <select data-change="fxCur" class="cur-sel">${currencyOptions(cur)}</select>
      <input class="amount-in" id="fxAmt" inputmode="decimal" value="${esc(st.amount)}" placeholder="現地通貨の金額" data-input="fxAmt">
      <button class="btn sm" data-act="fxDetect" title="現在地から通貨を判定">📍</button>
    </div>
    <div class="fx-out" id="fxOut">${rate ? '≈ <b>' + fmtMoney(amt * rate, 'JPY') + '</b> <span class="muted small">（1' + cur + '＝' + rate.toFixed(rate < 1 ? 4 : 2) + '円・市場レート）</span>' : '<span class="muted">レートがありません</span>'}</div>
    <div class="row gap mt">${inModal ? '<button class="btn primary grow" data-act="fxApply">この金額を支出に反映</button>' : '<button class="btn sm grow" data-act="fxToExpense">この金額で支出を追加</button>'}</div>
    <div class="muted small">買い物中の目安は市場レート、家計簿への確定額は実効レート（両替・戻し両替から計算）を使います</div>
  </div>`;
}
ON_INPUT.fxAmt = (el) => {
  S.ui.fxCalc.amount = el.value;
  const rate = marketToJpy(S.ui.fxCalc.cur);
  const out = el.closest('.fxcalc').querySelector('.fx-out');
  let v = 0; try { v = evalExpr(el.value || '0'); } catch (e) { v = num(el.value, 0); }
  if (rate) out.innerHTML = '≈ <b>' + fmtMoney(v * rate, 'JPY') + '</b> <span class="muted small">（1' + S.ui.fxCalc.cur + '＝' + rate.toFixed(rate < 1 ? 4 : 2) + '円・市場レート）</span>';
};
ON_CHANGE.fxCur = (el) => { S.ui.fxCalc.cur = el.value; rerenderFxCalc(el); };
function rerenderFxCalc(el) {
  const card = el.closest('.fxcalc'); const inModal = card.classList.contains('in-modal');
  const tmp = document.createElement('div'); tmp.innerHTML = fxCalcCardHTML(curTrip(), inModal);
  card.replaceWith(tmp.firstElementChild);
}
ACT.fxDetect = async (el) => {
  if (!S.geo) { toast('現在地を取得できていません（位置情報の許可を確認してください）'); return; }
  try {
    const r = await api('countryOf', { lat: S.geo.lat, lng: S.geo.lng });
    const cur = COUNTRY_CURRENCY[r.country] || null;
    S.ui.fxCalc.detected = (r.name || r.country) + (cur ? '（' + cur + '）' : '');
    if (cur) S.ui.fxCalc.cur = cur === 'JPY' ? S.ui.fxCalc.cur : cur;
    await ensureFx(true);
    rerenderFxCalc(el);
    toast(cur ? r.name + '：' + cur + ' のレートを取得しました' : '通貨を判定できませんでした');
  } catch (e) { toast('判定に失敗：' + e.message); }
};
function fxCalcValue() { let v = 0; try { v = evalExpr(S.ui.fxCalc.amount || '0'); } catch (e) { v = num(S.ui.fxCalc.amount, 0); } return v; }
ACT.fxToExpense = () => {
  const t = curTrip(); const cur = S.ui.fxCalc.cur;
  const a = marketToJpy(cur), b = marketToJpy(t.currency);
  openExpenseEditor(t, newExpense(t, { money: newMoney(t, { amount: fxCalcValue() || null, currency: cur, rate: a && b ? Math.round(a / b * 10000) / 10000 : 1 }) }), true);
};
// 支出の入力画面から開く為替計算機（計算した金額をそのまま支出の金額へ）
let fxTargetEditor = null;
ACT.openFxCalcForField = (el) => {
  fxTargetEditor = el.closest('.money-ed');
  const t = curTrip();
  if (fxTargetEditor) {
    const c = $('[data-mf="currency"]', fxTargetEditor).value;
    if (c !== 'JPY') S.ui.fxCalc.cur = c;
    const a = $('[data-mf="amount"]', fxTargetEditor).value; if (a) S.ui.fxCalc.amount = a;
  }
  openModal(fxCalcCardHTML(t, true), { title: '💱 為替計算機' });
};
ACT.fxApply = async () => {
  const ed = fxTargetEditor; const v = fxCalcValue(); const cur = S.ui.fxCalc.cur;
  closeModal();
  if (!ed) return;
  $('[data-mf="amount"]', ed).value = v;
  const sel = $('[data-mf="currency"]', ed);
  if (sel.value !== cur) { sel.value = cur; await ON_CHANGE.moneyCur(sel); }
  updateMoneyPreview(ed);
};

// ---------------------------------------------------------------------------
// 予算・支出一覧
// ---------------------------------------------------------------------------
function newExpense(trip, o) {
  return Object.assign({ id: uid('ex'), date: tripDays(trip).includes(todayStr()) ? todayStr() : (trip.startDate || todayStr()), desc: '', cat: '食費', memo: '', money: newMoney(trip), kakeibo: null }, o || {});
}
function renderExpenseList(trip) {
  const bs = budgetSummary(trip);
  const cur = trip.currency;
  const max = Math.max(1, ...Object.values(bs.byCat));
  let h = `<div class="card"><div class="row between"><b>💰 予算と実績</b><span class="muted small">精算通貨 ${cur}</span></div>
    <div class="budget-nums"><div><div class="muted small">実績</div><div class="h2">${fmtMoney(bs.total, cur)}</div></div>
    ${bs.budget != null ? `<div><div class="muted small">予算</div><div class="h3">${fmtMoney(bs.budget, cur)}</div></div><div><div class="muted small">残り</div><div class="h3 ${bs.remain < 0 ? 'ng' : 'ok'}">${fmtMoney(bs.remain, cur)}</div></div>` : '<div class="muted small">予算は旅の編集で設定できます</div>'}</div>
    ${bs.budget != null ? `<div class="progress ${bs.total > bs.budget ? 'over' : ''}"><div style="width:${Math.min(100, bs.total / Math.max(1, bs.budget) * 100)}%"></div></div>` : ''}
    <div class="cat-bars">${EXPENSE_CATS.filter(c => bs.byCat[c]).map(c => `<div class="cat-bar"><span>${EXPENSE_CAT_ICON[c]} ${c}</span><div class="bar"><div style="width:${bs.byCat[c] / max * 100}%"></div></div><b>${fmtMoney(bs.byCat[c], cur)}</b></div>`).join('')}</div>
    ${bs.planned ? `<div class="muted small">うち「現地で払う予定」${fmtMoney(bs.planned, cur)}</div>` : ''}
    <div class="muted small">1人あたり ${fmtMoney(bs.total / Math.max(1, trip.members.length), cur)}（${trip.members.length}人）</div></div>`;
  h += `<div class="row between"><div class="section-title">🧾 支出</div><button class="btn primary sm" data-act="expenseNew">＋ 支出を追加</button></div>`;
  const ex = allExpenses(trip);
  if (!ex.length) return h + emptyHTML('🧾', '支出はまだありません。予約の金額と給油は自動でここに入ります。');
  let lastDate = null;
  ex.forEach(e => {
    if (e.date !== lastDate) { h += `<div class="group-label">${fmtDateFull(e.date)}</div>`; lastDate = e.date; }
    const m = e.money; const ps = participants(trip, m);
    const s = toSettle(trip, m) / settleUnit(trip);
    h += `<div class="ex-row" data-act="expenseOpen" data-key="${e.key}">
      <div class="ex-icon">${EXPENSE_CAT_ICON[e.cat] || '🧾'}</div>
      <div class="grow"><div>${esc(e.desc)}</div>
        <div class="muted small">${esc(memberName(trip, m.payer))}が払った・${m.solo || ps.length === 1 ? '割り勘なし' : ps.length + '人で割り勘'}・${esc((payMethod(m.method) || { name: '' }).name)}
        ${e.source === 'booking' ? '<span class="tag">予約から</span>' : ''}${e.source === 'fuel' ? '<span class="tag">給油から</span>' : ''}${m.payState === '現地で払う予定' ? '<span class="tag warn">現地で払う予定</span>' : ''}${e.ref.kakeibo ? '<span class="tag ok">家計簿済</span>' : ''}</div></div>
      <div class="ex-amt"><b>${fmtMoney(num(m.amount), m.currency)}</b>${m.currency !== trip.currency ? `<div class="muted small">≈${fmtMoney(s, trip.currency)}</div>` : ''}</div></div>`;
  });
  return h;
}
ACT.expenseNew = () => { const t = curTrip(); openExpenseEditor(t, newExpense(t), true); };
ACT.expenseOpen = (el) => {
  const t = curTrip(); const e = allExpenses(t).find(x => x.key === el.dataset.key);
  if (!e) return;
  if (e.source === 'booking') openBookingEditor(t, e.ref);
  else if (e.source === 'fuel') openFuelEditor(t, e.ref);
  else openExpenseEditor(t, e.ref);
};
function openExpenseEditor(trip, e, isNew) {
  openModal(`<div class="form-grid">
    <label>日付</label><input type="date" id="exDate" value="${esc(e.date)}">
    <label>内容</label><input id="exDesc" value="${esc(e.desc)}" placeholder="例：昼ごはん">
    <label>カテゴリー</label><div class="chips">${EXPENSE_CATS.map(c => `<label class="chip"><input type="radio" name="exCat" value="${c}" ${e.cat === c ? 'checked' : ''}><span>${EXPENSE_CAT_ICON[c]} ${c}</span></label>`).join('')}</div>
    <label>金額</label><div>${moneyEditorHTML(trip, e.money)}</div>
    <label>メモ</label><input id="exMemo" value="${esc(e.memo)}">
  </div>
  ${e.kakeibo ? `<div class="info-box small">📒 家計簿へ送信済み（${esc(new Date(e.kakeibo.sentAt).toLocaleString('ja-JP'))}）。金額を変えた場合は家計簿側も直してください。</div>` : ''}
  <div class="row gap mt"><button class="btn primary grow" data-act="exSave">保存</button>${!isNew ? '<button class="btn danger" data-act="exDel">削除</button>' : ''}</div>`,
    { title: isNew ? '＋ 支出' : '🧾 支出の編集', full: true, data: { trip, e, isNew }, onMount: (b) => updateMoneyPreview($('.money-ed', b)) });
}
ACT.exSave = () => {
  const b = topModalBody(); const { trip, e, isNew } = topModal().data;
  const money = readMoneyEditor(b);
  if (money.amount == null) return toast('金額を入れてください');
  Object.assign(e, { date: $('#exDate', b).value || todayStr(), desc: $('#exDesc', b).value.trim(), cat: ($$('input[name="exCat"]', b).find(x => x.checked) || {}).value || 'その他', memo: $('#exMemo', b).value, money });
  if (isNew) trip.expenses.push(e);
  closeModal(); commitTrip(trip);
  toast('支出を保存しました');
};
ACT.exDel = async () => {
  const { trip, e } = topModal().data;
  if (!(await confirmDialog('この支出を削除しますか？'))) return;
  trip.expenses = trip.expenses.filter(x => x !== e);
  closeModal(); commitTrip(trip);
};

// ---------------------------------------------------------------------------
// 精算
// ---------------------------------------------------------------------------
function renderSettlement(trip) {
  const { transfers, bal } = computeTransfers(trip);
  const unit = settleUnit(trip), cur = trip.currency;
  let h = '';
  if (trip.settlement.notice) h += `<div class="alert info">ℹ️ ${esc(trip.settlement.notice)} <button class="btn sm" data-act="dismissNotice">OK</button></div>`;
  const planned = allExpenses(trip).filter(e => e.money.payState === '現地で払う予定');
  if (planned.length) h += `<div class="alert warn small">「現地で払う予定」の支出が ${planned.length}件 含まれています（払う人が決まっている前提で計算）</div>`;
  h += `<div class="card"><b>👥 メンバーごとの集計</b><table class="tbl"><tr><th>メンバー</th><th>払った合計</th><th>負担合計</th><th>差額</th></tr>
    ${trip.members.map(m => { const b = bal[m.id]; return `<tr><td>${esc(m.name)}${m.isMe ? '👤' : ''}</td><td>${fmtMoney(b.paid / unit, cur)}</td><td>${fmtMoney(b.owed / unit, cur)}</td><td class="${b.diff > 0 ? 'ok' : b.diff < 0 ? 'ng' : ''}">${b.diff > 0 ? '+' : ''}${fmtMoney(b.diff / unit, cur)}</td></tr>`; }).join('')}</table>
    <div class="muted small">差額＋は受け取る人、−は払う人。割り勘の端数は払った人が負担しています</div></div>`;
  h += `<div class="section-title">💸 送金リスト（${transfers.length}件・最小回数）</div>`;
  if (!transfers.length) h += `<div class="card ok-card">✅ 精算の必要はありません</div>`;
  transfers.forEach(t => {
    const s = transferState(trip, t);
    const open = S.ui['tx_' + t.key];
    h += `<div class="card tx ${s.st.checked ? 'done' : ''}">
      <div class="row between"><label class="check"><input type="checkbox" data-change="txCheck" data-key="${t.key}" ${s.st.checked ? 'checked' : ''}> <b>${esc(memberName(trip, t.from))}</b> → <b>${esc(memberName(trip, t.to))}</b></label><b class="h3">${fmtMoney(t.amount, cur)}</b></div>
      <div class="form-grid small">
        <label>実支払額</label><div class="row gap"><input inputmode="decimal" data-change="txAmt" data-f="actualPaid" data-key="${t.key}" value="${s.st.actualPaid != null ? esc(s.st.actualPaid) : ''}" placeholder="${t.amount}"><select data-change="txAmt" data-f="actualPaidCur" data-key="${t.key}">${currencyOptions(s.st.actualPaidCur || cur)}</select></div>
        <label>実受取額</label><div class="row gap"><input inputmode="decimal" data-change="txAmt" data-f="actualRecv" data-key="${t.key}" value="${s.st.actualRecv != null ? esc(s.st.actualRecv) : ''}" placeholder="${t.amount}"><select data-change="txAmt" data-f="actualRecvCur" data-key="${t.key}">${currencyOptions(s.st.actualRecvCur || cur)}</select></div>
      </div>
      ${s.rcv != null || s.pay != null ? `<div class="small">${s.adjust ? `端数調整 <b class="${s.adjust > 0 ? 'ok' : 'ng'}">${s.adjust > 0 ? '+' : ''}${fmtMoney(s.adjust, cur)}</b>（予定 ${fmtMoney(t.amount, cur)}）・` : ''}残額 <b>${fmtMoney(s.remain, cur)}</b>（実受取額ベース）</div>` : ''}
      <button class="link-btn" data-act="txToggle" data-key="${t.key}">${open ? '▲ 内訳を閉じる' : '▼ 内訳を見る'}</button>
      ${open ? transferBreakdownHTML(trip, t, bal, unit) : ''}
    </div>`;
  });
  if (transfers.length) h += `<div class="muted small center">${settlementComplete(trip) ? '✅ 全件精算済み（旅の完了条件の1つを満たしました）' : '全件にチェックが付くと精算完了です'}</div>`;
  return h;
}
function transferBreakdownHTML(trip, t, bal, unit) {
  const cur = trip.currency;
  const A = bal[t.from], B = bal[t.to];
  const li = (arr, f) => arr.map(f).join('');
  return `<div class="breakdown">
    <div class="b">${esc(memberName(trip, t.from))}さんの負担内訳（${fmtMoney(A.owed / unit, cur)}）</div>
    ${li(A.owedItems, x => `<div class="bd-row"><span>${fmtDate(x.e.date)} ${esc(x.e.desc)}${x.self ? '（自分払い）' : '（' + esc(memberName(trip, x.e.money.payer)) + '払い）'}</span><span>${fmtMoney(x.share / unit, cur)}</span></div>`)}
    <div class="b mt">${esc(memberName(trip, t.from))}さんが払った分（相殺 ${fmtMoney(A.paid / unit, cur)}）</div>
    ${A.paidItems.length ? li(A.paidItems, x => `<div class="bd-row"><span>${fmtDate(x.e.date)} ${esc(x.e.desc)}</span><span>−${fmtMoney(x.total / unit, cur)}</span></div>`) : '<div class="muted small">なし</div>'}
    <div class="bd-row total"><span>差し引き（払う額）</span><span>${fmtMoney(-A.diff / unit, cur)}</span></div>
    <div class="b mt">${esc(memberName(trip, t.to))}さんの立替内訳（他の人の負担分）</div>
    ${B.paidItems.filter(x => x.others).length ? li(B.paidItems.filter(x => x.others), x => `<div class="bd-row"><span>${fmtDate(x.e.date)} ${esc(x.e.desc)}（全額 ${fmtMoney(x.total / unit, cur)}）</span><span>${fmtMoney(x.others / unit, cur)}</span></div>`) : '<div class="muted small">なし</div>'}
    <div class="bd-row total"><span>${esc(memberName(trip, t.to))}さんの受け取り合計</span><span>${fmtMoney(B.diff / unit, cur)}</span></div>
  </div>`;
}
ACT.txToggle = (el) => { S.ui['tx_' + el.dataset.key] = !S.ui['tx_' + el.dataset.key]; render(); };
ACT.dismissNotice = () => { const t = curTrip(); t.settlement.notice = ''; commitTrip(t); };
ON_CHANGE.txCheck = (el) => {
  const t = curTrip(); const st = t.settlement.transfers[el.dataset.key] = t.settlement.transfers[el.dataset.key] || {};
  st.checked = el.checked; st.at = new Date().toISOString();
  if (el.checked) t.settlement.notice = '';
  commitTrip(t);
};
ON_CHANGE.txAmt = (el) => {
  const t = curTrip(); const st = t.settlement.transfers[el.dataset.key] = t.settlement.transfers[el.dataset.key] || {};
  const f = el.dataset.f;
  st[f] = f.endsWith('Cur') ? el.value : (el.value === '' ? null : num(el.value, null));
  if (f.endsWith('Cur')) ensureFx();
  commitTrip(t);
};

// ---------------------------------------------------------------------------
// 両替・実効レート・家計簿連携
// ---------------------------------------------------------------------------
function renderKakeibo(trip) {
  let h = '';
  // 精算通貨が円以外の場合の円換算
  if (trip.currency !== 'JPY') {
    h += `<div class="card"><b>精算通貨（${trip.currency}）の円換算</b><div class="row gap"><span>1${trip.currency}＝</span><input inputmode="decimal" data-change="settleJpy" value="${esc(trip.settleJpyRate || '')}" placeholder="${(marketToJpy(trip.currency) || '').toString().slice(0, 7)}"><span>円</span></div><div class="muted small">空欄なら市場レートを使います（他の人が払った分の自分の負担を家計簿へ送る時に使用）</div></div>`;
  }
  // 両替
  const fcs = foreignCurrencies(trip);
  h += `<div class="row between"><div class="section-title">💴 両替の記録</div><button class="btn sm primary" data-act="exchNew">＋ 両替</button></div>`;
  if (trip.exchanges.length) h += `<div class="card">${trip.exchanges.slice().sort((a, b) => a.date < b.date ? -1 : 1).map(x => `<div class="list-row" data-act="exchEdit" data-id="${x.id}"><span>${fmtDate(x.date)} ${x.dir === 'buy' ? '円→' + x.currency : x.currency + '→円（戻し）'}</span><span>${fmtMoney(num(x.jpy), 'JPY')} ⇄ ${fmtMoney(num(x.amount), x.currency)} <span class="muted small">(${(num(x.jpy) / Math.max(1e-9, num(x.amount))).toFixed(3)}円)</span></span></div>`).join('')}</div>`;
  else h += `<div class="muted small pad">外貨現金を使う旅では、円→外貨の両替と、帰国後の外貨→円の戻し両替を入れると実効レートが確定します。</div>`;
  fcs.forEach(c => {
    const r = effectiveRate(trip, c);
    h += `<div class="card"><div class="row between"><b>${c} の実効レート</b><b class="h3">${r.rate ? r.rate.toFixed(4) + '円' : '—'}</b></div>
      <div class="small">両替 ${fmtMoney(r.jpyBuy)}→${fmtMoney(r.fBuy, c)} ／ 戻し ${fmtMoney(r.fSell, c)}→${fmtMoney(r.jpySell)} ／ 外貨現金の支出 ${fmtMoney(r.used, c)}</div>
      <div class="row gap mt"><span class="small">外貨の残り：</span><select data-change="fxClose" data-cur="${c}">
        <option value="open" ${r.close === 'open' ? 'selected' : ''}>まだ旅行中（暫定）</option>
        <option value="returned" ${r.close === 'returned' ? 'selected' : ''}>戻し両替した（確定）</option>
        <option value="carry" ${r.close === 'carry' ? 'selected' : ''}>次回用に残す（取得レートで確定）</option></select></div>
      ${r.close === 'carry' ? `<div class="small">繰越残高：<b>${fmtMoney(r.carry || 0, c)}</b>（取得レート ${r.buyRate ? r.buyRate.toFixed(4) : '—'}円）</div>` : ''}
      ${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}
      <div class="muted small">※ 自分の両替と、自分が外貨現金で払った支出だけで計算します（他の人が払った分は精算で円になるため対象外）</div>
      ${r.final ? '<div class="ok small">✅ 確定。現金分を家計簿へ送れます</div>' : ''}</div>`;
  });
  // 家計簿
  const rows = kakeiboEntries(trip);
  const me = meMember(trip);
  h += `<div class="section-title mt">📒 家計簿へ送る（${esc(me ? me.name : '')}の負担分）</div>
    <div class="muted small">自分の負担分だけを支出明細ごとに送ります（用途：${esc(S.settings.kakeiboUsage)}、タグ #${esc(trip.title)}）。自分がカードで払った分は「支出＝引落額（全額）」と「収入＝割り勘分」の2本で送ります。</div>`;
  if (!rows.length) return h + emptyHTML('📒', '送る明細はありません');
  const sendable = rows.filter(r => !r.disabled && !r.sent);
  h += `<div class="row gap mt"><label class="check"><input type="checkbox" data-change="kkAll" ${sendable.length ? 'checked' : 'disabled'}> 未送信をすべて選択</label><span class="grow"></span><button class="btn primary sm" data-act="kkSend" ${sendable.length ? '' : 'disabled'}>選択した明細を送信</button></div>`;
  rows.forEach(r => {
    h += `<div class="kk-row ${r.sent ? 'sent' : ''} ${r.disabled ? 'disabled' : ''}">
      <div class="row gap">${!r.sent && !r.disabled ? `<input type="checkbox" class="kk-chk" data-key="${r.e.key}" checked>` : r.sent ? '✅' : '⏸'}
        <div class="grow"><div>${fmtDate(r.e.date)} ${esc(r.e.desc)}</div>
        ${r.entries.map(x => `<div class="small">${esc(x.kind)}：<b class="${x.amount < 0 ? 'ng' : 'ok'}">${x.amount < 0 ? '−' : '+'}${fmtMoney(Math.abs(x.amount))}</b> <span class="muted">［${esc(x.category)}］</span></div>`).join('')}
        ${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}
        ${r.disabled ? `<div class="warn small">⏸ ${esc(r.disabled)}</div>` : ''}
        ${r.sent ? `<div class="muted small">送信済み ${esc(new Date(r.sent.sentAt).toLocaleString('ja-JP'))}${r.changedAfterSend ? ' <span class="warn">⚠️ 送信後に金額が変わっています（家計簿側を直してください）</span>' : ''} <button class="link-btn" data-act="kkUnsend" data-key="${r.e.key}">送信済みを解除</button></div>` : ''}</div></div></div>`;
  });
  return h;
}
ON_CHANGE.settleJpy = (el) => { const t = curTrip(); t.settleJpyRate = el.value === '' ? null : num(el.value, null); commitTrip(t); };
ON_CHANGE.fxClose = (el) => { const t = curTrip(); t.fxClose[el.dataset.cur] = el.value; commitTrip(t); };
ON_CHANGE.kkAll = (el) => { $$('.kk-chk').forEach(c => c.checked = el.checked); };
ACT.kkSend = async (el) => {
  const t = curTrip();
  const keys = new Set($$('.kk-chk').filter(c => c.checked).map(c => c.dataset.key));
  const rows = kakeiboEntries(t).filter(r => keys.has(r.e.key) && !r.disabled && !r.sent);
  if (!rows.length) return toast('送る明細を選んでください');
  const logs = [];
  rows.forEach(r => r.entries.forEach(x => logs.push({ sourceKey: t.id + ':' + x.sourceKey, date: x.date, amount: x.amount, memo: x.memo, category: x.category, usage: x.usage, budget: x.budget, tag: x.tag, source: 'tabicho' })));
  if (!(await confirmDialog(`${rows.length}件（${logs.length}行）を家計簿へ送信します。よろしいですか？`))) return;
  el.disabled = true;
  try {
    const res = await api('kakeiboSend', { logs });
    const ok = new Set(res.keys || logs.map(l => l.sourceKey));
    const at = new Date().toISOString();
    rows.forEach(r => {
      if (r.entries.every(x => ok.has(t.id + ':' + x.sourceKey))) r.e.ref.kakeibo = { sentAt: at, sig: r.sig, keys: r.entries.map(x => x.sourceKey) };
    });
    commitTrip(t);
    toast('家計簿へ送信しました（' + (res.sent != null ? res.sent : logs.length) + '行' + (res.skipped ? '、重複' + res.skipped + '行はスキップ' : '') + '）');
  } catch (e) { el.disabled = false; toast('送信に失敗：' + e.message); }
};
ACT.kkUnsend = async (el) => {
  const t = curTrip(); const e = allExpenses(t).find(x => x.key === el.dataset.key);
  if (!e || !(await confirmDialog('送信済みの印を外します（家計簿側の明細は消えません）。再送すると二重になる可能性があります。よろしいですか？'))) return;
  e.ref.kakeibo = null; commitTrip(t);
};
ACT.exchNew = () => { const t = curTrip(); openExchEditor(t, { id: uid('fx'), date: todayStr(), dir: 'buy', jpy: '', amount: '', currency: foreignCurrencies(t)[0] || (t.currency !== 'JPY' ? t.currency : 'USD') }, true); };
ACT.exchEdit = (el) => { const t = curTrip(); openExchEditor(t, t.exchanges.find(x => x.id === el.dataset.id)); };
function openExchEditor(trip, x, isNew) {
  openModal(`<div class="form-grid">
    <label>日付</label><input type="date" id="fxD" value="${esc(x.date)}">
    <label>向き</label>${segHTML('fxDir', [{ v: 'buy', l: '円 → 外貨（両替）' }, { v: 'sell', l: '外貨 → 円（戻し）' }], x.dir, 'segPick')}
    <label>通貨</label><select id="fxC">${currencyOptions(x.currency)}</select>
    <label>円</label>${amountFieldHTML('id="fxJ"', x.jpy, '円')}
    <label>外貨</label>${amountFieldHTML('id="fxA"', x.amount, '外貨の額')}
  </div><div class="row gap mt"><button class="btn primary grow" data-act="fxSave">保存</button>${!isNew ? '<button class="btn danger" data-act="fxDel">削除</button>' : ''}</div>`,
    { title: '💴 両替', data: { trip, x, isNew } });
}
ACT.fxSave = () => {
  const b = topModalBody(); const { trip, x, isNew } = topModal().data;
  Object.assign(x, { date: $('#fxD', b).value, dir: segValue(b, 'fxDir') || 'buy', currency: $('#fxC', b).value, jpy: num($('#fxJ', b).value, 0), amount: num($('#fxA', b).value, 0) });
  if (!x.jpy || !x.amount) return toast('円と外貨の両方を入れてください');
  if (isNew) trip.exchanges.push(x);
  closeModal(); commitTrip(trip);
};
ACT.fxDel = async () => { const { trip, x } = topModal().data; if (await confirmDialog('削除しますか？')) { trip.exchanges = trip.exchanges.filter(y => y !== x); closeModal(); commitTrip(trip); } };
