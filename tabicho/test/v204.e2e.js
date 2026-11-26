// 旅帳 v2.0.4 の画面通しテスト（持ち物の下書き・入力中の判定・動画の日付＝ファイル更新日時）
//   node tabicho/test/v204.e2e.js [スクリーンショット保存先]
const { chromium } = require('playwright');
const http = require('http');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const out = process.argv[2] || null; if (out) fs.mkdirSync(out, { recursive: true });
  const page = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(path.join(__dirname, '..', 'gas', 'index.html'))); }).listen(8713, '127.0.0.1');
  await sleep(300);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
  p.on('dialog', d => d.accept());
  const shot = async (n) => { if (out) await p.screenshot({ path: path.join(out, n + '.png'), fullPage: true }); };
  let n = 0; const ok = (s) => { n++; console.log('✓', s); };
  try {
    await p.goto('http://127.0.0.1:8713/');
    await p.waitForTimeout(800);
    const ymd = (d) => new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    const mk = async (title, tz) => {
      await p.click('text=＋ 新しい旅');
      await p.fill('#teTitle', title);
      await p.fill('#teStart', ymd(new Date(Date.now() - 2 * 86400000))); await p.fill('#teEnd', ymd(new Date(Date.now() + 3 * 86400000)));
      if (tz) await p.selectOption('#teTz', tz);
      await p.click('text=この旅を作る'); await p.waitForTimeout(400);
    };
    await mk('ハワイ旅行', 'Pacific/Honolulu');

    // ---- 1. 持ち物の追加欄：入力中に裏から描き直しが来ても文字が残る ----
    await p.click('.nav-item[data-tab="shiori"]');
    await p.click('.seg-btn[data-v="pack"]'); await p.waitForTimeout(200);
    const sel = '.pack-new[data-cat]';
    const cat = await p.getAttribute(sel, 'data-cat');
    const inSel = `.pack-new[data-cat="${cat}"]`;
    await p.click(inSel); await p.type(inSel, '日焼け止め');
    const deferred = await p.evaluate(() => window.__TABICHO_T.softRender());
    assert.strictEqual(deferred, false, '入力中は描き直しを待つ');
    await p.evaluate(() => document.activeElement.blur());   // iOS のキーボードの「完了」相当
    await p.waitForTimeout(600);                               // 保留していた描き直しが走る
    assert.strictEqual(await p.inputValue(inSel), '日焼け止め', '描き直し後も入力した文字が残る');
    await p.click(`[data-act="packAdd"][data-cat="${cat}"]`); await p.waitForTimeout(300);
    assert.ok((await p.textContent('#page-shiori')).includes('日焼け止め'), '追加できた');
    assert.strictEqual(await p.inputValue(inSel), '', '追加したら下書きは消える');
    // 別の旅に前の旅の下書きが出ない
    await p.click(inSel); await p.type(inSel, 'ハワイ用の下書き');
    await p.evaluate(() => document.activeElement.blur());
    await p.click('.nav-item[data-tab="home"]');
    await mk('別の旅', '');
    await p.click('.nav-item[data-tab="shiori"]');
    await p.click('.seg-btn[data-v="pack"]'); await p.waitForTimeout(200);
    assert.strictEqual(await p.inputValue(inSel), '', '別の旅の追加欄は空');
    await shot('u1_pack');
    ok('持ち物の追加欄：描き直しで文字が消えない・追加で下書きを消す・旅ごとに別');

    // ---- 2. 入力中の判定（softRender・focusout・isTyping で同じ） ----
    const r2 = await p.evaluate(async () => {
      const T = window.__TABICHO_T;
      const host = document.getElementById('shioriBody');   // 描き直しで作り直される所
      const mkEl = (html) => { const d = document.createElement('div'); d.innerHTML = html; host.appendChild(d); return d.firstChild; };
      const txt = mkEl('<input id="probeText">'), cb = mkEl('<input type="checkbox" id="probeCb">');
      const kinds = { text: T.isEditingInput(txt), cb: T.isEditingInput(cb), ta: T.isEditingInput(document.createElement('textarea')), sel: T.isEditingInput(document.createElement('select')), btn: T.isEditingInput(document.createElement('button')) };
      // テキスト欄で保留 → チェックボックスへ直接移る → 保留していた描き直しが走る
      txt.focus(); const d1 = T.softRender();
      cb.focus();
      await new Promise(r => setTimeout(r, 500));
      return { kinds, d1, rendered: !document.getElementById('probeText') };
    });
    assert.deepStrictEqual(r2, { kinds: { text: true, cb: false, ta: true, sel: true, btn: false }, d1: false, rendered: true });
    ok('入力中の判定の共通化：テキスト欄からチェックボックスへ移ると保留の描き直しが走る');

    // ---- 3. 動画の日付：手動・EXIF が無ければファイル更新日時（旅の現地の時刻） ----
    const r3 = await p.evaluate(async () => {
      const T = window.__TABICHO_T;
      const t = Object.values(T.S.trips).find(x => x.title === 'ハワイ旅行');
      const at = Date.UTC(2026, 10, 26, 3, 15, 9);   // 日本 11/26 12:15、ハワイ 11/25 17:15
      const base = { tripId: t.id, kind: 'video', name: 'v.mov', size: 10, type: 'video/quicktime', lastModified: at };
      await T.registerMedia(t, Object.assign({ qid: 'a' }, base), { id: 'none1', name: 'v.mov' });
      await T.registerMedia(t, Object.assign({ qid: 'b' }, base, { date: '2026-11-24' }), { id: 'none2', name: 'v2.mov' });
      await T.registerMedia(t, Object.assign({ qid: 'c' }, base, { kind: 'photo', name: 'p.jpg', type: 'image/jpeg' }), { id: 'none3', name: 'p.jpg' });
      await T.registerMedia(t, Object.assign({ qid: 'd' }, base, { lastModified: undefined }), { id: 'none4', name: 'v4.mov' });
      const tt = T.S.trips[t.id];
      const pick = (id) => { const m = tt.media.find(x => x.fileId === id); return [m.date, m.dateSource, m.takenAt]; };
      return { file: pick('none1'), manual: pick('none2'), photo: pick('none3'), none: pick('none4'), today: T.tripToday(tt) };
    });
    assert.deepStrictEqual(r3.file, ['2026-11-25', 'file', '2026-11-25T17:15:09'], '動画はファイル更新日時を旅の現地（ハワイ）の日付・日時で');
    assert.deepStrictEqual(r3.manual.slice(0, 2), ['2026-11-24', 'manual'], '手動指定が最優先');
    assert.deepStrictEqual(r3.photo.slice(0, 2), [r3.today, 'upload'], '写真は今まで通り（EXIF が無ければアップロード日）');
    assert.deepStrictEqual(r3.none.slice(0, 2), [r3.today, 'upload'], '更新日時が無い動画はアップロード日');
    ok('動画の日付：ファイル更新日時（現地の時刻）・手動が優先・写真と更新日時なしは従来どおり');

    assert.deepStrictEqual(errs, [], 'ページのエラー: ' + errs.join(' / '));
    console.log(`\n${n} checks passed（ページのエラーなし）`);
  } catch (e) {
    console.error(e); await shot('fail').catch(() => {}); process.exitCode = 1;
  } finally {
    await b.close(); page.close();
  }
})();
