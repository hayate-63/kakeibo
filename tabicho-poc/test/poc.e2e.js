// PoC 画面の動作確認（模擬サーバ相手・Chromium）。実機（iPhone Safari・実 GAS・実 Drive）の代わりではない
//   node tabicho-poc/test/poc.e2e.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const PAGE = 'http://127.0.0.1:8701/', API = 'http://127.0.0.1:8702';
const set = (o) => fetch(API + '/control?set=' + encodeURIComponent(JSON.stringify(o)));
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'mock-server.js'), '8701', '8702'], { stdio: 'ignore' });
  await sleep(600);
  const b = await chromium.launch();
  const p = await b.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  let n = 0; const ok = (name) => { n++; console.log('✓', name); };
  try {
    await p.goto(PAGE);
    await p.fill('#gasUrl', API + '/exec'); await p.fill('#pin', '1234');
    await p.click('#btnSave'); await p.waitForSelector('#connState .ok');
    ok('接続（別オリジンの HTML → GAS へ PIN 付き POST）');

    // 1. Origin を送る／送らない
    await p.click('#btnT1'); await p.waitForFunction(() => !document.getElementById('btnT1').disabled);
    const t1 = await p.evaluate(() => JSON.parse(localStorage.getItem('poc_results')).t1);
    assert.strictEqual(t1.modes.send.put.readable, true);
    assert.strictEqual(t1.modes.omit.put.readable, false);
    assert.strictEqual(t1.modes.omit.serverSaw, false, 'CORS で弾かれた PUT は送られていない（プリフライトで止まる）');
    assert.match(await p.textContent('#t1Out'), /送れた/);
    ok('項目1：Origin あり＝直接 PUT 成／なし＝CORS で否、判定「送れた」');

    // 2. チャンク（1MB）＋ 2回目の PUT で通信断 → 受信済み位置を確認して再開
    const big = crypto.randomBytes(3 * 1048576 + 12345);
    await set({ failOnPut: 2, exposeRange: true });
    await p.setInputFiles('#fPickRaw', { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: big });
    await p.selectOption('#chunk', '1048576');
    await set({ failOnPut: 2, exposeRange: true, delayMs: 300 });
    await p.click('#btnUp');
    // 3回目のチャンク送信中に通信断（機内モード相当）→ 2秒後に復帰
    await p.waitForFunction(() => /2\.00MB〜/.test(document.getElementById('upState').textContent), null, { timeout: 30000 });
    await p.context().setOffline(true); await sleep(2000); await p.context().setOffline(false);
    await p.waitForFunction(() => /完了/.test(document.getElementById('upState').textContent), null, { timeout: 60000 });
    await set({ delayMs: 0 });
    let ups = await p.evaluate(() => JSON.parse(localStorage.getItem('poc_results')).uploads);
    let u = ups[ups.length - 1];
    assert.strictEqual(u.result, '成'); assert.ok(u.status308 >= 3); assert.ok(u.interruptions.length >= 2, JSON.stringify(u.interruptions)); assert.ok(u.interruptions.some(x => /503/.test(x.reason)) && u.interruptions.some(x => /network/.test(x.reason)), JSON.stringify(u.interruptions)); assert.ok(u.rangeVia.header >= 1);
    let files = await (await fetch(API + '/debug')).json();
    assert.ok(files.some(f => f.md5 === md5(big)), '届いた中身が元と一致');
    ok('項目2：チャンク分割・308 で進捗・一時エラー（503）と通信断（オフライン）から再開・中身一致（md5）');

    // 2'. 308 の Range ヘッダが画面から読めない（Expose されない）場合 → GAS で受信位置を確認
    await set({ exposeRange: false });
    const mid = crypto.randomBytes(2 * 1048576 + 7);
    await p.setInputFiles('#fPickRaw', { name: 'clip.mov', mimeType: 'video/quicktime', buffer: mid });
    await p.click('#btnUp');
    await p.waitForFunction(() => /完了：clip/.test(document.getElementById('upState').textContent), null, { timeout: 30000 });
    ups = await p.evaluate(() => JSON.parse(localStorage.getItem('poc_results')).uploads);
    u = ups[ups.length - 1];
    assert.strictEqual(u.result, '成'); assert.ok(u.rangeNotReadable); assert.ok(u.rangeVia.gas >= 1);
    files = await (await fetch(API + '/debug')).json();
    assert.ok(files.some(f => f.md5 === md5(mid)));
    ok('項目2：Range が読めない時は GAS で受信位置を確認して続行');
    await set({ exposeRange: true });

    // 2''. CORS が通らないセッション（Origin なし）でも GAS 中継なら送れる
    const rel = crypto.randomBytes(600000);
    await p.setInputFiles('#fPickRaw', { name: 'relay.jpg', mimeType: 'image/jpeg', buffer: rel });
    await p.selectOption('#method', 'relay'); await p.selectOption('#originMode', 'omit'); await p.selectOption('#chunk', '262144');
    await p.click('#btnUp');
    await p.waitForFunction(() => /完了：relay/.test(document.getElementById('upState').textContent), null, { timeout: 30000 });
    files = await (await fetch(API + '/debug')).json();
    assert.ok(files.some(f => f.md5 === md5(rel)));
    ok('代替：GAS 中継チャンク（CORS なしのセッション）で完走・中身一致');
    await p.selectOption('#method', 'direct'); await p.selectOption('#originMode', 'send');

    // 2'''. 一時停止 → 再読み込み → 同じファイルを選び直して再開
    const vid = crypto.randomBytes(5 * 1048576 + 99);
    await set({ delayMs: 250 });
    await p.setInputFiles('#fPickRaw', { name: 'IMG_0002.MOV', mimeType: 'video/quicktime', buffer: vid });
    await p.selectOption('#chunk', '1048576');
    await p.click('#btnUp');
    await p.waitForFunction(() => /2\.00MB/.test(document.getElementById('upState').textContent), null, { timeout: 30000 });
    await p.click('#btnPause');
    await sleep(400);
    await p.reload();
    await set({ delayMs: 0 });
    await p.waitForSelector('.resumeSel');
    const fc = p.waitForEvent('filechooser');
    await p.click('.resumeSel');
    await (await fc).setFiles({ name: 'IMG_0002.MOV', mimeType: 'video/quicktime', buffer: vid });
    await p.waitForFunction(() => /完了：IMG_0002/.test(document.getElementById('upState').textContent), null, { timeout: 30000 });
    ups = await p.evaluate(() => JSON.parse(localStorage.getItem('poc_results')).uploads);
    u = ups.find(x => x.name === 'IMG_0002.MOV');
    assert.strictEqual(u.result, '成'); assert.ok(u.resumedAfterReload); assert.ok(u.interruptions.some(x => x.resumedFrom > 0));
    files = await (await fetch(API + '/debug')).json();
    assert.ok(files.some(f => f.md5 === md5(vid)));
    ok('項目2：再読み込み後にファイルを選び直して途中から再開・中身一致');

    // 3. 一覧・サムネイル・原本・判定
    await p.click('#btnList'); await p.waitForSelector('#files .file');
    const card = p.locator('#files .file', { hasText: 'relay.jpg' });
    await card.locator('.bThumb').click(); await p.waitForTimeout(400);
    await card.locator('.judge button[data-k="thumb"][data-v="成"]').click();
    ok('項目3：サムネイル（GAS 経由）・判定の記録');

    // 4. GAS 経由
    await p.setInputFiles('#fSmall', { name: 'small.jpg', mimeType: 'image/jpeg', buffer: crypto.randomBytes(400000) });
    await p.click('#btnSmall'); await p.waitForFunction(() => /成/.test(document.getElementById('smallOut').textContent));
    ok('項目4：GAS 経由の保存と所要時間の記録');

    await p.click('#btnReport');
    const rep = await p.textContent('#report');
    assert.match(rep, /Origin の転送：送れた/); assert.match(rep, /チャンク＋308 で進捗管理：成/); assert.match(rep, /再読み込み後の再開：成/);
    console.log('\n--- 自動生成された結果（模擬サーバ相手） ---\n' + rep.split('■ ログ')[0]);
    ok('結果のまとめ（実装報告に貼る形）');
    assert.deepStrictEqual(errs, []);
    console.log(`\n${n} checks passed（ページのエラーなし）`);
  } catch (e) {
    console.error('FAILED:', e.message, errs); process.exitCode = 1;
  } finally { await b.close(); srv.kill(); }
})();
