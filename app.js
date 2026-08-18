/* ============================================================
   ЛОГИКА ПРИЛОЖЕНИЯ
   Всё состояние хранится в localStorage — без сервера и
   регистрации. Это осознанное решение MVP: минус в том, что
   прогресс не переносится между устройствами/браузерами.
   ============================================================ */

const STORAGE_KEY = "kz_state_v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("Не удалось прочитать сохранённое состояние:", e);
    return null;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState() || {
  onboarded: false,
  name: "",
  programId: null,
  branch: null,
  startDate: null, // 'YYYY-MM-DD', день 1 программы
  completedDates: [], // список 'YYYY-MM-DD'
  maxStreak: 0,
};

// ---------- Утилиты дат ----------

function todayStr() {
  return dateStr(new Date());
}

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(dateString, n) {
  const d = new Date(dateString + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d;
}

// Индекс дня программы (1-based) для произвольной даты
function dayIndexFor(dateString) {
  const start = new Date(state.startDate + "T00:00:00");
  const target = new Date(dateString + "T00:00:00");
  const diffMs = target - start;
  return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

// ISO-подобный номер дня недели: 1=Пн ... 7=Вс
function isoWeekday(dateString) {
  const d = new Date(dateString + "T00:00:00");
  const js = d.getDay(); // 0=Вс..6=Сб
  return js === 0 ? 7 : js;
}

function weekFor(dayIndex) {
  return Math.max(1, Math.ceil(dayIndex / 7));
}

// Что за тренировка (или отдых) в конкретный день программы
function getDayInfo(dateString) {
  const dayIndex = dayIndexFor(dateString);
  const program = PROGRAMS[state.programId];
  if (!program) return null;
  if (dayIndex < 1) return { kind: "rest", beforeStart: true };
  if (dayIndex > program.weeks * 7) return { kind: "finished" };

  const week = weekFor(dayIndex);
  const weekday = isoWeekday(dateString);

  let info;
  if (program.needsBranch) {
    info = program.dayFn(state.branch, week, weekday);
  } else {
    info = program.dayFn(week, weekday);
  }
  return { ...info, dayIndex, week };
}

// ---------- Streak ----------
// Streak = число подряд идущих ТРЕНИРОВОЧНЫХ дней, которые
// отмечены выполненными, без пропусков. Дни отдыха не в счёт
// и не разрывают streak.

function computeStreaks() {
  if (!state.startDate) return { current: 0, max: 0 };

  const start = state.startDate;
  const today = todayStr();
  const totalDays = dayIndexFor(today);

  let current = 0;
  let max = 0;
  let running = 0;

  for (let i = 1; i <= totalDays; i++) {
    const d = dateStr(addDays(start, i - 1));
    const info = getDayInfo(d);
    if (!info || info.kind === "rest" || info.kind === "finished") continue;

    const done = state.completedDates.includes(d);
    if (done) {
      running += 1;
      if (running > max) max = running;
    } else {
      // Тренировочный день не отмечен. Если это не сегодня —
      // считаем пропуском, streak прерывается.
      if (d !== today) {
        running = 0;
      }
      // если это сегодня и ещё не отмечено — не обнуляем заранее,
      // просто не засчитываем его
    }
  }
  current = running;
  return { current, max: Math.max(max, state.maxStreak || 0) };
}

// ---------- Экраны ----------

const root = document.getElementById("app");

function render() {
  if (!state.onboarded) {
    renderOnboarding();
  } else {
    renderMain();
  }
}

// ===== Онбординг =====

let onbStep = 0; // 0 = интро, 1 = выбор программы, 2 = выбор ветки (если нужно), 3 = имя
let onbSelectedProgram = null;
let onbSelectedBranch = null;

function renderOnboarding() {
  if (onbStep === 0) return renderOnbIntro();
  if (onbStep === 1) return renderOnbProgram();
  if (onbStep === 2) return renderOnbBranch();
  return renderOnbName();
}

function renderOnbIntro() {
  root.innerHTML = `
    <div class="screen onb-screen">
      <div class="onb-hero" style="background-image:url('mascot-hero.jpg')">
        <div class="onb-hero-overlay"></div>
      </div>
      <div class="onb-pad">
        <div class="kicker">Капитан Закалки</div>
        <h1 class="onb-title">Дисциплина — это не сила воли</h1>
        <p class="onb-lead">Это система, которая работает, когда воли нет. Три готовые программы. Выбери одну и начни сегодня.</p>
        <button class="btn-primary" id="onb-start">Начать</button>
      </div>
    </div>
  `;
  document.getElementById("onb-start").onclick = () => {
    onbStep = 1;
    render();
  };
}

function renderOnbProgram() {
  const cards = Object.values(PROGRAMS)
    .map(
      (p) => `
      <div class="prog-card ${onbSelectedProgram === p.id ? "sel" : ""}" data-id="${p.id}">
        <div>
          <div class="t">${p.title}</div>
          <div class="d">${p.shortDesc}</div>
        </div>
        <div class="radio"></div>
      </div>`
    )
    .join("");

  root.innerHTML = `
    <div class="screen onb-screen">
      <div class="onb-pad">
        <div class="mascot-hole" style="background-image:url('mascot-coach.jpg')"></div>
        <h1 class="onb-title small">Выбери путь</h1>
        <p class="onb-lead">Каждая программа рассчитана на результат — если пройдёшь её честно.</p>
        <div id="prog-list">${cards}</div>
        <button class="btn-primary" id="onb-next" ${onbSelectedProgram ? "" : "disabled"}>Дальше</button>
      </div>
    </div>
  `;
  document.querySelectorAll(".prog-card").forEach((el) => {
    el.onclick = () => {
      onbSelectedProgram = el.dataset.id;
      renderOnbProgram();
    };
  });
  const nextBtn = document.getElementById("onb-next");
  nextBtn.onclick = () => {
    if (!onbSelectedProgram) return;
    const program = PROGRAMS[onbSelectedProgram];
    onbStep = program.needsBranch ? 2 : 3;
    render();
  };
}

function renderOnbBranch() {
  const branches = [
    { id: "cardio", t: "Упор в кардио", d: "Одна силовая в неделю, кардио 2–3 раза" },
    { id: "strength", t: "Упор в силовые", d: "Две силовых в неделю, кардио 2 раза" },
  ];
  const cards = branches
    .map(
      (b) => `
      <div class="prog-card ${onbSelectedBranch === b.id ? "sel" : ""}" data-id="${b.id}">
        <div>
          <div class="t">${b.t}</div>
          <div class="d">${b.d}</div>
        </div>
        <div class="radio"></div>
      </div>`
    )
    .join("");

  root.innerHTML = `
    <div class="screen onb-screen">
      <div class="onb-pad">
        <div class="onb-back" id="onb-back">← Назад</div>
        <h1 class="onb-title small">Какая ветка твоя?</h1>
        <p class="onb-lead">Выбери сам, исходя из того, сколько силовых готов делать в неделю.</p>
        <div id="branch-list">${cards}</div>
        <button class="btn-primary" id="onb-next" ${onbSelectedBranch ? "" : "disabled"}>Дальше</button>
      </div>
    </div>
  `;
  document.getElementById("onb-back").onclick = () => {
    onbStep = 1;
    render();
  };
  document.querySelectorAll(".prog-card").forEach((el) => {
    el.onclick = () => {
      onbSelectedBranch = el.dataset.id;
      renderOnbBranch();
    };
  });
  document.getElementById("onb-next").onclick = () => {
    if (!onbSelectedBranch) return;
    onbStep = 3;
    render();
  };
}

function renderOnbName() {
  root.innerHTML = `
    <div class="screen onb-screen">
      <div class="onb-pad">
        <div class="onb-back" id="onb-back">← Назад</div>
        <h1 class="onb-title small">Как к тебе обращаться?</h1>
        <p class="onb-lead">Это останется только на твоём устройстве.</p>
        <input class="text-input" id="name-input" type="text" placeholder="Имя или ник" maxlength="24" />
        <button class="btn-primary" id="onb-finish">Начать программу</button>
      </div>
    </div>
  `;
  const program = PROGRAMS[onbSelectedProgram];
  document.getElementById("onb-back").onclick = () => {
    onbStep = program.needsBranch ? 2 : 1;
    render();
  };
  const input = document.getElementById("name-input");
  input.focus();
  document.getElementById("onb-finish").onclick = () => {
    const name = input.value.trim() || "Воин";
    state = {
      onboarded: true,
      name,
      programId: onbSelectedProgram,
      branch: onbSelectedBranch,
      startDate: todayStr(),
      completedDates: [],
      maxStreak: 0,
    };
    saveState(state);
    activeTab = "today";
    render();
  };
}

// ===== Основное приложение (после онбординга) =====

let activeTab = "today";
let workoutScreenOpen = false;

function renderMain() {
  if (workoutScreenOpen) return renderWorkoutScreen();
  if (activeTab === "profile") return renderProfile();
  return renderToday();
}

function exerciseListFor(programId, branch, dayInfo) {
  if (programId === "fatloss") {
    const list = dayInfo.workout === "A" ? FULBODY_A : FULBODY_B;
    return { title: dayInfo.workout === "A" ? "Фулбади А" : "Фулбади Б", sets: dayInfo.sets, list };
  }
  return null;
}

function renderToday() {
  const today = todayStr();
  const info = getDayInfo(today);
  const streaks = computeStreaks();
  const program = PROGRAMS[state.programId];
  const done = state.completedDates.includes(today);

  let cardHtml = "";
  if (!info || info.kind === "finished") {
    cardHtml = `
      <div class="today-card">
        <div class="day-label">Программа пройдена 🎖</div>
        <h3>${program.title}</h3>
        <div class="sub">${program.weeks} недель позади. Это финал, а не случайность.</div>
      </div>`;
  } else if (info.kind === "rest") {
    cardHtml = `
      <div class="today-card rest">
        <div class="day-label">День ${info.dayIndex} · Неделя ${info.week}</div>
        <h3>День отдыха</h3>
        <div class="sub">Восстановление — часть программы, а не пауза в ней.</div>
      </div>`;
  } else if (info.kind === "cardio") {
    cardHtml = `
      <div class="today-card">
        <div class="day-label">День ${info.dayIndex} · Неделя ${info.week}</div>
        <h3>Кардио</h3>
        <div class="sub">${info.minutes} минут</div>
        <div class="btn-primary" id="mark-done">${done ? "Отменить отметку" : "Отметить выполненной"}</div>
      </div>`;
  } else if (info.kind === "strength") {
    const w = exerciseListFor("fatloss", state.branch, info);
    cardHtml = `
      <div class="today-card">
        <div class="day-label">День ${info.dayIndex} · Неделя ${info.week}</div>
        <h3>${w.title}</h3>
        <div class="sub">${w.list.length} упражнений · ${w.sets} рабочих подхода</div>
        <div class="btn-primary" id="open-workout">Начать тренировку</div>
        <div class="btn-ghost" id="mark-done">${done ? "Отменить отметку" : "Отметить выполненной"}</div>
      </div>`;
  } else if (info.kind === "isometric") {
    cardHtml = `
      <div class="today-card">
        <div class="day-label">День ${info.dayIndex} · Неделя ${info.week}</div>
        <h3>Изометрия</h3>
        <div class="sub">5 удержаний · ${info.phase.sets} подхода × ${info.phase.time}</div>
        <div class="btn-primary" id="open-workout">Начать тренировку</div>
        <div class="btn-ghost" id="mark-done">${done ? "Отменить отметку" : "Отметить выполненной"}</div>
      </div>`;
  } else if (info.kind === "compound") {
    cardHtml = `
      <div class="today-card">
        <div class="day-label">День ${info.dayIndex} · Неделя ${info.week}</div>
        <h3>Составной стресс</h3>
        <div class="sub">${info.phase.rounds} круг(а) · ${info.phase.load}</div>
        <div class="btn-primary" id="open-workout">Начать тренировку</div>
        <div class="btn-ghost" id="mark-done">${done ? "Отменить отметку" : "Отметить выполненной"}</div>
      </div>`;
  }

  root.innerHTML = `
    <div class="screen">
      <div class="home-pad">
        <div class="streak-row">
          <div class="streak-badge"><span class="flame">🔥</span><b>${streaks.current}</b></div>
          <div class="avatar-dot" style="background-image:url('mascot-hero.jpg')"></div>
        </div>
        <div class="quote-card">
          <div class="quote-label">Мысль дня</div>
          <p>«${quoteForDay(info ? info.dayIndex : 0)}»</p>
        </div>
        ${cardHtml}
      </div>
      ${tabbarHtml("today")}
    </div>
  `;

  bindTabbar();
  const markBtn = document.getElementById("mark-done");
  if (markBtn) {
    markBtn.onclick = () => {
      toggleDone(today);
      render();
    };
  }
  const openBtn = document.getElementById("open-workout");
  if (openBtn) {
    openBtn.onclick = () => {
      workoutScreenOpen = true;
      render();
    };
  }
}

function toggleDone(dateString) {
  const idx = state.completedDates.indexOf(dateString);
  if (idx >= 0) {
    state.completedDates.splice(idx, 1);
  } else {
    state.completedDates.push(dateString);
  }
  const streaks = computeStreaks();
  state.maxStreak = Math.max(state.maxStreak || 0, streaks.max);
  saveState(state);
}

function renderWorkoutScreen() {
  const today = todayStr();
  const info = getDayInfo(today);
  const done = state.completedDates.includes(today);

  let bodyHtml = "";
  let title = "";
  let meta = "";

  if (info.kind === "strength") {
    const w = exerciseListFor("fatloss", state.branch, info);
    title = w.title;
    meta = `${w.sets} рабочих подхода · неделя ${info.week}`;
    bodyHtml = w.list
      .map((ex, i) => {
        const exSets = ex.alwaysThreeSets ? 3 : w.sets;
        return `
        <div class="ex-item">
          <span class="num">${i + 1}</span>
          <span class="name">${ex.name}<span class="${ex.type === "Б" ? "tagB" : "tagI"}">${ex.type}</span></span>
          <span class="reps">${exSets}×${ex.reps}</span>
        </div>`;
      })
      .join("");
  } else if (info.kind === "isometric") {
    title = "Изометрия";
    meta = `${info.phase.sets} подхода × ${info.phase.time} · отдых ${info.phase.rest} сек`;
    bodyHtml = ISOMETRIC_EXERCISES.map(
      (ex, i) => `
        <div class="ex-item stacked">
          <div class="ex-item-top">
            <span class="num">${i + 1}</span>
            <span class="name">${ex.name}</span>
            <span class="reps">${info.phase.time}</span>
          </div>
          <div class="ex-cue">${ex.cue}</div>
        </div>`
    ).join("");
  } else if (info.kind === "compound") {
    title = "Составной стресс";
    meta = `${info.phase.rounds} круг(а) · отдых между кругами ${info.phase.rest} сек`;
    bodyHtml = COMPOUND_BLOCKS.map(
      (block) => `
        <div class="block-title">${block.title}</div>
        ${block.items.map((it) => `<div class="ex-item simple">${it}</div>`).join("")}
      `
    ).join("");
    if (typeof info.phase.load === "string" && info.phase.load.includes("Вариация")) {
      bodyHtml += `<div class="notes-inline">Загляни в описание вариаций на экране профиля/программы — сегодня по плану: ${info.phase.load}.</div>`;
    }
  }

  root.innerHTML = `
    <div class="screen">
      <div class="ex-header">
        <div class="back" id="ex-back">← Назад</div>
        <h3>${title}</h3>
        <div class="meta">${meta}</div>
      </div>
      <div class="ex-list">${bodyHtml}</div>
      <div class="ex-cta">
        <div class="btn-primary" id="ex-done">${done ? "Отменить отметку" : "Отметить выполненной"}</div>
      </div>
    </div>
  `;
  document.getElementById("ex-back").onclick = () => {
    workoutScreenOpen = false;
    render();
  };
  document.getElementById("ex-done").onclick = () => {
    toggleDone(today);
    render();
  };
}

function renderProfile() {
  const streaks = computeStreaks();
  const program = PROGRAMS[state.programId];
  const dayIndex = Math.max(1, dayIndexFor(todayStr()));
  const week = Math.min(program.weeks, weekFor(dayIndex));
  const totalDone = state.completedDates.length;

  root.innerHTML = `
    <div class="screen">
      <div class="profile-head">
        <div class="profile-avatar" style="background-image:url('mascot-hero.jpg')"></div>
        <h3>${state.name}</h3>
        <div class="sub">${program.title}${state.branch ? " · " + (state.branch === "cardio" ? "упор в кардио" : "упор в силовые") : ""} · неделя ${week}</div>
      </div>
      <div class="stat-grid">
        <div class="stat-tile"><div class="val">${streaks.current}</div><div class="lbl">Streak сейчас</div></div>
        <div class="stat-tile"><div class="val">${streaks.max}</div><div class="lbl">Рекорд streak</div></div>
        <div class="stat-tile"><div class="val">${totalDone}</div><div class="lbl">Тренировок всего</div></div>
        <div class="stat-tile"><div class="val">${Math.min(dayIndex, program.weeks * 7)}/${program.weeks * 7}</div><div class="lbl">Дней программы</div></div>
      </div>
      <div class="profile-reset">
        <button class="btn-ghost" id="reset-btn">Сбросить и начать заново</button>
      </div>
      ${tabbarHtml("profile")}
    </div>
  `;
  bindTabbar();
  document.getElementById("reset-btn").onclick = () => {
    if (confirm("Сбросить весь прогресс и пройти онбординг заново?")) {
      localStorage.removeItem(STORAGE_KEY);
      state = { onboarded: false, name: "", programId: null, branch: null, startDate: null, completedDates: [], maxStreak: 0 };
      onbStep = 0;
      onbSelectedProgram = null;
      onbSelectedBranch = null;
      render();
    }
  };
}

function tabbarHtml(active) {
  return `
    <div class="tabbar">
      <div class="tab ${active === "today" ? "active" : ""}" data-tab="today"><span class="ic">●</span>Сегодня</div>
      <div class="tab ${active === "profile" ? "active" : ""}" data-tab="profile"><span class="ic">◐</span>Профиль</div>
    </div>`;
}

function bindTabbar() {
  document.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => {
      activeTab = el.dataset.tab;
      workoutScreenOpen = false;
      render();
    };
  });
}

render();
