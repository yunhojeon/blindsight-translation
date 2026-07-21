// ============================================================================
// reader.js — 블라인드사이트 리더 동작
//   · 헤더 현재 위치(첫 완전노출 문단 / 전체) — 표시만, 주소(URL)는 건드리지 않음
//   · 헤더 ☰ 설정 메뉴: 글자 크기 / 줄 간격 / 밝기(시스템·밝게·어둡게) / 원문 / 원어 병기 / 목차 / 북마크 / About
//   · 문단 핸들(⋮) 팝오버: 원문 보기 · 링크 복사 · 북마크
//   · 패널(목차·북마크·About) 공용 백드롭
// 편집 후 `python3 build/build_reader.py` 로 재빌드(이 스크립트가 인라인됨).
// ============================================================================
(function () {
  var b = document.body, root = document.documentElement;
  var $ = function (id) { return document.getElementById(id); };
  var TOTAL = parseInt(b.dataset.total, 10) || document.querySelectorAll('.seg').length;
  function clamp(v, a, c) { return Math.max(a, Math.min(c, v)); }

  // ── 토스트 ─────────────────────────────────────────────────
  var toastEl = $('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  // ── 설정: 글자 크기 / 줄 간격 / 밝기 ─────────────────────────
  var fs = clamp(parseInt(localStorage.getItem('bs_fs'), 10) || 16, 12, 24);
  var lh = clamp(parseFloat(localStorage.getItem('bs_lh')) || 1.8, 1.3, 2.4);
  var theme = localStorage.getItem('bs_theme') || 'system';
  var THEME_LBL = { system: '시스템', light: '밝게', dark: '어둡게' };
  var THEME_NEXT = { system: 'light', light: 'dark', dark: 'system' };
  function applyFs() { root.style.setProperty('--fs', fs + 'px'); }
  function applyLh() { root.style.setProperty('--lh', lh.toFixed(2)); }
  function applyTheme() { root.setAttribute('data-theme', theme); $('theme-val').textContent = THEME_LBL[theme]; }
  applyFs(); applyLh(); applyTheme();

  // ── 원문 / 원어 병기 / 용어 해설 토글(상태) ──────────────────
  var showOrig = localStorage.getItem('bs_orig') === '1';
  var showAnno = localStorage.getItem('bs_anno') !== '0';
  // 용어 해설: 스크롤시 → 켜기 → 끄기 3상태 순환
  var GLOSS_MODES = ['scroll', 'on', 'off'];
  var GLOSS_LBL = { scroll: '스크롤시', on: '켜기', off: '끄기' };
  var glossMode = localStorage.getItem('bs_gloss');
  if (glossMode === '0') glossMode = 'off';                 // 구버전 값 마이그레이션
  else if (GLOSS_MODES.indexOf(glossMode) === -1) glossMode = 'scroll';  // '1'/없음/이상값 → 기본
  function miEl(act) { return document.querySelector('#menu .mi[data-act="' + act + '"]'); }
  function applyOrig() { b.classList.toggle('show-orig', showOrig); var e = miEl('orig'); if (e) e.classList.toggle('on', showOrig); }
  function applyAnno() { b.classList.toggle('hide-anno', !showAnno); var e = miEl('anno'); if (e) e.classList.toggle('on', showAnno); }
  function applyGloss() {
    b.classList.toggle('gloss-off', glossMode === 'off');
    b.classList.toggle('gloss-on', glossMode === 'on');
    var v = $('gloss-val'); if (v) v.textContent = GLOSS_LBL[glossMode];
  }
  applyOrig(); applyAnno(); applyGloss();

  // ── 설정 메뉴 열고닫기 ───────────────────────────────────────
  var menu = $('menu');
  function closeMenu() { menu.classList.remove('show'); }
  $('t-menu').onclick = function (e) { e.stopPropagation(); menu.classList.toggle('show'); };
  document.addEventListener('click', function (e) {
    if (menu.classList.contains('show') && !e.target.closest('#menu') && !e.target.closest('#t-menu')) closeMenu();
  });

  menu.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'fs+') { fs = clamp(fs + 1, 12, 24); localStorage.setItem('bs_fs', fs); applyFs(); }
    else if (act === 'fs-') { fs = clamp(fs - 1, 12, 24); localStorage.setItem('bs_fs', fs); applyFs(); }
    else if (act === 'lh+') { lh = clamp(+(lh + 0.1).toFixed(2), 1.3, 2.4); localStorage.setItem('bs_lh', lh); applyLh(); }
    else if (act === 'lh-') { lh = clamp(+(lh - 0.1).toFixed(2), 1.3, 2.4); localStorage.setItem('bs_lh', lh); applyLh(); }
    else if (act === 'theme') { theme = THEME_NEXT[theme]; localStorage.setItem('bs_theme', theme); applyTheme(); }
    else if (act === 'orig') { showOrig = !showOrig; localStorage.setItem('bs_orig', showOrig ? '1' : '0'); applyOrig(); notePrefs(); }
    else if (act === 'anno') { showAnno = !showAnno; localStorage.setItem('bs_anno', showAnno ? '1' : '0'); applyAnno(); notePrefs(); }
    else if (act === 'gloss') {
      glossMode = GLOSS_MODES[(GLOSS_MODES.indexOf(glossMode) + 1) % GLOSS_MODES.length];
      localStorage.setItem('bs_gloss', glossMode);
      applyGloss();
      if (glossMode !== 'scroll') clearReveal();   // 스크롤 잔여 밑줄 정리
      if (glossMode === 'off') closeGnote();
      notePrefs();
    }
    else if (act === 'search') { closeMenu(); openPanel('search-panel'); setTimeout(function () { var s = $('search-input'); if (s) s.focus(); }, 60); }
    else if (act === 'prev') { closeMenu(); gotoChapter(curChap - 1); }
    else if (act === 'next') { closeMenu(); gotoChapter(curChap + 1); }
    else if (act === 'toc') { closeMenu(); openPanel('toc-panel'); }
    else if (act === 'glossary') { closeMenu(); renderGloss(); openPanel('gl-panel'); }
    else if (act === 'bm') { closeMenu(); renderBM(); openPanel('bm-panel'); }
    else if (act === 'notes') { closeMenu(); renderNotes(); openPanel('note-panel'); }
    else if (act === 'about') { closeMenu(); openPanel('about-panel'); }
    else if (act === 'sync') { closeMenu(); openPanel('sync-panel'); }
  });

  // ── 현재 위치 + URL 동기화 ───────────────────────────────────
  var header = document.querySelector('header'), posEl = $('pos');
  function num(id) { return parseInt((id || '').replace(/\D/g, ''), 10) || 0; }
  var visible = new Set(), posPending = false, lastPosId = null;
  // 실제 사용자 스크롤 입력 이후에만 위치를 '동기화' 한다.
  // (로드·복원·이어보기의 프로그램적 스크롤이 로드시점 0% 를 새 타임스탬프로 push 해
  //  다른 기기의 실제 위치를 덮어쓰는 것을 막는다.)
  var userMoved = false;
  ['wheel', 'touchmove', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, function () { userMoved = true; }, { passive: true });
  });
  // ── 프로그램적 스크롤 게이트 ────────────────────────────────────
  //  복원·이어보기·점프의 중간 프레임이 notePosition() 으로 새 타임스탬프를
  //  push 해 다른 기기의 실제 위치를 덮어쓰는 것을 막는다.
  //   · 목표 도달(progTarget) → 즉시 해제('start' 정렬은 헤더 아래에 안착해 best 로 선택됨)
  //   · 정착 타이머          → 확정 해제('center' 정렬·조기반환 대비의 권위 있는 해제)
  //   · progRecord=true(사용자 내비게이션) 일 때만 해제 시점에 lastPosId 로 1회 기록
  var PROG_SETTLE_MS = 600;   // 8프레임(~130ms) + IO 재관찰 + content-visibility 리플로우 여유
  var progTarget = null, progRecord = false, progTimer = null;
  function beginProg(id, record) {
    clearTimeout(progTimer);                 // 연타는 이전 게이트를 커밋 없이 대체
    progTarget = id || null; progRecord = !!record;
    progTimer = setTimeout(function () { endProg(true); }, PROG_SETTLE_MS);
  }
  function endProg(commit) {
    clearTimeout(progTimer); progTimer = null;
    var rec = progRecord; progTarget = null; progRecord = false;
    if (commit && rec && userMoved && lastPosId) notePosition(lastPosId);
  }
  function firstSegId(ch) { var s = ch && ch.querySelector('.seg'); return s ? s.id : null; }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
    schedulePos();
  }, { threshold: 0 });
  // 관찰 대상은 활성 챕터의 .seg 로 한정한다(showChapter 가 io.observe). 초기화는 맨 아래 페이징 블록.

  // ── 용어 해설 밑줄: 스크롤하는 동안 '보이는 문단'에만 노출 → 멈추면 fade out ──
  // border-color 는 합성(composite) 대상이 아니라 트랜지션이 메인스레드 paint 를 쓰므로,
  // 대상을 화면에 보이는 .seg 로만 한정해 전역 style 재계산/대량 트랜지션을 피한다.
  var REVEAL_IDLE_MS = 2200;   // 스크롤이 멈춘 뒤 밑줄 유지 시간
  var reduceMo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var revealTimer, revealPending = false, lit = new Set();
  function clearReveal() {
    lit.forEach(function (s) { s.classList.remove('gl-reveal'); });
    lit.clear();
  }
  function pokeReveal() {
    if (reduceMo || glossMode !== 'scroll') return;   // 켜기/끄기는 CSS 가 처리, 모션최소화는 상시 옅은 밑줄
    if (!revealPending) {                                        // 프레임당 1회로 합침
      revealPending = true;
      requestAnimationFrame(function () {
        revealPending = false;
        visible.forEach(function (s) { if (!lit.has(s)) { s.classList.add('gl-reveal'); lit.add(s); } });
      });
    }
    clearTimeout(revealTimer);
    revealTimer = setTimeout(clearReveal, REVEAL_IDLE_MS);
  }
  window.addEventListener('scroll', pokeReveal, { passive: true });
  setTimeout(pokeReveal, 300);   // 초기 로드 때도 한 번 보여줌
  function schedulePos() { if (!posPending) { posPending = true; requestAnimationFrame(function () { posPending = false; updatePos(); }); } }
  function updatePos() {
    if (!visible.size) return;
    var hb = header.getBoundingClientRect().bottom, best = null, bestTop = Infinity;
    visible.forEach(function (s) { var t = s.getBoundingClientRect().top; if (t >= hb - 2 && t < bestTop) { bestTop = t; best = s; } });
    if (!best) visible.forEach(function (s) { var t = s.getBoundingClientRect().top; if (t < bestTop) { bestTop = t; best = s; } });
    if (!best || best.id === lastPosId) return;
    lastPosId = best.id;
    if (best.id) {
      localStorage.setItem('bs_pos', best.id);              // 로컬 저장은 항상(기존 동작 유지)
      if (progTimer) {                                       // 프로그램적 스크롤 진행 중 — 동기화 억제
        if (progTarget && best.id === progTarget) endProg(true);   // 목표 도달 → 즉시 확정
      } else if (userMoved) {
        notePosition(best.id);                              // 사용자 스크롤 → 동기화 기록
      }
    }
    // 스크롤로 스스로 '읽던 곳'까지 돌아왔으면 백스택을 정리(pill 숨김).
    if (typeof navStack !== 'undefined' && navStack.length && best.id === navStack[navStack.length - 1]) { navStack.pop(); renderBackpill(); }
    // 전체 진행률(%)만 표시 — 하단 페이저의 "N / 24"(챕터)와 단위가 겹쳐 헷갈리지 않도록.
    posEl.textContent = Math.min(100, Math.round(num(best.id) / TOTAL * 100)) + '%';
  }
  window.addEventListener('scroll', schedulePos, { passive: true });

  // ── 북마크 저장소 ──────────────────────────────────────────
  function bmGet() { try { return JSON.parse(localStorage.getItem('bs_bm') || '[]'); } catch (e) { return []; } }
  function bmSet(a) { localStorage.setItem('bs_bm', JSON.stringify(a)); var c = $('bm-count'); if (c) c.textContent = a.length; }
  function bmHas(id) { return bmGet().indexOf(id) !== -1; }
  function bmToggle(id) { var a = bmGet(), i = a.indexOf(id); if (i === -1) a.push(id); else a.splice(i, 1); bmSet(a); noteBookmark(id, i === -1); return i === -1; }
  (function () { var c = $('bm-count'); if (c) c.textContent = bmGet().length; })();

  // ── 문단 액션 팝오버 ───────────────────────────────────────
  var pmenu = $('pmenu'), curSeg = null;
  function closePMenu() { if (curSeg) curSeg.classList.remove('menu-open'); pmenu.classList.remove('show'); curSeg = null; }
  function openPMenu(seg, handle) {
    if (curSeg === seg) { closePMenu(); return; }
    closePMenu(); curSeg = seg; seg.classList.add('menu-open');
    document.body.appendChild(pmenu);    // .seg 밖으로(paint containment 클리핑 방지)
    pmenu.classList.add('show');
    var r = handle.getBoundingClientRect(), w = pmenu.offsetWidth, h = pmenu.offsetHeight;
    var left = Math.max(6, Math.min(r.left, window.innerWidth - w - 6));
    var top = (r.bottom + h + 6 > window.innerHeight) ? r.top - h - 4 : r.bottom + 4;
    pmenu.style.left = left + 'px';
    pmenu.style.top = Math.max(6, top) + 'px';
    var o = seg.querySelector('.orig');
    pmenu.querySelector('[data-act="orig"]').classList.toggle('on', !!(o && o.classList.contains('open')));
    pmenu.querySelector('[data-act="bm"]').classList.toggle('on', bmHas(seg.id));
  }
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('.seg-handle');
    if (h) { e.preventDefault(); openPMenu(h.parentNode, h); return; }
    if (curSeg && !e.target.closest('#pmenu') && !e.target.closest('.seg-handle')) closePMenu();
  });
  window.addEventListener('scroll', function () { if (curSeg) closePMenu(); }, { passive: true });
  pmenu.addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn || !curSeg) return;
    var act = btn.dataset.act, id = curSeg.id;
    if (act === 'orig') {
      var o = curSeg.querySelector('.orig');
      if (o) { o.classList.toggle('open'); btn.classList.toggle('on', o.classList.contains('open')); }
    } else if (act === 'link') {
      var url = location.href.split('#')[0] + '#' + id;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
        .then(function () { toast('링크 복사됨'); }).catch(function () { prompt('링크 복사', url); });
    } else if (act === 'bm') {
      var added = bmToggle(id); btn.classList.toggle('on', added);
      toast(added ? '북마크 추가' : '북마크 해제');
    }
  });

  // ── 용어 해설 팝오버(#gnote) ───────────────────────────────
  var GL = window.__GL__ || {};
  var TY_LBL = { science: '과학용어', proper: '고유명사', neologism: '작중 조어' };
  var gnote = $('gnote'), gOpen = null;
  function closeGnote() { gnote.classList.remove('show'); gOpen = null; }
  function openGnote(span) {
    if (b.classList.contains('gloss-off')) return;
    var g = GL[span.dataset.g];
    if (!g) return;
    gnote.querySelector('.gn-en').textContent = g.en;
    gnote.querySelector('.gn-tag').textContent = TY_LBL[g.ty] ? ', ' + TY_LBL[g.ty] : '';
    gnote.querySelector('.gn-note').textContent = g.note || '';
    document.body.appendChild(gnote);    // .seg 밖으로(paint containment 클리핑 방지)
    gnote.classList.add('show'); gOpen = span;
    var r = span.getBoundingClientRect(), w = gnote.offsetWidth, h = gnote.offsetHeight;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var above = r.bottom + h + 8 > window.innerHeight;        // 아래 공간 부족하면 위로 플립
    var top = Math.max(8, above ? r.top - h - 4 : r.bottom + 4);  // 위로 띄워도 화면 밖 방지
    gnote.style.left = left + 'px';
    gnote.style.top = top + 'px';
  }
  document.addEventListener('click', function (e) {
    var gl = e.target.closest && e.target.closest('.gl');
    if (gl && gl.dataset.g && !b.classList.contains('gloss-off')) {
      e.preventDefault();
      if (gOpen === gl) { closeGnote(); } else { openGnote(gl); }
      return;
    }
    if (!e.target.closest('#gnote')) closeGnote();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeGnote(); });
  window.addEventListener('scroll', function () { if (gOpen) closeGnote(); }, { passive: true });

  // ── 용어집 패널(전체 용어 — __GL__ 로 클라이언트 렌더) ───────
  var glBuilt = false;
  function renderGloss() {
    if (glBuilt) return;
    var ul = $('gl-list');
    var arr = Object.keys(GL).map(function (id) { return GL[id]; })
      .sort(function (a, c) { return a.ko.localeCompare(c.ko, 'ko'); });
    var frag = document.createDocumentFragment();
    arr.forEach(function (g) {
      var li = document.createElement('li');
      li.dataset.k = (g.ko + ' ' + g.en).toLowerCase();
      var a = document.createElement('a');
      a.href = g.fs ? '#' + g.fs : 'javascript:void(0)';
      a.innerHTML = '<span class="gl-ko"></span><span class="gl-en"></span><span class="gl-tag"></span><span class="gl-note"></span>';
      a.querySelector('.gl-ko').textContent = g.ko;
      a.querySelector('.gl-en').textContent = g.en;
      a.querySelector('.gl-tag').textContent = TY_LBL[g.ty] || '';
      a.querySelector('.gl-note').textContent = g.note || '';
      li.appendChild(a); frag.appendChild(li);
    });
    ul.appendChild(frag); glBuilt = true;
  }
  (function () {
    var s = $('gl-search'); if (!s) return;
    s.addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      $('gl-list').querySelectorAll('li').forEach(function (li) {
        li.style.display = (!q || li.dataset.k.indexOf(q) !== -1) ? '' : 'none';
      });
    });
  })();

  // ── 본문 검색(번역문 + 원문 영어) — 질의 시점 선형 스캔, 별도 인덱스 없음 ──
  var searchInput = $('search-input'), searchList = $('search-list'), searchHint = $('search-hint');
  var SR_MAX = 200, searchTimer = null, lastQuery = '', hiTimer = null;
  var HI_FADE_MS = 4500;                     // 검색어 강조를 이 시간 뒤 자동 해제
  function clearSearchHi() {
    clearTimeout(hiTimer);
    document.querySelectorAll('mark.s-hit').forEach(function (m) {
      var p = m.parentNode; p.replaceChild(document.createTextNode(m.textContent), m); p.normalize();
    });
  }
  function hiInSeg(seg, q) {                 // 이동한 세그먼트 안에서 검색어를 <mark> 로 강조(잠시 후 자동 해제)
    if (!q) return;
    var ql = q.toLowerCase(), walker = document.createTreeWalker(seg, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var txt = node.nodeValue, low = txt.toLowerCase(), idx = low.indexOf(ql);
      if (idx === -1) return;
      var frag = document.createDocumentFragment(), pos = 0;
      while (idx !== -1) {
        if (idx > pos) frag.appendChild(document.createTextNode(txt.slice(pos, idx)));
        var m = document.createElement('mark'); m.className = 's-hit'; m.textContent = txt.slice(idx, idx + q.length);
        frag.appendChild(m); pos = idx + q.length; idx = low.indexOf(ql, pos);
      }
      if (pos < txt.length) frag.appendChild(document.createTextNode(txt.slice(pos)));
      node.parentNode.replaceChild(frag, node);
    });
    clearTimeout(hiTimer);
    hiTimer = setTimeout(clearSearchHi, HI_FADE_MS);
  }
  function srSnippet(a, text, hit, len) {   // 매치 주변만 잘라 스니펫(검색어 <mark>)
    var pad = 28, start = Math.max(0, hit - pad);
    var snip = document.createElement('span'); snip.className = 'sr-snip';
    snip.appendChild(document.createTextNode((start > 0 ? '…' : '') + text.slice(start, hit)));
    var m = document.createElement('mark'); m.textContent = text.slice(hit, hit + len); snip.appendChild(m);
    var end = hit + len + pad * 2;
    snip.appendChild(document.createTextNode(text.slice(hit + len, end) + (end < text.length ? '…' : '')));
    a.appendChild(snip);
  }
  function runSearch(q) {
    clearSearchHi(); lastQuery = q; if (searchList) searchList.innerHTML = '';
    if (!searchList) return;
    if (q.length < 2) { searchHint.style.display = 'block'; searchHint.textContent = q ? '두 글자 이상 입력하세요.' : '번역문과 원문(영어)을 함께 검색합니다.'; return; }
    var ql = q.toLowerCase(), count = 0, capped = false, frag = document.createDocumentFragment();
    var groups = chapters.length ? chapters : [b];
    for (var ci = 0; ci < groups.length && !capped; ci++) {
      var segs = groups[ci].querySelectorAll('.seg');
      for (var i = 0; i < segs.length; i++) {
        var seg = segs[i], koEl = seg.querySelector('.ko'), enEl = seg.querySelector('.orig');
        var koT = koEl ? koEl.textContent : '', enT = enEl ? enEl.textContent : '';
        var src = null;
        if (koT.toLowerCase().indexOf(ql) !== -1) src = koT;
        else if (enT.toLowerCase().indexOf(ql) !== -1) src = enT;
        if (src === null) continue;
        var norm = src.replace(/\s+/g, ' ').trim(), nhit = norm.toLowerCase().indexOf(ql);
        if (nhit === -1) nhit = 0;
        var li = document.createElement('li'); li.className = 'sr-item';
        var a = document.createElement('a'); a.href = 'javascript:void(0)'; a.dataset.goto = seg.id;
        if (chapters.length) { var ns = document.createElement('span'); ns.className = 'sr-n'; ns.textContent = ci + 1; a.appendChild(ns); }
        srSnippet(a, norm, nhit, q.length);
        li.appendChild(a); frag.appendChild(li);
        if (++count >= SR_MAX) { capped = true; break; }
      }
    }
    searchList.appendChild(frag);
    searchHint.style.display = 'block';
    searchHint.textContent = count ? (count + (capped ? '+ (상위 ' + SR_MAX + '개)' : '개') + ' 결과') : '결과 없음';
  }
  if (searchInput) searchInput.addEventListener('input', function () {
    var q = this.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { runSearch(q); }, 120);
  });
  if (searchList) searchList.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-goto]'); if (!a) return;
    var seg = document.getElementById(a.dataset.goto); if (!seg) return;
    closePanels();
    jumpTo(seg);
    hiInSeg(seg, lastQuery);
  });

  // ── 패널(목차·북마크·About) 공용 ───────────────────────────
  var backdrop = $('backdrop');
  function closePanels() {
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('show'); });
    backdrop.classList.remove('show');
  }
  function openPanel(pid) { closePanels(); $(pid).classList.add('show'); backdrop.classList.add('show'); }
  backdrop.onclick = closePanels;
  document.querySelectorAll('[data-close]').forEach(function (x) { x.onclick = closePanels; });
  document.querySelectorAll('.panel .navlist').forEach(function (ul) {
    ul.addEventListener('click', function (e) { if (e.target.closest('a')) closePanels(); });
  });

  function snippet(id) {
    var seg = $(id); if (!seg) return id;
    var ko = seg.querySelector('.ko'), t = (ko ? ko.textContent : '').trim().replace(/\s+/g, ' ');
    return t.length > 42 ? t.slice(0, 42) + '…' : (t || id);
  }
  function renderBM() {
    var a = bmGet(), ul = $('bm-list'); ul.innerHTML = '';
    $('bm-empty').style.display = a.length ? 'none' : 'block';
    a.forEach(function (id) {
      var li = document.createElement('li');
      var link = document.createElement('a'); link.href = '#' + id; link.textContent = snippet(id);
      var rm = document.createElement('span'); rm.className = 'rm'; rm.textContent = '✕'; rm.title = '삭제';
      rm.onclick = function (ev) { ev.stopPropagation(); bmToggle(id); renderBM(); };
      li.appendChild(link); li.appendChild(rm); ul.appendChild(li);
    });
  }

  // ── 챕터 페이징 ──────────────────────────────────────────────
  var chapters = [].slice.call(document.querySelectorAll('.chapter'));
  var curChap = -1;
  var pgPrev = $('pg-prev'), pgNext = $('pg-next'), pgMid = $('pg-mid');
  var miPrev = document.querySelector('#menu [data-act="prev"]'), miNext = document.querySelector('#menu [data-act="next"]');

  function observeChapter(ch) {
    io.disconnect();
    visible.clear();
    clearReveal();                       // 이전 챕터의 밑줄 잔여 제거
    ch.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });
  }

  function showChapter(idx) {            // 표시만 토글(스크롤·URL 은 호출자 담당)
    idx = clamp(idx, 0, chapters.length - 1);
    var ch = chapters[idx];
    if (!ch || idx === curChap) return ch;
    if (chapters[curChap]) chapters[curChap].classList.remove('active');
    ch.classList.add('active');
    curChap = idx;
    localStorage.setItem('bs_chap', idx);
    observeChapter(ch);
    var atFirst = idx === 0, atLast = idx === chapters.length - 1;
    if (pgPrev) pgPrev.disabled = atFirst;
    if (pgNext) pgNext.disabled = atLast;
    if (miPrev) miPrev.disabled = atFirst;
    if (miNext) miNext.disabled = atLast;
    if (pgMid) pgMid.textContent = (idx + 1) + ' / ' + chapters.length;
    lastPosId = null; schedulePos();
    return ch;
  }

  function gotoChapter(idx) {            // 이전/다음/화살표: 맨 위로 (URL 은 바꾸지 않음)
    var prev = curChap;
    var ch = showChapter(idx);
    if (curChap !== prev) { beginProg(firstSegId(ch), true); window.scrollTo(0, 0); }   // 새 챕터 첫 문단을 의도적으로 기록
  }
  if (pgPrev) pgPrev.onclick = function () { gotoChapter(curChap - 1); };
  if (pgNext) pgNext.onclick = function () { gotoChapter(curChap + 1); };
  if (pgMid) pgMid.onclick = function () { openPanel('toc-panel'); };

  document.addEventListener('keydown', function (e) {   // 데스크톱 좌우 화살표
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    var t = e.target.tagName;
    if (t === 'INPUT' || t === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') gotoChapter(curChap + 1);
    else if (e.key === 'ArrowLeft') gotoChapter(curChap - 1);
  });

  // content-visibility:auto 는 화면 밖 문단 높이를 추정치로 두므로, 깊은 위치로 한 번에
  // 스크롤하면 어긋난다. 여러 프레임에 걸쳐 재정렬해 콘텐츠가 렌더되며 위치를 수렴시킨다.
  function scrollToSeg(el, align) {
    var tries = 0;
    (function step() {
      el.scrollIntoView({ block: align });
      if (++tries < 8) requestAnimationFrame(step);
    })();
  }

  // ── 세그먼트로 이동: 대상이 속한 챕터를 먼저 펼친 뒤 스크롤 + 플래시 ──
  //  (URL 은 건드리지 않는다 — 마지막 위치는 별도 동기화, 공유는 ⋮ 링크 복사로.)
  var flashTimer;
  function revealSeg(el, record) {         // record !== false → 사용자 내비게이션(도착점 1회 기록)
    var isChap = el.classList.contains('chapter');
    beginProg(isChap ? firstSegId(el) : el.id, record !== false);
    var chap = isChap ? el : el.closest('.chapter');
    if (chap) showChapter(chapters.indexOf(chap));
    if (isChap) { window.scrollTo(0, 0); return; }
    scrollToSeg(el, 'center');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }
  function goHash() {                     // 최초 로드/공유 링크 진입: URL 해시로 이동
    var h = location.hash.slice(1);
    if (!h) return;
    var el = document.getElementById(h);
    if (el) revealSeg(el);
  }
  // 내부 앵커(#id) 클릭은 URL 을 바꾸지 않고 직접 '점프'시킨다(목차·북마크·용어집 링크).
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    var el = id && document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    jumpTo(el);
  });

  // ── 내비 백스택: 점프 전 '읽던 곳'을 기억 → 좌하단 '↩ 읽던 곳으로' pill 로 복귀 ──
  //  (검색·목차·북마크·용어집 링크로 지나간 챕터를 잠깐 보고 원위치로 돌아오는 흐름.
  //   페이저/화살표의 순차 이동은 스택에 쌓지 않는다.)
  var navStack = [], backpill = $('backpill'), backpillPct = $('backpill-pct');
  function curReadId() { return lastPosId || localStorage.getItem('bs_pos'); }
  function renderBackpill() {
    if (!backpill) return;
    if (!navStack.length) { backpill.classList.remove('show'); return; }
    var id = navStack[navStack.length - 1];
    backpillPct.textContent = '(' + Math.min(100, Math.round(num(id) / TOTAL * 100)) + '%)';
    backpill.classList.add('show');
  }
  function jumpTo(el) {                    // 링크/검색 결과로 이동(점프 = 백스택에 push)
    var from = curReadId();
    var toId = el.id || (el.querySelector && (el.querySelector('.seg') || {}).id);
    if (from && from !== toId && navStack[navStack.length - 1] !== from) navStack.push(from);
    revealSeg(el);
    renderBackpill();
  }
  if (backpill) {
    backpill.querySelector('.bp-go').onclick = function () {   // 되돌아가기: 스택 pop
      var id = navStack.pop();
      var el = id && document.getElementById(id);
      if (el) revealSeg(el);
      renderBackpill();
    };
    backpill.querySelector('.bp-x').onclick = function () {     // 닫기: 스택 비우고 숨김
      navStack.length = 0;
      renderBackpill();
    };
  }

  // ── 초기 표시 ────────────────────────────────────────────────
  function restoreReading() {                            // 마지막으로 읽던 문단으로 복원
    var posId = localStorage.getItem('bs_pos');
    var el = posId && document.getElementById(posId);
    if (el) {
      beginProg(el.id, false);                              // 복원은 기록하지 않음(중간 프레임 억제)
      var chap = el.closest('.chapter');
      if (chap) showChapter(chapters.indexOf(chap));
      scrollToSeg(el, 'start');
      return true;
    }
    var saved = parseInt(localStorage.getItem('bs_chap'), 10);   // 위치 기록 없으면 챕터만
    var ch = showChapter((isNaN(saved) || saved < 0) ? 0 : saved);
    beginProg(firstSegId(ch), false);                      // 챕터만 복원 — 첫 문단 기록 억제
    window.scrollTo(0, 0);
    return false;
  }
  if (chapters.length) {
    document.body.classList.add('paged');               // 페이징 활성(없으면 전체가 한 페이지로 보임)
    if (location.hash && document.getElementById(location.hash.slice(1))) goHash();
    else restoreReading();
  } else {                                                // 폴백: 챕터 없음 → 전체 관찰 + 해시 이동만
    document.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });
    if (location.hash) setTimeout(goHash, 300);
  }
  window.addEventListener('hashchange', goHash);

  // ── 하이라이트 + 메모(노트) ──────────────────────────────────────
  //  선택 → 색 하이라이트/메모, 본문 하이라이트 탭 편집, 메모 패널.
  //  앵커: 세그먼트 .ko 의 '보이는 텍스트'(원어 병기 .anno 제외) 문자 오프셋 + 인용문(quote)
  //        + 앞뒤 문맥(pre/post) → 재빌드로 오프셋이 밀려도 재앵커. 실패해도 삭제 안 함(orphan 보존).
  //  칠하기: CSS Custom Highlight API(DOM 무변형). 미지원 브라우저는 패널·동기화만.
  //  저장: bs_sync.notes = { <id>: {id,seg,s,e,quote,pre,post,color,text,ts,d} } (키별 ts-LWW + tombstone).
  var NOTE_COLORS = ['y', 'g', 'b', 'p'];
  function noteGet() { var l = syncLocalGet(); return l.notes || {}; }
  function noteUpsert(rec) {
    var l = syncLocalGet(); if (!l.notes) l.notes = {};
    rec.ts = Date.now(); rec.d = false; l.notes[rec.id] = rec;
    syncLocalSet(l); syncSchedule();
  }
  function noteDelete(id) {                                     // 확인 후 삭제 → tombstone(전파)
    var l = syncLocalGet(); if (!l.notes) l.notes = {};
    var r = l.notes[id] || { id: id }; r.d = true; r.ts = Date.now(); l.notes[id] = r;
    syncLocalSet(l); syncSchedule();
  }
  function newNoteId() { return 'n' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
  function notesActive() {
    var m = noteGet(), a = [];
    Object.keys(m).forEach(function (k) { var r = m[k]; if (r && !r.d) a.push(r); });
    a.sort(function (x, y) { return (num(x.seg) - num(y.seg)) || ((x.s || 0) - (y.s || 0)); });
    return a;
  }

  // 앵커 유틸 — .ko 의 '보이는' 텍스트 노드만(원어 병기 .anno 서브트리 제외)
  function elOf(n) { return n ? (n.nodeType === 3 ? n.parentElement : n) : null; }
  function koNodes(ko) {
    var w = document.createTreeWalker(ko, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return (n.parentElement && n.parentElement.closest('.anno')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var a = [], n; while ((n = w.nextNode())) a.push(n); return a;
  }
  function koVisText(ko) { return koNodes(ko).map(function (n) { return n.nodeValue; }).join(''); }
  function offToRange(ko, s, e) {
    var nodes = koNodes(ko), acc = 0, r = document.createRange(), setS = false, setE = false;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], len = n.nodeValue.length;
      if (!setS && s <= acc + len) { r.setStart(n, Math.max(0, s - acc)); setS = true; }
      if (!setE && e <= acc + len) { r.setEnd(n, Math.max(0, e - acc)); setE = true; break; }
      acc += len;
    }
    if (!setS) return null;
    if (!setE) { var last = nodes[nodes.length - 1]; if (!last) return null; r.setEnd(last, last.nodeValue.length); }
    return r;
  }
  function domToOff(ko, node, offset) {                         // Selection/caret DOM 위치 → 보이는-텍스트 오프셋
    if (!node || node.nodeType !== 3) return -1;
    var nodes = koNodes(ko), acc = 0;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] === node) return acc + offset;
      acc += nodes[i].nodeValue.length;
    }
    return -1;
  }
  function reanchor(rec, ko) {                                  // 오프셋 우선, 어긋나면 quote+문맥으로 재탐색
    var vis = koVisText(ko);
    if (rec.s != null && rec.e != null && rec.e <= vis.length && vis.slice(rec.s, rec.e) === rec.quote) return { s: rec.s, e: rec.e };
    if (!rec.quote) return null;
    var idx = vis.indexOf(rec.quote), best = -1;
    while (idx !== -1) {
      var preOk = !rec.pre || vis.slice(Math.max(0, idx - rec.pre.length), idx) === rec.pre;
      var postOk = !rec.post || vis.slice(idx + rec.quote.length, idx + rec.quote.length + rec.post.length) === rec.post;
      if (preOk && postOk) { best = idx; break; }
      if (best === -1) best = idx;                              // 문맥 불일치 시 첫 등장 폴백
      idx = vis.indexOf(rec.quote, idx + 1);
    }
    return best === -1 ? null : { s: best, e: best + rec.quote.length };
  }

  // 칠하기(CSS Custom Highlight API — 미지원이면 조용히 스킵)
  var HL_OK = !!(window.CSS && CSS.highlights && window.Highlight);
  var hlObjs = {}, noteOrphan = {};
  if (HL_OK) NOTE_COLORS.forEach(function (c) { hlObjs[c] = new Highlight(); CSS.highlights.set('note-' + c, hlObjs[c]); });
  function paintNotes() {
    noteOrphan = {};
    if (HL_OK) NOTE_COLORS.forEach(function (c) { hlObjs[c].clear(); });
    notesActive().forEach(function (rec) {
      var seg = document.getElementById(rec.seg), ko = seg && seg.querySelector('.ko');
      if (!ko) { noteOrphan[rec.id] = true; return; }
      var off = reanchor(rec, ko);
      if (!off) { noteOrphan[rec.id] = true; return; }          // 재앵커 실패 → orphan(패널에만, 삭제 안 함)
      if (HL_OK) { var r = offToRange(ko, off.s, off.e); if (r) (hlObjs[rec.color] || hlObjs.y).add(r); else noteOrphan[rec.id] = true; }
    });
  }
  function noteCount() { var c = $('note-count'); if (c) c.textContent = notesActive().length; }
  function afterNoteChange() { paintNotes(); noteCount(); if ($('note-panel').classList.contains('show')) renderNotes(); }

  // 선택 툴바(#sel-toolbar): 색 · 메모 · 복사 · 검색
  var selbar = $('sel-toolbar'), selCtx = null;
  function captureSel() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var r = sel.getRangeAt(0), txt = sel.toString();
    if (!txt.trim()) return null;
    var anc = elOf(r.commonAncestorContainer);                 // UI 영역(패널·헤더·팝오버) 선택은 무시
    if (anc && anc.closest('#note-edit,.panel,header,#sel-toolbar,#pmenu,#gnote')) return null;
    var ctx = { text: txt, range: r, ko: null };
    var ks = elOf(r.startContainer), ke = elOf(r.endContainer);
    ks = ks && ks.closest('.ko'); ke = ke && ke.closest('.ko');
    if (ks && ks === ke && r.startContainer.nodeType === 3 && r.endContainer.nodeType === 3) {  // 하이라이트/메모는 단일 .ko 만
      var s = domToOff(ks, r.startContainer, r.startOffset), e = domToOff(ks, r.endContainer, r.endOffset);
      if (s >= 0 && e >= 0) {
        if (s > e) { var t = s; s = e; e = t; }
        if (e > s) {
          var vis = koVisText(ks), seg = ks.closest('.seg');
          ctx.ko = { ko: ks, seg: seg, s: s, e: e, quote: vis.slice(s, e), pre: vis.slice(Math.max(0, s - 20), s), post: vis.slice(e, e + 20) };
        }
      }
    }
    return ctx;
  }
  function hideSelbar() { if (selbar) selbar.classList.remove('show'); selCtx = null; }
  function showSelbar() {
    if (!selbar) return;
    var ctx = captureSel();
    if (!ctx) { hideSelbar(); return; }
    selCtx = ctx;
    selbar.classList.toggle('no-hl', !ctx.ko);                 // .ko 밖 선택(영문 등)은 복사·검색만
    document.body.appendChild(selbar);
    selbar.classList.add('show');
    var r = ctx.range.getBoundingClientRect(), w = selbar.offsetWidth, h = selbar.offsetHeight;
    var left = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6));
    var top = r.bottom + 8;                                     // 기본 아래(모바일 OS 말풍선은 대개 위 → 충돌 회피)
    if (top + h > window.innerHeight - 6) top = r.top - h - 8;
    selbar.style.left = left + 'px';
    selbar.style.top = Math.max(6, top) + 'px';
  }
  function newRec(k, color, text) {
    return { id: newNoteId(), seg: k.seg.id, s: k.s, e: k.e, quote: k.quote, pre: k.pre, post: k.post, color: color, text: text, ts: 0, d: false };
  }
  function clearSelectionAndBar() {                            // 선택 해제 + 툴바 숨김(디바운스 재등장 방지)
    clearTimeout(selShowTimer);
    var s = window.getSelection(); if (s) s.removeAllRanges();
    hideSelbar();
  }
  if (selbar) selbar.addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    var hl = btn.dataset.hl, act = btn.dataset.act;
    if (hl) {                                                   // 색 → 하이라이트 노트 생성
      if (!selCtx || !selCtx.ko) return;
      noteUpsert(newRec(selCtx.ko, hl, '')); afterNoteChange();
      clearSelectionAndBar();
    } else if (act === 'memo') {                                // 메모 → 에디터 열기(새 앵커)
      if (!selCtx || !selCtx.ko) return;
      var k = selCtx.ko, rect = selCtx.range.getBoundingClientRect(), rec = newRec(k, 'y', '');
      clearSelectionAndBar();
      openNoteEdit(rec, true, rect);
    } else if (act === 'copy') {                                // 복사 → 현재 선택을 복사(권한 팝업·프롬프트 회피)
      var okc = false;
      try { okc = !!(document.execCommand && document.execCommand('copy')); } catch (e2) { okc = false; }
      var txt = selCtx ? selCtx.text : '';
      if (!okc && navigator.clipboard && txt) navigator.clipboard.writeText(txt).then(function () { }, function () { });
      toast('복사됨');
      clearSelectionAndBar();
    } else if (act === 'search') {                              // 검색 → 결과 패널 즉시
      var q = (selCtx ? selCtx.text : '').trim();
      clearSelectionAndBar();
      if (!q) return;
      if (searchInput) searchInput.value = q;
      openPanel('search-panel'); runSearch(q);
    }
  });
  // 선택이 '멈췄을 때'만 툴바 표시 — 데스크톱/모바일 공통으로 selectionchange 를 디바운스.
  //  (모바일은 롱프레스·핸들 조정이 mouseup/touchend 로 안 잡히고 selectionchange 로만 옴.)
  var selShowTimer = null;
  function scheduleSelbar() { clearTimeout(selShowTimer); selShowTimer = setTimeout(showSelbar, 220); }
  document.addEventListener('selectionchange', function () {
    var s = window.getSelection();
    if (!s || s.isCollapsed || !String(s).trim()) { clearTimeout(selShowTimer); hideSelbar(); return; }
    scheduleSelbar();
  });
  document.addEventListener('mouseup', function (e) {           // 데스크톱: 즉시(스냅)
    if (e.target.closest && e.target.closest('#sel-toolbar,#note-edit')) return;
    setTimeout(showSelbar, 10);
  });
  window.addEventListener('scroll', function () {              // 스크롤 시 숨기지 말고 선택을 따라 재배치
    if (!selbar || !selbar.classList.contains('show')) return; //  (모바일에서 선택 중 스크롤이 툴바를 없애던 문제)
    var s = window.getSelection();
    if (!s || s.isCollapsed) { hideSelbar(); return; }
    showSelbar();
  }, { passive: true });

  // 메모 편집 팝오버(#note-edit)
  var noteEdit = $('note-edit'), editRec = null, editIsNew = false;
  function openNoteEdit(rec, isNew, rect) {
    if (!noteEdit) return;
    editRec = rec; editIsNew = isNew;
    noteEdit.querySelectorAll('[data-hl]').forEach(function (sw) { sw.classList.toggle('on', sw.dataset.hl === rec.color); });
    var ta = noteEdit.querySelector('textarea'); ta.value = rec.text || '';
    var del = noteEdit.querySelector('[data-ne="del"]'); if (del) del.textContent = isNew ? '취소' : '삭제';
    document.body.appendChild(noteEdit);
    noteEdit.classList.add('show');
    var w = noteEdit.offsetWidth, h = noteEdit.offsetHeight, cx = rect.left + (rect.width || 0) / 2;
    var left = Math.max(8, Math.min(cx - w / 2, window.innerWidth - w - 8));
    var top = rect.bottom + 8; if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 8);
    noteEdit.style.left = left + 'px'; noteEdit.style.top = top + 'px';
    setTimeout(function () { ta.focus(); }, 50);
  }
  function closeNoteEdit() { if (noteEdit) noteEdit.classList.remove('show'); editRec = null; }
  if (noteEdit) noteEdit.addEventListener('click', function (e) {
    var sw = e.target.closest('[data-hl]');
    if (sw && editRec) {
      editRec.color = sw.dataset.hl;
      noteEdit.querySelectorAll('[data-hl]').forEach(function (x) { x.classList.toggle('on', x === sw); });
      return;
    }
    var btn = e.target.closest('[data-ne]'); if (!btn || !editRec) return;
    if (btn.dataset.ne === 'save') {
      editRec.text = noteEdit.querySelector('textarea').value.trim();
      noteUpsert(editRec); afterNoteChange(); closeNoteEdit();
    } else if (btn.dataset.ne === 'del') {
      if (editIsNew) { closeNoteEdit(); }                       // 새 메모 취소 = 폐기(아직 저장 안 됨)
      else if (confirm('이 메모를 삭제할까요?')) { noteDelete(editRec.id); afterNoteChange(); closeNoteEdit(); }
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeNoteEdit(); hideSelbar(); } });

  // 본문 하이라이트 탭 → 편집(Custom Highlight 는 히트테스트 불가 → caret 로 역산)
  function caretPos(x, y) {
    if (document.caretPositionFromPoint) { var p = document.caretPositionFromPoint(x, y); return p ? { node: p.offsetNode, offset: p.offset } : null; }
    if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); return r ? { node: r.startContainer, offset: r.startOffset } : null; }
    return null;
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('#sel-toolbar,#note-edit,#pmenu,#gnote,.seg-handle,a')) return;
    var sel = window.getSelection(); if (sel && !sel.isCollapsed) return;   // 선택 중이면 무시
    var ko = e.target.closest && e.target.closest('.ko'); if (!ko) return;
    var pos = caretPos(e.clientX, e.clientY); if (!pos) return;
    var pe = elOf(pos.node); if (!pe || pe.closest('.anno') || pe.closest('.ko') !== ko) return;
    var off = domToOff(ko, pos.node, pos.offset); if (off < 0) return;
    var seg = ko.closest('.seg');
    var hit = notesActive().filter(function (r) { return r.seg === seg.id && off >= r.s && off < r.e; });
    if (!hit.length) return;                                    // 노트 없으면 통과(용어 해설 등 기존 동작 유지)
    e.stopPropagation(); e.preventDefault();                    // 노트가 있으면 용어 해설(.gl)보다 우선
    closeGnote();
    openNoteEdit(hit[hit.length - 1], false, { left: e.clientX, width: 0, top: e.clientY - 10, bottom: e.clientY + 10 });
  }, true);   // 캡처 단계 — .gl 의 용어 해설(버블) 핸들러보다 먼저 실행

  // 메모 패널(#note-panel)
  function renderNotes() {
    var ul = $('note-list'); if (!ul) return; ul.innerHTML = '';
    var arr = notesActive(), em = $('note-empty');
    if (em) em.style.display = arr.length ? 'none' : 'block';
    arr.forEach(function (rec) {
      var li = document.createElement('li'); li.className = 'note-item';
      var link = document.createElement('a'); link.href = 'javascript:void(0)'; link.dataset.note = rec.id;
      var dot = document.createElement('span'); dot.className = 'note-dot c-' + rec.color; link.appendChild(dot);
      var body = document.createElement('span'); body.className = 'note-body';
      var q = document.createElement('span'); q.className = 'note-q'; q.textContent = rec.quote || snippet(rec.seg);
      body.appendChild(q);
      if (rec.text) { var tx = document.createElement('span'); tx.className = 'note-tx'; tx.textContent = rec.text; body.appendChild(tx); }
      if (noteOrphan[rec.id]) { var o = document.createElement('span'); o.className = 'note-orphan'; o.textContent = '위치 확인 필요'; body.appendChild(o); }
      link.appendChild(body); li.appendChild(link); ul.appendChild(li);
    });
  }
  (function () {
    var ul = $('note-list'); if (!ul) return;
    ul.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[data-note]'); if (!a) return;
      var rec = noteGet()[a.dataset.note]; if (!rec) return;
      var seg = document.getElementById(rec.seg);
      closePanels();
      if (seg) jumpTo(seg);                                     // 위치로 이동만 — 편집은 본문 하이라이트 탭으로
    });
  })();

  noteCount(); paintNotes();

  // ── 크로스-디바이스 동기화(Supabase) ─────────────────────────────
  //  동기화 대상: 읽은 위치 / 북마크 / 읽기 표시 설정(원문·원어 병기·용어 해설).
  //  단말기별(미동기화): 글자 크기·줄 간격·밝기.
  //  로컬 정본은 bs_sync(JSON). 필드별 LWW, 북마크는 키별 LWW+tombstone.
  //  위치 충돌: 원격이 더 최신이면 자동 이동하지 않고 '이어 읽기' 배너만.
  var SB = null, sbUser = null, pushTimer = null;
  var sbToken = null, sbExp = 0, flushedTs = 0;   // 백그라운드 flush 용: 동기 접근 가능한 토큰 + 중복 발행 방지
  var deviceId = localStorage.getItem('bs_device');
  if (!deviceId) { deviceId = 'd' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('bs_device', deviceId); }

  function syncLocalGet() { try { return JSON.parse(localStorage.getItem('bs_sync') || '{}'); } catch (e) { return {}; } }
  function syncLocalSet(o) { localStorage.setItem('bs_sync', JSON.stringify(o)); }
  function tsOf(x) { return (x && x.ts) || 0; }

  // 로컬 변경 기록(+push 예약) — 로그인 여부와 무관하게 로컬 정본은 항상 최신 유지
  function notePosition(id) {
    var l = syncLocalGet();
    l.position = { seg_id: id, chap: (typeof curChap === 'number' ? curChap : 0),
                   pct: Math.min(100, Math.round(num(id) / TOTAL * 100)), ts: Date.now(), device: deviceId };
    syncLocalSet(l); syncSchedule();
  }
  function notePrefs() {
    var l = syncLocalGet();
    l.prefs = { orig: showOrig, anno: showAnno, gloss: glossMode, ts: Date.now() };
    syncLocalSet(l); syncSchedule();
  }
  function noteBookmark(id, added) {
    var l = syncLocalGet(); if (!l.bookmarks) l.bookmarks = {};
    l.bookmarks[id] = { t: Date.now(), d: !added };
    syncLocalSet(l); syncSchedule();
  }

  function mergeStates(remote, local) {
    var position = tsOf(remote.position) > tsOf(local.position) ? remote.position : local.position;
    var prefs = tsOf(remote.prefs) > tsOf(local.prefs) ? remote.prefs : local.prefs;
    var rb = remote.bookmarks || {}, lb = local.bookmarks || {}, bookmarks = {};
    Object.keys(rb).concat(Object.keys(lb)).forEach(function (k) {
      var r = rb[k], l = lb[k];
      var win = (!l || ((r && r.t) || 0) > ((l && l.t) || 0)) ? r : l;
      if (win) bookmarks[k] = win;
    });
    // 메모: 키별 ts-LWW + tombstone 보존(북마크와 동일 — 한쪽에만 있는 메모도 union 으로 살아남음)
    var rn = remote.notes || {}, ln = local.notes || {}, notes = {};
    Object.keys(rn).concat(Object.keys(ln)).forEach(function (k) {
      var r = rn[k], l = ln[k];
      var win = (!l || ((r && r.ts) || 0) > ((l && l.ts) || 0)) ? r : l;
      if (win) notes[k] = win;
    });
    return { position: position || null, prefs: prefs || null, bookmarks: bookmarks, notes: notes };
  }

  var pendingPos = null;
  function applyMerged(merged, remote, firstSync) {
    var local = syncLocalGet();
    // 표시 설정: pull 시 자동 적용(화면이 튀지 않음)
    if (merged.prefs) {
      var p = merged.prefs;
      showOrig = !!p.orig; showAnno = !!p.anno;
      if (GLOSS_MODES.indexOf(p.gloss) !== -1) glossMode = p.gloss;
      localStorage.setItem('bs_orig', showOrig ? '1' : '0');
      localStorage.setItem('bs_anno', showAnno ? '1' : '0');
      localStorage.setItem('bs_gloss', glossMode);
      applyOrig(); applyAnno(); applyGloss();
      local.prefs = p;
    }
    // 북마크: 병합 결과를 UI 배열(bs_bm)로 반영
    local.bookmarks = merged.bookmarks;
    bmSet(Object.keys(merged.bookmarks).filter(function (k) { return !merged.bookmarks[k].d; }));
    if ($('bm-panel').classList.contains('show')) renderBM();
    // 메모: 병합 결과 반영 → 재칠 + 카운트(+패널 열려있으면 목록 갱신)
    local.notes = merged.notes || {};
    // 위치
    var lp = local.position, rp = remote.position, cur = localStorage.getItem('bs_pos');
    if (rp && rp.seg_id) {
      if (firstSync) { adoptPosition(rp); local.position = rp; }        // 이 기기 첫 동기화 → 서버 위치 받아옴
      else if (tsOf(rp) > tsOf(lp)) {
        if (!lp || !cur) { adoptPosition(rp); local.position = rp; }    // 로컬 위치 없으면 자동 이동
        else if (rp.seg_id !== cur) showBanner(rp);                     // 있으면 배너만(화면 유지)
      }
    }
    syncLocalSet(local);
    noteCount(); paintNotes(); if ($('note-panel').classList.contains('show')) renderNotes();
  }

  function adoptPosition(rp) {
    beginProg(rp.seg_id, false);            // 원격 위치 채택 — 기록 억제(el 이 null 이어도 게이트 필요)
    var el = document.getElementById(rp.seg_id);
    if (el) {
      var chap = el.closest('.chapter');
      if (chap && chapters.length) showChapter(chapters.indexOf(chap));
      scrollToSeg(el, 'start');
    }
    localStorage.setItem('bs_pos', rp.seg_id);
    if (rp.chap != null) localStorage.setItem('bs_chap', rp.chap);
  }

  function syncSchedule() { if (!SB || !sbUser) return; clearTimeout(pushTimer); pushTimer = setTimeout(function () { syncNow(); }, 3000); }

  // ── 백그라운드 전환(잠금·앱 전환) 시 '위치만' 즉시 push ──────────────
  //  syncNow 는 SELECT→UPSERT 체인이라 페이지가 얼면 UPSERT 가 발행되지 않는다.
  //  keepalive fetch 는 문서가 파기돼도 브라우저가 요청을 끝까지 보낸다(sendBeacon 은
  //  Authorization 헤더를 못 실어 불가). RPC 는 position 컬럼만, ts 가 더 클 때만 쓴다
  //  → 북마크·메모 손실 불가, 위치 역행 불가. 드롭돼도 다음 로드의 syncNow 가 복구.
  function flushPosition() {
    if (!window.__SB__ || !sbUser || !sbToken) return;             // 미설정·로그아웃 → no-op
    if (localStorage.getItem('bs_synced') !== sbUser.id) return;   // 이 계정 첫 동기화 전엔 push 금지(계정 전환 오염 방지)
    if (sbExp && sbExp * 1000 <= Date.now() + 5000) return;        // 만료(임박) 토큰 → 다음 로드의 syncNow 에 위임
    var p = syncLocalGet().position;
    if (!p || !p.seg_id || !p.ts || p.ts <= flushedTs) return;     // 위치 없음·미변경 → 중복 발행 방지
    flushedTs = p.ts;
    try {
      fetch(window.__SB__.url + '/rest/v1/rpc/push_position', {
        method: 'POST', keepalive: true, mode: 'cors', cache: 'no-store',
        headers: { apikey: window.__SB__.anonKey, Authorization: 'Bearer ' + sbToken,
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ p: p })
      }).then(function (r) { if (!r.ok) flushedTs = 0; }, function () { flushedTs = 0; });
    } catch (e) { flushedTs = 0; }   // 페이지가 살아있을 때만 롤백 — 얼면 안 돌아도 무방(다음 로드가 백스톱)
  }

  //  Supabase JS 는 DB 오류를 reject 가 아니라 res.error 로 돌려준다 → 반드시 res.error 를 검사.
  //  수동('지금 동기화')일 때만 토스트로 노출하고, 배경 동기화는 콘솔에만 남긴다.
  function reportSyncErr(where, err, manual) {
    if (!err) return false;
    console.warn('[sync] ' + where + ' 실패:', err.message || err.code || err, err);
    if (manual) toast('동기화 오류(' + where + '): ' + (err.message || err.code || '알 수 없음'));
    return true;
  }
  function syncNow(manual) {
    if (!SB || !sbUser) return;
    clearTimeout(pushTimer);
    var local = syncLocalGet();
    var firstSync = localStorage.getItem('bs_synced') !== sbUser.id;   // 이 기기에서 이 계정 첫 동기화?
    SB.from('user_state').select('position,bookmarks,prefs,notes').eq('user_id', sbUser.id).maybeSingle()
      .then(function (res) {
        if (res && res.error) { reportSyncErr('불러오기', res.error, manual); return; }
        var remote = (res && res.data) || {};
        var merged = mergeStates(remote, local);
        if (firstSync && remote.position) merged.position = remote.position;  // 첫 동기화: 서버 위치 우선(로컬 임시 스크롤이 서버를 덮어쓰지 않게)
        applyMerged(merged, remote, firstSync);
        localStorage.setItem('bs_synced', sbUser.id);
        var remoteNorm = { position: remote.position || null, prefs: remote.prefs || null, bookmarks: remote.bookmarks || {}, notes: remote.notes || {} };
        if (JSON.stringify(merged) !== JSON.stringify(remoteNorm)) {
          SB.from('user_state').upsert({
            user_id: sbUser.id, position: merged.position, bookmarks: merged.bookmarks,
            prefs: merged.prefs, notes: merged.notes, updated_at: new Date().toISOString()
          }).then(function (r2) {
            if (r2 && r2.error) { reportSyncErr('저장', r2.error, manual); return; }
            if (manual) toast('동기화 완료');
          }, function (e2) { reportSyncErr('저장', e2, manual); });
        } else if (manual) { toast('동기화 완료'); }
      }, function (err) { reportSyncErr('불러오기', err, manual); });
  }

  // 배너
  function showBanner(rp) {
    pendingPos = rp; var el = $('sync-banner'); if (!el) return;
    var pct = $('sync-banner-pct'); if (pct) pct.textContent = (rp.pct != null ? rp.pct : '?') + '%';
    el.classList.add('show');
  }
  function hideBanner() { var el = $('sync-banner'); if (el) el.classList.remove('show'); pendingPos = null; }
  function acceptBanner() {
    if (pendingPos) { adoptPosition(pendingPos); var l = syncLocalGet(); l.position = pendingPos; syncLocalSet(l); }
    hideBanner();
  }
  (function () {
    var go = $('sync-go'), x = $('sync-x');
    if (go) go.onclick = acceptBanner;
    if (x) x.onclick = hideBanner;
  })();

  // 로그인/패널 UI
  function updateSyncUI() {
    var v = $('sync-val'), c = $('sync-content');
    var configured = !!(window.__SB__ && window.supabase);
    if (v) v.textContent = !configured ? '미설정' : (sbUser ? '켜짐' : '로그인');
    if (!c) return;
    if (!configured) {
      c.innerHTML = '<p class="sync-note">동기화가 아직 설정되지 않았습니다.</p>';
    } else if (!sbUser) {
      c.innerHTML =
        '<p class="sync-note">Google 계정으로 로그인하면 읽던 위치·북마크·읽기 표시 설정이 기기 간에 동기화됩니다. ' +
        '글자 크기·줄 간격·밝기는 기기별로 유지됩니다.</p>' +
        '<button class="sync-btn" data-sync="login">Google로 로그인</button>';
    } else {
      c.innerHTML =
        '<p id="sync-email">' + (sbUser.email || '로그인됨') + '</p>' +
        '<button class="sync-btn" data-sync="now">지금 동기화</button>' +
        '<button class="sync-btn" data-sync="logout">로그아웃</button>' +
        '<button class="sync-btn danger" data-sync="del">내 데이터 삭제</button>' +
        '<p class="sync-note">저장 항목: 읽은 위치·북마크·읽기 표시 설정과 계정 식별자. ' +
        '본인만 접근할 수 있으며, ‘내 데이터 삭제’로 원격 기록을 지울 수 있습니다.</p>';
    }
  }
  (function () {
    var panel = $('sync-panel'); if (!panel) return;
    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-sync]'); if (!btn) return;
      var a = btn.dataset.sync;
      if (a === 'login') { if (SB) SB.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0] } }); }
      else if (a === 'logout') { if (SB) SB.auth.signOut(); }
      else if (a === 'now') { toast('동기화 중…'); syncNow(true); }
      else if (a === 'del') {
        if (SB && sbUser && confirm('원격에 저장된 내 읽기 데이터를 삭제할까요?')) {
          SB.from('user_state').delete().eq('user_id', sbUser.id).then(function () { toast('원격 데이터 삭제됨'); }, function () { });
        }
      }
    });
  })();

  function onAuth(session) {
    sbUser = session ? session.user : null;
    sbToken = session ? (session.access_token || null) : null;   // 동기 flush 용 — getSession 은 pagehide 에서 못 씀
    sbExp = session ? (session.expires_at || 0) : 0;             // onAuthStateChange 가 TOKEN_REFRESHED 로 갱신
    if (!sbUser) flushedTs = 0;
    updateSyncUI();
    if (sbUser) syncNow();   // 로그인/세션 복원 직후 pull+merge
  }
  function initSync() {
    if (!window.__SB__ || !window.supabase) { updateSyncUI(); return; }
    SB = window.supabase.createClient(window.__SB__.url, window.__SB__.anonKey);
    SB.auth.getSession().then(function (r) { onAuth(r.data.session); });
    SB.auth.onAuthStateChange(function (_e, session) { onAuth(session); });
    // 숨김(잠금·앱 전환) 때: 먼저 keepalive 로 위치만 즉시 flush(얼기 전에 발행) → 이어서 syncNow.
    //  복귀(visible)·focus 때: syncNow 가 pull+merge. syncNow 는 오늘과 동일하게 양방향 무조건 호출.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushPosition();
      syncNow();
    });
    window.addEventListener('pagehide', flushPosition);            // bfcache/언로드 — iOS 에서 신뢰 가능한 종료 신호
    window.addEventListener('focus', function () { syncNow(); });   // 이벤트 객체가 manual 로 새지 않게 래핑
  }
  initSync();
})();
