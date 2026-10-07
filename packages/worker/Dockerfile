# Build context is the repo root: docker build -f packages/worker/Dockerfile .
FROM oven/bun:1

# ffmpeg for video probing/transcoding; libvips ships inside sharp's prebuilt
# binary; libraw-bin provides dcraw_emu for decoding camera RAW to TIFF.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg libraw-bin \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .
RUN bun install \
  && bun run --filter='@cameraderie/shared' build \
  && bun run --filter='@cameraderie/db' build \
  && bun run --filter='@cameraderie/worker' build

ENV NODE_ENV=production
CMD ["bun", "packages/worker/dist/index.js"]
