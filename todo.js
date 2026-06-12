const app = document.getElementById("todoApp");

let todos = [];
let filter = "all";
let search = "";
let tagFilter = "";
let projectFilter = "";
let sortMode = "smart";
let editingId = null;
let contextMenu = null;
let todoBusy = false;
let todoError = "";
let todoNotice = "";
let timerRenderInterval = null;
let reviews = [];
let focusSessions = [];
let focusTimer = null;
let focusAutoCompleting = false;
let events = [];
let goals = [];
let categories = [];
let focusDefaultMinutes = 50;
let activeView = "today";
let activeCategory = "未分类";
let isCreatingCategory = false;
let customCategories = [];
let editingCategory = "";
let categoryCompletedExpanded = false;
let reviewType = "daily";
let selectedDate = "";
let todayCompletedExpanded = false;
let recentCollapsedGroups = new Set();
let calendarMonth = "";
let calendarCompletedExpanded = false;
let editingGoalId = "";
let selectedGoalId = "";
let convertingGoalTodoId = "";
let sidebarCollapsed = false;

function escapeHtml(value) {
  if (window.DeskchatRichRenderer && window.DeskchatRichRenderer.escapeHtml) {
    return window.DeskchatRichRenderer.escapeHtml(value);
  }
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, delay = 180) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function closeContextMenu() {
  if (contextMenu) contextMenu.remove();
  contextMenu = null;
}

function contextMenuCommand(command) {
  if (typeof document.execCommand === "function") document.execCommand(command);
}

function textFieldContextItems(field) {
  const value = typeof field.value === "string" ? field.value : "";
  const hasSelection = typeof field.selectionStart === "number"
    && typeof field.selectionEnd === "number"
    && field.selectionStart !== field.selectionEnd;
  const editable = !field.disabled && !field.readOnly;
  return [
    { label: "剪切", disabled: !editable || !hasSelection, action: () => contextMenuCommand("cut") },
    { label: "复制", disabled: !hasSelection, action: () => contextMenuCommand("copy") },
    { label: "粘贴", disabled: !editable, action: () => contextMenuCommand("paste") },
    { type: "separator" },
    {
      label: "全选",
      disabled: !value.length,
      action: () => {
        field.focus();
        if (typeof field.select === "function") field.select();
      }
    }
  ];
}

function openContextMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  const textField = event.target && event.target.closest && event.target.closest("input, textarea");
  const available = (textField ? textFieldContextItems(textField) : items).filter(Boolean);
  if (!available.length) return;
  openMenuAt(event.clientX, event.clientY, available);
}

function bindContextMenu(target, itemsFactory) {
  if (!target) return;
  target.addEventListener("contextmenu", (event) => openContextMenu(event, itemsFactory()));
}

function openMenuAt(left, top, items) {
  closeContextMenu();

  const available = (items || []).filter(Boolean);
  if (!available.length) return;

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");
  for (const item of available) {
    if (item.type === "separator") {
      const separator = document.createElement("div");
      separator.className = "context-menu-separator";
      menu.appendChild(separator);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.role = "menuitem";
    button.textContent = item.label;
    if (item.danger) button.classList.add("danger-text");
    if (item.disabled) button.disabled = true;
    button.addEventListener("click", async () => {
      closeContextMenu();
      if (!item.disabled && item.action) await item.action();
    });
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const x = Number.isFinite(left) ? left : 8;
  const y = Number.isFinite(top) ? top : 8;
  const clampedLeft = Math.min(window.innerWidth - rect.width - 8, Math.max(8, x));
  const clampedTop = Math.min(window.innerHeight - rect.height - 8, Math.max(8, y));
  menu.style.left = `${clampedLeft}px`;
  menu.style.top = `${clampedTop}px`;
  contextMenu = menu;
}

function openAnchoredMenu(anchor, items) {
  if (!anchor || typeof anchor.getBoundingClientRect !== "function") return;
  const rect = anchor.getBoundingClientRect();
  openMenuAt(rect.left, rect.bottom + 4, items);
}

async function confirmAction(message, options = {}) {
  if (window.deskchat && typeof window.deskchat.confirmAction === "function") {
    return window.deskchat.confirmAction({
      title: options.title || "确认操作",
      message,
      detail: options.detail || "",
      confirmLabel: options.confirmLabel || "确认",
      cancelLabel: options.cancelLabel || "取消",
      danger: options.danger !== false
    });
  }
  return window.confirm(message);
}

document.addEventListener("contextmenu", (event) => {
  if (event.target && event.target.closest && event.target.closest("input, textarea")) {
    openContextMenu(event, []);
  }
});

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function periodKeyFor(type, date = new Date()) {
  const target = new Date(date);
  if (type === "monthly") {
    return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
  }
  if (type === "weekly") {
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const weekStart = startOfWeek(target);
    const firstWeekStart = startOfWeek(firstThursday);
    const week = Math.floor((weekStart - firstWeekStart) / 604800000) + 1;
    return `${weekStart.getFullYear()}-W${String(Math.max(1, week)).padStart(2, "0")}`;
  }
  return localDateKey(target);
}

function periodRange(type, key) {
  if (type === "monthly") {
    const match = String(key || "").match(/^(\d{4})-(\d{2})$/);
    if (!match) return { start: localDateKey(), end: localDateKey() };
    const start = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    const end = new Date(Number(match[1]), Number(match[2]), 0);
    return { start: localDateKey(start), end: localDateKey(end) };
  }
  if (type === "weekly") {
    const match = String(key || "").match(/^(\d{4})-W(\d{2})$/);
    if (!match) return { start: localDateKey(startOfWeek()), end: localDateKey() };
    const firstWeekStart = startOfWeek(new Date(Number(match[1]), 0, 4));
    const start = new Date(firstWeekStart);
    start.setDate(start.getDate() + (Number(match[2]) - 1) * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: localDateKey(start), end: localDateKey(end) };
  }
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(key || "")) ? String(key) : localDateKey();
  return { start: day, end: day };
}

function periodLabel(type, key) {
  if (type === "monthly") return `${key} 月复盘`;
  if (type === "weekly") return `${key} 周复盘`;
  return `${key} 日复盘`;
}

function isDateInRange(value, range) {
  const key = String(value || "").slice(0, 10);
  return key && key >= range.start && key <= range.end;
}

function formatDateLabel(value) {
  if (!value) return "无截止日期";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", weekday: "short" }).format(date);
}

function formatWeekday(value) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date);
}

function priorityLabel(priority) {
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
}

function normalizePriority(priority) {
  const value = String(priority || "medium");
  if (value === "normal") return "medium";
  return ["low", "medium", "high"].includes(value) ? value : "medium";
}

function parseTags(value) {
  return String(value || "")
    .split(/[,\s，、#]+/g)
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeProject(value) {
  return String(value || "").trim().slice(0, 48) || "Inbox";
}

const STUDY_CATEGORY_NAMES = ["数学", "408", "英语", "C++", "信息学竞赛"];
const NAV_CATEGORY_NAMES = ["未分类", "英语", "C++", "信息学竞赛", "408", "数学"];
const CATEGORY_COLOR_FALLBACKS = ["#94a3b8", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#3b82f6", "#2f7d73"];
const RECENT_GOAL_KEYWORDS = ["月底", "完成", "套", "均分", "基础", "强化", "冲刺", "报名前"];
const CORE_NAV_ITEMS = [
  ["today", "今日"],
  ["inbox", "收集箱"],
  ["calendar", "日历"],
  ["recent", "最近"],
  ["goals", "目标"],
  ["review", "复盘"]
];
const OTHER_NAV_ITEMS = [
  ["completed", "已完成"],
  ["trash", "回收站"]
];

function normalizeCategoryId(value) {
  const text = String(value || "").trim().replace(/^#+/, "").slice(0, 80);
  if (!text) return "";
  return STUDY_CATEGORY_NAMES.find((name) => name.toLowerCase() === text.toLowerCase()) || text;
}

function studyCategoryFromTag(tag) {
  const categoryId = normalizeCategoryId(tag);
  return STUDY_CATEGORY_NAMES.some((name) => name.toLowerCase() === categoryId.toLowerCase()) ? categoryId : "";
}

function applyQuickCategory(patch, tag, options = {}) {
  const categoryId = studyCategoryFromTag(tag);
  if (!categoryId) return;
  patch.categoryId = patch.categoryId || categoryId;
  if (options.setProject && !patch.project) patch.project = categoryId;
}

function categoryNameFromId(value) {
  const categoryId = normalizeCategoryId(value);
  if (!categoryId) return "";
  const match = categories.find((category) =>
    normalizeCategoryId(category.id) === categoryId || normalizeCategoryId(category.name) === categoryId
  );
  return match ? String(match.name || match.id || categoryId).trim() : categoryId;
}

function todoCategoryName(todo) {
  return categoryNameFromId(todo && (todo.categoryId || todo.project)) || normalizeProject(todo && todo.project);
}

function focusSessionMinutes(session) {
  const minutes = Number(session && (session.durationMinutes || session.minutes));
  return Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
}

function focusSessionCategoryName(session) {
  return categoryNameFromId(session && (session.categoryId || session.project)) || normalizeProject(session && session.project);
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeCount(value) {
  return Math.max(0, Math.round(safeNumber(value, 0)));
}

function safePercent(value, total) {
  const numerator = Math.max(0, safeNumber(value, 0));
  const denominator = Math.max(0, safeNumber(total, 0));
  if (!denominator) return 0;
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function formatPercent(value) {
  return `${safeCount(value)}%`;
}

function goalNameFromId(value) {
  const id = String(value || "").trim();
  if (!id) return "";
  const match = goals.find((goal) => String(goal.id || "") === id || String(goal.title || "") === id);
  return match ? String(match.title || match.id || id).trim() : id;
}

function detectGoalLikeTask(title) {
  const detector = window.DeskchatGoalTaskDetector && window.DeskchatGoalTaskDetector.detectGoalLikeTask;
  return typeof detector === "function" ? detector(title) : false;
}

function parseGoalLikeTodo(todo) {
  const parser = window.DeskchatGoalTaskDetector && window.DeskchatGoalTaskDetector.parseGoalLikeTask;
  const title = String((todo && todo.title) || "").trim();
  const categoryId = todoCategoryName(todo);
  if (typeof parser !== "function") {
    return {
      isGoalLike: false,
      title,
      deadline: "",
      targetCount: 0,
      targetScore: 0,
      categoryId,
      status: "active"
    };
  }
  return parser(title, {
    today: localDateKey(),
    categoryId
  });
}

function categoryRows() {
  const rows = new Map();
  const ensure = (name) => {
    const category = categoryNameFromId(name) || normalizeCategoryId(name);
    if (!category) return null;
    if (!rows.has(category)) rows.set(category, { category, count: 0 });
    return rows.get(category);
  };
  STUDY_CATEGORY_NAMES.forEach(ensure);
  categories.forEach((category) => ensure(category.name || category.id));
  todos.forEach((todo) => {
    const row = ensure(todoCategoryName(todo));
    if (row) row.count += 1;
  });
  return [...rows.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category, "zh-CN"));
}

function repeatLabel(repeat) {
  if (repeat === "daily") return "每天";
  if (repeat === "weekly") return "每周";
  if (repeat === "monthly") return "每月";
  return "不重复";
}

function parseMinutes(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return 0;
  const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(h|hour|hours|小时)/);
  const minuteMatch = text.match(/(\d+)\s*(m|min|分钟)/);
  let total = 0;
  if (hourMatch) total += Math.round(Number(hourMatch[1]) * 60);
  if (minuteMatch) total += Number(minuteMatch[1]);
  if (!total && /^\d+$/.test(text)) total = Number(text);
  return Math.max(0, Math.min(Number.isFinite(total) ? total : 0, 100000));
}

function quickTokenValue(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const quoted = text.match(/^["“](.*)["”]$/);
  return (quoted ? quoted[1] : text).trim();
}

function consumeQuickToken(source, marker, pattern, handler) {
  return String(source || "").replace(pattern, (match, value) => {
    const parsed = quickTokenValue(value);
    if (parsed) handler(parsed);
    return marker && match.startsWith(marker) ? "" : " ";
  });
}

function shiftDateKey(days, base = new Date()) {
  const date = new Date(base);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function nextWeekdayDateKey(targetDay, base = new Date(), forceNextWeek = false) {
  const today = base.getDay();
  if (forceNextWeek) {
    const currentWeekIndex = (today + 6) % 7;
    const targetWeekIndex = (targetDay + 6) % 7;
    return shiftDateKey((7 - currentWeekIndex) + targetWeekIndex, base);
  }
  let diff = (targetDay - today + 7) % 7;
  if (diff === 0) diff = 7;
  return shiftDateKey(diff, base);
}

function isValidDateKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const target = new Date(year, month - 1, day);
  return target.getFullYear() === year
    && target.getMonth() === month - 1
    && target.getDate() === day;
}

function parseQuickDueDate(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return isValidDateKey(key) ? key : "";
  if (key === "today" || key === "今天") return localDateKey();
  if (key === "tomorrow" || key === "明天") return shiftDateKey(1);
  if (key === "后天") return shiftDateKey(2);
  if (key === "nextweek" || key === "next-week" || key === "下周") return shiftDateKey(7);
  if (key === "weekend" || key === "周末") return nextWeekdayDateKey(6);

  const weekdayNames = {
    mon: 1,
    monday: 1,
    tue: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
    sun: 0,
    sunday: 0,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    日: 0,
    天: 0
  };
  const nextWeekday = key.match(/^下周([一二三四五六日天])$/);
  if (nextWeekday) return nextWeekdayDateKey(weekdayNames[nextWeekday[1]], new Date(), true);
  const chineseWeekday = key.match(/^(?:周|星期)([一二三四五六日天])$/);
  if (chineseWeekday) return nextWeekdayDateKey(weekdayNames[chineseWeekday[1]]);
  if (weekdayNames[key] !== undefined) return nextWeekdayDateKey(weekdayNames[key]);
  return "";
}

function normalizeQuickTime(hour, minute = 0, period = "") {
  let nextHour = Number(hour);
  let nextMinute = Number(minute) || 0;
  if (!Number.isFinite(nextHour) || nextHour < 0 || nextHour > 24) return "";
  if (!Number.isFinite(nextMinute) || nextMinute < 0 || nextMinute > 59) return "";
  const label = String(period || "");
  if (/下午|晚上|傍晚/.test(label) && nextHour < 12) nextHour += 12;
  if (/上午|早上|清晨/.test(label) && nextHour === 24) nextHour = 0;
  if (nextHour === 24 && nextMinute === 0) nextHour = 0;
  if (nextHour > 23) return "";
  return `${String(nextHour).padStart(2, "0")}:${String(nextMinute).padStart(2, "0")}`;
}

function parseMonthDayDate(month, day, base = new Date()) {
  const target = new Date(base.getFullYear(), Number(month) - 1, Number(day));
  if (Number.isNaN(target.getTime()) || target.getMonth() !== Number(month) - 1) return "";
  if (localDateKey(target) < localDateKey(base)) target.setFullYear(target.getFullYear() + 1);
  return localDateKey(target);
}

function quickAddParser(raw, options = {}) {
  const externalParser = typeof window !== "undefined"
    && window.DeskchatQuickAddParser
    && typeof window.DeskchatQuickAddParser.quickAddParser === "function"
    ? window.DeskchatQuickAddParser.quickAddParser
    : null;
  if (externalParser) {
    return externalParser(raw, {
      today: localDateKey(),
      categories: STUDY_CATEGORY_NAMES,
      ...options
    });
  }
  let title = String(raw || "").trim();
  const patch = { tags: [], project: "", categoryId: "", priority: "", dueDate: "", startTime: "", estimateMinutes: 0 };

  const consume = (pattern, handler) => {
    title = title.replace(pattern, (match, ...args) => {
      handler(...args);
      return " ";
    });
  };

  consume(/(?:^|\s)#([\p{Script=Han}A-Za-z0-9_+-]+)/gu, (tag) => {
    if (!tag) return;
    patch.tags.push(tag);
    applyQuickCategory(patch, tag, { setProject: true });
  });
  consume(/(?:^|\s)!([高中低]|high|medium|normal|low)(?=\s|$)/giu, (value) => {
    const key = String(value).toLowerCase();
    patch.priority = key === "高" || key === "high" ? "high" : key === "低" || key === "low" ? "low" : "medium";
  });
  consume(/(?:^|\s)(\d+(?:\.\d+)?)\s*(h|hour|hours|小时)(?=\s|$)/giu, (value) => {
    patch.estimateMinutes = Math.round(Number(value) * 60);
  });
  consume(/(?:^|\s)(\d+)\s*(m|min|分钟)(?=\s|$)/giu, (value) => {
    patch.estimateMinutes = Number(value);
  });
  consume(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/g, (value) => {
    patch.dueDate = value;
  });
  consume(/(?:^|\s)(\d{1,2})月(\d{1,2})日?(?=\s|$)/g, (month, day) => {
    patch.dueDate = parseMonthDayDate(month, day) || patch.dueDate;
  });
  consume(/(?:^|\s)(今天|明天|后天)(?=\s|$)/g, (value) => {
    patch.dueDate = parseQuickDueDate(value) || patch.dueDate;
  });
  consume(/(?:^|\s)(周[一二三四五六日天]|星期[一二三四五六日天])(?=\s|$)/g, (value) => {
    patch.dueDate = parseQuickDueDate(value) || patch.dueDate;
  });
  consume(/(?:^|\s)(上午|早上|下午|晚上|傍晚)?([01]?\d|2[0-3])[:：]([0-5]\d)(?=\s|$)/g, (period, hour, minute) => {
    patch.startTime = normalizeQuickTime(hour, minute, period) || patch.startTime;
  });
  consume(/(?:^|\s)(上午|早上|下午|晚上|傍晚)(\d{1,2})点(半|[0-5]?\d分?)?(?=\s|$)/g, (period, hour, minuteText) => {
    const minute = minuteText === "半" ? 30 : String(minuteText || "0").replace("分", "") || 0;
    patch.startTime = normalizeQuickTime(hour, minute, period) || patch.startTime;
  });

  return { title: title.replace(/\s+/g, " ").trim(), patch };
}

function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (!value) return "0m";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function normalizeFocusMinutes(value) {
  const minutes = Math.round(Number(value) || focusDefaultMinutes || 50);
  return Math.max(1, Math.min(Number.isFinite(minutes) ? minutes : 50, 240));
}

function normalizeClientFocusTimer(timer) {
  const status = String(timer && timer.status || "idle");
  const normalizedStatus = ["running", "paused"].includes(status) ? status : "idle";
  const plannedMinutes = normalizeFocusMinutes(timer && timer.plannedMinutes);
  const remainingSeconds = Math.max(0, Math.min(
    Math.round(Number(timer && timer.remainingSeconds)) || plannedMinutes * 60,
    plannedMinutes * 60
  ));
  if (normalizedStatus === "idle") {
    return {
      status: "idle",
      taskId: "",
      todoId: "",
      title: "",
      categoryId: "",
      goalId: "",
      startedAt: "",
      lastStartedAt: "",
      pausedAt: "",
      plannedMinutes,
      remainingSeconds
    };
  }
  return {
    status: normalizedStatus,
    taskId: String(timer && (timer.taskId || timer.todoId) || ""),
    todoId: String(timer && (timer.todoId || timer.taskId) || ""),
    title: String(timer && timer.title || ""),
    categoryId: String(timer && timer.categoryId || ""),
    goalId: String(timer && timer.goalId || ""),
    startedAt: String(timer && timer.startedAt || ""),
    lastStartedAt: normalizedStatus === "running" ? String(timer && timer.lastStartedAt || timer && timer.startedAt || "") : "",
    pausedAt: normalizedStatus === "paused" ? String(timer && timer.pausedAt || "") : "",
    plannedMinutes,
    remainingSeconds
  };
}

function activeFocusTimer() {
  const timer = normalizeClientFocusTimer(focusTimer);
  return ["running", "paused"].includes(timer.status) && timer.taskId ? timer : null;
}

function focusTimerTask(timer = activeFocusTimer()) {
  return timer ? todos.find((todo) => todo.id === timer.taskId) || null : null;
}

function runningTodo() {
  return focusTimerTask() || todos.find((todo) => todo.timerStartedAt) || null;
}

function focusTimerInfo(timer = activeFocusTimer()) {
  const activeTimer = timer && timer.taskId ? normalizeClientFocusTimer(timer) : null;
  if (!activeTimer) {
    const legacy = runningTodo();
    if (!legacy || !legacy.timerStartedAt) return null;
    const started = new Date(legacy.timerStartedAt);
    if (Number.isNaN(started.getTime())) return null;
    const targetMinutes = Number(legacy.focusTargetMinutes) || focusDefaultMinutes || 50;
    const targetSeconds = normalizeFocusMinutes(targetMinutes) * 60;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000));
    return {
      elapsedSeconds,
      targetSeconds,
      remainingSeconds: Math.max(0, targetSeconds - elapsedSeconds),
      progress: Math.min(1, targetSeconds ? elapsedSeconds / targetSeconds : 0)
    };
  }
  const targetMinutes = activeTimer.plannedMinutes || focusDefaultMinutes || 50;
  const targetSeconds = normalizeFocusMinutes(targetMinutes) * 60;
  const lastStarted = new Date(activeTimer.lastStartedAt || activeTimer.startedAt);
  const elapsedSinceResume = activeTimer.status === "running" && !Number.isNaN(lastStarted.getTime())
    ? Math.max(0, Math.floor((Date.now() - lastStarted.getTime()) / 1000))
    : 0;
  const remainingSeconds = activeTimer.status === "running"
    ? Math.max(0, activeTimer.remainingSeconds - elapsedSinceResume)
    : activeTimer.remainingSeconds;
  const elapsedSeconds = Math.max(0, targetSeconds - remainingSeconds);
  return {
    elapsedSeconds,
    targetSeconds,
    remainingSeconds,
    progress: Math.min(1, targetSeconds ? elapsedSeconds / targetSeconds : 0)
  };
}

function isFocusTimerForTodo(todo) {
  const timer = activeFocusTimer();
  return Boolean(todo && timer && timer.taskId === todo.id);
}

function repeatProgressText(todo) {
  if (!todo || !todo.repeat || todo.repeat === "none") return "";
  const parts = [];
  const completedCount = Number(todo.completedCount) || 0;
  const lastSpent = Number(todo.lastSpentMinutes) || 0;
  const totalSpent = Number(todo.totalSpentMinutes) || 0;
  if (completedCount) parts.push(`已完成 ${completedCount} 次`);
  if (lastSpent) parts.push(`上轮 ${formatMinutes(lastSpent)}`);
  if (totalSpent) parts.push(`累计 ${formatMinutes(totalSpent)}`);
  return parts.join(" · ");
}

function parseIsoDate(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : null;
}

function shiftTodoDate(value, days = 0, months = 0) {
  const base = parseIsoDate(value) || new Date(`${localDateKey()}T00:00:00`);
  if (Number.isNaN(base.getTime())) return localDateKey();
  if (days) base.setDate(base.getDate() + days);
  if (months) base.setMonth(base.getMonth() + months);
  return localDateKey(base);
}

function duplicateTodoPayload(todo) {
  return {
    title: `${(todo && todo.title) || "未命名任务"}（副本）`,
    notes: todo && todo.notes ? todo.notes : "",
    priority: normalizePriority(todo && todo.priority),
    project: normalizeProject(todo && todo.project),
    categoryId: todo && todo.categoryId ? todo.categoryId : todoCategoryName(todo),
    goalId: todo && todo.goalId ? todo.goalId : "",
    dueDate: todo && todo.dueDate ? todo.dueDate : "",
    startTime: todo && todo.startTime ? todo.startTime : "",
    endTime: todo && todo.endTime ? todo.endTime : "",
    waitingFor: todo && todo.waitingFor ? todo.waitingFor : "",
    waitingUntil: todo && todo.waitingUntil ? todo.waitingUntil : "",
    repeat: todo && todo.repeat ? todo.repeat : "none",
    estimateMinutes: Number(todo && todo.estimateMinutes) || 0,
    tags: Array.isArray(todo && todo.tags) ? todo.tags.slice(0, 8) : [],
    subtasks: Array.isArray(todo && todo.subtasks)
      ? todo.subtasks.map((subtask) => ({ title: subtask.title, completed: false }))
      : [],
    completed: false,
    completedAt: null,
    spentMinutes: 0,
    lastSpentMinutes: 0,
    totalSpentMinutes: 0,
    timerStartedAt: "",
    completedCount: 0,
    lastCompletedAt: ""
  };
}

function liveSpentMinutes(todo) {
  const base = Number(todo && todo.spentMinutes) || 0;
  if (!todo || !todo.timerStartedAt) return base;
  const started = new Date(todo.timerStartedAt);
  if (Number.isNaN(started.getTime())) return base;
  return base + Math.max(1, Math.round((Date.now() - started.getTime()) / 60000));
}

function tagsText(tags) {
  return (Array.isArray(tags) ? tags : []).join(", ");
}

function subtasksText(subtasks) {
  return (Array.isArray(subtasks) ? subtasks : [])
    .map((subtask) => `${subtask.completed ? "[x]" : "[ ]"} ${subtask.title}`)
    .join("\n");
}

function parseSubtasks(value) {
  return String(value || "")
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const completed = /^\[(x|X|✓|done)\]\s*/.test(line);
      const title = line.replace(/^\[(x|X|✓|done| )\]\s*/, "").replace(/^[-*]\s*/, "").trim();
      return { title, completed };
    })
    .filter((subtask) => subtask.title)
    .slice(0, 80);
}

function quickAddOptionsFromForm(form) {
  return {
    selectedDate: form && form.dataset ? form.dataset.selectedDate || "" : "",
    categories: STUDY_CATEGORY_NAMES
  };
}

function parseQuickTodoTitle(raw, options = {}) {
  let title = String(raw || "").trim();
  const patch = { tags: [], project: "", categoryId: "", priority: "", dueDate: "", startTime: "", repeat: "", estimateMinutes: 0, waitingFor: "", waitingUntil: "" };

  title = consumeQuickToken(title, "#", /(?:^|\s)#("[^"]+"|“[^”]+”|[\p{Script=Han}]+|[A-Za-z0-9][\p{L}\p{N}_+.-]*)/gu, (tag) => {
    patch.tags.push(tag);
    applyQuickCategory(patch, tag, { setProject: true });
  });
  title = consumeQuickToken(title, "+", /(?:^|\s)\+("[^"]+"|“[^”]+”|[\p{Script=Han}]+|[A-Za-z0-9][\p{L}\p{N}_-]*)/gu, (project) => {
    patch.project = project;
    patch.categoryId = patch.categoryId || studyCategoryFromTag(project);
  });
  title = consumeQuickToken(title, "!", /(?:^|\s)!(high|medium|normal|low|高|中|低)(?=\s|$)/giu, (priority) => {
    const value = String(priority).toLowerCase();
    patch.priority = value === "high" || value === "高" ? "high" : value === "low" || value === "低" ? "low" : "medium";
  });
  title = consumeQuickToken(title, "", /(?:^|\s)(p1|p2|p3|!!|！)(?=\s|$)/giu, (priority) => {
    const value = String(priority).toLowerCase();
    patch.priority = value === "p1" || value === "!!" || value === "！" ? "high" : value === "p3" ? "low" : "medium";
  });
  title = consumeQuickToken(title, "@", /(?:^|\s)@(\d{4}-\d{2}-\d{2}|today|tomorrow|next\s*week|next-week|mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday|今天|明天|后天|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天]|下周[一二三四五六日天])(?=\s|$)/giu, (value) => {
    const key = String(value).toLowerCase();
    patch.dueDate = parseQuickDueDate(key) || patch.dueDate;
  });
  title = consumeQuickToken(title, "?", /(?:^|\s)\?("[^"]+"|“[^”]+”|[\p{Script=Han}]+|[A-Za-z0-9][\p{L}\p{N}_-]*)/gu, (person) => {
    patch.waitingFor = person.slice(0, 120);
  });
  title = consumeQuickToken(title, "^", /(?:^|\s)\^(\d{4}-\d{2}-\d{2}|today|tomorrow|next\s*week|next-week|今天|明天|后天|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天]|下周[一二三四五六日天])(?=\s|$)/giu, (value) => {
    patch.waitingUntil = parseQuickDueDate(value) || patch.waitingUntil;
  });
  title = consumeQuickToken(title, "", /(?:^|\s)(today|tomorrow|next\s*week|next-week|今天|明天|后天|下周|周末|周[一二三四五六日天]|星期[一二三四五六日天]|下周[一二三四五六日天])(?=\s|$)/giu, (value) => {
    patch.dueDate = parseQuickDueDate(value) || patch.dueDate;
  });
  title = consumeQuickToken(title, "~", /(?:^|\s)~(daily|weekly|monthly|每天|每周|每月)(?=\s|$)/giu, (value) => {
    const key = String(value).toLowerCase();
    patch.repeat = key === "每天" ? "daily" : key === "每周" ? "weekly" : key === "每月" ? "monthly" : key;
  });
  title = consumeQuickToken(title, "=", /(?:^|\s)=([\d.]+\s*(?:h|hour|hours|小时|m|min|分钟)?)(?=\s|$)/giu, (value) => {
    patch.estimateMinutes = parseMinutes(value);
  });
  title = consumeQuickToken(title, "", /(?:^|\s)(\d+(?:\.\d+)?\s*(?:h|hour|hours|小时|m|min|分钟))(?=\s|$)/giu, (value) => {
    patch.estimateMinutes = parseMinutes(value) || patch.estimateMinutes;
  });
  const natural = quickAddParser(title, options);
  title = natural.title;
  patch.tags = [...new Set([...(patch.tags || []), ...(natural.patch.tags || [])])].slice(0, 8);
  patch.categoryId = patch.categoryId || natural.patch.categoryId;
  patch.project = patch.project || natural.patch.project;
  patch.priority = patch.priority || natural.patch.priority;
  patch.dueDate = patch.dueDate || natural.patch.dueDate;
  patch.startTime = patch.startTime || natural.patch.startTime;
  patch.estimateMinutes = patch.estimateMinutes || natural.patch.estimateMinutes;
  return { title: title.replace(/\s+/g, " ").trim(), patch };
}

function quickCreatePreviewItems(form) {
  if (!form || !form.elements || !String(form.elements.title.value || "").trim()) return [];
  const rawTitle = String(form.elements.title.value || "").replace(/\s+/g, " ").trim();
  const parsed = parseQuickTodoTitle(form.elements.title.value, quickAddOptionsFromForm(form));
  const fieldTags = parseTags(form.elements.tags.value);
  const tags = [...new Set([...fieldTags, ...(parsed.patch.tags || [])])].slice(0, 8);
  const categoryId = parsed.patch.categoryId || studyCategoryFromTag(form.elements.project.value);
  const project = normalizeProject(parsed.patch.project || categoryId || form.elements.project.value);
  const priority = normalizePriority(parsed.patch.priority || form.elements.priority.value);
  const dueDate = parsed.patch.dueDate || form.elements.dueDate.value;
  const startTime = parsed.patch.startTime || "";
  const repeat = parsed.patch.repeat || form.elements.repeat.value;
  const estimate = parsed.patch.estimateMinutes || parseMinutes(form.elements.estimateMinutes.value);
  const waitingFor = parsed.patch.waitingFor || form.elements.waitingFor.value.trim();
  const waitingUntil = waitingFor ? parsed.patch.waitingUntil || form.elements.waitingUntil.value : "";
  const items = [];

  if (parsed.title && parsed.title !== rawTitle) items.push(["标题", parsed.title]);
  if (categoryId) items.push(["分类", categoryId]);
  if ((project !== "Inbox" || parsed.patch.project) && project !== categoryId) items.push(["清单", project]);
  if (priority !== "medium" || parsed.patch.priority) items.push(["优先级", `${priorityLabel(priority)}优先级`]);
  if (dueDate) items.push(["日期", formatDateLabel(dueDate)]);
  if (startTime) items.push(["时间", startTime]);
  if (repeat && repeat !== "none") items.push(["重复", repeatLabel(repeat)]);
  if (estimate) items.push(["估时", formatMinutes(estimate)]);
  if (waitingFor) items.push(["等待", waitingFor]);
  if (waitingUntil) items.push(["跟进", formatDateLabel(waitingUntil)]);
  if (tags.length) items.push(["标签", tags.map((tag) => `#${tag}`).join(" ")]);
  if (detectGoalLikeTask(parsed.title || rawTitle)) items.push(["识别", "可能是目标"]);
  return items;
}

function updateQuickCreatePreview(form) {
  const preview = form && form.querySelector("[data-quick-preview]");
  if (!preview) return;
  const items = quickCreatePreviewItems(form);
  preview.hidden = !items.length;
  preview.replaceChildren(...items.map(([label, value]) => {
    const chip = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = label;
    chip.appendChild(name);
    chip.appendChild(document.createTextNode(value));
    return chip;
  }));
}

function stats() {
  const today = localDateKey();
  const visibleTodos = todos.filter((todo) => !isArchivedTodo(todo));
  const active = visibleTodos.filter((todo) => !todo.completed);
  const todayFocus = focusSessions
    .filter((session) => isDateInRange(session.endedAt || session.startedAt, { start: today, end: today }))
    .reduce((sum, session) => sum + focusSessionMinutes(session), 0);
  return {
    total: visibleTodos.length,
    active: active.length,
    completed: visibleTodos.length - active.length,
    today: active.filter((todo) => todo.dueDate === today).length,
    overdue: active.filter((todo) => todo.dueDate && todo.dueDate < today).length,
    todayFocus
  };
}

function reviewSummary(type, key) {
  const range = periodRange(type, key);
  const completed = todos.filter((todo) => {
    const completedAt = todo.completedAt || todo.lastCompletedAt;
    return completedAt && isDateInRange(completedAt, range);
  });
  const created = todos.filter((todo) => todo.createdAt && isDateInRange(todo.createdAt, range));
  const sessions = focusSessions.filter((session) => isDateInRange(session.endedAt || session.startedAt, range));
  const focusMinutes = sessions.reduce((sum, session) => sum + focusSessionMinutes(session), 0);
  const projectMinutes = new Map();
  for (const session of sessions) {
    const project = focusSessionCategoryName(session);
    projectMinutes.set(project, (projectMinutes.get(project) || 0) + focusSessionMinutes(session));
  }
  const topProjects = [...projectMinutes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
    .slice(0, 5);
  return {
    range,
    completed,
    created,
    sessions,
    focusMinutes,
    topProjects,
    overdueNow: todos.filter((todo) => !todo.completed && todo.dueDate && todo.dueDate < localDateKey()).length
  };
}

function dayKeys(count = 7) {
  const days = [];
  const date = new Date(`${localDateKey()}T00:00:00`);
  for (let index = count - 1; index >= 0; index -= 1) {
    const next = new Date(date);
    next.setDate(date.getDate() - index);
    days.push(localDateKey(next));
  }
  return days;
}

function completedAtKey(todo) {
  const value = todo && (todo.completedAt || todo.lastCompletedAt);
  return value ? String(value).slice(0, 10) : "";
}

function focusSessionKey(session) {
  const value = session && (session.endedAt || session.startedAt);
  return value ? String(value).slice(0, 10) : "";
}

function statsTrend() {
  const days = dayKeys(7);
  const focusByDay = new Map();
  const completedByDay = new Map();
  for (const session of focusSessions) {
    const key = focusSessionKey(session);
    if (days.includes(key)) focusByDay.set(key, (focusByDay.get(key) || 0) + focusSessionMinutes(session));
  }
  for (const todo of todos) {
    const key = completedAtKey(todo);
    if (days.includes(key)) completedByDay.set(key, (completedByDay.get(key) || 0) + 1);
  }
  return days.map((day) => ({
    day,
    focusMinutes: focusByDay.get(day) || 0,
    completed: completedByDay.get(day) || 0
  }));
}

function analyticsSummary() {
  const today = localDateKey();
  const trend = statsTrend();
  const focus7 = trend.reduce((sum, item) => sum + item.focusMinutes, 0);
  const completed7 = trend.reduce((sum, item) => sum + item.completed, 0);
  const activeTodos = todos.filter((todo) => !todo.completed);
  const projectCounts = new Map();
  const projectFocus = new Map();
  for (const todo of activeTodos) {
    const project = todoCategoryName(todo);
    projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
  }
  const monthRange = periodRange("monthly", periodKeyFor("monthly"));
  for (const session of focusSessions) {
    if (!isDateInRange(session.endedAt || session.startedAt, monthRange)) continue;
    const project = focusSessionCategoryName(session);
    projectFocus.set(project, (projectFocus.get(project) || 0) + focusSessionMinutes(session));
  }
  const projectRows = [...new Set([...projectCounts.keys(), ...projectFocus.keys()])]
    .map((project) => ({
      project,
      active: projectCounts.get(project) || 0,
      focusMinutes: projectFocus.get(project) || 0
    }))
    .sort((a, b) => b.focusMinutes - a.focusMinutes || b.active - a.active || a.project.localeCompare(b.project, "zh-CN"))
    .slice(0, 8);
  return {
    trend,
    focus7,
    completed7,
    active: activeTodos.length,
    overdue: activeTodos.filter((todo) => todo.dueDate && todo.dueDate < today).length,
    highActive: activeTodos.filter((todo) => todo.priority === "high").length,
    planned: activeTodos.filter((todo) => todo.dueDate).length,
    unplanned: activeTodos.filter((todo) => !todo.dueDate).length,
    projectRows
  };
}

function shiftedDateKey(offset, reference = new Date()) {
  const date = new Date(reference);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function todoCreatedAtKey(todo) {
  const value = todo && todo.createdAt;
  return value ? String(value).slice(0, 10) : "";
}

function visibleReviewTodos() {
  return Array.isArray(todos) ? todos.filter((todo) => !isArchivedTodo(todo)) : [];
}

function isCompletedFocusSession(session) {
  const status = String(session && session.status || "");
  return status === "completed" || Boolean(session && session.completed);
}

function reviewFocusSessions(range) {
  return (Array.isArray(focusSessions) ? focusSessions : [])
    .filter((session) => isCompletedFocusSession(session))
    .filter((session) => isDateInRange(session.endedAt || session.startedAt, range));
}

function reviewGoalIdForSession(session) {
  const direct = String(session && session.goalId || "").trim();
  if (direct) return direct;
  const taskId = String(session && (session.taskId || session.todoId) || "").trim();
  if (!taskId) return "";
  const todo = todos.find((item) => item.id === taskId);
  return String(todo && todo.goalId || "").trim();
}

function reviewAdvancedGoalIds(range, todoList = visibleReviewTodos(), sessions = reviewFocusSessions(range)) {
  const goalIds = new Set();
  todoList.forEach((todo) => {
    const goalId = String(todo && todo.goalId || "").trim();
    const key = completedAtKey(todo);
    if (goalId && key && isDateInRange(key, range)) goalIds.add(goalId);
  });
  sessions.forEach((session) => {
    const goalId = reviewGoalIdForSession(session);
    if (goalId) goalIds.add(goalId);
  });
  return [...goalIds];
}

function reviewGoalRows(goalIds) {
  return [...new Set(goalIds)]
    .map((id) => ({
      id,
      title: goalNameFromId(id) || id,
      category: goalCategoryText(goalById(id))
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

function reviewPageState() {
  if (!Array.isArray(todos) || !Array.isArray(focusSessions) || !Array.isArray(goals)) return "loading";
  const hasTodos = visibleReviewTodos().length > 0;
  const hasFocus = focusSessions.some((session) => isCompletedFocusSession(session) && focusSessionMinutes(session) > 0);
  const hasGoals = goals.some((goal) => !goal.status || goal.status === "active");
  return hasTodos || hasFocus || hasGoals ? "normal" : "empty";
}

function dateRangeLabel(range) {
  if (!range || !range.start || !range.end) return "暂无数据";
  if (range.start === range.end) return formatDateLabel(range.start);
  return `${formatDateLabel(range.start)} - ${formatDateLabel(range.end)}`;
}

function sumFocusMinutes(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .reduce((sum, session) => sum + focusSessionMinutes(session), 0);
}

function safeAverage(total, count) {
  const denominator = safeCount(count);
  if (!denominator) return 0;
  return Math.round(safeNumber(total, 0) / denominator);
}

function statRowsFromMap(map, valueLabel = "") {
  return [...map.entries()]
    .map(([label, value]) => ({
      label: String(label || "未分类"),
      value: safeCount(value),
      valueText: `${safeCount(value)}${valueLabel}`
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"));
}

function EmptyChartState(message = "暂无数据") {
  return `<div class="todo-empty-chart" role="status">${escapeHtml(message)}</div>`;
}

function reviewYesterdayStats() {
  const day = shiftedDateKey(-1);
  const range = { start: day, end: day };
  const todoList = visibleReviewTodos();
  const completedTasks = todoList.filter((todo) => completedAtKey(todo) === day);
  const createdTasks = todoList.filter((todo) => todoCreatedAtKey(todo) === day);
  const sessions = reviewFocusSessions(range);
  const focusMinutes = sumFocusMinutes(sessions);
  const goalRows = reviewGoalRows(reviewAdvancedGoalIds(range, todoList, sessions));
  const primaryText = completedTasks.length
    ? `昨天完成了 ${completedTasks.length} 个任务，专注 ${focusMinutes} 分钟，继续保持。`
    : "昨天没有完成任务。今天可以先安排 1 个 25 分钟任务。";
  const goalText = goalRows.length ? `昨天推进了 ${goalRows.length} 个学习目标。` : "";
  return {
    day,
    range,
    completedTasks,
    createdTasks,
    sessions,
    focusMinutes,
    goalRows,
    primaryText,
    goalText
  };
}

function reviewTaskStats() {
  const today = localDateKey();
  const days = dayKeys(7);
  const todoList = visibleReviewTodos();
  const completedByDay = new Map(days.map((day) => [day, 0]));
  const createdByDay = new Map(days.map((day) => [day, 0]));
  const completedByCategory = new Map();

  todoList.forEach((todo) => {
    const completedKey = completedAtKey(todo);
    if (completedByDay.has(completedKey)) {
      completedByDay.set(completedKey, (completedByDay.get(completedKey) || 0) + 1);
      const category = todoCategoryName(todo) || "未分类";
      completedByCategory.set(category, (completedByCategory.get(category) || 0) + 1);
    }
    const createdKey = todoCreatedAtKey(todo);
    if (createdByDay.has(createdKey)) createdByDay.set(createdKey, (createdByDay.get(createdKey) || 0) + 1);
  });

  const dailyRows = days.map((day) => ({
    day,
    completed: completedByDay.get(day) || 0,
    created: createdByDay.get(day) || 0
  }));
  const currentIncomplete = todoList.filter((todo) => !todo.completed).length;
  const currentOverdue = todoList.filter((todo) => !todo.completed && todo.dueDate && todo.dueDate < today).length;
  const completed7 = dailyRows.reduce((sum, item) => sum + item.completed, 0);
  const created7 = dailyRows.reduce((sum, item) => sum + item.created, 0);
  const completionRate = safePercent(completed7, completed7 + currentIncomplete);
  return {
    days,
    dailyRows,
    completed7,
    created7,
    currentIncomplete,
    currentOverdue,
    completionRate,
    categoryRows: statRowsFromMap(completedByCategory, " 个")
  };
}

function reviewPomodoroStats() {
  const days = dayKeys(7);
  const range = { start: days[0], end: days[days.length - 1] };
  const sessions = reviewFocusSessions(range);
  const categoryMinutes = new Map();
  const goalMinutes = new Map();
  const dailyMinutes = new Map(days.map((day) => [day, 0]));
  const dailyCounts = new Map(days.map((day) => [day, 0]));

  sessions.forEach((session) => {
    const minutes = focusSessionMinutes(session);
    const day = focusSessionKey(session);
    if (dailyMinutes.has(day)) {
      dailyMinutes.set(day, (dailyMinutes.get(day) || 0) + minutes);
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    }
    const category = focusSessionCategoryName(session) || "未分类";
    categoryMinutes.set(category, (categoryMinutes.get(category) || 0) + minutes);
    const goalId = reviewGoalIdForSession(session);
    if (goalId) {
      const name = goalNameFromId(goalId) || goalId;
      goalMinutes.set(name, (goalMinutes.get(name) || 0) + minutes);
    }
  });

  const totalMinutes = sumFocusMinutes(sessions);
  return {
    days,
    dailyRows: days.map((day) => ({
      day,
      count: dailyCounts.get(day) || 0,
      minutes: dailyMinutes.get(day) || 0
    })),
    sessions,
    completedCount: sessions.length,
    totalMinutes,
    averageMinutes: safeAverage(totalMinutes, sessions.length),
    categoryRows: statRowsFromMap(categoryMinutes).map((row) => ({ ...row, valueText: formatMinutes(row.value) })),
    goalRows: statRowsFromMap(goalMinutes).map((row) => ({ ...row, valueText: formatMinutes(row.value) }))
  };
}

function reviewWeeklyStats() {
  const range = periodRange("weekly", periodKeyFor("weekly"));
  const todoList = visibleReviewTodos();
  const completedTasks = todoList.filter((todo) => completedAtKey(todo) && isDateInRange(completedAtKey(todo), range));
  const createdTasks = todoList.filter((todo) => todoCreatedAtKey(todo) && isDateInRange(todoCreatedAtKey(todo), range));
  const sessions = reviewFocusSessions(range);
  const focusMinutes = sumFocusMinutes(sessions);
  const completedByCategory = new Map();
  completedTasks.forEach((todo) => {
    const category = todoCategoryName(todo) || "未分类";
    completedByCategory.set(category, (completedByCategory.get(category) || 0) + 1);
  });
  const categoryRows = statRowsFromMap(completedByCategory, " 个");
  const topCategory = categoryRows[0] || null;
  const goalRows = reviewGoalRows(reviewAdvancedGoalIds(range, todoList, sessions));
  const overdueNow = todoList.filter((todo) => !todo.completed && todo.dueDate && todo.dueDate < localDateKey()).length;
  let suggestion = "下周先选 1 个最重要的任务，用 25 分钟启动。";
  if (overdueNow > 0) {
    suggestion = `先重新安排 ${overdueNow} 个过期任务，再开启新的任务。`;
  } else if (goalRows.length > 0) {
    suggestion = `延续 ${goalRows[0].title} 的推进节奏，拆出下周第一步。`;
  } else if (focusMinutes >= 150 && topCategory) {
    suggestion = `本周 ${topCategory.label} 推进最多，下周可以继续围绕它安排 2-3 个具体任务。`;
  }
  return {
    range,
    completedTasks,
    createdTasks,
    sessions,
    focusMinutes,
    topCategory,
    goalRows,
    suggestion
  };
}

function todoTemplates() {
  return [
    {
      id: "daily-review",
      title: "日复盘",
      description: "每天结束前快速沉淀完成、卡点和明日行动。",
      project: "复盘",
      tags: ["复盘", "每日"],
      priority: "medium",
      estimateMinutes: 15,
      repeat: "daily",
      subtasks: ["今天完成了什么", "哪些事情被拖住", "明天最重要的 1-3 件事", "记录一个可复用经验"]
    },
    {
      id: "weekly-review",
      title: "周复盘",
      description: "按周整理成果、节奏、分类投入和下周重点。",
      project: "复盘",
      tags: ["复盘", "每周"],
      priority: "high",
      estimateMinutes: 45,
      repeat: "weekly",
      subtasks: ["本周完成清单", "本周专注时间和分类分布", "未完成原因", "下周三件关键任务", "需要沟通或等待的事项"]
    },
    {
      id: "study-sprint",
      title: "学习冲刺",
      description: "适合课程、白马学院式训练营、证书备考等学习任务。",
      project: "学习",
      tags: ["学习", "冲刺"],
      priority: "high",
      estimateMinutes: 90,
      repeat: "none",
      subtasks: ["明确本次学习目标", "完成课程/材料输入", "整理笔记和问题", "做一次练习或输出", "安排下一次复习"]
    },
    {
      id: "deep-work",
      title: "番茄深度工作",
      description: "先定目标，再用番茄专注推进，结束后记录产出。",
      project: "深度工作",
      tags: ["专注", "番茄专注"],
      priority: "high",
      estimateMinutes: 50,
      repeat: "none",
      subtasks: ["写清本轮产出", "关闭干扰源", "开始番茄专注", "完成后记录结果", "决定下一步"]
    },
    {
      id: "project-push",
      title: "目标推进",
      description: "用于把一个模糊目标拆成可以推进的下一步。",
      project: "目标",
      tags: ["目标", "推进"],
      priority: "medium",
      estimateMinutes: 60,
      repeat: "none",
      subtasks: ["确认目标和验收标准", "列出阻塞点", "拆出下一步动作", "安排截止时间", "同步相关人"]
    },
    {
      id: "monthly-review",
      title: "月复盘",
      description: "整理本月成果、投入分布和下月主题。",
      project: "复盘",
      tags: ["复盘", "每月"],
      priority: "high",
      estimateMinutes: 60,
      repeat: "monthly",
      subtasks: ["本月关键成果", "本月投入最多的分类", "值得保留的习惯", "需要停止的低价值事项", "下月主题和关键指标"]
    }
  ];
}

function templateTodoPayload(template) {
  return {
    title: template.title,
    notes: template.description,
    priority: template.priority,
    project: template.project,
    categoryId: normalizeCategoryId(template.project),
    dueDate: localDateKey(),
    repeat: template.repeat,
    estimateMinutes: template.estimateMinutes,
    tags: template.tags,
    subtasks: template.subtasks.map((title) => ({ title, completed: false }))
  };
}

function todoNeedsTriage(todo) {
  if (!todo || todo.completed || isArchivedTodo(todo)) return false;
  const project = todoCategoryName(todo);
  return project === "Inbox"
    || !todo.dueDate
    || !todo.estimateMinutes
    || !(Array.isArray(todo.tags) && todo.tags.length);
}

function triageTodos() {
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  return todos
    .filter(todoNeedsTriage)
    .sort((a, b) => {
      const dueA = a.dueDate || "9999-12-31";
      const dueB = b.dueDate || "9999-12-31";
      if (dueA !== dueB) return dueA.localeCompare(dueB);
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    });
}

function triageProjectOptions() {
  const existing = allProjects().map(([project]) => project).filter((project) => project !== "Inbox");
  return [...new Set(["学习", "工作", "复盘", "目标", ...existing])].slice(0, 8);
}

function triageTagOptions() {
  const existing = allTags().map(([tag]) => tag);
  return [...new Set(["今日", "专注", "复盘", "学习", "推进", ...existing])].slice(0, 8);
}

function executionQueue() {
  const today = localDateKey();
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  return todos
    .filter((todo) =>
      !todo.completed
      && !isTodoWaitingBlocked(todo)
      && (!projectFilter || todoCategoryName(todo) === projectFilter)
      && ((todo.dueDate && todo.dueDate <= today) || todo.priority === "high")
    )
    .sort((a, b) => {
      const dueA = a.dueDate || "9999-12-31";
      const dueB = b.dueDate || "9999-12-31";
      if (dueA !== dueB) return dueA.localeCompare(dueB);
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
      const estimateA = Number(a.estimateMinutes) || 9999;
      const estimateB = Number(b.estimateMinutes) || 9999;
      if (estimateA !== estimateB) return estimateA - estimateB;
      return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    })
    .slice(0, 12);
}

function weekDays(date = new Date()) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return localDateKey(day);
  });
}

function calendarGroups() {
  const days = weekDays();
  const groups = Object.fromEntries(days.map((day) => [day, []]));
  const eventGroups = Object.fromEntries(days.map((day) => [day, []]));
  const overdue = [];
  const today = localDateKey();
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  const activeTodos = todos.filter((todo) => !todo.completed && todo.dueDate);
  for (const todo of activeTodos) {
    if (todo.dueDate < days[0]) {
      overdue.push(todo);
    } else if (groups[todo.dueDate]) {
      groups[todo.dueDate].push(todo);
    }
  }
  for (const event of events) {
    const day = String(event.startAt || "").slice(0, 10);
    if (eventGroups[day]) eventGroups[day].push(event);
  }
  const sorter = (a, b) => {
    if (a.dueDate !== b.dueDate) return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  };
  for (const day of days) groups[day].sort(sorter);
  for (const day of days) eventGroups[day].sort((a, b) => String(a.startAt || "").localeCompare(String(b.startAt || "")));
  overdue.sort(sorter);
  return { days, groups, eventGroups, overdue, today };
}

function nextActionTodo() {
  return runningTodo() || executionQueue()[0] || todos
    .filter((todo) =>
      !todo.completed
      && !isTodoWaitingBlocked(todo)
      && (!projectFilter || todoCategoryName(todo) === projectFilter)
    )
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0] || null;
}

function projectDashboardRows() {
  const today = localDateKey();
  const monthRange = periodRange("monthly", periodKeyFor("monthly"));
  const projects = new Map();
  function ensureProject(name) {
    const project = categoryNameFromId(name) || normalizeProject(name);
    if (!projects.has(project)) {
      projects.set(project, {
        project,
        active: 0,
        completed: 0,
        overdue: 0,
        high: 0,
        focusMinutes: 0,
        nextDue: "",
        recent: []
      });
    }
    return projects.get(project);
  }

  categoryRows().forEach((row) => ensureProject(row.category));

  for (const todo of todos) {
    const row = ensureProject(todoCategoryName(todo));
    if (todo.completed) {
      row.completed += 1;
    } else {
      row.active += 1;
      if (todo.priority === "high") row.high += 1;
      if (todo.dueDate && todo.dueDate < today) row.overdue += 1;
      if (todo.dueDate && (!row.nextDue || todo.dueDate < row.nextDue)) row.nextDue = todo.dueDate;
      row.recent.push(todo);
    }
  }

  for (const session of focusSessions) {
    if (!isDateInRange(session.endedAt || session.startedAt, monthRange)) continue;
    ensureProject(focusSessionCategoryName(session)).focusMinutes += focusSessionMinutes(session);
  }

  return [...projects.values()]
    .map((row) => ({
      ...row,
      recent: row.recent
        .sort((a, b) => {
          const dueA = a.dueDate || "9999-12-31";
          const dueB = b.dueDate || "9999-12-31";
          if (dueA !== dueB) return dueA.localeCompare(dueB);
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        })
        .slice(0, 4)
    }))
    .sort((a, b) =>
      b.overdue - a.overdue
      || b.high - a.high
      || b.active - a.active
      || b.focusMinutes - a.focusMinutes
      || a.project.localeCompare(b.project, "zh-CN")
    );
}

function goalRows() {
  const weekRange = periodRange("weekly", periodKeyFor("weekly"));
  const monthRange = periodRange("monthly", periodKeyFor("monthly"));
  const rows = new Map();

  function ensureGoal(name, goal = null) {
    const project = goal && goal.title ? String(goal.title).trim() : categoryNameFromId(name) || normalizeProject(name);
    if (!rows.has(project)) {
      rows.set(project, {
        project,
        goal: null,
        category: "",
        deadline: "",
        targetCount: 0,
        currentCount: 0,
        targetScore: 0,
        currentAverageScore: 0,
        active: 0,
        high: 0,
        completedWeek: 0,
        focusMonth: 0,
        dueThisWeek: 0,
        next: []
      });
    }
    const row = rows.get(project);
    if (goal) {
      row.goal = goal;
      row.category = categoryNameFromId(goal.categoryId);
      row.deadline = goal.deadline || "";
      row.targetCount = Number(goal.targetCount) || 0;
      row.currentCount = Number(goal.currentCount) || 0;
      row.targetScore = Number(goal.targetScore) || 0;
      row.currentAverageScore = Number(goal.currentAverageScore) || 0;
    }
    return row;
  }

  goals
    .filter((goal) => !goal.status || goal.status === "active")
    .forEach((goal) => ensureGoal(goal.title || goal.categoryId, goal));

  for (const todo of todos) {
    const row = ensureGoal(goalNameFromId(todo.goalId) || todoCategoryName(todo));
    const completedAt = completedAtKey(todo);
    if (todo.completed) {
      if (completedAt && isDateInRange(completedAt, weekRange)) row.completedWeek += 1;
      continue;
    }
    row.active += 1;
    if (todo.priority === "high") row.high += 1;
    if (todo.dueDate && isDateInRange(todo.dueDate, weekRange)) row.dueThisWeek += 1;
    row.next.push(todo);
  }

  for (const session of focusSessions) {
    if (!isDateInRange(session.endedAt || session.startedAt, monthRange)) continue;
    ensureGoal(goalNameFromId(session.goalId) || focusSessionCategoryName(session)).focusMonth += focusSessionMinutes(session);
  }

  return [...rows.values()]
    .filter((row) => row.goal || row.active || row.completedWeek || row.focusMonth)
    .map((row) => {
      const denominator = Math.max(1, row.active + row.completedWeek);
      const countProgress = row.targetCount ? Math.min(1, row.currentCount / row.targetCount) : 0;
      const scoreProgress = row.targetScore ? Math.min(1, row.currentAverageScore / row.targetScore) : 0;
      const progress = row.targetCount
        ? countProgress
        : row.targetScore
          ? scoreProgress
          : Math.min(1, row.completedWeek / denominator);
      const targetText = row.targetCount
        ? `${row.currentCount}/${row.targetCount} 项`
        : row.targetScore
          ? `均分 ${row.currentAverageScore || 0}/${row.targetScore}`
          : "";
      return {
        ...row,
        progress,
        targetText,
        next: row.next
          .sort((a, b) => {
            const dueA = a.dueDate || "9999-12-31";
            const dueB = b.dueDate || "9999-12-31";
            if (dueA !== dueB) return dueA.localeCompare(dueB);
            return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
          })
          .slice(0, 3)
      };
    })
    .sort((a, b) =>
      b.high - a.high
      || b.dueThisWeek - a.dueThisWeek
      || b.focusMonth - a.focusMonth
      || a.project.localeCompare(b.project, "zh-CN")
    )
    .slice(0, 8);
}

function goalMetaText(row) {
  const parts = [];
  if (row.category) parts.push(row.category);
  if (row.deadline) parts.push(`截止 ${formatDateLabel(row.deadline)}`);
  parts.push(`${row.dueThisWeek} 本周到期`);
  parts.push(`${formatMinutes(row.focusMonth)} 本月专注`);
  return parts.join(" · ");
}

function goalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function goalCountText(value) {
  const number = goalNumber(value);
  return number ? String(number) : "0";
}

function goalScoreText(value) {
  const number = goalNumber(value);
  return number ? String(number) : "0";
}

function goalStatusLabel(status) {
  const labels = {
    active: "active",
    done: "done",
    failed: "failed",
    archived: "archived"
  };
  return labels[status] || "active";
}

function sortedGoals() {
  const rank = { active: 0, done: 1, failed: 2, archived: 3 };
  return goals.slice().sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9)
    || String(a.deadline || "9999-12-31").localeCompare(String(b.deadline || "9999-12-31"))
    || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
  );
}

function goalById(id) {
  const targetId = String(id || "");
  return goals.find((goal) => goal.id === targetId) || null;
}

function goalCategoryText(goal) {
  return categoryNameFromId(goal && goal.categoryId) || "未分类";
}

function goalTasks(goal) {
  if (!goal || !goal.id) return [];
  return todos.filter((todo) => todo.goalId === goal.id && !isArchivedTodo(todo));
}

function goalProgressInfo(goal) {
  const targetCount = goalNumber(goal && goal.targetCount);
  const currentCount = goalNumber(goal && goal.currentCount);
  if (!targetCount) {
    return {
      progress: 0,
      percent: 0,
      percentText: "未设置",
      countText: "未设置数量目标"
    };
  }
  const progress = Math.min(1, Math.max(0, currentCount / targetCount));
  const percent = Math.round(progress * 100);
  return {
    progress,
    percent,
    percentText: `${percent}%`,
    countText: `${currentCount}/${targetCount}`
  };
}

function decomposeGoalForWeek(goal) {
  const decomposer = window.DeskchatGoalDecomposer && window.DeskchatGoalDecomposer.goalDecomposer;
  if (typeof decomposer !== "function") {
    return {
      ok: false,
      reason: "目标拆解工具未加载",
      reasonCode: "tool_unavailable",
      remainingDays: 0,
      remainingCount: 0,
      remainingWeeks: 1,
      weeklyRequiredCount: 0,
      suggestedTasks: []
    };
  }
  return decomposer({
    goal,
    today: localDateKey(),
    currentCount: goal && goal.currentCount,
    targetCount: goal && goal.targetCount,
    deadline: goal && goal.deadline
  });
}

function goalStatusHint(goal) {
  const targetCount = goalNumber(goal && goal.targetCount);
  const currentCount = goalNumber(goal && goal.currentCount);
  const status = goalStatusLabel(goal && goal.status);
  if (status === "archived") return "已归档";
  if (status === "done") return "已完成";
  if (status === "failed") return "已失败";
  if (targetCount && currentCount >= targetCount) return "已达到数量目标，可标记完成";
  if (goal && goal.deadline && goal.deadline < localDateKey()) return "已过截止日期，存在风险";
  return "推进中";
}

function goalFormValue(goal, key) {
  if (!goal) return "";
  if (["targetCount", "currentCount", "targetScore", "currentAverageScore"].includes(key)) {
    return goalNumber(goal[key]) || "";
  }
  return goal[key] || "";
}

function renderGoalForm(goal = null) {
  const isEdit = Boolean(goal && goal.id);
  const status = goalStatusLabel(goal && goal.status);
  const category = goal ? goalCategoryText(goal) : defaultTaskCategory();
  return `
    <form class="todo-goal-form" data-goal-form data-goal-id="${isEdit ? escapeHtml(goal.id) : ""}" aria-label="${isEdit ? "编辑目标" : "创建目标"}">
      <label>
        <span>标题</span>
        <input name="title" type="text" maxlength="180" value="${escapeHtml(goalFormValue(goal, "title"))}" placeholder="例如：八月底完成 30 套试卷，均分 120" required />
      </label>
      <label>
        <span>分类</span>
        <input name="categoryId" type="text" maxlength="80" value="${escapeHtml(category)}" placeholder="数学" />
      </label>
      <label>
        <span>截止日期</span>
        <input name="deadline" type="date" value="${escapeHtml(goalFormValue(goal, "deadline"))}" />
      </label>
      <label>
        <span>目标数量</span>
        <input name="targetCount" type="number" min="0" step="1" value="${escapeHtml(goalFormValue(goal, "targetCount"))}" />
      </label>
      <label>
        <span>当前数量</span>
        <input name="currentCount" type="number" min="0" step="1" value="${escapeHtml(goalFormValue(goal, "currentCount"))}" />
      </label>
      <label>
        <span>目标均分</span>
        <input name="targetScore" type="number" min="0" step="1" value="${escapeHtml(goalFormValue(goal, "targetScore"))}" />
      </label>
      <label>
        <span>当前均分</span>
        <input name="currentAverageScore" type="number" min="0" step="1" value="${escapeHtml(goalFormValue(goal, "currentAverageScore"))}" />
      </label>
      <label>
        <span>状态</span>
        <select name="status">
          ${["active", "done", "failed", "archived"].map((option) => `
            <option value="${option}" ${status === option ? "selected" : ""}>${option}</option>
          `).join("")}
        </select>
      </label>
      <div class="todo-goal-form-actions">
        <button type="submit">${isEdit ? "保存目标" : "创建目标"}</button>
        ${isEdit ? `<button type="button" data-goal-cancel-edit>取消</button>` : ""}
      </div>
    </form>
  `;
}

function renderGoalWeekBreakdown(goal) {
  const result = decomposeGoalForWeek(goal);
  if (!result.ok) {
    return `
      <section class="todo-goal-breakdown-panel warning" aria-label="本周任务拆解">
        <header>
          <strong>本周任务拆解</strong>
          <span>${escapeHtml(result.reason)}</span>
        </header>
      </section>
    `;
  }
  const tasks = Array.isArray(result.suggestedTasks) ? result.suggestedTasks.slice(0, 7) : [];
  return `
    <section class="todo-goal-breakdown-panel" aria-label="本周任务拆解">
      <header>
        <div>
          <strong>本周建议任务</strong>
          <span>剩余 ${Number(result.remainingCount) || 0} 项 · 约 ${Number(result.remainingWeeks) || 1} 周 · 每周至少 ${Number(result.weeklyRequiredCount) || 0} 项</span>
        </div>
        <button type="button" data-goal-create-week-tasks ${tasks.length ? "" : "disabled"}>确认创建 ${tasks.length} 个任务</button>
      </header>
      <div class="todo-goal-breakdown-list">
        ${tasks.map((task, index) => `
          <article>
            <b>${index + 1}</b>
            <span>${escapeHtml(task.title)}</span>
            <small>${escapeHtml(task.dueDate || "")} · ${priorityLabel(task.priority)}优先级 · ${formatMinutes(task.estimateMinutes || 0)}</small>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function currentReview(type = reviewType) {
  const key = periodKeyFor(type);
  return reviews.find((review) => review.type === type && review.periodKey === key) || {
    type,
    periodKey: key,
    wins: "",
    blockers: "",
    nextActions: "",
    score: 0
  };
}

function allProjects() {
  return categoryRows().map((row) => [row.category, row.count]);
}

function isUncategorizedName(name) {
  const value = normalizeCategoryId(name);
  return !value || value === "Inbox" || value === "未分类";
}

function isArchivedTodo(todo) {
  return Boolean(todo && (todo.status === "archived" || todo.archivedAt || todo.deletedAt));
}

function defaultTaskCategory() {
  if (activeView === "category" && activeCategory) return activeCategory;
  return "未分类";
}

function normalizeTaskCategory(value, fallback = "未分类") {
  const category = normalizeCategoryId(value || fallback);
  return isUncategorizedName(category) ? "未分类" : category;
}

function todoNavCategory(todo) {
  const category = todoCategoryName(todo);
  return isUncategorizedName(category) ? "未分类" : category;
}

function isDefaultCategoryName(name) {
  return NAV_CATEGORY_NAMES.includes(isUncategorizedName(name) ? "未分类" : normalizeCategoryId(name));
}

function categoryRecordByName(name) {
  const target = isUncategorizedName(name) ? "未分类" : normalizeCategoryId(name);
  return categories.find((category) => {
    const categoryName = isUncategorizedName(category && category.name) ? "未分类" : normalizeCategoryId(category && category.name);
    const categoryId = isUncategorizedName(category && category.id) ? "未分类" : normalizeCategoryId(category && category.id);
    return categoryName === target || categoryId === target;
  }) || null;
}

function categoryColor(name) {
  const category = categoryRecordByName(name);
  if (category && category.color) return category.color;
  const normalized = isUncategorizedName(name) ? "未分类" : normalizeCategoryId(name);
  const index = Math.max(0, NAV_CATEGORY_NAMES.indexOf(normalized));
  return CATEGORY_COLOR_FALLBACKS[index % CATEGORY_COLOR_FALLBACKS.length];
}

function navCategoryRows() {
  const rows = new Map();
  const ensure = (name) => {
    const category = isUncategorizedName(name) ? "未分类" : normalizeCategoryId(name);
    if (!category) return;
    if (!rows.has(category)) {
      rows.set(category, {
        name: category,
        count: 0,
        color: categoryColor(category),
        isDefault: isDefaultCategoryName(category)
      });
    }
  };
  NAV_CATEGORY_NAMES.forEach(ensure);
  categories.forEach((category) => ensure(category.name || category.id));
  customCategories.forEach(ensure);
  todos.forEach((todo) => {
    if (todo.completed || isArchivedTodo(todo)) return;
    const category = todoNavCategory(todo);
    ensure(category);
    if (rows.has(category)) rows.get(category).count += 1;
  });
  return [...rows.values()].sort((a, b) => {
    const orderA = NAV_CATEGORY_NAMES.indexOf(a.name);
    const orderB = NAV_CATEGORY_NAMES.indexOf(b.name);
    if (orderA >= 0 || orderB >= 0) return (orderA >= 0 ? orderA : 999) - (orderB >= 0 ? orderB : 999);
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function pageSortTodos(items, mode = "smart") {
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  return items.slice().sort((a, b) => {
    if (mode === "recent") {
      const timeA = a.updatedAt || a.createdAt || "";
      const timeB = b.updatedAt || b.createdAt || "";
      return String(timeB).localeCompare(String(timeA));
    }
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function selectedDateKey() {
  return selectedDate || localDateKey();
}

function selectedDateTitle(dateKey = selectedDateKey()) {
  const today = localDateKey();
  if (dateKey === today) return "今天";
  if (dateKey === shiftTodoDate(today, -1)) return "昨天";
  if (dateKey === shiftTodoDate(today, 1)) return "明天";
  if (dateKey === shiftTodoDate(today, 2)) return "后天";
  return formatDateLabel(dateKey);
}

function todayDateStripDays() {
  const today = localDateKey();
  return [-1, 0, 1, 2, 3, 4, 5].map((offset) => {
    const date = shiftTodoDate(today, offset);
    return {
      date,
      label: selectedDateTitle(date),
      weekday: formatWeekday(date),
      count: todos.filter((todo) => !isArchivedTodo(todo) && !todo.completed && todo.dueDate === date).length,
      isToday: date === today,
      isSelected: date === selectedDateKey()
    };
  });
}

function todayPageTodos(dateKey = selectedDateKey()) {
  return pageSortTodos(todos.filter((todo) => !isArchivedTodo(todo) && todo.dueDate === dateKey));
}

function todayActiveTodos(dateKey = selectedDateKey()) {
  return todayPageTodos(dateKey).filter((todo) => !todo.completed);
}

function todayCompletedTodos(dateKey = selectedDateKey()) {
  return pageSortTodos(todayPageTodos(dateKey).filter((todo) => todo.completed), "recent");
}

function overdueTodos() {
  const today = localDateKey();
  return pageSortTodos(todos.filter((todo) =>
    !isArchivedTodo(todo)
    && !todo.completed
    && todo.status !== "done"
    && todo.dueDate
    && todo.dueDate < today
  ));
}

function todoTimeBucket(todo) {
  const time = String(todo && todo.startTime || "");
  const match = time.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return "unscheduled";
  const hour = Number(match[1]);
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function groupTodayTodos(items) {
  const groups = { morning: [], afternoon: [], evening: [], unscheduled: [] };
  for (const todo of items) {
    groups[todoTimeBucket(todo)].push(todo);
  }
  return groups;
}

function inboxPageTodos() {
  return pageSortTodos(todos.filter((todo) => !todo.completed && !isArchivedTodo(todo) && todoNavCategory(todo) === "未分类"));
}

function recentPageTodos() {
  return pageSortTodos(recentRescueTodos(), "recent").slice(0, 30);
}

function recentRescueTodos() {
  return todos.filter((todo) => todo && todo.status === "todo" && !todo.completed && !isArchivedTodo(todo));
}

function dateOffsetFromToday(dateKey, today = localDateKey()) {
  const date = parseIsoDate(dateKey);
  const base = parseIsoDate(today);
  if (!date || !base) return 0;
  return Math.round((date.getTime() - base.getTime()) / 86400000);
}

function isRecentGoalCandidate(todo) {
  return detectGoalLikeTask(todo && todo.title);
}

function recentOverdueTodos(today = localDateKey()) {
  return pageSortTodos(recentRescueTodos().filter((todo) => todo.dueDate && todo.dueDate < today));
}

function recentUndatedTodos() {
  return pageSortTodos(recentRescueTodos().filter((todo) => !todo.dueDate));
}

function recentUpcomingTodos(today = localDateKey()) {
  const weekEnd = shiftTodoDate(today, 7);
  return pageSortTodos(recentRescueTodos().filter((todo) =>
    todo.dueDate && todo.dueDate >= today && todo.dueDate <= weekEnd
  ));
}

function groupRecentOverdueTodos(items, today = localDateKey()) {
  const groups = {
    yesterday: [],
    recent7: [],
    within30: [],
    earlier: []
  };
  for (const todo of items) {
    const offset = dateOffsetFromToday(todo.dueDate, today);
    if (offset === -1) groups.yesterday.push(todo);
    else if (offset >= -7) groups.recent7.push(todo);
    else if (offset >= -30) groups.within30.push(todo);
    else groups.earlier.push(todo);
  }
  return groups;
}

function groupRecentUndatedTodos(items) {
  const groups = {
    uncategorized: [],
    categorized: [],
    possibleGoal: []
  };
  for (const todo of items) {
    if (isRecentGoalCandidate(todo)) groups.possibleGoal.push(todo);
    else if (isUncategorizedName(todoCategoryName(todo))) groups.uncategorized.push(todo);
    else groups.categorized.push(todo);
  }
  return groups;
}

function groupRecentUpcomingTodos(items, today = localDateKey()) {
  const tomorrow = shiftTodoDate(today, 1);
  const groups = {
    today: [],
    tomorrow: [],
    thisWeek: []
  };
  for (const todo of items) {
    if (todo.dueDate === today) groups.today.push(todo);
    else if (todo.dueDate === tomorrow) groups.tomorrow.push(todo);
    else groups.thisWeek.push(todo);
  }
  return groups;
}

function recentRescueSnapshot() {
  const today = localDateKey();
  const overdue = recentOverdueTodos(today);
  const undated = recentUndatedTodos();
  const upcoming = recentUpcomingTodos(today);
  return {
    today,
    overdue,
    undated,
    upcoming,
    overdueGroups: groupRecentOverdueTodos(overdue, today),
    undatedGroups: groupRecentUndatedTodos(undated),
    upcomingGroups: groupRecentUpcomingTodos(upcoming, today)
  };
}

function monthKeyForDate(dateKey = localDateKey()) {
  const text = String(dateKey || localDateKey());
  return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : localDateKey().slice(0, 7);
}

function calendarSelectedDateKey() {
  return selectedDate || localDateKey();
}

function calendarMonthKey() {
  return calendarMonth || monthKeyForDate(calendarSelectedDateKey());
}

function shiftMonthKey(monthKey, offset = 0) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(`${localDateKey()}T00:00:00`);
  base.setMonth(base.getMonth() + offset);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

function calendarMonthTitle(monthKey = calendarMonthKey()) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long" })
    .format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

function calendarDateTitle(dateKey = calendarSelectedDateKey()) {
  const date = parseIsoDate(dateKey);
  if (!date) return String(dateKey || "");
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "short" }).format(date);
}

function calendarMonthDays(monthKey = calendarMonthKey()) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  const first = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, 1)
    : new Date(`${localDateKey()}T00:00:00`);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_item, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return localDateKey(date);
  });
}

function calendarDayTasks(dateKey) {
  return pageSortTodos(todos.filter((todo) => !isArchivedTodo(todo) && todo.dueDate === dateKey));
}

function calendarActiveTasks(dateKey = calendarSelectedDateKey()) {
  return calendarDayTasks(dateKey).filter((todo) => !todo.completed);
}

function calendarCompletedTasks(dateKey = calendarSelectedDateKey()) {
  return pageSortTodos(calendarDayTasks(dateKey).filter((todo) => todo.completed), "recent");
}

function calendarUndatedTodos() {
  return pageSortTodos(todos.filter((todo) => todo.status === "todo" && !todo.completed && !isArchivedTodo(todo) && !todo.dueDate));
}

function calendarDaySummaries(dateKey) {
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  const tasks = calendarDayTasks(dateKey).slice().sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (priorityRank[normalizePriority(a.priority)] !== priorityRank[normalizePriority(b.priority)]) {
      return priorityRank[normalizePriority(a.priority)] - priorityRank[normalizePriority(b.priority)];
    }
    return String(a.startTime || "").localeCompare(String(b.startTime || "")) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  return {
    tasks,
    visible: tasks.slice(0, 2),
    extraCount: Math.max(0, tasks.length - 2)
  };
}

function categoryPageTodos(category) {
  const target = isUncategorizedName(category) ? "未分类" : normalizeCategoryId(category);
  return pageSortTodos(todos.filter((todo) => !todo.completed && !isArchivedTodo(todo) && todoNavCategory(todo) === target));
}

function categoryCompletedTodos(category) {
  const target = isUncategorizedName(category) ? "未分类" : normalizeCategoryId(category);
  return pageSortTodos(todos.filter((todo) => todo.completed && !isArchivedTodo(todo) && todoNavCategory(todo) === target), "recent");
}

function completedPageTodos() {
  return todos
    .filter((todo) => todo.status === "done" && !isArchivedTodo(todo))
    .slice()
    .sort((a, b) =>
      String(b.completedAt || b.lastCompletedAt || b.updatedAt || "").localeCompare(String(a.completedAt || a.lastCompletedAt || a.updatedAt || ""))
    );
}

function archivedPageTodos() {
  return todos
    .filter((todo) => todo.status === "archived")
    .slice()
    .sort((a, b) =>
      String(b.archivedAt || b.deletedAt || b.updatedAt || "").localeCompare(String(a.archivedAt || a.deletedAt || a.updatedAt || ""))
    );
}

function completedDateGroup(todo) {
  const today = localDateKey();
  const yesterday = shiftTodoDate(today, -1);
  const recentStart = shiftTodoDate(today, -6);
  const key = completedAtKey(todo) || String(todo && todo.updatedAt || "").slice(0, 10);
  if (key === today) return "today";
  if (key === yesterday) return "yesterday";
  if (key && key >= recentStart) return "recent7";
  return "earlier";
}

function completedDateGroups(items) {
  const groups = [
    { key: "today", title: "今天", items: [] },
    { key: "yesterday", title: "昨天", items: [] },
    { key: "recent7", title: "最近 7 天", items: [] },
    { key: "earlier", title: "更早", items: [] }
  ];
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  items.forEach((todo) => {
    const group = groupByKey.get(completedDateGroup(todo)) || groupByKey.get("earlier");
    group.items.push(todo);
  });
  return groups.filter((group) => group.items.length);
}

function archivedAtText(todo) {
  const value = String(todo && (todo.archivedAt || todo.deletedAt || todo.updatedAt) || "");
  return value ? value.slice(0, 16).replace("T", " ") : "未知时间";
}

function completedAtText(todo) {
  const value = String(todo && (todo.completedAt || todo.lastCompletedAt || todo.updatedAt) || "");
  return value ? value.slice(0, 16).replace("T", " ") : "未知时间";
}

function allTags() {
  const counts = new Map();
  for (const todo of todos) {
    for (const tag of todo.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
}

function todoStatus(todo) {
  if (todo.completed) return "已完成";
  if (isTodoWaiting(todo)) return waitingStatus(todo);
  if (todo.dueDate && todo.dueDate < localDateKey()) return "逾期";
  if (todo.dueDate === localDateKey()) return "今天";
  return "任务";
}

function todoMatches(todo) {
  if (isArchivedTodo(todo)) return false;
  const today = localDateKey();
  if (filter === "active" && todo.completed) return false;
  if (filter === "completed" && !todo.completed) return false;
  if (filter === "today" && todo.dueDate !== today) return false;
  if (filter === "overdue" && (todo.completed || !todo.dueDate || todo.dueDate >= today)) return false;
  if (tagFilter && !(todo.tags || []).includes(tagFilter)) return false;
  if (projectFilter && todoCategoryName(todo) !== projectFilter) return false;

  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    todo.title,
    todo.notes,
    todo.project,
    todo.waitingFor,
    todo.waitingUntil,
    priorityLabel(todo.priority),
    repeatLabel(todo.repeat),
    todo.dueDate,
    ...(todo.tags || []),
    ...((todo.subtasks || []).map((subtask) => subtask.title))
  ].join("\n").toLowerCase().includes(query);
}

function sortedTodos() {
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  return todos.filter(todoMatches).slice().sort((a, b) => {
    if (sortMode === "created") return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    if (sortMode === "updated") return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
    if (sortMode === "priority") {
      if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    }
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
}

function applyStore(store) {
  todos = Array.isArray(store && store.todos)
    ? store.todos
    : Array.isArray(store && store.tasks)
      ? store.tasks
      : [];
  reviews = Array.isArray(store && store.reviews) ? store.reviews : [];
  focusSessions = Array.isArray(store && store.focusSessions) ? store.focusSessions : [];
  focusTimer = normalizeClientFocusTimer(store && store.focusTimer);
  events = Array.isArray(store && store.events) ? store.events : [];
  goals = Array.isArray(store && store.goals) ? store.goals : [];
  categories = Array.isArray(store && store.categories) ? store.categories : [];
  focusDefaultMinutes = normalizeFocusMinutes(store && store.focusDefaultMinutes);
  if (editingId && !todos.some((todo) => todo.id === editingId)) editingId = null;
  scheduleTimerRefresh();
  render();
}

function scheduleTimerRefresh() {
  const activeTimer = activeFocusTimer();
  const hasRunningTimer = Boolean(activeTimer && activeTimer.status === "running") || todos.some((todo) => todo.timerStartedAt);
  if (hasRunningTimer && !timerRenderInterval) {
    timerRenderInterval = window.setInterval(() => {
      const timer = activeFocusTimer();
      const info = timer ? focusTimerInfo(timer) : null;
      if (timer && timer.status === "running" && info && info.remainingSeconds <= 0 && !focusAutoCompleting) {
        focusAutoCompleting = true;
        window.deskchat.completeTodoTimer()
          .then(applyStore)
          .catch((error) => {
            todoError = todoActionError(error, "完成番茄专注失败");
            render();
          })
          .finally(() => {
            focusAutoCompleting = false;
          });
        return;
      }
      if (!(timer && timer.status === "running") && !todos.some((todo) => todo.timerStartedAt)) {
        window.clearInterval(timerRenderInterval);
        timerRenderInterval = null;
        return;
      }
      if (!editingId && !contextMenu) render();
    }, 1000);
  }
  if (!hasRunningTimer && timerRenderInterval) {
    window.clearInterval(timerRenderInterval);
    timerRenderInterval = null;
  }
}

async function loadTodos() {
  applyStore(await window.deskchat.getTodos());
}

function todoActionError(error, fallback) {
  const message = error && error.message ? error.message : String(error || "未知错误");
  return `${fallback}：${message}`;
}

function setTodoNotice(message) {
  todoNotice = String(message || "").trim();
}

async function runTodoAction(action, fallback = "操作失败") {
  if (todoBusy) return;
  todoBusy = true;
  todoError = "";
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    todoNotice = "";
    todoError = todoActionError(error, fallback);
  } finally {
    todoBusy = false;
    if (failed) render();
  }
}

async function clearCompletedTodosAction() {
  await archiveCompletedTodosAction(completedPageTodos());
}

async function duplicateTodoAction(todo) {
  if (!todo) return;
  await runTodoAction(async () => {
    applyStore(await window.deskchat.createTodo(duplicateTodoPayload(todo)));
  }, "复制任务失败");
}

async function updateTodoAction(id, patch, fallback = "更新任务失败") {
  await runTodoAction(async () => {
    applyStore(await window.deskchat.saveTodo({ id, ...patch }));
  }, fallback);
}

async function saveCategoryAction(name) {
  const categoryName = normalizeTaskCategory(name);
  if (!categoryName) return;
  await runTodoAction(async () => {
    const store = await window.deskchat.saveTodoCategory({
      name: categoryName,
      color: categoryColor(categoryName)
    });
    setTodoNotice("分类已保存。");
    applyStore(store);
  }, "保存分类失败");
}

async function renameCategoryAction(oldName, newName) {
  const from = normalizeTaskCategory(oldName);
  const to = normalizeTaskCategory(newName);
  if (!from || !to || from === to) return;
  await runTodoAction(async () => {
    const store = await window.deskchat.renameTodoCategory({
      oldName: from,
      newName: to,
      color: categoryColor(from)
    });
    setTodoNotice("分类已重命名。");
    applyStore(store);
  }, "重命名分类失败");
}

async function deleteCategoryAction(name) {
  const categoryName = normalizeTaskCategory(name);
  if (!categoryName || categoryName === "未分类") return false;
  const count = todos.filter((todo) => !isArchivedTodo(todo) && todoNavCategory(todo) === categoryName).length;
  if (!(await confirmAction(`删除分类「${categoryName}」？`, {
    confirmLabel: "移动到未分类",
    detail: count ? `该分类下 ${count} 个任务会移动到“未分类”，任务不会被删除。` : "这个分类没有任务，删除后不会影响任务。"
  }))) return false;
  await runTodoAction(async () => {
    applyStore(await window.deskchat.deleteTodoCategory(categoryName));
  }, "删除分类失败");
  return true;
}

async function setTodoPriorityAction(todo, priority) {
  if (!todo || todo.priority === priority) return;
  await updateTodoAction(todo.id, { priority }, "更新优先级失败");
}

async function shiftTodoDueDateAction(todo, days = 0, months = 0, fallback = "更新截止日期失败") {
  if (!todo) return;
  await updateTodoAction(todo.id, { dueDate: shiftTodoDate(todo.dueDate, days, months) }, fallback);
}

async function clearTodoDueDateAction(todo) {
  if (!todo || !todo.dueDate) return;
  await updateTodoAction(todo.id, { dueDate: "" }, "清除截止日期失败");
}

async function clearTodoWaitingAction(todo) {
  if (!todo || !todo.waitingFor) return;
  await updateTodoAction(todo.id, { waitingFor: "", waitingUntil: "" }, "清除等待状态失败");
}

async function archiveTodoAction(todo) {
  if (!todo || isArchivedTodo(todo)) return;
  if (!(await confirmAction(`归档任务「${todo.title || "未命名任务"}」？`, {
    confirmLabel: "归档",
    detail: "归档后任务会进入回收站，可以恢复或彻底删除。"
  }))) return;
  const archivedAt = new Date().toISOString();
  setTodoNotice("任务已归档。");
  await updateTodoAction(todo.id, {
    status: "archived",
    completed: false,
    archivedAt,
    timerStartedAt: "",
    focusTargetMinutes: 0
  }, "归档任务失败");
}

async function undoCompletedTodoAction(todo) {
  if (!todo) return;
  setTodoNotice("任务已恢复为待办。");
  await updateTodoAction(todo.id, {
    status: "todo",
    completed: false,
    completedAt: "",
    timerStartedAt: "",
    focusTargetMinutes: 0
  }, "撤销完成失败");
}

async function archiveCompletedTodosAction(items = completedPageTodos()) {
  const targets = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!targets.length) return;
  if (!(await confirmAction(`归档 ${targets.length} 个已完成任务？`, {
    confirmLabel: "归档已完成",
    detail: "归档后任务会进入回收站，可从回收站恢复或彻底删除。"
  }))) return;
  const archivedAt = new Date().toISOString();
  setTodoNotice("已完成任务已归档。");
  await updateTodoBatchAction(
    targets,
    { status: "archived", completed: false, completedAt: "", archivedAt, timerStartedAt: "", focusTargetMinutes: 0 },
    "批量归档已完成任务失败"
  );
}

async function restoreArchivedTodoAction(todo) {
  if (!todo) return;
  setTodoNotice("任务已恢复。");
  await updateTodoAction(todo.id, {
    status: "todo",
    completed: false,
    completedAt: "",
    archivedAt: "",
    deletedAt: "",
    timerStartedAt: "",
    focusTargetMinutes: 0
  }, "恢复任务失败");
}

async function permanentlyDeleteTodoAction(todo) {
  if (!todo) return;
  if (!(await confirmAction(`彻底删除任务「${todo.title || "未命名任务"}」？`, {
    confirmLabel: "彻底删除",
    detail: "只会删除这个任务，不会删除关联 Goal 或番茄专注记录。"
  }))) return;
  await runTodoAction(async () => {
    const store = await window.deskchat.deleteTodo(todo.id);
    setTodoNotice("任务已彻底删除。");
    applyStore(store);
  }, "彻底删除任务失败");
}

async function updateTodoBatchAction(items, patcher, fallback = "批量更新任务失败") {
  const targets = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!targets.length) return;
  await runTodoAction(async () => {
    let store = null;
    for (let index = 0; index < targets.length; index += 1) {
      const todo = targets[index];
      const patch = typeof patcher === "function" ? patcher(todo, index) : patcher;
      store = await window.deskchat.saveTodo({ id: todo.id, ...(patch || {}) });
    }
    if (store) applyStore(store);
  }, fallback);
}

async function rescheduleRecentOverdueAction() {
  const items = recentOverdueTodos();
  if (!items.length) return;
  await updateTodoBatchAction(items, { dueDate: localDateKey() }, "顺延过期任务失败");
}

async function scheduleRecentUndatedAction() {
  const items = recentUndatedTodos();
  if (!items.length) return;
  await updateTodoBatchAction(
    items,
    (_todo, index) => ({ dueDate: shiftTodoDate(localDateKey(), index % 7) }),
    "安排无日期任务失败"
  );
}

async function archiveRecentOverdueAction() {
  const items = recentOverdueTodos();
  if (!items.length) return;
  if (!(await confirmAction(`归档 ${items.length} 个过期任务？`, {
    confirmLabel: "归档",
    detail: "这只会把任务标记为归档，不会删除数据。"
  }))) return;
  const archivedAt = new Date().toISOString();
  await updateTodoBatchAction(
    items,
    { status: "archived", completed: false, archivedAt, timerStartedAt: "" },
    "归档过期任务失败"
  );
}

async function softDeleteTodoAction(todo) {
  if (!todo || isArchivedTodo(todo)) return;
  const archivedAt = new Date().toISOString();
  setTodoNotice("任务已移入回收站。");
  await updateTodoAction(todo.id, {
    status: "archived",
    completed: false,
    archivedAt,
    deletedAt: archivedAt,
    timerStartedAt: "",
    focusTargetMinutes: 0
  }, "删除任务失败");
}

async function completeAllTodosAction() {
  const currentStats = stats();
  if (!currentStats.active) return;
  if (!(await confirmAction(`将 ${currentStats.active} 个任务标记为完成？`, {
    confirmLabel: "全部完成",
    detail: "重复任务会推进到下一次，正在计时的任务会先记录专注时间。"
  }))) return;
  await runTodoAction(async () => {
    applyStore(await window.deskchat.setAllTodosCompleted(true));
  }, "批量完成任务失败");
}

async function reopenAllTodosAction() {
  const currentStats = stats();
  if (!currentStats.completed) return;
  if (!(await confirmAction(`将 ${currentStats.completed} 个已完成任务恢复为任务？`, {
    confirmLabel: "恢复任务",
    detail: "这会恢复所有已完成任务，不会只作用于当前筛选结果。"
  }))) return;
  await runTodoAction(async () => {
    applyStore(await window.deskchat.setAllTodosCompleted(false));
  }, "批量恢复任务失败");
}

function resetTodoView() {
  activeView = "today";
  activeCategory = "未分类";
  isCreatingCategory = false;
  selectedDate = localDateKey();
  todayCompletedExpanded = false;
  recentCollapsedGroups = new Set();
  calendarMonth = "";
  calendarCompletedExpanded = false;
  editingGoalId = "";
  selectedGoalId = "";
  convertingGoalTodoId = "";
  filter = "all";
  tagFilter = "";
  projectFilter = "";
  search = "";
  sortMode = "smart";
  render();
}

function focusCreateTodo() {
  const input = app.querySelector('input[name="title"]');
  if (input) {
    input.focus();
    input.select();
  }
}

function openTodoEditor(id) {
  editingId = id;
  if (!["today", "inbox", "calendar", "recent", "category", "completed"].includes(activeView)) activeView = "today";
  render();
  window.requestAnimationFrame(() => {
    const editor = Array.from(app.querySelectorAll("[data-id]")).find((node) => node.dataset.id === id);
    const input = editor && editor.querySelector('input[name="title"]');
    if (input) {
      input.focus();
      input.select();
    }
  });
}

async function createTodo(form) {
  if (todoBusy) return;
  const parsed = parseQuickTodoTitle(form.elements.title.value, quickAddOptionsFromForm(form));
  const title = parsed.title;
  if (!title) {
    todoError = "任务标题不能为空。";
    render();
    window.requestAnimationFrame(focusCreateTodo);
    return;
  }
  const parsedTags = parseTags(form.elements.tags.value);
  const tags = [...new Set([...parsedTags, ...(parsed.patch.tags || [])])].slice(0, 8);
  const categoryId = normalizeTaskCategory(parsed.patch.categoryId || parsed.patch.project || form.elements.project.value || defaultTaskCategory());
  const project = categoryId;
  const defaultDueDate = form.dataset && form.dataset.selectedDate ? form.dataset.selectedDate : form.elements.dueDate.value;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    const store = await window.deskchat.createTodo({
      title,
      status: "todo",
      completed: false,
      notes: form.elements.notes.value.trim(),
      priority: normalizePriority(parsed.patch.priority || form.elements.priority.value),
      project,
      categoryId: categoryId || project,
      dueDate: parsed.patch.dueDate || defaultDueDate,
      startTime: parsed.patch.startTime || "",
      waitingFor: (parsed.patch.waitingFor || form.elements.waitingFor.value).trim(),
      waitingUntil: (parsed.patch.waitingFor || form.elements.waitingFor.value).trim() ? parsed.patch.waitingUntil || form.elements.waitingUntil.value : "",
      repeat: parsed.patch.repeat || form.elements.repeat.value,
      estimateMinutes: parsed.patch.estimateMinutes || parseMinutes(form.elements.estimateMinutes.value),
      tags,
      subtasks: parseSubtasks(form.elements.subtasks.value)
    });
    setTodoNotice("任务已创建。");
    applyStore(store);
    window.requestAnimationFrame(() => {
      const input = app.querySelector('input[name="title"]');
      if (input) input.focus();
    });
  }, "添加任务失败");
}

async function saveGoal(form) {
  if (todoBusy) return;
  const title = form.elements.title.value.trim();
  if (!title) {
    todoError = "目标标题不能为空。";
    render();
    return;
  }
  const id = form.dataset.goalId || "";
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    const store = await window.deskchat.saveTodoGoal({
      id,
      title,
      categoryId: normalizeTaskCategory(form.elements.categoryId.value),
      deadline: form.elements.deadline.value,
      targetCount: goalNumber(form.elements.targetCount.value),
      currentCount: goalNumber(form.elements.currentCount.value),
      targetScore: goalNumber(form.elements.targetScore.value),
      currentAverageScore: goalNumber(form.elements.currentAverageScore.value),
      status: form.elements.status.value || "active"
    });
    editingGoalId = "";
    selectedGoalId = id || (store.goals && store.goals[0] && store.goals[0].id) || selectedGoalId;
    setTodoNotice("目标已保存。");
    applyStore(store);
  }, "保存目标失败");
}

async function archiveGoalAction(goal) {
  if (!goal || goal.status === "archived") return;
  if (!(await confirmAction(`归档目标「${goal.title || "未命名目标"}」？`, {
    confirmLabel: "归档",
    detail: "这只会把目标状态改为 archived，不会删除目标或关联任务。"
  }))) return;
  await runTodoAction(async () => {
    const store = await window.deskchat.archiveTodoGoal(goal.id);
    if (selectedGoalId === goal.id) selectedGoalId = "";
    if (editingGoalId === goal.id) editingGoalId = "";
    applyStore(store);
  }, "归档目标失败");
}

async function createGoalTask(form, goal) {
  if (todoBusy || !goal) return;
  const title = form.elements.title.value.trim();
  if (!title) {
    todoError = "关联任务标题不能为空。";
    render();
    return;
  }
  const categoryId = normalizeTaskCategory(goal.categoryId || defaultTaskCategory());
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    const store = await window.deskchat.createTodo({
      title,
      status: "todo",
      completed: false,
      priority: normalizePriority(form.elements.priority.value || "medium"),
      project: categoryId,
      categoryId,
      goalId: goal.id,
      dueDate: form.elements.dueDate.value,
      estimateMinutes: parseMinutes(form.elements.estimateMinutes.value),
      tags: [],
      subtasks: []
    });
    selectedGoalId = goal.id;
    applyStore(store);
  }, "创建关联任务失败");
}

async function createGoalWeekTasks(goal) {
  if (todoBusy || !goal) return;
  const result = decomposeGoalForWeek(goal);
  if (!result.ok) {
    todoError = result.reason;
    render();
    return;
  }
  const tasks = Array.isArray(result.suggestedTasks) ? result.suggestedTasks.slice(0, 7) : [];
  if (!tasks.length) return;
  await runTodoAction(async () => {
    let store = null;
    for (const task of tasks) {
      const categoryId = normalizeTaskCategory(task.categoryId || goal.categoryId || defaultTaskCategory());
      store = await window.deskchat.createTodo({
        title: task.title,
        status: "todo",
        completed: false,
        priority: normalizePriority(task.priority || "medium"),
        project: categoryId,
        categoryId,
        goalId: task.goalId || goal.id,
        dueDate: task.dueDate || "",
        estimateMinutes: parseMinutes(task.estimateMinutes),
        tags: [],
        subtasks: []
      });
    }
    selectedGoalId = goal.id;
    if (store) applyStore(store);
  }, "创建本周任务失败");
}

async function convertTodoToGoal(form, todo) {
  if (todoBusy || !todo) return;
  const title = form.elements.title.value.trim();
  if (!title) {
    todoError = "目标标题不能为空。";
    render();
    return;
  }
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    let store = await window.deskchat.saveTodoGoal({
      title,
      categoryId: normalizeTaskCategory(form.elements.categoryId.value),
      deadline: form.elements.deadline.value,
      targetCount: goalNumber(form.elements.targetCount.value),
      currentCount: 0,
      targetScore: goalNumber(form.elements.targetScore.value),
      currentAverageScore: 0,
      status: "active"
    });
    const goal = store.goals && store.goals[0];
    store = await window.deskchat.saveTodo({
      id: todo.id,
      status: "archived",
      completed: false,
      archivedAt: new Date().toISOString(),
      goalId: goal && goal.id ? goal.id : "",
      timerStartedAt: "",
      focusTargetMinutes: 0
    });
    convertingGoalTodoId = "";
    selectedGoalId = goal && goal.id ? goal.id : "";
    activeView = "goals";
    setTodoNotice("任务已转换为目标。");
    applyStore(store);
  }, "转换为目标失败");
}

async function saveTodo(form, id) {
  if (todoBusy) return;
  const title = form.elements.title.value.trim();
  if (!title) {
    todoError = "任务标题不能为空。";
    render();
    window.requestAnimationFrame(() => {
      const editor = Array.from(app.querySelectorAll("[data-id]")).find((node) => node.dataset.id === id);
      const input = editor && editor.querySelector('input[name="title"]');
      if (input) input.focus();
    });
    return;
  }
  const categoryId = normalizeTaskCategory(form.elements.project.value);
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    const store = await window.deskchat.saveTodo({
      id,
      title,
      notes: form.elements.notes.value.trim(),
      priority: normalizePriority(form.elements.priority.value),
      project: categoryId,
      categoryId,
      dueDate: form.elements.dueDate.value,
      startTime: form.elements.startTime.value,
      waitingFor: form.elements.waitingFor.value.trim(),
      waitingUntil: form.elements.waitingFor.value.trim() ? form.elements.waitingUntil.value : "",
      repeat: form.elements.repeat.value,
      estimateMinutes: parseMinutes(form.elements.estimateMinutes.value),
      tags: parseTags(form.elements.tags.value),
      subtasks: parseSubtasks(form.elements.subtasks.value)
    });
    editingId = null;
    setTodoNotice("任务已保存。");
    applyStore(store);
  }, "保存任务失败");
}

async function saveReview(form) {
  if (todoBusy) return;
  const review = currentReview(reviewType);
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  await runTodoAction(async () => {
    const store = await window.deskchat.saveTodoReview({
      type: reviewType,
      periodKey: review.periodKey,
      wins: form.elements.wins.value.trim(),
      blockers: form.elements.blockers.value.trim(),
      nextActions: form.elements.nextActions.value.trim(),
      score: form.elements.score.value
    });
    setTodoNotice("复盘已保存。");
    applyStore(store);
  }, "保存复盘失败");
}

function reviewActionLines(value) {
  return String(value || "")
    .split(/\r?\n/g)
    .map((line) => line
      .replace(/^\s*(?:[-*•]|\d+[.)]|[□☐☑✓])\s*/u, "")
      .trim())
    .filter(Boolean)
    .slice(0, 12);
}

function reviewActionDueDate(type) {
  if (type === "weekly") return shiftTodoDate(localDateKey(), 7);
  if (type === "monthly") return shiftTodoDate(localDateKey(), 0, 1);
  return shiftTodoDate(localDateKey(), 1);
}

async function createReviewActionTodos(form) {
  if (todoBusy) return;
  const actions = reviewActionLines(form.elements.nextActions.value);
  if (!actions.length) {
    form.elements.nextActions.focus();
    return;
  }
  const review = currentReview(reviewType);
  const existing = new Set(todos
    .filter((todo) => !todo.completed)
    .map((todo) => String(todo.title || "").trim().toLowerCase()));
  const dueDate = reviewActionDueDate(reviewType);
  const createButton = form.querySelector("[data-review-create-actions]");
  if (createButton) createButton.disabled = true;
  await runTodoAction(async () => {
    let store = null;
    for (const rawTitle of actions) {
      const parsed = parseQuickTodoTitle(rawTitle);
      const title = parsed.title;
      if (!title) continue;
      const key = title.toLowerCase();
      if (existing.has(key)) continue;
      existing.add(key);
      const tags = [...new Set(["复盘", reviewType, ...(parsed.patch.tags || [])])].slice(0, 8);
      const categoryId = parsed.patch.categoryId || "复盘行动";
      const project = normalizeProject(parsed.patch.project || categoryId);
      store = await window.deskchat.createTodo({
        title,
        notes: `来自${periodLabel(reviewType, review.periodKey)}的下一步行动`,
        priority: normalizePriority(parsed.patch.priority || (reviewType === "daily" ? "high" : "medium")),
        project,
        categoryId,
        dueDate: parsed.patch.dueDate || dueDate,
        startTime: parsed.patch.startTime || "",
        waitingFor: parsed.patch.waitingFor || "",
        waitingUntil: parsed.patch.waitingFor ? parsed.patch.waitingUntil || "" : "",
        repeat: "none",
        estimateMinutes: parsed.patch.estimateMinutes || focusDefaultMinutes,
        tags
      });
    }
    if (store) {
      activeView = "plan";
      filter = "active";
      projectFilter = "";
      setTodoNotice("复盘行动已生成。");
      applyStore(store);
    } else {
      todoError = "没有生成新任务：下一步行动为空或已在清单中。";
      render();
    }
  }, "生成复盘行动失败");
}

async function startFocusFromForm(form) {
  if (todoBusy) return;
  const todoId = form.elements.todoId.value;
  const minutes = normalizeFocusMinutes(form.elements.focusMinutes.value);
  if (!todoId) return;
  await runTodoAction(async () => {
    const store = await window.deskchat.startTodoTimer(todoId, minutes);
    setTodoNotice("番茄专注已开始。");
    applyStore(store);
  }, "开始番茄专注失败");
}

async function saveFocusDefaultFromForm(form) {
  if (todoBusy) return;
  const minutes = normalizeFocusMinutes(form.elements.focusMinutes.value);
  await runTodoAction(async () => {
    applyStore(await window.deskchat.setTodoFocusDefault(minutes));
  }, "保存默认专注时长失败");
}

function renderViewTabs() {
  const tabs = [
    ["list", "清单"],
    ["execute", "执行"],
    ["triage", "整理"],
    ["plan", "规划"],
    ["waiting", "等待"],
    ["calendar", "周历"],
    ["goals", "目标"],
    ["projects", "分类"],
    ["templates", "模板"],
    ["matrix", "矩阵"],
    ["stats", "统计"],
    ["review", "复盘"],
    ["focus", "专注"]
  ];
  return `
    <nav class="todo-view-tabs" aria-label="任务工作区">
      ${tabs.map(([key, label]) => `
        <button type="button" class="${activeView === key ? "active" : ""}" data-view="${key}" aria-current="${activeView === key ? "page" : "false"}">${label}</button>
      `).join("")}
    </nav>
  `;
}

function isTodoUrgent(todo) {
  const today = localDateKey();
  return !todo.completed && todo.dueDate && todo.dueDate <= today;
}

function isTodoImportant(todo) {
  return !todo.completed && todo.priority === "high";
}

function isTodoWaiting(todo) {
  return !todo.completed && Boolean(todo && String(todo.waitingFor || "").trim());
}

function isTodoWaitingBlocked(todo) {
  if (!isTodoWaiting(todo)) return false;
  return !todo.waitingUntil || todo.waitingUntil > localDateKey();
}

function waitingStatus(todo) {
  if (!isTodoWaiting(todo)) return "";
  if (!todo.waitingUntil) return "等待中";
  if (todo.waitingUntil < localDateKey()) return "待跟进";
  if (todo.waitingUntil === localDateKey()) return "今天跟进";
  return "等待中";
}

function todoDateBucket(todo) {
  if (todo.completed) return "";
  const today = localDateKey();
  const tomorrow = shiftTodoDate(today, 1);
  const nextWeek = shiftTodoDate(today, 7);
  if (!todo.dueDate) return "unscheduled";
  if (todo.dueDate < today) return "overdue";
  if (todo.dueDate === today) return "today";
  if (todo.dueDate === tomorrow) return "tomorrow";
  if (todo.dueDate <= nextWeek) return "week";
  return "future";
}

function planGroups() {
  const groups = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    future: [],
    unscheduled: []
  };
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  const activeTodos = todos.filter((todo) =>
    !todo.completed && (!projectFilter || todoCategoryName(todo) === projectFilter)
  ).slice().sort((a, b) => {
    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  for (const todo of activeTodos) {
    const bucket = todoDateBucket(todo);
    if (groups[bucket]) groups[bucket].push(todo);
  }
  return groups;
}

function waitingGroups() {
  const groups = {
    due: [],
    upcoming: [],
    open: []
  };
  const waitingTodos = todos.filter((todo) =>
    isTodoWaiting(todo) && (!projectFilter || todoCategoryName(todo) === projectFilter)
  ).slice().sort((a, b) => {
    const waitA = a.waitingUntil || "9999-12-31";
    const waitB = b.waitingUntil || "9999-12-31";
    if (waitA !== waitB) return waitA.localeCompare(waitB);
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  const today = localDateKey();
  for (const todo of waitingTodos) {
    if (!todo.waitingUntil) groups.open.push(todo);
    else if (todo.waitingUntil <= today) groups.due.push(todo);
    else groups.upcoming.push(todo);
  }
  return groups;
}

function renderWaitingTask(todo) {
  return `
    <article class="todo-waiting-task" data-waiting-id="${escapeHtml(todo.id)}">
      <div>
        <strong>${escapeHtml(todo.title)}</strong>
        <span>${escapeHtml(todoCategoryName(todo))} · 等待 ${escapeHtml(todo.waitingFor || "外部动作")} · ${todo.waitingUntil ? escapeHtml(formatDateLabel(todo.waitingUntil)) : "未设跟进日"}</span>
      </div>
      <div class="todo-waiting-actions">
        <button type="button" data-waiting-today>今天跟进</button>
        <button type="button" data-waiting-tomorrow>明天跟进</button>
        <button type="button" data-waiting-clear>已解除等待</button>
        <button type="button" data-waiting-edit>编辑</button>
      </div>
    </article>
  `;
}

function renderWaitingPanel() {
  const groups = waitingGroups();
  const total = groups.due.length + groups.upcoming.length + groups.open.length;
  const sections = [
    ["due", "需要跟进", "跟进日已到，适合今天确认进展。"],
    ["upcoming", "未来跟进", "已经约好时间，暂时不用挤占执行队列。"],
    ["open", "未设日期", "还在等待，但缺少明确的跟进点。"]
  ];
  return `
    <section class="todo-waiting-panel" aria-label="等待与阻塞">
      <header class="todo-waiting-header">
        <div>
          <p class="todo-kicker">等待</p>
          <h2>外部依赖与跟进清单</h2>
        </div>
        <div class="todo-waiting-summary">
          <span><strong>${total}</strong> 等待中</span>
          <span><strong>${groups.due.length}</strong> 需跟进</span>
          ${projectFilter ? `<button type="button" data-plan-clear-project>查看全部分类</button>` : ""}
        </div>
      </header>
      <div class="todo-waiting-sections">
        ${sections.map(([key, title, hint]) => `
          <section class="todo-waiting-section">
            <header>
              <div>
                <strong>${title}</strong>
                <span>${hint}</span>
              </div>
              <small>${groups[key].length}</small>
            </header>
            <div class="todo-waiting-list">
              ${groups[key].length ? groups[key].map(renderWaitingTask).join("") : `
                <div class="todo-waiting-empty">这里暂时没有任务。</div>
              `}
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function matrixGroups() {
  const groups = {
    now: [],
    schedule: [],
    quick: [],
    later: []
  };
  const priorityRank = { high: 0, medium: 1, normal: 1, low: 2 };
  const activeTodos = todos.filter((item) => !item.completed).slice().sort((a, b) => {
    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    if (priorityRank[a.priority] !== priorityRank[b.priority]) return priorityRank[a.priority] - priorityRank[b.priority];
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  for (const todo of activeTodos) {
    const urgent = isTodoUrgent(todo);
    const important = isTodoImportant(todo);
    if (urgent && important) groups.now.push(todo);
    else if (important) groups.schedule.push(todo);
    else if (urgent) groups.quick.push(todo);
    else groups.later.push(todo);
  }
  return groups;
}

function renderMatrixTask(todo) {
  const subtasks = Array.isArray(todo.subtasks) ? todo.subtasks : [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.completed).length;
  const spent = liveSpentMinutes(todo);
  return `
    <article class="todo-matrix-task" data-matrix-id="${escapeHtml(todo.id)}">
      <div>
        <strong>${escapeHtml(todo.title)}</strong>
        <span>${escapeHtml(todoCategoryName(todo))} · ${priorityLabel(todo.priority)} · ${todo.dueDate ? escapeHtml(formatDateLabel(todo.dueDate)) : "无截止日"}</span>
      </div>
      <div class="todo-matrix-task-meta">
        ${subtasks.length ? `<small>${doneSubtasks}/${subtasks.length} 子任务</small>` : ""}
        ${(todo.estimateMinutes || spent) ? `<small>${formatMinutes(spent)} / ${todo.estimateMinutes ? formatMinutes(todo.estimateMinutes) : "未估时"}</small>` : ""}
        ${(todo.tags || []).slice(0, 3).map((tag) => `<small>#${escapeHtml(tag)}</small>`).join("")}
      </div>
      <div class="todo-matrix-actions">
        <button type="button" data-matrix-focus>专注</button>
        <button type="button" data-matrix-complete>完成</button>
        <button type="button" data-matrix-more>更多</button>
      </div>
    </article>
  `;
}

function renderMatrixPanel() {
  const groups = matrixGroups();
  const cards = [
    ["now", "重要且紧急", "马上处理", "高优先级，并且今天到期或已逾期。"],
    ["schedule", "重要不紧急", "安排时间", "高优先级，但还没有压到今天。"],
    ["quick", "紧急不重要", "快速清掉", "今天到期或已逾期，但优先级不高。"],
    ["later", "不急不重", "稍后整理", "适合批量处理、委托或继续拆分。"]
  ];
  return `
    <section class="todo-matrix-panel" aria-label="四象限任务矩阵">
      ${cards.map(([key, title, action, hint]) => `
        <section class="todo-matrix-column">
          <header>
            <div>
              <strong>${title}</strong>
              <span>${hint}</span>
            </div>
            <small>${groups[key].length}</small>
          </header>
          <div class="todo-matrix-list">
            ${groups[key].length ? groups[key].map(renderMatrixTask).join("") : `
              <div class="todo-matrix-empty">${action}区暂无任务。</div>
            `}
          </div>
        </section>
      `).join("")}
    </section>
  `;
}

function renderPlanTask(todo) {
  const spent = liveSpentMinutes(todo);
  const estimate = Number(todo.estimateMinutes) || 0;
  const dueLabel = todo.dueDate ? formatDateLabel(todo.dueDate) : "未安排";
  return `
    <article class="todo-plan-task" data-plan-id="${escapeHtml(todo.id)}">
      <div class="todo-plan-task-main">
        <strong>${escapeHtml(todo.title)}</strong>
        <span>${escapeHtml(todoCategoryName(todo))} · ${priorityLabel(todo.priority)} · ${escapeHtml(dueLabel)}</span>
        ${(todo.tags || []).length ? `<div>${(todo.tags || []).slice(0, 4).map((tag) => `<small>#${escapeHtml(tag)}</small>`).join("")}</div>` : ""}
      </div>
      <div class="todo-plan-task-meta">
        ${(estimate || spent) ? `<span>${formatMinutes(spent)} / ${estimate ? formatMinutes(estimate) : "未估时"}</span>` : ""}
        ${todo.repeat && todo.repeat !== "none" ? `<span>${repeatLabel(todo.repeat)}</span>` : ""}
      </div>
      <div class="todo-plan-actions">
        <button type="button" data-plan-schedule>安排</button>
        <button type="button" data-plan-focus>专注</button>
        <button type="button" data-plan-complete>完成</button>
      </div>
    </article>
  `;
}

function renderPlanPanel() {
  const groups = planGroups();
  const sections = [
    ["overdue", "逾期", "先处理承诺已经滑出去的任务。"],
    ["today", "今天", "今天真正要推进的事。"],
    ["tomorrow", "明天", "提前铺好明天的工作面。"],
    ["week", "未来 7 天", "本周需要留意的截止事项。"],
    ["future", "更晚", "已经有日期，但暂时不用本周处理。"],
    ["unscheduled", "未安排", "从这里挑任务排进日程。"]
  ];
  const todayCount = groups.today.length;
  const overdueCount = groups.overdue.length;
  return `
    <section class="todo-plan-panel" aria-label="任务规划">
      <header class="todo-plan-header">
        <div>
          <p class="todo-kicker">任务规划</p>
          <h2>Today / Upcoming</h2>
        </div>
        <div class="todo-plan-summary">
          <span><strong>${todayCount}</strong> 今天</span>
          <span><strong>${overdueCount}</strong> 逾期</span>
          <span><strong>${groups.unscheduled.length}</strong> 未安排</span>
          ${projectFilter ? `<button type="button" data-plan-clear-project>查看全部分类</button>` : ""}
        </div>
      </header>
      ${projectFilter ? `<div class="todo-plan-scope">当前分类：${escapeHtml(projectFilter)}</div>` : ""}
      <div class="todo-plan-sections">
        ${sections.map(([key, title, hint]) => `
          <section class="todo-plan-section">
            <header>
              <div>
                <strong>${title}</strong>
                <span>${hint}</span>
              </div>
              <small>${groups[key].length}</small>
            </header>
            <div class="todo-plan-list">
              ${groups[key].length ? groups[key].map(renderPlanTask).join("") : `
                <div class="todo-plan-empty">这里暂时没有任务。</div>
              `}
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function renderProjectsPanel() {
  const rows = projectDashboardRows();
  const totalActive = rows.reduce((sum, row) => sum + row.active, 0);
  const totalFocus = rows.reduce((sum, row) => sum + row.focusMinutes, 0);
  return `
    <section class="todo-projects-panel" aria-label="分类看板">
      <header class="todo-projects-header">
        <div>
          <p class="todo-kicker">分类看板</p>
          <h2>按分类查看任务负载</h2>
        </div>
        <div class="todo-projects-summary">
          <span><strong>${rows.length}</strong> 分类</span>
          <span><strong>${totalActive}</strong> 任务</span>
          <span><strong>${formatMinutes(totalFocus)}</strong> 本月专注</span>
        </div>
      </header>
      <div class="todo-projects-grid">
        ${rows.length ? rows.map((row) => `
          <article class="todo-project-card" data-project-card="${escapeHtml(row.project)}">
            <header>
              <div>
                <strong>${escapeHtml(row.project)}</strong>
                <span>${row.nextDue ? `下个截止 ${escapeHtml(formatDateLabel(row.nextDue))}` : "暂无截止日"}</span>
              </div>
              <small>${row.active}</small>
            </header>
            <div class="todo-project-metrics">
              <span><strong>${row.overdue}</strong> 逾期</span>
              <span><strong>${row.high}</strong> 高优先级</span>
              <span><strong>${row.completed}</strong> 已完成</span>
              <span><strong>${formatMinutes(row.focusMinutes)}</strong> 专注</span>
            </div>
            <div class="todo-project-recent">
              ${row.recent.length ? row.recent.map((todo) => `
                <span>${escapeHtml(todo.title)}${todo.dueDate ? ` · ${escapeHtml(formatDateLabel(todo.dueDate))}` : ""}</span>
              `).join("") : `<span class="todo-muted">这个分类当前没有任务。</span>`}
            </div>
            <div class="todo-project-actions">
              <button type="button" data-project-list>看清单</button>
              <button type="button" data-project-more>更多</button>
            </div>
          </article>
        `).join("") : `<div class="todo-empty"><strong>暂无分类</strong><span>创建任务时填写分类后，这里会自动汇总。</span></div>`}
      </div>
    </section>
  `;
}

function renderGoalCard(goal) {
  const progress = goalProgressInfo(goal);
  const tasks = goalTasks(goal);
  const isEditing = editingGoalId === goal.id;
  const hint = goalStatusHint(goal);
  if (isEditing) {
    return `
      <article class="todo-goal-card editing" data-goal-id="${escapeHtml(goal.id)}">
        ${renderGoalForm(goal)}
      </article>
    `;
  }
  return `
    <article class="todo-goal-card status-${escapeHtml(goalStatusLabel(goal.status))}" data-goal-id="${escapeHtml(goal.id)}">
      <header>
        <div>
          <strong>${escapeHtml(goal.title)}</strong>
          <span>${escapeHtml(goalCategoryText(goal))}${goal.deadline ? ` · 截止 ${escapeHtml(formatDateLabel(goal.deadline))}` : " · 未设置截止日期"}</span>
        </div>
        <small>${escapeHtml(progress.percentText)}</small>
      </header>
      <span class="todo-goal-status">${escapeHtml(goalStatusLabel(goal.status))} · ${escapeHtml(hint)}</span>
      <span class="todo-goal-progress"><i style="--bar:${progress.progress}"></i></span>
      <div class="todo-goal-metrics">
        <span><strong>${escapeHtml(progress.countText)}</strong> 数量进度</span>
        <span><strong>${escapeHtml(goalCountText(goal.currentCount))}</strong> 当前数量</span>
        <span><strong>${escapeHtml(goalCountText(goal.targetCount))}</strong> 目标数量</span>
        <span><strong>${escapeHtml(goalScoreText(goal.currentAverageScore))}</strong> 当前均分</span>
        <span><strong>${escapeHtml(goalScoreText(goal.targetScore))}</strong> 目标均分</span>
        <span><strong>${tasks.length}</strong> 关联任务</span>
      </div>
      <div class="todo-goal-actions">
        <button type="button" data-goal-edit>编辑</button>
        <button type="button" data-goal-archive ${goal.status === "archived" ? "disabled" : ""}>归档</button>
        <button type="button" data-goal-breakdown>拆解本周任务</button>
      </div>
    </article>
  `;
}

function renderGoalDetail(goal) {
  if (!goal) return "";
  const tasks = goalTasks(goal).sort((a, b) => {
    const dueA = a.dueDate || "9999-12-31";
    const dueB = b.dueDate || "9999-12-31";
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
  });
  const progress = goalProgressInfo(goal);
  return `
    <section class="todo-goal-detail" data-goal-detail="${escapeHtml(goal.id)}" aria-label="目标详情">
      <header>
        <div>
          <p class="todo-kicker">目标详情</p>
          <h2>${escapeHtml(goal.title)}</h2>
          <span>${escapeHtml(goalCategoryText(goal))} · ${goal.deadline ? `截止 ${escapeHtml(formatDateLabel(goal.deadline))}` : "未设置截止日期"} · ${escapeHtml(goalStatusLabel(goal.status))}</span>
        </div>
        <strong>${escapeHtml(progress.countText)}</strong>
      </header>
      <div class="todo-goal-detail-grid">
        <section>
          <h3>关联任务</h3>
          ${tasks.length ? tasks.map((todo) => `
            <article class="todo-goal-task">
              <span>${escapeHtml(todo.title)}</span>
              <small>${todo.dueDate ? escapeHtml(formatDateLabel(todo.dueDate)) : "未安排"} · ${priorityLabel(todo.priority)}优先级 · ${todo.completed ? "已完成" : "进行中"}</small>
            </article>
          `).join("") : `<div class="todo-goal-empty">这个目标还没有关联任务。</div>`}
        </section>
        <form class="todo-goal-task-form" data-goal-task-form data-goal-id="${escapeHtml(goal.id)}">
          <label>
            <span>任务标题</span>
            <input name="title" type="text" maxlength="180" placeholder="拆成下一步行动" required />
          </label>
          <label>
            <span>截止日期</span>
            <input name="dueDate" type="date" value="${escapeHtml(goal.deadline || "")}" />
          </label>
          <label>
            <span>优先级</span>
            <select name="priority">
              <option value="high">高</option>
              <option value="medium" selected>中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label>
            <span>预估时间</span>
            <input name="estimateMinutes" type="text" maxlength="24" placeholder="50m" />
          </label>
          <button type="submit">创建关联任务</button>
        </form>
      </div>
      ${renderGoalWeekBreakdown(goal)}
    </section>
  `;
}

function renderGoalsPanel() {
  const list = sortedGoals();
  const activeCount = list.filter((goal) => goal.status === "active").length;
  const archivedCount = list.filter((goal) => goal.status === "archived").length;
  const selectedGoal = goalById(selectedGoalId);
  return `
    <section class="todo-goals-panel" aria-label="目标管理">
      <header class="todo-goals-header">
        <div>
          <p class="todo-kicker">目标</p>
          <h2>长期学习计划</h2>
        </div>
        <div class="todo-goals-summary">
          <span><strong>${list.length}</strong> 全部目标</span>
          <span><strong>${activeCount}</strong> 进行中</span>
          <span><strong>${archivedCount}</strong> 已归档</span>
        </div>
      </header>
      ${renderGoalForm()}
      <div class="todo-goals-grid">
        ${list.length ? list.map(renderGoalCard).join("") : `<div class="todo-empty"><strong>还没有学习目标，创建一个阶段目标吧。</strong></div>`}
      </div>
      ${renderGoalDetail(selectedGoal)}
    </section>
  `;
}

function renderGoalConversionModal() {
  const todo = todos.find((item) => item.id === convertingGoalTodoId);
  if (!todo) return "";
  const draft = parseGoalLikeTodo(todo);
  const categoryId = normalizeTaskCategory(draft.categoryId || todoCategoryName(todo));
  return `
    <section class="todo-modal-backdrop" role="presentation">
      <form class="todo-goal-convert-modal" data-goal-convert-form data-todo-id="${escapeHtml(todo.id)}" role="dialog" aria-modal="true" aria-label="转换为目标">
        <header>
          <div>
            <p class="todo-kicker">转换为目标</p>
            <h2>确认目标字段</h2>
            <span>无法解析的字段可以留空，稍后在 Goals 页面继续补充。</span>
          </div>
          <button type="button" data-goal-convert-cancel aria-label="取消">取消</button>
        </header>
        <label>
          <span>标题</span>
          <input name="title" type="text" maxlength="180" value="${escapeHtml(draft.title || todo.title)}" required />
        </label>
        <label>
          <span>分类</span>
          <input name="categoryId" type="text" maxlength="80" value="${escapeHtml(categoryId)}" />
        </label>
        <label>
          <span>截止日期</span>
          <input name="deadline" type="date" value="${escapeHtml(draft.deadline || "")}" />
        </label>
        <label>
          <span>目标数量</span>
          <input name="targetCount" type="number" min="0" step="1" value="${draft.targetCount ? escapeHtml(String(draft.targetCount)) : ""}" />
        </label>
        <label>
          <span>目标均分</span>
          <input name="targetScore" type="number" min="0" step="1" value="${draft.targetScore ? escapeHtml(String(draft.targetScore)) : ""}" />
        </label>
        <div class="todo-goal-convert-source">
          <strong>原任务</strong>
          <span>${escapeHtml(todo.title)}</span>
        </div>
        <footer>
          <button type="submit">确认转换</button>
          <button type="button" data-goal-convert-cancel>取消</button>
        </footer>
      </form>
    </section>
  `;
}

function renderTemplatesPanel() {
  const templates = todoTemplates();
  return `
    <section class="todo-templates-panel" aria-label="任务模板">
      <header class="todo-templates-header">
        <div>
          <p class="todo-kicker">任务模板</p>
          <h2>常用流程一键加入清单</h2>
        </div>
        <div class="todo-templates-summary">
          <span><strong>${templates.length}</strong> 模板</span>
          <span><strong>${templates.filter((template) => template.repeat !== "none").length}</strong> 可重复</span>
        </div>
      </header>
      <div class="todo-templates-grid">
        ${templates.map((template) => `
          <article class="todo-template-card" data-template-id="${escapeHtml(template.id)}">
            <header>
              <div>
                <strong>${escapeHtml(template.title)}</strong>
                <span>${escapeHtml(template.description)}</span>
              </div>
              <small>${formatMinutes(template.estimateMinutes)}</small>
            </header>
            <div class="todo-template-meta">
              <span>${escapeHtml(template.project)}</span>
              <span>${repeatLabel(template.repeat)}</span>
              <span>${priorityLabel(template.priority)}</span>
              ${(template.tags || []).map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}
            </div>
            <div class="todo-template-steps">
              ${(template.subtasks || []).slice(0, 5).map((step) => `<span>${escapeHtml(step)}</span>`).join("")}
            </div>
            <div class="todo-template-actions">
              <button type="button" data-template-create>加入今日</button>
              <button type="button" data-template-create-focus>并专注</button>
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function triageMissingLabels(todo) {
  const missing = [];
  if (todoCategoryName(todo) === "Inbox") missing.push("分类");
  if (!todo.dueDate) missing.push("日期");
  if (!todo.estimateMinutes) missing.push("估时");
  if (!(Array.isArray(todo.tags) && todo.tags.length)) missing.push("标签");
  return missing;
}

function renderTriagePanel() {
  const items = triageTodos();
  const projects = triageProjectOptions();
  const tags = triageTagOptions();
  return `
    <section class="todo-triage-panel" aria-label="Inbox 整理">
      <header class="todo-triage-header">
        <div>
          <p class="todo-kicker">Inbox 整理</p>
          <h2>把模糊任务变成可执行任务</h2>
        </div>
        <div class="todo-triage-summary">
          <span><strong>${items.length}</strong> 待整理</span>
          <button type="button" data-triage-list>回到清单</button>
        </div>
      </header>
      <div class="todo-triage-list">
        ${items.length ? items.map((todo) => {
          const missing = triageMissingLabels(todo);
          return `
            <article class="todo-triage-card" data-triage-id="${escapeHtml(todo.id)}">
              <header>
                <div>
                  <strong>${escapeHtml(todo.title)}</strong>
                  <span>${escapeHtml(todoCategoryName(todo))} · ${todo.dueDate ? escapeHtml(formatDateLabel(todo.dueDate)) : "未安排"} · ${todo.estimateMinutes ? formatMinutes(todo.estimateMinutes) : "未估时"}</span>
                </div>
                <small>${missing.join(" / ")}</small>
              </header>
              ${todo.notes ? `<p>${escapeHtml(todo.notes)}</p>` : ""}
              <div class="todo-triage-actions">
                <button type="button" data-triage-schedule>安排</button>
                <button type="button" data-triage-high>高优先级</button>
                <button type="button" data-triage-estimate>估时</button>
                <button type="button" data-triage-edit>编辑</button>
              </div>
              <div class="todo-triage-projects">
                ${projects.map((project) => `
                  <button type="button" data-triage-project="${escapeHtml(project)}">${escapeHtml(project)}</button>
                `).join("")}
              </div>
              <div class="todo-triage-tags">
                ${tags.map((tag) => `
                  <button type="button" data-triage-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>
                `).join("")}
              </div>
            </article>
          `;
        }).join("") : `
          <div class="todo-empty">
            <strong>Inbox 已清空</strong>
          <span>当前没有需要补分类、日期、估时或标签的任务。</span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderExecutePanel() {
  const timer = activeFocusTimer();
  const running = focusTimerTask(timer) || todos.find((todo) => todo.timerStartedAt) || null;
  const next = nextActionTodo();
  const timerInfo = timer ? focusTimerInfo(timer) : focusTimerInfo();
  const queue = executionQueue();
  return `
    <section class="todo-execute-panel" aria-label="今日执行">
      <header class="todo-execute-hero">
        <div>
          <p class="todo-kicker">${running ? "正在专注" : "下一步行动"}</p>
          <h2>${next ? escapeHtml(next.title) : "今天没有待执行任务"}</h2>
          <span>${next ? `${escapeHtml(todoCategoryName(next))} · ${priorityLabel(next.priority)} · ${next.dueDate ? escapeHtml(formatDateLabel(next.dueDate)) : "未安排"}` : "可以去规划或模板里添加下一件事。"}</span>
        </div>
        <div class="todo-execute-timer">
          <strong>${running && timerInfo ? formatClock(timerInfo.remainingSeconds) : next && next.estimateMinutes ? formatMinutes(next.estimateMinutes) : `${focusDefaultMinutes}m`}</strong>
          <span>${running ? "剩余" : "建议专注"}</span>
        </div>
      </header>
      ${projectFilter ? `
        <div class="todo-execute-scope">
          <span>当前分类：${escapeHtml(projectFilter)}</span>
          <button type="button" data-execute-clear-project>查看全部</button>
        </div>
      ` : ""}
      ${next ? `
        <div class="todo-execute-actions" data-execute-id="${escapeHtml(next.id)}">
          <button type="button" data-execute-focus>${running && running.id === next.id ? "查看专注" : "开始专注"}</button>
          <button type="button" data-execute-complete>完成</button>
          <button type="button" data-execute-more>更多</button>
        </div>
      ` : `
        <div class="todo-execute-actions">
          <button type="button" data-execute-plan>去规划</button>
          <button type="button" data-execute-template>用模板创建</button>
        </div>
      `}
      <section class="todo-execute-queue">
        <header>
          <strong>今日队列</strong>
          <span>${queue.length} 项</span>
        </header>
        <div class="todo-execute-list">
          ${queue.length ? queue.map((todo) => `
            <article class="todo-execute-item" data-execute-queue-id="${escapeHtml(todo.id)}">
              <div>
                <strong>${escapeHtml(todo.title)}</strong>
                <span>${escapeHtml(todoCategoryName(todo))} · ${todo.dueDate ? escapeHtml(formatDateLabel(todo.dueDate)) : "高优先级"} · ${todo.estimateMinutes ? formatMinutes(todo.estimateMinutes) : "未估时"}</span>
              </div>
              <button type="button" data-execute-queue-focus>专注</button>
            </article>
          `).join("") : `<div class="todo-empty"><strong>今日队列为空</strong><span>规划今天或设置高优先级后会出现在这里。</span></div>`}
        </div>
      </section>
    </section>
  `;
}

function renderCalendarTask(todo) {
  return `
    <article class="todo-calendar-task" data-calendar-id="${escapeHtml(todo.id)}">
      <strong>${escapeHtml(todo.title)}</strong>
      <span>${escapeHtml(todoCategoryName(todo))} · ${priorityLabel(todo.priority)}${todo.estimateMinutes ? ` · ${formatMinutes(todo.estimateMinutes)}` : ""}</span>
      <div>
        <button type="button" data-calendar-focus>专注</button>
        <button type="button" data-calendar-complete>完成</button>
        <button type="button" data-calendar-more>更多</button>
      </div>
    </article>
  `;
}

function renderCalendarEvent(event) {
  const startTime = String(event.startAt || "").slice(11, 16);
  const endTime = String(event.endAt || "").slice(11, 16);
  const timeLabel = startTime ? `${startTime}${endTime && endTime !== startTime ? `-${endTime}` : ""}` : "全天";
  const category = categoryNameFromId(event.categoryId) || "日程";
  return `
    <article class="todo-calendar-task todo-calendar-event" data-calendar-event="${escapeHtml(event.id)}">
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(timeLabel)} · ${escapeHtml(category)}</span>
    </article>
  `;
}

function renderCalendarPanel() {
  const calendar = calendarGroups();
  const taskCount = calendar.days.reduce((sum, day) => sum + calendar.groups[day].length, 0);
  const eventCount = calendar.days.reduce((sum, day) => sum + calendar.eventGroups[day].length, 0);
  return `
    <section class="todo-calendar-panel" aria-label="本周日历">
      <header class="todo-calendar-header">
        <div>
          <p class="todo-kicker">周历</p>
          <h2>${calendar.days[0]} 至 ${calendar.days[6]}</h2>
        </div>
        <div class="todo-calendar-summary">
          <span><strong>${taskCount}</strong> 本周任务</span>
          <span><strong>${eventCount}</strong> 日程</span>
          <span><strong>${calendar.overdue.length}</strong> 逾期</span>
        </div>
      </header>
      ${calendar.overdue.length ? `
        <section class="todo-calendar-overdue">
          <header><strong>逾期未处理</strong><span>${calendar.overdue.length} 项</span></header>
          <div>${calendar.overdue.map(renderCalendarTask).join("")}</div>
        </section>
      ` : ""}
      <div class="todo-calendar-grid">
        ${calendar.days.map((day) => `
          <section class="todo-calendar-day ${day === calendar.today ? "today" : ""}">
            <header>
              <strong>${escapeHtml(formatDateLabel(day))}</strong>
              <span>${calendar.groups[day].length + calendar.eventGroups[day].length}</span>
            </header>
            <div>
              ${calendar.eventGroups[day].length ? calendar.eventGroups[day].map(renderCalendarEvent).join("") : ""}
              ${calendar.groups[day].length ? calendar.groups[day].map(renderCalendarTask).join("") : ""}
              ${!calendar.eventGroups[day].length && !calendar.groups[day].length ? `<div class="todo-calendar-empty">暂无安排</div>` : ""}
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
}

function renderStatsPanel() {
  const summary = analyticsSummary();
  const hasCompletedTrend = summary.trend.some((item) => item.completed > 0);
  const hasFocusTrend = summary.trend.some((item) => item.focusMinutes > 0);
  const maxFocus = Math.max(1, ...summary.trend.map((item) => item.focusMinutes));
  const maxCompleted = Math.max(1, ...summary.trend.map((item) => item.completed));
  const maxProjectFocus = Math.max(1, ...summary.projectRows.map((item) => item.focusMinutes));
  return `
    <section class="todo-stats-panel" aria-label="任务统计">
      <header class="todo-stats-header">
        <div>
          <p class="todo-kicker">统计分析</p>
          <h2>7 天趋势与分类分布</h2>
        </div>
        <div class="todo-stats-actions">
          <button type="button" data-stats-view="plan">规划任务</button>
          <button type="button" data-stats-view="review">写复盘</button>
          <button type="button" data-stats-view="focus">开始专注</button>
        </div>
      </header>
      <div class="todo-analytics-grid">
        <section class="todo-analytics-card todo-analytics-metrics">
          <span><strong>${summary.completed7}</strong> 7 天完成</span>
          <span><strong>${formatMinutes(summary.focus7)}</strong> 7 天专注</span>
          <span><strong>${summary.highActive}</strong> 高优先级</span>
          <span><strong>${summary.unplanned}</strong> 未安排</span>
        </section>
        <section class="todo-analytics-card">
          <header>
            <strong>完成趋势</strong>
            <span>最近 7 天</span>
          </header>
          ${hasCompletedTrend ? `<div class="todo-trend-bars">
            ${summary.trend.map((item) => `
              <div class="todo-trend-bar" title="${item.day} 完成 ${item.completed} 项">
                <span style="--bar:${Math.max(0.04, item.completed / maxCompleted)}"></span>
                <small>${item.day.slice(5)}</small>
              </div>
            `).join("")}
          </div>` : `<div class="todo-plan-empty">最近 7 天还没有完成记录。</div>`}
        </section>
        <section class="todo-analytics-card">
          <header>
            <strong>专注趋势</strong>
            <span>最近 7 天</span>
          </header>
          ${hasFocusTrend ? `<div class="todo-trend-bars focus">
            ${summary.trend.map((item) => `
              <div class="todo-trend-bar" title="${item.day} 专注 ${formatMinutes(item.focusMinutes)}">
                <span style="--bar:${Math.max(0.04, item.focusMinutes / maxFocus)}"></span>
                <small>${item.day.slice(5)}</small>
              </div>
            `).join("")}
          </div>` : `<div class="todo-plan-empty">最近 7 天还没有番茄专注记录。</div>`}
        </section>
        <section class="todo-analytics-card todo-project-analytics">
          <header>
            <strong>分类分布</strong>
            <span>本月专注 / 当前任务</span>
          </header>
          ${summary.projectRows.length ? summary.projectRows.map((item) => `
            <div class="todo-project-row">
              <div>
                <strong>${escapeHtml(item.project)}</strong>
                <span>${formatMinutes(item.focusMinutes)} 专注 · ${item.active} 任务</span>
              </div>
              <span class="todo-project-bar"><i style="--bar:${Math.max(0.04, item.focusMinutes / maxProjectFocus)}"></i></span>
            </div>
          `).join("") : `<div class="todo-plan-empty">还没有分类统计数据。</div>`}
        </section>
      </div>
    </section>
  `;
}

function renderReviewMetric(label, value, caption = "") {
  return `
    <span>
      <strong>${escapeHtml(value)}</strong>
      ${escapeHtml(label)}
      ${caption ? `<small>${escapeHtml(caption)}</small>` : ""}
    </span>
  `;
}

function renderReviewStateNotice(state) {
  if (state === "loading") {
    return `<div class="todo-review-state loading" role="status">正在加载统计数据。</div>`;
  }
  if (state === "empty") {
    return `<div class="todo-review-state empty" role="status">暂无数据。完成任务或番茄后，这里会自动生成复盘统计。</div>`;
  }
  return "";
}

function renderReviewTaskTrend(rows) {
  const hasData = rows.some((row) => row.completed > 0 || row.created > 0);
  if (!hasData) return EmptyChartState("暂无数据");
  const maxValue = Math.max(1, ...rows.map((row) => Math.max(row.completed, row.created)));
  return `
    <div class="todo-review-day-bars" aria-label="最近 7 天任务趋势">
      ${rows.map((row) => `
        <div class="todo-review-day-bar" title="${row.day} 完成 ${row.completed} 个，新增 ${row.created} 个">
          <div>
            <i class="completed" style="--bar:${safePercent(row.completed, maxValue) / 100}"></i>
            <i class="created" style="--bar:${safePercent(row.created, maxValue) / 100}"></i>
          </div>
          <span>${escapeHtml(row.day.slice(5))}</span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReviewFocusTrend(rows) {
  const hasData = rows.some((row) => row.minutes > 0 || row.count > 0);
  if (!hasData) return EmptyChartState("暂无数据");
  const maxMinutes = Math.max(1, ...rows.map((row) => row.minutes));
  return `
    <div class="todo-review-focus-bars" aria-label="最近 7 天番茄趋势">
      ${rows.map((row) => `
        <div class="todo-review-focus-bar" title="${row.day} 专注 ${formatMinutes(row.minutes)}，完成 ${row.count} 个番茄">
          <i style="--bar:${safePercent(row.minutes, maxMinutes) / 100}"></i>
          <span>${escapeHtml(row.day.slice(5))}</span>
          <small>${row.count ? `${row.count} 个` : ""}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReviewStatRows(rows, emptyText = "暂无对比数据") {
  if (!rows.length) return EmptyChartState(emptyText);
  const maxValue = Math.max(1, ...rows.map((row) => row.value));
  return `
    <div class="todo-review-stat-rows">
      ${rows.map((row) => `
        <div class="todo-review-stat-row">
          <div>
            <strong>${escapeHtml(row.label)}</strong>
            <span>${escapeHtml(row.valueText || String(row.value))}</span>
          </div>
          <span class="todo-review-stat-bar"><i style="--bar:${safePercent(row.value, maxValue) / 100}"></i></span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderReviewGoalList(goalRows, emptyText = "暂无对比数据") {
  if (!goalRows.length) return EmptyChartState(emptyText);
  return `
    <div class="todo-review-goal-list">
      ${goalRows.map((goal) => `
        <span>
          <strong>${escapeHtml(goal.title)}</strong>
          <small>${escapeHtml(goal.category || "未分类")}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderYesterdayReviewSection(stats, state) {
  return `
    <section class="todo-review-section state-${state}" aria-label="昨日小结">
      <header>
        <div>
          <p class="todo-kicker">昨日小结</p>
          <h2>${escapeHtml(dateRangeLabel(stats.range))}</h2>
        </div>
        <span>${state === "empty" ? "暂无数据" : "昨天"}</span>
      </header>
      <p class="todo-review-summary-text">${escapeHtml(stats.primaryText)}</p>
      ${stats.goalText ? `<p class="todo-review-summary-text">${escapeHtml(stats.goalText)}</p>` : ""}
      <div class="todo-review-metrics">
        ${renderReviewMetric("完成任务数", String(stats.completedTasks.length))}
        ${renderReviewMetric("新增任务数", String(stats.createdTasks.length))}
        ${renderReviewMetric("番茄专注时长", formatMinutes(stats.focusMinutes))}
        ${renderReviewMetric("完成番茄数", String(stats.sessions.length))}
        ${renderReviewMetric("推进目标数", String(stats.goalRows.length))}
      </div>
      <div class="todo-review-split">
        <div class="todo-review-list">
          <strong>昨日完成任务</strong>
          ${stats.completedTasks.length ? stats.completedTasks.slice(0, 6).map((todo) => `
            <span>${escapeHtml(todo.title)} · ${escapeHtml(todoCategoryName(todo) || "未分类")}</span>
          `).join("") : EmptyChartState("暂无数据")}
        </div>
        <div class="todo-review-list">
          <strong>推进的目标</strong>
          ${renderReviewGoalList(stats.goalRows, "暂无对比数据")}
        </div>
      </div>
    </section>
  `;
}

function renderTaskReviewSection(stats, state) {
  return `
    <section class="todo-review-section state-${state}" aria-label="任务统计">
      <header>
        <div>
          <p class="todo-kicker">任务统计</p>
          <h2>最近 7 天</h2>
        </div>
        <span>完成率 ${formatPercent(stats.completionRate)}</span>
      </header>
      <div class="todo-review-metrics">
        ${renderReviewMetric("7 天完成任务数", String(stats.completed7))}
        ${renderReviewMetric("7 天新增任务数", String(stats.created7))}
        ${renderReviewMetric("当前未完成任务数", String(stats.currentIncomplete))}
        ${renderReviewMetric("当前过期任务数", String(stats.currentOverdue))}
        ${renderReviewMetric("完成率", formatPercent(stats.completionRate), "完成 / 完成+当前未完成")}
      </div>
      <div class="todo-review-split">
        <div class="todo-review-chart-card">
          <strong>每日完成 / 新增</strong>
          ${renderReviewTaskTrend(stats.dailyRows)}
          <small><i class="legend completed"></i>完成任务数 <i class="legend created"></i>新增任务数</small>
        </div>
        <div class="todo-review-chart-card">
          <strong>按分类完成任务数</strong>
          ${renderReviewStatRows(stats.categoryRows, "暂无对比数据")}
        </div>
      </div>
    </section>
  `;
}

function renderPomodoroReviewSection(stats, state) {
  return `
    <section class="todo-review-section state-${state}" aria-label="番茄统计">
      <header>
        <div>
          <p class="todo-kicker">番茄统计</p>
          <h2>最近 7 天</h2>
        </div>
        <span>${stats.completedCount ? `${stats.completedCount} 个番茄` : "暂无数据"}</span>
      </header>
      <div class="todo-review-metrics">
        ${renderReviewMetric("完成番茄数", String(stats.completedCount))}
        ${renderReviewMetric("专注总时长", formatMinutes(stats.totalMinutes))}
        ${renderReviewMetric("平均单次专注时长", formatMinutes(stats.averageMinutes))}
      </div>
      <div class="todo-review-split">
        <div class="todo-review-chart-card">
          <strong>每日番茄专注</strong>
          ${renderReviewFocusTrend(stats.dailyRows)}
        </div>
        <div class="todo-review-chart-card">
          <strong>按分类专注时长</strong>
          ${renderReviewStatRows(stats.categoryRows, "暂无对比数据")}
        </div>
        <div class="todo-review-chart-card wide">
          <strong>按目标专注时长</strong>
          ${renderReviewStatRows(stats.goalRows, "暂无对比数据")}
        </div>
      </div>
    </section>
  `;
}

function renderWeeklyReviewSection(stats, state) {
  return `
    <section class="todo-review-section state-${state}" aria-label="周报">
      <header>
        <div>
          <p class="todo-kicker">周报</p>
          <h2>${escapeHtml(dateRangeLabel(stats.range))}</h2>
        </div>
        <span>本周</span>
      </header>
      <div class="todo-review-metrics">
        ${renderReviewMetric("本周完成任务数", String(stats.completedTasks.length))}
        ${renderReviewMetric("本周新增任务数", String(stats.createdTasks.length))}
        ${renderReviewMetric("本周专注总时长", formatMinutes(stats.focusMinutes))}
        ${renderReviewMetric("完成最多的分类", stats.topCategory ? stats.topCategory.label : "暂无数据")}
      </div>
      <div class="todo-review-split">
        <div class="todo-review-list">
          <strong>本周推进的目标</strong>
          ${renderReviewGoalList(stats.goalRows, "暂无对比数据")}
        </div>
        <div class="todo-review-list">
          <strong>下周建议</strong>
          <span>${escapeHtml(stats.suggestion)}</span>
        </div>
      </div>
    </section>
  `;
}

function renderReviewJournal() {
  const review = currentReview();
  const reviewTypes = [
    ["daily", "日复盘"],
    ["weekly", "周复盘"],
    ["monthly", "月复盘"]
  ];
  return `
    <section class="todo-review-section todo-review-journal" aria-label="复盘记录">
      <header>
        <div>
          <p class="todo-kicker">复盘记录</p>
          <h2>把统计变成下一步行动</h2>
        </div>
        <strong>${escapeHtml(periodLabel(reviewType, review.periodKey))}</strong>
      </header>
      <div class="todo-review-toolbar">
        <div class="todo-review-type" role="tablist" aria-label="复盘周期">
          ${reviewTypes.map(([key, label]) => `
            <button type="button" class="${reviewType === key ? "active" : ""}" data-review-type="${key}" role="tab">${label}</button>
          `).join("")}
        </div>
      </div>
      <form class="todo-review-form" data-review-form>
        <label>
          <span>做得好的事</span>
          <textarea name="wins" rows="4" maxlength="4000" placeholder="记录今天/本周/本月推进了什么，哪些方法有效。">${escapeHtml(review.wins)}</textarea>
        </label>
        <label>
          <span>卡点与干扰</span>
          <textarea name="blockers" rows="3" maxlength="4000" placeholder="写下拖延、等待、上下文切换或需要外部协作的地方。">${escapeHtml(review.blockers)}</textarea>
        </label>
        <label>
          <span>下一步行动</span>
          <textarea name="nextActions" rows="3" maxlength="4000" placeholder="把复盘变成下一轮可执行动作。">${escapeHtml(review.nextActions)}</textarea>
        </label>
        <label>
          <span>状态评分</span>
          <input name="score" type="number" min="0" max="5" step="1" value="${safeCount(review.score)}" />
        </label>
        <div class="todo-review-actions">
          <button type="submit">保存复盘</button>
          <button type="button" data-review-create-actions ${reviewActionLines(review.nextActions).length ? "" : "disabled"}>生成行动</button>
        </div>
      </form>
    </section>
  `;
}

function renderReviewPanel() {
  const state = reviewPageState();
  const yesterday = reviewYesterdayStats();
  const taskStats = reviewTaskStats();
  const pomodoroStats = reviewPomodoroStats();
  const weeklyStats = reviewWeeklyStats();
  return `
    <section class="todo-review-panel" data-review-state="${escapeHtml(state)}">
      ${renderReviewStateNotice(state)}
      ${renderYesterdayReviewSection(yesterday, state)}
      ${renderTaskReviewSection(taskStats, state)}
      ${renderPomodoroReviewSection(pomodoroStats, state)}
      ${renderWeeklyReviewSection(weeklyStats, state)}
      ${renderReviewJournal()}
    </section>
  `;
}

function renderFocusPanel() {
  const timer = activeFocusTimer();
  const timerInfo = focusTimerInfo(timer);
  const running = focusTimerTask(timer);
  const activeTodos = todos.filter((todo) => !todo.completed);
  const recentSessions = focusSessions.slice().sort((a, b) =>
    String(b.endedAt || b.startedAt || "").localeCompare(String(a.endedAt || a.startedAt || ""))
  ).slice(0, 10);
  const statusLabel = timer && timer.status === "paused" ? "已暂停" : timer ? "正在专注" : "待开始";
  return `
    <section class="todo-focus-panel">
      <div class="todo-focus-current">
        <div>
          <p class="todo-kicker">番茄专注</p>
          <h2>${timer ? escapeHtml((running && running.title) || timer.title || "当前任务") : "选择一个任务开始专注"}</h2>
          <span>${timer && timerInfo ? `${statusLabel} · 剩余 ${formatClock(timerInfo.remainingSeconds)} · 已专注 ${formatClock(timerInfo.elapsedSeconds)}` : "默认 50 分钟，从任务开始后会绑定任务和分类。"}</span>
        </div>
        <div class="todo-focus-ring" style="--progress:${timerInfo ? timerInfo.progress : 0}">
          <strong>${timerInfo ? formatClock(timerInfo.remainingSeconds) : "50:00"}</strong>
        </div>
      </div>
      <form class="todo-focus-form" data-focus-form>
        <label>
          <span>任务</span>
          <select name="todoId" ${timer ? "disabled" : ""}>
            ${activeTodos.length ? activeTodos.map((todo) => `
              <option value="${escapeHtml(todo.id)}" ${timer && timer.taskId === todo.id ? "selected" : ""}>${escapeHtml(todo.title)}</option>
            `).join("") : `<option value="">暂无任务</option>`}
          </select>
        </label>
        <label>
          <span>专注分钟</span>
          <input name="focusMinutes" type="number" min="1" max="240" step="1" value="${timer ? timer.plannedMinutes : focusDefaultMinutes}" ${timer ? "disabled" : ""} />
        </label>
        <div class="todo-focus-actions">
          ${timer && timer.status === "running" ? `
            <button type="button" data-focus-pause>暂停</button>
            <button type="button" data-focus-complete>完成</button>
            <button type="button" class="danger-text" data-focus-abandon>放弃</button>
          ` : timer && timer.status === "paused" ? `
            <button type="button" data-focus-resume>继续</button>
            <button type="button" class="danger-text" data-focus-abandon>放弃</button>
          ` : `
            <button type="submit" ${activeTodos.length ? "" : "disabled"}>开始番茄专注</button>
          `}
        </div>
      </form>
      <div class="todo-focus-history">
        <strong>最近专注</strong>
        ${recentSessions.length ? recentSessions.map((session) => `
          <div class="todo-focus-session">
            <span>${escapeHtml(session.title)}</span>
            <small>${formatMinutes(focusSessionMinutes(session))} · ${session.status === "abandoned" ? "已放弃" : "已完成"} · ${escapeHtml(focusSessionCategoryName(session))} · ${String(session.endedAt || session.startedAt || "").slice(0, 16).replace("T", " ")}</small>
          </div>
        `).join("") : `<span class="todo-muted">完成或放弃番茄后会自动记录专注历史。</span>`}
      </div>
    </section>
  `;
}

function renderCreateForm(options = {}) {
  const selectedDate = options.selectedDate || "";
  const topClass = options.top ? " todo-top-create" : "";
  return `
    <form class="todo-create todo-quick-create${topClass}" data-create-form data-selected-date="${escapeHtml(selectedDate)}" aria-label="快速添加任务">
      <label class="todo-quick-input">
        <span>任务</span>
        <input name="title" type="text" maxlength="180" placeholder="添加任务，例如：明天 19:00 数学真题 2h #数学 !高" autocomplete="off" />
      </label>
      <button type="submit">添加任务</button>
      <div class="todo-quick-preview" data-quick-preview hidden></div>
      <input name="notes" type="hidden" value="" />
      <input name="subtasks" type="hidden" value="" />
      <input name="project" type="hidden" value="" />
      <input name="priority" type="hidden" value="medium" />
      <input name="dueDate" type="hidden" value="" />
      <input name="waitingFor" type="hidden" value="" />
      <input name="waitingUntil" type="hidden" value="" />
      <input name="repeat" type="hidden" value="none" />
      <input name="estimateMinutes" type="hidden" value="" />
      <input name="tags" type="hidden" value="" />
    </form>
  `;
}

function quickCreateOptionsForCurrentView() {
  if (activeView === "today") return { selectedDate: selectedDateKey() };
  if (activeView === "calendar") return { selectedDate: calendarSelectedDateKey() };
  return {};
}

function renderTopQuickCreate() {
  const options = { ...quickCreateOptionsForCurrentView(), top: true };
  return `
    <section class="todo-top-quick" data-top-quick aria-label="顶部快速输入">
      <div class="todo-top-quick-header">
        <strong>顶部快速输入</strong>
        <span>${options.selectedDate ? escapeHtml(calendarDateTitle(options.selectedDate)) : escapeHtml(defaultTaskCategory())}</span>
      </div>
      ${renderCreateForm(options)}
    </section>
  `;
}

function renderControls(currentStats) {
  const filters = [
    ["all", "全部", currentStats.total],
    ["active", "任务", currentStats.active],
    ["completed", "已完成", currentStats.completed],
    ["today", "今天", currentStats.today],
    ["overdue", "逾期", currentStats.overdue]
  ];
  return `
    <section class="todo-controls" aria-label="任务过滤和搜索">
      <div class="todo-filters" role="tablist" aria-label="筛选">
        ${filters.map(([key, label, count]) => `
          <button type="button" class="${key === filter ? "active" : ""}" data-filter="${key}" role="tab" aria-selected="${key === filter ? "true" : "false"}">
            <span>${label}</span><small>${count}</small>
          </button>
        `).join("")}
      </div>
      <div class="todo-search-row">
        <input type="search" data-search value="${escapeHtml(search)}" placeholder="搜索任务、备注或标签" />
        <select data-sort title="排序">
          <option value="smart" ${sortMode === "smart" ? "selected" : ""}>智能排序</option>
          <option value="priority" ${sortMode === "priority" ? "selected" : ""}>优先级</option>
          <option value="updated" ${sortMode === "updated" ? "selected" : ""}>最近更新</option>
          <option value="created" ${sortMode === "created" ? "selected" : ""}>最近创建</option>
        </select>
        <button type="button" data-complete-all ${currentStats.active ? "" : "disabled"}>全部完成</button>
        <button type="button" data-reopen-all ${currentStats.completed ? "" : "disabled"}>恢复任务</button>
        <button type="button" data-clear-completed ${currentStats.completed ? "" : "disabled"}>归档已完成</button>
      </div>
    </section>
  `;
}

function renderTagRail() {
  const projects = allProjects();
  const tags = allTags();
  return `
    <aside class="todo-tag-rail">
      <div class="todo-tag-header">
        <strong>分类</strong>
        ${projectFilter ? `<button type="button" data-clear-project>全部</button>` : ""}
      </div>
      <button type="button" class="${projectFilter ? "" : "active"}" data-project="">全部分类</button>
      ${projects.map(([project, count]) => `
        <button type="button" class="${projectFilter === project ? "active" : ""}" data-project="${escapeHtml(project)}">
          <span>${escapeHtml(project)}</span><small>${count}</small>
        </button>
      `).join("")}
      <div class="todo-tag-header">
        <strong>标签</strong>
        ${tagFilter ? `<button type="button" data-clear-tag>全部</button>` : ""}
      </div>
      ${tags.length ? `<button type="button" class="${tagFilter ? "" : "active"}" data-tag="">全部标签</button>` : `<span class="todo-muted">创建任务时添加标签后可按标签过滤。</span>`}
      ${tags.map(([tag, count]) => `
        <button type="button" class="${tagFilter === tag ? "active" : ""}" data-tag="${escapeHtml(tag)}">
          <span>#${escapeHtml(tag)}</span><small>${count}</small>
        </button>
      `).join("")}
    </aside>
  `;
}

function renderTodoItem(todo) {
  const completedClass = todo.completed ? " completed" : "";
  const overdueClass = !todo.completed && todo.dueDate && todo.dueDate < localDateKey() ? " overdue" : "";
  if (editingId === todo.id) return renderEditor(todo, completedClass, overdueClass);
  const subtasks = Array.isArray(todo.subtasks) ? todo.subtasks : [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.completed).length;
  const spent = liveSpentMinutes(todo);
  const estimate = Number(todo.estimateMinutes) || 0;
  const repeatProgress = repeatProgressText(todo);
  const dueDateText = !todo.dueDate && activeView === "recent" ? "设置日期" : formatDateLabel(todo.dueDate);
  const showTimerAction = activeView !== "inbox" && !todo.completed;
  const showDuplicateAction = activeView !== "inbox" && activeView !== "today" && activeView !== "recent";
  const activeTimerForTodo = isFocusTimerForTodo(todo);
  const goalLike = !todo.completed && detectGoalLikeTask(todo.title);
  const showConvertGoalAction = goalLike && ["inbox", "recent", "category"].includes(activeView);

  return `
    <article class="todo-item${completedClass}${overdueClass}" data-id="${escapeHtml(todo.id)}">
      <label class="todo-check" title="${todo.completed ? "标记为任务" : "标记为完成"}">
        <input type="checkbox" data-toggle ${todo.completed ? "checked" : ""} />
        <span></span>
      </label>
      <div class="todo-content">
        <div class="todo-title-row">
          <strong>${escapeHtml(todo.title)}</strong>
          <span class="todo-state">${todoStatus(todo)}</span>
        </div>
        ${todo.notes ? `<p>${escapeHtml(todo.notes)}</p>` : ""}
        ${subtasks.length ? `
          <div class="todo-subtasks">
            ${subtasks.map((subtask) => `
              <label>
                <input type="checkbox" data-subtask="${escapeHtml(subtask.id)}" ${subtask.completed ? "checked" : ""} />
                <span>${escapeHtml(subtask.title)}</span>
              </label>
            `).join("")}
          </div>
        ` : ""}
        <div class="todo-meta">
          <button type="button" data-project="${escapeHtml(todoCategoryName(todo))}">${escapeHtml(todoCategoryName(todo))}</button>
          <button type="button" data-priority class="priority-${escapeHtml(todo.priority)}">${priorityLabel(todo.priority)}优先级</button>
          <button type="button" data-due-date>${escapeHtml(dueDateText)}</button>
          ${todo.startTime ? `<span>${escapeHtml(todo.startTime)}</span>` : ""}
          ${todo.waitingFor ? `<button type="button" data-waiting-chip>等待 ${escapeHtml(todo.waitingFor)}${todo.waitingUntil ? ` · ${escapeHtml(formatDateLabel(todo.waitingUntil))}` : ""}</button>` : ""}
          ${todo.repeat && todo.repeat !== "none" ? `<span>${repeatLabel(todo.repeat)}</span>` : ""}
          ${repeatProgress ? `<span>${escapeHtml(repeatProgress)}</span>` : ""}
          ${subtasks.length ? `<span>${doneSubtasks}/${subtasks.length} 子任务</span>` : ""}
          ${estimate ? `<span>预计 ${formatMinutes(estimate)}</span>` : ""}
          ${spent ? `<span>已专注 ${formatMinutes(spent)}</span>` : ""}
          ${goalLike ? `<span class="todo-goal-candidate">可能是目标</span>` : ""}
          ${(todo.tags || []).map((tag) => `<button type="button" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join("")}
        </div>
      </div>
      <div class="todo-item-actions">
        ${showTimerAction ? `<button type="button" data-timer aria-label="${activeTimerForTodo ? "查看番茄" : "开始番茄"}：${escapeHtml(todo.title)}">${activeTimerForTodo ? "查看番茄" : "开始番茄"}</button>` : ""}
        ${showConvertGoalAction ? `<button type="button" data-convert-goal aria-label="转换为目标：${escapeHtml(todo.title)}">转换为目标</button>` : ""}
        ${showDuplicateAction ? `<button type="button" data-duplicate aria-label="复制任务：${escapeHtml(todo.title)}">复制</button>` : ""}
        <button type="button" data-edit aria-label="编辑任务：${escapeHtml(todo.title)}">编辑</button>
        <button type="button" data-archive aria-label="归档任务：${escapeHtml(todo.title)}">归档</button>
        <button type="button" class="danger-text" data-delete aria-label="删除任务：${escapeHtml(todo.title)}">删除</button>
      </div>
    </article>
  `;
}

function renderEditor(todo, completedClass, overdueClass) {
  return `
    <article class="todo-item editing${completedClass}${overdueClass}" data-id="${escapeHtml(todo.id)}">
      <form class="todo-edit-form" data-edit-form>
        <div class="todo-edit-fields">
          <label>
            <span>任务</span>
            <input name="title" type="text" maxlength="180" value="${escapeHtml(todo.title)}" />
          </label>
          <label>
            <span>备注</span>
            <textarea name="notes" rows="3" maxlength="4000">${escapeHtml(todo.notes)}</textarea>
          </label>
          <label>
            <span>子任务</span>
            <textarea name="subtasks" rows="4" maxlength="4000">${escapeHtml(subtasksText(todo.subtasks))}</textarea>
          </label>
        </div>
        <div class="todo-edit-side">
          <label>
            <span>分类 / 清单</span>
            <input name="project" type="text" maxlength="48" value="${escapeHtml(todoCategoryName(todo))}" />
          </label>
          <label>
            <span>优先级</span>
            <select name="priority">
              <option value="medium" ${normalizePriority(todo.priority) === "medium" ? "selected" : ""}>中</option>
              <option value="high" ${todo.priority === "high" ? "selected" : ""}>高</option>
              <option value="low" ${todo.priority === "low" ? "selected" : ""}>低</option>
            </select>
          </label>
          <label>
            <span>截止日期</span>
            <input name="dueDate" type="date" value="${escapeHtml(todo.dueDate)}" />
          </label>
          <label>
            <span>开始时间</span>
            <input name="startTime" type="time" value="${escapeHtml(todo.startTime || "")}" />
          </label>
          <label>
            <span>等待对象</span>
            <input name="waitingFor" type="text" maxlength="120" value="${escapeHtml(todo.waitingFor || "")}" />
          </label>
          <label>
            <span>跟进日期</span>
            <input name="waitingUntil" type="date" value="${escapeHtml(todo.waitingUntil || "")}" />
          </label>
          <label>
            <span>重复</span>
            <select name="repeat">
              <option value="none" ${todo.repeat === "none" ? "selected" : ""}>不重复</option>
              <option value="daily" ${todo.repeat === "daily" ? "selected" : ""}>每天</option>
              <option value="weekly" ${todo.repeat === "weekly" ? "selected" : ""}>每周</option>
              <option value="monthly" ${todo.repeat === "monthly" ? "selected" : ""}>每月</option>
            </select>
          </label>
          <label>
            <span>预计耗时</span>
            <input name="estimateMinutes" type="text" maxlength="24" value="${todo.estimateMinutes ? escapeHtml(formatMinutes(todo.estimateMinutes)) : ""}" />
          </label>
          <label>
            <span>标签</span>
            <input name="tags" type="text" maxlength="160" value="${escapeHtml(tagsText(todo.tags))}" />
          </label>
          <div class="todo-edit-actions">
            <button type="submit">保存</button>
            <button type="button" data-cancel>取消</button>
          </div>
        </div>
      </form>
    </article>
  `;
}

function renderNavButton(view, label, count = "") {
  const active = activeView === view;
  return `
    <button type="button" class="todo-nav-item ${active ? "active" : ""}" data-view="${escapeHtml(view)}" aria-current="${active ? "page" : "false"}">
      <span>${escapeHtml(label)}</span>
      ${count !== "" ? `<small>${count}</small>` : ""}
    </button>
  `;
}

function renderCategoryNavButton(row) {
  const active = activeView === "category" && activeCategory === row.name;
  if (editingCategory === row.name) {
    return `
      <form class="todo-category-edit" data-category-edit-form data-category-name="${escapeHtml(row.name)}">
        <span class="todo-category-dot" style="--category-color:${escapeHtml(row.color)}"></span>
        <input name="categoryName" type="text" maxlength="48" value="${escapeHtml(row.name)}" autocomplete="off" />
        <button type="submit">保存</button>
        <button type="button" data-cancel-category-edit>取消</button>
      </form>
    `;
  }
  return `
    <div class="todo-category-nav-row ${active ? "active" : ""}">
      <button type="button" class="todo-nav-item ${active ? "active" : ""}" data-category-nav="${escapeHtml(row.name)}" aria-current="${active ? "page" : "false"}">
        <span class="todo-category-label">
          <i class="todo-category-dot" style="--category-color:${escapeHtml(row.color)}"></i>
          <span>${escapeHtml(row.name)}</span>
        </span>
        <small>${row.count}</small>
      </button>
      ${!row.isDefault ? `
        <div class="todo-category-actions">
          <button type="button" title="编辑分类" aria-label="编辑分类 ${escapeHtml(row.name)}" data-edit-category="${escapeHtml(row.name)}">改</button>
          <button type="button" title="删除分类" aria-label="删除分类 ${escapeHtml(row.name)}" data-delete-category="${escapeHtml(row.name)}">删</button>
        </div>
      ` : ""}
    </div>
  `;
}

function renderCategoryCreator() {
  if (!isCreatingCategory) {
    return `<button type="button" class="todo-nav-add" data-new-category>新建分类</button>`;
  }
  return `
    <form class="todo-category-create" data-category-create-form>
      <input name="categoryName" type="text" maxlength="48" placeholder="分类名称" autocomplete="off" />
      <div>
        <button type="submit">添加</button>
        <button type="button" data-cancel-category>取消</button>
      </div>
    </form>
  `;
}

function renderAppSidebar(currentStats) {
  const categoryRows = navCategoryRows();
  return `
    <aside class="todo-app-sidebar ${sidebarCollapsed ? "collapsed" : ""}" aria-label="任务导航">
      <div class="todo-sidebar-brand">
        <div>
          <span>任务</span>
          <strong>学习计划</strong>
        </div>
        <button type="button" class="todo-sidebar-toggle" data-sidebar-toggle aria-expanded="${sidebarCollapsed ? "false" : "true"}" aria-label="${sidebarCollapsed ? "展开任务导航" : "收起任务导航"}">
          ${sidebarCollapsed ? "展开" : "收起"}
        </button>
      </div>
      <section class="todo-nav-section">
        <h2>核心</h2>
        ${CORE_NAV_ITEMS.map(([view, label]) => {
          const count = view === "today"
            ? currentStats.today
            : view === "inbox"
              ? inboxPageTodos().length
              : "";
          return renderNavButton(view, label, count);
        }).join("")}
      </section>
      <section class="todo-nav-section">
        <h2>分类</h2>
        ${categoryRows.map(renderCategoryNavButton).join("")}
        ${renderCategoryCreator()}
      </section>
      <section class="todo-nav-section">
        <h2>其他</h2>
        ${OTHER_NAV_ITEMS.map(([view, label]) => renderNavButton(view, label, view === "completed" ? currentStats.completed : "")).join("")}
      </section>
    </aside>
  `;
}

function renderPageHeader(title, description, metrics = []) {
  return `
    <header class="todo-page-header">
      <div>
        <p class="todo-kicker">学习型 Todo</p>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<span>${escapeHtml(description)}</span>` : ""}
      </div>
      ${metrics.length ? `
        <div class="todo-page-metrics">
          ${metrics.map(([value, label]) => `<span><strong>${escapeHtml(value)}</strong>${escapeHtml(label)}</span>`).join("")}
        </div>
      ` : ""}
    </header>
  `;
}

function renderTaskList(items, emptyTitle, emptyText) {
  return `
    <section class="todo-list todo-page-list" aria-label="任务列表">
      ${items.length ? items.map(renderTodoItem).join("") : `
        <div class="todo-empty">
          <strong>${escapeHtml(emptyTitle)}</strong>
          ${emptyText ? `<span>${escapeHtml(emptyText)}</span>` : ""}
        </div>
      `}
    </section>
  `;
}

function renderTaskPage(title, description, items, emptyTitle, emptyText, metrics = [], quickAddOptions = {}) {
  return `
    ${renderPageHeader(title, description, metrics)}
    ${renderTaskList(items, emptyTitle, emptyText)}
  `;
}

function renderTodayDateStrip() {
  return `
    <nav class="todo-date-strip" aria-label="日期选择">
      ${todayDateStripDays().map((day) => `
        <button type="button" class="${day.isSelected ? "active" : ""} ${day.isToday ? "today" : ""}" data-today-date="${escapeHtml(day.date)}" aria-current="${day.isSelected ? "date" : "false"}">
          <span>${escapeHtml(day.label)}</span>
          <strong>${escapeHtml(String(Number(day.date.slice(8, 10))))}</strong>
          <small>${escapeHtml(day.weekday)}${day.isToday ? " · 今天" : ""}</small>
          ${day.count ? `<b>${day.count}</b>` : ""}
        </button>
      `).join("")}
    </nav>
  `;
}

function renderTodayOverdueReminder() {
  const overdue = overdueTodos();
  if (!overdue.length) return "";
  return `
    <button type="button" class="todo-overdue-reminder" data-today-overdue>
      <strong>有 ${overdue.length} 个过期任务待重新规划</strong>
      <span>查看最近任务</span>
    </button>
  `;
}

function renderTodayGroup(key, title, range, items) {
  return `
    <section class="todo-today-group">
      <header>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(range)}</span>
        </div>
        <small>${items.length}</small>
      </header>
      <div class="todo-today-group-list">
        ${items.length ? items.map(renderTodoItem).join("") : `<div class="todo-today-empty">暂无任务</div>`}
      </div>
    </section>
  `;
}

function renderTodayGroups(items) {
  const groups = groupTodayTodos(items);
  const sections = [
    ["morning", "上午", "00:00 - 11:59"],
    ["afternoon", "下午", "12:00 - 17:59"],
    ["evening", "晚上", "18:00 - 23:59"],
    ["unscheduled", "未安排", "有截止日期，但没有开始时间"]
  ];
  return `
    <div class="todo-today-groups">
      ${sections.map(([key, title, range]) => renderTodayGroup(key, title, range, groups[key] || [])).join("")}
    </div>
  `;
}

function renderTodayEmpty() {
  return `
    <section class="todo-empty todo-today-empty-state">
      <strong>这一天还没有任务，添加一个重点任务吧。</strong>
      <button type="button" data-today-add-task>添加任务</button>
    </section>
  `;
}

function renderTodayCompletedGroup(items) {
  return `
    <section class="todo-completed-group ${todayCompletedExpanded ? "expanded" : ""}">
      <button type="button" data-toggle-today-completed aria-expanded="${todayCompletedExpanded ? "true" : "false"}">
        <span>已完成</span>
        <strong>${items.length}</strong>
      </button>
      ${todayCompletedExpanded ? `
        <div class="todo-completed-list">
          ${items.length ? items.map(renderTodoItem).join("") : `<div class="todo-today-empty">暂无已完成任务</div>`}
        </div>
      ` : ""}
    </section>
  `;
}

function TodayPage(currentStats) {
  const dateKey = selectedDateKey();
  const activeItems = todayActiveTodos(dateKey);
  const completedItems = todayCompletedTodos(dateKey);
  const selectedLabel = selectedDateTitle(dateKey);
  return `
    ${renderPageHeader(
      "今日",
      `${selectedLabel}任务台：安排任务、开始番茄专注、收拢已完成任务。`,
      [
        [String(activeItems.length), "待处理"],
        [String(completedItems.length), "已完成"],
        [formatMinutes(currentStats.todayFocus), "今日专注"]
      ]
    )} 
    ${renderTodayDateStrip()}
    ${renderTodayOverdueReminder()}
    ${activeItems.length ? renderTodayGroups(activeItems) : renderTodayEmpty()}
    ${renderTodayCompletedGroup(completedItems)}
  `;
}

function InboxPage() {
  const items = inboxPageTodos();
  return renderTaskPage(
    "收集箱",
    "先把想到的任务收进来，之后再分配分类、日期和目标。",
    items,
    "收集箱是空的，先添加一个任务吧。",
    ""
  );
}

function isRecentGroupCollapsed(key) {
  return recentCollapsedGroups.has(key);
}

function renderRecentTodoItem(todo, flags = []) {
  return `
    <div class="todo-recent-item">
      ${flags.length ? `
        <div class="todo-recent-flags">
          ${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}
        </div>
      ` : ""}
      ${renderTodoItem(todo)}
    </div>
  `;
}

function renderRecentTaskList(items, emptyText, flagFactory = () => []) {
  return `
    <div class="todo-recent-list">
      ${items.length
        ? items.map((todo) => renderRecentTodoItem(todo, flagFactory(todo))).join("")
        : `<div class="todo-recent-empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `;
}

function renderRecentGroup(group) {
  const collapsed = isRecentGroupCollapsed(group.key);
  return `
    <section class="todo-recent-group">
      <button type="button" class="todo-recent-group-toggle" data-recent-toggle="${escapeHtml(group.key)}" aria-expanded="${collapsed ? "false" : "true"}">
        <span>
          <strong>${escapeHtml(group.title)}</strong>
          ${group.description ? `<small>${escapeHtml(group.description)}</small>` : ""}
        </span>
        <b>${group.items.length}</b>
      </button>
      ${collapsed ? "" : renderRecentTaskList(group.items, group.emptyText, group.flagFactory)}
    </section>
  `;
}

function renderRecentSection(section) {
  const collapsed = isRecentGroupCollapsed(section.key);
  return `
    <section class="todo-recent-section">
      <header>
        <button type="button" class="todo-recent-section-toggle" data-recent-toggle="${escapeHtml(section.key)}" aria-expanded="${collapsed ? "false" : "true"}">
          <span>
            <strong>${escapeHtml(section.title)}</strong>
            <small>${escapeHtml(section.description)}</small>
          </span>
          <b>${section.count}</b>
        </button>
        ${section.actions ? `<div class="todo-recent-section-actions">${section.actions}</div>` : ""}
      </header>
      ${collapsed ? "" : `<div class="todo-recent-section-body">${section.groups.map(renderRecentGroup).join("")}</div>`}
    </section>
  `;
}

function recentOverdueGroupRows(snapshot) {
  return [
    {
      key: "recent:overdue:yesterday",
      title: "昨天",
      description: "昨天到期但还没完成",
      items: snapshot.overdueGroups.yesterday,
      emptyText: "昨天没有遗漏任务。"
    },
    {
      key: "recent:overdue:recent7",
      title: "最近 7 天",
      description: "一周内滑过去的任务",
      items: snapshot.overdueGroups.recent7,
      emptyText: "最近 7 天没有积压任务。"
    },
    {
      key: "recent:overdue:within30",
      title: "30 天内",
      description: "需要重新判断是否还有效",
      items: snapshot.overdueGroups.within30,
      emptyText: "30 天内没有更早的过期任务。"
    },
    {
      key: "recent:overdue:earlier",
      title: "更早",
      description: "建议归档或重新规划",
      items: snapshot.overdueGroups.earlier,
      emptyText: "没有更早的积压任务。"
    }
  ];
}

function recentUndatedGroupRows(snapshot) {
  return [
    {
      key: "recent:undated:uncategorized",
      title: "未分类任务",
      description: "先补分类或直接安排日期",
      items: snapshot.undatedGroups.uncategorized,
      emptyText: "没有未分类的无日期任务。"
    },
    {
      key: "recent:undated:categorized",
      title: "有分类但未安排日期",
      description: "已经知道方向，只差时间",
      items: snapshot.undatedGroups.categorized,
      emptyText: "所有已分类任务都有日期。"
    },
    {
      key: "recent:undated:possibleGoal",
      title: "疑似长期目标",
      description: "包含目标类关键词，后续可转成 Goal",
      items: snapshot.undatedGroups.possibleGoal,
      emptyText: "没有发现疑似长期目标。",
      flagFactory: () => ["可能是目标"]
    }
  ];
}

function recentUpcomingGroupRows(snapshot) {
  return [
    {
      key: "recent:upcoming:today",
      title: "今天",
      description: "今天必须处理的任务",
      items: snapshot.upcomingGroups.today,
      emptyText: "今天没有即将到期任务。"
    },
    {
      key: "recent:upcoming:tomorrow",
      title: "明天",
      description: "提前一天做准备",
      items: snapshot.upcomingGroups.tomorrow,
      emptyText: "明天没有即将到期任务。"
    },
    {
      key: "recent:upcoming:thisWeek",
      title: "本周",
      description: "未来 7 天内需要留意",
      items: snapshot.upcomingGroups.thisWeek,
      emptyText: "本周剩余时间没有到期任务。"
    }
  ];
}

function renderRecentSections(snapshot) {
  const overdueActions = `
    <button type="button" data-recent-reschedule-overdue ${snapshot.overdue.length ? "" : "disabled"}>顺延到今天</button>
    <button type="button" class="danger-text" data-recent-archive-overdue ${snapshot.overdue.length ? "" : "disabled"}>归档过期任务</button>
  `;
  const undatedActions = `
    <button type="button" data-recent-schedule-undated ${snapshot.undated.length ? "" : "disabled"}>安排到本周</button>
  `;
  return `
    <div class="todo-recent-page">
      ${renderRecentSection({
        key: "recent:section:overdue",
        title: "过期任务",
        description: "把已经滑过去的任务重新安排。",
        count: snapshot.overdue.length,
        actions: overdueActions,
        groups: recentOverdueGroupRows(snapshot)
      })}
      ${renderRecentSection({
        key: "recent:section:undated",
        title: "无日期任务",
        description: "给悬空任务补上下一步时间。",
        count: snapshot.undated.length,
        actions: undatedActions,
        groups: recentUndatedGroupRows(snapshot)
      })}
      ${renderRecentSection({
        key: "recent:section:upcoming",
        title: "即将到期",
        description: "提前查看未来 7 天要收口的任务。",
        count: snapshot.upcoming.length,
        groups: recentUpcomingGroupRows(snapshot)
      })}
    </div>
  `;
}

function RecentRescuePage() {
  const snapshot = recentRescueSnapshot();
  return `
    ${renderPageHeader(
      "最近",
      "任务补救中心：处理过期、悬空和未来 7 天内要收口的任务。",
      [
        [String(snapshot.overdue.length), "过期"],
        [String(snapshot.undated.length), "无日期"],
        [String(snapshot.upcoming.length), "7 天内"]
      ]
    )}
    ${renderRecentSections(snapshot)}
  `;
}

function RecentPage() {
  const items = recentPageTodos();
  return renderTaskPage(
    "最近",
    "按最近更新查看任务，方便继续刚才的学习安排。",
    items,
    "暂无最近任务",
    "创建或编辑任务后，这里会显示最近动态。"
  );
}

function renderCategoryCompletedGroup(items) {
  return `
    <section class="todo-completed-group todo-category-completed ${categoryCompletedExpanded ? "expanded" : ""}">
      <button type="button" data-toggle-category-completed aria-expanded="${categoryCompletedExpanded ? "true" : "false"}">
        <span>已完成</span>
        <strong>${items.length}</strong>
      </button>
      ${categoryCompletedExpanded ? `
        <div class="todo-completed-list">
          ${items.length ? items.map(renderTodoItem).join("") : `<div class="todo-today-empty">暂无已完成任务</div>`}
        </div>
      ` : ""}
    </section>
  `;
}

function CategoryPage() {
  const category = activeCategory || "未分类";
  const activeItems = categoryPageTodos(category);
  const completedItems = categoryCompletedTodos(category);
  return `
    ${renderPageHeader(
      `分类：${category}`,
      "按学科或项目集中管理任务，新任务会默认归入当前分类。",
      [
        [String(activeItems.length), "未完成"],
        [String(completedItems.length), "已完成"]
      ]
    )} 
    ${activeItems.length ? renderTaskList(activeItems, "这个分类暂无任务", "") : `
      <section class="todo-empty todo-category-empty">
        <strong>这个分类暂无任务</strong>
        <span>从顶部快速添加任务，会自动归入当前分类。</span>
      </section>
    `}
    ${renderCategoryCompletedGroup(completedItems)}
  `;
}

function renderCompletedLifecycleItem(todo) {
  return `
    <article class="todo-lifecycle-item completed" data-completed-id="${escapeHtml(todo.id)}">
      <div>
        <strong>${escapeHtml(todo.title)}</strong>
        ${todo.notes ? `<p>${escapeHtml(todo.notes)}</p>` : ""}
        <div class="todo-lifecycle-meta">
          <span>${escapeHtml(todoCategoryName(todo) || "未分类")}</span>
          <span>完成 ${escapeHtml(completedAtText(todo))}</span>
          <span>原截止 ${escapeHtml(formatDateLabel(todo.dueDate))}</span>
          ${todo.goalId ? `<span>目标 ${escapeHtml(goalNameFromId(todo.goalId) || todo.goalId)}</span>` : ""}
        </div>
      </div>
      <div class="todo-lifecycle-actions">
        <button type="button" data-completed-undo>撤销完成</button>
        <button type="button" data-completed-archive>归档</button>
      </div>
    </article>
  `;
}

function renderArchivedLifecycleItem(todo) {
  return `
    <article class="todo-lifecycle-item archived" data-archived-id="${escapeHtml(todo.id)}">
      <div>
        <strong>${escapeHtml(todo.title)}</strong>
        ${todo.notes ? `<p>${escapeHtml(todo.notes)}</p>` : ""}
        <div class="todo-lifecycle-meta">
          <span>${escapeHtml(todoCategoryName(todo) || "未分类")}</span>
          <span>归档 ${escapeHtml(archivedAtText(todo))}</span>
          ${todo.dueDate ? `<span>原截止 ${escapeHtml(formatDateLabel(todo.dueDate))}</span>` : ""}
          ${todo.goalId ? `<span>目标 ${escapeHtml(goalNameFromId(todo.goalId) || todo.goalId)}</span>` : ""}
        </div>
      </div>
      <div class="todo-lifecycle-actions">
        <button type="button" data-archived-restore>恢复任务</button>
        <button type="button" class="danger-text" data-archived-delete>彻底删除</button>
      </div>
    </article>
  `;
}

function renderCompletedGroup(group) {
  return `
    <section class="todo-lifecycle-group">
      <header>
        <strong>${escapeHtml(group.title)}</strong>
        <span>${group.items.length}</span>
      </header>
      <div class="todo-lifecycle-list">
        ${group.items.map(renderCompletedLifecycleItem).join("")}
      </div>
    </section>
  `;
}

function CompletedPage(currentStats) {
  const items = completedPageTodos();
  const groups = completedDateGroups(items);
  return `
    ${renderPageHeader(
      "已完成",
      "查看已经完成的任务，必要时撤销完成或归档沉淀。",
      [[String(items.length || currentStats.completed), "已完成"]]
    )}
    <section class="todo-lifecycle-panel" aria-label="已完成任务">
      <div class="todo-lifecycle-toolbar">
        <div>
          <strong>完成记录</strong>
          <span>按完成时间倒序，并按日期分组。</span>
        </div>
        <button type="button" data-archive-all-completed ${items.length ? "" : "disabled"}>归档已完成</button>
      </div>
      ${groups.length ? groups.map(renderCompletedGroup).join("") : `
        <div class="todo-empty todo-lifecycle-empty">
          <strong>还没有完成任务，先完成一个小任务吧。</strong>
        </div>
      `}
    </section>
  `;
}

function TrashPage() {
  const items = archivedPageTodos();
  return `
    ${renderPageHeader(
      "回收站",
      "归档任务会先放在这里；恢复很轻松，彻底删除需要确认。",
      [[String(items.length), "归档"]]
    )}
    <section class="todo-lifecycle-panel archived" aria-label="回收站">
      ${items.length ? `
        <div class="todo-lifecycle-list">
          ${items.map(renderArchivedLifecycleItem).join("")}
        </div>
      ` : `
        <div class="todo-empty todo-lifecycle-empty">
          <strong>回收站是空的。</strong>
        </div>
      `}
    </section>
  `;
}

function renderPanelPage(title, description, body, metrics = [], quickAddOptions = {}) {
  return `
    ${renderPageHeader(title, description, metrics)}
    ${body}
  `;
}

function renderCalendarMonthToolbar(monthKey, selectedKey) {
  return `
    <header class="todo-calendar-header todo-calendar-month-header">
      <div>
        <p class="todo-kicker">月历</p>
        <h2>${escapeHtml(calendarMonthTitle(monthKey))}</h2>
        <span>${escapeHtml(calendarDateTitle(selectedKey))}</span>
      </div>
      <div class="todo-calendar-controls">
        <button type="button" data-calendar-prev>上个月</button>
        <button type="button" data-calendar-today>今天</button>
        <button type="button" data-calendar-next>下个月</button>
      </div>
    </header>
  `;
}

function renderCalendarSummaryTask(todo) {
  const classes = [
    "todo-calendar-summary-task",
    todo.completed ? "completed" : "",
    normalizePriority(todo.priority) === "high" ? "high" : ""
  ].filter(Boolean).join(" ");
  return `
    <span class="${classes}">
      <i class="todo-category-dot" style="--category-color:${escapeHtml(categoryColor(todoCategoryName(todo)))}"></i>
      ${normalizePriority(todo.priority) === "high" ? "<b>高</b>" : ""}
      ${escapeHtml(todo.title)}
    </span>
  `;
}

function renderCalendarDayCell(dateKey, monthKey, selectedKey) {
  const summaries = calendarDaySummaries(dateKey);
  const dayNumber = Number(dateKey.slice(8, 10));
  const isCurrentMonth = monthKeyForDate(dateKey) === monthKey;
  const isToday = dateKey === localDateKey();
  const isSelected = dateKey === selectedKey;
  const classes = [
    "todo-calendar-day",
    isCurrentMonth ? "" : "outside-month",
    isToday ? "today" : "",
    isSelected ? "selected" : "",
    summaries.tasks.length ? "has-tasks" : ""
  ].filter(Boolean).join(" ");
  return `
    <button type="button" class="${classes}" data-calendar-day="${escapeHtml(dateKey)}" aria-pressed="${isSelected ? "true" : "false"}">
      <span class="todo-calendar-day-head">
        <strong>${Number.isFinite(dayNumber) ? dayNumber : ""}</strong>
        ${isToday ? "<span>今天</span>" : isSelected ? "<span>选中</span>" : summaries.tasks.length ? `<span>${summaries.tasks.length}</span>` : ""}
      </span>
      <span class="todo-calendar-day-body">
        ${summaries.visible.map(renderCalendarSummaryTask).join("")}
        ${summaries.extraCount ? `<span class="todo-calendar-more-count">+${summaries.extraCount}</span>` : ""}
      </span>
    </button>
  `;
}

function renderCalendarMonthGrid(monthKey, selectedKey) {
  const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return `
    <section class="todo-calendar-month" aria-label="月历日期">
      <div class="todo-calendar-weekdays">
        ${weekdays.map((day) => `<span>${escapeHtml(day)}</span>`).join("")}
      </div>
      <div class="todo-calendar-grid todo-calendar-month-grid">
        ${calendarMonthDays(monthKey).map((day) => renderCalendarDayCell(day, monthKey, selectedKey)).join("")}
      </div>
    </section>
  `;
}

function renderCalendarTaskPanelList(items, emptyText) {
  return `
    <div class="todo-calendar-panel-list">
      ${items.length ? items.map(renderTodoItem).join("") : `<div class="todo-calendar-panel-empty">${escapeHtml(emptyText)}</div>`}
    </div>
  `;
}

function renderCalendarCompletedGroup(items) {
  return `
    <section class="todo-completed-group todo-calendar-completed ${calendarCompletedExpanded ? "expanded" : ""}">
      <button type="button" data-toggle-calendar-completed aria-expanded="${calendarCompletedExpanded ? "true" : "false"}">
        <span>已完成</span>
        <strong>${items.length}</strong>
      </button>
      ${calendarCompletedExpanded ? renderCalendarTaskPanelList(items, "暂无已完成任务") : ""}
    </section>
  `;
}

function renderCalendarUndatedPanel(selectedKey) {
  const items = calendarUndatedTodos().slice(0, 8);
  return `
    <section class="todo-calendar-undated">
      <header>
        <strong>无日期任务</strong>
        <span>${calendarUndatedTodos().length}</span>
      </header>
      <div>
        ${items.length ? items.map((todo) => `
          <article>
            <span>${escapeHtml(todo.title)}</span>
            <small>${escapeHtml(todoCategoryName(todo))} · ${priorityLabel(todo.priority)}</small>
            <button type="button" data-calendar-set-date="${escapeHtml(todo.id)}">设置到选中日期</button>
          </article>
        `).join("") : `<div class="todo-calendar-panel-empty">没有无日期任务。</div>`}
      </div>
    </section>
  `;
}

function renderCalendarSelectedPanel(selectedKey) {
  const activeItems = calendarActiveTasks(selectedKey);
  const completedItems = calendarCompletedTasks(selectedKey);
  const hasTasks = activeItems.length || completedItems.length;
  return `
    <aside class="todo-calendar-selected-panel" aria-label="所选日期任务">
      <header>
        <p class="todo-kicker">所选日期</p>
        <h2>${escapeHtml(calendarDateTitle(selectedKey))}</h2>
      </header>
      <button type="button" class="todo-calendar-add-button" data-calendar-add-task>添加当天任务</button>
      ${hasTasks ? `
        <section>
          <h3>未完成任务</h3>
          ${renderCalendarTaskPanelList(activeItems, "没有未完成任务。")}
        </section>
        ${renderCalendarCompletedGroup(completedItems)}
      ` : `<div class="todo-calendar-panel-empty prominent">这一天还没有任务。</div>`}
      ${renderCalendarUndatedPanel(selectedKey)}
    </aside>
  `;
}

function renderMonthCalendarPanel() {
  const selectedKey = calendarSelectedDateKey();
  const monthKey = calendarMonthKey();
  return `
    <section class="todo-calendar-panel todo-calendar-month-panel" aria-label="月历">
      ${renderCalendarMonthToolbar(monthKey, selectedKey)}
      <div class="todo-calendar-layout">
        ${renderCalendarMonthGrid(monthKey, selectedKey)}
        ${renderCalendarSelectedPanel(selectedKey)}
      </div>
    </section>
  `;
}

function CalendarPage(selectedDate = "") {
  const selectedKey = calendarSelectedDateKey();
  const monthKey = calendarMonthKey();
  const activeItems = calendarActiveTasks(selectedKey);
  const completedItems = calendarCompletedTasks(selectedKey);
  const monthTaskCount = calendarMonthDays(monthKey)
    .filter((day, index, days) => monthKeyForDate(day) === monthKey && days.indexOf(day) === index)
    .reduce((sum, day) => sum + calendarDayTasks(day).length, 0);
  return `
    ${renderPageHeader(
      "日历",
      "按月份查看任务，并把任务安排到具体日期。",
      [
        [calendarMonthTitle(monthKey), "当前月份"],
        [String(activeItems.length), "选中日待办"],
        [String(monthTaskCount), "本月任务"]
      ]
    )}
    ${renderMonthCalendarPanel()}
  `;
}

function GoalsPage() {
  return renderPanelPage("目标", "沉淀长期学习目标和阶段性进度。", renderGoalsPanel());
}

function ReviewPage() {
  return renderPanelPage("复盘", "查看昨日小结、最近 7 天统计和本周周报。", renderReviewPanel());
}

function renderMainPage(currentStats) {
  if (activeView === "today") return TodayPage(currentStats);
  if (activeView === "inbox") return InboxPage();
  if (activeView === "calendar") return CalendarPage();
  if (activeView === "recent") return RecentRescuePage();
  if (activeView === "goals") return GoalsPage();
  if (activeView === "review") return ReviewPage();
  if (activeView === "category") return CategoryPage();
  if (activeView === "completed") return CompletedPage(currentStats);
  if (activeView === "trash") return TrashPage();
  if (activeView === "focus") return renderPanelPage("番茄专注", "选择任务开始专注，并查看最近的番茄记录。", renderFocusPanel());
  if (activeView === "plan") return renderPanelPage("计划", "按日期和优先级规划任务。", renderPlanPanel());
  if (activeView === "projects") return renderPanelPage("分类", "查看分类概览。", renderProjectsPanel());
  return TodayPage(currentStats);
}

function renderFocusPlayer() {
  const timer = activeFocusTimer();
  const task = focusTimerTask(timer);
  const timerInfo = focusTimerInfo(timer);
  const title = task && task.title ? task.title : timer && timer.title ? timer.title : "";
  const statusLabel = timer && timer.status === "paused" ? "已暂停" : timer && timer.status === "running" ? "正在专注" : "待开始";
  const actions = timer && timer.status === "running" ? `
    <button type="button" data-focus-pause>暂停</button>
    <button type="button" data-focus-complete>完成</button>
    <button type="button" class="danger-text" data-focus-abandon>放弃</button>
  ` : timer && timer.status === "paused" ? `
    <button type="button" data-focus-resume>继续</button>
    <button type="button" class="danger-text" data-focus-abandon>放弃</button>
  ` : `
    <button type="button" data-focus-open>番茄专注</button>
  `;
  return `
    <footer class="todo-focus-player" aria-label="番茄专注播放器">
      <div class="todo-focus-player-meta">
        <strong>${title ? escapeHtml(title) : "选择一个任务开始专注"}</strong>
        <span>${statusLabel}</span>
      </div>
      <b>${timer && timerInfo ? formatClock(timerInfo.remainingSeconds) : "50:00"}</b>
      <div class="todo-focus-player-actions">
        ${actions}
      </div>
    </footer>
  `;
}

function render() {
  const currentStats = stats();
  app.innerHTML = `
    ${renderAppSidebar(currentStats)}
    <main class="todo-main-shell">
      ${todoError ? `<div class="todo-error" role="alert">${escapeHtml(todoError)}</div>` : ""}
      ${!todoError && todoNotice ? `<div class="todo-notice" role="status">${escapeHtml(todoNotice)}</div>` : ""}
      ${renderTopQuickCreate()}
      ${renderMainPage(currentStats)}
    </main>
    ${renderFocusPlayer()}
    ${renderGoalConversionModal()}
  `;
  bindEvents();
}

function bindEvents() {
  app.querySelectorAll("[data-create-form]").forEach((createForm) => {
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await createTodo(createForm);
    });
    const refreshQuickPreview = () => updateQuickCreatePreview(createForm);
    ["title", "project", "priority", "dueDate", "waitingFor", "waitingUntil", "repeat", "estimateMinutes", "tags"].forEach((name) => {
      const field = createForm.elements[name];
      if (field) {
        field.addEventListener("input", refreshQuickPreview);
        field.addEventListener("change", refreshQuickPreview);
      }
    });
    refreshQuickPreview();
  });

  const goalConvertForm = app.querySelector("[data-goal-convert-form]");
  if (goalConvertForm) {
    goalConvertForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const todo = todos.find((item) => item.id === goalConvertForm.dataset.todoId);
      await convertTodoToGoal(goalConvertForm, todo);
    });
    goalConvertForm.querySelectorAll("[data-goal-convert-cancel]").forEach((button) => {
      button.addEventListener("click", () => {
        convertingGoalTodoId = "";
        render();
      });
    });
  }

  app.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.view || "today";
      if (activeView !== "category") projectFilter = "";
      editingId = null;
      convertingGoalTodoId = "";
      if (window.innerWidth <= 900) sidebarCollapsed = true;
      render();
    });
  });

  const sidebarToggle = app.querySelector("[data-sidebar-toggle]");
  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      sidebarCollapsed = !sidebarCollapsed;
      render();
    });
  }

  app.querySelectorAll("[data-today-date]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDate = button.dataset.todayDate || localDateKey();
      todayCompletedExpanded = false;
      activeView = "today";
      editingId = null;
      render();
    });
  });

  const overdueReminder = app.querySelector("[data-today-overdue]");
  if (overdueReminder) {
    overdueReminder.addEventListener("click", () => {
      activeView = "recent";
      editingId = null;
      render();
    });
  }

  const todayAddTask = app.querySelector("[data-today-add-task]");
  if (todayAddTask) {
    todayAddTask.addEventListener("click", focusCreateTodo);
  }

  const todayCompletedToggle = app.querySelector("[data-toggle-today-completed]");
  if (todayCompletedToggle) {
    todayCompletedToggle.addEventListener("click", () => {
      todayCompletedExpanded = !todayCompletedExpanded;
      render();
    });
  }

  const calendarPrev = app.querySelector("[data-calendar-prev]");
  if (calendarPrev) {
    calendarPrev.addEventListener("click", () => {
      calendarMonth = shiftMonthKey(calendarMonthKey(), -1);
      if (monthKeyForDate(calendarSelectedDateKey()) !== calendarMonth) selectedDate = `${calendarMonth}-01`;
      calendarCompletedExpanded = false;
      editingId = null;
      render();
    });
  }

  const calendarNext = app.querySelector("[data-calendar-next]");
  if (calendarNext) {
    calendarNext.addEventListener("click", () => {
      calendarMonth = shiftMonthKey(calendarMonthKey(), 1);
      if (monthKeyForDate(calendarSelectedDateKey()) !== calendarMonth) selectedDate = `${calendarMonth}-01`;
      calendarCompletedExpanded = false;
      editingId = null;
      render();
    });
  }

  const calendarToday = app.querySelector("[data-calendar-today]");
  if (calendarToday) {
    calendarToday.addEventListener("click", () => {
      selectedDate = localDateKey();
      calendarMonth = monthKeyForDate(selectedDate);
      calendarCompletedExpanded = false;
      editingId = null;
      render();
    });
  }

  app.querySelectorAll("[data-calendar-day]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDate = button.dataset.calendarDay || localDateKey();
      calendarMonth = monthKeyForDate(selectedDate);
      calendarCompletedExpanded = false;
      editingId = null;
      render();
    });
  });

  const calendarAddTask = app.querySelector("[data-calendar-add-task]");
  if (calendarAddTask) {
    calendarAddTask.addEventListener("click", focusCreateTodo);
  }

  const calendarCompletedToggle = app.querySelector("[data-toggle-calendar-completed]");
  if (calendarCompletedToggle) {
    calendarCompletedToggle.addEventListener("click", () => {
      calendarCompletedExpanded = !calendarCompletedExpanded;
      render();
    });
  }

  app.querySelectorAll("[data-calendar-set-date]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.calendarSetDate || "";
      if (!id) return;
      await updateTodoAction(id, { dueDate: calendarSelectedDateKey() }, "设置日期失败");
    });
  });

  app.querySelectorAll("[data-recent-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.recentToggle || "";
      if (!key) return;
      if (recentCollapsedGroups.has(key)) recentCollapsedGroups.delete(key);
      else recentCollapsedGroups.add(key);
      render();
    });
  });

  const rescheduleOverdue = app.querySelector("[data-recent-reschedule-overdue]");
  if (rescheduleOverdue) {
    rescheduleOverdue.addEventListener("click", async () => {
      await rescheduleRecentOverdueAction();
    });
  }

  const scheduleUndated = app.querySelector("[data-recent-schedule-undated]");
  if (scheduleUndated) {
    scheduleUndated.addEventListener("click", async () => {
      await scheduleRecentUndatedAction();
    });
  }

  const archiveOverdue = app.querySelector("[data-recent-archive-overdue]");
  if (archiveOverdue) {
    archiveOverdue.addEventListener("click", async () => {
      await archiveRecentOverdueAction();
    });
  }

  app.querySelectorAll("[data-category-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.categoryNav || "未分类";
      activeView = "category";
      projectFilter = activeCategory === "未分类" ? "" : activeCategory;
      editingId = null;
      editingCategory = "";
      categoryCompletedExpanded = false;
      if (window.innerWidth <= 900) sidebarCollapsed = true;
      render();
    });
  });

  app.querySelectorAll("[data-edit-category]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      editingCategory = button.dataset.editCategory || "";
      isCreatingCategory = false;
      render();
      window.requestAnimationFrame(() => {
        const input = app.querySelector('[data-category-edit-form] input[name="categoryName"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
    });
  });

  app.querySelectorAll("[data-delete-category]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const target = button.dataset.deleteCategory || "";
      const deleted = await deleteCategoryAction(target);
      if (deleted && activeView === "category" && activeCategory === target) {
        activeCategory = "未分类";
        projectFilter = "";
        render();
      }
    });
  });

  const newCategoryButton = app.querySelector("[data-new-category]");
  if (newCategoryButton) {
    newCategoryButton.addEventListener("click", () => {
      isCreatingCategory = true;
      editingCategory = "";
      render();
      window.requestAnimationFrame(() => {
        const input = app.querySelector('[name="categoryName"]');
        if (input) input.focus();
      });
    });
  }

  const cancelCategoryButton = app.querySelector("[data-cancel-category]");
  if (cancelCategoryButton) {
    cancelCategoryButton.addEventListener("click", () => {
      isCreatingCategory = false;
      render();
    });
  }

  const cancelCategoryEdit = app.querySelector("[data-cancel-category-edit]");
  if (cancelCategoryEdit) {
    cancelCategoryEdit.addEventListener("click", () => {
      editingCategory = "";
      render();
    });
  }

  const categoryCreateForm = app.querySelector("[data-category-create-form]");
  if (categoryCreateForm) {
    categoryCreateForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const categoryName = normalizeCategoryId(categoryCreateForm.elements.categoryName.value);
      if (!categoryName) return;
      await saveCategoryAction(categoryName);
      activeCategory = categoryName;
      activeView = "category";
      projectFilter = categoryName === "未分类" ? "" : categoryName;
      isCreatingCategory = false;
      render();
    });
  }

  const categoryEditForm = app.querySelector("[data-category-edit-form]");
  if (categoryEditForm) {
    categoryEditForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const oldName = categoryEditForm.dataset.categoryName || editingCategory;
      const newName = normalizeCategoryId(categoryEditForm.elements.categoryName.value);
      if (!oldName || !newName) return;
      await renameCategoryAction(oldName, newName);
      if (activeCategory === oldName) {
        activeCategory = newName;
        projectFilter = newName === "未分类" ? "" : newName;
      }
      editingCategory = "";
      render();
    });
  }

  const categoryCompletedToggle = app.querySelector("[data-toggle-category-completed]");
  if (categoryCompletedToggle) {
    categoryCompletedToggle.addEventListener("click", () => {
      categoryCompletedExpanded = !categoryCompletedExpanded;
      render();
    });
  }

  app.querySelectorAll("[data-review-type]").forEach((button) => {
    button.addEventListener("click", () => {
      reviewType = button.dataset.reviewType || "daily";
      render();
    });
  });

  const reviewForm = app.querySelector("[data-review-form]");
  if (reviewForm) {
    reviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveReview(reviewForm);
    });
    const nextActions = reviewForm.elements.nextActions;
    const createActions = reviewForm.querySelector("[data-review-create-actions]");
    if (nextActions && createActions) {
      const syncReviewActionButton = () => {
        createActions.disabled = !reviewActionLines(nextActions.value).length;
      };
      nextActions.addEventListener("input", syncReviewActionButton);
      syncReviewActionButton();
      createActions.addEventListener("click", async () => {
        await createReviewActionTodos(reviewForm);
      });
    }
  }

  const focusForm = app.querySelector("[data-focus-form]");
  if (focusForm) {
    focusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await startFocusFromForm(focusForm);
    });
    const focusDefault = focusForm.querySelector("[data-focus-default]");
    if (focusDefault) {
      focusDefault.addEventListener("click", async () => {
        focusDefault.disabled = true;
        await saveFocusDefaultFromForm(focusForm);
      });
    }
  }

  app.querySelectorAll("[data-focus-open], [data-focus-placeholder]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = "focus";
      render();
    });
  });

  [
    ["[data-focus-pause]", () => window.deskchat.pauseTodoTimer(), "暂停番茄专注失败"],
    ["[data-focus-resume]", () => window.deskchat.resumeTodoTimer(), "继续番茄专注失败"],
    ["[data-focus-complete]", () => window.deskchat.completeTodoTimer(), "完成番茄专注失败"],
    ["[data-focus-abandon]", () => window.deskchat.abandonTodoTimer(), "放弃番茄专注失败"]
  ].forEach(([selector, action, fallback]) => {
    app.querySelectorAll(selector).forEach((button) => {
      button.addEventListener("click", async () => {
        app.querySelectorAll(selector).forEach((peer) => {
          peer.disabled = true;
        });
        await runTodoAction(async () => {
          applyStore(await action());
        }, fallback);
      });
    });
  });

  const clearPlanProject = app.querySelector("[data-plan-clear-project]");
  if (clearPlanProject) {
    clearPlanProject.addEventListener("click", () => {
      projectFilter = "";
      render();
    });
  }

  const triageList = app.querySelector("[data-triage-list]");
  if (triageList) {
    triageList.addEventListener("click", () => {
      activeView = "inbox";
      render();
    });
  }

  const executeActions = app.querySelector("[data-execute-id]");
  if (executeActions) {
    const id = executeActions.dataset.executeId;
    const focus = executeActions.querySelector("[data-execute-focus]");
    if (focus) {
      focus.addEventListener("click", async () => {
        const running = runningTodo();
        if (running && running.id === id) {
          activeView = "focus";
          render();
          return;
        }
        focus.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "开始专注失败");
        activeView = "focus";
        render();
      });
    }

    const complete = executeActions.querySelector("[data-execute-complete]");
    if (complete) {
      complete.addEventListener("click", async () => {
        complete.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.toggleTodo(id, true));
        }, "完成任务失败");
      });
    }

    const more = executeActions.querySelector("[data-execute-more]");
    if (more) {
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(more, [
          {
            label: "推到明天",
            action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 1) }, "推到明天失败")
          },
          {
            label: "编辑",
            action: () => openTodoEditor(id)
          }
        ]);
      });
    }
  }

  const executePlan = app.querySelector("[data-execute-plan]");
  if (executePlan) {
    executePlan.addEventListener("click", () => {
      activeView = "plan";
      render();
    });
  }

  const executeTemplate = app.querySelector("[data-execute-template]");
  if (executeTemplate) {
    executeTemplate.addEventListener("click", () => {
      activeView = "templates";
      render();
    });
  }

  const clearExecuteProject = app.querySelector("[data-execute-clear-project]");
  if (clearExecuteProject) {
    clearExecuteProject.addEventListener("click", () => {
      projectFilter = "";
      render();
    });
  }

  app.querySelectorAll("[data-execute-queue-id]").forEach((item) => {
    const id = item.dataset.executeQueueId;
    const focus = item.querySelector("[data-execute-queue-focus]");
    if (focus) {
      focus.addEventListener("click", async () => {
        focus.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "开始专注失败");
        activeView = "focus";
        render();
      });
    }
  });

  app.querySelectorAll("[data-calendar-id]").forEach((card) => {
    const id = card.dataset.calendarId;
    const focus = card.querySelector("[data-calendar-focus]");
    if (focus) {
      focus.addEventListener("click", async () => {
        focus.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "开始专注失败");
        activeView = "focus";
        render();
      });
    }

    const complete = card.querySelector("[data-calendar-complete]");
    if (complete) {
      complete.addEventListener("click", async () => {
        complete.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.toggleTodo(id, true));
        }, "完成任务失败");
      });
    }

    const more = card.querySelector("[data-calendar-more]");
    if (more) {
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(more, [
          {
            label: "安排到明天",
            action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 1) }, "安排到明天失败")
          },
          {
            label: "编辑",
            action: () => openTodoEditor(id)
          }
        ]);
      });
    }
  });

  app.querySelectorAll("[data-triage-id]").forEach((card) => {
    const id = card.dataset.triageId;
    const schedule = card.querySelector("[data-triage-schedule]");
    if (schedule) {
      schedule.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(schedule, [
          { label: "安排到今天", action: async () => updateTodoAction(id, { dueDate: localDateKey() }, "安排到今天失败") },
          { label: "安排到明天", action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 1) }, "安排到明天失败") },
          { label: "安排到下周", action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 7) }, "安排到下周失败") }
        ]);
      });
    }

    const high = card.querySelector("[data-triage-high]");
    if (high) {
      high.addEventListener("click", async () => {
        high.disabled = true;
        await updateTodoAction(id, { priority: "high" }, "设置高优先级失败");
      });
    }

    const estimate = card.querySelector("[data-triage-estimate]");
    if (estimate) {
      estimate.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(estimate, [
          { label: "25m", action: async () => updateTodoAction(id, { estimateMinutes: 25 }, "设置估时失败") },
          { label: "50m", action: async () => updateTodoAction(id, { estimateMinutes: 50 }, "设置估时失败") },
          { label: "90m", action: async () => updateTodoAction(id, { estimateMinutes: 90 }, "设置估时失败") }
        ]);
      });
    }

    const edit = card.querySelector("[data-triage-edit]");
    if (edit) {
      edit.addEventListener("click", () => {
        openTodoEditor(id);
      });
    }

    card.querySelectorAll("[data-triage-project]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        const categoryId = normalizeCategoryId(button.dataset.triageProject || "Inbox");
        await updateTodoAction(id, { project: categoryId, categoryId }, "设置分类失败");
      });
    });

    card.querySelectorAll("[data-triage-tag]").forEach((button) => {
      button.addEventListener("click", async () => {
        const todo = todos.find((item) => item.id === id);
        if (!todo) return;
        const tag = button.dataset.triageTag || "";
        const tags = [...new Set([...(todo.tags || []), tag].filter(Boolean))].slice(0, 8);
        button.disabled = true;
        await updateTodoAction(id, { tags }, "添加标签失败");
      });
    });
  });

  app.querySelectorAll("[data-stats-view]").forEach((button) => {
    button.addEventListener("click", () => {
      activeView = button.dataset.statsView || "stats";
      render();
    });
  });

  app.querySelectorAll("[data-project-card]").forEach((card) => {
    const project = card.dataset.projectCard || "";
    const row = projectDashboardRows().find((item) => item.project === project);
    const showList = card.querySelector("[data-project-list]");
    if (showList) {
      showList.addEventListener("click", () => {
        activeCategory = project || "未分类";
        projectFilter = activeCategory === "未分类" ? "" : activeCategory;
        activeView = "category";
        render();
      });
    }

    const more = card.querySelector("[data-project-more]");
    if (more) {
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(more, [
          {
            label: "看规划",
            action: () => {
              projectFilter = project;
              activeView = "plan";
              render();
            },
          },
          {
            label: "开始专注",
            disabled: !(row && row.recent.length),
            action: async () => {
              const todo = row && row.recent[0];
              if (!todo) return;
              more.disabled = true;
              await runTodoAction(async () => {
                applyStore(await window.deskchat.startTodoTimer(todo.id, focusDefaultMinutes));
              }, "开始分类专注失败");
              activeView = "focus";
              render();
            },
          },
        ]);
      });
    }
  });

  app.querySelectorAll("[data-goal-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await saveGoal(form);
    });
    const cancel = form.querySelector("[data-goal-cancel-edit]");
    if (cancel) {
      cancel.addEventListener("click", () => {
        editingGoalId = "";
        render();
      });
    }
  });

  app.querySelectorAll("[data-goal-id]").forEach((card) => {
    const goal = goalById(card.dataset.goalId);
    const edit = card.querySelector("[data-goal-edit]");
    if (edit) {
      edit.addEventListener("click", () => {
        if (!goal) return;
        editingGoalId = goal.id;
        selectedGoalId = goal.id;
        render();
      });
    }

    const archive = card.querySelector("[data-goal-archive]");
    if (archive) {
      archive.addEventListener("click", async () => {
        await archiveGoalAction(goal);
      });
    }

    const breakdown = card.querySelector("[data-goal-breakdown]");
    if (breakdown) {
      breakdown.addEventListener("click", () => {
        if (!goal) return;
        selectedGoalId = goal.id;
        render();
      });
    }
  });

  app.querySelectorAll("[data-goal-task-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const goal = goalById(form.dataset.goalId);
      await createGoalTask(form, goal);
    });
  });

  app.querySelectorAll("[data-goal-create-week-tasks]").forEach((button) => {
    button.addEventListener("click", async () => {
      const detail = button.closest("[data-goal-detail]");
      const goal = goalById(detail && detail.dataset ? detail.dataset.goalDetail : selectedGoalId);
      button.disabled = true;
      await createGoalWeekTasks(goal);
    });
  });

  const archiveAllCompleted = app.querySelector("[data-archive-all-completed]");
  if (archiveAllCompleted) {
    archiveAllCompleted.addEventListener("click", async () => {
      archiveAllCompleted.disabled = true;
      await archiveCompletedTodosAction(completedPageTodos());
    });
  }

  app.querySelectorAll("[data-completed-id]").forEach((card) => {
    const todo = todos.find((item) => item.id === card.dataset.completedId);
    const undo = card.querySelector("[data-completed-undo]");
    if (undo) {
      undo.addEventListener("click", async () => {
        undo.disabled = true;
        await undoCompletedTodoAction(todo);
      });
    }
    const archive = card.querySelector("[data-completed-archive]");
    if (archive) {
      archive.addEventListener("click", async () => {
        archive.disabled = true;
        await archiveTodoAction(todo);
        if (!todoBusy) archive.disabled = false;
      });
    }
  });

  app.querySelectorAll("[data-archived-id]").forEach((card) => {
    const todo = todos.find((item) => item.id === card.dataset.archivedId);
    const restore = card.querySelector("[data-archived-restore]");
    if (restore) {
      restore.addEventListener("click", async () => {
        restore.disabled = true;
        await restoreArchivedTodoAction(todo);
      });
    }
    const permanentDelete = card.querySelector("[data-archived-delete]");
    if (permanentDelete) {
      permanentDelete.addEventListener("click", async () => {
        permanentDelete.disabled = true;
        await permanentlyDeleteTodoAction(todo);
        if (!todoBusy) permanentDelete.disabled = false;
      });
    }
  });

  app.querySelectorAll("[data-template-id]").forEach((card) => {
    const template = todoTemplates().find((item) => item.id === card.dataset.templateId);
    const create = card.querySelector("[data-template-create]");
    if (create) {
      create.addEventListener("click", async () => {
        if (!template) return;
        create.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.createTodo(templateTodoPayload(template)));
        }, "创建模板任务失败");
      });
    }

    const createFocus = card.querySelector("[data-template-create-focus]");
    if (createFocus) {
      createFocus.addEventListener("click", async () => {
        if (!template) return;
        createFocus.disabled = true;
        await runTodoAction(async () => {
          const store = await window.deskchat.createTodo(templateTodoPayload(template));
          const created = store.todos && store.todos[0];
          applyStore(created
            ? await window.deskchat.startTodoTimer(created.id, template.estimateMinutes || focusDefaultMinutes)
            : store);
        }, "创建并开始专注失败");
        activeView = "focus";
        render();
      });
    }
  });

  app.querySelectorAll("[data-matrix-id]").forEach((card) => {
    const id = card.dataset.matrixId;
    const todo = todos.find((item) => item.id === id);
    const complete = card.querySelector("[data-matrix-complete]");
    if (complete) {
      complete.addEventListener("click", async () => {
        complete.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.toggleTodo(id, true));
        }, "完成任务失败");
      });
    }

    const focus = card.querySelector("[data-matrix-focus]");
    if (focus) {
      focus.addEventListener("click", async () => {
        if (!todo) return;
        focus.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "开始专注失败");
        activeView = "focus";
        render();
      });
    }

    const more = card.querySelector("[data-matrix-more]");
    if (more) {
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(more, [
          {
            label: "安排到明天",
            action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 1) }, "安排到明天失败")
          },
          {
            label: "编辑",
            action: () => openTodoEditor(id)
          }
        ]);
      });
    }
  });

  app.querySelectorAll("[data-plan-id]").forEach((card) => {
    const id = card.dataset.planId;
    const todo = todos.find((item) => item.id === id);
    const schedule = card.querySelector("[data-plan-schedule]");
    if (schedule) {
      schedule.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(schedule, [
          { label: "安排到今天", action: async () => updateTodoAction(id, { dueDate: localDateKey() }, "安排到今天失败") },
          { label: "安排到明天", action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 1) }, "安排到明天失败") },
          { label: "安排到下周", action: async () => updateTodoAction(id, { dueDate: shiftTodoDate(localDateKey(), 7) }, "安排到下周失败") },
          todo && todo.dueDate ? { type: "separator" } : null,
          todo && todo.dueDate ? {
            label: "移出日程",
            danger: true,
            action: async () => updateTodoAction(id, { dueDate: "" }, "移出日程失败")
          } : null
        ]);
      });
    }

    const focus = card.querySelector("[data-plan-focus]");
    if (focus) {
      focus.addEventListener("click", async () => {
        if (!todo) return;
        focus.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "开始专注失败");
        activeView = "focus";
        render();
      });
    }

    const complete = card.querySelector("[data-plan-complete]");
    if (complete) {
      complete.addEventListener("click", async () => {
        complete.disabled = true;
        await runTodoAction(async () => {
          applyStore(await window.deskchat.toggleTodo(id, true));
        }, "完成任务失败");
      });
    }
  });

  app.querySelectorAll("[data-waiting-id]").forEach((card) => {
    const id = card.dataset.waitingId;
    const todo = todos.find((item) => item.id === id);
    const followToday = card.querySelector("[data-waiting-today]");
    if (followToday) {
      followToday.addEventListener("click", async () => {
        followToday.disabled = true;
        await updateTodoAction(id, { waitingUntil: localDateKey() }, "设置跟进日期失败");
      });
    }

    const followTomorrow = card.querySelector("[data-waiting-tomorrow]");
    if (followTomorrow) {
      followTomorrow.addEventListener("click", async () => {
        followTomorrow.disabled = true;
        await updateTodoAction(id, { waitingUntil: shiftTodoDate(localDateKey(), 1) }, "设置跟进日期失败");
      });
    }

    const clear = card.querySelector("[data-waiting-clear]");
    if (clear) {
      clear.addEventListener("click", async () => {
        clear.disabled = true;
        await clearTodoWaitingAction(todo);
      });
    }

    const edit = card.querySelector("[data-waiting-edit]");
    if (edit) {
      edit.addEventListener("click", () => {
        openTodoEditor(id);
      });
    }
  });

  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      filter = button.dataset.filter || "all";
      render();
    });
  });

  const searchInput = app.querySelector("[data-search]");
  if (searchInput) {
    searchInput.addEventListener("input", debounce(() => {
      search = searchInput.value;
      render();
      const next = app.querySelector("[data-search]");
      if (next) {
        next.focus();
        next.setSelectionRange(next.value.length, next.value.length);
      }
    }));
  }

  const sortSelect = app.querySelector("[data-sort]");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      sortMode = sortSelect.value || "smart";
      render();
    });
  }

  const clearCompleted = app.querySelector("[data-clear-completed]");
  if (clearCompleted) {
    clearCompleted.addEventListener("click", async () => {
      await clearCompletedTodosAction();
    });
  }

  const completeAll = app.querySelector("[data-complete-all]");
  if (completeAll) {
    completeAll.addEventListener("click", async () => {
      await completeAllTodosAction();
    });
  }

  const reopenAll = app.querySelector("[data-reopen-all]");
  if (reopenAll) {
    reopenAll.addEventListener("click", async () => {
      await reopenAllTodosAction();
    });
  }

  const clearTag = app.querySelector("[data-clear-tag]");
  if (clearTag) {
    clearTag.addEventListener("click", () => {
      tagFilter = "";
      render();
    });
  }

  const clearProject = app.querySelector("[data-clear-project]");
  if (clearProject) {
    clearProject.addEventListener("click", () => {
      projectFilter = "";
      render();
    });
  }

  app.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      activeCategory = button.dataset.project || "未分类";
      activeView = "category";
      projectFilter = activeCategory === "未分类" ? "" : activeCategory;
      render();
    });
  });

  app.querySelectorAll("[data-tag]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      tagFilter = button.dataset.tag || "";
      render();
    });
  });

  app.querySelectorAll("[data-id]").forEach((item) => {
    const id = item.dataset.id;
    const todo = todos.find((item) => item.id === id);
    function editCurrentTodo() {
      editingId = id;
      render();
      window.requestAnimationFrame(() => {
        const editor = Array.from(app.querySelectorAll("[data-id]")).find((node) => node.dataset.id === id);
        const input = editor && editor.querySelector('input[name="title"]');
        if (input) {
          input.focus();
          input.select();
        }
      });
    }

    item.addEventListener("dblclick", (event) => {
      if (event.target && event.target.closest && event.target.closest("button, input, textarea, select, label")) return;
      editCurrentTodo();
    });
    item.addEventListener("contextmenu", (event) => openContextMenu(event, [
      {
        label: "编辑任务",
        action: editCurrentTodo
      },
      {
        label: todo && todo.completed ? "标记为任务" : "标记为完成",
        action: async () => {
          await runTodoAction(async () => {
            applyStore(await window.deskchat.toggleTodo(id, !(todo && todo.completed)));
          }, "更新任务状态失败");
        }
      },
      {
        label: isFocusTimerForTodo(todo) ? "查看番茄" : "开始番茄",
        disabled: todo && todo.completed,
        action: async () => {
          if (isFocusTimerForTodo(todo)) {
            activeView = "focus";
            render();
            return;
          }
          await runTodoAction(async () => {
            applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
          }, "开始番茄失败");
          activeView = "focus";
          render();
        }
      },
      todo && todo.project ? {
        label: `只看分类 ${todo.project}`,
        action: () => {
          projectFilter = todoCategoryName(todo);
          render();
        }
      } : null,
      todo && !todo.completed && detectGoalLikeTask(todo.title) ? {
        label: "转换为目标",
        action: () => {
          convertingGoalTodoId = todo.id;
          render();
        }
      } : null,
      {
        label: "复制任务",
        action: async () => {
          await duplicateTodoAction(todo);
        }
      },
      todo && !isArchivedTodo(todo) ? {
        label: "归档任务",
        action: async () => {
          await archiveTodoAction(todo);
        }
      } : null,
      todo && !todo.completed ? {
        label: "延期到明天",
        action: async () => {
          await shiftTodoDueDateAction(todo, 1);
        }
      } : null,
      todo && !todo.completed ? {
        label: "延后一周",
        action: async () => {
          await shiftTodoDueDateAction(todo, 7);
        }
      } : null,
      todo && todo.dueDate ? {
        label: "清除截止日期",
        action: async () => {
          await clearTodoDueDateAction(todo);
        }
      } : null,
      todo && todo.priority !== "high" ? {
        label: "设为高优先级",
        action: async () => {
          await setTodoPriorityAction(todo, "high");
        }
      } : null,
      normalizePriority(todo && todo.priority) !== "medium" ? {
        label: "设为中优先级",
        action: async () => {
          await setTodoPriorityAction(todo, "medium");
        }
      } : null,
      todo && todo.priority !== "low" ? {
        label: "设为低优先级",
        action: async () => {
          await setTodoPriorityAction(todo, "low");
        }
      } : null,
      todo && todo.tags && todo.tags.length ? { type: "separator" } : null,
      ...(todo && todo.tags ? todo.tags.slice(0, 4).map((tag) => ({
        label: `只看 #${tag}`,
        action: () => {
          tagFilter = tag;
          render();
        }
      })) : []),
      { type: "separator" },
      {
        label: "删除任务",
        danger: true,
        action: async () => {
          if (!(await confirmAction(`删除任务「${(todo && todo.title) || "未命名任务"}」？`, {
            confirmLabel: "删除",
            detail: "任务会先进入回收站，可从回收站恢复或彻底删除。"
          }))) return;
          await softDeleteTodoAction(todo);
        }
      }
    ]));

    const toggle = item.querySelector("[data-toggle]");
    if (toggle) {
      toggle.addEventListener("change", async () => {
        await runTodoAction(async () => {
          toggle.disabled = true;
          applyStore(await window.deskchat.toggleTodo(id, toggle.checked));
        }, "更新任务状态失败");
      });
    }

    const edit = item.querySelector("[data-edit]");
    if (edit) {
      edit.addEventListener("click", editCurrentTodo);
    }

    const timer = item.querySelector("[data-timer]");
    if (timer) {
      timer.addEventListener("click", async () => {
        if (todo && isFocusTimerForTodo(todo)) {
          activeView = "focus";
          render();
          return;
        }
        await runTodoAction(async () => {
          timer.disabled = true;
          applyStore(await window.deskchat.startTodoTimer(id, focusDefaultMinutes));
        }, "更新计时失败");
      });
    }

    const convertGoal = item.querySelector("[data-convert-goal]");
    if (convertGoal) {
      convertGoal.addEventListener("click", () => {
        if (!todo) return;
        convertingGoalTodoId = todo.id;
        render();
      });
    }

    const duplicate = item.querySelector("[data-duplicate]");
    if (duplicate) {
      duplicate.addEventListener("click", async () => {
        duplicate.disabled = true;
        await duplicateTodoAction(todo);
      });
    }

    const archive = item.querySelector("[data-archive]");
    if (archive) {
      archive.addEventListener("click", async () => {
        archive.disabled = true;
        await archiveTodoAction(todo);
        if (!todoBusy) archive.disabled = false;
      });
    }

    const dueDate = item.querySelector("[data-due-date]");
    if (dueDate) {
      dueDate.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(dueDate, [
          { label: "设为今天", action: async () => updateTodoAction(todo.id, { dueDate: localDateKey() }, "更新截止日期失败") },
          { label: "设为明天", action: async () => shiftTodoDueDateAction(todo, 1) },
          { label: "延后一周", action: async () => shiftTodoDueDateAction(todo, 7) },
          { label: "延后一个月", action: async () => shiftTodoDueDateAction(todo, 0, 1) },
          todo.dueDate ? { type: "separator" } : null,
          todo.dueDate ? {
            label: "清除截止日期",
            danger: true,
            action: async () => clearTodoDueDateAction(todo)
          } : null
        ]);
      });
    }

    const waitingChip = item.querySelector("[data-waiting-chip]");
    if (waitingChip) {
      waitingChip.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(waitingChip, [
          { label: "今天跟进", action: async () => updateTodoAction(todo.id, { waitingUntil: localDateKey() }, "设置跟进日期失败") },
          { label: "明天跟进", action: async () => updateTodoAction(todo.id, { waitingUntil: shiftTodoDate(localDateKey(), 1) }, "设置跟进日期失败") },
          { label: "下周跟进", action: async () => updateTodoAction(todo.id, { waitingUntil: shiftTodoDate(localDateKey(), 7) }, "设置跟进日期失败") },
          { type: "separator" },
          { label: "已解除等待", action: async () => clearTodoWaitingAction(todo) }
        ]);
      });
    }

    const priority = item.querySelector("[data-priority]");
    if (priority) {
      priority.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnchoredMenu(priority, [
          { label: "高优先级", action: async () => setTodoPriorityAction(todo, "high") },
          { label: "中优先级", action: async () => setTodoPriorityAction(todo, "medium") },
          { label: "低优先级", action: async () => setTodoPriorityAction(todo, "low") }
        ]);
      });
    }

    item.querySelectorAll("[data-subtask]").forEach((checkbox) => {
      checkbox.addEventListener("change", async () => {
        await runTodoAction(async () => {
          checkbox.disabled = true;
          applyStore(await window.deskchat.toggleTodoSubtask(id, checkbox.dataset.subtask, checkbox.checked));
        }, "更新子任务失败");
      });
    });

    const remove = item.querySelector("[data-delete]");
    if (remove) {
      remove.addEventListener("click", async () => {
        if (!(await confirmAction(`删除任务「${(todo && todo.title) || "未命名任务"}」？`, {
          confirmLabel: "删除",
          detail: "任务会先进入回收站，可从回收站恢复或彻底删除。"
        }))) return;
        remove.disabled = true;
        await softDeleteTodoAction(todo);
      });
    }

    const cancel = item.querySelector("[data-cancel]");
    if (cancel) {
      cancel.addEventListener("click", () => {
        editingId = null;
        render();
      });
    }

    const editForm = item.querySelector("[data-edit-form]");
    if (editForm) {
      editForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        await saveTodo(editForm, id);
      });
      editForm.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          editingId = null;
          render();
        }
      });
    }
  });

  bindContextMenu(app.querySelector(".todo-window-header"), () => {
    const currentStats = stats();
    return [
      { label: "添加任务", action: focusCreateTodo },
      { label: "重置视图", action: resetTodoView },
      { type: "separator" },
      { label: "全部完成", disabled: !currentStats.active, action: completeAllTodosAction },
      { label: "恢复任务", disabled: !currentStats.completed, action: reopenAllTodosAction },
      { label: "归档已完成", disabled: !currentStats.completed, action: clearCompletedTodosAction }
    ];
  });

  bindContextMenu(app.querySelector(".todo-controls"), () => {
    const currentStats = stats();
    return [
      { label: "全部任务", action: () => { filter = "all"; render(); } },
      { label: "只看任务", disabled: !currentStats.active, action: () => { filter = "active"; render(); } },
      { label: "只看已完成", disabled: !currentStats.completed, action: () => { filter = "completed"; render(); } },
      { label: "只看今天", disabled: !currentStats.today, action: () => { filter = "today"; render(); } },
      { label: "只看逾期", disabled: !currentStats.overdue, action: () => { filter = "overdue"; render(); } },
      { type: "separator" },
      { label: "智能排序", action: () => { sortMode = "smart"; render(); } },
      { label: "按优先级", action: () => { sortMode = "priority"; render(); } },
      { label: "最近更新", action: () => { sortMode = "updated"; render(); } },
      { type: "separator" },
      {
        label: "清空搜索",
        disabled: !search,
        action: () => {
          search = "";
          render();
        }
      }
    ];
  });

  bindContextMenu(app.querySelector(".todo-tag-rail"), () => [
    { label: "全部分类", action: () => { projectFilter = ""; render(); } },
    ...allProjects().slice(0, 8).map(([project]) => ({
      label: `只看分类 ${project}`,
      action: () => {
        projectFilter = project;
        render();
      }
    })),
    { type: "separator" },
    { label: "全部标签", action: () => { tagFilter = ""; render(); } },
    ...allTags().slice(0, 8).map(([tag]) => ({
      label: `只看 #${tag}`,
      action: () => {
        tagFilter = tag;
        render();
      }
    }))
  ]);

  bindContextMenu(app.querySelector(".todo-list"), () => {
    const currentStats = stats();
    return [
      { label: "添加任务", action: focusCreateTodo },
      { label: "重置视图", action: resetTodoView },
      { type: "separator" },
      { label: "全部完成", disabled: !currentStats.active, action: completeAllTodosAction },
      { label: "恢复任务", disabled: !currentStats.completed, action: reopenAllTodosAction },
      { label: "归档已完成", disabled: !currentStats.completed, action: clearCompletedTodosAction }
    ];
  });
}

window.deskchat.onTodosUpdated(applyStore);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && convertingGoalTodoId) {
    convertingGoalTodoId = "";
    render();
    return;
  }
  if (event.key === "Escape" && editingId) {
    editingId = null;
    render();
    return;
  }
  if (event.key === "Escape" && contextMenu) closeContextMenu();
});
document.addEventListener("click", (event) => {
  if (contextMenu && !contextMenu.contains(event.target)) closeContextMenu();
});
loadTodos().catch((error) => {
  app.innerHTML = `<div class="todo-empty"><strong>读取 Todo 失败</strong><span>${escapeHtml(error.message)}</span></div>`;
});
