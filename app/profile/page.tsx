import type { Metadata } from "next";
import AthleteProfileForm from "@/components/AthleteProfileForm";
import { ifBandOffsetRows } from "@/lib/calibration";
import { readPhysiology } from "@/lib/physiology";

export const metadata: Metadata = { title: "Athlete Profile — NodeVelo" };

// Read the physiology store at request time so the IF-band view reflects the latest synced zones
// (moved from /model with the effort-bands card — UX v2 §2 ledger: zones are declared data).
export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ifRows = ifBandOffsetRows((await readPhysiology())?.current.powerZonePct ?? []);
  return <AthleteProfileForm ifBandRows={ifRows} />;
}
