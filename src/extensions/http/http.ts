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

// Advertised in the `Accept` response header. Kept in sync with the set of
// producible representations (see PRODUCIBLE_TYPES), ordered by preference.
const ACCEPTED_CONTENT_TYPES = [
  HTTPHeaderContentTypeJSON,
  HTTPHeaderContentTypeHTML,
  HTTPHeaderContentTypePlain,
  HTTPHeaderContentTypeXML
].join(", ");

export type Handler = {
  method: string;
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
};

export const httpStartup =
  (pres: ProbeResponder) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notStarted() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const httpReady =
  (pres: ProbeResponder) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notReady() ? 503 : 200;
    respond(pres, req, res, status);
  };

export const httpLive =
  (pres: ProbeResponder) =>
  (req: IncomingMessage, res: ServerResponse): void => {
    const status = pres.notLive() ? 503 : 200;
    respond(pres, req, res, status);
  };

/** @deprecated Use httpStartup instead. */
export const HTTPStartup = httpStartup;

/** @deprecated Use httpReady instead. */
export const HTTPReady = httpReady;

/** @deprecated Use httpLive instead. */
export const HTTPLive = httpLive;

const CONTENT_TYPE_CHARSET_SUFFIX = "; charset=utf-8";

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
  res.setHeader(
    HTTPHeaderContentType,
    contentType + CONTENT_TYPE_CHARSET_SUFFIX
  );
  // Probe responses reflect live state and must never be cached by proxies,
  // sidecars, or the kubelet.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body).toString());
  res.statusCode = status;
  res.end(body, (err?: Error) => {
    if (!err) {
      return;
    }
    console.error("proberesponder: failed writing HTTP response", err);
  });
};

const MARKUP_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

const MARKUP_PATTERN = /[&<>"']/g;

/**
 * Escapes HTML/XML-significant characters in a single pass. Applied to all
 * caller-supplied health keys and values before they are embedded in HTML or
 * XML responses, preventing markup/attribute injection.
 */
const escapeMarkup = (value: string): string => {
  return value.replace(MARKUP_PATTERN, (char) => MARKUP_ESCAPES[char] ?? char);
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

/**
 * Media types this responder can produce, ordered by server preference. Used to
 * break ties when a client accepts multiple types at equal quality and to pick
 * a default when the client sends a wildcard.
 */
const PRODUCIBLE_TYPES = [
  HTTPHeaderContentTypeJSON,
  HTTPHeaderContentTypeHTML,
  HTTPHeaderContentTypePlain,
  HTTPHeaderContentTypeXML
] as const;

type ProducibleType = (typeof PRODUCIBLE_TYPES)[number];

const RENDERERS: Record<
  ProducibleType,
  (payload: Record<string, string>) => string
> = {
  [HTTPHeaderContentTypeJSON]: (payload) => JSON.stringify(payload),
  [HTTPHeaderContentTypeHTML]: responseAsHTML,
  [HTTPHeaderContentTypePlain]: responseAsPlainText,
  [HTTPHeaderContentTypeXML]: responseAsXML
};

type MediaRange = {
  type: string;
  subtype: string;
  quality: number;
  /** Server preference index for the matched producible type (lower = better). */
  order: number;
};

/**
 * Parses an HTTP `Accept` header into media ranges with RFC 9110 semantics:
 * quality defaults to 1.0 when `q` is absent, and malformed `q` values fall
 * back to 0. Ranges with `q=0` are treated as explicit rejections.
 */
const parseAcceptHeader = (header: string): MediaRange[] => {
  const ranges: MediaRange[] = [];

  for (const rawRange of header.split(",")) {
    const parts = rawRange
      .split(";")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    const mediaType = parts[0]?.toLowerCase();
    if (mediaType === undefined || mediaType.length === 0) {
      continue;
    }

    const slash = mediaType.indexOf("/");
    const type = slash === -1 ? mediaType : mediaType.slice(0, slash);
    const subtype = slash === -1 ? "*" : mediaType.slice(slash + 1);

    // RFC 9110: absent q parameter means quality 1.0.
    let quality = 1;
    for (const param of parts.slice(1)) {
      const eq = param.indexOf("=");
      if (eq === -1) {
        continue;
      }
      if (param.slice(0, eq).trim().toLowerCase() !== "q") {
        continue;
      }
      const parsed = Number.parseFloat(param.slice(eq + 1).trim());
      quality =
        Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0;
    }

    ranges.push({ type, subtype, quality, order: Number.MAX_SAFE_INTEGER });
  }

  return ranges;
};

/** Returns true if the given media range matches the concrete producible type. */
const rangeMatches = (
  range: MediaRange,
  producible: ProducibleType
): boolean => {
  const slash = producible.indexOf("/");
  const pType = producible.slice(0, slash);
  const pSubtype = producible.slice(slash + 1);

  const typeOK = range.type === "*" || range.type === pType;
  const subtypeOK = range.subtype === "*" || range.subtype === pSubtype;
  return typeOK && subtypeOK;
};

/**
 * Selects a response content type and renders the payload accordingly using
 * RFC 9110-compliant content negotiation.
 *
 * Selection rules:
 * - Absent `q` defaults to quality 1.0.
 * - The producible type with the highest acceptable quality wins.
 * - Ties are broken by server preference ({@link PRODUCIBLE_TYPES} order).
 * - If nothing is acceptable (e.g. all `q=0` or no matching range), falls back
 *   to JSON, which is the canonical machine-readable representation.
 */
export const contentNegotiator = (
  acceptHeader: string | string[] | undefined,
  payload: Record<string, string>
): { contentType: string; body: string } => {
  const mergedHeader = Array.isArray(acceptHeader)
    ? acceptHeader.join(",")
    : (acceptHeader ?? "");

  const ranges = parseAcceptHeader(mergedHeader);

  let best: ProducibleType | undefined;
  let bestQuality = 0;
  let bestOrder = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < PRODUCIBLE_TYPES.length; i += 1) {
    const producible = PRODUCIBLE_TYPES[i] as ProducibleType;

    let quality = 0;
    for (const range of ranges) {
      if (rangeMatches(range, producible) && range.quality > quality) {
        quality = range.quality;
      }
    }

    if (quality <= 0) {
      continue;
    }

    // Higher quality wins; ties go to the more-preferred (lower order) type.
    if (quality > bestQuality || (quality === bestQuality && i < bestOrder)) {
      best = producible;
      bestQuality = quality;
      bestOrder = i;
    }
  }

  const contentType = best ?? HTTPHeaderContentTypeJSON;
  const render = RENDERERS[contentType];
  return { contentType, body: render(payload) };
};

/**
 * Tunables for the probe HTTP server. All fields are optional; the defaults are
 * chosen to be safe for liveness/readiness traffic on busy nodes (a too-small
 * request timeout can cause spurious probe failures under GC pauses or load).
 */
export type ServerOptions = {
  /**
   * Time (ms) allowed to receive the complete request headers.
   * Maps to {@link http.Server.headersTimeout}. Default: 10_000.
   */
  headersTimeout?: number;
  /**
   * Time (ms) allowed to receive the entire request.
   * Maps to {@link http.Server.requestTimeout}. Default: 15_000.
   */
  requestTimeout?: number;
  /**
   * Idle keep-alive timeout (ms).
   * Maps to {@link http.Server.keepAliveTimeout}. Default: 60_000.
   */
  keepAliveTimeout?: number;
};

const DEFAULT_SERVER_OPTIONS: Required<ServerOptions> = {
  headersTimeout: 10_000,
  requestTimeout: 15_000,
  keepAliveTimeout: 60_000
};

const routeKey = (method: string, path: string): string => `${method} ${path}`;

/**
 * Invokes a route handler with a safety net: any synchronous throw or rejected
 * promise is caught and turned into a 500 (if the response has not started),
 * ensuring a misbehaving custom handler can never leave a socket hung.
 */
const invokeHandler = (
  handler: Handler["handler"],
  req: IncomingMessage,
  res: ServerResponse
): void => {
  const onError = (err: unknown): void => {
    console.error("proberesponder: request handler failed", err);
    if (!res.headersSent) {
      res.statusCode = 500;
    }
    if (!res.writableEnded) {
      res.end();
    }
  };

  try {
    const result = handler(req, res);
    if (result instanceof Promise) {
      result.catch(onError);
    }
  } catch (err) {
    onError(err);
  }
};

/**
 * Creates a non-listening HTTP probe server.
 *
 * Routing is exact-match on method + path (query strings are ignored) and runs
 * in O(1) via an internal route map. Custom handlers that collide with a
 * default probe route take precedence and emit a warning.
 */
export const createServer = (
  pres: ProbeResponder,
  handlers: Handler[] = [],
  options: ServerOptions = {}
): http.Server => {
  const defaultHandlers: Handler[] = [
    { method: "GET", path: HTTPPathStartup, handler: httpStartup(pres) },
    { method: "GET", path: HTTPPathReady, handler: httpReady(pres) },
    { method: "GET", path: HTTPPathLive, handler: httpLive(pres) }
  ];

  const routes = new Map<string, Handler["handler"]>();
  for (const custom of handlers) {
    routes.set(routeKey(custom.method, custom.path), custom.handler);
  }
  for (const fallback of defaultHandlers) {
    const key = routeKey(fallback.method, fallback.path);
    if (routes.has(key)) {
      console.warn(`proberesponder: custom handler overrides default ${key}`);
      continue;
    }
    routes.set(key, fallback.handler);
  }

  const srv = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? "").split("?", 1)[0] ?? "";
    const method = req.method ?? "";
    const handler = routes.get(routeKey(method, path));
    if (handler === undefined) {
      res.statusCode = 404;
      res.end();
      return;
    }
    invokeHandler(handler, req, res);
  });

  const resolved = { ...DEFAULT_SERVER_OPTIONS, ...options };
  srv.headersTimeout = resolved.headersTimeout;
  srv.requestTimeout = resolved.requestTimeout;
  srv.keepAliveTimeout = resolved.keepAliveTimeout;

  return srv;
};

/**
 * Creates and starts an HTTP probe server on host:port.
 *
 * Note: this returns as soon as `listen` is called; the socket may not yet be
 * bound. Prefer {@link startHTTPServer} when you need to await readiness or
 * handle bind errors.
 */
export const server = (
  pres: ProbeResponder,
  host: string,
  port: number,
  handlers: Handler[] = [],
  options: ServerOptions = {}
): http.Server => {
  const srv = createServer(pres, handlers, options);

  srv.listen(port, host);

  return srv;
};

/**
 * Starts the HTTP probe server and resolves when it is listening, or rejects if
 * binding fails.
 */
export const startHTTPServer = async (
  pres: ProbeResponder,
  host: string,
  port: number,
  handlers: Handler[] = [],
  options: ServerOptions = {}
): Promise<http.Server> => {
  const srv = createServer(pres, handlers, options);

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      reject(err);
    };
    srv.once("error", onError);
    srv.once("listening", () => {
      srv.off("error", onError);
      resolve();
    });
    srv.listen(port, host);
  });

  return srv;
};
