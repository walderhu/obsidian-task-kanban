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
