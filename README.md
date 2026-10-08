# Jones 偏振元件顺序传播与核验后端

在 Windows 本地运行的**相干单色光 Jones 偏振传播**后端，只提供 HTTP API 与 CLI（无前端、无图形）。
使用 TypeScript + Node.js 内置 `http` + 内置实验性 `node:sqlite`，**零运行时第三方依赖**（仅 TypeScript 开发依赖）。
不需要 Docker / WSL / 付费服务 / 外部在线 API。

## 1. 物理约定（务必先读）

- 坐标基底固定为 `x, y`，电场 `E = (Ex, Ey)`，每个复数用 `{re, im}` 表示。
- 时谐约定固定为 **`exp(-i*omega*t)`**。
- 所有角度输入单位为**度**，内部统一乘 `pi/180` 转弧度；轴角可跨周（如 217°、360°）。
- 轴角 `theta` 定义实单位向量
  - `u = (cos theta, sin theta)`
  - `v = (-sin theta, cos theta)`（与 `u` 正交）
- **理想线偏振片**矩阵：`P = u*u^T`（只保留 u 分量，一般损失强度）。
- **相位延迟片**矩阵：`R = u*u^T + exp(i*delta)*v*v^T`。
  - `delta` 明确是 **v 分量相对 u 分量“增加”的相位**，不引入其他快慢轴隐含约定。
  - 四分之一波片 `qwp` 只是 `delta=90°` 的快捷输入；半波片 `hwp` 只是 `delta=180°`。
- **元件作用次序**：依次作用 `J1, J2` 时输出为 `J2 * J1 * E`。组合矩阵按同样顺序从左累积
  （`combined = J_k ... J_2 J_1`）。两个不同元件**通常不能交换顺序**。
- **绝不中途归一化**：传播过程保留真实复振幅与光强。偏振片会把强度降下来，但不会把场重置成单位强度。
- 输入强度 `I = |Ex|^2 + |Ey|^2`，允许零向量。
- 规范轴角 `(-180,180]` **仅用于显示与一致性**；报告中始终保留原始输入角 `thetaDeg`。

### Stokes 参数（符号固定）

对每个输出场（含每一步前后）计算：

```
S0 = |Ex|^2 + |Ey|^2
S1 = |Ex|^2 - |Ey|^2
S2 = 2*Re(conj(Ex)*Ey)
S3 = 2*Im(conj(Ex)*Ey)
```

`S3` 符号**以上式为准**，不随任何教材的左旋/右旋命名改号。
当 `S0=0`（零场）时，归一化量 `S1/S0、S2/S0、S3/S0` 返回 `null`，并视为“无偏振方向”，
不会除零，也不会伪造成水平偏振。

### 公开数值阈值

见 `src/constants.ts`，并由 `GET /health` 原样返回：

| 名称 | 值 | 含义 |
| --- | --- | --- |
| `DISPLAY_ZERO_EPS` | `1e-12` | 仅用于判定“数值零”（归一化、显示近零）；**不会**把很小但非零的输入当 0 丢弃 |
| `PURE_STATE_REL_TOL` | `1e-9` | 纯态关系 `S1^2+S2^2+S3^2 ≈ S0^2` 的相对容差 |
| `RETARDER_LOSS_REL_TOL` | `1e-9` | 延迟片强度守恒相对容差 |
| `COMPARE_REL_TOL / COMPARE_ABS_TOL` | `1e-9 / 1e-12` | 两条链逐步比较“是否相同”的容差 |

限制：`MAX_CHAIN_LENGTH=64`，`|角度|<=1e6`，`|delta|<=1e6`，`|场分量|<=1e6`，强度溢出阈值 `1e12`。

## 2. 环境要求

- Node.js **>= 22.5**（内置 `node:sqlite`；开发环境实测 v25.5.0）。
- Windows PowerShell；克隆后在项目目录执行。

## 3. 构建 / 测试 / 演示 / 启动

```powershell
npm install        # 仅安装 typescript / @types/node
npm run build      # 编译到 dist/
npm test           # 构建 + node:test 物理单测（20 个）
npm run smoke      # 构建 + 在临时 HTTP 服务上跑 13 项 API 冒烟
npm run demo       # 运行内置 3 个演示并打印实虚部/强度/Stokes 表，写入 data/demo.db
npm start          # 启动 HTTP API（默认自动选 127.0.0.1 空闲端口）
```

也可直接用编译产物：

```powershell
node dist/src/cli.js serve --port 8080 --db data/jones.db
node dist/src/cli.js demo
node dist/src/cli.js analyze --file input.json
node dist/src/cli.js analyze --file input.json --save my-exp
node dist/src/cli.js compare --a demo-crossed --b demo-three-polarizers
node dist/src/cli.js runs my-exp
```

数据目录默认在**项目内** `data/`（SQLite 文件 `jones.db` 及 WAL），可用 `--db` 修改。

## 4. 输入 JSON 格式

```json
{
  "field": {
    "ex": { "re": 0.70710678, "im": 0 },
    "ey": { "re": 0.70710678, "im": 0 }
  },
  "components": [
    { "kind": "polarizer", "thetaDeg": 0,  "label": "P0" },
    { "kind": "retarder",   "thetaDeg": 0, "deltaDeg": 90, "label": "R" }
  ]
}
```

`kind ∈ polarizer | retarder | qwp | hwp`。`retarder` 必须提供 `deltaDeg`；`qwp/hwp` 忽略它。
空 `components: []` 是合法的恒等变换。

## 5. HTTP API

所有响应为 JSON；错误形如 `{ "ok": false, "error": { "code", "message", "path" } }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 算法版本、约定、限制与数值阈值 |
| POST | `/api/experiments` | 保存场+元件链（冻结），立即运行并返回完整报告 |
| GET | `/api/experiments` | 列出实验及最新版本 |
| GET | `/api/experiments/:id?version=n` | 取某版本冻结配置（省略 version 取最新） |
| POST | `/api/analyze` | `{experimentId, version?}` 用冻结参数复算并返回报告 |
| GET | `/api/runs/:runId` | 取某次运行完整报告 |
| GET | `/api/runs/:runId/steps?step=k` | 查询单步（前后向量/矩阵/强度） |
| GET | `/api/runs/:runId/matrices` | 导出逐元件矩阵与组合矩阵 |
| GET | `/api/runs/:runId/stokes` | 导出输入/每步/最终 Stokes 表 |
| POST | `/api/compare` | `{a:{experimentId,version?}, b:{...}}` 固定同一输入比较两条链 |

`POST /api/compare` 返回 `earliestDivergenceStep`（**最早开始不同的元件下标**，0 基）与逐步
`maxAbsFieldDiff / intensityDiff`，而不是只比一个最终强度数字。

PowerShell 调用示例：

```powershell
$body = '{"experimentId":"t","field":{"ex":{"re":1,"im":0},"ey":{"re":0,"im":0}},"components":[{"kind":"polarizer","thetaDeg":0},{"kind":"polarizer","thetaDeg":90}]}'
Invoke-RestMethod -Uri http://127.0.0.1:8080/api/experiments -Method Post -ContentType 'application/json' -Body $body
```

## 6. 持久化与可复现

SQLite 两张表：

- `configs`：冻结的原始场、元件链 JSON、约定 JSON、算法版本 `jones-1.0.0`、实验内自增版本。
- `runs`：运行标识 `runId(UUID)`、配置外键、完整报告 JSON、时间戳。

保存与运行在**单个事务**内完成：参数校验或传播（NaN/Infinity/强度溢出）失败时整体回滚，
**不会保存截断后伪装成功的链**。修改链会另存为新版本；重启后可用旧版本参数复现旧报告，
算法版本固定保证数值可复现。不同实验数据彼此独立。重复调用分析不会累积上次输出（每次从冻结输入重算）。

## 7. 校验与错误码

| code | 触发条件 | HTTP |
| --- | --- | --- |
| `MISSING_FIELD_COMPONENT` | 缺 `ex/ey` 或缺 `re/im` | 422 |
| `NON_FINITE_NUMBER` | 任意数值为 NaN/Infinity | 422 |
| `FIELD_OUT_OF_RANGE` / `ANGLE_OUT_OF_RANGE` / `DELTA_OUT_OF_RANGE` | 超范围 | 422 |
| `UNKNOWN_COMPONENT_KIND` | kind 非法 | 422 |
| `MISSING_DELTA` | retarder 缺 `deltaDeg` | 422 |
| `CHAIN_TOO_LONG` | 链长 > 64 | 422 |
| `NUMERIC_OVERFLOW` | 传播中溢出/非有限 | 422 |
| `INVALID_JSON` / `INVALID_QUERY` | 请求体或查询参数非法 | 400 |
| `NOT_FOUND` | 实验/版本/运行不存在 | 404 |
| `LABEL_TOO_LONG` / `ID_TOO_LONG` | 文本超长 | 422 |

## 8. 关键物理结论（已被测试与演示覆盖）

- `(1,0)` 经 0° 再 90° 偏振片：最终强度 **0**；中间插入 45°：最终强度 **1/4**。
- `(1,1)/sqrt2` 经轴 0°、`delta=90°` 延迟片：得到 `(1,i)/sqrt2`，`S3=1`。
- 空链恒等；零场归一 Stokes 为 null；轴角 `+180°` 等价；延迟 `+360°` 恒等；
  整体相位不改变 Stokes；半波片两次恢复；元件调序结果不同并能定位最早分歧。
- 每步验证纯态关系 `S1^2+S2^2+S3^2 = S0^2`；延迟片（含 qwp/hwp）强度守恒。
- 除矩阵传播外，另用 **u/v 投影分解**独立实现（`applyByProjection`）交叉核对，两者一致。

## 9. 范围与限制（明确不做）

只处理**完全偏振光的二维 Jones 向量**。不实现多层膜反射、介质折射、光线追迹、
非偏振/部分偏振混合光（不使用 Mueller 矩阵或相干矩阵统计）、真实仪器控制、偏振椭圆绘图或任何前端。
`node:sqlite` 当前在 Node 中带实验性警告，不影响功能；如未来 Node 更改该 API，需要相应适配。
