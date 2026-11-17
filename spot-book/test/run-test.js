const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { makeEnv } = require('./gasmock');
const REPO = path.join(__dirname, '..');
const CSV = process.argv[2];
const OUT = path.join(require('os').tmpdir(), 'spotbook-test-out'); fs.mkdirSync(OUT, { recursive: true });
const VER = process.env.SPOT_VER || '2.0';   // 検証する版（index-v◯.html／gas-v◯.gs）
const V2 = Number(VER.split('.')[0]) >= 2;
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
  if (url.includes('places:searchText')) return resp(200, { places: [
    { id: kyotoCafe.place_id, displayName: { text: kyotoCafe.name }, formattedAddress: kyotoCafe.address, location: { latitude: +kyotoCafe.lat, longitude: +kyotoCafe.lng }, types: ['cafe', 'food'] },
    { id: NEW_PID, displayName: { text: 'テスト中華そば 四日市店' }, formattedAddress: '日本、〒510-0001 三重県四日市市テスト町1-2', location: { latitude: 34.97, longitude: 136.62 }, types: ['ramen_restaurant', 'restaurant', 'food'] } ] });
  if (url.includes('places/')) {
    const id = decodeURIComponent(url.split('places/')[1].split('?')[0]);
    if (id === NEW_PID) return resp(200, { id, displayName: { text: 'テスト中華そば 四日市店' }, formattedAddress: '日本、〒510-0001 三重県四日市市テスト町1-2', location: { latitude: 34.97, longitude: 136.62 }, types: ['ramen_restaurant', 'restaurant', 'food'], primaryType: 'ramen_restaurant',
      addressComponents: [{ longText: '三重県', types: ['administrative_area_level_1'] }, { longText: '四日市市', types: ['locality'] }], googleMapsUri: 'https://maps.google.com/?cid=123456789' });
    return resp(200, { id, displayName: { text: kyotoCafe.name }, formattedAddress: kyotoCafe.address, location: { latitude: +kyotoCafe.lat, longitude: +kyotoCafe.lng }, types: ['cafe'], addressComponents: [{ longText: '京都府', types: ['administrative_area_level_1'] }], googleMapsUri: 'https://maps.google.com/?cid=1' });
  }
  return resp(404, {});
};
const env = makeEnv({ gasPath: path.join(REPO, 'gas-v' + VER + '.gs'), pin: PIN, fetch: fetchMock });
// setConfig でAPIキーはアプリから入れる

const html = fs.readFileSync(path.join(REPO, 'index-v' + VER + '.html'));
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(env.doPost(Buffer.concat(chunks).toString('utf8')))); });  // 多バイト文字がチャンク境界で割れないよう Buffer で結合
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

// ==================== v2.0.1：PIN の記憶・GAS とパスワードを合わせる ====================
async function testV201(page, env) {
  // ここに来る時点：アプリのパスワード＝Zz#9876_new、GAS の SECRET_PIN＝PIN（不一致）
  check('R0 doGet：版と「SECRET_PIN が初期値か」だけ返す（PIN の値は返さない）', env.doGet().version === '2.0.1' && env.doGet().pin_default === false && !JSON.stringify(env.doGet()).includes(PIN));
  const env0 = require('./gasmock').makeEnv({ gasPath: path.join(REPO, 'gas-v' + VER + '.gs'), pin: '0000', fetch: () => {} });
  check('R0b SECRET_PIN が 0000 のままなら pin_default=true', env0.doGet().pin_default === true);
  const auth = env.doPost(JSON.stringify({ action: 'getAll', pin: 'nope' }));
  check('R0c AUTH のメッセージに原因（新バージョンでデプロイ）を表示', /新バージョン/.test(auth.message), auth.message);
  await page.click('#syncBadge');   // 同期（showAlert）→ 不一致なら直す画面が開く
  await page.waitForSelector('.view .gpGo');
  await page.waitForFunction(() => /v2\.0\.1/.test(document.querySelector('.view:last-child .view-body').textContent));
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 35.0116, longitude: 135.7681 }, permissions: ['geolocation'] });
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
  const trySetup = async (a, b) => { await page.fill('#lockPass', a); await page.fill('#lockPass2', b); await page.press('#lockPass2', 'Enter'); await page.waitForTimeout(150);
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
  check('tags タブ初期化（31行＝ジャンル18＋項目6＋地域7）', tagsSheet.getLastRow() - 1 === 31, String(tagsSheet.getLastRow() - 1));
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
  check('V5b 保存時に確認＋GASが重複エラー（DUPLICATE）', dialogs.some(d => /同じ place_id/.test(d)) && dialogs.some(d => /登録済みのスポット/.test(d)), dialogs.join(' | '));
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

  check('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' passed');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
