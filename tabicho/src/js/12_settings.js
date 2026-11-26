// ============================================================================
// 12 設定（右上の歯車）
// ============================================================================
ACT.openSettings = () => {
  const st = S.settings;
  PAY_EDIT = null;   // 開くたびに保存済みの内容から編集を始める
  openModal(`<div class="set-sec"><div class="b">👤 基本</div><div class="form-grid">
      <label>自分の名前</label><input id="stMe" value="${esc(st.myName)}">
      <label>自宅（出発地）</label><input id="stHomeName" value="${esc(st.home.name)}">
      <label>自宅の座標</label><div class="row gap"><input id="stHomeLat" value="${esc(st.home.lat)}" inputmode="decimal"><input id="stHomeLng" value="${esc(st.home.lng)}" inputmode="decimal"><button class="btn sm" data-act="stHomeHere">現在地</button></div>
      <label>1日の開始時刻</label><input type="time" id="stDayStart" value="${esc(st.dayStart)}">
      <label>出発の余裕</label><div class="row gap"><input id="stMargin" inputmode="numeric" value="${esc(st.departMarginMin)}"><span>分（ドライブのカウントダウン）</span></div>
    </div></div>
    <div class="set-sec"><div class="b">👥 メンバーのプリセット</div><div id="stPresets">${(st.memberPresets || []).map(presetRowHTML).join('')}</div>
      <button class="btn sm" data-act="stPresetAdd">＋ プリセット</button><div class="muted small">名前は「、」区切り</div></div>
    <div class="set-sec"><div class="b">💳 支払方法と家計簿のカテゴリー</div><div id="stPays">${payListHTML()}</div>
      <button class="btn sm" data-act="stPayAdd">＋ 支払方法</button>
      <div class="muted small">「カード」にした支払方法は、家計簿へ引落額（全額）＋割り勘分の収入の2本で送ります。カテゴリーは家計簿アプリの「カテゴリー」名と同じにしてください</div></div>
    <div class="set-sec"><div class="b">📒 家計簿連携</div><div class="form-grid">
      <label>用途</label><input id="stKkUsage" value="${esc(st.kakeiboUsage)}">
      <label>予算区分</label><input id="stKkBudget" value="${esc(st.kakeiboBudget)}">
      <label>割り勘収入のカテゴリー</label><input id="stKkInc" value="${esc(st.kakeiboIncomeCategory)}">
      <label>他の人が払った分</label><input id="stKkSettle" value="${esc(st.kakeiboSettleCategory || 'その他（支出）')}" placeholder="自分の負担分を送る時のカテゴリー">
    </div></div>
    <div class="set-sec"><div class="b">🧭 行き先提案の概算</div><div class="form-grid">
      <label>燃費</label><div class="row gap"><input id="stFe" inputmode="decimal" value="${esc(st.fuelEfficiency)}"><span>km/L</span></div>
      <label>ガソリン単価</label><div class="row gap"><input id="stFp" inputmode="numeric" value="${esc(st.fuelPrice)}"><span>円/L</span></div>
      <label>食費（1食1人）</label><div class="row gap"><input id="stMeal" inputmode="numeric" value="${esc(st.mealPerPerson)}"><span>円</span></div>
      <label>宿（1泊1人）</label><div class="row gap"><input id="stLodge" inputmode="numeric" value="${esc(st.lodgingPerPerson)}"><span>円</span></div>
    </div></div>
    <div class="set-sec"><div class="b">📷 写真・動画の送信</div><div class="form-grid">
      <label>写真</label><select id="stAutoPhoto"><option value="0">保留（手動で送る）</option><option value="1" ${(st.media || {}).autoPhoto ? 'selected' : ''}>自動で送る</option></select>
      <label>動画</label><select id="stAutoVideo"><option value="0">保留（手動で送る）</option><option value="1" ${(st.media || {}).autoVideo ? 'selected' : ''}>自動で送る</option></select>
      <label>確認する大きさ</label><div class="row gap"><input id="stConfirmMB" inputmode="numeric" value="${esc((st.media || {}).confirmMB || 100)}"><span>MB 以上は送る前に確認</span></div>
      <label>チャンク</label><select id="stChunk">${[1, 4, 8].map(n => `<option value="${n}" ${Number((st.media || {}).chunkMB || 4) === n ? 'selected' : ''}>${n}MB</option>`).join('')}</select>
    </div><div class="muted small">Wi-Fi かどうかは iPhone の Safari では判定できないため、既定は保留です</div></div>
    <div class="set-sec"><div class="b">🎒 持ち物テンプレートに追加</div><div id="stPack">${(st.packCustom || []).map(packTmplRowHTML).join('')}</div><button class="btn sm" data-act="stPackAdd">＋ 追加</button></div>
    <button class="btn primary block" data-act="stSave">設定を保存</button>
    <div class="set-sec mt"><div class="b">🔌 接続</div><div id="stConn" class="small muted">${IS_DEMO ? 'デモモード（GAS 未接続）' : IS_GAS ? 'GAS 接続中' : 'GAS の接続部品がありません'}</div><button class="btn sm" data-act="stTest">接続テスト</button>
      <div class="muted small">スポット帳・家計簿のURLとPINは画面に出さず、旅帳GASのスクリプトプロパティに保存します（README参照）。家計簿へはほしいもの帳と同じ方式（区分を固定した明細を追加）で送ります</div></div>
    <div class="set-sec"><div class="b">💾 データ</div><div class="row gap wrap"><button class="btn sm" data-act="stExport">JSONを書き出す</button><button class="btn sm ghost" data-act="stClearCache">端末のキャッシュを消す</button>${IS_DEMO ? '<button class="btn sm danger" data-act="stResetDemo">デモデータを初期化</button>' : ''}</div>
      <div class="muted small">旅帳 v${APP_VERSION}</div></div>`,
    { title: '⚙️ 設定', full: true });
};
function presetRowHTML(p) { return `<div class="row gap set-row" data-pid="${esc(p.id)}"><input class="pr-name" value="${esc(p.name)}" placeholder="名前（例：家族）"><input class="pr-mem grow" value="${esc((p.members || []).join('、'))}" placeholder="メンバー"><button class="op" data-act="stRowDel">✕</button></div>`; }
// 誤タップで消えないよう、一覧には削除ボタンを置かない（行をタップ → 編集画面 → 削除は確認つき）
let PAY_EDIT = null;
function payListHTML() {
  PAY_EDIT = PAY_EDIT || clone(S.settings.payMethods || []);
  return PAY_EDIT.map((p, i) => `<button class="pay-row" data-act="payEdit" data-i="${i}">
    <span class="grow"><b>${esc(p.name || '（名前なし）')}</b><span class="muted small">家計簿：${esc(p.kakeiboCategory || '未設定')}</span></span>
    ${p.isCard ? '<span class="tag">カード</span>' : ''}${p.id === 'cash' || p.isCash ? '<span class="tag gray">現金</span>' : ''}<span class="chev">›</span></button>`).join('');
}
ACT.payEdit = (el) => openPayEditor(Number(el.dataset.i));
function openPayEditor(i) {
  const isNew = i < 0;
  const p = isNew ? { id: uid('pm'), name: '', kakeiboCategory: '', isCard: false, isCash: false } : PAY_EDIT[i];
  openModal(`<div class="form-grid">
      <label>支払方法</label><input id="peName" value="${esc(p.name)}" placeholder="例：三井住友ゴールド(NL)">
      <label>家計簿カテゴリー</label><input id="peCat" value="${esc(p.kakeiboCategory)}" placeholder="家計簿アプリのカテゴリー名">
      <label>種類</label><div class="row gap wrap"><label class="check"><input type="checkbox" id="peCard" ${p.isCard ? 'checked' : ''}> カード（引落額＋割り勘分の2本で送る）</label>
        <label class="check"><input type="checkbox" id="peCash" ${p.id === 'cash' || p.isCash ? 'checked' : ''} ${p.id === 'cash' ? 'disabled' : ''}> 現金</label></div>
    </div>
    <button class="btn primary block mt" data-act="peSave">決定</button>
    ${!isNew && p.id !== 'cash' ? '<button class="btn danger block mt" data-act="peDel">この支払方法を削除…</button>' : ''}
    <div class="muted small mt">ここでの変更は、設定画面の［設定を保存］で確定します</div>`, { title: isNew ? '＋ 支払方法' : '💳 支払方法の編集', data: { i, p, isNew } });
}
ACT.peSave = () => {
  const b = topModalBody(); const { i, p, isNew } = topModal().data;
  const name = $('#peName', b).value.trim();
  if (!name) return toast('支払方法の名前を入れてください');
  Object.assign(p, { name, kakeiboCategory: $('#peCat', b).value.trim(), isCard: $('#peCard', b).checked, isCash: p.id === 'cash' || $('#peCash', b).checked });
  if (isNew) PAY_EDIT.push(p);
  closeModal(); $('#stPays').innerHTML = payListHTML();
};
ACT.peDel = async () => {
  const { i, p } = topModal().data;
  if (!(await confirmDialog('支払方法「' + p.name + '」を削除しますか？\n（設定画面の［設定を保存］を押すまでは確定しません）'))) return;
  PAY_EDIT.splice(i, 1);
  closeModal(); $('#stPays').innerHTML = payListHTML();
};
function payRowHTML(p) { return `<div class="row gap set-row wrap" data-payid="${esc(p.id)}"><input class="pm-name" value="${esc(p.name)}" placeholder="支払方法"><input class="pm-cat grow" value="${esc(p.kakeiboCategory)}" placeholder="家計簿カテゴリー"><label class="check"><input type="checkbox" class="pm-card" ${p.isCard ? 'checked' : ''}>カード</label><label class="check"><input type="checkbox" class="pm-cash" ${p.id === 'cash' || p.isCash ? 'checked' : ''} ${p.id === 'cash' ? 'disabled' : ''}>現金</label>${p.id === 'cash' ? '' : '<button class="op" data-act="stRowDel">✕</button>'}</div>`; }
function packTmplRowHTML(p) { return `<div class="row gap set-row"><select class="pt-cat">${PACK_CATS.map(c => `<option ${c === p.cat ? 'selected' : ''}>${c}</option>`).join('')}</select><input class="pt-name grow" value="${esc(p.name)}"><select class="pt-when">${[['all', 'いつも'], ['stay', '泊まり'], ['multi', '2泊以上'], ['car', '車旅'], ['train', '電車'], ['plane', '飛行機'], ['ferry', 'フェリー']].map(([v, l]) => `<option value="${v}" ${p.when === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="op" data-act="stRowDel">✕</button></div>`; }
ACT.stRowDel = (el) => el.closest('.set-row').remove();
ACT.stPresetAdd = () => $('#stPresets').insertAdjacentHTML('beforeend', presetRowHTML({ id: uid('pr'), name: '', members: [S.settings.myName] }));
ACT.stPayAdd = () => openPayEditor(-1);
ACT.stPackAdd = () => $('#stPack').insertAdjacentHTML('beforeend', packTmplRowHTML({ cat: 'その他', name: '', when: 'all' }));
ACT.stHomeHere = () => { if (!S.geo) return toast('現在地を取得できていません'); $('#stHomeLat').value = S.geo.lat.toFixed(6); $('#stHomeLng').value = S.geo.lng.toFixed(6); };
ACT.stSave = () => {
  const b = topModalBody(); const st = S.settings;
  const oldMe = st.myName;
  st.myName = $('#stMe', b).value.trim() || '自分';
  st.home = { name: $('#stHomeName', b).value.trim() || '自宅', lat: num($('#stHomeLat', b).value, st.home.lat), lng: num($('#stHomeLng', b).value, st.home.lng) };
  st.dayStart = $('#stDayStart', b).value || '09:00';
  st.departMarginMin = num($('#stMargin', b).value, 10);
  st.memberPresets = $$('#stPresets .set-row', b).map(r => ({ id: r.dataset.pid, name: $('.pr-name', r).value.trim(), members: $('.pr-mem', r).value.split(/[、,，\s]+/).map(s => s.trim()).filter(Boolean) })).filter(p => p.name && p.members.length);
  st.payMethods = clone(PAY_EDIT || st.payMethods).filter(p => p.name);
  PAY_EDIT = null;
  if (!st.payMethods.some(p => p.id === 'cash')) st.payMethods.unshift({ id: 'cash', name: '現金', kakeiboCategory: 'その他（支出）', isCard: false, isCash: true });
  st.kakeiboUsage = $('#stKkUsage', b).value.trim();
  st.kakeiboBudget = $('#stKkBudget', b).value.trim();
  st.kakeiboIncomeCategory = $('#stKkInc', b).value.trim() || '割り勘';
  st.kakeiboSettleCategory = $('#stKkSettle', b).value.trim() || 'その他（支出）';
  st.fuelEfficiency = num($('#stFe', b).value, 15); st.fuelPrice = num($('#stFp', b).value, 170);
  st.mealPerPerson = num($('#stMeal', b).value, 1500); st.lodgingPerPerson = num($('#stLodge', b).value, 10000);
  st.media = { autoPhoto: $('#stAutoPhoto', b).value === '1', autoVideo: $('#stAutoVideo', b).value === '1', confirmMB: num($('#stConfirmMB', b).value, 100) || 100, chunkMB: num($('#stChunk', b).value, 4) || 4 };
  st.packCustom = $$('#stPack .set-row', b).map(r => ({ cat: $('.pt-cat', r).value, name: $('.pt-name', r).value.trim(), when: $('.pt-when', r).value })).filter(p => p.name);
  if (oldMe !== st.myName) toast('自分の名前を変えました。既存の旅は「旅の編集」で自分の印を確認してください');
  closeModal(); commitSettings(); toast('設定を保存しました');
};
ACT.stTest = async () => {
  const el = $('#stConn'); el.textContent = 'テスト中…';
  try {
    const r = await api('testConnections');
    const line = (k, l) => `<div>${r[k] && r[k].ok ? '✅' : '❌'} ${l}：${esc((r[k] && (r[k].note || r[k].error)) || '')}</div>`;
    el.innerHTML = line('spotcho', 'スポット帳') + line('kakeibo', '家計簿') + line('calendar', 'カレンダー') + line('maps', '経路（Maps）') + line('media', '写真・動画（Drive）');
  } catch (e) { el.textContent = '失敗：' + e.message; }
};
ACT.stExport = () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), settings: S.settings, trips: Object.values(S.trips).map(stripPrivate) }, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tabicho_' + todayStr() + '.json'; a.click();
};
ACT.stClearCache = async () => {
  if (Object.keys(S.dirty).length && !(await confirmDialog('未送信の変更があります。消すと失われます。続けますか？'))) return;
  localStorage.removeItem(CACHE_KEY); location.reload();
};
ACT.stResetDemo = async () => { if (await confirmDialog('デモデータをすべて消して初期状態に戻しますか？')) { MockServer.reset(); localStorage.removeItem(CACHE_KEY); location.reload(); } };
