"use client";

import { useCallback, useEffect, useState } from "react";
import { api, timeAgo } from "@/lib/client-api";
import type { AthleteProfile } from "@/lib/types";

interface AutoSyncInfo {
  syncedAt: string | null;
  latestWeightKg: number | null;
  latestWeightDate: string | null;
  weightTrend7Day: number | null;
  avgRpe7Day: number | null;
  lastKcalConsumed: number | null;
  lastKcalDate: string | null;
}

interface BufferStatus {
  bufferApplied: number;
  delta: number;
  reason: string;
}

interface ProfileResponse {
  profile: AthleteProfile;
  autoSync: AutoSyncInfo;
  bufferStatus: BufferStatus;
}

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };

const PERF_FIELDS = [
  { key: "ftp", label: "FTP", unit: "W" },
  { key: "maxHr", label: "Max HR", unit: "bpm" },
  { key: "thresholdHr", label: "Threshold HR", unit: "bpm" },
  { key: "weightKg", label: "Weight", unit: "kg" },
  { key: "weeklyHoursMin", label: "Weekly hours (min)", unit: "h" },
  { key: "weeklyHoursMax", label: "Weekly hours (max)", unit: "h" },
] as const;

const NUT_FIELDS = [
  { key: "baseCalories", label: "Base calories", unit: "kcal" },
  { key: "restDayTarget", label: "Rest day target", unit: "kcal" },
  { key: "buffer", label: "Training day buffer", unit: "kcal" },
  { key: "targetWeightKg", label: "Target weight", unit: "kg" },
] as const;

type PerfKey = (typeof PERF_FIELDS)[number]["key"];
type NutKey = (typeof NUT_FIELDS)[number]["key"];

function Section({
  title,
  children,
  onSave,
  saveState,
}: {
  title: string;
  children: React.ReactNode;
  onSave?: () => void;
  saveState?: SaveState;
}) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
      <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
      <div className="mt-3">{children}</div>
      {onSave && (
        <div className="mt-4 flex items-center gap-3 border-t border-zinc-100 pt-3">
          <button
            onClick={onSave}
            disabled={saveState?.state === "saving"}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300"
          >
            {saveState?.state === "saving" ? "Saving…" : "Save"}
          </button>
          {saveState?.state === "saved" && (
            <span className="text-xs font-medium text-green-700">✓ Saved (athlete_profile.md regenerated)</span>
          )}
          {saveState?.state === "error" && (
            <span className="text-xs text-red-600">{saveState.message}</span>
          )}
        </div>
      )}
    </section>
  );
}

function StringListEditor({
  items,
  onChange,
  placeholder,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...items, value]);
    setDraft("");
  };
  return (
    <div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li
            key={`${item}-${i}`}
            className="flex items-center justify-between gap-2 rounded-md bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700"
          >
            <span>{item}</span>
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-zinc-400 hover:text-red-600"
              title="Remove"
            >
              ✕
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-zinc-400">Nothing recorded yet.</li>}
      </ul>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-zinc-900 focus:outline-none"
        />
        <button
          onClick={add}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:border-zinc-500"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export default function AthleteProfileForm() {
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [perf, setPerf] = useState<Record<PerfKey, string>>({
    ftp: "",
    maxHr: "",
    thresholdHr: "",
    weightKg: "",
    weeklyHoursMin: "",
    weeklyHoursMax: "",
  });
  const [nut, setNut] = useState<Record<NutKey, string>>({
    baseCalories: "",
    restDayTarget: "",
    buffer: "",
    targetWeightKg: "",
  });
  const [goals, setGoals] = useState<string[]>([]);
  const [weakpoints, setWeakpoints] = useState<string[]>([]);
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});

  const load = useCallback(async () => {
    try {
      const response = await api<ProfileResponse>("/api/profile");
      setData(response);
      const p = response.profile.performance;
      setPerf({
        ftp: String(p.ftp),
        maxHr: String(p.maxHr),
        thresholdHr: String(p.thresholdHr),
        weightKg: String(p.weightKg),
        weeklyHoursMin: String(p.weeklyHoursMin),
        weeklyHoursMax: String(p.weeklyHoursMax),
      });
      const n = response.profile.nutrition;
      setNut({
        baseCalories: String(n.baseCalories),
        restDayTarget: String(n.restDayTarget),
        buffer: String(n.buffer),
        targetWeightKg: String(n.targetWeightKg),
      });
      setGoals(response.profile.goals);
      setWeakpoints(response.profile.weakpoints);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load profile");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (section: string) => {
    const parsed: Record<string, number> = {};
    for (const [key, value] of [...Object.entries(perf), ...Object.entries(nut)]) {
      const n = Number(value);
      if (value.trim() === "" || !Number.isFinite(n)) {
        setSaveStates((s) => ({
          ...s,
          [section]: { state: "error", message: `"${key}" is not a valid number.` },
        }));
        return;
      }
      parsed[key] = n;
    }
    setSaveStates((s) => ({ ...s, [section]: { state: "saving" } }));
    try {
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({
          profile: {
            performance: {
              ftp: parsed.ftp,
              maxHr: parsed.maxHr,
              thresholdHr: parsed.thresholdHr,
              weightKg: parsed.weightKg,
              weeklyHoursMin: parsed.weeklyHoursMin,
              weeklyHoursMax: parsed.weeklyHoursMax,
            },
            goals,
            weakpoints,
            nutrition: {
              baseCalories: parsed.baseCalories,
              restDayTarget: parsed.restDayTarget,
              buffer: parsed.buffer,
              targetWeightKg: parsed.targetWeightKg,
            },
          },
        }),
      });
      setSaveStates((s) => ({ ...s, [section]: { state: "saved" } }));
      // Refresh derived buffer status without clobbering in-progress edits.
      const fresh = await api<ProfileResponse>("/api/profile");
      setData(fresh);
    } catch (err) {
      setSaveStates((s) => ({
        ...s,
        [section]: { state: "error", message: err instanceof Error ? err.message : "Save failed" },
      }));
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {loadError}
      </div>
    );
  }
  if (!data) return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;

  const { autoSync, bufferStatus } = data;
  const numberInput = (
    value: string,
    onChange: (v: string) => void,
    label: string,
    unit: string
  ) => (
    <label key={label} className="block">
      <span className="text-xs font-medium text-zinc-600">
        {label} <span className="text-zinc-400">({unit})</span>
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-zinc-900">Athlete profile</h1>

      <Section
        title="Performance data (update after FTP tests)"
        onSave={() => save("performance")}
        saveState={saveStates.performance}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {PERF_FIELDS.map((f) =>
            numberInput(perf[f.key], (v) => setPerf((s) => ({ ...s, [f.key]: v })), f.label, f.unit)
          )}
        </div>
      </Section>

      <Section title="Goals" onSave={() => save("goals")} saveState={saveStates.goals}>
        <StringListEditor
          items={goals}
          onChange={setGoals}
          placeholder="e.g. FTP 280 W by September"
        />
      </Section>

      <Section
        title="Weakpoints"
        onSave={() => save("weakpoints")}
        saveState={saveStates.weakpoints}
      >
        <StringListEditor
          items={weakpoints}
          onChange={setWeakpoints}
          placeholder="e.g. fading after 2000 kJ"
        />
      </Section>

      <Section title="Auto-sync from Intervals.icu (read-only)">
        {autoSync.syncedAt === null ? (
          <p className="text-sm text-zinc-500">
            No sync yet — run a sync from the dashboard to populate this section.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-400">Latest weight</dt>
              <dd className="font-medium text-zinc-800">
                {autoSync.latestWeightKg !== null
                  ? `${autoSync.latestWeightKg.toFixed(1)} kg (${autoSync.latestWeightDate})`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">7-day weight trend</dt>
              <dd className="font-medium text-zinc-800">
                {autoSync.weightTrend7Day !== null
                  ? `${autoSync.weightTrend7Day > 0 ? "+" : ""}${autoSync.weightTrend7Day.toFixed(1)} kg`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Avg RPE (7 days)</dt>
              <dd className="font-medium text-zinc-800">
                {autoSync.avgRpe7Day !== null ? `${autoSync.avgRpe7Day}/10` : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-400">Last logged intake</dt>
              <dd className="font-medium text-zinc-800">
                {autoSync.lastKcalConsumed !== null
                  ? `${autoSync.lastKcalConsumed} kcal (${autoSync.lastKcalDate})`
                  : "—"}
              </dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs text-zinc-400">Synced {timeAgo(autoSync.syncedAt)}.</p>
      </Section>

      <Section
        title="Nutrition formula settings"
        onSave={() => save("nutrition")}
        saveState={saveStates.nutrition}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {NUT_FIELDS.map((f) =>
            numberInput(nut[f.key], (v) => setNut((s) => ({ ...s, [f.key]: v })), f.label, f.unit)
          )}
        </div>
        <div className="mt-3 rounded-md bg-zinc-50 px-3 py-2.5">
          <p className="text-xs font-semibold text-zinc-600">Buffer auto-adjustment</p>
          <p className="mt-1 text-sm text-zinc-700">
            Configured {data.profile.nutrition.buffer} kcal → currently applied{" "}
            <span className="font-semibold">{bufferStatus.bufferApplied} kcal</span>
            {bufferStatus.delta !== 0 &&
              ` (${bufferStatus.delta > 0 ? "+" : ""}${bufferStatus.delta} kcal)`}
          </p>
          <p className="mt-1 text-xs text-zinc-500">{bufferStatus.reason}</p>
        </div>
      </Section>
    </div>
  );
}
