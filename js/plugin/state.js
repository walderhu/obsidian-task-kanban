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
    headingFilters: this.inlineKanbanHeadingFilters || {}
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
