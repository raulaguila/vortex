SHELL := /bin/sh
.PHONY: help install build watch test test-ui test-tls test-host check package install-vsix icons
help:
	@echo "install build watch test test-ui test-tls test-host check package install-vsix icons"
icons:
	npm run icons
install:
	npm ci
build:
	npm run compile
watch:
	npm run watch
test:
	npm test
test-ui: build
	node test/ui.cjs
test-tls: build
	node --test test/tls.cjs
test-host: build
	node test/extension-host.cjs
check: test test-ui test-tls test-host
package:
	npm run package
install-vsix: package
	code --install-extension vortex-agent.vsix --force
