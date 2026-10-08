export const ALGORITHM_VERSION = "jones-1.0.0";

export const CONVENTION = {
  timeHarmonic: "exp(-i*omega*t)",
  basis: "x,y",
  angleUnit: "degree",
  polarizerFormula: "P = u*u^T, u=(cos theta, sin theta), v=(-sin theta, cos theta)",
  retarderFormula:
    "R = u*u^T + exp(i*delta)*v*v^T; delta 是 v 分量相对 u 分量【增加】的相位",
  applicationOrder: "依次作用 J1,J2 时输出 = J2*J1*E",
  s3Sign: "S3 = 2*Im(conj(Ex)*Ey)，符号固定，不随左右旋命名改号",
};

export const LIMITS = Object.freeze({
  MAX_CHAIN_LENGTH: 64,
  MAX_ABS_ANGLE_DEG: 1.0e6,
  MAX_ABS_DELTA_DEG: 1.0e6,
  MAX_ABS_FIELD_COMPONENT: 1.0e6,
  MAX_LABEL_LENGTH: 200,
  MAX_EXPERIMENT_ID_LENGTH: 120,
  INTENSITY_OVERFLOW: 1.0e12,
});

// 公开的数值阈值（README 与 /health 中同样披露）
export const NUMERIC_THRESHOLDS = Object.freeze({
  // 判定“数值零”的绝对阈值：仅用于展示规范角/近零清理，绝不用于把小输入当 0 丢弃
  DISPLAY_ZERO_EPS: 1e-12,
  // 纯态关系 S1^2+S2^2+S3^2 ≈ S0^2 的相对容差
  PURE_STATE_REL_TOL: 1e-9,
  // 延迟片强度守恒的相对容差
  RETARDER_LOSS_REL_TOL: 1e-9,
  // 比较两条链时判定某一步“开始不同”的相对/绝对容差
  COMPARE_REL_TOL: 1e-9,
  COMPARE_ABS_TOL: 1e-12,
});

export const DEG2RAD = Math.PI / 180;
