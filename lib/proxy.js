/**
 * proxy.js — Express proxy endpoints for StreamForge
 *
 * Mounts two proxy routes on the Express app:
 *   GET /proxy/ytdl?url=...     — Extracts direct URLs via yt-dlp, redirects to fresh URL
 *   GET /proxy/browser?url=...  — Extracts JW Player HLS URL via Playwright, redirects
 *
 * These handle token expiry by fetching a fresh URL on each request.
 */

const ytdl = require('./ytdl');
const { extractJwPlayerUrl } = require('./browser');

/**
 * Mount proxy endpoints onto the Express app.
 *
 * @param {import('express').Express} app - Express application instance
 */
function mountProxy(app) {
  // ─── yt-dlp proxy ──────────────────────────────────────────────────────────
  app.get('/proxy/ytdl', async (req, res) => {
    const embedUrl = req.query.url;
    if (!embedUrl) return res.status(400).send('Missing url param');

    console.log(`[Proxy/ytdl] Extracting ${embedUrl.substring(0, 60)}...`);
    const urls = ytdl(embedUrl);
    if (urls.length > 0) {
      console.log(`[Proxy/ytdl] ${embedUrl.substring(0, 50)} → fresh URL`);
      return res.redirect(302, urls[0]);
    }

    console.log(`[Proxy/ytdl] Failed, falling back to original URL`);
    res.redirect(302, embedUrl);
  });

  // ─── Browser (Playwright) proxy ────────────────────────────────────────────
  app.get('/proxy/browser', async (req, res) => {
    const embedUrl = req.query.url;
    if (!embedUrl) return res.status(400).send('Missing url param');

    console.log(`[Proxy/browser] Extracting ${embedUrl.substring(0, 60)}...`);
    const directUrl = await extractJwPlayerUrl(embedUrl);
    if (directUrl) {
      console.log(`[Proxy/browser] → fresh HLS URL`);
      return res.redirect(302, directUrl);
    }

    console.log(`[Proxy/browser] Failed, falling back to original URL`);
    res.redirect(302, embedUrl);
  });
}

module.exports = { mountProxy };
