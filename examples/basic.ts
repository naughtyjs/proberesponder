import { ProbeResponder, StatusKey } from "../src";
import { startHTTPServer } from "../src/extensions/http";
import { checkerFunc, Probe, start } from "../src/extensions/depprober";

// For published usage, import from:
// import { ProbeResponder, StatusKey } from "@naughtyjs/proberesponder";
// import { startHTTPServer } from "@naughtyjs/proberesponder/http";
// import { checkerFunc, Probe, start } from "@naughtyjs/proberesponder/depprober";

const run = async (): Promise<void> => {
  const pRes = new ProbeResponder();

  pRes.setListener((status, value) => {
    console.log(`${status} changed to ${value}`);
  });

  const srv = await startHTTPServer(pRes, "127.0.0.1", 1234);

  // Mark the process started/live; readiness is driven by the dependency prober.
  pRes.setNotStarted(false);
  pRes.setNotLive(false);

  // Periodically probe a dependency and map failures onto readiness.
  const stopper = start(
    5000,
    pRes,
    new Probe({
      id: "mydb",
      affectedStatuses: [StatusKey.Ready],
      checker: checkerFunc(async (signal) => {
        // Replace with a real check; throw (or abort) to mark NOT OK.
        await Promise.resolve(signal);
      })
    }),
    { unref: true }
  );

  console.log(pRes.healthResponse());

  // Graceful shutdown wiring (illustrative).
  process.once("SIGINT", () => {
    stopper?.stop();
    srv.close();
  });
};

void run();
