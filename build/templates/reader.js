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
    else if (act === 'orig') { showOrig = !showOrig; localStorage.setItem('bs_orig', showOrig ? '1' : '0'); applyOrig(); }
    else if (act === 'anno') { showAnno = !showAnno; localStorage.setItem('bs_anno', showAnno ? '1' : '0'); applyAnno(); }
    else if (act === 'gloss') {
      glossMode = GLOSS_MODES[(GLOSS_MODES.indexOf(glossMode) + 1) % GLOSS_MODES.length];
      localStorage.setItem('bs_gloss', glossMode);
      applyGloss();
      if (glossMode !== 'scroll') clearReveal();   // 스크롤 잔여 밑줄 정리
      if (glossMode === 'off') closeGnote();
    }
    else if (act === 'toc') { closeMenu(); openPanel('toc-panel'); }
    else if (act === 'glossary') { closeMenu(); renderGloss(); openPanel('gl-panel'); }
    else if (act === 'bm') { closeMenu(); renderBM(); openPanel('bm-panel'); }
    else if (act === 'about') { closeMenu(); openPanel('about-panel'); }
  });

  // ── 현재 위치 + URL 동기화 ───────────────────────────────────
  var header = document.querySelector('header'), posEl = $('pos');
  function num(id) { return parseInt((id || '').replace(/\D/g, ''), 10) || 0; }
  var visible = new Set(), posPending = false, lastPosId = null;
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
    // 전체 진행률(%)만 표시 — 하단 페이저의 "N / 24"(챕터)와 단위가 겹쳐 헷갈리지 않도록.
    posEl.textContent = Math.min(100, Math.round(num(best.id) / TOTAL * 100)) + '%';
  }
  window.addEventListener('scroll', schedulePos, { passive: true });

  // ── 북마크 저장소 ──────────────────────────────────────────
  function bmGet() { try { return JSON.parse(localStorage.getItem('bs_bm') || '[]'); } catch (e) { return []; } }
  function bmSet(a) { localStorage.setItem('bs_bm', JSON.stringify(a)); var c = $('bm-count'); if (c) c.textContent = a.length; }
  function bmHas(id) { return bmGet().indexOf(id) !== -1; }
  function bmToggle(id) { var a = bmGet(), i = a.indexOf(id); if (i === -1) a.push(id); else a.splice(i, 1); bmSet(a); return i === -1; }
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
    if (pgPrev) pgPrev.disabled = idx === 0;
    if (pgNext) pgNext.disabled = idx === chapters.length - 1;
    if (pgMid) pgMid.textContent = (idx + 1) + ' / ' + chapters.length;
    lastPosId = null; schedulePos();
    return ch;
  }

  function gotoChapter(idx) {            // 이전/다음/화살표: 맨 위로 + URL 을 #chap-N 으로
    var prev = curChap;
    showChapter(idx);
    if (curChap !== prev) {
      window.scrollTo(0, 0);
      history.replaceState(null, '', location.pathname + location.search + '#' + chapters[curChap].id);
    }
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

  // ── 해시(#id) 이동: 대상이 속한 챕터를 먼저 펼친 뒤 스크롤 + 플래시 ──
  var flashTimer;
  function goHash() {
    var h = location.hash.slice(1);
    if (!h) return;
    var el = document.getElementById(h);
    if (!el) return;
    var chap = el.classList.contains('chapter') ? el : el.closest('.chapter');
    if (chap) showChapter(chapters.indexOf(chap));
    if (el.classList.contains('chapter')) { window.scrollTo(0, 0); return; }
    el.scrollIntoView({ block: 'center' });
    // content-visibility:auto 로 위쪽 문단 높이가 추정치였다가 렌더되며 보정되므로 한 프레임 뒤 재정렬
    requestAnimationFrame(function () { el.scrollIntoView({ block: 'center' }); });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  // ── 초기 표시 ────────────────────────────────────────────────
  if (chapters.length) {
    document.body.classList.add('paged');               // 페이징 활성(없으면 전체가 한 페이지로 보임)
    if (location.hash && document.getElementById(location.hash.slice(1))) {
      goHash();
    } else {
      var saved = parseInt(localStorage.getItem('bs_chap'), 10);
      showChapter((isNaN(saved) || saved < 0) ? 0 : saved);
      window.scrollTo(0, 0);
    }
  } else {                                                // 폴백: 챕터 없음 → 전체 관찰 + 해시 이동만
    document.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });
    if (location.hash) setTimeout(goHash, 300);
  }
  window.addEventListener('hashchange', goHash);
})();
