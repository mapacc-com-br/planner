const STORAGE_KEYS = {
  bills: "plannerFinanceiro:bills",
  revenues: "plannerFinanceiro:revenues",
  actor: "plannerFinanceiro:actor",
  ownerFilter: "plannerFinanceiro:ownerFilter",
  selectedMonth: "plannerFinanceiro:selectedMonth",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CATEGORIES = [
  { name: "Moradia", color: "#2478c7" },
  { name: "Cartao", color: "#6c69b1" },
  { name: "Mercado", color: "#3f95dc" },
  { name: "Saude", color: "#bf5b64" },
  { name: "Transporte", color: "#2f8b80" },
  { name: "Assinaturas", color: "#c38a2e" },
  { name: "Educacao", color: "#4d789f" },
  { name: "Lazer", color: "#d96c63" },
  { name: "Impostos", color: "#9b6a4b" },
  { name: "Investimentos", color: "#2f8b80" },
  { name: "Outros", color: "#7c8fa3" },
];

const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
});

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

let categories = [...DEFAULT_CATEGORIES];
let bills = [];
let billOccurrences = [];
let revenues = [];
let financialGoal = null;
let selectedMonth = localStorage.getItem(STORAGE_KEYS.selectedMonth) || monthKey(new Date());
let currentActor = localStorage.getItem(STORAGE_KEYS.actor) || "Andre";
let ownerFilter = localStorage.getItem(STORAGE_KEYS.ownerFilter) || "Todos";
let lockedActor = null;
let toastTimer = null;
let pendingLocalRecovery = null;
let recurrenceScopeResolver = null;

const elements = {
  summaryGrid: document.querySelector("#summaryGrid"),
  financialGoalStrip: document.querySelector("#financialGoalStrip"),
  monthlyCheckin: document.querySelector("#monthlyCheckin"),
  urgentList: document.querySelector("#urgentList"),
  urgentCount: document.querySelector("#urgentCount"),
  paidList: document.querySelector("#paidList"),
  paidCount: document.querySelector("#paidCount"),
  allBillsList: document.querySelector("#allBillsList"),
  revenueList: document.querySelector("#revenueList"),
  categoryMap: document.querySelector("#categoryMap"),
  monthLabel: document.querySelector("#monthLabel"),
  billDialog: document.querySelector("#billDialog"),
  billForm: document.querySelector("#billForm"),
  billDialogTitle: document.querySelector("#billDialogTitle"),
  paymentDialog: document.querySelector("#paymentDialog"),
  paymentForm: document.querySelector("#paymentForm"),
  recurrenceScopeDialog: document.querySelector("#recurrenceScopeDialog"),
  recurrenceScopeTitle: document.querySelector("#recurrenceScopeTitle"),
  recurrenceScopeText: document.querySelector("#recurrenceScopeText"),
  recurrenceScopeName: document.querySelector("#recurrenceScopeName"),
  revenueDialog: document.querySelector("#revenueDialog"),
  revenueForm: document.querySelector("#revenueForm"),
  revenueDialogTitle: document.querySelector("#revenueDialogTitle"),
  toast: document.querySelector("#toast"),
  recoverLocalStorage: document.querySelector("#recoverLocalStorage"),
  logoutButton: document.querySelector("#logoutButton"),
};

initializeApp();

async function initializeApp() {
  populateCategoryOptions();
  bindEvents();
  renderLoading();

  try {
    await loadInitialState();
    render();
  } catch (error) {
    renderFatalError(error);
  }
}

function bindEvents() {
  document.querySelector("#previousMonth").addEventListener("click", () => shiftMonth(-1));
  document.querySelector("#nextMonth").addEventListener("click", () => shiftMonth(1));
  document.querySelector("#currentMonth").addEventListener("click", () => setSelectedMonth(monthKey(new Date())));
  document.querySelector("#backupDatabase").addEventListener("click", () => backupDatabase());
  elements.logoutButton.addEventListener("click", () => logout());
  document.querySelector("#recoverLocalStorage").addEventListener("click", () => recoverLocalSnapshot());

  document.querySelectorAll("#openBillForm, #openBillFormFloating").forEach((button) => {
    button.addEventListener("click", () => openBillDialog());
  });

  document.querySelectorAll("#openRevenueForm, #openRevenueFormSecondary").forEach((button) => {
    button.addEventListener("click", () => openRevenueDialog());
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => {
      const dialog = document.querySelector(`#${button.dataset.closeDialog}`);
      dialog.close();
    });
  });

  document.querySelectorAll("[data-actor]").forEach((button) => {
    button.addEventListener("click", () => {
      if (lockedActor && button.dataset.actor !== lockedActor) return;
      currentActor = button.dataset.actor;
      localStorage.setItem(STORAGE_KEYS.actor, currentActor);
      render();
    });
  });

  document.querySelectorAll("[data-owner-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      ownerFilter = button.dataset.ownerFilter;
      localStorage.setItem(STORAGE_KEYS.ownerFilter, ownerFilter);
      render();
    });
  });

  document.addEventListener("click", async (event) => {
    const quickActionButton = event.target.closest("[data-quick-action]");
    if (quickActionButton?.dataset.quickAction === "bill") openBillDialog();
    if (quickActionButton?.dataset.quickAction === "revenue") openRevenueDialog();
    if (quickActionButton) return;

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const id = actionButton.dataset.id || actionButton.closest("[data-id]")?.dataset.id;
    const action = actionButton.dataset.action;

    try {
      if (action === "mark-paid") openPaymentDialog(id);
      if (action === "undo-payment") await undoPayment(id);
      if (action === "edit-bill") openBillDialog(findBill(id));
      if (action === "delete-bill") await deleteBill(id);
      if (action === "edit-revenue") openRevenueDialog(findRevenue(id));
      if (action === "delete-revenue") await deleteRevenue(id);
    } catch (error) {
      showToast(error.message || "Nao foi possivel concluir a acao.");
    }
  });

  elements.billForm.addEventListener("submit", saveBillFromForm);
  elements.paymentForm.addEventListener("submit", savePaymentFromForm);
  elements.revenueForm.addEventListener("submit", saveRevenueFromForm);

  elements.recurrenceScopeDialog?.addEventListener("close", () => {
    if (!recurrenceScopeResolver) return;
    const resolve = recurrenceScopeResolver;
    recurrenceScopeResolver = null;
    resolve(elements.recurrenceScopeDialog.returnValue || null);
  });
}

async function loadInitialState() {
  await syncSessionActor();
  const state = await apiRequest("/api/state");
  const hasDatabaseData = state.bills.length || state.revenues.length;
  const localSnapshot = {
    bills: loadCollection(STORAGE_KEYS.bills),
    revenues: loadCollection(STORAGE_KEYS.revenues),
  };
  const hasLocalData = localSnapshot.bills.length || localSnapshot.revenues.length;

  if (hasDatabaseData) {
    applyState(state);
    if (hasLocalData && snapshotsDiffer(localSnapshot, state)) {
      pendingLocalRecovery = localSnapshot;
      elements.recoverLocalStorage.hidden = false;
      showToast("Encontrei dados antigos neste navegador. Use Recuperar local para importar para o SQLite.");
      return;
    }
    saveLocalSnapshot();
    return;
  }

  if (!hasLocalData && !isLocalHost()) {
    applyState(state);
    saveLocalSnapshot();
    return;
  }

  const seed = hasLocalData ? localSnapshot : createDemoData();
  const imported = await apiRequest("/api/import-local", {
    method: "POST",
    body: seed,
  });

  applyState(imported);
  saveLocalSnapshot();
}

async function syncSessionActor() {
  const session = await apiRequest("/api/session");
  if (!session.user?.actor) return;

  lockedActor = session.user.actor;
  currentActor = lockedActor;
  localStorage.setItem(STORAGE_KEYS.actor, currentActor);
}

async function refreshState() {
  const state = await apiRequest("/api/state");
  applyState(state);
  saveLocalSnapshot();
}

function applyState(state) {
  bills = Array.isArray(state.bills) ? state.bills : [];
  billOccurrences = Array.isArray(state.billOccurrences) ? state.billOccurrences : [];
  revenues = Array.isArray(state.revenues) ? state.revenues : [];
  financialGoal = state.financialGoal || null;
  categories = Array.isArray(state.categories) && state.categories.length ? state.categories : [...DEFAULT_CATEGORIES];
  populateCategoryOptions();
}

async function recoverLocalSnapshot() {
  if (!pendingLocalRecovery) return;

  try {
    await apiRequest("/api/backup", { method: "POST", body: {} });
    const imported = await apiRequest("/api/import-local", {
      method: "POST",
      body: pendingLocalRecovery,
    });
    applyState(imported);
    pendingLocalRecovery = null;
    elements.recoverLocalStorage.hidden = true;
    saveLocalSnapshot();
    render();
    showToast("Dados locais importados para o SQLite.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel recuperar os dados locais.");
  }
}

function renderLoading() {
  elements.summaryGrid.innerHTML = "";
  elements.financialGoalStrip.innerHTML = "";
  elements.monthlyCheckin.innerHTML = "";
  elements.urgentList.innerHTML = emptyTemplate("Carregando dados do SQLite...");
  elements.paidList.innerHTML = emptyTemplate("Carregando pagamentos...");
  elements.allBillsList.innerHTML = emptyTemplate("Carregando contas...");
  elements.revenueList.innerHTML = emptyTemplate("Carregando receitas...");
  elements.categoryMap.innerHTML = emptyTemplate("Carregando categorias...");
}

function renderFatalError(error) {
  const message = error.message || "Nao foi possivel abrir o banco de dados.";
  elements.summaryGrid.innerHTML = "";
  elements.financialGoalStrip.innerHTML = "";
  elements.monthlyCheckin.innerHTML = "";
  elements.urgentList.innerHTML = emptyTemplate(message);
  elements.paidList.innerHTML = emptyTemplate(message);
  elements.allBillsList.innerHTML = emptyTemplate(message);
  elements.revenueList.innerHTML = emptyTemplate(message);
  elements.categoryMap.innerHTML = emptyTemplate(message);
  showToast(message);
}

function render() {
  localStorage.setItem(STORAGE_KEYS.selectedMonth, selectedMonth);
  elements.monthLabel.textContent = capitalize(monthFormatter.format(dateFromMonthKey(selectedMonth)));
  renderActorSwitch();
  renderOwnerFilter();
  renderSummary();
  renderFinancialGoal();
  renderMonthlyCheckin();
  renderUrgentList();
  renderPaidList();
  renderAllBills();
  renderCategoryMap();
  renderRevenues();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderActorSwitch() {
  document.querySelectorAll("[data-actor]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.actor === currentActor);
    button.disabled = Boolean(lockedActor && button.dataset.actor !== lockedActor);
  });
}

function renderOwnerFilter() {
  document.querySelectorAll("[data-owner-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.ownerFilter === ownerFilter);
  });
}

async function logout() {
  await apiRequest("/api/logout", { method: "POST" });
  window.location.href = "/login.html";
}

function renderSummary() {
  const monthBills = getVisibleMonthBills();
  const monthRevenues = getVisibleMonthRevenues();
  const totalIncome = sum(monthRevenues, "amount");
  const totalBills = sum(monthBills, "amount");
  const totalPaid = monthBills.reduce((total, bill) => total + (bill.paid ? Number(bill.paidAmount || bill.amount) : 0), 0);
  const pending = Math.max(totalBills - totalPaid, 0);
  const balance = totalIncome - totalBills;

  const items = [
    { label: "Receitas previstas", value: totalIncome, icon: "wallet-cards", tone: "income" },
    { label: "Contas do mes", value: totalBills, icon: "receipt-text", tone: "bills" },
    { label: "Ja pago", value: totalPaid, icon: "badge-check", tone: "paid" },
    { label: "Falta pagar", value: pending, icon: "circle-alert", tone: "pending" },
    { label: "Saldo previsto", value: balance, icon: "landmark", tone: "balance" },
  ];

  elements.summaryGrid.innerHTML = items
    .map(
      (item) => `
        <article class="summary-card ${item.tone}">
          <div class="summary-icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></div>
          <strong>${currency.format(item.value)}</strong>
          <span>${item.label}</span>
        </article>
      `,
    )
    .join("");
}

function renderFinancialGoal() {
  if (!financialGoal) {
    elements.financialGoalStrip.innerHTML = "";
    return;
  }

  const metrics = calculateGoalMetrics(financialGoal);
  elements.financialGoalStrip.innerHTML = `
    <div class="goal-strip">
      <div class="goal-strip-main">
        <div class="goal-strip-heading">
          <span class="goal-icon"><i data-lucide="target"></i></span>
          <div>
            <p class="eyebrow">Rumo a ${currency.format(financialGoal.targetAmount)}</p>
            <h3>${escapeHtml(financialGoal.name)}</h3>
          </div>
        </div>
        <div class="goal-progress" role="progressbar" aria-label="Progresso da meta" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(metrics.progress)}">
          <span style="--goal-progress: ${metrics.progress}%;"></span>
        </div>
        <div class="goal-progress-labels">
          <strong>${currency.format(financialGoal.currentAmount)}</strong>
          <span>${metrics.progress.toFixed(1).replace(".", ",")}% da meta</span>
        </div>
      </div>
      <div class="goal-strip-side">
        <div>
          <span>Ritmo necessario</span>
          <strong>${currency.format(metrics.requiredMonthly)} / mes</strong>
        </div>
        <a class="compact-button" href="./patrimonio.html">
          <i data-lucide="arrow-up-right"></i>
          Abrir meta
        </a>
      </div>
    </div>
  `;
}

function renderMonthlyCheckin() {
  const monthBills = getVisibleMonthBills();
  const monthRevenues = getVisibleMonthRevenues();
  const totalIncome = sum(monthRevenues, "amount");
  const totalBills = sum(monthBills, "amount");
  const totalPaid = monthBills.reduce((total, bill) => total + (bill.paid ? Number(bill.paidAmount || bill.amount) : 0), 0);
  const available = totalIncome - totalBills;
  const commitment = totalIncome > 0 ? (totalBills / totalIncome) * 100 : 0;
  const paymentProgress = totalBills > 0 ? (totalPaid / totalBills) * 100 : 0;
  const overdue = monthBills.filter((bill) => !bill.paid && statusForBill(bill).tone === "overdue");
  const overdueAmount = sum(overdue, "amount");

  elements.monthlyCheckin.innerHTML = `
    <div class="checkin-panel">
      <div class="checkin-header">
        <div>
          <p class="eyebrow">Check-in do casal</p>
          <h3>O que o mes esta dizendo</h3>
        </div>
        <div class="checkin-actions">
          <button class="compact-button" data-quick-action="revenue">
            <i data-lucide="wallet-cards"></i>
            Receita
          </button>
          <button class="compact-button" data-quick-action="bill">
            <i data-lucide="plus"></i>
            Conta
          </button>
        </div>
      </div>
      <div class="checkin-grid">
        <div class="checkin-metric ${available < 0 ? "is-alert" : "is-positive"}">
          <span>Depois das contas</span>
          <strong>${currency.format(available)}</strong>
          <small>${available < 0 ? "Orcamento acima da renda" : "Disponivel no previsto"}</small>
        </div>
        <div class="checkin-metric ${commitment > 80 ? "is-alert" : ""}">
          <span>Renda comprometida</span>
          <strong>${Math.round(commitment)}%</strong>
          <small>${currency.format(totalBills)} em contas</small>
        </div>
        <div class="checkin-metric">
          <span>Pagamentos concluidos</span>
          <strong>${Math.round(paymentProgress)}%</strong>
          <small>${currency.format(totalPaid)} pago</small>
        </div>
      </div>
      <div class="checkin-status ${overdue.length ? "is-alert" : "is-clear"}">
        <i data-lucide="${overdue.length ? "circle-alert" : "circle-check"}"></i>
        <span>${
          overdue.length
            ? `${overdue.length} ${overdue.length === 1 ? "conta atrasada" : "contas atrasadas"}, somando ${currency.format(overdueAmount)}.`
            : "Nenhuma conta atrasada neste recorte."
        }</span>
      </div>
    </div>
  `;
}

function renderUrgentList() {
  const unpaid = getVisibleMonthBills()
    .filter((bill) => !bill.paid)
    .sort((a, b) => dateFromKey(a.dueDate) - dateFromKey(b.dueDate));

  const urgent = unpaid.filter((bill) => ["overdue", "today", "due-soon"].includes(statusForBill(bill).tone));
  const visible = [...urgent, ...unpaid.filter((bill) => !urgent.includes(bill))].slice(0, 6);

  elements.urgentCount.textContent = unpaid.length;
  elements.urgentList.innerHTML = visible.length
    ? visible.map((bill) => billTemplate(bill, { prominentPay: true })).join("")
    : emptyTemplate("Nenhuma conta pendente neste mes.");
}

function renderPaidList() {
  const paid = getVisibleMonthBills()
    .filter((bill) => bill.paid)
    .sort((a, b) => dateFromKey(b.paidDate || b.dueDate) - dateFromKey(a.paidDate || a.dueDate));

  elements.paidCount.textContent = paid.length;
  elements.paidList.innerHTML = paid.length
    ? paid.map((bill) => billTemplate(bill, { compact: true })).join("")
    : emptyTemplate("Nenhum pagamento registrado neste mes.");
}

function renderAllBills() {
  const monthBills = getVisibleMonthBills().sort((a, b) => {
    if (a.paid !== b.paid) return Number(a.paid) - Number(b.paid);
    return dateFromKey(a.dueDate) - dateFromKey(b.dueDate);
  });

  elements.allBillsList.innerHTML = monthBills.length
    ? monthBills.map((bill) => billTemplate(bill)).join("")
    : emptyTemplate("Sem contas cadastradas para este mes.");
}

function renderCategoryMap() {
  const monthBills = getVisibleMonthBills();
  const totals = categories
    .map((category) => ({
      ...category,
      total: monthBills
        .filter((bill) => bill.category === category.name)
        .reduce((current, bill) => current + Number(bill.amount || 0), 0),
    }))
    .filter((category) => category.total > 0)
    .sort((a, b) => b.total - a.total);

  const max = totals[0]?.total || 0;

  elements.categoryMap.innerHTML = totals.length
    ? totals
        .map((category) => {
          const fill = max ? Math.max((category.total / max) * 100, 6) : 0;
          return `
            <div class="category-row">
              <div class="category-line">
                <strong>${category.name}</strong>
                <span>${currency.format(category.total)}</span>
              </div>
              <div class="category-track" aria-hidden="true">
                <div class="category-fill" style="--fill: ${fill}%; --bar: ${category.color};"></div>
              </div>
            </div>
          `;
        })
        .join("")
    : emptyTemplate("Sem categorias para mostrar neste mes.");
}

function renderRevenues() {
  const monthRevenues = getVisibleMonthRevenues().sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));

  elements.revenueList.innerHTML = monthRevenues.length
    ? monthRevenues
        .map(
          (revenue) => `
            <article class="revenue-row" data-id="${revenue.id}">
              <div>
                <strong>${escapeHtml(revenue.name)}</strong>
                <div class="revenue-meta">
                  <span>${formatShortDate(revenue.date)}</span>
                  <span class="owner-pill">${escapeHtml(revenue.owner)}</span>
                  <span>${currency.format(Number(revenue.amount || 0))}</span>
                </div>
              </div>
              <div class="revenue-actions">
                <button class="icon-button" data-action="edit-revenue" title="Editar receita" aria-label="Editar receita">
                  <i data-lucide="pencil"></i>
                </button>
                <button class="icon-button" data-action="delete-revenue" title="Excluir receita" aria-label="Excluir receita">
                  <i data-lucide="trash-2"></i>
                </button>
              </div>
            </article>
          `,
        )
        .join("")
    : emptyTemplate("Sem receitas cadastradas para este mes.");
}

function billTemplate(bill, options = {}) {
  const status = statusForBill(bill);
  const meta = bill.paid
    ? `Pago em ${formatShortDate(bill.paidDate || bill.dueDate)} por ${escapeHtml(bill.paidBy || "Casa")}`
    : `Vence em ${formatShortDate(bill.dueDate)}`;

  const payButton = bill.paid
    ? `
      <button class="icon-button" data-action="undo-payment" title="Desfazer pagamento" aria-label="Desfazer pagamento">
        <i data-lucide="rotate-ccw"></i>
      </button>
    `
    : options.prominentPay
      ? `
        <button class="mark-button" data-action="mark-paid">
          <i data-lucide="check"></i>
          Pagar
        </button>
      `
      : `
        <button class="icon-button" data-action="mark-paid" title="Marcar como pago" aria-label="Marcar como pago">
          <i data-lucide="check"></i>
        </button>
      `;

  return `
    <article class="bill-row ${status.tone}" data-id="${bill.id}">
      <div class="bill-main">
        <div class="bill-title-line">
          <strong>${escapeHtml(bill.name)}</strong>
          <span class="status-pill status-${status.tone}">${status.label}</span>
          <span class="owner-pill">${escapeHtml(bill.owner)}</span>
        </div>
        <div class="bill-meta">
          <span>${escapeHtml(bill.category)}</span>
          <span>${meta}</span>
          <span>${escapeHtml(bill.recurrence)}</span>
          ${bill.notes ? `<span>${escapeHtml(bill.notes)}</span>` : ""}
        </div>
      </div>
      <div class="bill-actions">
        <span class="bill-value">${currency.format(Number(bill.paid ? bill.paidAmount || bill.amount : bill.amount))}</span>
        ${payButton}
        <button class="icon-button" data-action="edit-bill" title="Editar conta" aria-label="Editar conta">
          <i data-lucide="pencil"></i>
        </button>
        <button class="icon-button" data-action="delete-bill" title="Excluir conta" aria-label="Excluir conta">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </article>
  `;
}

function openBillDialog(bill = null) {
  elements.billForm.reset();
  document.querySelector("#billId").value = bill?.id || "";
  elements.billDialogTitle.textContent = bill ? "Editar conta" : "Nova conta";

  document.querySelector("#billName").value = bill?.name || "";
  document.querySelector("#billAmount").value = bill?.amount ?? "";
  document.querySelector("#billDueDate").value = bill?.dueDate || `${selectedMonth}-10`;
  document.querySelector("#billCategory").value = bill?.category || "Moradia";
  document.querySelector("#billOwner").value = bill?.owner || "Ambos";
  document.querySelector("#billRecurrence").value = bill?.recurrence || "Mensal";
  document.querySelector("#billInitialStatus").value = bill?.paid ? "paid" : "pending";
  document.querySelector("#billNotes").value = bill?.notes || "";

  elements.billDialog.showModal();
}

async function saveBillFromForm(event) {
  event.preventDefault();

  try {
    const id = document.querySelector("#billId").value;
    const existing = id ? findBill(id) : null;
    const payload = buildBillPayloadFromForm(existing, id);
    let targetMonth = monthKey(dateFromKey(payload.dueDate));

    if (existing?.isRecurringOccurrence) {
      const scope = await chooseRecurrenceScope("edit", existing);
      if (!scope) return;
      targetMonth = await saveRecurringBillEdit(existing, payload, scope);
    } else {
      await apiRequest("/api/bills", { method: "POST", body: payload });
    }

    setSelectedMonth(targetMonth, { renderNow: false });
    await refreshState();
    elements.billDialog.close();
    render();
    showToast("Conta salva no SQLite.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar a conta.");
  }
}

function openPaymentDialog(id) {
  const bill = findBill(id);
  if (!bill) return;

  document.querySelector("#paymentBillId").value = bill.id;
  document.querySelector("#paymentAmount").value = bill.paidAmount || bill.amount;
  document.querySelector("#paymentDate").value = todayKey();
  document.querySelector("#paymentBy").value = currentActor;
  document.querySelector("#paymentMethod").value = bill.paymentMethod || "Pix";
  document.querySelector("#paymentNotes").value = bill.paymentNotes || "";

  elements.paymentDialog.showModal();
}

async function savePaymentFromForm(event) {
  event.preventDefault();

  try {
    const id = document.querySelector("#paymentBillId").value;
    await apiRequest(`/api/bills/${encodeURIComponent(id)}/payment`, {
      method: "PATCH",
      body: {
        amount: Number(document.querySelector("#paymentAmount").value),
        date: document.querySelector("#paymentDate").value,
        by: document.querySelector("#paymentBy").value,
        method: document.querySelector("#paymentMethod").value,
        notes: document.querySelector("#paymentNotes").value.trim(),
        updatedBy: currentActor,
      },
    });

    await refreshState();
    elements.paymentDialog.close();
    render();
    showToast("Pagamento salvo no banco.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o pagamento.");
  }
}

async function undoPayment(id) {
  await apiRequest(`/api/bills/${encodeURIComponent(id)}/unpay`, {
    method: "PATCH",
    body: { updatedBy: currentActor },
  });
  await refreshState();
  render();
  showToast("Pagamento desfeito.");
}

async function deleteBill(id) {
  const bill = findBill(id);
  if (!bill) return;

  if (bill.isRecurringOccurrence) {
    const scope = await chooseRecurrenceScope("delete", bill);
    if (!scope) return;
    await deleteRecurringBill(bill, scope);
  } else {
    if (!confirm(`Excluir "${bill.name}"?`)) return;
    await apiRequest(`/api/bills/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  await refreshState();
  render();
  showToast("Conta excluida.");
}

function buildBillPayloadFromForm(existing, id) {
  const amount = Number(document.querySelector("#billAmount").value);
  const initialPaid = document.querySelector("#billInitialStatus").value === "paid";
  const paid = existing ? existing.paid || initialPaid : initialPaid;
  const recurrence = document.querySelector("#billRecurrence").value;
  const today = todayKey();

  return {
    id: id || createId(),
    name: document.querySelector("#billName").value.trim(),
    amount,
    dueDate: document.querySelector("#billDueDate").value,
    category: document.querySelector("#billCategory").value,
    owner: document.querySelector("#billOwner").value,
    recurrence,
    recurrenceUntil: recurrence === "Unica" ? null : existing?.recurrenceUntil || null,
    notes: document.querySelector("#billNotes").value.trim(),
    paid,
    paidAmount: existing?.paidAmount || (paid ? amount : null),
    paidDate: existing?.paidDate || (paid ? today : null),
    paidBy: existing?.paidBy || (paid ? currentActor : null),
    paymentMethod: existing?.paymentMethod || (paid ? "Pix" : null),
    paymentNotes: existing?.paymentNotes || "",
    createdBy: existing?.createdBy || currentActor,
    updatedBy: currentActor,
  };
}

async function saveRecurringBillEdit(existing, payload, scope) {
  if (scope === "one") {
    await apiRequest("/api/bill-occurrences", {
      method: "POST",
      body: occurrencePayloadFromBill(existing, payload),
    });
    return existing.competence;
  }

  if (scope === "future") {
    const scopedPayload = scopedPayloadForOccurrenceMonth(existing, payload);
    await apiRequest("/api/recurring-bills/split", {
      method: "POST",
      body: {
        parentId: existing.parentId,
        competence: existing.competence,
        bill: {
          ...scopedPayload,
          id: createId(),
          recurrenceUntil: null,
          createdBy: currentActor,
          updatedBy: currentActor,
        },
      },
    });
    return existing.competence;
  }

  if (scope === "all") {
    await apiRequest("/api/bills", {
      method: "POST",
      body: payloadForWholeRecurrence(existing, payload),
    });
    return existing.competence;
  }

  return monthKey(dateFromKey(payload.dueDate));
}

async function deleteRecurringBill(bill, scope) {
  if (scope === "one") {
    await apiRequest("/api/bill-occurrences", {
      method: "POST",
      body: {
        parentId: bill.parentId,
        competence: bill.competence,
        updatedBy: currentActor,
        deleted: true,
        paid: false,
      },
    });
    return;
  }

  if (scope === "future") {
    await apiRequest(`/api/bills/${encodeURIComponent(bill.parentId)}/recurrence-end`, {
      method: "PATCH",
      body: {
        recurrenceUntil: previousMonthEnd(bill.competence),
        updatedBy: currentActor,
      },
    });
    return;
  }

  if (scope === "all") {
    await apiRequest(`/api/bills/${encodeURIComponent(bill.parentId)}`, { method: "DELETE" });
  }
}

function occurrencePayloadFromBill(existing, payload) {
  const scopedPayload = scopedPayloadForOccurrenceMonth(existing, payload);
  return {
    parentId: existing.parentId,
    competence: existing.competence,
    dueDate: scopedPayload.dueDate,
    amount: scopedPayload.amount,
    category: scopedPayload.category,
    owner: scopedPayload.owner,
    notes: scopedPayload.notes,
    paid: scopedPayload.paid,
    paidAmount: scopedPayload.paid ? scopedPayload.paidAmount || scopedPayload.amount : null,
    paidDate: scopedPayload.paid ? scopedPayload.paidDate || todayKey() : null,
    paidBy: scopedPayload.paid ? scopedPayload.paidBy || currentActor : null,
    paymentMethod: scopedPayload.paid ? scopedPayload.paymentMethod || "Pix" : null,
    paymentNotes: scopedPayload.paid ? scopedPayload.paymentNotes || "" : "",
    updatedBy: currentActor,
    deleted: false,
  };
}

function scopedPayloadForOccurrenceMonth(existing, payload) {
  return {
    ...payload,
    dueDate: dateWithMonthAndDay(existing.competence, payload.dueDate),
  };
}

function payloadForWholeRecurrence(existing, payload) {
  const parent = findBaseBill(existing);
  const parentMonth = monthKey(dateFromKey(parent.dueDate));
  const recurrence = payload.recurrence;

  return {
    ...payload,
    id: parent.id,
    dueDate: dateWithMonthAndDay(parentMonth, payload.dueDate),
    recurrence,
    recurrenceUntil: recurrence === "Unica" ? null : parent.recurrenceUntil || null,
    paid: parent.paid,
    paidAmount: parent.paidAmount,
    paidDate: parent.paidDate,
    paidBy: parent.paidBy,
    paymentMethod: parent.paymentMethod,
    paymentNotes: parent.paymentNotes || "",
    createdBy: parent.createdBy || currentActor,
    updatedBy: currentActor,
  };
}

function chooseRecurrenceScope(action, bill) {
  if (!elements.recurrenceScopeDialog) {
    return Promise.resolve(promptRecurrenceScope(action));
  }

  if (recurrenceScopeResolver) {
    recurrenceScopeResolver(null);
    recurrenceScopeResolver = null;
  }

  elements.recurrenceScopeTitle.textContent = action === "delete" ? "Excluir recorrencia" : "Editar recorrencia";
  elements.recurrenceScopeText.textContent =
    action === "delete"
      ? "Escolha o alcance da exclusao para esta conta recorrente."
      : "Escolha o alcance da alteracao para esta conta recorrente.";
  elements.recurrenceScopeName.textContent = bill.name;
  elements.recurrenceScopeDialog.returnValue = "";
  elements.recurrenceScopeDialog.showModal();

  return new Promise((resolve) => {
    recurrenceScopeResolver = resolve;
  });
}

function promptRecurrenceScope(action) {
  const answer = window.prompt(
    `${action === "delete" ? "Excluir" : "Editar"} recorrencia:\n1 - Apenas esta ocorrencia\n2 - Esta e as proximas\n3 - Toda a recorrencia`,
    "1",
  );
  return { 1: "one", 2: "future", 3: "all" }[String(answer || "").trim()] || null;
}

function openRevenueDialog(revenue = null) {
  elements.revenueForm.reset();
  document.querySelector("#revenueId").value = revenue?.id || "";
  elements.revenueDialogTitle.textContent = revenue ? "Editar receita" : "Nova receita";
  document.querySelector("#revenueName").value = revenue?.name || "";
  document.querySelector("#revenueAmount").value = revenue?.amount ?? "";
  document.querySelector("#revenueDate").value = revenue?.date || `${selectedMonth}-05`;
  document.querySelector("#revenueOwner").value = revenue?.owner || currentActor;
  elements.revenueDialog.showModal();
}

async function saveRevenueFromForm(event) {
  event.preventDefault();

  try {
    const id = document.querySelector("#revenueId").value;
    const payload = {
      id: id || createId(),
      name: document.querySelector("#revenueName").value.trim(),
      amount: Number(document.querySelector("#revenueAmount").value),
      date: document.querySelector("#revenueDate").value,
      owner: document.querySelector("#revenueOwner").value,
    };

    await apiRequest("/api/revenues", { method: "POST", body: payload });
    setSelectedMonth(monthKey(dateFromKey(payload.date)), { renderNow: false });
    await refreshState();
    elements.revenueDialog.close();
    render();
    showToast("Receita salva no SQLite.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar a receita.");
  }
}

async function deleteRevenue(id) {
  const revenue = findRevenue(id);
  if (!revenue) return;
  if (!confirm(`Excluir "${revenue.name}"?`)) return;

  await apiRequest(`/api/revenues/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshState();
  render();
  showToast("Receita excluida.");
}

async function backupDatabase() {
  try {
    const result = await apiRequest("/api/backup", { method: "POST", body: {} });
    showToast(`Backup criado: ${result.backup}`);
  } catch (error) {
    showToast(error.message || "Nao foi possivel criar o backup.");
  }
}

function statusForBill(bill) {
  if (bill.paid) return { label: "Paga", tone: "paid" };

  const due = dateFromKey(bill.dueDate);
  const today = dateFromKey(todayKey());
  const days = Math.round((due - today) / DAY_MS);

  if (days < 0) return { label: "Vencida", tone: "overdue" };
  if (days === 0) return { label: "Vence hoje", tone: "today" };
  if (days <= 5) return { label: "Vence em breve", tone: "due-soon" };
  return { label: "Pendente", tone: "pending" };
}

function getMonthBills() {
  return getBillsForMonth(selectedMonth);
}

function getBillsForMonth(month) {
  const uniqueBills = bills.filter((bill) => bill.recurrence === "Unica" && monthKey(dateFromKey(bill.dueDate)) === month);
  const recurringBills = bills
    .filter((bill) => bill.recurrence !== "Unica" && recurrenceAppliesToMonth(bill, month))
    .map((bill) => buildRecurringOccurrence(bill, month))
    .filter(Boolean);

  return [...uniqueBills, ...recurringBills];
}

function recurrenceAppliesToMonth(bill, month) {
  const start = monthKey(dateFromKey(bill.dueDate));
  if (month < start) return false;
  if (bill.recurrenceUntil && month > monthKey(dateFromKey(bill.recurrenceUntil))) return false;
  if (bill.recurrence === "Mensal") return true;
  if (bill.recurrence === "Anual") return month.slice(5) === start.slice(5);
  return false;
}

function buildRecurringOccurrence(bill, month) {
  const override = findOccurrenceOverride(bill.id, month);
  if (override?.deleted) return null;

  const isBaseMonth = monthKey(dateFromKey(bill.dueDate)) === month;
  const dueDate = override?.dueDate || recurringDueDate(bill.dueDate, month);
  const paid = override ? override.paid : isBaseMonth && bill.paid;

  return {
    ...bill,
    id: occurrenceId(bill.id, month),
    parentId: bill.id,
    competence: month,
    isRecurringOccurrence: true,
    dueDate,
    amount: override?.amount ?? bill.amount,
    category: override?.category || bill.category,
    owner: override?.owner || bill.owner,
    notes: override?.notes ?? bill.notes,
    paid,
    paidAmount: paid ? override?.paidAmount ?? (isBaseMonth ? bill.paidAmount : null) : null,
    paidDate: paid ? override?.paidDate ?? (isBaseMonth ? bill.paidDate : null) : null,
    paidBy: paid ? override?.paidBy ?? (isBaseMonth ? bill.paidBy : null) : null,
    paymentMethod: paid ? override?.paymentMethod ?? (isBaseMonth ? bill.paymentMethod : null) : null,
    paymentNotes: paid ? override?.paymentNotes ?? (isBaseMonth ? bill.paymentNotes : "") : "",
    updatedBy: override?.updatedBy || bill.updatedBy,
  };
}

function findOccurrenceOverride(parentId, competence) {
  return billOccurrences.find((item) => item.parentId === parentId && item.competence === competence);
}

function recurringDueDate(baseDueDate, month) {
  const [, , originalDayRaw] = baseDueDate.split("-").map(Number);
  return dateWithMonthAndDay(month, originalDayRaw);
}

function dateWithMonthAndDay(month, daySource) {
  const originalDayRaw = typeof daySource === "number" ? daySource : Number(String(daySource || "").slice(8, 10));
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  const day = Math.min(originalDayRaw, lastDay);
  return `${month}-${String(day).padStart(2, "0")}`;
}

function occurrenceId(parentId, competence) {
  return `occ:${parentId}:${competence}`;
}

function previousMonthEnd(competence) {
  const [year, month] = competence.split("-").map(Number);
  const date = new Date(year, month - 1, 0);
  return dateKey(date);
}

function getMonthRevenues() {
  return revenues.filter((revenue) => monthKey(dateFromKey(revenue.date)) === selectedMonth);
}

function getVisibleMonthBills() {
  return getMonthBills().filter(ownerMatchesFilter);
}

function getVisibleMonthRevenues() {
  return getMonthRevenues().filter(ownerMatchesFilter);
}

function ownerMatchesFilter(item) {
  if (ownerFilter === "Todos") return true;
  if (ownerFilter === "Ambos") return item.owner === "Ambos";
  return item.owner === ownerFilter || item.owner === "Ambos";
}

function shiftMonth(amount) {
  const date = dateFromMonthKey(selectedMonth);
  date.setMonth(date.getMonth() + amount);
  setSelectedMonth(monthKey(date));
}

function setSelectedMonth(value, options = { renderNow: true }) {
  selectedMonth = value;
  localStorage.setItem(STORAGE_KEYS.selectedMonth, selectedMonth);
  if (options.renderNow) render();
}

function populateCategoryOptions() {
  const select = document.querySelector("#billCategory");
  select.innerHTML = categories.map((category) => `<option value="${category.name}">${category.name}</option>`).join("");
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

function createDemoData() {
  const month = monthKey(new Date());
  const date = (day) => `${month}-${String(day).padStart(2, "0")}`;

  return {
    bills: [
      createBillSeed("Aluguel", 3000, date(5), "Moradia", "Ambos", "Apartamento"),
      createBillSeed("Internet", 120, date(10), "Moradia", "Ambos"),
      createBillSeed("Cartao Andre", 2400, date(12), "Cartao", "Andre"),
      createBillSeed("Condominio", 900, date(2), "Moradia", "Ambos", "", {
        paid: true,
        paidBy: "Luciana",
        paymentMethod: "Pix",
      }),
      createBillSeed("Netflix", 55, date(3), "Assinaturas", "Ambos", "", {
        paid: true,
        paidBy: "Andre",
        paymentMethod: "Credito",
      }),
      createBillSeed("Mercado", 1250, date(8), "Mercado", "Ambos", "Previsao"),
      createBillSeed("Plano de saude", 780, date(15), "Saude", "Ambos"),
    ],
    revenues: [
      { id: createId(), name: "Salario Andre", amount: 21000, date: date(5), owner: "Andre" },
      { id: createId(), name: "Salario Luciana", amount: 15000, date: date(5), owner: "Luciana" },
      { id: createId(), name: "Outras entradas", amount: 4000, date: date(15), owner: "Ambos" },
    ],
  };
}

function createBillSeed(name, amount, dueDate, category, owner, notes = "", payment = {}) {
  const paid = Boolean(payment.paid);
  return {
    id: createId(),
    name,
    amount,
    dueDate,
    category,
    owner,
    recurrence: "Mensal",
    notes,
    paid,
    paidAmount: paid ? amount : null,
    paidDate: paid ? dueDate : null,
    paidBy: paid ? payment.paidBy : null,
    paymentMethod: paid ? payment.paymentMethod || "Pix" : null,
    paymentNotes: "",
    createdBy: payment.paidBy || "Andre",
    updatedBy: payment.paidBy || "Andre",
  };
}

function saveLocalSnapshot() {
  if (pendingLocalRecovery) return;
  localStorage.setItem(STORAGE_KEYS.bills, JSON.stringify(bills));
  localStorage.setItem(STORAGE_KEYS.revenues, JSON.stringify(revenues));
}

function loadCollection(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
}

function isLocalHost() {
  return ["localhost", "127.0.0.1", ""].includes(window.location.hostname);
}

function snapshotsDiffer(localSnapshot, databaseSnapshot) {
  return stableSnapshot(localSnapshot) !== stableSnapshot(databaseSnapshot);
}

function stableSnapshot(snapshot) {
  return JSON.stringify({
    bills: normalizeSnapshotItems(snapshot.bills, ["id", "name", "amount", "dueDate", "category", "owner", "recurrence", "notes", "paid", "paidAmount", "paidDate", "paidBy"]),
    revenues: normalizeSnapshotItems(snapshot.revenues, ["id", "name", "amount", "date", "owner"]),
  });
}

function normalizeSnapshotItems(items, keys) {
  return (Array.isArray(items) ? items : [])
    .map((item) =>
      keys.reduce((result, key) => {
        result[key] = item[key] ?? null;
        return result;
      }, {}),
    )
    .sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
}

function findBill(id) {
  return getMonthBills().find((bill) => bill.id === id) || bills.find((bill) => bill.id === id);
}

function findBaseBill(bill) {
  const parent = bills.find((item) => item.id === bill.parentId || item.id === bill.id);
  if (!parent) throw new Error("Conta base da recorrencia nao encontrada.");
  return parent;
}

function findRevenue(id) {
  return revenues.find((revenue) => revenue.id === id);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function calculateGoalMetrics(goal) {
  const target = dateFromKey(goal.targetDate);
  target.setHours(23, 59, 59, 999);
  const now = new Date();
  const daysRemaining = Math.max(Math.ceil((target.getTime() - now.getTime()) / DAY_MS), 0);
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

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayKey() {
  return dateKey(new Date());
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromMonthKey(key) {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function dateFromKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatShortDate(key) {
  return shortDateFormatter.format(dateFromKey(key));
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
  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 5200);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
