# Locked Image — Universal Interactive Asset Layer Architecture

## 1. Architecture Overview

Locked Image is a browser extension that attaches an interactive code overlay (HTML/CSS/Canvas/JavaScript) to images anywhere on the web. Instead of indexing images purely by volatile URLs or CDNs, images are identified by **what they look like** (perceptual visual fingerprinting) and persisted to a shared **Firebase Realtime Database**.

```
[Web Page <img>]
       │
       ▼
[ImageDetector] (IntersectionObserver + MutationObserver)
       │
       ▼
[Direct Canvas Extraction / Background Worker]
  └─► 128-bit Composite Hash (64-bit dHash + 4x4 Color Grid + Aspect Ratio)
       │
       ▼
[Firebase Realtime Database (RTDB)]
  └─► /bindings/{assetId}/{pushId}
       │
       ▼
[AssetOverlay Controller]
  ├─► Adaptive Pin & Menu (+) (Clamped to visible viewport)
  └─► Sandboxed <iframe> (Isolated sandbox.html with postMessage API)
```

---

## 2. Directory Structure

```
extension/
  ├── manifest.json              - Manifest V3 configuration, permissions, and sandbox rules
  ├── background.js              - Service worker: handles asset lookup, persistence, and tab broadcast
  ├── content.js                 - Content script orchestrator: detects images, attaches overlays, reconciles canonical IDs
  ├── popup.html / popup.js      - Extension popup: image selector, template browser, library management
  ├── editor.html / editor.js    - Full-screen IDE for authoring and live-previewing custom interactions
  ├── sandbox.html / sandbox.js  - Isolated null-origin iframe environment for executing interaction scripts
  ├── hash.js                    - cyrb53 fast hashing utility
  ├── templates.js               - Built-in interactive templates (Water Reveal, Scratch Card, etc.)
  └── modules/
      ├── config.js              - Firebase database URL and project configuration
      ├── identity.js            - Perceptual visual fingerprinting and aspect-ratio validation
      ├── image-detector.js      - DOM scanner, minimum size filter, and visibility observer
      └── overlay.js             - UI layer: adaptive '+' pin, interaction switcher menu, and sandbox mounting
```

---

## 3. Visual Identity & Fingerprinting

Image identification uses a three-tier hierarchy to prevent both false merges (bleed across similar images) and false splits (failure to match across CDNs/compression):

1. **In-DOM Direct Canvas Extraction (`content.js:tryExtractDirectHash`)**:
   - Content script snapshots the rendered `<img>` pixels via an in-memory `<canvas>` in 0ms without network roundtrips.
2. **Composite 128-bit Perceptual Fingerprint (`identity.js:computeCompositeHash`)**:
   - **64-bit Gradient dHash**: $9\times 8$ grayscale gradient robust to compression and scaling.
   - **4×4 Average Color Grid**: 16 quantized color/luminance cells.
   - **Aspect Ratio Tag**: Prevents collisions between images with different proportions.
3. **Strict Canonical Matching (`background.js:resolveCanonicalAssetId`)**:
   - Merges into an existing asset ONLY if: Aspect Ratio matches AND structural dHash distance $\le 1$ AND color grid distance $\le 4$.
4. **Safe URL Fallback**:
   - Only strips tracking tokens (`utm_*`, `_ga`, `fbclid`). Preserves identifying parameters (`q`, `id`, `v`, `tbn`, `sig`) for search engines and CDN thumbnails.

---

## 4. Multi-User Model & Realtime Synchronization

- **Per-User Attribution**: Each install gets a unique UUID (`anonymousUserId` in `chrome.storage.local`). Each image supports multiple interactions by different authors (`/bindings/{assetId}/{pushId}`).
- **Per-User 1-Interaction Rule**: Users can update their own binding or switch between other users' interactions. Duplicate interaction names on the same image are blocked and highlighted.
- **Active Tab Viewport Sync**: `content.js` polls on-screen visible images every 2.5s and immediately triggers a refresh on `window.focus` and `visibilitychange`.
- **Instant Tab-to-Tab Fan-Out**: Saving or deleting an interaction triggers `chrome.tabs.sendMessage` (`ASSET_BINDING_CHANGED`) across all open tabs.
- **Canonical ID Reconciliation**: `content.js` continuously synchronizes `record.assetId` with `canonicalAssetId`, ensuring authors never lose their active binding.

---

## 5. Viewport Adaptation & Sandboxing

- **Adaptive Clamping**: The `+` pin clamps to the visible viewport intersection (`window.innerWidth`, `window.innerHeight`). The menu automatically flips vertically/horizontally near screen edges.
- **Nested Scroll Capture**: `document.addEventListener("scroll", ..., { capture: true })` tracks scrolling inside carousels, feeds, and nested `overflow` containers.
- **Sandbox Security**: Interactions run in an isolated `iframe` with `sandbox="allow-scripts"` and `Content-Security-Policy: sandbox allow-scripts`. The sandbox communicates with the host page strictly via structured `postMessage` calls with no direct DOM or `chrome.*` API access.

