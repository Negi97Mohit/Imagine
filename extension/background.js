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

// ---- Multi-Binding Helpers ----
// Old format: { assetId, imageUrl, interaction, updatedAt }
// New format: { <pushId>: { interaction, imageUrl, createdBy, updatedAt }, ... }
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
  // 1. Try Firebase Realtime Database
  try {
    const res = await fetch(rtdbBindingUrl(assetId), { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      const bindings = normaliseBindings(data);
      if (bindings.length) {
        await chrome.storage.local.set({ [`bindingCache:${assetId}`]: bindings });
        return { found: true, bindings };
      }
    }
  } catch (e) {
    console.warn("[locked-image] RTDB lookup failed:", e);
  }

  // 2. Fallback to Firestore (old single-binding)
  try {
    const res = await fetch(firestoreDocUrl(assetId), { cache: "no-store" });
    if (res.ok) {
      const doc = await res.json();
      const f = doc.fields || {};
      let interaction = null;
      if (f.interaction && f.interaction.stringValue) {
        try { interaction = JSON.parse(f.interaction.stringValue); } catch (err) {}
      }
      if (interaction) {
        const bindings = [{
          pushId: "__firestore__",
          interaction,
          imageUrl: f.imageUrl?.stringValue || "",
          createdBy: "unknown",
          updatedAt: f.updatedAt?.timestampValue || "",
        }];
        await chrome.storage.local.set({ [`bindingCache:${assetId}`]: bindings });
        return { found: true, bindings };
      }
    }
  } catch (e) {}

  // 3. Fallback to local cache
  const local = await chrome.storage.local.get(`bindingCache:${assetId}`);
  const cached = local[`bindingCache:${assetId}`];
  if (cached && Array.isArray(cached) && cached.length) {
    return { found: true, bindings: cached };
  }
  // Old cache format (single interaction object)
  if (cached && typeof cached === "object" && cached.js !== undefined) {
    return { found: true, bindings: [{ pushId: "__cache__", interaction: cached, imageUrl: "", createdBy: "unknown", updatedAt: "" }] };
  }
  return { found: false, bindings: [] };
}

async function saveBindingByAsset(assetId, imageUrl, interaction) {
  const userId = await getAnonUserId();

  // 1. Build the entry
  const entry = {
    interaction,
    imageUrl: imageUrl || "",
    createdBy: userId,
    updatedAt: new Date().toISOString(),
  };

  let pushId = null;

  // 2. Persist to Firebase Realtime Database (POST auto-generates a push ID)
  try {
    const res = await fetch(rtdbBindingUrl(assetId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    if (res.ok) {
      const data = await res.json();
      pushId = data.name; // Firebase returns { name: "<pushId>" }
    }
  } catch (e) {
    console.warn("[locked-image] RTDB save failed:", e);
  }

  if (!pushId) pushId = "local_" + crypto.randomUUID();

  // 3. Update local cache & myBindings
  await chrome.storage.local.set({ [`bindingCache:${assetId}`]: [{ ...entry, pushId }] });
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const filtered = myBindings.filter((b) => !(b.assetId === assetId && b.createdBy === userId));
  filtered.unshift({
    assetId,
    pushId,
    url: imageUrl || "",
    interactionName: interaction.name || "Untitled",
    createdBy: userId,
    boundAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({ myBindings: filtered });

  return { ok: true, assetId, pushId };
}

async function deleteBindingByAsset(assetId, pushId) {
  // 1. If we have a specific pushId, delete just that entry
  if (pushId && pushId !== "__legacy__" && pushId !== "__firestore__" && pushId !== "__cache__") {
    try {
      await fetch(rtdbBindingUrl(assetId, pushId), { method: "DELETE" });
    } catch (e) {}
  } else {
    // Legacy: delete the whole node
    try {
      await fetch(rtdbBindingUrl(assetId), { method: "DELETE" });
    } catch (e) {}
    try {
      await fetch(firestoreDocUrl(assetId), { method: "DELETE" });
    } catch (e) {}
  }

  // 2. Remove from local cache & myBindings
  await chrome.storage.local.remove(`bindingCache:${assetId}`);
  const userId = await getAnonUserId();
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const updated = pushId
    ? myBindings.filter((b) => b.pushId !== pushId)
    : myBindings.filter((b) => b.assetId !== assetId);
  await chrome.storage.local.set({ myBindings: updated });

  return { ok: true };
}

function broadcastBindingChanged(assetId) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, { type: "ASSET_BINDING_CHANGED", assetId }, () => {
        void chrome.runtime.lastError;
      });
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
        const seenNames = new Set(fetched.map((it) => it.name));
        const merged = [...fetched];
        if (typeof GLOBAL_TEMPLATES !== "undefined") {
          GLOBAL_TEMPLATES.forEach((t) => {
            if (!seenNames.has(t.name)) merged.push(t);
          });
        }
        return { ok: true, items: merged };
      }
    }
  } catch (e) {}

  return { ok: true, items: typeof GLOBAL_TEMPLATES !== "undefined" ? GLOBAL_TEMPLATES : [] };
}

async function seedGlobalTemplates() {
  if (typeof GLOBAL_TEMPLATES === "undefined" || !GLOBAL_TEMPLATES.length) return;
  try {
    const res = await fetch(rtdbInteractionUrl(), { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) || {};
    const existingNames = new Set(Object.values(data).map((d) => d.name));

    for (const t of GLOBAL_TEMPLATES) {
      if (!existingNames.has(t.name)) {
        await publishInteraction(t);
      }
    }
  } catch (e) {}
}

chrome.runtime.onInstalled.addListener(() => {
  seedGlobalTemplates();
  // Ensure anon user ID exists on install
  getAnonUserId();
});
seedGlobalTemplates();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "IDENTIFY_ASSET") {
    identifyAsset(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === "GET_ANON_USER_ID") {
    getAnonUserId().then((id) => sendResponse({ ok: true, userId: id }));
    return true;
  }
  if (msg.type === "LOOKUP_ASSET_BINDING") {
    // Backward compat: return first binding as "binding" + full list as "bindings"
    lookupBindingsByAsset(msg.assetId).then((res) => {
      if (res.found && res.bindings.length) {
        sendResponse({
          found: true,
          binding: { assetId: msg.assetId, interaction: res.bindings[0].interaction },
          bindings: res.bindings,
        });
      } else {
        sendResponse({ found: false, binding: null, bindings: [] });
      }
    });
    return true;
  }
  if (msg.type === "SAVE_ASSET_BINDING") {
    saveBindingByAsset(msg.assetId, msg.url, msg.interaction).then((res) => {
      if (res.ok) broadcastBindingChanged(msg.assetId);
      sendResponse(res);
    });
    return true;
  }
  if (msg.type === "DELETE_ASSET_BINDING") {
    deleteBindingByAsset(msg.assetId, msg.pushId).then((res) => {
      if (res.ok) broadcastBindingChanged(msg.assetId);
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
