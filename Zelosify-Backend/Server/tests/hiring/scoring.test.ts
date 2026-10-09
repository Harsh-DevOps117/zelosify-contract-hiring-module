import { describe, expect, it } from "vitest";
import {
  decision,
  experienceMatch,
  matchFeatures,
  normalizeSkills,
  scoreMatch,
} from "../../src/modules/hiring/scoring.js";
import {
  actorFromUser,
  openingScope,
  profileScope,
} from "../../src/modules/hiring/domain.js";
import {
  pagination,
  validateFiles,
  validateSubmission,
} from "../../src/modules/hiring/validation.js";
import { features, requirements } from "./fixtures.js";
describe("deterministic policy", () => {
  it.each([
    [2.99, 0],
    [3, 1],
    [8, 1],
    [8.01, 0.8],
  ])("experience %s gives %s", (years, expected) =>
    expect(experienceMatch(years, 3, 8)).toBe(expected),
  );
  it("supports an unbounded upper range", () =>
    expect(experienceMatch(30, 3, null)).toBe(1));
  it("normalizes aliases and deduplicates skills", () =>
    expect(
      normalizeSkills([" JS ", "javascript", "Node.js", "node", "TS", ""]),
    ).toEqual(["javascript", "nodejs", "typescript"]));
  it("uses unique overlap divided by unique requirements", () => {
    expect(
      matchFeatures(
        { ...features, normalizedSkills: ["react", "react"] },
        { ...requirements, requiredSkills: ["React", "react", "TypeScript"] },
      ).skillMatchScore,
    ).toBe(0.5);
  });
  it("treats no skill requirements as fully matched", () =>
    expect(
      matchFeatures(features, { ...requirements, requiredSkills: [] })
        .skillMatchScore,
    ).toBe(1));
  it.each([
    ["Remote", "London", 1],
    [" Pune ", "pune", 1],
    ["Pune", "Mumbai", 0.5],
    [null, "", 0.5],
  ])("location %s and %s gives %s", (location, candidate, expected) =>
    expect(
      matchFeatures(
        { ...features, location: candidate as string },
        { ...requirements, location: location as string | null },
      ).locationMatchScore,
    ).toBe(expected),
  );
  it("applies the exact weighted formula", () =>
    expect(
      scoreMatch({
        skillMatchScore: 0.8,
        experienceMatchScore: 1,
        locationMatchScore: 0.5,
      }).finalScore,
    ).toBe(0.8));
  it.each([
    [0.499999, "NOT_RECOMMENDED"],
    [0.5, "BORDERLINE"],
    [0.749999, "BORDERLINE"],
    [0.75, "RECOMMENDED"],
  ])("threshold %s", (score, expected) =>
    expect(decision(score as number)).toBe(expected),
  );
});
describe("authorization and input boundaries", () => {
  it("rejects missing identity, role mismatch and missing tenant", () => {
    expect(() => actorFromUser(undefined)).toThrow("Authentication required");
    expect(() =>
      actorFromUser(
        { id: "u", role: "IT_VENDOR", tenant: { tenantId: "a" } },
        "HIRING_MANAGER",
      ),
    ).toThrow();
    expect(() => actorFromUser({ id: "u", role: "IT_VENDOR" })).toThrow();
    expect(() =>
      actorFromUser({ id: "u", role: "ADMIN", tenant: { tenantId: "a" } }),
    ).toThrow();
  });
  it("constructs tenant and ownership predicates", () => {
    expect(
      openingScope({ id: "m", tenantId: "a", role: "HIRING_MANAGER" }),
    ).toEqual({ tenantId: "a", hiringManagerId: "m" });
    expect(profileScope({ id: "v", tenantId: "a", role: "IT_VENDOR" })).toEqual(
      { isDeleted: false, opening: { tenantId: "a" }, uploadedBy: "v" },
    );
  });
  it.each([
    { page: "0" },
    { pageSize: "101" },
    { page: "1.1" },
    { pageSize: "NaN" },
  ])("rejects invalid pagination %j", (query) =>
    expect(() => pagination(query)).toThrow(),
  );
  it("rejects traversal, excess fields, duplicate uploads and unsupported file types", () => {
    expect(() =>
      validateFiles({
        files: [
          {
            fileName: "../resume.pdf",
            contentType: "application/pdf",
            size: 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateFiles({
        files: [
          { fileName: "resume.pdf", contentType: "application/pdf", size: 1 },
        ],
        tenantId: "attack",
      }),
    ).toThrow();
    expect(() =>
      validateFiles({
        files: [{ fileName: "resume.html", contentType: "text/html", size: 1 }],
      }),
    ).toThrow();
    expect(() =>
      validateSubmission({
        uploadIds: [
          "a0000000-0000-4000-8000-000000000001",
          "a0000000-0000-4000-8000-000000000001",
        ],
      }),
    ).toThrow();
  });
});
