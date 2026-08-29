// ---- Unified Overlay & Interactive '+' Picker Controller ----

const AssetOverlay = (() => {
  let activeMenuCloseFn = null; // Enforce single open menu across the page

  const PLUS_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
  const CLOSE_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  // Inject ultra-thin scrollbar styles once
  if (!document.getElementById("locked-image-custom-styles")) {
    const style = document.createElement("style");
    style.id = "locked-image-custom-styles";
    style.textContent = `
      .locked-image-menu::-webkit-scrollbar {
        width: 3px;
      }
      .locked-image-menu::-webkit-scrollbar-track {
        background: transparent;
      }
      .locked-image-menu::-webkit-scrollbar-thumb {
        background: rgba(184, 65, 14, 0.5);
        border-radius: 3px;
      }
      .locked-image-menu::-webkit-scrollbar-thumb:hover {
        background: #b8410e;
      }
      .locked-image-menu {
        scrollbar-width: thin;
        scrollbar-color: rgba(184, 65, 14, 0.5) transparent;
      }
      @keyframes locked-image-pulse {
        0% { background-color: #fef08a; transform: scale(1); box-shadow: 0 0 0 rgba(234, 179, 8, 0); }
        50% { background-color: #fef9c3; transform: scale(1.02); box-shadow: 0 0 8px rgba(234, 179, 8, 0.7); }
        100% { background-color: #fef08a; transform: scale(1); box-shadow: 0 0 0 rgba(234, 179, 8, 0); }
      }
      .locked-image-highlight {
        animation: locked-image-pulse 0.8s ease-in-out 3;
        border-color: #ca8a04 !important;
        border-width: 1.5px !important;
      }
    `;
    document.head.appendChild(style);
  }

  function makeEl(tag, styleText, className) {
    const el = document.createElement(tag);
    if (styleText) el.style.cssText = styleText;
    if (className) el.className = className;
    return el;
  }

  function attach(img, assetId, { onBindInteraction, onUnbind, interactionsEnabled: initialEnabled } = {}) {
    let activeBinding = null;    // currently displayed interaction
    let allBindings = [];        // all bindings for this image [{pushId, interaction, createdBy, ...}]
    let myUserId = null;         // this browser's anonymous ID
    let overlayIframe = null;
    let menuEl = null;
    let destroyed = false;
    let rafPending = false;
    let hoverLeaveTimeout = null;

    let isImgHovered = false;
    let isPinHovered = false;

    let interactionsEnabled = initialEnabled !== undefined ? initialEnabled : true;
    chrome.storage.local.get({ interactionsEnabled: true }, (res) => {
      interactionsEnabled = res.interactionsEnabled !== false;
      if (!interactionsEnabled) {
        pin.style.display = "none";
        badge.style.display = "none";
        deactivateSandbox();
        closeMenu();
      }
    });

    // Fetch anonymous user ID
    chrome.runtime.sendMessage({ type: "GET_ANON_USER_ID" }, (res) => {
      if (res && res.userId) myUserId = res.userId;
    });

    // Hidden bindings (user chose to hide someone else's interaction)
    let hiddenPushIds = new Set();
    chrome.storage.local.get("hiddenBindings", (res) => {
      const map = res.hiddenBindings || {};
      if (map[assetId]) hiddenPushIds = new Set(map[assetId]);
    });

    function rect() {
      return img.getBoundingClientRect();
    }

    function isTooSmall(r) {
      return r.width < 140 || r.height < 140;
    }

    function offscreen(r) {
      return r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth;
    }

    function isPinVisible() {
      if (!interactionsEnabled || destroyed) return false;
      const r = rect();
      if (offscreen(r) || isTooSmall(r)) return false;
      return isImgHovered || isPinHovered || !!menuEl || !!overlayIframe;
    }

    const container = makeEl(
      "div",
      "position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483646;overflow:visible;"
    );

    const pin = makeEl(
      "div",
      "position:fixed;width:28px;height:28px;border-radius:50%;" +
        "background:rgba(18,18,24,0.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);" +
        "border:1px solid rgba(255,255,255,0.22);color:#ffffff;display:none;align-items:center;" +
        "justify-content:center;cursor:pointer;pointer-events:auto;" +
        "opacity:0.92;transition:all 0.18s cubic-bezier(0.16, 1, 0.3, 1);box-shadow:0 4px 14px rgba(0,0,0,0.35);" +
        "user-select:none;z-index:2147483647;"
    );
    pin.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
    pin.title = "Manage interactions on this image";
    container.appendChild(pin);

    // Badge showing number of active bindings
    const badge = makeEl(
      "div",
      "position:fixed;min-width:15px;height:15px;border-radius:8px;" +
        "background:#b8410e;color:#fff;font-size:8.5px;font-weight:700;" +
        "display:none;align-items:center;justify-content:center;padding:0 4px;" +
        "pointer-events:none;z-index:2147483647;line-height:1;box-shadow:0 2px 6px rgba(0,0,0,0.3);"
    );
    container.appendChild(badge);

    document.body.appendChild(container);

    let currentPinLeft = 0;
    let currentPinTop = 0;

    function updateBadge() {
      const visible = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
      if (visible.length > 1 && isPinVisible()) {
        badge.style.display = "flex";
        badge.textContent = String(visible.length);
      } else {
        badge.style.display = "none";
      }
    }

    function positionMenu(pLeft, pTop) {
      if (!menuEl) return;
      const menuWidth = 260;
      const menuHeight = Math.min(340, window.innerHeight - 20);

      let left = pLeft - menuWidth + 26;
      if (left < 10) left = Math.max(10, pLeft);
      if (left + menuWidth > window.innerWidth - 10) {
        left = window.innerWidth - menuWidth - 10;
      }

      let top = pTop + 30;
      if (top + menuHeight > window.innerHeight - 10) {
        top = Math.max(10, pTop - menuHeight - 6);
      }

      menuEl.style.left = left + "px";
      menuEl.style.top = top + "px";
      menuEl.style.maxHeight = menuHeight + "px";
    }

    function syncRect() {
      if (destroyed) return;
      const r = rect();
      if (offscreen(r) || isTooSmall(r) || !interactionsEnabled) {
        pin.style.display = "none";
        badge.style.display = "none";
        deactivateSandbox();
        closeMenu();
        return;
      }

      // Compute visible intersection box with viewport for edge/corner adaptability
      const visTop = Math.max(0, r.top);
      const visBottom = Math.min(window.innerHeight, r.bottom);
      const visLeft = Math.max(0, r.left);
      const visRight = Math.min(window.innerWidth, r.right);

      currentPinLeft = Math.max(visLeft + 6, Math.min(visRight - 30, r.right - 30));
      currentPinTop = Math.max(visTop + 6, Math.min(visBottom - 30, r.top + 6));

      pin.style.left = currentPinLeft + "px";
      pin.style.top = currentPinTop + "px";

      badge.style.left = (currentPinLeft + 14) + "px";
      badge.style.top = (currentPinTop - 4) + "px";

      if (isPinVisible()) {
        pin.style.display = "flex";
        if (isPinHovered) {
          pin.style.opacity = "1";
          pin.style.transform = "scale(1.15)";
          pin.style.background = "#b8410e";
          pin.style.borderColor = "#ea580c";
          pin.style.boxShadow = "0 6px 20px rgba(184, 65, 14, 0.5)";
        } else {
          pin.style.opacity = "0.92";
          pin.style.transform = "scale(1)";
          pin.style.background = "rgba(18,18,24,0.88)";
          pin.style.borderColor = "rgba(255,255,255,0.22)";
          pin.style.boxShadow = "0 4px 14px rgba(0,0,0,0.35)";
        }
        updateBadge();
      } else {
        pin.style.display = "none";
        badge.style.display = "none";
      }

      if (overlayIframe) {
        overlayIframe.style.left = r.left + "px";
        overlayIframe.style.top = r.top + "px";
        overlayIframe.style.width = r.width + "px";
        overlayIframe.style.height = r.height + "px";
        recalcOverlayStacking();
      }

      if (menuEl) {
        positionMenu(currentPinLeft, currentPinTop);
      }
    }

    function onScrollOrResize() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        syncRect();
      });
    }

    // ---- Chic & Minimal Menu: Interactions List ----
    async function openMenu() {
      if (menuEl) {
        closeMenu();
        return;
      }

      // Enforce only one open menu across the page
      if (activeMenuCloseFn && activeMenuCloseFn !== closeMenu) {
        activeMenuCloseFn();
      }
      activeMenuCloseFn = closeMenu;

      // Switch icon from '+' to '✕' close sign
      pin.innerHTML = CLOSE_ICON_SVG;
      pin.title = "Close menu";
      pin.style.background = "#18181b";
      pin.style.borderColor = "rgba(255,255,255,0.4)";

      menuEl = makeEl(
        "div",
        "position:fixed;width:280px;max-height:min(78vh, 460px);overflow-y:auto;" +
          "background:#ffffff;color:#18181b;border:1px solid #e4e4e7;box-shadow:0 12px 36px rgba(0,0,0,0.12);" +
          "padding:14px;font-family:-apple-system,BlinkMacSystemFont,Inter,system-ui,sans-serif;font-size:11.5px;z-index:2147483647;pointer-events:auto;" +
          "border-radius:12px;",
        "locked-image-menu"
      );

      positionMenu(currentPinLeft, currentPinTop);

      // Top Notice Banner
      const noticeEl = makeEl(
        "div",
        "display:none;margin-bottom:10px;padding:8px 10px;border-radius:6px;font-size:10.5px;line-height:1.4;border:1px solid transparent;"
      );
      menuEl.appendChild(noticeEl);

      const highlightMatchingRow = (pushId) => {
        const rows = menuEl.querySelectorAll("[data-push-id]");
        rows.forEach((r) => r.classList.remove("locked-image-highlight"));
        const target = menuEl.querySelector(`[data-push-id="${pushId}"]`);
        if (target) {
          target.classList.add("locked-image-highlight");
          target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      };

      // ---- Section: Active Interactions ----
      const visibleBindings = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
      if (visibleBindings.length > 0) {
        const activeHeader = makeEl("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;");
        const activeTitle = makeEl("div", "font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#71717a;display:flex;align-items:center;gap:5px;");
        activeTitle.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span> ${visibleBindings.length > 1 ? `Active (${visibleBindings.length})` : "Active Interaction"}`;
        activeHeader.appendChild(activeTitle);
        menuEl.appendChild(activeHeader);

        visibleBindings.forEach((b) => {
          const isCurrentActive = activeBinding && (activeBinding.name === b.interaction.name || activeBinding === b.interaction);
          const isMine = myUserId && b.createdBy === myUserId;

          const row = makeEl(
            "div",
            `padding:8px 10px;background:${isCurrentActive ? "#f4f4f5" : "#ffffff"};border:1px solid ${isCurrentActive ? "#18181b" : "#e4e4e7"};border-radius:8px;margin-bottom:5px;display:flex;align-items:center;gap:8px;cursor:pointer;transition:all 0.15s ease;`
          );
          row.setAttribute("data-push-id", b.pushId);
          row.setAttribute("data-name", (b.interaction.name || "").toLowerCase());

          const icon = makeEl("span", `font-size:10px;font-weight:bold;color:${isCurrentActive ? "#18181b" : "#a1a1aa"};`);
          icon.textContent = isCurrentActive ? "●" : "○";
          row.appendChild(icon);

          const nameSpan = makeEl("span", `flex:1;font-weight:${isCurrentActive ? "600" : "500"};font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#18181b;`);
          nameSpan.textContent = b.interaction.name || "Untitled";
          row.appendChild(nameSpan);

          if (isMine) {
            const removeBtn = makeEl("button", "background:transparent;color:#ef4444;border:1px solid rgba(239,68,68,0.3);font-size:9px;padding:2px 6px;cursor:pointer;border-radius:4px;font-weight:600;flex-shrink:0;transition:all 0.15s ease;");
            removeBtn.textContent = "Remove";
            removeBtn.onmouseenter = () => { removeBtn.style.background = "#ef4444"; removeBtn.style.color = "#fff"; };
            removeBtn.onmouseleave = () => { removeBtn.style.background = "transparent"; removeBtn.style.color = "#ef4444"; };
            removeBtn.onclick = (e) => {
              e.stopPropagation();
              onUnbind && onUnbind(b.pushId);
              closeMenu();
            };
            row.appendChild(removeBtn);
          } else {
            const hideBtn = makeEl("button", "background:transparent;color:#71717a;border:1px solid #e4e4e7;font-size:9px;padding:2px 6px;cursor:pointer;border-radius:4px;font-weight:500;flex-shrink:0;");
            hideBtn.textContent = "Hide";
            hideBtn.onclick = async (e) => {
              e.stopPropagation();
              hiddenPushIds.add(b.pushId);
              const { hiddenBindings = {} } = await chrome.storage.local.get("hiddenBindings");
              hiddenBindings[assetId] = [...hiddenPushIds];
              await chrome.storage.local.set({ hiddenBindings });
              if (activeBinding === b.interaction) {
                const remaining = allBindings.filter((x) => !hiddenPushIds.has(x.pushId));
                activeBinding = remaining.length ? remaining[0].interaction : null;
                deactivateSandbox();
                if (activeBinding) activateSandbox();
              }
              closeMenu();
              updateBadge();
            };
            row.appendChild(hideBtn);
          }

          row.onclick = (e) => {
            if (e.target.tagName === "BUTTON") return;
            e.stopPropagation();
            activeBinding = b.interaction;
            closeMenu();
            deactivateSandbox();
            activateSandbox();
          };

          menuEl.appendChild(row);
        });

        const divider = makeEl("div", "border-top:1px solid #f4f4f5;margin:10px 0;");
        menuEl.appendChild(divider);
      }

      // Handler for applying an interaction
      const handleSelectInteraction = async (candidate) => {
        noticeEl.style.display = "none";
        noticeEl.textContent = "";

        const candidateName = (candidate.name || "Untitled").trim();
        const normName = candidateName.toLowerCase();

        const existing = allBindings.find(
          (b) => (b.interaction?.name || "").trim().toLowerCase() === normName
        );

        if (existing) {
          const isMine = myUserId && existing.createdBy === myUserId;
          if (isMine) {
            noticeEl.innerHTML = `ℹ️ <b>${candidateName}</b> is already active.`;
            noticeEl.style.background = "#f4f4f5";
            noticeEl.style.borderColor = "#e4e4e7";
            noticeEl.style.color = "#18181b";
            noticeEl.style.display = "block";
            activeBinding = existing.interaction;
            closeMenu();
            deactivateSandbox();
            activateSandbox();
            return;
          } else {
            noticeEl.innerHTML = `⚠️ <b>"${candidateName}"</b> is already bound by another user.`;
            noticeEl.style.background = "#fef2f2";
            noticeEl.style.borderColor = "#fecaca";
            noticeEl.style.color = "#991b1b";
            noticeEl.style.display = "block";
            menuEl.scrollTop = 0;
            highlightMatchingRow(existing.pushId);
            return;
          }
        }

        activeBinding = candidate;
        closeMenu();
        deactivateSandbox();
        activateSandbox();

        if (onBindInteraction) {
          const res = await onBindInteraction(candidate);
          if (res && res.alreadyApplied) {
            activeBinding = null;
            deactivateSandbox();
            openMenu();
            noticeEl.innerHTML = `⚠️ <b>"${candidateName}"</b> is already applied.`;
            noticeEl.style.background = "#fef2f2";
            noticeEl.style.borderColor = "#fecaca";
            noticeEl.style.color = "#991b1b";
            noticeEl.style.display = "block";
            if (res.existingBinding?.pushId) {
              highlightMatchingRow(res.existingBinding.pushId);
            }
          }
        }
      };

      // ---- Section: Add / Change Interaction ----
      const userHasBinding = myUserId && allBindings.some((b) => b.createdBy === myUserId);
      const addTitle = makeEl("div", "font-weight:700;font-size:10px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;color:#71717a;");
      addTitle.textContent = userHasBinding ? "Change Interaction" : "Choose Interaction";
      menuEl.appendChild(addTitle);

      const listDiv = makeEl("div", "display:flex;flex-direction:column;gap:4px;");

      let templates = [];
      try {
        const res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "LIST_GLOBAL_INTERACTIONS" }, (r) => resolve(r));
        });
        if (res && res.ok && Array.isArray(res.items)) {
          templates = res.items;
        }
      } catch (e) {}

      if (templates.length) {
        templates.forEach((t) => {
          const item = makeEl("div", "padding:7px 10px;background:#fbfbfa;cursor:pointer;border:1px solid #e4e4e7;font-weight:500;border-radius:6px;font-size:11px;transition:all 0.15s ease;display:flex;align-items:center;gap:6px;color:#18181b;");
          item.textContent = `★ ${t.name || "Untitled"}`;
          item.onmouseenter = () => { item.style.background = "#f4f4f5"; item.style.borderColor = "#18181b"; };
          item.onmouseleave = () => { item.style.background = "#fbfbfa"; item.style.borderColor = "#e4e4e7"; };
          item.onclick = (e) => {
            e.stopPropagation();
            handleSelectInteraction(t);
          };
          listDiv.appendChild(item);
        });
      }

      const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
      if (myInteractions.length) {
        const head = makeEl("div", "font-size:9.5px;color:#71717a;text-transform:uppercase;margin-top:6px;font-weight:600;letter-spacing:0.05em;");
        head.textContent = "My Library";
        listDiv.appendChild(head);
        myInteractions.forEach((it) => {
          const item = makeEl("div", "padding:6px 10px;background:#fff;border:1px solid #e4e4e7;cursor:pointer;border-radius:6px;font-size:11px;color:#18181b;font-weight:500;");
          item.textContent = it.name || "Untitled";
          item.onmouseenter = () => { item.style.borderColor = "#18181b"; };
          item.onmouseleave = () => { item.style.borderColor = "#e4e4e7"; };
          item.onclick = (e) => {
            e.stopPropagation();
            handleSelectInteraction(it);
          };
          listDiv.appendChild(item);
        });
      }

      const createBtn = makeEl("button", "margin-top:8px;width:100%;padding:8px 12px;background:#18181b;color:#ffffff;border:none;cursor:pointer;font-size:10.5px;font-weight:600;letter-spacing:0.02em;border-radius:6px;transition:all 0.15s ease;");
      createBtn.textContent = "+ Create in Editor";
      createBtn.onmouseenter = () => { createBtn.style.opacity = "0.85"; };
      createBtn.onmouseleave = () => { createBtn.style.opacity = "1"; };
      createBtn.onclick = (e) => {
        e.stopPropagation();
        window.open(chrome.runtime.getURL("editor.html"), "_blank");
        closeMenu();
      };
      listDiv.appendChild(createBtn);

      menuEl.appendChild(listDiv);
      document.body.appendChild(menuEl);
    }

    function closeMenu() {
      if (activeMenuCloseFn === closeMenu) {
        activeMenuCloseFn = null;
      }
      // Revert icon to '+'
      pin.innerHTML = PLUS_ICON_SVG;
      pin.title = "Manage interactions on this image";
      pin.style.background = "rgba(18,18,24,0.88)";
      pin.style.borderColor = "rgba(255,255,255,0.22)";

      if (menuEl) {
        menuEl.remove();
        menuEl = null;
      }
      if (!isImgHovered && !isPinHovered) {
        pin.style.display = "none";
        badge.style.display = "none";
        deactivateSandbox();
      }
    }

    function onKeyDown(e) {
      if (e.key === "Escape" && menuEl) {
        closeMenu();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    function onDocClick(e) {
      if (menuEl && !menuEl.contains(e.target) && !pin.contains(e.target)) {
        closeMenu();
      }
    }
    document.addEventListener("click", onDocClick);

    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (menuEl) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // ---- Task 1: Stacking-Context-Aware Overlay Placement & Hole-Punch Clipping ----
    function getImageEffectiveZ(targetImg) {
      let node = targetImg;
      while (node && node !== document.documentElement && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.zIndex && cs.zIndex !== "auto") {
          const z = parseInt(cs.zIndex, 10);
          if (!isNaN(z)) return z;
        }
        if (cs.position && cs.position !== "static") {
          return 1;
        }
        node = node.parentElement;
      }
      return 1;
    }

    function recalcOverlayStacking() {
      if (!overlayIframe) return;
      const cs = getComputedStyle(img);
      const zIndex = getImageEffectiveZ(img);
      overlayIframe.style.zIndex = String(zIndex);
      // Inherit original element's clipPath and borderRadius without artificial cut-offs
      overlayIframe.style.clipPath = cs.clipPath && cs.clipPath !== "none" ? cs.clipPath : "";
      overlayIframe.style.borderRadius = cs.borderRadius || "";
    }

    // ---- Task 2: Loading indicator matching the target's shape ----
    function computeTargetShape() {
      const cs = getComputedStyle(img);
      const corners = [
        cs.borderTopLeftRadius,
        cs.borderTopRightRadius,
        cs.borderBottomRightRadius,
        cs.borderBottomLeftRadius,
      ];
      const hasRadius = corners.some((c) => parseFloat(c) > 0);
      const clipPath = cs.clipPath && cs.clipPath !== "none" ? cs.clipPath : null;
      if (!hasRadius && !clipPath) return null;
      return { borderRadius: corners, clipPath };
    }

    // ---- Sandbox Hover Playback ----
    function activateSandbox() {
      if (!interactionsEnabled || !activeBinding || overlayIframe || menuEl) return;
      const r = rect();
      if (isTooSmall(r) || offscreen(r)) return;

      const cs = getComputedStyle(img);
      const objectFit = cs.objectFit || "fill";
      const objectPosition = cs.objectPosition || "center";

      overlayIframe = document.createElement("iframe");
      overlayIframe.src = chrome.runtime.getURL("sandbox.html");
      overlayIframe.setAttribute("sandbox", "allow-scripts");
      overlayIframe.style.cssText =
        `position:fixed;left:${r.left}px;top:${r.top}px;` +
        `width:${r.width}px;height:${r.height}px;` +
        `border:0;background:transparent;border-radius:${cs.borderRadius};overflow:hidden;`;
      document.body.appendChild(overlayIframe);
      recalcOverlayStacking();

      function onMsg(ev) {
        if (ev.source !== overlayIframe?.contentWindow) return;
        const msg = ev.data;
        if (!msg || msg.source !== "locked-image-sandbox") return;
        if (msg.type === "READY") {
          overlayIframe.contentWindow.postMessage(
            {
              source: "locked-image-host",
              type: "INIT",
              imageUrl: img.currentSrc || img.src,
              width: Math.round(r.width),
              height: Math.round(r.height),
              interaction: activeBinding,
              config: {
                objectFit,
                objectPosition,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
              },
              bindingId: assetId,
              shape: computeTargetShape(),
            },
            "*"
          );
        }
        if (msg.type === "FETCH_IMAGE_DATA_URL") {
          chrome.runtime.sendMessage(
            { type: "FETCH_IMAGE_DATA_URL", url: msg.url },
            (res) => {
              if (overlayIframe?.contentWindow) {
                overlayIframe.contentWindow.postMessage(
                  {
                    source: "locked-image-host",
                    type: "STORAGE_RESULT",
                    requestId: msg.requestId,
                    ok: res && res.ok,
                    value: res?.dataUrl,
                  },
                  "*"
                );
              }
            }
          );
        }

        if (msg.type === "LEAVE") {
          // Verify cursor isn't hovering the pin or menu
          if (isPinHovered || menuEl) return;
          isImgHovered = false;
          deactivateSandbox();
          pin.style.display = "none";
          badge.style.display = "none";
        }
      }
      window.addEventListener("message", onMsg);
      overlayIframe._cleanup = () => window.removeEventListener("message", onMsg);
    }

    function deactivateSandbox() {
      if (!overlayIframe) return;
      overlayIframe._cleanup && overlayIframe._cleanup();
      overlayIframe.remove();
      overlayIframe = null;
    }

    function isPointInRect(x, y, r) {
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    img.addEventListener("pointerenter", () => {
      if (!interactionsEnabled) return;
      const r = rect();
      if (isTooSmall(r) || offscreen(r)) return;
      isImgHovered = true;
      syncRect();
      activateSandbox();
    });

    img.addEventListener("pointerleave", (e) => {
      // When overlayIframe is mounted, the pointer event moves into the iframe covering the img.
      // Do not tear down if the iframe is active or if pointer moved into pin.
      if (overlayIframe) return;

      const toEl = e.relatedTarget;
      if (toEl && (toEl === pin || pin.contains(toEl))) {
        return;
      }

      isImgHovered = false;
      if (!isPinHovered && !menuEl) {
        pin.style.display = "none";
        badge.style.display = "none";
      }
    });

    pin.addEventListener("pointerenter", () => {
      if (!interactionsEnabled) return;
      isPinHovered = true;
      pin.style.display = "flex";
      syncRect();
    });

    pin.addEventListener("pointerleave", (e) => {
      isPinHovered = false;
      const r = rect();
      const inImg = isPointInRect(e.clientX, e.clientY, r);
      if (inImg) {
        // Cursor moved back into image area
        isImgHovered = true;
        return;
      }

      if (!menuEl) {
        isImgHovered = false;
        deactivateSandbox();
        pin.style.display = "none";
        badge.style.display = "none";
      }
    });

    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    document.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });
    syncRect();

    return {
      setBinding(newBinding) {
        activeBinding = newBinding;
        if (!activeBinding) {
          allBindings = [];
          deactivateSandbox();
        } else {
          deactivateSandbox();
          if (isPinVisible()) activateSandbox();
        }
        updateBadge();
      },
      setBindings(bindingEntries, explicitUserId) {
        if (explicitUserId) myUserId = explicitUserId;
        allBindings = bindingEntries || [];
        const visible = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
        const prevBindingName = activeBinding ? (activeBinding.name || "") : null;

        // Prioritize user's own binding, fallback to first visible
        const myBinding = myUserId && visible.find((b) => b.createdBy === myUserId);
        activeBinding = myBinding ? myBinding.interaction : (visible.length ? visible[0].interaction : null);

        updateBadge();
        if (!activeBinding) {
          deactivateSandbox();
        } else if (overlayIframe && prevBindingName && (activeBinding.name || "") !== prevBindingName) {
          // Only re-mount sandbox IF the active interaction actually changed to a different one
          deactivateSandbox();
          if (isPinVisible()) activateSandbox();
        }
      },
      setInteractionsEnabled(enabled) {
        interactionsEnabled = !!enabled;
        if (!interactionsEnabled) {
          deactivateSandbox();
          closeMenu();
          pin.style.display = "none";
          badge.style.display = "none";
        } else {
          syncRect();
        }
      },
      getActiveBinding() {
        return activeBinding;
      },
      getAllBindings() {
        return allBindings;
      },
      highlightAndScroll() {
        img.scrollIntoView({ behavior: "smooth", block: "center" });
        const prevTransition = img.style.transition;
        const prevOutline = img.style.outline;
        const prevBoxShadow = img.style.boxShadow;
        img.style.transition = "box-shadow 0.25s ease, outline 0.25s ease";
        img.style.outline = "3px solid #b8410e";
        img.style.boxShadow = "0 0 25px rgba(184, 65, 14, 0.75)";
        isImgHovered = true;
        syncRect();
        activateSandbox();
        setTimeout(() => {
          img.style.outline = prevOutline;
          img.style.boxShadow = prevBoxShadow;
          img.style.transition = prevTransition;
        }, 2200);
      },
      destroy() {
        destroyed = true;
        if (hoverLeaveTimeout) clearTimeout(hoverLeaveTimeout);
        deactivateSandbox();
        closeMenu();
        window.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("click", onDocClick);
        window.removeEventListener("scroll", onScrollOrResize, { capture: true });
        document.removeEventListener("scroll", onScrollOrResize, { capture: true });
        window.removeEventListener("resize", onScrollOrResize);
        container.remove();
      },
    };
  }

  return { attach };
})();
