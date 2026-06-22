const express = require('express');

function createFlareSolverrMock(port = 8191) {
  const app = express();
  app.use(express.json());

  app.post('/v1', (req, res) => {
    const { cmd, url } = req.body;
    if (cmd === 'sessions.list') {
      return res.json({ sessions: ['mock-session-123'] });
    }
    if (cmd === 'sessions.create') {
      return res.json({ session: 'mock-session-123' });
    }
    if (cmd === 'sessions.destroy') {
      return res.json({ status: 'ok' });
    }
    if (cmd === 'request.get') {
      if (!url || !url.startsWith('http')) {
        return res.status(400).json({ error: 'Invalid URL' });
      }
      if (url.includes('.jpg') || url.includes('.png') || url.includes('.ico') || url.includes('image')) {
        // Return a dummy base64 PNG
        const dummyPngBase64 = 'iVBORw0KGgoAAAANS4gY2FyZElkZW50aWZpZXIgdGVzdCBpbWFnZSBwYXRoCg==';
        return res.json({
          solution: {
            response: dummyPngBase64,
            cookies: [{ name: 'mock-cf-cookie', value: 'mock-val' }],
            userAgent: 'MockFlareSolverrUserAgent',
            status: 200,
            headers: { 'content-type': 'image/png' }
          }
        });
      }

      // Serve mock HTML page for AnimeBlkom based on the URL
      let html = '';
      if (url.includes('/anime-list') || url.includes('/movie-list') || url.includes('/search')) {
        const isSearch = url.includes('/search');
        const isMovies = url.includes('/movie-list');
        const pageMatch = url.match(/page=(\d+)/);
        const page = pageMatch ? parseInt(pageMatch[1]) : 1;

        if (page > 5) {
          html = `<html><div class="content-list">No items found</div></html>`;
        } else {
          // Generate 20 items
          let cards = '';
          const limit = isSearch ? 5 : 20;
          for (let i = 1; i <= limit; i++) {
            const itemNum = (page - 1) * 20 + i;
            const itemType = isMovies ? 'movie' : 'anime';
            cards += `
              <div class="content">
                <div class="poster">
                  <a href="/${itemType}/mock-${itemType}-${itemNum}">Poster ${itemNum}</a>
                </div>
                <img data-src="http://localhost:8191/img/${itemType}-${itemNum}.jpg">
                <div class="name">
                  <a href="/${itemType}/mock-${itemType}-${itemNum}">Mock ${isSearch ? 'Search Result' : 'Item'} ${itemNum}</a>
                </div>
              </div>
            `;
          }
          const nextPageLink = page < 5 ? `<a rel="next" href="${url.split('?')[0]}?page=${page + 1}">Next</a>` : '';
          html = `<html><body><div class="list">${cards}</div>${nextPageLink}</body></html>`;
        }
      } else if (url.includes('/anime/mock-anime-') || url.includes('/movie/mock-movie-')) {
        const type = url.includes('/movie/') ? 'Movie' : 'Anime';
        const idMatch = url.match(/mock-(?:anime|movie)-(\d+)/);
        const id = idMatch ? idMatch[1] : '1';

        // Meta page
        let episodes = '';
        if (type === 'Anime') {
          for (let i = 1; i <= 12; i++) {
            episodes += `
              <li class="episode-link">
                <a href="/watch/mock-anime-${id}/episode-${i}">
                  <span>الحلقة ${i}</span>
                </a>
              </li>
            `;
          }
        }
        html = `
          <html>
            <body>
              <h1 class="anime-title">Mock ${type} Title ${id}</h1>
              <img class="anime-poster" src="http://localhost:8191/img/anime-${id}.jpg">
              <div itemprop="description">This is a mock description for ${type} ${id}</div>
              <a href="/anime-list?genres=أكشن">أكشن</a>
              <a href="/anime-list?genres=مغامرة">مغامرة</a>
              <ul class="episodes">${episodes}</ul>
            </body>
          </html>
        `;
      } else if (url.includes('/watch/mock-anime-')) {
        // Episode watch page containing Blkom server data-src
        html = `
          <html>
            <body>
              <span class="server active">
                <a data-src="http://localhost:8191/embed/mock-video-123">Blkom</a>
              </span>
            </body>
          </html>
        `;
      } else if (url.includes('/embed/mock-video-')) {
        // Video embed page containing <video source[src]>
        html = `
          <html>
            <body>
              <video id="player">
                <source src="http://localhost:7400/proxy?url=https%3A%2F%2Fblkom-cdn.com%2Fvideo-1080p.mp4" label="1080p" res="1080">
                <source src="http://localhost:7400/proxy?url=https%3A%2F%2Fblkom-cdn.com%2Fvideo-720p.mp4" label="720p" res="720">
              </video>
            </body>
          </html>
        `;
      } else {
        html = `<html><body>Generic FlareSolverr Mock Response</body></html>`;
      }

      return res.json({
        solution: {
          response: html,
          cookies: [{ name: 'mock-cf-cookie', value: 'mock-val' }],
          userAgent: 'MockFlareSolverrUserAgent',
          status: 200,
          headers: { 'content-type': 'text/html' }
        }
      });
    }
    return res.status(400).json({ error: 'Unknown cmd' });
  });

  return app.listen(port, () => {
    console.log(`[Mock FS] FlareSolverr mock running on port ${port}`);
  });
}

function createUrlResolverMock(port = 7400) {
  const app = express();
  app.use(express.json());

  app.get('/extract', (req, res) => {
    const urlEnc = req.query.url;
    const urlDec = Buffer.from(urlEnc, 'base64').toString('utf-8');
    res.json({
      candidates: [
        {
          source: urlDec,
          proxyUrl: `http://localhost:${port}/proxy?url=${encodeURIComponent(urlDec)}`
        }
      ]
    });
  });

  app.get('/resolve', (req, res) => {
    const targetUrl = req.query.url;
    res.json({
      data: {
        success: true,
        results: [
          { url: `http://localhost:${port}/raw-stream?url=${encodeURIComponent(targetUrl)}` }
        ]
      }
    });
  });

  app.get('/proxy', (req, res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.alloc(100)); // 100 dummy bytes
  });

  app.get('/raw-stream', (req, res) => {
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(Buffer.alloc(100));
  });

  return app.listen(port, () => {
    console.log(`[Mock Resolver] url-resolver-v2 mock running on port ${port}`);
  });
}

function createArabSeedMock(port = 7401) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // CSRF token retrieval
  app.get('/home7/', (req, res) => {
    res.send(`
      <html>
        <head>
          <script>
            var csrf__token = "mock-arabseed-csrf-token";
          </script>
        </head>
      </html>
    `);
  });

  // Series view AJAX term__posts
  app.post('/term__posts/', (req, res) => {
    const { type, url, csrf_token } = req.body;
    const pageMatch = url.match(/page\/(\d+)/) || url.match(/page_number=(\d+)/);
    const page = pageMatch ? parseInt(pageMatch[1]) : 1;

    let cards = '';
    const limit = 20;
    for (let i = 1; i <= limit; i++) {
      const itemNum = (page - 1) * 20 + i;
      cards += `
        <a class="movie__block" href="http://localhost:${port}/selary/arabseed-series-${itemNum}/" title="ArabSeed Series ${itemNum}">
          <img data-src="http://localhost:${port}/img/series-${itemNum}.jpg">
          <div class="title___">ArabSeed Series ${itemNum}</div>
          <div class="post__category">مسلسلات</div>
        </a>
      `;
    }

    const pagination = `
      <div class="paginate">
        <a class="page-numbers" href="#">1</a>
        <a class="next page-numbers" href="${url.split('/page/')[0]}/page/${page + 1}/">Next</a>
      </div>
    `;

    res.json({
      type: 'success',
      html: cards,
      pagination: pagination
    });
  });

  // Season episodes AJAX
  app.post('/season__episodes/', (req, res) => {
    const { season_id, csrf_token, offset } = req.body;
    const start = offset ? parseInt(offset) : 0;
    const limit = 12;

    let html = '';
    // Generate episodes
    for (let i = start + 1; i <= start + limit; i++) {
      html += `
        <a href="http://localhost:${port}/watch/arabseed-series-s1-eps${i}/">
          <div class="epi__num"><b>${i}</b></div>
        </a>
      `;
    }

    res.json({
      type: 'success',
      html: html,
      hasmore: start < 12 // Allow second page to test pagination
    });
  });

  // Search AJAX find__posts
  app.post('/find__posts/', (req, res) => {
    const { search, search_type, csrf_token } = req.body;
    let cards = '';
    // Return mock results matching search word
    for (let i = 1; i <= 5; i++) {
      const isMovie = search_type !== 'series';
      const slug = isMovie ? `فيلم-arabseed-movie-${i}` : `selary/arabseed-series-${i}`;
      const title = isMovie ? `فيلم ArabSeed Movie ${search} ${i}` : `ArabSeed Series ${search} ${i}`;
      cards += `
        <a class="movie__block" href="http://localhost:${port}/${slug}/">
          <div class="post__info"><h3>${title}</h3></div>
          <img data-src="http://localhost:${port}/img/search-${i}.jpg">
          <div class="__quality">1080p</div>
          <div class="post__category">${isMovie ? 'أفلام' : 'مسلسلات'}</div>
        </a>
      `;
    }

    res.json({
      type: 'success',
      html: cards
    });
  });

  // Normal Movie and other catalogs
  const serveCatalog = (req, res) => {
    const path = req.path;
    const pageNumMatch = path.match(/\/page\/(\d+)/);
    let page = pageNumMatch ? parseInt(pageNumMatch[1]) : 1;
    if (req.query.page_number) {
      page = parseInt(req.query.page_number);
    }

    if (page > 5) {
      return res.send(`<html><body><div class="paginate"></div></body></html>`);
    }

    let cards = '';
    const isMovieCat = path.includes('movies') || path.includes('foreign-movies');
    for (let i = 1; i <= 20; i++) {
      const itemNum = (page - 1) * 20 + i;
      const isMovie = isMovieCat || (path.includes('/genre/') && i % 2 === 1);
      const slug = isMovie ? `فيلم-arabseed-movie-${itemNum}` : `selary/arabseed-series-${itemNum}`;
      const title = isMovie ? `فيلم ArabSeed Movie ${itemNum}` : `ArabSeed Series ${itemNum}`;
      const category = isMovie ? 'أفلام' : 'مسلسلات';
      cards += `
        <a class="movie__block" href="http://localhost:${port}/${slug}/">
          <div class="post__info"><h3>${title}</h3></div>
          <img data-src="http://localhost:${port}/img/item-${itemNum}.jpg">
          <div class="__quality">1080p</div>
          <div class="post__category">${category}</div>
        </a>
      `;
    }

    const nextLink = `<a class="next page-numbers" href="${path.split('/page/')[0]}/page/${page + 1}/">Next</a>`;
    res.send(`
      <html>
        <body>
          <div class="movie__block__list">${cards}</div>
          <div class="paginate">${nextLink}</div>
        </body>
      </html>
    `);
  };

  app.get('/movies/*', serveCatalog);
  app.get('/movies/', serveCatalog);
  app.get('/category/*', serveCatalog);
  app.get('/genre/*', (req, res, next) => {
    if (req.path.includes('nonexistent-genre')) {
      return res.send(`<html><body><div class="movie__block__list"></div><div class="paginate"></div></body></html>`);
    }
    serveCatalog(req, res);
  });
  app.get('/main10/', serveCatalog);
  app.get('/main/', serveCatalog);
  app.get('/recently3/', serveCatalog);
  app.get('/trend2/', serveCatalog);

  // Fallback search page
  app.get('/find/', (req, res) => {
    const { word, type } = req.query;
    let cards = '';
    for (let i = 1; i <= 5; i++) {
      const isMovie = type !== 'series';
      const slug = isMovie ? `فيلم-arabseed-movie-${i}` : `selary/arabseed-series-${i}`;
      const title = isMovie ? `فيلم ArabSeed Movie ${word} ${i}` : `ArabSeed Series ${word} ${i}`;
      cards += `
        <a class="movie__block" href="http://localhost:${port}/${slug}/">
          <div class="post__info"><h3>${title}</h3></div>
          <img data-src="http://localhost:${port}/img/search-${i}.jpg">
          <div class="__quality">1080p</div>
          <div class="post__category">${isMovie ? 'أفلام' : 'مسلسلات'}</div>
        </a>
      `;
    }
    res.send(`<html><body><div class="list">${cards}</div></body></html>`);
  });

  // Series details page (selary)
  app.get('/selary/:slug/', (req, res) => {
    const { slug } = req.params;
    res.send(`
      <html>
        <body>
          <h1 class="post__name">ArabSeed Series Title ${slug}</h1>
          <div class="poster__single">
            <img data-src="http://localhost:${port}/img/series-${slug}.jpg">
          </div>
          <div class="single__contents">
            <div class="post__story">
              <p>Description of mock series ${slug}</p>
            </div>
          </div>
          <div class="__genre">دراما</div>
          <div class="__genre">رعب</div>
          <div id="seasons__list">
            <ul>
              <li data-term="999">الموسم 1</li>
              <li data-term="1000">الموسم 2</li>
            </ul>
          </div>
        </body>
      </html>
    `);
  });

  // Movie watch page
  app.get(['/فيلم-:slug/watch/', '/%D9%81%D9%8A%D9%84%D9%85-:slug/watch/'], (req, res) => {
    const { slug } = req.params;
    res.send(`
      <html>
        <body>
          <div class="qualities__list">
            <ul>
              <li class="active" data-quality="1080p">1080p</li>
              <li data-quality="720p">720p</li>
              <li data-quality="480p">480p</li>
            </ul>
          </div>
          <div data-quality="1080p">
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly9tcDR1cGxvYWQuY29tLzEwODBw"><span>mp4upload</span></li>
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly92b2Uuc3gvMTA4MHA="><span>voe</span></li>
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly9rcmFrZW5maWxlcy5jb20vMTA4MHA="><span>krakenfiles</span></li>
          </div>
          <div data-quality="720p">
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly9tcDR1cGxvYWQuY29tLzcyMHA="><span>mp4upload</span></li>
          </div>
          <div data-quality="480p">
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly9tcDR1cGxvYWQuY29tLzQ4MHA="><span>mp4upload</span></li>
          </div>
        </body>
      </html>
    `);
  });

  // Episode watch page
  app.get('/watch/:slug/watch/', (req, res) => {
    const { slug } = req.params;
    res.send(`
      <html>
        <body>
          <div class="qualities__list">
            <ul>
              <li class="active" data-quality="1080p">1080p</li>
            </ul>
          </div>
          <div data-quality="1080p">
            <li data-link="http://localhost:${port}/play.php?url=aHR0cHM6Ly9tcDR1cGxvYWQuY29tLzEwODBw"><span>mp4upload</span></li>
          </div>
        </body>
      </html>
    `);
  });

  app.get('/play.php', (req, res) => {
    res.send('Player Page');
  });

  return app.listen(port, () => {
    console.log(`[Mock ArabSeed] ArabSeed mock running on port ${port}`);
  });
}

module.exports = {
  createFlareSolverrMock,
  createUrlResolverMock,
  createArabSeedMock,
};
