import os from "node:os";

let cached: boolean | null = null;

/**
 * Low-power mode: slow continuous TUI animations to a crawl. Auto-on for
 * machines with <= 4 logical cores (e.g. dual-core Intel laptops), where the
 * 30 FPS flame logo and animated wordmark peg a CPU core at idle — wrong for a
 * CLI agent that is just sitting there. Override with SF_LOW_POWER=1 / =0.
 */
export function isLowPowerMode(): boolean {
  if (cached !== null) return cached;
  const env = process.env.SF_LOW_POWER;
  if (env === "1") {
    cached = true;
  } else if (env === "0") {
    cached = false;
  } else {
    try {
      cached = (os.cpus()?.length ?? 8) <= 4;
    } catch {
      cached = false;
    }
  }
  return cached;
}
