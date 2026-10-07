# Cameraderie — developer task runner.
# `make` or `make help` lists every target. Most dev work needs only:
#   make install   (once)        make up        (start db/redis/minio)
#   make migrate   make seed      make dev       (run api + worker + web)
#
# Toolchain is Bun; infra (MariaDB, Redis, MinIO) runs via docker compose.

# Use bash with strict flags for recipe reliability.
SHELL := /bin/bash
.DEFAULT_GOAL := help

COMPOSE := docker compose
# Infra-only services (not the app containers, which use real R2 in prod).
INFRA   := mariadb redis minio minio-init

.PHONY: help install up infra stop down clean logs console \
        dev build build-libs typecheck test lint format \
        migrate generate seed db-push reset-db \
        web-dev web-build web-preview \
        ios android-build android-install

##@ General

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} \
	/^[a-zA-Z0-9_-]+:.*?##/ { printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2 } \
	/^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) }' $(MAKEFILE_LIST)
	@echo

install: ## Install all workspace dependencies (bun)
	bun install

##@ Local infrastructure (Docker)

up: ## Start MariaDB + Redis + MinIO in the background
	$(COMPOSE) up -d $(INFRA)
	@echo "Infra up. MinIO console: http://localhost:9001 (minioadmin/minioadmin)"

infra: up ## Alias for `up`

stop: ## Stop all docker compose services (keeps data)
	$(COMPOSE) stop

down: ## Stop and remove containers (keeps named volumes)
	$(COMPOSE) down

clean: ## Remove containers AND volumes (DESTROYS local db + minio data), plus build output
	$(COMPOSE) down -v
	rm -rf packages/*/dist packages/web/build packages/web/.svelte-kit

logs: ## Tail logs from infra services
	$(COMPOSE) logs -f $(INFRA)

console: ## Open the MinIO web console in a browser
	open http://localhost:9001

##@ Database

migrate: ## Run pending DB migrations
	bun run db:migrate

generate: ## Generate a new migration from schema changes (drizzle-kit)
	bun run db:generate

db-push: ## Push the schema straight to the DB without a migration (quick dev iteration)
	bun run --filter='@cameraderie/db' push

seed: build-libs ## Seed a demo user + group (demo@cameraderie.local / password123)
	bun run db:seed

reset-db: ## Drop the MariaDB volume, recreate, migrate, and seed from scratch
	$(COMPOSE) rm -sfv mariadb
	docker volume rm cameraderie_mariadb-data 2>/dev/null || true
	$(COMPOSE) up -d mariadb
	@echo "Waiting for MariaDB to accept connections..."
	@until $(COMPOSE) exec -T mariadb healthcheck.sh --connect --innodb_initialized >/dev/null 2>&1; do sleep 1; done
	$(MAKE) migrate seed

##@ Develop

dev: up build-libs ## Start infra, build libs, then run api + worker + web with live reload
	@echo "Starting api + worker + web (Ctrl-C stops all)..."
	@trap 'kill 0' INT TERM; \
		bun run dev:api & \
		bun run dev:worker & \
		bun run dev:web & \
		wait

build-libs: ## Build the shared + db packages (prereq for running api/worker/web)
	bun run --filter='@cameraderie/shared' build
	bun run --filter='@cameraderie/db' build

build: ## Build all packages in dependency order (shared→db→api→worker→web)
	bun run build

typecheck: ## Type-check every package
	bun run typecheck

test: ## Run the Vitest suite
	bun run test

lint: ## Check formatting (prettier --check)
	bun run lint

format: ## Auto-format the codebase (prettier --write)
	bun run format

##@ Web (SvelteKit)

web-dev: up ## Run only the web client with live reload (needs api running separately)
	bun run dev:web

web-build: ## Production build of the web client
	bun run --filter='@cameraderie/web' build

web-preview: web-build ## Build then serve the production web bundle
	bun run --filter='@cameraderie/web' preview

##@ Native apps

ios: ## Generate the Xcode project (requires XcodeGen) and open it
	cd apps/ios && xcodegen generate && open Cameraderie.xcodeproj

android-build: ## Assemble the debug Android APK (requires local Android SDK + gradle)
	cd apps/android && gradle assembleDebug

android-install: ## Build and install the debug APK on a connected device/emulator
	cd apps/android && gradle installDebug
