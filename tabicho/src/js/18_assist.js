// ============================================================================
// 18 v2.2 旅先の相棒（C-1 寄り道レーダー・C-2 仮しおりの自動生成）
//   判定・計算は純粋な関数（テストできる）、画面はその結果を表示するだけ。外部 API は使わない
//   （C-1 の上位候補だけ、既存の routeFor＝経路キャッシュつき で実際の所要に置き換える）
// ============================================================================
const DETOUR_DEFAULT_STAY = 60;   // 滞在目安が無いスポットの既定（分）
const DETOUR_TOP_ROUTES = 6;      // 実経路に置き換える上位件数
const PLAN_DAY_END = '21:00';     // 1日の終わりの目安（設定に「終了時刻」が無いため）
const DAY_END_MIN = 1440;         // 次の予定が無い日の「今日中」

function travelMode(trip) {
  const m = (trip.listTransport && trip.listTransport.mode) || (trip.vehicles || [])[0] || 'car';
  return m === 'plane' || m === 'ferry' ? 'train' : m;   // 寄り道・街中の移動に飛行機・船は使わない
}
function roundUp5(m) { return Math.ceil(m / 5) * 5; }

// ---------------------------------------------------------------------------
// C-1 寄り道レーダー
// ---------------------------------------------------------------------------
// 候補：スポット帳の「行きたい」で未訪問のもの ＋ この旅の未配置リスト（同じスポットは1つ）。今日の工程に入っているものは除く
function detourPool(trip, date) {
  const today = new Set(dayItems(trip, date).map(i => i.spotId).filter(Boolean));
  const out = [], seen = new Set();
  unscheduledItems(trip).filter(i => !i.visited).forEach(it => {
    const info = itemInfo(trip, it);
    if (it.spotId) { if (today.has(it.spotId)) return; seen.add(it.spotId); }
    out.push({ key: 'it:' + it.id, itemId: it.id, spotId: it.spotId || null, info, from: 'list' });
  });
  Object.values(S.spots || {}).forEach(sp => {
    if (seen.has(sp.id) || today.has(sp.id)) return;
    if (sp.status !== 'want' || (sp.visits && sp.visits.length)) return;
    const info = itemInfo(trip, newItem({ spotId: sp.id, nameCache: sp.name }));
    out.push({ key: 'sp:' + sp.id, itemId: null, spotId: sp.id, info, from: 'spotcho' });
  });
  return out;
}
// 次の予定（今より後に始まる、まだ行っていない工程）。固定枠はその開始時刻、通常の工程は daySchedule の算出時刻
function nextAppointment(trip, date, nowMin) {
  const r = daySchedule(trip, date).find(x => x.start > nowMin && !x.it.visited);
  if (!r) return null;
  return { row: r, start: r.start, locked: !!r.it.locked, name: r.info.name, point: r.info.lat != null ? { lat: r.info.lat, lng: r.info.lng } : null };
}
// ctx：{ date, now(分), geo, routes:{key:{min,km}}（実経路があれば） }
function detourCandidates(trip, ctx) {
  if (!ctx.geo || ctx.geo.lat == null) return { error: 'nogeo', list: [] };
  const mode = travelMode(trip);
  const next = nextAppointment(trip, ctx.date, ctx.now);
  const deadline = next ? next.start : DAY_END_MIN;
  const list = [];
  detourPool(trip, ctx.date).forEach(c => {
    const info = c.info;
    if (info.lat == null) return;                                                   // 1. 座標があるもの
    const os = openStateAt(info.hours, ctx.date, ctx.now);
    if (os.state !== 'open' && os.state !== 'unknown') return;                      // 2. 今営業中（不明は残して後ろへ）
    const km = haversineKm(ctx.geo, info);
    const real = ctx.routes && ctx.routes[c.key];
    const go = real ? real.min : estimateMinutes(km, mode);
    const stay = num(info.stay, 0) > 0 ? num(info.stay, 0) : DETOUR_DEFAULT_STAY;
    const back = next && next.point ? estimateMinutes(haversineKm(info, next.point), mode) : 0;
    const need = go + stay + back;                                                  // 3. 移動＋滞在（＋次の予定の場所まで）
    const left = deadline - ctx.now;
    if (need > left) return;
    if (os.state === 'open' && os.closeIn != null && os.closeIn < go + Math.min(stay, 30)) return;   // 着いたら閉店、は出さない
    list.push({
      key: c.key, itemId: c.itemId, spotId: c.spotId, name: info.name, point: { lat: info.lat, lng: info.lng, name: info.name, address: info.address },
      km: real && real.km != null ? real.km : km, go, stay, back, need, spare: Math.round(left - need), real: !!real,
      open: os.state, closeIn: os.closeIn != null ? Math.round(os.closeIn) : null, priority: info.priority === 'must' ? 'must' : 'maybe', from: c.from
    });
  });
  list.sort((a, b) => (a.open === 'unknown') - (b.open === 'unknown') || a.km - b.km);
  return { list, next: next ? { name: next.name, start: next.start, locked: next.locked, left: Math.round(deadline - ctx.now) } : null, mode };
}
// 工程に差し込む：今の時刻の位置（次の予定の前）に入れる。固定枠は動かさない
function insertDetour(trip, date, nowMin, cand) {
  const rows = daySchedule(trip, date);
  const nextIdx = rows.findIndex(r => r.start > nowMin);
  const prev = nextIdx > 0 ? rows[nextIdx - 1] : (nextIdx === -1 ? rows[rows.length - 1] : null);
  const nxt = nextIdx >= 0 ? rows[nextIdx] : null;
  let it = cand.itemId ? trip.items.find(i => i.id === cand.itemId) : null;
  if (!it) { it = newItem({ spotId: cand.spotId, nameCache: cand.name }); trip.items.push(it); }
  it.hiddenTime = null;
  it.date = date;
  it.start = fromMin(roundUp5(nowMin + cand.go));
  it.startManual = true;
  it.locked = false;
  it.stay = cand.stay;
  if (prev && nxt) it.order = (prev.it.order + nxt.it.order) / 2;
  else if (nxt) it.order = nxt.it.order - 1000;
  else it.order = prev ? prev.it.order + 1000 : 1000;
  it.moveAfter = cand.back ? roundUp5(cand.back) : null;
  it.moveAuto = true;
  return it;
}
let detourState = null;
async function getGeoOnce() {
  if (S.geo && Date.now() - (S.geo.at || 0) < 5 * 60 * 1000) return S.geo;
  if (!navigator.geolocation) return null;
  return new Promise(res => {
    try {
      navigator.geolocation.getCurrentPosition(p => { S.geo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, at: Date.now() }; res(S.geo); },
        () => res(null), { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 });
    } catch (e) { res(null); }
  });
}
ACT.detourOpen = async (el) => {
  const t = curTrip(); if (!t) return;
  if (el) { el.disabled = true; el.innerHTML = '<span class="spin"></span> 現在地を確認中…'; }
  const geo = await getGeoOnce();
  if (el) { el.disabled = false; el.innerHTML = '🧭 寄り道を探す'; }
  if (!geo) { toast('現在地が分かりません（位置情報をオンにして、もう一度お試しください）', { ms: 5000 }); return; }
  if (S.spotsState !== 'ok') loadSpots(true);
  detourState = { tripId: t.id, routes: {} };
  openModal('<div id="detourBody"></div>', { title: '🧭 寄り道レーダー', onMount: () => detourRender(), onClose: () => { detourState = null; } });
};
function detourCompute() {
  const t = S.trips[detourState.tripId];
  const date = tripToday(t), now = tripNowMin(t);
  const res = detourCandidates(t, { date, now, geo: S.geo, routes: detourState.routes });
  // 上位だけ実経路に置き換える（routeFor はキャッシュつき。届いたら描き直す）
  res.list.slice(0, DETOUR_TOP_ROUTES).forEach(c => {
    if (detourState.routes[c.key]) return;
    const r = routeFor(S.geo, c.point, res.mode === 'walk' ? 'walk' : res.mode, t.listTransport);
    if (r && !r.estimated) detourState.routes[c.key] = r;
  });
  return Object.assign(detourCandidates(t, { date, now, geo: S.geo, routes: detourState.routes }), { t, date, now });
}
function detourRender() {
  const box = $('#detourBody'); if (!box || !detourState) return;
  const r = detourCompute();
  let h = '';
  h += r.next ? `<div class="info-box small">次の予定：<b>${r.next.locked ? '🔒 ' : ''}${esc(r.next.name)}</b>（${fromMin(Math.round(r.next.start))}）まで あと <b>${r.next.left}分</b>。戻る時間も含めて間に合う所だけ出しています</div>`
    : `<div class="info-box small">今日はこの後の予定がありません。営業時間内に寄れる所を出しています</div>`;
  if (S.spotsState === 'loading') h += '<div class="muted small">スポット帳を読み込み中…</div>';
  if (!r.list.length) h += `<div class="card muted">今から寄れる候補がありません（営業中・座標あり・時間内のもの）</div>`;
  r.list.forEach(c => {
    h += `<div class="card detour">
      <div class="row between"><b>${c.priority === 'must' ? '⭐ ' : ''}${esc(c.name)}</b><span class="muted small">${fmtKm(c.km)}</span></div>
      <div class="small">${VEHICLES[r.mode] ? VEHICLES[r.mode].icon : '🚶'} ${c.go}分${c.real ? '' : '（概算）'} ・ 滞在 ${c.stay}分${c.back ? ` ・ 次の場所へ ${c.back}分` : ''}</div>
      <div class="small">${c.open === 'open' ? `<span class="ok">営業中</span>${c.closeIn != null ? `（閉店まで ${c.closeIn}分）` : ''}` : '<span class="warn">営業時間不明</span>'} ・ ${r.next ? `余裕 <b>${c.spare}分</b>（間に合う）` : '今日中なら自由'}</div>
      <div class="row gap mt"><button class="btn sm primary" data-act="detourInsert" data-k="${esc(c.key)}">＋ 工程に差し込む</button>
      <a class="btn sm" href="${mapsDirUrl(c.point, r.mode)}" target="_blank" rel="noopener">🧭 このままナビ開始</a></div></div>`;
  });
  box.innerHTML = h;
}
ACT.detourInsert = (el) => {
  const r = detourCompute();
  const c = r.list.find(x => x.key === el.dataset.k); if (!c) return toast('候補が見つかりません（時間が過ぎた可能性）');
  if (!tripDays(r.t).includes(r.date)) return toast('今日は旅の日程の外です');
  insertDetour(r.t, r.date, r.now, c);
  closeModal();
  commitTrip(r.t);
  autoMoveTimes(r.t, r.date);
  toast(c.name + ' を今日の工程に入れました');
};

// ---------------------------------------------------------------------------
// C-2 仮しおりの自動生成（定休日パズル＋近い順の巡回）
// ---------------------------------------------------------------------------
function isAnchor(it) { return !!((it.locked || it.startManual) && toMin(it.start) != null); }
// その日の出発点：前の日の最後の場所（宿の固定枠など）→ 無ければ旅の出発地
function dayStartPoint(trip, days, idx, seqByDay) {
  for (let k = idx - 1; k >= 0; k--) {
    const seq = seqByDay[days[k]] || [];
    for (let j = seq.length - 1; j >= 0; j--) if (seq[j].p) return seq[j].p;
  }
  const o = trip.origin || S.settings.home;
  return o && o.lat != null ? { lat: o.lat, lng: o.lng } : null;
}
function legMin(a, b, mode) { return a && b ? roundUp5(estimateMinutes(haversineKm(a, b), mode)) : 0; }
// 1日の並び（seq）を時刻でなぞる。固定枠・時刻指定は動かさず、新しく入れたものだけ開店待ちをする
function simulateDay(trip, date, seq, startPoint, mode) {
  const dayStart = toMin(S.settings.dayStart) || 540, dayEnd = toMin(PLAN_DAY_END);
  let cursor = null, late = 0, ok = true, moveTotal = 0, prevP = startPoint, prevExisting = null;
  const out = [];
  seq.forEach((x, i) => {
    let leg;
    if (prevExisting && !x.isNew && prevExisting.moveAfter != null && prevExisting.moveAfter !== '') leg = num(prevExisting.moveAfter, 0);
    else leg = i === 0 ? 0 : legMin(prevP, x.p, mode);
    if (i > 0) moveTotal += leg;
    let start;
    const at = cursor == null ? dayStart : cursor + leg;
    if (isAnchor(x.it) && !x.isNew) { start = toMin(x.it.start); if (cursor != null && at > start + 0.5) late++; }
    else start = i === 0 && toMin(x.it.start) != null ? toMin(x.it.start) : at;
    let wait = 0;
    if (x.isNew) {
      const r = hoursOn(x.info.hours, date);
      if (r !== null) {
        if (!r.length) ok = false;
        const fit = r.map(w => [Math.max(start, w[0]), w[1]]).filter(w => w[0] + x.stay <= w[1]).sort((a, b) => a[0] - b[0])[0];
        if (!fit) ok = false; else { wait = fit[0] - start; start = fit[0]; }
      }
      if (start + x.stay > dayEnd) ok = false;
    }
    const end = start + x.stay;
    out.push({ x, start, end, leg, wait });
    cursor = end;
    prevP = x.p || prevP;
    prevExisting = x.isNew ? null : x.it;
  });
  return { ok, late, rows: out, moveTotal, end: cursor };
}
function seqDistance(seq, startPoint) {
  let d = 0, p = startPoint;
  seq.forEach(x => { if (p && x.p) d += haversineKm(p, x.p); if (x.p) p = x.p; });
  return d;
}
// 生成本体。trip は書き換えない（プレビューを作るだけ）
function planAuto(trip) {
  const days = tripDays(trip);
  const mode = travelMode(trip);
  const result = { days: [], unplaced: [], closedAvoided: 0, unknownHours: 0, moveTotal: 0, mode };
  if (!days.length) { result.error = 'nodays'; return result; }
  const cands = unscheduledItems(trip).filter(i => !i.visited).map(it => {
    const info = itemInfo(trip, it);
    return { it, info, isNew: true, p: info.lat != null ? { lat: info.lat, lng: info.lng } : null, stay: num(it.stay, 0) || num(info.stay, 0) || 60, pri: (it.priority || info.priority) === 'must' ? 'must' : 'maybe' };
  });
  const seqByDay = {};
  days.forEach(d => { seqByDay[d] = dayItems(trip, d).map(it => { const info = itemInfo(trip, it); return { it, info, isNew: false, p: info.lat != null ? { lat: info.lat, lng: info.lng } : null, stay: Math.max(0, num(it.stay, 0)) }; }); });
  const base = {};
  days.forEach((d, i) => { base[d] = simulateDay(trip, d, seqByDay[d], dayStartPoint(trip, days, i, seqByDay), mode).late; });
  const placeable = [];
  cands.forEach(c => {
    if (!c.p) { result.unplaced.push({ name: c.info.name, reason: '座標がない' }); return; }
    c.allowed = days.filter(d => dayAvailability(c.info.hours, d) !== 'closed');
    c.closedDays = days.length - c.allowed.length;
    if (!c.allowed.length) { result.unplaced.push({ name: c.info.name, reason: '旅の日程がすべて定休日' }); return; }
    placeable.push(c);
  });
  // 絶対行きたい → 行ける日が少ない順（定休日のパズルを先に解く）→ 行けたら
  placeable.sort((a, b) => (a.pri === 'must' ? 0 : 1) - (b.pri === 'must' ? 0 : 1) || a.allowed.length - b.allowed.length);
  placeable.forEach(c => {
    let best = null;
    c.allowed.forEach(d => {
      const i = days.indexOf(d);
      const sp = dayStartPoint(trip, days, i, seqByDay);
      const seq = seqByDay[d];
      const before = seqDistance(seq, sp);
      // 最安挿入：工程の並びのどこに入れると移動が一番増えないか（既存の工程の順番は変えない）
      for (let pos = 0; pos <= seq.length; pos++) {
        const trial = seq.slice(0, pos).concat([c], seq.slice(pos));
        const added = seqDistance(trial, sp) - before;
        if (best && added >= best.added) continue;
        const sim = simulateDay(trip, d, trial, sp, mode);
        if (!sim.ok || sim.late > base[d]) continue;
        best = { d, pos, added };
      }
    });
    if (!best) { result.unplaced.push({ name: c.info.name, reason: '時間内に入りきらない', pri: c.pri }); return; }
    seqByDay[best.d].splice(best.pos, 0, c);
    if (c.closedDays) result.closedAvoided++;
  });
  // 2-opt：新しく入れたものが続いている区間の中だけで順番を入れ替える（既存の工程の位置は変えない）
  days.forEach((d, i) => {
    const sp = dayStartPoint(trip, days, i, seqByDay);
    let seq = seqByDay[d], improved = true, guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let a = 0; a < seq.length; a++) {
        if (!seq[a].isNew) continue;
        let b = a; while (b + 1 < seq.length && seq[b + 1].isNew) b++;
        for (let x = a; x < b; x++) for (let y = x + 1; y <= b; y++) {
          const trial = seq.slice(0, x).concat(seq.slice(x, y + 1).reverse(), seq.slice(y + 1));
          if (seqDistance(trial, sp) + 1e-9 < seqDistance(seq, sp)) {
            const sim = simulateDay(trip, d, trial, sp, mode);
            if (sim.ok && sim.late <= base[d]) { seq = trial; improved = true; }
          }
        }
        a = b;
      }
    }
    seqByDay[d] = seq;
    const sim = simulateDay(trip, d, seq, sp, mode);
    result.moveTotal += sim.moveTotal;
    result.days.push({
      date: d, index: i + 1, moveTotal: sim.moveTotal,
      rows: sim.rows.map(r => ({ id: r.x.it.id, name: r.x.info.name, isNew: r.x.isNew, locked: !!r.x.it.locked, anchor: isAnchor(r.x.it), start: Math.round(r.start), end: Math.round(r.end), leg: r.leg, wait: Math.round(r.wait), unknownHours: r.x.isNew && dayAvailability(r.x.info.hours, d) === 'unknown' }))
    });
    sim.rows.forEach(r => { if (r.x.isNew && dayAvailability(r.x.info.hours, d) === 'unknown') result.unknownHours++; });
  });
  result.placed = result.days.reduce((s, d) => s + d.rows.filter(r => r.isNew).length, 0);
  return result;
}
// 反映：プレビューの並びをそのまま旅に書く（固定枠・時刻指定の工程は触らない）
function applyPlan(trip, plan) {
  plan.days.forEach(d => {
    d.rows.forEach((r, k) => {
      const it = trip.items.find(i => i.id === r.id); if (!it) return;
      if (!r.isNew) { it.order = (k + 1) * 1000; return; }   // 既存の工程は並び順の番号を振り直すだけ（順番は変えない）
      it.hiddenTime = null;
      it.date = d.date;
      it.order = (k + 1) * 1000;
      if (r.wait > 0) { it.start = fromMin(r.start); it.startManual = true; }   // 開店を待つものだけ時刻を入れる
      else { it.start = null; it.startManual = false; }
    });
    // 移動時間：新しく入れたものの前後は概算を入れておき、反映のあと経路で計算し直す
    d.rows.forEach((r, k) => {
      const nx = d.rows[k + 1]; if (!nx) return;
      if (!r.isNew && !nx.isNew) return;
      const it = trip.items.find(i => i.id === r.id);
      if (it && it.moveAuto !== false) { it.moveAfter = nx.leg; it.moveAuto = true; }
    });
  });
}
ACT.autoPlanOpen = () => {
  const t = curTrip(); if (!t) return;
  const plan = planAuto(JSON.parse(JSON.stringify(t)));
  if (plan.error === 'nodays') return toast('日程を入れると、自動でしおり案を作れます');
  let h = `<div class="info-box small">「行きたい場所」から、定休日を避けて近い順に回る仮のしおり案です。<b>まだしおりは変わっていません</b>。
    固定枠🔒と時刻を決めた工程は動かしません。1日は ${esc(S.settings.dayStart || '09:00')}〜${PLAN_DAY_END} を目安にしています</div>
    <div class="card small"><b>配置 ${plan.placed}件</b> ・ 総移動 約${plan.moveTotal}分${plan.closedAvoided ? ` ・ 定休日を避けた ${plan.closedAvoided}件` : ''}${plan.unknownHours ? ` ・ <span class="warn">営業時間未確認 ${plan.unknownHours}件</span>` : ''}${plan.unplaced.length ? ` ・ 未配置のまま ${plan.unplaced.length}件` : ''}</div>`;
  plan.days.forEach(d => {
    if (!d.rows.length) return;
    h += `<div class="card"><div class="row between"><b>${d.index}日目 ${fmtDate(d.date)}</b><span class="muted small">移動 約${d.moveTotal}分</span></div>
      ${d.rows.map(r => `<div class="ap-row ${r.isNew ? 'new' : ''}">${r.leg ? `<div class="muted small">　↓ ${r.leg}分</div>` : ''}<div><span class="mono">${fromMin(r.start)}–${fromMin(r.end)}</span> ${r.locked ? '🔒 ' : ''}${r.isNew ? '<b>🆕 ' + esc(r.name) + '</b>' : esc(r.name)}${r.wait ? ` <span class="muted small">（開店待ち ${r.wait}分）</span>` : ''}${r.unknownHours ? ' <span class="warn small">営業時間未確認</span>' : ''}</div></div>`).join('')}</div>`;
  });
  if (plan.unplaced.length) h += `<div class="card"><b>未配置のまま残すもの</b>${plan.unplaced.map(u => `<div class="small">${u.pri === 'must' ? '⭐ ' : ''}${esc(u.name)} <span class="muted">— ${esc(u.reason)}</span></div>`).join('')}</div>`;
  h += `<div class="row gap mt"><button class="btn grow" data-act="closeModal">キャンセル</button><button class="btn primary grow" data-act="autoPlanApply" ${plan.placed ? '' : 'disabled'}>この案をしおりに反映</button></div>`;
  openModal(h, { title: '🪄 自動でしおり案', data: { t, plan } });
};
ACT.autoPlanApply = () => {
  const { t, plan } = topModal().data;
  applyPlan(t, plan);
  if (t.mode !== 'shiori') switchMode(t, 'shiori');
  closeModal();
  commitTrip(t);
  plan.days.forEach(d => { if (d.rows.some(r => r.isNew)) autoMoveTimes(t, d.date); });
  toast(plan.placed + '件をしおりに入れました（移動時間は経路で計算し直しています）');
};
