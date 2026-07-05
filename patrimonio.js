const currency = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const assetTypes = [
  { name: "Investimento", color: "#2f7d5c", icon: "line-chart" },
  { name: "Reserva", color: "#2d6f95", icon: "wallet" },
  { name: "Imovel", color: "#5f5aa2", icon: "house" },
  { name: "Veiculo", color: "#b9792d", icon: "car" },
  { name: "Conta", color: "#287276", icon: "landmark" },
  { name: "Outros", color: "#697377", icon: "archive" },
];

let assets = [];
let toastTimer = null;

const elements = {
  summary: document.querySelector("#patrimonySummary"),
  assetList: document.querySelector("#assetList"),
  assetTypeMap: document.querySelector("#assetTypeMap"),
  liquidityMap: document.querySelector("#liquidityMap"),
  assetDialog: document.querySelector("#assetDialog"),
  assetForm: document.querySelector("#assetForm"),
  assetDialogTitle: document.querySelector("#assetDialogTitle"),
  toast: document.querySelector("#toast"),
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
      if (button.dataset.action === "edit-asset") openAssetDialog(findAsset(id));
      if (button.dataset.action === "delete-asset") await deleteAsset(id);
    } catch (error) {
      showToast(error.message || "Nao foi possivel concluir a acao.");
    }
  });

  elements.assetForm.addEventListener("submit", saveAssetFromForm);
}

async function refreshAssets() {
  const state = await apiRequest("/api/patrimony");
  assets = Array.isArray(state.assets) ? state.assets : [];
}

function renderLoading() {
  elements.summary.innerHTML = "";
  elements.assetList.innerHTML = emptyTemplate("Carregando patrimonio...");
  elements.assetTypeMap.innerHTML = emptyTemplate("Carregando tipos...");
  elements.liquidityMap.innerHTML = emptyTemplate("Carregando liquidez...");
}

function renderError(error) {
  const message = error.message || "Nao foi possivel carregar o patrimonio.";
  elements.assetList.innerHTML = emptyTemplate(message);
  elements.assetTypeMap.innerHTML = emptyTemplate(message);
  elements.liquidityMap.innerHTML = emptyTemplate(message);
  showToast(message);
}

function render() {
  renderSummary();
  renderAssetTypeMap();
  renderLiquidityMap();
  renderAssets();

  if (window.lucide) {
    window.lucide.createIcons();
  }
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
  const colors = ["#2f7d5c", "#2d6f95", "#b9792d", "#5f5aa2", "#697377"];
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

function assetTemplate(asset) {
  const type = assetTypes.find((item) => item.name === asset.assetType) || assetTypes.at(-1);
  const gain = asset.investedValue == null ? null : Number(asset.currentValue) - Number(asset.investedValue);

  return `
    <article class="asset-row ${slug(asset.assetType)}" data-id="${asset.id}">
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
          ${gain == null ? "" : `<span>Resultado: ${currency.format(gain)}</span>`}
          ${asset.notes ? `<span>${escapeHtml(asset.notes)}</span>` : ""}
        </div>
      </div>
      <div class="asset-actions">
        <span class="asset-value">${currency.format(Number(asset.currentValue || 0))}</span>
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
  document.querySelector("#assetNotes").value = asset?.notes || "";

  elements.assetDialog.showModal();
}

async function saveAssetFromForm(event) {
  event.preventDefault();

  try {
    const payload = {
      id: document.querySelector("#assetId").value || createId(),
      name: document.querySelector("#assetName").value.trim(),
      assetType: document.querySelector("#assetType").value,
      institution: document.querySelector("#assetInstitution").value.trim(),
      currentValue: Number(document.querySelector("#assetCurrentValue").value),
      investedValue: document.querySelector("#assetInvestedValue").value,
      referenceDate: document.querySelector("#assetReferenceDate").value,
      liquidity: document.querySelector("#assetLiquidity").value,
      owner: document.querySelector("#assetOwner").value,
      notes: document.querySelector("#assetNotes").value.trim(),
    };

    await apiRequest("/api/assets", { method: "POST", body: payload });
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
  await refreshAssets();
  render();
  showToast("Item excluido.");
}

async function backupDatabase() {
  try {
    const result = await apiRequest("/api/backup", { method: "POST", body: {} });
    showToast(`Backup criado: ${result.backup}`);
  } catch (error) {
    showToast(error.message || "Nao foi possivel criar o backup.");
  }
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

function findAsset(id) {
  return assets.find((asset) => asset.id === id);
}

function sum(items, key) {
  return items.reduce((value, item) => value + Number(item[key] || 0), 0);
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
