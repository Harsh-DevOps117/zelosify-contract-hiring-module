import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "../../src/modules/hiring/agent/provider.js";
const completion = {
  choices: [{ message: { role: "assistant", content: "{}" } }],
  usage: { total_tokens: 7 },
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Groq server configuration", () => {
  it("uses LLM_API_KEY in preference to the legacy setting", async () => {
    vi.stubEnv("LLM_API_KEY", " test-primary-key ");
    vi.stubEnv("GROQ_MODEL", "");
    vi.stubEnv("GROQ_API_KEY", "test-legacy-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(completion)));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GroqProvider().complete(
      [{ role: "user", content: "test" }],
      [],
      AbortSignal.timeout(1000),
    );
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-primary-key",
    );
    expect(result.tokens).toBe(7);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "qwen/qwen3.8-27b",
    );
  });
  it("accepts the legacy setting when the primary setting is empty", async () => {
    vi.stubEnv("LLM_API_KEY", "   ");
    vi.stubEnv("GROQ_API_KEY", "test-legacy-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(completion)));
    vi.stubGlobal("fetch", fetchMock);
    await new GroqProvider().complete([], [], AbortSignal.timeout(1000));
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer test-legacy-key",
    );
  });
  it("fails before any network call when the key is absent", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      new GroqProvider().complete([], [], AbortSignal.timeout(1000)),
    ).rejects.toMatchObject({ code: "LLM_UNCONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [401, "PROVIDER_AUTH_FAILED"],
    [403, "PROVIDER_AUTH_FAILED"],
    [404, "PROVIDER_MODEL_UNAVAILABLE"],
    [429, "PROVIDER_RATE_LIMITED"],
    [500, "PROVIDER_FAILED"],
  ])(
    "classifies HTTP %i without exposing provider response content",
    async (status, code) => {
      vi.stubEnv("LLM_API_KEY", "test-primary-key");
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response("private provider detail", { status }),
          ),
      );
      await expect(
        new GroqProvider().complete([], [], AbortSignal.timeout(1000)),
      ).rejects.toThrow(code);
    },
  );
  it("uses a configured model for the provider request", async () => {
    vi.stubEnv("LLM_API_KEY", "test-primary-key");
    vi.stubEnv("GROQ_MODEL", " custom-model ");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(completion)));
    vi.stubGlobal("fetch", fetchMock);
    await new GroqProvider().complete([], [], AbortSignal.timeout(1000));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe(
      "custom-model",
    );
  });
  it("loads the legacy storage controller without AWS configuration", async () => {
    for (const key of [
      "S3_BUCKET_NAME",
      "S3_AWS_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ])
      vi.stubEnv(key, "");
    const controller =
      await import("../../src/controllers/storage/storageController.js");
    expect(typeof controller.listOfObjects).toBe("function");
  });
  it("uses JSON output after tools finish and honors the configured API base", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubEnv("LLM_BASE_URL", "https://api.groq.com/openai/v1/");
    vi.stubEnv("GROQ_MODEL", "qwen/qwen3.8-27b");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(completion)));
    vi.stubGlobal("fetch", fetchMock);
    await new GroqProvider().complete([], [], AbortSignal.timeout(1000));
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toEqual({type:"json_object"});
    expect(body).not.toHaveProperty("tools");
    expect(body.reasoning_effort).toBe("none");
  });
  it("preserves a provider retry delay without leaking response content", async () => {
    vi.stubEnv("LLM_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private quota details", {
      status:429, headers:{"Retry-After":"12"},
    })));
    await expect(new GroqProvider().complete([], [], AbortSignal.timeout(1000))).rejects.toMatchObject({
      message:"PROVIDER_RATE_LIMITED", retryAfterMs:12000,
    });
  });

});
