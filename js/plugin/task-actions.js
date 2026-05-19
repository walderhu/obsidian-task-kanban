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
    const changed = this.updateTaskLinesByBlockId(lines, task.blockId, status, true, task.line);
    if (!changed) return;
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = openView.editor.getLine(index) || "";
      if (lines[index] === line) continue;
      openView.editor.replaceRange(
        lines[index],
        { line: index, ch: 0 },
        { line: index, ch: line.length }
      );
    }
    await this.rememberTaskTouched(task);
    return;
  }

  let changed = false;
  await this.app.vault.process(task.file, (content) => {
    const lines = content.split(/\r?\n/);
    if (!this.updateTaskLinesByBlockId(lines, task.blockId, status, true, task.line)) return content;
    changed = true;
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
