(function attachPlannerCharts(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlannerCharts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createPlannerCharts() {
  const chartState = new WeakMap();

  function renderLineChart(canvas, config) {
    renderChart(canvas, { ...config, type: "line" });
  }

  function renderBarChart(canvas, config) {
    renderChart(canvas, { ...config, type: "bar" });
  }

  function renderChart(canvas, config) {
    if (!canvas?.getContext) return;
    const labels = Array.isArray(config.labels) ? config.labels : [];
    const datasets = (Array.isArray(config.datasets) ? config.datasets : []).filter((dataset) => dataset.hidden !== true);
    const dimensions = sizeCanvas(canvas, config.height || 260);
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, dimensions.width, dimensions.height);

    if (!labels.length || !datasets.some((dataset) => dataset.values?.some((value) => Number.isFinite(Number(value))))) {
      drawEmpty(context, dimensions, config.emptyMessage || "Sem dados suficientes para o grafico.");
      chartState.set(canvas, { labels: [], datasets: [], points: [], formatValue: config.formatValue });
      return;
    }

    const padding = { top: 28, right: 18, bottom: 42, left: dimensions.width < 520 ? 58 : 76 };
    const plot = {
      left: padding.left,
      top: padding.top,
      right: dimensions.width - padding.right,
      bottom: dimensions.height - padding.bottom,
    };
    const values = datasets.flatMap((dataset) => dataset.values || []).map(Number).filter(Number.isFinite);
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(1, ...values);
    const span = maxValue - minValue || 1;
    const yFor = (value) => plot.bottom - ((Number(value) - minValue) / span) * (plot.bottom - plot.top);
    const xFor = (index) => {
      if (config.type === "bar") return plot.left + ((index + 0.5) / labels.length) * (plot.right - plot.left);
      return plot.left + (index / Math.max(labels.length - 1, 1)) * (plot.right - plot.left);
    };

    drawAxes(context, plot, minValue, maxValue, labels, xFor, config.formatAxisValue || compactNumber);
    const points = config.type === "bar"
      ? drawBars(context, datasets, labels, plot, xFor, yFor)
      : drawLines(context, datasets, labels, xFor, yFor);
    drawLegend(context, datasets, plot.left, 12);
    bindTooltip(canvas);
    chartState.set(canvas, { labels, datasets, points, formatValue: config.formatValue || String });
  }

  function sizeCanvas(canvas, cssHeight) {
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const width = Math.max(canvas.clientWidth || canvas.parentElement?.clientWidth || 320, 280);
    canvas.style.height = `${cssHeight}px`;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(cssHeight * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { width, height: cssHeight };
  }

  function drawAxes(context, plot, minValue, maxValue, labels, xFor, formatter) {
    context.save();
    context.font = "12px sans-serif";
    context.fillStyle = "#5f7187";
    context.strokeStyle = "#d5e4f5";
    context.lineWidth = 1;
    context.textAlign = "right";
    context.textBaseline = "middle";

    for (let index = 0; index <= 4; index += 1) {
      const ratio = index / 4;
      const y = plot.bottom - ratio * (plot.bottom - plot.top);
      const value = minValue + ratio * (maxValue - minValue);
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
      context.fillText(formatter(value), plot.left - 8, y);
    }

    context.textAlign = "center";
    context.textBaseline = "top";
    const labelStep = Math.max(Math.ceil(labels.length / 6), 1);
    labels.forEach((label, index) => {
      if (index % labelStep !== 0 && index !== labels.length - 1) return;
      context.fillText(String(label), xFor(index), plot.bottom + 12);
    });
    context.restore();
  }

  function drawLines(context, datasets, labels, xFor, yFor) {
    const points = [];
    datasets.forEach((dataset) => {
      context.save();
      context.strokeStyle = dataset.color || "#2478c7";
      context.fillStyle = dataset.color || "#2478c7";
      context.lineWidth = dataset.lineWidth || 2.5;
      context.setLineDash(dataset.dashed ? [7, 6] : []);
      context.beginPath();
      let drawing = false;

      labels.forEach((label, index) => {
        const raw = dataset.values?.[index];
        if (!Number.isFinite(Number(raw))) {
          drawing = false;
          return;
        }
        const x = xFor(index);
        const y = yFor(raw);
        if (!drawing) context.moveTo(x, y);
        else context.lineTo(x, y);
        drawing = true;
        points.push({ x, y, index, dataset });
      });
      context.stroke();
      context.setLineDash([]);

      labels.forEach((label, index) => {
        const raw = dataset.values?.[index];
        if (!Number.isFinite(Number(raw))) return;
        context.beginPath();
        context.arc(xFor(index), yFor(raw), 3.2, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();
    });
    return points;
  }

  function drawBars(context, datasets, labels, plot, xFor, yFor) {
    const points = [];
    const groupWidth = (plot.right - plot.left) / labels.length;
    const barWidth = Math.max(Math.min((groupWidth * 0.68) / Math.max(datasets.length, 1), 36), 4);

    datasets.forEach((dataset, datasetIndex) => {
      context.save();
      context.fillStyle = dataset.color || "#2478c7";
      labels.forEach((label, index) => {
        const raw = dataset.values?.[index];
        if (!Number.isFinite(Number(raw))) return;
        const centerOffset = (datasetIndex - (datasets.length - 1) / 2) * barWidth;
        const x = xFor(index) + centerOffset - barWidth / 2;
        const y = yFor(raw);
        const height = Math.max(plot.bottom - y, 1);
        context.fillRect(x, y, barWidth - 2, height);
        points.push({ x: x + barWidth / 2, y, index, dataset });
      });
      context.restore();
    });
    return points;
  }

  function drawLegend(context, datasets, left, top) {
    context.save();
    context.font = "12px sans-serif";
    context.textBaseline = "middle";
    let x = left;
    datasets.forEach((dataset) => {
      context.fillStyle = dataset.color || "#2478c7";
      context.fillRect(x, top - 4, 16, 3);
      context.fillStyle = "#5f7187";
      context.fillText(dataset.label, x + 22, top - 2);
      x += 30 + context.measureText(dataset.label).width;
    });
    context.restore();
  }

  function drawEmpty(context, dimensions, message) {
    context.save();
    context.fillStyle = "#5f7187";
    context.font = "14px sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(message, dimensions.width / 2, dimensions.height / 2);
    context.restore();
  }

  function bindTooltip(canvas) {
    if (canvas.dataset.chartTooltipBound === "true") return;
    canvas.dataset.chartTooltipBound = "true";
    canvas.addEventListener("pointermove", (event) => showTooltip(canvas, event));
    canvas.addEventListener("pointerleave", () => hideTooltip(canvas));
    canvas.addEventListener("focusout", () => hideTooltip(canvas));
  }

  function showTooltip(canvas, event) {
    const state = chartState.get(canvas);
    if (!state?.points.length) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const nearest = state.points.reduce((best, point) => (!best || Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best), null);
    if (!nearest) return;

    const tooltip = ensureTooltip(canvas);
    const values = state.datasets
      .map((dataset) => ({ label: dataset.label, value: dataset.values?.[nearest.index], color: dataset.color }))
      .filter((item) => Number.isFinite(Number(item.value)));
    tooltip.innerHTML = `
      <strong>${escapeHtml(state.labels[nearest.index])}</strong>
      ${values
        .map(
          (item) =>
            `<span><i style="--tooltip-color:${escapeHtml(item.color || "#2478c7")}"></i>${escapeHtml(item.label)}: ${escapeHtml(state.formatValue(item.value))}</span>`,
        )
        .join("")}
    `;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(Math.max(nearest.x, 90), rect.width - 90)}px`;
    tooltip.style.top = `${Math.max(nearest.y - 12, 22)}px`;
  }

  function hideTooltip(canvas) {
    const tooltip = canvas.parentElement?.querySelector(".chart-tooltip");
    if (tooltip) tooltip.hidden = true;
  }

  function ensureTooltip(canvas) {
    let tooltip = canvas.parentElement?.querySelector(".chart-tooltip");
    if (tooltip) return tooltip;
    tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    tooltip.hidden = true;
    canvas.parentElement?.append(tooltip);
    return tooltip;
  }

  function compactNumber(value) {
    return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  return {
    renderBarChart,
    renderLineChart,
  };
});
