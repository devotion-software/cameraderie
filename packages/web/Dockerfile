# Build context is the repo root: docker build -f packages/web/Dockerfile .
FROM oven/bun:1

WORKDIR /app

COPY . .
RUN bun install \
  && bun run --filter='@cameraderie/shared' build \
  && bun run --filter='@cameraderie/web' build

ENV NODE_ENV=production
# adapter-node honours PORT; PUBLIC_API_URL is read at runtime in the browser.
ENV PORT=5173
EXPOSE 5173

CMD ["bun", "packages/web/build/index.js"]
