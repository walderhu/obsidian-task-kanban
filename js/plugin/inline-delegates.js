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
bindInlineKanbanDelegates(element, sourcePath) {
  if (element.dataset.taskKanbanDelegatesBound === "true") return;
  element.dataset.taskKanbanDelegatesBound = "true";

  for (const eventName of ["pointerdown", "mousedown", "mouseup", "click"]) {
    element.addEventListener(eventName, (event) => {
      const filter = event.target.closest(".task-kanban-inline-filter");
      if (filter) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (eventName !== "click") return;
        const expandBtn = event.target.closest(".task-kanban-filter-expand");
        if (expandBtn) {
          event.preventDefault();
          const node = expandBtn.closest(".task-kanban-filter-node");
          const children = node?.querySelector(":scope > .task-kanban-filter-children");
          if (!children) return;
          const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
          expandBtn.setAttribute("aria-expanded", String(!isExpanded));
          expandBtn.textContent = isExpanded ? "›" : "⌄";
          expandBtn.setAttribute("title", isExpanded ? "Развернуть" : "Свернуть");
          children.hidden = isExpanded;
          return;
        }
        const toggle = event.target.closest(".task-kanban-inline-filter-toggle");
        if (!toggle) return;
        event.preventDefault();
        const wasCollapsed = this.expandInlineKanbanCallout(filter);
        const expanded = wasCollapsed || !filter.classList.contains("is-open");
        filter.classList.toggle("is-open", expanded);
        toggle.setAttribute("aria-expanded", String(expanded));
        if (expanded) {
          this.closeInlineSorts(element);
          this.positionInlineFloatingMenu(toggle, filter.querySelector(".task-kanban-inline-filter-menu"));
        } else {
          this.resetInlineFloatingMenu(filter.querySelector(".task-kanban-inline-filter-menu"));
        }
        return;
      }
      const sort = event.target.closest(".task-kanban-inline-sort");
      if (sort) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (eventName !== "click") return;
        const toggle = event.target.closest(".task-kanban-inline-sort-toggle");
        if (!toggle) return;
        event.preventDefault();
        const expanded = !sort.classList.contains("is-open");
        sort.classList.toggle("is-open", expanded);
        toggle.setAttribute("aria-expanded", String(expanded));
        if (expanded) {
          this.closeInlineFilters(element);
          this.positionInlineFloatingMenu(toggle, sort.querySelector(".task-kanban-inline-sort-menu"));
        } else {
          this.resetInlineFloatingMenu(sort.querySelector(".task-kanban-inline-sort-menu"));
        }
        return;
      }
    }, true);
  }

  this.registerDomEvent(document, "click", (event) => {
    if (event.target.closest(".task-kanban-inline-filter")) return;
    this.closeInlineFilters(element);
  });

  this.registerDomEvent(document, "click", (event) => {
    if (event.target.closest(".task-kanban-inline-sort")) return;
    this.closeInlineSorts(element);
  });

  element.addEventListener("click", async (event) => {
    const openButton = event.target.closest(".task-kanban-inline-open");
    if (!openButton || !element.contains(openButton)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    await this.openInlineTask(sourcePath, this.getInlineLine(openButton));
  }, true);

  element.addEventListener("click", async (event) => {
    const target = this.getEventElement(event.target);
    const subtask = target?.closest(".task-kanban-inline-subtask");
    if (!subtask || !element.contains(subtask)) return;
    if (target.closest(".task-kanban-inline-subtasks-toggle")) return;
    if (target.closest(".task-kanban-inline-open")) return;
    if (!target.closest(".task-kanban-inline-subtask-status, .task-kanban-inline-subtask-text, .task-kanban-inline-subtask")) return;

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      await this.openInlineTask(sourcePath, this.getInlineLine(subtask));
      return;
    }

    if (!this.canEditInlineKanban(sourcePath)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await this.toggleInlineSubtaskStatus(subtask, sourcePath);
  }, true);

  element.addEventListener("click", async (event) => {
    const textToggle = event.target.closest(".task-kanban-inline-text-toggle");
    if (textToggle) {
      event.preventDefault();
      event.stopPropagation();
      const card = textToggle.closest(".task-kanban-inline-card");
      if (!card) return;
      this.toggleInlineCardText(card);
      return;
    }

    const expandToggle = event.target.closest(".task-kanban-inline-expand-toggle");
    if (expandToggle) {
      event.preventDefault();
      event.stopPropagation();
      const expand = expandToggle.getAttribute("aria-pressed") !== "true";
      this.setAllInlineSubtasksExpanded(element, expand);
      return;
    }

    const filterToggle = event.target.closest(".task-kanban-inline-filter-toggle");
    if (filterToggle) {
      event.preventDefault();
      event.stopPropagation();
      const filter = filterToggle.closest(".task-kanban-inline-filter");
      const expanded = !filter?.classList.contains("is-open");
      filter?.classList.toggle("is-open", expanded);
      filterToggle.setAttribute("aria-expanded", String(expanded));
      if (expanded) {
        this.positionInlineFloatingMenu(filterToggle, filter?.querySelector(".task-kanban-inline-filter-menu"));
      } else {
        this.resetInlineFloatingMenu(filter?.querySelector(".task-kanban-inline-filter-menu"));
      }
      return;
    }

    if (event.target.closest(".task-kanban-inline-filter-menu")) {
      event.stopPropagation();
      return;
    }

    const statusButton = event.target.closest(".task-kanban-inline-subtask-status");
    if (statusButton) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.canEditInlineKanban(sourcePath)) return;
      const subtask = statusButton.closest(".task-kanban-inline-subtask");
      await this.toggleInlineSubtaskStatus(subtask, sourcePath);
      return;
    }

    const toggleButton = event.target.closest(".task-kanban-inline-subtasks-toggle");
    if (toggleButton) {
      event.preventDefault();
      event.stopPropagation();
      const card = toggleButton.closest(".task-kanban-inline-card, .task-kanban-inline-subtask");
      if (card) this.toggleInlineSubtasks(card);
      return;
    }

    if (event.target.closest("button")) return;
    const card = event.target.closest(".task-kanban-inline-card, .task-kanban-inline-subtask");
    if (!card || !element.contains(card)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      await this.openInlineTask(sourcePath, this.getInlineLine(card));
      return;
    }
    if (card.classList.contains("task-kanban-inline-subtask")) {
      if (!this.canEditInlineKanban(sourcePath)) return;
      await this.toggleInlineSubtaskStatus(card, sourcePath);
      return;
    }
    if (card.classList.contains("has-overflowing-text")) this.toggleInlineCardText(card);
    this.toggleInlineSubtasks(card);
  });

  element.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".task-kanban-inline-card");
    if (!card || !element.contains(card)) return;
    if (!this.canEditInlineKanban(sourcePath)) {
      event.preventDefault();
      return;
    }
    if (event.target.closest(".task-kanban-inline-subtask")) {
      event.preventDefault();
      return;
    }
    const blockId = this.getInlineBlockId(card);
    if (!blockId || !event.dataTransfer) return;
    event.dataTransfer.setData(TASK_KANBAN_DRAG_MIME, blockId);
    event.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });

  element.addEventListener("dragend", (event) => {
    const card = event.target.closest(".task-kanban-inline-card");
    if (card) card.classList.remove("is-dragging");
    for (const column of element.querySelectorAll(".task-kanban-inline-column.is-drag-over")) {
      column.classList.remove("is-drag-over");
    }
  });

  element.addEventListener("dragover", (event) => {
    const target = this.getEventElement(event.target);
    const column = target?.closest(".task-kanban-inline-column");
    if (!column || !element.contains(column)) return;
    if (!this.canEditInlineKanban(sourcePath)) return;
    if (!Array.from(event.dataTransfer?.types || []).includes(TASK_KANBAN_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    column.classList.add("is-drag-over");
  });

  element.addEventListener("dragleave", (event) => {
    const target = this.getEventElement(event.target);
    const column = target?.closest(".task-kanban-inline-column");
    if (!column || !element.contains(column)) return;
    if (column.contains(event.relatedTarget)) return;
    column.classList.remove("is-drag-over");
  });

  element.addEventListener("drop", async (event) => {
    const target = this.getEventElement(event.target);
    const column = target?.closest(".task-kanban-inline-column");
    if (!column || !element.contains(column)) return;
    if (!this.canEditInlineKanban(sourcePath)) return;
    const blockId = event.dataTransfer?.getData(TASK_KANBAN_DRAG_MIME);
    const status = this.getInlineColumnStatus(column);
    if (!blockId || !status) return;
    event.preventDefault();
    event.stopPropagation();
    column.classList.remove("is-drag-over");
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (!(file instanceof TFile)) return;
    const openView = this.findOpenMarkdownView(file);
    const savedScroll = openView?.editor?.getScrollInfo?.();
    await this.setInlineTaskStatus(file, blockId, status, true, true);
    if (savedScroll && openView?.editor?.scrollTo) {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        openView.editor.scrollTo?.(savedScroll.left, savedScroll.top);
      }));
    }
    this.scheduleInlineKanbanRefresh(file, INLINE_KANBAN_CHECKBOX_REFRESH_DELAY);
  });

  element.addEventListener("click", (event) => {
    const expandBtn = event.target.closest(".task-kanban-filter-expand");
    if (!expandBtn || !element.contains(expandBtn)) return;
    event.preventDefault();
    event.stopPropagation();
    const node = expandBtn.closest(".task-kanban-filter-node");
    const children = node?.querySelector(":scope > .task-kanban-filter-children");
    if (!children) return;
    const isExpanded = expandBtn.getAttribute("aria-expanded") === "true";
    expandBtn.setAttribute("aria-expanded", String(!isExpanded));
    expandBtn.textContent = isExpanded ? "›" : "⌄";
    expandBtn.setAttribute("title", isExpanded ? "Развернуть" : "Свернуть");
    children.hidden = isExpanded;
  });

  element.addEventListener("change", async (event) => {
    const sortInput = event.target.closest(".task-kanban-inline-sort-menu input[type='radio']");
    if (sortInput && element.contains(sortInput)) {
      event.preventDefault();
      event.stopPropagation();
      await this.saveInlineSortSelection(sortInput);
      const file = this.app.vault.getAbstractFileByPath(sourcePath);
      if (file instanceof TFile) await this.syncInlineKanbanDom(element, file);
      return;
    }

    const input = event.target.closest(".task-kanban-inline-filter-menu input[type='checkbox']");
    if (!input || !element.contains(input)) return;
    event.preventDefault();
    event.stopPropagation();

    const menu = input.closest(".task-kanban-inline-filter-menu");
    if (input.closest("[data-filter-all]")) {
      for (const cb of menu.querySelectorAll("input[type='checkbox'][value]")) {
        cb.checked = input.checked;
      }
    } else {
      const node = input.closest(".task-kanban-filter-node");
      const children = node?.querySelector(":scope > .task-kanban-filter-children");
      if (children) {
        for (const cb of children.querySelectorAll("input[type='checkbox']")) {
          cb.checked = input.checked;
        }
      }
      let parent = node?.parentElement?.closest(".task-kanban-filter-node");
      while (parent) {
        const parentInput = parent.querySelector(":scope > .task-kanban-filter-row input[type='checkbox']");
        const childInputs = Array.from(parent.querySelectorAll(":scope > .task-kanban-filter-children input[type='checkbox'][value]"));
        if (parentInput && childInputs.length) {
          parentInput.checked = childInputs.every(cb => cb.checked);
        }
        parent = parent.parentElement?.closest(".task-kanban-filter-node");
      }
      const allLeafs = Array.from(menu.querySelectorAll("input[type='checkbox'][value]"));
      const allChk = menu.querySelector("[data-filter-all] input[type='checkbox']");
      if (allChk) allChk.checked = allLeafs.length > 0 && allLeafs.every(cb => cb.checked);
    }

    await this.saveInlineHeadingFilterSelection(sourcePath, menu);
    const file = this.app.vault.getAbstractFileByPath(sourcePath);
    if (file instanceof TFile) await this.syncInlineKanbanDom(element, file);
  });
}
};
