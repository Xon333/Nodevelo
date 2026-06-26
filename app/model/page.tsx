import CalibrationPanel from "@/components/CalibrationPanel";
import CoachDirectivesCard from "@/components/CoachDirectivesCard";
import StateDriversCard from "@/components/StateDriversCard";
import IfBandOffsets from "@/components/IfBandOffsets";
import { ifBandOffsetRows } from "@/lib/calibration";
import { readPhysiology } from "@/lib/physiology";

// Read the physiology store at request time so the IF-band view reflects the latest synced zones.
export const dynamic = "force-dynamic";

// The "what the second brain knows" page (ROADMAP #2 / anti-black-box). Aggregates the model state the
// coach reasons from — what it thinks of you now (+ why), the standing directives (+ track record), and
// what it has learned to calibrate. Read-only for now; contest/correct (manual override) lands next.
export default async function ModelPage() {
  const ifRows = ifBandOffsetRows((await readPhysiology())?.current.powerZonePct ?? []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Your coaching model</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          What the second brain has learned about you, and why it decides what it does — read it, and
          correct it where it&apos;s wrong.
        </p>
      </div>
      <StateDriversCard />
      <CoachDirectivesCard />
      <CalibrationPanel />
      <IfBandOffsets rows={ifRows} />
    </div>
  );
}
