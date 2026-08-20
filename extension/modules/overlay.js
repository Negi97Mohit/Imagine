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
      "position:fixed;width:24px;height:24px;border-radius:50%;" +
        "background:#b8410e;color:#ffffff;display:none;align-items:center;" +
        "justify-content:center;font-size:16px;font-weight:700;cursor:pointer;pointer-events:auto;" +
        "opacity:0.85;transition:opacity 0.15s ease, transform 0.15s ease;box-shadow:0 2px 8px rgba(0,0,0,0.45);" +
        "user-select:none;z-index:2147483647;"
    );
    pin.textContent = "+";
    pin.title = "Manage interactions on this image";
    container.appendChild(pin);

    // Badge showing number of active bindings
    const badge = makeEl(
      "div",
      "position:fixed;min-width:14px;height:14px;border-radius:7px;" +
        "background:#0a0a0a;color:#fff;font-size:8px;font-weight:700;" +
        "display:none;align-items:center;justify-content:center;padding:0 3px;" +
        "pointer-events:none;z-index:2147483647;line-height:1;"
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
        } else {
          pin.style.opacity = "0.85";
          pin.style.transform = "scale(1)";
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

    // ---- Menu: Show All Interactions + Multi-binding List ----
    async function openMenu() {
      if (menuEl) {
        closeMenu();
        return;
      }

      menuEl = makeEl(
        "div",
        "position:fixed;width:260px;max-height:340px;overflow-y:auto;" +
          "background:#ffffff;color:#0a0a0a;border:1px solid #1a1a1a;box-shadow:0 6px 18px rgba(0,0,0,0.25);" +
          "padding:10px;font-family:Inter,sans-serif;font-size:11px;z-index:2147483647;pointer-events:auto;" +
          "border-radius:4px;",
        "locked-image-menu"
      );

      positionMenu(currentPinLeft, currentPinTop);

      // Top Notice Banner (for warnings / already-applied alerts)
      const noticeEl = makeEl(
        "div",
        "display:none;margin-bottom:8px;padding:6px 8px;border-radius:3px;font-size:10px;line-height:1.3;border:1px solid transparent;"
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

      // ---- Section: Currently active bindings on this image ----
      const visibleBindings = allBindings.filter((b) => !hiddenPushIds.has(b.pushId));
      if (visibleBindings.length > 0) {
        const activeHeader = makeEl("div", "display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;");
        const activeTitle = makeEl("div", "font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#b8410e;");
        activeTitle.textContent = visibleBindings.length > 1 ? `Active Interactions (${visibleBindings.length})` : "Active Interaction";
        activeHeader.appendChild(activeTitle);

        const tip = makeEl("div", "font-size:8.5px;color:#888;");
        tip.textContent = "Click to preview";
        activeHeader.appendChild(tip);
        menuEl.appendChild(activeHeader);

        visibleBindings.forEach((b) => {
          const isCurrentActive = activeBinding && (activeBinding.name === b.interaction.name || activeBinding === b.interaction);
          const isMine = myUserId && b.createdBy === myUserId;

          const row = makeEl(
            "div",
            `padding:6px 8px;background:${isCurrentActive ? "#eff6ff" : "#f0ede8"};border:1px solid ${isCurrentActive ? "#3b82f6" : "#ddd"};border-radius:3px;margin-bottom:4px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all 0.15s ease;`
          );
          row.setAttribute("data-push-id", b.pushId);
          row.setAttribute("data-name", (b.interaction.name || "").toLowerCase());

          // Active indicator icon
          const icon = makeEl("span", `font-size:10px;font-weight:bold;color:${isCurrentActive ? "#2563eb" : "#888"};`);
          icon.textContent = isCurrentActive ? "▶" : "•";
          row.appendChild(icon);

          const nameSpan = makeEl("span", `flex:1;font-weight:${isCurrentActive ? "700" : "600"};font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isCurrentActive ? "#1d4ed8" : "#111"};`);
          nameSpan.textContent = b.interaction.name || "Untitled";
          nameSpan.title = isCurrentActive ? "Currently playing" : "Click to view this interaction";
          row.appendChild(nameSpan);

          if (isCurrentActive) {
            const activeTag = makeEl("span", "font-size:8px;font-weight:700;background:#dbeafe;color:#1e40af;padding:1px 4px;border-radius:2px;flex-shrink:0;");
            activeTag.textContent = "Playing";
            row.appendChild(activeTag);
          }

          if (isMine) {
            // Owner can remove their binding
            const removeBtn = makeEl("button", "background:#c53a2a;color:#fff;border:none;font-size:8px;padding:2px 5px;cursor:pointer;border-radius:2px;font-weight:600;flex-shrink:0;");
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove your interaction";
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

          const authorTag = makeEl("span", "font-size:8px;color:#888;flex-shrink:0;");
          authorTag.textContent = isMine ? "(you)" : "";
          row.appendChild(authorTag);

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

      // Handler for applying an interaction
      const handleSelectInteraction = async (candidate) => {
        noticeEl.style.display = "none";
        noticeEl.textContent = "";

        const candidateName = (candidate.name || "Untitled").trim();
        const normName = candidateName.toLowerCase();

        // 1. Check if this exact interaction is already applied by someone else
        const existing = allBindings.find(
          (b) => (b.interaction?.name || "").trim().toLowerCase() === normName
        );

        if (existing) {
          const isMine = myUserId && existing.createdBy === myUserId;
          if (isMine) {
            noticeEl.innerHTML = `ℹ️ <b>${candidateName}</b> is already your active interaction on this image.`;
            noticeEl.style.background = "#eff6ff";
            noticeEl.style.borderColor = "#3b82f6";
            noticeEl.style.color = "#1e40af";
            noticeEl.style.display = "block";
            activeBinding = existing.interaction;
            closeMenu();
            deactivateSandbox();
            activateSandbox();
            return;
          } else {
            noticeEl.innerHTML = `⚠️ <b>"${candidateName}"</b> has already been applied to this image by another user.<br><span style="font-size:9px;color:#7f1d1d;">See the highlighted item above in Active Interactions.</span>`;
            noticeEl.style.background = "#fef2f2";
            noticeEl.style.borderColor = "#ef4444";
            noticeEl.style.color = "#991b1b";
            noticeEl.style.display = "block";
            menuEl.scrollTop = 0;
            highlightMatchingRow(existing.pushId);
            return;
          }
        }

        // 2. Not duplicate -> activate immediately for creator and bind in background
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
            noticeEl.innerHTML = `⚠️ <b>"${candidateName}"</b> has already been applied to this image by another user.`;
            noticeEl.style.background = "#fef2f2";
            noticeEl.style.borderColor = "#ef4444";
            noticeEl.style.color = "#991b1b";
            noticeEl.style.display = "block";
            if (res.existingBinding?.pushId) {
              highlightMatchingRow(res.existingBinding.pushId);
            }
          }
        }
      };

      // ---- Section: Add / Update interaction ----
      const userHasBinding = myUserId && allBindings.some((b) => b.createdBy === myUserId);
      const addTitle = makeEl("div", "font-weight:700;font-size:10px;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.05em;color:#b8410e;");
      addTitle.textContent = userHasBinding ? "Change Your Interaction" : "Add Interaction";
      menuEl.appendChild(addTitle);

      const addSub = makeEl("div", "font-size:8.5px;color:#777;margin-bottom:6px;");
      addSub.textContent = userHasBinding
        ? "Selecting a new one will replace your current interaction."
        : "Apply your interaction to this image.";
      menuEl.appendChild(addSub);

      const listDiv = makeEl("div", "display:flex;flex-direction:column;gap:3px;");

      // 1. Presets / Templates
      const templates = typeof GLOBAL_TEMPLATES !== "undefined" ? GLOBAL_TEMPLATES : [WATER_REVEAL_TEMPLATE];
      templates.forEach((t) => {
        const item = makeEl("div", "padding:5px 8px;background:#f4f1ec;cursor:pointer;border:1px solid #ddd;font-weight:600;border-radius:2px;font-size:10.5px;");
        item.textContent = `★ ${t.name}`;
        item.onclick = (e) => {
          e.stopPropagation();
          handleSelectInteraction(t);
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
            handleSelectInteraction(it);
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
      document.body.appendChild(menuEl);
    }

    function closeMenu() {
      if (menuEl) {
        menuEl.remove();
        menuEl = null;
        if (hoverLeaveTimeout) clearTimeout(hoverLeaveTimeout);
        hoverLeaveTimeout = setTimeout(() => {
          if (!isPinVisible()) {
            syncRect();
          }
        }, 50);
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
      openMenu();
    });

    // ---- Sandbox Hover Playback ----
    function activateSandbox() {
      if (!interactionsEnabled || !activeBinding || overlayIframe || menuEl) return;
      const r = rect();
      if (isTooSmall(r) || offscreen(r)) return;

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
          deactivateSandbox();
          if (hoverLeaveTimeout) clearTimeout(hoverLeaveTimeout);
          hoverLeaveTimeout = setTimeout(() => {
            if (!isPinVisible()) {
              syncRect();
            }
          }, 50);
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

    img.addEventListener("pointerenter", () => {
      if (!interactionsEnabled) return;
      if (hoverLeaveTimeout) {
        clearTimeout(hoverLeaveTimeout);
        hoverLeaveTimeout = null;
      }
      const r = rect();
      if (isTooSmall(r) || offscreen(r)) return;
      isImgHovered = true;
      syncRect();
      activateSandbox();
    });
    img.addEventListener("pointerleave", () => {
      isImgHovered = false;
      if (hoverLeaveTimeout) clearTimeout(hoverLeaveTimeout);
      hoverLeaveTimeout = setTimeout(() => {
        if (!isPinVisible()) {
          syncRect();
        }
      }, 50);
    });
    pin.addEventListener("pointerenter", () => {
      if (!interactionsEnabled) return;
      if (hoverLeaveTimeout) {
        clearTimeout(hoverLeaveTimeout);
        hoverLeaveTimeout = null;
      }
      isPinHovered = true;
      syncRect();
    });
    pin.addEventListener("pointerleave", () => {
      isPinHovered = false;
      if (hoverLeaveTimeout) clearTimeout(hoverLeaveTimeout);
      hoverLeaveTimeout = setTimeout(() => {
        if (!isPinVisible()) {
          syncRect();
        }
      }, 50);
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
