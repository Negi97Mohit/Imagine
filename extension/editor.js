const nameInput = document.getElementById("name");
const htmlCode = document.getElementById("htmlCode");
const cssCode = document.getElementById("cssCode");
const jsCode = document.getElementById("jsCode");
const previewImg = document.getElementById("previewImg");
const previewFrame = document.getElementById("previewFrame");
const runPreviewBtn = document.getElementById("runPreview");
const saveLocalBtn = document.getElementById("saveLocal");
const deleteLocalBtn = document.getElementById("deleteLocal");
const publishBtn = document.getElementById("publish");
const status = document.getElementById("status");
const previewError = document.getElementById("previewError");
const previewErrorText = document.getElementById("previewErrorText");
const editorTitle = document.getElementById("editorTitle");
const libList = document.getElementById("libList");
const newInteractionBtn = document.getElementById("newInteraction");
const libraryCol = document.getElementById("libraryCol");
const libraryHandle = document.getElementById("libraryHandle");
const pinLibraryBtn = document.getElementById("pinLibrary");
const editorBindingsList = document.getElementById("editorBindingsList");
const previewRawImg = document.getElementById("previewRawImg");
const pausePreviewBtn = document.getElementById("pausePreview");
const previewFootHint = document.getElementById("previewFootHint");

const params = new URLSearchParams(location.search);
let editingLocalId = params.get("localId");
const FALLBACK_PREVIEW_IMG =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?w=800&q=60";

let frameReady = false;
let initDone = false;
let savedSnapshot = null; // JSON of the last-saved (or freshly-loaded) interaction

function snapshot() {
  return JSON.stringify(currentInteraction());
}
function isDirty() {
  return savedSnapshot !== null && snapshot() !== savedSnapshot;
}

function setStatus(text) {
  status.textContent = text;
}

async function init() {
  previewImg.value = params.get("imageUrl") || FALLBACK_PREVIEW_IMG;

  if (editingLocalId) {
    const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
    const existing = myInteractions.find((i) => i.id === editingLocalId);
    if (existing) {
      nameInput.value = existing.name || "";
      htmlCode.value = existing.html || "";
      cssCode.value = existing.css || "";
      jsCode.value = existing.js || "";
      setStatus(`Editing "${existing.name}"`);
      if (editorTitle) editorTitle.innerHTML = `Editing &ldquo;<b>${existing.name}</b>&rdquo;`;
      deleteLocalBtn.hidden = false;
      savedSnapshot = snapshot();
      return;
    }
  }

  // Fresh interaction — pre-fill with the built-in starter template.
  nameInput.value = "";
  htmlCode.value = WATER_REVEAL_TEMPLATE.html;
  cssCode.value = WATER_REVEAL_TEMPLATE.css;
  jsCode.value = WATER_REVEAL_TEMPLATE.js;
  savedSnapshot = snapshot();
}

async function renderLibrary() {
  const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
  const sorted = [...myInteractions].sort((a, b) =>
    (b.createdAt || "").localeCompare(a.createdAt || "")
  );
  libList.innerHTML = "";
  if (!sorted.length) {
    libList.innerHTML = `<div class="lib-empty">No saved interactions yet.</div>`;
    return;
  }
  sorted.forEach((it) => {
    const row = document.createElement("div");
    row.className = "lib-item" + (it.id === editingLocalId ? " active" : "");

    const name = document.createElement("span");
    name.className = "lib-name";
    name.textContent = it.name || "Untitled";
    row.appendChild(name);

    const del = document.createElement("button");
    del.className = "lib-del";
    del.title = "Delete";
    del.textContent = "\u00d7";
    del.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete "${it.name || "Untitled"}"? This can't be undone.`)) return;
      const { myInteractions: current = [] } = await chrome.storage.local.get("myInteractions");
      await chrome.storage.local.set({
        myInteractions: current.filter((i) => i.id !== it.id),
      });
      if (it.id === editingLocalId) {
        // We just deleted the thing we're editing — start fresh, no dirty prompt.
        goToEditor(null, true);
        return;
      }
      renderLibrary();
    });
    row.appendChild(del);

    row.addEventListener("click", () => goToEditor(it.id));
    libList.appendChild(row);
  });
}

// ---- Autohide library sidebar ----
// Hover/focus reveals it (see CSS); the handle and the pin button both just
// toggle a persistent "stay open" state for anyone who'd rather not rely on
// hover (trackpad users, keyboard nav, touch).
function setSidebarPinned(pinned) {
  libraryCol.classList.toggle("pinned", pinned);
  pinLibraryBtn.setAttribute("aria-pressed", String(pinned));
}
libraryHandle.addEventListener("click", () => {
  setSidebarPinned(!libraryCol.classList.contains("pinned"));
});
pinLibraryBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  setSidebarPinned(!libraryCol.classList.contains("pinned"));
});

// ---- "My bindings" panel in the sidebar ----
// Same data the popup's "My Bindings" tab shows (chrome.storage.local,
// this browser only) — handy to have right here while you're mid-edit,
// without hopping back to the popup.
async function renderEditorBindings() {
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const sorted = [...myBindings].sort((a, b) => (b.boundAt || "").localeCompare(a.boundAt || ""));
  editorBindingsList.innerHTML = "";
  if (!sorted.length) {
    editorBindingsList.innerHTML = `<div class="lib-empty">You haven't bound any images from this browser yet.</div>`;
    return;
  }
  sorted.forEach((b) => {
    const row = document.createElement("div");
    row.className = "binding-row";

    const urlEl = document.createElement("div");
    urlEl.className = "b-url";
    urlEl.textContent = b.url.length > 70 ? b.url.slice(0, 67) + "…" : b.url;
    row.appendChild(urlEl);

    const nameEl = document.createElement("div");
    nameEl.className = "b-name";
    nameEl.textContent = `\u2192 ${b.interactionName || "Untitled"}`;
    row.appendChild(nameEl);

    const actions = document.createElement("div");
    actions.className = "b-actions";

    const previewBtn = document.createElement("button");
    previewBtn.textContent = "Preview here";
    previewBtn.title = "Load this bound image into the preview above";
    previewBtn.addEventListener("click", () => {
      previewImg.value = b.url;
      scheduleLivePreview();
    });
    actions.appendChild(previewBtn);

    const removeBtn = document.createElement("button");
    removeBtn.className = "danger";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", () => {
      if (!confirm("Unbind this image? Only your interaction is removed — anyone else's binding for the same image is untouched.")) return;
      removeBtn.disabled = true;
      removeBtn.textContent = "…";
      chrome.runtime.sendMessage({ type: "DELETE_ASSET_BINDING", assetId: b.assetId, pushId: b.pushId }, async (res) => {
        if (res && res.ok) {
          const { myBindings: current = [] } = await chrome.storage.local.get("myBindings");
          const updated = b.pushId
            ? current.filter((x) => x.pushId !== b.pushId)
            : current.filter((x) => x.assetId !== b.assetId);
          await chrome.storage.local.set({ myBindings: updated });
          renderEditorBindings();
        } else {
          removeBtn.disabled = false;
          removeBtn.textContent = "Remove";
          alert("Failed to remove binding.");
        }
      });
    });
    actions.appendChild(removeBtn);

    row.appendChild(actions);
    editorBindingsList.appendChild(row);
  });
}

// ---- Pause/resume the live preview ----
// The live preview normally keeps its sandboxed interaction running at all
// times (see the READY handler below) so you can see it without having to
// re-hover — but that sandboxed iframe sits on top of the whole preview
// box, which also blocks right-clicking the actual image underneath. Pause
// swaps the iframe out for a plain <img>, so the normal browser context
// menu (save image, open in new tab, inspect, …) works again; Resume swaps
// back and restarts the interaction from the current code.
let previewPaused = false;
function setPreviewPaused(paused) {
  previewPaused = paused;
  pausePreviewBtn.textContent = paused ? "Resume interaction" : "Pause interaction";
  pausePreviewBtn.classList.toggle("paused", paused);
  previewFrame.hidden = paused;
  previewRawImg.hidden = !paused;
  previewFootHint.textContent = paused
    ? "Interaction paused — right-click the image normally."
    : "Same sandbox the real extension uses.";
  if (paused) {
    hidePreviewError();
    previewRawImg.src = previewImg.value.trim() || FALLBACK_PREVIEW_IMG;
  } else if (frameReady && initDone) {
    runPreview();
  }
}
pausePreviewBtn.addEventListener("click", () => setPreviewPaused(!previewPaused));

function goToEditor(localId, skipDirtyCheck) {
  if (!skipDirtyCheck && isDirty() && !confirm("Discard unsaved changes to this interaction?")) return;
  const next = new URLSearchParams();
  if (previewImg.value.trim()) next.set("imageUrl", previewImg.value.trim());
  if (localId) next.set("localId", localId);
  location.href = "editor.html" + (next.toString() ? "?" + next.toString() : "");
}

newInteractionBtn.addEventListener("click", () => goToEditor(null));

function currentInteraction() {
  return {
    name: nameInput.value.trim() || "Untitled",
    html: htmlCode.value,
    css: cssCode.value,
    js: jsCode.value,
  };
}

function sendToPreview(type, extra) {
  if (!previewFrame.contentWindow) return;
  previewFrame.contentWindow.postMessage({ source: "locked-image-host", type, ...extra }, "*");
}

function hidePreviewError() {
  previewError.hidden = true;
}

function showPreviewError(message) {
  previewErrorText.textContent = message;
  previewError.hidden = false;
}

function runPreview() {
  hidePreviewError();
  const box = previewFrame.parentElement.getBoundingClientRect();
  const previewUrl = previewImg.value.trim() || FALLBACK_PREVIEW_IMG;
  sendToPreview("INIT", {
    imageUrl: previewUrl,
    width: Math.round(box.width),
    height: Math.round(box.height),
    interaction: currentInteraction(),
    config: {},
    bindingId: "editor-preview:" + previewUrl,
  });
}

// Live preview: re-run automatically as the person types, no button needed.
// Debounced so a fast typist isn't restarting the sandbox every keystroke.
let liveTimer = null;
function scheduleLivePreview() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    if (previewPaused) {
      // Interaction is stopped, but keep the plain image in sync with
      // whatever URL is now in the field.
      previewRawImg.src = previewImg.value.trim() || FALLBACK_PREVIEW_IMG;
      return;
    }
    if (frameReady && initDone) runPreview();
  }, 350);
}
[nameInput, htmlCode, cssCode, jsCode, previewImg].forEach((el) => {
  el.addEventListener("input", scheduleLivePreview);
});

window.addEventListener("message", (e) => {
  if (e.source !== previewFrame.contentWindow) return;
  const msg = e.data;
  if (!msg || msg.source !== "locked-image-sandbox") return;
  if (msg.type === "READY") {
    frameReady = true;
    if (initDone && !previewPaused) runPreview();
  }
  // In the editor we deliberately ignore LEAVE — the preview should keep
  // running so you can see the effect without having to re-hover.
  if (msg.type === "ERROR") {
    showPreviewError(msg.message || "Something went wrong running this interaction.");
  }
  if (msg.type === "OPEN_LINK") {
    try {
      const parsed = new URL(msg.url, location.href);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        window.open(parsed.href, "_blank", "noopener,noreferrer");
      }
    } catch (e) {}
  }
  if (msg.type === "STORAGE_GET" || msg.type === "STORAGE_SET") {
    const storageKey = `interactionData:${msg.bindingId}:${msg.key}`;
    if (msg.type === "STORAGE_GET") {
      chrome.storage.local.get(storageKey, (res) => {
        sendToPreview("STORAGE_RESULT", { requestId: msg.requestId, ok: true, value: res[storageKey] ?? null });
      });
    } else {
      chrome.storage.local.set({ [storageKey]: msg.value }, () => {
        sendToPreview("STORAGE_RESULT", { requestId: msg.requestId, ok: true, value: msg.value });
      });
    }
  }
});

previewFrame.src = chrome.runtime.getURL("sandbox.html");
// The preview already runs live as you type — this button is only for
// force-restarting the sandbox iframe itself (e.g. after it errors out
// hard enough to stop responding).
runPreviewBtn.addEventListener("click", () => {
  if (previewPaused) setPreviewPaused(false);
  frameReady = false;
  previewFrame.src = chrome.runtime.getURL("sandbox.html");
});
saveLocalBtn.addEventListener("click", async () => {
  const interaction = currentInteraction();
  const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
  if (editingLocalId) {
    const idx = myInteractions.findIndex((i) => i.id === editingLocalId);
    if (idx >= 0) {
      myInteractions[idx] = { ...myInteractions[idx], ...interaction };
    } else {
      myInteractions.push({ id: editingLocalId, ...interaction, createdAt: new Date().toISOString() });
    }
  } else {
    editingLocalId = crypto.randomUUID();
    myInteractions.push({
      id: editingLocalId,
      ...interaction,
      createdAt: new Date().toISOString(),
    });
    // Now that this has an id, keep the URL (and future saves) pointed at
    // it instead of silently creating duplicates on repeated "Save locally".
    const next = new URLSearchParams(location.search);
    next.set("localId", editingLocalId);
    history.replaceState(null, "", "editor.html?" + next.toString());
    if (editorTitle) editorTitle.innerHTML = `Editing &ldquo;<b>${interaction.name}</b>&rdquo;`;
    deleteLocalBtn.hidden = false;
  }
  await chrome.storage.local.set({ myInteractions });
  savedSnapshot = snapshot();
  setStatus(`Saved "${interaction.name}" to your local library. You can close this tab and bind it from the popup.`);
  renderLibrary();
});

deleteLocalBtn.addEventListener("click", async () => {
  if (!editingLocalId) return;
  const interaction = currentInteraction();
  if (!confirm(`Delete "${interaction.name}"? This can't be undone.`)) return;
  const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
  await chrome.storage.local.set({
    myInteractions: myInteractions.filter((i) => i.id !== editingLocalId),
  });
  goToEditor(null, true);
});

publishBtn.addEventListener("click", () => {
  const interaction = currentInteraction();
  setStatus("Publishing…");
  chrome.runtime.sendMessage({ type: "PUBLISH_INTERACTION", interaction }, (res) => {
    setStatus(
      res && res.ok
        ? `Published "${interaction.name}" — anyone with this extension can now find it in the global gallery.`
        : "Failed to publish — check FIREBASE_PROJECT_ID in background.js and your Firestore rules."
    );
  });
});

init().then(() => {
  initDone = true;
  if (frameReady && !previewPaused) runPreview();
});
renderLibrary();
renderEditorBindings();

// Theme toggle — must live in an external file, not inline, since MV3
// extension pages run under `script-src 'self'` with no inline exceptions.
(function () {
  const btn = document.getElementById("themeBtn");
  if (!btn) return;
  const root = document.documentElement;
  const saved = localStorage.getItem("locked-image-theme");
  if (saved) root.setAttribute("data-theme", saved);
  const sync = () => {
    btn.textContent = root.getAttribute("data-theme") === "dark" ? "Light Mode" : "Dark Mode";
  };
  sync();
  btn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("locked-image-theme", next);
    sync();
  });
})();
