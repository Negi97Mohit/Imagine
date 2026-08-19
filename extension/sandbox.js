// Runs inside a Chrome extension "sandbox" page: a unique, null-origin
// document. It can draw to its own canvas/DOM and load the bound image,
// but it cannot read the host page's DOM/cookies, and has no access to any
// chrome.* extension API. This is what makes it safe to run arbitrary,
// user-authored JS here — the isolation is enforced by Chrome, not by us.
(function () {
  const canvas = document.getElementById("stage");
  const root = document.getElementById("root");
  const userCss = document.getElementById("user-css");

  let handle = null;
  let img = null;
  let bindingId = null;
  let initGen = 0; // bumped on every INIT so a stale, superseded image load can't report a stale error

  const pendingStorageRequests = new Map(); // requestId -> {resolve, reject}

  function nextRequestId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function resizeTo(w, h) {
    canvas.width = Math.max(1, Math.round(w));
    canvas.height = Math.max(1, Math.round(h));
    if (handle && typeof handle.resize === "function") {
      try {
        handle.resize(canvas.width, canvas.height);
      } catch (e) {
        console.error("[locked-image] resize error:", e);
        reportError(e.message, e);
      }
    }
  }

  function reportError(message, err) {
    const badge = document.getElementById("error-badge");
    if (badge) {
      badge.style.display = "block";
      badge.textContent = `⚠️ ${String(message || "Interaction error").slice(0, 50)}`;
    }
    parent.postMessage(
      {
        source: "locked-image-sandbox",
        type: "ERROR",
        message: String(message || (err && err.message) || "Unknown error"),
        stack: err && err.stack ? String(err.stack) : null,
      },
      "*"
    );
  }

  // Most images posted around the web (social platforms, CDNs, hotlinked
  // photos) aren't served with permissive CORS headers, and the sandbox's
  // unique null origin doesn't get special treatment. Try a CORS-clean
  // load first (needed only if an interaction wants raw pixel access via
  // getImageData/toDataURL); if that's refused, fall back to a plain,
  // "tainted" load — drawImage() still works fine on a tainted canvas, so
  // the vast majority of interactions render correctly either way. Only
  // report an error if the image genuinely can't be fetched at all.
  function loadBoundImage(url, gen, onReady) {
    const tryLoad = (srcUrl, isDataUrl) => {
      const candidate = new Image();
      if (!isDataUrl && !srcUrl.startsWith("data:")) candidate.crossOrigin = "anonymous";
      candidate.onload = () => {
        if (gen !== initGen) return;
        onReady(candidate);
      };
      candidate.onerror = () => {
        if (gen !== initGen) return;
        if (!isDataUrl && !srcUrl.startsWith("data:")) {
          // Request privileged CORS-clean data URL from background worker
          const requestId = nextRequestId();
          pendingStorageRequests.set(requestId, {
            resolve: (cleanDataUrl) => {
              if (cleanDataUrl && gen === initGen) tryLoad(cleanDataUrl, true);
              else tryFallback();
            },
            reject: () => tryFallback(),
          });
          parent.postMessage(
            { source: "locked-image-sandbox", type: "FETCH_IMAGE_DATA_URL", requestId, url },
            "*"
          );
        } else {
          tryFallback();
        }
      };
      candidate.src = srcUrl;
    };

    const tryFallback = () => {
      const plain = new Image();
      plain.onload = () => { if (gen === initGen) onReady(plain); };
      plain.onerror = () => {
        if (gen === initGen) {
          reportError("Image failed to load — check the URL: " + url);
          onReady(plain);
        }
      };
      plain.src = url;
    };

    tryLoad(url, false);
  }

  // Catches errors thrown asynchronously inside a user interaction (e.g.
  // from a requestAnimationFrame loop) that our try/catch blocks below
  // can't see, so the editor's live preview can surface them too.
  window.addEventListener("error", (e) => {
    reportError(e.message, e.error);
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportError("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
  });

  function teardown() {
    if (handle && typeof handle.destroy === "function") {
      try {
        handle.destroy();
      } catch (e) {
        console.error("[locked-image] destroy error:", e);
      }
    }
    handle = null;
  }

  // The only bridge back out of the sandbox. Two narrow, mediated
  // capabilities that cover the realistic universe of things an
  // interaction can't do to itself:
  //  - openLink: the sandbox has no allow-popups/allow-top-navigation,
  //    so it can never navigate anywhere on its own.
  //  - storage: the sandbox gets a brand-new, unique origin every single
  //    time it loads, so anything it tries to persist itself (localStorage,
  //    IndexedDB) vanishes the instant you stop hovering. This routes
  //    small key/value state through the host, scoped to *this specific
  //    bound image* so two different interactions (or the same
  //    interaction bound to two different images) never see each other's
  //    data.
  const host = Object.freeze({
    openLink(url) {
      try {
        parent.postMessage({ source: "locked-image-sandbox", type: "OPEN_LINK", url: String(url) }, "*");
      } catch (e) {}
    },
    storage: Object.freeze({
      get(key) {
        return new Promise((resolve, reject) => {
          const requestId = nextRequestId();
          pendingStorageRequests.set(requestId, { resolve, reject });
          parent.postMessage(
            { source: "locked-image-sandbox", type: "STORAGE_GET", requestId, bindingId, key: String(key) },
            "*"
          );
        });
      },
      set(key, value) {
        return new Promise((resolve, reject) => {
          const requestId = nextRequestId();
          pendingStorageRequests.set(requestId, { resolve, reject });
          parent.postMessage(
            { source: "locked-image-sandbox", type: "STORAGE_SET", requestId, bindingId, key: String(key), value },
            "*"
          );
        });
      },
    }),
  });

  function runInteraction(interaction, config) {
    if (interaction) {
      userCss.textContent = interaction.css || "";
      root.innerHTML = interaction.html || "";
      try {
        // A fresh Function scope: the only things the user's code can touch
        // are the arguments it's given. No `window.parent`, no `chrome`,
        // no closures over anything of ours — `host` is the one narrow,
        // mediated exception (see above).
        const factory = new Function(
          "canvas",
          "img",
          "config",
          "root",
          "host",
          (interaction.js || "") +
            "\n;return (typeof run === 'function') ? run(canvas, img, config, root, host) : null;"
        );
        const result = factory(canvas, img, config || {}, root, host);
        if (!result) {
          reportError("No run(canvas, img, config, root) function was found. Define a global run() that returns { onPointerMove, resize, destroy }.");
        }
        return result;
      } catch (err) {
        console.error("[locked-image] interaction failed to run:", err);
        reportError(err.message, err);
        return null;
      }
    }
    // Legacy binding with no embedded interaction — fall back to the
    // built-in water-reveal so old bindings keep working.
    try {
      return window.__defaultInteraction(canvas, img, config || {});
    } catch (err) {
      console.error("[locked-image] default interaction failed:", err);
      return null;
    }
  }

  window.addEventListener("message", (e) => {
    const msg = e.data;
    if (!msg || msg.source !== "locked-image-host") return;

    if (msg.type === "INIT") {
      teardown();
      root.innerHTML = "";
      bindingId = msg.bindingId || null;
      resizeTo(msg.width, msg.height);

      const loadingBar = document.getElementById("loading-bar");
      if (loadingBar) loadingBar.classList.remove("hidden");
      const badge = document.getElementById("error-badge");
      if (badge) badge.style.display = "none";

      const gen = ++initGen;
      loadBoundImage(msg.imageUrl, gen, (loadedImg) => {
        if (gen !== initGen) return; // a newer INIT has already superseded this one
        img = loadedImg;
        handle = runInteraction(msg.interaction, msg.config);
        if (loadingBar) loadingBar.classList.add("hidden");
      });
    }

    if (msg.type === "RESIZE") {
      resizeTo(msg.width, msg.height);
    }

    if (msg.type === "DESTROY") {
      teardown();
    }

    if (msg.type === "STORAGE_RESULT") {
      const pending = pendingStorageRequests.get(msg.requestId);
      if (pending) {
        pendingStorageRequests.delete(msg.requestId);
        if (msg.ok) pending.resolve(msg.value);
        else pending.reject(new Error(msg.error || "storage error"));
      }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (handle && typeof handle.onPointerMove === "function") {
      try {
        handle.onPointerMove(e.offsetX, e.offsetY);
      } catch (err) {
        console.error("[locked-image] onPointerMove error:", err);
        reportError(err.message, err);
      }
    }
  });

  canvas.addEventListener("click", (e) => {
    if (handle && typeof handle.onClick === "function") {
      try {
        handle.onClick(e.offsetX, e.offsetY);
      } catch (err) {
        console.error("[locked-image] onClick error:", err);
        reportError(err.message, err);
      }
    }
  });

  // The iframe is sized/positioned to sit exactly on top of the bound
  // image, so a real pointerleave fires here the instant the cursor exits
  // those bounds — tell the host page (content script) to tear it down.
  function notifyLeave(e) {
    if (e && e.relatedTarget) return; // Moving inside document, do not leave
    parent.postMessage({ source: "locked-image-sandbox", type: "LEAVE" }, "*");
  }
  document.documentElement.addEventListener("pointerleave", notifyLeave);
  document.addEventListener("pointercancel", notifyLeave);

  parent.postMessage({ source: "locked-image-sandbox", type: "READY" }, "*");
})();

