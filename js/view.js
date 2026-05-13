const { ItemView, MarkdownRenderer } = require("obsidian");
const { STATUSES, VIEW_TYPE_TASK_KANBAN } = require("./constants");

class TaskKanbanView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tasks = [];
    this.query = "";
    this.activeFileOnly = false;
    this.refreshTimer = 0;
  }

  getViewType() {
    return VIEW_TYPE_TASK_KANBAN;
  }

  getDisplayText() {
    return "Task Kanban";
  }

  getIcon() {
    return "layout-dashboard";
  }

  async onOpen() {
    this.containerEl.addClass("task-kanban-view");
    this.renderShell();
    await this.reload();
  }

  async onClose() {
    window.clearTimeout(this.refreshTimer);
    this.containerEl.empty();
  }

  scheduleReload() {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.reload(), 250);
  }

  renderShell() {
    const content = this.containerEl.children[1];
    content.empty();
    this.rootEl = content.createDiv({ cls: "task-kanban" });

    const toolbar = this.rootEl.createDiv({ cls: "task-kanban-toolbar" });
    const title = toolbar.createDiv({ cls: "task-kanban-title" });
    title.createEl("span", { text: "Task Kanban" });
    this.countEl = title.createEl("small", { text: "0 задач" });

    const controls = toolbar.createDiv({ cls: "task-kanban-controls" });
    this.searchEl = controls.createEl("input", {
      cls: "task-kanban-search",
      attr: { type: "search", placeholder: "Фильтр" }
    });
    this.searchEl.addEventListener("input", () => {
      this.query = this.searchEl.value.trim().toLowerCase();
      this.renderBoard();
    });

    const sortGroup = controls.createDiv({ cls: "task-kanban-sort", attr: { role: "radiogroup", "aria-label": "Сортировка" } });
    this.sortInputs = [];
    [
      ["default", "По умолчанию"],
      ["touched", "Последние"],
      ["priority", "Приоритет"]
    ].forEach(([value, label]) => {
      const option = sortGroup.createEl("label", { cls: "task-kanban-sort-option" });
      const input = option.createEl("input", {
        attr: { type: "radio", name: "task-kanban-side-sort", value }
      });
      input.checked = (this.plugin.taskKanbanSortMode || "default") === value;
      input.addEventListener("change", async () => {
        if (!input.checked) return;
        await this.plugin.setTaskKanbanSortMode(value);
        await this.reload();
      });
      this.sortInputs.push(input);
      option.createSpan({ text: label });
    });

    const scopeButton = controls.createEl("button", {
      cls: "task-kanban-button",
      text: "Текущий файл"
    });
    scopeButton.addEventListener("click", async () => {
      this.activeFileOnly = !this.activeFileOnly;
      scopeButton.toggleClass("is-active", this.activeFileOnly);
      await this.reload();
    });

    const refreshButton = controls.createEl("button", {
      cls: "task-kanban-button",
      text: "Обновить"
    });
    refreshButton.addEventListener("click", () => this.reload());

    this.boardEl = this.rootEl.createDiv({ cls: "task-kanban-board" });
  }

  async reload() {
    this.tasks = await this.plugin.collectTasks(this.activeFileOnly);
    this.renderBoard();
  }

  renderBoard() {
    if (!this.boardEl) return;
    this.boardEl.empty();
    for (const input of this.sortInputs || []) {
      input.checked = input.value === (this.plugin.taskKanbanSortMode || "default");
    }
    const visibleTasks = this.getVisibleTasks();
    this.countEl.setText(`${visibleTasks.length} задач`);

    for (const status of STATUSES) {
      const tasks = visibleTasks.filter((task) => task.status.key === status.key);
      const column = this.boardEl.createDiv({ cls: `task-kanban-column task-kanban-column--${status.key}` });
      const header = column.createDiv({ cls: "task-kanban-column-header" });
      header.createEl("span", { text: status.title });
      header.createEl("small", { text: String(tasks.length) });
      const list = column.createDiv({ cls: "task-kanban-list" });

      if (!tasks.length) {
        list.createDiv({ cls: "task-kanban-empty", text: "Пусто" });
        continue;
      }

      for (const task of tasks) {
        this.renderCard(list, task);
      }
    }
  }

  getVisibleTasks() {
    if (!this.query) return this.tasks;
    return this.tasks.filter((task) => {
      const headingText = typeof task.heading === "string" ? task.heading : task.heading?.text || "";
      const haystack = `${task.text} ${task.file.path} ${headingText}`.toLowerCase();
      return haystack.includes(this.query);
    });
  }

  renderCard(parent, task) {
    const card = parent.createDiv({ cls: "task-kanban-card" });
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      this.plugin.openTask(task);
    });

    const body = card.createDiv({ cls: "task-kanban-card-body" });
    MarkdownRenderer.render(this.app, task.text, body, task.file.path, this);

    const meta = card.createDiv({ cls: "task-kanban-card-meta" });
    meta.createSpan({ cls: "task-kanban-card-file", text: task.file.basename });
    const headingText = typeof task.heading === "string" ? task.heading : task.heading?.text || "";
    if (headingText) meta.createSpan({ cls: "task-kanban-card-heading", text: headingText });
    meta.createSpan({ cls: "task-kanban-card-line", text: `:${task.line + 1}` });

    const actions = card.createDiv({ cls: "task-kanban-card-actions" });
    for (const status of STATUSES) {
      const button = actions.createEl("button", {
        cls: "task-kanban-status-button",
        text: `[${status.marker}]`,
        attr: { title: status.title }
      });
      button.toggleClass("is-active", status.key === task.status.key);
      button.addEventListener("click", async () => {
        await this.plugin.setTaskStatus(task, status);
        await this.reload();
      });
    }
  }
}

module.exports = TaskKanbanView;
