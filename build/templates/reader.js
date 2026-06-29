// ============================================================================
// reader.js — 블라인드사이트 리더 동작
//   · 헤더 현재 위치(첫 완전노출 문단 / 전체) + URL 동기화(replaceState)
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

  // ── 원문 / 원어 병기 토글(상태) ──────────────────────────────
  var showOrig = localStorage.getItem('bs_orig') === '1';
  var showAnno = localStorage.getItem('bs_anno') !== '0';
  function miEl(act) { return document.querySelector('#menu .mi[data-act="' + act + '"]'); }
  function applyOrig() { b.classList.toggle('show-orig', showOrig); var e = miEl('orig'); if (e) e.classList.toggle('on', showOrig); }
  function applyAnno() { b.classList.toggle('hide-anno', !showAnno); var e = miEl('anno'); if (e) e.classList.toggle('on', showAnno); }
  applyOrig(); applyAnno();

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
    else if (act === 'toc') { closeMenu(); openPanel('toc-panel'); }
    else if (act === 'bm') { closeMenu(); renderBM(); openPanel('bm-panel'); }
    else if (act === 'about') { closeMenu(); openPanel('about-panel'); }
  });

  // ── 현재 위치 + URL 동기화 ───────────────────────────────────
  var header = document.querySelector('header'), posEl = $('pos');
  function num(id) { return parseInt((id || '').replace(/\D/g, ''), 10) || 0; }
  var visible = new Set(), posPending = false, lastPosId = null, urlTimer;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
    schedulePos();
  }, { threshold: 0 });
  document.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });
  function schedulePos() { if (!posPending) { posPending = true; requestAnimationFrame(function () { posPending = false; updatePos(); }); } }
  function updatePos() {
    if (!visible.size) return;
    var hb = header.getBoundingClientRect().bottom, best = null, bestTop = Infinity;
    visible.forEach(function (s) { var t = s.getBoundingClientRect().top; if (t >= hb - 2 && t < bestTop) { bestTop = t; best = s; } });
    if (!best) visible.forEach(function (s) { var t = s.getBoundingClientRect().top; if (t < bestTop) { bestTop = t; best = s; } });
    if (!best || best.id === lastPosId) return;
    lastPosId = best.id;
    posEl.textContent = num(best.id) + ' / ' + TOTAL;
    clearTimeout(urlTimer);
    urlTimer = setTimeout(function () { try { history.replaceState(history.state, '', '#' + lastPosId); } catch (e) {} }, 220);
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
