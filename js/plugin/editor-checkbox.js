module.exports = {
cycleEditorTaskCheckbox(editor) {
  if (!editor?.getLine || !editor.replaceRange) return;
  const from = editor.getCursor("from");
  const to = editor.getCursor("to");
  const startLine = Math.min(from.line, to.line);
  const endLine = Math.max(from.line, to.line);
  const isSingleLine = startLine === endLine;
  const cursor = editor.getCursor();
  let nextCursor = null;

  for (let lineNumber = endLine; lineNumber >= startLine; lineNumber--) {
    const line = editor.getLine(lineNumber) || "";
    const nextLine = this.cycleTaskCheckboxLine(line);
    if (nextLine === line) continue;
    if (isSingleLine && lineNumber === cursor.line) {
      nextCursor = this.getAdjustedTaskCheckboxCursor(line, nextLine, cursor.ch);
    }
    editor.replaceRange(
      nextLine,
      { line: lineNumber, ch: 0 },
      { line: lineNumber, ch: line.length }
    );
  }

  if (nextCursor !== null) {
    editor.setCursor({ line: cursor.line, ch: nextCursor });
  } else if (!isSingleLine && editor.setSelection) {
    editor.setSelection(from, to);
  }
},

cycleTaskCheckboxLine(line) {
  const indent = line.match(/^(\s*)/)?.[1] || "";
  const trimmed = line.slice(indent.length).trim();

  if (trimmed === "") return `${indent}- `;
  if (!trimmed.startsWith("-")) return `${indent}- ${trimmed}`;

  const taskMatch = trimmed.match(/^-\s+\[([^\]]*)\]\s*(.*)$/);
  if (taskMatch) {
    const marker = taskMatch[1];
    const text = taskMatch[2] || "";
    if (marker === " ") return `${indent}- [/] ${text}`;
    if (marker === "/") return `${indent}- [x] ${text}`;
    if (marker === "x" || marker === "X") return `${indent}- ${text}`;
  }

  const text = trimmed.replace(/^-+\s*/, "");
  return `${indent}- [ ] ${text}`;
},

getAdjustedTaskCheckboxCursor(line, nextLine, cursorCh) {
  const before = line.slice(0, cursorCh);
  let nextCursor = before.length + nextLine.length - line.length;
  nextCursor = Math.max(0, Math.min(nextLine.length, nextCursor));

  if (
    nextLine.startsWith("- [ ]") ||
    nextLine.startsWith("- [/]") ||
    nextLine.startsWith("- [x]")
  ) {
    const bracketPos = nextLine.indexOf("]");
    if (nextCursor === bracketPos + 1) {
      nextCursor += 1;
    }
  }

  return nextCursor;
}
};
