"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { Card, LoadFailed, PrimaryButton, Skeleton, SkeletonScreen, useMountLoad } from "./ui";
import { ToggleRow } from "./BlockSettingsForm";
import type { BlockSettings } from "@/lib/types";

// The PLATFORM half of Settings, split out of BlockSettingsForm so it renders under the page's PLATFORM
// divider (UX v2 §6 Settings) instead of visually sitting inside the GENERATION group. Loads the full
// settings but PUTs only the two platform toggles — the /api/settings PUT merges each field against
// fresh on-disk state, so this never clobbers the generation knobs saved by BlockSettingsForm.
export default function PlatformBehaviorForm() {
  const [settings, setSettings] = useState<Pick<BlockSettings, "autoSyncOnOpen" | "autoPostCoachNote"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<BlockSettings>("/api/settings");
      setSettings({ autoSyncOnOpen: s.autoSyncOnOpen, autoPostCoachNote: s.autoPostCoachNote });
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // visible failure (S1-3) — an infinite skeleton hides a broken endpoint
    }
  }, []);

  useMountLoad(load);

  const set = (key: "autoSyncOnOpen" | "autoPostCoachNote", value: boolean) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  };

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api<BlockSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loadFailed) {
    return <LoadFailed what="platform settings" retry={() => void load()} />;
  }
  if (!settings) {
    return (
      <SkeletonScreen>
        <Skeleton className="h-44" />
      </SkeletonScreen>
    );
  }

  return (
    <Card title="Platform behavior">
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">How Nodevelo handles syncing and write-back.</p>
      <div className="space-y-2">
        <ToggleRow
          label="Auto-sync on open"
          hint="When you open Today and the data is stale, pull from Intervals.icu automatically."
          checked={settings.autoSyncOnOpen}
          onChange={(v) => set("autoSyncOnOpen", v)}
        />
        <ToggleRow
          label="Auto-post coach note to Intervals.icu"
          hint="After each analysis, write the coach note back to your Intervals.icu calendar automatically."
          checked={settings.autoPostCoachNote}
          onChange={(v) => set("autoPostCoachNote", v)}
        />
      </div>
      <div className="mt-4 flex items-center gap-3">
        <PrimaryButton onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </PrimaryButton>
        {saved && <span className="text-sm text-green-700 dark:text-green-400">Saved.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </Card>
  );
}
