/**
 * スポット帳 v1.0 — Google Apps Script（GAS）
 *
 * 構成：単一HTML（PWA）＋ 本GAS ＋ Googleスプレッドシート（DB）
 * 通信：POST（Content-Type: text/plain;charset=utf-8）で JSON を送る。
 *       { action: "...", pin: "....", ...引数 }
 * 応答：{ status: "ok", ... } または { status: "error", code: "...", message: "..." }
 *
 * デプロイ手順（実装メモ §10 も参照）：
 *   1. 新規プロジェクトにこのファイルを丸ごと貼る
 *   2. 下の SECRET_PIN を本人のパスワード（PIN）に書き換える
 *   3. エディタで関数 setup を1回実行（権限承認 → スプレッドシート作成・初期化）
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      実行ユーザー：自分 ／ アクセスできるユーザー：全員
 *   5. 発行された URL をアプリの設定タブに入れる
 */

// ==================== 設定 ====================
// ★本人のパスワード（PIN）に書き換えること。v1.0.1 からパスワード形式（英数字＋記号、4〜64文字、空白不可）。
//   照合は文字列の完全一致。シングルクォート（'）やバックスラッシュ（\）を含む場合は \ でエスケープする
//   例：パスワードが  Ab'c\9!  なら  const SECRET_PIN = 'Ab\'c\\9!';
const SECRET_PIN = '0000';

const SHEET_SPOTS = 'spots';
const SHEET_TAGS = 'tags';
const SHEET_CONFIG = 'config';
const TZ = 'Asia/Tokyo';

// spots タブの列（spots-import-v10.csv のヘッダーと完全一致）
const SPOT_HEADERS = [
  'id', 'place_id', 'name', 'prefecture', 'city', 'categories', 'tags', 'regions',
  'rep_tag', 'address', 'lat', 'lng', 'maps_url', 'status', 'rating', 'memo',
  'google_saved', 'coord_source', 'source_lists', 'created_at', 'updated_at'
];

// tags タブ（タグマスタ）。代表優先順は「代表タグ自動決定の優先順」（空＝自動決定の対象外）
const TAG_HEADERS = ['タグ名', '絵文字', '並び順', '種別', '代表優先順'];

// tags 初期値（設計メモ §4・§5 の絵文字対応表）。初回の setup 時にだけ書き込む。
// 以後の追加・変更はスプレッドシートの tags タブで行う（コードは参照しない）。
const INITIAL_TAGS = [
  // [タグ名, 絵文字, 並び順, 種別, 代表優先順]
  ['ラーメン', '🍜', 1, 'ジャンル', 2],
  ['焼肉', '🥩', 2, 'ジャンル', 3],
  ['うなぎ', '📌', 3, 'ジャンル', 1],
  ['寿司', '🍣', 4, 'ジャンル', 4],
  ['中華', '🥟', 5, 'ジャンル', 5],
  ['すき焼き', '🥓', 6, 'ジャンル', 6],
  ['サウナ', '🧖', 7, 'ジャンル', 7],
  ['キャンプ場', '🏕️', 8, 'ジャンル', 8],
  ['スキー場', '🏂', 9, 'ジャンル', 9],
  ['ガソスタ', '⛽', 10, 'ジャンル', 13],
  ['駐車場', '🅿️', 11, 'ジャンル', 14],
  ['美容', '💉', 12, 'ジャンル', 10],
  ['景色', '🌇', 13, 'ジャンル', 11],
  ['病院', '🏥', 14, 'ジャンル', 15],
  ['車 写真撮影場所', '📸', 15, 'ジャンル', 12],
  ['Friend', '🏠', 16, 'ジャンル', 16],
  ['定期', '💳', 17, 'ジャンル', ''],
  ['コーティング周辺', '🚗', 18, 'ジャンル', ''],
  ['カフェ', '☕', 1, '項目', ''],
  ['宿', '🏨', 2, '項目', ''],
  ['グルメ', '🍽️', 3, '項目', ''],
  ['観光地', '🌇', 4, '項目', ''],
  ['服', '👕', 5, '項目', ''],
  ['その他', '📍', 6, '項目', ''],
  ['淡路島', '', 1, '地域', ''],
  ['飛騨高山', '', 2, '地域', ''],
  ['上高地', '', 3, '地域', ''],
  ['函館', '', 4, '地域', ''],
  ['札幌', '', 5, '地域', ''],
  ['小樽', '', 6, '地域', ''],
  ['登別', '', 7, '地域', '']
];

// config 初期値（家計簿と同じ key / value 形式）
const INITIAL_CONFIG = [
  ['places_api_key', ''],
  ['tile_std_url', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'],
  ['tile_std_attr', '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'],
  ['tile_sat_url', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
  ['tile_sat_attr', 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'],
  ['queue_checks', '{}']
];

// config のうち getAll でアプリへ返さないキー（APIキーは設定済みかどうかだけ返す）
const SECRET_CONFIG_KEYS = ['places_api_key'];

// ==================== 入口 ====================
function doGet(e) {
  // データは返さない（PIN照合のため POST のみ受け付ける）
  return out_({ status: 'ok', message: 'スポット帳 GAS v1.0 稼働中。データ取得は POST で行います。' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ status: 'error', code: 'BAD_REQUEST', message: 'JSON を解釈できません' });
  }
  if (String(req.pin || '') !== String(SECRET_PIN)) {
    return out_({ status: 'error', code: 'AUTH', message: 'PINが一致しません' });
  }
  try {
    const ss = getSpreadsheet_();
    ensureSheets_(ss);
    switch (req.action) {
      case 'ping': return out_({ status: 'ok' });
      case 'getAll': return out_(getAll_(ss));
      case 'addSpot': return out_(withLock_(() => addSpot_(ss, req.spot || {})));
      case 'updateSpot': return out_(withLock_(() => updateSpot_(ss, req.spot || {})));
      case 'deleteSpot': return out_(withLock_(() => deleteSpot_(ss, req.id)));
      case 'importSpots': return out_(withLock_(() => importSpots_(ss, req.rows || [], !!req.dedupeWithinBatch)));
      case 'searchPlace': return out_(searchPlace_(ss, req));
      case 'resolveUrl': return out_(resolveUrl_(ss, req));
      case 'setConfig': return out_(withLock_(() => setConfig_(ss, req.key, req.value)));
      default: return out_({ status: 'error', code: 'UNKNOWN_ACTION', message: '不明な action: ' + req.action });
    }
  } catch (err) {
    return out_({ status: 'error', code: 'SERVER', message: String(err && err.message || err) });
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ==================== スプレッドシート準備 ====================
/** エディタから1回実行する初期化。スプレッドシートを用意して URL をログに出す */
function setup() {
  const ss = getSpreadsheet_();
  ensureSheets_(ss);
  Logger.log('スポット帳DB: ' + ss.getUrl());
  return ss.getUrl();
}

function getSpreadsheet_() {
  // コンテナバインド（スプレッドシートから開いたスクリプト）ならそれを使う
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) { /* standalone */ }
  // 単体プロジェクトの場合は ID をスクリプトプロパティに保存して使い回す
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  const ss = SpreadsheetApp.create('スポット帳DB');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  return ss;
}

function ensureSheets_(ss) {
  let spots = ss.getSheetByName(SHEET_SPOTS);
  if (!spots) {
    spots = ss.insertSheet(SHEET_SPOTS);
    // 日付や数字の自動変換・数式化を防ぐため全体を書式なしテキストにする
    spots.getRange(1, 1, spots.getMaxRows(), SPOT_HEADERS.length).setNumberFormat('@');
    spots.getRange(1, 1, 1, SPOT_HEADERS.length).setValues([SPOT_HEADERS]).setFontWeight('bold');
    spots.setFrozenRows(1);
  }
  let tags = ss.getSheetByName(SHEET_TAGS);
  if (!tags) {
    tags = ss.insertSheet(SHEET_TAGS);
    tags.getRange(1, 1, 1, TAG_HEADERS.length).setValues([TAG_HEADERS]).setFontWeight('bold');
    tags.getRange(2, 1, INITIAL_TAGS.length, TAG_HEADERS.length).setValues(INITIAL_TAGS);
    tags.setFrozenRows(1);
  }
  let config = ss.getSheetByName(SHEET_CONFIG);
  if (!config) {
    config = ss.insertSheet(SHEET_CONFIG);
    config.getRange(1, 1, 1, 2).setValues([['key', 'value']]).setFontWeight('bold');
    config.getRange(2, 1, INITIAL_CONFIG.length, 2).setNumberFormat('@').setValues(INITIAL_CONFIG);
    config.setFrozenRows(1);
  }
  // 新規作成時の空シート「シート1」を片付ける（他にデータが無い場合のみ）
  const first = ss.getSheets()[0];
  if (first && [SHEET_SPOTS, SHEET_TAGS, SHEET_CONFIG].indexOf(first.getName()) < 0 &&
      first.getLastRow() === 0 && ss.getSheets().length > 3) {
    ss.deleteSheet(first);
  }
}

// ==================== 共通 ====================
function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function cellToString_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return String(v);
}

function readSpots_(ss) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, SPOT_HEADERS.length).getValues();
  const list = [];
  values.forEach(row => {
    if (!row[0]) return;
    const o = {};
    SPOT_HEADERS.forEach((h, i) => { o[h] = cellToString_(row[i]); });
    list.push(o);
  });
  return list;
}

function readColumn_(sh, colIndex1) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, colIndex1, last - 1, 1).getValues().map(r => cellToString_(r[0]));
}

function readConfigMap_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const last = sh.getLastRow();
  const map = {};
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(r => {
    if (r[0] !== '') map[String(r[0])] = cellToString_(r[1]);
  });
  return map;
}

function readTags_(ss) {
  const sh = ss.getSheetByName(SHEET_TAGS);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const width = Math.max(4, Math.min(sh.getLastColumn(), TAG_HEADERS.length));
  return sh.getRange(2, 1, last - 1, width).getValues()
    .filter(r => String(r[0]).trim() !== '')
    .map(r => ({
      name: String(r[0]).trim(),
      emoji: cellToString_(r[1]),
      order: Number(r[2]) || 0,
      type: cellToString_(r[3]) || 'ジャンル',
      repPriority: r[4] === '' || r[4] === undefined ? '' : Number(r[4])
    }));
}

/** スポットオブジェクト → 行配列（空欄補完・文字列化） */
function spotToRow_(s) {
  return SPOT_HEADERS.map(h => {
    const v = s[h];
    return v === null || v === undefined ? '' : String(v);
  });
}

function normalizeSpot_(s) {
  const o = {};
  SPOT_HEADERS.forEach(h => { o[h] = s[h] === null || s[h] === undefined ? '' : String(s[h]).trim(); });
  return o;
}

/** Googleマップ URL から重複判定用のキーを取り出す（0x...:0x... の地物ID か URL そのもの） */
function mapsUrlKey_(url) {
  url = String(url || '').trim();
  if (!url) return '';
  const m = url.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (m) return 'ftid:' + m[1].toLowerCase();
  const cid = url.match(/[?&]cid=(\d+)/);
  if (cid) return 'cid:' + cid[1];
  return 'url:' + url;
}

function nextIdNumber_(ids) {
  let max = 0;
  ids.forEach(id => {
    const m = String(id).match(/^SP(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return max + 1;
}

function formatId_(n) {
  return 'SP' + String(n).padStart(4, '0');
}

function findRowById_(sh, id) {
  const ids = readColumn_(sh, 1);
  const idx = ids.indexOf(String(id));
  return idx < 0 ? -1 : idx + 2;
}

// ==================== アクション ====================
function getAll_(ss) {
  const config = readConfigMap_(ss);
  const publicConfig = {};
  Object.keys(config).forEach(k => {
    if (SECRET_CONFIG_KEYS.indexOf(k) < 0) publicConfig[k] = config[k];
  });
  publicConfig.places_api_key_set = config.places_api_key ? '1' : '';
  return {
    status: 'ok',
    spots: readSpots_(ss),
    tags: readTags_(ss),
    config: publicConfig,
    serverDate: today_()
  };
}

function addSpot_(ss, spot) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const s = normalizeSpot_(spot);
  if (!s.name) return { status: 'error', code: 'VALIDATION', message: '店名が空です' };
  if (s.place_id) {
    const pids = readColumn_(sh, SPOT_HEADERS.indexOf('place_id') + 1);
    const hit = pids.indexOf(s.place_id);
    if (hit >= 0) {
      const existingId = readColumn_(sh, 1)[hit];
      return { status: 'error', code: 'DUPLICATE', existingId: existingId, message: 'この場所は登録済みです（' + existingId + '）' };
    }
  }
  const ids = readColumn_(sh, 1);
  s.id = formatId_(nextIdNumber_(ids));
  const d = today_();
  s.created_at = d; // 登録日は GAS 側の当日（端末の時計に依存しない）
  s.updated_at = d;
  if (!s.status) s.status = '行きたい';
  if (!s.google_saved) s.google_saved = '未';
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(s)]);
  return { status: 'ok', spot: s };
}

function updateSpot_(ss, spot) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const s = normalizeSpot_(spot);
  const row = findRowById_(sh, s.id);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象のスポットがありません: ' + s.id };
  if (s.place_id) {
    const pids = readColumn_(sh, SPOT_HEADERS.indexOf('place_id') + 1);
    const ids = readColumn_(sh, 1);
    for (let i = 0; i < pids.length; i++) {
      if (pids[i] === s.place_id && ids[i] !== s.id) {
        return { status: 'error', code: 'DUPLICATE', existingId: ids[i], message: 'この place_id は別のスポット（' + ids[i] + '）で登録済みです' };
      }
    }
  }
  const current = sh.getRange(row, 1, 1, SPOT_HEADERS.length).getValues()[0];
  s.created_at = cellToString_(current[SPOT_HEADERS.indexOf('created_at')]) || s.created_at;
  s.updated_at = today_();
  sh.getRange(row, 1, 1, SPOT_HEADERS.length).setNumberFormat('@').setValues([spotToRow_(s)]);
  return { status: 'ok', spot: s };
}

function deleteSpot_(ss, id) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const row = findRowById_(sh, id);
  if (row < 0) return { status: 'error', code: 'NOT_FOUND', message: '対象のスポットがありません: ' + id };
  sh.deleteRow(row);
  return { status: 'ok', id: String(id) };
}

/**
 * CSV 取り込み（初期投入・Takeout 再取り込み）
 * rows: spots の列名をキーにしたオブジェクト配列（アプリ側で CSV を解析して送る）
 * 既存行と place_id / maps_url（地物ID）が一致するものは追加しない。
 * dedupeWithinBatch=true のときは、同じ取り込み内の重複も1件にまとめる（Takeout用）。
 * 初期投入（spots形式CSV）は false で送るため、CSV の内容・件数はそのまま入る。
 */
function importSpots_(ss, rows, dedupeWithinBatch) {
  const sh = ss.getSheetByName(SHEET_SPOTS);
  const existing = readSpots_(ss);
  const pidSet = {};
  const urlSet = {};
  const idSet = {};
  existing.forEach(s => {
    if (s.place_id) pidSet[s.place_id] = s.id;
    const k = mapsUrlKey_(s.maps_url);
    if (k) urlSet[k] = s.id;
    idSet[s.id] = true;
  });
  let nextNo = nextIdNumber_(existing.map(s => s.id));
  const batchPid = {};
  const batchUrl = {};
  const toWrite = [];
  const skipped = [];
  const d = today_();

  rows.forEach((raw, i) => {
    const s = normalizeSpot_(raw);
    if (!s.name && !s.maps_url) { skipped.push({ index: i, reason: '店名・URLとも空' }); return; }
    const uk = mapsUrlKey_(s.maps_url);
    if (s.place_id && pidSet[s.place_id]) { skipped.push({ index: i, name: s.name, reason: 'place_id 登録済み（' + pidSet[s.place_id] + '）' }); return; }
    if (uk && urlSet[uk]) { skipped.push({ index: i, name: s.name, reason: 'マップURL 登録済み（' + urlSet[uk] + '）' }); return; }
    if (dedupeWithinBatch) {
      if ((s.place_id && batchPid[s.place_id]) || (uk && batchUrl[uk])) {
        // 同じ取り込み内の重複は、移行元リスト名だけ先の行にまとめる
        const first = batchPid[s.place_id] || batchUrl[uk];
        if (s.source_lists) {
          const lists = first.source_lists ? first.source_lists.split('/') : [];
          s.source_lists.split('/').forEach(l => { if (l && lists.indexOf(l) < 0) lists.push(l); });
          first.source_lists = lists.join('/');
        }
        skipped.push({ index: i, name: s.name, reason: '取り込み内で重複（まとめた）' });
        return;
      }
    }
    if (!/^SP\d+$/.test(s.id) || idSet[s.id]) {
      s.id = formatId_(nextNo++);
    } else {
      nextNo = Math.max(nextNo, Number(s.id.slice(2)) + 1);
    }
    idSet[s.id] = true;
    if (!s.created_at) s.created_at = d;
    if (!s.updated_at) s.updated_at = d;
    if (!s.status) s.status = '行きたい';
    if (!s.google_saved) s.google_saved = '済';
    if (s.place_id) batchPid[s.place_id] = s;
    if (uk) batchUrl[uk] = s;
    toWrite.push(s);
  });

  if (toWrite.length) {
    const start = sh.getLastRow() + 1;
    const values = toWrite.map(spotToRow_);
    sh.getRange(start, 1, values.length, SPOT_HEADERS.length).setNumberFormat('@').setValues(values);
  }
  return {
    status: 'ok',
    added: toWrite.length,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 200),
    total: existing.length + toWrite.length
  };
}

function setConfig_(ss, key, value) {
  key = String(key || '').trim();
  if (!key) return { status: 'error', code: 'VALIDATION', message: 'key が空です' };
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : [];
  const idx = keys.indexOf(key);
  const row = idx >= 0 ? idx + 2 : last + 1;
  sh.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[key, value === null || value === undefined ? '' : String(value)]]);
  return { status: 'ok', key: key };
}

// ==================== Places API (New) ====================
const PLACES_BASE = 'https://places.googleapis.com/v1/';

function getApiKey_(ss) {
  return readConfigMap_(ss).places_api_key || '';
}

function placesFetch_(url, key, fieldMask, payload) {
  const opt = {
    method: payload ? 'post' : 'get',
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    muteHttpExceptions: true
  };
  if (payload) {
    opt.contentType = 'application/json';
    opt.payload = JSON.stringify(payload);
  }
  const res = UrlFetchApp.fetch(url, opt);
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) {
    throw new Error('Places API エラー (' + code + '): ' + (body.error && body.error.message || res.getContentText()));
  }
  return body;
}

/**
 * searchPlace
 *  - req.query がある → Text Search で候補一覧（place_id・店名・住所・座標・種別）
 *  - req.placeId がある → Details で1件の詳細（住所構成要素・マップURL付き）
 */
function searchPlace_(ss, req) {
  const key = getApiKey_(ss);
  if (!key) return { status: 'error', code: 'NO_API_KEY', message: 'Places APIキーが未設定です（設定タブで登録してください）' };

  if (req.placeId) {
    return { status: 'ok', place: placeDetails_(key, req.placeId) };
  }
  const query = String(req.query || '').trim();
  if (!query) return { status: 'error', code: 'VALIDATION', message: '検索語が空です' };
  const payload = { textQuery: query, languageCode: 'ja', regionCode: 'JP', pageSize: 10 };
  if (req.lat && req.lng) {
    payload.locationBias = { circle: { center: { latitude: Number(req.lat), longitude: Number(req.lng) }, radius: 50000 } };
  }
  const body = placesFetch_(PLACES_BASE + 'places:searchText', key,
    'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType', payload);
  const candidates = (body.places || []).map(p => ({
    place_id: p.id,
    name: p.displayName ? p.displayName.text : '',
    address: p.formattedAddress || '',
    lat: p.location ? p.location.latitude : '',
    lng: p.location ? p.location.longitude : '',
    types: p.types || [],
    primaryType: p.primaryType || ''
  }));
  return { status: 'ok', candidates: candidates };
}

function placeDetails_(key, placeId) {
  const p = placesFetch_(PLACES_BASE + 'places/' + encodeURIComponent(placeId) + '?languageCode=ja&regionCode=JP', key,
    'id,displayName,formattedAddress,location,types,primaryType,addressComponents,googleMapsUri');
  const comps = p.addressComponents || [];
  const pick = type => {
    const c = comps.filter(x => (x.types || []).indexOf(type) >= 0)[0];
    return c ? c.longText : '';
  };
  return {
    place_id: p.id,
    name: p.displayName ? p.displayName.text : '',
    address: p.formattedAddress || '',
    lat: p.location ? p.location.latitude : '',
    lng: p.location ? p.location.longitude : '',
    types: p.types || [],
    primaryType: p.primaryType || '',
    prefecture: pick('administrative_area_level_1'),
    city: pick('locality') || pick('administrative_area_level_2'),
    maps_url: p.googleMapsUri || ('https://www.google.com/maps/place/?q=place_id:' + p.id),
    coord_source: 'Places'
  };
}

// ==================== 入口1：マップURLの解析 ====================
/**
 * resolveUrl：GoogleマップのURL（maps.app.goo.gl 等の短縮URLも可）を展開し、
 *   1) URL に place_id があれば（キー設定時）Details で特定
 *   2) 店名＋座標が取れれば（キー設定時）Text Search で place_id を特定
 *   3) キー未設定なら URL の店名・座標＋Nominatim の逆ジオコーディングで候補を作る
 */
function resolveUrl_(ss, req) {
  const input = String(req.url || '').trim();
  if (!/^https?:\/\//.test(input)) return { status: 'error', code: 'VALIDATION', message: 'URL を貼ってください' };
  const finalUrl = expandUrl_(input);
  const info = parseMapsUrl_(finalUrl);
  info.expandedUrl = finalUrl;
  const key = getApiKey_(ss);

  if (key && info.placeId) {
    const place = placeDetails_(key, info.placeId);
    return { status: 'ok', info: info, candidates: [place], resolvedBy: 'place_id' };
  }
  if (key && info.name) {
    const r = searchPlace_(ss, { query: info.name, lat: info.lat, lng: info.lng });
    if (r.status === 'ok' && r.candidates.length) {
      return { status: 'ok', info: info, candidates: r.candidates, resolvedBy: 'search' };
    }
  }
  // APIを使わない経路（無料）：URL の情報だけで候補を作る
  if (info.lat && info.lng) {
    const geo = reverseGeocode_(info.lat, info.lng);
    return {
      status: 'ok', info: info, resolvedBy: 'url',
      candidates: [{
        place_id: info.placeId || '',
        name: info.name || '',
        address: geo.address || '',
        prefecture: geo.prefecture || '',
        city: geo.city || '',
        lat: info.lat, lng: info.lng, types: [],
        maps_url: input,
        coord_source: 'URL'
      }]
    };
  }
  return {
    status: 'ok', info: info, resolvedBy: 'none',
    candidates: info.name ? [{ place_id: '', name: info.name, address: '', lat: '', lng: '', types: [], maps_url: input, coord_source: '' }] : [],
    message: key ? 'URL からスポットを特定できませんでした' : 'URL に座標が無く、Places APIキーも未設定のため特定できませんでした'
  };
}

function expandUrl_(url) {
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res;
    try {
      res = UrlFetchApp.fetch(current, { followRedirects: false, muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch (e) {
      break;
    }
    const code = res.getResponseCode();
    if (code >= 300 && code < 400) {
      const h = res.getHeaders();
      const loc = h.Location || h.location;
      if (!loc) break;
      current = loc.indexOf('http') === 0 ? loc : current.replace(/^(https?:\/\/[^/]+).*$/, '$1') + loc;
      continue;
    }
    break;
  }
  return current;
}

function parseMapsUrl_(url) {
  const info = { name: '', lat: '', lng: '', placeId: '', ftid: '' };
  let u = url;
  try { u = decodeURIComponent(url.replace(/\+/g, ' ')); } catch (e) { /* そのまま */ }
  const pid = u.match(/(?:query_place_id=|place_id[:=])([A-Za-z0-9_-]{20,})/);
  if (pid) info.placeId = pid[1];
  const ftid = u.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (ftid) info.ftid = ftid[1];
  // 店のピン座標（!3d緯度!4d経度）を優先し、無ければ地図中心（@緯度,経度）
  const pin = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  const at = u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = u.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const search = u.match(/\/maps\/search\/(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  const c = pin || q || search || at;
  if (c) { info.lat = Number(c[1]); info.lng = Number(c[2]); }
  const place = u.match(/\/maps\/place\/([^/@?]+)/);
  if (place) info.name = place[1].trim();
  if (!info.name) {
    const qn = u.match(/[?&]q=([^&]+)/);
    if (qn && !/^-?\d+\.\d+,/.test(qn[1])) info.name = qn[1].trim();
  }
  return info;
}

/** Nominatim（OpenStreetMap の無料ジオコーダ）で都道府県・市区町村・住所を得る */
function reverseGeocode_(lat, lng) {
  try {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ja&zoom=18&lat=' +
      encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, headers: { 'User-Agent': 'SpotBook-GAS/1.0 (personal use)' } });
    if (res.getResponseCode() !== 200) return {};
    const j = JSON.parse(res.getContentText());
    const a = j.address || {};
    return {
      address: j.display_name || '',
      prefecture: a.province || a.state || '',
      city: a.city || a.town || a.village || a.county || ''
    };
  } catch (e) {
    return {};
  }
}
