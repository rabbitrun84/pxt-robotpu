#!/usr/bin/env node
/**
 * Serve the trace viewer locally.
 *
 * A server is needed because the viewer fetches the trace JSON, and browsers
 * block fetch() on file:// URLs. Drag-and-drop works without it if you prefer.
 *
 *   node serve.mjs [port]      then open http://localhost:8099/
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.argv[2] || "8099", 10);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

createServer(async (req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);

  // Redirect "/" to "/viewer/" rather than quietly serving viewer/index.html at
  // the root. The browser resolves relative URLs against the DOCUMENT path, so
  // serving the page at "/" makes <script src="viewer.js"> request "/viewer.js"
  // — a 404, leaving a dead page with no JS. The trailing slash matters.
  if (rel === "/" || rel === "/viewer") {
    res.writeHead(302, { location: "/viewer/" }).end();
    return;
  }
  if (rel.endsWith("/")) rel += "index.html";

  // Keep the server inside tools/simulator.
  const path = resolve(join(HERE, normalize(rel)));
  if (!path.startsWith(HERE)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": TYPES[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`viewer:  http://localhost:${PORT}/`);
  console.log(`serving: ${HERE}`);
  console.log("ctrl-c to stop");
});
