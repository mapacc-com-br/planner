const test = require("node:test");
const assert = require("node:assert/strict");
const cardUtils = require("../card-utils");

test("resume a fatura e identifica categoria, maior compra e viagem", () => {
  const statement = {
    id: "current",
    transactions: [
      { purchaseDate: "2026-07-01", description: "Mercado A", category: "Mercado", amount: 100 },
      { purchaseDate: "2026-07-02", description: "Mercado B", category: "Mercado", amount: 50 },
      { purchaseDate: "2026-07-03", description: "Hotel", category: "Viagem", amount: 200, tripId: "trip-1" },
    ],
  };

  const summary = cardUtils.summarizeStatement(statement);

  assert.equal(summary.total, 350);
  assert.equal(summary.average, 116.67);
  assert.equal(summary.biggest.description, "Hotel");
  assert.equal(summary.topCategory.name, "Viagem");
  assert.equal(summary.travelTotal, 200);
});

test("compara a fatura selecionada com a anterior pela data", () => {
  const statements = [
    { id: "older", dueDate: "2026-06-10", transactions: [{ amount: 200 }] },
    { id: "current", dueDate: "2026-07-10", transactions: [{ amount: 260 }] },
    { id: "future", dueDate: "2026-08-10", transactions: [{ amount: 300 }] },
  ];

  const comparison = cardUtils.compareWithPrevious(statements, "current");

  assert.equal(comparison.previous.id, "older");
  assert.equal(comparison.difference, 60);
  assert.equal(comparison.percentage, 0.3);
});

test("monta a evolucao acumulada pelo dia do ciclo", () => {
  const current = {
    transactions: [
      { purchaseDate: "2026-07-01", amount: 10 },
      { purchaseDate: "2026-07-03", amount: 20 },
    ],
  };
  const previous = {
    transactions: [
      { purchaseDate: "2026-06-10", amount: 5 },
      { purchaseDate: "2026-06-11", amount: 5 },
    ],
  };

  const series = cardUtils.buildCycleComparison(current, previous);

  assert.deepEqual(series.labels, ["Dia 1", "Dia 2", "Dia 3"]);
  assert.deepEqual(series.current, [10, 10, 30]);
  assert.deepEqual(series.previous, [5, 10, null]);
});

test("filtra apenas compras explicitamente vinculadas a viagem", () => {
  const transactions = [
    { id: "one", tripId: "trip-1", amount: 10 },
    { id: "two", category: "Viagem", amount: 20 },
    { id: "three", tripId: "trip-2", amount: 30 },
  ];

  assert.deepEqual(
    cardUtils.transactionsForTrip(transactions, "trip-1").map((item) => item.id),
    ["one"],
  );
});
