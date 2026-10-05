import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env.js";
import routes from "./routes/index.js";
import { notFoundHandler, errorHandler } from "./middleware/error.middleware.js";

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. native mobile apps, Postman)
      if (!origin) return callback(null, true);
      // In development, automatically allow localhost & LAN Wi-Fi IPs on any port (Vite, Metro 8081, Expo, etc.)
      if (!env.isProduction) {
        if (
          /^https?:\/\/localhost(:\d+)?$/.test(origin) ||
          /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin) ||
          /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin) ||
          /^https?:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)
        ) {
          return callback(null, true);
        }
      }
      if (env.corsOrigin.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);
// Payment Gateway Stage 7: Razorpay webhook signature verification must run
// against the EXACT raw request bytes, not a re-serialized
// JSON.stringify(parsedBody) -- key order/whitespace differences would make
// a genuine delivery fail verification (see
// razorpay.service.js's verifyWebhookSignature). Scoped to this one route,
// mounted BEFORE the app-wide express.json() below, so only this path
// receives a raw Buffer as req.body; body-parser's own internal `req._body`
// guard then makes express.json() a safe no-op for this one path afterward
// (it never re-parses a body a prior body-parser middleware already
// consumed), and every other route in the app is completely unaffected --
// no global change to JSON parsing behavior.
app.use("/api/v1/payments/webhook/razorpay", express.raw({ type: "*/*", limit: "2mb" }));
// Payout Subsystem Step 3C: the RazorpayX PAYOUT webhook needs the exact
// same raw-body treatment, for the exact same reason, at its own separate
// path -- verifyRazorpayXWebhookSignature (razorpayx.provider.js) must see
// the untouched bytes RazorpayX signed, not a re-serialized JSON.stringify.
// Scoped to this one route only; every other route (including the inbound
// payments webhook above) is unaffected.
app.use("/api/v1/payouts/webhook/razorpayx", express.raw({ type: "*/*", limit: "2mb" }));

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.isProduction ? "combined" : "dev"));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/api/v1", routes);

// 404 for anything unmatched, then the centralized error handler.
// Order matters: notFoundHandler must come after all real routes,
// errorHandler must be mounted last of all.
app.use(notFoundHandler);
app.use(errorHandler);
