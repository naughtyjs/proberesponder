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

export const HTTPStartup =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notStarted() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const HTTPReady =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notReady() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const HTTPLive =
  (pres: ProbeResponder) => (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notLive() ? 503 : 200;
    respond(pres, req, res, status);
  };

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
  res.end(body);
};

const responseAsHTML = (payload: Record<string, string>): string => {
  const rows = Object.entries(payload)
    .map(([key, value]) => `<tr><th>${key}</th><td>${value}</td></tr>`)
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
        `<status name="${key}" value="${value}"></status>`
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

export const server = (
  pres: ProbeResponder,
  host: string,
  port: number,
  handlers: Handler[] = []
): http.Server => {
  const allHandlers = [
    ...handlers,
    { method: "GET", path: HTTPPathStartup, handler: HTTPStartup(pres) },
    { method: "GET", path: HTTPPathReady, handler: HTTPReady(pres) },
    { method: "GET", path: HTTPPathLive, handler: HTTPLive(pres) }
  ];

  const srv = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = req.url ?? "";
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
  srv.keepAliveTimeout = 5000;
  void host;
  void port;

  return srv;
};

export const startHTTPServer = async (
  pres: ProbeResponder,
  host: string,
  port: number
): Promise<http.Server> => {
  const srv = server(pres, host, port);

  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(port, host, () => {
      srv.off("error", reject);
      resolve();
    });
  });

  return srv;
};
