const imagePickerEl = document.getElementById("imagePicker");
const tabs = document.querySelectorAll(".tab");
const list = document.getElementById("list");
const selectedInteractionEl = document.getElementById("selectedInteraction");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const modeTabs = document.querySelectorAll(".mode-tab");
const bindPanel = document.getElementById("bindPanel");
const bindingsPanel = document.getElementById("bindingsPanel");
const bindingsList = document.getElementById("bindingsList");
const bindingsStatus = document.getElementById("bindingsStatus");
const toggleBtn = document.getElementById("toggleInteractions");

let activeTab = "local";
let selectedInteraction = null;
let selectedImage = null; // { src, width, height }
let localItems = [];
let globalItems = [];
let globalLoaded = false;

// ---- Stop / Resume toggle ----
let interactionsEnabled = true;
chrome.storage.local.get({ interactionsEnabled: true }, (res) => {
  interactionsEnabled = res.interactionsEnabled !== false;
  syncToggleBtn();
});

function syncToggleBtn() {
  if (interactionsEnabled) {
    toggleBtn.textContent = "▶ On";
    toggleBtn.classList.remove("paused");
    toggleBtn.title = "Interactions are active — click to pause all";
  } else {
    toggleBtn.textContent = "⏸ Off";
    toggleBtn.classList.add("paused");
    toggleBtn.title = "Interactions are paused — click to resume all";
  }
}

toggleBtn.addEventListener("click", () => {
  interactionsEnabled = !interactionsEnabled;
  chrome.runtime.sendMessage({ type: "TOGGLE_INTERACTIONS", enabled: interactionsEnabled });
  syncToggleBtn();
});

// 1. Scan current tab for images
function scanPageImages() {
  imagePickerEl.innerHTML = `<div class="empty">Scanning page for images…</div>`;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
    if (!tabsList[0] || !tabsList[0].id) {
      imagePickerEl.innerHTML = `<div class="empty">Cannot scan this page</div>`;
      return;
    }
    chrome.tabs.sendMessage(tabsList[0].id, { type: "GET_PAGE_IMAGES" }, (res) => {
      if (chrome.runtime.lastError || !res || !res.images || !res.images.length) {
        imagePickerEl.innerHTML = `<div class="empty">No suitable images found on this page</div>`;
        return;
      }
      renderImagePicker(res.images);
    });
  });
}

function renderImagePicker(images) {
  imagePickerEl.innerHTML = "";
  images.forEach((img, idx) => {
    const thumb = document.createElement("img");
    thumb.className = "img-thumb" + (idx === 0 ? " selected" : "");
    thumb.src = img.src;
    thumb.title = `${img.width}x${img.height}px`;
    thumb.onclick = () => {
      document.querySelectorAll(".img-thumb").forEach((t) => t.classList.remove("selected"));
      thumb.classList.add("selected");
      selectedImage = img;
    };
    imagePickerEl.appendChild(thumb);
  });
  selectedImage = images[0];
}

function renderSelected() {
  selectedInteractionEl.textContent = selectedInteraction
    ? `Selected: "${selectedInteraction.name}"`
    : "";
}

function renderList() {
  if (activeTab === "new") {
    list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "empty";
    item.innerHTML = `Opens the interaction editor in a new tab.<br>Write HTML/CSS/JS, preview it live, then come back here to bind it.`;
    list.appendChild(item);
    return;
  }

  const items = activeTab === "local" ? localItems : globalItems;
  list.innerHTML = "";
  if (activeTab === "global" && !globalLoaded) {
    list.innerHTML = `<div class="empty">Loading global gallery…</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty">${
      activeTab === "local" ? "No saved interactions yet." : "Nothing published yet."
    }</div>`;
    return;
  }
  items.forEach((it) => {
    const el = document.createElement("div");
    el.className = "item" + (selectedInteraction && selectedInteraction._key === it._key ? " selected" : "");

    const name = document.createElement("span");
    name.className = "item-name";
    name.textContent = it.name;
    el.appendChild(name);

    // Edit button for user's custom interactions (those with a local id)
    if (activeTab === "local" && it.id && !it._isBuiltIn) {
      const editBtn = document.createElement("button");
      editBtn.className = "item-edit";
      editBtn.textContent = "✏ Edit";
      editBtn.title = "Open in editor";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?localId=${it.id}`) });
      });
      el.appendChild(editBtn);
    }

    el.addEventListener("click", () => {
      selectedInteraction = it;
      renderList();
      renderSelected();
    });
    list.appendChild(el);
  });
}

async function loadLocal() {
  const { myInteractions = [] } = await chrome.storage.local.get("myInteractions");
  // Include built-in templates in local library
  const builtIns = typeof GLOBAL_TEMPLATES !== "undefined" ? GLOBAL_TEMPLATES : [];
  const builtInItems = builtIns.map((i) => ({ ...i, _key: "local:" + (i.id || i.name), _isBuiltIn: true }));
  const userItems = myInteractions.map((i) => ({ ...i, _key: "local:" + (i.id || i.name), _isBuiltIn: false }));
  localItems = [...builtInItems, ...userItems];
  if (activeTab === "local") renderList();
}

function loadGlobal() {
  if (globalLoaded) return;
  chrome.runtime.sendMessage({ type: "LIST_GLOBAL_INTERACTIONS" }, (res) => {
    globalLoaded = true;
    globalItems = (res && res.ok ? res.items : []).map((i) => ({ ...i, _key: "global:" + (i.id || i.name) }));
    if (activeTab === "global") renderList();
  });
}

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    if (activeTab === "new") {
      chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
      tabs.forEach((t) => t.classList.remove("active"));
      document.querySelector('[data-tab="local"]').classList.add("active");
      activeTab = "local";
    }
    if (activeTab === "global") loadGlobal();
    renderList();
  });
});

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    modeTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    bindPanel.hidden = mode !== "bind";
    bindingsPanel.hidden = mode !== "bindings";
    if (mode === "bindings") loadBindings();
  });
});

async function loadBindings() {
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const sorted = [...myBindings].sort((a, b) => (b.boundAt || "").localeCompare(a.boundAt || ""));
  bindingsList.innerHTML = "";
  if (!sorted.length) {
    bindingsList.innerHTML = `<div class="empty">You haven't bound any images from this browser yet.</div>`;
    return;
  }
  sorted.forEach((b) => {
    const row = document.createElement("div");
    row.className = "binding-item";

    const urlEl = document.createElement("div");
    urlEl.className = "binding-url";
    urlEl.textContent = b.url.length > 80 ? b.url.slice(0, 77) + "…" : b.url;
    row.appendChild(urlEl);

    const interactionEl = document.createElement("div");
    interactionEl.className = "binding-interaction";
    interactionEl.textContent = `★ ${b.interactionName || "Untitled"}`;
    row.appendChild(interactionEl);

    const removeBtn = document.createElement("button");
    removeBtn.className = "danger";
    removeBtn.textContent = "Remove Binding";
    removeBtn.onclick = () => removeBinding(b.assetId, b.pushId, b.url, row, removeBtn);
    row.appendChild(removeBtn);

    bindingsList.appendChild(row);
  });
}

async function removeBinding(assetId, pushId, url, row, btn) {
  btn.disabled = true;
  btn.textContent = "Removing…";
  chrome.runtime.sendMessage({ type: "DELETE_ASSET_BINDING", assetId, pushId }, async (res) => {
    if (res && res.ok) {
      const { myBindings = [] } = await chrome.storage.local.get("myBindings");
      const updated = pushId
        ? myBindings.filter((b) => b.pushId !== pushId)
        : myBindings.filter((b) => b.assetId !== assetId);
      await chrome.storage.local.set({ myBindings: updated });
      row.remove();
      if (!bindingsList.children.length) {
        bindingsList.innerHTML = `<div class="empty">You haven't bound any images from this browser yet.</div>`;
      }
      bindingsStatus.textContent = "Binding removed.";
    } else {
      btn.disabled = false;
      btn.textContent = "Remove Binding";
      bindingsStatus.textContent = "Failed to remove binding.";
    }
  });
}

saveBtn.addEventListener("click", async () => {
  if (!selectedImage || !selectedImage.src) {
    statusEl.textContent = "Select an image from the picker above first.";
    return;
  }
  if (!selectedInteraction) {
    statusEl.textContent = "Pick an interaction first.";
    return;
  }

  statusEl.textContent = "Identifying visual fingerprint…";
  chrome.runtime.sendMessage({ type: "IDENTIFY_ASSET", url: selectedImage.src }, (idRes) => {
    if (!idRes || !idRes.ok || !idRes.assetId) {
      statusEl.textContent = "Could not identify image fingerprint.";
      return;
    }
    const assetId = idRes.assetId;
    statusEl.textContent = "Saving universal binding…";

    const interaction = {
      name: selectedInteraction.name,
      html: selectedInteraction.html || "",
      css: selectedInteraction.css || "",
      js: selectedInteraction.js || "",
    };

    chrome.runtime.sendMessage(
      { type: "SAVE_ASSET_BINDING", assetId, url: selectedImage.src, interaction },
      async (saveRes) => {
        if (saveRes && saveRes.ok) {
          statusEl.textContent = `✓ Bound! Everyone across all devices can now interact with this image.`;
        } else {
          statusEl.textContent = "Failed to save binding.";
        }
      }
    );
  });
});

scanPageImages();
loadLocal();
renderList();
