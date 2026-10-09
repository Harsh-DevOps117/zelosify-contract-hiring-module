import { randomUUID, createHash } from "node:crypto";
import type { Actor } from "./domain.js";
import { fail, PDF, PPTX, profileScope, VERSION } from "./domain.js";
import {
  HiringRepository,
  vendorProfileSelect,
  managerProfileSelect,
} from "./repository.js";
import type { ProfileStorage } from "./storage.js";
import type { FileInput } from "./validation.js";
import { verifyFile } from "./parser.js";
import { uploadTicket, verifyUploadTicket } from "./upload-ticket.js";
export class HiringService {
  constructor(
    readonly repository: HiringRepository,
    private storage: ProfileStorage,
  ) {}
  private vendor(actor: Actor) {
    if (actor.role !== "IT_VENDOR")
      fail(403, "FORBIDDEN", "Vendor role required");
  }
  private manager(actor: Actor) {
    if (actor.role !== "HIRING_MANAGER")
      fail(403, "FORBIDDEN", "Hiring manager role required");
  }
  async reserve(actor: Actor, openingId: string, files: FileInput[]) {
    this.vendor(actor);
    return this.repository.transaction(async (tx) => {
      const opening = await this.repository.opening(actor, openingId, tx);
      if (opening.status !== "OPEN")
        return fail(
          409,
          "OPENING_CLOSED",
          "This opening is not accepting profiles",
        );
      const pending = await tx.profileUpload.count({
        where: {
          uploadedBy: actor.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (pending + files.length > 50)
        return fail(
          429,
          "UPLOAD_LIMIT",
          "Too many pending uploads; complete or wait for them to expire",
        );
      const uploads = [];
      for (const file of files) {
        if ((file.fileName.endsWith(".pdf") ? PDF : PPTX) !== file.contentType)
          return fail(
            400,
            "INVALID_FILE_TYPE",
            "Filename and file type must match",
          );
        const id = randomUUID();
        const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const reservation = await tx.profileUpload.create({
          data: {
            id,
            openingId,
            uploadedBy: actor.id,
            ...file,
            s3Key: `${actor.tenantId}/${openingId}/${Date.now()}_${id}_${safeName}`,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
          },
        });
        uploads.push({
          id,
          fileName: file.fileName,
          expiresAt: reservation.expiresAt,
          uploadPath: `/vendor/openings/${openingId}/profiles/uploads/${id}?ticket=${uploadTicket(reservation)}`,
          method: "PUT",
        });
      }
      return { uploads };
    });
  }
  async upload(
    actor: Actor,
    openingId: string,
    uploadId: string,
    bytes: Buffer,
    contentType: string,
    ticket: string,
  ) {
    this.vendor(actor);
    await this.repository.opening(actor, openingId);
    const reservation = await this.repository.db.profileUpload.findFirst({
      where: {
        id: uploadId,
        openingId,
        uploadedBy: actor.id,
        opening: { tenantId: actor.tenantId },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!reservation)
      return fail(404, "NOT_FOUND", "Upload reservation not found or expired");
    verifyUploadTicket(reservation, ticket);
    if (
      !Buffer.isBuffer(bytes) ||
      bytes.length !== reservation.size ||
      contentType !== reservation.contentType
    )
      return fail(
        422,
        "INVALID_FILE",
        "Uploaded bytes do not match the reservation",
      );
    verifyFile(bytes, contentType);
    if (!reservation.uploadedAt) {
      try {
        await this.storage.put(reservation.s3Key, bytes, contentType);
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode !== 412
        )
          throw error;
        const existing = await this.storage.get(reservation.s3Key);
        if (
          createHash("sha256").update(existing).digest("hex") !==
          createHash("sha256").update(bytes).digest("hex")
        )
          return fail(
            409,
            "UPLOAD_CONFLICT",
            "Upload reservation already contains another file",
          );
      }
      await this.repository.transaction(async (tx) => {
        const updated = await tx.profileUpload.updateMany({
          where: {
            id: uploadId,
            uploadedBy: actor.id,
            opening: { tenantId: actor.tenantId },
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { uploadedAt: new Date() },
        });
        if (!updated.count)
          return fail(
            409,
            "UPLOAD_EXPIRED",
            "Upload expired before completion",
          );
      });
    }
    return { id: uploadId, uploaded: true };
  }
  async submit(actor: Actor, openingId: string, uploadIds: string[]) {
    this.vendor(actor);
    return this.repository.transaction(async (tx) => {
      const opening = await this.repository.opening(actor, openingId, tx);
      const uploads = await tx.profileUpload.findMany({
        where: {
          id: { in: uploadIds },
          openingId,
          uploadedBy: actor.id,
          opening: { tenantId: actor.tenantId },
        },
      });
      if (uploads.length !== uploadIds.length)
        return fail(404, "NOT_FOUND", "Upload reservation not found");
      if (uploads.every((upload) => upload.consumedAt)) {
        return {
          items: await tx.hiringProfile.findMany({
            where: {
              s3Key: { in: uploads.map((upload) => upload.s3Key) },
              ...profileScope(actor),
            },
            select: vendorProfileSelect,
          }),
        };
      }
      if (opening.status !== "OPEN")
        return fail(
          409,
          "OPENING_CLOSED",
          "This opening is not accepting profiles",
        );
      if (
        uploads.some(
          (upload) =>
            upload.consumedAt ||
            !upload.uploadedAt ||
            upload.expiresAt <= new Date(),
        )
      )
        return fail(
          409,
          "UPLOAD_INCOMPLETE",
          "Upload all files before submitting an unexpired batch",
        );
      const items = [];
      for (const upload of uploads) {
        const profile = await tx.hiringProfile.create({
          data: {
            openingId,
            uploadedBy: actor.id,
            s3Key: upload.s3Key,
            fileName: upload.fileName,
            size: upload.size,
            contentType: upload.contentType,
            job: { create: {} },
          },
          select: vendorProfileSelect,
        });
        items.push(profile);
      }
      await tx.profileUpload.updateMany({
        where: { id: { in: uploadIds }, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return { items };
    });
  }
  async remove(actor: Actor, id: number) {
    this.vendor(actor);
    await this.repository.transaction(async (tx) => {
      await this.repository.profile(actor, id, tx);
      await tx.hiringProfile.updateMany({
        where: { id, ...profileScope(actor) },
        data: { isDeleted: true },
      });
      await tx.recommendationJob.updateMany({
        where: { profileId: id },
        data: {
          state: "FAILED",
          errorCode: "PROFILE_DELETED",
          leaseToken: null,
          lockedUntil: null,
        },
      });
    });
  }
  async decide(actor: Actor, id: number, status: "SHORTLISTED" | "REJECTED") {
    this.manager(actor);
    return this.repository.transaction(async (tx) => {
      const profile = await this.repository.profile(actor, id, tx);
      if (profile.status === status)
        return tx.hiringProfile.findUnique({
          where: { id },
          select: managerProfileSelect,
        });
      const now = new Date();
      await tx.hiringProfile.updateMany({
        where: { id, ...profileScope(actor) },
        data: {
          status,
          shortlistedBy: status === "SHORTLISTED" ? actor.id : null,
          shortlistedAt: status === "SHORTLISTED" ? now : null,
          rejectedBy: status === "REJECTED" ? actor.id : null,
          rejectedAt: status === "REJECTED" ? now : null,
        },
      });
      await tx.opening.update({
        where: { id: profile.openingId },
        data: { actionDate: now },
      });
      return tx.hiringProfile.findUnique({
        where: { id },
        select: managerProfileSelect,
      });
    });
  }
  async retry(actor: Actor, id: number) {
    this.manager(actor);
    return this.repository.transaction(async (tx) => {
      const profile = await this.repository.profile(actor, id, tx);
      if (
        profile.recommendationStatus === "COMPLETED" &&
        profile.recommendationVersion === VERSION
      )
        return { queued: false, status: "COMPLETED" };
      if (["PENDING", "PROCESSING"].includes(profile.recommendationStatus))
        return { queued: false, status: profile.recommendationStatus };
      await tx.recommendationJob.upsert({
        where: { profileId: id },
        create: { profileId: id },
        update: {
          state: "PENDING",
          attempts: 0,
          availableAt: new Date(),
          lockedUntil: null,
          leaseToken: null,
          errorCode: null,
        },
      });
      await tx.hiringProfile.update({
        where: { id },
        data: { recommendationStatus: "PENDING" },
      });
      return { queued: true, status: "PENDING" };
    });
  }
  async file(actor: Actor, id: number) {
    const profile = await this.repository.profile(actor, id);
    const bytes = await this.storage.get(profile.s3Key);
    return {
      bytes,
      fileName: profile.fileName,
      contentType: profile.contentType,
    };
  }
}
