const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
let serverProcess;
let dataDir;
let baseUrl;

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "planner-financeiro-tests-"));
  createLegacyDatabase(path.join(dataDir, "planner-financeiro.sqlite"));
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: "0",
      PLANNER_DISABLE_AUTH: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  baseUrl = await waitForServer(serverProcess);
});

test("migra investimentos antigos sem perder o registro existente", async () => {
  const state = await request("/api/patrimony");
  const legacy = state.assets.find((item) => item.id === "legacy-asset");

  assert.ok(legacy);
  assert.equal(legacy.status, "Ativo");
  assert.equal(legacy.returnRate, null);
  assert.equal(legacy.movements.length, 0);
  assert.equal(legacy.snapshots.length, 1);
  assert.equal(legacy.snapshots[0].balance, 1100);
});

test.after(async () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }

  const tempRoot = path.resolve(os.tmpdir());
  const resolvedDataDir = path.resolve(dataDir);
  if (!resolvedDataDir.startsWith(tempRoot + path.sep)) throw new Error("Diretorio de teste fora da pasta temporaria.");
  fs.rmSync(resolvedDataDir, { recursive: true, force: true });
});

test("salva os novos dados do investimento, snapshot e movimentos", async () => {
  const asset = {
    id: "asset-test",
    name: "CDB teste",
    assetType: "Investimento",
    institution: "Banco teste",
    currentValue: 1040,
    investedValue: 1000,
    referenceDate: "2026-07-01",
    liquidity: "D1",
    owner: "Ambos",
    status: "Ativo",
    startDate: "2026-01-01",
    maturityDate: "2027-01-01",
    closedDate: null,
    returnRate: 12,
    returnRatePeriod: "Anual",
    returnType: "Prefixada",
    notes: "",
  };

  await request("/api/assets", { method: "POST", body: asset });
  await request("/api/asset-movements", {
    method: "POST",
    body: {
      id: "movement-test",
      assetId: asset.id,
      type: "Aporte",
      amount: 200,
      date: "2026-08-01",
      notes: "Aporte de teste",
    },
  });

  const state = await request("/api/patrimony");
  const saved = state.assets.find((item) => item.id === asset.id);
  assert.equal(saved.returnRate, 12);
  assert.equal(saved.returnRatePeriod, "Anual");
  assert.equal(saved.maturityDate, "2027-01-01");
  assert.equal(saved.movements.length, 1);
  assert.equal(saved.movements[0].amount, 200);
  assert.equal(saved.snapshots.length, 1);
  assert.equal(saved.snapshots[0].balance, 1040);

  await request(`/api/asset-movements/${encodeURIComponent("movement-test")}`, { method: "DELETE" });
  const updated = await request("/api/patrimony");
  assert.equal(updated.assets.find((item) => item.id === asset.id).movements.length, 0);
});

test("cadastra, edita e exclui um gasto mantendo a viagem", async () => {
  const tripPayload = {
    id: "trip-test",
    name: "Viagem teste",
    primaryDestination: "Curitiba",
    otherDestinations: "",
    startDate: "2026-08-10",
    endDate: "2026-08-15",
    status: "Confirmada",
    primaryCurrency: "BRL",
    totalBudget: 3000,
    travelersCount: 2,
    travelers: [
      { id: "traveler-1", name: "Andre", actor: "Andre", active: true },
      { id: "traveler-2", name: "Luciana", actor: "Luciana", active: true },
    ],
    createdBy: "Andre",
    updatedBy: "Andre",
  };
  const created = await request("/api/trips", { method: "POST", body: tripPayload });
  const category = created.trip.categories[0];

  const expense = {
    id: "expense-test",
    tripId: tripPayload.id,
    categoryId: category.id,
    description: "Almoco",
    originalAmount: 120,
    originalCurrency: "BRL",
    exchangeRate: 1,
    convertedAmount: 120,
    expenseDate: "2026-08-11",
    dueDate: "2026-08-11",
    status: "Pago",
    paymentMethod: "PIX",
    paidByTravelerId: "traveler-1",
    installmentCount: 1,
    participants: [{ travelerId: "traveler-1" }, { travelerId: "traveler-2" }],
    syncToPlanner: false,
  };

  await request("/api/trip-expenses", { method: "POST", body: expense });
  let state = await request("/api/trips");
  let savedTrip = state.trips.find((item) => item.id === tripPayload.id);
  assert.equal(savedTrip.expenses.length, 1);
  assert.equal(savedTrip.expenses[0].convertedAmount, 120);

  await request("/api/trip-expenses", {
    method: "POST",
    body: { ...expense, description: "Almoco editado", originalAmount: 150, convertedAmount: 150 },
  });
  state = await request("/api/trips");
  savedTrip = state.trips.find((item) => item.id === tripPayload.id);
  assert.equal(savedTrip.expenses.length, 1);
  assert.equal(savedTrip.expenses[0].description, "Almoco editado");
  assert.equal(savedTrip.expenses[0].convertedAmount, 150);

  await request(`/api/trip-expenses/${encodeURIComponent(expense.id)}`, { method: "DELETE" });
  state = await request("/api/trips");
  savedTrip = state.trips.find((item) => item.id === tripPayload.id);
  assert.equal(savedTrip.expenses.length, 0);
});

test("rejeita gasto com valor igual a zero", async () => {
  const state = await request("/api/trips");
  const savedTrip = state.trips.find((item) => item.id === "trip-test");
  const response = await fetch(`${baseUrl}/api/trip-expenses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "expense-zero",
      tripId: savedTrip.id,
      categoryId: savedTrip.categories[0].id,
      description: "Invalido",
      originalAmount: 0,
      originalCurrency: "BRL",
      exchangeRate: 1,
      convertedAmount: 0,
      expenseDate: "2026-08-11",
      status: "Pago",
      paymentMethod: "PIX",
      participants: savedTrip.travelers.map((traveler) => ({ travelerId: traveler.id })),
    }),
  });
  const payload = await response.json();

  assert.equal(response.ok, false);
  assert.match(payload.details, /maior que zero/);
});

test("salva e edita o vinculo entre compra do cartao e viagem", async () => {
  const statement = {
    id: "card-statement-test",
    label: "Fatura teste",
    cardName: "Cartao teste",
    closingDate: "2026-08-01",
    dueDate: "2026-08-10",
    importedBy: "Andre",
    transactions: [
      {
        id: "card-transaction-test",
        purchaseDate: "2026-07-20",
        description: "Hotel Curitiba",
        category: "Viagem",
        amount: 480,
        owner: "Ambos",
        tripId: "trip-test",
      },
    ],
  };

  await request("/api/card-statements", { method: "POST", body: statement });
  let state = await request("/api/card-statements");
  let transaction = state.statements.find((item) => item.id === statement.id).transactions[0];
  assert.equal(transaction.tripId, "trip-test");

  const updated = await request("/api/card-transactions/card-transaction-test", {
    method: "PATCH",
    body: { category: "Hospedagem", tripId: null },
  });
  assert.equal(updated.transaction.category, "Hospedagem");
  assert.equal(updated.transaction.tripId, null);

  state = await request("/api/card-statements");
  transaction = state.statements.find((item) => item.id === statement.id).transactions[0];
  assert.equal(transaction.category, "Hospedagem");
  assert.equal(transaction.tripId, null);

  await request(`/api/card-statements/${statement.id}`, { method: "DELETE" });
});

test("registra medidas, musculacao e cardio no painel de academia", async () => {
  await request("/api/fitness/measurements", {
    method: "POST",
    body: { measuredOn: "2026-08-03", weight: 82.4, bodyFat: 18.2, notes: "Inicio do ciclo" },
  });
  const workout = await request("/api/fitness/sessions", {
    method: "POST",
    body: {
      id: "workout-test",
      performedOn: "2026-08-03",
      title: "Peito e biceps",
      durationMinutes: 62,
      energyLevel: 4,
      performanceRating: 4,
      notes: "Boa execucao",
      exercises: [
        {
          id: "exercise-bench-test",
          name: "Supino reto",
          muscleGroup: "Peitoral",
          sets: [
            { id: "set-bench-1", weight: 80, reps: 10, rir: 2 },
            { id: "set-bench-2", weight: 80, reps: 8, rir: 1 },
          ],
        },
        {
          id: "exercise-curl-test",
          name: "Rosca direta",
          muscleGroup: "Biceps",
          sets: [
            { id: "set-curl-1", weight: 30, reps: 12, rir: 2 },
            { id: "set-curl-2", weight: 30, reps: 10, rir: 1 },
          ],
        },
      ],
    },
  });
  assert.match(workout.session.coachNote, /4 series/);
  assert.equal(workout.awardXp, 104);

  await request("/api/fitness/cardio", {
    method: "POST",
    body: {
      id: "cardio-test",
      performedOn: "2026-08-04",
      modality: "Esteira",
      durationMinutes: 35,
      distanceKm: 4.2,
      intensity: "Moderado",
      notes: "Ritmo confortavel",
    },
  });
  await request("/api/fitness/templates", {
    method: "POST",
    body: {
      id: "template-test",
      name: "Peito rapido",
      exercises: [{ name: "Supino reto", muscleGroup: "Peitoral", suggestedSets: 3 }],
    },
  });

  const dashboard = await request("/api/fitness/dashboard?date=2026-08-05");
  assert.equal(dashboard.measurements[0].weight, 82.4);
  assert.equal(dashboard.weekly.sessions, 1);
  assert.equal(dashboard.weekly.cardioMinutes, 35);
  assert.equal(dashboard.weekly.volumes.find((item) => item.muscleGroup === "Peitoral").sets, 2);
  assert.equal(dashboard.templates[0].exercises[0].suggestedSets, 3);
  assert.ok(dashboard.gamification.xp > 0);
});

test("serve as telas com os utilitarios compartilhados", async () => {
  const patrimony = await fetch(`${baseUrl}/patrimonio.html`).then((response) => response.text());
  const trips = await fetch(`${baseUrl}/viagens.html`).then((response) => response.text());
  const card = await fetch(`${baseUrl}/cartao.html`).then((response) => response.text());
  const fitness = await fetch(`${baseUrl}/academia.html`).then((response) => response.text());

  assert.match(patrimony, /investmentDetailContent/);
  assert.match(patrimony, /financial-utils\.js/);
  assert.match(trips, /tripSelector/);
  assert.match(trips, /trip-utils\.js/);
  assert.match(card, /invoiceTrendChart/);
  assert.match(card, /card-utils\.js/);
  assert.match(fitness, /weeklyVolumeGrid/);
  assert.match(fitness, /fitness-utils\.js/);
});

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.details || payload.error || `HTTP ${response.status}`);
  return payload;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Servidor de teste nao iniciou. ${stderr}`)), 15000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(`http://127.0.0.1:${match[1]}`);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("exit", (code) => {
      if (!baseUrl) {
        clearTimeout(timer);
        reject(new Error(`Servidor de teste encerrou com codigo ${code}. ${stderr}`));
      }
    });
  });
}

function createLegacyDatabase(filePath) {
  const database = new DatabaseSync(filePath);
  database.exec(`
    create table assets (
      id text primary key,
      workspace_id text not null default 'home',
      name text not null,
      asset_type text not null,
      institution text not null default '',
      current_value_cents integer not null,
      invested_value_cents integer,
      reference_date text not null,
      liquidity text not null,
      owner text not null,
      notes text not null default '',
      created_at text not null default (datetime('now')),
      updated_at text not null default (datetime('now'))
    );
    insert into assets (
      id, workspace_id, name, asset_type, institution, current_value_cents,
      invested_value_cents, reference_date, liquidity, owner, notes
    ) values (
      'legacy-asset', 'home', 'Investimento antigo', 'Investimento', 'Banco',
      110000, 100000, '2026-06-30', 'D1', 'Ambos', ''
    );
  `);
  database.close();
}
