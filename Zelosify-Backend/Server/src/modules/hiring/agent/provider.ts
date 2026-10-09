import { fail } from "../domain.js";
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};
export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: object };
};
export type Completion = { message: Message; tokens: number };
export interface LlmProvider {
  complete(
    messages: Message[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<Completion>;
}
export class GroqProvider implements LlmProvider {
  async complete(
    messages: Message[],
    tools: ToolDefinition[],
    signal: AbortSignal,
  ): Promise<Completion> {
    const key =
      process.env.GROQ_API_KEY ||
      fail(
        503,
        "LLM_UNCONFIGURED",
        "Recommendation provider is not configured",
      );
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0,
          max_completion_tokens: 1200,
          parallel_tool_calls: true,
        }),
      },
    );
    if (response.status === 400) {
      const failure = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      if (
        ["tool_use_failed", "json_validate_failed"].includes(
          failure?.error?.code ?? "",
        )
      )
        throw new Error("MALFORMED_LLM_RESPONSE");
    }
    if (!response.ok)
      throw new Error(
        response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_FAILED",
      );
    const result = (await response.json()) as {
      choices?: { message?: Message }[];
      usage?: { total_tokens?: number };
    };
    const message = result.choices?.[0]?.message;
    if (
      !message ||
      message.role !== "assistant" ||
      (!message.tool_calls && typeof message.content !== "string")
    )
      throw new Error("MALFORMED_LLM_RESPONSE");
    if (
      message.tool_calls &&
      (!Array.isArray(message.tool_calls) ||
        message.tool_calls.length > 5 ||
        message.tool_calls.some(
          (call) =>
            typeof call.id !== "string" ||
            call.id.length > 200 ||
            call.type !== "function" ||
            typeof call.function?.name !== "string" ||
            typeof call.function?.arguments !== "string" ||
            call.function.arguments.length > 20000,
        ))
    )
      throw new Error("MALFORMED_LLM_RESPONSE");
    return {
      message: {
        role: "assistant",
        content: message.content ?? null,
        ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
      },
      tokens: Math.max(0, Number(result.usage?.total_tokens) || 0),
    };
  }
}
