import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import type { PrismaClient } from "@prisma/client";
import { hiringAuthentication, protectOrigin, requireRole } from "./auth.js";
import { HiringError, MAX_FILE_SIZE, PDF, PPTX } from "./domain.js";
import { hiringController } from "./controller.js";
import { HiringRepository } from "./repository.js";
import { HiringService } from "./service.js";
import { PostgresProfileStorage, type ProfileStorage } from "./storage.js";
import { log } from "./logger.js";
export function createHiringRouter(
  db: PrismaClient,
  storage: ProfileStorage = new PostgresProfileStorage(db),
  authentication: RequestHandler = hiringAuthentication(db),
) {
  const router = express.Router();
  const controller = hiringController(
    new HiringService(new HiringRepository(db), storage),
  );
  router.use((req, res, next) => {
    const started = performance.now();
    res.locals.requestId = randomUUID();
    res.set({
      "X-Request-Id": res.locals.requestId,
      "Cache-Control": "no-store",
    });
    res.on("finish", () =>
      log("hiring.request", {
        requestId: res.locals.requestId,
        method: req.method,
        route: req.route?.path,
        status: res.statusCode,
        latencyMs: Math.round(performance.now() - started),
      }),
    );
    next();
  });
  const guards = (role: "IT_VENDOR" | "HIRING_MANAGER") => [
    authentication,
    requireRole(role),
    protectOrigin,
  ];
  router.get(
    "/hiring/session",
    authentication,
    requireRole(),
    controller.session,
  );
  router.get("/vendor/openings", ...guards("IT_VENDOR"), controller.openings);
  router.get(
    "/vendor/openings/:id",
    ...guards("IT_VENDOR"),
    controller.details,
  );
  router.get(
    "/vendor/openings/:id/profiles",
    ...guards("IT_VENDOR"),
    controller.profiles,
  );
  router.post(
    "/vendor/openings/:id/profiles/presign",
    ...guards("IT_VENDOR"),
    controller.reserve,
  );
  router.put(
    "/vendor/openings/:id/profiles/uploads/:uploadId",
    ...guards("IT_VENDOR"),
    express.raw({ type: [PDF, PPTX], limit: MAX_FILE_SIZE }),
    controller.upload,
  );
  router.post(
    "/vendor/openings/:id/profiles/upload",
    ...guards("IT_VENDOR"),
    controller.submit,
  );
  router.delete(
    "/vendor/profiles/:id",
    ...guards("IT_VENDOR"),
    controller.remove,
  );
  router.get(
    "/vendor/profiles/:id/file",
    ...guards("IT_VENDOR"),
    controller.file,
  );
  router.get(
    "/hiring-manager/openings",
    ...guards("HIRING_MANAGER"),
    controller.openings,
  );
  router.get(
    "/hiring-manager/openings/:id",
    ...guards("HIRING_MANAGER"),
    controller.details,
  );
  router.get(
    "/hiring-manager/openings/:id/profiles",
    ...guards("HIRING_MANAGER"),
    controller.profiles,
  );
  router.get(
    "/hiring-manager/profiles/:id/file",
    ...guards("HIRING_MANAGER"),
    controller.file,
  );
  router.post(
    "/hiring-manager/profiles/:id/shortlist",
    ...guards("HIRING_MANAGER"),
    controller.shortlist,
  );
  router.post(
    "/hiring-manager/profiles/:id/reject",
    ...guards("HIRING_MANAGER"),
    controller.reject,
  );
  router.post(
    "/hiring-manager/profiles/:id/recommend",
    ...guards("HIRING_MANAGER"),
    controller.retry,
  );
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    const status =
      error instanceof HiringError
        ? error.status
        : error.type === "entity.too.large"
          ? 413
          : 500;
    const code =
      error instanceof HiringError
        ? error.code
        : status === 413
          ? "FILE_TOO_LARGE"
          : "INTERNAL_ERROR";
    log("hiring.error", { requestId: res.locals.requestId, code, status });
    res.status(status).json({
      code,
      message:
        error instanceof HiringError
          ? error.message
          : status === 413
            ? "File exceeds the 10 MB limit"
            : "The request could not be completed",
      requestId: res.locals.requestId,
    });
  };
  router.use(errors);
  return router;
}
