// Finds candidate <img> elements anywhere on the page and reports them
// through two callbacks:
//   onCandidate(imgEl)          - first time we think this image is worth identifying
//   onVisibilityChange(imgEl, visible) - viewport enter/exit, used to open/close
//                                        realtime subscriptions only for what's on screen
//
// Deliberately does NOT do any network/fingerprint work itself - that's the
// identity module's job (background.js). This module's only concerns are
// "which DOM elements are candidate images" and "which of those are
// currently worth paying attention to."
const ImageDetector = (() => {
  const MIN_DIMENSION = 140; // skip small icons, avatars, buttons, sprites
  const MIN_AREA = 140 * 140;

  const seen = new WeakSet(); // elements already reported via onCandidate
  const visible = new WeakSet(); // elements currently intersecting viewport

  let candidateCb = () => {};
  let visibilityCb = () => {};
  let io = null;
  let mo = null;

  function resolvedSrc(img) {
    // currentSrc reflects what the browser actually chose from srcset/picture -
    // that's the URL actually rendered, src alone can be stale or empty.
    return img.currentSrc || img.src || "";
  }

  function looksLikeCandidate(img) {
    const src = resolvedSrc(img);
    if (!src) return false;
    if (src.startsWith("data:") && src.length < 512) return false; // tiny inline placeholders/spinners
    const w = img.naturalWidth || img.width || img.offsetWidth || 0;
    const h = img.naturalHeight || img.height || img.offsetHeight || 0;
    if (w && h) {
      if (w < MIN_DIMENSION || h < MIN_DIMENSION) return false;
      if (w * h < MIN_AREA) return false;
    }
    return true;
  }


  function report(img) {
    if (seen.has(img)) return;
    if (!looksLikeCandidate(img)) return;
    seen.add(img);
    candidateCb(img);
    // Observe for visibility once it's a real candidate, not before -
    // no point tracking intersection for images we'll never process.
    io && io.observe(img);
  }

  function considerImg(img) {
    if (img.complete && (img.naturalWidth > 0 || img.src.startsWith("data:"))) {
      report(img);
    } else {
      img.addEventListener(
        "load",
        () => report(img),
        { once: true }
      );
    }
  }

  function scanAll(root) {
    const scope = root || document;
    if (scope.querySelectorAll) {
      scope.querySelectorAll("img").forEach(considerImg);
    }
    if (scope.nodeType === 1 && scope.tagName === "IMG") considerImg(scope);
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      const img = entry.target;
      const isVisible = entry.isIntersecting;
      const was = visible.has(img);
      if (isVisible && !was) {
        visible.add(img);
        visibilityCb(img, true);
      } else if (!isVisible && was) {
        visible.delete(img);
        visibilityCb(img, false);
      }
    }
  }

  function start({ onCandidate, onVisibilityChange } = {}) {
    candidateCb = onCandidate || candidateCb;
    visibilityCb = onVisibilityChange || visibilityCb;

    io = new IntersectionObserver(onIntersect, {
      root: null,
      rootMargin: "200px", // start a little before it's fully on screen
      threshold: 0.1,
    });

    scanAll(document);

    // Covers infinite scroll, SPA route swaps, and lazy-loading libs that
    // rewrite src/srcset after insertion.
    mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.tagName === "IMG") considerImg(node);
          else if (node.querySelectorAll) scanAll(node);
        });
        if (m.type === "attributes" && m.target.tagName === "IMG") {
          // src/srcset swapped in place (common lazy-load pattern) - treat
          // as a fresh candidate under its new resolved URL.
          seen.delete(m.target);
          considerImg(m.target);
        }
      }
    });
    mo.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcset"],
    });
  }

  function stop() {
    io && io.disconnect();
    mo && mo.disconnect();
  }

  return { start, stop, resolvedSrc };
})();
