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
async saveInlineHeadingFilterSelection(sourcePath, menu) {
  const options = Array.from(menu.querySelectorAll(".task-kanban-inline-filter-option:not([data-filter-all]) input[type='checkbox']"));
  const selected = options.filter((option) => option.checked).map((option) => option.value);
  this.inlineKanbanHeadingFilters ||= {};
  if (!options.length || selected.length === options.length) {
    delete this.inlineKanbanHeadingFilters[sourcePath];
  } else {
    this.inlineKanbanHeadingFilters[sourcePath] = selected;
  }
  await this.savePluginData();
},

async saveInlineSortSelection(input) {
  await this.setTaskKanbanSortMode(input?.value || "default");
},

closeInlineFilters(element) {
  for (const filter of element.querySelectorAll(".task-kanban-inline-filter.is-open")) {
    filter.classList.remove("is-open");
    filter.querySelector(".task-kanban-inline-filter-toggle")?.setAttribute("aria-expanded", "false");
  }
},

setAllInlineSubtasksExpanded(element, expand) {
  for (const card of element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask")) {
    if (!card.querySelector(":scope > .task-kanban-inline-subtasks")) continue;
    card.classList.toggle("is-expanded", expand);
    this.rememberInlineExpandedState(card, expand);
    const button = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-subtasks-toggle");
    if (button) {
      button.setAttribute("aria-expanded", String(expand));
      button.textContent = expand ? "⌄" : "›";
    }
  }
  this.updateInlineExpandToggle(element);
},

toggleInlineCardText(card) {
  if (!card.classList.contains("has-overflowing-text")) return;
  const textToggle = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text-toggle");
  const expanded = !card.classList.contains("is-text-expanded");
  card.classList.toggle("is-text-expanded", expanded);
  if (textToggle) {
    textToggle.setAttribute("aria-expanded", String(expanded));
    textToggle.textContent = expanded ? "‹" : "›";
    textToggle.setAttribute("title", expanded ? "Свернуть текст" : "Развернуть текст");
  }
},

updateInlineTextOverflowControls(element) {
  window.requestAnimationFrame(() => {
    for (const card of element.querySelectorAll(".task-kanban-inline-card")) {
      const text = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text");
      const toggle = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-text-toggle");
      if (!text || !toggle) continue;
      const wasExpanded = card.classList.contains("is-text-expanded");
      if (wasExpanded) card.classList.remove("is-text-expanded");
      toggle.hidden = true;
      toggle.setAttribute("aria-hidden", "true");
      const lineHeight = Number.parseFloat(getComputedStyle(text).lineHeight) || 18;
      const overflowing = text.scrollHeight > lineHeight * 3 + 2;
      card.classList.toggle("has-overflowing-text", overflowing);
      toggle.hidden = !overflowing;
      toggle.setAttribute("aria-hidden", String(!overflowing));
      if (!overflowing) {
        toggle.setAttribute("aria-expanded", "false");
        card.classList.remove("is-text-expanded");
      } else if (wasExpanded) {
        card.classList.add("is-text-expanded");
      }
    }
  });
},

updateInlineExpandToggle(element) {
  const button = element.querySelector(".task-kanban-inline-expand-toggle");
  if (!button) return;
  const expandable = Array.from(element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask"))
    .filter((card) => card.querySelector(":scope > .task-kanban-inline-subtasks"));
  const allExpanded = expandable.length > 0 && expandable.every((card) => card.classList.contains("is-expanded"));
  button.disabled = expandable.length === 0;
  button.setAttribute("aria-pressed", String(allExpanded));
  button.textContent = allExpanded ? "Свернуть" : "Развернуть";
},

expandInlineKanbanCallout(element) {
  const callout = element.closest(".callout");
  if (!callout) return false;
  const wasCollapsed = callout.classList.contains("is-collapsed")
    || callout.getAttribute("data-callout-fold") === "-";
  callout.classList.remove("is-collapsed");
  if (callout.hasAttribute("data-callout-fold")) {
    callout.setAttribute("data-callout-fold", "+");
  }

  for (const content of callout.querySelectorAll(".callout-content")) {
    content.style.removeProperty("display");
    content.style.removeProperty("height");
    content.style.removeProperty("min-height");
    content.style.removeProperty("margin");
    content.style.removeProperty("padding");
    content.style.removeProperty("overflow");
  }
  const fold = callout.querySelector(".callout-fold, .collapse-indicator");
  fold?.classList?.remove?.("is-collapsed");
  fold?.setAttribute("aria-expanded", "true");
  return wasCollapsed;
},

async syncInlineKanbanDom(element, file) {
  if (!element.querySelector(".task-kanban-inline-marker")) return;
  this.syncInlineReadonlyState(element, file.path);
  const expandedBlockIds = new Set(
    Array.from(element.querySelectorAll(".task-kanban-inline-card.is-expanded, .task-kanban-inline-subtask.is-expanded"))
      .map((card) => this.getInlineBlockId(card))
      .filter(Boolean)
  );
  for (const blockId of this.inlineKanbanExpandedBlockIds.get(file.path) || []) {
    expandedBlockIds.add(blockId);
  }
  const content = await this.readMarkdownFileContent(file);
  const tasks = this.scanTasksInContent(file, content);
  this.ensureInlineFilterControl(element);
  this.renderInlineHeadingFilter(element, tasks);
  this.renderInlineSortMenu(element);
  const selectedHeadings = this.getInlineSelectedHeadings(element, tasks);
  const visibleTasks = this.sortTasksForKanban(tasks.filter((task) => {
    const headingText = typeof task.heading === "string" ? task.heading : task.heading?.text || "";
    return selectedHeadings.has(headingText);
  }));

  for (const status of STATUSES) {
    const column = element.querySelector(`.task-kanban-inline-column[data-status-key="${status.key}"]`);
    if (!column) continue;
    const items = visibleTasks.filter((task) => task.status.key === status.key);
    column.innerHTML = items.length
      ? items.map((task) => this.formatKanbanCellItem(task)).join("")
      : "<span class=\"task-kanban-inline-empty\">Пусто</span>";
  }
  this.restoreInlineExpandedState(element, expandedBlockIds);
  this.syncInlineReadonlyState(element, file.path);
  this.updateInlineTextOverflowControls(element);

  const table = element.querySelector("table:has(.task-kanban-inline-marker)");
  if (!table) return;
  const headers = Array.from(table.querySelectorAll("th"));
  STATUSES.forEach((status, index) => {
    const header = headers[index];
    if (!header) return;
    const count = visibleTasks.filter((task) => task.status.key === status.key).length;
    header.textContent = `${status.icon} ${status.title} (${count})`;
  });
},

ensureInlineFilterControl(element) {
  const actions = element.querySelector(".task-kanban-inline-title-actions");
  if (!actions) return;
  if (!actions.querySelector(".task-kanban-inline-filter")) {
    const filter = document.createElement("span");
    filter.className = "task-kanban-inline-filter";
    filter.innerHTML = '<button class="task-kanban-inline-action task-kanban-inline-filter-toggle" type="button" aria-expanded="false">Фильтр</button><span class="task-kanban-inline-filter-menu"></span>';
    actions.prepend(filter);
  }
  if (!actions.querySelector(".task-kanban-inline-sort")) {
    const sort = document.createElement("span");
    sort.className = "task-kanban-inline-sort";
    sort.innerHTML = '<button class="task-kanban-inline-action task-kanban-inline-sort-toggle" type="button" aria-expanded="false">Сортировка</button><span class="task-kanban-inline-sort-menu"></span>';
    const filter = actions.querySelector(".task-kanban-inline-filter");
    filter ? filter.insertAdjacentElement("afterend", sort) : actions.prepend(sort);
  }
  if (!actions.querySelector(".task-kanban-inline-expand-toggle")) {
    const expandButton = document.createElement("button");
    expandButton.className = "task-kanban-inline-action task-kanban-inline-expand-toggle";
    expandButton.type = "button";
    expandButton.setAttribute("aria-pressed", "false");
    expandButton.textContent = "Развернуть";
    const hiddenToggle = actions.querySelector(".task-kanban-inline-hidden-toggle");
    actions.insertBefore(expandButton, hiddenToggle || actions.firstChild?.nextSibling || null);
  }
},

buildHeadingTree(headingObjects) {
  const headings = headingObjects
    .filter(Boolean)
    .map(h => typeof h === "string" ? { level: 1, text: h } : h);

  const uniqueMap = new Map();
  for (const h of headings) {
    if (!uniqueMap.has(h.text)) {
      uniqueMap.set(h.text, h);
    }
  }

  const items = Array.from(uniqueMap.values());
  const tree = [];
  const stack = [];

  for (const item of items) {
    while (stack.length > 0 && stack[stack.length - 1].level >= item.level) {
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    const node = { ...item, children: [] };

    if (parent) {
      parent.children.push(node);
    } else {
      tree.push(node);
    }
    stack.push(node);
  }

  return tree;
},

renderHeadingTreeOptions(nodes, selected, depth = 0) {
  let html = "";
  for (const node of nodes) {
    const indent = depth * 20;
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = node._expanded !== false;
    const checked = selected.has(node.text) ? "checked" : "";
    const expandBtn = hasChildren ? `<button class="task-kanban-heading-expand" style="margin-left: ${indent}px" data-heading="${this.escapeAttribute(node.text)}" type="button" aria-expanded="${isExpanded}"> ${isExpanded ? "▼" : "▶"} </button>` : `<span style="margin-left: ${indent + 20}px"></span>`;

    html += `<div class="task-kanban-heading-option" data-heading-text="${this.escapeAttribute(node.text)}" data-heading-level="${node.level}">
      ${expandBtn}
      <label class="task-kanban-inline-filter-option" style="margin-left: 0">
        <input type="checkbox" value="${this.escapeAttribute(node.text)}" ${checked} data-parent="${this.escapeAttribute(node.text)}">
        ${this.escapeTableText(node.text || "Без заголовка")}
      </label>
    </div>`;

    if (hasChildren && isExpanded) {
      html += this.renderHeadingTreeOptions(node.children, selected, depth + 1);
    }
  }
  return html;
},

renderInlineHeadingFilter(element, tasks) {
  const menu = element.querySelector(".task-kanban-inline-filter-menu");
  if (!menu) return;
  const previousSelected = new Set(
    Array.from(menu.querySelectorAll("input[type='checkbox']:not([data-filter-all]):checked"))
      .map((input) => input.value)
  );
  const headingObjects = Array.from(tasks.map((task) => task.heading || ""));
  const hasPreviousState = menu.dataset.initialized === "true";
  const savedSelected = this.inlineKanbanHeadingFilters?.[element.dataset.taskKanbanSourcePath];
  const headingTexts = Array.from(new Set(headingObjects.map(h => typeof h === "string" ? h : h?.text || "")));
  const selected = hasPreviousState
    ? previousSelected
    : Array.isArray(savedSelected)
      ? new Set(savedSelected)
      : new Set(headingTexts);
  menu.dataset.initialized = "true";
  const allChecked = headingTexts.length > 0 && headingTexts.every((heading) => selected.has(heading));
  const tree = this.buildHeadingTree(headingObjects);
  const treeHtml = this.renderHeadingTreeOptions(tree, selected);
  const html = `<label class="task-kanban-inline-filter-option" data-filter-all="true"><input type="checkbox" ${allChecked ? "checked" : ""}>Все</label>${treeHtml}`;
  menu.innerHTML = html;
},

renderInlineSortMenu(element) {
  const menu = element.querySelector(".task-kanban-inline-sort-menu");
  if (!menu) return;
  const sourcePath = element.dataset.taskKanbanSourcePath || "global";
  const options = [
    ["default", "По умолчанию"],
    ["touched", "Последние сверху"],
    ["priority", "По приоритету 🔥"]
  ].map(([value, label]) => {
    const checked = (this.taskKanbanSortMode || "default") === value ? "checked" : "";
    return `<label class="task-kanban-inline-sort-option"><input type="radio" name="task-kanban-sort-${this.escapeAttribute(sourcePath)}" value="${this.escapeAttribute(value)}" ${checked}>${this.escapeTableText(label)}</label>`;
  });
  menu.innerHTML = options.join("");
},

getInlineSelectedHeadings(element, tasks) {
  const headingObjects = Array.from(new Set(tasks.map((task) => task.heading || "")));
  const headingTexts = headingObjects.map(h => typeof h === "string" ? h : h?.text || "");
  const menu = element.querySelector(".task-kanban-inline-filter-menu");
  if (!menu) return new Set(headingTexts);
  const selected = new Set(
    Array.from(menu.querySelectorAll(".task-kanban-inline-filter-option:not([data-filter-all]) input:checked"))
      .map((input) => input.value)
  );
  return selected;
},

restoreInlineExpandedState(element, expandedBlockIds) {
  if (!expandedBlockIds.size) {
    this.updateInlineExpandToggle(element);
    return;
  }
  for (const card of element.querySelectorAll(".task-kanban-inline-card, .task-kanban-inline-subtask")) {
    if (!expandedBlockIds.has(this.getInlineBlockId(card))) continue;
    card.classList.add("is-expanded");
    const button = card.querySelector(":scope > .task-kanban-inline-main > .task-kanban-inline-subtasks-toggle");
    if (button) {
      button.setAttribute("aria-expanded", "true");
      button.textContent = "⌄";
    }
  }
  this.updateInlineExpandToggle(element);
}
};
