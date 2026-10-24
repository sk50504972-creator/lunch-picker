(function () {
  'use strict';
  var LP = window.LP;
  var CITIES = ['순천', '광양', '여수'];
  var CATS = LP.LUNCH_CATS, ALL_CATS = LP.ALL_CATS;
  var KEY = 'lunchPicker.v1';
  var OFFICE = window.OFFICE || { x: 127.528365915923, y: 34.9487482539587 };
  var MEAL_TXT = { lunch: '점심', dinner: '저녁' };

  // ---------- state ----------
  var st = load();
  function load() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { d = {}; }
    return LP.migrate(d, new Date(), OFFICE);
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { toast('저장 공간이 부족해요'); } }

  // 기본 목록(순천·광양·여수) + 직접 추가
  function all() {
    var base = (window.RESTAURANTS || []).map(function (r) { return st.over[r.id] ? Object.assign({}, r, st.over[r.id]) : r; });
    return base.concat(st.custom);
  }
  var nearMap = {}; // 이번 세션에 본 주변 가게 (id -> item)
  function byId(id) {
    var a = all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return nearMap[id] || st.places[id] || null;
  }
  // 기록·별점·숨김한 주변 가게(k-)는 다음에도 이름이 보이게 최소 정보를 저장
  function remember(r) {
    if (!r || String(r.id).indexOf('k-') !== 0) return;
    st.places[r.id] = { id: r.id, kakaoId: r.kakaoId, name: r.name, category: r.category, kcat: r.kcat, address: r.address, phone: r.phone, placeUrl: r.placeUrl, x: r.x, y: r.y, area: r.area };
  }

  // ---------- helpers ----------
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return LP.fmtDate(new Date()); }
  function daysAgo(ds) { return LP.daysAgo(ds, new Date()); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function place(r) { return r.city || r.area || ''; }
  function searchQ(r) { return encodeURIComponent(((r.city || r.area || '') + ' ' + r.name).trim()); }
  function mapLinks(r) {
    var q = searchQ(r);
    return '<a class="lnk" target="_blank" rel="noopener" href="https://map.naver.com/p/search/' + q + '">네이버지도</a>' +
      '<a class="lnk" target="_blank" rel="noopener" href="' + (r.placeUrl ? esc(r.placeUrl) : 'https://map.kakao.com/?q=' + q) + '">카카오맵</a>' +
      (r.phone ? '<a class="lnk" href="tel:' + esc(r.phone) + '">전화</a>' : '');
  }
  function priceTxt(p) { return p ? Number(p).toLocaleString('ko-KR') + '원대' : ''; }
  function chips(el, items, selected, onToggle, labels) {
    el.innerHTML = items.map(function (x, i) { return '<span class="chip' + (selected.indexOf(x) >= 0 ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(labels ? labels[i] : x) + '</span>'; }).join('');
    el.onclick = function (e) { var c = e.target.closest('.chip'); if (!c) return; onToggle(c.getAttribute('data-v')); };
  }
  function tog(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  function distTxt(r) { return r.dist != null ? ' · ' + LP.fmtDist(r.dist) : (r.city === '순천' && r.km != null ? ' · 사무실에서 ' + r.km + 'km' : ''); }
  function mealCats() { return st.meal === 'dinner' ? LP.DINNER_CATS : CATS.filter(function (c) { return st.cafe || c !== '카페·브런치'; }); }
  function loadingHtml(msg) { return '<div class="card muted"><span class="spin"></span>' + esc(msg) + '</div>'; }

  // ---------- 카카오맵 SDK ----------
  var KAKAO_JS_KEY = '574c00f6ac5c120d1a6c5cbbfee73527';
  var sdkP = null;
  function kakaoReady() {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve();
    if (sdkP) return sdkP;
    sdkP = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_JS_KEY + '&libraries=services&autoload=false';
      s.onload = function () { try { kakao.maps.load(function () { ok(); }); } catch (e) { sdkP = null; no(e); } };
      s.onerror = function () { sdkP = null; no(new Error('sdk')); };
      document.head.appendChild(s);
      setTimeout(function () { if (!(window.kakao && kakao.maps && kakao.maps.services)) sdkP = null; no(new Error('timeout')); }, 10000);
    });
    return sdkP;
  }

  // ---------- 주변 가게 ----------
  var nearStore = {}, nearLoading = {};
  function nearKey() { return LP.cacheKey(st.meal, st.loc, st.loc.r); }
  // 카카오 검색 결과(병합 전). 실패해도 reject하지 않고 {raw:[], ok:false}
  function rawNearby(mode, loc, radius) {
    return kakaoReady().then(function () {
      return LP.fetchNearby(mode, loc, radius, { services: kakao.maps.services, LatLng: kakao.maps.LatLng, storage: localStorage, concurrency: 4 });
    }).then(function (res) { return { raw: res.items, ok: res.ok }; }, function () { return { raw: [], ok: false }; });
  }
  // 위치 반경 안 후보 = 카카오 검색 결과 + 기존 목록·직접 추가(반경 안)
  function fetchNearby(mode, loc, radius) {
    return rawNearby(mode, loc, radius).then(function (res) { return LP.mergeNearby(res.raw, all(), loc, radius); });
  }
  function ensureNear() {
    var k = nearKey();
    if (nearStore[k]) return Promise.resolve(nearStore[k]);
    if (!nearLoading[k]) nearLoading[k] = rawNearby(st.meal, st.loc, st.loc.r).then(function (res) {
      delete nearLoading[k];
      if (res.ok) nearStore[k] = res;
      return res;
    });
    return nearLoading[k];
  }
  function withNear(box, cb) {
    var k = nearKey();
    if (!nearStore[k]) box.innerHTML = loadingHtml('카카오맵에서 ' + st.loc.name + ' 주변 ' + MEAL_TXT[st.meal] + ' 가게를 찾는 중...');
    ensureNear().then(function (res) {
      if (k !== nearKey()) { withNear(box, cb); return; } // 그사이 위치·반경·끼니가 바뀜
      var items = LP.mergeNearby(res.raw, all(), st.loc, st.loc.r);
      items.forEach(function (r) { nearMap[r.id] = r; });
      cb(items, res);
    });
  }
  function nextRadius() { var i = LP.RADII.indexOf(st.loc.r); return i >= 0 && i < LP.RADII.length - 1 ? LP.RADII[i + 1] : null; }
  function emptyNearHtml(res) {
    var nr = nextRadius();
    return '<div class="card muted">' + (res.ok ? '반경 ' + LP.radiusTxt(st.loc.r) + ' 안에서 식당을 찾지 못했어요. 반경을 넓혀 보세요.' : '카카오맵 검색을 쓸 수 없어요(인터넷 연결 확인). 기본 목록(순천·광양·여수)이나 직접 추가한 가게만 쓸 수 있어요.') +
      (nr && res.ok ? '<div style="margin-top:8px"><button class="btn sm" data-widen="' + nr + '">반경 ' + LP.radiusTxt(nr) + '로 넓히기</button></div>' : '') + '</div>';
  }

  // ---------- 위치 설정 ----------
  function setLoc(loc) {
    st.loc = { name: loc.name, x: +loc.x, y: +loc.y, r: st.loc.r };
    save(); renderTop();
    $('#picks').innerHTML = '';
    toast(loc.name + ' 기준으로 찾을게요');
  }
  var locResults = [];
  function searchLoc() {
    var q = $('#locQ').value.trim(); if (!q) { toast('동네·역·건물·주소를 입력하세요'); return; }
    $('#locRes').innerHTML = '<div class="muted" style="padding:8px 0"><span class="spin"></span>찾는 중...</div>';
    kakaoReady().then(function () { return LP.searchLocation(q, kakao.maps.services); }).then(function (list) {
      locResults = list;
      $('#locRes').innerHTML = list.length ? list.map(function (o, i) {
        return '<div class="it" data-loc="' + i + '"><div><div class="t">' + esc(o.name) + '</div><div class="s">' + esc(o.sub) + '</div></div><button class="btn sm ghost" data-loc="' + i + '">선택</button></div>';
      }).join('') : '<div class="muted" style="padding:8px 0">찾지 못했어요. 동네 이름이나 역 이름으로 다시 찾아 보세요.</div>';
    }, function () { $('#locRes').innerHTML = '<div class="muted" style="padding:8px 0">카카오맵 검색을 쓸 수 없어요(인터넷 연결 확인).</div>'; });
  }
  $('#locBtn').onclick = searchLoc;
  $('#locQ').onkeydown = function (e) { if (e.key === 'Enter') searchLoc(); };
  $('#gpsBtn').onclick = function () {
    if (!navigator.geolocation) { toast('이 브라우저는 위치 기능을 지원하지 않아요. 지역을 검색해 주세요'); return; }
    toast('현재 위치 확인 중...');
    navigator.geolocation.getCurrentPosition(function (p) {
      var x = p.coords.longitude, y = p.coords.latitude;
      setLoc({ name: '현재 위치', x: x, y: y });
      kakaoReady().then(function () {
        new kakao.maps.services.Geocoder().coord2RegionCode(x, y, function (res, status) {
          if (status !== kakao.maps.services.Status.OK || !res || !res.length || st.loc.x !== x || st.loc.y !== y) return;
          var h = res.filter(function (r) { return r.region_type === 'H'; })[0] || res[0];
          st.loc.name = '현재 위치 (' + (h.region_3depth_name || h.region_2depth_name) + ')';
          save(); renderTop();
        });
      }).catch(function () {});
    }, function (err) {
      toast(err && err.code === 1 ? '위치 권한이 거부됐어요. 브라우저 설정에서 허용하거나 지역을 검색해 주세요' : '현재 위치를 가져오지 못했어요. 지역을 검색해 주세요');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
  };

  // ---------- recommendation ----------
  var skipToday = [];
  function lastVisit(id) { return LP.lastVisit(st.log, id, new Date()); }
  function ctx() {
    return { log: st.log, meal: st.meal, drink: st.drink, cafe: st.cafe, days: st.days, catDays: st.catDays,
      price: st.meal === 'dinner' ? st.priceDinner : st.price, skip: skipToday, hidden: st.hidden, getRate: getRate, now: new Date() };
  }
  function card(r, label, why, main) {
    return '<div class="card ' + (main ? 'pick' : 'alt') + '"><span class="tag">' + esc(label) + '</span>' +
      '<div class="name">' + esc(r.name) + '</div>' +
      '<div class="badges">' + badges(r) + '</div>' +
      '<div class="meta"><span class="cat">' + esc(r.category) + '</span>' + esc(place(r)) + (r.city && r.area ? ' ' + esc(r.area) : '') + distTxt(r) + '</div>' +
      ((r.menu || r.price) ? '<div class="meta">' + esc(r.menu || '') + (r.price ? (r.menu ? ' · ' : '') + priceTxt(r.price) : '') + '</div>' : '') +
      (!r.menu && r.kcat ? '<div class="meta">' + esc(r.kcat.split('>').slice(1).join('>').trim()) + '</div>' : '') +
      (r.note ? '<div class="meta">' + esc(r.note) + '</div>' : '') +
      (r.address ? '<div class="meta">' + esc(r.address) + '</div>' : '') +
      (why ? '<div class="why">' + esc(why) + '</div>' : '') +
      '<div class="rate"><span class="muted">내 별점</span>' + stars(r.id) + '</div>' +
      '<div class="acts"><button class="btn sm" data-ate="' + esc(r.id) + '">여기서 먹었어요</button>' + mapLinks(r) +
      '<button class="btn sm ghost" data-hide="' + esc(r.id) + '">다시 안 볼래요</button></div></div>';
  }
  function renderPicks() {
    var box = $('#picks');
    withNear(box, function (items, res) {
      if (!items.length) { box.innerHTML = emptyNearHtml(res); return; }
      var out = LP.recommend(items, ctx());
      if (!out.picks.length) { box.innerHTML = '<div class="card muted">조건에 맞는 식당이 없어요. 반경을 넓히거나, 빼는 종류·가격 상한을 바꿔 보세요.</div>'; return; }
      var h = res.ok ? '' : '<div class="card muted">카카오맵 검색을 못 해서 저장된 목록에서만 골랐어요.</div>';
      if (out.relaxed) h += '<div class="card muted">최근에 안 간 집이 없어서 최근 방문 제외를 풀고 골랐어요.</div>';
      out.picks.forEach(function (p, i) { h += card(p.r, i === 0 ? '오늘의 ' + MEAL_TXT[st.meal] : '다른 선택 ' + i, p.why, i === 0); });
      h += '<div class="muted" style="margin:-4px 0 10px">' + esc(st.loc.name) + ' 반경 ' + LP.radiusTxt(st.loc.r) + ' · 후보 ' + items.length + '곳</div>';
      h += '<button class="btn big ghost" id="againBtn">다시 뽑기</button>';
      box.innerHTML = h;
      $('#againBtn').onclick = renderPicks;
    });
  }

  function ate(id, date) {
    var r = byId(id); if (!r) return;
    remember(r);
    st.log.push({ id: r.id, name: r.name, city: place(r), cat: r.category, meal: st.meal, date: date || today() });
    save(); toast(r.name + ' 기록했어요'); renderLog();
  }
  function hide(id) {
    remember(byId(id));
    if (st.hidden.indexOf(id) < 0) st.hidden.push(id);
    save(); toast('숨겼어요. 설정에서 되돌릴 수 있어요');
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-ate]'); if (a) { var aid = a.getAttribute('data-ate'); ate(aid); var c = a.closest('.card'); if (c && c.parentNode.id === 'picks' && byId(aid)) { $('#picks').innerHTML = card(byId(aid), '오늘 ' + MEAL_TXT[st.meal], '맛있게 드세요. 다녀오시면 아래 별점(10점 만점)을 눌러 주세요', true); } return; }
    var h = e.target.closest('[data-hide]'); if (h) { hide(h.getAttribute('data-hide')); var c2 = h.closest('.card'); if (c2) c2.remove(); renderList(); return; }
    var u = e.target.closest('[data-unhide]'); if (u) { st.hidden = st.hidden.filter(function (x) { return x !== u.getAttribute('data-unhide'); }); save(); renderHidden(); renderList(); return; }
    var d = e.target.closest('[data-dellog]'); if (d) { st.log.splice(+d.getAttribute('data-dellog'), 1); save(); renderLog(); return; }
    var rt = e.target.closest('[data-rate]'); if (rt) { var sp = rt.parentNode; setRate(sp.getAttribute('data-stars'), +rt.getAttribute('data-rate')); return; }
    var ch = e.target.closest('[data-choose]'); if (ch) { choose(+ch.getAttribute('data-choose')); return; }
    var lc = e.target.closest('[data-loc]'); if (lc) { var o = locResults[+lc.getAttribute('data-loc')]; if (o) { setLoc(o); $('#locRes').innerHTML = ''; $('#locQ').value = ''; } return; }
    var wd = e.target.closest('[data-widen]'); if (wd) { st.loc.r = +wd.getAttribute('data-widen'); save(); renderTop(); if (wd.closest('#picks')) renderPicks(); else renderList(); return; }
    var up = e.target.closest('[data-upd]'); if (up) { var tr = byId(up.getAttribute('data-upd')); if (tr) { $('#srchRegion').value = tr.city || tr.area || ''; openAdd(tr.name.replace(/\(.*?\)/g, ''), tr); } return; }
    var dc = e.target.closest('[data-delcustom]'); if (dc) { st.custom = st.custom.filter(function (x) { return x.id !== dc.getAttribute('data-delcustom'); }); save(); renderList(); return; }
  });

  // ---------- 별점 ----------
  function getRate(id) { return st.rating[id] ? st.rating[id].s : 0; }
  // 추천·목록에 보여 주는 평점 배지: 내 별점 + 카카오맵 평점(5점 만점을 10점으로 환산)
  function badges(r) {
    var s = getRate(r.id);
    var me = '<span class="badge me' + (s ? '' : ' off') + '" data-me="' + esc(r.id) + '">' + (s ? '내 별점 ★ ' + s + '/10' : '내 별점 없음') + '</span>';
    var k = r.kScore ? '<span class="badge k' + (r.kCount < 5 ? ' few' : '') + '">카카오맵 ★ ' + r.kScore.toFixed(1) + '/10 · 리뷰 ' + r.kCount + '</span>' : (r.placeUrl ? '' : '<span class="badge off">카카오맵 평점 없음</span>');
    return me + k;
  }
  // 리뷰가 적은 곳의 만점이 맨 위로 오지 않게 보정(베이지안 평균, 기준 7점·리뷰 5개)
  function kRank(r) { return r.kScore ? (r.kScore * r.kCount + 7 * 5) / (r.kCount + 5) : 0; }
  function scoreTxt(s) { return s ? s + '/10' : '미평가'; }
  function stars(id, small) {
    var s = getRate(id), h = '<span class="stars' + (small ? ' sm' : '') + '" data-stars="' + esc(id) + '">';
    for (var i = 1; i <= 10; i++) h += '<button type="button" aria-label="별점 ' + i + '점" data-rate="' + i + '"' + (i <= s ? ' class="on"' : '') + '>★</button>';
    return h + '<em class="score">' + scoreTxt(s) + '</em></span>';
  }
  function rateMsg(n) {
    if (n <= 2) return '별로예요. 추천에 거의 안 나와요';
    if (n <= 4) return '아쉬워요. 추천을 줄일게요';
    if (n <= 6) return '보통이에요';
    if (n <= 8) return '좋아요. 더 자주 추천할게요';
    return '최고예요. 자주 추천할게요';
  }
  function setRate(id, n) {
    if (!id) return;
    if (getRate(id) === n) { delete st.rating[id]; toast('별점을 지웠어요'); }
    else { st.rating[id] = { s: n, d: today() }; remember(byId(id)); toast(n + '/10 · ' + rateMsg(n)); }
    save();
    var s = getRate(id);
    document.querySelectorAll('.stars').forEach(function (sp) {
      if (sp.getAttribute('data-stars') !== id) return;
      sp.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-rate') <= s); });
      sp.querySelector('.score').textContent = scoreTxt(s);
    });
    document.querySelectorAll('.badge.me').forEach(function (b) {
      if (b.getAttribute('data-me') !== id) return;
      b.textContent = s ? '내 별점 ★ ' + s + '/10' : '내 별점 없음';
      b.classList.toggle('off', !s);
    });
  }

  // ---------- list ----------
  var lf = { cats: [], byDist: true };
  function renderList() {
    if ($('#tab-list').classList.contains('hidden')) return; // 보이지 않으면 주변 검색을 시작하지 않음
    chips($('#listSrc'), ['near', 'base'], [st.listSrc], function (v) { st.listSrc = v; lf.cats = []; save(); renderList(); },
      ['현재 위치 반경 (' + st.loc.name + ' · ' + LP.radiusTxt(st.loc.r) + ')', '기본 목록 (순천·광양·여수)']);
    var near = st.listSrc === 'near';
    var sd = $('#sortDist'); sd.classList.toggle('hidden', !near); sd.classList.toggle('on', near && lf.byDist && !lf.byRate && !lf.byK);
    sd.onclick = function () { lf.byDist = true; lf.byRate = lf.byK = false; renderList(); };
    var sr = $('#sortRate'); sr.classList.toggle('on', !!lf.byRate); sr.onclick = function () { lf.byRate = !lf.byRate; if (lf.byRate) lf.byK = false; renderList(); };
    var sk = $('#sortK'); sk.classList.toggle('on', !!lf.byK); sk.onclick = function () { lf.byK = !lf.byK; if (lf.byK) lf.byRate = false; renderList(); };
    if (near) withNear($('#listBox'), function (items, res) { listRows(items, true, res); });
    else listRows(all(), false, null);
  }
  function listRows(src, near, res) {
    var present = {}; src.forEach(function (r) { present[r.category] = 1; });
    var catList = ALL_CATS.filter(function (c) { return present[c] || lf.cats.indexOf(c) >= 0; });
    chips($('#listCat'), catList, lf.cats, function (v) { tog(lf.cats, v); renderList(); });
    var q = ($('#q').value || '').trim().toLowerCase();
    var hid = {}; st.hidden.forEach(function (x) { hid[x] = 1; });
    var rows = src.filter(function (r) {
      if (lf.cats.length && lf.cats.indexOf(r.category) < 0) return false;
      if (q && (r.name + ' ' + (r.menu || '') + ' ' + (r.area || '') + ' ' + (r.note || '') + ' ' + (r.kcat || '') + ' ' + (r.address || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (lf.byRate) rows = rows.filter(function (r) { return getRate(r.id); });
    if (lf.byRate) rows.sort(function (a, b) { return getRate(b.id) - getRate(a.id) || a.name.localeCompare(b.name, 'ko'); });
    else if (lf.byK) rows.sort(function (a, b) { return kRank(b) - kRank(a) || a.name.localeCompare(b.name, 'ko'); });
    else if (near) rows.sort(function (a, b) { return (a.dist || 0) - (b.dist || 0); });
    else rows.sort(function (a, b) { return a.city === b.city ? a.name.localeCompare(b.name, 'ko') : ci(a.city) - ci(b.city); });
    $('#listCount').textContent = rows.length + '곳' + (near && res && !res.ok ? ' (카카오맵 검색 실패, 저장된 가게만)' : '');
    if (near && !src.length) { $('#listBox').innerHTML = emptyNearHtml(res); return; }
    $('#listBox').innerHTML = rows.map(function (r) {
      var lv = lastVisit(r.id), isK = String(r.id).indexOf('k-') === 0;
      return '<div class="it' + (hid[r.id] ? ' faded' : '') + '"><div><div class="t">' + esc(r.name) + (r.custom ? ' <span class="muted">(직접 추가)</span>' : '') + (r.unverified && !r.kakaoId ? ' <span class="muted">(카카오맵 미등록)</span>' : '') + '</div>' +
        '<div class="badges sm">' + badges(r) + '</div>' +
        '<div class="s"><span class="cat">' + esc(r.category) + '</span>' + esc(place(r)) + (r.city && r.area ? ' ' + esc(r.area) : '') + (near ? distTxt(r) : (r.city === '순천' && r.km != null ? ' · 사무실에서 ' + r.km + 'km' : '')) + (r.menu ? ' · ' + esc(r.menu) : '') + (r.price ? ' · ' + priceTxt(r.price) : '') + '</div>' +
        (r.address ? '<div class="s">' + esc(r.address) + (r.phone ? ' · <a href="tel:' + esc(r.phone) + '" style="color:var(--g)">' + esc(r.phone) + '</a>' : '') + '</div>' : '') +
        '<div class="s">' + stars(r.id, true) + '</div>' +
        '<div class="s">' + (lv === null ? '' : lv + '일 전 방문 · ') + mapMini(r) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        (hid[r.id] ? '<button class="btn sm ghost" data-unhide="' + esc(r.id) + '">숨김 해제</button>' : '<button class="btn sm" data-ate="' + esc(r.id) + '">먹었어요</button>') +
        (isK ? '' : '<button class="btn sm ghost" data-upd="' + esc(r.id) + '">정보 업데이트</button>') +
        (r.custom ? '<button class="btn sm warn" data-delcustom="' + esc(r.id) + '">삭제</button>' : '') +
        '</div></div>';
    }).join('') || '<div class="muted">결과 없음</div>';
  }
  function ci(c) { var i = CITIES.indexOf(c); return i < 0 ? 99 : i; }
  function mapMini(r) { var q = searchQ(r); return '<a href="https://map.naver.com/p/search/' + q + '" target="_blank" rel="noopener" style="color:var(--g)">네이버지도</a> · <a href="' + (r.placeUrl ? esc(r.placeUrl) : 'https://map.kakao.com/?q=' + q) + '" target="_blank" rel="noopener" style="color:var(--g)">카카오맵</a>'; }

  // ---------- log ----------
  var statMeal = null; // null이면 현재 끼니
  function renderLog() {
    var sm = statMeal || st.meal;
    chips($('#statMeal'), ['lunch', 'dinner', 'all'], [sm], function (v) { statMeal = v; renderLog(); }, ['점심', '저녁', '전체']);
    var cnt = LP.catCounts(st.log, 30, sm === 'all' ? null : sm, new Date()), max = 1;
    var list = sm === 'lunch' ? CATS : sm === 'dinner' ? LP.DINNER_CATS : ALL_CATS.filter(function (c) { return cnt[c]; });
    list = list.concat(ALL_CATS.filter(function (c) { return cnt[c] && list.indexOf(c) < 0; }));
    list.forEach(function (c) { if (cnt[c] > max) max = cnt[c]; });
    $('#stats').innerHTML = list.length ? list.map(function (c) {
      return '<div class="stat"><span>' + esc(c) + '</span><div><div class="bar" style="width:' + (cnt[c] / max * 100) + '%;min-width:' + (cnt[c] ? 6 : 0) + 'px"></div></div><span>' + cnt[c] + '</span></div>';
    }).join('') : '<div class="muted">최근 30일 기록이 없어요.</div>';
    var idx = st.log.map(function (l, i) { return i; }).sort(function (a, b) { return st.log[b].date.localeCompare(st.log[a].date); });
    $('#logBox').innerHTML = idx.length ? idx.map(function (i) {
      var l = st.log[i], m = l.meal || 'lunch';
      return '<div class="it"><div><div class="t"><span class="mb ' + m + '">' + MEAL_TXT[m] + '</span>' + esc(l.name || '(이름 없음)') + '</div>' + (l.id && byId(l.id) ? '<div class="s">' + stars(l.id, true) + '</div>' : '') + '<div class="s">' + esc(l.date) + ' · <span class="cat">' + esc(l.cat) + '</span>' + esc(l.city || '') + '</div></div>' +
        '<button class="btn sm warn" data-dellog="' + i + '">삭제</button></div>';
    }).join('') : '<div class="muted">아직 기록이 없어요. 추천 화면에서 "여기서 먹었어요"를 누르면 쌓여요.</div>';
  }

  // ---------- settings ----------
  function renderSet() {
    $('#setDays').value = st.days; $('#setCatDays').value = st.catDays; $('#setPrice').value = st.price || ''; $('#setPriceDinner').value = st.priceDinner || '';
    $('#setCafe').classList.toggle('on', st.cafe);
    renderHidden();
    var n = { 순천: 0, 광양: 0, 여수: 0 }; (window.RESTAURANTS || []).forEach(function (r) { n[r.city]++; });
    $('#dataInfo').textContent = '기본 목록: 순천 ' + n['순천'] + ' · 광양 ' + n['광양'] + ' · 여수 ' + n['여수'] + '곳 (조사일 ' + (window.DATA_DATE || '') + '). 그 밖의 지역은 카카오맵에서 실시간으로 찾아요. 폐업·휴무·가격 변동이 있을 수 있으니 가기 전에 지도에서 영업 여부를 확인하세요.';
  }
  function renderHidden() {
    $('#hiddenBox').innerHTML = st.hidden.length ? st.hidden.map(function (id) { var r = byId(id); return r ? '<div class="it"><div><div class="t">' + esc(r.name) + '</div><div class="s">' + esc(place(r)) + ' · ' + esc(r.category) + '</div></div><button class="btn sm ghost" data-unhide="' + esc(id) + '">되돌리기</button></div>' : ''; }).join('') : '<div class="muted">없음</div>';
  }
  $('#setCafe').onclick = function () { this.classList.toggle('on'); };
  $('#saveSet').onclick = function () {
    st.days = Math.max(0, +$('#setDays').value || 0);
    st.catDays = Math.max(0, +$('#setCatDays').value || 0);
    st.price = +$('#setPrice').value || null;
    st.priceDinner = +$('#setPriceDinner').value || null;
    st.cafe = $('#setCafe').classList.contains('on');
    save(); renderTop(); toast('저장했어요');
  };
  $('#expBtn').onclick = function () {
    var code = btoa(unescape(encodeURIComponent(JSON.stringify(st))));
    (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(function () { toast('백업 코드를 복사했어요'); }, function () { $('#impTxt').classList.remove('hidden'); $('#impTxt').value = code; toast('아래 코드를 직접 복사하세요'); });
  };
  $('#impBtn').onclick = function () {
    var t = $('#impTxt');
    if (t.classList.contains('hidden') || !t.value.trim()) { t.classList.remove('hidden'); t.value = ''; t.placeholder = '백업 코드를 붙여넣고 다시 누르세요'; return; }
    try { var d = JSON.parse(decodeURIComponent(escape(atob(t.value.trim())))); localStorage.setItem(KEY, JSON.stringify(d)); st = load(); t.value = ''; t.classList.add('hidden'); toast('복원했어요'); renderAll(); } catch (e) { toast('코드가 올바르지 않아요'); }
  };
  $('#resetBtn').onclick = function () { if (confirm('먹은 기록을 모두 지울까요?')) { st.log = []; save(); renderLog(); toast('기록을 지웠어요'); } };

  // ---------- 새 가게 추가 (카카오맵 검색) ----------
  function opts(el, items) { el.innerHTML = items.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); }
  function kakaoSearch(q, nearLoc) {
    return kakaoReady().then(function () {
      return new Promise(function (ok, no) {
        var ps = new kakao.maps.services.Places(), out = [], pending = 2, extra = {};
        if (nearLoc) extra.location = new kakao.maps.LatLng(nearLoc.y, nearLoc.x); // 위치 기준 정확도순 + 거리 표시
        function cb(data, status) {
          if (status === kakao.maps.services.Status.OK) out = out.concat(data);
          else if (status === kakao.maps.services.Status.ERROR) { pending = -99; no(new Error('search')); return; }
          if (--pending === 0) ok(out);
        }
        ps.keywordSearch(q, cb, Object.assign({ category_group_code: 'FD6', size: 15 }, extra));
        ps.keywordSearch(q, cb, Object.assign({ category_group_code: 'CE7', size: 5 }, extra));
      });
    });
  }
  function cityOf(addr) { for (var i = 0; i < CITIES.length; i++) if ((addr || '').indexOf(CITIES[i] + '시') >= 0) return CITIES[i]; return null; }
  // 지역 이름: 순천·광양·여수는 짧게, 그 밖은 주소의 시·군·구 (예: 강남구)
  function regionOf(addr) { if (cityOf(addr)) return cityOf(addr); var p = (addr || '').split(' '); return p[1] || p[0] || ''; }
  function kmFrom(x, y) { return x ? Math.round(LP.haversine(OFFICE.x, OFFICE.y, x, y) / 100) / 10 : null; }
  function fromPlace(d) {
    var addr = (d.road_address_name || d.address_name || '').replace('전남광주통합특별시 ', '전남 ');
    return { kakaoId: d.id, address: addr, phone: d.phone || null, placeUrl: (d.place_url || '').replace('http:', 'https:'), x: +d.x, y: +d.y, km: kmFrom(+d.x, +d.y), area: LP.areaOf(d.address_name) || LP.areaOf(addr), kakaoCat: d.category_name, unverified: false };
  }
  var updTarget = null, lastResults = [];
  function findExisting(kakaoId, name, city) {
    var a = all();
    for (var i = 0; i < a.length; i++) if (a[i].kakaoId && a[i].kakaoId === kakaoId) return a[i];
    var n = (name || '').replace(/\s/g, '');
    for (var j = 0; j < a.length; j++) if (a[j].city === city && a[j].name.replace(/\s/g, '') === n) return a[j];
    return null;
  }
  function openAdd(q, target) {
    updTarget = target || null;
    $('#srchQ').value = q || '';
    $('#updBanner').classList.toggle('hidden', !updTarget);
    if (updTarget) $('#updBanner').textContent = '"' + updTarget.name + '" 정보를 업데이트합니다. 아래 검색 결과에서 같은 가게를 고르세요.';
    $('#srchRes').innerHTML = ''; $('#addForm').classList.add('hidden');
    switchTab('add');
    if (q) doSearch();
  }
  function doSearch() {
    var q = $('#srchQ').value.trim(); if (!q) { toast('가게 이름을 입력하세요'); return; }
    var region = $('#srchRegion').value.trim();
    var query = region && q.indexOf(region) < 0 ? region + ' ' + q : q;
    $('#srchRes').innerHTML = '<div class="muted"><span class="spin"></span>카카오맵에서 찾는 중...</div>';
    kakaoSearch(query, region ? null : st.loc).then(function (docs) {
      var seen = {};
      lastResults = docs.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = 1; return true; });
      if (!region) lastResults.sort(function (a, b) { return (+a.distance || 0) - (+b.distance || 0); });
      if (!lastResults.length) {
        if (updTarget) { $('#srchRes').innerHTML = '<div class="muted">카카오맵에서 찾지 못했어요. 이름이 바뀌었거나 폐업했을 수 있어요. 검색어를 줄여 다시 찾아 보고, 폐업이면 추천 화면에서 "다시 안 볼래요"를 누르세요.</div>'; return; }
        $('#srchRes').innerHTML = '<div class="muted">찾지 못했어요. 지역을 적거나 이름을 다르게 쓰거나 직접 입력하세요.</div>'; showManual(q); return;
      }
      $('#srchRes').innerHTML = lastResults.map(function (d, i) {
        var ex = findExisting(d.id, d.place_name, regionOf(d.address_name));
        return '<div class="it"><div><div class="t">' + esc(d.place_name) + (ex && !updTarget ? ' <span class="muted">(목록에 있음)</span>' : '') + '</div><div class="s">' + esc((d.category_name || '').split('>').slice(1).join('>').trim()) + (d.distance ? ' · ' + LP.fmtDist(+d.distance) : '') + '</div><div class="s">' + esc(d.road_address_name || d.address_name) + (d.phone ? ' · ' + esc(d.phone) : '') + '</div></div>' +
          '<button class="btn sm" data-choose="' + i + '">' + (updTarget ? '이 정보로 업데이트' : (ex ? '최신 정보로 갱신' : '선택')) + '</button></div>';
      }).join('');
    }, function () {
      $('#srchRes').innerHTML = '<div class="muted">카카오맵 검색을 쓸 수 없어요(인터넷 연결 확인).' + (updTarget ? '' : ' 아래에 직접 입력해도 돼요.') + '</div>';
      if (!updTarget) showManual(q);
    });
  }
  function applyUpdate(r, info) {
    var patch = { kakaoId: info.kakaoId, address: info.address, phone: info.phone, placeUrl: info.placeUrl, x: info.x, y: info.y, km: info.km, unverified: false, updated: today() };
    if (!r.area && info.area) patch.area = info.area;
    if (r.custom) { st.custom.forEach(function (c) { if (c.id === r.id) { Object.assign(c, patch); delete c.approx; } }); }
    else st.over[r.id] = Object.assign({}, st.over[r.id] || {}, patch);
    save();
  }
  var pendingNew = null;
  function choose(i) {
    var d = lastResults[i]; if (!d) return;
    var info = fromPlace(d), city = regionOf(d.address_name);
    var target = updTarget || findExisting(d.id, d.place_name, city);
    if (target) {
      applyUpdate(target, info);
      toast(target.name + ' 정보를 업데이트했어요');
      updTarget = null; $('#updBanner').classList.add('hidden');
      $('#srchRes').innerHTML = '<div class="card pick"><span class="tag">업데이트 완료</span><div class="name">' + esc(target.name) + '</div><div class="meta">' + esc(info.address) + (info.phone ? ' · ' + esc(info.phone) : '') + '</div></div>';
      renderList(); return;
    }
    pendingNew = Object.assign({ id: 'c-' + Date.now(), custom: true, name: d.place_name, city: city, category: LP.mapKakaoCat(d.category_name, st.meal), menu: '', note: '' }, info);
    $('#addName').value = pendingNew.name;
    $('#addCity').value = city; $('#addCat').value = pendingNew.category;
    $('#addMenu').value = ''; $('#addArea').value = pendingNew.area || '';
    var dm = LP.haversine(st.loc.x, st.loc.y, info.x, info.y);
    $('#addInfo').textContent = info.address + (info.phone ? ' · ' + info.phone : '') + ' · ' + st.loc.name + '에서 ' + LP.fmtDist(dm);
    $('#addForm').classList.remove('hidden');
    $('#addForm').scrollIntoView({ behavior: 'smooth' });
  }
  function showManual(q) {
    pendingNew = null;
    $('#addName').value = q || ''; $('#addMenu').value = ''; $('#addArea').value = '';
    $('#addInfo').textContent = '직접 입력 (카카오맵 정보 없음). 위치는 지금 설정한 "' + st.loc.name + '"으로 저장돼요.';
    $('#addCity').value = $('#srchRegion').value.trim() || cityOf(st.loc.name) || '';
    $('#addForm').classList.remove('hidden');
  }
  $('#srchBtn').onclick = doSearch;
  $('#srchQ').onkeydown = function (e) { if (e.key === 'Enter') doSearch(); };
  $('#manualBtn').onclick = function () { showManual($('#srchQ').value.trim()); };
  $('#addBtn').onclick = function () {
    var name = $('#addName').value.trim(); if (!name) { toast('가게 이름을 입력하세요'); return; }
    // 직접 입력한 가게는 좌표가 없으니 지금 위치 좌표를 근사값으로 넣어 주변 추천에 나오게 한다
    var r = Object.assign(pendingNew || { id: 'c-' + Date.now(), custom: true, unverified: true, x: st.loc.x, y: st.loc.y, approx: true }, { name: name, city: $('#addCity').value.trim(), category: $('#addCat').value, menu: $('#addMenu').value.trim(), area: $('#addArea').value.trim() });
    if (r.kakaoCat) delete r.kakaoCat;
    st.custom.push(r); pendingNew = null;
    save(); $('#addForm').classList.add('hidden'); $('#srchRes').innerHTML = ''; $('#srchQ').value = '';
    toast(name + ' 추가했어요. 이제 추천에 나와요'); renderList();
  };
  $('#extBtn').onclick = function () {
    var ds = $('#extDate').value.trim() || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { toast('날짜는 2026-09-28 형식으로'); return; }
    st.log.push({ id: null, name: $('#extName').value.trim() || '목록 밖 식당', cat: $('#extCat').value, meal: $('#extMeal').value === 'dinner' ? 'dinner' : 'lunch', date: ds });
    save(); $('#extName').value = ''; toast('기록했어요'); renderLog();
  };

  // ---------- tabs / init ----------
  function switchTab(tab) {
    document.querySelectorAll('nav button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-tab') === tab); });
    ['pick', 'list', 'add', 'log', 'set'].forEach(function (t) { $('#tab-' + t).classList.toggle('hidden', t !== tab); });
    if (tab === 'list') renderList();
    if (tab === 'log') renderLog();
    if (tab === 'set') renderSet();
    window.scrollTo(0, 0);
  }
  document.querySelector('nav').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.getAttribute('data-tab') === 'add' && updTarget) { updTarget = null; $('#updBanner').classList.add('hidden'); }
    switchTab(b.getAttribute('data-tab'));
  };
  $('#goAdd').onclick = function () { openAdd($('#q').value.trim()); };
  $('#mealSeg').onclick = function (e) {
    var b = e.target.closest('[data-meal]'); if (!b) return;
    var m = b.getAttribute('data-meal'); if (m === st.meal) return;
    st.meal = m; st.mealDay = today(); save();
    $('#picks').innerHTML = ''; statMeal = null;
    renderTop(); renderList(); renderLog();
  };
  function renderTop() {
    var dinner = st.meal === 'dinner';
    document.body.classList.toggle('dinner', dinner);
    document.querySelectorAll('#mealSeg button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-meal') === st.meal); });
    $('#goBtn').textContent = MEAL_TXT[st.meal] + ' 골라줘';
    $('#locName').textContent = '📍 ' + st.loc.name;
    var rs = LP.RADII.map(String);
    chips($('#radChips'), rs, [String(st.loc.r)], function (v) { st.loc.r = +v; save(); renderTop(); $('#picks').innerHTML = ''; }, LP.RADII.map(LP.radiusTxt));
    $('#drinkRow').classList.toggle('hidden', !dinner);
    $('#drinkChip').classList.toggle('on', st.drink);
    var mc = mealCats();
    skipToday = skipToday.filter(function (c) { return mc.indexOf(c) >= 0; });
    chips($('#skipChips'), mc, skipToday, function (v) { tog(skipToday, v); renderTop(); });
    $('#extMeal').value = st.meal;
  }
  $('#drinkChip').onclick = function () { st.drink = !st.drink; save(); renderTop(); toast(st.drink ? '술집·호프·이자카야를 더 자주 추천할게요' : '술집류는 가끔만 추천할게요'); };
  function renderAll() { renderTop(); renderList(); renderLog(); renderSet(); }
  $('#goBtn').onclick = renderPicks;
  $('#q').oninput = renderList;
  opts($('#addCat'), ALL_CATS); opts($('#extCat'), ALL_CATS);
  $('#extDate').value = today();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
