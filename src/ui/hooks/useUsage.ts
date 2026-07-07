import { useCallback, useState } from "react";
import { fetchUsage } from "../../session/usage-client.ts";
import { parseUsage, type UsageLimit } from "../../domain/usage.ts";

export type UsageView =
  | { status: "loading" }
  | { status: "ready"; limits: UsageLimit[] }
  | { status: "error"; message: string };

// Drives the /usage overlay: fetch on open, hold the fetched limits (or an error), close
// on Esc. `usage === null` means the panel is closed.
export function useUsage() {
  const [usage, setUsage] = useState<UsageView | null>(null);

  const showUsage = useCallback(async () => {
    setUsage({ status: "loading" });
    try {
      setUsage({ status: "ready", limits: parseUsage(await fetchUsage()) });
    } catch (e) {
      setUsage({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const closeUsage = useCallback(() => setUsage(null), []);

  return { usage, showUsage, closeUsage };
}
