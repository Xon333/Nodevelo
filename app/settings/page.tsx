import BlockSettingsForm from "@/components/BlockSettingsForm";
import BackupRestore from "@/components/BackupRestore";
import AiUsageCard from "@/components/AiUsageCard";
import { readAiUsage } from "@/lib/ai-usage";
import { SectionDivider } from "@/components/ui";

// Read the usage store at request time (it changes as AI calls accrue).
export const dynamic = "force-dynamic";

// h1 "Settings" (S2-5): the old "Block generation settings" undersold the page — it also owns AI
// usage/cost and backup. The generation/platform split now lives in the section dividers instead.
export default async function SettingsPage() {
  const usage = await readAiUsage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Settings</h1>
        <p className="mt-1 text-sm text-zinc-500">Block generation, AI usage, and backup.</p>
      </div>
      <SectionDivider label="Block generation" />
      <BlockSettingsForm />
      <SectionDivider label="Platform" />
      <AiUsageCard usage={usage} />
      <BackupRestore />
    </div>
  );
}
