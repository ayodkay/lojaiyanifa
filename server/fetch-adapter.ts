// Converts between Node/Express-style request/response objects (what
// Cloud Functions' onRequest gives us) and Web Fetch Request/Response (what
// React Router's request handler speaks).
//
// Why not @react-router/express: Cloud Functions parses the request body
// before our code runs (it exposes req.body and req.rawBody), so the body
// stream is already consumed and an adapter that reads the stream would see
// an empty POST body. We build the Fetch Request from req.rawBody instead.

import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

export interface NodeRequestLike {
  method: string;
  url: string;
  originalUrl?: string;
  protocol?: string;
  headers: IncomingHttpHeaders;
  rawBody?: Buffer;
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  // Proxies may send a comma-separated chain; the first entry is the client-facing value.
  return raw?.split(",")[0]?.trim() || undefined;
}

export function toFetchRequest(req: NodeRequestLike, signal?: AbortSignal): Request {
  // Firebase Hosting forwards the public host/protocol in X-Forwarded-*.
  // These only affect routing; absolute URLs we generate (canonical links,
  // emails) use the configured SITE_URL, never the request host.
  const protocol = first(req.headers["x-forwarded-proto"]) ?? req.protocol ?? "https";
  const host = first(req.headers["x-forwarded-host"]) ?? first(req.headers.host) ?? "localhost";
  const url = new URL(req.originalUrl ?? req.url, `${protocol}://${host}`);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  const method = req.method.toUpperCase();
  const canHaveBody = method !== "GET" && method !== "HEAD";
  // Uint8Array.from copies into a plain ArrayBuffer, which is what BodyInit
  // accepts (a view over Node's Buffer is typed as possibly shared memory).
  const body =
    canHaveBody && req.rawBody && req.rawBody.length > 0 ? Uint8Array.from(req.rawBody) : undefined;

  return new Request(url, { method, headers, body, signal });
}

export async function sendFetchResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;

  for (const [name, value] of response.headers) {
    // Set-Cookie must not be comma-joined; it is sent separately below.
    if (name === "set-cookie") continue;
    res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), res);
}
