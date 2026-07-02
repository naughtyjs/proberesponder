import { describe, expect, it } from "vitest";

import {
  createProbeResponder,
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

  it("listener failures are contained", () => {
    const pRes = new ProbeResponder();
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      pRes.setListener(() => {
        throw new Error("boom");
      });

      expect(() => pRes.setNotLive(false)).not.toThrow();
      expect(errors.length).toBe(1);
    } finally {
      console.error = originalError;
    }
  });

  it("clears a previously set listener when called with no argument", () => {
    const pRes = new ProbeResponder();
    let calls = 0;
    pRes.setListener(() => {
      calls += 1;
    });
    pRes.setNotLive(false);
    expect(calls).toBe(1);

    pRes.setListener();
    pRes.setNotReady(false);
    expect(calls).toBe(1);
  });

  it("records an RFC3339 UTC timestamp without milliseconds", () => {
    const pRes = new ProbeResponder();
    pRes.setNotLive(false);
    const value = pRes.healthResponse()["probe->live"] ?? "";
    // Format: "OK: 2026-06-29T12:00:00Z"
    expect(value).toMatch(/^OK: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it("preserves key insertion order in healthResponse", () => {
    const pRes = new ProbeResponder();
    pRes.appendHealthResponse("alpha", "1");
    pRes.appendHealthResponse("beta", "2");
    const keys = Object.keys(pRes.healthResponse());
    // The three probe keys are written first (live, ready, startup), then ours.
    expect(keys.slice(-2)).toEqual(["alpha", "beta"]);
  });
});

describe("createProbeResponder", () => {
  it("returns a fully initialized ProbeResponder", () => {
    const pRes = createProbeResponder();
    expect(pRes).toBeInstanceOf(ProbeResponder);
    expect(pRes.notStarted()).toBe(true);
    expect(pRes.notReady()).toBe(true);
    expect(pRes.notLive()).toBe(true);
  });
});
