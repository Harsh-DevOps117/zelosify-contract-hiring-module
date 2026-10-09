import { expect, it } from "vitest";
import { RecommendationAgent } from "../../src/modules/hiring/agent/orchestrator.js";
import { GroqProvider } from "../../src/modules/hiring/agent/provider.js";
import { parseDocument } from "../../src/modules/hiring/parser.js";
import { PDF, PPTX } from "../../src/modules/hiring/domain.js";
import {
  ScriptedProvider,
  requirements,
  pdfFixture,
  pptxFixture,
} from "./fixtures.js";
it("processes 100 PDF/PPTX profiles and reports success, latency and queue delay", async () => {
  const live = process.env.HIRING_PERF_LIVE === "1";
  if (live && !process.env.GROQ_API_KEY)
    throw new Error(
      "GROQ_API_KEY is required for live performance verification",
    );
  const provider = live ? new GroqProvider() : new ScriptedProvider();
  const agent = new RecommendationAgent(provider);
  const started = performance.now();
  const latencies: number[] = [];
  const queueDelays: number[] = [];
  let next = 0;
  let failed = 0;
  const fixtures = [pdfFixture(), pptxFixture()];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < 100) {
        const index = next++;
        const begin = performance.now();
        queueDelays.push(begin - started);
        const signal = AbortSignal.timeout(1500);
        try {
          const result = await agent.run(
            requirements,
            (abort) =>
              parseDocument(fixtures[index % 2], index % 2 ? PPTX : PDF, abort),
            signal,
          );
          expect(result.score).toBe(1);
        } catch {
          failed++;
        }
        latencies.push(performance.now() - begin);
      }
    }),
  );
  latencies.sort((a, b) => a - b);
  queueDelays.sort((a, b) => a - b);
  const report = {
    mode: live ? "LIVE_GROQ" : "SCRIPTED_LLM_REAL_PARSERS",
    profiles: 100,
    concurrency: 4,
    successes: 100 - failed,
    failures: failed,
    processingP95Ms: Math.round(latencies[94]),
    maxProcessingMs: Math.round(latencies[99]),
    queueDelayP95Ms: Math.round(queueDelays[94]),
    totalMs: Math.round(performance.now() - started),
  };
  process.stdout.write(
    JSON.stringify({ event: "hiring.performance", ...report }) + "\n",
  );
  expect(failed).toBe(0);
  expect(report.processingP95Ms).toBeLessThan(2000);
  expect(report.maxProcessingMs).toBeLessThan(1500);
}, 180000);
