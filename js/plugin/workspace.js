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
  this.handleMarkdownTaskStateChanged(file, INLINE_KANBAN_CHECKBOX_REFRESH_DELAY);
  window.setTimeout(() => this.handleMarkdownTaskStateChanged(file, 0), INLINE_KANBAN_EDITOR_REFRESH_DELAY);
  // Backup refresh: Obsidian may write the file to disk later than the event fires
  window.setTimeout(() => this.handleMarkdownTaskStateChanged(file, 0), 1200);
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
