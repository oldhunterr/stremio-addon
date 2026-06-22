/** Investigate VOE: can we extract without Playwright? */
const axios = require('axios');
const { unpack } = require('./lib/unpacker');

const URL = 'https://juliewomanwish.com/e/fffs5owkhdr8';

async function main() {
  // VOE redirects to juliewomanwish.com
  try {
    const resp = await axios.get(URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0' },
      timeout: 10000, maxRedirects: 5,
    });
    
    const html = resp.data;
    console.log('VOE page size:', html.length, 'bytes');
    console.log('Title:', html.match(/<title>([^<]+)/i)?.[1] || '?');
    
    // Check for jwplayer
    const hasJW = html.includes('jwplayer');
    console.log('Has JW Player:', hasJW);
    
    // Check for packed JS
    const unpacked = unpack(html);
    console.log('Unpacker modified:', unpacked !== html);
    
    const m3u8 = unpacked.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/i);
    const mp4 = unpacked.match(/https?:\/\/[^"'\s]+\.mp4[^"'\s]*/i);
    
    if (m3u8) console.log('HLS:', m3u8[0]);
    if (mp4) console.log('MP4:', mp4[0]);
    
    // Check for cloudwindow/streamruby patterns
    const cloudUrls = html.match(/https?:\/\/[^"'\s]*(?:cloudwindow|streamruby)[^"'\s]*\.(?:m3u8|mp4)[^"'\s]*/gi);
    if (cloudUrls) {
      console.log('Cloud URLs found in HTML:', cloudUrls.length);
      cloudUrls.forEach(u => console.log('  ' + u.substring(0, 80)));
    }
    
    // Check for data-config or sources
    const sources = html.match(/sources[^=]*=[^;]*/gi);
    if (sources) {
      sources.slice(0, 3).forEach(s => console.log('Source:', s.substring(0, 150)));
    }
    
  } catch (err) {
    console.error('Fetch error:', err.message);
  }
}

main();
