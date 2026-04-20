(() => {
  const TABLE_ROOT_SELECTOR = "#table-el";
  const HEADER_ROW_SELECTOR = "thead.p-datatable-thead tr:first-child";
  const DATA_ROW_SELECTOR = "tbody.p-datatable-tbody > tr";
  const TOOLBAR_ID = "ctfp-toolbar";
  const MASTER_CHECKBOX_ID = "ctfp-select-all";
  const ROW_CHECKBOX_CLASS = "ctfp-row-checkbox";
  const DEFAULT_DELAY_MS = 1500;
  const MIN_DELAY_MS = 500;
  const MAX_DELAY_MS = 10000;
  const PAGE_CONFIGS = [
    {
      key: "submitted-returnsheets",
      pathFragment: "/submitted-returnsheets",
      toolbarTitle: "Bulk PDF",
      selectionMode: "custom",
      downloadButtonSelector: "button#SubmittedDownloadPdfButton",
      dataCellStartIndex: 1,
    },
    {
      key: "output-tax",
      pathFragment: "/output-tax",
      toolbarTitle: "Download PDF",
      selectionMode: "native",
      downloadButtonSelector: "button#DownloadButton",
      dataCellStartIndex: 2,
    },
  ];

  const state = {
    selectedKeys: new Set(),
    isDownloading: false,
    shouldStop: false,
    observer: null,
    observedRoot: null,
    renderTimer: null,
    routeTimer: null,
    progressCurrent: 0,
    progressTotal: 0,
    currentPageKey: null,
  };

  function getCurrentConfig() {
    if (window.location.hostname !== "coretaxdjp.pajak.go.id") {
      return null;
    }

    return (
      PAGE_CONFIGS.find((config) =>
        window.location.pathname.includes(config.pathFragment)
      ) ?? null
    );
  }

  function isSupportedPage() {
    return Boolean(getCurrentConfig());
  }

  function usesCustomSelection(config = getCurrentConfig()) {
    return config?.selectionMode === "custom";
  }

  function normalizeText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getTableRoot() {
    return document.querySelector(TABLE_ROOT_SELECTOR);
  }

  function getHeaderRow(root = getTableRoot()) {
    return root?.querySelector(HEADER_ROW_SELECTOR) ?? null;
  }

  function getToolbar(root = getTableRoot()) {
    return root?.querySelector(`#${TOOLBAR_ID}`) ?? null;
  }

  function getDataRows(root = getTableRoot()) {
    if (!root) {
      return [];
    }

    return Array.from(root.querySelectorAll(DATA_ROW_SELECTOR)).filter((row) =>
      row.querySelector(":scope > td")
    );
  }

  function getRowKey(row, config = getCurrentConfig()) {
    const startIndex = config?.dataCellStartIndex ?? 1;
    const cells = Array.from(row.querySelectorAll(":scope > td")).slice(startIndex);
    return cells.map((cell) => normalizeText(cell.textContent)).join(" | ");
  }

  function getVisibleRowKeys(root = getTableRoot(), config = getCurrentConfig()) {
    if (!usesCustomSelection(config)) {
      return new Set();
    }

    return new Set(
      getDataRows(root)
        .map((row) => getRowKey(row, config))
        .filter(Boolean)
    );
  }

  function pruneSelection(root = getTableRoot(), config = getCurrentConfig()) {
    if (state.isDownloading || !usesCustomSelection(config)) {
      return;
    }

    const visibleKeys = getVisibleRowKeys(root, config);

    if (!visibleKeys.size) {
      return;
    }

    state.selectedKeys = new Set(
      Array.from(state.selectedKeys).filter((key) => visibleKeys.has(key))
    );
  }

  function getDelayInput(root = getTableRoot()) {
    return getToolbar(root)?.querySelector(".ctfp-delay-input") ?? null;
  }

  function getDelayMs(root = getTableRoot()) {
    const rawValue = Number(getDelayInput(root)?.value ?? DEFAULT_DELAY_MS);

    if (Number.isNaN(rawValue)) {
      return DEFAULT_DELAY_MS;
    }

    return Math.min(MAX_DELAY_MS, Math.max(MIN_DELAY_MS, rawValue));
  }

  function ensureToolbar(root = getTableRoot(), config = getCurrentConfig()) {
    if (!root || !config) {
      return null;
    }

    let toolbar = getToolbar(root);
    const header = root.querySelector(".p-datatable-header") ?? root;

    if (!toolbar || toolbar.dataset.pageKey !== config.key) {
      toolbar?.remove();
      toolbar = document.createElement("div");
      toolbar.id = TOOLBAR_ID;
      toolbar.className = "ctfp-toolbar";
      toolbar.dataset.pageKey = config.key;
      toolbar.innerHTML = `
        <div class="ctfp-toolbar-title">${config.toolbarTitle}</div>
        <button type="button" class="ctfp-btn" data-action="select-visible">Pilih semua</button>
        <button type="button" class="ctfp-btn ctfp-btn-secondary" data-action="clear-visible">Reset</button>
        <button type="button" class="ctfp-btn ctfp-btn-primary" data-action="download">Download</button>
        <button type="button" class="ctfp-btn ctfp-btn-danger" data-action="stop" disabled>Stop</button>
        <label class="ctfp-delay">
          Jeda
          <input type="number" class="ctfp-delay-input" min="${MIN_DELAY_MS}" max="${MAX_DELAY_MS}" step="100" value="${DEFAULT_DELAY_MS}" />
          <span>ms</span>
        </label>
        <div class="ctfp-status" aria-live="polite"></div>
      `;
      header.appendChild(toolbar);
    }

    if (!toolbar.dataset.bound) {
      toolbar
        .querySelector('[data-action="select-visible"]')
        ?.addEventListener("click", () => {
          setAllVisibleRows(true, root, config);
        });

      toolbar
        .querySelector('[data-action="clear-visible"]')
        ?.addEventListener("click", () => {
          clearVisibleSelection(root, config);
        });

      toolbar
        .querySelector('[data-action="download"]')
        ?.addEventListener("click", () => {
          void startDownload(root, config);
        });

      toolbar.querySelector('[data-action="stop"]')?.addEventListener("click", () => {
        state.shouldStop = true;
        updateToolbarStatus(
          root,
          config,
          "Stop diminta..."
        );
        syncToolbarDisabledState(root, config);
      });

      toolbar.querySelector(".ctfp-delay-input")?.addEventListener("change", () => {
        const input = getDelayInput(root);
        if (!input) {
          return;
        }

        input.value = String(getDelayMs(root));
        updateToolbarStatus(root, config);
      });

      toolbar.dataset.bound = "true";
    }

    return toolbar;
  }

  function cleanupCustomSelectionUI(root = getTableRoot(), config = getCurrentConfig()) {
    if (!root || usesCustomSelection(config)) {
      return;
    }

    root.querySelectorAll(".ctfp-header-toggle").forEach((node) => node.remove());
    root.querySelectorAll(".ctfp-row-toggle").forEach((node) => node.remove());
  }

  function ensureHeaderCheckbox(root = getTableRoot(), config = getCurrentConfig()) {
    if (!usesCustomSelection(config)) {
      return;
    }

    const headerRow = getHeaderRow(root);
    const firstHeaderCell = headerRow?.querySelector(":scope > th:first-child");

    if (!firstHeaderCell) {
      return;
    }

    let wrapper = firstHeaderCell.querySelector(".ctfp-header-toggle");

    if (!wrapper) {
      wrapper = document.createElement("label");
      wrapper.className = "ctfp-header-toggle";
      wrapper.innerHTML = `
        <input type="checkbox" id="${MASTER_CHECKBOX_ID}" />
        <span>Bulk</span>
      `;
      firstHeaderCell.insertBefore(wrapper, firstHeaderCell.firstChild);

      wrapper.querySelector("input")?.addEventListener("change", (event) => {
        const checkbox = event.currentTarget;
        setAllVisibleRows(Boolean(checkbox?.checked), root, config);
      });
    }
  }

  function setRowSelected(row, selected, config = getCurrentConfig()) {
    const key = getRowKey(row, config);

    if (!key) {
      return;
    }

    if (selected) {
      state.selectedKeys.add(key);
    } else {
      state.selectedKeys.delete(key);
    }
  }

  function ensureRowCheckbox(row) {
    const firstCell = row.querySelector(":scope > td:first-child");

    if (!firstCell) {
      return null;
    }

    let wrapper = firstCell.querySelector(".ctfp-row-toggle");

    if (!wrapper) {
      wrapper = document.createElement("label");
      wrapper.className = "ctfp-row-toggle";
      wrapper.innerHTML = `<input type="checkbox" class="${ROW_CHECKBOX_CLASS}" />`;
      firstCell.insertBefore(wrapper, firstCell.firstChild);

      wrapper.querySelector("input")?.addEventListener("change", (event) => {
        const checkbox = event.currentTarget;
        const config = getCurrentConfig();
        setRowSelected(row, Boolean(checkbox?.checked), config);
        syncMasterCheckbox(getTableRoot(), config);
        syncRowHighlight(getTableRoot(), config);
        updateToolbarStatus(getTableRoot(), config);
      });
    }

    return wrapper.querySelector("input");
  }

  function ensureRowCheckboxes(root = getTableRoot(), config = getCurrentConfig()) {
    if (!usesCustomSelection(config)) {
      return;
    }

    getDataRows(root).forEach((row) => {
      const checkbox = ensureRowCheckbox(row);
      const isSelected = state.selectedKeys.has(getRowKey(row, config));

      if (checkbox) {
        checkbox.checked = isSelected;
      }
    });
  }

  function getNativeRowCheckboxBox(row) {
    const firstCell = row.querySelector(":scope > td:first-child");
    return (
      firstCell?.querySelector('.p-checkbox-box[role="checkbox"], [role="checkbox"].p-checkbox-box') ??
      null
    );
  }

  function isNativeRowSelected(row) {
    return getNativeRowCheckboxBox(row)?.getAttribute("aria-checked") === "true";
  }

  function setNativeRowSelected(row, selected) {
    const checkboxBox = getNativeRowCheckboxBox(row);

    if (!checkboxBox) {
      return;
    }

    if (isNativeRowSelected(row) !== selected) {
      checkboxBox.click();
    }
  }

  function isRowSelected(row, config = getCurrentConfig()) {
    if (usesCustomSelection(config)) {
      return state.selectedKeys.has(getRowKey(row, config));
    }

    return isNativeRowSelected(row);
  }

  function getSelectedRows(root = getTableRoot(), config = getCurrentConfig()) {
    return getDataRows(root).filter((row) => isRowSelected(row, config));
  }

  function findRowByKey(rowKey, root = getTableRoot(), config = getCurrentConfig()) {
    return (
      getDataRows(root).find((row) => getRowKey(row, config) === rowKey) ?? null
    );
  }

  function getNativeHeaderCheckboxBox(root = getTableRoot()) {
    return (
      root?.querySelector(
        'thead p-tableheadercheckbox .p-checkbox-box[role="checkbox"], thead [role="checkbox"].p-checkbox-box'
      ) ?? null
    );
  }

  function syncRowHighlight(root = getTableRoot(), config = getCurrentConfig()) {
    getDataRows(root).forEach((row) => {
      row.classList.toggle("ctfp-row-selected", isRowSelected(row, config));
    });
  }

  function setAllVisibleRows(selected, root = getTableRoot(), config = getCurrentConfig()) {
    if (usesCustomSelection(config)) {
      getDataRows(root).forEach((row) => {
        const checkbox = ensureRowCheckbox(row);

        if (!checkbox) {
          return;
        }

        checkbox.checked = selected;
        setRowSelected(row, selected, config);
      });

      syncMasterCheckbox(root, config);
      syncRowHighlight(root, config);
      updateToolbarStatus(root, config);
      return;
    }

    const headerCheckboxBox = getNativeHeaderCheckboxBox(root);

    if (headerCheckboxBox) {
      const currentState = headerCheckboxBox.getAttribute("aria-checked");
      const shouldClick = selected
        ? currentState !== "true"
        : currentState !== "false";

      if (shouldClick) {
        headerCheckboxBox.click();
      }
    } else {
      const rowKeys = getDataRows(root).map((row) => getRowKey(row, config));

      rowKeys.forEach((rowKey) => {
        const activeRow = findRowByKey(rowKey, root, config);
        if (activeRow) {
          setNativeRowSelected(activeRow, selected);
        }
      });
    }

    window.setTimeout(() => {
      syncRowHighlight(root, config);
      updateToolbarStatus(root, config);
    }, 0);
  }

  function clearVisibleSelection(root = getTableRoot(), config = getCurrentConfig()) {
    setAllVisibleRows(false, root, config);
  }

  function syncMasterCheckbox(root = getTableRoot(), config = getCurrentConfig()) {
    if (!usesCustomSelection(config)) {
      return;
    }

    const master = root?.querySelector(`#${MASTER_CHECKBOX_ID}`);
    const rows = getDataRows(root);

    if (!master) {
      return;
    }

    if (!rows.length) {
      master.checked = false;
      master.indeterminate = false;
      return;
    }

    const selectedCount = rows.filter((row) => isRowSelected(row, config)).length;

    master.checked = selectedCount > 0 && selectedCount === rows.length;
    master.indeterminate = selectedCount > 0 && selectedCount < rows.length;
  }

  function syncToolbarDisabledState(root = getTableRoot(), config = getCurrentConfig()) {
    const toolbar = getToolbar(root);

    if (!toolbar) {
      return;
    }

    const disableDuringRun = state.isDownloading;

    toolbar
      .querySelectorAll('[data-action="select-visible"], [data-action="clear-visible"], [data-action="download"]')
      .forEach((button) => {
        button.disabled = disableDuringRun;
      });

    const stopButton = toolbar.querySelector('[data-action="stop"]');
    if (stopButton) {
      stopButton.disabled = !state.isDownloading;
    }

    if (usesCustomSelection(config)) {
      const masterCheckbox = root?.querySelector(`#${MASTER_CHECKBOX_ID}`);
      if (masterCheckbox) {
        masterCheckbox.disabled = disableDuringRun;
      }

      root
        ?.querySelectorAll(`.${ROW_CHECKBOX_CLASS}`)
        .forEach((checkbox) => {
          checkbox.disabled = disableDuringRun;
        });
    }
  }

  function updateToolbarStatus(
    root = getTableRoot(),
    config = getCurrentConfig(),
    customMessage = ""
  ) {
    const status = getToolbar(root)?.querySelector(".ctfp-status");

    if (!status) {
      return;
    }

    if (customMessage) {
      status.textContent = customMessage;
      return;
    }

    const rows = getDataRows(root);
    const selectedCount = getSelectedRows(root, config).length;

    if (state.isDownloading) {
      const suffix = state.shouldStop ? " · stop" : "";
      status.textContent = `${state.progressCurrent}/${state.progressTotal} berjalan${suffix}`;
      return;
    }

    if (!rows.length) {
      status.textContent = "Tidak ada data";
      return;
    }

    const delay = getDelayMs(root);
    const helperText = usesCustomSelection(config)
      ? "ext"
      : "coretax";
    status.textContent = `${selectedCount} dipilih · ${helperText} · ${delay} ms`;
  }

  async function startDownload(root = getTableRoot(), config = getCurrentConfig()) {
    if (state.isDownloading) {
      return;
    }

    const rowKeys = getSelectedRows(root, config).map((row) => getRowKey(row, config));

    if (!rowKeys.length) {
      updateToolbarStatus(root, config, "Pilih data dulu");
      return;
    }

    const delayMs = getDelayMs(root);

    state.isDownloading = true;
    state.shouldStop = false;
    state.progressCurrent = 0;
    state.progressTotal = rowKeys.length;

    syncToolbarDisabledState(root, config);
    updateToolbarStatus(root, config, `0/${rowKeys.length} berjalan`);

    for (const rowKey of rowKeys) {
      if (state.shouldStop) {
        break;
      }

      state.progressCurrent += 1;
      const activeRow = findRowByKey(rowKey, root, config);

      if (!activeRow) {
        updateToolbarStatus(
          root,
          config,
          `${state.progressCurrent}/${rowKeys.length} tidak ditemukan`
        );
        await sleep(delayMs);
        continue;
      }

      activeRow.classList.add("ctfp-row-processing");

      const button = activeRow.querySelector(config.downloadButtonSelector);

      if (button && !button.disabled) {
        button.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "nearest",
        });
        button.click();
      } else {
        updateToolbarStatus(
          root,
          config,
          `${state.progressCurrent}/${rowKeys.length} dilewati`
        );
      }

      updateToolbarStatus(root, config);
      await sleep(delayMs);
      activeRow.classList.remove("ctfp-row-processing");
    }

    const didStop = state.shouldStop;

    state.isDownloading = false;
    state.shouldStop = false;
    syncToolbarDisabledState(root, config);

    if (didStop) {
      updateToolbarStatus(
        root,
        config,
        `Stop di ${state.progressCurrent}/${state.progressTotal}`
      );
    } else {
      updateToolbarStatus(root, config, `Selesai ${state.progressTotal} file`);
    }
  }

  function ensureTableListeners(root = getTableRoot()) {
    if (!root || root.dataset.ctfpListenersBound === "true") {
      return;
    }

    const syncLater = () => {
      window.setTimeout(() => {
        scheduleRender();
      }, 0);
    };

    root.addEventListener("click", (event) => {
      if (event.target.closest(".p-checkbox-box, .ctfp-row-toggle, .ctfp-header-toggle")) {
        syncLater();
      }
    });

    root.addEventListener("change", (event) => {
      if (event.target.closest('input[type="checkbox"]')) {
        syncLater();
      }
    });

    root.dataset.ctfpListenersBound = "true";
  }

  function observeTable(root = getTableRoot()) {
    if (!root || state.observedRoot === root) {
      return;
    }

    if (state.observer) {
      state.observer.disconnect();
    }

    state.observedRoot = root;
    state.observer = new MutationObserver(() => {
      scheduleRender();
    });
    state.observer.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  function scheduleRender() {
    if (state.renderTimer) {
      return;
    }

    state.renderTimer = window.setTimeout(() => {
      state.renderTimer = null;
      render();
    }, 75);
  }

  function render() {
    const config = getCurrentConfig();

    if (!config) {
      state.currentPageKey = null;
      state.selectedKeys.clear();
      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
        state.observedRoot = null;
      }
      return;
    }

    if (state.currentPageKey !== config.key) {
      state.currentPageKey = config.key;
      state.selectedKeys.clear();
    }

    const root = getTableRoot();

    if (!root) {
      return;
    }

    ensureTableListeners(root);
    pruneSelection(root, config);
    cleanupCustomSelectionUI(root, config);
    ensureToolbar(root, config);
    ensureHeaderCheckbox(root, config);
    ensureRowCheckboxes(root, config);
    syncMasterCheckbox(root, config);
    syncRowHighlight(root, config);
    syncToolbarDisabledState(root, config);
    updateToolbarStatus(root, config);
    observeTable(root);
  }

  function start() {
    if (state.routeTimer) {
      return;
    }

    scheduleRender();
    state.routeTimer = window.setInterval(() => {
      if (isSupportedPage()) {
        scheduleRender();
      }
    }, 1500);
  }

  start();
})();
