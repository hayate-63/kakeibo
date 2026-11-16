const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const { makeEnv } = require('./gasmock');
const REPO = path.join(__dirname, '..');
const CSV = process.argv[2];
const OUT = path.join(require('os').tmpdir(), 'spotbook-test-out'); fs.mkdirSync(OUT, { recursive: true });
const PIN = '1234';

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
const env = makeEnv({ gasPath: path.join(REPO, 'gas-v1.0.gs'), pin: PIN, fetch: fetchMock });
// setConfig でAPIキーはアプリから入れる

const html = fs.readFileSync(path.join(REPO, 'index-v1.0.html'));
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/exec')) {
    let b = ''; req.on('data', c => b += c); req.on('end', () => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(env.doPost(b))); });
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
});
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); };

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
  await ctx.route(/tile\.openstreetmap\.org|arcgisonline\.com/, r => r.fulfill({ body: png, contentType: 'image/png' }));

  await page.goto(base + '/');
  // PIN 設定（2回入力）
  for (const k of '1234') await page.click(`#keypad button[data-k="${k}"]`);
  await page.click('#keypad button[data-k="ok"]');
  for (const k of '1234') await page.click(`#keypad button[data-k="${k}"]`);
  await page.click('#keypad button[data-k="ok"]');
  await page.waitForSelector('#lockScreen.hidden', { state: 'attached' });
  check('PIN設定でロック解除', true);

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
  check('PIN不一致は拒否', env.doPost(JSON.stringify({ action: 'getAll', pin: '9999' })).code === 'AUTH');

  // CSV 取り込み
  await page.setInputFiles('#csvInput', CSV);
  await page.waitForSelector('#importResult .notice', { timeout: 60000 });
  const impText = await page.textContent('#importResult');
  console.log(impText);
  await page.waitForFunction(() => document.getElementById('syncBadge').textContent.includes('529'));

  // V1
  const sheetRows = env.ss.getSheetByName('spots')._data.slice(1);
  let cellDiff = 0;
  sheetRows.forEach((r, i) => H.forEach((h, j) => { if (String(r[j]) !== String(csvSpots[i][h])) cellDiff++; }));
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

  check('コンソールエラーなし', errors.length === 0, errors.join(' | '));
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' passed');
  await browser.close(); server.close();
})().catch(e => { console.error(e); process.exit(1); });
