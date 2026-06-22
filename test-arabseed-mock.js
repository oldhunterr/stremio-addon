const assert = require('assert');

// 1. Mock lib/fetch module before importing the scraper
const fetchModule = require('./lib/fetch');

const mockFetchHtmls = {};
let fetchedUrls = [];

fetchModule.fetchPage = async function(url, referer, opts) {
  fetchedUrls.push(url);
  if (url.includes('/home7/')) {
    return `<html><script>var csrf__token = "e5a2dc73bf";</script></html>`;
  }
  if (mockFetchHtmls[url]) {
    return mockFetchHtmls[url];
  }
  return '';
};

// 2. Mock axios client before importing the scraper
const axios = require('axios');
const originalCreate = axios.create;
const mockAjaxResponses = {};
let postedUrls = [];

axios.create = function(config) {
  const instance = originalCreate.call(axios, config);
  
  instance.post = async function(url, data, config) {
    postedUrls.push({ url, data });
    
    if (url.includes('/term__posts/')) {
      const params = new URLSearchParams(data);
      const reqUrl = params.get('url');
      
      // Genre filter series view mock
      if (reqUrl && reqUrl.includes('genre/%D8%AF%D8%B1%D8%A7%D9%85%D8%A7')) {
        return {
          data: {
            type: 'success',
            html: `
              <a href="https://a.asd.ink/selary/genre-series-1/" title="Genre Series 1">
                <img data-src="https://a.asd.ink/img-gs1.jpg">
                <span class="post__category">مسلسل دراما</span>
              </a>
              <a href="https://a.asd.ink/فيلم-genre-movie-1/" title="Genre Movie 1">
                <img data-src="https://a.asd.ink/img-gm1.jpg">
                <span class="post__category">فيلم دراما</span>
              </a>
            `,
            pagination: ''
          }
        };
      }
      
      // Page 2 series view mock
      if (reqUrl && reqUrl.includes('page/2')) {
        return {
          data: {
            type: 'success',
            html: `
              <a href="https://a.asd.ink/selary/series-page2/" title="Series Page 2">
                <img data-src="https://a.asd.ink/img-s2.jpg">
                <span class="post__category">مسلسلات عربية</span>
              </a>
            `,
            pagination: ''
          }
        };
      }
      
      // Default series view mock (page 1)
      return {
        data: {
          type: 'success',
          html: `
            <a href="https://a.asd.ink/selary/series-page1/" title="Series Page 1">
              <img data-src="https://a.asd.ink/img-s1.jpg">
              <span class="post__category">مسلسلات عربية</span>
            </a>
          `,
          pagination: `<a class="next page-numbers" href="/series/page/2/">Next</a>`
        }
      };
    }
    
    return { data: { type: 'success', html: '' } };
  };
  
  instance.get = async function(url, config) {
    if (url.includes('/watch/')) {
      return { data: mockFetchHtmls[url] || '' };
    }
    return { data: '' };
  };
  
  return instance;
};

// 3. Import the scraper
const scraper = require('./sources/arabseed/index');

// Setup mock HTML pages
mockFetchHtmls['https://a.asd.ink/movies/'] = `
  <html>
    <body>
      <a class="movie__block" href="https://a.asd.ink/فيلم-movie-1/">
        <div class="post__info"><h3>Movie 1</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img1.jpg">
        <span class="__quality">1080p</span>
        <span class="post__category">أفلام أجنبية</span>
      </a>
      <div class="paginate">
        <a class="next page-numbers" href="/movies/page/2/">Next</a>
      </div>
    </body>
  </html>
`;

mockFetchHtmls['https://a.asd.ink/movies/page/2/'] = `
  <html>
    <body>
      <a class="movie__block" href="https://a.asd.ink/فيلم-movie-2/">
        <div class="post__info"><h3>Movie 2</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img2.jpg">
        <span class="__quality">720p</span>
        <span class="post__category">أفلام أجنبية</span>
      </a>
    </body>
  </html>
`;

mockFetchHtmls['https://a.asd.ink/main/'] = `
  <html>
    <body>
      <a class="movie__block" href="https://a.asd.ink/فيلم-browse-1/">
        <div class="post__info"><h3>Browse Movie 1</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img3.jpg">
        <span class="__quality">1080p</span>
        <span class="post__category">أفلام أجنبية</span>
      </a>
    </body>
  </html>
`;

mockFetchHtmls['https://a.asd.ink/main/?page_number=2'] = `
  <html>
    <body>
      <a class="movie__block" href="https://a.asd.ink/فيلم-browse-2/">
        <div class="post__info"><h3>Browse Movie 2</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img4.jpg">
        <span class="__quality">720p</span>
        <span class="post__category">أفلام أجنبية</span>
      </a>
    </body>
  </html>
`;

// Setup categories URLs mocked fetching
const catUrls = [
  'https://a.asd.ink/category/classic-movies/',
  'https://a.asd.ink/category/korean-series/',
  'https://a.asd.ink/category/egyptian-series/',
  'https://a.asd.ink/category/indian-series/',
  'https://a.asd.ink/category/netflix-movies/',
  'https://a.asd.ink/category/netflix-series/',
  'https://a.asd.ink/recently/',
  'https://a.asd.ink/trend/'
];
for (const u of catUrls) {
  mockFetchHtmls[u] = `
    <html>
      <body>
        <a class="movie__block" href="${u}item-1/">
          <div class="post__info"><h3>Item 1</h3></div>
          <img class="images__loader" data-src="https://a.asd.ink/img.jpg">
          <span class="__quality">HD</span>
          <span class="post__category">أفلام</span>
        </a>
      </body>
    </html>
  `;
}

mockFetchHtmls['https://a.asd.ink/genre/%D8%AF%D8%B1%D8%A7%D9%85%D8%A7/'] = `
  <html>
    <body>
      <a class="movie__block" href="https://a.asd.ink/فيلم-mixed-movie-1/">
        <div class="post__info"><h3>Mixed Movie 1</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img1.jpg">
        <span class="__quality">1080p</span>
        <span class="post__category">أفلام عربية</span>
      </a>
      <a class="movie__block" href="https://a.asd.ink/مسلسل-mixed-series-1/">
        <div class="post__info"><h3>Mixed Series 1</h3></div>
        <img class="images__loader" data-src="https://a.asd.ink/img2.jpg">
        <span class="__quality">HD</span>
        <span class="post__category">مسلسلات عربية</span>
      </a>
    </body>
  </html>
`;

mockFetchHtmls['https://a.asd.ink/watch-page/watch/'] = `
  <html>
    <body>
      <ul class="qualities__list">
        <li data-quality="720p" class="active">720p</li>
        <li data-quality="1080p">1080p</li>
      </ul>

      <!-- Container 1: class names with 1080p -->
      <div class="quality-container-1080p">
        <ul>
          <li data-link="/play.php?url=aHR0cHM6Ly93d3cubXA0dXBsb2FkLmNvbS8xNDgwMGFhY2VzLm1wNA==">
            <span>Server 1080p MP4Upload</span>
          </li>
          <li data-link="/play.php?url=aHR0cHM6Ly93d3cubXA0dXBsb2FkLmNvbS8xNDgwMGFhY2VzMi5tcDQ=" data-quality="1080p">
            <span>Server 1080p Direct Quality</span>
          </li>
        </ul>
      </div>

      <!-- Container 2: parent container class has 480p -->
      <div class="server-list-480p">
        <ul>
          <li data-link="/play.php?url=aHR0cHM6Ly9kYWlseW1vdGlvbi5jb20vZW1iZWQvdmlkZW8veDN2NmI4">
            <span>Server 480p Dailymotion</span>
          </li>
        </ul>
      </div>

      <!-- Container 3: direct attribute data-quality="360p" -->
      <div>
        <ul>
          <li data-link="/play.php?url=aHR0cHM6Ly9vay5ydS92aWRlby8xMjM0NTY3ODkw" data-quality="360p">
            <span>Server 360p Okru</span>
          </li>
        </ul>
      </div>

      <!-- Container 4: fallback to active (720p) -->
      <div>
        <ul>
          <li data-link="/play.php?url=aHR0cHM6Ly92aWRlYS5odS9wbGF5LzEyMzQ1Njc4OTA=">
            <span>Server Fallback Videa</span>
          </li>
        </ul>
      </div>
    </body>
  </html>
`;


async function runTests() {
  console.log('Starting ArabSeed Scraper Fixes Verification...\n');

  // Test 1: Movies catalog pagination
  console.log('--- Test 1: Movies Catalog Pagination ---');
  fetchedUrls = [];
  const moviesP2 = await scraper.getCatalog('movies', 2);
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/movies/page/2/'), true, 'Should fetch page 2 from correct normalized URL');
  assert.strictEqual(moviesP2.items.length, 1, 'Should parse 1 item from page 2');
  assert.strictEqual(moviesP2.items[0].title, 'Movie 2', 'Item title should match Movie 2');
  console.log('Test 1 Passed: Movies Catalog Pagination matches active path and /page/2/.\n');

  // Test 2: Browse and Others catalog pagination (?page_number=N)
  console.log('--- Test 2: Browse Catalog Pagination ---');
  fetchedUrls = [];
  const browseP2 = await scraper.getCatalog('browse', 2);
  console.log('fetchedUrls is:', fetchedUrls);
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/main/?page_number=2'), true, 'Should fetch page 2 with ?page_number=2 query param');
  assert.strictEqual(browseP2.items.length, 1, 'Should parse 1 item');
  assert.strictEqual(browseP2.items[0].title, 'Browse Movie 2', 'Item title should match');
  console.log('Test 2 Passed: Browse Catalog Pagination uses ?page_number=2.\n');

  // Test 3: Normalizing categories and legacy URLs
  console.log('--- Test 3: Normalized subcategory/category endpoints ---');
  
  // movies-classic
  fetchedUrls = [];
  await scraper.getCatalog('movies', 1, { category: 'classic' });
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/category/classic-movies/'), true, 'classic category should normalize to modern English classic-movies');

  // series-korean
  postedUrls = [];
  await scraper.getCatalog('series', 1, { category: 'korean' });
  assert.strictEqual(postedUrls[0].data.includes('url=%2Fcategory%2Fkorean-series%2F'), true, 'korean series category should normalize to modern English korean-series');

  // movies-netflix
  fetchedUrls = [];
  await scraper.getCatalog('movies', 1, { category: 'netflix' });
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/category/netflix-movies/'), true, 'netflix movie category should normalize flat to netflix-movies');

  // series-netflix
  postedUrls = [];
  await scraper.getCatalog('series', 1, { category: 'netflix' });
  assert.strictEqual(postedUrls[0].data.includes('url=%2Fcategory%2Fnetflix-series%2F'), true, 'netflix series category should normalize flat to netflix-series');

  // recently
  fetchedUrls = [];
  await scraper.getCatalog('recently', 1);
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/recently/'), true, 'recently catalog should map to active path recently');

  // trending
  fetchedUrls = [];
  await scraper.getCatalog('trending', 1);
  assert.strictEqual(fetchedUrls.includes('https://a.asd.ink/trend/'), true, 'trending catalog should map to active path trend');

  console.log('Test 3 Passed: Legacy paths restored, percent-encoded slugs converted, netflix paths flattened.\n');

  // Test 4: Series Catalog Pagination via loadSeriesView
  console.log('--- Test 4: Series Catalog Pagination via loadSeriesView ---');
  postedUrls = [];
  const seriesP2 = await scraper.getCatalog('series', 2);
  assert.strictEqual(postedUrls.length > 0, true, 'Should call term__posts AJAX');
  assert.strictEqual(postedUrls[0].data.includes('url=%2Fseries%2Fpage%2F2%2F'), true, 'Should pass series paginated URL path to loadSeriesView');
  assert.strictEqual(seriesP2.items.length, 1, 'Should return page 2 items');
  assert.strictEqual(seriesP2.items[0].title, 'Series Page 2', 'Title should be Series Page 2');
  console.log('Test 4 Passed: Series Catalog Pagination correctly passes page to loadSeriesView.\n');

  // Test 5: ReverseMap Conflict Resolution
  console.log('--- Test 5: ReverseMap Conflict Resolution ---');
  // Anime catalog with 'series' subcategory -> should map to 'anime-series'
  postedUrls = [];
  await scraper.getCatalog('anime', 1, { category: 'series' });
  assert.strictEqual(postedUrls[0].data.includes('url=%2Fcategory%2Fcartoon-series%2F'), true, 'anime series subcategory should resolve to anime-series -> cartoon-series');

  // Regular series catalog with 'series' subcategory -> should map to 'series-cartoon' -> cartoon-series
  postedUrls = [];
  await scraper.getCatalog('series', 1, { category: 'cartoon' });
  assert.strictEqual(postedUrls[0].data.includes('url=%2Fcategory%2Fcartoon-series%2F'), true, 'series cartoon subcategory should resolve to series-cartoon -> cartoon-series');
  
  console.log('Test 5 Passed: ReverseMap conflicts for cartoon/series subcategories resolved based on catalogId.\n');

  // Test 6: Card Filtering & Category Extraction
  console.log('--- Test 6: Card Filtering & Category Extraction ---');
  
  // Mixed genre page fetch
  fetchedUrls = [];
  const moviesGenre = await scraper.getCatalog('movies', 1, { genre: 'دراما', type: 'movie' });
  assert.strictEqual(moviesGenre.items.length, 1, 'Should only return movies');
  assert.strictEqual(moviesGenre.items[0].title, 'Mixed Movie 1', 'Title should match');
  assert.strictEqual(moviesGenre.items[0].category, 'أفلام عربية', 'Category should be extracted from .post__category');

  // Series genre page via AJAX loadSeriesView
  postedUrls = [];
  const seriesGenre = await scraper.getCatalog('series', 1, { genre: 'دراما', type: 'series' });
  assert.strictEqual(seriesGenre.items.length, 1, 'Should only return series');
  assert.strictEqual(seriesGenre.items[0].title, 'Genre Series 1', 'Title should match');
  assert.strictEqual(seriesGenre.items[0].category, 'مسلسل دراما', 'Category should be extracted from .post__category');

  console.log('Test 6 Passed: 3-level filters, card category extraction, content-type mapping, and strict type matching function correctly.\n');

  // Test 7: Stream Quality Extraction
  console.log('--- Test 7: Stream Quality Extraction ---');
  const encodedId = Buffer.from('/watch-page/').toString('base64url');
  const streams = await scraper.getStreams(encodedId);

  // We expect 6 streams: 5 from watchDataLinks + 1 Open in Browser fallback
  assert.strictEqual(streams.length, 6, 'Should return 6 streams total');

  const mp4upload = streams.find(s => s.label.includes('MP4Upload'));
  assert.strictEqual(mp4upload.quality, '1080p', 'Should resolve 1080p from ancestor class');

  const direct = streams.find(s => s.label.includes('Direct Quality'));
  assert.strictEqual(direct.quality, '1080p', 'Should resolve 1080p from element data-quality');

  const dailymotion = streams.find(s => s.label.includes('Dailymotion'));
  assert.strictEqual(dailymotion.quality, '480p', 'Should resolve 480p from ancestor class');

  const okru = streams.find(s => s.label.includes('Okru'));
  assert.strictEqual(okru.quality, '360p', 'Should resolve 360p from element data-quality');

  const videa = streams.find(s => s.label.includes('Videa'));
  assert.strictEqual(videa.quality, '720p', 'Should fallback to active quality (720p)');

  console.log('Test 7 Passed: Hierarchical quality extraction resolved correctly for each server individually.\n');

  // Test 8: Non-existent Genre Fallback
  console.log('--- Test 8: Non-existent Genre Fallback ---');
  const nonexistentGenreResult = await scraper.getCatalog('movies', 1, { genre: 'nonexistent-genre' });
  assert.deepStrictEqual(nonexistentGenreResult, { items: [], hasNextPage: false }, 'Should return empty catalog immediately for nonexistent genre');
  console.log('Test 8 Passed: Non-existent genre filter returns empty catalog.\n');

  console.log('All tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test suite failed with error:', err);
  process.exit(1);
});
