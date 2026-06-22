const { createFlareSolverrMock, createUrlResolverMock, createArabSeedMock } = require('./tests/e2e/mocks');
const { spawn } = require('child_process');
const axios = require('axios');

async function main() {
  const fsMock = createFlareSolverrMock(8191);
  const resolverMock = createUrlResolverMock(7400);
  const arabseedMock = createArabSeedMock(7401);

  const addonProcess = spawn('node', ['index.js'], {
    env: {
      ...process.env,
      PORT: '7100',
      ADDON_URL: 'http://localhost:7100',
      RESOLVER_URL: 'http://localhost:7400',
      FLARESOLVERR_URL: 'http://localhost:8191/v1',
      ARABSEED_URL: 'http://localhost:7401',
    },
    stdio: 'ignore'
  });

  await new Promise(r => setTimeout(r, 2000));

  console.log('--- TC-09 ---');
  try {
    const r = await axios.get('http://localhost:7100/catalog/series/animeblkom:nonexistent.json');
    console.log(r.status, JSON.stringify(r.data));
  } catch (e) {
    console.log('Error', e.message);
  }

  console.log('--- TC-15 ---');
  try {
    const r = await axios.get('http://localhost:7100/catalog/series/animeblkom:search/.json');
    console.log(r.status, JSON.stringify(r.data));
  } catch (e) {
    console.log('Error', e.message);
  }

  console.log('--- TC-16 ---');
  try {
    const r = await axios.get('http://localhost:7100/meta/series/com.streamforge.resolver:animeblkom:invalid-b64-@@@.json');
    console.log(r.status, JSON.stringify(r.data));
  } catch (e) {
    console.log('Error', e.message);
  }

  console.log('--- TC-24 ---');
  try {
    const r = await axios.get('http://localhost:7100/img/invalid-b64-string-$$$');
    console.log(r.status, r.data);
  } catch (e) {
    console.log('Error', e.response ? e.response.status : e.message);
  }

  console.log('--- TC-52 ---');
  try {
    const r = await axios.get('http://localhost:7100/catalog/movie/arabseed:movies/genre=nonexistent-genre.json');
    console.log(r.status, JSON.stringify(r.data));
  } catch (e) {
    console.log('Error', e.message);
  }

  addonProcess.kill();
  fsMock.close();
  resolverMock.close();
  arabseedMock.close();
}

main();
