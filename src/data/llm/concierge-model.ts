import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue, LanguageModel } from "ai";
import { MarketplaceDataUnavailableError } from "../../business/errors/marketplace-errors.ts";

export interface ConciergeModelEnvironment {
  CONCIERGE_BASE_URL?: string;
  CONCIERGE_API_KEY?: string;
  CONCIERGE_MODEL?: string;
  // Index signature keeps this assignable from process.env (a ProcessEnv,
  // which TS otherwise treats as sharing no properties with an all-optional type).
  [key: string]: string | undefined;
}

export const CONCIERGE_DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const CONCIERGE_DEFAULT_MODEL = "qwen-plus";

/** Provider name; also the `providerOptions` key for extra request fields. */
export const CONCIERGE_PROVIDER = "concierge";

export interface ConciergeModelHandle {
  languageModel: LanguageModel;
  name: string;
  providerOptions: Record<string, Record<string, JSONValue>>;
}

export function isConciergeConfigured(env: ConciergeModelEnvironment = process.env): boolean {
  return typeof env.CONCIERGE_API_KEY === "string" && env.CONCIERGE_API_KEY.trim().length > 0;
}

export interface ConciergeModelOptions {
  env?: ConciergeModelEnvironment;
  fetchImpl?: typeof fetch;
}

// Builds the AI SDK language model for the concierge from CONCIERGE_* (any
// OpenAI-compatible chat/completions host: DashScope, DeepSeek, ...). The
// model is created per request; the factory is cheap and keeps the key out
// of module state. Never log the handle: the provider carries the key.
export function createConciergeModel(options: ConciergeModelOptions = {}): ConciergeModelHandle {
  const env = options.env ?? process.env;
  const apiKey = env.CONCIERGE_API_KEY?.trim();
  if (!apiKey) throw new MarketplaceDataUnavailableError("concierge model");

  const baseURL = (env.CONCIERGE_BASE_URL?.trim() || CONCIERGE_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const name = env.CONCIERGE_MODEL?.trim() || CONCIERGE_DEFAULT_MODEL;
  const provider = createOpenAICompatible({
    name: CONCIERGE_PROVIDER,
    baseURL,
    apiKey,
    ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
  });

  return {
    languageModel: provider(name),
    name,
    // DashScope models default to a "thinking" pass that adds seconds and
    // tokens; the concierge output is short text plus tool calls, so it is
    // off. Other OpenAI-compatible hosts do not know the flag and must not
    // get it.
    providerOptions: baseURL.includes("dashscope") ? { [CONCIERGE_PROVIDER]: { enable_thinking: false } } : {},
  };
}
