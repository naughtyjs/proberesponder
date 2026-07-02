import { describe, expect, it } from "vitest";

import { ProbeResponder, StatusKey } from "../../proberesponder";
import { startHTTPServer, HTTPPathReady } from "../http";
import { checkerFunc, Probe, probeDependencies, start } from "./depprober";
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
});
