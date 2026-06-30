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
  document.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });

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
    posEl.textContent = num(best.id) + ' / ' + TOTAL;
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
    seg.appendChild(pmenu);
    pmenu.style.top = handle.offsetTop + 'px';
    pmenu.style.left = handle.offsetLeft + 'px';
    pmenu.classList.add('show');
    var o = seg.querySelector('.orig');
    pmenu.querySelector('[data-act="orig"]').classList.toggle('on', !!(o && o.classList.contains('open')));
    pmenu.querySelector('[data-act="bm"]').classList.toggle('on', bmHas(seg.id));
  }
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('.seg-handle');
    if (h) { e.preventDefault(); openPMenu(h.parentNode, h); return; }
    if (curSeg && !e.target.closest('#pmenu') && !e.target.closest('.seg-handle')) closePMenu();
  });
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
    var g = GL[span.dataset.g], seg = span.closest('.seg');
    if (!g || !seg) return;
    gnote.querySelector('.gn-en').textContent = g.en;
    gnote.querySelector('.gn-tag').textContent = TY_LBL[g.ty] ? ', ' + TY_LBL[g.ty] : '';
    gnote.querySelector('.gn-note').textContent = g.note || '';
    seg.appendChild(gnote); gnote.classList.add('show'); gOpen = span;
    var left = Math.max(0, Math.min(span.offsetLeft, seg.clientWidth - gnote.offsetWidth));
    gnote.style.left = left + 'px';
    var r = span.getBoundingClientRect(), above = r.bottom + gnote.offsetHeight + 8 > window.innerHeight;
    gnote.style.top = (above ? span.offsetTop - gnote.offsetHeight - 4 : span.offsetTop + span.offsetHeight + 4) + 'px';
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

  // ── 해시(#id) 이동 시 스크롤 + 잠깐 플래시 ──────────────────
  var flashTimer;
  function goHash() {
    if (!location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }
  if (location.hash) setTimeout(goHash, 300);
  window.addEventListener('hashchange', goHash);
})();
