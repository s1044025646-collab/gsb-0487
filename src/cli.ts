#!/usr/bin/env node
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { findFreePort, startServer } from "./server.js";
import { Store } from "./store.js";
import { validateChain, validateField } from "./components.js";
import { compareReports } from "./compare.js";
import { renderReport, fmtVec } from "./format.js";
import { DEMO_CASES } from "./demo.js";
import { JonesError } from "./types.js";

const DEFAULT_DB = resolve(process.cwd(), "data", "jones.db");

function usage(): string {
  return [
 "用法: jones <命令> [选项]",
    "",
    "命令:",
    "  serve [--port <n>] [--db <path>]        启动 HTTP API（默认自动选空闲端口）",
    "  demo  [--db <path>]                     运行内置演示并打印实虚部/强度表",
    "  analyze --file <json> [--save <expId>]  从 JSON 读场与元件链，离线计算（可选入库）",
    "  compare --a <expId> --b <expId> [--av <n>] [--bv <n>] [--db <path>]",
    "  runs <expId> [--db <path>]              列出某实验的运行",
    "  help",
    "",
    "JSON 输入格式:",
    '  {"field":{"ex":{"re":1,"im":0},"ey":{"re":0,"im":0}},',
    '   "components":[{"kind":"polarizer","thetaDeg":0},',
    '                 {"kind":"retarder","thetaDeg":0,"deltaDeg":90}]}',
  ].join("\n");
}

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const m = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        m.set(key, next);
        i++;
      } else {
        m.set(key, true);
      }
    }
  }
  return m;
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const dbPath = typeof args.get("db") === "string" ? (args.get("db") as string) : DEFAULT_DB;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(usage());
    return 0;
  }

  try {
    if (cmd === "serve") {
      const preferred = args.get("port");
      const store = new Store(dbPath);
      const desired = typeof preferred === "string" ? Number(preferred) : undefined;
      const port = await findFreePort(desired);
      const { server } = await startServer(store, port);
      console.log(`Jones 后端已启动: http://127.0.0.1:${port}`);
      console.log(`数据文件: ${dbPath}`);
      console.log("健康检查: GET /health ；Ctrl+C 退出");
      const shutdown = () => {
        server.close(() => {
          store.close();
          process.exit(0);
        });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return 0;
    }

    if (cmd === "demo") {
      const store = new Store(dbPath);
      for (const dc of DEMO_CASES) {
        const field = validateField(dc.field);
        const saved = store.saveAndRun(
          dc.experimentId,
          field,
          validateChain(dc.components),
        );
        console.log("=".repeat(88));
        console.log(dc.title);
        console.log(`期望: ${dc.expect}`);
        console.log(renderReport(saved.report));
        console.log();
      }
      store.close();
      console.log(`演示已写入数据库: ${dbPath}`);
      return 0;
    }

    if (cmd === "analyze") {
      const file = args.get("file");
      if (typeof file !== "string") {
        throw new JonesError("INVALID_QUERY", "analyze 需要 --file <json>");
      }
      const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const field = validateField(raw.field);
      const components = validateChain(raw.components);
      const saveId = args.get("save");
      if (typeof saveId === "string") {
        const store = new Store(dbPath);
        const saved = store.saveAndRun(saveId, field, components);
        console.log(renderReport(saved.report));
        store.close();
      } else {
        const { propagate } = await import("./propagate.js");
        const report = propagate({
          inputField: field,
          components,
          runId: "ad-hoc",
          experimentId: "ad-hoc",
          configVersion: 0,
        });
        console.log(renderReport(report));
      }
      return 0;
    }

    if (cmd === "compare") {
      const a = args.get("a");
      const b = args.get("b");
      if (typeof a !== "string" || typeof b !== "string") {
        throw new JonesError("INVALID_QUERY", "compare 需要 --a <expId> --b <expId>");
      }
      const store = new Store(dbPath);
      const ra = store.rerun(a, typeof args.get("av") === "string" ? Number(args.get("av")) : undefined);
      const rb = store.rerun(b, typeof args.get("bv") === "string" ? Number(args.get("bv")) : undefined);
      store.close();
      const { compareReports } = await import("./compare.js");
      const cmp = compareReports(ra, rb);
      console.log(`A: ${a} 最终 E=${fmtVec(ra.finalField)} I=${ra.finalIntensity.toFixed(8)}`);
      console.log(`B: ${b} 最终 E=${fmtVec(rb.finalField)} I=${rb.finalIntensity.toFixed(8)}`);
      console.log(cmp.reason);
      for (const d of cmp.stepDeltas) {
        console.log(
          `  step ${d.step}: maxFieldDiff=${d.maxAbsFieldDiff.toExponential(2)} intensityDiff=${d.intensityDiff.toExponential(2)} ${d.equal ? "相同" : "不同"}`,
        );
      }
      return 0;
    }

    if (cmd === "runs") {
      const expId = rest.find((x) => !x.startsWith("--"));
      if (!expId) throw new JonesError("INVALID_QUERY", "runs 需要 <expId>");
      const store = new Store(dbPath);
      const runs = store.listRuns(expId);
      store.close();
      if (runs.length === 0) console.log("(无运行记录)");
      for (const r of runs) console.log(`${r.runId}  v${r.configVersion}  ${r.createdAt}`);
      return 0;
    }

    console.error(`未知命令: ${cmd}\n`);
    console.error(usage());
    return 2;
  } catch (err) {
    if (err instanceof JonesError) {
      console.error(`错误 [${err.code}]${err.path ? ` (${err.path})` : ""}: ${err.message}`);
      return 1;
    }
    console.error(`错误: ${String((err as Error).message)}`);
    return 1;
  }
}

void main().then((code) => {
  process.exitCode = code;
});
