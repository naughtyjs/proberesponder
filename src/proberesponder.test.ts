import { describe, expect, it } from "vitest";

import {
  HealthStatus,
  isHealthOK,
  ProbeResponder,
  StatusKey
} from "./proberesponder";

describe("isHealthOK", () => {
  it("returns true for OK", () => {
    expect(isHealthOK(HealthStatus.OK)).toBe(true);
  });

  it("returns false for NOT OK", () => {
    expect(isHealthOK(HealthStatus.NotOK)).toBe(false);
  });

  it("returns false for arbitrary values", () => {
    expect(isHealthOK("hello")).toBe(false);
  });
});

describe("StatusKey", () => {
  it("matches expected string values", () => {
    expect(StatusKey.Startup).toBe("startup");
    expect(StatusKey.Ready).toBe("ready");
    expect(StatusKey.Live).toBe("live");
  });
});

describe("ProbeResponder", () => {
  it("starts with all probe statuses set to NOT OK", () => {
    const pRes = new ProbeResponder();

    expect(pRes.notLive()).toBe(true);
    expect(pRes.notReady()).toBe(true);
    expect(pRes.notStarted()).toBe(true);

    const response = pRes.healthResponse();
    expect(Object.keys(response)).toHaveLength(3);
    expect(response["probe->live"]).toContain("NOT OK:");
    expect(response["probe->ready"]).toContain("NOT OK:");
    expect(response["probe->startup"]).toContain("NOT OK:");
  });

  it("appendHealthResponse overwrites existing key", () => {
    const pRes = new ProbeResponder();
    pRes.appendHealthResponse("db", "OK");
    expect(pRes.healthResponse().db).toBe("OK");

    pRes.appendHealthResponse("db", "NOT OK");
    expect(pRes.healthResponse().db).toBe("NOT OK");
  });

  it("healthResponse returns a copy", () => {
    const pRes = new ProbeResponder();
    const response = pRes.healthResponse();
    response.injected = "value";
    expect(pRes.healthResponse().injected).toBeUndefined();
  });

  it("setters update status values and payload", () => {
    const pRes = new ProbeResponder();
    pRes.setNotStarted(false);
    pRes.setNotReady(false);
    pRes.setNotLive(false);

    expect(pRes.notStarted()).toBe(false);
    expect(pRes.notReady()).toBe(false);
    expect(pRes.notLive()).toBe(false);

    const response = pRes.healthResponse();
    expect(response["probe->startup"]).toContain("OK:");
    expect(response["probe->ready"]).toContain("OK:");
    expect(response["probe->live"]).toContain("OK:");
  });

  it("setListener receives changes", () => {
    const pRes = new ProbeResponder();
    const events: Array<{ status: string; value: boolean }> = [];

    pRes.setListener((status, value) => {
      events.push({ status, value });
    });

    pRes.setNotLive(false);
    pRes.setNotReady(false);
    pRes.setNotStarted(false);

    expect(events).toEqual([
      { status: StatusKey.Live, value: false },
      { status: StatusKey.Ready, value: false },
      { status: StatusKey.Startup, value: false }
    ]);
  });
});
