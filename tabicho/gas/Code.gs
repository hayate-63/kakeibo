/**
 * 旅帳 サーバ（Google Apps Script） v2.0.4
 * v2.0：写真・動画の Drive 保存（メディア）、ビジュアルモード、コレクション
 *
 * ウェブアプリとしてデプロイ：実行ユーザー＝自分／アクセス＝自分のみ（推奨）
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）：
 *   TABICHO_SHEET_ID   保存先スプレッドシートID（未設定なら初回に自動作成して保存）
 *   SPOTCHO_URL        スポット帳GASのウェブアプリURL（/exec）
 *   SPOTCHO_PIN        スポット帳GASの SECRET_PIN と同じ値（画面側には出さない）
 *   PLACES_API_KEY     Google Places API（New）のキー。営業時間を place_id から取る（スポット帳と同じキーでよい）
 *   KAKEIBO_URL        家計簿GASのウェブアプリURL（/exec）
 *   KAKEIBO_PIN        家計簿GASの SECRET_PIN と同じ値（必須）
 *   SHIFT_MASTER_SS_ID 残業時間管理ブックのID（「勤務マスタ」で勤務を見分ける。家計簿GASの SALARY_SS_ID と同じ）
 *   WORK_CALENDAR_ID   勤務が入っているカレンダーのID（未設定ならメインのカレンダー）
 *   WORK_OFF_REGEX     休みを表す勤務名・予定名（既定：休|公休|有給|有休|OFF|オフ）
 *   SHIFT_AKE_IS_OFF   夜勤明けの日を休みとみなすか（既定 false）
 *   WORK_EMPTY_IS_OFF  勤務の予定が無い日を休みとみなすか（既定 true）
 *   TRAVEL_CALENDAR_ID 予約を登録するカレンダー（未設定なら既定のカレンダー）
 */

var TRIP_SHEET = 'trips';
var SETTINGS_SHEET = 'settings';
var CHUNK = 45000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('旅帳')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** 画面からの唯一の入口（google.script.run.apiCall） */
function apiCall(name, argsJson) {
  try {
    var args = argsJson ? JSON.parse(argsJson) : {};
    var h = API[name];
    if (!h) throw new Error('未知のAPI: ' + name);
    return JSON.stringify(h(args));
  } catch (e) {
    console.error(name, e && e.stack);
    return JSON.stringify({ error: String(e && e.message || e) });
  }
}

function prop_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return v == null || v === '' ? (d === undefined ? null : d) : v; }

// ---------------------------------------------------------------------------
// 保存先スプレッドシート
// ---------------------------------------------------------------------------
function db_() {
  var id = prop_('TABICHO_SHEET_ID');
  var ss;
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.create('旅帳データ');
    PropertiesService.getScriptProperties().setProperty('TABICHO_SHEET_ID', ss.getId());
  }
  if (!ss.getSheetByName(TRIP_SHEET)) {
    var sh = ss.insertSheet(TRIP_SHEET);
    sh.appendRow(['id', 'updatedAt', 'title', 'startDate', 'endDate', 'json']);
    sh.setFrozenRows(1);
  }
  if (!ss.getSheetByName(SETTINGS_SHEET)) {
    var s2 = ss.insertSheet(SETTINGS_SHEET);
    s2.appendRow(['key', 'json']);
  }
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 2) ss.deleteSheet(def);
  return ss;
}
/** 初回セットアップ用（エディタから実行するとスプレッドシートを作ってURLをログに出す） */
function setupTabicho() {
  var ss = db_();
  Logger.log('保存先: ' + ss.getUrl());
  // 権限の承認を一度に済ませるために各サービスに触れる
  try { CalendarApp.getDefaultCalendar().getName(); } catch (e) {}
  try { Maps.newGeocoder().geocode('亀山駅'); } catch (e) {}
  try { UrlFetchApp.fetch('https://open.er-api.com/v6/latest/JPY', { muteHttpExceptions: true }); } catch (e) {}
  // v2.0：写真・動画の保存先（Drive）と英語タイトル（翻訳）。Drive の権限承認はここで1回
  var mf = childFolder_(DriveApp.getRootFolder(), MEDIA_ROOT);
  Logger.log('写真・動画の保存先: ' + mf.getUrl());
  try { LanguageApp.translate('旅', 'ja', 'en'); } catch (e) {}
}

function readTrips_() {
  var sh = db_().getSheetByName(TRIP_SHEET);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var width = sh.getLastColumn();
  var vals = sh.getRange(2, 1, last - 1, width).getValues();
  var out = [];
  vals.forEach(function (r, i) {
    if (!r[0]) return;
    var json = r.slice(5).join('');
    try { var t = JSON.parse(json); t.updatedAt = String(r[1]); out.push({ row: i + 2, trip: t }); } catch (e) { console.error('壊れた行', i + 2, e); }
  });
  return out;
}
function writeTripRow_(sh, row, trip) {
  var json = JSON.stringify(trip);
  var chunks = [];
  for (var i = 0; i < json.length; i += CHUNK) chunks.push(json.substring(i, i + CHUNK));
  var vals = [trip.id, trip.updatedAt, trip.title || '', trip.startDate || '', trip.endDate || ''].concat(chunks);
  var width = Math.max(sh.getLastColumn(), vals.length);
  while (vals.length < width) vals.push('');
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var rng = sh.getRange(row, 1, 1, width);
  rng.setNumberFormat('@');
  rng.setValues([vals]);
}

// v2.0.3：旅の行を探すのは ID 列（A列）だけ読む。全部の旅の JSON を読んで解析しない
function findTripRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 2;
  return 0;
}
// 1行だけ読んで旅に戻す（衝突した時だけ使う）
function readTripRow_(sh, row) {
  var r = sh.getRange(row, 1, 1, sh.getLastColumn()).getValues()[0];
  var t = JSON.parse(r.slice(5).join(''));
  t.updatedAt = String(r[1]);
  return t;
}

var API = {};

API.bootstrap = function () {
  var trips = readTrips_().map(function (x) { return x.trip; });
  var sh = db_().getSheetByName(SETTINGS_SHEET);
  var settings = null;
  if (sh.getLastRow() >= 2) {
    var v = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().filter(function (r) { return r[0] === 'settings'; })[0];
    if (v) { try { settings = JSON.parse(v[1]); } catch (e) {} }
  }
  return { settings: settings, trips: trips, serverTime: new Date().toISOString() };
};

API.saveTrip = function (a) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var ss = db_(); var sh = ss.getSheetByName(TRIP_SHEET);
    var trip = a.trip;
    if (!trip || !trip.id) throw new Error('旅のデータがありません');
    var row = findTripRow_(sh, trip.id);
    if (row && !a.force && a.baseUpdatedAt) {
      var curAt = String(sh.getRange(row, 2).getValue());   // 更新日時（B列）だけ見る
      if (curAt > a.baseUpdatedAt) return { conflict: true, trip: readTripRow_(sh, row) };
    }
    trip.updatedAt = new Date().toISOString();
    if (!row) row = sh.getLastRow() + 1;
    writeTripRow_(sh, row, trip);
    return { ok: true, updatedAt: trip.updatedAt };
  } finally { lock.releaseLock(); }
};

API.deleteTrip = function (a) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = db_().getSheetByName(TRIP_SHEET);
    var row = findTripRow_(sh, a.id);
    if (row) sh.deleteRow(row);
    return { ok: true };
  } finally { lock.releaseLock(); }
};

API.saveSettings = function (a) {
  var sh = db_().getSheetByName(SETTINGS_SHEET);
  var last = sh.getLastRow();
  var rows = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  var idx = -1;
  rows.forEach(function (r, i) { if (r[0] === 'settings') idx = i + 2; });
  var json = JSON.stringify(a.settings || {});
  if (idx < 0) sh.appendRow(['settings', json]); else sh.getRange(idx, 2).setValue(json);
  return { ok: true };
};

// ---------------------------------------------------------------------------
// スポット帳（サーバ同士で通信。PINは画面に出さない）
// ---------------------------------------------------------------------------
// スポット帳 GAS v3.1 の API をそのまま使う（スポット帳側の変更は不要）
//   POST { action, pin, ... } → { status: 'ok', ... } / { status: 'error', code, message }
// ---------------------------------------------------------------------------
// v2.0.2：ほかの GAS ウェブアプリ（スポット帳・家計簿）を呼ぶ共通部品
//  ・URL が GAS の /exec か確かめる（アプリの画面の URL や /dev を入れた時に原因をはっきり出す）
//  ・同じ Google アカウントの GAS へは旅帳の OAuth トークンを付けて呼ぶ
//    （相手のデプロイが「全員」でなくても、持ち主が同じなら通るように。トークンは script.google.com にだけ送る）
//  ・JSON でない応答（ログイン画面・GAS のエラー画面・別のサイト）を見分けて、何が返ってきたかを伝える
// ---------------------------------------------------------------------------
function checkExecUrl_(label, prop, url) {
  var u = String(url || '').trim();
  if (!u) throw new Error(label + 'の URL（' + prop + '）が未設定です');
  if (!/^https:\/\/script\.google\.com\/(a\/macros\/[^\/]+|macros)\/s\/[\w-]+\/(exec|dev)(\?.*)?$/.test(u)) {
    throw new Error(prop + ' が ' + label + ' GAS のウェブアプリ URL ではありません（今の値：' + u.slice(0, 60) + (u.length > 60 ? '…' : '') +
      '）。GAS エディタの「デプロイ → デプロイを管理」に出る https://script.google.com/macros/s/…/exec を入れてください');
  }
  if (/\/dev(\?|$)/.test(u)) throw new Error(prop + ' がテスト用の URL（…/dev）です。「デプロイを管理」の …/exec の URL を入れてください');
  return u;
}
function describeNonJson_(label, res) {
  var code = res.getResponseCode();
  var text = String(res.getContentText() || '');
  var h = res.getAllHeaders ? res.getAllHeaders() : {};
  var ctype = String(h['Content-Type'] || h['content-type'] || '');
  var title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  var plain = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  var why;
  if (/accounts\.google\.com|ServiceLogin|Sign in|ログイン/i.test(text)) why = 'Google のログイン画面が返りました。' + label + ' GAS のデプロイの「アクセスできるユーザー」が「全員」になっていないか、別の Google アカウントのものです';
  else if (/Script function not found|スクリプト関数が見つかりません/i.test(text)) why = label + ' GAS に doPost がありません（URL が別のプロジェクトのもの？）';
  else if (/need permission|権限が必要|アクセス権がありません|You need access/i.test(text)) why = label + ' GAS へのアクセス権がありません（デプロイの「アクセスできるユーザー」を確認）';
  else if (/^(エラー|Error)$/i.test(title.trim()) || /TypeError|ReferenceError|SyntaxError|Exception:/.test(plain)) why = label + ' GAS の中でエラーが起きました：' + plain.slice(0, 160);
  else why = label + ' が JSON ではない応答を返しました' + (title ? '（ページの題名：' + title.trim().slice(0, 60) + '）' : '');
  return why + '［HTTP ' + code + (ctype ? '・' + ctype.split(';')[0] : '') + '・先頭：' + plain.slice(0, 80) + '］';
}
function webAppFetch_(label, url, opt) {
  var o = Object.assign({ muteHttpExceptions: true, followRedirects: true }, opt || {});
  o.headers = Object.assign({}, o.headers || {});
  if (/^https:\/\/script\.google\.com\//.test(url)) o.headers.Authorization = 'Bearer ' + ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(url, o);
  try { return JSON.parse(res.getContentText()); }
  catch (e) { throw new Error(describeNonJson_(label, res)); }
}
function spotcho_(action, payload) {
  var url = checkExecUrl_('スポット帳', 'SPOTCHO_URL', prop_('SPOTCHO_URL'));
  var body = { action: action, pin: prop_('SPOTCHO_PIN', '') };
  for (var k in payload) body[k] = payload[k];
  var j = webAppFetch_('スポット帳', url, { method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body) });
  if (j.status !== 'ok') {
    if (j.code === 'AUTH') throw new Error('スポット帳のPINが一致しません（SPOTCHO_PIN をスポット帳GASの SECRET_PIN と同じにしてください）');
    var err = new Error(j.message || ('スポット帳：' + (j.code || j.status)));
    err.code = j.code;
    throw err;
  }
  return j;
}
function splitSlash_(v) { return String(v || '').split('/').map(function (x) { return x.trim(); }).filter(String); }
// スポット帳の訪問記録 → 旅帳の形（写真・何を・金額など、旅帳で扱わない項目があるかも返す）
function spotVisit_(v) {
  return {
    visitId: v.visit_id, date: v.date, rating: Number(v.rating) || 0, comment: v.comment || '',
    companions: String(v.companions || '').split(/[、,，・\/]/).map(function (x) { return x.trim(); }).filter(String),
    people: v.people || '', updatedAt: v.updated_at || '',
    hasExtras: !!(v.photos || v.menu || v.price || v.repeat)
  };
}
// スポット帳のスポット → 旅帳の形
var MUST_TAG = '絶対行きたい';
function spotOut_(s, visits) {
  var tags = splitSlash_(s.tags), regions = splitSlash_(s.regions);
  return {
    id: String(s.id), name: s.name, lat: s.lat === '' ? null : Number(s.lat), lng: s.lng === '' ? null : Number(s.lng),
    address: s.address || '', prefecture: s.prefecture || '', city: s.city || '',
    area: regions[0] || s.city || s.prefecture || '',
    tags: tags.concat(regions).filter(function (t) { return t !== MUST_TAG; }),
    categories: s.categories || '',
    status: s.status === '行った' ? 'visited' : 'want',
    priority: tags.indexOf(MUST_TAG) >= 0 || regions.indexOf(MUST_TAG) >= 0 ? 'must' : null,
    placeId: s.place_id || '', url: s.maps_url || '', memo: s.memo || '',
    updatedAt: s.updated_at || '',
    visits: (visits || []).filter(function (v) { return String(v.spot_id) === String(s.id); }).map(spotVisit_)
  };
}
function spotAll_() {
  var r = spotcho_('getAll', {});
  return { spots: r.spots || [], visits: r.visits || [], serverDate: r.serverDate };
}
API.spotList = function () {
  var all = spotAll_();
  return { ok: true, spots: all.spots.map(function (s) { return spotOut_(s, all.visits); }), serverTime: all.serverDate };
};
// 「行った」の書き戻し：visit あり＝追加（visitId があれば更新）、visit が null＝取り消し（visitId の訪問を消す）
API.spotSetVisited = function (a) {
  var spotId = String(a.spotId);
  var visitId = a.visitId ? String(a.visitId) : '';
  if (!a.visit) {
    if (!visitId) return { ok: true, spot: null };
    var all = spotAll_();
    var cur = all.visits.filter(function (v) { return v.visit_id === visitId; })[0];
    if (cur) {
      // スポット帳で写真・何を・金額などを書き足した訪問は、思い出を消さないよう旅帳からは消さない
      if (spotVisit_(cur).hasExtras && !a.force) throw new Error('スポット帳で写真や金額などが書き足されているため、旅帳からは取り消せません（スポット帳で削除してください）');
      spotcho_('deleteVisit', { visit_id: visitId, deletePhotos: false });
    }
    return { ok: true, spot: spotAfter_(spotId) };
  }
  var v = a.visit;
  var rating = Math.round(Number(v.rating) || 0);
  if (rating < 1 || rating > 5) throw new Error('評価（1〜5）を選んでください');
  var fields = {
    spot_id: spotId, date: String(v.date), rating: String(rating), comment: String(v.comment || ''),
    companions: (v.companions || []).join('、'), people: v.people ? String(v.people) : ''
  };
  if (visitId) {
    var all2 = spotAll_();
    var old = all2.visits.filter(function (x) { return x.visit_id === visitId; })[0];
    if (old) {
      // スポット帳でしか扱わない項目（何を・金額・写真・また行きたいか）はそのまま残す
      var merged = {};
      for (var k in old) merged[k] = old[k];
      for (var k2 in fields) merged[k2] = fields[k2];
      var u = spotcho_('updateVisit', { visit: merged });
      return { ok: true, visitId: visitId, spot: spotAfter_(spotId) };
    }
  }
  var r = spotcho_('addVisit', { visit: { spot_id: fields.spot_id, date: fields.date, rating: fields.rating, menu: '', price: '', companions: fields.companions, people: fields.people, comment: fields.comment, photos: '', repeat: '' } });
  return { ok: true, visitId: r.visit.visit_id, spot: spotAfter_(spotId) };
};
function spotAfter_(spotId) {
  var all = spotAll_();
  var s = all.spots.filter(function (x) { return String(x.id) === spotId; })[0];
  return s ? spotOut_(s, all.visits) : null;
}
API.spotCreate = function (a) {
  var sp = a.spot || {};
  var r = spotcho_('addSpot', { spot: {
    name: sp.name, address: sp.address || '', lat: sp.lat == null ? '' : sp.lat, lng: sp.lng == null ? '' : sp.lng,
    coord_source: sp.lat != null ? '旅帳' : '', memo: '旅帳から登録' + (sp.memo ? '：' + sp.memo : ''),
    tags: sp.priority === 'must' ? MUST_TAG : ''
  } });
  return { ok: true, spot: spotOut_(r.spot, []) };
};

// ---------------------------------------------------------------------------
// 営業時間（スポット帳には無いので、place_id から Google Places API（New）で取る。6時間キャッシュ）
// ---------------------------------------------------------------------------
function placeHours_(placeId, key) {
  var res = UrlFetchApp.fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=ja', {
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'regularOpeningHours' }, muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 400) return null;
  var j = JSON.parse(res.getContentText());
  var oh = j.regularOpeningHours;
  if (!oh || !oh.periods || !oh.periods.length) return null;
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var week = {};
  for (var d = 0; d < 7; d++) week[d] = 'closed'; // 期間に出てこない曜日は定休
  oh.periods.forEach(function (p) {
    var o = p.open; if (!o) return;
    if (!p.close) { for (var i = 0; i < 7; i++) week[i] = [['00:00', '24:00']]; return; } // 24時間営業
    var c = p.close;
    var openMin = o.hour * 60 + (o.minute || 0);
    var closeMin = c.hour * 60 + (c.minute || 0) + ((c.day - o.day + 7) % 7) * 1440;
    if (closeMin <= openMin) closeMin += 1440;
    var close = Math.floor(closeMin / 60) + ':' + p2(closeMin % 60);
    if (week[o.day] === 'closed') week[o.day] = [];
    week[o.day].push([p2(o.hour) + ':' + p2(o.minute || 0), close]);
  });
  return week;
}
API.placeHours = function (a) {
  var key = prop_('PLACES_API_KEY');
  if (!key) return { ok: true, hours: {}, note: 'PLACES_API_KEY 未設定のため営業時間は取得していません' };
  var cache = CacheService.getScriptCache();
  var out = {};
  (a.spots || []).slice(0, 40).forEach(function (s) {
    if (!s || !s.placeId) return;
    var ck = 'oh:' + s.placeId;
    var c = cache.get(ck);
    if (c) { out[s.id] = JSON.parse(c); return; }
    var w = null;
    try { w = placeHours_(s.placeId, key); } catch (e) {}
    out[s.id] = w;
    cache.put(ck, JSON.stringify(w), 6 * 3600);
  });
  return { ok: true, hours: out };
};

// ---------------------------------------------------------------------------
// 家計簿（ほしいもの帳→家計簿と同じ方式。家計簿GAS v7.0 は変更不要）
//   1) loadAll（PIN付き GET）で明細と rev を読む
//   2) 旅帳の明細を足す：用途・予算区分を catLock="1" で固定、src="tabicho"、srcRef で二重送信を防ぐ
//   3) 明細一式を baseRev 付きで POST（家計簿GASが保存前に Logs を10世代バックアップする）
//      別の端末が先に保存していたら（conflict）読み直してやり直す
// ---------------------------------------------------------------------------
function kakeiboCfg_() {
  var url = checkExecUrl_('家計簿', 'KAKEIBO_URL', prop_('KAKEIBO_URL')), pin = prop_('KAKEIBO_PIN');
  if (!pin) throw new Error('家計簿のPIN（KAKEIBO_PIN）が未設定です');
  return { url: url, pin: pin };
}
function kakeiboFetch_(url, opt) {
  var j = webAppFetch_('家計簿', url, opt);
  if (j.status === 'unauthorized') throw new Error('家計簿のPINが一致しません（KAKEIBO_PIN を家計簿GASの SECRET_PIN と同じにしてください）');
  return j;
}
function kakeiboGet_(action, year) {
  var c = kakeiboCfg_();
  return kakeiboFetch_(c.url + '?pin=' + encodeURIComponent(c.pin) + '&action=' + encodeURIComponent(action) + (year ? '&year=' + year : ''));
}
// ほしいもの帳 GAS v1.0.1 と同じ作り方：既存明細の列をひな形にし、引落日などの派生項目も家計簿 evaluateEntry と同じ計算で入れる
function kkIsActive_(v) { return v === undefined || v === null || v === '' || v === 1 || v === true || String(v) === '1' || String(v).toUpperCase() === 'TRUE'; }
function kkFmt_(dt) { return dt.getFullYear() + '-' + ('0' + (dt.getMonth() + 1)).slice(-2) + '-' + ('0' + dt.getDate()).slice(-2); }
function kkNormYMD_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd');
  var m = String(v == null ? '' : v).trim().match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2) : String(v || '');
}
function kkIsHoliday_(dt, set) {
  var w = dt.getDay();
  if (w === 0 || w === 6) return true;
  return !!(set && set[kkFmt_(dt)]);
}
function kkCalcPayDate_(m, ymd, holidays) {
  var p = ymd.split('-').map(Number);
  var y = p[0], mo = p[1], d = p[2];
  var closeDay = Number(m.closeDay) || 0, payDay = Number(m.payDay) || 0, off = Number(m.payMonthOffset) || 0;
  var dt = new Date(y, mo - 1, d);
  var adjust = m.adjust === undefined || m.adjust === null || String(m.adjust) === '' ? ((m.bigCat === '支出（クレカ）' || m.bigCat === '固定引落') ? 'next' : 'none') : String(m.adjust);
  var set = null;
  if (Array.isArray(holidays) && holidays.length) { set = {}; holidays.forEach(function (h) { set[kkNormYMD_(h)] = true; }); }
  var shift = function (x) {
    if (adjust === 'none') return x;
    var cur = new Date(x.getFullYear(), x.getMonth(), x.getDate()), g = 0;
    while (kkIsHoliday_(cur, set) && g++ < 15) cur.setDate(cur.getDate() + (adjust === 'prev' ? -1 : 1));
    return cur;
  };
  if (m.bigCat === '支出（クレカ）' && closeDay > 0 && payDay > 0) {
    var tm = mo + off; if (d > closeDay) tm += 1;
    dt = shift(new Date(y, tm - 1, payDay));
  } else if (m.bigCat === '固定引落' && payDay > 0) {
    dt = shift(new Date(y, mo - 1, payDay));
  }
  return kkFmt_(dt);
}
function kakeiboRows_(data, logs) {
  var existing = data.logs || [];
  var cats = {};
  (data.categories || []).forEach(function (c) { if (c && kkIsActive_(c.active)) cats[String(c.name)] = c; });
  var hasCats = Object.keys(cats).length > 0;
  var have = {};
  var maxId = 0;
  existing.forEach(function (l) {
    if (String(l.src) === 'tabicho' && l.srcRef) have[String(l.srcRef)] = true;
    maxId = Math.max(maxId, Number(l.id) || 0);
  });
  var tmplKeys = Object.keys(existing[0] || {});
  var nextId = Math.max(maxId + 1, Date.now());
  var rows = [], keys = [], skipped = 0, bad = [];
  (logs || []).forEach(function (l) {
    if (!l.sourceKey) return;
    keys.push(l.sourceKey);
    if (have[l.sourceKey]) { skipped++; return; }
    var date = String(l.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { bad.push('日付が不正：' + l.memo); return; }
    var m = cats[String(l.category)];
    if (hasCats && !m) { bad.push('カテゴリー「' + l.category + '」が家計簿の有効なマスタにありません'); return; }
    have[l.sourceKey] = true;
    var amt = Math.round(Number(l.amount) || 0);
    var row = {};
    tmplKeys.forEach(function (k) { row[k] = ''; });
    var payDate = m ? kkCalcPayDate_(m, date, data.holidays) : date;
    Object.assign(row, {
      id: nextId++, amount: amt, absAmount: Math.abs(amt), date: date, useDate: date, useYM: date.slice(0, 7),
      payDate: payDate, payYM: payDate.slice(0, 7), bigCat: m ? String(m.bigCat || '') : '',
      memo: String(l.memo || ''), category: String(l.category || ''), ruleId: '', isLegacy: '',
      src: 'tabicho', srcRef: String(l.sourceKey)
    });
    // 用途が決まっている行（支出）は区分を固定。割り勘の収入は家計簿のカテゴリー判定に任せる
    if (l.usage) { row.catLock = '1'; row.usageCat = String(l.usage); row.budgetCat = String(l.budget || ''); }
    else if (m && ['純収入', '精算・移動', '貯蓄移動', '投資移動'].indexOf(String(m.bigCat)) >= 0) {
      row.usageCat = String(m.name).replace('（引出）', ''); row.budgetCat = String(m.bigCat);
    }
    rows.push(row);
  });
  return { rows: rows, keys: keys, skipped: skipped, bad: bad };
}
API.kakeiboSend = function (a) {
  var c = kakeiboCfg_();
  var lastMsg = '';
  // 祝日は「指定年の前年1月〜翌年12月」が返るので、送る明細の最も新しい年を渡す（年をまたぐ引落日の休日調整のため）
  var year = (a.logs || []).reduce(function (y, l) { return Math.max(y, Number(String(l.date || '').slice(0, 4)) || 0); }, 0) || '';
  for (var attempt = 0; attempt < 3; attempt++) {
    var data = kakeiboGet_('loadAll', year);
    if (data.status !== 'ok') throw new Error('家計簿を読み込めません：' + (data.message || data.status));
    var existing = data.logs;
    if (!Array.isArray(existing)) throw new Error('家計簿の応答に明細（logs）がありません');
    // 読み込みに失敗して0件で返ってきた時に、家計簿の明細を旅帳の分だけで上書きしない（ほしいもの帳と同じ守り）
    if (!existing.length) throw new Error('家計簿の明細が0件で返ってきたため、書き込みを中止しました');
    var r = kakeiboRows_(data, a.logs);
    if (r.bad.length) throw new Error('家計簿へ送れない明細があります：' + r.bad.join('／'));
    if (!r.rows.length) return { ok: true, sent: 0, skipped: r.skipped, keys: r.keys };
    var next = existing.concat(r.rows);
    if (next.length !== existing.length + r.rows.length) throw new Error('件数チェックに失敗しました');
    var res = kakeiboFetch_(c.url, {
      method: 'post', contentType: 'text/plain;charset=utf-8',
      payload: JSON.stringify({ pin: c.pin, baseRev: data.rev, logs: next })
    });
    if (res.status === 'saved') return { ok: true, sent: r.rows.length, skipped: r.skipped, keys: r.keys, rev: res.rev };
    lastMsg = res.message || res.reason || res.status;
    if (res.status !== 'conflict' && res.status !== 'busy') break;
    Utilities.sleep(1500 * (attempt + 1));
  }
  throw new Error('家計簿へ保存できませんでした：' + lastMsg);
};

// ---------------------------------------------------------------------------
// 経路（Google Maps）：距離・所要時間・高速料金の概算・電車運賃
// ---------------------------------------------------------------------------
function haversine_(a, b) {
  var R = 6371, t = Math.PI / 180;
  var dLat = (b.lat - a.lat) * t, dLng = (b.lng - a.lng) * t;
  var x = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
function estimate_(q) {
  var km = haversine_(q.from, q.to);
  var mode = q.mode || 'car';
  var min = mode === 'plane' ? km / 650 * 60 + 90 : mode === 'ferry' ? km / 30 * 60 + 30 : mode === 'train' ? km * 1.3 / 45 * 60 + 15 : km * 1.35 / 40 * 60;
  return { km: Math.round(km * 1.35 * 10) / 10, min: Math.round(min), estimated: true };
}
function route_(q) {
  if (q.mode === 'plane' || q.mode === 'ferry') return estimate_(q);
  var df = Maps.newDirectionFinder().setOrigin(q.from.lat, q.from.lng).setDestination(q.to.lat, q.to.lng).setLanguage('ja').setRegion('jp');
  var opt = q.opt || {};
  if (q.mode === 'train') { df.setMode(Maps.DirectionFinder.Mode.TRANSIT).setDepart(new Date()); }
  else {
    df.setMode(Maps.DirectionFinder.Mode.DRIVING);
    var avoid = [];
    if (opt.highway === false) avoid.push('highways');
    if (opt.toll === false) avoid.push('tolls');
    if (avoid.length) df.setAvoid(avoid.join('|'));
  }
  var res = df.getDirections();
  if (!res || res.status !== 'OK' || !res.routes || !res.routes.length) return estimate_(q);
  var route = res.routes[0];
  var m = 0, s = 0, tollM = 0;
  route.legs.forEach(function (leg) {
    m += leg.distance.value; s += leg.duration.value;
    (leg.steps || []).forEach(function (st) {
      var ins = String(st.html_instructions || '');
      if (/有料|自動車道|高速|ハイウェイ|Expressway|Expwy|Toll/i.test(ins)) tollM += st.distance.value;
    });
  });
  var out = { km: Math.round(m / 100) / 10, min: Math.round(s / 60) };
  if (q.mode !== 'train' && opt.highway !== false && opt.toll !== false && tollM > 0) {
    out.toll = Math.round((150 + tollM / 1000 * 24.6) / 10) * 10; // 普通車の概算
  }
  if (route.fare && route.fare.value != null) out.fare = route.fare.value;
  return out;
}
API.routes = function (a) {
  var cache = CacheService.getScriptCache();
  var results = (a.list || []).slice(0, 25).map(function (q) {
    if (!q || !q.from || !q.to || q.from.lat == null || q.to.lat == null) return null;
    var key = 'rt:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(q)));
    var c = cache.get(key);
    if (c) return JSON.parse(c);
    var r;
    try { r = route_(q); } catch (e) { r = estimate_(q); r.error = String(e.message || e); }
    cache.put(key, JSON.stringify(r), 6 * 3600);
    return r;
  });
  return { ok: true, results: results };
};

API.geocode = function (a) {
  var r = Maps.newGeocoder().setLanguage('ja').setRegion('jp').geocode(a.address || '');
  if (r.status !== 'OK' || !r.results.length) return { ok: true, result: null, note: '見つかりませんでした' };
  var g = r.results[0];
  return { ok: true, result: { lat: g.geometry.location.lat, lng: g.geometry.location.lng, address: g.formatted_address } };
};
API.countryOf = function (a) {
  var r = Maps.newGeocoder().setLanguage('ja').reverseGeocode(a.lat, a.lng);
  var code = null, name = '';
  if (r.status === 'OK') {
    r.results.some(function (res) {
      return (res.address_components || []).some(function (c) {
        if (c.types.indexOf('country') >= 0) { code = c.short_name; name = c.long_name; return true; }
        return false;
      });
    });
  }
  return { ok: true, country: code, name: name };
};

// ---------------------------------------------------------------------------
// 天気（Open-Meteo・キー不要）／為替（open.er-api.com・キー不要）
// ---------------------------------------------------------------------------
API.weather = function (a) {
  var cache = CacheService.getScriptCache();
  var out = {}, need = [];
  (a.points || []).slice(0, 20).forEach(function (p) {
    var k = Number(p.lat).toFixed(1) + ',' + Number(p.lng).toFixed(1);
    var c = cache.get('wx2:' + k);   // v2.0.4：日付の基準を変えたので、前の版のキャッシュ（wx:）は使わない
    if (c) out[k] = JSON.parse(c); else need.push({ k: k, p: p });
  });
  if (need.length) {
    var reqs = need.map(function (n) {
      return { url: 'https://api.open-meteo.com/v1/forecast?latitude=' + n.p.lat + '&longitude=' + n.p.lng + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16', muteHttpExceptions: true };   // v2.0.4：日付は地点の現地の日付（旅のタイムゾーンとそろう）
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (res, i) {
      try {
        var j = JSON.parse(res.getContentText());
        var arr = j.daily.time.map(function (d, k) { return { date: d, code: j.daily.weather_code[k], tmax: j.daily.temperature_2m_max[k], tmin: j.daily.temperature_2m_min[k], pop: j.daily.precipitation_probability_max[k] }; });
        out[need[i].k] = arr;
        cache.put('wx2:' + need[i].k, JSON.stringify(arr), 3600);
      } catch (e) {}
    });
  }
  return { ok: true, weather: out };
};
API.fxRates = function () {
  var cache = CacheService.getScriptCache();
  var c = cache.get('fx:JPY');
  if (c) return JSON.parse(c);
  var j = JSON.parse(UrlFetchApp.fetch('https://open.er-api.com/v6/latest/JPY').getContentText());
  var toJpy = {};
  Object.keys(j.rates).forEach(function (k) { toJpy[k] = 1 / j.rates[k]; });
  var out = { ok: true, base: 'JPY', toJpy: toJpy, at: j.time_last_update_utc };
  cache.put('fx:JPY', JSON.stringify(out), 3600);
  return out;
};

// ---------------------------------------------------------------------------
// 勤務カレンダーから休み（連休）を検出
// ---------------------------------------------------------------------------
function ymd_(d) { return Utilities.formatDate(d, 'Asia/Tokyo', 'yyyy-MM-dd'); }
// 家計簿GASと同じ見分け方：勤務マスタ（残業時間管理ブック）にある予定名＝勤務。夜勤（翌日終了）は明けの日も持つ
function normTitle_(s) { return String(s || '').normalize('NFKC').replace(/\s+/g, '').trim(); }
function readShiftMaster_() {
  var id = prop_('SHIFT_MASTER_SS_ID');
  if (!id) return null;
  var sh = SpreadsheetApp.openById(id).getSheetByName('勤務マスタ');
  if (!sh) throw new Error('残業時間管理ブックに「勤務マスタ」タブがありません');
  var rows = sh.getDataRange().getValues();
  var master = {};
  for (var i = 2; i < rows.length; i++) {
    var name = normTitle_(rows[i][0]);
    if (!name) break;
    master[name] = { name: String(rows[i][0]).trim(), nextDay: String(rows[i][3]).trim() === 'はい', kubun: String(rows[i][4] || '').trim() };
  }
  return master;
}
function shiftDays_(from, to, master, offRe) {
  var workId = prop_('WORK_CALENDAR_ID');
  var cal = workId ? CalendarApp.getCalendarById(workId) : CalendarApp.getDefaultCalendar();
  var work = {}, offMark = {}, ake = {};
  // 夜勤が前日から続く分も拾うため1日前から読む
  cal.getEvents(new Date(from.getTime() - 86400000), to).forEach(function (ev) {
    var m = master[normTitle_(ev.getTitle())];
    if (!m) return; // 勤務マスタに無い予定（私用など）は勤務として数えない
    var s = ev.getStartTime();
    var day = ymd_(s);
    // 終日で入った夜勤は「終わる日」に書かれている前提（家計簿GASと同じ）
    if (m.nextDay && ev.isAllDayEvent()) day = ymd_(new Date(s.getTime() - 86400000));
    if (offRe.test(m.name) || offRe.test(m.kubun)) { offMark[day] = m.name; return; }
    work[day] = m.name;
    if (m.nextDay) { var nd = ymd_(new Date(new Date(day + 'T12:00:00+09:00').getTime() + 86400000)); ake[nd] = m.name + '明け'; }
  });
  return { cal: cal, work: work, offMark: offMark, ake: ake };
}
API.holidayBlocks = function (a) {
  var from = new Date(a.from + 'T00:00:00+09:00'), to = new Date(a.to + 'T23:59:59+09:00');
  var workId = prop_('WORK_CALENDAR_ID');
  var offRe = new RegExp(prop_('WORK_OFF_REGEX', '休|公休|有給|有休|OFF|オフ'), 'i');
  var emptyIsOff = String(prop_('WORK_EMPTY_IS_OFF', 'true')) !== 'false';
  var akeIsOff = String(prop_('SHIFT_AKE_IS_OFF', 'false')) === 'true';
  var hol = {};
  try {
    CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com').getEvents(from, to).forEach(function (e) { hol[ymd_(e.getStartTime())] = e.getTitle(); });
  } catch (e) {}
  var master = readShiftMaster_();
  if (master) {
    var sd = shiftDays_(from, to, master, offRe);
    var out = [];
    for (var dd = new Date(from); dd <= to; dd = new Date(dd.getTime() + 86400000)) {
      var key = ymd_(dd);
      var off2, why = '';
      if (sd.work[key]) { off2 = false; why = sd.work[key]; }
      else if (sd.ake[key]) { off2 = akeIsOff; why = sd.ake[key]; }
      else if (sd.offMark[key]) { off2 = true; why = sd.offMark[key]; }
      else { off2 = emptyIsOff; why = off2 ? '勤務なし' + (hol[key] ? '（' + hol[key] + '）' : '') : ''; }
      out.push({ date: key, off: off2, reason: why });
    }
    return { ok: true, days: out, source: '勤務マスタ × カレンダー「' + sd.cal.getName() + '」' };
  }
  var byDay = {};
  var cal = workId ? CalendarApp.getCalendarById(workId) : null;
  if (cal) {
    cal.getEvents(from, to).forEach(function (e) {
      var s = e.getStartTime(), en = e.getEndTime();
      for (var d = new Date(s); d < en || ymd_(d) === ymd_(s); d = new Date(d.getTime() + 86400000)) {
        var k = ymd_(d);
        (byDay[k] = byDay[k] || []).push(e.getTitle());
        if (!e.isAllDayEvent()) break;
      }
    });
  }
  var days = [];
  for (var d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
    var k = ymd_(d), w = Number(Utilities.formatDate(d, 'Asia/Tokyo', 'u')) % 7;
    var off, reason = '';
    if (cal) {
      var ev = byDay[k] || [];
      if (ev.some(function (t) { return offRe.test(t); })) { off = true; reason = ev.join('・'); }
      else if (ev.length) off = false;
      else { off = emptyIsOff; reason = off ? '勤務予定なし' : ''; }
    } else {
      off = w === 0 || w === 6 || !!hol[k];
      reason = hol[k] || (off ? '週末' : '');
    }
    days.push({ date: k, off: off, reason: reason });
  }
  return { ok: true, days: days, source: cal ? '勤務カレンダー：' + cal.getName() : '土日祝（勤務カレンダー未設定）' };
};

// ---------------------------------------------------------------------------
// カレンダー登録（予約ごとのボタン式・タイトル＋日時だけ）
// ---------------------------------------------------------------------------
API.calendarAdd = function (a) {
  var id = prop_('TRAVEL_CALENDAR_ID');
  var cal = id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  var ev;
  // v2.0.3：時刻は旅の現地のタイムゾーン（海外の旅で「現地 10:00」と入れたら現地 10:00 の予定になる）
  var tz = String(a.timeZone || 'Asia/Tokyo');
  if (a.start) {
    var s;
    try { s = Utilities.parseDate(a.date + ' ' + a.start, tz, 'yyyy-MM-dd HH:mm'); }
    catch (err) { tz = 'Asia/Tokyo'; s = Utilities.parseDate(a.date + ' ' + a.start, tz, 'yyyy-MM-dd HH:mm'); }
    var dur = Number(a.durationMin) > 0 ? Number(a.durationMin) : 60;
    var e = new Date(s.getTime() + dur * 60000);   // 日をまたいでも正しい
    var opt = {};
    if (a.location) opt.location = a.location;
    if (tz !== 'Asia/Tokyo') opt.description = '現地時刻 ' + a.date + ' ' + a.start + '（' + tz + '）';
    ev = cal.createEvent(a.title, s, e, opt);
  } else {
    ev = cal.createAllDayEvent(a.title, new Date(a.date + 'T00:00:00+09:00'), a.location ? { location: a.location } : {});
  }
  return { ok: true, eventId: ev.getId() };
};

API.testConnections = function () {
  var r = {};
  try { spotcho_('ping', {}); r.spotcho = { ok: true, note: 'PIN OK' + (prop_('PLACES_API_KEY') ? ' ／ 営業時間：Places APIキー設定済' : ' ／ 営業時間：PLACES_API_KEY 未設定' ) }; } catch (e) { r.spotcho = { ok: false, error: String(e.message || e) }; }
  // 家計簿：存在しない action を投げると、PIN が合っていれば「不明な action」、違えば unauthorized が返る（データに触れない）
  try { var k = kakeiboGet_('tabichoPing'); r.kakeibo = { ok: k.status === 'error' || k.status === 'ok', note: 'PIN OK' }; }
  catch (e) { r.kakeibo = { ok: false, error: String(e.message || e) }; }
  try {
    var m0 = readShiftMaster_();
    r.calendar = { ok: true, note: (prop_('TRAVEL_CALENDAR_ID') ? CalendarApp.getCalendarById(prop_('TRAVEL_CALENDAR_ID')) : CalendarApp.getDefaultCalendar()).getName() + (m0 ? ' ／ 勤務マスタ ' + Object.keys(m0).length + '件' : (prop_('WORK_CALENDAR_ID') ? ' ／ 勤務カレンダー：設定済' : ' ／ 勤務：未設定（土日祝で判定）')) };
  }
  catch (e) { r.calendar = { ok: false, error: String(e.message || e) }; }
  try { var mf = childFolder_(DriveApp.getRootFolder(), MEDIA_ROOT); r.media = { ok: true, note: 'Drive「' + mf.getName() + '」フォルダOK' }; } catch (e) { r.media = { ok: false, error: String(e.message || e) }; }
  try { var m = route_({ from: { lat: 34.8556, lng: 136.4517 }, to: { lat: 34.6851, lng: 135.843 }, mode: 'car' }); r.maps = { ok: !m.estimated, note: m.km + 'km・' + m.min + '分' }; }
  catch (e) { r.maps = { ok: false, error: String(e.message || e) }; }
  return r;
};

// ===========================================================================
// v2.0 メディア（写真・動画を Drive に保存。旅帳は fileId とメタ情報だけを持つ）
//   方式は旅帳PoC v0.1（実機検証済み：iOS 18.7 Safari）：
//   GAS が Origin 付きで Drive の resumable セッションを発行 → 画面が直接 PUT。
//   画面に渡すのはセッション URI だけで、Google のアクセストークンは渡さない
//   フォルダ：旅帳 ／ 年 ／ 国内・海外 ／ 旅行名（写真・動画を混在。サブフォルダなし）
// ===========================================================================
var MEDIA_ROOT = '旅帳';
var DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
var DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files/';
var MEDIA_FIELDS = 'id,name,mimeType,size,createdTime,hasThumbnail,trashed,imageMediaMetadata(time,width,height,rotation,location),videoMediaMetadata(width,height,durationMillis)';

function childFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function folderName_(s) { return String(s || '').replace(/[\/\\:*?"<>|]/g, '・').trim().slice(0, 80) || '旅'; }

// 旅のフォルダ（最初のメディア追加時に作成）。説明欄に旅IDを書き、フォルダIDを失っても同じフォルダを見つけられるようにする。
// 作成後は旅のタイトル・国内海外を変えてもフォルダは動かさない（M7）
function tripFolder_(f) {
  if (!f || !f.tripId) throw new Error('旅IDがありません');
  if (f.folderId) {
    try { var cur = DriveApp.getFolderById(f.folderId); if (!cur.isTrashed()) return cur; } catch (e) { /* 消えていたら作り直す */ }
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var root = childFolder_(DriveApp.getRootFolder(), MEDIA_ROOT);
    var year = childFolder_(root, f.year ? String(f.year) : '日程未定');
    var reg = childFolder_(year, f.region === 'overseas' ? '海外' : '国内');
    var tag = 'tabicho:' + f.tripId;
    var it = reg.getFolders();
    while (it.hasNext()) { var x = it.next(); if (x.getDescription() === tag && !x.isTrashed()) return x; }
    var base = folderName_(f.title), name = base, n = 2;
    while (reg.getFoldersByName(name).hasNext()) name = base + '（' + (n++) + '）';
    var made = reg.createFolder(name);
    made.setDescription(tag);
    return made;
  } finally { lock.releaseLock(); }
}

API.mediaSession = function (a) {
  if (!a.origin) throw new Error('画面の Origin がありません（Origin を送らないセッションは CORS で失敗するため発行しない）');
  var size = Number(a.size);
  if (!(size > 0)) throw new Error('ファイルサイズが不正です');
  var folder = tripFolder_(a.folder);
  var params = {
    method: 'post', contentType: 'application/json; charset=UTF-8', muteHttpExceptions: true, followRedirects: false,
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      'X-Upload-Content-Type': String(a.mimeType || 'application/octet-stream'),
      'X-Upload-Content-Length': String(size),
      Origin: String(a.origin)
    },
    payload: JSON.stringify({ name: String(a.name || 'media'), parents: [folder.getId()] })
  };
  var res = UrlFetchApp.fetch(DRIVE_UPLOAD_URL + '?uploadType=resumable&fields=' + encodeURIComponent(MEDIA_FIELDS), params);
  var h = res.getAllHeaders();
  var loc = h.Location || h.location || '';
  if (res.getResponseCode() !== 200 || !loc) throw new Error('アップロードの準備に失敗しました（HTTP ' + res.getResponseCode() + '）' + res.getContentText().slice(0, 200));
  return { ok: true, sessionUri: loc, folderId: folder.getId(), folderName: folder.getName() };
};

// 受信済み位置の確認（画面で 308 の Range が読めない時の保険）
API.mediaStatus = function (a) {
  var res = UrlFetchApp.fetch(String(a.sessionUri), {
    method: 'put', headers: { 'Content-Range': 'bytes */' + Number(a.size) }, payload: '', muteHttpExceptions: true, followRedirects: false
  });
  var h = res.getAllHeaders(), code = res.getResponseCode();
  var file = null;
  if (code === 200 || code === 201) { try { file = JSON.parse(res.getContentText()); } catch (e) {} }
  return { ok: true, code: code, range: h.Range || h.range || '', file: file };
};

// 小さい写真（〜5MB）の代替路：base64 で GAS に送り、GAS が保存
API.mediaSmallUpload = function (a) {
  var folder = tripFolder_(a.folder);
  var bytes = Utilities.base64Decode(String(a.b64 || ''));
  if (bytes.length > 6 * 1024 * 1024) throw new Error('GAS 経由で送れるのは 5MB までです');
  var f = folder.createFile(Utilities.newBlob(bytes, String(a.mimeType || 'application/octet-stream'), String(a.name || 'photo')));
  return { ok: true, file: { id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: String(f.getSize()) }, folderId: folder.getId(), folderName: folder.getName() };
};

function exifTime_(t) { // "2026:11:24 10:23:11" → "2026-11-24T10:23:11"
  var m = String(t || '').match(/^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00') : '';
}
function mediaMetaOut_(j) {
  var im = j.imageMediaMetadata || {}, vm = j.videoMediaMetadata || {};
  return {
    id: j.id, name: j.name, mimeType: j.mimeType, size: Number(j.size) || 0, createdTime: j.createdTime || '',
    takenAt: exifTime_(im.time), width: im.width || vm.width || null, height: im.height || vm.height || null,
    durationMs: vm.durationMillis ? Number(vm.durationMillis) : null, hasThumbnail: !!j.hasThumbnail,
    videoReady: !!j.videoMediaMetadata, trashed: !!j.trashed,
    lat: im.location && im.location.latitude != null ? Number(im.location.latitude) : null,
    lng: im.location && im.location.longitude != null ? Number(im.location.longitude) : null
  };
}
// メタ情報（撮影日時＝EXIF、動画の長さ、サムネイルの有無）
API.mediaMeta = function (a) {
  var token = ScriptApp.getOAuthToken();
  var ids = (a.ids || []).slice(0, 30);
  var reqs = ids.map(function (id) { return { url: DRIVE_FILES_URL + encodeURIComponent(id) + '?fields=' + encodeURIComponent(MEDIA_FIELDS), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }; });
  var out = {};
  UrlFetchApp.fetchAll(reqs).forEach(function (r, i) {
    if (r.getResponseCode() === 200) out[ids[i]] = mediaMetaOut_(JSON.parse(r.getContentText()));
    else out[ids[i]] = { id: ids[i], missing: r.getResponseCode() === 404 };
  });
  return { ok: true, meta: out };
};

// サムネイル：GAS が自分の権限で取り、base64 で渡す（共有＝非公開のまま表示できる。PoC で確認済み）
API.mediaThumbs = function (a) {
  var token = ScriptApp.getOAuthToken();
  var size = Math.max(64, Math.min(2000, Number(a.size) || 400));
  var cache = CacheService.getScriptCache();
  var ids = (a.ids || []).slice(0, 16);
  var out = {}, need = [];
  ids.forEach(function (id) {
    var c = cache.get('th:' + id + ':' + size);
    if (c) out[id] = JSON.parse(c); else need.push(id);
  });
  if (!need.length) return { ok: true, thumbs: out };
  var metas = UrlFetchApp.fetchAll(need.map(function (id) {
    return { url: DRIVE_FILES_URL + encodeURIComponent(id) + '?fields=' + encodeURIComponent('thumbnailLink,' + MEDIA_FIELDS), headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
  }));
  var withLink = [];
  metas.forEach(function (r, i) {
    var id = need[i];
    if (r.getResponseCode() !== 200) { out[id] = { meta: { id: id, missing: r.getResponseCode() === 404 }, thumb: '' }; return; }
    var j = JSON.parse(r.getContentText());
    out[id] = { meta: mediaMetaOut_(j), thumb: '' };
    if (j.thumbnailLink) withLink.push({ id: id, url: String(j.thumbnailLink).replace(/=s\d+$/, '=s' + size) });
  });
  if (withLink.length) {
    UrlFetchApp.fetchAll(withLink.map(function (w) { return { url: w.url, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true }; })).forEach(function (r, i) {
      if (r.getResponseCode() !== 200) return;
      var b = r.getBlob();
      out[withLink[i].id].thumb = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    });
  }
  need.forEach(function (id) {
    // サムネイルができているものだけキャッシュ（動画は Drive の処理待ちで後からできる）
    // v2.0.3：一覧用の小さいサイズ（400 以下）だけ。大きい画像は 100KB の上限に当たって無駄になる
    if (size <= 400 && out[id] && out[id].thumb) { try { cache.put('th:' + id + ':' + size, JSON.stringify(out[id]), 6 * 3600); } catch (e) { /* 100KB 超は入れない */ } }
  });
  return { ok: true, thumbs: out };
};

// v2.0.2：写真の場所の名前（逆ジオコーディング。例「洲本市 小路谷」）。同じ場所はキャッシュ
API.placeNames = function (a) {
  var cache = CacheService.getScriptCache();
  var out = {};
  (a.points || []).slice(0, 20).forEach(function (p) {
    var key = Number(p.lat).toFixed(3) + ',' + Number(p.lng).toFixed(3);
    var c = cache.get('pn:' + key);
    if (c != null) { out[key] = c; return; }
    var name = '';
    try {
      var r = Maps.newGeocoder().setLanguage('ja').reverseGeocode(Number(p.lat), Number(p.lng));
      if (r.status === 'OK' && r.results.length) {
        var pick = function (types) {
          for (var i = 0; i < r.results.length; i++) {
            var cs = r.results[i].address_components || [];
            for (var j = 0; j < cs.length; j++) if (types.some(function (t) { return cs[j].types.indexOf(t) >= 0; })) return cs[j].long_name;
          }
          return '';
        };
        var poi = r.results.filter(function (x) { return (x.types || []).some(function (t) { return t === 'point_of_interest' || t === 'establishment' || t === 'tourist_attraction'; }); })[0];
        name = poi ? (poi.address_components[0] || {}).long_name || '' : '';
        if (!name) name = [pick(['locality']), pick(['sublocality_level_1', 'sublocality_level_2', 'neighborhood'])].filter(String).join(' ') || pick(['administrative_area_level_1', 'country']);
      }
    } catch (e) { name = ''; }
    out[key] = name;
    cache.put('pn:' + key, name, 21600);
  });
  return { ok: true, names: out };
};

// 旅帳でメディアを消したら Drive のファイルもゴミ箱へ（M4）
API.mediaTrash = function (a) {
  try { DriveApp.getFileById(String(a.fileId)).setTrashed(true); }
  catch (e) { if (!/not found|見つかりません|No item/i.test(String(e.message))) throw e; }
  return { ok: true };
};

// 英語タイトルの自動表示（V2）：未入力の時に旅のタイトルを英語化する（例：北海道旅行 → HOKKAIDO TRIP）
API.translateTitle = function (a) {
  var t = String(a.text || '').trim();
  if (!t) return { ok: true, text: '' };
  var cache = CacheService.getScriptCache();
  var key = 'tr:' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, t));
  var c = cache.get(key);
  if (c) return { ok: true, text: c };
  var en = LanguageApp.translate(t, 'ja', 'en');
  cache.put(key, en, 21600);
  return { ok: true, text: en };
};
