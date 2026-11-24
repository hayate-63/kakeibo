/**
 * 旅帳 サーバ（Google Apps Script）
 *
 * ウェブアプリとしてデプロイ：実行ユーザー＝自分／アクセス＝自分のみ（推奨）
 * スクリプトプロパティ（プロジェクトの設定 → スクリプト プロパティ）：
 *   TABICHO_SHEET_ID   保存先スプレッドシートID（未設定なら初回に自動作成して保存）
 *   SPOTCHO_URL        スポット帳GASのウェブアプリURL（/exec）
 *   SPOTCHO_PIN        スポット帳のPIN（画面側には出さない）
 *   KAKEIBO_URL        家計簿GASのウェブアプリURL（/exec）
 *   KAKEIBO_PIN        家計簿側でPINを確認する場合のみ
 *   WORK_CALENDAR_ID   勤務カレンダーのID（行き先提案の連休検出）
 *   WORK_OFF_REGEX     休みを表す予定名（既定：休|公休|有給|有休|OFF|オフ）
 *   WORK_EMPTY_IS_OFF  勤務カレンダーに予定が無い日を休みとみなすか（既定 true）
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
    var cur = readTrips_().filter(function (x) { return x.trip.id === trip.id; })[0];
    if (cur && !a.force && a.baseUpdatedAt && cur.trip.updatedAt > a.baseUpdatedAt) return { conflict: true, trip: cur.trip };
    trip.updatedAt = new Date().toISOString();
    var row = cur ? cur.row : sh.getLastRow() + 1;
    writeTripRow_(sh, row, trip);
    return { ok: true, updatedAt: trip.updatedAt };
  } finally { lock.releaseLock(); }
};

API.deleteTrip = function (a) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = db_().getSheetByName(TRIP_SHEET);
    var cur = readTrips_().filter(function (x) { return x.trip.id === a.id; })[0];
    if (cur) sh.deleteRow(cur.row);
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
function postJson_(url, body) {
  var res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'text/plain;charset=utf-8', payload: JSON.stringify(body),
    muteHttpExceptions: true, followRedirects: true
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  var j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('応答がJSONではありません（HTTP ' + code + '）。デプロイのアクセス権とURLを確認してください'); }
  if (j.error) throw new Error(j.error);
  if (j.ok === false) throw new Error(j.message || '失敗しました');
  return j;
}
function spotcho_(action, payload) {
  var url = prop_('SPOTCHO_URL');
  if (!url) throw new Error('スポット帳のURL（SPOTCHO_URL）が未設定です');
  var body = { action: 'tabicho.' + action, pin: prop_('SPOTCHO_PIN', '') };
  for (var k in payload) body[k] = payload[k];
  return postJson_(url, body);
}
API.spotList = function () { var r = spotcho_('list', {}); return { ok: true, spots: r.spots || [], serverTime: r.serverTime }; };
API.spotSetVisited = function (a) { var r = spotcho_('setVisited', { spotId: a.spotId, tripId: a.tripId, visit: a.visit }); return { ok: true, spot: r.spot }; };
API.spotCreate = function (a) { var r = spotcho_('create', { spot: a.spot }); return { ok: true, spot: r.spot }; };

// ---------------------------------------------------------------------------
// 家計簿（ほしいもの帳→家計簿と同じ API 連携。sourceKey で二重送信を防ぐ）
// ---------------------------------------------------------------------------
API.kakeiboSend = function (a) {
  var url = prop_('KAKEIBO_URL');
  if (!url) throw new Error('家計簿のURL（KAKEIBO_URL）が未設定です');
  var r = postJson_(url, { action: 'tabicho.appendLogs', pin: prop_('KAKEIBO_PIN', ''), logs: a.logs || [] });
  return { ok: true, sent: r.sent, skipped: r.skipped, keys: r.keys };
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
    var c = cache.get('wx:' + k);
    if (c) out[k] = JSON.parse(c); else need.push({ k: k, p: p });
  });
  if (need.length) {
    var reqs = need.map(function (n) {
      return { url: 'https://api.open-meteo.com/v1/forecast?latitude=' + n.p.lat + '&longitude=' + n.p.lng + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16', muteHttpExceptions: true };
    });
    UrlFetchApp.fetchAll(reqs).forEach(function (res, i) {
      try {
        var j = JSON.parse(res.getContentText());
        var arr = j.daily.time.map(function (d, k) { return { date: d, code: j.daily.weather_code[k], tmax: j.daily.temperature_2m_max[k], tmin: j.daily.temperature_2m_min[k], pop: j.daily.precipitation_probability_max[k] }; });
        out[need[i].k] = arr;
        cache.put('wx:' + need[i].k, JSON.stringify(arr), 3600);
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
API.holidayBlocks = function (a) {
  var from = new Date(a.from + 'T00:00:00+09:00'), to = new Date(a.to + 'T23:59:59+09:00');
  var workId = prop_('WORK_CALENDAR_ID');
  var offRe = new RegExp(prop_('WORK_OFF_REGEX', '休|公休|有給|有休|OFF|オフ'), 'i');
  var emptyIsOff = String(prop_('WORK_EMPTY_IS_OFF', 'true')) !== 'false';
  var hol = {};
  try {
    CalendarApp.getCalendarById('ja.japanese#holiday@group.v.calendar.google.com').getEvents(from, to).forEach(function (e) { hol[ymd_(e.getStartTime())] = e.getTitle(); });
  } catch (e) {}
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
  if (a.start) {
    var s = new Date(a.date + 'T' + a.start + ':00+09:00');
    var e = a.end ? new Date(a.date + 'T' + a.end + ':00+09:00') : new Date(s.getTime() + 3600000);
    if (e <= s) e = new Date(e.getTime() + 86400000);
    ev = cal.createEvent(a.title, s, e, a.location ? { location: a.location } : {});
  } else {
    ev = cal.createAllDayEvent(a.title, new Date(a.date + 'T00:00:00+09:00'), a.location ? { location: a.location } : {});
  }
  return { ok: true, eventId: ev.getId() };
};

API.testConnections = function () {
  var r = {};
  try { var s = spotcho_('ping', {}); r.spotcho = { ok: true, note: s.note || 'OK' }; } catch (e) { r.spotcho = { ok: false, error: String(e.message || e) }; }
  try { var k = postJson_(prop_('KAKEIBO_URL') || '', { action: 'tabicho.ping', pin: prop_('KAKEIBO_PIN', '') }); r.kakeibo = { ok: true, note: k.note || 'OK' }; }
  catch (e) { r.kakeibo = { ok: false, error: prop_('KAKEIBO_URL') ? String(e.message || e) : 'KAKEIBO_URL 未設定' }; }
  try { r.calendar = { ok: true, note: (prop_('TRAVEL_CALENDAR_ID') ? CalendarApp.getCalendarById(prop_('TRAVEL_CALENDAR_ID')) : CalendarApp.getDefaultCalendar()).getName() + (prop_('WORK_CALENDAR_ID') ? ' ／ 勤務：設定済' : ' ／ 勤務カレンダー未設定') }; }
  catch (e) { r.calendar = { ok: false, error: String(e.message || e) }; }
  try { var m = route_({ from: { lat: 34.8556, lng: 136.4517 }, to: { lat: 34.6851, lng: 135.843 }, mode: 'car' }); r.maps = { ok: !m.estimated, note: m.km + 'km・' + m.min + '分' }; }
  catch (e) { r.maps = { ok: false, error: String(e.message || e) }; }
  return r;
};
