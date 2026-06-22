/** Simple JS Packer decoder using string operations */
function unpackSimple(html) {
  // Find the packed script: eval(function(p,a,c,k,e,d){...})
  const pos = html.indexOf("eval(function(p,a,c,k,e,d)");
  if (pos < 0) return html;
  
  // Find the function body end: we need the LAST '}' before the '(' that starts arguments
  // The pattern is: function(p,a,c,k,e,d){ ... return p }('PACKED',BASE,COUNT,'DICT'.split('|')
  // Find the opening brace of the function body
  const bracePos = html.indexOf('{', pos);
  if (bracePos < 0) return html;
  
  // Now find '}(' that starts the arguments  
  // Scan for '}(' after the opening brace
  let depth = 1;
  let argsStart = -1;
  for (let i = bracePos + 1; i < html.length && depth > 0; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0 && html[i + 1] === '(') {
        argsStart = i + 1;
        break;
      }
    }
  }
  
  if (argsStart < 0) return html;
  
  // Now extract the arguments: ('PACKED',BASE,COUNT,'DICT'.split('|')
  const args = html.substring(argsStart);
  
  // Match: ('PACKED', BASE, COUNT, 'DICT'.split('|')
  const argMatch = args.match(/^\('(.*?)',\s*(\d+),\s*(\d+),\s*'(.*?)'\.split\('\|'\)/);
  if (!argMatch) return html;
  
  const [, packedStr, baseStr, countStr, dictStr] = argMatch;
  const base = parseInt(baseStr);
  const count = parseInt(countStr);
  const dict = dictStr.split('|');
  
  // Decode using the standard algorithm
  const e = function(c) {
    return (c < base ? '' : e(parseInt(c / base))) + ((c = c % base) > 35 ? String.fromCharCode(c + 29) : c.toString(base));
  };
  const map = {};
  for (let i = 0; i < count; i++) {
    map[e(i)] = dict[i] || e(i);
  }
  
  return packedStr.replace(/\b(\w+)\b/g, (val) => map[val] || val);
}

module.exports = { unpack: unpackSimple };
