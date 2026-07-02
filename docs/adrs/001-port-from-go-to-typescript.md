# 001 - Port proberesponder from Go to TypeScript

- Status: Accepted
- Date: 2026-05-27

## Context

The original implementation exists in Go (`naughtygopher/proberesponder`) and is used to expose startup, readiness, and liveness statuses with optional HTTP handlers and dependency probing helpers.

This repository needs equivalent functionality for the TypeScript + Node.js ecosystem while preserving behavior and key API concepts.

## Decision

Implement an ESM-only Node.js package in strict TypeScript with three modules:

1. Core probe responder state manager.
2. HTTP extension for probe endpoints and content negotiation.
3. Dependency prober extension for periodic health checks.

Key choices:

- Use class-based API (`new ProbeResponder()`), plus `createProbeResponder()` helper.
- Keep status constants as `const` object + union types.
- Use Node `http` module directly (no framework dependency).
- Use `AbortController` and timeouts for dependency checks.
- Provide tests via `vitest` to mirror Go behavior.

## Alternatives considered

1. Keep Go service and call it from Node
   - Pros: no porting cost.
   - Cons: cross-runtime operational complexity, mismatched packaging expectations.

2. Build framework-specific adapters first (Express/Fastify only)
   - Pros: easier drop-in for web apps.
   - Cons: not equivalent to the original stdlib-style package, tighter coupling.

## Consequences

Positive:

- Native TypeScript package with typed API.
- Zero-runtime dependency core behavior.
- Easy integration with Kubernetes probes in Node workloads.

Negative:

- Go nil receiver behavior does not exist in TypeScript.
- Concurrency control differs (Node event loop vs Go mutexes).
- Package consumers on CommonJS need transpilation or ESM interop support.

## API parity notes

- `server(pres, host, port, handlers?)` now binds and starts listening immediately, aligning with practical Go usage where a configured server is usually started immediately through `ListenAndServe`.
- Custom handlers that collide with default probe endpoints take precedence in TypeScript and emit a warning.
- HTTP path matching ignores query strings to align with Go mux behavior for endpoint routing.
- Timestamps are emitted in RFC3339 UTC (`Z`) format. Go usually emits local offset based RFC3339.
- Node `http` does not have a direct write-timeout equivalent to Go's `WriteTimeout`; `keepAliveTimeout` is set to `60s` to match Go idle timeout intent.
- HTTP handler factories now support idiomatic camelCase (`httpStartup`, `httpReady`, `httpLive`) and keep Go-style PascalCase aliases as deprecated exports.
- `HealthStatus` remains publicly exported for TS ergonomics.
