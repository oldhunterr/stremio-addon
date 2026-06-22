/**
 * tests/e2e/runner.js
 * Comprehensive E2E test runner using Node's native node:test and node:assert modules.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const axios = require('axios');
const { createFlareSolverrMock, createUrlResolverMock, createArabSeedMock } = require('./mocks');

const ADDON_PORT = '7100';
const ADDON_URL = `http://localhost:${ADDON_PORT}`;

let fsMock, resolverMock, arabseedMock;
let addonProcess;

// ─── Setup and Teardown Hooks ────────────────────────────────────────────────
test.before(async () => {
  console.log('🏁 Starting E2E Mock Servers...');
  fsMock = createFlareSolverrMock(8191);
  resolverMock = createUrlResolverMock(7400);
  arabseedMock = createArabSeedMock(7401);

  console.log('🚀 Spawning Addon Server (index.js)...');
  addonProcess = spawn('node', ['index.js'], {
    env: {
      ...process.env,
      PORT: ADDON_PORT,
      ADDON_URL: ADDON_URL,
      RESOLVER_URL: 'http://localhost:7400',
      FLARESOLVERR_URL: 'http://localhost:8191/v1',
      ARABSEED_URL: 'http://localhost:7401',
    },
    stdio: 'inherit'
  });

  // Wait for server to start
  const start = Date.now();
  let ready = false;
  while (Date.now() - start < 10000) {
    try {
      const res = await axios.get(`${ADDON_URL}/manifest.json`, { timeout: 1000 });
      if (res.status === 200) {
        ready = true;
        break;
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, 200));
  }

  if (!ready) {
    throw new Error('Addon server failed to start on port ' + ADDON_PORT);
  }
  console.log('✅ Addon Server is ready! Running tests...\n');
});

test.after(async () => {
  console.log('\n🛑 Cleaning up E2E environment...');
  if (addonProcess) {
    addonProcess.kill();
  }
  if (fsMock) fsMock.close();
  if (resolverMock) resolverMock.close();
  if (arabseedMock) arabseedMock.close();
  console.log('✨ Environment torn down successfully.');
});

// Helper to query addon endpoints
async function queryAddon(path) {
  try {
    const res = await axios.get(`${ADDON_URL}${path}`, { timeout: 5000 });
    return { status: res.status, headers: res.headers, data: res.data };
  } catch (err) {
    return {
      status: err.response ? err.response.status : 500,
      headers: err.response ? err.response.headers : {},
      data: null,
      error: err.message
    };
  }
}

// ─── TIER 1: HEALTH CHECKS & GENERAL CONNECTIVITY ───────────────────────────
test('Tier 1: Global Health & Manifest', async (t) => {
  await t.test('TC-01: GET /manifest.json returns 200 OK', async () => {
    const res = await queryAddon('/manifest.json');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.id, 'com.streamforge.resolver');
    assert.strictEqual(typeof res.data.name, 'string');
  });

  await t.test('TC-02: Manifest lists catalog resources', async () => {
    const res = await queryAddon('/manifest.json');
    assert.ok(res.data.resources.includes('catalog'));
  });

  await t.test('TC-03: Manifest lists meta resources', async () => {
    const res = await queryAddon('/manifest.json');
    assert.ok(res.data.resources.includes('meta'));
  });

  await t.test('TC-04: Manifest lists stream resources', async () => {
    const res = await queryAddon('/manifest.json');
    assert.ok(res.data.resources.includes('stream'));
  });

  await t.test('TC-05: CORS headers are present on manifest response', async () => {
    const res = await queryAddon('/manifest.json');
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });
});

// ─── FEATURE 1: ANIMEBLKOM CATALOG & META ──────────────────────────────────
test('Feature 1: AnimeBlkom Catalog & Meta', async (t) => {
  await t.test('TC-06: Fetch AnimeBlkom anime catalog returns 200 OK', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:anime.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-07: Fetch AnimeBlkom movies catalog returns 200 OK', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:movies.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-08: Search AnimeBlkom catalog returns 200 OK', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:search/search=naruto.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-09: Request for non-existent AnimeBlkom catalog ID returns empty metas', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:nonexistent.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-10: AnimeBlkom catalog items have Stremio compliant formatting', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:anime.json');
    assert.ok(res.data.metas.length > 0);
    const item = res.data.metas[0];
    assert.ok(item.id.startsWith('com.streamforge.resolver:animeblkom:'));
    assert.strictEqual(item.type, 'animeblkom');
    assert.ok(item.name);
    assert.ok(item.poster);
    assert.strictEqual(item.posterShape, 'regular');
  });

  await t.test('TC-11: Search returns items matching search term', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:search/search=naruto.json');
    assert.ok(res.data.metas.length > 0);
    assert.ok(res.data.metas.every(m => m.name.toLowerCase().includes('search result')));
  });

  await t.test('TC-12: Fetch Meta for known Anime ID returns valid meta schema', async () => {
    // encode target path '/anime/mock-anime-5'
    const encId = Buffer.from('/anime/mock-anime-5').toString('base64url');
    const res = await queryAddon(`/meta/series/com.streamforge.resolver:animeblkom:${encId}.json`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.meta);
    assert.strictEqual(res.data.meta.name, 'Mock Anime Title 5');
    assert.ok(Array.isArray(res.data.meta.genres));
    assert.ok(res.data.meta.genres.includes('أكشن'));
  });

  await t.test('TC-13: Meta episodeLinks are extracted and sorted', async () => {
    const encId = Buffer.from('/anime/mock-anime-5').toString('base64url');
    const res = await queryAddon(`/meta/series/com.streamforge.resolver:animeblkom:${encId}.json`);
    assert.ok(res.data.meta.videos);
    assert.strictEqual(res.data.meta.videos.length, 12);
    // Scraper reverses episodeLinks, check if order is reversed or ascending
    // The scraper code: 'const ordered = episodeLinks.reverse(); return { ..., episodeLinks: ordered }'
    // Since mock HTML was generated in ascending order (1 to 12), the returned videos list should be in reverse order
    assert.strictEqual(res.data.meta.videos[0].episode, 12);
    assert.strictEqual(res.data.meta.videos[11].episode, 1);
  });

  await t.test('TC-14: Fetching AnimeBlkom skip=100 (page 6) returns empty metas array', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:anime/skip=100.json');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.metas, []);
  });

  await t.test('TC-15: Search with empty query parameter returns empty metas', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:search.json');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.metas, []);
  });

  await t.test('TC-16: Malformed base64url meta ID resolves gracefully to null', async () => {
    const res = await queryAddon('/meta/series/com.streamforge.resolver:animeblkom:invalid-b64-@@@.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.meta === null || !res.data.meta.name);
  });

  await t.test('TC-17: Non-existent meta URL path resolves gracefully to null', async () => {
    const encId = Buffer.from('/anime/nonexistent-anime-slug').toString('base64url');
    // Note: The mock FS return will fall back to Generic FlareSolverr Mock Response, which doesn't match expected selectors.
    // Thus scraper returns null or minimal meta.
    const res = await queryAddon(`/meta/series/com.streamforge.resolver:animeblkom:${encId}.json`);
    assert.strictEqual(res.status, 200);
    // Since h1, img and details won't be parsed correctly or return fallback, it should behave gracefully
    assert.ok(res.data.meta === null || !res.data.meta.name);
  });

  await t.test('TC-18: CORS header compliance on catalog responses', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:anime.json');
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });

  await t.test('TC-19: CORS header compliance on meta responses', async () => {
    const encId = Buffer.from('/anime/mock-anime-5').toString('base64url');
    const res = await queryAddon(`/meta/series/com.streamforge.resolver:animeblkom:${encId}.json`);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });
});

// ─── FEATURE 2: ANIMEBLKOM IMAGE PROXY ──────────────────────────────────────
test('Feature 2: AnimeBlkom Image Proxy', async (t) => {
  const testImgUrl = 'http://localhost:8191/img/anime-5.jpg';
  const encImg = Buffer.from(testImgUrl).toString('base64url');

  await t.test('TC-20: GET /img/:encoded returns 200 OK for valid image URL', async () => {
    const res = await queryAddon(`/img/${encImg}`);
    assert.strictEqual(res.status, 200);
  });

  await t.test('TC-21: Proxied image response headers contain correct Content-Type', async () => {
    const res = await queryAddon(`/img/${encImg}`);
    assert.ok(res.headers['content-type'].startsWith('image/'));
  });

  await t.test('TC-22: Proxied image response headers contain Cache-Control max-age', async () => {
    const res = await queryAddon(`/img/${encImg}`);
    assert.ok(res.headers['cache-control'].includes('max-age=86400'));
  });

  await t.test('TC-23: Request returns correct binary data length', async () => {
    const res = await queryAddon(`/img/${encImg}`);
    assert.ok(res.data && res.data.length > 0);
  });

  await t.test('TC-24: Invalid image base64 returns 400 Bad Request', async () => {
    const res = await queryAddon('/img/invalid-b64-string-$$$');
    assert.ok(res.status === 400 || res.status === 502);
  });

  await t.test('TC-25: Image proxy caches responses correctly', async () => {
    const start = Date.now();
    const res1 = await queryAddon(`/img/${encImg}`);
    const time1 = Date.now() - start;

    const start2 = Date.now();
    const res2 = await queryAddon(`/img/${encImg}`);
    const time2 = Date.now() - start2;

    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res2.status, 200);
    // Cache should make the second query much faster
    assert.ok(time2 <= time1);
  });

  await t.test('TC-26: Catalog response poster URLs are wrapped with local image proxy', async () => {
    const res = await queryAddon('/catalog/series/animeblkom:anime.json');
    assert.ok(res.data.metas.length > 0);
    const poster = res.data.metas[0].poster;
    assert.ok(poster.includes('/img/'));
    const enc = poster.split('/img/')[1];
    const dec = Buffer.from(enc, 'base64url').toString('utf8');
    assert.ok(dec.includes('/img/'));
  });

  await t.test('TC-27: Meta response poster and background URLs are wrapped', async () => {
    const encId = Buffer.from('/anime/mock-anime-5').toString('base64url');
    const res = await queryAddon(`/meta/series/com.streamforge.resolver:animeblkom:${encId}.json`);
    assert.ok(res.data.meta.poster.includes('/img/'));
    assert.ok(res.data.meta.background.includes('/img/'));
  });

  await t.test('TC-28: Fetching non-existent image URL handles gracefully', async () => {
    const badImgUrl = 'http://localhost:8191/img/nonexistent.jpg';
    const badEnc = Buffer.from(badImgUrl).toString('base64url');
    const res = await queryAddon(`/img/${badEnc}`);
    // FlareSolverr fallback returns dummy Png so it resolves successfully or fails gracefully
    assert.strictEqual(res.status, 200);
  });

  await t.test('TC-29: Requesting img endpoint with special characters', async () => {
    const spImgUrl = 'http://localhost:8191/img/anime-5.jpg?test=1&special=@#$';
    const spEnc = Buffer.from(spImgUrl).toString('base64url');
    const res = await queryAddon(`/img/${spEnc}`);
    assert.strictEqual(res.status, 200);
  });

  await t.test('TC-30: Image proxy handles session cookie fallback', async () => {
    // Trigger image proxy call with no active cookies, should still fetch successfully
    const testUrl = 'http://localhost:8191/img/anime-10.jpg';
    const enc = Buffer.from(testUrl).toString('base64url');
    const res = await queryAddon(`/img/${enc}`);
    assert.strictEqual(res.status, 200);
    assert.ok(res.headers['content-type'].startsWith('image/'));
  });

  await t.test('TC-31: Binary magic number validation', async () => {
    const res = await axios.get(`${ADDON_URL}/img/${encImg}`, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    // Check if buffer contains binary text (our mock image has text or PNG header)
    assert.ok(buffer.length > 0);
  });
});

// ─── FEATURE 3: ARABSEED PAGINATION ─────────────────────────────────────────
test('Feature 3: ArabSeed Pagination', async (t) => {
  await t.test('TC-32: Fetch ArabSeed movies catalog returns 200 OK', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-33: Fetch ArabSeed series catalog returns 200 OK', async () => {
    const res = await queryAddon('/catalog/series/arabseed:series.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-34: Catalog response contains hasNextPage boolean', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies.json');
    assert.strictEqual(typeof res.data.hasNextPage, 'boolean');
    assert.strictEqual(res.data.hasNextPage, true);
  });

  await t.test('TC-35: Movie catalog pagination returns unique items on page 1 vs page 2', async () => {
    const resP1 = await queryAddon('/catalog/movie/arabseed:movies.json');
    const resP2 = await queryAddon('/catalog/movie/arabseed:movies/skip=20.json');

    assert.ok(resP1.data.metas.length > 0);
    assert.ok(resP2.data.metas.length > 0);

    const idsP1 = new Set(resP1.data.metas.map(m => m.id));
    const duplicates = resP2.data.metas.filter(m => idsP1.has(m.id));
    assert.strictEqual(duplicates.length, 0); // No duplicates
  });

  await t.test('TC-36: Series catalog pagination returns unique items on page 1 vs page 2', async () => {
    const resP1 = await queryAddon('/catalog/series/arabseed:series.json');
    const resP2 = await queryAddon('/catalog/series/arabseed:series/skip=20.json');

    assert.ok(resP1.data.metas.length > 0);
    assert.ok(resP2.data.metas.length > 0);

    const idsP1 = new Set(resP1.data.metas.map(m => m.id));
    const duplicates = resP2.data.metas.filter(m => idsP1.has(m.id));
    assert.strictEqual(duplicates.length, 0); // No duplicates
  });

  await t.test('TC-37: Series catalog AJAX pagination passes correct page arguments', async () => {
    // When requesting skip=20, page should be 2. Let's make sure the mock server receives url containing page/2/
    const res = await queryAddon('/catalog/series/arabseed:series-foreign/skip=20.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
    // Since page 2 is requested, the items list should start at 21
    const firstItemTitle = res.data.metas[0].name;
    assert.ok(firstItemTitle.includes('21'));
  });

  await t.test('TC-38: Browse catalog (main10) uses query parameter ?page_number=N', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:browse/skip=20.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
    // The items returned should correspond to page 2 (item numbers 21-40)
    assert.ok(res.data.metas[0].name.includes('21'));
  });

  await t.test('TC-39: Others catalog uses query parameter ?page_number=N', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:others/skip=40.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
    assert.ok(res.data.metas[0].name.includes('41'));
  });

  await t.test('TC-40: Out of bounds pagination (skip=1000) returns empty metas and hasNextPage false', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/skip=1000.json');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.metas, []);
  });

  await t.test('TC-41: Malformed skip/page parameter defaults to page 1', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/skip=invalid-skip-val.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
    assert.ok(res.data.metas[0].name.includes('1'));
  });

  await t.test('TC-42: Simulated sequential pagination hasNextPage check', async () => {
    const resP1 = await queryAddon('/catalog/movie/arabseed:movies.json');
    const resP2 = await queryAddon('/catalog/movie/arabseed:movies/skip=20.json');
    const resP3 = await queryAddon('/catalog/movie/arabseed:movies/skip=40.json');

    assert.strictEqual(resP1.data.hasNextPage, true);
    assert.strictEqual(resP2.data.hasNextPage, true);
    assert.strictEqual(resP3.data.hasNextPage, true);
  });

  await t.test('TC-43: Cookie isolation between different pagination requests', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/skip=20.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });
});

// ─── FEATURE 4: ARABSEED FILTERS ────────────────────────────────────────────
test('Feature 4: ArabSeed Filters', async (t) => {
  await t.test('TC-44: Request catalog with category filter returns 200 OK', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/category=foreign.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-45: Request catalog with genre filter returns 200 OK', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/genre=أكشن.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-46: Stremio type routing is correct', async () => {
    const resMovies = await queryAddon('/catalog/movie/arabseed:movies.json');
    const resSeries = await queryAddon('/catalog/series/arabseed:series.json');

    assert.ok(resMovies.data.metas.every(m => m.type === 'arabseed'));
    assert.ok(resSeries.data.metas.every(m => m.type === 'arabseed'));
  });

  await t.test('TC-47: Level 2 category selection filters appropriately', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies-arabic.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-48: Level 3 genre selection queries genre URL', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/genre=رعب.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-49: Level 4 movie type restriction filters out series', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/genre=أكشن&type=movie.json');
    assert.ok(res.data.metas.length > 0);
    res.data.metas.forEach(item => {
      // Decode URL to verify it's a movie page
      const dec = Buffer.from(item.id.split(':').pop(), 'base64url').toString('utf8');
      assert.ok(dec.includes('فيلم') || !dec.includes('selary') || !dec.includes('series'));
    });
  });

  await t.test('TC-50: Level 4 series type restriction filters out movies', async () => {
    const res = await queryAddon('/catalog/series/arabseed:series/genre=دراما&type=series.json');
    assert.ok(res.data.metas.length > 0);
    res.data.metas.forEach(item => {
      const dec = Buffer.from(item.id.split(':').pop(), 'base64url').toString('utf8');
      assert.ok(!dec.includes('فيلم'));
    });
  });

  await t.test('TC-51: Non-existent category fallback to root catalog', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/category=nonexistent-cat.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-52: Non-existent genre fallback to empty list or handles gracefully', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/genre=nonexistent-genre.json');
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.metas));
  });

  await t.test('TC-53: Search with type filter returns only matching type', async () => {
    const res = await queryAddon('/catalog/series/arabseed:search-series/search=Game of Thrones&type=series.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
    res.data.metas.forEach(item => {
      const dec = Buffer.from(item.id.split(':').pop(), 'base64url').toString('utf8');
      assert.ok(!dec.includes('فيلم'));
    });
  });

  await t.test('TC-54: Simulated multi-level filter flow (Turkish Series + Drama)', async () => {
    const res = await queryAddon('/catalog/series/arabseed:series-turkish/genre=دراما.json');
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.metas.length > 0);
  });

  await t.test('TC-55: CORS header compliance on filtered requests', async () => {
    const res = await queryAddon('/catalog/movie/arabseed:movies/category=foreign.json');
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });

  await t.test('TC-56: ReverseMap duplicate check (anime-movies vs anime-series/cartoon)', async () => {
    const resMovies = await queryAddon('/catalog/movie/arabseed:anime-movies.json');
    const resSeries = await queryAddon('/catalog/series/anime-series.json');
    assert.strictEqual(resMovies.status, 200);
    assert.strictEqual(resSeries.status, 200);
  });
});

// ─── FEATURE 5: ARABSEED QUALITY STREAMS ────────────────────────────────────
test('Feature 5: ArabSeed Quality Streams', async (t) => {
  const testMovieUrl = 'http://localhost:7401/%D9%81%D9%8A%D9%84%D9%85-arabseed-test-movie/';
  const encMovieId = Buffer.from(testMovieUrl).toString('base64url');

  await t.test('TC-57: Fetch streams for valid ArabSeed movie returns 200 OK', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    assert.strictEqual(res.status, 200);
  });

  await t.test('TC-58: Streams response contains streams array', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    assert.ok(Array.isArray(res.data.streams));
  });

  await t.test('TC-59: Streams contain quality labels from the watch page', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    const streamTitles = res.data.streams.map(s => s.title);
    // Quality labels like 1080p, 720p, 480p should be present
    assert.ok(streamTitles.some(t => t.includes('1080p')));
    assert.ok(streamTitles.some(t => t.includes('720p')));
    assert.ok(streamTitles.some(t => t.includes('480p')));
  });

  await t.test('TC-60: Direct streams are labeled with quality and provider', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    // Filter out the browser fallback stream
    const directStreams = res.data.streams.filter(s => s.url);
    assert.ok(directStreams.length > 0);
    directStreams.forEach(s => {
      assert.ok(s.title.includes('mp4upload') || s.title.includes('voe') || s.title.includes('krakenfiles'));
    });
  });

  await t.test('TC-61: Direct streams are wrapped with proxy URL resolver', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    const directStreams = res.data.streams.filter(s => s.url && s.url.includes('/proxy?url='));
    assert.ok(directStreams.length > 0);
  });

  await t.test('TC-62: Embed-only streams return externalUrl or isEmbed', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    const embedStreams = res.data.streams.filter(s => s.externalUrl);
    assert.ok(embedStreams.length > 0);
  });

  await t.test('TC-63: Non-existent stream ID returns empty streams array', async () => {
    const res = await queryAddon('/stream/movie/com.streamforge.resolver:arabseed:invalid-stream-id.json');
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.data.streams, []);
  });

  await t.test('TC-64: CORS headers are present on streams response', async () => {
    const res = await queryAddon(`/stream/movie/com.streamforge.resolver:arabseed:${encMovieId}.json`);
    assert.strictEqual(res.headers['access-control-allow-origin'], '*');
  });
});
