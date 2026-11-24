// ============================================================================
// 11 記録タブ：日ごとのメモ／旅全体の評価／代表写真リンク／まとめ／行ったスポット／記録完了
// ============================================================================
function renderRecord(trip) {
  const rec = trip.record;
  const bs = budgetSummary(trip);
  const visited = trip.items.filter(i => i.visited);
  const days = tripDays(trip);
  const km = totalDistance(trip);
  let h = `<div class="card summary"><b>📊 旅のまとめ（自動集計）</b>
    <div class="sum-grid">
      <div><div class="muted small">総額</div><div class="h3">${fmtMoney(bs.total, trip.currency)}</div></div>
      <div><div class="muted small">1人あたり</div><div class="h3">${fmtMoney(bs.total / Math.max(1, trip.members.length), trip.currency)}</div></div>
      <div><div class="muted small">総走行距離</div><div class="h3">${km ? km.toLocaleString() + 'km' : '—'}</div></div>
      <div><div class="muted small">行ったスポット</div><div class="h3">${visited.length}件</div></div>
      <div><div class="muted small">日数</div><div class="h3">${days.length ? days.length + '日' + (nights(trip) ? '（' + nights(trip) + '泊）' : '（日帰り）') : '—'}</div></div>
    </div></div>`;
  h += `<div class="card"><b>⭐ 旅全体の評価</b><div>${stars(rec.rating || 0, 'recStar')}</div>
    <textarea rows="2" data-change="recComment" placeholder="ひとこと感想">${esc(rec.comment || '')}</textarea>
    <div class="mt"><b>📷 代表写真のリンク</b><span class="muted small">（任意。写真そのものは持ちません）</span>
    <input data-change="recPhoto" value="${esc(rec.photoUrl || '')}" placeholder="Googleフォトのアルバムなどのリンク" inputmode="url">
    ${rec.photoUrl ? `<a class="btn sm mt" href="${esc(rec.photoUrl)}" target="_blank" rel="noopener">🔗 写真を開く</a>` : ''}</div></div>`;
  if (days.length) {
    h += `<div class="section-title">📝 日ごとのメモ</div>`;
    days.forEach((d, i) => {
      h += `<div class="card"><b>${i + 1}日目 ${fmtDateFull(d)}</b>
        <textarea rows="3" data-change="recDay" data-d="${d}" placeholder="この日の出来事・感想">${esc(rec.days[d] || '')}</textarea></div>`;
    });
  }
  h += `<div class="section-title">✅ この旅で「行った」にしたスポット（${visited.length}）</div>`;
  if (visited.length) h += visited.map(it => {
    const info = itemInfo(trip, it); const v = it.visited;
    return `<div class="card visit-card" data-act="visitEdit" data-id="${it.id}"><div class="row between"><b>${esc(info.name)}</b><span>${v.rating ? '★'.repeat(v.rating) + '☆'.repeat(5 - v.rating) : '<span class="muted small">評価なし</span>'}</span></div>
      <div class="muted small">${fmtDateFull(v.date)} ・ ${esc((v.companions || []).join('・'))}${it.spotId ? '' : ' ・ スポット帳未登録'}</div>${v.comment ? `<div>${esc(v.comment)}</div>` : ''}</div>`;
  }).join('');
  else h += `<div class="muted small pad">しおり・リスト・ドライブの「行った」ボタンで記録されます</div>`;
  const settled = settlementComplete(trip);
  h += `<div class="card ${rec.done ? 'ok-card' : ''}"><label class="check big"><input type="checkbox" data-change="recDone" ${rec.done ? 'checked' : ''}> 記録完了</label>
    <div class="muted small">精算の全件完了（${settled ? '✅ 済' : '未'}）と記録完了が揃うと、ホームに「完了にできます」が出ます</div></div>`;
  return h;
}
ACT.recStar = (el) => { const t = curTrip(); t.record.rating = Number(el.dataset.v); commitTrip(t); };
ON_CHANGE.recComment = (el) => { const t = curTrip(); t.record.comment = el.value; commitTrip(t, { noRender: true }); };
ON_CHANGE.recPhoto = (el) => { const t = curTrip(); t.record.photoUrl = el.value.trim(); commitTrip(t); };
ON_CHANGE.recDay = (el) => { const t = curTrip(); t.record.days[el.dataset.d] = el.value; commitTrip(t, { noRender: true }); };
ON_CHANGE.recDone = (el) => {
  const t = curTrip(); t.record.done = el.checked; commitTrip(t);
  if (el.checked && settlementComplete(t)) toast('精算と記録が揃いました。ホームから完了にできます');
};
