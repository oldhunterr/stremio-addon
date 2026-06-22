/** Test mixdrop with working URL */
const axios = require('axios');
const { unpack } = require('./lib/unpacker');

const URL = 'https://miixdrop.net/e/mk10mx46b9z3zx';

async function main() {
  const resp = await axios.get(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0' },
    timeout: 10000,
    maxRedirects: 5,
  });
  
  const html = resp.data;
  const unpacked = unpack(html);
  
  console.log('=== Full unpacked JS ===');
  console.log(unpacked);
  
  // Look for video URLs
  const m3u8s = unpacked.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/gi);
  if (m3u8s) {
    console.log('\n=== Video URLs ===');
    m3u8s.forEach(u => console.log(u));
  }
  
  // Look for any URL pattern with video keywords
  const urls = unpacked.match(/https?:\/\/[^"'\s<>)]+/g);
  if (urls) {
    const videoUrls = urls.filter(u => u.includes('video') || u.includes('stream') || u.includes('hls') || u.includes('media'));
    if (videoUrls.length) {
      console.log('\n=== Video-related URLs ===');
      videoUrls.forEach(u => console.log(u));
    }
  }
}

main().catch(e => console.error('Error:', e.message));
