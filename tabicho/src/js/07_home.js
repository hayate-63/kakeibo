// ============================================================================
// 07 ホーム：旅一覧・現在の旅・警告・完了・旅の作成／編集
// ============================================================================
function renderHome() {
  const trips = Object.values(S.trips).filter(t => !t._deleted);
  const trip = curTrip();
  let h = unsentBarHTML() + `<div class="home-actions">
    <button class="btn primary grow" data-act="tripNew">＋ 新しい旅</button>
    <button class="btn accent grow" data-act="openSuggest">🧭 行き先を探す</button></div>
    <button class="btn block collection-btn" data-act="openCollection">🗂 コレクション（統計・マップ・年別レポート）</button>`;
  if (S.serverMock) h += `<div class="info-box small">🧪 デモモード：GASに置く前のローカル動作です。データはこのブラウザにだけ保存されます。</div>`;
  if (trip) h += currentTripCard(trip);
  else h += emptyHTML('🧳', 'まだ旅がありません。<br>「新しい旅」か「行き先を探す」から始めましょう');

  const groups = {};
  trips.forEach(t => { const st = tripStatus(t); (groups[st] = groups[st] || []).push(t); });
  const order = ['旅行中', '確定', '計画中', '精算・記録中', '検討中'];
  h += `<div class="section-title">旅の一覧</div>`;
  order.forEach(st => {
    if (!groups[st]) return;
    h += `<div class="group-label">${statusBadge(st)} <span class="muted small">${groups[st].length}件</span></div>`;
    h += groups[st].sort(tripSort).map(tripRow).join('');
  });
  const arch = (groups['完了'] || []).concat(groups['中止'] || []);
  if (arch.length) {
    h += `<button class="link-btn mt" data-act="homeArchive">${S.ui.homeShowArchive ? '▲' : '▼'} 完了・中止の旅（${arch.length}）</button>`;
    if (S.ui.homeShowArchive) h += arch.sort(tripSort).reverse().map(tripRow).join('');
  }
  return h;
}
function tripSort(a, b) { return (a.startDate || '9999') < (b.startDate || '9999') ? -1 : (a.startDate || '9999') > (b.startDate || '9999') ? 1 : 0; }
// 旅行一覧の代表写真（無ければ絵文字）
function tripThumbHTML(t) {
  const c = coverOrFirst(t);
  if (c) return `<span class="tthumb">${mediaTileInner(c, 200)}</span>`;
  if (isImageUrl(t.coverLink)) return `<span class="tthumb"><img src="${esc(t.coverLink)}" alt=""></span>`;
  return esc(tripEmoji(t));
}
function tripRow(t) {
  const st = tripStatus(t);
  return `<div class="trip-row ${t.id === S.curTripId ? 'cur' : ''}" data-act="tripSelect" data-id="${t.id}">
    <div class="trip-emoji">${tripThumbHTML(t)}</div>
    <div class="grow"><div class="b">${esc(t.title)}</div>
    <div class="muted small">${t.startDate ? fmtDate(t.startDate) + (t.endDate && t.endDate !== t.startDate ? '〜' + fmtDate(t.endDate) : '（日帰り）') : '日程未定'} ・ ${t.members.map(m => esc(m.name)).join('・')}</div></div>
    ${statusBadge(st)}</div>`;
}
ACT.homeArchive = () => { S.ui.homeShowArchive = !S.ui.homeShowArchive; render(); };
ACT.tripSelect = (el) => { S.curTripId = el.dataset.id; saveCache(); render(); };

function currentTripCard(trip) {
  const st = tripStatus(trip);
  const today = todayStr();
  const days = tripDays(trip);
  let when = '日程未定';
  if (trip.startDate) {
    const d = diffDays(today, trip.startDate);
    if (st === '旅行中') when = `旅行中 ${days.indexOf(today) + 1}日目／${days.length}日`;
    else if (d > 0) when = `出発まで あと${d}日`;
    else when = fmtDate(trip.startDate) + (isDayTrip(trip) ? '（日帰り）' : '〜' + fmtDate(trip.endDate));
  }
  const pend = pendingBookingCount(trip);
  const pk = trip.packing.length ? Math.round(trip.packing.filter(p => p.done).length / trip.packing.length * 100) : null;
  const bs = budgetSummary(trip);
  const canComplete = (st === '精算・記録中' || st === '旅行中') && settlementComplete(trip) && trip.record.done;
  let warnings = '';
  if (pend) warnings += `<div class="alert warn" data-act="goBookings">⚠️ 未予約が <b>${pend}件</b> あります（しおりで「要予約」にしたもの）</div>`;
  const conflicts = trip.startDate ? days.reduce((n, d) => n + daySchedule(trip, d).filter(r => r.warns.some(w => w.lv === 'err')).length, 0) : 0;
  if (conflicts) warnings += `<div class="alert err" data-act="goTab" data-tab="shiori">⛔ 工程に問題が ${conflicts}件（間に合わない・定休日など）</div>`;
  if (trip.settlement.notice) warnings += `<div class="alert info" data-act="goTab" data-tab="money">ℹ️ ${esc(trip.settlement.notice)}</div>`;
  if (canComplete) warnings += `<div class="alert ok">🎉 精算と記録が揃いました。<b>完了にできます</b> <button class="btn sm primary" data-act="tripComplete">完了にする</button></div>`;
  else if (st === '精算・記録中') {
    const need = [];
    if (!settlementComplete(trip)) need.push('精算');
    if (!trip.record.done) need.push('記録完了チェック');
    warnings += `<div class="alert info">📝 完了まで：${need.join('・')}</div>`;
  }
  const next = st === '旅行中' ? nextScheduled(trip) : null;
  return `<div class="card cur-trip">
    <div class="row between"><div class="row gap"><span class="trip-emoji big">${esc(tripEmoji(trip))}</span>
      <div><div class="h2">${esc(trip.title)}</div><div class="muted small">${esc(when)}</div></div></div>
      ${statusBadge(st)}</div>
    <div class="meta-grid">
      <div>🗓 ${trip.startDate ? fmtDateFull(trip.startDate) + (isDayTrip(trip) ? '' : ' 〜 ' + fmtDateFull(trip.endDate)) : '未定'}</div>
      <div>👥 ${trip.members.map(m => esc(m.name) + (m.isMe ? '👤' : '')).join('・')}</div>
      <div>${trip.vehicles.map(v => VEHICLES[v].icon + VEHICLES[v].label).join(' ')} ・ ${trip.mode === 'shiori' ? '📒 しおり' : '📝 リスト'}</div>
      ${trip.area ? `<div>📍 ${esc(trip.area)}</div>` : ''}
      ${bs.budget != null ? `<div>💰 予算 ${fmtMoney(bs.budget, trip.currency)} ／ 実績 ${fmtMoney(bs.total, trip.currency)}</div>` : (bs.total ? `<div>💰 支出 ${fmtMoney(bs.total, trip.currency)}</div>` : '')}
      ${pk != null ? `<div>🎒 持ち物 ${pk}%</div>` : ''}
    </div>
    ${next ? `<div class="next-mini" data-act="goTab" data-tab="drive">次：<b>${esc(next.info.name)}</b> ${fromMin(next.start)}〜</div>` : ''}
    ${warnings}
    <div class="row gap mt wrap">
      <button class="btn" data-act="tripEdit">✏️ 編集</button>
      <button class="btn" data-act="goTab" data-tab="shiori">📒 しおり</button>
      ${st === '中止' ? '<button class="btn" data-act="tripUncancel">中止を取り消す</button>' : st === '完了' ? '<button class="btn" data-act="tripUncomplete">完了を取り消す</button>' : '<button class="btn ghost" data-act="tripCancel">中止にする</button>'}
    </div>
    ${trip.memo ? `<div class="memo">${esc(trip.memo)}</div>` : ''}
  </div>`;
}
function nextScheduled(trip) {
  const today = todayStr();
  const rows = daySchedule(trip, today);
  const now = nowMinutes();
  return rows.find(r => r.end > now && !r.it.visited) || null;
}
ACT.goTab = (el) => switchTab(el.dataset.tab);
ACT.goBookings = () => { S.ui.shioriSub = 'book'; switchTab('shiori'); };
ACT.tripCancel = async () => { const t = curTrip(); if (await confirmDialog('この旅を中止にしますか？（データは残ります）')) { t.manualStatus = '中止'; commitTrip(t); } };
ACT.tripUncancel = () => { const t = curTrip(); t.manualStatus = null; commitTrip(t); };
ACT.tripUncomplete = () => { const t = curTrip(); t.manualStatus = null; commitTrip(t); };
ACT.tripComplete = async () => {
  const t = curTrip();
  if (!(settlementComplete(t) && t.record.done) && !(await confirmDialog('精算または記録が完了していません。それでも完了にしますか？'))) return;
  t.manualStatus = '完了'; commitTrip(t); toast('旅を完了にしました。おつかれさまでした！');
};

// ---------------------------------------------------------------------------
// 旅の作成・編集
// ---------------------------------------------------------------------------
ACT.tripNew = () => openTripEditor(null);
ACT.tripEdit = () => openTripEditor(curTrip());
function openTripEditor(trip, preset) {
  const isNew = !trip;
  const t = trip || Object.assign(newTrip(preset || {}), preset ? { _preset: true } : {});
  const st = trip ? tripStatus(trip) : null;
  openModal(`<div class="form-grid">
    <label>タイトル<span class="req">必須</span></label><input id="teTitle" value="${esc(t.title === '新しい旅' && isNew ? '' : t.title)}" placeholder="例：淡路島ドライブ">
    <label>日程</label><div><div class="row gap"><input type="date" id="teStart" value="${esc(t.startDate || '')}"><span>〜</span><input type="date" id="teEnd" value="${esc(t.endDate || '')}"></div>
      <div class="muted small">未定のままなら「検討中」。日付を入れると「計画中」へ自動で進みます。開始日＝終了日で日帰り</div></div>
    <label>モード<span class="req">必須</span></label>${segHTML('teMode', [{ v: 'shiori', l: '📒 しおり（工程を決める）' }, { v: 'list', l: '📝 リスト（行きたい所だけ）' }], t.mode, 'segPick')}
    <label>メンバー<span class="req">必須</span></label>${membersEditorHTML(t.members)}
    <label>行き先エリア</label><input id="teArea" value="${esc(t.area)}" placeholder="例：淡路島">
    <label>国内／海外</label><div><select id="teRegion"><option value="auto" ${!t.regionManual ? 'selected' : ''}>自動（今は${detectRegion(t) === 'overseas' ? '海外' : '国内'}）</option><option value="domestic" ${t.regionManual && t.region === 'domestic' ? 'selected' : ''}>国内</option><option value="overseas" ${t.regionManual && t.region === 'overseas' ? 'selected' : ''}>海外</option></select>
      ${t.driveFolderId ? `<div class="muted small">写真の保存フォルダは作成済みのため移動しません（${esc(t.driveFolderName || '')}）</div>` : ''}</div>
    <label>英語タイトル</label><input id="teTitleEn" value="${esc(t.titleEn || '')}" placeholder="任意（ビジュアルの表紙文字。空欄なら自動で英語表示）">
    <label>出発地</label><div class="row gap"><input id="teOrigin" class="grow" value="${esc(t.origin && t.origin.name || '')}" placeholder="自宅"><button class="btn sm" data-act="teOriginHome">自宅</button><button class="btn sm" data-act="teOriginHere">現在地</button></div>
    <input type="hidden" id="teOriginLat" value="${t.origin && t.origin.lat != null ? t.origin.lat : ''}"><input type="hidden" id="teOriginLng" value="${t.origin && t.origin.lng != null ? t.origin.lng : ''}">
    <label>予算（総額）</label>${amountFieldHTML('id="teBudget"', t.budget, '円')}
    <label>主な乗り物</label>${vehicleChipsHTML(t.vehicles, 'teVeh')}
    <label>精算通貨</label><select id="teCur">${currencyOptions(t.currency)}</select>
    <label>代表絵文字</label><input id="teEmoji" value="${esc(t.emoji)}" maxlength="4" placeholder="${esc(tripEmoji(t))}" class="emoji-in">
    <label>メモ</label><textarea id="teMemo" rows="2">${esc(t.memo)}</textarea>
  </div>
  <div class="row gap mt"><button class="btn primary grow" data-act="teSave">${isNew ? 'この旅を作る' : '保存'}</button></div>
  ${!isNew ? `<div class="row gap mt wrap"><span class="muted small">現在：${statusBadge(st)}</span><button class="btn ghost sm" data-act="teDelete">🗑 この旅を削除</button></div>` : ''}`,
    { title: isNew ? '🧳 新しい旅' : '✏️ 旅の編集', full: true, data: { trip: t, isNew }, sticky: true });
}
ACT.segPick = (el) => { $$('.seg-btn', el.parentNode).forEach(b => b.classList.toggle('on', b === el)); };
function segValue(root, name) { const b = $(`.seg-btn.on[data-name="${name}"]`, root); return b ? b.dataset.v : null; }
ACT.teOriginHome = () => { const b = topModalBody(); const h = S.settings.home; $('#teOrigin', b).value = h.name; $('#teOriginLat', b).value = h.lat; $('#teOriginLng', b).value = h.lng; };
ACT.teOriginHere = () => {
  const b = topModalBody();
  if (!S.geo) return toast('現在地を取得できていません');
  $('#teOrigin', b).value = '現在地（' + S.geo.lat.toFixed(3) + ',' + S.geo.lng.toFixed(3) + '）'; $('#teOriginLat', b).value = S.geo.lat; $('#teOriginLng', b).value = S.geo.lng;
};
ACT.teSave = () => {
  const b = topModalBody(); const { trip, isNew } = topModal().data;
  const title = $('#teTitle', b).value.trim();
  if (!title) return toast('タイトルを入れてください');
  const members = readMembersEditor(b);
  if (!members.length) return toast('メンバーを1人以上入れてください');
  let s = $('#teStart', b).value || null, e = $('#teEnd', b).value || null;
  if (!s && e) s = e;
  if (s && !e) e = s;
  if (s && e && e < s) return toast('終了日が開始日より前です');
  const vehicles = $$('input[name="teVeh"]', b).filter(x => x.checked).map(x => x.value);
  const mode = segValue(b, 'teMode') || 'list';
  // メンバー削除で参照が切れる支出がないか
  const removed = trip.members.filter(m => !members.some(x => x.id === m.id));
  const used = removed.filter(m => allExpenses(trip).some(x => x.money.payer === m.id || (x.money.split || []).includes(m.id)));
  if (used.length && !window.confirm(used.map(m => m.name).join('・') + ' は支出に使われています。削除すると精算から外れます。続けますか？')) return;
  trip.title = title;
  trip.startDate = s; trip.endDate = e;
  trip.members = members;
  trip.area = $('#teArea', b).value.trim();
  trip.origin = { name: $('#teOrigin', b).value.trim() || S.settings.home.name, lat: $('#teOriginLat', b).value !== '' ? num($('#teOriginLat', b).value) : S.settings.home.lat, lng: $('#teOriginLng', b).value !== '' ? num($('#teOriginLng', b).value) : S.settings.home.lng };
  trip.budget = $('#teBudget', b).value !== '' ? num($('#teBudget', b).value) : null;
  trip.vehicles = vehicles.length ? vehicles : ['car'];
  if (!trip.vehicles.includes(trip.listTransport.mode)) trip.listTransport.mode = trip.vehicles[0];
  trip.currency = $('#teCur', b).value;
  trip.emoji = Array.from($('#teEmoji', b).value.trim())[0] || '';
  trip.titleEn = $('#teTitleEn', b).value.trim();
  const rg = $('#teRegion', b).value;
  trip.regionManual = rg !== 'auto';
  trip.region = rg === 'auto' ? detectRegion(trip) : rg;
  trip.memo = $('#teMemo', b).value;
  if (trip.mode !== mode && !isNew) switchMode(trip, mode); else trip.mode = mode;
  delete trip._preset;
  if (isNew && trip.packing.length === 0 && trip.startDate) generatePacking(trip);
  S.curTripId = trip.id;
  closeModal();
  commitTrip(trip);
  toast(isNew ? '旅を作りました（' + tripStatus(trip) + '）' : '保存しました');
};
ACT.teDelete = async () => {
  const { trip } = topModal().data;
  if (!(await confirmDialog('「' + trip.title + '」を削除します。元に戻せません。よろしいですか？'))) return;
  closeModal();
  trip._deleted = true;
  S.dirty[trip.id] = true;
  if (S.curTripId === trip.id) S.curTripId = null;
  saveCache(); flushSaves();
  pickDefaultTrip();
  render();
};

// ---------------------------------------------------------------------------
// モード切替（どちらの向きでもデータは失われない）
//  しおり→リスト：時刻情報は保持したまま隠す（固定枠・予約は日時が決まっているので工程に残る）
//  リスト→しおり：スポットは「未配置」プールへ。保持していた時刻はワンタップで復元できる
// ---------------------------------------------------------------------------
function switchMode(trip, mode) {
  if (trip.mode === mode) return;
  if (mode === 'list') {
    trip.items.forEach(it => {
      if (it.date && !it.hiddenTime && !it.locked) {
        it.hiddenTime = { date: it.date, start: it.start, startManual: it.startManual, order: it.order };
      }
    });
  }
  trip.mode = mode;
}
function restoreHiddenTime(trip, it) {
  if (!it.hiddenTime) return;
  Object.assign(it, { date: it.hiddenTime.date, start: it.hiddenTime.start, startManual: it.hiddenTime.startManual, order: it.hiddenTime.order });
  it.hiddenTime = null;
}
