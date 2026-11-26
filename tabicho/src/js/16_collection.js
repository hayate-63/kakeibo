// ============================================================================
// 16 コレクション（v2.0）：全旅横断の1画面（統計・マップ・都道府県・年別レポート）
//   対象：旅行中・精算・記録中・完了の旅（検討中・計画中は除く。C1）
// ============================================================================
const PREFS = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
const COLLECT_STATUS = ['旅行中', '精算・記録中', '完了'];

function collectionTrips() { return Object.values(S.trips).filter(t => !t._deleted && COLLECT_STATUS.includes(tripStatus(t))); }
function tripJpy(t) { const r = settleToJpy(t) || 1; return budgetSummary(t).total * r; }
function statsOf(trips) {
  const spots = new Set();
  let days = 0, km = 0, spend = 0, photos = 0, videos = 0;
  trips.forEach(t => {
    days += tripDays(t).length; km += totalDistance(t); spend += tripJpy(t);
    t.items.filter(i => i.visited).forEach(i => spots.add(i.spotId ? 's:' + i.spotId : t.id + ':' + i.id));
    t.media.forEach(m => { if (m.kind === 'video') videos++; else photos++; });
  });
  return { trips: trips.length, days, km, spend, spots: spots.size, photos, videos };
}
// 都道府県：スポット帳で「行った」になったスポットの所在地で数える（通過や旅の作成では増えない）
function visitedPlaces() {
  const pref = {}, abroad = {};
  Object.values(S.spots).filter(s => s.status === 'visited').forEach(s => {
    const p = PREFS.find(x => x === s.prefecture) || PREFS.find(x => s.prefecture && x.startsWith(s.prefecture)) || PREFS.find(x => String(s.address || '').startsWith(x));
    if (p) (pref[p] = pref[p] || []).push(s);
    else if (s.prefecture || s.address) { const k = s.prefecture || '（海外・その他）'; (abroad[k] = abroad[k] || []).push(s); }
  });
  return { pref, abroad };
}
// スポットに紐付いた写真（全旅から）。ピンのサムネイルに使う（C2）
function spotPhoto(spotId) {
  for (const t of Object.values(S.trips)) {
    const m = mediaSorted((t.media || []).filter(x => x.spotId === spotId && x.kind === 'photo')).find(x => x.favorite) || (t.media || []).find(x => x.spotId === spotId && x.kind === 'photo');
    if (m) return m;
  }
  return null;
}

function renderCollection() {
  const trips = collectionTrips();
  const st = statsOf(trips);
  const vp = visitedPlaces();
  const nPref = Object.keys(vp.pref).length;
  let h = `<div class="row between"><button class="btn sm" data-act="tab" data-tab="home">‹ ホーム</button><b class="h2">🗂 コレクション</b><span></span></div>
    <div class="muted small mt">旅行中・精算・記録中・完了の旅が対象（検討中・計画中は含めない）</div>
    <div class="card"><div class="stat-grid">
      ${[['総旅数', st.trips + '回'], ['総日数', st.days + '日'], ['総走行距離', st.km ? st.km.toLocaleString() + 'km' : '—'], ['総支出', fmtMoney(Math.round(st.spend), 'JPY')],
        ['行ったスポット', st.spots + '件'], ['都道府県', nPref + ' / 47'], ['写真', st.photos + '枚'], ['動画', st.videos + '本']].map(([k, v]) => `<div><div class="muted small">${k}</div><div class="h3">${v}</div></div>`).join('')}
    </div></div>`;
  h += `<div class="section-title">🗺 行ったスポット</div><div class="map-wrap col-map"><div id="colMap"></div></div>
    <div class="muted small">スポット帳で「行った」になったスポット。写真を紐付けたスポットはピンに写真が出ます</div>`;
  h += `<div class="section-title">🗾 都道府県の訪問状況（${nPref}/47）</div><div class="pref-grid">${PREFS.map(p => `<span class="pref ${vp.pref[p] ? 'on' : ''}" title="${vp.pref[p] ? vp.pref[p].length + '件' : ''}">${p.replace(/[都府県]$/, '')}${vp.pref[p] ? `<small>${vp.pref[p].length}</small>` : ''}</span>`).join('')}</div>`;
  const ab = Object.keys(vp.abroad);
  if (ab.length) h += `<div class="muted small mt">海外・その他：${ab.map(k => esc(k) + '（' + vp.abroad[k].length + '）').join('、')}</div>`;
  if (S.spotsState !== 'ok') h += `<div class="muted small">スポット帳を読み込むと表示されます</div>`;
  // 年別レポート
  const years = Array.from(new Set(trips.map(t => (t.startDate || '').slice(0, 4)).filter(Boolean))).sort().reverse();
  h += `<div class="section-title">📅 年別レポート</div>`;
  if (!years.length) h += emptyHTML('📅', '対象の旅がまだありません');
  years.forEach(y => {
    const ts = trips.filter(t => (t.startDate || '').startsWith(y)).sort(tripSort);
    const s = statsOf(ts);
    h += `<div class="card year"><div class="row between"><div class="h2">${y}</div><button class="btn sm" data-act="yearExport" data-y="${y}">📱 Instagram で書き出し</button></div>
      <div class="muted small">${s.trips}回 ・ ${s.days}日 ・ ${fmtMoney(Math.round(s.spend), 'JPY')} ・ ${s.km ? s.km.toLocaleString() + 'km ・ ' : ''}スポット${s.spots}件</div>
      <div class="ygrid">${ts.map(t => { const c = coverOrFirst(t); return `<button class="ytrip" data-act="tripSelect" data-id="${t.id}">${c ? mediaTileInner(c, 400) : (isImageUrl(t.coverLink) ? `<img src="${esc(t.coverLink)}" alt="">` : `<div class="mt-fb">${esc(tripEmoji(t))}</div>`)}<span>${esc(t.title)}</span></button>`; }).join('')}</div></div>`;
  });
  setTimeout(() => { drawCollectionMap(); loadThumbs(document.getElementById('page-collection')); }, 0);
  return h;
}
ACT.openCollection = () => { if (S.spotsState !== 'ok') loadSpots(true); switchTab('collection'); };

let COLMAP = null, colLayer = null;
async function drawCollectionMap() {
  const el = document.getElementById('colMap');
  if (!el) return;
  if (typeof L === 'undefined') { el.innerHTML = '<div class="map-fallback">地図を読み込めません（オフライン？）</div>'; return; }
  if (COLMAP && COLMAP.getContainer() !== el) { COLMAP.remove(); COLMAP = null; }
  if (!COLMAP) {
    COLMAP = L.map(el, { zoomControl: false }).setView([36.2, 138.2], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(COLMAP);
    colLayer = L.layerGroup().addTo(COLMAP);
  }
  colLayer.clearLayers();
  const pts = [];
  const pins = Object.values(S.spots).filter(s => s.status === 'visited' && s.lat != null).map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng, photo: spotPhoto(s.id) }));
  // スポット帳に無い（旅帳だけの）行った場所
  collectionTrips().forEach(t => t.items.filter(i => i.visited && !i.spotId && i.lat != null).forEach(i => pins.push({ id: 'i' + i.id, name: i.name, lat: i.lat, lng: i.lng, photo: null })));
  const need = pins.filter(p => p.photo && !TH.has(thumbKey(p.photo.fileId, 200))).map(p => p.photo.fileId);
  for (let i = 0; i < need.length; i += 12) {
    try { const r = await api('mediaThumbs', { ids: need.slice(i, i + 12), size: 200 }); Object.keys(r.thumbs || {}).forEach(id => TH.set(thumbKey(id, 200), r.thumbs[id].thumb || '')); } catch (e) { break; }
  }
  pins.forEach(p => {
    const th = p.photo ? TH.get(thumbKey(p.photo.fileId, 200)) : '';
    const icon = th ? L.divIcon({ className: 'mk', html: `<span class="mk-photo"><img src="${th}" alt=""></span>`, iconSize: [44, 44], iconAnchor: [22, 22] })
      : L.divIcon({ className: 'mk', html: '<span class="mk-pin done">✓</span>', iconSize: [20, 20], iconAnchor: [10, 10] });
    L.marker([p.lat, p.lng], { icon }).bindPopup(`<b>${esc(p.name)}</b>`).addTo(colLayer);
    pts.push([p.lat, p.lng]);
  });
  setTimeout(() => COLMAP.invalidateSize(), 50);
  if (pts.length) COLMAP.fitBounds(pts, { padding: [24, 24], maxZoom: 12 });
}

// 年別レポートの書き出し（9:16・1080×1920）
async function renderYearCanvas(y) {
  const W = 1080, H = 1920, th = VTHEME;
  const ts = collectionTrips().filter(t => (t.startDate || '').startsWith(y)).sort(tripSort);
  const s = statsOf(ts);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.accent; ctx.font = `600 36px ${th.sans}`; ctx.letterSpacing = '8px'; ctx.fillText('MY TRAVEL YEAR', 80, 150); ctx.letterSpacing = '0px';
  ctx.fillStyle = th.ink; ctx.font = `700 220px ${th.serif}`; ctx.fillText(y, 70, 380);
  const stats = [[s.trips, 'TRIPS'], [s.days, 'DAYS'], [s.spots, 'SPOTS'], [s.km ? s.km.toLocaleString() : '—', 'KM']];
  stats.forEach(([v, k], i) => { const x = 80 + i * 240; ctx.fillStyle = th.ink; ctx.font = `700 64px ${th.serif}`; ctx.fillText(String(v), x, 520); ctx.fillStyle = th.sub; ctx.font = `600 26px ${th.sans}`; ctx.fillText(k, x, 560); });
  const list = ts.slice(0, 9);
  const cols = 3, gap = 24, cw = (W - 160 - gap * (cols - 1)) / cols, ch = cw * 1.25;
  for (let i = 0; i < list.length; i++) {
    const t = list[i]; const x = 80 + (i % cols) * (cw + gap), yy = 640 + Math.floor(i / cols) * (ch + 90);
    const cm = coverOrFirst(t);
    const img = cm ? await mediaImage(cm) : (isImageUrl(t.coverLink) ? await loadImg(t.coverLink) : null);
    if (img) drawCoverFit(ctx, img, x, yy, cw, ch);
    else { ctx.fillStyle = '#e7e0d3'; ctx.fillRect(x, yy, cw, ch); ctx.font = `80px ${th.sans}`; ctx.fillText(tripEmoji(t), x + cw / 2 - 40, yy + ch / 2 + 28); }
    ctx.fillStyle = th.ink; ctx.font = `700 28px ${th.sans}`;
    ctx.fillText(wrapText(ctx, t.title, cw)[0] || '', x, yy + ch + 40);
    ctx.fillStyle = th.sub; ctx.font = `400 24px ${th.sans}`; ctx.fillText(fmtDate(t.startDate), x, yy + ch + 72);
  }
  if (ts.length > 9) { ctx.fillStyle = th.sub; ctx.font = `500 30px ${th.sans}`; ctx.fillText(`ほか ${ts.length - 9} 件`, 80, H - 120); }
  ctx.fillStyle = th.accent; ctx.font = `600 28px ${th.sans}`; ctx.fillText('旅帳', W - 140, H - 70);
  return c;
}
ACT.yearExport = async (el) => {
  el.disabled = true;
  try {
    await ensureFonts();
    const c = await renderYearCanvas(el.dataset.y);
    await exportCanvases([c], 'TABICHO_' + el.dataset.y, el.dataset.y + ' 年別レポート');
  } catch (e) { toast('書き出しに失敗：' + e.message); }
  el.disabled = false;
};
