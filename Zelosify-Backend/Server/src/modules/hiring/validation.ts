import Ajv, { type Schema } from "ajv";
import { fail, MAX_FILE_SIZE, PDF, PPTX } from "./domain.js";
const ajv = new Ajv({ allErrors: true, strict: true });
export function validator<T>(schema: Schema) {
  const validate = ajv.compile<T>(schema);
  return (value: unknown): T => {
    if (!validate(value))
      return fail(
        400,
        "INVALID_INPUT",
        "Input does not match the required schema",
      );
    return value as T;
  };
}
export const text = { type: "string", maxLength: 200 };
export const strings = { type: "array", items: text, maxItems: 100 };
export const unit = { type: "number", minimum: 0, maximum: 1 };
export const featuresSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "experienceYears",
    "skills",
    "normalizedSkills",
    "location",
    "education",
    "keywords",
  ],
  properties: {
    experienceYears: { type: "number", minimum: 0, maximum: 80 },
    skills: strings,
    normalizedSkills: strings,
    location: text,
    education: strings,
    keywords: strings,
  },
};
export const matchSchema = {
  type: "object",
  additionalProperties: false,
  required: ["skillMatchScore", "experienceMatchScore", "locationMatchScore"],
  properties: {
    skillMatchScore: unit,
    experienceMatchScore: unit,
    locationMatchScore: unit,
  },
};
export const scoreSchema = {
  ...matchSchema,
  required: [...matchSchema.required, "finalScore"],
  properties: { ...matchSchema.properties, finalScore: unit },
};
export const recommendationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recommended", "score", "confidence", "reason"],
  properties: {
    recommended: { type: "boolean" },
    score: unit,
    confidence: unit,
    reason: { type: "string", minLength: 10, maxLength: 1500 },
  },
};
export type FileInput = { fileName: string; size: number; contentType: string };
export const validateFiles = validator<{ files: FileInput[] }>({
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fileName", "size", "contentType"],
        properties: {
          fileName: {
            type: "string",
            minLength: 1,
            maxLength: 160,
            pattern: "^[^/\\\\\\u0000-\\u001f]+\\.(pdf|pptx)$",
          },
          size: { type: "integer", minimum: 1, maximum: MAX_FILE_SIZE },
          contentType: { enum: [PDF, PPTX] },
        },
      },
    },
  },
});
export const validateSubmission = validator<{ uploadIds: string[] }>({
  type: "object",
  additionalProperties: false,
  required: ["uploadIds"],
  properties: {
    uploadIds: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      uniqueItems: true,
      items: { type: "string", pattern: "^[a-f0-9-]{36}$" },
    },
  },
});
export function pagination(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    return fail(
      400,
      "INVALID_PAGINATION",
      "Use a positive page and a page size between 1 and 100",
    );
  }
  return { page, pageSize, skip: (page - 1) * pageSize };
}
export function profileId(value: unknown) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1)
    return fail(400, "INVALID_ID", "Invalid profile ID");
  return id;
}
