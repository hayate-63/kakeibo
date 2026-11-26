// ============================================================================
// 17 v2.2 しおり・精算の画像書き出し（B-1・B-2）
//   描く中身（文字・行）は純粋な関数で作り（テストできる）、Canvas への描画は別の関数に分ける。
//   見た目は 15_visual.js の VTHEME（トラベルマガジン風）、書き出しは exportCanvases（共有シート／画像一覧）を使う
// ============================================================================
const EXP_W = 1080;
const EXP_916_H = 1920;
const EXP_TALL_MAX = 8000;   // 縦長の1枚の高さの上限（1080×8000 ≒ 860万画素）
const EXP_MONO = '"SF Mono", Menlo, Consolas, "Courier New", monospace';
const PRI_MARK = { must: '⭐', maybe: '☆' };

// ---------------------------------------------------------------------------
// B-1 しおり：中身
// ---------------------------------------------------------------------------
function shioriExportDefaults(trip) {
  const days = tripDays(trip);
  const dayOn = {};
  days.forEach(d => { dayOn[d] = dayItems(trip, d).length > 0; });
  return { cover: true, days: dayOn, list: trip.mode === 'list', privacy: false, size: '916' };
}
function itemMoveIcon(trip, it) {
  if (it.kind === 'move' && it.transport && VEHICLES[it.transport.mode]) return VEHICLES[it.transport.mode].icon;
  const m = (it.moveInfo && it.moveInfo.mode) || (trip.listTransport && trip.listTransport.mode) || 'car';
  return m === 'walk' ? '🚶' : (VEHICLES[m] ? VEHICLES[m].icon : '🚗');
}
// 日別の行（プライバシー ON の時は 料金目安・予約番号・メモ を入れない）
function shioriDayRows(trip, date, privacy) {
  const rows = daySchedule(trip, date);
  return rows.map((r, i) => {
    const it = r.it, info = r.info;
    const b = it.bookingId ? (trip.bookings || []).find(x => x.id === it.bookingId) : null;
    const o = {
      no: i + 1, start: fmtMinLabel(Math.round(r.start)), end: fmtMinLabel(Math.round(r.end)), name: info.name,
      locked: !!it.locked, stay: Math.round(r.stay), kind: it.kind, visited: !!it.visited,
      price: null, bookingNo: '', memo: '', move: null
    };
    if (!privacy) {
      if (info.price != null && info.price !== '' && it.kind !== 'move') o.price = Number(info.price) === 0 ? '無料' : fmtMoney(Number(info.price), 'JPY');
      if (b && b.bookingNo) o.bookingNo = String(b.bookingNo);
      if (it.memo) o.memo = String(it.memo);
    }
    if (i < rows.length - 1 && r.move > 0) {
      const mi = it.moveInfo || {};
      o.move = { icon: itemMoveIcon(trip, it), min: Math.round(r.move), km: mi.km != null ? fmtKm(Number(mi.km)) : '' };
    }
    return o;
  });
}
function shioriListRows(trip) {
  return sortListItems(trip, unscheduledItems(trip).filter(i => !i.visited)).map(it => {
    const info = itemInfo(trip, it);
    return { pri: (it.priority || info.priority) === 'must' ? 'must' : 'maybe', name: info.name, area: info.area || '', hours: info.hours && info.hours.known ? hoursSummary(info.hours) : (info.hoursText || '') };
  });
}
function shioriDaySummary(trip, date) {
  const names = dayItems(trip, date).filter(i => i.kind !== 'move').map(i => itemInfo(trip, i).name);
  if (!names.length) return '';
  const short = names.map(n => n.length > 10 ? n.slice(0, 9) + '…' : n);
  return short.length > 4 ? short.slice(0, 4).join(' → ') + ` ほか${short.length - 4}件` : short.join(' → ');
}
// 1行ぶんの高さ（9:16 の分割・縦長の高さの計算に使う。描画と同じ数字）
function memoLines(row) { return row.memo ? Math.min(2, Math.ceil(row.memo.replace(/\s+/g, ' ').length / 20)) : 0; }
function shioriRowHeight(row, scale) {
  const k = scale || 1;
  let h = 118;
  if (row.price || row.bookingNo) h += 40;
  h += 40 * memoLines(row);
  if (row.move) h += 70;
  return Math.round(h * k);
}
const EXP_HEAD_H = 360, EXP_FOOT_H = 150;
// ページの割り付け。9:16 は「文字を少し小さく（最小 0.82 倍）」→ それでも入らなければ複数枚に分ける
function shioriExportPages(trip, opt) {
  opt = Object.assign(shioriExportDefaults(trip), opt || {});
  const pages = [];
  if (opt.cover) pages.push({ type: 'cover', h: EXP_916_H });
  tripDays(trip).forEach((d, i) => {
    if (!opt.days[d]) return;
    const rows = shioriDayRows(trip, d, opt.privacy);
    if (!rows.length) return;
    const body = rows.reduce((s, r) => s + shioriRowHeight(r), 0);
    if (opt.size === 'tall' && EXP_HEAD_H + body + EXP_FOOT_H <= EXP_TALL_MAX) { pages.push({ type: 'day', date: d, index: i + 1, rows, scale: 1, part: 1, parts: 1, h: Math.max(EXP_916_H, EXP_HEAD_H + body + EXP_FOOT_H) }); return; }
    if (opt.size === 'tall') {   // iPhone の Canvas の上限（約1,670万画素）に近づかないよう、極端に長い日は 8000px ごとに分ける
      const chunks = []; let cur = [], used = 0; const lim = EXP_TALL_MAX - EXP_HEAD_H - EXP_FOOT_H;
      rows.forEach(r => { const rh = shioriRowHeight(r); if (cur.length && used + rh > lim) { chunks.push(cur); cur = []; used = 0; } cur.push(r); used += rh; });
      if (cur.length) chunks.push(cur);
      chunks.forEach((c, k) => pages.push({ type: 'day', date: d, index: i + 1, rows: c, scale: 1, part: k + 1, parts: chunks.length, h: Math.max(EXP_916_H, EXP_HEAD_H + c.reduce((s2, r) => s2 + shioriRowHeight(r), 0) + EXP_FOOT_H) }));
      return;
    }
    const avail = EXP_916_H - EXP_HEAD_H - EXP_FOOT_H;
    if (body <= avail) { pages.push({ type: 'day', date: d, index: i + 1, rows, scale: 1, part: 1, parts: 1, h: EXP_916_H }); return; }
    if (body * 0.82 <= avail) { pages.push({ type: 'day', date: d, index: i + 1, rows, scale: Math.max(0.82, avail / body), part: 1, parts: 1, h: EXP_916_H }); return; }
    const chunks = []; let cur = [], used = 0;
    rows.forEach(r => { const rh = shioriRowHeight(r, 0.82); if (cur.length && used + rh > avail) { chunks.push(cur); cur = []; used = 0; } cur.push(r); used += rh; });
    if (cur.length) chunks.push(cur);
    chunks.forEach((c, k) => pages.push({ type: 'day', date: d, index: i + 1, rows: c, scale: 0.82, part: k + 1, parts: chunks.length, h: EXP_916_H }));
  });
  if (opt.list) {
    const rows = shioriListRows(trip);
    if (rows.length) {
      const per = 9;
      if (opt.size === 'tall' && EXP_HEAD_H + rows.length * 150 + EXP_FOOT_H <= EXP_TALL_MAX) pages.push({ type: 'list', rows, part: 1, parts: 1, h: Math.max(EXP_916_H, EXP_HEAD_H + rows.length * 150 + EXP_FOOT_H) });
      else for (let k = 0; k * per < rows.length; k++) pages.push({ type: 'list', rows: rows.slice(k * per, k * per + per), part: k + 1, parts: Math.ceil(rows.length / per), h: EXP_916_H });
    }
  }
  return pages;
}

// ---------------------------------------------------------------------------
// B-1 しおり：描画
// ---------------------------------------------------------------------------
function expCanvas(h) { const c = document.createElement('canvas'); c.width = EXP_W; c.height = h; return c; }
function expFooter(ctx, trip, H) {
  const th = VTHEME;
  ctx.fillStyle = th.sub; ctx.font = `500 28px ${th.sans}`;
  ctx.fillText(trip.title.length > 28 ? trip.title.slice(0, 27) + '…' : trip.title, 80, H - 70);
  ctx.fillStyle = th.accent; ctx.font = `600 28px ${th.sans}`;
  ctx.textAlign = 'right'; ctx.fillText('旅帳', EXP_W - 80, H - 70); ctx.textAlign = 'left';
}
function expFit(ctx, text, maxW) { let t = String(text); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1); return t + '…'; }
function renderShioriCover(trip) {
  const th = VTHEME, c = expCanvas(EXP_916_H), ctx = c.getContext('2d');
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, EXP_W, EXP_916_H);
  ctx.fillStyle = th.accent; ctx.font = `600 34px ${th.sans}`; ctx.letterSpacing = '8px'; ctx.fillText('TRAVEL ITINERARY', 80, 150); ctx.letterSpacing = '0px';
  // 大きい英語タイトル（英語にできていない＝日本語が残る時は、旅のタイトルを大きく出して重複させない）
  const en = displayTitleEn(trip);
  const enOk = en && !/[\u3040-\u30ff\u3400-\u9fff]/.test(en);
  const big = enOk ? en : trip.title;
  let size = enOk ? 120 : 96; ctx.fillStyle = th.ink; ctx.font = `700 ${size}px ${enOk ? th.serif : th.sans}`;
  let lines = wrapText(ctx, big, EXP_W - 160);
  while (lines.length > 2 && size > 64) { size -= 8; ctx.font = `700 ${size}px ${enOk ? th.serif : th.sans}`; lines = wrapText(ctx, big, EXP_W - 160); }
  let y = 300; lines.slice(0, 3).forEach(l => { ctx.fillText(l, 80, y); y += size * 1.05; });
  if (enOk) { ctx.font = `700 56px ${th.sans}`; wrapText(ctx, trip.title, EXP_W - 160).slice(0, 2).forEach(l => { y += 10; ctx.fillText(l, 80, y + 40); y += 66; }); }
  y += 70;
  const n = nights(trip), days = tripDays(trip);
  const facts = [
    ['📅', trip.startDate ? fmtDateFull(trip.startDate) + (trip.endDate && trip.endDate !== trip.startDate ? ' 〜 ' + fmtDateFull(trip.endDate) : '') : '日程未定'],
    ['🗓', days.length ? (n ? `${n}泊${days.length}日` : '日帰り') : ''],
    ['👥', trip.members.map(m => m.name).join('・')],
    ['📍', trip.area || ''],
    ['', (trip.vehicles || []).map(v => VEHICLES[v] ? VEHICLES[v].icon + ' ' + VEHICLES[v].label : '').join('　')]
  ].filter(f => f[1]);
  ctx.font = `500 40px ${th.sans}`; ctx.fillStyle = th.ink;
  facts.forEach(([ic, tx]) => { ctx.fillText(expFit(ctx, (ic ? ic + '  ' : '') + tx, EXP_W - 160), 80, y); y += 64; });
  y += 30; ctx.strokeStyle = th.accent; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(80, y); ctx.lineTo(EXP_W - 80, y); ctx.stroke(); y += 70;
  let shown = 0;
  days.forEach((d, i) => {
    if (y > EXP_916_H - 220) return;
    shown++;
    const s = shioriDaySummary(trip, d);
    ctx.fillStyle = th.accent; ctx.font = `700 34px ${th.sans}`; ctx.fillText('DAY ' + (i + 1), 80, y);
    ctx.fillStyle = th.sub; ctx.font = `500 30px ${th.sans}`; ctx.fillText(fmtDate(d), 230, y);
    ctx.fillStyle = th.ink; ctx.font = `400 34px ${th.sans}`;
    wrapText(ctx, s || '（予定なし）', EXP_W - 160).slice(0, 2).forEach((l, k) => ctx.fillText(l, 80, y + 52 + k * 46));
    y += 52 + 46 * Math.min(2, wrapText(ctx, s || '（予定なし）', EXP_W - 160).length) + 40;
  });
  if (shown < days.length) { ctx.fillStyle = th.sub; ctx.font = `500 30px ${th.sans}`; ctx.fillText(`ほか ${days.length - shown}日`, 80, Math.min(y, EXP_916_H - 150)); }
  expFooter(ctx, trip, EXP_916_H);
  return c;
}
function renderShioriDay(trip, p) {
  const th = VTHEME, H = p.h, c = expCanvas(H), ctx = c.getContext('2d'), k = p.scale || 1;
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, EXP_W, H);
  ctx.fillStyle = th.accent; ctx.font = `700 46px ${th.sans}`; ctx.letterSpacing = '6px'; ctx.fillText('DAY ' + p.index + (p.parts > 1 ? `  (${p.part}/${p.parts})` : ''), 80, 140); ctx.letterSpacing = '0px';
  ctx.fillStyle = th.ink; ctx.font = `700 72px ${th.serif}`; ctx.fillText(fmtDateFull(p.date), 80, 240);
  const wp = trip.items.map(i => itemPoint(trip, i)).find(Boolean) || trip.origin;
  const wl = wp && wp.lat != null ? S.weatherCache[weatherKey(wp)] : null;   // v2.2.1：キャッシュを読むだけ（描画中に通信を始めない）
  const w = wl ? wl.find(x => x.date === p.date) : null;
  if (w) { ctx.font = `500 38px ${th.sans}`; ctx.fillStyle = th.sub; ctx.fillText(`${WEATHER_ICON(w.code)} ${Math.round(w.tmax)}°/${Math.round(w.tmin)}°${w.pop != null ? '  ☔' + w.pop + '%' : ''}`, 80, 300); }
  let y = EXP_HEAD_H;
  const X = 80, R = 34 * k, TX = X + R * 2 + 30;
  p.rows.forEach(r => {
    const top = y;
    // 丸の番号
    ctx.fillStyle = r.locked ? th.ink : th.accent;
    ctx.beginPath(); ctx.arc(X + R, top + R + 4, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${Math.round(34 * k)}px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText(String(r.no), X + R, top + R + 16 * k); ctx.textAlign = 'left';
    ctx.fillStyle = th.sub; ctx.font = `600 ${Math.round(32 * k)}px ${EXP_MONO}`;
    ctx.fillText(`${r.start}–${r.end}`, TX, top + 30 * k);
    ctx.fillStyle = th.ink; ctx.font = `700 ${Math.round(44 * k)}px ${th.sans}`;
    const nm = (r.locked ? '🔒 ' : '') + (r.visited ? '✅ ' : '') + r.name;
    ctx.fillText(expFit(ctx, nm, EXP_W - TX - 80), TX, top + 84 * k);
    ctx.fillStyle = th.sub; ctx.font = `500 ${Math.round(30 * k)}px ${th.sans}`; ctx.textAlign = 'right';
    if (r.stay && r.kind !== 'move') ctx.fillText(`滞在 ${fmtDuration(r.stay)}`, EXP_W - 80, top + 30 * k);
    ctx.textAlign = 'left';
    let yy = top + 118 * k;
    if (r.price || r.bookingNo) {
      ctx.fillStyle = th.sub; ctx.font = `400 ${Math.round(30 * k)}px ${th.sans}`;
      ctx.fillText([r.price ? '目安 ' + r.price : '', r.bookingNo ? '予約番号 ' + r.bookingNo : ''].filter(Boolean).join('　'), TX, yy + 8 * k); yy += 40 * k;
    }
    if (r.memo) {
      ctx.fillStyle = th.sub; ctx.font = `400 ${Math.round(30 * k)}px ${th.serif}`;
      const ml = memoLines(r), wl2 = wrapText(ctx, r.memo.replace(/\s+/g, ' '), EXP_W - TX - 80);
      wl2.slice(0, ml).forEach((l, j) => { ctx.fillText(j === ml - 1 && wl2.length > ml ? expFit(ctx, l + '…', EXP_W - TX - 80) : l, TX, yy + 8 * k); yy += 40 * k; });
    }
    if (r.move) {
      ctx.strokeStyle = th.accent; ctx.setLineDash([6, 8]); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(X + R, top + R * 2 + 8); ctx.lineTo(X + R, top + shioriRowHeight(r, k) - 8); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = th.accent; ctx.font = `600 ${Math.round(30 * k)}px ${th.sans}`;
      ctx.fillText(`${r.move.icon}  ${fmtDuration(r.move.min)}${r.move.km ? '・' + r.move.km : ''}`, TX, yy + 44 * k);
      yy += 70 * k;
    }
    y = top + shioriRowHeight(r, k);
  });
  expFooter(ctx, trip, H);
  return c;
}
function renderShioriList(trip, p) {
  const th = VTHEME, H = p.h, c = expCanvas(H), ctx = c.getContext('2d');
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, EXP_W, H);
  ctx.fillStyle = th.accent; ctx.font = `700 46px ${th.sans}`; ctx.letterSpacing = '6px'; ctx.fillText('WISH LIST' + (p.parts > 1 ? `  (${p.part}/${p.parts})` : ''), 80, 140); ctx.letterSpacing = '0px';
  ctx.fillStyle = th.ink; ctx.font = `700 64px ${th.serif}`; ctx.fillText('行きたい場所', 80, 240);
  let y = EXP_HEAD_H - 40;
  p.rows.forEach(r => {
    ctx.fillStyle = '#fffaf0'; ctx.fillRect(80, y, EXP_W - 160, 130);
    ctx.strokeStyle = '#e7dccb'; ctx.lineWidth = 2; ctx.strokeRect(80, y, EXP_W - 160, 130);
    ctx.fillStyle = r.pri === 'must' ? th.accent : th.sub; ctx.font = `700 40px ${th.sans}`; ctx.fillText(PRI_MARK[r.pri], 104, y + 56);
    ctx.fillStyle = th.ink; ctx.font = `700 40px ${th.sans}`; ctx.fillText(expFit(ctx, r.name, EXP_W - 340), 170, y + 56);
    ctx.fillStyle = th.sub; ctx.font = `400 28px ${th.sans}`;
    ctx.fillText(expFit(ctx, [r.area, r.hours].filter(Boolean).join('　') || '　', EXP_W - 290), 170, y + 104);
    y += 150;
  });
  ctx.fillStyle = th.sub; ctx.font = `400 26px ${th.sans}`; ctx.fillText('⭐ 絶対行きたい　☆ 行けたら', 80, H - 120);
  expFooter(ctx, trip, H);
  return c;
}
function renderShioriPage(trip, p) { return p.type === 'cover' ? renderShioriCover(trip) : p.type === 'day' ? renderShioriDay(trip, p) : renderShioriList(trip, p); }

// ---------------------------------------------------------------------------
// B-1 しおり：書き出しの画面
// ---------------------------------------------------------------------------
ACT.shioriExport = () => {   // 閉じる時にプレビューのキャンバスを解放
  const t = curTrip(); if (!t) return;
  const o = shioriExportDefaults(t);
  const days = tripDays(t);
  openModal(`<div class="exp-opts">
    <div class="b">出力するもの</div>
    <label class="check"><input type="checkbox" id="seCover" ${o.cover ? 'checked' : ''}> 表紙</label>
    ${days.map((d, i) => `<label class="check"><input type="checkbox" class="seDay" data-d="${d}" ${o.days[d] ? 'checked' : ''}> ${i + 1}日目 ${fmtDate(d)}（${dayItems(t, d).length}件）</label>`).join('')}
    <label class="check"><input type="checkbox" id="seList" ${o.list ? 'checked' : ''}> 未配置の「行きたい場所」（${unscheduledItems(t).filter(i => !i.visited).length}件）</label>
    <div class="b mt">プライバシー</div>
    <label class="check"><input type="checkbox" id="sePriv"> 🔒 金額・予約番号・メモを隠す（LINE のグループに送る時など）</label>
    <div class="b mt">画像のサイズ</div>
    ${segHTML('seSize', [{ v: '916', l: '9:16（1080×1920）' }, { v: 'tall', l: '縦長（1日1枚に収める）' }], '916', 'seSize')}
    <div class="muted small">9:16 で予定が多い日は、文字を少し小さくし、それでも入らなければ複数枚に分けます</div>
  </div>
  <div id="sePrev" class="exp-prev"></div>
  <button class="btn primary block mt" data-act="seExport" id="seBtn">📤 書き出す</button>`, { title: '📤 しおりを画像で書き出し', data: { t, size: '916' }, onMount: () => sePreview(), onClose: () => $$('#sePrev canvas').forEach(releaseCanvas) });
};
function seOptions() {
  const b = topModalBody(); const m = topModal();
  const days = {}; $$('.seDay', b).forEach(x => { days[x.dataset.d] = x.checked; });
  return { cover: $('#seCover', b).checked, days, list: $('#seList', b).checked, privacy: $('#sePriv', b).checked, size: m.data.size };
}
ACT.seSize = (el) => { topModal().data.size = el.dataset.v; $$('.seg-btn[data-act="seSize"]', topModalBody()).forEach(x => x.classList.toggle('on', x === el)); sePreview(); };
ON_CHANGE.seOpt = () => sePreview();
// v2.2.1 H-1：プレビューは「最後に頼まれた分」だけ作る（フォント待ちの間に設定を変えたら古い方は捨てる）。
// 大きいキャンバスは縮小に写したらすぐ解放、古い縮小も解放してから入れ替える
function previewInto(prev, pages, render) {
  $$('canvas', prev).forEach(releaseCanvas);
  prev.innerHTML = pages.map((p, i) => `<canvas class="exp-thumb" data-i="${i}" width="216" height="${Math.round(p.h / 5)}"></canvas>`).join('');
  pages.forEach((p, i) => {
    let big = null;
    try { big = render(p); const cv = prev.querySelector(`canvas[data-i="${i}"]`); if (cv) cv.getContext('2d').drawImage(big, 0, 0, cv.width, cv.height); }
    catch (e) { console.error(e); toast('プレビューの作成に失敗：' + e.message); }
    finally { releaseCanvas(big); }
  });
}
async function sePreview() {
  const m = topModal(); if (!m) return;
  const gen = (m.data.gen = (m.data.gen || 0) + 1);
  const b = topModalBody();
  $$('input[type="checkbox"]', b).forEach(x => { x.dataset.change = 'seOpt'; });
  const pages = shioriExportPages(m.data.t, seOptions());
  m.data.pages = pages;
  const btn = $('#seBtn', b);
  if (btn) { btn.textContent = pages.length ? `📤 ${pages.length}枚を書き出す` : '書き出すものがありません'; btn.disabled = !pages.length; }
  const prev = $('#sePrev', b); if (!prev) return;
  await ensureFonts();
  if (topModal() !== m || m.data.gen !== gen) return;
  previewInto(prev, pages, p => renderShioriPage(m.data.t, p));
}
ACT.seExport = async (el) => {
  const m = topModal(); const t = m.data.t;
  const pages = shioriExportPages(t, seOptions());
  if (!pages.length) return toast('書き出すものを選んでください');
  el.disabled = true; el.textContent = '書き出し中…';
  try {
    await ensureFonts();
    const cs = pages.map(p => renderShioriPage(t, p));
    const files = await exportCanvases(cs, (displayTitleEn(t) || 'TRIP').replace(/\s+/g, '_') + '_PLAN', 'しおりの画像');
    toast(files.length + '枚を書き出しました');
  } catch (e) { toast('書き出しに失敗：' + e.message); }
  el.disabled = false; el.textContent = `📤 ${pages.length}枚を書き出す`;
};

// ---------------------------------------------------------------------------
// B-2 精算レシート：中身（行のリスト）。computeTransfers と同じ計算結果だけを使う
// ---------------------------------------------------------------------------
function settleReceiptLines(trip, opt, tr) {
  opt = Object.assign({ breakdown: true }, opt || {});
  const { transfers, bal, unit } = computeTransfers(trip);
  const cur = trip.currency;
  const L = [];
  const range = trip.startDate ? fmtDateFull(trip.startDate) + (trip.endDate && trip.endDate !== trip.startDate ? ' 〜 ' + fmtDateFull(trip.endDate) : '') : '';
  if (!tr) {
    L.push({ k: 'head', t: 'SETTLEMENT RECEIPT' }, { k: 'title', t: trip.title }, { k: 'sub', t: range }, { k: 'sub', t: '精算通貨 ' + cur }, { k: 'perf' });
    const total = Object.values(bal).reduce((s, b) => s + b.paid, 0) / unit;
    const n = trip.members.length || 1;
    L.push({ k: 'kv', l: '支出の総額', v: fmtMoney(total, cur) }, { k: 'kv', l: `1人あたり目安（${n}人）`, v: fmtMoney(roundCur(total / n, cur), cur) }, { k: 'perf' });
    if (!transfers.length) L.push({ k: 'none', t: '✅ 精算の必要はありません' });
    else {
      L.push({ k: 'cap', t: `送金リスト（${transfers.length}件）` });
      transfers.forEach(x => L.push({ k: 'big', l: `${memberName(trip, x.from)} → ${memberName(trip, x.to)}`, v: fmtMoney(x.amount, cur) }));
    }
    L.push({ k: 'perf' }, { k: 'cap', t: 'メンバー別' }, { k: 'th', c: ['名前', '払った', '負担', '差額'] });
    trip.members.forEach(m => { const b = bal[m.id]; L.push({ k: 'tr', c: [m.name, fmtMoney(b.paid / unit, cur), fmtMoney(b.owed / unit, cur), (b.diff > 0 ? '+' : '') + fmtMoney(b.diff / unit, cur)] }); });
    L.push({ k: 'perf' }, { k: 'note', t: '割り勘の端数は支払者が負担しています' });
    return L;
  }
  const A = bal[tr.from], B = bal[tr.to];
  L.push({ k: 'head', t: 'SETTLEMENT' }, { k: 'title', t: trip.title }, { k: 'sub', t: range }, { k: 'perf' });
  L.push({ k: 'who', t: `${memberName(trip, tr.from)}さん → ${memberName(trip, tr.to)}さん` }, { k: 'amount', t: fmtMoney(tr.amount, cur) }, { k: 'perf' });
  if (opt.breakdown) {
    L.push({ k: 'cap', t: `${memberName(trip, tr.from)}さんの負担` });
    A.owedItems.forEach(x => L.push({ k: 'row', l: `${fmtDate(x.e.date)} ${x.e.desc}`, v: fmtMoney(x.share / unit, cur) }));
    L.push({ k: 'sum', l: '負担合計', v: fmtMoney(A.owed / unit, cur) });
    L.push({ k: 'cap', t: '立て替え分の相殺' });
    if (A.paidItems.length) A.paidItems.forEach(x => L.push({ k: 'row', l: `${fmtDate(x.e.date)} ${x.e.desc}`, v: '−' + fmtMoney(x.total / unit, cur) }));
    else L.push({ k: 'row', l: 'なし', v: '' });
    L.push({ k: 'sum', l: '差し引き（払う額）', v: fmtMoney(-A.diff / unit, cur) });
    if (transfers.filter(x => x.from === tr.from).length > 1) L.push({ k: 'note', t: `※ ${memberName(trip, tr.from)}さんの支払いは ${transfers.filter(x => x.from === tr.from).length}人に分けて送ります` });
    L.push({ k: 'perf' });
  }
  L.push({ k: 'note', t: '割り勘の端数は支払者が負担しています' });
  void B;
  return L;
}
const RECEIPT_LH = { head: 70, title: 90, sub: 50, perf: 60, kv: 60, none: 110, cap: 70, big: 110, th: 56, tr: 56, note: 56, who: 80, amount: 150, row: 54, sum: 70 };
function receiptHeight(lines) { return lines.reduce((s, l) => s + (RECEIPT_LH[l.k] || 56), 0); }
const RECEIPT_MIN_H = 1350, RECEIPT_MAX_BODY = 2600, RECEIPT_PAD = 280;   // v2.2.1 H-8：上の余白 130＋下（「旅帳」）150
// ページ割り：高さは行数に応じて伸ばし（最小 1350）、長すぎる時は複数枚に分ける
function settleExportPages(trip, opt) {
  opt = Object.assign({ mode: 'all', breakdown: true }, opt || {});
  const { transfers } = computeTransfers(trip);
  const sets = opt.mode === 'each' ? transfers.map(x => settleReceiptLines(trip, opt, x)) : [settleReceiptLines(trip, opt, null)];
  const pages = [];
  sets.forEach(lines => {
    // v2.2.1 H-3：2枚目以降の頭にも見出し（SETTLEMENT…（2/3））と旅のタイトル（送金ごとなら宛先も）を入れる
    const head = lines.find(l => l.k === 'head'), who = lines.find(l => l.k === 'who');
    const cont = [{ k: 'head', t: head ? head.t : 'SETTLEMENT' }, { k: 'sub', t: trip.title + (who ? '　' + who.t : '') }, { k: 'perf' }];
    const contH = receiptHeight(cont);
    const chunks = []; let cur = [], h = 0;
    lines.forEach(l => {
      const lh = RECEIPT_LH[l.k] || 56;
      if (cur.length && h + lh > RECEIPT_MAX_BODY && l.k !== 'perf') { chunks.push(cur); cur = cont.slice(); h = contH; }
      cur.push(l); h += lh;
    });
    if (cur.length) chunks.push(cur);
    chunks.forEach((c, k) => pages.push({ lines: c, part: k + 1, parts: chunks.length, h: Math.max(RECEIPT_MIN_H, receiptHeight(c) + RECEIPT_PAD) }));
  });
  return pages;
}
function renderReceipt(trip, p) {
  const th = VTHEME, H = p.h, c = expCanvas(H), ctx = c.getContext('2d');
  ctx.fillStyle = '#e7e0d3'; ctx.fillRect(0, 0, EXP_W, H);
  const X0 = 90, X1 = EXP_W - 90;
  ctx.fillStyle = th.paper; ctx.fillRect(X0 - 30, 40, X1 - X0 + 60, H - 80);
  // 上下のミシン目
  ctx.fillStyle = '#e7e0d3';
  for (let x = X0 - 30; x < X1 + 30; x += 36) { ctx.beginPath(); ctx.arc(x + 18, 40, 10, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(x + 18, H - 40, 10, 0, Math.PI * 2); ctx.fill(); }
  let y = 130;
  const right = (txt, yy, font) => { ctx.font = font; ctx.textAlign = 'right'; ctx.fillText(txt, X1, yy); ctx.textAlign = 'left'; };
  p.lines.forEach(l => {
    const lh = RECEIPT_LH[l.k] || 56;
    ctx.fillStyle = th.ink;
    switch (l.k) {
      case 'head': ctx.fillStyle = th.accent; ctx.font = `700 34px ${EXP_MONO}`; ctx.textAlign = 'center'; ctx.fillText(l.t + (p.parts > 1 ? `  (${p.part}/${p.parts})` : ''), EXP_W / 2, y + 40); ctx.textAlign = 'left'; break;
      case 'title': ctx.font = `700 56px ${th.serif}`; ctx.textAlign = 'center'; ctx.fillText(expFit(ctx, l.t, X1 - X0), EXP_W / 2, y + 62); ctx.textAlign = 'left'; break;
      case 'sub': ctx.fillStyle = th.sub; ctx.font = `400 30px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText(l.t, EXP_W / 2, y + 36); ctx.textAlign = 'left'; break;
      case 'perf': ctx.strokeStyle = th.sub; ctx.setLineDash([10, 10]); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X0, y + 30); ctx.lineTo(X1, y + 30); ctx.stroke(); ctx.setLineDash([]); break;
      case 'kv': case 'row': case 'sum':
        ctx.font = l.k === 'sum' ? `700 34px ${th.sans}` : `400 32px ${th.sans}`;
        ctx.fillText(expFit(ctx, l.l, X1 - X0 - 260), X0, y + 40);
        right(l.v, y + 40, `${l.k === 'sum' ? 700 : 500} 34px ${EXP_MONO}`);
        if (l.k === 'sum') { ctx.strokeStyle = th.ink; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X1 - 300, y + 4); ctx.lineTo(X1, y + 4); ctx.stroke(); }
        break;
      case 'none': ctx.fillStyle = '#15803d'; ctx.font = `700 48px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText(l.t, EXP_W / 2, y + 70); ctx.textAlign = 'left'; break;
      case 'cap': ctx.fillStyle = th.accent; ctx.font = `700 32px ${th.sans}`; ctx.fillText(l.t, X0, y + 48); break;
      case 'big':
        ctx.strokeStyle = th.ink; ctx.lineWidth = 3; ctx.strokeRect(X0, y + 8, X1 - X0, lh - 20);
        ctx.font = `700 38px ${th.sans}`; ctx.fillText(expFit(ctx, l.l, X1 - X0 - 360), X0 + 24, y + 68);
        ctx.font = `700 52px ${EXP_MONO}`; ctx.textAlign = 'right'; ctx.fillText(l.v, X1 - 24, y + 72); ctx.textAlign = 'left';
        break;
      case 'th': case 'tr': {
        // 右端の位置：払った・負担・差額（金額は右揃え。列の間を 220px 以上あける）
        const cols = [X0, X0 + 420, X0 + 640, X1];
        ctx.font = l.k === 'th' ? `700 28px ${th.sans}` : `400 30px ${th.sans}`; ctx.fillStyle = l.k === 'th' ? th.sub : th.ink;
        ctx.fillText(expFit(ctx, l.c[0], 200), cols[0], y + 38);
        ctx.font = l.k === 'th' ? `700 28px ${th.sans}` : `500 28px ${EXP_MONO}`; ctx.textAlign = 'right';
        // v2.2.1：桁の多い通貨（Rp15,000,000 など）は、列の幅 210px に収まるまで文字を小さくする
        const fitCell = (txt, x) => { let fs = 28; if (l.k === 'tr') { while (fs > 16 && ctx.measureText(txt).width > 210) { fs -= 2; ctx.font = `500 ${fs}px ${EXP_MONO}`; } } ctx.fillText(txt, x, y + 38); ctx.font = l.k === 'th' ? `700 28px ${th.sans}` : `500 28px ${EXP_MONO}`; };
        fitCell(l.c[1], cols[1]); fitCell(l.c[2], cols[2]);
        if (l.k === 'tr' && /^\+/.test(l.c[3])) ctx.fillStyle = '#15803d'; else if (l.k === 'tr' && /−/.test(l.c[3])) ctx.fillStyle = '#b91c1c';
        fitCell(l.c[3], cols[3]); ctx.textAlign = 'left';
        break;
      }
      case 'note': ctx.fillStyle = th.sub; ctx.font = `400 26px ${th.sans}`; ctx.fillText(l.t, X0, y + 36); break;
      case 'who': ctx.font = `700 46px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText(expFit(ctx, l.t, X1 - X0), EXP_W / 2, y + 56); ctx.textAlign = 'left'; break;
      case 'amount': ctx.font = `700 104px ${EXP_MONO}`; ctx.textAlign = 'center'; ctx.fillText(l.t, EXP_W / 2, y + 112); ctx.textAlign = 'left'; break;
    }
    y += lh;
  });
  ctx.fillStyle = th.accent; ctx.font = `600 26px ${th.sans}`; ctx.textAlign = 'center'; ctx.fillText('旅帳', EXP_W / 2, H - 80); ctx.textAlign = 'left';
  return c;
}
ACT.settleExport = () => {
  const t = curTrip(); if (!t) return;
  const { transfers } = computeTransfers(t);
  openModal(`<div class="exp-opts">
    <div class="b">形式</div>
    ${segHTML('srMode', [{ v: 'all', l: '全員まとめ（1枚）' }, { v: 'each', l: '送金ごと（' + transfers.length + '枚）' }], 'all', 'srMode')}
    <label class="check mt"><input type="checkbox" id="srBd" data-change="srOpt" checked> 支出の内訳を載せる（送金ごとの時）</label>
  </div>
  <div id="srMsg"></div>
  <div id="srPrev" class="exp-prev"></div>
  <button class="btn primary block mt" data-act="srExport" id="srBtn">📤 書き出す</button>`, { title: '🧾 精算カードを書き出し', data: { t, mode: 'all' }, onMount: () => srPreview(), onClose: () => $$('#srPrev canvas').forEach(releaseCanvas) });
};
function srOptions() { const m = topModal(); return { mode: m.data.mode, breakdown: $('#srBd', topModalBody()).checked }; }
ACT.srMode = (el) => { topModal().data.mode = el.dataset.v; $$('.seg-btn[data-act="srMode"]', topModalBody()).forEach(x => x.classList.toggle('on', x === el)); srPreview(); };
ON_CHANGE.srOpt = () => srPreview();
async function srPreview() {
  const m = topModal(); if (!m) return;
  const gen = (m.data.gen = (m.data.gen || 0) + 1);
  const b = topModalBody();
  const pages = settleExportPages(m.data.t, srOptions());
  const msg = $('#srMsg', b), btn = $('#srBtn', b), prev = $('#srPrev', b);
  if (msg) msg.innerHTML = pages.length ? '' : '<div class="card ok-card">✅ 精算はありません（送る相手がいないので、送金ごとのカードは作りません）</div>';
  if (btn) { btn.textContent = pages.length ? `📤 ${pages.length}枚を書き出す` : '書き出すものがありません'; btn.disabled = !pages.length; }
  await ensureFonts();
  if (topModal() !== m || m.data.gen !== gen || !prev) return;
  previewInto(prev, pages, p => renderReceipt(m.data.t, p));
}
ACT.srExport = async (el) => {
  const t = topModal().data.t;
  const pages = settleExportPages(t, srOptions());
  if (!pages.length) return toast('精算はありません');
  el.disabled = true; el.textContent = '書き出し中…';
  try {
    await ensureFonts();
    const files = await exportCanvases(pages.map(p => renderReceipt(t, p)), (displayTitleEn(t) || 'TRIP').replace(/\s+/g, '_') + '_SETTLEMENT', '精算カード');
    toast(files.length + '枚を書き出しました');
  } catch (e) { toast('書き出しに失敗：' + e.message); }
  el.disabled = false; el.textContent = `📤 ${pages.length}枚を書き出す`;
};
