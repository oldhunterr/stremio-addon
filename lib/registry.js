/**
 * registry.js — Source & Provider loader for StreamForge
 *
 * Loads:
 *   - Sources from sources/{id}/meta.json + sources/{id}/index.js
 *   - Providers from providers/{name}.js (auto-discovered)
 *
 * Returns:
 *   { sources, providers, providerLookup }
 *     sources         - Array of loaded source module objects
 *     providers       - Array of loaded provider module objects
 *     providerLookup  - Map of domain alias → provider module
 */

const fs   = require('fs');
const path = require('path');

/**
 * Discover and load all sources from the sources directory.
 *
 * Each source lives in sources/{id}/ and must have:
 *   - meta.json    (id, name, baseUrl, enabled, providers[], catalogs[])
 *   - index.js     (exports: getCatalog, search, getMeta, getStreams)
 *
 * @param {string} baseDir - Absolute path to the project root
 * @returns {Array<{meta: object, module: object}>} Loaded source modules
 */
function loadSources(baseDir) {
  const sourcesDir = path.join(baseDir, 'sources');
  const sources = [];

  if (!fs.existsSync(sourcesDir)) {
    console.warn('[Registry] No sources/ directory found');
    return sources;
  }

  const entries = fs.readdirSync(sourcesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const sourceId  = entry.name;
    const sourceDir = path.join(sourcesDir, sourceId);
    const metaPath  = path.join(sourceDir, 'meta.json');
    const indexPath = path.join(sourceDir, 'index.js');

    if (!fs.existsSync(metaPath)) {
      console.warn(`[Registry] Source "${sourceId}" missing meta.json, skipping`);
      continue;
    }

    if (!fs.existsSync(indexPath)) {
      console.warn(`[Registry] Source "${sourceId}" missing index.js, skipping`);
      continue;
    }

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch (err) {
      console.error(`[Registry] Failed to parse meta.json for "${sourceId}": ${err.message}`);
      continue;
    }

    // Only load enabled sources
    if (meta.enabled === false) {
      console.log(`[Registry] Source "${sourceId}" is disabled, skipping`);
      continue;
    }

    let sourceModule;
    try {
      sourceModule = require(indexPath);
    } catch (err) {
      console.error(`[Registry] Failed to load source "${sourceId}": ${err.message}`);
      continue;
    }

    sources.push({
      id:     sourceId,
      meta,
      module: sourceModule,
    });

    console.log(`[Registry] Loaded source: ${meta.name || sourceId} (id: ${sourceId})`);
  }

  return sources;
}

/**
 * Discover and load all providers from the providers directory.
 *
 * Each provider is a .js file in providers/ that exports:
 *   { id, name, mode, aliases[], async extract(embedUrl, proxyBase) => string[] }
 *
 * Builds a domain→provider lookup map by iterating each provider's aliases.
 *
 * @param {string} baseDir - Absolute path to the project root
 * @returns {{ providers: Array<object>, providerLookup: Map<string, object> }}
 */
function loadProviders(baseDir) {
  const providersDir = path.join(baseDir, 'providers');
  const providers = [];
  const providerLookup = new Map();

  if (!fs.existsSync(providersDir)) {
    console.warn('[Registry] No providers/ directory found');
    return { providers, providerLookup };
  }

  const files = fs.readdirSync(providersDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(providersDir, file);
    const providerName = path.basename(file, '.js');

    let providerModule;
    try {
      providerModule = require(filePath);
    } catch (err) {
      console.error(`[Registry] Failed to load provider "${providerName}": ${err.message}`);
      continue;
    }

    if (!providerModule.id || !providerModule.extract) {
      console.warn(`[Registry] Provider "${providerName}" missing id or extract() export, skipping`);
      continue;
    }

    // Register the provider's domain aliases
    const aliases = providerModule.aliases || [];
    for (const alias of aliases) {
      providerLookup.set(alias, providerModule);
    }

    providers.push(providerModule);
    console.log(`[Registry] Loaded provider: ${providerModule.name || providerModule.id} (aliases: ${aliases.join(', ') || 'none'})`);
  }

  return { providers, providerLookup };
}

module.exports = { loadSources, loadProviders };
