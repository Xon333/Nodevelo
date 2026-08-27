import BlockSettingsForm from "@/components/BlockSettingsForm";
import PlatformBehaviorForm from "@/components/PlatformBehaviorForm";
import BackupRestore from "@/components/BackupRestore";
import AiUsageCard from "@/components/AiUsageCard";
import DataPrivacyCard from "@/components/DataPrivacyCard";
import { readAiUsage } from "@/lib/ai-usage";
import { SectionDivider } from "@/components/ui";

// Read the usage store at request time (it changes as AI calls accrue).
export const dynamic = "force-dynamic";

// h1 "Settings" (S2-5): the page owns generation knobs, platform behaviour, AI usage/cost, and backup.
// The GENERATION / PLATFORM split lives in the section dividers (UX v2 §6 Settings); "Platform behavior"
// now renders under the PLATFORM divider (was mis-grouped inside the generation form).
export default async function SettingsPage() {
  const usage = await readAiUsage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Block generation, platform behaviour, AI usage, and backup.</p>
      </div>
      <SectionDivider label="Generation" />
      <BlockSettingsForm />
      <SectionDivider label="Platform" />
      <PlatformBehaviorForm />
      <AiUsageCard usage={usage} />
      <DataPrivacyCard />
      <BackupRestore />
    </div>
  );
}
