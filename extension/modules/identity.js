// ---- Serverless Identity & Direct Fingerprinting Layer ----

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 15 * 1024 * 1024;

// ONLY strip analytics/tracking parameters — NEVER strip identifying parameters like q, id, tbn, v, sig!
// (This rule holds for *generic* hosts. Known signed-CDN hosts get a separate,
// more aggressive path below — see SIGNED_CDN_HOSTS.)
const TRACKING_PARAM_PATTERNS = [
  /^utm_/i,
  /^_ga$/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_cid$/i,
  /^mc_eid$/i,
  /^ref$/i,
  /^source$/i,
];

// Hosts known to serve the SAME underlying image with per-viewer/per-session
// signed query params (expiry tokens, signatures, viewer-scoped auth) that
// differ across accounts even though the image is identical. On LinkedIn
// specifically this is why cross-account binding lookups fail: two accounts
// looking at the same post photo get URLs like
//   media.licdn.com/dms/image/<mediaId>/<rendition>/0/<ts>?e=...&v=beta&t=...
// where e/v/t are signed and viewer-scoped. For these hosts we strip the
// ENTIRE query string rather than a denylist of tracking params, because the
// query string on these CDNs carries no image-identity information at all.
const SIGNED_CDN_HOSTS = [
  /(^|\.)licdn\.com$/i, // LinkedIn media CDN
  /(^|\.)fbcdn\.net$/i, // Facebook/Instagram
  /(^|\.)cdninstagram\.com$/i,
  /(^|\.)twimg\.com$/i, // Twitter/X
  /(^|\.)pinimg\.com$/i, // Pinterest
  /(^|\.)redditmedia\.com$/i,
  /(^|\.)redd\.it$/i,
];

function isSignedCdnHost(hostname) {
  return SIGNED_CDN_HOSTS.some((re) => re.test(hostname));
}

// LinkedIn serves multiple *renditions* of the same underlying media asset
// (thumbnail, feedshare-shrink_800, feedshare-shrink_1280, original, ...).
// The rendition segment differs by viewport/feed context per viewer, but the
// media ID earlier in the path (e.g. D4E22AQ...) is stable and shared across
// renditions of the same asset. Collapsing the rendition + trailing
// timestamp segment lets different renditions of the same image normalize
// to the same URL, independent of the perceptual-hash pipeline.
function normalizeLinkedInPath(pathname) {
  const match = pathname.match(/\/dms\/image\/(?:v\d+\/)?([A-Za-z0-9_-]+)/i);
  if (match && match[1]) {
    return `/dms/image/${match[1]}`;
  }
  return pathname.replace(
    /\/(?:feedshare-shrink_\d+|profile-displayphoto-shrink_\d+|article-cover_image-shrink_\d+|shrink_\d+|original)(?:\/.*)?$/i,
    "/_rendition_",
  );
}

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "data:" || u.protocol === "blob:") {
      return `${u.protocol}hash:${cyrb53(rawUrl)}`;
    }
    u.hostname = u.hostname.toLowerCase();

    if (isSignedCdnHost(u.hostname)) {
      // These CDNs put viewer/session-scoped signed tokens in the query
      // string — none of it identifies the image, so drop it entirely
      // instead of trying to guess which params are "safe".
      u.search = "";
      if (/(^|\.)licdn\.com$/i.test(u.hostname)) {
        u.pathname = normalizeLinkedInPath(u.pathname);
      }
    } else {
      const params = Array.from(u.searchParams.keys());
      for (const key of params) {
        if (TRACKING_PARAM_PATTERNS.some((re) => re.test(key)))
          u.searchParams.delete(key);
      }
    }
    u.hash = "";
    return u.toString();
  } catch (e) {
    return rawUrl;
  }
}

function cacheKey(url) {
  return `assetCache:${cyrb53(url)}`;
}

async function readCache(url) {
  const key = cacheKey(url);
  const res = await chrome.storage.local.get(key);
  const entry = res[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry;
}

async function writeCache(url, entry) {
  const key = cacheKey(url);
  await chrome.storage.local.set({ [key]: { ...entry, ts: Date.now() } });
}

// 64-bit Hamming distance between two 16-character hex strings
function hammingDistance64(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== 16 || hexB.length !== 16) return 64;
  let dist = 0;
  for (let i = 0; i < 16; i++) {
    const a = parseInt(hexA[i], 16);
    const b = parseInt(hexB[i], 16);
    let x = a ^ b;
    while (x > 0) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

// Manhattan distance between two 16-hex color grid strings
function colorGridDistance(colorA, colorB) {
  if (!colorA || !colorB || colorA.length !== 16 || colorB.length !== 16)
    return 64;
  let totalDiff = 0;
  for (let i = 0; i < 16; i++) {
    const a = parseInt(colorA[i], 16);
    const b = parseInt(colorB[i], 16);
    totalDiff += Math.abs(a - b);
  }
  return totalDiff;
}

// Two visual fingerprints match if aspect ratio is close AND the dHash/color
// distances fall within a tiered tolerance. A flat 1-bit dHash tolerance was
// too strict in practice: CDNs (LinkedIn included) commonly re-encode/
// re-compress different renditions of the same source image, which shifts
// a handful of dHash gradient bits and previously caused genuine matches to
// be rejected as different assets. The tiers below trade structural
// tolerance against color-palette tolerance instead of using one fixed
// cutoff, which keeps false positives low while accepting real-world
// recompression noise:
//   - dHash 0            -> always a match (byte-identical structure)
//   - dHash 1-2 bits      -> match if color grid is reasonably close (<=12)
//   - dHash 3-5 bits      -> match only if color grid is tight (<=6)
//   - dHash 6-8 bits      -> match only if color grid is near-identical (<=3)
//   - dHash > 8 bits      -> never a match, regardless of color
function isVisualMatch(hexA, hexB) {
  if (!hexA || !hexB) return false;
  if (hexA === hexB) return true;

  const partsA = hexA.split("_");
  const partsB = hexB.split("_");
  const dhashA = partsA[0];
  const dhashB = partsB[0];
  const colorA = partsA[1] || "";
  const colorB = partsB[1] || "";
  const arA = partsA[2] ? parseInt(partsA[2], 10) : null;
  const arB = partsB[2] ? parseInt(partsB[2], 10) : null;

  // 1. Aspect Ratio Guard: If both have AR tags and differ, reject immediately
  if (arA !== null && arB !== null && Math.abs(arA - arB) > 1) {
    return false;
  }

  const dDist = hammingDistance64(dhashA, dhashB);
  if (dDist === 0) return true;
  if (dDist > 8) return false;

  const haveColor = !!(colorA && colorB);
  const cDist = haveColor ? colorGridDistance(colorA, colorB) : null;

  if (dDist <= 2) {
    // Near-identical structure — allow moderate color drift (JPEG recompression).
    return !haveColor || cDist <= 12;
  }
  if (dDist <= 5) {
    // Noticeable structural drift — require a tight color match to compensate.
    return haveColor && cDist <= 6;
  }
  // 6-8 bit structural drift — only accept with a near-identical palette.
  return haveColor && cDist <= 3;
}

async function fetchImageBitmap(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      cache: "force-cache",
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_FETCH_BYTES || blob.size < 100) return null;
    return await createImageBitmap(blob);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Composite 128-bit Perceptual Hash (64-bit dHash gradient + 64-bit 4x4 Color Grid + Aspect Ratio Tag)
function computeCompositeHash(bitmap) {
  if (!bitmap || bitmap.width < 16 || bitmap.height < 16) return null;
  const w = 9,
    h = 8;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);

  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g =
      0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    gray[i] = g;
    sum += g;
  }

  // Calculate visual entropy / standard deviation
  const mean = sum / (w * h);
  let varianceSum = 0;
  for (let i = 0; i < w * h; i++) {
    const diff = gray[i] - mean;
    varianceSum += diff * diff;
  }
  const stdDev = Math.sqrt(varianceSum / (w * h));

  // Reject flat/solid color images, blank transparent spaces, and degenerate placeholders
  if (stdDev < 4.5) {
    return null;
  }

  // 1. 64-bit gradient dHash
  let bits = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray[y * w + x] < gray[y * w + x + 1] ? "1" : "0";
    }
  }
  let dhashHex = "";
  for (let i = 0; i < 64; i += 4)
    dhashHex += parseInt(bits.slice(i, i + 4), 2).toString(16);

  // 2. 4x4 Color Grid (16 quantized luminance/color cells)
  const colorCanvas = new OffscreenCanvas(4, 4);
  const colorCtx = colorCanvas.getContext("2d", { willReadFrequently: true });
  colorCtx.drawImage(bitmap, 0, 0, 4, 4);
  const colorData = colorCtx.getImageData(0, 0, 4, 4).data;
  let colorHex = "";
  for (let i = 0; i < 16; i++) {
    const r = colorData[i * 4];
    const g = colorData[i * 4 + 1];
    const b = colorData[i * 4 + 2];
    const lum = Math.round((0.299 * r + 0.587 * g + 0.114 * b) / 16);
    colorHex += Math.min(15, Math.max(0, lum)).toString(16);
  }

  // 3. Aspect ratio quantized to integer (e.g. width/height * 10)
  const arTag = Math.round((bitmap.width / bitmap.height) * 10);

  return `${dhashHex}_${colorHex}_${arTag}`;
}

async function identifyAsset(rawUrl, directCompositeHash) {
  // 1. Check for platform-specific immutable media IDs (e.g. LinkedIn, Twitter, Reddit)
  const platformId = extractPlatformAssetId(rawUrl);
  if (platformId) {
    return { ok: true, assetId: platformId };
  }

  if (directCompositeHash) {
    return { ok: true, assetId: `visual_${directCompositeHash}` };
  }
  if (!rawUrl) return { ok: false };
  const normalizedUrl = normalizeUrl(rawUrl);

  const cached = await readCache(normalizedUrl);
  if (cached) return { ok: true, assetId: cached.assetId };

  let assetId = null;
  const bitmap = await fetchImageBitmap(rawUrl);
  if (bitmap) {
    try {
      const comp = computeCompositeHash(bitmap);
      if (comp) {
        assetId = `visual_${comp}`;
      }
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // Reject placeholders & spacers from generic sharing
  if (!assetId) {
    if (rawUrl.startsWith("data:") && rawUrl.length < 1024) {
      return { ok: false, isPlaceholder: true };
    }
    // High-entropy normalized URL hash. Thanks to the CDN-aware
    // normalization above, this now degrades gracefully on LinkedIn/other
    // signed CDNs instead of baking a per-viewer signed token into the
    // fallback ID.
    assetId = `url_${cyrb53(normalizedUrl)}`;
  }

  await writeCache(normalizedUrl, { assetId });
  return { ok: true, assetId };
}
