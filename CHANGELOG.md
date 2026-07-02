# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog.

## [0.2.0] - 2026-07-02

### Added

- `ServerOptions` for the HTTP extension: configurable `headersTimeout`,
  `requestTimeout`, and `keepAliveTimeout`. `createServer`, `server`, and
  `startHTTPServer` all accept optional custom handlers and options.
- `ProbeTimeoutError` (exported from `/depprober`) thrown when a dependency
  check exceeds its timeout; carries the `timeoutMs` value.
- `HealthResponse` type alias for the shape returned by
  `ProbeResponder.healthResponse()`.
- Async route handlers are now supported by the HTTP server and are wrapped in
  an error boundary that responds `500` instead of leaving a socket hung.
- Probe responses now send `Cache-Control: no-store`, an explicit
  `Content-Length`, and a `; charset=utf-8` content type.
- Packaging quality gates: `publint --strict` and `@arethetypeswrong/cli`,
  wired into CI, the release workflow, and `prepublishOnly`.

### Changed

- **Content negotiation is now RFC 9110-compliant.** An absent `q` parameter
  defaults to quality `1.0` (previously treated as `0`), wildcards (`*/*` and
  `type/*`) are supported, media types are matched exactly (no more loose
  substring matching), and ties are broken by a documented server preference
  (JSON > HTML > plain > XML). This changes selection for `Accept` headers that
  omit `q` values.
- HTTP server default timeouts raised from `1000ms` to safe values
  (`headersTimeout` 10s, `requestTimeout` 15s) to avoid spurious probe failures
  under load or GC pauses. `keepAliveTimeout` remains 60s.
- HTTP routing is now O(1) via an internal route map instead of a linear scan.
- `depprober.start()` options detection is now structural and safe: a probe can
  never be mistaken for a trailing `StartOptions` object, and `stop()` is
  idempotent and prevents further scheduling.
- `probeDependencies()` now stamps every dependency in a batch with a single
  shared `asOf` instant, captured at the start of the cycle.
- `DependencyStatus.status` is now typed as `HealthStatus` instead of `string`.
- The `Accept` response header now advertises all four producible types,
  including `application/xml`.
- Coverage thresholds raised to lines 95% / branches 88% / functions 100%.

### Removed

- JavaScript sourcemaps (`*.map`) are no longer published to the npm tarball,
  reducing install size (~34% smaller).

### Fixed

- Dependency checks that ignore their `AbortSignal` and reject after timing out
  no longer surface as an `unhandledRejection` that could crash the host
  process.
- `escapeMarkup` now escapes in a single pass.

## [0.1.1] - 2026-06-29

### Fixed

- Escape markup in HTTP probe HTML/XML responses to prevent XSS and attribute injection from caller-supplied health keys/values.

### Security

- Add `npm audit --audit-level=high` gate to CI and patch high/moderate dev dependency advisories.

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
