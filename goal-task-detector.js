(function initGoalTaskDetector(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DeskchatGoalTaskDetector = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGoalTaskDetectorApi() {
  const GOAL_KEYWORDS = ["月底", "报名前", "完成", "套", "均分", "基础", "强化", "冲刺", "真题", "词背诵"];
  const CATEGORY_HINTS = ["数学", "408", "英语", "C++", "信息学竞赛"];
  const CHINESE_MONTHS = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    十一: 11,
    十二: 12
  };

  function localDateKey(date = new Date()) {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return localDateKey(new Date());
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function daysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function parseYear(today) {
    const key = localDateKey(today || new Date());
    return Number(key.slice(0, 4)) || new Date().getFullYear();
  }

  function parseMonthText(value) {
    const text = String(value || "").trim();
    if (!text) return 0;
    if (/^\d+$/.test(text)) return Math.max(1, Math.min(Number(text), 12));
    return CHINESE_MONTHS[text] || 0;
  }

  function detectGoalLikeTask(title) {
    const text = String(title || "").trim();
    if (!text) return false;
    if (GOAL_KEYWORDS.some((keyword) => text.includes(keyword))) return true;
    if (/\d+\+?\s*套/.test(text)) return true;
    if (/均分\s*\d{2,3}/.test(text)) return true;
    return false;
  }

  function parseGoalDeadline(title, today = new Date()) {
    const text = String(title || "");
    const year = parseYear(today);
    const monthMatch = text.match(/(?:(\d{1,2})|([一二三四五六七八九十]{1,3}))月底/);
    if (!monthMatch) return "";
    const month = parseMonthText(monthMatch[1] || monthMatch[2]);
    if (!month) return "";
    const day = daysInMonth(year, month);
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function parseGoalTargetCount(title) {
    const match = String(title || "").match(/(\d+)\+?\s*套/);
    return match ? Number(match[1]) || 0 : 0;
  }

  function parseGoalTargetScore(title) {
    const match = String(title || "").match(/均分\s*(\d{2,3})/);
    return match ? Number(match[1]) || 0 : 0;
  }

  function parseGoalCategory(title, fallbackCategory = "") {
    const text = String(title || "");
    const matched = CATEGORY_HINTS.find((category) => text.includes(category));
    return matched || String(fallbackCategory || "").trim();
  }

  function parseGoalLikeTask(title, options = {}) {
    const text = String(title || "").trim();
    return {
      isGoalLike: detectGoalLikeTask(text),
      title: text,
      deadline: parseGoalDeadline(text, options.today),
      targetCount: parseGoalTargetCount(text),
      targetScore: parseGoalTargetScore(text),
      categoryId: parseGoalCategory(text, options.categoryId),
      status: "active"
    };
  }

  return {
    detectGoalLikeTask,
    parseGoalLikeTask
  };
});
