import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HiringRepository } from "./repository.js";
import { RecommendationAgent } from "./agent/orchestrator.js";
import type { ProfileStorage } from "./storage.js";
import { parseDocument } from "./parser.js";
import { VERSION } from "./domain.js";
import { log } from "./logger.js";
export class RecommendationService {
  private providerReadyAt = 0;
  constructor(
    private repository: HiringRepository,
    private storage: ProfileStorage,
    private agent: RecommendationAgent,
  ) {}
  async processOne() {
    // Provider throttling is queue time, not document processing time. All worker
    // consumers in this process share this cooldown to avoid exhausting jobs.
    if (Date.now() < this.providerReadyAt) return false;
    const now = new Date();
    const leaseToken = randomUUID();
    const job = await this.repository.transaction(async (tx) => {
      const candidate = await tx.recommendationJob.findFirst({
        where: {
          profile: { isDeleted: false },
          OR: [
            { state: "PENDING", availableAt: { lte: now } },
            { state: "PROCESSING", lockedUntil: { lt: now } },
          ],
        },
        orderBy: { availableAt: "asc" },
      });
      if (!candidate) return null;
      if (candidate.attempts >= 3) {
        await tx.recommendationJob.update({
          where: { id: candidate.id },
          data: {
            state: "FAILED",
            errorCode: "ATTEMPTS_EXHAUSTED",
            lockedUntil: null,
            leaseToken: null,
          },
        });
        await tx.hiringProfile.update({
          where: { id: candidate.profileId },
          data: { recommendationStatus: "FAILED" },
        });
        return null;
      }
      const claim = await tx.recommendationJob.updateMany({
        where: {
          id: candidate.id,
          state: candidate.state,
          leaseToken: candidate.leaseToken,
        },
        data: {
          state: "PROCESSING",
          leaseToken,
          lockedUntil: new Date(Date.now() + 10000),
          attempts: { increment: 1 },
        },
      });
      if (!claim.count) return null;
      await tx.hiringProfile.update({
        where: { id: candidate.profileId },
        data: { recommendationStatus: "PROCESSING" },
      });
      return { ...candidate, attempts: candidate.attempts + 1 };
    });
    if (!job) return false;
    const started = performance.now();
    const signal = AbortSignal.timeout(1500);
    log("recommendation.started", {
      profileId: job.profileId,
      attempt: job.attempts,
      startTime: new Date().toISOString(),
      queueDelayMs: Date.now() - job.createdAt.getTime(),
    });
    try {
      const profile = await this.repository.db.hiringProfile.findFirst({
        where: { id: job.profileId, isDeleted: false },
        include: { opening: true },
      });
      if (!profile) throw new Error("PROFILE_DELETED");
      const opening = profile.opening;
      const result = await this.agent.run(
        {
          title: opening.title,
          requiredSkills: opening.requiredSkills,
          experienceMin: opening.experienceMin,
          experienceMax: opening.experienceMax,
          location: opening.location,
        },
        async (abort) =>
          parseDocument(
            await this.storage.get(
              {
                documentKey: profile.documentKey,
                tenantId: opening.tenantId,
                uploadedBy: profile.uploadedBy,
              },
              abort,
            ),
            profile.contentType,
            abort,
          ),
        signal,
      );
      signal.throwIfAborted();
      const published = await this.repository.transaction(async (tx) => {
        signal.throwIfAborted();
        const owned = await tx.recommendationJob.updateMany({
          where: {
            id: job.id,
            leaseToken,
            state: "PROCESSING",
            lockedUntil: { gt: new Date() },
            profile: { isDeleted: false },
          },
          data: {
            state: "COMPLETED",
            lockedUntil: null,
            leaseToken: null,
            errorCode: null,
          },
        });
        if (!owned.count) return;
        const latencyMs = Math.round(performance.now() - started);
        if (latencyMs >= 1500) throw new Error("PROCESSING_DEADLINE");
        await tx.hiringProfile.update({
          where: { id: job.profileId },
          data: {
            recommended: result.recommended,
            recommendationScore: result.score,
            recommendationConfidence: result.confidence,
            recommendationReason: result.reason,
            recommendationLatencyMs: latencyMs,
            recommendationVersion: VERSION,
            recommendationMetadata: result.metadata as Prisma.InputJsonValue,
            recommendedAt: new Date(),
            recommendationStatus: "COMPLETED",
          },
        });
        return latencyMs;
      });
      if (published !== undefined)
        log("recommendation.completed", {
          profileId: job.profileId,
          latencyMs: published,
          finalScore: result.score,
          tokens: result.metadata.tokens,
        });
    } catch (error) {
      const code = signal.aborted
        ? "PROCESSING_DEADLINE"
        : error instanceof Error && /^[A-Z_]+$/.test(error.message)
          ? error.message
          : "PROCESSING_FAILED";
      const rateLimited = code === "PROVIDER_RATE_LIMITED";
      const retry =
        (rateLimited || job.attempts < 3) &&
        !["PROFILE_DELETED", "DOCUMENT_PARSE_FAILED"].includes(code);
      const latencyMs = Math.round(performance.now() - started);
      const retryDelay = rateLimited
        ? Math.max(1000, Number((error as { retryAfterMs?: number })?.retryAfterMs) || 60000)
        : 1000 * 2 ** job.attempts;
      if (rateLimited) this.providerReadyAt = Math.max(this.providerReadyAt, Date.now() + retryDelay);
      await this.repository.transaction(async (tx) => {
        const owned = await tx.recommendationJob.updateMany({
          where: { id: job.id, leaseToken, state: "PROCESSING" },
          data: {
            state: retry ? "PENDING" : "FAILED",
            lockedUntil: null,
            leaseToken: null,
            errorCode: code,
            availableAt: new Date(Date.now() + retryDelay),
            ...(rateLimited ? { attempts: { decrement: 1 } } : {}),
          },
        });
        if (!owned.count) return;
        await tx.hiringProfile.updateMany({
          where: { id: job.profileId, isDeleted: false },
          data: {
            recommendationStatus: retry ? "PENDING" : "FAILED",
            recommendationLatencyMs: latencyMs,
            recommendationMetadata: {
              errorCode: code,
              attempt: job.attempts,
              ...((error as { metadata?: object })?.metadata ?? {}),
            } as Prisma.InputJsonValue,
            recommendationVersion: VERSION,
          },
        });
      });
      log("recommendation.failed", {
        profileId: job.profileId,
        code,
        latencyMs,
        attempt: job.attempts,
      });
    }
    return true;
  }
}
