# Build context is the repo root: docker build -f packages/api/Dockerfile .
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /app

# Install all workspace deps, then build the packages the API needs.
COPY . .
RUN pnpm install --no-frozen-lockfile \
  && pnpm --filter @cameraderie/shared build \
  && pnpm --filter @cameraderie/db build \
  && pnpm --filter @cameraderie/api build

ENV NODE_ENV=production
EXPOSE 3000

# Apply migrations, then start the API.
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node packages/api/dist/index.js"]
