(function attachCardUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CardUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCardUtils() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  function summarizeStatement(statement) {
    const transactions = Array.isArray(statement?.transactions) ? statement.transactions : [];
    const total = sumTransactions(transactions);
    const categories = summarizeBy(transactions, (item) => item.category || "Outros");
    const merchants = summarizeBy(transactions, (item) => normalizeMerchant(item.description));
    const biggest = transactions.reduce(
      (current, item) => (Number(item.amount || 0) > Number(current?.amount || 0) ? item : current),
      null,
    );

    return {
      total,
      count: transactions.length,
      average: transactions.length ? roundMoney(total / transactions.length) : 0,
      biggest,
      categories,
      merchants,
      topCategory: categories[0] || null,
      travelTotal: roundMoney(
        transactions
          .filter((item) => item.tripId || normalizeText(item.category) === "viagem")
          .reduce((totalAmount, item) => totalAmount + Number(item.amount || 0), 0),
      ),
    };
  }

  function compareWithPrevious(statements, selectedStatementId) {
    const ordered = (Array.isArray(statements) ? statements : [])
      .filter(Boolean)
      .slice()
      .sort((a, b) => statementDate(b).localeCompare(statementDate(a)));
    const currentIndex = ordered.findIndex((statement) => statement.id === selectedStatementId);
    const current = currentIndex >= 0 ? ordered[currentIndex] : null;
    const previous = currentIndex >= 0 ? ordered[currentIndex + 1] || null : null;
    const currentTotal = summarizeStatement(current).total;
    const previousTotal = summarizeStatement(previous).total;
    const difference = roundMoney(currentTotal - previousTotal);

    return {
      current,
      previous,
      currentTotal,
      previousTotal,
      difference,
      percentage: previousTotal ? difference / Math.abs(previousTotal) : null,
    };
  }

  function buildCycleComparison(currentStatement, previousStatement) {
    const current = buildCycleSeries(currentStatement?.transactions);
    const previous = buildCycleSeries(previousStatement?.transactions);
    const length = Math.max(current.length, previous.length);

    return {
      labels: Array.from({ length }, (_, index) => `Dia ${index + 1}`),
      current: Array.from({ length }, (_, index) => current[index]?.cumulative ?? null),
      previous: Array.from({ length }, (_, index) => previous[index]?.cumulative ?? null),
    };
  }

  function buildCycleSeries(transactions) {
    const valid = (Array.isArray(transactions) ? transactions : [])
      .filter((item) => isDateKey(item.purchaseDate))
      .slice()
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
    if (!valid.length) return [];

    const start = dateFromKey(valid[0].purchaseDate);
    const dailyTotals = new Map();
    valid.forEach((item) => {
      const offset = Math.max(Math.round((dateFromKey(item.purchaseDate) - start) / DAY_MS), 0);
      dailyTotals.set(offset, (dailyTotals.get(offset) || 0) + Number(item.amount || 0));
    });

    const lastOffset = Math.max(...dailyTotals.keys());
    let cumulative = 0;
    return Array.from({ length: lastOffset + 1 }, (_, index) => {
      const total = roundMoney(dailyTotals.get(index) || 0);
      cumulative = roundMoney(cumulative + total);
      return { day: index + 1, total, cumulative };
    });
  }

  function transactionsForTrip(transactions, tripId) {
    if (!tripId) return [];
    return (Array.isArray(transactions) ? transactions : []).filter((item) => item.tripId === tripId);
  }

  function summarizeBy(items, keyFn) {
    const grouped = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const name = String(keyFn(item) || "Outros").trim() || "Outros";
      if (!grouped.has(name)) grouped.set(name, { name, total: 0, count: 0 });
      const current = grouped.get(name);
      current.total += Number(item.amount || 0);
      current.count += 1;
    });

    return [...grouped.values()]
      .map((item) => ({ ...item, total: roundMoney(item.total) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  function sumTransactions(transactions) {
    return roundMoney((Array.isArray(transactions) ? transactions : []).reduce((total, item) => total + Number(item.amount || 0), 0));
  }

  function statementDate(statement) {
    return String(statement?.dueDate || statement?.closingDate || statement?.createdAt || "").slice(0, 10);
  }

  function normalizeMerchant(value) {
    return (
      String(value || "")
        .replace(/\d+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 34) || "Outros"
    );
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function isDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key).split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  }

  return {
    buildCycleComparison,
    buildCycleSeries,
    compareWithPrevious,
    normalizeMerchant,
    statementDate,
    summarizeBy,
    summarizeStatement,
    sumTransactions,
    transactionsForTrip,
  };
});
