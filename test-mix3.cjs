/** Debug MixDrop - extract video URL from packed dictionary directly */
const axios = require('axios');

const URL = 'https://miixdrop.net/e/mk10mx46b9z3zx';

async function main() {
  const resp = await axios.get(URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0' },
    timeout: 10000, maxRedirects: 5,
  });
  
  const html = resp.data;
  
  // Extract the packed JS dictionary: '...words...'.split('|')
  const dictMatch = html.match(/'(MDCore[^']+)'\.split\('\|'\)/);
  if (dictMatch) {
    const dict = dictMatch[1].split('|');
    console.log('Dictionary entries:');
    dict.forEach((word, i) => console.log(`  ${i}: ${word}`));
    
    // The packed code uses numbered references: 0.25 means dict[0].dict[25]
    // We know 0=MDCore, 25=position of the URL value
    // Let's reconstruct: 0.25="//2.3.5/9/6.10"
    // Where numbers map to dictionary entries
    const baseUrl = `https://${dict[2]}.${dict[3]}.${dict[4]}/${dict[9]}/${dict[12]}/${dict[6]}.${dict[10]}`;
    console.log(`\nReconstructed URL: ${baseUrl}`);
    
    // Also try the wurl pattern with token
    // 0.12="//2.3.5/13/6.4?14=8&16=15&17=18"
    // 13=v2, 4=? (actually this is the timestamp), 8=token value, 15=expiry
    const wurlBase = `https://${dict[2]}.${dict[3]}.${dict[4]}/${dict[13]}/${dict[12]}/${dict[6]}.${dict[10]}?${dict[14]}=${dict[8]}&${dict[16]}=${dict[15]}&${dict[17]}=${dict[18]}`;
    console.log(`Reconstructed with token: ${wurlBase}`);
  }
  
  // Also try simpler approach - extract the packed string and manually decode
  const packedStr = html.match(/'((?:[^']|\\')+?)',\s*10,\s*26,\s*'/);
  if (packedStr) {
    console.log('\nPacked string start:', packedStr[1].substring(0, 100));
  }
}

main().catch(e => console.error('Error:', e.message));
