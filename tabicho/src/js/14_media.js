// ============================================================================
// 14 メディア（v2.0）：写真・動画を Drive に保存し、旅帳は fileId とメタ情報だけを持つ
//   アップロードは旅帳PoC v0.1 の方式（実機検証済み）：GAS が Origin 付きでセッション発行 → 画面から直接 PUT
//   ・既定は「保留」（キューに入れて手動で送る）。設定で写真・動画それぞれ自動送信にできる
//   ・自動送信でも 100MB 以上は送る前に確認（M1）
//   ・ファイル本体は端末に抱えない（M2）。再読み込み後はファイルを選び直して途中から再開
// ============================================================================
const MQ_KEY = 'tabicho_media_queue_v1';
const MQ = { items: [], files: new Map(), running: false, wake: null };
const MQ_LABEL = { held: '保留中', waiting: '送信待ち', sending: '送信中', failed: '失敗', done: '完了' };

function mqLoad() {
  try { MQ.items = JSON.parse(localStorage.getItem(MQ_KEY) || '[]'); } catch (e) { MQ.items = []; }
  // 前回「送信中」のまま閉じたもの＝エラーによる中断（意図的な保留とは分ける）
  MQ.items.forEach(q => {
    if (q.state === 'sending' || q.state === 'waiting') { q.state = 'failed'; q.error = '中断されました（画面を閉じた・スリープなど）。ファイルを選び直すと途中から再開します'; }
  });
  const dayAgo = Date.now() - 24 * 3600e3;
  MQ.items = MQ.items.filter(q => !(q.state === 'done' && q.doneAt < dayAgo));
  mqSave();
}
function mqSave() { try { localStorage.setItem(MQ_KEY, JSON.stringify(MQ.items)); } catch (e) {} }
function mqCounts(tripId) {
  const c = { held: 0, waiting: 0, sending: 0, failed: 0, done: 0 };
  MQ.items.filter(q => !tripId || q.tripId === tripId).forEach(q => { c[q.state] = (c[q.state] || 0) + 1; });
  c.unsent = c.held + c.waiting;
  return c;
}
function mediaKind(f) {
  const t = String(f.type || ''), n = String(f.name || '').toLowerCase();
  if (/^video\//.test(t) || /\.(mov|mp4|m4v|hevc|avi|mkv|3gp)$/.test(n)) return 'video';
  return 'photo';
}
function fmtBytes(n) { n = Number(n) || 0; return n >= 1073741824 ? (n / 1073741824).toFixed(2) + 'GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : n >= 1024 ? Math.round(n / 1024) + 'KB' : n + 'B'; }
function fmtDurMs(ms) { if (!ms) return ''; const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + pad2(s % 60); }

// ---------------------------------------------------------------------------
// キューに追加（保留 or 自動送信）
// ---------------------------------------------------------------------------
async function addFilesToQueue(trip, files, opt) {
  opt = opt || {};
  const ms = S.settings.media || {};
  const limit = (Number(ms.confirmMB) || 100) * 1048576;
  let n = 0;
  for (const f of files) {
    const kind = mediaKind(f);
    const q = {
      qid: uid('q'), tripId: trip.id, name: f.name, size: f.size, lastModified: f.lastModified, type: f.type || '', kind,
      state: 'held', error: '', sessionUri: '', offset: 0, spotId: opt.spotId || '', itemId: opt.itemId || '', date: opt.date || '',
      addedAt: Date.now(), progress: 0
    };
    const auto = opt.sendNow != null ? opt.sendNow : (kind === 'video' ? ms.autoVideo : ms.autoPhoto);
    if (auto) {
      if (f.size >= limit && !(await confirmDialog(`「${f.name}」は ${fmtBytes(f.size)} あります。今すぐ送りますか？\n（キャンセル＝保留に入れて後で送る）`))) q.state = 'held';
      else q.state = 'waiting';
    }
    MQ.files.set(q.qid, f);
    MQ.items.push(q);
    if (mockThumbMaker) mockThumbMaker(q.qid, f);
    n++;
  }
  mqSave();
  render();
  processQueue();
  return n;
}
function mqSend(qids) {
  let needFile = 0;
  MQ.items.filter(q => qids.includes(q.qid) && (q.state === 'held' || q.state === 'failed')).forEach(q => {
    if (!MQ.files.has(q.qid)) { needFile++; return; }
    q.state = 'waiting'; q.error = '';
  });
  mqSave(); render(); processQueue();
  if (needFile) toast(needFile + '件はファイルを選び直してください（端末にファイル本体を残さない方式のため）');
}
function mqRemove(qid) { MQ.items = MQ.items.filter(q => q.qid !== qid); MQ.files.delete(qid); mqSave(); render(); }

async function processQueue() {
  if (MQ.running) return;
  MQ.running = true;
  try {
    for (;;) {
      const q = MQ.items.find(x => x.state === 'waiting' && MQ.files.has(x.qid));
      if (!q) break;
      await uploadOne(q, MQ.files.get(q.qid));
    }
  } finally { MQ.running = false; }
}
function mqUpdate(q) { mqSave(); updateQueueRow(q); updateUnsentBar(); }

// ---------------------------------------------------------------------------
// 1件のアップロード（PoC の直接 PUT を移植）
// ---------------------------------------------------------------------------
function tripFolderInfo(trip) {
  return { tripId: trip.id, folderId: trip.driveFolderId || '', year: trip.startDate ? trip.startDate.slice(0, 4) : '', region: trip.driveFolderRegion || trip.region || 'domestic', title: trip.title };
}
function rememberFolder(trip, r) {
  if (r.folderId && trip.driveFolderId !== r.folderId) {
    trip.driveFolderId = r.folderId; trip.driveFolderName = r.folderName || ''; trip.driveFolderRegion = trip.driveFolderRegion || trip.region;
    commitTrip(trip, { noRender: true });
  }
}
function xhrPutMedia(uri, body, contentRange, onProgress) {
  return new Promise((resolve) => {
    const x = new XMLHttpRequest();
    x.open('PUT', uri);
    x.setRequestHeader('Content-Range', contentRange);
    if (onProgress) x.upload.onprogress = (e) => onProgress(e.loaded);
    x.timeout = 10 * 60 * 1000;
    const done = (err) => {
      let range = ''; try { range = x.getResponseHeader('Range') || ''; } catch (e) {}
      resolve({ status: x.status, range, body: x.status && x.status !== 308 ? x.responseText : '', error: err || '' });
    };
    x.onload = () => done();
    x.onerror = () => done('network');
    x.ontimeout = () => done('timeout');
    x.onabort = () => done('abort');
    x.send(body);
  });
}
function rangeEnd(r) { const m = String(r || '').match(/bytes=0-(\d+)/); return m ? Number(m[1]) + 1 : 0; }
async function blobB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
function sleepWake(ms) { return new Promise(r => { const t = setTimeout(r, ms); MQ.wake = () => { clearTimeout(t); r(); }; }); }

async function queryUploaded(q, file) {
  if (isMockUri(q.sessionUri)) return mockStatus(q, file);
  const r = await xhrPutMedia(q.sessionUri, null, 'bytes */' + file.size);
  if (r.status === 308 && r.range) return { offset: rangeEnd(r.range) };
  if (r.status === 200 || r.status === 201) { try { return { offset: file.size, file: JSON.parse(r.body) }; } catch (e) {} }
  // 画面で読めない時は GAS から確認（PoC の保険経路）
  const st = await api('mediaStatus', { sessionUri: q.sessionUri, size: file.size });
  if (st.code === 404 || st.code === 410) throw new Error('アップロードの期限が切れました。もう一度最初から送ってください');
  if (st.code === 200 || st.code === 201) return { offset: file.size, file: st.file };
  return { offset: rangeEnd(st.range) };
}

async function uploadOne(q, file) {
  const trip = S.trips[q.tripId];
  if (!trip || trip._deleted) { q.state = 'failed'; q.error = '旅が見つかりません'; mqUpdate(q); return; }
  q.state = 'sending'; q.error = ''; mqUpdate(q);
  const chunk = Math.max(1, Number((S.settings.media || {}).chunkMB) || 4) * 262144 * 4; // 256KB の倍数
  let fileObj = null, retries = 0;
  try {
    if (!q.sessionUri) {
      const r = await api('mediaSession', { folder: tripFolderInfo(trip), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, origin: location.origin });
      q.sessionUri = r.sessionUri; q.offset = 0; rememberFolder(trip, r); mqSave();
    } else {
      const st = await queryUploaded(q, file);
      q.offset = st.offset; if (st.file) fileObj = st.file;
    }
    while (!fileObj) {
      const start = q.offset, end = Math.min(start + chunk, file.size) - 1;
      const r = isMockUri(q.sessionUri) ? await mockPut(q, file, start, end)
        : await xhrPutMedia(q.sessionUri, file.slice(start, end + 1), `bytes ${start}-${end}/${file.size}`, (n) => { q.progress = (start + n) / file.size; updateQueueRow(q); });
      if (r.status === 308) {
        q.offset = r.range ? rangeEnd(r.range) : (await queryUploaded(q, file)).offset;
        q.progress = q.offset / file.size; retries = 0; mqUpdate(q);
      } else if (r.status === 200 || r.status === 201) {
        try { fileObj = JSON.parse(r.body); } catch (e) { fileObj = (await queryUploaded(q, file)).file; }
      } else if (r.status === 0 && start === 0 && !retries && q.kind === 'photo' && file.size <= 5 * 1048576) {
        // 直接 PUT ができない時、小さい写真は GAS 経由で送る（PoC の代替路）
        const res = await api('mediaSmallUpload', { folder: tripFolderInfo(trip), name: file.name, mimeType: file.type || 'image/jpeg', b64: await blobB64(file) });
        rememberFolder(trip, res); fileObj = res.file; q.viaGas = true;
      } else {
        if (++retries > 6) throw new Error('送信できませんでした（' + (r.error || 'HTTP ' + r.status) + '）');
        q.error = `通信が切れました。再開を待っています（${retries}回目）`; mqUpdate(q);
        await sleepWake(Math.min(30000, 1500 * Math.pow(2, retries)));
        q.offset = (await queryUploaded(q, file)).offset;
        q.error = '';
      }
    }
    await registerMedia(trip, q, fileObj);
    q.state = 'done'; q.doneAt = Date.now(); q.sessionUri = ''; q.progress = 1; q.fileId = fileObj.id;
    MQ.files.delete(q.qid);
    mqUpdate(q);
    render();
  } catch (e) {
    q.state = 'failed'; q.error = e.message || String(e); mqUpdate(q);
  }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && MQ.wake) { const w = MQ.wake; MQ.wake = null; w(); } });
window.addEventListener('online', () => { if (MQ.wake) { const w = MQ.wake; MQ.wake = null; w(); } processQueue(); });

// 撮影日時は Drive のメタデータ（EXIF）を優先、無ければアップロード日（M3）。日程外・不明は「日付未設定」へ
async function registerMedia(trip, q, fileObj) {
  let meta = {};
  try { const r = await api('mediaMeta', { ids: [fileObj.id] }); meta = (r.meta || {})[fileObj.id] || {}; } catch (e) {}
  const taken = meta.takenAt || '';
  const date = q.date || (taken ? taken.slice(0, 10) : todayStr());
  const m = {
    id: uid('md'), fileId: fileObj.id, kind: q.kind, name: fileObj.name || q.name, size: Number(fileObj.size) || q.size,
    mimeType: fileObj.mimeType || q.type, takenAt: taken, date, dateSource: q.date ? 'manual' : taken ? 'exif' : 'upload',
    spotId: q.spotId || '', itemId: q.itemId || '', favorite: false, cover: false, comment: '', createdAt: new Date().toISOString(),
    width: meta.width || null, height: meta.height || null, durationMs: meta.durationMs || null, hasThumbnail: !!meta.hasThumbnail, videoReady: !!meta.videoReady
  };
  const t = S.trips[trip.id] || trip;
  t.media.push(m);
  commitTrip(t, { noRender: true });
}

// ---------------------------------------------------------------------------
// メディアの並び・代表写真
// ---------------------------------------------------------------------------
function mediaSorted(list) { return list.slice().sort((a, b) => ((a.takenAt || a.createdAt) < (b.takenAt || b.createdAt) ? -1 : 1)); }
function mediaByDay(trip) {
  const days = tripDays(trip);
  const by = {}; days.forEach(d => { by[d] = []; });
  const unset = [];
  trip.media.forEach(m => { if (m.date && by[m.date]) by[m.date].push(m); else unset.push(m); });
  Object.keys(by).forEach(d => { by[d] = mediaSorted(by[d]); });
  return { by, unset: mediaSorted(unset) };
}
// 代表写真：代表に設定した写真 → お気に入りの先頭 → 写真の先頭
function coverMedia(trip) {
  const photos = trip.media.filter(m => m.kind === 'photo');
  return photos.find(m => m.cover) || photos.find(m => m.favorite) || null;
}
function coverOrFirst(trip) { return coverMedia(trip) || mediaSorted(trip.media.filter(m => m.kind === 'photo'))[0] || null; }
function isImageUrl(u) { return /^https?:\/\/\S+\.(jpe?g|png|webp|gif|heic)(\?|$)/i.test(u || '') || /googleusercontent\.com\//.test(u || ''); }
function driveUrl(m) { return 'https://drive.google.com/file/d/' + encodeURIComponent(m.fileId) + '/view'; }
function previewState(m) {
  if (m.kind !== 'video') return 'ok';
  if (m.videoReady) return 'ok';
  const age = Date.now() - new Date(m.createdAt || 0).getTime();
  return age > 30 * 60 * 1000 ? 'none' : 'processing';   // ProRes 等は Drive の変換対象外で、いつまでも準備されない
}

// ---------------------------------------------------------------------------
// サムネイル（GAS が自権限で取得した base64。端末にもキャッシュしてオフラインでも見られる）
// ---------------------------------------------------------------------------
const TH = new Map();
const thumbIdb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res) => {
    try { const r = indexedDB.open('tabicho_thumbs', 1); r.onupgradeneeded = () => r.result.createObjectStore('t'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }
    catch (e) { res(null); }
  }));
  return {
    async get(k) { const db = await open(); if (!db) return undefined; return new Promise(res => { try { const g = db.transaction('t').objectStore('t').get(k); g.onsuccess = () => res(g.result); g.onerror = () => res(undefined); } catch (e) { res(undefined); } }); },
    async put(k, v) { const db = await open(); if (!db) return; try { db.transaction('t', 'readwrite').objectStore('t').put(v, k); } catch (e) {} }
  };
})();
function thumbKey(fileId, size) { return fileId + '@' + size; }
function mediaTileInner(m, size) {
  const k = thumbKey(m.fileId, size);
  const src = TH.get(k);
  if (src) return `<img src="${src}" alt="">`;
  if (src === '') return mediaFallback(m);
  return `<div class="mt-load" data-thumb="${esc(m.fileId)}" data-size="${size}">${m.kind === 'video' ? '🎬' : '📷'}</div>`;
}
// サムネイルが取れない時の代替表示（メディア自体は残す）
function mediaFallback(m) {
  const p = previewState(m);
  if (m.kind === 'video') return `<div class="mt-fb">🎬<small>${p === 'none' ? 'プレビュー不可' : p === 'processing' ? 'Drive で処理中' : ''}${m.durationMs ? ' ' + fmtDurMs(m.durationMs) : ''}</small><small>${esc(m.name)}</small></div>`;
  return `<div class="mt-fb">📷<small>${esc(m.name)}</small></div>`;
}
let thumbLoading = false;
async function loadThumbs(root) {
  root = root || document;
  const els = Array.from(root.querySelectorAll('[data-thumb]'));
  if (!els.length) return;
  const want = {};
  els.forEach(el => { const k = thumbKey(el.dataset.thumb, el.dataset.size); if (!TH.has(k)) (want[el.dataset.size] = want[el.dataset.size] || new Set()).add(el.dataset.thumb); });
  // まず端末のキャッシュ
  for (const size of Object.keys(want)) {
    for (const id of Array.from(want[size])) {
      const v = await thumbIdb.get(thumbKey(id, size));
      if (v) { TH.set(thumbKey(id, size), v); want[size].delete(id); }
    }
  }
  applyThumbs(root);
  if (thumbLoading) return;
  thumbLoading = true;
  try {
    for (const size of Object.keys(want)) {
      const ids = Array.from(want[size]);
      for (let i = 0; i < ids.length; i += 12) {
        const r = await api('mediaThumbs', { ids: ids.slice(i, i + 12), size: Number(size) });
        Object.keys(r.thumbs || {}).forEach(id => {
          const t = r.thumbs[id];
          TH.set(thumbKey(id, size), t.thumb || '');
          if (t.thumb) thumbIdb.put(thumbKey(id, size), t.thumb);
          updateMediaMeta(id, t.meta);
        });
        applyThumbs(document);
      }
    }
  } catch (e) { /* 取れなければ代替表示のまま */ }
  thumbLoading = false;
}
function applyThumbs(root) {
  (root || document).querySelectorAll('[data-thumb]').forEach(el => {
    const k = thumbKey(el.dataset.thumb, el.dataset.size);
    if (!TH.has(k)) return;
    const m = findMediaByFile(el.dataset.thumb);
    el.outerHTML = TH.get(k) ? `<img src="${TH.get(k)}" alt="">` : (m ? mediaFallback(m) : '<div class="mt-fb">？</div>');
  });
}
function findMediaByFile(fileId) {
  for (const t of Object.values(S.trips)) { const m = (t.media || []).find(x => x.fileId === fileId); if (m) return m; }
  return null;
}
function updateMediaMeta(fileId, meta) {
  if (!meta) return;
  for (const t of Object.values(S.trips)) {
    const m = (t.media || []).find(x => x.fileId === fileId);
    if (!m) continue;
    let ch = false;
    [['durationMs', meta.durationMs], ['videoReady', meta.videoReady], ['hasThumbnail', meta.hasThumbnail], ['width', meta.width], ['height', meta.height]].forEach(([k, v]) => {
      if (v != null && m[k] !== v) { m[k] = v; ch = true; }
    });
    if (meta.missing && !m.missing) { m.missing = true; ch = true; }
    if (ch) commitTrip(t, { silent: true });
  }
}
async function fetchBigImage(m, size) {
  size = size || 1600;
  const k = thumbKey(m.fileId, size);
  if (TH.has(k)) return TH.get(k);
  const c = await thumbIdb.get(k);
  if (c) { TH.set(k, c); return c; }
  const r = await api('mediaThumbs', { ids: [m.fileId], size });
  const t = (r.thumbs || {})[m.fileId] || {};
  TH.set(k, t.thumb || '');
  if (t.thumb) thumbIdb.put(k, t.thumb);
  updateMediaMeta(m.fileId, t.meta);
  return t.thumb || '';
}

// ---------------------------------------------------------------------------
// ホーム上部の未送信バー（通知役。操作は記録タブで）
// ---------------------------------------------------------------------------
function unsentBarHTML() {
  const c = mqCounts();
  if (!c.unsent && !c.sending && !c.failed) return `<div class="unsent-bar ok" id="unsentBar">📤 メディアの未送信はありません</div>`;
  return `<div class="unsent-bar" id="unsentBar" data-act="goUnsent">📤 未送信 <b>${c.unsent}</b>件 ／ 送信中 <b>${c.sending}</b>件 ／ 失敗 <b class="${c.failed ? 'ng' : ''}">${c.failed}</b>件<span class="muted small">（記録タブで操作）</span></div>`;
}
function updateUnsentBar() { const el = document.getElementById('unsentBar'); if (el) el.outerHTML = unsentBarHTML(); }
ACT.goUnsent = () => {
  const q = MQ.items.find(x => x.state === 'failed') || MQ.items.find(x => x.state !== 'done');
  if (q && S.trips[q.tripId]) S.curTripId = q.tripId;
  S.ui.recordSub = 'media';
  switchTab('record');
};

// ---------------------------------------------------------------------------
// 記録タブ：アルバム／キュー／日別セクション＋グリッド
// ---------------------------------------------------------------------------
function albumsHTML(trip) {
  return `<div class="albums">${trip.albums.map(a => `<a class="chip-btn" href="${esc(a.url)}" target="_blank" rel="noopener">📚 ${esc(a.title || 'アルバム')}</a>`).join('')}
    <button class="chip-btn" data-act="albumEdit">${trip.albums.length ? '✏️' : '＋ 外部アルバム URL'}</button></div>`;
}
ACT.albumEdit = () => {
  const t = curTrip();
  const row = (a) => `<div class="row gap set-row al-row"><input class="al-title" value="${esc(a.title)}" placeholder="タイトル"><input class="al-url grow" value="${esc(a.url)}" placeholder="https://..." inputmode="url"><button class="op" data-act="stRowDel">✕</button></div>`;
  openModal(`<div id="alRows">${t.albums.map(row).join('')}</div><button class="btn sm" data-act="albumAddRow">＋ 追加</button>
    <label class="b mt" style="display:block">代表写真のリンク（任意）</label><input id="alCover" value="${esc(t.coverLink || '')}" placeholder="写真の URL（代表に設定した写真が無い時に使う）" inputmode="url">
    <button class="btn primary block mt" data-act="albumSave">保存</button>`, { title: '📚 外部アルバム', data: { row } });
};
ACT.albumAddRow = () => { const { row } = topModal().data; $('#alRows', topModalBody()).insertAdjacentHTML('beforeend', row({ title: '', url: '' })); };
ACT.albumSave = () => {
  const t = curTrip(); const b = topModalBody();
  t.albums = $$('.al-row', b).map(r => ({ id: uid('al'), title: $('.al-title', r).value.trim() || 'アルバム', url: $('.al-url', r).value.trim() })).filter(a => /^https?:\/\//.test(a.url));
  t.coverLink = $('#alCover', b).value.trim();
  closeModal(); commitTrip(t);
};

function queueHTML(trip) {
  const list = MQ.items.filter(q => q.tripId === trip.id);
  if (!list.length) return '';
  const c = mqCounts(trip.id);
  const sendable = list.filter(q => q.state === 'held' || q.state === 'failed');
  return `<div class="card mq"><b>📤 アップロード</b><div class="muted small">保留 ${c.held}・送信待ち ${c.waiting}・送信中 ${c.sending}・失敗 ${c.failed}・完了 ${c.done}</div>
    ${list.map(queueRowHTML).join('')}
    <div class="row gap wrap mt">${sendable.length ? `<button class="btn sm primary" data-act="mqSendAll">保留・失敗をすべて送る（${sendable.length}）</button>` : ''}
    ${c.done ? '<button class="btn sm ghost" data-act="mqClearDone">完了を消す</button>' : ''}</div>
    <input type="file" id="mqRepick" style="display:none"></div>`;
}
function queueRowHTML(q) {
  const need = (q.state === 'held' || q.state === 'failed') && !MQ.files.has(q.qid);
  const pct = Math.round((q.progress || 0) * 100);
  return `<div class="mq-row st-${q.state}" id="mq-${q.qid}">
    <div class="row between"><span class="grow">${q.kind === 'video' ? '🎬' : '📷'} ${esc(q.name)} <span class="muted small">${fmtBytes(q.size)}</span></span><span class="mq-st">${MQ_LABEL[q.state]}</span></div>
    ${q.state === 'sending' || (q.state === 'failed' && q.offset) ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}
    ${q.error ? `<div class="small ${q.state === 'failed' ? 'ng' : 'warn'}">${esc(q.error)}</div>` : ''}
    ${q.state === 'held' ? '<div class="muted small">意図的に保留しています（送るボタンで送信）</div>' : ''}
    <div class="row gap">${need ? `<button class="btn sm" data-act="mqRepick" data-id="${q.qid}">ファイルを選び直す${q.offset ? '（' + fmtBytes(q.offset) + 'から再開）' : ''}</button>` : ''}
    ${(q.state === 'held' || q.state === 'failed') && !need ? `<button class="btn sm primary" data-act="mqSendOne" data-id="${q.qid}">${q.state === 'failed' ? '再試行' : '送る'}</button>` : ''}
    ${q.state === 'waiting' ? `<button class="btn sm" data-act="mqHold" data-id="${q.qid}">保留に戻す</button>` : ''}
    ${q.state !== 'sending' && q.state !== 'done' ? `<button class="btn sm ghost" data-act="mqDel" data-id="${q.qid}">取り消す</button>` : ''}</div></div>`;
}
function updateQueueRow(q) {
  const el = document.getElementById('mq-' + q.qid);
  if (!el) return;
  const pct = Math.round((q.progress || 0) * 100);
  const bar = el.querySelector('.progress > div');
  if (bar && q.state === 'sending') { bar.style.width = pct + '%'; const st = el.querySelector('.mq-st'); if (st) st.textContent = MQ_LABEL[q.state] + ' ' + pct + '%'; return; }
  el.outerHTML = queueRowHTML(q);
}
ACT.mqSendAll = () => { const t = curTrip(); mqSend(MQ.items.filter(q => q.tripId === t.id).map(q => q.qid)); };
ACT.mqSendOne = (el) => mqSend([el.dataset.id]);
ACT.mqHold = (el) => { const q = MQ.items.find(x => x.qid === el.dataset.id); if (q && q.state === 'waiting') { q.state = 'held'; mqSave(); render(); } };
ACT.mqDel = async (el) => { if (await confirmDialog('この送信を取り消しますか？（Drive にはまだ保存されていません）')) mqRemove(el.dataset.id); };
ACT.mqClearDone = () => { MQ.items = MQ.items.filter(q => q.state !== 'done'); mqSave(); render(); };
ACT.mqRepick = (el) => { const inp = $('#mqRepick'); inp.dataset.qid = el.dataset.id; inp.value = ''; inp.click(); };
document.addEventListener('change', (e) => {
  if (e.target.id !== 'mqRepick') return;
  const f = e.target.files[0]; const q = MQ.items.find(x => x.qid === e.target.dataset.qid);
  if (!f || !q) return;
  if (f.name !== q.name || f.size !== q.size) { toast('前と同じファイルを選んでください（' + q.name + '・' + fmtBytes(q.size) + '）'); return; }
  MQ.files.set(q.qid, f);
  q.state = 'waiting'; q.error = ''; mqSave(); render(); processQueue();
});

// 追加：ファイルを選ぶ → スポット（任意）と「今すぐ送る／保留」を選ぶ
ACT.mediaAdd = (el) => { const inp = $('#mediaPick'); inp.dataset.date = el.dataset.date || ''; inp.value = ''; inp.click(); };
document.addEventListener('change', (e) => {
  if (e.target.id !== 'mediaPick') return;
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const trip = curTrip();
  const date = e.target.dataset.date || '';
  const ms = S.settings.media || {};
  const kinds = new Set(files.map(mediaKind));
  const autoDefault = Array.from(kinds).every(k => k === 'video' ? ms.autoVideo : ms.autoPhoto);
  openModal(`<div>${files.length}件（写真 ${files.filter(f => mediaKind(f) === 'photo').length}・動画 ${files.filter(f => mediaKind(f) === 'video').length}・合計 ${fmtBytes(files.reduce((s, f) => s + f.size, 0))}）</div>
    <div class="form-grid mt"><label>スポット</label><select id="maSpot">${spotOptionsHTML(trip, '')}</select>
    <label>日付</label><select id="maDate"><option value="">撮影日時から自動</option>${tripDays(trip).map((d, i) => `<option value="${d}" ${d === date ? 'selected' : ''}>${i + 1}日目 ${fmtDate(d)}</option>`).join('')}</select></div>
    <div class="muted small mt">既定は「保留」です（設定で写真・動画ごとに自動送信にできます）。${(ms.confirmMB || 100)}MB 以上は送る前に確認します</div>
    <div class="row gap mt"><button class="btn ${autoDefault ? 'primary' : ''} grow" data-act="maGo" data-send="1">今すぐ送る</button><button class="btn ${autoDefault ? '' : 'primary'} grow" data-act="maGo" data-send="0">保留に入れる</button></div>`,
    { title: '📷 写真・動画を追加', data: { trip, files } });
});
ACT.maGo = async (el) => {
  const { trip, files } = topModal().data; const b = topModalBody();
  const sp = $('#maSpot', b).value; const date = $('#maDate', b).value;
  const [kind, id] = sp ? sp.split(':') : ['', ''];
  closeModal();
  const n = await addFilesToQueue(trip, files, { sendNow: el.dataset.send === '1', spotId: kind === 's' ? id : '', itemId: kind === 'i' ? id : '', date });
  toast(n + '件を' + (el.dataset.send === '1' ? '送信キューに入れました' : '保留に入れました'));
};
function spotOptionsHTML(trip, cur) {
  const opts = trip.items.filter(i => i.kind !== 'move').map(i => {
    const v = i.spotId ? 's:' + i.spotId : 'i:' + i.id;
    return `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>📍 ${esc(itemInfo(trip, i).name)}</option>`;
  });
  return `<option value="">紐付けない</option>` + opts.join('');
}
function mediaSpotValue(m) { return m.spotId ? 's:' + m.spotId : m.itemId ? 'i:' + m.itemId : ''; }
function mediaSpotName(trip, m) {
  if (m.spotId) { const it = trip.items.find(i => i.spotId === m.spotId); if (it) return itemInfo(trip, it).name; const sp = S.spots[m.spotId]; return sp ? sp.name : ''; }
  if (m.itemId) { const it = trip.items.find(i => i.id === m.itemId); return it ? itemInfo(trip, it).name : ''; }
  return '';
}

function mediaGridHTML(trip, list) {
  if (!list.length) return '';
  return `<div class="mgrid">${list.map(m => `<button class="mtile ${m.kind}" data-act="mediaOpen" data-id="${m.id}">
    ${mediaTileInner(m, 400)}
    ${m.kind === 'video' ? `<span class="mt-badge">▶ ${fmtDurMs(m.durationMs)}</span>` : ''}
    ${m.cover ? '<span class="mt-cover">代表</span>' : ''}${m.favorite ? '<span class="mt-fav">★</span>' : ''}</button>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// 拡大表示・編集（タップで拡大、動画はその場でプレビュー再生）
// ---------------------------------------------------------------------------
ACT.mediaOpen = (el) => openMediaViewer(curTrip(), el.dataset.id);
function openMediaViewer(trip, id) {
  const m = trip.media.find(x => x.id === id);
  if (!m) return;
  const p = previewState(m);
  const stage = m.kind === 'video'
    ? (p === 'ok' ? `<iframe class="mv-video" src="https://drive.google.com/file/d/${encodeURIComponent(m.fileId)}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : `<div class="mv-none">🎬<div>${p === 'none' ? 'この形式は Drive でプレビューできません（ProRes など）' : 'Drive で動画を処理中です。しばらくすると再生できます'}</div><a class="btn" href="${driveUrl(m)}" target="_blank" rel="noopener">Drive で開く</a></div>`)
    : `<div class="mv-img" id="mvImg"><div class="muted">読み込み中…</div></div>`;
  openModal(`${stage}
    <div class="row gap wrap mt">
      <button class="btn sm ${m.favorite ? 'primary' : ''}" data-act="mvFav">${m.favorite ? '★ お気に入り' : '☆ お気に入り'}</button>
      ${m.kind === 'photo' ? `<button class="btn sm ${m.cover ? 'primary' : ''}" data-act="mvCover">${m.cover ? '代表写真です' : '代表に設定'}</button>` : ''}
      <a class="btn sm" href="${driveUrl(m)}" target="_blank" rel="noopener">Drive で開く</a>
      <button class="btn sm danger" data-act="mvDel">削除</button></div>
    <div class="form-grid mt">
      <label>日付</label><div class="row gap"><input type="date" id="mvDate" value="${esc(m.date || '')}"><span class="muted small">${m.dateSource === 'exif' ? '撮影日時（EXIF）' : m.dateSource === 'manual' ? '手動' : 'アップロード日'}${m.takenAt ? ' ' + esc(m.takenAt.replace('T', ' ').slice(0, 16)) : ''}</span></div>
      <label>スポット</label><select id="mvSpot">${spotOptionsHTML(trip, mediaSpotValue(m))}</select>
      <label>コメント</label><textarea id="mvComment" rows="2">${esc(m.comment || '')}</textarea>
    </div>
    <div class="muted small">${esc(m.name)}・${fmtBytes(m.size)}${m.width ? '・' + m.width + '×' + m.height : ''}${m.durationMs ? '・' + fmtDurMs(m.durationMs) : ''}</div>
    <button class="btn primary block mt" data-act="mvSave">保存</button>`,
    { title: (m.kind === 'video' ? '🎬 ' : '📷 ') + esc(m.name), full: true, data: { trip, m },
      onMount: async (body) => {
        if (m.kind !== 'photo') return;
        try {
          const src = await fetchBigImage(m, 1600);
          const box = $('#mvImg', body); if (!box) return;
          box.innerHTML = src ? `<img src="${src}" alt="">` : `<div class="mv-none">📷<div>${esc(m.name)}</div><div class="muted small">サムネイルを作れませんでした</div><a class="btn" href="${driveUrl(m)}" target="_blank" rel="noopener">Drive で開く</a></div>`;
        } catch (e) { const box = $('#mvImg', body); if (box) box.textContent = e.message; }
      } });
}
ACT.mvFav = () => { const { trip, m } = topModal().data; m.favorite = !m.favorite; commitTrip(trip); closeModal(); openMediaViewer(trip, m.id); };
ACT.mvCover = () => {
  const { trip, m } = topModal().data;
  const on = !m.cover;
  trip.media.forEach(x => { x.cover = false; });
  m.cover = on;
  commitTrip(trip); closeModal(); openMediaViewer(trip, m.id);
  if (on) toast('代表写真にしました（旅行一覧・年別レポートでも使います）');
};
ACT.mvSave = () => {
  const { trip, m } = topModal().data; const b = topModalBody();
  const d = $('#mvDate', b).value;
  if (d !== (m.date || '')) { m.date = d; m.dateSource = 'manual'; }
  const sp = $('#mvSpot', b).value; const [k, id] = sp ? sp.split(':') : ['', ''];
  m.spotId = k === 's' ? id : ''; m.itemId = k === 'i' ? id : '';
  m.comment = $('#mvComment', b).value;
  closeModal(); commitTrip(trip);
};
ACT.mvDel = async () => {
  const { trip, m } = topModal().data;
  if (!(await confirmDialog('このメディアを削除しますか？\nDrive のファイルもゴミ箱へ移します（30日以内なら Drive のゴミ箱から戻せます）'))) return;
  try { await api('mediaTrash', { fileId: m.fileId }); }
  catch (e) { if (!(await confirmDialog('Drive のゴミ箱へ移せませんでした（' + e.message + '）。旅帳からだけ外しますか？'))) return; }
  trip.media = trip.media.filter(x => x !== m);
  Object.values(trip.visual.dayPicks || {}).forEach(arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] === m.id) arr.splice(i, 1); });
  if (trip.visual.coverMediaId === m.id) trip.visual.coverMediaId = '';
  closeModal(); commitTrip(trip); toast('削除しました');
};

// ---------------------------------------------------------------------------
// デモモード（GAS に置く前）の模擬アップロード。サムネイルは端末で作る
// ---------------------------------------------------------------------------
function isMockUri(u) { return /^mock-upload:/.test(u || ''); }
let mockThumbMaker = null;
if (!IS_GAS) {
  mockThumbMaker = async (qid, f) => {
    if (mediaKind(f) !== 'photo' || typeof createImageBitmap !== 'function') return;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      MockMedia.pendingThumbs[qid] = c.toDataURL('image/jpeg', 0.8);
    } catch (e) {}
  };
}
async function mockPut(q, file, start, end) {
  await new Promise(r => setTimeout(r, 60));
  if (end + 1 >= file.size) {
    const fo = MockMedia.finish(q, file);
    return { status: 200, body: JSON.stringify(fo) };
  }
  return { status: 308, range: 'bytes=0-' + end };
}
async function mockStatus(q, file) { return { offset: q.offset || 0 }; }
