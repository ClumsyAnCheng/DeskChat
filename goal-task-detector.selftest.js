const assert = require("node:assert/strict");
const { detectGoalLikeTask, parseGoalLikeTask } = require("./goal-task-detector");

assert.equal(detectGoalLikeTask("八月底完成30套试卷均分120"), true);
assert.equal(detectGoalLikeTask("六月底完成数学强化"), true);
assert.equal(detectGoalLikeTask("报名前完成30套试卷均分130"), true);
assert.equal(detectGoalLikeTask("英语词背诵冲刺"), true);
assert.equal(detectGoalLikeTask("普通提醒买纸巾"), false);

assert.deepEqual(parseGoalLikeTask("八月底完成30套试卷均分120", {
  today: "2026-06-12",
  categoryId: "数学"
}), {
  isGoalLike: true,
  title: "八月底完成30套试卷均分120",
  deadline: "2026-08-31",
  targetCount: 30,
  targetScore: 120,
  categoryId: "数学",
  status: "active"
});

assert.deepEqual(parseGoalLikeTask("六月底完成数学强化", {
  today: "2026-06-12",
  categoryId: "未分类"
}), {
  isGoalLike: true,
  title: "六月底完成数学强化",
  deadline: "2026-06-30",
  targetCount: 0,
  targetScore: 0,
  categoryId: "数学",
  status: "active"
});

const registration = parseGoalLikeTask("报名前完成30套试卷均分130", {
  today: "2026-06-12",
  categoryId: "408"
});
assert.equal(registration.deadline, "");
assert.equal(registration.targetCount, 30);
assert.equal(registration.targetScore, 130);
assert.equal(registration.categoryId, "408");

const plusCount = parseGoalLikeTask("冲刺阶段完成14+套真题", { today: "2026-06-12" });
assert.equal(plusCount.targetCount, 14);
assert.equal(JSON.stringify(plusCount).includes("NaN"), false);

console.log("goal-task-detector selftest ok");
