import "dotenv/config";
import prisma from "../config/prisma/prisma.js";
import { log } from "../modules/hiring/logger.js";
const tenantId = "b0000000-0000-4000-8000-000000000001";
const roles = [
  [
    "Senior Backend Engineer",
    ["nodejs", "typescript", "postgresql"],
    5,
    9,
    "Remote",
    "12 months",
  ],
  [
    "Frontend Engineer",
    ["react", "typescript", "css"],
    3,
    6,
    "Bengaluru",
    "6 months",
  ],
  [
    "Platform Engineer",
    ["kubernetes", "docker", "aws"],
    4,
    8,
    "Remote",
    "12 months",
  ],
  ["Data Engineer", ["python", "sql", "spark"], 3, 7, "Hyderabad", "9 months"],
  [
    "QA Automation Engineer",
    ["playwright", "typescript", "selenium"],
    2,
    5,
    "Pune",
    "6 months",
  ],
  [
    "Java Engineer",
    ["java", "spring", "postgresql"],
    4,
    8,
    "Mumbai",
    "12 months",
  ],
  [
    "Mobile Engineer",
    ["react native", "typescript", "android"],
    3,
    6,
    "Remote",
    "6 months",
  ],
  ["Security Engineer", ["owasp", "python", "aws"], 5, 10, "Delhi", "9 months"],
  [
    "Machine Learning Engineer",
    ["python", "pytorch", "sql"],
    4,
    7,
    "Remote",
    "12 months",
  ],
  [
    "Cloud Architect",
    ["aws", "terraform", "kubernetes"],
    8,
    14,
    "Bengaluru",
    "18 months",
  ],
  [
    "Product Designer",
    ["figma", "prototyping", "accessibility"],
    2,
    6,
    "Remote",
    "3 months",
  ],
  [
    "Site Reliability Engineer",
    ["linux", "prometheus", "kubernetes"],
    5,
    9,
    "Chennai",
    "12 months",
  ],
] as const;
try {
  await prisma.$transaction(async (tx) => {
    await tx.tenants.upsert({
      where: { tenantId },
      create: { tenantId, companyName: "Bruce Wayne Corp" },
      update: { companyName: "Bruce Wayne Corp" },
    });
    const requestedId = process.env.HIRING_SEED_MANAGER_ID;
    const manager = requestedId
      ? await tx.user.findFirst({
          where: { id: requestedId, tenantId, role: "HIRING_MANAGER" },
        })
      : await tx.user.upsert({
          where: {
            email_provider: {
              email: "hiring.manager@brucewayne.example",
              provider: "KEYCLOAK",
            },
          },
          create: {
            email: "hiring.manager@brucewayne.example",
            username: "bruce-hiring-manager",
            firstName: "Bruce",
            lastName: "Wayne",
            tenantId,
            role: "HIRING_MANAGER",
          },
          update: {},
        });
    if (
      !manager ||
      manager.tenantId !== tenantId ||
      manager.role !== "HIRING_MANAGER"
    )
      throw new Error(
        "Seed manager must belong to Bruce Wayne Corp and have HIRING_MANAGER role",
      );
    for (const [
      index,
      [
        title,
        requiredSkills,
        experienceMin,
        experienceMax,
        location,
        contractType,
      ],
    ] of roles.entries()) {
      const id = `b0000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`;
      const data = {
        tenantId,
        title,
        requiredSkills: [...requiredSkills],
        experienceMin,
        experienceMax,
        location,
        contractType,
        hiringManagerId: manager.id,
        description: `Join Bruce Wayne Corp as a ${title}. Deliver reliable, maintainable solutions with ${requiredSkills.join(", ")}. Work with an experienced team on well-defined contract outcomes.`,
        expectedCompletionDate: new Date("2027-06-30T00:00:00Z"),
      };
      await tx.opening.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }
  });
  log("hiring.seed_completed", { tenantId, openings: roles.length });
} finally {
  await prisma.$disconnect();
}
