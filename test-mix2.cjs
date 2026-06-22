/** Debug MixDrop extraction */
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

  // Check for MDCore patterns
  const furlMatch = unpacked.match(/MDCore\.(furl|wurl)\s*=\s*["']([^"']+)["']/);
  if (furlMatch) {
    console.log('Match:', furlMatch[1], '=', furlMatch[2]);
  } else {
    console.log('No MDCore URL match');
    
    // Try all MDCore.* patterns
    const allMd = unpacked.match(/MDCore\.[^=]+=\s*["'][^"']+["']/g);
    if (allMd) {
      console.log('\nAll MDCore assignments:');
      allMd.forEach(a => console.log('  ' + a));
    }
    
    // Search for any URL in unpacked
    const urls = unpacked.match(/https?:\/\/[^"'\s<>)]+/g);
    if (urls) {
      console.log('\nURLs in unpacked:');
      urls.slice(0, 5).forEach(u => console.log('  ' + u));
    }
    
    // Check if unpack returned the same as raw HTML
    const isSame = unpacked === html;
    console.log('\nUnpacker returned same as input:', isSame);
    console.log('HTML length:', html.length);
    console.log('Unpacked length:', unpacked.length);
    
    // Check raw HTML for MDCore
    const rawMd = html.match(/MDCore\.[^=]+=\s*["'][^"']+["']/g);
    if (rawMd) {
      console.log('\nMDCore in raw HTML:');
      rawMd.forEach(a => console.log('  ' + a));
    }
    
    // Check for packed JS pattern
    const packedMatch = html.match(/eval\(function\(p,a,c,k,e,d\)\{[^}]*\}\('([^']+)'/);
    if (packedMatch) {
      console.log('\nPacked JS found, length:', packedMatch[1].length);
      // Try extracting URLs from packed directly
      const packedStr = packedMatch[1];
      const parts = packedStr.match(/\/\/[a-zA-Z0-9.-]+\/[^\s'"]+/g);
      if (parts) {
        console.log('URL parts in packed:');
        parts.forEach(p => console.log('  //' + p));
      }
    }
  }
}

main().catch(e => console.error('Error:', e.message));
