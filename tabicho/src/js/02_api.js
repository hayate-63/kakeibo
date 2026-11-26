// ============================================================================
// 02 サーバAPI（GAS google.script.run）＋ ローカル動作用モック
// ============================================================================
const IS_GAS = typeof google !== 'undefined' && google.script && google.script.run;
// デモモードは「手元で開いた時（file:// ・localhost）」か「#demo を付けた時」だけ。
// それ以外で GAS の接続部品が無い時はデモに切り替えず、エラーとして見せる（本番での無言フォールバックをしない）
const IS_DEV = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname || '');
const IS_DEMO = !IS_GAS && (IS_DEV || /[#&?]demo\b/.test(location.href));

function api(name, args) {
  if (IS_GAS) {
    return new Promise((resolve, reject) => {
      google.script.run
        .withSuccessHandler(r => {
          let o; try { o = typeof r === 'string' ? JSON.parse(r) : r; } catch (e) { return reject(e); }
          if (o && o.error) return reject(new Error(o.error));
          resolve(o);
        })
        .withFailureHandler(err => reject(err instanceof Error ? err : new Error(String(err && err.message || err))))
        .apiCall(name, JSON.stringify(args || {}));
    });
  }
  if (IS_DEMO) return MockServer.call(name, args || {});
  return Promise.reject(new Error('GAS の接続部品（google.script.run）がありません。旅帳は GAS のウェブアプリ URL から開いてください'));
}

// ---------------------------------------------------------------------------
// モックサーバ：GASに置く前の動作確認・デモ用。データはこのブラウザにだけ残る
// ---------------------------------------------------------------------------
// 模擬メディア（デモモード）：端末の localStorage に小さいサムネイルだけ持つ
const MockMedia = (() => {
  const KEY = 'tabicho_mock_media_v1';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} };
  return {
    pendingThumbs: {}, folders: {},
    add(f) { const db = load(); const id = 'MF' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); db[id] = f; save(db); return id; },
    get(id) { return load()[id] || null; },
    remove(id) { const db = load(); delete db[id]; save(db); },
    finish(q, file) {
      const kind = mediaKind(file);
      const lm = file.lastModified ? new Date(file.lastModified) : null;
      const takenAt = kind === 'photo' && lm ? ymd(lm) + 'T' + pad2(lm.getHours()) + ':' + pad2(lm.getMinutes()) + ':00' : '';  // EXIF の代わり
      const id = this.add({ name: file.name, mimeType: file.type, size: file.size, thumb: this.pendingThumbs[q.qid] || '', takenAt });
      delete this.pendingThumbs[q.qid];
      return { id, name: file.name, mimeType: file.type, size: String(file.size) };
    }
  };
})();

const MockServer = (() => {
  const KEY = 'tabicho_mock_db_v1';
  function load() {
    try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch (e) {}
    return seed();
  }
  function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {} }
  function seed() {
    const t = new Date().toISOString();
    const spots = [
      { id: 'SP0001', name: '淡路夢舞台', lat: 34.5636, lng: 135.0103, area: '淡路島', address: '兵庫県淡路市夢舞台2', hours: '9:00-18:00', tags: ['建築', '花', '春'], status: 'want', priority: 'must', stayMin: 60, price: 0, parking: true, station: '', updatedAt: t },
      { id: 'SP0002', name: 'あわじ花さじき', lat: 34.5398, lng: 134.9545, area: '淡路島', address: '兵庫県淡路市楠本2805-7', hours: '9:00-17:00 水曜定休', tags: ['花', '絶景'], status: 'want', priority: 'must', stayMin: 45, price: 0, parking: true, updatedAt: t },
      { id: 'SP0003', name: '淡路島バーガー本店', lat: 34.3445, lng: 134.8953, area: '淡路島', address: '兵庫県洲本市', hours: '10:00-17:00 火曜定休', tags: ['グルメ'], status: 'want', priority: 'maybe', stayMin: 40, price: 1500, parking: true, updatedAt: t },
      { id: 'SP0004', name: '大鳴門橋 渦の道', lat: 34.2381, lng: 134.6522, area: '淡路島', address: '徳島県鳴門市', hours: '9:00-18:00', tags: ['絶景'], status: 'want', priority: 'must', stayMin: 60, price: 510, parking: true, updatedAt: t },
      { id: 'SP0005', name: '洲本温泉', lat: 34.3401, lng: 134.9046, area: '淡路島', address: '兵庫県洲本市小路谷', hours: '', tags: ['温泉', '冬'], status: 'want', priority: 'maybe', stayMin: 90, price: 1000, parking: true, updatedAt: t },
      { id: 'SP0006', name: '伊勢神宮 内宮', lat: 34.4551, lng: 136.7254, area: '伊勢志摩', address: '三重県伊勢市宇治館町1', hours: '5:00-18:00', tags: ['神社'], status: 'want', priority: 'must', stayMin: 90, price: 0, parking: true, station: '五十鈴川駅', updatedAt: t },
      { id: 'SP0007', name: 'おかげ横丁', lat: 34.4626, lng: 136.7232, area: '伊勢志摩', address: '三重県伊勢市宇治中之切町', hours: '9:30-17:00', tags: ['グルメ', '街歩き'], status: 'want', priority: 'maybe', stayMin: 60, price: 2000, parking: false, station: '五十鈴川駅', updatedAt: t },
      { id: 'SP0008', name: '横山展望台', lat: 34.3016, lng: 136.7952, area: '伊勢志摩', address: '三重県志摩市阿児町', hours: '9:00-16:30', tags: ['絶景'], status: 'want', priority: 'must', stayMin: 40, price: 0, parking: true, updatedAt: t },
      { id: 'SP0009', name: '白川郷', lat: 36.2578, lng: 136.9060, area: '飛騨・白川郷', address: '岐阜県大野郡白川村', hours: '8:00-17:00', tags: ['世界遺産', '冬', '絶景'], status: 'want', priority: 'must', stayMin: 120, price: 0, parking: true, updatedAt: t },
      { id: 'SP0010', name: '飛騨高山 古い町並', lat: 36.1407, lng: 137.2622, area: '飛騨・白川郷', address: '岐阜県高山市上三之町', hours: '9:00-17:00', tags: ['街歩き', 'グルメ'], status: 'want', priority: 'maybe', stayMin: 90, price: 2000, parking: true, station: '高山駅', updatedAt: t },
      { id: 'SP0011', name: '新穂高ロープウェイ', lat: 36.2868, lng: 137.5744, area: '飛騨・白川郷', address: '岐阜県高山市奥飛騨温泉郷', hours: '8:30-16:45', tags: ['絶景', '紅葉', '秋'], status: 'want', priority: 'maybe', stayMin: 120, price: 3300, parking: true, updatedAt: t },
      { id: 'SP0012', name: '奈良公園', lat: 34.6851, lng: 135.8430, area: '奈良', address: '奈良県奈良市', hours: '', tags: ['公園', '紅葉', '秋'], status: 'want', priority: 'maybe', stayMin: 90, price: 0, parking: true, station: '近鉄奈良駅', updatedAt: t },
      { id: 'SP0013', name: '東大寺', lat: 34.6890, lng: 135.8398, area: '奈良', address: '奈良県奈良市雑司町406-1', hours: '7:30-17:30', tags: ['寺'], status: 'want', priority: 'must', stayMin: 60, price: 800, parking: true, station: '近鉄奈良駅', updatedAt: t },
      { id: 'SP0014', name: '位置不明の気になるカフェ', lat: null, lng: null, area: '', address: '', hours: '', tags: ['カフェ'], status: 'want', priority: 'maybe', updatedAt: t }
    ];
    return { trips: {}, settings: null, spots, visits: [], kakeibo: [], calendar: [] };
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const handlers = {
    async bootstrap() {
      const db = load();
      return { settings: db.settings, trips: Object.values(db.trips), serverTime: new Date().toISOString(), mock: true };
    },
    async saveTrip({ trip, baseUpdatedAt, force }) {
      const db = load();
      const cur = db.trips[trip.id];
      if (cur && !force && baseUpdatedAt && cur.updatedAt > baseUpdatedAt) return { conflict: true, trip: cur };
      trip.updatedAt = new Date().toISOString();
      db.trips[trip.id] = trip; save(db);
      return { ok: true, updatedAt: trip.updatedAt };
    },
    async deleteTrip({ id }) { const db = load(); delete db.trips[id]; save(db); return { ok: true }; },
    async saveSettings({ settings }) { const db = load(); db.settings = settings; save(db); return { ok: true }; },
    // 旅帳サーバ（Code.gs）がスポット帳 v3.1 の getAll から作る形と同じにする
    //   スポット帳には営業時間・滞在目安・料金・駐車場の列は無い（営業時間は placeHours で取る）
    async spotList() {
      const db = load();
      const spots = db.spots.map(s => ({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng, address: s.address, area: s.area, prefecture: '', city: '',
        tags: s.tags || [], status: db.visits.some(v => v.spotId === s.id) ? 'visited' : 'want', priority: s.priority === 'must' ? 'must' : null,
        placeId: s.lat != null ? 'mock_' + s.id : '', url: '', updatedAt: s.updatedAt,
        visits: db.visits.filter(v => v.spotId === s.id).map(v => ({ visitId: v.visitId, date: v.date, rating: v.rating, comment: v.comment || '', companions: v.companions || [], people: v.people || '', hasExtras: false }))
      }));
      return { ok: true, spots, serverTime: todayStr() };
    },
    async spotSetVisited({ spotId, visitId, visit }) {
      const db = load();
      if (!db.spots.find(s => s.id === spotId)) return { error: 'スポットが見つかりません: ' + spotId };
      let id = visitId || '';
      if (!visit) {
        db.visits = db.visits.filter(v => v.visitId !== visitId);
      } else {
        const r = Number(visit.rating);
        if (!(r >= 1 && r <= 5)) return { error: '評価（1〜5）を選んでください' };
        const row = { spotId, date: visit.date, rating: r, comment: visit.comment || '', companions: visit.companions || [], people: visit.people || '' };
        const cur = visitId && db.visits.find(v => v.visitId === visitId);
        if (cur) Object.assign(cur, row);
        else { db.seq = (db.seq || 0) + 1; id = 'V' + String(db.seq).padStart(4, '0'); db.visits.push(Object.assign({ visitId: id }, row)); }
      }
      save(db);
      const all = await handlers.spotList();
      return { ok: true, visitId: id, spot: all.spots.find(s => s.id === spotId) };
    },
    async spotCreate({ spot }) {
      const db = load();
      db.seqSpot = (db.seqSpot || 100) + 1;
      const s = { id: 'SP' + String(db.seqSpot).padStart(4, '0'), name: spot.name, lat: spot.lat, lng: spot.lng, address: spot.address || '', area: '', tags: [], priority: spot.priority === 'must' ? 'must' : null, hours: '', updatedAt: todayStr() };
      db.spots.push(s); save(db);
      const all = await handlers.spotList();
      return { ok: true, spot: all.spots.find(x => x.id === s.id) };
    },
    async placeHours({ spots }) {
      const db = load();
      const hours = {};
      (spots || []).forEach(q => { const s = db.spots.find(x => x.id === q.id); hours[q.id] = s && s.hours ? s.hours : null; });
      return { ok: true, hours };
    },
    async routes({ list }) {
      await sleep(150);
      return {
        ok: true, results: list.map(q => {
          const km = haversineKm(q.from, q.to);
          if (km == null) return null;
          const mode = q.mode || 'car';
          const min = estimateMinutes(km, mode);
          const roadKm = km * 1.35;
          const r = { km: Math.round(roadKm * 10) / 10, min, estimated: true };
          if (mode === 'car' && q.opt && q.opt.highway !== false && roadKm > 30) r.toll = Math.round((150 + roadKm * 0.6 * 24.6) / 10) * 10;
          if (mode === 'train') r.fare = Math.round((150 + roadKm * 18) / 10) * 10;
          return r;
        })
      };
    },
    async geocode({ address }) { await sleep(100); return { ok: true, result: null, note: 'モックでは住所検索はできません' }; },
    async weather({ points }) {
      const out = {};
      for (const p of points) {
        const k = p.lat.toFixed(1) + ',' + p.lng.toFixed(1);
        try {
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=16`);   // v2.0.4：地点の現地の日付
          const j = await r.json();
          out[k] = j.daily.time.map((d, i) => ({ date: d, code: j.daily.weather_code[i], tmax: j.daily.temperature_2m_max[i], tmin: j.daily.temperature_2m_min[i], pop: j.daily.precipitation_probability_max[i] }));
        } catch (e) {
          out[k] = Array.from({ length: 16 }, (_, i) => ({ date: addDays(todayStr(), i), code: [0, 1, 2, 3, 61][(i + Math.round(p.lat)) % 5], tmax: 15, tmin: 6, pop: 20, mock: true }));
        }
      }
      return { ok: true, weather: out };
    },
    async fxRates() {
      try {
        const r = await fetch('https://open.er-api.com/v6/latest/JPY');
        const j = await r.json();
        const rates = {};
        Object.keys(j.rates).forEach(k => { rates[k] = 1 / j.rates[k]; });
        return { ok: true, base: 'JPY', toJpy: rates, at: j.time_last_update_utc };
      } catch (e) {
        return { ok: true, base: 'JPY', toJpy: { JPY: 1, USD: 150, EUR: 162, TWD: 4.8, KRW: 0.108, CNY: 20.8, HKD: 19.3, THB: 4.3, SGD: 112, GBP: 190, AUD: 98 }, at: 'モック値', mock: true };
      }
    },
    async countryOf({ lat, lng }) {
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ja`);
        const j = await r.json();
        return { ok: true, country: j.countryCode || 'JP', name: j.countryName || '' };
      } catch (e) { return { ok: true, country: 'JP', name: '日本' }; }
    },
    async holidayBlocks({ from, to }) {
      const days = [];
      const fixed = ['01-01', '01-02', '01-03', '02-11', '02-23', '04-29', '05-03', '05-04', '05-05', '08-11', '11-03', '11-23', '12-30', '12-31'];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const w = weekday(d);
        const off = w === 0 || w === 6 || fixed.includes(d.slice(5));
        days.push({ date: d, off, reason: off ? (w === 0 || w === 6 ? '週末' : '祝日') : '' });
      }
      return { ok: true, days, source: 'モック（土日祝）' };
    },
    async calendarAdd({ title, date, start, end, location }) {
      const db = load(); const id = uid('ev'); db.calendar.push({ id, title, date, start, end, location }); save(db);
      return { ok: true, eventId: id };
    },
    async kakeiboSend({ logs }) {
      const db = load(); logs.forEach(l => db.kakeibo.push(l)); save(db);
      return { ok: true, sent: logs.length, keys: logs.map(l => l.sourceKey) };
    },
    // ---- v2.0 メディア（模擬）。window.__TABICHO_TEST_UPLOAD があればテスト用の resumable 模擬サーバに本当に PUT する ----
    async mediaSession({ folder, name, mimeType, size, origin }) {
      const hook = window.__TABICHO_TEST_UPLOAD;
      const folderId = folder.folderId || 'mockfolder_' + folder.tripId;
      const folderName = folder.folderId ? '' : folder.title;
      if (hook) {
        const r = await (await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'createSession', pin: '1234', name, mimeType, size, origin, originMode: 'send' }) })).json();
        MockMedia.folders[folderId] = `旅帳/${folder.year || '日程未定'}/${folder.region === 'overseas' ? '海外' : '国内'}/${folder.title}`;
        return { ok: true, sessionUri: r.sessionUri, folderId, folderName: folderName || MockMedia.folders[folderId] };
      }
      MockMedia.folders[folderId] = `旅帳/${folder.year || '日程未定'}/${folder.region === 'overseas' ? '海外' : '国内'}/${folder.title}`;
      return { ok: true, sessionUri: 'mock-upload://' + uid('s'), folderId, folderName: MockMedia.folders[folderId] };
    },
    async mediaStatus({ sessionUri, size }) {
      const hook = window.__TABICHO_TEST_UPLOAD;
      if (hook) return (await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'status', pin: '1234', sessionUri, size }) })).json();
      return { ok: true, code: 308, range: '' };
    },
    async mediaSmallUpload({ folder, name, mimeType, b64 }) {
      const id = MockMedia.add({ name, mimeType, size: Math.round(b64.length * 0.75) });
      return { ok: true, file: { id, name, mimeType, size: String(Math.round(b64.length * 0.75)) }, folderId: folder.folderId || 'mockfolder_' + folder.tripId };
    },
    async mediaMeta({ ids }) {
      const meta = {};
      ids.forEach(id => {
        const f = MockMedia.get(id);
        const g = f && String(f.name).match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);   // デモ用：ファイル名の @緯度,経度 を GPS とみなす
        meta[id] = f ? { id, name: f.name, mimeType: f.mimeType, size: f.size, takenAt: f.takenAt || '', hasThumbnail: !!f.thumb, videoReady: /^video/.test(f.mimeType), durationMs: /^video/.test(f.mimeType) ? 30000 : null, lat: g ? Number(g[1]) : null, lng: g ? Number(g[2]) : null } : { id, hasThumbnail: false };
      });
      return { ok: true, meta };
    },
    async mediaThumbs({ ids }) {
      const thumbs = {};
      ids.forEach(id => { const f = MockMedia.get(id); thumbs[id] = { meta: f ? { id, hasThumbnail: !!f.thumb, videoReady: /^video/.test(f.mimeType || ''), durationMs: /^video/.test(f.mimeType || '') ? 30000 : null } : { id }, thumb: f && f.thumb ? f.thumb : '' }; });
      return { ok: true, thumbs };
    },
    async placeNames({ points }) {
      const names = {};
      (points || []).forEach(p => { names[p.k || (Number(p.lat).toFixed(3) + ',' + Number(p.lng).toFixed(3))] = 'デモ地点（' + Number(p.lat).toFixed(2) + '）'; });
      return { ok: true, names };
    },
    async mediaTrash({ fileId }) { MockMedia.remove(fileId); return { ok: true }; },
    async translateTitle({ text }) {
      const dict = { '北海道': 'Hokkaido', '旅行': 'trip', '旅': 'trip', '東京': 'Tokyo', '京都': 'Kyoto', '大阪': 'Osaka', '沖縄': 'Okinawa', '淡路島': 'Awaji Island', 'ドライブ': 'drive', '伊勢志摩': 'Ise-Shima', '台湾': 'Taiwan', '奈良': 'Nara', '温泉': 'hot spring' };
      let out = text;
      Object.keys(dict).sort((a, b) => b.length - a.length).forEach(k => { out = out.split(k).join(' ' + dict[k] + ' '); });
      return { ok: true, text: kanaToRomaji(out).replace(/\s+/g, ' ').trim() };
    },
    async testConnections() {
      return { ok: true, spotcho: { ok: true, note: 'モック' }, kakeibo: { ok: true, note: 'モック' }, calendar: { ok: true, note: 'モック' }, maps: { ok: true, note: 'モック（直線距離からの概算）' }, media: { ok: true, note: 'モック（端末内）' } };
    }
  };
  return {
    async call(name, args) {
      await sleep(30);
      const h = handlers[name];
      if (!h) throw new Error('未知のAPI: ' + name);
      const r = await h(clone(args));
      if (r && r.error) throw new Error(r.error);
      return r;
    },
    reset() { localStorage.removeItem(KEY); }
  };
})();
