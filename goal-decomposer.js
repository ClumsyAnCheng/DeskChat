(function initGoalDecomposer(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DeskchatGoalDecomposer = api;
})(typeof globalThis !== "undefined" ? globalThis : window, function createGoalDecomposerApi() {
  function localDateKey(date = new Date()) {
    const target = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(target.getTime())) return localDateKey(new Date());
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function parseDateKey(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKeyFromDate(date) {
    return localDateKey(date);
  }

  function addDays(dateKey, days) {
    const base = parseDateKey(dateKey) || parseDateKey(localDateKey());
    base.setDate(base.getDate() + days);
    return dateKeyFromDate(base);
  }

  function positiveInteger(value) {
    const number = Math.floor(Number(value) || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function daysBetween(today, deadline) {
    const start = parseDateKey(today);
    const end = parseDateKey(deadline);
    if (!start || !end) return 0;
    return Math.ceil((end.getTime() - start.getTime()) / 86400000);
  }

  function invalidResult(reason, reasonCode, values = {}) {
    return {
      ok: false,
      reason,
      reasonCode,
      remainingDays: Number(values.remainingDays) || 0,
      remainingCount: Number(values.remainingCount) || 0,
      remainingWeeks: Math.max(1, Number(values.remainingWeeks) || 1),
      weeklyRequiredCount: Number(values.weeklyRequiredCount) || 0,
      suggestedTasks: []
    };
  }

  function isPaperGoal(goal) {
    const title = String(goal && goal.title || "");
    return /试卷|真题|套/.test(title);
  }

  function mainTaskTitle(goal, sequence) {
    if (isPaperGoal(goal)) return `完成第 ${sequence} 套试卷`;
    const title = String(goal && goal.title || "学习目标").trim();
    return `${title}：完成第 ${sequence} 项`;
  }

  function reviewTaskTitle(goal) {
    return isPaperGoal(goal) ? "复盘本周错题" : "复盘本周目标进展";
  }

  function goalDecomposer(input = {}) {
    const goal = input.goal || {};
    const today = localDateKey(input.today || new Date());
    const deadline = String(input.deadline || goal.deadline || "").trim();
    const targetCount = positiveInteger(input.targetCount ?? goal.targetCount);
    const currentCount = Math.max(0, Math.floor(Number(input.currentCount ?? goal.currentCount) || 0));
    const categoryId = String(goal.categoryId || input.categoryId || "未分类").trim() || "未分类";
    const goalId = String(goal.id || input.goalId || "").trim();

    if (!deadline) return invalidResult("请先设置截止日期", "missing_deadline");
    if (!targetCount) return invalidResult("请先设置目标数量", "missing_target_count");

    const remainingCount = targetCount - currentCount;
    if (remainingCount <= 0) {
      return invalidResult("目标已完成，无需拆解", "completed", { remainingCount });
    }

    const remainingDays = daysBetween(today, deadline);
    if (remainingDays <= 0) {
      return invalidResult("目标已逾期，请调整截止日期或目标数量", "overdue", {
        remainingDays,
        remainingCount
      });
    }

    const remainingWeeks = Math.max(1, Math.ceil(remainingDays / 7));
    const weeklyRequiredCount = Math.ceil(remainingCount / remainingWeeks);
    const mainTaskCount = Math.min(weeklyRequiredCount, remainingCount, weeklyRequiredCount >= 7 ? 7 : 6);
    const suggestedTasks = [];

    for (let index = 0; index < mainTaskCount; index += 1) {
      const sequence = currentCount + index + 1;
      suggestedTasks.push({
        title: mainTaskTitle(goal, sequence),
        dueDate: addDays(today, index),
        categoryId,
        goalId,
        estimateMinutes: isPaperGoal(goal) ? 120 : 50,
        priority: "high"
      });
    }

    if (suggestedTasks.length < 7) {
      suggestedTasks.push({
        title: reviewTaskTitle(goal),
        dueDate: addDays(today, suggestedTasks.length),
        categoryId,
        goalId,
        estimateMinutes: 50,
        priority: "medium"
      });
    }

    return {
      ok: true,
      reason: "",
      reasonCode: "",
      remainingDays,
      remainingCount,
      remainingWeeks,
      weeklyRequiredCount,
      suggestedTasks
    };
  }

  return { goalDecomposer };
});
