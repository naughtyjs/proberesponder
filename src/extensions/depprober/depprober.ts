import { HealthStatus, isHealthOK, ProbeResponder, StatusKey, type StatusKey as StatusKeyType } from "../../proberesponder";

export interface Checker {
  check(signal: AbortSignal): Promise<void>;
}

export type CheckerFunc = (signal: AbortSignal) => Promise<void>;

export interface Prober extends Checker {
  serviceId(): string;
  affectsStatuses(): StatusKeyType[];
}

export class Probe implements Prober {
  public readonly id: string;
  public readonly affectedStatuses: StatusKeyType[];
  private readonly checker: Checker | undefined;

  public constructor(params: {
    id: string;
    affectedStatuses: StatusKeyType[];
    checker?: Checker;
  }) {
    this.id = params.id;
    this.affectedStatuses = params.affectedStatuses;
    this.checker = params.checker;
  }

  public serviceId(): string {
    return this.id;
  }

  public affectsStatuses(): StatusKeyType[] {
    return this.affectedStatuses;
  }

  public async check(signal: AbortSignal): Promise<void> {
    if (!this.checker) {
      return;
    }
    await this.checker.check(signal);
  }
}

export const checkerFunc = (fn: CheckerFunc): Checker => ({
  check: fn
});

export type DependencyStatus = {
  serviceId: string;
  status: string;
  affectedStatuses: StatusKeyType[];
  asOf: Date;
};

const withTimeout = async (
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<void>
): Promise<void> => {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("probe timeout"));
    }, timeoutMs);
  });
  try {
    await Promise.race([run(controller.signal), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
};

export const probeDependencies = async (
  timeoutMs: number,
  ...probers: Prober[]
): Promise<DependencyStatus[]> => {
  const statuses = await Promise.all(
    probers.map(async (prober): Promise<DependencyStatus> => {
      let status: string = HealthStatus.OK;
      try {
        await withTimeout(timeoutMs, async (signal) => {
          await prober.check(signal);
        });
      } catch {
        status = HealthStatus.NotOK;
      }

      return {
        serviceId: prober.serviceId(),
        status,
        affectedStatuses: prober.affectsStatuses(),
        asOf: new Date()
      };
    })
  );

  return statuses;
};

export interface Stopper {
  stop(): void;
}

export type StartOptions = {
  unref?: boolean;
};

const asRFC3339 = (value: Date): string => {
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
};

const probe = async (
  delayMs: number,
  pstatus: ProbeResponder,
  ...pingers: Prober[]
): Promise<void> => {
  let startupOK = true;
  let readyOK = true;
  let liveOK = true;

  const statuses = await probeDependencies(delayMs, ...pingers);
  for (const hc of statuses) {
    pstatus.appendHealthResponse(
      hc.serviceId,
      `${hc.status}: ${asRFC3339(hc.asOf)}`
    );

    const ok = isHealthOK(hc.status);
    for (const affectedStatus of hc.affectedStatuses) {
      switch (affectedStatus) {
        case StatusKey.Startup:
          startupOK = startupOK && ok;
          break;
        case StatusKey.Ready:
          readyOK = readyOK && ok;
          break;
        case StatusKey.Live:
          liveOK = liveOK && ok;
          break;
        default:
          break;
      }
    }
  }

  pstatus.setNotStarted(!startupOK);
  pstatus.setNotReady(!readyOK);
  pstatus.setNotLive(!liveOK);
};

export const start = (
  delayMs: number,
  pstatus: ProbeResponder,
  ...pingersOrOptions: Array<Prober | StartOptions>
): Stopper | undefined => {
  const maybeOptions = pingersOrOptions.at(-1);
  const hasOptions =
    typeof maybeOptions === "object" &&
    maybeOptions !== null &&
    "unref" in maybeOptions;
  const options: StartOptions | undefined = hasOptions ? maybeOptions : undefined;
  const pingers = hasOptions
    ? (pingersOrOptions.slice(0, -1) as Prober[])
    : (pingersOrOptions as Prober[]);

  if (pingers.length === 0) {
    return undefined;
  }

  void probe(delayMs, pstatus, ...pingers);
  const intervalRef = setInterval(() => {
    void probe(delayMs, pstatus, ...pingers);
  }, delayMs);
  if (options?.unref === true) {
    intervalRef.unref();
  }

  return {
    stop: () => {
      clearInterval(intervalRef);
    }
  };
};
