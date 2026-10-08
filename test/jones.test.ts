import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { propagate, compareChains } from "../src/propagate";
import { elementMatrix, validateElement, stokes, EPS, matVec, IDENT } from "../src/jones";
import { C, c, mul, add, conj } from "../src/complex";
import { Store } from "../src/store";

const closeTo = (actual: number, expected: number, tol = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tol, `期望 ${expected}，实际 ${actual}`);

const fieldCloseTo = (e: [C, C], ex: number, ey: number, tol = 1e-9) => {
  closeTo(e[0].re, ex, tol);
  closeTo(e[0].im, 0, tol);
  closeTo(e[1].re, ey, tol);
  closeTo(e[1].im, 0, tol);
};

test("交叉偏振片: (1,0) → 0° → 90° 最终强度为 0", () => {
  const r = propagate({ Ex: c(1), Ey: c(0) }, [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 90 },
  ]);
  closeTo(r.steps[0].outputIntensity, 1);
  closeTo(r.outputStokes.S0, 0);
});

test("插入 45° 偏振片后最终强度为 1/4", () => {
  const r = propagate({ Ex: c(1), Ey: c(0) }, [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 45 },
    { type: "polarizer", thetaDeg: 90 },
  ]);
  closeTo(r.steps[1].outputIntensity, 0.5);
  closeTo(r.outputStokes.S0, 0.25);
});

test("四分之一波延迟片: (1,1)/√2 → (1,i)/√2，S3=1，强度守恒", () => {
  const s = 1 / Math.sqrt(2);
  const r = propagate({ Ex: c(s), Ey: c(s) }, [
    { type: "retarder", thetaDeg: 0, deltaDeg: 90 },
  ]);
  closeTo(r.output[0].re, s);
  closeTo(r.output[0].im, 0);
  closeTo(r.output[1].re, 0);
  closeTo(r.output[1].im, s);
  closeTo(r.outputStokes.S3, 1);
  closeTo(r.outputStokes.S0, 1);
  // qwp 快捷输入等价
  const r2 = propagate({ Ex: c(s), Ey: c(s) }, [{ type: "qwp", thetaDeg: 0 }]);
  closeTo(r2.outputStokes.S3, 1);
});

test("空链是恒等变换", () => {
  const r = propagate({ Ex: c(0.3, 0.4), Ey: c(-0.2, 0.1) }, []);
  assert.equal(r.steps.length, 0);
  assert.deepEqual(r.output, r.input);
  assert.deepEqual(r.combinedMatrix, IDENT);
});

test("零场: 归一 Stokes 为 null，不伪造水平偏振", () => {
  const r = propagate({ Ex: c(0), Ey: c(0) }, [{ type: "polarizer", thetaDeg: 30 }]);
  assert.equal(r.outputStokes.S0, 0);
  assert.equal(r.outputStokes.n1, null);
  assert.equal(r.outputStokes.n2, null);
  assert.equal(r.outputStokes.n3, null);
});

test("轴角 +180° 矩阵不变", () => {
  const a = elementMatrix(validateElement({ type: "retarder", thetaDeg: 30, deltaDeg: 90 }, 0));
  const b = elementMatrix(validateElement({ type: "retarder", thetaDeg: 210, deltaDeg: 90 }, 0));
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      closeTo(a[i][j].re, b[i][j].re);
      closeTo(a[i][j].im, b[i][j].im);
    }
});

test("延迟 delta +360° 矩阵不变", () => {
  const a = elementMatrix(validateElement({ type: "retarder", thetaDeg: 15, deltaDeg: 90 }, 0));
  const b = elementMatrix(validateElement({ type: "retarder", thetaDeg: 15, deltaDeg: 450 }, 0));
  for (let i = 0; i < 2; i++)
    for (let j = 0; j < 2; j++) {
      closeTo(a[i][j].re, b[i][j].re);
      closeTo(a[i][j].im, b[i][j].im);
    }
});

test("整体相位不改变 Stokes 参数", () => {
  const s1 = stokes(c(0.6, 0), c(0, 0.8));
  const s2 = stokes(c(0, 0.6), c(-0.8, 0)); // 整体乘 i
  closeTo(s1.S0, s2.S0);
  closeTo(s1.S1, s2.S1);
  closeTo(s1.S2, s2.S2);
  closeTo(s1.S3, s2.S3);
});

test("半波片两次作用恢复原场", () => {
  const r = propagate({ Ex: c(0.3, 0.2), Ey: c(-0.5, 0.4) }, [
    { type: "hwp", thetaDeg: 27 },
    { type: "hwp", thetaDeg: 27 },
  ]);
  closeTo(r.output[0].re, 0.3);
  closeTo(r.output[0].im, 0.2);
  closeTo(r.output[1].re, -0.5);
  closeTo(r.output[1].im, 0.4);
});

test("元件不可交换: 调序结果不同且 compareChains 定位首个分歧步", () => {
  const field = { Ex: c(1), Ey: c(0) };
  const chainA = [
    { type: "polarizer", thetaDeg: 45 },
    { type: "retarder", thetaDeg: 0, deltaDeg: 90 },
  ] as const;
  const chainB = [
    { type: "retarder", thetaDeg: 0, deltaDeg: 90 },
    { type: "polarizer", thetaDeg: 45 },
  ] as const;
  const cmp = compareChains(field, [...chainA], [...chainB]);
  assert.equal(cmp.firstDivergenceIndex, 0);
  assert.ok(cmp.explanation.includes("0"));
});

test("传播不重新归一化: 偏振片后强度保留损耗", () => {
  const r = propagate({ Ex: c(1), Ey: c(0) }, [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 30 },
    { type: "polarizer", thetaDeg: 60 },
  ]);
  closeTo(r.steps[0].outputIntensity, 1);
  closeTo(r.steps[1].outputIntensity, 0.75); // cos^2(30°)
  closeTo(r.steps[2].outputIntensity, 0.5625); // 继续衰减而非归一
});

test("纯态关系 S1²+S2²+S3²=S0² 每步成立，延迟片强度守恒", () => {
  const r = propagate({ Ex: c(0.7, 0.1), Ey: c(-0.3, 0.6) }, [
    { type: "retarder", thetaDeg: 33, deltaDeg: 77 },
    { type: "polarizer", thetaDeg: 10 },
    { type: "qwp", thetaDeg: 80 },
    { type: "hwp", thetaDeg: 5 },
  ]);
  const all = [r.inputStokes, ...r.steps.map((s) => s.stokes)];
  for (const s of all) {
    closeTo(s.S1 ** 2 + s.S2 ** 2 + s.S3 ** 2, s.S0 ** 2, 1e-8);
  }
  for (const st of r.steps) {
    if (st.element.type !== "polarizer") {
      closeTo(st.inputIntensity, st.outputIntensity, 1e-9);
    }
  }
});

test("u/v 投影分解独立核对矩阵传播", () => {
  // 对任意场 E，延迟片输出应为 (E·u)u + exp(iδ)(E·v)v
  const theta = (37 * Math.PI) / 180;
  const delta = (123 * Math.PI) / 180;
  const u = [Math.cos(theta), Math.sin(theta)];
  const v = [-Math.sin(theta), Math.cos(theta)];
  const E: [C, C] = [c(0.4, -0.2), c(0.1, 0.9)];
  const dot = (a: number[], e: [C, C]): C => add(mul(c(a[0]), e[0]), mul(c(a[1]), e[1]));
  const eu = dot(u, E);
  const ev = dot(v, E);
  const p = { re: Math.cos(delta), im: Math.sin(delta) };
  const expected: [C, C] = [
    add(mul(eu, c(u[0])), mul(mul(p, ev), c(v[0]))),
    add(mul(eu, c(u[1])), mul(mul(p, ev), c(v[1]))),
  ];
  const m = elementMatrix(validateElement({ type: "retarder", thetaDeg: 37, deltaDeg: 123 }, 0));
  const got = matVec(m, E);
  closeTo(got[0].re, expected[0].re);
  closeTo(got[0].im, expected[0].im);
  closeTo(got[1].re, expected[1].re);
  closeTo(got[1].im, expected[1].im);
});

test("组合矩阵与逐步传播一致，次序为 Jn...J2*J1", () => {
  const chain = [
    { type: "polarizer", thetaDeg: 20 },
    { type: "retarder", thetaDeg: 50, deltaDeg: 30 },
    { type: "polarizer", thetaDeg: 70 },
  ] as const;
  const field = { Ex: c(1, 0.5), Ey: c(0.2, -0.3) };
  const r = propagate(field, [...chain]);
  const direct = matVec(r.combinedMatrix, r.input);
  closeTo(direct[0].re, r.output[0].re);
  closeTo(direct[0].im, r.output[0].im);
  closeTo(direct[1].re, r.output[1].re);
  closeTo(direct[1].im, r.output[1].im);
});

test("非法输入报错: 非有限场、缺分量、非法元件、超长链", () => {
  assert.throws(() => propagate({ Ex: c(NaN), Ey: c(0) }, []), /E_INVALID_FIELD/);
  assert.throws(() => propagate({ Ey: c(0) } as never, []), /E_INVALID_FIELD/);
  assert.throws(() => propagate({ Ex: c(1), Ey: c(0) }, [{ type: "lens" } as never]), /E_INVALID_ELEMENT/);
  assert.throws(
    () => propagate({ Ex: c(1), Ey: c(0) }, Array(65).fill({ type: "polarizer", thetaDeg: 0 })),
    /E_CHAIN_TOO_LONG/,
  );
  assert.throws(
    () => propagate({ Ex: c(1), Ey: c(0) }, [{ type: "polarizer", thetaDeg: 1e9 }]),
    /E_RANGE/,
  );
});

test("Store: 保存版本、运行冻结、重启复现、非法链不保存", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jones-test-"));
  const dbPath = path.join(dir, "t.db");
  const spec = [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 45 },
    { type: "polarizer", thetaDeg: 90 },
  ] as const;
  let runUuid: string;
  {
    const store = new Store(dbPath);
    const v1 = store.saveChain("exp1", [...spec]);
    const v2 = store.saveChain("exp1", [{ type: "hwp", thetaDeg: 10 }]);
    assert.equal(v1.version, 1);
    assert.equal(v2.version, 2);
    assert.equal(store.getChain("exp1").version, 2);
    assert.equal(store.getChain("exp1", 1).version, 1);
    const run = store.runChain(v1.id, { Ex: c(1), Ey: c(0) });
    runUuid = run.runUuid;
    closeTo(run.result.outputStokes.S0, 0.25);
    // 重复运行不累积
    const run2 = store.runChain(v1.id, { Ex: c(1), Ey: c(0) });
    assert.notEqual(run2.runUuid, runUuid);
    closeTo(run2.result.outputStokes.S0, 0.25);
    // 非法链整体拒绝
    assert.throws(() => store.saveChain("exp1", [{ type: "bad" } as never]), /E_INVALID_ELEMENT/);
    assert.equal(store.getChain("exp1").version, 2);
    store.close();
  }
  {
    // 模拟重启后复现旧报告
    const store = new Store(dbPath);
    const replay = store.getRun(runUuid);
    closeTo(replay.result.outputStokes.S0, 0.25);
    assert.equal(replay.result.algorithmVersion, "jones-seq-1.0.0");
    store.close();
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("EPS 阈值公开且小残差保留", () => {
  assert.ok(EPS > 0);
  const tiny = 1e-4; // 非零但很小，不应被当作单位光强
  const s = stokes(c(tiny), c(0));
  closeTo(s.S0, 1e-8, 1e-16);
  closeTo(s.n1 as number, 1);
});
