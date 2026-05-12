const { ItemView, MarkdownRenderer, Notice, Plugin, TFile } = require("obsidian");

const VIEW_TYPE_TASK_KANBAN = "task-kanban-view";
const KANBAN_START = "<!-- task-kanban:start -->";
const KANBAN_END = "<!-- task-kanban:end -->";

const STATUSES = [
  { key: "open", marker: " ", title: "Открытые", icon: "⬜", aliases: ["", " "] },
  { key: "progress", marker: "/", title: "В процессе", icon: "🔄", aliases: ["/"] },
  { key: "done", marker: "x", title: "Закрытые", icon: "✅", aliases: ["x", "X"] },
  { key: "canceled", marker: "-", title: "Отмененные", icon: "❌", aliases: ["-"] },
  { key: "proposal", marker: "?", title: "Предложено", icon: "💡", aliases: ["?"] }
];

const STATUS_BY_MARKER = new Map(
  STATUSES.flatMap((status) => status.aliases.map((alias) => [alias, status]))
);

const TASK_LINE_RE = /^(\s*)[-*]\s+\[([^\]]*)\]\s+(.*)$/;
const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;

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
      const haystack = `${task.text} ${task.file.path} ${task.heading}`.toLowerCase();
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
    if (task.heading) meta.createSpan({ cls: "task-kanban-card-heading", text: task.heading });
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

module.exports = class TaskKanbanPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE_TASK_KANBAN, (leaf) => new TaskKanbanView(leaf, this));

    this.addRibbonIcon("layout-dashboard", "Task Kanban", () => this.activateView());

    this.addCommand({
      id: "open-task-kanban",
      name: "Open Task Kanban",
      callback: () => this.activateView()
    });

    this.addCommand({
      id: "insert-current-file-kanban",
      name: "Insert/update Kanban in current file",
      editorCallback: () => this.insertKanbanIntoCurrentFile()
    });

    this.registerMarkdownPostProcessor((element, context) => {
      for (const card of element.querySelectorAll(".task-kanban-inline-card[data-href]")) {
        card.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const href = card.getAttribute("data-href");
          if (href) this.app.workspace.openLinkText(href, context.sourcePath, false);
        });
      }
      for (const button of element.querySelectorAll(".task-kanban-inline-action[data-action]")) {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const action = button.getAttribute("data-action");
          const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
          if (!(file instanceof TFile)) return;
          if (action === "refresh") await this.insertKanbanIntoFile(file);
          if (action === "delete") await this.deleteKanbanFromFile(file);
        });
      }
    });

    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.refreshOpenViews();
    }));
    this.registerEvent(this.app.vault.on("create", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.refreshOpenViews();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.refreshOpenViews();
    }));
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_KANBAN);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_KANBAN)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TASK_KANBAN, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshOpenViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_KANBAN)) {
      leaf.view.scheduleReload?.();
    }
  }

  async collectTasks(activeFileOnly) {
    const activeFile = this.app.workspace.getActiveFile();
    const files = activeFileOnly && activeFile
      ? [activeFile]
      : this.app.vault.getMarkdownFiles();
    const results = [];

    for (const file of files) {
      const text = await this.app.vault.cachedRead(file);
      results.push(...this.scanTasksInContent(file, text));
    }

    return results.sort((a, b) => {
      const statusDiff = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
      if (statusDiff) return statusDiff;
      return a.file.path.localeCompare(b.file.path) || a.line - b.line;
    });
  }

  scanTasksInContent(file, content) {
    const lines = content.split(/\r?\n/);
    const tasks = [];
    let heading = "";
    let insideGeneratedKanban = false;

    for (let line = 0; line < lines.length; line++) {
      const raw = lines[line];
      if (raw.trim() === KANBAN_START) {
        insideGeneratedKanban = true;
        continue;
      }
      if (raw.trim() === KANBAN_END) {
        insideGeneratedKanban = false;
        continue;
      }
      if (insideGeneratedKanban) continue;

      const headingMatch = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (headingMatch) heading = headingMatch[2].trim();

      const taskMatch = raw.match(TASK_LINE_RE);
      if (!taskMatch) continue;
      const marker = taskMatch[2];
      const status = STATUS_BY_MARKER.get(marker) || STATUSES[0];
      const rawText = taskMatch[3].trim();
      const blockId = rawText.match(BLOCK_ID_RE)?.[1] || "";
      tasks.push({
        file,
        line,
        raw,
        indent: taskMatch[1] || "",
        marker,
        blockId,
        text: rawText.replace(BLOCK_ID_RE, "").trim(),
        status,
        heading
      });
    }

    return tasks;
  }

  async insertKanbanIntoCurrentFile() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Нет активного файла");
      return;
    }

    await this.insertKanbanIntoFile(file);
  }

  async insertKanbanIntoFile(file) {
    await this.app.vault.process(file, (content) => {
      const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
      const tasks = this.scanTasksInContent(file, contentWithBlockIds);
      const block = this.buildKanbanBlock(file, tasks);
      return this.replaceOrInsertKanbanBlock(contentWithBlockIds, block);
    });
    new Notice("Kanban обновлен");
  }

  async deleteKanbanFromFile(file) {
    await this.app.vault.process(file, (content) => this.removeKanbanBlock(content));
    new Notice("Kanban удален");
  }

  buildKanbanBlock(file, tasks) {
    const columns = STATUSES.map((status) => {
      const items = tasks.filter((task) => task.status.key === status.key);
      const marker = "<span class=\"task-kanban-inline-marker\"></span>";
      const content = items.length
        ? items.map((task) => this.formatKanbanCellItem(task)).join("")
        : "<span class=\"task-kanban-inline-empty\">Пусто</span>";
      const body = `${marker}<div class="task-kanban-inline-column">${content}</div>`;
      return {
        title: `${status.icon} ${status.title} (${items.length})`,
        body
      };
    });

    const calloutActions = '<span class="task-kanban-inline-title-actions"><button class="task-kanban-inline-action" data-action="refresh">Обновить</button><button class="task-kanban-inline-action task-kanban-inline-action--danger" data-action="delete">Удалить</button></span>';
    const calloutLines = [
      `[!task-kanban]+ Task Kanban ${calloutActions}`,
      "",
      `| ${columns.map((column) => column.title).join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      `| ${columns.map((column) => column.body).join(" | ")} |`
    ];

    return [
      KANBAN_START,
      "",
      ...calloutLines.map((line) => line ? `> ${line}` : ">"),
      "",
      KANBAN_END
    ].join("\n");
  }

  formatKanbanCellItem(task) {
    const heading = task.heading
      ? `<span class="task-kanban-inline-heading">${this.escapeTableText(task.heading)}</span>`
      : "";
    const attrs = task.blockId
      ? ` data-href="#^${this.escapeAttribute(task.blockId)}" role="link" tabindex="0"`
      : "";
    return `<div class="task-kanban-inline-card"${attrs}>${heading}<span class="task-kanban-inline-text">${this.escapeTableText(task.text)}</span></div>`;
  }

  escapeTableText(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\|/g, "&#124;")
      .replace(/\r?\n/g, " ");
  }

  escapeMarkdownLinkLabel(value) {
    return this.escapeTableText(value)
      .replace(/\\/g, "\\\\")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");
  }

  escapeAttribute(value) {
    return this.escapeTableText(value).replace(/"/g, "&quot;");
  }

  escapeMarkdownInline(value) {
    return this.escapeTableText(value)
      .replace(/\\/g, "\\\\")
      .replace(/\*/g, "\\*")
      .replace(/_/g, "\\_")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]");
  }

  ensureTaskBlockIds(file, content) {
    const lines = content.split(/\r?\n/);
    const usedIds = new Set();
    let insideGeneratedKanban = false;

    for (const line of lines) {
      const id = line.match(BLOCK_ID_RE)?.[1];
      if (id) usedIds.add(id);
    }

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const raw = lines[lineNo];
      if (raw.trim() === KANBAN_START) {
        insideGeneratedKanban = true;
        continue;
      }
      if (raw.trim() === KANBAN_END) {
        insideGeneratedKanban = false;
        continue;
      }
      if (insideGeneratedKanban) continue;

      const taskMatch = raw.match(TASK_LINE_RE);
      if (!taskMatch || BLOCK_ID_RE.test(taskMatch[3])) continue;
      const id = this.createUniqueBlockId(file, lineNo, taskMatch[3], usedIds);
      usedIds.add(id);
      lines[lineNo] = `${raw} ^${id}`;
    }

    return lines.join("\n");
  }

  createUniqueBlockId(file, lineNo, text, usedIds) {
    const base = `tk-${this.hashString(`${file.path}\n${lineNo}\n${text}`).slice(0, 10)}`;
    let id = base;
    let index = 2;
    while (usedIds.has(id)) {
      id = `${base}-${index}`;
      index++;
    }
    return id;
  }

  hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  replaceOrInsertKanbanBlock(content, block) {
    const startIndex = content.indexOf(KANBAN_START);
    const endIndex = content.indexOf(KANBAN_END);
    if (startIndex >= 0 && endIndex > startIndex) {
      const before = content.slice(0, startIndex).replace(/\s*$/, "\n\n");
      const after = content.slice(endIndex + KANBAN_END.length).replace(/^\s*/, "\n\n");
      return `${before}${block}${after}`.replace(/\s+$/, "\n");
    }

    const lines = content.split(/\r?\n/);
    const insertIndex = this.findTopInsertIndex(lines);
    lines.splice(insertIndex, 0, block, "");
    return lines.join("\n").replace(/\s+$/, "\n");
  }

  removeKanbanBlock(content) {
    const startIndex = content.indexOf(KANBAN_START);
    const endIndex = content.indexOf(KANBAN_END);
    if (startIndex < 0 || endIndex <= startIndex) return content;
    const before = content.slice(0, startIndex).replace(/\s*$/, "\n\n");
    const after = content.slice(endIndex + KANBAN_END.length).replace(/^\s*/, "");
    return `${before}${after}`.replace(/\s+$/, "\n");
  }

  findTopInsertIndex(lines) {
    if (lines[0]?.trim() !== "---") return 0;
    const endIndex = lines.findIndex((line, index) => index > 0 && /^(\.\.\.|---)\s*$/.test(line.trim()));
    if (endIndex < 0) return 0;
    let insertIndex = endIndex + 1;
    while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex++;
    return insertIndex;
  }

  async setTaskStatus(task, status) {
    await this.app.vault.process(task.file, (content) => {
      const lines = content.split(/\r?\n/);
      const line = lines[task.line] || "";
      const nextLine = line.replace(TASK_LINE_RE, `$1- [${status.marker}] $3`);
      if (nextLine === line) return content;
      lines[task.line] = nextLine;
      return lines.join("\n");
    });
  }

  async openTask(task) {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(task.file, { active: true });
    const view = leaf.view;
    if (view?.editor) {
      view.editor.setCursor({ line: task.line, ch: 0 });
      view.editor.scrollIntoView({ from: { line: task.line, ch: 0 }, to: { line: task.line, ch: 0 } }, true);
    }
  }
};
