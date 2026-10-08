# Jones 偏振元件顺序传播与复振幅强度核验后端

纯后端（API + CLI），TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生编译依赖）。
Windows 本地直接运行，不需要 Docker / WSL / 外部服务。

## 物理约定

- 坐标基底固定为 `(x, y)`，输入场 `E = (Ex, Ey)`，每个复数以 `{re, im}` 表示。
- 时谐约定：`exp(-i*omega*t)`。所有角度输入为**度**，内部统一转弧度。
- 强度 `I = |Ex|^2 + |Ey|^2`。允许零向量；拒绝非有限数与缺失分量。
- 轴角 `theta` 的单位向量 `u = (cosθ, sinθ)`，正交向量 `v = (-sinθ, cosθ)`。
- 理想线偏振片矩阵：`J = u·uᵀ`。
- 理想延迟片矩阵：`J = u·uᵀ + exp(i·δ)·v·vᵀ`，其中 **δ 是 v 分量相对 u 分量增加的相位**。
  `qwp` / `hwp` 只是 `δ=90°` / `δ=180°` 的快捷输入，不含其他快慢轴隐含约定。
- **作用次序**：依次作用 `J1, J2, ...` 时 `E_out = Jn·...·J2·J1·E_in`，组合矩阵按同一次序累乘。
  传播全程**不做重新归一化**，偏振片的强度损耗被保留；理想延迟片不改变强度。
- 轴角允许跨周（如 210°、-30°），规范角（`[0,180)`）仅用于显示与一致性核对，原始输入角保留在报告中。
- 空链是恒等变换；每次运行相互独立，不累积上次输出。

## Stokes 参数（符号约定以此为准）

```
S0 = |Ex|^2 + |Ey|^2
S1 = |Ex|^2 - |Ey|^2
S2 = 2*Re(conj(Ex)*Ey)
S3 = 2*Im(conj(Ex)*Ey)
```

`S0 > EPS` 时输出归一量 `n1=S1/S0` 等；零强度时归一量为 `null`（无偏振方向），不除零、不伪造水平偏振。
数值零判定阈值 **`EPS = 1e-12`**（公开常量，见 `src/jones.ts` 与 `GET /meta`）。非零但很小的输入按原样计算，不会被当作单位光强。

## 构建 / 测试 / 启动 / 演示

```powershell
npm install        # 仅 devDependencies: typescript, @types/node
npm run build      # 编译到 dist/
npm test           # 构建并运行全部单元测试（node:test）
npm start          # 启动 HTTP API（默认自动选择空闲端口；PORT=8123 可指定，被占用时自动退回空闲端口）
npm run demo       # CLI 内置演示（交叉偏振片、45° 插入、四分之一波片、保存/复现）
```

数据目录默认为项目内 `data/`（可用环境变量 `JONES_DATA_DIR`、`JONES_DB` 覆盖），SQLite 数据库文件为 `data/jones.db`。

## HTTP API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/meta` | 算法版本、EPS、参数限制 |
| POST | `/chains` | 保存链 `{experiment, spec}`，同 experiment 自动递增版本，旧版本不可变 |
| GET | `/chains?experiment=` | 列出链版本 |
| GET | `/chains/:experiment/:version?` | 读取链（缺省最新版本） |
| POST | `/chains/:id/run` | 运行传播 `{field:{Ex,Ey}}`，返回 `{runUuid, result}` |
| GET | `/runs/:uuid` | 复现冻结的完整报告 |
| GET | `/runs/:uuid/steps/:i` | 查询单步（前后向量、矩阵、强度、Stokes） |
| GET | `/runs/:uuid/export?what=matrix\|stokes&format=json\|csv` | 导出组合矩阵或 Stokes 表 |
| POST | `/compare` | `{field, chainA, chainB}` 同场比较两链，给出最早分歧步与文字解释 |

元件规格：`{"type":"polarizer","thetaDeg":45}`、`{"type":"retarder","thetaDeg":0,"deltaDeg":90}`、
`{"type":"qwp","thetaDeg":0}`、`{"type":"hwp","thetaDeg":30}`，可选 `label`。

## CLI

```
node dist/src/cli.js demo
node dist/src/cli.js save <experiment> '<spec-json 或文件路径>'
node dist/src/cli.js run <chainId> --field Ex_re,Ex_im,Ey_re,Ey_im
node dist/src/cli.js step <runUuid> <i>
node dist/src/cli.js compare --field 1,0,0,0 --a '<json>' --b '<json>'
node dist/src/cli.js export <runUuid> [matrix|stokes] [csv]
node dist/src/cli.js list
```

## 持久化与复现

SQLite 冻结：原始链参数（含跨周原始角）、输入场、约定、算法版本（`jones-seq-1.0.0`）、EPS、
每步结果与 `runUuid`。修改链会另存新版本，重启后可按 `runUuid` 或 `(experiment, version)` 复现旧报告。
演示数据使用独立 experiment 名（`demo`），与其他实验互不影响。

## 校验与错误码

- `E_INVALID_FIELD`：缺分量 / 非有限数；`E_INVALID_ELEMENT`：非法元件类型或参数；
- `E_INVALID_CHAIN` / `E_CHAIN_TOO_LONG`（上限 64）；`E_RANGE`：角度超 ±1e6 度；
- `E_OVERFLOW`：传播中出现非有限数；`E_NOT_FOUND`、`E_BAD_JSON`、`E_TOO_LARGE`、`E_INVALID_PARAM`。
- 非法链**整体拒绝**，不会保存截断后伪装完整的链。

## 测试覆盖（test/jones.test.ts，17 项）

交叉偏振片强度为 0、插入 45° 后为 1/4、四分之一波片 `(1,i)/√2` 且 `S3=1`、空链恒等、零场归一量为 null、
轴角 +180° 与 δ+360° 矩阵不变、整体相位不改变 Stokes、半波片两次恢复、元件调序不可交换与首个分歧步定位、
不归一化强度衰减、每步纯态关系 `S1²+S2²+S3²=S0²`、延迟片强度守恒、u/v 投影分解独立核对、
组合矩阵与逐步传播一致、非法输入报错、存储版本/冻结/重启复现、EPS 公开与小残差保留。

## 限制

- 仅处理完全偏振光的二维 Jones 向量；不含多层膜反射、介质折射、光线追迹、非偏振混合光（Mueller）、真实仪器控制。
- `node:sqlite` 在 Node 25 仍标记 experimental（会打印一条警告），功能稳定可用；如需消除警告可换 `better-sqlite3`。
- 双精度浮点，残差（如 1e-17 量级）按原样保留，不做隐藏取整。
