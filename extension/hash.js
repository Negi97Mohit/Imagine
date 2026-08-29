// Deterministic 53-bit string hash (cyrb53). Not cryptographic — just needs
// to turn an arbitrary image URL into a stable, Firestore-doc-id-safe key.
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function extractPlatformAssetId(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();

    // 1. LinkedIn Media CDN
    if (/(^|\.)licdn\.com$/i.test(host)) {
      const match = u.pathname.match(/\/dms\/image\/(?:v\d+\/)?([A-Za-z0-9_-]+)/i);
      if (match && match[1]) {
        return "platform_li_" + match[1];
      }
    }

    // 2. Twitter / X Media CDN
    if (/(^|\.)twimg\.com$/i.test(host)) {
      const match = u.pathname.match(/\/media\/([A-Za-z0-9_-]+)/i);
      if (match && match[1]) {
        return "platform_tw_" + match[1];
      }
    }

    // 3. Reddit Media CDN
    if (/(^|\.)redd\.it$/i.test(host) || /(^|\.)redditmedia\.com$/i.test(host)) {
      const match = u.pathname.match(/\/([A-Za-z0-9_-]+)\.(?:jpg|png|jpeg|webp|gif)/i);
      if (match && match[1]) {
        return "platform_rd_" + match[1];
      }
    }

    // 4. Instagram / Facebook CDN
    if (/(^|\.)fbcdn\.net$/i.test(host) || /(^|\.)cdninstagram\.com$/i.test(host)) {
      const match = u.pathname.match(/\/([0-9]+_[0-9]+_[0-9]+_[a-z0-9]+)\.(?:jpg|png|jpeg|webp)/i);
      if (match && match[1]) {
        return "platform_fb_" + match[1];
      }
    }
  } catch (e) {}
  return null;
}

