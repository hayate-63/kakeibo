// ============================================================================
// 11 記録タブ：まとめ／旅全体の評価／メディア（アルバム・アップロード・日別セクション）／行ったスポット／記録完了
//   v2.0：Q9 の「代表写真はリンクのみ」をメディア機能で置き換え。日ごとのメモと同じ場所にその日の写真・動画を置く
// ============================================================================
function renderRecord(trip) {
  const rec = trip.record;
  const bs = budgetSummary(trip);
  const visited = trip.items.filter(i => i.visited);
  const days = tripDays(trip);
  const km = totalDistance(trip);
  const nPhoto = trip.media.filter(m => m.kind === 'photo').length, nVideo = trip.media.length - nPhoto;
  let h = `<div class="card summary"><div class="row between"><b>📊 旅のまとめ（自動集計）</b><button class="btn sm accent" data-act="openVisual">📖 ビジュアル</button></div>
    <div class="sum-grid">
      <div><div class="muted small">総額</div><div class="h3">${fmtMoney(bs.total, trip.currency)}</div></div>
      <div><div class="muted small">1人あたり</div><div class="h3">${fmtMoney(bs.total / Math.max(1, trip.members.length), trip.currency)}</div></div>
      <div><div class="muted small">総走行距離</div><div class="h3">${km ? km.toLocaleString() + 'km' : '—'}</div></div>
      <div><div class="muted small">行ったスポット</div><div class="h3">${visited.length}件</div></div>
      <div><div class="muted small">日数</div><div class="h3">${days.length ? days.length + '日' + (nights(trip) ? '（' + nights(trip) + '泊）' : '（日帰り）') : '—'}</div></div>
      <div><div class="muted small">写真・動画</div><div class="h3">${nPhoto}・${nVideo}</div></div>
    </div></div>`;
  h += `<div class="card"><b>⭐ 旅全体の評価</b><div>${stars(rec.rating || 0, 'recStar')}</div>
    <textarea rows="2" data-change="recComment" placeholder="ひとこと感想">${esc(rec.comment || '')}</textarea></div>`;

  // ---- メディア ----
  h += `<div class="section-title row between"><span>📷 写真・動画</span><button class="btn sm primary" data-act="mediaAdd">＋ 追加</button></div>
    <input type="file" id="mediaPick" accept="image/*,video/*" multiple style="display:none">
    ${albumsHTML(trip)}
    ${trip.driveFolderName ? `<div class="muted small">保存先：Drive「${esc(trip.driveFolderName)}」</div>` : ''}
    ${queueHTML(trip)}`;
  const { by, unset } = mediaByDay(trip);
  days.forEach((d, i) => {
    const list = by[d];
    const key = trip.id + d;
    const closed = S.ui.dayClosed && S.ui.dayClosed[key];
    const np = list.filter(m => m.kind === 'photo').length, nv = list.length - np;
    h += `<div class="card day-sec"><div class="row between day-head" data-act="dayToggle" data-k="${key}">
        <b>${closed ? '▶' : '▼'} ${i + 1}日目 ${fmtDateFull(d)}</b><span class="muted small">${np ? '📷' + np : ''} ${nv ? '🎬' + nv : ''}</span></div>
      ${closed ? '' : `<textarea rows="3" data-change="recDay" data-d="${d}" placeholder="この日の出来事・感想">${esc(rec.days[d] || '')}</textarea>
        ${mediaGridHTML(trip, list)}
        <button class="btn sm mt" data-act="mediaAdd" data-date="${d}">＋ この日に写真・動画</button>`}</div>`;
  });
  if (unset.length || !days.length) {
    h += `<div class="card day-sec"><div class="row between"><b>📂 日付未設定</b><span class="muted small">${unset.length}件</span></div>
      <div class="muted small">撮影日時が取れない・日程の外のものはここに入ります。タップして日付を変えると日別に移ります</div>
      ${mediaGridHTML(trip, unset)}</div>`;
  }

  h += `<div class="section-title">✅ この旅で「行った」にしたスポット（${visited.length}）</div>`;
  if (visited.length) h += visited.map(it => {
    const info = itemInfo(trip, it); const v = it.visited;
    const nMedia = trip.media.filter(m => (it.spotId && m.spotId === it.spotId) || m.itemId === it.id).length;
    return `<div class="card visit-card" data-act="visitEdit" data-id="${it.id}"><div class="row between"><b>${esc(info.name)}</b><span class="face-big">${faceHTML(v.rating)}</span></div>
      <div class="muted small">${fmtDateFull(v.date)} ・ ${esc((v.companions || []).join('・'))}${it.spotId ? '' : ' ・ スポット帳未登録'}${nMedia ? ' ・ 📷' + nMedia : ''}</div>${v.comment ? `<div>${esc(v.comment)}</div>` : ''}</div>`;
  }).join('');
  else h += `<div class="muted small pad">しおり・リスト・ドライブの「行った」ボタンで記録されます</div>`;
  const settled = settlementComplete(trip);
  h += `<div class="card ${rec.done ? 'ok-card' : ''}"><label class="check big"><input type="checkbox" data-change="recDone" ${rec.done ? 'checked' : ''}> 記録完了</label>
    <div class="muted small">精算の全件完了（${settled ? '✅ 済' : '未'}）と記録完了が揃うと、ホームに「完了にできます」が出ます</div></div>`;
  setTimeout(() => loadThumbs(document.getElementById('page-record')), 0);
  return h;
}
ACT.dayToggle = (el) => { S.ui.dayClosed = S.ui.dayClosed || {}; S.ui.dayClosed[el.dataset.k] = !S.ui.dayClosed[el.dataset.k]; render(); };
ACT.recStar = (el) => { const t = curTrip(); t.record.rating = Number(el.dataset.v); commitTrip(t); };
ON_CHANGE.recComment = (el) => { const t = curTrip(); t.record.comment = el.value; commitTrip(t, { noRender: true }); };
ON_CHANGE.recDay = (el) => { const t = curTrip(); t.record.days[el.dataset.d] = el.value; commitTrip(t, { noRender: true }); };
ON_CHANGE.recDone = (el) => {
  const t = curTrip(); t.record.done = el.checked; commitTrip(t);
  if (el.checked && settlementComplete(t)) toast('精算と記録が揃いました。ホームから完了にできます');
};
