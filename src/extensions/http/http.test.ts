import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ProbeResponder } from "../../proberesponder";
import {
  contentNegotiator,
  HTTPLive,
  HTTPPathLive,
  HTTPPathReady,
  HTTPPathStartup,
  HTTPReady,
  HTTPStartup,
  server,
  startHTTPServer
} from "./http";

const openServers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const srv of openServers.splice(0)) {
    srv.close();
  }
});

describe("contentNegotiator", () => {
  it("returns html when requested", () => {
    const out = contentNegotiator("text/html", { a: "b" });
    expect(out.contentType).toBe("text/html");
    expect(out.body).toContain("<table>");
  });

  it("returns plain text when requested", () => {
    const out = contentNegotiator("text/plain", { a: "b" });
    expect(out.contentType).toBe("text/plain");
    expect(out.body).toContain("a: b |");
  });

  it("returns xml when requested", () => {
    const out = contentNegotiator("application/xml", { a: "b" });
    expect(out.contentType).toBe("application/xml");
    expect(out.body).toContain("<statuses>");
  });

  it("falls back to json for unknown content type", () => {
    const out = contentNegotiator("image/png", { a: "b" });
    expect(out.contentType).toBe("application/json");
    expect(out.body).toBe('{"a":"b"}');
  });

  it("uses highest q-factor when multiple are provided", () => {
    const out = contentNegotiator(
      "application/json;q=0.2,text/plain;q=0.8,text/html;q=0.1",
      { a: "b" }
    );
    expect(out.contentType).toBe("text/plain");
  });
});

describe("http handlers", () => {
  it("respond with 503 by default", () => {
    const pRes = new ProbeResponder();
    let status = 200;
    const res = {
      setHeader: () => undefined,
      end: () => undefined,
      set statusCode(value: number) {
        status = value;
      }
    };

    HTTPStartup(pRes)({ headers: {} } as never, res as never);
    expect(status).toBe(503);

    HTTPReady(pRes)({ headers: {} } as never, res as never);
    expect(status).toBe(503);

    HTTPLive(pRes)({ headers: {} } as never, res as never);
    expect(status).toBe(503);
  });
});

describe("server", () => {
  it("serves default probe endpoints", async () => {
    const pRes = new ProbeResponder();
    const srv = await startHTTPServer(pRes, "127.0.0.1", 0);
    openServers.push(srv);

    const address = srv.address() as AddressInfo;
    const startupResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathStartup}`
    );
    expect(startupResp.status).toBe(503);

    pRes.setNotStarted(false);
    const startupOK = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathStartup}`
    );
    expect(startupOK.status).toBe(200);
  });

  it("returns 404 for method mismatch", async () => {
    const pRes = new ProbeResponder();
    const srv = server(pRes, "127.0.0.1", 0);
    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    openServers.push(srv);
    const address = srv.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}`,
      { method: "POST" }
    );
    expect(response.status).toBe(404);
  });

  it("allows extra handlers", async () => {
    const pRes = new ProbeResponder();
    const srv = server(pRes, "127.0.0.1", 0, [
      {
        method: "GET",
        path: "/custom",
        handler: (_req: IncomingMessage, res: ServerResponse) => {
          res.statusCode = 201;
          res.end("ok");
        }
      }
    ]);

    await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
    openServers.push(srv);
    const address = srv.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/custom`);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");

    const probeResponse = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathReady}`
    );
    expect(probeResponse.status).toBe(503);
  });
});
