import type { C, Mat2, Vec2 } from "./types.js";

export const c = (re: number, im = 0): C => ({ re, im });

export const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });

export const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });

export const cmul = (a: C, b: C): C => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const cscale = (a: C, s: number): C => ({ re: a.re * s, im: a.im * s });

export const cconj = (a: C): C => ({ re: a.re, im: -a.im });

// exp(i*phi)
export const cexp = (phi: number): C => ({ re: Math.cos(phi), im: Math.sin(phi) });

export const cabs2 = (a: C): number => a.re * a.re + a.im * a.im;

// 矩阵乘向量 M*v（M 行优先）
export const matVec = (m: Mat2, v: Vec2): Vec2 => [
  cadd(cmul(m[0][0], v[0]), cmul(m[0][1], v[1])),
  cadd(cmul(m[1][0], v[0]), cmul(m[1][1], v[1])),
];

// 矩阵乘矩阵 a*b
export const matMat = (a: Mat2, b: Mat2): Mat2 => [
  [
    cadd(cmul(a[0][0], b[0][0]), cmul(a[0][1], b[1][0])),
    cadd(cmul(a[0][0], b[0][1]), cmul(a[0][1], b[1][1])),
  ],
  [
    cadd(cmul(a[1][0], b[0][0]), cmul(a[1][1], b[1][0])),
    cadd(cmul(a[1][0], b[0][1]), cmul(a[1][1], b[1][1])),
  ],
];

export const identityMat = (): Mat2 => [
  [c(1), c(0)],
  [c(0), c(1)],
];
