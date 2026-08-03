const test = require("node:test");
const assert = require("node:assert/strict");
const fitnessUtils = require("../fitness-utils");

function workout(date, sets = []) {
  return {
    performedOn: date,
    exercises: [
      {
        name: "Supino reto",
        muscleGroup: "Peitoral",
        sets: sets.map(([weight, reps, rir = 2]) => ({ weight, reps, rir, completed: true })),
      },
    ],
  };
}

test("resume series, repeticoes, tonelagem e RIR do treino", () => {
  const summary = fitnessUtils.summarizeSession(workout("2026-08-01", [[80, 10, 2], [80, 8, 1]]));

  assert.equal(summary.sets, 2);
  assert.equal(summary.reps, 18);
  assert.equal(summary.tonnage, 1440);
  assert.equal(summary.muscleSets.Peitoral, 2);
  assert.equal(summary.averageRir, 1.5);
});

test("classifica o volume usando a faixa configurada", () => {
  const target = { minSets: 6, targetSets: 10, maxSets: 16 };

  assert.equal(fitnessUtils.classifyVolume(4, target).key, "low");
  assert.equal(fitnessUtils.classifyVolume(10, target).key, "good");
  assert.equal(fitnessUtils.classifyVolume(18, target).key, "high");
});

test("agrega treino e cardio da semana sem misturar semanas", () => {
  const summary = fitnessUtils.buildWeeklySummary({
    referenceDate: "2026-08-05",
    sessions: [workout("2026-08-03", [[70, 10], [70, 10]]), workout("2026-07-31", [[90, 5]])],
    cardio: [{ performedOn: "2026-08-04", durationMinutes: 35 }, { performedOn: "2026-07-30", durationMinutes: 20 }],
  });

  assert.equal(summary.sessions, 1);
  assert.equal(summary.sets, 2);
  assert.equal(summary.cardioMinutes, 35);
  assert.equal(summary.volumes.find((item) => item.muscleGroup === "Peitoral").sets, 2);
});

test("conta sequencia por meta semanal sem punir a semana em andamento", () => {
  const sessions = [
    workout("2026-07-20", [[10, 10]]), workout("2026-07-22", [[10, 10]]), workout("2026-07-24", [[10, 10]]),
    workout("2026-07-27", [[10, 10]]), workout("2026-07-29", [[10, 10]]), workout("2026-07-31", [[10, 10]]),
    workout("2026-08-03", [[10, 10]]),
  ];

  assert.equal(fitnessUtils.calculateStreak(sessions, 3, "2026-08-04"), 2);
});

test("gera uma nota de treino baseada no volume registrado", () => {
  const session = { ...workout("2026-08-03", Array.from({ length: 10 }, () => [80, 8, 2])), performanceRating: 4, energyLevel: 4 };
  const weekly = fitnessUtils.buildWeeklySummary({ sessions: [session], referenceDate: "2026-08-03" });
  const note = fitnessUtils.buildCoachNote(session, weekly);

  assert.match(note, /10 series/);
  assert.match(note, /faixa planejada/);
  assert.match(note, /desempenho foi boa/);
});
