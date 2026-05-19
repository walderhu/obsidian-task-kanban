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
  const changedLine = this.getEditorCheckboxEventLine(event, file);
  this.rememberActiveEditorTaskTouched(file, changedLine);
  window.clearTimeout(this._parentSyncTimer);
  window.clearTimeout(this._checkboxCascadeTimer);
  // Let Obsidian apply the direct checkbox edit first, then cascade from that final line state.
  this._checkboxCascadeTimer = window.setTimeout(() => {
    this.syncTaskTreeFromActiveEditorChange(file, changedLine);
    this.handleMarkdownTaskStateChanged(file, 0);
  }, 80);
},

syncParentsInActiveEditor(file) {
  if (!(file instanceof TFile) || file.extension !== "md") return;
  const view = this.findOpenMarkdownView(file);
  if (!view?.editor?.getValue || !view.editor.replaceRange) return;
  const content = view.editor.getValue();
  const lines = content.split(/\r?\n/);
  const originalLines = content.split(/\r?\n/);

  // Bottom-to-top: children processed before their parents
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].match(TASK_LINE_RE)) {
      this.syncParentStatusFromSubtasks(lines, i);
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === originalLines[i]) continue;
    view.editor.replaceRange(
      lines[i],
      { line: i, ch: 0 },
      { line: i, ch: (originalLines[i] || "").length }
    );
  }
},

syncTaskTreeFromActiveEditorChange(file, changedLine = null) {
  if (!(file instanceof TFile) || file.extension !== "md") return;
  const view = this.findOpenMarkdownView(file);
  if (!view?.editor?.getValue || !view.editor.replaceRange) return;
  const targetLine = Number.isInteger(changedLine) ? changedLine : view.editor.getCursor?.()?.line;
  const content = view.editor.getValue();
  const lines = content.split(/\r?\n/);
  const originalLines = content.split(/\r?\n/);

  if (Number.isInteger(targetLine) && this.taskLineHasSubtasks(lines, targetLine)) {
    const taskMatch = lines[targetLine]?.match(TASK_LINE_RE);
    const status = STATUS_BY_MARKER.get(taskMatch?.[2]) || STATUSES[0];
    this.updateTaskLinesByBlockId(lines, null, status, true, targetLine);
  } else {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].match(TASK_LINE_RE)) {
        this.syncParentStatusFromSubtasks(lines, i);
      }
    }
  }

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] === originalLines[i]) continue;
    view.editor.replaceRange(
      lines[i],
      { line: i, ch: 0 },
      { line: i, ch: (originalLines[i] || "").length }
    );
  }
},

getEditorCheckboxEventLine(event, file) {
  if (!(file instanceof TFile) || file.extension !== "md") return null;
  const view = this.findOpenMarkdownView(file);
  const editor = view?.editor;
  if (!editor?.getValue) return null;

  const target = event.target instanceof Element ? event.target : null;
  const lineElement = target?.closest(".cm-line, .HyperMD-task-line");
  const lineText = lineElement?.textContent || "";
  const textLine = this.findTaskLineByRenderedText(editor, lineText, editor.getCursor?.()?.line);
  if (Number.isInteger(textLine)) return textLine;

  const posFromCoords = this.getEditorLineFromEventCoords(event, editor);
  if (Number.isInteger(posFromCoords)) return posFromCoords;

  const cursorLine = editor.getCursor?.()?.line;
  return Number.isInteger(cursorLine) ? cursorLine : null;
},

findTaskLineByRenderedText(editor, renderedText, nearLine = null) {
  const needle = this.normalizeTaskLineText(renderedText);
  if (!needle) return null;
  const lines = editor.getValue().split(/\r?\n/);
  const matches = [];
  for (let i = 0; i < lines.length; i++) {
    if (this.normalizeTaskLineText(lines[i]) === needle) matches.push(i);
  }
  if (matches.length === 0) return null;
  if (!Number.isInteger(nearLine)) return matches[0];
  return matches.reduce((best, line) => (
    Math.abs(line - nearLine) < Math.abs(best - nearLine) ? line : best
  ), matches[0]);
},

normalizeTaskLineText(text) {
  const cleaned = String(text || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const taskMatch = cleaned.match(/^(?:[-*]\s+)?(?:\[[^\]]*\]\s*)?(.+)$/);
  return (taskMatch?.[1] || "").replace(BLOCK_ID_RE, "").trim();
},

getEditorLineFromEventCoords(event, editor) {
  const clientX = event?.clientX;
  const clientY = event?.clientY;
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const cm = editor.cm;
  const offset = cm?.posAtCoords?.({ x: clientX, y: clientY })
    ?? cm?.posAtCoords?.({ left: clientX, top: clientY });
  const lineNumber = Number.isInteger(offset) ? cm?.state?.doc?.lineAt(offset)?.number - 1 : null;
  return Number.isInteger(lineNumber) ? lineNumber : null;
},

taskLineHasSubtasks(lines, lineNumber) {
  const taskMatch = lines[lineNumber]?.match(TASK_LINE_RE);
  if (!taskMatch) return false;
  const parentIndent = this.getIndentLevel(taskMatch[1] || "");
  for (let i = lineNumber + 1; i < lines.length; i++) {
    const match = lines[i].match(TASK_LINE_RE);
    if (!match) continue;
    const indent = this.getIndentLevel(match[1] || "");
    if (indent <= parentIndent) return false;
    return true;
  }
  return false;
},

rememberActiveEditorTaskTouched(file, line = null) {
  if (!(file instanceof TFile) || file.extension !== "md") return;
  const view = this.findOpenMarkdownView(file);
  const touchedLine = Number.isInteger(line) ? line : view?.editor?.getCursor?.()?.line;
  if (!Number.isInteger(touchedLine)) return;
  const raw = view.editor.getLine?.(touchedLine) || "";
  const taskMatch = raw.match(TASK_LINE_RE);
  if (!taskMatch) return;
  const rawText = taskMatch[3].trim();
  this.rememberTaskTouched({
    file,
    line: touchedLine,
    raw,
    blockId: rawText.match(BLOCK_ID_RE)?.[1] || "",
    text: rawText.replace(BLOCK_ID_RE, "").trim()
  });
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
