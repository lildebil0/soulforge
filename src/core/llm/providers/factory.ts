import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { loadConfig } from "../../../config/index.js";
import { getProviderApiKey } from "../../secrets.js";
import { getCompatReasoningBody } from "../compat-reasoning.js";
import { createReasoningFetchWrapper } from "./reasoning-fetch.js";
import type { ProviderDefinition, ProviderModelInfo } from "./types.js";

// Factory.ai (Droid) subscription. The Droid CLI talks to an OpenAI-compatible
// inference endpoint: https://api.factory.ai/api/llm/o/v1/chat/completions
// (there is also an Anthropic-shaped /api/llm/a/v1/messages, but /o/v1 serves
// every model — including Claude — with standard OpenAI streaming, and Bearer
// auth, which @ai-sdk/openai-compatible matches and which surfaces GLM/etc.
// reasoning_content as reasoning parts).
//
// Auth: the Factory API key as a Bearer token. The CLI also sends client-id
// headers; we replicate the ones Factory checks.
//
// NOTE: api.factory.ai is region-gated. If Factory blocks your region, run
// soulforge behind your proxy (HTTPS_PROXY=http://127.0.0.1:PORT) — Bun's fetch
// honours it — exactly like the Droid CLI does.
const BASE_URL = "https://api.factory.ai/api/llm/o/v1";
const CLIENT_VERSION = "0.143.0";

// Factory routes each model to an upstream infra provider, named in the REQUIRED
// `x-api-provider` header (the endpoint 400s without it). It validates the
// (model id ↔ provider) pair. Confirmed working: glm-5.1 → "fireworks". Other
// families map best-effort; override per deployment with FACTORY_API_PROVIDER.
// NB: some Factory→upstream routes are themselves region-gated and 400 with
// "Provider not available in this region" regardless of your local proxy.
const PROVIDER_BY_PREFIX: [RegExp, string][] = [
  [/^(glm|kimi|qwen|deepseek|minimax|mimo)/i, "fireworks"],
  [/^gemini/i, "vertex_ai"],
  [/^nemotron/i, "baseten"],
];

function apiProvider(modelId: string): string | undefined {
  const override = process.env.FACTORY_API_PROVIDER;
  if (override) return override;
  for (const [re, prov] of PROVIDER_BY_PREFIX) {
    if (re.test(modelId)) return prov;
  }
  return undefined;
}

function factoryHeaders(modelId: string): Record<string, string> {
  const h: Record<string, string> = {
    "X-Factory-Client": "cli",
    "X-Client-Version": CLIENT_VERSION,
  };
  const prov = apiProvider(modelId);
  if (prov) h["x-api-provider"] = prov;
  // Org is usually derived from the key; send it only if the user pins one.
  const org = process.env.FACTORY_ORG_ID;
  if (org) h["X-Factory-Org-Id"] = org;
  return h;
}

export const factory: ProviderDefinition = {
  id: "factory",
  name: "Factory",
  envVar: "FACTORY_API_KEY",
  icon: "\u{F0E9D}", // nf-md-factory
  secretKey: "factory-api-key",
  keyUrl: "app.factory.ai/settings/api-keys",
  asciiIcon: "F",
  description: "Factory Droid subscription (Claude, GLM, Gemini, GPT, …)",

  createModel(modelId: string): LanguageModel {
    const apiKey = getProviderApiKey("FACTORY_API_KEY");
    if (!apiKey) {
      throw new Error("FACTORY_API_KEY is not set");
    }
    // @ai-sdk/openai-compatible → Bearer auth (matches Factory) and surfaces
    // upstream reasoning_content as reasoning parts. Reasoning body per config.
    const reasoningBody = getCompatReasoningBody(`factory/${modelId}`, loadConfig());
    const reasoningFetch = createReasoningFetchWrapper(reasoningBody);
    return createOpenAICompatible({
      name: "factory",
      baseURL: BASE_URL,
      apiKey,
      headers: factoryHeaders(modelId),
      ...(reasoningFetch ? { fetch: reasoningFetch as typeof fetch } : {}),
    }).chatModel(modelId);
  },

  async fetchModels(): Promise<ProviderModelInfo[] | null> {
    return null;
  },

  // Verified working from a typical region: glm-5.1 (Factory routes it to
  // Fireworks). Factory's wider menu (Claude, Gemini, GPT, Nemotron, …) needs
  // the exact model id + a matching x-api-provider, and several upstreams are
  // region-gated ("Provider not available in this region"); extend the prefix
  // map / set FACTORY_API_PROVIDER as you confirm them. There is no public
  // /models endpoint, so this list is intentionally conservative.
  fallbackModels: [{ id: "glm-5.1", name: "GLM-5.1" }],

  contextWindows: [["glm-5", 200_000]],
};
