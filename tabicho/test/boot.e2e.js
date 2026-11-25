// 起動ガードとモード判定のテスト（v2.0.1）
//   node tabicho/test/boot.e2e.js
// GAS の配信を真似るため、ページは「tabicho.test」という手元以外のホスト名で配信する（route で差し替え）
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'), 'utf8');
const GAS_STUB = () => {
  const runner = { _s: null, withSuccessHandler(f) { this._s = f; return this; }, withFailureHandler() { return this; },
    apiCall(name) { (window.__calls = window.__calls || []).push(name); const s = this._s; if (name === 'bootstrap') setTimeout(() => s(JSON.stringify({ settings: null, trips: [] })), 10); } };
  window.google = { script: { run: runner } };
};

(async () => {
  const b = await chromium.launch();
  let n = 0; const ok = (s) => { n++; console.log('✓', s); };
  async function open(html, opt) {
    opt = opt || {};
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    if (opt.gas) await ctx.addInitScript(GAS_STUB);
    if (opt.init) await ctx.addInitScript(opt.init);
    await ctx.route('http://tabicho.test/**', r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await ctx.route(/unpkg\.com|fonts\.googleapis|fonts\.gstatic/, r => r.abort());
    const p = await ctx.newPage();
    p.on('dialog', d => d.accept());
    await p.goto('http://tabicho.test/');
    await p.waitForTimeout(opt.wait || 1200);
    return { p, ctx };
  }
  const panel = (p) => p.$eval('#bootPanel', e => e.innerText).catch(() => '');
  try {
    // 1. GAS として開く（手元以外のホスト＋google.script.run あり）：起動し、デモにならない
    let { p, ctx } = await open(HTML, { gas: true });
    assert.strictEqual(await p.$$eval('#nav .nav-item', x => x.length), 5);
    assert.strictEqual(await p.evaluate(() => window.__TB.started), true);
    assert.strictEqual(await p.textContent('#modeBanner'), '');
    assert.ok((await p.evaluate(() => window.__calls)).includes('bootstrap'));
    assert.strictEqual(await panel(p), '');
    await ctx.close(); ok('GAS として起動（デモの帯なし・サーバを呼ぶ・起動ガードは出ない）');

    // 2. 手元以外のホストで google.script.run が無い：デモに切り替えず赤い帯、サーバ呼び出しは失敗として扱う
    ({ p, ctx } = await open(HTML));
    assert.match(await p.textContent('#modeBanner'), /GAS の接続部品が読み込めていません/);
    assert.strictEqual(await p.evaluate(() => localStorage.getItem('tabicho_mock_db_v1')), null, '模擬データを作らない');
    await ctx.close(); ok('本番で GAS 部品が無い時はデモに落ちない（赤い帯で明示）');

    // 3. 本体スクリプトが途中で欠けた：起動しない → 6秒後に「長さが違います」
    const js = HTML.match(/<script id="appScript">([\s\S]*)<\/script>/)[1];
    const cut = HTML.replace(js, () => js.slice(0, Math.floor(js.length * 0.8)));
    ({ p, ctx } = await open(cut, { gas: true, wait: 6800 }));
    let t = await panel(p);
    assert.match(t, /起動しませんでした/); assert.match(t, /長さが違います/);
    await ctx.close(); ok('本体が欠けた時：起動ガードが「長さが違う」と表示');

    // 4. 1文字だけ変わった（貼り付けでの置き換えを想定）：構文エラーの文面と、中身が違うことを表示
    const bad = HTML.replace(js, () => js.replace("const APP_VERSION = '", () => "const APP_VERSION = ''"));
    ({ p, ctx } = await open(bad, { gas: true, wait: 1500 }));
    t = await panel(p);
    assert.match(t, /スクリプトでエラー/); assert.match(t, /SyntaxError|Unexpected|Invalid/); assert.match(t, /長さが違います|中身が違います/);
    await ctx.close(); ok('構文エラー：エラーの文面と行番号、本体の不一致を表示');

    // 5. GAS 側の部品が同じ名前のグローバル（変更不可）を持っていても起動する（本体を関数で包んだため）
    const collide = () => { ['MQ', 'TH', 'VIS', 'PREFS', 'THEMES', 'S', 'ACT', 'api'].forEach(k => Object.defineProperty(window, k, { value: 1, writable: false, configurable: false })); };
    ({ p, ctx } = await open(HTML, { gas: true, init: collide }));
    assert.strictEqual(await p.evaluate(() => window.__TB.started), true);
    assert.strictEqual(await p.$$eval('#nav .nav-item', x => x.length), 5);
    await ctx.close(); ok('グローバル名がぶつかっても起動（本体は関数の中）');

    // 6. 端末に壊れた旅が残っていても、その旅だけ外して起動し、退避して知らせる
    const brokenCache = () => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.setItem('tabicho_cache_v1', JSON.stringify({ settings: {}, curTripId: 'ok1', dirty: {},
        trips: { bad1: { id: 'bad1', title: '壊れた旅', record: null, items: 'x' }, ok1: { id: 'ok1', title: '正常な旅', items: [], record: { days: {} }, members: [{ id: 'm', name: '自分', isMe: true }], bookings: [], expenses: [], fuel: [], vehicles: ['car'] } } }));
    };
    ({ p, ctx } = await open(HTML, { gas: true, init: brokenCache, wait: 1500 }));
    assert.strictEqual(await p.evaluate(() => window.__TB.started), true);
    t = await panel(p);
    assert.match(t, /起動しましたが/); assert.match(t, /壊れた旅/);
    assert.ok(await p.evaluate(() => Object.keys(localStorage).some(k => k.startsWith('tabicho_cache_broken_'))));
    await ctx.close(); ok('壊れた旅だけ外して起動・退避・画面で知らせる');

    // 7. 退避ボタン：保存データを別名に移して開き直す（消さない）
    const failing = HTML.replace(js, () => js.replace('function init() {', () => 'function init() { throw new Error("テスト用の起動失敗");'));
    ({ p, ctx } = await open(failing, { gas: true, init: () => localStorage.setItem('tabicho_cache_v1', '{"x":1}'), wait: 1500 }));
    t = await panel(p);
    assert.match(t, /テスト用の起動失敗/);
    await p.click('#bootReset'); await p.waitForTimeout(800);
    const keys = await p.evaluate(() => Object.keys(localStorage));
    assert.ok(keys.some(k => k.startsWith('tabicho_backup_')));
    await ctx.close(); ok('「保存データを退避」で端末データを別名に移す');

    // 8. 手元（127.0.0.1／file://）はデモモードを帯で明示
    ({ p, ctx } = await (async () => { const c = await b.newContext(); const pg = await c.newPage(); await pg.goto('file://' + path.join(__dirname, '..', 'gas', 'index.html')); await pg.waitForTimeout(1000); return { p: pg, ctx: c }; })());
    assert.match(await p.textContent('#modeBanner'), /デモモード/);
    await ctx.close(); ok('手元で開いた時はデモモードを帯で明示');

    console.log(`\n${n} checks passed`);
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  await b.close();
})();
