import http, { type IncomingMessage, type ServerResponse } from "node:http";

import { ProbeResponder } from "../../proberesponder";

export const HTTPHeaderAccept = "Accept";
export const HTTPHeaderContentType = "Content-Type";
export const HTTPHeaderContentTypeJSON = "application/json";
export const HTTPHeaderContentTypeXML = "application/xml";
export const HTTPHeaderContentTypeHTML = "text/html";
export const HTTPHeaderContentTypePlain = "text/plain";

export const HTTPPathStartup = "/-/startup";
export const HTTPPathReady = "/-/ready";
export const HTTPPathLive = "/-/live";

const ACCEPTED_CONTENT_TYPES = [
  HTTPHeaderContentTypeHTML,
  HTTPHeaderContentTypePlain,
  HTTPHeaderContentTypeJSON
].join(",");

export type Handler = {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};

export const httpStartup =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notStarted() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const httpReady =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notReady() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const httpLive =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notLive() ? 503 : 200;
    respond(pres, req, res, status);
  };

/** @deprecated Use httpStartup instead. */
export const HTTPStartup = httpStartup;

/** @deprecated Use httpReady instead. */
export const HTTPReady = httpReady;

/** @deprecated Use httpLive instead. */
export const HTTPLive = httpLive;

const respond = (
  pres: ProbeResponder,
  req: IncomingMessage,
  res: ServerResponse,
  status: number
): void => {
  const { contentType, body } = contentNegotiator(
    req.headers.accept,
    pres.healthResponse()
  );
  res.setHeader(HTTPHeaderAccept, ACCEPTED_CONTENT_TYPES);
  res.setHeader(HTTPHeaderContentType, contentType);
  res.statusCode = status;
  res.end(body, (err?: Error) => {
    if (!err) {
      return;
    }
    console.error("proberesponder: failed writing HTTP response", err);
  });
};

const escapeMarkup = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const responseAsHTML = (payload: Record<string, string>): string => {
  const rows = Object.entries(payload)
    .map(
      ([key, value]) =>
        `<tr><th>${escapeMarkup(key)}</th><td>${escapeMarkup(value)}</td></tr>`
    )
    .join("");

  return `<table><tbody>${rows}</tbody></table>`;
};

const responseAsPlainText = (payload: Record<string, string>): string => {
  return Object.entries(payload)
    .map(([key, value]) => `${key}: ${value} | `)
    .join("");
};

const responseAsXML = (payload: Record<string, string>): string => {
  const statuses = Object.entries(payload)
    .map(
      ([key, value]) =>
        `<status name="${escapeMarkup(key)}" value="${escapeMarkup(value)}"></status>`
    )
    .join("");

  return `<statuses>${statuses}</statuses>`;
};

export const contentNegotiator = (
  acceptHeader: string | string[] | undefined,
  payload: Record<string, string>
): { contentType: string; body: string } => {
  const mergedHeader = Array.isArray(acceptHeader)
    ? acceptHeader.join(",")
    : acceptHeader ?? "";
  const contentTypes = mergedHeader.split(",");

  let selected = "";
  let maxQFactor = 0;

  for (const rawType of contentTypes) {
    const parts = rawType
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const candidateType = parts[0] ?? "";
    let qFactor = 0;

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (!lower.startsWith("q=")) {
        continue;
      }
      const maybeQ = Number.parseFloat(part.split("=")[1] ?? "0");
      qFactor = Number.isFinite(maybeQ) && maybeQ >= 0 && maybeQ <= 1 ? maybeQ : 0;
    }

    if (selected.length === 0 || qFactor > maxQFactor) {
      selected = candidateType;
      maxQFactor = qFactor;
    }
  }

  if (selected.includes(HTTPHeaderContentTypeHTML)) {
    return { contentType: HTTPHeaderContentTypeHTML, body: responseAsHTML(payload) };
  }

  if (selected.includes(HTTPHeaderContentTypePlain)) {
    return {
      contentType: HTTPHeaderContentTypePlain,
      body: responseAsPlainText(payload)
    };
  }

  if (selected.includes(HTTPHeaderContentTypeXML)) {
    return { contentType: HTTPHeaderContentTypeXML, body: responseAsXML(payload) };
  }

  return {
    contentType: HTTPHeaderContentTypeJSON,
    body: JSON.stringify(payload)
  };
};

/**
 * Creates a non-listening HTTP probe server.
 */
export const createServer = (
  pres: ProbeResponder,
  handlers: Handler[] = []
): http.Server => {
  const defaultHandlers: Handler[] = [
    { method: "GET", path: HTTPPathStartup, handler: httpStartup(pres) },
    { method: "GET", path: HTTPPathReady, handler: httpReady(pres) },
    { method: "GET", path: HTTPPathLive, handler: httpLive(pres) }
  ];

  const customHandlerKeys = new Set<string>();
  for (const customHandler of handlers) {
    customHandlerKeys.add(`${customHandler.method} ${customHandler.path}`);
  }

  const allHandlers = [...handlers];
  for (const defaultHandler of defaultHandlers) {
    const handlerKey = `${defaultHandler.method} ${defaultHandler.path}`;
    if (customHandlerKeys.has(handlerKey)) {
      console.warn(
        `proberesponder: custom handler overrides default ${handlerKey}`
      );
      continue;
    }
    allHandlers.push(defaultHandler);
  }

  const srv = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = (req.url ?? "").split("?")[0] ?? "";
    const reqMethod = req.method ?? "";
    const matched = allHandlers.find(
      (item) => item.path === reqUrl && item.method === reqMethod
    );
    if (!matched) {
      res.statusCode = 404;
      res.end();
      return;
    }
    matched.handler(req, res);
  });

  srv.headersTimeout = 1000;
  srv.requestTimeout = 1000;
  srv.keepAliveTimeout = 60000;

  return srv;
};

/**
 * Creates and starts an HTTP probe server on host:port.
 */
export const server = (
  pres: ProbeResponder,
  host: string,
  port: number,
  handlers: Handler[] = []
): http.Server => {
  const srv = createServer(pres, handlers);

  srv.listen(port, host);

  return srv;
};

/**
 * Starts the HTTP probe server and resolves when it is listening.
 */
export const startHTTPServer = async (
  pres: ProbeResponder,
  host: string,
  port: number
): Promise<http.Server> => {
  const srv = server(pres, host, port);

  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.once("listening", () => {
      srv.off("error", reject);
      resolve();
    });
  });

  return srv;
};
