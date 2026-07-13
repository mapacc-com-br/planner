const STORAGE_KEYS = {
  selectedTrip: "plannerFinanceiro:selectedTrip",
  tripTab: "plannerFinanceiro:tripTab",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

let trips = [];
let activeTripId = localStorage.getItem(STORAGE_KEYS.selectedTrip) || "";
let activeTab = localStorage.getItem(STORAGE_KEYS.tripTab) || "overview";
let currentActor = "Andre";
let toastTimer = null;

const elements = {
  tripSummary: document.querySelector("#tripSummary"),
  tripList: document.querySelector("#tripList"),
  tripCount: document.querySelector("#tripCount"),
  tripSearch: document.querySelector("#tripSearch"),
  tripStatusFilter: document.querySelector("#tripStatusFilter"),
  tripDetail: document.querySelector("#tripDetail"),
  tripDetailKicker: document.querySelector("#tripDetailKicker"),
  tripDetailTitle: document.querySelector("#tripDetailTitle"),
  tripDetailMeta: document.querySelector("#tripDetailMeta"),
  tripTabContent: document.querySelector("#tripTabContent"),
  tripDialog: document.querySelector("#tripDialog"),
  tripForm: document.querySelector("#tripForm"),
  categoryDialog: document.querySelector("#categoryDialog"),
  categoryForm: document.querySelector("#categoryForm"),
  expenseDialog: document.querySelector("#expenseDialog"),
  expenseForm: document.querySelector("#expenseForm"),
  reservationDialog: document.querySelector("#reservationDialog"),
  reservationForm: document.querySelector("#reservationForm"),
  itineraryDialog: document.querySelector("#itineraryDialog"),
  itineraryForm: document.querySelector("#itineraryForm"),
  checklistDialog: document.querySelector("#checklistDialog"),
  checklistForm: document.querySelector("#checklistForm"),
  documentDialog: document.querySelector("#documentDialog"),
  documentForm: document.querySelector("#documentForm"),
  toast: document.querySelector("#toast"),
};

initializeTrips();

async function initializeTrips() {
  bindEvents();
  renderLoading();

  try {
    await syncSessionActor();
    await refreshTrips();
    render();
  } catch (error) {
    renderFatalError(error);
  }
}

function bindEvents() {
  document.querySelector("#openTripForm").addEventListener("click", () => openTripDialog());
  document.querySelector("#openExpenseForm").addEventListener("click", () => openExpenseDialog());
  document.querySelector("#openExpenseFormFloating").addEventListener("click", () => openExpenseDialog());
  document.querySelector("#editActiveTrip").addEventListener("click", () => openTripDialog(getActiveTrip()));
  document.querySelector("#backupDatabase").addEventListener("click", backupDatabase);
  document.querySelector("#logoutButton").addEventListener("click", logout);
  elements.tripSearch.addEventListener("input", render);
  elements.tripStatusFilter.addEventListener("change", render);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`#${button.dataset.closeDialog}`)?.close();
    });
  });

  document.querySelectorAll("[data-trip-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeTab = button.dataset.tripTab;
      localStorage.setItem(STORAGE_KEYS.tripTab, activeTab);
      renderActiveTrip();
    });
  });

  document.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const id = actionButton.dataset.id || actionButton.closest("[data-id]")?.dataset.id;

    try {
      await handleAction(action, id);
    } catch (error) {
      showToast(error.message || "Nao foi possivel concluir a acao.");
    }
  });

  elements.tripForm.addEventListener("submit", saveTripFromForm);
  elements.categoryForm.addEventListener("submit", saveCategoryFromForm);
  elements.expenseForm.addEventListener("submit", saveExpenseFromForm);
  elements.reservationForm.addEventListener("submit", saveReservationFromForm);
  elements.itineraryForm.addEventListener("submit", saveItineraryFromForm);
  elements.checklistForm.addEventListener("submit", saveChecklistFromForm);
  elements.documentForm.addEventListener("submit", saveDocumentFromForm);

  ["expenseOriginalAmount", "expenseExchangeRate"].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener("input", updateConvertedAmountPreview);
  });
}

async function handleAction(action, id) {
  if (action === "open-trip") {
    activeTripId = id;
    localStorage.setItem(STORAGE_KEYS.selectedTrip, activeTripId);
    render();
    return;
  }

  if (action === "edit-trip") openTripDialog(findTrip(id));
  if (action === "duplicate-trip") await duplicateTrip(id);
  if (action === "archive-trip") await archiveTrip(id);
  if (action === "delete-trip") await deleteTrip(id);

  if (action === "open-category") openCategoryDialog();
  if (action === "edit-category") openCategoryDialog(findCategory(id));
  if (action === "delete-category") await deleteEntity(`/api/trip-categories/${encodeURIComponent(id)}`, "Categoria excluida.");

  if (action === "open-expense") openExpenseDialog();
  if (action === "edit-expense") openExpenseDialog(findExpense(id));
  if (action === "delete-expense") await deleteEntity(`/api/trip-expenses/${encodeURIComponent(id)}`, "Despesa excluida.");

  if (action === "open-reservation") openReservationDialog();
  if (action === "edit-reservation") openReservationDialog(findReservation(id));
  if (action === "delete-reservation") await deleteEntity(`/api/trip-reservations/${encodeURIComponent(id)}`, "Reserva excluida.");

  if (action === "open-itinerary") openItineraryDialog();
  if (action === "edit-itinerary") openItineraryDialog(findItineraryItem(id));
  if (action === "delete-itinerary") await deleteEntity(`/api/trip-itinerary-items/${encodeURIComponent(id)}`, "Atividade excluida.");

  if (action === "open-checklist") openChecklistDialog();
  if (action === "edit-checklist") openChecklistDialog(findChecklistItem(id));
  if (action === "toggle-checklist") await toggleChecklist(id);
  if (action === "delete-checklist") await deleteEntity(`/api/trip-checklist-items/${encodeURIComponent(id)}`, "Item excluido.");

  if (action === "open-document") openDocumentDialog();
  if (action === "edit-document") openDocumentDialog(findDocument(id));
  if (action === "delete-document") await deleteEntity(`/api/trip-documents/${encodeURIComponent(id)}`, "Documento excluido.");
}

async function syncSessionActor() {
  const session = await apiRequest("/api/session");
  if (session.user?.actor) currentActor = session.user.actor;
}

async function refreshTrips() {
  const state = await apiRequest("/api/trips");
  trips = Array.isArray(state.trips) ? state.trips : [];
  if (!activeTripId || !findTrip(activeTripId)) {
    activeTripId = trips.find((trip) => trip.status !== "Arquivada")?.id || trips[0]?.id || "";
    if (activeTripId) localStorage.setItem(STORAGE_KEYS.selectedTrip, activeTripId);
  }
}

function renderLoading() {
  elements.tripSummary.innerHTML = "";
  elements.tripList.innerHTML = emptyTemplate("Carregando viagens...");
  elements.tripTabContent.innerHTML = emptyTemplate("Carregando painel da viagem...");
}

function renderFatalError(error) {
  const message = error.message || "Nao foi possivel carregar viagens.";
  elements.tripSummary.innerHTML = "";
  elements.tripList.innerHTML = emptyTemplate(message);
  elements.tripDetail.hidden = true;
  showToast(message);
}

function render() {
  renderTripSummary();
  renderTripCards();
  renderActiveTrip();
  if (window.lucide) window.lucide.createIcons();
}

function renderTripSummary() {
  const visibleTrips = getFilteredTrips();
  const openTrips = trips.filter((trip) => !["Concluida", "Arquivada"].includes(trip.status)).length;
  const totalBudget = visibleTrips.reduce((total, trip) => total + Number(trip.totalBudget || 0), 0);
  const totalSpent = visibleTrips.reduce((total, trip) => total + tripStats(trip).realized, 0);
  const nextTrip = trips
    .filter((trip) => trip.status !== "Arquivada" && trip.endDate >= todayKey())
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  const items = [
    { label: "Viagens ativas", value: openTrips, icon: "plane-takeoff", tone: "income", text: true },
    { label: "Orcamento filtrado", value: totalBudget, icon: "wallet-cards", tone: "bills" },
    { label: "Gasto registrado", value: totalSpent, icon: "receipt-text", tone: "paid" },
    { label: "Proxima viagem", value: nextTrip ? daysUntil(nextTrip.startDate) : 0, suffix: " dias", icon: "calendar-days", tone: "pending", text: true },
    { label: "Saldo filtrado", value: totalBudget - totalSpent, icon: "landmark", tone: "balance" },
  ];

  elements.tripSummary.innerHTML = items
    .map(
      (item) => `
        <article class="summary-card ${item.tone}">
          <div class="summary-icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></div>
          <strong>${item.text ? `${item.value}${item.suffix || ""}` : formatMoney(item.value, "BRL")}</strong>
          <span>${item.label}</span>
        </article>
      `,
    )
    .join("");
}

function renderTripCards() {
  const visibleTrips = getFilteredTrips();
  elements.tripCount.textContent = visibleTrips.length;
  elements.tripList.innerHTML = visibleTrips.length
    ? visibleTrips.map((trip) => tripCardTemplate(trip)).join("")
    : emptyTemplate("Nenhuma viagem encontrada.");
}

function tripCardTemplate(trip) {
  const stats = tripStats(trip);
  const progress = trip.totalBudget ? Math.min((stats.realized / trip.totalBudget) * 100, 100) : 0;
  const active = trip.id === activeTripId ? "is-active" : "";
  const daysLabel = tripDays(trip);
  const proximity = proximityLabel(trip);

  return `
    <article class="trip-card ${active}" data-id="${trip.id}">
      ${trip.coverImage ? `<div class="trip-cover" style="background-image: url('${escapeAttribute(trip.coverImage)}')"></div>` : `<div class="trip-cover trip-cover-empty"><i data-lucide="map"></i></div>`}
      <div class="trip-card-body">
        <div class="trip-card-title">
          <strong>${escapeHtml(trip.name)}</strong>
          <span class="status-pill status-${statusClass(trip.status)}">${escapeHtml(trip.status)}</span>
        </div>
        <p>${escapeHtml(trip.primaryDestination)}</p>
        <div class="bill-meta">
          <span>${formatDate(trip.startDate)} a ${formatDate(trip.endDate)}</span>
          <span>${daysLabel} dias</span>
          <span>${trip.travelers.length || trip.travelersCount} viajantes</span>
          <span>${escapeHtml(trip.primaryCurrency)}</span>
        </div>
        <div class="trip-progress">
          <div class="category-line">
            <strong>${formatMoney(stats.realized, trip.primaryCurrency)} gastos</strong>
            <span>${Math.round(progress)}% usado</span>
          </div>
          <div class="category-track"><div class="category-fill" style="--fill:${progress}%; --bar:${progress > 100 ? "#bf5b64" : "#2478c7"}"></div></div>
        </div>
        <div class="trip-card-numbers">
          <span>Orcamento ${formatMoney(trip.totalBudget, trip.primaryCurrency)}</span>
          <span>Disponivel ${formatMoney(stats.available, trip.primaryCurrency)}</span>
          <span>${escapeHtml(proximity)}</span>
        </div>
        <div class="trip-card-actions">
          <button class="compact-button" data-action="open-trip">Abrir</button>
          <button class="icon-button" data-action="edit-trip" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
          <button class="icon-button" data-action="duplicate-trip" title="Duplicar" aria-label="Duplicar"><i data-lucide="copy"></i></button>
          <button class="icon-button" data-action="archive-trip" title="Arquivar" aria-label="Arquivar"><i data-lucide="archive"></i></button>
          <button class="icon-button" data-action="delete-trip" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
        </div>
      </div>
    </article>
  `;
}

function renderActiveTrip() {
  const trip = getActiveTrip();
  document.querySelectorAll("[data-trip-tab]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tripTab === activeTab);
  });

  if (!trip) {
    elements.tripDetail.hidden = true;
    return;
  }

  elements.tripDetail.hidden = false;
  elements.tripDetailKicker.textContent = `${trip.status} - ${trip.primaryCurrency}`;
  elements.tripDetailTitle.textContent = trip.name;
  elements.tripDetailMeta.textContent = `${trip.primaryDestination} | ${formatDate(trip.startDate)} a ${formatDate(trip.endDate)} | ${tripDays(trip)} dias | ${countdownLabel(trip)}`;

  const renderers = {
    overview: renderOverviewTab,
    budget: renderBudgetTab,
    expenses: renderExpensesTab,
    itinerary: renderItineraryTab,
    reservations: renderReservationsTab,
    checklist: renderChecklistTab,
    documents: renderDocumentsTab,
    report: renderReportTab,
  };
  elements.tripTabContent.innerHTML = (renderers[activeTab] || renderOverviewTab)(trip);
}

function renderOverviewTab(trip) {
  const stats = tripStats(trip);
  const cards = [
    ["Orcamento total", trip.totalBudget, "landmark", "income"],
    ["Total previsto", stats.planned, "wallet-cards", "bills"],
    ["Total pago", stats.paid, "badge-check", "paid"],
    ["Pendente", stats.pending, "circle-alert", "pending"],
    ["Saldo", stats.available, "badge-dollar-sign", "balance"],
    ["Media por dia", stats.averagePerDay, "calendar-days", "bills"],
  ];

  return `
    <section class="travel-dashboard">
      <div class="mini-summary-grid">
        ${cards
          .map(
            ([label, value, icon, tone]) => `
              <article class="summary-card ${tone}">
                <div class="summary-icon"><i data-lucide="${icon}"></i></div>
                <strong>${formatMoney(value, trip.primaryCurrency)}</strong>
                <span>${label}</span>
              </article>
            `,
          )
          .join("")}
      </div>
      <div class="travel-insight-grid">
        <section class="panel inner-panel">
          <div class="panel-header"><div><p class="eyebrow">Categorias</p><h3>Previsto versus realizado</h3></div></div>
          ${categoryUsageTemplate(trip)}
        </section>
        <section class="panel inner-panel">
          <div class="panel-header"><div><p class="eyebrow">Acerto</p><h3>Quem pagou e quem usou</h3></div></div>
          ${settlementTemplate(trip)}
        </section>
      </div>
    </section>
  `;
}

function renderBudgetTab(trip) {
  const rows = trip.categories
    .map((category) => {
      const realized = trip.expenses
        .filter((expense) => expense.categoryId === category.id && !["Cancelado", "Reembolsado"].includes(expense.status))
        .reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0);
      const diff = Number(category.plannedAmount || 0) - realized;
      const pct = category.plannedAmount ? Math.round((realized / category.plannedAmount) * 100) : 0;
      return `
        <article class="travel-row" data-id="${category.id}" style="--row-color:${category.color}">
          <div>
            <strong>${escapeHtml(category.name)}</strong>
            <div class="bill-meta">
              <span>Previsto ${formatMoney(category.plannedAmount, trip.primaryCurrency)}</span>
              <span>Realizado ${formatMoney(realized, trip.primaryCurrency)}</span>
              <span>${pct}% usado</span>
            </div>
            <div class="category-track"><div class="category-fill" style="--fill:${Math.min(pct, 100)}%; --bar:${category.color}"></div></div>
          </div>
          <div class="bill-actions">
            <span class="bill-value">${formatMoney(diff, trip.primaryCurrency)}</span>
            <button class="icon-button" data-action="edit-category" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
            <button class="icon-button" data-action="delete-category" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
          </div>
        </article>
      `;
    })
    .join("");

  return tabPanelHeader("Orcamento por categoria", "open-category", "Categoria") + (rows || emptyTemplate("Sem categorias nesta viagem."));
}

function renderExpensesTab(trip) {
  const rows = trip.expenses.length
    ? trip.expenses
        .map((expense) => {
          const category = trip.categories.find((item) => item.id === expense.categoryId);
          const paidBy = trip.travelers.find((item) => item.id === expense.paidByTravelerId)?.name || "Nao informado";
          return `
            <article class="travel-row ${statusClass(expense.status)}" data-id="${expense.id}">
              <div>
                <div class="bill-title-line">
                  <strong>${escapeHtml(expense.description)}</strong>
                  <span class="status-pill status-${statusClass(expense.status)}">${escapeHtml(expense.status)}</span>
                </div>
                <div class="bill-meta">
                  <span>${escapeHtml(category?.name || "Sem categoria")}</span>
                  <span>${formatShortDate(expense.expenseDate)}</span>
                  <span>${escapeHtml(expense.originalCurrency)} ${formatNumber(expense.originalAmount)}</span>
                  <span>Pago por ${escapeHtml(paidBy)}</span>
                  <span>${expense.installmentCount} parcela(s)</span>
                </div>
              </div>
              <div class="bill-actions">
                <span class="bill-value">${formatMoney(expense.convertedAmount, trip.primaryCurrency)}</span>
                <button class="icon-button" data-action="edit-expense" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
                <button class="icon-button" data-action="delete-expense" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
              </div>
            </article>
          `;
        })
        .join("")
    : emptyTemplate("Nenhuma despesa registrada.");
  return tabPanelHeader("Despesas da viagem", "open-expense", "Despesa") + rows;
}

function renderReservationsTab(trip) {
  const rows = trip.reservations.length
    ? trip.reservations
        .map(
          (reservation) => `
            <article class="travel-row" data-id="${reservation.id}">
              <div>
                <strong>${escapeHtml(reservation.name)}</strong>
                <div class="bill-meta">
                  <span>${escapeHtml(reservation.type)}</span>
                  <span>${escapeHtml(reservation.company || "Sem empresa")}</span>
                  <span>${escapeHtml(reservation.reservationStatus)}</span>
                  <span>${escapeHtml(reservation.paymentStatus)}</span>
                  <span>${formatMoney(reservation.amount, reservation.currency)}</span>
                </div>
              </div>
              <div class="bill-actions">
                <button class="icon-button" data-action="edit-reservation" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
                <button class="icon-button" data-action="delete-reservation" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
              </div>
            </article>
          `,
        )
        .join("")
    : emptyTemplate("Sem reservas cadastradas.");
  return tabPanelHeader("Reservas", "open-reservation", "Reserva") + rows;
}

function renderItineraryTab(trip) {
  const rows = trip.itinerary.length
    ? trip.itinerary
        .map(
          (item) => `
            <article class="travel-row" data-id="${item.id}">
              <div>
                <strong>${formatShortDate(item.date)} ${item.startTime ? `- ${escapeHtml(item.startTime)}` : ""} ${escapeHtml(item.title)}</strong>
                <div class="bill-meta">
                  <span>${escapeHtml(item.city || "Sem cidade")}</span>
                  <span>${escapeHtml(item.location || "Sem local")}</span>
                  <span>${escapeHtml(item.status)}</span>
                </div>
              </div>
              <div class="bill-actions">
                <button class="icon-button" data-action="edit-itinerary" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
                <button class="icon-button" data-action="delete-itinerary" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
              </div>
            </article>
          `,
        )
        .join("")
    : emptyTemplate("Sem atividades no roteiro.");
  return tabPanelHeader("Roteiro por dia", "open-itinerary", "Atividade") + rows;
}

function renderChecklistTab(trip) {
  const rows = trip.checklist.length
    ? trip.checklist
        .map((item) => {
          const traveler = trip.travelers.find((entry) => entry.id === item.assignedToTravelerId)?.name || "Casa";
          return `
            <article class="travel-row ${item.completed ? "paid" : "pending"}" data-id="${item.id}">
              <div>
                <strong>${escapeHtml(item.description)}</strong>
                <div class="bill-meta">
                  <span>${escapeHtml(item.category)}</span>
                  <span>${escapeHtml(traveler)}</span>
                  <span>${item.dueDate ? formatShortDate(item.dueDate) : "Sem prazo"}</span>
                  <span>${escapeHtml(item.priority)}</span>
                </div>
              </div>
              <div class="bill-actions">
                <button class="icon-button" data-action="toggle-checklist" title="Concluir" aria-label="Concluir"><i data-lucide="${item.completed ? "rotate-ccw" : "check"}"></i></button>
                <button class="icon-button" data-action="edit-checklist" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
                <button class="icon-button" data-action="delete-checklist" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
              </div>
            </article>
          `;
        })
        .join("")
    : emptyTemplate("Checklist vazio.");
  return tabPanelHeader("Checklist da viagem", "open-checklist", "Item") + rows;
}

function renderDocumentsTab(trip) {
  const rows = trip.documents.length
    ? trip.documents
        .map((document) => {
          const traveler = trip.travelers.find((entry) => entry.id === document.travelerId)?.name || "Viagem";
          return `
            <article class="travel-row" data-id="${document.id}">
              <div>
                <strong>${escapeHtml(document.name)}</strong>
                <div class="bill-meta">
                  <span>${escapeHtml(document.type)}</span>
                  <span>${escapeHtml(traveler)}</span>
                  <span>${escapeHtml(document.maskedNumber || "Numero oculto")}</span>
                  <span>${document.expirationDate ? `Validade ${formatShortDate(document.expirationDate)}` : "Sem validade"}</span>
                </div>
              </div>
              <div class="bill-actions">
                <button class="icon-button" data-action="edit-document" title="Editar" aria-label="Editar"><i data-lucide="pencil"></i></button>
                <button class="icon-button" data-action="delete-document" title="Excluir" aria-label="Excluir"><i data-lucide="trash-2"></i></button>
              </div>
            </article>
          `;
        })
        .join("")
    : emptyTemplate("Sem documentos cadastrados.");
  return tabPanelHeader("Documentos", "open-document", "Documento") + rows;
}

function renderReportTab(trip) {
  const stats = tripStats(trip);
  return `
    <section class="travel-report">
      <div class="mini-summary-grid">
        <article class="summary-card income"><strong>${formatMoney(trip.totalBudget, trip.primaryCurrency)}</strong><span>Orcamento</span></article>
        <article class="summary-card paid"><strong>${formatMoney(stats.paid, trip.primaryCurrency)}</strong><span>Pago</span></article>
        <article class="summary-card pending"><strong>${formatMoney(stats.pending, trip.primaryCurrency)}</strong><span>Pendente</span></article>
        <article class="summary-card balance"><strong>${formatMoney(stats.available, trip.primaryCurrency)}</strong><span>Saldo</span></article>
      </div>
      <section class="panel inner-panel">
        <div class="panel-header"><div><p class="eyebrow">Fechamento</p><h3>Acerto entre viajantes</h3></div></div>
        ${settlementTemplate(trip)}
      </section>
      <section class="panel inner-panel">
        <div class="panel-header"><div><p class="eyebrow">Moedas</p><h3>Gastos por moeda original</h3></div></div>
        ${currencyBreakdownTemplate(trip)}
      </section>
    </section>
  `;
}

function tabPanelHeader(title, action, label) {
  return `
    <div class="tab-panel-header">
      <h3>${title}</h3>
      <button class="compact-button" data-action="${action}">
        <i data-lucide="plus"></i>
        ${label}
      </button>
    </div>
  `;
}

function categoryUsageTemplate(trip) {
  const rows = trip.categories
    .map((category) => {
      const realized = trip.expenses
        .filter((expense) => expense.categoryId === category.id && !["Cancelado", "Reembolsado"].includes(expense.status))
        .reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0);
      if (!category.plannedAmount && !realized) return "";
      const pct = category.plannedAmount ? Math.min((realized / category.plannedAmount) * 100, 100) : 100;
      return `
        <div class="category-row">
          <div class="category-line"><strong>${escapeHtml(category.name)}</strong><span>${formatMoney(realized, trip.primaryCurrency)} / ${formatMoney(category.plannedAmount, trip.primaryCurrency)}</span></div>
          <div class="category-track"><div class="category-fill" style="--fill:${pct}%; --bar:${category.color}"></div></div>
        </div>
      `;
    })
    .join("");
  return rows || emptyTemplate("Sem gastos por categoria.");
}

function settlementTemplate(trip) {
  const settlement = travelerSettlement(trip);
  if (!settlement.length) return emptyTemplate("Sem despesas compartilhadas.");
  return settlement
    .map(
      (item) => `
        <div class="category-row">
          <div class="category-line">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${formatMoney(item.balance, trip.primaryCurrency)}</span>
          </div>
          <div class="bill-meta">
            <span>Pagou ${formatMoney(item.paid, trip.primaryCurrency)}</span>
            <span>Parte ${formatMoney(item.share, trip.primaryCurrency)}</span>
            <span>${item.balance >= 0 ? "Tem credito" : "Deve ajustar"}</span>
          </div>
        </div>
      `,
    )
    .join("");
}

function currencyBreakdownTemplate(trip) {
  const totals = totalsBy(trip.expenses, (expense) => expense.originalCurrency, (expense) => expense.originalAmount);
  return totals.length
    ? totals.map((item) => `<div class="category-row"><div class="category-line"><strong>${escapeHtml(item.key)}</strong><span>${formatNumber(item.total)}</span></div></div>`).join("")
    : emptyTemplate("Sem despesas em moeda original.");
}

function openTripDialog(trip = null) {
  elements.tripForm.reset();
  document.querySelector("#tripId").value = trip?.id || "";
  document.querySelector("#tripDialogTitle").textContent = trip ? "Editar viagem" : "Nova viagem";
  document.querySelector("#tripName").value = trip?.name || "";
  document.querySelector("#tripDestination").value = trip?.primaryDestination || "";
  document.querySelector("#tripOtherDestinations").value = trip?.otherDestinations || "";
  document.querySelector("#tripStartDate").value = trip?.startDate || todayKey();
  document.querySelector("#tripEndDate").value = trip?.endDate || addDays(todayKey(), 7);
  document.querySelector("#tripStatus").value = trip?.status || "Planejamento";
  document.querySelector("#tripCurrency").value = trip?.primaryCurrency || "BRL";
  document.querySelector("#tripBudget").value = trip?.totalBudget ?? "";
  document.querySelector("#tripCoverImage").value = trip?.coverImage || "";
  document.querySelector("#tripTravelers").value = trip?.travelers?.map((traveler) => traveler.name).join("\n") || "Andre\nLuciana";
  document.querySelector("#tripNotes").value = trip?.notes || "";
  elements.tripDialog.showModal();
}

async function saveTripFromForm(event) {
  event.preventDefault();
  const id = document.querySelector("#tripId").value || createId();
  const existing = findTrip(id);
  const travelers = parseTravelers(document.querySelector("#tripTravelers").value, existing);
  const payload = {
    id,
    name: document.querySelector("#tripName").value.trim(),
    primaryDestination: document.querySelector("#tripDestination").value.trim(),
    otherDestinations: document.querySelector("#tripOtherDestinations").value.trim(),
    startDate: document.querySelector("#tripStartDate").value,
    endDate: document.querySelector("#tripEndDate").value,
    status: document.querySelector("#tripStatus").value,
    primaryCurrency: document.querySelector("#tripCurrency").value,
    totalBudget: Number(document.querySelector("#tripBudget").value),
    travelersCount: travelers.length,
    coverImage: document.querySelector("#tripCoverImage").value.trim(),
    notes: document.querySelector("#tripNotes").value.trim(),
    travelers,
    createdBy: existing?.createdBy || currentActor,
    updatedBy: currentActor,
  };

  await apiRequest("/api/trips", { method: "POST", body: payload });
  activeTripId = id;
  localStorage.setItem(STORAGE_KEYS.selectedTrip, activeTripId);
  await refreshTrips();
  elements.tripDialog.close();
  render();
  showToast("Viagem salva.");
}

function openCategoryDialog(category = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.categoryForm.reset();
  document.querySelector("#categoryId").value = category?.id || "";
  document.querySelector("#categoryName").value = category?.name || "";
  document.querySelector("#categoryPlannedAmount").value = category?.plannedAmount ?? "";
  document.querySelector("#categoryColor").value = category?.color || "#2478c7";
  elements.categoryDialog.showModal();
}

async function saveCategoryFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const id = document.querySelector("#categoryId").value || createId();
  const payload = {
    id,
    tripId: trip.id,
    name: document.querySelector("#categoryName").value.trim(),
    plannedAmount: Number(document.querySelector("#categoryPlannedAmount").value),
    color: document.querySelector("#categoryColor").value,
    sortOrder: findCategory(id)?.sortOrder || trip.categories.length + 1,
  };
  await apiRequest("/api/trip-categories", { method: "POST", body: payload });
  await refreshTrips();
  elements.categoryDialog.close();
  render();
  showToast("Categoria salva.");
}

function openExpenseDialog(expense = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.expenseForm.reset();
  fillTripSelects(trip);
  document.querySelector("#expenseId").value = expense?.id || "";
  document.querySelector("#expenseDescription").value = expense?.description || "";
  document.querySelector("#expenseCategory").value = expense?.categoryId || "";
  document.querySelector("#expenseStatus").value = expense?.status || "Previsto";
  document.querySelector("#expenseOriginalAmount").value = expense?.originalAmount ?? "";
  document.querySelector("#expenseCurrency").value = expense?.originalCurrency || trip.primaryCurrency;
  document.querySelector("#expenseExchangeRate").value = expense?.exchangeRate || 1;
  document.querySelector("#expenseConvertedAmount").value = expense?.convertedAmount ?? "";
  document.querySelector("#expenseDate").value = expense?.expenseDate || todayKey();
  document.querySelector("#expenseDueDate").value = expense?.dueDate || "";
  document.querySelector("#expensePaidDate").value = expense?.paidDate || "";
  document.querySelector("#expensePaymentMethod").value = expense?.paymentMethod || "Cartao de credito";
  document.querySelector("#expensePaidBy").value = expense?.paidByTravelerId || trip.travelers[0]?.id || "";
  document.querySelector("#expenseInstallments").value = expense?.installmentCount || 1;
  document.querySelector("#expenseDestination").value = expense?.destination || "";
  document.querySelector("#expenseAccountLabel").value = expense?.accountLabel || "";
  document.querySelector("#expenseSyncPlanner").checked = Boolean(expense?.syncToPlanner);
  document.querySelector("#expenseNotes").value = expense?.notes || "";
  renderParticipantChoices(trip, expense?.participants || []);
  elements.expenseDialog.showModal();
}

async function saveExpenseFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const selectedParticipants = [...document.querySelectorAll("[data-expense-participant]:checked")].map((input) => ({ travelerId: input.value }));
  const convertedAmount = document.querySelector("#expenseConvertedAmount").value;
  const payload = {
    id: document.querySelector("#expenseId").value || createId(),
    tripId: trip.id,
    categoryId: document.querySelector("#expenseCategory").value || null,
    description: document.querySelector("#expenseDescription").value.trim(),
    originalAmount: Number(document.querySelector("#expenseOriginalAmount").value),
    originalCurrency: document.querySelector("#expenseCurrency").value,
    exchangeRate: Number(document.querySelector("#expenseExchangeRate").value),
    convertedAmount: convertedAmount ? Number(convertedAmount) : null,
    expenseDate: document.querySelector("#expenseDate").value,
    dueDate: document.querySelector("#expenseDueDate").value || document.querySelector("#expenseDate").value,
    paidDate: document.querySelector("#expensePaidDate").value || null,
    status: document.querySelector("#expenseStatus").value,
    paymentMethod: document.querySelector("#expensePaymentMethod").value,
    paidByTravelerId: document.querySelector("#expensePaidBy").value || null,
    installmentCount: Number(document.querySelector("#expenseInstallments").value || 1),
    destination: document.querySelector("#expenseDestination").value.trim(),
    accountLabel: document.querySelector("#expenseAccountLabel").value.trim(),
    syncToPlanner: document.querySelector("#expenseSyncPlanner").checked,
    participants: selectedParticipants.length ? selectedParticipants : trip.travelers.map((traveler) => ({ travelerId: traveler.id })),
    notes: document.querySelector("#expenseNotes").value.trim(),
  };
  await apiRequest("/api/trip-expenses", { method: "POST", body: payload });
  await refreshTrips();
  elements.expenseDialog.close();
  render();
  showToast("Despesa salva.");
}

function openReservationDialog(reservation = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.reservationForm.reset();
  document.querySelector("#reservationId").value = reservation?.id || "";
  document.querySelector("#reservationType").value = reservation?.type || "";
  document.querySelector("#reservationName").value = reservation?.name || "";
  document.querySelector("#reservationCompany").value = reservation?.company || "";
  document.querySelector("#reservationCode").value = reservation?.confirmationCode || "";
  document.querySelector("#reservationStart").value = reservation?.startDateTime || "";
  document.querySelector("#reservationEnd").value = reservation?.endDateTime || "";
  document.querySelector("#reservationAmount").value = reservation?.amount ?? "";
  document.querySelector("#reservationCurrency").value = reservation?.currency || trip.primaryCurrency;
  document.querySelector("#reservationPaymentStatus").value = reservation?.paymentStatus || "Pendente";
  document.querySelector("#reservationStatus").value = reservation?.reservationStatus || "Planejada";
  document.querySelector("#reservationLocation").value = reservation?.location || "";
  document.querySelector("#reservationNotes").value = reservation?.notes || "";
  elements.reservationDialog.showModal();
}

async function saveReservationFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const payload = {
    id: document.querySelector("#reservationId").value || createId(),
    tripId: trip.id,
    type: document.querySelector("#reservationType").value.trim(),
    name: document.querySelector("#reservationName").value.trim(),
    company: document.querySelector("#reservationCompany").value.trim(),
    confirmationCode: document.querySelector("#reservationCode").value.trim(),
    startDateTime: document.querySelector("#reservationStart").value,
    endDateTime: document.querySelector("#reservationEnd").value,
    amount: Number(document.querySelector("#reservationAmount").value || 0),
    currency: document.querySelector("#reservationCurrency").value,
    paymentStatus: document.querySelector("#reservationPaymentStatus").value,
    reservationStatus: document.querySelector("#reservationStatus").value,
    location: document.querySelector("#reservationLocation").value.trim(),
    notes: document.querySelector("#reservationNotes").value.trim(),
  };
  await apiRequest("/api/trip-reservations", { method: "POST", body: payload });
  await refreshTrips();
  elements.reservationDialog.close();
  render();
  showToast("Reserva salva.");
}

function openItineraryDialog(item = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.itineraryForm.reset();
  document.querySelector("#itineraryId").value = item?.id || "";
  document.querySelector("#itineraryDate").value = item?.date || trip.startDate;
  document.querySelector("#itineraryCity").value = item?.city || "";
  document.querySelector("#itineraryStart").value = item?.startTime || "";
  document.querySelector("#itineraryEnd").value = item?.endTime || "";
  document.querySelector("#itineraryTitle").value = item?.title || "";
  document.querySelector("#itineraryLocation").value = item?.location || "";
  document.querySelector("#itineraryDescription").value = item?.description || "";
  elements.itineraryDialog.showModal();
}

async function saveItineraryFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const payload = {
    id: document.querySelector("#itineraryId").value || createId(),
    tripId: trip.id,
    date: document.querySelector("#itineraryDate").value,
    city: document.querySelector("#itineraryCity").value.trim(),
    startTime: document.querySelector("#itineraryStart").value,
    endTime: document.querySelector("#itineraryEnd").value,
    title: document.querySelector("#itineraryTitle").value.trim(),
    location: document.querySelector("#itineraryLocation").value.trim(),
    description: document.querySelector("#itineraryDescription").value.trim(),
    status: "Planejado",
  };
  await apiRequest("/api/trip-itinerary-items", { method: "POST", body: payload });
  await refreshTrips();
  elements.itineraryDialog.close();
  render();
  showToast("Atividade salva.");
}

function openChecklistDialog(item = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.checklistForm.reset();
  fillTravelerSelect("#checklistAssignedTo", trip, true);
  document.querySelector("#checklistId").value = item?.id || "";
  document.querySelector("#checklistCategory").value = item?.category || "";
  document.querySelector("#checklistDescription").value = item?.description || "";
  document.querySelector("#checklistAssignedTo").value = item?.assignedToTravelerId || "";
  document.querySelector("#checklistDueDate").value = item?.dueDate || "";
  document.querySelector("#checklistPriority").value = item?.priority || "Media";
  document.querySelector("#checklistCompleted").checked = Boolean(item?.completed);
  document.querySelector("#checklistNotes").value = item?.notes || "";
  elements.checklistDialog.showModal();
}

async function saveChecklistFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const payload = {
    id: document.querySelector("#checklistId").value || createId(),
    tripId: trip.id,
    category: document.querySelector("#checklistCategory").value.trim(),
    description: document.querySelector("#checklistDescription").value.trim(),
    assignedToTravelerId: document.querySelector("#checklistAssignedTo").value || null,
    dueDate: document.querySelector("#checklistDueDate").value || null,
    priority: document.querySelector("#checklistPriority").value,
    completed: document.querySelector("#checklistCompleted").checked,
    notes: document.querySelector("#checklistNotes").value.trim(),
  };
  await apiRequest("/api/trip-checklist-items", { method: "POST", body: payload });
  await refreshTrips();
  elements.checklistDialog.close();
  render();
  showToast("Checklist salvo.");
}

function openDocumentDialog(documentItem = null) {
  const trip = getActiveTrip();
  if (!trip) return showToast("Selecione uma viagem.");
  elements.documentForm.reset();
  fillTravelerSelect("#documentTraveler", trip, true);
  document.querySelector("#documentId").value = documentItem?.id || "";
  document.querySelector("#documentType").value = documentItem?.type || "";
  document.querySelector("#documentTraveler").value = documentItem?.travelerId || "";
  document.querySelector("#documentName").value = documentItem?.name || "";
  document.querySelector("#documentMaskedNumber").value = documentItem?.maskedNumber || "";
  document.querySelector("#documentIssueDate").value = documentItem?.issueDate || "";
  document.querySelector("#documentExpirationDate").value = documentItem?.expirationDate || "";
  document.querySelector("#documentNotes").value = documentItem?.notes || "";
  elements.documentDialog.showModal();
}

async function saveDocumentFromForm(event) {
  event.preventDefault();
  const trip = getActiveTrip();
  const payload = {
    id: document.querySelector("#documentId").value || createId(),
    tripId: trip.id,
    type: document.querySelector("#documentType").value.trim(),
    travelerId: document.querySelector("#documentTraveler").value || null,
    name: document.querySelector("#documentName").value.trim(),
    maskedNumber: document.querySelector("#documentMaskedNumber").value.trim(),
    issueDate: document.querySelector("#documentIssueDate").value || null,
    expirationDate: document.querySelector("#documentExpirationDate").value || null,
    notes: document.querySelector("#documentNotes").value.trim(),
  };
  await apiRequest("/api/trip-documents", { method: "POST", body: payload });
  await refreshTrips();
  elements.documentDialog.close();
  render();
  showToast("Documento salvo.");
}

async function duplicateTrip(id) {
  await apiRequest(`/api/trips/${encodeURIComponent(id)}/duplicate`, { method: "POST", body: {} });
  await refreshTrips();
  render();
  showToast("Viagem duplicada.");
}

async function archiveTrip(id) {
  if (!confirm("Arquivar esta viagem?")) return;
  await apiRequest(`/api/trips/${encodeURIComponent(id)}/archive`, { method: "PATCH", body: { updatedBy: currentActor } });
  await refreshTrips();
  render();
  showToast("Viagem arquivada.");
}

async function deleteTrip(id) {
  const trip = findTrip(id);
  if (!trip || !confirm(`Excluir "${trip.name}" e todos os dados da viagem?`)) return;
  await apiRequest(`/api/trips/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (activeTripId === id) activeTripId = "";
  await refreshTrips();
  render();
  showToast("Viagem excluida.");
}

async function deleteEntity(path, message) {
  if (!confirm("Excluir este registro?")) return;
  await apiRequest(path, { method: "DELETE" });
  await refreshTrips();
  render();
  showToast(message);
}

async function toggleChecklist(id) {
  const item = findChecklistItem(id);
  if (!item) return;
  await apiRequest("/api/trip-checklist-items", { method: "POST", body: { ...item, completed: !item.completed } });
  await refreshTrips();
  render();
}

function fillTripSelects(trip) {
  document.querySelector("#expenseCategory").innerHTML = `<option value="">Sem categoria</option>` + trip.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join("");
  fillTravelerSelect("#expensePaidBy", trip);
}

function fillTravelerSelect(selector, trip, includeEmpty = false) {
  const select = document.querySelector(selector);
  select.innerHTML = `${includeEmpty ? `<option value="">Viagem</option>` : ""}${trip.travelers.map((traveler) => `<option value="${traveler.id}">${escapeHtml(traveler.name)}</option>`).join("")}`;
}

function renderParticipantChoices(trip, participants) {
  const selected = new Set(participants.map((participant) => participant.travelerId));
  const allSelected = !participants.length;
  document.querySelector("#expenseParticipants").innerHTML = trip.travelers
    .map(
      (traveler) => `
        <label class="choice-pill">
          <input data-expense-participant type="checkbox" value="${traveler.id}" ${allSelected || selected.has(traveler.id) ? "checked" : ""} />
          <span>${escapeHtml(traveler.name)}</span>
        </label>
      `,
    )
    .join("");
}

function updateConvertedAmountPreview() {
  const amount = Number(document.querySelector("#expenseOriginalAmount").value || 0);
  const rate = Number(document.querySelector("#expenseExchangeRate").value || 1);
  const field = document.querySelector("#expenseConvertedAmount");
  if (!field.value && amount && rate) field.placeholder = formatNumber(amount * rate);
}

function getFilteredTrips() {
  const query = normalizeText(elements.tripSearch.value);
  const status = elements.tripStatusFilter.value;
  return trips.filter((trip) => {
    const haystack = normalizeText(`${trip.name} ${trip.primaryDestination} ${trip.otherDestinations} ${trip.status}`);
    const matchesQuery = !query || haystack.includes(query);
    const matchesStatus =
      status === "all" ||
      (status === "active" && !["Concluida", "Arquivada"].includes(trip.status)) ||
      trip.status === status;
    return matchesQuery && matchesStatus;
  });
}

function tripStats(trip) {
  const validExpenses = trip.expenses.filter((expense) => !["Cancelado", "Reembolsado"].includes(expense.status));
  const realized = validExpenses.reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0);
  const paid = validExpenses.filter((expense) => expense.status === "Pago").reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0);
  const pending = validExpenses.filter((expense) => ["Reservado", "Pendente"].includes(expense.status)).reduce((total, expense) => total + Number(expense.convertedAmount || 0), 0);
  const planned = trip.categories.reduce((total, category) => total + Number(category.plannedAmount || 0), 0);
  const available = Number(trip.totalBudget || 0) - realized;
  const days = Math.max(tripDays(trip), 1);
  return {
    realized,
    paid,
    pending,
    planned,
    available,
    averagePerDay: realized / days,
    averagePerPerson: realized / Math.max(trip.travelers.length || trip.travelersCount || 1, 1),
  };
}

function travelerSettlement(trip) {
  const map = new Map(trip.travelers.map((traveler) => [traveler.id, { name: traveler.name, paid: 0, share: 0, balance: 0 }]));
  trip.expenses
    .filter((expense) => !["Cancelado", "Reembolsado"].includes(expense.status))
    .forEach((expense) => {
      if (expense.paidByTravelerId && map.has(expense.paidByTravelerId)) {
        map.get(expense.paidByTravelerId).paid += Number(expense.convertedAmount || 0);
      }
      expense.participants.forEach((participant) => {
        if (map.has(participant.travelerId)) map.get(participant.travelerId).share += Number(participant.calculatedAmount || 0);
      });
    });
  return [...map.values()].map((item) => ({ ...item, balance: item.paid - item.share }));
}

function parseTravelers(value, existingTrip) {
  const previous = new Map((existingTrip?.travelers || []).map((traveler) => [normalizeText(traveler.name), traveler]));
  return String(value || "")
    .split(/[\n,;]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const previousTraveler = previous.get(normalizeText(name));
      return {
        id: previousTraveler?.id || createId(),
        name,
        actor: ["Andre", "Luciana"].includes(name) ? name : previousTraveler?.actor || null,
        active: true,
      };
    });
}

function findTrip(id) {
  return trips.find((trip) => trip.id === id);
}

function getActiveTrip() {
  return findTrip(activeTripId);
}

function findCategory(id) {
  return getActiveTrip()?.categories.find((item) => item.id === id);
}

function findExpense(id) {
  return getActiveTrip()?.expenses.find((item) => item.id === id);
}

function findReservation(id) {
  return getActiveTrip()?.reservations.find((item) => item.id === id);
}

function findItineraryItem(id) {
  return getActiveTrip()?.itinerary.find((item) => item.id === id);
}

function findChecklistItem(id) {
  return getActiveTrip()?.checklist.find((item) => item.id === id);
}

function findDocument(id) {
  return getActiveTrip()?.documents.find((item) => item.id === id);
}

async function backupDatabase() {
  const result = await apiRequest("/api/backup", { method: "POST", body: {} });
  showToast(`Backup criado: ${result.backup}`);
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
  if (!response.ok) throw new Error(payload.error || payload.details || "Erro ao acessar o banco de dados.");
  return payload;
}

function totalsBy(items, keyFn, valueFn) {
  const map = new Map();
  items.forEach((item) => {
    const key = keyFn(item);
    map.set(key, (map.get(key) || 0) + Number(valueFn(item) || 0));
  });
  return [...map.entries()].map(([key, total]) => ({ key, total })).sort((a, b) => b.total - a.total);
}

function tripDays(trip) {
  return Math.max(Math.round((dateFromKey(trip.endDate) - dateFromKey(trip.startDate)) / DAY_MS) + 1, 1);
}

function daysUntil(dateKeyValue) {
  return Math.round((dateFromKey(dateKeyValue) - dateFromKey(todayKey())) / DAY_MS);
}

function proximityLabel(trip) {
  if (trip.status === "Arquivada") return "Arquivada";
  if (trip.endDate < todayKey()) return "Concluida ou passada";
  const days = daysUntil(trip.startDate);
  if (days < 0) return "Em andamento";
  if (days === 0) return "Comeca hoje";
  if (days <= 30) return `Faltam ${days} dias`;
  return `Faltam ${days} dias`;
}

function countdownLabel(trip) {
  const days = daysUntil(trip.startDate);
  if (days < 0 && trip.endDate >= todayKey()) return "viagem em andamento";
  if (days < 0) return "viagem passada";
  if (days === 0) return "comeca hoje";
  return `faltam ${days} dias`;
}

function statusClass(value) {
  return normalizeText(value).replaceAll(" ", "-");
}

function formatMoney(value, currency) {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(Number(value || 0));
  } catch {
    return `${currency || "BRL"} ${formatNumber(value)}`;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0));
}

function formatDate(key) {
  return dateFormatter.format(dateFromKey(key));
}

function formatShortDate(key) {
  return shortDateFormatter.format(dateFromKey(key));
}

function todayKey() {
  return dateKey(new Date());
}

function addDays(key, days) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function createId() {
  return window.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function emptyTemplate(message) {
  return `<div class="empty-state">${message}</div>`;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 5200);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
