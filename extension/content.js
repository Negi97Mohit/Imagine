(function () {
  const overlays = new Map(); // img -> { assetId, controller }
  const identifying = new WeakSet();
  let interactionsEnabled = true;
  chrome.storage.local.get({ interactionsEnabled: true }, (res) => {
    interactionsEnabled = res.interactionsEnabled !== false;
  });

  function tryExtractDirectHash(img) {
    try {
      if (!img.complete || (img.naturalWidth && img.naturalWidth < 16)) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 9;
      canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 9, 8);
      const imgData = ctx.getImageData(0, 0, 9, 8).data;

      const gray = new Float32Array(72);
      let sum = 0;
      for (let i = 0; i < 72; i++) {
        const g = 0.299 * imgData[i * 4] + 0.587 * imgData[i * 4 + 1] + 0.114 * imgData[i * 4 + 2];
        gray[i] = g;
        sum += g;
      }
      const mean = sum / 72;
      let varSum = 0;
      for (let i = 0; i < 72; i++) {
        const d = gray[i] - mean;
        varSum += d * d;
      }
      if (Math.sqrt(varSum / 72) < 4.5) return null; // Flat placeholder

      let bits = "";
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          bits += gray[y * 9 + x] < gray[y * 9 + x + 1] ? "1" : "0";
        }
      }
      let dhash = "";
      for (let i = 0; i < 64; i += 4) dhash += parseInt(bits.slice(i, i + 4), 2).toString(16);

      // Color grid
      canvas.width = 4;
      canvas.height = 4;
      ctx.drawImage(img, 0, 0, 4, 4);
      const cData = ctx.getImageData(0, 0, 4, 4).data;
      let colorHex = "";
      for (let i = 0; i < 16; i++) {
        const lum = Math.round((0.299 * cData[i * 4] + 0.587 * cData[i * 4 + 1] + 0.114 * cData[i * 4 + 2]) / 16);
        colorHex += Math.min(15, Math.max(0, lum)).toString(16);
      }

      // Intrinsic aspect ratio tag
      const nw = img.naturalWidth || img.width || 1;
      const nh = img.naturalHeight || img.height || 1;
      const arTag = Math.round((nw / nh) * 10);

      return `${dhash}_${colorHex}_${arTag}`;
    } catch (e) {
      // CORS tainted -> fallback to background fetch
      return null;
    }
  }

  function identifyAsset(img) {
    const src = ImageDetector.resolvedSrc(img);
    const platformId = typeof extractPlatformAssetId === "function" ? extractPlatformAssetId(src) : null;
    if (platformId) {
      return Promise.resolve({ ok: true, assetId: platformId });
    }
    const directHash = tryExtractDirectHash(img);
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "IDENTIFY_ASSET", url: src, directHash },
        (res) => resolve(res || { ok: false })
      );
    });
  }

  function lookupBinding(assetId) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "LOOKUP_ASSET_BINDING", assetId },
        (res) => resolve(res || { found: false })
      );
    });
  }

  async function setupOverlay(img, assetId) {
    if (overlays.has(img)) return;

    let record = { assetId, controller: null };

    const controller = AssetOverlay.attach(img, assetId, {
      interactionsEnabled,
      onBindInteraction: async (interaction) => {
        controller.setBinding(interaction);
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              type: "SAVE_ASSET_BINDING",
              assetId: record.assetId || assetId,
              url: ImageDetector.resolvedSrc(img),
              interaction,
            },
            (res) => {
              if (res && res.ok) {
                const savedAssetId = res.assetId || record.assetId || assetId;
                record.assetId = savedAssetId;
                lookupBinding(savedAssetId).then((lookupRes) => {
                  if (lookupRes.found && lookupRes.bindings && lookupRes.bindings.length) {
                    if (lookupRes.canonicalAssetId) record.assetId = lookupRes.canonicalAssetId;
                    controller.setBindings(lookupRes.bindings, lookupRes.userId);
                  } else {
                    controller.setBinding(interaction);
                  }
                });
              }
              resolve(res || { ok: false });
            }
          );
        });
      },
      onUnbind: async (pushId) => {
        chrome.runtime.sendMessage({
          type: "DELETE_ASSET_BINDING",
          assetId: record.assetId || assetId,
          pushId,
        });
        // Re-fetch remaining bindings after delete
        setTimeout(async () => {
          const res = await lookupBinding(record.assetId || assetId);
          if (res.found && res.bindings && res.bindings.length) {
            controller.setBindings(res.bindings, res.userId);
          } else {
            controller.setBinding(null);
          }
        }, 400);
      },
    });

    record.controller = controller;
    overlays.set(img, record);

    const existing = await lookupBinding(assetId);
    if (existing && existing.found) {
      if (existing.canonicalAssetId) {
        record.assetId = existing.canonicalAssetId;
      }
      if (existing.bindings && existing.bindings.length) {
        controller.setBindings(existing.bindings, existing.userId);
      } else if (existing.binding) {
        controller.setBinding(existing.binding.interaction);
      }
    }
  }

  async function onCandidate(img) {
    if (identifying.has(img)) return;
    identifying.add(img);
    const res = await identifyAsset(img);
    identifying.delete(img);
    if (!res.ok || !res.assetId || res.isPlaceholder) return;
    await setupOverlay(img, res.assetId);
  }

  ImageDetector.start({
    onCandidate,
    onRemoved: (img) => {
      const record = overlays.get(img);
      if (record) {
        record.controller && record.controller.destroy();
        overlays.delete(img);
      }
    },
  });

  // ---- Live Viewport & Cross-Profile Sync Engine ----
  async function syncActiveOverlays() {
    if (document.hidden) return;
    for (const [img, record] of Array.from(overlays.entries())) {
      if (!document.body.contains(img)) {
        record.controller && record.controller.destroy();
        overlays.delete(img);
        continue;
      }
      const r = img.getBoundingClientRect();
      const inView = r.bottom > -100 && r.top < window.innerHeight + 100 && r.right > -100 && r.left < window.innerWidth + 100;
      if (inView) {
        lookupBinding(record.assetId).then((res) => {
          if (res.found && res.bindings && res.bindings.length) {
            if (res.canonicalAssetId) record.assetId = res.canonicalAssetId;
            record.controller.setBindings(res.bindings, res.userId);
          } else if (res.found && res.binding) {
            record.controller.setBinding(res.binding.interaction);
          } else {
            record.controller.setBinding(null);
          }
        });
      }
    }
  }

  // Live sync for visible images across open tabs & profiles (complements real-time message push)
  setInterval(syncActiveOverlays, 6000);
  window.addEventListener("focus", syncActiveOverlays);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) syncActiveOverlays();
  });

  // Handle messages from popup or background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_PAGE_IMAGES" || msg.type === "GET_PAGE_DATA") {
      const images = [];
      const pageBindings = [];
      let idx = 0;

      document.querySelectorAll("img").forEach((img) => {
        const src = ImageDetector.resolvedSrc(img);
        const w = img.naturalWidth || img.width || img.offsetWidth || 0;
        const h = img.naturalHeight || img.height || img.offsetHeight || 0;
        if (src && w >= 140 && h >= 140) {
          const imgIndex = idx++;
          img.dataset.openSesameIndex = String(imgIndex);
          const record = overlays.get(img);
          const activeBinding = record?.controller?.getActiveBinding?.() || null;
          const allBindings = record?.controller?.getAllBindings?.() || [];

          const imgInfo = {
            index: imgIndex,
            src,
            width: w,
            height: h,
            alt: img.alt || "",
            assetId: record?.assetId || null,
            hasBinding: !!activeBinding || allBindings.length > 0,
            interactionName: activeBinding?.name || null,
            bindingsCount: allBindings.length,
          };
          images.push(imgInfo);

          if (activeBinding || allBindings.length > 0) {
            pageBindings.push({
              index: imgIndex,
              src,
              assetId: record?.assetId,
              interactionName: activeBinding?.name || allBindings[0]?.interaction?.name || "Active Interaction",
              bindingsCount: allBindings.length || 1,
              allBindings: allBindings.map((b) => ({
                pushId: b.pushId,
                name: b.interaction?.name || "Untitled",
                createdBy: b.createdBy,
              })),
            });
          }
        }
      });

      sendResponse({
        ok: true,
        images,
        pageBindings,
        totalBindings: pageBindings.length,
      });
      return true;
    }

    if (msg.type === "SCROLL_TO_IMAGE") {
      let targetImg = null;
      if (msg.index !== undefined && msg.index !== null) {
        targetImg = document.querySelector(`img[data-open-sesame-index="${msg.index}"]`);
      }
      if (!targetImg && msg.src) {
        document.querySelectorAll("img").forEach((img) => {
          if (ImageDetector.resolvedSrc(img) === msg.src) targetImg = img;
        });
      }
      if (!targetImg && msg.assetId) {
        overlays.forEach((record, img) => {
          if (record.assetId === msg.assetId) targetImg = img;
        });
      }
      if (targetImg) {
        const record = overlays.get(targetImg);
        if (record && record.controller && record.controller.highlightAndScroll) {
          record.controller.highlightAndScroll();
        } else {
          targetImg.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return true;
    }
    if (msg.type === "ASSET_BINDING_CHANGED" && msg.assetId) {
      const targetId = msg.canonicalId || msg.assetId;
      lookupBinding(targetId).then((res) => {
        overlays.forEach((record) => {
          if (
            record.assetId === msg.assetId ||
            record.assetId === msg.canonicalId ||
            (res.canonicalAssetId && record.assetId === res.canonicalAssetId)
          ) {
            if (res.canonicalAssetId) record.assetId = res.canonicalAssetId;
            if (res.found && res.bindings && res.bindings.length) {
              record.controller.setBindings(res.bindings, res.userId);
            } else {
              record.controller.setBinding(null);
            }
          }
        });
      });
    }
    if (msg.type === "GLOBAL_BINDINGS_UPDATED") {
      syncActiveOverlays();
    }
    if (msg.type === "TOGGLE_INTERACTIONS") {
      interactionsEnabled = msg.enabled;
      overlays.forEach((record) => {
        record.controller.setInteractionsEnabled(msg.enabled);
      });
    }
  });
})();
