"use client";

import { useState } from "react";
import { api } from "@/lib/client-api";
import { Zone } from "./ui";

// Low-token spot-check box: a single free-text question about today's session (the athlete
// types any context, e.g. weather, inline). Sends only today's plan + the question to a cheap
// model — no history — so it's fast and near-free. Stateless: each ask is independent.
export default function AskCoach() {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await api<{ answer: string }>("/api/ask", { method: "POST", body: JSON.stringify({ query: q }) });
      setAnswer(res.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Zone title="Ask coach" hint="quick spot-check · today only">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            }
          }}
          placeholder="wet & cold out — hill threshold or the trainer?"
          className="min-w-0 flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:placeholder-zinc-500 dark:focus:border-zinc-400"
        />
        <button
          onClick={ask}
          disabled={loading || !query.trim()}
          className="shrink-0 rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:border dark:border-[#00d4ff]/50 dark:bg-transparent dark:text-[#00d4ff] dark:hover:bg-[#00d4ff]/10 dark:disabled:border-zinc-700 dark:disabled:text-zinc-600"
        >
          {loading ? "…" : "Ask"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {answer && (
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-line text-xs leading-5 text-zinc-700 dark:text-zinc-300">
          {answer}
        </p>
      )}
    </Zone>
  );
}
