export interface C {
  re: number;
  im: number;
}

// 二维复电场向量 [Ex, Ey]
export type Vec2 = [C, C];

// 2x2 复矩阵，行优先：m[row][col]
export type Mat2 = [[C, C], [C, C]];

export type ComponentKind = "polarizer" | "retarder" | "qwp" | "hwp";

export interface ComponentInput {
  kind: ComponentKind;
  // 元件轴角（度），可跨周
  thetaDeg: number;
  // 仅 retarder 使用：v 相对 u 增加的相位（度）。qwp/hwp 忽略并内部固定。
  deltaDeg?: number;
  label?: string;
}

export interface StoredComponent {
  kind: ComponentKind;
  thetaDeg: number;
  deltaDeg: number | null;
  label: string | null;
}

export interface FieldInput {
  ex: C;
  ey: C;
}

export interface Stokes {
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  s1Norm: number | null;
  s2Norm: number | null;
  s3Norm: number | null;
}

export interface ResolvedComponent extends StoredComponent {
  index: number;
  // 规范到 (-180,180] 的轴角，仅用于显示一致性
  thetaCanonicalDeg: number;
  // 该元件实际使用的 delta（度）
  effectiveDeltaDeg: number;
  matrix: Mat2;
}

export interface StepResult {
  index: number; // 0 基，第 index 个元件作用后的结果
  kind: ComponentKind;
  label: string | null;
  thetaDeg: number; // 原始输入角
  thetaCanonicalDeg: number;
  deltaDeg: number | null;
  effectiveDeltaDeg: number;
  fieldBefore: Vec2;
  matrix: Mat2;
  fieldAfter: Vec2;
  stokesBefore: Stokes;
  stokesAfter: Stokes;
  intensityBefore: number;
  intensityAfter: number;
  intensityRatio: number | null; // after/before，before=0 时为 null
  // 核验信息
  pureStateResidual: number; // |S1^2+S2^2+S3^2 - S0^2|（after）
  retarderLoss: number | null; // 仅延迟片：|Iafter-Ibefore|
}

export interface PropagationReport {
  algorithmVersion: string;
  convention: Record<string, string>;
  runId: string;
  experimentId: string;
  configVersion: number;
  inputField: Vec2;
  inputStokes: Stokes;
  inputIntensity: number;
  components: ResolvedComponent[];
  steps: StepResult[];
  finalField: Vec2;
  finalStokes: Stokes;
  finalIntensity: number;
  combinedMatrix: Mat2;
  chainLength: number;
  identityChain: boolean;
}

export interface ValidationIssue {
  code: ErrorCode;
  message: string;
  path?: string;
}

export type ErrorCode =
  | "INVALID_FIELD"
  | "MISSING_FIELD_COMPONENT"
  | "NON_FINITE_NUMBER"
  | "FIELD_OUT_OF_RANGE"
  | "INVALID_COMPONENT"
  | "UNKNOWN_COMPONENT_KIND"
  | "ANGLE_OUT_OF_RANGE"
  | "DELTA_OUT_OF_RANGE"
  | "MISSING_DELTA"
  | "CHAIN_TOO_LONG"
  | "EMPTY_CHAIN"
  | "NUMERIC_OVERFLOW"
  | "NOT_FOUND"
  | "INVALID_JSON"
  | "INVALID_QUERY"
  | "LABEL_TOO_LONG"
  | "ID_TOO_LONG";

export class JonesError extends Error {
  readonly code: ErrorCode;
  readonly path?: string;
  readonly status: number;
  constructor(code: ErrorCode, message: string, path?: string) {
    super(message);
    this.name = "JonesError";
    this.code = code;
    this.path = path;
    this.status =
      code === "NOT_FOUND"
        ? 404
        : code === "INVALID_JSON" || code === "INVALID_QUERY"
          ? 400
          : 422;
  }
}
