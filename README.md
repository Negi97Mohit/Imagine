<div align="center">

<img src="extension/icon128.png" alt="Open Sesame" width="96" height="96">

# Open Sesame

**Universal Interactive Asset Layer — Turn any image across the web into an interactive canvas.**

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/EXTENSION_ID?label=Chrome%20Web%20Store&logo=google-chrome&logoColor=white&color=4285F4)](https://chrome.google.com/webstore)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Database: Realtime Database](https://img.shields.io/badge/Sync-Firebase%20RTDB-orange.svg)](https://firebase.google.com/docs/database)
[![Security: Sandboxed](https://img.shields.io/badge/Security-Null--Origin%20Sandbox-success)](README.md#security--sandboxing-architecture)

</div>

---

## What is Open Sesame?

Ever looked at a photograph, product image, poster, or artwork on the web and wished it wasn't just a flat, lifeless image? Welcome to **Open Sesame**! Whether you want to add a liquid water ripple effect, scratch off a mystery layer, shatter glass into physics shards, or convert a portrait into a matrix of ASCII typography, Open Sesame turns any image on any webpage into an interactive playground.

Powered by a **128-bit composite perceptual fingerprinting engine** (`dHash` + $4 \times 4$ color grid + intrinsic aspect ratio), Open Sesame recognizes the exact visual asset regardless of website changes, CDN image resizing, or URL query parameters. When an interaction is bound to an image, anyone browsing the web with the extension will see that interaction live on that image in real-time.

Wrapped in a sleek, lightweight interface with persistent floating pins, Open Sesame stays out of your way until you hover or click to interact.

✨ Explore Curated Interactions
Choose from our curated built-in interactive templates to instantly transform what you are looking at:

- **Water Reveal**: Dynamic liquid ripples that refract and warp the photo under your cursor.
- **Scratch Card**: Interactive scratch-off lottery ticket overlay revealing the image beneath.
- **Shattered Glass**: Realistic glass fracture impact physics with flying polygonal shards.
- **ASCII-fication**: Matrix-style typography conversion with a realtime cursor decode flashlight.
- **Magnetic Iron Filings**: Thousands of particle needles orienting along a magnetic field.
- **Before / After Slider**: Dual-pane comparison comparing grayscale and vibrant color grading.
- **Thermal Vision Toggle**: Infrared false-color thermal scan with CRT scanline animations.
- **Echo Trail**: Temporal motion ghosting effect trailing behind your pointer.
- **Connect-the-Dots Constellation**: Interactive astronomical star map anchored over the visual.
- **Live Reaction Bar**: Floating emoji feedback system allowing viewers to react in real-time.
- **Padlock Unlock**: Interactive security dial that unlocks when the puzzle is solved.

🎯 Interact Your Way
Open Sesame adapts to your browsing flow with flexible interaction modes:

- **Hover & Play**: Hover over any candidate image with an active binding to instantly trigger its interactive canvas overlay.
- **Pin Mode (+)**: Click the persistent orange `+` pin in the corner of any image to open the multi-creator switcher, toggle bindings, or preview different author variations.
- **Popup Binder**: Click the extension icon in your Chrome toolbar to auto-scan the current page, choose from your library or the global gallery, and bind with one click.

🛠️ Infinite Customization & Live Studio
Can't find the exact visual effect you're imagining? Create it! Open the built-in **Interaction Editor** to author custom HTML5, CSS, and JavaScript mini-apps with live sandbox previewing. Save them to your local library or publish them to the Global Gallery for anyone worldwide to enjoy.

🔒 Privacy-First & Sandboxed Execution
Your security comes first. All user-authored scripts execute inside a strict `null`-origin sandboxed iframe with zero access to your cookies, host DOM, or extension APIs. Privileged background CORS bridges ensure pixel-based shaders run smoothly without canvas tainting.

Crafted with care by Mohit Singh Negi.

---

## Screenshots

> _Add screenshots here — popup UI, floating '+' pin menu, live sandbox interaction, editor studio_

---

## Features

| Feature                        | Description                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **11 built-in templates**      | Water Reveal · Scratch Card · Shattered Glass · ASCII-fication · Iron Filings · Before/After · Thermal · Echo · Constellation · Reactions · Padlock |
| **128-bit visual fingerprint** | Composite `dHash` + 16-cell color grid + intrinsic aspect ratio recognizes images across CDNs, resolutions, and sites                               |
| **Real-time multi-user sync**  | Instant sync via Firebase Realtime Database with $<300\text{ms}$ propagation across tabs and devices                                                |
| **Multi-creator switcher**     | View multiple authored interactions on the same image and switch or hide individual creator layers                                                  |
| **Built-in code editor**       | Fullscreen IDE with HTML/CSS/JS authoring, live canvas preview, and one-click gallery publishing                                                    |
| **Instant SPA recycling**      | `IntersectionObserver` & `MutationObserver` recycling prevents memory leaks on infinite-scroll sites (Pinterest, Twitter)                           |
| **Pause & Resume toggle**      | Global toggle in the popup header to pause all overlays whenever you want a standard browsing view                                                  |
| **CORS pixel pipeline**        | Privileged background bridge for raw pixel analysis (`getImageData`) without canvas tainting errors                                                 |
| **Zero host DOM interference** | Sandboxed `null`-origin execution isolates user code completely from the host website                                                               |

---

## Requirements

- **Google Chrome** version 116 or later (Manifest V3 support)
- Any standard desktop Chromium-based browser (Brave, Edge, Opera, Vivaldi)

---

## Installation

### From the Chrome Web Store _(recommended)_

1. Visit the [Open Sesame page on the Chrome Web Store](#) _(link coming soon)_
2. Click **Add to Chrome**
3. Pin **Open Sesame** to your browser toolbar for quick access

### From Source

```bash
git clone https://github.com/Negi97Mohit/Imagine.git
```

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` directory from the cloned repository

---

## How It Works

```
┌────────────────────────────────────────────────────────────────────────┐
│  Webpage (any URL)                                                     │
│                                                                        │
│  image-detector.js                                                     │
│   ├─ Scans DOM for candidate <img> elements (w, h >= 140px)            │
│   ├─ Intersects with viewport (+300px buffer)                          │
│   └─ Recycles unmounted nodes on SPA infinite scroll ──────────────────┤
│                                                                        │
│  content.js & identity.js                                              │
│   ├─ Computes 128-bit composite hash (dHash + color + aspect)          │
│   ├─ Resolves canonical visual asset ID via background worker          │
│   └─ Forwards to overlay controller ───────────────────────────────────┤
│                                                                        │
│  overlay.js                                                            │
│   ├─ Mounts persistent '+' pin (0.85 resting opacity)                  │
│   ├─ Manages floating multi-creator interaction menu                   │
│   └─ Mounts sandboxed execution iframe on hover ───────────────────────┤
│                                                                        │
│  sandbox.html & sandbox.js (Null-Origin Sandbox)                       │
│   ├─ Executes user interaction isolated from host DOM                  │
│   ├─ Fetches CORS-clean data URLs via background bridge                │
│   └─ Watchdog surfaces errors via visual warning badge ────────────────┤
│                                                                        │
│  background.js (Service Worker)                                        │
│   ├─ Syncs & caches bindings via Firebase Realtime Database            │
│   ├─ Enforces 1-binding-per-user per image asset                       │
│   └─ Broadcasts live updates to all open tabs                          │
└────────────────────────────────────────────────────────────────────────┘
```

When an image comes into view, the content script generates its 128-bit perceptual hash and queries Firebase Realtime Database. On hover, the isolated sandbox iframe renders the active interaction canvas over the image in real-time.

---

## Project Structure

```
locked-image-universal-asset-layer/
├── manifest.json              # Extension manifest (MV3)
├── background.js              # Service worker — identity, RTDB sync, CORS bridge, broadcast
├── content.js                 # Content script — DOM detector, visual hashing, live sync loop
├── sandbox.html               # Sandboxed execution iframe markup & loading bar
├── sandbox.js                 # Sandboxed runner, storage bridge, error watchdog
├── templates.js               # 11 built-in interactive templates
├── hash.js                    # Perceptual 64-bit dHash implementation
├── database.rules.json        # Firebase Realtime Database security & schema rules
├── popup.html                 # Extension toolbar popup UI
├── popup.js                   # Popup controller — image picker, gallery, quick binder
├── editor.html                # Fullscreen interaction authoring studio
├── editor.js                  # Editor controller — live sandbox preview, save, publish
├── modules/
│   ├── identity.js            # Visual fingerprinting, canonical matching, Cyrb53
│   ├── image-detector.js      # DOM scanner, lazy-load observer, SPA lifecycle
│   ├── overlay.js             # Viewport-adaptive pin, floating multi-author menu
│   └── config.js              # Configuration defaults
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## Built-in Interactions

| Interaction               | Category              | Effect Description                                            |
| ------------------------- | --------------------- | ------------------------------------------------------------- |
| **Water Reveal**          | Fluid Simulation      | Liquid ripples distorting the photo based on pointer velocity |
| **Scratch Card**          | Gamification          | Silver scratch-off surface revealing the image beneath        |
| **Shattered Glass**       | Physics / Destruction | Radial glass fracture impact with dynamic shard dispersion    |
| **ASCII-fication**        | Retro / Typography    | Full ASCII matrix conversion with flashlight cursor reveal    |
| **Magnetic Iron Filings** | Particle Physics      | Electromagnetic particles aligning around pointer coords      |
| **Before / After Slider** | Utility / Photo       | Dual-pane split slider comparing grayscale and color grading  |
| **Thermal Vision Toggle** | Shader / FX           | Infrared false-color temperature heatmap with CRT scanlines   |
| **Echo Trail**            | Visual FX             | Motion ghosting trail following pointer coordinates           |
| **Connect-the-Dots**      | Astronomical          | Star constellation nodes connecting dynamically to cursor     |
| **Live Reaction Bar**     | Social                | Real-time emoji floating reaction overlay                     |
| **Padlock Unlock**        | Puzzle / Security     | Interactive lock tumbler that opens on solving                |

---

## Custom Interactions

Click **"+ Create New in Editor"** from the overlay menu or popup to build your own interaction in the Live Editor:

```javascript
function run(canvas, img, config, root) {
  const ctx = canvas.getContext("2d");
  let mx = -9999,
    my = -9999;

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Custom shader / canvas logic here
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  return {
    onPointerMove(x, y) {
      mx = x;
      my = y;
      render();
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      render();
    },
    destroy() {},
  };
}
```

Custom interactions are saved to your local library and can be published to the Global Gallery for anyone using Open Sesame to discover and bind.

---

## Security & Sandboxing Architecture

Open Sesame enforces enterprise-grade security boundaries:

- **Isolated Null-Origin Iframe**: Scripts run inside an `iframe` with `sandbox="allow-scripts"` and a unique `null` origin.
- **Zero Host Access**: User scripts cannot access the host website's DOM, cookies, session storage, or credentials.
- **Zero Extension Access**: User scripts have no access to `chrome.*` APIs.
- **Privileged CORS Bridge**: Pixel-reading interactions access clean image bitmaps via the background service worker, preventing cross-origin canvas tainting without exposing host data.
- **Watchdog Error Handling**: Script runtime exceptions are caught by an internal watchdog that renders a visual error badge rather than freezing the canvas.

---

## Privacy

Open Sesame is designed with a privacy-first foundation:

- **No Personal Data Collection**: No browsing history, account credentials, or identifying information is collected.
- **Anonymous User IDs**: Multi-user bindings use anonymous, cryptographically random UUIDs stored in local extension storage.
- **Sandboxed Execution**: Third-party interaction scripts cannot track users or access host webpage data.

---

## Browser Compatibility

| Browser            | Status                                      |
| ------------------ | ------------------------------------------- |
| Google Chrome 116+ | ✅ Fully supported                          |
| Brave Browser      | ✅ Fully supported                          |
| Microsoft Edge     | ✅ Fully supported                          |
| Opera / Vivaldi    | ✅ Fully supported                          |
| Firefox            | ⚠️ Limited (Manifest V3 compatibility mode) |
| Safari             | ❌ Not supported                            |

---

## Troubleshooting

**The '+' pin does not appear on an image**
Ensure the image is at least $140 \times 140\text{px}$ and visible in the viewport. Small thumbnails, icons, and UI buttons are filtered out automatically.

**An interaction appears blank on a specific website**
Certain CDNs block canvas pixel extraction. Open Sesame automatically requests a clean background Data URL. If an author's script has a syntax error, a small `⚠️ Interaction Error` badge will appear on the bottom left.

**Interactions are paused**
Check the popup menu header. If the toggle button shows `⏸ Off`, click it to switch it back to `▶ On`.

---

## Roadmap

- [x] 128-bit composite perceptual fingerprinting (`dHash` + color + aspect)
- [x] Multi-user realtime synchronization via Firebase Realtime Database
- [x] Multi-creator switcher & creator attribution (`you`)
- [x] 11 built-in interactive templates
- [x] Built-in fullscreen live code editor & Global Gallery
- [x] Privileged CORS data URL background bridge
- [x] Viewport-adaptive '+' pin & MutationObserver SPA recycling
- [ ] Sound effect & Web Audio API synthesizer support in sandbox
- [ ] 3D WebGL / Three.js shader interaction presets
- [ ] Export interactive images as standalone embeddable web components

---

## Contributing

Contributions, bug reports, and new interaction templates are welcome!

```bash
git clone https://github.com/Negi97Mohit/Imagine.git
cd Imagine
# Load as unpacked extension in chrome://extensions
```

There is no build step — the extension runs directly from source.

---

## License

[MIT](LICENSE) © Mohit Singh Negi

---

<div align="center">

Made with ♥ by <a href="https://www.linkedin.com/in/mohit-singh-negi/">Mohit Singh Negi</a>

</div>
