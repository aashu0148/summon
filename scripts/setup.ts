#!/usr/bin/env bun
// One-command onboarding: `bun run setup`. Installs deps, exposes the `summon` command, and on
// macOS optionally installs terminal-notifier for notification click-to-focus. Cross-platform
// because Bun runs everywhere — the platform-specific decisions live in the pure setupPlan().
import { setupPlan, type SetupStep } from "../src/domain/setup.ts";

const steps = setupPlan(process.platform, {
  hasBrew: Bun.which("brew") != null,
  hasTerminalNotifier: Bun.which("terminal-notifier") != null,
});

for (const step of steps) runStep(step);
console.log("\n✓ setup complete — run `summon` from any project directory to start.");

function runStep(step: SetupStep): void {
  if (step.kind === "info") return void console.log(`ℹ  ${step.message}`);
  if (step.kind === "warn") return void console.warn(`⚠  ${step.message}`);

  console.log(`\n▶ ${step.label}\n  $ ${step.cmd.join(" ")}`);
  const { success } = Bun.spawnSync(step.cmd, { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  if (success) return;
  if (step.optional) return void console.warn(`⚠  optional step failed (continuing): ${step.label}`);
  console.error(`✗ setup failed at: ${step.label}`);
  process.exit(1);
}
