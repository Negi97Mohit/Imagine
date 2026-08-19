# Locked Image — universal asset layer

## 1. What changed

The extension went from "bind one exact image URL to a custom hover
effect" (still present, untouched, see below) to also having a **second,
independent feature**: a shared marker/interaction layer keyed by what an
image *looks like*, not by its URL. New pieces:

- Perceptual image fingerprinting (background service worker)
- A backend (`/server`) that resolves fingerprints to a canonical
  `assetId` and persists/broadcasts interactions
- A viewport-aware image detector and a lightweight click-to-mark overlay
  (content script)
- A WebSocket relay for realtime fan-out

Nothing about the original per-URL custom-interaction editor/sandbox was
removed — it's now `modules/legacy-bindings.js`, functionally identical to
the old `content.js`, running alongside the new feature.

## 2. Files changed

```
extension/manifest.json          - new host permissions, new content scripts
extension/content.js              - rewritten: now a thin orchestrator
extension/background.js           - added IDENTIFY_ASSET / GET_INTERACTIONS / POST_INTERACTION handlers
extension/modules/config.js       - NEW: backend URLs
extension/modules/legacy-bindings.js - NEW: old content.js logic, moved verbatim
extension/modules/image-detector.js  - NEW: finds + tracks visibility of candidate <img>s
extension/modules/identity.js        - NEW: fingerprinting + backend calls (runs in background.js)
extension/modules/overlay.js         - NEW: marker rendering + click-to-add UI
extension/modules/realtime-client.js - NEW: per-tab WebSocket client
server/                              - NEW: Express + ws + Firestore Admin backend
```
Untouched: `popup.html/js`, `editor.html/js`, `sandbox.html/js`,
`templates.js`, `hash.js`.

## 3. How image identity works

Three levels, cheapest/most-certain first:

1. **Normalized URL** (`modules/identity.js:normalizeUrl`) — strips a
   conservative allowlist of resize/tracking query params. The backend
   checks for an exact match first (`findAssetByNormalizedUrl`); if found,
   that's the answer, confidence 1.0, no fingerprinting needed.
2. **Perceptual fingerprint** — the background service worker fetches the
   image bytes (bypasses page CORS via the extension's own `host_permissions`,
   not the page's), decodes via `createImageBitmap` on an `OffscreenCanvas`,
   and computes a 64-bit **dHash** (gradient hash — robust to resize/
   recompression/format changes) plus a coarse 4×4 average-color grid as a
   corroborating signal.
3. **Backend resolution** (`server/index.js` `POST /api/resolve`) —
   candidates are found via LSH banding (`server/fingerprint.js`: the 64-bit
   hash split into four 16-bit bands, queried for exact band matches), then
   scored by combining Hamming distance + color-grid distance into a
   confidence score. Only merges into an existing asset if confidence ≥
   `MERGE_THRESHOLD` (0.8); otherwise a **new** canonical asset is created.
   The client never decides a merge on its own — it only supplies signals.

Architecture is explicitly built so level 3 can later be swapped for a real
embedding + vector-similarity search without changing `/api/resolve`'s
contract.

## 4. How two users resolve the same image

Both extensions independently compute the same (or very close) dHash for
the same underlying picture, regardless of URL/CDN/resolution/compression.
Both POST to `/api/resolve`. User B's fingerprint lands within Hamming
distance of the asset User A's fingerprint already created, so the backend
returns the same `assetId` to both. Both then join `subscribe {assetId}`
on the WebSocket relay and `GET` the same interaction history.

## 5. How the realtime backend works

`server/index.js` runs an Express REST API and a `ws` WebSocket server on
the same HTTP server, path `/ws`. Clients (content scripts) send
`{type:"subscribe", assetId}`; the server tracks `assetId -> Set<socket>`
rooms in memory. When `POST /api/assets/:assetId/interactions` persists a
new interaction to Firestore, it immediately broadcasts it to every socket
in that asset's room. No polling.

## 6. How normalized coordinates work

`overlay.js` computes `x = (clickX - imgRect.left) / imgRect.width`, same
for `y` — always 0..1 regardless of the viewer's rendered image size.
Storage and network transport only ever carry these normalized values.
When rendering, `repositionMarkers()` multiplies back by the *current*
`getBoundingClientRect()` of the viewer's own `<img>`, so a 1920×1080
viewer and an 800×450 viewer both show the marker at the same relative
spot.

## 7. How cross-origin images are handled

Fingerprinting happens in `background.js` (a privileged extension context),
not in the page's content script. With `host_permissions` covering
`https://*/*` and `http://*/*`, the extension's own `fetch()` calls bypass
the *page's* CORS policy — this is standard MV3 behavior for a call
originating from the extension itself, not something that reads the page's
cross-origin `<img>` pixels directly (which would be blocked). If a fetch
fails (hotlink protection, non-image response, oversized file, timeout),
`identity.js` degrades gracefully to normalized-URL-only resolution rather
than throwing — the page is never broken by an unidentifiable image.

## 8. How the extension avoids performance problems

- `image-detector.js`: minimum-dimension filter (48×48), `IntersectionObserver`
  with a 200px root margin (start slightly before fully visible), so
  off-screen images are never touched.
- Per-image identification is deduped (`identifying` WeakSet in `content.js`)
  and results are cached client-side for 24h (`CACHE_TTL_MS` in
  `identity.js`) keyed by resolved URL, so repeat visits/rescans don't
  re-fetch or re-hash.
- WebSocket subscriptions are opened **only** for assets currently visible
  in viewport (`onVisibilityChange` in `content.js`), and the socket itself
  is torn down entirely once no asset needs it (`realtime-client.js`).
- The marker overlay is `pointer-events:none` at the container level, so it
  never intercepts clicks/scroll on the host page — only the small "+" pin
  and individual markers are interactive.

## 9. Commands to run everything

```bash
# Backend
cd server
cp .env.example .env   # fill in Firebase creds
npm install
npm start              # listens on :8787 by default

# Extension
# 1. Edit extension/modules/config.js:
#      BACKEND_BASE_URL = "http://localhost:8787"
#      REALTIME_WS_URL  = "ws://localhost:8787/ws"
# 2. chrome://extensions -> enable Developer Mode -> "Load unpacked" -> select extension/
```

## 10. Testing with two Chrome profiles

1. Deploy or run the backend somewhere both profiles can reach it (for a
   same-machine test, `localhost:8787` works for both).
2. Load the extension in two separate Chrome profiles (or one normal +
   one Guest/incognito-equivalent profile — use `chrome://version` to
   confirm they're different profiles).
3. **Profile A**: open any page with an image ≥48×48px. Hover it — a small
   "+" pin appears top-right. Click it, then click a spot on the image to
   drop a marker.
4. **Profile B**: open a *different* page containing the same picture
   (different URL/CDN/size is the point — e.g. the original vs. a resized
   thumbnail). Within a couple seconds the marker should appear at the
   corresponding relative position, pushed live over the WebSocket if B's
   tab was already open and viewing it, or loaded via the initial
   `GET /api/assets/:assetId/interactions` if B opens the page after A's
   click.
5. Repeat with two visually-different images to confirm markers do **not**
   cross over.
6. Resize the browser window / zoom the page — the marker should stay
   pinned to the same relative spot on the image.
7. Scroll the marked image off-screen and back — the WebSocket
   subscription should drop and reconnect (visible in the backend's
   in-memory room membership if you add a log line, or just confirm new
   markers from the other profile still arrive after scrolling back).

## Known MVP limitations (by design, not bugs)

- CSS `background-image` detection isn't implemented yet — `<img>` only.
  `image-detector.js` is structured so a background-image scanner can be
  added as a second candidate source without touching the identity/overlay
  layers.
- The interaction UI only creates `point`/`reaction`-style markers.
  `comment`/`drawing`/etc. are accepted by the backend's data model and
  validation but have no authoring UI yet.
- WebSocket room membership is in-process memory — fine for a single
  server instance; horizontal scaling would need a pub/sub layer (Redis,
  etc.) shared across instances.
