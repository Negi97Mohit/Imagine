// Universal Interactive Asset Layer - Dynamic Templates & Multi-Media Attachment Engine

const MEDIA_TEMPLATES = {
  VIDEO: {
    id: "media-video",
    name: "Video / Reel Overlay",
    html: `<div class="media-container video-mode">
  <video id="media-video-player" playsinline loop muted autoplay>
    <source src="" type="video/mp4">
  </video>
  <div class="media-controls">
    <button id="mute-btn" class="control-btn" title="Toggle Sound">🔊</button>
    <button id="play-btn" class="control-btn" title="Play/Pause">⏸</button>
  </div>
</div>`,
    css: `.media-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.4);
}
.media-container video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: auto;
}
.media-controls {
  position: absolute;
  bottom: 12px;
  right: 12px;
  display: flex;
  gap: 8px;
  z-index: 10;
}
.control-btn {
  background: rgba(18, 18, 24, 0.85);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  backdrop-filter: blur(8px);
  transition: transform 0.15s ease, background 0.15s ease;
}
.control-btn:hover {
  transform: scale(1.1);
  background: #b8410e;
}`,
    js: `function run(canvas, img, config, root, host) {
  const video = root.querySelector("#media-video-player");
  const muteBtn = root.querySelector("#mute-btn");
  const playBtn = root.querySelector("#play-btn");

  if (video && config && config.attachmentUrl) {
    video.src = config.attachmentUrl;
    video.play().catch(() => {});
  }

  if (muteBtn && video) {
    muteBtn.onclick = (e) => {
      e.stopPropagation();
      video.muted = !video.muted;
      muteBtn.textContent = video.muted ? "🔇" : "🔊";
    };
  }

  if (playBtn && video) {
    playBtn.onclick = (e) => {
      e.stopPropagation();
      if (video.paused) {
        video.play();
        playBtn.textContent = "⏸";
      } else {
        video.pause();
        playBtn.textContent = "▶️";
      }
    };
  }

  return {
    onPointerMove(x, y) {},
    onClick(x, y) {},
    resize(w, h) {},
    destroy() {
      if (video) { video.pause(); video.src = ""; }
    }
  };
}`
  },

  DOCUMENT: {
    id: "media-document",
    name: "PDF & Document Showcase",
    html: `<div class="doc-card-container">
  <div class="doc-badge-card">
    <div class="doc-icon-wrapper">
      <span id="doc-icon">📄</span>
    </div>
    <div class="doc-details">
      <div id="doc-title" class="doc-title">Document Attachment</div>
      <div id="doc-meta" class="doc-meta">PDF / Document File</div>
    </div>
    <div class="doc-actions">
      <a id="doc-open-btn" class="doc-btn primary" target="_blank" rel="noopener noreferrer">Open & View</a>
      <a id="doc-download-btn" class="doc-btn secondary" download>Download</a>
    </div>
  </div>
</div>`,
    css: `.doc-card-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(10, 10, 15, 0.65);
  backdrop-filter: blur(8px);
  padding: 16px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
}
.doc-badge-card {
  background: #ffffff;
  color: #18181b;
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
  max-width: 320px;
  width: 100%;
  border: 1px solid rgba(255, 255, 255, 0.4);
  animation: doc-card-in 0.25s ease-out;
}
@keyframes doc-card-in {
  from { opacity: 0; transform: translateY(8px) scale(0.96); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.doc-icon-wrapper {
  font-size: 32px;
  margin-bottom: 8px;
  background: #fef3c7;
  width: 54px;
  height: 54px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.doc-title {
  font-weight: 700;
  font-size: 14px;
  color: #0f172a;
  margin-bottom: 4px;
  word-break: break-word;
}
.doc-meta {
  font-size: 11px;
  color: #64748b;
  margin-bottom: 14px;
}
.doc-actions {
  display: flex;
  gap: 8px;
  width: 100%;
}
.doc-btn {
  flex: 1;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.doc-btn.primary {
  background: #b8410e;
  color: #ffffff;
  border: 1px solid #b8410e;
}
.doc-btn.primary:hover {
  background: #9a3412;
}
.doc-btn.secondary {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
}
.doc-btn.secondary:hover {
  background: #e2e8f0;
}`,
    js: `function run(canvas, img, config, root, host) {
  const title = root.querySelector("#doc-title");
  const meta = root.querySelector("#doc-meta");
  const openBtn = root.querySelector("#doc-open-btn");
  const downloadBtn = root.querySelector("#doc-download-btn");
  const icon = root.querySelector("#doc-icon");

  const url = config && (config.attachmentUrl || config.url);
  const fileName = config && (config.fileName || "document.pdf");
  const mimeType = config && config.mimeType;

  if (title) title.textContent = fileName;
  if (meta) {
    if (fileName.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf") {
      meta.textContent = "PDF Document";
      if (icon) icon.textContent = "📄";
    } else if (fileName.match(/\\.(doc|docx)$/i)) {
      meta.textContent = "Word Document";
      if (icon) icon.textContent = "📝";
    } else {
      meta.textContent = "Attached Document";
      if (icon) icon.textContent = "📁";
    }
  }

  if (url) {
    if (openBtn) openBtn.href = url;
    if (downloadBtn) {
      downloadBtn.href = url;
      downloadBtn.download = fileName;
    }
  }

  return {
    onPointerMove(x, y) {},
    onClick(x, y) {},
    resize(w, h) {},
    destroy() {}
  };
}`
  },

  IMAGE_GIF: {
    id: "media-image-gif",
    name: "Image & Animated GIF Overlay",
    html: `<div class="gif-overlay-container">
  <img id="overlay-gif-img" class="overlay-img" src="" alt="Overlay media" />
  <div id="toggle-layer-btn" class="gif-badge">GIF / Image Layer</div>
</div>`,
    css: `.gif-overlay-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: transparent;
}
.overlay-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: opacity 0.3s ease;
  pointer-events: auto;
}
.gif-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(18, 18, 24, 0.85);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(6px);
  pointer-events: none;
}`,
    js: `function run(canvas, img, config, root, host) {
  const overlayImg = root.querySelector("#overlay-gif-img");
  const url = config && (config.attachmentUrl || config.url);
  if (overlayImg && url) {
    overlayImg.src = url;
  }

  return {
    onPointerMove(x, y) {},
    onClick(x, y) {},
    resize(w, h) {},
    destroy() {}
  };
}`
  }
};

const STARTER_TEMPLATE = {
  id: "starter-template",
  name: "New Interaction",
  html: "",
  css: "",
  js: `function run(canvas, img, config, root, host) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;

  function fit() {
    W = canvas.width; H = canvas.height;
    const objFit = (config && config.objectFit) || "fill";
    if (objFit === "cover") {
      const scale = Math.max(W / (img.naturalWidth || W), H / (img.naturalHeight || H));
      iw = (img.naturalWidth || W) * scale;
      ih = (img.naturalHeight || H) * scale;
      ox = (W - iw) / 2;
      oy = (H - ih) / 2;
    } else if (objFit === "contain") {
      const scale = Math.min(W / (img.naturalWidth || W), H / (img.naturalHeight || H));
      iw = (img.naturalWidth || W) * scale;
      ih = (img.naturalHeight || H) * scale;
      ox = (W - iw) / 2;
      oy = (H - ih) / 2;
    } else {
      iw = W;
      ih = H;
      ox = 0;
      oy = 0;
    }
    render();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, ox, oy, iw, ih);
  }
  fit();

  return {
    onPointerMove(x, y) {},
    onClick(x, y) {},
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); },
    destroy() {}
  };
}`
};

const GLOBAL_TEMPLATES = [
  MEDIA_TEMPLATES.VIDEO,
  MEDIA_TEMPLATES.DOCUMENT,
  MEDIA_TEMPLATES.IMAGE_GIF,
  STARTER_TEMPLATE
];

const WATER_REVEAL_TEMPLATE = STARTER_TEMPLATE;

// Helper to construct self-contained rich media interaction objects
function createMediaInteraction({ name, fileDataUrl, fileUrl, fileName, mimeType, type }) {
  const url = fileDataUrl || fileUrl;
  const isVideo = type === "video" || (mimeType && mimeType.startsWith("video/")) || (fileName && fileName.match(/\\.(mp4|webm|mov)$/i));
  const isPdfOrDoc = type === "pdf" || type === "document" || (mimeType && (mimeType.includes("pdf") || mimeType.includes("word") || mimeType.includes("document"))) || (fileName && fileName.match(/\\.(pdf|docx?|txt|md)$/i));
  
  const baseTmpl = isVideo ? MEDIA_TEMPLATES.VIDEO : (isPdfOrDoc ? MEDIA_TEMPLATES.DOCUMENT : MEDIA_TEMPLATES.IMAGE_GIF);
  
  // Inject the actual media URL directly into HTML/JS so it runs standalone everywhere
  let customHtml = baseTmpl.html;
  let customJs = baseTmpl.js;
  
  if (isVideo) {
    customHtml = customHtml.replace('<source src=""', `<source src="${url}"`);
  } else if (isPdfOrDoc) {
    customHtml = customHtml
      .replace('id="doc-title" class="doc-title">Document Attachment</div>', `id="doc-title" class="doc-title">${fileName || "Attached Document"}</div>`)
      .replace('id="doc-open-btn" class="doc-btn primary"', `id="doc-open-btn" class="doc-btn primary" href="${url}"`)
      .replace('id="doc-download-btn" class="doc-btn secondary"', `id="doc-download-btn" class="doc-btn secondary" href="${url}" download="${fileName || 'document'}"`);
  } else {
    customHtml = customHtml.replace('<img id="overlay-gif-img" class="overlay-img" src=""', `<img id="overlay-gif-img" class="overlay-img" src="${url}"`);
  }

  return {
    name: name || fileName || "Media Attachment",
    html: customHtml,
    css: baseTmpl.css,
    js: customJs,
    attachment: {
      type: isVideo ? "video" : (isPdfOrDoc ? "document" : "image"),
      url: url,
      fileName: fileName || "file",
      mimeType: mimeType || ""
    }
  };
}

if (typeof window !== "undefined") {
  window.MEDIA_TEMPLATES = MEDIA_TEMPLATES;
  window.GLOBAL_TEMPLATES = GLOBAL_TEMPLATES;
  window.createMediaInteraction = createMediaInteraction;
  window.__defaultInteraction = function (canvas, img, config) {
    const factory = new Function(
      "canvas",
      "img",
      "config",
      STARTER_TEMPLATE.js + "\n;return run(canvas, img, config);"
    );
    return factory(canvas, img, config);
  };
}

