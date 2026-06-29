// ============================================================================
// reader.js — 블라인드사이트 리더 동작
//   · 전역 토글: 원문 전체 / 원어 병기 (on = 기능 켜짐)
//   · 헤더 현재 위치(첫 완전노출 문단 번호 / 전체)
//   · 문단 핸들(⋮) → 아이콘 메뉴: 원문 보기 · 링크 복사 · 북마크(☆/★)
//   · 목차 패널(파트·장면) / 북마크 패널 (공용 백드롭)
// 편집 후 `python3 build/build_reader.py` 로 재빌드(이 스크립트가 인라인됨).
// ============================================================================
(function () {
  var b = document.body;
  var $ = function (id) { return document.getElementById(id); };
  var TOTAL = parseInt(b.dataset.total, 10) || document.querySelectorAll('.seg').length;

  // ── 전역 토글(원문 / 원어 병기) ───────────────────────────────
  var showOrig = localStorage.getItem('bs_orig') === '1';
  var showAnno = localStorage.getItem('bs_anno') !== '0';   // 기본 켜짐
  function applyOrig() { $('t-orig').classList.toggle('on', showOrig); b.classList.toggle('show-orig', showOrig); }
  function applyAnno() { $('t-anno').classList.toggle('on', showAnno); b.classList.toggle('hide-anno', !showAnno); }
  applyOrig(); applyAnno();
  $('t-orig').onclick = function () { showOrig = !showOrig; localStorage.setItem('bs_orig', showOrig ? '1' : '0'); applyOrig(); };
  $('t-anno').onclick = function () { showAnno = !showAnno; localStorage.setItem('bs_anno', showAnno ? '1' : '0'); applyAnno(); };

  // ── 토스트 ─────────────────────────────────────────────────
  var toastEl = $('toast'), toastTimer;
  function toast(msg) {
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
  }

  // ── 현재 위치(첫 완전노출 문단) ───────────────────────────────
  var header = document.querySelector('header'), posEl = $('pos');
  function num(id) { return parseInt((id || '').replace(/\D/g, ''), 10) || 0; }
  var visible = new Set();
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); });
    schedulePos();
  }, { threshold: 0 });
  document.querySelectorAll('.seg').forEach(function (s) { io.observe(s); });
  var posPending = false, lastPosId = null, urlTimer;
  function schedulePos() { if (!posPending) { posPending = true; requestAnimationFrame(function () { posPending = false; updatePos(); }); } }
  function updatePos() {
    if (!visible.size) return;
    var hb = header.getBoundingClientRect().bottom, best = null, bestTop = Infinity;
    visible.forEach(function (s) {
      var t = s.getBoundingClientRect().top;
      if (t >= hb - 2 && t < bestTop) { bestTop = t; best = s; }   // 헤더 아래 첫 문단
    });
    if (!best) visible.forEach(function (s) {                       // 전부 헤더에 걸침 → 가장 위
      var t = s.getBoundingClientRect().top; if (t < bestTop) { bestTop = t; best = s; }
    });
    if (!best || best.id === lastPosId) return;
    lastPosId = best.id;
    posEl.textContent = num(best.id) + ' / ' + TOTAL;       // 숫자는 즉시
    clearTimeout(urlTimer);                                  // URL 은 디바운스(replaceState — 히스토리 미오염)
    urlTimer = setTimeout(function () {
      try { history.replaceState(history.state, '', '#' + lastPosId); } catch (e) {}
    }, 220);
  }
  window.addEventListener('scroll', schedulePos, { passive: true });

  // ── 북마크 저장소 ──────────────────────────────────────────
  function bmGet() { try { return JSON.parse(localStorage.getItem('bs_bm') || '[]'); } catch (e) { return []; } }
  function bmSet(a) { localStorage.setItem('bs_bm', JSON.stringify(a)); $('bm-count').textContent = a.length; }
  function bmHas(id) { return bmGet().indexOf(id) !== -1; }
  function bmToggle(id) { var a = bmGet(), i = a.indexOf(id); if (i === -1) a.push(id); else a.splice(i, 1); bmSet(a); return i === -1; }
  $('bm-count').textContent = bmGet().length;

  // ── 문단 액션 메뉴 ─────────────────────────────────────────
  var pmenu = $('pmenu'), curSeg = null;
  function closeMenu() { if (curSeg) curSeg.classList.remove('menu-open'); pmenu.classList.remove('show'); curSeg = null; }
  function openMenu(seg, handle) {
    if (curSeg === seg) { closeMenu(); return; }
    closeMenu(); curSeg = seg; seg.classList.add('menu-open');
    seg.appendChild(pmenu);                              // seg(position:relative) 기준 절대배치
    pmenu.style.top = (handle.offsetTop) + 'px';         // 핸들(⋮) 위치에 겹쳐 띄움
    pmenu.style.left = (handle.offsetLeft) + 'px';
    pmenu.classList.add('show');
    var o = seg.querySelector('.orig');
    pmenu.querySelector('[data-act="orig"]').classList.toggle('on', !!(o && o.classList.contains('open')));
    pmenu.querySelector('[data-act="bm"]').classList.toggle('on', bmHas(seg.id));  // 아이콘은 🔖 고정, 상태는 .on
  }
  document.addEventListener('click', function (e) {
    var h = e.target.closest && e.target.closest('.seg-handle');
    if (h) { e.preventDefault(); openMenu(h.parentNode, h); return; }
    if (curSeg && !e.target.closest('#pmenu') && !e.target.closest('.seg-handle')) closeMenu();
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
      var added = bmToggle(id);
      btn.classList.toggle('on', added);                 // 아이콘 🔖 유지, 상태는 .on 강조
      toast(added ? '북마크 추가' : '북마크 해제');
    }
  });

  // ── 패널(목차 · 북마크) 공용 ───────────────────────────────
  var backdrop = $('backdrop');
  function closePanels() {
    $('bm-panel').classList.remove('show'); $('toc-panel').classList.remove('show');
    backdrop.classList.remove('show');
  }
  function openPanel(pid) { closePanels(); $(pid).classList.add('show'); backdrop.classList.add('show'); }
  backdrop.onclick = closePanels;
  document.querySelectorAll('[data-close]').forEach(function (x) { x.onclick = closePanels; });
  // 패널 내부 링크 클릭 시 닫기
  document.querySelectorAll('.panel .navlist').forEach(function (ul) {
    ul.addEventListener('click', function (e) { if (e.target.closest('a')) closePanels(); });
  });

  // 북마크 패널
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
  $('t-bm').onclick = function () { renderBM(); openPanel('bm-panel'); };
  $('t-toc').onclick = function () { openPanel('toc-panel'); };

  // 해시(#id)로 이동 시 스크롤 + 잠깐 플래시(하이라이트가 남지 않도록)
  var flashTimer;
  function goHash(scroll) {
    if (!location.hash) return;
    var el = document.getElementById(location.hash.slice(1));
    if (!el) return;
    if (scroll) el.scrollIntoView({ block: 'center' });
    el.classList.remove('flash');
    void el.offsetWidth;                 // 리플로우 강제 → 재진입 시에도 애니메이션 재생
    el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.classList.remove('flash'); }, 1500);
  }
  if (location.hash) setTimeout(function () { goHash(true); }, 300);  // 폰트 로드 후 보정
  window.addEventListener('hashchange', function () { goHash(true); });
})();
