"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { Card, PrimaryButton, Skeleton, SkeletonScreen } from "./ui";
import type { BlockSettings } from "@/lib/types";

// UXA-15: the label was a DOM sibling of the input wrapper, not its parent and not htmlFor-linked —
// no programmatic association at all, so a screen reader heard "number, edit text" with no name for
// any of the 7 fields this wraps. Nesting the whole field inside <label> gives implicit association,
// matching the pattern SeasonSection.tsx/AthleteProfileForm.tsx already use correctly.
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      {hint && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between gap-4 rounded-md border border-zinc-200 px-3 py-2.5 text-left transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
      </span>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-zinc-900 dark:bg-[#00d4ff]" : "bg-zinc-300 dark:bg-zinc-600"
        }`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function NumberInput({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-400"
      />
      {suffix && <span className="text-sm text-zinc-500 dark:text-zinc-400">{suffix}</span>}
    </div>
  );
}

// UXA-20: the route clamps an out-of-range number to its floor/ceiling rather than rejecting it —
// unlike conflicting hour bounds (a real 400), a single out-of-range field saves "successfully" with
// no indication anything changed. Diffing the sent vs. returned numeric fields catches that silently.
const FIELD_LABELS = {
  targetWeeklyHours: "target weekly hours",
  maxAvailableHours: "maximum available hours",
  recoveryWeekHoursMin: "recovery week minimum hours",
  recoveryWeekHoursMax: "recovery week maximum hours",
  qualitySessionsPerLoadingWeek: "quality sessions per loading week",
  longRideDurationMinutes: "long ride minimum duration",
  restDaysPerWeek: "rest days per week",
} satisfies Partial<Record<keyof BlockSettings, string>>;

export default function BlockSettingsForm() {
  const [settings, setSettings] = useState<BlockSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [adjusted, setAdjusted] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BlockSettings>("/api/settings").then(setSettings).catch(() => setError("Failed to load settings."));
  }, []);

  const set = useCallback(<K extends keyof BlockSettings>(key: K, value: BlockSettings[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
    setAdjusted(null);
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      // This form no longer owns autoSyncOnOpen/autoPostCoachNote (PlatformBehaviorForm does) —
      // exclude them so a save here can never silently revert a platform toggle saved moments
      // earlier in the same session; the route merges any field absent from the body against
      // fresh on-disk state.
      const { autoSyncOnOpen: _autoSyncOnOpen, autoPostCoachNote: _autoPostCoachNote, ...body } = settings;
      const updated = await api<BlockSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const changed = (Object.keys(FIELD_LABELS) as Array<keyof typeof FIELD_LABELS>).filter(
        (k) => body[k] !== updated[k]
      );
      setSettings(updated);
      setSaved(true);
      setAdjusted(changed.length > 0 ? changed.map((k) => FIELD_LABELS[k]!) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    // S3-1: one placeholder per settings card (volume / structure / philosophy) so the
    // page below the "Settings" h1 holds its height while the form loads.
    return (
      <SkeletonScreen className="space-y-6">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-44" />
      </SkeletonScreen>
    );
  }

  // Catch conflicting target/availability and recovery bounds before they reach the server.
  const hoursInvalid =
    settings.targetWeeklyHours > settings.maxAvailableHours || settings.recoveryWeekHoursMin > settings.recoveryWeekHoursMax;

  return (
    // UXA-21: wrapping in <form> gives Enter-to-submit from any field — previously every save
    // needed an explicit pointer click on the button.
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {/* Weekly volume */}
      <Card title="Weekly volume targets">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Target weekly hours"
            hint="Intended total for each loading week"
          >
            <NumberInput
              value={settings.targetWeeklyHours}
              min={4}
              max={25}
              step={0.5}
              onChange={(v) => set("targetWeeklyHours", v)}
              suffix="h"
            />
          </Field>
          <Field
            label="Maximum available hours"
            hint="Hard weekly time ceiling"
          >
            <NumberInput
              value={settings.maxAvailableHours}
              min={4}
              max={30}
              step={0.5}
              onChange={(v) => set("maxAvailableHours", v)}
              suffix="h"
            />
          </Field>
          <Field
            label="Recovery week: minimum hours"
            hint="Last week of the block"
          >
            <NumberInput
              value={settings.recoveryWeekHoursMin}
              min={2}
              max={15}
              step={0.5}
              onChange={(v) => set("recoveryWeekHoursMin", v)}
              suffix="h"
            />
          </Field>
          <Field label="Recovery week: maximum hours">
            <NumberInput
              value={settings.recoveryWeekHoursMax}
              min={2}
              max={15}
              step={0.5}
              onChange={(v) => set("recoveryWeekHoursMax", v)}
              suffix="h"
            />
          </Field>
        </div>
      </Card>

      {/* Weekly structure */}
      <Card title="Weekly structure">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Quality sessions per loading week"
            hint="Threshold, VO2max, or SIT sessions"
          >
            <NumberInput
              value={settings.qualitySessionsPerLoadingWeek}
              min={1}
              max={4}
              onChange={(v) => set("qualitySessionsPerLoadingWeek", v)}
              suffix="sessions"
            />
          </Field>
          <Field
            label="Long ride minimum duration"
            hint="The anchor endurance ride per week"
          >
            <NumberInput
              value={settings.longRideDurationMinutes}
              min={60}
              max={480}
              step={15}
              onChange={(v) => set("longRideDurationMinutes", v)}
              suffix="min"
            />
          </Field>
          <Field label="Rest days per week" hint="Full rest, no riding">
            <NumberInput
              value={settings.restDaysPerWeek}
              min={0}
              max={3}
              onChange={(v) => set("restDaysPerWeek", v)}
              suffix="days"
            />
          </Field>
        </div>
      </Card>

      {/* Training philosophy */}
      <Card title="Training philosophy">
        <Field
          label="Approach"
          hint="Polarised keeps easy days very easy and hard days very hard. Sweet spot mixes in 88–93% FTP work."
        >
          <div className="flex gap-3">
            {(
              [
                { value: true, label: "Polarised (80/20)", description: "2–3 hard, rest <0.75 IF" },
                { value: false, label: "Sweet spot", description: "Threshold + 88–93% FTP work" },
              ] as const
            ).map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                onClick={() => set("polarisedApproach", opt.value)}
                className={`flex-1 rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  settings.polarisedApproach === opt.value
                    ? // UXA-18: dark mode previously inverted to a solid white block — a second,
                      // unrelated vocabulary for "selected" next to the accent language used
                      // everywhere else (active nav item, hero-card border, threshold pill).
                      "border-zinc-900 bg-zinc-900 text-white dark:border-[#ff49c8] dark:bg-[#ff49c8]/10 dark:text-[#ff49c8]"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-400"
                }`}
              >
                <span className="block font-semibold">{opt.label}</span>
                <span
                  className={`block text-xs ${settings.polarisedApproach === opt.value ? "text-zinc-300 dark:text-[#ff49c8]/70" : "text-zinc-500 dark:text-zinc-400"}`}
                >
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </Field>
        <div className="mt-4">
          <ToggleRow
            label="Allow Press lap steps"
            hint="Ends a safe readiness step when you press lap; verified on Wahoo, Garmin, and Suunto workflows."
            checked={settings.lapButtonSteps}
            onChange={(value) => set("lapButtonSteps", value)}
          />
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <PrimaryButton type="submit" disabled={saving || hoursInvalid}>
          {saving ? "Saving…" : "Save settings"}
        </PrimaryButton>
        {saved && <span role="status" className="text-sm text-green-700 dark:text-green-400">Saved — next generation will use these values.</span>}
        {error && <span role="alert" className="text-sm text-red-600">{error}</span>}
      </div>
      {hoursInvalid && (
        <p role="alert" className="text-xs text-red-600">Target hours can&apos;t exceed available time, and recovery minimum can&apos;t exceed its maximum.</p>
      )}
      {adjusted && (
        <p role="status" className="text-xs text-amber-600 dark:text-amber-400">
          Adjusted {adjusted.join(", ")} to fit the allowed range.
        </p>
      )}

      {settings.updatedAt !== new Date(0).toISOString() && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Last updated: {new Date(settings.updatedAt).toLocaleString()}
        </p>
      )}
    </form>
  );
}
