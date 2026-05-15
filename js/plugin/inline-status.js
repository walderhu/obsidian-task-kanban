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
