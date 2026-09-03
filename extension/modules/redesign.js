// ---- Task 3 & Redesign Studio Engine ----
// Lets a user select any DOM element on the page (or body) and apply persistent
// custom visual restyling (CSS properties, custom CSS, custom HTML, and native engines).
// Features: Live preview as you type, direct saving (no reload needed), community sharing, and individual toggles.

const RedesignMode = (() => {
  const APPLIED_STYLE_PREFIX = "open-sesame-redesign-style-";
  const PREVIEW_STYLE_ID = "open-sesame-redesign-preview-style";

  // Cache of original element states before preview/redesign: el -> { inlineStyle, innerHTML }
  const originalStateMap = new WeakMap();

  // In-memory list of active redesign entries on this page
  let activeRedesignEntries = [];

  // Safe background passthrough: only for top-level page wrapper containers when full-page engine is active
  const BG_PASSTHROUGH_ID = "open-sesame-bg-passthrough";
  function updateBgPassthrough(isNeeded) {
    let tag = document.getElementById(BG_PASSTHROUGH_ID);
    if (isNeeded) {
      if (!tag) {
        tag = document.createElement("style");
        tag.id = BG_PASSTHROUGH_ID;
        document.head.appendChild(tag);
      }
      tag.textContent = `
        #root, #__next, #app, main, [data-reactroot], .main-content, .layout, .page-wrapper {
          background-color: transparent !important;
        }
      `;
    } else if (tag) {
      tag.remove();
    }
  }

  function sanitizeCss(cssText) {
    if (!cssText || typeof cssText !== "string") return "";
    return cssText
      .replace(/<[^>]*>/g, "")
      .replace(/javascript:/gi, "")
      .replace(/expression\s*\(/gi, "")
      .replace(/behavior\s*:/gi, "")
      .replace(/@-moz-binding/gi, "");
  }

  function buildSafeSelector(rawSel) {
    if (!rawSel) return "";
    const parts = rawSel.split(",").map((s) => s.trim()).filter(Boolean);
    return parts
      .map((s) => {
        const lower = s.toLowerCase();
        if (lower === "html" || lower === "body") {
          return `${s}`;
        }
        if (lower.startsWith("body ") || lower.startsWith("body >") || lower.startsWith("html ")) {
          return `${s}:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *):not([id^="open-sesame"])`;
        }
        return `html body ${s}:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *):not([id^="open-sesame"]), ${s}:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *):not([id^="open-sesame"])`;
      })
      .join(", ");
  }

  function applyCssDeclarationsToElement(el, cssText) {
    if (!el || !cssText) return;
    const declMatches = cssText.match(/([a-zA-Z-]+)\s*:\s*([^;]+)(?:;|$)/g);
    if (!declMatches) return;
    for (const d of declMatches) {
      const parts = d.split(/:(.+)/);
      if (parts.length >= 2) {
        const prop = parts[0].trim().toLowerCase();
        let val = parts[1].replace(/;$/, "").trim();
        const isImportant = /!important/i.test(val);
        val = val.replace(/!important/i, "").trim();
        if (prop && val) {
          try {
            el.style.setProperty(prop, val, isImportant ? "important" : "");
          } catch (e) {}
        }
      }
    }
  }

  // ---- Unique (This Element Only) Selector Generation ----
  function getUniqueElementSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

    // 1. Unique ID
    if (el.id) {
      try {
        const idSel = `#${CSS.escape(el.id)}`;
        if (document.querySelectorAll(idSel).length === 1) return idSel;
      } catch (e) {}
    }

    // 2. Unique test / name / aria attribute
    const testAttrs = ["data-testid", "data-test", "data-qa", "data-cy", "data-id", "name", "aria-label"];
    for (const attr of testAttrs) {
      const val = el.getAttribute(attr);
      if (val) {
        try {
          const sel = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(val)}"]`;
          if (document.querySelectorAll(sel).length === 1) return sel;
        } catch (e) {}
      }
    }

    // 3. Unique class combo
    const tag = el.tagName.toLowerCase();
    const rawClasses = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const looksHashed = (c) => /^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c) && /[a-z]/i.test(c) && !/[-_]/.test(c);
    const usableClasses = rawClasses.filter((c) => !looksHashed(c));
    if (usableClasses.length) {
      try {
        const sel = `${tag}.${usableClasses.map((c) => CSS.escape(c)).join(".")}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      } catch (e) {}
    }

    // 4. Exact structural path with :nth-child all the way from nearest unique parent or body
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node === document.body) {
        parts.unshift("body");
        break;
      }
      if (node.id) {
        try {
          if (document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
            parts.unshift(`#${CSS.escape(node.id)}`);
            break;
          }
        } catch (e) {}
      }

      const parent = node.parentElement;
      if (!parent) {
        parts.unshift(node.tagName.toLowerCase());
        break;
      }

      const index = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
    }

    const fullPath = parts.join(" > ");
    try {
      if (document.querySelectorAll(fullPath).length === 1) {
        return fullPath;
      }
    } catch (e) {}

    // 5. Explicit persistent ID tag on element as fallback
    if (!el.dataset.imagineUid) {
      el.dataset.imagineUid = "uid_" + Math.random().toString(36).slice(2, 9);
    }
    return `[data-imagine-uid="${el.dataset.imagineUid}"]`;
  }

  // ---- Broad (All Matching Elements) Selector Generation ----
  function getBroadElementSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

    const tag = el.tagName.toLowerCase();
    const rawClasses = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const looksHashed = (c) => /^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c) && /[a-z]/i.test(c) && !/[-_]/.test(c);
    const usableClasses = rawClasses.filter((c) => !looksHashed(c));

    if (tag === "button" || el.getAttribute("role") === "button") {
      if (usableClasses.length) return `${tag}.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      return "button, [role='button']";
    }
    if (tag === "input") {
      const type = el.getAttribute("type") || "text";
      if (usableClasses.length) return `input[type="${type}"].${usableClasses.slice(0, 1).map((c) => CSS.escape(c)).join(".")}`;
      return `input[type="${type}"]`;
    }
    if (tag === "a") {
      if (usableClasses.length) return `a.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      return "a";
    }
    if (tag === "img") {
      if (usableClasses.length) return `img.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      return "img";
    }
    if (["h1", "h2", "h3", "h4", "h5", "h6", "p", "nav", "header", "footer", "article", "section"].includes(tag)) {
      if (usableClasses.length) return `${tag}.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      return tag;
    }
    if (usableClasses.length) {
      return `.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
    }
    return tag;
  }

  function buildResilientSelector(el, isGlobal = false) {
    return isGlobal ? getBroadElementSelector(el) : getUniqueElementSelector(el);
  }

  function safeQuery(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function safeQueryAll(selector) {
    if (!selector) return [];
    try {
      return Array.from(document.querySelectorAll(selector));
    } catch (e) {
      return [];
    }
  }

  function getDomainKey() {
    const host = (typeof location !== "undefined" && location.hostname) || "default";
    return host.replace(/^www\./i, "").toLowerCase();
  }

  function getStorageKey() {
    return `redesigns_${getDomainKey()}`;
  }

  function saveOriginalState(el) {
    if (!el || originalStateMap.has(el)) return;
    originalStateMap.set(el, {
      inlineStyle: el.getAttribute("style") || "",
      innerHTML: el.innerHTML,
    });
  }

  function restoreOriginalState(el) {
    if (!el || !originalStateMap.has(el)) return;
    const orig = originalStateMap.get(el);
    if (orig.inlineStyle) {
      el.setAttribute("style", orig.inlineStyle);
    } else {
      el.removeAttribute("style");
    }
    if (orig.innerHTML !== undefined && el.dataset.imagineHtmlModified) {
      el.innerHTML = orig.innerHTML;
      delete el.dataset.imagineHtmlModified;
    }
  }

  function camelToKebab(str) {
    return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, "$1-$2").toLowerCase();
  }

  // ---- Applying a redesign entry ----
  function applyRedesignEntry(entry) {
    if (!entry || !entry.selector) return false;
    const targets = safeQueryAll(entry.selector).filter((t) => !t.closest("#open-sesame-redesign-editor"));

    if (entry.enabled === false) {
      removeRedesignStyleTag(entry.pushId || entry.id);
      targets.forEach(restoreOriginalState);
      checkActiveBgPassthrough();
      return true;
    }

    targets.forEach(saveOriginalState);

    // Build high-specificity declarative CSS text for permanent persistence (immune to React re-renders)
    let decls = "";
    if (entry.styles && typeof entry.styles === "object") {
      for (const [prop, val] of Object.entries(entry.styles)) {
        if (val !== undefined && val !== null && val !== "") {
          const kebab = camelToKebab(prop);
          decls += `${kebab}: ${val} !important;\n`;
        }
      }
    }

    const styleId = APPLIED_STYLE_PREFIX + (entry.pushId || entry.id || "temp");
    let styleTag = document.getElementById(styleId);
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = styleId;
      document.head.appendChild(styleTag);
    }

    const customRule = entry.cssText ? entry.cssText.trim() : "";
    const safeSel = buildSafeSelector(entry.selector);
    styleTag.textContent = `
      ${safeSel} {
        ${decls}
        ${customRule}
      }
    `;

    // Apply inline fallback as immediate instant paint
    targets.forEach((el) => {
      if (entry.styles && typeof entry.styles === "object") {
        for (const [prop, val] of Object.entries(entry.styles)) {
          if (val !== undefined && val !== null && val !== "") {
            try {
              const kebab = camelToKebab(prop);
              el.style.setProperty(kebab, val, "important");
            } catch (e) {}
          }
        }
      }
      if (entry.cssText) {
        applyCssDeclarationsToElement(el, entry.cssText);
      }
      if (entry.html && entry.html.trim()) {
        try {
          el.innerHTML = entry.html;
          el.dataset.imagineHtmlModified = "true";
        } catch (e) {}
      }
      // Apply native interactive background engine (CSP-safe, no eval)
      if (entry.engineId && typeof InteractiveBackgrounds !== "undefined") {
        try {
          InteractiveBackgrounds.mount(el, entry.engineId);
        } catch (err) {
          console.error("[Redesign Error mounting interactive background]:", err);
        }
      } else if (entry.js && entry.js.trim()) {
        // Fallback: try to resolve engine from JS content (for older saved entries)
        if (typeof InteractiveBackgrounds !== "undefined") {
          const resolvedEngine = InteractiveBackgrounds.resolveEngineId(entry.js);
          if (resolvedEngine) {
            try {
              InteractiveBackgrounds.mount(el, resolvedEngine);
            } catch (err) {
              console.error("[Redesign Error mounting resolved background]:", err);
            }
          } else {
            // User-written custom JS — try new Function, may fail on strict CSP pages
            try {
              const fn = new Function("element", "target", entry.js);
              fn(el, el);
            } catch (err) {
              console.warn("[Redesign] Custom JS blocked by page CSP. Use a built-in background preset instead.", err.message);
            }
          }
        }
      } else {
        if (typeof InteractiveBackgrounds !== "undefined") {
          InteractiveBackgrounds.unmount(el);
          if (el === document.body || el === document.documentElement) {
            InteractiveBackgrounds.unmount(document.body);
          }
        }
      }
    });

    checkActiveBgPassthrough();
    return true;
  }

  function checkActiveBgPassthrough() {
    const hasActiveBg = activeRedesignEntries.some((e) => {
      if (e.enabled === false) return false;
      const s = (e.selector || "").toLowerCase();
      return s === "body" || s === "html" || Boolean(e.engineId) || (e.js && (e.js.includes("imagine-webgl-canvas") || e.js.includes("imagine-interactive-canvas")));
    });
    updateBgPassthrough(hasActiveBg);
  }

  function removeRedesignStyleTag(id) {
    if (!id) return;
    const styleId = APPLIED_STYLE_PREFIX + id;
    const tag = document.getElementById(styleId);
    if (tag) tag.remove();
  }

  function unapplyRedesignEntry(entry) {
    if (!entry) return;
    removeRedesignStyleTag(entry.pushId || entry.id);
    const targets = safeQueryAll(entry.selector).filter((t) => !t.closest("#open-sesame-redesign-editor"));
    targets.forEach((el) => {
      if (typeof InteractiveBackgrounds !== "undefined") {
        InteractiveBackgrounds.unmount(el);
      }
      const canvases = el.querySelectorAll(":scope > .imagine-webgl-canvas, :scope > .imagine-interactive-canvas, :scope > .imagine-interactive-stamp");
      canvases.forEach((c) => c.remove());
      restoreOriginalState(el);
    });
    if (typeof InteractiveBackgrounds !== "undefined") {
      InteractiveBackgrounds.unmount(document.body);
    }
    document.querySelectorAll("#imagine-webgl-canvas-global, #imagine-repulsion-canvas-global, #imagine-interactive-canvas-global, .imagine-interactive-canvas-global, .imagine-interactive-stamp-global, #webgl-canvas").forEach((c) => c.remove());
    checkActiveBgPassthrough();
  }

  function toHexColor(str, fallback = "#6366f1") {
    if (!str) return fallback;
    str = String(str).trim();
    if (/^#[0-9a-f]{6}$/i.test(str)) return str;
    if (/^#[0-9a-f]{3}$/i.test(str)) {
      return `#${str[1]}${str[1]}${str[2]}${str[2]}${str[3]}${str[3]}`;
    }
    try {
      const d = document.createElement("div");
      d.style.color = str;
      document.body.appendChild(d);
      const cs = getComputedStyle(d).color;
      d.remove();
      const m = cs.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const hex = (n) => parseInt(n, 10).toString(16).padStart(2, "0");
        return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
      }
    } catch (e) {}
    return fallback;
  }

  // ---- Live Preview helper ----
  function applyLivePreview(el, { styles, cssText, html, js, engineId } = {}) {
    if (!el || el.closest("#open-sesame-redesign-editor")) return;
    saveOriginalState(el);

    // Revert inline style to clean base state before reapplying
    const orig = originalStateMap.get(el);
    if (orig && orig.inlineStyle !== undefined) {
      if (orig.inlineStyle) {
        el.setAttribute("style", orig.inlineStyle);
      } else {
        el.removeAttribute("style");
      }
    } else {
      el.removeAttribute("style");
    }

    // Apply current inline style properties with !important so they superceed everything
    if (styles && typeof styles === "object") {
      for (const [prop, val] of Object.entries(styles)) {
        if (val !== undefined && val !== null && val !== "") {
          try {
            const kebab = camelToKebab(prop);
            el.style.setProperty(kebab, val, "important");
          } catch (e) {
            try { el.style[prop] = val; } catch (e2) {}
          }
        }
      }
    }

    // Apply custom CSS declarations directly to el.style for instant live background paint
    if (cssText && cssText.trim()) {
      applyCssDeclarationsToElement(el, cssText);
    }

    // Apply custom CSS live with high specificity in style tag
    let previewStyle = document.getElementById(PREVIEW_STYLE_ID);
    if (cssText && cssText.trim()) {
      if (!previewStyle) {
        previewStyle = document.createElement("style");
        previewStyle.id = PREVIEW_STYLE_ID;
        document.head.appendChild(previewStyle);
      }
      const sel = buildResilientSelector(el);
      const safeSel = buildSafeSelector(sel);
      previewStyle.textContent = `${safeSel} { ${cssText} }`;
    } else if (previewStyle) {
      previewStyle.textContent = "";
    }

    // Apply HTML live
    if (html !== undefined && html !== null && html.trim() !== "") {
      try {
        el.innerHTML = html;
        el.dataset.imagineHtmlModified = "true";
      } catch (e) {}
    } else if (orig && orig.innerHTML !== undefined && el.dataset.imagineHtmlModified) {
      el.innerHTML = orig.innerHTML;
      delete el.dataset.imagineHtmlModified;
    }

    // Apply native interactive background engine (CSP-safe, zero eval)
    if (engineId && typeof InteractiveBackgrounds !== "undefined") {
      try {
        InteractiveBackgrounds.mount(el, engineId);
      } catch (err) {
        console.error("[Redesign Error mounting live interactive background]:", err);
      }
    } else if (js && js.trim()) {
      if (typeof InteractiveBackgrounds !== "undefined") {
        const resolvedEngine = InteractiveBackgrounds.resolveEngineId(js);
        if (resolvedEngine) {
          try {
            InteractiveBackgrounds.mount(el, resolvedEngine);
          } catch (err) {
            console.error("[Redesign Error mounting resolved live background]:", err);
          }
        } else {
          try {
            const fn = new Function("element", "target", js);
            fn(el, el);
          } catch (err) {
            console.warn("[Redesign] Custom JS blocked by page CSP. Use a built-in background preset instead.", err.message);
          }
        }
      }
    } else {
      // Unmount any previous canvas engine when switching to static presets or custom styles
      if (typeof InteractiveBackgrounds !== "undefined") {
        InteractiveBackgrounds.unmount(el);
        if (el === document.body || el === document.documentElement) {
          InteractiveBackgrounds.unmount(document.body);
        }
      }
    }

    // Trigger transparent passthrough during live preview of background/shaders
    const isBgShader = Boolean(engineId) || (js && (js.includes("imagine-webgl-canvas") || js.includes("imagine-interactive-canvas"))) || (styles?.backgroundColor === "transparent" && !styles?.border);
    updateBgPassthrough(isBgShader);
  }

  function clearLivePreview(el) {
    const previewStyle = document.getElementById(PREVIEW_STYLE_ID);
    if (previewStyle) previewStyle.remove();
    if (typeof InteractiveBackgrounds !== "undefined") {
      if (el) InteractiveBackgrounds.unmount(el);
      InteractiveBackgrounds.unmount(document.body);
    }
    if (el) {
      const canvases = el.querySelectorAll(":scope > .imagine-webgl-canvas, :scope > .imagine-interactive-canvas, :scope > .imagine-interactive-stamp");
      canvases.forEach((c) => c.remove());
      restoreOriginalState(el);
    }
    document.querySelectorAll("#imagine-webgl-canvas-global, #imagine-repulsion-canvas-global, #imagine-interactive-canvas-global, .imagine-interactive-canvas-global, .imagine-interactive-stamp-global, #webgl-canvas").forEach((c) => c.remove());
    checkActiveBgPassthrough();
  }

  // ---- Element picker (highlight & select) ----
  let pickerActive = false;
  let highlightBox = null;
  let pickerHoverEl = null;
  let stopPickerFn = null;

  function startPicker(onPicked) {
    if (pickerActive) return;
    pickerActive = true;

    highlightBox = document.createElement("div");
    highlightBox.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;" +
      "border:2px solid #6366f1;background:rgba(99,102,241,0.18);border-radius:4px;display:none;transition:all 0.08s ease;";
    document.body.appendChild(highlightBox);

    const hint = document.createElement("div");
    hint.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#6366f1;animation:os-pulse 1.5s infinite;"></span>
        <span><b>Redesign Mode:</b> Click any element on the page to redesign it</span>
        <span style="opacity:0.6;font-size:10px;margin-left:6px;">[Esc to cancel]</span>
      </div>
    `;
    hint.style.cssText =
      "position:fixed;left:50%;top:18px;transform:translateX(-50%);" +
      "background:rgba(18,18,23,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);" +
      "color:#fff;font:500 12px/1.4 Inter,system-ui,sans-serif;padding:8px 18px;border-radius:30px;" +
      "z-index:2147483647;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.35);border:1px solid rgba(255,255,255,0.15);";
    document.body.appendChild(hint);

    function onMove(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === highlightBox || el === hint || hint.contains(el)) return;
      pickerHoverEl = el;
      const r = el.getBoundingClientRect();
      highlightBox.style.display = "block";
      highlightBox.style.left = `${r.left}px`;
      highlightBox.style.top = `${r.top}px`;
      highlightBox.style.width = `${r.width}px`;
      highlightBox.style.height = `${r.height}px`;
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const picked = pickerHoverEl;
      stopPicker();
      if (picked) onPicked(picked);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") stopPicker();
    }

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    stopPickerFn = function stopPicker() {
      pickerActive = false;
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      if (highlightBox) { highlightBox.remove(); highlightBox = null; }
      if (hint) { hint.remove(); }
      stopPickerFn = null;
    };
  }

  function stopPicker() {
    if (stopPickerFn) stopPickerFn();
  }

  // ---- Chic & Minimal Redesign Studio Panel with Dark/Light Toggle ----
  let currentStudioTheme = "light"; // default light chic mode

  function openEditorPanel(el, existingEntry = null) {
    const oldPanel = document.getElementById("open-sesame-redesign-editor");
    if (oldPanel) oldPanel.remove();

    saveOriginalState(el);
    let currentEngineId = existingEntry?.engineId || null;
    let activePreset = null;
    let isGlobalScope = existingEntry?.scope === "global" || false;
    let selector = existingEntry?.selector || buildResilientSelector(el, isGlobalScope);
    const tagName = el.tagName.toLowerCase();

    const panel = document.createElement("div");
    panel.id = "open-sesame-redesign-editor";
    panel.dataset.theme = currentStudioTheme;

    const existingStyles = existingEntry?.styles || {};
    const existingCss = existingEntry?.cssText || "";
    const existingHtml = existingEntry?.html || "";
    const existingJs = existingEntry?.js || "";
    const existingName = existingEntry?.name || `${tagName} redesign`;

    function getThemeStyles(isDark) {
      if (isDark) {
        return {
          bg: "#0d0d0d",
          border: "rgba(242, 237, 228, 0.16)",
          text: "#f2ede4",
          subtext: "#9a9284",
          cardBg: "#141414",
          inputBg: "#1c1c1c",
          inputBorder: "rgba(242, 237, 228, 0.18)",
          accent: "#e56b3a",
          accentBg: "rgba(229, 107, 58, 0.14)",
          primaryBtnBg: "#f2ede4",
          primaryBtnText: "#0d0d0d",
          secondaryBtnBg: "#1c1c1c",
          secondaryBtnText: "#cfc8bd",
          shadow: "0 24px 60px rgba(0,0,0,0.65), 0 0 0 1px rgba(242,237,228,0.12)",
          activeTabBg: "#f2ede4",
          activeTabText: "#0d0d0d",
        };
      }
      return {
        bg: "#f4f1ec",
        border: "rgba(10, 10, 10, 0.12)",
        text: "#0a0a0a",
        subtext: "#8a8378",
        cardBg: "#ffffff",
        inputBg: "#efeae2",
        inputBorder: "rgba(10, 10, 10, 0.14)",
        accent: "#b8410e",
        accentBg: "rgba(184, 65, 14, 0.12)",
        primaryBtnBg: "#0a0a0a",
        primaryBtnText: "#f4f1ec",
        secondaryBtnBg: "#efeae2",
        secondaryBtnText: "#3a3a3a",
        shadow: "0 24px 60px rgba(0,0,0,0.18), 0 0 0 1px rgba(10,10,10,0.08)",
        activeTabBg: "#0a0a0a",
        activeTabText: "#f4f1ec",
      };
    }

    panel.style.cssText =
      "position:fixed;right:20px;bottom:20px;width:340px;max-height:86vh;overflow-y:auto;" +
      "border-radius:14px;z-index:2147483647;padding:16px;font:12px/1.45 'Inter',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;" +
      "box-sizing:border-box;display:flex;flex-direction:column;gap:12px;transition:all 0.2s ease;isolation:isolate !important;";

    let selectedPresetId = null;

    function renderPanelContent() {
      const isDark = currentStudioTheme === "dark";
      const t = getThemeStyles(isDark);

      panel.style.setProperty("background", t.bg, "important");
      panel.style.setProperty("background-color", t.bg, "important");
      panel.style.setProperty("color", t.text, "important");
      panel.style.setProperty("border", `1px solid ${t.border}`, "important");
      panel.style.setProperty("box-shadow", t.shadow, "important");
      panel.style.setProperty("opacity", "1", "important");
      panel.style.setProperty("visibility", "visible", "important");

      const bgHex = toHexColor(existingStyles.backgroundColor, isDark ? "#27272a" : t.accent);
      const colorHex = toHexColor(existingStyles.color, isDark ? "#f2ede4" : "#0a0a0a");
      const borderHex = toHexColor(existingStyles.border, t.accent);
      const shadowHex = toHexColor(existingStyles.boxShadow, t.accent);

      const matchCountAll = safeQueryAll(getBroadElementSelector(el)).length;
      const currentMatchCount = safeQueryAll(selector).length;

      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid ${t.border};">
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span style="font-family:'Playfair Display',Georgia,serif;font-weight:900;font-size:15px;letter-spacing:0.01em;color:${t.text};">
              Redesign <em style="font-style:italic;font-weight:400;color:${t.accent};">Studio</em>
            </span>
            <span style="font-size:9px;letter-spacing:0.18em;text-transform:uppercase;color:${t.subtext};font-weight:600;">Atelier</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button id="os-rd-theme-toggle" type="button" title="Toggle Light/Dark Theme" style="background:${t.cardBg};border:1px solid ${t.border};color:${t.text};border-radius:20px;padding:3px 9px;font-size:9.5px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:4px;letter-spacing:0.06em;text-transform:uppercase;">
              ${isDark ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button id="os-rd-close" type="button" style="background:transparent;border:0;color:${t.subtext};font-size:18px;cursor:pointer;line-height:1;padding:2px 4px;">&times;</button>
          </div>
        </div>

        <div style="background:${t.accentBg};padding:7px 11px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid ${t.border};">
          <div style="display:flex;align-items:center;gap:6px;color:${t.accent};font-weight:700;font-size:10.5px;letter-spacing:0.04em;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${t.accent};box-shadow:0 0 6px ${t.accent};"></span>
            <span style="text-transform:uppercase;font-size:9.5px;letter-spacing:0.12em;">Live Canvas Active</span>
          </div>
          <span style="font-size:9px;color:${t.subtext};letter-spacing:0.04em;">Auto-applying live</span>
        </div>

        <div style="background:${t.cardBg};padding:9px 10px;border-radius:8px;display:flex;flex-direction:column;gap:7px;border:1px solid ${t.border};">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <span style="font-weight:700;font-size:9.5px;text-transform:uppercase;letter-spacing:0.12em;color:${t.subtext};">Apply Redesign To:</span>
            <span id="os-rd-scope-badge" style="font-size:9.5px;font-weight:700;color:${!isGlobalScope ? "#10b981" : t.accent};background:${!isGlobalScope ? "rgba(16,185,129,0.12)" : t.accentBg};padding:2px 7px;border-radius:4px;">
              ${!isGlobalScope ? "🎯 1 element" : `🌐 ${currentMatchCount} elements`}
            </span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;background:${t.inputBg};padding:3px;border-radius:7px;border:1px solid ${t.inputBorder};">
            <button id="os-rd-scope-single" type="button" style="padding:6px 6px;font-size:10px;font-weight:700;border-radius:5px;border:0;cursor:pointer;background:${!isGlobalScope ? t.primaryBtnBg : "transparent"};color:${!isGlobalScope ? t.primaryBtnText : t.subtext};transition:all 0.15s ease;display:flex;align-items:center;justify-content:center;gap:4px;letter-spacing:0.04em;">
              🎯 This Element Only
            </button>
            <button id="os-rd-scope-all" type="button" style="padding:6px 6px;font-size:10px;font-weight:700;border-radius:5px;border:0;cursor:pointer;background:${isGlobalScope ? t.primaryBtnBg : "transparent"};color:${isGlobalScope ? t.primaryBtnText : t.subtext};transition:all 0.15s ease;display:flex;align-items:center;justify-content:center;gap:4px;letter-spacing:0.04em;">
              🌐 All Matching (${matchCountAll})
            </button>
          </div>
        </div>

        <div style="display:flex;background:${t.cardBg};padding:3px;border-radius:8px;gap:3px;border:1px solid ${t.border};">
          <button id="os-rd-tab-visual" type="button" style="flex:1;padding:6px 6px;font-size:9.5px;font-weight:700;border-radius:6px;border:0;cursor:pointer;background:${t.activeTabBg};color:${t.activeTabText};letter-spacing:0.12em;text-transform:uppercase;">Visual</button>
          <button id="os-rd-tab-presets" type="button" style="flex:1.2;padding:6px 6px;font-size:9.5px;font-weight:700;border-radius:6px;border:0;cursor:pointer;background:transparent;color:${t.subtext};letter-spacing:0.12em;text-transform:uppercase;">✨ Presets</button>
          <button id="os-rd-tab-code" type="button" style="flex:1;padding:6px 6px;font-size:9.5px;font-weight:700;border-radius:6px;border:0;cursor:pointer;background:transparent;color:${t.subtext};letter-spacing:0.12em;text-transform:uppercase;">Code</button>
        </div>

        <div id="os-rd-presets-section" style="display:none;flex-direction:column;gap:8px;max-height:48vh;overflow-y:auto;padding-right:2px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <select id="os-rd-preset-cat-filter" style="background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:4px 6px;border-radius:6px;font-size:10px;outline:none;">
              <option value="all">All Categories</option>
              <option value="background">Backgrounds</option>
              <option value="community">🌐 Community</option>
            </select>
            <select id="os-rd-preset-theme-filter" style="background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:4px 6px;border-radius:6px;font-size:10px;outline:none;">
              <option value="all">All Themes</option>
            </select>
          </div>
          <div id="os-rd-presets-list" style="display:flex;flex-direction:column;gap:6px;"></div>
        </div>

        <div id="os-rd-visual-section" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Name</label>
            <input type="text" id="os-rd-name" value="${existingName}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Background</label>
              <div style="display:flex;align-items:center;gap:5px;">
                <div style="position:relative;width:26px;height:26px;flex-shrink:0;border-radius:6px;border:1px solid ${t.inputBorder};background:${bgHex};overflow:hidden;cursor:pointer;" title="Pick Background Color">
                  <input type="color" id="os-rd-bg-picker" value="${bgHex}" style="position:absolute;top:-8px;left:-8px;width:44px;height:44px;opacity:0;cursor:pointer;">
                </div>
                <input type="text" id="os-rd-bg" placeholder="#1e1b4b or transparent" value="${existingStyles.backgroundColor || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 7px;border-radius:7px;font-size:11px;outline:none;">
              </div>
            </div>
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Text Color</label>
              <div style="display:flex;align-items:center;gap:5px;">
                <div style="position:relative;width:26px;height:26px;flex-shrink:0;border-radius:6px;border:1px solid ${t.inputBorder};background:${colorHex};overflow:hidden;cursor:pointer;" title="Pick Text Color">
                  <input type="color" id="os-rd-color-picker" value="${colorHex}" style="position:absolute;top:-8px;left:-8px;width:44px;height:44px;opacity:0;cursor:pointer;">
                </div>
                <input type="text" id="os-rd-color" placeholder="#ffffff" value="${existingStyles.color || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 7px;border-radius:7px;font-size:11px;outline:none;">
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Border</label>
              <div style="display:flex;align-items:center;gap:5px;">
                <div style="position:relative;width:26px;height:26px;flex-shrink:0;border-radius:6px;border:1px solid ${t.inputBorder};background:${borderHex};overflow:hidden;cursor:pointer;" title="Pick Border Color">
                  <input type="color" id="os-rd-border-picker" value="${borderHex}" style="position:absolute;top:-8px;left:-8px;width:44px;height:44px;opacity:0;cursor:pointer;">
                </div>
                <input type="text" id="os-rd-border" placeholder="1px solid #6366f1" value="${existingStyles.border || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 7px;border-radius:7px;font-size:11px;outline:none;">
              </div>
            </div>
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Radius</label>
              <input type="text" id="os-rd-radius" placeholder="8px or 9999px" value="${existingStyles.borderRadius || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
          </div>

          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Shadow / Glow</label>
            <div style="display:flex;align-items:center;gap:5px;">
              <div style="position:relative;width:26px;height:26px;flex-shrink:0;border-radius:6px;border:1px solid ${t.inputBorder};background:${shadowHex};overflow:hidden;cursor:pointer;" title="Pick Glow / Shadow Color">
                <input type="color" id="os-rd-shadow-picker" value="${shadowHex}" style="position:absolute;top:-8px;left:-8px;width:44px;height:44px;opacity:0;cursor:pointer;">
              </div>
              <input type="text" id="os-rd-shadow" placeholder="0 8px 24px rgba(0,0,0,0.12)" value="${existingStyles.boxShadow || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
          </div>
        </div>

        <div id="os-rd-code-section" style="display:none;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Custom CSS (Live)</label>
            <textarea id="os-rd-css" rows="3" placeholder="opacity: 0.9; transform: scale(1.02);" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;outline:none;resize:vertical;">${existingCss}</textarea>
          </div>

          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Custom HTML / Markup</label>
            <textarea id="os-rd-html" rows="2" placeholder="Optional HTML replacement" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;outline:none;resize:vertical;">${existingHtml}</textarea>
          </div>

          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Custom JavaScript</label>
            <textarea id="os-rd-js" rows="2" placeholder="// element is the DOM node" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-family:JetBrains Mono,ui-monospace,monospace;font-size:11px;outline:none;resize:vertical;">${existingJs}</textarea>
          </div>
        </div>

        <div style="display:flex;gap:6px;border-top:1px solid ${t.border};padding-top:12px;margin-top:4px;">
          <button id="os-rd-save" type="button" title="Apply to this element and save to cloud" style="flex:1.2;background:${t.primaryBtnBg};color:${t.primaryBtnText};border:0;padding:9px 10px;border-radius:7px;cursor:pointer;font-weight:700;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;transition:all 0.15s ease;">
            ✓ Apply & Save
          </button>
          <button id="os-rd-publish-community" type="button" title="Publish this preset to Firestore so other extension users can discover and apply it" style="flex:1.4;background:${t.accent};color:#ffffff;border:0;padding:9px 10px;border-radius:7px;cursor:pointer;font-weight:700;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;transition:all 0.15s ease;">
            🌐 Share Community
          </button>
          <button id="os-rd-cancel" type="button" style="flex:0.8;background:${t.secondaryBtnBg};color:${t.secondaryBtnText};border:1px solid ${t.border};padding:9px 8px;border-radius:7px;cursor:pointer;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;transition:all 0.15s ease;">
            Cancel
          </button>
        </div>
      `;

      // Setup tab switching (Visual, Presets, Custom Code)
      const tabVisual = panel.querySelector("#os-rd-tab-visual");
      const tabPresets = panel.querySelector("#os-rd-tab-presets");
      const tabCode = panel.querySelector("#os-rd-tab-code");
      const visualSection = panel.querySelector("#os-rd-visual-section");
      const presetsSection = panel.querySelector("#os-rd-presets-section");
      const codeSection = panel.querySelector("#os-rd-code-section");
      let activeTabName = "visual";

      function updateFooterButtons() {
        const isPreset = Boolean(selectedPresetId && activeTabName === "presets");
        const publishBtn = panel.querySelector("#os-rd-publish-community");
        const saveBtn = panel.querySelector("#os-rd-save");
        if (publishBtn && saveBtn) {
          if (isPreset) {
            publishBtn.style.display = "none";
            saveBtn.style.flex = "2";
          } else {
            publishBtn.style.display = "block";
            publishBtn.style.flex = "1.4";
            saveBtn.style.flex = "1.2";
          }
        }
      }

      function switchTab(activeTab, activeSection) {
        [tabVisual, tabPresets, tabCode].forEach((tBtn) => {
          tBtn.style.background = "transparent";
          tBtn.style.color = t.subtext;
          tBtn.style.boxShadow = "none";
        });
        [visualSection, presetsSection, codeSection].forEach((sec) => {
          sec.style.display = "none";
        });
        activeTab.style.background = t.activeTabBg;
        activeTab.style.color = t.activeTabText;
        activeTab.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        activeSection.style.display = "flex";
      }

      tabVisual.addEventListener("click", () => {
        activeTabName = "visual";
        switchTab(tabVisual, visualSection);
        updateFooterButtons();
      });
      tabPresets.addEventListener("click", () => {
        activeTabName = "presets";
        switchTab(tabPresets, presetsSection);
        renderPresetsList();
        updateFooterButtons();
        setTimeout(scrollToActivePreset, 60);
      });
      tabCode.addEventListener("click", () => {
        activeTabName = "code";
        switchTab(tabCode, codeSection);
        updateFooterButtons();
      });

      function scrollToActivePreset() {
        const listContainer = panel.querySelector("#os-rd-presets-list");
        if (!listContainer) return;
        const activeItem = listContainer.querySelector("[data-preset-active='true']");
        if (activeItem) {
          activeItem.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      }

      // Preset category detection & filtering
      const catFilter = panel.querySelector("#os-rd-preset-cat-filter");
      const themeFilter = panel.querySelector("#os-rd-preset-theme-filter");

      if (catFilter) {
        catFilter.value = "all";
      }

      catFilter?.addEventListener("change", () => {
        renderPresetsList();
        setTimeout(scrollToActivePreset, 40);
      });
      themeFilter?.addEventListener("change", () => {
        renderPresetsList();
        setTimeout(scrollToActivePreset, 40);
      });

      let cachedAllPresets = null;
      let cachedPresetsTime = 0;

      async function loadAllPresets() {
        const now = Date.now();
        if (Array.isArray(cachedAllPresets) && cachedAllPresets.length > 0 && now - cachedPresetsTime < 8000) {
          return cachedAllPresets;
        }

        // 1. Fetch Community Presets from Firestore via Background Service Worker
        let communityPresets = [];
        try {
          const res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "LIST_COMMUNITY_PRESETS" }, (r) => resolve(r));
          });
          if (res && res.ok && Array.isArray(res.items) && res.items.length) {
            communityPresets = res.items;
          }
        } catch (e) {}

        // 2. Built-in Seed Presets from Local JSON (fallback / merge)
        let seedPresets = [];
        try {
          const url = chrome.runtime.getURL("modules/redesign-presets.json");
          const res = await fetch(url);
          if (res.ok) {
            seedPresets = (await res.json()) || [];
          }
        } catch (e) {}

        if (!seedPresets.length) {
          seedPresets = (typeof REDESIGN_PRESETS !== "undefined" ? REDESIGN_PRESETS : null) ||
                        (typeof window !== "undefined" && window.REDESIGN_PRESETS) || [];
        }

        // 3. Merge idempotently without duplicates
        const presetMap = new Map();
        seedPresets.forEach((p) => {
          if (p && p.id) {
            presetMap.set(p.id, { ...p, isBuiltIn: true });
          }
        });
        communityPresets.forEach((p) => {
          if (p && p.id) {
            presetMap.set(p.id, { ...p });
          }
        });

        cachedAllPresets = Array.from(presetMap.values());
        cachedPresetsTime = now;
        return cachedAllPresets;
      }

      async function renderPresetsList() {
        const listContainer = panel.querySelector("#os-rd-presets-list");
        if (!listContainer) return;
        listContainer.innerHTML = `<div style="padding:14px;text-align:center;color:${t.subtext};font-size:10.5px;">Loading presets from Firestore…</div>`;
        const allPresets = await loadAllPresets();

        // Update Presets tab title with true live count
        const tabPresetsBtn = panel.querySelector("#os-rd-tab-presets");
        if (tabPresetsBtn) {
          tabPresetsBtn.textContent = `✨ Presets (${allPresets.length})`;
        }

        // Dynamically update category options with real counts
        if (catFilter) {
          const currentCat = catFilter.value || "all";
          const bgCount = allPresets.filter((p) => p.category === "background").length;
          const communityCount = allPresets.filter((p) => p.isCommunity).length;
          const customCount = allPresets.filter((p) => p.category !== "background" && !p.isCommunity).length;

          let catHtml = `<option value="all">All Categories (${allPresets.length})</option>`;
          if (bgCount > 0) catHtml += `<option value="background">Backgrounds (${bgCount})</option>`;
          if (communityCount > 0) catHtml += `<option value="community">🌐 Community (${communityCount})</option>`;
          if (customCount > 0) catHtml += `<option value="custom">Elements (${customCount})</option>`;
          catFilter.innerHTML = catHtml;
          catFilter.value = currentCat;
        }

        // Dynamically update theme options with real counts
        if (themeFilter) {
          const currentTheme = themeFilter.value || "all";
          const themes = new Set(allPresets.map((p) => (p.theme || "").split("/")[0].trim()).filter(Boolean));
          let themeHtml = `<option value="all">All Themes (${allPresets.length})</option>`;
          themes.forEach((th) => {
            const count = allPresets.filter((p) => (p.theme || "").toLowerCase().includes(th.toLowerCase())).length;
            themeHtml += `<option value="${th}">${th} (${count})</option>`;
          });
          themeFilter.innerHTML = themeHtml;
          themeFilter.value = currentTheme;
        }

        const selectedCat = catFilter ? catFilter.value : "all";
        const selectedTheme = themeFilter ? themeFilter.value : "all";

        const filtered = allPresets.filter((p) => {
          const matchCat = selectedCat === "all" || p.category === selectedCat || (selectedCat === "community" && p.isCommunity);
          const matchTheme = selectedTheme === "all" || (p.theme && p.theme.toLowerCase().includes(selectedTheme.toLowerCase()));
          return matchCat && matchTheme;
        });

        if (!filtered.length) {
          listContainer.innerHTML = `<div style="padding:16px;text-align:center;color:${t.subtext};font-size:11px;">No presets found matching filters.</div>`;
          return;
        }

        const savedScroll = presetsSection ? presetsSection.scrollTop : 0;
        listContainer.innerHTML = "";
        filtered.forEach((p) => {
          const isSelected = p.id === selectedPresetId;
          const item = document.createElement("div");
          item.dataset.presetCard = "true";
          item.dataset.presetId = p.id;
          item.dataset.presetName = p.name;
          if (isSelected) {
            item.dataset.presetActive = "true";
          }

          const bgPreview = p.styles?.backgroundColor || "transparent";
          const borderPreview = p.styles?.border || "1px solid rgba(0,0,0,0.1)";
          const colorPreview = p.styles?.color || "#ffffff";

          const activeBorder = isSelected ? t.accent : t.border;
          const activeBg = isSelected ? t.accentBg : t.cardBg;
          const activeShadow = isSelected ? `0 0 14px ${t.accent}44` : "none";

          item.style.cssText =
            `background:${activeBg};border:1.5px solid ${activeBorder};border-radius:8px;padding:9px 11px;` +
            `cursor:pointer;display:flex;flex-direction:column;gap:5px;transition:all 0.15s ease;box-shadow:${activeShadow};`;

          const communityTag = p.isCommunity
            ? `<span style="font-size:8px;padding:1px 5px;border-radius:3px;background:rgba(184,65,14,0.18);color:${t.accent};font-weight:700;">🌐 Community</span>`
            : "";

          item.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <div class="os-preset-title" style="font-weight:700;font-size:11px;color:${isSelected ? t.accent : t.text};display:flex;align-items:center;gap:4px;">
                ${isSelected ? "✓ " : ""}${p.name}
              </div>
              <div style="display:flex;align-items:center;gap:4px;">
                ${communityTag}
                <span style="font-size:8.5px;padding:2px 5px;border-radius:4px;background:${t.inputBg};color:${t.subtext};font-weight:600;white-space:nowrap;border:1px solid ${t.border};">${(p.theme || "Preset").split('/')[0].trim()}</span>
              </div>
            </div>
            <div style="font-size:9.5px;color:${t.subtext};line-height:1.35;">${p.description || "Interactive preset restyling"}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:3px;">
              <div style="display:flex;align-items:center;gap:5px;">
                <span style="width:12px;height:12px;border-radius:3px;background:${bgPreview};border:${borderPreview};" title="Background preview"></span>
                <span style="width:12px;height:12px;border-radius:50%;background:${colorPreview};border:1px solid rgba(0,0,0,0.1);" title="Text color"></span>
                <span style="font-size:9px;color:${t.subtext};text-transform:capitalize;">${p.category || "custom"}</span>
              </div>
              <button type="button" class="os-preset-btn" style="background:${isSelected ? t.accent : t.primaryBtnBg};color:${isSelected ? '#ffffff' : t.primaryBtnText};border:0;border-radius:4px;padding:3px 9px;font-size:9.5px;font-weight:700;cursor:pointer;letter-spacing:0.04em;">
                ${isSelected ? "✓ Previewing" : "Preview"}
              </button>
            </div>
          `;

          // Live preview on hover before clicking
          item.addEventListener("pointerenter", () => {
            if (selectedPresetId !== p.id) {
              item.style.borderColor = t.accent;
              item.style.transform = "translateY(-1px)";
              applyLivePreview(el, { styles: p.styles, cssText: p.cssText, html: p.html, js: p.js, engineId: p.engineId });
            }
          });

          // Restore active preset preview on mouse leave
          item.addEventListener("pointerleave", () => {
            if (selectedPresetId !== p.id) {
              item.style.borderColor = t.border;
              item.style.transform = "none";
              updateLivePreview();
            }
          });

          // Select and lock in preset on click WITHOUT reloading list or resetting scroll!
          item.addEventListener("click", () => {
            selectedPresetId = p.id;
            applyPresetValues(p);

            // Update all cards in-place: scroll position stays completely stationary!
            const allCards = listContainer.querySelectorAll("[data-preset-card]");
            allCards.forEach((card) => {
              const cardId = card.dataset.presetId;
              const isNowActive = cardId === p.id;
              card.dataset.presetActive = isNowActive ? "true" : "false";

              card.style.borderColor = isNowActive ? t.accent : t.border;
              card.style.background = isNowActive ? t.accentBg : t.cardBg;
              card.style.boxShadow = isNowActive ? `0 0 14px ${t.accent}44` : "none";

              const titleEl = card.querySelector(".os-preset-title");
              if (titleEl) {
                const name = card.dataset.presetName || "";
                titleEl.textContent = isNowActive ? `✓ ${name}` : name;
                titleEl.style.color = isNowActive ? t.accent : t.text;
              }

              const btnEl = card.querySelector(".os-preset-btn");
              if (btnEl) {
                btnEl.textContent = isNowActive ? "✓ Previewing" : "Preview";
                btnEl.style.background = isNowActive ? t.accent : t.primaryBtnBg;
                btnEl.style.color = isNowActive ? "#ffffff" : t.primaryBtnText;
              }
            });

            updateFooterButtons();
            updateLivePreview();
          });

          listContainer.appendChild(item);
        });

        if (presetsSection && savedScroll > 0) {
          presetsSection.scrollTop = savedScroll;
        }
      }

      function applyPresetValues(preset) {
        if (!preset) return;
        activePreset = preset;
        currentEngineId = preset.engineId || null;
        const nameInput = panel.querySelector("#os-rd-name");
        const bgInput = panel.querySelector("#os-rd-bg");
        const colorInput = panel.querySelector("#os-rd-color");
        const borderInput = panel.querySelector("#os-rd-border");
        const radiusInput = panel.querySelector("#os-rd-radius");
        const shadowInput = panel.querySelector("#os-rd-shadow");
        const cssInput = panel.querySelector("#os-rd-css");
        const htmlInput = panel.querySelector("#os-rd-html");
        const jsInput = panel.querySelector("#os-rd-js");

        if (nameInput) nameInput.value = preset.name;
        if (bgInput) bgInput.value = preset.styles?.backgroundColor || "";
        if (colorInput) colorInput.value = preset.styles?.color || "";
        if (borderInput) borderInput.value = preset.styles?.border || "";
        if (radiusInput) radiusInput.value = preset.styles?.borderRadius || "";
        if (shadowInput) shadowInput.value = preset.styles?.boxShadow || "";
        if (cssInput) cssInput.value = preset.cssText || "";
        if (htmlInput) htmlInput.value = preset.html || "";
        if (jsInput) jsInput.value = preset.js || "";

        // Sync color pickers
        const bgPicker = panel.querySelector("#os-rd-bg-picker");
        if (bgPicker && preset.styles?.backgroundColor) {
          const hex = toHexColor(preset.styles.backgroundColor, null);
          if (hex) {
            bgPicker.value = hex;
            bgPicker.parentElement.style.background = hex;
          }
        }
        const colorPicker = panel.querySelector("#os-rd-color-picker");
        if (colorPicker && preset.styles?.color) {
          const hex = toHexColor(preset.styles.color, null);
          if (hex) {
            colorPicker.value = hex;
            colorPicker.parentElement.style.background = hex;
          }
        }
        const borderPicker = panel.querySelector("#os-rd-border-picker");
        if (borderPicker && preset.styles?.border) {
          const hex = toHexColor(preset.styles.border, null);
          if (hex) {
            borderPicker.value = hex;
            borderPicker.parentElement.style.background = hex;
          }
        }
        const shadowPicker = panel.querySelector("#os-rd-shadow-picker");
        if (shadowPicker && preset.styles?.boxShadow) {
          const hex = toHexColor(preset.styles.boxShadow, null);
          if (hex) {
            shadowPicker.value = hex;
            shadowPicker.parentElement.style.background = hex;
          }
        }

        // Live preview immediately
        updateLivePreview();
      }

      // Setup theme toggle
      panel.querySelector("#os-rd-theme-toggle").addEventListener("click", () => {
        currentStudioTheme = currentStudioTheme === "dark" ? "light" : "dark";
        renderPanelContent();
      });

      // Scope Segmented Buttons Listener
      const scopeSingleBtn = panel.querySelector("#os-rd-scope-single");
      const scopeAllBtn = panel.querySelector("#os-rd-scope-all");
      if (scopeSingleBtn && scopeAllBtn) {
        scopeSingleBtn.addEventListener("click", () => {
          if (!isGlobalScope) return;
          clearLivePreview(el);
          isGlobalScope = false;
          selector = getUniqueElementSelector(el);
          renderPanelContent();
          updateLivePreview();
        });
        scopeAllBtn.addEventListener("click", () => {
          if (isGlobalScope) return;
          clearLivePreview(el);
          isGlobalScope = true;
          selector = getBroadElementSelector(el);
          renderPanelContent();
          updateLivePreview();
        });
      }

      // Color pickers sync
      const bgPicker = panel.querySelector("#os-rd-bg-picker");
      const bgInput = panel.querySelector("#os-rd-bg");
      if (bgPicker && bgInput) {
        bgPicker.addEventListener("input", () => {
          bgInput.value = bgPicker.value;
          bgPicker.parentElement.style.background = bgPicker.value;
          updateLivePreview();
        });
        bgInput.addEventListener("input", () => {
          if (bgInput.value.trim()) {
            const hex = toHexColor(bgInput.value.trim(), null);
            if (hex) {
              bgPicker.value = hex;
              bgPicker.parentElement.style.background = hex;
            }
          }
          updateLivePreview();
        });
      }

      const colorPicker = panel.querySelector("#os-rd-color-picker");
      const colorInput = panel.querySelector("#os-rd-color");
      if (colorPicker && colorInput) {
        colorPicker.addEventListener("input", () => {
          colorInput.value = colorPicker.value;
          colorPicker.parentElement.style.background = colorPicker.value;
          updateLivePreview();
        });
        colorInput.addEventListener("input", () => {
          if (colorInput.value.trim()) {
            const hex = toHexColor(colorInput.value.trim(), null);
            if (hex) {
              colorPicker.value = hex;
              colorPicker.parentElement.style.background = hex;
            }
          }
          updateLivePreview();
        });
      }

      const borderPicker = panel.querySelector("#os-rd-border-picker");
      const borderInput = panel.querySelector("#os-rd-border");
      if (borderPicker && borderInput) {
        borderPicker.addEventListener("input", () => {
          const val = borderInput.value.trim();
          if (val && /\d+px\s+\w+/.test(val)) {
            borderInput.value = val.replace(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|\w+$/, borderPicker.value);
          } else {
            borderInput.value = `1px solid ${borderPicker.value}`;
          }
          borderPicker.parentElement.style.background = borderPicker.value;
          updateLivePreview();
        });
        borderInput.addEventListener("input", () => {
          if (borderInput.value.trim()) {
            const hex = toHexColor(borderInput.value.trim(), null);
            if (hex) {
              borderPicker.value = hex;
              borderPicker.parentElement.style.background = hex;
            }
          }
          updateLivePreview();
        });
      }

      const shadowPicker = panel.querySelector("#os-rd-shadow-picker");
      const shadowInput = panel.querySelector("#os-rd-shadow");
      if (shadowPicker && shadowInput) {
        shadowPicker.addEventListener("input", () => {
          const val = shadowInput.value.trim();
          if (val && /\d+px/.test(val)) {
            shadowInput.value = val.replace(/#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|\w+$/, shadowPicker.value);
          } else {
            shadowInput.value = `0 8px 24px ${shadowPicker.value}`;
          }
          shadowPicker.parentElement.style.background = shadowPicker.value;
          updateLivePreview();
        });
        shadowInput.addEventListener("input", () => {
          if (shadowInput.value.trim()) {
            const hex = toHexColor(shadowInput.value.trim(), null);
            if (hex) {
              shadowPicker.value = hex;
              shadowPicker.parentElement.style.background = hex;
            }
          }
          updateLivePreview();
        });
      }

      // Attach live input listeners for real-time preview (input & change)
      ["#os-rd-bg", "#os-rd-color", "#os-rd-border", "#os-rd-radius", "#os-rd-shadow", "#os-rd-css", "#os-rd-html", "#os-rd-js"].forEach((id) => {
        const elInput = panel.querySelector(id);
        if (elInput) {
          elInput.addEventListener("input", () => {
            selectedPresetId = null;
            activePreset = null;
            updateFooterButtons();
            updateLivePreview();
          });
          elInput.addEventListener("change", () => {
            selectedPresetId = null;
            activePreset = null;
            updateFooterButtons();
            updateLivePreview();
          });
        }
      });

      // Close & Cancel
      panel.querySelector("#os-rd-close").addEventListener("click", closeAndRevert);
      panel.querySelector("#os-rd-cancel").addEventListener("click", closeAndRevert);

      // Save Local
      panel.querySelector("#os-rd-save").addEventListener("click", () => handleSave(false));

      // Publish / Share to Community Firestore
      panel.querySelector("#os-rd-publish-community")?.addEventListener("click", () => handleSave(true));
    }

    function updateLivePreview() {
      const bg = panel.querySelector("#os-rd-bg")?.value.trim() || "";
      const color = panel.querySelector("#os-rd-color")?.value.trim() || "";
      const border = panel.querySelector("#os-rd-border")?.value.trim() || "";
      const borderRadius = panel.querySelector("#os-rd-radius")?.value.trim() || "";
      const shadow = panel.querySelector("#os-rd-shadow")?.value.trim() || "";
      const cssText = panel.querySelector("#os-rd-css")?.value || "";
      const html = panel.querySelector("#os-rd-html")?.value || "";
      const js = panel.querySelector("#os-rd-js")?.value || "";

      // Preserve all preset styles (e.g. backgroundImage, fontFamily, letterSpacing, backgroundSize)
      const styles = { ...(activePreset?.styles || {}) };
      if (bg) styles.backgroundColor = bg;
      if (color) styles.color = color;
      if (border) styles.border = border;
      if (borderRadius) styles.borderRadius = borderRadius;
      if (shadow) styles.boxShadow = shadow;

      // Effective cssText
      const effectiveCss = cssText || activePreset?.cssText || "";

      applyLivePreview(el, { styles, cssText: sanitizeCss(effectiveCss), html, js, engineId: currentEngineId });
    }

    function closeAndRevert() {
      clearLivePreview(el);
      if (existingEntry && existingEntry.enabled !== false) {
        applyRedesignEntry(existingEntry);
      }
      panel.remove();
    }

    async function handleSave(publishToCommunity = false) {
      const saveBtn = panel.querySelector("#os-rd-save");
      const publishBtn = panel.querySelector("#os-rd-publish-community");
      if (saveBtn) saveBtn.disabled = true;
      if (publishBtn) {
        publishBtn.disabled = true;
        publishBtn.textContent = publishToCommunity ? "Publishing…" : "Saving…";
      }

      const name = panel.querySelector("#os-rd-name")?.value.trim() || `${tagName} redesign`;
      const bg = panel.querySelector("#os-rd-bg")?.value.trim() || "";
      const color = panel.querySelector("#os-rd-color")?.value.trim() || "";
      const border = panel.querySelector("#os-rd-border")?.value.trim() || "";
      const borderRadius = panel.querySelector("#os-rd-radius")?.value.trim() || "";
      const shadow = panel.querySelector("#os-rd-shadow")?.value.trim() || "";
      const cssText = sanitizeCss(panel.querySelector("#os-rd-css")?.value.trim() || "");
      const html = panel.querySelector("#os-rd-html")?.value || "";
      const js = panel.querySelector("#os-rd-js")?.value || "";

      const styles = { ...(activePreset?.styles || {}) };
      if (bg) styles.backgroundColor = bg;
      if (color) styles.color = color;
      if (border) styles.border = border;
      if (borderRadius) styles.borderRadius = borderRadius;
      if (shadow) styles.boxShadow = shadow;

      const effectiveCss = cssText || activePreset?.cssText || "";

      const pushId = existingEntry?.pushId || existingEntry?.id || "rd_" + Date.now().toString(36);
      const entry = {
        id: pushId,
        pushId,
        selector,
        name,
        enabled: true,
        visibility: "shared",
        scope: isGlobalScope ? "global" : "page",
        pageUrl: location.pathname,
        styles,
        cssText,
        html,
        js,
        engineId: currentEngineId || undefined,
        updatedAt: new Date().toISOString(),
      };

      clearLivePreview(el);
      applyRedesignEntry(entry);
      await saveRedesignLocally(entry);

      // Save domain redesign
      chrome.runtime.sendMessage(
        { type: "SAVE_REDESIGN", domain: getDomainKey(), entry },
        (res) => {
          if (res && res.ok && res.pushId && res.pushId !== pushId) {
            entry.pushId = res.pushId;
            entry.id = res.pushId;
            saveRedesignLocally(entry);
            applyRedesignEntry(entry);
          }
        }
      );

      // If user chose to publish as a Community Preset in Firestore
      if (publishToCommunity) {
        const presetPayload = {
          id: "community_" + pushId,
          name,
          category: tagName === "body" || tagName === "html" ? "background" : tagName,
          theme: "Community / Custom",
          description: `Custom ${tagName} redesign created on ${getDomainKey()}`,
          engineId: currentEngineId || null,
          styles,
          cssText,
          scope: isGlobalScope ? "global" : "page",
        };
        chrome.runtime.sendMessage({ type: "SAVE_COMMUNITY_PRESET", preset: presetPayload });
      }

      panel.remove();
    }

    document.body.appendChild(panel);
    renderPanelContent();
    updateLivePreview();
  }

  // ---- Local Storage CRUD ----
  async function getLocalRedesigns() {
    const key = getStorageKey();
    const store = await chrome.storage.local.get(key);
    return Array.isArray(store[key]) ? store[key] : [];
  }

  async function saveRedesignLocally(entry) {
    const list = await getLocalRedesigns();
    const idx = list.findIndex((x) => x.id === entry.id || x.pushId === entry.pushId || x.selector === entry.selector);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...entry };
    } else {
      list.push(entry);
    }
    const key = getStorageKey();
    await chrome.storage.local.set({ [key]: list });
    activeRedesignEntries = list;
    checkActiveBgPassthrough();
  }

  async function deleteRedesignLocally(idOrSelector) {
    const list = await getLocalRedesigns();
    const entry = list.find((x) => x.id === idOrSelector || x.pushId === idOrSelector || x.selector === idOrSelector);
    if (entry) {
      unapplyRedesignEntry(entry);
    }
    const updated = list.filter((x) => x.id !== idOrSelector && x.pushId !== idOrSelector && x.selector !== idOrSelector);
    const key = getStorageKey();
    await chrome.storage.local.set({ [key]: updated });
    activeRedesignEntries = updated;
    checkActiveBgPassthrough();
    return entry;
  }

  async function toggleRedesignLocally(idOrSelector, enabled) {
    const list = await getLocalRedesigns();
    const entry = list.find((x) => x.id === idOrSelector || x.pushId === idOrSelector || x.selector === idOrSelector);
    if (entry) {
      entry.enabled = enabled;
      const key = getStorageKey();
      await chrome.storage.local.set({ [key]: list });
      activeRedesignEntries = list;
      if (enabled) {
        applyRedesignEntry(entry);
      } else {
        unapplyRedesignEntry(entry);
      }
      return entry;
    }
    return null;
  }

  // ---- Continuous Persistent Mutation Watcher (Survives React / SPA Re-renders) ----
  let domWatcherStarted = false;
  function startDomWatcher() {
    if (domWatcherStarted || typeof MutationObserver === "undefined") return;
    domWatcherStarted = true;

    let timeout = null;
    const observer = new MutationObserver(() => {
      if (timeout) return;
      timeout = setTimeout(() => {
        timeout = null;
        if (activeRedesignEntries.length) {
          activeRedesignEntries.forEach((entry) => {
            if (entry.enabled !== false) {
              const styleId = APPLIED_STYLE_PREFIX + (entry.pushId || entry.id || "temp");
              // If style tag was wiped by SPA navigation, re-apply
              if (!document.getElementById(styleId)) {
                applyRedesignEntry(entry);
              } else if (entry.engineId && typeof InteractiveBackgrounds !== "undefined") {
                // Ensure native background canvas stays attached if React/Vue replaced the DOM node
                const targets = safeQueryAll(entry.selector);
                targets.forEach((el) => {
                  if (!el.querySelector(".imagine-interactive-canvas, .imagine-webgl-canvas")) {
                    InteractiveBackgrounds.mount(el, entry.engineId);
                  }
                });
              }
            }
          });
        }
      }, 250);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ---- Hidden Redesigns (Viewer-Only Local Hiding) ----
  async function getHiddenRedesignIds() {
    const key = `hiddenRedesigns_${getDomainKey()}`;
    const store = await chrome.storage.local.get(key);
    return Array.isArray(store[key]) ? store[key] : [];
  }

  async function setRedesignHidden(idOrPushId, hidden) {
    const key = `hiddenRedesigns_${getDomainKey()}`;
    const current = await getHiddenRedesignIds();
    const next = new Set(current);
    if (hidden) {
      next.add(idOrPushId);
    } else {
      next.delete(idOrPushId);
    }
    const arr = Array.from(next);
    await chrome.storage.local.set({ [key]: arr });

    // Instantly update live DOM state
    const list = await getLocalRedesigns();
    const entry = list.find((x) => x.id === idOrPushId || x.pushId === idOrPushId || x.selector === idOrPushId);
    if (entry) {
      if (hidden) {
        unapplyRedesignEntry(entry);
      } else {
        if (entry.enabled !== false) applyRedesignEntry(entry);
      }
    }
    checkActiveBgPassthrough();
    return arr;
  }

  // ---- Continuous Sync & Auto-Apply on Page Load ----
  async function syncDomainRedesigns() {
    chrome.runtime.sendMessage(
      { type: "GET_REDESIGNS_FOR_DOMAIN", domain: getDomainKey() },
      async (res) => {
        if (!res || !res.ok || !Array.isArray(res.items)) return;
        const dbItems = res.items;
        const currentList = await getLocalRedesigns();
        const hiddenIds = new Set(await getHiddenRedesignIds());

        // 1. Prune items that were deleted from the cloud database
        const dbPushIds = new Set(dbItems.map((d) => d.pushId || d.id));
        const prunedList = [];
        for (const localItem of currentList) {
          const pid = localItem.pushId || localItem.id;
          // If it was a cloud item (starts with rd_ or has pushId) and is no longer in dbItems:
          if (pid && !pid.startsWith("local_") && !dbPushIds.has(pid)) {
            // Deleted by creator in cloud! Instantly unapply from DOM
            unapplyRedesignEntry(localItem);
          } else {
            prunedList.push(localItem);
          }
        }

        // 2. Merge latest cloud items into pruned list
        const merged = [...prunedList];
        for (const item of dbItems) {
          const idx = merged.findIndex(
            (x) =>
              x.pushId === item.pushId ||
              x.id === item.pushId ||
              (x.selector === item.selector && x.scope === item.scope)
          );
          if (idx < 0) {
            merged.push({ ...item, id: item.pushId, enabled: true });
          } else {
            merged[idx] = { ...merged[idx], ...item, enabled: merged[idx].enabled !== false };
          }
        }

        const key = getStorageKey();
        await chrome.storage.local.set({ [key]: merged });
        activeRedesignEntries = merged;

        // 3. Apply active non-hidden redesigns; unapply hidden ones
        merged.forEach((entry) => {
          const pid = entry.pushId || entry.id;
          if (hiddenIds.has(pid)) {
            unapplyRedesignEntry(entry);
          } else if (entry.enabled !== false) {
            applyRedesignEntry(entry);
          }
        });
        checkActiveBgPassthrough();
      }
    );
  }

  async function init() {
    startDomWatcher();

    // 1. Read local storage first for instant synchronous paint
    const localEntries = await getLocalRedesigns();
    const hiddenIds = new Set(await getHiddenRedesignIds());
    if (localEntries.length) {
      activeRedesignEntries = localEntries;
      localEntries.forEach((entry) => {
        const pid = entry.pushId || entry.id;
        if (!hiddenIds.has(pid) && entry.enabled !== false) {
          applyRedesignEntry(entry);
        }
      });
      checkActiveBgPassthrough();
    }

    // 2. Sync from database (RTDB & Firestore)
    await syncDomainRedesigns();
  }

  // Live periodic polling for multi-user sync across different browsers & tabs (matches image binding architecture)
  setInterval(() => {
    if (typeof document !== "undefined" && !document.hidden) {
      syncDomainRedesigns();
    }
  }, 8000);

  if (typeof window !== "undefined") {
    window.addEventListener("focus", syncDomainRedesigns);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) syncDomainRedesigns();
    });
  }

  // Listen for messages from popup and background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_REDESIGN_PICKER") {
      startPicker((el) => openEditorPanel(el));
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_PAGE_REDESIGNS") {
      getLocalRedesigns().then(async (items) => {
        const hiddenIds = await getHiddenRedesignIds();
        sendResponse({ ok: true, items, domain: getDomainKey(), hiddenIds });
      });
      return true;
    }

    if (msg.type === "HIDE_PAGE_REDESIGN") {
      setRedesignHidden(msg.id, msg.hidden).then((hiddenIds) => {
        sendResponse({ ok: true, hiddenIds });
      });
      return true;
    }

    if (msg.type === "TOGGLE_PAGE_REDESIGN") {
      toggleRedesignLocally(msg.id, msg.enabled).then((entry) => {
        sendResponse({ ok: true, entry });
      });
      return true;
    }

    if (msg.type === "DELETE_PAGE_REDESIGN") {
      deleteRedesignLocally(msg.id).then((entry) => {
        if (entry) {
          chrome.runtime.sendMessage({
            type: "DELETE_REDESIGN",
            domain: getDomainKey(),
            pushId: entry.pushId || entry.id,
          });
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (msg.type === "EDIT_PAGE_REDESIGN") {
      getLocalRedesigns().then((list) => {
        const entry = list.find((x) => x.id === msg.id || x.pushId === msg.id);
        if (entry) {
          const el = safeQuery(entry.selector);
          if (el) {
            openEditorPanel(el, entry);
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: "Element not found on page" });
          }
        } else {
          sendResponse({ ok: false, error: "Redesign entry not found" });
        }
      });
      return true;
    }

    if (msg.type === "REDESIGN_DELETED") {
      const pid = msg.pushId;
      if (pid) {
        deleteRedesignLocally(pid);
      }
      syncDomainRedesigns();
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "REDESIGN_CHANGED") {
      syncDomainRedesigns();
      sendResponse({ ok: true });
      return true;
    }
  });

  init();

  return {
    buildResilientSelector,
    applyRedesignEntry,
    unapplyRedesignEntry,
    startPicker,
    stopPicker,
    openEditorPanel,
    getLocalRedesigns,
    toggleRedesignLocally,
    deleteRedesignLocally,
  };
})();
