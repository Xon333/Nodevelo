"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { PrimaryButton, Skeleton, SkeletonScreen } from "./ui";

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
  "cycling_database.md": { text: "Athlete-owned cycling reference notes. The deterministic block compiler does not read this file." },
  "training_knowledge.md": { text: "Athlete-owned training reference notes. The deterministic block compiler does not read this file." },
  "nutrition_knowledge.md": { text: "Athlete-owned nutrition reference notes. The deterministic block compiler does not read this file." },
};

export default function KnowledgeBaseEditor() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [retros, setRetros] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ state: "idle" });
  // S2-7: an in-product confirm banner replaces window.confirm — set instead of switching
  // immediately when there are unsaved changes; the banner below resolves it.
  const [pendingSwitch, setPendingSwitch] = useState<Selection | null>(null);

  const dirty = content !== original;

  const open = async (sel: Selection, force = false) => {
    if (!force && dirty) {
      setPendingSwitch(sel);
      return;
    }
    try {
      const param = sel.kind === "retro" ? `retro=${encodeURIComponent(sel.name)}` : `file=${encodeURIComponent(sel.name)}`;
      const data = await api<{ content: string }>(`/api/knowledge?${param}`);
      setSelected(sel);
      setContent(data.content);
      setOriginal(data.content);
      setSaveState({ state: "idle" });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Couldn't read that file — try again.");
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
        setLoadError(err instanceof Error ? err.message : "Couldn't list your knowledge files — try again.");
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
      setSaveState({ state: "error", message: err instanceof Error ? err.message : "Couldn't save — try again." });
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
    // S3-1: title → file rail + editor pane, matching the loaded two-pane layout (the editor
    // placeholder reserves the textarea's fixed 36rem so nothing jumps when it lands).
    return (
      <SkeletonScreen>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-1.5 h-4 w-96 max-w-full" />
        <div className="mt-4 flex gap-3">
          <div className="w-52 shrink-0 space-y-1.5">
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
          <Skeleton className="h-[36rem] min-w-0 flex-1" />
        </div>
      </SkeletonScreen>
    );
  }

  const isRetro = selected?.kind === "retro";

  const navButton = (sel: Selection, label: string) => {
    const active = selected?.name === sel.name && selected?.kind === sel.kind;
    return (
      <button
        onClick={() => void open(sel)}
        className={`w-full truncate rounded px-3 py-2 text-left text-xs font-medium transition-colors ${
          active
            ? // UXA-18: matches Nav.tsx's own active-link treatment — was a solid white-block
              // inversion in dark mode, a second vocabulary for "selected" next to the accent
              // language used everywhere else.
              "bg-zinc-900 text-white dark:bg-[#ff49c8]/10 dark:text-[#ff49c8] dark:ring-1 dark:ring-[#ff49c8]/40"
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
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Knowledge</h1>
      <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-zinc-400">
        Reference files (cycling / training / nutrition) are your editable notes; <span className="font-medium text-zinc-600 dark:text-zinc-300">athlete_profile.md</span> is legacy manual context — physiology syncs from Intervals.icu and is edited on Profile. Block retrospectives are history records, not planning inputs.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {isRetro
          ? "Block retrospectives. The legacy next_block_seeds list and acknowledgement stamp stay in history; neither changes future generated blocks."
          : "Edits save these reference notes; deterministic block generation uses typed application data instead."}
      </p>
      {pendingSwitch && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/60 dark:bg-amber-950/40">
          <span className="text-xs text-amber-800 dark:text-amber-300">
            Switch files and discard your unsaved changes to {selected?.name}?
          </span>
          <button
            onClick={() => {
              const sel = pendingSwitch;
              setPendingSwitch(null);
              void open(sel, true);
            }}
            className="rounded-md bg-amber-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-700"
          >
            Discard &amp; switch
          </button>
          <button
            onClick={() => setPendingSwitch(null)}
            className="py-1 text-xs text-amber-800 hover:underline dark:text-amber-300"
          >
            Cancel
          </button>
        </div>
      )}
      <div className="mt-4 flex gap-3">
        {/* UXA-42: the 4 reference files are fixed in count, but retrospectives accumulate one per
            completed block with no cap — an independent scroll region (matching the editor pane's
            own fixed height) keeps a long rail from outgrowing the two-pane layout. */}
        <aside className="w-52 shrink-0 max-h-[36rem] overflow-y-auto">
          <ul className="space-y-0.5">
            {files.map((file) => (
              <li key={file}>{navButton({ name: file, kind: "kb" }, file)}</li>
            ))}
          </ul>

          {retros.length > 0 && (
            <>
              <p className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
              {/* UXA-21: <form> wrap for consistency + clean status semantics — Enter itself already
                  inserts a newline in a textarea rather than submitting, so this doesn't change that
                  behavior, just gives Save a proper submit lifecycle. */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void save();
                }}
              >
                <textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (saveState.state === "saved") setSaveState({ state: "idle" });
                  }}
                  aria-label={`Editing ${selected.name}`}
                  spellCheck={false}
                  className="h-[36rem] w-full resize-y rounded-lg border border-zinc-300 bg-white p-4 font-mono text-xs leading-5 text-zinc-800 focus:border-zinc-900 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:focus:border-zinc-400"
                />
                <div className="mt-2 flex items-center gap-3">
                  <PrimaryButton type="submit" disabled={!dirty || saveState.state === "saving"}>
                    {saveState.state === "saving" ? "Saving…" : "Save"}
                  </PrimaryButton>
                  {saveState.state === "saved" && (
                    <span role="status" className="text-xs font-medium text-green-700 dark:text-green-400">✓ Saved</span>
                  )}
                  {saveState.state === "error" && (
                    <span role="alert" className="text-xs text-red-600">{saveState.message}</span>
                  )}
                  <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
                    {content.length.toLocaleString()} chars
                  </span>
                </div>
              </form>
            </>
          ) : (
            <p className="py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">No knowledge base files found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
