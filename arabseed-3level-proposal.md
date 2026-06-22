# ArabSeed 3-Level Filter Pattern — Proposal

Based on thorough analysis of animelek's 3-level pattern at `/home/hermes/projects/streamforge-resolver/sources/animelek/index.js`.

---

## 1. AnimeLek Pattern Analysis

### How it works

**Constants (lines 50-57, 60-68):**
```js
const EXTRA_SUPPORTED = ['genre', 'type'];
const TYPES = ['TV', 'فيلم', 'OVA', 'ONA', 'Special'];
const GENRES = [/* 41 Arabic genre names */];
const GENRE_SLUGS = { /* Arabic→URL-encoded slug map */ };
```

**Catalog definitions (lines 99-103):**
```js
const CATALOGS = [
  { id: 'all',  name: 'الكل', url: '.../%D9%82%D8%A7%D8%A6%D9%85%D8%A9-%D8%A7%D9%84%D8%A3%D9%86%D9%85%D9%8A/' },
  { id: 'film',  name: 'أفلام', url: '.../anime-type/%D9%81%D9%8A%D9%84%D9%85/' },
  { id: 'airing', name: 'يعرض الآن', url: '.../anime-status/%D9%8A%D8%B9%D8%B1%D8%B6-%D8%A7%D9%84%D8%A7%D9%86/' },
];
```

**`buildUrl()` (lines 248-263) — the core of URL construction:**
```
Input: baseUrl, page, genre?, type?
Logic:
  1. If genre is set AND exists in GENRE_SLUGS → URL becomes `/anime-genre/{slug}/`
  2. ELSE if type is set (no genre) → URL becomes `/anime-type/{type}/`
  3. ELSE → keep original catalog baseUrl
  4. If page > 1 → append `?page={page}`
```
Key: Genre and type are **mutually exclusive** — genre wins, type only applies when genre absent.

**`getCatalog()` (lines 323-336):**
- Receives `catalogId`, `page`, `extra` (with `{ genre, type }`)
- Finds matching catalog entry from CATALOGS
- Calls `buildUrl(cat.url, page, extra.genre, extra.type)`
- Fetches the URL, parses cards, returns `{ items, hasNextPage }`

**`meta.json` (lines 1-31):**
```json
{
  "extraSupported": ["genre", "type"],
  "genres": [...],
  "types": ["TV", "فيلم", "OVA", "ONA", "Special"],
  "catalogs": [
    { "id": "all", "name": "الكل", "type": "series" },
    ...
  ]
}
```

### Key insight for ArabSeed
Animelek's 3 levels are:
- **Level 1**: Catalog entry choice (`all` / `film` / `airing` — selected via Stremio's catalog selector)
- **Level 2** (`extra.genre`): Genre filter — **overrides** the catalog URL entirely
- **Level 3** (`extra.type`): Type filter — overrides URL when genre not selected

---

## 2. Current ArabSeed State

**Current index.js strengths:**
- `CATALOG_URLS` map has all URLs pre-defined (30+ catalog IDs)
- Genre pages exist as `GENRE_URLS` (19 Arabic genres)
- `isMovieUrl()` helper can detect `فيلم` in URLs
- `loadSeriesView()` AJAX call gets series-only view via `term__posts` with `type=series`
- `getCatalog()` already handles `extra.genre` override

**Current gaps vs. animelek pattern:**
| Feature | animelek | arabseed (current) |
|---------|----------|-------------------|
| `EXTRA_SUPPORTED` | `['genre', 'type']` | `['genre']` |
| Genre URL building | Structured `/anime-genre/{slug}/` | Per-genre `GENRE_URLS` map |
| `CATALOGS` array | Yes, with URLs | No — uses flat `CATALOG_URLS` map |
| Genre+type mutual exclusion | Yes | N/A (only genre) |
| Episode filtering on genre pages | Not needed (animelek genre pages only show anime) | **Missing** — genre pages show mixed movies+series+episodes |

---

## 3. Proposed ArabSeed 3-Level Architecture

### Level 1: Catalog entry selection (already done — 30 catalogs in meta.json)

The current catalog entries are fine. Each is a separate Stremio catalog:
```
movies, movies-foreign, movies-arabic, movies-turkish, movies-asian,
movies-indian, movies-dubbed, movies-classic, movies-netflix,
series, series-foreign, series-arabic, series-turkish, series-korean,
series-egyptian, series-indian, series-dubbed, series-cartoon, series-netflix,
ramadan, ramadan-2026 through ramadan-2019,
anime, anime-movies, anime-series,
others, others-wwe, others-songs, others-tv, others-plays,
browse, recently, trending
```

### Level 2 (NEW): Sub-catalog type restriction via `extra.type`

Animelek uses `extra.type` (TV/فيلم/OVA/etc.). For ArabSeed, `extra.type` should restrict genre results to either `movie` or `series` type. This filters out episodes from mixed genre pages.

**Proposed `EXTRA_SUPPORTED` in index.js:**
```js
const EXTRA_SUPPORTED = ['genre', 'type'];
```

**Proposed `TYPES` in index.js:**
```js
const TYPES = ['movie', 'series'];
```

### Level 3 (NEW): Episode filtering in genre pages

Genre pages on ArabSeed contain a mix of:
- Movie cards → URLs contain `فيلم`
- Series cards → URLs contain `مسلسل`
- Episode cards → URLs match `-s\d+-eps\d+` or contain `الحلقة`

**Proposed filtering logic in `parseCards()` or a wrapper:**

```js
/**
 * Determine the content type from a URL.
 * @param {string} url - The full URL to check
 * @returns {'movie'|'series'|'episode'|'unknown'}
 */
function getContentType(url) {
  const u = decodeURIComponent(url);
  if (/-s\d+-eps\d+/i.test(u)) return 'episode';  // e.g., /series-name-s01-eps12/
  if (u.includes('الحلقة')) return 'episode';       // Arabic "episode"
  if (u.includes('فيلم')) return 'movie';            // Movie
  if (u.includes('مسلسل')) return 'series';          // Series
  return 'unknown'; // Could be a doc, show, etc.
}
```

Then when `extra.type` is `'movie'`, filter out everything that isn't a movie. When `extra.type` is `'series'`, filter out everything that isn't a series AND filter out episodes.

### Complete flow

```
User picks catalog "movies-foreign" (Level 1)
  → getCatalog('movies-foreign', 1, {})
  → fetches https://a.asd.ink/category/foreign-movies-17/
  → returns movie cards (no filtering needed, it's a movie-specific page)

User applies genre filter on "movies-foreign" catalog (Level 2)
  → getCatalog('movies-foreign', 1, { genre: 'أكشن' })
  → overrides to https://a.asd.ink/genre/%D8%A3%D9%83%D8%B4%D9%86/
  → this page has mixed content (movies + series + episodes)
  → parseCards() returns everything

User applies genre + type filter (Level 3)
  → getCatalog('movies-foreign', 1, { genre: 'أكشن', type: 'movie' })
  → overrides to https://a.asd.ink/genre/%D8%A3%D9%83%D8%B4%D9%86/
  → parseCards() returns everything
  → then filterCards() removes items where getContentType(url) !== 'movie'
  → only movies shown
```

---

## 4. Required Code Changes

### A. `index.js` — New constants & helpers

**Add after line 28** (`const EXTRA_SUPPORTED = ['genre'];`):
```js
const EXTRA_SUPPORTED = ['genre', 'type'];
const TYPES = ['movie', 'series'];
```

**Add `getContentType()` helper** (after `isMovieUrl()` around line 247):
```js
/**
 * Determine content type from a URL.
 * @param {string} url - Decoded or raw URL
 * @returns {'movie'|'series'|'episode'|'unknown'}
 */
function getContentType(url) {
  const u = decodeURIComponent(url);
  // Episode patterns
  if (/-s\d+-eps\d+/i.test(u)) return 'episode';
  if (u.includes('الحلقة')) return 'episode';
  // Movie pattern
  if (u.includes('فيلم')) return 'movie';
  // Series pattern (but NOT episode — already filtered above)
  if (u.includes('مسلسل')) return 'series';
  return 'unknown';
}
```

### B. `index.js` — Filter wrapper for parseCards

**Add `filterCardsByType()` helper:**

```js
/**
 * Filter parsed cards by content type when extra.type is provided.
 * @param {Array} items  - Parsed card items
 * @param {string} type  - Desired type ('movie' or 'series')
 * @returns {Array} Filtered items
 */
function filterCardsByType(items, type) {
  if (!type) return items;
  return items.filter(item => {
    const ct = getContentType(item.url);
    if (type === 'movie') return ct === 'movie';
    if (type === 'series') return ct === 'series' || ct === 'unknown';
    return true;
  });
}
```

### C. `index.js` — Update `getCatalog()` to apply type filter on genre pages

**Modify `getCatalog()` around lines 399-440:**

In the genre branch (line 401-407), after parsing cards, apply the type filter:

```js
// Current (lines 401-407):
if (extra.genre && GENRE_URLS[extra.genre]) {
  const url = buildCatalogUrlFromGenre(extra.genre, page);
  if (!url) return { items: [], hasNextPage: false };
  const html = await fetchPage(url, BASE_URL, plain());
  if (!html) return { items: [], hasNextPage: false };
  return { items: parseCards(cheerio.load(html), `genre: ${extra.genre}`), hasNextPage: false };
}
```

**Changed to:**
```js
if (extra.genre && GENRE_URLS[extra.genre]) {
  const url = buildCatalogUrlFromGenre(extra.genre, page);
  if (!url) return { items: [], hasNextPage: false };
  const html = await fetchPage(url, BASE_URL, plain());
  if (!html) return { items: [], hasNextPage: false };
  const items = parseCards(cheerio.load(html), `genre: ${extra.genre}`);
  return {
    items: filterCardsByType(items, extra.type),
    hasNextPage: false,
  };
}
```

### D. `meta.json` — Update extraSupported, types, and catalogs

```json
{
  "extraSupported": ["genre", "type"],
  "types": ["movie", "series"],
  ...
}
```

No changes needed to `catalogs` array — it already has the right structure.

---

## 5. URL Pattern Verification

Key patterns observed from the ArabSeed source:

| Type | Pattern | Regex | Example |
|------|---------|-------|---------|
| Episode | `-s\d+-eps\d+` | `/-s\d+-eps\d+/i` | `/movie-name-s01-eps12/` |
| Episode (Arabic) | `الحلقة` in URL | contains | `/مسلسل-اسم/الحلقة-1/` |
| Movie | `فيلم` in URL | contains | `/فيلم-اسم/` |
| Series | `مسلسل` in URL | contains (but NOT episode) | `/مسلسل-اسم/` |

The filtering priority is:
1. Check episode patterns FIRST (catch -s01-eps12 and الحلقة)
2. Check movie (فيلم)
3. Check series (مسلسل)
4. Everything else = unknown (include it, better safe)

This ensures that a URL like `/فيلم-مسلسل-اسم-s01-eps12/` is caught as an episode despite containing `فيلم` or `مسلسل`.

---

## 6. Summary of Changes

| File | Change | Lines |
|------|--------|-------|
| `index.js` | Change `EXTRA_SUPPORTED` to include `'type'` | ~line 29 |
| `index.js` | Add `TYPES` constant `['movie', 'series']` | after line 29 |
| `index.js` | Add `getContentType()` helper function | after line 247 |
| `index.js` | Add `filterCardsByType()` helper function | after getContentType |
| `index.js` | Update genre branch in `getCatalog()` to call `filterCardsByType()` | ~lines 401-407 |
| `index.js` | Export `TYPES` and update exports | ~lines 714-715 |
| `meta.json` | Add `'type'` to `extraSupported` | line 9-10 |
| `meta.json` | Keep existing `types: ["movie", "series"]` | lines 33-36 |
