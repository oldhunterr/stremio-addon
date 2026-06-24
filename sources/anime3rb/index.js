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

const PROVIDER_MAP = {
  'video.vid3rb.com': 'vid3rb',
  'www.video.vid3rb.com': 'vid3rb',
};

const knownProviders = {
  'vid3rb': 'direct',
};

const mkId    = (url)  => makeId(url, BASE_URL);
const toUrl   = (enc)  => idToUrl(enc, BASE_URL);
const resolve = (href) => resolveUrl(href, BASE_URL);
const plain   = (opts = {}) => ({ ...opts, useFS: false });

function buildUrl(catalogId, page = 1, genre, type, age) {
  const cat = CATALOGS.find((c) => c.id === catalogId) || CATALOGS[0];
  const params = new URLSearchParams();

  if (page > 1) params.set('page', page);

  // Genre filter — site uses ?genres[]=slug on the list page
  if (genre) {
    const genres = Array.isArray(genre) ? genre : [genre];
    genres.forEach(g => {
      const slug = GENRE_SLUGS[g] || g;
      if (slug) params.append('genres[]', slug);
    });
  }

  // Age rating filter — site uses ?age_ratings[]=value
  if (age) {
    const ages = Array.isArray(age) ? age : [age];
    ages.forEach(a => params.append('age_ratings[]', a));
  }

  let url = cat.url;
  const qs = params.toString();
  if (qs) url += (url.includes('?') ? '&' : '?') + qs;

  return url;
}

function parseTitleCard($, el, label = '') {
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

function getProviderId(embedUrl) {
  try {
    const hostname = new URL(embedUrl).hostname.replace(/^www\./, '');
    return PROVIDER_MAP[hostname] || null;
  } catch {
    return null;
  }
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

  console.log(`[Anime3rb] Catalog "${catalogId}" page ${page} → ${items.length} items`);
  return { items, hasNextPage };
}

async function search(query, extra = {}) {
  const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(url, BASE_URL, plain());

  if (!html) return [];

  const $ = cheerio.load(html);
  const items = [];

  $('.title-card').each((_, el) => {
    const item = parseTitleCard($, el);
    if (item) items.push(item);
  });

  console.log(`[Anime3rb] Search "${query}" → ${items.length} items`);
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
    const epNumText = $a.find('.video-data span').first().text().trim() || `الحلقة ${epNum}`;
    const epNameText = $a.find('.video-data p').first().text().trim();
    const epTitle = epNameText ? `${epNumText} — ${epNameText}` : epNumText;

    if (!href || !epNum) return;

    episodeLinks.push({
      id: mkId(resolve(href)),
      href: resolve(href),
      title: epTitle,
      epNum,
      seasonNum: 1,
    });
  });

  const uniqueEpisodes = [];
  const seenHrefs = new Set();
  for (const ep of episodeLinks) {
    if (!seenHrefs.has(ep.href)) {
      seenHrefs.add(ep.href);
      uniqueEpisodes.push(ep);
    }
  }

  return { title, thumb, description, genres, episodeLinks: uniqueEpisodes };
}

async function getStreams(encodedId) {
  const url = toUrl(encodedId);
  if (!url) return [];

  console.log(`[Anime3rb] getStreams ${url}`);

  const html = await fetchPage(url, BASE_URL, plain({ noCache: true }));
  if (!html) return [];

  const streams = [];
  const seen = new Set();

  const $ = cheerio.load(html);

  // 1. Extract server label from the active video source button
  let serverLabel = 'ترجمة';
  $('button[data-video-source]').each((_, el) => {
    const lbl = $(el).find('span[class*="truncate"]').text().trim();
    if (lbl) serverLabel = lbl;
  });

  // 2. Main video player URL from Livewire snapshot
  let videoUrl = null;
  $('[wire\\:snapshot]').each((_, el) => {
    const snap = $(el).attr('wire:snapshot');
    if (!snap || !snap.includes('video.show-video')) return;
    try {
      const parsed = JSON.parse(snap);
      const raw = parsed.data?.video_url;
      if (raw) videoUrl = raw.replace(/\\\//g, '/').replace(/&amp;/g, '&');
    } catch (_) {}
  });

  // 3. Fetch the player page to extract actual video source URLs
  let hasVideoSources = false;
  if (videoUrl) {
    try {
      const axios = require('axios');
      const playerResp = await axios.get(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': BASE_URL + '/',
          'Accept': '*/*',
        },
        timeout: 15000,
        validateStatus: () => true,
      });
      const playerHtml = playerResp.data;
      if (playerHtml && typeof playerHtml === 'string') {
        const srcMatch = playerHtml.match(/var video_sources\s*=\s*(\[[\s\S]*?\]);/);
        if (srcMatch) {
          try {
            const sources = JSON.parse(srcMatch[1]);
            for (const src of sources) {
              if (!src.src || seen.has(src.src)) continue;
              const label = src.label || '';
              const quality = src.res ? src.res.replace(/^(\d+).*$/, '$1p') : 'Auto';
              const isPremium = src.premium;
              const cleanUrl = src.src.replace(/\\\//g, '/');

              seen.add(cleanUrl);
              streams.push({
                url: cleanUrl,
                label: `${isPremium ? '⭐' : '✅'} ${label} [${quality}]`,
                isEmbed: false,
                quality,
                providerId: 'vid3rb',
              });
              console.log(`  [Stream] ${isPremium ? '⭐' : '✅'} ${label} [${quality}] → ${cleanUrl.substring(0, 80)}`);
              hasVideoSources = true;
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 4. Download links with quality labels (always try, dedup by seen set)
  $('a[href*="/download/"]').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    if (!href || seen.has(href)) return;

    const label = $a.parent().find('label').first().text().trim()
      || $a.closest('[class*="flex"]').find('label').first().text().trim()
      || '';

    if (!label) return;

    const qualityMatch = label.match(/\[(.+?)\]/);
    const quality = qualityMatch ? qualityMatch[1] : 'Auto';
    const cleanLabel = label.replace(/\[.+?\]/g, '').trim() || label;

    seen.add(href);
      streams.push({
        url: href,
        label: `📥 ${cleanLabel} [${quality}]`,
        isEmbed: false,
        quality,
        providerId: 'vid3rb',
      });
    console.log(`  [Stream] 📥 ${cleanLabel} [${quality}] → ${href.substring(0, 80)}`);
  });

  // 5. Add player URL as browser fallback
  if (videoUrl && !seen.has(videoUrl)) {
    seen.add(videoUrl);
    streams.push({
      url: videoUrl,
      label: `${serverLabel}`,
      isEmbed: false,
      quality: 'Auto',
      providerId: 'vid3rb',
    });
  }

  if (streams.length === 0) {
    streams.push({
      url: url,
      label: '🌐 فتح في المتصفح',
      isEmbed: true,
      quality: '—',
      providerId: null,
    });
  }

  console.log(`[Anime3rb] ${streams.length} stream(s) returned`);
  return streams;
}

module.exports = {
  SITE_ID, SITE_NAME, SITE_LOGO, SITE_BASE_URL,
  NEEDS_FLARESOLVERR, SEARCH_ENABLED, PROXY_IMAGES,
  CATALOGS,
  EXTRA_SUPPORTED,
  GENRES,
  AGE_RATINGS,
  getCatalog, search, getMeta, getStreams,
};
