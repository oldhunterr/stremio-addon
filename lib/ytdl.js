/**
 * ytdl.js — yt-dlp wrapper for StreamForge proxy
 *
 * Extracts direct media URLs from embed pages.
 * Returns an empty array on any failure (never throws).
 */

const { execFileSync } = require('child_process');

/**
 * Extract direct media URLs from an embed page using yt-dlp.
 *
 * @param {string}  url       - Embed URL to extract from
 * @param {number}  timeoutMs - Timeout in milliseconds (default: 15000)
 * @returns {string[]} Array of extracted direct URLs (empty on failure)
 */
function ytdl(url, timeoutMs = 15000) {
  try {
    const stdout = execFileSync('yt-dlp', [
      '-g',
      '--no-warnings',
      '--no-check-certificates',
      url,
    ], {
      timeout: timeoutMs,
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });

    const urls = stdout.trim().split('\n').filter(Boolean);
    console.log(`[ytdl] ${url.substring(0, 50)} → ${urls.length} URL(s) extracted`);
    return urls;
  } catch (err) {
    console.error(`[ytdl] Failed for ${url.substring(0, 60)}: ${err.message.substring(0, 100)}`);
    return [];
  }
}

module.exports = ytdl;
