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
  if (!state?.editor) return;
  const restore = () => {
    if (state.cursor) state.editor.setCursor(state.cursor);
    if (state.scrollInfo && state.editor.scrollTo) {
      state.editor.scrollTo(state.scrollInfo.left, state.scrollInfo.top);
    }
  };
  restore();
  window.requestAnimationFrame(restore);
},

hasKanbanBlock(content) {
  const startIndex = content.indexOf(KANBAN_START);
  const endIndex = content.indexOf(KANBAN_END);
  return startIndex >= 0 && endIndex > startIndex;
}
};
