export type HiringRole = "IT_VENDOR" | "HIRING_MANAGER";
export type Actor = { id: string; tenantId: string; role: HiringRole };
export type OpeningRequirements = {
  title: string;
  experienceMin: number;
  experienceMax: number | null;
  requiredSkills: string[];
  location: string | null;
};
export type ResumeFeatures = {
  experienceYears: number;
  skills: string[];
  normalizedSkills: string[];
  location: string;
  education: string[];
  keywords: string[];
};
export type Match = {
  skillMatchScore: number;
  experienceMatchScore: number;
  locationMatchScore: number;
};
export type Score = Match & { finalScore: number };
export type Recommendation = {
  recommended: boolean;
  score: number;
  confidence: number;
  reason: string;
};
export type Trace = { tool: string; latencyMs: number; success: boolean };
export class HiringError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, code: string, message: string): never => {
  throw new HiringError(status, code, message);
};
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const PDF = "application/pdf";
export const PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const VERSION = "hiring-agent-v1";
export function actorFromUser(
  user:
    | { id?: string; role?: string; tenant?: { tenantId?: string } | null }
    | undefined,
  role?: HiringRole,
): Actor {
  if (!user?.id) return fail(401, "UNAUTHENTICATED", "Authentication required");
  if (
    !user.tenant?.tenantId ||
    !["IT_VENDOR", "HIRING_MANAGER"].includes(user.role ?? "") ||
    (role && role !== user.role)
  ) {
    return fail(403, "FORBIDDEN", "This role cannot access the resource");
  }
  return {
    id: user.id,
    tenantId: user.tenant.tenantId,
    role: user.role as HiringRole,
  };
}
export function openingScope(actor: Actor) {
  return {
    tenantId: actor.tenantId,
    ...(actor.role === "HIRING_MANAGER" ? { hiringManagerId: actor.id } : {}),
  };
}
export function profileScope(actor: Actor) {
  return {
    isDeleted: false,
    opening: openingScope(actor),
    ...(actor.role === "IT_VENDOR" ? { uploadedBy: actor.id } : {}),
  };
}
