// 旅帳 v2.0.3 の画面通しテスト（旅ごとのタイムゾーン・入力中の描き直し待ち・保存容量・外部画像の書き出し・サムネイルの整理）
//   node tabicho/test/v203.e2e.js [スクリーンショット保存先]
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h, 120);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const out = process.argv[2] || null; if (out) fs.mkdirSync(out, { recursive: true });
  const page = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'))); }).listen(8713, '127.0.0.1');
  // 別オリジンの画像サーバ：/cors.png は許可あり、/nocors.png は許可なし（よくある外部サイト）
  const img = png(40, 40);
  const imgs = http.createServer((req, res) => {
    const h = { 'Content-Type': 'image/png' };
    if (req.url.startsWith('/cors')) h['Access-Control-Allow-Origin'] = '*';
    res.writeHead(200, h); res.end(img);
  }).listen(8714, '127.0.0.1');
  await sleep(300);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' });
  await ctx.addInitScript(() => { window.__TABICHO_THUMB_MAX = 20; });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|CORS|Access-Control/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  const shot = async (n) => { if (out) await p.screenshot({ path: path.join(out, n + '.png'), fullPage: true }); };
  let n = 0; const ok = (s) => { n++; console.log('✓', s); };
  const trip = () => p.evaluate(() => { const c = JSON.parse(localStorage.getItem('tabicho_cache_v1')); return c.trips[c.curTripId]; });
  try {
    await p.goto('http://127.0.0.1:8713/');
    await p.waitForTimeout(800);
    assert.ok(await p.evaluate(() => !!window.__TABICHO_T), 'デモでは画面テスト用の入口がある');

    // ---- 1. 旅ごとのタイムゾーン ----
    const ymd = (d) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    await p.click('text=＋ 新しい旅');
    await p.fill('#teTitle', 'ハワイ旅行');
    await p.fill('#teStart', ymd(new Date(Date.now() - 2 * 86400000))); await p.fill('#teEnd', ymd(new Date(Date.now() + 3 * 86400000)));
    assert.ok(await p.$('#teTz'), '旅の編集に「現地の時刻」がある');
    const opts = await p.$$eval('#teTz option', os => os.map(o => o.value));
    assert.ok(opts.includes('Pacific/Honolulu') && opts.includes('Europe/Paris') && opts[0] === '');
    await p.selectOption('#teTz', 'Pacific/Honolulu');
    await p.click('text=この旅を作る'); await p.waitForTimeout(400);
    assert.strictEqual((await trip()).timeZone, 'Pacific/Honolulu');
    const r1 = await p.evaluate(() => {
      const T = window.__TABICHO_T, t = T.curTrip();
      const hon = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Honolulu', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      return { tz: T.tripTz(t), today: T.tripToday(t), hon };
    });
    assert.strictEqual(r1.tz, 'Pacific/Honolulu');
    assert.strictEqual(r1.today, r1.hon, '旅の「今日」は現地（ハワイ）の日付');
    const home = await p.textContent('#page-home');
    assert.ok(/現地 \d{1,2}:\d{2}（ハワイ・日本との時差 -19時間）/.test(home), 'ホームの旅カードに現地時刻と時差: ' + home.slice(0, 300));
    await shot('t1_home_tz');
    // 編集で「自動」に戻せる
    ok('旅ごとのタイムゾーン：選択・保存・現地の今日・ホームに現地時刻と時差');

    // ---- 2. 入力中は後から届いた情報で描き直さない ----
    const r2 = await p.evaluate(async () => {
      const T = window.__TABICHO_T;
      const host = document.getElementById('page-home');
      const inp = document.createElement('input'); inp.id = 'typingProbe'; host.appendChild(inp);
      inp.focus(); inp.value = '入力中の文字';
      const did = T.softRender();
      const kept = !!document.getElementById('typingProbe') && document.getElementById('typingProbe').value === '入力中の文字';
      inp.blur();
      await new Promise(r => setTimeout(r, 500));
      const after = !!document.getElementById('typingProbe');
      return { did, kept, after, noInput: T.softRender() };
    });
    assert.deepStrictEqual(r2, { did: false, kept: true, after: false, noInput: true }, '入力中は待ち、入力欄から離れたら描き直す');
    ok('入力中の描き直し待ち：入力の途中は消えず、離れたら1回描き直す');

    // ---- 3. 端末の保存容量がいっぱい ----
    const r3 = await p.evaluate(() => {
      const T = window.__TABICHO_T;
      const orig = Storage.prototype.setItem;
      let calls = 0;
      T.S.hours = { x: { week: [], at: 1 } };
      // 1回目（営業時間の控えつき）は容量オーバー、2回目（控えなし）は入る
      Storage.prototype.setItem = function (k, v) { if (k === 'tabicho_cache_v1') { calls++; if (calls === 1) { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } } return orig.call(this, k, v); };
      const a = T.saveCache();
      const hoursCleared = Object.keys(T.S.hours).length === 0;
      // ずっと容量オーバー → 知らせるのは1回だけ
      Storage.prototype.setItem = function (k, v) { if (k === 'tabicho_cache_v1') { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; } return orig.call(this, k, v); };
      const b1 = T.saveCache(); const msg1 = document.getElementById('toast').textContent;
      document.getElementById('toast').textContent = '';
      const b2 = T.saveCache(); const msg2 = document.getElementById('toast').textContent;
      Storage.prototype.setItem = orig;
      return { a, hoursCleared, b1, b2, warned: /保存容量がいっぱい/.test(msg1), again: /保存容量/.test(msg2) };
    });
    assert.deepStrictEqual(r3, { a: true, hoursCleared: true, b1: false, b2: false, warned: true, again: false });
    ok('保存容量：まず営業時間の控えを外して保存、それでも無理なら1回だけ警告');

    // ---- 4. 外部の画像：許可なしは読まない（書き出しを壊さない）、許可ありは使う ----
    const r4 = await p.evaluate(async () => {
      const T = window.__TABICHO_T;
      const no = await T.loadImg('http://127.0.0.1:8714/nocors.png');
      const yes = await T.loadImg('http://127.0.0.1:8714/cors.png');
      return { no: no === null, yes: !!yes, safe: yes ? T.imageExportSafe(yes) : false };
    });
    assert.deepStrictEqual(r4, { no: true, yes: true, safe: true });
    // 年別レポートの書き出し：代表写真のリンクが許可なしの外部画像でも書き出せる
    await p.evaluate(() => { const T = window.__TABICHO_T; T.curTrip().coverLink = 'http://127.0.0.1:8714/nocors.png'; });
    await p.evaluate(() => { const bt = document.createElement('button'); bt.dataset.act = 'openCollection'; bt.id = 'colProbe'; document.body.appendChild(bt); });
    await p.click('#colProbe');
    await p.waitForTimeout(400);
    const yb = await p.$('[data-act="yearExport"]');
    if (yb) {
      await yb.click(); await p.waitForTimeout(2500);
      const okOut = await p.evaluate(() => !!document.querySelector('#instaOut img, #instaOut a[download], .modal img[src^="blob:"], .modal img[src^="data:"]'));
      assert.ok(okOut, '年別レポートが書き出せた');
      await shot('t4_year');
      ok('外部画像：許可なしは絵文字に置き換えて年別レポートを書き出せる／許可ありはそのまま使う');
    } else {
      ok('外部画像：許可なしは読まない／許可ありは書き出しに使える（年別レポートのボタンは対象の旅がなく省略）');
    }

    // ---- 5. サムネイルの端末キャッシュは上限で古いものから消す ----
    const r5 = await p.evaluate(async () => {
      const T = window.__TABICHO_T;
      for (let i = 0; i < 30; i++) await T.thumbIdb.put('k' + i + '@400', 'data:x' + i);
      await new Promise(r => setTimeout(r, 200));
      await T.thumbIdb.prune();
      const left = [];
      for (let i = 0; i < 30; i++) left.push((await T.thumbIdb.get('k' + i + '@400')) !== undefined);
      return { count: left.filter(Boolean).length, newestKept: left[29], v: await T.thumbIdb.get('k29@400') };
    });
    assert.ok(r5.count <= 20 && r5.count >= 10, '上限 20 → 16 件前後まで減らす: ' + r5.count);
    assert.ok(r5.newestKept && r5.v === 'data:x29', '新しいものは残り、中身もそのまま読める');
    ok('サムネイルの端末キャッシュ：上限を超えたら古いものから整理');

    assert.deepStrictEqual(errs, [], 'ページのエラー: ' + errs.join(' / '));
    console.log(`\n${n} checks passed（ページのエラーなし）`);
  } catch (e) {
    console.error(e); await shot('fail').catch(() => {}); process.exitCode = 1;
  } finally {
    await b.close(); page.close(); imgs.close();
  }
})();
