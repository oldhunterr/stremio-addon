FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates \
    libnss3 libnspr4 libatk-bridge2.0-0 libdrm2 libgbm1 \
    libxkbcommon0 libxshmfence1 libxcomposite1 libxdamage1 \
    libxrandr2 libpango-1.0-0 libcups2 libasound2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV NODE_PATH=/app/node_modules \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=false

WORKDIR /app

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 7100

ENTRYPOINT ["docker-entrypoint.sh"]
