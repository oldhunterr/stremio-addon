/**
 * browser.js — Playwright-based browser manager for StreamForge
 *
 * Singleton headless Chromium instance for extracting HLS URLs
 * from JW Player embeds and other JS-rendered video hosts.
 *
 * Reuses the browser across calls (warm start).
 */

const { chromium } = require('playwright');

let browser = null;
let context = null;

async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  console.log('[BrowserMgr] Launching headless Chrome...');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
  });
  console.log('[BrowserMgr] Chrome ready');
  return browser;
}

/**
 * Navigate to a JW Player embed page and extract the HLS video URL.
 *
 * @param {string}  embedUrl  - URL of the embed page
 * @param {number}  timeoutMs - Total timeout in ms (default: 15000)
 * @returns {string|null} The extracted HLS URL, or null on failure
 */
async function extractJwPlayerUrl(embedUrl, timeoutMs = 15000) {
  const start = Date.now();
  try {
    await getBrowser();
    const page = await context.newPage();

    // Navigate — just wait for content to load, not all resources
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });

    // Wait 2s for JS to initialize
    await page.waitForTimeout(2000);

    // Try to extract JW Player config
    let videoUrl = null;
    const pollEnd = start + timeoutMs;
    while (Date.now() < pollEnd) {
      try {
        videoUrl = await page.evaluate(() => {
          try {
            const p = window.jwplayer();
            const c = p.getConfig();
            for (const src of (c?.sources || c?.playlist?.[0]?.sources || [])) {
              if (src.file && (src.file.includes('.m3u8') || src.file.includes('.mp4'))) return src.file;
            }
          } catch {}
          // Fallback: check video element
          const v = document.querySelector('video');
          if (v && v.querySelector('source[src]')) return v.querySelector('source').src;
          return null;
        });
        if (videoUrl) break;
      } catch {}
      await page.waitForTimeout(500);
    }

    await page.close();
    const elapsed = Date.now() - start;
    console.log(`[BrowserMgr] ${embedUrl.substring(0, 50)} → ${videoUrl ? 'FOUND' : 'NOT FOUND'} (${elapsed}ms)`);
    return videoUrl;
  } catch (err) {
    console.error(`[BrowserMgr] Extract failed: ${err.message.substring(0, 80)}`);
    return null;
  }
}

/**
 * Shut down the browser instance cleanly.
 */
async function shutdown() {
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    console.log('[BrowserMgr] Chrome shut down');
  }
}

module.exports = { extractJwPlayerUrl, shutdown };
