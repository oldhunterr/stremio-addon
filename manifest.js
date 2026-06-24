/**
 * manifest.js — Builds the Stremio addon manifest dynamically from sources
 *
 * @param {Array<{id: string, meta: object, module: object}>} sources
 *        Array of loaded source modules with their metadata.
 * @param {string} baseUrl - The addon's public URL (for images etc.)
 * @returns {object} Stremio manifest object
 */
function buildManifest(sources, baseUrl) {
  const catalogs = [];
  const types    = new Set();

  for (const source of sources) {
    const meta       = source.meta;
    const sourceType = meta.id;
    types.add(sourceType);

    // Search catalog(s) — separate per type when source has both movie/series
    if (meta.searchEnabled !== false) {
      const hasMovie = meta.catalogs?.some(c => c.type === 'movie');
      const hasSeries = meta.catalogs?.some(c => c.type === 'series');

      if (hasMovie && hasSeries) {
        // Separate search catalogs so Stremio routes context correctly
        catalogs.push({
          id:    `${meta.id}:search`,
          type:  'movie',
          name:  `${meta.name} - Search`,
          extra: [{ name: 'search', isRequired: true }],
        });
        catalogs.push({
          id:    `${meta.id}:search-series`,
          type:  'series',
          name:  `${meta.name} - Search`,
          extra: [{ name: 'search', isRequired: true }],
        });
        types.add('movie');
        types.add('series');
      } else {
        catalogs.push({
          id:    `${meta.id}:search`,
          type:  sourceType,
          name:  `${meta.name} - Search`,
          extra: [{ name: 'search', isRequired: true }],
        });
      }
    }

    // One catalog per entry in meta.catalogs
    const cats = meta.catalogs || [];
    for (const cat of cats) {
      const extra = [{ name: 'skip' }];

      // Category extra (sub-category filter) — uses the catalog's group key
      const catGroup = cat.id; // "movies", "series", etc.
      const subcats = meta.subcategories?.[catGroup];
      if (subcats && subcats.length > 0) {
        extra.push({ name: 'category', options: subcats.map(s => s.name) });
      }

      if (meta.extraSupported?.includes('genre') && meta.genres?.length) {
        extra.push({ name: 'genre', options: meta.genres });
      }
      if (meta.extraSupported?.includes('type') && meta.types?.length) {
        extra.push({ name: 'type', options: meta.types });
      }
      if (meta.extraSupported?.includes('age') && meta.ageRatings?.length) {
        extra.push({ name: 'age', options: meta.ageRatings.map(a => a.value) });
      }

      catalogs.push({
        id:   `${meta.id}:${cat.id}`,
        type: sourceType,
        name: cat.name,
        extra,
      });
    }
  }

  const manifest = {
    id:          process.env.ADDON_ID || 'com.streamforge.resolver',
    version:     process.env.ADDON_VERSION || '1.0.0',
    name:        process.env.ADDON_NAME || 'StreamForge-Resolver',
    description: sources.map(s => s.meta.name).join(' · ') || 'Multi-source Stremio addon',
    logo:        process.env.ADDON_LOGO || '',
    resources:   ['catalog', 'meta', 'stream'],
    types:       [...types],
    catalogs,
    idPrefixes:  [process.env.ADDON_ID || 'com.streamforge.resolver'],
    behaviorHints: { adult: false, p2p: false },
  };

  return manifest;
}

module.exports = { buildManifest };
