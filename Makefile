.PHONY: install install-root install-viewer install-backend \
        build build-root build-viewer build-backend \
        dev-cli dev-viewer \
        test test-viewer \
        lint lint-viewer \
        deploy-backend

# ── Install ────────────────────────────────────────────────────────────────────

install: install-root install-viewer install-backend

install-root:
	npm install

install-viewer:
	cd session-viewer && npm install

install-backend:
	cd backend && npm install

# ── Build ──────────────────────────────────────────────────────────────────────

build: build-root build-viewer build-backend

build-root: install-root
	npm run build

build-viewer: build-root install-viewer
	cd session-viewer && npm run build

build-backend: install-backend
	cd backend && npm run build

# ── Dev / Run ──────────────────────────────────────────────────────────────────

dev-cli: build-root
	npm run dev

dev-viewer: build-root install-viewer
	cd session-viewer && npm run dev

# ── Test ───────────────────────────────────────────────────────────────────────

test: test-viewer

test-viewer: install-viewer
	cd session-viewer && npm test

# ── Lint ───────────────────────────────────────────────────────────────────────

lint: lint-viewer

lint-viewer: install-viewer
	cd session-viewer && npm run lint

# ── Deploy ─────────────────────────────────────────────────────────────────────

deploy-backend: build-backend
	cd backend && npm run deploy
