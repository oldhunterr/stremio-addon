/**
 * Scraper: AnimeBlkom | أنمي بالكوم
 * URL: https://animeblkom.net
 * CF: YES — requires FlareSolverr
 *
 * Uses data-src attribute for server links (not data-embed).
 * Streams are embedded directly in the embed page's <video source[src]> tags.
 * No providerId set — video URLs are direct from the embed page.
 */
const cheerio = require('cheerio');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

const BASE_URL = 'https://www.animeblkom.com';

const SITE_ID            = 'animeblkom';
const SITE_NAME          = 'أنمي بالكوم';
const SITE_LOGO          = `${BASE_URL}/favicon.ico`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = true;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = true;

// ─── Filters ──────────────────────────────────────────────────────────────────
const GENRES = [
  'أكشن','مغامرة','كوميدي','دراما','خيال','رعب','سحر','ميكا','عسكري',
  'موسيقى','غموض','نفسي','رومانسي','مدرسي','خيال علمي','سينين','شوجو',
  'شونين','شريحة من الحياة','رياضي','قوى خارقة','خارق للطبيعة','إثارة',
  'مصاصي دماء','تاريخي','أطفال','حريم','سيارات','فضاء','ساموراي',
  'فنون قتالية','ساخر','شياطين','جوسي','لعبة',
];

const GENRE_SLUGS = {
  'أكشن':'action','مغامرة':'adventure','كوميدي':'comedy','دراما':'drama',
  'خيال':'fantasy','رعب':'horror','سحر':'magic','ميكا':'mecha','عسكري':'military',
  'موسيقى':'music','غموض':'mystery','نفسي':'psychological','رومانسي':'romance',
  'مدرسي':'school','خيال علمي':'sci-fi','سينين':'seinen','شوجو':'shoujo',
  'شونين':'shounen','شريحة من الحياة':'slice-of-life','رياضي':'sports',
  'قوى خارقة':'super-power','خارق للطبيعة':'supernatural','إثارة':'thriller',
  'مصاصي دماء':'vampire','تاريخي':'historical','أطفال':'kids','حريم':'harem',
  'سيارات':'cars','فضاء':'space','ساموراي':'samurai','فنون قتالية':'martial-arts',
  'ساخر':'parody','شياطين':'demons','جوسي':'josei','لعبة':'game',
};

// Supported extra filter dimensions in Stremio
const EXTRA_SUPPORTED = ['genre'];

const CATALOGS = [
  { id: 'anime',  name: 'أنمي',  url: `${BASE_URL}/anime-list`  },
  { id: 'movies', name: 'أفلام', url: `${BASE_URL}/movie-list`  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const fs      = (opts = {}) => ({ ...opts, useFS: NEEDS_FLARESOLVERR });

function buildUrl(catUrl, page, genre) {
  let url = catUrl;
  if (genre) {
    const slug = GENRE_SLUGS[genre] || genre;
    url += (url.includes('?') ? '&' : '?') + `genres=${slug}`;
  }
  if (page > 1) url += (url.includes('?') ? '&' : '?') + `page=${page}`;
  return url;
}

// ─── Card parser ──────────────────────────────────────────────────────────────
function parseCards($, label = '') {
  const items = [], seen = new Set();

  $('.content').each((_, el) => {
    const $el  = $(el);
    const href = $el.find('.poster a').first().attr('href')
      || $el.find('a[href*="/anime/"], a[href*="/watch/"]').first().attr('href') || '';
    if (!href || seen.has(href)) return;

    const $img  = $el.find('img').first();
    const thumb = $img.attr('data-original') || $img.attr('data-src') || $img.attr('src') || '';
    const title = ($el.find('.name a').first().text() || $el.find('a').first().text() || '').trim();
    if (!title || title.length < 2) return;

    const fullUrl = resolve(href);
    seen.add(href);
    items.push({ id: mkId(fullUrl), title, thumb: resolve(thumb), url: fullUrl });
  });

  if (label) console.log(`[AnimeBlkom] ${label} -> ${items.length} items`);
  return items;
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function getCatalog(catalogId, page = 1, extra = {}) {
  const cat   = CATALOGS.find(c => c.id === catalogId);
  if (!cat) return { items: [], hasNextPage: false };
  const url   = buildUrl(cat.url, page, extra.genre);
  console.log(`[AnimeBlkom] getCatalog "${catalogId}" page=${page} genre="${extra.genre || '-'}" -> ${url}`);
  const html  = await fetchPage(url, BASE_URL, fs());
  if (!html) return { items: [], hasNextPage: false };
  const $     = cheerio.load(html);
  const items = parseCards($, `getCatalog:${catalogId}`);
  return { items, hasNextPage: !!$('a[rel="next"]').length };
}

async function search(query) {
  const url  = `${BASE_URL}/search?query=${encodeURIComponent(query)}`;
  console.log(`[AnimeBlkom] search "${query}"`);
  const html = await fetchPage(url, BASE_URL, fs());
  if (!html) return [];
  return parseCards(cheerio.load(html), `search:"${query}"`);
}

async function getMeta(encodedId) {
  const url  = toUrl(encodedId);
  if (!url) return null;
  console.log(`[AnimeBlkom] getMeta ${url}`);
  const html = await fetchPage(url, BASE_URL, fs());
  if (!html) return null;
  const $    = cheerio.load(html);

  const title = ($('h1.anime-title, .anime-name, h1').first().text() || $('title').text().split('|')[0]).trim();
  if (!title) return null;
  const thumb = resolve(
    $('img.anime-poster').attr('src')
    || $('img.anime-poster').attr('data-original')
    || $('.poster-container img, .anime-info img').first().attr('src')
    || $('img.lazy').first().attr('data-original') || ''
  );
  const description = $('[itemprop="description"], .anime-story, .anime-desc, .story-text').first().text().trim();
  const genres = [];
  $('a[href*="genres="]').each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g)) genres.push(g);
  });

  const episodeLinks = [];
  $('li.episode-link, .episode-link').each((i, el) => {
    const $el  = $(el);
    $el.find('span.badge').remove();
    const href = $el.find('a').first().attr('href') || '';
    if (!href) return;
    const epNum  = parseInt($el.find('span').last().text().trim()) || (i + 1);
    const fullUrl = resolve(href);
    episodeLinks.push({ id: mkId(fullUrl), href: fullUrl, title: `الحلقة ${epNum}`, epNum, seasonNum: 1 });
  });

  const ordered = episodeLinks.reverse();
  console.log(`[AnimeBlkom] getMeta -> title="${title}" episodes=${ordered.length}`);
  return { title, thumb, description, genres, episodeLinks: ordered };
}

async function getStreams(encodedId) {
  const url  = toUrl(encodedId);
  if (!url) return [];
  console.log(`[AnimeBlkom] getStreams ${url}`);
  const html = await fetchPage(url, BASE_URL, fs({ noCache: true }));
  if (!html) return [];
  const $ = cheerio.load(html);
  const streams = [], seen = new Set();

  function add(rawUrl, label, isEmbed = false) {
    if (!rawUrl) return;
    const u = rawUrl.startsWith('http') ? rawUrl : resolve(rawUrl);
    if (!u || seen.has(u) || u.match(/\.(jpg|png|gif|css|js)(\?|$)/i)) return;
    seen.add(u);
    streams.push({ url: u, label, isEmbed });
    console.log(`  [Stream] ${isEmbed ? 'embed' : 'direct'} "${label}" -> ${u}`);
  }

  // Active/first Blkom server embed URL (uses data-src, not data-embed)
  let embedUrl = null;
  $('span.server a[data-src]').each((_, el) => {
    if (embedUrl) return;
    const $a      = $(el);
    const dataSrc = $a.attr('data-src') || '';
    if (!dataSrc) return;
    const isActive = $a.closest('span.server').hasClass('active');
    if (isActive || $a.text().trim().toLowerCase().includes('blkom')) {
      embedUrl = dataSrc.startsWith('http') ? dataSrc : resolve(dataSrc);
    }
  });
  if (!embedUrl) {
    const first = $('span.server a[data-src]').first().attr('data-src') || '';
    if (first) embedUrl = first.startsWith('http') ? first : resolve(first);
  }

  if (!embedUrl) {
    // Fallback: iframes
    $('iframe[src]:not([src=""]):not([src="about:blank"])').each((i, el) => add($(el).attr('src'), `مشغل ${i + 1}`, true));
    console.log(`[AnimeBlkom] No embed URL, found ${streams.length} iframe(s)`);
    return streams;
  }

  // Embed as fallback
  add(embedUrl, 'Blkom - مشغل', true);

  // Fetch embed page and extract direct quality sources from <video source[src]>
  try {
    const embedHtml = await fetchPage(embedUrl, BASE_URL, fs({ noCache: true }));
    if (embedHtml) {
      const $e = cheerio.load(embedHtml);
      $e('video source[src]').each((_, el) => {
        const src   = $e(el).attr('src') || '';
        const label = $e(el).attr('label') || ($e(el).attr('res') ? `${$e(el).attr('res')}p` : 'MP4');
        if (src) add(src, `Blkom - ${label}`, false);
      });
      const videoSrc = $e('video').first().attr('src') || '';
      if (videoSrc) {
        const q = (videoSrc.match(/\/(\d+p)\.mp4/) || [])[1] || 'Default';
        add(videoSrc, `Blkom - ${q}`, false);
      }
    }
  } catch (err) {
    console.error(`[AnimeBlkom] Embed fetch failed: ${err.message}`);
  }

  // Sort: direct streams by quality desc, embed last
  const embed   = streams.filter(s => s.isEmbed);
  const direct  = streams
    .filter(s => !s.isEmbed)
    .sort((a, b) => {
      const ra = parseInt((a.label.match(/(\d+)p/) || [])[1] || 0);
      const rb = parseInt((b.label.match(/(\d+)p/) || [])[1] || 0);
      return rb - ra;
    });

  const labelsSeen = new Set();
  const unique = [];
  for (const s of [...direct, ...embed]) {
    if (!labelsSeen.has(s.label)) { labelsSeen.add(s.label); unique.push(s); }
  }

  console.log(`[AnimeBlkom] ${unique.length} stream(s) total`);
  return unique;
}

module.exports = {
  SITE_ID, SITE_NAME, SITE_LOGO, SITE_BASE_URL,
  NEEDS_FLARESOLVERR, SEARCH_ENABLED, PROXY_IMAGES,
  CATALOGS, EXTRA_SUPPORTED, GENRES,
  getCatalog, search, getMeta, getStreams,
};
