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

  // ---- Resilient selector generation ----
  function buildResilientSelector(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el === document.body) return "body";
    if (el === document.documentElement) return "html";

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

    const tag = el.tagName.toLowerCase();
    const rawClasses = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const looksHashed = (c) => /^[a-z0-9]{6,}$/i.test(c) && /\d/.test(c) && /[a-z]/i.test(c) && !/[-_]/.test(c);
    const usableClasses = rawClasses.filter((c) => !looksHashed(c)).slice(0, 2);
    if (usableClasses.length) {
      const sel = `${tag}.${usableClasses.map((c) => CSS.escape(c)).join(".")}`;
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

  // ---- Applying a redesign entry ----
  function applyRedesignEntry(entry) {
    if (!entry || !entry.selector) return false;
    const el = safeQuery(entry.selector);
    if (!el) return false;

    saveOriginalState(el);

    if (entry.enabled === false) {
      removeRedesignStyleTag(entry.pushId || entry.id);
      restoreOriginalState(el);
      return true;
    }

    // 1. Direct CSS properties
    if (entry.styles && typeof entry.styles === "object") {
      for (const [prop, val] of Object.entries(entry.styles)) {
        if (val !== undefined && val !== null && val !== "") {
          try {
            el.style[prop] = val;
          } catch (e) {}
        }
      }
    }

    // 2. Custom CSS text
    if (entry.cssText && entry.cssText.trim()) {
      const styleId = APPLIED_STYLE_PREFIX + (entry.pushId || entry.id || "temp");
      let styleTag = document.getElementById(styleId);
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.id = styleId;
        document.head.appendChild(styleTag);
      }
      styleTag.textContent = `${entry.selector} { ${entry.cssText} }`;
    } else {
      removeRedesignStyleTag(entry.pushId || entry.id);
    }

    // 3. Custom HTML replacement
    if (entry.html && entry.html.trim()) {
      try {
        el.innerHTML = entry.html;
        el.dataset.imagineHtmlModified = "true";
      } catch (e) {}
    }

    // 4. Custom JS execution
    if (entry.js && entry.js.trim()) {
      try {
        const fn = new Function("element", "target", entry.js);
        fn(el, el);
      } catch (err) {
        console.warn("[Imagine Redesign] Custom JS execution error:", err);
      }
    }

    return true;
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
    const el = safeQuery(entry.selector);
    if (el) {
      restoreOriginalState(el);
    }
  }

  // ---- Live Preview helper ----
  function applyLivePreview(el, { styles, cssText, html, js }) {
    if (!el) return;
    saveOriginalState(el);

    // Apply inline style properties
    if (styles && typeof styles === "object") {
      for (const [prop, val] of Object.entries(styles)) {
        if (val) {
          try { el.style[prop] = val; } catch (e) {}
        }
      }
    }

    // Apply custom CSS live
    let previewStyle = document.getElementById(PREVIEW_STYLE_ID);
    if (cssText && cssText.trim()) {
      if (!previewStyle) {
        previewStyle = document.createElement("style");
        previewStyle.id = PREVIEW_STYLE_ID;
        document.head.appendChild(previewStyle);
      }
      const sel = buildResilientSelector(el);
      previewStyle.textContent = `${sel} { ${cssText} }`;
    } else if (previewStyle) {
      previewStyle.textContent = "";
    }

    // Apply HTML live
    if (html && html.trim()) {
      try {
        el.innerHTML = html;
        el.dataset.imagineHtmlModified = "true";
      } catch (e) {}
    }

    // Apply JS live
    if (js && js.trim()) {
      try {
        const fn = new Function("element", "target", js);
        fn(el, el);
      } catch (e) {}
    }
  }

  function clearLivePreview(el) {
    const previewStyle = document.getElementById(PREVIEW_STYLE_ID);
    if (previewStyle) previewStyle.remove();
    if (el) restoreOriginalState(el);
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
    const selector = existingEntry?.selector || buildResilientSelector(el);
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
      "box-sizing:border-box;display:flex;flex-direction:column;gap:12px;transition:all 0.2s ease;";

    function renderPanelContent() {
      const isDark = currentStudioTheme === "dark";
      const t = getThemeStyles(isDark);

      panel.style.background = t.bg;
      panel.style.color = t.text;
      panel.style.border = `1px solid ${t.border}`;
      panel.style.boxShadow = t.shadow;

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

        <div style="background:${t.cardBg};padding:6px 10px;border-radius:8px;font-size:10.5px;color:${t.subtext};word-break:break-all;">
          <span style="color:#6366f1;font-weight:600;">Target:</span> <code>${selector}</code>
        </div>

        <div style="display:flex;background:${t.cardBg};padding:2px;border-radius:8px;gap:2px;">
          <button id="os-rd-tab-visual" type="button" style="flex:1;padding:5px 8px;font-size:10.5px;font-weight:600;border-radius:6px;border:0;cursor:pointer;background:${t.activeTabBg};color:${t.activeTabText};box-shadow:0 1px 3px rgba(0,0,0,0.06);">Visual Design</button>
          <button id="os-rd-tab-code" type="button" style="flex:1;padding:5px 8px;font-size:10.5px;font-weight:600;border-radius:6px;border:0;cursor:pointer;background:transparent;color:${t.subtext};">Custom Code</button>
        </div>

        <div id="os-rd-visual-section" style="display:flex;flex-direction:column;gap:10px;">
          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Name</label>
            <input type="text" id="os-rd-name" value="${existingName}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Background</label>
              <input type="text" id="os-rd-bg" placeholder="#1e1b4b or transparent" value="${existingStyles.backgroundColor || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Text Color</label>
              <input type="text" id="os-rd-color" placeholder="#ffffff" value="${existingStyles.color || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Border</label>
              <input type="text" id="os-rd-border" placeholder="1px solid #6366f1" value="${existingStyles.border || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
            <div>
              <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Radius</label>
              <input type="text" id="os-rd-radius" placeholder="8px or 9999px" value="${existingStyles.borderRadius || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
            </div>
          </div>

          <div>
            <label style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:${t.subtext};margin-bottom:3px;font-weight:600;">Shadow</label>
            <input type="text" id="os-rd-shadow" placeholder="0 8px 24px rgba(0,0,0,0.12)" value="${existingStyles.boxShadow || ""}" style="width:100%;box-sizing:border-box;background:${t.inputBg};border:1px solid ${t.inputBorder};color:${t.text};padding:6px 9px;border-radius:7px;font-size:11.5px;outline:none;">
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

      // Setup tab switching
      const tabVisual = panel.querySelector("#os-rd-tab-visual");
      const tabCode = panel.querySelector("#os-rd-tab-code");
      const visualSection = panel.querySelector("#os-rd-visual-section");
      const codeSection = panel.querySelector("#os-rd-code-section");

      tabVisual.addEventListener("click", () => {
        tabVisual.style.background = t.activeTabBg;
        tabVisual.style.color = t.activeTabText;
        tabVisual.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        tabCode.style.background = "transparent";
        tabCode.style.color = t.subtext;
        tabCode.style.boxShadow = "none";
        visualSection.style.display = "flex";
        codeSection.style.display = "none";
      });

      tabCode.addEventListener("click", () => {
        tabCode.style.background = t.activeTabBg;
        tabCode.style.color = t.activeTabText;
        tabCode.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
        tabVisual.style.background = "transparent";
        tabVisual.style.color = t.subtext;
        tabVisual.style.boxShadow = "none";
        visualSection.style.display = "none";
        codeSection.style.display = "flex";
      });

      // Setup theme toggle
      panel.querySelector("#os-rd-theme-toggle").addEventListener("click", () => {
        currentStudioTheme = currentStudioTheme === "dark" ? "light" : "dark";
        renderPanelContent();
      });

      // Attach live input listeners for real-time preview
      ["#os-rd-bg", "#os-rd-color", "#os-rd-border", "#os-rd-radius", "#os-rd-shadow", "#os-rd-css", "#os-rd-html", "#os-rd-js"].forEach((id) => {
        panel.querySelector(id)?.addEventListener("input", updateLivePreview);
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
      if (bg) styles.backgroundColor = bg;
      if (color) styles.color = color;
      if (border) styles.border = border;
      if (borderRadius) styles.borderRadius = borderRadius;
      if (shadow) styles.boxShadow = shadow;

      applyLivePreview(el, { styles, cssText, html, js });
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
        styles,
        cssText,
        html,
        js,
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

  // ---- Init & Auto-Apply on Page Load ----
  async function init() {
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
