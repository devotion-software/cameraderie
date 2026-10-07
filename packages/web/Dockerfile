# Build context is the repo root: docker build -f packages/web/Dockerfile .
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /app

COPY . .
RUN pnpm install --no-frozen-lockfile \
  && pnpm --filter @cameraderie/shared build \
  && pnpm --filter @cameraderie/web build

ENV NODE_ENV=production
# adapter-node honours PORT; PUBLIC_API_URL is read at runtime in the browser.
ENV PORT=5173
EXPOSE 5173

CMD ["node", "packages/web/build"]
