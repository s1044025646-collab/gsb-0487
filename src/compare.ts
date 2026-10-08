import { NUMERIC_THRESHOLDS } from "./constants.js";
import type { C, PropagationReport } from "./types.js";

function closeQ(a: number, b: number): boolean {
  return (
    Math.abs(a - b) <=
    NUMERIC_THRESHOLDS.COMPARE_ABS_TOL +
      NUMERIC_THRESHOLDS.COMPARE_REL_TOL * Math.max(Math.abs(a), Math.abs(b))
  );
}

function closeC(a: C, b: C): boolean {
  return closeQ(a.re, b.re) && closeQ(a.im, b.im);
}

export interface CompareResult {
  sameFinalIntensity: boolean;
  sameLength: boolean;
  earliestDivergenceStep: number | null;
  reason: string;
  finalIntensityA: number;
  finalIntensityB: number;
  stepDeltas: Array<{
    step: number;
    maxAbsFieldDiff: number;
    intensityDiff: number;
    equal: boolean;
  }>;
}

// 固定同一输入比较两条链，逐步定位最早分歧元件
export function compareReports(a: PropagationReport, b: PropagationReport): CompareResult {
  const stepDeltas: CompareResult["stepDeltas"] = [];
  const n = Math.min(a.steps.length, b.steps.length);
  let earliest: number | null = null;

  for (let k = 0; k < n; k++) {
    const sa = a.steps[k]!;
    const sb = b.steps[k]!;
    let maxDiff = 0;
    maxDiff = Math.max(
      maxDiff,
      Math.abs(sa.fieldAfter[0].re - sb.fieldAfter[0].re),
      Math.abs(sa.fieldAfter[0].im - sb.fieldAfter[0].im),
      Math.abs(sa.fieldAfter[1].re - sb.fieldAfter[1].re),
      Math.abs(sa.fieldAfter[1].im - sb.fieldAfter[1].im),
    );
    const intDiff = Math.abs(sa.intensityAfter - sb.intensityAfter);
    const fieldEqual =
      closeC(sa.fieldAfter[0], sb.fieldAfter[0]) && closeC(sa.fieldAfter[1], sb.fieldAfter[1]);
    const equal = fieldEqual && closeQ(sa.intensityAfter, sb.intensityAfter);
    stepDeltas.push({ step: k, maxAbsFieldDiff: maxDiff, intensityDiff: intDiff, equal });
    if (!equal && earliest === null) earliest = k;
  }

  let reason: string;
  if (earliest === null) {
    if (a.steps.length === b.steps.length) {
      reason = "两条链在公共长度内逐步一致，且长度相同，最终复振幅与强度相同";
    } else {
      reason = `两条链在公共的 ${n} 个元件内一致，但链长不同（${a.steps.length} vs ${b.steps.length}）`;
    }
  } else {
    const div: number = earliest;
    const stepA = a.steps[div];
    reason = `最早从第 ${div} 个元件（0 基，${stepA ? stepA.kind : "?"}）作用后开始不同`;
  }

  return {
    sameFinalIntensity: closeQ(a.finalIntensity, b.finalIntensity),
    sameLength: a.steps.length === b.steps.length,
    earliestDivergenceStep: earliest,
    reason,
    finalIntensityA: a.finalIntensity,
    finalIntensityB: b.finalIntensity,
    stepDeltas,
  };
}
