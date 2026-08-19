(function () {
  const overlays = new Map(); // img -> { assetId, controller }
  const identifying = new WeakSet();

  function identifyAsset(img) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: "IDENTIFY_ASSET", url: ImageDetector.resolvedSrc(img) },
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

    const controller = AssetOverlay.attach(img, assetId, {
      onBindInteraction: async (interaction) => {
        controller.setBinding(interaction);
        chrome.runtime.sendMessage({
          type: "SAVE_ASSET_BINDING",
          assetId,
          url: ImageDetector.resolvedSrc(img),
          interaction,
        });
      },
      onUnbind: async (pushId) => {
        chrome.runtime.sendMessage({
          type: "DELETE_ASSET_BINDING",
          assetId,
          pushId,
        });
        // Re-fetch remaining bindings after delete
        setTimeout(async () => {
          const res = await lookupBinding(assetId);
          if (res.found && res.bindings && res.bindings.length) {
            controller.setBindings(res.bindings);
          } else {
            controller.setBinding(null);
          }
        }, 500);
      },
    });

    overlays.set(img, { assetId, controller });

    const existing = await lookupBinding(assetId);
    if (existing && existing.found) {
      if (existing.bindings && existing.bindings.length) {
        controller.setBindings(existing.bindings);
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
    if (!res.ok || !res.assetId) return;
    await setupOverlay(img, res.assetId);
  }

  ImageDetector.start({ onCandidate });

  // Handle messages from popup or background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "GET_PAGE_IMAGES") {
      const images = [];
      document.querySelectorAll("img").forEach((img) => {
        const src = ImageDetector.resolvedSrc(img);
        const w = img.naturalWidth || img.width || img.offsetWidth || 0;
        const h = img.naturalHeight || img.height || img.offsetHeight || 0;
        if (src && w >= 140 && h >= 140) {
          images.push({ src, width: w, height: h, alt: img.alt || "" });
        }
      });
      sendResponse({ ok: true, images });
      return true;
    }
    if (msg.type === "ASSET_BINDING_CHANGED" && msg.assetId) {
      lookupBinding(msg.assetId).then((res) => {
        overlays.forEach((record) => {
          if (record.assetId === msg.assetId) {
            if (res.found && res.bindings && res.bindings.length) {
              record.controller.setBindings(res.bindings);
            } else {
              record.controller.setBinding(null);
            }
          }
        });
      });
    }
    if (msg.type === "TOGGLE_INTERACTIONS") {
      overlays.forEach((record) => {
        record.controller.setInteractionsEnabled(msg.enabled);
      });
    }
  });
})();
