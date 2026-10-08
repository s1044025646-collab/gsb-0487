export interface C {
  re: number;
  im: number;
}

export const c = (re: number, im = 0): C => ({ re, im });

export const add = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });

export const mul = (a: C, b: C): C => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
});

export const conj = (a: C): C => ({ re: a.re, im: -a.im });

export const abs2 = (a: C): number => a.re * a.re + a.im * a.im;

export const fromPolar = (r: number, thetaRad: number): C => ({
  re: r * Math.cos(thetaRad),
  im: r * Math.sin(thetaRad),
});

export class ValidationError extends Error {
  readonly code: string;
  constructor(message: string) {
    super(message);
    const m = /^([A-Z_]+):/.exec(message);
    this.code = m ? m[1] : "E_INVALID";
  }
}

export function assertFiniteComplex(z: C, name: string): void {
  if (typeof z?.re !== "number" || typeof z?.im !== "number" ||
      !Number.isFinite(z.re) || !Number.isFinite(z.im)) {
    throw new ValidationError(`E_INVALID_FIELD: ${name} 必须是实部/虚部均为有限数的复数`);
  }
}
