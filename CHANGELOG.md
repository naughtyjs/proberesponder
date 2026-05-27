# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [0.1.0] - 2026-05-27

### Added

- Initial TypeScript + Node.js port of `proberesponder`.
- Core `ProbeResponder` with startup/readiness/liveness status management.
- HTTP extension with default probe endpoints and content negotiation.
- Dependency prober extension for periodic dependency health checks.
- Vitest test suite for core, HTTP, and depprober modules.
- CI workflow for Node.js 20 and 22 with lint/typecheck/test/build.

### Changed

- `server(...)` binds and starts listening for parity with intended Go usage.
- Added camelCase HTTP handlers (`httpStartup`, `httpReady`, `httpLive`) with deprecated PascalCase aliases.
- Added optional `unref` support in dependency prober `start(...)` options.
