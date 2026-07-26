(function attachPlannerFinance(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlannerFinance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlannerFinance() {
  const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const ACTIVE_INVESTMENT_STATUS = "Ativo";

  function annualEffectiveToMonthly(annualRate) {
    const rate = Number(annualRate);
    if (!Number.isFinite(rate) || rate <= -1) throw new Error("Taxa anual efetiva invalida.");
    return Math.pow(1 + rate, 1 / 12) - 1;
  }

  function buildInvestmentProjection(asset, options = {}) {
    const referenceDate = validDateKey(asset?.referenceDate) ? asset.referenceDate : options.asOfDate;
    const currentBalance = Number(asset?.currentValue);
    const initialInvested = asset?.investedValue === "" || asset?.investedValue == null ? Number.NaN : Number(asset.investedValue);
    const ratePercent = asset?.returnRate === "" || asset?.returnRate == null ? null : Number(asset.returnRate);
    const status = asset?.status || ACTIVE_INVESTMENT_STATUS;
    const movements = normalizeMovements(asset?.movements);

    const base = {
      canProject: false,
      reason: "",
      status,
      referenceDate,
      initialInvested: Number.isFinite(initialInvested) ? initialInvested : 0,
      currentBalance: Number.isFinite(currentBalance) ? currentBalance : 0,
      currentGain: 0,
      currentReturnRate: null,
      monthlyRate: null,
      rows: [],
      actualPoints: buildActualPoints(asset),
      projectedBalance: Number.isFinite(currentBalance) ? currentBalance : 0,
      projectedGain: 0,
      projectedReturnRate: null,
      projectedIncome: 0,
      totalContributed: Number.isFinite(initialInvested) ? initialInvested : 0,
      totalWithdrawn: 0,
      netInvestedAmount: Number.isFinite(initialInvested) ? initialInvested : 0,
      projectionEndDate: null,
    };

    if (!validDateKey(referenceDate)) return { ...base, reason: "Informe uma data de referencia valida." };
    if (!Number.isFinite(currentBalance) || currentBalance < 0) return { ...base, reason: "Informe um saldo atual valido." };
    if (!Number.isFinite(initialInvested) || initialInvested < 0) return { ...base, reason: "Informe o valor inicialmente investido." };

    const realizedMovements = movements.filter((movement) => movement.date <= referenceDate);
    const realizedContributions = sumByType(realizedMovements, "Aporte");
    const realizedWithdrawals = sumByType(realizedMovements, "Resgate");
    const netInvestedAtReference = Math.max(initialInvested + realizedContributions - realizedWithdrawals, 0);
    const currentGain = roundMoney(currentBalance - netInvestedAtReference);
    const currentReturnRate = netInvestedAtReference > 0 ? currentGain / netInvestedAtReference : null;
    const withCurrent = {
      ...base,
      currentGain,
      currentReturnRate,
      totalContributed: roundMoney(initialInvested + realizedContributions),
      totalWithdrawn: roundMoney(realizedWithdrawals),
      netInvestedAmount: roundMoney(netInvestedAtReference),
      projectedGain: currentGain,
      projectedReturnRate: currentReturnRate,
    };

    if (status !== ACTIVE_INVESTMENT_STATUS) {
      return { ...withCurrent, reason: `O investimento esta ${String(status).toLowerCase()} e nao recebe novas projecoes.` };
    }
    if (ratePercent == null) return { ...withCurrent, reason: "Cadastre uma taxa mensal ou anual para calcular a projecao." };
    if (!Number.isFinite(ratePercent)) return { ...withCurrent, reason: "A taxa cadastrada e invalida." };

    const rateDecimal = ratePercent / 100;
    let monthlyRate;
    try {
      monthlyRate = asset.returnRatePeriod === "Mensal" ? rateDecimal : annualEffectiveToMonthly(rateDecimal);
    } catch (error) {
      return { ...withCurrent, reason: error.message };
    }
    if (!Number.isFinite(monthlyRate) || monthlyRate <= -1) {
      return { ...withCurrent, reason: "A taxa mensal equivalente precisa ser maior que -100%." };
    }

    const projectionMonths = resolveProjectionMonths(asset, referenceDate, options.period);
    if (projectionMonths.length === 0) {
      return {
        ...withCurrent,
        monthlyRate,
        reason: asset.maturityDate ? "O vencimento nao permite projetar meses futuros." : "Nao ha periodo futuro para projetar.",
      };
    }

    const futureMovements = movements.filter((movement) => movement.date > referenceDate);
    let openingBalance = currentBalance;
    let netInvestedAmount = netInvestedAtReference;
    let totalContributed = initialInvested + realizedContributions;
    let totalWithdrawn = realizedWithdrawals;
    let projectedIncome = 0;

    const rows = [];
    for (let index = 0; index < projectionMonths.length; index += 1) {
      const month = projectionMonths[index];
      const monthlyMovements = futureMovements.filter((movement) => {
        const movementMonth = movement.date.slice(0, 7);
        return index === 0 ? movementMonth <= month : movementMonth === month;
      });
      const contributions = sumByType(monthlyMovements, "Aporte");
      const withdrawals = sumByType(monthlyMovements, "Resgate");
      const balanceBeforeReturn = Math.max(roundMoney(openingBalance + contributions - withdrawals), 0);
      const projectedReturn = roundMoney(balanceBeforeReturn * monthlyRate);
      const closingBalance = Math.max(roundMoney(balanceBeforeReturn + projectedReturn), 0);

      totalContributed = roundMoney(totalContributed + contributions);
      totalWithdrawn = roundMoney(totalWithdrawn + withdrawals);
      netInvestedAmount = Math.max(roundMoney(netInvestedAmount + contributions - withdrawals), 0);
      projectedIncome = roundMoney(projectedIncome + projectedReturn);

      rows.push({
        month,
        openingBalance: roundMoney(openingBalance),
        contributions: roundMoney(contributions),
        withdrawals: roundMoney(withdrawals),
        projectedReturn,
        monthlyReturnRate: monthlyRate,
        projectedIncomeAccumulated: projectedIncome,
        accumulatedReturn: roundMoney(closingBalance - netInvestedAmount),
        investedAmount: netInvestedAmount,
        contributedAmount: totalContributed,
        closingBalance,
        differenceFromInitial: roundMoney(closingBalance - initialInvested),
        kind: "projected",
      });
      openingBalance = closingBalance;
      if (closingBalance === 0 && withdrawals > 0) break;
    }

    const last = rows.at(-1);
    const projectedGain = roundMoney(last.closingBalance - last.investedAmount);
    return {
      ...withCurrent,
      canProject: true,
      reason: "",
      monthlyRate,
      rows,
      projectedBalance: last.closingBalance,
      projectedGain,
      projectedReturnRate: last.investedAmount > 0 ? projectedGain / last.investedAmount : null,
      projectedIncome,
      totalContributed: last.contributedAmount,
      totalWithdrawn,
      netInvestedAmount: last.investedAmount,
      projectionEndDate: `${last.month}-01`,
    };
  }

  function resolveProjectionMonths(asset, referenceDate, period) {
    const firstMonth = addMonths(referenceDate.slice(0, 7), 1);
    const maturityMonth = validDateKey(asset?.maturityDate) ? asset.maturityDate.slice(0, 7) : null;
    const closedMonth = validDateKey(asset?.closedDate) ? asset.closedDate.slice(0, 7) : null;
    const requested = period === "full" ? (maturityMonth ? monthsBetween(firstMonth, maturityMonth) + 1 : 12) : Number(period || 12);
    const safeRequested = Number.isInteger(requested) && requested > 0 ? requested : 12;
    const months = [];

    for (let index = 0; index < safeRequested; index += 1) {
      const month = addMonths(firstMonth, index);
      if (maturityMonth && month > maturityMonth) break;
      if (closedMonth && month > closedMonth) break;
      months.push(month);
    }
    return months;
  }

  function buildActualPoints(asset) {
    const snapshots = Array.isArray(asset?.snapshots) ? asset.snapshots : [];
    const latestReferenceDate = validDateKey(asset?.referenceDate) ? asset.referenceDate : null;
    const candidates = snapshots
      .filter(
        (snapshot) =>
          validDateKey(snapshot.referenceDate) &&
          (!latestReferenceDate || snapshot.referenceDate <= latestReferenceDate) &&
          Number.isFinite(Number(snapshot.balance)),
      )
      .map((snapshot) => ({
        month: snapshot.referenceDate.slice(0, 7),
        referenceDate: snapshot.referenceDate,
        balance: roundMoney(Number(snapshot.balance)),
        investedAmount: snapshot.investedValue == null ? null : roundMoney(Number(snapshot.investedValue)),
        kind: "realized",
      }));

    if (validDateKey(asset?.referenceDate) && Number.isFinite(Number(asset?.currentValue))) {
      candidates.push({
        month: asset.referenceDate.slice(0, 7),
        referenceDate: asset.referenceDate,
        balance: roundMoney(Number(asset.currentValue)),
        investedAmount: asset.investedValue == null ? null : roundMoney(Number(asset.investedValue)),
        kind: "realized",
      });
    }

    const byMonth = new Map();
    candidates
      .sort((a, b) => a.referenceDate.localeCompare(b.referenceDate))
      .forEach((point) => byMonth.set(point.month, point));
    return [...byMonth.values()];
  }

  function normalizeMovements(movements) {
    return (Array.isArray(movements) ? movements : [])
      .filter(
        (movement) =>
          ["Aporte", "Resgate"].includes(movement?.type) &&
          validDateKey(movement?.date) &&
          Number.isFinite(Number(movement?.amount)) &&
          Number(movement.amount) > 0,
      )
      .map((movement) => ({ ...movement, amount: roundMoney(Number(movement.amount)) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function sumByType(movements, type) {
    return roundMoney(
      movements.filter((movement) => movement.type === type).reduce((total, movement) => total + movement.amount, 0),
    );
  }

  function monthsBetween(startMonth, endMonth) {
    const [startYear, startValue] = startMonth.split("-").map(Number);
    const [endYear, endValue] = endMonth.split("-").map(Number);
    return (endYear - startYear) * 12 + endValue - startValue;
  }

  function addMonths(month, amount) {
    const [year, monthValue] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthValue - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function formatCurrency(value, currency = "BRL") {
    const number = Number(value);
    const safeValue = Number.isFinite(number) ? number : 0;
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(safeValue);
    } catch {
      return `${currency} ${formatNumber(safeValue)}`;
    }
  }

  function formatNumber(value, options = {}) {
    const number = Number(value);
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: options.minimumFractionDigits ?? 2,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
    }).format(Number.isFinite(number) ? number : 0);
  }

  function formatPercent(value, options = {}) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Nao disponivel";
    const formatted = new Intl.NumberFormat("pt-BR", {
      style: "percent",
      minimumFractionDigits: options.minimumFractionDigits ?? 2,
      maximumFractionDigits: options.maximumFractionDigits ?? 2,
      signDisplay: options.signDisplay || "auto",
    }).format(number);
    return formatted.replace("+0,00%", "0,00%");
  }

  function formatDate(value) {
    if (!validDateKey(value)) return "Nao informada";
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(year, month - 1, day),
    );
  }

  function formatMonth(value) {
    const month = String(value || "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) return "";
    const [year, monthValue] = month.split("-").map(Number);
    return `${MONTH_NAMES[monthValue - 1] || ""}/${year}`;
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function validDateKey(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
    const [year, month, day] = String(value).split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  return {
    ACTIVE_INVESTMENT_STATUS,
    annualEffectiveToMonthly,
    buildActualPoints,
    buildInvestmentProjection,
    formatCurrency,
    formatDate,
    formatMonth,
    formatNumber,
    formatPercent,
    roundMoney,
    validDateKey,
  };
});
