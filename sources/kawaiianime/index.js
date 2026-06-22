/**
 * Scraper: Kawaii Anime
 * URL: https://www.kawaii-anime.com
 * CF: NO — uses AniList GraphQL API + HiAnime API, no scraping needed
 */
const { makeId, idToUrl } = require('../../lib/fetch');

const BASE_URL = 'https://www.kawaii-anime.com';

const SITE_ID            = 'kawaiianime';
const SITE_NAME          = 'Kawaii Anime';
const SITE_LOGO          = `${BASE_URL}/favicon.png`;
const SITE_BASE_URL      = BASE_URL;
const NEEDS_FLARESOLVERR = false;
const SEARCH_ENABLED     = true;
const PROXY_IMAGES       = false;

// ─── Filters ──────────────────────────────────────────────────────────────────
const EXTRA_SUPPORTED = ['genre', 'type'];

const GENRES = [
  'Action','Adventure','Comedy','Drama','Fantasy','Horror','Mystery',
  'Romance','Sci-Fi','Slice of Life','Sports','Supernatural','Thriller',
  'Mecha','Music','Psychological','Historical','School',
];

const TYPES = ['TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'];

const CATALOGS = [
  { id: 'TRENDING_DESC',   name: 'الأكثر رواجاً'  },
  { id: 'POPULARITY_DESC', name: 'الأكثر شعبية'   },
  { id: 'SCORE_DESC',      name: 'الأعلى تقييماً' },
  { id: 'START_DATE_DESC', name: 'الأحدث'          },
  { id: 'FAVOURITES_DESC', name: 'الأكثر تفضيلاً' },
];

// ─── AniList API helpers ──────────────────────────────────────────────────────
const COMMON_HEADERS = {
  'accept':          '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'content-type':    'application/json',
  'origin':          BASE_URL,
  'referer':         `${BASE_URL}/browse`,
  'user-agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

async function apiPost(endpoint, body, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${endpoint}`, {
        method:  'POST',
        headers: COMMON_HEADERS,
        body:    JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (err) {
      console.warn(`[KawaiiAnime] POST ${endpoint} attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error(`API POST ${endpoint} failed after ${retries} attempts`);
}

async function apiGet(endpoint, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { headers: { ...COMMON_HEADERS, referer: BASE_URL } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on GET ${endpoint}`);
  return res.json();
}

const MEDIA_FRAGMENT = `
  id idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large }
  genres format status episodes duration
  season seasonYear averageScore popularity trending favourites
`;

function mediaToItem(media) {
  const title = media.title.english || media.title.romaji || media.title.native;
  const thumb = media.coverImage?.extraLarge || media.coverImage?.large || '';
  return {
    id:    `anilist:${media.id}`,
    title,
    thumb,
    url:   `${BASE_URL}/watch/${media.id}`,
  };
}

// ─── Supabase slug lookup ─────────────────────────────────────────────────────
const SUPABASE_URL    = 'https://axfutjtkvqjdhooxrwjn.supabase.co';
const SUPABASE_APIKEY = 'sb_publishable_x_O6uBy2QHZTg5r8D7H3kQ_2cXuZsEe';

async function getHiSlug(anilistId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/anime_mapping?select=*&anilist_id=eq.${anilistId}`,
      {
        headers: {
          'accept':         'application/vnd.pgrst.object+json',
          'accept-profile': 'public',
          'apikey':         SUPABASE_APIKEY,
          'authorization':  `Bearer ${SUPABASE_APIKEY}`,
          'origin':         BASE_URL,
          'referer':        `${BASE_URL}/`,
        },
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.hianime_id || null;
  } catch (err) {
    console.warn('[KawaiiAnime] getHiSlug failed:', err.message);
    return null;
  }
}

// ─── ID helpers ───────────────────────────────────────────────────────────────
function parseAnilistId(encodedId) {
  // Accepts both  "anilist:12345"  and  base64url-encoded watch URLs
  const direct = String(encodedId).match(/^anilist:(\d+)$/);
  if (direct) return direct[1];

  // Fallback: decode base64url → /watch/12345?...
  try {
    const relative = Buffer.from(encodedId, 'base64url').toString('utf8');
    const m = relative.match(/\/watch\/(\d+)/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function getCatalog(catalogId, page = 1, extra = {}) {
  const sort  = CATALOGS.find(c => c.id === catalogId)?.id || 'TRENDING_DESC';
  const genre = extra.genre || null;
  const type  = extra.type  || null;

  async function fetchAnilistPage(p) {
    return apiPost('/api/anilist', {
      query: `query($page:Int,$perPage:Int,$sort:[MediaSort],$genre:String,$format:MediaFormat){
        Page(page:$page,perPage:$perPage){
          pageInfo{hasNextPage}
          media(type:ANIME,isAdult:false,sort:$sort,genre:$genre,format:$format){${MEDIA_FRAGMENT}}
        }
      }`,
      variables: { page: p, perPage: 24, sort: [sort], genre, format: type || undefined },
    });
  }

  const [r1, r2] = await Promise.all([
    fetchAnilistPage(page),
    page === 1 ? fetchAnilistPage(2) : Promise.resolve(null),
  ]);

  const media1 = r1?.data?.Page?.media || [];
  const media2 = r2?.data?.Page?.media || [];
  const items  = [...media1, ...media2].map(mediaToItem);
  const hasNextPage = r1?.data?.Page?.pageInfo?.hasNextPage ?? false;

  console.log(`[KawaiiAnime] getCatalog "${catalogId}" page=${page} genre="${genre || '-'}" type="${type || '-'}" -> ${items.length} items`);
  return { items, hasNextPage };
}

async function search(query) {
  console.log(`[KawaiiAnime] search "${query}"`);
  const data = await apiPost('/api/anilist', {
    query: `query($search:String){
      Page(page:1,perPage:24){
        media(type:ANIME,isAdult:false,search:$search){${MEDIA_FRAGMENT}}
      }
    }`,
    variables: { search: query },
  });
  const items = (data?.data?.Page?.media || []).map(mediaToItem);
  console.log(`[KawaiiAnime] search -> ${items.length} results`);
  return items;
}

async function getMeta(encodedId) {
  console.log(`[KawaiiAnime] getMeta "${encodedId}"`);
  const anilistId = parseAnilistId(encodedId);
  if (!anilistId) { console.error('[KawaiiAnime] Could not parse anilist ID from:', encodedId); return null; }

  // 1. Fetch AniList metadata
  const data = await apiPost('/api/anilist', {
    query: `query($id:Int){ Media(id:$id,type:ANIME){ ${MEDIA_FRAGMENT} } }`,
    variables: { id: parseInt(anilistId) },
  });
  const media = data?.data?.Media;
  if (!media) return null;

  const title       = media.title.english || media.title.romaji || media.title.native;
  const thumb       = media.coverImage?.extraLarge || '';
  const description = media.description || '';
  const genres      = media.genres || [];

  // 2. Resolve HiAnime slug (Supabase -> title guess)
  let hiSlug = await getHiSlug(anilistId);
  if (!hiSlug) {
    const romaji  = media.title?.romaji || media.title?.english || '';
    hiSlug = romaji.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
    if (hiSlug) console.log(`[KawaiiAnime] Guessed hiSlug: ${hiSlug}`);
  }

  // 3. Fetch episode list from HiAnime
  let episodeLinks = [];
  if (hiSlug) {
    try {
      const epData = await apiGet('/api/hianime', {
        path: `/api/v2/hianime/anime/${hiSlug}/episodes`,
      });
      const episodes = epData?.data?.episodes || [];
      console.log(`[KawaiiAnime] ${episodes.length} episodes from HiAnime`);

      episodeLinks = episodes.map(ep => {
        const epUrl = `${BASE_URL}/watch/${anilistId}?ep=${encodeURIComponent(ep.episodeId)}&num=${ep.number}&hi=${hiSlug}`;
        return {
          id:        makeId(epUrl, BASE_URL),
          href:      epUrl,
          title:     ep.title ? (ep.isFiller ? `🔶 ${ep.title}` : ep.title) : `الحلقة ${ep.number}`,
          epNum:     ep.number,
          seasonNum: 1,
        };
      });
    } catch (err) {
      console.warn('[KawaiiAnime] Episode fetch failed:', err.message);
    }
  }

  return { title, thumb, description, genres, episodeLinks };
}

async function getStreams(encodedId) {
  console.log(`[KawaiiAnime] getStreams "${encodedId}"`);
  const url    = idToUrl(encodedId, BASE_URL);
  const params = new URL(url).searchParams;

  const anilistId   = url.match(/\/watch\/(\d+)/)?.[1];
  const epNum       = params.get('num');
  const hiEpisodeId = decodeURIComponent(params.get('ep') || '');
  const hiSlug      = params.get('hi') || '';

  console.log(`[KawaiiAnime] anilistId=${anilistId} epNum=${epNum} hiEpisodeId=${hiEpisodeId}`);
  if (!anilistId || !epNum) return [];

  const streams  = [];
  const cacheKey = `${anilistId}-ep${epNum}`;

  // ── 1. Cached MP4 ────────────────────────────────────────────────────────
  try {
    const cached = await apiGet('/api/video-cache', { episodeId: cacheKey });
    if (cached?.cached && cached?.url) {
      const subtitles = (cached.subtitleUrls || []).map((s, i) => ({ id: String(i), url: s, lang: 'ara' }));
      streams.push({ url: cached.url, label: '📦 Cached MP4', isEmbed: false, subtitles });
      console.log(`[KawaiiAnime] Found cached stream`);
    }
  } catch (err) {
    console.warn('[KawaiiAnime] Cache check failed:', err.message);
  }

  // ── 2. HiAnime HLS ───────────────────────────────────────────────────────
  try {
    let hls = null;
    for (const server of ['hd-1', 'hd-2']) {
      const path = `/api/v2/hianime/episode/sources?animeEpisodeId=${encodeURIComponent(hiEpisodeId)}&server=${server}&category=sub`;
      const res  = await apiGet('/api/hianime', { path });
      if (res?.data?.sources?.length) { hls = res; break; }
    }

    const src     = hls?.data?.sources?.find(s => s.isM3U8) || hls?.data?.sources?.[0];
    const referer = hls?.data?.headers?.Referer || hls?.data?.headers?.referer || 'https://megacloud.blog/';

    if (src?.url) {
      const proxied   = `${BASE_URL}/api/proxy?url=${encodeURIComponent(src.url)}&referer=${encodeURIComponent(referer)}`;
      const subtitles = (hls?.data?.tracks || []).filter(t => t.url)
        .map((t, i) => ({ id: String(i), url: t.url, lang: t.lang || 'English' }));
      streams.push({ url: proxied, label: '📡 HLS Stream', isEmbed: false, subtitles });
      console.log(`[KawaiiAnime] Found HLS stream`);
    }
  } catch (err) {
    console.warn('[KawaiiAnime] HLS fetch failed:', err.message);
  }

  console.log(`[KawaiiAnime] ${streams.length} stream(s) total`);
  return streams;
}

module.exports = {
  SITE_ID, SITE_NAME, SITE_LOGO, SITE_BASE_URL,
  NEEDS_FLARESOLVERR, SEARCH_ENABLED, PROXY_IMAGES,
  CATALOGS, EXTRA_SUPPORTED, GENRES, TYPES,
  getCatalog, search, getMeta, getStreams,
};
