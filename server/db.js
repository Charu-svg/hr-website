"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const config = require("./config");

let DatabaseSync;

try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  console.error(
    [
      "",
      "This server needs the built-in SQLite module, which arrived in Node 22.5.",
      "",
      "On Node 22.5 to 23.3 it is behind a flag, so start the server like this:",
      "    node --experimental-sqlite server/index.js",
      "",
      "On Node 23.4 and later, including Node 24, it works as-is.",
      "Check your version with: node --version",
      ""
    ].join("\n")
  );
  process.exit(1);
}

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new DatabaseSync(path.join(config.dataDir, "wrenfield.db"));

db.exec("pragma journal_mode = WAL");
db.exec("pragma foreign_keys = on");

db.exec(`
  create table if not exists briefs (
    id integer primary key autoincrement,
    created_at text not null,
    name text not null,
    company text not null,
    role_title text not null,
    desk text not null,
    location text not null,
    contract text,
    band_min integer,
    band_max integer,
    failed text not null,
    tried text,
    email text not null,
    phone text,
    start_when text,
    consent integer not null default 0,
    consent_at text not null,
    ip_hash text,
    status text not null default 'new'
  );

  create table if not exists applications (
    id integer primary key autoincrement,
    created_at text not null,
    role_ref text,
    role_title text,
    name text not null,
    email text not null,
    phone text,
    note text,
    cv_path text,
    cv_name text,
    cv_size integer,
    consent integer not null default 0,
    consent_at text not null,
    ip_hash text,
    status text not null default 'new'
  );

  create table if not exists subscribers (
    id integer primary key autoincrement,
    created_at text not null,
    email text not null unique,
    source text,
    consent_at text not null,
    ip_hash text
  );

  create table if not exists roles (
    ref text primary key,
    title text not null,
    desk text not null,
    desk_name text,
    location text not null,
    pattern text,
    contract text,
    hours text,
    band text,
    salary_min integer,
    salary_max integer,
    salary_note text,
    days_open integer,
    stage text,
    stage_label text,
    consultant text,
    client_type text,
    status_line text,
    summary text,
    responsibilities text,
    requirements text,
    sla_longlist text,
    sla_shortlist text,
    published integer not null default 1,
    updated_at text not null
  );

  create table if not exists notes (
    id integer primary key autoincrement,
    created_at text not null,
    kind text not null,
    ref_id integer,
    body text not null
  );

  create index if not exists briefs_created on briefs (created_at desc);
  create index if not exists applications_created on applications (created_at desc);
  create index if not exists roles_published on roles (published, days_open);
`);

const ROLE_COLUMNS = [
  "ref",
  "title",
  "desk",
  "desk_name",
  "location",
  "pattern",
  "contract",
  "hours",
  "band",
  "salary_min",
  "salary_max",
  "salary_note",
  "days_open",
  "stage",
  "stage_label",
  "consultant",
  "client_type",
  "status_line",
  "summary",
  "responsibilities",
  "requirements",
  "sla_longlist",
  "sla_shortlist",
  "published",
  "updated_at"
];

function now() {
  return new Date().toISOString();
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip + "|wrenfield").digest("hex").slice(0, 24);
}

/* Seed the role ledger from the front-end data file the first time we run, so
   the board works from the database without anyone re-typing the roles. */
function seedRoles() {
  const count = db.prepare("select count(*) as total from roles").get().total;
  if (count > 0) return { seeded: 0 };

  const source = path.join(config.siteDir, "assets", "js", "roles.js");
  if (!fs.existsSync(source)) return { seeded: 0 };

  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(source, "utf8"), sandbox, { timeout: 5000 });

  const roles = sandbox.window.WRENFIELD_ROLES || [];
  const insert = db.prepare(
    "insert into roles (" +
      ROLE_COLUMNS.join(", ") +
      ") values (" +
      ROLE_COLUMNS.map(function () {
        return "?";
      }).join(", ") +
      ")"
  );

  roles.forEach(function (role) {
    insert.run(
      role.ref,
      role.title,
      role.desk,
      role.deskName || null,
      role.location,
      role.pattern || null,
      role.contract || null,
      role.hours || null,
      role.band || null,
      role.salaryMin === null || role.salaryMin === undefined ? null : role.salaryMin,
      role.salaryMax === null || role.salaryMax === undefined ? null : role.salaryMax,
      role.salaryNote || null,
      role.daysOpen || 0,
      role.stage || "brief",
      role.stageLabel || null,
      role.consultant || null,
      role.clientType || null,
      role.status || null,
      role.summary || null,
      JSON.stringify(role.responsibilities || []),
      JSON.stringify(role.requirements || []),
      role.slaLonglist || null,
      role.slaShortlist || null,
      1,
      now()
    );
  });

  return { seeded: roles.length };
}

function rowToRole(row) {
  return {
    ref: row.ref,
    title: row.title,
    desk: row.desk,
    deskName: row.desk_name,
    location: row.location,
    pattern: row.pattern,
    contract: row.contract,
    hours: row.hours,
    band: row.band,
    salaryMin: row.salary_min,
    salaryMax: row.salary_max,
    salaryNote: row.salary_note,
    daysOpen: row.days_open,
    stage: row.stage,
    stageLabel: row.stage_label,
    consultant: row.consultant,
    clientType: row.client_type,
    status: row.status_line,
    summary: row.summary,
    responsibilities: safeJson(row.responsibilities),
    requirements: safeJson(row.requirements),
    slaLonglist: row.sla_longlist,
    slaShortlist: row.sla_shortlist,
    published: Boolean(row.published),
    updatedAt: row.updated_at
  };
}

function safeJson(value) {
  try {
    return JSON.parse(value || "[]");
  } catch (error) {
    return [];
  }
}

const api = {
  now: now,
  hashIp: hashIp,
  seedRoles: seedRoles,

  listRoles: function (includeUnpublished) {
    const sql = includeUnpublished
      ? "select * from roles order by days_open asc"
      : "select * from roles where published = 1 order by days_open asc";
    return db.prepare(sql).all().map(rowToRole);
  },

  getRole: function (ref) {
    const row = db.prepare("select * from roles where ref = ?").get(ref);
    return row ? rowToRole(row) : null;
  },

  upsertRole: function (role) {
    const existing = db.prepare("select ref from roles where ref = ?").get(role.ref);
    const values = [
      role.title,
      role.deskName || null,
      role.location,
      role.pattern || null,
      role.contract || null,
      role.hours || null,
      role.band || null,
      role.salaryMin === null || role.salaryMin === undefined ? null : Number(role.salaryMin),
      role.salaryMax === null || role.salaryMax === undefined ? null : Number(role.salaryMax),
      role.salaryNote || null,
      Number(role.daysOpen || 0),
      role.stage || "brief",
      role.stageLabel || null,
      role.consultant || null,
      role.clientType || null,
      role.status || null,
      role.summary || null,
      JSON.stringify(role.responsibilities || []),
      JSON.stringify(role.requirements || []),
      role.slaLonglist || null,
      role.slaShortlist || null,
      role.published === false ? 0 : 1,
      now()
    ];

    if (existing) {
      const columns = ROLE_COLUMNS.slice(2);
      db.prepare(
        "update roles set " +
          ROLE_COLUMNS.slice(1)
            .map(function (column) {
              return column + " = ?";
            })
            .join(", ") +
          " where ref = ?"
      ).run(...values, role.ref);
      return { created: false, ref: role.ref, columns: columns.length };
    }

    db.prepare(
      "insert into roles (" +
        ROLE_COLUMNS.join(", ") +
        ") values (" +
        ROLE_COLUMNS.map(function () {
          return "?";
        }).join(", ") +
        ")"
    ).run(role.ref, ...values);

    return { created: true, ref: role.ref };
  },

  setRolePublished: function (ref, published) {
    db.prepare("update roles set published = ?, updated_at = ? where ref = ?").run(
      published ? 1 : 0,
      now(),
      ref
    );
    return api.getRole(ref);
  },

  createBrief: function (data) {
    const result = db
      .prepare(
        `insert into briefs
         (created_at, name, company, role_title, desk, location, contract, band_min, band_max,
          failed, tried, email, phone, start_when, consent, consent_at, ip_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        now(),
        data.name,
        data.company,
        data.roleTitle,
        data.desk,
        data.location,
        data.contract || null,
        data.bandMin === null || data.bandMin === undefined ? null : Number(data.bandMin),
        data.bandMax === null || data.bandMax === undefined ? null : Number(data.bandMax),
        data.failed,
        data.tried || null,
        data.email,
        data.phone || null,
        data.startWhen || null,
        now(),
        data.ipHash || null
      );

    return Number(result.lastInsertRowid);
  },

  createApplication: function (data) {
    const result = db
      .prepare(
        `insert into applications
         (created_at, role_ref, role_title, name, email, phone, note, cv_path, cv_name, cv_size,
          consent, consent_at, ip_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(
        now(),
        data.roleRef || null,
        data.roleTitle || null,
        data.name,
        data.email,
        data.phone || null,
        data.note || null,
        data.cvPath || null,
        data.cvName || null,
        data.cvSize || null,
        now(),
        data.ipHash || null
      );

    return Number(result.lastInsertRowid);
  },

  createSubscriber: function (data) {
    const existing = db.prepare("select id from subscribers where email = ?").get(data.email);
    if (existing) return { id: existing.id, existing: true };

    const result = db
      .prepare(
        "insert into subscribers (created_at, email, source, consent_at, ip_hash) values (?, ?, ?, ?, ?)"
      )
      .run(now(), data.email, data.source || null, now(), data.ipHash || null);

    return { id: Number(result.lastInsertRowid), existing: false };
  },

  listBriefs: function (limit) {
    return db
      .prepare("select * from briefs order by created_at desc limit ?")
      .all(Number(limit) || 100);
  },

  listApplications: function (limit) {
    return db
      .prepare("select * from applications order by created_at desc limit ?")
      .all(Number(limit) || 100);
  },

  listSubscribers: function (limit) {
    return db
      .prepare("select * from subscribers order by created_at desc limit ?")
      .all(Number(limit) || 200);
  },

  getApplication: function (id) {
    return db.prepare("select * from applications where id = ?").get(id) || null;
  },

  counts: function () {
    return {
      briefs: db.prepare("select count(*) as total from briefs").get().total,
      applications: db.prepare("select count(*) as total from applications").get().total,
      subscribers: db.prepare("select count(*) as total from subscribers").get().total,
      roles: db.prepare("select count(*) as total from roles where published = 1").get().total
    };
  },

  deleteRecord: function (table, id) {
    const allowed = ["briefs", "applications", "subscribers"];
    if (allowed.indexOf(table) === -1) throw new Error("Unknown table");

    if (table === "applications") {
      const row = api.getApplication(id);
      if (row && row.cv_path && fs.existsSync(row.cv_path)) {
        fs.unlinkSync(row.cv_path);
      }
    }

    const result = db.prepare("delete from " + table + " where id = ?").run(Number(id));
    return Number(result.changes);
  },

  /* Erase anything older than the retention window. The site tells candidates
     24 months, so this has to actually happen. */
  purgeExpired: function () {
    const cutoff = new Date(Date.now() - config.retentionDays * 86400000).toISOString();
    const stale = db
      .prepare("select id, cv_path from applications where created_at < ?")
      .all(cutoff);

    stale.forEach(function (row) {
      if (row.cv_path && fs.existsSync(row.cv_path)) {
        fs.unlinkSync(row.cv_path);
      }
    });

    const applications = Number(
      db.prepare("delete from applications where created_at < ?").run(cutoff).changes
    );
    const briefs = Number(db.prepare("delete from briefs where created_at < ?").run(cutoff).changes);
    const subscribers = Number(
      db.prepare("delete from subscribers where created_at < ?").run(cutoff).changes
    );

    return { applications: applications, briefs: briefs, subscribers: subscribers, cutoff: cutoff };
  }
};

module.exports = api;
