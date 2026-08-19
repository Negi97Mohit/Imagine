// Shared "Water Reveal" interaction
const WATER_REVEAL_TEMPLATE = {
  id: "water-reveal",
  name: "Water Reveal",
  html: "",
  css: "",
  js: `function run(canvas, img, config) {
  const ctx = canvas.getContext("2d");
  const radius = config.radius || Math.min(canvas.width, canvas.height) * 0.42;
  const baseAlpha = config.baseAlpha ?? 0.16;
  const baseBlur = config.baseBlur ?? 8;

  let iw, ih, ox, oy;
  function fit() {
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  let tx = canvas.width / 2, ty = canvas.height / 2;
  let mx = tx, my = ty;
  let ripples = [];
  let lastRipple = 0;
  let running = true;

  function drawImage(alpha, blur) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (blur) ctx.filter = \`blur(\${blur}px)\`;
    ctx.drawImage(img, ox, oy, iw, ih);
    ctx.restore();
  }

  function loop() {
    if (!running) return;
    tx += (mx - tx) * 0.13;
    ty += (my - ty) * 0.13;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    drawImage(baseAlpha, baseBlur);

    const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, radius);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.48, "rgba(255,255,255,.92)");
    g.addColorStop(0.78, "rgba(255,255,255,.38)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.save();
    ctx.beginPath();
    ctx.arc(tx, ty, radius, 0, Math.PI * 2);
    ctx.clip();
    drawImage(1, 0);
    ctx.restore();

    for (const q of ripples) {
      q.r += 1.6;
      q.a *= 0.975;
      ctx.save();
      ctx.strokeStyle = \`rgba(205,235,255,\${q.a})\`;
      ctx.lineWidth = 1.5;
      ctx.shadowBlur = 10;
      ctx.shadowColor = \`rgba(150,210,255,\${q.a * 0.65})\`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ripples = ripples.filter((q) => q.a > 0.035);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    onPointerMove(x, y) {
      mx = x;
      my = y;
      const now = performance.now();
      if (now - lastRipple > 85) {
        ripples.push({ x, y, r: 6, a: 0.6 });
        if (ripples.length > 18) ripples.shift();
        lastRipple = now;
      }
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      fit();
    },
    destroy() {
      running = false;
    },
  };
}`
};

// 10 Global Interactive Presets from 10-interactions.md
const GLOBAL_TEMPLATES = [
  WATER_REVEAL_TEMPLATE,
  {
    id: "scratch-card",
    name: "Scratch Card",
    html: "",
    css: "",
    js: `function run(canvas, img, config) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy;

  function fit() {
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
    drawFoil();
  }

  function drawFoil() {
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = "source-over";
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#c9c9d4");
    g.addColorStop(0.5, "#eef0f5");
    g.addColorStop(1, "#b6b8c2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = \`rgba(0,0,0,\${Math.random() * 0.05})\`;
      ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2);
    }
    ctx.fillStyle = "rgba(40,40,50,0.55)";
    ctx.font = \`bold \${Math.round(Math.min(W, H) * 0.09)}px sans-serif\`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SCRATCH ME", W / 2, H / 2);
  }

  const under = document.createElement("canvas");
  const uctx = under.getContext("2d");

  function drawUnder() {
    under.width = canvas.width;
    under.height = canvas.height;
    uctx.clearRect(0, 0, under.width, under.height);
    uctx.drawImage(img, ox, oy, iw, ih);
  }

  fit();
  drawUnder();

  let scratchedPx = 0;
  const totalPx = () => canvas.width * canvas.height;
  let last = null;

  function scratchAt(x, y) {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const r = Math.min(canvas.width, canvas.height) * 0.05;
    if (last) {
      ctx.lineWidth = r * 2;
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    last = { x, y };
    scratchedPx += Math.PI * r * r * 0.4;

    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(under, 0, 0);
    ctx.restore();
  }

  return {
    onPointerMove(x, y) {
      scratchAt(x, y);
      if (scratchedPx / totalPx() > 0.65) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(under, 0, 0);
      }
    },
    resize(w, h) {
      canvas.width = w; canvas.height = h;
      fit(); drawUnder(); last = null; scratchedPx = 0;
    },
    destroy() {},
  };
}`
  },
  {
    id: "shattered-glass",
    name: "Shattered Glass",
    html: "",
    css: "",
    js: `function run(canvas, img, config) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy;

  function fit() {
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  let mx = -9999, my = -9999;
  let running = true;

  function shardsAround(cx, cy, n, spread) {
    const pts = [{ x: cx, y: cy }];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const r = spread * (0.5 + Math.random() * 0.6);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    const shards = [];
    for (let i = 1; i < pts.length; i++) {
      const b = pts[i];
      const c = pts[(i % (pts.length - 1)) + 1];
      shards.push({
        tri: [pts[0], b, c],
        jx: (Math.random() - 0.5) * 6,
        jy: (Math.random() - 0.5) * 6,
      });
    }
    return shards;
  }

  let shards = [];
  let intensity = 0;

  function loop() {
    if (!running) return;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, ox, oy, iw, ih);

    intensity += ((mx > 0 ? 1 : 0) - intensity) * 0.15;

    if (mx > 0 && shards.length === 0) {
      shards = shardsAround(mx, my, 9, Math.min(W, H) * 0.28);
    }
    if (mx < 0) shards = [];

    for (const s of shards) {
      const [p0, p1, p2] = s.tri;
      const dx = s.jx * intensity;
      const dy = s.jy * intensity;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(p0.x + dx, p0.y + dy);
      ctx.lineTo(p1.x + dx, p1.y + dy);
      ctx.lineTo(p2.x + dx, p2.y + dy);
      ctx.closePath();
      ctx.clip();
      ctx.translate(dx, dy);
      ctx.drawImage(img, ox, oy, iw, ih);
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = \`rgba(255,255,255,\${0.5 * intensity})\`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p0.x + dx, p0.y + dy);
      ctx.lineTo(p1.x + dx, p1.y + dy);
      ctx.lineTo(p2.x + dx, p2.y + dy);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    onPointerMove(x, y) { mx = x; my = y; },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); shards = []; },
    destroy() { running = false; },
  };
}`
  },
  {
    id: "ascii-fication",
    name: "ASCII-fication",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  const cell = config.cell || 9;
  const chars = " .:-=+*#%@";
  let iw, ih, ox, oy, off, octx;
  let mx = -9999, my = -9999;
  const decodeRadius = config.decodeRadius || 90;

  function fit() {
    const W = canvas.width, H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
    off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    octx = off.getContext("2d");
    octx.drawImage(img, ox, oy, iw, ih);
  }
  fit();

  function render() {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);
    ctx.font = \`\${cell}px monospace\`;
    ctx.textBaseline = "top";

    const data = octx.getImageData(0, 0, W, H).data;
    for (let y = 0; y < H; y += cell) {
      for (let x = 0; x < W; x += cell) {
        const i = (y * W + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const bright = (r + g + b) / 3;
        const dist = Math.hypot(x - mx, y - my);

        if (dist < decodeRadius) {
          ctx.fillStyle = \`rgb(\${r},\${g},\${b})\`;
          ctx.fillRect(x, y, cell, cell);
        } else {
          const ch = chars[Math.floor((bright / 255) * (chars.length - 1))];
          ctx.fillStyle = \`rgba(\${r},\${g},\${b},0.9)\`;
          ctx.fillText(ch, x, y);
        }
      }
    }
  }
  render();

  return {
    onPointerMove(x, y) { mx = x; my = y; render(); },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); render(); },
    destroy() {},
  };
}`
  },
  {
    id: "magnetic-iron-filings",
    name: "Magnetic Iron Filings",
    html: "",
    css: "",
    js: `function run(canvas, img, config) {
  const ctx = canvas.getContext("2d");
  const COUNT = config.count || 3500;
  let iw, ih, ox, oy, off, octx, W, H;
  let mx = -9999, my = -9999;
  let running = true;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
    off = document.createElement("canvas");
    off.width = W; off.height = H;
    octx = off.getContext("2d");
    octx.drawImage(img, ox, oy, iw, ih);
  }
  fit();

  let particles = [];
  function seed() {
    particles = [];
    for (let i = 0; i < COUNT; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        angle: Math.random() * Math.PI,
      });
    }
  }
  seed();

  function loop() {
    if (!running) return;
    ctx.fillStyle = "#08080c";
    ctx.fillRect(0, 0, W, H);

    const imgData = octx.getImageData(0, 0, W, H).data;

    for (const p of particles) {
      const dx = p.x - mx, dy = p.y - my;
      const dist = Math.hypot(dx, dy);
      const field = Math.max(0, 1 - dist / 160);

      let targetAngle = p.angle;
      if (field > 0) {
        targetAngle = Math.atan2(dy, dx) + Math.PI / 2;
      }
      p.angle += (targetAngle - p.angle) * 0.2;

      const ix = Math.max(0, Math.min(W - 1, Math.floor(p.x)));
      const iy = Math.max(0, Math.min(H - 1, Math.floor(p.y)));
      const idx = (iy * W + ix) * 4;
      const r = imgData[idx], g = imgData[idx + 1], b = imgData[idx + 2];

      const len = 3 + field * 5;
      const alpha = 0.15 + field * 0.85;
      ctx.strokeStyle = \`rgba(\${r},\${g},\${b},\${alpha})\`;
      ctx.lineWidth = 1 + field;
      ctx.beginPath();
      ctx.moveTo(p.x - Math.cos(p.angle) * len, p.y - Math.sin(p.angle) * len);
      ctx.lineTo(p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len);
      ctx.stroke();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    onPointerMove(x, y) { mx = x; my = y; },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); seed(); },
    destroy() { running = false; },
  };
}`
  },
  {
    id: "before-after-slider",
    name: "Before / After Slider",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;
  let split = 0.5;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  function drawFiltered() {
    ctx.save();
    ctx.filter = config.filter || "grayscale(1) contrast(1.1)";
    ctx.drawImage(img, ox, oy, iw, ih);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.rect(split * W, 0, W - split * W, H);
    ctx.clip();
    drawFiltered();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, split * W, H);
    ctx.clip();
    ctx.drawImage(img, ox, oy, iw, ih);
    ctx.restore();

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(split * W, 0);
    ctx.lineTo(split * W, H);
    ctx.stroke();
    handle.style.left = \`\${split * W}px\`;
  }

  root.style.position = "relative";
  const handle = document.createElement("div");
  handle.style.cssText = \`
    position:absolute; top:50%; width:26px; height:26px;
    margin-left:-13px; margin-top:-13px; border-radius:50%;
    background:#fff; box-shadow:0 1px 4px rgba(0,0,0,.4);
    cursor:ew-resize; z-index:5; display:flex; align-items:center;
    justify-content:center; font-size:12px; color:#333;
  \`;
  handle.textContent = "⇔";
  root.appendChild(handle);
  render();

  return {
    onPointerMove(x, y) {
      split = Math.max(0, Math.min(1, x / W));
      render();
    },
    resize(w, h) {
      canvas.width = w; canvas.height = h;
      fit(); render();
    },
    destroy() { handle.remove(); },
  };
}`
  },
  {
    id: "thermal-vision",
    name: "Thermal Vision Toggle",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;
  let thermal = false;
  let scanline = 0;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  function heatColor(lum) {
    const t = lum / 255;
    const r = Math.min(255, Math.round(t * 3 * 255));
    const g = Math.min(255, Math.round(Math.max(0, t - 0.33) * 3 * 255));
    const b = Math.min(255, Math.round(Math.max(0, 0.5 - t) * 2 * 255));
    return [r, g, b];
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, ox, oy, iw, ih);
    if (!thermal) return;
    const data = ctx.getImageData(0, 0, W, H);
    const d = data.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const [r, g, b] = heatColor(lum);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    ctx.putImageData(data, 0, 0);
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, scanline, W, 2);
    scanline = (scanline + 3) % H;
  }

  let raf;
  function loop() { render(); if (thermal) raf = requestAnimationFrame(loop); }
  render();

  const btn = document.createElement("button");
  btn.textContent = "🌡 Thermal";
  btn.style.cssText = \`
    position:absolute; bottom:8px; right:8px; z-index:5;
    padding:5px 10px; font-size:12px; border:none; border-radius:6px;
    background:rgba(20,20,25,.75); color:#fff; cursor:pointer;
  \`;
  root.style.position = "relative";
  root.appendChild(btn);
  btn.onclick = () => {
    thermal = !thermal;
    btn.style.background = thermal ? "rgba(200,40,20,.85)" : "rgba(20,20,25,.75)";
    if (thermal) loop();
    else render();
  };

  return {
    onPointerMove() {},
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); render(); },
    destroy() { cancelAnimationFrame(raf); btn.remove(); },
  };
}`
  },
  {
    id: "echo-trail",
    name: "Echo Trail",
    html: "",
    css: "",
    js: `function run(canvas, img, config) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  let ghosts = [];
  let cx = W / 2, cy = H / 2;
  let lastStamp = 0;
  let running = true;

  function loop() {
    if (!running) return;
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);

    ghosts = ghosts.filter((g) => now - g.born < 650);
    for (const g of ghosts) {
      const t = (now - g.born) / 650;
      const alpha = (1 - t) * 0.35;
      const scale = 1 - t * 0.18;
      const w = iw * scale, h = ih * scale;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, g.x - w / 2, g.y - h / 2, w, h);
      ctx.restore();
    }

    ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  return {
    onPointerMove(x, y) {
      const now = performance.now();
      if (now - lastStamp > 45) {
        ghosts.push({ x: cx, y: cy, born: now });
        if (ghosts.length > 14) ghosts.shift();
        lastStamp = now;
      }
      cx = x; cy = y;
    },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); },
    destroy() { running = false; },
  };
}`
  },
  {
    id: "connect-constellation",
    name: "Connect-the-Dots Constellation",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;
  const dots = config.dots || [
    { x: 0.2, y: 0.3 }, { x: 0.5, y: 0.15 }, { x: 0.8, y: 0.3 },
    { x: 0.8, y: 0.7 }, { x: 0.5, y: 0.85 }, { x: 0.2, y: 0.7 },
  ];
  let sequence = [];
  let solved = false;
  let flash = 0;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
  }
  fit();

  function dotPx(d) { return { x: ox + d.x * iw, y: oy + d.y * ih }; }

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (!solved) ctx.filter = "blur(3px) brightness(0.65)";
    ctx.drawImage(img, ox, oy, iw, ih);
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = \`rgba(255,255,255,\${flash})\`;
      ctx.fillRect(0, 0, W, H);
      flash -= 0.04;
      if (flash > 0) requestAnimationFrame(render);
    }

    if (solved) return;

    ctx.strokeStyle = "rgba(255,220,120,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    sequence.forEach((i, idx) => {
      const p = dotPx(dots[i]);
      idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    dots.forEach((d, i) => {
      const p = dotPx(d);
      const done = sequence.includes(i);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = done ? "rgba(255,220,120,0.95)" : "rgba(255,255,255,0.85)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.4)";
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y);
    });
  }
  render();

  return {
    onPointerMove() {},
    onClick(x, y) {
      if (solved) return;
      const hit = dots.findIndex((d) => {
        const p = dotPx(d);
        return Math.hypot(p.x - x, p.y - y) < 14;
      });
      if (hit === -1) return;
      const expected = sequence.length;
      if (hit === expected) {
        sequence.push(hit);
        if (sequence.length === dots.length) {
          solved = true;
          flash = 0.9;
        }
      } else {
        sequence = [];
      }
      render();
    },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); render(); },
    destroy() {},
  };
}`
  },
  {
    id: "reaction-bar",
    name: "Live Reaction Bar",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root, host) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
    ctx.drawImage(img, ox, oy, iw, ih);
  }
  fit();

  const emojis = config.emojis || ["👍", "😂", "😮", "❤️"];
  root.style.cssText = "position:relative; opacity:0; transition:opacity .15s;";

  const bar = document.createElement("div");
  bar.style.cssText = \`
    position:absolute; left:8px; bottom:8px; display:flex; gap:6px;
    background:rgba(20,20,25,.65); padding:5px 8px; border-radius:20px;
    z-index:5; backdrop-filter:blur(4px);
  \`;
  root.appendChild(bar);

  const buttons = {};
  emojis.forEach((emo) => {
    const b = document.createElement("button");
    b.style.cssText = "border:none; background:transparent; cursor:pointer; font-size:15px; display:flex; align-items:center; gap:3px; color:#fff;";
    const count = document.createElement("span");
    count.style.cssText = "font-size:11px; font-weight:600;";
    count.textContent = "0";
    b.appendChild(document.createTextNode(emo + " "));
    b.appendChild(count);
    buttons[emo] = count;
    bar.appendChild(b);

    b.onclick = async () => {
      const key = \`reaction:\${emo}\`;
      const current = (await host.storage.get(key)) || 0;
      const next = current + 1;
      await host.storage.set(key, next);
      count.textContent = String(next);
    };
  });

  (async () => {
    for (const emo of emojis) {
      const val = (await host.storage.get(\`reaction:\${emo}\`)) || 0;
      buttons[emo].textContent = String(val);
    }
  })();

  return {
    onPointerMove() { root.style.opacity = "1"; },
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); },
    destroy() { bar.remove(); },
  };
}`
  },
  {
    id: "padlock-unlock",
    name: "Padlock Unlock",
    html: "",
    css: "",
    js: `function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  let iw, ih, ox, oy, W, H;

  function fit() {
    W = canvas.width; H = canvas.height;
    const scale = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ox = (W - iw) / 2;
    oy = (H - ih) / 2;
    render();
  }

  let unlocked = false;
  let shake = 0;

  function render() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (!unlocked) ctx.filter = "blur(14px) brightness(0.55)";
    const sx = shake ? (Math.random() - 0.5) * shake : 0;
    ctx.drawImage(img, ox + sx, oy, iw, ih);
    ctx.restore();
  }
  fit();

  const combo = config.combo || [1, 0, 2];
  let progress = [];

  root.style.position = "relative";
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; z-index:5;";
  const lock = document.createElement("div");
  lock.textContent = "🔒";
  lock.style.cssText = "font-size:32px; filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));";
  const dotsRow = document.createElement("div");
  dotsRow.style.cssText = "display:flex; gap:14px;";
  wrap.appendChild(lock);
  wrap.appendChild(dotsRow);
  root.appendChild(wrap);

  const dotEls = combo.map((_, i) => {
    const d = document.createElement("button");
    d.style.cssText = "width:22px; height:22px; border-radius:50%; border:2px solid #fff; background:rgba(255,255,255,.25); cursor:pointer;";
    d.onclick = () => handleClick(i);
    dotsRow.appendChild(d);
    return d;
  });

  function reset() {
    progress = [];
    dotEls.forEach((d) => (d.style.background = "rgba(255,255,255,.25)"));
  }

  function handleClick(i) {
    if (unlocked) return;
    const expectedIdx = progress.length;
    if (combo[expectedIdx] === i) {
      progress.push(i);
      dotEls[i].style.background = "rgba(120,255,160,.85)";
      if (progress.length === combo.length) {
        unlocked = true;
        lock.textContent = "🔓";
        wrap.style.transition = "opacity .4s";
        wrap.style.opacity = "0";
        setTimeout(() => wrap.remove(), 400);
        render();
      }
    } else {
      shake = 10;
      dotEls.forEach((d) => (d.style.background = "rgba(255,90,90,.7)"));
      let frames = 0;
      const s = setInterval(() => {
        render();
        frames++;
        shake *= 0.8;
        if (frames > 12) { clearInterval(s); shake = 0; reset(); render(); }
      }, 30);
    }
  }

  return {
    onPointerMove() {},
    resize(w, h) { canvas.width = w; canvas.height = h; fit(); },
    destroy() { wrap.remove(); },
  };
}`
  }
];

if (typeof window !== "undefined") {
  window.__defaultInteraction = function (canvas, img, config) {
    const factory = new Function(
      "canvas",
      "img",
      "config",
      WATER_REVEAL_TEMPLATE.js + "\n;return run(canvas, img, config);"
    );
    return factory(canvas, img, config);
  };
}

