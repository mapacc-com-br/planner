(function attachTripUtils(root, factory) {
  const finance = typeof module === "object" && module.exports ? require("./financial-utils") : root.PlannerFinance;
  const api = factory(finance);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TripUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createTripUtils(finance) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BUDGET_THRESHOLDS = Object.freeze({
    nearLimit: 0.8,
    overBudget: 1,
  });
  const EXCLUDED_EXPENSE_STATUSES = new Set(["Cancelado", "Reembolsado"]);
  const FORECAST_EXPENSE_STATUSES = new Set(["Previsto"]);

  function temporalStatus(trip, today = todayKey()) {
    if (trip?.status === "Arquivada") return "Arquivada";
    if (!trip?.startDate || !trip?.endDate) return trip?.status || "Futura";
    if (today < trip.startDate) return "Futura";
    if (today <= trip.endDate) return "Em andamento";
    return "Concluida";
  }

  function selectPreferredTripId(trips, persistedId, today = todayKey()) {
    const list = Array.isArray(trips) ? trips : [];
    if (persistedId && list.some((trip) => trip.id === persistedId)) return persistedId;

    const ongoing = list.find((trip) => temporalStatus(trip, today) === "Em andamento");
    if (ongoing) return ongoing.id;

    const future = list
      .filter((trip) => temporalStatus(trip, today) === "Futura")
      .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    if (future) return future.id;

    const completed = list
      .filter((trip) => temporalStatus(trip, today) === "Concluida")
      .sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    return completed?.id || list.find((trip) => trip.status !== "Arquivada")?.id || list[0]?.id || "";
  }

  function restoreSelectedTripId(storage, storageKey, trips, today = todayKey()) {
    let persistedId = "";
    try {
      persistedId = storage?.getItem?.(storageKey) || "";
    } catch {
      persistedId = "";
    }
    return selectPreferredTripId(trips, persistedId, today);
  }

  function calculateTripMetrics(trip, today = todayKey()) {
    const expenses = Array.isArray(trip?.expenses) ? trip.expenses : [];
    const valid = expenses.filter((expense) => !EXCLUDED_EXPENSE_STATUSES.has(expense.status));
    const realizedExpenses = valid.filter((expense) => !FORECAST_EXPENSE_STATUSES.has(expense.status));
    const forecastExpenses = valid.filter((expense) => FORECAST_EXPENSE_STATUSES.has(expense.status));
    const spent = sumExpenses(realizedExpenses);
    const spentToDate = sumExpenses(realizedExpenses.filter((expense) => !expense.expenseDate || expense.expenseDate <= today));
    const forecast = sumExpenses(forecastExpenses);
    const paid = sumExpenses(realizedExpenses.filter((expense) => expense.status === "Pago"));
    const pending = sumExpenses(realizedExpenses.filter((expense) => ["Reservado", "Pendente"].includes(expense.status)));
    const categoryBudget = (trip?.categories || []).reduce((total, category) => total + Number(category.plannedAmount || 0), 0);
    const totalBudget = Number(trip?.totalBudget || 0);
    const available = totalBudget - spent;
    const budgetUsed = totalBudget > 0 ? spent / totalBudget : spent > 0 ? Infinity : 0;
    const totalDays = tripDays(trip);
    const elapsedDays = elapsedTripDays(trip, today);
    const averagePerDay = elapsedDays > 0 ? spentToDate / elapsedDays : 0;
    const status = temporalStatus(trip, today);
    const daysRemaining =
      status === "Futura" ? Math.max(dateDiff(today, trip.startDate), 0) : status === "Em andamento" ? dateDiff(today, trip.endDate) + 1 : 0;
    const estimatedFinalSpend =
      status === "Em andamento" && spentToDate > 0 && elapsedDays > 0 ? averagePerDay * totalDays : status === "Concluida" ? spent : null;

    return {
      spent,
      spentToDate,
      realized: spent,
      forecast,
      committed: spent + forecast,
      paid,
      pending,
      planned: categoryBudget,
      available,
      budgetUsed,
      budgetState: budgetState(budgetUsed),
      totalDays,
      elapsedDays,
      daysRemaining,
      averagePerDay,
      averagePerPerson: spent / Math.max(trip?.travelers?.length || trip?.travelersCount || 1, 1),
      estimatedFinalSpend,
      status,
    };
  }

  function budgetState(ratio) {
    if (ratio > BUDGET_THRESHOLDS.overBudget) return { key: "over", label: "Acima do orcamento" };
    if (ratio >= BUDGET_THRESHOLDS.nearLimit) return { key: "near", label: "Proximo do limite" };
    return { key: "within", label: "Dentro do orcamento" };
  }

  function filterExpenses(expenses, filters = {}) {
    const query = normalizeText(filters.query);
    const list = (Array.isArray(expenses) ? expenses : []).filter((expense) => {
      if (query && !normalizeText(`${expense.description} ${expense.notes || ""} ${expense.destination || ""}`).includes(query)) return false;
      if (filters.categoryId && expense.categoryId !== filters.categoryId) return false;
      if (filters.paymentMethod && expense.paymentMethod !== filters.paymentMethod) return false;
      if (filters.dateFrom && expense.expenseDate < filters.dateFrom) return false;
      if (filters.dateTo && expense.expenseDate > filters.dateTo) return false;
      return true;
    });

    const sort = filters.sort || "date-desc";
    return list.sort((a, b) => {
      if (sort === "date-asc") return a.expenseDate.localeCompare(b.expenseDate) || a.description.localeCompare(b.description);
      if (sort === "amount-desc") return Number(b.convertedAmount || 0) - Number(a.convertedAmount || 0);
      if (sort === "amount-asc") return Number(a.convertedAmount || 0) - Number(b.convertedAmount || 0);
      return b.expenseDate.localeCompare(a.expenseDate) || a.description.localeCompare(b.description);
    });
  }

  function groupExpensesByDay(expenses) {
    const groups = new Map();
    (Array.isArray(expenses) ? expenses : []).forEach((expense) => {
      const key = expense.expenseDate || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(expense);
    });
    return [...groups.entries()].map(([date, items]) => ({
      date,
      items,
      total: sumExpenses(
        items.filter((expense) => !EXCLUDED_EXPENSE_STATUSES.has(expense.status) && !FORECAST_EXPENSE_STATUSES.has(expense.status)),
      ),
    }));
  }

  function summarizeExpensesByCategory(trip) {
    const realized = (trip?.expenses || []).filter(
      (expense) => !EXCLUDED_EXPENSE_STATUSES.has(expense.status) && !FORECAST_EXPENSE_STATUSES.has(expense.status),
    );
    const total = sumExpenses(realized);
    const categories = new Map((trip?.categories || []).map((category) => [category.id, category]));
    const summaries = new Map();

    realized.forEach((expense) => {
      const category = categories.get(expense.categoryId);
      const key = expense.categoryId || "uncategorized";
      if (!summaries.has(key)) {
        summaries.set(key, {
          id: key,
          name: category?.name || "Sem categoria",
          color: category?.color || "#7c8fa3",
          plannedAmount: Number(category?.plannedAmount || 0),
          total: 0,
          count: 0,
        });
      }
      const item = summaries.get(key);
      item.total += Number(expense.convertedAmount || 0);
      item.count += 1;
    });

    (trip?.categories || []).forEach((category) => {
      if (!summaries.has(category.id) && Number(category.plannedAmount || 0) > 0) {
        summaries.set(category.id, {
          id: category.id,
          name: category.name,
          color: category.color,
          plannedAmount: Number(category.plannedAmount || 0),
          total: 0,
          count: 0,
        });
      }
    });

    return [...summaries.values()]
      .map((item) => ({
        ...item,
        total: finance.roundMoney(item.total),
        percentage: total > 0 ? item.total / total : 0,
        budgetDifference: finance.roundMoney(item.plannedAmount - item.total),
        budgetUsed: item.plannedAmount > 0 ? item.total / item.plannedAmount : item.total > 0 ? Infinity : 0,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  function buildDailyExpenseSeries(trip) {
    const realized = (trip?.expenses || []).filter(
      (expense) => !EXCLUDED_EXPENSE_STATUSES.has(expense.status) && !FORECAST_EXPENSE_STATUSES.has(expense.status),
    );
    const totals = new Map();
    realized.forEach((expense) => {
      totals.set(expense.expenseDate, (totals.get(expense.expenseDate) || 0) + Number(expense.convertedAmount || 0));
    });
    let cumulative = 0;
    return [...totals.entries()]
      .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
      .map(([date, total]) => {
        const roundedTotal = finance.roundMoney(total);
        cumulative = finance.roundMoney(cumulative + roundedTotal);
        return { date, total: roundedTotal, cumulative };
      });
  }

  function isDateOutsideTrip(date, trip) {
    return Boolean(date && trip?.startDate && trip?.endDate && (date < trip.startDate || date > trip.endDate));
  }

  function tripDays(trip) {
    if (!trip?.startDate || !trip?.endDate) return 1;
    return Math.max(dateDiff(trip.startDate, trip.endDate) + 1, 1);
  }

  function elapsedTripDays(trip, today = todayKey()) {
    if (!trip?.startDate || today < trip.startDate) return 0;
    const effectiveEnd = today > trip.endDate ? trip.endDate : today;
    return Math.max(dateDiff(trip.startDate, effectiveEnd) + 1, 0);
  }

  function dateDiff(start, end) {
    return Math.round((dateFromKey(end) - dateFromKey(start)) / DAY_MS);
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function todayKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function sumExpenses(expenses) {
    return finance.roundMoney((expenses || []).reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0));
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  return {
    BUDGET_THRESHOLDS,
    buildDailyExpenseSeries,
    budgetState,
    calculateTripMetrics,
    elapsedTripDays,
    filterExpenses,
    groupExpensesByDay,
    isDateOutsideTrip,
    restoreSelectedTripId,
    selectPreferredTripId,
    summarizeExpensesByCategory,
    temporalStatus,
    todayKey,
    tripDays,
  };
});
