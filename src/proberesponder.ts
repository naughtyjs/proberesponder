export const StatusKey = {
  Startup: "startup",
  Ready: "ready",
  Live: "live"
} as const;

export type StatusKey = (typeof StatusKey)[keyof typeof StatusKey];

export const HealthStatus = {
  OK: "OK",
  NotOK: "NOT OK"
} as const;

export type HealthStatus = (typeof HealthStatus)[keyof typeof HealthStatus];

/**
 * A snapshot of all known health statuses, keyed by name. Probe-managed keys
 * are prefixed with `probe->` (see {@link StatusKey}); caller-supplied keys use
 * whatever name was passed to {@link ProbeResponder.appendHealthResponse}.
 */
export type HealthResponse = Record<string, string>;

/**
 * Invoked synchronously whenever a startup/readiness/liveness status changes.
 * `value` is the new "not-OK" flag: `true` means the probe is NOT healthy.
 */
export type StatusChangeListener = (status: StatusKey, value: boolean) => void;

const PROBE_PREFIX = "probe->";

const asRFC3339 = (value: Date): string => {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
};

export const isHealthOK = (value: string): boolean => {
  return value === HealthStatus.OK;
};

/**
 * Thread-of-execution-safe, dependency-free manager of Kubernetes-style
 * startup, readiness, and liveness statuses.
 *
 * All statuses start as NOT OK (`notStarted`/`notReady`/`notLive` return
 * `true`). This is intentional: an application must explicitly mark itself
 * healthy once it is actually ready, so it can never accidentally report ready
 * before initialization completes.
 */
export class ProbeResponder {
  private notReadyValue: boolean;
  private notLiveValue: boolean;
  private notStartedValue: boolean;
  private readonly msgPayload: Map<string, string>;
  private changeListener: StatusChangeListener | undefined;

  public constructor() {
    this.notReadyValue = false;
    this.notLiveValue = false;
    this.notStartedValue = false;
    this.msgPayload = new Map<string, string>();

    this.setNotLive(true);
    this.setNotReady(true);
    this.setNotStarted(true);
  }

  /**
   * Appends or replaces a health status key/value in the response payload.
   * Insertion order is preserved for new keys; re-setting an existing key keeps
   * its original position (standard `Map` semantics).
   */
  public appendHealthResponse(key: string, value: string): void {
    this.msgPayload.set(key, value);
  }

  /**
   * Returns a shallow copy of all known health statuses. The returned object is
   * a snapshot: mutating it does not affect the responder's internal state.
   */
  public healthResponse(): HealthResponse {
    return Object.fromEntries(this.msgPayload.entries());
  }

  public setNotReady(value: boolean): void {
    this.notReadyValue = value;
    this.onChange(StatusKey.Ready, value);
  }

  public setNotLive(value: boolean): void {
    this.notLiveValue = value;
    this.onChange(StatusKey.Live, value);
  }

  public setNotStarted(value: boolean): void {
    this.notStartedValue = value;
    this.onChange(StatusKey.Startup, value);
  }

  /**
   * Sets (or clears, when called with no argument) the listener invoked
   * whenever startup/live/ready status changes. Only one listener is supported;
   * setting a new one replaces the previous. The listener is called
   * synchronously from the setter; a throwing listener is caught and logged so
   * it can never disrupt status updates.
   */
  public setListener(listener?: StatusChangeListener): void {
    this.changeListener = listener;
  }

  public notReady(): boolean {
    return this.notReadyValue;
  }

  public notLive(): boolean {
    return this.notLiveValue;
  }

  public notStarted(): boolean {
    return this.notStartedValue;
  }

  private onChange(status: StatusKey, value: boolean): void {
    const healthValue: HealthStatus = value
      ? HealthStatus.NotOK
      : HealthStatus.OK;
    this.appendHealthResponse(
      `${PROBE_PREFIX}${status}`,
      `${healthValue}: ${asRFC3339(new Date())}`
    );

    if (!this.changeListener) {
      return;
    }

    try {
      this.changeListener(status, value);
    } catch (err) {
      console.error("proberesponder: status change listener failed", err);
    }
  }
}

/**
 * Convenience factory equivalent to `new ProbeResponder()`. Prefer the
 * constructor directly; this exists for functional-style call sites and Go
 * parity.
 */
export const createProbeResponder = (): ProbeResponder => {
  return new ProbeResponder();
};
