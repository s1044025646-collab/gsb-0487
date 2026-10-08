import { C } from "./complex";
import {
  ElementSpec, ResolvedElement, Mat2, IDENT, Stokes,
  validateChain, validateElement, validateField, elementMatrix,
  matVec, matMul, stokes, assertFiniteField, EPS,
  ALGORITHM_VERSION, CONVENTION,
} from "./jones";

export interface StepResult {
  index: number;
  element: ResolvedElement;
  matrix: Mat2;
  input: [C, C];
  output: [C, C];
  inputIntensity: number;
  outputIntensity: number;
  stokes: Stokes;
}

export interface PropagationResult {
  algorithmVersion: string;
  convention: typeof CONVENTION;
  eps: number;
  input: [C, C];
  inputStokes: Stokes;
  steps: StepResult[];
  output: [C, C];
  outputStokes: Stokes;
  /** 组合矩阵 M = Jn * ... * J2 * J1（空链为恒等） */
  combinedMatrix: Mat2;
}

/** 顺序传播：E_out = Jn * ... * J2 * J1 * E_in。不做任何重新归一化。 */
export function propagate(field: { Ex?: C; Ey?: C }, chain: ElementSpec[]): PropagationResult {
  const specs = validateChain(chain);
  const e0 = validateField(field);
  const steps: StepResult[] = [];
  let current: [C, C] = [e0[0], e0[1]];
  let combined: Mat2 = IDENT;
  specs.forEach((spec, i) => {
    const el = validateElement(spec, i);
    const m = elementMatrix(el);
    const inputIntensity = stokes(current[0], current[1]).S0;
    const next = matVec(m, current);
    assertFiniteField(next, i + 1);
    combined = matMul(m, combined);
    steps.push({
      index: i,
      element: el,
      matrix: m,
      input: current,
      output: next,
      inputIntensity,
      outputIntensity: stokes(next[0], next[1]).S0,
      stokes: stokes(next[0], next[1]),
    });
    current = next;
  });
  return {
    algorithmVersion: ALGORITHM_VERSION,
    convention: CONVENTION,
    eps: EPS,
    input: e0,
    inputStokes: stokes(e0[0], e0[1]),
    steps,
    output: current,
    outputStokes: stokes(current[0], current[1]),
    combinedMatrix: combined,
  };
}

export interface ChainComparison {
  sameLength: boolean;
  firstDivergenceIndex: number | null;
  explanation: string;
  a: PropagationResult;
  b: PropagationResult;
}

function fieldEqual(x: [C, C], y: [C, C]): boolean {
  return (
    Math.abs(x[0].re - y[0].re) <= EPS &&
    Math.abs(x[0].im - y[0].im) <= EPS &&
    Math.abs(x[1].re - y[1].re) <= EPS &&
    Math.abs(x[1].im - y[1].im) <= EPS
  );
}

/** 同一输入下比较两条链，定位差异最早出现的元件步 */
export function compareChains(
  field: { Ex?: C; Ey?: C },
  chainA: ElementSpec[],
  chainB: ElementSpec[],
): ChainComparison {
  const a = propagate(field, chainA);
  const b = propagate(field, chainB);
  let first: number | null = null;
  const n = Math.min(a.steps.length, b.steps.length);
  for (let i = 0; i < n; i++) {
    if (!fieldEqual(a.steps[i].output, b.steps[i].output)) {
      first = i;
      break;
    }
  }
  if (first === null && a.steps.length !== b.steps.length) {
    first = n;
  }
  const explanation = first === null
    ? "两条链逐步输出一致（在 EPS 阈值内）。"
    : first < n
      ? `差异最早出现在第 ${first} 号元件之后：链A 输出 ${fmt(a.steps[first].output)}，链B 输出 ${fmt(b.steps[first].output)}。`
      : `前 ${n} 步一致，但链长不同（A=${a.steps.length}, B=${b.steps.length}），从第 ${n} 步起无法对应。`;
  return {
    sameLength: a.steps.length === b.steps.length,
    firstDivergenceIndex: first,
    explanation,
    a,
    b,
  };
}

function fmt(e: [C, C]): string {
  const f = (z: C) => `(${z.re.toPrecision(6)}${z.im >= 0 ? "+" : ""}${z.im.toPrecision(6)}i)`;
  return `[${f(e[0])}, ${f(e[1])}]`;
}
