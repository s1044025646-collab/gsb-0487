import * as net from "node:net";
import * as path from "node:path";
import { Store } from "./store";
import { createServer } from "./api";

export const DATA_DIR = process.env.JONES_DATA_DIR ?? path.join(process.cwd(), "data");
export const DB_PATH = process.env.JONES_DB ?? path.join(DATA_DIR, "jones.db");

/** 选择空闲端口：优先 PORT 环境变量；为 0 或未设置时由系统分配 */
export function findFreePort(preferred?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", (err) => {
      if (preferred && preferred > 0) {
        // 指定端口被占用时退回系统分配
        findFreePort(0).then(resolve, reject);
      } else {
        reject(err);
      }
    });
    srv.listen(preferred ?? 0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

export async function startServer(): Promise<void> {
  const preferred = process.env.PORT ? Number(process.env.PORT) : 0;
  const port = await findFreePort(preferred);
  const store = new Store(DB_PATH);
  const server = createServer(store);
  server.listen(port, "127.0.0.1", () => {
    console.log(`Jones 后端已启动: http://127.0.0.1:${port}`);
    console.log(`数据库: ${DB_PATH}`);
  });
  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error("启动失败:", err);
    process.exit(1);
  });
}
