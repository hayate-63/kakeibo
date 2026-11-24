// ============================================================================
// 09 ドライブタブ：次の目的地・出発カウントダウン・ナビ・走行距離・給油・駐車場
//    車以外の旅では次の駅・空港・港の情報表示に切り替わる
// ============================================================================
function driveCandidates(trip) {
  const today = todayStr();
  const days = tripDays(trip);
  let rows = [];
  // 今日（旅行中）→ 今後の工程、旅行前 → 1日目の工程
  const day = days.includes(today) ? today : (days.find(d => d >= today) || days[0]);
  if (day) rows = daySchedule(trip, day).map(r => Object.assign({ day }, r));
  const now = day === today ? nowMinutes() : -1;
  const sched = rows.filter(r => !r.it.visited && (day !== today || r.end > now));
  const list = sortListItems(trip, unscheduledItems(trip).filter(i => !i.visited)).map(it => ({ it, info: itemInfo(trip, it), start: null, day: null }));
  return { day, sched, list, all: sched.concat(list) };
}
function renderDrive(trip) {
  const c = driveCandidates(trip);
  let target = null;
  if (trip.driveTargetId) target = c.all.find(x => x.it.id === trip.driveTargetId) || null;
  if (!target) target = c.all[0] || null;
  const carTrip = hasVehicle(trip, 'car');
  let h = '';
  if (!carTrip) h += renderTransit(trip, c);
  if (target && carTrip) h += driveTargetCard(trip, target, c);
  else if (!target && carTrip) h += emptyHTML('🚗', '次の目的地がありません。しおりやリストにスポットを入れてください。');
  if (carTrip) {
    // 車旅でも次の移動が船・飛行機などなら案内を出す
    const tr = c.sched.find(r => r.it.kind === 'move' && r.it.transport && r.it.transport.mode !== 'car');
    if (tr) h += transitCard(trip, tr);
    h += odometerCard(trip);
    h += fuelCard(trip);
  } else if (target) {
    h += `<div class="card"><div class="muted small">次に行くスポット</div><div class="h2">${esc(target.info.name)}</div>
      <a class="btn primary block mt" href="${mapsDirUrl(itemPoint(trip, target.it) || target.info, 'train')}" target="_blank" rel="noopener">🧭 乗換案内（Googleマップ）</a></div>`;
  }
  return h;
}
function driveTargetCard(trip, t, c) {
  const p = itemPoint(trip, t.it);
  const o = S.geo ? { lat: S.geo.lat, lng: S.geo.lng, name: '現在地' } : originPoint(trip);
  const r = p && o ? routeFor(o, p, 'car', trip.listTransport) : null;
  const margin = num(S.settings.departMarginMin, 10);
  let cd = '';
  if (t.start != null && r) {
    const dep = t.start - r.min - margin;
    const at = parseYmd(t.day).getTime() + dep * 60000;
    cd = `<div class="countdown"><div class="muted small">出発まで（${fromMin(t.start)}着 − 所要${r.estimated ? '約' : ''}${fmtDuration(r.min)} − 余裕${margin}分）</div>
      <div class="cd-big" id="cdown" data-at="${at}">--:--</div><div class="muted small">出発目安 ${fmtDate(t.day)} ${fmtMinLabel(dep)}</div></div>`;
  }
  const idx = c.all.indexOf(t);
  const next2 = c.all[idx + 1];
  const info = t.info;
  return `<div class="card drive-main">
    <div class="row between"><span class="muted small">${t.start != null ? '次の目的地（' + fmtDate(t.day) + ' ' + fromMin(t.start) + '〜）' : '次に行く（リストから）'}</span>
      <span class="row gap"><button class="btn sm" data-act="drivePrev" ${idx <= 0 ? 'disabled' : ''}>◀</button><button class="btn sm" data-act="driveNext" ${idx >= c.all.length - 1 ? 'disabled' : ''}>▶</button></span></div>
    <div class="drive-name">${esc(info.name)}</div>
    <div class="muted">${esc(info.address || '')}</div>
    ${r ? `<div class="drive-route">🚗 ${fmtKm(r.km)}・${r.estimated ? '約' : ''}${fmtDuration(r.min)}${r.toll ? '・高速 約' + fmtMoney(r.toll) : ''}<span class="muted small">（${esc(o.name)}から）</span></div>` : (p ? '' : '<div class="warn-box small">座標がないためナビ・所要時間を出せません</div>')}
    ${cd}
    <a class="btn primary xl block" href="${p ? mapsDirUrl(p, 'car') : mapsSearchUrl(info)}" target="_blank" rel="noopener">🧭 ナビ開始</a>
    <div class="row gap mt"><button class="btn grow" data-act="driveArrived" data-id="${t.it.id}">✅ 着いた（行った）</button></div>
    <div class="park"><div class="b">🅿️ 駐車場</div>
      <div class="muted small">${info.parking === true ? 'スポット帳：駐車場あり' : info.parking === false ? 'スポット帳：駐車場なし' : info.parking ? 'スポット帳：' + esc(info.parking) : 'スポット帳：情報なし'}</div>
      <textarea rows="2" data-change="parkMemo" data-id="${t.it.id}" placeholder="駐車場メモ（場所・料金・停めた位置など）">${esc(t.it.parkingMemo || '')}</textarea></div>
    ${next2 ? `<div class="next-mini">その次：<b>${esc(next2.info.name)}</b>${next2.start != null ? ' ' + fromMin(next2.start) + '〜' : ''}</div>` : ''}
  </div>`;
}
ACT.driveNext = () => shiftDrive(1);
ACT.drivePrev = () => shiftDrive(-1);
function shiftDrive(d) {
  const t = curTrip(); const c = driveCandidates(t);
  let idx = c.all.findIndex(x => x.it.id === t.driveTargetId); if (idx < 0) idx = 0;
  const n = c.all[clamp(idx + d, 0, c.all.length - 1)];
  if (n) { t.driveTargetId = n.it.id; commitTrip(t); }
}
ACT.driveArrived = async (el) => {
  const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id);
  t.driveTargetId = null;
  await markVisited(t, it);
};
ON_CHANGE.parkMemo = (el) => { const t = curTrip(); const it = t.items.find(i => i.id === el.dataset.id); it.parkingMemo = el.value; commitTrip(t, { noRender: true }); toast('駐車場メモを保存しました'); };

setInterval(() => {
  const el = document.getElementById('cdown');
  if (!el) return;
  const ms = Number(el.dataset.at) - Date.now();
  if (ms <= 0) { el.textContent = ms > -3600e3 ? '出発時刻です！' : '出発時刻を過ぎています'; el.classList.add('late'); return; }
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  el.textContent = (h ? h + ':' : '') + pad2(m) + ':' + pad2(ss);
  el.classList.toggle('soon', ms < 15 * 60000);
}, 1000);

// ---- 車以外：次の駅・空港・港 ----
function nextTransport(trip, c) {
  const moves = c.sched.filter(r => r.it.kind === 'move');
  if (moves.length) return moves[0];
  const bk = trip.bookings.filter(b => b.type === '交通' && b.status !== 'キャンセル' && b.date && (b.date > todayStr() || (b.date === todayStr() && toMin(b.time || '23:59') > nowMinutes())))
    .sort((a, b) => (a.date + (a.time || '')) < (b.date + (b.time || '')) ? -1 : 1)[0];
  if (bk) return { it: { kind: 'move', transport: { mode: bk.transportMode || 'train', from: bk.place, to: bk.placeTo, number: bk.number }, bookingId: bk.id, id: 'bk' }, info: { name: bk.title }, start: toMin(bk.time), day: bk.date };
  return null;
}
function renderTransit(trip, c) {
  const t = nextTransport(trip, c);
  if (!t) return `<div class="card"><div class="b">🚃 次の移動</div><div class="muted small">工程に「移動」か、予約に「交通」を入れると、次の駅・空港・港の情報がここに出ます。</div></div>`;
  return transitCard(trip, t);
}
function transitCard(trip, t) {
  const tp = t.it.transport || {};
  const v = VEHICLES[tp.mode] || VEHICLES.train;
  const placeWord = tp.mode === 'plane' ? '空港' : tp.mode === 'ferry' ? '港' : '駅';
  const bk = t.it.bookingId ? trip.bookings.find(b => b.id === t.it.bookingId) : null;
  const at = t.start != null && t.day ? parseYmd(t.day).getTime() + t.start * 60000 : null;
  return `<div class="card transit">
    <div class="muted small">${v.icon} 次の${v.label}（${t.day ? fmtDate(t.day) : ''} ${t.start != null ? fromMin(t.start) + '発' : ''}）</div>
    <div class="drive-name">${esc(tp.from || '出発' + placeWord)} → ${esc(tp.to || '到着地')}</div>
    <div>${esc(t.info.name || '')} ${tp.number ? '<b>' + esc(tp.number) + '</b>' : ''} ${tp.platform ? '・のりば ' + esc(tp.platform) : ''}</div>
    ${bk && bk.bookingNo ? `<div class="small">予約番号：<b>${esc(bk.bookingNo)}</b></div>` : ''}
    ${at ? `<div class="countdown"><div class="muted small">出発まで</div><div class="cd-big" id="cdown" data-at="${at}">--:--</div></div>` : ''}
    ${tp.from ? `<a class="btn primary block" href="${mapsDirUrl({ name: tp.from, address: tp.from }, 'train')}" target="_blank" rel="noopener">🧭 ${esc(tp.from)}への行き方</a>` : ''}
    ${bk && bk.url ? `<a class="btn block mt" href="${esc(bk.url)}" target="_blank" rel="noopener">🔗 予約ページ</a>` : ''}
  </div>`;
}

// ---- 走行距離（出発／到着のメーター） ----
function odometerCard(trip) {
  const days = tripDays(trip);
  const today = days.includes(todayStr()) ? todayStr() : (days[0] || todayStr());
  const rec = (trip.odometer || []).find(o => o.date === today) || { date: today, depart: '', arrive: '' };
  const dist = rec.arrive !== '' && rec.depart !== '' && rec.arrive != null && rec.depart != null ? num(rec.arrive) - num(rec.depart) : null;
  return `<div class="card"><div class="row between"><b>🛣 走行距離（${fmtDate(today)}）</b><span class="muted small">旅の合計 ${totalDistance(trip).toLocaleString()}km</span></div>
    <div class="form-grid">
      <label>出発メーター</label><div class="row gap"><input inputmode="numeric" data-change="odo" data-f="depart" data-d="${today}" value="${esc(rec.depart)}" placeholder="km"><span>km</span></div>
      <label>到着メーター</label><div class="row gap"><input inputmode="numeric" data-change="odo" data-f="arrive" data-d="${today}" value="${esc(rec.arrive)}" placeholder="km"><span>km</span></div>
    </div>${dist != null ? `<div class="b">この日の走行：${dist.toLocaleString()}km</div>` : ''}
    ${(trip.odometer || []).filter(o => o.date !== today).map(o => `<div class="muted small">${fmtDate(o.date)}：${o.depart || '—'} → ${o.arrive || '—'}km</div>`).join('')}</div>`;
}
ON_CHANGE.odo = (el) => {
  const t = curTrip(); const d = el.dataset.d;
  let rec = t.odometer.find(o => o.date === d);
  if (!rec) { rec = { date: d, depart: '', arrive: '' }; t.odometer.push(rec); }
  rec[el.dataset.f] = el.value === '' ? '' : num(el.value);
  commitTrip(t);
};

// ---- 給油（お金タブへ流れる） ----
function fuelCard(trip) {
  return `<div class="card"><div class="row between"><b>⛽ 給油</b><button class="btn sm primary" data-act="fuelNew">＋ 給油を記録</button></div>
    ${trip.fuel.length ? trip.fuel.map(f => `<div class="list-row" data-act="fuelEdit" data-id="${f.id}"><span>${fmtDate(f.date)} ${f.liters ? f.liters + 'L' : ''} ${esc(f.station || '')}</span><b>${f.money && f.money.amount != null ? fmtMoney(num(f.money.amount), f.money.currency) : '—'}</b></div>`).join('') : '<div class="muted small">給油は記録するとお金タブの支出（給油）に自動で入ります</div>'}</div>`;
}
ACT.fuelNew = () => { const t = curTrip(); openFuelEditor(t, { id: uid('fu'), date: todayStr(), liters: '', unitPrice: '', odo: '', station: '', memo: '', money: newMoney(t, { method: (S.settings.payMethods.find(p => p.id === 'gas') || S.settings.payMethods.find(p => p.isCard) || {}).id || 'cash' }) }, true); };
ACT.fuelEdit = (el) => { const t = curTrip(); openFuelEditor(t, t.fuel.find(f => f.id === el.dataset.id)); };
function openFuelEditor(trip, f, isNew) {
  openModal(`<div class="form-grid">
    <label>日付</label><input type="date" id="fuDate" value="${esc(f.date)}">
    <label>給油量</label><div class="row gap"><input id="fuL" inputmode="decimal" value="${esc(f.liters)}" placeholder="L" data-input="fuCalc"><span>L</span></div>
    <label>単価</label><div class="row gap"><input id="fuUnit" inputmode="decimal" value="${esc(f.unitPrice)}" placeholder="円/L" data-input="fuCalc"><span>円/L</span></div>
    <label>メーター</label><div class="row gap"><input id="fuOdo" inputmode="numeric" value="${esc(f.odo)}" placeholder="km"><span>km</span></div>
    <label>スタンド</label><input id="fuSt" value="${esc(f.station)}">
    <label>金額</label><div>${moneyEditorHTML(trip, f.money)}</div>
    <label>メモ</label><input id="fuMemo" value="${esc(f.memo)}">
  </div><div class="row gap mt"><button class="btn primary grow" data-act="fuSave">保存</button>${!isNew ? '<button class="btn danger" data-act="fuDel">削除</button>' : ''}</div>`,
    { title: '⛽ 給油', full: true, data: { trip, f, isNew }, onMount: (b) => updateMoneyPreview($('.money-ed', b)) });
}
ON_INPUT.fuCalc = () => {
  const b = topModalBody(); const l = num($('#fuL', b).value, 0), u = num($('#fuUnit', b).value, 0);
  const amt = $('[data-mf="amount"]', b);
  if (l && u && (!amt.value || amt.dataset.auto)) { amt.value = Math.round(l * u); amt.dataset.auto = 1; updateMoneyPreview($('.money-ed', b)); }
};
ACT.fuSave = () => {
  const b = topModalBody(); const { trip, f, isNew } = topModal().data;
  Object.assign(f, { date: $('#fuDate', b).value, liters: $('#fuL', b).value, unitPrice: $('#fuUnit', b).value, odo: $('#fuOdo', b).value, station: $('#fuSt', b).value.trim(), memo: $('#fuMemo', b).value, money: readMoneyEditor(b) });
  if (f.money.amount == null) return toast('金額を入れてください');
  if (isNew) trip.fuel.push(f);
  closeModal(); commitTrip(trip); toast('給油を記録しました（お金タブに計上）');
};
ACT.fuDel = async () => { const { trip, f } = topModal().data; if (await confirmDialog('削除しますか？')) { trip.fuel = trip.fuel.filter(x => x !== f); closeModal(); commitTrip(trip); } };
