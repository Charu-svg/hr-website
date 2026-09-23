"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const config = require("./config");
const db = require("./db");
const upload = require("./upload");
const { notify } = require("./notify");

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store"
  });
  res.end(payload);
}

function httpError(status, message, fields) {
  const error = new Error(message);
  error.status = status;
  if (fields) error.fields = fields;
  return error;
}

function readJsonBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];

    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > config.limits.json) {
        reject(httpError(413, "That request was larger than we accept."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", function () {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(httpError(400, "That request was not valid JSON."));
      }
    });

    req.on("error", function () {
      reject(httpError(400, "That request did not come through cleanly."));
    });
  });
}

/* Validation -------------------------------------------------------------- */

function clean(value, max) {
  return String(value === null || value === undefined ? "" : value).trim().slice(0, max);
}

function checkEmail(value) {
  const email = clean(value, 200).toLowerCase();
  if (!email) return { error: "An email address is needed so we can reply." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { error: "That email address does not look complete." };
  }
  return { value: email };
}

function checkPhone(value) {
  const phone = clean(value, 40);
  if (!phone) return { value: null };
  if (!/^[0-9 +()\u2013-]{7,20}$/.test(phone)) {
    return { error: "Use digits, spaces, brackets or a plus sign." };
  }
  return { value: phone };
}

function requireText(value, max, message) {
  const text = clean(value, max);
  if (!text) return { error: message };
  return { value: text };
}

/* Spam heuristic. The honeypot is the reliable signal; the timing check only
   catches posts that arrive implausibly fast, because anything longer starts
   throwing away real people who paste an address and hit enter. Drops are
   logged, so a false positive is at least visible in the server output. */
function looksLikeSpam(fields, kind) {
  let reason = null;

  if (clean(fields.website, 100)) reason = "honeypot filled";
  else {
    const started = Number(fields.formStartedAt || 0);
    if (started && Date.now() - started < 800) reason = "submitted in under a second";
  }

  if (reason) console.log("[spam] dropped a " + (kind || "submission") + ": " + reason);

  return reason;
}

function clientIp(req) {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
      return forwarded.split(",")[0].trim();
    }
  }
  return req.socket.remoteAddress || "";
}

/* Admin auth -------------------------------------------------------------- */

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, url) {
  if (!config.adminToken) {
    throw httpError(
      503,
      "Admin is switched off. Set ADMIN_TOKEN in your .env file and restart the server."
    );
  }

  const header = req.headers.authorization || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || url.searchParams.get("token") || "";

  if (!safeEqual(provided, config.adminToken)) {
    throw httpError(401, "That admin token is not right.");
  }
}

/* Handlers ---------------------------------------------------------------- */

async function createBrief(req, res) {
  const body = await readJsonBody(req);

  if (looksLikeSpam(body, "brief")) {
    sendJson(res, 200, { ok: true, id: null, dropped: true });
    return;
  }

  const fields = [];
  const name = requireText(body.name, 120, "We need a name to reply to.");
  if (name.error) fields.push({ field: "brief-name", message: name.error });

  const company = requireText(body.company, 160, "Which company is this role for?");
  if (company.error) fields.push({ field: "brief-company", message: company.error });

  const roleTitle = requireText(body.role, 160, "What is the role called?");
  if (roleTitle.error) fields.push({ field: "brief-role", message: roleTitle.error });

  const desk = requireText(body.desk, 20, "Pick the desk closest to the role.");
  if (desk.error) fields.push({ field: "brief-desk", message: desk.error });

  const location = requireText(body.location, 160, "Where will the person be based?");
  if (location.error) fields.push({ field: "brief-location", message: location.error });

  const failed = requireText(body.failed, 4000, "Tell us what the last person got wrong.");
  if (failed.error) fields.push({ field: "brief-failed", message: failed.error });

  const email = checkEmail(body.email);
  if (email.error) fields.push({ field: "brief-email", message: email.error });

  const phone = checkPhone(body.phone);
  if (phone.error) fields.push({ field: "brief-phone", message: phone.error });

  const bandMin = body.bandMin === "" || body.bandMin === null ? null : Number(body.bandMin);
  const bandMax = body.bandMax === "" || body.bandMax === null ? null : Number(body.bandMax);

  if (bandMin === null || !Number.isFinite(bandMin)) {
    fields.push({ field: "brief-band-min", message: "A number for the bottom of the band." });
  }
  if (bandMax === null || !Number.isFinite(bandMax)) {
    fields.push({ field: "brief-band-max", message: "A number for the top of the band." });
  }
  if (
    Number.isFinite(bandMin) &&
    Number.isFinite(bandMax) &&
    bandMax < bandMin
  ) {
    fields.push({ field: "brief-band-max", message: "The top of the band sits below the bottom." });
  }

  if (body.consent !== true) {
    fields.push({ field: "brief-consent", message: "We need permission to hold these details." });
  }

  if (fields.length) {
    throw httpError(422, "Some of the brief needs another look.", fields);
  }

  const id = db.createBrief({
    name: name.value,
    company: company.value,
    roleTitle: roleTitle.value,
    desk: desk.value,
    location: location.value,
    contract: clean(body.contract, 60),
    bandMin: bandMin,
    bandMax: bandMax,
    failed: failed.value,
    tried: clean(body.tried, 4000),
    email: email.value,
    phone: phone.value,
    startWhen: clean(body.start, 120),
    ipHash: db.hashIp(clientIp(req))
  });

  notify({
    kind: "brief",
    subject: "New role brief: " + roleTitle.value + " at " + company.value,
    text: [
      "Role: " + roleTitle.value,
      "Company: " + company.value,
      "Desk: " + desk.value,
      "Location: " + location.value,
      "Band: " + bandMin + " to " + bandMax,
      "Contact: " + name.value + " <" + email.value + "> " + (phone.value || ""),
      "",
      "What the last person got wrong:",
      failed.value,
      "",
      "Tried already:",
      clean(body.tried, 4000) || "(nothing given)"
    ].join("\n")
  }).catch(function () {});

  sendJson(res, 201, { ok: true, id: id });
}

async function createApplication(req, res) {
  const parsed = await upload.parseApplicationForm(req);
  const fields = parsed.fields;

  if (looksLikeSpam(fields)) {
    sendJson(res, 200, { ok: true, id: null, dropped: true });
    return;
  }

  const problems = [];

  const name = requireText(fields.name, 120, "We need a name to call you by.");
  if (name.error) problems.push({ field: "apply-name", message: name.error });

  const email = checkEmail(fields.email);
  if (email.error) problems.push({ field: "apply-email", message: email.error });

  const phone = checkPhone(fields.phone);
  if (phone.error) problems.push({ field: "apply-phone", message: phone.error });

  if (!parsed.file) {
    problems.push({
      field: "apply-cv",
      message: "Attach a CV, or paste a link to your profile in the note."
    });
  }

  if (fields.consent !== "on" && fields.consent !== "true") {
    problems.push({ field: "apply-consent", message: "We need permission to hold your details." });
  }

  if (problems.length) {
    if (parsed.file) {
      fs.unlink(parsed.file.path, function () {});
    }
    throw httpError(422, "Nearly there. A few things to fix.", problems);
  }

  const id = db.createApplication({
    roleRef: clean(fields.roleRef, 20),
    roleTitle: clean(fields.roleTitle, 200),
    name: name.value,
    email: email.value,
    phone: phone.value,
    note: clean(fields.note, 4000),
    cvPath: parsed.file.path,
    cvName: parsed.file.name,
    cvSize: parsed.file.size,
    ipHash: db.hashIp(clientIp(req))
  });

  notify({
    kind: "application",
    subject:
      "New application: " + name.value + " for " + (clean(fields.roleRef, 20) || "the board"),
    text: [
      "Role: " + (clean(fields.roleTitle, 200) || "(not given)") + " [" + clean(fields.roleRef, 20) + "]",
      "Candidate: " + name.value,
      "Email: " + email.value,
      "Phone: " + (phone.value || "(not given)"),
      "CV: " + parsed.file.name + " (" + Math.round(parsed.file.size / 1024) + "KB)",
      "",
      "Note:",
      clean(fields.note, 4000) || "(none)"
    ].join("\n")
  }).catch(function () {});

  sendJson(res, 201, { ok: true, id: id });
}

async function createSubscription(req, res) {
  const body = await readJsonBody(req);

  if (looksLikeSpam(body)) {
    sendJson(res, 200, { ok: true, dropped: true });
    return;
  }

  const email = checkEmail(body.email);
  if (email.error) {
    throw httpError(422, "That email needs checking.", [
      { field: "subscribe-email", message: email.error }
    ]);
  }

  const result = db.createSubscriber({
    email: email.value,
    source: clean(body.source, 40) || "site",
    ipHash: db.hashIp(clientIp(req))
  });

  sendJson(res, 200, { ok: true, existing: result.existing });
}

function listRoles(req, res, url) {
  const includeUnpublished = url.searchParams.get("all") === "1";

  if (includeUnpublished) {
    requireAdmin(req, url);
  }

  sendJson(res, 200, { ok: true, roles: db.listRoles(includeUnpublished) });
}

function downloadCv(req, res, id) {
  const row = db.getApplication(id);

  if (!row || !row.cv_path || !fs.existsSync(row.cv_path)) {
    throw httpError(404, "That file is not here any more.");
  }

  const safeName = (row.cv_name || "cv").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120);
  const stat = fs.statSync(row.cv_path);

  res.writeHead(200, {
    "content-type": "application/octet-stream",
    "content-length": stat.size,
    "content-disposition": 'attachment; filename="' + safeName + '"',
    "cache-control": "no-store"
  });

  fs.createReadStream(row.cv_path).pipe(res);
}

function adminSummary(req, res, url) {
  requireAdmin(req, url);
  sendJson(res, 200, {
    ok: true,
    counts: db.counts(),
    retentionDays: config.retentionDays,
    mailEnabled: config.mailEnabled,
    webhookEnabled: Boolean(config.notifyWebhook)
  });
}

function adminList(req, res, url, table) {
  requireAdmin(req, url);

  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);

  if (table === "briefs") sendJson(res, 200, { ok: true, rows: db.listBriefs(limit) });
  else if (table === "applications") sendJson(res, 200, { ok: true, rows: db.listApplications(limit) });
  else if (table === "subscribers") sendJson(res, 200, { ok: true, rows: db.listSubscribers(limit) });
  else if (table === "roles") sendJson(res, 200, { ok: true, rows: db.listRoles(true) });
  else throw httpError(404, "Unknown list.");
}

async function adminUpdateRole(req, res, url, ref) {
  requireAdmin(req, url);
  const body = await readJsonBody(req);

  if (typeof body.published === "boolean" && Object.keys(body).length === 1) {
    const role = db.setRolePublished(ref, body.published);
    if (!role) throw httpError(404, "No role with that reference.");
    sendJson(res, 200, { ok: true, role: role });
    return;
  }

  const existing = db.getRole(ref);
  if (!existing) throw httpError(404, "No role with that reference.");

  const merged = Object.assign({}, existing, body, { ref: ref });
  const result = db.upsertRole(merged);
  sendJson(res, 200, { ok: true, created: result.created, role: db.getRole(ref) });
}

function adminDelete(req, res, url, table, id) {
  requireAdmin(req, url);
  const removed = db.deleteRecord(table, id);
  sendJson(res, 200, { ok: true, removed: removed });
}

async function route(req, res, pathname, url) {
  const method = req.method === "HEAD" ? "GET" : req.method;

  if (method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return true;
  }

  if (method === "GET" && pathname === "/api/roles") {
    listRoles(req, res, url);
    return true;
  }

  if (method === "POST" && pathname === "/api/briefs") {
    await createBrief(req, res);
    return true;
  }

  if (method === "POST" && pathname === "/api/applications") {
    await createApplication(req, res);
    return true;
  }

  if (method === "POST" && pathname === "/api/subscribe") {
    await createSubscription(req, res);
    return true;
  }

  if (method === "GET" && pathname === "/api/admin/summary") {
    adminSummary(req, res, url);
    return true;
  }

  const listMatch = pathname.match(/^\/api\/admin\/(briefs|applications|subscribers|roles)$/);
  if (method === "GET" && listMatch) {
    adminList(req, res, url, listMatch[1]);
    return true;
  }

  const roleMatch = pathname.match(/^\/api\/admin\/roles\/([A-Za-z0-9-]+)$/);
  if ((method === "PATCH" || method === "PUT") && roleMatch) {
    await adminUpdateRole(req, res, url, roleMatch[1]);
    return true;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/(briefs|applications|subscribers)\/(\d+)$/);
  if (method === "DELETE" && deleteMatch) {
    adminDelete(req, res, url, deleteMatch[1], deleteMatch[2]);
    return true;
  }

  const cvMatch = pathname.match(/^\/api\/admin\/cv\/(\d+)$/);
  if (method === "GET" && cvMatch) {
    requireAdmin(req, url);
    downloadCv(req, res, cvMatch[1]);
    return true;
  }

  return false;
}

module.exports = {
  route: route,
  sendJson: sendJson,
  httpError: httpError,
  requireAdmin: requireAdmin
};
