const express = require('express');
const axios = require('axios');
const assert = require('assert');
const path = require('path');

// 1. Start Mock Server
const app = express();
app.use(express.json());

let sessionCreatedCount = 0;
let sessionListCount = 0;
let sessions = [];
let requestGetCount = 0;
let requestGetParams = [];
let destroyedSessions = [];
let directImageFetchCount = 0;
let directImageHeaders = null;

app.post('/v1', (req, res) => {
  const { cmd, session, url } = req.body;
  if (cmd === 'sessions.create') {
    sessionCreatedCount++;
    const newSessionId = `session_${Date.now()}_${sessionCreatedCount}`;
    sessions.push(newSessionId);
    return res.json({ status: 'ok', message: 'Session created successfully.', session: newSessionId });
  }
  
  if (cmd === 'sessions.list') {
    sessionListCount++;
    return res.json({ status: 'ok', sessions: sessions });
  }

  if (cmd === 'sessions.destroy') {
    destroyedSessions.push(session);
    sessions = sessions.filter(s => s !== session);
    return res.json({ status: 'ok', message: 'Session destroyed.' });
  }

  if (cmd === 'request.get') {
    requestGetCount++;
    requestGetParams.push(req.body);
    if (url && url.includes('/fallback-image')) {
      return res.json({
        status: 'ok',
        solution: {
          url: url,
          status: 200,
          cookies: [{ name: 'cf_clearance', value: 'fallback_clearance' }],
          userAgent: 'Mozilla/5.0 (Fallback UA)',
          headers: { 'content-type': 'image/png' },
          response: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
      });
    }
    
    if (url && url.includes('/anime-list')) {
      return res.json({
        status: 'ok',
        solution: {
          url: url,
          status: 200,
          cookies: [{ name: 'cf_clearance', value: 'mocked_cf_clearance' }],
          userAgent: 'Mozilla/5.0 (Mocked UA)',
          headers: { 'content-type': 'text/html' },
          response: `
            <div class="content">
              <div class="poster">
                <a href="/anime/naruto">
                  <img src="https://www.animeblkom.com/naruto.jpg" />
                </a>
              </div>
              <div class="name">
                <a href="/anime/naruto">Naruto</a>
              </div>
            </div>
          `
        }
      });
    }
    
    if (url && url.includes('/anime/')) {
      return res.json({
        status: 'ok',
        solution: {
          url: url,
          status: 200,
          cookies: [{ name: 'cf_clearance', value: 'mocked_cf_clearance' }],
          userAgent: 'Mozilla/5.0 (Mocked UA)',
          headers: { 'content-type': 'text/html' },
          response: `
            <h1 class="anime-title">Naruto</h1>
            <img class="anime-poster" src="https://www.animeblkom.com/naruto.jpg" />
            <div itemprop="description">The story of Naruto.</div>
            <a href="https://www.animeblkom.com/search?genres=action">أكشن</a>
            <li class="episode-link">
              <a href="/watch/naruto/1">الحلقة 1</a>
              <span>1</span>
            </li>
          `
        }
      });
    }

    // Default challenge solve
    return res.json({
      status: 'ok',
      solution: {
        url: url || '',
        status: 200,
        cookies: [{ name: 'cf_clearance', value: 'mocked_cf_clearance' }],
        userAgent: 'Mozilla/5.0 (Mocked UA)',
        headers: { 'content-type': 'text/html' },
        response: '<html>Mocked page solution</html>'
      }
    });
  }
  res.status(400).json({ status: 'error', message: `Unknown command: ${cmd}` });
});

app.get('/direct-image', (req, res) => {
  directImageFetchCount++;
  directImageHeaders = req.headers;
  if (req.headers.cookie && req.headers.cookie.includes('mocked_cf_clearance')) {
    res.set('content-type', 'image/png');
    res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  } else {
    res.status(403).send('Forbidden - missing cookies');
  }
});

app.get('/fallback-image', (req, res) => {
  res.status(403).send('Forbidden - Cloudflare challenge');
});

const server = app.listen(8192, async () => {
  console.log('Mock FlareSolverr running on port 8192');
  
  // Set Env Var before requiring fetch.js
  process.env.FLARESOLVERR_URL = 'http://localhost:8192/v1';
  
  const { fetchPage, fetchImage, destroyFSSession } = require('./lib/fetch');
  
  try {
    // Test 1: Concurrency and Session Creation
    // Trigger two parallel calls to fetchPage to simulate concurrent page fetches
    console.log('\n--- Running Test 1: Concurrent getFSSession requests ---');
    const p1 = fetchPage('http://localhost:8192/page1', undefined, { useFS: true, noCache: true });
    const p2 = fetchPage('http://localhost:8192/page2', undefined, { useFS: true, noCache: true });
    await Promise.all([p1, p2]);
    
    console.log(`Created sessions: ${sessionCreatedCount}`);
    assert.strictEqual(sessionCreatedCount, 1, 'Only one session should be created due to concurrency check');
    
    // Test 2: Active Session lookup on restart
    // We simulate a restart by resetting the local memory in fetch.js
    console.log('\n--- Running Test 2: Active session adoption on "restart" ---');
    delete require.cache[require.resolve('./lib/fetch')];
    const { fetchPage: fetchPage2, fetchImage: fetchImage2 } = require('./lib/fetch');
    
    sessionListCount = 0;
    sessionCreatedCount = 0;
    
    await fetchPage2('http://localhost:8192/page3', undefined, { useFS: true, noCache: true });
    console.log(`List sessions count: ${sessionListCount}`);
    console.log(`Created sessions count: ${sessionCreatedCount}`);
    assert.strictEqual(sessionListCount, 1, 'Should call sessions.list on fresh import');
    assert.strictEqual(sessionCreatedCount, 0, 'Should adopt the existing session, not create a new one');

    // Test 3: fetchImage direct axios fetch with cookies/UA
    console.log('\n--- Running Test 3: fetchImage direct download ---');
    directImageFetchCount = 0;
    const imgRes = await fetchImage2('http://localhost:8192/direct-image', 'http://localhost:8192');
    assert.ok(imgRes, 'Image should be fetched successfully');
    assert.strictEqual(directImageFetchCount, 1, 'Should fetch directly using axios');
    assert.ok(directImageHeaders.cookie && directImageHeaders.cookie.includes('mocked_cf_clearance'), 'Cookies should be passed correctly');
    assert.strictEqual(directImageHeaders['user-agent'], 'Mozilla/5.0 (Mocked UA)', 'User-Agent should be passed correctly');

    // Test 4: fetchImage fallback to FlareSolverr when direct fetch fails
    console.log('\n--- Running Test 4: fetchImage fallback to FlareSolverr ---');
    requestGetCount = 0;
    const fallbackRes = await fetchImage2('http://localhost:8192/fallback-image', 'http://localhost:8192');
    assert.ok(fallbackRes, 'Image should be fetched via fallback');
    assert.strictEqual(requestGetCount, 1, 'Should call FlareSolverr request.get command');
    
    console.log('\n--- All Fetch tests passed successfully! ---');

    // Test 5: Verify catalog and meta endpoint URL wrapping in index.js
    console.log('\n--- Running Test 5: Verify catalog/meta URL wrapping ---');
    
    process.env.PORT = 7101;
    process.env.ADDON_URL = 'http://localhost:7101';
    
    const serverIndexObj = require('./index');
    await new Promise(r => setTimeout(r, 1000));
    
    // Request catalog of animeblkom (which has PROXY_IMAGES = true)
    const catRes = await axios.get('http://localhost:7101/catalog/anime/animeblkom.json');
    const metas = catRes.data.metas;
    console.log(`Metas returned: ${metas.length}`);
    if (metas.length > 0) {
      const poster = metas[0].poster;
      console.log(`Poster URL: ${poster}`);
      assert.ok(poster.startsWith('http://localhost:7101/img/'), 'Poster URL should be wrapped in proxy route');
    } else {
      assert.fail('No catalog metas returned from animeblkom');
    }
    
    // Request meta of animeblkom item
    if (metas.length > 0) {
      const fullMetaId = metas[0].id;
      const metaRes = await axios.get(`http://localhost:7101/meta/anime/${fullMetaId}.json`);
      const meta = metaRes.data.meta;
      console.log(`Meta title: ${meta.name}`);
      console.log(`Meta poster: ${meta.poster}`);
      console.log(`Meta background: ${meta.background}`);
      assert.ok(meta.poster.startsWith('http://localhost:7101/img/'), 'Meta poster should be wrapped');
      assert.ok(meta.background.startsWith('http://localhost:7101/img/'), 'Meta background should be wrapped');
    }
    
    console.log('--- All tests passed! ---');
    process.exit(0);
  } catch (error) {
    console.error('Test Failed:', error);
    process.exit(1);
  }
});
