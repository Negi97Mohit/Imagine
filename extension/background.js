importScripts("hash.js", "templates.js", "modules/config.js", "modules/identity.js");

const RTDB_URL = (typeof LOCKED_IMAGE_CONFIG !== "undefined" && LOCKED_IMAGE_CONFIG.FIREBASE_DATABASE_URL) || "https://wallofshame-500ef-default-rtdb.firebaseio.com";
const FIRESTORE_PROJECT_ID = (typeof LOCKED_IMAGE_CONFIG !== "undefined" && LOCKED_IMAGE_CONFIG.FIREBASE_PROJECT_ID) || "wallofshame-500ef";
const FIRESTORE_BASE = (typeof LOCKED_IMAGE_CONFIG !== "undefined" && LOCKED_IMAGE_CONFIG.FIRESTORE_BASE_URL) || `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT_ID}/databases/(default)/documents`;

// ---- Anonymous User ID ----
// Each browser install gets a stable random ID so we can tell "my item"
// from "someone else's" without requiring authentication.
let _anonUserId = null;
async function getAnonUserId() {
  if (_anonUserId) return _anonUserId;
  try {
    const { anonymousUserId } = await chrome.storage.local.get("anonymousUserId");
    if (anonymousUserId) {
      _anonUserId = anonymousUserId;
      return _anonUserId;
    }
  } catch (e) {}
  _anonUserId = crypto.randomUUID();
  try {
    await chrome.storage.local.set({ anonymousUserId: _anonUserId });
  } catch (e) {}
  return _anonUserId;
}
// Eagerly initialise on startup
getAnonUserId();

// ============================================================================
// FIRESTORE SERIALIZATION / DESERIALIZATION HELPERS
// Translates JavaScript objects to/from Firestore REST API typed values
// ============================================================================

function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFirestoreValue(fieldObj) {
  if (!fieldObj || typeof fieldObj !== "object") return null;
  if ("stringValue" in fieldObj) return fieldObj.stringValue;
  if ("booleanValue" in fieldObj) return fieldObj.booleanValue;
  if ("integerValue" in fieldObj) return parseInt(fieldObj.integerValue, 10);
  if ("doubleValue" in fieldObj) return fieldObj.doubleValue;
  if ("nullValue" in fieldObj) return null;
  if ("timestampValue" in fieldObj) return fieldObj.timestampValue;
  if ("mapValue" in fieldObj) {
    const res = {};
    const fields = fieldObj.mapValue?.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      res[k] = fromFirestoreValue(v);
    }
    return res;
  }
  if ("arrayValue" in fieldObj) {
    const arr = fieldObj.arrayValue?.values || [];
    return arr.map(fromFirestoreValue);
  }
  return null;
}

function jsDocToFirestoreDoc(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = toFirestoreValue(v);
    }
  }
  return { fields };
}

function firestoreDocToJsDoc(doc) {
  if (!doc || !doc.fields) return null;
  const res = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    res[k] = fromFirestoreValue(v);
  }
  // Extract ID from doc.name (".../documents/collection/docId")
  if (doc.name) {
    const parts = doc.name.split("/");
    res.id = res.id || parts[parts.length - 1];
  }
  return res;
}

// ============================================================================
// FIRESTORE: REDESIGN PRESETS PERSISTENCE & COMMUNITY SYNC
// ============================================================================

const PRESETS_COLLECTION = "redesign_presets";
let _presetsCache = null;
let _presetsCacheTime = 0;
const PRESETS_CACHE_TTL = 10000; // 10 seconds memory TTL

async function listCommunityPresets() {
  const now = Date.now();
  if (_presetsCache && now - _presetsCacheTime < PRESETS_CACHE_TTL) {
    return { ok: true, items: _presetsCache, fromCache: true };
  }

  // 1. Try fetching from Firestore REST API
  try {
    const url = `${FIRESTORE_BASE}/${PRESETS_COLLECTION}?pageSize=100`;
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const docs = data.documents || [];
      const items = docs
        .map(firestoreDocToJsDoc)
        .filter((item) => item && item.id && item.name);

      _presetsCache = items;
      _presetsCacheTime = now;

      // Save to chrome.storage.local for offline availability
      await chrome.storage.local.set({ communityPresetsCache: items, communityPresetsCacheTime: now });
      return { ok: true, items, fromCache: false };
    }
  } catch (e) {
    console.warn("[locked-image] Firestore listCommunityPresets error (fallback to local cache):", e);
  }

  // 2. Offline fallback to local chrome storage cache
  try {
    const { communityPresetsCache = [] } = await chrome.storage.local.get("communityPresetsCache");
    if (Array.isArray(communityPresetsCache) && communityPresetsCache.length) {
      _presetsCache = communityPresetsCache;
      _presetsCacheTime = now;
      return { ok: true, items: communityPresetsCache, fromCache: true, offline: true };
    }
  } catch (e) {}

  return { ok: true, items: [], fromCache: false, offline: true };
}

async function saveCommunityPreset(presetData) {
  if (!presetData || !presetData.name) {
    return { ok: false, message: "Invalid preset payload: name is required" };
  }

  const userId = await getAnonUserId();
  const id = presetData.id || "preset_" + crypto.randomUUID();
  const now = new Date().toISOString();

  const docData = {
    id,
    name: String(presetData.name).trim().slice(0, 80),
    category: String(presetData.category || "custom").trim(),
    theme: String(presetData.theme || "Custom Theme").trim(),
    description: String(presetData.description || "").trim().slice(0, 250),
    engineId: presetData.engineId || null,
    styles: presetData.styles && typeof presetData.styles === "object" ? presetData.styles : {},
    cssText: String(presetData.cssText || "").slice(0, 10000),
    scope: presetData.scope === "global" ? "global" : "page",
    createdBy: userId,
    createdAt: presetData.createdAt || now,
    updatedAt: now,
    version: 1,
    isCommunity: true,
  };

  // 1. Optimistically save to local cache
  try {
    const { communityPresetsCache = [] } = await chrome.storage.local.get("communityPresetsCache");
    const idx = communityPresetsCache.findIndex((p) => p.id === id);
    if (idx >= 0) {
      communityPresetsCache[idx] = { ...communityPresetsCache[idx], ...docData };
    } else {
      communityPresetsCache.unshift(docData);
    }
    await chrome.storage.local.set({ communityPresetsCache });
    _presetsCache = communityPresetsCache;
    _presetsCacheTime = Date.now();
  } catch (e) {}

  // 2. Persist to Firestore REST API (using PATCH with documentId to be idempotent)
  try {
    const url = `${FIRESTORE_BASE}/${PRESETS_COLLECTION}/${encodeURIComponent(id)}`;
    const body = jsDocToFirestoreDoc(docData);
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const savedDoc = await res.json();
      const parsed = firestoreDocToJsDoc(savedDoc);
      return { ok: true, item: parsed || docData, id };
    } else {
      console.warn("[locked-image] Firestore saveCommunityPreset status:", res.status);
    }
  } catch (e) {
    console.warn("[locked-image] Firestore saveCommunityPreset network error:", e);
  }

  // Succeeded locally even if offline/network failed
  return { ok: true, item: docData, id, offlineSaved: true };
}

async function deleteCommunityPreset(presetId) {
  if (!presetId) return { ok: false, message: "Preset ID required" };
  const userId = await getAnonUserId();

  // 1. Remove from local cache
  try {
    const { communityPresetsCache = [] } = await chrome.storage.local.get("communityPresetsCache");
    const updated = communityPresetsCache.filter((p) => p.id !== presetId);
    await chrome.storage.local.set({ communityPresetsCache: updated });
    _presetsCache = updated;
    _presetsCacheTime = Date.now();
  } catch (e) {}

  // 2. Delete from Firestore
  try {
    const url = `${FIRESTORE_BASE}/${PRESETS_COLLECTION}/${encodeURIComponent(presetId)}`;
    const res = await fetch(url, { method: "DELETE" });
    if (res.ok) {
      return { ok: true, id: presetId };
    }
  } catch (e) {
    console.warn("[locked-image] Firestore deleteCommunityPreset network error:", e);
  }

  return { ok: true, id: presetId, offlineDeleted: true };
}

// ============================================================================
// RTDB: SHARED PAGE REDESIGNS BY DOMAIN
// ============================================================================

function rtdbRedesignUrl(domain, pushId) {
  const base = `${RTDB_URL.replace(/\/$/, "")}/redesigns/${encodeURIComponent(domain)}`;
  return pushId ? `${base}/${encodeURIComponent(pushId)}.json` : `${base}.json`;
}

async function saveRedesign(domain, entry) {
  if (!domain || !entry || !entry.selector) return { ok: false, message: "Invalid redesign payload" };
  const userId = await getAnonUserId();
  const payload = {
    selector: entry.selector,
    name: entry.name || "Untitled redesign",
    styles: entry.styles && typeof entry.styles === "object" ? entry.styles : {},
    cssText: entry.cssText || "",
    html: entry.html || "",
    engineId: entry.engineId || null,
    scope: entry.scope || "page",
    visibility: entry.visibility === "shared" ? "shared" : "private",
    createdBy: userId,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(rtdbRedesignUrl(domain), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, pushId: data.name, item: { ...payload, pushId: data.name, id: data.name } };
    }
  } catch (e) {
    console.warn("[locked-image] redesign save failed:", e);
  }
  return { ok: false };
}

async function listRedesignsForDomain(domain) {
  if (!domain) return { ok: true, items: [] };
  try {
    const res = await fetch(rtdbRedesignUrl(domain), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === "object") {
        return {
          ok: true,
          items: Object.entries(data).map(([pushId, v]) => ({
            ...v,
            pushId,
            id: pushId,
          })),
        };
      }
    }
  } catch (e) {
    console.warn("[locked-image] redesign list failed:", e);
  }
  return { ok: true, items: [] };
}

async function deleteRedesign(domain, pushId) {
  if (!domain || !pushId) return { ok: false };
  try {
    await fetch(rtdbRedesignUrl(domain, pushId), { method: "DELETE" });
    return { ok: true };
  } catch (e) {
    console.warn("[locked-image] redesign delete failed:", e);
  }
  return { ok: false };
}

async function setRedesignConsent(domain, pushId, decision) {
  const key = `redesignConsent:${domain}`;
  const store = await chrome.storage.local.get(key);
  const existing = store[key] || {};
  existing[pushId] = decision; // "applied" | "declined"
  await chrome.storage.local.set({ [key]: existing });
  return { ok: true };
}

async function setPendingRedesigns(tabId, domain, items) {
  if (tabId == null) return;
  if (chrome.storage.session) {
    await chrome.storage.session.set({ [`pendingRedesigns:${tabId}`]: { domain, items } });
  }
  try {
    if (items && items.length) {
      chrome.action.setBadgeText({ text: String(items.length), tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#b8410e", tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  } catch (e) {}
}

async function getPendingRedesigns(tabId) {
  if (tabId == null || !chrome.storage.session) return { domain: null, items: [] };
  const key = `pendingRedesigns:${tabId}`;
  const store = await chrome.storage.session.get(key);
  return store[key] || { domain: null, items: [] };
}

// ============================================================================
// RTDB: ASSET BINDINGS & PERCEPTUAL MATCHING
// ============================================================================

function rtdbBindingUrl(assetId, pushId) {
  const base = `${RTDB_URL.replace(/\/$/, "")}/bindings/${encodeURIComponent(assetId)}`;
  return pushId ? `${base}/${encodeURIComponent(pushId)}.json` : `${base}.json`;
}

function rtdbInteractionUrl(id) {
  const base = `${RTDB_URL.replace(/\/$/, "")}/interactions`;
  return id ? `${base}/${encodeURIComponent(id)}.json` : `${base}.json`;
}

let _allBindingsCache = null;
let _allBindingsCacheTime = 0;
const BINDINGS_CACHE_TTL = 5000; // 5s

async function fetchAllBindingsIndexed() {
  const now = Date.now();
  if (_allBindingsCache && now - _allBindingsCacheTime < BINDINGS_CACHE_TTL) {
    return _allBindingsCache;
  }
  try {
    const res = await fetch(`${RTDB_URL.replace(/\/$/, "")}/bindings.json?shallow=true`, { cache: "no-store" });
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

  // Strict visual matching
  for (const key of Object.keys(allBindings)) {
    if (key.startsWith("visual_")) {
      const keyHex = key.replace(/^visual_/, "");
      if (typeof isVisualMatch === "function" && isVisualMatch(targetHex, keyHex)) {
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

function normaliseBindings(data) {
  if (!data || typeof data !== "object") return [];
  if (data.interaction && typeof data.interaction === "object" && data.interaction.js !== undefined) {
    return [
      {
        pushId: "__legacy__",
        interaction: data.interaction,
        imageUrl: data.imageUrl || "",
        createdBy: data.createdBy || "unknown",
        updatedAt: data.updatedAt || "",
      },
    ];
  }
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

  const canonicalId = await resolveCanonicalAssetId(assetId);

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

  // Local cache fallback
  try {
    const local = await chrome.storage.local.get(`bindingCache:${assetId}`);
    const cached = local[`bindingCache:${assetId}`];
    if (cached && Array.isArray(cached) && cached.length) {
      return { found: true, bindings: cached, canonicalAssetId: canonicalId };
    }
  } catch (e) {}

  return { found: false, bindings: [], canonicalAssetId: canonicalId };
}

async function saveBindingByAsset(assetId, imageUrl, interaction) {
  if (!interaction || typeof interaction !== "object" || !interaction.name) {
    return { ok: false, message: "Invalid interaction payload schema" };
  }

  const userId = await getAnonUserId();
  const canonicalId = await resolveCanonicalAssetId(assetId);

  const existingLookup = await lookupBindingsByAsset(canonicalId);
  const existingList = existingLookup && existingLookup.found ? existingLookup.bindings : [];

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

  const userExisting = existingList.find((b) => b.createdBy === userId);

  let pushId = userExisting ? userExisting.pushId : null;
  const entry = {
    interaction,
    imageUrl: imageUrl || "",
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  };

  if (userExisting && pushId && !pushId.startsWith("__") && !pushId.startsWith("local_")) {
    try {
      await fetch(rtdbBindingUrl(canonicalId, pushId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
    } catch (e) {
      console.warn("[locked-image] RTDB update failed:", e);
    }
  } else {
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

  _allBindingsCacheTime = 0;

  const otherBindings = existingList.filter((b) => b.createdBy !== userId && b.pushId !== pushId);
  const updatedBindings = [{ ...entry, pushId }, ...otherBindings];
  await chrome.storage.local.set({
    [`bindingCache:${assetId}`]: updatedBindings,
    [`bindingCache:${canonicalId}`]: updatedBindings,
  });

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

  _allBindingsCache = null;
  _allBindingsCacheTime = 0;
  await chrome.storage.local.remove([`bindingCache:${assetId}`, `bindingCache:${canonicalId}`]);

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

// ---- Lifecycle & Message Dispatcher ----

chrome.runtime.onInstalled.addListener(() => {
  getAnonUserId();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  // Identity & Assets
  if (msg.type === "IDENTIFY_ASSET") {
    if (typeof identifyAsset === "function") {
      identifyAsset(msg.url, msg.directHash).then(sendResponse);
    } else {
      sendResponse({ ok: false });
    }
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

  // Asset Bindings
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

  // Global Interactions Gallery
  if (msg.type === "PUBLISH_INTERACTION") {
    publishInteraction(msg.interaction).then(sendResponse);
    return true;
  }
  if (msg.type === "LIST_GLOBAL_INTERACTIONS") {
    listGlobalInteractions().then(sendResponse);
    return true;
  }

  // Community Presets (Firestore)
  if (msg.type === "LIST_COMMUNITY_PRESETS") {
    listCommunityPresets().then(sendResponse);
    return true;
  }
  if (msg.type === "SAVE_COMMUNITY_PRESET") {
    saveCommunityPreset(msg.preset).then(sendResponse);
    return true;
  }
  if (msg.type === "DELETE_COMMUNITY_PRESET") {
    deleteCommunityPreset(msg.presetId).then(sendResponse);
    return true;
  }

  // Domain Redesigns
  if (msg.type === "SAVE_REDESIGN") {
    saveRedesign(msg.domain, msg.entry).then(sendResponse);
    return true;
  }
  if (msg.type === "GET_REDESIGNS_FOR_DOMAIN") {
    listRedesignsForDomain(msg.domain).then(sendResponse);
    return true;
  }
  if (msg.type === "DELETE_REDESIGN") {
    deleteRedesign(msg.domain, msg.pushId).then(sendResponse);
    return true;
  }
  if (msg.type === "SET_REDESIGN_CONSENT") {
    setRedesignConsent(msg.domain, msg.pushId, msg.decision).then((res) => {
      const tabId = sender.tab && sender.tab.id;
      if (tabId != null) {
        getPendingRedesigns(tabId).then(({ domain, items }) => {
          const remaining = (items || []).filter((it) => it.pushId !== msg.pushId);
          setPendingRedesigns(tabId, domain, remaining);
        });
      }
      sendResponse(res);
    });
    return true;
  }
  if (msg.type === "SET_PENDING_REDESIGNS") {
    const tabId = sender.tab && sender.tab.id;
    setPendingRedesigns(tabId, msg.domain, msg.items).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === "GET_PENDING_REDESIGNS") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tabId = tabs[0] && tabs[0].id;
      const res = await getPendingRedesigns(tabId);
      sendResponse({ ...res, tabId });
    });
    return true;
  }
});

