"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/client-api";
import { localToday } from "@/lib/date";
import { useSync, type AppState } from "./SyncProvider";
import { LoadFailed, useMountLoad } from "./ui";

type Flag = "ill" | "extreme-fatigue" | "injury";
type Decision = "proceed" | "downgrade" | "rest";
interface Suggestion {
  from: string;
  fromName: string;
  fromType: string;
  to: string | null;
  skippedRestDay: string | null;
}
interface CheckState {
  check: { flag: Flag; decision: Decision } | null;
  isQualityDay: boolean;
  hasRideToday: boolean; // any ride planned today (quality or easy) — injury can be reported on any ride day
  suggestion: Suggestion | null;
}
interface SubmitResult {
  decision: Decision;
  reasons: string[];
  suggestion: Suggestion | null;
}

// Proactive "not feeling it?" override (ROADMAP #3, extended by S2-9). Surfaces before the ride is logged,
// on any ride day:
//   • Quality day → the ill / extreme-fatigue flags (metabolic) → a deterministic downgrade → one-tap apply
//     that moves the quality stimulus (athlete-confirmed, like RescheduleBanner).
//   • Any ride day (quality OR easy) → the injury flag (musculoskeletal) → a "rest today" verdict with no
//     swap and no make-up: the pedaling motion aggravates a strain regardless of intensity, so moving the
//     session onto an easy day doesn't help (see lib/morning-check.ts). This is informational, not a
//     scheduling action — the athlete just skips today, and sees a professional if it persists.
// Objective fatigue is handled by the readiness signal; this is the manual override for "I feel worse than
// the load model can see."
export default function MorningCheckIn() {
  const { state, setState } = useSync();
  const [data, setData] = useState<CheckState | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<CheckState>(`/api/morning-check?today=${localToday()}`);
      setData(r);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true); // visible failure (S1-3) — quiet absence would hide a broken endpoint
    }
  }, []);

  useMountLoad(load);

  // Only relevant before today's session has been ridden.
  const rideLogged = state?.todayAnalysis?.activityDate === localToday();
  if (dismissed || rideLogged) return null;
  if (loadFailed)
    return (
      <div className="mb-2">
        <LoadFailed what="the morning check-in" retry={() => void load()} />
      </div>
    );
  // Surface on any ride day: a quality day gets the full set of flags; a non-quality ride day still gets the
  // injury flag (S2-9). A true rest day (no ride planned) has nothing to skip, so stay hidden.
  if (!data || !data.hasRideToday) return null;

  const submit = async (flag: Flag) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<SubmitResult>("/api/morning-check", { method: "POST", body: JSON.stringify({ flag, today: localToday() }) });
      setResult(r);
    } catch {
      setActionError("Couldn't submit — try again.");
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api("/api/morning-check", { method: "PUT", body: JSON.stringify({ today: localToday() }) });
      const fresh = await api<AppState>("/api/sync"); // refresh so the block calendar reflects the move
      setState(fresh);
      setDismissed(true);
    } catch {
      setActionError("Couldn't apply the change — try again.");
    } finally {
      setBusy(false);
    }
  };

  // mb-2 lives on the component (not a wrapper in Dashboard) so a hidden override leaves no gap.
  const shell = "mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/60";

  // ---- After flagging: the verdict + (for a downgrade) the proposed move ----
  if (result) {
    const downgrade = result.decision === "downgrade";
    const rest = result.decision === "rest"; // injury → skip today, no scheduling action
    const s = result.suggestion;
    // Heading colour: amber for a downgrade (protect the session), red for rest (stop — injury), emerald for
    // proceed. Heading text is the verdict, not the flag.
    const headingTone = rest ? "text-red-700 dark:text-red-400" : downgrade ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400";
    const heading = rest ? "Rest today" : downgrade ? "Downgrade recommended" : "You're good — proceed";
    return (
      <div className={shell}>
        <p className={`text-xs font-semibold ${headingTone}`}>{heading}</p>
        {result.reasons.length > 0 && (
          <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{result.reasons.join(" ")}</p>
        )}
        {downgrade && s && (
          <p className="mt-1.5 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">
            {s.to ? (
              <>
                Move your {s.fromType} ({s.fromName}) to <span className="font-medium">{s.to}</span> — swap it with that day&apos;s easy ride.
              </>
            ) : s.skippedRestDay ? (
              <>
                There&apos;s a rest day on <span className="font-medium">{s.skippedRestDay}</span>, but moving a hard session there
                would add load while you&apos;re compromised — today deloads to recovery and your {s.fromType} carries to the next block.
              </>
            ) : (
              <>No make-up slot left this block — today deloads to recovery and it&apos;s a priority next block.</>
            )}
          </p>
        )}
        <div className="mt-2 flex items-center gap-2">
          {downgrade && (
            <button
              onClick={apply}
              disabled={busy}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Applying…" : s?.to ? "Apply downgrade + move" : "Downgrade today"}
            </button>
          )}
          {/* Injury: no "apply" — there's nothing to move. The verdict IS the action (don't ride). Just an
              acknowledge that dismisses the prompt. */}
          <button onClick={() => setDismissed(true)} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
            {rest ? "Got it" : downgrade ? "Proceed anyway" : "Dismiss"}
          </button>
        </div>
        {actionError && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{actionError}</p>}
      </div>
    );
  }

  // ---- Collapsed prompt: one-tap flags ----
  // A quality day gets all three flags with the "not feeling it?" framing. A non-quality ride day gets only
  // the injury flag (ill/extreme-fatigue don't downgrade an easy day — there's no hard stimulus to protect),
  // with copy that doesn't claim a "quality session" it isn't (Constitution §7: no lying labels).
  const quality = data.isQualityDay;
  const btn =
    "shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${shell}`}>
      <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-[#00d4ff]" />
      <p className="min-w-0 flex-1 text-xs text-zinc-700 dark:text-zinc-300">
        {quality ? (
          <>
            <span className="font-semibold">Quality session today</span> — not feeling it?
          </>
        ) : (
          <>
            <span className="font-semibold">Ride planned today</span> — something hurting?
          </>
        )}
      </p>
      {quality && (
        <>
          <button onClick={() => submit("ill")} disabled={busy} className={btn}>
            Feeling ill
          </button>
          <button onClick={() => submit("extreme-fatigue")} disabled={busy} className={btn}>
            Extreme fatigue
          </button>
        </>
      )}
      <button onClick={() => submit("injury")} disabled={busy} className={btn}>
        Injured
      </button>
      {actionError && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{actionError}</p>}
    </div>
  );
}
