const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = __dirname;
const source = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "deskchat-todo-store-"));

const windows = [];
const app = {
  commandLine: { appendSwitch() {} },
  disableHardwareAcceleration() {},
  getPath(name) {
    if (name === "userData") return tmpRoot;
    return tmpRoot;
  },
  isPackaged: false,
  on() {},
  quit() {},
  setPath() {},
  whenReady() {
    return { then() {} };
  }
};

class FakeBrowserWindow {
  static fromWebContents() {
    return null;
  }

  static getAllWindows() {
    return windows;
  }

  static getFocusedWindow() {
    return null;
  }
}

function fakeRequire(id) {
  if (id === "electron") {
    return {
      app,
      BrowserWindow: FakeBrowserWindow,
      clipboard: { writeText() {} },
      desktopCapturer: { getSources: async () => [] },
      dialog: { showMessageBox: async () => ({ response: 0 }) },
      ipcMain: { handle() {} },
      nativeImage: {
        createFromBuffer() {
          return {
            isEmpty: () => true,
            resize() { return this; },
            toDataURL: () => "",
            getSize: () => ({ width: 0, height: 0 })
          };
        }
      },
      screen: { getPrimaryDisplay: () => ({ workArea: { width: 1200, height: 800 } }) },
      shell: { openPath: async () => "", openExternal: async () => {} },
      Menu: { buildFromTemplate: () => ({}), setApplicationMenu() {} }
    };
  }
  if (id === "markmap-lib") return { Transformer: class {} };
  if (id === "mammoth") return {};
  if (id === "xlsx") return {};
  if (id === "pdf-parse") return { PDFParse: class {} };
  return require(id);
}

const context = vm.createContext({
  Buffer,
  URL,
  console,
  fetch: async () => ({ ok: false, text: async () => "", json: async () => ({}) }),
  process: { ...process, env: { ...process.env } },
  require: fakeRequire,
  setTimeout,
  clearTimeout
});

try {
  vm.runInContext(source, context, { filename: "main.js" });

  const createTodo = context.createTodo;
  const readTodoStore = context.readTodoStore;
  const saveTodo = context.saveTodo;
  const deleteTodo = context.deleteTodo;
  const saveTodoCategory = context.saveTodoCategory;
  const renameTodoCategory = context.renameTodoCategory;
  const deleteTodoCategory = context.deleteTodoCategory;
  const saveTodoGoal = context.saveTodoGoal;
  const archiveTodoGoal = context.archiveTodoGoal;
  const startTodoTimer = context.startTodoTimer;
  const pauseTodoTimer = context.pauseTodoTimer;
  const resumeTodoTimer = context.resumeTodoTimer;
  const completeTodoTimer = context.completeTodoTimer;
  const abandonTodoTimer = context.abandonTodoTimer;

  assert.equal(typeof createTodo, "function", "main Todo functions should be available in the VM");

  let store = createTodo({
    title: "持久化任务",
    categoryId: "数学",
    project: "数学",
    dueDate: "2026-06-12",
    priority: "high"
  });
  const todo = store.todos[0];
  const todoFile = path.join(tmpRoot, "todos.json");
  assert.ok(fs.existsSync(todoFile), "creating a task should write todos.json");
  assert.equal(readTodoStore().todos[0].title, "持久化任务", "readTodoStore should reload tasks from disk");

  store = saveTodo({ id: todo.id, title: "持久化任务已编辑", status: "done", completed: true });
  assert.equal(store.todos[0].status, "done", "saveTodo should complete tasks");
  assert.equal(readTodoStore().todos[0].title, "持久化任务已编辑", "edited tasks should persist to disk");

  saveTodoCategory({ name: "物理" });
  store = renameTodoCategory({ oldName: "物理", newName: "化学" });
  assert.ok(store.categories.some((category) => category.name === "化学"), "renamed categories should persist");
  store = deleteTodoCategory("化学");
  assert.ok(!store.categories.some((category) => category.name === "化学"), "deleted categories should persist");

  store = saveTodoGoal({ title: "持久化目标", categoryId: "数学", targetCount: 10, currentCount: 3 });
  const goal = store.goals[0];
  store = archiveTodoGoal(goal.id);
  assert.equal(store.goals[0].status, "archived", "goal archive should persist");

  store = createTodo({ title: "番茄持久化", categoryId: "408", project: "408" });
  const focusTodo = store.todos[0];
  store = startTodoTimer(focusTodo.id, 25);
  assert.equal(store.focusTimer.status, "running", "focus timer should persist running state");
  store = pauseTodoTimer();
  assert.equal(store.focusTimer.status, "paused", "focus timer should persist paused state");
  store = resumeTodoTimer();
  assert.equal(store.focusTimer.status, "running", "focus timer should persist resumed state");
  store = completeTodoTimer();
  assert.equal(store.focusSessions.at(-1).status, "completed", "completed timers should write FocusSession");
  store = startTodoTimer(focusTodo.id, 25);
  store = abandonTodoTimer();
  assert.equal(store.focusSessions.at(-1).status, "abandoned", "abandoned timers should write FocusSession");

  const goalCount = store.goals.length;
  const focusCount = store.focusSessions.length;
  store = deleteTodo(focusTodo.id);
  assert.equal(store.goals.length, goalCount, "deleting tasks should keep goals");
  assert.equal(store.focusSessions.length, focusCount, "deleting tasks should keep focus sessions");
  assert.equal(readTodoStore().focusSessions.length, focusCount, "focus sessions should survive reload from disk");

  console.log("main-todo-store selftest ok");
} finally {
  if (tmpRoot.startsWith(os.tmpdir())) fs.rmSync(tmpRoot, { recursive: true, force: true });
}
