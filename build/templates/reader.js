// ============================================================================
// reader.js — 블라인드사이트 리더 동작(원문/병기 토글, 문단별 원문 펼침)
// 이 파일을 직접 편집한 뒤  `python3 build/build_reader.py`  로 다시 빌드한다.
// (빌드가 이 스크립트를 dist/preview.html 안에 인라인으로 합쳐 넣는다.)
// ============================================================================
(function () {
  var b = document.body;

  // 토글 한 개: 버튼 on 표시 + body 클래스 토글
  function setT(id, cls, on) {
    var el = document.getElementById(id);
    el.classList.toggle('on', on);
    b.classList.toggle(cls, on);
  }

  // localStorage 로 마지막 상태 기억
  var showOrig = localStorage.getItem('bs_orig') === '1';
  var showAnno = localStorage.getItem('bs_anno') !== '0';   // 기본 켜짐

  setT('t-orig', 'show-orig', showOrig);
  setT('t-anno', 'hide-anno', !showAnno);

  document.getElementById('t-orig').onclick = function () {
    showOrig = !showOrig;
    localStorage.setItem('bs_orig', showOrig ? '1' : '0');
    setT('t-orig', 'show-orig', showOrig);
  };
  document.getElementById('t-anno').onclick = function () {
    showAnno = !showAnno;
    localStorage.setItem('bs_anno', showAnno ? '1' : '0');
    setT('t-anno', 'hide-anno', !showAnno);
  };

  // 문단별 원문 펼침(› 버튼)
  document.querySelectorAll('.orig-toggle').forEach(function (btn) {
    btn.onclick = function () {
      var o = btn.nextElementSibling;
      o.hidden = !o.hidden;
    };
  });
})();
