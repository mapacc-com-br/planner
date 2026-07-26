const finance = window.PlannerFinance;
const investmentView = window.InvestmentView;
const charts = window.PlannerCharts;
const currency = { format: (value) => finance.formatCurrency(value) };
const INVESTMENT_STORAGE_KEY = "plannerFinanceiro:selectedInvestment";

const DAY_MS = 24 * 60 * 60 * 1000;

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const goalDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const assetTypes = [
  { name: "Investimento", color: "#2f8b80", icon: "line-chart" },
  { name: "Reserva", color: "#2478c7", icon: "wallet" },
  { name: "Imovel", color: "#6c69b1", icon: "house" },
  { name: "Veiculo", color: "#c38a2e", icon: "car" },
  { name: "Conta", color: "#3f95dc", icon: "landmark" },
  { name: "Outros", color: "#7c8fa3", icon: "archive" },
];

let assets = [];
let financialGoal = null;
let activeInvestmentId = localStorage.getItem(INVESTMENT_STORAGE_KEY) || "";
let projectionPeriod = 12;
let toastTimer = null;
let chartResizeTimer = null;

const elements = {
  summary: document.querySelector("#patrimonySummary"),
  financialGoalPanel: document.querySelector("#financialGoalPanel"),
  assetList: document.querySelector("#assetList"),
  assetTypeMap: document.querySelector("#assetTypeMap"),
  liquidityMap: document.querySelector("#liquidityMap"),
  assetDialog: document.querySelector("#assetDialog"),
  assetForm: document.querySelector("#assetForm"),
  assetDialogTitle: document.querySelector("#assetDialogTitle"),
  financialGoalDialog: document.querySelector("#financialGoalDialog"),
  financialGoalForm: document.querySelector("#financialGoalForm"),
  financialGoalFormPreview: document.querySelector("#financialGoalFormPreview"),
  investmentDetail: document.querySelector("#investmentDetail"),
  investmentDetailKicker: document.querySelector("#investmentDetailKicker"),
  investmentDetailTitle: document.querySelector("#investmentDetailTitle"),
  investmentDetailMeta: document.querySelector("#investmentDetailMeta"),
  investmentDetailContent: document.querySelector("#investmentDetailContent"),
  movementDialog: document.querySelector("#movementDialog"),
  movementForm: document.querySelector("#movementForm"),
  toast: document.querySelector("#toast"),
  logoutButton: document.querySelector("#logoutButton"),
};

initialize();

async function initialize() {
  bindEvents();
  renderLoading();

  try {
    await refreshAssets();
    render();
  } catch (error) {
    renderError(error);
  }
}

function bindEvents() {
  document.querySelectorAll("#openAssetForm, #openAssetFormSecondary, #openAssetFormFloating").forEach((button) => {
    button.addEventListener("click", () => openAssetDialog());
  });

  document.querySelector("#backupDatabase").addEventListener("click", () => backupDatabase());
  elements.logoutButton.addEventListener("click", () => logout());
  document.querySelector("#openMovementForm").addEventListener("click", () => openMovementDialog());
  document.querySelector("#editDetailedInvestment").addEventListener("click", () => openAssetDialog(getActiveInvestment()));
  document.querySelector("#closeInvestmentDetail").addEventListener("click", closeInvestmentDetail);
  document.querySelector("#assetType").addEventListener("change", toggleInvestmentFields);
  document.querySelector("#assetStatus").addEventListener("change", toggleClosedDateField);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.closeDialog}`).close();
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.closest("[data-id]")?.dataset.id;
    try {
      if (button.dataset.action === "edit-financial-goal") openFinancialGoalDialog();
      if (button.dataset.action === "open-investment") openInvestmentDetail(id);
      if (button.dataset.action === "edit-asset") openAssetDialog(findAsset(id));
      if (button.dataset.action === "delete-asset") await deleteAsset(id);
      if (button.dataset.action === "edit-movement") openMovementDialog(findMovement(id));
      if (button.dataset.action === "delete-movement") await deleteMovement(id);
      if (button.dataset.action === "open-movement") openMovementDialog();
      if (button.dataset.action === "edit-investment-from-empty") openAssetDialog(getActiveInvestment());
      if (button.dataset.action === "set-projection-period") {
        projectionPeriod = button.dataset.period === "full" ? "full" : Number(button.dataset.period);
        renderInvestmentDetail();
      }
    } catch (error) {
      showToast(error.message || "Nao foi possivel concluir a acao.");
    }
  });

  elements.assetForm.addEventListener("submit", saveAssetFromForm);
  elements.movementForm.addEventListener("submit", saveMovementFromForm);
  elements.financialGoalForm.addEventListener("submit", saveFinancialGoalFromForm);
  ["financialGoalCurrentAmount", "financialGoalTargetAmount", "financialGoalMonthlyContribution", "financialGoalTargetDate"].forEach((id) => {
      document.querySelector(`#${id}`).addEventListener("input", renderFinancialGoalFormPreview);
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-investment-series]")) renderInvestmentChart();
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = window.setTimeout(renderInvestmentChart, 120);
  });
}

async function refreshAssets() {
  const state = await apiRequest("/api/patrimony");
  assets = Array.isArray(state.assets) ? state.assets : [];
  financialGoal = state.goal || null;
  if (activeInvestmentId && !findAsset(activeInvestmentId)) {
    activeInvestmentId = "";
    localStorage.removeItem(INVESTMENT_STORAGE_KEY);
  }
}

function renderLoading() {
  elements.summary.innerHTML = "";
  elements.financialGoalPanel.innerHTML = "";
  elements.assetList.innerHTML = emptyTemplate("Carregando patrimonio...");
  elements.assetTypeMap.innerHTML = emptyTemplate("Carregando tipos...");
  elements.liquidityMap.innerHTML = emptyTemplate("Carregando liquidez...");
  elements.investmentDetail.hidden = true;
}

function renderError(error) {
  const message = error.message || "Nao foi possivel carregar o patrimonio.";
  elements.financialGoalPanel.innerHTML = emptyTemplate(message);
  elements.assetList.innerHTML = emptyTemplate(message);
  elements.assetTypeMap.innerHTML = emptyTemplate(message);
  elements.liquidityMap.innerHTML = emptyTemplate(message);
  elements.investmentDetail.hidden = true;
  showToast(message);
}

function render() {
  renderFinancialGoal();
  renderSummary();
  renderAssetTypeMap();
  renderLiquidityMap();
  renderAssets();
  renderInvestmentDetail();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderFinancialGoal() {
  if (!financialGoal) {
    elements.financialGoalPanel.innerHTML = emptyTemplate("Nenhuma meta financeira configurada.");
    return;
  }

  const metrics = calculateGoalMetrics(financialGoal);
  const monthlyDifference = Number(financialGoal.monthlyContribution) - metrics.requiredMonthly;
  const onTrack = monthlyDifference >= 0;

  elements.financialGoalPanel.innerHTML = `
    <div class="financial-goal-panel">
      <div class="financial-goal-header">
        <div>
          <div class="goal-status-line">
            <span class="status-pill ${onTrack ? "status-paid" : "status-due-soon"}">${onTrack ? "No ritmo" : "Meta desafio"}</span>
            <span>Ate ${formatGoalDate(financialGoal.targetDate)}</span>
          </div>
          <p class="eyebrow">Objetivo do casal</p>
          <h2>${escapeHtml(financialGoal.name)}</h2>
        </div>
        <button class="icon-button" data-action="edit-financial-goal" title="Editar meta" aria-label="Editar meta">
          <i data-lucide="pencil"></i>
        </button>
      </div>

      <div class="financial-goal-body">
        <div class="financial-goal-progress-area">
          <span class="goal-current-label">Saldo acompanhado</span>
          <div class="goal-amount-line">
            <strong>${currency.format(financialGoal.currentAmount)}</strong>
            <span>de ${currency.format(financialGoal.targetAmount)}</span>
          </div>
          <div class="goal-progress large" role="progressbar" aria-label="Progresso da meta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(metrics.progress)}">
            <span style="--goal-progress: ${metrics.progress}%;"></span>
          </div>
          <div class="goal-progress-labels">
            <span>${metrics.progress.toFixed(1).replace(".", ",")}% concluido</span>
            <span>Faltam ${currency.format(metrics.gap)}</span>
          </div>
        </div>

        <div class="financial-goal-metrics">
          <div class="goal-metric">
            <span>Necessario por mes</span>
            <strong>${currency.format(metrics.requiredMonthly)}</strong>
            <small>sem contar rendimentos</small>
          </div>
          <div class="goal-metric">
            <span>Aporte planejado</span>
            <strong>${currency.format(financialGoal.monthlyContribution)}</strong>
            <small>${onTrack ? "cobre o ritmo" : `faltam ${currency.format(Math.abs(monthlyDifference))} / mes`}</small>
          </div>
          <div class="goal-metric">
            <span>Projecao na data</span>
            <strong>${currency.format(metrics.projectedAmount)}</strong>
            <small>${metrics.daysRemaining} dias restantes</small>
          </div>
        </div>
      </div>

      <div class="goal-guidance ${onTrack ? "is-positive" : "is-attention"}">
        <i data-lucide="${onTrack ? "circle-check" : "gauge"}"></i>
        <span>${
          onTrack
            ? `O plano tem margem mensal de ${currency.format(monthlyDifference)} para a meta.`
            : `R$ 250 mil e uma meta agressiva: o plano precisa ganhar ${currency.format(Math.abs(monthlyDifference))} por mes em economia, renda extra ou aporte extraordinario.`
        }</span>
      </div>
    </div>
  `;
}

function renderSummary() {
  const total = sum(assets, "currentValue");
  const invested = assets.reduce((value, asset) => value + Number(asset.investedValue || 0), 0);
  const gain = invested ? total - invested : 0;
  const liquid = assets
    .filter((asset) => ["D0", "D1"].includes(asset.liquidity))
    .reduce((value, asset) => value + Number(asset.currentValue || 0), 0);

  const items = [
    { label: "Patrimonio total", value: total, icon: "landmark", tone: "income" },
    { label: "Valor investido", value: invested, icon: "wallet-cards", tone: "bills" },
    { label: "Resultado", value: gain, icon: "trending-up", tone: gain >= 0 ? "paid" : "pending" },
    { label: "Liquidez D0/D1", value: liquid, icon: "badge-check", tone: "paid" },
    { label: "Itens salvos", value: assets.length, icon: "archive", tone: "balance", count: true },
  ];

  elements.summary.innerHTML = items
    .map(
      (item) => `
        <article class="summary-card ${item.tone}">
          <div class="summary-icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></div>
          <strong>${item.count ? item.value : currency.format(item.value)}</strong>
          <span>${item.label}</span>
        </article>
      `,
    )
    .join("");
}

function renderAssetTypeMap() {
  const totals = assetTypes
    .map((type) => ({
      ...type,
      total: assets
        .filter((asset) => asset.assetType === type.name)
        .reduce((value, asset) => value + Number(asset.currentValue || 0), 0),
    }))
    .filter((type) => type.total > 0)
    .sort((a, b) => b.total - a.total);

  elements.assetTypeMap.innerHTML = barMapTemplate(totals, "Nenhum item salvo ainda.");
}

function renderLiquidityMap() {
  const liquidityOrder = ["D0", "D1", "Ate 30 dias", "Longo prazo", "Nao liquido"];
  const colors = ["#2f8b80", "#2478c7", "#c38a2e", "#6c69b1", "#7c8fa3"];
  const totals = liquidityOrder
    .map((name, index) => ({
      name,
      color: colors[index],
      total: assets
        .filter((asset) => asset.liquidity === name)
        .reduce((value, asset) => value + Number(asset.currentValue || 0), 0),
    }))
    .filter((item) => item.total > 0);

  elements.liquidityMap.innerHTML = barMapTemplate(totals, "Nenhuma liquidez cadastrada.");
}

function renderAssets() {
  elements.assetList.innerHTML = assets.length
    ? assets.map((asset) => assetTemplate(asset)).join("")
    : emptyTemplate("Nenhum investimento ou bem salvo ainda.");
}

function renderInvestmentDetail() {
  const asset = getActiveInvestment();
  if (!asset || !["Investimento", "Reserva"].includes(asset.assetType)) {
    elements.investmentDetail.hidden = true;
    return;
  }

  const projection = finance.buildInvestmentProjection(asset, { period: projectionPeriod, asOfDate: todayKey() });
  const hasInitialValue = asset.investedValue !== "" && asset.investedValue != null;
  const currentGainTone = projection.currentGain >= 0 ? "positive-text" : "negative-text";
  const projectedGainTone = projection.projectedGain >= 0 ? "positive-text" : "negative-text";
  const projectedIncomeTone = projection.projectedIncome >= 0 ? "positive-text" : "negative-text";
  const configuredRate =
    asset.returnRate == null
      ? "Taxa nao cadastrada"
      : `${finance.formatNumber(asset.returnRate, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}% ${String(
          asset.returnRatePeriod || "Anual",
        ).toLowerCase()}`;

  elements.investmentDetail.hidden = false;
  elements.investmentDetailKicker.textContent = `${asset.assetType} - ${asset.status || "Ativo"}`;
  elements.investmentDetailTitle.textContent = asset.name;
  elements.investmentDetailMeta.textContent = [
    asset.institution,
    asset.startDate ? `Inicio ${finance.formatDate(asset.startDate)}` : "Inicio nao informado",
    asset.maturityDate ? `Vencimento ${finance.formatDate(asset.maturityDate)}` : "Sem vencimento",
    asset.returnType || configuredRate,
  ]
    .filter(Boolean)
    .join(" | ");

  elements.investmentDetailContent.innerHTML = `
    <section class="investment-hero">
      <div class="investment-status-line">
        <span class="status-pill investment-status-${slug(asset.status || "Ativo")}">${escapeHtml(asset.status || "Ativo")}</span>
        <span>Saldo realizado em ${finance.formatDate(asset.referenceDate)}</span>
        <span>${escapeHtml(configuredRate)}</span>
      </div>

      <div class="investment-metric-grid">
        ${investmentMetric("Valor inicialmente investido", asset.investedValue == null ? "Nao informado" : currency.format(asset.investedValue), "wallet-cards")}
        ${investmentMetric("Saldo atual realizado", currency.format(asset.currentValue), "badge-check", "is-realized")}
        ${investmentMetric(
          "Resultado realizado",
          hasInitialValue ? investmentView.signedMoney(projection.currentGain) : "Nao disponivel",
          "trending-up",
          hasInitialValue ? currentGainTone : "",
        )}
        ${investmentMetric(
          "Rentabilidade realizada",
          projection.currentReturnRate == null ? "Nao disponivel" : finance.formatPercent(projection.currentReturnRate, { signDisplay: "exceptZero" }),
          "percent",
          currentGainTone,
        )}
        ${investmentMetric(
          "Saldo projetado",
          projection.canProject ? currency.format(projection.projectedBalance) : "Sem projecao",
          "chart-no-axes-combined",
          "is-projected",
        )}
        ${investmentMetric(
          "Rendimento previsto no periodo",
          projection.canProject ? investmentView.signedMoney(projection.projectedIncome) : "Sem projecao",
          "sparkles",
          projection.canProject ? projectedIncomeTone : "",
        )}
        ${investmentMetric(
          "Rentabilidade acumulada",
          projection.canProject && projection.projectedReturnRate != null
            ? finance.formatPercent(projection.projectedReturnRate, { signDisplay: "exceptZero" })
            : "Nao disponivel",
          "line-chart",
          projection.canProject ? projectedGainTone : "",
        )}
        ${investmentMetric(
          "Capital liquido projetado",
          hasInitialValue ? currency.format(projection.netInvestedAmount) : "Nao disponivel",
          "landmark",
        )}
      </div>

      <div class="projection-disclaimer" role="note">
        <i data-lucide="info"></i>
        <span>Os valores futuros sao estimativas com juros compostos sobre a taxa cadastrada. Movimentos posteriores ao saldo de referencia entram no proximo fechamento mensal. Nao representam ganho garantido.</span>
      </div>
    </section>

    ${
      projection.canProject
        ? investmentProjectionTemplate(asset, projection)
        : `
          <section class="projection-empty-state">
            <div>
              <p class="eyebrow">Projecao indisponivel</p>
              <h3>${escapeHtml(projection.reason)}</h3>
              <p>Os valores realizados continuam visiveis e nenhum rendimento foi criado silenciosamente.</p>
            </div>
            <button class="compact-button" data-action="edit-investment-from-empty">
              <i data-lucide="pencil"></i>
              Editar investimento
            </button>
          </section>
        `
    }

    ${investmentMovementsTemplate(asset)}
  `;

  if (window.lucide) window.lucide.createIcons();
  if (projection.canProject) renderInvestmentChart();
}

function investmentMetric(label, value, icon, tone = "") {
  return `
    <article class="investment-metric ${tone}">
      <div class="summary-icon" aria-hidden="true"><i data-lucide="${icon}"></i></div>
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function investmentProjectionTemplate(asset, projection) {
  const periodOptions = [
    { value: 6, label: "6 meses" },
    { value: 12, label: "12 meses" },
    { value: 24, label: "24 meses" },
    ...(asset.maturityDate ? [{ value: "full", label: "Ate o vencimento" }] : []),
  ];

  return `
    <section class="investment-chart-section">
      <div class="tab-panel-header">
        <div>
          <p class="eyebrow">Evolucao do investimento</p>
          <h3>Realizado e projetado mes a mes</h3>
        </div>
        <div class="projection-periods" aria-label="Periodo da projecao">
          ${periodOptions
            .map(
              (option) => `
                <button
                  class="tab-button ${String(projectionPeriod) === String(option.value) ? "is-active" : ""}"
                  data-action="set-projection-period"
                  data-period="${option.value}"
                  aria-pressed="${String(projectionPeriod) === String(option.value)}"
                >
                  ${option.label}
                </button>
              `,
            )
            .join("")}
        </div>
      </div>

      <div class="chart-controls" aria-label="Series do grafico">
        <label class="choice-pill"><input data-investment-series="balance" type="checkbox" checked /> <span>Saldo</span></label>
        <label class="choice-pill"><input data-investment-series="invested" type="checkbox" checked /> <span>Total aportado</span></label>
        <label class="choice-pill"><input data-investment-series="gain" type="checkbox" checked /> <span>Ganho acumulado</span></label>
      </div>

      <div class="chart-shell">
        <canvas
          id="investmentEvolutionChart"
          role="img"
          aria-label="Grafico com saldo realizado, saldo projetado, capital aportado e ganho acumulado"
        ></canvas>
      </div>
    </section>

    <section class="investment-evolution-section">
      <div class="tab-panel-header">
        <div>
          <p class="eyebrow">Memoria de calculo</p>
          <h3>Evolucao mensal</h3>
        </div>
        <span class="projection-rate-note">Taxa mensal equivalente: ${finance.formatPercent(projection.monthlyRate, {
          signDisplay: "exceptZero",
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        })}</span>
      </div>
      ${investmentView.projectionTableTemplate(projection.rows)}
      ${investmentView.projectionCardsTemplate(projection.rows)}
    </section>
  `;
}

function investmentMovementsTemplate(asset) {
  const movements = [...(asset.movements || [])].sort((a, b) => b.date.localeCompare(a.date));
  return `
    <section class="investment-movements">
      <div class="tab-panel-header">
        <div>
          <p class="eyebrow">Movimentacoes</p>
          <h3>Aportes e resgates</h3>
        </div>
        <button class="compact-button" data-action="open-movement">
          <i data-lucide="plus"></i>
          Movimento
        </button>
      </div>
      ${
        movements.length
          ? `<div class="movement-list">${movements
              .map(
                (movement) => `
                  <article class="movement-row movement-${slug(movement.type)}" data-id="${movement.id}">
                    <div>
                      <strong>${escapeHtml(movement.type)}</strong>
                      <div class="asset-meta">
                        <span>${finance.formatDate(movement.date)}</span>
                        ${movement.notes ? `<span>${escapeHtml(movement.notes)}</span>` : ""}
                      </div>
                    </div>
                    <div class="asset-actions">
                      <strong class="${movement.type === "Aporte" ? "positive-text" : "negative-text"}">
                        ${movement.type === "Aporte" ? "+" : "-"}${currency.format(movement.amount)}
                      </strong>
                      <button class="icon-button" data-action="edit-movement" title="Editar movimento" aria-label="Editar movimento">
                        <i data-lucide="pencil"></i>
                      </button>
                      <button class="icon-button" data-action="delete-movement" title="Excluir movimento" aria-label="Excluir movimento">
                        <i data-lucide="trash-2"></i>
                      </button>
                    </div>
                  </article>
                `,
              )
              .join("")}</div>`
          : emptyTemplate("Nenhum aporte ou resgate adicional registrado.")
      }
    </section>
  `;
}

function renderInvestmentChart() {
  const asset = getActiveInvestment();
  const canvas = document.querySelector("#investmentEvolutionChart");
  if (!asset || !canvas) return;

  const projection = finance.buildInvestmentProjection(asset, { period: projectionPeriod, asOfDate: todayKey() });
  if (!projection.canProject) return;

  const actualPoints = projection.actualPoints;
  const months = [...new Set([...actualPoints.map((point) => point.month), ...projection.rows.map((row) => row.month)])];
  const actualByMonth = new Map(actualPoints.map((point) => [point.month, point]));
  const projectedByMonth = new Map(projection.rows.map((row) => [row.month, row]));
  const lastActual = actualPoints.at(-1);
  const controls = {
    balance: document.querySelector('[data-investment-series="balance"]')?.checked !== false,
    invested: document.querySelector('[data-investment-series="invested"]')?.checked !== false,
    gain: document.querySelector('[data-investment-series="gain"]')?.checked !== false,
  };
  const datasets = [];

  if (controls.balance) {
    datasets.push({
      label: "Saldo realizado",
      color: "#2f8b80",
      values: months.map((month) => actualByMonth.get(month)?.balance ?? null),
    });
    datasets.push({
      label: "Saldo projetado",
      color: "#2478c7",
      dashed: true,
      values: months.map((month) => {
        if (month === lastActual?.month) return lastActual.balance;
        return projectedByMonth.get(month)?.closingBalance ?? null;
      }),
    });
  }

  if (controls.invested) {
    datasets.push({
      label: "Total aportado",
      color: "#c38a2e",
      values: months.map((month) => actualByMonth.get(month)?.investedAmount ?? projectedByMonth.get(month)?.contributedAmount ?? null),
    });
  }

  if (controls.gain) {
    datasets.push({
      label: "Ganho acumulado",
      color: "#6c69b1",
      values: months.map((month) => {
        const actual = actualByMonth.get(month);
        if (actual && actual.investedAmount != null) return actual.balance - actual.investedAmount;
        return projectedByMonth.get(month)?.accumulatedReturn ?? null;
      }),
    });
  }

  charts.renderLineChart(canvas, {
    labels: months.map(finance.formatMonth),
    datasets,
    formatValue: (value) => currency.format(value),
    formatAxisValue: (value) =>
      new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 }).format(value),
    emptyMessage: "Selecione ao menos uma serie.",
  });
}

function openInvestmentDetail(id) {
  const asset = findAsset(id);
  if (!asset || !["Investimento", "Reserva"].includes(asset.assetType)) return;
  activeInvestmentId = id;
  projectionPeriod = asset.maturityDate ? "full" : 12;
  localStorage.setItem(INVESTMENT_STORAGE_KEY, id);
  render();
  elements.investmentDetail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function closeInvestmentDetail() {
  activeInvestmentId = "";
  localStorage.removeItem(INVESTMENT_STORAGE_KEY);
  render();
}

function assetTemplate(asset) {
  const type = assetTypes.find((item) => item.name === asset.assetType) || assetTypes.at(-1);
  const gain = asset.investedValue == null ? null : Number(asset.currentValue) - Number(asset.investedValue);
  const supportsProjection = ["Investimento", "Reserva"].includes(asset.assetType);
  const active = asset.id === activeInvestmentId ? "is-active" : "";

  return `
    <article class="asset-row ${slug(asset.assetType)} ${active}" data-id="${asset.id}">
      <div class="bill-main">
        <div class="asset-title-line">
          <strong>${escapeHtml(asset.name)}</strong>
          <span class="status-pill" style="color: ${type.color}; background: ${softColor(type.color)};">
            ${escapeHtml(asset.assetType)}
          </span>
          <span class="owner-pill">${escapeHtml(asset.owner)}</span>
        </div>
        <div class="asset-meta">
          ${asset.institution ? `<span>${escapeHtml(asset.institution)}</span>` : ""}
          <span>${escapeHtml(asset.liquidity)}</span>
          <span>${formatShortDate(asset.referenceDate)}</span>
          ${supportsProjection ? `<span>${escapeHtml(asset.status || "Ativo")}</span>` : ""}
          ${gain == null ? "" : `<span>Resultado: ${currency.format(gain)}</span>`}
          ${asset.notes ? `<span>${escapeHtml(asset.notes)}</span>` : ""}
        </div>
      </div>
      <div class="asset-actions">
        <span class="asset-value">${currency.format(Number(asset.currentValue || 0))}</span>
        ${
          supportsProjection
            ? `<button class="compact-button" data-action="open-investment" title="Ver evolucao de ${escapeHtml(asset.name)}">
                 <i data-lucide="chart-no-axes-combined"></i>
                 Evolucao
               </button>`
            : ""
        }
        <button class="icon-button" data-action="edit-asset" title="Editar item" aria-label="Editar item">
          <i data-lucide="pencil"></i>
        </button>
        <button class="icon-button" data-action="delete-asset" title="Excluir item" aria-label="Excluir item">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </article>
  `;
}

function barMapTemplate(items, emptyMessage) {
  if (!items.length) return emptyTemplate(emptyMessage);

  const max = items[0]?.total || 0;
  return items
    .map((item) => {
      const fill = max ? Math.max((item.total / max) * 100, 6) : 0;
      return `
        <div class="category-row">
          <div class="category-line">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${currency.format(item.total)}</span>
          </div>
          <div class="category-track" aria-hidden="true">
            <div class="category-fill" style="--fill: ${fill}%; --bar: ${item.color};"></div>
          </div>
        </div>
      `;
    })
    .join("");
}

function openFinancialGoalDialog() {
  if (!financialGoal) return;

  document.querySelector("#financialGoalId").value = financialGoal.id;
  document.querySelector("#financialGoalName").value = financialGoal.name;
  document.querySelector("#financialGoalCurrentAmount").value = financialGoal.currentAmount;
  document.querySelector("#financialGoalTargetAmount").value = financialGoal.targetAmount;
  document.querySelector("#financialGoalMonthlyContribution").value = financialGoal.monthlyContribution;
  document.querySelector("#financialGoalTargetDate").value = financialGoal.targetDate;
  renderFinancialGoalFormPreview();
  elements.financialGoalDialog.showModal();
}

function renderFinancialGoalFormPreview() {
  const draft = financialGoalDraftFromForm();
  if (!draft.targetDate || !Number.isFinite(draft.currentAmount) || !Number.isFinite(draft.targetAmount) || draft.targetAmount <= 0) {
    elements.financialGoalFormPreview.innerHTML = "";
    return;
  }

  const metrics = calculateGoalMetrics(draft);
  const difference = draft.monthlyContribution - metrics.requiredMonthly;
  elements.financialGoalFormPreview.innerHTML = `
    <div>
      <span>Falta acumular</span>
      <strong>${currency.format(metrics.gap)}</strong>
    </div>
    <div>
      <span>Ritmo necessario</span>
      <strong>${currency.format(metrics.requiredMonthly)} / mes</strong>
    </div>
    <div>
      <span>Folga ou falta</span>
      <strong class="${difference >= 0 ? "positive-text" : "negative-text"}">${difference >= 0 ? "+" : "-"}${currency.format(Math.abs(difference))}</strong>
    </div>
  `;
}

function financialGoalDraftFromForm() {
  return {
    id: document.querySelector("#financialGoalId").value || "patrimony-2026",
    name: document.querySelector("#financialGoalName").value.trim(),
    currentAmount: Number(document.querySelector("#financialGoalCurrentAmount").value),
    targetAmount: Number(document.querySelector("#financialGoalTargetAmount").value),
    monthlyContribution: Number(document.querySelector("#financialGoalMonthlyContribution").value),
    targetDate: document.querySelector("#financialGoalTargetDate").value,
  };
}

async function saveFinancialGoalFromForm(event) {
  event.preventDefault();

  try {
    const result = await apiRequest("/api/financial-goal", { method: "POST", body: financialGoalDraftFromForm() });
    financialGoal = result.goal;
    elements.financialGoalDialog.close();
    render();
    showToast("Meta financeira atualizada.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar a meta.");
  }
}

function openAssetDialog(asset = null) {
  elements.assetForm.reset();
  elements.assetDialogTitle.textContent = asset ? "Editar item" : "Novo item";

  document.querySelector("#assetId").value = asset?.id || "";
  document.querySelector("#assetName").value = asset?.name || "";
  document.querySelector("#assetType").value = asset?.assetType || "Investimento";
  document.querySelector("#assetInstitution").value = asset?.institution || "";
  document.querySelector("#assetCurrentValue").value = asset?.currentValue ?? "";
  document.querySelector("#assetInvestedValue").value = asset?.investedValue ?? "";
  document.querySelector("#assetReferenceDate").value = asset?.referenceDate || todayKey();
  document.querySelector("#assetLiquidity").value = asset?.liquidity || "D1";
  document.querySelector("#assetOwner").value = asset?.owner || "Ambos";
  document.querySelector("#assetStatus").value = asset?.status || "Ativo";
  document.querySelector("#assetStartDate").value = asset?.startDate || asset?.referenceDate || todayKey();
  document.querySelector("#assetMaturityDate").value = asset?.maturityDate || "";
  document.querySelector("#assetClosedDate").value = asset?.closedDate || "";
  document.querySelector("#assetReturnRate").value = asset?.returnRate ?? "";
  document.querySelector("#assetReturnRatePeriod").value = asset?.returnRatePeriod || "Anual";
  document.querySelector("#assetReturnType").value = asset?.returnType || "";
  document.querySelector("#assetNotes").value = asset?.notes || "";

  toggleInvestmentFields();
  toggleClosedDateField();
  elements.assetDialog.showModal();
}

async function saveAssetFromForm(event) {
  event.preventDefault();

  try {
    const assetType = document.querySelector("#assetType").value;
    const supportsProjection = ["Investimento", "Reserva"].includes(assetType);
    const payload = {
      id: document.querySelector("#assetId").value || createId(),
      name: document.querySelector("#assetName").value.trim(),
      assetType,
      institution: document.querySelector("#assetInstitution").value.trim(),
      currentValue: Number(document.querySelector("#assetCurrentValue").value),
      investedValue: document.querySelector("#assetInvestedValue").value,
      referenceDate: document.querySelector("#assetReferenceDate").value,
      liquidity: document.querySelector("#assetLiquidity").value,
      owner: document.querySelector("#assetOwner").value,
      status: supportsProjection ? document.querySelector("#assetStatus").value : "Ativo",
      startDate: supportsProjection ? document.querySelector("#assetStartDate").value || null : null,
      maturityDate: supportsProjection ? document.querySelector("#assetMaturityDate").value || null : null,
      closedDate: supportsProjection ? document.querySelector("#assetClosedDate").value || null : null,
      returnRate: supportsProjection ? document.querySelector("#assetReturnRate").value : null,
      returnRatePeriod: supportsProjection ? document.querySelector("#assetReturnRatePeriod").value : null,
      returnType: supportsProjection ? document.querySelector("#assetReturnType").value.trim() : "",
      notes: document.querySelector("#assetNotes").value.trim(),
    };

    await apiRequest("/api/assets", { method: "POST", body: payload });
    if (supportsProjection) {
      activeInvestmentId = payload.id;
      localStorage.setItem(INVESTMENT_STORAGE_KEY, payload.id);
    }
    await refreshAssets();
    elements.assetDialog.close();
    render();
    showToast("Item salvo no patrimonio.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o item.");
  }
}

async function deleteAsset(id) {
  const asset = findAsset(id);
  if (!asset) return;
  if (!confirm(`Excluir "${asset.name}"?`)) return;

  await apiRequest(`/api/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (activeInvestmentId === id) {
    activeInvestmentId = "";
    localStorage.removeItem(INVESTMENT_STORAGE_KEY);
  }
  await refreshAssets();
  render();
  showToast("Item excluido.");
}

function toggleInvestmentFields() {
  const supportsProjection = ["Investimento", "Reserva"].includes(document.querySelector("#assetType").value);
  document.querySelector("#investmentFormFields").hidden = !supportsProjection;
}

function toggleClosedDateField() {
  const status = document.querySelector("#assetStatus").value;
  document.querySelector("#assetClosedDateField").hidden = status === "Ativo";
  if (status === "Ativo") document.querySelector("#assetClosedDate").value = "";
}

function openMovementDialog(movement = null) {
  const asset = movement ? findAsset(movement.assetId) : getActiveInvestment();
  if (!asset) {
    showToast("Selecione um investimento.");
    return;
  }

  elements.movementForm.reset();
  document.querySelector("#movementDialogTitle").textContent = movement ? "Editar movimento" : "Registrar movimento";
  document.querySelector("#movementId").value = movement?.id || "";
  document.querySelector("#movementAssetId").value = asset.id;
  document.querySelector("#movementType").value = movement?.type || "Aporte";
  document.querySelector("#movementAmount").value = movement?.amount ?? "";
  document.querySelector("#movementDate").value = movement?.date || todayKey();
  document.querySelector("#movementNotes").value = movement?.notes || "";
  elements.movementDialog.showModal();
}

async function saveMovementFromForm(event) {
  event.preventDefault();
  const payload = {
    id: document.querySelector("#movementId").value || createId(),
    assetId: document.querySelector("#movementAssetId").value,
    type: document.querySelector("#movementType").value,
    amount: Number(document.querySelector("#movementAmount").value),
    date: document.querySelector("#movementDate").value,
    notes: document.querySelector("#movementNotes").value.trim(),
  };

  try {
    await apiRequest("/api/asset-movements", { method: "POST", body: payload });
    await refreshAssets();
    elements.movementDialog.close();
    render();
    showToast("Movimento salvo.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o movimento.");
  }
}

async function deleteMovement(id) {
  const movement = findMovement(id);
  if (!movement || !confirm(`Excluir este ${movement.type.toLowerCase()}?`)) return;
  await apiRequest(`/api/asset-movements/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshAssets();
  render();
  showToast("Movimento excluido.");
}

async function backupDatabase() {
  try {
    const result = await apiRequest("/api/backup", { method: "POST", body: {} });
    showToast(`Backup criado: ${result.backup}`);
  } catch (error) {
    showToast(error.message || "Nao foi possivel criar o backup.");
  }
}

async function logout() {
  await apiRequest("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    throw new Error(payload.error || "Sessao expirada.");
  }

  if (!response.ok) {
    throw new Error(payload.error || payload.details || "Erro ao acessar o banco de dados.");
  }

  return payload;
}

function findAsset(id) {
  return assets.find((asset) => asset.id === id);
}

function getActiveInvestment() {
  return findAsset(activeInvestmentId);
}

function findMovement(id) {
  return assets.flatMap((asset) => asset.movements || []).find((movement) => movement.id === id);
}

function sum(items, key) {
  return items.reduce((value, item) => value + Number(item[key] || 0), 0);
}

function calculateGoalMetrics(goal) {
  const [year, month, day] = goal.targetDate.split("-").map(Number);
  const target = new Date(year, month - 1, day, 23, 59, 59, 999);
  const daysRemaining = Math.max(Math.ceil((target.getTime() - Date.now()) / DAY_MS), 0);
  const monthsRemaining = Math.max(daysRemaining / 30.4375, 0.01);
  const gap = Math.max(Number(goal.targetAmount) - Number(goal.currentAmount), 0);

  return {
    gap,
    daysRemaining,
    monthsRemaining,
    progress: goal.targetAmount ? Math.min((Number(goal.currentAmount) / Number(goal.targetAmount)) * 100, 100) : 0,
    requiredMonthly: gap / monthsRemaining,
    projectedAmount: Number(goal.currentAmount) + Number(goal.monthlyContribution || 0) * monthsRemaining,
  };
}

function createId() {
  return window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatShortDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return shortDateFormatter.format(new Date(year, month - 1, day));
}

function formatGoalDate(key) {
  const [year, month, day] = key.split("-").map(Number);
  return goalDateFormatter.format(new Date(year, month - 1, day)).replace(".", "");
}

function emptyTemplate(message) {
  return `<div class="empty-state">${message}</div>`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 5200);
}

function slug(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
}

function softColor(hex) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.14)`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
