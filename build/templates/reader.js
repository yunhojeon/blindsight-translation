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
    else if (act === 'toc') { closeMenu(); openPanel('toc-panel'); }
    else if (act === 'glossary') { closeMenu(); renderGloss(); openPanel('gl-panel'); }
    else if (act === 'bm') { closeMenu(); renderBM(); openPanel('bm-panel'); }
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
    if (best.id) { localStorage.setItem('bs_pos', best.id); if (userMoved) notePosition(best.id); }   // 로컬 저장 항상 / 동기화는 사용자 스크롤 후
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

  // content-visibility:auto 는 화면 밖 문단 높이를 추정치로 두므로, 깊은 위치로 한 번에
  // 스크롤하면 어긋난다. 여러 프레임에 걸쳐 재정렬해 콘텐츠가 렌더되며 위치를 수렴시킨다.
  function scrollToSeg(el, align) {
    var tries = 0;
    (function step() {
      el.scrollIntoView({ block: align });
      if (++tries < 8) requestAnimationFrame(step);
    })();
  }

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
    scrollToSeg(el, 'center');
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }

  // ── 초기 표시 ────────────────────────────────────────────────
  function restoreReading() {                            // 마지막으로 읽던 문단으로 복원
    var posId = localStorage.getItem('bs_pos');
    var el = posId && document.getElementById(posId);
    if (el) {
      var chap = el.closest('.chapter');
      if (chap) showChapter(chapters.indexOf(chap));
      scrollToSeg(el, 'start');
      return true;
    }
    var saved = parseInt(localStorage.getItem('bs_chap'), 10);   // 위치 기록 없으면 챕터만
    showChapter((isNaN(saved) || saved < 0) ? 0 : saved);
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

  // ── 크로스-디바이스 동기화(Supabase) ─────────────────────────────
  //  동기화 대상: 읽은 위치 / 북마크 / 읽기 표시 설정(원문·원어 병기·용어 해설).
  //  단말기별(미동기화): 글자 크기·줄 간격·밝기.
  //  로컬 정본은 bs_sync(JSON). 필드별 LWW, 북마크는 키별 LWW+tombstone.
  //  위치 충돌: 원격이 더 최신이면 자동 이동하지 않고 '이어 읽기' 배너만.
  var SB = null, sbUser = null, pushTimer = null;
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
    return { position: position || null, prefs: prefs || null, bookmarks: bookmarks };
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
  }

  function adoptPosition(rp) {
    var el = document.getElementById(rp.seg_id);
    if (el) {
      var chap = el.closest('.chapter');
      if (chap && chapters.length) showChapter(chapters.indexOf(chap));
      scrollToSeg(el, 'start');
    }
    localStorage.setItem('bs_pos', rp.seg_id);
    if (rp.chap != null) localStorage.setItem('bs_chap', rp.chap);
  }

  function syncSchedule() { if (!SB || !sbUser) return; clearTimeout(pushTimer); pushTimer = setTimeout(syncNow, 3000); }

  function syncNow() {
    if (!SB || !sbUser) return;
    clearTimeout(pushTimer);
    var local = syncLocalGet();
    var firstSync = localStorage.getItem('bs_synced') !== sbUser.id;   // 이 기기에서 이 계정 첫 동기화?
    SB.from('user_state').select('position,bookmarks,prefs').eq('user_id', sbUser.id).maybeSingle()
      .then(function (res) {
        var remote = (res && res.data) || {};
        var merged = mergeStates(remote, local);
        if (firstSync && remote.position) merged.position = remote.position;  // 첫 동기화: 서버 위치 우선(로컬 임시 스크롤이 서버를 덮어쓰지 않게)
        applyMerged(merged, remote, firstSync);
        localStorage.setItem('bs_synced', sbUser.id);
        var remoteNorm = { position: remote.position || null, prefs: remote.prefs || null, bookmarks: remote.bookmarks || {} };
        if (JSON.stringify(merged) !== JSON.stringify(remoteNorm)) {
          SB.from('user_state').upsert({
            user_id: sbUser.id, position: merged.position, bookmarks: merged.bookmarks,
            prefs: merged.prefs, updated_at: new Date().toISOString()
          }).then(function () { }, function () { });
        }
      }, function () { /* 네트워크 실패 무시 */ });
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
      else if (a === 'now') { syncNow(); toast('동기화 중…'); }
      else if (a === 'del') {
        if (SB && sbUser && confirm('원격에 저장된 내 읽기 데이터를 삭제할까요?')) {
          SB.from('user_state').delete().eq('user_id', sbUser.id).then(function () { toast('원격 데이터 삭제됨'); }, function () { });
        }
      }
    });
  })();

  function onAuth(session) {
    sbUser = session ? session.user : null;
    updateSyncUI();
    if (sbUser) syncNow();   // 로그인/세션 복원 직후 pull+merge
  }
  function initSync() {
    if (!window.__SB__ || !window.supabase) { updateSyncUI(); return; }
    SB = window.supabase.createClient(window.__SB__.url, window.__SB__.anonKey);
    SB.auth.getSession().then(function (r) { onAuth(r.data.session); });
    SB.auth.onAuthStateChange(function (_e, session) { onAuth(session); });
    // 숨김(다른 기기로 전환) 때 flush-push, 복귀 때 pull — 둘 다 syncNow 가 read-merge-write 로 처리.
    document.addEventListener('visibilitychange', function () { syncNow(); });
    window.addEventListener('focus', syncNow);
  }
  initSync();
})();
