import "dotenv/config";
import prisma from "../../config/prisma/prisma.js";
import { HiringRepository } from "./repository.js";
import { PostgresProfileStorage } from "./storage.js";
import { RecommendationAgent } from "./agent/orchestrator.js";
import { GroqProvider } from "./agent/provider.js";
import { RecommendationService } from "./recommendation-service.js";
import { log } from "./logger.js";
import { setTimeout } from "node:timers/promises";
if (!process.env.LLM_API_KEY?.trim() && !process.env.GROQ_API_KEY?.trim())
  throw new Error("LLM_API_KEY is required to run the recommendation worker");
const concurrency = Number(process.env.HIRING_WORKER_CONCURRENCY ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
  throw new Error("HIRING_WORKER_CONCURRENCY must be between 1 and 16");
const service = new RecommendationService(
  new HiringRepository(prisma),
  new PostgresProfileStorage(prisma),
  new RecommendationAgent(new GroqProvider()),
);
let stopping = false;
process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});
async function consume() {
  while (!stopping) {
    try {
      if (!(await service.processOne())) await setTimeout(250);
    } catch {
      log("recommendation.worker_error");
      await setTimeout(1000);
    }
  }
}
log("recommendation.worker_started", { concurrency });
await Promise.all(Array.from({ length: concurrency }, consume));
await prisma.$disconnect();
log("recommendation.worker_stopped");
