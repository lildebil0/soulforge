# soulforge — lildebil0 fork

> Fork of [proxysoul/soulforge](https://github.com/proxysoul/soulforge). This file
> describes only what **this fork adds** on top of upstream; see `README.md` for
> the base project.

## The idea

Turn soulforge into an **all‑in‑one cockpit for the AI subscriptions you already
pay for.** Instead of one chat per tool, plug every personal subscription in as a
first‑class provider, pick any model from a single `/model` list — and fix the
cross‑platform rough edges (macOS **and** Windows) that otherwise get in the way.

It builds on soulforge's existing proxy/CLIProxyAPI integration (which already
brings Claude Max / Codex / Antigravity subscriptions) and adds more subscription
backends plus reliability fixes.

## What it adds

### New subscription providers

| Provider | id | What | Auth |
|----------|----|------|------|
| **Z.AI** | `zai` | Zhipu **GLM Coding Plan** — official OpenAI‑compatible coding endpoint (`api.z.ai/api/coding/paas/v4`). Surfaces GLM `reasoning_content`. | `ZAI_API_KEY` |
| **Factory** | `factory` | **Factory.ai Droid** subscription — the OpenAI‑compatible inference endpoint the Droid CLI uses (`api.factory.ai/api/llm/o/v1`), with a per‑model `x-api-provider` routing header. | `FACTORY_API_KEY` |

Both appear automatically in `/keys` and `/model`.

### Cross‑platform fixes (also submitted upstream)

- **macOS — no more 2‑second freeze.** The status bar ran `vmmap --summary` on the
  main process every 2s, stalling the whole TUI on a fixed cadence. Now the
  footprint is cached and refreshed off the poll's await path. *(upstream PR #103)*
- **Windows — readable shell output.** The shell tool decoded `cmd.exe` output as
  UTF‑8 unconditionally, but cmd emits the console **OEM code page** (e.g. cp866),
  so non‑ASCII came back as mojibake and models "couldn't see the output". Now
  decoded via the active console code page. *(upstream PR #105)*
- **Proxy — reasoning is visible.** Proxied non‑Claude models (Gemini, GLM, …)
  return `reasoning_content`, but the proxy provider used `@ai-sdk/openai` which
  drops it. Switched to `@ai-sdk/openai-compatible`, so thinking shows in the
  verbose tab — like the dedicated providers already do. *(upstream PR #106)*

## Using it

1. **Build:** `bun install && bun run build` (or `bun run dev`). Needs Bun ≥ 1.3.13.
2. **Add keys:** `/keys` → pick the provider → paste your subscription key. Stored
   in the OS keychain / encrypted `secrets.dat`, never plaintext.
3. **Pick a model:** `/model` → provider → model.

### Region‑gated subscriptions (e.g. Factory)

Some subscription backends geo‑block by IP. This fork ships **no in‑app proxy** —
route around it at the **network layer** with a transparent **VPN/TUN** (the OS
"system proxy" is ignored by Bun's `fetch`; a TUN tunnel covers all traffic. Tip:
enable *Bypass LAN* in your VPN so local SSH keeps working). Provider‑scoped env
overrides exist where it helps: `FACTORY_API_PROVIDER`, `FACTORY_ORG_ID`.

## Status & honesty

- **z.ai + the three fixes** — clean, `bun run typecheck` (0 errors) and
  `bun run lint` pass; opened as PRs against upstream.
- **Factory** — reverse‑engineered from the **official** Droid CLI for personal
  interop with **your own** subscription. `glm-5.1` is verified end‑to‑end; the
  wider Factory menu needs each model's exact id + matching `x-api-provider`, and
  several Factory→upstream routes are themselves region‑gated. Driving a paid
  subscription through a non‑official client may conflict with Factory's Terms —
  that's your call on your own account. Not submitted upstream.
