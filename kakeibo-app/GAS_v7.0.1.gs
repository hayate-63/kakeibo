// ============================================================================
// 専業トレーダー家計簿 クラウド同期 API (v7.0.1 / 処理の変更なし。アプリ v7.0.1（旅帳の明細に「🧳旅帳」の印）に版をそろえた。旅帳の明細は Logs の src="tabicho"・srcRef（旅帳の目印）で入る。v7.0 / Logs に payLock（引落日の手動確定）・payWait（持ち越し＝待機）・ribo（リボ払いへ変更）の列。リボ弁済金プールは Config の ribo_pools に保存（アプリ側）。v6.0 / クレカの利用通知・Amazon の注文メールから下書き（MailDrafts）・為替レート・Logs に出所の列。v5.2 / 連携明細の区分固定（Logs に catLock 列）・PIN の既定値を廃止。以下 v3.0.2 まで: 予定の手入力（交替回数・残業時間）・「遊び」カレンダーの除外・給与見込み・勤務の自動計算・月別予算・走行距離の連携を追加)
// ============================================================================

// ★暗証番号（PIN）の設定
// v5.2: 「プロジェクトの設定 → スクリプト プロパティ」の SECRET_PIN だけを使います（既定値 "1234" は廃止）。
//       SECRET_PIN が無い・空のときは、どの PIN でも unauthorized になります（プロパティを入れれば復旧）。
function getSecretPin_() {
  const p = PropertiesService.getScriptProperties().getProperty("SECRET_PIN");
  return (p !== null && p !== "") ? p : null; // 既定値を使わない
}

// v2.6.3: 日時の表示に使うタイムゾーン（"JST" は古い書き方のため IANA 名に統一）
const TZ = "Asia/Tokyo";

// v2.6.3: 保存の通し番号（リビジョン）。保存が成功するたびに +1 する。
//         アプリが「読み込んだ時点の番号（baseRev）」と違う状態で保存しようとしたら conflict を返し、
//         別の端末で入力した内容を古いデータで上書きするのを防ぐ
function getDataRev_() {
  return Number(PropertiesService.getScriptProperties().getProperty("DATA_REV")) || 0;
}
function bumpDataRev_() {
  const next = getDataRev_() + 1;
  PropertiesService.getScriptProperties().setProperty("DATA_REV", String(next));
  return next;
}

// 各シートごとに保持するバックアップの最大世代数（A2仕様）
const MAX_BACKUP_GENERATIONS = 10;

// v2.6.1: Logs シートの保存列（ruleId＝定期ルール由来の印、isLegacy＝旧方式CSV明細の印 を追加）
// v5.2: catLock（"1"＝ほしいもの帳が入れた区分を固定する印）を最後に追加。次の保存で列ができ、既存の明細は空欄
const LOG_HEADERS = ["id","amount","date","memo","category","useDate","payDate","payYM","useYM","bigCat","usageCat","budgetCat","absAmount","ruleId","isLegacy","catLock","src","srcRef","prov","fx","payLock","payWait","ribo"];
// v7.0: payLock（"1"＝引落日を手動で確定）・payWait（"1"＝持ち越し中）・ribo（"1"＝リボ払いへ変更。引落はリボ弁済金プール側）を最後に追加
// v6.0: src（出所 mail／amazon／csv）・srcRef（メールの ID・CSV の行の目印）・prov（仮の印 fx／amazon）・fx（外貨の元の額とレート）を最後に追加

// v2.6.2: スプレッドシートが日付や数値に自動変換しないよう「書式なしテキスト」で保存する列
// （金額・ID・日数などの数値列はそのまま数値で保存し、シート上のSUM等も使えるようにしている）
const TEXT_COLUMNS = {
  Logs: ["date","memo","category","useDate","payDate","payYM","useYM","bigCat","usageCat","budgetCat","ruleId","catLock","src","srcRef","prov","fx","payLock","payWait","ribo"],
  MailDrafts: ["msgId","kind","card","useAt","store","fxCur","fxRateDate","orderNo","status","receivedAt","subject","note"],
  Dictionary: ["kw","usage","budget"],
  Categories: ["name","mode","bigCat","treat","adjust"],
  Budget: ["budgetCat","bonusMonths","note"],
  Config: ["key","value"],
  BudgetMonthly: ["ym","budgetCat","source","updatedAt"]
};

// v3.0: 月ごとの予算（給与見込みからの自動書き換え・本人の固定）。古いアプリは送らないので消えない
const BUDGET_MONTHLY_HEADERS = ["ym","budgetCat","amount","source","updatedAt"];

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// v2.6.3: 予期しないエラーでも必ず JSON を返す（アプリ側で原因を表示できるように）
function doGet(e) {
  try {
    return doGetInner_(e);
  } catch (err) {
    return jsonOut_({ status: "error", message: String(err) });
  }
}

function doGetInner_(e) {
  const pin = (e && e.parameter && e.parameter.pin) || "";
  const secret = getSecretPin_(); // v5.2: 未設定なら誰も通さない
  if (!secret || pin !== secret) {
    return ContentService.createTextOutput(JSON.stringify({ status: "unauthorized", message: "暗証番号が一致しません" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const action = e.parameter.action || "loadAll";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  if (action === "loadAll") {
    const year = Number(e.parameter.year) || new Date().getFullYear();
    const month = Number(e.parameter.month) || (new Date().getMonth() + 1);
    
    const data = {
      status: "ok",
      rev: getDataRev_(),
      logs: getSheetData(ss, "Logs"),
      dictionary: getSheetData(ss, "Dictionary"),
      categories: getSheetData(ss, "Categories"),
      budget: getSheetData(ss, "Budget"),
      config: getSheetData(ss, "Config"),
      budgetMonthly: getSheetData(ss, "BudgetMonthly"),
      events: getCalendarEvents(year, month),
      holidays: getJapaneseHolidays(year)
    };
    // v6.0: メールの下書き（まだ登録も外しもしていないもの）。読めなくても同期は止めない
    try { data.mailDrafts = mailDraftList_(ss, true); } catch (err) { data.mailDrafts = []; data.mailDraftsError = String(err); }
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // v6.0: 「今すぐ取り込む」（トリガーを待たずにメールを読む）
  if (action === "importMailsNow") {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) return jsonOut_({ status: "busy", message: "ほかの処理が実行中です。少し待ってからもう一度押してください。" });
    try {
      const r = importCardMails_();
      return jsonOut_({ status: "ok", added: r.added || 0, message: r.message || "", mailDrafts: mailDraftList_(ss, true) });
    } finally {
      lock.releaseLock();
    }
  }

  // v6.0: 為替レート（照合で外貨の手数料相当額を出すため）
  if (action === "fxRate") {
    const r = fxRateToJpy_(String(e.parameter.cur || "").toUpperCase(), String(e.parameter.date || ""));
    return jsonOut_({ status: "ok", rate: r.rate, date: r.date });
  }
  
  if (action === "getShakenEstimate") {
    try {
      const amount = getShakenEstimateCenter_();
      return ContentService.createTextOutput(JSON.stringify({ status: "ok", amount: amount }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  // v3.0: 給与見込み（勤務の自動計算をブックに書き込んでから、給与・走行距離・通勤回数を返す）
  if (action === "getSalary") {
    return jsonOut_(getSalaryForecast_(ss));
  }

  if (action === "getEvents") {
    const year = Number(e.parameter.year);
    const month = Number(e.parameter.month);
    const data = {
      status: "ok",
      events: getCalendarEvents(year, month),
      holidays: getJapaneseHolidays(year)
    };
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return jsonOut_({ status: "error", message: "不明な action です: " + action });
}

// v2.6.2: 複数端末・連続送信で書き込みが交互に走ってシートが壊れないよう、スクリプトロックで1件ずつ処理する
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (err) {
    return jsonOut_({ status: "busy", message: "他の保存処理が実行中です。少し待ってから再送してください。" });
  }
  try {
    return doPostInner_(e);
  } catch (err) {
    // v2.6.3: JSON の解析失敗などでも JSON で返す
    return jsonOut_({ status: "error", message: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doPostInner_(e) {
  if (!e || !e.postData || !e.postData.contents) return jsonOut_({ status: "error", message: "送信データが空です" });
  const payload = JSON.parse(e.postData.contents);
  const secret = getSecretPin_(); // v5.2: 未設定なら誰も通さない
  if (!secret || (payload.pin || "") !== secret) {
    return ContentService.createTextOutput(JSON.stringify({ status: "unauthorized", message: "暗証番号が一致しません" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (payload.action === "registerPayCalendar") {
    const calResult = registerPaymentEventsToCalendar(payload.events || []);
    return ContentService.createTextOutput(JSON.stringify(calResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // v6.0: メールの下書きを「登録済み」「外した」にする（明細のデータ・リビジョンには触らない）
  if (payload.action === "markMailDrafts") {
    const st = payload.status === "skip" ? "skip" : "done";
    return jsonOut_({ status: "ok", updated: markMailDrafts_(payload.ids || [], st) });
  }

  // v2.6.3: 競合チェック。アプリが読み込んだ時点のリビジョン（baseRev）が今と違えば、別の端末が先に保存している。
  //         baseRev を送らない古いアプリや「強制送信」はチェックしない
  const currentRev = getDataRev_();
  if (payload.baseRev !== undefined && payload.baseRev !== null && Number(payload.baseRev) !== currentRev) {
    return jsonOut_({ status: "conflict", rev: currentRev, message: "別の端末で先に保存されています。同期してから再送してください。" });
  }

  // A2: 全5データシートすべてで「上書き保存の直前」に日時付き10世代バックアップを実行
  if (payload.logs && payload.logs.length > 0) {
    backupSheetWithRotation(ss, "Logs");
    saveSheetData(ss, "Logs", LOG_HEADERS, payload.logs);
  } else if (payload.logs && payload.allowEmptyLogs) {
    backupSheetWithRotation(ss, "Logs");
    saveSheetData(ss, "Logs", LOG_HEADERS, []);
  }

  if (payload.dictionary && payload.dictionary.length > 0) {
    backupSheetWithRotation(ss, "Dictionary");
    saveSheetData(ss, "Dictionary", ["kw","usage","budget"], payload.dictionary);
  }
  if (payload.categories && payload.categories.length > 0) {
    backupSheetWithRotation(ss, "Categories");
    saveSheetData(ss, "Categories", ["name","mode","bigCat","closeDay","payMonthOffset","payDay","treat","active","sort","adjust"], payload.categories);
  }
  if (payload.budget && payload.budget.length > 0) {
    backupSheetWithRotation(ss, "Budget");
    saveSheetData(ss, "Budget", ["budgetCat","monthly","bonusAdd","bonusMonths","note"], payload.budget);
  }
  if (payload.config && payload.config.length > 0) {
    backupSheetWithRotation(ss, "Config");
    saveSheetData(ss, "Config", ["key","value"], payload.config);
  }
  // v3.0: 月ごとの予算。配列が送られてきたときだけ保存する（空にするのは allowEmptyBudgetMonthly のときだけ）
  if (Array.isArray(payload.budgetMonthly) && (payload.budgetMonthly.length > 0 || payload.allowEmptyBudgetMonthly)) {
    backupSheetWithRotation(ss, "BudgetMonthly");
    saveSheetData(ss, "BudgetMonthly", BUDGET_MONTHLY_HEADERS, payload.budgetMonthly);
  }
  
  // v2.6: 過去に作られて表示状態のまま残っているバックアップも保存のたびに隠す
  ss.getSheets().forEach(function(s) {
    if (s.getName().indexOf("_Backup_") >= 0 && !s.isSheetHidden()) s.hideSheet();
  });

  const newRev = bumpDataRev_();
  return jsonOut_({ status: "saved", rev: newRev, timestamp: new Date().toISOString() });
}

// A2: <シート名>_Backup_yyyyMMdd_HHmmss でバックアップを作成し、直近10世代を超えた古いシートを自動削除
function backupSheetWithRotation(ss, sheetName) {
  const src = ss.getSheetByName(sheetName);
  if (!src || src.getLastRow() < 2) return;

  const timestamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd_HHmmss");
  const prefix = sheetName + "_Backup_";
  let bakName = prefix + timestamp;

  // 同一秒内に複数回呼ばれた場合の重複回避
  if (ss.getSheetByName(bakName)) {
    bakName = bakName + "_" + Math.floor(Math.random() * 100);
  }

  // v2.6.3: シートごと複製して「書式なしテキスト」の設定も引き継ぐ（値だけコピーすると "2026-10" 等が日付に化けるため）
  const bak = src.copyTo(ss);
  bak.setName(bakName);
  bak.hideSheet(); // v2.6: バックアップタブでシート一覧が埋まらないよう自動で隠す

  // 世代ローテーション：対象シートのバックアップ一覧を名前（日時）昇順で並べ、10世代を超えた最古分を削除
  const allSheets = ss.getSheets();
  const backupSheets = allSheets
    .filter(s => s.getName().indexOf(prefix) === 0)
    .sort((a, b) => a.getName().localeCompare(b.getName()));

  while (backupSheets.length > MAX_BACKUP_GENERATIONS) {
    const oldest = backupSheets.shift();
    ss.deleteSheet(oldest);
  }
}

function getCalendarEvents(year, month) {
  const startDate = new Date(year, month - 2, 1);
  const endDate = new Date(year, month + 1, 0, 23, 59, 59);
  const mapEv = function(calName) {
    return function(ev) {
      const d = ev.getStartTime();
      return {
        date: Utilities.formatDate(d, TZ, "yyyy-MM-dd"),
        title: ev.getTitle(),
        isAllDay: ev.isAllDayEvent(),
        startTime: ev.isAllDayEvent() ? "終日" : Utilities.formatDate(d, TZ, "HH:mm"),
        calendar: calName
      };
    };
  };
  let results = [];
  try {
    const cal = CalendarApp.getDefaultCalendar();
    if (cal) results = results.concat(cal.getEvents(startDate, endDate).map(mapEv("メイン")));
  } catch (err) {}
  try {
    const asobiCals = CalendarApp.getCalendarsByName("遊び");
    if (asobiCals && asobiCals.length > 0) {
      asobiCals.forEach(function(c) {
        results = results.concat(c.getEvents(startDate, endDate).map(mapEv("遊び")));
      });
    }
  } catch (err) {}
  return results;
}
function getSheetData(ss, sheetName) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(r => {
    let obj = {};
    headers.forEach((h, i) => {
      if (h === "date" || h === "payDate" || h === "useDate") {
        obj[h] = r[i] instanceof Date ? Utilities.formatDate(r[i], TZ, "yyyy-MM-dd") : String(r[i]);
      } else if (r[i] instanceof Date) {
        // v2.6.2: 過去の保存で自動的に日付型へ変わってしまったセルを元の文字列に戻す
        if (h === "payYM" || h === "useYM" || h === "ym") obj[h] = Utilities.formatDate(r[i], TZ, "yyyy-MM");
        else if (h === "memo") obj[h] = Utilities.formatDate(r[i], TZ, "M/d");
        else obj[h] = r[i];
      } else {
        obj[h] = r[i];
      }
    });
    // Config の値：キー名が _ym で終わるものは yyyy-MM、それ以外の日付は yyyy-MM-dd に戻す
    if (sheetName === "Config" && obj.value instanceof Date) {
      obj.value = Utilities.formatDate(obj.value, TZ, /_ym$/.test(String(obj.key)) ? "yyyy-MM" : "yyyy-MM-dd");
    }
    return obj;
  });
}

function saveSheetData(ss, sheetName, headers, dataArray) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clearContents();
  const values = [headers];
  dataArray.forEach(item => {
    values.push(headers.map(h => (item[h] !== undefined && item[h] !== null) ? item[h] : ""));
  });
  // v2.6.2: 文字列列は書式なしテキストにしてから書き込む（"2026-10" や "11/3" が日付に化けるのを防ぐ）
  const textCols = TEXT_COLUMNS[sheetName] || [];
  textCols.forEach(h => {
    const col = headers.indexOf(h);
    if (col >= 0) sheet.getRange(1, col + 1, values.length, 1).setNumberFormat("@");
  });
  sheet.getRange(1, 1, values.length, headers.length).setValues(values);
}

// ============================================================================
// [v2.4.2] 日本の祝日取得 (前年1月-翌年12月 / yyyy-MM-dd 配列 / 失敗時は空配列)
// ============================================================================
function getJapaneseHolidays(year) {
  try {
    const baseYear = Number(year) || new Date().getFullYear();
    const holidayCal = CalendarApp.getCalendarById("ja.japanese#holiday@group.v.calendar.google.com");
    if (!holidayCal) return [];
    const events = holidayCal.getEvents(new Date(baseYear - 1, 0, 1), new Date(baseYear + 1, 11, 31, 23, 59, 59));
    const set = {};
    events.forEach(function(ev) {
      set[Utilities.formatDate(ev.getStartTime(), TZ, "yyyy-MM-dd")] = true;
    });
    return Object.keys(set).sort();
  } catch (err) {
    return [];
  }
}

// ============================================================================
// [v2.4.4] 引落予定のGoogleカレンダー登録 (引落日前日 / タイトル: HIKIOSHI marker)
// 重複判定は marker + 日分 で始まる予定だけが対象。金額が同じならスキップ、
// 金額が違えば古い予定を削除して作り直す (updated)。
// ============================================================================
function registerPaymentEventsToCalendar(events) {
  const cal = CalendarApp.getDefaultCalendar();
  if (!cal) {
    return { status: "error", message: "デフォルトのGoogleカレンダーが見つかりません。" };
  }
  let created = 0, updated = 0, skipped = 0;
  const details = [];
  const MARK = "\u3010\u5f15\u843d\u3011"; // title prefix marker

  events.forEach(function(item) {
    if (!item || !item.title) return;

    let targetDate = null;
    if (item.eventDate && /^\d{4}-\d{2}-\d{2}$/.test(item.eventDate)) {
      const p = item.eventDate.split("-").map(Number);
      targetDate = new Date(p[0], p[1] - 1, p[2]);
    } else if (item.payDate && /^\d{4}-\d{2}-\d{2}$/.test(item.payDate)) {
      const p = item.payDate.split("-").map(Number);
      targetDate = new Date(p[0], p[1] - 1, p[2] - 1); // day before pay date
    }
    if (!targetDate || isNaN(targetDate.getTime())) return;

    let cleanTitle = String(item.title).trim().replace(/^[\u300c]/, "").replace(/[\u300d]$/, "").trim();
    if (cleanTitle.indexOf(MARK) !== 0) cleanTitle = MARK + cleanTitle;
    const description = String(item.description || "").trim();

    const prefixMatch = cleanTitle.match(new RegExp("^" + MARK + "([^\\s\u00a5\uffe5]+\u5206)"));
    const groupPrefix = prefixMatch ? MARK + prefixMatch[1] : cleanTitle;

    const existing = cal.getEventsForDay(targetDate);
    const sameGroup = existing.filter(function(ev) {
      return String(ev.getTitle() || "").trim().indexOf(groupPrefix) === 0;
    });

    const dateStr = Utilities.formatDate(targetDate, TZ, "yyyy-MM-dd");

    if (sameGroup.length > 0) {
      if (sameGroup.length === 1 && String(sameGroup[0].getTitle() || "").trim() === cleanTitle) {
        skipped++;
        details.push({ date: dateStr, title: cleanTitle, result: "skipped" });
      } else {
        sameGroup.forEach(function(ev) { ev.deleteEvent(); });
        cal.createAllDayEvent(cleanTitle, targetDate, { description: description });
        updated++;
        details.push({ date: dateStr, title: cleanTitle, result: "updated" });
      }
    } else {
      cal.createAllDayEvent(cleanTitle, targetDate, { description: description });
      created++;
      details.push({ date: dateStr, title: cleanTitle, result: "created" });
    }
  });

  return {
    status: "ok",
    created: created,
    updated: updated,
    skipped: skipped,
    details: details,
    message: "登録 " + created + " 件 ／ 更新 " + updated + " 件 ／ 重複スキップ " + skipped + " 件"
  };
}

// 点検シート（愛車保全と共用）の「費用内訳」から2028年車検の合計（中心）を読む
function getShakenEstimateCenter_() {
  const MAINTENANCE_SS_ID = "1mCk1swU7GLAmMQs-0KFQGCx99Lhr3k9QsBvgVD8RH-4";
  const mss = SpreadsheetApp.openById(MAINTENANCE_SS_ID);
  const sheet = mss.getSheetByName("費用内訳");
  if (!sheet) throw new Error("費用内訳シートが見つかりません");
  const values = sheet.getRange("A1:B60").getValues();
  for (let i = 0; i < values.length; i++) {
    const label = String(values[i][0] || "");
    if (label.indexOf("2028年車検") >= 0 && label.indexOf("合計") >= 0) {
      const num = Number(String(values[i][1]).replace(/[^0-9.]/g, ""));
      if (num > 0) return num;
    }
  }
  throw new Error("2028年車検の合計行が見つかりません");
}

// ============================================================================
// v3.0: 給与見込み連動（勤務 → 勤怠 → 給与 → 予算）・ガソリン代の通勤分
// 計算のルール・単価・係数は「残業時間管理」ブックの 勤務マスタ／設定 タブが正。
// ここには数字を直書きしない（ブックを直せば計算に反映される）。
// ============================================================================
const SALARY_SS_ID = "1BYdl6SdTXqYcwtivH7cEAYOLOpmtMOyQr0zBpiCssTc";   // 残業時間管理
const MILEAGE_SS_ID = "1mCk1swU7GLAmMQs-0KFQGCx99Lhr3k9QsBvgVD8RH-4";  // 点検シート（走行距離ログ）
// 年の書かれていない行（例「11月勤務分（12月支給）」）をどの年として読むか
const SALARY_BASE_YEAR = 2026;

function pad2_(n) { return (n < 10 ? "0" : "") + n; }
function ymOfDate_(d) { return d.getFullYear() + "-" + pad2_(d.getMonth() + 1); }
function dayStr_(d) { return d.getFullYear() + "-" + pad2_(d.getMonth() + 1) + "-" + pad2_(d.getDate()); }
function addDays_(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
function addMonthsYM_(ym, n) {
  const p = ym.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1 + n, 1);
  return ymOfDate_(d);
}
function normTitle_(s) {
  return String(s || "").normalize("NFKC").replace(/\s+/g, "").trim();
}
// "07:20" / Date / 0.3055…（時刻の数値） を "HH:mm" にそろえる
function timeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, "HH:mm");
  if (typeof v === "number" && v >= 0 && v < 1) {
    const m = Math.round(v * 24 * 60);
    return pad2_(Math.floor(m / 60)) + ":" + pad2_(m % 60);
  }
  return String(v || "").trim();
}
function atTime_(day, hhmm) {
  const p = hhmm.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), p[0] || 0, p[1] || 0, 0);
}

// 勤務マスタ: 勤務名 → { start, end, nextDay, kubun, add1, earlyMin, changeMin, holidayTarget }
function readShiftMaster_(sss) {
  const sh = sss.getSheetByName("勤務マスタ");
  if (!sh) throw new Error("残業時間管理ブックに「勤務マスタ」タブがありません");
  const rows = sh.getDataRange().getValues();
  const master = {};
  for (let i = 2; i < rows.length; i++) {
    const name = normTitle_(rows[i][0]);
    if (!name) break; // 表の終わり（空行のあとは共通ルールの文章）
    const start = timeStr_(rows[i][1]);
    master[name] = {
      name: String(rows[i][0]).trim(),
      allDay: start === "終日",
      start: start,
      end: timeStr_(rows[i][2]),
      nextDay: String(rows[i][3]).trim() === "はい",
      kubun: String(rows[i][4] || "").trim(),
      add1: Number(rows[i][5]) || 0,
      earlyMin: Number(rows[i][6]) || 0,
      changeMin: Number(rows[i][7]) || 0,
      holidayTarget: String(rows[i][9]).trim() === "はい"
    };
  }
  return master;
}

// 設定タブ: 項目名 → 値
function readSalarySettings_(sss) {
  const sh = sss.getSheetByName("設定");
  const out = {};
  if (!sh) return out;
  sh.getDataRange().getValues().forEach(function(r) {
    const k = String(r[0] || "").trim();
    if (!k || out.hasOwnProperty(k)) return;
    let v = r[1];
    if (v instanceof Date) v = Utilities.formatDate(v, TZ, "yyyy-MM-dd");
    out[k] = v;
  });
  return out;
}

// 勤務マスタにない予定の手動の割り当て（アプリで「入れる（勤務を選ぶ）／入れない」を選んだもの）
// 予定の見分け: 予定の日付（開始日）＋タイトル（空白をそろえたもの）
function eventOverrideKey_(dateStr, title) { return dateStr + "|" + normTitle_(title); }

// カレンダー（メイン）から勤務を読む。勤務マスタにないタイトルは unknown に入れる
// （手動で「入れる」にした予定は選んだ勤務として数え、「入れない」にした予定は excluded に入れる）
// v3.0.2: 給与計算に使わないカレンダー（初期値「遊び」。ブックの設定タブで変えられる）の予定は読まない
function collectShifts_(from, to, master, overrides, skipCalendarNames) {
  const cal = CalendarApp.getDefaultCalendar();
  const skipIds = {};
  (skipCalendarNames || []).forEach(function(name) {
    CalendarApp.getCalendarsByName(name).forEach(function(c) { skipIds[c.getId()] = true; });
  });
  delete skipIds[cal.getId()]; // メインのカレンダーそのものは除外しない（名前が重なったときの保険）
  let skippedCount = 0;
  const events = cal.getEvents(from, to).filter(function(ev) {
    let orig = "";
    try { orig = ev.getOriginalCalendarId(); } catch (e) {}
    if (skipIds[orig]) { skippedCount++; return false; }
    return true;
  });
  const shifts = [];
  const unknown = [];
  const excluded = [];
  const manual = [];
  const seen = {};
  const ovMap = {};
  (overrides || []).forEach(function(o) { if (o && o.key) ovMap[o.key] = o; });
  events.forEach(function(ev) {
    let key = normTitle_(ev.getTitle());
    let m = master[key];
    const evStart = ev.getStartTime();
    const evDay = new Date(evStart.getFullYear(), evStart.getMonth(), evStart.getDate());
    const isAllDay = ev.isAllDayEvent();
    const info = {
      key: eventOverrideKey_(dayStr_(evDay), ev.getTitle()),
      date: dayStr_(evDay), title: ev.getTitle(), allDay: isAllDay,
      time: isAllDay ? "" : Utilities.formatDate(evStart, TZ, "HH:mm") + "〜" + Utilities.formatDate(ev.getEndTime(), TZ, "HH:mm")
    };
    let isManual = false;
    if (!m) {
      const ov = ovMap[info.key];
      if (ov && ov.action === "exclude") { excluded.push(info); return; }
      // v3.0.2: 手入力（交替回数・残業などの時間を本人が入れた予定）。予定の日付の月に計上する
      if (ov && ov.action === "custom") {
        const num = function(v) { const n = Number(v); return isFinite(n) && n > 0 ? n : 0; };
        const c = {
          c1: Math.round(num(ov.c1)), c2: Math.round(num(ov.c2)), c3: Math.round(num(ov.c3)),
          earlyMin: Math.round(num(ov.earlyH) * 60), nightMin: Math.round(num(ov.nightH) * 60),
          holidayMin: Math.round(num(ov.holidayH) * 60), commute: !!ov.commute
        };
        info.custom = { c1: c.c1, c2: c.c2, c3: c.c3, earlyH: num(ov.earlyH), nightH: num(ov.nightH), holidayH: num(ov.holidayH), commute: c.commute };
        manual.push(info);
        shifts.push({
          key: "手入力:" + info.key, m: { name: ev.getTitle(), kubun: "", allDay: true }, custom: c,
          startDay: evDay, endDay: evDay, startDT: null, endDT: null
        });
        return;
      }
      const mm = ov && ov.action === "include" ? master[normTitle_(ov.shift)] : null;
      if (!mm) {
        // 割り当てた勤務が勤務マスタから消えていたら、未登録の予定に戻す
        if (ov && ov.action === "include") info.missingShift = String(ov.shift || "");
        unknown.push(info);
        return;
      }
      m = mm; key = normTitle_(ov.shift); isManual = true;
      info.shift = mm.name;
    }
    // 勤務の開始日。終日で入った夜勤（翌日終了）は「終わる日」に書かれている前提で前日を開始日にする
    let startDay = evDay;
    if (!m.allDay && isAllDay && m.nextDay) startDay = addDays_(evDay, -1);
    // 手動で夜勤に割り当てた時刻つきの予定が朝（12時前）に始まるなら、終わる日に書かれたものとみなす
    if (isManual && !m.allDay && !isAllDay && m.nextDay && evStart.getHours() < 12) startDay = addDays_(evDay, -1);
    if (isManual) manual.push(info);
    const id = key + "@" + dayStr_(startDay);
    if (seen[id]) return;
    seen[id] = true;
    const endDay = m.nextDay ? addDays_(startDay, 1) : startDay;
    shifts.push({
      key: key, m: m,
      startDay: startDay, endDay: endDay,
      startDT: m.allDay ? null : atTime_(startDay, m.start),
      endDT: m.allDay ? null : atTime_(endDay, m.end)
    });
  });
  shifts.sort(function(a, b) { return a.startDay - b.startDay; });
  return { shifts: shifts, unknown: unknown, excluded: excluded, manual: manual, skippedCount: skippedCount };
}

// 1か月分の勤怠を計算する（ルールは設計メモ v3.0 §2・勤務マスタの共通ルール）
function computeAttendance_(ym, shifts, extras) {
  const p = ym.split("-").map(Number);
  const mStart = new Date(p[0], p[1] - 1, 1);
  const mEnd = new Date(p[0], p[1], 1);
  const byStartDay = {};
  shifts.forEach(function(s) { (byStartDay[dayStr_(s.startDay)] = byStartDay[dayStr_(s.startDay)] || []).push(s); });

  let c1 = 0, c2 = 0, c3 = 0, earlyMin = 0, changeMin = 0, nightMin = 0, holidayMin = 0, customCount = 0;
  const days = [];
  shifts.forEach(function(s) {
    const sYM = ymOfDate_(s.startDay);
    const eYM = ymOfDate_(s.endDay);
    const m = s.m;
    // v3.0.2: 手入力の予定は、入れた回数・時間をそのまま予定の日付の月に足す
    if (s.custom) {
      if (sYM !== ym) return;
      const c = s.custom;
      c1 += c.c1; c2 += c.c2; c3 += c.c3;
      earlyMin += c.earlyMin; nightMin += c.nightMin; holidayMin += c.holidayMin;
      if (c.c1 + c.c2 + c.c3 > 0) days.push({ date: dayStr_(s.startDay), name: m.name + "（手入力）" });
      customCount++;
      return;
    }
    if (m.kubun === "1勤" && sYM === ym) c1++;
    if (m.kubun === "2勤" && sYM === ym) c2++;
    if (m.kubun === "3勤" && eYM === ym) c3++;
    // 1直の時間帯に4時間以上勤務する日の1勤加算。夜勤（翌日終了）は終わる日の月
    if (m.add1 && (m.nextDay ? eYM : sYM) === ym) c1 += m.add1;
    // 早出・延長。夜勤の延長は延長が発生した（終わる日の）月
    if (m.earlyMin && (m.nextDay ? eYM : sYM) === ym) earlyMin += m.earlyMin;
    // 着替えは勤務開始日の月
    if (m.changeMin && sYM === ym) changeMin += m.changeMin;
    // 深夜 22:00〜5:00（着替えの前後5分を含む）。分が属する月に計上
    if (s.startDT) {
      const half = (m.changeMin || 0) / 2;
      const a = new Date(s.startDT.getTime() - half * 60000);
      const b = new Date(s.endDT.getTime() + half * 60000);
      for (let d = addDays_(s.startDay, -1); d <= s.endDay; d = addDays_(d, 1)) {
        const ws = atTime_(d, "22:00");
        const we = atTime_(addDays_(d, 1), "05:00");
        const os = Math.max(a.getTime(), ws.getTime(), mStart.getTime());
        const oe = Math.min(b.getTime(), we.getTime(), mEnd.getTime());
        if (oe > os) nightMin += Math.round((oe - os) / 60000);
      }
    }
    // 休日出勤: 3直系の前日が2勤（2直・早2直）のときだけ 22:45〜23:00 の15分
    if (m.holidayTarget && sYM === ym) {
      const prev = byStartDay[dayStr_(addDays_(s.startDay, -1))] || [];
      if (prev.some(function(x) { return x.m.kubun === "2勤"; })) holidayMin += 15;
    }
    // 勤務した日（休みは数えない。年休は1勤が付くので数える）
    if (sYM === ym && (!m.allDay || m.add1)) days.push({ date: dayStr_(s.startDay), name: m.name });
  });
  // アプリから入力した臨時残業・臨時の休日出勤
  let extraEarly = 0, extraHoliday = 0;
  (extras || []).forEach(function(e) {
    if (String(e.date || "").slice(0, 7) !== ym) return;
    const min = Number(e.minutes) || 0;
    if (e.kind === "休日出勤") extraHoliday += min; else extraEarly += min;
  });
  earlyMin += extraEarly;
  holidayMin += extraHoliday;
  const r2 = function(x) { return Math.round(x * 100) / 100; };
  return {
    ym: ym, shiftCount: days.length, customCount: customCount,
    c1: c1, c2: c2, c3: c3,
    earlyH: r2((earlyMin + changeMin) / 60),
    nightH: r2(nightMin / 60),
    // ブックの「休日出勤時間計」＝ 休日出勤時間 ＋ 同じ時間の早残（休出係数の定義どおり）
    holidayTotalH: r2(holidayMin * 2 / 60),
    holidayH: r2(holidayMin / 60),
    extraEarlyMin: extraEarly, extraHolidayMin: extraHoliday,
    days: days
  };
}

// 片道の通勤回数（行き＝勤務の開始日、帰り＝終了日）。終日の予定（休み・年休）は数えない
function computeCommute_(shifts) {
  const out = {};
  shifts.forEach(function(s) {
    // v3.0.2: 手入力の予定は「出勤あり」にしたときだけ往復1回（行き・帰りとも予定の日付の月）
    if (s.custom) {
      if (!s.custom.commute) return;
      const ym = ymOfDate_(s.startDay);
      out[ym] = out[ym] || { oneWay: 0, workDays: 0 };
      out[ym].oneWay += 2; out[ym].workDays++;
      return;
    }
    if (!s.startDT) return;
    const a = ymOfDate_(s.startDay), b = ymOfDate_(s.endDay);
    out[a] = out[a] || { oneWay: 0, workDays: 0 };
    out[b] = out[b] || { oneWay: 0, workDays: 0 };
    out[a].oneWay++; out[a].workDays++;
    out[b].oneWay++;
  });
  return out;
}

// 「11月勤務分（12月支給）」「2025年12月勤務分（1月支給）」「12月賞与」などを読む
function parseSalaryLabel_(label) {
  const s = normTitle_(label);
  let m = s.match(/^(?:(\d{4})年)?(\d{1,2})月勤務分\((?:(\d{4})年)?(\d{1,2})月支給\)/);
  if (m) {
    const workM = Number(m[2]), payM = Number(m[4]);
    let workY = m[1] ? Number(m[1]) : null;
    let payY = m[3] ? Number(m[3]) : null;
    if (workY === null && payY !== null) workY = payM >= workM ? payY : payY - 1;
    if (workY === null) workY = SALARY_BASE_YEAR;
    if (payY === null) payY = payM >= workM ? workY : workY + 1;
    return { type: "salary", workYM: workY + "-" + pad2_(workM), payYM: payY + "-" + pad2_(payM) };
  }
  m = s.match(/^(?:(\d{4})年)?(\d{1,2})月賞与/);
  if (m) {
    const y = m[1] ? Number(m[1]) : SALARY_BASE_YEAR;
    return { type: "bonus", workYM: "", payYM: y + "-" + pad2_(Number(m[2])) };
  }
  return null;
}

function salaryLabel_(workYM) {
  const w = workYM.split("-").map(Number);
  const pay = addMonthsYM_(workYM, 1).split("-").map(Number);
  return w[0] + "年" + w[1] + "月勤務分（" + pay[0] + "年" + pay[1] + "月支給）";
}

// 給与計算タブ・控除計算タブで、勤務月の行を探す（なければ「次回分」の前に作る）
function findSalaryRow_(sheet, workYM) {
  const colA = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 0; i < colA.length; i++) {
    const p = parseSalaryLabel_(colA[i][0]);
    if (p && p.type === "salary" && p.workYM === workYM) return i + 1;
  }
  return 0;
}
function findLabelRow_(sheet, label) {
  const colA = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = 0; i < colA.length; i++) if (normTitle_(colA[i][0]) === normTitle_(label)) return i + 1;
  return 0;
}
function createSalaryRows_(sss, workYM) {
  const pay = sss.getSheetByName("給与計算");
  const ded = sss.getSheetByName("控除計算");
  const label = salaryLabel_(workYM);
  // 給与計算タブ
  let pr = findLabelRow_(pay, "次回分");
  if (!pr) throw new Error("給与計算タブに「次回分」の行がありません");
  pay.insertRowBefore(pr);
  const r = pr;
  const S = "'設定'!";
  pay.getRange(r, 1, 1, 16).setValues([[
    label, "予想（カレンダー）", "", "", "",
    "=IF(C" + r + "=\"\",\"\",C" + r + "*" + S + "$B$6+D" + r + "*" + S + "$B$7+E" + r + "*" + S + "$B$8)",
    "",
    "=IF(C" + r + "=\"\",\"\",G" + r + "*(" + S + "$B$3+" + S + "$B$4+F" + r + ")*" + S + "$B$12)",
    "",
    "=IF(C" + r + "=\"\",\"\",I" + r + "*(" + S + "$B$3+" + S + "$B$4+F" + r + ")*" + S + "$B$13)",
    "",
    "=IF(C" + r + "=\"\",\"\",K" + r + "*(" + S + "$B$3+" + S + "$B$4+F" + r + ")*" + S + "$B$14)",
    "=IF(C" + r + "=\"\",\"\"," + S + "$B$3+" + S + "$B$4+F" + r + "+H" + r + "+J" + r + "+L" + r + "+" + S + "$B$5)",
    "",
    "=IF(N" + r + "=\"\",\"\",M" + r + "-N" + r + ")",
    "家計簿 v3.0 が自動で追加した行（カレンダーの勤務から勤怠を自動計算）"
  ]]);
  // 控除計算タブ
  let dr = findLabelRow_(ded, "次回分");
  if (!dr) throw new Error("控除計算タブに「次回分」の行がありません");
  ded.insertRowBefore(dr);
  const q = dr;
  const C = "C" + q;
  ded.getRange(q, 1, 1, 19).setValues([[
    label, "予想（給与計算と連動）",
    "=IF('給与計算'!M" + r + "=\"\",\"\",'給与計算'!M" + r + ")",
    "=IF(" + C + "=\"\",\"\",ROUND((" + C + "-(F" + q + "+G" + q + "+H" + q + "+I" + q + "+J" + q + "))*" + S + "$B$36+" + S + "$B$37,0))",
    "=" + S + "$B$32",
    "=ROUND(" + S + "$B$26*" + S + "$B$27,0)",
    "=ROUND(" + S + "$B$26*" + S + "$B$28,0)",
    "=ROUND(" + S + "$B$26*" + S + "$B$29,0)",
    "=ROUND(" + S + "$B$26*" + S + "$B$30,0)",
    "=IF(" + C + "=\"\",\"\",ROUND(" + C + "*" + S + "$B$31,0))",
    "=" + S + "$B$33", "=" + S + "$B$34", "=" + S + "$B$35",
    "",
    "=IF(" + C + "=\"\",\"\",SUM(D" + q + ":N" + q + "))",
    "=IF(" + C + "=\"\",\"\"," + C + "-O" + q + ")",
    "",
    "=IF(Q" + q + "=\"\",\"\",P" + q + "-Q" + q + ")",
    "家計簿 v3.0 が自動で追加した行。明細が出たら実績の控除内訳を入れる"
  ]]);
  return r;
}

// 勤怠を給与計算タブの「予想」の行に書き込む（実績の行は絶対に書き換えない）。変更前の値はログに残す
function writeAttendance_(sss, att) {
  const pay = sss.getSheetByName("給与計算");
  let r = findSalaryRow_(pay, att.ym);
  if (!r) r = createSalaryRows_(sss, att.ym);
  const kubun = String(pay.getRange(r, 2).getValue());
  if (kubun.indexOf("予想") < 0) return { row: r, written: false, reason: "実績の行のため書き込まない" };
  const before = pay.getRange(r, 3, 1, 9).getValues()[0]; // C〜K
  const after = [att.c1, att.c2, att.c3, null, att.earlyH, null, att.nightH, null, att.holidayTotalH];
  const changed = [0, 1, 2, 4, 6, 8].some(function(i) { return Number(before[i]) !== Number(after[i]) || before[i] === ""; });
  if (!changed) return { row: r, written: false, reason: "変更なし" };
  pay.getRange(r, 3, 1, 3).setValues([[att.c1, att.c2, att.c3]]);
  pay.getRange(r, 7).setValue(att.earlyH);
  pay.getRange(r, 9).setValue(att.nightH);
  pay.getRange(r, 11).setValue(att.holidayTotalH);
  let log = sss.getSheetByName("自動計算ログ");
  if (!log) {
    log = sss.insertSheet("自動計算ログ");
    log.appendRow(["日時", "勤務月", "行", "変更前（1勤・2勤・3勤・早出h・深夜h・休日出勤時間計）", "変更後"]);
  }
  log.appendRow([
    Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss"), att.ym, r,
    [before[0], before[1], before[2], before[4], before[6], before[8]].join(" / "),
    [att.c1, att.c2, att.c3, att.earlyH, att.nightH, att.holidayTotalH].join(" / ")
  ]);
  return { row: r, written: true };
}

// 控除計算タブから、支給ごとの見込み・実績を読む
function readSalaryEntries_(sss) {
  const ded = sss.getSheetByName("控除計算");
  const pay = sss.getSheetByName("給与計算");
  const num = function(v) { return (v === "" || v === null || v === undefined || isNaN(Number(v))) ? null : Math.round(Number(v)); };
  const att = {};
  pay.getDataRange().getValues().forEach(function(r) {
    const p = parseSalaryLabel_(r[0]);
    if (!p || p.type !== "salary") return;
    att[p.workYM] = {
      c1: num(r[2]), c2: num(r[3]), c3: num(r[4]),
      earlyH: r[6] === "" ? null : Number(r[6]), nightH: r[8] === "" ? null : Number(r[8]),
      holidayTotalH: r[10] === "" ? null : Number(r[10]),
      grossCalc: num(r[12]), grossActual: num(r[13])
    };
  });
  const entries = [];
  ded.getDataRange().getValues().forEach(function(r) {
    const p = parseSalaryLabel_(r[0]);
    if (!p) return;
    entries.push({
      label: String(r[0]), type: p.type, workYM: p.workYM, payYM: p.payYM,
      kubun: String(r[1] || ""),
      gross: num(r[2]), deductions: num(r[14]), netCalc: num(r[15]), netActual: num(r[16]),
      yearEnd: num(r[13]),
      attendance: p.type === "salary" ? (att[p.workYM] || null) : null
    });
  });
  return entries;
}

// 点検シートの走行距離ログ（日付・総走行距離・メモ）
function readMileage_() {
  const sh = SpreadsheetApp.openById(MILEAGE_SS_ID).getSheetByName("走行距離ログ");
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  const out = [];
  for (let i = 2; i < rows.length; i++) {
    let d = rows[i][0];
    if (d instanceof Date) d = Utilities.formatDate(d, TZ, "yyyy-MM-dd");
    d = String(d || "").trim();
    const km = Number(String(rows[i][1]).replace(/[^0-9.]/g, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(km > 0)) continue;
    out.push({ date: d, km: km, memo: String(rows[i][4] || "") });
  }
  out.sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  return out;
}

// 家計簿の Config にある「臨時残業・臨時の休日出勤」の入力
function readExtraOvertime_(ss) {
  const rows = getSheetData(ss, "Config");
  const row = rows.find(function(r) { return r.key === "salary_extra_overtime"; });
  if (!row || !row.value) return [];
  try { const v = JSON.parse(String(row.value)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

// 家計簿の Config にある「計算に入れていない予定」の手動の割り当て
function readEventOverrides_(ss) {
  const rows = getSheetData(ss, "Config");
  const row = rows.find(function(r) { return r.key === "salary_event_overrides"; });
  if (!row || !row.value) return [];
  try { const v = JSON.parse(String(row.value)); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}

function getSalaryForecast_(ss) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (e) { return { status: "busy", message: "他の処理が実行中です。少し待ってから再計算してください。" }; }
  try {
    const sss = SpreadsheetApp.openById(SALARY_SS_ID);
    const master = readShiftMaster_(sss);
    const extras = readExtraOvertime_(ss);
    const nowYM = ymOfDate_(new Date());
    // 勤務の読み取り範囲: 5か月前〜翌月（通勤回数は過去の月も使う）
    const firstYM = addMonthsYM_(nowYM, -5);
    const lastYM = addMonthsYM_(nowYM, 1);
    const fp = firstYM.split("-").map(Number), lp = lastYM.split("-").map(Number);
    const from = new Date(fp[0], fp[1] - 1, 1); from.setDate(from.getDate() - 2);
    const to = new Date(lp[0], lp[1], 1); to.setDate(to.getDate() + 2);
    const settings = readSalarySettings_(sss);
    const skipCals = String(settings["給与計算に使わないカレンダー"] || "遊び").split(/[,、，]/).map(function(s) { return s.trim(); }).filter(String);
    const got = collectShifts_(from, to, master, readEventOverrides_(ss), skipCals);

    // 勤怠の自動計算とブックへの書き込みは 前月・今月・翌月 だけ（勤務が1件もない月は書き込まない）
    const attendance = {};
    const writes = {};
    [addMonthsYM_(nowYM, -1), nowYM, lastYM].forEach(function(ym) {
      const a = computeAttendance_(ym, got.shifts, extras);
      attendance[ym] = a;
      if (a.shiftCount > 0 || a.customCount > 0) {
        try { writes[ym] = writeAttendance_(sss, a); }
        catch (err) { writes[ym] = { written: false, reason: String(err) }; }
      }
    });
    SpreadsheetApp.flush();

    const unknownByYM = {};
    got.unknown.forEach(function(u) { (unknownByYM[u.date.slice(0, 7)] = unknownByYM[u.date.slice(0, 7)] || []).push(u); });
    const excludedByYM = {}, manualByYM = {};
    got.excluded.forEach(function(u) { (excludedByYM[u.date.slice(0, 7)] = excludedByYM[u.date.slice(0, 7)] || []).push(u); });
    got.manual.forEach(function(u) { (manualByYM[u.date.slice(0, 7)] = manualByYM[u.date.slice(0, 7)] || []).push(u); });
    // アプリの選択肢用（勤務マスタの順）
    const shiftNames = Object.keys(master).map(function(k) {
      const m = master[k];
      return { name: m.name, time: m.allDay ? "終日" : (m.nextDay ? "前日" : "") + m.start + "〜" + m.end };
    });

    let mileage = [], mileageError = "";
    try { mileage = readMileage_(); } catch (err) { mileageError = String(err); }

    return {
      status: "ok",
      computedAt: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"),
      entries: readSalaryEntries_(sss),
      attendance: attendance,
      writes: writes,
      unknownEvents: unknownByYM,
      excludedEvents: excludedByYM,
      manualEvents: manualByYM,
      shiftNames: shiftNames,
      skipCalendars: skipCals.map(function(n) { return { name: n, found: CalendarApp.getCalendarsByName(n).length > 0 }; }),
      skippedCount: got.skippedCount,
      commute: computeCommute_(got.shifts),
      mileage: mileage,
      mileageError: mileageError,
      settings: {
        winterBonus: settings["冬の賞与 総支給（見込み）"] || "",
        summerBonusDate: settings["夏の賞与 支給日"] || "",
        winterBonusDate: settings["冬の賞与 支給日"] || "",
        payDay: Number(settings["給料日"]) || 25,
        oneWayKm: Number(settings["片道通勤距離（km）"]) || 0,
        yearEndStage: String(settings["年末調整の状態"] || "試算"),
        basicDeduction: settings["基礎控除（年末調整用）"] || ""
      }
    };
  } catch (err) {
    return { status: "error", message: String(err) };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================================
// v6.0: クレカの利用通知メール（三井住友カード）と Amazon の注文メールから「下書き」を作る
//   - 下書きは MailDrafts シートに貯める（アプリが丸ごと上書きしないシート）。
//   - アプリの確認一覧で本人が確かめてから明細にする（自動で明細にはしない）。
//   - 最初に1回だけ、エディタで setupMailTrigger を実行する（Gmail・外部通信の承認と1時間ごとのトリガー）。
// ============================================================================
const MAIL_DRAFT_SHEET = "MailDrafts";
const MAIL_DRAFT_HEADERS = ["id","msgId","kind","card","useAt","store","amount","fxAmount","fxCur","fxRate","fxRateDate","orderNo","status","receivedAt","subject","note"];
const VPASS_FROM = "statement@vpass.ne.jp";
const AMAZON_FROM = "auto-confirm@amazon.co.jp";

function mailNorm_(s) {
  return String(s || "").normalize("NFKC").replace(/ /g, " ").replace(/\r/g, "");
}

function htmlToText_(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|tr|td|th|li|h\d|table|a)(\s[^>]*)?>/gi, "\n")
    .replace(/<\/span>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&yen;/g, "¥").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(Number(n)); })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n");
}

// 本文（テキスト）。テキスト版に目印が無ければ HTML 版から作る
function mailText_(msg, marks) {
  let t = "";
  try { t = mailNorm_(msg.getPlainBody()); } catch (e) {}
  if (!marks.test(t)) {
    try { t = mailNorm_(htmlToText_(msg.getBody())); } catch (e) {}
  }
  return t;
}

function mailNum_(s) {
  const n = Number(String(s || "").replace(/[,\s]/g, ""));
  return isFinite(n) ? n : 0;
}

// 三井住友カード「ご利用のお知らせ」: カード名と「ご利用日時」ごとの 店名・金額（円 か 外貨）
function parseVpassMail_(text) {
  const t = mailNorm_(text);
  const out = { card: "", items: [] };
  const mc = t.match(/([^\n。]{1,60}?)について\s*カードの\s*(?:ご)?利用内容をお知らせ/);
  if (mc) out.card = mc[1].replace(/\s+/g, "").trim();
  const parts = t.split(/ご利用日時\s*[:]\s*/).slice(1);
  parts.forEach(function(p) {
    const m = p.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(\d{1,2}):(\d{2})/);
    if (!m) return;
    let rest = p.slice(m[0].length);
    const stop = rest.search(/本メールは|ご利用日時/);
    if (stop >= 0) rest = rest.slice(0, stop);
    // 金額は店名の後ろ。店名に数字が入ることがあるので、いちばん後ろの「数字＋円／通貨」を使う
    const re = /(-?\d[\d,]*(?:\.\d+)?)\s*(円|[A-Z]{3})(?![A-Za-z])/g;
    let am = null, x;
    while ((x = re.exec(rest)) !== null) am = { index: x.index, num: x[1], cur: x[2] };
    if (!am) return;
    let store = rest.slice(0, am.index).replace(/\s+/g, " ").trim();
    let kindNote = "";
    const km = store.match(/\(([^()]{1,10})\)\s*$/);
    if (km) { kindNote = km[1]; store = store.slice(0, km.index).trim(); }
    const useAt = m[1] + "-" + pad2_(Number(m[2])) + "-" + pad2_(Number(m[3])) + " " + pad2_(Number(m[4])) + ":" + m[5];
    const item = { useAt: useAt, store: store, kindNote: kindNote };
    if (am.cur === "円") { item.amount = mailNum_(am.num); item.cur = "JPY"; }
    else { item.fxAmount = mailNum_(am.num); item.cur = am.cur; item.amount = 0; }
    out.items.push(item);
  });
  return out;
}

// Amazon の注文確認: 注文番号・合計・先頭の商品名（「もう一度買う」から下は読まない）
function parseAmazonMail_(text) {
  let t = mailNorm_(text);
  const cut = t.search(/もう一度買う|おすすめ商品|この商品を買った人/);
  if (cut > 0) t = t.slice(0, cut);
  const out = { orderNo: "", total: 0, item: "", count: 0 };
  const om = t.match(/注文番号\s*[:#]?\s*(\d{3}-\d{7}-\d{7})/);
  if (om) out.orderNo = om[1];
  const re = /(?:ご請求額|注文合計|合計)\s*[:]?\s*(?:\(税込\))?\s*¥\s*([\d,]+)/g;
  let x;
  while ((x = re.exec(t)) !== null) out.total = mailNum_(x[1]);
  const items = [];
  const ir = /([^\n]{2,160})\n\s*数量\s*[:]\s*(\d+)/g;
  while ((x = ir.exec(t)) !== null) items.push(x[1].replace(/\s+/g, " ").trim());
  out.count = items.length;
  if (items.length) out.item = items[0].replace(/(\.\.\.|…)$/, "").trim().slice(0, 60);
  return out;
}

// 利用日の為替レート（1通貨あたり何円）。欧州中央銀行の基準レート（frankfurter）。取れなければ直近に取れたレート
function fxRateToJpy_(cur, dateStr) {
  if (!cur || cur === "JPY") return { rate: 1, date: dateStr };
  const props = PropertiesService.getScriptProperties();
  const urls = [
    "https://api.frankfurter.app/" + dateStr + "?from=" + encodeURIComponent(cur) + "&to=JPY",
    "https://api.frankfurter.dev/v1/" + dateStr + "?base=" + encodeURIComponent(cur) + "&symbols=JPY"
  ];
  for (let i = 0; i < urls.length; i++) {
    try {
      const res = UrlFetchApp.fetch(urls[i], { muteHttpExceptions: true });
      if (res.getResponseCode() === 200) {
        const j = JSON.parse(res.getContentText());
        const r = j && j.rates ? Number(j.rates.JPY) : 0;
        if (r > 0) {
          props.setProperty("FX_LAST_" + cur, JSON.stringify({ rate: r, date: String(j.date || dateStr) }));
          return { rate: r, date: String(j.date || dateStr) };
        }
      }
    } catch (err) {}
  }
  const last = props.getProperty("FX_LAST_" + cur);
  if (last) {
    try { const o = JSON.parse(last); return { rate: Number(o.rate) || 0, date: String(o.date || "") + "（直近）" }; } catch (e) {}
  }
  return { rate: 0, date: "" };
}

function getMailDraftSheet_(ss) {
  let sheet = ss.getSheetByName(MAIL_DRAFT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(MAIL_DRAFT_SHEET);
    sheet.getRange(1, 1, 1, MAIL_DRAFT_HEADERS.length).setValues([MAIL_DRAFT_HEADERS]);
    sheet.getRange(1, 1, 1000, MAIL_DRAFT_HEADERS.length).setNumberFormat("@");
  }
  return sheet;
}

// 取り込みを始める日時（スクリプト プロパティ MAIL_SINCE。"2026-11-20 08:00" の形。手で早めることもできる）
function mailSince_() {
  const s = String(PropertiesService.getScriptProperties().getProperty("MAIL_SINCE") || "").trim();
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
}

function mailDraftList_(ss, onlyOpen) {
  const sheet = ss.getSheetByName(MAIL_DRAFT_SHEET);
  if (!sheet) return [];
  const rows = getSheetData(ss, MAIL_DRAFT_SHEET);
  return onlyOpen ? rows.filter(function(r) { return String(r.status) === "new"; }) : rows;
}

// トリガー（1時間ごと）から呼ばれる
function importCardMails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try { importCardMails_(); } finally { lock.releaseLock(); }
}

function importCardMails_() {
  const since = mailSince_();
  if (!since) return { added: 0, message: "setupMailTrigger がまだ実行されていません（MAIL_SINCE が無い）" };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getMailDraftSheet_(ss);
  const existing = mailDraftList_(ss, false);
  const seen = {};
  let nextId = 0;
  existing.forEach(function(r) {
    seen[String(r.msgId).split("#")[0]] = true;
    nextId = Math.max(nextId, Number(r.id) || 0);
  });
  const after = Utilities.formatDate(addDays_(since, -1), TZ, "yyyy/MM/dd");
  const out = [];
  const add = function(o) {
    nextId += 1;
    out.push(MAIL_DRAFT_HEADERS.map(function(h) { return h === "id" ? nextId : (o[h] !== undefined && o[h] !== null ? o[h] : ""); }));
  };
  const sources = [
    { kind: "vpass", from: VPASS_FROM, q: "from:" + VPASS_FROM + " subject:ご利用のお知らせ after:" + after, marks: /ご利用日時/ },
    { kind: "amazon", from: AMAZON_FROM, q: "from:" + AMAZON_FROM + " after:" + after, marks: /合計|注文番号/ }
  ];
  sources.forEach(function(src) {
    const threads = GmailApp.search(src.q, 0, 100);
    threads.forEach(function(th) {
      th.getMessages().forEach(function(msg) {
        const id = msg.getId();
        if (seen[id]) return;
        const when = msg.getDate();
        if (when.getTime() < since.getTime()) return;
        if (String(msg.getFrom()).toLowerCase().indexOf(src.from) < 0) return;
        seen[id] = true;
        const base = {
          msgId: id,
          receivedAt: Utilities.formatDate(when, TZ, "yyyy-MM-dd HH:mm"),
          subject: String(msg.getSubject() || "").slice(0, 120),
          status: "new"
        };
        const text = mailText_(msg, src.marks);
        if (src.kind === "vpass") {
          if (!/ご利用のお知らせ/.test(mailNorm_(base.subject))) return;
          const p = parseVpassMail_(text);
          if (!p.items.length) {
            add(Object.assign({}, base, { kind: "error", note: "読み取れませんでした（利用通知）" }));
            return;
          }
          p.items.forEach(function(it, k) {
            const o = Object.assign({}, base, {
              msgId: k === 0 ? id : id + "#" + k,
              kind: "vpass", card: p.card, useAt: it.useAt, store: it.store,
              amount: it.amount || 0, note: it.kindNote || ""
            });
            if (it.cur !== "JPY") {
              const fx = fxRateToJpy_(it.cur, it.useAt.slice(0, 10));
              o.fxAmount = it.fxAmount; o.fxCur = it.cur; o.fxRate = fx.rate; o.fxRateDate = fx.date;
              o.amount = fx.rate > 0 ? Math.round(it.fxAmount * fx.rate) : 0; // 上乗せ前の基準レートの額（上乗せはアプリで）
            }
            add(o);
          });
        } else {
          const a = parseAmazonMail_(text);
          if (!a.total) {
            if (/注文/.test(text)) add(Object.assign({}, base, { kind: "error", note: "読み取れませんでした（Amazon）" }));
            return;
          }
          add(Object.assign({}, base, {
            kind: "amazon", card: "Amazon", useAt: base.receivedAt, amount: a.total, orderNo: a.orderNo,
            store: a.item + (a.count > 1 ? " ほか" + (a.count - 1) + "点" : ""), note: ""
          }));
        }
      });
    });
  });
  if (out.length) {
    const start = sheet.getLastRow() + 1;
    sheet.getRange(start, 1, out.length, MAIL_DRAFT_HEADERS.length).setNumberFormat("@").setValues(out.map(function(r) { return r.map(String); }));
  }
  return { added: out.length };
}

// アプリが登録した／外した下書きの状態を書き換える（明細のデータ・DATA_REV には触らない）
function markMailDrafts_(ids, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(MAIL_DRAFT_SHEET);
  if (!sheet || !Array.isArray(ids) || ids.length === 0) return 0;
  const want = {};
  ids.forEach(function(i) { want[String(i)] = true; });
  const values = sheet.getDataRange().getValues();
  const idCol = MAIL_DRAFT_HEADERS.indexOf("id");
  const stCol = MAIL_DRAFT_HEADERS.indexOf("status");
  let n = 0;
  for (let r = 1; r < values.length; r++) {
    if (want[String(values[r][idCol])]) {
      sheet.getRange(r + 1, stCol + 1).setValue(status);
      n++;
    }
  }
  return n;
}

// ★最初に1回だけエディタで実行する: Gmail・外部通信の承認、MailDrafts シート、1時間ごとのトリガー、取り込みを始める日時
function setupMailTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "importCardMails") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("importCardMails").timeBased().everyHours(1).create();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("MAIL_SINCE")) props.setProperty("MAIL_SINCE", Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"));
  getMailDraftSheet_(SpreadsheetApp.getActiveSpreadsheet());
  GmailApp.search("from:" + VPASS_FROM, 0, 1);
  fxRateToJpy_("USD", Utilities.formatDate(addDays_(new Date(), -3), TZ, "yyyy-MM-dd"));
  Logger.log("設定しました。取り込みは " + props.getProperty("MAIL_SINCE") + " より後に届いたメールから（1時間ごと）。");
}

// 試し読み（シートには書かない）。直近のメールを読んで、読めた内容をログに出す
function testParseRecentMails() {
  [[VPASS_FROM, "subject:ご利用のお知らせ", "vpass", /ご利用日時/], [AMAZON_FROM, "", "amazon", /合計|注文番号/]].forEach(function(s) {
    const threads = GmailApp.search("from:" + s[0] + " " + s[1], 0, 3);
    threads.forEach(function(th) {
      const msg = th.getMessages().pop();
      const text = mailText_(msg, s[3]);
      const r = s[2] === "vpass" ? parseVpassMail_(text) : parseAmazonMail_(text);
      if (s[2] === "vpass") r.items.forEach(function(it) { if (it.cur && it.cur !== "JPY") it.fx = fxRateToJpy_(it.cur, it.useAt.slice(0, 10)); });
      Logger.log(Utilities.formatDate(msg.getDate(), TZ, "yyyy-MM-dd HH:mm") + " " + msg.getSubject() + "\n" + JSON.stringify(r));
    });
  });
}
