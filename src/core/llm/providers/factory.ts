import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { loadConfig } from "../../../config/index.js";
import { getProviderApiKey } from "../../secrets.js";
import { getCompatReasoningBody } from "../compat-reasoning.js";
import { createReasoningFetchWrapper } from "./reasoning-fetch.js";
import type { ProviderDefinition, ProviderModelInfo } from "./types.js";

// Factory.ai (Droid) subscription. The Droid CLI talks to an OpenAI-compatible
// inference endpoint: https://api.factory.ai/api/llm/o/v1/chat/completions
// Auth is the Factory API key as a Bearer token; the CLI also sends client-id
// headers and a REQUIRED per-model `x-api-provider` upstream-routing header.
// @ai-sdk/openai-compatible matches the Bearer auth and surfaces reasoning_content.
//
// NOTE: api.factory.ai may be region-gated. Soulforge does not proxy it itself —
// route around the geo-block at the network layer (a transparent VPN / TUN), the
// same way the Droid CLI needs to. No in-app proxy setting is involved.
const BASE_URL = "https://api.factory.ai/api/llm/o/v1";
const CLIENT_VERSION = "0.143.0";

// Factory routes each model to an upstream infra provider, named in the REQUIRED
// `x-api-provider` header (the endpoint 400s without it). It validates the
// (model id ↔ provider) pair. Confirmed working: glm-5.1 → "fireworks". Other
// families map best-effort; override per deployment with FACTORY_API_PROVIDER.
// NB: some Factory→upstream routes are themselves region-gated and 400 with
// "Provider not available in this region".
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
  // region-gated; extend the prefix map / set FACTORY_API_PROVIDER as you
  // confirm them. There is no public /models endpoint, so this list is
  // intentionally conservative.
  fallbackModels: [{ id: "glm-5.1", name: "GLM-5.1" }],

  contextWindows: [["glm-5", 200_000]],
};
