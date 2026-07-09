import CalibrationPanel from "@/components/CalibrationPanel";
import StandingGuidance from "@/components/StandingGuidance";
import StateDriversCard from "@/components/StateDriversCard";
import { SectionDivider } from "@/components/ui";

// The "what the second brain knows" page — three stacked groups (UX v2 §6): NOW (the fused state +
// its ranked drivers as magnitude bars — the same data Today's "why? →" links to), LEARNED
// (per-athlete calibration, contest/correct inline), STANDING GUIDANCE (the directives' sole owner,
// structured lines instead of a text blob). Bars and lines, not paragraphs.
export default function ModelPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Your coaching model</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          What the second brain has learned about you, and why it decides what it does — read it, and
          correct it where it&apos;s wrong.
        </p>
      </div>
      <section className="space-y-3">
        <SectionDivider label="Now — what drives your state" />
        <StateDriversCard />
      </section>
      <section className="space-y-3">
        <SectionDivider label="Learned — per-athlete calibration" />
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Thresholds learned from your own data, with a population default until there&apos;s enough
          history. Updated each sync — override one only if you know the learned value is wrong for you.
        </p>
        <CalibrationPanel />
      </section>
      <section className="space-y-3">
        <SectionDivider label="Standing guidance — what the coach keeps telling you" />
        <StandingGuidance />
      </section>
    </div>
  );
}
