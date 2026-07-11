(function () {
  var OPEN_PX = 72;
  var ARCHIVE_PX = 120;
  var REMOVAL_MS = 280;
  var UNDO_MS = 2000;
  var removedCards = new Map();
  var activeToast = null;
  var activeToastTimer = null;

  var fetchHeaders = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
    "sec-fetch-site": "same-origin",
  };

  function columnSelector(type) {
    return type === "get"
      ? ".board-scope__panel--board .feed-cols__get"
      : ".board-scope__panel--board .feed-cols__give";
  }

  function hiddenColumnSelector(type) {
    return type === "get"
      ? ".board-scope__panel--hidden .feed-cols__get"
      : ".board-scope__panel--hidden .feed-cols__give";
  }

  function listingModalsHtml(listingId) {
    var modal = document.getElementById("l-" + listingId);
    var editModal = document.getElementById("edit-l-" + listingId);
    return {
      modal: modal ? modal.outerHTML : "",
      editModal: editModal ? editModal.outerHTML : "",
    };
  }

  function removeModals(listingId) {
    var modal = document.getElementById("l-" + listingId);
    var editModal = document.getElementById("edit-l-" + listingId);
    if (modal) modal.remove();
    if (editModal) editModal.remove();
  }

  function restoreModals(modals) {
    if (!modals) return;
    var main = document.querySelector("main");
    if (!main) return;
    if (modals.modal) main.insertAdjacentHTML("beforeend", modals.modal);
    if (modals.editModal) main.insertAdjacentHTML("beforeend", modals.editModal);
  }

  function animateRemove(el, onDone) {
    if (!el) {
      if (onDone) onDone();
      return;
    }
    el.classList.add("is-removing");
    window.setTimeout(function () {
      el.remove();
      if (onDone) onDone();
    }, REMOVAL_MS);
  }

  function dismissToast() {
    if (activeToastTimer) window.clearTimeout(activeToastTimer);
    if (activeToast) {
      activeToast.classList.add("gg-toast--gone");
      activeToast = null;
    }
    activeToastTimer = null;
  }

  function showUndoToast(listingId, onUndo) {
    dismissToast();

    var toast = document.createElement("div");
    toast.className = "gg-toast gg-toast--undo";
    toast.setAttribute("role", "status");
    toast.setAttribute("data-listing-id", listingId);
    toast.innerHTML =
      '<span>Hidden from feed · <a href="#scope-hidden">see hidden</a></span>' +
      '<button type="button" class="gg-toast__undo">Undo</button>';
    document.body.appendChild(toast);
    activeToast = toast;

    var undoBtn = toast.querySelector(".gg-toast__undo");
    var seeHidden = toast.querySelector('a[href="#scope-hidden"]');
    if (seeHidden) {
      seeHidden.addEventListener("click", function (e) {
        e.preventDefault();
        var hiddenTab = document.getElementById("scope-hidden");
        if (hiddenTab) hiddenTab.checked = true;
        dismissToast();
      });
    }

    activeToastTimer = window.setTimeout(function () {
      removedCards.delete(String(listingId));
      dismissToast();
    }, UNDO_MS);

    undoBtn.addEventListener("click", function () {
      if (undoBtn.disabled) return;
      undoBtn.disabled = true;
      if (activeToastTimer) window.clearTimeout(activeToastTimer);

      fetch("/l/" + listingId + "/unarchive", {
        method: "POST",
        headers: fetchHeaders,
        body: "",
      })
        .then(function (res) {
          if (!res.ok) throw new Error("undo failed");
          if (onUndo) onUndo();
          toast.querySelector("span").textContent = "Restored to board";
          window.setTimeout(dismissToast, 600);
        })
        .catch(function () {
          undoBtn.disabled = false;
          toast.querySelector("span").textContent = "Undo failed — try Hidden tab";
        });
    });
  }

  function reinsertBoardCard(stored) {
    if (!stored || !stored.html) return;
    var col = document.querySelector(columnSelector(stored.type));
    if (!col) return;
    col.insertAdjacentHTML("afterbegin", stored.html);
    var wrap = col.querySelector('.listing-swipe[data-listing-id="' + stored.id + '"]');
    if (wrap) initSwipe(wrap);
    restoreModals(stored.modals);
  }

  function archiveListing(listingId, wrap) {
    var type = wrap.getAttribute("data-listing-type") || "give";
    var stored = {
      id: String(listingId),
      type: type,
      html: wrap.outerHTML,
      modals: listingModalsHtml(listingId),
    };

    fetch("/l/" + listingId + "/archive", {
      method: "POST",
      headers: fetchHeaders,
      body: "",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("archive failed");
        removedCards.set(String(listingId), stored);
        animateRemove(wrap, function () {
          removeModals(listingId);
        });
        showUndoToast(listingId, function () {
          reinsertBoardCard(removedCards.get(String(listingId)));
          removedCards.delete(String(listingId));
        });
      })
      .catch(function () {
        wrap.classList.remove("is-archiving");
      });
  }

  function restoreListing(listingId, wrap) {
    fetch("/l/" + listingId + "/unarchive", {
      method: "POST",
      headers: fetchHeaders,
      body: "",
    })
      .then(function (res) {
        if (!res.ok) throw new Error("restore failed");
        animateRemove(wrap, function () {
          removeModals(listingId);
        });
        dismissToast();
        var toast = document.createElement("div");
        toast.className = "gg-toast";
        toast.setAttribute("role", "status");
        toast.innerHTML = "<span>Restored to board</span>";
        document.body.appendChild(toast);
        window.setTimeout(function () {
          toast.classList.add("gg-toast--gone");
        }, 1800);
      })
      .catch(function () {
        wrap.classList.remove("is-removing");
      });
  }

  function initSwipe(wrap) {
    var panel = wrap.querySelector(".listing-swipe__panel");
    var form = wrap.querySelector(".listing-swipe__archive-form");
    var action = wrap.querySelector(".listing-swipe__action");
    if (!panel) return;

    var startX = 0;
    var startY = 0;
    var dragging = false;
    var axis = null;
    var listingId = wrap.getAttribute("data-listing-id");

    function setOffset(px) {
      panel.style.transform = "translateX(" + -Math.min(px, ARCHIVE_PX) + "px)";
    }

    function resetOffset() {
      panel.style.transform = "";
      wrap.classList.remove("is-open");
    }

    function submitArchive() {
      if (!listingId) return;
      wrap.classList.add("is-archiving");
      archiveListing(listingId, wrap);
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
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        submitArchive();
      });
    }
  }

  function initRestore(wrap) {
    var form = wrap.querySelector(".listing-restore__form");
    var listingId = wrap.getAttribute("data-listing-id");
    if (!form || !listingId) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      wrap.classList.add("is-removing");
      restoreListing(listingId, wrap);
    });
  }

  document.querySelectorAll(".listing-swipe").forEach(initSwipe);
  document.querySelectorAll(".listing-restore").forEach(initRestore);

  // Deep-link ?hidden=1 — sync Board/Hidden pill when toggling via URL on load.
  try {
    var url = new URL(window.location.href);
    if (url.searchParams.get("hidden") === "1") {
      var hiddenTab = document.getElementById("scope-hidden");
      if (hiddenTab) hiddenTab.checked = true;
    }
  } catch (_) {}
})();
