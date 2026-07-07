// Fetches real Claude subscription usage from Anthropic's OAuth endpoint — the same
// data Claude Code's own `/usage` screen shows (session + weekly limits, reset times).
// We reuse the CLI's stored login rather than holding our own credentials: read its
// OAuth access token (keychain on macOS, ~/.claude/.credentials.json elsewhere) and
// call the endpoint directly. No refresh flow — an expired token tells the user to
// re-run `claude` once.

import { homedir } from "node:os";
import { join } from "node:path";
import type { RawUsage } from "../domain/usage.ts";

const USAGE_PATH = "/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";
const API_VERSION = "2023-06-01";
const KEYCHAIN_SERVICE = "Claude Code-credentials";
const TIMEOUT_MS = 5000;

const baseUrl = () =>
  process.env.ANTHROPIC_BASE_URL || process.env.CLAUDE_CODE_API_BASE_URL || "https://api.anthropic.com";

function accessTokenFrom(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw.trim())?.claudeAiOauth?.accessToken ?? null;
  } catch {
    return null; // malformed store — treat as no token
  }
}

async function readOAuthToken(): Promise<string> {
  const file = Bun.file(join(homedir(), ".claude", ".credentials.json"));
  if (await file.exists()) {
    const token = accessTokenFrom(await file.text());
    if (token) return token;
  }
  if (process.platform === "darwin") {
    const out = await Bun.$`security find-generic-password -s ${KEYCHAIN_SERVICE} -w`.quiet().nothrow().text();
    const token = accessTokenFrom(out);
    if (token) return token;
  }
  throw new Error("no Claude login found — sign in with `claude` first");
}

export async function fetchUsage(): Promise<RawUsage> {
  const token = await readOAuthToken();
  const res = await fetch(baseUrl() + USAGE_PATH, {
    headers: {
      authorization: `Bearer ${token}`,
      "anthropic-beta": OAUTH_BETA,
      "anthropic-version": API_VERSION,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new Error("login expired — run `claude` once to refresh, then retry");
  if (!res.ok) throw new Error(`usage request failed (HTTP ${res.status})`);
  return (await res.json()) as RawUsage;
}
