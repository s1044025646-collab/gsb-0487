import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ElementSpec, validateChain, validateElement, ALGORITHM_VERSION, CONVENTION, EPS } from "./jones";
import { propagate, PropagationResult } from "./propagate";
import { C, ValidationError } from "./complex";

export interface ChainRow {
  id: number;
  experiment: string;
  version: number;
  spec: ElementSpec[];
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment TEXT NOT NULL,
        version INTEGER NOT NULL,
        spec_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_uuid TEXT NOT NULL UNIQUE,
        chain_id INTEGER NOT NULL REFERENCES chains(id),
        field_json TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        convention_json TEXT NOT NULL,
        eps REAL NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 保存元件链；同 experiment 每次保存生成新版本，旧版本不可变 */
  saveChain(experiment: string, spec: ElementSpec[]): ChainRow {
    if (!experiment || typeof experiment !== "string") {
      throw new ValidationError("E_INVALID_EXPERIMENT: experiment 名称必须是非空字符串");
    }
    validateChain(spec);
    spec.forEach((s, i) => validateElement(s, i)); // 非法链整体拒绝，绝不截断保存
    const row = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM chains WHERE experiment = ?")
      .get(experiment) as { v: number };
    const version = row.v + 1;
    const createdAt = new Date().toISOString();
    const info = this.db
      .prepare("INSERT INTO chains (experiment, version, spec_json, created_at) VALUES (?, ?, ?, ?)")
      .run(experiment, version, JSON.stringify(spec), createdAt);
    return { id: Number(info.lastInsertRowid), experiment, version, spec, createdAt };
  }

  getChain(experiment: string, version?: number): ChainRow {
    const row = (version === undefined
      ? this.db.prepare("SELECT * FROM chains WHERE experiment = ? ORDER BY version DESC LIMIT 1").get(experiment)
      : this.db.prepare("SELECT * FROM chains WHERE experiment = ? AND version = ?").get(experiment, version)) as
      | { id: number; experiment: string; version: number; spec_json: string; created_at: string }
      | undefined;
    if (!row) {
      throw new ValidationError(`E_NOT_FOUND: 找不到链 experiment='${experiment}'${version === undefined ? "" : ` version=${version}`}`);
    }
    return {
      id: row.id,
      experiment: row.experiment,
      version: row.version,
      spec: JSON.parse(row.spec_json) as ElementSpec[],
      createdAt: row.created_at,
    };
  }

  listChains(experiment?: string): Omit<ChainRow, "spec">[] {
    const rows = (experiment
      ? this.db.prepare("SELECT id, experiment, version, created_at FROM chains WHERE experiment = ? ORDER BY version").all(experiment)
      : this.db.prepare("SELECT id, experiment, version, created_at FROM chains ORDER BY experiment, version").all()) as unknown as
      { id: number; experiment: string; version: number; created_at: string }[];
    return rows.map((r) => ({ id: r.id, experiment: r.experiment, version: r.version, createdAt: r.created_at }));
  }

  /** 运行传播并冻结结果；每次调用独立，不累积上次输出 */
  runChain(chainId: number, field: { Ex: C; Ey: C }): { runUuid: string; result: PropagationResult } {
    const row = this.db.prepare("SELECT spec_json FROM chains WHERE id = ?").get(chainId) as
      | { spec_json: string }
      | undefined;
    if (!row) {
      throw new ValidationError(`E_NOT_FOUND: 找不到链 id=${chainId}`);
    }
    const spec = JSON.parse(row.spec_json) as ElementSpec[];
    const result = propagate(field, spec); // 校验失败则抛错，不会写入任何记录
    const runUuid = randomUUID();
    this.db
      .prepare(
        "INSERT INTO runs (run_uuid, chain_id, field_json, algorithm_version, convention_json, eps, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        runUuid,
        chainId,
        JSON.stringify(field),
        ALGORITHM_VERSION,
        JSON.stringify(CONVENTION),
        EPS,
        JSON.stringify(result),
        new Date().toISOString(),
      );
    return { runUuid, result };
  }

  getRun(runUuid: string): { runUuid: string; chainId: number; result: PropagationResult; createdAt: string } {
    const row = this.db
      .prepare("SELECT run_uuid, chain_id, result_json, created_at FROM runs WHERE run_uuid = ?")
      .get(runUuid) as
      | { run_uuid: string; chain_id: number; result_json: string; created_at: string }
      | undefined;
    if (!row) {
      throw new ValidationError(`E_NOT_FOUND: 找不到运行 ${runUuid}`);
    }
    return {
      runUuid: row.run_uuid,
      chainId: row.chain_id,
      result: JSON.parse(row.result_json) as PropagationResult,
      createdAt: row.created_at,
    };
  }

  listRuns(chainId?: number): { runUuid: string; chainId: number; createdAt: string }[] {
    const rows = (chainId === undefined
      ? this.db.prepare("SELECT run_uuid, chain_id, created_at FROM runs ORDER BY id").all()
      : this.db.prepare("SELECT run_uuid, chain_id, created_at FROM runs WHERE chain_id = ? ORDER BY id").all(chainId)) as unknown as
      { run_uuid: string; chain_id: number; created_at: string }[];
    return rows.map((r) => ({ runUuid: r.run_uuid, chainId: r.chain_id, createdAt: r.created_at }));
  }
}
