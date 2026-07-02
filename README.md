# proberesponder

[![CI](https://github.com/naughtyjs/proberesponder/actions/workflows/ci.yml/badge.svg)](https://github.com/naughtyjs/proberesponder/actions/workflows/ci.yml)
[![GitHub Packages](https://img.shields.io/badge/GitHub%20Packages-%40naughtyjs%2Fproberesponder-blue?logo=github)](https://github.com/naughtyjs/proberesponder/pkgs/npm/proberesponder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

TypeScript + Node.js implementation of probe responder utilities for Kubernetes-style startup, readiness, and liveness endpoints.

All probe statuses are `NOT OK` by default. This is intentional so applications must explicitly mark status as healthy when ready.

## Compatibility

- Node.js `>=20`
- **ESM-only** (`"type": "module"`). This package ships no CommonJS build. From
  CommonJS you can still load it via dynamic `import()`:

    ```js
    const { ProbeResponder } = await import("@naughtyjs/proberesponder");
    ```

    Type resolution (`node16`/`nodenext`/`bundler`) and package correctness are
    verified in CI with [`publint`](https://publint.dev) and
    [`@arethetypeswrong/cli`](https://arethetypeswrong.github.io).

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

Responses use RFC 9110-compliant content negotiation over the `Accept` header:

- `application/json` (server-preferred default / fallback)
- `text/html`
- `text/plain`
- `application/xml`

An absent `q` parameter is treated as quality `1.0`, wildcards (`*/*`,
`text/*`) are honored, and ties are broken by the server preference order
above. Probe responses are sent with `Cache-Control: no-store` and an explicit
`Content-Length`.

Handler factory exports:

- `httpStartup`, `httpReady`, `httpLive` (preferred)
- `HTTPStartup`, `HTTPReady`, `HTTPLive` (deprecated aliases)

### Server options and custom handlers

`createServer`, `server`, and `startHTTPServer` accept optional custom handlers
and a `ServerOptions` object. Custom handlers may be async and are wrapped in an
error boundary that responds `500` on failure rather than hanging the socket.

```ts
import { ProbeResponder } from "@naughtyjs/proberesponder";
import { startHTTPServer } from "@naughtyjs/proberesponder/http";

const pRes = new ProbeResponder();

const srv = await startHTTPServer(
    pRes,
    "127.0.0.1",
    1234,
    [
        {
            method: "GET",
            path: "/metrics",
            handler: async (_req, res) => {
                res.statusCode = 200;
                res.end(await collectMetrics());
            }
        }
    ],
    {
        headersTimeout: 10_000,
        requestTimeout: 15_000,
        keepAliveTimeout: 60_000
    }
);
```

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
npm run check:package   # publint + are-the-types-wrong on the built package
```

## Notes on Go parity

- The package behavior mirrors the Go package features for core status handling, HTTP probes, and dependency probing.
- TypeScript intentionally does not support Go's nil receiver behavior.
- Timestamps are RFC3339 in UTC (`Z`) rather than local offset strings.
- Content negotiation follows RFC 9110 (absent `q` = 1.0, wildcard support),
  which is stricter than the original loose matching.

Architecture and parity decisions are documented in `docs/adrs/`.
