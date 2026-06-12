const assert = require("node:assert/strict");
const { quickAddParser } = require("./quick-add-parser");

const options = { today: "2026-06-12" };

function check(input, expected) {
  const actual = quickAddParser(input, options);
  assert.equal(actual.title, expected.title, `${input}: title`);
  for (const [key, value] of Object.entries(expected.patch || {})) {
    assert.deepEqual(actual.patch[key], value, `${input}: patch.${key}`);
  }
}

check("明天 19:00 数学真题 2h #数学 !高", {
  title: "数学真题",
  patch: {
    dueDate: "2026-06-13",
    startTime: "19:00",
    estimateMinutes: 120,
    categoryId: "数学",
    project: "数学",
    priority: "high",
    tags: ["数学"]
  }
});

check("今天 英语阅读 30m #英语", {
  title: "英语阅读",
  patch: {
    dueDate: "2026-06-12",
    estimateMinutes: 30,
    categoryId: "英语",
    project: "英语",
    tags: ["英语"]
  }
});

check("周五 408强化 2小时 #408 !中", {
  title: "408强化",
  patch: {
    dueDate: "2026-06-19",
    estimateMinutes: 120,
    categoryId: "408",
    project: "408",
    priority: "medium",
    tags: ["408"]
  }
});

check("普通任务", {
  title: "普通任务",
  patch: {
    dueDate: "",
    startTime: "",
    estimateMinutes: 0,
    categoryId: "",
    priority: "",
    tags: []
  }
});

check("后天 晚上8点 背单词 50m #英语 !低", {
  title: "背单词",
  patch: {
    dueDate: "2026-06-14",
    startTime: "20:00",
    estimateMinutes: 50,
    categoryId: "英语",
    project: "英语",
    priority: "low",
    tags: ["英语"]
  }
});

check("#数学 !高 2h", {
  title: "",
  patch: {
    dueDate: "",
    startTime: "",
    estimateMinutes: 120,
    categoryId: "数学",
    project: "数学",
    priority: "high",
    tags: ["数学"]
  }
});

check("", {
  title: "",
  patch: {
    dueDate: "",
    startTime: "",
    estimateMinutes: 0,
    categoryId: "",
    priority: "",
    tags: []
  }
});

const invalidDate = quickAddParser("2026-99-99 普通任务", options);
assert.equal(invalidDate.title, "普通任务", "invalid date should be removed from title");
assert.equal(invalidDate.patch.dueDate, "", "invalid date should not set dueDate");

assert.doesNotThrow(() => quickAddParser("### !!! 明天 99:99 2x", options));
const noTitle = quickAddParser("明天 19:00 2h #数学 !高", options);
assert.equal(noTitle.title, "", "metadata-only input should have no title");
assert.equal(noTitle.patch.categoryId, "数学");

console.log("quick-add-parser selftest ok");
