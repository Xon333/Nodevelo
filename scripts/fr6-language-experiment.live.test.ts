import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import {
  executeFr6Experiment,
  projectTwoWeekCost,
  resolveFr6EvidenceDirectory,
  type AccountedExperimentResult,
} from "./fr6-language-experiment";
import { FR6_CASES } from "./fr6-language-fixtures";
import {
  FR6_CANDIDATES,
  runProviderCase,
} from "./fr6-language-providers";

const LIVE_ENABLED = process.env.FR6_RUN_LIVE === "1";
describe.skipIf(!LIVE_ENABLED)("FR-6 fixed-input live provider matrix", () => {
  it("runs available candidates within the fixed spend cap and persists evidence", async () => {
    const evidenceDirectory = resolveFr6EvidenceDirectory(
      process.cwd(),
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    );
    const run = await executeFr6Experiment({
      evidenceDirectory,
      candidates: FR6_CANDIDATES,
      cases: FR6_CASES,
      env: process.env,
      runCase: (candidate, fixture) =>
        runProviderCase(candidate, fixture, { env: process.env }),
    });
    printResultTable(run.artifact.results);

    expect(
      run.stoppedBefore,
      `Fixed $2 experiment cap stopped before ${run.stoppedBefore?.model}/${run.stoppedBefore?.caseId}`,
    ).toBeNull();
    expect(
      run.capExceeded,
      "Accounted spend exceeded the fixed $2 experiment cap",
    ).toBe(false);
  }, 1_800_000);
});

function printResultTable(results: AccountedExperimentResult[]): void {
  console.table(
    results.map((result) => {
      const candidateResults = results.filter(
        (row) =>
          row.provider === result.provider && row.model === result.model,
      );
      const projected = projectTwoWeekCost(candidateResults, 11);
      return {
        provider: result.provider,
        model: result.model,
        case: result.caseId,
        status: result.status,
        latencyMs: Math.round(result.latencyMs),
        schema: result.schemaValid ? "valid" : "invalid",
        unsupported: result.unsupportedClaims.length,
        requestCostUsd: result.costUsd.toFixed(6),
        accountedCostUsd: result.accountedCostUsd.toFixed(6),
        accounting: result.costAccounting,
        projectedTwoWeekUsd: Number.isFinite(projected)
          ? projected.toFixed(6)
          : "unavailable",
      };
    }),
  );
}
