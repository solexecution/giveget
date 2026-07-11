(function () {
  var OPEN_PX = 72;
  var ARCHIVE_PX = 120;

  function init(wrap) {
    var panel = wrap.querySelector(".listing-swipe__panel");
    var form = wrap.querySelector(".listing-swipe__archive-form");
    if (!panel) return;

    var startX = 0;
    var startY = 0;
    var dragging = false;
    var axis = null;

    function setOffset(px) {
      panel.style.transform = "translateX(" + -Math.min(px, ARCHIVE_PX) + "px)";
    }

    function resetOffset() {
      panel.style.transform = "";
      wrap.classList.remove("is-open");
    }

    function submitArchive() {
      if (!form) return;
      wrap.classList.add("is-archiving");
      window.setTimeout(function () {
        form.requestSubmit();
      }, 220);
    }

    panel.addEventListener(
      "touchstart",
      function (e) {
        if (e.touches.length !== 1) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        dragging = true;
        axis = null;
        panel.style.transition = "none";
      },
      { passive: true }
    );

    panel.addEventListener(
      "touchmove",
      function (e) {
        if (!dragging || e.touches.length !== 1) return;
        var dx = e.touches[0].clientX - startX;
        var dy = e.touches[0].clientY - startY;
        if (axis === null) {
          if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
          axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (axis !== "x") return;
        if (dx > 0) dx = 0;
        e.preventDefault();
        setOffset(-dx);
        if (-dx >= OPEN_PX) wrap.classList.add("is-open");
        else wrap.classList.remove("is-open");
      },
      { passive: false }
    );

    panel.addEventListener(
      "touchend",
      function () {
        if (!dragging) return;
        dragging = false;
        panel.style.transition = "";
        var match = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(panel.style.transform || "");
        var offset = match ? Math.abs(parseFloat(match[1])) : 0;
        if (offset >= ARCHIVE_PX) {
          submitArchive();
          return;
        }
        if (offset >= OPEN_PX) {
          wrap.classList.add("is-open");
          setOffset(OPEN_PX);
          return;
        }
        resetOffset();
      },
      { passive: true }
    );

    if (form) {
      form.addEventListener("submit", function () {
        wrap.classList.add("is-archiving");
      });
    }
  }

  document.querySelectorAll(".listing-swipe").forEach(init);
})();
