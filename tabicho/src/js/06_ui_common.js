// ============================================================================
// 06 共通UI：モーダル・トースト・金額入力（割り勘・電卓）・スポット選択・訪問記録
// ============================================================================
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const ACT = {};          // data-act="name" のクリック処理
const ON_INPUT = {};     // data-input="name" の入力処理
const ON_CHANGE = {};    // data-change="name" の変更処理

const modalStack = [];
function openModal(html, opt) {
  opt = opt || {};
  const root = document.getElementById('modalRoot');
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap' + (opt.full ? ' full' : '');
  wrap.innerHTML = `<div class="modal-back"></div><div class="modal ${opt.cls || ''}">
    <div class="modal-head"><div class="modal-title">${opt.title || ''}</div><button class="icon-btn" data-act="closeModal" aria-label="閉じる">✕</button></div>
    <div class="modal-body">${html}</div></div>`;
  root.appendChild(wrap);
  const entry = { el: wrap, onClose: opt.onClose, data: opt.data || {} };
  modalStack.push(entry);
  wrap.querySelector('.modal-back').addEventListener('click', () => { if (!opt.sticky) closeModal(); });
  document.body.classList.add('modal-open');
  if (opt.onMount) opt.onMount(wrap.querySelector('.modal-body'), entry);
  return entry;
}
function closeModal(result) {
  const m = modalStack.pop();
  if (!m) return;
  m.el.remove();
  if (!modalStack.length) document.body.classList.remove('modal-open');
  if (m.onClose) m.onClose(result);
}
function topModal() { return modalStack[modalStack.length - 1]; }
function topModalBody() { const m = topModal(); return m ? m.el.querySelector('.modal-body') : null; }
ACT.closeModal = () => closeModal();

let toastTimer;
function toast(msg, opt) {
  opt = opt || {};
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = `<span>${esc(msg)}</span>` + (opt.action ? `<button class="toast-btn" id="toastAct">${esc(opt.action)}</button>` : '');
  el.classList.add('show');
  if (opt.action) document.getElementById('toastAct').onclick = () => { el.classList.remove('show'); opt.onAction && opt.onAction(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opt.ms || (opt.action ? 6000 : 2600));
}
function confirmDialog(msg) { return Promise.resolve(window.confirm(msg)); }

function segHTML(name, options, value, act) {
  return `<div class="seg">${options.map(o => {
    const v = typeof o === 'string' ? o : o.v, l = typeof o === 'string' ? o : o.l;
    return `<button class="seg-btn ${v === value ? 'on' : ''}" data-act="${act}" data-v="${esc(v)}" data-name="${esc(name)}">${l}</button>`;
  }).join('')}</div>`;
}
function stars(n, act, attrs) {
  return `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<button class="star ${i <= n ? 'on' : ''}" ${act ? `data-act="${act}" data-v="${i}" ${attrs || ''}` : 'disabled'}>★</button>`).join('')}</span>`;
}
function emptyHTML(icon, text, btn) {
  return `<div class="empty"><div class="empty-icon">${icon}</div><div>${text}</div>${btn || ''}</div>`;
}
function statusBadge(st) { return `<span class="badge ${STATUS_STYLE[st] || ''}">${st}</span>`; }
function warnBadges(warns) {
  return warns.map(w => `<span class="wbadge ${w.lv}">${w.lv === 'err' ? '⛔' : w.lv === 'warn' ? '⚠️' : 'ℹ️'} ${esc(w.t)}</span>`).join('');
}

// ---------------------------------------------------------------------------
// 金額入力の共通部品（予約・支出・給油など金額入力のある全箇所で使う）
// ---------------------------------------------------------------------------
function amountModePref() { try { return localStorage.getItem('tabicho_amount_mode') || 'kbd'; } catch (e) { return 'kbd'; } }
function setAmountModePref(v) { try { localStorage.setItem('tabicho_amount_mode', v); } catch (e) {} }

function moneyEditorHTML(trip, m, opt) {
  opt = opt || {};
  m = Object.assign(newMoney(trip), m || {});
  const mode = amountModePref();
  const foreign = m.currency !== trip.currency;
  const card = isCardMethod(m.method);
  return `<div class="money-ed" data-trip="${trip.id}">
    <div class="amount-row">
      <select class="cur-sel" data-mf="currency" data-change="moneyCur">${currencyOptions(m.currency)}</select>
      <input class="amount-in ${mode === 'calc' ? 'calc' : ''}" data-mf="amount" data-mode="${mode}" ${mode === 'calc' ? 'readonly' : ''}
        inputmode="decimal" placeholder="0" value="${m.amount != null ? esc(m.amount) : ''}" data-input="moneyPreview" data-act="${mode === 'calc' ? 'openCalc' : ''}">
      <button class="mode-btn" data-act="toggleAmountMode" title="入力方式の切替">${mode === 'calc' ? '⌨️' : '🧮'}</button>
    </div>
    <div class="sub-actions"><span class="muted small">${mode === 'calc' ? '電卓モード（タップで電卓）' : 'キーボード入力'}</span>
      <button class="link-btn" data-act="openFxCalcForField">💱 為替計算機</button></div>
    <div class="rate-row" style="${foreign ? '' : 'display:none'}">
      <label>レート 1${esc(m.currency)}＝</label><input data-mf="rate" inputmode="decimal" value="${esc(m.rate)}" data-input="moneyRateManual" class="rate-in">
      <span>${esc(trip.currency)}</span><button class="link-btn" data-act="moneyAutoRate">自動</button>
      <input type="hidden" data-mf="rateAuto" value="${m.rateAuto ? '1' : ''}">
    </div>
    <div class="form-grid">
      <label>払った人</label>
      <select data-mf="payer" data-change="moneyPreview">${trip.members.map(x => `<option value="${x.id}" ${x.id === m.payer ? 'selected' : ''}>${esc(x.name)}${x.isMe ? '（自分）' : ''}</option>`).join('')}</select>
      <label>支払方法</label>
      <select data-mf="method" data-change="moneyMethod">${(S.settings.payMethods || []).map(p => `<option value="${p.id}" ${p.id === m.method ? 'selected' : ''}>${esc(p.name)}${p.isCard ? '（カード）' : ''}</option>`).join('')}</select>
      ${opt.noPayState ? '' : `<label>支払状態</label>
      <select data-mf="payState">${['支払済', '現地で払う予定'].map(v => `<option ${v === m.payState ? 'selected' : ''}>${v}</option>`).join('')}</select>`}
    </div>
    <div class="card-jpy" style="${card && m.currency !== 'JPY' ? '' : 'display:none'}">
      <label>カード明細の円額（引落額）</label><input data-mf="cardJpy" inputmode="numeric" placeholder="明細が出たら入力" value="${m.cardJpy != null ? esc(m.cardJpy) : ''}">
    </div>
    <div class="split-box">
      <div class="split-head"><span>誰と割り勘するか</span>
        <label class="solo"><input type="checkbox" data-mf="solo" ${m.solo ? 'checked' : ''} data-change="moneySolo"> 1人で払う（割り勘しない）</label></div>
      <div class="chips split-chips ${m.solo ? 'disabled' : ''}">${trip.members.map(x => `<label class="chip"><input type="checkbox" data-split="${x.id}" ${(m.split || []).includes(x.id) ? 'checked' : ''} ${m.solo ? 'disabled' : ''} data-change="moneyPreview"><span>${esc(x.name)}</span></label>`).join('')}</div>
      <div class="per-person" data-mf-preview></div>
    </div>
  </div>`;
}
function readMoneyEditor(root) {
  const ed = root.classList && root.classList.contains('money-ed') ? root : $('.money-ed', root);
  if (!ed) return null;
  const g = k => { const el = $(`[data-mf="${k}"]`, ed); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; };
  const amtStr = g('amount');
  return {
    amount: amtStr === '' || amtStr == null ? null : num(amtStr, null),
    currency: g('currency'), rate: num(g('rate'), 1), rateAuto: !!g('rateAuto'),
    payer: g('payer'), method: g('method'), payState: g('payState') || '支払済',
    cardJpy: g('cardJpy') === '' || g('cardJpy') == null ? null : num(g('cardJpy'), null),
    solo: !!g('solo'),
    split: $$('[data-split]', ed).filter(x => x.checked).map(x => x.dataset.split)
  };
}
function updateMoneyPreview(ed) {
  const trip = S.trips[ed.dataset.trip];
  if (!trip) return;
  const m = readMoneyEditor(ed);
  const pv = $('[data-mf-preview]', ed);
  const p = perPersonPreview(trip, m);
  if (!p) { pv.innerHTML = '<span class="muted">金額を入れると1人あたりが表示されます</span>'; return; }
  if (p.solo) { pv.innerHTML = `<b>割り勘しない</b>：${esc(memberName(trip, m.payer))}が全額 ${fmtMoney(num(m.amount), p.cur)} を負担`; return; }
  let s = `1人あたり <b class="big">${fmtMoney(p.each, p.cur)}</b>（${p.n}人）`;
  if (p.rem) s += `<br><span class="muted small">端数 ${fmtMoney(p.rem, p.cur)} は払った人（${esc(memberName(trip, m.payer))}）が負担</span>`;
  if (m.currency !== trip.currency) s += `<br><span class="muted small">≈ ${fmtMoney(p.each * num(m.rate, 1), trip.currency)}／人（精算通貨）</span>`;
  pv.innerHTML = s;
}
ON_INPUT.moneyPreview = (el) => updateMoneyPreview(el.closest('.money-ed'));
ON_CHANGE.moneyPreview = ON_INPUT.moneyPreview;
ON_INPUT.moneyRateManual = (el) => { const ed = el.closest('.money-ed'); $('[data-mf="rateAuto"]', ed).value = ''; updateMoneyPreview(ed); };
ON_CHANGE.moneySolo = (el) => {
  const ed = el.closest('.money-ed');
  $('.split-chips', ed).classList.toggle('disabled', el.checked);
  $$('[data-split]', ed).forEach(x => { x.disabled = el.checked; });
  updateMoneyPreview(ed);
};
ON_CHANGE.moneyMethod = (el) => {
  const ed = el.closest('.money-ed');
  const cur = $('[data-mf="currency"]', ed).value;
  $('.card-jpy', ed).style.display = isCardMethod(el.value) && cur !== 'JPY' ? '' : 'none';
};
ON_CHANGE.moneyCur = async (el) => {
  const ed = el.closest('.money-ed');
  const trip = S.trips[ed.dataset.trip];
  const foreign = el.value !== trip.currency;
  $('.rate-row', ed).style.display = foreign ? '' : 'none';
  $('.rate-row label', ed).textContent = 'レート 1' + el.value + '＝';
  ON_CHANGE.moneyMethod($('[data-mf="method"]', ed));
  if (foreign) await fillAutoRate(ed);
  else $('[data-mf="rate"]', ed).value = 1;
  updateMoneyPreview(ed);
};
async function fillAutoRate(ed) {
  const trip = S.trips[ed.dataset.trip];
  const cur = $('[data-mf="currency"]', ed).value;
  await ensureFx();
  const a = marketToJpy(cur), b = marketToJpy(trip.currency);
  if (a && b) {
    $('[data-mf="rate"]', ed).value = Math.round(a / b * 10000) / 10000;
    $('[data-mf="rateAuto"]', ed).value = '1';
  } else toast('為替レートを取得できませんでした。手入力してください');
}
ACT.moneyAutoRate = async (el) => { const ed = el.closest('.money-ed'); await fillAutoRate(ed); updateMoneyPreview(ed); };
ACT.toggleAmountMode = (el) => {
  const ed = el.closest('.money-ed') || el.closest('.amount-field');
  const inp = $('[data-mf="amount"]', ed) || $('.amount-in', ed);
  const next = inp.dataset.mode === 'calc' ? 'kbd' : 'calc';
  inp.dataset.mode = next;
  inp.readOnly = next === 'calc';
  inp.classList.toggle('calc', next === 'calc');
  inp.dataset.act = next === 'calc' ? 'openCalc' : '';
  el.textContent = next === 'calc' ? '⌨️' : '🧮';
  const lab = $('.sub-actions .muted', ed); if (lab) lab.textContent = next === 'calc' ? '電卓モード（タップで電卓）' : 'キーボード入力';
  setAmountModePref(next);
  if (next === 'kbd') inp.focus(); else openCalculator(inp);
};
ACT.openCalc = (el) => { if (el.dataset.mode === 'calc') openCalculator(el); };

// 単独の金額欄（給油の数量など以外で、割り勘不要の金額）
function amountFieldHTML(attrs, value, placeholder) {
  const mode = amountModePref();
  return `<div class="amount-field"><input class="amount-in small ${mode === 'calc' ? 'calc' : ''}" ${attrs} data-mode="${mode}" ${mode === 'calc' ? 'readonly data-act="openCalc"' : ''} inputmode="decimal" placeholder="${esc(placeholder || '0')}" value="${value != null ? esc(value) : ''}"><button class="mode-btn" data-act="toggleAmountMode">${mode === 'calc' ? '⌨️' : '🧮'}</button></div>`;
}

// 電卓パッド
function openCalculator(input) {
  let expr = input.value ? String(input.value) : '';
  const keys = ['C', '⌫', '(', ')', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '00', '.', '+'];
  openModal(`<div class="calc">
    <div class="calc-expr" id="calcExpr"></div><div class="calc-res" id="calcRes"></div>
    <div class="calc-keys">${keys.map(k => `<button class="ck ${/[÷×−+]/.test(k) ? 'ck-op' : ''} ${k === 'C' ? 'ck-clr' : ''} ${/[()]/.test(k) ? 'ck-paren' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
    <button class="btn primary block" id="calcOk">＝ この金額にする</button></div>`, {
    title: '🧮 電卓', cls: 'calc-modal',
    onMount(body) {
      const ex = $('#calcExpr', body), rs = $('#calcRes', body);
      const upd = () => {
        ex.textContent = expr || '0';
        try { const v = evalExpr(expr); rs.textContent = '= ' + v.toLocaleString('ja-JP', { maximumFractionDigits: 4 }); rs.classList.remove('err'); }
        catch (e) { rs.textContent = '…'; rs.classList.add('err'); }
      };
      upd();
      $$('.ck', body).forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.k;
        if (k === 'C') expr = '';
        else if (k === '⌫') expr = expr.slice(0, -1);
        else expr += k;
        upd();
      }));
      $('#calcOk', body).addEventListener('click', () => {
        try {
          const v = evalExpr(expr);
          input.value = Math.round(v * 10000) / 10000;
          closeModal();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) { toast(e.message); }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// メンバー入力（名前のリスト＋プリセット）
// ---------------------------------------------------------------------------
function membersEditorHTML(members) {
  return `<div class="members-ed">
    <div class="chips" id="memChips">${members.map((m, i) => memberChipHTML(m, i)).join('')}</div>
    <div class="row gap"><input id="memNew" placeholder="名前を追加"><button class="btn" data-act="memAdd">追加</button></div>
    ${(S.settings.memberPresets || []).length ? `<div class="presets"><span class="muted small">プリセット：</span>${S.settings.memberPresets.map(p => `<button class="chip-btn" data-act="memPreset" data-id="${p.id}">${esc(p.name)}</button>`).join('')}</div>` : ''}
    <div class="muted small">「自分」に印を付けた人が家計簿連携の対象になります</div>
  </div>`;
}
function memberChipHTML(m, i) {
  return `<span class="chip mem ${m.isMe ? 'me' : ''}" data-mid="${esc(m.id || '')}" data-name="${esc(m.name)}" data-me="${m.isMe ? 1 : ''}">
    <button class="chip-x" data-act="memMe" title="自分にする">${m.isMe ? '👤' : '○'}</button>${esc(m.name)}<button class="chip-x" data-act="memDel">✕</button></span>`;
}
function readMembersEditor(root) {
  return $$('#memChips .mem', root).map(c => ({ id: c.dataset.mid || uid('m'), name: c.dataset.name, isMe: !!c.dataset.me }));
}
function setMembersEditor(root, list) {
  if (list.length && !list.some(m => m.isMe)) { const me = list.find(m => m.name === S.settings.myName); (me || list[0]).isMe = true; }
  $('#memChips', root).innerHTML = list.map(memberChipHTML).join('');
}
ACT.memAdd = (el) => {
  const root = el.closest('.members-ed'); const inp = $('#memNew', root);
  const names = inp.value.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
  if (!names.length) return;
  const list = readMembersEditor(root);
  names.forEach(n => { if (!list.some(m => m.name === n)) list.push({ id: uid('m'), name: n, isMe: n === S.settings.myName }); });
  setMembersEditor(root, list); inp.value = '';
};
ACT.memDel = (el) => { const root = el.closest('.members-ed'); el.closest('.mem').remove(); setMembersEditor(root, readMembersEditor(root)); };
ACT.memMe = (el) => {
  const root = el.closest('.members-ed'); const chip = el.closest('.mem');
  const list = readMembersEditor(root).map(m => Object.assign(m, { isMe: m.id === chip.dataset.mid && m.name === chip.dataset.name }));
  setMembersEditor(root, list);
};
ACT.memPreset = (el) => {
  const root = el.closest('.members-ed');
  const p = S.settings.memberPresets.find(x => x.id === el.dataset.id);
  if (!p) return;
  const list = readMembersEditor(root);
  p.members.forEach(n => { if (!list.some(m => m.name === n)) list.push({ id: uid('m'), name: n, isMe: n === S.settings.myName }); });
  setMembersEditor(root, list);
};

function vehicleChipsHTML(sel, name) {
  return `<div class="chips">${VEHICLE_KEYS.map(k => `<label class="chip"><input type="checkbox" name="${name}" value="${k}" ${sel.includes(k) ? 'checked' : ''}><span>${VEHICLES[k].icon} ${VEHICLES[k].label}</span></label>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// スポット選択（スポット帳から／手入力）
// ---------------------------------------------------------------------------
function openSpotPicker(trip, target) {
  // target: { date } で工程の最後に追加、未指定ならリスト（未定）へ
  const st = { q: '', filter: 'want' };
  const listHTML = () => {
    const inTrip = new Set(trip.items.map(i => i.spotId).filter(Boolean));
    let arr = Object.values(S.spots);
    if (st.filter === 'want') arr = arr.filter(s => s.status !== 'visited');
    if (st.filter === 'visited') arr = arr.filter(s => s.status === 'visited');
    if (st.q) {
      const q = st.q.toLowerCase();
      arr = arr.filter(s => [s.name, s.area, s.address, (s.tags || []).join(' ')].join(' ').toLowerCase().includes(q));
    }
    const o = trip.origin && trip.origin.lat != null ? trip.origin : null;
    arr.sort((a, b) => (b.priority === 'must') - (a.priority === 'must') || (haversineKm(o, a) || 9e9) - (haversineKm(o, b) || 9e9));
    if (S.spotsState === 'loading') return '<div class="muted pad">スポット帳を読み込み中…</div>';
    if (S.spotsState === 'error') return `<div class="warn-box">スポット帳に接続できません：${esc(S.spotsError)}<br>手入力で追加できます。</div>`;
    if (!arr.length) return '<div class="muted pad">該当するスポットがありません</div>';
    return arr.slice(0, 200).map(s => `<div class="pick-row ${inTrip.has(s.id) ? 'in' : ''}">
      <div class="grow"><div class="b">${s.priority === 'must' ? '⭐ ' : ''}${esc(s.name)}</div>
      <div class="muted small">${esc(s.area || '')} ${s.lat == null ? '<span class="tag gray">座標なし</span>' : ''} ${(s.tags || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div></div>
      ${inTrip.has(s.id) ? '<span class="muted small">追加済</span>' : `<button class="btn sm primary" data-act="pickSpot" data-id="${s.id}">追加</button>`}</div>`).join('');
  };
  openModal(`<div class="row gap"><input id="pkQ" placeholder="名前・エリア・タグで検索" class="grow"><button class="btn sm" data-act="pickReload">↻</button></div>
    ${segHTML('pf', [{ v: 'want', l: '行きたい' }, { v: 'visited', l: '行った' }, { v: 'all', l: 'すべて' }], st.filter, 'pickFilter')}
    <div id="pkList" class="pick-list">${listHTML()}</div>
    <details class="manual"><summary>✍️ 手入力で追加する</summary>${manualSpotFormHTML()}</details>`, {
    title: '📍 スポットを追加' + (target && target.date ? '（' + fmtDate(target.date) + 'の工程へ）' : '（リストへ）'), full: true,
    data: { trip, target, st, listHTML },
    onMount(body) {
      $('#pkQ', body).addEventListener('input', debounce(e => { st.q = e.target.value; $('#pkList', body).innerHTML = listHTML(); }, 200));
    }
  });
  if (S.spotsState !== 'ok') loadSpots(true).then(() => { const b = topModalBody(); if (b && $('#pkList', b)) $('#pkList', b).innerHTML = listHTML(); });
}
function manualSpotFormHTML() {
  return `<div class="form-grid">
    <label>名前</label><input id="msName" placeholder="例：〇〇食堂">
    <label>住所</label><div class="row gap"><input id="msAddr" class="grow" placeholder="住所・施設名"><button class="btn sm" data-act="msGeocode">座標検索</button></div>
    <label>座標</label><div class="row gap"><input id="msLat" placeholder="緯度" inputmode="decimal"><input id="msLng" placeholder="経度" inputmode="decimal"><button class="btn sm" data-act="msHere">現在地</button></div>
    <label>営業時間</label><input id="msHours" placeholder="例：9:00-17:00 水曜定休">
    <label>滞在目安</label><input id="msStay" inputmode="numeric" placeholder="分">
    <label>料金目安</label><input id="msPrice" inputmode="numeric" placeholder="円">
    <label>優先度</label><select id="msPri"><option value="maybe">行けたら</option><option value="must">絶対行きたい</option></select>
  </div>
  <label class="check"><input type="checkbox" id="msReg" checked> スポット帳にも登録する</label>
  <button class="btn primary block" data-act="msAdd">このスポットを追加</button>`;
}
ACT.pickFilter = (el) => {
  const m = topModal(); m.data.st.filter = el.dataset.v;
  $$('.seg-btn', el.parentNode).forEach(b => b.classList.toggle('on', b === el));
  $('#pkList', topModalBody()).innerHTML = m.data.listHTML();
};
ACT.pickReload = async (el) => { if (el) { el.disabled = true; el.innerHTML = '<span class="spin"></span>'; } await loadSpots(true); if (el) { el.disabled = false; el.textContent = '↻'; } toast(S.spotsState === 'ok' ? 'スポット帳を読み直しました' : 'スポット帳につながりません：' + S.spotsError, { ms: 5000 }); const m = topModal(); if (m && m.data.listHTML) $('#pkList', topModalBody()).innerHTML = m.data.listHTML(); };
ACT.pickSpot = (el) => {
  const m = topModal(); const { trip, target } = m.data;
  const sp = S.spots[el.dataset.id];
  if (!sp) return;
  addSpotItem(trip, { spotId: sp.id, nameCache: sp.name, priority: sp.priority || 'maybe' }, target);
  el.outerHTML = '<span class="muted small">追加しました</span>';
};
ACT.msGeocode = async () => {
  const b = topModalBody(); const q = $('#msAddr', b).value || $('#msName', b).value;
  if (!q) return toast('住所か名前を入れてください');
  try {
    const r = await api('geocode', { address: q });
    if (r.result) { $('#msLat', b).value = r.result.lat; $('#msLng', b).value = r.result.lng; if (!$('#msAddr', b).value) $('#msAddr', b).value = r.result.address || ''; toast('座標を取得しました'); }
    else toast(r.note || '見つかりませんでした');
  } catch (e) { toast('座標検索に失敗：' + e.message); }
};
ACT.msHere = () => {
  const b = topModalBody();
  if (S.geo) { $('#msLat', b).value = S.geo.lat.toFixed(6); $('#msLng', b).value = S.geo.lng.toFixed(6); }
  else toast('現在地を取得できていません');
};
ACT.msAdd = async () => {
  const b = topModalBody(); const m = topModal(); const { trip, target } = m.data;
  const name = $('#msName', b).value.trim();
  if (!name) return toast('名前を入れてください');
  const lat = $('#msLat', b).value !== '' ? num($('#msLat', b).value, null) : null;
  const lng = $('#msLng', b).value !== '' ? num($('#msLng', b).value, null) : null;
  const o = {
    name, nameCache: name, address: $('#msAddr', b).value.trim(), lat, lng, hoursText: $('#msHours', b).value.trim(),
    stayEst: $('#msStay', b).value ? num($('#msStay', b).value) : null, priceEst: $('#msPrice', b).value ? num($('#msPrice', b).value) : null,
    priority: $('#msPri', b).value
  };
  if ($('#msReg', b).checked) {
    try {
      const r = await api('spotCreate', { spot: { name, address: o.address, lat, lng, hours: o.hoursText, stayMin: o.stayEst, price: o.priceEst, priority: o.priority, status: 'want', area: trip.area || '' } });
      const sp = normalizeSpot(r.spot); S.spots[sp.id] = sp;
      o.spotId = sp.id;
      toast('スポット帳にも登録しました');
    } catch (e) { toast('スポット帳への登録に失敗（旅帳だけに追加します）：' + e.message); }
  }
  addSpotItem(trip, o, target);
  closeModal();
};

function addSpotItem(trip, o, target) {
  const it = newItem(o);
  const info = itemInfo(trip, it);
  it.stay = info.stay || 60;
  if (target && target.date) {
    it.date = target.date;
    const last = dayItems(trip, target.date).slice(-1)[0];
    it.order = last ? last.order + 1000 : 1000;
  }
  trip.items.push(it);
  commitTrip(trip);
  if (target && target.date) autoMoveTimes(trip, target.date);
  return it;
}

// ---------------------------------------------------------------------------
// 「行った」：スポット帳の訪問記録（visits）へ即時書き戻し、取り消しも即時
//   スポット帳 v3.1 と同じく 訪問日＋評価（😫😞😐😋🤩）が必須。旅帳は作った visit_id を覚えておく
// ---------------------------------------------------------------------------
const RATING_FACES = ['', '😫', '😞', '😐', '😋', '🤩'];
const RATING_LABELS = ['', 'もう行かない', 'いまいち', 'ふつう', 'よかった', '最高'];
function faceHTML(n) { return n ? `<span title="${RATING_LABELS[n]}">${RATING_FACES[n]}</span>` : '<span class="muted small">評価なし</span>'; }
function faceButtonsHTML(sel, act) {
  return `<div class="faces">${[1, 2, 3, 4, 5].map(n => `<button class="face ${n === sel ? 'on' : ''}" data-act="${act}" data-v="${n}">${RATING_FACES[n]}<small>${RATING_LABELS[n]}</small></button>`).join('')}</div>`;
}
async function markVisited(trip, it, visit) {
  const prev = it.visited;
  const v = Object.assign({ date: todayStr(), rating: 0, comment: '', companions: trip.members.map(m => m.name), people: trip.members.length }, prev || {}, visit || {}, { at: new Date().toISOString() });
  if (prev && prev.visitId) v.visitId = prev.visitId;
  it.visited = v;
  commitTrip(trip);
  if (!it.spotId) return;
  try {
    const r = await api('spotSetVisited', { spotId: it.spotId, visitId: v.visitId || '', visit: v });
    if (r.visitId) it.visited.visitId = r.visitId;
    if (r.spot) S.spots[it.spotId] = normalizeSpot(r.spot);
    it._visitPending = false;
    commitTrip(trip, { noRender: true });
  } catch (e) {
    toast('スポット帳への書き戻しに失敗：' + e.message + '（旅帳には記録済み・次回再送）');
    it._visitPending = true; commitTrip(trip, { noRender: true });
  }
}
async function unmarkVisited(trip, it) {
  const v = it.visited;
  if (it.spotId && v && v.visitId) {
    try {
      const r = await api('spotSetVisited', { spotId: it.spotId, visitId: v.visitId, visit: null });
      if (r.spot) S.spots[it.spotId] = normalizeSpot(r.spot);
    } catch (e) { toast(e.message); return; }   // 取り消せなかった時は旅帳側も「行った」のまま
  }
  it.visited = null; it._visitPending = false;
  commitTrip(trip);
  toast('「行った」を取り消しました');
}
// 書き戻し失敗分の再送
async function retryVisitWrites() {
  for (const trip of Object.values(S.trips)) {
    for (const it of trip.items.filter(i => i._visitPending && i.spotId && i.visited)) {
      try {
        const r = await api('spotSetVisited', { spotId: it.spotId, visitId: it.visited.visitId || '', visit: it.visited });
        if (r.visitId) it.visited.visitId = r.visitId;
        it._visitPending = false; commitTrip(trip, { noRender: true });
      } catch (e) { return; }
    }
  }
}

// クイック記録（スポット帳の［行った！］と同じ：日付＋評価をタップで即保存）
function openQuickVisit(trip, it) {
  const info = itemInfo(trip, it);
  openModal(`<div class="form-grid"><label>訪問日</label><input type="date" id="qvDate" value="${todayStr()}"></div>
    <div class="b mt">評価（タップで記録）</div>${faceButtonsHTML(0, 'qvFace')}
    <div class="muted small">${it.spotId ? 'スポット帳の訪問記録に入ります。写真・金額はスポット帳で足せます' : 'スポット帳に未登録のため旅帳内だけに記録します'}</div>
    <button class="btn block mt" data-act="qvFull">📝 ひとこと・同行者も書く</button>`, { title: '✅ 行った！ ' + esc(info.name), data: { trip, it } });
}
ACT.qvFace = async (el) => {
  const b = topModalBody(); const { trip, it } = topModal().data;
  const date = $('#qvDate', b).value;
  if (!date) return toast('訪問日を入れてください');
  closeModal();
  await markVisited(trip, it, { date, rating: Number(el.dataset.v) });
  toast('「' + itemInfo(trip, it).name + '」を行ったにしました ' + RATING_FACES[Number(el.dataset.v)]);
};
ACT.qvFull = () => { const { trip, it } = topModal().data; const d = $('#qvDate', topModalBody()).value; closeModal(); openVisitDialog(trip, it, d); };

function openVisitDialog(trip, it, presetDate) {
  const v = it.visited || { date: presetDate || todayStr(), rating: 0, comment: '', companions: trip.members.map(m => m.name) };
  const info = itemInfo(trip, it);
  const comp = new Set(v.companions || []);
  const allNames = Array.from(new Set(trip.members.map(m => m.name).concat(v.companions || [])));
  const remote = it.spotId && v.visitId && S.spots[it.spotId] ? (S.spots[it.spotId].visits || []).find(x => x.visitId === v.visitId) : null;
  openModal(`<div class="form-grid">
    <label>訪問日</label><input type="date" id="vdDate" value="${esc(v.date || todayStr())}">
    <label>評価<span class="req">必須</span></label><div id="vdFaces" data-v="${v.rating || 0}">${faceButtonsHTML(v.rating || 0, 'vdFace')}</div>
    <label>ひとこと</label><textarea id="vdComment" rows="2" placeholder="ひとことコメント">${esc(v.comment || '')}</textarea>
    <label>同行者</label><div class="chips" id="vdComp">${allNames.map(n => `<label class="chip"><input type="checkbox" value="${esc(n)}" ${comp.has(n) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
  </div>
  <div class="muted small">${it.spotId ? 'スポット帳の訪問記録として保存されます（写真・何を・金額はスポット帳で足せます）' : 'このスポットはスポット帳に未登録のため旅帳内だけに保存されます'}</div>
  ${remote && remote.hasExtras ? '<div class="info-box small">📷 スポット帳で写真や金額などが書き足されています（旅帳から保存してもそれらは残ります）</div>' : ''}
  <div class="row gap mt"><button class="btn primary grow" data-act="vdSave">保存</button>${it.visited ? '<button class="btn danger" data-act="vdUndo">行ったを取り消す</button>' : ''}</div>`,
    { title: '✅ ' + esc(info.name) + ' の訪問記録', data: { trip, it } });
}
ACT.vdFace = (el) => { const w = $('#vdFaces'); w.dataset.v = el.dataset.v; w.innerHTML = faceButtonsHTML(Number(el.dataset.v), 'vdFace'); };
ACT.vdSave = async () => {
  const b = topModalBody(); const { trip, it } = topModal().data;
  const rating = Number($('#vdFaces', b).dataset.v) || 0;
  if (!rating) return toast('評価を選んでください');
  const visit = { date: $('#vdDate', b).value || todayStr(), rating, comment: $('#vdComment', b).value.trim(), companions: $$('#vdComp input', b).filter(x => x.checked).map(x => x.value) };
  visit.people = visit.companions.length || '';
  closeModal();
  await markVisited(trip, it, visit);
  toast('訪問記録を保存しました');
};
ACT.vdUndo = async () => { const { trip, it } = topModal().data; closeModal(); await unmarkVisited(trip, it); };

// ---------------------------------------------------------------------------
// 為替・天気・経路のキャッシュ取得
// ---------------------------------------------------------------------------
let fxPromise = null;
function ensureFx(force) {
  if (S.fx && !force && Date.now() - (S.fx._t || 0) < 3600e3) return Promise.resolve(S.fx);
  if (fxPromise) return fxPromise;
  fxPromise = api('fxRates').then(r => { S.fx = { toJpy: r.toJpy, at: r.at, _t: Date.now(), mock: r.mock }; fxPromise = null; return S.fx; })
    .catch(e => { fxPromise = null; return S.fx; });
  return fxPromise;
}
const weatherPending = {};
function weatherKey(p) { return p.lat.toFixed(1) + ',' + p.lng.toFixed(1); }
function weatherFor(p, date) {
  if (!p || p.lat == null) return null;
  const k = weatherKey(p);
  const w = S.weatherCache[k];
  if (!w) { requestWeather([p]); return undefined; }
  return w.find(x => x.date === date) || null;
}
const requestWeather = (() => {
  let queue = [];
  const flush = debounce(async () => {
    const pts = queue.filter(p => !S.weatherCache[weatherKey(p)] && !weatherPending[weatherKey(p)]);
    queue = [];
    const uniq = {}; pts.forEach(p => { uniq[weatherKey(p)] = { lat: Math.round(p.lat * 10) / 10, lng: Math.round(p.lng * 10) / 10 }; });
    const list = Object.values(uniq).slice(0, 20);
    if (!list.length) return;
    list.forEach(p => weatherPending[weatherKey(p)] = true);
    try {
      const r = await api('weather', { points: list });
      Object.keys(r.weather || {}).forEach(k => { S.weatherCache[k] = r.weather[k]; });
      render();
    } catch (e) { /* 天気は任意 */ }
    list.forEach(p => delete weatherPending[weatherKey(p)]);
  }, 300);
  return (pts) => { queue = queue.concat(pts); flush(); };
})();
function weatherHTML(w) {
  if (w === undefined) return '<span class="muted small">天気…</span>';
  if (!w) return '';
  return `<span class="wx">${WEATHER_ICON(w.code)} ${Math.round(w.tmax)}°/${Math.round(w.tmin)}°${w.pop != null ? ' ☔' + w.pop + '%' : ''}</span>`;
}

// 経路（サーバ側 Maps）。結果はキャッシュし、無い間は直線距離からの概算を表示
function routeKey(from, to, mode, opt) {
  const r = (v) => Math.round(v * 200) / 200;
  return [r(from.lat), r(from.lng), r(to.lat), r(to.lng), mode, opt && opt.highway === false ? 'nh' : 'h', opt && opt.toll === false ? 'nt' : 't'].join('|');
}
const routePending = {};
function routeFor(from, to, mode, opt) {
  if (!from || !to || from.lat == null || to.lat == null) return null;
  const k = routeKey(from, to, mode, opt);
  if (S.routeCache[k]) return S.routeCache[k];
  const km = haversineKm(from, to);
  requestRoutes([{ from, to, mode, opt, k }]);
  return { km: Math.round(km * 1.35 * 10) / 10, min: estimateMinutes(km, mode), estimated: true, pending: true };
}
const requestRoutes = (() => {
  let queue = [];
  const flush = debounce(async () => {
    const list = queue.filter(q => !S.routeCache[q.k] && !routePending[q.k]).slice(0, 25);
    queue = [];
    if (!list.length) return;
    list.forEach(q => routePending[q.k] = true);
    try {
      const r = await api('routes', { list: list.map(q => ({ from: { lat: q.from.lat, lng: q.from.lng }, to: { lat: q.to.lat, lng: q.to.lng }, mode: q.mode, opt: q.opt })) });
      (r.results || []).forEach((res, i) => { if (res) S.routeCache[list[i].k] = res; });
      render();
    } catch (e) { /* 概算のまま */ }
    list.forEach(q => delete routePending[q.k]);
  }, 400);
  return (qs) => { queue = queue.concat(qs); flush(); };
})();

// しおり：隣り合う工程の移動時間を自動計算（手動上書きしたものは除く）
async function autoMoveTimes(trip, date, force) {
  const items = dayItems(trip, date);
  const mode = trip.vehicles.includes('car') ? 'car' : (trip.vehicles[0] || 'car');
  const qs = [];
  for (let i = 0; i < items.length - 1; i++) {
    const a = items[i], b = items[i + 1];
    if (!force && !a.moveAuto) continue;
    const pa = itemPoint(trip, a), pb = itemPoint(trip, b);
    if (!pa || !pb) continue;
    qs.push({ a, from: pa, to: pb });
  }
  if (!qs.length) return;
  try {
    const r = await api('routes', { list: qs.map(q => ({ from: q.from, to: q.to, mode, opt: { highway: trip.listTransport.highway, toll: trip.listTransport.toll } })) });
    (r.results || []).forEach((res, i) => {
      if (!res) return;
      const a = qs[i].a;
      a.moveAfter = Math.ceil(res.min / 5) * 5;
      a.moveAuto = true;
      a.moveInfo = { km: res.km, min: res.min, mode, estimated: !!res.estimated, toll: res.toll || null };
    });
    commitTrip(trip);
  } catch (e) { toast('移動時間の自動計算に失敗：' + e.message); }
}
