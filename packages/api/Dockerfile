# Build context is the repo root: docker build -f packages/api/Dockerfile .
FROM oven/bun:1

WORKDIR /app

# Install all workspace deps, then build the packages the API needs.
COPY . .
RUN bun install \
  && bun run --filter='@cameraderie/shared' build \
  && bun run --filter='@cameraderie/db' build \
  && bun run --filter='@cameraderie/api' build

ENV NODE_ENV=production
EXPOSE 3000

# Apply migrations, then start the API.
CMD ["sh", "-c", "bun packages/db/dist/migrate.js && bun packages/api/dist/index.js"]
