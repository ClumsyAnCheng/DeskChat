const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { _electron: electron } = require("playwright-core");

const rootDir = __dirname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskchat-e2e-"));
const todoFile = path.join(userDataDir, "todos.json");

function readStore() {
  return JSON.parse(fs.readFileSync(todoFile, "utf8"));
}

function byTask(page, title) {
  return page.locator(".todo-item", { hasText: title }).first();
}

function byLifecycleTask(page, title) {
  return page.locator(".todo-lifecycle-item", { hasText: title }).first();
}

async function waitForTodoPage(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      const url = page.url();
      if (url.endsWith("/todo.html") || url.includes("todo.html")) {
        await page.waitForSelector("[data-top-quick]", { timeout: 10000 });
        return page;
      }
    }
    try {
      const page = await app.waitForEvent("window", { timeout: 500 });
      if (page.url().includes("todo.html")) {
        await page.waitForSelector("[data-top-quick]", { timeout: 10000 });
        return page;
      }
    } catch {
      // Keep polling until the Todo window opens.
    }
  }
  throw new Error("Todo window did not open");
}

async function clickView(page, view) {
  if (view === "focus") {
    await page.locator("[data-focus-open]").first().click();
    await page.waitForSelector("[data-focus-form]");
    return;
  }
  await page.locator(`[data-view="${view}"]`).first().click();
  await page.waitForSelector("[data-top-quick]");
}

async function addQuick(page, text) {
  const input = page.locator("[data-top-quick] input[name='title']");
  await input.fill(text);
  await input.press("Enter");
  await page.waitForTimeout(120);
}

async function assertNoInvalidNumbers(page, label) {
  const text = await page.locator("#todoApp").innerText();
  assert.doesNotMatch(text, /\bNaN\b|Infinity/, `${label} should not show NaN or Infinity`);
}

async function main() {
  let app = null;
  try {
    app = await electron.launch({
      executablePath: require("electron"),
      args: [rootDir],
      env: {
        ...process.env,
        DESKCHAT_E2E_AUTO_CONFIRM: "1",
        DESKCHAT_SMOKE_OPEN_TODO: "1",
        DESKCHAT_TEST_USER_DATA: userDataDir
      }
    });

    const page = await waitForTodoPage(app);
    page.setDefaultTimeout(12000);
    const userDataPath = await app.evaluate(({ app: electronApp }) => electronApp.getPath("userData"));
    assert.equal(path.resolve(userDataPath), path.resolve(userDataDir), "E2E must use isolated userData");
    await assertNoInvalidNumbers(page, "initial render");

    await clickView(page, "inbox");
    await addQuick(page, "E2E 编辑任务");
    await byTask(page, "E2E 编辑任务").locator("[data-edit]").click();
    const editor = page.locator("[data-edit-form]").first();
    await editor.locator("input[name='title']").fill("E2E 编辑任务已保存");
    await editor.locator("input[name='project']").fill("英语");
    await editor.locator("select[name='priority']").selectOption("high");
    await editor.locator("input[name='dueDate']").fill("2026-06-20");
    await editor.locator("input[name='estimateMinutes']").fill("45m");
    await editor.locator("input[name='tags']").fill("e2e");
    await editor.locator("button[type='submit']").click();
    await page.waitForTimeout(160);
    let store = readStore();
    const edited = store.todos.find((todo) => todo.title === "E2E 编辑任务已保存");
    assert.ok(edited, "edited task should be saved");
    assert.equal(edited.categoryId, "英语");
    assert.equal(edited.priority, "high");
    assert.equal(edited.dueDate, "2026-06-20");

    await clickView(page, "inbox");
    await addQuick(page, "E2E 删除任务");
    await byTask(page, "E2E 删除任务").locator("[data-delete]").click();
    await clickView(page, "trash");
    await byLifecycleTask(page, "E2E 删除任务").locator("[data-archived-delete]").click();
    await page.waitForTimeout(160);
    store = readStore();
    assert.equal(store.todos.some((todo) => todo.title === "E2E 删除任务"), false, "deleted task should be removed");

    await clickView(page, "today");
    await addQuick(page, "E2E 生命周期任务");
    await byTask(page, "E2E 生命周期任务").locator(".todo-check span").click();
    await clickView(page, "completed");
    await byLifecycleTask(page, "E2E 生命周期任务").locator("[data-completed-archive]").click();
    await clickView(page, "trash");
    await byLifecycleTask(page, "E2E 生命周期任务").locator("[data-archived-restore]").click();
    await clickView(page, "today");
    await page.locator(".todo-item", { hasText: "E2E 生命周期任务" }).first().waitFor();

    await addQuick(page, "E2E 普通 QuickAdd");
    await addQuick(page, "明天 19:00 E2E 数学真题 2h #数学 !高");
    await addQuick(page, "今天 E2E 英语阅读 30m #英语");
    await addQuick(page, "E2E 无日期任务 #408 !中");
    store = readStore();
    const math = store.todos.find((todo) => todo.title === "E2E 数学真题");
    assert.ok(math, "dated categorized quick-add task should exist");
    assert.equal(math.startTime, "19:00");
    assert.equal(math.estimateMinutes, 120);
    assert.equal(math.categoryId, "数学");
    assert.equal(math.priority, "high");
    const english = store.todos.find((todo) => todo.title === "E2E 英语阅读");
    assert.equal(english.categoryId, "英语");
    assert.equal(english.estimateMinutes, 30);

    await clickView(page, "recent");
    await addQuick(page, "2000-01-01 E2E 过期任务");
    await addQuick(page, "E2E 最近无日期任务");
    await clickView(page, "recent");
    await page.locator("[data-recent-reschedule-overdue]").click();
    await page.locator("[data-recent-schedule-undated]").click();

    await clickView(page, "calendar");
    await page.locator("[data-calendar-next]").click();
    await page.locator("[data-calendar-prev]").click();
    await page.locator("[data-calendar-day]").first().click();
    await assertNoInvalidNumbers(page, "calendar");

    await page.locator('[data-category-nav="数学"]').click();
    await page.locator("h1", { hasText: "分类：数学" }).waitFor();
    await addQuick(page, "E2E 分类页任务");
    store = readStore();
    assert.ok(store.todos.some((todo) => todo.title === "E2E 分类页任务" && todo.categoryId === "数学"), "category page quick add should inherit category");

    await clickView(page, "goals");
    const goalForm = page.locator("[data-goal-form]").first();
    await goalForm.locator("input[name='title']").fill("E2E 八月底完成 30 套试卷");
    await goalForm.locator("input[name='categoryId']").fill("数学");
    await goalForm.locator("input[name='deadline']").fill("2026-08-31");
    await goalForm.locator("input[name='targetCount']").fill("30");
    await goalForm.locator("input[name='currentCount']").fill("3");
    await goalForm.locator("button[type='submit']").click();
    await page.locator(".todo-goal-card", { hasText: "E2E 八月底完成 30 套试卷" }).waitFor();
    await page.locator(".todo-goal-card", { hasText: "E2E 八月底完成 30 套试卷" }).locator("[data-goal-breakdown]").click();
    const createWeek = page.locator("[data-goal-create-week-tasks]").first();
    if (await createWeek.isEnabled()) await createWeek.click();
    await page.locator("[data-goal-task-form]").first().locator("input[name='title']").fill("E2E 目标关联任务");
    await page.locator("[data-goal-task-form]").first().locator("button[type='submit']").click();
    store = readStore();
    assert.ok(store.goals.some((goal) => goal.title === "E2E 八月底完成 30 套试卷"), "goal should be created");
    assert.ok(store.todos.some((todo) => todo.title === "E2E 目标关联任务"), "goal task should be created");

    await clickView(page, "focus");
    const focusTodoId = await page.locator("[data-focus-form] select[name='todoId']").evaluate((select) => {
      const option = Array.from(select.options).find((item) => item.textContent.includes("E2E"));
      return option ? option.value : "";
    });
    assert.ok(focusTodoId, "focus form should offer an E2E task");
    await page.locator("[data-focus-form] select[name='todoId']").selectOption(focusTodoId);
    await page.locator("[data-focus-form] input[name='focusMinutes']").fill("1");
    await page.locator("[data-focus-form] button[type='submit']").click();
    await page.locator("[data-focus-pause]").first().click();
    await page.locator("[data-focus-resume]").first().click();
    await page.locator("[data-focus-complete]").first().click();
    await page.locator("[data-focus-form] button[type='submit']").click();
    await page.locator("[data-focus-abandon]").first().click();
    store = readStore();
    assert.ok(store.focusSessions.some((session) => session.status === "completed"), "completed focus session should be recorded");
    assert.ok(store.focusSessions.some((session) => session.status === "abandoned"), "abandoned focus session should be recorded");

    await clickView(page, "review");
    const reviewForm = page.locator("[data-review-form]").first();
    await reviewForm.locator("textarea[name='wins']").fill("E2E 完成了主要链路");
    await reviewForm.locator("textarea[name='nextActions']").fill("继续复盘统计刷新");
    await reviewForm.locator("button[type='submit']").click();
    await assertNoInvalidNumbers(page, "review");

    await page.reload();
    await page.waitForSelector("[data-top-quick]");
    await page.locator("#todoApp", { hasText: "顶部快速输入" }).waitFor();
    await clickView(page, "today");
    await page.locator(".todo-item", { hasText: "E2E 生命周期任务" }).first().waitFor();
    await assertNoInvalidNumbers(page, "after reload");

    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator("[data-sidebar-toggle]").click();
    await page.locator(".todo-app-sidebar.collapsed").waitFor();
    await page.locator("[data-sidebar-toggle]").click();
    await page.locator(".todo-app-sidebar:not(.collapsed)").waitFor();
    await page.setViewportSize({ width: 1200, height: 900 });

    await page.locator(".todo-focus-player").waitFor({ state: "attached" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const playerBox = await page.locator(".todo-focus-player").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        top: rect.top,
        bottom: rect.bottom,
        viewportHeight: window.innerHeight
      };
    });
    assert.ok(playerBox.width > 0 && playerBox.height > 0, "focus player should be measurable");
    assert.ok(playerBox.bottom <= playerBox.viewportHeight + 2, "focus player should fit in viewport");

    console.log(`todo e2e ok (${userDataDir})`);
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
