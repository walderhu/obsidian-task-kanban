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
ensureTaskBlockIds(file, content) {
  const lines = content.split(/\r?\n/);
  const usedIds = new Set();
  let insideGeneratedKanban = false;

  for (const line of lines) {
    const id = line.match(BLOCK_ID_RE)?.[1];
    if (id) usedIds.add(id);
  }

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
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
    if (!taskMatch || BLOCK_ID_RE.test(taskMatch[3])) continue;
    const id = this.createUniqueBlockId(file, lineNo, taskMatch[3], usedIds);
    usedIds.add(id);
    lines[lineNo] = `${raw} ^${id}`;
  }

  return lines.join("\n");
},

createUniqueBlockId(file, lineNo, text, usedIds) {
  const base = `tk-${this.hashString(`${file.path}\n${lineNo}\n${text}`).slice(0, 10)}`;
  let id = base;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${base}-${index}`;
    index++;
  }
  return id;
},

hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
},

replaceOrInsertKanbanBlock(content, block) {
  const startIndex = content.indexOf(KANBAN_START);
  const endIndex = content.indexOf(KANBAN_END);
  if (startIndex >= 0 && endIndex > startIndex) {
    const before = content.slice(0, startIndex).replace(/\s*$/, "\n\n");
    const after = content.slice(endIndex + KANBAN_END.length).replace(/^\s*/, "\n\n");
    return `${before}${block}${after}`.replace(/\s+$/, "\n");
  }

  const lines = content.split(/\r?\n/);
  const insertIndex = this.findTopInsertIndex(lines);
  lines.splice(insertIndex, 0, block, "");
  return lines.join("\n").replace(/\s+$/, "\n");
},

removeKanbanBlock(content) {
  const startIndex = content.indexOf(KANBAN_START);
  const endIndex = content.indexOf(KANBAN_END);
  if (startIndex < 0 || endIndex <= startIndex) return content;
  const before = content.slice(0, startIndex).replace(/\s*$/, "\n\n");
  const after = content.slice(endIndex + KANBAN_END.length).replace(/^\s*/, "");
  return `${before}${after}`.replace(/\s+$/, "\n");
},

findTopInsertIndex(lines) {
  if (lines[0]?.trim() !== "---") return 0;
  const endIndex = lines.findIndex((line, index) => index > 0 && /^(\.\.\.|---)\s*$/.test(line.trim()));
  if (endIndex < 0) return 0;
  let insertIndex = endIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() === "") insertIndex++;
  return insertIndex;
}
};
