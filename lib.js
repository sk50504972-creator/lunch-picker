// 오늘 뭐 먹지: DOM 없는 순수 로직 (분류 매핑, 추천 가중치, 주변 검색, 상태 마이그레이션).
// app.js와 tests/map-cat.test.js가 같이 쓴다. ES5 문법만 사용(iOS Safari·안드로이드 크롬).
(function (root) {
  'use strict';
  var DAY = 86400000;
  var LUNCH_CATS = ['한식·백반', '국밥·탕·찌개', '면·분식', '중식', '일식·돈가스', '양식·기타', '해산물·회', '고기·구이', '치킨·패스트푸드', '카페·브런치'];
  // 술집류: 점심엔 제외, 저녁엔 「술 한잔」 토글로 가중치 조절
  var DRINK_CATS = ['술집·포차', '호프·맥주', '이자카야·사케', '와인·칵테일바', '전·막걸리'];
  var DINNER_ONLY = DRINK_CATS.concat(['곱창·족발·보쌈', '치킨·안주', '기타 안주']);
  // 저녁 후보 분류: 저녁 분류 + 점심 분류(카페·브런치 제외)
  var DINNER_CATS = DINNER_ONLY.concat(LUNCH_CATS.filter(function (c) { return c !== '카페·브런치'; }));
  var ALL_CATS = LUNCH_CATS.concat(DINNER_ONLY);
  var KEYWORDS = {
    lunch: ['한식', '백반', '국밥', '칼국수', '분식', '중식', '일식', '돈가스', '양식', '해산물', '고기', '치킨', '카페'],
    dinner: ['술집', '호프', '맥주', '이자카야', '포차', '포장마차', '고깃집', '삼겹살', '횟집', '곱창', '치킨', '와인바', '칵테일', '막걸리', '전집', '족발', '보쌈']
  };
  var RADII = [500, 1000, 2000, 3000, 5000, 10000];
  var DEFAULT_RADIUS = 2000;
  var CACHE_KEY = 'lunchPicker.cache.v1', CACHE_TTL = 6 * 3600000, CACHE_MAX = 5;

  function assign(t) { for (var i = 1; i < arguments.length; i++) { var s = arguments[i]; if (s) for (var k in s) if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } return t; }

  // ---------- 카카오 category_name → 앱 분류 ----------
  var DRINK_RULES = [
    [/와인|칵테일|위스키|양주|라운지/, '와인·칵테일바'],
    [/이자카야|이자까야|일본식주점|사케/, '이자카야·사케'],
    [/호프|맥주|비어|펍/, '호프·맥주'],
    [/막걸리|전,부침개|부침개|빈대떡|파전|전집/, '전·막걸리'],
    [/술집|주점|포차|포장마차|오뎅/, '술집·포차']
  ];
  var DINNER_RULES = [
    [/곱창|막창|대창|족발|보쌈/, '곱창·족발·보쌈'],
    [/치킨|통닭|닭강정/, '치킨·안주']
  ];
  var LUNCH_RULES = [
    [/카페|디저트|제과|베이커리|브런치|도넛|아이스크림/, '카페·브런치'],
    [/치킨|패스트푸드|햄버거|통닭/, '치킨·패스트푸드'],
    [/중식|중국요리|양꼬치|마라|짬뽕/, '중식'],
    [/일식|돈까스|돈가스|초밥|라멘|우동|참치/, '일식·돈가스'],
    [/분식|국수|칼국수|냉면|만두|김밥|밀면|수제비|막국수|떡볶이/, '면·분식'],
    [/국밥|해장국|설렁탕|곰탕|감자탕|찌개|전골|추어|순대|탕|삼계/, '국밥·탕·찌개'],
    [/해물|생선|회|조개|게|장어|아구|낙지|복어|주꾸미|꼬막|굴/, '해산물·회'],
    [/육류|고기|갈비|삼겹|곱창|오리|닭|족발|보쌈|불고기|정육|양고기|한우/, '고기·구이'],
    [/양식|이탈리안|피자|스테이크|파스타|멕시칸|아시아|베트남|태국|인도|샐러드|퓨전|패밀리레스토랑|프랑스/, '양식·기타'],
    [/한식|백반|한정식|가정식|도시락|죽|비빔밥|쌈밥|기사식당/, '한식·백반']
  ];
  function mapKakaoCat(name, meal) {
    var s = String(name || '');
    var tail = s.indexOf('>') >= 0 ? s.split('>').slice(1).join('>') : s;
    var sets = meal === 'dinner' ? [DRINK_RULES, DINNER_RULES, LUNCH_RULES] : [DRINK_RULES, LUNCH_RULES];
    for (var i = 0; i < sets.length; i++) for (var j = 0; j < sets[i].length; j++) if (sets[i][j][0].test(tail)) return sets[i][j][1];
    return meal === 'dinner' ? '기타 안주' : '양식·기타';
  }
  function isDrinkCat(c) { return DRINK_CATS.indexOf(c) >= 0; }
  // 끼니·술 한잔에 따른 분류 가중치. 0이면 후보에서 제외.
  function mealFactor(cat, meal, drink, cafe) {
    if (meal !== 'dinner') {
      if (isDrinkCat(cat)) return 0;
      if (cat === '카페·브런치' && !cafe) return 0;
      return 1;
    }
    if (cat === '카페·브런치') return 0;
    if (isDrinkCat(cat)) return drink ? 2.5 : 0.3;
    return 1;
  }

  // ---------- 날짜·거리 ----------
  function daysAgo(ds, now) {
    var p = String(ds).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]);
    var t = new Date(now ? now.getTime() : Date.now()); t.setHours(0, 0, 0, 0);
    return Math.round((t - d) / DAY);
  }
  function fmtDate(d) { var m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function haversine(x1, y1, x2, y2) {
    var t = Math.PI / 180, dLat = (y2 - y1) * t, dLon = (x2 - x1) * t;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(y1 * t) * Math.cos(y2 * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371000 * Math.asin(Math.sqrt(a));
  }
  function fmtDist(m) {
    if (m == null || isNaN(m)) return '';
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + 'm';
    return (m < 10000 ? (m / 1000).toFixed(1) : Math.round(m / 1000)) + 'km';
  }
  function radiusTxt(r) { return r < 1000 ? r + 'm' : (r / 1000) + 'km'; }
  function areaOf(addr) { var m = (addr || '').match(/\s(\S+(?:동|읍|면|가))\s/); return m ? m[1] : ''; }

  // ---------- 추천 ----------
  function mealOf(l) { return l.meal || 'lunch'; }
  // 방문 제외는 점심·저녁 기록을 합쳐서
  function lastVisit(log, id, now) {
    var best = null;
    log.forEach(function (l) { if (l.id === id) { var a = daysAgo(l.date, now); if (best === null || a < best) best = a; } });
    return best;
  }
  // 분류 빈도·최근 먹은 종류는 해당 끼니 기록만 (meal이 없으면 전체)
  function catCounts(log, within, meal, now) {
    var c = {}; ALL_CATS.forEach(function (k) { c[k] = 0; });
    log.forEach(function (l) {
      if (meal && mealOf(l) !== meal) return;
      var a = daysAgo(l.date, now);
      if (a >= 0 && a <= within && l.cat) c[l.cat] = (c[l.cat] || 0) + 1;
    });
    return c;
  }
  function recentCats(log, within, meal, now) {
    var s = {};
    if (!within) return s;
    log.forEach(function (l) { if (meal && mealOf(l) !== meal) return; var a = daysAgo(l.date, now); if (a >= 0 && a <= within) s[l.cat] = true; });
    return s;
  }
  // 내 별점 가중치: 미평가 1, 1점 0.1, 5점 1(보통), 10점 3
  function rateW(s) { if (!s) return 1; return s <= 5 ? 0.1 + (s - 1) * 0.225 : 1 + (s - 5) * 0.4; }
  function filterCandidates(items, ctx, relax) {
    var hid = {}; (ctx.hidden || []).forEach(function (h) { hid[h] = 1; });
    var skip = ctx.skip || [], now = ctx.now || new Date();
    return items.filter(function (r) {
      if (hid[r.id]) return false;
      if (!mealFactor(r.category, ctx.meal, ctx.drink, ctx.cafe)) return false;
      if (skip.indexOf(r.category) >= 0) return false;
      if (ctx.price && r.price && Number(r.price) > Number(ctx.price)) return false;
      var lv = lastVisit(ctx.log || [], r.id, now);
      if (!relax && lv !== null && lv < (ctx.days || 0)) return false;
      return true;
    });
  }
  function catWeight(cat, n, ctx, cnt, avoid) {
    var w = 1 / (1 + (cnt[cat] || 0) * 1.5);             // 30일간 적게 먹은 종류일수록 ↑
    if (avoid[cat]) w *= 0.08;                            // 최근 N일 먹은 종류는 거의 제외
    w *= Math.min(1, 0.45 + n / 12);                      // 후보가 1~2곳뿐인 종류는 조금 덜
    w *= mealFactor(cat, ctx.meal, ctx.drink, ctx.cafe);  // 술 한잔 ×2.5 / ×0.3, 점심 술집 제외
    return w;
  }
  function weightedPick(items, wfn, rand) {
    var tot = 0, ws = items.map(function (x) { var w = Math.max(0.0001, wfn(x)); tot += w; return w; });
    var r = rand() * tot;
    for (var i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  // ctx: {log, meal, drink, cafe, days, catDays, price, skip, hidden, getRate(id), now, rand}
  function recommend(items, ctx) {
    var rand = ctx.rand || Math.random, now = ctx.now || new Date(), log = ctx.log || [];
    var getRate = ctx.getRate || function () { return 0; };
    var relaxed = false;
    var cand = filterCandidates(items, ctx, false);
    if (!cand.length) { cand = filterCandidates(items, ctx, true); relaxed = true; }
    if (!cand.length) return { picks: [], relaxed: relaxed };
    var cnt = catCounts(log, 30, ctx.meal, now), avoid = recentCats(log, ctx.catDays, ctx.meal, now);
    var groups = {};
    cand.forEach(function (r) { (groups[r.category] = groups[r.category] || []).push(r); });
    var cats = Object.keys(groups);
    var picks = [], used = {};
    for (var n = 0; n < 3; n++) {
      var pool = cats.filter(function (c) { return !used[c]; });
      if (!pool.length) break;
      var cat = weightedPick(pool, function (c) { return catWeight(c, groups[c].length, ctx, cnt, avoid); }, rand);
      used[cat] = 1;
      var r = weightedPick(groups[cat], function (x) {
        var lv = lastVisit(log, x.id, now);
        var s = getRate(x.id), rw = rateW(s);            // 내 별점: 높을수록 ↑, 1점은 거의 안 나옴
        if (lv === null) return (s ? 1.2 : 1.6) * rw;    // 한 번도 안 간 집 가산
        return Math.min(1.4, 0.4 + lv / 30) * rw;        // 오래전에 간 집일수록 ↑
      }, rand);
      picks.push({ r: r, why: whyText(r, ctx, cnt, avoid, now) });
    }
    return { picks: picks, relaxed: relaxed };
  }
  function whyText(r, ctx, cnt, avoid, now) {
    var lv = lastVisit(ctx.log || [], r.id, now), s = ctx.getRate ? ctx.getRate(r.id) : 0;
    var ml = ctx.meal === 'dinner' ? '저녁' : '점심', c = cnt[r.category] || 0, a = [];
    a.push(c === 0 ? '최근 30일 ' + ml + '에 ' + r.category + ' 안 먹음' : '최근 30일 ' + ml + ' ' + r.category + ' ' + c + '번');
    a.push(lv === null ? '처음 가는 집' : lv + '일 전에 방문');
    if (s) a.push('내 별점 ' + s + '/10');
    if (ctx.meal === 'dinner' && ctx.drink && isDrinkCat(r.category)) a.push('술 한잔 모드');
    if (avoid[r.category]) a.push('후보가 적어 최근 먹은 종류 포함');
    return a.join(' · ');
  }

  // ---------- 주변 검색 (카카오맵 SDK는 env.services로 주입) ----------
  function normalizePlace(d, meal, loc) {
    var x = +d.x, y = +d.y, dist = null;
    if (d.distance !== '' && d.distance != null && !isNaN(+d.distance)) dist = +d.distance;
    else if (loc) dist = Math.round(haversine(+loc.x, +loc.y, x, y));
    return {
      id: 'k-' + d.id, kakaoId: String(d.id), name: d.place_name,
      category: mapKakaoCat(d.category_name, meal), kcat: d.category_name || '',
      address: (d.road_address_name || d.address_name || '').replace('전남광주통합특별시 ', '전남 '),
      phone: d.phone || '', placeUrl: (d.place_url || '').replace(/^http:/, 'https:'),
      x: x, y: y, dist: dist, area: areaOf(d.address_name)
    };
  }
  function cacheKey(meal, loc, radius) { return meal + '|' + (+loc.x).toFixed(3) + ',' + (+loc.y).toFixed(3) + '|' + radius; }
  function cacheRead(storage) {
    try { var a = JSON.parse(storage.getItem(CACHE_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function cacheGet(storage, key, now) {
    if (!storage) return null;
    var a = cacheRead(storage);
    for (var i = 0; i < a.length; i++) if (a[i] && a[i].key === key && now - a[i].at < CACHE_TTL) return a[i].items;
    return null;
  }
  function cachePut(storage, key, items, now) {
    if (!storage) return;
    var a = cacheRead(storage).filter(function (e) { return e && e.key !== key && now - e.at < CACHE_TTL; });
    a.unshift({ key: key, at: now, items: items });
    a = a.slice(0, CACHE_MAX);
    try { storage.setItem(CACHE_KEY, JSON.stringify(a)); } catch (e) {
      try { storage.setItem(CACHE_KEY, JSON.stringify(a.slice(0, 1))); } catch (e2) { /* 저장 공간 부족: 캐시 없이 진행 */ }
    }
  }
  // 동시 실행 n개로 제한
  function pool(tasks, n) {
    return new Promise(function (ok) {
      var i = 0, active = 0, done = 0;
      if (!tasks.length) { ok(); return; }
      function fin() { active--; done++; if (done === tasks.length) ok(); else next(); }
      function next() { while (active < n && i < tasks.length) { active++; tasks[i++]().then(fin, fin); } }
      next();
    });
  }
  // SDK 콜백 → Promise. 응답이 안 오면 timeout 후 TIMEOUT으로 넘어간다.
  function sdkCall(fn, timeout) {
    return new Promise(function (ok) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; ok({ status: 'TIMEOUT' }); } }, timeout);
      try {
        fn(function (data, status, pg) { if (done) return; done = true; clearTimeout(t); ok({ data: data, status: status, pg: pg }); });
      } catch (e) { done = true; clearTimeout(t); ok({ status: 'EXCEPTION' }); }
    });
  }
  // 반환: {items, errors, ok, fromCache}. ok=false면 응답을 하나도 못 받은 것.
  function fetchNearby(meal, loc, radius, env) {
    env = env || {};
    var now = env.now ? env.now() : Date.now();
    var key = cacheKey(meal, loc, radius);
    var hit = cacheGet(env.storage, key, now);
    if (hit) return Promise.resolve({ items: hit, errors: 0, ok: true, fromCache: true });
    var svc = env.services, S = svc.Status, ps = new svc.Places(), timeout = env.timeout || 8000;
    var base = { radius: radius, sort: svc.SortBy ? svc.SortBy.DISTANCE : 'distance', size: 15, x: String(loc.x), y: String(loc.y) };
    if (env.LatLng) base.location = new env.LatLng(loc.y, loc.x);
    var queries = [{ m: 'categorySearch', q: 'FD6', o: base }].concat((KEYWORDS[meal] || KEYWORDS.lunch).map(function (k) {
      return { m: 'keywordSearch', q: k, o: assign({}, base, { category_group_code: 'FD6' }) };
    }));
    var seen = {}, items = [], errors = 0, okCount = 0;
    function add(d) { if (!d || seen[d.id]) return; seen[d.id] = 1; items.push(normalizePlace(d, meal, loc)); }
    function run(qd) {
      function step(p) {
        return sdkCall(function (cb) { ps[qd.m](qd.q, cb, assign({}, qd.o, { page: p })); }, timeout).then(function (res) {
          if (res.status === S.OK) {
            okCount++;
            (res.data || []).forEach(add);
            if (p < 3 && res.pg && res.pg.hasNextPage) return step(p + 1);
          } else if (res.status === S.ZERO_RESULT) okCount++;
          else errors++; // ERROR·TIMEOUT: 중단하지 않고 다음 요청으로
        });
      }
      return step(1);
    }
    return pool(queries.map(function (q) { return function () { return run(q); }; }), env.concurrency || 3).then(function () {
      items.sort(function (a, b) { return (a.dist || 0) - (b.dist || 0); });
      if (okCount > 0) cachePut(env.storage, key, items, now);
      return { items: items, errors: errors, ok: okCount > 0, fromCache: false };
    });
  }
  // 기존 목록(RESTAURANTS+직접 추가)에서 반경 안인 것 + 검색 결과. 같은 kakaoId면 기존 데이터 우선, dist만 갱신.
  function mergeNearby(fetched, base, loc, radius) {
    var out = [], byK = {}, far = {}, seen = {};
    (base || []).forEach(function (r) {
      if (r.x == null || r.y == null || isNaN(+r.x) || isNaN(+r.y)) return;
      var d = haversine(+loc.x, +loc.y, +r.x, +r.y);
      if (d > radius) { if (r.kakaoId) far[r.kakaoId] = r; return; }
      var c = assign({}, r, { dist: Math.round(d) });
      out.push(c); seen[c.id] = 1;
      if (r.kakaoId) byK[r.kakaoId] = c;
    });
    (fetched || []).forEach(function (f) {
      var b = byK[f.kakaoId];
      if (b) { if (f.dist != null) b.dist = f.dist; return; }
      if (far[f.kakaoId]) { b = assign({}, far[f.kakaoId], { dist: f.dist }); byK[f.kakaoId] = b; out.push(b); seen[b.id] = 1; return; }
      if (seen[f.id]) return;
      seen[f.id] = 1; out.push(assign({}, f));
    });
    out.sort(function (a, b) { return (a.dist || 0) - (b.dist || 0); });
    return out;
  }
  // 위치 검색: 주소(Geocoder) + 장소(키워드) 후보
  function searchLocation(q, svc, env) {
    env = env || {};
    var timeout = env.timeout || 8000, S = svc.Status;
    var geo = new svc.Geocoder(), ps = new svc.Places();
    return Promise.all([
      sdkCall(function (cb) { geo.addressSearch(q, cb); }, timeout),
      sdkCall(function (cb) { ps.keywordSearch(q, cb, { size: 10 }); }, timeout)
    ]).then(function (rs) {
      if (rs[0].status !== S.OK && rs[0].status !== S.ZERO_RESULT && rs[1].status !== S.OK && rs[1].status !== S.ZERO_RESULT) throw new Error('search');
      var out = [], seen = {};
      function push(o) { var k = o.name + '|' + o.x.toFixed(4) + ',' + o.y.toFixed(4); if (seen[k] || isNaN(o.x)) return; seen[k] = 1; out.push(o); }
      if (rs[0].status === S.OK) (rs[0].data || []).forEach(function (d) { push({ name: d.address_name, sub: '주소', x: +d.x, y: +d.y }); });
      if (rs[1].status === S.OK) (rs[1].data || []).forEach(function (d) {
        var cat = (d.category_name || '').split('>').pop().trim();
        push({ name: d.place_name, sub: (d.road_address_name || d.address_name || '') + (cat ? ' · ' + cat : ''), x: +d.x, y: +d.y });
      });
      return out.slice(0, 12);
    });
  }

  // ---------- 상태 마이그레이션 (lunchPicker.v1 키 유지) ----------
  function defaultMeal(now) { return now.getHours() >= 16 ? 'dinner' : 'lunch'; }
  function migrate(d, now, office) {
    d = d || {}; now = now || new Date(); office = office || { x: 127.528365915923, y: 34.9487482539587 };
    var loc = d.loc && !isNaN(+d.loc.x) && !isNaN(+d.loc.y) && d.loc.x !== null && d.loc.y !== null
      ? { name: d.loc.name || '선택한 위치', x: +d.loc.x, y: +d.loc.y, r: RADII.indexOf(+d.loc.r) >= 0 ? +d.loc.r : DEFAULT_RADIUS }
      : { name: '순천 사무실', x: office.x, y: office.y, r: DEFAULT_RADIUS };
    var td = fmtDate(now);
    return {
      log: (d.log || []).map(function (l) { return l.meal ? l : assign({}, l, { meal: 'lunch' }); }), // {id?, name, city?, cat, meal, date}
      hidden: d.hidden || [],
      custom: d.custom || [],
      days: d.days != null ? d.days : 14,
      catDays: d.catDays != null ? d.catDays : 2,
      price: d.price || null,             // 점심 가격 상한
      priceDinner: d.priceDinner || null, // 저녁 가격 상한
      cafe: !!d.cafe,
      rating: d.rating || {},             // id -> {s:1~10, d:'YYYY-MM-DD'}
      over: d.over || {},                 // id -> 카카오맵에서 갱신한 정보
      places: d.places || {},             // 'k-' id -> 기록·별점·숨김한 주변 가게 정보
      loc: loc,                           // {name, x, y, r(반경 m)}
      meal: d.meal && d.mealDay === td ? d.meal : defaultMeal(now), // 직접 고른 끼니는 그날만 유지
      mealDay: d.mealDay || null,
      drink: !!d.drink,
      listSrc: d.listSrc === 'base' ? 'base' : 'near'
    };
  }

  var LP = {
    LUNCH_CATS: LUNCH_CATS, DINNER_CATS: DINNER_CATS, DRINK_CATS: DRINK_CATS, ALL_CATS: ALL_CATS, KEYWORDS: KEYWORDS,
    RADII: RADII, DEFAULT_RADIUS: DEFAULT_RADIUS, CACHE_KEY: CACHE_KEY, CACHE_TTL: CACHE_TTL,
    mapKakaoCat: mapKakaoCat, isDrinkCat: isDrinkCat, mealFactor: mealFactor, catWeight: catWeight,
    daysAgo: daysAgo, fmtDate: fmtDate, haversine: haversine, fmtDist: fmtDist, radiusTxt: radiusTxt, areaOf: areaOf,
    lastVisit: lastVisit, catCounts: catCounts, recentCats: recentCats, rateW: rateW,
    filterCandidates: filterCandidates, recommend: recommend,
    normalizePlace: normalizePlace, cacheKey: cacheKey, cacheGet: cacheGet, cachePut: cachePut,
    fetchNearby: fetchNearby, mergeNearby: mergeNearby, searchLocation: searchLocation,
    defaultMeal: defaultMeal, migrate: migrate
  };
  root.LP = LP;
  root.__lp = LP;
})(typeof window !== 'undefined' ? window : this);
