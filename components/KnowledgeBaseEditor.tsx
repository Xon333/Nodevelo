"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";

type SaveState = { state: "idle" | "saving" | "saved" } | { state: "error"; message: string };
type Kind = "kb" | "retro";
type Selection = { name: string; kind: Kind };

// Per-file guidance shown above the editor so it's obvious what each file owns — and, for the
// athlete profile, which fields are manual vs. synced from Intervals.icu (edited elsewhere).
const FILE_HINTS: Record<string, { text: string; accent?: boolean }> = {
  "athlete_profile.md": {
    text: "Manual input — your durable context (personal data, all-time PRs, weakpoints, goals, notes). FTP, training zones, body weight, the 84-day power curve and fitness (CTL/ATL/TSB) are synced from Intervals.icu and edited on the Profile page, not here.",
    accent: true,
  },
  "cycling_database.md": { text: "Reference knowledge, injected into every generation prompt." },
  "training_knowledge.md": { text: "Reference knowledge, injected into every generation prompt." },
  "nutrition_knowledge.md": { text: "Reference knowledge, injected into every generation prompt." },
};

export default function KnowledgeBaseEditor() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [retros, setRetros] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });

  const dirty = content !== original;

  const open = async (sel: Selection, force = false) => {
    if (!force && dirty && !window.confirm("Discard unsaved changes?")) return;
    try {
      const param = sel.kind === "retro" ? `retro=${encodeURIComponent(sel.name)}` : `file=${encodeURIComponent(sel.name)}`;
      const data = await api<{ content: string }>(`/api/knowledge?${param}`);
      setSelected(sel);
      setContent(data.content);
      setOriginal(data.content);
      setSaveState({ state: "idle" });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to read file");
    }
  };

  // Mount: list KB files + retrospectives, then open the first file. `open` is declared above so
  // the effect doesn't reference it before its declaration.
  useEffect(() => {
    (async () => {
      try {
        const { files, retrospectives } = await api<{ files: string[]; retrospectives: string[] }>("/api/knowledge");
        setFiles(files);
        setRetros(retrospectives ?? []);
        if (files.length > 0) void open({ name: files[0], kind: "kb" }, true);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to list files");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!selected) return;
    setSaveState({ state: "saving" });
    try {
      const body = selected.kind === "retro" ? { retro: selected.name, content } : { file: selected.name, content };
      await api("/api/knowledge", { method: "PUT", body: JSON.stringify(body) });
      setOriginal(content);
      setSaveState({ state: "saved" });
    } catch (err) {
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Save failed" });
    }
  };

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
        {loadError}
      </div>
    );
  }
  if (files === null) {
    return <p className="py-12 text-center text-sm text-zinc-400">Loading…</p>;
  }

  const isRetro = selected?.kind === "retro";

  const navButton = (sel: Selection, label: string) => {
    const active = selected?.name === sel.name && selected?.kind === sel.kind;
    return (
      <button
        onClick={() => void open(sel)}
        className={`w-full truncate rounded px-3 py-2 text-left text-xs font-medium transition-colors ${
          active
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
        }`}
        title={label}
      >
        {label}
        {active && dirty ? " ●" : ""}
      </button>
    );
  };

  return (
    <div>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Knowledge base</h1>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isRetro
          ? "Block retrospectives. Editing the next_block_seeds list steers the next generated block."
          : "Injected into every generation prompt. Edits apply immediately to the next generation."}
      </p>
      <div className="mt-4 flex gap-3">
        <aside className="w-52 shrink-0">
          <ul className="space-y-0.5">
            {files.map((file) => (
              <li key={file}>{navButton({ name: file, kind: "kb" }, file)}</li>
            ))}
          </ul>

          {retros.length > 0 && (
            <>
              <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Block retrospectives
              </p>
              <ul className="space-y-0.5">
                {retros.map((r) => (
                  <li key={r}>{navButton({ name: r, kind: "retro" }, r.replace(/\.md$/, ""))}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
        <div className="min-w-0 flex-1">
          {selected ? (
            <>
              {!isRetro && FILE_HINTS[selected.name] && (
                <div
                  className={`mb-2 rounded-md border px-3 py-2 text-xs leading-5 ${
                    FILE_HINTS[selected.name].accent
                      ? "border-cyan-200 bg-cyan-50 text-cyan-900 dark:border-[#00d4ff]/40 dark:bg-[#00d4ff]/10 dark:text-[#7fe7ff]"
                      : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  {FILE_HINTS[selected.name].text}
                </div>
              )}
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  if (saveState.state === "saved") setSaveState({ state: "idle" });
                }}
                spellCheck={false}
                className="h-[36rem] w-full resize-y rounded-lg border border-zinc-300 bg-white p-4 font-mono text-xs leading-5 text-zinc-800 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-400"
              />
              <div className="mt-2 flex items-center gap-3">
                <button
                  onClick={save}
                  disabled={!dirty || saveState.state === "saving"}
                  className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white dark:disabled:bg-zinc-700 dark:disabled:text-zinc-400"
                >
                  {saveState.state === "saving" ? "Saving…" : "Save"}
                </button>
                {saveState.state === "saved" && (
                  <span className="text-xs font-medium text-green-700 dark:text-green-400">✓ Saved</span>
                )}
                {saveState.state === "error" && (
                  <span className="text-xs text-red-600">{saveState.message}</span>
                )}
                <span className="ml-auto text-xs text-zinc-400 dark:text-zinc-500">
                  {content.length.toLocaleString()} chars
                </span>
              </div>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-zinc-400">No knowledge base files found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
