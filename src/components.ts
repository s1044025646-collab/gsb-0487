import { DEG2RAD, LIMITS } from "./constants.js";
import { c, cadd, cexp, cmul, cscale } from "./complex.js";
import type {
  ComponentKind,
  Mat2,
  StoredComponent,
  Vec2,
} from "./types.js";
import { JonesError } from "./types.js";

function isFiniteNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

// 规范角到 (-180,180]
export function canonicalAngleDeg(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

export function effectiveDeltaDeg(kind: ComponentKind, provided: number | null): number {
  if (kind === "qwp") return 90;
  if (kind === "hwp") return 180;
  return provided ?? 0;
}

export function validateField(input: unknown): Vec2 {
  if (input === null || typeof input !== "object") {
    throw new JonesError("INVALID_FIELD", "输入场必须是包含 ex、ey 的对象", "field");
  }
  const obj = input as Record<string, unknown>;
  const parts: Array<{ name: "ex" | "ey"; val: unknown }> = [
    { name: "ex", val: obj.ex },
    { name: "ey", val: obj.ey },
  ];
  const out: Vec2 = [
    { re: 0, im: 0 },
    { re: 0, im: 0 },
  ];
  for (const part of parts) {
    if (part.val === null || typeof part.val !== "object") {
      throw new JonesError(
        "MISSING_FIELD_COMPONENT",
        `缺少电场分量 ${part.name}，必须提供 {re, im}`,
        `field.${part.name}`,
      );
    }
    const pv = part.val as Record<string, unknown>;
    if (!("re" in pv) || !("im" in pv)) {
      throw new JonesError(
        "MISSING_FIELD_COMPONENT",
        `电场分量 ${part.name} 缺少 re 或 im`,
        `field.${part.name}`,
      );
    }
    if (!isFiniteNumber(pv.re) || !isFiniteNumber(pv.im)) {
      throw new JonesError(
        "NON_FINITE_NUMBER",
        `电场分量 ${part.name} 的实部/虚部必须是有限数，拒绝 NaN/Infinity`,
        `field.${part.name}`,
      );
    }
    const re = pv.re as number;
    const im = pv.im as number;
    if (Math.abs(re) > LIMITS.MAX_ABS_FIELD_COMPONENT || Math.abs(im) > LIMITS.MAX_ABS_FIELD_COMPONENT) {
      throw new JonesError(
        "FIELD_OUT_OF_RANGE",
        `电场分量 ${part.name} 超出允许范围 |.| <= ${LIMITS.MAX_ABS_FIELD_COMPONENT}`,
        `field.${part.name}`,
      );
    }
    if (part.name === "ex") out[0] = { re, im };
    else out[1] = { re, im };
  }
  return out;
}

export function validateChain(input: unknown): StoredComponent[] {
  if (!Array.isArray(input)) {
    throw new JonesError("INVALID_COMPONENT", "元件链必须是数组", "components");
  }
  if (input.length === 0) return [];
  if (input.length > LIMITS.MAX_CHAIN_LENGTH) {
    throw new JonesError(
      "CHAIN_TOO_LONG",
      `元件链过长：${input.length} > 最大长度 ${LIMITS.MAX_CHAIN_LENGTH}`,
      "components",
    );
  }
  return input.map((raw, i) => validateComponent(raw, i));
}

function validateComponent(raw: unknown, index: number): StoredComponent {
  const path = `components[${index}]`;
  if (raw === null || typeof raw !== "object") {
    throw new JonesError("INVALID_COMPONENT", `第 ${index} 个元件必须是对象`, path);
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string" || !["polarizer", "retarder", "qwp", "hwp"].includes(kind)) {
    throw new JonesError(
      "UNKNOWN_COMPONENT_KIND",
      `第 ${index} 个元件 kind 非法：${String(kind)}（允许 polarizer/retarder/qwp/hwp）`,
      `${path}.kind`,
    );
  }
  if (!isFiniteNumber(obj.thetaDeg)) {
    throw new JonesError(
      "NON_FINITE_NUMBER",
      `第 ${index} 个元件 thetaDeg 必须是有限数（度，可跨周）`,
      `${path}.thetaDeg`,
    );
  }
  const thetaDeg = obj.thetaDeg as number;
  if (Math.abs(thetaDeg) > LIMITS.MAX_ABS_ANGLE_DEG) {
    throw new JonesError(
      "ANGLE_OUT_OF_RANGE",
      `第 ${index} 个元件轴角超出 |thetaDeg| <= ${LIMITS.MAX_ABS_ANGLE_DEG}`,
      `${path}.thetaDeg`,
    );
  }
  let deltaDeg: number | null = null;
  if (kind === "retarder") {
    if (!("deltaDeg" in obj) || obj.deltaDeg === undefined) {
      throw new JonesError(
        "MISSING_DELTA",
        `第 ${index} 个 retarder 必须提供 deltaDeg（v 相对 u 增加的相位，度）`,
        `${path}.deltaDeg`,
      );
    }
    if (!isFiniteNumber(obj.deltaDeg)) {
      throw new JonesError(
        "NON_FINITE_NUMBER",
        `第 ${index} 个 retarder 的 deltaDeg 必须是有限数`,
        `${path}.deltaDeg`,
      );
    }
    deltaDeg = obj.deltaDeg as number;
    if (Math.abs(deltaDeg) > LIMITS.MAX_ABS_DELTA_DEG) {
      throw new JonesError(
        "DELTA_OUT_OF_RANGE",
        `第 ${index} 个 retarder 的 deltaDeg 超出 |deltaDeg| <= ${LIMITS.MAX_ABS_DELTA_DEG}`,
        `${path}.deltaDeg`,
      );
    }
  }
  let label: string | null = null;
  if (obj.label !== undefined && obj.label !== null) {
    if (typeof obj.label !== "string") {
      throw new JonesError("INVALID_COMPONENT", `第 ${index} 个元件 label 必须是字符串`, `${path}.label`);
    }
    if (obj.label.length > LIMITS.MAX_LABEL_LENGTH) {
      throw new JonesError("LABEL_TOO_LONG", `第 ${index} 个元件 label 过长`, `${path}.label`);
    }
    label = obj.label;
  }
  return { kind: kind as StoredComponent["kind"], thetaDeg, deltaDeg, label };
}

// 构造元件矩阵
// P = u*u^T；R = u*u^T + exp(i delta)*v*v^T
export function buildMatrix(comp: StoredComponent): Mat2 {
  const theta = comp.thetaDeg * DEG2RAD;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  // u = (ct, st), v = (-st, ct)
  const uu: Mat2 = [
    [c(ct * ct), c(ct * st)],
    [c(ct * st), c(st * st)],
  ];
  if (comp.kind === "polarizer") {
    return uu;
  }
  const delta = effectiveDeltaDeg(comp.kind, comp.deltaDeg) * DEG2RAD;
  const e = cexp(delta);
  // v*v^T
  const vv: Mat2 = [
    [c(st * st), c(-st * ct)],
    [c(-st * ct), c(ct * ct)],
  ];
  return [
    [cadd(uu[0][0], cmul(e, vv[0][0])), cadd(uu[0][1], cmul(e, vv[0][1]))],
    [cadd(uu[1][0], cmul(e, vv[1][0])), cadd(uu[1][1], cmul(e, vv[1][1]))],
  ];
}

// 独立核对：用 u/v 投影分解直接计算 R/P 作用结果，供测试交叉验证
export function applyByProjection(comp: StoredComponent, field: Vec2): Vec2 {
  const theta = comp.thetaDeg * DEG2RAD;
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const ex = field[0];
  const ey = field[1];
  // a = u . E = ct*Ex + st*Ey ; b = v . E = -st*Ex + ct*Ey
  const a = cadd(cscale(ex, ct), cscale(ey, st));
  const b = cadd(cscale(ex, -st), cscale(ey, ct));
  if (comp.kind === "polarizer") {
    // 只保留 u 分量
    return [cscale(a, ct), cscale(a, st)];
  }
  const delta = effectiveDeltaDeg(comp.kind, comp.deltaDeg) * DEG2RAD;
  const bShifted = cmul(cexp(delta), b);
  // E' = a*u + b'*v
  return [
    cadd(cscale(a, ct), cscale(bShifted, -st)),
    cadd(cscale(a, st), cscale(bShifted, ct)),
  ];
}
