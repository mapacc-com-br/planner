const test = require("node:test");
const assert = require("node:assert/strict");
const tripUtils = require("../trip-utils");

function trip(overrides = {}) {
  return {
    id: "trip-1",
    name: "Ferias",
    startDate: "2026-07-20",
    endDate: "2026-07-30",
    status: "Confirmada",
    totalBudget: 5000,
    travelersCount: 2,
    travelers: [{ id: "person-1" }, { id: "person-2" }],
    categories: [
      { id: "food", name: "Alimentacao", color: "#2478c7", plannedAmount: 1500 },
      { id: "hotel", name: "Hospedagem", color: "#2f8b80", plannedAmount: 2500 },
    ],
    expenses: [],
    ...overrides,
  };
}

test("identifica viagens futuras, em andamento e concluidas pelas datas", () => {
  const item = trip();
  assert.equal(tripUtils.temporalStatus(item, "2026-07-10"), "Futura");
  assert.equal(tripUtils.temporalStatus(item, "2026-07-26"), "Em andamento");
  assert.equal(tripUtils.temporalStatus(item, "2026-08-01"), "Concluida");
});

test("mantem a selecao manual persistida quando ela ainda existe", () => {
  const trips = [
    trip({ id: "ongoing" }),
    trip({ id: "manual", startDate: "2026-09-01", endDate: "2026-09-10" }),
  ];
  const storage = { getItem: () => "manual" };

  assert.equal(tripUtils.restoreSelectedTripId(storage, "selected", trips, "2026-07-26"), "manual");
});

test("sugere a viagem em andamento quando nao existe selecao persistida", () => {
  const trips = [
    trip({ id: "future", startDate: "2026-09-01", endDate: "2026-09-10" }),
    trip({ id: "ongoing" }),
  ];

  assert.equal(tripUtils.selectPreferredTripId(trips, "", "2026-07-26"), "ongoing");
});

test("calcula gasto realizado, previsto, saldo e estimativa final", () => {
  const item = trip({
    expenses: [
      { id: "paid", status: "Pago", convertedAmount: 1000, expenseDate: "2026-07-21", categoryId: "hotel" },
      { id: "pending", status: "Pendente", convertedAmount: 500, expenseDate: "2026-07-22", categoryId: "food" },
      { id: "forecast", status: "Previsto", convertedAmount: 300, expenseDate: "2026-07-28", categoryId: "food" },
      { id: "cancelled", status: "Cancelado", convertedAmount: 900, expenseDate: "2026-07-22", categoryId: "food" },
    ],
  });
  const metrics = tripUtils.calculateTripMetrics(item, "2026-07-24");

  assert.equal(metrics.realized, 1500);
  assert.equal(metrics.forecast, 300);
  assert.equal(metrics.available, 3500);
  assert.equal(metrics.elapsedDays, 5);
  assert.equal(metrics.averagePerDay, 300);
  assert.equal(metrics.estimatedFinalSpend, 3300);
});

test("classifica os tres estados do orcamento com limites centralizados", () => {
  assert.equal(tripUtils.budgetState(0.79).key, "within");
  assert.equal(tripUtils.budgetState(tripUtils.BUDGET_THRESHOLDS.nearLimit).key, "near");
  assert.equal(tripUtils.budgetState(1.01).key, "over");
});

test("agrupa gastos por dia e soma o total de cada grupo", () => {
  const groups = tripUtils.groupExpensesByDay([
    { id: "1", expenseDate: "2026-07-22", status: "Pago", convertedAmount: 30 },
    { id: "2", expenseDate: "2026-07-22", status: "Pendente", convertedAmount: 20 },
    { id: "3", expenseDate: "2026-07-23", status: "Pago", convertedAmount: 10 },
  ]);

  assert.equal(groups.length, 2);
  assert.equal(groups[0].date, "2026-07-22");
  assert.equal(groups[0].total, 50);
});

test("resume gastos por categoria com percentual, quantidade e orcamento", () => {
  const summary = tripUtils.summarizeExpensesByCategory(
    trip({
      expenses: [
        { id: "1", categoryId: "food", status: "Pago", convertedAmount: 300 },
        { id: "2", categoryId: "food", status: "Pendente", convertedAmount: 200 },
        { id: "3", categoryId: "hotel", status: "Pago", convertedAmount: 500 },
      ],
    }),
  );
  const food = summary.find((item) => item.id === "food");

  assert.equal(food.total, 500);
  assert.equal(food.count, 2);
  assert.equal(food.percentage, 0.5);
  assert.equal(food.budgetDifference, 1000);
});

test("filtra por busca, categoria, periodo e forma de pagamento", () => {
  const expenses = [
    {
      id: "1",
      description: "Jantar italiano",
      categoryId: "food",
      paymentMethod: "PIX",
      expenseDate: "2026-07-22",
      convertedAmount: 100,
    },
    {
      id: "2",
      description: "Hotel",
      categoryId: "hotel",
      paymentMethod: "Cartao",
      expenseDate: "2026-07-25",
      convertedAmount: 900,
    },
  ];
  const result = tripUtils.filterExpenses(expenses, {
    query: "jantar",
    categoryId: "food",
    paymentMethod: "PIX",
    dateFrom: "2026-07-20",
    dateTo: "2026-07-23",
  });

  assert.deepEqual(result.map((item) => item.id), ["1"]);
});

test("ordena os gastos por data e valor", () => {
  const expenses = [
    { id: "small", description: "A", expenseDate: "2026-07-20", convertedAmount: 10 },
    { id: "large", description: "B", expenseDate: "2026-07-21", convertedAmount: 100 },
  ];

  assert.deepEqual(
    tripUtils.filterExpenses(expenses, { sort: "date-asc" }).map((item) => item.id),
    ["small", "large"],
  );
  assert.deepEqual(
    tripUtils.filterExpenses(expenses, { sort: "amount-desc" }).map((item) => item.id),
    ["large", "small"],
  );
});

test("trata estado sem viagens e sem gastos", () => {
  assert.equal(tripUtils.selectPreferredTripId([], "", "2026-07-26"), "");
  assert.deepEqual(tripUtils.groupExpensesByDay([]), []);
  assert.deepEqual(tripUtils.summarizeExpensesByCategory(trip({ categories: [], expenses: [] })), []);
});

test("avisa quando a data do gasto esta fora do periodo sem bloquear", () => {
  const item = trip();
  assert.equal(tripUtils.isDateOutsideTrip("2026-07-19", item), true);
  assert.equal(tripUtils.isDateOutsideTrip("2026-07-25", item), false);
});
