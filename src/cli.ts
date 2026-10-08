import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "./store";
import { propagate, compareChains, PropagationResult } from "./propagate";
import { ElementSpec, stokes } from "./jones";
import { C } from "./complex";
import { stokesCsv } from "./api";
import { DB_PATH } from "./server";

function parseField(s: string | undefined): { Ex: C; Ey: C } {
  if (!s) return { Ex: { re: 1, im: 0 }, Ey: { re: 0, im: 0 } };
  const parts = s.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("E_INVALID_FIELD: --field 需要 'Ex_re,Ex_im,Ey_re,Ey_im'");
  }
  return { Ex: { re: parts[0], im: parts[1] }, Ey: { re: parts[2], im: parts[3] } };
}

function parseSpec(s: string): ElementSpec[] {
  const text = fs.existsSync(s) ? fs.readFileSync(s, "utf8") : s;
  return JSON.parse(text) as ElementSpec[];
}

function fmtC(z: C): string {
  const f = (x: number) => (Object.is(x, -0) ? 0 : x).toPrecision(6);
  return `${f(z.re)}${z.im >= 0 ? "+" : ""}${f(z.im)}i`;
}

function printResult(result: PropagationResult): void {
  const row = (tag: string, e: [C, C]) => {
    const s = stokes(e[0], e[1]);
    console.log(
      `${tag.padEnd(8)} Ex=${fmtC(e[0]).padEnd(24)} Ey=${fmtC(e[1]).padEnd(24)} I=${s.S0.toPrecision(6).padEnd(12)} S1=${s.S1.toPrecision(4)} S2=${s.S2.toPrecision(4)} S3=${s.S3.toPrecision(4)}`,
    );
  };
  row("输入", result.input);
  for (const st of result.steps) {
    const el = st.element;
    const delta = el.deltaDegInput === null ? "" : ` delta=${el.deltaDegInput}°`;
    console.log(`#${st.index} ${el.type} theta=${el.thetaDegInput}°${delta}`);
    row("  输出", st.output);
  }
  console.log(`最终强度 I=${result.outputStokes.S0.toPrecision(6)}`);
}

function demo(store: Store): void {
  console.log("== 演示 1: (1,0) → 0°偏振片 → 90°偏振片，最终强度应为 0 ==");
  const r1 = propagate({ Ex: { re: 1, im: 0 }, Ey: { re: 0, im: 0 } }, [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 90 },
  ]);
  printResult(r1);

  console.log("\n== 演示 2: 中间插入 45°偏振片，最终强度应为 1/4 ==");
  const r2 = propagate({ Ex: { re: 1, im: 0 }, Ey: { re: 0, im: 0 } }, [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 45 },
    { type: "polarizer", thetaDeg: 90 },
  ]);
  printResult(r2);

  console.log("\n== 演示 3: (1,1)/√2 → 0°、delta=90° 延迟片，应得 (1,i)/√2，S3=1 ==");
  const s = 1 / Math.sqrt(2);
  const r3 = propagate({ Ex: { re: s, im: 0 }, Ey: { re: s, im: 0 } }, [
    { type: "retarder", thetaDeg: 0, deltaDeg: 90 },
  ]);
  printResult(r3);

  console.log("\n== 演示 4: 链保存/版本/复现（experiment='demo'） ==");
  const saved = store.saveChain("demo", [
    { type: "polarizer", thetaDeg: 0 },
    { type: "polarizer", thetaDeg: 45 },
    { type: "polarizer", thetaDeg: 90 },
  ]);
  const { runUuid, result } = store.runChain(saved.id, { Ex: { re: 1, im: 0 }, Ey: { re: 0, im: 0 } });
  console.log(`已保存链 id=${saved.id} version=${saved.version}，运行 runUuid=${runUuid}，最终强度=${result.outputStokes.S0.toPrecision(6)}`);
  const replay = store.getRun(runUuid);
  console.log(`重启后可按 runUuid 复现，冻结强度=${replay.result.outputStokes.S0.toPrecision(6)}`);
}

function main(): void {
  const [, , cmd, ...args] = process.argv;
  const store = new Store(DB_PATH);
  try {
    switch (cmd) {
      case "demo":
        demo(store);
        break;
      case "save": {
        const [experiment, specArg] = args;
        if (!experiment || !specArg) throw new Error("用法: cli save <experiment> <spec-json|文件路径>");
        const saved = store.saveChain(experiment, parseSpec(specArg));
        console.log(JSON.stringify(saved, null, 2));
        break;
      }
      case "run": {
        const id = Number(args[0]);
        const fieldIdx = args.indexOf("--field");
        const field = parseField(fieldIdx >= 0 ? args[fieldIdx + 1] : undefined);
        if (!Number.isInteger(id)) throw new Error("用法: cli run <chainId> [--field re,im,re,im]");
        const { runUuid, result } = store.runChain(id, field);
        console.log(`runUuid=${runUuid}`);
        printResult(result);
        break;
      }
      case "step": {
        const [runUuid, iStr] = args;
        const run = store.getRun(runUuid);
        const i = Number(iStr);
        if (!Number.isInteger(i) || i < 0 || i >= run.result.steps.length) {
          throw new Error(`E_NOT_FOUND: 步序号超出范围 0..${run.result.steps.length - 1}`);
        }
        console.log(JSON.stringify(run.result.steps[i], null, 2));
        break;
      }
      case "compare": {
        const get = (k: string) => {
          const i = args.indexOf(k);
          return i >= 0 ? args[i + 1] : undefined;
        };
        const field = parseField(get("--field"));
        const a = get("--a");
        const b = get("--b");
        if (!a || !b) throw new Error("用法: cli compare --field re,im,re,im --a '<json>' --b '<json>'");
        const cmp = compareChains(field, parseSpec(a), parseSpec(b));
        console.log(cmp.explanation);
        console.log(`firstDivergenceIndex=${cmp.firstDivergenceIndex}`);
        console.log("链A:"); printResult(cmp.a);
        console.log("链B:"); printResult(cmp.b);
        break;
      }
      case "export": {
        const [runUuid, what = "stokes", format = "table"] = args;
        const run = store.getRun(runUuid);
        if (what === "matrix") {
          console.log(JSON.stringify(run.result.combinedMatrix, null, 2));
        } else if (format === "csv") {
          process.stdout.write(stokesCsv(run.result));
        } else {
          printResult(run.result);
        }
        break;
      }
      case "list":
        console.log(JSON.stringify({ chains: store.listChains(), runs: store.listRuns() }, null, 2));
        break;
      default:
        console.log(`用法:
  cli demo                                  运行内置演示
  cli save <experiment> <spec-json|文件>    保存链（自动生成新版本）
  cli run <chainId> [--field re,im,re,im]   运行传播（默认场 (1,0)）
  cli step <runUuid> <i>                    查询单步
  cli compare --field ... --a '<json>' --b '<json>'   比较两条链
  cli export <runUuid> [matrix|stokes] [csv] 导出矩阵或 Stokes 表
  cli list                                  列出链与运行`);
    }
  } finally {
    store.close();
  }
}

main();
