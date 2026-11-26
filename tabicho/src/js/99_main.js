// ============================================================================
// 99 描画・タブ切替・イベント委譲・起動
// ============================================================================
const TABS = [
  { id: 'home', icon: '🏠', label: 'ホーム' },
  { id: 'shiori', icon: '📒', label: 'しおり' },
  { id: 'drive', icon: '🚗', label: 'ドライブ' },
  { id: 'money', icon: '💴', label: 'お金' },
  { id: 'record', icon: '📷', label: '記録' }
];

function switchTab(id) {
  S.tab = id;
  if (id === 'shiori') loadSpots(false);
  window.scrollTo(0, 0);
  render();
}
ACT.tab = (el) => switchTab(el.dataset.tab);

// 画面上部の帯：デモモードは全画面で明示。GAS から開かれていない本番は赤で知らせる
function renderModeBanner() {
  const el = document.getElementById('modeBanner');
  if (!el) return;
  if (IS_GAS) { el.innerHTML = ''; return; }
  el.innerHTML = IS_DEMO
    ? '<div class="mode-banner demo">🧪 デモモード（GAS 未接続）：データはこのブラウザにだけ保存されます。本番の旅帳ではありません</div>'
    : '<div class="mode-banner bad">⚠️ GAS の接続部品が読み込めていません。旅帳は GAS のウェブアプリ URL から開いてください（デモへの切り替えはしません）</div>';
}
function render() {
  renderDeferred = false;
  try { renderInner(); }
  catch (e) {
    console.error(e);
    if (window.__TB && !window.__TB.started) window.__TB.fail('画面の描画', e);
    else toast('表示中にエラー：' + e.message);
  }
}
// v2.0.3：天気・経路・営業時間・現在地など「後から届く」情報での描き直し。
// 文字を入力中に画面を作り直すと、入力途中の文字やカーソルが消えるので、入力欄から離れるまで待つ
let renderDeferred = false;
function softRender() {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && !(a.type === 'checkbox' || a.type === 'radio' || a.type === 'button')) {
    renderDeferred = true;
    return false;
  }
  render();
  return true;
}
document.addEventListener('focusout', () => {
  if (!renderDeferred) return;
  setTimeout(() => {   // 次の入力欄へ移っただけなら、まだ待つ
    if (!renderDeferred) return;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    renderDeferred = false; render();
  }, 300);
});
function renderInner() {
  renderModeBanner();
  const trip = curTrip();
  // ヘッダー
  const ht = $('#headTrip');
  if (ht) ht.innerHTML = trip ? `<span class="ht-emoji">${esc(tripEmoji(trip))}</span><span class="ht-title">${esc(trip.title)}</span>${statusBadge(tripStatus(trip))}` : '<span class="ht-title">旅帳</span>';
  // ナビ
  const nav = $('#nav');
  if (nav) {
    const ddrive = trip ? (hasVehicle(trip, 'car') ? '🚗' : (VEHICLES[trip.vehicles[0]] || VEHICLES.car).icon) : '🚗';
    nav.innerHTML = TABS.map(t => `<button class="nav-item ${S.tab === t.id ? 'active' : ''}" data-act="tab" data-tab="${t.id}"><span class="icon">${t.id === 'drive' ? ddrive : t.icon}</span><span>${t.id === 'drive' && trip && !hasVehicle(trip, 'car') ? '移動' : t.label}</span></button>`).join('');
  }
  TABS.concat([{ id: 'collection' }]).forEach(t => { const p = $('#page-' + t.id); if (p) p.classList.toggle('active', S.tab === t.id); });
  const page = $('#page-' + S.tab);
  if (!page) return;
  try {
    if (S.tab === 'home') { page.innerHTML = renderHome(); setTimeout(() => loadThumbs(page), 0); return; }
    if (S.tab === 'collection') { page.innerHTML = renderCollection(); return; }
    if (!trip) {
      if (S.tab === 'shiori') { $('#shioriTop').innerHTML = ''; $('#shioriMapWrap').style.display = 'none'; $('#shioriBody').innerHTML = noTripHTML(); }
      else page.innerHTML = noTripHTML();
      return;
    }
    if (S.tab === 'shiori') renderShiori(trip);
    else if (S.tab === 'drive') page.innerHTML = renderDrive(trip);
    else if (S.tab === 'money') page.innerHTML = renderMoney(trip);
    else if (S.tab === 'record') page.innerHTML = renderRecord(trip);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="warn-box">表示中にエラーが起きました：${esc(e.message)}</div>`;
  }
}
function noTripHTML() { return emptyHTML('🧳', '旅が選ばれていません', '<button class="btn primary mt" data-act="tripNew">＋ 新しい旅</button>'); }

// ---- イベント委譲 ----
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !el.dataset.act) return;
  const f = ACT[el.dataset.act];
  if (!f) return;
  if (el.tagName === 'A') return;
  if (el.disabled) return;
  e.preventDefault();
  try { const r = f(el, e); if (r && r.catch) r.catch(err => { console.error(err); toast('エラー：' + err.message); }); }
  catch (err) { console.error(err); toast('エラー：' + err.message); }
});
document.addEventListener('input', (e) => { const el = e.target; const f = el.dataset && ON_INPUT[el.dataset.input]; if (f) f(el, e); });
document.addEventListener('change', (e) => {
  const el = e.target; const f = el.dataset && ON_CHANGE[el.dataset.change];
  if (f) { try { const r = f(el, e); if (r && r.catch) r.catch(err => toast('エラー：' + err.message)); } catch (err) { console.error(err); toast('エラー：' + err.message); } }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalStack.length) closeModal(); });

function isTyping() { const a = document.activeElement; return a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && !modalStack.length; }
// ホーム・ドライブは時刻で表示が変わるので定期的に描き直す
setInterval(() => { if (!modalStack.length && !isTyping() && (S.tab === 'home' || S.tab === 'drive')) render(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { loadSpots(true); if (!modalStack.length && !isTyping()) render(); }
});

// 画面テスト用の入口（デモモードの時だけ。本番の GAS では出さない）
if (IS_DEMO) window.__TABICHO_T = { softRender, saveCache, loadImg, imageExportSafe, thumbIdb, tripTz, tripToday, curTrip, S };
// 起動の各段階を個別に守る（どこかで失敗しても画面は出し、原因を起動ガードに残す）
function bootStep(name, fn) {
  try { return fn(); }
  catch (e) { console.error(name, e); if (window.__TB) window.__TB.errors.push(name + '：' + (e && e.message || e)); return undefined; }
}
async function init() {
  bootStep('端末データの読み込み', loadCache);
  bootStep('送信キューの読み込み', mqLoad);
  bootStep('予約と工程の同期', () => Object.values(S.trips).forEach(t => syncBookingItems(t)));
  bootStep('表示する旅の選択', pickDefaultTrip);
  render();
  if (window.__TB) {
    window.__TB.started = true;
    if (window.__TB.errors.length) window.__TB.show('旅帳は起動しましたが、起動中に問題がありました');
  }
  startGeo();
  ensureFx();
  await bootstrapFromServer();
  Object.values(S.trips).forEach(t => { if (syncBookingItems(t)) commitTrip(t, { silent: true }); });
  pickDefaultTrip();
  render();
  await loadSpots(true);
  retryVisitWrites();
}
document.addEventListener('DOMContentLoaded', init);
