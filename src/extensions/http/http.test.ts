import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ProbeResponder } from "../../proberesponder";
import {
  contentNegotiator,
  createServer,
  httpStartup,
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

  it("supports uppercase Q parameter", () => {
    const out = contentNegotiator("application/json;Q=0.1,text/html;Q=0.8", {
      a: "b"
    });
    expect(out.contentType).toBe("text/html");
  });

  it("ignores malformed q-factor values", () => {
    const out = contentNegotiator("text/plain;q=bad,application/json;q=0.4", {
      a: "b"
    });
    expect(out.contentType).toBe("application/json");
  });

  it("handles extra whitespace and params", () => {
    const out = contentNegotiator(" text/plain ; level=1 ; q=0.9 ", { a: "b" });
    expect(out.contentType).toBe("text/plain");
  });

  it("accepts multiple accept header values", () => {
    const out = contentNegotiator(["application/json;q=0.2", "text/plain;q=0.7"], {
      a: "b"
    });
    expect(out.contentType).toBe("text/plain");
  });

  it("escapes markup in html keys and values to prevent injection", () => {
    const out = contentNegotiator("text/html", {
      "<script>": "</td><img src=x onerror=alert(1)>"
    });
    expect(out.body).not.toContain("<script>");
    expect(out.body).not.toContain("<img");
    expect(out.body).toContain("&lt;script&gt;");
    expect(out.body).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("escapes attribute-breaking characters in xml output", () => {
    const out = contentNegotiator("application/xml", {
      'db"': 'OK"><status name="x'
    });
    expect(out.body).not.toContain('name="db""');
    expect(out.body).toContain("&quot;");
    expect(out.body).not.toContain('value="OK"><status');
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

  it("logs write failures", () => {
    const pRes = new ProbeResponder();
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const res = {
        setHeader: () => undefined,
        end: (_body: string, cb?: (err?: Error) => void) => {
          cb?.(new Error("write failed"));
        },
        set statusCode(_value: number) {
          // no-op setter for test double
        }
      };

      httpStartup(pRes)({ headers: { accept: "application/json" } } as never, res as never);
      expect(errors.length).toBe(1);
    } finally {
      console.error = originalError;
    }
  });
});

describe("server", () => {
  it("createServer returns a non-listening server", () => {
    const pRes = new ProbeResponder();
    const srv = createServer(pRes);
    openServers.push(srv);

    expect(srv.listening).toBe(false);
  });

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
    openServers.push(srv);
    await new Promise<void>((resolve) => srv.once("listening", resolve));
    const address = srv.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}`,
      { method: "POST" }
    );
    expect(response.status).toBe(404);
  });

  it("allows extra handlers", async () => {
    const pRes = new ProbeResponder();
    const originalWarn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
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

      openServers.push(srv);
      await new Promise<void>((resolve) => srv.once("listening", resolve));
      const address = srv.address() as AddressInfo;

      const response = await fetch(`http://127.0.0.1:${address.port}/custom`);
      expect(response.status).toBe(201);
      expect(await response.text()).toBe("ok");

      const probeResponse = await fetch(
        `http://127.0.0.1:${address.port}${HTTPPathReady}`
      );
      expect(probeResponse.status).toBe(503);
      expect(warnings.length).toBe(0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("warns when custom handlers override default probe route", async () => {
    const pRes = new ProbeResponder();
    const originalWarn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(args);
    };

    try {
      const srv = createServer(pRes, [
        {
          method: "GET",
          path: HTTPPathReady,
          handler: (_req: IncomingMessage, res: ServerResponse) => {
            res.statusCode = 299;
            res.end("custom");
          }
        }
      ]);
      openServers.push(srv);
      await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
      const address = srv.address() as AddressInfo;

      const response = await fetch(
        `http://127.0.0.1:${address.port}${HTTPPathReady}`
      );
      expect(response.status).toBe(299);
      expect(warnings.length).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("matches endpoints with query strings", async () => {
    const pRes = new ProbeResponder();
    pRes.setNotLive(false);
    const srv = server(pRes, "127.0.0.1", 0);
    openServers.push(srv);
    await new Promise<void>((resolve) => srv.once("listening", resolve));
    const address = srv.address() as AddressInfo;

    const response = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}?foo=bar`
    );
    expect(response.status).toBe(200);
  });

  it("serves requested response content type", async () => {
    const pRes = new ProbeResponder();
    pRes.setNotLive(false);
    const srv = server(pRes, "127.0.0.1", 0);
    openServers.push(srv);
    await new Promise<void>((resolve) => srv.once("listening", resolve));
    const address = srv.address() as AddressInfo;

    const htmlResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}`,
      { headers: { Accept: "text/html" } }
    );
    expect(htmlResp.headers.get("content-type")).toContain("text/html");

    const xmlResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}`,
      { headers: { Accept: "application/xml" } }
    );
    expect(xmlResp.headers.get("content-type")).toContain("application/xml");

    const jsonResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathLive}`,
      { headers: { Accept: "application/json" } }
    );
    expect(jsonResp.headers.get("content-type")).toContain("application/json");
  });

  it("returns 404 for HEAD and OPTIONS methods", async () => {
    const pRes = new ProbeResponder();
    const srv = server(pRes, "127.0.0.1", 0);
    openServers.push(srv);
    await new Promise<void>((resolve) => srv.once("listening", resolve));
    const address = srv.address() as AddressInfo;

    const headResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathStartup}`,
      { method: "HEAD" }
    );
    expect(headResp.status).toBe(404);

    const optionsResp = await fetch(
      `http://127.0.0.1:${address.port}${HTTPPathStartup}`,
      { method: "OPTIONS" }
    );
    expect(optionsResp.status).toBe(404);
  });
});
