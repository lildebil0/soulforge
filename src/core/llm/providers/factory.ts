import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { loadConfig } from "../../../config/index.js";
import { getProviderApiKey } from "../../secrets.js";
import { getCompatReasoningBody } from "../compat-reasoning.js";
import type { ProviderDefinition, ProviderModelInfo } from "./types.js";

// Factory.ai (Droid) subscription. The Droid CLI talks to an OpenAI-compatible
// inference endpoint: https://api.factory.ai/api/llm/o/v1/chat/completions
// Auth is the Factory API key as a Bearer token; the CLI also sends client-id
// headers and a per-model `x-api-provider` upstream-routing header (below).
// @ai-sdk/openai-compatible matches the Bearer auth and surfaces reasoning_content.
//
// PROXY (optional, toggleable, Factory-scoped): api.factory.ai may be
// region-gated. Set FACTORY_PROXY (e.g. http://127.0.0.1:3067) to route ONLY
// Factory requests through that proxy; unset it to go direct. Unlike a global
// HTTPS_PROXY this leaves every other provider untouched.
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

/**
 * Per-request fetch for Factory: injects the OpenAI-compatible reasoning body
 * and, when FACTORY_PROXY is set, routes through that proxy (Bun's `proxy`
 * option, scoped to Factory). Returns undefined when neither is needed, so the
 * caller falls back to the default fetch.
 */
function factoryFetch(reasoningBody: Record<string, unknown>): typeof fetch | undefined {
  const proxy = process.env.FACTORY_PROXY;
  const hasBody = Object.keys(reasoningBody).length > 0;
  if (!proxy && !hasBody) return undefined;
  return (async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const [input, init] = args;
    let next: RequestInit = init ?? {};
    if (hasBody && typeof next.body === "string") {
      try {
        next = { ...next, body: JSON.stringify({ ...JSON.parse(next.body), ...reasoningBody }) };
      } catch {
        // non-JSON body — leave as-is
      }
    }
    if (proxy) {
      // Bun-specific option — tunnels only this provider's requests.
      (next as RequestInit & { proxy?: string }).proxy = proxy;
    }
    return fetch(input, next);
  }) as typeof fetch;
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
    const fetchFn = factoryFetch(reasoningBody);
    return createOpenAICompatible({
      name: "factory",
      baseURL: BASE_URL,
      apiKey,
      headers: factoryHeaders(modelId),
      ...(fetchFn ? { fetch: fetchFn } : {}),
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
