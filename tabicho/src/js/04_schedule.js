// ============================================================================
// 04 営業時間の解釈・工程計算・警告・絵文字の連続位置
// ============================================================================
const WD_CHARS = '日月火水木金土';

function daysFromSpec(spec) {
  const out = new Set();
  if (!spec) return out;
  if (/毎日|全日|年中/.test(spec)) { for (let i = 0; i < 7; i++) out.add(i); return out; }
  if (/平日/.test(spec)) [1, 2, 3, 4, 5].forEach(d => out.add(d));
  if (/土日/.test(spec)) { out.add(0); out.add(6); }
  spec = spec.replace(/平日|土日|祝日?|休日|営業日?|定休日?/g, ' ');
  const re = /([日月火水木金土])(?:曜日?)?\s*(?:[-~〜～ー–－]\s*([日月火水木金土])(?:曜日?)?)?/g;
  let m;
  while ((m = re.exec(spec))) {
    const a = WD_CHARS.indexOf(m[1]);
    if (m[2]) {
      const b = WD_CHARS.indexOf(m[2]);
      let i = a; for (let k = 0; k < 7; k++) { out.add(i); if (i === b) break; i = (i + 1) % 7; }
    } else out.add(a);
  }
  return out;
}

function parseTimeRanges(seg) {
  const out = [];
  const re = /(\d{1,2})(?:[:時](\d{2})?分?)?\s*[-~〜～ー–—－]\s*(翌)?(\d{1,2})(?:[:時](\d{2})?分?)?/g;
  let m;
  while ((m = re.exec(seg))) {
    const h1 = Number(m[1]), h2 = Number(m[4]);
    if (h1 > 30 || h2 > 30) continue;
    let a = h1 * 60 + Number(m[2] || 0);
    let b = h2 * 60 + Number(m[5] || 0);
    if (m[3]) b += 1440;
    if (b <= a) b += 1440;
    out.push([a, b]);
  }
  return out;
}

// 営業時間：テキスト（例「9:00-17:00 水曜定休」「平日10:00-18:00／土日9:00-17:00」）または
// 構造化 {0:[["09:00","17:00"]], ...} / {mon:"9:00-17:00", ...} を週次マップに正規化
function parseHours(src) {
  const res = { week: [null, null, null, null, null, null, null], text: '', irregular: false, known: false };
  if (src == null || src === '') return res;
  if (typeof src === 'object') {
    const keyMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, '日': 0, '月': 1, '火': 2, '水': 3, '木': 4, '金': 5, '土': 6 };
    Object.keys(src).forEach(k => {
      const d = /^\d$/.test(k) ? Number(k) : keyMap[String(k).toLowerCase()];
      if (d == null) return;
      const v = src[k];
      let ranges = [];
      if (v === false || v === null || v === 'closed' || v === '定休') ranges = [];
      else if (typeof v === 'string') ranges = parseTimeRanges(v.normalize('NFKC'));
      else if (Array.isArray(v)) ranges = v.map(r => { const a = toMin(r[0]), b = toMin(r[1]); return [a, b <= a ? b + 1440 : b]; });
      res.week[d] = ranges; res.known = true;
    });
    res.text = Object.keys(src).map(k => k + ':' + JSON.stringify(src[k])).join(' ');
    return res;
  }
  let t = String(src).normalize('NFKC');
  res.text = t;
  if (/不定休/.test(t)) res.irregular = true;
  const closed = new Set();
  const closeRes = [
    /定休日?\s*[:：]?\s*((?:[日月火水木金土](?:曜日?)?[\s・、,と及び~〜～\-]*)+)/g,
    /((?:[日月火水木金土](?:曜日?)?[\s・、,と]*)+)(?:定休|休業|休館|休み|休(?!憩))/g
  ];
  closeRes.forEach(re => {
    let m; while ((m = re.exec(t))) daysFromSpec(m[1]).forEach(d => closed.add(d));
  });
  let body = t.replace(closeRes[0], ' ').replace(closeRes[1], ' ');
  if (/24時間/.test(body)) {
    for (let i = 0; i < 7; i++) res.week[i] = closed.has(i) ? [] : [[0, 1440]];
    res.known = true; return res;
  }
  const segs = body.split(/[\n\/／;；|]|、(?=\s*(?:平日|土日|[日月火水木金土]曜|[日月火水木金土]\s*[-~〜～]))/);
  let def = null; const spec = {};
  segs.forEach(seg => {
    const ranges = parseTimeRanges(seg);
    if (!ranges.length) return;
    const firstDigit = seg.search(/\d/);
    const head = firstDigit > 0 ? seg.slice(0, firstDigit) : '';
    const days = daysFromSpec(head);
    if (days.size) days.forEach(d => { spec[d] = (spec[d] || []).concat(ranges); });
    else def = (def || []).concat(ranges);
  });
  for (let d = 0; d < 7; d++) {
    if (closed.has(d)) res.week[d] = [];
    else if (spec[d]) res.week[d] = spec[d];
    else if (def) res.week[d] = def;
  }
  res.known = res.week.some(w => w !== null);
  if (closed.size && !res.known) res.known = true;
  return res;
}

function hoursOn(hours, date) { return hours.week[weekday(date)]; }
// 例「月〜金 9:00–18:00 ／ 土日 10:00–17:00 ／ 水 定休」
function hoursSummary(hours) {
  if (!hours || !hours.known) return '';
  const lab = d => { const r = hours.week[d]; return r === null ? '?' : r.length ? rangesLabel(r) : '定休'; };
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];
  order.forEach(d => { const l = lab(d); const g = groups[groups.length - 1]; if (g && g.l === l) g.days.push(d); else groups.push({ l, days: [d] }); });
  return groups.map(g => (g.days.length > 2 ? WD[g.days[0]] + '〜' + WD[g.days[g.days.length - 1]] : g.days.map(d => WD[d]).join('')) + ' ' + g.l).join(' ／ ');
}
// 'open' | 'closed'(定休) | 'unknown'
function dayAvailability(hours, date) {
  const r = hoursOn(hours, date);
  if (r === null) return hours.irregular ? 'unknown' : (hours.known ? 'unknown' : 'unknown');
  return r.length ? 'open' : 'closed';
}
function rangesLabel(r) { return r.map(x => fmtMinLabel(x[0]) + '–' + fmtMinLabel(x[1])).join(', '); }
function dayHoursLabel(hours, date) {
  const r = hoursOn(hours, date);
  if (r === null) return hours.text ? '要確認' : '情報なし';
  if (!r.length) return '定休日';
  return rangesLabel(r) + (hours.irregular ? '（不定休あり）' : '');
}
// ある日時点の状態と閉店までの残り
function openStateAt(hours, date, minute) {
  const r = hoursOn(hours, date);
  // 前日の深夜営業分
  const prev = hours.week[(weekday(date) + 6) % 7];
  if (prev && prev.some(x => x[1] > 1440 && minute < x[1] - 1440)) {
    const x = prev.find(x => x[1] > 1440 && minute < x[1] - 1440);
    return { state: 'open', closeIn: x[1] - 1440 - minute };
  }
  if (r === null) return { state: 'unknown' };
  if (!r.length) return { state: 'closed' };
  const cur = r.find(x => minute >= x[0] && minute < x[1]);
  if (cur) return { state: 'open', closeIn: cur[1] - minute, closeAt: cur[1] };
  const next = r.filter(x => x[0] > minute).sort((a, b) => a[0] - b[0])[0];
  if (next) return { state: 'before', opensAt: next[0], opensIn: next[0] - minute };
  return { state: 'after' };
}
function withinHours(hours, date, a, b) {
  const r = hoursOn(hours, date);
  if (r === null) return null;
  if (!r.length) return false;
  return r.some(x => a >= x[0] && b <= x[1]);
}

// ---------------------------------------------------------------------------
// 工程（しおり）計算
// ---------------------------------------------------------------------------
function isScheduled(it, trip) {
  if (!it.date || it.hiddenTime) return false;
  if (trip && trip.startDate) {
    const days = tripDays(trip);
    if (!days.includes(it.date)) return false;
  }
  return true;
}
function dayItems(trip, date) {
  return trip.items.filter(it => it.date === date && isScheduled(it, trip)).sort((a, b) => a.order - b.order);
}
function unscheduledItems(trip) {
  return trip.items.filter(it => !isScheduled(it, trip));
}

function daySchedule(trip, date) {
  const items = dayItems(trip, date);
  const dayStart = toMin(S.settings.dayStart) || 540;
  const rows = [];
  let cursor = null, prevEnd = null;
  items.forEach((it, i) => {
    const manualStart = toMin(it.start);
    let start;
    if (i === 0) start = manualStart != null ? manualStart : dayStart;
    else if ((it.locked || it.startManual) && manualStart != null) start = manualStart;
    else start = cursor;
    const stay = Math.max(0, num(it.stay, 0));
    const end = start + stay;
    const move = it.moveAfter != null && it.moveAfter !== '' ? num(it.moveAfter, 0) : 0;
    const info = itemInfo(trip, it);
    const warns = [];
    if (i > 0 && cursor != null && start < cursor - 0.5) {
      if (it.locked) warns.push({ lv: 'err', t: `間に合いません（${Math.round(cursor - start)}分不足）` });
      else warns.push({ lv: 'warn', t: `前の予定と${Math.round(cursor - start)}分重なり` });
    }
    if (i > 0 && prevEnd != null && start < prevEnd - 0.5 && !(cursor != null && start < cursor - 0.5)) warns.push({ lv: 'warn', t: '時間が重なっています' });
    if (it.kind !== 'move') {
      const r = hoursOn(info.hours, date);
      if (r !== null) {
        if (!r.length) warns.push({ lv: 'err', t: '定休日です' });
        else if (withinHours(info.hours, date, start, Math.max(end, start + 1)) === false) warns.push({ lv: 'warn', t: '営業時間外（' + rangesLabel(r) + '）' });
      } else if (info.hours.irregular) warns.push({ lv: 'info', t: '不定休あり・要確認' });
    }
    if (it.needsBooking) {
      const b = it.bookingId && trip.bookings.find(x => x.id === it.bookingId);
      if (!b || b.status !== '予約済') warns.push({ lv: 'warn', t: '要予約（未予約）' });
    }
    if (info.deleted) warns.push({ lv: 'info', t: 'スポット帳で削除済み' });
    rows.push({ it, info, start, end, stay, move, suggested: i === 0 ? null : cursor, warns, index: i });
    prevEnd = end;
    cursor = end + move;
  });
  return rows;
}

// 線全体を時間軸として、現在時刻がどの区間（滞在＋移動の時間枠）の何％かを返す
function progressOnRows(rows, nowMin) {
  if (!rows.length) return null;
  const n = rows.length;
  if (nowMin < rows[0].start) return { index: 0, frac: 0, state: 'before', minsTo: rows[0].start - nowMin };
  for (let i = 0; i < n; i++) {
    const s = rows[i].start;
    const e = i < n - 1 ? rows[i + 1].start : rows[i].end;
    if (nowMin >= s && nowMin < e) {
      const frac = e > s ? (nowMin - s) / (e - s) : 1;
      const staying = nowMin < rows[i].end;
      return { index: i, frac: clamp(frac, 0, 1), state: staying ? 'stay' : 'move', remain: staying ? rows[i].end - nowMin : e - nowMin };
    }
  }
  return { index: n - 1, frac: 1, state: 'after' };
}

// 予約（時刻あり）→ しおりの固定枠として工程に入れる
function syncBookingItems(trip) {
  let changed = false;
  trip.bookings.forEach(b => {
    let it = trip.items.find(x => x.bookingId === b.id);
    const hasTime = b.date && b.time && b.status !== 'キャンセル';
    if (!hasTime) {
      if (it && it.fromBooking) { trip.items = trip.items.filter(x => x !== it); changed = true; }
      else if (it && it.locked && b.status === 'キャンセル') { it.locked = false; changed = true; }
      return;
    }
    if (!it) {
      it = newItem({ kind: b.type === '交通' ? 'move' : 'fixed', fromBooking: true, bookingId: b.id, name: b.title, spotId: b.spotId || null, nameCache: b.title, stay: num(b.durationMin, 60), order: 0 });
      if (b.type === '交通') it.transport = { mode: b.transportMode || '', from: b.place || '', to: b.placeTo || '', number: b.number || '', platform: '' };
      trip.items.push(it);
      changed = true;
    }
    const fields = { date: b.date, start: b.time, locked: true, startManual: true };
    if (it.fromBooking) Object.assign(fields, { name: b.title, nameCache: b.title, spotId: b.spotId || it.spotId, stay: num(b.durationMin, it.stay || 60) });
    Object.keys(fields).forEach(k => { if (it[k] !== fields[k]) { it[k] = fields[k]; changed = true; } });
    if (it.hiddenTime && trip.mode === 'shiori') { it.hiddenTime = null; changed = true; }
    if (it.fromBooking && it._placed !== b.date + b.time) { placeByTime(trip, it); it._placed = b.date + b.time; changed = true; }
  });
  // 削除された予約から作られた枠を掃除
  const ids = new Set(trip.bookings.map(b => b.id));
  const before = trip.items.length;
  trip.items = trip.items.filter(x => !(x.fromBooking && !ids.has(x.bookingId)));
  trip.items.forEach(x => { if (x.bookingId && !ids.has(x.bookingId)) { x.bookingId = null; x.locked = false; } });
  return changed || before !== trip.items.length;
}

// 時刻に合わせて工程の並び位置（order）を決める
function placeByTime(trip, it) {
  const sameDay = dayItems(trip, it.date).filter(x => x !== it);
  const rows = daySchedule(Object.assign({}, trip, { items: sameDay }), it.date);
  const t = toMin(it.start);
  let order;
  const after = rows.filter(r => r.start <= t);
  const nextRow = rows.find(r => r.start > t);
  if (!after.length) order = (nextRow ? nextRow.it.order : Date.now()) - 1000;
  else if (!nextRow) order = after[after.length - 1].it.order + 1000;
  else order = (after[after.length - 1].it.order + nextRow.it.order) / 2;
  it.order = order;
}

function reorderDay(trip, date, ids) {
  ids.forEach((id, i) => { const it = trip.items.find(x => x.id === id); if (it) it.order = (i + 1) * 1000; });
}
