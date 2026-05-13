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
