(function initQuickAddParser(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DeskchatQuickAddParser = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createQuickAddParserApi() {
  const DEFAULT_CATEGORIES = ["数学", "408", "英语", "C++", "信息学竞赛"];

  function localDateKey(date = new Date()) {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return localDateKey(new Date());
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function baseDate(options = {}) {
    const source = options.selectedDate || options.today || localDateKey();
    const target = new Date(`${source}T00:00:00`);
    return Number.isNaN(target.getTime()) ? new Date(`${localDateKey()}T00:00:00`) : target;
  }

  function shiftDateKey(days, options = {}) {
    const target = new Date(baseDate(options));
    target.setDate(target.getDate() + days);
    return localDateKey(target);
  }

  function nextWeekdayDateKey(targetDay, options = {}, forceNextWeek = false) {
    const base = baseDate(options);
    const today = base.getDay();
    if (forceNextWeek) {
      const currentWeekIndex = (today + 6) % 7;
      const targetWeekIndex = (targetDay + 6) % 7;
      return shiftDateKey((7 - currentWeekIndex) + targetWeekIndex, options);
    }
    let diff = (targetDay - today + 7) % 7;
    if (diff === 0) diff = 7;
    return shiftDateKey(diff, options);
  }

  function parseMonthDayDate(month, day, options = {}) {
    const base = baseDate(options);
    const target = new Date(base.getFullYear(), Number(month) - 1, Number(day));
    if (Number.isNaN(target.getTime()) || target.getMonth() !== Number(month) - 1) return "";
    if (localDateKey(target) < localDateKey(base)) target.setFullYear(target.getFullYear() + 1);
    return localDateKey(target);
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

  function parseQuickDueDate(value, options = {}) {
    const key = String(value || "").trim().toLowerCase().replace(/\s+/g, "");
    if (!key) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return isValidDateKey(key) ? key : "";
    if (key === "今天") return localDateKey(baseDate(options));
    if (key === "明天") return shiftDateKey(1, options);
    if (key === "后天") return shiftDateKey(2, options);

    const weekdayNames = {
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
    if (nextWeekday) return nextWeekdayDateKey(weekdayNames[nextWeekday[1]], options, true);
    const chineseWeekday = key.match(/^(?:周|星期)([一二三四五六日天])$/);
    if (chineseWeekday) return nextWeekdayDateKey(weekdayNames[chineseWeekday[1]], options);
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

  function normalizeCategoryId(value, categories = DEFAULT_CATEGORIES) {
    const text = String(value || "").trim().replace(/^#+/, "").slice(0, 80);
    if (!text) return "";
    return categories.find((name) => String(name).toLowerCase() === text.toLowerCase()) || text;
  }

  function knownCategoryFromTag(tag, categories = DEFAULT_CATEGORIES) {
    const categoryId = normalizeCategoryId(tag, categories);
    return categories.some((name) => String(name).toLowerCase() === categoryId.toLowerCase()) ? categoryId : "";
  }

  function parseMinutes(value) {
    const text = String(value || "").trim().toLowerCase();
    if (!text) return 0;
    const hourMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:h|hour|hours|小时)/);
    if (hourMatch) return Math.round(Number(hourMatch[1]) * 60);
    const minuteMatch = text.match(/(\d+)\s*(?:m|min|分钟)/);
    if (minuteMatch) return Number(minuteMatch[1]);
    return 0;
  }

  function quickAddParser(raw, options = {}) {
    let title = String(raw || "").trim();
    const categories = Array.isArray(options.categories) && options.categories.length
      ? options.categories
      : DEFAULT_CATEGORIES;
    const patch = { tags: [], project: "", categoryId: "", priority: "", dueDate: "", startTime: "", estimateMinutes: 0 };

    const consume = (pattern, handler) => {
      title = title.replace(pattern, (match, ...args) => {
        try {
          handler(...args);
        } catch (_error) {
          // Invalid quick-add tokens should fall back to an ordinary task.
        }
        return " ";
      });
    };

    consume(/(?:^|\s)#([\p{Script=Han}A-Za-z0-9_+-]+)/gu, (tag) => {
      if (!tag) return;
      const cleanTag = String(tag).trim().replace(/^#+/, "");
      if (!cleanTag) return;
      patch.tags.push(cleanTag);
      const categoryId = knownCategoryFromTag(cleanTag, categories);
      if (categoryId) {
        patch.categoryId = patch.categoryId || categoryId;
        patch.project = patch.project || categoryId;
      }
    });
    consume(/(?:^|\s)!([高中低])(?=\s|$)/g, (value) => {
      patch.priority = value === "高" ? "high" : value === "低" ? "low" : "medium";
    });
    consume(/(?:^|\s)(\d+(?:\.\d+)?)\s*(h|小时)(?=\s|$)/giu, (value) => {
      patch.estimateMinutes = Math.round(Number(value) * 60);
    });
    consume(/(?:^|\s)(\d+)\s*(m|分钟)(?=\s|$)/giu, (value) => {
      patch.estimateMinutes = Number(value);
    });
    consume(/(?:^|\s)(\d{4}-\d{2}-\d{2})(?=\s|$)/g, (value) => {
      patch.dueDate = parseQuickDueDate(value, options) || patch.dueDate;
    });
    consume(/(?:^|\s)(\d{1,2})月(\d{1,2})日?(?=\s|$)/g, (month, day) => {
      patch.dueDate = parseMonthDayDate(month, day, options) || patch.dueDate;
    });
    consume(/(?:^|\s)(今天|明天|后天)(?=\s|$)/g, (value) => {
      patch.dueDate = parseQuickDueDate(value, options) || patch.dueDate;
    });
    consume(/(?:^|\s)(周[一二三四五六日天]|星期[一二三四五六日天])(?=\s|$)/g, (value) => {
      patch.dueDate = parseQuickDueDate(value, options) || patch.dueDate;
    });
    consume(/(?:^|\s)(上午|早上|下午|晚上|傍晚)?([01]?\d|2[0-3])[:：]([0-5]\d)(?=\s|$)/g, (period, hour, minute) => {
      patch.startTime = normalizeQuickTime(hour, minute, period) || patch.startTime;
    });
    consume(/(?:^|\s)(上午|早上|下午|晚上|傍晚)(\d{1,2})点(半|[0-5]?\d分?)?(?=\s|$)/g, (period, hour, minuteText) => {
      const minute = minuteText === "半" ? 30 : String(minuteText || "0").replace("分", "") || 0;
      patch.startTime = normalizeQuickTime(hour, minute, period) || patch.startTime;
    });

    patch.tags = [...new Set(patch.tags)].slice(0, 8);
    return { title: title.replace(/\s+/g, " ").trim(), patch };
  }

  return {
    DEFAULT_CATEGORIES,
    quickAddParser,
    parseQuickDueDate,
    isValidDateKey,
    parseMonthDayDate,
    normalizeQuickTime,
    parseMinutes
  };
});
