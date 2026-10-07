# Build context is the repo root: docker build -f packages/worker/Dockerfile .
FROM node:22-bookworm-slim

# ffmpeg for video probing/transcoding; libvips ships inside sharp's prebuilt binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --no-frozen-lockfile \
  && pnpm --filter @cameraderie/shared build \
  && pnpm --filter @cameraderie/db build \
  && pnpm --filter @cameraderie/worker build

ENV NODE_ENV=production
CMD ["node", "packages/worker/dist/index.js"]
