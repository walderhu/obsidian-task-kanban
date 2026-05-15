"use strict";
// Generated from js/ by scripts/build-main.js. Edit js/*, then rebuild this file.
(function() {
  const __modules = {
  "js/constants": function(module, exports, require) {
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
    const STATUS_BY_KEY = new Map(STATUSES.map((status) => [status.key, status]));
    const STATUS_BY_ICON = new Map(STATUSES.map((status) => [status.icon, status]));
    const SUBTASK_STATUS_CYCLE = ["open", "progress", "done"].map((key) => STATUS_BY_KEY.get(key));
    const TASK_KANBAN_DRAG_MIME = "application/x-task-kanban-block-id";
    const INLINE_KANBAN_REFRESH_DELAY = 1800;
    const INLINE_KANBAN_EDITOR_REFRESH_DELAY = 650;
    const INLINE_KANBAN_CHECKBOX_REFRESH_DELAY = 120;
    
    const TASK_LINE_RE = /^(\s*)[-*]\s+\[([^\]]*)\]\s+(.*)$/;
    const BLOCK_ID_RE = /\s+\^([A-Za-z0-9-]+)\s*$/;
    
    module.exports = {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    };
    
  },
  "js/view": function(module, exports, require) {
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
    
  },
  "js/plugin": function(module, exports, require) {
    const { MarkdownView, Notice, Plugin, TFile } = require("obsidian");
    const TaskKanbanView = require("./view");
    const {
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      TASK_KANBAN_DRAG_MIME,
      VIEW_TYPE_TASK_KANBAN
    } = require("./constants");
    
    class TaskKanbanPlugin extends Plugin {
    async onload() {
      this.inlineKanbanRefreshTimers = new Map();
      this.inlineKanbanRefreshInProgress = new Set();
      this.inlineKanbanRenderedElements = new Map();
      this.inlineKanbanExpandedBlockIds = new Map();
      const savedData = await this.loadData();
      this.inlineKanbanHeadingFilters = savedData?.headingFilters || {};
      this.taskKanbanSortMode = savedData?.sortMode || "default";
      this.taskKanbanTouchedAt = savedData?.touchedAt || {};
    
      this.registerView(VIEW_TYPE_TASK_KANBAN, (leaf) => new TaskKanbanView(leaf, this));
    
      this.addRibbonIcon("layout-dashboard", "Task Kanban", () => this.activateView());
    
      this.addCommand({
        id: "insert-current-file-kanban",
        name: "Insert/update Kanban in current file",
        editorCallback: () => this.insertKanbanIntoCurrentFile()
      });
    
      this.addCommand({
        id: "cycle-editor-task-checkbox",
        name: "Cycle task checkbox under cursor",
        editorCallback: (editor) => this.cycleEditorTaskCheckbox(editor)
      });
    
      this.registerMarkdownPostProcessor(async (element, context) => {
        const sourceFile = this.app.vault.getAbstractFileByPath(context.sourcePath);
        element.dataset.taskKanbanSourcePath = context.sourcePath;
        if (sourceFile instanceof TFile) {
          this.trackInlineKanbanElement(sourceFile, element);
          await this.syncInlineKanbanDom(element, sourceFile);
          this.syncInlineReadonlyState(element, context.sourcePath);
          this.bindInlineKanbanDelegates(element, context.sourcePath);
        }
    
        for (const column of element.querySelectorAll(".task-kanban-inline-column")) {
          const columnStatus = this.getInlineColumnStatus(column);
          if (columnStatus && !column.hasAttribute("data-status-key")) {
            column.setAttribute("data-status-key", columnStatus.key);
          }
          column.addEventListener("dragover", (event) => {
            if (!this.canEditInlineKanban(context.sourcePath)) return;
            if (!Array.from(event.dataTransfer?.types || []).includes(TASK_KANBAN_DRAG_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            column.classList.add("is-drag-over");
          });
          column.addEventListener("dragleave", (event) => {
            if (!column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
          });
          column.addEventListener("drop", async (event) => {
            if (!this.canEditInlineKanban(context.sourcePath)) return;
            const blockId = event.dataTransfer?.getData(TASK_KANBAN_DRAG_MIME);
            const status = this.getInlineColumnStatus(column);
            if (!blockId || !status) return;
            event.preventDefault();
            event.stopPropagation();
            column.classList.remove("is-drag-over");
            const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
            if (!(file instanceof TFile)) return;
            const openView = this.findOpenMarkdownView(file);
            const savedScroll = openView?.editor?.getScrollInfo?.();
            await this.setInlineTaskStatus(file, blockId, status, true, true);
            if (savedScroll && openView?.editor?.scrollTo) {
              window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
                openView.editor.scrollTo?.(savedScroll.left, savedScroll.top);
              }));
            }
            this.scheduleInlineKanbanRefresh(file, INLINE_KANBAN_CHECKBOX_REFRESH_DELAY);
          });
        }
        for (const card of element.querySelectorAll(".task-kanban-inline-card")) {
          if (this.canEditInlineKanban(context.sourcePath) && this.getInlineBlockId(card)) {
            card.setAttribute("draggable", "true");
          } else {
            card.removeAttribute("draggable");
          }
          card.addEventListener("dragstart", (event) => {
            if (!this.canEditInlineKanban(context.sourcePath)) {
              event.preventDefault();
              return;
            }
            if (event.target.closest(".task-kanban-inline-subtask")) {
              event.preventDefault();
              return;
            }
            const blockId = this.getInlineBlockId(card);
            if (!blockId || !event.dataTransfer) return;
            event.dataTransfer.setData(TASK_KANBAN_DRAG_MIME, blockId);
            event.dataTransfer.effectAllowed = "move";
            card.classList.add("is-dragging");
          });
          card.addEventListener("dragend", () => {
            card.classList.remove("is-dragging");
            for (const column of element.querySelectorAll(".task-kanban-inline-column.is-drag-over")) {
              column.classList.remove("is-drag-over");
            }
          });
        }
        for (const button of element.querySelectorAll(".task-kanban-inline-subtask-status")) {
          button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!this.canEditInlineKanban(context.sourcePath)) return;
            const subtask = button.closest(".task-kanban-inline-subtask");
            await this.toggleInlineSubtaskStatus(subtask, context.sourcePath);
          });
        }
        for (const card of element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask")) {
          card.addEventListener("click", async (event) => {
            if (event.target.closest("button")) return;
            event.preventDefault();
            event.stopPropagation();
            if (card.classList.contains("task-kanban-inline-subtask")) {
              if (!this.canEditInlineKanban(context.sourcePath)) return;
              await this.toggleInlineSubtaskStatus(card, context.sourcePath);
              return;
            }
            if (card.classList.contains("has-overflowing-text")) this.toggleInlineCardText(card);
            this.toggleInlineSubtasks(card);
          });
        }
        for (const button of element.querySelectorAll(".task-kanban-inline-subtasks-toggle")) {
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const card = button.closest(".task-kanban-inline-card, .task-kanban-inline-subtask");
            if (card) this.toggleInlineSubtasks(card);
          });
        }
        for (const button of element.querySelectorAll(".task-kanban-inline-hidden-toggle")) {
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const callout = button.closest(".callout");
            if (!callout) return;
            const expanded = !callout.classList.contains("task-kanban-show-hidden-columns");
            callout.classList.toggle("task-kanban-show-hidden-columns", expanded);
            button.classList.toggle("is-active", expanded);
            button.setAttribute("aria-pressed", String(expanded));
            button.textContent = expanded ? "Скрыть доп." : "Доп.";
          });
        }
        for (const button of element.querySelectorAll(".task-kanban-inline-action[data-action]")) {
          button.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const action = button.getAttribute("data-action");
            const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
            if (!(file instanceof TFile)) return;
            if (!this.canEditInlineKanban(context.sourcePath)) return;
            if (action === "refresh") {
              await this.insertKanbanIntoFile(file, false);
              await this.refreshInlineKanbanView(file, element);
              // After Obsidian re-renders the file the old element is replaced; sync the new one
              window.setTimeout(() => this.scheduleInlineKanbanRefresh(file, 0), 600);
            }
            if (action === "delete" && window.confirm("Точно удалить Kanban?")) {
              await this.deleteKanbanFromFile(file);
            }
          });
        }
      });
    
      // Чекбоксы в редакторе — обновляют канбан сразу.
      // Фоновые события (modify, metadataCache, editor-change) отключены — не лагают при старте.
      // Новые задачи подхватываются только через кнопку "Обновить".
      this.registerDomEvent(document, "click", (event) => {
        this.handleEditorCheckboxEvent(event);
      }, true);
      this.registerDomEvent(document, "change", (event) => {
        this.handleEditorCheckboxEvent(event);
      }, true);
      this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
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
      for (const timer of this.inlineKanbanRefreshTimers?.values?.() || []) {
        window.clearTimeout(timer);
      }
      this.inlineKanbanRefreshTimers?.clear?.();
      this.inlineKanbanRefreshInProgress?.clear?.();
      this.inlineKanbanRenderedElements?.clear?.();
      this.inlineKanbanExpandedBlockIds?.clear?.();
      this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_KANBAN);
    }
    }
    
    Object.assign(
      TaskKanbanPlugin.prototype,
      require("./plugin/state"),
      require("./plugin/inline-status"),
      require("./plugin/workspace"),
      require("./plugin/inline-delegates"),
      require("./plugin/inline-dom"),
      require("./plugin/inline-refresh"),
      require("./plugin/tasks"),
      require("./plugin/markdown-block"),
      require("./plugin/format"),
      require("./plugin/block-ids"),
      require("./plugin/editor-checkbox"),
      require("./plugin/task-actions")
    );
    
    module.exports = TaskKanbanPlugin;
    
  },
  "js/plugin/state": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async savePluginData() {
      await this.saveData({
        headingFilters: this.inlineKanbanHeadingFilters || {},
        sortMode: this.taskKanbanSortMode || "default",
        touchedAt: this.taskKanbanTouchedAt || {}
      });
    },
    
    async setTaskKanbanSortMode(sortMode) {
      this.taskKanbanSortMode = ["default", "touched", "priority"].includes(sortMode)
        ? sortMode
        : "default";
      await this.savePluginData();
      this.refreshOpenViews();
    },
    
    getTaskTouchedKey(task) {
      if (!task?.file?.path) return "";
      if (task.blockId) return `${task.file.path}#${task.blockId}`;
      return `${task.file.path}:${task.line}:${this.hashString(task.raw || task.text || "")}`;
    },
    
    async rememberTaskTouched(task) {
      const key = this.getTaskTouchedKey(task);
      if (!key) return;
      this.taskKanbanTouchedAt ||= {};
      this.taskKanbanTouchedAt[key] = Date.now();
      await this.savePluginData();
    },
    
    sortTasksForKanban(tasks) {
      const items = [...tasks];
      const baseCompare = (a, b) => {
        const statusDiff = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
        if (statusDiff) return statusDiff;
        return a.file.path.localeCompare(b.file.path) || a.line - b.line;
      };
      const sortMode = this.taskKanbanSortMode || "default";
      return items.sort((a, b) => {
        if (sortMode === "touched") {
          const touchedDiff = (this.taskKanbanTouchedAt?.[this.getTaskTouchedKey(b)] || 0)
            - (this.taskKanbanTouchedAt?.[this.getTaskTouchedKey(a)] || 0);
          if (touchedDiff) return touchedDiff;
        }
        if (sortMode === "priority") {
          const priorityDiff = (b.priority || 0) - (a.priority || 0);
          if (priorityDiff) return priorityDiff;
        }
        return baseCompare(a, b);
      });
    },
    
    toggleInlineSubtasks(card) {
      const subtasks = Array.from(card.children)
        .find((child) => child.classList?.contains("task-kanban-inline-subtasks"));
      if (!subtasks) return;
    
      const expanded = !card.classList.contains("is-expanded");
      card.classList.toggle("is-expanded", expanded);
      this.rememberInlineExpandedState(card, expanded);
      const button = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-subtasks-toggle");
      if (button) {
        button.setAttribute("aria-expanded", String(expanded));
        button.textContent = expanded ? "⌄" : "›";
      }
      this.updateInlineExpandToggle(card.closest("[data-task-kanban-source-path]") || card);
    },
    
    rememberInlineExpandedState(card, expanded) {
      const blockId = this.getInlineBlockId(card);
      const sourcePath = card.closest("[data-task-kanban-source-path]")?.dataset?.taskKanbanSourcePath;
      if (!blockId || !sourcePath) return;
      let expandedBlockIds = this.inlineKanbanExpandedBlockIds.get(sourcePath);
      if (!expandedBlockIds) {
        expandedBlockIds = new Set();
        this.inlineKanbanExpandedBlockIds.set(sourcePath, expandedBlockIds);
      }
      if (expanded) {
        expandedBlockIds.add(blockId);
      } else {
        expandedBlockIds.delete(blockId);
      }
    },
    
    getNextStatus(status) {
      const index = STATUSES.indexOf(status);
      return STATUSES[(index + 1) % STATUSES.length];
    },
    
    getNextSubtaskStatus(status) {
      if (status?.key === "canceled") return null;
      const index = SUBTASK_STATUS_CYCLE.indexOf(status);
      if (index < 0) return SUBTASK_STATUS_CYCLE[0];
      return SUBTASK_STATUS_CYCLE[(index + 1) % SUBTASK_STATUS_CYCLE.length];
    },
    
    isSourcePathInEditMode(sourcePath) {
      const leaf = this.app.workspace.getLeavesOfType("markdown").find(
        (l) => l.view instanceof MarkdownView && l.view.file?.path === sourcePath
      );
      return leaf?.view?.getMode?.() === "source";
    },
    
    canEditInlineKanban(sourcePath) {
      return this.isSourcePathInEditMode(sourcePath);
    },
    
    syncInlineReadonlyState(element, sourcePath) {
      const canEdit = this.canEditInlineKanban(sourcePath);
      element.classList.toggle("task-kanban-inline-readonly", !canEdit);
      element.toggleAttribute("data-task-kanban-readonly", !canEdit);
      for (const card of element.querySelectorAll(".task-kanban-inline-card")) {
        if (canEdit && this.getInlineBlockId(card)) {
          card.setAttribute("draggable", "true");
        } else {
          card.removeAttribute("draggable");
          card.classList.remove("is-dragging");
        }
      }
      for (const column of element.querySelectorAll(".task-kanban-inline-column.is-drag-over")) {
        column.classList.remove("is-drag-over");
      }
    },
    
    updateInlineStatusButton(button, status) {
      if (!status) {
        button.removeAttribute("data-status-key");
        button.setAttribute("title", "Обычный пункт");
        button.textContent = "•";
        return;
      }
      button.setAttribute("data-status-key", status.key);
      button.setAttribute("title", status.title);
      button.textContent = status.icon;
    },
    
    getInlineColumnStatus(column) {
      const status = STATUS_BY_KEY.get(column?.getAttribute("data-status-key"));
      if (status) return status;
      const cell = column?.closest("td, th");
      if (!cell || typeof cell.cellIndex !== "number") return null;
      return STATUSES[cell.cellIndex] || null;
    },
    
    getInlineBlockId(element) {
      return element?.getAttribute("data-block-id") || "";
    },
    
    getInlineLine(element) {
      const value = element?.getAttribute("data-line");
      if (value == null || value === "") return null;
      const line = Number.parseInt(value, 10);
      return Number.isFinite(line) ? line : null;
    },
    
    getEventElement(target) {
      if (target instanceof Element) return target;
      return target?.parentElement instanceof Element ? target.parentElement : null;
    }
    };
    
  },
  "js/plugin/inline-status": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async toggleInlineSubtaskStatus(subtask, sourcePath) {
      if (!this.canEditInlineKanban(sourcePath)) return;
      const button = subtask?.querySelector(":scope > .task-kanban-inline-subtask-status");
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      const status = STATUS_BY_KEY.get(button?.getAttribute("data-status-key")) || STATUS_BY_ICON.get(button?.textContent.trim());
      const blockId = this.getInlineBlockId(button) || this.getInlineBlockId(subtask);
      const line = this.getInlineLine(button) ?? this.getInlineLine(subtask);
      if (!(file instanceof TFile) || !status || (!blockId && line == null)) return;
      const nextStatus = this.getNextSubtaskStatus(status);
      const openView = this.findOpenMarkdownView(file);
      const savedScroll = openView?.editor?.getScrollInfo?.();
      await this.setInlineTaskStatus(file, blockId, nextStatus, false, true, line);
      this.updateInlineStatusButton(button, nextStatus);
      this.scheduleInlineKanbanRefresh(file, INLINE_KANBAN_EDITOR_REFRESH_DELAY);
      if (savedScroll && openView?.editor?.scrollTo) {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
          openView.editor.scrollTo?.(savedScroll.left, savedScroll.top);
        }));
      }
    },
    
    async switchToEditAndToggleSubtask(subtask, sourcePath) {
      if (!this.canEditInlineKanban(sourcePath)) return;
      const button = subtask?.querySelector(":scope > .task-kanban-inline-subtask-status");
      const blockId = this.getInlineBlockId(button) || this.getInlineBlockId(subtask);
      const line = this.getInlineLine(button) ?? this.getInlineLine(subtask);
      const status = STATUS_BY_KEY.get(button?.getAttribute("data-status-key")) || STATUS_BY_ICON.get(button?.textContent.trim());
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile) || !status || (!blockId && line == null)) return;
      const nextStatus = this.getNextSubtaskStatus(status);
      await this.app.vault.process(file, (content) => {
        const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
        const lines = contentWithBlockIds.split(/\r?\n/);
        const changed = this.updateTaskLinesByBlockId(lines, blockId, nextStatus, false, line);
        if (!changed) return contentWithBlockIds;
        const nextContent = lines.join("\n");
        const tasks = this.scanTasksInContent(file, nextContent);
        const block = this.buildKanbanBlock(file, tasks);
        return this.replaceOrInsertKanbanBlock(nextContent, block);
      });
    },
    
    async openInlineTask(sourcePath, line) {
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (!(file instanceof TFile)) return;
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.setViewState({ type: "markdown", state: { file: file.path, mode: "source" }, active: true });
      this.app.workspace.revealLeaf(leaf);
      const view = leaf.view;
      if (view?.editor && Number.isInteger(line)) {
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
    },
    
    async setInlineTaskStatus(file, blockId, status, includeSubtasks, rebuildKanban = false, fallbackLine = null) {
      if (!this.canEditInlineKanban(file.path)) return;
      const openView = this.findOpenMarkdownView(file);
      if (openView?.editor?.getValue && openView.editor.replaceRange) {
        const preEditState = rebuildKanban ? this.captureActiveEditorState(file) : null;
        const changed = this.updateTaskStatusInEditor(file, openView.editor, blockId, status, includeSubtasks, fallbackLine);
        if (changed) {
          await this.rememberTaskTouched({ file, line: fallbackLine ?? 0, blockId, raw: blockId || "" });
          if (rebuildKanban && preEditState) {
            // Pass editor only — cursor/scroll intentionally not restored here to avoid
            // jumping to the task line when cursor was previously set by openInlineTask
            this.refreshInlineKanbanBlockInEditor(file, { editor: preEditState.editor, cursor: null, scrollInfo: null });
          }
          return true;
        }
      }
    
      let changedTask = false;
      await this.app.vault.process(file, (content) => {
        const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
        const lines = contentWithBlockIds.split(/\r?\n/);
        const changed = this.updateTaskLinesByBlockId(lines, blockId, status, includeSubtasks, fallbackLine);
        if (!changed) return contentWithBlockIds;
        changedTask = true;
    
        const nextContent = lines.join("\n");
        if (!rebuildKanban) return nextContent;
        const tasks = this.scanTasksInContent(file, nextContent);
        const block = this.buildKanbanBlock(file, tasks);
        return this.replaceOrInsertKanbanBlock(nextContent, block);
      });
      if (changedTask) {
        await this.rememberTaskTouched({ file, line: fallbackLine ?? 0, blockId, raw: blockId || "" });
      }
      return changedTask;
    },
    
    updateTaskStatusInEditor(file, editor, blockId, status, includeSubtasks, fallbackLine = null) {
      const content = editor.getValue();
      const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
      const lines = contentWithBlockIds.split(/\r?\n/);
      const originalLines = content.split(/\r?\n/);
      const changed = this.updateTaskLinesByBlockId(lines, blockId, status, includeSubtasks, fallbackLine);
      if (!changed) return false;
    
      for (let index = lines.length - 1; index >= 0; index--) {
        if (lines[index] === originalLines[index]) continue;
        editor.replaceRange(
          lines[index],
          { line: index, ch: 0 },
          { line: index, ch: (originalLines[index] || "").length }
        );
      }
      return true;
    },
    
    updateTaskLinesByBlockId(lines, blockId, status, includeSubtasks, fallbackLine = null) {
      let startIndex = -1;
      let startIndent = 0;
      let insideGeneratedKanban = false;
    
      for (let index = 0; index < lines.length; index++) {
        const raw = lines[index];
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
        if (!taskMatch) continue;
        const currentBlockId = taskMatch[3].match(BLOCK_ID_RE)?.[1];
        if (blockId ? currentBlockId !== blockId : index !== fallbackLine) continue;
        startIndex = index;
        startIndent = this.getIndentLevel(taskMatch[1] || "");
        break;
      }
    
      if (startIndex < 0) return false;
    
      let changed = false;
      for (let index = startIndex; index < lines.length; index++) {
        const taskMatch = lines[index].match(TASK_LINE_RE);
        if (!taskMatch) {
          if (index === startIndex) break;
          continue;
        }
        const indentLevel = this.getIndentLevel(taskMatch[1] || "");
        if (index > startIndex && (!includeSubtasks || indentLevel <= startIndent)) break;
        const nextLine = status
          ? lines[index].replace(TASK_LINE_RE, `$1- [${status.marker}] $3`)
          : lines[index].replace(TASK_LINE_RE, `$1- $3`);
        if (nextLine !== lines[index]) {
          lines[index] = nextLine;
          changed = true;
        }
      }
    
      return changed;
    }
    };
    
  },
  "js/plugin/workspace": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async activateView() {
      const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_KANBAN)[0];
      if (existing) {
        this.app.workspace.revealLeaf(existing);
        return;
      }
      const leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_TASK_KANBAN, active: true });
      this.app.workspace.revealLeaf(leaf);
    },
    
    refreshOpenViews() {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_KANBAN)) {
        leaf.view.scheduleReload?.();
      }
    },
    
    handleMarkdownFileChanged(file, delay = INLINE_KANBAN_REFRESH_DELAY) {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      this.refreshOpenViews();
      this.scheduleInlineKanbanRefresh(file, delay);
    },
    
    handleMarkdownTaskStateChanged(file, delay = INLINE_KANBAN_CHECKBOX_REFRESH_DELAY) {
      if (file instanceof TFile && file.extension === "md") {
        this.handleMarkdownFileChanged(file, delay);
      } else {
        this.refreshOpenViews();
      }
    
      for (const path of this.inlineKanbanRenderedElements?.keys?.() || []) {
        const kanbanFile = this.app.vault.getAbstractFileByPath(path);
        if (kanbanFile instanceof TFile && kanbanFile.extension === "md" && kanbanFile.path !== file?.path) {
          this.scheduleInlineKanbanRefresh(kanbanFile, delay);
        }
      }
    },
    
    handleEditorCheckboxEvent(event) {
      if (!this.isMarkdownCheckboxEventTarget(event.target)) return;
      const file = this.app.workspace.getActiveFile();
      this.rememberActiveEditorTaskTouched(file);
      this.handleMarkdownTaskStateChanged(file, INLINE_KANBAN_CHECKBOX_REFRESH_DELAY);
      window.setTimeout(() => this.handleMarkdownTaskStateChanged(file, 0), INLINE_KANBAN_EDITOR_REFRESH_DELAY);
      // Backup refresh: Obsidian may write the file to disk later than the event fires
      window.setTimeout(() => this.handleMarkdownTaskStateChanged(file, 0), 1200);
    },
    
    rememberActiveEditorTaskTouched(file) {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      const view = this.findOpenMarkdownView(file);
      const line = view?.editor?.getCursor?.()?.line;
      if (!Number.isInteger(line)) return;
      const raw = view.editor.getLine?.(line) || "";
      const taskMatch = raw.match(TASK_LINE_RE);
      if (!taskMatch) return;
      const rawText = taskMatch[3].trim();
      this.rememberTaskTouched({
        file,
        line,
        raw,
        blockId: rawText.match(BLOCK_ID_RE)?.[1] || "",
        text: rawText.replace(BLOCK_ID_RE, "").trim()
      });
    },
    
    isMarkdownCheckboxEventTarget(target) {
      const element = target instanceof Element ? target : null;
      if (!element) return false;
      if (element.closest(".task-kanban-inline-card, .task-kanban-inline-subtask, .task-kanban-inline-action")) return false;
      if (element.closest(
        "input[type='checkbox'], .task-list-item-checkbox, .cm-formatting-task, .cm-task-marker"
      )) return true;
      // Reading mode: checkbox is rendered as <input> inside .task-list-item; textContent never has raw markdown
      if (element.closest(".task-list-item")) return true;
      const taskLine = element.closest(".HyperMD-task-line, .cm-line");
      return Boolean(taskLine?.textContent?.match(/[-*]\s+\[[^\]]*\]/));
    },
    
    trackInlineKanbanElement(file, element) {
      if (!element.querySelector(".task-kanban-inline-marker")) return;
      let elements = this.inlineKanbanRenderedElements.get(file.path);
      if (!elements) {
        elements = new Set();
        this.inlineKanbanRenderedElements.set(file.path, elements);
      }
      elements.add(element);
    },
    
    async refreshRenderedInlineKanbans(file) {
      const elements = this.inlineKanbanRenderedElements.get(file.path);
      if (!elements?.size) return;
      for (const element of Array.from(elements)) {
        if (!element.isConnected) {
          elements.delete(element);
          continue;
        }
        await this.syncInlineKanbanDom(element, file);
      }
    },
    
    async refreshInlineKanbanView(file, element = null) {
      if (!(file instanceof TFile) || file.extension !== "md") return;
      await this.ensureTaskBlockIdsInFile(file);
      this.refreshOpenViews();
    
      if (element?.isConnected && element.querySelector(".task-kanban-inline-marker")) {
        await this.syncInlineKanbanDom(element, file);
      }
    
      await this.refreshRenderedInlineKanbans(file);
    },
    
    async ensureTaskBlockIdsInFile(file) {
      const openView = this.findOpenMarkdownView(file);
      if (openView?.editor?.getValue && openView.editor.setValue) {
        const content = openView.editor.getValue();
        const nextContent = this.ensureTaskBlockIds(file, content);
        if (nextContent === content) return;
        const state = {
          editor: openView.editor,
          cursor: openView.editor.getCursor(),
          scrollInfo: openView.editor.getScrollInfo?.()
        };
        openView.editor.setValue(nextContent);
        this.restoreActiveEditorState(state);
        return;
      }
    
      await this.app.vault.process(file, (content) => this.ensureTaskBlockIds(file, content));
    }
    };
    
  },
  "js/plugin/inline-delegates": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    bindInlineKanbanDelegates(element, sourcePath) {
      if (element.dataset.taskKanbanDelegatesBound === "true") return;
      element.dataset.taskKanbanDelegatesBound = "true";
    
      for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
        element.addEventListener(eventName, (event) => {
          const filter = event.target.closest(".task-kanban-inline-filter");
          if (filter) {
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (eventName !== "click") return;
            const expandBtn = event.target.closest(".task-kanban-filter-expand");
            if (expandBtn) {
              event.preventDefault();
              const node = expandBtn.closest(".task-kanban-filter-node");
              const children = node?.querySelector(":scope > .task-kanban-filter-children");
              if (!children) return;
              const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
              expandBtn.setAttribute("aria-expanded", String(!isExpanded));
              expandBtn.textContent = isExpanded ? "›" : "⌄";
              expandBtn.setAttribute("title", isExpanded ? "Развернуть" : "Свернуть");
              children.hidden = isExpanded;
              return;
            }
            const toggle = event.target.closest(".task-kanban-inline-filter-toggle");
            if (!toggle) return;
            event.preventDefault();
            const wasCollapsed = this.expandInlineKanbanCallout(filter);
            const expanded = wasCollapsed || !filter.classList.contains("is-open");
            filter.classList.toggle("is-open", expanded);
            toggle.setAttribute("aria-expanded", String(expanded));
            if (expanded) this.closeInlineSorts(element);
            return;
          }
          const sort = event.target.closest(".task-kanban-inline-sort");
          if (sort) {
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (eventName !== "click") return;
            const toggle = event.target.closest(".task-kanban-inline-sort-toggle");
            if (!toggle) return;
            event.preventDefault();
            const expanded = !sort.classList.contains("is-open");
            sort.classList.toggle("is-open", expanded);
            toggle.setAttribute("aria-expanded", String(expanded));
            if (expanded) this.closeInlineFilters(element);
            return;
          }
        }, true);
      }
    
      this.registerDomEvent(document, "click", (event) => {
        if (event.target.closest(".task-kanban-inline-filter")) return;
        this.closeInlineFilters(element);
      });
    
      this.registerDomEvent(document, "click", (event) => {
        if (event.target.closest(".task-kanban-inline-sort")) return;
        this.closeInlineSorts(element);
      });
    
      element.addEventListener("click", async (event) => {
        const openButton = event.target.closest(".task-kanban-inline-open");
        if (!openButton || !element.contains(openButton)) return;
        if (openButton.closest(".cm-editor, .markdown-source-view, .cm-html-embed")) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        await this.openInlineTask(sourcePath, this.getInlineLine(openButton));
      }, true);
    
      element.addEventListener("click", async (event) => {
        const target = this.getEventElement(event.target);
        const subtask = target?.closest(".task-kanban-inline-subtask");
        if (!subtask || !element.contains(subtask)) return;
        if (target.closest(".task-kanban-inline-subtasks-toggle")) return;
        if (target.closest(".task-kanban-inline-open")) return;
        if (!target.closest(".task-kanban-inline-subtask-status, .task-kanban-inline-subtask-text, .task-kanban-inline-subtask")) return;
    
        if (!this.canEditInlineKanban(sourcePath)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        await this.toggleInlineSubtaskStatus(subtask, sourcePath);
      }, true);
    
      element.addEventListener("click", async (event) => {
        const textToggle = event.target.closest(".task-kanban-inline-text-toggle");
        if (textToggle) {
          event.preventDefault();
          event.stopPropagation();
          const card = textToggle.closest(".task-kanban-inline-card");
          if (!card) return;
          this.toggleInlineCardText(card);
          return;
        }
    
        const expandToggle = event.target.closest(".task-kanban-inline-expand-toggle");
        if (expandToggle) {
          event.preventDefault();
          event.stopPropagation();
          const expand = expandToggle.getAttribute("aria-pressed") !== "true";
          this.setAllInlineSubtasksExpanded(element, expand);
          return;
        }
    
        const filterToggle = event.target.closest(".task-kanban-inline-filter-toggle");
        if (filterToggle) {
          event.preventDefault();
          event.stopPropagation();
          const filter = filterToggle.closest(".task-kanban-inline-filter");
          const expanded = !filter?.classList.contains("is-open");
          filter?.classList.toggle("is-open", expanded);
          filterToggle.setAttribute("aria-expanded", String(expanded));
          return;
        }
    
        if (event.target.closest(".task-kanban-inline-filter-menu")) {
          event.stopPropagation();
          return;
        }
    
        const statusButton = event.target.closest(".task-kanban-inline-subtask-status");
        if (statusButton) {
          event.preventDefault();
          event.stopPropagation();
          if (!this.canEditInlineKanban(sourcePath)) return;
          const subtask = statusButton.closest(".task-kanban-inline-subtask");
          await this.toggleInlineSubtaskStatus(subtask, sourcePath);
          return;
        }
    
        const toggleButton = event.target.closest(".task-kanban-inline-subtasks-toggle");
        if (toggleButton) {
          event.preventDefault();
          event.stopPropagation();
          const card = toggleButton.closest(".task-kanban-inline-card, .task-kanban-inline-subtask");
          if (card) this.toggleInlineSubtasks(card);
          return;
        }
    
        if (event.target.closest("button")) return;
        const card = event.target.closest(".task-kanban-inline-card, .task-kanban-inline-subtask");
        if (!card || !element.contains(card)) return;
        event.preventDefault();
        event.stopPropagation();
        if (card.classList.contains("task-kanban-inline-subtask")) {
          if (!this.canEditInlineKanban(sourcePath)) return;
          await this.toggleInlineSubtaskStatus(card, sourcePath);
          return;
        }
        if (card.classList.contains("has-overflowing-text")) this.toggleInlineCardText(card);
        this.toggleInlineSubtasks(card);
      });
    
      element.addEventListener("dragstart", (event) => {
        const card = event.target.closest(".task-kanban-inline-card");
        if (!card || !element.contains(card)) return;
        if (!this.canEditInlineKanban(sourcePath)) {
          event.preventDefault();
          return;
        }
        if (event.target.closest(".task-kanban-inline-subtask")) {
          event.preventDefault();
          return;
        }
        const blockId = this.getInlineBlockId(card);
        if (!blockId || !event.dataTransfer) return;
        event.dataTransfer.setData(TASK_KANBAN_DRAG_MIME, blockId);
        event.dataTransfer.effectAllowed = "move";
        card.classList.add("is-dragging");
      });
    
      element.addEventListener("dragend", (event) => {
        const card = event.target.closest(".task-kanban-inline-card");
        if (card) card.classList.remove("is-dragging");
        for (const column of element.querySelectorAll(".task-kanban-inline-column.is-drag-over")) {
          column.classList.remove("is-drag-over");
        }
      });
    
      element.addEventListener("dragover", (event) => {
        const target = this.getEventElement(event.target);
        const column = target?.closest(".task-kanban-inline-column");
        if (!column || !element.contains(column)) return;
        if (!this.canEditInlineKanban(sourcePath)) return;
        if (!Array.from(event.dataTransfer?.types || []).includes(TASK_KANBAN_DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        column.classList.add("is-drag-over");
      });
    
      element.addEventListener("dragleave", (event) => {
        const target = this.getEventElement(event.target);
        const column = target?.closest(".task-kanban-inline-column");
        if (!column || !element.contains(column)) return;
        if (column.contains(event.relatedTarget)) return;
        column.classList.remove("is-drag-over");
      });
    
      element.addEventListener("drop", async (event) => {
        const target = this.getEventElement(event.target);
        const column = target?.closest(".task-kanban-inline-column");
        if (!column || !element.contains(column)) return;
        if (!this.canEditInlineKanban(sourcePath)) return;
        const blockId = event.dataTransfer?.getData(TASK_KANBAN_DRAG_MIME);
        const status = this.getInlineColumnStatus(column);
        if (!blockId || !status) return;
        event.preventDefault();
        event.stopPropagation();
        column.classList.remove("is-drag-over");
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (!(file instanceof TFile)) return;
        const openView = this.findOpenMarkdownView(file);
        const savedScroll = openView?.editor?.getScrollInfo?.();
        await this.setInlineTaskStatus(file, blockId, status, true, true);
        if (savedScroll && openView?.editor?.scrollTo) {
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
            openView.editor.scrollTo?.(savedScroll.left, savedScroll.top);
          }));
        }
        this.scheduleInlineKanbanRefresh(file, INLINE_KANBAN_CHECKBOX_REFRESH_DELAY);
      });
    
      element.addEventListener("click", (event) => {
        const expandBtn = event.target.closest(".task-kanban-filter-expand");
        if (!expandBtn || !element.contains(expandBtn)) return;
        event.preventDefault();
        event.stopPropagation();
        const node = expandBtn.closest(".task-kanban-filter-node");
        const children = node?.querySelector(":scope > .task-kanban-filter-children");
        if (!children) return;
        const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
        expandBtn.setAttribute("aria-expanded", String(!isExpanded));
        expandBtn.textContent = isExpanded ? "›" : "⌄";
        expandBtn.setAttribute("title", isExpanded ? "Развернуть" : "Свернуть");
        children.hidden = isExpanded;
      });
    
      element.addEventListener("change", async (event) => {
        const sortInput = event.target.closest(".task-kanban-inline-sort-menu input[type='radio']");
        if (sortInput && element.contains(sortInput)) {
          event.preventDefault();
          event.stopPropagation();
          await this.saveInlineSortSelection(sortInput);
          const file = this.app.vault.getAbstractFileByPath(sourcePath);
          if (file instanceof TFile) await this.syncInlineKanbanDom(element, file);
          return;
        }
    
        const input = event.target.closest(".task-kanban-inline-filter-menu input[type='checkbox']");
        if (!input || !element.contains(input)) return;
        event.preventDefault();
        event.stopPropagation();
    
        const menu = input.closest(".task-kanban-inline-filter-menu");
        if (input.closest("[data-filter-all]")) {
          for (const cb of menu.querySelectorAll("input[type='checkbox'][value]")) {
            cb.checked = input.checked;
          }
        } else {
          const node = input.closest(".task-kanban-filter-node");
          const children = node?.querySelector(":scope > .task-kanban-filter-children");
          if (children) {
            for (const cb of children.querySelectorAll("input[type='checkbox']")) {
              cb.checked = input.checked;
            }
          }
          let parent = node?.parentElement?.closest(".task-kanban-filter-node");
          while (parent) {
            const parentInput = parent.querySelector(":scope > .task-kanban-filter-row input[type='checkbox']");
            const childInputs = Array.from(parent.querySelectorAll(":scope > .task-kanban-filter-children input[type='checkbox'][value]"));
            if (parentInput && childInputs.length) {
              parentInput.checked = childInputs.every(cb => cb.checked);
            }
            parent = parent.parentElement?.closest(".task-kanban-filter-node");
          }
          const allLeafs = Array.from(menu.querySelectorAll("input[type='checkbox'][value]"));
          const allChk = menu.querySelector("[data-filter-all] input[type='checkbox']");
          if (allChk) allChk.checked = allLeafs.length > 0 && allLeafs.every(cb => cb.checked);
        }
    
        await this.saveInlineHeadingFilterSelection(sourcePath, menu);
        const file = this.app.vault.getAbstractFileByPath(sourcePath);
        if (file instanceof TFile) await this.syncInlineKanbanDom(element, file);
      });
    }
    };
    
  },
  "js/plugin/inline-dom": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async saveInlineHeadingFilterSelection(sourcePath, menu) {
      const options = Array.from(menu.querySelectorAll("input[type='checkbox'][value]"));
      const selected = options.filter(o => o.checked).map(o => o.value);
      this.inlineKanbanHeadingFilters ||= {};
      if (!options.length || selected.length === options.length) {
        delete this.inlineKanbanHeadingFilters[sourcePath];
      } else {
        this.inlineKanbanHeadingFilters[sourcePath] = selected;
      }
      await this.savePluginData();
    },
    
    async saveInlineSortSelection(input) {
      await this.setTaskKanbanSortMode(input?.value || "default");
    },
    
    closeInlineFilters(element) {
      for (const filter of element.querySelectorAll(".task-kanban-inline-filter.is-open")) {
        filter.classList.remove("is-open");
        filter.querySelector(".task-kanban-inline-filter-toggle")?.setAttribute("aria-expanded", "false");
      }
    },
    
    closeInlineSorts(element) {
      for (const sort of element.querySelectorAll(".task-kanban-inline-sort.is-open")) {
        sort.classList.remove("is-open");
        sort.querySelector(".task-kanban-inline-sort-toggle")?.setAttribute("aria-expanded", "false");
      }
    },
    
    setAllInlineSubtasksExpanded(element, expand) {
      for (const card of element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask")) {
        if (!card.querySelector(":scope > .task-kanban-inline-subtasks")) continue;
        card.classList.toggle("is-expanded", expand);
        this.rememberInlineExpandedState(card, expand);
        const button = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-subtasks-toggle");
        if (button) {
          button.setAttribute("aria-expanded", String(expand));
          button.textContent = expand ? "⌄" : "›";
        }
      }
      this.updateInlineExpandToggle(element);
    },
    
    toggleInlineCardText(card) {
      if (!card.classList.contains("has-overflowing-text")) return;
      const textToggle = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text-toggle");
      const expanded = !card.classList.contains("is-text-expanded");
      card.classList.toggle("is-text-expanded", expanded);
      if (textToggle) {
        textToggle.setAttribute("aria-expanded", String(expanded));
        textToggle.textContent = expanded ? "‹" : "›";
        textToggle.setAttribute("title", expanded ? "Свернуть текст" : "Развернуть текст");
      }
    },
    
    updateInlineTextOverflowControls(element) {
      window.requestAnimationFrame(() => {
        for (const card of element.querySelectorAll(".task-kanban-inline-card")) {
          const text = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text");
          const toggle = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text-toggle");
          if (!text || !toggle) continue;
          const wasExpanded = card.classList.contains("is-text-expanded");
          if (wasExpanded) card.classList.remove("is-text-expanded");
          toggle.hidden = true;
          toggle.setAttribute("aria-hidden", "true");
          const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight) || 18;
          const overflowing = text.scrollHeight > lineHeight * 3 + 2;
          card.classList.toggle("has-overflowing-text", overflowing);
          toggle.hidden = !overflowing;
          toggle.setAttribute("aria-hidden", String(!overflowing));
          if (!overflowing) {
            toggle.setAttribute("aria-expanded", "false");
            card.classList.remove("is-text-expanded");
          } else if (wasExpanded) {
            card.classList.add("is-text-expanded");
          }
        }
      });
    },
    
    updateInlineExpandToggle(element) {
      const button = element.querySelector(".task-kanban-inline-expand-toggle");
      if (!button) return;
      const expandable = Array.from(element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask"))
        .filter((card) => card.querySelector(":scope > .task-kanban-inline-subtasks"));
      const allExpanded = expandable.length > 0 && expandable.every((card) => card.classList.contains("is-expanded"));
      button.disabled = expandable.length === 0;
      button.setAttribute("aria-pressed", String(allExpanded));
      button.textContent = allExpanded ? "Свернуть" : "Развернуть";
    },
    
    expandInlineKanbanCallout(element) {
      const callout = element.closest(".callout");
      if (!callout) return false;
      const wasCollapsed = callout.classList.contains("is-collapsed")
        || callout.getAttribute("data-callout-fold") === "-";
      callout.classList.remove("is-collapsed");
      if (callout.hasAttribute("data-callout-fold")) {
        callout.setAttribute("data-callout-fold", "+");
      }
    
      for (const content of callout.querySelectorAll(".callout-content")) {
        content.style.removeProperty("display");
        content.style.removeProperty("height");
        content.style.removeProperty("min-height");
        content.style.removeProperty("margin");
        content.style.removeProperty("padding");
        content.style.removeProperty("overflow");
      }
      const fold = callout.querySelector(".callout-fold, .collapse-indicator");
      fold?.classList?.remove?.("is-collapsed");
      fold?.setAttribute("aria-expanded", "true");
      return wasCollapsed;
    },
    
    async syncInlineKanbanDom(element, file) {
      if (!element.querySelector(".task-kanban-inline-marker")) return;
      this.syncInlineReadonlyState(element, file.path);
      const expandedBlockIds = new Set(
        Array.from(element.querySelectorAll(".task-kanban-inline-card.is-expanded, .task-kanban-inline-subtask.is-expanded"))
          .map((card) => this.getInlineBlockId(card))
          .filter(Boolean)
      );
      for (const blockId of this.inlineKanbanExpandedBlockIds.get(file.path) || []) {
        expandedBlockIds.add(blockId);
      }
      const content = await this.readMarkdownFileContent(file);
      const tasks = this.scanTasksInContent(file, content);
      this.ensureInlineFilterControl(element);
      this.renderInlineHeadingFilter(element, tasks);
      this.renderInlineSortMenu(element);
      const selectedHeadings = this.getInlineSelectedHeadings(element, tasks);
      const visibleTasks = this.sortTasksForKanban(tasks.filter((task) => {
        const headingText = typeof task.heading === "string" ? task.heading : task.heading?.text || "";
        return selectedHeadings.has(headingText);
      }));
    
      for (const status of STATUSES) {
        const column = element.querySelector(`.task-kanban-inline-column[data-status-key="${status.key}"]`);
        if (!column) continue;
        const items = visibleTasks.filter((task) => task.status.key === status.key);
        column.innerHTML = items.length
          ? items.map((task) => this.formatKanbanCellItem(task)).join("")
          : "<span class=\"task-kanban-inline-empty\">Пусто</span>";
      }
      this.restoreInlineExpandedState(element, expandedBlockIds);
      this.syncInlineReadonlyState(element, file.path);
      this.updateInlineTextOverflowControls(element);
    
      const table = element.querySelector("table:has(.task-kanban-inline-marker)");
      if (!table) return;
      const headers = Array.from(table.querySelectorAll("th"));
      STATUSES.forEach((status, index) => {
        const header = headers[index];
        if (!header) return;
        const count = visibleTasks.filter((task) => task.status.key === status.key).length;
        header.textContent = `${status.icon} ${status.title} (${count})`;
      });
    },
    
    ensureInlineFilterControl(element) {
      const actions = element.querySelector(".task-kanban-inline-title-actions");
      if (!actions) return;
      if (!actions.querySelector(".task-kanban-inline-filter")) {
        const filter = document.createElement("span");
        filter.className = "task-kanban-inline-filter";
        filter.innerHTML = '<button class="task-kanban-inline-action task-kanban-inline-filter-toggle" type="button" aria-expanded="false">Фильтр</button><span class="task-kanban-inline-filter-menu"></span>';
        actions.prepend(filter);
      }
      if (!actions.querySelector(".task-kanban-inline-sort")) {
        const sort = document.createElement("span");
        sort.className = "task-kanban-inline-sort";
        sort.innerHTML = '<button class="task-kanban-inline-action task-kanban-inline-sort-toggle" type="button" aria-expanded="false">Сортировка</button><span class="task-kanban-inline-sort-menu"></span>';
        const filter = actions.querySelector(".task-kanban-inline-filter");
        filter ? filter.insertAdjacentElement("afterend", sort) : actions.prepend(sort);
      }
      if (!actions.querySelector(".task-kanban-inline-expand-toggle")) {
        const expandButton = document.createElement("button");
        expandButton.className = "task-kanban-inline-action task-kanban-inline-expand-toggle";
        expandButton.type = "button";
        expandButton.setAttribute("aria-pressed", "false");
        expandButton.textContent = "Развернуть";
        const hiddenToggle = actions.querySelector(".task-kanban-inline-hidden-toggle");
        actions.insertBefore(expandButton, hiddenToggle || actions.firstChild?.nextSibling || null);
      }
    },
    
    buildHeadingTree(headingObjects) {
      const seen = new Set();
      const items = headingObjects
        .filter(Boolean)
        .map(h => typeof h === "string" ? { level: 1, text: h } : h)
        .filter(h => {
          if (seen.has(h.text)) return false;
          seen.add(h.text);
          return true;
        });
    
      const tree = [];
      const stack = [];
      for (const item of items) {
        while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
        const node = { ...item, children: [] };
        if (stack.length) stack[stack.length - 1].children.push(node);
        else tree.push(node);
        stack.push(node);
      }
      return tree;
    },
    
    renderHeadingTreeNodes(nodes, selected, expandedHeadings, depth) {
      return nodes.map(node => {
        const checked = selected.has(node.text) ? " checked" : "";
        const label = this.escapeTableText(node.text || "Без заголовка");
        const val = this.escapeAttribute(node.text);
        const hasChildren = node.children.length > 0;
        const expanded = expandedHeadings.has(node.text);
        const expandBtn = hasChildren
          ? `<button class="task-kanban-filter-expand" type="button" aria-expanded="${expanded ? "true" : "false"}" data-heading="${val}" title="${expanded ? "Свернуть" : "Развернуть"}">${expanded ? "⌄" : "›"}</button>`
          : `<span class="task-kanban-filter-spacer"></span>`;
        const childrenHtml = hasChildren
          ? `<div class="task-kanban-filter-children"${expanded ? "" : " hidden"}>${this.renderHeadingTreeNodes(node.children, selected, expandedHeadings, depth + 1)}</div>`
          : "";
        return `<div class="task-kanban-filter-node"><div class="task-kanban-filter-row" style="padding-left:${depth * 16}px">${expandBtn}<label class="task-kanban-inline-filter-option"><input type="checkbox" value="${val}"${checked}>${label}</label></div>${childrenHtml}</div>`;
      }).join("");
    },
    
    renderInlineHeadingFilter(element, tasks) {
      const menu = element.querySelector(".task-kanban-inline-filter-menu");
      if (!menu) return;
      const previousSelected = new Set(
        Array.from(menu.querySelectorAll("input[type='checkbox'][value]:checked")).map(i => i.value)
      );
      const expandedHeadings = new Set(
        Array.from(menu.querySelectorAll(".task-kanban-filter-expand[aria-expanded='true']"))
          .map(button => button.getAttribute("data-heading") || "")
      );
      const headingObjects = tasks.map(t => t.heading || "");
      const headingTexts = Array.from(new Set(headingObjects.map(h => typeof h === "string" ? h : h?.text || "")));
      const hasPreviousState = menu.dataset.initialized === "true";
      const savedSelected = this.inlineKanbanHeadingFilters?.[element.dataset.taskKanbanSourcePath];
      const selected = hasPreviousState
        ? previousSelected
        : Array.isArray(savedSelected) ? new Set(savedSelected) : new Set(headingTexts);
      menu.dataset.initialized = "true";
      const allChecked = headingTexts.length > 0 && headingTexts.every(h => selected.has(h));
      const tree = this.buildHeadingTree(headingObjects);
      menu.innerHTML = `<label class="task-kanban-inline-filter-option task-kanban-inline-filter-all" data-filter-all="true"><input type="checkbox"${allChecked ? " checked" : ""}>Все</label>${this.renderHeadingTreeNodes(tree, selected, expandedHeadings, 0)}`;
    },
    
    renderInlineSortMenu(element) {
      const menu = element.querySelector(".task-kanban-inline-sort-menu");
      if (!menu) return;
      const sourcePath = element.dataset.taskKanbanSourcePath || "global";
      const options = [
        ["default", "По умолчанию"],
        ["touched", "Последние сверху"],
        ["priority", "По приоритету 🔥"]
      ].map(([value, label]) => {
        const checked = (this.taskKanbanSortMode || "default") === value ? "checked" : "";
        return `<label class="task-kanban-inline-sort-option"><input type="radio" name="task-kanban-sort-${this.escapeAttribute(sourcePath)}" value="${this.escapeAttribute(value)}" ${checked}>${this.escapeTableText(label)}</label>`;
      });
      menu.innerHTML = options.join("");
    },
    
    getInlineSelectedHeadings(element, tasks) {
      const headingTexts = Array.from(new Set(tasks.map(t => {
        const h = t.heading;
        return typeof h === "string" ? h : h?.text || "";
      })));
      const menu = element.querySelector(".task-kanban-inline-filter-menu");
      if (!menu) return new Set(headingTexts);
      return new Set(
        Array.from(menu.querySelectorAll("input[type='checkbox'][value]:checked")).map(i => i.value)
      );
    },
    
    restoreInlineExpandedState(element, expandedBlockIds) {
      if (!expandedBlockIds.size) {
        this.updateInlineExpandToggle(element);
        return;
      }
      for (const card of element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask")) {
        if (!expandedBlockIds.has(this.getInlineBlockId(card))) continue;
        card.classList.add("is-expanded");
        const button = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-subtasks-toggle");
        if (button) {
          button.setAttribute("aria-expanded", "true");
          button.textContent = "⌄";
        }
      }
      this.updateInlineExpandToggle(element);
    }
    };
    
  },
  "js/plugin/inline-refresh": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    scheduleInlineKanbanRefresh(file, delay = INLINE_KANBAN_REFRESH_DELAY) {
      const path = file.path;
      window.clearTimeout(this.inlineKanbanRefreshTimers.get(path));
      const timer = window.setTimeout(async () => {
        this.inlineKanbanRefreshTimers.delete(path);
        await this.refreshRenderedInlineKanbans(file);
      }, delay);
      this.inlineKanbanRefreshTimers.set(path, timer);
    },
    
    async refreshInlineKanbanBlock(file) {
      if (this.inlineKanbanRefreshInProgress.has(file.path)) return;
      const activeEditorState = this.captureActiveEditorState(file);
      this.inlineKanbanRefreshInProgress.add(file.path);
      try {
        if (activeEditorState) {
          this.refreshInlineKanbanBlockInEditor(file, activeEditorState);
          return;
        }
        await this.app.vault.process(file, (content) => {
          if (!this.hasKanbanBlock(content)) return content;
          const nextContent = this.rebuildKanbanBlockContent(file, content);
          return nextContent === content ? content : nextContent;
        });
        this.restoreActiveEditorState(activeEditorState);
      } finally {
        this.inlineKanbanRefreshInProgress.delete(file.path);
      }
    },
    
    refreshInlineKanbanBlockInEditor(file, state) {
      const content = state.editor.getValue?.();
      if (typeof content !== "string" || !this.hasKanbanBlock(content)) return;
      const update = this.buildKanbanBlockUpdate(file, content);
      if (update.nextContent === content) return;
      const range = this.getKanbanBlockRange(content);
      if (range && update.contentWithBlockIds === content && state.editor.replaceRange) {
        state.editor.replaceRange(
          update.block,
          this.offsetToEditorPos(state.editor, content, range.start),
          this.offsetToEditorPos(state.editor, content, range.end)
        );
      } else {
        state.editor.setValue(update.nextContent);
      }
      this.restoreActiveEditorState(state);
    },
    
    rebuildKanbanBlockContent(file, content) {
      return this.buildKanbanBlockUpdate(file, content).nextContent;
    },
    
    buildKanbanBlockUpdate(file, content) {
      const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
      const tasks = this.scanTasksInContent(file, contentWithBlockIds);
      const block = this.buildKanbanBlock(file, tasks);
      return {
        contentWithBlockIds,
        block,
        nextContent: this.replaceOrInsertKanbanBlock(contentWithBlockIds, block)
      };
    },
    
    getKanbanBlockRange(content) {
      const start = content.indexOf(KANBAN_START);
      const end = content.indexOf(KANBAN_END);
      if (start < 0 || end <= start) return null;
      return { start, end: end + KANBAN_END.length };
    },
    
    offsetToEditorPos(editor, content, offset) {
      if (editor.offsetToPos) return editor.offsetToPos(offset);
      const prefix = content.slice(0, offset);
      const lines = prefix.split(/\r?\n/);
      return { line: lines.length - 1, ch: lines[lines.length - 1].length };
    },
    
    captureActiveEditorState(file) {
      const activeView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
      const view = activeView?.file?.path === file.path && activeView.editor
        ? activeView
        : this.findOpenMarkdownView(file);
      if (!view?.editor) return null;
      return {
        editor: view.editor,
        cursor: view.editor.getCursor(),
        scrollInfo: view.editor.getScrollInfo?.()
      };
    },
    
    findOpenMarkdownView(file) {
      for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (view instanceof MarkdownView && view.file?.path === file.path && view.editor) return view;
      }
      return null;
    },
    
    restoreActiveEditorState(state) {
      if (!state?.editor || !state.cursor) return;
      window.requestAnimationFrame(() => {
        state.editor.setCursor(state.cursor);
        if (state.scrollInfo && state.editor.scrollTo) {
          state.editor.scrollTo(state.scrollInfo.left, state.scrollInfo.top);
        }
      });
    },
    
    hasKanbanBlock(content) {
      const startIndex = content.indexOf(KANBAN_START);
      const endIndex = content.indexOf(KANBAN_END);
      return startIndex >= 0 && endIndex > startIndex;
    }
    };
    
  },
  "js/plugin/tasks": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async collectTasks(activeFileOnly) {
      const activeFile = this.app.workspace.getActiveFile();
      const files = activeFileOnly && activeFile
        ? [activeFile]
        : this.app.vault.getMarkdownFiles();
      const results = [];
    
      for (const file of files) {
        const text = await this.readMarkdownFileContent(file);
        results.push(...this.scanTasksInContent(file, text));
      }
    
      return this.sortTasksForKanban(results);
    },
    
    async readMarkdownFileContent(file) {
      const view = this.findOpenMarkdownView(file);
      const editorText = view?.editor?.getValue?.();
      if (typeof editorText === "string") return editorText;
      return this.app.vault.read(file);
    },
    
    scanTasksInContent(file, content) {
      const lines = content.split(/\r?\n/);
      const tasks = [];
      const roots = [];
      const stack = [];
      let heading = null;
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
        if (headingMatch) {
          heading = {
            level: headingMatch[1].length,
            text: headingMatch[2].trim()
          };
        }
    
        const taskMatch = raw.match(TASK_LINE_RE);
        if (!taskMatch) continue;
        const marker = taskMatch[2];
        const status = STATUS_BY_MARKER.get(marker) || STATUSES[0];
        const rawText = taskMatch[3].trim();
        const priority = Array.from(rawText.match(/^(🔥+)/u)?.[1] || "").length;
        const blockId = rawText.match(BLOCK_ID_RE)?.[1] || "";
        const task = {
          file,
          line,
          raw,
          indent: taskMatch[1] || "",
          indentLevel: this.getIndentLevel(taskMatch[1] || ""),
          marker,
          blockId,
          text: rawText.replace(BLOCK_ID_RE, "").trim(),
          priority,
          status,
          heading,
          subtasks: []
        };
    
        while (stack.length && stack[stack.length - 1].indentLevel >= task.indentLevel) {
          stack.pop();
        }
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.subtasks.push(task);
        } else {
          roots.push(task);
        }
        tasks.push(task);
        stack.push(task);
      }
    
      return roots;
    },
    
    getIndentLevel(indent) {
      let level = 0;
      for (const char of indent) {
        level += char === "\t" ? 4 : 1;
      }
      return level;
    }
    };
    
  },
  "js/plugin/markdown-block": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async insertKanbanIntoCurrentFile() {
      const file = this.app.workspace.getActiveFile();
      if (!file) {
        new Notice("Нет активного файла");
        return;
      }
    
      await this.insertKanbanIntoFile(file);
    },
    
    async insertKanbanIntoFile(file, showNotice = true) {
      const openView = this.findOpenMarkdownView(file);
      // When the editor is open in source/live mode, use its buffer to capture unsaved changes
      if (openView?.editor?.getValue && openView.editor.setValue && openView.getMode?.() !== "preview") {
        const content = openView.editor.getValue();
        const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
        const tasks = this.scanTasksInContent(file, contentWithBlockIds);
        const block = this.buildKanbanBlock(file, tasks);
        const nextContent = this.replaceOrInsertKanbanBlock(contentWithBlockIds, block);
        if (nextContent !== content) {
          const state = this.captureActiveEditorState(file);
          openView.editor.setValue(nextContent);
          this.restoreActiveEditorState(state);
        }
      } else {
        await this.app.vault.process(file, (content) => {
          const contentWithBlockIds = this.ensureTaskBlockIds(file, content);
          const tasks = this.scanTasksInContent(file, contentWithBlockIds);
          const block = this.buildKanbanBlock(file, tasks);
          return this.replaceOrInsertKanbanBlock(contentWithBlockIds, block);
        });
      }
      if (showNotice) new Notice("Kanban обновлен");
    },
    
    async deleteKanbanFromFile(file) {
      await this.app.vault.process(file, (content) => this.removeKanbanBlock(content));
      new Notice("Kanban удален");
    },
    
    buildKanbanBlock(file, tasks) {
      const sortedTasks = this.sortTasksForKanban(tasks);
      const columns = STATUSES.map((status) => {
        const items = sortedTasks.filter((task) => task.status.key === status.key);
        const marker = "<span class=\"task-kanban-inline-marker\"></span>";
        const content = items.length
          ? items.map((task) => this.formatKanbanCellItem(task)).join("")
          : "<span class=\"task-kanban-inline-empty\">Пусто</span>";
        const body = `${marker}<div class="task-kanban-inline-column" data-status-key="${this.escapeAttribute(status.key)}">${content}</div>`;
        return {
          title: `${status.icon} ${status.title} (${items.length})`,
          body
        };
      });
    
      const calloutActions = '<span class="task-kanban-inline-title-actions"><span class="task-kanban-inline-filter"><button class="task-kanban-inline-action task-kanban-inline-filter-toggle" type="button" aria-expanded="false">Фильтр</button><span class="task-kanban-inline-filter-menu"></span></span><button class="task-kanban-inline-action task-kanban-inline-expand-toggle" type="button" aria-pressed="false">Развернуть</button><button class="task-kanban-inline-action task-kanban-inline-hidden-toggle" type="button" aria-pressed="false" title="Показать отмененные и предложенные">Доп.</button><button class="task-kanban-inline-action" data-action="refresh">Обновить</button><button class="task-kanban-inline-action task-kanban-inline-action--danger" data-action="delete">Удалить</button></span>';
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
    };
    
  },
  "js/plugin/format": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    formatKanbanCellItem(task) {
      const headingText = task.heading?.text || (typeof task.heading === "string" ? task.heading : "");
      const heading = headingText
        ? `<span class="task-kanban-inline-heading">${this.escapeTableText(headingText)}</span>`
        : "";
      const lineAttr = ` data-line="${this.escapeAttribute(task.line)}"`;
      const attrs = task.blockId
        ? `${lineAttr} data-block-id="${this.escapeAttribute(task.blockId)}" tabindex="0" draggable="true"`
        : lineAttr;
      const subtasks = task.subtasks?.length ? this.formatInlineSubtasks(task.subtasks) : "";
      const toggle = task.subtasks?.length
        ? `<button class="task-kanban-inline-subtasks-toggle" type="button" aria-expanded="false" title="Показать подзадачи">›</button>`
        : "";
      const openButton = `<button class="task-kanban-inline-open" type="button" data-line="${this.escapeAttribute(task.line)}" title="Перейти к задаче">↗</button>`;
      const textToggle = `<button class="task-kanban-inline-text-toggle" type="button" aria-expanded="false" aria-hidden="true" title="Развернуть текст" hidden>›</button>`;
      return `<div class="task-kanban-inline-card"${attrs}>${heading}<span class="task-kanban-inline-main">${toggle}<span class="task-kanban-inline-text">${this.escapeTableText(task.text)}</span>${textToggle}${openButton}</span>${subtasks}</div>`;
    },
    
    formatInlineSubtasks(subtasks) {
      const items = subtasks.map((task) => {
        const lineAttr = ` data-line="${this.escapeAttribute(task.line)}"`;
        const attrs = task.blockId
          ? `${lineAttr} data-block-id="${this.escapeAttribute(task.blockId)}" tabindex="0"`
          : lineAttr;
        const children = task.subtasks?.length ? this.formatInlineSubtasks(task.subtasks) : "";
        const status = task.blockId
          ? `<button class="task-kanban-inline-subtask-status" type="button" data-line="${this.escapeAttribute(task.line)}" data-block-id="${this.escapeAttribute(task.blockId)}" data-status-key="${this.escapeAttribute(task.status.key)}" title="${this.escapeAttribute(task.status.title)}">${this.escapeTableText(task.status.icon)}</button>`
          : `<button class="task-kanban-inline-subtask-status" type="button" data-line="${this.escapeAttribute(task.line)}" data-status-key="${this.escapeAttribute(task.status.key)}" title="${this.escapeAttribute(task.status.title)}">${this.escapeTableText(task.status.icon)}</button>`;
        const openButton = `<button class="task-kanban-inline-open" type="button" data-line="${this.escapeAttribute(task.line)}" title="Перейти к задаче">↗</button>`;
        return `<div class="task-kanban-inline-subtask"${attrs}>${status}<span class="task-kanban-inline-subtask-text">${this.escapeTableText(task.text)}</span>${openButton}${children}</div>`;
      }).join("");
      return `<div class="task-kanban-inline-subtasks">${items}</div>`;
    },
    
    escapeTableText(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\|/g, "&#124;")
        .replace(/\r?\n/g, " ");
    },
    
    escapeMarkdownLinkLabel(value) {
      return this.escapeTableText(value)
        .replace(/\\/g, "\\\\")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
    },
    
    escapeAttribute(value) {
      return this.escapeTableText(value).replace(/"/g, "&quot;");
    },
    
    escapeMarkdownInline(value) {
      return this.escapeTableText(value)
        .replace(/\\/g, "\\\\")
        .replace(/\*/g, "\\*")
        .replace(/_/g, "\\_")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
    }
    };
    
  },
  "js/plugin/block-ids": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
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
    },
    
    createUniqueBlockId(file, lineNo, text, usedIds) {
      const base = `tk-${this.hashString(`${file.path}\n${lineNo}\n${text}`).slice(0, 10)}`;
      let id = base;
      let index = 2;
      while (usedIds.has(id)) {
        id = `${base}-${index}`;
        index++;
      }
      return id;
    },
    
    hashString(value) {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    },
    
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
    },
    
    removeKanbanBlock(content) {
      const startIndex = content.indexOf(KANBAN_START);
      const endIndex = content.indexOf(KANBAN_END);
      if (startIndex < 0 || endIndex <= startIndex) return content;
      const before = content.slice(0, startIndex).replace(/\s*$/, "\n\n");
      const after = content.slice(endIndex + KANBAN_END.length).replace(/^\s*/, "");
      return `${before}${after}`.replace(/\s+$/, "\n");
    },
    
    findTopInsertIndex(lines) {
      if (lines[0]?.trim() !== "---") return 0;
      const endIndex = lines.findIndex((line, index) => index > 0 && /^(\.\.\.|---)\s*$/.test(line.trim()));
      if (endIndex < 0) return 0;
      let insertIndex = endIndex + 1;
      while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex++;
      return insertIndex;
    }
    };
    
  },
  "js/plugin/editor-checkbox": function(module, exports, require) {
    module.exports = {
    cycleEditorTaskCheckbox(editor) {
      if (!editor?.getLine || !editor.replaceRange) return;
      const from = editor.getCursor("from");
      const to = editor.getCursor("to");
      const startLine = Math.min(from.line, to.line);
      const endLine = Math.max(from.line, to.line);
      const isSingleLine = startLine === endLine;
      const cursor = editor.getCursor();
      let nextCursor = null;
    
      for (let lineNumber = endLine; lineNumber >= startLine; lineNumber--) {
        const line = editor.getLine(lineNumber) || "";
        const nextLine = this.cycleTaskCheckboxLine(line);
        if (nextLine === line) continue;
        if (isSingleLine && lineNumber === cursor.line) {
          nextCursor = this.getAdjustedTaskCheckboxCursor(line, nextLine, cursor.ch);
        }
        editor.replaceRange(
          nextLine,
          { line: lineNumber, ch: 0 },
          { line: lineNumber, ch: line.length }
        );
      }
    
      if (nextCursor !== null) {
        editor.setCursor({ line: cursor.line, ch: nextCursor });
      } else if (!isSingleLine && editor.setSelection) {
        editor.setSelection(from, to);
      }
    },
    
    cycleTaskCheckboxLine(line) {
      const indent = line.match(/^(\s*)/)?.[1] || "";
      const trimmed = line.slice(indent.length).trim();
    
      if (trimmed === "") return `${indent}- `;
      if (!trimmed.startsWith("-")) return `${indent}- ${trimmed}`;
    
      const taskMatch = trimmed.match(/^-\s+\[([^\]]*)\]\s*(.*)$/);
      if (taskMatch) {
        const marker = taskMatch[1];
        const text = taskMatch[2] || "";
        if (marker === " ") return `${indent}- [/] ${text}`;
        if (marker === "/") return `${indent}- [x] ${text}`;
        if (marker === "x" || marker === "X") return `${indent}- ${text}`;
      }
    
      const text = trimmed.replace(/^-+\s*/, "");
      return `${indent}- [ ] ${text}`;
    },
    
    getAdjustedTaskCheckboxCursor(line, nextLine, cursorCh) {
      const before = line.slice(0, cursorCh);
      let nextCursor = before.length + nextLine.length - line.length;
      nextCursor = Math.max(0, Math.min(nextLine.length, nextCursor));
    
      if (
        nextLine.startsWith("- [ ]") ||
        nextLine.startsWith("- [/]") ||
        nextLine.startsWith("- [x]")
      ) {
        const bracketPos = nextLine.indexOf("]");
        if (nextCursor === bracketPos + 1) {
          nextCursor += 1;
        }
      }
    
      return nextCursor;
    }
    };
    
  },
  "js/plugin/task-actions": function(module, exports, require) {
    const { MarkdownView, Notice, TFile } = require("obsidian");
    const {
      BLOCK_ID_RE,
      INLINE_KANBAN_CHECKBOX_REFRESH_DELAY,
      INLINE_KANBAN_EDITOR_REFRESH_DELAY,
      INLINE_KANBAN_REFRESH_DELAY,
      KANBAN_END,
      KANBAN_START,
      STATUSES,
      STATUS_BY_ICON,
      STATUS_BY_KEY,
      STATUS_BY_MARKER,
      SUBTASK_STATUS_CYCLE,
      TASK_KANBAN_DRAG_MIME,
      TASK_LINE_RE,
      VIEW_TYPE_TASK_KANBAN
    } = require("../constants");
    
    module.exports = {
    async setTaskStatus(task, status) {
      const openView = this.findOpenMarkdownView(task.file);
      if (openView?.editor) {
        const content = openView.editor.getValue();
        const lines = content.split(/\r?\n/);
        const line = lines[task.line] || "";
        const nextLine = line.replace(TASK_LINE_RE, `$1- [${status.marker}] $3`);
        if (nextLine === line) return;
        openView.editor.replaceRange(
          nextLine,
          { line: task.line, ch: 0 },
          { line: task.line, ch: line.length }
        );
        await this.rememberTaskTouched(task);
        return;
      }
    
      let changed = false;
      await this.app.vault.process(task.file, (content) => {
        const lines = content.split(/\r?\n/);
        const line = lines[task.line] || "";
        const nextLine = line.replace(TASK_LINE_RE, `$1- [${status.marker}] $3`);
        if (nextLine === line) return content;
        changed = true;
        lines[task.line] = nextLine;
        return lines.join("\n");
      });
      if (changed) await this.rememberTaskTouched(task);
    },
    
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
    
  }
  };
  const __cache = {};

  function normalize(id) {
    return id.replace(/\\/g, "/").replace(/\.js$/, "");
  }

  function __resolve(request, parentId) {
    if (request === "obsidian") return request;
    if (!request.startsWith(".")) return request;
    const base = parentId.slice(0, parentId.lastIndexOf("/"));
    const parts = (base + "/" + request).split("/");
    const stack = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") stack.pop();
      else stack.push(part);
    }
    return normalize(stack.join("/"));
  }

  function __require(id, parentId) {
    const resolved = __resolve(id, parentId || "");
    if (resolved === "obsidian") return require("obsidian");
    if (__cache[resolved]) return __cache[resolved].exports;
    const factory = __modules[resolved];
    if (!factory) throw new Error("Cannot find bundled module " + resolved);
    const module = { exports: {} };
    __cache[resolved] = module;
    factory(module, module.exports, (request) => __require(request, resolved));
    return module.exports;
  }

  module.exports = __require("./js/plugin");
})();
