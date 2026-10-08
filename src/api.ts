import * as http from "node:http";
import { Store } from "./store";
import { propagate, compareChains } from "./propagate";
import { ElementSpec, MAX_CHAIN_LENGTH, MAX_ABS_ANGLE_DEG, MAX_ABS_DELTA_DEG, EPS, ALGORITHM_VERSION } from "./jones";
import { C, ValidationError } from "./complex";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new ValidationError("E_TOO_LARGE: 请求体超过 1MB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new ValidationError("E_BAD_JSON: 请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

export function stokesCsv(result: ReturnType<typeof propagate>): string {
  const lines = ["step,S0,S1,S2,S3,n1,n2,n3"];
  const fmt = (v: number | null) => (v === null ? "" : String(v));
  const push = (step: string, s: { S0: number; S1: number; S2: number; S3: number; n1: number | null; n2: number | null; n3: number | null }) =>
    lines.push([step, s.S0, s.S1, s.S2, s.S3, fmt(s.n1), fmt(s.n2), fmt(s.n3)].join(","));
  push("input", result.inputStokes);
  result.steps.forEach((st) => push(String(st.index), st.stokes));
  return lines.join("\n") + "\n";
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      // GET /meta
      if (req.method === "GET" && url.pathname === "/meta") {
        return send(res, 200, {
          algorithmVersion: ALGORITHM_VERSION,
          eps: EPS,
          limits: { MAX_CHAIN_LENGTH, MAX_ABS_ANGLE_DEG, MAX_ABS_DELTA_DEG },
        });
      }
      // POST /chains {experiment, spec}
      if (req.method === "POST" && url.pathname === "/chains") {
        const body = (await readBody(req)) as { experiment?: string; spec?: ElementSpec[] };
        const saved = store.saveChain(body.experiment as string, body.spec as ElementSpec[]);
        return send(res, 201, saved);
      }
      // GET /chains?experiment=
      if (req.method === "GET" && url.pathname === "/chains") {
        return send(res, 200, store.listChains(url.searchParams.get("experiment") ?? undefined));
      }
      // GET /chains/:experiment[/:version]
      if (req.method === "GET" && parts[0] === "chains" && parts.length >= 2) {
        const version = parts[2] === undefined ? undefined : Number(parts[2]);
        if (version !== undefined && !Number.isInteger(version)) {
          throw new ValidationError("E_INVALID_PARAM: version 必须是整数");
        }
        return send(res, 200, store.getChain(decodeURIComponent(parts[1]), version));
      }
      // POST /chains/:id/run {field:{Ex,Ey}}
      if (req.method === "POST" && parts[0] === "chains" && parts[2] === "run") {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new ValidationError("E_INVALID_PARAM: 链 id 必须是整数");
        const body = (await readBody(req)) as { field?: { Ex: C; Ey: C } };
        if (!body.field) throw new ValidationError("E_INVALID_FIELD: 缺少 field");
        const out = store.runChain(id, body.field);
        return send(res, 201, out);
      }
      // GET /runs/:uuid
      if (req.method === "GET" && parts[0] === "runs" && parts.length === 2) {
        return send(res, 200, store.getRun(parts[1]));
      }
      // GET /runs/:uuid/steps/:i
      if (req.method === "GET" && parts[0] === "runs" && parts[2] === "steps") {
        const run = store.getRun(parts[1]);
        const i = Number(parts[3]);
        if (!Number.isInteger(i) || i < 0 || i >= run.result.steps.length) {
          throw new ValidationError(`E_NOT_FOUND: 步序号 ${parts[3]} 超出范围 0..${run.result.steps.length - 1}`);
        }
        return send(res, 200, run.result.steps[i]);
      }
      // GET /runs/:uuid/export?what=matrix|stokes&format=json|csv
      if (req.method === "GET" && parts[0] === "runs" && parts[2] === "export") {
        const run = store.getRun(parts[1]);
        const what = url.searchParams.get("what") ?? "stokes";
        const format = url.searchParams.get("format") ?? "json";
        if (what === "matrix") {
          return send(res, 200, { runUuid: run.runUuid, combinedMatrix: run.result.combinedMatrix, steps: run.result.steps.map((s) => ({ index: s.index, matrix: s.matrix })) });
        }
        if (what === "stokes") {
          if (format === "csv") {
            res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8" });
            return res.end(stokesCsv(run.result));
          }
          return send(res, 200, { runUuid: run.runUuid, input: run.result.inputStokes, steps: run.result.steps.map((s) => ({ index: s.index, stokes: s.stokes })) });
        }
        throw new ValidationError("E_INVALID_PARAM: what 必须是 matrix 或 stokes");
      }
      // POST /compare {field, chainA, chainB}（直接给元件规格数组）
      if (req.method === "POST" && url.pathname === "/compare") {
        const body = (await readBody(req)) as { field?: { Ex: C; Ey: C }; chainA?: ElementSpec[]; chainB?: ElementSpec[] };
        if (!body.field || !body.chainA || !body.chainB) {
          throw new ValidationError("E_INVALID_PARAM: 需要 field、chainA、chainB");
        }
        return send(res, 200, compareChains(body.field, body.chainA, body.chainB));
      }
      send(res, 404, { error: "E_NOT_FOUND: 路由不存在", path: url.pathname });
    } catch (err) {
      if (err instanceof ValidationError) {
        send(res, 400, { error: err.message, code: err.code });
      } else {
        send(res, 500, { error: `E_INTERNAL: ${(err as Error).message}` });
      }
    }
  });
}
