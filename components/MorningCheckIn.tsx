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
interface StoredCheck {
  flag: Flag;
  decision: Decision;
  reasons?: string[]; // frozen at flag time; entries written before the field simply lack it
  appliedAt?: string; // set once the downgrade was applied — don't re-offer the Apply button
}
interface CheckState {
  check: StoredCheck | null;
  isQualityDay: boolean;
  hasRideToday: boolean; // any ride planned today (quality or easy)
  suggestion: Suggestion | null;
}
interface SubmitResult {
  decision: Decision;
  reasons: string[];
  suggestion: Suggestion | null;
}

// What the card renders — one shape whether it came from a just-submitted POST or from the stored
// entry on a refreshed page (the refresh path is why this exists: the flag used to vanish on reload).
interface VerdictView {
  flag: Flag | null; // known when re-derived from the stored entry; null right after a POST
  decision: Decision;
  reasons: string[];
  suggestion: Suggestion | null;
  applied: boolean;
  fromStore: boolean; // stored verdicts get a "Change" affordance; a just-submitted one has its own buttons
}

const FLAG_LABEL: Record<Flag, string> = { ill: "feeling ill", "extreme-fatigue": "extreme fatigue", injury: "injured" };

// Proactive "not feeling it?" override (ROADMAP #3, extended by S2-9). Surfaces before the ride is logged,
// on any ride day, with all three flags:
//   • Quality day + ill/extreme-fatigue (metabolic) → a deterministic downgrade → one-tap apply that moves
//     the quality stimulus (athlete-confirmed, like RescheduleBanner).
//   • Easy day + ill/extreme-fatigue → "rest today": skip the volume day — there's nothing to downgrade,
//     and grinding through illness/deep fatigue costs more than the missed volume (see lib/morning-check.ts).
//   • Injury (musculoskeletal), any ride day → "rest today" with no swap and no make-up: the pedaling
//     motion aggravates a strain regardless of intensity.
// The stored flag is re-read on mount, so the verdict survives a refresh; "Change" re-opens the prompt
// (one entry per day — a re-submission replaces it, like a disposition).
export default function MorningCheckIn() {
  const { state, setState } = useSync();
  const [data, setData] = useState<CheckState | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [editing, setEditing] = useState(false); // "Change" on a stored verdict re-opens the prompt
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // The pre-apply card previews a suggestion that can go stale (the block may have changed since it
  // was last fetched — HR-6); after Apply, show the route's own note describing what actually
  // happened instead of silently trusting the preview and vanishing.
  const [appliedNote, setAppliedNote] = useState<string | null>(null);

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

  // mb-2 lives on the component (not a wrapper in Dashboard) so a hidden override leaves no gap.
  const shell = "mb-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900/60";

  // Only relevant before today's session has been ridden.
  const rideLogged = state?.todayAnalysis?.activityDate === localToday();
  if (dismissed || rideLogged) return null;
  if (loadFailed)
    return (
      <div className="mb-2">
        <LoadFailed what="the morning check-in" retry={() => void load()} />
      </div>
    );
  // Show what the PUT actually did — may differ from the pre-apply preview if the block changed
  // since the suggestion was last fetched (HR-6) — instead of silently trusting the stale preview.
  if (appliedNote) {
    return (
      <div className={shell}>
        <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Downgraded — change applied</p>
        <p className="mt-1 text-[11px] leading-snug text-zinc-600 dark:text-zinc-300">{appliedNote}</p>
        <button onClick={() => setDismissed(true)} className="mt-2 text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Got it
        </button>
      </div>
    );
  }
  // Surface on any ride day. A true rest day (no ride planned) has nothing to skip, so stay hidden.
  if (!data || !data.hasRideToday) return null;

  const submit = async (flag: Flag) => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await api<SubmitResult>("/api/morning-check", { method: "POST", body: JSON.stringify({ flag, today: localToday() }) });
      setResult(r);
      setEditing(false);
      void load(); // keep the stored copy in step so a later "Change"/re-render agrees with the server
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
      const r = await api<{ note: string }>("/api/morning-check", { method: "PUT", body: JSON.stringify({ today: localToday() }) });
      const fresh = await api<AppState>("/api/sync"); // refresh so the block calendar reflects the move
      setState(fresh);
      setAppliedNote(r.note); // what actually happened — may differ from the pre-apply preview
    } catch (err) {
      // Surface the server's own message (e.g. a 409's "reload to see the latest" when the block
      // changed mid-apply); only a non-Error failure falls back to the generic retry line.
      setActionError(err instanceof Error && err.message ? err.message : "Couldn't apply the change — try again.");
    } finally {
      setBusy(false);
    }
  };

  // One view model for the verdict card: a just-submitted result wins; otherwise the stored entry
  // (unless the athlete tapped "Change"). The stored path is what survives a page refresh.
  const view: VerdictView | null = result
    ? { flag: null, decision: result.decision, reasons: result.reasons, suggestion: result.suggestion, applied: false, fromStore: false }
    : data.check && !editing
      ? {
          flag: data.check.flag,
          decision: data.check.decision,
          reasons: data.check.reasons ?? [],
          suggestion: data.check.decision === "downgrade" && !data.check.appliedAt ? data.suggestion : null,
          applied: !!data.check.appliedAt,
          fromStore: true,
        }
      : null;

  // ---- Verdict card (post-submit, or re-derived from the stored flag after a refresh) ----
  if (view) {
    const downgrade = view.decision === "downgrade";
    const rest = view.decision === "rest";
    const s = view.suggestion;
    // Heading colour: amber for a downgrade (protect the session), red for rest (stop — don't ride today),
    // emerald for proceed. Heading text is the verdict, not the flag.
    const headingTone = rest ? "text-red-700 dark:text-red-400" : downgrade ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-400";
    const heading = view.applied
      ? "Downgraded — change applied"
      : rest
        ? "Rest today"
        : downgrade
          ? "Downgrade recommended"
          : "You're good — proceed";
    return (
      <div className={shell}>
        <p className={`text-xs font-semibold ${headingTone}`}>
          {heading}
          {view.flag && <span className="ml-1.5 font-normal text-zinc-500 dark:text-zinc-400">(flagged {FLAG_LABEL[view.flag]} this morning)</span>}
        </p>
        {view.reasons.length > 0 && !view.applied && (
          <p className="mt-1 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">{view.reasons.join(" ")}</p>
        )}
        {downgrade && !view.applied && s && (
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
          {downgrade && !view.applied && (
            <button
              onClick={apply}
              disabled={busy}
              // UXA-55: same missing dark: pairing as RescheduleBanner's identical CTA, found on inspection.
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-500 dark:hover:bg-amber-600"
            >
              {busy ? "Applying…" : s?.to ? "Apply downgrade + move" : "Downgrade today"}
            </button>
          )}
          {/* Rest: no "apply" — the verdict IS the action (don't ride). */}
          <button onClick={() => setDismissed(true)} className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
            {rest ? "Got it" : downgrade && !view.applied ? "Proceed anyway" : "Dismiss"}
          </button>
          {view.fromStore && !view.applied && (
            <button
              onClick={() => {
                setResult(null);
                setEditing(true);
              }}
              className="text-xs text-zinc-500 hover:underline dark:text-zinc-400"
            >
              Change
            </button>
          )}
        </div>
        {actionError && <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">{actionError}</p>}
      </div>
    );
  }

  // ---- Collapsed prompt: one-tap flags (all three, on any ride day) ----
  const quality = data.isQualityDay;
  // UXA-46: py-1.5 measured ~30px on a real mobile viewport, under the ~40px touch-target guidance —
  // bumped a step, matching this codebase's own established S2-2 pattern for the same fix elsewhere.
  const btn =
    "shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 transition-colors hover:border-zinc-400 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:border-zinc-500";
  return (
    // UXA-46: was one flat flex-wrap row where the label (flex-1) and 3 shrink-0 buttons competed for
    // space — on a 375px viewport the label got squeezed into a narrow column and wrapped 5 lines.
    // Stacks label above the button group below sm:; unchanged single-row layout from sm: up.
    <div className={`flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5 ${shell}`}>
      <p className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#00d4ff]" />
        <span>
          <span className="font-semibold">{quality ? "Quality session today" : "Ride planned today"}</span> — not feeling it?
        </span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => submit("ill")} disabled={busy} className={btn}>
          Feeling ill
        </button>
        <button onClick={() => submit("extreme-fatigue")} disabled={busy} className={btn}>
          Extreme fatigue
        </button>
        <button onClick={() => submit("injury")} disabled={busy} className={btn}>
          Injured
        </button>
      </div>
      {actionError && <p className="w-full text-[11px] text-red-600 dark:text-red-400">{actionError}</p>}
    </div>
  );
}
