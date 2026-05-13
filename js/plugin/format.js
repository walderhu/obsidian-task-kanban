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
