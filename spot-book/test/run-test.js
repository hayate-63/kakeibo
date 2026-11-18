const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { makeEnv } = require('./gasmock');
const REPO = path.join(__dirname, '..');
const CSV = process.argv[2];
const OUT = path.join(require('os').tmpdir(), 'spotbook-test-out'); fs.mkdirSync(OUT, { recursive: true });
const VER = process.env.SPOT_VER || '3.1';   // 検証する版（index-v◯.html／gas-v◯.gs）
const V2 = Number(VER.split('.')[0]) >= 2;
const V3 = Number(VER.split('.')[0]) >= 3;
const V31 = parseFloat(VER) >= 3.1;
const ocrCtl = { text: '' };   // v3.1 検証用：OCR の結果（実 OCR は実 GAS でしか動かない）
const ctl = { delay: 0, fail: null };   // v3.0 検証用：応答を遅らせる／通信を切る
const V201 = V2 && fs.readFileSync(path.join(__dirname, '..', 'gas-v' + VER + '.gs'), 'utf8').includes('pin_default');
const PIN = 'Ab-123xy!'; // v1.0.1：英字＋記号混じりのパスワード

function parseCsv(text) { text = text.replace(/^﻿/, ''); const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c; }
  if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows.filter(r => r.length > 1 || r[0] !== ''); }
const csvRows = parseCsv(fs.readFileSync(CSV, 'utf8'));
const H = csvRows[0]; const csvSpots = csvRows.slice(1).map(r => Object.fromEntries(H.map((h, i) => [h, r[i]])));
const kyotoCafe = csvSpots.find(s => s.prefecture === '京都府' && s.categories.split('/').includes('カフェ') && s.place_id);

// Places API のモック
const NEW_PID = 'ChIJ_TEST_NEW_RAMEN_0001';
const fetchMock = (url, o) => {
  const resp = (code, obj) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(obj), getHeaders: () => ({}) });
  if (url.includes('places:searchText') && /座標の無い/.test((o && o.payload) || '')) return resp(200, { places: [] });
  if (url.includes('places:searchText')) return resp(200, { places: [
    { id: kyotoCafe.place_id, displayName: { text: kyotoCafe.name }, formattedAddress: kyotoCafe.address, location: { latitude: +kyotoCafe.lat, longitude: +kyotoCafe.lng }, types: ['cafe', 'food'] },
    { id: NEW_PID, displayName: { text: 'テスト中華そば 四日市店' }, formattedAddress: '日本、〒510-0001 三重県四日市市テスト町1-2', location: { latitude: 34.97, longitude: 136.62 }, types: ['ramen_restaurant', 'restaurant', 'food'] } ] });
  if (url.includes('places/')) {
    const id = decodeURIComponent(url.split('places/')[1].split('?')[0]);
    if (id === NEW_PID) return resp(200, { id, displayName: { text: 'テスト中華そば 四日市店' }, formattedAddress: '日本、〒510-0001 三重県四日市市テスト町1-2', location: { latitude: 34.97, longitude: 136.62 }, types: ['ramen_restaurant', 'restaurant', 'food'], primaryType: 'ramen_restaurant',
      addressComponents: [{ longText: '三重県', types: ['administrative_area_level_1'] }, { longText: '四日市市', types: ['locality'] }], googleMapsUri: 'https://maps.google.com/?cid=123456789' });
    return resp(200, { id, displayName: { text: kyotoCafe.name }, formattedAddress: kyotoCafe.address, location: { latitude: +kyotoCafe.lat, longitude: +kyotoCafe.lng }, types: ['cafe'], addressComponents: [{ longText: '京都府', types: ['administrative_area_level_1'] }], googleMapsUri: 'https://maps.google.com/?cid=1' });
  }
  if (url.includes('nominatim.openstreetmap.org/search')) return resp(200, url.includes(encodeURIComponent('三重県四日市市テスト住所')) ? [{ lat: '34.95', lon: '136.60' }] : []);
  return resp(404, {});
};
const env = makeEnv({ gasPath: path.join(REPO, 'gas-v' + VER + '.gs'), pin: PIN, fetch: fetchMock, ocr: ocrCtl });
// setConfig でAPIキーはアプリから入れる

const html = fs.readFileSync(path.join(REPO, 'index-v' + VER + '.html'));
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      if (ctl.fail === 'drop') { req.socket.destroy(); return; }
      const out = JSON.stringify(env.doPost(Buffer.concat(chunks).toString('utf8')));
      setTimeout(() => { res.setHeader('Content-Type', 'application/json'); res.end(out); }, ctl.delay);
    });  // 多バイト文字がチャンク境界で割れないよう Buffer で結合
    return;
  }
  if (req.url.startsWith('/exec')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(env.doGet())); return; }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };

// JPEG の幅・高さ（SOF マーカー）を読む
function jpegSize(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) return null;
    const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (m >= 0xC0 && m <= 0xC3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

// ==================== v3.0：スピナー・結果表示・名称/ジャンル絞り込み・ジャンル判定・座標補完・上部UI ====================
async function testV3(page, env, dialogs) {
  const { makeEnv } = require('./gasmock');
  const call = o => env.doPost(JSON.stringify(Object.assign({ pin: PIN }, o)));
  const spotsSheet = () => env.ss.getSheetByName('spots')._data;
  const rowOf = id => spotsSheet().find(r => r[0] === id);
  const C = h => H.indexOf(h);
  await page.evaluate(() => { closeAllViews(); hideFailBanner(); switchTab('home'); });
  // 表示の記録（スピナーの出入り・トースト・バナー）
  await page.evaluate(() => {
    window.__log = [];
    const busyEl = document.getElementById('busy'), t = document.getElementById('toast');
    new MutationObserver(() => window.__log.push({ k: 'busy', on: busyEl.classList.contains('show'), label: document.getElementById('busyLabel').textContent, t: performance.now() })).observe(busyEl, { attributes: true });
    new MutationObserver(() => { if (t.classList.contains('show')) window.__log.push({ k: 'toast', text: t.textContent, ok: t.classList.contains('ok'), t: performance.now() }); }).observe(t, { attributes: true });
  });
  const log = () => page.evaluate(() => window.__log.splice(0));
  const busyOn = () => page.$eval('#busy', e => e.classList.contains('show'));

  // ---- L1 追加・編集・削除の間スピナー、L4 下を押せない、L6 成功トースト ----
  ctl.delay = 700;
  const p1 = page.evaluate(() => saveSpot({ id: '', place_id: '', name: 'スピナー確認の店', prefecture: '三重県', city: '', categories: 'グルメ', tags: '', regions: '', rep_tag: '', address: '', lat: '34.9', lng: '136.6', maps_url: '', status: '行きたい', rating: '', memo: '', google_saved: '対象外', coord_source: '', source_lists: '', created_at: '', updated_at: '', _classified: true }, true));
  await page.waitForTimeout(250);
  const during = await busyOn();
  const label1 = await page.textContent('#busyLabel');
  const blocked = await page.evaluate(() => { const n = document.querySelector('.nav-item[data-tab="map"]').getBoundingClientRect(); const el = document.elementFromPoint(n.x + n.width / 2, n.y + n.height / 2); return !!(el && el.closest('#busy')); });
  const added = await p1;
  const afterAdd = await busyOn();
  let lg = await log();
  check('L1a スポット追加の間、中央にスピナー「保存中…」→ 完了で消える', during && label1 === '保存中…' && !afterAdd && added && added.id, label1);
  check('L4 スピナー表示中は下のボタン（下部タブ）が押せない', blocked);
  const okT = lg.find(x => x.k === 'toast');
  check('L6a 保存成功で緑のトースト「✓ スポットを保存しました」', okT && okT.ok && okT.text === '✓ スポットを保存しました', okT && okT.text);
  const busyEnd = lg.filter(x => x.k === 'busy' && !x.on).pop(), toastAt = okT && okT.t;
  check('L6b 順序：スピナーが消えてから結果を表示', busyEnd && toastAt && toastAt >= busyEnd.t - 5);
  await page.waitForTimeout(2800);
  check('L6c トーストは2.5秒で自動で消える', !(await page.$eval('#toast', e => e.classList.contains('show'))));
  const pu = page.evaluate(id => saveSpot(Object.assign({}, getSpot(id), { memo: '更新テスト' }), false), added.id);
  await page.waitForTimeout(250); const duringU = await busyOn(); await pu;
  const pd = page.evaluate(id => api('deleteSpot', { id }), added.id);
  await page.waitForTimeout(250); const duringD = await busyOn(); await pd;
  await page.evaluate(id => { state.spots = state.spots.filter(s => s.id !== id); }, added.id);
  lg = await log();
  check('L1b 編集・削除の間もスピナー（トースト「更新しました」「削除しました」）', duringU && duringD && lg.some(x => x.text === '✓ スポットを更新しました') && lg.some(x => x.text === '✓ スポットを削除しました'), lg.filter(x => x.k === 'toast').map(x => x.text).join(','));

  // ---- L2・L7 同期中のスピナーと「同期しました（◯件）」 ----
  const ps = page.evaluate(() => syncFromCloud(true));
  await page.waitForTimeout(250);
  const syncLabel = await page.textContent('#busyLabel'); const syncOn = await busyOn();
  await ps; ctl.delay = 0;
  lg = await log();
  const n = spotsSheet().length - 1;
  check('L2 同期（再読み込み）の間「同期中…」のスピナー', syncOn && syncLabel === '同期中…', syncLabel);
  check('L7 同期成功で「同期しました（' + n + '件）」', lg.some(x => x.text === '✓ 同期しました（' + n + '件）'), lg.filter(x => x.k === 'toast').map(x => x.text).join(','));

  // ---- 最低300ms表示（一瞬の通信でもチカチカしない） ----
  await page.evaluate(() => api('ping'));
  lg = await log();
  const on = lg.find(x => x.k === 'busy' && x.on), off = lg.find(x => x.k === 'busy' && !x.on);
  check('L1c 一瞬で終わる通信でもスピナーは最低300ms表示', on && off && off.t - on.t >= 290, on && off ? Math.round(off.t - on.t) + 'ms' : '');

  // ---- L3・L8 通信失敗：スピナーは消え、赤バナーが残る → 再試行で復旧 ----
  ctl.fail = 'drop';
  await page.evaluate(() => syncFromCloud(true));
  const stuck = await busyOn();
  await page.waitForTimeout(3000);
  const banner = await page.$eval('#failBanner', e => e.classList.contains('show') ? e.textContent : '');
  check('L3 通信エラー時もスピナーが残りっぱなしにならない', !stuck);
  check('L8a 失敗は赤バナー（何が・理由・次の行動）で、3秒たっても残る', /同期に失敗しました/.test(banner) && /通信できませんでした/.test(banner) && /再試行/.test(banner), banner.slice(0, 80));
  await page.screenshot({ path: path.join(OUT, '40-fail-banner.png') });
  ctl.fail = null;
  await page.click('#failBanner .fbRetry');
  await page.waitForFunction(() => !document.getElementById('failBanner').classList.contains('show') && /☁️/.test(document.getElementById('syncBadge').textContent));
  lg = await log();
  check('L8b ［再試行］で同期が復旧（バナーが消えて「同期しました」）', lg.some(x => /同期しました/.test(x.text || '')));
  // 保存の失敗：フォームを閉じず入力を保持
  await page.evaluate(() => { closeAllViews(); openEdit(getSpot('SP0003'), false); });
  await page.fill('.view .fMemo', '保存失敗テストの入力');
  ctl.fail = 'drop';
  await page.click('.view .fSave');
  await page.waitForSelector('#failBanner.show');
  const kept = await page.$eval('.view .fMemo', e => e.value).catch(() => null);
  const fb = await page.textContent('#failBody');
  check('L8c 保存の失敗：バナー「スポットの更新に失敗しました」＋入力は残ったまま', kept === '保存失敗テストの入力' && /スポットの更新に失敗しました/.test(fb) && /入力内容はそのまま/.test(fb), fb.slice(0, 60));
  ctl.fail = null;
  await page.click('.view .fSave');
  await page.waitForFunction(() => !document.querySelector('.view .fSave'));
  check('L8d 直してもう一度保存できる', rowOf('SP0003')[C('memo')] === '保存失敗テストの入力');
  await page.evaluate(() => hideFailBanner());
  // AUTH の理由文
  const authReason = await page.evaluate(() => failReason({ code: 'AUTH' }));
  check('L8e AUTH の理由「パスワードが一致しません。設定タブで確認してください」', /パスワードが一致しません。設定タブで確認/.test(authReason));

  // ---- 項目3 名称検索＋ジャンルフィルター（県ページ・思い出ノート） ----
  await page.evaluate(() => { closeAllViews(); openPref('三重県'); });
  const total = await page.$$eval('.view .listHost .spot-row', r => r.length);
  await page.fill('.view .fltQ', 'ラーメン');
  const byName = await page.$$eval('.view .listHost .spot-row', r => r.length);
  const cntTxt = await page.textContent('.view .lcnt');
  const expectName = await page.evaluate(() => state.spots.filter(s => s.prefecture === '三重県' && norm(s.name).includes(norm('ラーメン'))).length);
  check('F1 県ページ：店名の部分一致で絞り込み・「◯件中◯件を表示」', byName === expectName && cntTxt === total + '件中 ' + byName + '件を表示' && byName < total, cntTxt);
  await page.fill('.view .fltQ', '');
  await page.click('.view .flt-genres .toggle-chip[data-g="焼肉"]');
  await page.click('.view .flt-genres .toggle-chip[data-g="寿司"]');
  const g2 = await page.$$eval('.view .listHost .spot-row', r => r.length);
  const expectG = await page.evaluate(() => state.spots.filter(s => s.prefecture === '三重県' && splitList(s.tags).some(t => ['焼肉', '寿司'].includes(t))).length);
  await page.selectOption('.view .vfSel', 'unvisited');
  const g3 = await page.$$eval('.view .listHost .spot-row', r => r.length);
  const expectG3 = await page.evaluate(() => state.spots.filter(s => s.prefecture === '三重県' && splitList(s.tags).some(t => ['焼肉', '寿司'].includes(t)) && !isVisited(s)).length);
  check('F2 ジャンル複数選択は OR（焼肉 or 寿司）・訪問済フィルターと AND', g2 === expectG && g3 === expectG3 && g2 > 0, g2 + '/' + g3);
  await page.screenshot({ path: path.join(OUT, '41-pref-filter.png') });
  // 思い出ノート：訪問を2件作ってジャンル・名称で絞る
  const ramenMie = await page.evaluate(() => state.spots.find(s => s.prefecture === '三重県' && splitList(s.tags).includes('ラーメン') && !isVisited(s)).id);
  const yakiMie = await page.evaluate(() => state.spots.find(s => s.prefecture === '三重県' && splitList(s.tags).includes('焼肉') && !isVisited(s)).id);
  for (const id of [ramenMie, yakiMie]) await page.evaluate(id => saveVisit({ spot_id: id, date: '2026-11-18', rating: '4', menu: '', price: '', companions: '', people: '', comment: '', photos: '', repeat: '' }, true, [], []), id);
  await page.evaluate(() => { closeAllViews(); openMemories(); });
  const allTl = await page.$$eval('.view .tl-item', r => r.length);
  const sumBefore = await page.$$eval('.view .summary-grid .sv b', b => b.map(x => x.textContent).join(','));
  await page.click('.view .flt-genres .toggle-chip[data-g="焼肉"]');
  const tlG = await page.$$eval('.view .tl-item', r => r.length);
  const mcnt = await page.textContent('.view .mcnt');
  const sumAfter = await page.$$eval('.view .summary-grid .sv b', b => b.map(x => x.textContent).join(','));
  check('F3 思い出ノート：訪問したスポットのタグで絞り込み・「◯件中◯件を表示」・サマリーは全体のまま', tlG >= 1 && tlG < allTl && mcnt === allTl + '件中 ' + tlG + '件を表示' && sumBefore === sumAfter, mcnt);
  await page.click('.view .flt-genres .toggle-chip[data-g="焼肉"]');
  const nm = await page.evaluate(id => getSpot(id).name.slice(0, 3), ramenMie);
  await page.fill('.view .fltQ', nm);
  const tlQ = await page.$$eval('.view .tl-item', r => r.length);
  check('F4 思い出ノート：店名で絞り込み（入力は画面を開いている間保持）', tlQ >= 1 && tlQ < allTl && await page.$eval('.view .fltQ', e => e.value) === nm, nm + ':' + tlQ);
  await page.screenshot({ path: path.join(OUT, '42-memories-filter.png') });

  // ---- 項目4 ジャンル（マスタ・移行・判定・確認カード・再判定） ----
  const master = env.doPost(JSON.stringify({ action: 'getAll', pin: PIN })).tags;
  const genres = master.filter(t => t.type === 'ジャンル');
  check('G1 ジャンル114種＋旧2種がマスタに入り、判定キーワード・Places種別・グループを持つ', genres.length === 116 && genres.find(t => t.name === 'つけ麺').group === '麺' && /つけ麺/.test(genres.find(t => t.name === 'つけ麺').keywords) && genres.find(t => t.name === '寿司').placeTypes === 'sushi_restaurant');
  check('G1b 既存ジャンルの絵文字は変えない（うなぎ📌・すき焼き🥓・スキー場🏂・美容💉・車 写真撮影場所📸）', ['うなぎ:📌', 'すき焼き:🥓', 'スキー場:🏂', '美容:💉', '車 写真撮影場所:📸'].every(x => { const [n, e] = x.split(':'); return genres.find(t => t.name === n).emoji === e; }));
  // v2.0 のDBに v3.0 GAS → tags 移行
  const v2 = makeEnv({ gasPath: path.join(REPO, 'gas-v2.0.gs'), pin: PIN, fetch: () => {} });
  v2.doPost(JSON.stringify({ action: 'importSpots', pin: PIN, rows: csvSpots.slice(0, 5) }));
  v2.ss.getSheetByName('tags')._data.find(r => r[0] === 'ラーメン')[1] = '🍥';   // 本人が絵文字を変えていた場合
  const v3 = makeEnv({ gasPath: path.join(REPO, 'gas-v3.0.gs'), pin: PIN, fetch: () => {}, ss: v2.ss, props: v2.props });
  const g3m = v3.doPost(JSON.stringify({ action: 'getAll', pin: PIN }));
  const tg = g3m.tags, names = tg.map(t => t.name);
  check('G2 v2.0 のDBに v3.0 GAS を載せると tags に列とジャンルを追加（重複なし・本人の絵文字は保持・代表優先順は確定版）',
    v2.ss.getSheetByName('tags')._data[0][5] === '判定キーワード' && tg.length === 129 && new Set(names).size === names.length &&
    tg.find(t => t.name === 'ラーメン').emoji === '🍥' && tg.find(t => t.name === '中華').repPriority === 27 && tg.find(t => t.name === '定期').group === 'その他' && g3m.spots.length === 5,
    tg.length + ' / 中華=' + (tg.find(t => t.name === '中華') || {}).repPriority);
  v3.doPost(JSON.stringify({ action: 'getAll', pin: PIN }));
  check('G2b 移行は1回だけ（2回目のアクセスで行が増えない）', v2.ss.getSheetByName('tags').getLastRow() - 1 === 129);
  const cl = (name, cats, types) => call({ action: 'classifyGenres', name, categories: cats || '', types: types || [] }).tags.join(',');
  const cases = [
    ['中華そば らんまん', 'グルメ', 'ラーメン'], ['ブロッケンバーガー', 'グルメ', 'ハンバーガー'], ['あわじ島アイスクリーム専用第二駐車場', 'その他', '駐車場'],
    ['麺屋 そば吉', 'グルメ', 'そば'], ['麺屋RiSA', 'グルメ', 'ラーメン'], ['カンデオホテルズ大阪ザ・タワー', '宿', ''], ['五稜郭タワー', '観光地', '展望台・タワー'],
    ['〒510-0943 三重県四日市市西日野町６０４', 'グルメ', ''], ['ラッキーピエロ 五稜郭公園前店', 'グルメ', ''], ['台湾ラーメン江楽', 'グルメ', 'ラーメン'],
    ['Grill＆Bar SILLY BILLY with craftbeer', 'グルメ', 'バー,クラフトビール'], ['姫路城', '観光地', '城'], ['トラストパーク太融寺 駐車場', 'その他', '駐車場'],
    ['京うどん錦', 'グルメ', 'うどん'], ['なにかの店', 'グルメ', '寿司', ['sushi_restaurant']]
  ];
  const bad = cases.filter(c => cl(c[0], c[1], c[3]) !== c[2]).map(c => c[0] + '→' + cl(c[0], c[1], c[3]));
  check('G3 classifyGenres の判定（誤爆しない：中華そば≠そば・バーガー≠バー・駐車場は駐車場だけ・住所名は判定しない 等15例）', bad.length === 0, bad.join(' | '));
  // 確認カード：自動判定タグを外して保存 → 外したまま（GAS が勝手に戻さない）
  await page.evaluate(() => { closeAllViews(); switchTab('add'); });
  await page.fill('#addQuery', 'テスト'); await page.click('#page-add .search-row .btn >> nth=0');
  await page.waitForSelector('#addCandidates .spot-row[data-i="1"]');
  await page.click('#addCandidates .spot-row[data-i="1"]');
  await page.waitForSelector('.view .fSave');
  const cardTxt = await page.textContent('.view .view-body');
  const grpOpen = await page.$eval('.view .fTags details[data-g="麺"]', d => d.open);
  check('G4a 確認カードに自動判定のジャンル（ラーメン）を表示・グループ別（麺が開いている）', /ジャンル＝ラーメン/.test(cardTxt) && grpOpen, cardTxt.match(/自動判定[^<]{0,40}/) && cardTxt.match(/自動判定[^<]{0,40}/)[0]);
  await page.screenshot({ path: path.join(OUT, '43-confirm-genres.png') });
  await page.click('.view .fTags .toggle-chip[data-v="ラーメン"]');
  await page.click('.view .fTags .toggle-chip[data-v="つけ麺"]');
  await page.click('.view .fSave');
  await page.waitForFunction(() => !document.querySelector('.view .fSave') || document.querySelector('#failBanner.show'));
  const nr = spotsSheet().find(r => r[2] === 'テスト中華そば 四日市店');
  check('G4b 確認カードでラーメンを外し、つけ麺を付けて保存 → そのとおり保存（再判定で戻さない）', nr && nr[C('tags')] === 'つけ麺' && nr[C('rep_tag')] === 'つけ麺', nr && nr[C('tags')]);
  if (nr) { call({ action: 'deleteSpot', id: nr[0] }); await page.evaluate(id => { state.spots = state.spots.filter(s => s.id !== id); }, nr[0]); }
  // 手入力（判定前）→ addSpot で GAS が判定して合体、座標は住所から補完
  dialogs.length = 0;
  await page.evaluate(() => { closeAllViews(); openNewManual(); });
  const warnTxt = await page.$eval('.view .notice.warn', e => e.textContent).catch(() => '');
  await page.fill('.view .fName', 'テスト焼肉 じゅうじゅう');
  await page.fill('.view .fAddr', '三重県四日市市テスト住所1-1');
  await page.click('.view .fTags details[data-g="属性"] summary');
  await page.click('.view .fTags .toggle-chip[data-v="デート"]');
  await page.click('.view .fCats .toggle-chip[data-v="グルメ"]');
  await page.click('.view .fSave');
  await page.waitForFunction(() => !document.querySelector('.view .fSave'));
  const mr = spotsSheet().find(r => r[2] === 'テスト焼肉 じゅうじゅう');
  check('C1 座標なしの新規は確認画面で「地図に表示されません」と明示', /地図に表示されません/.test(warnTxt), warnTxt.slice(0, 40));
  check('G5 手入力の新規：GAS が店名から判定して本人のタグと合体（デート＋焼肉）', mr && mr[C('tags')] === 'デート/焼肉' && mr[C('rep_tag')] === '焼肉', mr && mr[C('tags')] + ' rep=' + mr[C('rep_tag')]);
  check('C2 保存前の座標補完：住所 → ジオコーディングで座標が入り地図に出る', mr && mr[C('lat')] === '34.95' && mr[C('coord_source')] === 'Nominatim', mr && mr[C('lat')] + ' ' + mr[C('coord_source')]);
  // 座標が取れない新規 → 確認して保存するか選べる
  dialogs.length = 0;
  await page.evaluate(() => { closeAllViews(); openNewManual(); });
  await page.fill('.view .fName', '座標の無いテスト店');
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { dialogs.push(d.message()); if (/座標が見つかりませんでした/.test(d.message())) await d.dismiss(); else await d.accept(); });
  await page.click('.view .fSave');
  await page.waitForTimeout(800);
  const stillOpen = !!(await page.$('.view .fSave'));
  page.removeAllListeners('dialog');
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept('テスト地域'); else await d.accept(); });
  check('C3 座標が見つからない新規は「地図には表示されません。保存しますか？」で止められる（「選び直す」導線あり）', stillOpen && dialogs.some(d => /座標が見つかりませんでした/.test(d)) && !!(await page.$('.view .fRepick')), dialogs.join('|').slice(0, 80));
  await page.click('.view .fRepick');
  await page.waitForFunction(() => /候補|登録済み/.test(document.getElementById('addCandidates').textContent));
  check('C3b 「店名で検索して選び直す」→ 追加タブで入力中の店名を検索', await page.$eval('#addQuery', e => e.value) === '座標の無いテスト店' && await page.evaluate(() => state.currentTab) === 'add');
  await page.evaluate(() => closeAllViews());
  // 座標の自動補完（設定タブ）：URL に座標がある行・店名で Places 検索できる行
  call({ action: 'importSpots', rows: [{ name: 'URLに座標がある店', maps_url: 'https://www.google.com/maps/search/35.1234,136.5678', categories: 'その他', prefecture: '三重県' }], dedupeWithinBatch: true });
  await page.evaluate(() => syncFromCloud(false, true));
  const noc = await page.evaluate(() => state.spots.filter(s => !hasCoord(s)).map(s => s.name));
  await page.evaluate(() => switchTab('settings'));
  await page.click('button:has-text("📍 座標を自動補完")');
  await page.waitForFunction(() => /座標を補完しました/.test(document.getElementById('maintResult').textContent));
  const after = await page.evaluate(() => state.spots.filter(s => !hasCoord(s)).length);
  const urlRow = spotsSheet().find(r => r[2] === 'URLに座標がある店');
  check('C4 ［座標を自動補完］で座標なしスポットを補完（URL→' + noc.length + '件中）', after === 0 && urlRow[C('lat')] === '35.1234' && urlRow[C('coord_source')] === 'URL', noc.join(',') + ' → 残り' + after);
  // 地図：件数表示とリセット
  await page.evaluate(() => openMapWith({ pref: '京都府', cat: 'カフェ' }));
  await page.waitForTimeout(400);
  const mc = await page.textContent('#mapCount');
  await page.click('button:has-text("絞り込みリセット")');
  await page.waitForTimeout(300);
  const mc2 = await page.textContent('#mapCount');
  const all = spotsSheet().length - 1;
  check('C5 地図上部「全◯件中 ◯件を表示中」＋リセットで全件に戻る', mc === '全' + all + '件中 11件を表示中' && mc2 === '全' + all + '件中 ' + all + '件を表示中' && await page.$eval('#mapPref', e => e.value) === '', mc + ' → ' + mc2);
  await page.screenshot({ path: path.join(OUT, '44-map-count.png') });
  // ジャンル再判定（設定タブ）
  const udon = csvSpots.find(s => s.name === '手打ち ごえもんうどん').id;
  await page.evaluate(() => switchTab('settings'));
  await page.click('button:has-text("ジャンル再判定")');
  await page.waitForFunction(() => /個のタグを追加しました/.test(document.getElementById('maintResult').textContent));
  const rr = await page.textContent('#maintResult');
  check('G6a ［ジャンル再判定］で不足タグを追加（「◯件のスポットに◯個のタグを追加しました」）', /^\d+件のスポットに\d+個のタグを追加しました/.test(rr) && rowOf(udon)[C('tags')].split('/').includes('うどん') && rowOf(udon)[C('rep_tag')] === 'うどん', rr.slice(0, 40) + ' / ' + rowOf(udon)[C('tags')]);
  const keepRep = rowOf('SP0001')[C('rep_tag')];
  const again = call({ action: 'reclassifyAll' });
  check('G6b 再実行しても追加0件（追加のみ・削除なし・手で付けたタグや代表タグはそのまま）', again.spots === 0 && rowOf('SP0001')[C('rep_tag')] === keepRep, JSON.stringify({ s: again.spots, a: again.added }));
  // ジャンルタブ・地図のグループ表示
  await page.evaluate(() => switchTab('genre'));
  const heads = await page.$$eval('#genreTags .grp-name', h => h.map(x => x.textContent.replace(/（.*/, '')));
  check('G7 ジャンルタブはグループ見出し（麺／和食／肉／各国／カフェ・甘味／酒／癒し／観光／アウトドア／宿／買い物／実用／属性…）', ['麺', '和食', '肉', '各国', 'カフェ・甘味', '酒', '癒し', '観光', 'アウトドア', '宿', '買い物', '実用', '属性'].every(g => heads.includes(g)) && heads.indexOf('麺') < heads.indexOf('属性'), heads.join(','));
  await page.screenshot({ path: path.join(OUT, '45-genre-groups.png'), fullPage: false });
  await page.evaluate(() => switchTab('map'));
  const og = await page.$$eval('#mapTag optgroup', o => o.map(x => x.label));
  check('G8 地図のタグ選択もグループ（optgroup）', og.includes('麺') && og.includes('地域'), og.slice(0, 5).join(','));

  // ---- 項目6 上部UI ----
  const ui = await page.evaluate(() => {
    const meta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content;
    const hdr = document.querySelector('header');
    const mf = document.getElementById('mapFilters');
    const alpha = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    openMemories();
    const back = document.querySelector('.view .back').getBoundingClientRect();
    const vh = document.querySelector('.view .view-header');
    const res = { meta, backH: back.height, mfTop: getComputedStyle(mf).top, hdrH: hdr.offsetHeight, hdrA: alpha(getComputedStyle(hdr).backgroundColor), vhA: alpha(getComputedStyle(vh).backgroundColor), vhH: vh.offsetHeight };
    closeAllViews();
    return res;
  });
  check('U1 ステータスバーは不透明（black）', ui.meta === 'black', ui.meta);
  check('U2 戻るボタンの高さ44px以上', ui.backH >= 44, ui.backH + 'px');
  check('U3 地図フィルターの sticky 位置＝ヘッダーの実高さ（重なり・隙間なし）', ui.mfTop === ui.hdrH + 'px', ui.mfTop + ' vs ' + ui.hdrH);
  check('U4 ヘッダー類の背景は完全に不透明', ui.hdrA === 1 && ui.vhA === 1);
  await page.evaluate(() => { closeAllViews(); openPref('京都府'); });
  await page.screenshot({ path: path.join(OUT, '46-view-header.png'), clip: { x: 0, y: 0, width: 390, height: 200 } });
  await page.evaluate(() => { closeAllViews(); switchTab('settings'); hideFailBanner(); });
}

// ==================== v3.1：スクショから追加（OCR）・クリップボード貼り付け ====================
async function testV31(page, env, dialogs, browser, ctx) {
  const call = o => env.doPost(JSON.stringify(Object.assign({ pin: PIN }, o)));
  const spotsSheet = () => env.ss.getSheetByName('spots')._data;
  const ocrTemps = () => Object.values(env.DriveApp._files).filter(f => /^スポット帳OCR一時_/.test(f.getName()));
  await page.evaluate(() => { closeAllViews(); hideFailBanner(); switchTab('add'); });
  // S6 古い表示が消え、ボタンが押せる
  const addTxt = await page.textContent('#page-add');
  check('S6 「v1.1で対応」の表示が消え、［画像を選ぶ］が押せる', !/v1\.1で対応/.test(addTxt) && !(await page.$eval('#ocrPick', b => b.disabled)));
  // Googleマップの店舗画面を模した画像
  const shot = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await shot.setContent('<body style="font-family:sans-serif;margin:0"><div style="padding:8px">13:59 5G 80%</div><h1 style="padding:16px">テスト中華そば 四日市店</h1><p style="padding:0 16px">4.5 ★★★★★ (120)・ラーメン</p><p style="padding:0 16px">三重県四日市市テスト町1-2</p><p style="padding:0 16px">経路　保存　共有</p></body>');
  const png = await shot.screenshot(); await shot.close();
  ocrCtl.text = '13:59\n5G\n80%\nテスト中華そば 四日市店\n4.5 ★★★★★ (120)\nラーメン\n〒510-0001 三重県四日市市テスト町1-2\n経路\n保存\n共有\nhttps://example.com\n喫茶me\n';
  ocrCtl.calls = [];
  await page.evaluate(() => { window.__lbl = []; const el = document.getElementById('busyLabel'); new MutationObserver(() => window.__lbl.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }); });
  await page.setInputFiles('#ocrFile', { name: 'IMG_0001.PNG', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#ocrResult .ocrChips .toggle-chip');
  const chips = await page.$$eval('#ocrResult .ocrChips .toggle-chip', b => b.map(x => x.textContent));
  const lbl = await page.evaluate(() => window.__lbl);
  const sent = ocrCtl.calls[0];
  check('S1a 画像を選ぶと「文字を読み取り中…」→ GAS の ocrImage（Drive に日本語 OCR で作成）', lbl.includes('文字を読み取り中…') && sent && sent.meta.mimeType === 'application/vnd.google-apps.document' && sent.opt.ocrLanguage === 'ja', lbl.join(','));
  check('S1b 店名候補は上から最大5つ（時刻・電池・評価・住所・URL・「経路／保存／共有」を除く）', chips[0] === 'テスト中華そば 四日市店' && chips.length <= 5 && !chips.some(c => /13:59|80%|★|〒|経路|保存|共有|https/.test(c)) && chips.includes('喫茶me'), chips.join(' | '));
  check('S4a OCR の一時ファイルは成功時もゴミ箱へ（Drive に溜めない）', ocrTemps().length === 1 && ocrTemps().every(f => f._trashed));
  await page.screenshot({ path: path.join(OUT, '50-ocr-candidates.png') });
  // 候補タップ → 検索 → 確認カード → 保存
  await page.click('#ocrResult .ocrChips .toggle-chip[data-i="0"]');
  await page.waitForSelector('#ocrResult .ocrCands .spot-row[data-i="1"]');
  await page.click('#ocrResult .ocrCands .spot-row[data-i="1"]');
  await page.waitForSelector('.view .fSave');
  const card = await page.textContent('.view .view-body');
  await page.click('.view .fSave');
  await page.waitForFunction(() => !document.querySelector('.view .fSave'));
  const row = spotsSheet().find(r => r[2] === 'テスト中華そば 四日市店');
  check('S1c 候補タップ → 検索 → 確認カード（自動判定つき）→ 保存まで通る', /自動判定/.test(card) && /ラーメン/.test(card) && row && row[3] === '三重県' && row[6].split('/').includes('ラーメン'), row && row.slice(0, 7).join(','));
  if (row) { call({ action: 'deleteSpot', id: row[0] }); await page.evaluate(id => { state.spots = state.spots.filter(s => s.id !== id); }, row[0]); }
  // S2 選び直し・手で直す
  await page.evaluate(() => { closeAllViews(); switchTab('add'); });
  await page.click('#ocrResult .ocrChips .toggle-chip:has-text("喫茶me")');
  await page.waitForFunction(() => document.querySelector('#ocrResult .ocrQ').value === '喫茶me');
  await page.waitForSelector('#ocrResult .ocrCands .spot-row');
  await page.fill('#ocrResult .ocrQ', '手で直した店名');
  await page.click('#ocrResult .ocrGo');
  await page.waitForSelector('#ocrResult .ocrCands .spot-row');
  const full = await page.$eval('#ocrResult details pre', e => e.textContent);
  check('S2 候補を選び直せる・入力欄で店名を手で直して検索し直せる・全文を折りたたみで見られる', /喫茶me/.test(full) && /テスト中華そば/.test(full) && await page.$eval('#ocrResult .ocrQ', e => e.value) === '手で直した店名');
  // S3 文字の無い画像
  ocrCtl.text = '';
  await page.setInputFiles('#ocrFile', { name: 'blank.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => /文字を読み取れませんでした/.test(document.getElementById('ocrResult').textContent));
  await page.waitForTimeout(200);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ocrQ'));
  check('S3 文字が無い画像は「文字を読み取れませんでした」＋店名の手入力欄（カーソルが入る）', focused && !!(await page.$('#ocrResult .ocrQ')));
  await page.screenshot({ path: path.join(OUT, '51-ocr-notext.png') });
  // S4 OCR 失敗：スピナーは残らない・一時ファイルは削除・赤バナー
  ocrCtl.text = 'なにか'; ocrCtl.failDoc = true;
  const before = ocrTemps().length;
  await page.setInputFiles('#ocrFile', { name: 'x.png', mimeType: 'image/png', buffer: png });
  await page.waitForSelector('#failBanner.show');
  const busyLeft = await page.$eval('#busy', e => e.classList.contains('show'));
  const fb = await page.textContent('#failBody');
  const temps = ocrTemps();
  check('S4b OCR 失敗時：スピナーは消える・赤バナー「文字の読み取りに失敗しました」・手入力へ誘導', !busyLeft && /文字の読み取りに失敗しました/.test(fb) && /文字を読み取れませんでした/.test(await page.textContent('#ocrResult')), fb.slice(0, 50));
  check('S4c OCR 失敗時も一時ファイルは削除（ゴミ箱）される', temps.length === before + 1 && temps.every(f => f._trashed));
  ocrCtl.failDoc = false;
  await page.evaluate(() => hideFailBanner());
  // Drive API 未追加の GAS
  const noApi = require('./gasmock').makeEnv({ gasPath: path.join(REPO, 'gas-v' + VER + '.gs'), pin: PIN, fetch: () => {}, noDriveApi: true });
  const na = noApi.doPost(JSON.stringify({ action: 'ocrImage', pin: PIN, data: 'AAAA' }));
  check('S4d Drive API を追加していない GAS は「サービス → Drive API を追加」と案内（NO_DRIVE_API）', na.code === 'NO_DRIVE_API' && /Drive API/.test(na.message) && noApi.doGet().ocr_ready === false && env.doGet().ocr_ready === true);
  check('S4e PIN が違えば ocrImage も拒否', env.doPost(JSON.stringify({ action: 'ocrImage', pin: 'wrong', data: 'AAAA' })).code === 'AUTH');
  // S7 貼り付け
  const url = 'https://www.google.com/maps/place/%E8%B2%BC%E3%82%8A%E4%BB%98%E3%81%91%E3%83%86%E3%82%B9%E3%83%88/@34.97,136.62,17z/data=!3m1!4b1';
  await page.evaluate(u => navigator.clipboard.writeText('この店よかった ' + u), url);
  await page.evaluate(() => { document.getElementById('addUrl').value = ''; document.getElementById('urlCandidates').innerHTML = ''; });
  await page.click('button:has-text("貼り付け")');
  await page.waitForSelector('#urlCandidates .spot-row');
  check('S7 ［貼り付け］でクリップボードの URL（前後の文章は除く）が入り、そのままリンクの解決へ進む', await page.$eval('#addUrl', e => e.value) === url);
  await page.screenshot({ path: path.join(OUT, '52-paste.png') });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  dialogs.length = 0;
  await page.click('button:has-text("貼り付け")');
  await page.waitForTimeout(300);
  check('S7b クリップボードが空なら「長押しして貼り付けてください」と案内', dialogs.some(d => /長押し/.test(d)), dialogs.join('|'));
  await page.evaluate(() => { closeAllViews(); switchTab('settings'); });
}

// ==================== v2.0.1：PIN の記憶・GAS とパスワードを合わせる ====================
async function testV201(page, env) {
  // ここに来る時点：アプリのパスワード＝Zz#9876_new、GAS の SECRET_PIN＝PIN（不一致）
  check('R0 doGet：版と「SECRET_PIN が初期値か」だけ返す（PIN の値は返さない）', env.doGet().version === (V3 ? VER : '2.0.1') && env.doGet().pin_default === false && !JSON.stringify(env.doGet()).includes(PIN));
  const env0 = require('./gasmock').makeEnv({ gasPath: path.join(REPO, 'gas-v' + VER + '.gs'), pin: '0000', fetch: () => {} });
  check('R0b SECRET_PIN が 0000 のままなら pin_default=true', env0.doGet().pin_default === true);
  const auth = env.doPost(JSON.stringify({ action: 'getAll', pin: 'nope' }));
  check('R0c AUTH のメッセージに原因（新バージョンでデプロイ）を表示', /新バージョン/.test(auth.message), auth.message);
  await page.click('#syncBadge');   // 同期（showAlert）→ 不一致なら直す画面が開く
  await page.waitForSelector('.view .gpGo');
  await page.waitForFunction(() => /GAS（v\d/.test(document.querySelector('.view:last-child .view-body').textContent));
  const fixTxt = await page.textContent('.view:last-child .view-body');
  check('R1 「PINが一致しません」時は原因の説明つき「GAS とパスワードを合わせる」画面が開く', /SECRET_PIN が違う状態/.test(fixTxt) && /新バージョン/.test(fixTxt), fixTxt.slice(0, 90));
  await page.screenshot({ path: path.join(OUT, '30-gas-pin-fix.png') });
  await page.fill('.view .gpPin', 'Wrong-pin1'); await page.click('.view .gpGo'); await page.waitForTimeout(300);
  const wrong = await page.textContent('.view .gpMsg');
  check('R2 違う値では接続せずエラー表示（アプリ側のパスワードも変えない）', /一致しません/.test(wrong) && await page.evaluate(() => state.pin) === 'Zz#9876_new', wrong);
  await page.fill('.view .gpPin', PIN); await page.click('.view .gpGo');
  await page.waitForFunction(() => /☁️/.test(document.getElementById('syncBadge').textContent));
  const after = await page.evaluate(async P => ({ pin: state.pin, hashOk: localStorage.getItem('spotbook_pin_hash') === await sha256(P), saved: localStorage.getItem('spotbook_pin_saved'), views: state.viewStack.length }), PIN);
  check('R3 SECRET_PIN を入れると接続し、アプリのパスワードもその値にそろう（今のパスワード不要）', after.pin === PIN && after.hashOk && after.views === 0, JSON.stringify(after));
  check('R4 「この端末に記憶する」ON で端末に保存', after.saved === PIN);
  // アプリを落として開き直す（セッション消去＋再読み込み）→ 入力不要
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  await page.waitForFunction(() => document.getElementById('lockScreen').classList.contains('hidden'));
  await page.waitForFunction(() => /☁️/.test(document.getElementById('syncBadge').textContent));
  check('R5 記憶中はアプリを開き直してもパスワード入力なしで同期できる', true, await page.textContent('#syncBadge'));
  await page.click('.nav-item[data-tab="settings"]');
  const rs = await page.textContent('#rememberState');
  await page.click('#rememberBtn');
  const saved2 = await page.evaluate(() => localStorage.getItem('spotbook_pin_saved'));
  await page.evaluate(() => sessionStorage.clear()); await page.reload();
  const locked = await page.$eval('#lockScreen', e => !e.classList.contains('hidden'));
  check('R6 設定タブで記憶を解除できる → 次回はパスワード入力', /記憶中/.test(rs) && saved2 === null && locked, rs);
  const remember = await page.$eval('#lockRemember', e => e.checked);
  await page.fill('#lockPass', PIN); await page.click('#lockBtn');
  await page.waitForSelector('#lockScreen.hidden', { state: 'attached' });
  check('R7 ロック画面の「この端末に記憶する」（既定ON）で再び記憶', remember && await page.evaluate(() => localStorage.getItem('spotbook_pin_saved')) === PIN);
  await page.screenshot({ path: path.join(OUT, '31-settings-remember.png') });
  await page.evaluate(() => lockNow()); await page.waitForTimeout(500);
  check('R8 「今すぐロック」は記憶も解除してロック画面に戻る', await page.$eval('#lockScreen', e => !e.classList.contains('hidden')) && await page.evaluate(() => localStorage.getItem('spotbook_pin_saved')) === null);
  await page.fill('#lockPass', PIN); await page.click('#lockBtn');
  await page.waitForSelector('#lockScreen.hidden', { state: 'attached' });
}

// ==================== v2.0：訪問記録・思い出ノート・写真 ====================
async function testV2(page, env, dialogs, browser) {
  const { makeEnv } = require('./gasmock');
  const visitsSheet = () => env.ss.getSheetByName('visits')._data;
  const spotRow = id => env.ss.getSheetByName('spots')._data.find(r => r[0] === id);
  const call = o => env.doPost(JSON.stringify(Object.assign({ pin: PIN }, o)));

  // W0 v1.0 のDBに v2.0 GAS を載せ替えると visits タブが自動で作られる（移行）
  const v1 = makeEnv({ gasPath: path.join(REPO, 'gas-v1.0.gs'), pin: PIN, fetch: () => {} });
  v1.doPost(JSON.stringify({ action: 'importSpots', pin: PIN, rows: csvSpots.slice(0, 3) }));
  const hadVisits = !!v1.ss.getSheetByName('visits');
  const v2 = makeEnv({ gasPath: path.join(REPO, 'gas-v2.0.gs'), pin: PIN, fetch: () => {}, ss: v1.ss, props: v1.props });
  const g = JSON.parse(JSON.stringify(v2.doPost(JSON.stringify({ action: 'getAll', pin: PIN }))));
  check('W0 v1.0のDBに v2.0 GAS を載せると visits タブを自動作成・既存スポットはそのまま', !hadVisits && g.spots.length === 3 && Array.isArray(g.visits) && g.visits.length === 0 && v1.ss.getSheetByName('visits')._data[0][0] === 'visit_id');

  // 大きい写真（2400×1200）を用意
  const big = await browser.newPage({ viewport: { width: 2400, height: 1200 } });
  await big.setContent('<body style="margin:0;background:linear-gradient(90deg,#f59e0b,#6366f1)"><h1 style="font-size:200px">PHOTO</h1></body>');
  const bigPng = await big.screenshot(); await big.close();

  // W1 詳細画面 →［訪問を記録］フル入力
  await page.evaluate(() => { closeAllViews(); openDetail('SP0190'); });
  await page.click('.view .bVisit');
  await page.waitForSelector('.view .vSave');
  dialogs.length = 0;
  await page.click('.view .vSave');
  await page.waitForTimeout(200);
  check('W1a 評価なしで保存するとエラー（必須＝日付と評価）', /評価/.test(dialogs[0] || '') && visitsSheet().length === 1, dialogs[0]);
  await page.click('.view .emoji-rate button[data-n="4"]');
  await page.fill('.view .vMenu', '抹茶ラテとチーズケーキ');
  await page.fill('.view .vPrice', '3,000');
  await page.fill('.view .vPeople', '2');
  const pp = await page.textContent('.view .vPP');
  await page.fill('.view .vComp', '妻');
  await page.fill('.view .vComment', '窓際の席が最高。また来たい');
  await page.click('.view .seg button[data-r="◎"]');
  await page.setInputFiles('.view .vFile', { name: 'big.png', mimeType: 'image/png', buffer: bigPng });
  await page.waitForSelector('.view .photo-grid .ph .new');
  await page.screenshot({ path: path.join(OUT, '20-visit-form.png'), fullPage: false });
  await page.click('.view .vSave');
  await page.waitForFunction(() => state.visits.length === 1);
  check('W1b 1人あたり表示（3,000円÷2人）', /1人あたり約1,500円/.test(pp), pp);
  const vr = visitsSheet()[1];
  check('W1c visits に1行（V0001・SP0190・評価4・金額3000・人数2・◎）', vr[0] === 'V0001' && vr[1] === 'SP0190' && vr[3] === '4' && vr[5] === '3000' && vr[7] === '2' && vr[10] === '◎' && vr[4] === '抹茶ラテとチーズケーキ', vr.join(','));
  const f1 = env.DriveApp._files[vr[9]];
  const dim = f1 && jpegSize(f1._blob.bytes);
  check('W1d 写真：Drive「スポット帳 写真」に JPEG・長辺1600px・リンク共有（閲覧）', f1 && f1._blob.type === 'image/jpeg' && dim && dim.w === 1600 && dim.h === 800 && f1._sharing[0] === 'ANYONE_WITH_LINK' && f1._sharing[1] === 'VIEW' &&
    env.DriveApp._folders[f1._parents[0]]._name === 'スポット帳 写真', JSON.stringify({ dim, sharing: f1 && f1._sharing, kb: f1 && Math.round(f1._blob.bytes.length / 1024) }));
  check('W1e スポットの status が自動で「行った」', spotRow('SP0190')[13] === '行った');
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, '21-detail-visited.png'), fullPage: false });

  // W2 一覧のバッジ・県の達成率・訪問フィルタ
  await page.evaluate(() => { closeAllViews(); openPref('京都府'); });
  await page.click('.view .cat-tab[data-cat="カフェ"]');
  const rowTxt = await page.$eval('.view .spot-row[data-id="SP0190"]', e => e.textContent);
  const ach = await page.$eval('.view .view-body', e => e.textContent.match(/訪問済[^件]*件/)[0]);
  check('W2a 一覧に「✅ 訪問済」＋直近日＋評価絵文字', /✅ 訪問済/.test(rowTxt) && /😋/.test(rowTxt), rowTxt.slice(0, 80));
  check('W2b 県ページの達成率（京都 カフェ 訪問済 1／11）', /1／11/.test(ach), ach);
  await page.screenshot({ path: path.join(OUT, '22-pref-progress.png') });
  await page.selectOption('.view .vfSel', 'visited');
  const nV = await page.$$eval('.view .listHost .spot-row', r => r.length);
  await page.selectOption('.view .vfSel', 'unvisited');
  const nU = await page.$$eval('.view .listHost .spot-row', r => r.length);
  check('W2c 絞り込み：訪問済だけ 1／未訪問だけ 10', nV === 1 && nU === 10, nV + '/' + nU);

  // W3 地図：訪問済マーカー・絞り込み
  await page.evaluate(() => openMapWith({ pref: '京都府', cat: 'カフェ' }));
  await page.waitForTimeout(500);
  const mk = await page.evaluate(() => ({ html: state.markerById['SP0190'].options.icon.options.html, other: state.markerById[mapFilteredSpots().find(s => s.id !== 'SP0190').id].options.icon.options.html }));
  await page.selectOption('#mapStatus', 'visited');
  const mv = await page.evaluate(() => mapFilteredSpots().map(s => s.id));
  await page.selectOption('#mapStatus', 'unvisited');
  const mu = await page.evaluate(() => mapFilteredSpots().length);
  check('W3a 地図：訪問済マーカーは金縁＋✓（visited クラス）、未訪問は白丸のまま', /emoji-marker visited/.test(mk.html) && !/visited/.test(mk.other), mk.html);
  check('W3b 地図の絞り込み：訪問済だけ 1／未訪問だけ 10', mv.length === 1 && mv[0] === 'SP0190' && mu === 10, mv.join(',') + ' / ' + mu);
  await page.selectOption('#mapStatus', 'visited');
  await page.evaluate(() => { const s = getSpot('SP0190'); state.map.setView([+s.lat, +s.lng], 17); selectMarker('SP0190'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '23-map-visited.png') });
  await page.selectOption('#mapStatus', '');

  // W4 クイック記録（地図カード・一覧の「行った！」）
  await page.click('#mapCard .cQuick');
  await page.click('.view .emoji-rate button[data-n="3"]');
  await page.waitForFunction(() => state.visits.length === 2);
  const ramenId = await page.evaluate(() => state.spots.find(s => s.rep_tag === 'ラーメン' && s.prefecture === '三重県').id);
  await page.evaluate(() => { switchTab('genre'); });
  await page.click('#genreTags .pref-btn[data-name="ラーメン"]');
  await page.click(`.view .spot-row[data-id="${ramenId}"] .quick-btn`);
  await page.waitForSelector('.view .emoji-rate');
  await page.screenshot({ path: path.join(OUT, '24-quick.png') });
  await page.click('.view .emoji-rate button[data-n="5"]');
  await page.waitForFunction(() => state.visits.length === 3);
  const qv = visitsSheet().slice(1).map(r => r[0] + ':' + r[1] + ':' + r[3] + ':' + (r[9] || '-'));
  check('W4a クイック記録：日付＋評価だけで保存（地図カード／一覧の「行った！」）', qv.length === 3 && qv[1] === 'V0002:SP0190:3:-' && qv[2] === 'V0003:' + ramenId + ':5:-', qv.join(' '));
  check('W4b クイック記録したスポットも status＝行った', spotRow(ramenId)[13] === '行った');
  await page.evaluate(() => { closeAllViews(); openDetail('SP0190'); });
  const det = await page.$eval('.view .view-body', e => e.textContent);
  check('W4c 詳細に「2回訪問」・評価は直近の訪問（😐）', /2回訪問/.test(det) && /😐/.test(det.split('評価')[1] || ''), det.match(/評価.{0,30}/) && det.match(/評価.{0,30}/)[0]);

  // W5 評価順＝直近の訪問評価→訪問回数
  const order = await page.evaluate(id => sortSpots([getSpot('SP0001'), getSpot('SP0190'), getSpot(id)], 'rating').map(s => s.id), ramenId);
  check('W5 並び替え「評価順」＝直近の訪問評価→訪問回数（未訪問は後ろ）', order[0] === ramenId && order[1] === 'SP0190' && order[2] === 'SP0001', order.join(','));

  // W6 思い出ノート
  await page.evaluate(() => { closeAllViews(); switchTab('home'); });
  const homeCard = await page.textContent('#memoriesSummary');
  await page.click('#memoriesCard .btn');
  const sum = await page.$$eval('.view .summary-grid .sv b', b => b.map(x => x.textContent));
  const tl = await page.$$eval('.view .tl-item', r => r.map(x => x.dataset.vid));
  const thumb = await page.$$eval('.view .tl-item[data-vid="V0001"] img', i => i.map(x => x.src));
  check('W6a サマリー：スポット2／のべ3回／2都道府県／合計3,000円', JSON.stringify(sum) === JSON.stringify(['2', '3', '2', '3,000円']), JSON.stringify(sum) + ' / home:' + homeCard.slice(0, 40));
  check('W6b タイムラインは新しい順・写真サムネイル（Drive thumbnail）', tl.join(',') === 'V0003,V0002,V0001' && /drive\.google\.com\/thumbnail\?id=FILE/.test(thumb[0] || ''), tl.join(',') + ' ' + thumb[0]);
  await page.screenshot({ path: path.join(OUT, '25-memories.png') });

  // W7 訪問の詳細 → 編集で写真を外す → Drive のファイルがゴミ箱へ
  await page.click('.view .tl-item[data-vid="V0001"]');
  await page.waitForSelector('.view .vEdit');
  const vd = await page.$eval('.view:last-child .view-body', e => e.textContent);
  check('W7a 訪問の詳細：何を・金額（1人あたり）・誰と・人数・また行きたい・コメント', /抹茶ラテ/.test(vd) && /3,000円/.test(vd) && /1人あたり約1,500円/.test(vd) && /妻（2人）/.test(vd) && /◎/.test(vd) && /窓際/.test(vd), vd.slice(0, 120));
  await page.screenshot({ path: path.join(OUT, '26-visit-detail.png') });
  await page.click('.view:last-child .vEdit');
  await page.click('.view:last-child .photo-grid [data-rm]');
  await page.click('.view:last-child .vSave');
  await page.waitForFunction(() => getVisit('V0001').photos === '');
  await page.waitForTimeout(300);
  check('W7b 写真を外して更新 → visits.photos 空・Drive のファイルはゴミ箱', visitsSheet()[1][9] === '' && f1._trashed === true);

  // W8 GAS 側の入力チェック・安全装置
  const bad = [
    call({ action: 'addVisit', visit: { spot_id: 'SP0190', date: '2026-11-17', rating: '6' } }).code,
    call({ action: 'addVisit', visit: { spot_id: 'SP0190', date: '2026/11/17', rating: '3' } }).code,
    call({ action: 'addVisit', visit: { spot_id: 'SP0190', date: '2026-11-17', rating: '3', price: '3千' } }).code,
    call({ action: 'addVisit', visit: { spot_id: 'SP0190', date: '2026-11-17', rating: '3', photos: 'a/b/c/d/e/f' } }).code,
    call({ action: 'addVisit', visit: { spot_id: 'SP9999', date: '2026-11-17', rating: '3' } }).code
  ];
  check('W8a addVisit の入力チェック（評価6・日付形式・金額・写真6枚・存在しないスポット）', bad.every(c => c === 'VALIDATION'), bad.join(','));
  const outside = env.DriveApp._mkFolder('別フォルダ').createFile({ bytes: Buffer.from('x'), type: 'text/plain', name: 'x.txt' });
  check('W8b deletePhoto は写真フォルダ外のファイルを消さない', call({ action: 'deletePhoto', fileId: outside.getId() }).code === 'FORBIDDEN' && !outside._trashed);
  const del = call({ action: 'deleteSpot', id: 'SP0190' });
  check('W8c 訪問記録があるスポットは削除不可（HAS_VISITS）', del.code === 'HAS_VISITS' && del.count === 2, del.message);
  const sp = Object.fromEntries(H.map((h, i) => [h, String(spotRow('SP0001')[i])]));
  call({ action: 'updateSpot', spot: Object.assign(sp, { status: '行った' }) });
  check('W8d updateSpot で status を手で変えても訪問ログに従う（未訪問は行きたい）', spotRow('SP0001')[13] === '行きたい');

  // W9 訪問記録を全部消すと「行きたい」に戻る
  await page.evaluate(() => { closeAllViews(); openDetail('SP0190'); });
  for (const vid of ['V0002', 'V0001']) {
    await page.click(`.view .visit-row[data-vid="${vid}"]`);
    await page.click('.view:last-child .vDel');
    await page.waitForFunction(id => !getVisit(id), vid);
  }
  const rowAfter = await page.evaluate(() => spotRowHtml(getSpot('SP0190')));
  check('W9 SP0190 の訪問記録を全削除 → status＝行きたい・バッジ消える', spotRow('SP0190')[13] === '行きたい' && !/訪問済/.test(rowAfter) && visitsSheet().length === 2, spotRow('SP0190')[13]);
  await page.evaluate(() => { closeAllViews(); switchTab('settings'); });
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  const base = 'http://localhost:' + port;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 35.0116, longitude: 135.7681 }, permissions: ['geolocation', 'clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', async d => { dialogs.push(d.message()); if (d.type() === 'prompt') await d.accept('テスト地域'); else await d.accept(); });
  const nm = path.join(__dirname, 'node_modules'); // npm i leaflet@1.9.4 leaflet.markercluster@1.5.3
  await ctx.route('https://unpkg.com/**', r => {
    const u = r.request().url();
    const p = u.includes('markercluster') ? path.join(nm, 'leaflet.markercluster/dist', u.split('/dist/')[1]) : path.join(nm, 'leaflet/dist', u.split('/dist/')[1]);
    r.fulfill({ path: p });
  });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline\.com|drive\.google\.com/, r => r.fulfill({ body: png, contentType: 'image/png' }));

  await page.goto(base + '/');
  // ---- v1.0.1 パスワード形式（P1〜P4） ----
  const lockUi = await page.evaluate(() => ({
    keypad: !!document.querySelector('#keypad, .keypad, .pin-dots'),
    type: document.getElementById('lockPass').type, inputmode: document.getElementById('lockPass').getAttribute('inputmode'),
    ac: document.getElementById('lockPass').getAttribute('autocomplete'), cap: document.getElementById('lockPass').getAttribute('autocapitalize'),
    corr: document.getElementById('lockPass').getAttribute('autocorrect'), spell: document.getElementById('lockPass').getAttribute('spellcheck'),
    confirmShown: !document.getElementById('lockPass2').hidden
  }));
  check('P4 自作キーパッドなし・type=password・inputmode無し・autocapitalize/autocorrect/spellcheck off・初期設定は new-password＋確認欄',
    !lockUi.keypad && lockUi.type === 'password' && lockUi.inputmode === null && lockUi.ac === 'new-password' && lockUi.cap === 'off' && lockUi.corr === 'off' && lockUi.spell === 'false' && lockUi.confirmShown, JSON.stringify(lockUi));
  const trySetup = async (a, b) => { await page.evaluate(() => { document.getElementById('lockMsg').textContent = ''; }); await page.fill('#lockPass', a); await page.fill('#lockPass2', b);
    if (await page.$eval('#lockPass', e => e.value) !== a || await page.$eval('#lockPass2', e => e.value) !== b) console.log('DEBUG lock input mismatch');
    await page.press('#lockPass2', 'Enter');
    await page.waitForFunction(() => document.getElementById('lockMsg').textContent || document.getElementById('lockScreen').classList.contains('hidden'), null, { timeout: 5000 }).catch(() => {});
    return { msg: await page.textContent('#lockMsg'), locked: await page.$eval('#lockScreen', e => !e.classList.contains('hidden')) }; };
  let r = await trySetup('Ab1', 'Ab1');
  check('P2a 3文字はエラー', r.locked && /4文字以上/.test(r.msg), r.msg);
  r = await trySetup('a'.repeat(65), 'a'.repeat(65));
  check('P2b 65文字はエラー', r.locked && /64文字以内/.test(r.msg), r.msg);
  r = await trySetup('Ab 123xy!', 'Ab 123xy!');
  check('P3 空白を含むとエラー', r.locked && /空白/.test(r.msg), r.msg);
  r = await trySetup(PIN, 'Ab-123xy?');
  check('初期設定：確認用が不一致ならエラー', r.locked && /一致しません/.test(r.msg), r.msg);
  r = await trySetup('a'.repeat(64), 'a'.repeat(64));
  const ok64 = !r.locked;
  await page.evaluate(() => { localStorage.removeItem('spotbook_pin_hash'); sessionStorage.clear(); });
  await page.reload();
  r = await trySetup(PIN, PIN);  // Enter キーで確定
  check('P1a 英字＋記号（Ab-123xy!）で初期設定（Enterで確定）', !r.locked, r.msg);
  check('64文字ちょうどは設定できる', ok64);
  // ロック解除（新しいセッション＝別タブ相当。端末の記憶も外して検証）
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('spotbook_pin_saved'); }); await page.reload();
  const unlockAc = await page.getAttribute('#lockPass', 'autocomplete');
  const p2hidden = await page.$eval('#lockPass2', e => e.hidden);
  await page.fill('#lockPass', 'Ab-123xy?'); await page.press('#lockPass', 'Enter'); await page.waitForTimeout(150);
  const wrongMsg = await page.textContent('#lockMsg');
  check('違うパスワードは「パスワードが違います」', /違います/.test(wrongMsg) && await page.$eval('#lockScreen', e => !e.classList.contains('hidden')), wrongMsg);
  await page.fill('#lockPass', PIN); await page.click('#lockBtn');
  await page.waitForSelector('#lockScreen.hidden', { state: 'attached' });
  check('P1b ロック解除できる（autocomplete=current-password・確認欄なし）', unlockAc === 'current-password' && p2hidden, unlockAc);

  // 4桁目で即判定されないこと（設定時）→ OK。GAS 接続
  await page.click('.nav-item[data-tab="settings"]');
  await page.fill('#gasUrlInput', base + '/exec');
  await page.click('text=保存して同期');
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('0件'));
  check('GAS接続（空のDB）', true, await page.textContent('#syncBadge'));
  // シート初期化の確認
  const tagsSheet = env.ss.getSheetByName('tags'); const cfgSheet = env.ss.getSheetByName('config');
  check(V3 ? 'tags タブ初期化（129行＝ジャンル114＋旧ジャンル2＋項目6＋地域7、8列）' : 'tags タブ初期化（31行＝ジャンル18＋項目6＋地域7）',
    tagsSheet.getLastRow() - 1 === (V3 ? 129 : 31) && (!V3 || tagsSheet._data[0].length === 8), String(tagsSheet.getLastRow() - 1));
  check('config タブ初期化', cfgSheet._data.some(r => r[0] === 'places_api_key'));
  check('spots ヘッダーがCSVと完全一致', JSON.stringify(env.ss.getSheetByName('spots')._data[0]) === JSON.stringify(H));

  // APIキー設定（GAS は値を返さない）
  await page.fill('#apiKeyInput', 'AIzaTEST');
  await page.click('#page-settings button:has-text("保存"):near(#apiKeyInput)');
  await page.waitForFunction(() => document.getElementById('apiKeyState').textContent.includes('設定済み'));
  const ga = env.doPost(JSON.stringify({ action: 'getAll', pin: PIN }));
  check('getAll は APIキーを返さない', !('places_api_key' in ga.config) && ga.config.places_api_key_set === '1');
  check('P5a GAS：同じ文字列なら getAll 成功', env.doPost(JSON.stringify({ action: 'getAll', pin: PIN })).status === 'ok');
  check('P5b GAS：違う文字列（大小・記号違い含む）は AUTH', ['Ab-123xy?', 'ab-123xy!', 'Ab-123xy', ' Ab-123xy!'].every(p => env.doPost(JSON.stringify({ action: 'getAll', pin: p })).code === 'AUTH'));

  // CSV 取り込み
  await page.setInputFiles('#csvInput', CSV);
  await page.waitForSelector('#importResult .notice', { timeout: 60000 });
  const impText = await page.textContent('#importResult');
  console.log(impText);
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('529'));

  // V1
  const sheetRows = env.ss.getSheetByName('spots')._data.slice(1);
  let cellDiff = 0;
  sheetRows.forEach((r, i) => H.forEach((h, j) => { if (String(r[j]) !== String(csvSpots[i][h])) { cellDiff++; console.log('DIFF', i, h, JSON.stringify(r[j]), JSON.stringify(csvSpots[i][h])); } }));
  check('V1a 取り込み後 529 件（シート行数）', sheetRows.length === 529, String(sheetRows.length));
  check('V1b 全セルが CSV と一致（内容不変）', cellDiff === 0, 'diff cells=' + cellDiff);
  const appAgg = await page.evaluate(() => { const m = {}; state.spots.forEach(s => splitList(s.categories).forEach(c => { const k = s.prefecture + '×' + c; m[k] = (m[k] || 0) + 1; })); return m; });
  const csvAgg = {}; csvSpots.forEach(s => s.categories.split('/').filter(Boolean).forEach(c => { const k = s.prefecture + '×' + c; csvAgg[k] = (csvAgg[k] || 0) + 1; }));
  const aggKeys = new Set(Object.keys(appAgg).concat(Object.keys(csvAgg)));
  const aggDiff = [...aggKeys].filter(k => appAgg[k] !== csvAgg[k]);
  check('V1c 県×項目の件数がCSV集計と一致（' + aggKeys.size + '組）', aggDiff.length === 0, aggDiff.join(','));
  // ホームのバッジ合計
  await page.click('.nav-item[data-tab="home"]');
  const badgeSum = await page.$$eval('#prefGrid .badge', b => b.reduce((a, x) => a + Number(x.textContent), 0));
  const prefBtnCount = await page.$$eval('#prefGrid .region-block:not(:last-child) .pref-btn', b => b.length);
  check('ホーム：47都道府県を常時表示', (await page.$$eval('#prefGrid .pref-btn', b => b.filter(x => !x.closest('.region-block').textContent.includes('海外')).length)) === 47);
  check('ホーム：バッジ合計 529', badgeSum === 529, String(badgeSum));
  await page.screenshot({ path: path.join(OUT, '01-home.png'), fullPage: false });

  // V2 京都カフェ
  await page.click('#prefGrid .pref-btn[data-pref="京都府"]');
  await page.click('.view .cat-tab[data-cat="カフェ"]');
  const kyotoRows = await page.$$eval('.view .listHost .spot-row', r => r.length);
  check('V2a 京都府ページのカフェタブ 11 件', kyotoRows === 11, String(kyotoRows));
  const tabsKyoto = await page.$$eval('.view .cat-tab', b => b.map(x => x.dataset.cat));
  check('京都府：服タブあり', tabsKyoto.includes('服'), tabsKyoto.join(','));
  await page.screenshot({ path: path.join(OUT, '02-kyoto-cafe.png') });
  await page.click('.view .toMap');
  await page.waitForTimeout(800);
  const mapInfo = await page.evaluate(() => {
    const list = mapFilteredSpots();
    const inCity = list.filter(s => +s.lat > 34.87 && +s.lat < 35.32 && +s.lng > 135.55 && +s.lng < 135.88).length;
    return { n: list.length, inCity, layers: state.cluster.getLayers().length, icons: document.querySelectorAll('#map .emoji-marker, #map .marker-cluster').length, range: document.getElementById('mapRangeTitle').textContent, attr: document.querySelector('.leaflet-control-attribution').textContent };
  });
  check('V2b 地図：京都府×カフェのマーカー 11 個', mapInfo.n === 11 && mapInfo.layers === 11, JSON.stringify(mapInfo));
  check('V2c 11 件すべて京都市内の座標', mapInfo.inCity === 11, String(mapInfo.inCity));
  check('地図：出典表示あり', /OpenStreetMap/.test(mapInfo.attr), mapInfo.attr);
  await page.screenshot({ path: path.join(OUT, '03-map-kyoto-cafe.png') });
  // マーカーカード
  await page.evaluate(() => { const id = mapFilteredSpots()[0].id; state.map.setView([+getSpot(id).lat, +getSpot(id).lng], 18); });
  await page.waitForTimeout(800);
  const mk = await page.$('#map .emoji-marker');
  if (mk) { await mk.click(); await page.waitForTimeout(300); }
  const cardShown = await page.$eval('#mapCard', e => e.classList.contains('show') && /ナビ開始/.test(e.textContent) && /詳細・編集/.test(e.textContent));
  check('地図：マーカーtapで下部カード（ナビ開始／Googleマップ／詳細・編集）', cardShown);
  await page.screenshot({ path: path.join(OUT, '04-map-card.png') });
  // 航空写真切替
  await page.click('#btnSat');
  const satAttr = await page.textContent('.leaflet-control-attribution');
  check('航空写真切替で Esri の出典表示', /Esri/.test(satAttr), satAttr);
  await page.click('#btnSat');

  // V3 ラーメン
  await page.click('.nav-item[data-tab="genre"]');
  await page.click('#genreTags .pref-btn[data-name="ラーメン"]');
  const ramen = await page.$$eval('.view .listHost .spot-row', r => r.length);
  const ramenEmoji = await page.evaluate(() => { const l = state.spots.filter(s => s.rep_tag === 'ラーメン'); return { n: l.length, all: l.every(s => spotEmoji(s) === '🍜') }; });
  const rowEmoji = await page.$$eval('.view .listHost .spot-row .spot-emoji', e => e.filter(x => x.textContent === '🍜').length);
  check('V3a ラーメンタグ 54 件', ramen === 54, String(ramen));
  check('V3b 代表タグ＝ラーメンは 🍜 表示', ramenEmoji.all && ramenEmoji.n === 54 && rowEmoji === 54, JSON.stringify(ramenEmoji) + ' rows🍜=' + rowEmoji);
  await page.screenshot({ path: path.join(OUT, '05-ramen.png') });
  await page.click('.view .toMap'); await page.waitForTimeout(600);
  const ramenMap = await page.evaluate(() => mapFilteredSpots().length);
  check('ジャンル→地図（ラーメン）', ramenMap === 54, String(ramenMap));

  // V4 0件の県
  await page.click('.nav-item[data-tab="home"]');
  const errBefore = errors.length;
  for (const p of ['青森県', '沖縄県', '愛知県']) {
    await page.click(`#prefGrid .pref-btn[data-pref="${p}"]`);
    const tabs = await page.$$eval('.view .cat-tab', b => b.map(x => x.dataset.cat));
    const okTabs = ['カフェ', '宿', 'グルメ', '観光地'].every(c => tabs.includes(c));
    await page.click('.view .cat-tab[data-cat="カフェ"]');
    const empty = await page.$eval('.view .listHost', e => e.textContent);
    check('V4 ' + p + '：エラーなし・項目タブ全表示', okTabs && errors.length === errBefore, tabs.join(',') + ' / ' + empty.slice(0, 40));
    if (p === '青森県') await page.screenshot({ path: path.join(OUT, '06-aomori.png') });
    if (p === '愛知県') check('愛知県：服タブあり', tabs.includes('服'));
    await page.click('.view .back');
  }

  // 近くのスポット（京都駅付近）
  await page.click('text=現在地を取得');
  await page.waitForSelector('#nearList .spot-row');
  check('近くのスポット表示', (await page.$$eval('#nearList .spot-row', r => r.length)) > 0);
  // 検索
  await page.fill('#homeSearch', '京都');
  await page.click('#page-home .search-row .btn');
  const sr = await page.$$eval('.view .spot-row', r => r.length);
  check('キーワード検索', sr > 0, String(sr));
  await page.selectOption('.view .sortSel', 'distance');
  await page.waitForTimeout(200);
  await page.click('.view .back');

  // V5 重複
  await page.click('.nav-item[data-tab="add"]');
  await page.fill('#addQuery', 'テスト');
  await page.click('#page-add .search-row .btn >> nth=0');
  await page.waitForSelector('#addCandidates .spot-row');
  const dupChip = await page.$eval('#addCandidates .spot-row[data-i="0"]', e => e.textContent);
  check('V5a 候補一覧で「登録済み」警告', /登録済み/.test(dupChip), dupChip.slice(0, 60));
  await page.click('#addCandidates .spot-row[data-i="0"]');
  await page.waitForSelector('.view .notice.danger');
  await page.screenshot({ path: path.join(OUT, '07-dup-warning.png') });
  dialogs.length = 0;
  await page.click('.view .fSave');
  await page.waitForTimeout(500);
  const dupMsg = V3 ? await page.textContent('#failBody') : dialogs.join(' | ');
  check('V5b 保存時に確認＋GASが重複エラー（DUPLICATE）', dialogs.some(d => /同じ place_id/.test(d)) && (V3 ? /スポットの保存に失敗/.test(dupMsg) && /登録済み/.test(dupMsg) : dialogs.some(d => /登録済みのスポット/.test(d))), dupMsg);
  if (V3) await page.evaluate(() => hideFailBanner());
  check('V5c 件数は 529 のまま', env.ss.getSheetByName('spots').getLastRow() - 1 === 529);
  await page.click('.view .back');

  // V6 新規追加 → Google未保存キュー
  await page.click('#addCandidates .spot-row[data-i="1"]');
  await page.waitForSelector('.view .fSave');
  const judged = await page.$eval('.view .notice.info', e => e.textContent);
  check('自動判定（ramen_restaurant→グルメ＋ラーメン、三重県）', /グルメ/.test(judged) && /ラーメン/.test(judged) && /三重県/.test(judged), judged);
  await page.screenshot({ path: path.join(OUT, '08-confirm-card.png') });
  await page.click('.view .fSave');
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('530'));
  const added = env.ss.getSheetByName('spots')._data[530];
  check('addSpot：SP0530 で採番・google_saved=未・rep_tag=ラーメン', added[0] === 'SP0530' && added[16] === '未' && added[8] === 'ラーメン', added.join(','));
  await page.click('.nav-item[data-tab="add"]');
  const q = await page.$$eval('#googleQueue .queue-item', items => items.map(i => ({ id: i.dataset.id, lists: [...i.querySelectorAll('.list-check .ln')].map(x => x.textContent) })));
  check('V6a Google未保存キューは新規分の1件だけ', q.length === 1 && q[0].id === 'SP0530', JSON.stringify(q));
  check('V6b 保存先リスト名が複数行（三重 グルメ／ラーメン）', q[0] && q[0].lists.length === 2, JSON.stringify(q[0] && q[0].lists));
  await page.screenshot({ path: path.join(OUT, '09-google-queue.png'), fullPage: true });
  // チェック1つ → config 保存
  await page.check('#googleQueue input[type=checkbox] >> nth=0');
  await page.waitForTimeout(1200);
  const qc = env.ss.getSheetByName('config')._data.find(r => r[0] === 'queue_checks');
  check('キューのチェック状態を config に保存', qc && /SP0530/.test(qc[1]), qc && qc[1]);
  // 2つ目チェック → 済にする（confirm accept）
  await page.click('#googleQueue input[type=checkbox] >> nth=1');
  await page.waitForTimeout(800);
  const after = env.ss.getSheetByName('spots')._data[530];
  check('全リストをチェック → google_saved=済', after[16] === '済', after[16]);

  // updateSpot（行単位）／deleteSpot
  const beforeRow1 = JSON.stringify(env.ss.getSheetByName('spots')._data[1]);
  const up = env.doPost(JSON.stringify({ action: 'updateSpot', pin: PIN, spot: Object.assign(Object.fromEntries(H.map((h, i) => [h, String(after[i])])), { rating: '4' }) }));
  check('updateSpot：対象行だけ更新', up.status === 'ok' && env.ss.getSheetByName('spots')._data[530][14] === '4' && JSON.stringify(env.ss.getSheetByName('spots')._data[1]) === beforeRow1);
  // 編集画面の削除ボタン経由
  await page.evaluate(() => syncFromCloud(false)); await page.waitForTimeout(300);
  await page.evaluate(() => openDetail('SP0530'));
  await page.screenshot({ path: path.join(OUT, '10-detail.png') });
  await page.click('.view .bEdit');
  await page.click('.view .fDel');
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('529'));
  check('deleteSpot：529 件に戻る', env.ss.getSheetByName('spots').getLastRow() - 1 === 529);

  // Takeout 再取り込み（既存URL1件＋新規1件＋同ファイル内重複1件）
  const ex = csvSpots.find(s => s.maps_url.includes('0x'));
  const tk = path.join(OUT, '三重 グルメ.csv');
  fs.writeFileSync(tk, 'Title,Note,URL,Tags,Comment\n' + `"${ex.name}",,${ex.maps_url},,\n` + 'テスト新店,メモです,https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x111:0x222,,\n' + 'テスト新店,,https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x111:0x222,,\n');
  await page.click('.nav-item[data-tab="settings"]');
  await page.evaluate(() => document.getElementById('importResult').innerHTML = '');
  await page.setInputFiles('#csvInput', { name: '三重 グルメ.csv', mimeType: 'text/csv', buffer: fs.readFileSync(tk) });
  await page.waitForSelector('#importResult .notice');
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('530'));
  const tkRes = await page.textContent('#importResult');
  check('Takeout再取込：新規1件だけ追加（既存URL・同一ファイル内重複を除外）', /追加 1 件/.test(tkRes) && /除外 2 件/.test(tkRes), tkRes.replace(/\s+/g, ' ').slice(0, 120));
  if (V2) {
    // 日本語版 Takeout（見出し「タイトル,メモ,URL,タグ,コメント」＋空行あり）も Takeout 形式として読めること
    const jp = await page.evaluate(() => {
      const rows = parseCsv('\uFEFFタイトル,メモ,URL,タグ,コメント\n,,,,\n藤屋,美味い,https://www.google.com/maps/place/X/data=!4m2!3m1!1s0x5f8:0x49b,,\n');
      const h = rows[0].map(x => x.trim());
      const sp = takeoutRowsToSpots(rows, '焼肉');
      return { detect: takeoutCol(h, 'title') >= 0 && takeoutCol(h, 'url') >= 0, n: sp.length, name: sp[0] && sp[0].name, memo: sp[0] && sp[0].memo, url: sp[0] && sp[0].maps_url, tags: sp[0] && sp[0].tags };
    });
    check('T1 日本語見出しの Takeout CSV（タイトル／メモ／URL）を認識・空行は除外・リスト名からタグ推定', jp.detect && jp.n === 1 && jp.name === '藤屋' && jp.memo === '美味い' && /0x5f8:0x49b/.test(jp.url) && jp.tags === '焼肉', JSON.stringify(jp));
  }
  const newRow = env.ss.getSheetByName('spots')._data[530];
  check('Takeout行：県=三重県・項目=グルメ・未処理キュー対象（座標なし）', newRow[3] === '三重県' && newRow[5] === 'グルメ' && newRow[10] === '', newRow.slice(0, 13).join(','));
  await page.click('.nav-item[data-tab="add"]');
  const uq = await page.textContent('#uqCount');
  check('未処理キューに座標なしの1件＋要確認', /\d+ 件/.test(uq), uq);
  await page.screenshot({ path: path.join(OUT, '11-add-tab.png'), fullPage: true });

  // CSV エクスポート
  await page.click('.nav-item[data-tab="settings"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('text=CSVエクスポート')]);
  const exp = parseCsv(fs.readFileSync(await dl.path(), 'utf8'));
  check('CSVエクスポート：ヘッダー一致＋530行', JSON.stringify(exp[0]) === JSON.stringify(H) && exp.length - 1 === 530, String(exp.length - 1));

  // 再読み込み時のロック（セッション内は維持）・ロック画面
  await page.reload();
  await page.waitForSelector('#lockScreen.hidden', { state: 'attached' });
  check('同一セッションの再読込ではPIN不要', true);

  if (V2) await testV2(page, env, dialogs, browser);
  if (V3) await testV3(page, env, dialogs);
  if (V31) await testV31(page, env, dialogs, browser, ctx);

  // パスワード変更（設定タブ）：空白・短すぎはエラー、変更後は GAS と不一致で AUTH 表示
  await page.click('.nav-item[data-tab="settings"]');
  const pinNewAttr = await page.evaluate(() => [document.getElementById('pinOld').getAttribute('inputmode'), document.getElementById('pinNew').getAttribute('inputmode'), document.querySelector('label[for], #pinNew').closest('.form-row').textContent]);
  check('設定：inputmode=numeric 撤去・ラベル「新しいパスワード（4文字以上）」', pinNewAttr[0] === null && pinNewAttr[1] === null && /新しいパスワード（4文字以上）/.test(pinNewAttr[2]), JSON.stringify(pinNewAttr));
  dialogs.length = 0;
  await page.fill('#pinOld', PIN); await page.fill('#pinNew', 'ab c1234'); await page.click('button:has-text("パスワードを変更")');
  await page.fill('#pinOld', PIN); await page.fill('#pinNew', 'abc'); await page.click('button:has-text("パスワードを変更")');
  check('設定：空白入り・3文字は変更エラー', /空白/.test(dialogs[0] || '') && /4文字以上/.test(dialogs[1] || ''), dialogs.join(' | '));
  await page.fill('#pinOld', PIN); await page.fill('#pinNew', 'Zz#9876_new'); await page.click('button:has-text("パスワードを変更")');
  await page.evaluate(() => syncFromCloud(false)); await page.waitForTimeout(300);
  const badge = await page.textContent('#syncBadge');
  check('P5c アプリ側だけ変更すると GAS と不一致で同期不可（AUTH）', /パスワード不一致/.test(badge), badge);
  if (V201) await testV201(page, env);

  // v3.0 の L3／L8 でわざと通信を切った分（ERR_EMPTY_RESPONSE）は除く
  const realErrors = errors.filter(e => !/ERR_EMPTY_RESPONSE/.test(e));
  check('コンソールエラーなし', realErrors.length === 0, realErrors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' passed');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
