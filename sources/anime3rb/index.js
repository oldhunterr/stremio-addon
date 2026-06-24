const cheerio = require('cheerio');
const { fetchPage, makeId, idToUrl, resolveUrl } = require('../../lib/fetch');

const BASE_URL = 'https://anime3rb.com';

const SITE_ID            = 'anime3rb';
const SITE_NAME          = 'Anime3rb';
const SITE_LOGO          = 'https://images.anime3rb.com/images/logo.png';
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = true;
const PROXY_STREAMS      = true;

const EXTRA_SUPPORTED = ['genre', 'age'];

const AGE_RATINGS = [
  { value: 'g-all-ages', label: 'للجميع G' },
  { value: 'pg-children', label: 'للأطفال PG' },
  { value: 'pg-13-teens-13-or-older', label: 'للمراهقين من ١٣ عام PG-13' },
  { value: 'r-17-violence-profanity', label: 'عنف و ألفاظ خارجة R - 17+' },
  { value: 'r-mild-nudity', label: 'عري خفيف R+' },
  { value: 'none', label: '-' },
];

const GENRES = [
  'أكشن','كوميدي','خيال','مغامرة','دراما','شونين','رومانسي','مدرسي',
  'خيال علمي','خارق للطبيعة','سينين','غموض','إيتشي','بطولة راشدين',
  'تاريخي','الحياة اليومية','ميكا','قوى خارقة','حريم','عسكري','رياضي',
  'تشويق','إيسيكاي','شوچو','أساطير','نفسي','رعب','موسيقى','دموي',
  'ساخر','قتالي','فضاء','بوليسي','كيوت','حائز على جوائز','رياضات جماعية',
  'كوميديا حركية','للأطفال','خيال حضري','إياشيكي','عمل','فتاة ساحرة',
  'مصاصي دماء','أنثروبولوجي','ساموراي','تناسخ و إعادة إحياء','سفر عبر الزمن',
  'چوسي','استراتيجي','حب متعدد الأطراف','ثقافة الأوتاكو','أيدول إناث',
  'جريمة منظمة','طعام','ألعاب فيديو','نجاة','فنون استعراضية','سباق',
  'ابتكاري','حب فتيات','عكس حريم','رياضات قتالية','رعاية أطفال',
  'فنون بصرية','ألعاب عالية المخاطر','حالة حب','جانحون','أيدول ذكور',
  'حيوانات أليفة','تنكر في ملابس الجنس الآخر','طبي','حب فتيان',
  'تبديل جنسي سحري','صناعة الترفيه','شريرة','ايروتيكا','تعليمية',
];

const GENRE_SLUGS = {
  'أكشن': 'action', 'كوميدي': 'comedy', 'خيال': 'fantasy', 'مغامرة': 'adventure',
  'دراما': 'drama', 'شونين': 'shounen', 'رومانسي': 'romance', 'مدرسي': 'school',
  'خيال علمي': 'sci-fi', 'خارق للطبيعة': 'supernatural', 'سينين': 'seinen',
  'غموض': 'mystery', 'إيتشي': 'ecchi', 'بطولة راشدين': 'adult-cast',
  'تاريخي': 'historical', 'الحياة اليومية': 'slice-of-life', 'ميكا': 'mecha',
  'قوى خارقة': 'super-power', 'حريم': 'harem', 'عسكري': 'military',
  'رياضي': 'sports', 'تشويق': 'suspense', 'إيسيكاي': 'isekai', 'شوچو': 'shoujo',
  'أساطير': 'mythology', 'نفسي': 'psychological', 'رعب': 'horror',
  'موسيقى': 'music', 'دموي': 'gore', 'ساخر': 'parody', 'قتالي': 'martial-arts',
  'فضاء': 'space', 'بوليسي': 'detective', 'كيوت': 'cgdct',
  'حائز على جوائز': 'award-winning', 'رياضات جماعية': 'team-sports',
  'كوميديا حركية': 'gag-humor', 'للأطفال': 'kids', 'خيال حضري': 'urban-fantasy',
  'إياشيكي': 'iyashikei', 'عمل': 'workplace', 'فتاة ساحرة': 'mahou-shoujo',
  'مصاصي دماء': 'vampire', 'أنثروبولوجي': 'anthropomorphic', 'ساموراي': 'samurai',
  'تناسخ و إعادة إحياء': 'reincarnation', 'سفر عبر الزمن': 'time-travel',
  'چوسي': 'josei', 'استراتيجي': 'strategy-game', 'حب متعدد الأطراف': 'love-polygon',
  'ثقافة الأوتاكو': 'otaku-culture', 'أيدول إناث': 'idols-female',
  'جريمة منظمة': 'organized-crime', 'طعام': 'gourmet', 'ألعاب فيديو': 'video-game',
  'نجاة': 'survival', 'فنون استعراضية': 'performing-arts', 'سباق': 'racing',
  'ابتكاري': 'avant-garde', 'حب فتيات': 'girls-love', 'عكس حريم': 'reverse-harem',
  'رياضات قتالية': 'combat-sports', 'رعاية أطفال': 'childcare',
  'فنون بصرية': 'visual-arts', 'ألعاب عالية المخاطر': 'high-stakes-game',
  'حالة حب': 'love-status-quo', 'جانحون': 'delinquents', 'أيدول ذكور': 'idols-male',
  'حيوانات أليفة': 'pets', 'تنكر في ملابس الجنس الآخر': 'crossdressing',
  'طبي': 'medical', 'حب فتيان': 'boys-love', 'تبديل جنسي سحري': 'magical-sex-shift',
  'صناعة الترفيه': 'showbiz', 'شريرة': 'villainess', 'ايروتيكا': 'erotica',
  'تعليمية': 'educational',
};

const CATALOGS = [
  { id: 'all',      name: 'الكل',         url: `${BASE_URL}/titles/list` },
  { id: 'tv',       name: 'مسلسلات',      url: `${BASE_URL}/titles/list/tv` },
  { id: 'movie',    name: 'أفلام',         url: `${BASE_URL}/titles/list/movie` },
  { id: 'ova',      name: 'أوفا',          url: `${BASE_URL}/titles/list/ova` },
  { id: 'ona',      name: 'أونا',          url: `${BASE_URL}/titles/list/ona` },
  { id: 'special',  name: 'حلقات خاصة',    url: `${BASE_URL}/titles/list/special` },
];

const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const plain   = (opts = {}) => ({ ...opts, useFS: false });

function buildUrl(catalogId, page = 1, genre, type, age) {
  const cat = CATALOGS.find((c) => c.id === catalogId) || CATALOGS[0];
  const params = new URLSearchParams();

  if (page > 1) params.set('page', page);

  if (genre) {
    const genres = Array.isArray(genre) ? genre : [genre];
    genres.forEach(g => {
      const slug = GENRE_SLUGS[g] || g;
      if (slug) params.append('genres[]', slug);
    });
  }

  if (age) {
    const ages = Array.isArray(age) ? age : [age];
    ages.forEach(a => params.append('age_ratings[]', a));
  }

  let url = cat.url;
  const qs = params.toString();
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  return url;
}

function parseTitleCard($, el) {
  const $el = $(el);
  const $imgLink = $el.find('a.btn-plain.w-full').first();
  const href = $imgLink.attr('href') || '';
  const title = $imgLink.find('h2.title-name').first().text().trim();
  const thumb = $imgLink.find('img').first().attr('src') || '';
  if (!href || !title) return null;
  return {
    id: mkId(resolve(href)),
    title,
    thumb: resolve(thumb),
    url: resolve(href),
  };
}

async function getCatalog(catalogId, page = 1, extra = {}) {
  const url = buildUrl(catalogId, page, extra.genre, extra.type, extra.age);
  const html = await fetchPage(url, BASE_URL, plain());
  if (!html) return { items: [], hasNextPage: false };

  const $ = cheerio.load(html);
  const items = [];
  $('.title-card').each((_, el) => {
    const item = parseTitleCard($, el);
    if (item) items.push(item);
  });

  const nextBtn = $('button:contains("التالي"):not([disabled]), button:contains("التالى"):not([disabled])');
  const hasNextPage = nextBtn.length > 0 || !!$('[wire\\:click*="nextPage"]:not([disabled])').length;

  return { items, hasNextPage };
}

async function search(query) {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(url, BASE_URL, plain());
  if (!html) return [];

  const $ = cheerio.load(html);
  const items = [];
  $('.title-card').each((_, el) => {
    const item = parseTitleCard($, el);
    if (item) items.push(item);
  });
  return items;
}

async function getMeta(encodedId) {
  const url = toUrl(encodedId);
  if (!url) return null;

  const html = await fetchPage(url, BASE_URL, plain());
  if (!html) return null;

  const $ = cheerio.load(html);

  const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
  const thumb = resolve($('meta[property="og:image"]').attr('content') || '');
  const description = $('meta[name="description"]').attr('content') || $('.synopsis').first().text().trim() || '';
  const genres = [];

  $('.genres a, .genres span[href*="/genre/"]').each((_, el) => {
    const g = $(el).text().trim();
    if (g) genres.push(g);
  });

  if (genres.length === 0) {
    try {
      const jsonLd = JSON.parse($('script[type="application/ld+json"]').first().html() || '{}');
      const genreArr = jsonLd.itemListElement?.[0]?.item?.genre || jsonLd.genre || [];
      if (Array.isArray(genreArr)) genreArr.forEach(g => { if (g && !genres.includes(g)) genres.push(g); });
    } catch (_) {}
  }

  const episodeLinks = [];
  $('a[href*="/episode/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const epMatch = href.match(/\/episode\/[^/]+\/(\d+)/);
    const epNum = epMatch ? parseInt(epMatch[1]) : 0;
    if (!href || !epNum) return;

    const epNumText = $a.find('.video-data span').first().text().trim() || `الحلقة ${epNum}`;
    const epNameText = $a.find('.video-data p').first().text().trim();
    const epTitle = epNameText ? `${epNumText} — ${epNameText}` : epNumText;

    episodeLinks.push({
      id: mkId(resolve(href)),
      href: resolve(href),
      title: epTitle,
      epNum,
      seasonNum: 1,
    });
  });

  const unique = [];
  const seenHrefs = new Set();
  for (const ep of episodeLinks) {
    if (!seenHrefs.has(ep.href)) {
      seenHrefs.add(ep.href);
      unique.push(ep);
    }
  }

  return { title, thumb, description, genres, episodeLinks: unique };
}

async function getStreams(encodedId) {
  const episodeUrl = toUrl(encodedId);
  if (!episodeUrl) return [];

  console.log(`[Anime3rb] getStreams ${episodeUrl}`);

  const streams = [];
  const seen = new Set();

  // Fetch the episode page to discover available qualities from download labels
  const html = await fetchPage(episodeUrl, BASE_URL, plain({ noCache: true }));
  if (!html) return [];

  const $ = cheerio.load(html);

  // Extract quality labels from the download section
  const qualities = [];
  $('a[href*="/download/"]').each((_, el) => {
    const label = $(el).parent().find('label').first().text().trim()
      || $(el).closest('[class*="flex"]').find('label').first().text().trim()
      || '';
    if (!label) return;

    const qMatch = label.match(/\[(.+?)\]/);
    if (!qMatch) return;
    qualities.push(qMatch[1]);
  });

  // Deduplicate and sort qualities
  const unique = [...new Set(qualities)];
  const sortOrder = ['4K', '1080p HEVC', '1080p', '720p', '480p', '360p'];
  unique.sort((a, b) => sortOrder.indexOf(a) - sortOrder.indexOf(b));

  // If no qualities found, provide a default
  const qualityList = unique.length > 0 ? unique : ['Auto'];

  for (const q of qualityList) {
    if (seen.has(q)) continue;
    seen.add(q);

    streams.push({
      url:    episodeUrl,
      label:  `✅ ${q}`,
      quality: q,
      isEmbed: false,
      providerId: 'anime3rb',
    });
  }

  console.log(`[Anime3rb] ${streams.length} quality stream(s) returned`);
  return streams;
}

module.exports = {
  SITE_ID, SITE_NAME, SITE_LOGO, SITE_BASE_URL,
  NEEDS_FLARESOLVERR, SEARCH_ENABLED, PROXY_IMAGES, PROXY_STREAMS,
  CATALOGS, EXTRA_SUPPORTED, GENRES, AGE_RATINGS,
  getCatalog, search, getMeta, getStreams,
};
