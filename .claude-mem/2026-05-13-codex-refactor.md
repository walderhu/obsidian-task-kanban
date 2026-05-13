# 2026-05-13 Codex Refactor Summary

User asked to read Claude context, understand prior project state, split monolithic `main.js` and `styles.css` into logical files, and add AI-facing documentation so future sessions do not need to load full files.

Read:
- `CLAUDE.md`: local rules, memory expectations, RuFlo/Claude Flow notes.
- `.claude-flow/metrics/codebase-map.json` and `consolidation.json`: only basic project scan metadata.
- Existing `main.js` and `styles.css`.

Current architecture after this refactor:
- `main.js` is a generated self-contained bundle. Obsidian plugin loader cannot reliably use relative runtime `require("./js/...")` because it evaluates `main.js` as a string.
- Edit source modules in `js/`, then run `node scripts/build-main.js`.
- JS modules live under `js/` and `js/plugin/`.
- Root `styles.css` stays self-contained because Obsidian did not reliably apply CSS `@import` from plugin styles.
- Logical CSS copies live under `styles/` for faster AI navigation.
- AI map is in `docs/AI_CONTEXT.md`.

Important behavior preserved:
- Generated Kanban region markers stay `<!-- task-kanban:start -->` and `<!-- task-kanban:end -->`.
- Statuses remain open/progress/done/canceled/proposal.
- Inline cards update real markdown tasks using `^tk-*` block ids.
- Scanners still skip generated Kanban blocks.
