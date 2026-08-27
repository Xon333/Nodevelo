import { Card } from "./ui";
import type { AiUsageStore, AiUsageTotals } from "@/lib/ai-usage";

// Presentational (server-rendered): shows running Anthropic token spend from data/ai-usage.json.
// Read on the Settings page and passed in — no client fetch.

const fmtInt = (n: number) => n.toLocaleString("en-US");
// Sub-cent costs are common (a single haiku ask is ~$0.0003), so show enough precision to be useful.
const fmtUsd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-sm text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="font-mono text-sm text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );
}

function totalsBlock(t: AiUsageTotals) {
  return (
    <>
      <Row label="Calls" value={fmtInt(t.calls)} />
      <Row label="Input tokens (uncached)" value={fmtInt(t.inputTokens)} />
      <Row label="Cache read / write" value={`${fmtInt(t.cacheReadTokens)} / ${fmtInt(t.cacheWriteTokens)}`} />
      <Row label="Output tokens" value={fmtInt(t.outputTokens)} />
    </>
  );
}

export default function AiUsageCard({ usage }: { usage: AiUsageStore }) {
  const models = Object.entries(usage.byModel).sort((a, b) => b[1].costUsd - a[1].costUsd);
  const hasData = usage.total.calls > 0;

  return (
    // UXA-56: was a hand-rolled title+value header instead of Card's own title/action slots.
    <Card
      title="AI usage & cost"
      action={
        <span className="font-mono text-lg font-bold text-zinc-900 dark:text-[#ff49c8]">
          {fmtUsd(usage.total.costUsd)}
        </span>
      }
    >
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Estimated running Anthropic spend across block generation, ride analysis, prose retrospectives,
        and structured retrospectives.
      </p>

      {!hasData ? (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">No AI calls recorded yet.</p>
      ) : (
        <div className="mt-3 space-y-4">
          <div className="border-t border-zinc-100 pt-2 dark:border-zinc-700/60">{totalsBlock(usage.total)}</div>
          {models.map(([model, t]) => (
            <div key={model} className="border-t border-zinc-100 pt-2 dark:border-zinc-700/60">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                  {model}
                </span>
                <span className="font-mono text-sm text-zinc-700 dark:text-zinc-300">{fmtUsd(t.costUsd)}</span>
              </div>
              {totalsBlock(t)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
