/**
 * Scraper: AnimeLek
 * URL: https://animelek.top
 * CF: NO — plain HTTP
 *
 * Fetches catalog, search, meta, and stream data from AnimeLek.
 * Returns streams with provider IDs so the orchestrator can handle
 * provider-specific extraction/proxying.
 *
 * All streams are marked isEmbed: false — the orchestrator decides
 * the final routing based on providerId.
 */

const cheerio = require('cheerio');
const fs = require('fs');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

// ─── Provider Discovery Log ──────────────────────────────────────────────────
// Logs every provider/URL found across all episode checks for investigation.
const PROVLOG = '/tmp/animelek-providers.log';
let provLogSeen = new Set();
try {
  if (fs.existsSync(PROVLOG)) {
    const lines = fs.readFileSync(PROVLOG, 'utf-8').split('\n').filter(l => l);
    lines.forEach(l => { const m = l.match(/\t([^\t]+)\t/); if (m) provLogSeen.add(m[1]); });
  }
} catch (_) {}

function logProvider(episodeUrl, providerId, providerHost, fullUrl, serverName, quality) {
  const key = `${providerHost}|${fullUrl.substring(0, 60)}`;
  if (provLogSeen.has(key)) return;
  provLogSeen.add(key);
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `${now}\t${key}\t${providerId || 'UNKNOWN'}\t${serverName}\t${quality}\t${episodeUrl}\n`;
  try { fs.appendFileSync(PROVLOG, line); } catch (_) {}
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://animelek.top';

const SITE_ID            = 'animelek';
const SITE_NAME          = 'AnimeLek';
const SITE_LOGO          = `${BASE_URL}/favicon.ico`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = false;
const PROXY_STREAMS      = true;

const EXTRA_SUPPORTED = ['genre', 'type'];

const TYPES = [
  'TV',
  'فيلم',
  'OVA',
  'ONA',
  'Special',
];

const GENRES = [
  'أكشن','مغامرات','كوميدي','دراما','خيال علمي','سحر','رعب','رومانسي',
  'مدرسي','غموض','نفسي','خارق للعادة','قوى خارقة','شونين','سينين','شوجو',
  'جوسي','شريحة من الحياة','تاريخي','ساموراي','فنون قتالية','ميكا',
  'فضائي','رياضي','موسيقي','شياطين','مصاصي دماء','حريم','العاب',
  'اثارة','بوليسي','سيارات','إيتشي','شوجو آي','شونين اي','يوري','ياوي',
  'هنتاي','جنون','أطفال','محاكاة ساخرة',
];

const GENRE_SLUGS = {
  'أكشن':'%D8%A3%D9%83%D8%B4%D9%86','مغامرات':'%D9%85%D8%BA%D8%A7%D9%85%D8%B1%D8%A7%D8%AA',
  'كوميدي':'%D9%83%D9%88%D9%85%D9%8A%D8%AF%D9%8A','دراما':'%D8%AF%D8%B1%D8%A7%D9%85%D8%A7',
  'خيال علمي':'%D8%AE%D9%8A%D8%A7%D9%84-%D8%B9%D9%84%D9%85%D9%8A',
  'سحر':'%D8%B3%D8%AD%D8%B1','رعب':'%D8%B1%D8%B9%D8%A8',
  'رومانسي':'%D8%B1%D9%88%D9%85%D8%A7%D9%86%D8%B3%D9%8A',
  'مدرسي':'%D9%85%D8%AF%D8%B1%D8%B3%D9%8A','غموض':'%D8%BA%D9%85%D9%88%D8%B6',
  'نفسي':'%D9%86%D9%81%D8%B3%D9%8A','خارق للعادة':'%D8%AE%D8%A7%D8%B1%D9%82-%D9%84%D9%84%D8%B9%D8%A7%D8%AF%D8%A9',
  'قوى خارقة':'%D9%82%D9%88%D9%89-%D8%AE%D8%A7%D8%B1%D9%82%D8%A9',
  'شونين':'%D8%B4%D9%88%D9%86%D9%8A%D9%86','سينين':'%D8%B3%D9%8A%D9%86%D9%8A%D9%86',
  'شوجو':'%D8%B4%D9%88%D8%AC%D9%88','جوسي':'%D8%AC%D9%88%D8%B3%D9%8A',
  'شريحة من الحياة':'%D8%B4%D8%B1%D9%8A%D8%AD%D8%A9-%D9%85%D9%86-%D8%A7%D9%84%D8%AD%D9%8A%D8%A7%D8%A9',
  'تاريخي':'%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE%D9%8A','ساموراي':'%D8%B3%D8%A7%D9%85%D9%88%D8%B1%D8%A7%D9%8A',
  'فنون قتالية':'%D9%81%D9%86%D9%88%D9%86-%D9%82%D8%AA%D8%A7%D9%84%D9%8A%D8%A9',
  'ميكا':'%D9%85%D9%8A%D9%83%D8%A7','فضائي':'%D9%81%D8%B6%D8%A7%D8%A6%D9%8A',
  'رياضي':'%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A','موسيقي':'%D9%85%D9%88%D8%B3%D9%8A%D9%82%D9%8A',
  'شياطين':'%D8%B4%D9%8A%D8%A7%D8%B7%D9%8A%D9%86',
  'مصاصي دماء':'%D9%85%D8%B5%D8%A7%D8%B5%D9%8A-%D8%AF%D9%85%D8%A7%D8%A1',
  'حريم':'%D8%AD%D8%B1%D9%8A%D9%85','العاب':'%D8%A7%D9%84%D8%B9%D8%A7%D8%A8',
  'اثارة':'%D8%A7%D8%AB%D8%A7%D8%B1%D8%A9','بوليسي':'%D8%A8%D9%88%D9%84%D9%8A%D8%B3%D9%8A',
  'سيارات':'%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA',
  'إيتشي':'%D8%A5%D9%8A%D8%AA%D8%B4%D9%8A','شوجو آي':'%D8%B4%D9%88%D8%AC%D9%88-%D8%A2%D9%8A',
  'شونين اي':'%D8%B4%D9%88%D9%86%D9%8A%D9%86-%D8%A7%D9%8A',
  'يوري':'%D9%8A%D9%88%D8%B1%D9%8A','ياوي':'%D9%8A%D8%A7%D9%88%D9%8A',
  'هنتاي':'%D9%87%D9%86%D8%AA%D8%A7%D9%8A','جنون':'%D8%AC%D9%86%D9%88%D9%86',
  'أطفال':'%D8%A3%D8%B7%D9%81%D8%A7%D9%84',
  'محاكاة ساخرة':'%D9%85%D8%AD%D8%A7%D9%83%D8%A7%D8%A9-%D8%B3%D8%A7%D8%AE%D8%B1%D8%A9',
};

/** Catalog definitions used by getCatalog() */
const CATALOGS = [
  { id: 'all',      name: 'الكل',         url: `${BASE_URL}/%D9%82%D8%A7%D8%A6%D9%85%D8%A9-%D8%A7%D9%84%D8%A3%D9%86%D9%85%D9%8A/` },
  { id: 'film',     name: 'أفلام',         url: `${BASE_URL}/anime-type/%D9%81%D9%8A%D9%84%D9%85/` },
  { id: 'airing',   name: 'يعرض الآن',     url: `${BASE_URL}/anime-status/%D9%8A%D8%B9%D8%B1%D8%B6-%D8%A7%D9%84%D8%A7%D9%86/` },
];

/**
 * Maps embed URL hostnames to provider IDs.
 * These match the providers listed in meta.json.
 * The orchestrator uses providerId to select the appropriate
 * extraction or proxying strategy.
 */
const PROVIDER_MAP = {
  'mp4upload.com':       'mp4upload',
  'www.mp4upload.com':   'mp4upload',
  'dailymotion.com':     'dailymotion',
  'www.dailymotion.com': 'dailymotion',
  'ok.ru':               'okru',
  'www.ok.ru':           'okru',
  'videa.hu':            'videa',
  'www.videa.hu':        'videa',
  'larhu.website':       'larhu',
  'w.larhu.website':     'larhu',
  'rubyvidhub.com':      'rubyvidhub',
  'www.rubyvidhub.com':  'rubyvidhub',
  'streamruby.com':      'rubyvidhub',
  'voe.sx':              'voe',
  'www.voe.sx':          'voe',
  'juliewomanwish.com':  'voe',
  'share4max.com':       'megamax', // Inertia.js extractor
  'www.share4max.com':   'share4max',
  'uqload.is':           'uqload',
  'www.uqload.is':       'uqload',
  'uqload.io':           'uqload',
  'www.uqload.io':       'uqload',
  'dsvplay.com':         'dsvplay',
  'www.dsvplay.com':     'dsvplay',
  'playmogo.com':        'dsvplay',
  'mega.nz':             'mega',
  'www.mega.nz':         'mega',
  'megamax.me':          'megamax', // Inertia.js extractor
  'vidmoly.biz':         'vidmoly',
  'www.vidmoly.biz':     'vidmoly',
  'vidmoly.net':         'vidmoly',
  'www.vidmoly.net':     'vidmoly',
  'sendvid.com':         'sendvid',
  'www.sendvid.com':     'sendvid',
  'video.sibnet.ru':     'sibnet',
  'hgcloud.to':          'hgcloud',
  'turbovidhls.com':     'turbovidhls',
  'leech.megamax.me':   'megamax',
  'drive.google.com':   'googledrive',
  'a3.vidblue.online':  'vidblue',
  'yhn1.vadbam.net':    'vadbam',
  'tgb9.vadbam.net':    'vadbam',
  'streamwish.to':      'streamwish',
  'www.streamwish.to':  'streamwish',
  'awish.pro':          'streamwish',
  'dwish.pro':          'streamwish',
  'embedwish.com':      'streamwish',
  'hgplaycdn.com':      'streamwish',
  'huntrexus.com':      'streamwish',
  'krakenfiles.com':    'krakenfiles',
  'www.krakenfiles.com':'krakenfiles',
  'lulustream.com':     'lulustream',
  'www.lulustream.com': 'lulustream',
  'mivalyo.com':        'earnvids',
  'www.mivalyo.com':    'earnvids',
  'doodstream.com':     'doodstream',
  'www.doodstream.com': 'doodstream',
  'dood.to':            'doodstream',
  'dood.so':            'doodstream',
  'dood.la':            'doodstream',
  'mixdrop.ag':         'mixdrop',
  'www.mixdrop.ag':     'mixdrop',
  'mixdrop.to':         'mixdrop',
  'veev.to':            'veev',
  'www.veev.to':        'veev',
};

// Provider status: 'direct'=working proxy, 'embed'=Stremio browser, 'pending'=not investigated
const knownProviders = {
  'mp4upload':   'direct',
  'dailymotion': 'direct',
  'okru':        'direct',
  'videa':       'direct',
  'larhu':       'direct',
  'rubyvidhub':  'direct',
  'voe':         'direct',
  'uqload':      'direct',
  'dsvplay':     'direct',
  'mega':        'embed',
  'megamax':     'direct',
  'share4max':   'direct',
  'vidmoly':     'pending',
  'sendvid':     'pending',
  'sibnet':      'pending',
  'hgcloud':     'pending',
  'turbovidhls': 'pending',
  'googledrive': 'pending',
  'vidblue':     'pending',
  'vadbam':      'pending',
  'streamwish':  'pending',
  'krakenfiles': 'embed',
  'lulustream':  'embed',
  'earnvids':    'pending',
  'doodstream':  'pending',
  'mixdrop':     'pending',
  'veev':        'pending',
};

// ─── Selectors ────────────────────────────────────────────────────────────────

const SELECTORS = {
  /** Catalog/search: each anime card on listing pages */
  card:          '.anime-card',
  cardLink:      'a.image',
  cardImg:       'a.image img',
  cardTitle:     '.info h3',
  /** Detail/meta page */
  metaTitle:     'h1',
  metaOgImage:   'meta[property="og:image"]',
  metaDesc:      '.content p',
  metaGenres:    '.genres a',
  episodeList:   'ul.episodes-lists li',
  episodeLink:   'a.title',
  episodeTitle:  'a.title h3',
  /** Stream/episode page */
  serverList:    'ul.server-list li a.option[data-embed]',
  serverName:    '.server',
  /** Pagination */
  nextPage:      '.pagination a[rel="next"]',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const plain   = (opts = {}) => ({ ...opts, useFS: false });

/**
 * Build a catalog URL with optional genre/type filters and pagination.
 * @param {string} baseUrl - The base catalog URL
 * @param {number} page    - Page number (1-indexed)
 * @param {string} [genre] - Genre name in Arabic (looked up in GENRE_SLUGS)
 * @param {string} [type]  - Type filter (e.g., 'TV', 'فيلم')
 * @returns {string} The fully constructed URL
 */
function buildUrl(baseUrl, page, genre, type) {
  let url = baseUrl;

  // Genre filter overrides the catalog base URL
  if (genre && GENRE_SLUGS[genre]) {
    url = `${BASE_URL}/anime-genre/${GENRE_SLUGS[genre]}/`;
  } else if (type && !genre) {
    // Type filter (only when no genre is active)
    url = `${BASE_URL}/anime-type/${encodeURIComponent(type)}/`;
  }

  // Append page parameter for pages > 1
  if (page > 1) url += `?page=${page}`;

  return url;
}

/**
 * Determine the provider ID from an embed URL's hostname.
 * @param {string} embedUrl - The raw embed URL
 * @returns {string|null} Provider ID or null if unknown
 */
function getProviderId(embedUrl) {
  try {
    const hostname = new URL(embedUrl).hostname.replace(/^www\./, '');
    return PROVIDER_MAP[hostname] || null;
  } catch {
    return null;
  }
}

// ─── Card parser ──────────────────────────────────────────────────────────────
/**
 * Parse anime cards from a listing page (catalog or search results).
 * @param {CheerioStatic} $    - Loaded cheerio instance
 * @param {string}       label - Logging label (e.g., catalog name)
 * @returns {Array<{id: string, title: string, thumb: string, url: string}>}
 */
function parseCards($, label = '') {
  const items = [];
  const seen  = new Set();

  $(SELECTORS.card).each((_, el) => {
    const $el   = $(el);
    const $link = $el.find(SELECTORS.cardLink);
    const href  = $link.attr('href') || '';
    const title = ($el.find(SELECTORS.cardTitle).first().text() || '').trim();
    const thumb = $link.find('img').attr('src') || $link.find('img').attr('data-src') || '';

    if (!href || !title || seen.has(href)) return;

    const fullUrl = resolve(href);
    seen.add(href);

    items.push({
      id:    mkId(fullUrl),
      title,
      thumb: resolve(thumb),
      url:   fullUrl,
    });
  });

  if (label) console.log(`[AnimeLek] ${label} → ${items.length} items`);
  return items;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a catalog page (list of anime).
 * @param   {string} catalogId - One of: 'all', 'film', 'airing'
 * @param   {number} page      - Page number (default: 1)
 * @param   {object} extra     - Optional filters: { genre, type }
 * @returns {{ items: Array, hasNextPage: boolean }}
 */
async function getCatalog(catalogId, page = 1, extra = {}) {
  const cat   = CATALOGS.find((c) => c.id === catalogId);
  if (!cat) return { items: [], hasNextPage: false };
  const url   = buildUrl(cat.url, page, extra.genre, extra.type);
  const html  = await fetchPage(url, BASE_URL, plain());

  if (!html) return { items: [], hasNextPage: false };

  const $ = cheerio.load(html);

  return {
    items:       parseCards($, cat.name),
    hasNextPage: !!$(SELECTORS.nextPage).length,
  };
}

/**
 * Search for anime by query.
 * @param   {string} query - Search term
 * @returns {Array<{id: string, title: string, thumb: string, url: string}>}
 */
async function search(query) {
  const url  = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
  const html = await fetchPage(url, BASE_URL, plain());

  if (!html) return [];

  return parseCards(cheerio.load(html), `search: "${query}"`);
}

/**
 * Fetch detailed metadata for an anime.
 * The encodedId is a base64url-encoded relative path (e.g., /anime/naruto/).
 *
 * @param   {string} encodedId - Base64url-encoded relative URL
 * @returns {object|null} {
 *   title, thumb, description, genres: string[],
 *   episodeLinks: [{ id, href, title, epNum, seasonNum }]
 * }
 */
async function getMeta(encodedId) {
  const url  = toUrl(encodedId);
  const html = await fetchPage(url, BASE_URL, plain());

  if (!html) return null;

  const $ = cheerio.load(html);

  // ─── Extract basic info ──────────────────────────────────────────────────
  const title       = $(SELECTORS.metaTitle).first().text().trim();
  const thumb       = resolve($(SELECTORS.metaOgImage).attr('content') || '');
  const description = (
    $(SELECTORS.metaDesc).first().text()
    || $('meta[name="description"]').attr('content')
    || ''
  ).trim();
  const genres = $(SELECTORS.metaGenres).map((_, el) => $(el).text().trim()).get();

  // ─── Extract episode list ────────────────────────────────────────────────
  const episodeLinks = [];

  $(SELECTORS.episodeList).each((i, el) => {
    const $el   = $(el);
    const epNum = parseInt($el.attr('data-number') || '0') || (i + 1);
    const $a    = $el.find(SELECTORS.episodeLink);
    const href  = $a.attr('href') || '';
    const epTitle = $a.find(SELECTORS.episodeTitle).text().trim() || `الحلقة ${epNum}`;

    if (!href) return;

    episodeLinks.push({
      id:        mkId(resolve(href)),
      href:      resolve(href),
      title:     epTitle,
      epNum,
      seasonNum: 1,
    });
  });

  return { title, thumb, description, genres, episodeLinks };
}

/**
 * Fetch available streams for an episode.
 * The encodedId is a base64url-encoded relative path to the episode page.
 *
 * Parses the server list from the episode page, resolves card.php?random=
 * obfuscated URLs, determines quality from server labels, and maps each
 * server to a provider ID.
 *
 * All streams are returned with isEmbed: false — the orchestrator decides
 * the final routing (direct extraction, proxy, or in-browser embed).
 *
 * @param   {string} encodedId - Base64url-encoded episode URL
 * @returns {Array<{ url: string, label: string, isEmbed: boolean, quality: string, providerId: string|null }>}
 */
async function getStreams(encodedId) {
  const url  = toUrl(encodedId);
  console.log(`[AnimeLek] getStreams ${url}`);

  const html = await fetchPage(url, BASE_URL, plain({ noCache: true }));
  if (!html) return [];

  // ─── Check for error pages ──────────────────────────────────────────────
  const pageLower = html.toLowerCase();
  const errorPatterns = [
    '404', 'not found', 'page not found', 'error 404',
    'غير موجود', 'غير متاح', 'محذوف', 'تم الحذف',
    'this page is no longer available', 'deleted', 'removed',
    'صفحة غير موجودة', 'لم يتم العثور',
  ];
  const isError = errorPatterns.some(p => pageLower.includes(p)) && html.length < 5000;
  const hasServerList = html.includes('server-list');
  
  if (isError || (!hasServerList && html.length < 2000)) {
    const reason = isError ? 'صفحة غير متاحة (محذوفة/غير موجودة)' : 'لا توجد خوادم متاحة';
    console.log(`[AnimeLek] ❌ Episode error: ${reason}`);
    return [{
      url: url, label: `❌ ${reason}`, isEmbed: true, quality: '—', providerId: null,
    }];
  }

  const $       = cheerio.load(html);
  const streams = [];
  const seen    = new Set();

  /**
   * Add a stream entry, deduplicating by URL.
   * @param {string}  rawUrl     - The embed/stream URL
   * @param {string}  label      - Display label (server name + quality)
   * @param {string}  quality    - Video quality string
   * @param {string|null} providerId - Provider ID for orchestrator routing
   */
function addStream(rawUrl, label, quality, providerId) {
    const u = rawUrl.startsWith('http') ? rawUrl : resolve(rawUrl);
    if (!u || seen.has(u)) return;
    seen.add(u);

    // Provider status emoji
    const isEmbed = !providerId || providerId === 'none';
    let emoji = '🔍';
    if (providerId && knownProviders[providerId] === 'direct') emoji = '✅';
    else if (providerId && knownProviders[providerId] === 'embed') emoji = '🔵';
    else if (providerId && knownProviders[providerId] === 'pending') emoji = '📝';
    else if (providerId) emoji = '🔍';

    streams.push({
      url:        u,
      label:      `${emoji} ${label}`,
      isEmbed,
      quality,
      providerId,
    });
    console.log(`  [Stream] ${emoji} ${label} → ${providerId || 'unknown'} → ${u.substring(0, 80)}`);
  }

  // ─── Parse server list ───────────────────────────────────────────────────
  const serverElements = $(SELECTORS.serverList).toArray();

  for (const el of serverElements) {
    const $el  = $(el);
    const embed = $el.attr('data-embed') || '';
    const srv  = $el.find(SELECTORS.serverName).text().trim();

    if (!embed) continue;

    // Resolve card.php?random= obfuscated URLs
    // The data-embed may look like: card.php?random=<base64-encoded-url>
    let actualUrl = embed;
    const cardMatch = embed.match(/card\.php\?random=([^&]+)/);
    if (cardMatch) {
      try {
        actualUrl = decodeURIComponent(cardMatch[1]);
      } catch (_) {
        actualUrl = cardMatch[1];
      }
    }

    // Determine quality from the server label text
    const quality = srv.match(/\b(FHD|HD|SD|4K|1080p|720p|480p|360p)\b/i)?.[1] || 'Auto';

    // Map this embed URL to a provider ID (unknown providers go through /stream)
    const providerId = getProviderId(actualUrl) || 'generic';

    addStream(actualUrl, `${srv} — ${quality}`, quality, providerId);
  }

  // ─── Fallback: direct iframes on the page ────────────────────────────────
  if (streams.length === 0) {
    $('iframe[src]:not([src=""]):not([src="about:blank"])').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src) {
        const providerId = getProviderId(src) || 'generic';
        addStream(src, `مشغل ${i + 1}`, 'Auto', providerId);
      }
    });
  }

  // Deduplicate by label (keep first occurrence of each server name)
  const labelSeen = new Set();
  const unique    = [];

  for (const s of streams) {
    const key = s.label || s.url;
    if (!labelSeen.has(key)) {
      labelSeen.add(key);
      unique.push(s);
    }
  }

  console.log(`[AnimeLek] ${unique.length} stream(s) returned`);

  // Add "Open in browser" fallback at the end
  unique.push({
    url:        url,
    label:      '🌐 فتح في المتصفح',
    isEmbed:    true,
    quality:    '—',
    providerId: null,
  });

  return unique;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Config / metadata
  SITE_ID,
  SITE_NAME,
  SITE_LOGO,
  SITE_BASE_URL,
  NEEDS_FLARESOLVERR,
  SEARCH_ENABLED,
  PROXY_IMAGES, PROXY_STREAMS,

  // Constants for catalog/filter definitions
  CATALOGS,
  EXTRA_SUPPORTED,
  GENRES,
  TYPES,

  // Scraper functions
  getCatalog,
  search,
  getMeta,
  getStreams,
};
