import { describe, expect, it, vi } from "vitest";
import { FR6_CASES } from "./fr6-language-fixtures";
import {
  FR6_CANDIDATES,
  runProviderCase,
  type Fr6Candidate,
  type Fr6Provider,
} from "./fr6-language-providers";

const structuredCase = FR6_CASES.find(
  (fixture) => fixture.category === "structured-retrospective",
)!;

const validStructuredOutput = JSON.stringify({
  reflections: [
    {
      dimension: "Threshold",
      hypothesis: "The supplied threshold execution hypothesis.",
      observation: "The supplied outcome was validated.",
      root_cause: "The planned progression was tolerable.",
      adjusted_strategy: "Keep the progression conservative.",
    },
  ],
});

function candidate(provider: Fr6Provider): Fr6Candidate {
  return FR6_CANDIDATES.find((item) => item.provider === provider)!;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Unauthorized secret-body",
    headers: { "content-type": "application/json" },
  });
}

describe("FR6_CANDIDATES", () => {
  it("pins the approved candidate order and dated experiment prices", () => {
    expect(FR6_CANDIDATES).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        pricing: {
          inputPerMillion: 3,
          cachedInputPerMillion: 0.3,
          cacheWritePerMillion: 3.75,
          outputPerMillion: 15,
        },
      }),
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-haiku-4-5",
        pricing: {
          inputPerMillion: 1,
          cachedInputPerMillion: 0.1,
          cacheWritePerMillion: 1.25,
          outputPerMillion: 5,
        },
      }),
      expect.objectContaining({
        provider: "openai",
        model: "gpt-5.6-luna",
        pricing: {
          inputPerMillion: 0.2,
          cachedInputPerMillion: 0.02,
          cacheWritePerMillion: 0.25,
          outputPerMillion: 1.2,
        },
      }),
      expect.objectContaining({
        provider: "google",
        model: "gemini-3.1-flash-lite",
        pricing: {
          inputPerMillion: 0.25,
          cachedInputPerMillion: 0.025,
          cacheWritePerMillion: 0.25,
          outputPerMillion: 1.5,
        },
      }),
      expect.objectContaining({
        provider: "mistral",
        model: "mistral-small-2603",
        pricing: {
          inputPerMillion: 0.15,
          cachedInputPerMillion: 0.015,
          cacheWritePerMillion: 0.15,
          outputPerMillion: 0.6,
        },
      }),
    ]);
  });
});

describe("runProviderCase credentials", () => {
  it.each([
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
    ["google", "GEMINI_API_KEY"],
    ["mistral", "MISTRAL_API_KEY"],
  ] as const)(
    "records missing %s credentials without making a request",
    async (provider, credential) => {
      const fetch = vi.fn();
      const createAnthropicClient = vi.fn();
      const result = await runProviderCase(candidate(provider), FR6_CASES[0], {
        env: {},
        fetch,
        now: () => 100,
        createAnthropicClient,
      });

      expect(result.status).toBe("missing-credential");
      expect(result.output).toContain(credential);
      expect(result.retries).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
      expect(createAnthropicClient).not.toHaveBeenCalled();
    },
  );
});

describe("runProviderCase Anthropic", () => {
  it("forces the structured tool and normalizes the successful response", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_reflections", input: JSON.parse(validStructuredOutput) }],
      stop_reason: "tool_use",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
        output_tokens: 22,
        output_tokens_details: { thinking_tokens: 2 },
      },
    });
    const createAnthropicClient = vi.fn(() => ({ messages: { create } }));

    const result = await runProviderCase(candidate("anthropic"), structuredCase, {
      env: { ANTHROPIC_API_KEY: "anthropic-test-key" },
      fetch: vi.fn(),
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25),
      createAnthropicClient,
    });

    expect(createAnthropicClient).toHaveBeenCalledWith({
      apiKey: "anthropic-test-key",
      maxRetries: 0,
      timeout: 240_000,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-6",
        max_tokens: structuredCase.maxOutputTokens,
        service_tier: "standard_only",
        messages: [{ role: "user", content: structuredCase.prompt }],
        tool_choice: { type: "tool", name: "submit_reflections" },
      }),
    );
    expect(result).toMatchObject({
      status: "ok",
      parsed: JSON.parse(validStructuredOutput),
      usage: {
        inputTokens: 100,
        cachedInputTokens: 10,
        cacheWriteTokens: 5,
        outputTokens: 20,
        reasoningTokens: 2,
        totalTokens: 137,
      },
      latencyMs: 15,
      finishReason: "tool_use",
      retries: 0,
      schemaValid: true,
    });
  });

  it("records malformed structured output without retrying", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "tool_use", name: "submit_reflections", input: { reflections: [] } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 4, output_tokens: 3 },
    });

    const result = await runProviderCase(candidate("anthropic"), structuredCase, {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetch: vi.fn(),
      now: () => 1,
      createAnthropicClient: () => ({ messages: { create } }),
    });

    expect(result.status).toBe("schema-invalid");
    expect(result.schemaValid).toBe(false);
    expect(result.usage.totalTokens).toBe(7);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.retries).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sanitizes SDK failures without retrying", async () => {
    const create = vi.fn().mockRejectedValue(new Error("401 key=anthropic-test-key"));
    const result = await runProviderCase(candidate("anthropic"), FR6_CASES[0], {
      env: { ANTHROPIC_API_KEY: "anthropic-test-key" },
      fetch: vi.fn(),
      now: () => 1,
      createAnthropicClient: () => ({ messages: { create } }),
    });

    expect(result.status).toBe("request-failed");
    expect(result.output).toBe("Anthropic request failed.");
    expect(result.output).not.toContain("anthropic-test-key");
    expect(result.retries).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not accept a refusal text as a successful prose result", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "I cannot help with that." }],
      stop_reason: "refusal",
      usage: { input_tokens: 4, output_tokens: 5 },
    });
    const result = await runProviderCase(candidate("anthropic"), FR6_CASES[0], {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetch: vi.fn(),
      now: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(7),
      createAnthropicClient: () => ({ messages: { create } }),
    });

    expect(result).toMatchObject({
      status: "request-failed",
      finishReason: "refusal",
      latencyMs: 6,
      usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
    });
    expect(result.costUsd).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("preserves paid accounting when the response contains no output", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 6, output_tokens: 2 },
    });
    const result = await runProviderCase(candidate("anthropic"), FR6_CASES[0], {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetch: vi.fn(),
      now: vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(5),
      createAnthropicClient: () => ({ messages: { create } }),
    });

    expect(result).toMatchObject({
      status: "request-failed",
      output: "",
      finishReason: "end_turn",
      latencyMs: 3,
      usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
    });
    expect(result.costUsd).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("runProviderCase OpenAI", () => {
  it("uses Responses structured output and normalizes usage", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "completed",
        output_text: validStructuredOutput,
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 10, cache_write_tokens: 5 },
          output_tokens: 22,
          output_tokens_details: { reasoning_tokens: 2 },
          total_tokens: 122,
        },
      }),
    );

    const result = await runProviderCase(candidate("openai"), structuredCase, {
      env: { OPENAI_API_KEY: "openai-test-key" },
      fetch,
      now: vi.fn().mockReturnValueOnce(20).mockReturnValueOnce(30),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.headers).toMatchObject({ Authorization: "Bearer openai-test-key" });
    expect(JSON.parse(init.body)).toMatchObject({
      model: "gpt-5.6-luna",
      input: structuredCase.prompt,
      max_output_tokens: structuredCase.maxOutputTokens,
      store: false,
      service_tier: "default",
      text: { format: { type: "json_schema", name: "submit_reflections", strict: true } },
    });
    expect(result).toMatchObject({
      status: "ok",
      usage: {
        inputTokens: 85,
        cachedInputTokens: 10,
        cacheWriteTokens: 5,
        outputTokens: 20,
        reasoningTokens: 2,
        totalTokens: 122,
      },
      finishReason: "completed",
      latencyMs: 10,
      retries: 0,
      schemaValid: true,
    });
  });

  it("records malformed structured output without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "completed",
        output_text: "not json",
        usage: { input_tokens: 4, output_tokens: 3 },
      }),
    );
    const result = await runProviderCase(candidate("openai"), structuredCase, {
      env: { OPENAI_API_KEY: "test-key" },
      fetch,
      now: () => 1,
    });

    expect(result.status).toBe("schema-invalid");
    expect(result.usage.totalTokens).toBe(7);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.retries).toBe(0);
  });

  it("sanitizes HTTP errors without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ apiKey: "openai-test-key" }, 401));
    const result = await runProviderCase(candidate("openai"), FR6_CASES[0], {
      env: { OPENAI_API_KEY: "openai-test-key" },
      fetch,
      now: () => 1,
    });

    expect(result.status).toBe("request-failed");
    expect(result.output).toBe("OpenAI request failed (HTTP 401)." );
    expect(result.output).not.toContain("secret-body");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves paid accounting for failed and empty responses", async () => {
    for (const response of [
      { status: "failed", output_text: "Refused.", usage: { input_tokens: 8, output_tokens: 2 } },
      { status: "completed", output_text: "", usage: { input_tokens: 8, output_tokens: 2 } },
    ]) {
      const fetch = vi.fn().mockResolvedValue(jsonResponse(response));
      const result = await runProviderCase(candidate("openai"), FR6_CASES[0], {
        env: { OPENAI_API_KEY: "test-key" },
        fetch,
        now: vi.fn().mockReturnValueOnce(3).mockReturnValueOnce(8),
      });

      expect(result).toMatchObject({
        status: "request-failed",
        finishReason: response.status,
        latencyMs: 5,
        usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
      });
      expect(result.costUsd).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("runProviderCase Google", () => {
  it("uses generateContent JSON schema and normalizes usage", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: validStructuredOutput }] },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          cachedContentTokenCount: 10,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 2,
          totalTokenCount: 122,
        },
      }),
    );

    const result = await runProviderCase(candidate("google"), structuredCase, {
      env: { GEMINI_API_KEY: "gemini-test-key" },
      fetch,
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(13),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(init.headers).toMatchObject({ "x-goog-api-key": "gemini-test-key" });
    expect(JSON.parse(init.body)).toMatchObject({
      contents: [{ role: "user", parts: [{ text: structuredCase.prompt }] }],
      generationConfig: {
        maxOutputTokens: structuredCase.maxOutputTokens,
        responseMimeType: "application/json",
      },
    });
    expect(JSON.parse(init.body).generationConfig.responseJsonSchema).toBeDefined();
    expect(result).toMatchObject({
      status: "ok",
      usage: {
        inputTokens: 90,
        cachedInputTokens: 10,
        cacheWriteTokens: 0,
        outputTokens: 20,
        reasoningTokens: 2,
        totalTokens: 122,
      },
      finishReason: "STOP",
      latencyMs: 3,
      schemaValid: true,
    });
  });

  it("records malformed structured output without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{}" }] } }],
        usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3 },
      }),
    );
    const result = await runProviderCase(candidate("google"), structuredCase, {
      env: { GEMINI_API_KEY: "test-key" }, fetch, now: () => 1,
    });

    expect(result.status).toBe("schema-invalid");
    expect(result.usage.totalTokens).toBe(7);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes HTTP errors without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ key: "gemini-test-key" }, 403));
    const result = await runProviderCase(candidate("google"), FR6_CASES[0], {
      env: { GEMINI_API_KEY: "gemini-test-key" }, fetch, now: () => 1,
    });

    expect(result.output).toBe("Google request failed (HTTP 403)." );
    expect(result.output).not.toContain("secret-body");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves paid accounting for safety-blocked and empty responses", async () => {
    for (const response of [
      {
        candidates: [{ finishReason: "SAFETY", content: { parts: [{ text: "Refused." }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
      },
      {
        candidates: [{ finishReason: "STOP", content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2 },
      },
    ]) {
      const fetch = vi.fn().mockResolvedValue(jsonResponse(response));
      const result = await runProviderCase(candidate("google"), FR6_CASES[0], {
        env: { GEMINI_API_KEY: "test-key" },
        fetch,
        now: vi.fn().mockReturnValueOnce(3).mockReturnValueOnce(8),
      });

      expect(result).toMatchObject({
        status: "request-failed",
        finishReason: response.candidates[0].finishReason,
        latencyMs: 5,
        usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
      });
      expect(result.costUsd).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("runProviderCase Mistral", () => {
  it("uses chat-completions JSON schema and normalizes usage", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ finish_reason: "stop", message: { content: validStructuredOutput } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
          prompt_tokens_details: { cached_tokens: 10 },
        },
      }),
    );

    const result = await runProviderCase(candidate("mistral"), structuredCase, {
      env: { MISTRAL_API_KEY: "mistral-test-key" }, fetch,
      now: vi.fn().mockReturnValueOnce(5).mockReturnValueOnce(9),
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(init.headers).toMatchObject({ Authorization: "Bearer mistral-test-key" });
    expect(JSON.parse(init.body)).toMatchObject({
      model: "mistral-small-2603",
      max_tokens: structuredCase.maxOutputTokens,
      service_tier: "standard_only",
      messages: [{ role: "user", content: structuredCase.prompt }],
      response_format: {
        type: "json_schema",
        json_schema: { name: "submit_reflections", strict: true },
      },
    });
    expect(result).toMatchObject({
      status: "ok",
      usage: {
        inputTokens: 90,
        cachedInputTokens: 10,
        cacheWriteTokens: 0,
        outputTokens: 20,
        reasoningTokens: 0,
        totalTokens: 120,
      },
      finishReason: "stop",
      latencyMs: 4,
      schemaValid: true,
    });
  });

  it("records malformed structured output without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ finish_reason: "stop", message: { content: "[]" } }],
        usage: { prompt_tokens: 4, completion_tokens: 3 },
      }),
    );
    const result = await runProviderCase(candidate("mistral"), structuredCase, {
      env: { MISTRAL_API_KEY: "test-key" }, fetch, now: () => 1,
    });

    expect(result.status).toBe("schema-invalid");
    expect(result.usage.totalTokens).toBe(7);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes HTTP errors without retrying", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ key: "mistral-test-key" }, 429));
    const result = await runProviderCase(candidate("mistral"), FR6_CASES[0], {
      env: { MISTRAL_API_KEY: "mistral-test-key" }, fetch, now: () => 1,
    });

    expect(result.output).toBe("Mistral request failed (HTTP 429)." );
    expect(result.output).not.toContain("secret-body");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves paid accounting for filtered and empty responses", async () => {
    for (const response of [
      {
        choices: [{ finish_reason: "content_filter", message: { content: "Refused." } }],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      },
      {
        choices: [{ finish_reason: "stop", message: { content: "" } }],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      },
    ]) {
      const fetch = vi.fn().mockResolvedValue(jsonResponse(response));
      const result = await runProviderCase(candidate("mistral"), FR6_CASES[0], {
        env: { MISTRAL_API_KEY: "test-key" },
        fetch,
        now: vi.fn().mockReturnValueOnce(3).mockReturnValueOnce(8),
      });

      expect(result).toMatchObject({
        status: "request-failed",
        finishReason: response.choices[0].finish_reason,
        latencyMs: 5,
        usage: { inputTokens: 8, outputTokens: 2, totalTokens: 10 },
      });
      expect(result.costUsd).toBeGreaterThan(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
});

describe("runProviderCase fetch timeout", () => {
  it.each([
    ["openai", "OPENAI_API_KEY"],
    ["google", "GEMINI_API_KEY"],
    ["mistral", "MISTRAL_API_KEY"],
  ] as const)("aborts one %s request at 240 seconds and clears its timer", async (provider, credential) => {
    let timeout: (() => void) | undefined;
    const timerHandle = { id: 1 };
    const abort = vi.fn();
    const signal = {} as AbortSignal;
    const setTimer = vi.fn((callback: () => void) => {
      timeout = callback;
      return timerHandle;
    });
    const clearTimer = vi.fn();
    const fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      timeout?.();
      expect(abort).toHaveBeenCalledTimes(1);
      return Promise.reject(new DOMException("secret timeout detail", "AbortError"));
    });

    const result = await runProviderCase(candidate(provider), FR6_CASES[0], {
      env: { [credential]: "provider-test-key" },
      fetch,
      now: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(9),
      setTimer,
      clearTimer,
      createAbortController: () => ({ abort, signal }),
    });

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 240_000);
    expect(clearTimer).toHaveBeenCalledWith(timerHandle);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "request-failed", retries: 0, latencyMs: 8 });
    expect(result.output).toBe(`${provider === "openai" ? "OpenAI" : provider === "google" ? "Google" : "Mistral"} request failed.`);
    expect(result.output).not.toContain("secret timeout detail");
    expect(result.output).not.toContain("provider-test-key");
  });
});
