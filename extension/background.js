importScripts("hash.js", "templates.js", "modules/config.js", "modules/identity.js");

const RTDB_URL = (typeof LOCKED_IMAGE_CONFIG !== "undefined" && LOCKED_IMAGE_CONFIG.FIREBASE_DATABASE_URL) || "https://wallofshame-500ef-default-rtdb.firebaseio.com";
const FIRESTORE_PROJECT_ID = (typeof LOCKED_IMAGE_CONFIG !== "undefined" && LOCKED_IMAGE_CONFIG.FIREBASE_PROJECT_ID) || "wallofshame-500ef";

// ---- Anonymous User ID ----
// Each browser install gets a stable random ID so we can tell "my binding"
// from "someone else's" without requiring auth.
let _anonUserId = null;
async function getAnonUserId() {
  if (_anonUserId) return _anonUserId;
  const { anonymousUserId } = await chrome.storage.local.get("anonymousUserId");
  if (anonymousUserId) {
    _anonUserId = anonymousUserId;
    return _anonUserId;
  }
  _anonUserId = crypto.randomUUID();
  await chrome.storage.local.set({ anonymousUserId: _anonUserId });
  return _anonUserId;
}
// Eagerly initialise on startup
getAnonUserId();

function rtdbBindingUrl(assetId, pushId) {
  const base = `${RTDB_URL.replace(/\/$/, "")}/bindings/${encodeURIComponent(assetId)}`;
  return pushId ? `${base}/${encodeURIComponent(pushId)}.json` : `${base}.json`;
}

function rtdbInteractionUrl(id) {
  const base = `${RTDB_URL.replace(/\/$/, "")}/interactions`;
  return id ? `${base}/${encodeURIComponent(id)}.json` : `${base}.json`;
}

function firestoreDocUrl(assetId) {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents/bindings/${assetId}`;
}

// ---- Multi-Binding & Fuzzy Perceptual Helpers ----
let _allBindingsCache = null;
let _allBindingsCacheTime = 0;
const BINDINGS_CACHE_TTL = 3000; // 3s

async function fetchAllBindingsIndexed() {
  const now = Date.now();
  if (_allBindingsCache && now - _allBindingsCacheTime < BINDINGS_CACHE_TTL) {
    return _allBindingsCache;
  }
  try {
    const res = await fetch(`${RTDB_URL.replace(/\/$/, "")}/bindings.json`, { cache: "no-store" });
    if (res.ok) {
      _allBindingsCache = (await res.json()) || {};
      _allBindingsCacheTime = now;
      return _allBindingsCache;
    }
  } catch (e) {
    console.warn("[locked-image] Failed to fetch bindings index:", e);
  }
  return _allBindingsCache || {};
}

async function resolveCanonicalAssetId(assetId) {
  if (!assetId) return assetId;
  if (!assetId.startsWith("visual_")) return assetId;
  const targetHex = assetId.replace(/^visual_/, "");
  const allBindings = await fetchAllBindingsIndexed();
  if (allBindings[assetId]) return assetId;

  // Strict visual matching: Aspect ratio + dHash <= 1 + color correlation
  for (const key of Object.keys(allBindings)) {
    if (key.startsWith("visual_")) {
      const keyHex = key.replace(/^visual_/, "");
      if (isVisualMatch(targetHex, keyHex)) {
        return key;
      }
    }
  }
  return assetId;
}

function broadcastBindingChanged(assetId, canonicalId) {
  _allBindingsCache = null;
  _allBindingsCacheTime = 0;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(
        tab.id,
        { type: "ASSET_BINDING_CHANGED", assetId, canonicalId: canonicalId || assetId },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }
  });
}

function normaliseBindings(data) {
  if (!data || typeof data !== "object") return [];
  // Old single-binding format — has "interaction" at top level
  if (data.interaction && typeof data.interaction === "object" && data.interaction.js !== undefined) {
    return [{
      pushId: "__legacy__",
      interaction: data.interaction,
      imageUrl: data.imageUrl || "",
      createdBy: data.createdBy || "unknown",
      updatedAt: data.updatedAt || "",
    }];
  }
  // New multi-binding format
  const results = [];
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === "object" && val.interaction) {
      results.push({
        pushId: key,
        interaction: val.interaction,
        imageUrl: val.imageUrl || "",
        createdBy: val.createdBy || "unknown",
        updatedAt: val.updatedAt || "",
      });
    }
  }
  return results;
}

async function lookupBindingsByAsset(assetId) {
  if (!assetId) return { found: false, bindings: [] };

  // 1. Resolve canonical asset ID (strict perceptual matching)
  const canonicalId = await resolveCanonicalAssetId(assetId);

  // 2. Try Firebase Realtime Database with canonical ID
  try {
    const res = await fetch(rtdbBindingUrl(canonicalId), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const bindings = normaliseBindings(data);
      if (bindings.length) {
        await chrome.storage.local.set({
          [`bindingCache:${assetId}`]: bindings,
          [`bindingCache:${canonicalId}`]: bindings,
        });
        return { found: true, bindings, canonicalAssetId: canonicalId };
      }
    }
  } catch (e) {
    console.warn("[locked-image] RTDB lookup failed:", e);
  }

  // 3. Fallback to local cache
  const local = await chrome.storage.local.get(`bindingCache:${assetId}`);
  const cached = local[`bindingCache:${assetId}`];
  if (cached && Array.isArray(cached) && cached.length) {
    return { found: true, bindings: cached, canonicalAssetId: canonicalId };
  }

  return { found: false, bindings: [], canonicalAssetId: canonicalId };
}

async function saveBindingByAsset(assetId, imageUrl, interaction) {
  if (!interaction || typeof interaction !== "object" || !interaction.name || typeof interaction.js !== "string") {
    return { ok: false, message: "Invalid interaction payload schema" };
  }

  const userId = await getAnonUserId();

  // Resolve canonical ID so we merge into existing asset if visually identical
  const canonicalId = await resolveCanonicalAssetId(assetId);

  // 1. Check existing bindings for this asset
  const existingLookup = await lookupBindingsByAsset(canonicalId);
  const existingList = existingLookup && existingLookup.found ? existingLookup.bindings : [];

  // 2. Check if this exact interaction is already applied to this image by someone else
  const normName = (interaction.name || "").trim().toLowerCase();
  const duplicate = existingList.find(
    (b) => (b.interaction?.name || "").trim().toLowerCase() === normName
  );

  if (duplicate && duplicate.createdBy !== userId) {
    return {
      ok: false,
      alreadyApplied: true,
      existingBinding: duplicate,
      message: `"${interaction.name}" has already been applied to this image by another user.`,
    };
  }

  // 3. Check if current user already has a binding on this asset (enforce 1 per user)
  const userExisting = existingList.find((b) => b.createdBy === userId);

  let pushId = userExisting ? userExisting.pushId : null;
  const entry = {
    interaction,
    imageUrl: imageUrl || "",
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  };

  // If updating existing binding
  if (userExisting && pushId && !pushId.startsWith("__") && !pushId.startsWith("local_")) {
    try {
      const res = await fetch(rtdbBindingUrl(canonicalId, pushId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (!res.ok) {
        console.warn("[locked-image] RTDB update failed with status:", res.status);
      }
    } catch (e) {
      console.warn("[locked-image] RTDB update failed:", e);
    }
  } else {
    // New binding: POST to RTDB (auto-generates pushId)
    try {
      const res = await fetch(rtdbBindingUrl(canonicalId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      if (res.ok) {
        const data = await res.json();
        pushId = data.name;
      }
    } catch (e) {
      console.warn("[locked-image] RTDB save failed:", e);
    }
  }

  if (!pushId) pushId = userExisting ? userExisting.pushId : "local_" + crypto.randomUUID();

  // Invalidate in-memory cache to ensure fresh reads
  _allBindingsCacheTime = 0;

  // 4. Update local cache
  const otherBindings = existingList.filter((b) => b.createdBy !== userId && b.pushId !== pushId);
  const updatedBindings = [{ ...entry, pushId }, ...otherBindings];
  await chrome.storage.local.set({
    [`bindingCache:${assetId}`]: updatedBindings,
    [`bindingCache:${canonicalId}`]: updatedBindings,
  });

  // 5. Update myBindings list
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const filteredMyBindings = myBindings.filter((b) => b.assetId !== canonicalId && b.assetId !== assetId);
  filteredMyBindings.unshift({
    assetId: canonicalId,
    pushId,
    url: imageUrl || "",
    interactionName: interaction.name || "Untitled",
    createdBy: userId,
    boundAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ myBindings: filteredMyBindings });

  return { ok: true, assetId: canonicalId, pushId, isUpdate: !!userExisting };
}

async function deleteBindingByAsset(assetId, pushId) {
  const canonicalId = await resolveCanonicalAssetId(assetId);

  // 1. If we have a specific pushId, delete just that entry from canonical and raw IDs
  if (pushId && pushId !== "__legacy__" && pushId !== "__cache__") {
    try {
      await fetch(rtdbBindingUrl(canonicalId, pushId), { method: "DELETE" });
    } catch (e) {}
    if (canonicalId !== assetId) {
      try {
        await fetch(rtdbBindingUrl(assetId, pushId), { method: "DELETE" });
      } catch (e) {}
    }
  } else {
    try {
      await fetch(rtdbBindingUrl(canonicalId), { method: "DELETE" });
    } catch (e) {}
    if (canonicalId !== assetId) {
      try {
        await fetch(rtdbBindingUrl(assetId), { method: "DELETE" });
      } catch (e) {}
    }
  }

  // 2. Remove from in-memory cache and local cache
  _allBindingsCache = null;
  _allBindingsCacheTime = 0;
  await chrome.storage.local.remove([`bindingCache:${assetId}`, `bindingCache:${canonicalId}`]);

  const userId = await getAnonUserId();
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const updated = pushId
    ? myBindings.filter((b) => b.pushId !== pushId)
    : myBindings.filter((b) => b.assetId !== assetId && b.assetId !== canonicalId);
  await chrome.storage.local.set({ myBindings: updated });

  return { ok: true, assetId: canonicalId };
}

async function fetchImageDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false };
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ ok: true, dataUrl: reader.result });
      reader.onerror = () => resolve({ ok: false });
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    return { ok: false };
  }
}

function broadcastBindingChanged(assetId, canonicalId) {
  _allBindingsCache = null;
  _allBindingsCacheTime = 0;
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(
        tab.id,
        { type: "ASSET_BINDING_CHANGED", assetId, canonicalId: canonicalId || assetId },
        () => {
          void chrome.runtime.lastError;
        }
      );
    }
  });
}

function broadcastToggleInteractions(enabled) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_INTERACTIONS", enabled }, () => {
        void chrome.runtime.lastError;
      });
    }
  });
}

// Global Gallery
async function publishInteraction(interaction) {
  const payload = {
    name: interaction.name || "Untitled",
    html: interaction.html || "",
    css: interaction.css || "",
    js: interaction.js || "",
    createdAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(rtdbInteractionUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, id: data.name };
    }
  } catch (e) {}

  return { ok: false };
}

async function listGlobalInteractions() {
  try {
    const res = await fetch(rtdbInteractionUrl(), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object") {
        const fetched = Object.keys(data).map((k) => ({ ...data[k], id: k }));
        return { ok: true, items: fetched };
      }
    }
  } catch (e) {
    console.warn("[locked-image] Failed to fetch global interactions from RTDB:", e);
  }

  return { ok: true, items: [] };
}

chrome.runtime.onInstalled.addListener(() => {
  getAnonUserId();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "IDENTIFY_ASSET") {
    identifyAsset(msg.url, msg.directHash).then(sendResponse);
    return true;
  }
  if (msg.type === "GET_ANON_USER_ID") {
    getAnonUserId().then((id) => sendResponse({ ok: true, userId: id }));
    return true;
  }
  if (msg.type === "FETCH_IMAGE_DATA_URL") {
    fetchImageDataUrl(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === "LOOKUP_ASSET_BINDING") {
    lookupBindingsByAsset(msg.assetId).then(async (res) => {
      if (res.found && res.bindings.length) {
        const userId = await getAnonUserId();
        const myBinding = res.bindings.find((b) => b.createdBy === userId);
        const defaultBinding = myBinding || res.bindings[0];
        sendResponse({
          found: true,
          binding: { assetId: msg.assetId, interaction: defaultBinding.interaction },
          bindings: res.bindings,
          canonicalAssetId: res.canonicalAssetId || msg.assetId,
          userId,
        });
      } else {
        sendResponse({ found: false, binding: null, bindings: [] });
      }
    });
    return true;
  }
  if (msg.type === "SAVE_ASSET_BINDING") {
    saveBindingByAsset(msg.assetId, msg.url, msg.interaction).then((res) => {
      if (res.ok) broadcastBindingChanged(msg.assetId, res.assetId);
      sendResponse(res);
    });
    return true;
  }
  if (msg.type === "DELETE_ASSET_BINDING") {
    deleteBindingByAsset(msg.assetId, msg.pushId).then((res) => {
      if (res.ok) broadcastBindingChanged(msg.assetId, res.assetId);
      sendResponse(res);
    });
    return true;
  }
  if (msg.type === "TOGGLE_INTERACTIONS") {
    chrome.storage.local.set({ interactionsEnabled: msg.enabled });
    broadcastToggleInteractions(msg.enabled);
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === "PUBLISH_INTERACTION") {
    publishInteraction(msg.interaction).then(sendResponse);
    return true;
  }
  if (msg.type === "LIST_GLOBAL_INTERACTIONS") {
    listGlobalInteractions().then(sendResponse);
    return true;
  }
});
