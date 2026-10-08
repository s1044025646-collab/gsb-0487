import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ALGORITHM_VERSION } from "./constants.js";
import { propagate } from "./propagate.js";
import type { PropagationReport, StoredComponent, Vec2 } from "./types.js";
import { JonesError } from "./types.js";

interface ConfigRow {
  id: number;
  experiment_id: string;
  version: number;
  field_ex_re: number;
  field_ex_im: number;
  field_ey_re: number;
  field_ey_im: number;
  components_json: string;
  convention_json: string;
  algorithm_version: string;
  created_at: string;
}

interface RunRow {
  id: number;
  run_id: string;
  config_id: number;
  experiment_id: string;
  config_version: number;
  report_json: string;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    const abs = resolve(dbPath);
    mkdirSync(dirname(abs), { recursive: true });
    this.db = new DatabaseSync(abs);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS configs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        experiment_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        field_ex_re REAL NOT NULL,
        field_ex_im REAL NOT NULL,
        field_ey_re REAL NOT NULL,
        field_ey_im REAL NOT NULL,
        components_json TEXT NOT NULL,
        convention_json TEXT NOT NULL,
        algorithm_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(experiment_id, version)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL UNIQUE,
        config_id INTEGER NOT NULL,
        experiment_id TEXT NOT NULL,
        config_version INTEGER NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(config_id) REFERENCES configs(id)
      );
    `);
  }

  // 保存冻结配置并立即运行；整条链在一个事务里，失败不产生截断/半成品记录
  saveAndRun(
    experimentId: string,
    field: Vec2,
    components: StoredComponent[],
  ): { configVersion: number; runId: string; report: PropagationReport } {
    const runId = randomUUID();
    const tx = this.db.prepare("BEGIN IMMEDIATE");
    const commit = this.db.prepare("COMMIT");
    const rollback = this.db.prepare("ROLLBACK");
    tx.run();
    try {
      const maxRow = this.db
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM configs WHERE experiment_id = ?")
        .get(experimentId) as { v: number };
      const version = (maxRow.v as number) + 1;

      const report = propagate({
        inputField: field,
        components,
        runId,
        experimentId,
        configVersion: version,
      });

      const insCfg = this.db.prepare(`
        INSERT INTO configs
          (experiment_id, version, field_ex_re, field_ex_im, field_ey_re, field_ey_im,
           components_json, convention_json, algorithm_version, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `);
      const info = insCfg.run(
        experimentId,
        version,
        field[0].re,
        field[0].im,
        field[1].re,
        field[1].im,
        JSON.stringify(components),
        JSON.stringify(report.convention),
        ALGORITHM_VERSION,
        new Date().toISOString(),
      );
      const configId = typeof info.lastInsertRowid === "bigint"
        ? Number(info.lastInsertRowid)
        : info.lastInsertRowid;

      this.db
        .prepare(`
          INSERT INTO runs (run_id, config_id, experiment_id, config_version, report_json, created_at)
          VALUES (?,?,?,?,?,?)
        `)
        .run(
          runId,
          configId,
          experimentId,
          version,
          JSON.stringify(report),
          new Date().toISOString(),
        );
      commit.run();
      return { configVersion: version, runId, report };
    } catch (err) {
      rollback.run();
      throw err;
    }
  }

  private parseComponents(s: string): StoredComponent[] {
    return JSON.parse(s) as StoredComponent[];
  }

  private fieldOf(row: ConfigRow): Vec2 {
    return [
      { re: row.field_ex_re, im: row.field_ex_im },
      { re: row.field_ey_re, im: row.field_ey_im },
    ];
  }

  listExperiments(): Array<{ experimentId: string; latestVersion: number; updatedAt: string }> {
    return this.db
      .prepare(
        `SELECT experiment_id, MAX(version) AS v, MAX(created_at) AS t
         FROM configs GROUP BY experiment_id ORDER BY experiment_id`,
      )
      .all()
      .map((r) => {
        const row = r as { experiment_id: string; v: number; t: string };
        return { experimentId: row.experiment_id, latestVersion: row.v, updatedAt: row.t };
      });
  }

  listVersions(experimentId: string): Array<{ version: number; createdAt: string }> {
    const rows = this.db
      .prepare("SELECT version, created_at FROM configs WHERE experiment_id = ? ORDER BY version")
      .all(experimentId) as Array<{ version: number; created_at: string }>;
    if (rows.length === 0) {
      throw new JonesError("NOT_FOUND", `实验不存在：${experimentId}`, "experimentId");
    }
    return rows.map((r) => ({ version: r.version, createdAt: r.created_at }));
  }

  getConfig(experimentId: string, version?: number): {
    version: number;
    field: Vec2;
    components: StoredComponent[];
    algorithmVersion: string;
  } {
    const row =
      version === undefined
        ? (this.db
            .prepare(
              "SELECT * FROM configs WHERE experiment_id = ? ORDER BY version DESC LIMIT 1",
            )
            .get(experimentId) as ConfigRow | undefined)
        : (this.db
            .prepare("SELECT * FROM configs WHERE experiment_id = ? AND version = ?")
            .get(experimentId, version) as ConfigRow | undefined);
    if (!row) {
      throw new JonesError(
        "NOT_FOUND",
        version === undefined
          ? `实验不存在：${experimentId}`
          : `实验 ${experimentId} 不存在版本 ${version}`,
        "version",
      );
    }
    return {
      version: row.version,
      field: this.fieldOf(row),
      components: this.parseComponents(row.components_json),
      algorithmVersion: row.algorithm_version,
    };
  }

  // 用冻结参数重新运行，保证与旧报告一致（算法版本固定）
  rerun(experimentId: string, version?: number): PropagationReport {
    const cfg = this.getConfig(experimentId, version);
    return propagate({
      inputField: cfg.field,
      components: cfg.components,
      runId: `rerun-${experimentId}-v${cfg.version}-${randomUUID()}`,
      experimentId,
      configVersion: cfg.version,
    });
  }

  getRun(runId: string): PropagationReport {
    const row = this.db.prepare("SELECT report_json FROM runs WHERE run_id = ?").get(runId) as
      | { report_json: string }
      | undefined;
    if (!row) {
      throw new JonesError("NOT_FOUND", `运行不存在：${runId}`, "runId");
    }
    return JSON.parse(row.report_json) as PropagationReport;
  }

  listRuns(experimentId: string): Array<{ runId: string; configVersion: number; createdAt: string }> {
    return (
      this.db
        .prepare(
          "SELECT run_id, config_version, created_at FROM runs WHERE experiment_id = ? ORDER BY id",
        )
        .all(experimentId) as Array<{ run_id: string; config_version: number; created_at: string }>
    ).map((r) => ({ runId: r.run_id, configVersion: r.config_version, createdAt: r.created_at }));
  }

  close(): void {
    this.db.close();
  }
}
