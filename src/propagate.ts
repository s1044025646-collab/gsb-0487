import {
  ALGORITHM_VERSION,
  CONVENTION,
  LIMITS,
  NUMERIC_THRESHOLDS,
} from "./constants.js";
import { identityMat, matMat, matVec } from "./complex.js";
import {
  buildMatrix,
  canonicalAngleDeg,
  effectiveDeltaDeg,
} from "./components.js";
import { intensity, pureStateResidual, stokes } from "./stokes.js";
import type {
  PropagationReport,
  ResolvedComponent,
  StoredComponent,
  StepResult,
  Vec2,
} from "./types.js";
import { JonesError } from "./types.js";

function assertFiniteField(v: Vec2, stepIndex: number): void {
  for (const part of v) {
    if (!Number.isFinite(part.re) || !Number.isFinite(part.im)) {
      throw new JonesError(
        "NUMERIC_OVERFLOW",
        `传播到第 ${stepIndex} 个元件后出现 NaN/Infinity，结果不保存`,
        `components[${stepIndex}]`,
      );
    }
  }
}

function assertIntensity(v: Vec2, stepIndex: number): void {
  const i = intensity(v);
  if (!Number.isFinite(i) || i > LIMITS.INTENSITY_OVERFLOW) {
    throw new JonesError(
      "NUMERIC_OVERFLOW",
      `传播到第 ${stepIndex} 个元件后强度 ${i} 超过溢出阈值 ${LIMITS.INTENSITY_OVERFLOW}`,
      `components[${stepIndex}]`,
    );
  }
}

export interface PropagateArgs {
  inputField: Vec2;
  components: StoredComponent[];
  runId: string;
  experimentId: string;
  configVersion: number;
}

export function propagate(args: PropagateArgs): PropagationReport {
  const { inputField, components } = args;

  const resolved: ResolvedComponent[] = components.map((comp, index) => ({
    ...comp,
    index,
    thetaCanonicalDeg: canonicalAngleDeg(comp.thetaDeg),
    effectiveDeltaDeg: effectiveDeltaDeg(comp.kind, comp.deltaDeg),
    matrix: buildMatrix(comp),
  }));

  const inputStokes = stokes(inputField);
  const inputIntensity = intensity(inputField);

  const steps: StepResult[] = [];
  let field: Vec2 = [
    { ...inputField[0] },
    { ...inputField[1] },
  ];
  let combined = identityMat();

  for (let k = 0; k < resolved.length; k++) {
    const rc = resolved[k]!;
    const fieldBefore: Vec2 = [{ ...field[0] }, { ...field[1] }];
    const stokesBefore = stokes(fieldBefore);
    const intensityBefore = intensity(fieldBefore);

    // 关键：按实际顺序 J_k ... J_1 E，且绝不中途归一化
    const fieldAfter = matVec(rc.matrix, field);
    assertFiniteField(fieldAfter, k);
    assertIntensity(fieldAfter, k);

    const stokesAfter = stokes(fieldAfter);
    const intensityAfter = intensity(fieldAfter);

    const isRetarder = rc.kind !== "polarizer";
    const retarderLoss = isRetarder ? Math.abs(intensityAfter - intensityBefore) : null;

    steps.push({
      index: k,
      kind: rc.kind,
      label: rc.label,
      thetaDeg: rc.thetaDeg,
      thetaCanonicalDeg: rc.thetaCanonicalDeg,
      deltaDeg: rc.deltaDeg,
      effectiveDeltaDeg: rc.effectiveDeltaDeg,
      fieldBefore,
      matrix: rc.matrix,
      fieldAfter: [{ ...fieldAfter[0] }, { ...fieldAfter[1] }],
      stokesBefore,
      stokesAfter,
      intensityBefore,
      intensityAfter,
      intensityRatio:
        intensityBefore > NUMERIC_THRESHOLDS.DISPLAY_ZERO_EPS * NUMERIC_THRESHOLDS.DISPLAY_ZERO_EPS
          ? intensityAfter / intensityBefore
          : null,
      pureStateResidual: pureStateResidual(stokesAfter),
      retarderLoss,
    });

    field = fieldAfter;
    // 组合矩阵按作用顺序累积：combined_new = J_k * combined_old
    combined = matMat(rc.matrix, combined);
  }

  const finalStokes = stokes(field);

  return {
    algorithmVersion: ALGORITHM_VERSION,
    convention: { ...CONVENTION },
    runId: args.runId,
    experimentId: args.experimentId,
    configVersion: args.configVersion,
    inputField: [{ ...inputField[0] }, { ...inputField[1] }],
    inputStokes,
    inputIntensity,
    components: resolved,
    steps,
    finalField: field,
    finalStokes,
    finalIntensity: intensity(field),
    combinedMatrix: combined,
    chainLength: components.length,
    identityChain: components.length === 0,
  };
}
