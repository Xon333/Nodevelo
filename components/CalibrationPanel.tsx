"use client";

import { useState } from "react";
import { useSync } from "./SyncProvider";
import { Card } from "./ui";
import { api } from "@/lib/client-api";
import { CARBS_OPTIMUM_BOUNDS, DECOUPLING_GOOD_BOUNDS, DEFAULT_CARBS_OPTIMUM, resolveCalibratedValue } from "@/lib/calibration";
import { DEFAULT_DECOUPLING_GOOD } from "@/lib/execution-score";
import type { CalibratedParameter, CalibrationStore } from "@/lib/types";

// Per-athlete calibration (ROADMAP #2) — shows the effective value the app uses + its provenance,
// so the athlete sees what's been learned from their own data vs. the population default, AND can
// contest/correct it: a manual override is the escape hatch when the learned value is wrong. The next
// sync preserves overrides (each derive reads prior.manualOverride).

interface RowConfig {
  param: "decouplingGood" | "carbsOptimum";
  label: string;
  unit: string; // rendered after the value, e.g. "%" / " g/h"
  bounds: { readonly min: number; readonly max: number };
  populationDefault: number;
  blurb: string;
}

const ROWS: RowConfig[] = [
  {
    param: "decouplingGood",
    label: "Durability reference (typical Pw:HR drift)",
    unit: "%",
    bounds: DECOUPLING_GOOD_BOUNDS,
    populationDefault: DEFAULT_DECOUPLING_GOOD,
    blurb:
      "Your typical Pw:HR drift on steady rides — the reference a long-ride durability read compares against. (No longer affects execution scoring.)",
  },
  {
    param: "carbsOptimum",
    label: "In-ride fueling optimum (long steady rides)",
    unit: " g/h",
    bounds: CARBS_OPTIMUM_BOUNDS,
    populationDefault: DEFAULT_CARBS_OPTIMUM,
    blurb:
      "The carb intake your best long steady rides carry, learned from rides where you logged fueling in Intervals.icu. Display + coach context — it doesn't change the fueling table yet.",
  },
];

function detail(p: CalibratedParameter | undefined, effective: number): string {
  if (!p || p.source === "default") return "Population default — not enough of your data yet.";
  if (p.manualOverride != null) return "Manually set by you.";
  if (effective === p.value) return `Calibrated from your last ${p.dataPoints} rides · ${p.confidence} confidence${p.locked ? " · locked" : ""}.`;
  return `Learning from ${p.dataPoints} rides — using the default until there's enough to be confident.`;
}

function ParamRow({
  row,
  param,
  onSaved,
}: {
  row: RowConfig;
  param: CalibratedParameter | undefined;
  onSaved: (calibration: CalibrationStore) => void;
}) {
  const effective = resolveCalibratedValue(param ?? null, row.populationDefault);
  const overridden = param?.manualOverride != null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist a set (number) or clear (null) override, then lift the fresh store into shared state so
  // every surface that reads state.calibration reflects it without waiting for the next sync.
  const save = async (manualOverride: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const { calibration } = await api<{ calibration: CalibrationStore }>("/api/calibration", {
        method: "POST",
        body: JSON.stringify({ param: row.param, manualOverride }),
      });
      onSaved(calibration);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save — try again.");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = () => {
    setDraft(effective.toFixed(1));
    setError(null);
    setEditing(true);
  };

  const submit = () => {
    const v = parseFloat(draft);
    // Validate the range here (UI-2) — not just finiteness — so an out-of-range entry shows the error
    // instead of being silently clamped server-side to a value the athlete didn't type.
    if (!Number.isFinite(v) || v < row.bounds.min || v > row.bounds.max) {
      setError(`Enter a number between ${row.bounds.min} and ${row.bounds.max}.`);
      return;
    }
    void save(v);
  };

  return (
    <li className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-700/60">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{row.label}</span>
        <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
          {effective.toFixed(1)}
          {row.unit}
          {overridden && (
            <span className="ml-1 align-middle text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-[#ff49c8]">set</span>
          )}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{row.blurb}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{detail(param, effective)}</p>

      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="number"
            step="0.1"
            min={row.bounds.min}
            max={row.bounds.max}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`${row.label} override`}
            className="w-20 rounded border border-zinc-300 px-2 py-1 font-mono text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
          />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {row.unit.trim() || "%"} · {row.bounds.min}–{row.bounds.max}
          </span>
          <button
            onClick={submit}
            disabled={saving}
            className="rounded-md border border-zinc-300 px-2 py-1 text-[11px] font-medium text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-[#00d4ff]/40 dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            disabled={saving}
            className="text-[11px] text-zinc-500 dark:text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      ) : (
        // S2-2: py-1 gives these text-only links a taller click/tap target without changing the type size.
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <button
            onClick={startEdit}
            className="py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
          >
            {overridden ? "Adjust" : "This looks wrong — set my own"}
          </button>
          {overridden && (
            <button
              onClick={() => void save(null)}
              disabled={saving}
              className="py-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-zinc-300"
            >
              Use learned value
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
    </li>
  );
}

export default function CalibrationPanel() {
  const { state, setState } = useSync();
  const cal = state?.calibration ?? null;
  const onSaved = (calibration: CalibrationStore) => setState((s) => (s ? { ...s, calibration } : s));

  return (
    <Card title="Per-athlete calibration">
      <p className="-mt-1 mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Scoring thresholds the app learns from your own data, with a population default until there&apos;s enough
        history. Updated on each sync — override one only if you know the learned value is wrong for you.
      </p>
      {!cal ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Sync to compute your calibration.</p>
      ) : (
        <ul className="space-y-3">
          {ROWS.map((row) => (
            <ParamRow key={row.param} row={row} param={cal[row.param]} onSaved={onSaved} />
          ))}
        </ul>
      )}
    </Card>
  );
}
