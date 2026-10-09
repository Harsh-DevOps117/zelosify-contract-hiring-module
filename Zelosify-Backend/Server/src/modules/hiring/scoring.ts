import type {
  OpeningRequirements,
  ResumeFeatures,
  Match,
  Score,
} from "./domain.js";
const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  "node.js": "nodejs",
  node: "nodejs",
  "react.js": "react",
  reactjs: "react",
  postgres: "postgresql",
  "amazon web services": "aws",
  k8s: "kubernetes",
  "c sharp": "c#",
  dotnet: ".net",
};
export function normalizeSkills(skills: string[]) {
  return [
    ...new Set(
      skills
        .map((skill) => skill.trim().toLowerCase())
        .filter(Boolean)
        .map((skill) => aliases[skill] ?? skill),
    ),
  ].sort();
}
export function experienceMatch(
  years: number,
  min: number,
  max: number | null,
) {
  return years < min ? 0 : max !== null && years > max ? 0.8 : 1;
}
export function matchFeatures(
  features: ResumeFeatures,
  opening: OpeningRequirements,
): Match {
  const required = normalizeSkills(opening.requiredSkills);
  const skills = new Set(normalizeSkills(features.normalizedSkills));
  const location = (opening.location ?? "").trim().toLowerCase();
  return {
    skillMatchScore: required.length
      ? required.filter((skill) => skills.has(skill)).length / required.length
      : 1,
    experienceMatchScore: experienceMatch(
      features.experienceYears,
      opening.experienceMin,
      opening.experienceMax,
    ),
    locationMatchScore:
      location === "remote" ||
      (location !== "" && location === features.location.trim().toLowerCase())
        ? 1
        : 0.5,
  };
}
export function scoreMatch(match: Match): Score {
  return {
    ...match,
    finalScore: Number(
      (
        0.5 * match.skillMatchScore +
        0.3 * match.experienceMatchScore +
        0.2 * match.locationMatchScore
      ).toFixed(6),
    ),
  };
}
export function decision(score: number) {
  return score >= 0.75
    ? "RECOMMENDED"
    : score >= 0.5
      ? "BORDERLINE"
      : "NOT_RECOMMENDED";
}
