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
    id: "open-task-kanban",
    name: "Open Task Kanban",
    callback: () => this.activateView()
  });

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

  this.registerEvent(this.app.vault.on("modify", (file) => {
    this.handleMarkdownTaskStateChanged(file);
  }));
  this.registerEvent(this.app.metadataCache.on("changed", (file) => {
    this.handleMarkdownTaskStateChanged(file, INLINE_KANBAN_EDITOR_REFRESH_DELAY);
  }));
  this.registerEvent(this.app.workspace.on("editor-change", (_editor, info) => {
    const file = info?.file;
    this.handleMarkdownTaskStateChanged(file, INLINE_KANBAN_EDITOR_REFRESH_DELAY);
  }));
  this.registerDomEvent(document, "click", (event) => {
    this.handleEditorCheckboxEvent(event);
  }, true);
  this.registerDomEvent(document, "change", (event) => {
    this.handleEditorCheckboxEvent(event);
  }, true);
  this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
    this.refreshOpenViews();
    const file = this.app.workspace.getActiveFile();
    if (file instanceof TFile && file.extension === "md") {
      this.scheduleInlineKanbanRefresh(file, 0);
    }
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
