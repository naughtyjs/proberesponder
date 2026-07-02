import {
  HealthStatus,
  isHealthOK,
  ProbeResponder,
  StatusKey,
  type StatusKey as StatusKeyType
} from "../../proberesponder";

/**
 * Error thrown when a dependency check exceeds its allotted timeout.
 */
export class ProbeTimeoutError extends Error {
  public readonly timeoutMs: number;

  public constructor(timeoutMs: number) {
    super(`probe timed out after ${String(timeoutMs)}ms`);
    this.name = "ProbeTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

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

  /**
   * Creates a dependency probe definition.
   */
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
  status: HealthStatus;
  affectedStatuses: StatusKeyType[];
  asOf: Date;
};

const withTimeout = async (
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<void>
): Promise<void> => {
  // A non-positive timeout means "no timeout": just run the check directly.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    const controller = new AbortController();
    await run(controller.signal);
    return;
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new ProbeTimeoutError(timeoutMs));
    }, timeoutMs);
    // Do not keep the event loop alive solely for a probe timeout.
    timeout.unref?.();
  });

  // Ensure the check promise always has a rejection handler attached, even when
  // the timeout wins the race. Without this, a checker that ignores the abort
  // signal and later rejects would surface as an unhandledRejection and can
  // crash the host process.
  const guardedRun = run(controller.signal);
  guardedRun.catch(() => {
    /* handled via Promise.race below; swallow late rejection after timeout */
  });

  try {
    await Promise.race([guardedRun, timeoutPromise]);
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
  // Capture a single "as of" instant for the whole batch so that all statuses
  // in one probing cycle share a consistent timestamp.
  const asOf = new Date();

  const statuses = await Promise.all(
    probers.map(async (prober): Promise<DependencyStatus> => {
      let status: HealthStatus = HealthStatus.OK;
      try {
        await withTimeout(timeoutMs, (signal) => prober.check(signal));
      } catch {
        status = HealthStatus.NotOK;
      }

      return {
        serviceId: prober.serviceId(),
        status,
        affectedStatuses: prober.affectsStatuses(),
        asOf
      };
    })
  );

  return statuses;
};

export interface Stopper {
  stop(): void;
}

export type StartOptions = {
  /**
   * When true, the underlying interval is `unref`'d so it will not keep the
   * Node.js process alive on its own. Defaults to false.
   */
  unref?: boolean;
};

/**
 * Structural type guard: returns true only for values that implement the full
 * {@link Prober} contract. This is what makes {@link start}'s trailing-options
 * detection safe — a real probe can never be mistaken for a `StartOptions`
 * object (and vice-versa), regardless of any incidental fields it may carry.
 */
const isProber = (value: unknown): value is Prober => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<Prober>;
  return (
    typeof candidate.check === "function" &&
    typeof candidate.serviceId === "function" &&
    typeof candidate.affectsStatuses === "function"
  );
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

/**
 * Starts a periodic dependency-probing loop that maps dependency health onto
 * the probe responder's startup/readiness/liveness statuses.
 *
 * The first probing cycle runs immediately (synchronously scheduled) and then
 * repeats every `delayMs` milliseconds. Overlapping cycles are skipped: if a
 * probing cycle is still in flight when the next tick fires, that tick is a
 * no-op, guaranteeing at most one concurrent cycle.
 *
 * An optional {@link StartOptions} object may be supplied as the final
 * argument. It is distinguished from probes structurally (see {@link isProber}),
 * so a probe is never accidentally consumed as options.
 *
 * @param delayMs Interval between probing cycles, in milliseconds. Also used as
 *   the per-check timeout.
 * @param pstatus The probe responder whose statuses will be updated.
 * @param pingersOrOptions One or more {@link Prober}s, optionally followed by a
 *   single {@link StartOptions} object.
 * @returns A {@link Stopper} to halt the loop, or `undefined` if no probers
 *   were supplied.
 */
export const start = (
  delayMs: number,
  pstatus: ProbeResponder,
  ...pingersOrOptions: [...Prober[], StartOptions] | Prober[]
): Stopper | undefined => {
  const last = pingersOrOptions.at(-1);
  const hasOptions = last !== undefined && !isProber(last);
  const options: StartOptions | undefined = hasOptions ? last : undefined;
  const pingers = (
    hasOptions ? pingersOrOptions.slice(0, -1) : pingersOrOptions
  ) as Prober[];

  if (pingers.length === 0) {
    return undefined;
  }

  let inFlight = false;
  let stopped = false;

  const runProbe = (): void => {
    if (inFlight || stopped) {
      return;
    }
    inFlight = true;
    void probe(delayMs, pstatus, ...pingers)
      .catch((err: unknown) => {
        console.error("proberesponder: dependency probing loop failed", err);
      })
      .finally(() => {
        inFlight = false;
      });
  };

  runProbe();
  const intervalRef = setInterval(runProbe, delayMs);
  if (options?.unref === true) {
    intervalRef.unref();
  }

  return {
    stop: () => {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(intervalRef);
    }
  };
};
