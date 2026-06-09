<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/SOULFORGE_LOGO.png" />
  <source media="(prefers-color-scheme: light)" srcset="assets/SOULFORGE_LOGO_LIGHT.png" />
  <img alt="SoulForge" src="assets/SOULFORGE_LOGO.png" width="560" />
</picture>

<p><strong>SoulForge · lildebil0 fork — one chat for <em>all</em> the AI subscriptions you already pay for.</strong></p>

<p>
  <a href="https://github.com/proxysoul/soulforge">upstream: proxysoul/soulforge</a> ·
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-BSL%201.1-blue.svg?style=flat-square" /></a>
</p>

</div>

> Fork of [**proxysoul/soulforge**](https://github.com/proxysoul/soulforge) — *"the AI
> coding agent that edits symbols, not strings."* This README covers what **the fork
> adds**; for the full feature set, benchmarks and docs see the
> [upstream README](https://github.com/proxysoul/soulforge#readme) and
> [docs](https://soulforge.proxysoul.com).

## The idea

Turn SoulForge into an **all‑in‑one cockpit for your personal AI subscriptions.**
Instead of one client per service, plug every subscription you pay for in as a
first‑class provider, pick any model from a single `/model` list — and fix the
cross‑platform rough edges (macOS **and** Windows) that get in the way.

It builds on SoulForge's existing proxy / CLIProxyAPI integration (which already
brings Claude Max / Codex / Antigravity subscriptions) and adds more subscription
backends plus reliability fixes.

## What this fork adds

### New subscription providers

| Provider | id | What | Key |
|----------|----|------|-----|
| **Z.AI** | `zai` | Zhipu **GLM Coding Plan** — official OpenAI‑compatible coding endpoint, surfaces GLM `reasoning_content`. | `ZAI_API_KEY` |
| **Factory** | `factory` | **Factory.ai Droid** subscription — the OpenAI‑compatible inference endpoint the Droid CLI uses, with per‑model `x-api-provider` routing. | `FACTORY_API_KEY` |

Both appear automatically in `/keys` and `/model`.

### Cross‑platform fixes (also opened as PRs upstream)

- **macOS — no more 2‑second freeze.** The status bar ran `vmmap --summary` on the
  main process every 2s, stalling the whole TUI on a fixed cadence. The footprint
  is now cached and refreshed off the poll's await path. *(PR #103)*
- **Windows — readable shell output.** The shell tool decoded `cmd.exe` output as
  UTF‑8 unconditionally, but cmd emits the console **OEM code page** (e.g. cp866),
  so non‑ASCII came back as mojibake and models "couldn't see the output". Now
  decoded via the active console code page. *(PR #105)*
- **Proxy — reasoning is visible.** Proxied non‑Claude models (Gemini, GLM, …)
  return `reasoning_content`, but the proxy provider used `@ai-sdk/openai` which
  drops it. Switched to `@ai-sdk/openai-compatible`, so thinking shows in the
  verbose tab. *(PR #106)*

## Build & run

This fork is built from source (Bun ≥ 1.3.13):

```bash
git clone https://github.com/lildebil0/soulforge && cd soulforge
bun install
bun run dev          # run from source
# or: bun run build  → a standalone binary in bin/
```

## Use

1. **Add a subscription key:** `/keys` → pick the provider (Z.AI / Factory / …) →
   paste your key. Stored in the OS keychain / encrypted `secrets.dat`, never
   plaintext.
2. **Pick a model:** `/model` → provider → model.

### Region‑gated subscriptions (e.g. Factory)

Some backends geo‑block by IP. This fork ships **no in‑app proxy** — route around
it at the **network layer** with a transparent **VPN / TUN**. Note the OS "system
proxy" is ignored by Bun's `fetch`; a TUN tunnel covers all traffic (enable
*Bypass LAN* so local SSH keeps working). Provider‑scoped env overrides exist
where useful: `FACTORY_API_PROVIDER`, `FACTORY_ORG_ID`.

## Status & honesty

- **Z.AI + the three fixes** — clean; `bun run typecheck` (0 errors) and
  `bun run lint` pass; opened as PRs against upstream.
- **Factory** — reverse‑engineered from the **official** Droid CLI for personal
  interop with **your own** subscription. `glm-5.1` is verified end‑to‑end; the
  wider Factory menu needs each model's exact id + matching `x-api-provider`, and
  several Factory→upstream routes are themselves region‑gated. Driving a paid
  subscription through a non‑official client may conflict with Factory's Terms —
  your call on your own account. Not submitted upstream.

## License

[BSL 1.1](LICENSE), inherited from upstream — free for personal and internal use;
converts to Apache 2.0 on 2030‑03‑15. Commercial use:
[commercial license](COMMERCIAL_LICENSE.md).
