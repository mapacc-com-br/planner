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
      billOccurrences: db.prepare("select count(*) as count from bill_occurrences").get().count,
      revenues: db.prepare("select count(*) as count from revenues").get().count,
      assets: db.prepare("select count(*) as count from assets").get().count,
      cardStatements: db.prepare("select count(*) as count from card_statements").get().count,
      cardTransactions: db.prepare("select count(*) as count from card_transactions").get().count,
      trips: db.prepare("select count(*) as count from trips").get().count,
      tripExpenses: db.prepare("select count(*) as count from trip_expenses").get().count,
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

  if (method === "POST" && url.pathname === "/api/bill-occurrences") {
    const occurrence = normalizeBillOccurrence(await readJson(request));
    upsertBillOccurrence(occurrence);
    sendJson(response, 200, { occurrence });
    return;
  }

  if (method === "PATCH" && parts[1] === "bills" && parts[3] === "recurrence-end") {
    const id = pathParam(parts[2]);
    const body = await readJson(request);
    endBillRecurrence(id, body.recurrenceUntil || null, body.updatedBy || "Andre");
    sendJson(response, 200, { bill: getBill(id) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/recurring-bills/split") {
    const body = await readJson(request);
    const bill = splitRecurringBill(body.parentId, body.competence, normalizeBill(body.bill));
    sendJson(response, 200, { bill });
    return;
  }

  if (method === "PATCH" && parts[1] === "bills" && parts[3] === "payment") {
    const id = pathParam(parts[2]);
    const payment = normalizePayment(await readJson(request));
    const occurrence = parseOccurrenceId(id);
    if (occurrence) {
      markBillOccurrencePaid(occurrence.parentId, occurrence.competence, payment);
      sendJson(response, 200, { ok: true });
      return;
    }

    markBillPaid(id, payment);
    sendJson(response, 200, { bill: getBill(id) });
    return;
  }

  if (method === "PATCH" && parts[1] === "bills" && parts[3] === "unpay") {
    const id = pathParam(parts[2]);
    const body = await readJson(request);
    const occurrence = parseOccurrenceId(id);
    if (occurrence) {
      undoBillOccurrencePayment(occurrence.parentId, occurrence.competence, body.updatedBy || "Andre");
      sendJson(response, 200, { ok: true });
      return;
    }

    undoBillPayment(id, body.updatedBy || "Andre");
    sendJson(response, 200, { bill: getBill(id) });
    return;
  }

  if (method === "DELETE" && parts[1] === "bills" && parts[2]) {
    db.prepare("delete from bills where id = ?").run(pathParam(parts[2]));
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
    db.prepare("delete from revenues where id = ?").run(pathParam(parts[2]));
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
    db.prepare("delete from assets where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/card-statements") {
    sendJson(response, 200, getCardStatementsState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/card-statements") {
    const statement = normalizeCardStatement(await readJson(request));
    saveCardStatement(statement);
    sendJson(response, 200, { statement: getCardStatement(statement.id) });
    return;
  }

  if (method === "DELETE" && parts[1] === "card-statements" && parts[2]) {
    db.prepare("delete from card_statements where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "GET" && url.pathname === "/api/trips") {
    sendJson(response, 200, getTripsState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/trips") {
    const trip = normalizeTrip(await readJson(request));
    saveTrip(trip);
    sendJson(response, 200, { trip: getTrip(trip.id) });
    return;
  }

  if (method === "POST" && parts[1] === "trips" && parts[3] === "duplicate") {
    const trip = duplicateTrip(pathParam(parts[2]));
    sendJson(response, 200, { trip });
    return;
  }

  if (method === "PATCH" && parts[1] === "trips" && parts[3] === "archive") {
    const body = await readJson(request);
    archiveTrip(pathParam(parts[2]), body.updatedBy || "Andre");
    sendJson(response, 200, { trip: getTrip(pathParam(parts[2])) });
    return;
  }

  if (method === "DELETE" && parts[1] === "trips" && parts[2]) {
    deleteTrip(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-categories") {
    const category = normalizeTripCategory(await readJson(request));
    upsertTripCategory(category);
    sendJson(response, 200, { category });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-categories" && parts[2]) {
    db.prepare("delete from trip_categories where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-expenses") {
    const expense = normalizeTripExpense(await readJson(request));
    saveTripExpense(expense);
    sendJson(response, 200, { expense: getTripExpense(expense.id) });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-expenses" && parts[2]) {
    deleteTripExpense(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-reservations") {
    const reservation = normalizeTripReservation(await readJson(request));
    upsertTripReservation(reservation);
    sendJson(response, 200, { reservation });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-reservations" && parts[2]) {
    db.prepare("delete from trip_reservations where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-itinerary-items") {
    const item = normalizeTripItineraryItem(await readJson(request));
    upsertTripItineraryItem(item);
    sendJson(response, 200, { item });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-itinerary-items" && parts[2]) {
    db.prepare("delete from trip_itinerary_items where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-checklist-items") {
    const item = normalizeTripChecklistItem(await readJson(request));
    upsertTripChecklistItem(item);
    sendJson(response, 200, { item });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-checklist-items" && parts[2]) {
    db.prepare("delete from trip_checklist_items where id = ?").run(pathParam(parts[2]));
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === "POST" && url.pathname === "/api/trip-documents") {
    const document = normalizeTripDocument(await readJson(request));
    upsertTripDocument(document);
    sendJson(response, 200, { document });
    return;
  }

  if (method === "DELETE" && parts[1] === "trip-documents" && parts[2]) {
    db.prepare("delete from trip_documents where id = ?").run(pathParam(parts[2]));
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
      recurrence_until text check (recurrence_until is null or recurrence_until glob '????-??-??'),
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

    create table if not exists bill_occurrences (
      parent_id text not null references bills(id) on delete cascade,
      competence text not null check (competence glob '????-??'),
      due_date text check (due_date is null or due_date glob '????-??-??'),
      amount_cents integer check (amount_cents is null or amount_cents >= 0),
      category text references categories(name),
      owner text check (owner is null or owner in ('Andre', 'Luciana', 'Ambos')),
      notes text,
      paid integer not null default 0 check (paid in (0, 1)),
      paid_amount_cents integer check (paid_amount_cents is null or paid_amount_cents >= 0),
      paid_date text check (paid_date is null or paid_date glob '????-??-??'),
      paid_by text check (paid_by is null or paid_by in ('Andre', 'Luciana')),
      payment_method text,
      payment_notes text,
      updated_by text not null check (updated_by in ('Andre', 'Luciana')),
      deleted integer not null default 0 check (deleted in (0, 1)),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      primary key (parent_id, competence),
      check (
        (paid = 0 and paid_amount_cents is null and paid_date is null and paid_by is null)
        or
        (paid = 1 and paid_amount_cents is not null and paid_date is not null and paid_by is not null)
      )
    );

    create index if not exists idx_bill_occurrences_parent on bill_occurrences(parent_id);
    create index if not exists idx_bill_occurrences_competence on bill_occurrences(competence);

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

    create table if not exists card_statements (
      id text primary key,
      workspace_id text not null default 'home' references workspaces(id) on delete cascade,
      label text not null check (length(trim(label)) > 0),
      card_name text not null check (length(trim(card_name)) > 0),
      closing_date text check (closing_date is null or closing_date glob '????-??-??'),
      due_date text check (due_date is null or due_date glob '????-??-??'),
      imported_by text not null check (imported_by in ('Andre', 'Luciana')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists card_transactions (
      id text primary key,
      statement_id text not null references card_statements(id) on delete cascade,
      purchase_date text not null check (purchase_date glob '????-??-??'),
      description text not null check (length(trim(description)) > 0),
      category text not null check (length(trim(category)) > 0),
      amount_cents integer not null,
      installments text not null default '',
      owner text not null check (owner in ('Andre', 'Luciana', 'Ambos')),
      notes text not null default '',
      created_at text not null default (datetime('now'))
    );

    create index if not exists idx_card_transactions_statement on card_transactions(statement_id);
    create index if not exists idx_card_transactions_date on card_transactions(purchase_date);
    create index if not exists idx_card_transactions_category on card_transactions(category);

    create table if not exists trips (
      id text primary key,
      workspace_id text not null default 'home' references workspaces(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      primary_destination text not null check (length(trim(primary_destination)) > 0),
      other_destinations text not null default '',
      start_date text not null check (start_date glob '????-??-??'),
      end_date text not null check (end_date glob '????-??-??'),
      status text not null check (status in ('Planejamento', 'Confirmada', 'Em andamento', 'Concluida', 'Arquivada')),
      primary_currency text not null check (length(trim(primary_currency)) between 3 and 8),
      total_budget_cents integer not null check (total_budget_cents >= 0),
      travelers_count integer not null check (travelers_count >= 1),
      cover_image text not null default '',
      notes text not null default '',
      created_by text not null check (created_by in ('Andre', 'Luciana')),
      updated_by text not null check (updated_by in ('Andre', 'Luciana')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now')),
      check (end_date >= start_date)
    );

    create table if not exists trip_travelers (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      actor text check (actor is null or actor in ('Andre', 'Luciana')),
      active integer not null default 1 check (active in (0, 1)),
      created_at text not null default (datetime('now'))
    );

    create table if not exists trip_categories (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      name text not null check (length(trim(name)) > 0),
      planned_amount_cents integer not null default 0 check (planned_amount_cents >= 0),
      sort_order integer not null default 0,
      color text not null default '#2478c7',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists trip_expenses (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      category_id text references trip_categories(id) on delete set null,
      description text not null check (length(trim(description)) > 0),
      original_amount_cents integer not null check (original_amount_cents >= 0),
      original_currency text not null check (length(trim(original_currency)) between 3 and 8),
      exchange_rate_micros integer not null check (exchange_rate_micros > 0),
      converted_amount_cents integer not null check (converted_amount_cents >= 0),
      expense_date text not null check (expense_date glob '????-??-??'),
      due_date text check (due_date is null or due_date glob '????-??-??'),
      paid_date text check (paid_date is null or paid_date glob '????-??-??'),
      status text not null check (status in ('Previsto', 'Reservado', 'Pendente', 'Pago', 'Cancelado', 'Reembolsado')),
      payment_method text not null default 'Outro',
      account_label text not null default '',
      installment_count integer not null default 1 check (installment_count >= 1 and installment_count <= 120),
      paid_by_traveler_id text references trip_travelers(id) on delete set null,
      destination text not null default '',
      notes text not null default '',
      sync_to_planner integer not null default 0 check (sync_to_planner in (0, 1)),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists trip_expense_participants (
      expense_id text not null references trip_expenses(id) on delete cascade,
      traveler_id text not null references trip_travelers(id) on delete cascade,
      share_type text not null check (share_type in ('Igual', 'Percentual', 'Valor')),
      share_value_cents integer,
      calculated_amount_cents integer not null check (calculated_amount_cents >= 0),
      primary key (expense_id, traveler_id)
    );

    create table if not exists trip_installments (
      id text primary key,
      expense_id text not null references trip_expenses(id) on delete cascade,
      installment_number integer not null check (installment_number >= 1),
      due_date text not null check (due_date glob '????-??-??'),
      amount_cents integer not null check (amount_cents >= 0),
      status text not null check (status in ('Pendente', 'Pago', 'Cancelado')),
      planner_bill_id text references bills(id) on delete set null,
      created_at text not null default (datetime('now')),
      unique (expense_id, installment_number)
    );

    create table if not exists trip_reservations (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      reservation_type text not null check (length(trim(reservation_type)) > 0),
      name text not null check (length(trim(name)) > 0),
      company text not null default '',
      confirmation_code text not null default '',
      start_date_time text not null default '',
      end_date_time text not null default '',
      location text not null default '',
      amount_cents integer not null default 0 check (amount_cents >= 0),
      currency text not null check (length(trim(currency)) between 3 and 8),
      payment_status text not null check (payment_status in ('Pendente', 'Pago', 'Parcial', 'Cancelado')),
      reservation_status text not null check (reservation_status in ('Planejada', 'Confirmada', 'Pendente', 'Cancelada')),
      cancellation_deadline text check (cancellation_deadline is null or cancellation_deadline glob '????-??-??'),
      contact text not null default '',
      website text not null default '',
      notes text not null default '',
      attachment_url text not null default '',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists trip_itinerary_items (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      date text not null check (date glob '????-??-??'),
      start_time text not null default '',
      end_time text not null default '',
      city text not null default '',
      title text not null check (length(trim(title)) > 0),
      description text not null default '',
      location text not null default '',
      reservation_id text references trip_reservations(id) on delete set null,
      expense_id text references trip_expenses(id) on delete set null,
      sort_order integer not null default 0,
      status text not null check (status in ('Planejado', 'Confirmado', 'Concluido', 'Cancelado')),
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists trip_checklist_items (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      category text not null check (length(trim(category)) > 0),
      description text not null check (length(trim(description)) > 0),
      assigned_to_traveler_id text references trip_travelers(id) on delete set null,
      due_date text check (due_date is null or due_date glob '????-??-??'),
      priority text not null check (priority in ('Baixa', 'Media', 'Alta')),
      completed integer not null default 0 check (completed in (0, 1)),
      notes text not null default '',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create table if not exists trip_documents (
      id text primary key,
      trip_id text not null references trips(id) on delete cascade,
      traveler_id text references trip_travelers(id) on delete set null,
      document_type text not null check (length(trim(document_type)) > 0),
      name text not null check (length(trim(name)) > 0),
      masked_number text not null default '',
      issue_date text check (issue_date is null or issue_date glob '????-??-??'),
      expiration_date text check (expiration_date is null or expiration_date glob '????-??-??'),
      notes text not null default '',
      attachment_url text not null default '',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );

    create index if not exists idx_trips_dates on trips(start_date, end_date);
    create index if not exists idx_trip_travelers_trip on trip_travelers(trip_id);
    create index if not exists idx_trip_categories_trip on trip_categories(trip_id);
    create index if not exists idx_trip_expenses_trip on trip_expenses(trip_id);
    create index if not exists idx_trip_expenses_status on trip_expenses(status);
    create index if not exists idx_trip_installments_expense on trip_installments(expense_id);
    create index if not exists idx_trip_installments_bill on trip_installments(planner_bill_id);
    create index if not exists idx_trip_reservations_trip on trip_reservations(trip_id);
    create index if not exists idx_trip_itinerary_trip on trip_itinerary_items(trip_id, date);
    create index if not exists idx_trip_checklist_trip on trip_checklist_items(trip_id);
    create index if not exists idx_trip_documents_trip on trip_documents(trip_id);

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

    create trigger if not exists bill_occurrences_updated_at
    after update on bill_occurrences
    for each row
    when old.updated_at = new.updated_at
    begin
      update bill_occurrences set updated_at = datetime('now') where parent_id = new.parent_id and competence = new.competence;
    end;

    create trigger if not exists card_statements_updated_at
    after update on card_statements
    for each row
    when old.updated_at = new.updated_at
    begin
      update card_statements set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trips_updated_at
    after update on trips
    for each row
    when old.updated_at = new.updated_at
    begin
      update trips set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_categories_updated_at
    after update on trip_categories
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_categories set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_expenses_updated_at
    after update on trip_expenses
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_expenses set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_reservations_updated_at
    after update on trip_reservations
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_reservations set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_itinerary_items_updated_at
    after update on trip_itinerary_items
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_itinerary_items set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_checklist_items_updated_at
    after update on trip_checklist_items
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_checklist_items set updated_at = datetime('now') where id = new.id;
    end;

    create trigger if not exists trip_documents_updated_at
    after update on trip_documents
    for each row
    when old.updated_at = new.updated_at
    begin
      update trip_documents set updated_at = datetime('now') where id = new.id;
    end;
  `);

  ensureColumn("bills", "recurrence_until", "text check (recurrence_until is null or recurrence_until glob '????-??-??')");

  transaction(() => {
    db.prepare("insert or ignore into users (id, name) values (?, ?)").run("andre", "Andre");
    db.prepare("insert or ignore into users (id, name) values (?, ?)").run("luciana", "Luciana");
    db.prepare("insert or ignore into workspaces (id, name) values (?, ?)").run("home", "Casa");
    db.prepare("insert or ignore into workspace_users (workspace_id, user_id, role) values (?, ?, ?)").run("home", "andre", "owner");
    db.prepare("insert or ignore into workspace_users (workspace_id, user_id, role) values (?, ?, ?)").run("home", "luciana", "owner");

    const categoryStmt = db.prepare(`
      insert into categories (name, color)
      values (?, ?)
      on conflict(name) do update set color = excluded.color
    `);
    getDefaultCategories().forEach((category) => categoryStmt.run(category.name, category.color));
  });

  seedDemoTrip();
}

function getState() {
  return {
    bills: db
      .prepare(
        `select id, name, amount_cents, due_date, category, owner, recurrence, recurrence_until, notes,
                paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
                created_by, updated_by
           from bills
          order by due_date asc, name asc`,
      )
      .all()
      .map(rowToBill),
    billOccurrences: db
      .prepare(
        `select parent_id, competence, due_date, amount_cents, category, owner, notes,
                paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
                updated_by, deleted
           from bill_occurrences
          order by competence asc, parent_id asc`,
      )
      .all()
      .map(rowToBillOccurrence),
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

function getCardStatementsState() {
  return {
    statements: getCardStatements(),
  };
}

function getTripsState() {
  return {
    trips: getTrips(),
  };
}

function getTrips() {
  const trips = db
    .prepare(
      `select id, name, primary_destination, other_destinations, start_date, end_date, status,
              primary_currency, total_budget_cents, travelers_count, cover_image, notes,
              created_by, updated_by, created_at, updated_at
         from trips
        order by start_date asc, name asc`,
    )
    .all()
    .map(rowToTrip);

  if (!trips.length) return [];

  const travelers = db.prepare("select id, trip_id, name, actor, active from trip_travelers order by rowid asc").all().map(rowToTripTraveler);
  const categories = db
    .prepare("select id, trip_id, name, planned_amount_cents, sort_order, color from trip_categories order by sort_order asc, name asc")
    .all()
    .map(rowToTripCategory);
  const expenses = getTripExpenses();
  const reservations = db
    .prepare(
      `select id, trip_id, reservation_type, name, company, confirmation_code, start_date_time, end_date_time,
              location, amount_cents, currency, payment_status, reservation_status, cancellation_deadline,
              contact, website, notes, attachment_url
         from trip_reservations
        order by start_date_time asc, name asc`,
    )
    .all()
    .map(rowToTripReservation);
  const itinerary = db
    .prepare(
      `select id, trip_id, date, start_time, end_time, city, title, description, location,
              reservation_id, expense_id, sort_order, status
         from trip_itinerary_items
        order by date asc, sort_order asc, start_time asc, title asc`,
    )
    .all()
    .map(rowToTripItineraryItem);
  const checklist = db
    .prepare(
      `select id, trip_id, category, description, assigned_to_traveler_id, due_date, priority, completed, notes
         from trip_checklist_items
        order by completed asc, coalesce(due_date, '9999-12-31') asc, category asc`,
    )
    .all()
    .map(rowToTripChecklistItem);
  const documents = db
    .prepare(
      `select id, trip_id, traveler_id, document_type, name, masked_number, issue_date, expiration_date, notes, attachment_url
         from trip_documents
        order by expiration_date asc, name asc`,
    )
    .all()
    .map(rowToTripDocument);

  return trips.map((trip) => ({
    ...trip,
    travelers: travelers.filter((item) => item.tripId === trip.id),
    categories: categories.filter((item) => item.tripId === trip.id),
    expenses: expenses.filter((item) => item.tripId === trip.id),
    reservations: reservations.filter((item) => item.tripId === trip.id),
    itinerary: itinerary.filter((item) => item.tripId === trip.id),
    checklist: checklist.filter((item) => item.tripId === trip.id),
    documents: documents.filter((item) => item.tripId === trip.id),
  }));
}

function getTrip(id) {
  return getTrips().find((trip) => trip.id === id) || null;
}

function getTripExpenses() {
  const expenses = db
    .prepare(
      `select id, trip_id, category_id, description, original_amount_cents, original_currency,
              exchange_rate_micros, converted_amount_cents, expense_date, due_date, paid_date,
              status, payment_method, account_label, installment_count, paid_by_traveler_id,
              destination, notes, sync_to_planner, created_at, updated_at
         from trip_expenses
        order by expense_date asc, description asc`,
    )
    .all()
    .map(rowToTripExpense);

  if (!expenses.length) return [];

  const participants = db
    .prepare(
      `select expense_id, traveler_id, share_type, share_value_cents, calculated_amount_cents
         from trip_expense_participants
        order by rowid asc`,
    )
    .all()
    .map(rowToTripExpenseParticipant);
  const installments = db
    .prepare(
      `select id, expense_id, installment_number, due_date, amount_cents, status, planner_bill_id
         from trip_installments
        order by installment_number asc`,
    )
    .all()
    .map(rowToTripInstallment);

  return expenses.map((expense) => ({
    ...expense,
    participants: participants.filter((item) => item.expenseId === expense.id),
    installments: installments.filter((item) => item.expenseId === expense.id),
  }));
}

function getTripExpense(id) {
  return getTripExpenses().find((expense) => expense.id === id) || null;
}

function importState(payload) {
  const incomingBills = Array.isArray(payload.bills) ? payload.bills : [];
  const incomingRevenues = Array.isArray(payload.revenues) ? payload.revenues : [];

  transaction(() => {
    incomingBills.forEach((bill) => upsertBill(normalizeBill(bill)));
    incomingRevenues.forEach((revenue) => upsertRevenue(normalizeRevenue(revenue)));
  });
}

function saveTrip(trip) {
  transaction(() => {
    db.prepare(
      `insert into trips (
        id, workspace_id, name, primary_destination, other_destinations, start_date, end_date,
        status, primary_currency, total_budget_cents, travelers_count, cover_image, notes,
        created_by, updated_by
      ) values (?, 'home', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        primary_destination = excluded.primary_destination,
        other_destinations = excluded.other_destinations,
        start_date = excluded.start_date,
        end_date = excluded.end_date,
        status = excluded.status,
        primary_currency = excluded.primary_currency,
        total_budget_cents = excluded.total_budget_cents,
        travelers_count = excluded.travelers_count,
        cover_image = excluded.cover_image,
        notes = excluded.notes,
        updated_by = excluded.updated_by`,
    ).run(
      trip.id,
      trip.name,
      trip.primaryDestination,
      trip.otherDestinations,
      trip.startDate,
      trip.endDate,
      trip.status,
      trip.primaryCurrency,
      toCents(trip.totalBudget),
      trip.travelersCount,
      trip.coverImage,
      trip.notes,
      trip.createdBy,
      trip.updatedBy,
    );

    const travelerStmt = db.prepare(
      `insert into trip_travelers (id, trip_id, name, actor, active)
       values (?, ?, ?, ?, ?)
       on conflict(id) do update set
         name = excluded.name,
         actor = excluded.actor,
         active = excluded.active`,
    );
    trip.travelers.forEach((traveler) => travelerStmt.run(traveler.id, trip.id, traveler.name, traveler.actor, traveler.active ? 1 : 0));
    const travelerIds = trip.travelers.map((traveler) => traveler.id);
    if (travelerIds.length) {
      const placeholders = travelerIds.map(() => "?").join(", ");
      db.prepare(`delete from trip_travelers where trip_id = ? and id not in (${placeholders})`).run(trip.id, ...travelerIds);
    }

    seedTripCategories(trip.id);
  });
}

function upsertTripCategory(category) {
  assertTripExists(category.tripId);
  db.prepare(
    `insert into trip_categories (id, trip_id, name, planned_amount_cents, sort_order, color)
     values (?, ?, ?, ?, ?, ?)
     on conflict(id) do update set
       name = excluded.name,
       planned_amount_cents = excluded.planned_amount_cents,
       sort_order = excluded.sort_order,
       color = excluded.color`,
  ).run(category.id, category.tripId, category.name, toCents(category.plannedAmount), category.sortOrder, category.color);
}

function saveTripExpense(expense) {
  assertTripExists(expense.tripId);

  transaction(() => {
    deletePlannerBillsForTripExpense(expense.id);
    db.prepare("delete from trip_expense_participants where expense_id = ?").run(expense.id);
    db.prepare("delete from trip_installments where expense_id = ?").run(expense.id);

    db.prepare(
      `insert into trip_expenses (
        id, trip_id, category_id, description, original_amount_cents, original_currency,
        exchange_rate_micros, converted_amount_cents, expense_date, due_date, paid_date,
        status, payment_method, account_label, installment_count, paid_by_traveler_id,
        destination, notes, sync_to_planner
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        trip_id = excluded.trip_id,
        category_id = excluded.category_id,
        description = excluded.description,
        original_amount_cents = excluded.original_amount_cents,
        original_currency = excluded.original_currency,
        exchange_rate_micros = excluded.exchange_rate_micros,
        converted_amount_cents = excluded.converted_amount_cents,
        expense_date = excluded.expense_date,
        due_date = excluded.due_date,
        paid_date = excluded.paid_date,
        status = excluded.status,
        payment_method = excluded.payment_method,
        account_label = excluded.account_label,
        installment_count = excluded.installment_count,
        paid_by_traveler_id = excluded.paid_by_traveler_id,
        destination = excluded.destination,
        notes = excluded.notes,
        sync_to_planner = excluded.sync_to_planner`,
    ).run(
      expense.id,
      expense.tripId,
      expense.categoryId,
      expense.description,
      toCents(expense.originalAmount),
      expense.originalCurrency,
      toMicros(expense.exchangeRate),
      toCents(expense.convertedAmount),
      expense.expenseDate,
      expense.dueDate,
      expense.paidDate,
      expense.status,
      expense.paymentMethod,
      expense.accountLabel,
      expense.installmentCount,
      expense.paidByTravelerId,
      expense.destination,
      expense.notes,
      expense.syncToPlanner ? 1 : 0,
    );

    const participantStmt = db.prepare(
      `insert into trip_expense_participants (
        expense_id, traveler_id, share_type, share_value_cents, calculated_amount_cents
      ) values (?, ?, ?, ?, ?)`,
    );
    expense.participants.forEach((participant) => {
      participantStmt.run(
        expense.id,
        participant.travelerId,
        participant.shareType,
        participant.shareValue == null ? null : toCents(participant.shareValue),
        toCents(participant.calculatedAmount),
      );
    });

    createTripInstallments(expense);
  });
}

function deleteTripExpense(id) {
  transaction(() => {
    deletePlannerBillsForTripExpense(id);
    db.prepare("delete from trip_expenses where id = ?").run(id);
  });
}

function deleteTrip(id) {
  transaction(() => {
    const expenses = db.prepare("select id from trip_expenses where trip_id = ?").all(id);
    expenses.forEach((expense) => deletePlannerBillsForTripExpense(expense.id));
    db.prepare("delete from trips where id = ?").run(id);
  });
}

function deletePlannerBillsForTripExpense(expenseId) {
  const rows = db.prepare("select planner_bill_id from trip_installments where expense_id = ? and planner_bill_id is not null").all(expenseId);
  rows.forEach((row) => db.prepare("delete from bills where id = ?").run(row.planner_bill_id));
}

function createTripInstallments(expense) {
  const installmentStmt = db.prepare(
    `insert into trip_installments (id, expense_id, installment_number, due_date, amount_cents, status, planner_bill_id)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  const count = expense.installmentCount || 1;
  const totalCents = toCents(expense.convertedAmount);
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents - baseCents * count;

  for (let index = 0; index < count; index += 1) {
    const amountCents = baseCents + (index === 0 ? remainder : 0);
    const dueDate = addMonths(expense.dueDate || expense.expenseDate, index);
    const paid = expense.status === "Pago";
    const billId = expense.syncToPlanner ? crypto.randomUUID() : null;

    if (billId) {
      upsertBill({
        id: billId,
        name: `Viagem - ${expense.description}${count > 1 ? ` (${index + 1}/${count})` : ""}`,
        amount: fromCents(amountCents),
        dueDate,
        category: "Lazer",
        owner: "Ambos",
        recurrence: "Unica",
        recurrenceUntil: null,
        notes: `Gerada pela area de viagens. Despesa: ${expense.id}`,
        paid,
        paidAmount: paid ? fromCents(amountCents) : null,
        paidDate: paid ? expense.paidDate || dueDate : null,
        paidBy: paid ? "Andre" : null,
        paymentMethod: paid ? expense.paymentMethod : null,
        paymentNotes: "",
        createdBy: "Andre",
        updatedBy: "Andre",
      });
    }

    installmentStmt.run(
      crypto.randomUUID(),
      expense.id,
      index + 1,
      dueDate,
      amountCents,
      paid ? "Pago" : expense.status === "Cancelado" ? "Cancelado" : "Pendente",
      billId,
    );
  }
}

function upsertTripReservation(reservation) {
  assertTripExists(reservation.tripId);
  db.prepare(
    `insert into trip_reservations (
      id, trip_id, reservation_type, name, company, confirmation_code, start_date_time, end_date_time,
      location, amount_cents, currency, payment_status, reservation_status, cancellation_deadline,
      contact, website, notes, attachment_url
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      reservation_type = excluded.reservation_type,
      name = excluded.name,
      company = excluded.company,
      confirmation_code = excluded.confirmation_code,
      start_date_time = excluded.start_date_time,
      end_date_time = excluded.end_date_time,
      location = excluded.location,
      amount_cents = excluded.amount_cents,
      currency = excluded.currency,
      payment_status = excluded.payment_status,
      reservation_status = excluded.reservation_status,
      cancellation_deadline = excluded.cancellation_deadline,
      contact = excluded.contact,
      website = excluded.website,
      notes = excluded.notes,
      attachment_url = excluded.attachment_url`,
  ).run(
    reservation.id,
    reservation.tripId,
    reservation.type,
    reservation.name,
    reservation.company,
    reservation.confirmationCode,
    reservation.startDateTime,
    reservation.endDateTime,
    reservation.location,
    toCents(reservation.amount),
    reservation.currency,
    reservation.paymentStatus,
    reservation.reservationStatus,
    reservation.cancellationDeadline,
    reservation.contact,
    reservation.website,
    reservation.notes,
    reservation.attachmentUrl,
  );
}

function upsertTripItineraryItem(item) {
  assertTripExists(item.tripId);
  db.prepare(
    `insert into trip_itinerary_items (
      id, trip_id, date, start_time, end_time, city, title, description, location,
      reservation_id, expense_id, sort_order, status
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      date = excluded.date,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      city = excluded.city,
      title = excluded.title,
      description = excluded.description,
      location = excluded.location,
      reservation_id = excluded.reservation_id,
      expense_id = excluded.expense_id,
      sort_order = excluded.sort_order,
      status = excluded.status`,
  ).run(
    item.id,
    item.tripId,
    item.date,
    item.startTime,
    item.endTime,
    item.city,
    item.title,
    item.description,
    item.location,
    item.reservationId,
    item.expenseId,
    item.sortOrder,
    item.status,
  );
}

function upsertTripChecklistItem(item) {
  assertTripExists(item.tripId);
  db.prepare(
    `insert into trip_checklist_items (
      id, trip_id, category, description, assigned_to_traveler_id, due_date, priority, completed, notes
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      category = excluded.category,
      description = excluded.description,
      assigned_to_traveler_id = excluded.assigned_to_traveler_id,
      due_date = excluded.due_date,
      priority = excluded.priority,
      completed = excluded.completed,
      notes = excluded.notes`,
  ).run(
    item.id,
    item.tripId,
    item.category,
    item.description,
    item.assignedToTravelerId,
    item.dueDate,
    item.priority,
    item.completed ? 1 : 0,
    item.notes,
  );
}

function upsertTripDocument(document) {
  assertTripExists(document.tripId);
  db.prepare(
    `insert into trip_documents (
      id, trip_id, traveler_id, document_type, name, masked_number, issue_date, expiration_date, notes, attachment_url
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      traveler_id = excluded.traveler_id,
      document_type = excluded.document_type,
      name = excluded.name,
      masked_number = excluded.masked_number,
      issue_date = excluded.issue_date,
      expiration_date = excluded.expiration_date,
      notes = excluded.notes,
      attachment_url = excluded.attachment_url`,
  ).run(
    document.id,
    document.tripId,
    document.travelerId,
    document.type,
    document.name,
    document.maskedNumber,
    document.issueDate,
    document.expirationDate,
    document.notes,
    document.attachmentUrl,
  );
}

function archiveTrip(id, updatedBy) {
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  const result = db.prepare("update trips set status = 'Arquivada', updated_by = ? where id = ?").run(updatedBy, id);
  if (result.changes === 0) throw new Error("Viagem nao encontrada.");
}

function duplicateTrip(id) {
  const source = getTrip(id);
  if (!source) throw new Error("Viagem nao encontrada.");

  const newTrip = normalizeTrip({
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} (copia)`,
    status: "Planejamento",
    travelers: source.travelers.map((traveler) => ({ ...traveler, id: crypto.randomUUID() })),
    createdBy: source.createdBy || "Andre",
    updatedBy: "Andre",
  });

  saveTrip(newTrip);
  const categoryMap = new Map();
  source.categories.forEach((category, index) => {
    const cloned = { ...category, id: crypto.randomUUID(), tripId: newTrip.id, sortOrder: index + 1 };
    categoryMap.set(category.id, cloned.id);
    upsertTripCategory(normalizeTripCategory(cloned));
  });
  source.expenses.forEach((expense) => {
    const cloned = normalizeTripExpense({
      ...expense,
      id: crypto.randomUUID(),
      tripId: newTrip.id,
      categoryId: categoryMap.get(expense.categoryId) || null,
      participants: [],
      syncToPlanner: false,
    });
    saveTripExpense(cloned);
  });

  return getTrip(newTrip.id);
}

function upsertBill(bill) {
  db.prepare(
    `insert into bills (
      id, workspace_id, name, amount_cents, due_date, category, owner, recurrence, recurrence_until, notes,
      paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
      created_by, updated_by
    ) values (?, 'home', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name,
      amount_cents = excluded.amount_cents,
      due_date = excluded.due_date,
      category = excluded.category,
      owner = excluded.owner,
      recurrence = excluded.recurrence,
      recurrence_until = excluded.recurrence_until,
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
    bill.recurrenceUntil,
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

  syncTripInstallmentFromPlannerBill(id, true);
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

  syncTripInstallmentFromPlannerBill(id, false);
}

function syncTripInstallmentFromPlannerBill(billId, paid) {
  const row = db.prepare("select expense_id from trip_installments where planner_bill_id = ?").get(billId);
  if (!row) return;

  db.prepare("update trip_installments set status = ? where planner_bill_id = ?").run(paid ? "Pago" : "Pendente", billId);
  const total = db.prepare("select count(*) as count from trip_installments where expense_id = ? and status != 'Cancelado'").get(row.expense_id).count;
  const paidCount = db.prepare("select count(*) as count from trip_installments where expense_id = ? and status = 'Pago'").get(row.expense_id).count;

  if (total > 0 && paidCount === total) {
    const paidDate = getBill(billId)?.paidDate || null;
    db.prepare("update trip_expenses set status = 'Pago', paid_date = coalesce(?, paid_date) where id = ?").run(paidDate, row.expense_id);
    return;
  }

  db.prepare("update trip_expenses set status = 'Pendente', paid_date = null where id = ? and status = 'Pago'").run(row.expense_id);
}

function upsertBillOccurrence(occurrence) {
  db.prepare(
    `insert into bill_occurrences (
      parent_id, competence, due_date, amount_cents, category, owner, notes,
      paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
      updated_by, deleted
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(parent_id, competence) do update set
      due_date = excluded.due_date,
      amount_cents = excluded.amount_cents,
      category = excluded.category,
      owner = excluded.owner,
      notes = excluded.notes,
      paid = excluded.paid,
      paid_amount_cents = excluded.paid_amount_cents,
      paid_date = excluded.paid_date,
      paid_by = excluded.paid_by,
      payment_method = excluded.payment_method,
      payment_notes = excluded.payment_notes,
      updated_by = excluded.updated_by,
      deleted = excluded.deleted`,
  ).run(
    occurrence.parentId,
    occurrence.competence,
    occurrence.dueDate,
    occurrence.amount == null ? null : toCents(occurrence.amount),
    occurrence.category,
    occurrence.owner,
    occurrence.notes,
    occurrence.paid ? 1 : 0,
    occurrence.paid ? toCents(occurrence.paidAmount) : null,
    occurrence.paid ? occurrence.paidDate : null,
    occurrence.paid ? occurrence.paidBy : null,
    occurrence.paid ? occurrence.paymentMethod || null : null,
    occurrence.paid ? occurrence.paymentNotes || "" : "",
    occurrence.updatedBy,
    occurrence.deleted ? 1 : 0,
  );
}

function markBillOccurrencePaid(parentId, competence, payment) {
  assertRecurringParent(parentId);
  const current = getBillOccurrence(parentId, competence);
  upsertBillOccurrence({
    parentId,
    competence,
    dueDate: current?.dueDate || null,
    amount: current?.amount ?? null,
    category: current?.category || null,
    owner: current?.owner || null,
    notes: current?.notes ?? null,
    paid: true,
    paidAmount: payment.amount,
    paidDate: payment.date,
    paidBy: payment.by,
    paymentMethod: payment.method,
    paymentNotes: payment.notes,
    updatedBy: payment.updatedBy,
    deleted: false,
  });
}

function undoBillOccurrencePayment(parentId, competence, updatedBy) {
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  assertRecurringParent(parentId);
  const current = getBillOccurrence(parentId, competence);
  upsertBillOccurrence({
    parentId,
    competence,
    dueDate: current?.dueDate || null,
    amount: current?.amount ?? null,
    category: current?.category || null,
    owner: current?.owner || null,
    notes: current?.notes ?? null,
    paid: false,
    paidAmount: null,
    paidDate: null,
    paidBy: null,
    paymentMethod: null,
    paymentNotes: "",
    updatedBy,
    deleted: false,
  });
}

function endBillRecurrence(id, recurrenceUntil, updatedBy) {
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  if (recurrenceUntil) assertDate(recurrenceUntil, "recurrenceUntil");

  const result = db
    .prepare("update bills set recurrence_until = ?, updated_by = ? where id = ? and recurrence in ('Mensal', 'Anual')")
    .run(recurrenceUntil, updatedBy, id);

  if (result.changes === 0) {
    throw new Error("Conta recorrente nao encontrada.");
  }
}

function splitRecurringBill(parentId, competence, bill) {
  assertRecurringParent(parentId);
  assertMonthKey(competence, "competence");
  const recurrenceUntil = previousMonthEnd(competence);

  transaction(() => {
    endBillRecurrence(parentId, recurrenceUntil, bill.updatedBy);
    upsertBill(bill);
  });

  return getBill(bill.id);
}

function getBillOccurrence(parentId, competence) {
  const row = db
    .prepare(
      `select parent_id, competence, due_date, amount_cents, category, owner, notes,
              paid, paid_amount_cents, paid_date, paid_by, payment_method, payment_notes,
              updated_by, deleted
         from bill_occurrences
        where parent_id = ? and competence = ?`,
    )
    .get(parentId, competence);

  return row ? rowToBillOccurrence(row) : null;
}

function assertRecurringParent(parentId) {
  const bill = getBill(parentId);
  if (!bill || bill.recurrence === "Unica") {
    throw new Error("Conta recorrente nao encontrada.");
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

function saveCardStatement(statement) {
  transaction(() => {
    db.prepare(
      `insert into card_statements (id, workspace_id, label, card_name, closing_date, due_date, imported_by)
       values (?, 'home', ?, ?, ?, ?, ?)
       on conflict(id) do update set
         label = excluded.label,
         card_name = excluded.card_name,
         closing_date = excluded.closing_date,
         due_date = excluded.due_date,
         imported_by = excluded.imported_by`,
    ).run(statement.id, statement.label, statement.cardName, statement.closingDate, statement.dueDate, statement.importedBy);

    db.prepare("delete from card_transactions where statement_id = ?").run(statement.id);

    const transactionStmt = db.prepare(
      `insert into card_transactions (
        id, statement_id, purchase_date, description, category, amount_cents, installments, owner, notes
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    statement.transactions.forEach((item) => {
      transactionStmt.run(
        item.id,
        statement.id,
        item.purchaseDate,
        item.description,
        item.category,
        toCents(item.amount),
        item.installments,
        item.owner,
        item.notes,
      );
    });
  });
}

function getCardStatements() {
  const statements = db
    .prepare(
      `select id, label, card_name, closing_date, due_date, imported_by, created_at, updated_at
         from card_statements
        order by coalesce(due_date, closing_date, created_at) desc, created_at desc`,
    )
    .all()
    .map(rowToCardStatement);

  if (!statements.length) return [];

  const transactions = db
    .prepare(
      `select id, statement_id, purchase_date, description, category, amount_cents, installments, owner, notes
         from card_transactions
        order by purchase_date asc, description asc`,
    )
    .all()
    .map(rowToCardTransaction);

  const grouped = transactions.reduce((map, item) => {
    if (!map.has(item.statementId)) map.set(item.statementId, []);
    map.get(item.statementId).push(item);
    return map;
  }, new Map());

  return statements.map((statement) => ({
    ...statement,
    transactions: grouped.get(statement.id) || [],
  }));
}

function getCardStatement(id) {
  return getCardStatements().find((statement) => statement.id === id) || null;
}

function getBill(id) {
  const row = db
    .prepare(
      `select id, name, amount_cents, due_date, category, owner, recurrence, notes,
              recurrence_until,
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
  const recurrenceUntil = optionalDate(raw.recurrenceUntil, "recurrenceUntil");

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
    recurrenceUntil,
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

function normalizeBillOccurrence(raw) {
  const paid = Boolean(raw.paid);
  const deleted = Boolean(raw.deleted);
  const amount = raw.amount === "" || raw.amount == null ? null : Number(raw.amount);
  const paidAmount = paid ? Number(raw.paidAmount ?? raw.amount) : null;
  const paidDate = paid ? String(raw.paidDate || "") : null;
  const updatedBy = raw.updatedBy || raw.paidBy || "Andre";
  const dueDate = optionalDate(raw.dueDate, "dueDate");
  const category = raw.category ? cleanText(raw.category, "category") : null;
  const owner = raw.owner || null;

  assertRecurringParent(raw.parentId);
  assertMonthKey(raw.competence, "competence");
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error("Valor previsto invalido.");
  if (paid && (!Number.isFinite(paidAmount) || paidAmount < 0)) throw new Error("Valor pago invalido.");
  if (paid) assertDate(paidDate, "paidDate");
  if (category) assertChoice(category, getDefaultCategories().map((item) => item.name), "category");
  if (owner) assertChoice(owner, ["Andre", "Luciana", "Ambos"], "owner");
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");
  if (paid) assertChoice(raw.paidBy, ["Andre", "Luciana"], "paidBy");

  return {
    parentId: raw.parentId,
    competence: raw.competence,
    dueDate,
    amount,
    category,
    owner,
    notes: raw.notes == null ? null : String(raw.notes).trim(),
    paid,
    paidAmount,
    paidDate,
    paidBy: paid ? raw.paidBy : null,
    paymentMethod: paid ? String(raw.paymentMethod || "Pix").trim() : null,
    paymentNotes: paid ? String(raw.paymentNotes || "").trim() : "",
    updatedBy,
    deleted,
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

function normalizeCardStatement(raw) {
  const transactions = Array.isArray(raw.transactions) ? raw.transactions : [];
  const importedBy = raw.importedBy || "Andre";
  const closingDate = optionalDate(raw.closingDate, "closingDate");
  const dueDate = optionalDate(raw.dueDate, "dueDate");

  assertChoice(importedBy, ["Andre", "Luciana"], "importedBy");
  if (!transactions.length) throw new Error("Inclua ao menos uma transacao do cartao.");

  return {
    id: raw.id || crypto.randomUUID(),
    label: cleanText(raw.label, "label"),
    cardName: cleanText(raw.cardName || "Cartao", "cardName"),
    closingDate,
    dueDate,
    importedBy,
    transactions: transactions.map(normalizeCardTransaction),
  };
}

function normalizeCardTransaction(raw) {
  const amount = Number(raw.amount);
  const purchaseDate = String(raw.purchaseDate || raw.date || "");
  const owner = raw.owner || "Ambos";

  if (!Number.isFinite(amount)) throw new Error("Valor de transacao invalido.");
  assertDate(purchaseDate, "purchaseDate");
  assertChoice(owner, ["Andre", "Luciana", "Ambos"], "owner");

  return {
    id: raw.id || crypto.randomUUID(),
    purchaseDate,
    description: cleanText(raw.description || raw.name, "description"),
    category: cleanText(raw.category || "Sem categoria", "category"),
    amount,
    installments: String(raw.installments || "").trim(),
    owner,
    notes: String(raw.notes || "").trim(),
  };
}

function normalizeTrip(raw) {
  const startDate = String(raw.startDate || "");
  const endDate = String(raw.endDate || "");
  const totalBudget = Number(raw.totalBudget);
  const travelers = normalizeTripTravelers(raw.travelers, raw.travelersCount);
  const travelersCount = Math.max(Number(raw.travelersCount || travelers.length || 1), travelers.length || 1);
  const createdBy = raw.createdBy || "Andre";
  const updatedBy = raw.updatedBy || createdBy;

  assertDate(startDate, "startDate");
  assertDate(endDate, "endDate");
  if (endDate < startDate) throw new Error("A data final da viagem nao pode ser anterior a inicial.");
  if (!Number.isFinite(totalBudget) || totalBudget < 0) throw new Error("Orcamento da viagem invalido.");
  assertChoice(raw.status || "Planejamento", getTripStatuses(), "status");
  assertCurrency(raw.primaryCurrency || "BRL", "primaryCurrency");
  assertChoice(createdBy, ["Andre", "Luciana"], "createdBy");
  assertChoice(updatedBy, ["Andre", "Luciana"], "updatedBy");

  return {
    id: raw.id || crypto.randomUUID(),
    name: cleanText(raw.name, "name"),
    primaryDestination: cleanText(raw.primaryDestination, "primaryDestination"),
    otherDestinations: String(raw.otherDestinations || "").trim(),
    startDate,
    endDate,
    status: raw.status || "Planejamento",
    primaryCurrency: normalizeCurrency(raw.primaryCurrency || "BRL"),
    totalBudget,
    travelersCount,
    coverImage: String(raw.coverImage || "").trim(),
    notes: String(raw.notes || "").trim(),
    travelers,
    createdBy,
    updatedBy,
  };
}

function normalizeTripTravelers(rawTravelers, travelersCount) {
  const incoming = Array.isArray(rawTravelers) ? rawTravelers : [];
  const fallbackCount = Math.max(Number(travelersCount || 2), 1);
  const fallback = ["Andre", "Luciana"].slice(0, fallbackCount).map((name) => ({ name, actor: name }));
  const travelers = (incoming.length ? incoming : fallback)
    .map((traveler) => ({
      id: traveler.id || crypto.randomUUID(),
      name: cleanText(traveler.name, "traveler.name"),
      actor: traveler.actor || (["Andre", "Luciana"].includes(traveler.name) ? traveler.name : null),
      active: traveler.active !== false,
    }))
    .filter((traveler) => traveler.active);

  if (!travelers.length) throw new Error("Inclua ao menos um viajante.");
  travelers.forEach((traveler) => {
    if (traveler.actor) assertChoice(traveler.actor, ["Andre", "Luciana"], "traveler.actor");
  });

  return travelers;
}

function normalizeTripCategory(raw) {
  const plannedAmount = Number(raw.plannedAmount || 0);
  if (!Number.isFinite(plannedAmount) || plannedAmount < 0) throw new Error("Valor previsto da categoria invalido.");

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: cleanText(raw.tripId, "tripId"),
    name: cleanText(raw.name, "name"),
    plannedAmount,
    sortOrder: Number.isInteger(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    color: String(raw.color || "#2478c7").trim(),
  };
}

function normalizeTripExpense(raw) {
  const trip = getTrip(raw.tripId);
  if (!trip) throw new Error("Viagem nao encontrada.");

  const originalAmount = Number(raw.originalAmount ?? raw.amount);
  const exchangeRate = Number(raw.exchangeRate || (normalizeCurrency(raw.originalCurrency || trip.primaryCurrency) === trip.primaryCurrency ? 1 : 1));
  const convertedAmount = raw.convertedAmount === "" || raw.convertedAmount == null ? originalAmount * exchangeRate : Number(raw.convertedAmount);
  const expenseDate = String(raw.expenseDate || raw.date || "");
  const dueDate = optionalDate(raw.dueDate || expenseDate, "dueDate");
  const paidDate = optionalDate(raw.paidDate, "paidDate");
  const installmentCount = Math.max(1, Number(raw.installmentCount || 1));
  const status = raw.status || "Previsto";

  if (!Number.isFinite(originalAmount) || originalAmount < 0) throw new Error("Valor original da despesa invalido.");
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) throw new Error("Cotacao invalida.");
  if (!Number.isFinite(convertedAmount) || convertedAmount < 0) throw new Error("Valor convertido invalido.");
  assertDate(expenseDate, "expenseDate");
  assertChoice(status, getTripExpenseStatuses(), "status");
  assertChoice(raw.paymentMethod || "Outro", getTripPaymentMethods(), "paymentMethod");
  assertCurrency(raw.originalCurrency || trip.primaryCurrency, "originalCurrency");
  if (installmentCount < 1 || installmentCount > 120) throw new Error("Quantidade de parcelas invalida.");
  if (raw.categoryId) assertTripCategoryBelongsToTrip(raw.categoryId, trip.id);
  if (raw.paidByTravelerId) assertTripTravelerBelongsToTrip(raw.paidByTravelerId, trip.id);

  const participants = normalizeTripExpenseParticipants(raw.participants, trip.id, convertedAmount);

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: trip.id,
    categoryId: raw.categoryId || null,
    description: cleanText(raw.description || raw.name, "description"),
    originalAmount,
    originalCurrency: normalizeCurrency(raw.originalCurrency || trip.primaryCurrency),
    exchangeRate,
    convertedAmount,
    expenseDate,
    dueDate,
    paidDate,
    status,
    paymentMethod: raw.paymentMethod || "Outro",
    accountLabel: String(raw.accountLabel || "").trim(),
    installmentCount,
    paidByTravelerId: raw.paidByTravelerId || null,
    destination: String(raw.destination || "").trim(),
    notes: String(raw.notes || "").trim(),
    syncToPlanner: Boolean(raw.syncToPlanner),
    participants,
  };
}

function normalizeTripExpenseParticipants(rawParticipants, tripId, totalAmount) {
  const travelers = db.prepare("select id from trip_travelers where trip_id = ? and active = 1 order by rowid asc").all(tripId);
  const incoming = Array.isArray(rawParticipants) && rawParticipants.length ? rawParticipants : travelers.map((traveler) => ({ travelerId: traveler.id }));
  const validTravelerIds = new Set(travelers.map((traveler) => traveler.id));
  const totalCents = toCents(totalAmount);
  const baseCents = Math.floor(totalCents / incoming.length);
  let remainder = totalCents - baseCents * incoming.length;

  return incoming.map((participant) => {
    if (!validTravelerIds.has(participant.travelerId)) throw new Error("Participante da despesa invalido.");
    const shareType = participant.shareType || "Igual";
    assertChoice(shareType, ["Igual", "Percentual", "Valor"], "shareType");
    let calculatedCents = baseCents;

    if (shareType === "Valor") {
      calculatedCents = toCents(Number(participant.shareValue || 0));
    } else if (shareType === "Percentual") {
      calculatedCents = Math.round(totalCents * (Number(participant.shareValue || 0) / 100));
    } else if (remainder > 0) {
      calculatedCents += 1;
      remainder -= 1;
    }

    return {
      travelerId: participant.travelerId,
      shareType,
      shareValue: participant.shareValue === "" || participant.shareValue == null ? null : Number(participant.shareValue),
      calculatedAmount: fromCents(calculatedCents),
    };
  });
}

function normalizeTripReservation(raw) {
  const amount = Number(raw.amount || 0);
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Valor da reserva invalido.");
  assertTripExists(raw.tripId);
  assertChoice(raw.paymentStatus || "Pendente", getReservationPaymentStatuses(), "paymentStatus");
  assertChoice(raw.reservationStatus || "Planejada", getReservationStatuses(), "reservationStatus");
  assertCurrency(raw.currency || "BRL", "currency");

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: raw.tripId,
    type: cleanText(raw.type || raw.reservationType || "Reserva", "type"),
    name: cleanText(raw.name, "name"),
    company: String(raw.company || "").trim(),
    confirmationCode: String(raw.confirmationCode || "").trim(),
    startDateTime: String(raw.startDateTime || "").trim(),
    endDateTime: String(raw.endDateTime || "").trim(),
    location: String(raw.location || "").trim(),
    amount,
    currency: normalizeCurrency(raw.currency || "BRL"),
    paymentStatus: raw.paymentStatus || "Pendente",
    reservationStatus: raw.reservationStatus || "Planejada",
    cancellationDeadline: optionalDate(raw.cancellationDeadline, "cancellationDeadline"),
    contact: String(raw.contact || "").trim(),
    website: String(raw.website || "").trim(),
    notes: String(raw.notes || "").trim(),
    attachmentUrl: String(raw.attachmentUrl || "").trim(),
  };
}

function normalizeTripItineraryItem(raw) {
  const date = String(raw.date || "");
  assertTripExists(raw.tripId);
  assertDate(date, "date");
  if (raw.reservationId) assertTripReservationBelongsToTrip(raw.reservationId, raw.tripId);
  if (raw.expenseId) assertTripExpenseBelongsToTrip(raw.expenseId, raw.tripId);
  assertChoice(raw.status || "Planejado", getItineraryStatuses(), "status");

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: raw.tripId,
    date,
    startTime: String(raw.startTime || "").trim(),
    endTime: String(raw.endTime || "").trim(),
    city: String(raw.city || "").trim(),
    title: cleanText(raw.title, "title"),
    description: String(raw.description || "").trim(),
    location: String(raw.location || "").trim(),
    reservationId: raw.reservationId || null,
    expenseId: raw.expenseId || null,
    sortOrder: Number.isInteger(Number(raw.sortOrder)) ? Number(raw.sortOrder) : 0,
    status: raw.status || "Planejado",
  };
}

function normalizeTripChecklistItem(raw) {
  assertTripExists(raw.tripId);
  if (raw.assignedToTravelerId) assertTripTravelerBelongsToTrip(raw.assignedToTravelerId, raw.tripId);
  assertChoice(raw.priority || "Media", ["Baixa", "Media", "Alta"], "priority");

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: raw.tripId,
    category: cleanText(raw.category || "Outros", "category"),
    description: cleanText(raw.description, "description"),
    assignedToTravelerId: raw.assignedToTravelerId || null,
    dueDate: optionalDate(raw.dueDate, "dueDate"),
    priority: raw.priority || "Media",
    completed: Boolean(raw.completed),
    notes: String(raw.notes || "").trim(),
  };
}

function normalizeTripDocument(raw) {
  assertTripExists(raw.tripId);
  if (raw.travelerId) assertTripTravelerBelongsToTrip(raw.travelerId, raw.tripId);

  return {
    id: raw.id || crypto.randomUUID(),
    tripId: raw.tripId,
    travelerId: raw.travelerId || null,
    type: cleanText(raw.type || raw.documentType || "Documento", "type"),
    name: cleanText(raw.name, "name"),
    maskedNumber: String(raw.maskedNumber || "").trim(),
    issueDate: optionalDate(raw.issueDate, "issueDate"),
    expirationDate: optionalDate(raw.expirationDate, "expirationDate"),
    notes: String(raw.notes || "").trim(),
    attachmentUrl: String(raw.attachmentUrl || "").trim(),
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
    recurrenceUntil: row.recurrence_until,
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

function rowToBillOccurrence(row) {
  return {
    id: occurrenceId(row.parent_id, row.competence),
    parentId: row.parent_id,
    competence: row.competence,
    dueDate: row.due_date,
    amount: row.amount_cents == null ? null : fromCents(row.amount_cents),
    category: row.category,
    owner: row.owner,
    notes: row.notes,
    paid: Boolean(row.paid),
    paidAmount: row.paid_amount_cents == null ? null : fromCents(row.paid_amount_cents),
    paidDate: row.paid_date,
    paidBy: row.paid_by,
    paymentMethod: row.payment_method,
    paymentNotes: row.payment_notes || "",
    updatedBy: row.updated_by,
    deleted: Boolean(row.deleted),
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

function rowToCardStatement(row) {
  return {
    id: row.id,
    label: row.label,
    cardName: row.card_name,
    closingDate: row.closing_date,
    dueDate: row.due_date,
    importedBy: row.imported_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    transactions: [],
  };
}

function rowToCardTransaction(row) {
  return {
    id: row.id,
    statementId: row.statement_id,
    purchaseDate: row.purchase_date,
    description: row.description,
    category: row.category,
    amount: fromCents(row.amount_cents),
    installments: row.installments,
    owner: row.owner,
    notes: row.notes,
  };
}

function rowToTrip(row) {
  return {
    id: row.id,
    name: row.name,
    primaryDestination: row.primary_destination,
    otherDestinations: row.other_destinations,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    primaryCurrency: row.primary_currency,
    totalBudget: fromCents(row.total_budget_cents),
    travelersCount: row.travelers_count,
    coverImage: row.cover_image,
    notes: row.notes,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    travelers: [],
    categories: [],
    expenses: [],
    reservations: [],
    itinerary: [],
    checklist: [],
    documents: [],
  };
}

function rowToTripTraveler(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    actor: row.actor,
    active: Boolean(row.active),
  };
}

function rowToTripCategory(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    plannedAmount: fromCents(row.planned_amount_cents),
    sortOrder: row.sort_order,
    color: row.color,
  };
}

function rowToTripExpense(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    categoryId: row.category_id,
    description: row.description,
    originalAmount: fromCents(row.original_amount_cents),
    originalCurrency: row.original_currency,
    exchangeRate: fromMicros(row.exchange_rate_micros),
    convertedAmount: fromCents(row.converted_amount_cents),
    expenseDate: row.expense_date,
    dueDate: row.due_date,
    paidDate: row.paid_date,
    status: row.status,
    paymentMethod: row.payment_method,
    accountLabel: row.account_label,
    installmentCount: row.installment_count,
    paidByTravelerId: row.paid_by_traveler_id,
    destination: row.destination,
    notes: row.notes,
    syncToPlanner: Boolean(row.sync_to_planner),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    participants: [],
    installments: [],
  };
}

function rowToTripExpenseParticipant(row) {
  return {
    expenseId: row.expense_id,
    travelerId: row.traveler_id,
    shareType: row.share_type,
    shareValue: row.share_value_cents == null ? null : fromCents(row.share_value_cents),
    calculatedAmount: fromCents(row.calculated_amount_cents),
  };
}

function rowToTripInstallment(row) {
  return {
    id: row.id,
    expenseId: row.expense_id,
    installmentNumber: row.installment_number,
    dueDate: row.due_date,
    amount: fromCents(row.amount_cents),
    status: row.status,
    plannerBillId: row.planner_bill_id,
  };
}

function rowToTripReservation(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    type: row.reservation_type,
    name: row.name,
    company: row.company,
    confirmationCode: row.confirmation_code,
    startDateTime: row.start_date_time,
    endDateTime: row.end_date_time,
    location: row.location,
    amount: fromCents(row.amount_cents),
    currency: row.currency,
    paymentStatus: row.payment_status,
    reservationStatus: row.reservation_status,
    cancellationDeadline: row.cancellation_deadline,
    contact: row.contact,
    website: row.website,
    notes: row.notes,
    attachmentUrl: row.attachment_url,
  };
}

function rowToTripItineraryItem(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    city: row.city,
    title: row.title,
    description: row.description,
    location: row.location,
    reservationId: row.reservation_id,
    expenseId: row.expense_id,
    sortOrder: row.sort_order,
    status: row.status,
  };
}

function rowToTripChecklistItem(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    category: row.category,
    description: row.description,
    assignedToTravelerId: row.assigned_to_traveler_id,
    dueDate: row.due_date,
    priority: row.priority,
    completed: Boolean(row.completed),
    notes: row.notes,
  };
}

function rowToTripDocument(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    travelerId: row.traveler_id,
    type: row.document_type,
    name: row.name,
    maskedNumber: row.masked_number,
    issueDate: row.issue_date,
    expirationDate: row.expiration_date,
    notes: row.notes,
    attachmentUrl: row.attachment_url,
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

function ensureColumn(table, column, definition) {
  const exists = db.prepare(`pragma table_info(${table})`).all().some((item) => item.name === column);
  if (!exists) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
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

function occurrenceId(parentId, competence) {
  return `occ:${parentId}:${competence}`;
}

function parseOccurrenceId(id) {
  const match = String(id || "").match(/^occ:([^:]+):(\d{4}-\d{2})$/);
  return match ? { parentId: match[1], competence: match[2] } : null;
}

function pathParam(value) {
  return decodeURIComponent(String(value || ""));
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

function toMicros(value) {
  return Math.round(Number(value) * 1_000_000);
}

function fromMicros(value) {
  return Number(value) / 1_000_000;
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

function assertMonthKey(value, field) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ""))) {
    throw new Error(`Competencia invalida para ${field}.`);
  }
}

function optionalDate(value, field) {
  const text = String(value || "").trim();
  if (!text) return null;
  assertDate(text, field);
  return text;
}

function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function assertCurrency(value, field) {
  const currency = normalizeCurrency(value);
  if (!getCurrencies().includes(currency)) {
    throw new Error(`Moeda invalida para ${field}.`);
  }
}

function assertTripExists(id) {
  const exists = db.prepare("select 1 from trips where id = ?").get(id);
  if (!exists) throw new Error("Viagem nao encontrada.");
}

function assertTripTravelerBelongsToTrip(travelerId, tripId) {
  const exists = db.prepare("select 1 from trip_travelers where id = ? and trip_id = ?").get(travelerId, tripId);
  if (!exists) throw new Error("Viajante nao pertence a viagem.");
}

function assertTripCategoryBelongsToTrip(categoryId, tripId) {
  const exists = db.prepare("select 1 from trip_categories where id = ? and trip_id = ?").get(categoryId, tripId);
  if (!exists) throw new Error("Categoria nao pertence a viagem.");
}

function assertTripExpenseBelongsToTrip(expenseId, tripId) {
  const exists = db.prepare("select 1 from trip_expenses where id = ? and trip_id = ?").get(expenseId, tripId);
  if (!exists) throw new Error("Despesa nao pertence a viagem.");
}

function assertTripReservationBelongsToTrip(reservationId, tripId) {
  const exists = db.prepare("select 1 from trip_reservations where id = ? and trip_id = ?").get(reservationId, tripId);
  if (!exists) throw new Error("Reserva nao pertence a viagem.");
}

function previousMonthEnd(competence) {
  assertMonthKey(competence, "competence");
  const [year, month] = competence.split("-").map(Number);
  const date = new Date(year, month - 1, 0);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addMonths(dateKeyValue, amount) {
  const [year, month, day] = dateKeyValue.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function seedTripCategories(tripId) {
  const count = db.prepare("select count(*) as count from trip_categories where trip_id = ?").get(tripId).count;
  if (count) return;

  const stmt = db.prepare("insert into trip_categories (id, trip_id, name, planned_amount_cents, sort_order, color) values (?, ?, ?, ?, ?, ?)");
  getDefaultTripCategories().forEach((category, index) => {
    stmt.run(crypto.randomUUID(), tripId, category.name, 0, index + 1, category.color);
  });
}

function seedDemoTrip() {
  const count = db.prepare("select count(*) as count from trips").get().count;
  if (count) return;

  const tripId = "demo-italia-2027";
  const andreId = "demo-italia-andre";
  const lucianaId = "demo-italia-luciana";

  saveTrip(
    normalizeTrip({
      id: tripId,
      name: "[Demo] Italia 2027",
      primaryDestination: "Roma, Florenca e Veneza",
      otherDestinations: "Roma; Florenca; Veneza",
      startDate: "2027-07-10",
      endDate: "2027-07-24",
      status: "Planejamento",
      primaryCurrency: "BRL",
      totalBudget: 60000,
      travelersCount: 2,
      coverImage: "",
      notes: "Viagem de demonstracao criada automaticamente para testar a area de viagens. Pode excluir sem afetar o Planner.",
      travelers: [
        { id: andreId, name: "Andre", actor: "Andre" },
        { id: lucianaId, name: "Luciana", actor: "Luciana" },
      ],
      createdBy: "Andre",
      updatedBy: "Andre",
    }),
  );

  const categories = db.prepare("select id, name from trip_categories where trip_id = ?").all(tripId);
  const byName = (name) => categories.find((category) => category.name === name)?.id || null;
  const categoryPlans = [
    ["Passagens", 12000],
    ["Hospedagem", 15000],
    ["Alimentacao", 9000],
    ["Transporte", 5000],
    ["Passeios", 8000],
    ["Seguro viagem", 1600],
  ];
  categoryPlans.forEach(([name, amount]) => {
    const category = categories.find((item) => item.name === name);
    if (category) upsertTripCategory(normalizeTripCategory({ id: category.id, tripId, name, plannedAmount: amount, color: getTripCategoryColor(name) }));
  });

  [
    { description: "Passagens Sao Paulo - Roma", amount: 11500, categoryId: byName("Passagens"), status: "Pago", paymentMethod: "Cartao de credito", installmentCount: 6, date: "2026-11-10", paidBy: andreId },
    { description: "Hotel em Roma", amount: 6200, categoryId: byName("Hospedagem"), status: "Reservado", paymentMethod: "Cartao de credito", date: "2027-07-10", paidBy: lucianaId },
    { description: "Trem Roma - Florenca", amount: 180, currency: "EUR", exchangeRate: 6.1, categoryId: byName("Transporte"), status: "Pendente", paymentMethod: "Cartao de credito", date: "2027-07-15", paidBy: andreId },
    { description: "Seguro viagem casal", amount: 1450, categoryId: byName("Seguro viagem"), status: "Pago", paymentMethod: "Pix", date: "2027-01-12", paidBy: lucianaId },
    { description: "Passeio Coliseu", amount: 120, currency: "EUR", exchangeRate: 6.1, categoryId: byName("Passeios"), status: "Previsto", paymentMethod: "Cartao de credito", date: "2027-07-11", paidBy: andreId },
  ].forEach((expense) => {
    saveTripExpense(
      normalizeTripExpense({
        id: crypto.randomUUID(),
        tripId,
        categoryId: expense.categoryId,
        description: expense.description,
        originalAmount: expense.amount,
        originalCurrency: expense.currency || "BRL",
        exchangeRate: expense.exchangeRate || 1,
        expenseDate: expense.date,
        dueDate: expense.date,
        paidDate: expense.status === "Pago" ? expense.date : null,
        status: expense.status,
        paymentMethod: expense.paymentMethod,
        installmentCount: expense.installmentCount || 1,
        paidByTravelerId: expense.paidBy,
        destination: "Italia",
        participants: [{ travelerId: andreId }, { travelerId: lucianaId }],
        syncToPlanner: false,
        notes: "Despesa demonstrativa",
      }),
    );
  });

  upsertTripReservation(
    normalizeTripReservation({
      id: crypto.randomUUID(),
      tripId,
      type: "Hospedagem",
      name: "Hotel demo Roma",
      company: "Hotel Central",
      confirmationCode: "DEMO-ROMA-2027",
      startDateTime: "2027-07-10T15:00",
      endDateTime: "2027-07-15T11:00",
      location: "Roma",
      amount: 6200,
      currency: "BRL",
      paymentStatus: "Parcial",
      reservationStatus: "Confirmada",
      cancellationDeadline: "2027-06-10",
      notes: "Reserva demonstrativa",
    }),
  );

  upsertTripItineraryItem(normalizeTripItineraryItem({ id: crypto.randomUUID(), tripId, date: "2027-07-11", startTime: "09:00", city: "Roma", title: "Coliseu e Forum Romano", status: "Planejado" }));
  upsertTripChecklistItem(normalizeTripChecklistItem({ id: crypto.randomUUID(), tripId, category: "Documentos", description: "Conferir validade dos passaportes", assignedToTravelerId: andreId, dueDate: "2027-03-01", priority: "Alta" }));
  upsertTripDocument(normalizeTripDocument({ id: crypto.randomUUID(), tripId, travelerId: null, type: "Seguro", name: "Apolice seguro viagem", maskedNumber: "****-2027", expirationDate: "2027-07-24" }));
}

function getDefaultCategories() {
  return [
    { name: "Moradia", color: "#2478c7" },
    { name: "Cartao", color: "#6c69b1" },
    { name: "Mercado", color: "#3f95dc" },
    { name: "Saude", color: "#bf5b64" },
    { name: "Transporte", color: "#2f8b80" },
    { name: "Assinaturas", color: "#c38a2e" },
    { name: "Educacao", color: "#4d789f" },
    { name: "Lazer", color: "#d96c63" },
    { name: "Impostos", color: "#9b6a4b" },
    { name: "Investimentos", color: "#2f8b80" },
    { name: "Outros", color: "#7c8fa3" },
  ];
}

function getDefaultTripCategories() {
  return [
    { name: "Passagens", color: "#2478c7" },
    { name: "Hospedagem", color: "#6c69b1" },
    { name: "Alimentacao", color: "#3f95dc" },
    { name: "Transporte", color: "#2f8b80" },
    { name: "Aluguel de carro", color: "#4d789f" },
    { name: "Combustivel", color: "#c38a2e" },
    { name: "Pedagios", color: "#9b6a4b" },
    { name: "Passeios", color: "#d96c63" },
    { name: "Ingressos", color: "#bf5b64" },
    { name: "Compras", color: "#7c8fa3" },
    { name: "Seguro viagem", color: "#2f8b80" },
    { name: "Internet e chip", color: "#3f95dc" },
    { name: "Documentacao", color: "#9b6a4b" },
    { name: "Saude", color: "#bf5b64" },
    { name: "Gorjetas", color: "#c38a2e" },
    { name: "Impostos e taxas", color: "#9b6a4b" },
    { name: "Emergencias", color: "#d96c63" },
    { name: "Outros", color: "#7c8fa3" },
  ];
}

function getTripCategoryColor(name) {
  return getDefaultTripCategories().find((category) => category.name === name)?.color || "#2478c7";
}

function getCurrencies() {
  return ["BRL", "USD", "EUR", "GBP", "ARS", "CLP", "UYU", "JPY", "CAD", "AUD", "CHF", "MXN"];
}

function getTripStatuses() {
  return ["Planejamento", "Confirmada", "Em andamento", "Concluida", "Arquivada"];
}

function getTripExpenseStatuses() {
  return ["Previsto", "Reservado", "Pendente", "Pago", "Cancelado", "Reembolsado"];
}

function getTripPaymentMethods() {
  return ["Dinheiro", "PIX", "Pix", "Cartao de credito", "Cartao de debito", "Transferencia", "Milhas", "Pontos", "Outro"];
}

function getReservationPaymentStatuses() {
  return ["Pendente", "Pago", "Parcial", "Cancelado"];
}

function getReservationStatuses() {
  return ["Planejada", "Confirmada", "Pendente", "Cancelada"];
}

function getItineraryStatuses() {
  return ["Planejado", "Confirmado", "Concluido", "Cancelado"];
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
