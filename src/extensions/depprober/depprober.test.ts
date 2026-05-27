import { describe, expect, it } from "vitest";

import { ProbeResponder, StatusKey } from "../../proberesponder";
import { checkerFunc, Probe, probeDependencies, start } from "./depprober";

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
        checker: checkerFunc(async () => undefined)
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
        checker: checkerFunc(async () => {
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
        checker: checkerFunc(async () => undefined)
      }),
      new Probe({
        id: "cache",
        affectedStatuses: [StatusKey.Live],
        checker: checkerFunc(async () => {
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
});
