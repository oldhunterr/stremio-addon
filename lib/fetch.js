/**
 * fetch.js — Unified HTTP fetcher for StreamForge
 *
 * Each source can declare a needsFlareSolverr flag.
 * fetchPage() picks the right strategy automatically.
 *
 * For FS sites:  POST to FlareSolverr, reuse session + cookies
 * For plain sites: plain axios with browser-like headers
 */

const axios     = require('axios');
const NodeCache = require('node-cache');

const pageCache = new NodeCache({ stdTTL: 300 });   // 5 min
const imgCache  = new NodeCache({ stdTTL: 3600 });  // 1 hr

const FLARESOLVERR = process.env.FLARESOLVERR_URL || 'http://192.168.100.150:8191/v1';

// ─── Plain axios client (for non-CF sites) ────────────────────────────────────
const plainClient = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
  },
});

// ─── FlareSolverr session ─────────────────────────────────────────────────────
let fsSessionId      = null;
let fsSessionPromise = null;
let fsCookies        = [];
let fsUserAgent      = null;
const destroyedSessions = new Set();

async function getFSSession() {
  if (fsSessionId) return fsSessionId;
  if (fsSessionPromise) return fsSessionPromise;

  fsSessionPromise = (async () => {
    try {
      console.log('[FS] Checking active sessions from FlareSolverr...');
      const listRes = await axios.post(FLARESOLVERR, { cmd: 'sessions.list' }, { timeout: 10000 });
      const activeSessions = (listRes.data?.sessions || []).filter(id => !destroyedSessions.has(id));
      if (activeSessions.length > 0) {
        fsSessionId = activeSessions[0];
        console.log(`[FS] Reusing active FlareSolverr session: ${fsSessionId}`);
        return fsSessionId;
      }
    } catch (listErr) {
      console.warn(`[FS] Failed to list existing sessions: ${listErr.message}`);
    }

    console.log('[FS] No active sessions found. Creating session...');
    const res = await axios.post(FLARESOLVERR, { cmd: 'sessions.create' }, { timeout: 15000 });
    fsSessionId = res.data.session;
    console.log(`[FS] Session ready: ${fsSessionId}`);
    return fsSessionId;
  })();

  try {
    return await fsSessionPromise;
  } finally {
    fsSessionPromise = null;
  }
}

async function destroyFSSession() {
  if (!fsSessionId) return;
  const toDestroy = fsSessionId;
  
  // Mark as destroyed immediately to prevent reuse
  fsSessionId = null;
  fsCookies   = [];
  fsUserAgent = null;
  fsSessionPromise = null;
  
  destroyedSessions.add(toDestroy);
  if (destroyedSessions.size > 50) {
    const first = destroyedSessions.values().next().value;
    destroyedSessions.delete(first);
  }

  try {
    await axios.post(FLARESOLVERR, { cmd: 'sessions.destroy', session: toDestroy }, { timeout: 5000 });
    console.log(`[FS] Session destroyed: ${toDestroy}`);
  } catch (_) {}
}

// ─── Cache helpers ────────────────────────────────────────────────────────────
function isCacheable(url) {
  const u = url.toLowerCase();
  return !u.includes('?key=') && !(u.includes('/watch/') && u.includes('?'));
}

// ─── FlareSolverr fetch ───────────────────────────────────────────────────────
async function fetchViaFS(url, opts = {}) {
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    try {
      const sessionId = await getFSSession();
      const res = await axios.post(FLARESOLVERR, {
        cmd:        'request.get',
        url,
        session:    sessionId,
        maxTimeout: 120000,
      }, { timeout: 130000 });

      const sol  = res.data?.solution;
      const html = sol?.response;
      if (!html) throw new Error('Empty FlareSolverr response');

      const isCF = html.includes('Just a moment') || html.includes('cf-spinner') || html.includes('challenge-running');
      if (isCF) {
        console.warn(`[FS] CF challenge not solved (attempt ${attempt})`);
        await destroyFSSession();
        if (attempt < 2) continue;
        return null;
      }

      if (sol.cookies?.length) {
        fsCookies = sol.cookies;
      }
      if (sol.userAgent) {
        fsUserAgent = sol.userAgent;
      }

      return html;
    } catch (err) {
      console.error(`[FS] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 2) await destroyFSSession();
    }
  }
  return null;
}

// ─── Plain fetch ──────────────────────────────────────────────────────────────
async function fetchViaAxios(url, referer) {
  try {
    const res = await plainClient.get(url, {
      headers: { Referer: referer ? encodeURI(referer) : undefined },
      maxRedirects: 5,
    });
    return res.data;
  } catch (err) {
    console.error(`[Fetch] axios failed for ${url}: ${err.message}`);
    return null;
  }
}

// ─── Main fetchPage ───────────────────────────────────────────────────────────
/**
 * @param {string}  url
 * @param {string}  referer
 * @param {object}  opts
 * @param {boolean} opts.noCache       - skip cache (for stream pages)
 * @param {boolean} opts.useFS         - force FlareSolverr regardless of source flag
 */
async function fetchPage(url, referer = 'https://www.google.com/', opts = {}) {
  const useCache = !opts.noCache && isCacheable(url);

  if (useCache) {
    const hit = pageCache.get(url);
    if (hit) {
      console.log(`[Cache] HIT ${url}`);
      return hit;
    }
  }

  console.log(`[Fetch] ${opts.useFS ? 'FS' : 'plain'} GET ${url}`);

  const html = opts.useFS
    ? await fetchViaFS(url, opts)
    : await fetchViaAxios(url, referer);

  if (html) {
    console.log(`[Fetch] OK ${url} (${html.length} bytes)`);
    if (useCache) pageCache.set(url, html);
  } else {
    console.error(`[Fetch] FAILED ${url}`);
  }

  return html;
}

// ─── Image proxy fetch ────────────────────────────────────────────────────────
async function fetchImage(imageUrl, siteBaseUrl) {
  const cached = imgCache.get(imageUrl);
  if (cached) return cached;

  // Resolve referer / origin
  let referer = siteBaseUrl;
  if (!referer && imageUrl) {
    try {
      referer = new URL(imageUrl).origin;
    } catch (_) {}
  }

  // 1. Pre-emptively solve challenge to populate cookies/UA if missing
  if (!fsCookies.length && referer) {
    console.log(`[ImgProxy] No session cookies found, performing challenge solve for ${referer}...`);
    try {
      await fetchPage(referer, undefined, { useFS: true, noCache: true });
    } catch (err) {
      console.warn(`[ImgProxy] Pre-emptive session solve failed: ${err.message}`);
    }
  }

  // 2. Attempt direct binary download using session UA and Cookies (Bypass FlareSolverr)
  try {
    const headers = {
      'User-Agent': fsUserAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    };
    if (referer) {
      headers['Referer'] = encodeURI(referer);
    }
    if (fsCookies.length) {
      headers['Cookie'] = fsCookies.map(c => `${c.name}=${c.value}`).join('; ');
    }

    console.log(`[ImgProxy] Direct GET ${imageUrl} (bypassing FS)`);
    const res = await axios.get(imageUrl, {
      headers,
      responseType: 'arraybuffer',
      timeout: 20000,
    });

    const result = {
      data: res.data, // Under Node, axios responseType 'arraybuffer' returns a Buffer
      contentType: res.headers['content-type'] || 'image/jpeg',
    };
    imgCache.set(imageUrl, result);
    return result;
  } catch (err) {
    console.warn(`[ImgProxy] Direct download failed: ${err.message}. Falling back to FlareSolverr...`);
  }

  // 3. Fallback: retrieve image via FlareSolverr request.get if direct fetch fails
  try {
    const sessionId = await getFSSession();
    const res = await axios.post(FLARESOLVERR, {
      cmd: 'request.get', url: imageUrl, session: sessionId, maxTimeout: 30000,
    }, { timeout: 40000 });

    const sol = res.data?.solution;
    if (sol?.cookies?.length) fsCookies = sol.cookies;
    if (sol?.userAgent) fsUserAgent = sol.userAgent;

    const b64 = sol?.response;
    if (b64) {
      const base64Data = b64.includes(',') ? b64.split(',')[1] : b64;
      const result = {
        data: Buffer.from(base64Data, 'base64'),
        contentType: sol?.headers?.['content-type'] || 'image/jpeg',
      };
      imgCache.set(imageUrl, result);
      return result;
    }
  } catch (err) {
    console.error(`[ImgProxy] FS fallback fetch failed: ${err.message}`);
  }

  return null;
}

// ─── ID helpers ───────────────────────────────────────────────────────────────
function makeId(fullUrl, baseUrl) {
  const relative = fullUrl.replace(baseUrl, '');
  return Buffer.from(relative).toString('base64url');
}

function idToUrl(encodedId, baseUrl) {
  if (!encodedId || !/^[a-zA-Z0-9_-]+$/.test(encodedId)) {
    return null;
  }
  try {
    const relative = Buffer.from(encodedId, 'base64url').toString('utf8');
    if (relative.startsWith('http')) return relative;
    return baseUrl + (relative.startsWith('/') ? '' : '/') + relative;
  } catch (_) {
    return null;
  }
}

function resolveUrl(href, baseUrl) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  if (href.startsWith('//'))   return 'https:' + href;
  return baseUrl + (href.startsWith('/') ? '' : '/') + href;
}

module.exports = { fetchPage, fetchImage, makeId, idToUrl, resolveUrl, destroyFSSession };
