// 旅帳 v2.2 の画面通しテスト（しおり・精算の画像書き出し、寄り道レーダー、仮しおりの自動生成）
//   node tabicho/test/v22.e2e.js [スクリーンショット保存先]
//   時計は 2026-11-30（月）10:00 JST に固定、現在地は淡路島（34.30, 134.90）
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
  const errs = [];
  let n = 0; const ok = (s) => { n++; console.log('✓', s); };
  const open = async (geo) => {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo' }, geo ? { geolocation: { latitude: 34.30, longitude: 134.90 }, permissions: ['geolocation'] } : {}));
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-11-30T10:00:00+09:00') });
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto('http://127.0.0.1:8713/');
    await p.waitForTimeout(800);
    return { ctx, p };
  };
  // 旅を1つ作って、工程・リスト・支出を入れる
  const seed = (p, withMoney) => p.evaluate((withMoney) => {
    const T = window.__TABICHO_T, S = T.S;
    const t = T.curTrip();
    t.startDate = '2026-11-30'; t.endDate = '2026-12-01'; t.mode = 'shiori'; t.title = '淡路島ドライブ'; t.area = '淡路島';
    t.origin = { lat: 34.30, lng: 134.90, name: '家' };
    t.items.push(T.newItem({ name: '朝の公園', date: '2026-11-30', start: '09:00', startManual: true, stay: 40, order: 1, memo: '駐車場は北側', priceEst: 500, lat: 34.300, lng: 134.900, hoursText: '6:00-20:00' }));
    t.items.push(T.newItem({ name: '出航', kind: 'fixed', date: '2026-11-30', start: '11:00', locked: true, startManual: true, stay: 30, order: 2, lat: 34.300, lng: 134.900 }));
    t.items.push(T.newItem({ name: '宿', kind: 'fixed', date: '2026-12-01', start: '15:00', locked: true, startManual: true, stay: 60, order: 1, lat: 34.35, lng: 134.95 }));
    t.items.push(T.newItem({ name: '近くのカフェ', hoursText: '8:00-22:00', stayEst: 20, priority: 'must', lat: 34.303, lng: 134.900 }));
    t.items.push(T.newItem({ name: '長居の美術館', hoursText: '8:00-22:00', stayEst: 90, lat: 34.304, lng: 134.901 }));
    t.items.push(T.newItem({ name: '月曜定休の店', hoursText: '10:00-17:00 月曜定休', stay: 60, lat: 34.33, lng: 134.93 }));
    if (withMoney) {
      t.members.push({ id: 'mB', name: 'はな' });
      const me = t.members[0];
      t.expenses.push({ id: 'e1', date: '2026-11-30', desc: '宿代', cat: '宿', money: T.newMoney(t, { amount: 24000, payer: me.id }) });
      t.expenses.push({ id: 'e2', date: '2026-11-30', desc: 'ランチ', cat: '食費', money: T.newMoney(t, { amount: 3000, payer: 'mB' }) });
    }
    T.commitTrip(t);
    return t.id;
  }, withMoney);
  const thumbs = (p) => p.$$eval('.modal .exp-thumb', cs => cs.length);
  try {
    const { ctx, p } = await open(true);
    const shot = async (nm) => { if (out) await p.screenshot({ path: path.join(out, nm + '.png'), fullPage: true }); };
    await p.click('text=＋ 新しい旅');
    await p.fill('#teTitle', '仮'); await p.click('text=この旅を作る'); await p.waitForTimeout(300);
    await seed(p, true);

    // ---- B-1 しおり書き出し ----
    await p.click('.nav-item[data-tab="shiori"]'); await p.waitForTimeout(300);
    await p.click('[data-act="shioriExport"]'); await p.waitForTimeout(800);
    assert.strictEqual(await thumbs(p), 3, '表紙＋予定のある2日');
    assert.ok(/3枚を書き出す/.test(await p.textContent('#seBtn')));
    await p.check('#seList'); await p.waitForTimeout(500);
    assert.strictEqual(await thumbs(p), 4, '未配置リストを足すと4枚');
    await p.check('#sePriv'); await p.waitForTimeout(400);
    await p.click('.seg-btn[data-act="seSize"][data-v="tall"]'); await p.waitForTimeout(500);
    assert.strictEqual(await thumbs(p), 4);
    await shot('b1_shiori_export');
    await p.click('#seBtn'); await p.waitForTimeout(1500);
    const imgs = await p.$$eval('#instaOut img', x => x.length);
    assert.strictEqual(imgs, 4, '共有シートが無い環境は画像一覧で出る');
    await p.click('.modal-wrap:last-child [data-act="closeModal"]'); await p.click('.modal-wrap:last-child [data-act="closeModal"]');
    ok('B-1 しおり書き出し：表紙・日別・未配置、プライバシー・縦長、プレビューと書き出し（4枚）');

    // ---- B-2 精算カード ----
    await p.click('.nav-item[data-tab="money"]'); await p.click('.seg-btn[data-v="settle"]'); await p.waitForTimeout(300);
    await p.click('[data-act="settleExport"]'); await p.waitForTimeout(800);
    assert.strictEqual(await thumbs(p), 1, '全員まとめは1枚');
    await p.click('.seg-btn[data-act="srMode"][data-v="each"]'); await p.waitForTimeout(500);
    const nTx = await p.evaluate(() => window.__TABICHO_T.computeTransfers(window.__TABICHO_T.curTrip()).transfers.length);
    assert.ok(nTx >= 1); assert.strictEqual(await thumbs(p), nTx, '送金ごと');
    await shot('b2_receipt');
    await p.click('#srBtn'); await p.waitForTimeout(1200);
    assert.strictEqual(await p.$$eval('#instaOut img', x => x.length), nTx);
    await p.click('.modal-wrap:last-child [data-act="closeModal"]'); await p.click('.modal-wrap:last-child [data-act="closeModal"]');
    // 精算なし
    await p.evaluate(() => { const T = window.__TABICHO_T; const t = T.curTrip(); t.expenses = []; T.commitTrip(t); });
    await p.click('[data-act="settleExport"]'); await p.waitForTimeout(600);
    assert.strictEqual(await thumbs(p), 1, '精算なしでも、まとめは「精算の必要はありません」の1枚');
    await p.click('.seg-btn[data-act="srMode"][data-v="each"]'); await p.waitForTimeout(400);
    assert.strictEqual(await thumbs(p), 0);
    assert.ok(/精算はありません/.test(await p.textContent('#srMsg')));
    assert.ok(await p.$eval('#srBtn', x => x.disabled), '送金ごとは書き出しボタンを押せない');
    await p.click('.modal-wrap:last-child [data-act="closeModal"]');
    ok('B-2 精算カード：全員まとめ1枚・送金ごと・精算なしでも破綻しない');

    // ---- C-1 寄り道レーダー ----
    await p.click('.nav-item[data-tab="drive"]'); await p.waitForTimeout(300);
    await p.click('[data-act="detourOpen"]'); await p.waitForTimeout(1200);
    const body = await p.textContent('#detourBody');
    assert.ok(/出航/.test(body) && /あと 60分/.test(body), '次の固定枠まで60分: ' + body.slice(0, 120));
    assert.ok(body.includes('近くのカフェ'), '往復＋滞在が間に合うものは出る');
    assert.ok(!body.includes('長居の美術館'), '滞在90分は間に合わないので出ない');
    await shot('c1_detour');
    await p.click('.card.detour:has-text("近くのカフェ") [data-act="detourInsert"]'); await p.waitForTimeout(600);
    const day1 = await p.evaluate(() => { const T = window.__TABICHO_T; return T.daySchedule(T.curTrip(), '2026-11-30').map(r => r.info.name + '@' + Math.round(r.start)); });
    assert.deepStrictEqual(day1.map(x => x.split('@')[0]), ['朝の公園', '近くのカフェ', '出航']);
    assert.ok(day1[2].endsWith('@660'), '固定枠（出航 11:00）は動かない');
    ok('C-1 寄り道レーダー：固定枠まで60分で間に合うものだけ、差し込みで固定枠は動かない');

    // ---- C-2 仮しおり ----
    await p.click('.nav-item[data-tab="shiori"]'); await p.waitForTimeout(300);
    const before = await p.evaluate(() => JSON.stringify(window.__TABICHO_T.curTrip().items));
    await p.click('[data-act="autoPlanOpen"]'); await p.waitForTimeout(500);
    const prev = await p.textContent('.modal');
    assert.ok(/まだしおりは変わっていません/.test(prev));
    await shot('c2_plan');
    await p.click('.modal-wrap:last-child button[data-act="closeModal"]:has-text("キャンセル")'); await p.waitForTimeout(300);
    assert.strictEqual(await p.evaluate(() => JSON.stringify(window.__TABICHO_T.curTrip().items)), before, 'キャンセルでは何も変わらない');
    await p.click('[data-act="autoPlanOpen"]'); await p.waitForTimeout(500);
    await p.click('[data-act="autoPlanApply"]'); await p.waitForTimeout(600);
    const after = await p.evaluate(() => { const t = window.__TABICHO_T.curTrip(); return t.items.map(i => ({ n: i.name, d: i.date, s: i.start, l: i.locked })); });
    const g = (nm) => after.find(x => x.n === nm);
    assert.strictEqual(g('月曜定休の店').d, '2026-12-01', '月曜定休は火曜へ');
    assert.deepStrictEqual([g('出航').d, g('出航').s, g('宿').d, g('宿').s], ['2026-11-30', '11:00', '2026-12-01', '15:00'], '固定枠は動かない');
    ok('C-2 仮しおり：プレビュー→キャンセルで変化なし、反映で定休日を避けて配置・固定枠はそのまま');
    await ctx.close();

    // ---- 位置情報なし ----
    const o2 = await open(false);
    await o2.p.click('text=＋ 新しい旅'); await o2.p.fill('#teTitle', '仮2'); await o2.p.click('text=この旅を作る'); await o2.p.waitForTimeout(300);
    await o2.p.click('.nav-item[data-tab="drive"]'); await o2.p.waitForTimeout(300);
    await o2.p.click('[data-act="detourOpen"]');
    await o2.p.waitForFunction(() => /現在地が分かりません/.test(document.getElementById('toast').textContent), null, { timeout: 20000 });
    assert.strictEqual(await o2.p.$('#detourBody'), null, '候補の画面は開かない');
    await o2.ctx.close();
    ok('C-1 位置情報なし：「現在地が分かりません」で終わり、候補は出さない');

    assert.deepStrictEqual(errs, [], 'ページのエラー: ' + errs.join(' / '));
    console.log(`\n${n} checks passed（ページのエラーなし）`);
  } catch (e) {
    console.error(e); process.exitCode = 1;
  } finally {
    await b.close(); page.close();
  }
})();
