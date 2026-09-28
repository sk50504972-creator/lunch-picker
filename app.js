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
      nearOnly: !!d.nearOnly
    };
  }
  function save() { localStorage.setItem(KEY, JSON.stringify(st)); }

  function all() {
    var base = (window.RESTAURANTS || []).slice();
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
      '<a class="lnk" target="_blank" rel="noopener" href="https://map.kakao.com/?q=' + q + '">카카오맵</a>';
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
      if (st.nearOnly && r.city === '순천' && !r.near) return false;
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
        if (lv === null) return 1.6;             // 한 번도 안 간 집 가산
        return Math.min(1.4, 0.4 + lv / 30);     // 오래전에 간 집일수록 ↑
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
    if (avoid[r.category]) a.push('후보가 적어 최근 먹은 종류 포함');
    return a.join(' · ');
  }

  function card(r, label, why, main) {
    return '<div class="card ' + (main ? 'pick' : 'alt') + '"><span class="tag">' + label + '</span>' +
      '<div class="name">' + esc(r.name) + '</div>' +
      '<div class="meta"><span class="cat">' + esc(r.category) + '</span>' + esc(r.city) + (r.area ? ' ' + esc(r.area) : '') + '</div>' +
      '<div class="meta">' + esc(r.menu || '') + (r.price ? ' · ' + priceTxt(r.price) : '') + '</div>' +
      (r.note ? '<div class="meta">' + esc(r.note) + '</div>' : '') +
      (r.address ? '<div class="meta">' + esc(r.address) + '</div>' : '') +
      (why ? '<div class="why">' + esc(why) + '</div>' : '') +
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
    var a = e.target.closest('[data-ate]'); if (a) { ate(a.getAttribute('data-ate')); var c = a.closest('.card'); if (c && c.parentNode.id === 'picks') { $('#picks').innerHTML = card(byId(a.getAttribute('data-ate')), '오늘 점심', '맛있게 드세요', true); } return; }
    var h = e.target.closest('[data-hide]'); if (h) { hide(h.getAttribute('data-hide')); var c2 = h.closest('.card'); if (c2) c2.remove(); renderList(); return; }
    var u = e.target.closest('[data-unhide]'); if (u) { st.hidden = st.hidden.filter(function (x) { return x !== u.getAttribute('data-unhide'); }); save(); renderHidden(); renderList(); return; }
    var d = e.target.closest('[data-dellog]'); if (d) { st.log.splice(+d.getAttribute('data-dellog'), 1); save(); renderLog(); return; }
    var dc = e.target.closest('[data-delcustom]'); if (dc) { st.custom = st.custom.filter(function (x) { return x.id !== dc.getAttribute('data-delcustom'); }); save(); renderList(); return; }
  });

  // ---------- list ----------
  var lf = { cities: CITIES.slice(), cats: [] };
  function renderList() {
    chips($('#listCity'), CITIES, lf.cities, function (v) { tog(lf.cities, v); renderList(); });
    chips($('#listCat'), CATS, lf.cats, function (v) { tog(lf.cats, v); renderList(); });
    var q = ($('#q').value || '').trim().toLowerCase();
    var hid = {}; st.hidden.forEach(function (x) { hid[x] = 1; });
    var rows = all().filter(function (r) {
      if (lf.cities.indexOf(r.city) < 0) return false;
      if (lf.cats.length && lf.cats.indexOf(r.category) < 0) return false;
      if (q && (r.name + ' ' + (r.menu || '') + ' ' + (r.area || '') + ' ' + (r.note || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(function (a, b) { return a.city === b.city ? a.name.localeCompare(b.name, 'ko') : CITIES.indexOf(a.city) - CITIES.indexOf(b.city); });
    $('#listCount').textContent = rows.length + '곳';
    $('#listBox').innerHTML = rows.map(function (r) {
      var lv = lastVisit(r.id);
      return '<div class="it' + (hid[r.id] ? ' faded' : '') + '"><div><div class="t">' + esc(r.name) + (r.custom ? ' <span class="muted">(직접 추가)</span>' : '') + '</div>' +
        '<div class="s"><span class="cat">' + esc(r.category) + '</span>' + esc(r.city) + ' ' + esc(r.area || '') + ' · ' + esc(r.menu || '') + (r.price ? ' · ' + priceTxt(r.price) : '') + '</div>' +
        '<div class="s">' + (lv === null ? '' : lv + '일 전 방문 · ') + mapMini(r) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;gap:4px">' +
        (hid[r.id] ? '<button class="btn sm ghost" data-unhide="' + esc(r.id) + '">숨김 해제</button>' : '<button class="btn sm" data-ate="' + esc(r.id) + '">먹었어요</button>') +
        (r.custom ? '<button class="btn sm warn" data-delcustom="' + esc(r.id) + '">삭제</button>' : '') +
        '</div></div>';
    }).join('') || '<div class="muted">결과 없음</div>';
  }
  function mapMini(r) { var q = encodeURIComponent(r.city + ' ' + r.name); return '<a href="https://map.naver.com/p/search/' + q + '" target="_blank" rel="noopener" style="color:var(--g)">지도</a>'; }
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
      return '<div class="it"><div><div class="t">' + esc(l.name || '(이름 없음)') + '</div><div class="s">' + esc(l.date) + ' · <span class="cat">' + esc(l.cat) + '</span>' + esc(l.city || '') + '</div></div>' +
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

  // ---------- add custom / external ----------
  function opts(el, items) { el.innerHTML = items.map(function (x) { return '<option>' + esc(x) + '</option>'; }).join(''); }
  $('#addBtn').onclick = function () {
    var name = $('#addName').value.trim(); if (!name) { toast('가게 이름을 입력하세요'); return; }
    st.custom.push({ id: 'c-' + Date.now(), custom: true, name: name, city: $('#addCity').value, category: $('#addCat').value, menu: $('#addMenu').value.trim(), area: $('#addArea').value.trim() });
    save(); $('#addName').value = $('#addMenu').value = $('#addArea').value = ''; toast('추가했어요'); renderList();
  };
  $('#extBtn').onclick = function () {
    var ds = $('#extDate').value.trim() || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) { toast('날짜는 2026-09-28 형식으로'); return; }
    st.log.push({ id: null, name: $('#extName').value.trim() || '목록 밖 식당', cat: $('#extCat').value, date: ds });
    save(); $('#extName').value = ''; toast('기록했어요'); renderLog();
  };

  // ---------- tabs / init ----------
  document.querySelector('nav').onclick = function (e) {
    var b = e.target.closest('button'); if (!b) return;
    document.querySelectorAll('nav button').forEach(function (x) { x.classList.toggle('on', x === b); });
    ['pick', 'list', 'log', 'set'].forEach(function (t) { $('#tab-' + t).classList.toggle('hidden', t !== b.getAttribute('data-tab')); });
    if (b.getAttribute('data-tab') === 'list') renderList();
    if (b.getAttribute('data-tab') === 'log') renderLog();
    if (b.getAttribute('data-tab') === 'set') renderSet();
    window.scrollTo(0, 0);
  };
  function renderTop() {
    chips($('#cityChips'), CITIES, st.cities, function (v) { tog(st.cities, v); if (!st.cities.length) st.cities.push(v); save(); renderTop(); });
    var nb = $('#nearChip'); nb.classList.toggle('on', st.nearOnly); nb.parentNode.classList.toggle('hidden', st.cities.indexOf('순천') < 0);
    nb.onclick = function () { st.nearOnly = !st.nearOnly; save(); renderTop(); };
    chips($('#skipChips'), CATS.filter(function (c) { return st.cafe || c !== '카페·브런치'; }), skipToday, function (v) { tog(skipToday, v); renderTop(); });
  }
  function renderAll() { renderTop(); renderList(); renderLog(); renderSet(); }
  $('#goBtn').onclick = renderPicks;
  $('#q').oninput = renderList;
  opts($('#addCity'), CITIES); opts($('#addCat'), CATS); opts($('#extCat'), CATS);
  $('#extDate').value = today();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
})();
