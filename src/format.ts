import { intensity } from "./stokes.js";
import type { PropagationReport, Vec2 } from "./types.js";

export function fmtC(v: { re: number; im: number }): string {
  const sign = v.im >= 0 ? "+" : "-";
  return `${v.re.toFixed(4)}${sign}${Math.abs(v.im).toFixed(4)}i`;
}

export function fmtVec(v: Vec2): string {
  return `[${fmtC(v[0])}, ${fmtC(v[1])}]`;
}

function line(): string {
  return "-".repeat(88);
}

export function renderReport(r: PropagationReport): string {
  const out: string[] = [];
  out.push(`实验: ${r.experimentId}  配置版本: v${r.configVersion}  运行: ${r.runId}`);
  out.push(`算法版本: ${r.algorithmVersion}  链长: ${r.chainLength}${r.identityChain ? "（空链=恒等）" : ""}`);
  out.push(line());
  out.push(
    `输入 E = ${fmtVec(r.inputField)}   I = ${intensity(r.inputField).toFixed(6)}`,
  );
  out.push(
    `Stokes 输入: S0=${r.inputStokes.s0.toFixed(6)} S1=${r.inputStokes.s1.toFixed(6)} S2=${r.inputStokes.s2.toFixed(6)} S3=${r.inputStokes.s3.toFixed(6)}`,
  );
  out.push(line());
  if (r.steps.length === 0) {
    out.push("（空链：无元件，输出=输入，恒等变换）");
  }
  for (const s of r.steps) {
    out.push(
      `#${s.index} ${s.kind}${s.label ? `(${s.label})` : ""}  theta=${s.thetaDeg}° (规范 ${s.thetaCanonicalDeg}°)` +
        (s.kind === "retarder" ? `  delta=${s.effectiveDeltaDeg}°` : ""),
    );
    out.push(`  前: ${fmtVec(s.fieldBefore)}  I=${s.intensityBefore.toFixed(6)}`);
    out.push(`  后: ${fmtVec(s.fieldAfter)}  I=${s.intensityAfter.toFixed(6)}` +
      (s.intensityRatio === null ? "" : `  比例=${s.intensityRatio.toFixed(6)}`));
    out.push(
      `  S=(${s.stokesAfter.s0.toFixed(5)}, ${s.stokesAfter.s1.toFixed(5)}, ${s.stokesAfter.s2.toFixed(5)}, ${s.stokesAfter.s3.toFixed(5)})` +
        `  纯态残差=${s.pureStateResidual.toExponential(2)}` +
        (s.retarderLoss === null ? "" : `  延迟片强度变化=${s.retarderLoss.toExponential(2)}`),
    );
  }
  out.push(line());
  out.push(`最终 E = ${fmtVec(r.finalField)}`);
  out.push(
    `最终 I = ${r.finalIntensity.toFixed(8)}   归一 Stokes = (${s(r.finalStokes.s1Norm)}, ${s(r.finalStokes.s2Norm)}, ${s(r.finalStokes.s3Norm)})`,
  );
  return out.join("\n");
}

function s(x: number | null): string {
  return x === null ? "null(零场)" : x.toFixed(6);
}
