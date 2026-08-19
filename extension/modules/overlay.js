// ---- Unified Overlay & Interactive '+' Picker Controller ----

const AssetOverlay = (() => {
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
    `;
    document.head.appendChild(style);
  }

  function makeEl(tag, styleText, className) {
    const el = document.createElement(tag);
    if (styleText) el.style.cssText = styleText;
    if (className) el.className = className;
    return el;
  }

  function attach(img, assetId, { onBindInteraction, onUnbind } = {}) {
    let activeBinding = null;    // currently displayed interaction
    let allBindings = [];        // all bindings for this image [{pushId, interaction, createdBy, ...}]
    let myUserId = null;         // this browser's anonymous ID
    let overlayIframe = null;
    let menuEl = null;
    let destroyed = false;
    let rafPending = false;

    let interactionsEnabled = true;
    chrome.storage.local.get({ interactionsEnabled: true }, (res) => {
      interactionsEnabled = res.interactionsEnabled !== false;
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

    const container = makeEl(
      "div",
      "position:fixed;pointer-events:none;z-index:2147483646;overflow:visible;"
    );

    const pin = makeEl(
      "div",
      "position:absolute;top:6px;right:6px;width:24px;height:24px;border-radius:50%;" +
        "background:#b8410e;color:#ffffff;display:flex;align-items:center;" +
        "justify-content:center;font-size:16px;font-weight:700;cursor:pointer;pointer-events:auto;" +
        "opacity:0;transition:opacity 0.15s ease, transform 0.15s ease;box-shadow:0 2px 6px rgba(0,0,0,0.4);" +
        "user-select:none;z-index:2147483647;"
    );
    pin.textContent = "+";
    pin.title = "Manage interactions on this image";
    container.appendChild(pin);

    // Badge showing number of active bindings
    const badge = makeEl(
      "div",
      "position:absolute;top:2px;right:2px;min-width:14px;height:14px;border-radius:7px;" +
        "background:#0a0a0a;color:#fff;font-size:8px;font-weight:700;" +
        "display:none;align-items:center;justify-content:center;padding:0 3px;" +
        "pointer-events:none;z-index:2147483647;line-height:1;"
    );
    container.appendChild(badge);

    document.body.appendChild(container);

    function updateBadge() {
      const visible = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
      if (visible.length > 1) {
        badge.style.display = "flex";
        badge.textContent = String(visible.length);
      } else {
        badge.style.display = "none";
      }
    }

    function syncRect() {
      if (destroyed) return;
      const r = rect();
      if (offscreen(r) || isTooSmall(r)) {
        pin.style.display = "none";
        badge.style.display = "none";
        deactivateSandbox();
        closeMenu();
        return;
      }
      pin.style.display = "flex";
      updateBadge();
      container.style.left = r.left + "px";
      container.style.top = r.top + "px";
      container.style.width = r.width + "px";
      container.style.height = r.height + "px";

      if (overlayIframe) {
        overlayIframe.style.left = r.left + "px";
        overlayIframe.style.top = r.top + "px";
        overlayIframe.style.width = r.width + "px";
        overlayIframe.style.height = r.height + "px";
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

    // ---- Menu: Show All Interactions + Multi-binding List ----
    async function openMenu() {
      if (menuEl) {
        closeMenu();
        return;
      }

      menuEl = makeEl(
        "div",
        "position:absolute;top:34px;right:6px;width:250px;max-height:320px;overflow-y:auto;" +
          "background:#ffffff;color:#0a0a0a;border:1px solid #1a1a1a;box-shadow:0 6px 18px rgba(0,0,0,0.25);" +
          "padding:10px;font-family:Inter,sans-serif;font-size:11px;z-index:2147483647;pointer-events:auto;" +
          "border-radius:4px;",
        "locked-image-menu"
      );

      // ---- Section: Currently active bindings on this image ----
      const visibleBindings = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
      if (visibleBindings.length > 0) {
        const activeTitle = makeEl("div", "font-weight:700;font-size:10px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;color:#b8410e;");
        activeTitle.textContent = visibleBindings.length > 1 ? `Active Interactions (${visibleBindings.length})` : "Active Interaction";
        menuEl.appendChild(activeTitle);

        visibleBindings.forEach((b) => {
          const row = makeEl("div", "padding:5px 8px;background:#f0ede8;border:1px solid #ddd;border-radius:2px;margin-bottom:3px;display:flex;align-items:center;gap:6px;");

          const nameSpan = makeEl("span", "flex:1;font-weight:600;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;");
          nameSpan.textContent = b.interaction.name || "Untitled";
          nameSpan.title = "Click to view this interaction";
          nameSpan.onclick = (e) => {
            e.stopPropagation();
            activeBinding = b.interaction;
            deactivateSandbox();
            activateSandbox();
            closeMenu();
          };
          row.appendChild(nameSpan);

          const isMine = b.createdBy === myUserId;

          if (isMine) {
            // Owner can remove their binding
            const removeBtn = makeEl("button", "background:#c53a2a;color:#fff;border:none;font-size:8px;padding:2px 5px;cursor:pointer;border-radius:2px;font-weight:600;flex-shrink:0;");
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove your binding";
            removeBtn.onclick = (e) => {
              e.stopPropagation();
              onUnbind && onUnbind(b.pushId);
              closeMenu();
            };
            row.appendChild(removeBtn);
          } else {
            // Others can hide it locally
            const hideBtn = makeEl("button", "background:#888;color:#fff;border:none;font-size:8px;padding:2px 5px;cursor:pointer;border-radius:2px;font-weight:600;flex-shrink:0;");
            hideBtn.textContent = "Hide";
            hideBtn.title = "Hide this interaction (only for you)";
            hideBtn.onclick = async (e) => {
              e.stopPropagation();
              hiddenPushIds.add(b.pushId);
              const { hiddenBindings = {} } = await chrome.storage.local.get("hiddenBindings");
              hiddenBindings[assetId] = [...hiddenPushIds];
              await chrome.storage.local.set({ hiddenBindings });
              // If we hid the active one, switch to next visible
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

          row.appendChild(
            (() => {
              const tag = makeEl("span", "font-size:8px;color:#888;flex-shrink:0;");
              tag.textContent = isMine ? "you" : "";
              return tag;
            })()
          );

          menuEl.appendChild(row);
        });

        // Show hidden count if any
        const hiddenCount = allBindings.filter((b) => hiddenPushIds.has(b.pushId)).length;
        if (hiddenCount > 0) {
          const showHidden = makeEl("div", "font-size:9px;color:#888;cursor:pointer;margin-bottom:4px;text-decoration:underline;");
          showHidden.textContent = `Show ${hiddenCount} hidden interaction${hiddenCount > 1 ? "s" : ""}`;
          showHidden.onclick = async (e) => {
            e.stopPropagation();
            hiddenPushIds.clear();
            const { hiddenBindings = {} } = await chrome.storage.local.get("hiddenBindings");
            delete hiddenBindings[assetId];
            await chrome.storage.local.set({ hiddenBindings });
            closeMenu();
            openMenu();
            updateBadge();
          };
          menuEl.appendChild(showHidden);
        }

        const divider = makeEl("div", "border-top:1px solid #ddd;margin:8px 0;");
        menuEl.appendChild(divider);
      }

      // ---- Section: Add new interaction ----
      const addTitle = makeEl("div", "font-weight:700;font-size:10px;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.05em;color:#b8410e;");
      addTitle.textContent = "Add Interaction";
      menuEl.appendChild(addTitle);

      const listDiv = makeEl("div", "display:flex;flex-direction:column;gap:3px;");

      // 1. Presets / Templates
      const templates = typeof GLOBAL_TEMPLATES !== "undefined" ? GLOBAL_TEMPLATES : [WATER_REVEAL_TEMPLATE];
      templates.forEach((t) => {
        const item = makeEl("div", "padding:5px 8px;background:#f4f1ec;cursor:pointer;border:1px solid #ddd;font-weight:600;border-radius:2px;font-size:10.5px;");
        item.textContent = `★ ${t.name}`;
        item.onclick = (e) => {
          e.stopPropagation();
          onBindInteraction && onBindInteraction(t);
          closeMenu();
        };
        listDiv.appendChild(item);
      });

      // 2. Local interactions
      const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
      if (myInteractions.length) {
        const head = makeEl("div", "font-size:9px;color:#888;text-transform:uppercase;margin-top:5px;");
        head.textContent = "My Library:";
        listDiv.appendChild(head);
        myInteractions.forEach((it) => {
          const item = makeEl("div", "padding:5px 8px;background:#fff;border:1px solid #1a1a1a;cursor:pointer;border-radius:2px;font-size:10.5px;");
          item.textContent = it.name || "Untitled";
          item.onclick = (e) => {
            e.stopPropagation();
            onBindInteraction && onBindInteraction(it);
            closeMenu();
          };
          listDiv.appendChild(item);
        });
      }

      // 3. Create new
      const createBtn = makeEl("button", "margin-top:6px;width:100%;padding:5px;background:#0a0a0a;color:#fff;border:none;cursor:pointer;font-size:9.5px;text-transform:uppercase;letter-spacing:0.05em;border-radius:2px;");
      createBtn.textContent = "+ Create New in Editor";
      createBtn.onclick = (e) => {
        e.stopPropagation();
        window.open(chrome.runtime.getURL("editor.html"), "_blank");
        closeMenu();
      };
      listDiv.appendChild(createBtn);

      menuEl.appendChild(listDiv);
      container.appendChild(menuEl);
    }

    function closeMenu() {
      if (menuEl) {
        menuEl.remove();
        menuEl = null;
      }
    }

    function onKeyDown(e) {
      if (e.key === "Escape" && menuEl) {
        closeMenu();
      }
    }
    window.addEventListener("keydown", onKeyDown);

    function onDocClick(e) {
      if (menuEl && !container.contains(e.target)) {
        closeMenu();
      }
    }
    document.addEventListener("click", onDocClick);

    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      openMenu();
    });

    // ---- Sandbox Hover Playback ----
    function activateSandbox() {
      if (!interactionsEnabled || !activeBinding || overlayIframe || menuEl) return;
      const r = rect();
      if (isTooSmall(r)) return;

      overlayIframe = document.createElement("iframe");
      overlayIframe.src = chrome.runtime.getURL("sandbox.html");
      overlayIframe.setAttribute("sandbox", "allow-scripts");
      overlayIframe.style.cssText =
        `position:fixed;left:${r.left}px;top:${r.top}px;` +
        `width:${r.width}px;height:${r.height}px;z-index:2147483645;` +
        `border:0;background:transparent;`;
      document.body.appendChild(overlayIframe);

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
              config: {},
              bindingId: assetId,
            },
            "*"
          );
        }
        if (msg.type === "LEAVE") deactivateSandbox();
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

    img.addEventListener("pointerenter", () => {
      const r = rect();
      if (isTooSmall(r)) return;
      pin.style.opacity = "1";
      activateSandbox();
    });
    img.addEventListener("pointerleave", () => {
      if (!menuEl) pin.style.opacity = "0";
    });
    container.addEventListener("pointerenter", () => {
      const r = rect();
      if (isTooSmall(r)) return;
      pin.style.opacity = "1";
    });
    container.addEventListener("pointerleave", () => {
      if (!menuEl) pin.style.opacity = "0";
    });

    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);
    syncRect();

    return {
      setBinding(newBinding) {
        // Single binding (backward compat from content.js)
        activeBinding = newBinding;
        if (!activeBinding) {
          allBindings = [];
          deactivateSandbox();
        }
        updateBadge();
      },
      setBindings(bindingEntries) {
        // Multi-binding: array of { pushId, interaction, createdBy, ... }
        allBindings = bindingEntries || [];
        // Filter out hidden ones and pick the first visible as active
        const visible = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
        activeBinding = visible.length ? visible[0].interaction : null;
        updateBadge();
        if (!activeBinding) deactivateSandbox();
      },
      setInteractionsEnabled(enabled) {
        interactionsEnabled = enabled;
        if (!enabled) deactivateSandbox();
      },
      destroy() {
        destroyed = true;
        deactivateSandbox();
        closeMenu();
        window.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("click", onDocClick);
        window.removeEventListener("scroll", onScrollOrResize, { capture: true });
        window.removeEventListener("resize", onScrollOrResize);
        container.remove();
      },
    };
  }

  return { attach };
})();
