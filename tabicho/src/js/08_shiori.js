// ============================================================================
// 08 しおりタブ：工程（地図＋工程ゾーン＋リストゾーン）／予約／持ち物
// ============================================================================
function renderShiori(trip) {
  const sub = S.ui.shioriSub;
  const tabs = segHTML('shioriSub', [{ v: 'plan', l: '🗺 工程' }, { v: 'book', l: '🎫 予約' + (pendingBookingCount(trip) ? ` <span class="dot-badge">${pendingBookingCount(trip)}</span>` : '') }, { v: 'pack', l: '🎒 持ち物' }], sub, 'shioriSub');
  const wrap = $('#shioriMapWrap');
  if (wrap) wrap.style.display = sub === 'plan' ? '' : 'none';
  $('#shioriTop').innerHTML = tabs;
  let h = '';
  if (sub === 'plan') h = renderPlan(trip);
  else if (sub === 'book') h = renderBookings(trip);
  else h = renderPacking(trip);
  $('#shioriBody').innerHTML = h;
  if (sub === 'plan') { updateMap(trip); requestAnimationFrame(positionEmoji); }
}
ACT.shioriSub = (el) => { S.ui.shioriSub = el.dataset.v; render(); };

function shioriDay(trip) {
  const days = tripDays(trip);
  if (!days.length) return null;
  let d = S.ui.shioriDay[trip.id];
  const td = tripToday(trip);
  if (!d || !days.includes(d)) d = days.includes(td) ? td : days[0];
  S.ui.shioriDay[trip.id] = d;
  return d;
}

function renderPlan(trip) {
  const days = tripDays(trip);
  const day = shioriDay(trip);
  const isShiori = trip.mode === 'shiori';
  let h = `<div class="mode-bar row between">${segHTML('mode', [{ v: 'shiori', l: '📒 しおり' }, { v: 'list', l: '📝 リスト' }], trip.mode, 'switchMode')}<button class="btn sm" data-act="shioriExport">📤 画像で書き出し</button></div>`;
  const hidden = trip.items.filter(i => i.hiddenTime);
  if (isShiori && hidden.length) h += `<div class="info-box small">🕘 リストモードに切り替えた時の時刻を ${hidden.length}件 保持しています。<button class="btn sm" data-act="restoreAllTimes">すべて元の時刻に戻す</button></div>`;
  if (days.length) {
    h += `<div class="day-tabs">${days.map((d, i) => `<button class="day-tab ${d === day ? 'on' : ''}" data-act="pickDay" data-d="${d}">${i + 1}日目${d === tripToday(trip) ? '<em class="today-mark">今日</em>' : ''}<br><span>${fmtDate(d)}</span></button>`).join('')}</div>`;
  } else {
    h += `<div class="info-box small">日程が未定です。日付を入れると工程（1日目／2日目）を組めます。 <button class="btn sm" data-act="tripEdit">日程を入れる</button></div>`;
  }
  // 工程ゾーン（日時あり）
  if (day) {
    const rows = daySchedule(trip, day);
    S._tlRows = { tripId: trip.id, day, rows };
    const w = weatherFor(trip.items.map(i => itemPoint(trip, i)).find(Boolean) || trip.origin, day);
    h += `<div class="zone-head"><span>🗓 ${fmtDateFull(day)} の工程 ${weatherHTML(w)}</span>
      <span class="row gap"><button class="btn sm" data-act="autoMove" title="移動時間を経路から自動計算">🔄 移動時間</button><button class="btn sm" data-act="sortByTime">⏱ 時刻順</button></span></div>`;
    if (rows.length) h += timelineHTML(trip, rows, day);
    else h += `<div class="muted pad small">${isShiori ? 'この日の工程はまだありません。下の「未定」から配置するか、追加してください。' : '日時を入れたアイテムはここに工程として表示されます。'}</div>`;
    h += `<div class="row gap wrap add-row">
      <button class="btn sm" data-act="addSpotToDay">＋ スポット</button>
      <button class="btn sm" data-act="addFixed">＋ 固定枠（夕食・出航など）</button>
      <button class="btn sm" data-act="addMove">＋ 移動</button></div>`;
  }
  // リストゾーン（日時なし）
  const list = unscheduledItems(trip).filter(i => !i.visited);
  const done = trip.items.filter(i => i.visited && !isScheduled(i, trip));
  const label = isShiori ? '📋 未定（未配置）' : '📝 行きたい場所';
  h += `<div class="zone-head list-head">
    <button class="link-btn" data-act="toggleListZone">${S.ui.listCollapsed ? '▶' : '▼'} ${label}（${list.length}）</button>
    <span class="row gap">
      <select data-change="listSort" class="sm">${[['distance', '距離順'], ['closing', '閉店が近い順'], ['priority', '優先度順']].map(([v, l]) => `<option value="${v}" ${S.ui.listSort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${list.length && days.length ? '<button class="btn sm" data-act="autoPlanOpen" title="定休日を避けて近い順に並べた仮のしおり案">🪄 自動で案</button>' : ''}
      <button class="btn sm primary" data-act="addSpotToList">＋</button></span></div>`;
  if (!S.ui.listCollapsed) {
    if (!list.length) h += `<div class="muted pad small">${isShiori ? '日時が決まっていない予定はここにリストで並びます。' : '行きたい場所を追加しましょう（スポット帳から選べます）'}</div>`;
    else h += `<div class="list-zone">${sortListItems(trip, list).map(it => listCardHTML(trip, it)).join('')}</div>`;
  }
  if (done.length) {
    h += `<div class="zone-head done-head"><button class="link-btn" data-act="toggleDoneZone">${S.ui.doneCollapsed ? '▶' : '▼'} ✅ 行った済み（${done.length}）</button></div>`;
    if (!S.ui.doneCollapsed) h += `<div class="done-zone">${done.map(it => doneRowHTML(trip, it)).join('')}</div>`;
  }
  if (S.spotsState === 'error') h += `<div class="warn-box small">スポット帳に接続できません（${esc(S.spotsError)}）。名前は追加時点の控えで表示しています。<button class="btn sm" data-act="reloadSpots">再接続</button></div>`;
  return h;
}
// 再接続：押したことが分かるように進行中を表示し、結果をトーストで知らせる
ACT.reloadSpots = async (el) => {
  if (el) { el.disabled = true; el.innerHTML = '<span class="spin"></span> 接続中…'; }
  await loadSpots(true);
  toast(S.spotsState === 'ok' ? 'スポット帳につながりました（' + Object.keys(S.spots).length + '件）' : 'まだつながりません：' + S.spotsError, { ms: 6000 });
};
ACT.pickDay = (el) => { S.ui.shioriDay[S.curTripId] = el.dataset.d; mapSig = ''; render(); };
ACT.toggleListZone = () => { S.ui.listCollapsed = !S.ui.listCollapsed; render(); };
ACT.toggleDoneZone = () => { S.ui.doneCollapsed = !S.ui.doneCollapsed; render(); };
ON_CHANGE.listSort = (el) => { S.ui.listSort = el.value; saveCache(); render(); };
ACT.switchMode = async (el) => {
  const t = curTrip(); const m = el.dataset.v;
  if (t.mode === m) return;
  switchMode(t, m);
  commitTrip(t);
  toast(m === 'list' ? 'リストモードにしました（時刻は保持したまま隠しています）' : 'しおりモードにしました。未配置のスポットを工程へ配置できます');
};
ACT.restoreAllTimes = () => { const t = curTrip(); t.items.forEach(i => restoreHiddenTime(t, i)); commitTrip(t); };
ACT.autoMove = () => { const t = curTrip(); autoMoveTimes(t, shioriDay(t), true); toast('移動時間を計算しています…'); };
ACT.sortByTime = () => {
  const t = curTrip(); const d = shioriDay(t);
  const rows = daySchedule(t, d);
  rows.sort((a, b) => a.start - b.start);
  reorderDay(t, d, rows.map(r => r.it.id));
  commitTrip(t);
};
ACT.addSpotToDay = () => { const t = curTrip(); openSpotPicker(t, { date: shioriDay(t) }); };
ACT.addSpotToList = () => openSpotPicker(curTrip(), null);
ACT.addFixed = () => { const t = curTrip(); openItemEditor(t, newItem({ kind: 'fixed', name: '', date: shioriDay(t), locked: true, startManual: true, start: '18:00', stay: 60, order: Date.now() }), true); };
ACT.addMove = () => { const t = curTrip(); openItemEditor(t, newItem({ kind: 'move', name: '', date: shioriDay(t), stay: 60, transport: { mode: 'ferry', from: '', to: '', number: '', platform: '' }, order: Date.now() }), true); };

// ---------------------------------------------------------------------------
// 工程表示：各スポットの左に●、●同士を線で結び、線＝時間軸として絵文字が連続移動
// ---------------------------------------------------------------------------
function timelineHTML(trip, rows, day) {
  const isToday = day === tripToday(trip);
  let h = `<div class="timeline" id="timeline" data-day="${day}">
    <div class="tl-line" id="tlLine"></div><div class="tl-fill" id="tlFill"></div>
    ${isToday ? `<div class="tl-emoji" id="tlEmoji">${esc(tripEmoji(trip))}</div>` : ''}`;
  rows.forEach((r, i) => {
    const it = r.it, info = r.info;
    const icon = it.kind === 'fixed' ? (it.bookingId ? (BOOKING_ICON[(trip.bookings.find(b => b.id === it.bookingId) || {}).type] || '📌') : '📌') : it.kind === 'move' ? (VEHICLES[(it.transport || {}).mode] || { icon: '➡️' }).icon : '📍';
    h += `<div class="tl-row ${it.visited ? 'visited' : ''} ${it.kind}" data-id="${it.id}">
      <div class="tl-time"><b>${fmtMinLabel(r.start)}</b><span>〜${fmtMinLabel(r.end)}</span></div>
      <div class="tl-dotcol"><span class="tl-dot ${it.visited ? 'done' : ''}">${i + 1}</span></div>
      <div class="tl-body" data-act="editItem" data-id="${it.id}">
        <div class="tl-name">${icon} ${esc(info.name)} ${it.locked ? '<span title="固定枠（時刻がずれない）">🔒</span>' : ''}${it.startManual && !it.locked && i > 0 ? '<span class="muted small" title="手動で時刻指定">✎</span>' : ''}${it.visited ? ' ✅' : ''}</div>
        <div class="muted small">滞在 ${fmtDuration(r.stay)}${info.price ? ' ・ ' + fmtMoney(info.price) : ''}${it.kind === 'move' && it.transport ? ' ・ ' + esc([it.transport.from, it.transport.to].filter(Boolean).join(' → ')) + (it.transport.number ? ' ' + esc(it.transport.number) : '') : ''}${info.hours.known && it.kind !== 'move' ? ' ・ 営業 ' + esc(dayHoursLabel(info.hours, day)) : ''}</div>
        ${r.warns.length ? `<div class="warns">${warnBadges(r.warns)}</div>` : ''}
        ${it.memo ? `<div class="memo small">${esc(it.memo)}</div>` : ''}
      </div>
      <div class="tl-ops">
        ${it.kind !== 'move' ? (it.visited ? `<button class="op on" data-act="visitEdit" data-id="${it.id}" title="訪問記録">✅</button>` : `<button class="op" data-act="visitNow" data-id="${it.id}" title="行った">☑️</button>`) : ''}
        <button class="op" data-act="moveUp" data-id="${it.id}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="op" data-act="moveDown" data-id="${it.id}" ${i === rows.length - 1 ? 'disabled' : ''}>↓</button>
      </div></div>`;
    if (i < rows.length - 1) {
      const mi = it.moveInfo;
      h += `<div class="tl-move" data-act="editMove" data-id="${it.id}">${(VEHICLES[(mi && mi.mode) || trip.vehicles[0]] || VEHICLES.car).icon} 移動 ${r.move ? fmtDuration(r.move) : '未設定'}${mi && mi.km ? '（' + fmtKm(mi.km) + (mi.estimated ? '・概算' : '') + (mi.toll ? '・高速約' + fmtMoney(mi.toll) : '') + '）' : ''}${it.moveAuto ? '' : ' ✎'}</div>`;
    }
  });
  h += `</div><div class="tl-status" id="tlStatus"></div>`;
  return h;
}
function positionEmoji() {
  const tl = $('#timeline');
  if (!tl || !S._tlRows) return;
  const rowsEl = $$('.tl-row', tl);
  if (!rowsEl.length) return;
  const base = tl.getBoundingClientRect().top;
  const ys = rowsEl.map(r => { const d = $('.tl-dot', r).getBoundingClientRect(); return d.top + d.height / 2 - base; });
  const yEnd = rowsEl[rowsEl.length - 1].getBoundingClientRect().bottom - base - 6;
  const line = $('#tlLine'); line.style.top = ys[0] + 'px'; line.style.height = Math.max(0, yEnd - ys[0]) + 'px';
  const em = $('#tlEmoji'), fill = $('#tlFill'), stEl = $('#tlStatus');
  if (!em) { fill.style.height = '0px'; stEl.textContent = ''; return; }
  const rows = S._tlRows.rows;
  const p = progressOnRows(rows, tripNowMin(S.trips[S._tlRows.tripId]));
  if (!p) return;
  const i = p.index;
  const y1 = ys[i], y2 = i < ys.length - 1 ? ys[i + 1] : yEnd;
  const y = y1 + (y2 - y1) * p.frac;
  em.style.top = y + 'px';
  fill.style.top = ys[0] + 'px'; fill.style.height = Math.max(0, y - ys[0]) + 'px';
  const name = rows[i].info.name;
  stEl.innerHTML = p.state === 'before' ? `出発前：最初の予定まで ${fmtDuration(p.minsTo)}`
    : p.state === 'stay' ? `いま <b>${esc(name)}</b> に滞在中（残り ${fmtDuration(p.remain)}）`
    : p.state === 'move' ? `<b>${esc(rows[i + 1] ? rows[i + 1].info.name : '')}</b> へ移動中（到着予定まで ${fmtDuration(p.remain)}）`
    : '本日の工程はすべて終了しました';
}
setInterval(() => { if (S.tab === 'shiori' && S.ui.shioriSub === 'plan') positionEmoji(); }, 20000);
window.addEventListener('resize', debounce(positionEmoji, 200));

ACT.moveUp = (el) => moveItem(el.dataset.id, -1);
ACT.moveDown = (el) => moveItem(el.dataset.id, 1);
function moveItem(id, dir) {
  const t = curTrip(); const d = shioriDay(t);
  const ids = dayItems(t, d).map(i => i.id);
  const k = ids.indexOf(id), j = k + dir;
  if (k < 0 || j < 0 || j >= ids.length) return;
  [ids[k], ids[j]] = [ids[j], ids[k]];
  reorderDay(t, d, ids);
  commitTrip(t);
  autoMoveTimes(t, d);
}
ACT.editItem = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); if (it) openItemEditor(t, it); };
ACT.editMove = (el) => {
  const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id);
  openModal(`<div class="form-grid"><label>移動時間</label><input id="mvMin" inputmode="numeric" value="${it.moveAfter != null ? it.moveAfter : ''}" placeholder="分">
    <label></label><label class="check"><input type="checkbox" id="mvAuto" ${it.moveAuto ? 'checked' : ''}> 経路から自動計算する</label></div>
    ${it.moveInfo ? `<div class="muted small">前回の計算：${fmtKm(it.moveInfo.km)}・${fmtDuration(it.moveInfo.min)}${it.moveInfo.estimated ? '（概算）' : ''}</div>` : ''}
    <button class="btn primary block mt" data-act="mvSave">保存</button>`, { title: '移動時間（' + esc(itemInfo(t, it).name) + ' → 次）', data: { t, it } });
};
ACT.mvSave = () => {
  const b = topModalBody(); const { t, it } = topModal().data;
  it.moveAuto = $('#mvAuto', b).checked;
  it.moveAfter = $('#mvMin', b).value !== '' ? num($('#mvMin', b).value) : null;
  closeModal(); commitTrip(t);
  if (it.moveAuto) autoMoveTimes(t, it.date, true);
};
ACT.visitNow = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); openQuickVisit(t, it); };
ACT.visitEdit = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); openVisitDialog(t, it); };
ACT.visitUndo = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); unmarkVisited(t, it); };

// ---------------------------------------------------------------------------
// リストゾーンのカード：期間中の営業時間／距離・所要時間／①〜⑧
// ---------------------------------------------------------------------------
function sortListItems(trip, list) {
  const o = originPoint(trip);
  const today = tripToday(trip), nm = tripNowMin(trip);
  const dist = it => { const p = itemPoint(trip, it); return p && o ? haversineKm(o, p) : 9e9; };
  const closing = it => {
    const s = openStateAt(itemInfo(trip, it).hours, today, nm);
    if (s.state === 'open') return s.closeIn;
    if (s.state === 'before') return 5000 + s.opensIn;
    return 9e9;
  };
  const pri = it => (itemInfo(trip, it).priority || it.priority) === 'must' ? 0 : 1;
  const arr = list.slice();
  if (S.ui.listSort === 'closing') arr.sort((a, b) => closing(a) - closing(b) || dist(a) - dist(b));
  else if (S.ui.listSort === 'priority') arr.sort((a, b) => pri(a) - pri(b) || dist(a) - dist(b));
  else arr.sort((a, b) => dist(a) - dist(b) || pri(a) - pri(b));
  return arr;
}
function listCardHTML(trip, it) {
  const info = itemInfo(trip, it);
  const p = info.lat != null ? { lat: info.lat, lng: info.lng } : null;
  const o = originPoint(trip);
  const tr = trip.listTransport || { mode: 'car' };
  const days = tripDays(trip);
  const today = tripToday(trip);
  const pri = it.priority || info.priority || 'maybe';
  let h = `<div class="lcard ${pri === 'must' ? 'must' : ''}" data-id="${it.id}">
    <div class="lc-head"><div class="grow lc-title" data-act="editItem" data-id="${it.id}">
      ${it.kind === 'fixed' ? '📌 ' : ''}${esc(info.name)} ${info.deleted ? '<span class="tag gray">スポット帳で削除済み</span>' : ''}${!p ? '<span class="tag gray">座標なし</span>' : ''}${it.hiddenTime ? `<span class="tag">🕘 保持中 ${fmtDate(it.hiddenTime.date)} ${esc(it.hiddenTime.start || '')}</span>` : ''}</div>
      <button class="pri ${pri}" data-act="togglePri" data-id="${it.id}">${pri === 'must' ? '⭐ 絶対行きたい' : '☆ 行けたら'}</button></div>`;
  // ② 今日行けるか＋閉店まで
  const sNow = openStateAt(info.hours, today, tripNowMin(trip));
  const todayLabel = sNow.state === 'open' ? `<span class="ok">今日 営業中・閉店まであと${fmtDuration(sNow.closeIn)}</span>`
    : sNow.state === 'before' ? `<span class="warn">今日 ${fmtMinLabel(sNow.opensAt)}開店（あと${fmtDuration(sNow.opensIn)}）</span>`
    : sNow.state === 'after' ? '<span class="ng">今日の営業は終了</span>'
    : sNow.state === 'closed' ? '<span class="ng">今日は定休日</span>' : '<span class="muted">今日の営業：情報なし</span>';
  h += `<div class="lc-line">${todayLabel}</div>`;
  // ① 行ける日バッジ＋期間中の営業時間
  if (days.length) {
    h += `<div class="lc-line day-badges">${days.map(d => { const a = dayAvailability(info.hours, d); return `<span class="dbadge ${a}">${fmtDate(d, false)} ${a === 'open' ? '○' : a === 'closed' ? '×' : '?'}</span>`; }).join('')}</div>`;
    const labels = days.map(d => dayHoursLabel(info.hours, d));
    const same = labels.every(l => l === labels[0]);
    h += `<div class="lc-line small">🕘 期間中の営業時間：${same ? esc(labels[0]) : days.map((d, i) => fmtDate(d) + ' ' + esc(labels[i])).join(' ／ ')}</div>`;
  } else if (info.hoursText) h += `<div class="lc-line small">🕘 ${esc(info.hoursText)}</div>`;
  // 距離・所要時間（乗り物はモーダル指定）
  if (p && o) {
    const r = routeFor(o, p, tr.mode, tr);
    h += `<div class="lc-line">${VEHICLES[tr.mode].icon} ${esc(o.name)}から <b>${fmtKm(r.km)}</b>・<b>${r.estimated ? '約' : ''}${fmtDuration(r.min)}</b>${tr.mode === 'car' && r.toll ? ` ・高速 約${fmtMoney(r.toll)}` : ''}${tr.mode === 'train' && r.fare ? ` ・運賃 ${r.estimated ? '約' : ''}${fmtMoney(r.fare)}` : ''}</div>`;
  }
  // ④ スポット同士の距離
  if (p) {
    const others = trip.items.filter(x => x !== it && !x.visited).map(x => ({ x, q: itemPoint(trip, x) })).filter(o2 => o2.q).map(o2 => ({ ...o2, km: haversineKm(p, o2.q) })).sort((a, b) => a.km - b.km);
    if (others.length) {
      const n = others[0];
      h += `<div class="lc-line small">↔️ 近くのスポット：${esc(itemInfo(trip, n.x).name)} ${fmtKm(n.km * 1.3)}・約${fmtDuration(estimateMinutes(n.km, tr.mode))}</div>`;
    }
  }
  // ⑤ 滞在目安・料金目安 ⑥ 駐車場／最寄り駅 ⑦ 天気
  const extra = [];
  if (info.stay) extra.push('⏳ 滞在目安 ' + fmtDuration(info.stay));
  if (info.price != null && info.price !== '') extra.push('💴 ' + (info.price ? '約' + fmtMoney(info.price) : '無料'));
  if (tr.mode === 'car') extra.push('🅿️ 駐車場 ' + (info.parking === true ? 'あり' : info.parking === false ? 'なし' : (info.parking ? esc(info.parking) : '不明')));
  if (tr.mode === 'train') extra.push('🚉 最寄り駅 ' + (info.station ? esc(info.station) : '不明'));
  const wDay = days.includes(today) ? today : (days[0] || today);
  if (p) { const w = weatherFor(p, wDay); const wh = weatherHTML(w); if (wh) extra.push((wDay === today ? '今日 ' : fmtDate(wDay) + ' ') + wh); }
  if (extra.length) h += `<div class="lc-line small extras">${extra.join('<span class="sep">・</span>')}</div>`;
  if (it.memo) h += `<div class="memo small">${esc(it.memo)}</div>`;
  // ⑧ 行ったボタン＋操作
  h += `<div class="lc-ops">
    <button class="btn sm visit" data-act="visitNow" data-id="${it.id}">✅ 行った</button>
    ${days.length ? `<button class="btn sm" data-act="placeItem" data-id="${it.id}">${trip.mode === 'shiori' ? '🗓 工程へ配置' : '🗓 日時を入れる'}</button>` : ''}
    ${p ? `<a class="btn sm" href="${mapsDirUrl({ lat: p.lat, lng: p.lng }, tr.mode)}" target="_blank" rel="noopener">🧭 ナビ</a>` : ''}
    <button class="btn sm" data-act="driveTarget" data-id="${it.id}">🚩 次に行く</button>
  </div></div>`;
  return h;
}
function doneRowHTML(trip, it) {
  const info = itemInfo(trip, it); const v = it.visited;
  return `<div class="done-row"><div class="grow"><div>✅ ${esc(info.name)}</div><div class="muted small">${fmtDate(v.date)} ${v.rating ? faceHTML(v.rating) : ''} ${esc(v.comment || '')}${it._visitPending ? ' <span class="tag warn">スポット帳へ未送信</span>' : ''}</div></div>
    <button class="btn sm" data-act="visitEdit" data-id="${it.id}">記録</button><button class="btn sm ghost" data-act="visitUndo" data-id="${it.id}">取り消す</button></div>`;
}
ACT.togglePri = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); it.priority = (it.priority === 'must' ? 'maybe' : 'must'); commitTrip(t); };
ACT.driveTarget = (el) => { const t = curTrip(); t.driveTargetId = el.dataset.id; commitTrip(t); switchTab('drive'); };
ACT.placeItem = (el) => {
  const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id);
  const days = tripDays(t);
  const def = it.hiddenTime ? it.hiddenTime.date : shioriDay(t);
  openModal(`<div class="form-grid">
    <label>日</label><select id="plDay">${days.map((d, i) => `<option value="${d}" ${d === def ? 'selected' : ''}>${i + 1}日目 ${fmtDate(d)}</option>`).join('')}</select>
    <label>開始時刻</label><input type="time" id="plStart" value="${esc(it.hiddenTime ? it.hiddenTime.start || '' : '')}"><span></span><span class="muted small">空欄なら前の予定の終了＋移動時間で自動提案</span>
    <label>滞在</label><input id="plStay" inputmode="numeric" value="${it.stay || 60}"><span></span><span class="muted small">分</span>
  </div>${it.hiddenTime ? `<button class="btn block mt" data-act="plRestore">🕘 保持していた時刻（${fmtDate(it.hiddenTime.date)} ${esc(it.hiddenTime.start || '自動')}）に戻す</button>` : ''}
  <button class="btn primary block mt" data-act="plSave">配置する</button>`, { title: '🗓 ' + esc(itemInfo(t, it).name) + ' を工程へ', data: { t, it } });
};
ACT.plRestore = () => { const { t, it } = topModal().data; restoreHiddenTime(t, it); closeModal(); commitTrip(t); };
ACT.plSave = () => {
  const b = topModalBody(); const { t, it } = topModal().data;
  it.hiddenTime = null;
  it.date = $('#plDay', b).value;
  const st = $('#plStart', b).value;
  it.stay = num($('#plStay', b).value, 60);
  const last = dayItems(t, it.date).filter(x => x !== it).slice(-1)[0];
  it.order = last ? last.order + 1000 : 1000;
  if (st) { it.start = st; it.startManual = true; placeByTime(t, it); } else { it.start = null; it.startManual = false; }
  S.ui.shioriDay[t.id] = it.date;
  closeModal(); commitTrip(t); autoMoveTimes(t, it.date);
};

// ---------------------------------------------------------------------------
// アイテム編集（スポット／固定枠／移動）
// ---------------------------------------------------------------------------
function openItemEditor(trip, it, isNew) {
  const info = itemInfo(trip, it);
  const days = tripDays(trip);
  const sched = isScheduled(it, trip);
  const tp = it.transport || {};
  const booking = it.bookingId ? trip.bookings.find(b => b.id === it.bookingId) : null;
  openModal(`<div class="form-grid">
    <label>種類</label>${segHTML('ieKind', [{ v: 'spot', l: '📍 スポット' }, { v: 'fixed', l: '📌 固定枠' }, { v: 'move', l: '➡️ 移動' }], it.kind, 'segPick')}
    ${it.spotId ? `<label>スポット帳</label><div><b>${esc(info.name)}</b> ${info.deleted ? '<span class="tag gray">削除済み</span>' : ''}<div class="muted small">${esc(info.address || '')} ${info.hoursText ? '／' + esc(info.hoursText) : ''}</div>
      <div class="row gap"><a class="link-btn" href="${mapsSearchUrl(info)}" target="_blank" rel="noopener">地図で見る</a><button class="link-btn" data-act="ieUnlink">参照を外して手入力にする</button></div></div>`
      : `<label>名前</label><input id="ieName" value="${esc(it.name)}" placeholder="例：夕食（〇〇亭）">
      <label>住所</label><input id="ieAddr" value="${esc(it.address)}">
      <label>座標</label><div class="row gap"><input id="ieLat" value="${it.lat != null ? it.lat : ''}" placeholder="緯度" inputmode="decimal"><input id="ieLng" value="${it.lng != null ? it.lng : ''}" placeholder="経度" inputmode="decimal"><button class="btn sm" data-act="ieGeocode">検索</button></div>
      <label>営業時間</label><input id="ieHours" value="${esc(it.hoursText)}" placeholder="例：11:00-14:00 月曜定休">
      <label></label><label class="check"><input type="checkbox" id="ieReg"> スポット帳にも登録する</label>`}
    <label>日</label><select id="ieDate"><option value="">未定（リストへ）</option>${days.map((d, i) => `<option value="${d}" ${sched && it.date === d ? 'selected' : ''}>${i + 1}日目 ${fmtDate(d)}</option>`).join('')}</select>
    <label>開始時刻</label><div class="row gap"><input type="time" id="ieStart" value="${esc(it.start || '')}"><label class="check"><input type="checkbox" id="ieManual" ${it.startManual ? 'checked' : ''}> 手動で指定</label></div>
    <label></label><label class="check"><input type="checkbox" id="ieLock" ${it.locked ? 'checked' : ''}> 🔒 固定枠としてロック（前が延びても時刻がずれない）</label>
    <label>滞在時間</label><div class="row gap"><input id="ieStay" inputmode="numeric" value="${it.stay != null ? it.stay : ''}"><span class="muted">分</span></div>
    <label>次への移動</label><div class="row gap"><input id="ieMove" inputmode="numeric" value="${it.moveAfter != null ? it.moveAfter : ''}" placeholder="自動"><span class="muted">分</span><label class="check"><input type="checkbox" id="ieMoveAuto" ${it.moveAuto ? 'checked' : ''}> 自動計算</label></div>
    <div class="span2 move-fields" ${it.kind === 'move' ? '' : 'style="display:none"'}><div class="form-grid">
      <label>交通手段</label><select id="ieTpMode">${VEHICLE_KEYS.map(k => `<option value="${k}" ${tp.mode === k ? 'selected' : ''}>${VEHICLES[k].icon} ${VEHICLES[k].label}</option>`).join('')}</select>
      <label>出発（駅・空港・港）</label><input id="ieTpFrom" value="${esc(tp.from || '')}">
      <label>到着</label><input id="ieTpTo" value="${esc(tp.to || '')}">
      <label>便名・列車名</label><input id="ieTpNo" value="${esc(tp.number || '')}">
      <label>のりば・ゲート</label><input id="ieTpPf" value="${esc(tp.platform || '')}">
    </div></div>
    <label>優先度</label><select id="iePri"><option value="maybe">行けたら</option><option value="must" ${it.priority === 'must' ? 'selected' : ''}>絶対行きたい</option></select>
    <label>滞在目安</label><input id="ieStayEst" inputmode="numeric" value="${it.stayEst != null ? it.stayEst : ''}" placeholder="${info.spot && info.spot.stayMin ? 'スポット帳：' + info.spot.stayMin + '分' : '分'}">
    <label>料金目安</label><input id="iePriceEst" inputmode="numeric" value="${it.priceEst != null ? it.priceEst : ''}" placeholder="${info.spot && info.spot.price != null ? 'スポット帳：' + info.spot.price + '円' : '円'}">
    <label>予約</label><div><label class="check"><input type="checkbox" id="ieNeedBook" ${it.needsBooking ? 'checked' : ''}> 要予約</label>
      ${booking ? `<div class="small">🎫 ${esc(booking.title)}（${booking.status}）<button class="link-btn" data-act="ieOpenBooking">予約を開く</button></div>` : `<button class="link-btn" data-act="ieMakeBooking">＋ この予定の予約を作る</button>`}</div>
    <label>駐車場メモ</label><input id="iePark" value="${esc(it.parkingMemo)}" placeholder="例：第2駐車場が空いている">
    <label>メモ</label><textarea id="ieMemo" rows="2">${esc(it.memo)}</textarea>
  </div>
  <div class="row gap mt"><button class="btn primary grow" data-act="ieSave">保存</button>${!isNew ? '<button class="btn danger" data-act="ieDelete">削除</button>' : ''}</div>`,
    { title: isNew ? '＋ 追加' : '✏️ ' + esc(info.name), full: true, data: { trip, it, isNew } });
  const body = topModalBody();
  $$('[data-name="ieKind"]', body).forEach(b => b.addEventListener('click', () => { $('.move-fields', body).style.display = b.dataset.v === 'move' ? '' : 'none'; }));
}
ACT.ieUnlink = () => {
  const { trip, it } = topModal().data;
  const info = itemInfo(trip, it);
  Object.assign(it, { name: info.name, address: info.address || '', lat: info.lat, lng: info.lng, hoursText: info.hoursText || '', spotId: null });
  closeModal(); openItemEditor(trip, it);
};
ACT.ieGeocode = async () => {
  const b = topModalBody(); const q = $('#ieAddr', b).value || $('#ieName', b).value;
  try { const r = await api('geocode', { address: q }); if (r.result) { $('#ieLat', b).value = r.result.lat; $('#ieLng', b).value = r.result.lng; toast('座標を取得しました'); } else toast(r.note || '見つかりませんでした'); }
  catch (e) { toast('座標検索に失敗：' + e.message); }
};
async function readItemEditor() {
  const b = topModalBody(); const { trip, it, isNew } = topModal().data;
  const g = id => $(id, b) ? $(id, b).value : undefined;
  it.kind = segValue(b, 'ieKind') || it.kind;
  if (!it.spotId) {
    it.name = g('#ieName').trim(); it.nameCache = it.name; it.address = g('#ieAddr').trim();
    it.lat = g('#ieLat') !== '' ? num(g('#ieLat'), null) : null; it.lng = g('#ieLng') !== '' ? num(g('#ieLng'), null) : null;
    it.hoursText = g('#ieHours').trim();
    if (!it.name) { toast('名前を入れてください'); return null; }
  }
  const date = g('#ieDate') || null;
  // 未定を選んでも、モード切替で保持している時刻（hiddenTime）は消さない
  if (date) { it.date = date; it.hiddenTime = null; } else if (!it.hiddenTime) { it.date = null; }
  it.start = g('#ieStart') || null;
  it.locked = $('#ieLock', b).checked;
  it.startManual = $('#ieManual', b).checked || it.locked;
  if (it.startManual && !it.start) { toast('開始時刻を入れてください'); return null; }
  it.stay = g('#ieStay') !== '' ? num(g('#ieStay'), 60) : 60;
  it.moveAuto = $('#ieMoveAuto', b).checked;
  it.moveAfter = g('#ieMove') !== '' ? num(g('#ieMove'), null) : (it.moveAuto ? it.moveAfter : null);
  it.priority = g('#iePri');
  it.stayEst = g('#ieStayEst') !== '' ? num(g('#ieStayEst'), null) : null;
  it.priceEst = g('#iePriceEst') !== '' ? num(g('#iePriceEst'), null) : null;
  it.needsBooking = $('#ieNeedBook', b).checked;
  it.parkingMemo = g('#iePark');
  it.memo = g('#ieMemo');
  if (it.kind === 'move') it.transport = { mode: g('#ieTpMode'), from: g('#ieTpFrom'), to: g('#ieTpTo'), number: g('#ieTpNo'), platform: g('#ieTpPf') };
  if (!it.spotId && $('#ieReg', b) && $('#ieReg', b).checked) {
    try {
      const r = await api('spotCreate', { spot: { name: it.name, address: it.address, lat: it.lat, lng: it.lng, hours: it.hoursText, stayMin: it.stayEst, price: it.priceEst, priority: it.priority, status: 'want', area: trip.area || '' } });
      const sp = normalizeSpot(r.spot); S.spots[sp.id] = sp; it.spotId = sp.id; toast('スポット帳にも登録しました');
    } catch (e) { toast('スポット帳への登録に失敗：' + e.message); }
  }
  if (isNew && !trip.items.includes(it)) {
    const last = it.date ? dayItems(trip, it.date).slice(-1)[0] : null;
    it.order = last ? last.order + 1000 : 1000;
    trip.items.push(it);
  }
  if (it.date && it.startManual && it.start) placeByTime(trip, it);
  return { trip, it };
}
ACT.ieSave = async () => {
  const r = await readItemEditor(); if (!r) return;
  closeModal(); commitTrip(r.trip);
  if (r.it.date) autoMoveTimes(r.trip, r.it.date);
};
ACT.ieDelete = async () => {
  const { trip, it } = topModal().data;
  if (!(await confirmDialog('削除しますか？'))) return;
  trip.items = trip.items.filter(x => x !== it);
  closeModal(); commitTrip(trip);
};
ACT.ieMakeBooking = async () => {
  const r = await readItemEditor(); if (!r) return;
  const { trip, it } = r;
  closeModal();
  const info = itemInfo(trip, it);
  const b = newBooking(trip, { title: info.name, spotId: it.spotId, place: info.name, date: it.date, time: it.start || '', itemId: it.id, type: it.kind === 'move' ? '交通' : (/食|ランチ|夕食|ディナー/.test(info.name) ? '食事' : 'アクティビティ') });
  it.needsBooking = true;
  openBookingEditor(trip, b, true);
};
ACT.ieOpenBooking = () => { const { trip, it } = topModal().data; closeModal(); openBookingEditor(trip, trip.bookings.find(b => b.id === it.bookingId)); };

// 乗り物の設定（地図付近の設定ボタン→モーダル）
ACT.transportModal = () => {
  const t = curTrip(); const tr = t.listTransport;
  openModal(`${segHTML('tpm', VEHICLE_KEYS.map(k => ({ v: k, l: VEHICLES[k].icon + ' ' + VEHICLES[k].label })), tr.mode, 'segPick')}
    <div class="tp-opt car" style="margin-top:12px">
      <label class="check"><input type="checkbox" id="tpHw" ${tr.highway !== false ? 'checked' : ''}> 高速道路を使う</label>
      <label class="check"><input type="checkbox" id="tpToll" ${tr.toll !== false ? 'checked' : ''}> 有料道路を使う</label>
      <div class="muted small">高速料金は普通車の概算（距離×24.6円＋150円）です。ETC割引などは含みません</div></div>
    <div class="muted small mt">電車：経路検索の運賃（取れない時は概算）／飛行機・フェリー：直線距離からの概算で所要時間を出します</div>
    <button class="btn primary block mt" data-act="tpSave">決定</button>`, { title: '🚦 距離・所要時間の乗り物' });
};
ACT.tpSave = () => {
  const b = topModalBody(); const t = curTrip();
  t.listTransport = { mode: segValue(b, 'tpm') || 'car', highway: $('#tpHw', b).checked, toll: $('#tpToll', b).checked };
  closeModal(); commitTrip(t);
};

// ---------------------------------------------------------------------------
// 地図（スポット帳「地図」タブの配置を踏襲：上に地図、下に工程表）
// ---------------------------------------------------------------------------
let MAP = null, mapLayer = null, mapSig = '';
function ensureMap() {
  if (typeof L === 'undefined') { const el = $('#leafletMap'); if (el && !el.dataset.msg) { el.innerHTML = '<div class="map-fallback">地図を読み込めません（オフライン？）</div>'; el.dataset.msg = 1; } return null; }
  if (!MAP) {
    MAP = L.map('leafletMap', { zoomControl: false, attributionControl: true }).setView([34.86, 136.45], 9);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(MAP);
    mapLayer = L.layerGroup().addTo(MAP);
  }
  return MAP;
}
function updateMap(trip) {
  const ov = $('#mapOverlay');
  if (ov) ov.innerHTML = `<button class="map-btn" data-act="transportModal">${VEHICLES[trip.listTransport.mode].icon} 乗り物設定</button>
    <button class="map-btn" data-act="mapFit">⤢</button>`;
  const map = ensureMap(); if (!map) return;
  setTimeout(() => map.invalidateSize(), 50);
  mapLayer.clearLayers();
  const day = shioriDay(trip);
  const pts = [];
  if (day) {
    const rows = daySchedule(trip, day);
    const line = [];
    rows.forEach((r, i) => {
      const p = itemPoint(trip, r.it); if (!p) return;
      line.push([p.lat, p.lng]); pts.push([p.lat, p.lng]);
      L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'mk', html: `<span class="mk-num ${r.it.visited ? 'done' : ''}">${i + 1}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] }) })
        .bindPopup(`<b>${esc(r.info.name)}</b><br>${fromMin(r.start)}〜${fromMin(r.end)}`).addTo(mapLayer);
    });
    if (line.length > 1) L.polyline(line, { color: '#6366f1', weight: 4, opacity: 0.75 }).addTo(mapLayer);
  }
  unscheduledItems(trip).forEach(it => {
    const p = itemPoint(trip, it); if (!p) return;
    pts.push([p.lat, p.lng]);
    const must = it.priority === 'must';
    L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'mk', html: `<span class="mk-pin ${it.visited ? 'done' : must ? 'must' : ''}">${it.visited ? '✓' : must ? '★' : '•'}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }) })
      .bindPopup(`<b>${esc(itemInfo(trip, it).name)}</b>`).addTo(mapLayer);
  });
  if (S.geo) L.circleMarker([S.geo.lat, S.geo.lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }).addTo(mapLayer);
  const sig = trip.id + day + JSON.stringify(pts);
  if (sig !== mapSig) {
    mapSig = sig;
    if (pts.length === 1) map.setView(pts[0], 13);
    else if (pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
    else if (trip.origin && trip.origin.lat != null) map.setView([trip.origin.lat, trip.origin.lng], 10);
  }
}
ACT.mapFit = () => { mapSig = ''; updateMap(curTrip()); };

// ---------------------------------------------------------------------------
// 予約
// ---------------------------------------------------------------------------
function newBooking(trip, o) {
  return Object.assign({ id: uid('bk'), type: 'その他', title: '', date: trip.startDate || '', time: '', durationMin: 60, place: '', placeTo: '', spotId: null, number: '', transportMode: '', money: newMoney(trip, { payState: '支払済' }), bookingNo: '', url: '', memo: '', status: '要予約', calendarEventId: null, itemId: null }, o || {});
}
function renderBookings(trip) {
  const groups = { '要予約': [], '予約済': [], 'キャンセル': [] };
  trip.bookings.forEach(b => (groups[b.status] || groups['要予約']).push(b));
  const itemsNeed = trip.items.filter(it => it.needsBooking && !(it.bookingId && trip.bookings.some(b => b.id === it.bookingId)));
  let h = `<div class="row between mt"><div class="section-title">🎫 予約</div><button class="btn primary sm" data-act="bookingNew">＋ 予約を追加</button></div>`;
  if (itemsNeed.length) h += `<div class="alert warn">⚠️ しおりで「要予約」にしたのに予約が無いもの：${itemsNeed.map(it => `<button class="chip-btn" data-act="bookingFromItem" data-id="${it.id}">${esc(itemInfo(trip, it).name)} ＋</button>`).join('')}</div>`;
  ['要予約', '予約済', 'キャンセル'].forEach(st => {
    if (!groups[st].length) return;
    h += `<div class="group-label">${st}（${groups[st].length}）</div>`;
    h += groups[st].sort((a, b) => ((a.date || '') + (a.time || '')) < ((b.date || '') + (b.time || '')) ? -1 : 1).map(b => `<div class="card bk ${st === 'キャンセル' ? 'muted-card' : ''}" data-act="bookingEdit" data-id="${b.id}">
      <div class="row between"><div class="b">${BOOKING_ICON[b.type] || ''} ${esc(b.title || '（無題）')}</div><span class="badge bk-${b.status}">${b.status}</span></div>
      <div class="muted small">${b.date ? fmtDate(b.date) : '日付未定'} ${esc(b.time || '')}${b.place ? ' ・ ' + esc(b.place) : ''}${b.bookingNo ? ' ・ 予約番号 ' + esc(b.bookingNo) : ''}</div>
      <div class="row between small"><span>${b.money && b.money.amount != null && b.money.amount !== '' ? '💴 ' + fmtMoney(num(b.money.amount), b.money.currency) + '（お金タブへ自動計上）' : ''}</span>
      <span>${b.calendarEventId ? '📅 カレンダー登録済' : ''}</span></div></div>`).join('');
  });
  if (!trip.bookings.length && !itemsNeed.length) h += emptyHTML('🎫', '予約はまだありません。宿・交通・食事などを登録すると、時刻のあるものはしおりの固定枠に入り、金額はお金タブへ流れます。');
  return h;
}
ACT.bookingNew = () => { const t = curTrip(); openBookingEditor(t, newBooking(t), true); };
ACT.bookingEdit = (el) => { const t = curTrip(); openBookingEditor(t, t.bookings.find(b => b.id === el.dataset.id)); };
ACT.bookingFromItem = (el) => {
  const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); const info = itemInfo(t, it);
  openBookingEditor(t, newBooking(t, { title: info.name, place: info.name, spotId: it.spotId, date: it.date || t.startDate || '', time: it.start || '', itemId: it.id, type: it.kind === 'move' ? '交通' : 'アクティビティ' }), true);
};
function openBookingEditor(trip, b, isNew) {
  const days = tripDays(trip);
  const spotOpts = trip.items.filter(i => i.spotId).map(i => ({ id: i.spotId, name: itemInfo(trip, i).name }));
  openModal(`<div class="form-grid">
    <label>状態</label>${segHTML('bkSt', BOOKING_STATUS, b.status, 'segPick')}
    <label>種別</label><select id="bkType">${BOOKING_TYPES.map(x => `<option ${x === b.type ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label>タイトル</label><input id="bkTitle" value="${esc(b.title)}" placeholder="例：〇〇旅館 1泊2食">
    <label>日時</label><div class="row gap"><input type="date" id="bkDate" value="${esc(b.date || '')}" ${days.length ? `min="${days[0]}" max="${days[days.length - 1]}"` : ''}><input type="time" id="bkTime" value="${esc(b.time || '')}"></div>
    <label></label><span class="muted small">時刻を入れると、しおりに🔒固定枠として自動で入ります</span>
    <label>所要（分）</label><input id="bkDur" inputmode="numeric" value="${esc(b.durationMin || 60)}">
    <label>場所</label><div><input id="bkPlace" value="${esc(b.place)}" placeholder="場所">
      ${spotOpts.length ? `<select id="bkSpot"><option value="">スポット参照なし</option>${spotOpts.map(o => `<option value="${o.id}" ${o.id === b.spotId ? 'selected' : ''}>📍 ${esc(o.name)}</option>`).join('')}</select>` : ''}</div>
    <label>到着地（交通）</label><input id="bkPlaceTo" value="${esc(b.placeTo || '')}" placeholder="交通の時だけ">
    <label>便名・列車名</label><input id="bkNo" value="${esc(b.number || '')}">
    <label>金額</label><div>${moneyEditorHTML(trip, b.money)}</div>
    <label>予約番号</label><input id="bkBookNo" value="${esc(b.bookingNo)}">
    <label>URL</label><input id="bkUrl" value="${esc(b.url)}" inputmode="url">
    <label>メモ</label><textarea id="bkMemo" rows="2">${esc(b.memo)}</textarea>
  </div>
  <div class="row gap mt wrap">
    <button class="btn primary grow" data-act="bkSave">保存</button>
    <button class="btn" data-act="bkCalendar">${b.calendarEventId ? '📅 登録済み' : '📅 カレンダーに登録'}</button>
    ${b.url ? `<a class="btn" href="${esc(b.url)}" target="_blank" rel="noopener">🔗 開く</a>` : ''}
    ${!isNew ? '<button class="btn danger" data-act="bkDelete">削除</button>' : ''}</div>
  <div class="muted small mt">カレンダー登録はタイトル＋日時だけ。二重登録を防ぐため自動ではなくボタン式です。</div>`,
    { title: isNew ? '＋ 予約' : '🎫 予約の編集', full: true, data: { trip, b, isNew }, onMount: (body) => updateMoneyPreview($('.money-ed', body)) });
}
function readBookingEditor() {
  const body = topModalBody(); const { trip, b, isNew } = topModal().data;
  b.status = segValue(body, 'bkSt') || b.status;
  b.type = $('#bkType', body).value;
  b.title = $('#bkTitle', body).value.trim();
  b.date = $('#bkDate', body).value; b.time = $('#bkTime', body).value;
  b.durationMin = num($('#bkDur', body).value, 60);
  b.place = $('#bkPlace', body).value.trim();
  b.spotId = $('#bkSpot', body) ? ($('#bkSpot', body).value || null) : b.spotId;
  b.placeTo = $('#bkPlaceTo', body).value.trim();
  b.number = $('#bkNo', body).value.trim();
  b.money = readMoneyEditor(body);
  b.bookingNo = $('#bkBookNo', body).value.trim();
  b.url = $('#bkUrl', body).value.trim();
  b.memo = $('#bkMemo', body).value;
  if (!b.title) { toast('タイトルを入れてください'); return null; }
  if (isNew && !trip.bookings.includes(b)) trip.bookings.push(b);
  if (b.itemId) { const it = trip.items.find(i => i.id === b.itemId); if (it) { it.bookingId = b.id; it.needsBooking = true; } }
  syncBookingItems(trip);
  return { trip, b };
}
ACT.bkSave = () => { const r = readBookingEditor(); if (!r) return; closeModal(); commitTrip(r.trip); };
ACT.bkDelete = async () => {
  const { trip, b } = topModal().data;
  if (!(await confirmDialog('この予約を削除しますか？（お金タブの事前支払いからも消えます）'))) return;
  trip.bookings = trip.bookings.filter(x => x !== b);
  syncBookingItems(trip);
  closeModal(); commitTrip(trip);
};
ACT.bkCalendar = async (el) => {
  const r = readBookingEditor(); if (!r) return;
  const { trip, b } = r;
  if (!b.date) return toast('日付を入れてください');
  if (b.calendarEventId && !(await confirmDialog('すでにカレンダーに登録済みです。もう一度登録すると二重になります。登録しますか？'))) return;
  try {
    const end = b.time ? fromMin(toMin(b.time) + num(b.durationMin, 60)) : '';
    const res = await api('calendarAdd', { title: b.title, date: b.date, start: b.time, end, durationMin: num(b.durationMin, 60), location: b.place, timeZone: tripTz(trip) });
    b.calendarEventId = res.eventId;
    commitTrip(trip, { noRender: true });
    el.textContent = '📅 登録済み';
    toast('Googleカレンダーに登録しました');
  } catch (e) { toast('カレンダー登録に失敗：' + e.message); }
};

// ---------------------------------------------------------------------------
// 持ち物
// ---------------------------------------------------------------------------
const PACK_TEMPLATE = [
  ['衣類', '着替え（日数分）', 'stay'], ['衣類', '下着・靴下', 'stay'], ['衣類', 'パジャマ・部屋着', 'stay'], ['衣類', '上着・防寒具', 'all'], ['衣類', '予備の靴下', 'multi'], ['衣類', '洗濯物用の袋', 'multi'],
  ['洗面', '歯ブラシ・歯磨き粉', 'stay'], ['洗面', 'スキンケア・化粧品', 'stay'], ['洗面', 'シャンプー類（必要なら）', 'multi'], ['洗面', 'コンタクト・メガネ', 'stay'], ['洗面', '常備薬', 'all'], ['洗面', 'ハンカチ・ティッシュ', 'all'],
  ['ガジェット', 'スマホ充電器・ケーブル', 'all'], ['ガジェット', 'モバイルバッテリー', 'all'], ['ガジェット', 'カメラ・予備バッテリー', 'all'], ['ガジェット', 'イヤホン', 'all'], ['ガジェット', '延長コード', 'multi'], ['ガジェット', '変換プラグ', 'plane'],
  ['書類・貴重品', '財布・現金', 'all'], ['書類・貴重品', '保険証', 'all'], ['書類・貴重品', '運転免許証', 'car'], ['書類・貴重品', '予約確認（宿・チケット）', 'stay'], ['書類・貴重品', '搭乗券・パスポート', 'plane'], ['書類・貴重品', '乗車券・ICカード', 'train'],
  ['車載', 'ETCカード', 'car'], ['車載', '車検証・自賠責（車内確認）', 'car'], ['車載', 'スマホホルダー・車載充電器', 'car'], ['車載', 'サングラス', 'car'], ['車載', 'ゴミ袋・ウェットティッシュ', 'car'], ['車載', '飲み物・おやつ', 'car'],
  ['その他', 'エコバッグ', 'all'], ['その他', '折りたたみ傘', 'all'], ['その他', '酔い止め', 'ferry'], ['その他', 'マスク', 'all']
];
function packTemplateKind(trip) { const n = nights(trip); return n === 0 ? 'day' : n === 1 ? 'one' : 'multi'; }
function generatePacking(trip, kind, car) {
  kind = kind || packTemplateKind(trip);
  car = car == null ? hasVehicle(trip, 'car') : car;
  const ok = (w) => w === 'all' || (w === 'stay' && kind !== 'day') || (w === 'multi' && kind === 'multi') || (w === 'car' && car) || (['plane', 'train', 'ferry'].includes(w) && hasVehicle(trip, w));
  const tmpl = PACK_TEMPLATE.map(([cat, name, when]) => ({ cat, name, when })).concat(S.settings.packCustom || []);
  let added = 0;
  tmpl.forEach(x => {
    if (!ok(x.when || 'all')) return;
    if (trip.packing.some(p => p.name === x.name)) return;
    trip.packing.push({ id: uid('pk'), cat: x.cat, name: x.name, done: false, owner: '' });
    added++;
  });
  return added;
}
function renderPacking(trip) {
  const total = trip.packing.length, done = trip.packing.filter(p => p.done).length;
  const pct = total ? Math.round(done / total * 100) : 0;
  let h = `<div class="card"><div class="row between"><b>🎒 持ち物 ${done}/${total}</b><b>${pct}%</b></div><div class="progress"><div style="width:${pct}%"></div></div>
    <div class="row gap wrap mt"><select id="pkKind">${[['day', '日帰り'], ['one', '1泊'], ['multi', '2泊以上']].map(([v, l]) => `<option value="${v}" ${packTemplateKind(trip) === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="check"><input type="checkbox" id="pkCar" ${hasVehicle(trip, 'car') ? 'checked' : ''}> 車旅</label>
    <button class="btn sm" data-act="packGen">テンプレートから追加</button>
    <button class="btn sm ghost" data-act="packReset">チェックを全部外す</button></div></div>`;
  PACK_CATS.forEach(cat => {
    const items = trip.packing.filter(p => p.cat === cat);
    h += `<div class="pack-cat"><div class="row between"><b>${PACK_ICON[cat]} ${cat}</b><span class="muted small">${items.filter(i => i.done).length}/${items.length}</span></div>
      ${items.map(p => `<div class="pack-row ${p.done ? 'done' : ''}">
        <label class="check grow"><input type="checkbox" data-change="packToggle" data-id="${p.id}" ${p.done ? 'checked' : ''}> ${esc(p.name)}</label>
        <select class="owner" data-change="packOwner" data-id="${p.id}"><option value="">誰の？</option>${trip.members.map(m => `<option value="${m.id}" ${p.owner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="all" ${p.owner === 'all' ? 'selected' : ''}>共用</option></select>
        <button class="op" data-act="packDel" data-id="${p.id}">✕</button></div>`).join('')}
      <div class="row gap"><input class="grow pack-new" data-cat="${cat}" data-input="packDraft" value="${esc(packDraftGet(trip, cat))}" placeholder="＋ 追加"><button class="btn sm" data-act="packAdd" data-cat="${cat}">追加</button></div></div>`;
  });
  return h;
}
// v2.0.4：持ち物の追加欄の下書き。描き直しで入力途中の文字が消えないよう、旅ID＋カテゴリーごとに覚える（端末の保存はしない）
function packDraftKey(trip, cat) { return (trip ? trip.id : '') + '|' + cat; }
function packDraftGet(trip, cat) { return ((S.ui.packDraft || {})[packDraftKey(trip, cat)]) || ''; }
ON_INPUT.packDraft = (el) => { S.ui.packDraft = S.ui.packDraft || {}; S.ui.packDraft[packDraftKey(curTrip(), el.dataset.cat)] = el.value; };
ACT.packGen = () => { const t = curTrip(); const n = generatePacking(t, $('#pkKind').value, $('#pkCar').checked); commitTrip(t); toast(n + '件追加しました'); };
ACT.packReset = async () => { const t = curTrip(); if (await confirmDialog('チェックを全部外しますか？')) { t.packing.forEach(p => p.done = false); commitTrip(t); } };
ON_CHANGE.packToggle = (el) => { const t = curTrip(); const p = t.packing.find(x => x.id === el.dataset.id); p.done = el.checked; commitTrip(t); };
ON_CHANGE.packOwner = (el) => { const t = curTrip(); const p = t.packing.find(x => x.id === el.dataset.id); p.owner = el.value; commitTrip(t); };
ACT.packDel = (el) => { const t = curTrip(); t.packing = t.packing.filter(x => x.id !== el.dataset.id); commitTrip(t); };
ACT.packAdd = (el) => {
  const t = curTrip(); const inp = $(`.pack-new[data-cat="${el.dataset.cat}"]`);
  const name = inp.value.trim(); if (!name) return;
  t.packing.push({ id: uid('pk'), cat: el.dataset.cat, name, done: false, owner: '' });
  if (S.ui.packDraft) delete S.ui.packDraft[packDraftKey(t, el.dataset.cat)];
  commitTrip(t);
};
