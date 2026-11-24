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

function render() {
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
  TABS.forEach(t => { const p = $('#page-' + t.id); if (p) p.classList.toggle('active', S.tab === t.id); });
  const page = $('#page-' + S.tab);
  if (!page) return;
  try {
    if (S.tab === 'home') { page.innerHTML = renderHome(); return; }
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

async function init() {
  loadCache();
  Object.values(S.trips).forEach(t => syncBookingItems(t));
  pickDefaultTrip();
  render();
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
