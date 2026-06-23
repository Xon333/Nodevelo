"use client";

import { useState } from "react";
import { useSync } from "./SyncProvider";
import { Card } from "./ui";
import { api } from "@/lib/client-api";
import { resolveCalibratedValue } from "@/lib/calibration";
import { DEFAULT_DECOUPLING_GOOD } from "@/lib/execution-score";
import type { CalibratedParameter, CalibrationStore } from "@/lib/types";

// Per-athlete calibration (ROADMAP #2) — shows the effective value the scorer uses + its provenance,
// so the athlete sees what's been learned from their own data vs. the population default, AND can
// contest/correct it: a manual override is the escape hatch when the learned value is wrong. The next
// sync preserves the override (deriveDecouplingGood reads prior.manualOverride).

function detail(p: CalibratedParameter | undefined, effective: number): string {
  if (!p || p.source === "default") return "Population default — not enough of your data yet.";
  if (p.manualOverride != null) return "Manually set by you.";
  if (effective === p.value) return `Calibrated from your last ${p.dataPoints} rides · ${p.confidence} confidence${p.locked ? " · locked" : ""}.`;
  return `Learning from ${p.dataPoints} rides — using the default until there's enough to be confident.`;
}

export default function CalibrationPanel() {
  const { state, setState } = useSync();
  const cal = state?.calibration ?? null;
  const dg = cal?.decouplingGood;
  const effective = resolveCalibratedValue(dg ?? null, DEFAULT_DECOUPLING_GOOD);
  const overridden = dg?.manualOverride != null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist a set (number) or clear (null) override, then update shared state so every surface that
  // reads state.calibration reflects it without waiting for the next sync.
  const save = async (manualOverride: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const { calibration } = await api<{ calibration: CalibrationStore }>("/api/calibration", {
        method: "POST",
        body: JSON.stringify({ param: "decouplingGood", manualOverride }),
      });
      setState((s) => (s ? { ...s, calibration } : s));
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
    if (!Number.isFinite(v)) {
      setError("Enter a number between 2.5 and 8.");
      return;
    }
    void save(v);
  };

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
          <li className="border-t border-zinc-100 pt-3 first:border-t-0 first:pt-0 dark:border-zinc-700/60">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Decoupling &ldquo;good&rdquo; cutoff</span>
              <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100">
                {effective.toFixed(1)}%
                {overridden && (
                  <span className="ml-1 align-middle text-[10px] font-normal uppercase tracking-wide text-zinc-500 dark:text-[#ff49c8]">set</span>
                )}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              Aerobic drift below this scores well; the bands recenter on your own typical decoupling.
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">{detail(dg, effective)}</p>

            {editing ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.1"
                  min={2.5}
                  max={8}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Decoupling good cutoff override (%)"
                  className="w-20 rounded border border-zinc-300 px-2 py-1 font-mono text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:focus:border-zinc-400"
                />
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">% · 2.5–8</span>
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
                  className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap items-center gap-3">
                <button
                  onClick={startEdit}
                  className="text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-[#00d4ff]"
                >
                  {overridden ? "Adjust" : "This looks wrong — set my own"}
                </button>
                {overridden && (
                  <button
                    onClick={() => void save(null)}
                    disabled={saving}
                    className="text-[11px] text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:text-zinc-300"
                  >
                    Use learned value
                  </button>
                )}
              </div>
            )}
            {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
          </li>
        </ul>
      )}
    </Card>
  );
}
