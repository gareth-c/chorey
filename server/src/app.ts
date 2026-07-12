import path from "node:path";
import express, { Router } from "express";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.routes";
import { usersRouter } from "./routes/users.routes";
import { portalRouter } from "./routes/portal.routes";
import { importRouter } from "./routes/import.routes";
import { settingsRouter } from "./routes/settings.routes";
import { requireAuth } from "./middleware/requireAuth";
import { registerRoutes as registerChoreRoutes } from "./chores/routes";
import { version } from "./version";
import { env } from "./env";

export function createApp() {
  const app = express();

  // Behind a reverse proxy (the documented HTTPS deployment), Express must
  // trust X-Forwarded-For — otherwise the login rate limiter keys every
  // client to the proxy's own IP (one shared attempt bucket for the whole
  // household), and express-rate-limit v7 hard-errors on the mismatch.
  app.set("trust proxy", env.trustProxy);

  // A multi-year chore-export.json easily exceeds express.json's 100kb
  // default — allow bigger bodies on the import route only, so the public
  // endpoints keep the small default.
  app.use("/api/import", express.json({ limit: "10mb" }));
  app.use(express.json());
  app.use(cookieParser());

  // Public build label — intentionally not behind requireAuth so the badge
  // renders on the login and Child Portal screens too.
  app.get("/api/version", (_req, res) => {
    res.json(version);
  });

  app.use("/api/auth", authRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/import", importRouter);
  app.use("/api/settings", settingsRouter);

  const choresRouter = Router();
  choresRouter.use(requireAuth);
  registerChoreRoutes(choresRouter);
  app.use("/api/chores", choresRouter);

  // Public, token-authenticated — intentionally not behind requireAuth.
  app.use("/api/portal", portalRouter);

  const clientDist = path.join(__dirname, "..", "public");
  app.use(express.static(clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  return app;
}
