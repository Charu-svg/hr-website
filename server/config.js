"use strict";

const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;

  const text = fs.readFileSync(file, "utf8");

  text.split(/\r?\n/).forEach(function (line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const split = trimmed.indexOf("=");
    if (split === -1) return;

    const key = trimmed.slice(0, split).trim();
    let value = trimmed.slice(split + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = value;
  });
}

const root = path.resolve(__dirname, "..");
loadEnvFile(path.join(root, ".env"));

function resolveFromRoot(value, fallback) {
  const target = value && value.trim() ? value.trim() : fallback;
  return path.isAbsolute(target) ? target : path.resolve(root, target);
}

const config = {
  root: root,
  port: Number(process.env.PORT || 8000),
  siteDir: resolveFromRoot(process.env.SITE_DIR, "."),
  dataDir: resolveFromRoot(process.env.DATA_DIR, "./data"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR, "./uploads"),
  adminToken: (process.env.ADMIN_TOKEN || "").trim(),
  notifyWebhook: (process.env.NOTIFY_WEBHOOK_URL || "").trim(),
  retentionDays: Number(process.env.RETENTION_DAYS || 730),
  trustProxy: process.env.TRUST_PROXY === "1",
  mail: {
    host: (process.env.SMTP_HOST || "").trim(),
    port: Number(process.env.SMTP_PORT || 587),
    user: (process.env.SMTP_USER || "").trim(),
    pass: (process.env.SMTP_PASS || "").trim(),
    from: (process.env.MAIL_FROM || "Wrenfield site <no-reply@wrenfield.co.uk>").trim(),
    to: (process.env.MAIL_TO || "")
      .split(",")
      .map(function (address) {
        return address.trim();
      })
      .filter(Boolean)
  },
  limits: {
    json: 64 * 1024,
    upload: 10 * 1024 * 1024,
    field: 5000
  }
};

config.mailEnabled = Boolean(config.mail.host && config.mail.to.length);

module.exports = config;
