// ---- Serverless Identity & Direct Fingerprinting Layer ----

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const FETCH_TIMEOUT_MS = 8000;
const MAX_FETCH_BYTES = 15 * 1024 * 1024;

const STRIPPABLE_PARAM_PATTERNS = [
  /^utm_/i,
  /^(w|h|width|height|size|quality|q|fit|dpr|scale|format|fm|auto|cache|v|version|t|timestamp|_ts)$/i,
];

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === "data:" || u.protocol === "blob:") {
      return `${u.protocol}hash:${cyrb53(rawUrl)}`;
    }
    const params = Array.from(u.searchParams.keys());
    for (const key of params) {
      if (STRIPPABLE_PARAM_PATTERNS.some((re) => re.test(key))) u.searchParams.delete(key);
    }
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
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

async function fetchImageBitmap(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size > MAX_FETCH_BYTES) return null;
    return await createImageBitmap(blob);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 64-bit dHash perceptual fingerprint
function computeDHash(bitmap) {
  const w = 9, h = 8;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  let bits = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray[y * w + x] < gray[y * w + x + 1] ? "1" : "0";
    }
  }
  let hex = "";
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

async function identifyAsset(rawUrl) {
  if (!rawUrl) return { ok: false };
  const normalizedUrl = normalizeUrl(rawUrl);

  const cached = await readCache(normalizedUrl);
  if (cached) return { ok: true, assetId: cached.assetId };

  let assetId = null;
  const bitmap = await fetchImageBitmap(rawUrl);
  if (bitmap) {
    try {
      const dhash = computeDHash(bitmap);
      assetId = `visual_${dhash}`;
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // Fallback to normalized URL hash if image bytes cannot be fetched
  if (!assetId) {
    assetId = `url_${cyrb53(normalizedUrl)}`;
  }

  await writeCache(normalizedUrl, { assetId });
  return { ok: true, assetId };
}

