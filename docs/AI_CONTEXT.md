# Task Kanban AI Context

Purpose: Obsidian plugin that builds a Kanban board from Markdown checkbox tasks.

Entry points:
- `main.js` is the runtime bundle Obsidian loads. Do not replace it with `require("./js/plugin")`: Obsidian evaluates plugin code as a string, so relative runtime requires are unreliable.
- Edit files in `js/`, then run `node scripts/build-main.js` to regenerate bundled `main.js`.
- `styles.css` is the runtime stylesheet Obsidian loads. Keep it self-contained; `@import` from plugin CSS was not reliable in Obsidian.
- `styles/` contains the same CSS split by domain for AI/context navigation.

Core JS map:
- `js/constants.js`: shared status definitions, Kanban block markers, regexes, debounce timings.
- `js/view.js`: side-panel `TaskKanbanView`; renders global board, search, current-file scope toggle, card actions.
- `js/plugin.js`: plugin lifecycle (`onload`, `onunload`), command registration, markdown postprocessor, event hooks.
- `js/plugin/state.js`: inline card state helpers, expanded-subtask memory, status lookup helpers.
- `js/plugin/inline-status.js`: inline subtask/status updates, drag-drop target updates, editor/vault mutation of task lines.
- `js/plugin/workspace.js`: view refresh scheduling, markdown checkbox detection, rendered inline Kanban tracking.
- `js/plugin/inline-delegates.js`: delegated DOM handlers for inline board clicks, filters, text expansion, drag/drop.
- `js/plugin/inline-dom.js`: inline DOM rebuild, heading filter UI, expand/collapse controls, callout expansion.
- `js/plugin/inline-refresh.js`: generated Kanban block refresh, active editor state capture/restore, open markdown view lookup.
- `js/plugin/tasks.js`: markdown task scanner, task tree construction, active/open editor reads.
- `js/plugin/markdown-block.js`: insert/delete/build generated Kanban callout block.
- `js/plugin/format.js`: HTML/markdown escaping and inline card/subtask markup generation.
- `js/plugin/block-ids.js`: stable block-id insertion, hashing, generated block replace/remove helpers.
- `js/plugin/task-actions.js`: side-board task status updates and open-task navigation.

CSS map:
- `styles/board.css`: side-panel view layout, toolbar, columns, cards.
- `styles/inline-board.css`: inline generated table/callout, columns, inline cards, subtasks, overflow controls.
- `styles/inline-controls.css`: callout title actions, heading filter dropdown, inline action buttons.
- `styles/responsive.css`: compact side-panel layout below 980px.

Behavior notes:
- Generated inline blocks are bounded by `KANBAN_START` and `KANBAN_END`; scanners skip this generated region.
- Every real Markdown task receives a stable `^tk-*` block id when needed, so inline cards can update the original line.
- Inline status drag/drop and subtask toggles only mutate files when the source markdown view is not in preview mode.
- The side-panel board reads all markdown files unless `activeFileOnly` is enabled.
- Heading filters are persisted via `saveData()` under `headingFilters`.

Fast future workflow:
- For parsing/status issues, read `js/constants.js`, `js/plugin/tasks.js`, `js/plugin/block-ids.js`, and the relevant status updater.
- For inline UI issues, read `js/plugin/inline-delegates.js`, `js/plugin/inline-dom.js`, and `styles/inline-*`.
- For side-panel UI issues, read `js/view.js` and `styles/board.css`.
- For generated markdown format issues, read `js/plugin/markdown-block.js` and `js/plugin/format.js`.
