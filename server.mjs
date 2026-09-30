import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
// Only named API modules can be imported. This keeps private files outside the
// static file server while allowing the same handlers to run on Vercel.
const apiRoutes = new Set([
  "account", "automation", "health", "intelligence", "lookup", "market",
  "operator-session", "options", "order", "research", "screener", "signal",
]);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://localhost:${port}`);
  const route = requestUrl.pathname.match(/^\/api\/([a-z-]+)$/)?.[1];
  if (route && apiRoutes.has(route)) {
    req.query = Object.fromEntries(requestUrl.searchParams);
    res.status = function status(code) { this.statusCode = code; return this; };
    res.json = function json(payload) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
      this.end(JSON.stringify(payload));
      return this;
    };
    try {
      const { default: handler } = await import(`./api/${route}.js`);
      await handler(req, res);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "Server error" }));
      } else if (!res.writableEnded) res.end();
    }
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  try {
    const relative = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
    const target = path.resolve(root, "." + relative);
    const allowedDir = relative.startsWith("/src/") ? path.join(root, "src") :
      relative.startsWith("/data/") ? path.join(root, "data") : null;
    const publicPath = relative === "/index.html" || relative === "/trading.html" ||
      Boolean(allowedDir && /^\/(?:src|data)\/[A-Za-z0-9_./-]+$/.test(relative) &&
        target.startsWith(allowedDir + path.sep));
    if (!target.startsWith(root + path.sep) || !publicPath ||
        !/\.(?:html|css|js|json|svg|ico)$/.test(target)) {
      res.writeHead(403).end();
      return;
    }
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    const body = await readFile(target);
    res.writeHead(200, {
      "Content-Type": mime[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

server.listen(port, () => {
  process.stdout.write(`Stonk running at http://localhost:${port}\n`);
});
