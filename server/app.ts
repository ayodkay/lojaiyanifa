// Cloud Functions entry point. Vite builds this file as the SSR bundle
// (see vite.config.ts), so build/server/index.js exports these functions.
//
// - `ssr`: renders every page and resource route (Firebase Hosting rewrites
//   all non-static paths here; see firebase.json).
// - `expirePixOrders`: every 15 minutes, cancels orders still unpaid after
//   their Pix deadline and releases their stock (app/.server/admin-orders.ts).
//   Needs Cloud Scheduler (enabled by the first deploy on a Blaze project).
//
// Region: São Paulo, closest to Brazilian customers. Firestore should be
// created in the same region.

import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { expireOverdueOrders } from "~/.server/admin-orders";

import { sendFetchResponse, toFetchRequest } from "./fetch-adapter";

export const REGION = "southamerica-east1";

setGlobalOptions({ region: REGION });

const handleRequest = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export const ssr = onRequest(
  {
    memory: "512MiB",
    timeoutSeconds: 60,
    concurrency: 80,
    maxInstances: 20,
    // Cold starts can be removed with minInstances: 1 (billed while idle).
    // Decide per environment; see docs/operations.md.
  },
  async (req, res) => {
    const controller = new AbortController();
    // Abort loaders if the client disconnects before we finish.
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    const request = toFetchRequest(req, controller.signal);
    const response = await handleRequest(request, new RouterContextProvider());
    await sendFetchResponse(res, response);
  },
);

export const expirePixOrders = onSchedule(
  {
    schedule: "every 15 minutes",
    timeZone: "America/Sao_Paulo",
    memory: "256MiB",
    timeoutSeconds: 300,
    // One run at a time; a failed run isn't retried — the next one, 15 minutes later, picks up what's left.
    maxInstances: 1,
    retryCount: 0,
  },
  async () => {
    // Throws ExpiryRunError when some order couldn't be cancelled (logged as an error, after the others were handled).
    const run = await expireOverdueOrders();
    const parts = [`cancelled ${run.expired.length} order(s)${run.expired.length ? `: ${run.expired.join(", ")}` : ""}`];
    if (run.skipped.length) parts.push(`settled meanwhile by an admin: ${run.skipped.join(", ")}`);
    if (run.more) parts.push("more remain for the next run");
    console.log(`[pix-expiry] ${parts.join("; ")}`);
  },
);
