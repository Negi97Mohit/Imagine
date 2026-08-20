const imageSelect = document.getElementById("imageSelect");
const pillTabs = document.querySelectorAll(".pill-tab");
const list = document.getElementById("list");
const selectedInteractionEl = document.getElementById("selectedInteraction");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");
const navTabs = document.querySelectorAll(".nav-tab");
const pageBindingsPanel = document.getElementById("pageBindingsPanel");
const pageBindingsList = document.getElementById("pageBindingsList");
const pageBindingsCount = document.getElementById("pageBindingsCount");
const bindPanel = document.getElementById("bindPanel");
const bindingsPanel = document.getElementById("bindingsPanel");
const bindingsList = document.getElementById("bindingsList");
const bindingsStatus = document.getElementById("bindingsStatus");
const toggleBtn = document.getElementById("toggleInteractions");
const toggleText = document.getElementById("toggleText");

let activeTab = "local";
let selectedInteraction = null;
let pageImages = [];
let selectedImage = null; // { src, width, height, index, assetId, hasBinding, interactionName }
let localItems = [];
let globalItems = [];
let globalLoaded = false;
let currentPageBindings = [];

// ---- Stop / Resume toggle ----
let interactionsEnabled = true;
chrome.storage.local.get({ interactionsEnabled: true }, (res) => {
  interactionsEnabled = res.interactionsEnabled !== false;
  syncToggleBtn();
});

function syncToggleBtn() {
  if (interactionsEnabled) {
    if (toggleText) toggleText.textContent = "Active";
    toggleBtn.classList.remove("paused");
    toggleBtn.title = "Interactions active — click to pause";
  } else {
    if (toggleText) toggleText.textContent = "Paused";
    toggleBtn.classList.add("paused");
    toggleBtn.title = "Interactions paused — click to resume";
  }
}

toggleBtn.addEventListener("click", () => {
  interactionsEnabled = !interactionsEnabled;
  chrome.runtime.sendMessage({ type: "TOGGLE_INTERACTIONS", enabled: interactionsEnabled });
  syncToggleBtn();
});

// 1. Scan current tab for images & active page bindings
function scanPageImages() {
  pageBindingsList.innerHTML = `<div class="empty-state"><div class="icon">✦</div>Scanning page for active interactions…</div>`;
  if (imageSelect) imageSelect.innerHTML = `<option value="">Scanning page images…</option>`;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
    if (!tabsList[0] || !tabsList[0].id) {
      pageBindingsList.innerHTML = `<div class="empty-state">Cannot access this page</div>`;
      if (imageSelect) imageSelect.innerHTML = `<option value="">Cannot scan page</option>`;
      updatePageBindingsCount([]);
      return;
    }
    chrome.tabs.sendMessage(tabsList[0].id, { type: "GET_PAGE_DATA" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        pageBindingsList.innerHTML = `<div class="empty-state">No interactions active on this page.</div>`;
        if (imageSelect) imageSelect.innerHTML = `<option value="">No suitable images found</option>`;
        updatePageBindingsCount([]);
        return;
      }

      pageImages = res.images || [];
      const pageBindings = res.pageBindings || [];
      currentPageBindings = pageBindings;

      updatePageBindingsCount(pageBindings);
      renderPageBindingsList(pageBindings);
      populateImageSelect(pageImages);
    });
  });
}

function updatePageBindingsCount(pageBindings) {
  const count = pageBindings ? pageBindings.length : 0;
  if (pageBindingsCount) {
    pageBindingsCount.textContent = String(count);
    if (count > 0) {
      pageBindingsCount.classList.add("has-count");
    } else {
      pageBindingsCount.classList.remove("has-count");
    }
  }
}

function renderPageBindingsList(bindings) {
  pageBindingsList.innerHTML = "";
  if (!bindings || !bindings.length) {
    pageBindingsList.innerHTML = `
      <div class="empty-state">
        <div class="icon">✦</div>
        No active interactions on this page.<br><br>
        <button class="primary-btn" style="width: auto; margin: 0 auto; padding: 7px 14px;" id="jumpToBindBtn">+ Bind an Image</button>
      </div>
    `;
    const jumpBtn = document.getElementById("jumpToBindBtn");
    if (jumpBtn) {
      jumpBtn.onclick = () => {
        const bindTab = document.querySelector('[data-mode="bind"]');
        if (bindTab) bindTab.click();
      };
    }
    return;
  }

  bindings.forEach((b, idx) => {
    const card = document.createElement("div");
    card.className = "binding-card";

    const left = document.createElement("div");
    left.className = "card-left";

    const icon = document.createElement("div");
    icon.className = "card-icon";
    icon.textContent = "★";
    left.appendChild(icon);

    const info = document.createElement("div");
    info.className = "card-info";

    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = b.interactionName;
    info.appendChild(title);

    const sub = document.createElement("div");
    sub.className = "card-sub";
    const variationText = b.bindingsCount > 1 ? ` • ${b.bindingsCount} variations` : "";
    sub.textContent = `Image #${(b.index ?? idx) + 1}${variationText}`;
    info.appendChild(sub);

    left.appendChild(info);
    card.appendChild(left);

    const action = document.createElement("div");
    action.className = "card-action-btn";
    action.textContent = "Jump ↗";
    card.appendChild(action);

    card.addEventListener("click", () => {
      document.querySelectorAll(".binding-card").forEach((c) => c.classList.remove("scrolled-active"));
      card.classList.add("scrolled-active");
      action.textContent = "✓ In View";

      chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
        if (tabsList[0] && tabsList[0].id) {
          chrome.tabs.sendMessage(
            tabsList[0].id,
            { type: "SCROLL_TO_IMAGE", index: b.index, src: b.src, assetId: b.assetId },
            () => {
              setTimeout(() => {
                action.textContent = "Jump ↗";
              }, 2000);
            }
          );
        }
      });
    });

    pageBindingsList.appendChild(card);
  });
}

function populateImageSelect(images) {
  if (!imageSelect) return;
  imageSelect.innerHTML = "";
  if (!images || !images.length) {
    imageSelect.innerHTML = `<option value="">No candidate images on page</option>`;
    selectedImage = null;
    return;
  }

  images.forEach((img, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    const label = `Image #${idx + 1} (${img.width}×${img.height}px)` + (img.hasBinding ? ` — ★ ${img.interactionName || "Bound"}` : "");
    opt.textContent = label;
    imageSelect.appendChild(opt);
  });

  selectedImage = images[0];

  imageSelect.onchange = () => {
    const chosenIdx = parseInt(imageSelect.value, 10);
    if (!isNaN(chosenIdx) && images[chosenIdx]) {
      selectedImage = images[chosenIdx];
      // Highlight & center selected image on page
      chrome.tabs.query({ active: true, currentWindow: true }, (tabsList) => {
        if (tabsList[0] && tabsList[0].id) {
          chrome.tabs.sendMessage(tabsList[0].id, {
            type: "SCROLL_TO_IMAGE",
            index: selectedImage.index,
            src: selectedImage.src,
            assetId: selectedImage.assetId,
          });
        }
      });
    }
  };
}

function renderSelected() {
  if (selectedInteraction) {
    selectedInteractionEl.style.display = "block";
    selectedInteractionEl.innerHTML = `<span style="color:var(--muted);font-size:9.5px;text-transform:uppercase;letter-spacing:0.04em;">Selected:</span> <b style="color:var(--accent);font-size:11px;">★ ${selectedInteraction.name}</b>`;
  } else {
    selectedInteractionEl.style.display = "none";
    selectedInteractionEl.innerHTML = "";
  }
}

function renderList() {
  if (activeTab === "new") {
    list.innerHTML = "";
    const item = document.createElement("div");
    item.className = "empty-state";
    item.innerHTML = `Opens code editor in a new tab.<br>Build custom HTML/CSS/JS, test live, then bind it here.`;
    list.appendChild(item);
    return;
  }

  const items = activeTab === "local" ? localItems : globalItems;
  list.innerHTML = "";
  if (activeTab === "global" && !globalLoaded) {
    list.innerHTML = `<div class="empty-state">Loading global gallery…</div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty-state">${
      activeTab === "local" ? "No saved templates yet." : "Nothing published yet."
    }</div>`;
    return;
  }
  items.forEach((it) => {
    const el = document.createElement("div");
    el.className = "interaction-item" + (selectedInteraction && selectedInteraction._key === it._key ? " selected" : "");

    const name = document.createElement("span");
    name.textContent = it.name;
    el.appendChild(name);

    if (activeTab === "local" && it.id && !it._isBuiltIn) {
      const editLink = document.createElement("span");
      editLink.className = "edit-link";
      editLink.textContent = "Edit ↗";
      editLink.addEventListener("click", (e) => {
        e.stopPropagation();
        chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?localId=${it.id}`) });
      });
      el.appendChild(editLink);
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
  const builtIns = typeof GLOBAL_TEMPLATES !== "undefined" ? GLOBAL_TEMPLATES : [];
  const builtInItems = builtIns.map((i) => ({ ...i, _key: "local:" + (i.id || i.name), _isBuiltIn: true }));
  const userItems = myInteractions.map((i) => ({ ...i, _key: "local:" + (i.id || i.name), _isBuiltIn: false }));
  localItems = [...builtInItems, ...userItems];
  if (!selectedInteraction && localItems.length) {
    selectedInteraction = localItems[0];
  }
  if (activeTab === "local") renderList();
  renderSelected();
}

function loadGlobal() {
  if (globalLoaded) return;
  chrome.runtime.sendMessage({ type: "LIST_GLOBAL_INTERACTIONS" }, (res) => {
    globalLoaded = true;
    globalItems = (res && res.ok ? res.items : []).map((i) => ({ ...i, _key: "global:" + (i.id || i.name) }));
    if (activeTab === "global") renderList();
  });
}

pillTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    pillTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    activeTab = tab.dataset.tab;
    if (activeTab === "new") {
      chrome.tabs.create({ url: chrome.runtime.getURL("editor.html") });
      pillTabs.forEach((t) => t.classList.remove("active"));
      document.querySelector('[data-tab="local"]').classList.add("active");
      activeTab = "local";
    }
    if (activeTab === "global") loadGlobal();
    renderList();
  });
});

navTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    navTabs.forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    if (pageBindingsPanel) pageBindingsPanel.hidden = mode !== "pageBindings";
    if (bindPanel) bindPanel.hidden = mode !== "bind";
    if (bindingsPanel) bindingsPanel.hidden = mode !== "bindings";
    if (mode === "bindings") loadBindings();
    if (mode === "pageBindings") scanPageImages();
  });
});

async function loadBindings() {
  const { myBindings = [] } = await chrome.storage.local.get("myBindings");
  const sorted = [...myBindings].sort((a, b) => (b.boundAt || "").localeCompare(a.boundAt || ""));
  bindingsList.innerHTML = "";
  if (!sorted.length) {
    bindingsList.innerHTML = `<div class="empty-state">No saved bindings found.</div>`;
    return;
  }
  sorted.forEach((b) => {
    const card = document.createElement("div");
    card.className = "saved-binding-item";

    const name = document.createElement("div");
    name.className = "saved-binding-name";
    name.textContent = `★ ${b.interactionName || "Untitled"}`;
    card.appendChild(name);

    const url = document.createElement("div");
    url.className = "saved-binding-url";
    url.textContent = b.url.length > 70 ? b.url.slice(0, 67) + "…" : b.url;
    card.appendChild(url);

    const removeBtn = document.createElement("button");
    removeBtn.className = "danger-btn";
    removeBtn.textContent = "Remove";
    removeBtn.onclick = () => removeBinding(b.assetId, b.pushId, b.url, card, removeBtn);
    card.appendChild(removeBtn);

    bindingsList.appendChild(card);
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
        bindingsList.innerHTML = `<div class="empty-state">No saved bindings found.</div>`;
      }
      bindingsStatus.textContent = "Binding removed.";
      setTimeout(scanPageImages, 400);
    } else {
      btn.disabled = false;
      btn.textContent = "Remove";
      bindingsStatus.textContent = "Failed to remove binding.";
    }
  });
}

saveBtn.addEventListener("click", async () => {
  if (!selectedImage || !selectedImage.src) {
    statusEl.textContent = "Select an image on the page first.";
    return;
  }
  if (!selectedInteraction) {
    statusEl.textContent = "Choose an interaction first.";
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Binding…";
  statusEl.textContent = "⚡ Computing visual fingerprint…";

  chrome.runtime.sendMessage({ type: "IDENTIFY_ASSET", url: selectedImage.src }, (idRes) => {
    if (!idRes || !idRes.ok || !idRes.assetId) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Bind to Selected Image";
      statusEl.textContent = "Could not identify image fingerprint.";
      return;
    }
    const assetId = idRes.assetId;
    statusEl.textContent = "⚡ Syncing binding to database…";

    const interaction = {
      name: selectedInteraction.name,
      html: selectedInteraction.html || "",
      css: selectedInteraction.css || "",
      js: selectedInteraction.js || "",
    };

    chrome.runtime.sendMessage(
      { type: "SAVE_ASSET_BINDING", assetId, url: selectedImage.src, interaction },
      async (saveRes) => {
        saveBtn.disabled = false;
        saveBtn.textContent = "Bind to Selected Image";
        if (saveRes && saveRes.ok) {
          statusEl.textContent = saveRes.isUpdate
            ? `✓ Updated! Live across all tabs and browsers.`
            : `✓ Bound! Live across all tabs and browsers.`;
          setTimeout(scanPageImages, 600);
        } else if (saveRes && saveRes.alreadyApplied) {
          statusEl.textContent = `⚠️ "${selectedInteraction.name}" has already been applied.`;
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
