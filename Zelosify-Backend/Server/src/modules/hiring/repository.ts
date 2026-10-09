import { Prisma, type PrismaClient } from "@prisma/client";
import { type Actor, openingScope, profileScope, fail } from "./domain.js";
export const vendorProfileSelect = {
  id: true,
  openingId: true,
  fileName: true,
  contentType: true,
  size: true,
  submittedAt: true,
  status: true,
} satisfies Prisma.hiringProfileSelect;
export const managerProfileSelect = {
  ...vendorProfileSelect,
  recommended: true,
  recommendationScore: true,
  recommendationReason: true,
  recommendationConfidence: true,
  recommendationLatencyMs: true,
  recommendationVersion: true,
  recommendedAt: true,
  recommendationStatus: true,
} satisfies Prisma.hiringProfileSelect;
export class HiringRepository {
  constructor(readonly db: PrismaClient) {}
  async transaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(operation, {
          isolationLevel: "Serializable",
          timeout: 1500,
          maxWait: 300,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034" &&
          attempt < 2
        )
          continue;
        throw error;
      }
    }
  }
  async opening(
    actor: Actor,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const opening = await tx.opening.findFirst({
      where: { id, ...openingScope(actor) },
    });
    return opening ?? fail(404, "NOT_FOUND", "Opening not found");
  }
  async profile(
    actor: Actor,
    id: number,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const profile = await tx.hiringProfile.findFirst({
      where: { id, ...profileScope(actor) },
      include: { opening: true },
    });
    return profile ?? fail(404, "NOT_FOUND", "Profile not found");
  }
  async openings(
    actor: Actor,
    paging: { skip: number; pageSize: number; page: number },
  ) {
    const where = openingScope(actor);
    const [items, total] = await this.db.$transaction([
      this.db.opening.findMany({
        where,
        skip: paging.skip,
        take: paging.pageSize,
        orderBy: [{ postedDate: "desc" }, { id: "asc" }],
      }),
      this.db.opening.count({ where }),
    ]);
    const managers = await this.db.user.findMany({
      where: {
        tenantId: actor.tenantId,
        id: { in: items.map((item) => item.hiringManagerId) },
      },
      select: { id: true, firstName: true, lastName: true, username: true },
    });
    const names = new Map(
      managers.map((manager) => [
        manager.id,
        [manager.firstName, manager.lastName].filter(Boolean).join(" ") ||
          manager.username ||
          "Hiring manager",
      ]),
    );
    return {
      items: items.map((item) => ({
        ...item,
        hiringManagerName: names.get(item.hiringManagerId) ?? "Hiring manager",
      })),
      total,
      page: paging.page,
      pageSize: paging.pageSize,
    };
  }
  async profiles(
    actor: Actor,
    openingId: string,
    paging: { skip: number; pageSize: number; page: number },
  ) {
    await this.opening(actor, openingId);
    const where = { openingId, ...profileScope(actor) };
    const [items, total] = await this.db.$transaction([
      this.db.hiringProfile.findMany({
        where,
        select:
          actor.role === "IT_VENDOR"
            ? vendorProfileSelect
            : managerProfileSelect,
        orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
        skip: paging.skip,
        take: paging.pageSize,
      }),
      this.db.hiringProfile.count({ where }),
    ]);
    return { items, total, page: paging.page, pageSize: paging.pageSize };
  }
  async details(
    actor: Actor,
    id: string,
    paging: { skip: number; pageSize: number; page: number },
  ) {
    const opening = await this.opening(actor, id);
    const [manager, profiles] = await Promise.all([
      this.db.user.findFirst({
        where: { id: opening.hiringManagerId, tenantId: actor.tenantId },
        select: { firstName: true, lastName: true, username: true },
      }),
      this.profiles(actor, id, paging),
    ]);
    return {
      ...opening,
      hiringManagerName: manager
        ? [manager.firstName, manager.lastName].filter(Boolean).join(" ") ||
          manager.username
        : "Hiring manager",
      profilesCount: profiles.total,
      profiles,
    };
  }
}
