const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const root = __dirname;
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(root, "data");
const backupDir = path.join(dataDir, "backups");
const dbPath = path.join(dataDir, "planner-financeiro.sqlite");
const port = Number(process.env.PORT || process.argv[2] || 80);
const host = process.env.RAILWAY_ENVIRONMENT_ID ? "0.0.0.0" : process.env.HOST || "127.0.0.1";
const sessionCookieName = "planner_session";
const sessionDurationMs = 7 * 24 * 60 * 60 * 1000;
const authConfig = loadAuthConfig();
const sessions = new Map();

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });

const db = new DatabaseSync(dbPath);
initializeDatabase();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/login" && request.method === "POST") {
      await handleLogin(request, response);
      return;
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      handleLogout(request, response);
      return;
    }

    if (url.pathname === "/api/session" && request.method === "GET") {
      sendJson(response, 200, getSessionResponse(request));
      return;
    }

    if (authConfig && !isPublicPath(url.pathname) && !getCurrentUser(request)) {
      if (url.pathname.startsWith("/api/")) {
        sendJson(response, 401, { error: "Sessao expirada. Entre novamente." });
        return;
      }

      redirectToLogin(response, url);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStatic(request, response, url);
  } catch (error) {
    sendJson(response, 500, { error: "Erro interno do servidor.", details: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Planner financeiro running at http://localhost${port === 80 ? "" : `:${port}`}`);
  console.log(`SQLite database: ${dbPath}`);
});

process.on("SIGINT", closeAndExit);
process.on("SIGTERM", closeAndExit);

async function handleApi(request, response, url) {
  const method = request.method || "GET";
  const parts = url.pathname.split("/").filter(Boolean);

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      database: dbPath,
      bills: db.prepare("select count(*) as count from bills").get().count,
      revenues: db.prepare("select count(*) as count from revenues").get().count,
      assets: db.prepare("select count(*) as count from assets").get().count,
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/bills") {
    const bill = normalizeBill(await readJson(request));
    upsertBill(bill);
    sendJson(response, 200, { bill });
    return;
  }

  if (method === "PATCH" && parts[1] === "bills" && parts[3] === "payment") {
    const id = parts[2];
    const payment = normalizePayment(await readJson(request));
    markBillPaid(id, payment);
    sendJson(response, 200, { bill: getBill(id) });
    return;
  }

  if (method === "PATCH" && parts[1] === "bills" && parts[3] === "unpay") {
    const id = parts[2];
    const body = await readJson(request);
    undoBillPayment(id, body.updatedBy || "Andre");
    sendJson(response, 200, { bill: getBill(id) });
    return;
  }

  if (method === "DELETE" && parts[1] === "bills" && parts[2]) {
    db.prepare("delete from bills where id = ?").run(parts[2]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/revenues") {
    const revenue = normalizeRevenue(await readJson(request));
    upsertRevenue(revenue);
    sendJson(response, 200, { revenue });
    return;
  }

  if (method === "DELETE" && parts[1] === "revenues" && parts[2]) {
    db.prepare("delete from revenues where id = ?").run(parts[2]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/patrimony") {
    sendJson(response, 200, getPatrimonyState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/assets") {
    const asset = normalizeAsset(await readJson(request));
    upsertAsset(asset);
    sendJson(response, 200, { asset });
    return;
  }

  if (method === "DELETE" && parts[1] === "assets" && parts[2]) {
    db.prepare("delete from assets where id = ?").run(parts[2]);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/import-local") {
    const payload = await readJson(request);
    importState(payload);
    sendJson(response, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/backup") {
    sendJson(response, 200, { backup: createBackup() });
    return;
  }

  sendJson(response, 404, { error: "Rota nao encontrada." });
}

async function handleLogin(request, response) {
  if (!authConfig) {
    sendJson(response, 200, { ok: true, user: null });
    return;
  }

  const body = await readJson(request);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = authConfig.users.find((item) => item.username.toLowerCase() === username);

  if (!user || !verifyPassword(password, user.passwordHash)) {
    sendJson(response, 401, { error: "Usuario ou senha invalidos." });
    return;
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + sessionDurationMs;
  sessions.set(token, { username: user.username, name: user.name, actor: user.actor, expiresAt });

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "set-cookie": serializeSessionCookie(request, token, Math.floor(sessionDurationMs / 1000)),
  });
  response.end(JSON.stringify({ ok: true, user: { username: user.username, name: user.name, actor: user.actor } }));
}

function handleLogout(request, response) {
  const token = parseCookies(request.headers.cookie || "")[sessionCookieName];
  if (token) sessions.delete(token);

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "set-cookie": serializeSessionCookie(request, "", 0),
  });
  response.end(JSON.stringify({ ok: true }));
}

function getSessionResponse(request) {
  const user = getCurrentUser(request);
  return {
    authenticated: Boolean(user) || !authConfig,
    user: user ? { username: user.username, name: user.name, actor: user.actor } : null,
    authRequired: Boolean(authConfig),
  };
}

function initializeDatabase() {
  db.exec(`
    pragma journal_mode = WAL;
    pragma synchronous = FULL;
    pragma foreign_keys = ON;
    pragma busy_timeout = 5000;
    pragma trusted_schema = OFF;

    create table if not exists users (
      id text primary key,
      name text not null unique check (length(trim(name)) > 0)
    );

    create table if not exists workspaces (
      id text primary key,
      name text not null check (length(trim(name)) > 0),
      created_at text not null default (datetime('now'))
    );

    create table if not exists workspace_users (
      workspace_id text not null references workspaces(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      role text not null default 'owner',
      primary key (workspace_id, user_id)
    );

    create table if not exists categories (
      name text primary key,
      color text not null
    );

    create table if not exists bills (
      id text primary key,
      workspace_id text not null default 'home' references workspaces(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      amount_cents integer not null check (amount_cents >= 0),
      due_date text not null check (due_date glob '????-??-??'),
      category text not null references categories(name),
      owner text not null check (owner in ('Andre', 'Luciana', 'Ambos')),
      recurrence text not null check (recurrence in ('Unica', 'Mensal', 'Anual')),
      notes text not null default '',
      paid integer not null default 0 check (paid in (0, 1)),
      paid_amount_cents integer check (paid_amount_cents is null or paid_amount_cents >= 0),
      paid_date text check (paid_date is null or paid_date glob '????-??-??'),
      paid_by text check (paid_by is null or paid_by in ('Andre', 'Luciana')),
      payment_method text,
      payment_notes text not null default '',
      created_by text not null check (created_by in ('Andre', 'Luciana')),
      updated_by text not null check (updated_by in ('Andre', 'Luciana')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      check (
        (paid = 0 and paid_amount_cents is null and paid_date is null and paid_by is null)
        or
        (paid = 1 and paid_amount_cents is not null and paid_date is not null and paid_by is not null)
      )
    );

    create table if not exists revenues (
      id text primary key,
      workspace_id text not null default 'home' references workspaces(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      amount_cents integer not null check (amount_cents >= 0),
      date text not null check (date glob '????-??-??'),
      owner text not null check (owner in ('Andre', 'Luciana', 'Ambos')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_bills_month on bills(due_date);
    create index if not exists idx_bills_paid on bills(paid);
    create index if not exists idx_revenues_month on revenues(date);

    create table if not exists assets (
      id text primary key,
      workspace_id text not null default 'home' references workspaces(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      asset_type text not null check (asset_type in ('Investimento', 'Reserva', 'Imovel', 'Veiculo', 'Conta', 'Outros')),
      institution text not null default '',
      current_value_cents integer not null check (current_value_cents >= 0),
      invested_value_cents integer check (invested_value_cents is null or invested_value_cents >= 0),
      reference_date text not null check (reference_date glob '????-??-??'),
      liquidity text not null check (liquidity in ('D0', 'D1', 'Ate 30 dias', 'Longo prazo', 'Nao liquido')),
      owner text not null check (owner in ('Andre', 'Luciana', 'Ambos')),
      notes text not null default '',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_assets_type on assets(asset_type);
    create index if not exists idx_assets_value on assets(current_value_cents);

    create trigger if not exists bills_updated_at
    after update on bills
    for each row
    when old.updated_at = new.updated_at
    begin
      update bills set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists revenues_updated_at
    after update on revenues
    for each row
    when old.updated_at = new.updated_at
    begin
      update revenues set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists assets_updated_at
    after update on assets
    for each row
    when old.updated_at = new.updated_at
    begin
      update assets set updated_at = datetime('now') where id = new.id;
    end;
  `);

  transaction(() => {
    db.prepare("insert or ignore into users (id, name) values (?, ?)").run("andre", "Andre");
    db.prepare("insert or ignore into users (id, name) values (?, ?)").run("luciana", "Luciana");
    db.prepare("insert or ignore into workspaces (id, name) values (?, ?)").run("home", "Casa");
    db.prepare("insert or ignore into workspace_users (workspace_id, user_id, role) values (?, ?, ?)").run("home", "andre", "owner");
    db.prepare("insert or ignore into workspace_users (workspace_id, user_id, role) values (?, ?, ?)").run("home", "luciana", "owner");

    const categoryStmt = db.prepare("insert or ignore into categories (name, color) values (?, ?)");
    getDefaultCategories().forEach((category) => categoryStmt.run(category.name, category.color));
  });
}

function getState() {
  return {
    bills: db
      .prepare(
        `select id, name, amount_cents, due_date, category, owner, recurrence, notes,
                paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
                created_by, updated_by
           from bills
          order by due_date asc, name asc`,
      )
      .all()
      .map(rowToBill),
    revenues: db
      .prepare("select id, name, amount_cents, date, owner from revenues order by date asc, name asc")
      .all()
      .map(rowToRevenue),
    categories: db.prepare("select name, color from categories order by rowid asc").all(),
  };
}

function getPatrimonyState() {
  return {
    assets: db
      .prepare(
        `select id, name, asset_type, institution, current_value_cents, invested_value_cents,
                reference_date, liquidity, owner, notes
           from assets
          order by current_value_cents desc, name asc`,
      )
      .all()
      .map(rowToAsset),
  };
}

function importState(payload) {
  const incomingBills = Array.isArray(payload.bills) ? payload.bills : [];
  const incomingRevenues = Array.isArray(payload.revenues) ? payload.revenues : [];

  transaction(() => {
    incomingBills.forEach((bill) => upsertBill(normalizeBill(bill)));
    incomingRevenues.forEach((revenue) => upsertRevenue(normalizeRevenue(revenue)));
  });
}

function upsertBill(bill) {
  db.prepare(
    `insert into bills (
      id, workspace_id, name, amount_cents, due_date, category, owner, recurrence, notes,
      paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
      created_by, updated_by
    ) values (?, 'home', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      amount_cents = excluded.amount_cents,
      due_date = excluded.due_date,
      category = excluded.category,
      owner = excluded.owner,
      recurrence = excluded.recurrence,
      notes = excluded.notes,
      paid = excluded.paid,
      paid_amount_cents = excluded.paid_amount_cents,
      paid_date = excluded.paid_date,
      paid_by = excluded.paid_by,
      payment_method = excluded.payment_method,
      payment_notes = excluded.payment_notes,
      updated_by = excluded.updated_by`,
  ).run(
    bill.id,
    bill.name,
    toCents(bill.amount),
    bill.dueDate,
    bill.category,
    bill.owner,
    bill.recurrence,
    bill.notes,
    bill.paid ? 1 : 0,
    bill.paid ? toCents(bill.paidAmount ?? bill.amount) : null,
    bill.paid ? bill.paidDate : null,
    bill.paid ? bill.paidBy : null,
    bill.paymentMethod || null,
    bill.paymentNotes || "",
    bill.createdBy,
    bill.updatedBy,
  );
}

function markBillPaid(id, payment) {
  const result = db
    .prepare(
      `update bills
          set paid = 1,
              paid_amount_cents = ?,
              paid_date = ?,
              paid_by = ?,
              payment_method = ?,
              payment_notes = ?,
              updated_by = ?
        where id = ?`,
    )
    .run(toCents(payment.amount), payment.date, payment.by, payment.method, payment.notes, payment.updatedBy, id);

  if (result.changes === 0) {
    throw new Error("Conta nao encontrada.");
  }
}

function undoBillPayment(id, updatedBy) {
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  const result = db
    .prepare(
      `update bills
          set paid = 0,
              paid_amount_cents = null,
              paid_date = null,
              paid_by = null,
              payment_method = null,
              payment_notes = '',
              updated_by = ?
        where id = ?`,
    )
    .run(updatedBy, id);

  if (result.changes === 0) {
    throw new Error("Conta nao encontrada.");
  }
}

function upsertRevenue(revenue) {
  db.prepare(
    `insert into revenues (id, workspace_id, name, amount_cents, date, owner)
     values (?, 'home', ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       amount_cents = excluded.amount_cents,
       date = excluded.date,
       owner = excluded.owner`,
  ).run(revenue.id, revenue.name, toCents(revenue.amount), revenue.date, revenue.owner);
}

function upsertAsset(asset) {
  db.prepare(
    `insert into assets (
      id, workspace_id, name, asset_type, institution, current_value_cents,
      invested_value_cents, reference_date, liquidity, owner, notes
    ) values (?, 'home', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      asset_type = excluded.asset_type,
      institution = excluded.institution,
      current_value_cents = excluded.current_value_cents,
      invested_value_cents = excluded.invested_value_cents,
      reference_date = excluded.reference_date,
      liquidity = excluded.liquidity,
      owner = excluded.owner,
      notes = excluded.notes`,
  ).run(
    asset.id,
    asset.name,
    asset.assetType,
    asset.institution,
    toCents(asset.currentValue),
    asset.investedValue == null ? null : toCents(asset.investedValue),
    asset.referenceDate,
    asset.liquidity,
    asset.owner,
    asset.notes,
  );
}

function getBill(id) {
  const row = db
    .prepare(
      `select id, name, amount_cents, due_date, category, owner, recurrence, notes,
              paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
              created_by, updated_by
         from bills
        where id = ?`,
    )
    .get(id);

  return row ? rowToBill(row) : null;
}

function normalizeBill(raw) {
  const paid = Boolean(raw.paid);
  const amount = Number(raw.amount);
  const paidAmount = paid ? Number(raw.paidAmount ?? raw.amount) : null;
  const dueDate = String(raw.dueDate || "");
  const paidDate = paid ? String(raw.paidDate || "") : null;
  const createdBy = raw.createdBy || "Andre";
  const updatedBy = raw.updatedBy || createdBy;

  if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor previsto invalido.");
  if (paid && (!Number.isFinite(paidAmount) || paidAmount < 0)) throw new Error("Valor pago invalido.");
  assertDate(dueDate, "dueDate");
  if (paid) assertDate(paidDate, "paidDate");
  assertChoice(raw.category, getDefaultCategories().map((category) => category.name), "category");
  assertChoice(raw.owner, ["Andre", "Luciana", "Ambos"], "owner");
  assertChoice(raw.recurrence, ["Unica", "Mensal", "Anual"], "recurrence");
  assertChoice(createdBy, ["Andre", "Luciana"], "createdBy");
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  if (paid) assertChoice(raw.paidBy, ["Andre", "Luciana"], "paidBy");

  return {
    id: raw.id || crypto.randomUUID(),
    name: cleanText(raw.name, "name"),
    amount,
    dueDate,
    category: raw.category,
    owner: raw.owner,
    recurrence: raw.recurrence,
    notes: String(raw.notes || "").trim(),
    paid,
    paidAmount,
    paidDate,
    paidBy: paid ? raw.paidBy : null,
    paymentMethod: paid ? String(raw.paymentMethod || "Pix").trim() : null,
    paymentNotes: paid ? String(raw.paymentNotes || "").trim() : "",
    createdBy,
    updatedBy,
  };
}

function normalizePayment(raw) {
  const amount = Number(raw.amount);
  const date = String(raw.date || "");
  const by = raw.by || raw.paidBy;
  const updatedBy = raw.updatedBy || by;

  if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor pago invalido.");
  assertDate(date, "date");
  assertChoice(by, ["Andre", "Luciana"], "by");
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");

  return {
    amount,
    date,
    by,
    method: String(raw.method || "Pix").trim(),
    notes: String(raw.notes || "").trim(),
    updatedBy,
  };
}

function normalizeRevenue(raw) {
  const amount = Number(raw.amount);
  const date = String(raw.date || "");

  if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor invalido.");
  assertDate(date, "date");
  assertChoice(raw.owner, ["Andre", "Luciana", "Ambos"], "owner");

  return {
    id: raw.id || crypto.randomUUID(),
    name: cleanText(raw.name, "name"),
    amount,
    date,
    owner: raw.owner,
  };
}

function normalizeAsset(raw) {
  const currentValue = Number(raw.currentValue);
  const investedValue = raw.investedValue === "" || raw.investedValue == null ? null : Number(raw.investedValue);
  const referenceDate = String(raw.referenceDate || "");

  if (!Number.isFinite(currentValue) || currentValue < 0) throw new Error("Valor atual invalido.");
  if (investedValue != null && (!Number.isFinite(investedValue) || investedValue < 0)) throw new Error("Valor investido invalido.");
  assertDate(referenceDate, "referenceDate");
  assertChoice(raw.assetType, getAssetTypes(), "assetType");
  assertChoice(raw.liquidity, getLiquidityOptions(), "liquidity");
  assertChoice(raw.owner, ["Andre", "Luciana", "Ambos"], "owner");

  return {
    id: raw.id || crypto.randomUUID(),
    name: cleanText(raw.name, "name"),
    assetType: raw.assetType,
    institution: String(raw.institution || "").trim(),
    currentValue,
    investedValue,
    referenceDate,
    liquidity: raw.liquidity,
    owner: raw.owner,
    notes: String(raw.notes || "").trim(),
  };
}

function rowToBill(row) {
  return {
    id: row.id,
    name: row.name,
    amount: fromCents(row.amount_cents),
    dueDate: row.due_date,
    category: row.category,
    owner: row.owner,
    recurrence: row.recurrence,
    notes: row.notes,
    paid: Boolean(row.paid),
    paidAmount: row.paid_amount_cents == null ? null : fromCents(row.paid_amount_cents),
    paidDate: row.paid_date,
    paidBy: row.paid_by,
    paymentMethod: row.payment_method,
    paymentNotes: row.payment_notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function rowToRevenue(row) {
  return {
    id: row.id,
    name: row.name,
    amount: fromCents(row.amount_cents),
    date: row.date,
    owner: row.owner,
  };
}

function rowToAsset(row) {
  return {
    id: row.id,
    name: row.name,
    assetType: row.asset_type,
    institution: row.institution,
    currentValue: fromCents(row.current_value_cents),
    investedValue: row.invested_value_cents == null ? null : fromCents(row.invested_value_cents),
    referenceDate: row.reference_date,
    liquidity: row.liquidity,
    owner: row.owner,
    notes: row.notes,
  };
}

function createBackup() {
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDir, `planner-financeiro-${stamp}.sqlite`);
  const escapedPath = backupPath.replaceAll("'", "''");
  db.exec(`vacuum into '${escapedPath}'`);
  return backupPath;
}

function transaction(callback) {
  db.exec("begin immediate");
  try {
    const result = callback();
    db.exec("commit");
    return result;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}

function serveStatic(request, response, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, pathname));
  const relative = path.relative(root, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(content);
  });
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        request.destroy();
        reject(new Error("Payload muito grande."));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function loadAuthConfig() {
  const raw = process.env.PLANNER_AUTH_CONFIG || readLocalAuthConfig();
  if (!raw) return null;

  const config = JSON.parse(raw);
  if (!Array.isArray(config.users) || !config.users.length) {
    throw new Error("PLANNER_AUTH_CONFIG precisa conter usuarios.");
  }

  return {
    users: config.users.map((user) => ({
      username: cleanText(user.username, "username"),
      name: cleanText(user.name || user.username, "name"),
      actor: cleanText(user.actor || user.name || user.username, "actor"),
      passwordHash: cleanText(user.passwordHash, "passwordHash"),
    })),
  };
}

function readLocalAuthConfig() {
  const filePath = path.join(root, "auth.local.json");
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function verifyPassword(password, passwordHash) {
  const [scheme, iterationsRaw, salt, expected] = passwordHash.split("$");
  if (scheme !== "pbkdf2-sha256") return false;

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(actual, expected) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function getCurrentUser(request) {
  const token = parseCookies(request.headers.cookie || "")[sessionCookieName];
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }

  return session;
}

function parseCookies(header) {
  return header.split(";").reduce((cookies, entry) => {
    const index = entry.indexOf("=");
    if (index === -1) return cookies;
    const key = entry.slice(0, index).trim();
    const value = entry.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function serializeSessionCookie(request, token, maxAgeSeconds) {
  const secure = process.env.RAILWAY_ENVIRONMENT_ID || request.headers["x-forwarded-proto"] === "https";
  return [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function isPublicPath(pathname) {
  return ["/login.html", "/login.js", "/styles.css", "/favicon.ico"].includes(pathname);
}

function redirectToLogin(response, url) {
  const next = encodeURIComponent(`${url.pathname}${url.search}`);
  response.writeHead(302, {
    "cache-control": "no-store",
    location: `/login.html?next=${next}`,
  });
  response.end();
}

function toCents(value) {
  return Math.round(Number(value) * 100);
}

function fromCents(value) {
  return Number(value) / 100;
}

function cleanText(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Campo obrigatorio: ${field}.`);
  return text;
}

function assertChoice(value, choices, field) {
  if (!choices.includes(value)) {
    throw new Error(`Valor invalido para ${field}.`);
  }
}

function assertDate(value, field) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Data invalida para ${field}.`);
  }
}

function getDefaultCategories() {
  return [
    { name: "Moradia", color: "#2f7d5c" },
    { name: "Cartao", color: "#5f5aa2" },
    { name: "Mercado", color: "#2d6f95" },
    { name: "Saude", color: "#b64c57" },
    { name: "Transporte", color: "#72844b" },
    { name: "Assinaturas", color: "#b9792d" },
    { name: "Educacao", color: "#6d6f78" },
    { name: "Lazer", color: "#8860a8" },
    { name: "Impostos", color: "#9a5a42" },
    { name: "Investimentos", color: "#287276" },
    { name: "Outros", color: "#697377" },
  ];
}

function getAssetTypes() {
  return ["Investimento", "Reserva", "Imovel", "Veiculo", "Conta", "Outros"];
}

function getLiquidityOptions() {
  return ["D0", "D1", "Ate 30 dias", "Longo prazo", "Nao liquido"];
}

function closeAndExit() {
  db.close();
  process.exit(0);
}
