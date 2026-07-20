import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig } from "../src/config.ts";

// config.ts honors SUMMON_CONFIG_DIR as its base dir. Point it at a throwaway
// dir so the tests never touch the real config.
let dir: string;
let prev: string | undefined;

beforeEach(() => {
  prev = process.env.SUMMON_CONFIG_DIR;
  dir = mkdtempSync(join(tmpdir(), "summon-config-"));
  process.env.SUMMON_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prev === undefined) delete process.env.SUMMON_CONFIG_DIR;
  else process.env.SUMMON_CONFIG_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

test("loadConfig returns {} when nothing is saved", () => {
  expect(loadConfig()).toEqual({});
});

test("saveConfig persists the model choice", () => {
  saveConfig({ model: "opus" });
  expect(loadConfig().model).toBe("opus");
});

test("saving the model preserves an existing theme (merge, not overwrite)", () => {
  saveConfig({ theme: "amber" });
  saveConfig({ model: "sonnet" });
  expect(loadConfig()).toEqual({ theme: "amber", model: "sonnet" });
});
