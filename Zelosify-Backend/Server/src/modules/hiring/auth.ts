import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import type { PrismaClient } from "@prisma/client";
import { actorFromUser, HiringError, type HiringRole } from "./domain.js";
export function hiringAuthentication(db: PrismaClient): RequestHandler {
  const issuer = `${(process.env.KEYCLOAK_URL ?? "http://localhost:8080/auth").replace(/\/$/, "")}/realms/${process.env.KEYCLOAK_REALM ?? "Zelosify"}`;
  const keys = jwksClient({
    jwksUri: `${issuer}/protocol/openid-connect/certs`,
    cache: true,
    rateLimit: true,
    timeout: 1000,
  });
  return async (req, res, next) => {
    try {
      const token =
        req.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1] ??
        req.cookies?.access_token;
      if (!token)
        throw new HiringError(
          401,
          "UNAUTHENTICATED",
          "Authentication required",
        );
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || decoded.header.alg !== "RS256" || !decoded.header.kid)
        throw new Error("INVALID_TOKEN");
      const key = await keys.getSigningKey(decoded.header.kid);
      const claims = jwt.verify(token, key.getPublicKey(), {
        algorithms: ["RS256"],
        issuer,
        ...(process.env.KEYCLOAK_AUDIENCE
          ? { audience: process.env.KEYCLOAK_AUDIENCE }
          : {}),
      }) as jwt.JwtPayload;
      if (
        !claims.sub ||
        !claims.exp ||
        claims.azp !== (process.env.KEYCLOAK_CLIENT_ID ?? "dynamic-client")
      )
        throw new Error("INVALID_TOKEN");
      const user = await db.user.findUnique({
        where: { externalId: claims.sub },
        select: {
          id: true,
          role: true,
          tenant: { select: { tenantId: true } },
        },
      });
      const actor = actorFromUser(user ?? undefined);
      if (
        !Array.isArray(claims.realm_access?.roles) ||
        !claims.realm_access.roles.includes(actor.role)
      )
        throw new HiringError(
          403,
          "FORBIDDEN",
          "Required role is missing from the identity token",
        );
      res.locals.actor = actor;
      next();
    } catch (error) {
      next(
        error instanceof HiringError
          ? error
          : new HiringError(
              401,
              "UNAUTHENTICATED",
              "Invalid or expired authentication",
            ),
      );
    }
  };
}
export function requireRole(role?: HiringRole): RequestHandler {
  return (_req, res, next) => {
    const actor = res.locals.actor;
    try {
      actorFromUser(
        actor
          ? {
              id: actor.id,
              role: actor.role,
              tenant: { tenantId: actor.tenantId },
            }
          : undefined,
        role,
      );
      next();
    } catch (error) {
      next(error);
    }
  };
}
export const protectOrigin: RequestHandler = (req, _res, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.headers.authorization
  )
    return next();
  if (
    req.headers.origin !== (process.env.FRONTEND_URL ?? "http://localhost:5173")
  )
    return next(
      new HiringError(403, "INVALID_ORIGIN", "Untrusted request origin"),
    );
  next();
};
