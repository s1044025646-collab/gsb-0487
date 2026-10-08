import { Store } from "../dist/src/store.js";
import { startServer, findFreePort } from "../dist/src/server.js";

const dbPath = process.argv[2] || "data/smoke.db";
const store = new Store(dbPath);
const port = await findFreePort(0);
const { server } = await startServer(store, port);
const base = `http://127.0.0.1:${port}`;

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, json };
}

const results = [];
function check(name, cond, extra = "") {
  results.push({ name, ok: !!cond, extra });
}

const health = await call("GET", "/health");
check("health 200", health.status === 200 && health.json.algorithmVersion === "jones-1.0.0");

const crossed = await call("POST", "/api/experiments", {
  experimentId: "crossed",
  field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
  components: [
    { kind: "polarizer", thetaDeg: 0 },
    { kind: "polarizer", thetaDeg: 90 },
  ],
});
check("crossed 保存成功", crossed.status === 201);
check("crossed 最终强度=0", Math.abs(crossed.json.report.finalIntensity) < 1e-12);

const three = await call("POST", "/api/experiments", {
  experimentId: "three",
  field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
  components: [
    { kind: "polarizer", thetaDeg: 0 },
    { kind: "polarizer", thetaDeg: 45 },
    { kind: "polarizer", thetaDeg: 90 },
  ],
});
check("three 最终强度=1/4", Math.abs(three.json.report.finalIntensity - 0.25) < 1e-12);

const runId = crossed.json.runId;
const step = await call("GET", `/api/runs/${runId}/steps?step=1`);
check("单步查询", step.status === 200 && step.json.stepResult.index === 1);
const mats = await call("GET", `/api/runs/${runId}/matrices`);
check("矩阵导出", mats.status === 200 && mats.json.matrices.length === 2);
const stk = await call("GET", `/api/runs/${runId}/stokes`);
check("Stokes 表", stk.status === 200 && Math.abs(stk.json.final.s0) < 1e-12);

const cmp = await call("POST", "/api/compare", {
  a: { experimentId: "crossed" },
  b: { experimentId: "three" },
});
check("比较链", cmp.status === 200 && cmp.json.comparison.earliestDivergenceStep === 1);

// 版本化：修改链另存版本，旧版仍可复现
const v2 = await call("POST", "/api/experiments", {
  experimentId: "crossed",
  field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
  components: [{ kind: "polarizer", thetaDeg: 0 }],
});
check("新版本号=2", v2.json.configVersion === 2);
const oldCfg = await call("GET", "/api/experiments/crossed?version=1");
check("旧版本仍是 2 元件", oldCfg.json.components.length === 2);

// 错误处理：非有限数
const bad = await call("POST", "/api/experiments", {
  experimentId: "bad",
  field: { ex: { re: Infinity, im: 0 }, ey: { re: 0, im: 0 } },
  components: [],
});
check("非有限数报错", bad.status === 422 && bad.json.error.code === "NON_FINITE_NUMBER");

// 过长链不应保存
  const long = await call("POST", "/api/experiments", {
  experimentId: "long",
  field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
  components: Array.from({ length: 65 }, () => ({ kind: "polarizer", thetaDeg: 0 })),
});
check("过长链拒绝且不保存", long.status === 422 && long.json.error.code === "CHAIN_TOO_LONG");
const listLong = await call("GET", "/api/experiments");
check("拒绝后无 long 实验", !listLong.json.experiments.some((e) => e.experimentId === "long"));

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name} ${r.extra}`);
const failed = results.filter((r) => !r.ok);
server.close(() => {
  if (failed.length > 0) {
    console.error(`${failed.length} 项失败`);
    process.exitCode = 1;
  }
});
