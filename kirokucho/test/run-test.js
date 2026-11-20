// 記録帳 v1.0 自己検証（引き継ぎメモ §10）
//   node run-test.js
// Part A: GAS をモック環境で直接呼ぶ単体テスト
// Part B: Chromium（Playwright）でアプリを操作する通しテスト（GAS はモックに中継）
const path = require('path'), fs = require('fs');
const { makeEnv } = require('./gasmock');

const ROOT = path.join(__dirname, '..');
const GAS_PATH = path.join(ROOT, 'gas-v1.0.txt');
const HTML_PATH = path.join(ROOT, 'index-v1.0.html');
const PIN = 'Kiroku#2026';
const HH_URL = 'https://script.google.com/macros/s/HOUSEHOLD_TEST/exec';

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail) {
  if (cond) { pass++; results.push('PASS ' + name); }
  else { fail++; results.push('FAIL ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}

// 家計簿 GAS v3.0.2 形式の loadAll 応答（ほしいもの帳の照合結果に基づく）
function hhMock(state) {
  return (url, o) => {
    state.calls.push({ url, method: (o && o.method) || 'get' });
    if (state.mode === 'throw') return { throw: 'DNS error' };
    if (state.mode === 'http500') return { code: 500, body: 'error' };
    if (state.mode === 'html') return { code: 200, body: '<html>login</html>' };
    const m = url.match(/[?&]pin=([^&]*)/);
    const pin = m ? decodeURIComponent(m[1]) : '';
    if (pin !== state.pin) return { code: 200, body: { status: 'unauthorized' } };
    if (!/[?&]action=loadAll(&|$)/.test(url)) return { code: 200, body: { status: 'error', message: 'unknown action' } };
    return { code: 200, body: { status: 'ok', rev: 42, logs: state.logs, config: state.config, budget: [], categories: [] } };
  };
}

// =====================================================================
// Part A: GAS 単体
// =====================================================================
function partA() {
  // ---- A1. SECRET_PIN 未設定なら全て拒否 ----
  {
    const env = makeEnv({ gasPath: GAS_PATH, props: {} });
    env.setup();
    const actions = ['auth', 'loadAll', 'save', 'fund', 'changePin'];
    const rs = actions.map(a => env.doPost({ action: a, pin: '', baseRev: 0, tables: { practice: [] }, newPin: 'abcd' }));
    check('A1 SECRET_PIN 未設定: 空PINで全 action が unauthorized', rs.every(r => r.status === 'unauthorized'), rs);
    const rs2 = actions.map(a => env.doPost({ action: a, pin: '1234', baseRev: 0, tables: {}, newPin: 'abcd' }));
    check('A1 SECRET_PIN 未設定: "1234" 等でも unauthorized（既定PINなし）', rs2.every(r => r.status === 'unauthorized'), rs2);
    const rs3 = actions.map(a => env.doPost({ action: a, pin: 'undefined' }));
    check('A1 SECRET_PIN 未設定: "undefined"/"null" 文字列でも拒否', rs3.every(r => r.status === 'unauthorized') && env.doPost({ action: 'auth', pin: 'null' }).status === 'unauthorized');
    check('A1 SECRET_PIN 未設定: changePin で PIN を作れない', !env.props.SECRET_PIN);
    check('A1 setup のログに SECRET_PIN 未設定の注意が出る', /SECRET_PIN が未設定/.test(env.lastLog), env.lastLog);
    env.props.SECRET_PIN = '';
    check('A1 SECRET_PIN が空文字でも拒否', env.doPost({ action: 'auth', pin: '' }).status === 'unauthorized');
    check('A1 ping は認証なしで応答（データは返さない）', (r => r.status === 'ok' && !r.practice)(env.doPost({ action: 'ping' })));
  }

  const hh = { mode: 'ok', pin: PIN, calls: [], config: [{ key: 'actualBalance', value: 640000 }], logs: [] };
  const env = makeEnv({ gasPath: GAS_PATH, props: { SECRET_PIN: PIN }, fetch: hhMock(hh) });
  env.setup();
  const P = obj => env.doPost(Object.assign({ pin: PIN }, obj));

  // ---- A2. setup ----
  {
    const d = P({ action: 'loadAll' });
    check('A2 setup: 6シート作成・既定シート削除', ['practice', 'trades', 'conditions', 'fund', 'milestones', 'settings'].every(n => env.ss.getSheetByName(n)) && !env.ss.getSheetByName('シート1'));
    check('A2 setup: rev=0', d.rev === 0, d.rev);
    check('A2 setup: マイルストーン初期値4件', d.milestones.length === 4 &&
      d.milestones[0].period === '2026年12月' && /現金50万円突破/.test(d.milestones[0].content) &&
      d.milestones[1].period === '2027年7月' && /防衛資金100万円到達/.test(d.milestones[1].content) && /ペーパー100回完了/.test(d.milestones[1].content) &&
      d.milestones[2].period === '2027年8月' && /実弾50万円解禁/.test(d.milestones[2].content) &&
      d.milestones[3].period === '2028年1月' && /計150万円到達＆家探し/.test(d.milestones[3].content), d.milestones);
    check('A2 setup: 目標額の初期値 1,000,000', d.fund.target === 1000000, d.fund);
    check('A2 setup: 連携は OFF で開始', d.settings.householdEnabled === '0');
    env.setup();
    check('A2 setup を2回実行してもマイルストーンは増えない', P({ action: 'loadAll' }).milestones.length === 4);
  }

  // ---- A3. 認証 ----
  {
    check('A3 正しい PIN で auth=ok', P({ action: 'auth' }).status === 'ok');
    check('A3 違う PIN は unauthorized', env.doPost({ action: 'auth', pin: 'wrong' }).status === 'unauthorized');
    for (let i = 0; i < 10; i++) env.doPost({ action: 'auth', pin: 'wrong' + i });
    check('A3 10回失敗で正しい PIN でもロック', P({ action: 'auth' }).status === 'unauthorized');
    env.cache.pinFails = '0';
    check('A3 ロック解除後は通る', P({ action: 'auth' }).status === 'ok');
  }

  // ---- A4. 保存・baseRev 競合 ----
  let rev = 0;
  const pr1 = { id: 'p1', date: '2026-11-20', lens: 'volume', symbol: '7203 トヨタ', jumpDate: '2026-11-10', candle: '大きな陽線', after3d: '上げ', note: '出来高3倍', createdAt: '2026-11-20T01:00:00Z' };
  {
    const r = P({ action: 'save', baseRev: rev, tables: { practice: [pr1] } });
    check('A4 練習の保存: status=saved, rev 0→1', r.status === 'saved' && r.rev === 1, r);
    rev = r.rev;
    check('A4 銘柄コードは文字列のまま（数値化されない）', P({ action: 'loadAll' }).practice[0].symbol === '7203 トヨタ');
    const r0 = P({ action: 'save', baseRev: rev, tables: { practice: [Object.assign({}, pr1, { id: 'p9', symbol: '6758' })] } });
    rev = r0.rev;
    const ld = P({ action: 'loadAll' });
    check('A4 数字だけの銘柄 "6758" も文字列で保持', ld.practice[0].symbol === '6758' && typeof ld.practice[0].symbol === 'string', ld.practice[0]);
    const before = JSON.stringify(env.sheetRows('practice'));
    const c = P({ action: 'save', baseRev: 0, tables: { practice: [] } });
    check('A4 baseRev 不一致 → conflict（現在 rev を返す）', c.status === 'conflict' && c.rev === rev, c);
    check('A4 conflict の時はシートが上書きされない', JSON.stringify(env.sheetRows('practice')) === before);
    check('A4 conflict の時は rev が進まない', P({ action: 'loadAll' }).rev === rev);
    const c2 = P({ action: 'save', tables: { practice: [pr1] } });
    check('A4 baseRev なし → conflict', c2.status === 'conflict', c2);
    env.lockBusy = true;
    const b = P({ action: 'save', baseRev: rev, tables: { practice: [pr1] } });
    env.lockBusy = false;
    check('A4 ロックが取れない → busy（書かない）', b.status === 'busy' && P({ action: 'loadAll' }).rev === rev, b);
    const bad = P({ action: 'save', baseRev: rev, tables: { practice: [Object.assign({}, pr1, { note: '' })] } });
    check('A4 気づき空欄 → error（必須）', bad.status === 'error' && /気づき/.test(bad.reason), bad);
    const bad2 = P({ action: 'save', baseRev: rev, tables: { practice: [Object.assign({}, pr1, { symbol: ' ' })] } });
    check('A4 銘柄空欄 → error（必須）', bad2.status === 'error', bad2);
    const dup = P({ action: 'save', baseRev: rev, tables: { practice: [pr1, pr1] } });
    check('A4 id 重複 → error', dup.status === 'error', dup);
    check('A4 エラー時は rev が進まない', P({ action: 'loadAll' }).rev === rev);
    // 一括消失ガード
    const r2 = P({ action: 'save', baseRev: rev, tables: { practice: [pr1, Object.assign({}, pr1, { id: 'p2' }), Object.assign({}, pr1, { id: 'p3' })] } });
    rev = r2.rev;
    const g = P({ action: 'save', baseRev: rev, tables: { practice: [pr1] } });
    check('A4 一度に2件以上減る保存は拒否', g.status === 'error' && /減る保存を中止/.test(g.reason), g);
    const g0 = P({ action: 'save', baseRev: rev, tables: { practice: [] } });
    check('A4 3件→0件の保存は拒否（空上書きガード）', g0.status === 'error', g0);
    const d1 = P({ action: 'save', baseRev: rev, tables: { practice: [pr1, Object.assign({}, pr1, { id: 'p2' })] } });
    check('A4 1件ずつの削除は通る', d1.status === 'saved' && d1.tables.practice.length === 2, d1);
    rev = d1.rev;
    check('A4 保存前にバックアップ（bk_ 隠しシート）を作る', env.ss.getSheets().some(s => /^bk_practice_/.test(s.getName()) && s._hidden));
  }

  // ---- A5. RR・結果の検証（GAS 側で計算し直す） ----
  {
    const t = (id, result, e, tp, sl, extra) => Object.assign({ id, date: '2026-11-20', symbol: 'S' + id, basis: '出来高急増', entryPrice: e, takeProfit: tp, stopLoss: sl, result, pnl: '', memo: '', enWhat: '', enWhy: '', enNext: '', createdAt: '' }, extra || {});
    const r = P({ action: 'save', baseRev: rev, tables: { trades: [
      t('t1', 'win', 1000, 1300, 900, { rr: 99 }),     // RR 3（クライアントの値は無視）
      t('t2', 'lose', 1000, 1100, 900),                // RR 1
      t('t3', 'skip', '', '', ''),                     // RR 空欄
      t('t4', 'win', 500, 520, 510),                   // RR 2
      t('t5', 'lose', 1000, 1200, 1000),               // 損切り幅0 → 空欄
      t('t6', 'skip', '1,000', '1,250', '900')         // カンマ付き → 2.5
    ] } });
    rev = r.rev;
    const tr = Object.fromEntries(r.tables.trades.map(x => [x.id, x]));
    check('A5 RR = |利確−IN|÷|IN−損切り|（3.00 / 1.00 / 2.00 / 2.50）', tr.t1.rr === 3 && tr.t2.rr === 1 && tr.t4.rr === 2 && tr.t6.rr === 2.5, r.tables.trades.map(x => x.rr));
    check('A5 価格が揃わない・損切り幅0 → RR 空欄', tr.t3.rr === '' && tr.t5.rr === '', [tr.t3.rr, tr.t5.rr]);
    check('A5 RR はクライアントの値でなく GAS で計算', tr.t1.rr === 3);
    const bad = P({ action: 'save', baseRev: rev, tables: { trades: [t('t1', 'draw', 1, 2, 0)] } });
    check('A5 結果が win/lose/skip 以外 → error', bad.status === 'error', bad);
    const bad2 = P({ action: 'save', baseRev: rev, tables: { trades: [t('t1', 'win', 'abc', 2, 0)] } });
    check('A5 価格が数値でない → error', bad2.status === 'error', bad2);
  }

  // ---- A6. コンディション判定（保存時に自動） ----
  {
    const r = P({ action: 'save', baseRev: rev, tables: { conditions: [
      { date: '2026-11-19', sleepOk: '1', noFatigue: '1', calm: '1', judge: 'watch' },
      { date: '2026-11-20', sleepOk: '1', noFatigue: '0', calm: '1', judge: 'ok' }
    ] } });
    rev = r.rev;
    const c = Object.fromEntries(r.tables.conditions.map(x => [x.date, x]));
    check('A6 全ON → ok（送られた judge は無視）', c['2026-11-19'].judge === 'ok', c);
    check('A6 1つOFF → watch', c['2026-11-20'].judge === 'watch', c);
    const d = P({ action: 'save', baseRev: rev, tables: { conditions: [r.tables.conditions[0], r.tables.conditions[1], { date: '2026-11-20', sleepOk: '1', noFatigue: '1', calm: '1' }] } });
    check('A6 同じ日付の2件目 → error（1日1件）', d.status === 'error', d);
  }

  // ---- A7. 資金（家計簿連携） ----
  {
    let f = P({ action: 'fund' });
    check('A7 連携 OFF → disabled「連携が OFF です」', f.status === 'disabled' && f.reason === '連携が OFF です', f);
    check('A7 OFF の時は家計簿を呼ばない', hh.calls.length === 0);
    const bu = P({ action: 'save', baseRev: rev, tables: { settings: { householdUrl: 'https://evil.example.com/exec', householdEnabled: '1' } } });
    check('A7 家計簿 URL が script.google.com 以外 → error（PIN を送らない）', bu.status === 'error', bu);
    const s = P({ action: 'save', baseRev: rev, tables: { settings: { householdUrl: HH_URL, householdEnabled: '1' } } });
    rev = s.rev;
    check('A7 連携設定の保存', s.status === 'saved' && s.tables.settings.householdEnabled === '1' && s.tables.settings.householdUrl === HH_URL, s);
    f = P({ action: 'fund' });
    check('A7 actualBalance 640,000 → 残高 640,000・防衛枠 640,000', f.status === 'ok' && f.fund.balance === 640000 && f.fund.defenseFund === 640000 && f.source === 'actual', f);
    const call = hh.calls[hh.calls.length - 1];
    check('A7 家計簿へは GET ?action=loadAll&pin=…（書き込み POST はしない）', call.method === 'get' && /action=loadAll/.test(call.url) && hh.calls.every(c => c.method === 'get'), hh.calls);
    check('A7 取得値を fund シートにキャッシュ', P({ action: 'loadAll' }).fund.balance === 640000 && !!P({ action: 'loadAll' }).fund.fetchedAt);
    check('A7 キャッシュ書き込みでは rev を進めない', P({ action: 'loadAll' }).rev === rev);
    hh.config = [{ key: 'actualBalance', value: '1,250,000' }];
    f = P({ action: 'fund' });
    check('A7 残高 1,250,000 → 防衛枠 MIN(残高,1,000,000)=1,000,000', f.fund.balance === 1250000 && f.fund.defenseFund === 1000000, f.fund);
    // ログ算出（actualBalance=0）: 家計簿 calculateDodaiMetrics と同じ
    hh.config = [{ key: 'actualBalance', value: 0 }, { key: 'dodai_start_balance', value: 300000 }, { key: 'dodai_start_ym', value: '2026-06' }];
    hh.logs = [
      { category: 'エース預金', amount: -50000, date: '2026-07-25', useYM: '2026-07' },
      { category: 'エース預金（引出）', amount: 10000, date: '2026-08-01', useYM: '2026-08' },
      { category: 'デイトレ貯金', amount: -20000, date: '2026-05-01', useYM: '2026-05' }, // 開始月より前 → 除外
      { category: 'エース預金', amount: -40000, date: '2099-01-25', useYM: '2099-01' },   // 来月以降 → 除外
      { category: '食費', amount: -3000, date: '2026-11-01', useYM: '2026-11' }
    ];
    f = P({ action: 'fund' });
    check('A7 actualBalance=0 → 明細から算出 300,000+50,000−10,000=340,000', f.fund.balance === 340000 && f.fund.defenseFund === 340000 && f.source === 'log', f);
    const okFund = f.fund;
    // 失敗時: 前回値を返す
    for (const mode of ['http500', 'throw', 'html']) {
      hh.mode = mode;
      f = P({ action: 'fund' });
      check('A7 取得失敗（' + mode + '）→ error＋前回値（' + okFund.fetchedAt + '）', f.status === 'error' && f.fund.balance === 340000 && f.fund.fetchedAt === okFund.fetchedAt && !!f.reason, f);
    }
    hh.mode = 'ok'; hh.pin = 'other';
    f = P({ action: 'fund' });
    check('A7 家計簿の PIN 違い → error「家計簿の PIN が違います」', f.status === 'error' && /家計簿の PIN/.test(f.reason), f);
    check('A7 失敗してもキャッシュは前回値のまま', P({ action: 'loadAll' }).fund.balance === 340000);
    hh.pin = PIN;
    // 目標額の変更（キャッシュ値は消さない）
    const tg = P({ action: 'save', baseRev: rev, tables: { fund: { target: 1500000 } } });
    rev = tg.rev;
    check('A7 目標額の保存（取得キャッシュは保持）', tg.status === 'saved' && tg.tables.fund.target === 1500000 && tg.tables.fund.balance === 340000, tg);
    f = P({ action: 'fund' });
    check('A7 取得後も目標額は保持', f.fund.target === 1500000, f.fund);
    check('A7 目標額 0 → error', P({ action: 'save', baseRev: rev, tables: { fund: { target: 0 } } }).status === 'error');
  }

  // ---- A8. PIN 変更 ----
  {
    const bad = P({ action: 'changePin', newPin: 'ab' });
    check('A8 3文字の新PINは拒否', bad.status === 'error', bad);
    const bad2 = P({ action: 'changePin', newPin: 'あいうえお' });
    check('A8 全角の新PINは拒否', bad2.status === 'error', bad2);
    const r = P({ action: 'changePin', newPin: 'New!Pin_99' });
    check('A8 PIN 変更 → saved', r.status === 'saved', r);
    check('A8 旧PINは拒否・新PINで通る', env.doPost({ action: 'auth', pin: PIN }).status === 'unauthorized' && env.doPost({ action: 'auth', pin: 'New!Pin_99' }).status === 'ok');
    check('A8 家計簿 PIN は変更前の値を HOUSEHOLD_PIN に引き継ぐ', env.props.HOUSEHOLD_PIN === PIN);
    const f = env.doPost({ action: 'fund', pin: 'New!Pin_99' });
    check('A8 PIN 変更後も家計簿連携は動く', f.status === 'ok', f);
    check('A8 応答に家計簿 PIN を含めない', !JSON.stringify(f).includes(PIN) && !JSON.stringify(env.doPost({ action: 'loadAll', pin: 'New!Pin_99' })).includes(PIN));
  }
}

// =====================================================================
// Part B: ブラウザ通しテスト
// =====================================================================
async function partB() {
  const { chromium } = require('playwright');
  const hh = { mode: 'ok', pin: PIN, calls: [], config: [{ key: 'actualBalance', value: 640000 }], logs: [] };
  const env = makeEnv({ gasPath: GAS_PATH, props: { SECRET_PIN: PIN }, fetch: hhMock(hh) });
  env.setup();
  const GAS = 'https://script.google.com/macros/s/KIROKU_TEST/exec';
  const html = fs.readFileSync(HTML_PATH, 'utf8').replace('https://script.google.com/macros/s/XXXXXXXX/exec', GAS);
  const icon = fs.readFileSync(path.join(ROOT, 'icon-180.png'));
  const net = { delay: 0, failNext: 0, log: [] };

  const browser = await chromium.launch();
  const context = await browser.newContext({ timezoneId: 'Asia/Tokyo', viewport: { width: 390, height: 844 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await context.route('http://app.test/**', r => {
    if (r.request().url().endsWith('icon-180.png')) return r.fulfill({ body: icon, contentType: 'image/png' });
    return r.fulfill({ body: html, contentType: 'text/html; charset=utf-8' });
  });
  await context.route(GAS, async r => {
    const body = r.request().postData() || '';
    let action = ''; try { action = JSON.parse(body).action; } catch (e) {}
    net.log.push(action);
    if (net.failNext > 0) { net.failNext--; return r.abort('internetdisconnected'); }
    if (net.delay) await new Promise(res => setTimeout(res, net.delay));
    const out = env.doPostRaw(body);
    return r.fulfill({ body: out, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const txt = async sel => (await page.textContent(sel) || '').trim();
  const waitIdle = () => page.waitForFunction(() => !document.getElementById('busy').classList.contains('show'));
  const toastText = () => page.textContent('#toast');
  const T = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 今日（JST）

  try {
    // ---- B1. ログイン ----
    await page.goto('http://app.test/index.html');
    check('B1 起動時はロック画面（type=password）', await page.isVisible('#lock') && await page.getAttribute('#lockPin', 'type') === 'password');
    await page.fill('#lockPin', 'abc');
    await page.click('#lockBtn');
    check('B1 3文字はクライアントで弾く', /4〜64文字/.test(await txt('#lockErr')));
    await page.fill('#lockPin', 'wrongpass');
    await page.click('#lockBtn'); await waitIdle();
    check('B1 違うパスワード → エラー表示', /パスワードが違います/.test(await txt('#lockErr')), await txt('#lockErr'));
    await page.fill('#lockPin', PIN);
    await page.check('#lockRemember');
    await page.click('#lockBtn');
    await page.waitForSelector('#lock', { state: 'hidden' }); await waitIdle();
    check('B1 正しいパスワードでログイン → ホーム', await page.isVisible('#view-home'));

    // ---- B2. コンディション ----
    check('B2 未入力の日は「今日のコンディション 未チェック」', /今日のコンディション 未チェック/.test(await txt('#condJudge')));
    await page.check('[data-cond=sleepOk]'); await page.check('[data-cond=noFatigue]'); await page.check('[data-cond=calm]');
    await page.click('#condSave'); await waitIdle();
    check('B2 全ON で保存 → 参戦可', /参戦可/.test(await txt('#condJudge')));
    check('B2 保存後はチェック欄が保存済みの値のまま（全ON）', await page.isChecked('[data-cond=sleepOk]') && await page.isChecked('[data-cond=noFatigue]') && await page.isChecked('[data-cond=calm]'));
    check('B2 成功トースト', /コンディションを保存しました/.test(await toastText()));
    await page.uncheck('[data-cond=noFatigue]');
    await page.click('#condSave'); await waitIdle();
    check('B2 1つOFF で上書き → 今日は監視のみ', /今日は監視のみ/.test(await txt('#condJudge')));
    let rows = env.sheetRows('conditions');
    check('B2 当日分は1件のまま上書き（upsert）', rows.length === 2 && rows[1][0] === T && rows[1][4] === 'watch', rows);

    // ---- B3. 練習 CRUD ----
    await page.click('nav button[data-tab=practice]');
    await page.click('#practiceAdd');
    check('B3 日付の初期値＝今日', await page.inputValue('#pDate') === T);
    await page.click('#pSave');
    check('B3 銘柄なし → 保存しない（必須）', /銘柄/.test(await txt('#formErr')) && net.log.filter(a => a === 'save').length === 2);
    await page.fill('#pSymbol', '7203 トヨタ');
    await page.click('#pSave');
    check('B3 気づきなし → 保存しない（必須）', /気づき/.test(await txt('#formErr')));
    await page.fill('#pJump', '2026-11-10');
    await page.click('[data-chips=pCandle] label:has-text("長い上ヒゲ")');
    await page.click('[data-chips=pAfter] label:has-text("下げ")');
    await page.fill('#pNote', '出来高急増の翌日に上ヒゲ');
    await page.click('#pSave'); await waitIdle();
    check('B3 練習を追加 → シートを閉じて一覧に出る', !(await page.isVisible('#sheet.show')) && /7203 トヨタ/.test(await txt('#practiceList')));
    await page.click('#practiceAdd');
    await page.fill('#pSymbol', '6758'); await page.fill('#pNote', '分からない');
    await page.click('#pSave'); await waitIdle();
    await page.click('#practiceList .list-item:has-text("7203")');
    await page.fill('#pNote', '上ヒゲの翌日は下げ');
    await page.click('#pSave'); await waitIdle();
    check('B3 練習を編集', /上ヒゲの翌日は下げ/.test(await txt('#practiceList')));
    await page.click('#practiceList .list-item:has-text("6758")');
    await page.click('#pDel'); await waitIdle();
    check('B3 練習を削除', !/6758/.test(await txt('#practiceList')) && env.sheetRows('practice').length === 2);
    const pRow = env.sheetRows('practice')[1];
    check('B3 シートの列（id,日付,レンズ,銘柄,跳ねた日,足の形,その後3日,気づき,作成日時）', env.sheetRows('practice')[0].join(',') === 'id,date,lens,symbol,jumpDate,candle,after3d,note,createdAt' &&
      pRow[2] === 'volume' && pRow[4] === '2026-11-10' && pRow[5] === '長い上ヒゲ' && pRow[6] === '下げ' && !!pRow[8], pRow);

    // ---- B4. 検証 CRUD＋集計 ----
    await page.click('nav button[data-tab=trades]');
    await page.click('#tradeAdd');
    check('B4 フォームに当日のコンディション判定（watch）を表示', /監視のみ（watch）/.test(await txt('#tCond')), await txt('#tCond'));
    check('B4 チェック未完了の警告（保存は可能）', /チェックが揃っていません/.test(await txt('#preWarn')));
    const addTrade = async (sym, result, e, tp, sl, pnl) => {
      if (!(await page.isVisible('#sheet.show'))) await page.click('#tradeAdd');
      await page.fill('#tSymbol', sym);
      if (e !== '') { await page.fill('#tEntry', e); await page.fill('#tTp', tp); await page.fill('#tSl', sl); }
      await page.click('[data-chips=tResult] label:has-text("' + result + '")');
      if (pnl) await page.fill('#tPnl', pnl);
      await page.click('#tSave'); await waitIdle();
    };
    await page.fill('#tEntry', '1000'); await page.fill('#tTp', '1300'); await page.fill('#tSl', '900');
    check('B4 入力中に RR をプレビュー（1:3.00）', /1:3\.00/.test(await txt('#rrPreview')), await txt('#rrPreview'));
    await page.screenshot({ path: path.join(__dirname, 'shot-trade-form.png') });
    await page.fill('#tSymbol', 'A');
    await page.click('#tSave');
    check('B4 結果なし → 保存しない', /結果/.test(await txt('#formErr')));
    await page.click('[data-chips=tBasis] label:has-text("出来高急増")');
    await page.fill('#tEnWhat', 'I bought at the pullback.');
    await addTrade('A', '勝ち', '1000', '1300', '900', '15000');   // RR 3
    await addTrade('B', '負け', '1000', '1100', '900', '-5000');   // RR 1
    await addTrade('C', '見送り', '', '', '', '');                 // RR 空欄
    await addTrade('D', '勝ち', '500', '520', '510', '');          // RR 2
    await addTrade('E', '見送り', '800', '', '', '');              // 価格が揃わない → RR 空欄
    const s = await txt('#tradeSummary');
    // 件数5（見送り2含む）、勝率 2/(2+1)=66.7%、平均RR (3+1+2)/3=2.00
    check('B4 件数は見送り込み 5件', /5件/.test(s), s);
    check('B4 勝率 = 2÷(2+1) = 66.7%（見送りは分母に入れない）', /勝率 66\.7%/.test(s), s);
    check('B4 平均RR = (3+1+2)÷3 = 2.00（価格未入力は除外）', /平均RR 2\.00/.test(s), s);
    const tr = env.sheetRows('trades');
    check('B4 trades の列（英語3行は3列）', tr[0].join(',') === 'id,date,symbol,basis,entryPrice,takeProfit,stopLoss,rr,result,pnl,memo,enWhat,enWhy,enNext,createdAt', tr[0]);
    const A = tr.find(r => r[2] === 'A');
    check('B4 RR を保存時に計算して持つ・英語What/根拠/損益を保存', A[7] === '3' && A[8] === 'win' && A[9] === '15000' && A[11] === 'I bought at the pullback.' && A[3] === '出来高急増', A);
    // 編集: B を勝ちに
    await page.click('#tradeList .list-item:has-text("負け")');
    await page.click('[data-chips=tResult] label:has-text("勝ち")');
    await page.click('#tSave'); await waitIdle();
    check('B4 検証を編集 → 勝率 3÷3 = 100.0%', /勝率 100\.0%/.test(await txt('#tradeSummary')), await txt('#tradeSummary'));
    await page.click('#tradeList .list-item:has-text("E")');
    await page.click('#tDel'); await waitIdle();
    check('B4 検証を削除 → 4件', /4件/.test(await txt('#tradeSummary')) && env.sheetRows('trades').length === 5);

    // ---- B5. ホームの進捗 ----
    await page.click('nav button[data-tab=home]'); await waitIdle();
    check('B5 練習 1/10（2件追加・1件削除）・検証 4/100', (await txt('#pgPractice')) === '1/10' && (await txt('#pgTrades')) === '4/100', [await txt('#pgPractice'), await txt('#pgTrades')]);
    check('B5 Phase 0 ゲート表示（勝率・RR 達成、100回は未達）', /⬜ 検証100回/.test(await txt('#pgGate')) && /✅ 勝率60%以上/.test(await txt('#pgGate')) && /✅ 平均RR 2.0以上/.test(await txt('#pgGate')), await txt('#pgGate'));

    // ---- B6. マイルストーン ----
    await page.click('nav button[data-tab=settings]');
    await page.click('#msAdd');
    await page.fill('#mPeriod', '2027年3月'); await page.fill('#mContent', 'テスト目標'); await page.fill('#mAmount', '700,000');
    await page.click('#mSave'); await waitIdle();
    check('B6 マイルストーン追加（末尾）', /テスト目標/.test(await txt('#msEditList')) && env.sheetRows('milestones').length === 6);
    await page.click('#msEditList .ms-edit:has-text("テスト目標") [data-msup]'); await waitIdle();
    const order = await page.$$eval('#msEditList .ms-edit', els => els.map(e => e.textContent));
    check('B6 並び替え（↑で1つ上へ）', /テスト目標/.test(order[3]) && /2028年1月/.test(order[4]), order);
    await page.check('#msEditList .ms-edit:has-text("2026年12月") [data-msdone]'); await waitIdle();
    await page.click('#msEditList .ms-edit:has-text("テスト目標") [data-msedit]');
    await page.fill('#mContent', 'テスト目標（改）');
    await page.click('#mSave'); await waitIdle();
    check('B6 マイルストーン編集', /テスト目標（改）/.test(await txt('#msEditList')));
    await page.click('#msEditList .ms-edit:has-text("テスト目標") [data-msedit]');
    await page.click('#mDel'); await waitIdle();
    check('B6 マイルストーン削除', !/テスト目標/.test(await txt('#msEditList')) && env.sheetRows('milestones').length === 5);

    // ---- B7. リロード後の再表示（記憶したパスワードで自動ログイン） ----
    await page.reload(); await page.waitForFunction(() => document.querySelector('#syncBadge').textContent.includes('同期済み')); await waitIdle();
    check('B7 リロード後: コンディション（監視のみ）', /今日は監視のみ/.test(await txt('#condJudge')));
    check('B7 リロード後: チェック欄が保存済みの値（睡眠○・脳疲労×・感情○）', await page.isChecked('[data-cond=sleepOk]') && !(await page.isChecked('[data-cond=noFatigue]')) && await page.isChecked('[data-cond=calm]') && await page.isDisabled('#condSave'));
    check('B7 リロード後: 進捗 1/10・4/100', (await txt('#pgPractice')) === '1/10' && (await txt('#pgTrades')) === '4/100');
    check('B7 リロード後: マイルストーン達成フラグ（2026年12月 ✅）', /✅2026年12月/.test((await txt('#msList')).replace(/\s/g, '')), await txt('#msList'));
    await page.click('nav button[data-tab=practice]');
    check('B7 リロード後: 練習一覧', /上ヒゲの翌日は下げ/.test(await txt('#practiceList')));
    await page.click('nav button[data-tab=trades]');
    check('B7 リロード後: 検証一覧・集計', /4件/.test(await txt('#tradeSummary')) && /勝率 100\.0%/.test(await txt('#tradeSummary')));

    // ---- B8. 資金（家計簿 API モック） ----
    await page.click('nav button[data-tab=home]');
    check('B8 連携 OFF → 「連携が OFF です」', /連携が OFF です/.test(await txt('#fundStatus')));
    await page.click('nav button[data-tab=settings]');
    await page.fill('#setHhUrl', HH_URL);
    await page.check('#setHhOn');
    await page.click('#setHhSave'); await waitIdle();
    await page.waitForFunction(() => document.getElementById('setHhLast').textContent.match(/\d+月/));
    await page.click('nav button[data-tab=home]');
    await page.waitForSelector('#fundBalance');
    check('B8 取得 → 土台残高 ¥640,000・防衛枠 ¥640,000', (await txt('#fundBalance')) === '¥640,000' && (await txt('#fundDefense')) === '¥640,000');
    const w = await page.getAttribute('#fundBar', 'style');
    check('B8 バー = 防衛枠 ÷ 目標額 = 64.0%', /width:\s*64\.0%/.test(w), w);
    check('B8 最新取得時は「時点」の警告を出さない', !(await page.$('#fundStatus')) && /（最新）/.test(await txt('#fundTime')));
    await (await page.$('#fundCard')).screenshot({ path: path.join(__dirname, 'shot-fund.png') });
    hh.config = [{ key: 'actualBalance', value: 1250000 }];
    await page.click('#fundReload');
    await page.waitForFunction(() => (document.getElementById('fundBalance') || {}).textContent === '¥1,250,000');
    check('B8 再読込ボタン → 残高 1,250,000・防衛枠 MIN=¥1,000,000・バー 100%', (await txt('#fundDefense')) === '¥1,000,000' && /width:\s*100\.0%/.test(await page.getAttribute('#fundBar', 'style')));
    const fetchedAt = (await page.evaluate(() => state.fund.fetchedAt));
    const d = new Date(fetchedAt); const jst = new Date(d.getTime() + 9 * 3600e3);
    const asOf = (jst.getUTCMonth() + 1) + '月' + jst.getUTCDate() + '日 ' + jst.getUTCHours() + '時 時点';
    hh.mode = 'http500';
    await page.click('#fundReload');
    await page.waitForSelector('#fundStatus');
    const st = await txt('#fundStatus');
    check('B8 取得失敗 → 前回値＋「' + asOf + '」を明示', st.includes(asOf) && /取得に失敗/.test(st) && (await txt('#fundBalance')) === '¥1,250,000', st);
    await page.reload(); await page.waitForFunction(() => document.querySelector('#syncBadge').textContent.includes('同期済み')); await waitIdle();
    await page.waitForFunction(() => document.getElementById('fundReload') && !document.getElementById('fundReload').textContent.includes('取得中'));
    check('B8 リロード後に取得失敗しても前回値を「時点」付きで表示', (await txt('#fundStatus')).includes(asOf) && (await txt('#fundBalance')) === '¥1,250,000', await txt('#fundStatus'));
    await (await page.$('#fundCard')).screenshot({ path: path.join(__dirname, 'shot-fund-stale.png') });
    hh.mode = 'ok';
    // 目標額の変更 → バー
    await page.click('nav button[data-tab=settings]');
    await page.fill('#setTarget', '2,000,000');
    await page.click('#setTargetSave'); await waitIdle();
    await page.click('nav button[data-tab=home]');
    await page.click('#fundReload');
    await page.waitForFunction(() => !document.getElementById('fundStatus'));
    check('B8 目標額 200万 → バー 1,000,000÷2,000,000 = 50.0%', /width:\s*50\.0%/.test(await page.getAttribute('#fundBar', 'style')), await page.getAttribute('#fundBar', 'style'));
    await page.click('nav button[data-tab=settings]');
    await page.uncheck('#setHhOn'); await page.click('#setHhSave'); await waitIdle();
    await page.click('nav button[data-tab=home]');
    check('B8 連携を OFF に戻す → 「連携が OFF です」', /連携が OFF です/.test(await txt('#fundStatus')));

    // ---- B9. 保存中スピナー・失敗バナー・再試行 ----
    await page.click('nav button[data-tab=practice]');
    await page.click('#practiceAdd');
    await page.fill('#pSymbol', '9984'); await page.fill('#pNote', 'スピナー確認');
    net.delay = 800;
    await page.click('#pSave');
    await page.waitForTimeout(250);
    check('B9 保存中はスピナー表示', await page.isVisible('#busy.show'));
    await waitIdle(); net.delay = 0;
    net.failNext = 1;
    await page.click('#practiceAdd');
    await page.fill('#pSymbol', '4063'); await page.fill('#pNote', '通信失敗テスト');
    await page.click('#pSave'); await waitIdle();
    check('B9 通信失敗 → 消えない赤バナー＋理由＋再試行', await page.isVisible('#failBanner.show') && /練習の保存に失敗しました/.test(await txt('#failBody')) && /通信できませんでした/.test(await txt('#failBody')) && !!(await page.$('#failBody [data-fb]')));
    check('B9 失敗時はフォームが残る（入力保持）', await page.isVisible('#sheet.show') && (await page.inputValue('#pNote')) === '通信失敗テスト');
    await page.waitForTimeout(3000);
    check('B9 バナーは時間で消えない', await page.isVisible('#failBanner.show'));
    await page.click('#failBody [data-fb="0"]'); await waitIdle();
    check('B9 再試行 → 保存成功・バナーが消える・フォームが閉じる', !(await page.isVisible('#failBanner.show')) && !(await page.isVisible('#sheet.show')) && env.sheetRows('practice').some(r => r[3] === '4063'));

    // ---- B10. baseRev 不一致 → conflict（上書きしない） ----
    const cur = env.doPost({ action: 'loadAll', pin: PIN });
    env.doPost({ action: 'save', pin: PIN, baseRev: cur.rev, tables: { practice: cur.practice.concat([{ id: 'other', date: T, lens: 'volume', symbol: '別端末', note: '別端末の記録' }]) } });
    await page.click('#practiceAdd');
    await page.fill('#pSymbol', '8306'); await page.fill('#pNote', '競合テスト');
    await page.click('#pSave'); await waitIdle();
    const pr = env.sheetRows('practice');
    check('B10 他端末の更新後に保存 → conflict の赤バナー', await page.isVisible('#failBanner.show') && /他の端末で更新/.test(await txt('#failBody')), await txt('#failBody'));
    check('B10 conflict では上書きされない（別端末の記録が残り、8306 は未保存）', pr.some(r => r[3] === '別端末') && !pr.some(r => r[3] === '8306'));
    await page.click('#failBody [data-fb="0"]'); // 再読込してもう一度保存
    await page.waitForFunction(() => !document.getElementById('sheet').classList.contains('show') || document.getElementById('failBanner').classList.contains('show'));
    await waitIdle();
    const pr2 = env.sheetRows('practice');
    check('B10 「再読込してもう一度保存」→ 両方残る・フォームが閉じる', pr2.some(r => r[3] === '別端末') && pr2.some(r => r[3] === '8306') && !(await page.isVisible('#sheet.show')), pr2.map(r => r[3]));
    check('B10 画面にも別端末の記録が出る', /別端末の記録/.test(await txt('#practiceList')));

    // ---- B11. CSV ----
    await page.click('nav button[data-tab=settings]');
    await page.screenshot({ path: path.join(__dirname, 'shot-settings.png'), fullPage: true });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv=trades]')]);
    const csv = fs.readFileSync(await dl.path(), 'utf8');
    check('B11 trades CSV（BOM・日本語見出し・RR・結果）', csv.charCodeAt(0) === 0xFEFF && /^﻿id,日付,銘柄,エントリー根拠,エントリー価格,利確価格,損切り価格,RR,結果,損益,メモ,英語What,英語Why,英語Next,作成日時/.test(csv) && /,3,勝ち,15000,/.test(csv), csv.slice(0, 300));
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-csv=practice]')]);
    const csv2 = fs.readFileSync(await dl2.path(), 'utf8');
    check('B11 practice CSV', /id,日付,レンズ,銘柄,跳ねた日,足の形,その後3日,気づき,作成日時/.test(csv2) && /出来高/.test(csv2) && csv2.trim().split('\r\n').length === 6, csv2);

    // ---- B12. PIN 変更 ----
    await page.fill('#pinOld', PIN); await page.fill('#pinNew', 'Next#Pin1'); await page.fill('#pinNew2', 'Next#Pin1');
    await page.click('#pinChange'); await waitIdle();
    check('B12 PIN 変更 → 新PINで GAS が通る', env.props.SECRET_PIN === 'Next#Pin1' && /パスワードを変更しました/.test(await toastText()));
    await page.click('nav button[data-tab=home]');
    await page.click('#reloadBtn'); await waitIdle();
    check('B12 変更後も同じ画面で読み込める', (await txt('#syncBadge')).includes('同期済み'));

    // ---- B13. 画面全体 ----
    check('B13 4タブ（ホーム／練習／検証／設定）', (await page.$$eval('nav button', b => b.map(x => x.textContent.trim()))).join() === '🏠ホーム,👀練習,📝検証,⚙️設定');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    check('B13 スマホ幅で横スクロールが出ない', sw <= 390, sw);
    await page.screenshot({ path: path.join(__dirname, 'shot-home.png'), fullPage: true });
    check('B13 JS エラーなし', errors.length === 0, errors);
  } finally {
    await browser.close();
  }
}

(async () => {
  partA();
  try { await partB(); } catch (e) { fail++; results.push('FAIL Part B 例外: ' + (e && e.stack || e)); }
  console.log(results.join('\n'));
  console.log('\n合計: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
