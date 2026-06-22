/**
 * StreamForge-Resolver — StreamForge fork that delegates all URL resolution
 * to url-resolver-v2 (port 7400). Caching, HLS proxy, circuit breakers,
 * and Playwright extraction are handled by the resolver, not this addon.
 *
 * Changes from StreamForge:
 *  - Stream endpoint calls url-resolver-v2 for every embed URL
 *  - Provider loading removed (delegated to resolver)
 *  - Batch resolve with concurrency via p-limit
 */
const express = require('express');
const cors    = require('cors');
const { destroyFSSession, fetchImage } = require('./lib/fetch');
const { loadSources }    = require('./lib/registry');
const { buildManifest }  = require('./manifest');
const { verifyUrl, isStreamLike, filterStreams } = require('./lib/verifier');

const app       = express();
const PORT      = process.env.PORT || 7100;
const ADDON_ID  = process.env.ADDON_ID || 'com.streamforge.resolver';
const ADDON_URL = (process.env.ADDON_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const RESOLVER  = (process.env.RESOLVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const PROXY_URL = (process.env.PROXY_URL || RESOLVER).replace(/\/$/, '');  // url-resolver-v2

// ─── Load sources (no providers — delegated to resolver) ──────────────────────
const baseDir = __dirname;
const sources = loadSources(baseDir);

function getSource(sourceId) {
  return sources.find(s => s.id === sourceId) || null;
}

function parseAddonId(fullId) {
  const stripped = fullId.replace(`${ADDON_ID}:`, '');
  const colon    = stripped.indexOf(':');
  if (colon === -1) return { sourceId: stripped, localId: '' };
  return { sourceId: stripped.slice(0, colon), localId: stripped.slice(colon + 1) };
}

function parseExtra(raw = '') {
  const extra = {};
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    extra[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return extra;
}

app.use(cors());

// ─── Manifest ─────────────────────────────────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  // Override addon ID in manifest
  const manifest = buildManifest(sources, ADDON_URL);
  manifest.id = ADDON_ID;
  res.json(manifest);
});

// ─── Catalog ─────────────────────────────────────────────────────────────────
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json', '/catalog/:type/:id/.json'], async (req, res) => {
  try {
    const fullId    = req.params.id.replace(/\.json$/, '');
    const sourceId  = fullId.split(':')[0];
    const catPart   = fullId.includes(':') ? fullId.split(':').slice(1).join(':') : 'all';
    const extra     = parseExtra(req.query.extra || req.params.extra || '');
    const skip      = parseInt(req.query.skip || extra.skip || '0', 10);
    const page      = Math.floor(skip / 20) + 1;
    const query     = extra.search || '';

    const source = getSource(sourceId);
    if (!source) return res.json({ metas: [] });

    console.log(`[Catalog] ${sourceId}:${catPart} skip=${skip} page=${page} genre=${extra.genre || '-'} type=${extra.type || '-'} search=${query || '-'}`);

    let items = [];
    let hasNextPage = false;
    if (catPart === 'search' || catPart === 'search-series') {
      if (!query) return res.json({ metas: [] });
      // Use the route type param to auto-select search filter
      // /catalog/movie/... → type=movies, /catalog/series/... → type=series
      const routeType = req.params.type || '';
      const searchFilter = extra.type || (routeType === 'movie' ? 'movies' : routeType === 'series' ? 'series' : catPart === 'search-series' ? 'series' : '');
      items = await source.module.search(query, {
        type: searchFilter,
        genre: extra.genre,
      });
    } else {
      // Cap pagination at 100 items total (page 5 with 20 per page)
      if (page > 5) return res.json({ metas: [] });
      const result = await source.module.getCatalog(catPart, page, {
        genre:    extra.genre,
        type:     extra.type,
        category: extra.category,
      });
      items = result.items || result;
      hasNextPage = result.hasNextPage ?? false;
    }

    const metas = items.map(item => {
      let poster = item.thumb || '';
      if (poster && source.module.PROXY_IMAGES) {
        poster = `${ADDON_URL}/img/${Buffer.from(poster).toString('base64url')}`;
      }
      return {
        id:          `${ADDON_ID}:${sourceId}:${item.id}`,
        type:        sourceId,
        name:        item.title,
        poster,
        posterShape: 'regular',
      };
    });

    console.log(`[Catalog] → ${metas.length} items`);
    res.json({ metas, hasNextPage });
  } catch (err) {
    console.error('[Catalog] Error:', err.message);
    res.json({ metas: [] });
  }
});

// ─── Meta ─────────────────────────────────────────────────────────────────────
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { sourceId, localId } = parseAddonId(req.params.id);
    console.log(`[Meta] ${sourceId}:${localId}`);

    const source = getSource(sourceId);
    if (!source) return res.json({ meta: null });

    console.log(`[Meta] getMeta ${localId} -> ${source.module.getMeta ? 'yes' : 'no'}`);
    if (!source.module.getMeta) return res.json({ meta: null });

    const data = await source.module.getMeta(localId);
    if (!data) return res.json({ meta: null });

    let poster = data.thumb || '';
    let background = data.thumb || '';
    if (source.module.PROXY_IMAGES) {
      if (poster) {
        poster = `${ADDON_URL}/img/${Buffer.from(poster).toString('base64url')}`;
      }
      if (background) {
        background = `${ADDON_URL}/img/${Buffer.from(background).toString('base64url')}`;
      }
    }

    const meta = {
      id:          `${ADDON_ID}:${sourceId}:${localId}`,
      type:        sourceId,
      name:        data.title || '',
      poster,
      background,
      description: data.description || undefined,
      genres:      data.genres || [],
    };

    if (data.episodeLinks?.length) {
      meta.videos = data.episodeLinks.map((ep, i) => ({
        id:       `${ADDON_ID}:${sourceId}:${ep.id}`,
        title:    ep.title || `Episode ${ep.epNum || i + 1}`,
        season:   ep.seasonNum || 1,
        episode:  ep.epNum || i + 1,
        released: new Date(2000, 0, i + 1).toISOString(),
      }));
    }

    res.json({ meta });
  } catch (err) {
    console.error('[Meta] Error:', err.message);
    res.json({ meta: null });
  }
});

// ─── Stream (returns proxy URLs — resolves on-demand when user clicks play) ────
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { sourceId, localId } = parseAddonId(req.params.id);
    console.log(`[Stream] ${sourceId}:${localId}`);

    const source = getSource(sourceId);
    if (!source) return res.json({ streams: [] });

    const rawStreams = await source.module.getStreams(localId);
    if (!rawStreams || rawStreams.length === 0) return res.json({ streams: [] });

    // Streams that need upfront resolution (multi-mirror providers)
    const multiMirrorProviders = ['megamax', 'share4max'];

    const streams = [];

    for (let i = 0; i < rawStreams.length; i++) {
      const s = rawStreams[i];
      const label = s.label || `Source ${i + 1}`;
      const base = {
        name: source.meta.name,
        title: label,
        ...(s.subtitles?.length ? { subtitles: s.subtitles } : {}),
      };

      // Embed-only or no provider → externalUrl (opens in browser)
      if (!s.providerId || s.isEmbed) {
        streams.push({ ...base, externalUrl: s.url });
        continue;
      }

      // Multi-mirror provider: use /extract to get all mirrors with proxy URLs
      if (multiMirrorProviders.includes(s.providerId)) {
        console.log(`[Stream] Expanding ${s.providerId}: ${s.url.substring(0,60)}`);
        try {
          const enc = Buffer.from(s.url).toString('base64');
          const resp = await require('axios').get(
            `${RESOLVER}/extract`,
            { params: { url: enc }, timeout: 60000 }
          );
          const candidates = resp.data?.candidates || [];
          if (candidates.length > 0) {
            console.log(`[Stream] → ${candidates.length} mirrors from ${s.providerId}`);
            for (const c of candidates) {
              const mirrorName = c.source.split('/').pop() || 'mirror';
              streams.push({
                ...base,
                title: `${label} — ${mirrorName}`,
                url: c.proxyUrl,
                behaviorHints: { notWebReady: false },
              });
            }
            continue;
          }
          console.log(`[Stream] ${s.providerId} returned empty candidates`);
        } catch (err) {
          console.log(`[Stream] ${s.providerId} /extract failed: ${err.message}`);
        }
      }

      // Pick method based on provider type
      const knownProviders = ['mp4upload','dailymotion','okru','videa','larhu',
        'rubyvidhub','voe','uqload','dsvplay','streamwish','krakenfiles',
          'lulustream','doodstream','mixdrop','mega'];
      
        let method;
        if (!knownProviders.includes(s.providerId)) {
          method = 'auto';
      } else {
        method = 'auto';  // proxy/auto calls resolve() with retries
      }

      // On-demand proxy URL — resolve via /resolve first to get raw CDN URL
      try {
        console.log(`[Stream] Resolving ${s.providerId}: ${s.url.substring(0,60)}`);
        const resolveResp = await require('axios').get(
          `${RESOLVER}/resolve`,
          { params: { url: s.url }, timeout: 45000 }
        );
        const resolveData = resolveResp.data?.data || {};
        if (resolveData.success && resolveData.results?.length > 0) {
          const rawCdnUrl = resolveData.results[0].url;
          console.log(`[Stream] → resolved: ${rawCdnUrl.substring(0, 80)}`);
          streams.push({
            ...base,
            url: `${PROXY_URL}/proxy?url=${encodeURIComponent(rawCdnUrl)}`,
            behaviorHints: { notWebReady: false },
          });
        } else {
          console.log(`[Stream] ${s.providerId} resolve returned empty`);
        }
      } catch (err) {
        console.log(`[Stream] ${s.providerId} resolve failed: ${err.message}`);
      }
    }

    console.log(`[Stream] → ${streams.length} streams (${streams.filter(s => s.url).length} proxied)`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream] Error:', err.message);
    res.json({ streams: [] });
  }
});

// ─── Proxy (forwards to url-resolver-v2 for on-demand stream resolution) ─────
app.get('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const method    = req.query.method || 'auto';
  const isCompanionMode = req.query.stremio === 'true' || req.query.video_error === 'true';
  if (!targetUrl) {
    if (isCompanionMode) return res.redirect('/proxy/error.m3u8?msg=' + encodeURIComponent('Missing ?url= parameter'));
    return res.status(400).send('Missing ?url=');
  }
  // Forward to url-resolver-v2's proxy endpoint
  const proxyUrl = `${RESOLVER}/proxy?url=${encodeURIComponent(targetUrl)}&method=${method}`;
  try {
    const resp = await require('axios').get(proxyUrl, {
      responseType: 'stream',
      timeout: 60000,
      validateStatus: () => true,
    });
    if (resp.status >= 400 && isCompanionMode) {
      if (resp.data) { try { resp.data.destroy(); } catch (_) {} }
      return res.redirect('/proxy/error.m3u8?msg=' + encodeURIComponent(`Upstream returned ${resp.status}`));
    }
    res.status(resp.status);
    for (const [k, v] of Object.entries(resp.headers)) {
      if (k !== 'transfer-encoding') res.set(k, v);
    }
    resp.data.pipe(res);
  } catch (err) {
    if (isCompanionMode) {
      return res.redirect('/proxy/error.m3u8?msg=' + encodeURIComponent(`Proxy error: ${err.message}`));
    }
    res.status(502).send(`Proxy error: ${err.message}`);
  }
});

// ─── Companion mode error video generator ─────────────────────────────────────
const ERROR_TS_B64 =
  'R0AREABC8CUAAcEAAP8B/wAB/IAUSBIBBkZGbXBlZwlTZXJ2aWNlMDF3fEPK////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQAAQAACwDQABwQAAAAHwACqxBLL////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//0dQABAAArASAAHBAADhAPAAG+EA8AAVvU1W//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQAAMAdQAAB7DH4AAAAB4AAAgIAFIQAH2GEAAAABCfAAAAABZ0LACtoFBn58BEAAAAMAQAAAAwKDxImoAAAAAWj' +
  'OMsgAAAEGBf//d9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01Q' +
  'RUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFHAQARbi5vcmcve' +
  'DI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MCByZWY9MSBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgxOjB4MTExIG' +
  '1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTAgbWVfcmFuZ2U9MTYgY2hyb21' +
  'hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLEcBABIxMSBmYXN0X3Bza2lwPTEgY2hy' +
  'b21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTYgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5y' +
  'PTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZy' +
  'YW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ95SBrZXlpbnRfRwEAE21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJl' +
  'c2g9MCByY19sb29rYWhlYWQ9NSByYz1hYnIgbWJ0cmVlPTEgYml0cmF0ZT0xMCByYXRldG9sPTEuMCBxY29tcD0w' +
  'LjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAWWIhHyYoAAi' +
  'SycnJycnJycnJycnJycnJycnJycnJydddddHAQA0FAD/////////////////////////XXXXXXXXXXXXXXXXXXXXXXXX' +
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' +
  'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' +
  'gEdAABEAALANAAHBAAAAAfAAKrEEsv////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HUAARAACwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQA1mRAAAJ40fgD////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////wAAAeAAAICABSEACWUBAAAAAQnwAAAA' +
  'AUGaIfAeMEdAABIAALANAAHBAAAAAfAAKrEEsv////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HUAASAACwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQA2mRAAAMFcfgD////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////wAAAeAAAICABSEACfGhAAAAAQnwAAAA' +
  'AUGaQLwHjEdAEREAQvAlAAHBAAD/Af8AAfyAFEgSAQZGRm1wZWcJU2VydmljZTAxd3xDyv//////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQAAEwAAsA0AAcEAAAAB8AAqsQSy////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HUAATAAKwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQA3mRAAAA5IR+AP////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////AAAB4AAAgIAFIQALfkEAAAABCfAAAAAB' +
  'QZpg/AeMR0AAFAAAsA0AAcEAAAAB8AAqsQSy////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HUAAUAAKwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQA4mRAAABB6x+AP////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////AAAB4AAAgIAFIQANCuEAAAABCfAAAAAB' +
  'QZqATwHjR0AAFQAAsA0AAcEAAAAB8AAqsQSy////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HUAAVAAKwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HQQA5HUAABKtR+AAAAAeAAAICABSEADZeBAAAAAQnwAAAAAWdCwAraBQZ+fARAAAADAEAAAAMCg8SJqAAAAAFoz' +
  'jLIAAABZYiCBfJigACO/JycnJycnJycnJycnJycnJycnJycnJ11111111111111111111111111111111111111111111' +
  '111111111111111111111111111111111111111111111111111111111111111111111111111RwEAOmoA////////////' +
  '////////////////////////////////////////////////////////////////////////////////' +
  '1111111111111111111111111111111111111111111111111111111111111111111111111111111111111111' +
  '11111111111111111111111111115HQBESAELwJQABwQAA/wH/AAH8gBRIEgEGRkZtcGVnCVNlcnZpY2UwMXd8Q8r/////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  '//9HAQAWAAAQDwAB8AAqsQSy////////////////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  'R1AAFgACsBIAAcEAAOEA8AAb4QDwABW9TVb/////////////////////////////////////////////////////////' +
  '///////////////////////////////////////////////////////////////////////////////////////////' +
  'f0dBADuZEAABTfx+AP//////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////8AAAeAAAICABSEADyQhAAAAAQnwAAAAAUGa' +
  'I8B4wEdAABcAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  'R1AAFwACsBIAAcEAAOEA8AAb4QDwABW9TVb/////////////////////////////////////////////////////////' +
  '///////////////////////////////////////////////////////////////////////////////////////////' +
  'f0dBADyZEAABcSkfgD//////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////8AAAeAAAICABSEAD7DBAAAAAQnwAAAAAUGa' +
  'QXAeMEdAABgAALANAAHBAAAAAfAAKrEEsv//////////////////////////////////////////////////////////' +
  '////////////////////////////////////////////////////////////////////////////////////////////' +
  'R1AAGAACsBIAAcEAAOEA8AAb4QDwABW9TVb/////////////////////////////////////////////////////////' +
  '///////////////////////////////////////////////////////////////////////////////////////////' +
  'f0dBAD1mRAAAZRMfgD//////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////8AAAeAAAICABSEAET1hAAAAAQnwAAAAAUGa' +
  'YLwHjEdAERMAQvAlAAHBAAD/Af8AAfyAFEgSAQZGRm1wZWcJU2VydmljZTAxd3xDyv//////////////////////////' +
  '//////////////////////////////////////////////////////////////////////////////////9HQAAZ' +
  'AAsA0AAcEAAAAB8AAqsQSy//////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////////////////////////////////9H' +
  'UAAZAAKwEgABwQAA4QDwABvhAPAAFb1NVv//////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////////////////////////////////////////' +
  '9HQQA+mRAAB3d0fgD//////////////////////////////////////////////////////////////////////////' +
  '//////////////////////////////////////////////////////AAAB4AAAgIAFIQARygEAAAABCfAAAAABQZ' +
  'qA/AeM=';

app.get('/proxy/error.m3u8', (req, res) => {
  const msg = req.query.msg || 'Unknown error';
  const encodedMsg = encodeURIComponent(msg);
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Error",DEFAULT=YES,LANGUAGE="en",URI="error_subtitle.vtt?msg=${encodedMsg}"
#EXT-X-STREAM-INF:BANDWIDTH=800000,SUBTITLES="subs"
error_video.m3u8`);
});

app.get('/proxy/error_video.m3u8', (req, res) => {
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.0,
error_video.ts
#EXT-X-ENDLIST`);
});

app.get('/proxy/error_video.ts', (req, res) => {
  const buf = Buffer.from(ERROR_TS_B64, 'base64');
  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

app.get('/proxy/error_subtitle.vtt', (req, res) => {
  const msg = req.query.msg || 'Unknown error';
  res.setHeader('Content-Type', 'text/vtt');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(`WEBVTT

00:00:00.000 --> 00:00:10.000
${msg}`);
});

// ─── Stream URL verification endpoints ────────────────────────────────────────

/**
 * GET /verify?url=<encoded>
 *
 * Verify a single stream URL — checks content-type, WEBVTT, M3U8 validity, etc.
 * Accepts: base64-encoded URL, plain URL, or URL-encoded URL.
 */
app.get('/verify', async (req, res) => {
  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  // Decode URL (base64 or raw)
  let targetUrl = rawUrl;
  try {
    const decoded = Buffer.from(rawUrl, 'base64').toString('utf8');
    if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
      targetUrl = decoded;
    }
  } catch (_) {}

  const referer = req.query.referer || '';
  console.log(`[Verify] ${targetUrl.slice(0, 100)}`);

  const result = await verifyUrl(targetUrl, referer);
  res.json(result);
});

/**
 * GET /filter?urls=<encoded>
 *
 * Filter multiple stream URLs (newline-separated, base64-encoded).
 * Returns only verified playable streams.
 */
app.get('/filter', async (req, res) => {
  const rawUrls = req.query.urls;
  if (!rawUrls) return res.status(400).json({ error: 'Missing ?urls= parameter' });

  let urls = [];
  try {
    const decoded = Buffer.from(rawUrls, 'base64').toString('utf8');
    urls = decoded.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
  } catch (_) {
    return res.status(400).json({ error: 'Invalid urls encoding' });
  }

  if (urls.length === 0) return res.json({ playable: [], rejected: [], all: [] });

  const referer = req.query.referer || '';
  console.log(`[Filter] Verifying ${urls.length} URLs...`);

  const result = await filterStreams(urls, referer);
  res.json({
    total: urls.length,
    playableCount: result.playable.length,
    rejectedCount: result.rejected.length,
    playable: result.playable.map(r => ({ url: r.url, type: r.type, contentType: r.contentType })),
    rejected: result.rejected.map(r => ({ url: r.url, error: r.error })),
    all: result.all,
  });
});

// ─── Image proxy ──────────────────────────────────────────────────────────────
app.get('/img/:encoded', async (req, res) => {
  try {
    if (!req.params.encoded || !/^[a-zA-Z0-9_-]+$/.test(req.params.encoded)) {
      return res.status(400).send('Invalid encoding');
    }
    let imageUrl;
    try { 
      imageUrl = Buffer.from(req.params.encoded, 'base64url').toString('utf8'); 
    } catch { 
      return res.status(400).send('Invalid encoding'); 
    }

    if (!imageUrl || (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://'))) {
      return res.status(400).send('Invalid image URL');
    }

    const result = await fetchImage(imageUrl);
    if (!result) return res.status(502).send('Image fetch failed');

    res.set('Content-Type', result.contentType || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(result.data);
  } catch (err) {
    res.status(500).send('Image proxy error');
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🔗 StreamForge-Resolver: http://0.0.0.0:${PORT}`);
  console.log(`   ${sources.length} sources loaded`);
  console.log(`   Delegating URL resolution to: ${RESOLVER}`);
});
