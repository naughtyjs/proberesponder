import { describe, expect, it } from "vitest";

import { ProbeResponder, StatusKey } from "../../proberesponder";
import { startHTTPServer, HTTPPathReady } from "../http";
import {
  checkerFunc,
  Probe,
  probeDependencies,
  ProbeTimeoutError,
  start
} from "./depprober";
import type { Prober } from "./depprober";
import type { AddressInfo } from "node:net";

const sleep = async (ms: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe("probeDependencies", () => {
  it("returns OK for successful probes", async () => {
    const statuses = await probeDependencies(
      100,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      })
    );

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.serviceId).toBe("db");
    expect(statuses[0]?.status).toBe("OK");
  });

  it("returns NOT OK for failing probes", async () => {
    const statuses = await probeDependencies(
      100,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => {
          throw new Error("down");
        })
      })
    );

    expect(statuses[0]?.status).toBe("NOT OK");
  });

  it("respects timeout", async () => {
    const statuses = await probeDependencies(
      10,
      new Probe({
        id: "slow",
        affectedStatuses: [StatusKey.Live],
        checker: checkerFunc(async () => {
          await sleep(50);
        })
      })
    );
    expect(statuses[0]?.status).toBe("NOT OK");
  });

  it("stamps every dependency in a batch with a single shared instant", async () => {
    const statuses = await probeDependencies(
      100,
      new Probe({
        id: "a",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      }),
      new Probe({
        id: "b",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(async () => {
          await sleep(20);
        })
      })
    );

    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.asOf.getTime()).toBe(statuses[1]?.asOf.getTime());
  });

  it("runs the check directly when timeout is non-positive", async () => {
    let ran = false;
    const statuses = await probeDependencies(
      0,
      new Probe({
        id: "no-timeout",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(async () => {
          ran = true;
          await Promise.resolve();
        })
      })
    );
    expect(ran).toBe(true);
    expect(statuses[0]?.status).toBe("OK");
  });

  it("passes an abort signal that fires on timeout", async () => {
    let aborted = false;
    const statuses = await probeDependencies(
      10,
      new Probe({
        id: "aborts",
        affectedStatuses: [StatusKey.Live],
        checker: checkerFunc(
          (signal) =>
            new Promise((resolve, reject) => {
              signal.addEventListener("abort", () => {
                aborted = true;
                reject(new Error("aborted"));
              });
              setTimeout(resolve, 100);
            })
        )
      })
    );
    expect(statuses[0]?.status).toBe("NOT OK");
    expect(aborted).toBe(true);
  });

  it("does not crash on a checker that ignores abort and rejects late", async () => {
    let unhandled: unknown;
    const onUnhandled = (err: unknown): void => {
      unhandled = err;
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const statuses = await probeDependencies(
        10,
        new Probe({
          id: "late",
          affectedStatuses: [StatusKey.Live],
          checker: checkerFunc(
            () =>
              new Promise((_resolve, reject) => {
                setTimeout(() => {
                  reject(new Error("late failure"));
                }, 40);
              })
          )
        })
      );
      expect(statuses[0]?.status).toBe("NOT OK");
      await sleep(80);
      expect(unhandled).toBeUndefined();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("reports OK for a Probe with no checker", async () => {
    const statuses = await probeDependencies(
      50,
      new Probe({ id: "noop", affectedStatuses: [StatusKey.Startup] })
    );
    expect(statuses[0]?.status).toBe("OK");
  });

  it("isolates a prober whose serviceId() throws from the rest of the batch", async () => {
    const broken: Prober = {
      serviceId: () => {
        throw new Error("id boom");
      },
      affectsStatuses: () => [StatusKey.Ready],
      check: () => Promise.resolve()
    };

    const statuses = await probeDependencies(
      100,
      broken,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      })
    );

    expect(statuses).toHaveLength(2);
    // The broken prober still gets a visible, synthetic entry instead of
    // silently vanishing or failing the whole batch.
    expect(statuses[0]?.serviceId).toBe("prober[0]");
    expect(statuses[0]?.status).toBe("NOT OK");
    expect(statuses[0]?.affectedStatuses).toEqual([]);
    // The healthy prober is entirely unaffected by its neighbor's bug.
    expect(statuses[1]?.serviceId).toBe("db");
    expect(statuses[1]?.status).toBe("OK");
  });

  it("isolates a prober whose affectsStatuses() throws from the rest of the batch", async () => {
    const broken: Prober = {
      serviceId: () => "flaky",
      affectsStatuses: () => {
        throw new Error("scope boom");
      },
      check: () => Promise.resolve()
    };

    const statuses = await probeDependencies(
      100,
      new Probe({
        id: "cache",
        affectedStatuses: [StatusKey.Live],
        checker: checkerFunc(() => Promise.resolve())
      }),
      broken
    );

    expect(statuses).toHaveLength(2);
    expect(statuses[0]?.serviceId).toBe("cache");
    expect(statuses[0]?.status).toBe("OK");
    // serviceId() succeeded so its result is preserved even though
    // affectsStatuses() failed afterwards.
    expect(statuses[1]?.serviceId).toBe("flaky");
    expect(statuses[1]?.status).toBe("NOT OK");
    expect(statuses[1]?.affectedStatuses).toEqual([]);
  });

  it("does not fail the whole batch when a prober throws synchronously outside check()", async () => {
    const broken: Prober = {
      serviceId: () => {
        throw new Error("id boom");
      },
      affectsStatuses: () => {
        throw new Error("scope boom");
      },
      check: () => Promise.resolve()
    };

    await expect(
      probeDependencies(
        100,
        new Probe({
          id: "a",
          affectedStatuses: [StatusKey.Ready],
          checker: checkerFunc(() => Promise.resolve())
        }),
        broken,
        new Probe({
          id: "b",
          affectedStatuses: [StatusKey.Live],
          checker: checkerFunc(() => Promise.resolve())
        })
      )
    ).resolves.toHaveLength(3);
  });
});

describe("ProbeTimeoutError", () => {
  it("carries the timeout duration and a descriptive name", () => {
    const err = new ProbeTimeoutError(1234);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ProbeTimeoutError");
    expect(err.timeoutMs).toBe(1234);
    expect(err.message).toContain("1234");
  });
});

describe("start", () => {
  it("returns undefined when no pingers provided", () => {
    const pRes = new ProbeResponder();
    expect(start(10, pRes)).toBeUndefined();
  });

  it("updates probe responder status from dependency results", async () => {
    const pRes = new ProbeResponder();
    const stopper = start(
      20,
      pRes,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      }),
      new Probe({
        id: "cache",
        affectedStatuses: [StatusKey.Live],
        checker: checkerFunc(() => {
          throw new Error("cache down");
        })
      })
    );

    expect(stopper).toBeDefined();
    await sleep(60);

    expect(pRes.notReady()).toBe(false);
    expect(pRes.notLive()).toBe(true);
    expect(pRes.healthResponse().db).toContain("OK:");
    expect(pRes.healthResponse().cache).toContain("NOT OK:");

    stopper?.stop();
  });

  it("skips overlapping scheduler cycles", async () => {
    const pRes = new ProbeResponder();
    let concurrent = 0;
    let maxConcurrent = 0;
    const stopper = start(
      50,
      pRes,
      new Probe({
        id: "slow",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await sleep(35);
          concurrent -= 1;
        })
      })
    );

    await sleep(180);
    stopper?.stop();

    expect(pRes.healthResponse().slow).toBeDefined();
    expect(maxConcurrent).toBe(1);
  });

  it("updates HTTP readiness endpoint after dependency failures", async () => {
    const pRes = new ProbeResponder();
    pRes.setNotReady(false);
    const srv = await startHTTPServer(pRes, "127.0.0.1", 0);

    try {
      const address = srv.address() as AddressInfo;
      const before = await fetch(
        `http://127.0.0.1:${address.port}${HTTPPathReady}`
      );
      expect(before.status).toBe(200);

      const stopper = start(
        20,
        pRes,
        new Probe({
          id: "database",
          affectedStatuses: [StatusKey.Ready],
          checker: checkerFunc(() => {
            throw new Error("db down");
          })
        })
      );

      await sleep(60);
      stopper?.stop();

      const after = await fetch(
        `http://127.0.0.1:${address.port}${HTTPPathReady}`
      );
      expect(after.status).toBe(503);
    } finally {
      await new Promise<void>((resolve, reject) => {
        srv.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("logs probe loop failures without crashing", async () => {
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const stopper = start(
        20,
        null as unknown as ProbeResponder,
        new Probe({
          id: "db",
          affectedStatuses: [StatusKey.Ready],
          checker: checkerFunc(() => Promise.resolve())
        })
      );

      await sleep(40);
      stopper?.stop();
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      console.error = originalError;
    }
  });

  it("accepts a trailing options object without consuming a probe", async () => {
    const pRes = new ProbeResponder();
    const stopper = start(
      20,
      pRes,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      }),
      { unref: true }
    );

    expect(stopper).toBeDefined();
    await sleep(40);
    // The single probe still ran (was not mistaken for options).
    expect(pRes.healthResponse().db).toContain("OK:");
    stopper?.stop();
  });

  it("returns undefined when only options are supplied", () => {
    const pRes = new ProbeResponder();
    expect(start(20, pRes, { unref: true })).toBeUndefined();
  });

  it("does not treat a probe as options even with extra fields", async () => {
    const pRes = new ProbeResponder();
    const probe = new Probe({
      id: "db",
      affectedStatuses: [StatusKey.Ready],
      checker: checkerFunc(() => Promise.resolve())
    });
    // Attach an incidental field; it must not confuse options detection.
    (probe as unknown as { unref: boolean }).unref = true;

    const stopper = start(20, pRes, probe);
    expect(stopper).toBeDefined();
    await sleep(40);
    expect(pRes.healthResponse().db).toContain("OK:");
    stopper?.stop();
  });

  it("has an idempotent stop()", async () => {
    const pRes = new ProbeResponder();
    const stopper = start(
      20,
      pRes,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      })
    );

    expect(stopper).toBeDefined();
    stopper?.stop();
    // Calling stop again must be a harmless no-op.
    expect(() => stopper?.stop()).not.toThrow();
    await sleep(40);
  });

  it("maps a startup-affecting dependency onto notStarted", async () => {
    const pRes = new ProbeResponder();
    pRes.setNotStarted(false);
    const stopper = start(
      20,
      pRes,
      new Probe({
        id: "migrations",
        affectedStatuses: [StatusKey.Startup],
        checker: checkerFunc(() => {
          throw new Error("migrations pending");
        })
      })
    );

    await sleep(60);
    stopper?.stop();
    expect(pRes.notStarted()).toBe(true);
    expect(pRes.healthResponse().migrations).toContain("NOT OK:");
  });

  it("stops scheduling further cycles after stop() during a slow probe", async () => {
    const pRes = new ProbeResponder();
    let runs = 0;
    const stopper = start(
      20,
      pRes,
      new Probe({
        id: "slow",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(async () => {
          runs += 1;
          await sleep(30);
        })
      })
    );

    // Stop almost immediately, while the first cycle is still in flight.
    await sleep(5);
    stopper?.stop();
    const runsAtStop = runs;

    await sleep(120);
    // No new cycles should have started after stop().
    expect(runs).toBe(runsAtStop);
  });

  it("keeps updating healthy probers even when a sibling Prober's metadata methods throw", async () => {
    const pRes = new ProbeResponder();
    const broken: Prober = {
      serviceId: () => {
        throw new Error("id boom");
      },
      affectsStatuses: () => {
        throw new Error("scope boom");
      },
      check: () => Promise.resolve()
    };

    const stopper = start(
      20,
      pRes,
      broken,
      new Probe({
        id: "db",
        affectedStatuses: [StatusKey.Ready],
        checker: checkerFunc(() => Promise.resolve())
      })
    );

    await sleep(60);
    stopper?.stop();

    expect(pRes.notReady()).toBe(false);
    expect(pRes.healthResponse().db).toContain("OK:");
    expect(pRes.healthResponse()["prober[0]"]).toContain("NOT OK:");
  });
});
