import { Card } from "./ui";

// Static privacy disclosure: local persistence and remote AI processing stay separate.
export default function DataPrivacyCard() {
  return (
    <Card title="Data & privacy">
      <ul className="list-disc space-y-1.5 pl-4 text-sm text-zinc-500 dark:text-zinc-400">
        <li>
          <strong className="text-zinc-700 dark:text-zinc-200">Stored locally.</strong> Scores,
          plans, notes, settings, and the knowledge base live as JSON and markdown files on this
          machine. There is no cloud database; backups are exported files.
        </li>
        <li>
          <strong className="text-zinc-700 dark:text-zinc-200">Processed remotely by Anthropic.</strong>{" "}
          The three remote call categories are the ride-analysis coach note, prose retrospectives,
          and structured retrospectives. Per-call spend is tracked under AI usage &amp; cost. Intent
          parsing and block generation are deterministic and do not contact Anthropic.
        </li>
        <li>
          Everything else — scoring, nutrition, readiness, scheduling, and backup — runs without
          Anthropic. Intervals.icu is a one-way pull and the system of record; accepted plans mirror
          to its calendar.
        </li>
      </ul>
    </Card>
  );
}
