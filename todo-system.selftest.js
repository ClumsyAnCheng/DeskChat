const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = __dirname;
const source = fs.readFileSync(path.join(rootDir, "todo.js"), "utf8");
const quickAdd = require("./quick-add-parser");
const goalTaskDetector = require("./goal-task-detector");
const goalDecomposer = require("./goal-decomposer");

const store = {
  todos: [],
  reviews: [],
  focusSessions: [],
  focusTimer: { status: "idle" },
  events: [],
  goals: [],
  categories: [],
  focusDefaultMinutes: 50
};
const createdPayloads = [];
let nextId = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return "2026-06-12T08:00:00.000Z";
}

function makeId(prefix) {
  const id = `${prefix}-${nextId}`;
  nextId += 1;
  return id;
}

function normalizeCategoryName(value) {
  const text = String(value || "").trim().replace(/^#+/, "");
  return text && text !== "Inbox" ? text : "未分类";
}

function returnStore() {
  return clone(store);
}

const app = {
  _html: "",
  set innerHTML(value) {
    this._html = String(value || "");
  },
  get innerHTML() {
    return this._html;
  },
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  }
};

const document = {
  body: {
    appendChild() {}
  },
  addEventListener() {},
  execCommand() {},
  getElementById(id) {
    return id === "todoApp" ? app : null;
  },
  createElement() {
    return {
      className: "",
      style: {},
      dataset: {},
      appendChild() {},
      remove() {},
      setAttribute() {},
      addEventListener() {},
      getBoundingClientRect() {
        return { left: 0, top: 0, bottom: 0, width: 160, height: 40 };
      }
    };
  }
};

const window = {
  DeskchatQuickAddParser: quickAdd,
  DeskchatGoalTaskDetector: goalTaskDetector,
  DeskchatGoalDecomposer: goalDecomposer,
  clearInterval,
  clearTimeout,
  confirm: () => true,
  innerHeight: 900,
  innerWidth: 1200,
  requestAnimationFrame(callback) {
    callback();
    return 0;
  },
  setInterval,
  setTimeout,
  deskchat: {
    getTodos: async () => clone(store),
    onTodosUpdated() {},
    createTodo: async (payload) => {
      const todo = {
        id: makeId("todo"),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: "todo",
        completed: false,
        completedAt: null,
        archivedAt: "",
        deletedAt: "",
        tags: [],
        subtasks: [],
        ...payload
      };
      createdPayloads.push(clone(payload));
      store.todos.unshift(todo);
      return returnStore();
    },
    saveTodo: async (payload) => {
      const id = String(payload && payload.id || "");
      const index = store.todos.findIndex((todo) => todo.id === id);
      if (index < 0) return returnStore();
      const existing = store.todos[index];
      const requestedStatus = payload.status ? String(payload.status) : "";
      const completed = requestedStatus === "archived"
        ? false
        : requestedStatus === "done"
          ? true
          : payload.completed === undefined ? existing.completed : Boolean(payload.completed);
      store.todos[index] = {
        ...existing,
        ...payload,
        id,
        status: requestedStatus === "archived" ? "archived" : completed ? "done" : "todo",
        completed,
        completedAt: completed ? existing.completedAt || nowIso() : "",
        updatedAt: nowIso()
      };
      return returnStore();
    },
    deleteTodo: async (id) => {
      const targetId = String(id || "");
      store.todos = store.todos.filter((todo) => todo.id !== targetId);
      return returnStore();
    },
    toggleTodo: async (id, completed) => {
      const target = store.todos.find((todo) => todo.id === String(id || ""));
      if (!target) return returnStore();
      target.completed = typeof completed === "boolean" ? completed : !target.completed;
      target.status = target.completed ? "done" : "todo";
      target.completedAt = target.completed ? nowIso() : "";
      target.updatedAt = nowIso();
      return returnStore();
    },
    setAllTodosCompleted: async (completed) => {
      store.todos = store.todos.map((todo) => ({
        ...todo,
        completed: Boolean(completed),
        status: completed ? "done" : "todo",
        completedAt: completed ? todo.completedAt || nowIso() : "",
        updatedAt: nowIso()
      }));
      return returnStore();
    },
    saveTodoCategory: async (payload) => {
      const name = normalizeCategoryName(payload && (payload.name || payload.id));
      if (!store.categories.some((category) => normalizeCategoryName(category.name || category.id) === name)) {
        store.categories.unshift({ id: name, name, color: payload && payload.color || "#94a3b8" });
      }
      return returnStore();
    },
    renameTodoCategory: async (payload) => {
      const oldName = normalizeCategoryName(payload && payload.oldName);
      const newName = normalizeCategoryName(payload && payload.newName);
      if (!oldName || !newName) return returnStore();
      store.categories = store.categories.map((category) =>
        normalizeCategoryName(category.name || category.id) === oldName
          ? { ...category, id: newName, name: newName }
          : category
      );
      const move = (value) => normalizeCategoryName(value) === oldName ? newName : value;
      store.todos = store.todos.map((todo) => ({ ...todo, project: move(todo.project), categoryId: move(todo.categoryId) }));
      store.goals = store.goals.map((goal) => ({ ...goal, categoryId: move(goal.categoryId) }));
      store.focusSessions = store.focusSessions.map((session) => ({ ...session, project: move(session.project), categoryId: move(session.categoryId) }));
      return returnStore();
    },
    deleteTodoCategory: async (name) => {
      const target = normalizeCategoryName(name);
      store.categories = store.categories.filter((category) => normalizeCategoryName(category.name || category.id) !== target);
      const move = (value) => normalizeCategoryName(value) === target ? "未分类" : value;
      store.todos = store.todos.map((todo) => ({ ...todo, project: move(todo.project), categoryId: move(todo.categoryId) }));
      store.goals = store.goals.map((goal) => ({ ...goal, categoryId: move(goal.categoryId) }));
      store.focusSessions = store.focusSessions.map((session) => ({ ...session, project: move(session.project), categoryId: move(session.categoryId) }));
      return returnStore();
    },
    saveTodoGoal: async (payload) => {
      const id = String(payload && payload.id || "");
      const index = id ? store.goals.findIndex((goal) => goal.id === id) : -1;
      const goal = {
        ...(index >= 0 ? store.goals[index] : {}),
        ...payload,
        id: index >= 0 ? id : makeId("goal"),
        status: payload && payload.status || "active",
        createdAt: index >= 0 ? store.goals[index].createdAt : nowIso(),
        updatedAt: nowIso()
      };
      if (index >= 0) store.goals[index] = goal;
      else store.goals.unshift(goal);
      return returnStore();
    },
    archiveTodoGoal: async (id) => {
      const goal = store.goals.find((item) => item.id === String(id || ""));
      if (goal) {
        goal.status = "archived";
        goal.updatedAt = nowIso();
      }
      return returnStore();
    },
    startTodoTimer: async (id, minutes) => {
      const target = store.todos.find((todo) => todo.id === String(id || ""));
      if (!target) return returnStore();
      const plannedMinutes = Number(minutes) || store.focusDefaultMinutes || 50;
      store.focusTimer = {
        status: "running",
        taskId: target.id,
        todoId: target.id,
        title: target.title,
        categoryId: target.categoryId,
        goalId: target.goalId || "",
        project: target.project,
        startedAt: nowIso(),
        lastStartedAt: nowIso(),
        plannedMinutes,
        remainingSeconds: plannedMinutes * 60
      };
      return returnStore();
    },
    pauseTodoTimer: async () => {
      if (store.focusTimer.status === "running") {
        store.focusTimer = { ...store.focusTimer, status: "paused", pausedAt: nowIso(), lastStartedAt: "" };
      }
      return returnStore();
    },
    resumeTodoTimer: async () => {
      if (store.focusTimer.status === "paused") {
        store.focusTimer = { ...store.focusTimer, status: "running", pausedAt: "", lastStartedAt: nowIso() };
      }
      return returnStore();
    },
    completeTodoTimer: async () => {
      if (["running", "paused"].includes(store.focusTimer.status)) {
        store.focusSessions.push({
          id: makeId("focus"),
          taskId: store.focusTimer.taskId,
          todoId: store.focusTimer.todoId,
          goalId: store.focusTimer.goalId,
          categoryId: store.focusTimer.categoryId,
          project: store.focusTimer.project,
          title: store.focusTimer.title,
          status: "completed",
          plannedMinutes: store.focusTimer.plannedMinutes,
          durationMinutes: store.focusTimer.plannedMinutes,
          minutes: store.focusTimer.plannedMinutes,
          startedAt: store.focusTimer.startedAt,
          endedAt: nowIso()
        });
        store.focusTimer = { status: "idle", plannedMinutes: store.focusDefaultMinutes };
      }
      return returnStore();
    },
    abandonTodoTimer: async () => {
      if (["running", "paused"].includes(store.focusTimer.status)) {
        store.focusSessions.push({
          id: makeId("focus"),
          taskId: store.focusTimer.taskId,
          todoId: store.focusTimer.todoId,
          title: store.focusTimer.title,
          status: "abandoned",
          durationMinutes: 1,
          minutes: 1,
          startedAt: store.focusTimer.startedAt,
          endedAt: nowIso()
        });
        store.focusTimer = { status: "idle", plannedMinutes: store.focusDefaultMinutes };
      }
      return returnStore();
    }
  }
};

const context = vm.createContext({
  console,
  document,
  window,
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout
});

vm.runInContext(source, context, { filename: "todo.js" });

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeCreateForm(title, selectedDate = "") {
  const element = (value = "") => ({ value });
  return {
    dataset: { selectedDate },
    elements: {
      title: element(title),
      notes: element(""),
      subtasks: element(""),
      project: element(""),
      priority: element("medium"),
      dueDate: element(""),
      waitingFor: element(""),
      waitingUntil: element(""),
      repeat: element("none"),
      estimateMinutes: element(""),
      tags: element("")
    },
    querySelector() {
      return { disabled: false };
    }
  };
}

function makeEditForm(values = {}) {
  const element = (value = "") => ({ value });
  return {
    elements: {
      title: element(values.title || ""),
      notes: element(values.notes || ""),
      project: element(values.project || "未分类"),
      priority: element(values.priority || "medium"),
      dueDate: element(values.dueDate || ""),
      startTime: element(values.startTime || ""),
      waitingFor: element(values.waitingFor || ""),
      waitingUntil: element(values.waitingUntil || ""),
      repeat: element(values.repeat || "none"),
      estimateMinutes: element(values.estimateMinutes || ""),
      tags: element(values.tags || ""),
      subtasks: element(values.subtasks || "")
    },
    querySelector() {
      return { disabled: false };
    }
  };
}

function makeGoalForm(values = {}) {
  const element = (value = "") => ({ value });
  return {
    dataset: { goalId: values.id || "" },
    elements: {
      title: element(values.title || ""),
      categoryId: element(values.categoryId || "未分类"),
      deadline: element(values.deadline || ""),
      targetCount: element(values.targetCount || ""),
      currentCount: element(values.currentCount || ""),
      targetScore: element(values.targetScore || ""),
      currentAverageScore: element(values.currentAverageScore || ""),
      status: element(values.status || "active")
    },
    querySelector() {
      return { disabled: false };
    }
  };
}

function makeGoalTaskForm(values = {}) {
  const element = (value = "") => ({ value });
  return {
    elements: {
      title: element(values.title || ""),
      priority: element(values.priority || "medium"),
      dueDate: element(values.dueDate || ""),
      estimateMinutes: element(values.estimateMinutes || "")
    },
    querySelector() {
      return { disabled: false };
    }
  };
}

(async () => {
  await flush();

  assert.match(source, /data-top-quick/, "top quick input must be rendered by the main app");
  assert.match(source, /querySelectorAll\("\[data-create-form\]"\)\.forEach/, "all quick-create forms must be bound");
  assert.match(app.innerHTML, /data-top-quick/, "initial render should show the top quick input");
  assert.match(app.innerHTML, /顶部快速输入/, "top quick input should be labeled clearly");
  assert.doesNotMatch(app.innerHTML, /\bNaN\b|Infinity/, "empty render should not show invalid numbers");

  const emptyStateChecks = {
    today: /这一天还没有任务|暂无任务/,
    inbox: /收集箱是空的/,
    calendar: /这一天还没有任务/,
    recent: /暂无最近任务|没有积压任务|没有未分类的无日期任务/,
    goals: /还没有学习目标/,
    review: /暂无数据/,
    completed: /还没有完成任务/,
    trash: /回收站是空的/,
    category: /这个分类暂无任务/
  };
  for (const view of ["today", "inbox", "calendar", "recent", "goals", "review", "completed", "trash", "focus"]) {
    vm.runInContext(`activeView = ${JSON.stringify(view)}; render();`, context);
    assert.match(app.innerHTML, /data-top-quick/, `${view} should keep the top quick input visible`);
    assert.doesNotMatch(app.innerHTML, /\bNaN\b|Infinity/, `${view} should not show invalid numbers`);
    if (emptyStateChecks[view]) {
      assert.match(app.innerHTML, emptyStateChecks[view], `${view} should render an empty state`);
    }
  }
  vm.runInContext('activeView = "category"; activeCategory = "数学"; render();', context);
  assert.match(app.innerHTML, emptyStateChecks.category, "category should render an empty state");

  const parseQuickDueDate = vm.runInContext("parseQuickDueDate", context);
  const localDateKey = vm.runInContext("localDateKey", context);
  assert.equal(parseQuickDueDate("2026-99-99"), "", "invalid ISO dates should be ignored");

  const createTodo = vm.runInContext("createTodo", context);
  const applyStore = vm.runInContext("applyStore", context);
  await createTodo(makeCreateForm("明天 19:00 数学真题 2h #数学 !高"));
  const quickPayload = createdPayloads.at(-1);
  assert.equal(quickPayload.title, "数学真题");
  assert.equal(quickPayload.dueDate.length, 10);
  assert.equal(quickPayload.startTime, "19:00");
  assert.equal(quickPayload.estimateMinutes, 120);
  assert.equal(quickPayload.categoryId, "数学");
  assert.equal(quickPayload.priority, "high");
  assert.deepEqual(quickPayload.tags, ["数学"]);
  assert.match(app.innerHTML, /数学真题/, "created tasks should survive a reload from the store");

  const selectedDateKey = vm.runInContext("selectedDateKey", context);
  assert.equal(selectedDateKey(), localDateKey(), "Today should default to the local current date");

  await createTodo(makeCreateForm("普通任务", "2026-06-15"));
  const datedPayload = createdPayloads.at(-1);
  assert.equal(datedPayload.title, "普通任务");
  assert.equal(datedPayload.dueDate, "2026-06-15", "top quick input should inherit selected dates");
  vm.runInContext('selectedDate = "2026-06-15"; activeView = "today"; render();', context);
  assert.equal(selectedDateKey(), "2026-06-15", "Today should switch selected dates");
  assert.match(app.innerHTML, /普通任务/, "Today should show tasks for the selected date");

  const saveTodo = vm.runInContext("saveTodo", context);
  const selectedTodo = store.todos.find((todo) => todo.title === "普通任务");
  await saveTodo(makeEditForm({
    title: "普通任务已编辑",
    project: "英语",
    priority: "high",
    dueDate: "2026-06-16",
    estimateMinutes: "45m",
    tags: "编辑"
  }), selectedTodo.id);
  const editedTodo = store.todos.find((todo) => todo.id === selectedTodo.id);
  assert.equal(editedTodo.title, "普通任务已编辑", "Inbox editing should update titles");
  assert.equal(editedTodo.categoryId, "英语", "Inbox editing should update categories");
  assert.equal(editedTodo.dueDate, "2026-06-16", "Inbox editing should update dates");
  assert.equal(editedTodo.priority, "high", "Inbox editing should update priorities");

  await createTodo(makeCreateForm("今天完成项", localDateKey()));
  const todayDone = store.todos.at(0);
  applyStore(await window.deskchat.toggleTodo(todayDone.id, true));
  vm.runInContext("todayCompletedExpanded = false; activeView = 'today'; selectedDate = localDateKey(); render();", context);
  assert.match(app.innerHTML, /data-toggle-today-completed/, "Today should render a collapsed completed group");

  await createTodo(makeCreateForm("过期提醒任务", "2000-01-01"));
  vm.runInContext("activeView = 'today'; selectedDate = localDateKey(); render();", context);
  assert.match(app.innerHTML, /data-today-overdue/, "Today should show an overdue reminder");

  await createTodo(makeCreateForm("日历任务一", "2026-06-15"));
  await createTodo(makeCreateForm("日历任务二", "2026-06-15"));
  await createTodo(makeCreateForm("日历任务三", "2026-06-15"));
  vm.runInContext('activeView = "calendar"; selectedDate = "2026-06-15"; calendarMonth = "2026-06"; render();', context);
  assert.match(app.innerHTML, /\+\d+/, "calendar day summaries should collapse extra tasks with +N");
  const shiftMonthKey = vm.runInContext("shiftMonthKey", context);
  assert.equal(shiftMonthKey("2026-06", 1), "2026-07", "Calendar should switch to the next month");
  assert.equal(shiftMonthKey("2026-06", -1), "2026-05", "Calendar should switch to the previous month");

  const saveCategoryAction = vm.runInContext("saveCategoryAction", context);
  const renameCategoryAction = vm.runInContext("renameCategoryAction", context);
  const deleteCategoryAction = vm.runInContext("deleteCategoryAction", context);
  await saveCategoryAction("物理");
  const categoryForm = makeCreateForm("分类任务");
  categoryForm.elements.project.value = "物理";
  await createTodo(categoryForm);
  const categorizedTodo = store.todos.at(0);
  assert.equal(categorizedTodo.categoryId, "物理", "category quick create should save categoryId");
  const categoryRows = vm.runInContext("categoryRows", context);
  assert.ok(categoryRows().some((row) => row.category === "物理" && row.count >= 1), "Category rows should count tasks");
  await renameCategoryAction("物理", "化学");
  assert.equal(store.todos.find((todo) => todo.id === categorizedTodo.id).categoryId, "化学", "category editing should move tasks");
  assert.ok(store.categories.some((category) => category.name === "化学"), "category editing should rename the category");
  await deleteCategoryAction("化学");
  assert.equal(store.todos.find((todo) => todo.id === categorizedTodo.id).categoryId, "未分类", "deleted categories should move tasks to uncategorized");
  await saveCategoryAction("物理");
  const categoryFormTwo = makeCreateForm("分类任务二");
  categoryFormTwo.elements.project.value = "物理";
  await createTodo(categoryFormTwo);
  const categorizedTodoTwo = store.todos.at(0);
  await deleteCategoryAction("物理");
  const movedTodo = store.todos.find((todo) => todo.id === categorizedTodoTwo.id);
  assert.equal(movedTodo.categoryId, "未分类", "deleted categories should move tasks to uncategorized");

  const updateTodoAction = vm.runInContext("updateTodoAction", context);
  const archiveTodoAction = vm.runInContext("archiveTodoAction", context);
  const restoreArchivedTodoAction = vm.runInContext("restoreArchivedTodoAction", context);
  const permanentlyDeleteTodoAction = vm.runInContext("permanentlyDeleteTodoAction", context);
  await createTodo(makeCreateForm("生命周期任务"));
  const lifecycleTodo = store.todos.at(0);
  await updateTodoAction(lifecycleTodo.id, { status: "done", completed: true });
  assert.equal(store.todos.find((todo) => todo.id === lifecycleTodo.id).status, "done", "tasks should complete");
  await archiveTodoAction(store.todos.find((todo) => todo.id === lifecycleTodo.id));
  assert.equal(store.todos.find((todo) => todo.id === lifecycleTodo.id).status, "archived", "tasks should archive");
  await restoreArchivedTodoAction(store.todos.find((todo) => todo.id === lifecycleTodo.id));
  assert.equal(store.todos.find((todo) => todo.id === lifecycleTodo.id).status, "todo", "archived tasks should restore");

  await createTodo(makeCreateForm("无日期任务"));
  const undatedTodo = store.todos.at(0);
  await createTodo(makeCreateForm("即将到期任务", localDateKey()));
  await createTodo(makeCreateForm("很早过期任务", "2001-01-01"));
  const recentOverdueTodos = vm.runInContext("recentOverdueTodos", context);
  const recentUndatedTodos = vm.runInContext("recentUndatedTodos", context);
  const recentUpcomingTodos = vm.runInContext("recentUpcomingTodos", context);
  assert.ok(recentOverdueTodos().some((todo) => todo.title === "很早过期任务"), "Recent should include overdue tasks");
  assert.ok(recentUndatedTodos().some((todo) => todo.id === undatedTodo.id), "Recent should include undated tasks");
  assert.ok(recentUpcomingTodos().some((todo) => todo.title === "即将到期任务"), "Recent should include upcoming tasks");
  const rescheduleRecentOverdueAction = vm.runInContext("rescheduleRecentOverdueAction", context);
  const scheduleRecentUndatedAction = vm.runInContext("scheduleRecentUndatedAction", context);
  await rescheduleRecentOverdueAction();
  assert.equal(store.todos.find((todo) => todo.title === "很早过期任务").dueDate, localDateKey(), "Recent should batch reschedule overdue tasks");
  await scheduleRecentUndatedAction();
  assert.ok(store.todos.find((todo) => todo.id === undatedTodo.id).dueDate, "Recent should batch schedule undated tasks");

  const saveGoal = vm.runInContext("saveGoal", context);
  const archiveGoalAction = vm.runInContext("archiveGoalAction", context);
  const createGoalTask = vm.runInContext("createGoalTask", context);
  const createGoalWeekTasks = vm.runInContext("createGoalWeekTasks", context);
  const convertTodoToGoal = vm.runInContext("convertTodoToGoal", context);
  const goalProgressInfo = vm.runInContext("goalProgressInfo", context);
  await saveGoal(makeGoalForm({
    title: "数学 10 套卷",
    categoryId: "数学",
    deadline: "2026-08-01",
    targetCount: "10",
    currentCount: "2",
    status: "active"
  }));
  const goal = store.goals.at(0);
  assert.equal(goal.title, "数学 10 套卷", "Goals should create goals");
  await saveGoal(makeGoalForm({
    id: goal.id,
    title: "数学 10 套卷编辑",
    categoryId: "数学",
    deadline: "2026-08-01",
    targetCount: "10",
    currentCount: "5",
    status: "active"
  }));
  const editedGoal = store.goals.find((item) => item.id === goal.id);
  assert.equal(editedGoal.title, "数学 10 套卷编辑", "Goals should edit goals");
  assert.equal(goalProgressInfo(editedGoal).percent, 50, "Goals should calculate progress");
  await createGoalTask(makeGoalTaskForm({ title: "目标关联任务", dueDate: "2026-06-20", estimateMinutes: "50m" }), editedGoal);
  assert.ok(store.todos.some((todo) => todo.goalId === editedGoal.id && todo.title === "目标关联任务"), "Goals should create tasks from goals");
  const beforeBreakdownCount = store.todos.length;
  await createGoalWeekTasks(editedGoal);
  assert.ok(store.todos.length > beforeBreakdownCount, "Goals should create weekly breakdown tasks");
  await createTodo(makeCreateForm("八月底完成 30 套试卷 #数学"));
  const convertSource = store.todos.at(0);
  await convertTodoToGoal(makeGoalForm({
    title: "八月底完成 30 套试卷",
    categoryId: "数学",
    deadline: "2026-08-31",
    targetCount: "30",
    targetScore: "120"
  }), convertSource);
  assert.equal(store.todos.find((todo) => todo.id === convertSource.id).status, "archived", "goal conversion should archive source tasks");
  assert.ok(store.goals.some((item) => item.title === "八月底完成 30 套试卷"), "goal conversion should create a goal");
  await archiveGoalAction(editedGoal);
  assert.equal(store.goals.find((item) => item.id === editedGoal.id).status, "archived", "Goals should archive goals");

  const startFocusFromForm = vm.runInContext("startFocusFromForm", context);
  await createTodo(makeCreateForm("番茄任务 #408"));
  const focusTodo = store.todos.at(0);
  await startFocusFromForm({
    elements: {
      todoId: { value: focusTodo.id },
      focusMinutes: { value: "25" }
    }
  });
  assert.equal(store.focusTimer.status, "running", "focus timer should start from a task");
  applyStore(await window.deskchat.pauseTodoTimer());
  assert.equal(store.focusTimer.status, "paused", "focus timer should pause");
  applyStore(await window.deskchat.resumeTodoTimer());
  assert.equal(store.focusTimer.status, "running", "focus timer should resume");
  applyStore(await window.deskchat.completeTodoTimer());
  assert.equal(store.focusSessions.at(-1).status, "completed", "completed focus timer should create a FocusSession");
  await startFocusFromForm({
    elements: {
      todoId: { value: focusTodo.id },
      focusMinutes: { value: "25" }
    }
  });
  applyStore(await window.deskchat.abandonTodoTimer());
  assert.equal(store.focusSessions.at(-1).status, "abandoned", "abandoned focus timer should create a FocusSession");

  applyStore(await window.deskchat.saveTodoGoal({ title: "408 强化", categoryId: "408", targetCount: 10, currentCount: 2 }));
  const goalCountBeforeDelete = store.goals.length;
  const focusCountBeforeDelete = store.focusSessions.length;
  await permanentlyDeleteTodoAction(focusTodo);
  assert.equal(store.todos.some((todo) => todo.id === focusTodo.id), false, "permanent delete should remove only the task");
  assert.equal(store.goals.length, goalCountBeforeDelete, "permanent task delete should keep goals");
  assert.equal(store.focusSessions.length, focusCountBeforeDelete, "permanent task delete should keep focus history");

  store.focusSessions.push({
    taskId: "deleted-task",
    title: "已删除任务的番茄",
    status: "completed",
    durationMinutes: 50,
    endedAt: "2026-06-12T09:00:00.000Z"
  });
  vm.runInContext('activeView = "review"; render();', context);
  assert.match(app.innerHTML, /复盘/, "review page should render after task deletion");
  assert.doesNotMatch(app.innerHTML, /\bNaN\b|Infinity/, "review page should stay numeric-safe after task deletion");

  console.log("todo-system selftest ok");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
