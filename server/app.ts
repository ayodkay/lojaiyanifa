// Cloud Functions entry point. Vite builds this file as the SSR bundle
// (see vite.config.ts), so build/server/index.js exports these functions.
//
// - `ssr`: renders every page and resource route (Firebase Hosting rewrites
//   all non-static paths here; see firebase.json).
//
// Region: São Paulo, closest to Brazilian customers. Firestore should be
// created in the same region.

import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { createRequestHandler, RouterContextProvider } from "react-router";

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
