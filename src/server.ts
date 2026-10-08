import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { ALGORITHM_VERSION, CONVENTION, LIMITS, NUMERIC_THRESHOLDS } from "./constants.js";
import { validateChain, validateField } from "./components.js";
import { compareReports } from "./compare.js";
import { Store } from "./store.js";
import type { ErrorCode, PropagationReport } from "./types.js";
import { JonesError } from "./types.js";

export function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.on("error", reject);
    srv.listen(preferred ?? 0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("无法获取空闲端口")));
      }
    });
  });
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new JonesError("INVALID_JSON", "请求体超过 4MB 限制"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new JonesError("INVALID_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
}

function errorBody(code: ErrorCode, message: string, path?: string) {
  return { ok: false as const, error: { code, message, path } };
}

function validateExperimentId(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) {
    throw new JonesError("INVALID_QUERY", "缺少 experimentId", "experimentId");
  }
  if (raw.length > LIMITS.MAX_EXPERIMENT_ID_LENGTH) {
    throw new JonesError("ID_TOO_LONG", `experimentId 长度超过 ${LIMITS.MAX_EXPERIMENT_ID_LENGTH}`);
  }
  return raw;
}

// 只导出某一步
function singleStep(report: PropagationReport, step: number) {
  if (!Number.isInteger(step) || step < 0 || step >= report.steps.length) {
    throw new JonesError(
      "INVALID_QUERY",
      `step 必须是 [0, ${report.steps.length - 1}] 内的整数（当前链长 ${report.steps.length}）`,
      "step",
    );
  }
  return {
    runId: report.runId,
    experimentId: report.experimentId,
    step,
    stepResult: report.steps[step],
  };
}

function matricesTable(report: PropagationReport) {
  return {
    runId: report.runId,
    experimentId: report.experimentId,
    combinedMatrix: report.combinedMatrix,
    matrices: report.components.map((comp) => ({
      index: comp.index,
      kind: comp.kind,
      thetaDeg: comp.thetaDeg,
      thetaCanonicalDeg: comp.thetaCanonicalDeg,
      effectiveDeltaDeg: comp.effectiveDeltaDeg,
      matrix: comp.matrix,
    })),
  };
}

function stokesTable(report: PropagationReport) {
  return {
    runId: report.runId,
    experimentId: report.experimentId,
    input: report.inputStokes,
    steps: report.steps.map((s) => ({
      step: s.index,
      kind: s.kind,
      intensityBefore: s.intensityBefore,
      intensityAfter: s.intensityAfter,
      stokesBefore: s.stokesBefore,
      stokesAfter: s.stokesAfter,
      pureStateResidual: s.pureStateResidual,
      retarderLoss: s.retarderLoss,
    })),
    final: report.finalStokes,
  };
}

export function startServer(store: Store, port: number): Promise<{ server: Server; port: number }> {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (method === "GET" && path === "/health") {
        send(res, 200, {
          ok: true,
          algorithmVersion: ALGORITHM_VERSION,
          convention: CONVENTION,
          limits: LIMITS,
          numericThresholds: NUMERIC_THRESHOLDS,
        });
        return;
      }

      // POST /api/experiments  {experimentId, field:{ex,ey}, components:[...]}
      if (method === "POST" && path === "/api/experiments") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const experimentId = validateExperimentId(body.experimentId);
        const field = validateField(body.field);
        const components = validateChain(body.components);
        const saved = store.saveAndRun(experimentId, field, components);
        send(res, 201, {
          ok: true,
          experimentId,
          configVersion: saved.configVersion,
          runId: saved.runId,
          report: saved.report,
        });
        return;
      }

      if (method === "GET" && path === "/api/experiments") {
        send(res, 200, { ok: true, experiments: store.listExperiments() });
        return;
      }

      const expMatch = path.match(/^\/api\/experiments\/([^/]+)$/);
      if (method === "GET" && expMatch) {
        const experimentId = decodeURIComponent(expMatch[1]!);
        const versionRaw = url.searchParams.get("version");
        const version = versionRaw === null ? undefined : Number(versionRaw);
        if (versionRaw !== null && (!Number.isInteger(version) || version! < 1)) {
          throw new JonesError("INVALID_QUERY", "version 必须是正整数", "version");
        }
        const cfg = store.getConfig(experimentId, version);
        send(res, 200, {
          ok: true,
          experimentId,
          configVersion: cfg.version,
          field: { ex: cfg.field[0], ey: cfg.field[1] },
          components: cfg.components,
          algorithmVersion: cfg.algorithmVersion,
          versions: store.listVersions(experimentId),
        });
        return;
      }

      // POST /api/analyze {experimentId, version?} 用冻结参数复算并返回完整报告
      if (method === "POST" && path === "/api/analyze") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const experimentId = validateExperimentId(body.experimentId);
        const version = body.version === undefined ? undefined : Number(body.version);
        const report = store.rerun(experimentId, version);
        send(res, 200, { ok: true, report });
        return;
      }

      // GET /api/runs/:runId
      const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
      if (method === "GET" && runMatch) {
        const report = store.getRun(decodeURIComponent(runMatch[1]!));
        send(res, 200, { ok: true, report });
        return;
      }

      // GET /api/runs/:runId/steps?step=k
      const stepMatch = path.match(/^\/api\/runs\/([^/]+)\/steps$/);
      if (method === "GET" && stepMatch) {
        const report = store.getRun(decodeURIComponent(stepMatch[1]!));
        const step = Number(url.searchParams.get("step"));
        send(res, 200, { ok: true, ...singleStep(report, step) });
        return;
      }

      // GET /api/runs/:runId/matrices
      const matMatch = path.match(/^\/api\/runs\/([^/]+)\/matrices$/);
      if (method === "GET" && matMatch) {
        const report = store.getRun(decodeURIComponent(matMatch[1]!));
        send(res, 200, { ok: true, ...matricesTable(report) });
        return;
      }

      // GET /api/runs/:runId/stokes
      const stkMatch = path.match(/^\/api\/runs\/([^/]+)\/stokes$/);
      if (method === "GET" && stkMatch) {
        const report = store.getRun(decodeURIComponent(stkMatch[1]!));
        send(res, 200, { ok: true, ...stokesTable(report) });
        return;
      }

      // POST /api/compare  {a:{experimentId,version?}, b:{experimentId,version?}}
      if (method === "POST" && path === "/api/compare") {
        const body = (await readJson(req)) as Record<string, unknown>;
        const pick = (key: string): PropagationReport => {
          const node = body[key] as Record<string, unknown> | undefined;
          if (!node) throw new JonesError("INVALID_QUERY", `缺少 ${key}`, key);
          const id = validateExperimentId(node.experimentId);
          return store.rerun(id, node.version === undefined ? undefined : Number(node.version));
        };
        const a = pick("a");
        const b = pick("b");
        send(res, 200, {
          ok: true,
          inputSame:
            JSON.stringify(a.inputField) === JSON.stringify(b.inputField),
          comparison: compareReports(a, b),
          runA: { runId: a.runId, experimentId: a.experimentId, version: a.configVersion },
          runB: { runId: b.runId, experimentId: b.experimentId, version: b.configVersion },
        });
        return;
      }

      send(res, 404, errorBody("NOT_FOUND", `未找到路由：${method} ${path}`));
    } catch (err) {
      if (err instanceof JonesError) {
        send(res, err.status, errorBody(err.code, err.message, err.path));
      } else {
        send(res, 500, errorBody("NUMERIC_OVERFLOW", `内部错误：${String((err as Error).message)}`));
      }
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port }));
  });
}
