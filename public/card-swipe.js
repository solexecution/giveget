(function () {
  var OPEN_PX = 72;
  var ARCHIVE_PX = 120;

  function init(wrap) {
    var panel = wrap.querySelector(".listing-swipe__panel");
    var form = wrap.querySelector(".listing-swipe__archive-form");
    var action = wrap.querySelector(".listing-swipe__action");
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

    if (action) {
      action.addEventListener("click", function () {
        if (wrap.classList.contains("is-open")) submitArchive();
      });
    }

    if (form) {
      form.addEventListener("submit", function () {
        wrap.classList.add("is-archiving");
      });
    }
  }

  document.querySelectorAll(".listing-swipe").forEach(init);

  var toast = document.querySelector(".gg-toast--undo");
  if (!toast) return;

  var listingId = toast.getAttribute("data-listing-id");
  var undoBtn = toast.querySelector(".gg-toast__undo");
  if (!listingId || !undoBtn) return;

  var hideTimer = window.setTimeout(function () {
    toast.classList.add("gg-toast--gone");
  }, 2000);

  try {
    var url = new URL(window.location.href);
    if (url.searchParams.has("archived")) {
      url.searchParams.delete("archived");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch (_) {}

  undoBtn.addEventListener("click", function () {
    if (undoBtn.disabled) return;
    undoBtn.disabled = true;
    window.clearTimeout(hideTimer);

    fetch("/l/" + listingId + "/unarchive", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "sec-fetch-site": "same-origin",
      },
      body: "",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("undo failed");
        toast.innerHTML = "<span>Restored to browse</span>";
        window.setTimeout(function () {
          toast.classList.add("gg-toast--gone");
          window.location.reload();
        }, 600);
      })
      .catch(function () {
        undoBtn.disabled = false;
        toast.querySelector("span").textContent = "Undo failed — try Profile";
      });
  });
})();
