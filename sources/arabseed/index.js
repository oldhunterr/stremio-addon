/**
 * Scraper: ArabSeed (عرب سيد)
 * URL: https://a.asd.ink
 * CF: NO — plain HTTP (requires browser UA header)
 *
 * Fetches catalog, search, meta, and stream data from ArabSeed.
 * Supports movies (أفلام) and series (مسلسلات) with episode-based streams.
 *
 * All streams carry a providerId so the orchestrator can route
 * extraction/proxying to the correct handler.
 */

const cheerio = require('cheerio');
const axios   = require('axios');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_URL = process.env.ARABSEED_URL || 'https://a.asd.ink';

const SITE_ID            = 'arabseed';
const SITE_NAME          = 'عرب سيد — ArabSeed';
const SITE_LOGO          = `${BASE_URL}/lgo222.png`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = false;
const PROXY_STREAMS      = true;

const EXTRA_SUPPORTED = ['category', 'genre', 'type'];
const TYPES = ['movie', 'series'];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Cookie store — shared between page fetches and AJAX calls
const cookieStore = {};

// CSRF token — extracted dynamically from the site's page HTML.
// Refreshed lazily on first request that needs it.
let csrfToken = '';

/**
 * Visit the base URL and extract a fresh CSRF token from the page HTML.
 * The site embeds it as: csrf__token': "xxxxx"
 */
async function refreshCsrfToken() {
  try {
    console.log('[ArabSeed] Extracting CSRF token from base page...');
    const html = await fetchPage(BASE_URL + '/series/', BASE_URL, plain({ noCache: true }));
    if (!html) {
      console.warn('[ArabSeed] Failed to fetch base page for CSRF token');
      return;
    }
    const match = html.match(/csrf__token['"]?\s*[:=]\s*['"]([a-f0-9]+)['"]/i);
    if (match) {
      csrfToken = match[1];
      console.log(`[ArabSeed] CSRF token: ${csrfToken}`);
    } else {
      console.warn('[ArabSeed] CSRF token not found in page');
    }
  } catch (err) {
    console.warn(`[ArabSeed] CSRF extraction failed: ${err.message}`);
  }
}

// Axios client with browser UA for AJAX calls
// Uses withCredentials + Cookie header to maintain session with the site
const ajaxClient = axios.create({
  timeout: 15000,
  maxRedirects: 5,
  withCredentials: true,
  headers: {
    'User-Agent': UA,
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': '*/*',
    'Referer': BASE_URL + '/',
  },
  validateStatus: () => true,
});

// Intercept requests to inject cookies
ajaxClient.interceptors.request.use(config => {
  const cookies = Object.entries(cookieStore).map(([k,v]) => `${k}=${v}`).join('; ');
  if (cookies) config.headers['Cookie'] = cookies;
  return config;
});

// Intercept responses to capture cookies
ajaxClient.interceptors.response.use(resp => {
  const setCookie = resp.headers['set-cookie'];
  if (setCookie) {
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookies) {
      const [kv] = c.split(';');
      const [k, v] = kv.split('=');
      if (k && v !== undefined) cookieStore[k.trim()] = String(v).trim();
    }
  }
  return resp;
});

// ─── Catalog URL map ──────────────────────────────────────────────────────────

const CATALOG_URLS = {
  // ── Movies (الأفلام) ──────────────────────────────────────────────────────
  'movies':           `${BASE_URL}/movies/`,
  'movies-foreign':   `${BASE_URL}/category/foreign-movies-17/`,
  'movies-arabic':    `${BASE_URL}/category/arabic-movies-14/`,
  'movies-turkish':   `${BASE_URL}/category/turkish-movies/`,
  'movies-asian':     `${BASE_URL}/category/asian-movies-2/`,
  'movies-indian':    `${BASE_URL}/category/indian-movies-2/`,
  'movies-dubbed':    `${BASE_URL}/category/dubbed-movies/`,
  'movies-classic':   `${BASE_URL}/category/classic-movies/`,
  'movies-netflix':   `${BASE_URL}/category/netflix-movies/`,

  // ── Series (المسلسلات) ────────────────────────────────────────────────────
  'series':           `${BASE_URL}/series/`,
  'series-foreign':   `${BASE_URL}/category/foreign-series-9/`,
  'series-arabic':    `${BASE_URL}/category/arabic-series-14/`,
  'series-turkish':   `${BASE_URL}/category/turkish-series-2/`,
  'series-korean':    `${BASE_URL}/category/korean-series/`,
  'series-egyptian':  `${BASE_URL}/category/egyptian-series/`,
  'series-indian':    `${BASE_URL}/category/indian-series/`,
  'series-dubbed':    `${BASE_URL}/category/dubbed-series/`,
  'series-cartoon':   `${BASE_URL}/category/cartoon-series/`,
  'series-netflix':   `${BASE_URL}/category/netflix-series/`,

  // ── Ramadan (رمضان) ───────────────────────────────────────────────────────
  'ramadan':          `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/`,
  'ramadan-2026':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/ramadan-series-2026-1/`,
  'ramadan-2025':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/ramadan-series-2025/`,
  'ramadan-2024':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/ramadan-series-2024/`,
  'ramadan-2023':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/ramadan-series-2023/`,
  'ramadan-2022':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-2022/`,
  'ramadan-2021':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-2021/`,
  'ramadan-2020':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-2020-hd/`,
  'ramadan-2019':     `${BASE_URL}/category/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-1/%D9%85%D8%B3%D9%84%D8%B3%D9%84%D8%A7%D8%AA-%D8%B1%D9%85%D8%B6%D8%A7%D9%86-2019/`,

  // ── Anime (انمي) ───────────────────────────────────────────────────────────
  'anime':            `${BASE_URL}/category/animation-movies/`,
  'anime-movies':     `${BASE_URL}/category/animation-movies/`,
  'anime-series':     `${BASE_URL}/category/cartoon-series/`,

  // ── Others (اخري) ─────────────────────────────────────────────────────────
  'others':           `${BASE_URL}/main/`,
  'others-wwe':       `${BASE_URL}/category/wwe-shows-1/`,
  'others-songs':     `${BASE_URL}/category/arabic-songs/`,
  'others-tv':        `${BASE_URL}/category/%D8%A8%D8%B1%D8%A7%D9%85%D8%AC-%D8%AA%D9%84%D9%81%D8%B2%D9%8A%D9%88%D9%86%D9%8A%D8%A9/`,
  'others-plays':     `${BASE_URL}/category/%D9%85%D8%B3%D8%B1%D8%AD%D9%8A%D8%A7%D8%AA-%D8%B9%D8%B1%D8%A8%D9%8A/`,

  // ── Global ────────────────────────────────────────────────────────────────
  'browse':           `${BASE_URL}/main/`,
  'recently':         `${BASE_URL}/recently/`,
  'trending':         `${BASE_URL}/trend/`,
};

// ─── Genre URL map ────────────────────────────────────────────────────────────
// Each genre has its own page: https://a.asd.ink/genre/{name}/
const GENRE_URLS = {
  'أكشن':        `${BASE_URL}/genre/%D8%A3%D9%83%D8%B4%D9%86/`,
  'مغامرات':     `${BASE_URL}/genre/%D9%85%D8%BA%D8%A7%D9%85%D8%B1%D8%A7%D8%AA/`,
  'كوميدي':      `${BASE_URL}/genre/%D9%83%D9%88%D9%85%D9%8A%D8%AF%D9%8A/`,
  'دراما':       `${BASE_URL}/genre/%D8%AF%D8%B1%D8%A7%D9%85%D8%A7/`,
  'رعب':         `${BASE_URL}/genre/%D8%B1%D8%B9%D8%A8/`,
  'خيال علمي':   `${BASE_URL}/genre/%D8%AE%D9%8A%D8%A7%D9%84-%D8%B9%D9%84%D9%85%D9%8A/`,
  'غموض':        `${BASE_URL}/genre/%D8%BA%D9%85%D9%88%D8%B6/`,
  'إثارة':       `${BASE_URL}/genre/%D8%A5%D8%AB%D8%A7%D8%B1%D8%A9/`,
  'جريمة':       `${BASE_URL}/genre/%D8%AC%D8%B1%D9%8A%D9%85%D8%A9/`,
  'تاريخي':      `${BASE_URL}/genre/%D8%AA%D8%A7%D8%B1%D9%8A%D8%AE%D9%8A/`,
  'حربي':        `${BASE_URL}/genre/%D8%AD%D8%B1%D8%A8%D9%8A/`,
  'رياضي':       `${BASE_URL}/genre/%D8%B1%D9%8A%D8%A7%D8%B6%D9%8A/`,
  'موسيقي':      `${BASE_URL}/genre/%D9%85%D9%88%D8%B3%D9%8A%D9%82%D9%8A/`,
  'فنتازيا':     `${BASE_URL}/genre/%D9%81%D9%86%D8%AA%D8%A7%D8%B2%D9%8A%D8%A7/`,
  'خارق للعادة': `${BASE_URL}/genre/%D8%AE%D8%A7%D8%B1%D9%82-%D9%84%D9%84%D8%B9%D8%A7%D8%AF%D8%A9/`,
  'عائلي':       `${BASE_URL}/genre/%D8%B9%D8%A7%D8%A6%D9%84%D9%8A/`,
  'أطفال':       `${BASE_URL}/genre/%D8%A3%D8%B7%D9%81%D8%A7%D9%84/`,
  'سيرة ذاتية':  `${BASE_URL}/genre/%D8%B3%D9%8A%D8%B1%D8%A9-%D8%B0%D8%A7%D8%AA%D9%8A%D8%A9/`,
  'بوليسي':      `${BASE_URL}/genre/%D8%A8%D9%88%D9%84%D9%8A%D8%B3%D9%8A/`,
};

// ─── Provider map ──────────────────────────────────────────────────────────────

const PROVIDER_MAP = {
  'mp4upload.com':       'mp4upload',
  'www.mp4upload.com':   'mp4upload',
  'dailymotion.com':     'dailymotion',
  'www.dailymotion.com': 'dailymotion',
  'ok.ru':               'okru',
  'www.ok.ru':           'okru',
  'videa.hu':            'videa',
  'www.videa.hu':        'videa',
  'voe.sx':              'voe',
  'www.voe.sx':          'voe',
  'vidmoly.biz':         'vidmoly',
  'www.vidmoly.biz':     'vidmoly',
  'vidmoly.net':         'vidmoly',
  'www.vidmoly.net':     'vidmoly',
  'uqload.is':           'uqload',
  'www.uqload.is':       'uqload',
  'uqload.io':           'uqload',
  'www.uqload.io':       'uqload',
  'rubyvidhub.com':      'rubyvidhub',
  'www.rubyvidhub.com':  'rubyvidhub',
  'mixdrop.ag':          'mixdrop',
  'www.mixdrop.ag':      'mixdrop',
  'mixdrop.to':          'mixdrop',
  'krakenfiles.com':     'krakenfiles',
  'www.krakenfiles.com': 'krakenfiles',
  'lulustream.com':      'lulustream',
  'www.lulustream.com':  'lulustream',
  'doodstream.com':      'doodstream',
  'www.doodstream.com':  'doodstream',
  'dood.to':             'doodstream',
  'streamwish.to':       'streamwish',
  'www.streamwish.to':   'streamwish',
  'dsvplay.com':         'dsvplay',
  'www.dsvplay.com':     'dsvplay',
  'playmogo.com':        'dsvplay',
  'luluvid.com':         'luluvid',
  'www.luluvid.com':     'luluvid',
  'vidaraa.cc':          'vidaraa',
  'www.vidaraa.cc':      'vidaraa',
  'bysezejataos.com':    'bysezejataos',
  'www.bysezejataos.com':'bysezejataos',
  'reviewrate.net':      'reviewrate',
  'm.reviewrate.net':    'reviewrate',
};

const knownProviders = {
  'mp4upload':   'direct',
  'dailymotion': 'direct',
  'okru':        'direct',
  'videa':       'direct',
  'voe':         'direct',
  'uqload':      'direct',
  'dsvplay':     'direct',
  'vidmoly':     'pending',
  'rubyvidhub':  'direct',
  'mixdrop':     'pending',
  'krakenfiles': 'embed',
  'lulustream':  'embed',
  'doodstream':  'pending',
  'streamwish':  'pending',
  'luluvid':     'pending',
  'vidaraa':     'pending',
  'bysezejataos':'pending',
  'reviewrate':  'embed',
};

// ─── Selectors ────────────────────────────────────────────────────────────────

const SELECTORS = {
  // Listing cards
  card:          'a.movie__block[href]',
  cardImg:       'img.images__loader, img[data-src]',
  cardTitle:     '.post__info h3',
  cardQuality:   '.__quality',
  cardCategory:  '.post__category',
  cardRating:    '.post__ratings',
  // Detail/meta page
  metaTitle:     'h1.post__name',
  metaPoster:    '.poster__single img',
  metaDesc:      '.single__contents .post__story p',
  metaIframe:    'iframe#video_frame',
  // Seasons
  seasonList:    '#seasons__list ul li[data-term]',
  // Watch page
  watchIframe:   'iframe#video_frame',
  watchDataLinks:'li[data-link]',
  watchQuality:  '.qualities__list li[data-quality]',
  // Pagination
  pagination:    'div.paginate',
  nextPage:      'a.next.page-numbers',
  pageLinks:     'a.page-numbers',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const plain   = (opts = {}) => ({ ...opts, useFS: false });

function getProviderId(embedUrl) {
  try {
    const hostname = new URL(embedUrl).hostname.replace(/^www\./, '');
    return PROVIDER_MAP[hostname] || null;
  } catch {
    return null;
  }
}

/**
 * Determine if a URL is a movie (فيلم) vs series episode (مسلسل/s)
 */
function isMovieUrl(url) {
  const u = decodeURIComponent(url).toLowerCase();
  return u.includes('فيلم') || u.includes('movie') || u.includes('film');
}

/**
 * Determine content type from a card item.
 * Priority: episode patterns first, then movie, then series.
 * @param {object} item - The card item containing url and category
 * @returns {'movie'|'series'|'episode'|'unknown'}
 */
function getContentType(item) {
  if (!item) return 'unknown';
  const u = decodeURIComponent(item.url || '').toLowerCase();
  const c = (item.category || '').toLowerCase();

  // Episode patterns (check first — they may also contain film or مسلسل/movies/series)
  if (/-s\d+-eps\d+/i.test(u)) return 'episode';
  if (u.includes('حلقة') || u.includes('episode') || u.includes('episodes') || c.includes('حلقة') || c.includes('episode') || c.includes('episodes')) return 'episode';

  // Movie (film / films / movie / movies / فيلم / افلام)
  if (
    u.includes('فيلم') || u.includes('افلام') ||
    u.includes('film') || u.includes('films') ||
    u.includes('movie') || u.includes('movies') ||
    c.includes('فيلم') || c.includes('افلام') ||
    c.includes('film') || c.includes('films') ||
    c.includes('movie') || c.includes('movies')
  ) {
    return 'movie';
  }

  // Series (series / مسلسل / مسلسلات)
  if (
    u.includes('مسلسل') || u.includes('مسلسلات') ||
    u.includes('series') ||
    c.includes('مسلسل') || c.includes('مسلسلات') ||
    c.includes('series')
  ) {
    return 'series';
  }

  return 'unknown';
}

/**
 * Filter parsed cards by content type.
 * When extra.type is 'movie', only keep movie cards.
 * When extra.type is 'series', keep series.
 * @param {Array} items - Parsed card items [{ url, ... }]
 * @param {string} type - 'movie' or 'series'
 * @returns {Array} Filtered items
 */
function filterCardsByType(items, type) {
  if (!type) return items;
  return items.filter(item => {
    const ct = getContentType(item);
    if (type === 'movie') return ct === 'movie';
    if (type === 'series') return ct === 'series';
    return true;
  });
}

/**
 * Build a catalog URL with page number.
 * /main10/ uses ?page_number=N, everything else uses /page/N/
 */
function buildCatalogUrl(catalogId, page) {
  const baseUrl = CATALOG_URLS[catalogId];
  if (!baseUrl) return null;
  if (page <= 1) return baseUrl;
  if (catalogId === 'browse' || catalogId === 'others') {
    return baseUrl.replace(/\/$/, '') + `/?page_number=${page}`;
  }
  return baseUrl.replace(/\/$/, '') + `/page/${page}/`;
}

/**
 * Build a URL for a genre-filtered catalog page.
 * Genres have their own pages: https://a.asd.ink/genre/{slug}/
 * @param {string} genre - Arabic genre name
 * @param {number} page  - Page number
 * @returns {string|null}
 */
function buildCatalogUrlFromGenre(genre, page) {
  const baseUrl = GENRE_URLS[genre];
  if (!baseUrl) return null;
  if (page <= 1) return baseUrl;
  return baseUrl.replace(/\/$/, '') + `/page/${page}/`;
}

/**
 * Decode embed URLs from the watch page.
 * Supports 3 formats:
 *   1. /play.php?url={base64}  → base64 decode → embed URL
 *   2. /play/?id={base64}      → base64 decode → embed URL
 *   3. Direct http URL          → as-is
 */
function decodeEmbedUrl(raw) {
  if (!raw) return null;
  // Format 1: /play.php?url=base64
  const phpMatch = raw.match(/play\.php\?url=([^&]+)/);
  if (phpMatch) {
    try { return Buffer.from(phpMatch[1], 'base64').toString('utf-8'); }
    catch { return null; }
  }
  // Format 2: /play/?id=base64
  const idMatch = raw.match(/play\/\?id=([^&]+)/);
  if (idMatch) {
    try { return Buffer.from(idMatch[1], 'base64').toString('utf-8'); }
    catch { return null; }
  }
  // Format 3: direct HTTP URL
  if (raw.startsWith('http')) return raw;
  return null;
}

// ─── Card parser ──────────────────────────────────────────────────────────────

function parseCards($, label = '') {
  const items = [];
  const seen  = new Set();

  // Find all movie__block cards on the page
  // They can be in ul.movie__blocks__ul (flat grid) or div.swiper-slide (carousel)
  $(SELECTORS.card).each((_, el) => {
    const $el   = $(el);
    const href  = $el.attr('href') || '';
    const title = ($el.find(SELECTORS.cardTitle).first().text() || '').trim();
    if (!href || !title || seen.has(href)) return;

    const $img  = $el.find('img').first();
    const thumb = $img.attr('data-src') || $img.attr('src') || '';
    const quality = ($el.find(SELECTORS.cardQuality).first().text() || '').trim();
    const category = ($el.find(SELECTORS.cardCategory).first().text() || '').trim();
    const fullUrl = resolve(href);
    seen.add(href);

    items.push({
      id:      mkId(fullUrl),
      title,
      thumb:   resolve(thumb),
      url:     fullUrl,
      quality,
      category,
    });
  });

  if (label) console.log(`[ArabSeed] ${label} → ${items.length} items`);
  return items;
}

// ─── Series view via term__posts AJAX ─────────────────────────────────────────
// The site's series__episodes__switcher toggle loads series (not episodes)
// via POST to term__posts with type=series and the current URL path.
// Uses the RELATIVE path format (e.g., /category/arabic-series-14/)
// as the site's own JavaScript does.

async function loadSeriesView(catalogUrl) {
  try {
    // Extract the relative path from the catalog URL
    const urlPath = catalogUrl.replace(BASE_URL, '');
    const apiUrl = `${BASE_URL}/term__posts/`;
    const formData = new URLSearchParams({
      type: 'series',
      url: urlPath,
      csrf_token: csrfToken || '',
    });
    console.log(`[ArabSeed] term__posts type=series url=${urlPath}`);
    const resp = await ajaxClient.post(apiUrl, formData.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const ajaxData = resp.data;
    if (ajaxData?.type === 'success' && ajaxData.html) {
      const $ = cheerio.load(ajaxData.html);
      // Series view cards: <a href="/selary/..." title="...">
      //                     <img data-src="..."> <div class="title___">...</div>
      const items = [];
      const seen = new Set();
      $('a[href*="/selary/"]').each((_, el) => {
        const $el = $(el);
        const href = $el.attr('href') || '';
        const title = $el.attr('title') || $el.find('.title___').first().text().trim() || '';
        if (!href || !title || seen.has(href)) return;
        const thumb = $el.find('img').attr('data-src') || $el.find('img').attr('src') || '';
        const category = ($el.find(SELECTORS.cardCategory).first().text() || '').trim();
        seen.add(href);
        items.push({
          id: mkId(resolve(href)),
          title,
          thumb: resolve(thumb),
          url: resolve(href),
          quality: '',
          category,
        });
      });
      // Fallback: if no selary links found, try general link extraction
      if (items.length === 0) {
        $('a[href]').each((_, el) => {
          const $el = $(el);
          const href = $el.attr('href') || '';
          if (!href.includes(BASE_URL) && !href.startsWith('/')) return;
          const title = $el.attr('title') || $el.find('.title___, h3').first().text().trim() || '';
          if (!title || title.length < 3 || seen.has(href)) return;
          const thumb = $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || '';
          const category = ($el.find(SELECTORS.cardCategory).first().text() || '').trim();
          seen.add(href);
          items.push({
            id: mkId(resolve(href)),
            title,
            thumb: resolve(thumb),
            url: resolve(href),
            quality: '',
            category,
          });
        });
      }
      // Parse pagination from AJAX response
      let hasNextPage = false;
      if (ajaxData.pagination) {
        const p$ = cheerio.load(ajaxData.pagination);
        hasNextPage = p$('a.next.page-numbers').length > 0;
      }
      console.log(`[ArabSeed] series view → ${items.length} items, nextPage=${hasNextPage}`);
      return { items, hasNextPage };
    }
  } catch (err) {
    console.log(`[ArabSeed] term__posts failed: ${err.message}`);
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a catalog page (list of movies or series).
 * For series catalogs, calls term__posts( type=series ) to show
 * the series view instead of the default episodes view.
 * Supports genre filtering via the genre/ page URL pattern.
 * @param   {string} catalogId - One of the catalog IDs from meta.json
 * @param   {number} page      - Page number (default: 1)
 * @param   {object} extra     - Optional filters: { genre }
 * @returns {{ items: Array, hasNextPage: boolean }}
 */
async function getCatalog(catalogId, page = 1, extra = {}) {
  if (!csrfToken) await refreshCsrfToken();

  // Non-existent Genre Fallback Check
  if (extra.genre) {
    const cleanGenre = extra.genre.trim();
    const isAll = cleanGenre === 'الكل' || cleanGenre.toLowerCase() === 'all';
    if (!isAll && !GENRE_URLS[cleanGenre]) {
      return { items: [], hasNextPage: false };
    }
  }

  // ── Resolve the effective catalog URL — may be overridden by extra.category ──
  let effectiveId = catalogId;
  if (extra.category) {
    console.log(`[ArabSeed] category filter: "${extra.category}" → effectiveId lookup`);
    // Map Arabic category name back to the catalog URL key
    // e.g. "أفلام أجنبية" → "movies-foreign"
    const catMap = {
      'الكل': catalogId,
    };
    // Build the reverse map from subcategory data (hardcode for now)
    // Maps both Arabic names AND subcategory IDs to catalog keys
    const reverseMap = {
      'أفلام أجنبية':'movies-foreign','أفلام عربية':'movies-arabic','أفلام تركية':'movies-turkish',
      'أفلام آسيوية':'movies-asian','أفلام هندية':'movies-indian','أفلام مدبلجة':'movies-dubbed',
      'أفلام كلاسيكية':'movies-classic','أفلام نتفليكس':'movies-netflix',
      'مسلسلات أجنبية':'series-foreign','مسلسلات عربية':'series-arabic','مسلسلات تركية':'series-turkish',
      'مسلسلات كورية':'series-korean','مسلسلات مصريه':'series-egyptian','مسلسلات هندية':'series-indian',
      'مسلسلات مدبلجة':'series-dubbed','مسلسلات نتفليكس':'series-netflix',
      'رمضان 2026':'ramadan-2026','رمضان 2025':'ramadan-2025','رمضان 2024':'ramadan-2024',
      'رمضان 2023':'ramadan-2023','رمضان 2022':'ramadan-2022','رمضان 2021':'ramadan-2021',
      'رمضان 2020':'ramadan-2020','رمضان 2019':'ramadan-2019',
      'أفلام أنيميشن':'anime-movies',
      'مصارعة':'others-wwe','أغاني عربية':'others-songs','برامج تلفزيونية':'others-tv','مسرحيات عربية':'others-plays',
      // ID-based mappings (Stremio sends subcategory ID, not Arabic name)
      'all': catalogId,
      'foreign':'movies-foreign','arabic':'movies-arabic','turkish':'movies-turkish',
      'asian':'movies-asian','indian':'movies-indian','dubbed':'movies-dubbed',
      'classic':'movies-classic','netflix':'movies-netflix',
      'korean':'series-korean','egyptian':'series-egyptian','cartoon':'series-cartoon',
      '2026':'ramadan-2026','2025':'ramadan-2025','2024':'ramadan-2024',
      '2023':'ramadan-2023','2022':'ramadan-2022','2021':'ramadan-2021',
      '2020':'ramadan-2020','2019':'ramadan-2019',
      'movies':'anime-movies',
      'wwe':'others-wwe','songs':'others-songs','tv':'others-tv','plays':'others-plays',
    };
    // Ensure duplicate/conflicting key mappings are resolved properly
    let mappedId = reverseMap[extra.category];
    if (extra.category === 'مسلسلات كرتون' || extra.category === 'series') {
      mappedId = (catalogId === 'anime') ? 'anime-series' : 'series-cartoon';
    } else if (['foreign', 'arabic', 'turkish', 'indian', 'dubbed', 'netflix'].includes(extra.category)) {
      mappedId = (catalogId === 'series' || catalogId === 'movies') ? `${catalogId}-${extra.category}` : reverseMap[extra.category];
    }
    effectiveId = mappedId || catalogId;
  }

  const isSeriesCat = effectiveId.startsWith('series') || effectiveId.startsWith('ramadan') || effectiveId === 'anime-series';

  // ── Genre filter — use the right API per catalog type ──────────────────
  if (extra.genre) {
    if (!GENRE_URLS[extra.genre]) {
      return { items: [], hasNextPage: false };
    }
    // For series catalogs: use term__posts(type=series) to get clean series overviews
    // (the genre page direct-fetch returns 97% episodes)
    if (isSeriesCat) {
      const genreUrl = buildCatalogUrlFromGenre(extra.genre, page);
      if (genreUrl) {
        const seriesResult = await loadSeriesView(genreUrl);
        if (seriesResult) {
          return { items: filterCardsByType(seriesResult.items, extra.type || 'series'), hasNextPage: seriesResult.hasNextPage };
        }
      }
    }
    // For movie catalogs: fetch genre page and filter to movies
    const url = buildCatalogUrlFromGenre(extra.genre, page);
    if (!url) return { items: [], hasNextPage: false };
    const html = await fetchPage(url, BASE_URL, plain({ noCache: true }));
    if (!html) return { items: [], hasNextPage: false };
    const $genre = cheerio.load(html);
    const items = parseCards($genre, `genre: ${extra.genre}`);
    return {
      items: filterCardsByType(items, extra.type || 'movie'),
      hasNextPage: !!$genre(SELECTORS.nextPage).length,
    };
  }

  // ── Series catalogs: use AJAX term__posts for series view ────────────
  if (isSeriesCat) {
    const catalogUrl = buildCatalogUrl(effectiveId, page);
    if (!catalogUrl) return { items: [], hasNextPage: false };
    const seriesResult = await loadSeriesView(catalogUrl);
    if (seriesResult && seriesResult.items.length > 0) return { items: filterCardsByType(seriesResult.items, 'series'), hasNextPage: seriesResult.hasNextPage };
    // Fallback: fetch page directly (works when term__posts returns empty for parent category pages)
    const html = await fetchPage(catalogUrl, BASE_URL, plain());
    if (!html) return { items: [], hasNextPage: false };
    const $fallback = cheerio.load(html);
    return { items: filterCardsByType(parseCards($fallback, effectiveId), 'series'), hasNextPage: !!$fallback(SELECTORS.nextPage).length };
  }

  // ── Movie and other catalogs: fetch page directly ────────────────────
  const url = buildCatalogUrl(effectiveId, page);
  if (!url) return { items: [], hasNextPage: false };

  const html = await fetchPage(url, BASE_URL, plain({ noCache: true }));
  if (!html) return { items: [], hasNextPage: false };

  const $ = cheerio.load(html);

  // Determine catalog name for logging
  const catEntry = Object.entries(CATALOG_URLS).find(([k, v]) => k === effectiveId);
  const catName = catEntry ? effectiveId : catalogId;

  return {
    items:       parseCards($, catName),
    hasNextPage: !!$(SELECTORS.nextPage).length,
  };
}

/**
 * Search for content by query.
 * Uses the find__posts AJAX endpoint since the /find/ page
 * loads results dynamically via JavaScript.
 * @param   {string} query - Search term
 * @returns {Array<{id: string, title: string, thumb: string, url: string}>}
 */
async function search(query, opts = {}) {
  if (!csrfToken) await refreshCsrfToken();
  const searchType = opts.type || ''; // empty=all, movies, series
  const typeParam = searchType ? `&type=${encodeURIComponent(searchType)}` : '';

  try {
    // Try AJAX live-search endpoint first (with type parameter)
    const resp = await ajaxClient.post(`${BASE_URL}/find__posts/`,
      new URLSearchParams({
        search: query,
        search_type: searchType,
        csrf_token: csrfToken || '',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const ajaxData = resp.data;
    if (ajaxData?.type === 'success' && ajaxData.html) {
      const $ = cheerio.load(ajaxData.html);
      const items = parseCards($, `search: "${query}"`);
      if (items.length > 0) return items;
    }
  } catch (_) {}

  // Fallback: fetch the /find/ page directly (no cache)
  const url = `${BASE_URL}/find/?word=${encodeURIComponent(query)}${typeParam}`;
  const html = await fetchPage(url, BASE_URL, plain({ noCache: true }));
  if (!html) return [];
  const items = parseCards(cheerio.load(html), `search: "${query}"${searchType ? ' type='+searchType : ''}`);
  if (items.length > 0) return items;

  // Last resort: scan all links on the page
  const $ = cheerio.load(html);
  const altItems = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!href || (!href.startsWith('http') && !href.startsWith('/'))) return;
    const fullUrl = href.startsWith('http') ? href : resolve(href);
    if (!fullUrl.includes(BASE_URL)) return;
    const title = $(el).attr('title') || $(el).find('h3').first().text().trim() || '';
    if (!title || title.length < 5) return;
    const thumb = $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('src') || '';
    altItems.push({ id: mkId(fullUrl), title, thumb: resolve(thumb), url: fullUrl, quality: '' });
  });
  const seen = new Set();
  const unique = altItems.filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; });
  console.log(`[ArabSeed] search fallback → ${unique.length} items`);
  return unique.slice(0, 50);
}

/**
 * Fetch detailed metadata for a movie or series.
 * The encodedId is a base64url-encoded relative URL.
 *
 * @param   {string} encodedId - Base64url-encoded relative URL
 * @returns {object|null} {
 *   title, thumb, description, genres: string[],
 *   episodeLinks: [{ id, href, title, epNum, seasonNum }]  // only for series
 * }
 */
async function getMeta(encodedId) {
  if (!csrfToken) await refreshCsrfToken();
  const url  = toUrl(encodedId);
  if (!url) return null;

  // Seed cookies by fetching the page through ajaxClient first
  let html = null;
  try {
    const resp = await ajaxClient.get(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
        'Referer': BASE_URL + '/',
      },
    });
    html = resp.data;
  } catch (_) {}
  if (!html) html = await fetchPage(url, BASE_URL, plain());

  if (!html) return null;

  const $ = cheerio.load(html);

  const title = $(SELECTORS.metaTitle).first().text().trim();
  if (!title) return null;
  const $poster = $(SELECTORS.metaPoster).first();
  const thumb = $poster.attr('data-src') || $poster.attr('src') || '';
  const description = (
    $(SELECTORS.metaDesc).first().text()
    || $('meta[name="description"]').attr('content')
    || ''
  ).trim();

  // Parse genres from the page
  const genres = [];
  const seenGenres = new Set();
  $('.__genre').each((_, el) => {
    const g = $(el).text().trim();
    if (g && !seenGenres.has(g)) { seenGenres.add(g); genres.push(g); }
  });

  // If it's a movie, return no episodes
  if (isMovieUrl(url)) {
    return { title, thumb, description, genres };
  }

  // ─── Series: extract seasons and episode links ───────────────────────────
  const seasonElements = $(SELECTORS.seasonList).toArray();
  const episodeLinks = [];

  // Try static episode list first
  $('ul.movie__blocks__ul a.episode__item, ul.movie__blocks__ul a.movie__block.is__episode').each((i, el) => {
    const $a   = $(el);
    const href = $a.attr('href') || '';
    const epTitle = ($a.find('.episode__title').text() || $a.find('.post__info h3').text() || '').trim();
    if (!href) return;
    episodeLinks.push({
      id:        mkId(resolve(href)),
      href:      resolve(href),
      title:     epTitle || `الحلقة ${i + 1}`,
      epNum:     i + 1,
      seasonNum: 1,
    });
  });

  // If no static episodes, try AJAX-loading from seasons
  if (episodeLinks.length === 0 && seasonElements.length > 0) {
    const csrfMatch = html.match(/csrf__token["'"]?\s*[:=]\s*["'"]([^"']+)["'"]/);
    const pageCsrfToken = csrfMatch ? csrfMatch[1] : null;

    for (const seasonEl of seasonElements) {
      const $sEl  = $(seasonEl);
      const seasonId = $sEl.attr('data-term') || '';
      const seasonName = $sEl.text().trim();
      const seasonNum = parseInt(seasonName.match(/\d+/)?.[0]) || 1;

      if (!seasonId) continue;

      try {
        const ajaxResp = await ajaxClient.post(`${BASE_URL}/season__episodes/`,
          new URLSearchParams({
            season_id: seasonId,
            csrf_token: pageCsrfToken || csrfToken || '',
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Referer': url,
            },
          }
        );

        const ajaxData = ajaxResp.data;
        if (ajaxData?.type === 'success' && ajaxData.html) {
          const $$ = cheerio.load(ajaxData.html);
          $$('a[href]').each((i, el) => {
            const href = $(el).attr('href') || '';
            if (!href) return;
            const epNum = (href.match(/eps(\d+)/i) || [null, String(i + 1)])[1];
            episodeLinks.push({
              id:        mkId(resolve(href)),
              href:      resolve(href),
              title:     `الموسم ${seasonNum} - الحلقة ${epNum}`,
              epNum:     parseInt(epNum) || (i + 1),
              seasonNum,
            });
          });
        }
      } catch (err) {
        console.log(`[ArabSeed] Season AJAX failed for ${seasonId}: ${err.message}`);
      }
    }
  }

  // ─── Fallback: extract season_id from object__info (anime selary pages) ──
  // Anime pages like One Piece don't have #seasons__list but have object__info.term_id
  if (episodeLinks.length === 0) {
    const objMatch = html.match(/object__info\s*=\s*\{[^}]*term_id:\s*(\d+)/);
    const objTermId = objMatch ? objMatch[1] : null;
    if (objTermId) {
      try {
        const resp = await ajaxClient.post(`${BASE_URL}/season__episodes/`,
          new URLSearchParams({ season_id: objTermId, csrf_token: csrfToken || '', offset: '0' }).toString(),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url } }
        );
        const d = resp.data;
        if (d?.type === 'success' && d.html) {
          const $$ = cheerio.load(d.html);
          $$('a[href]').each((i, el) => {
            const href = $$(el).attr('href') || '';
            if (!href) return;
            const epNumText = $$(el).find('.epi__num b').first().text().trim();
            const epNum = parseFloat(epNumText) || (i + 1);
            const title = `الحلقة ${epNum}`;
            episodeLinks.push({
              id: mkId(resolve(href)),
              href: resolve(href),
              title,
              epNum,
              seasonNum: 1,
            });
          });
          console.log(`[ArabSeed] object__info season ${objTermId} → ${episodeLinks.length} episodes`);
          // If hasmore, fetch more pages until exhausted
          if (d.hasmore && episodeLinks.length > 0) {
            let offset = episodeLinks.length;
            let safety = 0;
            while (d.hasmore) {
              safety++;
              if (safety >= 50) {
                console.warn('[ArabSeed] getMeta safety limit reached, breaking loop');
                break;
              }
              const prevOffset = offset;
              try {
                const r2 = await ajaxClient.post(`${BASE_URL}/season__episodes/`,
                  new URLSearchParams({ season_id: objTermId, csrf_token: csrfToken || '', offset: String(offset) }).toString(),
                  { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': url } }
                );
                if (r2.data?.type === 'success' && r2.data.html) {
                  const $$$ = cheerio.load(r2.data.html);
                  $$$('a[href]').each((i, el) => {
                    const href = $$$(el).attr('href') || '';
                    if (!href) return;
                    // Extract real episode number from epi__num b
                    const epNumText = $$$(el).find('.epi__num b').first().text().trim();
                    const epNum = parseFloat(epNumText) || (episodeLinks.length + 1);
                    const title = `الحلقة ${epNum}`;
                    episodeLinks.push({
                      id: mkId(resolve(href)),
                      href: resolve(href),
                      title,
                      epNum,
                      seasonNum: 1,
                    });
                  });
                  offset = episodeLinks.length;
                  d.hasmore = r2.data.hasmore;
                } else break;
              } catch (_) { break; }
              if (offset === prevOffset) {
                console.warn('[ArabSeed] getMeta offset did not increase, breaking loop');
                break;
              }
            }
            console.log(`[ArabSeed] object__info total after pagination → ${episodeLinks.length} episodes`);
            // Sort ascending by episode number, then chunk into groups of 100
            episodeLinks.sort((a, b) => (a.epNum || 0) - (b.epNum || 0));
            // If single season (> 0 episodes), group into chunks of 100
            const CHUNK_SIZE = 100;
            const hasSeasons = seasonElements.length > 1; // true if selary has multiple seasons
            if (!hasSeasons && episodeLinks.length > CHUNK_SIZE) {
              for (let i = 0; i < episodeLinks.length; i++) {
                episodeLinks[i].seasonNum = Math.floor(i / CHUNK_SIZE) + 1;
                episodeLinks[i].title = `S${episodeLinks[i].seasonNum} - ${episodeLinks[i].title}`;
              }
              console.log(`[ArabSeed] chunked ${episodeLinks.length} eps into ${Math.ceil(episodeLinks.length / CHUNK_SIZE)} groups of ${CHUNK_SIZE}`);
            }
          }
        }
      } catch (err) {
        console.log(`[ArabSeed] object__info season AJAX failed: ${err.message}`);
      }
    }
  }

  // ─── Fallback: anime selary pages (no #seasons__list, AJAX sliders) ──
  // Scan episode links directly from the page
  if (episodeLinks.length === 0) {
    const seenEp = new Set();
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (!href.includes(BASE_URL) && !href.startsWith('/')) return;
      const fullUrl = resolve(href);
      const decoded = decodeURIComponent(fullUrl);
      const isEpisode = decoded.includes('مسلسل') && (decoded.includes('الحلقة') || /-s\d+-eps\d+/i.test(decoded));
      if (!isEpisode || seenEp.has(fullUrl)) return;
      const epTitle = $(el).attr('title') || $(el).find('h3').first().text().trim() || '';
      if (!epTitle || epTitle.length < 3) return;
      seenEp.add(fullUrl);
      let seasonNum = 1, epNum = i + 1;
      const sM = decoded.match(/-s(\d+)-/i);
      const epM = decoded.match(/-eps(\d+)/i);
      const arM = decoded.match(/الحلقة\s*(\d+)/);
      if (sM) seasonNum = parseInt(sM[1]);
      if (epM) epNum = parseInt(epM[1]);
      else if (arM) epNum = parseInt(arM[1]);
      episodeLinks.push({ id: mkId(fullUrl), href: fullUrl, title: epTitle, epNum, seasonNum });
    });
    if (episodeLinks.length) console.log(`[ArabSeed] fallback scan → ${episodeLinks.length} episodes`);
  }

  return { title, thumb, description, genres, episodeLinks };
}

/**
 * Fetch available streams for a movie or episode.
 * The encodedId is a base64url-encoded relative path to the watch page.
 *
 * Fetches the watch page ({url}/watch/), extracts the iframe embed URL
 * from play.php?url=base64, decodes it, and returns the stream.
 *
 * @param   {string} encodedId - Base64url-encoded movie/episode URL
 * @returns {Array<{ url: string, label: string, isEmbed: boolean, quality: string, providerId: string|null }>}
 */
async function getStreams(encodedId) {
  const url = toUrl(encodedId);
  if (!url) return [];
  console.log(`[ArabSeed] getStreams ${url}`);

  const watchUrl = url.replace(/\/$/, '') + '/watch/';
  const html = await fetchPage(watchUrl, url, plain({ noCache: true }));
  if (!html) return [];

  const $ = cheerio.load(html);
  const streams = [];
  const seen = new Set();

  function addStream(rawUrl, label, quality, providerId) {
    const u = rawUrl.startsWith('http') ? rawUrl : resolve(rawUrl);
    if (!u || seen.has(u) || u.includes('[object]')) return;
    seen.add(u);

    const isEmbed = !providerId || providerId === 'none';
    let emoji = '🔍';
    if (providerId && knownProviders[providerId] === 'direct') emoji = '✅';
    else if (providerId && knownProviders[providerId] === 'embed') emoji = '🔵';
    else if (providerId) emoji = '🔍';

    streams.push({
      url:        u,
      label:      `${emoji} ${label} - ${quality}`,
      isEmbed,
      quality,
      providerId,
    });
    console.log(`  [Stream] ${emoji} ${label} → ${providerId || 'unknown'} → ${u.substring(0, 80)}`);
  }

  // ─── Quality info from the page ──────────────────────────────────────────
  // The page has quality tabs: 480p, 720p, 1080p with default active
  let currentQuality = 'Auto';
  const activeQuality = $(`${SELECTORS.watchQuality}.active`).first();
  if (activeQuality.length) {
    currentQuality = activeQuality.attr('data-quality') || 'Auto';
  }

  // Find all available quality tabs and the post_id for quality switching
  const qualityTabs = $(SELECTORS.watchQuality).toArray();
  const postId = $(SELECTORS.watchDataLinks).first().attr('data-post') || '';

  // ─── Parse ALL server/stream links from <li data-link> elements ──────────
  // Each <li data-link="..."> contains an embed/proxy URL, plus the server name
  // data-link URLs may be:
  //   - /play.php?url={base64}   → base64 decode
  //   - /play/?id={base64}       → base64 decode
  //   - Direct http URL          → as-is
  const linkElements = $(SELECTORS.watchDataLinks).toArray();

  for (const el of linkElements) {
    const $el  = $(el);
    const link = $el.attr('data-link') || '';
    const name = $el.find('span').text().trim() || 'غير معروف';

    if (!link) continue;

    const decodedUrl = decodeEmbedUrl(link);
    if (!decodedUrl) continue;

    const providerId = getProviderId(decodedUrl);

    // Check data-qu attribute first (direct quality indicator on server elements)
    let resolvedQuality = $el.attr('data-qu') || $el.attr('data-quality') || $el.attr('quality');

    if (!resolvedQuality) {
      $el.parents().each((_, parent) => {
        const $parent = $(parent);
        const pq = $parent.attr('data-quality') || $parent.attr('quality');
        if (pq && !resolvedQuality) {
          resolvedQuality = pq;
        }
      });
    }

    const extractQualityFromString = (str) => {
      if (!str) return null;
      const match = str.match(/(\d{3,4}p|4k)/i);
      return match ? match[0] : null;
    };

    if (!resolvedQuality) {
      const elClass = $el.attr('class') || '';
      const elId = $el.attr('id') || '';
      resolvedQuality = extractQualityFromString(elClass) || extractQualityFromString(elId);
    }

    if (!resolvedQuality) {
      $el.parents().each((_, parent) => {
        const $parent = $(parent);
        const pClass = $parent.attr('class') || '';
        const pId = $parent.attr('id') || '';
        const q = extractQualityFromString(pClass) || extractQualityFromString(pId);
        if (q && !resolvedQuality) {
          resolvedQuality = q;
        }
      });
    }

    // Format quality: add "p" suffix if numeric
    resolvedQuality = resolvedQuality || currentQuality;
    if (/^\d{3,4}$/.test(resolvedQuality)) resolvedQuality += 'p';

    addStream(decodedUrl, name, resolvedQuality, providerId);
  }

  // ─── Fetch all qualities from API (each quality has multiple servers) ─────
  // The page only renders the default quality's servers with data-link.
  // For all qualities, we call get__quality__servers to list servers,
  // then get__watch__server to get each server's embed URL.
  if (postId && qualityTabs.length > 0) {
    for (const tab of qualityTabs) {
      const $tab = $(tab);
      const qVal = $tab.attr('data-quality') || '';
      if (!qVal) continue;

      // Skip the default quality if we already got data-links from the page
      const isDefault = String(qVal) === String(currentQuality);
      if (isDefault && streams.length > 0) continue;

      console.log(`[ArabSeed] Fetching quality ${qVal}p servers`);
      try {
        const qForm = new URLSearchParams({
          post_id: postId,
          quality: qVal,
          csrf_token: csrfToken || '',
        });
        const qResp = await ajaxClient.post(`${BASE_URL}/get__quality__servers/`, qForm.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const qData = qResp.data;
        if (qData?.type !== 'success') continue;

        // Parse the server list HTML for data-server indices
        const $q = cheerio.load(qData.html || '');
        const serverEls = $q('li[data-server]').toArray();
        const serverNames = [];
        const serverIndices = [];
        for (const el of serverEls) {
          const $el = $q(el);
          const idx = $el.attr('data-server');
          const name = $el.find('span').text().trim() || `سيرفر ${idx}`;
          if (idx !== undefined && !serverIndices.includes(idx)) {
            serverIndices.push(idx);
            serverNames.push(name);
          }
        }

        // If no server elements in html, fallback to the top-level server field
        if (serverIndices.length === 0 && qData.server) {
          const providerId = getProviderId(qData.server);
          addStream(qData.server, 'سيرفر عرب سيد', `${qVal}p`, providerId);
          continue;
        }

        // Fetch each server's embed URL via get__watch__server
        for (let si = 0; si < serverIndices.length; si++) {
          const idx = serverIndices[si];
          const name = serverNames[si] || `سيرفر ${idx}`;
          try {
            const wForm = new URLSearchParams({
              post_id: postId,
              quality: qVal,
              server: idx,
              csrf_token: csrfToken || '',
            });
            const wResp = await ajaxClient.post(`${BASE_URL}/get__watch__server/`, wForm.toString(), {
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            });
            const wData = wResp.data;
            if (wData?.type === 'success' && wData.server) {
              const providerId = getProviderId(wData.server);
              addStream(wData.server, name, `${qVal}p`, providerId);
            }
          } catch (err) {
            console.log(`[ArabSeed] server ${idx} fetch failed: ${err.message}`);
          }
        }
      } catch (err) {
        console.log(`[ArabSeed] quality ${qVal}p fetch failed: ${err.message}`);
      }
    }
  }

  // ─── Fallback: iframe on the page (when data-link elements are absent) ───
  if (streams.length === 0) {
    $('iframe[src]:not([src=""]):not([src="about:blank"]):not(#video_frame)').each((i, el) => {
      const src = $(el).attr('src') || '';
      if (src.startsWith('http')) {
        const providerId = getProviderId(src);
        addStream(src, `مشغل ${i + 1}`, 'Auto', providerId);
      }
    });
  }

  // ─── Add "Open in browser" fallback ──────────────────────────────────────
  streams.push({
    url:        url,
    label:      '🌐 فتح في المتصفح',
    isEmbed:    true,
    quality:    '—',
    providerId: null,
  });

  console.log(`[ArabSeed] ${streams.length} stream(s) returned`);
  return streams;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  SITE_ID,
  SITE_NAME,
  SITE_LOGO,
  SITE_BASE_URL,
  NEEDS_FLARESOLVERR,
  SEARCH_ENABLED,
  PROXY_IMAGES, PROXY_STREAMS,
  CATALOGS: [], // Catalogs are defined in meta.json
  EXTRA_SUPPORTED,
  GENRES: Object.keys(GENRE_URLS),
  TYPES,
  getCatalog,
  search,
  getMeta,
  getStreams,
};
