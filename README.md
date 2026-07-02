# proberesponder

[![CI](https://github.com/naughtyjs/proberesponder/actions/workflows/ci.yml/badge.svg)](https://github.com/naughtyjs/proberesponder/actions/workflows/ci.yml)
[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40naughtyjs%2Fproberesponder-blue?logo=github)](https://github.com/naughtyjs/proberesponder/pkgs/npm/proberesponder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

TypeScript + Node.js implementation of probe responder utilities for Kubernetes-style startup, readiness, and liveness endpoints.

All probe statuses are `NOT OK` by default. This is intentional so applications must explicitly mark status as healthy when ready.

## Compatibility

- Node.js `>=20`
- ESM package (`"type": "module"`)

## Install

This package is published to **GitHub Packages**. Point the `@naughtyjs` scope at
GitHub's registry, then install:

```bash
# .npmrc (in your project or ~/.npmrc)
@naughtyjs:registry=https://npm.pkg.github.com
```

```bash
npm i @naughtyjs/proberesponder
```

Installing requires authenticating to GitHub Packages with a personal access
token that has the `read:packages` scope:

```bash
# .npmrc
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## Core usage

```ts
import { ProbeResponder } from "@naughtyjs/proberesponder";
import { startHTTPServer } from "@naughtyjs/proberesponder/http";

const pRes = new ProbeResponder();

await startHTTPServer(pRes, "127.0.0.1", 1234);

pRes.setListener((status, value) => {
  console.log(status, "changed to", value);
});

pRes.setNotStarted(false);
pRes.setNotLive(false);
pRes.setNotReady(false);

pRes.appendHealthResponse("mydb", "OK");
console.log(pRes.healthResponse());
```

## HTTP extension

Default endpoints:

- `/-/startup`
- `/-/ready`
- `/-/live`

Responses support content negotiation for:

- `application/json` (fallback default)
- `text/html`
- `text/plain`
- `application/xml`

Handler factory exports:

- `httpStartup`, `httpReady`, `httpLive` (preferred)
- `HTTPStartup`, `HTTPReady`, `HTTPLive` (deprecated aliases)

## Dependency prober extension

Use `@naughtyjs/proberesponder/depprober` to periodically check dependency health and map failures to probe statuses.

```ts
import { ProbeResponder, StatusKey } from "@naughtyjs/proberesponder";
import { checkerFunc, Probe, start } from "@naughtyjs/proberesponder/depprober";

const pRes = new ProbeResponder();

const stopper = start(
  5000,
  pRes,
  new Probe({
    id: "database",
    affectedStatuses: [StatusKey.Ready, StatusKey.Live],
    checker: checkerFunc(async () => {
      // throw on failure
    })
  })
  // optional final argument for Node process behavior
  // { unref: true }
);

stopper?.stop();
```

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

## Notes on Go parity

- The package behavior mirrors the Go package features for core status handling, HTTP probes, and dependency probing.
- TypeScript intentionally does not support Go's nil receiver behavior.
- Timestamps are RFC3339 in UTC (`Z`) rather than local offset strings.

Architecture and parity decisions are documented in `docs/adrs/001-port-from-go-to-typescript.md`.
