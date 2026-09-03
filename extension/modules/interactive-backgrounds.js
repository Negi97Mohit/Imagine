/**
 * Native Interactive Backgrounds Engine
 * Runs 100% natively inside the extension content script without eval() or new Function().
 * Completely immune to Host Page Content Security Policies (CSP).
 */

const InteractiveBackgrounds = (() => {
  const activeMounts = new WeakMap();
  const originalStylesMap = new WeakMap();

  // Shared Global Pointer Tracker to avoid duplicate capture listeners on window
  const GlobalPointer = (() => {
    let clientX = -9999;
    let clientY = -9999;
    let isTracking = false;

    function onPointer(e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    function onTouch(e) {
      if (e.touches && e.touches[0]) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      }
    }

    return {
      getCoords() {
        return { clientX, clientY };
      },
      start() {
        if (isTracking || typeof window === "undefined") return;
        isTracking = true;
        window.addEventListener("pointermove", onPointer, { passive: true });
        window.addEventListener("touchmove", onTouch, { passive: true });
      },
    };
  })();

  function prepareTarget(el) {
    if (!el) return { canvas: document.createElement("canvas"), isFullPage: false };
    const isFullPage = (el === document.body || el === document.documentElement || el.tagName.toLowerCase() === "main" || el.id === "rcnt");

    // Clean up any old interactive background canvases on this element or globally
    if (isFullPage) {
      document.querySelectorAll("#imagine-interactive-canvas-global, #imagine-webgl-canvas-global, .imagine-interactive-canvas-global, .imagine-interactive-stamp-global").forEach(c => c.remove());
    } else {
      el.querySelectorAll(":scope > .imagine-interactive-canvas, :scope > .imagine-webgl-canvas, :scope > .imagine-interactive-stamp").forEach(c => c.remove());
    }

    // Save original styles if not already saved
    if (!originalStylesMap.has(el)) {
      originalStylesMap.set(el, {
        position: el.style.position || "",
        isolation: el.style.isolation || "",
        zIndex: el.style.zIndex || "",
        backgroundColor: el.style.backgroundColor || "",
        backgroundImage: el.style.backgroundImage || "",
      });
    }

    const canvas = document.createElement("canvas");
    canvas.className = isFullPage ? "imagine-interactive-canvas imagine-interactive-canvas-global" : "imagine-interactive-canvas";

    if (isFullPage) {
      canvas.id = "imagine-interactive-canvas-global";
      canvas.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;pointer-events:none;display:block;";
      document.body.prepend(canvas);
    } else {
      const compPos = window.getComputedStyle(el).position;
      if (compPos === "static") {
        el.style.position = "relative";
      }
      el.style.isolation = "isolate";
      el.style.setProperty("background-color", "transparent", "important");
      el.style.setProperty("background-image", "none", "important");

      canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;display:block;border-radius:inherit;";
      el.prepend(canvas);
    }

    return { canvas, isFullPage };
  }

  function setupMouseTracking(el, isFullPage) {
    GlobalPointer.start();
    const mouse = {
      get x() {
        const { clientX } = GlobalPointer.getCoords();
        if (isFullPage) return clientX;
        if (!el || !el.isConnected) return -9999;
        const rect = el.getBoundingClientRect();
        return clientX - rect.left;
      },
      get y() {
        const { clientY } = GlobalPointer.getCoords();
        if (isFullPage) return clientY;
        if (!el || !el.isConnected) return -9999;
        const rect = el.getBoundingClientRect();
        return clientY - rect.top;
      },
      get isInside() {
        const { clientX, clientY } = GlobalPointer.getCoords();
        if (clientX < 0 || clientY < 0) return false;
        if (isFullPage) return true;
        if (!el || !el.isConnected) return false;
        const rect = el.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;
        return (mx >= -20 && mx <= rect.width + 20 && my >= -20 && my <= rect.height + 20);
      }
    };

    function cleanup() {}

    return { mouse, cleanup };
  }

  // --- Engines Registry ---
  const ENGINES = {
    // 1. Repulsion Dot Matrix with Rotating Stamp & Artwork Reveal
    "repulsion-grid": (el, options = {}) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      const parameters = Object.assign({
        size: 26,
        radius: 1.8,
        proximity: 140,
        growth: 58,
        ease: 0.08
      }, options);

      class Circle {
        constructor(radius, x, y) {
          this._radius = radius;
          this.radius = radius;
          this.growthValue = 0;
          this.x = x;
          this.y = y;
        }
        draw(c, ease) {
          this.radius += ((this._radius + this.growthValue) - this.radius) * ease;
          if (this.radius > 0.2) {
            c.moveTo(this.x + this.radius, this.y);
            c.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
          }
        }
        addRadius(val) { this.growthValue = val; }
      }

      let circles = [];
      let width = 0, height = 0;
      let angle = 0;

      function buildGrid() {
        circles = [];
        const { size, radius } = parameters;
        const cols = Math.ceil(width / size) + 2;
        const rows = Math.ceil(height / size) + 2;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            circles.push(new Circle(radius, c * size, r * size));
          }
        }
      }

      const artCanvas = document.createElement("canvas");
      const artCtx = artCanvas.getContext("2d");

      function renderArtwork() {
        artCanvas.width = width || 800;
        artCanvas.height = height || 600;
        const grad = artCtx.createLinearGradient(0, 0, artCanvas.width, artCanvas.height);
        grad.addColorStop(0, "#ff0844");
        grad.addColorStop(0.25, "#ff4e50");
        grad.addColorStop(0.5, "#f9d423");
        grad.addColorStop(0.75, "#845ec2");
        grad.addColorStop(1, "#2c73d2");
        artCtx.fillStyle = grad;
        artCtx.fillRect(0, 0, artCanvas.width, artCanvas.height);

        for (let i = 0; i < 16; i++) {
          artCtx.beginPath();
          const cx = (i * 187.3) % artCanvas.width;
          const cy = (i * 123.7) % artCanvas.height;
          const cr = (i * 28) % 220 + 40;
          artCtx.arc(cx, cy, cr, 0, Math.PI * 2);
          artCtx.fillStyle = i % 2 === 0 ? "rgba(255, 255, 255, 0.22)" : "rgba(0, 0, 0, 0.15)";
          artCtx.fill();
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        buildGrid();
        renderArtwork();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frameCount = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frameCount++;
        angle += 0.012;

        let targetX = mouse.x;
        let targetY = mouse.y;
        if (!mouse.isInside) {
          targetX = width / 2 + Math.cos(frameCount * 0.02) * (width * 0.3);
          targetY = height / 2 + Math.sin(frameCount * 0.025) * (height * 0.3);
        }

        const { proximity, growth } = parameters;
        for (let i = 0; i < circles.length; i++) {
          const c = circles[i];
          const dx = c.x - targetX;
          const dy = c.y - targetY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < proximity) {
            const factor = (1 - dist / proximity);
            c.addRadius(factor * growth);
          } else {
            c.addRadius(0);
          }
        }

        // 1. Draw base background
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#e0dad5";
        ctx.fillRect(0, 0, width, height);

        // 2. Draw artwork clipped through expanding circles
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < circles.length; i++) {
          circles[i].draw(ctx, parameters.ease);
        }
        ctx.clip();
        ctx.drawImage(artCanvas, 0, 0, width, height);
        ctx.restore();

        // 3. Draw rotating circular stamp badge if element is large enough
        if (width > 200 && height > 140) {
          ctx.save();
          const stampX = width - Math.min(75, width * 0.16);
          const stampY = Math.min(75, height * 0.2);
          const stampRadius = Math.min(38, width * 0.1);

          ctx.translate(stampX, stampY);
          ctx.rotate(angle);

          const stampText = "EXPERIMENTS • INTERACTIVE • ";
          ctx.font = "bold 8px 'Rubik', sans-serif, system-ui";
          ctx.fillStyle = "#ee3d3d";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          const step = (Math.PI * 2) / stampText.length;
          for (let i = 0; i < stampText.length; i++) {
            ctx.save();
            ctx.rotate(i * step);
            ctx.fillText(stampText[i], 0, -stampRadius);
            ctx.restore();
          }
          ctx.restore();

          // Center year tag in stamp
          ctx.save();
          ctx.font = "bold 10px 'Asul', Georgia, serif";
          ctx.fillStyle = "#ee3d3d";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("2026", stampX, stampY);
          ctx.restore();
        }

        animId = requestAnimationFrame(animate);
      }

      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 2. Chromatic Laser Waves WebGL
    "chromatic-laser": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const gl = canvas.getContext("webgl", { alpha: false, antialias: true }) || canvas.getContext("experimental-webgl");
      if (!gl) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      const vsSrc = "attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }";
      const fsSrc = "precision highp float; uniform vec2 resolution; uniform vec2 mouse; uniform float time; uniform float xScale; uniform float yScale; uniform float distortion; void main() { vec2 p = (gl_FragCoord.xy * 2.0 - resolution) / min(resolution.x, resolution.y); vec2 m = (mouse * 2.0 - resolution) / min(resolution.x, resolution.y); float md = length(p - m); float bend = sin(md * 6.0 - time * 2.5) * 0.12 * exp(-md * 1.5); float d = length(p) * distortion; float rx = p.x * (1.0 + d) + bend; float gx = p.x; float bx = p.x * (1.0 - d) - bend; float r = 0.08 / (abs(p.y + sin((rx + time * 1.5) * xScale) * yScale) + 0.001); float g = 0.08 / (abs(p.y + sin((gx + time * 1.5) * xScale) * yScale) + 0.001); float b = 0.08 / (abs(p.y + sin((bx + time * 1.5) * xScale) * yScale) + 0.001); vec3 bg = vec3(0.04, 0.05, 0.09); vec3 col = bg + vec3(r * 1.3, g * 0.85, b * 1.5); gl_FragColor = vec4(col, 1.0); }";

      function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
      }

      const vs = compile(gl.VERTEX_SHADER, vsSrc);
      const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

      const pos = gl.getAttribLocation(prog, "position");
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      const uRes = gl.getUniformLocation(prog, "resolution");
      const uMouse = gl.getUniformLocation(prog, "mouse");
      const uTime = gl.getUniformLocation(prog, "time");
      const uXScale = gl.getUniformLocation(prog, "xScale");
      const uYScale = gl.getUniformLocation(prog, "yScale");
      const uDistortion = gl.getUniformLocation(prog, "distortion");

      gl.uniform1f(uXScale, 1.25);
      gl.uniform1f(uYScale, 0.45);
      gl.uniform1f(uDistortion, 0.08);

      function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(uRes, canvas.width, canvas.height);
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let start = performance.now();
      let animId = null;

      function render(now) {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = isFullPage ? { height: window.innerHeight } : el.getBoundingClientRect();
        const my = (rect.height - mouse.y) * dpr;
        gl.uniform2f(uMouse, mouse.x * dpr, my);
        gl.uniform1f(uTime, (now - start) * 0.001);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        animId = requestAnimationFrame(render);
      }
      animId = requestAnimationFrame(render);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 3. Cyber Manga Particle Grid
    "cyber-grid": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let nodes = [];
      const SPACING = 34;

      function initNodes() {
        nodes = [];
        const cols = Math.ceil(width / SPACING) + 1;
        const rows = Math.ceil(height / SPACING) + 1;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            nodes.push({
              ox: c * SPACING,
              oy: r * SPACING,
              x: c * SPACING,
              y: r * SPACING,
              vx: 0,
              vy: 0,
              highlight: 0
            });
          }
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        initNodes();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        const bgGrad = ctx.createRadialGradient(width * 0.8, height * 0.2, 10, width * 0.5, height * 0.5, Math.max(width, height));
        bgGrad.addColorStop(0, "#0c1527");
        bgGrad.addColorStop(0.6, "#080c14");
        bgGrad.addColorStop(1, "#04060a");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.x;
        let targetY = mouse.y;
        if (!mouse.isInside) {
          targetX = width / 2 + Math.cos(frame * 0.02) * (width * 0.3);
          targetY = height / 2 + Math.sin(frame * 0.03) * (height * 0.3);
        }

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const dx = n.x - targetX;
          const dy = n.y - targetY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 140) {
            const force = (1 - dist / 140) * 14;
            n.vx += (dx / (dist || 1)) * force;
            n.vy += (dy / (dist || 1)) * force;
            n.highlight = Math.min(1, n.highlight + 0.15);
          } else {
            n.highlight = Math.max(0, n.highlight - 0.03);
          }

          n.vx += (n.ox - n.x) * 0.08;
          n.vy += (n.oy - n.y) * 0.08;
          n.vx *= 0.84;
          n.vy *= 0.84;
          n.x += n.vx;
          n.y += n.vy;
        }

        ctx.lineWidth = 1;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (i + 1 < nodes.length && nodes[i + 1].ox > n.ox) {
            const r = nodes[i + 1];
            const alpha = Math.max(0.08, (n.highlight + r.highlight) * 0.6);
            ctx.strokeStyle = n.highlight > 0.3 ? "rgba(0, 240, 255, " + alpha + ")" : "rgba(30, 58, 95, " + alpha + ")";
            ctx.beginPath();
            ctx.moveTo(n.x, n.y);
            ctx.lineTo(r.x, r.y);
            ctx.stroke();
          }
        }

        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const r = n.highlight > 0.2 ? 2.8 : 1.5;
          ctx.fillStyle = n.highlight > 0.4 ? "#ff007f" : (n.highlight > 0.1 ? "#00f0ff" : "rgba(0, 240, 255, 0.4)");
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();

          if (n.highlight > 0.5) {
            ctx.strokeStyle = "rgba(0, 240, 255, " + (n.highlight * 0.5) + ")";
            ctx.beginPath();
            ctx.arc(n.x, n.y, r * 3, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 4. Vogue Monochromatic Waves
    "vogue-waves": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#f7f6f2";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.x;
        let targetY = mouse.y;
        if (!mouse.isInside) {
          targetX = width / 2 + Math.cos(frame * 0.015) * (width * 0.3);
          targetY = height / 2 + Math.sin(frame * 0.02) * (height * 0.3);
        }

        const SPACING = 24;
        const cols = Math.ceil(width / SPACING) + 1;
        const rows = Math.ceil(height / SPACING) + 1;

        ctx.fillStyle = "#111111";
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const x = c * SPACING;
            const y = r * SPACING;

            const wave = Math.sin((x * 0.012) + (frame * 0.03)) * Math.cos((y * 0.012) + (frame * 0.02));
            const dist = Math.hypot(x - targetX, y - targetY);
            const prox = Math.max(0, 1 - dist / 160);

            const radius = Math.max(0.6, 1.2 + wave * 1.5 + prox * 5.5);

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 5. Dark Cinematic Crimson Spotlight & Smoke
    "netflix-smoke": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let particles = [];
      const MAX_PARTICLES = 36;
      let smoothX = 0, smoothY = 0;

      function initParticles() {
        particles = [];
        for (let i = 0; i < MAX_PARTICLES; i++) {
          particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.8,
            vy: -Math.random() * 1.2 - 0.3,
            size: Math.random() * 45 + 20,
            alpha: Math.random() * 0.35 + 0.1
          });
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        if (!smoothX) { smoothX = width / 2; smoothY = height / 2; }
        initParticles();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#0c080b";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.02) * (width * 0.25);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.sin(frame * 0.025) * (height * 0.25);

        smoothX += (targetX - smoothX) * 0.08;
        smoothY += (targetY - smoothY) * 0.08;

        const spotGrad = ctx.createRadialGradient(smoothX, smoothY, 20, smoothX, smoothY, Math.max(width, height) * 0.6);
        spotGrad.addColorStop(0, "rgba(229, 9, 20, 0.45)");
        spotGrad.addColorStop(0.4, "rgba(100, 5, 12, 0.2)");
        spotGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = spotGrad;
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.x += p.vx;
          p.y += p.vy;

          const dx = p.x - smoothX;
          const dy = p.y - smoothY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            p.vx += (dx / dist) * 0.4;
            p.vy += (dy / dist) * 0.4;
          }

          p.vx *= 0.98;
          if (p.y < -p.size) {
            p.y = height + p.size;
            p.x = Math.random() * width;
          }

          const pGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          pGrad.addColorStop(0, "rgba(255, 30, 45, " + p.alpha + ")");
          pGrad.addColorStop(1, "rgba(20, 0, 5, 0)");
          ctx.fillStyle = pGrad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 6. Sunset Fluid Aurora Mesh
    "instagram-sunset": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let blobs = [
        { x: 0, y: 0, vx: 0, vy: 0, color: "rgba(255, 45, 120, 0.7)", baseRadius: 0.55 },
        { x: 0, y: 0, vx: 0, vy: 0, color: "rgba(255, 140, 0, 0.65)", baseRadius: 0.5 },
        { x: 0, y: 0, vx: 0, vy: 0, color: "rgba(138, 35, 135, 0.6)", baseRadius: 0.58 },
        { x: 0, y: 0, vx: 0, vy: 0, color: "rgba(63, 81, 181, 0.5)", baseRadius: 0.45 }
      ];

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#0c0817";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.sin(frame * 0.02) * (width * 0.25);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.cos(frame * 0.02) * (height * 0.25);

        const maxDim = Math.max(width, height);
        for (let i = 0; i < blobs.length; i++) {
          const b = blobs[i];
          const angle = (frame * 0.015) + (i * Math.PI * 0.5);
          const orbitX = (width * 0.5) + Math.cos(angle) * (width * 0.3);
          const orbitY = (height * 0.5) + Math.sin(angle) * (height * 0.25);

          const tx = orbitX + (targetX - orbitX) * 0.35;
          const ty = orbitY + (targetY - orbitY) * 0.35;

          b.x += (tx - b.x) * 0.06;
          b.y += (ty - b.y) * 0.06;

          const r = maxDim * b.baseRadius;
          const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
          g.addColorStop(0, b.color);
          g.addColorStop(1, "rgba(12, 8, 23, 0)");

          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 7. Studio Slate Audio Matrix
    "youtube-studio": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#0e0f13";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.02) * (width * 0.28);

        const BAR_WIDTH = 4;
        const GAP = 12;
        const count = Math.ceil(width / (BAR_WIDTH + GAP));

        for (let i = 0; i < count; i++) {
          const bx = i * (BAR_WIDTH + GAP) + GAP;
          const dist = Math.abs(bx - targetX);
          const prox = Math.max(0, 1 - dist / (width * 0.35));

          const baseWave = Math.sin((i * 0.15) + (frame * 0.06)) * 0.5 + 0.5;
          const barH = (baseWave * (height * 0.15)) + (prox * (height * 0.5)) + 6;

          const by = height - barH;
          const grad = ctx.createLinearGradient(0, by, 0, height);
          grad.addColorStop(0, prox > 0.3 ? "#ff0033" : "#4f5366");
          grad.addColorStop(1, "rgba(255, 0, 51, 0.05)");

          ctx.fillStyle = grad;
          ctx.fillRect(bx, by, BAR_WIDTH, barH);
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 8. Apple Frosted Aurora Fluids
    "apple-aurora": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let orbs = [
        { x: 0, y: 0, color: "rgba(99, 140, 255, 0.45)", radRatio: 0.55 },
        { x: 0, y: 0, color: "rgba(255, 180, 210, 0.45)", radRatio: 0.5 },
        { x: 0, y: 0, color: "rgba(180, 240, 255, 0.4)", radRatio: 0.6 }
      ];

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#f5f8fd";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.018) * (width * 0.25);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.sin(frame * 0.022) * (height * 0.25);

        const maxDim = Math.max(width, height);
        for (let i = 0; i < orbs.length; i++) {
          const o = orbs[i];
          const angle = (frame * 0.012) + (i * Math.PI * 0.66);
          const bx = (width * 0.5) + Math.cos(angle) * (width * 0.25);
          const by = (height * 0.5) + Math.sin(angle) * (height * 0.25);

          const tx = bx + (targetX - bx) * 0.4;
          const ty = by + (targetY - by) * 0.4;

          o.x += (tx - o.x) * 0.06;
          o.y += (ty - o.y) * 0.06;

          const r = maxDim * o.radRatio;
          const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r);
          g.addColorStop(0, o.color);
          g.addColorStop(1, "rgba(245, 248, 253, 0)");

          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 9. Y2K Acid Grid Vortex
    "y2k-vortex": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#e8daf0";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.02) * (width * 0.25);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.sin(frame * 0.025) * (height * 0.25);

        const STEP = 28;
        const cols = Math.ceil(width / STEP) + 2;
        const rows = Math.ceil(height / STEP) + 2;

        ctx.strokeStyle = "rgba(196, 160, 214, 0.85)";
        ctx.lineWidth = 1.5;

        for (let r = 0; r < rows; r++) {
          ctx.beginPath();
          for (let c = 0; c < cols; c++) {
            let x = c * STEP;
            let y = r * STEP;

            const dx = x - targetX;
            const dy = y - targetY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
              const warp = (1 - dist / 150) * 22;
              x += (dx / (dist || 1)) * warp;
              y += (dy / (dist || 1)) * warp;
            }

            if (c === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        for (let c = 0; c < cols; c++) {
          ctx.beginPath();
          for (let r = 0; r < rows; r++) {
            let x = c * STEP;
            let y = r * STEP;

            const dx = x - targetX;
            const dy = y - targetY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 150) {
              const warp = (1 - dist / 150) * 22;
              x += (dx / (dist || 1)) * warp;
              y += (dy / (dist || 1)) * warp;
            }

            if (r === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 10. Neo-Brutalist Kinetic Polka Dots
    "neobrutalism-dots": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let dots = [];
      const SPACING = 24;

      function initDots() {
        dots = [];
        const cols = Math.ceil(width / SPACING) + 1;
        const rows = Math.ceil(height / SPACING) + 1;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            dots.push({
              ox: c * SPACING,
              oy: r * SPACING,
              x: c * SPACING,
              y: r * SPACING,
              vx: 0,
              vy: 0
            });
          }
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        initDots();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        ctx.fillStyle = "#f8f5eb";
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.02) * (width * 0.3);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.sin(frame * 0.025) * (height * 0.3);

        ctx.fillStyle = "#000000";
        for (let i = 0; i < dots.length; i++) {
          const d = dots[i];
          const dx = d.x - targetX;
          const dy = d.y - targetY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 110) {
            const force = (1 - dist / 110) * 16;
            d.vx += (dx / (dist || 1)) * force;
            d.vy += (dy / (dist || 1)) * force;
          }

          d.vx += (d.ox - d.x) * 0.12;
          d.vy += (d.oy - d.y) * 0.12;
          d.vx *= 0.82;
          d.vy *= 0.82;
          d.x += d.vx;
          d.y += d.vy;

          const r = Math.max(1.2, 2.5 + (Math.hypot(d.vx, d.vy) * 0.35));
          ctx.beginPath();
          ctx.arc(d.x, d.y, r, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 11. Emerald & Liquid Gold Stardust
    "luxury-gold": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let particles = [];
      const COUNT = 60;

      function initParticles() {
        particles = [];
        for (let i = 0; i < COUNT; i++) {
          particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            size: Math.random() * 2.2 + 0.8,
            twinkle: Math.random() * Math.PI
          });
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        initParticles();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let frame = 0;
      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        frame++;
        ctx.clearRect(0, 0, width, height);

        const bgGrad = ctx.createRadialGradient(width * 0.5, height * 0.3, 10, width * 0.5, height * 0.5, Math.max(width, height));
        bgGrad.addColorStop(0, "#083325");
        bgGrad.addColorStop(0.6, "#041a12");
        bgGrad.addColorStop(1, "#020f0a");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        let targetX = mouse.isInside ? mouse.x : width / 2 + Math.cos(frame * 0.02) * (width * 0.25);
        let targetY = mouse.isInside ? mouse.y : height / 2 + Math.sin(frame * 0.02) * (height * 0.25);

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.twinkle += 0.04;

          const dx = targetX - p.x;
          const dy = targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 180 && dist > 10) {
            p.vx += (dx / dist) * 0.15;
            p.vy += (dy / dist) * 0.15;
          }

          p.vx *= 0.94;
          p.vy *= 0.94;
          p.x += p.vx;
          p.y += p.vy;

          if (p.x < 0) p.x = width;
          if (p.x > width) p.x = 0;
          if (p.y < 0) p.y = height;
          if (p.y > height) p.y = 0;

          const alpha = 0.4 + Math.sin(p.twinkle) * 0.4;
          ctx.fillStyle = "rgba(212, 175, 55, " + alpha + ")";
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();

          if (dist < 100) {
            ctx.fillStyle = "rgba(255, 215, 0, " + (alpha * 0.25) + ")";
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 12. Matrix Phosphor Cyber Rain
    "matrix-rain": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      const FONT_SIZE = 14;
      let drops = [];
      const CHARS = "0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ";

      function initDrops() {
        drops = [];
        const cols = Math.ceil(width / FONT_SIZE);
        for (let i = 0; i < cols; i++) {
          drops[i] = Math.random() * -50;
        }
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        initDrops();
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        ctx.fillStyle = "rgba(2, 9, 5, 0.12)";
        ctx.fillRect(0, 0, width, height);

        ctx.font = FONT_SIZE + "px monospace";

        for (let i = 0; i < drops.length; i++) {
          const char = CHARS[Math.floor(Math.random() * CHARS.length)];
          const x = i * FONT_SIZE;
          const y = drops[i] * FONT_SIZE;

          const dist = Math.hypot(x - mouse.x, y - mouse.y);
          if (dist < 80) {
            ctx.fillStyle = "#ffffff";
          } else {
            ctx.fillStyle = "#00ff66";
          }

          ctx.fillText(char, x, y);

          if (y > height && Math.random() > 0.975) {
            drops[i] = 0;
          }
          drops[i]++;
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 13. Zen Coffee / Steam (Rising warm ambient steam trails & espresso glow)
    "coffee-steam": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let particles = [];
      let embers = [];
      const COUNT = 40;
      const EMBER_COUNT = 24;

      function resetParticle(p, fullReset = false) {
        p.x = Math.random() * width;
        p.y = fullReset ? Math.random() * height : height + 30;
        p.vx = (Math.random() - 0.5) * 0.5;
        p.vy = -(0.8 + Math.random() * 1.2);
        p.size = 20 + Math.random() * 45;
        p.alpha = 0.2 + Math.random() * 0.45;
        p.wobble = Math.random() * Math.PI * 2;
        p.wobbleSpeed = 0.02 + Math.random() * 0.03;
      }

      function resetEmber(e, fullReset = false) {
        e.x = Math.random() * width;
        e.y = fullReset ? Math.random() * height : height + 10;
        e.size = 2 + Math.random() * 3.5;
        e.vy = -(0.9 + Math.random() * 1.5);
        e.vx = (Math.random() - 0.5) * 0.8;
        e.alpha = 0.4 + Math.random() * 0.5;
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        particles = [];
        for (let i = 0; i < COUNT; i++) {
          const p = {};
          resetParticle(p, true);
          particles.push(p);
        }
        embers = [];
        for (let i = 0; i < EMBER_COUNT; i++) {
          const e = {};
          resetEmber(e, true);
          embers.push(e);
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let animId = null;
      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        // Solid warm espresso background
        ctx.fillStyle = "#14100c";
        ctx.fillRect(0, 0, width, height);

        // Soft ambient warm glow in center
        const amb = ctx.createRadialGradient(width * 0.5, height * 0.7, 10, width * 0.5, height * 0.7, width * 0.7);
        amb.addColorStop(0, "rgba(180, 110, 50, 0.18)");
        amb.addColorStop(1, "rgba(20, 16, 12, 0)");
        ctx.fillStyle = amb;
        ctx.fillRect(0, 0, width, height);

        // Rising Steam Clouds
        for (const p of particles) {
          p.wobble += p.wobbleSpeed;
          p.x += p.vx + Math.sin(p.wobble) * 0.6;
          p.y += p.vy;

          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 110 && dist > 0) {
            p.x += (dx / dist) * 2;
            p.y += (dy / dist) * 2;
          }

          if (p.y < -p.size || p.x < -p.size || p.x > width + p.size) {
            resetParticle(p);
          }

          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          grad.addColorStop(0, `rgba(240, 205, 160, ${p.alpha * 0.85})`);
          grad.addColorStop(0.4, `rgba(190, 135, 80, ${p.alpha * 0.45})`);
          grad.addColorStop(1, "rgba(20, 16, 12, 0)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        // Glowing warm embers
        for (const e of embers) {
          e.y += e.vy;
          e.x += e.vx;
          if (e.y < -10) resetEmber(e);

          ctx.fillStyle = `rgba(255, 180, 90, ${e.alpha})`;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 14. Zen Bamboo & Mist (Sumi-e mist and tranquil floating petals)
    "zen-mist": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let petals = [];
      const COUNT = 32;

      function resetPetal(p, fullReset = false) {
        p.x = Math.random() * width;
        p.y = fullReset ? Math.random() * height : -20;
        p.size = 10 + Math.random() * 12;
        p.speedY = 0.6 + Math.random() * 0.9;
        p.speedX = (Math.random() - 0.5) * 0.6;
        p.angle = Math.random() * Math.PI * 2;
        p.spin = (Math.random() - 0.5) * 0.03;
        p.isGreen = Math.random() > 0.35;
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        petals = [];
        for (let i = 0; i < COUNT; i++) {
          const p = {};
          resetPetal(p, true);
          petals.push(p);
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let animId = null;
      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        // Serene Sumi-e dark ink wash
        ctx.fillStyle = "#0c0f0d";
        ctx.fillRect(0, 0, width, height);

        // Soft jade mist wash
        const mist = ctx.createRadialGradient(width * 0.5, 0, 10, width * 0.5, height * 0.5, width * 0.8);
        mist.addColorStop(0, "rgba(55, 110, 75, 0.22)");
        mist.addColorStop(1, "rgba(12, 15, 13, 0)");
        ctx.fillStyle = mist;
        ctx.fillRect(0, 0, width, height);

        // Floating Bamboo Leaves
        for (const p of petals) {
          p.y += p.speedY;
          p.x += p.speedX + Math.sin(p.angle) * 0.45;
          p.angle += p.spin;

          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 90 && dist > 0) {
            p.x += (dx / dist) * 2;
            p.y += (dy / dist) * 2;
          }

          if (p.y > height + 25) {
            resetPetal(p);
          }

          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);

          // Leaf body
          ctx.fillStyle = p.isGreen ? "rgba(95, 205, 135, 0.85)" : "rgba(225, 240, 230, 0.88)";
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size * 0.38, 0, 0, Math.PI * 2);
          ctx.fill();

          // Leaf center spine
          ctx.strokeStyle = p.isGreen ? "rgba(40, 120, 70, 0.9)" : "rgba(160, 180, 170, 0.9)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-p.size * 0.9, 0);
          ctx.lineTo(p.size * 0.9, 0);
          ctx.stroke();

          ctx.restore();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 15. Boba Pearls (Floating buoyant boba tapioca pearls with gentle milk tea float)
    "boba-pearls": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      let pearls = [];
      const COUNT = 26;

      function resetPearl(p, fullReset = false) {
        p.x = Math.random() * width;
        p.y = fullReset ? Math.random() * height : height + 35;
        p.radius = 12 + Math.random() * 18;
        p.vy = -(0.5 + Math.random() * 0.9);
        p.vx = (Math.random() - 0.5) * 0.4;
        p.wobble = Math.random() * Math.PI * 2;
      }

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        pearls = [];
        for (let i = 0; i < COUNT; i++) {
          const p = {};
          resetPearl(p, true);
          pearls.push(p);
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let animId = null;
      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        // Warm Taro & Milk Tea Canvas
        ctx.fillStyle = "#14101a";
        ctx.fillRect(0, 0, width, height);

        const glow = ctx.createRadialGradient(width * 0.4, height * 0.4, 20, width * 0.5, height * 0.5, width * 0.7);
        glow.addColorStop(0, "rgba(168, 85, 247, 0.16)");
        glow.addColorStop(1, "rgba(20, 16, 26, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);

        for (const p of pearls) {
          p.wobble += 0.025;
          p.x += p.vx + Math.sin(p.wobble) * 0.35;
          p.y += p.vy;

          const dx = p.x - mouse.x;
          const dy = p.y - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < p.radius + 60 && dist > 0) {
            p.x += (dx / dist) * 2.5;
            p.y += (dy / dist) * 2.5;
          }

          if (p.y < -p.radius * 2) {
            resetPearl(p);
          }

          // Translucent Boba pearl with rich caramel outer ring
          const grad = ctx.createRadialGradient(
            p.x - p.radius * 0.35,
            p.y - p.radius * 0.35,
            p.radius * 0.1,
            p.x,
            p.y,
            p.radius
          );
          grad.addColorStop(0, "rgba(215, 175, 245, 0.7)");
          grad.addColorStop(0.5, "rgba(85, 45, 30, 0.95)");
          grad.addColorStop(1, "rgba(25, 12, 8, 1)");

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fill();

          // Outer glowing pearl rim
          ctx.strokeStyle = "rgba(192, 132, 252, 0.55)";
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Shiny Specular Reflection Dot
          ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
          ctx.beginPath();
          ctx.arc(p.x - p.radius * 0.35, p.y - p.radius * 0.35, p.radius * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    },

    // 16. Architectural Blueprint (Clean isometric blueprint grid with responsive structural crosshairs)
    "architectural-blueprint": (el) => {
      const { canvas, isFullPage } = prepareTarget(el);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { mouse, cleanup: cleanupMouse } = setupMouseTracking(el, isFullPage);

      let width = 0, height = 0;
      const GRID = 28;

      function resize() {
        const rect = isFullPage ? { width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
        width = Math.max(1, Math.round(rect.width));
        height = Math.max(1, Math.round(rect.height));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      resize();

      const ro = (typeof ResizeObserver !== "undefined" && !isFullPage) ? new ResizeObserver(resize) : null;
      if (ro) ro.observe(el);
      window.addEventListener("resize", resize);

      let animId = null;

      function animate() {
        if (!canvas.isConnected) {
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          return;
        }

        // CAD Blueprint slate
        ctx.fillStyle = "#090d14";
        ctx.fillRect(0, 0, width, height);

        // Minor grid lines
        ctx.strokeStyle = "rgba(56, 160, 255, 0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= width; x += GRID) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, height);
        }
        for (let y = 0; y <= height; y += GRID) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(width, y + 0.5);
        }
        ctx.stroke();

        // Major grid lines every 4 cells
        ctx.strokeStyle = "rgba(56, 180, 255, 0.32)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 0; x <= width; x += GRID * 4) {
          ctx.moveTo(x + 0.5, 0);
          ctx.lineTo(x + 0.5, height);
        }
        for (let y = 0; y <= height; y += GRID * 4) {
          ctx.moveTo(0, y + 0.5);
          ctx.lineTo(width, y + 0.5);
        }
        ctx.stroke();

        // Interactive Architectural Crosshairs & coordinate nodes near mouse
        const snapX = Math.round(mouse.x / GRID) * GRID;
        const snapY = Math.round(mouse.y / GRID) * GRID;

        if (mouse.x > 0 && mouse.y > 0) {
          // Crosshair lines
          ctx.strokeStyle = "rgba(80, 200, 255, 0.85)";
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(snapX, Math.max(0, snapY - 50));
          ctx.lineTo(snapX, Math.min(height, snapY + 50));
          ctx.moveTo(Math.max(0, snapX - 50), snapY);
          ctx.lineTo(Math.min(width, snapX + 50), snapY);
          ctx.stroke();

          // Golden ratio dimension circles
          ctx.strokeStyle = "rgba(80, 200, 255, 0.75)";
          ctx.beginPath();
          ctx.arc(snapX, snapY, 10, 0, Math.PI * 2);
          ctx.arc(snapX, snapY, 22, 0, Math.PI * 2);
          ctx.stroke();

          // Coordinate readout
          ctx.font = "bold 9.5px 'JetBrains Mono', monospace";
          ctx.fillStyle = "#ffffff";
          ctx.fillText(`CAD [${snapX}, ${snapY}]`, snapX + 14, snapY - 14);
        }

        animId = requestAnimationFrame(animate);
      }
      animId = requestAnimationFrame(animate);

      return {
        destroy: () => {
          if (animId) cancelAnimationFrame(animId);
          if (ro) ro.disconnect();
          window.removeEventListener("resize", resize);
          cleanupMouse();
          canvas.remove();
        }
      };
    }
  };

  // Helper to resolve preset engine by ID or name
  function resolveEngineId(idOrString) {
    if (!idOrString) return null;
    const s = String(idOrString).toLowerCase();
    if (s.includes("coffee") || s.includes("steam") || s.includes("cortado") || s.includes("roast")) return "coffee-steam";
    if (s.includes("zen") || s.includes("panda") || s.includes("bamboo") || s.includes("mist")) return "zen-mist";
    if (s.includes("boba") || s.includes("pearl") || s.includes("taro")) return "boba-pearls";
    if (s.includes("architect") || s.includes("blueprint") || s.includes("bauhaus")) return "architectural-blueprint";
    if (s.includes("repulsion")) return "repulsion-grid";
    if (s.includes("chromatic") || s.includes("laser")) return "chromatic-laser";
    if (s.includes("cyber") || s.includes("manga")) return "cyber-grid";
    if (s.includes("vogue") || s.includes("halftone")) return "vogue-waves";
    if (s.includes("netflix") || s.includes("smoke") || s.includes("spotlight")) return "netflix-smoke";
    if (s.includes("instagram") || s.includes("sunset") || s.includes("aurora-mesh")) return "instagram-sunset";
    if (s.includes("youtube") || s.includes("audio") || s.includes("slate")) return "youtube-studio";
    if (s.includes("apple") || s.includes("frosted")) return "apple-aurora";
    if (s.includes("y2k") || s.includes("vortex") || s.includes("acid")) return "y2k-vortex";
    if (s.includes("neobrutalism") || s.includes("polka")) return "neobrutalism-dots";
    if (s.includes("luxury") || s.includes("gold") || s.includes("emerald") || s.includes("stardust")) return "luxury-gold";
    if (s.includes("matrix") || s.includes("phosphor") || s.includes("rain")) return "matrix-rain";
    return null;
  }

  function mount(targetEl, engineIdOrName, options = {}) {
    if (!targetEl) return null;
    unmount(targetEl);

    const engineId = resolveEngineId(engineIdOrName);
    if (!engineId || !ENGINES[engineId]) return null;

    const instance = ENGINES[engineId](targetEl, options);
    if (instance) {
      activeMounts.set(targetEl, instance);
    }
    return instance;
  }

  function unmount(targetEl) {
    if (!targetEl) return;
    const instance = activeMounts.get(targetEl);
    if (instance && typeof instance.destroy === "function") {
      instance.destroy();
    }
    activeMounts.delete(targetEl);

    // Restore original inline styles
    if (originalStylesMap.has(targetEl)) {
      const orig = originalStylesMap.get(targetEl);
      if (orig.position) {
        targetEl.style.position = orig.position;
      } else {
        targetEl.style.removeProperty("position");
      }
      if (orig.isolation) {
        targetEl.style.isolation = orig.isolation;
      } else {
        targetEl.style.removeProperty("isolation");
      }
      if (orig.zIndex) {
        targetEl.style.zIndex = orig.zIndex;
      } else {
        targetEl.style.removeProperty("z-index");
      }
      if (orig.backgroundColor) {
        targetEl.style.backgroundColor = orig.backgroundColor;
      } else {
        targetEl.style.removeProperty("background-color");
      }
      if (orig.backgroundImage) {
        targetEl.style.backgroundImage = orig.backgroundImage;
      } else {
        targetEl.style.removeProperty("background-image");
      }
      originalStylesMap.delete(targetEl);
    }

    // Also remove any DOM canvases
    targetEl.querySelectorAll(":scope > .imagine-interactive-canvas, :scope > .imagine-webgl-canvas, :scope > .imagine-interactive-stamp").forEach(c => c.remove());
    if (targetEl === document.body || targetEl === document.documentElement) {
      document.querySelectorAll("#imagine-interactive-canvas-global, #imagine-webgl-canvas-global, .imagine-interactive-canvas-global, .imagine-interactive-stamp-global").forEach(c => c.remove());
    }
  }

  return {
    mount,
    unmount,
    resolveEngineId,
    engines: Object.keys(ENGINES)
  };
})();

if (typeof window !== "undefined") {
  window.InteractiveBackgrounds = InteractiveBackgrounds;
}
