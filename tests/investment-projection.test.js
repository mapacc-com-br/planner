const test = require("node:test");
const assert = require("node:assert/strict");
const finance = require("../financial-utils");
const investmentView = require("../investment-view");

function investment(overrides = {}) {
  return {
    id: "investment-1",
    assetType: "Investimento",
    status: "Ativo",
    currentValue: 10000,
    investedValue: 10000,
    referenceDate: "2026-01-15",
    startDate: "2026-01-01",
    maturityDate: null,
    closedDate: null,
    returnRate: 1,
    returnRatePeriod: "Mensal",
    movements: [],
    snapshots: [],
    ...overrides,
  };
}

test("converte taxa anual efetiva para a taxa mensal equivalente", () => {
  const annualRate = 0.12;
  const expected = Math.pow(1 + annualRate, 1 / 12) - 1;
  const monthly = finance.annualEffectiveToMonthly(annualRate);

  assert.ok(Math.abs(monthly - expected) < 1e-12);
  assert.notEqual(monthly, annualRate / 12);
});

test("aplica juros compostos mes a mes", () => {
  const projection = finance.buildInvestmentProjection(investment(), { period: 2 });

  assert.equal(projection.canProject, true);
  assert.equal(projection.rows[0].closingBalance, 10100);
  assert.equal(projection.rows[1].openingBalance, 10100);
  assert.equal(projection.rows[1].closingBalance, 10201);
  assert.equal(projection.projectedIncome, 201);
});

test("considera aportes antes do rendimento do mes", () => {
  const projection = finance.buildInvestmentProjection(
    investment({
      movements: [{ id: "contribution", type: "Aporte", amount: 500, date: "2026-02-05" }],
    }),
    { period: 1 },
  );

  assert.equal(projection.rows[0].contributions, 500);
  assert.equal(projection.rows[0].projectedReturn, 105);
  assert.equal(projection.rows[0].closingBalance, 10605);
  assert.equal(projection.rows[0].contributedAmount, 10500);
});

test("considera resgates antes do rendimento do mes", () => {
  const projection = finance.buildInvestmentProjection(
    investment({
      movements: [{ id: "withdrawal", type: "Resgate", amount: 1000, date: "2026-02-05" }],
    }),
    { period: 1 },
  );

  assert.equal(projection.rows[0].withdrawals, 1000);
  assert.equal(projection.rows[0].projectedReturn, 90);
  assert.equal(projection.rows[0].closingBalance, 9090);
  assert.equal(projection.rows[0].investedAmount, 9000);
});

test("interrompe os meses futuros depois de um resgate total", () => {
  const projection = finance.buildInvestmentProjection(
    investment({
      movements: [{ id: "total-withdrawal", type: "Resgate", amount: 10000, date: "2026-02-05" }],
    }),
    { period: 12 },
  );

  assert.equal(projection.rows.length, 1);
  assert.equal(projection.rows[0].closingBalance, 0);
  assert.equal(projection.rows[0].projectedReturn, 0);
});

test("encerra a projecao no mes do vencimento", () => {
  const projection = finance.buildInvestmentProjection(investment({ maturityDate: "2026-03-20" }), { period: "full" });

  assert.deepEqual(
    projection.rows.map((row) => row.month),
    ["2026-02", "2026-03"],
  );
});

test("usa doze meses por padrao quando nao ha vencimento", () => {
  const projection = finance.buildInvestmentProjection(investment(), {});
  assert.equal(projection.rows.length, 12);
});

test("nao inventa taxa quando o investimento nao possui rentabilidade cadastrada", () => {
  const projection = finance.buildInvestmentProjection(investment({ returnRate: null }), { period: 12 });

  assert.equal(projection.canProject, false);
  assert.match(projection.reason, /Cadastre uma taxa/);
  assert.equal(projection.rows.length, 0);
});

test("explica quando falta o valor inicialmente investido", () => {
  const projection = finance.buildInvestmentProjection(investment({ investedValue: null }), { period: 12 });

  assert.equal(projection.canProject, false);
  assert.match(projection.reason, /inicialmente investido/);
});

test("mantem snapshots realizados separados dos meses projetados", () => {
  const projection = finance.buildInvestmentProjection(
    investment({
      referenceDate: "2026-02-28",
      currentValue: 10150,
      snapshots: [
        { referenceDate: "2026-01-31", balance: 10080, investedValue: 10000 },
        { referenceDate: "2026-02-28", balance: 10150, investedValue: 10000 },
      ],
    }),
    { period: 1 },
  );

  assert.deepEqual(
    projection.actualPoints.map((point) => point.month),
    ["2026-01", "2026-02"],
  );
  assert.ok(projection.actualPoints.every((point) => point.kind === "realized"));
  assert.equal(projection.rows[0].month, "2026-03");
  assert.equal(projection.rows[0].kind, "projected");
});

test("nao projeta depois que o investimento foi encerrado", () => {
  const projection = finance.buildInvestmentProjection(investment({ status: "Encerrado", closedDate: "2026-01-15" }), { period: 12 });

  assert.equal(projection.canProject, false);
  assert.equal(projection.rows.length, 0);
  assert.match(projection.reason, /encerrado/);
});

test("separa capital investido, rendimento e saldo", () => {
  const projection = finance.buildInvestmentProjection(investment({ currentValue: 10800 }), { period: 1 });
  const row = projection.rows[0];

  assert.equal(projection.currentGain, 800);
  assert.equal(row.investedAmount, 10000);
  assert.equal(row.accumulatedReturn, row.closingBalance - row.investedAmount);
  assert.equal(row.differenceFromInitial, row.closingBalance - 10000);
});

test("aceita taxa zero sem gerar rendimento ficticio", () => {
  const projection = finance.buildInvestmentProjection(investment({ returnRate: 0 }), { period: 2 });

  assert.equal(projection.canProject, true);
  assert.deepEqual(
    projection.rows.map((row) => row.projectedReturn),
    [0, 0],
  );
});

test("aceita taxa negativa valida quando cadastrada", () => {
  const projection = finance.buildInvestmentProjection(investment({ returnRate: -1 }), { period: 1 });

  assert.equal(projection.canProject, true);
  assert.equal(projection.rows[0].projectedReturn, -100);
  assert.equal(projection.rows[0].closingBalance, 9900);
});

test("formata moeda, data e percentual em pt-BR", () => {
  assert.match(finance.formatCurrency(10842.31), /10\.842,31/);
  assert.equal(finance.formatDate("2026-07-26"), "26/07/2026");
  assert.equal(finance.formatPercent(0.0842, { signDisplay: "exceptZero" }), "+8,42%");
});

test("renderiza tabela desktop e cards mobile da evolucao mensal", () => {
  const projection = finance.buildInvestmentProjection(investment(), { period: 1 });
  const table = investmentView.projectionTableTemplate(projection.rows);
  const cards = investmentView.projectionCardsTemplate(projection.rows);

  assert.match(table, /Saldo inicial/);
  assert.match(table, /Rendimento previsto/);
  assert.match(table, /Fev\/2026/);
  assert.match(cards, /investment-month-card/);
  assert.match(cards, /Saldo inicial/);
});
