// ---- Task 3 & Redesign Studio Engine ----
// Lets a user select any DOM element on the page (or body) and apply persistent
// custom visual restyling (CSS properties, custom CSS, custom HTML, and custom JS).
// Features: Live preview as you type, direct saving (no reload needed), and individual toggles.

const RedesignMode = (() => {
  const APPLIED_STYLE_PREFIX = "open-sesame-redesign-style-";
  const PREVIEW_STYLE_ID = "open-sesame-redesign-preview-style";

  // Cache of original element states before preview/redesign: el -> { inlineStyle, innerHTML }
  const originalStateMap = new WeakMap();

  // In-memory list of active redesign entries on this page
  let activeRedesignEntries = [];

  // Background Passthrough Helper for Deep Container Transparency
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
        html, body {
          background-color: transparent !important;
          background-image: none !important;
        }
        body > div:not(#open-sesame-redesign-editor):not([id^="open-sesame"]):not([id^="imagine-"]),
        body > main:not(#open-sesame-redesign-editor),
        body > section:not(#open-sesame-redesign-editor),
        #main, #cnt, #rcnt, #center_col, .GyAeWb, .app-container,
        ytd-app, #content, #page-manager, ytd-browse, ytd-search,
        .application-outlet, .scaffold-layout, .authentication-outlet,
        #app, #root, #root > div:not(#open-sesame-redesign-editor),
        #__next, #__next > div:not(#open-sesame-redesign-editor),
        [class*="layout"]:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *),
        [class*="wrapper"]:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *),
        [class*="container"]:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *) {
          background-color: transparent !important;
        }
      `;
    } else if (tag) {
      tag.remove();
    }
  }

  function buildSafeSelector(rawSel) {
    if (!rawSel) return "";
    const parts = rawSel.split(",").map((s) => s.trim()).filter(Boolean);
    return parts
      .map((s) => `html body ${s}:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *):not([id^="open-sesame"]), ${s}:not(#open-sesame-redesign-editor):not(#open-sesame-redesign-editor *):not([id^="open-sesame"])`)
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

  // ---- Resilient & Global Selector Generation ----
  function buildResilientSelector(el, isGlobal = false) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

    const tag = el.tagName.toLowerCase();
    const rawClasses = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const looksHashed = (c) => /^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c) && /[a-z]/i.test(c) && !/[-_]/.test(c);
    const usableClasses = rawClasses.filter((c) => !looksHashed(c));

    if (isGlobal) {
      if (tag === "button" || el.getAttribute("role") === "button") {
        if (usableClasses.length) return `${tag}.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
        return "button, [role='button']";
      }
      if (tag === "input") {
        const type = el.getAttribute("type") || "text";
        if (usableClasses.length) return `input[type="${type}"].${usableClasses.slice(0, 1).map((c) => CSS.escape(c)).join(".")}`;
        return `input[type="${type}"]`;
      }
      if (tag === "img") {
        if (usableClasses.length) return `img.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
        return "img";
      }
      if (tag === "header" || tag === "nav") return tag;
      if (usableClasses.length) {
        return `.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      }
      return tag;
    }

    // Single Element Mode (Specific)
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }

    const stableAttrNames = ["data-testid", "data-test", "data-qa", "data-cy", "data-id", "name", "aria-label"];
    for (const attrName of stableAttrNames) {
      const val = el.getAttribute(attrName);
      if (val) {
        const sel = `[${attrName}="${CSS.escape(val)}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }

    if (usableClasses.length) {
      const sel = `${tag}.${usableClasses.slice(0, 2).map((c) => CSS.escape(c)).join(".")}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }

    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        node = null;
        break;
      }
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    const prefix = node === document.body ? "body > " : "";
    return prefix + parts.join(" > ");
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
    return location.hostname || "default";
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
    }

    // Trigger transparent passthrough during live preview of background/shaders
    const isBgShader = Boolean(engineId) || (js && (js.includes("imagine-webgl-canvas") || js.includes("imagine-interactive-canvas"))) || (styles?.backgroundColor === "transparent" && !styles?.border);
    if (isBgShader) {
      updateBgPassthrough(true);
    }
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
          bg: "#18181b",
          border: "rgba(255,255,255,0.12)",
          text: "#fafafa",
          subtext: "#a1a1aa",
          cardBg: "rgba(255,255,255,0.06)",
          inputBg: "#27272a",
          inputBorder: "rgba(255,255,255,0.12)",
          primaryBtnBg: "#ffffff",
          primaryBtnText: "#09090b",
          secondaryBtnBg: "#27272a",
          secondaryBtnText: "#d4d4d8",
          shadow: "0 20px 48px rgba(0,0,0,0.5)",
          activeTabBg: "#27272a",
          activeTabText: "#ffffff",
        };
      }
      return {
        bg: "#ffffff",
        border: "#e4e4e7",
        text: "#09090b",
        subtext: "#71717a",
        cardBg: "#f4f4f5",
        inputBg: "#ffffff",
        inputBorder: "#e4e4e7",
        primaryBtnBg: "#18181b",
        primaryBtnText: "#ffffff",
        secondaryBtnBg: "#f4f4f5",
        secondaryBtnText: "#52525b",
        shadow: "0 20px 48px rgba(0,0,0,0.12)",
        activeTabBg: "#ffffff",
        activeTabText: "#18181b",
      };
    }

    panel.style.cssText =
      "position:fixed;right:20px;bottom:20px;width:340px;max-height:86vh;overflow-y:auto;" +
      "border-radius:14px;z-index:2147483647;padding:16px;font:12px/1.45 -apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;" +
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

      const bgHex = toHexColor(existingStyles.backgroundColor, isDark ? "#27272a" : "#6366f1");
      const colorHex = toHexColor(existingStyles.color, isDark ? "#ffffff" : "#09090b");
      const borderHex = toHexColor(existingStyles.border, "#6366f1");
      const shadowHex = toHexColor(existingStyles.boxShadow, "#6366f1");

      const matchCount = safeQueryAll(selector).length;

      panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid ${t.border};">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="width:7px;height:7px;border-radius:50%;background:#6366f1;"></span>
            <span style="font-weight:700;font-size:12.5px;letter-spacing:-0.01em;">Redesign Studio</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <button id="os-rd-theme-toggle" type="button" title="Toggle Light/Dark Theme" style="background:${t.cardBg};border:1px solid ${t.border};color:${t.text};border-radius:20px;padding:3px 8px;font-size:10px;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:4px;">
              ${isDark ? "☀️ Light" : "🌙 Dark"}
            </button>
            <button id="os-rd-close" type="button" style="background:transparent;border:0;color:${t.subtext};font-size:16px;cursor:pointer;line-height:1;padding:2px 4px;">&times;</button>
          </div>
        </div>

        <div style="background:rgba(99,102,241,0.10);padding:6px 10px;border-radius:7px;display:flex;align-items:center;justify-content:space-between;gap:6px;border:1px solid rgba(99,102,241,0.2);">
          <div style="display:flex;align-items:center;gap:5px;color:#6366f1;font-weight:700;font-size:10.5px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#6366f1;"></span>
            <span>👁️ Live Preview Active</span>
          </div>
          <span style="font-size:9.5px;color:${t.subtext};">Applies on page live</span>
        </div>

        <div style="background:${t.cardBg};padding:8px 10px;border-radius:8px;display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
            <div style="display:flex;align-items:center;gap:5px;">
              <span style="font-weight:700;font-size:11px;color:${t.text};">🌐 Global Restyling</span>
              <span style="font-size:9px;color:#6366f1;font-weight:600;">(${matchCount} ${matchCount === 1 ? "element" : "elements"})</span>
            </div>
            <label style="position:relative;display:inline-block;width:32px;height:17px;cursor:pointer;flex-shrink:0;">
              <input type="checkbox" id="os-rd-global-scope" ${isGlobalScope ? "checked" : ""} style="opacity:0;width:0;height:0;">
              <span style="position:absolute;cursor:pointer;inset:0;background:${isGlobalScope ? "#6366f1" : t.inputBorder};border-radius:17px;transition:0.2s;">
                <span style="position:absolute;content:'';height:13px;width:13px;left:${isGlobalScope ? "17px" : "2px"};bottom:2px;background:white;border-radius:50%;transition:0.2s;"></span>
              </span>
            </label>
          </div>
          <div style="font-size:10px;color:${t.subtext};word-break:break-all;">
            <span style="color:#6366f1;font-weight:600;">Target:</span> <code>${selector}</code>
          </div>
        </div>

        <div style="display:flex;background:${t.cardBg};padding:2px;border-radius:8px;gap:2px;">
          <button id="os-rd-tab-visual" type="button" style="flex:1;padding:5px 6px;font-size:10px;font-weight:600;border-radius:6px;border:0;cursor:pointer;background:${t.activeTabBg};color:${t.activeTabText};box-shadow:0 1px 3px rgba(0,0,0,0.06);">Visual</button>
          <button id="os-rd-tab-presets" type="button" style="flex:1.2;padding:5px 6px;font-size:10px;font-weight:600;border-radius:6px;border:0;cursor:pointer;background:transparent;color:${t.subtext};">✨ Presets (72)</button>
          <button id="os-rd-tab-code" type="button" style="flex:1;padding:5px 6px;font-size:10px;font-weight:600;border-radius:6px;border:0;cursor:pointer;background:transparent;color:${t.subtext};">Custom Code</button>
        </div>

        <div id="os-rd-presets-section" style="display:none;flex-direction:column;gap:8px;max-height:48vh;overflow-y:auto;padding-right:2px;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <select id="os-rd-preset-cat-filter" style="background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:4px 6px;border-radius:6px;font-size:10px;outline:none;">
              <option value="all">All Categories</option>
              <option value="background">Backgrounds (12)</option>
              <option value="div">Structural Divs (10)</option>
              <option value="card">Cards & Tiles (10)</option>
              <option value="button">Buttons & CTAs (10)</option>
              <option value="avatar">Avatars & Media (10)</option>
              <option value="header">Headers & Navs (10)</option>
              <option value="input">Inputs & Search (10)</option>
            </select>
            <select id="os-rd-preset-theme-filter" style="background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:4px 6px;border-radius:6px;font-size:10px;outline:none;">
              <option value="all">All Themes (10)</option>
              <option value="Anime">Anime / Cyber-Mecha</option>
              <option value="Vogue">Vogue Editorial</option>
              <option value="Netflix">Netflix Cinematic</option>
              <option value="Instagram">Instagram Sunset</option>
              <option value="YouTube">YouTube Studio</option>
              <option value="Apple">Apple Minimal</option>
              <option value="Retro">Retro 90s / Y2K</option>
              <option value="Neo-Brutalism">Neo-Brutalism</option>
              <option value="Luxury">Luxury Gold</option>
              <option value="Cyberpunk">Cyberpunk Matrix</option>
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

        <div style="display:flex;gap:8px;border-top:1px solid ${t.border};padding-top:10px;margin-top:2px;">
          <button id="os-rd-save" type="button" style="flex:1.4;background:${t.primaryBtnBg};color:${t.primaryBtnText};border:0;padding:8px 12px;border-radius:7px;cursor:pointer;font-weight:700;font-size:11.5px;letter-spacing:0.02em;transition:all 0.15s ease;">
            ✓ Apply & Save
          </button>
          <button id="os-rd-cancel" type="button" style="flex:1;background:${t.secondaryBtnBg};color:${t.secondaryBtnText};border:0;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:11.5px;font-weight:500;transition:all 0.15s ease;">
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

      tabVisual.addEventListener("click", () => switchTab(tabVisual, visualSection));
      tabPresets.addEventListener("click", () => {
        switchTab(tabPresets, presetsSection);
        renderPresetsList();
        setTimeout(scrollToActivePreset, 60);
      });
      tabCode.addEventListener("click", () => switchTab(tabCode, codeSection));

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

      let cachedLoadedPresets = null;
      async function loadPresetsFromJSON() {
        if (Array.isArray(cachedLoadedPresets) && cachedLoadedPresets.length > 0) {
          return cachedLoadedPresets;
        }
        try {
          const url = chrome.runtime.getURL("modules/redesign-presets.json");
          const res = await fetch(url);
          if (res.ok) {
            cachedLoadedPresets = await res.json();
            return cachedLoadedPresets;
          }
        } catch (e) {}
        return (typeof REDESIGN_PRESETS !== "undefined" ? REDESIGN_PRESETS : null) ||
               (typeof window !== "undefined" && window.REDESIGN_PRESETS) ||
               (typeof globalThis !== "undefined" && globalThis.REDESIGN_PRESETS) || [];
      }

      async function renderPresetsList() {
        const listContainer = panel.querySelector("#os-rd-presets-list");
        if (!listContainer) return;
        const allPresets = await loadPresetsFromJSON();
        const selectedCat = catFilter ? catFilter.value : "all";
        const selectedTheme = themeFilter ? themeFilter.value : "all";

        const filtered = allPresets.filter((p) => {
          const matchCat = selectedCat === "all" || p.category === selectedCat;
          const matchTheme = selectedTheme === "all" || (p.theme && p.theme.toLowerCase().includes(selectedTheme.toLowerCase()));
          return matchCat && matchTheme;
        });

        if (!filtered.length) {
          listContainer.innerHTML = `<div style="padding:16px;text-align:center;color:${t.subtext};font-size:11px;">No presets found matching filters.</div>`;
          return;
        }

        listContainer.innerHTML = "";
        filtered.forEach((p) => {
          const isSelected = p.id === selectedPresetId;
          const item = document.createElement("div");
          if (isSelected) {
            item.dataset.presetActive = "true";
          }

          const bgPreview = p.styles?.backgroundColor || "transparent";
          const borderPreview = p.styles?.border || "1px solid rgba(0,0,0,0.1)";
          const colorPreview = p.styles?.color || "#ffffff";

          const activeBorder = isSelected ? "#6366f1" : t.border;
          const activeBg = isSelected ? (isDark ? "rgba(99,102,241,0.22)" : "rgba(99,102,241,0.10)") : t.cardBg;
          const activeShadow = isSelected ? "0 0 10px rgba(99,102,241,0.28)" : "none";

          item.style.cssText =
            `background:${activeBg};border:1.5px solid ${activeBorder};border-radius:8px;padding:8px 10px;` +
            `cursor:pointer;display:flex;flex-direction:column;gap:4px;transition:all 0.15s ease;box-shadow:${activeShadow};`;

          item.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
              <div style="font-weight:700;font-size:11px;color:${isSelected ? "#6366f1" : t.text};display:flex;align-items:center;gap:4px;">
                ${isSelected ? "✓ " : ""}${p.name}
              </div>
              <span style="font-size:8.5px;padding:2px 5px;border-radius:4px;background:rgba(99,102,241,0.15);color:#6366f1;font-weight:600;white-space:nowrap;">${p.theme.split('/')[0].trim()}</span>
            </div>
            <div style="font-size:9.5px;color:${t.subtext};line-height:1.3;">${p.description}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;">
              <div style="display:flex;align-items:center;gap:4px;">
                <span style="width:12px;height:12px;border-radius:3px;background:${bgPreview};border:${borderPreview};" title="Background preview"></span>
                <span style="width:12px;height:12px;border-radius:50%;background:${colorPreview};border:1px solid rgba(0,0,0,0.1);" title="Text color"></span>
                <span style="font-size:9px;color:${t.subtext};text-transform:capitalize;">${p.category}</span>
              </div>
              <button type="button" style="background:${isSelected ? "#6366f1" : t.primaryBtnBg};color:#ffffff;border:0;border-radius:4px;padding:3px 8px;font-size:9.5px;font-weight:700;cursor:pointer;">
                ${isSelected ? "✓ Previewing" : "Preview"}
              </button>
            </div>
          `;

          // Live preview on hover before clicking
          item.addEventListener("pointerenter", () => {
            if (!isSelected) {
              item.style.borderColor = "#6366f1";
              item.style.transform = "translateY(-1px)";
              applyLivePreview(el, { styles: p.styles, cssText: p.cssText, html: p.html, js: p.js, engineId: p.engineId });
            }
          });

          // Restore active preset preview on mouse leave
          item.addEventListener("pointerleave", () => {
            if (!isSelected) {
              item.style.borderColor = t.border;
              item.style.transform = "none";
              updateLivePreview();
            }
          });

          // Select and lock in preset on click
          item.addEventListener("click", () => {
            selectedPresetId = p.id;
            applyPresetValues(p);
            renderPresetsList();
            setTimeout(scrollToActivePreset, 40);
          });

          listContainer.appendChild(item);
        });
      }

      function applyPresetValues(preset) {
        if (!preset) return;
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

      // Global Scope Toggle Listener
      const scopeToggle = panel.querySelector("#os-rd-global-scope");
      if (scopeToggle) {
        scopeToggle.addEventListener("change", () => {
          isGlobalScope = scopeToggle.checked;
          selector = buildResilientSelector(el, isGlobalScope);
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
          elInput.addEventListener("input", updateLivePreview);
          elInput.addEventListener("change", updateLivePreview);
        }
      });

      // Close & Cancel
      panel.querySelector("#os-rd-close").addEventListener("click", closeAndRevert);
      panel.querySelector("#os-rd-cancel").addEventListener("click", closeAndRevert);

      // Save
      panel.querySelector("#os-rd-save").addEventListener("click", handleSave);
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

      const styles = {};
      styles.backgroundColor = bg;
      styles.color = color;
      styles.border = border;
      styles.borderRadius = borderRadius;
      styles.boxShadow = shadow;

      applyLivePreview(el, { styles, cssText, html, js, engineId: currentEngineId });
    }

    function closeAndRevert() {
      clearLivePreview(el);
      if (existingEntry && existingEntry.enabled !== false) {
        applyRedesignEntry(existingEntry);
      }
      panel.remove();
    }

    async function handleSave() {
      const saveBtn = panel.querySelector("#os-rd-save");
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
      }

      const name = panel.querySelector("#os-rd-name")?.value.trim() || `${tagName} redesign`;
      const bg = panel.querySelector("#os-rd-bg")?.value.trim() || "";
      const color = panel.querySelector("#os-rd-color")?.value.trim() || "";
      const border = panel.querySelector("#os-rd-border")?.value.trim() || "";
      const borderRadius = panel.querySelector("#os-rd-radius")?.value.trim() || "";
      const shadow = panel.querySelector("#os-rd-shadow")?.value.trim() || "";
      const cssText = panel.querySelector("#os-rd-css")?.value.trim() || "";
      const html = panel.querySelector("#os-rd-html")?.value || "";
      const js = panel.querySelector("#os-rd-js")?.value || "";

      const styles = {};
      if (bg) styles.backgroundColor = bg;
      if (color) styles.color = color;
      if (border) styles.border = border;
      if (borderRadius) styles.borderRadius = borderRadius;
      if (shadow) styles.boxShadow = shadow;

      const pushId = existingEntry?.pushId || existingEntry?.id || "rd_" + Date.now().toString(36);
      const entry = {
        id: pushId,
        pushId,
        selector,
        name,
        enabled: true,
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
              const targets = safeQueryAll(entry.selector);
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
              });
            }
          });
        }
      }, 80);
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // ---- Init & Auto-Apply on Page Load ----
  async function init() {
    startDomWatcher();

    // 1. Read local storage first for instant synchronous feel
    const localEntries = await getLocalRedesigns();
    if (localEntries.length) {
      activeRedesignEntries = localEntries;
      localEntries.forEach((entry) => {
        if (entry.enabled !== false) applyRedesignEntry(entry);
      });
    }

    // 2. Sync from database in background
    chrome.runtime.sendMessage(
      { type: "GET_REDESIGNS_FOR_DOMAIN", domain: getDomainKey() },
      async (res) => {
        if (!res || !res.ok || !Array.isArray(res.items)) return;
        const dbItems = res.items;
        const currentList = await getLocalRedesigns();
        const merged = [...currentList];

        for (const item of dbItems) {
          const exists = merged.find((x) => x.pushId === item.pushId || x.selector === item.selector);
          if (!exists) {
            merged.push({ ...item, id: item.pushId, enabled: true });
          }
        }

        const key = getStorageKey();
        await chrome.storage.local.set({ [key]: merged });
        activeRedesignEntries = merged;

        merged.forEach((entry) => {
          if (entry.enabled !== false) applyRedesignEntry(entry);
        });
      }
    );
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "START_REDESIGN_PICKER") {
      startPicker((el) => openEditorPanel(el));
      sendResponse({ ok: true });
      return true;
    }

    if (msg.type === "GET_PAGE_REDESIGNS") {
      getLocalRedesigns().then((items) => {
        sendResponse({ ok: true, items, domain: getDomainKey() });
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
