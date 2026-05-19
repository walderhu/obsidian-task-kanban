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
    const content = "<span class=\"task-kanban-inline-empty\">Пусто</span>";
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
