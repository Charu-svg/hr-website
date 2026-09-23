"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const config = require("./config");
const db = require("./db");
const routes = require("./routes");
const { sendJson } = require("./routes");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf"
};

/* Directories and files the web should never hand out. */
const BLOCKED = [".env", ".git", ".github", ".commandcode", "server", "data", "uploads", "node_modules", "Dockerfile", "docker-compose.yml", "Caddyfile", "vercel.json", "package.json", "package-lock.json"];

function securityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "SAMEORIGIN");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("permissions-policy", "geolocation=(), microphone=(), camera=()");
}

/* Small in-memory rate limiter. Enough for a brochure site with forms; if you
   run more than one instance, move this to the proxy or a shared store. */
const hits = new Map();

function rateLimited(key, limit, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);

  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

setInterval(function () {
  const now = Date.now();
  hits.forEach(function (entry, key) {
    if (now > entry.resetAt) hits.delete(key);
  });
}, 60000).unref();

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function limitFor(pathname) {
  if (pathname === "/api/applications") return { limit: 8, window: 10 * 60 * 1000 };
  if (pathname === "/api/briefs") return { limit: 8, window: 10 * 60 * 1000 };
  if (pathname === "/api/subscribe") return { limit: 12, window: 60 * 60 * 1000 };
  return null;
}

function safeStaticPath(pathname) {
  let decoded;

  try {
    decoded = decodeURIComponent(pathname);
  } catch (error) {
    return null;
  }

  if (decoded.includes("\0")) return null;

  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(config.siteDir, relative);
  const root = path.resolve(config.siteDir);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  const segments = path.relative(root, resolved).split(path.sep);
  const blocked = segments.some(function (segment) {
    return BLOCKED.indexOf(segment) !== -1 || segment.startsWith(".");
  });

  if (blocked) return null;

  return resolved;
}

function serveStatic(req, res, pathname) {
  const target = safeStaticPath(pathname);

  if (!target) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  fs.stat(target, function (error, stat) {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const extension = path.extname(target).toLowerCase();
    const type = MIME[extension] || "application/octet-stream";
    const isDocument = extension === ".html";

    res.writeHead(200, {
      "content-type": type,
      "content-length": stat.size,
      "cache-control": isDocument ? "no-cache" : "public, max-age=300, must-revalidate",
      "last-modified": stat.mtime.toUTCString()
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(target).pipe(res);
  });
}

function serveAdmin(res) {
  const file = path.join(__dirname, "admin.html");

  fs.readFile(file, function (error, data) {
    if (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("The admin page is missing.");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": data.length,
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  securityHeaders(res);

  let url;

  try {
    url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  } catch (error) {
    sendJson(res, 400, { ok: false, error: "That address made no sense." });
    return;
  }

  const pathname = url.pathname;

  if (pathname === "/admin" || pathname === "/admin/") {
    serveAdmin(res);
    return;
  }

  if (pathname.startsWith("/api/")) {
    if (!["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
      sendJson(res, 405, { ok: false, error: "That method is not allowed." });
      return;
    }

    const limit = limitFor(pathname);
    if (limit && rateLimited(clientIp(req) + "|" + pathname, limit.limit, limit.window)) {
      sendJson(res, 429, {
        ok: false,
        error: "That is a lot of submissions from one place. Try again a little later."
      });
      return;
    }

    Promise.resolve()
      .then(function () {
        return routes.route(req, res, pathname, url);
      })
      .then(function (handled) {
        if (!handled && !res.writableEnded) {
          sendJson(res, 404, { ok: false, error: "No such endpoint." });
        }
      })
      .catch(function (error) {
        if (res.writableEnded) return;

        const status = error && error.status ? error.status : 500;

        if (status >= 500) {
          console.error("[error]", req.method, pathname, error);
        }

        sendJson(res, status, {
          ok: false,
          error: (error && error.message) || "Something went wrong on our side.",
          fields: error && error.fields ? error.fields : undefined
        });
      });

    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  serveStatic(req, res, pathname);
});

const seeded = db.seedRoles();

if (seeded.seeded) {
  console.log("[db] seeded " + seeded.seeded + " roles into the ledger");
}

server.listen(config.port, function () {
  const counts = db.counts();

  console.log("");
  console.log("  Wrenfield is running");
  console.log("  site      http://localhost:" + config.port);
  console.log("  admin     http://localhost:" + config.port + "/admin");
  console.log("  ledger    " + counts.roles + " roles published");
  console.log(
    "  admin token   " +
      (config.adminToken ? "set" : "NOT SET - /admin is switched off until you set ADMIN_TOKEN")
  );
  console.log(
    "  notifications " +
      (config.mailEnabled || config.notifyWebhook
        ? [config.mailEnabled ? "email" : null, config.notifyWebhook ? "webhook" : null]
            .filter(Boolean)
            .join(" + ")
        : "stored in the database only")
  );
  console.log("  retention     candidate data deleted after " + config.retentionDays + " days");
  console.log("");
});

/* Nightly retention sweep, plus one on boot. */
const purge = function () {
  const result = db.purgeExpired();
  const removed = result.applications + result.briefs + result.subscribers;
  if (removed > 0) {
    console.log(
      "[retention] removed " +
        removed +
        " records older than " +
        config.retentionDays +
        " days"
    );
  }
};

purge();
setInterval(purge, 24 * 60 * 60 * 1000).unref();

function shutdown(signal) {
  console.log("\n" + signal + " received, closing down.");
  server.close(function () {
    process.exit(0);
  });
  setTimeout(function () {
    process.exit(0);
  }, 5000).unref();
}

process.on("SIGINT", function () {
  shutdown("SIGINT");
});
process.on("SIGTERM", function () {
  shutdown("SIGTERM");
});
