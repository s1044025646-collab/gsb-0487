import type { FieldInput, StoredComponent } from "./types.js";

const SQRT1_2 = 1 / Math.sqrt(2);

export interface DemoCase {
  key: string;
  title: string;
  experimentId: string;
  field: FieldInput;
  components: StoredComponent[];
  expect: string;
}

export const DEMO_CASES: DemoCase[] = [
  {
    key: "crossed",
    title: "(1,0) 经 0° 再经 90° 偏振片：最终强度 0",
    experimentId: "demo-crossed",
    field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
    components: [
      { kind: "polarizer", thetaDeg: 0, deltaDeg: null, label: "P0" },
      { kind: "polarizer", thetaDeg: 90, deltaDeg: null, label: "P90" },
    ],
    expect: "I_final = 0",
  },
  {
    key: "three",
    title: "中间插入 45° 偏振片：最终强度 1/4",
    experimentId: "demo-three-polarizers",
    field: { ex: { re: 1, im: 0 }, ey: { re: 0, im: 0 } },
    components: [
      { kind: "polarizer", thetaDeg: 0, deltaDeg: null, label: "P0" },
      { kind: "polarizer", thetaDeg: 45, deltaDeg: null, label: "P45" },
      { kind: "polarizer", thetaDeg: 90, deltaDeg: null, label: "P90" },
    ],
    expect: "I_final = 0.25",
  },
  {
    key: "qwp",
    title: "(1,1)/sqrt2 经 0° 轴 delta=90° 延迟片：得到 (1,i)/sqrt2，S3=1",
    experimentId: "demo-qwp",
    field: { ex: { re: SQRT1_2, im: 0 }, ey: { re: SQRT1_2, im: 0 } },
    components: [
      { kind: "retarder", thetaDeg: 0, deltaDeg: 90, label: "R(0,90)" },
    ],
    expect: "E = (1,i)/sqrt2, S3 = 1",
  },
];
