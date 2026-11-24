// 旅帳 画面の通しテスト（デモモード）
//   node tabicho/test/smoke.e2e.js [スクリーンショット保存先]
// gas/index.html を Chromium で開き、旅の作成→しおり→予約→ドライブ→お金→記録→設定→行き先提案を操作する
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
(async () => {
  const file = path.join(__dirname, '..', 'gas', 'index.html');
  const outDir = process.argv[2] || null;
  if (outDir) fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, geolocation: { latitude: 34.56, longitude: 135.0 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errs.push('CONSOLE ' + m.text()); });
  p.on('dialog', d => d.accept());
  await p.goto('file://' + file);
  await p.waitForTimeout(1200);
  const shot = async (n) => { if (outDir) await p.screenshot({ path: path.join(outDir, n + '.png'), fullPage: true }); };
  const ymd = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
  const s = ymd(new Date()), e = ymd(new Date(Date.now() + 86400000));
  await shot('01_home');

  await p.click('text=＋ 新しい旅');
  await p.fill('#teTitle', '淡路島ドライブ');
  await p.fill('#teStart', s); await p.fill('#teEnd', e);
  await p.click('.seg-btn[data-v="shiori"]');
  await p.fill('#memNew', '相方、友達'); await p.click('[data-act="memAdd"]');
  await p.click('text=この旅を作る');
  await p.waitForTimeout(400);
  await shot('02_home_trip');

  await p.click('.nav-item[data-tab="shiori"]');
  await p.waitForTimeout(600);
  await p.click('[data-act="addSpotToDay"]');
  await p.waitForTimeout(500);
  for (let i = 0; i < 4; i++) { const bt = await p.$('[data-act="pickSpot"]'); if (bt) await bt.click(); }
  await p.click('[data-act="closeModal"]');
  await p.waitForTimeout(400);
  await p.click('[data-act="addSpotToList"]');
  await p.waitForTimeout(400);
  for (let i = 0; i < 4; i++) { const bt = await p.$('[data-act="pickSpot"]'); if (bt) await bt.click(); }
  await p.click('[data-act="closeModal"]');
  await p.waitForTimeout(900);
  await shot('03_shiori');
  const listBefore = await p.$$eval('.list-zone .lcard', x => x.length);
  const v = await p.$('.lcard [data-act="visitNow"]'); if (v) await v.click();
  await p.waitForTimeout(300);
  await shot('03b_quick_visit');
  await p.click('.face[data-v="4"]');
  await p.waitForTimeout(500);
  const listAfter = await p.$$eval('.list-zone .lcard', x => x.length);
  const doneCount = await p.$eval('.done-head', x => x.textContent).catch(() => '');
  console.log('list', listBefore, '->', listAfter, '|', doneCount.trim());

  // モード切替（しおり→リスト→しおり）で時刻が保持されるか
  const schedBefore = await p.$$eval('.tl-row', x => x.length);
  await p.click('.seg-btn[data-name="mode"][data-v="list"]'); await p.waitForTimeout(300);
  const schedInList = await p.$$eval('.tl-row', x => x.length);
  await p.click('.seg-btn[data-name="mode"][data-v="shiori"]'); await p.waitForTimeout(300);
  await p.click('[data-act="restoreAllTimes"]'); await p.waitForTimeout(300);
  const schedRestored = await p.$$eval('.tl-row', x => x.length);
  console.log('mode switch rows', schedBefore, schedInList, schedRestored);

  await p.click('.seg-btn[data-v="book"]');
  await p.click('text=＋ 予約を追加');
  await p.fill('#bkTitle', '洲本温泉 旅館'); await p.fill('#bkDate', s); await p.fill('#bkTime', '16:00');
  await p.fill('[data-mf="amount"]', '30001');
  await p.click('.seg-btn[data-v="予約済"]');
  await shot('04_booking_modal');
  await p.click('[data-act="bkSave"]');
  await p.waitForTimeout(300);
  await shot('05_bookings');
  await p.click('.seg-btn[data-v="pack"]');
  await shot('06_pack');
  await p.click('.seg-btn[data-v="plan"]');
  await p.waitForTimeout(400);
  const locked = await p.$$eval('.tl-row.fixed', x => x.length);
  console.log('fixed rows from booking', locked);
  await shot('07_plan_after_booking');

  await p.click('.nav-item[data-tab="drive"]'); await p.waitForTimeout(700); await shot('08_drive');
  await p.click('.nav-item[data-tab="money"]'); await p.waitForTimeout(500);
  await p.click('text=＋ 支出を追加');
  await p.fill('#exDesc', '昼ごはん'); await p.fill('[data-mf="amount"]', '3500');
  await p.selectOption('[data-mf="payer"]', { index: 1 });
  await shot('09_expense_modal');
  await p.click('[data-act="exSave"]');
  await shot('10_money');
  await p.click('.seg-btn[data-v="settle"]'); await p.waitForTimeout(200);
  const tg = await p.$('[data-act="txToggle"]'); if (tg) await tg.click();
  await shot('11_settle');
  await p.click('.seg-btn[data-v="kakeibo"]'); await shot('12_kakeibo');
  await p.click('[data-act="kkSend"]'); await p.waitForTimeout(400); await shot('12b_kakeibo_sent');
  await p.click('.nav-item[data-tab="record"]'); await shot('13_record');
  await p.click('[data-act="openSettings"]'); await shot('14_settings'); await p.click('[data-act="closeModal"]');
  await p.click('.nav-item[data-tab="home"]');
  await p.click('text=🧭 行き先を探す'); await p.click('[data-act="sgHolidays"]'); await p.waitForTimeout(400);
  await p.click('[data-act="sgRun"]'); await p.waitForTimeout(1200); await shot('15_suggest');
  const sg = await p.$$eval('.card.sg', x => x.length);
  console.log('suggestions', sg);
  console.log(errs.join('\n') || 'NO ERRORS');
  await b.close();
  if (errs.length) process.exit(1);
})();
