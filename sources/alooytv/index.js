/**
 * Scraper: AlooYTV / JoooTV
 * URL: https://n.alooytv13.xyz
 * CF: NO — plain HTTP
 */
const cheerio = require('cheerio');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

const BASE_URL = 'https://n.alooytv13.xyz';

const SITE_ID            = 'alooytv';
const SITE_NAME          = 'AlooYTV';
const SITE_LOGO          = `${BASE_URL}/uploads/system_logo/favicon.ico`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = false;

// ─── Filters ──────────────────────────────────────────────────────────────────
const EXTRA_SUPPORTED = [];

const GENRES = ['عربي', 'خليجي', 'تركي', 'كوري', 'أجنبي', 'أنمي'];

const GENRE_CATALOG_MAP = {
  'عربي':  'arabic',
  'خليجي': 'kleeji',
  'تركي':  'turki',
  'كوري':  'korean',
  'أجنبي': 'foreign',
  'أنمي':  'anime',
};

const CATALOGS = [
  { id: 'all',     name: 'الكل',   url: `${BASE_URL}/tv-series.html`              },
  { id: 'arabic',  name: 'عربي',   url: `${BASE_URL}/genre/arabic.html`           },
  { id: 'kleeji',  name: 'خليجي',  url: `${BASE_URL}/genre/kleeji.html`           },
  { id: 'turki',   name: 'تركي',   url: `${BASE_URL}/genre/turki.html`            },
  { id: 'korean',  name: 'كوري',   url: `${BASE_URL}/genre/Korean-series.html`    },
  { id: 'foreign', name: 'أجنبي',  url: `${BASE_URL}/genre/Foreign-series.html`   },
  { id: 'anime',   name: 'أنمي',   url: `${BASE_URL}/genre/anmi.html`             },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const fs      = (opts = {}) => ({ ...opts, useFS: NEEDS_FLARESOLVERR });

// ─── Card parser ──────────────────────────────────────────────────────────────
function parseCards($, label = '') {
  const items = [], seen = new Set();

  $('.latest-movie-img-container').each((_, el) => {
    const $el  = $(el);
    const $a   = $el.find('a[href*="/watch/"]').first();
    const href = $a.attr('href') || '';
    if (!href || seen.has(href)) return;

    const $img  = $el.find('img').first();
    const thumb = $img.attr('data-src') || $img.attr('src') || '';
    const title = ($el.find('.movie-title h3').text() || $a.attr('title') || '').trim();
    if (!title || title.length < 2) return;

    const fullUrl = resolve(href).split('?')[0];
    seen.add(href);
    items.push({ id: mkId(fullUrl), title, thumb: resolve(thumb), url: fullUrl });
  });

  // Fallback
  if (items.length === 0) {
    $('a[href*="/watch/"]').each((_, el) => {
      const href = ($(el).attr('href') || '').split('?')[0];
      if (!href || seen.has(href)) return;
      const title = ($(el).text() || '').trim();
      if (!title || title.length < 2) return;
      const fullUrl = resolve(href);
      seen.add(href);
      items.push({ id: mkId(fullUrl), title, thumb: '', url: fullUrl });
    });
  }

  if (label) console.log(`[AlooYTV] ${label} -> ${items.length} items`);
  return items;
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function getCatalog(catalogId, page = 1, extra = {}) {
  // Genre filter overrides catalog selection
  const resolvedCatId = extra.genre ? (GENRE_CATALOG_MAP[extra.genre] || catalogId) : catalogId;
  const cat = CATALOGS.find(c => c.id === resolvedCatId) || CATALOGS[0];

  // Site pagination: page 2 = offset 50 in URL
  const url = page <= 1 ? cat.url : cat.url.replace(/\.html$/, '') + '/50.html';

  console.log(`[AlooYTV] getCatalog "${resolvedCatId}" page=${page} -> ${url}`);
  const html = await fetchPage(url, BASE_URL, fs());
  if (!html) return { items: [], hasNextPage: false };

  const $    = cheerio.load(html);
  const items = parseCards($, `getCatalog:${resolvedCatId}`);
  const hasNextPage = page === 1;
  return { items, hasNextPage };
}

async function search(query) {
  const url  = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  console.log(`[AlooYTV] search "${query}"`);
  const html = await fetchPage(url, BASE_URL, fs());
  if (!html) return [];
  return parseCards(cheerio.load(html), `search:"${query}"`);
}

async function getMeta(encodedId) {
  const url  = toUrl(encodedId);
  console.log(`[AlooYTV] getMeta ${url}`);
  const html = await fetchPage(url, BASE_URL, fs());
  if (!html) return null;
  const $    = cheerio.load(html);

  const title       = ($('h1').first().text() || $('meta[property="og:title"]').attr('content') || '').trim();
  const thumb       = resolve($('meta[property="og:image"]').attr('content') || '');
  const description = ($('meta[name="description"]').attr('content') || '').trim();
  const genres      = [];
  $('a[href*="/genre/"]').each((_, el) => {
    const g = $(el).text().trim();
    if (g && !genres.includes(g)) genres.push(g);
  });

  const episodeLinks = [];
  const epSeen = new Set();

  // Season-aware episode parsing
  $('.season').each((sIdx, seasonEl) => {
    $(seasonEl).find('a.btn-ep, a.btn-inline[href*="/watch/"]').each((_, epEl) => {
      const href = $(epEl).attr('href') || '';
      if (!href || epSeen.has(href)) return;
      epSeen.add(href);
      const epText  = $(epEl).text().trim();
      const epNum   = parseInt((epText.match(/\d+/) || [])[0]) || episodeLinks.length + 1;
      const fullUrl = resolve(href);
      episodeLinks.push({ id: mkId(fullUrl), href: fullUrl, title: `الحلقة ${epNum}`, epNum, seasonNum: sIdx + 1 });
    });
  });

  // Fallback: flat episode list
  if (episodeLinks.length === 0) {
    $('a.btn-ep, a[href*="/watch/"][class*="btn"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      if (!href || epSeen.has(href)) return;
      epSeen.add(href);
      const epNum   = parseInt(($(el).text().match(/\d+/) || [])[0]) || episodeLinks.length + 1;
      const fullUrl = resolve(href);
      episodeLinks.push({ id: mkId(fullUrl), href: fullUrl, title: `الحلقة ${epNum}`, epNum, seasonNum: 1 });
    });
  }

  console.log(`[AlooYTV] getMeta -> title="${title}" episodes=${episodeLinks.length}`);
  return { title, thumb, description, genres, episodeLinks };
}

// ─── Provider mapping (so streams get resolved through proxy, not opened as external URLs) ──
const PROVIDER_MAP = {
  'mp4upload.com': 'mp4upload', 'dailymotion.com': 'dailymotion',
  'ok.ru': 'okru', 'videa.hu': 'videa', 'voe.sx': 'voe', 'voe.sh': 'voe',
  'uqload.is': 'uqload', 'uqload.io': 'uqload', 'dsvplay.com': 'dsvplay',
  'streamwish.to': 'streamwish', 'krakenfiles.com': 'krakenfiles',
  'lulustream.com': 'lulustream', 'luluvdo.com': 'lulustream',
  'doodstream.com': 'doodstream', 'dood.to': 'doodstream',
  'mixdrop.ag': 'mixdrop', 'mixdrop.to': 'mixdrop', 'mixdrop.co': 'mixdrop',
  'rubyvidhub.com': 'rubyvidhub', 'mega.nz': 'mega',
  'playmogo.com': 'doodstream', 'mp4upload.com': 'mp4upload',
};

function getProviderFromUrl(u) {
  try {
    const host = new URL(u).hostname.replace(/^www\./, '');
    return PROVIDER_MAP[host] || null;
  } catch { return null; }
}

async function getStreams(encodedId) {
  const url  = toUrl(encodedId);
  console.log(`[AlooYTV] getStreams ${url}`);
  const html = await fetchPage(url, BASE_URL, fs({ noCache: true }));
  if (!html) return [];
  const $    = cheerio.load(html);
  const streams = [], seen = new Set();

  function add(rawUrl, label, isEmbed = false) {
    const u = resolve(rawUrl);
    if (!u || seen.has(u) || u.match(/\.(jpg|png|gif|css|js)(\?|$)/i)) return;
    seen.add(u);
    const providerId = isEmbed ? getProviderFromUrl(u) : 'direct';
    streams.push({ url: u, label, isEmbed, providerId });
    console.log(`  [Stream] ${isEmbed ? 'embed' : 'direct'} "${label}" -> ${u} (provider: ${providerId || 'none'})`);
  }

  // Direct video sources
  $('video source[src]').each((i, el) => {
    if ($(el).attr('type') !== 'video/webm') add($(el).attr('src') || '', `مصدر ${i + 1}`);
  });
  $('video[src]').each((i, el) => add($(el).attr('src') || '', `فيديو ${i + 1}`));

  // MP4/M3U8 in inline scripts
  $('script').each((_, el) => {
    const src = $(el).html() || '';
    [...src.matchAll(/["'`](https?:\/\/[^"'`\s]+\.(?:mp4|m3u8)[^"'`\s]*)["'`]/g)]
      .forEach((m, i) => add(m[1], `JS ${i + 1}`));
  });

  // iframes — detect provider so they get resolved through proxy
  $('iframe[src]:not([src=""]):not([src="about:blank"])').each((i, el) =>
    add($(el).attr('src') || '', `مشغل ${i + 1}`, true));

  console.log(`[AlooYTV] ${streams.length} stream(s) found (${streams.filter(s => s.providerId).length} with providerId)`);
  return streams;
}

module.exports = {
  SITE_ID, SITE_NAME, SITE_LOGO, SITE_BASE_URL,
  NEEDS_FLARESOLVERR, SEARCH_ENABLED, PROXY_IMAGES,
  CATALOGS, EXTRA_SUPPORTED, GENRES,
  getCatalog, search, getMeta, getStreams,
};
