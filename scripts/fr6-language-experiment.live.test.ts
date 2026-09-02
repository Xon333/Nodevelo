import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  atomicWriteJson,
  blindReviewRows,
  buildRunPlan,
  evaluateHardGates,
  projectTwoWeekCost,
  resolveFr6EvidenceDirectory,
  type ExperimentResult,
} from "./fr6-language-experiment";
import { FR6_CASES } from "./fr6-language-fixtures";
import {
  FR6_CANDIDATES,
  runProviderCase,
} from "./fr6-language-providers";

const LIVE_ENABLED = process.env.FR6_RUN_LIVE === "1";
const BLIND_SEED = "fr6-fixed-input-v1";

describe.skipIf(!LIVE_ENABLED)("FR-6 fixed-input live provider matrix", () => {
  it("runs available candidates within the fixed spend cap and persists evidence", async () => {
    const results: ExperimentResult[] = [];
    let stoppedBefore: ReturnType<typeof buildRunPlan>["stoppedBefore"] = null;
    let capExceeded = false;

    while (true) {
      const plan = buildRunPlan(
        FR6_CANDIDATES,
        FR6_CASES,
        process.env,
        results,
      );
      for (const missing of plan.missingCredentialResults) {
        results.push(missing);
      }
      if (plan.capExceeded) {
        capExceeded = true;
        break;
      }
      if (plan.stoppedBefore !== null) {
        stoppedBefore = plan.stoppedBefore;
        break;
      }
      if (plan.nextRequest === null) break;

      const candidate = FR6_CANDIDATES.find(
        ({ provider, model }) =>
          provider === plan.nextRequest?.provider &&
          model === plan.nextRequest.model,
      );
      const fixture = FR6_CASES.find(
        ({ id }) => id === plan.nextRequest?.caseId,
      );
      if (candidate === undefined || fixture === undefined) {
        throw new Error("FR-6 run plan referenced an unknown candidate or case");
      }

      results.push(
        await runProviderCase(candidate, fixture, { env: process.env }),
      );
    }

    const evidenceDirectory = resolveFr6EvidenceDirectory(
      process.cwd(),
      execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: process.cwd(),
        encoding: "utf8",
      }),
    );
    const generatedResults = results.filter(
      ({ status, output }) =>
        output.length > 0 &&
        status !== "missing-credential" &&
        status !== "request-failed",
    );
    const blinded = blindReviewRows(generatedResults, BLIND_SEED).sort(
      (left, right) => left.blindId.localeCompare(right.blindId),
    );
    const resultArtifact = {
      generatedAt: new Date().toISOString(),
      measuredCostUsd: results.reduce((sum, row) => sum + row.costUsd, 0),
      capExceeded,
      stoppedBefore,
      candidates: FR6_CANDIDATES.map(({ provider, model }) => {
        const rows = results.filter(
          (row) => row.provider === provider && row.model === model,
        );
        return {
          provider,
          model,
          hardGates: evaluateHardGates(rows),
        };
      }),
      results,
    };

    await atomicWriteJson(join(evidenceDirectory, "results.json"), resultArtifact);
    await atomicWriteJson(join(evidenceDirectory, "blind-review.json"), blinded);
    printResultTable(results);

    expect(
      stoppedBefore,
      `Fixed $2 experiment cap stopped before ${stoppedBefore?.model}/${stoppedBefore?.caseId}`,
    ).toBeNull();
    expect(capExceeded, "Measured spend exceeded the fixed $2 experiment cap").toBe(
      false,
    );
  }, 1_800_000);
});

function printResultTable(results: ExperimentResult[]): void {
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
        projectedTwoWeekUsd: Number.isFinite(projected)
          ? projected.toFixed(6)
          : "unavailable",
      };
    }),
  );
}
