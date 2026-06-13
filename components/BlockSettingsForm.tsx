"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { BlockSettings } from "@/lib/types";

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
    <div>
      <label className="block text-sm font-medium text-zinc-700">{label}</label>
      {hint && <p className="mt-0.5 text-xs text-zinc-400">{hint}</p>}
      <div className="mt-1.5">{children}</div>
    </div>
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
        className="w-24 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
      />
      {suffix && <span className="text-sm text-zinc-500">{suffix}</span>}
    </div>
  );
}

export default function BlockSettingsForm() {
  const [settings, setSettings] = useState<BlockSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BlockSettings>("/api/settings").then(setSettings).catch(() => setError("Failed to load settings."));
  }, []);

  const set = useCallback(<K extends keyof BlockSettings>(key: K, value: BlockSettings[K]) => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
    setSaved(false);
  }, []);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api<BlockSettings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      setSettings(updated);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <p className="text-sm text-zinc-400">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Weekly volume */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-4">
        <h2 className="mb-4 text-sm font-semibold text-zinc-800">Weekly volume targets</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Loading week: minimum hours"
            hint="Blocks won't generate below this for loading weeks"
          >
            <NumberInput
              value={settings.weeklyHoursMin}
              min={4}
              max={25}
              step={0.5}
              onChange={(v) => set("weeklyHoursMin", v)}
              suffix="h"
            />
          </Field>
          <Field
            label="Loading week: maximum hours"
            hint="Upper ceiling for loading weeks"
          >
            <NumberInput
              value={settings.weeklyHoursMax}
              min={4}
              max={30}
              step={0.5}
              onChange={(v) => set("weeklyHoursMax", v)}
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
      </section>

      {/* Weekly structure */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-4">
        <h2 className="mb-4 text-sm font-semibold text-zinc-800">Weekly structure</h2>
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
      </section>

      {/* Training philosophy */}
      <section className="rounded-lg border border-zinc-200 bg-white px-5 py-4">
        <h2 className="mb-4 text-sm font-semibold text-zinc-800">Training philosophy</h2>
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
                onClick={() => set("polarisedApproach", opt.value)}
                className={`flex-1 rounded-md border px-4 py-3 text-left text-sm transition-colors ${
                  settings.polarisedApproach === opt.value
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400"
                }`}
              >
                <span className="block font-semibold">{opt.label}</span>
                <span
                  className={`block text-xs ${settings.polarisedApproach === opt.value ? "text-zinc-300" : "text-zinc-400"}`}
                >
                  {opt.description}
                </span>
              </button>
            ))}
          </div>
        </Field>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-sm text-green-700">Saved — next generation will use these values.</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {settings.updatedAt !== new Date(0).toISOString() && (
        <p className="text-xs text-zinc-400">
          Last updated: {new Date(settings.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
