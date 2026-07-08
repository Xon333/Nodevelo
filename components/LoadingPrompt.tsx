"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { LoadFailed, useMountLoad } from "./ui";

interface Prompt { kind: "pre-ask" | "retro-ask"; rideDate: string; template: string; targetG: number }
interface LoadingState { prompt: Prompt | null }

// Track C loading chip: the day before a durability long ride, prescribe the loading target; on the
// ride day (if unanswered), ask whether loading happened. One tap either way — the answer is the
// loading loop's input. Deterministic copy; no LLM involvement.
export default function LoadingPrompt() {
  const [state, setState] = useState<LoadingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<"loaded" | "skipped" | null>(null);

  // useMountLoad only fires the effect — it owns no failed/retry state (unlike the brief's sketch),
  // so this component tracks `failed` itself and re-runs the same stable `load` as the retry, mirroring
  // MorningCheckIn's convention.
  const load = useCallback(async () => {
    try {
      setState(await api<LoadingState>(`/api/loading?today=${localToday()}`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);
  useMountLoad(load);

  if (failed) return <LoadFailed what="the carb-loading prompt" retry={() => void load()} />;
  if (done || !state?.prompt) return null; // answered this mount (chip collapses) or nothing to ask
  const p = state.prompt;

  const respond = async (response: "loaded" | "skipped") => {
    setSaving(true);
    try {
      // Controller adjudication: POST body is { rideDate, response } only — the route ignores `today`.
      await api("/api/loading", { method: "POST", body: JSON.stringify({ rideDate: p.rideDate, response }) });
      setDone(response);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-md bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
      <p className="min-w-0 flex-1 text-xs text-zinc-600 dark:text-zinc-300">
        {p.kind === "pre-ask" ? (
          <>
            Long durability ride tomorrow (template {p.template}) — load today:{" "}
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">~{p.targetG} g carbs</span>. Did
            you?
          </>
        ) : (
          <>
            Did you carb-load yesterday (~
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-100">{p.targetG} g</span>) for
            today&apos;s long ride (template {p.template})?
          </>
        )}
      </p>
      <span className="inline-flex shrink-0 gap-2">
        <button
          disabled={saving}
          onClick={() => void respond("loaded")}
          className="rounded border border-[#ff49c8]/60 px-2 py-0.5 text-xs font-semibold text-[#ff49c8] transition-colors hover:border-[#ff49c8] disabled:opacity-50"
        >
          Loaded ✓
        </button>
        <button
          disabled={saving}
          onClick={() => void respond("skipped")}
          className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-semibold text-zinc-600 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500"
        >
          Didn&apos;t
        </button>
      </span>
    </div>
  );
}
