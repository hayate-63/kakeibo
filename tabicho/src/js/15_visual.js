// ============================================================================
// 15 ビジュアルモード（v2.0）：見せるための画面。テーマはトラベルマガジン風の1つ（V1。THEMES に足せる作り）
//   ・旅帳モード：表紙 → 日別ページを横にめくって読む（紙をめくるアニメーション）
//   ・Instagram モード：ストーリー比率 9:16（1080×1920）の画像に書き出す（表紙＋日別の複数枚）
// ============================================================================
const THEMES = {
  magazine: {
    name: 'トラベルマガジン', paper: '#f5efe4', ink: '#1c1917', accent: '#b45309', sub: '#57534e',
    serif: '"Playfair Display", "Noto Serif JP", "Hiragino Mincho ProN", Georgia, serif',
    sans: '"Noto Sans JP", -apple-system, "Hiragino Sans", sans-serif'
  }
};
const VTHEME = THEMES.magazine;

// ---- 英語タイトル（V2）：入力があればそれ、無ければ自動英語化（GAS の翻訳）、使えなければかなをローマ字に ----
const KANA = { 'きゃ':'kya','きゅ':'kyu','きょ':'kyo','しゃ':'sha','しゅ':'shu','しょ':'sho','ちゃ':'cha','ちゅ':'chu','ちょ':'cho','にゃ':'nya','にゅ':'nyu','にょ':'nyo','ひゃ':'hya','ひゅ':'hyu','ひょ':'hyo','みゃ':'mya','みゅ':'myu','みょ':'myo','りゃ':'rya','りゅ':'ryu','りょ':'ryo','ぎゃ':'gya','ぎゅ':'gyu','ぎょ':'gyo','じゃ':'ja','じゅ':'ju','じょ':'jo','びゃ':'bya','びゅ':'byu','びょ':'byo','ぴゃ':'pya','ぴゅ':'pyu','ぴょ':'pyo','ふぁ':'fa','ふぃ':'fi','ふぇ':'fe','ふぉ':'fo','てぃ':'ti','でぃ':'di','うぃ':'wi','うぇ':'we','ゔぁ':'va',
  'あ':'a','い':'i','う':'u','え':'e','お':'o','か':'ka','き':'ki','く':'ku','け':'ke','こ':'ko','さ':'sa','し':'shi','す':'su','せ':'se','そ':'so','た':'ta','ち':'chi','つ':'tsu','て':'te','と':'to','な':'na','に':'ni','ぬ':'nu','ね':'ne','の':'no','は':'ha','ひ':'hi','ふ':'fu','へ':'he','ほ':'ho','ま':'ma','み':'mi','む':'mu','め':'me','も':'mo','や':'ya','ゆ':'yu','よ':'yo','ら':'ra','り':'ri','る':'ru','れ':'re','ろ':'ro','わ':'wa','を':'o','ん':'n',
  'が':'ga','ぎ':'gi','ぐ':'gu','げ':'ge','ご':'go','ざ':'za','じ':'ji','ず':'zu','ぜ':'ze','ぞ':'zo','だ':'da','ぢ':'ji','づ':'zu','で':'de','ど':'do','ば':'ba','び':'bi','ぶ':'bu','べ':'be','ぼ':'bo','ぱ':'pa','ぴ':'pi','ぷ':'pu','ぺ':'pe','ぽ':'po','ぁ':'a','ぃ':'i','ぅ':'u','ぇ':'e','ぉ':'o','ゃ':'ya','ゅ':'yu','ょ':'yo','ゔ':'vu' };
function kanaToRomaji(src) {
  // カタカナはひらがなにそろえる
  const s = String(src || '').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.substr(i, 2);
    if (KANA[two]) { out += KANA[two]; i++; continue; }
    const c = s[i];
    if (c === 'っ' || c === 'ッ') { const nx = KANA[s.substr(i + 1, 2)] || KANA[s[i + 1]] || ''; out += nx ? nx[0] : ''; continue; }
    if (c === 'ー') { const m = out.match(/[aeiou]$/); out += m ? m[0] : ''; continue; }
    out += KANA[c] != null ? KANA[c] : c;
  }
  return out;
}
function displayTitleEn(trip) {
  if (trip.titleEn && trip.titleEn.trim()) return trip.titleEn.trim().toUpperCase();
  if (trip.titleEnAuto && trip.titleEnAutoSrc === trip.title) return trip.titleEnAuto.toUpperCase();
  return kanaToRomaji(trip.title).toUpperCase();
}
async function ensureTitleEn(trip) {
  if ((trip.titleEn && trip.titleEn.trim()) || trip.titleEnAutoSrc === trip.title) return;
  try {
    const r = await api('translateTitle', { text: trip.title });
    if (r.text) { trip.titleEnAuto = r.text.toUpperCase(); trip.titleEnAutoSrc = trip.title; commitTrip(trip, { silent: true }); }
  } catch (e) { /* 使えなければローマ字表示のまま */ }
}

// ---- ページの組み立て ----
function vPhotoPool(list) { return list.filter(m => m.kind === 'photo' && !m.missing).concat(list.filter(m => m.kind === 'video' && !m.missing)); }
function visualCover(trip) {
  const id = trip.visual.coverMediaId;
  return (id && trip.media.find(m => m.id === id)) || coverMedia(trip) || null;   // 代表 → お気に入り → 未設定なら書き出し時に選ぶ（V4）
}
// 日別ページの写真：お気に入り → 代表 → 時系列 の優先で自動選出（V3）。手動の差し替えを優先
// v2.0.2 テンプレートのパラメータ：日別の写真の枚数（1〜4・おまかせ＝最大3）と写真の比率
const VRATIOS = [['fill', '枠いっぱい'], ['1:1', '1:1'], ['4:5', '4:5'], ['3:4', '3:4'], ['2:3', '2:3'], ['3:2', '3:2'], ['16:9', '16:9']];
function ratioValue(r) { if (!r || r === 'fill') return null; const [a, b] = r.split(':').map(Number); return a / b; }
function dayCountSetting(trip, date) { const v = (trip.visual.dayCount || {})[date] || trip.visual.defaultCount || 'auto'; return v; }
function dayLimit(trip, date) { const v = dayCountSetting(trip, date); return v === 'auto' ? 3 : clamp(Number(v) || 3, 1, 4); }
function visualDayPicks(trip, date) {
  const dayList = mediaByDay(trip).by[date] || [];
  const limit = dayLimit(trip, date);
  const manual = (trip.visual.dayPicks[date] || []).map(id => trip.media.find(m => m.id === id)).filter(Boolean);
  const auto = vPhotoPool(dayList.filter(m => m.favorite)).concat(vPhotoPool(dayList.filter(m => m.cover && !m.favorite)), vPhotoPool(mediaSorted(dayList.filter(m => !m.favorite && !m.cover))));
  const out = manual.slice(0, limit);
  auto.forEach(m => { if (out.length < limit && !out.includes(m)) out.push(m); });
  return out;
}
// 写真の置き場所（1枚＝全面、2枚＝上下、3枚＝大1＋小2、4枚＝2×2）
function layoutCells(n, X, Y, W, H, gap) {
  if (n <= 1) return [[X, Y, W, H]];
  if (n === 2) { const h = (H - gap) / 2; return [[X, Y, W, h], [X, Y + h + gap, W, h]]; }
  if (n === 3) { const h1 = H * 0.6, w2 = (W - gap) / 2, h2 = H - h1 - gap; return [[X, Y, W, h1], [X, Y + h1 + gap, w2, h2], [X + w2 + gap, Y + h1 + gap, w2, h2]]; }
  const w = (W - gap) / 2, h = (H - gap) / 2; return [[X, Y, w, h], [X + w + gap, Y, w, h], [X, Y + h + gap, w, h], [X + w + gap, Y + h + gap, w, h]];
}
// 比率を決めた時は、枠の中にその比率の箱を収めて中央に置く
function fitRatio(cell, r) {
  const [x, y, w, h] = cell;
  if (!r) return cell;
  let bw = w, bh = w / r;
  if (bh > h) { bh = h; bw = h * r; }
  return [x + (w - bw) / 2, y + (h - bh) / 2, bw, bh];
}
function dayPlace(trip, date) {
  const names = [];
  dayItems(trip, date).forEach(it => { if (it.kind !== 'move') names.push(itemInfo(trip, it).name); });
  trip.items.filter(it => it.visited && it.visited.date === date && !names.includes(itemInfo(trip, it).name)).forEach(it => names.push(itemInfo(trip, it).name));
  return names.slice(0, 3).join(' ・ ') || trip.area || '';
}
function dayLine(trip, date) {
  const memo = String(trip.record.days[date] || '').split('\n').map(s => s.trim()).find(Boolean);
  if (memo) return memo.slice(0, 60);
  const v = trip.items.find(it => it.visited && it.visited.date === date && it.visited.comment);
  return v ? v.visited.comment.slice(0, 60) : '';
}
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function enDate(d) { const x = parseYmd(d); return MON[x.getMonth()] + ' ' + x.getDate(); }
function enRange(trip) {
  if (!trip.startDate) return '';
  const a = parseYmd(trip.startDate), b = parseYmd(trip.endDate || trip.startDate);
  if (trip.startDate === (trip.endDate || trip.startDate)) return enDate(trip.startDate) + ', ' + a.getFullYear();
  return enDate(trip.startDate) + ' – ' + (a.getMonth() === b.getMonth() ? b.getDate() : enDate(trip.endDate)) + ', ' + b.getFullYear();
}
function visualPages(trip) {
  const pages = [{ type: 'cover' }];
  tripDays(trip).forEach((d, i) => {
    const has = (mediaByDay(trip).by[d] || []).length || trip.record.days[d];
    if (has) pages.push({ type: 'day', date: d, index: i + 1 });
  });
  return pages;
}

// ---- 旅帳モード（アプリ内で横にめくって読む） ----
const VIS = { trip: null, pages: [], i: 0, mode: 'book', busy: false };
ACT.openVisual = async () => {
  const trip = curTrip(); if (!trip) return;
  VIS.trip = trip; VIS.pages = visualPages(trip); VIS.i = 0; VIS.mode = 'book';
  let el = document.getElementById('visual');
  if (!el) { el = document.createElement('div'); el.id = 'visual'; document.body.appendChild(el); }
  el.className = 'vis open';
  document.body.classList.add('modal-open');
  renderVisual();
  ensureTitleEn(trip).then(() => { if (VIS.trip === trip) renderVisual(); });
};
ACT.closeVisual = () => { const el = document.getElementById('visual'); if (el) { el.className = 'vis'; el.innerHTML = ''; } document.body.classList.remove('modal-open'); VIS.trip = null; };
ACT.visMode = (el) => { VIS.mode = el.dataset.v; renderVisual(); };
function renderVisual() {
  const el = document.getElementById('visual'); if (!el || !VIS.trip) return;
  const t = VIS.trip;
  el.innerHTML = `<div class="vis-head"><button class="icon-btn light" data-act="closeVisual">✕</button>
    <div class="seg vis-seg"><button class="seg-btn ${VIS.mode === 'book' ? 'on' : ''}" data-act="visMode" data-v="book">📖 旅帳</button><button class="seg-btn ${VIS.mode === 'insta' ? 'on' : ''}" data-act="visMode" data-v="insta">📱 Instagram</button></div>
    <button class="icon-btn light" data-act="visTitleEdit" title="英語タイトル">Aa</button></div>
    ${VIS.mode === 'book' ? `<div class="vis-stage" id="visStage">${VIS.pages.map((p, i) => `<div class="vpage ${i === VIS.i ? 'cur' : i < VIS.i ? 'gone' : 'next'}" data-i="${i}">${pageHTML(t, p)}</div>`).join('')}</div>
      <div class="vis-nav"><button class="btn" data-act="visPrev" ${VIS.i === 0 ? 'disabled' : ''}>‹</button><span>${VIS.i + 1} / ${VIS.pages.length}</span><button class="btn" data-act="visNext" ${VIS.i >= VIS.pages.length - 1 ? 'disabled' : ''}>›</button></div>
      <div class="vis-tools"><button class="btn sm" data-act="visLayout">⚙ レイアウト</button>${t.visual.coverMediaId ? '<button class="btn sm" data-act="visCoverReset">表紙の選択を解除</button>' : ''}</div>
      <div class="vis-hint">写真をタップで差し替え ／ 横にスワイプでページをめくる</div>`
      : instaPanelHTML(t)}`;
  if (VIS.mode === 'book') { bindSwipe(document.getElementById('visStage')); loadVisImages(el); }
  else drawInstaPreviews();
}
function vImg(m, cls, slot) {
  if (!m) return `<div class="vimg empty ${cls}" ${slot}><span>＋ 写真を選ぶ</span></div>`;
  return `<div class="vimg ${cls}" data-vimg="${esc(m.id)}" ${slot}>${m.kind === 'video' ? '<span class="vvid">▶</span>' : ''}</div>`;
}
function pageHTML(t, p) {
  if (p.type === 'cover') {
    const c = visualCover(t);
    return `<div class="vcover">${vImg(c, 'full', 'data-act="visPickCover"')}
      <div class="vcover-text"><div class="vkicker">TRAVEL JOURNAL</div><div class="vtitle">${esc(displayTitleEn(t))}</div>
      <div class="vmeta">${esc(enRange(t))}${t.area ? ' ・ ' + esc(t.area) : ''}</div>${t.record.comment ? `<div class="vline">${esc(String(t.record.comment).split('\n')[0].slice(0, 60))}</div>` : ''}</div></div>`;
  }
  const picks = visualDayPicks(t, p.date);
  const want = dayCountSetting(t, p.date);
  const n = want === 'auto' ? Math.max(1, Math.min(3, picks.length || 1)) : dayLimit(t, p.date);
  const r = ratioValue(t.visual.ratio);
  return `<div class="vday"><div class="vday-head"><span class="vdaynum">DAY ${p.index}</span><span class="vdate">${esc(enDate(p.date))}</span></div>
    <div class="vgrid n${n}">${Array.from({ length: n }, (_, k) => `<div class="vcell s${k}">${vImg(picks[k], r ? 'fixed' : 'fillc', `data-act="visPickDay" data-d="${p.date}" data-k="${k}" ${r ? `style="--r:${r.toFixed(4)}"` : ''}`)}</div>`).join('')}</div>
    <div class="vplace">${esc(dayPlace(t, p.date))}</div><div class="vline">${esc(dayLine(t, p.date))}</div></div>`;
}
async function loadVisImages(root) {
  for (const el of Array.from(root.querySelectorAll('[data-vimg]'))) {
    const m = VIS.trip.media.find(x => x.id === el.dataset.vimg); if (!m) continue;
    try { const src = await fetchBigImage(m, 1600); if (src) el.style.backgroundImage = `url("${src}")`; else el.innerHTML = '<span class="muted">画像なし</span>'; } catch (e) {}
  }
}
ACT.visNext = () => flip(1);
ACT.visPrev = () => flip(-1);
function flip(dir) {
  const ni = VIS.i + dir;
  if (VIS.busy || ni < 0 || ni >= VIS.pages.length) return;
  VIS.busy = true;
  const pages = document.querySelectorAll('#visStage .vpage');
  if (dir > 0) { pages[VIS.i].classList.add('turning'); pages[VIS.i].classList.replace('cur', 'gone'); pages[ni].classList.replace('next', 'cur'); }
  else { pages[ni].classList.add('turning'); pages[ni].classList.replace('gone', 'cur'); pages[VIS.i].classList.replace('cur', 'next'); }
  VIS.i = ni;
  setTimeout(() => { VIS.busy = false; document.querySelectorAll('#visStage .turning').forEach(x => x.classList.remove('turning')); const nav = document.querySelector('.vis-nav span'); if (nav) nav.textContent = (VIS.i + 1) + ' / ' + VIS.pages.length;
    const [pv, nx] = document.querySelectorAll('.vis-nav .btn'); if (pv) pv.disabled = VIS.i === 0; if (nx) nx.disabled = VIS.i >= VIS.pages.length - 1; }, 650);
}
function bindSwipe(el) {
  if (!el) return;
  let x0 = null, y0 = null;
  el.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
  el.addEventListener('pointerup', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { e.preventDefault(); flip(dx < 0 ? 1 : -1); }
  });
}
// 手動の差し替え（V3）・表紙の選択（V4）
function openPhotoPicker(title, list, onPick) {
  openModal(list.length ? `<div class="mgrid">${list.map(m => `<button class="mtile" data-act="visPicked" data-id="${m.id}">${mediaTileInner(m, 400)}${m.favorite ? '<span class="mt-fav">★</span>' : ''}</button>`).join('')}</div>`
    : '<div class="muted pad">選べる写真がありません。記録タブで写真を追加してください</div>', { title, data: { onPick }, onMount: (b) => loadThumbs(b) });
}
ACT.visPicked = (el) => { const { onPick } = topModal().data; closeModal(); onPick(el.dataset.id); };
ACT.visPickCover = () => {
  const t = VIS.trip;
  openPhotoPicker('表紙の写真を選ぶ', vPhotoPool(mediaSorted(t.media)), id => { t.visual.coverMediaId = id; commitTrip(t, { silent: true }); renderVisual(); });
};
ACT.visPickDay = (el) => {
  const t = VIS.trip, d = el.dataset.d, k = Number(el.dataset.k);
  openPhotoPicker(fmtDate(d) + 'の写真を選ぶ', vPhotoPool(mediaByDay(t).by[d] || []), id => {
    const cur = visualDayPicks(t, d).map(m => m.id);
    cur[k] = id;
    t.visual.dayPicks[d] = cur.filter((x, i) => x && cur.indexOf(x) === i);
    commitTrip(t, { silent: true }); renderVisual();
  });
};
// 表紙の選択を解除：代表 → お気に入りの先頭 の優先順位に戻す
ACT.visCoverReset = () => {
  const t = VIS.trip; t.visual.coverMediaId = ''; commitTrip(t, { silent: true });
  const c = visualCover(t);
  toast(c ? '表紙の選択を解除しました（' + (c.cover ? '代表写真' : 'お気に入りの先頭') + 'を使います）' : '表紙の選択を解除しました（代表・お気に入りが無いので書き出し時に選びます）');
  renderVisual();
};
// レイアウト：写真の比率（全ページ共通）、日別の枚数（全日の既定・この日だけ）
ACT.visLayout = () => {
  const t = VIS.trip; const p = VIS.pages[VIS.i] || {};
  const cnt = (cur, name) => `<div class="seg">${[['auto', 'おまかせ'], ['1', '1枚'], ['2', '2枚'], ['3', '3枚'], ['4', '4枚']].map(([v, l]) => `<button class="seg-btn ${String(cur) === v ? 'on' : ''}" data-act="segPick" data-name="${name}" data-v="${v}">${l}</button>`).join('')}</div>`;
  openModal(`<div class="b">写真の比率</div><div class="chips">${VRATIOS.map(([v, l]) => `<label class="chip"><input type="radio" name="vlRatio" value="${v}" ${t.visual.ratio === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="b mt">日別ページの写真の枚数（全日の既定）</div>${cnt(t.visual.defaultCount || 'auto', 'vlDefault')}
    ${p.type === 'day' ? `<div class="b mt">この日（${fmtDate(p.date)}）だけの枚数</div>${cnt((t.visual.dayCount || {})[p.date] || '', 'vlDay')}<button class="link-btn" data-act="vlDayClear">この日の指定をやめる（既定に従う）</button>` : ''}
    <div class="muted small mt">旅帳モードと Instagram 書き出しの両方に使います。写真が足りない枠は「＋ 写真を選ぶ」になります</div>
    <button class="btn primary block mt" data-act="vlSave">決定</button>`, { title: '⚙ レイアウト', data: { date: p.type === 'day' ? p.date : '' } });
};
ACT.vlDayClear = () => { $$('.seg-btn[data-name="vlDay"]', topModalBody()).forEach(b => b.classList.remove('on')); };
ACT.vlSave = () => {
  const t = VIS.trip; const b = topModalBody(); const { date } = topModal().data;
  t.visual.ratio = ($$('input[name="vlRatio"]', b).find(x => x.checked) || {}).value || 'fill';
  t.visual.defaultCount = segValue(b, 'vlDefault') || 'auto';
  if (date) { const v = segValue(b, 'vlDay'); t.visual.dayCount = t.visual.dayCount || {}; if (v) t.visual.dayCount[date] = v; else delete t.visual.dayCount[date]; }
  closeModal(); commitTrip(t, { silent: true }); renderVisual();
};
ACT.visTitleEdit = () => {
  const t = VIS.trip;
  openModal(`<div class="form-grid"><label>英語タイトル</label><input id="vtEn" value="${esc(t.titleEn || '')}" placeholder="${esc(displayTitleEn(t))}"></div>
    <div class="muted small">空欄なら旅のタイトルから自動で英語表示します（今は「${esc(displayTitleEn(t))}」）</div>
    <button class="btn primary block mt" data-act="vtSave">保存</button>`, { title: '表紙の文字' });
};
ACT.vtSave = () => { const t = VIS.trip; t.titleEn = $('#vtEn', topModalBody()).value.trim(); closeModal(); commitTrip(t, { silent: true }); renderVisual(); };

// ---- Instagram モード（9:16・1080×1920 の画像に書き出し） ----
function instaPanelHTML(t) {
  const needCover = !visualCover(t);
  return `<div class="insta">${needCover ? `<div class="alert warn">表紙の写真が決まっていません（代表・お気に入りなし）。<button class="btn sm" data-act="visPickCover">表紙を選ぶ</button></div>` : ''}
    <div class="row gap wrap"><button class="btn sm" data-act="visLayout">⚙ レイアウト</button>${t.visual.coverMediaId ? '<button class="btn sm" data-act="visCoverReset">表紙の選択を解除</button>' : ''}</div>
    <div class="insta-previews">${VIS.pages.map((p, i) => `<canvas class="ipv" width="270" height="480" data-i="${i}"></canvas>`).join('')}</div>
    <button class="btn primary block mt" data-act="instaExport" ${needCover ? 'disabled' : ''}>📤 ${VIS.pages.length}枚を書き出す（1080×1920）</button>
    <div class="muted small">iPhone では共有シートから「画像を保存」で写真アプリに入ります</div><div id="instaOut"></div></div>`;
}
async function drawInstaPreviews() {
  await ensureFonts();
  for (const c of Array.from(document.querySelectorAll('.ipv'))) {
    const big = await renderPageCanvas(VIS.trip, VIS.pages[Number(c.dataset.i)]);
    c.getContext('2d').drawImage(big, 0, 0, c.width, c.height);
  }
}
let fontsReady = null;
function ensureFonts() {
  if (!fontsReady) fontsReady = Promise.all(['700 120px "Playfair Display"', '400 40px "Noto Serif JP"', '700 40px "Noto Sans JP"'].map(f => document.fonts && document.fonts.load ? document.fonts.load(f).catch(() => {}) : null)).catch(() => {});
  return fontsReady;
}
// v2.0.3：外部サイトの画像は crossOrigin を付けて読む。付けずに描くとキャンバスが「汚れ」て画像に書き出せなくなる。
// 相手が許可していなければ読み込み失敗（null）になり、呼び出し側は絵文字などの代わりの表示にする
function loadImg(src) {
  return new Promise((res) => {
    if (!src) return res(null);
    const i = new Image();
    if (/^https?:/i.test(src) && !src.startsWith(location.origin)) i.crossOrigin = 'anonymous';
    let done = false;
    const fin = (v) => { if (!done) { done = true; res(v); } };
    i.onload = () => fin(i); i.onerror = () => fin(null);
    setTimeout(() => fin(null), 15000);   // 返事がない外部画像で書き出しが止まらないように
    i.src = src;
  });
}
// キャンバスが書き出せる状態か（外部画像で汚れていないか）
function canvasExportable(cv) { try { cv.getContext('2d').getImageData(0, 0, 1, 1); return true; } catch (e) { return false; } }
function imageExportSafe(img) { const t = document.createElement('canvas'); t.width = t.height = 1; try { t.getContext('2d').drawImage(img, 0, 0, 1, 1); } catch (e) { return false; } return canvasExportable(t); }
function drawCoverFit(ctx, img, x, y, w, h) {
  if (!img) { ctx.fillStyle = '#d6d3d1'; ctx.fillRect(x, y, w, h); return; }
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k, sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}
function wrapText(ctx, text, maxW) {
  const words = String(text).split(/(\s+)/); const lines = []; let cur = '';
  words.forEach(w => { const t2 = cur + w; if (ctx.measureText(t2).width > maxW && cur.trim()) { lines.push(cur.trim()); cur = w.trim(); } else cur = t2; });
  if (cur.trim()) lines.push(cur.trim());
  // 1語が長すぎる時は文字で折る
  return lines.flatMap(l => { if (ctx.measureText(l).width <= maxW) return [l]; const out = []; let c = ''; for (const ch of l) { if (ctx.measureText(c + ch).width > maxW) { out.push(c); c = ch; } else c += ch; } if (c) out.push(c); return out; });
}
async function mediaImage(m) { return m ? loadImg(await fetchBigImage(m, 1600).catch(() => '')) : null; }
async function renderPageCanvas(t, p) {
  const W = 1080, H = 1920, th = VTHEME;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  if (p.type === 'cover') {
    drawCoverFit(ctx, await mediaImage(visualCover(t)), 0, 0, W, H);
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 34px ${th.sans}`; ctx.letterSpacing = '8px'; ctx.fillText('TRAVEL JOURNAL', 80, 140); ctx.letterSpacing = '0px';
    let size = 150; ctx.font = `700 ${size}px ${th.serif}`;
    let lines = wrapText(ctx, displayTitleEn(t), W - 160);
    while (lines.length > 3 && size > 70) { size -= 10; ctx.font = `700 ${size}px ${th.serif}`; lines = wrapText(ctx, displayTitleEn(t), W - 160); }
    let y = H - 300 - (lines.length - 1) * size * 1.05;
    lines.forEach(l => { ctx.fillText(l, 80, y); y += size * 1.05; });
    ctx.font = `500 40px ${th.sans}`; ctx.fillText([enRange(t), t.area].filter(Boolean).join('  ・  '), 80, H - 190);
    if (t.record.comment) { ctx.font = `400 40px ${th.serif}`; wrapText(ctx, String(t.record.comment).split('\n')[0].slice(0, 60), W - 160).slice(0, 2).forEach((l, i) => ctx.fillText(l, 80, H - 120 + i * 52)); }
    return c;
  }
  ctx.fillStyle = th.paper; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = th.accent; ctx.font = `700 46px ${th.sans}`; ctx.letterSpacing = '6px'; ctx.fillText('DAY ' + p.index, 80, 150); ctx.letterSpacing = '0px';
  ctx.fillStyle = th.ink; ctx.font = `700 96px ${th.serif}`; ctx.fillText(enDate(p.date), 80, 260);
  const picks = visualDayPicks(t, p.date);
  const imgs = await Promise.all(picks.map(mediaImage));
  const X = 80, Y = 320, Wd = W - 160, Hd = 1180;
  const want = dayCountSetting(t, p.date);
  const n = want === 'auto' ? Math.max(1, Math.min(3, imgs.length || 1)) : dayLimit(t, p.date);
  const r = ratioValue(t.visual.ratio);
  ctx.save();
  layoutCells(n, X, Y, Wd, Hd, 24).forEach((cell, k) => { const [x, y, w, h] = fitRatio(cell, r); drawCoverFit(ctx, imgs[k], x, y, w, h); });
  ctx.restore();
  ctx.fillStyle = th.ink; ctx.font = `700 44px ${th.sans}`;
  wrapText(ctx, dayPlace(t, p.date), W - 160).slice(0, 2).forEach((l, i) => ctx.fillText(l, 80, 1600 + i * 58));
  ctx.fillStyle = th.sub; ctx.font = `400 42px ${th.serif}`;
  wrapText(ctx, dayLine(t, p.date), W - 160).slice(0, 2).forEach((l, i) => ctx.fillText(l, 80, 1740 + i * 58));
  ctx.fillStyle = th.accent; ctx.font = `600 30px ${th.sans}`; ctx.fillText(displayTitleEn(t), 80, 1870);
  return c;
}
function canvasBlob(c) { return new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.92)); }
async function exportCanvases(canvases, baseName, fallbackTitle) {
  const files = [];
  for (let i = 0; i < canvases.length; i++) { const b = await canvasBlob(canvases[i]); files.push(new File([b], `${baseName}_${pad2(i + 1)}.jpg`, { type: 'image/jpeg' })); }
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: baseName }); return files; } catch (e) { if (e && e.name === 'AbortError') return files; }
  }
  // 共有シートが使えない時だけ、画像を並べて保存してもらう
  let out = document.getElementById('instaOut');
  if (out && !out.offsetParent) out = null;   // 閉じた画面に残った受け皿は使わない
  if (!out) { openModal('<div id="instaOut"></div>', { title: fallbackTitle || '書き出した画像' }); out = document.getElementById('instaOut'); }
  if (out) out.innerHTML = '<div class="muted small mt">長押しで保存、またはリンクからダウンロードできます</div>' + files.map(f => { const u = URL.createObjectURL(f); return `<a href="${u}" download="${esc(f.name)}"><img class="iout" src="${u}" alt=""></a>`; }).join('');
  return files;
}
ACT.instaExport = async (el) => {
  const t = VIS.trip;
  if (!visualCover(t)) return toast('表紙の写真を選んでください');
  el.disabled = true; el.textContent = '書き出し中…';
  try {
    await ensureFonts();
    const cs = [];
    for (const p of VIS.pages) cs.push(await renderPageCanvas(t, p));
    const files = await exportCanvases(cs, (displayTitleEn(t) || 'TRIP').replace(/\s+/g, '_'));
    toast(files.length + '枚を書き出しました');
  } catch (e) { toast('書き出しに失敗：' + e.message); }
  el.disabled = false; el.textContent = `📤 ${VIS.pages.length}枚を書き出す（1080×1920）`;
};
