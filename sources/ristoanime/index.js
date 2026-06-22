/**
 * Scraper: RistoAnime
 * URL: https://ristoanime.me
 * CF: NO — plain HTTP (Cloudflare CDN only, no Turnstile)
 *
 * Fetches catalog, search, meta, and stream data from RistoAnime.
 * Returns streams with provider IDs so the orchestrator can handle
 * provider-specific extraction/proxying.
 *
 * All streams are marked isEmbed: false — the orchestrator decides
 * the final routing based on providerId.
 */

const cheerio = require('cheerio');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = 'https://ristoanime.me';

const SITE_ID            = 'ristoanime';
const SITE_NAME          = 'RistoAnime';
const SITE_LOGO          = `${BASE_URL}/favicon.ico`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = false;

const EXTRA_SUPPORTED = [];

const CATALOGS = [
  { id: 'all', name: 'الأنمي', url: `${BASE_URL}/series/` },
];

/**
 * Maps embed URL hostname fragments to provider IDs.
 * These match the providers listed in meta.json.
 */
const PROVIDER_MAP = [
  { match: 'mp4upload', providerId: 'mp4upload' },
  { match: 'mega',      providerId: 'mega' },
  { match: 'uqload',    providerId: 'uqload' },
];

// ─── Selectors ────────────────────────────────────────────────────────────────

const SELECTORS = {
  /** Catalog/search: each anime card on listing pages */
  card:          '.MovieItem',
  cardLink:      'a',
  cardPoster:    '.poster',
  cardTitle:     '.title h4',
  /** Detail/meta page */
  metaTitle:     'h1.entry-title, h1.title',
  metaOgImage:   'meta[property="og:image"]',
  metaOgTitle:   'meta[property="og:title"]',
  metaDesc:      '.entry-content p, .desc p, .description p',
  metaOgDesc:    'meta[property="og:description"]',
  episodeList:   '.EpisodesList a',
  /** Stream/episode page */
  serverList:    'ul#watch li[data-watch]',
  /** Pagination */
  nextPage:      'a.next.page-numbers, a[rel="next"]',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const plain   = (opts = {}) => ({ ...opts, useFS: false });

/**
 * Determine the provider ID from an embed URL.
 * @param {string} embedUrl - The raw embed URL
 * @returns {string|null} Provider ID or null if unknown
 */
function getProviderId(embedUrl) {
  const lower = embedUrl.toLowerCase();
  for (const entry of PROVIDER_MAP) {
    if (lower.includes(entry.match)) return entry.providerId;
  }
  return null;
}

/**
 * Extract a URL from a CSS background-image property value.
 * Handles: background-image: url(...), background-image:url(...)
 * @param {string} styleValue - The style attribute value
 * @returns {string} The extracted URL or empty string
 */
function extractBgImageUrl(styleValue) {
  if (!styleValue) return '';
  const match = styleValue.match(/https?:\/\/[^'")\s;]+/);
  return match ? match[0] : '';
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
    const $a    = $el.find(SELECTORS.cardLink).first();
    const href  = $a.attr('href') || '';

    // Title from <div class="title"><h4>text</h4></div>
    const title = $el.find(SELECTORS.cardTitle).first().text().trim() ||
                  $a.attr('title') || '';

    // Poster from data-style="background-image: url(...)" or style attr
    const $poster  = $el.find(SELECTORS.cardPoster).first();
    const bgStyle  = $poster.attr('data-style') || $poster.attr('style') || '';
    const thumb    = extractBgImageUrl(bgStyle);

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

  if (label) console.log(`[RistoAnime] ${label} → ${items.length} items`);
  return items;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a catalog page (list of anime).
 * @param   {string} catalogId - Catalog ID (currently only 'all' supported)
 * @param   {number} page      - Page number (default: 1)
 * @param   {object} extra     - Optional filters (unused for ristoanime)
 * @returns {{ items: Array, hasNextPage: boolean }}
 */
async function getCatalog(catalogId, page = 1, extra = {}) {
  const url  = `${BASE_URL}/series/page/${page}/`;
  const html = await fetchPage(url, BASE_URL, plain());

  if (!html) return { items: [], hasNextPage: false };

  const $ = cheerio.load(html);

  return {
    items:       parseCards($, `page ${page}`),
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
 * The encodedId is a base64url-encoded relative path (e.g., /naruto-shippuden/).
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
  const title = (
    $(SELECTORS.metaTitle).first().text().trim()
    || $(SELECTORS.metaOgTitle).attr('content')?.replace(' – ', '')?.trim()
    || ''
  );

  const thumb = (
    resolve($(SELECTORS.metaOgImage).attr('content') || '')
    || ''
  );

  const description = (
    $(SELECTORS.metaDesc).first().text().trim()
    || $(SELECTORS.metaOgDesc).attr('content')
    || ''
  );

  // ─── Extract episode list ────────────────────────────────────────────────
  // RistoAnime uses .EpisodesList a for episode links with Arabic labels.
  // Each <a> has an href pointing to the episode page and text like "الحلقة 1".
  const episodeLinks = [];

  $(SELECTORS.episodeList).each((i, el) => {
    const $el    = $(el);
    const href   = $el.attr('href') || '';
    if (!href) return;

    const epTitle = $el.text().trim();
    const epNumMatch = epTitle.match(/(\d+)/) || href.match(/episode[-\/](\d+)/i);
    const epNum = epNumMatch ? parseInt(epNumMatch[1]) : (i + 1);

    episodeLinks.push({
      id:        mkId(resolve(href)),
      href:      resolve(href),
      title:     epTitle || `الحلقة ${epNum}`,
      epNum,
      seasonNum: 1,
    });
  });

  return { title, thumb, description, genres: [], episodeLinks };
}

/**
 * Fetch available streams for an episode.
 * The encodedId is a base64url-encoded relative path to the episode page.
 *
 * Parses the /watch/ subpage of the episode URL for embed server links.
 * Maps each embed URL to a provider ID based on known hostname fragments.
 *
 * All streams are returned with isEmbed: false — the orchestrator decides
 * the final routing (direct extraction, proxy, or in-browser embed).
 *
 * @param   {string} encodedId - Base64url-encoded episode URL
 * @returns {Array<{ url: string, label: string, isEmbed: boolean, quality: string, providerId: string|null }>}
 */
async function getStreams(encodedId) {
  const episodeUrl = toUrl(encodedId);
  // The watch URL adds /watch/ to the episode URL
  const watchUrl = episodeUrl.replace(/\/?$/, '/watch/');
  console.log(`[RistoAnime] getStreams ${watchUrl}`);

  const html = await fetchPage(watchUrl, BASE_URL, plain({ noCache: true }));
  if (!html) return [];

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

    streams.push({
      url:        u,
      label,
      isEmbed:    false,
      quality,
      providerId,
    });
    console.log(`  [Stream] ${label} → ${providerId || 'unknown'} → ${u.substring(0, 80)}`);
  }

  // ─── Parse server list: ul#watch li[data-watch] ─────────────────────────
  $(SELECTORS.serverList).each((i, el) => {
    const $el      = $(el);
    const embedUrl = $el.attr('data-watch') || '';
    if (!embedUrl) return;

    // Extract server name from <strong>, <span>, or the li text content
    const serverName = (
      $el.find('strong, span, a').first().text().trim()
      || $el.text().trim()
      || `خادم ${i + 1}`
    );

    // Determine quality from the li text content (may contain FHD, HD, SD)
    const qualityMatch = serverName.match(/\b(FHD|HD|SD|4K|1080p|720p|480p|360p)\b/i);
    const quality = qualityMatch ? qualityMatch[1] : 'Auto';

    // Map this embed URL to a provider ID
    const providerId = getProviderId(embedUrl);

    addStream(embedUrl, `${serverName} — ${quality}`, quality, providerId);
  });

  // ─── Fallback: direct iframes on the page ────────────────────────────────
  if (streams.length === 0) {
    $('.WatchIframe iframe[src], iframe[src]:not([src=""]):not([src="about:blank"])').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src) {
        const providerId = getProviderId(src);
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

  console.log(`[RistoAnime] ${unique.length} stream(s) returned`);
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
  PROXY_IMAGES,

  // Constants for catalog/filter definitions
  CATALOGS,
  EXTRA_SUPPORTED,

  // Scraper functions
  getCatalog,
  search,
  getMeta,
  getStreams,
};
