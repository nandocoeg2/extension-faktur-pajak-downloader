(() => {
  const TABLE_ROOT_SELECTOR = "#table-el";
  const HEADER_ROW_SELECTOR = "thead.p-datatable-thead tr:first-child";
  const DATA_ROW_SELECTOR = "tbody.p-datatable-tbody > tr";
  const DOWNLOAD_BUTTON_SELECTOR = "button#SubmittedDownloadPdfButton";
  const SUPPORTED_PATH_FRAGMENT = "/submitted-returnsheets";
  const TOOLBAR_ID = "ctfp-toolbar";
  const MASTER_CHECKBOX_ID = "ctfp-select-all";
  const ROW_CHECKBOX_CLASS = "ctfp-row-checkbox";
  const DEFAULT_DELAY_MS = 1500;
  const MIN_DELAY_MS = 500;
  const MAX_DELAY_MS = 10000;

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
  };

  function isSupportedPage() {
    return (
      window.location.hostname === "coretaxdjp.pajak.go.id" &&
      window.location.pathname.includes(SUPPORTED_PATH_FRAGMENT)
    );
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

  function getRowKey(row) {
    const cells = Array.from(row.querySelectorAll(":scope > td")).slice(1);
    return cells.map((cell) => normalizeText(cell.textContent)).join(" | ");
  }

  function getVisibleRowKeys(root = getTableRoot()) {
    return new Set(
      getDataRows(root)
        .map((row) => getRowKey(row))
        .filter(Boolean)
    );
  }

  function pruneSelection(root = getTableRoot()) {
    if (state.isDownloading) {
      return;
    }

    const visibleKeys = getVisibleRowKeys(root);

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

  function ensureToolbar(root = getTableRoot()) {
    if (!root) {
      return null;
    }

    let toolbar = getToolbar(root);
    const header = root.querySelector(".p-datatable-header") ?? root;

    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.id = TOOLBAR_ID;
      toolbar.className = "ctfp-toolbar";
      toolbar.innerHTML = `
        <div class="ctfp-toolbar-title">Bulk PDF Downloader</div>
        <button type="button" class="ctfp-btn" data-action="select-visible">Pilih semua halaman ini</button>
        <button type="button" class="ctfp-btn ctfp-btn-secondary" data-action="clear-visible">Reset pilihan</button>
        <button type="button" class="ctfp-btn ctfp-btn-primary" data-action="download">Download terpilih</button>
        <button type="button" class="ctfp-btn ctfp-btn-danger" data-action="stop" disabled>Stop</button>
        <label class="ctfp-delay">
          Delay
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
          setAllVisibleRows(true, root);
        });

      toolbar
        .querySelector('[data-action="clear-visible"]')
        ?.addEventListener("click", () => {
          clearVisibleSelection(root);
        });

      toolbar
        .querySelector('[data-action="download"]')
        ?.addEventListener("click", () => {
          void startDownload(root);
        });

      toolbar.querySelector('[data-action="stop"]')?.addEventListener("click", () => {
        state.shouldStop = true;
        updateToolbarStatus(root, "Permintaan stop diterima. Menunggu item aktif selesai.");
        syncToolbarDisabledState(root);
      });

      toolbar.querySelector(".ctfp-delay-input")?.addEventListener("change", () => {
        const input = getDelayInput(root);
        if (!input) {
          return;
        }

        input.value = String(getDelayMs(root));
        updateToolbarStatus(root);
      });

      toolbar.dataset.bound = "true";
    }

    return toolbar;
  }

  function ensureHeaderCheckbox(root = getTableRoot()) {
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
        setAllVisibleRows(Boolean(checkbox?.checked), root);
      });
    }
  }

  function setRowSelected(row, selected) {
    const key = getRowKey(row);

    if (!key) {
      return;
    }

    if (selected) {
      state.selectedKeys.add(key);
      row.classList.add("ctfp-row-selected");
    } else {
      state.selectedKeys.delete(key);
      row.classList.remove("ctfp-row-selected");
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
        setRowSelected(row, Boolean(checkbox?.checked));
        syncMasterCheckbox();
        updateToolbarStatus();
      });
    }

    return wrapper.querySelector("input");
  }

  function ensureRowCheckboxes(root = getTableRoot()) {
    getDataRows(root).forEach((row) => {
      const checkbox = ensureRowCheckbox(row);
      const isSelected = state.selectedKeys.has(getRowKey(row));

      if (checkbox) {
        checkbox.checked = isSelected;
      }

      row.classList.toggle("ctfp-row-selected", isSelected);
    });
  }

  function setAllVisibleRows(selected, root = getTableRoot()) {
    getDataRows(root).forEach((row) => {
      const checkbox = ensureRowCheckbox(row);

      if (!checkbox) {
        return;
      }

      checkbox.checked = selected;
      setRowSelected(row, selected);
    });

    syncMasterCheckbox(root);
    updateToolbarStatus(root);
  }

  function clearVisibleSelection(root = getTableRoot()) {
    setAllVisibleRows(false, root);
  }

  function syncMasterCheckbox(root = getTableRoot()) {
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

    const selectedCount = rows.filter((row) =>
      state.selectedKeys.has(getRowKey(row))
    ).length;

    master.checked = selectedCount > 0 && selectedCount === rows.length;
    master.indeterminate = selectedCount > 0 && selectedCount < rows.length;
  }

  function syncToolbarDisabledState(root = getTableRoot()) {
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

  function updateToolbarStatus(root = getTableRoot(), customMessage = "") {
    const status = getToolbar(root)?.querySelector(".ctfp-status");

    if (!status) {
      return;
    }

    if (customMessage) {
      status.textContent = customMessage;
      return;
    }

    const rows = getDataRows(root);
    const selectedCount = rows.filter((row) =>
      state.selectedKeys.has(getRowKey(row))
    ).length;

    if (state.isDownloading) {
      const suffix = state.shouldStop ? " Stop sedang diproses." : "";
      status.textContent = `Mengunduh ${state.progressCurrent}/${state.progressTotal} file.${suffix}`;
      return;
    }

    if (!rows.length) {
      status.textContent = "Tabel belum siap atau tidak ada data pada halaman ini.";
      return;
    }

    const delay = getDelayMs(root);
    status.textContent = `${selectedCount} baris dipilih pada halaman ini. Delay antar download ${delay} ms.`;
  }

  async function startDownload(root = getTableRoot()) {
    if (state.isDownloading) {
      return;
    }

    const rows = getDataRows(root).filter((row) =>
      state.selectedKeys.has(getRowKey(row))
    );

    if (!rows.length) {
      updateToolbarStatus(root, "Pilih minimal satu baris pada halaman ini.");
      return;
    }

    const delayMs = getDelayMs(root);

    state.isDownloading = true;
    state.shouldStop = false;
    state.progressCurrent = 0;
    state.progressTotal = rows.length;

    syncToolbarDisabledState(root);
    updateToolbarStatus(root, `Mengunduh 0/${rows.length} file.`);

    for (const row of rows) {
      if (state.shouldStop) {
        break;
      }

      state.progressCurrent += 1;
      row.classList.add("ctfp-row-processing");

      const button = row.querySelector(DOWNLOAD_BUTTON_SELECTOR);

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
          `Baris ${state.progressCurrent}/${rows.length} dilewati karena tombol PDF tidak ditemukan.`
        );
      }

      updateToolbarStatus(root);
      await sleep(delayMs);
      row.classList.remove("ctfp-row-processing");
    }

    const didStop = state.shouldStop;

    state.isDownloading = false;
    state.shouldStop = false;
    syncToolbarDisabledState(root);

    if (didStop) {
      updateToolbarStatus(
        root,
        `Proses dihentikan pada ${state.progressCurrent}/${state.progressTotal} file.`
      );
    } else {
      updateToolbarStatus(root, `Selesai memicu ${state.progressTotal} download.`);
    }
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
    if (!isSupportedPage()) {
      return;
    }

    const root = getTableRoot();

    if (!root) {
      return;
    }

    pruneSelection(root);
    ensureToolbar(root);
    ensureHeaderCheckbox(root);
    ensureRowCheckboxes(root);
    syncMasterCheckbox(root);
    syncToolbarDisabledState(root);
    updateToolbarStatus(root);
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
