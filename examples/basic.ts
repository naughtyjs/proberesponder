import { ProbeResponder } from "../src";
import { startHTTPServer } from "../src/extensions/http";

// For published usage, import from:
// import { ProbeResponder } from "@naughtyjs/proberesponder";
// import { startHTTPServer } from "@naughtyjs/proberesponder/http";

const run = async (): Promise<void> => {
  const pRes = new ProbeResponder();

  await startHTTPServer(pRes, "127.0.0.1", 1234);

  pRes.setListener((status, value) => {
    console.log(`${status} changed to ${value}`);
  });

  pRes.setNotStarted(false);
  pRes.setNotLive(false);
  pRes.setNotReady(false);

  pRes.appendHealthResponse("mydb", "OK");

  console.log(pRes.healthResponse());
};

void run();
