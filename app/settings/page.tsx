import BlockSettingsForm from "@/components/BlockSettingsForm";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Block generation settings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          These parameters are injected into every training block prompt. Changes take effect on the next generation.
        </p>
      </div>
      <BlockSettingsForm />
    </div>
  );
}
