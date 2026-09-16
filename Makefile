SHELL := /bin/sh
DEPS_STAMP := node_modules/.vortex-dependencies
.PHONY: help install build watch test test-ui test-tls test-host check package install-vsix icons
help:
	@echo "install build watch typecheck test test-ui test-tls test-host test-sandbox test-real test-stability benchmark test-installed check package install-vsix icons"
icons:
	npm run icons
install:
	npm ci
	node -e "require('node:fs').writeFileSync('$(DEPS_STAMP)', '')"
$(DEPS_STAMP): package.json package-lock.json
	$(MAKE) install
build: $(DEPS_STAMP)
	npm run compile
watch: $(DEPS_STAMP)
	npm run watch
test: $(DEPS_STAMP)
	npm test
test-ui: build
	node test/ui.cjs
test-tls: build
	node --test test/tls.cjs
test-host: build
	node test/extension-host.cjs
check: test test-ui test-tls test-host
package: $(DEPS_STAMP)
	npm run package
install-vsix: package
	code --install-extension vortex-agent.vsix --force

.PHONY: typecheck test-real
typecheck: $(DEPS_STAMP)
	npm run typecheck
test-real: $(DEPS_STAMP)
	npm run test:real

.PHONY: test-sandbox
test-sandbox: $(DEPS_STAMP)
	npm run test:sandbox

.PHONY: benchmark
benchmark: build
	node scripts/benchmark.cjs

.PHONY: test-installed
test-installed: package
	VORTEX_VSIX_PATH="$(CURDIR)/vortex-agent.vsix" node test/extension-host.cjs

.PHONY: test-stability
test-stability: package
	node scripts/stability-matrix.cjs
