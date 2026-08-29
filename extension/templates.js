// Universal Interactive Asset Layer - Dynamic Realtime Database Mode
// All interactions are loaded and managed 100% dynamically from Firebase Realtime Database.
// No hardcoded interaction presets are stored in local files.

const GLOBAL_TEMPLATES = [];

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

const WATER_REVEAL_TEMPLATE = STARTER_TEMPLATE;

if (typeof window !== "undefined") {
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
