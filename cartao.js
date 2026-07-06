const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const monthFormatter = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
});

const categoryColors = {
  Alimentacao: "#d96c63",
  Assinaturas: "#6c69b1",
  Casa: "#2478c7",
  Compras: "#3f95dc",
  Educacao: "#4d789f",
  Lazer: "#c38a2e",
  Mercado: "#2f8b80",
  Saude: "#bf5b64",
  Transporte: "#2f8b80",
  Viagem: "#9b6a4b",
  Outros: "#7c8fa3",
};

let statements = [];
let selectedStatementId = null;
let previewStatement = null;
let currentActor = "Andre";
let toastTimer = null;

const elements = {
  statementTitle: document.querySelector("#statementTitle"),
  statementSelect: document.querySelector("#statementSelect"),
  deleteStatement: document.querySelector("#deleteStatement"),
  summary: document.querySelector("#cardSummary"),
  insights: document.querySelector("#cardInsights"),
  categoryMap: document.querySelector("#cardCategoryMap"),
  merchantMap: document.querySelector("#merchantMap"),
  transactionList: document.querySelector("#transactionList"),
  transactionSearch: document.querySelector("#transactionSearch"),
  categoryFilter: document.querySelector("#categoryFilter"),
  statementForm: document.querySelector("#statementForm"),
  statementLabel: document.querySelector("#statementLabel"),
  cardName: document.querySelector("#cardName"),
  closingDate: document.querySelector("#closingDate"),
  dueDate: document.querySelector("#dueDate"),
  statementPaste: document.querySelector("#statementPaste"),
  previewStatement: document.querySelector("#previewStatement"),
  previewCount: document.querySelector("#previewCount"),
  backupDatabase: document.querySelector("#backupDatabase"),
  logoutButton: document.querySelector("#logoutButton"),
  toast: document.querySelector("#toast"),
};

initialize();

async function initialize() {
  setDefaultFormValues();
  bindEvents();
  renderLoading();

  try {
    await syncSessionActor();
    await refreshStatements();
    render();
  } catch (error) {
    renderError(error);
  }
}

async function syncSessionActor() {
  const session = await apiRequest("/api/session");
  if (!session.user?.actor) return;

  currentActor = session.user.actor;
  localStorage.setItem("plannerFinanceiro:actor", currentActor);
}

function bindEvents() {
  elements.backupDatabase.addEventListener("click", () => backupDatabase());
  elements.logoutButton.addEventListener("click", () => logout());
  elements.statementSelect.addEventListener("change", () => {
    selectedStatementId = elements.statementSelect.value || null;
    previewStatement = null;
    render();
  });
  elements.deleteStatement.addEventListener("click", () => deleteSelectedStatement());
  elements.previewStatement.addEventListener("click", () => previewCurrentPaste());
  elements.statementForm.addEventListener("submit", saveStatementFromForm);
  elements.transactionSearch.addEventListener("input", () => renderTransactions());
  elements.categoryFilter.addEventListener("change", () => renderTransactions());
}

function setDefaultFormValues() {
  const now = new Date();
  elements.statementLabel.value = `Fatura ${capitalize(monthFormatter.format(now))}`;
  elements.closingDate.value = dateKey(now);

  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 10);
  elements.dueDate.value = dateKey(dueDate);
}

async function refreshStatements() {
  const state = await apiRequest("/api/card-statements");
  statements = Array.isArray(state.statements) ? state.statements : [];

  if (!selectedStatementId || !statements.some((statement) => statement.id === selectedStatementId)) {
    selectedStatementId = statements[0]?.id || null;
  }
}

function renderLoading() {
  elements.summary.innerHTML = "";
  elements.insights.innerHTML = emptyTemplate("Carregando leitura do cartao...");
  elements.categoryMap.innerHTML = emptyTemplate("Carregando categorias...");
  elements.merchantMap.innerHTML = emptyTemplate("Carregando estabelecimentos...");
  elements.transactionList.innerHTML = emptyTemplate("Carregando faturas...");
}

function renderError(error) {
  const message = error.message || "Nao foi possivel carregar o cartao.";
  elements.summary.innerHTML = "";
  elements.insights.innerHTML = emptyTemplate(message);
  elements.categoryMap.innerHTML = emptyTemplate(message);
  elements.merchantMap.innerHTML = emptyTemplate(message);
  elements.transactionList.innerHTML = emptyTemplate(message);
  showToast(message);
}

function render() {
  const statement = getActiveStatement();
  const transactions = statement?.transactions || [];

  renderStatementSelect();
  elements.statementTitle.textContent = statement ? statement.label : "Nenhuma fatura importada";
  elements.deleteStatement.disabled = !selectedStatementId || Boolean(previewStatement);
  elements.previewCount.textContent = `${transactions.length} ${transactions.length === 1 ? "linha" : "linhas"}`;

  renderSummary(statement, transactions);
  renderInsights(transactions);
  renderCategoryMap(transactions);
  renderMerchantMap(transactions);
  renderCategoryFilter(transactions);
  renderTransactions();

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function renderStatementSelect() {
  const options = statements
    .map((statement) => `<option value="${statement.id}">${escapeHtml(statement.label)}</option>`)
    .join("");
  const previewOption = previewStatement ? `<option value="preview">Previa: ${escapeHtml(previewStatement.label)}</option>` : "";

  elements.statementSelect.innerHTML = `${previewOption}${options}`;
  elements.statementSelect.value = previewStatement ? "preview" : selectedStatementId || "";
  elements.statementSelect.disabled = !statements.length && !previewStatement;
}

function renderSummary(statement, transactions) {
  const total = sum(transactions, "amount");
  const average = transactions.length ? total / transactions.length : 0;
  const biggest = transactions.reduce((max, item) => (Number(item.amount) > Number(max?.amount || 0) ? item : max), null);
  const categories = totalsBy(transactions, (item) => item.category);
  const topCategory = categories[0];

  const items = [
    { label: "Total da fatura", value: total, icon: "credit-card", tone: "paid" },
    { label: "Compras", value: transactions.length, icon: "list-checks", tone: "balance", count: true },
    { label: "Ticket medio", value: average, icon: "receipt-text", tone: "bills" },
    { label: "Maior gasto", value: biggest?.amount || 0, icon: "circle-alert", tone: "pending" },
    { label: topCategory?.name || "Categoria lider", value: topCategory?.total || 0, icon: "chart-no-axes-column-increasing", tone: "income" },
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

  if (statement) {
    elements.statementTitle.textContent = `${statement.label} · ${currency.format(total)}`;
  }
}

function renderInsights(transactions) {
  if (!transactions.length) {
    elements.insights.innerHTML = emptyTemplate("Sem fatura importada ainda.");
    return;
  }

  const total = Math.max(sum(transactions, "amount"), 0);
  const categories = totalsBy(transactions, (item) => item.category);
  const merchants = totalsBy(transactions, (item) => normalizeMerchant(item.description));
  const biggest = transactions.reduce((max, item) => (Number(item.amount) > Number(max?.amount || 0) ? item : max), null);
  const recurring = merchants.filter((item) => item.count >= 2);
  const topCategory = categories[0];
  const topCategoryShare = total && topCategory ? Math.round((topCategory.total / total) * 100) : 0;

  const insights = [
    {
      icon: "pie-chart",
      title: topCategory ? `${topCategory.name} concentra ${topCategoryShare}%` : "Categorias equilibradas",
      body: topCategory ? `${currency.format(topCategory.total)} em ${topCategory.count} lancamentos.` : "Poucas linhas para comparar categorias.",
    },
    {
      icon: "badge-alert",
      title: biggest ? `Maior gasto: ${biggest.description}` : "Sem maior gasto",
      body: biggest ? `${currency.format(biggest.amount)} em ${formatShortDate(biggest.purchaseDate)}.` : "Importe uma fatura para ver destaques.",
    },
    {
      icon: "repeat-2",
      title: recurring.length ? `${recurring.length} recorrencias aparentes` : "Sem recorrencia forte",
      body: recurring.length ? `${recurring[0].name}: ${currency.format(recurring[0].total)} em ${recurring[0].count} linhas.` : "Nenhum estabelecimento apareceu mais de uma vez.",
    },
  ];

  elements.insights.innerHTML = insights
    .map(
      (item) => `
        <article class="insight-item">
          <div class="summary-icon" aria-hidden="true"><i data-lucide="${item.icon}"></i></div>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.body)}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderCategoryMap(transactions) {
  const categories = totalsBy(transactions, (item) => item.category).map((item) => ({
    ...item,
    color: categoryColors[item.name] || categoryColors.Outros,
  }));

  elements.categoryMap.innerHTML = barMapTemplate(categories, "Sem categorias para mostrar.");
}

function renderMerchantMap(transactions) {
  const merchants = totalsBy(transactions, (item) => normalizeMerchant(item.description)).slice(0, 8).map((item) => ({
    ...item,
    color: "#2478c7",
  }));

  elements.merchantMap.innerHTML = barMapTemplate(merchants, "Sem estabelecimentos para mostrar.");
}

function renderCategoryFilter(transactions) {
  const current = elements.categoryFilter.value;
  const categories = [...new Set(transactions.map((item) => item.category))].sort((a, b) => a.localeCompare(b));
  elements.categoryFilter.innerHTML = [
    `<option value="">Todas</option>`,
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
  ].join("");
  elements.categoryFilter.value = categories.includes(current) ? current : "";
}

function renderTransactions() {
  const statement = getActiveStatement();
  const query = normalizeText(elements.transactionSearch.value);
  const category = elements.categoryFilter.value;
  const transactions = (statement?.transactions || [])
    .filter((item) => !category || item.category === category)
    .filter((item) => {
      if (!query) return true;
      return normalizeText(`${item.description} ${item.category} ${item.owner} ${item.notes}`).includes(query);
    })
    .sort((a, b) => dateFromKey(a.purchaseDate) - dateFromKey(b.purchaseDate));

  elements.transactionList.innerHTML = transactions.length
    ? transactions.map(transactionTemplate).join("")
    : emptyTemplate("Nenhum gasto encontrado nesta fatura.");

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function transactionTemplate(item) {
  const color = categoryColors[item.category] || categoryColors.Outros;
  return `
    <article class="transaction-row" style="--row-color: ${color};">
      <div class="bill-main">
        <div class="bill-title-line">
          <strong>${escapeHtml(item.description)}</strong>
          <span class="status-pill" style="color: ${color}; background: ${softColor(color)};">${escapeHtml(item.category)}</span>
          <span class="owner-pill">${escapeHtml(item.owner)}</span>
        </div>
        <div class="bill-meta">
          <span>${formatShortDate(item.purchaseDate)}</span>
          ${item.installments ? `<span>${escapeHtml(item.installments)}</span>` : ""}
          ${item.notes ? `<span>${escapeHtml(item.notes)}</span>` : ""}
        </div>
      </div>
      <div class="bill-actions">
        <span class="bill-value">${currency.format(Number(item.amount || 0))}</span>
      </div>
    </article>
  `;
}

function previewCurrentPaste() {
  try {
    previewStatement = buildStatementFromForm();
    render();
    showToast("Previa montada com os dados colados.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel ler a fatura.");
  }
}

async function saveStatementFromForm(event) {
  event.preventDefault();

  try {
    const statement = buildStatementFromForm();
    await apiRequest("/api/card-statements", { method: "POST", body: statement });
    previewStatement = null;
    elements.statementPaste.value = "";
    selectedStatementId = statement.id;
    await refreshStatements();
    render();
    showToast("Fatura salva no SQLite.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar a fatura.");
  }
}

function buildStatementFromForm() {
  const transactions = parseStatementText(elements.statementPaste.value);
  return {
    id: createId(),
    label: elements.statementLabel.value.trim(),
    cardName: elements.cardName.value.trim(),
    closingDate: elements.closingDate.value,
    dueDate: elements.dueDate.value,
    importedBy: currentActor,
    transactions,
  };
}

async function deleteSelectedStatement() {
  const statement = statements.find((item) => item.id === selectedStatementId);
  if (!statement) return;
  if (!confirm(`Excluir "${statement.label}"?`)) return;

  await apiRequest(`/api/card-statements/${encodeURIComponent(statement.id)}`, { method: "DELETE" });
  selectedStatementId = null;
  await refreshStatements();
  render();
  showToast("Fatura excluida.");
}

function getActiveStatement() {
  return previewStatement || statements.find((statement) => statement.id === selectedStatementId) || null;
}

function parseStatementText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) throw new Error("Cole as linhas da fatura antes de continuar.");

  const rows = parseRows(lines);
  if (!rows.length) throw new Error("Nao encontrei linhas validas para importar.");

  const headerMap = detectHeader(rows[0]);
  const dataRows = headerMap ? rows.slice(1) : rows;
  const columns = headerMap || defaultColumnMap();
  const transactions = dataRows
    .filter((row) => row.some(Boolean))
    .map((row) => rowToTransaction(row, columns))
    .filter(Boolean);

  if (!transactions.length) throw new Error("Nao consegui converter nenhuma linha da fatura.");
  return transactions;
}

function parseRows(lines) {
  if (lines.some((line) => line.includes("|"))) {
    return lines
      .filter((line) => !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line))
      .map((line) =>
        line
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim()),
      );
  }

  const delimiter = detectDelimiter(lines[0]);
  return lines.map((line) => splitDelimitedLine(line, delimiter).map((cell) => cell.trim()));
}

function detectDelimiter(line) {
  if (line.includes("\t")) return "\t";
  const semicolons = (line.match(/;/g) || []).length;
  const commas = (line.match(/,/g) || []).length;
  return semicolons >= commas ? ";" : ",";
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function detectHeader(row) {
  const map = row.reduce((result, label, index) => {
    const key = headerKey(label);
    if (key) result[key] = index;
    return result;
  }, {});

  return map.purchaseDate != null && map.description != null && map.amount != null ? map : null;
}

function defaultColumnMap() {
  return {
    purchaseDate: 0,
    description: 1,
    category: 2,
    amount: 3,
    installments: 4,
    owner: 5,
    notes: 6,
  };
}

function headerKey(label) {
  const text = normalizeText(label);
  if (["data", "date", "compra", "purchase date"].includes(text)) return "purchaseDate";
  if (["descricao", "descrição", "historico", "histórico", "estabelecimento", "merchant", "nome", "lancamento", "lançamento"].includes(text)) return "description";
  if (["categoria", "category", "grupo"].includes(text)) return "category";
  if (["valor", "amount", "total", "preco", "preço"].includes(text)) return "amount";
  if (["parcela", "parcelas", "installments", "parcelamento"].includes(text)) return "installments";
  if (["responsavel", "responsável", "owner", "dono", "pessoa"].includes(text)) return "owner";
  if (["obs", "observacao", "observação", "notes", "nota"].includes(text)) return "notes";
  return "";
}

function rowToTransaction(row, columns) {
  const description = cell(row, columns.description);
  const rawAmount = cell(row, columns.amount);
  const purchaseDate = parseDate(cell(row, columns.purchaseDate));

  if (!description || !rawAmount || !purchaseDate) return null;

  const category = cell(row, columns.category) || categorizeDescription(description);
  return {
    id: createId(),
    purchaseDate,
    description,
    category,
    amount: parseMoney(rawAmount),
    installments: cell(row, columns.installments),
    owner: normalizeOwner(cell(row, columns.owner)),
    notes: cell(row, columns.notes),
  };
}

function cell(row, index) {
  return index == null ? "" : String(row[index] || "").trim();
}

function parseDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{1,2})[/. -](\d{1,2})(?:[/. -](\d{2,4}))?$/);
  if (!match) return "";

  const reference = elements.dueDate.value || elements.closingDate.value || dateKey(new Date());
  const referenceYear = Number(reference.slice(0, 4));
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : referenceYear;

  if (!day || !month || month > 12 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseMoney(value) {
  let text = String(value || "").trim();
  const negative = text.includes("-") || text.includes("(");
  text = text.replace(/[^\d,.\-]/g, "").replace(/-/g, "");

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");

  if (comma > dot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (dot > comma && comma !== -1) {
    text = text.replace(/,/g, "");
  } else if (comma !== -1) {
    text = text.replace(",", ".");
  } else if (dot !== -1) {
    const decimals = text.length - dot - 1;
    if (decimals === 3) text = text.replace(/\./g, "");
  }

  const amount = Number(text);
  if (!Number.isFinite(amount)) throw new Error(`Valor invalido: ${value}`);
  return negative ? -amount : amount;
}

function normalizeOwner(value) {
  const text = normalizeText(value);
  if (text === "andre" || text === "andré") return "Andre";
  if (text === "luciana") return "Luciana";
  return "Ambos";
}

function categorizeDescription(description) {
  const text = normalizeText(description);
  if (/(ifood|restaurante|pizza|padaria|caf[eé]|burger|lanche)/.test(text)) return "Alimentacao";
  if (/(mercado|supermercado|atacadao|assai|carrefour|paodeacucar|pao de acucar)/.test(text)) return "Mercado";
  if (/(uber|99|posto|combustivel|estacionamento|sem parar|pedagio)/.test(text)) return "Transporte";
  if (/(farmacia|drogaria|hospital|clinica|laboratorio|saude)/.test(text)) return "Saude";
  if (/(netflix|spotify|amazon prime|prime video|google|apple|microsoft|icloud|assinatura)/.test(text)) return "Assinaturas";
  if (/(cinema|teatro|show|livraria|ingresso|lazer)/.test(text)) return "Lazer";
  if (/(hotel|airbnb|azul|latam|gol|booking|viagem)/.test(text)) return "Viagem";
  if (/(curso|escola|faculdade|educacao|educação)/.test(text)) return "Educacao";
  if (/(casa|construcao|construção|decor|mobly|leroy)/.test(text)) return "Casa";
  if (/(magazine|amazon|mercadolivre|shopee|shein|loja)/.test(text)) return "Compras";
  return "Outros";
}

function totalsBy(items, keyFn) {
  const map = items.reduce((result, item) => {
    const name = keyFn(item) || "Outros";
    if (!result.has(name)) result.set(name, { name, total: 0, count: 0 });
    const current = result.get(name);
    current.total += Number(item.amount || 0);
    current.count += 1;
    return result;
  }, new Map());

  return [...map.values()].sort((a, b) => b.total - a.total);
}

function barMapTemplate(items, emptyMessage) {
  if (!items.length) return emptyTemplate(emptyMessage);

  const max = Math.max(...items.map((item) => Math.abs(item.total)), 0);
  return items
    .map((item) => {
      const fill = max ? Math.max((Math.abs(item.total) / max) * 100, 6) : 0;
      return `
        <div class="category-row">
          <div class="category-line">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${currency.format(item.total)}</span>
          </div>
          <div class="category-track" aria-hidden="true">
            <div class="category-fill" style="--fill: ${fill}%; --bar: ${item.color || categoryColors.Outros};"></div>
          </div>
        </div>
      `;
    })
    .join("");
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

function sum(items, key) {
  return items.reduce((total, item) => total + Number(item[key] || 0), 0);
}

function normalizeMerchant(value) {
  return String(value || "")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

function softColor(hex) {
  const value = hex.replace("#", "");
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, 0.14)`;
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
