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
  background: #09090b;
}
.media-container video {
  width: 100%;
  height: 100%;
  object-fit: var(--media-sizing, contain);
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


  IMAGE_GIF: {
    id: "media-image-gif",
    name: "Image & Animated GIF Overlay",
    html: `<div class="gif-overlay-container">
  <img id="overlay-gif-img" class="overlay-img" src="" alt="Overlay media" />
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
  background: #09090b;
}
.overlay-img {
  width: 100%;
  height: 100%;
  object-fit: var(--media-sizing, contain);
  transition: opacity 0.3s ease;
  pointer-events: auto;
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
  MEDIA_TEMPLATES.IMAGE_GIF,
  STARTER_TEMPLATE
];

const WATER_REVEAL_TEMPLATE = STARTER_TEMPLATE;

// Helper to construct self-contained rich media interaction objects
function createMediaInteraction({ name, fileDataUrl, fileUrl, fileName, mimeType, type, sizingMode = "contain" }) {
  const url = fileDataUrl || fileUrl;
  const isVideo = type === "video" || (mimeType && mimeType.startsWith("video/")) || (fileName && fileName.match(/\.(mp4|webm|mov)$/i));

  const baseTmpl = isVideo ? MEDIA_TEMPLATES.VIDEO : MEDIA_TEMPLATES.IMAGE_GIF;

  // Inject the actual media URL and sizing mode directly into HTML/CSS/JS
  let customHtml = baseTmpl.html;
  let customCss = baseTmpl.css.replace(/var\(--media-sizing,\s*contain\)/g, sizingMode);
  let customJs = baseTmpl.js;

  if (isVideo) {
    customHtml = customHtml.replace('<source src=""', `<source src="${url}"`);
  } else {
    customHtml = customHtml.replace('<img id="overlay-gif-img" class="overlay-img" src=""', `<img id="overlay-gif-img" class="overlay-img" src="${url}"`);
  }

  return {
    name: name || fileName || "Media Attachment",
    html: customHtml,
    css: customCss,
    js: customJs,
    attachment: {
      type: isVideo ? "video" : "image",
      url: url,
      fileName: fileName || "file",
      mimeType: mimeType || "",
      sizingMode: sizingMode
    }
  };
}

// Helper to dynamically update the sizing mode of any interaction
function updateInteractionSizing(interaction, newSizingMode) {
  if (!interaction || !newSizingMode) return interaction;
  const validModes = ["contain", "fill", "cover", "none"];
  const mode = validModes.includes(newSizingMode) ? newSizingMode : "contain";

  if (!interaction.attachment) {
    interaction.attachment = {};
  }
  interaction.attachment.sizingMode = mode;

  // Update object-fit in custom CSS if present
  let css = interaction.css || "";
  if (/object-fit\s*:/i.test(css)) {
    css = css.replace(/object-fit\s*:\s*[^;!]+(?:\s*!important)?/gi, `object-fit: ${mode} !important`);
  } else {
    css += `\n.overlay-img, video, .media-container video, img { object-fit: ${mode} !important; }`;
  }
  css = css.replace(/var\(--media-sizing,\s*[^)]+\)/gi, mode);
  interaction.css = css;

  return interaction;
}

if (typeof window !== "undefined") {
  window.MEDIA_TEMPLATES = MEDIA_TEMPLATES;
  window.GLOBAL_TEMPLATES = GLOBAL_TEMPLATES;
  window.createMediaInteraction = createMediaInteraction;
  window.updateInteractionSizing = updateInteractionSizing;
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


