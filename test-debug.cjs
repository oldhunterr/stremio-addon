/** Debug packed script format */
const axios = require('axios');
axios.get('https://miixdrop.net/e/mk10mx46b9z3zx', {
  headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000, maxRedirects: 5
}).then(resp => {
  const html = resp.data;
  const start = html.indexOf("eval(function(p,a,c,k,e,d)");
  const end = html.indexOf('</script>', start);
  const script = html.substring(start, end);
  console.log('Script length:', script.length);
  console.log('START:', script.substring(0, 200));
  console.log('...');
  console.log('END:', script.substring(script.length - 200));
  
  // Try to extract the packed string and dict
  // Find the first single quote after the function body close
  const fnClose = script.indexOf('})');
  if (fnClose >= 0) {
    const afterFn = script.substring(fnClose + 2).trim();
    console.log('\nAfter function close:', afterFn.substring(0, 200));
    
    // Try regex on just this script
    const regex = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)[^)]*\)\)\)/s;
    const match = script.match(regex);
    if (match) {
      console.log('\nREGEX MATCHES!');
      console.log('Packed len:', match[1].length);
      console.log('Base:', match[2]);
      console.log('Words:', match[3]);
      console.log('Dict len:', match[4].length);
    } else {
      console.log('\nRegex still fails on isolated script');
      // Check what comes after the function body
      const rest = script.substring(fnClose, fnClose + 200);
      console.log('Rest from fnClose:', rest.substring(0, 200));
    }
  }
}).catch(e => console.error('Error:', e.message));
