# Project: StreamForge-Resolver Fixes

## Architecture
StreamForge-Resolver is a Stremio addon that scrapes catalogs, meta, and stream details from various Arabic streaming and anime sites.
- **Frontend/Stremio client**: Communicates with the addon server using the Stremio Addon Protocol.
- **Addon Server (`index.js`)**: Exposes manifest, catalog, meta, and stream endpoints. Routes incoming requests to source scrapers, handles image proxying, and maps scraper outputs to Stremio-compliant formats.
- **Unified Fetcher (`lib/fetch.js`)**: Wraps axios and FlareSolverr request logic. Handles session creation, page fetching, and image proxy caching.
- **Source Scrapers (`sources/`)**: Contains individual modules for each content provider (e.g. `animeblkom`, `arabseed`).
- **External URL Resolver (`url-resolver-v2` on port 7400)**: Resolves final streaming URLs from third-party hosts.

## Code Layout
- `index.js`: Express web server and Stremio addon endpoints.
- `lib/fetch.js`: Unified client for fetching pages (axios/FlareSolverr) and proxying images.
- `sources/animeblkom/index.js`: Scraper module for AnimeBlkom.
- `sources/animeblkom/meta.json`: Metadata and catalog setup for AnimeBlkom.
- `sources/arabseed/index.js`: Scraper module for ArabSeed.
- `sources/arabseed/meta.json`: Metadata and catalog setup for ArabSeed.

## Milestones
| # | Name | Scope | Dependencies | Status | Conversation ID |
|---|------|-------|--------------|--------|-----------------|
| M1 | E2E Testing Suite | Build opaque-box E2E test cases in Tiers 1-4 for AnimeBlkom and ArabSeed | None | IN_PROGRESS | 7b196b74-4a7b-4500-94ee-ae87c6b52c2f |
| M2 | AnimeBlkom Fixes | Fix binary image proxy, session reuse, and wrap poster/background URLs | None | IN_PROGRESS | 16d0ad8c-b60e-4761-83d9-880e7bc83966 |
| M3 | ArabSeed Fixes | Repair pagination, catalog endpoints, 3-level filters, and quality extraction | None | IN_PROGRESS | 34c6efd0-da04-4b2a-8f5a-e56829b373a5 |

## Interface Contracts
### Image Proxy Interface
- `/img/:encoded`: Endpoint on addon server that decodes base64url image URLs and calls `fetchImage(imageUrl)`.
- `fetchImage(imageUrl, siteBaseUrl)`: Returns `{ data: Buffer, contentType: string }`.

### Source Scraper Interface
Each scraper module under `sources/{id}/index.js` must export:
- `getCatalog(catalogId, page, extra)`: Returns `{ items: Array, hasNextPage: boolean }`.
- `search(query, extra)`: Returns `Array` of catalog items.
- `getMeta(encodedId)`: Returns `{ title, thumb, description, genres, episodeLinks }`.
- `getStreams(encodedId)`: Returns `Array` of stream objects `{ url, label, isEmbed, quality, providerId }`.
