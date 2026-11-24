// ============================================================================
// 02 サーバAPI（GAS google.script.run）＋ ローカル動作用モック
// ============================================================================
const IS_GAS = typeof google !== 'undefined' && google.script && google.script.run;

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
  return MockServer.call(name, args || {});
}

// ---------------------------------------------------------------------------
// モックサーバ：GASに置く前の動作確認・デモ用。データはこのブラウザにだけ残る
// ---------------------------------------------------------------------------
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
      { id: 'sp1', name: '淡路夢舞台', lat: 34.5636, lng: 135.0103, area: '淡路島', address: '兵庫県淡路市夢舞台2', hours: '9:00-18:00', tags: ['建築', '花', '春'], status: 'want', priority: 'must', stayMin: 60, price: 0, parking: true, station: '', updatedAt: t },
      { id: 'sp2', name: 'あわじ花さじき', lat: 34.5398, lng: 134.9545, area: '淡路島', address: '兵庫県淡路市楠本2805-7', hours: '9:00-17:00 水曜定休', tags: ['花', '絶景'], status: 'want', priority: 'must', stayMin: 45, price: 0, parking: true, updatedAt: t },
      { id: 'sp3', name: '淡路島バーガー本店', lat: 34.3445, lng: 134.8953, area: '淡路島', address: '兵庫県洲本市', hours: '10:00-17:00 火曜定休', tags: ['グルメ'], status: 'want', priority: 'maybe', stayMin: 40, price: 1500, parking: true, updatedAt: t },
      { id: 'sp4', name: '大鳴門橋 渦の道', lat: 34.2381, lng: 134.6522, area: '淡路島', address: '徳島県鳴門市', hours: '9:00-18:00', tags: ['絶景'], status: 'want', priority: 'must', stayMin: 60, price: 510, parking: true, updatedAt: t },
      { id: 'sp5', name: '洲本温泉', lat: 34.3401, lng: 134.9046, area: '淡路島', address: '兵庫県洲本市小路谷', hours: '', tags: ['温泉', '冬'], status: 'want', priority: 'maybe', stayMin: 90, price: 1000, parking: true, updatedAt: t },
      { id: 'sp6', name: '伊勢神宮 内宮', lat: 34.4551, lng: 136.7254, area: '伊勢志摩', address: '三重県伊勢市宇治館町1', hours: '5:00-18:00', tags: ['神社'], status: 'want', priority: 'must', stayMin: 90, price: 0, parking: true, station: '五十鈴川駅', updatedAt: t },
      { id: 'sp7', name: 'おかげ横丁', lat: 34.4626, lng: 136.7232, area: '伊勢志摩', address: '三重県伊勢市宇治中之切町', hours: '9:30-17:00', tags: ['グルメ', '街歩き'], status: 'want', priority: 'maybe', stayMin: 60, price: 2000, parking: false, station: '五十鈴川駅', updatedAt: t },
      { id: 'sp8', name: '横山展望台', lat: 34.3016, lng: 136.7952, area: '伊勢志摩', address: '三重県志摩市阿児町', hours: '9:00-16:30', tags: ['絶景'], status: 'want', priority: 'must', stayMin: 40, price: 0, parking: true, updatedAt: t },
      { id: 'sp9', name: '白川郷', lat: 36.2578, lng: 136.9060, area: '飛騨・白川郷', address: '岐阜県大野郡白川村', hours: '8:00-17:00', tags: ['世界遺産', '冬', '絶景'], status: 'want', priority: 'must', stayMin: 120, price: 0, parking: true, updatedAt: t },
      { id: 'sp10', name: '飛騨高山 古い町並', lat: 36.1407, lng: 137.2622, area: '飛騨・白川郷', address: '岐阜県高山市上三之町', hours: '9:00-17:00', tags: ['街歩き', 'グルメ'], status: 'want', priority: 'maybe', stayMin: 90, price: 2000, parking: true, station: '高山駅', updatedAt: t },
      { id: 'sp11', name: '新穂高ロープウェイ', lat: 36.2868, lng: 137.5744, area: '飛騨・白川郷', address: '岐阜県高山市奥飛騨温泉郷', hours: '8:30-16:45', tags: ['絶景', '紅葉', '秋'], status: 'want', priority: 'maybe', stayMin: 120, price: 3300, parking: true, updatedAt: t },
      { id: 'sp12', name: '奈良公園', lat: 34.6851, lng: 135.8430, area: '奈良', address: '奈良県奈良市', hours: '', tags: ['公園', '紅葉', '秋'], status: 'want', priority: 'maybe', stayMin: 90, price: 0, parking: true, station: '近鉄奈良駅', updatedAt: t },
      { id: 'sp13', name: '東大寺', lat: 34.6890, lng: 135.8398, area: '奈良', address: '奈良県奈良市雑司町406-1', hours: '7:30-17:30', tags: ['寺'], status: 'want', priority: 'must', stayMin: 60, price: 800, parking: true, station: '近鉄奈良駅', updatedAt: t },
      { id: 'sp14', name: '位置不明の気になるカフェ', lat: null, lng: null, area: '', address: '', hours: '', tags: ['カフェ'], status: 'want', priority: 'maybe', updatedAt: t }
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
    async spotList() {
      const db = load();
      return { ok: true, spots: db.spots.map(s => Object.assign({}, s, { visits: db.visits.filter(v => v.spotId === s.id) })), serverTime: new Date().toISOString() };
    },
    async spotSetVisited({ spotId, tripId, visit }) {
      const db = load();
      const sp = db.spots.find(s => s.id === spotId);
      if (!sp) return { error: 'スポット帳に見つかりません（削除済み）' };
      db.visits = db.visits.filter(v => !(v.spotId === spotId && v.tripId === tripId));
      if (visit) db.visits.push(Object.assign({}, visit, { spotId, tripId }));
      sp.status = db.visits.some(v => v.spotId === spotId) ? 'visited' : 'want';
      sp.updatedAt = new Date().toISOString();
      save(db);
      return { ok: true, spot: Object.assign({}, sp, { visits: db.visits.filter(v => v.spotId === spotId) }) };
    },
    async spotCreate({ spot }) {
      const db = load();
      const s = Object.assign({ id: uid('sp'), status: 'want', tags: [], updatedAt: new Date().toISOString() }, spot);
      db.spots.push(s); save(db);
      return { ok: true, spot: s };
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
          const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FTokyo&forecast_days=16`);
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
    async testConnections() {
      return { ok: true, spotcho: { ok: true, note: 'モック' }, kakeibo: { ok: true, note: 'モック' }, calendar: { ok: true, note: 'モック' }, maps: { ok: true, note: 'モック（直線距離からの概算）' } };
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
