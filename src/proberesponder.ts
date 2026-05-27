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

export type StatusChangeListener = (status: StatusKey, value: boolean) => void;

const PROBE_PREFIX = "probe->";

const asRFC3339 = (value: Date): string => {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
};

export const isHealthOK = <T extends string>(value: T): boolean => {
  return value === HealthStatus.OK;
};

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

  public appendHealthResponse(key: string, value: string): void {
    this.msgPayload.set(key, value);
  }

  public healthResponse(): Record<string, string> {
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
    const healthValue = value ? HealthStatus.NotOK : HealthStatus.OK;
    this.appendHealthResponse(
      `${PROBE_PREFIX}${status}`,
      `${healthValue}: ${asRFC3339(new Date())}`
    );
    this.changeListener?.(status, value);
  }
}

export const createProbeResponder = (): ProbeResponder => {
  return new ProbeResponder();
};
