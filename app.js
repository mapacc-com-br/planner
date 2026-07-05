const STORAGE_KEYS = {
  bills: "plannerFinanceiro:bills",
  revenues: "plannerFinanceiro:revenues",
  actor: "plannerFinanceiro:actor",
  selectedMonth: "plannerFinanceiro:selectedMonth",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CATEGORIES = [
  { name: "Moradia", color: "#2f7d5c" },
  { name: "Cartao", color: "#5f5aa2" },
  { name: "Mercado", color: "#2d6f95" },
  { name: "Saude", color: "#b64c57" },
  { name: "Transporte", color: "#72844b" },
  { name: "Assinaturas", color: "#b9792d" },
  { name: "Educacao", color: "#6d6f78" },
  { name: "Lazer", color: "#8860a8" },
  { name: "Impostos", color: "#9a5a42" },
  { name: "Investimentos", color: "#287276" },
  { name: "Outros", color: "#697377" },
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
let revenues = [];
let selectedMonth = localStorage.getItem(STORAGE_KEYS.selectedMonth) || monthKey(new Date());
let currentActor = localStorage.getItem(STORAGE_KEYS.actor) || "Andre";
let toastTimer = null;
let pendingLocalRecovery = null;

const elements = {
  summaryGrid: document.querySelector("#summaryGrid"),
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
  revenueDialog: document.querySelector("#revenueDialog"),
  revenueForm: document.querySelector("#revenueForm"),
  revenueDialogTitle: document.querySelector("#revenueDialogTitle"),
  toast: document.querySelector("#toast"),
  recoverLocalStorage: document.querySelector("#recoverLocalStorage"),
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
      currentActor = button.dataset.actor;
      localStorage.setItem(STORAGE_KEYS.actor, currentActor);
      render();
    });
  });

  document.addEventListener("click", async (event) => {
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
}

async function loadInitialState() {
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

  const seed = hasLocalData ? localSnapshot : createDemoData();
  const imported = await apiRequest("/api/import-local", {
    method: "POST",
    body: seed,
  });

  applyState(imported);
  saveLocalSnapshot();
}

async function refreshState() {
  const state = await apiRequest("/api/state");
  applyState(state);
  saveLocalSnapshot();
}

function applyState(state) {
  bills = Array.isArray(state.bills) ? state.bills : [];
  revenues = Array.isArray(state.revenues) ? state.revenues : [];
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
  elements.urgentList.innerHTML = emptyTemplate("Carregando dados do SQLite...");
  elements.paidList.innerHTML = emptyTemplate("Carregando pagamentos...");
  elements.allBillsList.innerHTML = emptyTemplate("Carregando contas...");
  elements.revenueList.innerHTML = emptyTemplate("Carregando receitas...");
  elements.categoryMap.innerHTML = emptyTemplate("Carregando categorias...");
}

function renderFatalError(error) {
  const message = error.message || "Nao foi possivel abrir o banco de dados.";
  elements.summaryGrid.innerHTML = "";
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
  renderSummary();
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
  });
}

function renderSummary() {
  const monthBills = getMonthBills();
  const monthRevenues = getMonthRevenues();
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

function renderUrgentList() {
  const unpaid = getMonthBills()
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
  const paid = getMonthBills()
    .filter((bill) => bill.paid)
    .sort((a, b) => dateFromKey(b.paidDate || b.dueDate) - dateFromKey(a.paidDate || a.dueDate));

  elements.paidCount.textContent = paid.length;
  elements.paidList.innerHTML = paid.length
    ? paid.map((bill) => billTemplate(bill, { compact: true })).join("")
    : emptyTemplate("Nenhum pagamento registrado neste mes.");
}

function renderAllBills() {
  const monthBills = getMonthBills().sort((a, b) => {
    if (a.paid !== b.paid) return Number(a.paid) - Number(b.paid);
    return dateFromKey(a.dueDate) - dateFromKey(b.dueDate);
  });

  elements.allBillsList.innerHTML = monthBills.length
    ? monthBills.map((bill) => billTemplate(bill)).join("")
    : emptyTemplate("Sem contas cadastradas para este mes.");
}

function renderCategoryMap() {
  const monthBills = getMonthBills();
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
  const monthRevenues = getMonthRevenues().sort((a, b) => dateFromKey(a.date) - dateFromKey(b.date));

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
    const initialPaid = document.querySelector("#billInitialStatus").value === "paid";
    const paid = existing ? existing.paid || initialPaid : initialPaid;
    const today = todayKey();

    const payload = {
      id: id || createId(),
      name: document.querySelector("#billName").value.trim(),
      amount: Number(document.querySelector("#billAmount").value),
      dueDate: document.querySelector("#billDueDate").value,
      category: document.querySelector("#billCategory").value,
      owner: document.querySelector("#billOwner").value,
      recurrence: document.querySelector("#billRecurrence").value,
      notes: document.querySelector("#billNotes").value.trim(),
      paid,
      paidAmount: existing?.paidAmount || (paid ? Number(document.querySelector("#billAmount").value) : null),
      paidDate: existing?.paidDate || (paid ? today : null),
      paidBy: existing?.paidBy || (paid ? currentActor : null),
      paymentMethod: existing?.paymentMethod || (paid ? "Pix" : null),
      paymentNotes: existing?.paymentNotes || "",
      createdBy: existing?.createdBy || currentActor,
      updatedBy: currentActor,
    };

    await apiRequest("/api/bills", { method: "POST", body: payload });
    setSelectedMonth(monthKey(dateFromKey(payload.dueDate)), { renderNow: false });
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
  if (!confirm(`Excluir "${bill.name}"?`)) return;

  await apiRequest(`/api/bills/${encodeURIComponent(id)}`, { method: "DELETE" });
  await refreshState();
  render();
  showToast("Conta excluida.");
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
  return bills.filter((bill) => monthKey(dateFromKey(bill.dueDate)) === selectedMonth);
}

function getMonthRevenues() {
  return revenues.filter((revenue) => monthKey(dateFromKey(revenue.date)) === selectedMonth);
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
  return bills.find((bill) => bill.id === id);
}

function findRevenue(id) {
  return revenues.find((revenue) => revenue.id === id);
}

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
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
