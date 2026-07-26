(function attachInvestmentView(root, factory) {
  const finance = typeof module === "object" && module.exports ? require("./financial-utils") : root.PlannerFinance;
  const api = factory(finance);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createInvestmentView(finance) {
  function projectionTableTemplate(rows) {
    if (!rows.length) return emptyProjectionTemplate();
    return `
      <div class="investment-table-wrap">
        <table class="investment-table">
          <thead>
            <tr>
              <th scope="col">Mes</th>
              <th scope="col">Saldo inicial</th>
              <th scope="col">Aportes</th>
              <th scope="col">Resgates</th>
              <th scope="col">Rendimento previsto</th>
              <th scope="col">Taxa do mes</th>
              <th scope="col">Rendimento acumulado</th>
              <th scope="col">Saldo projetado</th>
              <th scope="col">Diferenca do inicial</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(projectionTableRowTemplate).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function projectionCardsTemplate(rows) {
    if (!rows.length) return emptyProjectionTemplate();
    return `
      <div class="investment-month-cards">
        ${rows
          .map(
            (row) => `
              <details class="investment-month-card">
                <summary>
                  <span>
                    <strong>${finance.formatMonth(row.month)}</strong>
                    <small>Rendimento ${finance.formatCurrency(row.projectedReturn)}</small>
                  </span>
                  <strong>${finance.formatCurrency(row.closingBalance)}</strong>
                </summary>
                <dl>
                  ${definition("Saldo inicial", finance.formatCurrency(row.openingBalance))}
                  ${definition("Aportes", finance.formatCurrency(row.contributions))}
                  ${definition("Resgates", finance.formatCurrency(row.withdrawals))}
                  ${definition("Rentabilidade do mes", finance.formatPercent(row.monthlyReturnRate, { signDisplay: "exceptZero" }))}
                  ${definition("Rendimento acumulado", finance.formatCurrency(row.accumulatedReturn))}
                  ${definition("Diferenca do valor inicial", signedMoney(row.differenceFromInitial))}
                </dl>
              </details>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function projectionTableRowTemplate(row) {
    return `
      <tr>
        <th scope="row">${finance.formatMonth(row.month)}</th>
        <td>${finance.formatCurrency(row.openingBalance)}</td>
        <td>${finance.formatCurrency(row.contributions)}</td>
        <td>${finance.formatCurrency(row.withdrawals)}</td>
        <td>${signedMoney(row.projectedReturn)}</td>
        <td>${finance.formatPercent(row.monthlyReturnRate, { signDisplay: "exceptZero" })}</td>
        <td>${signedMoney(row.accumulatedReturn)}</td>
        <td><strong>${finance.formatCurrency(row.closingBalance)}</strong></td>
        <td>${signedMoney(row.differenceFromInitial)}</td>
      </tr>
    `;
  }

  function definition(label, value) {
    return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  }

  function signedMoney(value) {
    const number = Number(value || 0);
    const sign = number > 0 ? "+" : number < 0 ? "-" : "";
    return `${sign}${finance.formatCurrency(Math.abs(number))}`;
  }

  function emptyProjectionTemplate() {
    return `<div class="empty-state">Nao ha meses futuros para exibir.</div>`;
  }

  return {
    projectionCardsTemplate,
    projectionTableRowTemplate,
    projectionTableTemplate,
    signedMoney,
  };
});
