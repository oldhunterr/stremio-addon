# StreamForge-Resolver Test Infrastructure

## Overview
This document specifies the E2E testing framework, test tiers, and execution commands. The suite performs opaque-box HTTP verification of the Stremio Addon Protocol endpoints against the running server.

## Component Map & Ports

| Component | Default Port | Description |
|-----------|--------------|-------------|
| **Addon Server** | `7100` | Express Stremio addon serving manifest, catalog, meta, and stream endpoints. |
| **External Resolver** | `7400` | `url-resolver-v2` service that performs on-demand extraction and proxying. |
| **FlareSolverr** | `8191` | Cloudflare bypass proxy for scraping AnimeBlkom page contents and images. |
| **ArabSeed Mock Server** | `7401` | Mock server simulating ArabSeed catalogs, searches, metas, and streams. |

---

## Directory Layout & Conventions

All E2E tests are colocated inside the `tests/e2e/` folder at the project root:
- `tests/e2e/runner.js`: The central test runner file. It uses Node's built-in `node:test` framework and `node:assert` module.
- `tests/e2e/mocks.js`: Mock server definitions for FlareSolverr, url-resolver-v2, and ArabSeed.
- No external test frameworks (like Jest, Mocha, or Playwright) are introduced to minimize dependency issues.

---

## Running the Test Suite

### Execution
Run the runner using Node.js:
```bash
node tests/e2e/runner.js
```

---

## Test Case Specification (63 Cases)

The following test cases are partitioned across Tiers 1-4 for the 5 core features.

### Feature 1: AnimeBlkom Catalog/Meta (14 Cases)

*   **Tier 1: Basic Health & Connectivity**
    1.  `GET /catalog/series/animeblkom:anime.json` returns 200 OK.
    2.  `GET /catalog/series/animeblkom:movies.json` returns 200 OK.
    3.  `GET /catalog/series/animeblkom:search.json` returns 200 OK.
    4.  Verify that request for invalid catalog ID returns empty `{ metas: [] }` rather than crashing.

*   **Tier 2: Happy Paths**
    5.  Catalog response items contain valid `id` starting with prefix `com.streamforge.resolver:animeblkom:`.
    6.  Catalog response items contain non-empty `name` (string).
    7.  Catalog response items contain non-empty `poster` URL.
    8.  Catalog response items contain `posterShape: "regular"`.
    9.  Search for a popular term via `/catalog/series/animeblkom:search/search=One Piece.json` returns matching results.
    10. Meta query `/meta/series/com.streamforge.resolver:animeblkom:<encoded_id>.json` returns valid metadata details.
    11. Meta query returns `videos` array containing sorted episode listings.

*   **Tier 3: Edge Cases, Pagination & Error Handling**
    12. Verify pagination cap: Requesting a page beyond limit (skip >= 100) returns empty `{ metas: [] }`.
    13. Empty or malformed search request returns empty `{ metas: [] }`.
    14. Malformed base64url meta ID resolves gracefully to `{ meta: null }` without crashing the process.

*   **Tier 4: E2E Flow Simulation & Integrity**
    15. Verify CORS header compliance: Check that the catalog and meta responses contain the header `Access-Control-Allow-Origin: *`.

---

### Feature 2: AnimeBlkom Image Proxy (12 Cases)

*   **Tier 1: Basic Health & Connectivity**
    16. Fetch image endpoint `/img/:encoded` returns HTTP 200 OK for a valid base64url-encoded image.
    17. Proxied image response headers contain correct `Content-Type`.
    18. Proxied image response headers contain `Cache-Control` header indicating a max-age.

*   **Tier 2: Happy Paths**
    19. Download proxied AnimeBlkom image and verify that the binary buffer contains data.
    20. Verify binary magic number: Downloaded image buffer starts with valid JPG or PNG headers.
    21. Performance: Image proxy request executes quickly when FlareSolverr cookies/session are active.

*   **Tier 3: Edge Cases, Pagination & Error Handling**
    22. Request `/img/` with invalid base64url encoding and verify it returns HTTP 400 Bad Request.
    23. Request `/img/:encoded` for a target URL that returns 404, and verify proxy returns HTTP 502 Bad Gateway.
    24. Request `/img/:encoded` targeting a non-image content type and verify it returns an error or rejects the request.
    25. Verify session bootstrap fallback: Clear cookies/session state and request an image. Verify that the proxy fetches the image successfully.

*   **Tier 4: E2E Flow Simulation & Integrity**
    26. Catalog response URL rewrite: Verify that all `poster` URLs in the AnimeBlkom catalog response are rewritten to use the local `/img/:encoded` proxy.
    27. Meta response URL rewrite: Verify that `poster` and `background` fields in the AnimeBlkom meta response are rewritten to use the local `/img/:encoded` proxy.

---

### Feature 3: ArabSeed Pagination (12 Cases)

*   **Tier 1: Basic Health & Connectivity**
    28. `GET /catalog/movie/arabseed:movies.json` returns HTTP 200 OK.
    29. `GET /catalog/series/arabseed:series.json` returns HTTP 200 OK.
    30. Verify response contains pagination metadata `hasNextPage` boolean.

*   **Tier 2: Happy Paths**
    31. Movie catalog unique pages: Request skip=0 and skip=20 and verify that returned item IDs are unique.
    32. Series catalog unique pages: Request skip=0 and skip=20 and verify that returned item IDs are unique.
    33. Series catalog AJAX pagination: Verify that a page 2 series request correctly passes the paginated path.

*   **Tier 3: Edge Cases, Pagination & Error Handling**
    34. Browse catalog pagination: Requesting `skip=20` on `arabseed:browse` queries `?page_number=2` on `/main10/`.
    35. Others catalog pagination: Requesting `skip=40` on `arabseed:others` queries `?page_number=3` on `/main10/`.
    36. Out of bounds pagination check: Requesting `skip=1000` returns empty `{ metas: [] }` and `hasNextPage: false` without crashing.
    37. Malformed skip/page parameters default safely to page 1.

*   **Tier 4: E2E Flow Simulation & Integrity**
    38. Simulating user navigation: Sequentially retrieve pages 1, 2, and 3, verifying that `hasNextPage` updates correctly.
    39. Cookie isolation check: Verify that consecutive pagination requests do not mix cookie states.

---

### Feature 4: ArabSeed Filters (13 Cases)

*   **Tier 1: Basic Health & Connectivity**
    40. Request catalog with category filter `/catalog/movie/arabseed:movies/category=foreign.json` returns HTTP 200 OK.
    41. Request catalog with genre filter `/catalog/movie/arabseed:movies/genre=أكشن.json` returns HTTP 200 OK.

*   **Tier 2: Happy Paths**
    42. Stremio Type routing: Verify that catalog requests route `movies` as `movie` and `series` as `series`.
    43. Level 2 Category selection: Request category "أفلام عربية" (`movies-arabic`) and verify only Arabic movie items are returned.
    44. Level 3 Genre selection: Request genre "رعب" (Horror) and verify the scraper queries the genre URL.
    45. Level 4 Type restriction (Movies): Request genre "أكشن" with type restriction "movie" and verify that all returned items are movies.
    46. Level 4 Type restriction (Series): Request genre "أكشن" with type restriction "series" and verify that all returned items are series, and all episodes are filtered out.

*   **Tier 3: Edge Cases, Pagination & Error Handling**
    47. Category fallback: Requesting a non-existent category falls back gracefully to the root catalog.
    48. Genre fallback: Requesting a non-existent genre returns an empty list or falls back gracefully without crashing.
    49. Reverse map duplicate fix: Verify that categories "أفلام أنيميشن" maps to `anime-movies` and "مسلسلات كرتون" maps to `series-cartoon` / `anime-series` without JS object property overwrite issues.
    50. Search with type filter: `/catalog/series/arabseed:search-series/search=Game of Thrones&type=series.json` returns only series.

*   **Tier 4: E2E Flow Simulation & Integrity**
    51. Simulated filter flow: Catalog (`series`) -> Category -> Genre returns correct filtered items.
    52. Verify CORS headers on all filtered requests.

---

### Feature 5: ArabSeed Quality Streams (12 Cases)

*   **Tier 1: Basic Health & Connectivity**
    53. Request streams for a valid ArabSeed movie returns HTTP 200 OK.
    54. Response contains a valid `streams` array.

*   **Tier 2: Happy Paths**
    55. Quality extraction: Returned streams have distinct quality labels corresponding to the website's quality tabs.
    56. Stream labels structure: Proxied streams are labeled with the provider name and the specific quality in their title.
    57. Stream URL formatting: Direct streaming URLs are correctly wrapped for known providers.
    58. Embed-only streams formatting: Embed-only providers return with `externalUrl` or `isEmbed: true`.

*   **Tier 3: Edge Cases, Pagination & Error Handling**
    59. Non-existent stream ID: Requesting streams for an invalid ID returns `{ streams: [] }`.
    60. Missing qualities fallback: If the watch page has no qualities tabs, all streams fall back gracefully to "Auto" quality.
    61. Dead links fallback: If all parsed video streams are dead or missing, verify that the server still returns the "Open in browser" fallback stream.
    62. Deep pagination stream check: Verify that requesting streams for an episode from a series resolves and fetches streams successfully.

*   **Tier 4: E2E Flow Simulation & Integrity**
    63. Playback flow: Simulated client parses search/catalog -> fetches meta details -> selects episode ID -> calls stream endpoint -> receives at least one playable stream.
    64. Verify CORS headers (`Access-Control-Allow-Origin: *`) on stream response.
