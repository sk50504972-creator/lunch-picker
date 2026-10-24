// node tests/map-cat.test.js  (외부 의존 없음, 카카오 SDK는 목으로 대체)
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var assert = require('assert');

var sandbox = { window: {}, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise, JSON: JSON, Math: Math, Date: Date };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib.js'), 'utf8'), sandbox, { filename: 'lib.js' });
var LP = sandbox.window.LP;
assert.ok(LP && sandbox.window.__lp === LP, 'window.LP / window.__lp 노출');

var tests = [], failed = 0;
// vm 샌드박스에서 만든 배열·객체는 프로토타입이 달라 JSON으로 비교
function same(a, b, msg) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), b, msg); }
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ---------- mapKakaoCat ----------
test('mapKakaoCat: 점심 분류', function () {
  var cases = {
    '음식점 > 한식 > 해장국': '국밥·탕·찌개',
    '음식점 > 한식 > 국수 > 칼국수': '면·분식',
    '음식점 > 분식 > 김밥': '면·분식',
    '음식점 > 중식 > 중국요리': '중식',
    '음식점 > 일식 > 돈까스,우동': '일식·돈가스',
    '음식점 > 양식 > 이탈리안': '양식·기타',
    '음식점 > 한식 > 해물,생선 > 회': '해산물·회',
    '음식점 > 한식 > 육류,고기 > 삼겹살': '고기·구이',
    '음식점 > 한식 > 육류,고기 > 곱창,막창': '고기·구이',
    '음식점 > 한식 > 족발,보쌈': '고기·구이',
    '음식점 > 치킨': '치킨·패스트푸드',
    '음식점 > 패스트푸드 > 맥도날드': '치킨·패스트푸드',
    '음식점 > 카페 > 커피전문점': '카페·브런치',
    '음식점 > 한식': '한식·백반',
    '음식점 > 한식 > 한정식': '한식·백반',
    '음식점 > 뷔페': '양식·기타',
    '': '양식·기타'
  };
  Object.keys(cases).forEach(function (k) { assert.strictEqual(LP.mapKakaoCat(k, 'lunch'), cases[k], k); });
});
test('mapKakaoCat: 저녁 분류', function () {
  var cases = {
    '음식점 > 술집 > 호프,요리주점': '호프·맥주',
    '음식점 > 술집 > 일본식주점': '이자카야·사케',
    '음식점 > 술집 > 실내포장마차': '술집·포차',
    '음식점 > 술집 > 오뎅바': '술집·포차',
    '음식점 > 술집': '술집·포차',
    '음식점 > 술집 > 와인바': '와인·칵테일바',
    '음식점 > 술집 > 칵테일바': '와인·칵테일바',
    '음식점 > 한식 > 전,부침개': '전·막걸리',
    '음식점 > 술집 > 막걸리': '전·막걸리',
    '음식점 > 한식 > 육류,고기 > 곱창,막창': '곱창·족발·보쌈',
    '음식점 > 한식 > 족발,보쌈': '곱창·족발·보쌈',
    '음식점 > 치킨 > 교촌치킨': '치킨·안주',
    '음식점 > 한식 > 육류,고기 > 삼겹살': '고기·구이',
    '음식점 > 한식 > 해물,생선 > 회': '해산물·회',
    '음식점 > 패스트푸드': '치킨·패스트푸드',
    '음식점 > 뷔페': '기타 안주',
    '': '기타 안주'
  };
  Object.keys(cases).forEach(function (k) { assert.strictEqual(LP.mapKakaoCat(k, 'dinner'), cases[k], k); });
});
test('mapKakaoCat: 술집은 점심에도 술집류로 분류(후보에서 제외되도록)', function () {
  assert.strictEqual(LP.mapKakaoCat('음식점 > 술집 > 호프,요리주점', 'lunch'), '호프·맥주');
  assert.ok(LP.isDrinkCat(LP.mapKakaoCat('음식점 > 술집 > 일본식주점', 'lunch')));
});
test('분류 목록: 저녁엔 카페 제외, 점심 분류 포함', function () {
  assert.ok(LP.DINNER_CATS.indexOf('카페·브런치') < 0);
  LP.LUNCH_CATS.forEach(function (c) { if (c !== '카페·브런치') assert.ok(LP.DINNER_CATS.indexOf(c) >= 0, c); });
  LP.DRINK_CATS.forEach(function (c) { assert.ok(LP.DINNER_CATS.indexOf(c) >= 0, c); });
});

// ---------- 가중치 ----------
test('mealFactor: 술 한잔 on ×2.5 / off ×0.3, 점심 술집 0', function () {
  assert.strictEqual(LP.mealFactor('호프·맥주', 'dinner', true), 2.5);
  assert.strictEqual(LP.mealFactor('호프·맥주', 'dinner', false), 0.3);
  assert.strictEqual(LP.mealFactor('호프·맥주', 'lunch', true), 0);
  assert.strictEqual(LP.mealFactor('한식·백반', 'dinner', true), 1);
  assert.strictEqual(LP.mealFactor('카페·브런치', 'dinner', false, true), 0);
  assert.strictEqual(LP.mealFactor('카페·브런치', 'lunch', false, true), 1);
  assert.strictEqual(LP.mealFactor('카페·브런치', 'lunch', false, false), 0);
});
test('catWeight: 같은 조건에서 술 한잔 on/off 비율은 2.5/0.3', function () {
  var cnt = {}, avoid = {};
  var on = LP.catWeight('술집·포차', 12, { meal: 'dinner', drink: true }, cnt, avoid);
  var off = LP.catWeight('술집·포차', 12, { meal: 'dinner', drink: false }, cnt, avoid);
  var food = LP.catWeight('한식·백반', 12, { meal: 'dinner', drink: true }, cnt, avoid);
  assert.ok(Math.abs(on / off - 2.5 / 0.3) < 1e-9);
  assert.ok(Math.abs(on / food - 2.5) < 1e-9);
  assert.strictEqual(LP.catWeight('술집·포차', 12, { meal: 'lunch', drink: true }, cnt, avoid), 0);
});

function seeded(seed) { return function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }; }
function fixture() {
  var cats = ['한식·백반', '국밥·탕·찌개', '면·분식', '고기·구이', '술집·포차', '호프·맥주', '이자카야·사케', '카페·브런치'];
  var items = [];
  cats.forEach(function (c, ci) { for (var i = 0; i < 6; i++) items.push({ id: 'k-' + ci + '-' + i, name: c + i, category: c }); });
  return items;
}
function drinkShare(meal, drink) {
  var items = fixture(), rand = seeded(42), first = 0, drinkFirst = 0, any = 0;
  for (var n = 0; n < 3000; n++) {
    var res = LP.recommend(items, { log: [], meal: meal, drink: drink, days: 14, catDays: 2, rand: rand, now: new Date(2026, 9, 24) });
    first++;
    if (LP.isDrinkCat(res.picks[0].r.category)) drinkFirst++;
    res.picks.forEach(function (p) { if (LP.isDrinkCat(p.r.category)) any++; });
  }
  return { first: drinkFirst / first, any: any };
}
test('recommend: 점심 모드에선 술집류가 절대 안 나옴', function () {
  var s = drinkShare('lunch', true);
  assert.strictEqual(s.any, 0);
});
test('recommend: 저녁 술 한잔 on이면 술집류가 1순위로 훨씬 자주 나옴', function () {
  var on = drinkShare('dinner', true), off = drinkShare('dinner', false);
  // 분류 7개(카페 제외) 중 술집류 3개: on 기대 7.5/(4+7.5)≈0.65, off 기대 0.9/(4+0.9)≈0.18
  assert.ok(on.first > 0.55 && on.first < 0.75, 'on ' + on.first);
  assert.ok(off.first > 0.12 && off.first < 0.25, 'off ' + off.first);
  assert.ok(off.any > 0, 'off여도 완전 제외는 아님');
});
test('recommend: 저녁엔 카페 제외, 서로 다른 종류 3곳', function () {
  var items = fixture(), rand = seeded(7);
  for (var n = 0; n < 300; n++) {
    var res = LP.recommend(items, { log: [], meal: 'dinner', drink: false, rand: rand });
    assert.strictEqual(res.picks.length, 3);
    var seen = {};
    res.picks.forEach(function (p) { assert.notStrictEqual(p.r.category, '카페·브런치'); assert.ok(!seen[p.r.category]); seen[p.r.category] = 1; });
  }
});
test('recommend: 방문 제외는 끼니 합산, 분류 빈도는 현재 끼니만', function () {
  var now = new Date(2026, 9, 24);
  var log = [
    { id: 'a', cat: '한식·백반', meal: 'dinner', date: '2026-10-23' },
    { id: 'x', cat: '면·분식', date: '2026-10-23' } // meal 없음 → 점심
  ];
  var items = [{ id: 'a', name: 'A', category: '한식·백반' }, { id: 'b', name: 'B', category: '한식·백반' }];
  var cand = LP.filterCandidates(items, { log: log, meal: 'lunch', days: 14, now: now }, false);
  same(cand.map(function (r) { return r.id; }), ['b'], '저녁에 간 집도 점심 후보에서 제외');
  var lunchCnt = LP.catCounts(log, 30, 'lunch', now), dinnerCnt = LP.catCounts(log, 30, 'dinner', now);
  assert.strictEqual(lunchCnt['한식·백반'], 0);
  assert.strictEqual(lunchCnt['면·분식'], 1);
  assert.strictEqual(dinnerCnt['한식·백반'], 1);
  assert.strictEqual(dinnerCnt['면·분식'], 0);
  assert.ok(LP.recentCats(log, 2, 'dinner', now)['한식·백반']);
  assert.ok(!LP.recentCats(log, 2, 'lunch', now)['한식·백반']);
});

// ---------- 마이그레이션 ----------
test('migrate: 기존 v1 상태에 새 필드 기본값', function () {
  var old = { log: [{ id: 'sc-봉화식당', name: '봉화식당', city: '순천', cat: '한식·백반', date: '2026-10-01' }], hidden: ['x'], cities: ['순천'], nearOnly: true, price: 12000, rating: { 'sc-봉화식당': { s: 9, d: '2026-10-01' } } };
  var s = LP.migrate(old, new Date(2026, 9, 24, 12), { x: 127.5, y: 34.9 });
  assert.strictEqual(s.log[0].meal, 'lunch');
  assert.strictEqual(s.log[0].id, 'sc-봉화식당');
  same(s.loc, { name: '순천 사무실', x: 127.5, y: 34.9, r: 2000 });
  assert.strictEqual(s.meal, 'lunch');
  assert.strictEqual(s.price, 12000);
  assert.strictEqual(s.priceDinner, null);
  assert.strictEqual(s.drink, false);
  assert.strictEqual(s.rating['sc-봉화식당'].s, 9);
  assert.ok(!('cities' in s) && !('nearOnly' in s));
  assert.strictEqual(LP.migrate(old, new Date(2026, 9, 24, 17)).meal, 'dinner', '16시 이후 기본 저녁');
  assert.strictEqual(LP.migrate({ meal: 'lunch', mealDay: '2026-10-24' }, new Date(2026, 9, 24, 19)).meal, 'lunch', '그날 직접 고른 끼니 유지');
  assert.strictEqual(LP.migrate({ meal: 'lunch', mealDay: '2026-10-23' }, new Date(2026, 9, 24, 19)).meal, 'dinner');
  assert.strictEqual(LP.migrate({ loc: { name: '강남역', x: 127.02, y: 37.49, r: 5000 } }).loc.r, 5000);
});

// ---------- 주변 검색 (카카오 SDK 목) ----------
function memStorage() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, _m: m }; }
function mockServices(opts) {
  opts = opts || {};
  var calls = [], active = 0, maxActive = 0;
  var S = { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' };
  function place(id, cat, dist) { return { id: String(id), place_name: '가게' + id, category_name: cat, road_address_name: '서울 강남구 테헤란로 ' + id, address_name: '서울 강남구 역삼동 ' + id, phone: '02-000-' + id, place_url: 'http://place.map.kakao.com/' + id, x: '127.03', y: '37.50', distance: String(dist) }; }
  function respond(kind, q, cb, o) {
    calls.push({ kind: kind, q: q, o: o });
    active++; maxActive = Math.max(maxActive, active);
    setTimeout(function () {
      active--;
      if (opts.errorOn && opts.errorOn.indexOf(q) >= 0) return cb([], S.ERROR);
      if (kind === 'category') {
        var page = o.page;
        var data = [place(page * 10 + 1, '음식점 > 한식', 100 * page), place(page * 10 + 2, '음식점 > 술집 > 호프,요리주점', 120 * page)];
        return cb(data, S.OK, { hasNextPage: page < 5 });
      }
      if (q === '국밥' || q === '곱창') return cb([place(11, '음식점 > 한식', 100), place(900, '음식점 > 한식 > 육류,고기 > 곱창,막창', 300), place(777, '음식점 > 한식 > 해장국', 50)], S.OK, { hasNextPage: false });
      return cb([], S.ZERO_RESULT);
    }, 1);
  }
  function Places() {}
  Places.prototype.categorySearch = function (code, cb, o) { respond('category', code, cb, o); };
  Places.prototype.keywordSearch = function (q, cb, o) { respond('keyword', q, cb, o); };
  return { svc: { Places: Places, Status: S, SortBy: { DISTANCE: 'distance', ACCURACY: 'accuracy' } }, calls: calls, max: function () { return maxActive; } };
}
var LOC = { name: '강남역', x: 127.0276, y: 37.4979 };

test('fetchNearby: 3페이지 제한·키워드 검색·중복 제거·정규화·동시 요청 제한', function () {
  var m = mockServices(), storage = memStorage();
  return LP.fetchNearby('lunch', LOC, 2000, { services: m.svc, storage: storage, concurrency: 3, now: function () { return 1000; } }).then(function (res) {
    var cat = m.calls.filter(function (c) { return c.kind === 'category'; });
    same(cat.map(function (c) { return c.o.page; }), [1, 2, 3]);
    cat.forEach(function (c) { assert.strictEqual(c.o.radius, 2000); assert.strictEqual(c.o.sort, 'distance'); assert.strictEqual(c.q, 'FD6'); });
    var kw = m.calls.filter(function (c) { return c.kind === 'keyword'; });
    assert.strictEqual(kw.length, LP.KEYWORDS.lunch.length);
    kw.forEach(function (c) { assert.strictEqual(c.o.category_group_code, 'FD6'); assert.strictEqual(c.o.radius, 2000); });
    assert.ok(m.max() <= 3, 'max concurrency ' + m.max());
    var ids = res.items.map(function (r) { return r.id; });
    assert.strictEqual(ids.length, new Set(ids).size, '중복 없음');
    assert.strictEqual(ids.length, 8); // 카테고리 6 + 키워드 새 가게 2 (11번 중복)
    var r = res.items.filter(function (x) { return x.kakaoId === '777'; })[0];
    same(Object.keys(r).sort(), ['address', 'area', 'category', 'dist', 'id', 'kakaoId', 'kcat', 'name', 'phone', 'placeUrl', 'x', 'y'].sort());
    assert.strictEqual(r.id, 'k-777'); assert.strictEqual(r.category, '국밥·탕·찌개'); assert.strictEqual(r.dist, 50);
    assert.strictEqual(r.placeUrl, 'https://place.map.kakao.com/777'); assert.strictEqual(r.address, '서울 강남구 테헤란로 777');
    assert.strictEqual(res.items[0].dist, 50, '거리순 정렬');
    assert.ok(res.ok && !res.fromCache);
    var cache = JSON.parse(storage.getItem(LP.CACHE_KEY));
    assert.strictEqual(cache[0].key, 'lunch|127.028,37.498|2000');
  });
});
test('fetchNearby: 6시간 캐시 재사용, 지나면 다시 요청, 최근 5개만 보관', function () {
  var m = mockServices(), storage = memStorage(), t = 0;
  var env = { services: m.svc, storage: storage, now: function () { return t; } };
  return LP.fetchNearby('dinner', LOC, 1000, env).then(function () {
    var n = m.calls.length; t = 5 * 3600000;
    return LP.fetchNearby('dinner', LOC, 1000, env).then(function (res) {
      assert.ok(res.fromCache); assert.strictEqual(m.calls.length, n);
      t = 7 * 3600000;
      return LP.fetchNearby('dinner', LOC, 1000, env);
    }).then(function (res) {
      assert.ok(!res.fromCache); assert.ok(m.calls.length > n);
      var p = Promise.resolve();
      [500, 2000, 3000, 5000, 10000].forEach(function (r) { p = p.then(function () { return LP.fetchNearby('dinner', LOC, r, env); }); });
      return p;
    }).then(function () {
      var cache = JSON.parse(storage.getItem(LP.CACHE_KEY));
      assert.strictEqual(cache.length, 5);
      assert.strictEqual(cache[0].key, 'dinner|127.028,37.498|10000');
    });
  });
});
test('fetchNearby: ERROR가 나도 모은 것까지 사용', function () {
  var m = mockServices({ errorOn: ['FD6', '한식'] });
  return LP.fetchNearby('lunch', LOC, 2000, { services: m.svc }).then(function (res) {
    assert.ok(res.ok); assert.strictEqual(res.errors, 2);
    same(res.items.map(function (r) { return r.kakaoId; }).sort(), ['11', '777', '900']);
  });
});
test('fetchNearby: 전부 ERROR면 ok=false, 캐시 안 함', function () {
  var m = mockServices({ errorOn: ['FD6'].concat(LP.KEYWORDS.lunch) }), storage = memStorage();
  return LP.fetchNearby('lunch', LOC, 2000, { services: m.svc, storage: storage }).then(function (res) {
    assert.ok(!res.ok); assert.strictEqual(res.items.length, 0); assert.strictEqual(storage.getItem(LP.CACHE_KEY), null);
  });
});
test('mergeNearby: 반경 안 기존 데이터 병합, 같은 kakaoId는 기존 우선·dist만 갱신', function () {
  var base = [
    { id: 'sc-a', name: '기존A', category: '한식·백반', kakaoId: '11', price: 9000, menu: '백반', kScore: 8, x: 127.0280, y: 37.4980 },
    { id: 'sc-far', name: '먼집', category: '중식', x: 127.5, y: 34.9 },
    { id: 'c-1', name: '직접', category: '면·분식', custom: true, x: 127.0277, y: 37.4979 },
    { id: 'c-2', name: '좌표없음', category: '면·분식', custom: true }
  ];
  var fetched = [
    { id: 'k-11', kakaoId: '11', name: '카카오A', category: '고기·구이', dist: 42, x: 127.028, y: 37.498 },
    { id: 'k-5', kakaoId: '5', name: '새집', category: '중식', dist: 300, x: 127.03, y: 37.5 }
  ];
  var out = LP.mergeNearby(fetched, base, LOC, 1000);
  var ids = out.map(function (r) { return r.id; });
  same(ids.slice().sort(), ['c-1', 'k-5', 'sc-a']);
  var a = out.filter(function (r) { return r.id === 'sc-a'; })[0];
  assert.strictEqual(a.name, '기존A'); assert.strictEqual(a.price, 9000); assert.strictEqual(a.kScore, 8); assert.strictEqual(a.dist, 42);
  assert.strictEqual(base[0].dist, undefined, '원본 불변');
});
test('searchLocation: 주소+장소 후보', function () {
  var S = { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' };
  function Geocoder() {}
  Geocoder.prototype.addressSearch = function (q, cb) { setTimeout(function () { cb([{ address_name: '서울 강남구 역삼동', x: '127.03', y: '37.49' }], S.OK); }, 1); };
  function Places() {}
  Places.prototype.keywordSearch = function (q, cb) { setTimeout(function () { cb([{ place_name: '강남역 2호선', category_name: '교통,수화 > 지하철,전철 > 수도권2호선', road_address_name: '서울 강남구 강남대로 396', x: '127.0276', y: '37.4979' }], S.OK); }, 1); };
  return LP.searchLocation('강남', { Geocoder: Geocoder, Places: Places, Status: S }).then(function (list) {
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].sub, '주소');
    assert.strictEqual(list[1].name, '강남역 2호선');
    assert.ok(Math.abs(list[1].x - 127.0276) < 1e-9);
  });
});
test('fmtDist / haversine', function () {
  assert.strictEqual(LP.fmtDist(347), '350m');
  assert.strictEqual(LP.fmtDist(1234), '1.2km');
  assert.strictEqual(LP.fmtDist(12345), '12km');
  var d = LP.haversine(127.0, 37.0, 127.0, 37.01);
  assert.ok(Math.abs(d - 1112) < 5, String(d));
});

(function run(i) {
  if (i >= tests.length) {
    console.log((tests.length - failed) + '/' + tests.length + ' passed');
    process.exit(failed ? 1 : 0);
  }
  var t = tests[i];
  Promise.resolve().then(t.fn).then(function () { console.log('ok   ' + t.name); }, function (e) { failed++; console.log('FAIL ' + t.name + '\n     ' + (e && e.message)); }).then(function () { run(i + 1); });
})(0);
