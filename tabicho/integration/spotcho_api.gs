/**
 * 【スポット帳GASに追加するファイル】旅帳との連携API
 *
 * 手順：
 *  1. スポット帳のGASプロジェクトにこのファイルを追加
 *  2. 既存の doPost の先頭に次の2行を足す（既存の処理はそのまま）
 *
 *     var body = JSON.parse(e.postData.contents || '{}');
 *     if (String(body.action || '').indexOf('tabicho.') === 0) return tabichoHandle_(body);
 *
 *  3. 下の TABICHO_SPOT_CONFIG の列名を、スポット帳シートの見出し（1行目）に合わせる
 *  4. 「デプロイを管理」→ 既存のデプロイを編集 →「新バージョン」で更新（URLは変わらない）
 *
 * 旅帳からは常にサーバ同士で呼ばれ、PINは旅帳GASのスクリプトプロパティにだけ置く。
 */
var TABICHO_SPOT_CONFIG = {
  sheetName: 'spots',            // スポットのシート名
  pinProperty: 'PIN',            // スポット帳のPINが入っているスクリプトプロパティ名（空なら確認しない）
  cols: {                        // 旅帳の項目: スポット帳シートの見出し名（無い列は使われない）
    id: 'id', name: '名前', lat: '緯度', lng: '経度', address: '住所', area: 'エリア',
    hours: '営業時間', tags: 'タグ', status: 'ステータス', priority: '優先度',
    stayMin: '滞在目安', price: '料金目安', parking: '駐車場', station: '最寄り駅', url: 'URL', updatedAt: '更新日時'
  },
  visitedValue: '行った',        // 「行った」を表すステータスの値
  wantValue: '行きたい',         // 「行きたい」を表すステータスの値
  visitsSheet: 'visits'          // 訪問記録（旅帳から書き戻す記録）のシート名。無ければ作る
};

function tabichoHandle_(body) {
  var out;
  try {
    var pinProp = TABICHO_SPOT_CONFIG.pinProperty && PropertiesService.getScriptProperties().getProperty(TABICHO_SPOT_CONFIG.pinProperty);
    if (pinProp && String(body.pin) !== String(pinProp)) throw new Error('PINが違います');
    var a = String(body.action).replace('tabicho.', '');
    if (a === 'ping') out = { ok: true, note: 'スポット帳 ' + tabichoSpotRows_().rows.length + '件' };
    else if (a === 'list') out = { ok: true, spots: tabichoListSpots_(), serverTime: new Date().toISOString() };
    else if (a === 'setVisited') out = tabichoSetVisited_(String(body.spotId), String(body.tripId), body.visit);
    else if (a === 'create') out = tabichoCreateSpot_(body.spot || {});
    else throw new Error('未知の操作: ' + a);
  } catch (e) { out = { ok: false, error: String(e.message || e) }; }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function tabichoSpotRows_() {
  var C = TABICHO_SPOT_CONFIG;
  var sh = SpreadsheetApp.getActive().getSheetByName(C.sheetName);
  if (!sh) throw new Error('シート「' + C.sheetName + '」がありません');
  var vals = sh.getDataRange().getValues();
  var head = vals[0].map(String);
  var idx = {};
  Object.keys(C.cols).forEach(function (k) { idx[k] = head.indexOf(C.cols[k]); });
  // id列が無ければ末尾に作って採番（行番号は削除でずれるため使わない）
  if (idx.id < 0) {
    var col = head.length + 1;
    sh.getRange(1, col).setValue(C.cols.id);
    if (vals.length > 1) sh.getRange(2, col, vals.length - 1, 1).setValues(vals.slice(1).map(function () { return [Utilities.getUuid()]; }));
    return tabichoSpotRows_();
  }
  var missing = vals.slice(1).map(function (r, i) { return r[idx.id] ? null : i + 2; }).filter(Boolean);
  if (missing.length) { missing.forEach(function (row) { sh.getRange(row, idx.id + 1).setValue(Utilities.getUuid()); }); return tabichoSpotRows_(); }
  return { sh: sh, head: head, idx: idx, rows: vals.slice(1).filter(function (r) { return r[idx.id] !== ''; }) };
}
function tabichoVisitsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TABICHO_SPOT_CONFIG.visitsSheet);
  if (!sh) { sh = ss.insertSheet(TABICHO_SPOT_CONFIG.visitsSheet); sh.appendRow(['spotId', 'tripId', 'date', 'rating', 'comment', 'companions', 'at', 'prevStatus']); }
  return sh;
}
function tabichoVisits_() {
  var v = tabichoVisitsSheet_().getDataRange().getValues().slice(1);
  return v.map(function (r, i) { return { row: i + 2, spotId: String(r[0]), tripId: String(r[1]), date: tabichoYmd_(r[2]), rating: Number(r[3]) || 0, comment: r[4], companions: String(r[5] || '').split('、').filter(String), at: String(r[6]), prevStatus: r[7] }; });
}
function tabichoYmd_(v) { return v instanceof Date ? Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd') : String(v || ''); }
function tabichoRowToSpot_(r, idx, visits) {
  var C = TABICHO_SPOT_CONFIG;
  var g = function (k) { return idx[k] >= 0 ? r[idx[k]] : ''; };
  var st = String(g('status'));
  var pr = String(g('priority'));
  var id = String(g('id'));
  return {
    id: id, name: g('name'), lat: g('lat'), lng: g('lng'), address: g('address'), area: g('area'), hours: g('hours'),
    tags: String(g('tags') || '').split(/[,、\s#]+/).filter(String),
    status: st === C.visitedValue ? 'visited' : 'want',
    priority: /絶対|must|高|★/.test(pr) ? 'must' : (pr ? 'maybe' : null),
    stayMin: g('stayMin'), price: g('price'), parking: g('parking'), station: g('station'), url: g('url'),
    updatedAt: g('updatedAt') instanceof Date ? g('updatedAt').toISOString() : String(g('updatedAt') || ''),
    visits: visits.filter(function (v) { return v.spotId === id; })
  };
}
function tabichoListSpots_() {
  var t = tabichoSpotRows_(); var visits = tabichoVisits_();
  return t.rows.map(function (r) { return tabichoRowToSpot_(r, t.idx, visits); });
}
function tabichoSetVisited_(spotId, tripId, visit) {
  var C = TABICHO_SPOT_CONFIG;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = tabichoSpotRows_();
    var i = t.rows.map(function (r) { return String(r[t.idx.id]); }).indexOf(spotId);
    if (i < 0) throw new Error('スポット帳で削除済みです');
    var row = i + 2;
    var vsh = tabichoVisitsSheet_();
    var visits = tabichoVisits_();
    var mine = visits.filter(function (v) { return v.spotId === spotId && v.tripId === tripId; });
    var curStatus = t.idx.status >= 0 ? t.rows[i][t.idx.status] : '';
    var prev = mine.length ? mine[0].prevStatus : curStatus;
    mine.sort(function (a, b) { return b.row - a.row; }).forEach(function (v) { vsh.deleteRow(v.row); });
    if (visit) {
      vsh.appendRow([spotId, tripId, visit.date || '', visit.rating || 0, visit.comment || '', (visit.companions || []).join('、'), visit.at || new Date().toISOString(), prev]);
      if (t.idx.status >= 0) t.sh.getRange(row, t.idx.status + 1).setValue(C.visitedValue);
    } else {
      var others = tabichoVisits_().filter(function (v) { return v.spotId === spotId; });
      if (!others.length && t.idx.status >= 0) t.sh.getRange(row, t.idx.status + 1).setValue(prev || C.wantValue);
    }
    if (t.idx.updatedAt >= 0) t.sh.getRange(row, t.idx.updatedAt + 1).setValue(new Date().toISOString());
    var fresh = tabichoSpotRows_();
    return { ok: true, spot: tabichoRowToSpot_(fresh.rows[i], fresh.idx, tabichoVisits_()) };
  } finally { lock.releaseLock(); }
}
function tabichoCreateSpot_(spot) {
  var C = TABICHO_SPOT_CONFIG;
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var t = tabichoSpotRows_();
    var row = new Array(t.head.length).map(function () { return ''; });
    for (var k = 0; k < t.head.length; k++) row[k] = '';
    var id = Utilities.getUuid();
    var set = function (k, v) { if (t.idx[k] >= 0 && v != null) row[t.idx[k]] = v; };
    set('id', id); set('name', spot.name); set('lat', spot.lat); set('lng', spot.lng); set('address', spot.address);
    set('area', spot.area); set('hours', spot.hours); set('stayMin', spot.stayMin); set('price', spot.price);
    set('status', spot.status === 'visited' ? C.visitedValue : C.wantValue);
    set('priority', spot.priority === 'must' ? '絶対行きたい' : '行けたら');
    set('updatedAt', new Date().toISOString());
    t.sh.appendRow(row);
    return { ok: true, spot: tabichoRowToSpot_(row, t.idx, []) };
  } finally { lock.releaseLock(); }
}
