const assert = require("node:assert/strict");
const { goalDecomposer } = require("./goal-decomposer");

const goal = {
  id: "goal-1",
  title: "8月31日前完成30套试卷，均分120",
  categoryId: "数学",
  deadline: "2026-08-31",
  targetCount: 30,
  currentCount: 10
};

const result = goalDecomposer({
  goal,
  today: "2026-07-06",
  currentCount: 10,
  targetCount: 30,
  deadline: "2026-08-31"
});

assert.equal(result.ok, true);
assert.equal(result.remainingDays, 56);
assert.equal(result.remainingCount, 20);
assert.equal(result.remainingWeeks, 8);
assert.equal(result.weeklyRequiredCount, 3);
assert.equal(result.suggestedTasks.length, 4);
assert.deepEqual(result.suggestedTasks.map((task) => task.title), [
  "完成第 11 套试卷",
  "完成第 12 套试卷",
  "完成第 13 套试卷",
  "复盘本周错题"
]);
assert.deepEqual(result.suggestedTasks.map((task) => task.dueDate), [
  "2026-07-06",
  "2026-07-07",
  "2026-07-08",
  "2026-07-09"
]);
assert.equal(result.suggestedTasks[0].categoryId, "数学");
assert.equal(result.suggestedTasks[0].goalId, "goal-1");
assert.equal(result.suggestedTasks[0].estimateMinutes, 120);
assert.equal(result.suggestedTasks[0].priority, "high");

assert.equal(goalDecomposer({ goal: { targetCount: 10 }, today: "2026-07-06" }).reason, "请先设置截止日期");
assert.equal(goalDecomposer({ goal: { deadline: "2026-08-31" }, today: "2026-07-06" }).reason, "请先设置目标数量");
assert.equal(goalDecomposer({ goal, today: "2026-07-06", currentCount: 30, targetCount: 30, deadline: "2026-08-31" }).reason, "目标已完成，无需拆解");
assert.equal(goalDecomposer({ goal, today: "2026-09-01", currentCount: 10, targetCount: 30, deadline: "2026-08-31" }).reason, "目标已逾期，请调整截止日期或目标数量");

const heavy = goalDecomposer({
  goal: { id: "goal-2", title: "完成100项训练", categoryId: "训练", deadline: "2026-07-20" },
  today: "2026-07-06",
  currentCount: 0,
  targetCount: 100
});
assert.equal(heavy.suggestedTasks.length, 7);
assert.equal(JSON.stringify(heavy).includes("NaN"), false);

console.log("goal-decomposer selftest ok");
