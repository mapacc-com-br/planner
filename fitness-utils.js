(function initializeFitnessUtils(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FitnessUtils = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const MUSCLE_GROUPS = [
    { name: "Peitoral", color: "#e06c47", minSets: 6, targetSets: 10, maxSets: 16 },
    { name: "Costas", color: "#2f7f68", minSets: 6, targetSets: 10, maxSets: 16 },
    { name: "Quadriceps", color: "#d6a62e", minSets: 6, targetSets: 10, maxSets: 16 },
    { name: "Posterior de coxa", color: "#b87939", minSets: 5, targetSets: 8, maxSets: 14 },
    { name: "Gluteos", color: "#b95f6c", minSets: 5, targetSets: 8, maxSets: 14 },
    { name: "Ombros", color: "#4f77ad", minSets: 5, targetSets: 8, maxSets: 14 },
    { name: "Biceps", color: "#4c8f45", minSets: 4, targetSets: 8, maxSets: 12 },
    { name: "Triceps", color: "#347d87", minSets: 4, targetSets: 8, maxSets: 12 },
    { name: "Panturrilhas", color: "#92734f", minSets: 4, targetSets: 8, maxSets: 12 },
    { name: "Core", color: "#65733e", minSets: 4, targetSets: 8, maxSets: 12 },
  ];

  function localDate(value = new Date()) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12);
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return localDate(new Date());
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  }

  function dateKey(value) {
    const date = localDate(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function addDays(value, amount) {
    const date = localDate(value);
    date.setDate(date.getDate() + amount);
    return dateKey(date);
  }

  function weekBounds(value = new Date()) {
    const date = localDate(value);
    const day = date.getDay() || 7;
    date.setDate(date.getDate() - day + 1);
    const start = dateKey(date);
    return { start, end: addDays(start, 6) };
  }

  function isWithin(date, start, end) {
    const key = dateKey(date);
    return key >= start && key <= end;
  }

  function estimateOneRepMax(weight, reps) {
    const load = Math.max(0, Number(weight) || 0);
    const repetitions = Math.max(0, Number(reps) || 0);
    if (!load || !repetitions) return 0;
    return round(load * (1 + repetitions / 30), 1);
  }

  function completedSets(exercise) {
    return (exercise?.sets || []).filter((set) => set.completed !== false && Number(set.reps) > 0 && Number(set.weight) >= 0);
  }

  function summarizeSession(session) {
    const summary = {
      sets: 0,
      reps: 0,
      tonnage: 0,
      muscleSets: {},
      averageRir: null,
      exercises: (session?.exercises || []).length,
    };
    const rirValues = [];

    (session?.exercises || []).forEach((exercise) => {
      const sets = completedSets(exercise);
      const muscle = exercise.muscleGroup || "Outros";
      summary.sets += sets.length;
      summary.muscleSets[muscle] = (summary.muscleSets[muscle] || 0) + sets.length;

      sets.forEach((set) => {
        const reps = Number(set.reps) || 0;
        const weight = Number(set.weight) || 0;
        summary.reps += reps;
        summary.tonnage += reps * weight;
        if (set.rir !== null && set.rir !== undefined && set.rir !== "") rirValues.push(Number(set.rir));
      });
    });

    summary.tonnage = round(summary.tonnage, 1);
    summary.averageRir = rirValues.length ? round(rirValues.reduce((total, value) => total + value, 0) / rirValues.length, 1) : null;
    return summary;
  }

  function classifyVolume(sets, target) {
    const value = Number(sets) || 0;
    if (!value) return { key: "empty", label: "Ainda sem volume", tone: "neutral" };
    if (value < target.minSets) return { key: "low", label: "Volume baixo", tone: "attention" };
    if (value <= target.maxSets) return { key: "good", label: "Volume adequado", tone: "positive" };
    return { key: "high", label: "Volume elevado", tone: "warning" };
  }

  function normalizeTargets(targets = []) {
    return MUSCLE_GROUPS.map((fallback) => {
      const saved = targets.find((item) => item.muscleGroup === fallback.name) || {};
      return {
        muscleGroup: fallback.name,
        color: saved.color || fallback.color,
        minSets: Number(saved.minSets ?? fallback.minSets),
        targetSets: Number(saved.targetSets ?? fallback.targetSets),
        maxSets: Number(saved.maxSets ?? fallback.maxSets),
      };
    });
  }

  function buildWeeklySummary({ sessions = [], cardio = [], targets = [], referenceDate = new Date() } = {}) {
    const bounds = weekBounds(referenceDate);
    const weekSessions = sessions.filter((session) => isWithin(session.performedOn, bounds.start, bounds.end));
    const weekCardio = cardio.filter((entry) => isWithin(entry.performedOn, bounds.start, bounds.end));
    const muscleSets = {};
    let sets = 0;
    let tonnage = 0;

    weekSessions.forEach((session) => {
      const summary = summarizeSession(session);
      sets += summary.sets;
      tonnage += summary.tonnage;
      Object.entries(summary.muscleSets).forEach(([muscle, count]) => {
        muscleSets[muscle] = (muscleSets[muscle] || 0) + count;
      });
    });

    const volumes = normalizeTargets(targets).map((target) => {
      const count = muscleSets[target.muscleGroup] || 0;
      return {
        ...target,
        sets: count,
        progress: target.targetSets ? Math.min(count / target.targetSets, 1.35) : 0,
        status: classifyVolume(count, target),
      };
    });

    return {
      start: bounds.start,
      end: bounds.end,
      sessions: weekSessions.length,
      sets,
      tonnage: round(tonnage, 1),
      cardioMinutes: weekCardio.reduce((total, entry) => total + (Number(entry.durationMinutes) || 0), 0),
      volumes,
    };
  }

  function sessionWeeks(sessions) {
    const counts = new Map();
    sessions.forEach((session) => {
      const key = weekBounds(session.performedOn).start;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function calculateStreak(sessions = [], weeklyGoal = 3, referenceDate = new Date()) {
    const counts = sessionWeeks(sessions);
    const currentStart = weekBounds(referenceDate).start;
    let cursor = currentStart;
    let streak = 0;

    if ((counts.get(cursor) || 0) < weeklyGoal) cursor = addDays(cursor, -7);
    while ((counts.get(cursor) || 0) >= weeklyGoal) {
      streak += 1;
      cursor = addDays(cursor, -7);
    }
    return streak;
  }

  function calculateGamification({ sessions = [], cardio = [], measurements = [], weeklyGoal = 3, referenceDate = new Date() } = {}) {
    const sessionXp = sessions.reduce((total, session) => total + 80 + summarizeSession(session).sets * 6, 0);
    const cardioXp = cardio.reduce((total, entry) => total + Math.min(Number(entry.durationMinutes) || 0, 90) * 2, 0);
    const measurementXp = measurements.length * 20;
    const xp = Math.round(sessionXp + cardioXp + measurementXp);
    const level = Math.max(1, Math.floor(Math.sqrt(xp / 220)) + 1);
    const levelStart = Math.pow(level - 1, 2) * 220;
    const nextLevelXp = Math.pow(level, 2) * 220;
    const progress = nextLevelXp === levelStart ? 0 : (xp - levelStart) / (nextLevelXp - levelStart);

    return {
      xp,
      level,
      levelName: getLevelName(level),
      levelProgress: Math.min(Math.max(progress, 0), 1),
      nextLevelXp,
      streak: calculateStreak(sessions, weeklyGoal, referenceDate),
      badges: buildBadges(sessions, cardio, measurements),
    };
  }

  function buildBadges(sessions, cardio, measurements) {
    const totalSets = sessions.reduce((total, session) => total + summarizeSession(session).sets, 0);
    const totalCardio = cardio.reduce((total, entry) => total + (Number(entry.durationMinutes) || 0), 0);
    return [
      { id: "first-workout", label: "Primeiro passo", description: "Concluiu o primeiro treino", unlocked: sessions.length >= 1 },
      { id: "ten-workouts", label: "Ritmo criado", description: "Concluiu 10 treinos", unlocked: sessions.length >= 10 },
      { id: "hundred-sets", label: "Volume 100", description: "Registrou 100 series", unlocked: totalSets >= 100 },
      { id: "cardio-300", label: "Folego 300", description: "Acumulou 300 minutos de cardio", unlocked: totalCardio >= 300 },
      { id: "body-check", label: "Olhar de longo prazo", description: "Fez 4 check-ins corporais", unlocked: measurements.length >= 4 },
    ];
  }

  function getLevelName(level) {
    if (level >= 8) return "Referencia";
    if (level >= 6) return "Consistente";
    if (level >= 4) return "Em evolucao";
    if (level >= 2) return "Criando ritmo";
    return "Comecando";
  }

  function buildPersonalRecords(sessions = []) {
    const records = new Map();
    sessions.forEach((session) => {
      (session.exercises || []).forEach((exercise) => {
        const key = String(exercise.name || "").trim().toLocaleLowerCase("pt-BR");
        if (!key) return;
        completedSets(exercise).forEach((set) => {
          const candidate = {
            exercise: exercise.name,
            muscleGroup: exercise.muscleGroup,
            weight: Number(set.weight) || 0,
            reps: Number(set.reps) || 0,
            estimatedOneRepMax: estimateOneRepMax(set.weight, set.reps),
            performedOn: session.performedOn,
          };
          const current = records.get(key);
          if (!current || candidate.estimatedOneRepMax > current.estimatedOneRepMax) records.set(key, candidate);
        });
      });
    });
    return Array.from(records.values()).sort((a, b) => b.estimatedOneRepMax - a.estimatedOneRepMax);
  }

  function buildMuscleProgress(sessions = []) {
    const histories = new Map();
    sessions
      .slice()
      .sort((a, b) => String(a.performedOn).localeCompare(String(b.performedOn)))
      .forEach((session) => {
        (session.exercises || []).forEach((exercise) => {
          const best = completedSets(exercise).reduce((max, set) => Math.max(max, estimateOneRepMax(set.weight, set.reps)), 0);
          if (!best) return;
          const muscle = exercise.muscleGroup || "Outros";
          if (!histories.has(muscle)) histories.set(muscle, []);
          histories.get(muscle).push({ date: session.performedOn, exercise: exercise.name, best });
        });
      });

    return MUSCLE_GROUPS.map((muscle) => {
      const entries = histories.get(muscle.name) || [];
      if (entries.length < 2) return { muscleGroup: muscle.name, key: "new", label: "Construindo historico" };
      const latest = entries[entries.length - 1];
      const comparable = entries.filter((entry) => entry.exercise.toLocaleLowerCase("pt-BR") === latest.exercise.toLocaleLowerCase("pt-BR"));
      const previous = comparable[comparable.length - 2];
      if (!previous) return { muscleGroup: muscle.name, key: "new", label: "Construindo historico" };
      const change = previous.best ? (latest.best - previous.best) / previous.best : 0;
      if (change >= 0.02) return { muscleGroup: muscle.name, key: "up", label: "Boa evolucao", change };
      if (comparable.length >= 5) return { muscleGroup: muscle.name, key: "stalled", label: "Possivel estagnacao", change };
      return { muscleGroup: muscle.name, key: "stable", label: "Estavel", change };
    });
  }

  function buildCoachNote(session, weeklySummary) {
    const summary = summarizeSession(session);
    if (!summary.sets) return "Registro salvo. Inclua as series concluidas para receber uma leitura mais precisa do treino.";

    const muscleNames = Object.keys(summary.muscleSets);
    const reached = weeklySummary.volumes.filter((item) => muscleNames.includes(item.muscleGroup) && item.status.key === "good");
    const high = weeklySummary.volumes.filter((item) => muscleNames.includes(item.muscleGroup) && item.status.key === "high");
    const low = weeklySummary.volumes.filter((item) => muscleNames.includes(item.muscleGroup) && item.status.key === "low");
    const parts = [`Treino concluido com ${summary.sets} series e ${formatCompactNumber(summary.tonnage)} kg de volume.`];

    if (high.length) parts.push(`${joinNames(high.map((item) => item.muscleGroup))} ${high.length > 1 ? "passaram" : "passou"} da faixa semanal configurada; vale priorizar recuperacao antes de somar mais volume.`);
    else if (reached.length) parts.push(`${joinNames(reached.map((item) => item.muscleGroup))} ${reached.length > 1 ? "estao" : "esta"} dentro da faixa planejada nesta semana.`);
    else if (low.length) parts.push(`${joinNames(low.map((item) => item.muscleGroup))} ainda ${low.length > 1 ? "estao" : "esta"} abaixo da faixa semanal e ${low.length > 1 ? "podem ser distribuidos" : "pode ser distribuido"} nas proximas sessoes.`);

    if (Number(session.performanceRating) >= 4) parts.push("Sua percepcao de desempenho foi boa: mantenha a progressao gradual.");
    if (Number(session.energyLevel) <= 2 || (summary.averageRir !== null && summary.averageRir < 1)) parts.push("O esforco ficou alto; use sono, dores e disposicao para decidir o proximo passo.");
    return parts.join(" ");
  }

  function joinNames(names) {
    if (names.length <= 1) return names[0] || "O grupo treinado";
    return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
  }

  function formatCompactNumber(value) {
    const number = Number(value) || 0;
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: number >= 100 ? 0 : 1 }).format(number);
  }

  function round(value, digits = 2) {
    const factor = Math.pow(10, digits);
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  return {
    MUSCLE_GROUPS,
    addDays,
    buildCoachNote,
    buildMuscleProgress,
    buildPersonalRecords,
    buildWeeklySummary,
    calculateGamification,
    calculateStreak,
    classifyVolume,
    dateKey,
    estimateOneRepMax,
    normalizeTargets,
    summarizeSession,
    weekBounds,
  };
});
