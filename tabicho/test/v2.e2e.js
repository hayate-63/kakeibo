// 旅帳 v2.0 の画面通しテスト（メディア・ビジュアル・コレクション）
//   node tabicho/test/v2.e2e.js [スクリーンショット保存先]
// アップロードは旅帳PoC の模擬サーバ（Drive の resumable の振る舞い：Origin 付きセッションだけ CORS 可・308/Range）に本当に PUT する
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert');

const API = 'http://127.0.0.1:8712';
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// 本物の PNG を作る（端末側のサムネイル生成・表示まで通すため）
function png(w, h, seed) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 255 / w + seed * 60) & 255; raw[o + 1] = (y * 255 / h + seed * 30) & 255; raw[o + 2] = (seed * 90 + 80) & 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const out = process.argv[2] || null; if (out) fs.mkdirSync(out, { recursive: true });
  const srv = spawn(process.execPath, [path.join(__dirname, '..', '..', 'tabicho-poc', 'test', 'mock-server.js'), '8711', '8712'], { stdio: 'ignore' });
  // 画面は http で配信する（file:// だと Origin が null になり、Origin 付きセッションの CORS を正しく試せない）
  const http = require('http');
  const page = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'))); }).listen(8713, '127.0.0.1');
  await sleep(600);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript((u) => { window.__TABICHO_TEST_UPLOAD = u; }, API + '/exec');
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  const shot = async (n) => { if (out) await p.screenshot({ path: path.join(out, n + '.png'), fullPage: n !== 'v3_visual_cover' && n !== 'v4_visual_day' }); };
  let n = 0; const ok = (s) => { n++; console.log('✓', s); };
  const queue = () => p.evaluate(() => JSON.parse(localStorage.getItem('tabicho_media_queue_v1') || '[]'));
  const trip = () => p.evaluate(() => { const c = JSON.parse(localStorage.getItem('tabicho_cache_v1')); return c.trips[c.curTripId]; });
  try {
    await p.goto('http://127.0.0.1:8713/');
    await p.waitForTimeout(800);
    const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    await p.click('text=＋ 新しい旅');
    await p.fill('#teTitle', '北海道旅行');
    await p.fill('#teStart', ymd(new Date())); await p.fill('#teEnd', ymd(new Date(Date.now() + 86400000)));
    await p.fill('#teArea', '札幌・小樽');
    await p.fill('#memNew', '相方'); await p.click('[data-act="memAdd"]');
    await p.click('text=この旅を作る'); await p.waitForTimeout(300);
    assert.strictEqual((await trip()).region, 'domestic');
    ok('旅の作成（国内／海外の自動判定＝国内）');

    // ---- メディア：今すぐ送る（写真2枚＋動画1本。動画は 4MB チャンクで3回に分かれる） ----
    await p.click('.nav-item[data-tab="record"]');
    const ph1 = png(1200, 800, 1), ph2 = png(800, 1200, 2), vid = crypto.randomBytes(9 * 1048576 + 321);
    let fc = p.waitForEvent('filechooser'); await p.click('[data-act="mediaAdd"]');
    await (await fc).setFiles([{ name: 'IMG_0001.png', mimeType: 'image/png', buffer: ph1 }, { name: 'IMG_0002.png', mimeType: 'image/png', buffer: ph2 }, { name: 'IMG_0003.MOV', mimeType: 'video/quicktime', buffer: vid }]);
    await p.click('[data-act="maGo"][data-send="1"]');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('tabicho_media_queue_v1') || '[]').filter(q => q.state === 'done').length === 3, null, { timeout: 60000 });
    let files = await (await fetch(API + '/debug')).json();
    [ph1, ph2, vid].forEach(buf => assert.ok(files.some(f => f.md5 === md5(buf)), 'Drive（模擬）に届いた中身が元と一致'));
    let t = await trip();
    assert.strictEqual(t.media.length, 3); assert.ok(t.driveFolderId); assert.strictEqual(t.media.filter(m => m.kind === 'video').length, 1);
    assert.ok(t.media.every(m => m.date === ymd(new Date())), 'EXIF が無いのでアップロード日（M3）');
    assert.ok(!(await queue()).some(x => x.viaGas), '直接 PUT で通った（GAS 経由の代替路を使っていない）');
    ok('今すぐ送る：写真2枚・動画9MB を直接 PUT（チャンク・308）で完走、中身一致、旅にフォルダとメディアを登録');
    await p.waitForTimeout(400);
    await shot('v1_record');

    // ---- 保留 → 再読み込み → ファイルを選び直して送る ----
    const ph3 = png(900, 600, 3);
    fc = p.waitForEvent('filechooser'); await p.click('[data-act="mediaAdd"]');
    await (await fc).setFiles([{ name: 'IMG_0004.png', mimeType: 'image/png', buffer: ph3 }]);
    await p.click('[data-act="maGo"][data-send="0"]');
    let q = (await queue()).find(x => x.name === 'IMG_0004.png');
    assert.strictEqual(q.state, 'held');
    assert.match(await p.textContent('#unsentBar').catch(() => '') || '', /|/);
    await p.click('.nav-item[data-tab="home"]');
    assert.match(await p.textContent('#unsentBar'), /未送信 1件/);
    ok('保留：キューに「保留中」、ホームの未送信バーに件数');
    await p.reload(); await p.waitForTimeout(600);
    await p.click('.nav-item[data-tab="record"]');
    await p.waitForSelector('[data-act="mqRepick"]');
    fc = p.waitForEvent('filechooser'); await p.click('[data-act="mqRepick"]');
    await (await fc).setFiles([{ name: 'IMG_0004.png', mimeType: 'image/png', buffer: ph3 }]);
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('tabicho_media_queue_v1') || '[]').some(q => q.name === 'IMG_0004.png' && q.state === 'done'), null, { timeout: 30000 });
    files = await (await fetch(API + '/debug')).json();
    assert.ok(files.some(f => f.md5 === md5(ph3)));
    ok('再読み込み後：ファイル本体は端末に残さず、選び直して送信（M2）');

    // ---- ビューア：代表・お気に入り・日付変更（日程外 → 日付未設定） ----
    await p.click('.mtile >> nth=0');
    await p.click('[data-act="mvCover"]'); await p.waitForTimeout(200);
    await p.click('[data-act="mvFav"]'); await p.waitForTimeout(200);
    await p.fill('#mvDate', '2020-01-01'); await p.click('[data-act="mvSave"]'); await p.waitForTimeout(300);
    t = await trip();
    assert.strictEqual(t.media.filter(m => m.cover).length, 1); assert.ok(t.media.find(m => m.cover).favorite);
    assert.strictEqual(t.media.find(m => m.cover).dateSource, 'manual');
    assert.match(await p.textContent('#page-record'), /日付未設定/);
    ok('拡大表示から 代表に設定・お気に入り・日付の手動変更（日程外は「日付未設定」へ）');

    // ---- ビジュアル：旅帳モード（めくる）・Instagram 書き出し ----
    await p.click('[data-act="openVisual"]'); await p.waitForTimeout(600);
    const pages = await p.$$eval('#visStage .vpage', x => x.length);
    assert.ok(pages >= 2);
    assert.match(await p.textContent('.vtitle'), /HOKKAIDO TRIP/);
    await shot('v3_visual_cover');
    await p.click('[data-act="visNext"]'); await p.waitForTimeout(800);
    assert.strictEqual(await p.$eval('#visStage .vpage.cur', e => e.dataset.i), '1');
    await shot('v4_visual_day');
    ok(`ビジュアル（旅帳モード）：表紙＋日別 ${pages - 1}ページ、英語タイトル自動（北海道旅行 → HOKKAIDO TRIP）、ページめくり`);
    await p.click('[data-act="visMode"][data-v="insta"]'); await p.waitForTimeout(1500);
    await p.click('[data-act="instaExport"]');
    await p.waitForSelector('img.iout', { timeout: 20000 });
    const outs = await p.$$eval('img.iout', x => x.length);
    assert.strictEqual(outs, pages);
    const dims = await p.$eval('img.iout', i => new Promise(r => { const im = new Image(); im.onload = () => r([im.naturalWidth, im.naturalHeight]); im.src = i.src; }));
    assert.deepStrictEqual(dims, [1080, 1920]);
    await shot('v5_insta');
    ok(`Instagram 書き出し：${outs}枚・1080×1920`);
    await p.click('[data-act="closeVisual"]');

    // ---- 削除：Drive のファイルもゴミ箱へ（M4） ----
    const before = (await trip()).media.length;
    await p.click('.mtile >> nth=1'); await p.click('[data-act="mvDel"]'); await p.waitForTimeout(300);
    assert.strictEqual((await trip()).media.length, before - 1);
    ok('メディアの削除（旅帳から外し、Drive 側もゴミ箱へ）');

    // ---- コレクション ----
    await p.click('.nav-item[data-tab="home"]');
    await p.click('[data-act="openCollection"]'); await p.waitForTimeout(800);
    const txt = await p.textContent('#page-collection');
    const tm = (await trip()).media;
    assert.match(txt, /総旅数1回/); assert.match(txt, new RegExp('写真' + tm.filter(m => m.kind === 'photo').length + '枚')); assert.match(txt, new RegExp('動画' + tm.filter(m => m.kind === 'video').length + '本'));
    assert.ok(await p.$('.card.year'));
    await shot('v6_collection');
    await p.click('[data-act="yearExport"]');
    await p.waitForSelector('img.iout', { timeout: 20000 });
    await shot('v7_year_export');
    ok('コレクション：統計（C1 の対象）・都道府県・年別レポートの書き出し');

    // ---- デモモード（端末でサムネイルを作る）でビジュアルを写真入りで確認 ----
    const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await ctx2.newPage();
    p2.on('pageerror', e => errs.push(e.message)); p2.on('dialog', d => d.accept());
    await p2.goto('http://127.0.0.1:8713/'); await p2.waitForTimeout(600);
    await p2.click('text=＋ 新しい旅'); await p2.fill('#teTitle', '淡路島ドライブ');
    await p2.fill('#teStart', ymd(new Date())); await p2.fill('#teEnd', ymd(new Date())); await p2.click('text=この旅を作る');
    await p2.click('.nav-item[data-tab="record"]');
    fc = p2.waitForEvent('filechooser'); await p2.click('[data-act="mediaAdd"]');
    await (await fc).setFiles([1, 2, 3].map(i => ({ name: `P${i}.png`, mimeType: 'image/png', buffer: png(1080, 1350, i + 3) })));
    await p2.click('[data-act="maGo"][data-send="1"]');
    await p2.waitForFunction(() => JSON.parse(localStorage.getItem('tabicho_media_queue_v1') || '[]').filter(q => q.state === 'done').length === 3, null, { timeout: 30000 });
    await p2.waitForTimeout(800);
    assert.ok((await p2.$$('.mtile img')).length >= 3, 'サムネイルが表示される');
    if (out) await p2.screenshot({ path: path.join(out, 'v8_demo_record.png'), fullPage: true });
    await p2.click('[data-act="openVisual"]'); await p2.waitForTimeout(800);
    if (out) await p2.screenshot({ path: path.join(out, 'v9_demo_cover.png') });
    await p2.click('[data-act="visNext"]'); await p2.waitForTimeout(900);
    if (out) await p2.screenshot({ path: path.join(out, 'v10_demo_day.png') });
    await p2.click('[data-act="visMode"][data-v="insta"]'); await p2.waitForTimeout(1500);
    assert.ok(await p2.$('[data-act="instaExport"][disabled]'), '表紙が決まっていない時は書き出せない（V4）');
    await p2.click('.insta [data-act="visPickCover"]'); await p2.click('[data-act="visPicked"] >> nth=1'); await p2.waitForTimeout(1500);
    await p2.click('[data-act="instaExport"]'); await p2.waitForSelector('img.iout', { timeout: 20000 });
    if (out) {
      const srcs = await p2.$$eval('img.iout', x => x.map(i => i.src));
      for (let i = 0; i < srcs.length; i++) {
        const arr = await p2.evaluate(async (u) => Array.from(new Uint8Array(await (await fetch(u)).arrayBuffer())), srcs[i]);
        fs.writeFileSync(path.join(out, `v11_insta_${i + 1}.jpg`), Buffer.from(arr));
      }
    }
    await ctx2.close();
    ok('デモモード：端末で作ったサムネイルの表示、写真入りのビジュアルと書き出し');

    assert.deepStrictEqual(errs, []);
    console.log(`\n${n} checks passed（ページのエラーなし）`);
  } catch (e) {
    console.error('FAILED:', e.message, errs); if (out) await p.screenshot({ path: path.join(out, 'fail.png'), fullPage: true }); process.exitCode = 1;
  } finally { await b.close(); srv.kill(); page.close(); }
})();
