import { C, c, mul, add, fromPolar, abs2, conj, assertFiniteComplex, ValidationError } from "./complex";

export const DEG2RAD = Math.PI / 180;

/** 数值零判定阈值（公开）：|x| <= EPS 视为数值零 */
export const EPS = 1e-12;

export const ALGORITHM_VERSION = "jones-seq-1.0.0";
export const CONVENTION = {
  timeDependence: "exp(-i*omega*t)",
  basis: "x,y",
  retarderDeltaMeaning: "v 分量相对 u 分量增加的相位（度）",
  s3Formula: "S3 = 2*Im(conj(Ex)*Ey)",
} as const;

export const MAX_CHAIN_LENGTH = 64;
export const MAX_ABS_ANGLE_DEG = 1e6;
export const MAX_ABS_DELTA_DEG = 1e6;

export type ElementType = "polarizer" | "retarder" | "qwp" | "hwp";

export interface ElementSpec {
  type: ElementType;
  /** 轴角 theta，度；允许跨周，原样保留 */
  thetaDeg: number;
  /** 仅 retarder 使用：delta，度 */
  deltaDeg?: number;
  /** 可选标签 */
  label?: string;
}

export interface ResolvedElement {
  type: ElementType;
  thetaDegInput: number;
  thetaDegCanonical: number;
  deltaDegInput: number | null;
  deltaDegCanonical: number | null;
  label: string | null;
}

export type Mat2 = [[C, C], [C, C]];

export const IDENT: Mat2 = [
  [c(1), c(0)],
  [c(0), c(1)],
];

/** 规范到 [0, 180) 用于显示与一致性计算 */
export function canonicalAngleDeg(thetaDeg: number): number {
  const r = ((thetaDeg % 180) + 180) % 180;
  return Object.is(r, -0) ? 0 : r;
}

export function canonicalDeltaDeg(deltaDeg: number): number {
  const r = ((deltaDeg % 360) + 360) % 360;
  return Object.is(r, -0) ? 0 : r;
}

export function validateElement(spec: ElementSpec, index: number): ResolvedElement {
  const where = `元件[${index}]`;
  if (!spec || typeof spec !== "object") {
    throw new ValidationError(`E_INVALID_ELEMENT: ${where} 缺失或不是对象`);
  }
  const types: ElementType[] = ["polarizer", "retarder", "qwp", "hwp"];
  if (!types.includes(spec.type)) {
    throw new ValidationError(`E_INVALID_ELEMENT: ${where} 非法类型 '${String(spec.type)}'，允许 ${types.join("/")}`);
  }
  if (typeof spec.thetaDeg !== "number" || !Number.isFinite(spec.thetaDeg)) {
    throw new ValidationError(`E_INVALID_ELEMENT: ${where} thetaDeg 必须是有限数`);
  }
  if (Math.abs(spec.thetaDeg) > MAX_ABS_ANGLE_DEG) {
    throw new ValidationError(`E_RANGE: ${where} thetaDeg 超出范围 ±${MAX_ABS_ANGLE_DEG}`);
  }
  let delta: number | null = null;
  if (spec.type === "retarder") {
    if (typeof spec.deltaDeg !== "number" || !Number.isFinite(spec.deltaDeg)) {
      throw new ValidationError(`E_INVALID_ELEMENT: ${where} retarder 需要有限数 deltaDeg`);
    }
    if (Math.abs(spec.deltaDeg) > MAX_ABS_DELTA_DEG) {
      throw new ValidationError(`E_RANGE: ${where} deltaDeg 超出范围 ±${MAX_ABS_DELTA_DEG}`);
    }
    delta = spec.deltaDeg;
  } else if (spec.type === "qwp") {
    delta = 90;
  } else if (spec.type === "hwp") {
    delta = 180;
  }
  return {
    type: spec.type,
    thetaDegInput: spec.thetaDeg,
    thetaDegCanonical: canonicalAngleDeg(spec.thetaDeg),
    deltaDegInput: delta,
    deltaDegCanonical: delta === null ? null : canonicalDeltaDeg(delta),
    label: typeof spec.label === "string" ? spec.label : null,
  };
}

/** 理想线偏振片: u*u^T；延迟片: u*u^T + exp(i*delta)*v*v^T */
export function elementMatrix(el: ResolvedElement): Mat2 {
  const t = el.thetaDegInput * DEG2RAD;
  const cu = Math.cos(t);
  const su = Math.sin(t);
  // u = (cu, su), v = (-su, cu)
  const uu: Mat2 = [
    [c(cu * cu), c(cu * su)],
    [c(cu * su), c(su * su)],
  ];
  if (el.type === "polarizer") {
    return uu;
  }
  const delta = (el.deltaDegInput ?? 0) * DEG2RAD;
  const p = fromPolar(1, delta); // exp(i*delta)
  const vv: Mat2 = [
    [c(su * su), c(-su * cu)],
    [c(-su * cu), c(cu * cu)],
  ];
  return [
    [add(uu[0][0], mul(p, vv[0][0])), add(uu[0][1], mul(p, vv[0][1]))],
    [add(uu[1][0], mul(p, vv[1][0])), add(uu[1][1], mul(p, vv[1][1]))],
  ];
}

export function matVec(m: Mat2, e: [C, C]): [C, C] {
  return [
    add(mul(m[0][0], e[0]), mul(m[0][1], e[1])),
    add(mul(m[1][0], e[0]), mul(m[1][1], e[1])),
  ];
}

export function matMul(a: Mat2, b: Mat2): Mat2 {
  const out: Mat2 = [
    [c(0), c(0)],
    [c(0), c(0)],
  ];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      out[i][j] = add(mul(a[i][0], b[0][j]), mul(a[i][1], b[1][j]));
    }
  }
  return out;
}

export interface Stokes {
  S0: number;
  S1: number;
  S2: number;
  S3: number;
  /** S0 > EPS 时为 S1/S0 等，否则为 null（零强度无偏振方向） */
  n1: number | null;
  n2: number | null;
  n3: number | null;
}

export function stokes(ex: C, ey: C): Stokes {
  const ix = abs2(ex);
  const iy = abs2(ey);
  const cross = mul(conj(ex), ey);
  const S0 = ix + iy;
  const S1 = ix - iy;
  const S2 = 2 * cross.re;
  const S3 = 2 * cross.im;
  const nonzero = S0 > EPS;
  return {
    S0, S1, S2, S3,
    n1: nonzero ? S1 / S0 : null,
    n2: nonzero ? S2 / S0 : null,
    n3: nonzero ? S3 / S0 : null,
  };
}

export function validateField(field: { Ex?: C; Ey?: C }): [C, C] {
  if (!field || typeof field !== "object") {
    throw new ValidationError("E_INVALID_FIELD: 需要 {Ex:{re,im}, Ey:{re,im}}");
  }
  assertFiniteComplex(field.Ex as C, "Ex");
  assertFiniteComplex(field.Ey as C, "Ey");
  return [field.Ex as C, field.Ey as C];
}

export function validateChain(chain: ElementSpec[]): ElementSpec[] {
  if (!Array.isArray(chain)) {
    throw new ValidationError("E_INVALID_CHAIN: 元件链必须是数组");
  }
  if (chain.length > MAX_CHAIN_LENGTH) {
    throw new ValidationError(`E_CHAIN_TOO_LONG: 链长 ${chain.length} 超过上限 ${MAX_CHAIN_LENGTH}`);
  }
  return chain;
}

export function assertFiniteField(e: [C, C], step: number): void {
  for (const comp of e) {
    if (!Number.isFinite(comp.re) || !Number.isFinite(comp.im)) {
      throw new ValidationError(`E_OVERFLOW: 第 ${step} 步后出现非有限数值，疑似数值溢出`);
    }
  }
}
