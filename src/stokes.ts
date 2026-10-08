import { cconj, cmul } from "./complex.js";
import type { C, Stokes, Vec2 } from "./types.js";
import { NUMERIC_THRESHOLDS } from "./constants.js";

function cabs2(a: C): number {
  return a.re * a.re + a.im * a.im;
}

export function intensity(v: Vec2): number {
  return cabs2(v[0]) + cabs2(v[1]);
}

// S0..S3，归一参数在 S0=0 时为 null
export function stokes(v: Vec2): Stokes {
  const ex = v[0];
  const ey = v[1];
  const ix = cabs2(ex);
  const iy = cabs2(ey);
  const s0 = ix + iy;
  const s1 = ix - iy;
  const z = cmul(cconj(ex), ey); // conj(Ex)*Ey
  const s2 = 2 * z.re;
  const s3 = 2 * z.im;
  if (s0 <= NUMERIC_THRESHOLDS.DISPLAY_ZERO_EPS * NUMERIC_THRESHOLDS.DISPLAY_ZERO_EPS) {
    return { s0, s1, s2, s3, s1Norm: null, s2Norm: null, s3Norm: null };
  }
  return {
    s0,
    s1,
    s2,
    s3,
    s1Norm: s1 / s0,
    s2Norm: s2 / s0,
    s3Norm: s3 / s0,
  };
}

export function pureStateResidual(s: Stokes): number {
  return Math.abs(s.s1 * s.s1 + s.s2 * s.s2 + s.s3 * s.s3 - s.s0 * s.s0);
}
