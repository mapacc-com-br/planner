const {
  MUSCLE_GROUPS,
  dateKey,
  summarizeSession,
} = window.FitnessUtils;

let dashboard = null;
let selectedSessionId = null;
let toastTimer = null;

const elements = {
  weekLabel: document.querySelector("#fitnessWeekLabel"),
  heroTitle: document.querySelector("#fitnessHeroTitle"),
  heroSupport: document.querySelector("#fitnessHeroSupport"),
  scoreRing: document.querySelector("#weekScoreRing"),
  scoreValue: document.querySelector("#weekScoreValue"),
  scoreTitle: document.querySelector("#weekScoreTitle"),
  scoreHint: document.querySelector("#weekScoreHint"),
  weeklySessions: document.querySelector("#weeklySessions"),
  weeklyCardio: document.querySelector("#weeklyCardio"),
  fitnessStreak: document.querySelector("#fitnessStreak"),
  fitnessLevel: document.querySelector("#fitnessLevel"),
  fitnessLevelName: document.querySelector("#fitnessLevelName"),
  weeklyVolumeGrid: document.querySelector("#weeklyVolumeGrid"),
  coachNote: document.querySelector("#coachNote"),
  coachMeta: document.querySelector("#coachMeta"),
  latestWeight: document.querySelector("#latestWeight"),
  latestBodyFat: document.querySelector("#latestBodyFat"),
  weightChange: document.querySelector("#weightChange"),
  bodyFatChange: document.querySelector("#bodyFatChange"),
  measurementCount: document.querySelector("#measurementCount"),
  bodyTrendChart: document.querySelector("#bodyTrendChart"),
  templateList: document.querySelector("#templateList"),
  timeline: document.querySelector("#fitnessTimeline"),
  historyCount: document.querySelector("#historyCount"),
  muscleProgressList: document.querySelector("#muscleProgressList"),
  personalRecords: document.querySelector("#personalRecords"),
  workoutDialog: document.querySelector("#workoutDialog"),
  workoutForm: document.querySelector("#workoutForm"),
  exerciseBuilder: document.querySelector("#exerciseBuilder"),
  measurementDialog: document.querySelector("#measurementDialog"),
  measurementForm: document.querySelector("#measurementForm"),
  cardioDialog: document.querySelector("#cardioDialog"),
  cardioForm: document.querySelector("#cardioForm"),
  targetsDialog: document.querySelector("#targetsDialog"),
  targetsForm: document.querySelector("#targetsForm"),
  targetsList: document.querySelector("#targetsList"),
  sessionDialog: document.querySelector("#sessionDialog"),
  sessionDetailTitle: document.querySelector("#sessionDetailTitle"),
  sessionDetailContent: document.querySelector("#sessionDetailContent"),
  celebrationDialog: document.querySelector("#celebrationDialog"),
  celebrationTitle: document.querySelector("#celebrationTitle"),
  celebrationXp: document.querySelector("#celebrationXp"),
  celebrationNote: document.querySelector("#celebrationNote"),
  toast: document.querySelector("#fitnessToast"),
};

initializeFitnessApp();

async function initializeFitnessApp() {
  bindFitnessEvents();
  renderLoading();
  try {
    await loadDashboard();
  } catch (error) {
    renderFatal(error);
  }
}

function bindFitnessEvents() {
  document.querySelectorAll("[data-open-workout]").forEach((button) => {
    button.addEventListener("click", () => openWorkoutDialog());
  });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`)?.close());
  });

  document.querySelector("#openMeasurement").addEventListener("click", openMeasurementDialog);
  document.querySelector("#openMeasurementSecondary").addEventListener("click", openMeasurementDialog);
  document.querySelector("#openCardio").addEventListener("click", openCardioDialog);
  document.querySelector("#openTargets").addEventListener("click", openTargetsDialog);
  document.querySelector("#repeatLastWorkout").addEventListener("click", repeatLastWorkout);
  document.querySelector("#fitnessLogout").addEventListener("click", logout);
  document.querySelector("#addExercise").addEventListener("click", () => addExerciseCard());
  document.querySelector("#saveAsTemplate").addEventListener("change", (event) => {
    document.querySelector("#templateNameField").hidden = !event.target.checked;
    if (event.target.checked && !document.querySelector("#templateName").value) {
      document.querySelector("#templateName").value = elements.workoutForm.elements.title.value;
    }
  });

  elements.exerciseBuilder.addEventListener("click", handleExerciseBuilderClick);
  elements.workoutForm.addEventListener("submit", saveWorkout);
  elements.measurementForm.addEventListener("submit", saveMeasurement);
  elements.cardioForm.addEventListener("submit", saveCardio);
  elements.targetsForm.addEventListener("submit", saveTargets);
  elements.timeline.addEventListener("click", handleTimelineClick);
  elements.templateList.addEventListener("click", handleTemplateClick);
  document.querySelector("#repeatSession").addEventListener("click", () => {
    const session = dashboard.sessions.find((item) => item.id === selectedSessionId);
    elements.sessionDialog.close();
    if (session) openWorkoutDialog(session);
  });
  document.querySelector("#deleteSession").addEventListener("click", deleteSelectedSession);
}

async function loadDashboard(referenceDate = dateKey(new Date())) {
  dashboard = await apiRequest(`/api/fitness/dashboard?date=${encodeURIComponent(referenceDate)}`);
  renderDashboard();
}

function renderLoading() {
  elements.weeklyVolumeGrid.innerHTML = Array.from({ length: 6 }, () => '<div class="fitness-skeleton"></div>').join("");
  elements.timeline.innerHTML = '<div class="fitness-empty"><i data-lucide="loader-circle"></i><p>Organizando seu historico...</p></div>';
  refreshIcons();
}

function renderFatal(error) {
  console.error(error);
  const message = escapeHtml(error.message || "Nao foi possivel carregar o planner de academia.");
  elements.weeklyVolumeGrid.innerHTML = `<div class="fitness-empty fitness-error"><i data-lucide="triangle-alert"></i><p>${message}</p><button class="fitness-button fitness-button-light" type="button" onclick="window.location.reload()">Tentar novamente</button></div>`;
  elements.timeline.innerHTML = "";
  refreshIcons();
}

function renderDashboard() {
  renderWeekScore();
  renderWeeklyVolume();
  renderCoach();
  renderBodyTrend();
  renderTemplates();
  renderTimeline();
  renderProgress();
  refreshIcons();
}

function renderWeekScore() {
  const { profile, weekly, gamification } = dashboard;
  const sessionProgress = Math.min(weekly.sessions / profile.weeklySessionGoal, 1);
  const cardioProgress = profile.weeklyCardioGoalMinutes
    ? Math.min(weekly.cardioMinutes / profile.weeklyCardioGoalMinutes, 1)
    : sessionProgress;
  const score = Math.round((sessionProgress * 0.7 + cardioProgress * 0.3) * 100);
  const weekStart = formatShortDate(weekly.start);
  const weekEnd = formatShortDate(weekly.end);

  elements.weekLabel.textContent = `${profile.displayName}, semana de ${weekStart} a ${weekEnd}`;
  elements.scoreRing.style.setProperty("--score", `${score}%`);
  elements.scoreValue.textContent = `${score}%`;
  elements.weeklySessions.textContent = `${weekly.sessions} / ${profile.weeklySessionGoal}`;
  elements.weeklyCardio.textContent = `${weekly.cardioMinutes} / ${profile.weeklyCardioGoalMinutes} min`;
  elements.fitnessStreak.textContent = `${gamification.streak} ${gamification.streak === 1 ? "semana" : "semanas"}`;
  elements.fitnessLevel.textContent = `Nivel ${gamification.level}`;
  elements.fitnessLevelName.textContent = gamification.levelName;

  if (!score) {
    elements.heroTitle.textContent = "Comece de onde voce esta.";
    elements.heroSupport.textContent = "Um registro honesto vale mais que uma semana perfeita que nao aconteceu.";
    elements.scoreTitle.textContent = "Seu primeiro ponto esta perto";
    elements.scoreHint.textContent = "Treino e cardio constroem o placar.";
  } else if (score < 60) {
    elements.heroTitle.textContent = "Ritmo em construcao.";
    elements.heroSupport.textContent = "Voce ja colocou a semana em movimento. O painel mostra onde concentrar o proximo passo.";
    elements.scoreTitle.textContent = "Semana em andamento";
    elements.scoreHint.textContent = "Consistencia primeiro, intensidade depois.";
  } else if (score < 100) {
    elements.heroTitle.textContent = "Boa semana. Falta pouco.";
    elements.heroSupport.textContent = "O plano esta perto de fechar. Use o volume para decidir sem exagerar.";
    elements.scoreTitle.textContent = "Ritmo forte e sustentavel";
    elements.scoreHint.textContent = "Complete o que faz sentido e preserve a recuperacao.";
  } else {
    elements.heroTitle.textContent = "Semana fechada. Agora recupere.";
    elements.heroSupport.textContent = "Meta cumprida sem precisar transformar descanso em culpa.";
    elements.scoreTitle.textContent = "Objetivo semanal concluido";
    elements.scoreHint.textContent = "Descanso tambem faz parte do processo.";
  }
}

function renderWeeklyVolume() {
  const progressByMuscle = new Map(dashboard.progress.map((item) => [item.muscleGroup, item]));
  const sorted = dashboard.weekly.volumes.slice().sort((a, b) => {
    if (Boolean(b.sets) !== Boolean(a.sets)) return Number(Boolean(b.sets)) - Number(Boolean(a.sets));
    return b.progress - a.progress;
  });
  elements.weeklyVolumeGrid.innerHTML = sorted
    .map((volume) => {
      const progress = progressByMuscle.get(volume.muscleGroup);
      const width = Math.min(volume.progress * 100, 100);
      return `
        <article class="fitness-volume-card is-${volume.status.key}" style="--muscle-color:${escapeAttribute(volume.color)}">
          <div class="fitness-volume-heading">
            <span class="fitness-muscle-mark"></span>
            <div><strong>${escapeHtml(volume.muscleGroup)}</strong><small>${escapeHtml(progress?.label || "Construindo historico")}</small></div>
            <span class="fitness-volume-value">${volume.sets}<small>/${volume.targetSets}</small></span>
          </div>
          <div class="fitness-volume-track"><span style="width:${width}%"></span><i style="left:${Math.min((volume.minSets / volume.targetSets) * 100, 100)}%"></i></div>
          <div class="fitness-volume-foot"><span>${escapeHtml(volume.status.label)}</span><span>faixa ${volume.minSets}-${volume.maxSets}</span></div>
        </article>`;
    })
    .join("");
}

function renderCoach() {
  elements.coachNote.textContent = dashboard.latestCoachNote || "Seu primeiro treino vai criar a linha de base para as proximas leituras.";
  const { weekly, gamification } = dashboard;
  elements.coachMeta.innerHTML = `
    <span><i data-lucide="layers-3"></i> ${weekly.sets} series na semana</span>
    <span><i data-lucide="sparkles"></i> ${gamification.xp} XP acumulados</span>`;
}

function renderBodyTrend() {
  const measurements = dashboard.measurements;
  const latest = measurements[0];
  const previous = measurements[1];
  elements.measurementCount.textContent = String(measurements.length);
  elements.latestWeight.textContent = latest ? `${formatNumber(latest.weight, 1)} kg` : "--";
  elements.latestBodyFat.textContent = latest?.bodyFat !== null && latest?.bodyFat !== undefined
    ? `${formatNumber(latest.bodyFat, 1)}%`
    : "--";
  elements.weightChange.textContent = latest && previous
    ? formatChange(latest.weight - previous.weight, "kg")
    : "Sem comparacao ainda";
  elements.bodyFatChange.textContent = latest && previous && latest.bodyFat != null && previous.bodyFat != null
    ? formatChange(latest.bodyFat - previous.bodyFat, "p.p.")
    : "Medida opcional";

  if (measurements.length < 2) {
    elements.bodyTrendChart.innerHTML = `
      <div class="fitness-chart-empty">
        <i data-lucide="line-chart"></i>
        <span>${measurements.length ? "Mais um check-in libera a tendencia." : "Registre o peso para iniciar sua linha."}</span>
      </div>`;
    return;
  }

  const points = measurements.slice(0, 12).reverse();
  const values = points.map((item) => item.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 1);
  const width = 620;
  const height = 180;
  const paddingX = 26;
  const paddingY = 24;
  const coordinates = points.map((item, index) => {
    const x = paddingX + (index / Math.max(points.length - 1, 1)) * (width - paddingX * 2);
    const y = height - paddingY - ((item.weight - min) / spread) * (height - paddingY * 2);
    return { ...item, x, y };
  });
  const polyline = coordinates.map((item) => `${item.x},${item.y}`).join(" ");
  elements.bodyTrendChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolucao do peso nos ultimos ${points.length} registros">
      <defs><linearGradient id="weightArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe85f" stop-opacity=".42"/><stop offset="1" stop-color="#bfe85f" stop-opacity="0"/></linearGradient></defs>
      <path d="M ${coordinates[0].x} ${height - paddingY} L ${polyline.replaceAll(" ", " L ")} L ${coordinates[coordinates.length - 1].x} ${height - paddingY} Z" fill="url(#weightArea)"/>
      <polyline points="${polyline}" fill="none" stroke="#315f4e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${coordinates.map((item) => `<circle cx="${item.x}" cy="${item.y}" r="5" fill="#f8f6ec" stroke="#315f4e" stroke-width="3"><title>${formatDate(item.measuredOn)}: ${formatNumber(item.weight, 1)} kg</title></circle>`).join("")}
    </svg>
    <div class="fitness-chart-labels"><span>${formatShortDate(points[0].measuredOn)}</span><span>${formatShortDate(points[points.length - 1].measuredOn)}</span></div>`;
}

function renderTemplates() {
  const lastSession = dashboard.sessions[0];
  const quickRepeat = lastSession
    ? `<button class="fitness-template-card fitness-template-repeat" type="button" data-template-action="repeat-last">
         <span><i data-lucide="repeat-2"></i></span><div><strong>Repetir ${escapeHtml(lastSession.title)}</strong><small>${lastSession.exercises.length} exercicios, com as ultimas cargas</small></div><i data-lucide="chevron-right"></i>
       </button>`
    : "";
  const templates = dashboard.templates.map((template) => `
    <article class="fitness-template-card">
      <button type="button" data-template-action="use" data-template-id="${escapeAttribute(template.id)}">
        <span><i data-lucide="bookmark-check"></i></span>
        <div><strong>${escapeHtml(template.name)}</strong><small>${template.exercises.length} exercicios salvos</small></div>
        <i data-lucide="play"></i>
      </button>
      <button class="fitness-template-delete" type="button" data-template-action="delete" data-template-id="${escapeAttribute(template.id)}" aria-label="Excluir ${escapeAttribute(template.name)}"><i data-lucide="trash-2"></i></button>
    </article>`).join("");

  elements.templateList.innerHTML = quickRepeat + templates || `
    <div class="fitness-empty fitness-empty-compact">
      <i data-lucide="bookmark-plus"></i>
      <p>Finalize um treino e marque a opcao de salvar a estrutura.</p>
    </div>`;
}

function renderTimeline() {
  const entries = [
    ...dashboard.sessions.map((session) => ({ type: "workout", date: session.performedOn, data: session })),
    ...dashboard.cardio.map((cardio) => ({ type: "cardio", date: cardio.performedOn, data: cardio })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 16);
  elements.historyCount.textContent = `${dashboard.sessions.length + dashboard.cardio.length} registros`;

  if (!entries.length) {
    elements.timeline.innerHTML = `
      <div class="fitness-empty">
        <i data-lucide="notebook-pen"></i>
        <h3>Seu historico comeca no proximo registro.</h3>
        <p>Nao precisa lembrar tudo: o planner guarda cargas, series, cardio e notas.</p>
        <button class="fitness-button fitness-button-accent" type="button" data-empty-workout>Registrar primeiro treino</button>
      </div>`;
    elements.timeline.querySelector("[data-empty-workout]").addEventListener("click", () => openWorkoutDialog());
    return;
  }

  elements.timeline.innerHTML = entries.map((entry) => {
    if (entry.type === "cardio") {
      const cardio = entry.data;
      return `
        <article class="fitness-timeline-item fitness-cardio-entry">
          <time datetime="${cardio.performedOn}"><strong>${formatDay(cardio.performedOn)}</strong><span>${formatMonth(cardio.performedOn)}</span></time>
          <span class="fitness-timeline-icon"><i data-lucide="activity"></i></span>
          <div class="fitness-timeline-copy"><p>Cardio</p><h3>${escapeHtml(cardio.modality)}</h3><span>${cardio.durationMinutes} min · ${escapeHtml(cardio.intensity)}${cardio.distanceKm !== null ? ` · ${formatNumber(cardio.distanceKm, 1)} km` : ""}</span></div>
          <button class="fitness-icon-button fitness-icon-button-border" type="button" data-delete-cardio="${escapeAttribute(cardio.id)}" aria-label="Excluir cardio"><i data-lucide="trash-2"></i></button>
        </article>`;
    }
    const session = entry.data;
    const summary = summarizeSession(session);
    const muscles = Object.keys(summary.muscleSets);
    return `
      <article class="fitness-timeline-item">
        <time datetime="${session.performedOn}"><strong>${formatDay(session.performedOn)}</strong><span>${formatMonth(session.performedOn)}</span></time>
        <span class="fitness-timeline-icon"><i data-lucide="dumbbell"></i></span>
        <div class="fitness-timeline-copy">
          <p>${session.durationMinutes ? `${session.durationMinutes} min` : "Treino concluido"}</p>
          <h3>${escapeHtml(session.title)}</h3>
          <div class="fitness-muscle-chips">${muscles.map((muscle) => `<span>${escapeHtml(muscle)}</span>`).join("")}</div>
          <span>${summary.sets} series · ${formatNumber(summary.tonnage, 0)} kg de volume</span>
        </div>
        <button class="fitness-button fitness-button-light fitness-detail-button" type="button" data-session-id="${escapeAttribute(session.id)}">Ver treino <i data-lucide="arrow-up-right"></i></button>
      </article>`;
  }).join("");
}

function renderProgress() {
  const relevant = dashboard.progress.filter((item) => item.key !== "new");
  elements.muscleProgressList.innerHTML = relevant.length
    ? relevant.slice(0, 6).map((item) => `
        <div class="fitness-progress-row is-${item.key}">
          <span><i data-lucide="${item.key === "up" ? "trending-up" : item.key === "stalled" ? "pause" : "minus"}"></i></span>
          <div><strong>${escapeHtml(item.muscleGroup)}</strong><small>${escapeHtml(item.label)}</small></div>
          ${Number.isFinite(item.change) ? `<b>${item.change >= 0 ? "+" : ""}${formatNumber(item.change * 100, 1)}%</b>` : ""}
        </div>`).join("")
    : `<div class="fitness-empty fitness-empty-compact"><i data-lucide="scan-line"></i><p>Repita alguns exercicios para comparar sua evolucao.</p></div>`;

  elements.personalRecords.innerHTML = dashboard.personalRecords.length
    ? `<h3><i data-lucide="medal"></i> Melhores marcas estimadas</h3>${dashboard.personalRecords.slice(0, 5).map((record) => `
        <div class="fitness-record-row"><div><strong>${escapeHtml(record.exercise)}</strong><small>${formatDate(record.performedOn)}</small></div><span>${formatNumber(record.weight, 1)} kg × ${record.reps}<small>1RM est. ${formatNumber(record.estimatedOneRepMax, 1)} kg</small></span></div>`).join("")}`
    : "";
}

function openMeasurementDialog() {
  elements.measurementForm.reset();
  elements.measurementForm.elements.measuredOn.value = dateKey(new Date());
  const latest = dashboard?.measurements?.[0];
  if (latest) {
    elements.measurementForm.elements.weight.value = latest.weight;
    elements.measurementForm.elements.bodyFat.value = latest.bodyFat ?? "";
  }
  elements.measurementDialog.showModal();
}

function openCardioDialog() {
  elements.cardioForm.reset();
  elements.cardioForm.elements.performedOn.value = dateKey(new Date());
  elements.cardioForm.elements.intensity.value = "Moderado";
  elements.cardioDialog.showModal();
}

function openTargetsDialog() {
  document.querySelector("#weeklySessionGoal").value = dashboard.profile.weeklySessionGoal;
  document.querySelector("#weeklyCardioGoal").value = dashboard.profile.weeklyCardioGoalMinutes;
  elements.targetsList.innerHTML = dashboard.targets.map((target) => `
    <div class="fitness-target-row" data-muscle="${escapeAttribute(target.muscleGroup)}">
      <span style="--target-color:${escapeAttribute(target.color)}"><i></i>${escapeHtml(target.muscleGroup)}</span>
      <label><small>Min.</small><input data-target-field="minSets" type="number" min="0" max="50" value="${target.minSets}" required /></label>
      <label><small>Ideal</small><input data-target-field="targetSets" type="number" min="0" max="50" value="${target.targetSets}" required /></label>
      <label><small>Max.</small><input data-target-field="maxSets" type="number" min="0" max="60" value="${target.maxSets}" required /></label>
    </div>`).join("");
  elements.targetsDialog.showModal();
}

function openWorkoutDialog(source = null) {
  elements.workoutForm.reset();
  elements.exerciseBuilder.innerHTML = "";
  document.querySelector("#templateNameField").hidden = true;
  elements.workoutForm.elements.performedOn.value = dateKey(new Date());
  elements.workoutForm.elements.durationMinutes.value = source?.durationMinutes || 60;
  elements.workoutForm.elements.energyLevel.value = source?.energyLevel || 3;
  elements.workoutForm.elements.performanceRating.value = source?.performanceRating || 3;
  elements.workoutForm.elements.title.value = source?.title || "";
  elements.workoutForm.elements.notes.value = "";
  document.querySelector("#workoutDialogTitle").textContent = source ? `Repetir ${source.title}` : "Treino de hoje";

  if (source?.exercises?.length) {
    source.exercises.forEach((exercise) => addExerciseCard({
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      sets: exercise.sets?.length
        ? exercise.sets.map((set) => ({ weight: set.weight, reps: set.reps, rir: set.rir }))
        : Array.from({ length: exercise.suggestedSets || 3 }, () => ({ weight: "", reps: "", rir: 2 })),
    }));
  } else {
    addExerciseCard();
  }
  elements.workoutDialog.showModal();
  elements.workoutForm.elements.title.focus();
}

function addExerciseCard(exercise = {}) {
  const exerciseId = crypto.randomUUID();
  const sets = exercise.sets?.length ? exercise.sets : Array.from({ length: 3 }, () => ({ weight: "", reps: "", rir: 2 }));
  const card = document.createElement("article");
  card.className = "fitness-exercise-card";
  card.dataset.exerciseId = exerciseId;
  card.innerHTML = `
    <div class="fitness-exercise-heading">
      <span class="fitness-exercise-number">${elements.exerciseBuilder.children.length + 1}</span>
      <label class="fitness-field"><span>Exercicio</span><input data-exercise-field="name" list="exerciseSuggestions" value="${escapeAttribute(exercise.name || "")}" placeholder="Nome do exercicio" required /></label>
      <label class="fitness-field"><span>Grupo</span><select data-exercise-field="muscleGroup">${muscleOptions(exercise.muscleGroup)}</select></label>
      <button class="fitness-icon-button fitness-icon-button-border" type="button" data-builder-action="remove-exercise" aria-label="Remover exercicio"><i data-lucide="trash-2"></i></button>
    </div>
    <div class="fitness-set-table">
      <div class="fitness-set-header"><span>Serie</span><span>Carga kg</span><span>Reps</span><span>RIR</span><span></span></div>
      <div data-set-list>${sets.map((set, index) => setRowHtml(set, index)).join("")}</div>
    </div>
    <button class="fitness-add-set" type="button" data-builder-action="add-set"><i data-lucide="plus"></i>Adicionar serie</button>`;
  elements.exerciseBuilder.append(card);
  renumberExercises();
  refreshIcons();
}

function setRowHtml(set = {}, index = 0) {
  return `
    <div class="fitness-set-row" data-set-id="${crypto.randomUUID()}">
      <strong>${index + 1}</strong>
      <input data-set-field="weight" type="number" min="0" max="1000" step="0.25" inputmode="decimal" value="${escapeAttribute(set.weight ?? "")}" aria-label="Carga da serie ${index + 1}" placeholder="0" />
      <input data-set-field="reps" type="number" min="1" max="500" inputmode="numeric" value="${escapeAttribute(set.reps ?? "")}" aria-label="Repeticoes da serie ${index + 1}" placeholder="10" required />
      <input data-set-field="rir" type="number" min="0" max="10" step="0.5" inputmode="decimal" value="${escapeAttribute(set.rir ?? 2)}" aria-label="RIR da serie ${index + 1}" />
      <button type="button" data-builder-action="remove-set" aria-label="Remover serie"><i data-lucide="x"></i></button>
    </div>`;
}

function handleExerciseBuilderClick(event) {
  const button = event.target.closest("[data-builder-action]");
  if (!button) return;
  const card = button.closest(".fitness-exercise-card");
  const action = button.dataset.builderAction;
  if (action === "remove-exercise") {
    if (elements.exerciseBuilder.children.length === 1) return showToast("O treino precisa de pelo menos um exercicio.");
    card.remove();
    renumberExercises();
  }
  if (action === "add-set") {
    const setList = card.querySelector("[data-set-list]");
    const rows = setList.querySelectorAll(".fitness-set-row");
    const last = rows[rows.length - 1];
    const draft = last ? {
      weight: last.querySelector('[data-set-field="weight"]').value,
      reps: last.querySelector('[data-set-field="reps"]').value,
      rir: last.querySelector('[data-set-field="rir"]').value,
    } : {};
    setList.insertAdjacentHTML("beforeend", setRowHtml(draft, rows.length));
  }
  if (action === "remove-set") {
    const setList = card.querySelector("[data-set-list]");
    if (setList.children.length === 1) return showToast("O exercicio precisa de pelo menos uma serie.");
    button.closest(".fitness-set-row").remove();
    renumberSets(setList);
  }
  refreshIcons();
}

function renumberExercises() {
  elements.exerciseBuilder.querySelectorAll(".fitness-exercise-card").forEach((card, index) => {
    card.querySelector(".fitness-exercise-number").textContent = String(index + 1);
  });
}

function renumberSets(setList) {
  setList.querySelectorAll(".fitness-set-row").forEach((row, index) => {
    row.querySelector("strong").textContent = String(index + 1);
  });
}

async function saveWorkout(event) {
  event.preventDefault();
  const submit = elements.workoutForm.querySelector('[type="submit"]');
  setBusy(submit, true, "Salvando...");
  try {
    const workout = collectWorkout();
    const result = await apiRequest("/api/fitness/sessions", { method: "POST", body: workout });
    if (document.querySelector("#saveAsTemplate").checked) {
      await apiRequest("/api/fitness/templates", {
        method: "POST",
        body: {
          name: document.querySelector("#templateName").value.trim() || workout.title,
          exercises: workout.exercises.map((exercise) => ({
            name: exercise.name,
            muscleGroup: exercise.muscleGroup,
            suggestedSets: exercise.sets.length,
          })),
        },
      });
      result.dashboard = await apiRequest(`/api/fitness/dashboard?date=${encodeURIComponent(dateKey(new Date()))}`);
    }
    dashboard = result.dashboard;
    elements.workoutDialog.close();
    renderDashboard();
    showCelebration(result.session.title, result.awardXp, result.session.coachNote);
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o treino.");
  } finally {
    setBusy(submit, false);
  }
}

function collectWorkout() {
  const form = elements.workoutForm.elements;
  const exercises = Array.from(elements.exerciseBuilder.querySelectorAll(".fitness-exercise-card")).map((card) => ({
    name: card.querySelector('[data-exercise-field="name"]').value.trim(),
    muscleGroup: card.querySelector('[data-exercise-field="muscleGroup"]').value,
    sets: Array.from(card.querySelectorAll(".fitness-set-row")).map((row) => ({
      weight: row.querySelector('[data-set-field="weight"]').value || 0,
      reps: row.querySelector('[data-set-field="reps"]').value,
      rir: row.querySelector('[data-set-field="rir"]').value,
      completed: true,
    })),
  }));
  return {
    title: form.title.value.trim(),
    performedOn: form.performedOn.value,
    durationMinutes: Number(form.durationMinutes.value || 0),
    energyLevel: Number(form.energyLevel.value),
    performanceRating: Number(form.performanceRating.value),
    notes: form.notes.value.trim(),
    exercises,
  };
}

async function saveMeasurement(event) {
  event.preventDefault();
  const submit = elements.measurementForm.querySelector('[type="submit"]');
  setBusy(submit, true, "Salvando...");
  try {
    const form = new FormData(elements.measurementForm);
    const result = await apiRequest("/api/fitness/measurements", {
      method: "POST",
      body: {
        measuredOn: form.get("measuredOn"),
        weight: form.get("weight"),
        bodyFat: form.get("bodyFat"),
        notes: form.get("notes"),
      },
    });
    dashboard = result.dashboard;
    elements.measurementDialog.close();
    renderDashboard();
    showToast("Check-in corporal salvo.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o check-in.");
  } finally {
    setBusy(submit, false);
  }
}

async function saveCardio(event) {
  event.preventDefault();
  const submit = elements.cardioForm.querySelector('[type="submit"]');
  setBusy(submit, true, "Salvando...");
  try {
    const form = new FormData(elements.cardioForm);
    const result = await apiRequest("/api/fitness/cardio", {
      method: "POST",
      body: {
        performedOn: form.get("performedOn"),
        modality: form.get("modality"),
        durationMinutes: form.get("durationMinutes"),
        distanceKm: form.get("distanceKm"),
        intensity: form.get("intensity"),
        notes: form.get("notes"),
      },
    });
    dashboard = result.dashboard;
    elements.cardioDialog.close();
    renderDashboard();
    showCelebration("Cardio salvo", result.awardXp, `${result.cardio.durationMinutes} minutos adicionados ao seu placar semanal.`);
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar o cardio.");
  } finally {
    setBusy(submit, false);
  }
}

async function saveTargets(event) {
  event.preventDefault();
  const submit = elements.targetsForm.querySelector('[type="submit"]');
  setBusy(submit, true, "Salvando...");
  try {
    const targets = Array.from(elements.targetsList.querySelectorAll("[data-muscle]")).map((row) => ({
      muscleGroup: row.dataset.muscle,
      minSets: Number(row.querySelector('[data-target-field="minSets"]').value),
      targetSets: Number(row.querySelector('[data-target-field="targetSets"]').value),
      maxSets: Number(row.querySelector('[data-target-field="maxSets"]').value),
    }));
    const result = await apiRequest("/api/fitness/targets", {
      method: "POST",
      body: {
        targets,
        weeklySessionGoal: Number(document.querySelector("#weeklySessionGoal").value),
        weeklyCardioGoalMinutes: Number(document.querySelector("#weeklyCardioGoal").value),
        referenceDate: dateKey(new Date()),
      },
    });
    dashboard = result.dashboard;
    elements.targetsDialog.close();
    renderDashboard();
    showToast("Metas atualizadas para a sua rotina.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel salvar as metas.");
  } finally {
    setBusy(submit, false);
  }
}

function repeatLastWorkout() {
  const last = dashboard.sessions[0];
  if (!last) return openWorkoutDialog();
  openWorkoutDialog(last);
}

function handleTimelineClick(event) {
  const sessionButton = event.target.closest("[data-session-id]");
  if (sessionButton) return showSessionDetail(sessionButton.dataset.sessionId);
  const cardioButton = event.target.closest("[data-delete-cardio]");
  if (cardioButton) deleteCardio(cardioButton.dataset.deleteCardio);
}

function showSessionDetail(sessionId) {
  const session = dashboard.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  selectedSessionId = session.id;
  const summary = summarizeSession(session);
  elements.sessionDetailTitle.textContent = session.title;
  elements.sessionDetailContent.innerHTML = `
    <div class="fitness-session-summary">
      <div><span>Data</span><strong>${formatDate(session.performedOn)}</strong></div>
      <div><span>Duracao</span><strong>${session.durationMinutes || "--"} min</strong></div>
      <div><span>Series</span><strong>${summary.sets}</strong></div>
      <div><span>Volume</span><strong>${formatNumber(summary.tonnage, 0)} kg</strong></div>
    </div>
    <div class="fitness-detail-exercises">${session.exercises.map((exercise) => `
      <article><header><div><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(exercise.muscleGroup)}</span></div><b>${exercise.sets.length} series</b></header>
      <div>${exercise.sets.map((set) => `<span>${formatNumber(set.weight, 2)} kg × ${set.reps}<small>RIR ${set.rir ?? "--"}</small></span>`).join("")}</div></article>`).join("")}</div>
    ${session.notes ? `<div class="fitness-saved-note"><i data-lucide="notebook-pen"></i><p>${escapeHtml(session.notes)}</p></div>` : ""}
    <div class="fitness-saved-coach"><i data-lucide="sparkles"></i><p>${escapeHtml(session.coachNote)}</p></div>`;
  elements.sessionDialog.showModal();
  refreshIcons();
}

async function deleteSelectedSession() {
  if (!selectedSessionId || !window.confirm("Excluir este treino do historico?")) return;
  try {
    await apiRequest(`/api/fitness/sessions/${encodeURIComponent(selectedSessionId)}`, { method: "DELETE" });
    elements.sessionDialog.close();
    selectedSessionId = null;
    await loadDashboard();
    showToast("Treino excluido.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel excluir o treino.");
  }
}

async function deleteCardio(id) {
  if (!window.confirm("Excluir este cardio do historico?")) return;
  try {
    await apiRequest(`/api/fitness/cardio/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadDashboard();
    showToast("Cardio excluido.");
  } catch (error) {
    showToast(error.message || "Nao foi possivel excluir o cardio.");
  }
}

async function handleTemplateClick(event) {
  const action = event.target.closest("[data-template-action]");
  if (!action) return;
  if (action.dataset.templateAction === "repeat-last") return repeatLastWorkout();
  const template = dashboard.templates.find((item) => item.id === action.dataset.templateId);
  if (!template) return;
  if (action.dataset.templateAction === "use") return openWorkoutDialog({ ...template, title: template.name });
  if (action.dataset.templateAction === "delete" && window.confirm(`Excluir o modelo ${template.name}?`)) {
    try {
      await apiRequest(`/api/fitness/templates/${encodeURIComponent(template.id)}`, { method: "DELETE" });
      await loadDashboard();
      showToast("Modelo excluido.");
    } catch (error) {
      showToast(error.message || "Nao foi possivel excluir o modelo.");
    }
  }
}

function showCelebration(title, xp, note) {
  elements.celebrationTitle.textContent = title;
  elements.celebrationXp.textContent = `+${xp} XP`;
  elements.celebrationNote.textContent = note;
  elements.celebrationDialog.showModal();
  refreshIcons();
}

async function logout() {
  try {
    await apiRequest("/api/logout", { method: "POST" });
  } finally {
    window.location.href = "/login.html";
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 401) {
    window.location.href = `/login.html?next=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Sessao expirada.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.details || payload.error || "Nao foi possivel concluir a acao.");
  return payload;
}

function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    refreshIcons();
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("is-visible"), 3200);
}

function muscleOptions(selected) {
  return MUSCLE_GROUPS.map((group) => `<option value="${escapeAttribute(group.name)}" ${group.name === selected ? "selected" : ""}>${escapeHtml(group.name)}</option>`).join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function formatDay(value) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit" }).format(new Date(`${value}T12:00:00`));
}

function formatMonth(value) {
  return new Intl.DateTimeFormat("pt-BR", { month: "short" }).format(new Date(`${value}T12:00:00`)).replace(".", "");
}

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function formatChange(value, unit) {
  const sign = value > 0 ? "+" : "";
  if (Math.abs(value) < 0.01) return `Estavel desde o ultimo (${unit})`;
  return `${sign}${formatNumber(value, 1)} ${unit} desde o ultimo`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}
