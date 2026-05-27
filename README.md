# proberesponder

TypeScript + Node.js implementation of probe responder utilities for Kubernetes-style startup, readiness, and liveness endpoints.

All probe statuses are `NOT OK` by default. This is intentional so applications must explicitly mark status as healthy when ready.

## Install

```bash
npm i @naughtyjs/proberesponder
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
);

stopper?.stop();
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```
