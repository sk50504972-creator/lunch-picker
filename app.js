(function () {
  'use strict';
  var CITIES = ['순천', '광양', '여수'];
  var CATS = ['한식·백반', '국밥·탕·찌개', '면·분식', '중식', '일식·돈가스', '양식·기타', '해산물·회', '고기·구이', '치킨·패스트푸드', '카페·브런치'];
  var KEY = 'lunchPicker.v1';
  var DAY = 86400000;

  // ---------- state ----------
  var st = load();
  function load() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { d = {}; }
    return {
      log: d.log || [],            // {id?, name, city?, cat, date:'YYYY-MM-DD'}
      hidden: d.hidden || [],      // restaurant ids
      custom: d.custom || [],      // user added restaurants
      cities: d.cities || ['순천'],
      days: d.days != null ? d.days : 14,
      catDays: d.catDays != null ? d.catDays : 2,
      price: d.price || null,
      cafe: !!d.cafe,
      nearOnly: !!d.nearOnly,
      rating: d.rating || {},      // id -> {s:1~10, d:'YYYY-MM-DD'} (10점 만점)
      over: d.over || {}           // id -> 카카오맵에서 갱신한 정보
    };
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(st)); }

  function all() {
    var base = (window.RESTAURANTS || []).map(function (r) { return st.over[r.id] ? Object.assign({}, r, st.over[r.id]) : r; });
    return base.concat(st.custom);
  }
  function byId(id) { var a = all(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }

  // ---------- helpers ----------
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { var d = new Date(); return fmt(d); }
  function fmt(d) { var m = d.getMonth() + 1, dd = d.getDate(); return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (dd < 10 ? '0' : '') + dd; }
  function daysAgo(ds) { var p = ds.split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); var t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((t - d) / DAY); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 1800); }
  function mapLinks(r) {
    var q = encodeURIComponent((r.city || '') + ' ' + r.name);
    return '<a class="lnk" target="_blank" rel="noopener" href="https://map.naver.com/p/search/' + q + '">네이버지도</a>' +
      '<a class="lnk" target="_blank" rel="noopener" href="' + (r.placeUrl ? esc(r.placeUrl) : 'https://map.kakao.com/?q=' + q) + '">카카오맵</a>' +
      (r.phone ? '<a class="lnk" href="tel:' + esc(r.phone) + '">전화</a>' : '');
  }
  function priceTxt(p) { return p ? Number(p).toLocaleString('ko-KR') + '원대' : ''; }
  function chips(el, items, selected, onToggle) {
    el.innerHTML = items.map(function (x) { return '<span class="chip' + (selected.indexOf(x) >= 0 ? ' on' : '') + '" data-v="' + esc(x) + '">' + esc(x) + '</span>'; }).join('');
    el.onclick = function (e) { var c = e.target.closest('.chip'); if (!c) return; onToggle(c.getAttribute('data-v')); };
  }

  // ---------- recommendation ----------
  var skipToday = [];
  function lastVisit(id) {
    var best = null;
    st.log.forEach(function (l) { if (l.id === id) { var a = daysAgo(l.date); if (best === null || a < best) best = a; } });
    return best;
  }
  function catCounts(within) {
    var c = {}; CATS.forEach(function (k) { c[k] = 0; });
    st.log.forEach(function (l) { if (daysAgo(l.date) <= within && c[l.cat] != null) c[l.cat]++; });
    return c;
  }
  function recentCats(within) {
    var s = {};
    if (!within) return s;
    st.log.forEach(function (l) { var a = daysAgo(l.date); if (a >= 0 && a <= within) s[l.cat] = true; });
    return s;
  }
  function candidates(relax) {
    var hid = {}; st.hidden.forEach(function (h) { hid[h] = 1; });
    return all().filter(function (r) {
      if (hid[r.id]) return false;
      if (st.cities.indexOf(r.city) < 0) return false;
      if (st.nearOnly && r.city === '순천' && !(r.near || (r.km != null && r.km <= 3))) return false;
      if (!st.cafe && r.category === '카페·브런치') return false;
      if (skipToday.indexOf(r.category) >= 0) return false;
      if (st.price && r.price && Number(r.price) > Number(st.price)) return false;
      var lv = lastVisit(r.id);
      if (!relax && lv !== null && lv < st.days) return false;
      return true;
    });
  }
  function weightedPick(items, wfn) {
    var tot = 0, ws = items.map(function (x) { var w = Math.max(0.0001, wfn(x)); tot += w; return w; });
    var r = Math.random() * tot;
    for (var i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
  function recommend() {
    var relaxed = false;
    var cand = candidates(false);
    if (!cand.length) { cand = candidates(true); relaxed = true; }
    if (!cand.length) return { picks: [], relaxed: relaxed };
    var cnt = catCounts(30), avoid = recentCats(st.catDays);
    var groups = {};
    cand.forEach(function (r) { (groups[r.category] = groups[r.category] || []).push(r); });
    var cats = Object.keys(groups);
    var picks = [], used = {};
    for (var n = 0; n < 3 && cats.length; n++) {
      var pool = cats.filter(function (c) { return !used[c]; });
      if (!pool.length) break;
      var cat = weightedPick(pool, function (c) {
        var w = 1 / (1 + cnt[c] * 1.5);          // 30일간 적게 먹은 종류일수록 ↑
        if (avoid[c]) w *= 0.08;                 // 최근 N일 먹은 종류는 거의 제외
        w *= Math.min(1, 0.45 + groups[c].length / 12); // 후보가 1~2곳뿐인 종류는 조금 덜
        return w;
      });
      used[cat] = 1;
      var r = weightedPick(groups[cat], function (x) {
        var lv = lastVisit(x.id);
        var rw = rateW(x.id);                    // 내 별점: 높을수록 ↑, 1점은 거의 안 나옴
        if (lv === null) return (getRate(x.id) ? 1.2 : 1.6) * rw; // 한 번도 안 간 집 가산
        return Math.min(1.4, 0.4 + lv / 30) * rw; // 오래전에 간 집일수록 ↑
      });
      picks.push({ r: r, why: whyText(r, cnt, avoid) });
    }
    return { picks: picks, relaxed: relaxed };
  }
  function whyText(r, cnt, avoid) {
    var lv = lastVisit(r.id);
    var a = [];
    a.push(cnt[r.category] === 0 ? '최근 30일 동안 ' + r.category + ' 안 먹음' : '최근 30일 ' + r.category + ' ' + cnt[r.category] + '번');
    a.push(lv === null ? '처음 가는 집' : lv + '일 전에 방문');
    if (getRate(r.id)) a.push('내 별점 ' + getRate(r.id) + '/10');
    if (avoid[r.category]) a.push('후보가 적어 최근 먹은 종류 포함');
    return a.join(' · ');
  }

  function card(r, label, why, main) {
    return '<div class="card ' + (main ? 'pick' : 'alt') + '"><span class="tag">' + label + '</span>' +
      '<div class="name">' + esc(r.name) + '</div>' +
      '<div class="badges">' + badges(r) + '</div>' +
      '<div class="meta"><span class="cat">' + esc(r.category) + '</span>' + esc(r.city) + (r.area ? ' ' + esc(r.area) : '') + kmTxt(r) + '</div>' +
      '<div class="meta">' + esc(r.menu || '') + (r.price ? ' · ' + priceTxt(r.price) : '') + '</div>' +
      (r.note ? '<div class="meta">' + esc(r.note) + '</div>' : '') +
      (r.address ? '<div class="meta">' + esc(r.address) + '</div>' : '') +
      (why ? '<div class="why">' + esc(why) + '</div>' : '') +
      '<div class="rate"><span class="muted">내 별점</span>' + stars(r.id) + '</div>' +
      '<div class="acts"><button class="btn sm" data-ate="' + esc(r.id) + '">여기서 먹었어요</button>' + mapLinks(r) +
      '<button class="btn sm ghost" data-hide="' + esc(r.id) + '">다시 안 볼래요</button></div></div>';
  }
  function renderPicks() {
    var res = recommend(), box = $('#picks');
    if (!res.picks.length) { box.innerHTML = '<div class="card muted">조건에 맞는 식당이 없어요. 지역을 더 고르거나 설정을 바꿔 보세요.</div>'; return; }
    var h = res.relaxed ? '<div class="card muted">최근에 안 간 집이 없어서 최근 방문 제외를 풀고 골랐어요.</div>' : '';
    res.picks.forEach(function (p, i) { h += card(p.r, i === 0 ? '오늘의 추천' : '다른 선택 ' + i, p.why, i === 0); });
    h += '<button class="btn big ghost" id="againBtn">다시 뽑기</button>';
    box.innerHTML = h;
    $('#againBtn').onclick = renderPicks;
  }

  function ate(id, date) {
    var r = byId(id); if (!r) return;
    st.log.push({ id: r.id, name: r.name, city: r.city, cat: r.category, date: date || today() });
    save(); toast(r.name + ' 기록했어요'); renderLog();
  }
  function hide(id) {
    if (st.hidden.indexOf(id) < 0) st.hidden.push(id);
    save(); toast('숨겼어요. 설정에서 되돌릴 수 있어요');
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-ate]'); if (a) { ate(a.getAttribute('data-ate')); var c = a.closest('.card'); if (c && c.parentNode.id === 'picks') { $('#picks').innerHTML = card(byId(a.getAttribute('data-ate')), '오늘 점심', '맛있게 드세요. 다녀오시면 아래 별점(10점 만점)을 눌러 주세요', true); } return; }
    var h = e.target.closest('[data-hide]'); if (h) { hide(h.getAttribute('data-hide')); var c2 = h.closest('.card'); if (c2) c2.remove(); renderList(); return; }
    var u = e.target.closest('[data-unhide]'); if (u) { st.hidden = st.hidden.filter(function (x) { return x !== u.getAttribute('data-unhide'); }); save(); renderHidden(); renderList(); return; }
    var d = e.target.closest('[data-dellog]'); if (d) { st.log.splice(+d.getAttribute('data-dellog'), 1); save(); renderLog(); return; }
    var rt = e.target.closest('[data-rate]'); if (rt) { var sp = rt.parentNode; setRate(sp.getAttribute('data-stars'), +rt.getAttribute('data-rate')); return; }
    var ch = e.target.closest('[data-choose]'); if (ch) { choose(+ch.getAttribute('data-choose')); return; }
    var up = e.target.closest('[data-upd]'); if (up) { var tr = byId(up.getAttribute('data-upd')); if (tr) { $('#srchCity').value = tr.city; openAdd(tr.name.replace(/\(.*?\)/g, ''), tr); } return; }
    var dc = e.target.closest('[data-delcustom]'); if (dc) { st.custom = st.custom.filter(function (x) { return x.id !== dc.getAttribute('data-delcustom'); }); save(); renderList(); return; }
  });

  // ---------- 별점 ----------
  function getRate(id) { return st.rating[id] ? st.rating[id].s : 0; }
  // 별점 가중치: 미평가 1, 1점 0.1, 5점 1(보통), 10점 3
  function rateW(id) { var s = getRate(id); if (!s) return 1; return s <= 5 ? 0.1 + (s - 1) * 0.225 : 1 + (s - 5) * 0.4; }
  // 추천·목록에 보여 주는 평점 배지: 내 별점 + 카카오맵 평점(5점 만점을 10점으로 환산)
  function badges(r) {
    var s = getRate(r.id);
    var me = '<span class="badge me' + (s ? '' : ' off') + '" data-me="' + esc(r.id) + '">' + (s ? '내 별점 ★ ' + s + '/10' : '내 별점 없음') + '</span>';
    var k = r.kScore ? '<span class="badge k' + (r.kCount < 5 ? ' few' : '') + '">카카오맵 ★ ' + r.kScore.toFixed(1) + '/10 · 리뷰 ' + r.kCount + '</span>' : '<span class="badge off">카카오맵 평점 없음</span>';
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
    else { st.rating[id] = { s: n, d: today() }; toast(n + '/10 · ' + rateMsg(n)); }
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
  var lf = { cities: CITIES.slice(), cats: [] };
  function renderList() {
    chips($('#listCity'), CITIES, lf.cities, function (v) { tog(lf.cities, v); renderList(); });
    chips($('#listCat'), CATS, lf.cats, function (v) { tog(lf.cats, v); renderList(); });
    var sr = $('#sortRate'); sr.classList.toggle('on', !!lf.byRate); sr.onclick = function () { lf.byRate = !lf.byRate; if (lf.byRate) lf.byK = false; renderList(); };
    var sk = $('#sortK'); sk.classList.toggle('on', !!lf.byK); sk.onclick = function () { lf.byK = !lf.byK; if (lf.byK) lf.byRate = false; renderList(); };
    var q = ($('#q').value || '').trim().toLowerCase();
    var hid = {}; st.hidden.forEach(function (x) { hid[x] = 1; });
    var rows = all().filter(function (r) {
      if (lf.cities.indexOf(r.city) < 0) return false;
      if (lf.cats.length && lf.cats.indexOf(r.category) < 0) return false;
      if (q && (r.name + ' ' + (r.menu || '') + ' ' + (r.area || '') + ' ' + (r.note || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    if (lf.byRate) rows = rows.filter(function (r) { return getRate(r.id); });
    if (lf.byRate) rows.sort(function (a, b) { return getRate(b.id) - getRate(a.id) || a.name.localeCompare(b.name, 'ko'); });
    else if (lf.byK) rows.sort(function (a, b) { return kRank(b) - kRank(a) || a.name.localeCompare(b.name, 'ko'); });
    else rows.sort(function (a, b) { return a.city === b.city ? a.name.localeCompare(b.name, 'ko') : CITIES.indexOf(a.city) - CITIES.indexOf(b.city); });
    $('#listCount').textContent = rows.length + '곳';
    $('#listBox').innerHTML = rows.map(function (r) {
      var lv = lastVisit(r.id);
      return '<div class="it' + (hid[r.id] ? ' faded' : '') + '"><div><div class="t">' + esc(r.name) + (r.custom ? ' <span class="muted">(직접 추가)</span>' : '') + (r.unverified && !r.kakaoId ? ' <span class="muted">(카카오맵 미등록)</span>' : '') + '</div>' +
        '<div class="badges sm">' + badges(r) + '</div>' +
        '<div class="s"><span class="cat">' + esc(r.category) + '</span>' + esc(r.city) + ' ' + esc(r.area || '') + kmTxt(r) + ' · ' + esc(r.menu || '') + (r.price ? ' · ' + priceTxt(r.price) : '') + '</div>' +
        (r.address ? '<div class="s">' + esc(r.address) + (r.phone ? ' · <a href="tel:' + esc(r.phone) + '" style="color:var(--g)">' + esc(r.phone) + '</a>' : '') + '</div>' : '') +
        '<div class="s">' + stars(r.id, true) + '</div>' +
        '<div class="s">' + (lv === null ? '' : lv + '일 전 방문 · ') + mapMini(r) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        (hid[r.id] ? '<button class="btn sm ghost" data-unhide="' + esc(r.id) + '">숨김 해제</button>' : '<button class="btn sm" data-ate="' + esc(r.id) + '">먹었어요</button>') +
        '<button class="btn sm ghost" data-upd="' + esc(r.id) + '">정보 업데이트</button>' +
        (r.custom ? '<button class="btn sm warn" data-delcustom="' + esc(r.id) + '">삭제</button>' : '') +
        '</div></div>';
    }).join('') || '<div class="muted">결과 없음</div>';
  }
  function mapMini(r) { var q = encodeURIComponent(r.city + ' ' + r.name); return '<a href="https://map.naver.com/p/search/' + q + '" target="_blank" rel="noopener" style="color:var(--g)">네이버지도</a> · <a href="' + (r.placeUrl ? esc(r.placeUrl) : 'https://map.kakao.com/?q=' + q) + '" target="_blank" rel="noopener" style="color:var(--g)">카카오맵</a>'; }
  function kmTxt(r) { return r.city === '순천' && r.km != null ? ' · 사무실에서 ' + r.km + 'km' : ''; }
  function tog(arr, v) { var i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }

  // ---------- log ----------
  function renderLog() {
    var cnt = catCounts(30), max = 1;
    CATS.forEach(function (c) { if (cnt[c] > max) max = cnt[c]; });
    $('#stats').innerHTML = CATS.map(function (c) {
      return '<div class="stat"><span>' + c + '</span><div><div class="bar" style="width:' + (cnt[c] / max * 100) + '%;min-width:' + (cnt[c] ? 6 : 0) + 'px"></div></div><span>' + cnt[c] + '</span></div>';
    }).join('');
    var idx = st.log.map(function (l, i) { return i; }).sort(function (a, b) { return st.log[b].date.localeCompare(st.log[a].date); });
    $('#logBox').innerHTML = idx.length ? idx.map(function (i) {
      var l = st.log[i];
      return '<div class="it"><div><div class="t">' + esc(l.name || '(이름 없음)') + '</div>' + (l.id && byId(l.id) ? '<div class="s">' + stars(l.id, true) + '</div>' : '') + '<div class="s">' + esc(l.date) + ' · <span class="cat">' + esc(l.cat) + '</span>' + esc(l.city || '') + '</div></div>' +
        '<button class="btn sm warn" data-dellog="' + i + '">삭제</button></div>';
    }).join('') : '<div class="muted">아직 기록이 없어요. 추천 화면에서 "여기서 먹었어요"를 누르면 쌓여요.</div>';
  }

  // ---------- settings ----------
  function renderSet() {
    $('#setDays').value = st.days; $('#setCatDays').value = st.catDays; $('#setPrice').value = st.price || '';
    $('#setCafe').classList.toggle('on', st.cafe);
    renderHidden();
    var n = { 순천: 0, 광양: 0, 여수: 0 }; (window.RESTAURANTS || []).forEach(function (r) { n[r.city]++; });
    $('#dataInfo').textContent = '수록 식당: 순천 ' + n['순천'] + ' · 광양 ' + n['광양'] + ' · 여수 ' + n['여수'] + '곳 (조사일 ' + (window.DATA_DATE || '') + '). 폐업·휴무·가격 변동이 있을 수 있으니 가기 전에 지도에서 영업 여부를 확인하세요.';
  }
  function renderHidden() {
    $('#hiddenBox').innerHTML = st.hidden.length ? st.hidden.map(function (id) { var r = byId(id); return r ? '<div class="it"><div><div class="t">' + esc(r.name) + '</div><div class="s">' + esc(r.city) + ' · ' + esc(r.category) + '</div></div><button class="btn sm ghost" data-unhide="' + esc(id) + '">되돌리기</button></div>' : ''; }).join('') : '<div class="muted">없음</div>';
  }
  $('#setCafe').onclick = function () { this.classList.toggle('on'); };
  $('#saveSet').onclick = function () {
    st.days = Math.max(0, +$('#setDays').value || 0);
    st.catDays = Math.max(0, +$('#setCatDays').value || 0);
    st.price = +$('#setPrice').value || null;
    st.cafe = $('#setCafe').classList.contains('on');
    save(); toast('저장했어요');
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
  var KAKAO_JS_KEY = '574c00f6ac5c120d1a6c5cbbfee73527';
  var sdkP = null;
  function kakaoReady() {
    if (window.kakao && window.kakao.maps && window.kakao.maps.services) return Promise.resolve();
    if (sdkP) return sdkP;
    sdkP = new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=' + KAKAO_JS_KEY + '&libraries=services&autoload=false';
      s.onload = function () { try { kakao.maps.load(function () { ok(); }); } catch (e) { no(e); } };
      s.onerror = function () { sdkP = null; no(new Error('sdk')); };
      document.head.appendChild(s);
      setTimeout(function () { no(new Error('timeout')); }, 10000);
    });
    return sdkP;
  }
  function kakaoSearch(q) {
    return kakaoReady().then(function () {
      return new Promise(function (ok, no) {
        var ps = new kakao.maps.services.Places(), out = [], pending = 2;
        function cb(data, status) {
          if (status === kakao.maps.services.Status.OK) out = out.concat(data);
          else if (status === kakao.maps.services.Status.ERROR) { pending = -99; no(new Error('search')); return; }
          if (--pending === 0) ok(out);
        }
        ps.keywordSearch(q, cb, { category_group_code: 'FD6', size: 15 });
        ps.keywordSearch(q, cb, { category_group_code: 'CE7', size: 5 });
      });
    });
  }
  function catFromKakao(c) {
    c = c || '';
    var rules = [
      [/카페|디저트|제과|베이커리|브런치|도넛|아이스크림/, '카페·브런치'],
      [/치킨|패스트푸드|햄버거|통닭/, '치킨·패스트푸드'],
      [/중식|중국요리|양꼬치|마라|짬뽕/, '중식'],
      [/일식|돈까스|돈가스|초밥|라멘|우동|참치|이자카야/, '일식·돈가스'],
      [/분식|국수|칼국수|냉면|만두|김밥|밀면|수제비|막국수|떡볶이/, '면·분식'],
      [/국밥|해장국|설렁탕|고탕|감자탕|찌개|전골|추어|순대|탕|삼계/, '국밥·탕·찌개'],
      [/해물|생선|회|조개|게|장어|아구|낙지|복어|주꾸미|꿀막|굴/, '해산물·회'],
      [/육류|고기|갈비|삼겹|곱창|오리|닭|족발|보쌈|불고기|정육|양고기|한우/, '고기·구이'],
      [/양식|이탈리안|피자|스테이크|파스타|멕시칸|아시아|베트남|태국|인도|샐러드|퓨전|패밀리레스토랑|프랑스/, '양식·기타']
    ];
    var tail = c.split('>').slice(1).join('>');
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(tail)) return rules[i][1];
    return '한식·백반';
  }
  function cityOf(addr) { for (var i = 0; i < CITIES.length; i++) if ((addr || '').indexOf(CITIES[i] + '시') >= 0) return CITIES[i]; return null; }
  function areaOf(addr) { var m = (addr || '').match(/\s(\S+(?:동|읍|면))\s/); return m ? m[1] : ''; }
  function kmFrom(x, y) {
    var o = window.OFFICE; if (!o || !x) return null;
    var t = Math.PI / 180, dLat = (y - o.y) * t, dLon = (x - o.x) * t;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(o.y * t) * Math.cos(y * t) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(a)) * 10) / 10;
  }
  function fromPlace(d) {
    var addr = (d.road_address_name || d.address_name || '').replace('전남광주통합특별시 ', '전남 ');
    return { kakaoId: d.id, address: addr, phone: d.phone || null, placeUrl: (d.place_url || '').replace('http:', 'https:'), x: +d.x, y: +d.y, km: kmFrom(+d.x, +d.y), area: areaOf(d.address_name) || areaOf(addr), kakaoCat: d.category_name, unverified: false };
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
    var city = $('#srchCity').value;
    var query = /순천|광양|여수/.test(q) ? q : city + ' ' + q;
    $('#srchRes').innerHTML = '<div class="muted">카카오맵에서 찾는 중...</div>';
    kakaoSearch(query).then(function (docs) {
      var seen = {};
      lastResults = docs.filter(function (d) { if (seen[d.id] || !cityOf(d.address_name)) return false; seen[d.id] = 1; return true; });
      if (!lastResults.length) {
        if (updTarget) { $('#srchRes').innerHTML = '<div class="muted">카카오맵에서 찾지 못했어요. 이름이 바뀜었거나 폐업했을 수 있어요. 검색어를 줄여 다시 찾아 보고, 폐업이면 추천 화면에서 "다시 안 볼래요"를 누르세요.</div>'; return; }
        $('#srchRes').innerHTML = '<div class="muted">순천·광양·여수에서 찾지 못했어요. 이름을 다르게 쓰거나 직접 입력하세요.</div>'; showManual(q); return;
      }
      $('#srchRes').innerHTML = lastResults.map(function (d, i) {
        var ex = findExisting(d.id, d.place_name, cityOf(d.address_name));
        return '<div class="it"><div><div class="t">' + esc(d.place_name) + (ex && !updTarget ? ' <span class="muted">(목록에 있음)</span>' : '') + '</div><div class="s">' + esc((d.category_name || '').split('>').slice(1).join('>').trim()) + '</div><div class="s">' + esc(d.road_address_name || d.address_name) + (d.phone ? ' · ' + esc(d.phone) : '') + '</div></div>' +
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
    if (r.custom) { st.custom.forEach(function (c) { if (c.id === r.id) Object.assign(c, patch); }); }
    else st.over[r.id] = Object.assign({}, st.over[r.id] || {}, patch);
    save();
  }
  var pendingNew = null;
  function choose(i) {
    var d = lastResults[i]; if (!d) return;
    var info = fromPlace(d), city = cityOf(d.address_name);
    var target = updTarget || findExisting(d.id, d.place_name, city);
    if (target) {
      applyUpdate(target, info);
      toast(target.name + ' 정보를 업데이트했어요');
      updTarget = null; $('#updBanner').classList.add('hidden');
      $('#srchRes').innerHTML = '<div class="card pick"><span class="tag">업데이트 완료</span><div class="name">' + esc(target.name) + '</div><div class="meta">' + esc(info.address) + (info.phone ? ' · ' + esc(info.phone) : '') + '</div></div>';
      renderList(); return;
    }
    pendingNew = Object.assign({ id: 'c-' + Date.now(), custom: true, name: d.place_name, city: city, category: catFromKakao(d.category_name), menu: '', note: '' }, info);
    $('#addName').value = pendingNew.name;
    $('#addCity').value = city; $('#addCat').value = pendingNew.category;
    $('#addMenu').value = ''; $('#addArea').value = pendingNew.area || '';
    $('#addInfo').textContent = info.address + (info.phone ? ' · ' + info.phone : '') + (city === '순천' && info.km != null ? ' · 사무실에서 ' + info.km + 'km' : '');
    $('#addForm').classList.remove('hidden');
    $('#addForm').scrollIntoView({ behavior: 'smooth' });
  }
  function showManual(q) {
    pendingNew = null;
    $('#addName').value = q || ''; $('#addMenu').value = ''; $('#addArea').value = ''; $('#addInfo').textContent = '직접 입력 (카카오맵 정보 없음)';
    $('#addCity').value = $('#srchCity').value;
    $('#addForm').classList.remove('hidden');
  }
  $('#srchBtn').onclick = doSearch;
  $('#srchQ').onkeydown = function (e) { if (e.key === 'Enter') doSearch(); };
  $('#manualBtn').onclick = function () { showManual($('#srchQ').value.trim()); };
  $('#addBtn').onclick = function () {
    var name = $('#addName').value.trim(); if (!name) { toast('가게 이름을 입력하세요'); return; }
    var r = Object.assign(pendingNew || { id: 'c-' + Date.now(), custom: true, unverified: true }, { name: name, city: $('#addCity').value, category: $('#addCat').value, menu: $('#addMenu').value.trim(), area: $('#addArea').value.trim() });
    if (r.kakaoCat) delete r.kakaoCat;
    st.custom.push(r); pendingNew = null;
    save(); $('#addForm').classList.add('hidden'); $('#srchRes').innerHTML = ''; $('#srchQ').value = '';
    toast(name + ' 추가했어요. 이제 추천에 나와요'); renderList();
  };
  $('#extBtn').onclick = function () {
    var ds = $('#extDate').value.trim() || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { toast('날짜는 2026-09-28 형식으로'); return; }
    st.log.push({ id: null, name: $('#extName').value.trim() || '목록 밖 식당', cat: $('#extCat').value, date: ds });
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
  function renderTop() {
    chips($('#cityChips'), CITIES, st.cities, function (v) { tog(st.cities, v); if (!st.cities.length) st.cities.push(v); save(); renderTop(); });
    var nb = $('#nearChip'); nb.classList.toggle('on', st.nearOnly); nb.parentNode.classList.toggle('hidden', st.cities.indexOf('순천') < 0);
    nb.onclick = function () { st.nearOnly = !st.nearOnly; save(); renderTop(); };
    chips($('#skipChips'), CATS.filter(function (c) { return st.cafe || c !== '카페·브런치'; }), skipToday, function (v) { tog(skipToday, v); renderTop(); });
  }
  function renderAll() { renderTop(); renderList(); renderLog(); renderSet(); }
  $('#goBtn').onclick = renderPicks;
  $('#q').oninput = renderList;
  opts($('#addCity'), CITIES); opts($('#srchCity'), CITIES); opts($('#addCat'), CATS); opts($('#extCat'), CATS);
  $('#extDate').value = today();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
