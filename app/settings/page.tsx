import BlockSettingsForm from "@/components/BlockSettingsForm";
import BackupRestore from "@/components/BackupRestore";
import AiUsageCard from "@/components/AiUsageCard";
import { readAiUsage } from "@/lib/ai-usage";

// Read the usage store at request time (it changes as AI calls accrue).
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const usage = await readAiUsage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Block generation settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          These parameters are injected into every training block prompt. Changes take effect on the next generation.
        </p>
      </div>
      <BlockSettingsForm />
      <AiUsageCard usage={usage} />
      <BackupRestore />
    </div>
  );
}
