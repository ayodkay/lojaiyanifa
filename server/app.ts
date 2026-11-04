// Cloud Functions entry point. Vite builds this file as the SSR bundle
// (see vite.config.ts), so build/server/index.js exports these functions.
//
// - `ssr`: renders every page and resource route (Firebase Hosting rewrites
//   all non-static paths here; see firebase.json).
// - `expirePixOrders`: every 15 minutes, cancels orders still unpaid after
//   their Pix deadline and releases their stock (app/.server/admin-orders.ts).
//   Needs Cloud Scheduler (enabled by the first deploy on a Blaze project).
// - `sendMailOutbox`: every 2 minutes, sends the e-mails waiting in the
//   `mail` outbox through SMTP (Brevo; app/.server/mail/send.ts). Uses the
//   secret SMTP_PASSWORD, which must exist before this function is deployed:
//   firebase functions:secrets:set SMTP_PASSWORD --project prod
//
// Region: São Paulo, closest to Brazilian customers. Firestore should be
// created in the same region.

import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createRequestHandler, RouterContextProvider } from "react-router";

import { expireOverdueOrders } from "~/.server/admin-orders";
import { runMailOutbox } from "~/.server/mail/send";

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

/** The Brevo SMTP key (Brevo → SMTP & API → SMTP). Secret Manager only; "unset" keeps e-mails waiting. */
const smtpPassword = defineSecret("SMTP_PASSWORD");

export const sendMailOutbox = onSchedule(
  {
    schedule: "every 2 minutes",
    timeZone: "America/Sao_Paulo",
    memory: "256MiB",
    timeoutSeconds: 120,
    // One run at a time (each e-mail is also claimed in a transaction); a failed run isn't retried: the next one is.
    maxInstances: 1,
    retryCount: 0,
    secrets: [smtpPassword],
  },
  async () => {
    const run = await runMailOutbox(smtpPassword.value());
    if (run.waiting > 0) {
      console.error(`[mail] ${run.waiting} e-mail(s) waiting: SMTP not configured (MAIL_FROM, SMTP_USER, secret SMTP_PASSWORD)`);
      return;
    }
    const parts = [`sent ${run.sent.length}`];
    if (run.retrying.length) parts.push(`retrying ${run.retrying.join(", ")}`);
    if (run.failed.length) parts.push(`failed ${run.failed.join(", ")}`);
    if (run.expired.length) parts.push(`expired ${run.expired.join(", ")}`);
    if (run.sent.length || run.retrying.length || run.failed.length || run.expired.length) console.log(`[mail] ${parts.join("; ")}`);
  },
);
