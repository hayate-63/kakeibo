// ============================================================================
// 13 行き先提案：勤務カレンダーの連休 × スポット帳の「行きたい」をエリアで束ねて3案
// ============================================================================
const SEASON_TAGS = {
  '春': [3, 4, 5], '夏': [6, 7, 8], '秋': [9, 10, 11], '冬': [12, 1, 2],
  '桜': [3, 4], '花見': [3, 4], '新緑': [4, 5], '紫陽花': [6], 'あじさい': [6], '海水浴': [7, 8], '花火': [7, 8], '海': [6, 7, 8, 9],
  '紅葉': [10, 11, 12], 'もみじ': [10, 11], '雪': [12, 1, 2], 'スキー': [12, 1, 2, 3], 'イルミネーション': [11, 12, 1, 2], '梅': [2, 3], '菜の花': [2, 3, 4], 'ひまわり': [7, 8], 'コスモス': [9, 10]
};
function seasonMonths(tags) {
  const ms = new Set();
  (tags || []).forEach(t => {
    const m = String(t).match(/^(\d{1,2})月$/);
    if (m) ms.add(Number(m[1]));
    if (SEASON_TAGS[t]) SEASON_TAGS[t].forEach(x => ms.add(x));
  });
  return ms;
}

ACT.openSuggest = () => {
  const st = { block: null, blocks: null, kind: 'one', moods: [], results: null, loading: false };
  const allTags = Array.from(new Set(Object.values(S.spots).flatMap(s => s.tags || []))).sort();
  openModal(`<div class="form-grid">
      <label>いつ頃</label><div><button class="btn sm" data-act="sgHolidays">📅 勤務カレンダーから連休を探す</button><div id="sgBlocks" class="chips mt"></div>
        <div class="row gap mt"><input type="date" id="sgS"><span>〜</span><input type="date" id="sgE"></div></div>
      <label>何日</label>${segHTML('sgKind', [{ v: 'day', l: '日帰り' }, { v: 'one', l: '1泊' }, { v: 'multi', l: '2泊以上' }], 'one', 'segPick')}
      <label>誰と</label>${membersEditorHTML([{ id: uid('m'), name: S.settings.myName, isMe: true }])}
      <label>予算</label>${amountFieldHTML('id="sgBudget"', '', '総額（円）')}
      <label>気分</label><div class="chips" id="sgMoods">${allTags.length ? allTags.map(t => `<label class="chip"><input type="checkbox" value="${esc(t)}"><span>${esc(t)}</span></label>`).join('') : '<span class="muted small">スポット帳のタグがありません</span>'}</div>
    </div>
    <button class="btn primary block mt" data-act="sgRun">🔍 3案を探す</button>
    <div id="sgResults"></div>`, { title: '🧭 行き先を探す', full: true, data: { st } });
  if (S.spotsState !== 'ok') loadSpots(true);
};
ACT.sgHolidays = async (el) => {
  const b = topModalBody(); const box = $('#sgBlocks', b);
  box.innerHTML = '<span class="muted small">勤務カレンダーを確認中…</span>';
  try {
    const from = addDays(todayStr(), 1), to = addDays(todayStr(), 120);
    const r = await api('holidayBlocks', { from, to });
    const blocks = [];
    let cur = null;
    r.days.forEach(d => {
      if (d.off) { if (cur && addDays(cur.end, 1) === d.date) cur.end = d.date; else { cur = { start: d.date, end: d.date }; blocks.push(cur); } }
    });
    blocks.forEach(x => x.len = diffDays(x.start, x.end) + 1);
    const good = blocks.filter(x => x.len >= 2).slice(0, 12);
    topModal().data.st.blocks = good;
    box.innerHTML = good.length ? good.map((x, i) => `<button class="chip-btn" data-act="sgPickBlock" data-i="${i}">${fmtDate(x.start)}〜${fmtDate(x.end)}（${x.len}連休）</button>`).join('') + `<div class="muted small">参照：${esc(r.source || '')}</div>`
      : '<span class="muted small">連休が見つかりませんでした</span>';
  } catch (e) { box.innerHTML = `<span class="warn small">取得できません：${esc(e.message)}</span>`; }
};
ACT.sgPickBlock = (el) => {
  const b = topModalBody(); const st = topModal().data.st;
  const x = st.blocks[Number(el.dataset.i)];
  $$('#sgBlocks .chip-btn', b).forEach(c => c.classList.toggle('on', c === el));
  $('#sgS', b).value = x.start; $('#sgE', b).value = x.end;
  const kind = x.len >= 3 ? 'multi' : 'one';
  $$('.seg-btn[data-name="sgKind"]', b).forEach(btn => btn.classList.toggle('on', btn.dataset.v === kind));
};
ACT.sgRun = async () => {
  const b = topModalBody(); const st = topModal().data.st;
  const cond = {
    start: $('#sgS', b).value || null, end: $('#sgE', b).value || null,
    kind: segValue(b, 'sgKind') || 'one',
    members: readMembersEditor(b),
    budget: $('#sgBudget', b).value ? num($('#sgBudget', b).value) : null,
    moods: $$('#sgMoods input', b).filter(x => x.checked).map(x => x.value)
  };
  st.cond = cond;
  const out = $('#sgResults', b);
  out.innerHTML = '<div class="muted pad">候補を計算中…</div>';
  if (S.spotsState !== 'ok') await loadSpots(true);
  try {
    st.results = await computeSuggestions(cond);
    out.innerHTML = st.results.length ? st.results.map((r, i) => suggestionCardHTML(r, i, cond)).join('') : emptyHTML('🤔', '条件に合う案がありません。気分や日数を変えてみてください（スポット帳の「行きたい」が材料です）');
  } catch (e) { out.innerHTML = `<div class="warn-box">${esc(e.message)}</div>`; }
};

async function computeSuggestions(cond) {
  const home = S.settings.home;
  const people = Math.max(1, cond.members.length);
  const days = cond.kind === 'day' ? 1 : cond.kind === 'one' ? 2 : 3;
  const candDays = cond.start ? dateRange(cond.start, cond.end || cond.start) : [];
  const month = cond.start ? parseYmd(cond.start).getMonth() + 1 : ((new Date().getMonth() + 1) % 12) + 1;
  let spots = Object.values(S.spots).filter(s => s.status !== 'visited' && s.lat != null);
  // その時期に行けないもの（候補日すべて定休）は落とす、旬でないものは順位を下げる
  spots = spots.map(s => {
    const h = parseHours(S.hours[s.id] ? S.hours[s.id].week : null);
    const closedAll = candDays.length && candDays.every(d => dayAvailability(h, d) === 'closed');
    const sm = seasonMonths(s.tags);
    const season = sm.size ? (sm.has(month) ? 1 : -1) : 0;
    const mood = cond.moods.length ? (s.tags || []).filter(t => cond.moods.includes(t)).length : 0;
    return Object.assign({}, s, { _closedAll: closedAll, _season: season, _mood: mood });
  }).filter(s => !s._closedAll);
  // エリア単位に束ねる（スポット帳のエリア名、無ければ半径25kmで集める）
  const groups = {};
  const noArea = [];
  spots.forEach(s => { if (s.area) (groups[s.area] = groups[s.area] || []).push(s); else noArea.push(s); });
  noArea.sort((a, b) => (b.priority === 'must') - (a.priority === 'must'));
  const used = new Set();
  noArea.forEach(seed => {
    if (used.has(seed.id)) return;
    const g = noArea.filter(s => !used.has(s.id) && haversineKm(seed, s) <= 25);
    g.forEach(s => used.add(s.id));
    const label = (seed.address || '').match(/^(.+?[都道府県])?(.+?[市町村区郡])/);
    groups[(label ? (label[2] || label[1]) : seed.name) + '周辺'] = g;
  });
  let clusters = Object.keys(groups).map(area => {
    const ss = groups[area];
    const c = { lat: sum(ss, s => s.lat) / ss.length, lng: sum(ss, s => s.lng) / ss.length };
    const km = haversineKm(home, c);
    return { area, spots: ss, center: c, km, oneway: estimateMinutes(km, 'car') };
  });
  // 片道時間を経路で確認（上位のみ）
  try {
    const top = clusters.slice().sort((a, b) => a.km - b.km).slice(0, 12);
    const r = await api('routes', { list: top.map(c => ({ from: { lat: home.lat, lng: home.lng }, to: c.center, mode: 'car', opt: { highway: true, toll: true } })) });
    (r.results || []).forEach((res, i) => { if (res) { top[i].oneway = res.min; top[i].roadKm = res.km; top[i].toll = res.toll; top[i].routeEstimated = !!res.estimated; } });
  } catch (e) { /* 概算のまま */ }
  const range = { day: [0, 150], one: [45, 300], multi: [90, 600] }[cond.kind];
  const within = (c, k) => c.oneway >= range[0] && c.oneway <= range[1] * k;
  let fit = clusters.filter(c => within(c, 1));
  let relaxed = false;
  if (fit.length < 3) { fit = clusters.filter(c => within(c, 1.4)); relaxed = true; }
  if (cond.moods.length) fit = fit.filter(c => c.spots.some(s => s._mood));
  const scored = fit.map(c => {
    const core = c.spots.slice().sort((a, b) => (b.priority === 'must') - (a.priority === 'must') || b._mood - a._mood || b._season - a._season || (b.stayMin || 0) - (a.stayMin || 0)).slice(0, 5);
    const must = c.spots.filter(s => s.priority === 'must').length;
    const score = must * 3 + c.spots.length + sum(c.spots, s => s._mood) * 2 + sum(c.spots, s => s._season) * 1.5;
    const cost = estimateCost(c, core, days, people);
    const stayMin = sum(core, s => s.stayMin || 60);
    let inner = 0;
    for (let k = 1; k < core.length; k++) inner += estimateMinutes(haversineKm(core[k - 1], core[k]), 'car');
    const needDays = Math.max(1, Math.ceil((stayMin + inner + c.oneway * 2) / 600));
    return Object.assign(c, { core, must, score, cost, needDays, course: modelCourse(c, core, days), relaxed, overBudget: cond.budget != null && cost.total > cond.budget });
  });
  scored.sort((a, b) => (b.must > 0) - (a.must > 0) || (a.overBudget - b.overBudget) || b.score - a.score);
  return scored.slice(0, 3);
}
function estimateCost(c, core, days, people) {
  const st = S.settings;
  const roadKm = (c.roadKm || c.km * 1.35) * 2 + 30 * days;
  const fuel = Math.round(roadKm / num(st.fuelEfficiency, 15) * num(st.fuelPrice, 170));
  const toll = c.toll != null ? c.toll * 2 : (c.oneway > 60 ? Math.round((150 + c.km * 1.35 * 0.7 * 24.6) / 10) * 10 * 2 : 0);
  const entry = sum(core, s => num(s.price, 0)) * people;
  const meals = (days === 1 ? 2 : days * 2) * num(st.mealPerPerson, 1500) * people;
  const lodging = (days - 1) * num(st.lodgingPerPerson, 10000) * people;
  const transport = fuel + toll;
  const total = transport + entry + meals + lodging;
  return { transport, fuel, toll, entry, meals, lodging, total, perPerson: Math.round(total / people) };
}
function modelCourse(c, core, days) {
  const home = S.settings.home;
  const left = core.slice();
  const order = [];
  let cur = home;
  while (left.length) {
    left.sort((a, b) => haversineKm(cur, a) - haversineKm(cur, b));
    cur = left.shift(); order.push(cur);
  }
  const per = Math.ceil(order.length / days);
  const out = [];
  for (let d = 0; d < days; d++) {
    const part = order.slice(d * per, (d + 1) * per);
    const names = part.map(s => s.name);
    if (d === 0) names.unshift('自宅');
    if (d === days - 1) names.push('自宅');
    else names.push('（宿）');
    out.push({ day: d + 1, flow: names.join(' → ') });
  }
  return out;
}
function suggestionCardHTML(r, i, cond) {
  const cost = r.cost;
  return `<div class="card sg">
    <div class="row between"><div class="h2">${['🥇', '🥈', '🥉'][i] || ''} ${esc(r.area)}</div><span class="muted small">片道 ${r.routeEstimated !== false && !r.roadKm ? '約' : ''}${fmtDuration(r.oneway)}</span></div>
    ${r.relaxed ? '<div class="muted small">※ 日数の範囲を少し広げて探しました</div>' : ''}
    <div class="b mt">核になるスポット</div>
    <div>${r.core.map(s => `<span class="tag ${s.priority === 'must' ? 'must' : ''}">${s.priority === 'must' ? '⭐' : ''}${esc(s.name)}${s._season < 0 ? '（旬外）' : ''}</span>`).join(' ')}</div>
    <div class="b mt">モデルコース</div>
    ${r.course.map(c => `<div class="small">${c.day}日目：${esc(c.flow)}</div>`).join('')}
    <div class="b mt">概算費用 <span class="h3">${fmtMoney(cost.total)}</span> <span class="muted small">（1人 ${fmtMoney(cost.perPerson)}）</span> ${r.overBudget ? '<span class="tag warn">予算オーバー</span>' : cond.budget != null ? '<span class="tag ok">予算内</span>' : ''}</div>
    <div class="muted small">交通 ${fmtMoney(cost.transport)}（ガソリン${fmtMoney(cost.fuel)}＋高速${fmtMoney(cost.toll)}）・入場 ${fmtMoney(cost.entry)}・食費 ${fmtMoney(cost.meals)}${cost.lodging ? '・宿 ' + fmtMoney(cost.lodging) : ''}</div>
    <div class="small">必要日数の目安：${r.needDays}日</div>
    <button class="btn primary block mt" data-act="sgCreate" data-i="${i}">この案で「検討中」の旅を作る</button></div>`;
}
ACT.sgCreate = (el) => {
  const { st } = topModal().data;
  const r = st.results[Number(el.dataset.i)]; const cond = st.cond;
  const trip = newTrip({ title: r.area + 'の旅', area: r.area, members: cond.members.length ? cond.members : undefined, budget: cond.budget, mode: 'list', vehicles: ['car'] });
  trip.memo = (cond.start ? '候補日：' + fmtDate(cond.start) + '〜' + fmtDate(cond.end || cond.start) + '\n' : '') + '行き先提案から作成（' + ({ day: '日帰り', one: '1泊', multi: '2泊以上' }[cond.kind]) + '・概算 ' + fmtMoney(r.cost.total) + '）\n' + r.course.map(c => c.day + '日目：' + c.flow).join('\n');
  r.core.forEach((s, k) => trip.items.push(newItem({ spotId: s.id, nameCache: s.name, priority: s.priority || 'maybe', stay: s.stayMin || 60, order: (k + 1) * 1000 })));
  S.curTripId = trip.id;
  commitTrip(trip);
  closeModal();
  switchTab('shiori');
  toast('「' + trip.title + '」を検討中として作りました。日程を入れると計画中になります');
};
