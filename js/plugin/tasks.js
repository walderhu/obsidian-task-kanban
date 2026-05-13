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
async collectTasks(activeFileOnly) {
  const activeFile = this.app.workspace.getActiveFile();
  const files = activeFileOnly && activeFile
    ? [activeFile]
    : this.app.vault.getMarkdownFiles();
  const results = [];

  for (const file of files) {
    const text = await this.readMarkdownFileContent(file);
    results.push(...this.scanTasksInContent(file, text));
  }

  return this.sortTasksForKanban(results);
},

async readMarkdownFileContent(file) {
  const view = this.findOpenMarkdownView(file);
  const editorText = view?.editor?.getValue?.();
  if (typeof editorText === "string") return editorText;
  return this.app.vault.read(file);
},

scanTasksInContent(file, content) {
  const lines = content.split(/\r?\n/);
  const tasks = [];
  const roots = [];
  const stack = [];
  let heading = "";
  let insideGeneratedKanban = false;

  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    if (raw.trim() === KANBAN_START) {
      insideGeneratedKanban = true;
      continue;
    }
    if (raw.trim() === KANBAN_END) {
      insideGeneratedKanban = false;
      continue;
    }
    if (insideGeneratedKanban) continue;

    const headingMatch = raw.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) heading = headingMatch[2].trim();

    const taskMatch = raw.match(TASK_LINE_RE);
    if (!taskMatch) continue;
    const marker = taskMatch[2];
    const status = STATUS_BY_MARKER.get(marker) || STATUSES[0];
    const rawText = taskMatch[3].trim();
    const priority = Array.from(rawText.match(/^(🔥+)/u)?.[1] || "").length;
    const blockId = rawText.match(BLOCK_ID_RE)?.[1] || "";
    const task = {
      file,
      line,
      raw,
      indent: taskMatch[1] || "",
      indentLevel: this.getIndentLevel(taskMatch[1] || ""),
      marker,
      blockId,
      text: rawText.replace(BLOCK_ID_RE, "").trim(),
      priority,
      status,
      heading,
      subtasks: []
    };

    while (stack.length && stack[stack.length - 1].indentLevel >= task.indentLevel) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.subtasks.push(task);
    } else {
      roots.push(task);
    }
    tasks.push(task);
    stack.push(task);
  }

  return roots;
},

getIndentLevel(indent) {
  let level = 0;
  for (const char of indent) {
    level += char === "\t" ? 4 : 1;
  }
  return level;
}
};
