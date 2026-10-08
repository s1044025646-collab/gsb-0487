import { test } from "node:test";
import assert from "node:assert/strict";
import { matVec } from "../src/complex.js";
import { validateChain, validateField, applyByProjection, canonicalAngleDeg } from "../src/components.js";
import { propagate } from "../src/propagate.js";
import { compareReports } from "../src/compare.js";
import { stokes } from "../src/stokes.js";
import { NUMERIC_THRESHOLDS } from "../src/constants.js";
import type { StoredComponent, Vec2 } from "../src/types.js";
import { JonesError } from "../src/types.js";

const SQRT1_2 = 1 / Math.sqrt(2);

function field(exRe: number, exIm = 0, eyRe = 0, eyIm = 0): Vec2 {
  return [
    { re: exRe, im: exIm },
    { re: eyRe, im: eyIm },
  ];
}

function run(
  f: Vec2,
  comps: Array<Partial<StoredComponent> & { kind: StoredComponent["kind"]; thetaDeg: number }>,
) {
  const full: StoredComponent[] = comps.map((x) => ({
    kind: x.kind,
    thetaDeg: x.thetaDeg,
    deltaDeg: x.deltaDeg ?? null,
    label: x.label ?? null,
  }));
  return propagate({
    inputField: f,
    components: full,
    runId: "t",
    experimentId: "exp",
    configVersion: 1,
  });
}

test("0° 再 90° 偏振片，最终强度为 0", () => {
  const r = run(field(1), [
    { kind: "polarizer", thetaDeg: 0 },
    { kind: "polarizer", thetaDeg: 90 },
  ]);
  assert.ok(Math.abs(r.finalIntensity) < 1e-15);
  assert.ok(Math.abs(r.steps[0]!.intensityAfter - 1) < 1e-12);
  assert.ok(Math.abs(r.steps[1]!.intensityAfter) < 1e-12);
});

test("插入 45° 偏振片，最终强度为 1/4", () => {
  const r = run(field(1), [
    { kind: "polarizer", thetaDeg: 0 },
    { kind: "polarizer", thetaDeg: 45 },
    { kind: "polarizer", thetaDeg: 90 },
  ]);
  assert.ok(Math.abs(r.finalIntensity - 0.25) < 1e-12);
  assert.ok(Math.abs(r.steps[1]!.intensityAfter - 0.5) < 1e-12);
});

test("(1,1)/sqrt2 经 0°,delta90 延迟片 -> (1,i)/sqrt2，S3=1", () => {
  const r = run(field(SQRT1_2, 0, SQRT1_2, 0), [
    { kind: "retarder", thetaDeg: 0, deltaDeg: 90 },
  ]);
  assert.ok(Math.abs(r.finalField[0].re - SQRT1_2) < 1e-12);
  assert.ok(Math.abs(r.finalField[1].im - SQRT1_2) < 1e-12);
  assert.ok(Math.abs(r.finalStokes.s3 - 1) < 1e-12);
  assert.ok(Math.abs(r.finalIntensity - 1) < 1e-12);
});

test("空链是恒等变换", () => {
  const f = field(0.3, 0.1, -0.2, 0.5);
  const r = run(f, []);
  assert.ok(r.identityChain);
  assert.deepEqual(r.finalField, f);
  assert.ok(Math.abs(r.finalIntensity - 0.09 - 0.01 - 0.04 - 0.25) < 1e-12);
});

test("零向量允许，归一 Stokes 为 null，不伪造成水平偏振", () => {
  const r = run(field(0), [{ kind: "polarizer", thetaDeg: 30 }]);
  assert.strictEqual(r.finalIntensity, 0);
  assert.strictEqual(r.finalStokes.s1Norm, null);
  assert.strictEqual(r.finalStokes.s2Norm, null);
  assert.strictEqual(r.finalStokes.s3Norm, null);
  assert.strictEqual(r.steps[0]!.intensityRatio, null);
});

test("轴角 +180° 偏振片结果不变（投影方向等价）", () => {
  const f = field(0.6, 0, 0.8, 0);
  const a = run(f, [{ kind: "polarizer", thetaDeg: 37 }]);
  const b = run(f, [{ kind: "polarizer", thetaDeg: 217 }]);
  assert.ok(Math.abs(a.finalIntensity - b.finalIntensity) < 1e-12);
  assert.strictEqual(b.components[0]!.thetaDeg, 217);
  assert.ok(Math.abs(b.components[0]!.thetaCanonicalDeg - -143) < 1e-9);
});

test("延迟 +360° 等于恒等", () => {
  const f = field(0.5, 0.1, -0.3, 0.4);
  const r = run(f, [{ kind: "retarder", thetaDeg: 53, deltaDeg: 360 }]);
  assert.ok(Math.abs(r.finalField[0].re - 0.5) < 1e-12);
  assert.ok(Math.abs(r.finalField[1].im - 0.4) < 1e-12);
});

test("整体相位不改变 Stokes", () => {
  const phi = 1.234;
  const base: Vec2 = [
    { re: 0.5, im: 0.2 },
    { re: -0.3, im: 0.4 },
  ];
  const shifted: Vec2 = [
    caddc(base[0], phi),
    caddc(base[1], phi),
  ];
  const sa = stokes(base);
  const sb = stokes(shifted);
  for (const k of ["s0", "s1", "s2", "s3"] as const) {
    assert.ok(Math.abs(sa[k] - sb[k]) < 1e-12);
  }
});

function caddc(z: { re: number; im: number }, phi: number) {
  const re = z.re * Math.cos(phi) - z.im * Math.sin(phi);
  const im = z.re * Math.sin(phi) + z.im * Math.cos(phi);
  return { re, im };
}

test("半波片两次恢复原场", () => {
  const f = field(0.4, 0.1, -0.2, 0.6);
  const r = run(f, [
    { kind: "hwp", thetaDeg: 33 },
    { kind: "hwp", thetaDeg: 33 },
  ]);
  assert.ok(Math.abs(r.finalField[0].re - 0.4) < 1e-10);
  assert.ok(Math.abs(r.finalField[1].im - 0.6) < 1e-10);
  // 单片 HWP 也守恒强度
  assert.ok(Math.abs(r.steps[0]!.intensityAfter - r.steps[0]!.intensityBefore) < 1e-10);
});

test("元件调序结果不同，比较定位到最早分歧", () => {
  const f = field(1);
  const a = run(f, [
    { kind: "polarizer", thetaDeg: 0 },
    { kind: "retarder", thetaDeg: 45, deltaDeg: 90 },
  ]);
  const b = run(f, [
    { kind: "retarder", thetaDeg: 45, deltaDeg: 90 },
    { kind: "polarizer", thetaDeg: 0 },
  ]);
  const cmp = compareReports(a, b);
  assert.strictEqual(cmp.earliestDivergenceStep, 0);
  assert.ok(cmp.stepDeltas[0]!.intensityDiff >= 0);
});

test("每步纯态关系 S1^2+S2^2+S3^2 = S0^2", () => {
  const f = field(0.7, 0.2, 0.3, -0.4);
  const r = run(f, [
    { kind: "polarizer", thetaDeg: 20 },
    { kind: "retarder", thetaDeg: 55, deltaDeg: 70 },
    { kind: "qwp", thetaDeg: -10 },
    { kind: "hwp", thetaDeg: 80 },
  ]);
  for (const s of r.steps) {
    const scale = Math.max(1, s.stokesAfter.s0 * s.stokesAfter.s0);
    assert.ok(
      s.pureStateResidual <= NUMERIC_THRESHOLDS.PURE_STATE_REL_TOL * scale,
      `step ${s.index} 纯态残差过大 ${s.pureStateResidual}`,
    );
  }
});

test("延迟片（含 qwp/hwp）强度守恒", () => {
  const f = field(0.6, -0.2, 0.3, 0.5);
  const r = run(f, [
    { kind: "retarder", thetaDeg: 12, deltaDeg: 40 },
    { kind: "qwp", thetaDeg: 67 },
    { kind: "hwp", thetaDeg: -30 },
  ]);
  for (const s of r.steps) {
    assert.ok(s.retarderLoss !== null);
    const rel = s.retarderLoss! / Math.max(1, s.intensityBefore);
    assert.ok(rel <= NUMERIC_THRESHOLDS.RETARDER_LOSS_REL_TOL, `step ${s.index} 延迟片损失 ${rel}`);
  }
});

test("矩阵传播与 u/v 投影分解独立实现一致", () => {
  const cases: StoredComponent[] = [
    { kind: "polarizer", thetaDeg: 37, deltaDeg: null, label: null },
    { kind: "retarder", thetaDeg: -18, deltaDeg: 63, label: null },
    { kind: "qwp", thetaDeg: 112, deltaDeg: null, label: null },
    { kind: "hwp", thetaDeg: 240, deltaDeg: null, label: null },
  ];
  const f = field(0.55, -0.3, 0.2, 0.7);
  let v1: Vec2 = f;
  let v2: Vec2 = f;
  for (const comp of cases) {
    const r = run(v1, [comp]);
    v1 = r.finalField;
    v2 = applyByProjection(comp, v2);
    assert.ok(Math.abs(v1[0].re - v2[0].re) < 1e-12);
    assert.ok(Math.abs(v1[1].im - v2[1].im) < 1e-12);
  }
});

test("偏振片中途不归一化：保留真实振幅与强度", () => {
  const r = run(field(2), [{ kind: "polarizer", thetaDeg: 0 }]);
  assert.ok(Math.abs(r.finalField[0].re - 2) < 1e-12);
  assert.ok(Math.abs(r.finalIntensity - 4) < 1e-12);
});

test("很小但非零输入不被当成标准单位光强", () => {
  const tiny = 1e-9;
  const r = run(field(tiny), [{ kind: "polarizer", thetaDeg: 0 }]);
  assert.ok(Math.abs(r.finalIntensity - 1e-18) < 1e-24);
  assert.ok(r.finalStokes.s1Norm !== null);
});

test("校验：缺失/非有限分量与非法元件报错", () => {
  assert.throws(() => validateField({ ex: { re: 1 } }), JonesError);
  assert.throws(() => validateField({ ex: { re: NaN, im: 0 }, ey: { re: 0, im: 0 } }), JonesError);
  assert.throws(() => validateChain([{ kind: "mirror", thetaDeg: 0 }]), JonesError);
  assert.throws(() => validateChain([{ kind: "retarder", thetaDeg: 0 }]), JonesError);
  assert.throws(() => validateChain([{ kind: "polarizer", thetaDeg: Infinity }]), JonesError);
});

test("校验：过长链报错", () => {
  const long = Array.from({ length: 65 }, () => ({ kind: "polarizer" as const, thetaDeg: 0 }));
  assert.throws(
    () => validateChain(long),
    (err: unknown) => err instanceof JonesError && err.code === "CHAIN_TOO_LONG",
  );
});

test("规范角只影响显示，原输入角保留", () => {
  assert.strictEqual(canonicalAngleDeg(180), 180);
  assert.strictEqual(canonicalAngleDeg(181), -179);
  const r = run(field(1), [{ kind: "polarizer", thetaDeg: 360 }]);
  assert.strictEqual(r.steps[0]!.thetaDeg, 360);
  assert.ok(Math.abs(r.steps[0]!.thetaCanonicalDeg - 0) < 1e-9);
});

test("qwp/hwp 快捷输入等价 delta 90/180，无额外快慢轴约定", () => {
  const f = field(0.4, 0.3, -0.2, 0.1);
  const a = run(f, [{ kind: "qwp", thetaDeg: 25 }]);
  const b = run(f, [{ kind: "retarder", thetaDeg: 25, deltaDeg: 90 }]);
  assert.deepEqual(a.finalField, b.finalField);
  const c1 = run(f, [{ kind: "hwp", thetaDeg: 25 }]);
  const d = run(f, [{ kind: "retarder", thetaDeg: 25, deltaDeg: 180 }]);
  assert.deepEqual(c1.finalField, d.finalField);
});

test("组合矩阵等于逐步矩阵乘积且作用于输入得最终场", () => {
  const f = field(0.7, 0, -0.5, 0.2);
  const r = run(f, [
    { kind: "polarizer", thetaDeg: 15 },
    { kind: "retarder", thetaDeg: 40, deltaDeg: 55 },
  ]);
  const via = matVec(r.combinedMatrix, f);
  assert.ok(Math.abs(via[0].re - r.finalField[0].re) < 1e-10);
  assert.ok(Math.abs(via[1].im - r.finalField[1].im) < 1e-10);
});
