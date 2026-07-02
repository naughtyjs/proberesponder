import http from "node:http";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";

import { ProbeResponder } from "../dist/index.js";
import {
  contentNegotiator,
  createServer
} from "../dist/extensions/http/index.js";

// Zero-dependency benchmark: exercises the two hot paths a probe server
// spends its time in — pure content negotiation, and a full HTTP request
// round trip — using only Node built-ins. Run with `npm run bench`.
//
// Results are illustrative, not a guarantee: they depend on the host
// machine, Node version, and system load. Run it yourself for numbers that
// matter for your environment.

const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 3000);
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY ?? 50);
const NEGOTIATOR_ITERATIONS = Number(
  process.env.BENCH_NEGOTIATOR_ITERATIONS ?? 2_000_000
);

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

const formatNumber = (value) => numberFormatter.format(value);

const percentile = (sortedValuesAsc, p) => {
  if (sortedValuesAsc.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValuesAsc.length - 1,
    Math.floor(p * sortedValuesAsc.length)
  );
  return sortedValuesAsc[index];
};

const benchContentNegotiator = () => {
  const payload = {
    "probe->startup": "OK: 2026-07-02T00:00:00Z",
    "probe->ready": "OK: 2026-07-02T00:00:00Z",
    "probe->live": "OK: 2026-07-02T00:00:00Z",
    mydb: "OK: 2026-07-02T00:00:00Z"
  };
  const acceptHeaders = [
    "application/json",
    "text/html",
    "text/plain",
    "application/xml",
    undefined
  ];

  // Warm up the JIT before measuring.
  for (let i = 0; i < 10_000; i += 1) {
    contentNegotiator(acceptHeaders[i % acceptHeaders.length], payload);
  }

  const start = performance.now();
  for (let i = 0; i < NEGOTIATOR_ITERATIONS; i += 1) {
    contentNegotiator(acceptHeaders[i % acceptHeaders.length], payload);
  }
  const elapsedMs = performance.now() - start;
  const opsPerSec = NEGOTIATOR_ITERATIONS / (elapsedMs / 1000);

  console.log("## contentNegotiator (pure function, no I/O)");
  console.log(`iterations:  ${formatNumber(NEGOTIATOR_ITERATIONS)}`);
  console.log(`elapsed:     ${elapsedMs.toFixed(1)}ms`);
  console.log(`throughput:  ${formatNumber(opsPerSec)} ops/sec`);
  console.log("");
};

const benchHTTPServer = async () => {
  const pRes = new ProbeResponder();
  pRes.setNotLive(false);
  const srv = createServer(pRes);

  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const { port } = srv.address();
  const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

  const latenciesMs = [];
  let completed = 0;
  let stop = false;

  const fireOne = () =>
    new Promise((resolve) => {
      const start = performance.now();
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/-/live",
          method: "GET",
          agent
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            latenciesMs.push(performance.now() - start);
            completed += 1;
            resolve();
          });
        }
      );
      req.on("error", () => {
        resolve();
      });
      req.end();
    });

  const worker = async () => {
    while (!stop) {
      await fireOne();
    }
  };

  const benchStart = performance.now();
  const workers = Array.from({ length: CONCURRENCY }, () => worker());

  await sleep(DURATION_MS);
  stop = true;
  await Promise.all(workers);
  const elapsedMs = performance.now() - benchStart;

  agent.destroy();
  await new Promise((resolve, reject) => {
    srv.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  latenciesMs.sort((a, b) => a - b);
  const reqPerSec = completed / (elapsedMs / 1000);

  console.log("## End-to-end HTTP GET /-/live (keep-alive, loopback)");
  console.log(`concurrency: ${CONCURRENCY}`);
  console.log(`duration:    ${(elapsedMs / 1000).toFixed(2)}s`);
  console.log(`requests:    ${formatNumber(completed)}`);
  console.log(`throughput:  ${formatNumber(reqPerSec)} req/sec`);
  console.log(`latency p50: ${percentile(latenciesMs, 0.5).toFixed(2)}ms`);
  console.log(`latency p95: ${percentile(latenciesMs, 0.95).toFixed(2)}ms`);
  console.log(`latency p99: ${percentile(latenciesMs, 0.99).toFixed(2)}ms`);
  console.log(`latency max: ${percentile(latenciesMs, 1).toFixed(2)}ms`);
};

console.log(
  `Node.js ${process.version} on ${process.platform}/${process.arch}\n`
);
benchContentNegotiator();
await benchHTTPServer();
