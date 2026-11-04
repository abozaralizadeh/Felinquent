import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { RotatingLogger } from "./logger";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export interface ServeOptions {
  root: string;
  port: number;
  host?: string;
  logger?: RotatingLogger;
}

/** Tiny static server for the playground demo on a VM. It only serves files, and only from root. */
export function createServer(opts: ServeOptions): http.Server {
  const root = path.resolve(opts.root);
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let status = 200;
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
    } else {
      const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.resolve(root, `.${rel}`);
      if (!file.startsWith(root + path.sep) && file !== root) {
        status = 403;
        res.writeHead(403).end("forbidden\n");
      } else if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        status = 404;
        res.writeHead(404).end("not found\n");
      } else {
        res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
      }
    }
    opts.logger?.info("request", { method: req.method, path: url.pathname, status });
  });
}

const isMain = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const port = Number(process.env.FELINQUENT_PORT ?? 4173);
  const logger = new RotatingLogger({ dir: process.env.FELINQUENT_LOG_DIR ?? "./logs", name: "playground", stdout: true });
  const server = createServer({ root: process.env.FELINQUENT_ROOT ?? "dist", port, host: "0.0.0.0", logger });
  server.listen(port, "0.0.0.0", () => logger.info("playground serving", { port }));
}
