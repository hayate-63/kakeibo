/**
 * 旅帳 次期モデル Phase 0 PoC — Drive resumable upload の検証用 GAS（旅帳本体とは別プロジェクト）
 * 根拠：旅帳 次期モデル Phase 0 PoC 引き継ぎメモ v0.1（2026-11-25）
 *
 * 構成：本GAS ＋ index.html（GAS から配信、または Netlify 等に置いた同じ HTML から fetch）
 * 認証：PIN（スクリプトプロパティ SECRET_PIN）。画面に Google のアクセストークンは渡さない。
 *       画面に渡すのは resumable upload の「セッション URI」だけ（そのファイル1本にだけ書ける URI）
 *
 * セットアップ：
 *   1. スクリプトプロパティ SECRET_PIN を入れる
 *   2. エディタで setup を1回実行（Drive と外部通信の権限を承認。Drive 直下に「旅帳PoC」フォルダができる）
 *   3. デプロイ → ウェブアプリ（実行ユーザー：自分／アクセス：全員）
 *      ※ Netlify 等の別オリジンから fetch で呼ぶ検証もするため「全員」。全ての操作は PIN で守る
 */
var POC_VERSION = '0.1';
var FOLDER_NAME = '旅帳PoC';
var DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
var DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files/';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('旅帳 PoC')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

// 別オリジン（Netlify 等）の HTML からの呼び出し：POST text/plain の JSON { action, pin, ... }
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return json_({ status: 'error', message: 'JSON を読めません' }); }
  return json_(handle_(req.action, req));
}
// GAS 配信の HTML からの呼び出し（google.script.run）
function apiCall(action, argsJson) {
  var req = {};
  try { req = JSON.parse(argsJson || '{}'); } catch (e) {}
  return JSON.stringify(handle_(action, req));
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handle_(action, req) {
  var t0 = Date.now();
  try {
    var secret = PropertiesService.getScriptProperties().getProperty('SECRET_PIN');
    if (!secret) return { status: 'error', code: 'NO_PIN', message: 'スクリプトプロパティ SECRET_PIN が未設定です' };
    if (String(req.pin || '') !== secret) return { status: 'error', code: 'AUTH', message: 'PIN が一致しません' };
    var h = ACTIONS[action];
    if (!h) return { status: 'error', message: '不明な action: ' + action };
    var r = h(req);
    r.status = r.status || 'ok';
    r.gasMs = Date.now() - t0;
    return r;
  } catch (err) {
    return { status: 'error', message: String(err && err.message || err), gasMs: Date.now() - t0 };
  }
}

function folder_() {
  var it = DriveApp.getRootFolder().getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(FOLDER_NAME);
}
function headerPick_(h, re) {
  var o = {};
  Object.keys(h || {}).forEach(function (k) { if (re.test(k)) o[k] = h[k]; });
  return o;
}
function maskAuth_(h) {
  var o = {};
  Object.keys(h || {}).forEach(function (k) { o[k] = /^authorization$/i.test(k) ? 'Bearer ***（伏せ字）' : h[k]; });
  return o;
}
function rangeOf_(h) { return h.Range || h.range || ''; }

var ACTIONS = {};

ACTIONS.ping = function () {
  return { version: POC_VERSION, folder: folder_().getName(), serverTime: new Date().toISOString() };
};

/**
 * 項目1：resumable upload セッションの発行。
 * originMode: 'send'＝クライアントの Origin を Google へ転送する／'omit'＝付けない（比較用）
 * 証跡として、(a) UrlFetchApp.getRequest() で見た送信予定ヘッダ（Origin が残っているか）、
 * (b) Google の応答ヘッダのうち access-control-*（Google が Origin を受け取れば Allow-Origin が返る想定）を返す
 */
ACTIONS.createSession = function (req) {
  var name = String(req.name || 'poc.bin');
  var mime = String(req.mimeType || 'application/octet-stream');
  var size = Number(req.size);
  if (!(size >= 0)) throw new Error('size が不正です');
  var headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'X-Upload-Content-Type': mime,
    'X-Upload-Content-Length': String(size)
  };
  var originSent = '';
  if (req.originMode !== 'omit' && req.origin) { headers.Origin = String(req.origin); originSent = headers.Origin; }
  var url = DRIVE_UPLOAD + '?uploadType=resumable&fields=id,name,mimeType,size,md5Checksum';
  var params = {
    method: 'post', contentType: 'application/json; charset=UTF-8', headers: headers,
    payload: JSON.stringify({ name: name, parents: [folder_().getId()] }),
    muteHttpExceptions: true, followRedirects: false
  };
  // (a) UrlFetchApp が実際に組み立てる要求（送信前）。Origin が消されていないかを見る
  var planned = {};
  try { planned = UrlFetchApp.getRequest(url, params).headers || {}; } catch (e) { planned = { _error: String(e) }; }
  var res = UrlFetchApp.fetch(url, params);
  var rh = res.getAllHeaders();
  var loc = rh.Location || rh.location || '';
  return {
    ok: res.getResponseCode() === 200 && !!loc,
    sessionUri: loc,
    evidence: {
      originMode: req.originMode === 'omit' ? 'omit' : 'send',
      originRequested: originSent,
      plannedRequestHeaders: maskAuth_(planned),
      originInPlannedRequest: Object.keys(planned).some(function (k) { return /^origin$/i.test(k); }),
      responseCode: res.getResponseCode(),
      responseCorsHeaders: headerPick_(rh, /^access-control-/i),
      responseHeaderNames: Object.keys(rh),
      responseBody: res.getResponseCode() === 200 ? '' : res.getContentText().slice(0, 500)
    }
  };
};

/** セッションの受信済み位置を GAS 側から確認（PUT Content-Range: bytes * / total） */
ACTIONS.status = function (req) {
  var res = UrlFetchApp.fetch(String(req.sessionUri), {
    method: 'put', headers: { 'Content-Range': 'bytes */' + Number(req.size) }, payload: '',
    muteHttpExceptions: true, followRedirects: false
  });
  var h = res.getAllHeaders();
  var code = res.getResponseCode();
  return { code: code, range: rangeOf_(h), file: code === 200 || code === 201 ? safeJson_(res.getContentText()) : null, body: code >= 400 ? res.getContentText().slice(0, 300) : '' };
};

/** 直接 PUT が CORS で使えない時の代替：チャンクを GAS 経由でセッション URI へ送る */
ACTIONS.relayChunk = function (req) {
  var bytes = Utilities.base64Decode(String(req.b64 || ''));
  var start = Number(req.start), total = Number(req.total);
  var end = start + bytes.length - 1;
  var res = UrlFetchApp.fetch(String(req.sessionUri), {
    method: 'put', headers: { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total },
    payload: bytes, contentType: 'application/octet-stream', muteHttpExceptions: true, followRedirects: false
  });
  var h = res.getAllHeaders();
  var code = res.getResponseCode();
  return { code: code, range: rangeOf_(h), file: code === 200 || code === 201 ? safeJson_(res.getContentText()) : null, body: code >= 400 ? res.getContentText().slice(0, 300) : '' };
};

/** 項目4：小さい写真を GAS 経由（base64 → DriveApp.createFile）で保存 */
ACTIONS.smallUpload = function (req) {
  var t = Date.now();
  var blob = Utilities.newBlob(Utilities.base64Decode(String(req.b64 || '')), String(req.mimeType || 'application/octet-stream'), String(req.name || 'small.bin'));
  var f = folder_().createFile(blob);
  return { id: f.getId(), name: f.getName(), size: f.getSize(), mimeType: f.getMimeType(), createMs: Date.now() - t };
};

/** 項目3：表示用の情報。サムネイルは GAS が自分の権限で取り、base64 で渡す（共有設定なしで見られるか） */
ACTIONS.fileInfo = function (req) {
  var token = ScriptApp.getOAuthToken();
  var res = UrlFetchApp.fetch(DRIVE_FILES + encodeURIComponent(req.id) + '?fields=id,name,mimeType,size,thumbnailLink,hasThumbnail,webViewLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis)', {
    headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  var info = safeJson_(res.getContentText()) || {};
  var out = { info: info, thumb: '', thumbNote: '' };
  if (info.thumbnailLink) {
    var tl = String(info.thumbnailLink).replace(/=s\d+$/, '=s' + (Number(req.size) || 1200));
    var tr = UrlFetchApp.fetch(tl, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (tr.getResponseCode() === 200) {
      var b = tr.getBlob();
      out.thumb = 'data:' + (b.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(b.getBytes());
    } else out.thumbNote = 'サムネイル取得 HTTP ' + tr.getResponseCode();
  } else out.thumbNote = 'thumbnailLink なし（Drive の処理待ち、または非対応形式）';
  try {
    var f = DriveApp.getFileById(req.id);
    out.sharing = String(f.getSharingAccess());
  } catch (e) { out.sharing = '不明'; }
  return out;
};

/** 原本をそのまま base64 で返す（HEIC を Safari がそのまま表示できるかの確認用。8MB まで） */
ACTIONS.original = function (req) {
  var f = DriveApp.getFileById(req.id);
  if (f.getSize() > 8 * 1024 * 1024) return { status: 'error', message: '8MB を超えるため原本は返しません' };
  var b = f.getBlob();
  return { mimeType: f.getMimeType(), dataUrl: 'data:' + f.getMimeType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
};

/** 共有設定の切替（Drive プレビューの埋め込み再生が「リンク共有なし」でも動くかを比べる） */
ACTIONS.setShare = function (req) {
  var f = DriveApp.getFileById(req.id);
  if (req.on) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  else f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  return { sharing: String(f.getSharingAccess()) };
};

ACTIONS.listFiles = function () {
  var it = folder_().getFiles();
  var out = [];
  while (it.hasNext() && out.length < 50) {
    var f = it.next();
    if (/^PoC結果_/.test(f.getName())) continue;
    out.push({ id: f.getId(), name: f.getName(), size: f.getSize(), mimeType: f.getMimeType(), created: f.getDateCreated().toISOString() });
  }
  out.sort(function (a, b) { return a.created < b.created ? 1 : -1; });
  return { files: out };
};

ACTIONS.trash = function (req) { DriveApp.getFileById(req.id).setTrashed(true); return {}; };

/** 実装報告用：画面で集めた結果をテキストで「旅帳PoC」フォルダに保存 */
ACTIONS.saveLog = function (req) {
  var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmmss');
  var f = folder_().createFile('PoC結果_' + stamp + '.txt', String(req.text || ''), MimeType.PLAIN_TEXT);
  return { id: f.getId(), url: f.getUrl(), name: f.getName() };
};

function safeJson_(s) { try { return JSON.parse(s); } catch (e) { return null; } }

/** 初回に1回実行：権限の承認とフォルダの作成 */
function setup() {
  var f = folder_();
  UrlFetchApp.getRequest('https://www.googleapis.com/'); // 外部通信の権限を承認させる
  Logger.log('保存先フォルダ: ' + f.getUrl());
  Logger.log('SECRET_PIN: ' + (PropertiesService.getScriptProperties().getProperty('SECRET_PIN') ? '設定済み' : '未設定（スクリプトプロパティに入れてください）'));
}
