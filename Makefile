.PHONY: all install build watch link pack release clean

# Default target
all: build

# Install node dependencies
install:
	npm install

# Build the plugin (compile TypeScript and bundle assets)
build:
	npm run build

# Watch files and auto-reload the plugin in the Stream Deck app during development
watch:
	npm run watch

# Register the plugin directory with the local Stream Deck application
link:
	npx @elgato/cli link com.joern-arne.nagios.sdPlugin

# Package the compiled plugin into the official .streamDeckPlugin installer format
pack: build
	npx @elgato/cli pack com.joern-arne.nagios.sdPlugin --force

# Alias to package the release
release: pack

# Clean generated build artifacts and installer packages
clean:
	rm -f com.joern-arne.nagios.sdPlugin/bin/plugin.js
	rm -f *.streamDeckPlugin
