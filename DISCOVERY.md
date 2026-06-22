# StreamForge — Discovery & Status Log

> **Purpose:** Track every source website and video provider we've found, analyzed, or need to investigate.
> Last updated: 2026-06-17

---

## Sources (Content Websites)

| Source | Status | Scraper | Providers | Notes |
|--------|--------|---------|-----------|-------|
| animelek.top | ✅ ACTIVE | `sources/animelek/` | 11 | No CF, full extraction. Arabic |
| ristoanime.me | ✅ ACTIVE | `sources/ristoanime/` | 3 known | No CF on main pages. Arabic |
| kawaiianime | ✅ ACTIVE | `sources/kawaiianime/` | — | Uses AniList + HiAnime |
| alooytv.com | ✅ ACTIVE | `sources/alooytv/` | — | Arabic series |
| animeblkom.com | 🛡️ CLOUDFLARE | `sources/animeblkom/` | — | Turnstile, FlareSolverr needed |
| anikototv.to | 🔍 DISCOVERED | — | — | English. 3-layer API, RC4 encryption. Needs custom extractor |
| anime4up.net | 🔍 DISCOVERED | — | — | Same network as ristoanime |

### How to Add a New Source

1. Create `sources/{id}/meta.json` with id, name, baseUrl, catalogs, providers
2. Create `sources/{id}/index.js` exporting: getCatalog, search, getMeta, getStreams
3. Restart addon — it auto-discovers the new source
4. Test: `curl localhost:7003/catalog/series/{id}:all.json`

---

## Providers (Video Hosters)

### Direct Extraction (playable in Stremio)

| Provider | Mode | Extractor | Sources Using It | Verified |
|----------|------|-----------|-----------------|----------|
| mp4upload.com | `proxy-ytdl` | `providers/mp4upload.js` | animelek, ristoanime | ✅ Tokens expire fast (30s) |
| dailymotion.com | `direct` | `providers/dailymotion.js` | animelek | ✅ manifestUrl from player config |
| ok.ru | `direct` | `providers/okru.js` | animelek | ✅ metadataUrl API |
| videa.hu | `ytdl` | `providers/videa.js` | animelek | ✅ yt-dlp works |
| w.larhu.website | `ytdl` | `providers/larhu.js` | animelek | ✅ yt-dlp works |
| rubyvidhub.com | `proxy-browser` | `providers/rubyvidhub.js` | animelek | ✅ JW Player, ~2.5s |
| voe.sx / juliewomanwish.com | `proxy-browser` | `providers/voe.js` | animelek | ✅ JW Player, same method |

### Embed-Only (Stremio opens in-browser)

| Provider | Extractor | Sources Using It | Why Embed |
|----------|-----------|-----------------|-----------|
| share4max.com | `providers/share4max.js` | animelek | Vue.js SPA, API-fetched URLs |
| uqload.is | `providers/uqload.js` | animelek, ristoanime | Anti-adblock overlay, JS-only |
| dsvplay.com / playmogo.com | `providers/dsvplay.js` | animelek | Devtool detection, 403 without session |
| mega.nz / megamax.me | `providers/mega.js` | animelek, ristoanime | Requires JS key decryption |

### Need Investigation

| Provider | Type | Found On | Known Info | Status |
|----------|------|----------|------------|--------|
| vidmoly.biz | HLS (JW Player) | ristoanime.me | JW Player 8, HLS with 12h tokens, no CORS. Likely yt-dlp works | 🔍 NEEDS TEST |
| sendvid.com | Direct MP4 | ristoanime.me | Simple embed page | 🔍 NEEDS TEST |
| video.sibnet.ru | HLS | ristoanime.me | Russian video hosting, shell.php API | 🔍 NEEDS TEST |
| turbovidhls.com | HLS | ristoanime.me | CDN-style HLS delivery | 🔍 NEEDS TEST |
| hgcloud.to | Unknown | ristoanime.me | Similar to voe.sx network | 🔍 NEEDS TEST |
| megaplay.buzz | HLS | anikototv.to | Domain whitelisting, 55+ referrers | 🔍 NEEDS TEST |
| VidTube / VidWish | Embed | anikototv.to | Part of 3-layer embed chain | 🔍 NEEDS TEST |

---

## Extraction Methods Reference

| Method | How It Works | When To Use | File |
|--------|-------------|-------------|------|
| `direct` | Fetch embed page HTML, extract URL via regex/pattern | Provider embeds URL in page config | `providers/*.js` |
| `ytdl` | Run `yt-dlp -g` on embed URL | yt-dlp supports the provider | `lib/ytdl.js` |
| `proxy-ytdl` | Our server runs yt-dlp at playback time via /proxy/ytdl | Tokens expire fast (mp4upload) | `lib/proxy.js` |
| `proxy-browser` | Our server runs Playwright at playback time via /proxy/browser | JW Player, JS-obfuscated URLs | `lib/browser.js` + `lib/proxy.js` |
| `embed` | Return URL as notWebReady=true | Stremio's embedded browser handles it | Source sets `isEmbed: true` |

### Provider File Template

```javascript
module.exports = {
  id: 'providername',
  name: 'Provider Name',
  mode: 'direct',  // direct | ytdl | proxy-ytdl | proxy-browser | embed
  aliases: ['domain.com', 'www.domain.com'],
  
  async extract(embedUrl, proxyBase) {
    // Return array of direct video URLs or empty array
    return [];
  }
};
```

### Alias Tracking

When a provider changes domains:
1. Test the new domain works with the same extraction method
2. Add the new domain to the `aliases` array
3. Restart — all sources using this provider now work with the new domain
4. Old domains stay in aliases (some embeds may still use them)

---

## Testing Commands

```bash
# Verify addon is running
curl http://localhost:7003/manifest.json

# Test source catalog
curl http://localhost:7003/catalog/series/animelek:all.json

# Test source search
curl http://localhost:7003/catalog/series/animelek:all/search=naruto.json

# Test meta
curl http://localhost:7003/meta/series/animelek:{encoded_id}.json

# Test streams
curl http://localhost:7003/stream/series/animelek:{encoded_id}.json

# Test proxy endpoints
curl -sI "http://localhost:7003/proxy/ytdl?url=https://mp4upload.com/embed-xxx.html" --max-time 15
curl -sI "http://localhost:7003/proxy/browser?url=https://rubyvidhub.com/embed-xxx.html" --max-time 15
```

---

## Addon Control

```bash
# Start
cd /home/hermes/projects/streamforge && node index.js

# Start with custom settings
ADDON_URL=http://192.168.100.143:7003 FLARESOLVERR_URL=http://192.168.100.150:8191/v1 node index.js

# Stop
pkill -f "node.*streamforge"

# Check logs
cat /tmp/streamforge.log | strings

# Install in Stremio
# http://192.168.100.143:7003/manifest.json
```
