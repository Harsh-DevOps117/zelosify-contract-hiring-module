import type { RequestHandler } from "express";
import { type Actor, PDF } from "./domain.js";
import {
  pagination,
  profileId,
  validateFiles,
  validateSubmission,
} from "./validation.js";
import type { HiringService } from "./service.js";
const endpoint =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
export function hiringController(service: HiringService) {
  return {
    session: endpoint((_req, res) => {
      res.json(res.locals.actor);
    }),
    openings: endpoint(async (req, res) => {
      res.json(
        await service.repository.openings(
          res.locals.actor,
          pagination(req.query),
        ),
      );
    }),
    details: endpoint(async (req, res) => {
      res.json(
        await service.repository.details(
          res.locals.actor,
          String(req.params.id),
          pagination(req.query),
        ),
      );
    }),
    profiles: endpoint(async (req, res) => {
      res.json(
        await service.repository.profiles(
          res.locals.actor,
          String(req.params.id),
          pagination(req.query),
        ),
      );
    }),
    reserve: endpoint(async (req, res) => {
      res
        .status(201)
        .json(
          await service.reserve(
            res.locals.actor,
            String(req.params.id),
            validateFiles(req.body).files,
          ),
        );
    }),
    upload: endpoint(async (req, res) => {
      res.json(
        await service.upload(
          res.locals.actor,
          String(req.params.id),
          String(req.params.uploadId),
          req.body,
          req.headers["content-type"]?.split(";")[0] ?? "",
          String(req.query.ticket ?? ""),
        ),
      );
    }),
    submit: endpoint(async (req, res) => {
      res
        .status(202)
        .json(
          await service.submit(
            res.locals.actor,
            String(req.params.id),
            validateSubmission(req.body).uploadIds,
          ),
        );
    }),
    remove: endpoint(async (req, res) => {
      await service.remove(res.locals.actor, profileId(req.params.id));
      res.status(204).end();
    }),
    shortlist: endpoint(async (req, res) => {
      res.json(
        await service.decide(
          res.locals.actor,
          profileId(req.params.id),
          "SHORTLISTED",
        ),
      );
    }),
    reject: endpoint(async (req, res) => {
      res.json(
        await service.decide(
          res.locals.actor,
          profileId(req.params.id),
          "REJECTED",
        ),
      );
    }),
    retry: endpoint(async (req, res) => {
      res
        .status(202)
        .json(await service.retry(res.locals.actor, profileId(req.params.id)));
    }),
    file: endpoint(async (req, res) => {
      const file = await service.file(
        res.locals.actor as Actor,
        profileId(req.params.id),
      );
      res
        .set({
          "Content-Type": file.contentType,
          "Content-Length": String(file.bytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
          "Content-Disposition": `${file.contentType === PDF ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName).replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
        })
        .send(file.bytes);
    }),
  };
}
