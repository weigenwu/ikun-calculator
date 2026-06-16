(function () {
      "use strict";

      const $ = (id) => document.getElementById(id);
      let qpaLastPrismCsv = "";
      let qpaLastAnalyses = [];
      let mmLastCsv = "";
      let qmeLastSummaryCsv = "";
      let qmeLastPrismCsv = "";
      let vaLastCsv = "";
      let icLastCsv = "";
      let elisaLastCsv = "";
      let flowLastCsv = "";
      let wbgLastCsv = "";
      let vaPlateImageUrl = "";
      let vaPlateScanUrl = "";
      let vaTesseractPromise = null;
      let vaTesseractWorker = null;
      let wbgRoiImage = null;
      let wbgRoiSource = null;
      let wbgRoiImageData = null;
      let wbgRoiItems = [];
      let wbgRoiDrag = null;
      const vaPlateWells = new Map();
      const vaPlateSelectedWells = new Set();
      let qmePrimaryWell = "A1";
      let qmeSelectedWells = new Set(["A1"]);
      let musicObjectUrl = "";
      let deferredInstallPrompt = null;
      const themeKey = "w2g-calculator-theme";
      const APP_VERSION = "v21";
      const draftPrefix = "w2g-calculator-draft:";
      let pendingServiceWorker = null;
      let reloadingForUpdate = false;

      function storedTheme() {
        try {
          return localStorage.getItem(themeKey);
        } catch (error) {
          return "";
        }
      }

      function saveTheme(theme) {
        try {
          localStorage.setItem(themeKey, theme);
        } catch (error) {
          // Local file privacy modes may block localStorage; theme still works for this page view.
        }
      }

      function preferredTheme() {
        const saved = storedTheme();
        if (saved === "day" || saved === "night") return saved;
        const hour = new Date().getHours();
        return hour >= 18 || hour < 6 ? "night" : "day";
      }

      function applyTheme(theme, persist) {
        const night = theme === "night";
        document.body.classList.toggle("theme-night", night);
        const toggle = $("theme-toggle");
        const text = $("theme-toggle-text");
        if (toggle) {
          toggle.setAttribute("aria-pressed", night ? "true" : "false");
          toggle.title = night ? "切换到白天" : "切换到夜间";
        }
        if (text) text.textContent = night ? "夜间" : "白天";
        if (persist) saveTheme(night ? "night" : "day");
      }

      function toggleTheme() {
        applyTheme(document.body.classList.contains("theme-night") ? "day" : "night", true);
      }

      function setMusicStatus(text) {
        const status = $("music-status");
        if (status) status.textContent = text;
      }

      function setMusicPlaying(playing) {
        const button = $("music-toggle");
        if (!button) return;
        button.textContent = playing ? "暂停 Dead Man" : "播放 Dead Man";
        button.setAttribute("aria-pressed", playing ? "true" : "false");
      }

      function ensureDefaultMusic() {
        const audio = $("bg-audio");
        if (!audio.src) {
          audio.src = "dead-man.mp3";
          audio.dataset.source = "default";
          audio.loop = true;
          audio.volume = 0.45;
        }
        return audio;
      }

      async function toggleMusic() {
        const audio = ensureDefaultMusic();
        if (!audio.paused) {
          audio.pause();
          setMusicPlaying(false);
          setMusicStatus("已暂停");
          return;
        }

        try {
          await audio.play();
          setMusicPlaying(true);
          setMusicStatus(audio.dataset.source === "local" ? "正在播放本地音频" : "正在尝试播放 dead-man.mp3");
        } catch (error) {
          setMusicPlaying(false);
          setMusicStatus("未找到可播放音频，请选择本地文件");
        }
      }

      function handleMusicFile() {
        const input = $("music-file");
        const file = input.files && input.files[0];
        if (!file) return;
        const audio = $("bg-audio");
        audio.pause();
        if (musicObjectUrl) URL.revokeObjectURL(musicObjectUrl);
        musicObjectUrl = URL.createObjectURL(file);
        audio.src = musicObjectUrl;
        audio.dataset.source = "local";
        audio.loop = true;
        audio.volume = 0.45;
        setMusicPlaying(false);
        setMusicStatus(`已选择：${file.name}`);
      }

      function isInstalledAppMode() {
        return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
      }

      function setInstallButtonVisible(visible) {
        const button = $("app-install");
        if (!button) return;
        button.hidden = !visible;
      }

      async function promptAppInstall() {
        const button = $("app-install");
        if (!deferredInstallPrompt) {
          if (button) {
            button.textContent = "从浏览器菜单安装";
            window.setTimeout(() => {
              if (!deferredInstallPrompt && button) button.textContent = "安装 App";
            }, 1800);
          }
          return;
        }
        deferredInstallPrompt.prompt();
        try {
          await deferredInstallPrompt.userChoice;
        } catch (error) {
          // Some browsers do not expose the choice result; the prompt itself is enough.
        }
        deferredInstallPrompt = null;
        setInstallButtonVisible(false);
      }

      function setupAppInstall() {
        if (isInstalledAppMode()) {
          setInstallButtonVisible(false);
          return;
        }
        window.addEventListener("beforeinstallprompt", (event) => {
          event.preventDefault();
          deferredInstallPrompt = event;
          setInstallButtonVisible(true);
        });
        window.addEventListener("appinstalled", () => {
          deferredInstallPrompt = null;
          setInstallButtonVisible(false);
        });
      }

      function setupVersionUi() {
        const version = $("app-version");
        if (version) version.textContent = APP_VERSION;
        const refresh = $("update-refresh");
        if (refresh) refresh.addEventListener("click", refreshToNewVersion);
      }

      function showUpdateBanner(worker) {
        pendingServiceWorker = worker || pendingServiceWorker;
        const banner = $("update-banner");
        if (banner) banner.hidden = false;
      }

      function refreshToNewVersion() {
        if (pendingServiceWorker) {
          reloadingForUpdate = true;
          pendingServiceWorker.postMessage({ type: "SKIP_WAITING" });
          window.setTimeout(() => window.location.reload(), 1200);
        } else {
          window.location.reload();
        }
      }

      function registerServiceWorker() {
        if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
        window.addEventListener("load", () => {
          navigator.serviceWorker.register("./sw.js").then((registration) => {
            if (registration.waiting) showUpdateBanner(registration.waiting);
            registration.addEventListener("updatefound", () => {
              const worker = registration.installing;
              if (!worker) return;
              worker.addEventListener("statechange", () => {
                if (worker.state === "installed" && navigator.serviceWorker.controller) {
                  showUpdateBanner(worker);
                }
              });
            });
          }).catch(() => {});
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (reloadingForUpdate) window.location.reload();
          });
        });
      }

      function escapeHtml(value) {
        return String(value)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function getNumber(id) {
        return parseFloat($(id).value);
      }

      function fmt(value, digits = 3) {
        if (!isFinite(value)) return "";
        const rounded = Number(value.toFixed(digits));
        return rounded.toLocaleString();
      }

      function fmtData(value, digits = 4) {
        if (!isFinite(value)) return "";
        return String(Number(value.toFixed(digits)));
      }

      function fmtFixed(value, digits = 3) {
        if (!isFinite(value)) return "无法计算";
        return fmt(value, digits);
      }

      function fmtInt(value) {
        if (!isFinite(value)) return "";
        return Math.round(value).toLocaleString();
      }

      function sci(value) {
        if (!isFinite(value)) return "";
        if (value === 0) return "0";
        const exp = Math.floor(Math.log10(Math.abs(value)));
        const mant = value / Math.pow(10, exp);
        return mant.toFixed(3).replace(/\.?0+$/, "") + " × 10^" + exp;
      }

      function mean(values) {
        if (!values.length) return NaN;
        return values.reduce((sum, x) => sum + x, 0) / values.length;
      }

      function sd(values) {
        if (values.length < 2) return 0;
        const avg = mean(values);
        const variance = values.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / (values.length - 1);
        return Math.sqrt(variance);
      }

      function cvPercent(values) {
        const avg = mean(values);
        if (!isFinite(avg) || avg === 0 || values.length < 2) return 0;
        return sd(values) / avg * 100;
      }

      function isCopyableResult(id) {
        return /-result$/.test(id);
      }

      function resultToolsHtml(id) {
        if (!isCopyableResult(id)) return "";
        return `
          <div class="result-tools" data-copy-exclude="true">
            <button class="action tiny ghost" type="button" data-copy-result="${escapeHtml(id)}">复制实验记录</button>
            <button class="action tiny ghost" type="button" data-collapse-result="${escapeHtml(id)}">收起结果</button>
          </div>
        `;
      }

      function setResult(id, html, tone) {
        const box = $(id);
        box.style.display = "block";
        box.className = "result " + (tone || "");
        box.innerHTML = resultToolsHtml(id) + html;
      }

      async function copyText(text) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
          return;
        }
        const area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }

      function resultPlainText(box) {
        const clone = box.cloneNode(true);
        clone.querySelectorAll("[data-copy-exclude]").forEach((node) => node.remove());
        return clone.innerText.replace(/\n{3,}/g, "\n\n").trim();
      }

      function handleResultCopy(event) {
        const button = event.target.closest("[data-copy-result]");
        if (!button) return;
        const box = $(button.dataset.copyResult);
        if (!box) return;
        copyText(resultPlainText(box)).then(() => {
          button.textContent = "已复制";
          window.setTimeout(() => { button.textContent = "复制实验记录"; }, 1400);
        }).catch(() => {
          button.textContent = "复制失败";
          window.setTimeout(() => { button.textContent = "复制实验记录"; }, 1400);
        });
      }

      function handleResultCollapse(event) {
        const button = event.target.closest("[data-collapse-result]");
        if (!button) return;
        const box = $(button.dataset.collapseResult);
        if (!box) return;
        const collapsed = box.classList.toggle("collapsed");
        button.textContent = collapsed ? "展开结果" : "收起结果";
      }

      function table(headers, rows) {
        return `
          <div class="table-wrap">
            <table>
              <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
              <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
        `;
      }

      function splitLines(text) {
        return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      }

      function fieldLabel(field) {
        const label = field.id ? document.querySelector(`label[for="${CSS.escape(field.id)}"]`) : null;
        return label ? label.textContent.trim() : (field.id || "该字段");
      }

      function showFieldWarning(id, message) {
        const field = $(id);
        if (!field) return;
        field.classList.add("field-warning");
        field.setAttribute("aria-invalid", "true");
        const warningId = id + "-warning";
        let warning = $(warningId);
        if (!warning) {
          warning = document.createElement("div");
          warning.id = warningId;
          warning.className = "field-warning-text";
          field.insertAdjacentElement("afterend", warning);
        }
        warning.textContent = message;
      }

      function clearFieldWarning(field) {
        if (!field?.id) return;
        field.classList.remove("field-warning");
        field.removeAttribute("aria-invalid");
        const warning = $(field.id + "-warning");
        if (warning) warning.remove();
      }

      function clearPanelWarnings(panel) {
        const root = typeof panel === "string" ? $("panel-" + panel) : panel;
        if (!root) return;
        root.querySelectorAll(".field-warning").forEach(clearFieldWarning);
      }

      function validateSingleField(field) {
        if (!field || field.type !== "number") return true;
        if (field.value === "") {
          clearFieldWarning(field);
          return true;
        }
        if (field.validity.badInput) {
          showFieldWarning(field.id, "请输入有效数字。");
          return false;
        }
        if (field.validity.rangeUnderflow) {
          showFieldWarning(field.id, `不能小于 ${field.min}。`);
          return false;
        }
        if (field.validity.rangeOverflow) {
          showFieldWarning(field.id, `不能大于 ${field.max}。`);
          return false;
        }
        clearFieldWarning(field);
        return true;
      }

      function setupLiveFieldValidation() {
        document.addEventListener("input", (event) => validateSingleField(event.target));
        document.addEventListener("change", (event) => validateSingleField(event.target));
        document.querySelectorAll("input[type='number']").forEach(validateSingleField);
      }

      function inputIssueHtml(issues) {
        if (!issues.length) return "";
        issues.forEach((issue) => showFieldWarning(issue.id, issue.message));
        return `
          <div class="notice danger">
            <strong>请先修正这些输入：</strong>
            <ul>${issues.map((issue) => `<li>${escapeHtml(issue.label)}：${escapeHtml(issue.message)}</li>`).join("")}</ul>
          </div>
        `;
      }

      function panelFields(panel) {
        return Array.from(panel.querySelectorAll("input, select, textarea")).filter((field) => {
          const type = (field.type || "").toLowerCase();
          return field.id && type !== "file" && type !== "button" && type !== "submit" && type !== "reset";
        });
      }

      function panelDraftKey(panelName) {
        return draftPrefix + panelName;
      }

      function readFieldValue(field) {
        if (field.type === "checkbox" || field.type === "radio") return field.checked;
        if (field.tagName === "SELECT" && field.multiple) {
          return Array.from(field.selectedOptions).map((option) => option.value);
        }
        return field.value;
      }

      function writeFieldValue(field, value) {
        if (field.type === "checkbox" || field.type === "radio") {
          field.checked = Boolean(value);
        } else if (field.tagName === "SELECT" && field.multiple && Array.isArray(value)) {
          Array.from(field.options).forEach((option) => { option.selected = value.includes(option.value); });
        } else if (value !== undefined && value !== null) {
          field.value = String(value);
        }
      }

      function defaultFieldValue(field) {
        if (field.type === "checkbox" || field.type === "radio") return field.defaultChecked;
        if (field.tagName === "SELECT" && field.multiple) {
          return Array.from(field.options).filter((option) => option.defaultSelected).map((option) => option.value);
        }
        if (field.tagName === "SELECT") {
          const selected = Array.from(field.options).find((option) => option.defaultSelected);
          return selected ? selected.value : (field.options[0]?.value || "");
        }
        return field.defaultValue || "";
      }

      function savePanelDraft(panel) {
        if (!panel?.dataset?.panel) return;
        const data = {};
        panelFields(panel).forEach((field) => { data[field.id] = readFieldValue(field); });
        try {
          localStorage.setItem(panelDraftKey(panel.dataset.panel), JSON.stringify(data));
          setPanelDraftStatus(panel, "已自动保存");
        } catch (error) {
          setPanelDraftStatus(panel, "本地保存空间不足或被浏览器阻止");
        }
      }

      function restorePanelDraft(panel, shouldNotify = true) {
        if (!panel?.dataset?.panel) return false;
        let data = null;
        try {
          data = JSON.parse(localStorage.getItem(panelDraftKey(panel.dataset.panel)) || "null");
        } catch (error) {
          data = null;
        }
        if (!data || typeof data !== "object") {
          if (shouldNotify) setPanelDraftStatus(panel, "没有保存过的输入");
          return false;
        }
        panelFields(panel).forEach((field) => {
          if (Object.prototype.hasOwnProperty.call(data, field.id)) writeFieldValue(field, data[field.id]);
          validateSingleField(field);
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
        if (shouldNotify) setPanelDraftStatus(panel, "已恢复上次输入");
        return true;
      }

      function clearPanelDraft(panel) {
        if (!panel?.dataset?.panel) return;
        panelFields(panel).forEach((field) => {
          writeFieldValue(field, defaultFieldValue(field));
          clearFieldWarning(field);
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });
        try {
          localStorage.removeItem(panelDraftKey(panel.dataset.panel));
        } catch (error) {
          // localStorage may be blocked; the in-page reset still works.
        }
        panel.querySelectorAll(".result").forEach((box) => {
          box.className = "result";
          box.innerHTML = "";
          box.style.display = "none";
        });
        if (panel.dataset.panel === "wbdensity") {
          wbgRoiImage = null;
          wbgRoiSource = null;
          wbgRoiImageData = null;
          wbgRoiItems = [];
          wbgRoiDrag = null;
          const canvas = $("wbg-roi-canvas");
          if (canvas) {
            canvas.width = 960;
            canvas.height = 520;
          }
          $("wbg-roi-stage")?.classList.remove("has-image");
          wbgRoiDraw();
          wbgRoiStatus("已清空 WB 图片和 ROI 框选。", "ok");
        }
        setPanelDraftStatus(panel, "已清空本模块");
      }

      function setPanelDraftStatus(panel, message) {
        const status = panel.querySelector(".module-draft-status");
        if (status) status.textContent = message;
      }

      function setupPanelUtilities() {
        document.querySelectorAll(".tool-panel").forEach((panel) => {
          const head = panel.querySelector(".module-head");
          if (!head) return;
          const tools = document.createElement("div");
          tools.className = "module-tools";
          tools.innerHTML = `
            <button class="action tiny ghost" type="button" data-panel-restore="${escapeHtml(panel.dataset.panel)}">恢复上次输入</button>
            <button class="action tiny ghost" type="button" data-panel-clear="${escapeHtml(panel.dataset.panel)}">清空本模块</button>
            <span class="small module-draft-status">输入会自动保存在本机</span>
          `;
          head.appendChild(tools);
        });
      }

      function setupAutoSave() {
        document.querySelectorAll(".tool-panel").forEach((panel) => {
          restorePanelDraft(panel, false);
          panel.addEventListener("input", (event) => {
            if (event.target.closest(".result")) return;
            if (panelFields(panel).includes(event.target)) savePanelDraft(panel);
          });
          panel.addEventListener("change", (event) => {
            if (event.target.closest(".result")) return;
            if (panelFields(panel).includes(event.target)) savePanelDraft(panel);
          });
        });
      }

      function autosizeTextarea(textarea) {
        if (!textarea || textarea.tagName !== "TEXTAREA") return;
        const maxHeight = window.matchMedia("(max-width: 820px)").matches ? 420 : 640;
        textarea.style.height = "auto";
        textarea.style.height = Math.min(textarea.scrollHeight + 2, maxHeight) + "px";
      }

      function setupTextareaAutosize() {
        document.querySelectorAll("textarea").forEach((textarea) => {
          textarea.addEventListener("input", () => autosizeTextarea(textarea));
          textarea.addEventListener("focus", () => autosizeTextarea(textarea));
          autosizeTextarea(textarea);
        });
      }

      function handlePanelUtilityClick(event) {
        const restore = event.target.closest("[data-panel-restore]");
        const clear = event.target.closest("[data-panel-clear]");
        if (!restore && !clear) return;
        const name = (restore || clear).dataset.panelRestore || (restore || clear).dataset.panelClear;
        const panel = $("panel-" + name);
        if (!panel) return;
        if (restore) restorePanelDraft(panel, true);
        if (clear) clearPanelDraft(panel);
      }

      const PANEL_PRESETS = {
        cell: [
          { label: "1 mL 常规计数", values: { "cell-count": "220", "cell-volume": "1", "cell-target-conc": "1500000" } },
          { label: "2 mL 低密度", values: { "cell-count": "80", "cell-volume": "2", "cell-target-conc": "1000000" } }
        ],
        seeding: [
          { label: "96孔 8k/100µL", values: { "seed-conc": "1500000", "seed-target": "8000", "seed-wells": "96", "seed-plate": "100", "seed-final-vol": "100", "seed-extra": "10" } },
          { label: "24孔 8万/500µL", values: { "seed-conc": "1500000", "seed-target": "80000", "seed-wells": "24", "seed-plate": "500", "seed-final-vol": "500", "seed-extra": "10" } },
          { label: "6孔 20万/2mL", values: { "seed-conc": "1500000", "seed-target": "200000", "seed-wells": "6", "seed-plate": "2000", "seed-final-vol": "2000", "seed-extra": "10" } }
        ],
        drug: [
          { label: "0-10µM 梯度", values: { "drug-targets": "0, 1, 2, 5, 10", "drug-stock": "10", "drug-final-vol": "1000", "drug-wells": "3", "drug-extra": "10", "drug-min-pipette": "0.5" } },
          { label: "半对数梯度", values: { "drug-targets": "0, 0.01, 0.03, 0.1, 0.3, 1, 3, 10", "drug-stock": "10", "drug-final-vol": "1000", "drug-wells": "3", "drug-extra": "15", "drug-min-pipette": "0.5" } }
        ],
        viability: [
          { label: "CCK8 终点", values: { "va-method": "viability", "va-blank-group": "Blank", "va-control-group": "Control", "va-test-mode": "welch", "va-y-label": "OD450", "va-subtract-effector": true } },
          { label: "ADCC 存活法", values: { "va-method": "adcc-viability", "va-blank-group": "Blank", "va-control-group": "Target_only", "va-effector-group": "Effector_only", "va-test-mode": "welch", "va-subtract-effector": true } },
          { label: "LDH 释放法", values: { "va-method": "adcc-release", "va-blank-group": "Blank", "va-control-group": "Target_spontaneous", "va-effector-group": "Effector_only", "va-spontaneous-group": "Target_spontaneous", "va-max-group": "Target_max", "va-test-mode": "welch" } }
        ],
        ic50: [
          { label: "µM 药敏", values: { "ic-input-mode": "viability", "ic-blank": "0.050, 0.052, 0.049", "ic-control-conc": "0", "ic-unit": "µM" } },
          { label: "nM 药敏", values: { "ic-input-mode": "viability", "ic-blank": "0.050, 0.052, 0.049", "ic-control-conc": "0", "ic-unit": "nM" } }
        ],
        elisa: [
          { label: "4PL ELISA", values: { "elisa-fit-mode": "fourpl", "elisa-unit": "pg/mL", "elisa-cv-threshold": "15" } },
          { label: "线性 BCA", values: { "elisa-fit-mode": "linear", "elisa-unit": "µg/µL", "elisa-cv-threshold": "10" } }
        ],
        qpcr: [
          { label: "20µL SYBR", values: { "rt-target-rna": "1000", "rt-total-vol": "20", "rt-gdna-vol": "4", "rt-mix-vol": "5", "rt-other-vol": "0", "qpcr-total-vol": "20", "qpcr-replicates": "4", "qpcr-extra": "1", "qpcr-mix-vol": "10", "qpcr-forward-vol": "0.4", "qpcr-reverse-vol": "0.4", "qpcr-cdna-vol": "2", "qpcr-other-vol": "0" } },
          { label: "10µL 快速体系", values: { "qpcr-total-vol": "10", "qpcr-replicates": "4", "qpcr-extra": "1", "qpcr-mix-vol": "5", "qpcr-forward-vol": "0.2", "qpcr-reverse-vol": "0.2", "qpcr-cdna-vol": "1", "qpcr-other-vol": "0" } }
        ],
        mastermix: [
          { label: "20µL qPCR", values: { "mm-total-vol": "20", "mm-mix-x": "2", "mm-forward-stock": "10", "mm-forward-final": "0.2", "mm-reverse-stock": "10", "mm-reverse-final": "0.2", "mm-template-vol": "2", "mm-other-vol": "0", "mm-replicates": "3", "mm-extra-pct": "10", "mm-min-extra": "1", "mm-template-mode": "separate" } },
          { label: "10µL qPCR", values: { "mm-total-vol": "10", "mm-mix-x": "2", "mm-forward-stock": "10", "mm-forward-final": "0.2", "mm-reverse-stock": "10", "mm-reverse-final": "0.2", "mm-template-vol": "1", "mm-other-vol": "0", "mm-replicates": "3", "mm-extra-pct": "10", "mm-min-extra": "1", "mm-template-mode": "separate" } }
        ],
        qpcrdata: [
          { label: "ΔΔCt 技术4孔", values: { "qpa-target-gene": "GeneA", "qpa-ref-gene": "ACTB", "qpa-expected-reps": "4", "qpa-ct-sd-threshold": "0.3", "qpa-test-mode": "welch" } }
        ],
        qmulti: [
          { label: "多基因 ACTB", values: { "qme-ref-genes": "ACTB", "qme-pair-mode": "name", "qme-row-offset": "1", "qme-expected-reps": "4", "qme-ct-sd-threshold": "0.3", "qme-test-mode": "welch", "qme-output-mode": "all" } }
        ],
        bca: [
          { label: "100µL RIPA", values: { "bca-ripa-volume": "100", "wb-boil-lysate-volume": "80", "bca-assay-volume": "10", "wb-final-lane-vol": "20", "wb-loading-x": "5", "wb-target-protein": "" } },
          { label: "60µL 少量样本", values: { "bca-ripa-volume": "60", "wb-boil-lysate-volume": "45", "bca-assay-volume": "8", "wb-final-lane-vol": "15", "wb-loading-x": "5", "wb-target-protein": "" } }
        ],
        wbdensity: [
          { label: "目的/ACTB", values: { "wbg-target-name": "Target", "wbg-ref-name": "ACTB", "wbg-control-group": "Control", "wbg-bg-target": "0", "wbg-bg-ref": "0", "wbg-test-mode": "welch" } },
          { label: "目的/GAPDH", values: { "wbg-target-name": "Target", "wbg-ref-name": "GAPDH", "wbg-control-group": "Control", "wbg-bg-target": "0", "wbg-bg-ref": "0", "wbg-test-mode": "welch" } }
        ],
        virus: [
          { label: "6孔 5µg", values: { "lv-total-dna": "5", "lv-transfer-ratio": "5", "lv-pax2-ratio": "3", "lv-md2g-ratio": "2", "lv-transfer-conc": "1000", "lv-pax2-conc": "1000", "lv-md2g-conc": "1000", "lv-pei-per-ug": "3", "lv-opti-ref-dna": "5", "lv-opti-ref-vol": "400" } },
          { label: "10cm 10µg", values: { "lv-total-dna": "10", "lv-transfer-ratio": "5", "lv-pax2-ratio": "3", "lv-md2g-ratio": "2", "lv-transfer-conc": "1000", "lv-pax2-conc": "1000", "lv-md2g-conc": "1000", "lv-pei-per-ug": "3", "lv-opti-ref-dna": "5", "lv-opti-ref-vol": "400" } }
        ]
      };

      function setupPresetRows() {
        Object.entries(PANEL_PRESETS).forEach(([panelName, presets]) => {
          const panel = $("panel-" + panelName);
          const head = panel?.querySelector(".module-head");
          if (!panel || !head || !presets.length) return;
          const row = document.createElement("div");
          row.className = "preset-row";
          row.innerHTML = `<span class="preset-label">常用预设</span>${presets.map((preset, index) => `<button class="action tiny ghost" type="button" data-preset-panel="${escapeHtml(panelName)}" data-preset-index="${index}">${escapeHtml(preset.label)}</button>`).join("")}`;
          head.insertAdjacentElement("afterend", row);
        });
      }

      function applyPreset(panelName, index) {
        const panel = $("panel-" + panelName);
        const preset = PANEL_PRESETS[panelName]?.[index];
        if (!panel || !preset) return;
        Object.entries(preset.values).forEach(([id, value]) => {
          const field = $(id);
          if (!field) return;
          writeFieldValue(field, value);
          validateSingleField(field);
          field.dispatchEvent(new Event("change", { bubbles: true }));
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        savePanelDraft(panel);
        setPanelDraftStatus(panel, `已套用预设：${preset.label}`);
      }

      function handlePresetClick(event) {
        const button = event.target.closest("[data-preset-panel]");
        if (!button) return;
        applyPreset(button.dataset.presetPanel, Number(button.dataset.presetIndex));
      }

      const MODULE_ASSUMPTIONS = {
        cell: ["Fast Read 102 按当前页面固定换算系数处理。", "输入体积单位为 mL，目标浓度单位为 cells/mL。"],
        seeding: ["细胞悬液默认混匀且浓度均一。", "终体积单位为 µL，多配比例只用于补偿移液损耗。"],
        drug: ["药物母液浓度按 mM，目标浓度按 µM 处理。", "结果只计算配液体积，不校正 DMSO 终浓度上限。"],
        viability: ["读数先按空白组扣背景，再按所选方法归一化。", "统计只用于快速预览，正式分析建议使用独立生物学重复。"],
        ic50: ["曲线用于快速估算 IC50，低/高平台不足时不应作为发表级拟合。", "0 浓度对照用于归一化，不参与 log 浓度拟合。"],
        elisa: ["标准品和样本复孔默认来自同一块板。", "4PL 为轻量数值拟合；发表前建议用 Prism 复核。"],
        flow: ["每行建议代表一个独立样本或生物学重复。", "P 值基于当前输入重复，分组设计仍需人工确认。"],
        qpcr: ["RT 与 qPCR 体积为数学配液换算。", "模板、引物和 Mix 体积不会自动替代试剂盒 SOP。"],
        mastermix: ["Master Mix 默认各样本/靶标使用相同体系。", "模板是否加入总 Mix 由模板模式决定。"],
        qpcrdata: ["ΔΔCt 以所选内参和对照样本为基准。", "技术重复统计只能说明孔级差异，不能替代生物学重复统计。"],
        qmulti: ["多基因分析会按内参基因归一化并尝试自动配对样本。", "导入后请先检查孔板布局和忽略孔。"],
        bca: ["BCA 浓度视为 RIPA 裂解液原液浓度。", "加入高倍 Loading buffer 后按体积稀释，不考虑煮样蒸发损失。"],
        wbdensity: ["图片 ROI 默认按暗带积分灰度 sum(255 - gray) 读取。", "背景扣除后再做目的/内参归一化。", "同一膜内比较更可靠，跨膜比较建议加入桥接样本。"],
        virus: ["质粒和 PEI 只做体积换算。", "包装条件仍需按细胞系、培养皿和实验室 SOP 调整。"]
      };

      function setupAssumptionNotes() {
        Object.entries(MODULE_ASSUMPTIONS).forEach(([panelName, lines]) => {
          const panel = $("panel-" + panelName);
          const head = panel?.querySelector(".module-head");
          if (!panel || !head || !lines.length) return;
          const details = document.createElement("details");
          details.className = "formula-box module-assumptions";
          details.innerHTML = `
            <summary>本模块假设与单位</summary>
            ${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
          `;
          head.insertAdjacentElement("afterend", details);
        });
      }

      function parseRtSamples(text) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length >= 2) {
            return { name: parts[0], conc: parseFloat(parts[1]), raw: line };
          }
          return { name: parts[0] || "Sample_" + (index + 1), conc: NaN, raw: line };
        });
      }

      function parseGeneLines(text) {
        return splitLines(text);
      }

      function parseNumbers(text) {
        return text.split(/[\s,，;；\t]+/)
          .map((value) => parseFloat(value))
          .filter((value) => isFinite(value));
      }

      function parseNameList(text) {
        const seen = new Set();
        return String(text || "").split(/[\n,，;；\t]+/)
          .map((value) => value.trim())
          .filter((value) => {
            const key = qpaNorm(value);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      }

      function csvCell(value) {
        return `"${String(value ?? "").replace(/"/g, "\"\"")}"`;
      }

      function rowsToCsv(rows) {
        return rows.map((row) => row.map(csvCell).join(",")).join("\n");
      }

      function downloadCsv(filename, csv) {
        if (!csv) return;
        const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }

      function parseBcaSamples(text) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 3) {
            return { name: "Line_" + (index + 1), dilution: NaN, ods: [], raw: line };
          }
          return {
            name: parts[0],
            dilution: parseFloat(parts[1]),
            ods: parts.slice(2).map((value) => parseFloat(value)).filter((value) => isFinite(value)),
            raw: line
          };
        });
      }

      function calculateCell() {
        const cellCount = getNumber("cell-count");
        const currentVolume = getNumber("cell-volume");
        const targetConc = getNumber("cell-target-conc");

        if (!isFinite(cellCount) || cellCount < 0 || !isFinite(currentVolume) || currentVolume <= 0 || !isFinite(targetConc) || targetConc <= 0) {
          setResult("cell-result", "<p class=\"result-title\">请填写有效的三个数据。</p>", "danger");
          return;
        }

        const currentConc = cellCount * 10000;
        const totalCells = currentConc * currentVolume;
        const finalVolume = totalCells / targetConc;
        const addMediumMl = finalVolume - currentVolume;
        const addMediumUl = addMediumMl * 1000;

        const metrics = `
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(currentConc, 0)}</strong><span>当前细胞浓度 cells/mL</span></div>
            <div class="metric"><strong>${fmtInt(totalCells)}</strong><span>当前总细胞数 cells</span></div>
            <div class="metric"><strong>${fmt(finalVolume, 3)} mL</strong><span>达到目标浓度后的最终体积</span></div>
            <div class="metric"><strong>${addMediumMl >= 0 ? fmt(addMediumMl, 3) + " mL" : "需浓缩"}</strong><span>需要补加培养基</span></div>
          </div>
        `;

        const rows = [
          ["上样方式", "直接吸取 20 µL 细胞悬液计数，无额外稀释"],
          ["一个大方格细胞数量", fmt(cellCount, 3)],
          ["当前细胞浓度", `${fmt(currentConc, 0)} cells/mL<br>${sci(currentConc)} cells/mL`],
          ["当前细胞悬液体积", `${fmt(currentVolume, 3)} mL`],
          ["当前总细胞数", `${fmtInt(totalCells)} cells<br>${sci(totalCells)} cells`],
          ["目标细胞浓度", `${fmt(targetConc, 0)} cells/mL<br>${sci(targetConc)} cells/mL`],
          ["达到目标浓度后的最终体积", `${fmt(finalVolume, 3)} mL`]
        ];

        let conclusion = "";
        let tone = "ok";
        if (addMediumMl >= 0) {
          rows.push(["需要补加培养基", `<strong>${fmt(addMediumMl, 3)} mL</strong><br><strong>${fmt(addMediumUl, 3)} µL</strong>`]);
          conclusion = "<div class=\"notice ok\"><strong>结论：</strong>可以直接补加培养基稀释到目标浓度。</div>";
        } else {
          rows.push(["需要补加培养基", "<strong>不能通过补加培养基达到目标浓度</strong>"]);
          rows.push(["建议重悬体积", `${fmt(finalVolume, 3)} mL`]);
          conclusion = `<div class="notice danger"><strong>结论：</strong>当前浓度低于目标浓度，不能通过补加培养基达到目标浓度，需要离心浓缩。建议重悬至 ${fmt(finalVolume, 3)} mL。</div>`;
          tone = "danger";
        }

        setResult(
          "cell-result",
          `<p class="result-title">细胞计数与补液结果</p>${metrics}${table(["项目", "结果"], rows)}${conclusion}`,
          tone
        );
      }

      function fillCellExample() {
        $("cell-count").value = "220";
        $("cell-volume").value = "1";
        $("cell-target-conc").value = "1500000";
        calculateCell();
      }

      function handleSeedPlateChange() {
        const value = $("seed-plate").value;
        if (value !== "custom") $("seed-final-vol").value = value;
      }

      function calculateSeeding() {
        const conc = getNumber("seed-conc");
        const targetCells = getNumber("seed-target");
        const wells = parseInt($("seed-wells").value, 10);
        const finalVolUl = getNumber("seed-final-vol");
        const extraPct = getNumber("seed-extra");

        if (!isFinite(conc) || conc <= 0 || !isFinite(targetCells) || targetCells <= 0 ||
          !Number.isInteger(wells) || wells <= 0 || !isFinite(finalVolUl) || finalVolUl <= 0 ||
          !isFinite(extraPct) || extraPct < 0) {
          setResult("seed-result", "<p class=\"result-title\">细胞铺板参数不完整，请检查浓度、目标细胞数、孔数、终体积和多配比例。</p>", "danger");
          return false;
        }

        const extraFactor = 1 + extraPct / 100;
        const cellVolPerWellUl = targetCells / conc * 1000;
        const mediumPerWellUl = finalVolUl - cellVolPerWellUl;
        const totalWells = wells * extraFactor;
        const totalCellVolUl = cellVolPerWellUl * totalWells;
        const totalMediumUl = mediumPerWellUl * totalWells;
        const totalMixUl = finalVolUl * totalWells;
        const totalCells = targetCells * wells * extraFactor;
        const seedingConc = targetCells / (finalVolUl / 1000);

        let tone = "ok";
        const notices = [];
        if (mediumPerWellUl < -1e-9) {
          tone = "danger";
          notices.push("当前细胞浓度不足，达到目标每孔细胞数所需细胞悬液体积已经超过每孔终体积。建议离心浓缩细胞或降低目标细胞数。");
        } else if (mediumPerWellUl < finalVolUl * 0.1) {
          tone = "warn";
          notices.push("细胞悬液占比偏高，建议确认铺板终体积是否足够，或先浓缩细胞后再铺板。");
        }

        const rows = [
          ["当前细胞浓度", `${fmt(conc, 0)} cells/mL<br>${sci(conc)} cells/mL`],
          ["目标每孔细胞数", `${fmtInt(targetCells)} cells/well`],
          ["每孔终体积", `${fmt(finalVolUl, 3)} µL`],
          ["每孔细胞悬液", `<strong>${fmt(cellVolPerWellUl, 3)} µL</strong>`],
          ["每孔培养基", `<strong>${fmt(mediumPerWellUl, 3)} µL</strong>`],
          ["实际孔数", `${fmtInt(wells)} 孔`],
          ["多配后等效孔数", `${fmt(totalWells, 3)} 孔`],
          ["总细胞悬液", `<strong>${fmt(totalCellVolUl, 3)} µL</strong>`],
          ["总培养基", `<strong>${fmt(totalMediumUl, 3)} µL</strong>`],
          ["总混合液", `${fmt(totalMixUl, 3)} µL`]
        ];

        let html = `
          <p class="result-title">细胞铺板配液结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(cellVolPerWellUl, 3)} µL</strong><span>每孔细胞悬液</span></div>
            <div class="metric"><strong>${fmt(mediumPerWellUl, 3)} µL</strong><span>每孔培养基</span></div>
            <div class="metric"><strong>${fmt(totalCellVolUl, 3)} µL</strong><span>总细胞悬液</span></div>
            <div class="metric"><strong>${fmt(totalMediumUl, 3)} µL</strong><span>总培养基</span></div>
          </div>
          <div class="small">铺板后终浓度约 ${fmt(seedingConc, 0)} cells/mL；总细胞需求约 ${fmtInt(totalCells)} cells。</div>
          ${table(["项目", "结果"], rows)}
        `;

        html += notices.length
          ? notices.map((text) => `<div class="notice ${tone === "danger" ? "danger" : "warn"}"><strong>提醒：</strong>${escapeHtml(text)}</div>`).join("")
          : `<div class="notice ok"><strong>建议记录：</strong>${fmtInt(wells)} 孔；每孔 ${fmtInt(targetCells)} cells；每孔加入细胞悬液 ${fmt(cellVolPerWellUl, 3)} µL，培养基 ${fmt(mediumPerWellUl, 3)} µL。</div>`;

        setResult("seed-result", html, tone);
        return tone !== "danger";
      }

      function fillSeedingExample() {
        $("seed-conc").value = "1500000";
        $("seed-target").value = "200000";
        $("seed-wells").value = "6";
        $("seed-plate").value = "2000";
        $("seed-final-vol").value = "2000";
        $("seed-extra").value = "10";
        calculateSeeding();
      }

      function parseDrugTargets(text) {
        return parseNumbers(text).filter((value, index, values) => values.indexOf(value) === index).sort((a, b) => a - b);
      }

      function calculateDrugGradient() {
        const stockMm = getNumber("drug-stock");
        const finalVolUl = getNumber("drug-final-vol");
        const wells = parseInt($("drug-wells").value, 10);
        const extraPct = getNumber("drug-extra");
        const minPipetteUl = getNumber("drug-min-pipette");
        const targets = parseDrugTargets($("drug-targets").value);

        if (!isFinite(stockMm) || stockMm <= 0 || !isFinite(finalVolUl) || finalVolUl <= 0 ||
          !Number.isInteger(wells) || wells <= 0 || !isFinite(extraPct) || extraPct < 0 ||
          !isFinite(minPipetteUl) || minPipetteUl < 0 || !targets.length || targets.some((value) => value < 0)) {
          setResult("drug-result", "<p class=\"result-title\">药物梯度参数不完整，请检查母液浓度、目标浓度、每孔体积、孔数和多配比例。</p>", "danger");
          return false;
        }

        const stockUm = stockMm * 1000;
        const extraFactor = 1 + extraPct / 100;
        let hasWarn = false;
        let hasDanger = false;
        const rows = targets.map((targetUm) => {
          const stockPerWellUl = targetUm / stockUm * finalVolUl;
          const mediumPerWellUl = finalVolUl - stockPerWellUl;
          const stockTotalUl = stockPerWellUl * wells * extraFactor;
          const mediumTotalUl = mediumPerWellUl * wells * extraFactor;
          const solventPct = finalVolUl > 0 ? stockPerWellUl / finalVolUl * 100 : NaN;
          let status = "OK";
          if (targetUm === 0) {
            status = "Vehicle/control";
          } else if (mediumPerWellUl < -1e-9) {
            status = "母液体积超过终体积";
            hasDanger = true;
          } else if (stockPerWellUl > 0 && stockPerWellUl < minPipetteUl) {
            status = "单孔母液体积偏小，建议先配中间液";
            hasWarn = true;
          }
          return {
            targetUm,
            stockPerWellUl,
            mediumPerWellUl,
            stockTotalUl,
            mediumTotalUl,
            solventPct,
            status
          };
        });

        const maxSolventPct = Math.max(...rows.map((row) => isFinite(row.solventPct) ? row.solventPct : 0));
        const maxStockPerWellUl = Math.max(...rows.map((row) => isFinite(row.stockPerWellUl) ? row.stockPerWellUl : 0));
        const tableRows = rows.map((row) => {
          const vehicleTopUpPerWellUl = Math.max(maxStockPerWellUl - row.stockPerWellUl, 0);
          const equalVehicleMediumPerWellUl = finalVolUl - row.stockPerWellUl - vehicleTopUpPerWellUl;
          return [
            `${fmt(row.targetUm, 4)} µM`,
            fmt(row.stockPerWellUl, 4),
            fmt(vehicleTopUpPerWellUl, 4),
            fmt(equalVehicleMediumPerWellUl, 4),
            fmt(row.stockTotalUl, 4),
            fmt(vehicleTopUpPerWellUl * wells * extraFactor, 4),
            fmt(equalVehicleMediumPerWellUl * wells * extraFactor, 4),
            `${fmt(row.solventPct, 4)}%`,
            escapeHtml(row.status)
          ];
        });

        let tone = hasDanger ? "danger" : (hasWarn ? "warn" : "ok");
        let html = `
          <p class="result-title">药物梯度配液结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(stockMm, 3)} mM</strong><span>药物母液浓度</span></div>
            <div class="metric"><strong>${fmt(finalVolUl, 3)} µL</strong><span>每孔终体积</span></div>
            <div class="metric"><strong>${fmtInt(wells)}</strong><span>每个浓度孔数</span></div>
            <div class="metric"><strong>${fmt(maxSolventPct, 4)}%</strong><span>最高溶剂比例</span></div>
          </div>
          <div class="small">表格按最高浓度组的 vehicle 比例，给低浓度组补足 vehicle 后计算培养基体积。</div>
          ${table(["目标浓度", "母液/孔 µL", "补 vehicle/孔 µL", "培养基/孔 µL", "母液总量 µL", "补 vehicle 总量 µL", "培养基总量 µL", "溶剂比例", "判断"], tableRows)}
        `;

        if (hasDanger) {
          html += `<div class="notice danger"><strong>提醒：</strong>至少有一个目标浓度无法由当前母液和终体积直接配出，请提高母液浓度或降低目标浓度。</div>`;
        } else if (hasWarn) {
          html += `<div class="notice warn"><strong>提醒：</strong>部分组单孔母液体积低于 ${fmt(minPipetteUl, 3)} µL，建议先配中间工作液，减少移液误差。</div>`;
        } else {
          html += `<div class="notice ok"><strong>建议记录：</strong>按 ${fmt(extraPct, 1)}% 多配；最高 vehicle 比例 ${fmt(maxSolventPct, 4)}%。</div>`;
        }

        setResult("drug-result", html, tone);
        return !hasDanger;
      }

      function fillDrugExample() {
        $("drug-targets").value = "0, 1, 2, 5, 10";
        $("drug-stock").value = "10";
        $("drug-final-vol").value = "1000";
        $("drug-wells").value = "3";
        $("drug-extra").value = "10";
        $("drug-min-pipette").value = "0.5";
        calculateDrugGradient();
      }

      function parseViabilityRows(text) {
        return splitLines(text).map((line) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          const name = parts[0] || "";
          const values = parts.slice(1).map((value) => parseFloat(value)).filter((value) => isFinite(value));
          return { name, values };
        }).filter((row) => row.name && row.values.length);
      }

      function viabilityFindGroup(groups, name) {
        const key = qpaNorm(name);
        if (!key) return null;
        return groups.find((group) => qpaNorm(group.name) === key) || null;
      }

      function viabilityPercentRows(results, controlName) {
        return results.map((entry) => [
          escapeHtml(entry.name),
          fmt(entry.rawMean, 4),
          fmt(entry.rawSd, 4),
          fmt(entry.primaryMean, 3),
          fmt(entry.primarySd, 3),
          fmt(entry.primarySem, 3),
          fmt(entry.secondaryMean, 3),
          isFinite(entry.pValue) ? fmt(entry.pValue, 5) : "n/a",
          escapeHtml(entry.pStars),
          qpaNorm(entry.name) === qpaNorm(controlName) ? "对照" : ""
        ]);
      }

      function viabilityChartHtml(results, label) {
        const max = Math.max(1, ...results.map((entry) => Math.max(entry.primaryMean, 0)));
        return `
          <div class="mini-chart-grid">
            <div class="gene-chart">
              <h4>${escapeHtml(label)}</h4>
              ${results.map((entry) => {
                const width = Math.max(2, Math.min(100, Math.max(entry.primaryMean, 0) / max * 100));
                return `
                  <div class="bar-line">
                    <span>${escapeHtml(entry.name)}</span>
                    <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
                    <span>${fmt(entry.primaryMean, 2)} ${entry.pStars}</span>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        `;
      }

      function vaShowError(title, message) {
        vaLastCsv = "";
        $("va-download").disabled = true;
        setResult("va-result", `<p class="result-title">${escapeHtml(title)}</p><div class="notice danger">${escapeHtml(message)}</div>`, "danger");
        return false;
      }

      function vaControlNames() {
        return $("va-control-group").value
          .split(/[,，;；]+/)
          .map((name) => name.trim())
          .filter(Boolean);
      }

      function parseViabilityTimeRows(text) {
        return splitLines(text).map((line) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 4) return null;
          const panel = parts[0];
          const group = parts[1];
          const time = parseFloat(parts[2]);
          const values = parts.slice(3).map((value) => parseFloat(value)).filter((value) => isFinite(value));
          if (!panel || !group || !isFinite(time) || !values.length) return null;
          return { panel, group, time, values };
        }).filter(Boolean);
      }

      function vaPanelKey(panel, time) {
        return `${qpaNorm(panel)}@@${time}`;
      }

      function summarizeViabilityTimecourse(rows, blankName, controlNames, testMode) {
        const blankKey = qpaNorm(blankName);
        const controlKeys = controlNames.map(qpaNorm).filter(Boolean);
        const blankMap = new Map();
        rows.forEach((row) => {
          if (blankKey && qpaNorm(row.group) === blankKey) {
            const key = vaPanelKey(row.panel, row.time);
            const merged = (blankMap.get(key) || []).concat(row.values);
            blankMap.set(key, merged);
          }
        });

        const panels = [];
        const panelMap = new Map();
        rows.forEach((row) => {
          if (blankKey && qpaNorm(row.group) === blankKey) return;
          const panelKey = qpaNorm(row.panel);
          if (!panelMap.has(panelKey)) {
            const panel = { name: row.panel, times: new Set(), groups: [], groupMap: new Map() };
            panelMap.set(panelKey, panel);
            panels.push(panel);
          }
          const panel = panelMap.get(panelKey);
          const groupKey = qpaNorm(row.group);
          if (!panel.groupMap.has(groupKey)) {
            const group = { name: row.group, timeMap: new Map() };
            panel.groupMap.set(groupKey, group);
            panel.groups.push(group);
          }
          const group = panel.groupMap.get(groupKey);
          const blankValues = blankMap.get(vaPanelKey(row.panel, row.time)) || [];
          const blankMean = blankValues.length ? mean(blankValues) : 0;
          const values = row.values.map((value) => value - blankMean);
          panel.times.add(row.time);
          group.timeMap.set(row.time, (group.timeMap.get(row.time) || []).concat(values));
        });

        panels.forEach((panel) => {
          panel.times = Array.from(panel.times).sort((a, b) => a - b);
          panel.groups.forEach((group) => {
            group.points = panel.times.map((time) => {
              const values = group.timeMap.get(time) || [];
              return {
                time,
                values,
                mean: mean(values),
                sd: sd(values),
                sem: qpaSem(values),
                pValue: NaN,
                pStars: ""
              };
            }).filter((point) => point.values.length);
            group.pointMap = new Map(group.points.map((point) => [point.time, point]));
          });

          panel.controlGroup = panel.groups.find((group) => controlKeys.includes(qpaNorm(group.name))) || null;
          if (!panel.controlGroup && !controlKeys.length) panel.controlGroup = panel.groups[0] || null;
          panel.groups.forEach((group) => {
            group.points.forEach((point) => {
              const controlPoint = panel.controlGroup?.pointMap.get(point.time);
              if (controlPoint && qpaNorm(group.name) !== qpaNorm(panel.controlGroup.name)) {
                const p = qpaTTest(point.values, controlPoint.values, testMode);
                point.pValue = p.p;
                point.pStars = qpaPStars(p.p);
              } else if (panel.controlGroup && qpaNorm(group.name) === qpaNorm(panel.controlGroup.name)) {
                point.pValue = 1;
                point.pStars = "ns";
              }
            });
            const finalPoint = [...group.points].reverse().find((point) => point.values.length);
            group.finalStars = finalPoint?.pStars || "";
          });
        });
        return panels.filter((panel) => panel.groups.length && panel.times.length);
      }

      function viabilityTimecourseRows(panels) {
        const rows = [];
        panels.forEach((panel) => {
          panel.groups.forEach((group) => {
            group.points.forEach((point) => {
              rows.push([
                escapeHtml(panel.name),
                escapeHtml(group.name),
                fmt(point.time, 2),
                fmt(point.mean, 4),
                fmt(point.sd, 4),
                fmt(point.sem, 4),
                fmtInt(point.values.length),
                isFinite(point.pValue) ? fmt(point.pValue, 5) : "n/a",
                escapeHtml(point.pStars)
              ]);
            });
          });
        });
        return rows;
      }

      function buildViabilityTimecourseCsv(panels, yLabel) {
        const rows = [["Prism XY data"], [`Y axis`, yLabel]];
        panels.forEach((panel) => {
          rows.push([], ["Panel", panel.name]);
          const repCounts = panel.groups.map((group) => Math.max(...group.points.map((point) => point.values.length), 1));
          const header = ["Time(h)"];
          panel.groups.forEach((group, groupIndex) => {
            for (let index = 0; index < repCounts[groupIndex]; index += 1) {
              header.push(`${group.name} rep${index + 1}`);
            }
          });
          rows.push(header);
          panel.times.forEach((time) => {
            const row = [time];
            panel.groups.forEach((group, groupIndex) => {
              const values = group.pointMap.get(time)?.values || [];
              for (let index = 0; index < repCounts[groupIndex]; index += 1) {
                row.push(isFinite(values[index]) ? values[index] : "");
              }
            });
            rows.push(row);
          });
        });
        rows.push([], ["Summary"], ["Panel", "Group", "Time(h)", "Mean", "SD", "SEM", "n", "P value", "Stars"]);
        panels.forEach((panel) => {
          panel.groups.forEach((group) => {
            group.points.forEach((point) => {
              rows.push([
                panel.name,
                group.name,
                point.time,
                fmt(point.mean, 6),
                fmt(point.sd, 6),
                fmt(point.sem, 6),
                point.values.length,
                isFinite(point.pValue) ? point.pValue : "",
                point.pStars
              ]);
            });
          });
        });
        return rowsToCsv(rows);
      }

      function vaNiceMax(value) {
        if (!isFinite(value) || value <= 0) return 1;
        if (value <= 2) return Math.ceil(value * 10) / 10;
        if (value <= 10) return Math.ceil(value);
        return Math.ceil(value / 10) * 10;
      }

      function drawViabilityTimecourse(panels, yLabel) {
        const canvas = $("va-time-chart");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const colors = ["#f2bf4c", "#8fd0e8", "#f28f90", "#5279b7", "#56a36c", "#b47cc7", "#4b5b61"];
        const cols = panels.length === 1 ? 1 : 2;
        const rows = Math.ceil(panels.length / cols);
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        panels.forEach((panel, panelIndex) => {
          const col = panelIndex % cols;
          const row = Math.floor(panelIndex / cols);
          const cellW = width / cols;
          const cellH = height / rows;
          const ox = col * cellW;
          const oy = row * cellH;
          const pad = { l: 70, r: 30, t: 58, b: 62 };
          const plotX = ox + pad.l;
          const plotY = oy + pad.t;
          const plotW = cellW - pad.l - pad.r;
          const plotH = cellH - pad.t - pad.b;
          const minTime = Math.min(...panel.times);
          const maxTime = Math.max(...panel.times);
          const xSpan = maxTime === minTime ? 1 : maxTime - minTime;
          const maxY = vaNiceMax(Math.max(1, ...panel.groups.flatMap((group) => group.points.map((point) => point.mean + point.sem))) * 1.12);
          const xFor = (time) => plotX + ((time - minTime) / xSpan) * plotW;
          const yFor = (value) => plotY + plotH - (Math.max(0, value) / maxY) * plotH;

          ctx.strokeStyle = "#111111";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(plotX, plotY);
          ctx.lineTo(plotX, plotY + plotH);
          ctx.lineTo(plotX + plotW, plotY + plotH);
          ctx.stroke();

          ctx.fillStyle = "#111111";
          ctx.font = "bold 18px system-ui, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(panel.name, ox + cellW / 2, oy + 28);

          ctx.font = "12px system-ui, sans-serif";
          ctx.textAlign = "right";
          for (let tick = 0; tick <= 4; tick += 1) {
            const value = maxY / 4 * tick;
            const y = yFor(value);
            ctx.strokeStyle = tick === 0 ? "#111111" : "#d9e3e0";
            ctx.lineWidth = tick === 0 ? 2 : 1;
            ctx.beginPath();
            ctx.moveTo(plotX, y);
            ctx.lineTo(plotX + plotW, y);
            ctx.stroke();
            ctx.fillStyle = "#111111";
            ctx.fillText(fmt(value, maxY <= 2 ? 1 : 0), plotX - 10, y + 4);
          }

          ctx.textAlign = "center";
          panel.times.forEach((time) => {
            const x = xFor(time);
            ctx.strokeStyle = "#111111";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, plotY + plotH);
            ctx.lineTo(x, plotY + plotH + 7);
            ctx.stroke();
            ctx.fillStyle = "#111111";
            ctx.fillText(fmt(time, 0), x, plotY + plotH + 24);
          });

          ctx.font = "bold 13px system-ui, sans-serif";
          ctx.fillText("Time (h)", plotX + plotW / 2, plotY + plotH + 48);
          ctx.save();
          ctx.translate(plotX - 52, plotY + plotH / 2);
          ctx.rotate(-Math.PI / 2);
          ctx.fillText(yLabel, 0, 0);
          ctx.restore();

          panel.groups.forEach((group, groupIndex) => {
            const color = colors[groupIndex % colors.length];
            const points = group.points.slice().sort((a, b) => a.time - b.time);
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            points.forEach((point, pointIndex) => {
              const x = xFor(point.time);
              const y = yFor(point.mean);
              if (pointIndex === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            });
            ctx.stroke();

            points.forEach((point) => {
              const x = xFor(point.time);
              const y = yFor(point.mean);
              const yTop = yFor(point.mean + point.sem);
              const yBottom = yFor(Math.max(0, point.mean - point.sem));
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.moveTo(x, yTop);
              ctx.lineTo(x, yBottom);
              ctx.moveTo(x - 5, yTop);
              ctx.lineTo(x + 5, yTop);
              ctx.moveTo(x - 5, yBottom);
              ctx.lineTo(x + 5, yBottom);
              ctx.stroke();
              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              ctx.arc(x, y, 4, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.stroke();
            });

            const lastPoint = points[points.length - 1];
            if (lastPoint && lastPoint.pStars && lastPoint.pStars !== "ns") {
              ctx.fillStyle = "#111111";
              ctx.font = "bold 14px system-ui, sans-serif";
              ctx.textAlign = "left";
              ctx.fillText(lastPoint.pStars, Math.min(plotX + plotW - 22, xFor(lastPoint.time) + 8), Math.max(plotY + 14, yFor(lastPoint.mean) - 8));
            }
          });

          let legendX = plotX + 8;
          let legendY = plotY + 8;
          ctx.font = "bold 12px system-ui, sans-serif";
          ctx.textAlign = "left";
          panel.groups.forEach((group, groupIndex) => {
            const color = colors[groupIndex % colors.length];
            ctx.strokeStyle = color;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(legendX, legendY);
            ctx.lineTo(legendX + 22, legendY);
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(legendX + 11, legendY, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#1b3136";
            ctx.fillText(group.name, legendX + 30, legendY + 4);
            legendY += 18;
            if (legendY > plotY + 92) {
              legendY = plotY + 8;
              legendX += 120;
            }
          });
        });
      }

      function calculateViabilityTimecourse() {
        try {
          const rows = parseViabilityTimeRows($("va-data").value);
          if (!rows.length) throw new Error("时间曲线需要按“面板名, 组名, 时间h, 复孔1...”格式粘贴数据。");
          const controlNames = vaControlNames();
          const yLabel = $("va-y-label").value.trim() || "OD450";
          const panels = summarizeViabilityTimecourse(rows, $("va-blank-group").value.trim(), controlNames, $("va-test-mode").value);
          if (!panels.length) throw new Error("没有可绘制的时间曲线数据，请检查面板名、组名、时间和复孔读数。");
          const missingControls = controlNames.length
            ? panels.filter((panel) => !panel.controlGroup).map((panel) => panel.name)
            : [];
          const chartHeight = Math.max(460, Math.ceil(panels.length / 2) * 420);
          vaLastCsv = buildViabilityTimecourseCsv(panels, yLabel);
          $("va-download").disabled = false;
          const html = `
            <p class="result-title">CCK8 / MTT 时间曲线分析结果</p>
            <div class="metric-grid">
              <div class="metric"><strong>${fmtInt(panels.length)}</strong><span>面板数</span></div>
              <div class="metric"><strong>${fmtInt(rows.length)}</strong><span>数据行</span></div>
              <div class="metric"><strong>${escapeHtml(yLabel)}</strong><span>Y 轴指标</span></div>
              <div class="metric"><strong>${controlNames.length ? escapeHtml(controlNames.join(", ")) : "每个面板首组"}</strong><span>统计对照</span></div>
            </div>
            <div class="chart-wrap">
              <canvas id="va-time-chart" class="wide-chart" width="1080" height="${chartHeight}" style="height:${chartHeight}px"></canvas>
            </div>
            ${table(["面板", "组别", "时间(h)", "均值", "SD", "SEM", "n", "P value", "显著性"], viabilityTimecourseRows(panels))}
            <div class="notice ${missingControls.length ? "warn" : "ok"}"><strong>QC：</strong>${missingControls.length ? `这些面板没有找到指定对照：${escapeHtml(missingControls.join(", "))}。图可绘制，但对应 P 值会留空。` : "已按时间点计算均值、误差线和相对对照的 P 值。"}</div>
          `;
          setResult("va-result", html, missingControls.length ? "warn" : "ok");
          requestAnimationFrame(() => drawViabilityTimecourse(panels, yLabel));
          return true;
        } catch (error) {
          return vaShowError("时间曲线分析失败", error.message);
        }
      }

      function calculateViability() {
        const method = $("va-method").value;
        if (method === "timecourse") return calculateViabilityTimecourse();
        try {
        const groups = parseViabilityRows($("va-data").value);
        const blankName = $("va-blank-group").value.trim();
        const controlName = $("va-control-group").value.trim();
        const effectorName = $("va-effector-group").value.trim();
        const spontaneousName = $("va-spontaneous-group").value.trim();
        const maxName = $("va-max-group").value.trim();
        const testMode = $("va-test-mode").value;
        const subtractEffector = $("va-subtract-effector").checked;

        const blankGroup = viabilityFindGroup(groups, blankName);
        const controlGroup = viabilityFindGroup(groups, controlName);
        const effectorGroup = viabilityFindGroup(groups, effectorName);
        const spontaneousGroup = viabilityFindGroup(groups, spontaneousName);
        const maxGroup = viabilityFindGroup(groups, maxName);
        const blankMean = blankGroup ? mean(blankGroup.values) : 0;
        const effectorBackground = subtractEffector && effectorGroup ? mean(effectorGroup.values) - blankMean : 0;
        const special = new Set([blankName, effectorName, spontaneousName, maxName].filter(Boolean).map(qpaNorm));

        if (!groups.length) {
          vaLastCsv = "";
          $("va-download").disabled = true;
          setResult("va-result", "<p class=\"result-title\">没有可用读数</p><div class=\"notice danger\">请按“组名, 复孔1, 复孔2...”格式粘贴数据。</div>", "danger");
          return false;
        }

        let primaryLabel = "存活率 %";
        let secondaryLabel = "抑制率 %";
        let controlValues = [];
        let results = [];
        const warnings = [];

        if (method === "viability") {
          if (!controlGroup) throw new Error("CCK8/MTT 需要有效的对照组。");
          const controlCorrected = mean(controlGroup.values.map((value) => value - blankMean));
          if (!isFinite(controlCorrected) || controlCorrected === 0) throw new Error("对照组扣空白后的均值不能为 0。");
          results = groups.filter((group) => !special.has(qpaNorm(group.name))).map((group) => {
            const primaryValues = group.values.map((value) => (value - blankMean) / controlCorrected * 100);
            const secondaryValues = primaryValues.map((value) => 100 - value);
            return { group, primaryValues, secondaryValues };
          });
          controlValues = results.find((entry) => qpaNorm(entry.group.name) === qpaNorm(controlGroup.name))?.primaryValues || [];
        } else if (method === "adcc-viability") {
          if (!controlGroup) throw new Error("ADCC 存活读数法需要 Target only / 对照组。");
          const targetControl = mean(controlGroup.values.map((value) => value - blankMean));
          if (!isFinite(targetControl) || targetControl === 0) throw new Error("Target only 对照扣空白后的均值不能为 0。");
          primaryLabel = "ADCC杀伤率 %";
          secondaryLabel = "剩余存活率 %";
          results = groups.filter((group) => !special.has(qpaNorm(group.name))).map((group) => {
            const isControl = qpaNorm(group.name) === qpaNorm(controlGroup.name);
            const primaryValues = group.values.map((value) => {
              const corrected = value - blankMean - (isControl ? 0 : effectorBackground);
              return (1 - corrected / targetControl) * 100;
            });
            const secondaryValues = primaryValues.map((value) => 100 - value);
            return { group, primaryValues, secondaryValues };
          });
          controlValues = results.find((entry) => qpaNorm(entry.group.name) === qpaNorm(controlGroup.name))?.primaryValues || [];
          if (subtractEffector && effectorName && !effectorGroup) warnings.push("已勾选扣除 effector-only 背景，但没有找到对应组名。");
        } else {
          if (!spontaneousGroup || !maxGroup) throw new Error("ADCC/LDH 释放法需要自发释放组和最大裂解组。");
          const spontaneous = mean(spontaneousGroup.values.map((value) => value - blankMean));
          const maximum = mean(maxGroup.values.map((value) => value - blankMean));
          const denom = maximum - spontaneous;
          if (!isFinite(denom) || denom === 0) throw new Error("最大裂解与自发释放扣空白后的差值不能为 0。");
          primaryLabel = "ADCC/LDH杀伤率 %";
          secondaryLabel = "未裂解比例 %";
          results = groups.filter((group) => !special.has(qpaNorm(group.name))).map((group) => {
            const primaryValues = group.values.map((value) => (value - blankMean - effectorBackground - spontaneous) / denom * 100);
            const secondaryValues = primaryValues.map((value) => 100 - value);
            return { group, primaryValues, secondaryValues };
          });
          const controlEntry = results.find((entry) => qpaNorm(entry.group.name) === qpaNorm(controlName));
          controlValues = controlEntry ? controlEntry.primaryValues : [];
          if (subtractEffector && effectorName && !effectorGroup) warnings.push("已勾选扣除 effector-only 背景，但没有找到对应组名。");
        }

        const finalResults = results.map((entry) => {
          const p = controlValues.length && qpaNorm(entry.group.name) !== qpaNorm(controlName)
            ? qpaTTest(entry.primaryValues, controlValues, testMode)
            : { p: qpaNorm(entry.group.name) === qpaNorm(controlName) ? 1 : NaN };
          return {
            name: entry.group.name,
            rawMean: mean(entry.group.values),
            rawSd: sd(entry.group.values),
            primaryValues: entry.primaryValues,
            primaryMean: mean(entry.primaryValues),
            primarySd: sd(entry.primaryValues),
            primarySem: qpaSem(entry.primaryValues),
            secondaryMean: mean(entry.secondaryValues),
            pValue: p.p,
            pStars: qpaPStars(p.p)
          };
        });

        if (!finalResults.length) throw new Error("没有可输出的实验组，请检查空白组、对照组和特殊组名设置。");

        const csvRows = [
          ["组名", "原始均值", "原始SD", primaryLabel, "SD", "SEM", secondaryLabel, "P value", "显著性"],
          ...finalResults.map((entry) => [
            entry.name,
            fmt(entry.rawMean, 6),
            fmt(entry.rawSd, 6),
            fmt(entry.primaryMean, 6),
            fmt(entry.primarySd, 6),
            fmt(entry.primarySem, 6),
            fmt(entry.secondaryMean, 6),
            isFinite(entry.pValue) ? entry.pValue : "",
            entry.pStars
          ]),
          [],
          ["Prism column data"],
          finalResults.map((entry) => entry.name),
          ...Array.from({ length: Math.max(...finalResults.map((entry) => entry.primaryValues.length)) }, (_, index) => finalResults.map((entry) => isFinite(entry.primaryValues[index]) ? entry.primaryValues[index] : ""))
        ];
        vaLastCsv = rowsToCsv(csvRows);
        $("va-download").disabled = false;

        let html = `
          <p class="result-title">细胞活性 / ADCC 分析结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmtInt(groups.length)}</strong><span>读数组数</span></div>
            <div class="metric"><strong>${fmt(blankMean, 4)}</strong><span>空白均值</span></div>
            <div class="metric"><strong>${escapeHtml(primaryLabel)}</strong><span>主要输出指标</span></div>
            <div class="metric"><strong>${controlName ? escapeHtml(controlName) : "未指定"}</strong><span>统计对照</span></div>
          </div>
          ${viabilityChartHtml(finalResults, primaryLabel)}
          ${table(["组名", "原始均值", "原始SD", primaryLabel, "SD", "SEM", secondaryLabel, "P value", "显著性", "备注"], viabilityPercentRows(finalResults, controlName))}
          <div class="notice ${warnings.length ? "warn" : "ok"}"><strong>QC：</strong>${warnings.length ? escapeHtml(warnings.join("；")) : "计算完成，未发现明显设置缺失。"}</div>
        `;
        setResult("va-result", html, warnings.length ? "warn" : "ok");
        return true;
        } catch (error) {
          return vaShowError("细胞活性 / ADCC 分析失败", error.message);
        }
      }

      function fillViabilityExample() {
        const method = $("va-method").value;
        if (method === "timecourse") {
          $("va-data").value = "Cell_A, Blank, 0, 0.048, 0.050, 0.049\nCell_A, Blank, 24, 0.050, 0.051, 0.049\nCell_A, Blank, 48, 0.051, 0.050, 0.052\nCell_A, Blank, 72, 0.050, 0.052, 0.051\nCell_A, Blank, 96, 0.052, 0.051, 0.053\nCell_A, Control, 0, 0.46, 0.48, 0.47\nCell_A, Control, 24, 0.76, 0.79, 0.74\nCell_A, Control, 48, 1.22, 1.27, 1.19\nCell_A, Control, 72, 1.66, 1.70, 1.62\nCell_A, Control, 96, 1.82, 1.88, 1.78\nCell_A, Treat_1, 0, 0.45, 0.47, 0.46\nCell_A, Treat_1, 24, 0.56, 0.60, 0.58\nCell_A, Treat_1, 48, 0.78, 0.82, 0.80\nCell_A, Treat_1, 72, 0.98, 1.03, 1.00\nCell_A, Treat_1, 96, 1.18, 1.25, 1.21\nCell_A, Treat_2, 0, 0.44, 0.46, 0.45\nCell_A, Treat_2, 24, 0.48, 0.51, 0.49\nCell_A, Treat_2, 48, 0.56, 0.60, 0.58\nCell_A, Treat_2, 72, 0.80, 0.85, 0.83\nCell_A, Treat_2, 96, 0.98, 1.03, 1.00\nCell_B, Blank, 0, 0.046, 0.048, 0.047\nCell_B, Blank, 24, 0.048, 0.047, 0.049\nCell_B, Blank, 48, 0.049, 0.050, 0.048\nCell_B, Blank, 72, 0.049, 0.051, 0.050\nCell_B, Blank, 96, 0.050, 0.051, 0.049\nCell_B, Vector, 0, 0.44, 0.45, 0.43\nCell_B, Vector, 24, 0.56, 0.58, 0.55\nCell_B, Vector, 48, 0.70, 0.73, 0.69\nCell_B, Vector, 72, 0.96, 1.00, 0.94\nCell_B, Vector, 96, 1.16, 1.22, 1.18\nCell_B, Treat_A, 0, 0.43, 0.45, 0.44\nCell_B, Treat_A, 24, 0.62, 0.65, 0.61\nCell_B, Treat_A, 48, 0.88, 0.92, 0.86\nCell_B, Treat_A, 72, 1.36, 1.42, 1.38\nCell_B, Treat_A, 96, 1.62, 1.70, 1.66";
          $("va-control-group").value = "Control, Vector";
          $("va-effector-group").value = "";
          $("va-spontaneous-group").value = "";
          $("va-max-group").value = "";
          $("va-y-label").value = "OD450";
        } else if (method === "adcc-viability") {
          $("va-data").value = "Blank, 0.050, 0.052, 0.049\nTarget_only, 0.900, 0.910, 0.895\nEffector_only, 0.110, 0.115, 0.108\nE:T_5_1, 0.660, 0.640, 0.655\nE:T_10_1, 0.430, 0.445, 0.420";
          $("va-control-group").value = "Target_only";
          $("va-effector-group").value = "Effector_only";
          $("va-spontaneous-group").value = "";
          $("va-max-group").value = "";
        } else if (method === "adcc-release") {
          $("va-data").value = "Blank, 0.050, 0.052, 0.049\nSpontaneous, 0.180, 0.176, 0.184\nMax, 1.200, 1.180, 1.210\nEffector_only, 0.090, 0.095, 0.092\nE:T_5_1, 0.410, 0.398, 0.422\nE:T_10_1, 0.680, 0.655, 0.672";
          $("va-control-group").value = "";
          $("va-effector-group").value = "Effector_only";
          $("va-spontaneous-group").value = "Spontaneous";
          $("va-max-group").value = "Max";
        } else {
          $("va-data").value = "Blank, 0.050, 0.052, 0.049\nControl, 0.820, 0.840, 0.835\nDrug_1, 0.610, 0.625, 0.618\nDrug_2, 0.360, 0.372, 0.355";
          $("va-control-group").value = "Control";
          $("va-effector-group").value = "";
          $("va-spontaneous-group").value = "";
          $("va-max-group").value = "";
        }
        $("va-blank-group").value = "Blank";
        calculateViability();
      }

      function downloadViabilityCsv() {
        downloadCsv("cell_viability_adcc_prism.csv", vaLastCsv);
      }

      function parseIc50Rows(text) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 3) return null;
          const firstNumber = parseFloat(parts[0]);
          const series = isFinite(firstNumber) ? "Drug_1" : parts[0];
          const conc = isFinite(firstNumber) ? firstNumber : parseFloat(parts[1]);
          const values = (isFinite(firstNumber) ? parts.slice(1) : parts.slice(2)).map((value) => parseFloat(value)).filter((value) => isFinite(value));
          if (!isFinite(conc) || !values.length) return null;
          return { series, conc, values, raw: line, index };
        }).filter(Boolean);
      }

      function icGroupRows(rows) {
        const map = new Map();
        rows.forEach((row) => {
          const key = row.series || "Drug_1";
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        });
        return Array.from(map.entries()).map(([series, entries]) => ({ series, entries }));
      }

      function icEstimateIc50(points) {
        const sorted = points.filter((point) => point.conc > 0 && isFinite(point.inhibitionMean)).sort((a, b) => a.conc - b.conc);
        for (let i = 1; i < sorted.length; i += 1) {
          const a = sorted[i - 1];
          const b = sorted[i];
          if ((a.inhibitionMean - 50) * (b.inhibitionMean - 50) <= 0 && a.inhibitionMean !== b.inhibitionMean) {
            const la = Math.log10(a.conc);
            const lb = Math.log10(b.conc);
            const ratio = (50 - a.inhibitionMean) / (b.inhibitionMean - a.inhibitionMean);
            return Math.pow(10, la + ratio * (lb - la));
          }
        }
        return NaN;
      }

      function icBuildPrismCsv(analyses, unit) {
        const rows = [["Prism XY data"], ["Y", "Inhibition %"], ["Unit", unit]];
        analyses.forEach((analysis) => {
          rows.push([], ["Series", analysis.series]);
          const maxN = Math.max(...analysis.points.map((point) => point.inhibitionValues.length));
          rows.push(["Concentration", ...Array.from({ length: maxN }, (_, index) => `${analysis.series} rep${index + 1}`)]);
          analysis.points.forEach((point) => {
            rows.push([point.conc, ...Array.from({ length: maxN }, (_, index) => isFinite(point.inhibitionValues[index]) ? point.inhibitionValues[index] : "")]);
          });
        });
        rows.push([], ["Summary"], ["Series", "IC50", "Unit", "Status"]);
        analyses.forEach((analysis) => rows.push([analysis.series, isFinite(analysis.ic50) ? analysis.ic50 : "", unit, analysis.status]));
        return rowsToCsv(rows);
      }

      function icDrawChart(analyses, unit) {
        const box = $("ic-chart-box");
        const canvas = $("ic-chart");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        const colors = ["#08766d", "#d99022", "#5279b7", "#d23f57", "#56a36c", "#b47cc7"];
        const allPositive = analyses.flatMap((analysis) => analysis.points.filter((point) => point.conc > 0));
        if (!allPositive.length) return;
        box.style.display = "block";
        box.className = "result ok";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pad = { l: 76, r: 34, t: 38, b: 78 };
        const w = canvas.width - pad.l - pad.r;
        const h = canvas.height - pad.t - pad.b;
        const minLog = Math.floor(Math.min(...allPositive.map((point) => Math.log10(point.conc))));
        const maxLog = Math.ceil(Math.max(...allPositive.map((point) => Math.log10(point.conc))));
        const yMax = Math.max(100, Math.ceil(Math.max(...analyses.flatMap((analysis) => analysis.points.map((point) => point.inhibitionMean + point.inhibitionSem)), 100) / 20) * 20);
        const xFor = (conc) => pad.l + ((Math.log10(conc) - minLog) / Math.max(1, maxLog - minLog)) * w;
        const yFor = (value) => pad.t + h - (Math.max(0, value) / yMax) * h;

        ctx.strokeStyle = "#cfd8d6";
        ctx.lineWidth = 1;
        ctx.font = "12px Arial";
        ctx.fillStyle = "#607177";
        for (let i = 0; i <= 5; i += 1) {
          const yVal = yMax * i / 5;
          const y = yFor(yVal);
          ctx.beginPath();
          ctx.moveTo(pad.l, y);
          ctx.lineTo(pad.l + w, y);
          ctx.stroke();
          ctx.fillText(fmt(yVal, 0), 24, y + 4);
        }
        for (let log = minLog; log <= maxLog; log += 1) {
          const conc = Math.pow(10, log);
          const x = xFor(conc);
          ctx.strokeStyle = "#dfe7e5";
          ctx.beginPath();
          ctx.moveTo(x, pad.t);
          ctx.lineTo(x, pad.t + h);
          ctx.stroke();
          ctx.fillStyle = "#172326";
          ctx.textAlign = "center";
          ctx.fillText(`10^${log}`, x, pad.t + h + 22);
        }
        ctx.strokeStyle = "#172326";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad.l, pad.t);
        ctx.lineTo(pad.l, pad.t + h);
        ctx.lineTo(pad.l + w, pad.t + h);
        ctx.stroke();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = "#d23f57";
        ctx.beginPath();
        ctx.moveTo(pad.l, yFor(50));
        ctx.lineTo(pad.l + w, yFor(50));
        ctx.stroke();
        ctx.setLineDash([]);

        analyses.forEach((analysis, index) => {
          const color = colors[index % colors.length];
          const points = analysis.points.filter((point) => point.conc > 0).sort((a, b) => a.conc - b.conc);
          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          points.forEach((point, pointIndex) => {
            const x = xFor(point.conc);
            const y = yFor(point.inhibitionMean);
            if (pointIndex === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          points.forEach((point) => {
            const x = xFor(point.conc);
            const y = yFor(point.inhibitionMean);
            const err = point.inhibitionSem / yMax * h;
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, y - err);
            ctx.lineTo(x, y + err);
            ctx.moveTo(x - 5, y - err);
            ctx.lineTo(x + 5, y - err);
            ctx.moveTo(x - 5, y + err);
            ctx.lineTo(x + 5, y + err);
            ctx.stroke();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          });
          if (isFinite(analysis.ic50) && analysis.ic50 > 0) {
            const x = xFor(analysis.ic50);
            ctx.setLineDash([5, 4]);
            ctx.strokeStyle = color;
            ctx.beginPath();
            ctx.moveTo(x, yFor(50));
            ctx.lineTo(x, pad.t + h);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        });

        ctx.fillStyle = "#172326";
        ctx.font = "700 18px Arial";
        ctx.textAlign = "center";
        ctx.fillText("IC50 药物敏感性曲线", canvas.width / 2, 24);
        ctx.font = "14px Arial";
        ctx.fillText(`浓度 (${unit})`, pad.l + w / 2, canvas.height - 22);
        ctx.save();
        ctx.translate(22, pad.t + h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("抑制率 %", 0, 0);
        ctx.restore();
      }

      function calculateIc50() {
        try {
          const rows = parseIc50Rows($("ic-data").value);
          const mode = $("ic-input-mode").value;
          const blanks = parseNumbers($("ic-blank").value);
          const blankMean = blanks.length ? mean(blanks) : 0;
          const controlConc = parseFloat($("ic-control-conc").value);
          const unit = $("ic-unit").value.trim() || "µM";
          if (!rows.length) throw new Error("没有可用浓度梯度数据。");
          const analyses = icGroupRows(rows).map(({ series, entries }) => {
            const controlRows = entries.filter((entry) => Math.abs(entry.conc - controlConc) < 1e-12);
            const controlValues = controlRows.flatMap((entry) => entry.values.map((value) => value - blankMean));
            const controlMean = mean(controlValues);
            if (mode === "raw" && (!controlValues.length || !isFinite(controlMean) || controlMean === 0)) {
              throw new Error(`${series} 缺少有效 0 浓度对照，无法把原始读数换算为存活率。`);
            }
            const byConc = new Map();
            entries.forEach((entry) => {
              if (!byConc.has(entry.conc)) byConc.set(entry.conc, []);
              byConc.get(entry.conc).push(...entry.values);
            });
            const points = Array.from(byConc.entries()).map(([conc, values]) => {
              let viabilityValues;
              let inhibitionValues;
              if (mode === "raw") {
                viabilityValues = values.map((value) => (value - blankMean) / controlMean * 100);
                inhibitionValues = viabilityValues.map((value) => 100 - value);
              } else if (mode === "viability") {
                viabilityValues = values;
                inhibitionValues = values.map((value) => 100 - value);
              } else {
                inhibitionValues = values;
                viabilityValues = values.map((value) => 100 - value);
              }
              return {
                conc,
                rawValues: values,
                viabilityValues,
                inhibitionValues,
                viabilityMean: mean(viabilityValues),
                viabilitySd: sd(viabilityValues),
                inhibitionMean: mean(inhibitionValues),
                inhibitionSd: sd(inhibitionValues),
                inhibitionSem: qpaSem(inhibitionValues)
              };
            }).sort((a, b) => a.conc - b.conc);
            const ic50 = icEstimateIc50(points);
            const status = isFinite(ic50) ? "OK" : "曲线未跨过 50% 抑制率";
            return { series, points, ic50, status, controlMean };
          });
          const tableRows = analyses.flatMap((analysis) => analysis.points.map((point) => [
            escapeHtml(analysis.series),
            fmt(point.conc, 6),
            fmt(point.viabilityMean, 3),
            fmt(point.viabilitySd, 3),
            fmt(point.inhibitionMean, 3),
            fmt(point.inhibitionSd, 3),
            fmt(point.inhibitionSem, 3),
            fmtInt(point.inhibitionValues.length)
          ]));
          icLastCsv = icBuildPrismCsv(analyses, unit);
          $("ic-download").disabled = !icLastCsv;
          const warn = analyses.some((analysis) => !isFinite(analysis.ic50));
          setResult("ic-result", `
            <p class="result-title">IC50 计算结果</p>
            <div class="metric-grid">
              ${analyses.map((analysis) => `<div class="metric"><strong>${isFinite(analysis.ic50) ? `${fmt(analysis.ic50, 4)} ${escapeHtml(unit)}` : "未跨过50%"}</strong><span>${escapeHtml(analysis.series)} IC50</span></div>`).join("")}
              <div class="metric"><strong>${fmt(blankMean, 4)}</strong><span>空白均值</span></div>
            </div>
            ${table(["系列", `浓度 ${unit}`, "存活率均值%", "存活率SD", "抑制率均值%", "抑制率SD", "SEM", "n"], tableRows)}
            <div class="notice ${warn ? "warn" : "ok"}"><strong>QC：</strong>${warn ? "部分系列没有跨过 50% 抑制率，无法估算 IC50。" : "已按 log 浓度插值估算 IC50，并生成 Prism XY 数据。"}</div>
          `, warn ? "warn" : "ok");
          icDrawChart(analyses, unit);
          return true;
        } catch (error) {
          icLastCsv = "";
          $("ic-download").disabled = true;
          $("ic-chart-box").style.display = "none";
          setResult("ic-result", `<p class="result-title">IC50 计算失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
          return false;
        }
      }

      function fillIc50Example() {
        $("ic-input-mode").value = "raw";
        $("ic-blank").value = "0.050, 0.052, 0.049";
        $("ic-control-conc").value = "0";
        $("ic-unit").value = "µM";
        $("ic-data").value = "Drug_A, 0, 0.860, 0.842, 0.855\nDrug_A, 0.01, 0.820, 0.803, 0.812\nDrug_A, 0.03, 0.745, 0.730, 0.738\nDrug_A, 0.1, 0.610, 0.592, 0.603\nDrug_A, 0.3, 0.410, 0.398, 0.405\nDrug_A, 1, 0.250, 0.238, 0.244\nDrug_A, 3, 0.160, 0.150, 0.155\nDrug_A, 10, 0.105, 0.098, 0.101";
        calculateIc50();
      }

      function downloadIc50Csv() {
        downloadCsv("ic50_prism_xy.csv", icLastCsv);
      }

      function parseElisaStandards(text) {
        return splitLines(text).map((line) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          const conc = parseFloat(parts[0]);
          const values = parts.slice(1).map((value) => parseFloat(value)).filter((value) => isFinite(value));
          return { conc, values };
        }).filter((row) => isFinite(row.conc) && row.values.length);
      }

      function parseElisaSamples(text) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 3) return { name: `Line_${index + 1}`, dilution: NaN, values: [] };
          return {
            name: parts[0],
            dilution: parseFloat(parts[1]),
            values: parts.slice(2).map((value) => parseFloat(value)).filter((value) => isFinite(value))
          };
        });
      }

      function elisaStandardPoints(rows, blankMean) {
        const map = new Map();
        rows.forEach((row) => {
          if (!map.has(row.conc)) map.set(row.conc, []);
          map.get(row.conc).push(...row.values);
        });
        return Array.from(map.entries()).map(([conc, values]) => {
          const corrected = values.map((value) => value - blankMean);
          return {
            conc,
            values,
            corrected,
            mean: mean(corrected),
            sd: sd(corrected),
            cv: cvPercent(corrected),
            n: corrected.length
          };
        }).sort((a, b) => a.conc - b.conc);
      }

      function elisaPredict4pl(params, x) {
        const { a, b, c, d } = params;
        if (!isFinite(x) || x < 0 || !isFinite(c) || c <= 0) return NaN;
        if (x === 0) return a;
        return d + (a - d) / (1 + Math.pow(x / c, b));
      }

      function elisaInvert4pl(params, y) {
        const { a, b, c, d } = params;
        if (![a, b, c, d, y].every((value) => isFinite(value)) || c <= 0 || b <= 0) return NaN;
        if (Math.abs(y - d) < 1e-12) return NaN;
        const ratio = (a - d) / (y - d) - 1;
        if (!isFinite(ratio) || ratio <= 0) return NaN;
        return c * Math.pow(ratio, 1 / b);
      }

      function elisaFit4pl(points) {
        const clean = points.filter((point) => point.conc > 0 && isFinite(point.mean)).sort((a, b) => a.conc - b.conc);
        if (clean.length < 4) return { ok: false, message: "4PL 至少需要 4 个非零浓度标准点。" };
        const xs = clean.map((point) => point.conc);
        const ys = clean.map((point) => point.mean);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const yRange = Math.max(maxY - minY, 0.001);
        const targetMid = minY + yRange / 2;
        const midPoint = clean.reduce((best, point) => Math.abs(point.mean - targetMid) < Math.abs(best.mean - targetMid) ? point : best, clean[0]);
        let params = {
          a: Math.min(0, minY),
          d: maxY,
          c: midPoint.conc,
          b: 1
        };
        const bounds = {
          a: [minY - yRange, maxY + yRange],
          d: [minY - yRange, maxY + yRange],
          logC: [Math.log(Math.min(...xs) / 100), Math.log(Math.max(...xs) * 100)],
          b: [0.05, 8]
        };
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
        const sse = (candidate) => {
          if (candidate.b <= 0 || candidate.c <= 0 || candidate.d <= candidate.a) return Infinity;
          return clean.reduce((sum, point) => {
            const pred = elisaPredict4pl(candidate, point.conc);
            return sum + Math.pow(point.mean - pred, 2);
          }, 0);
        };
        let vector = [params.a, params.d, Math.log(params.c), params.b];
        let steps = [yRange / 2, yRange / 2, Math.log(10), 0.8];
        let best = sse(params);
        for (let iter = 0; iter < 140; iter += 1) {
          for (let i = 0; i < vector.length; i += 1) {
            for (const direction of [1, -1]) {
              const next = vector.slice();
              next[i] += steps[i] * direction;
              next[0] = clamp(next[0], bounds.a[0], bounds.a[1]);
              next[1] = clamp(next[1], bounds.d[0], bounds.d[1]);
              next[2] = clamp(next[2], bounds.logC[0], bounds.logC[1]);
              next[3] = clamp(next[3], bounds.b[0], bounds.b[1]);
              const candidate = { a: next[0], d: next[1], c: Math.exp(next[2]), b: next[3] };
              const score = sse(candidate);
              if (score < best) {
                vector = next;
                params = candidate;
                best = score;
              }
            }
          }
          steps = steps.map((step) => step * 0.92);
        }
        const yMean = ys.reduce((sum, value) => sum + value, 0) / ys.length;
        const ssTot = ys.reduce((sum, value) => sum + Math.pow(value - yMean, 2), 0);
        return {
          ok: true,
          model: "4pl",
          params,
          r2: ssTot === 0 ? 1 : 1 - best / ssTot,
          predict: (x) => elisaPredict4pl(params, x),
          inverse: (y) => elisaInvert4pl(params, y)
        };
      }

      function elisaFitLinear(points) {
        const clean = points.filter((point) => isFinite(point.conc) && isFinite(point.mean));
        const fit = vaLinearRegression(clean.map((point) => ({ x: point.conc, y: point.mean })));
        if (!isFinite(fit.slope) || fit.slope === 0) return { ok: false, message: "线性拟合失败，请检查标准品浓度和 OD。" };
        return {
          ok: true,
          model: "linear",
          slope: fit.slope,
          intercept: fit.intercept,
          r2: fit.r2,
          predict: (x) => fit.slope * x + fit.intercept,
          inverse: (y) => (y - fit.intercept) / fit.slope
        };
      }

      function elisaBuildCsv(standardPoints, sampleRows, fit, unit, blankMean) {
        const rows = [
          ["ELISA analysis"],
          ["Fit model", fit.model === "4pl" ? "4PL" : "Linear"],
          ["Unit", unit],
          ["Blank mean", blankMean],
          ["R2", fit.r2],
          []
        ];
        if (fit.model === "4pl") rows.push(["4PL", "A", fit.params.a, "B", fit.params.b, "C", fit.params.c, "D", fit.params.d], []);
        else rows.push(["Linear", "Slope", fit.slope, "Intercept", fit.intercept], []);
        rows.push(["Standards"], ["Concentration", "Mean corrected OD", "SD", "CV%", "n"]);
        standardPoints.forEach((point) => rows.push([point.conc, point.mean, point.sd, point.cv, point.n]));
        rows.push([], ["Samples"], ["Sample", "Dilution", "Mean OD", "Corrected OD", `Plate concentration ${unit}`, `Original concentration ${unit}`, "CV%", "n", "Status"]);
        sampleRows.forEach((row) => rows.push([row.name, row.dilution, row.rawMean, row.correctedMean, row.plateConc, row.originalConc, row.cv, row.n, row.status]));
        rows.push([], ["Prism XY standard curve"], ["Concentration", "Corrected OD"]);
        standardPoints.forEach((point) => point.corrected.forEach((value) => rows.push([point.conc, value])));
        return rowsToCsv(rows);
      }

      function elisaDrawChart(standardPoints, sampleRows, fit, unit) {
        const box = $("elisa-chart-box");
        const canvas = $("elisa-chart");
        if (!canvas || !fit.ok) return;
        const ctx = canvas.getContext("2d");
        const clean = standardPoints.filter((point) => isFinite(point.conc) && isFinite(point.mean));
        if (clean.length < 2) return;
        const xMin = Math.min(0, ...clean.map((point) => point.conc));
        const xMax = Math.max(...clean.map((point) => point.conc));
        const yMax = Math.max(...clean.map((point) => point.mean + (point.sd || 0)), ...sampleRows.map((row) => row.correctedMean || 0), 0.1) * 1.12;
        const xFor = (x) => 76 + ((x - xMin) / Math.max(1e-12, xMax - xMin)) * (canvas.width - 112);
        const yFor = (y) => 38 + (canvas.height - 116) - (Math.max(0, y) / yMax) * (canvas.height - 116);
        box.style.display = "block";
        box.className = "result ok";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = "12px Arial";
        ctx.strokeStyle = "#cfd8d6";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i += 1) {
          const yVal = yMax * i / 5;
          const y = yFor(yVal);
          ctx.beginPath();
          ctx.moveTo(76, y);
          ctx.lineTo(canvas.width - 36, y);
          ctx.stroke();
          ctx.fillStyle = "#607177";
          ctx.textAlign = "right";
          ctx.fillText(fmt(yVal, 3), 68, y + 4);
        }
        for (let i = 0; i <= 5; i += 1) {
          const xVal = xMin + (xMax - xMin) * i / 5;
          const x = xFor(xVal);
          ctx.strokeStyle = "#e1e9e7";
          ctx.beginPath();
          ctx.moveTo(x, 38);
          ctx.lineTo(x, canvas.height - 78);
          ctx.stroke();
          ctx.fillStyle = "#172326";
          ctx.textAlign = "center";
          ctx.fillText(fmt(xVal, 3), x, canvas.height - 54);
        }
        ctx.strokeStyle = "#172326";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(76, 38);
        ctx.lineTo(76, canvas.height - 78);
        ctx.lineTo(canvas.width - 36, canvas.height - 78);
        ctx.stroke();

        ctx.strokeStyle = "#08766d";
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i <= 120; i += 1) {
          const xVal = xMin + (xMax - xMin) * i / 120;
          const yVal = fit.predict(xVal);
          const x = xFor(xVal);
          const y = yFor(yVal);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        clean.forEach((point) => {
          const x = xFor(point.conc);
          const y = yFor(point.mean);
          const err = (point.sd || 0) / yMax * (canvas.height - 116);
          ctx.strokeStyle = "#d99022";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y - err);
          ctx.lineTo(x, y + err);
          ctx.moveTo(x - 5, y - err);
          ctx.lineTo(x + 5, y - err);
          ctx.moveTo(x - 5, y + err);
          ctx.lineTo(x + 5, y + err);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });

        ctx.fillStyle = "#172326";
        ctx.font = "700 18px Arial";
        ctx.textAlign = "center";
        ctx.fillText("ELISA 标准曲线", canvas.width / 2, 24);
        ctx.font = "14px Arial";
        ctx.fillText(`浓度 (${unit})`, canvas.width / 2, canvas.height - 22);
        ctx.save();
        ctx.translate(22, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("校正 OD", 0, 0);
        ctx.restore();
      }

      function calculateElisa() {
        try {
          const standards = parseElisaStandards($("elisa-standards").value);
          const samples = parseElisaSamples($("elisa-samples").value);
          const blanks = parseNumbers($("elisa-blank").value);
          const blankMean = blanks.length ? mean(blanks) : 0;
          const fitMode = $("elisa-fit-mode").value;
          const unit = $("elisa-unit").value.trim() || "pg/mL";
          const cvThreshold = getNumber("elisa-cv-threshold");
          if (standards.length < 2) throw new Error("至少需要 2 个标准品浓度。");
          if (!samples.length) throw new Error("请填写样本数据。");
          const standardPoints = elisaStandardPoints(standards, blankMean);
          const fit = fitMode === "linear" ? elisaFitLinear(standardPoints) : elisaFit4pl(standardPoints);
          if (!fit.ok) throw new Error(fit.message);
          const minConc = Math.min(...standardPoints.map((point) => point.conc));
          const maxConc = Math.max(...standardPoints.map((point) => point.conc));
          let hasWarn = false;
          const sampleRows = samples.map((sample) => {
            const rawMean = mean(sample.values);
            const correctedMean = rawMean - blankMean;
            const plateConc = fit.inverse(correctedMean);
            const originalConc = plateConc * sample.dilution;
            const cv = cvPercent(sample.values);
            let status = "可用";
            if (!sample.values.length) status = "缺少OD";
            else if (!isFinite(sample.dilution) || sample.dilution <= 0) status = "稀释倍数无效";
            else if (!isFinite(plateConc) || plateConc < 0) status = "超出曲线或无法反算";
            else if (plateConc < minConc || plateConc > maxConc) status = "超出标准曲线范围";
            else if (isFinite(cvThreshold) && cv > cvThreshold) status = `CV%>${fmt(cvThreshold, 1)}`;
            if (status !== "可用") hasWarn = true;
            return { name: sample.name, dilution: sample.dilution, n: sample.values.length, rawMean, correctedMean, plateConc, originalConc, cv, status };
          });
          const standardRows = standardPoints.map((point) => [
            fmt(point.conc, 6),
            fmt(point.mean, 4),
            fmt(point.sd, 4),
            fmt(point.cv, 2),
            fmtInt(point.n)
          ]);
          const sampleTableRows = sampleRows.map((row) => [
            escapeHtml(row.name),
            fmt(row.dilution, 3),
            fmt(row.rawMean, 4),
            fmt(row.correctedMean, 4),
            fmt(row.plateConc, 4),
            fmt(row.originalConc, 4),
            fmt(row.cv, 2),
            fmtInt(row.n),
            escapeHtml(row.status)
          ]);
          elisaLastCsv = elisaBuildCsv(standardPoints, sampleRows, fit, unit, blankMean);
          $("elisa-download").disabled = !elisaLastCsv;
          const fitText = fit.model === "4pl"
            ? `4PL: A=${fmt(fit.params.a, 4)}, B=${fmt(fit.params.b, 4)}, C=${fmt(fit.params.c, 4)}, D=${fmt(fit.params.d, 4)}`
            : `线性: y=${fmt(fit.slope, 6)}x + ${fmt(fit.intercept, 6)}`;
          setResult("elisa-result", `
            <p class="result-title">ELISA 计算结果</p>
            <div class="metric-grid">
              <div class="metric"><strong>${fmt(blankMean, 4)}</strong><span>空白均值</span></div>
              <div class="metric"><strong>${fmt(fit.r2, 4)}</strong><span>标准曲线 R²</span></div>
              <div class="metric"><strong>${escapeHtml(fit.model === "4pl" ? "4PL" : "Linear")}</strong><span>拟合方式</span></div>
            </div>
            <div class="notice ${hasWarn ? "warn" : "ok"}"><strong>曲线：</strong>${escapeHtml(fitText)}</div>
            <div class="section-title">标准品</div>
            ${table([`浓度 ${unit}`, "校正OD均值", "SD", "CV%", "n"], standardRows)}
            <div class="section-title">样本</div>
            ${table(["样本", "稀释倍数", "平均OD", "校正OD", `板上浓度 ${unit}`, `原样浓度 ${unit}`, "CV%", "n", "判断"], sampleTableRows)}
          `, hasWarn ? "warn" : "ok");
          elisaDrawChart(standardPoints, sampleRows, fit, unit);
          return true;
        } catch (error) {
          elisaLastCsv = "";
          $("elisa-download").disabled = true;
          $("elisa-chart-box").style.display = "none";
          setResult("elisa-result", `<p class="result-title">ELISA 计算失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
          return false;
        }
      }

      function fillElisaExample() {
        $("elisa-standards").value = "0, 0.052, 0.050, 0.051\n15.6, 0.132, 0.136, 0.134\n31.2, 0.205, 0.210, 0.208\n62.5, 0.346, 0.352, 0.349\n125, 0.625, 0.638, 0.631\n250, 1.020, 1.035, 1.028\n500, 1.585, 1.612, 1.600\n1000, 2.120, 2.150, 2.136";
        $("elisa-samples").value = "Sample_1, 20, 0.742, 0.758, 0.750\nSample_2, 20, 1.105, 1.128, 1.116\nSample_3, 10, 0.485, 0.492, 0.489";
        $("elisa-blank").value = "0.052, 0.050, 0.051";
        $("elisa-fit-mode").value = "4pl";
        $("elisa-unit").value = "pg/mL";
        $("elisa-cv-threshold").value = "15";
        calculateElisa();
      }

      function downloadElisaCsv() {
        downloadCsv("elisa_standard_curve_results.csv", elisaLastCsv);
      }

      function flowMetricDefinitions(mode) {
        if (mode === "cycle") {
          return [
            ["g0g1", "G0/G1 %"],
            ["s", "S %"],
            ["g2m", "G2/M %"],
            ["subg1", "Sub-G1 %"]
          ];
        }
        return [
          ["total", "总凋亡 %"],
          ["early", "早期凋亡 %"],
          ["late", "晚期凋亡 %"],
          ["q1", "Q1 %"],
          ["q2", "Q2 %"],
          ["q3", "Q3 %"],
          ["q4", "Q4 %"]
        ];
      }

      function flowMetricLabel(metric, mode = $("flow-mode")?.value || "apoptosis") {
        return (flowMetricDefinitions(mode).find(([key]) => key === metric) || [metric, metric])[1];
      }

      function flowUpdateMetricOptions() {
        const mode = $("flow-mode").value;
        const current = $("flow-metric").value;
        const options = flowMetricDefinitions(mode);
        $("flow-metric").innerHTML = options.map(([key, label]) => `<option value="${key}">${label}</option>`).join("");
        $("flow-metric").value = options.some(([key]) => key === current) ? current : options[0][0];
        document.querySelectorAll(".flow-apoptosis-setting").forEach((node) => {
          node.style.display = mode === "apoptosis" ? "" : "none";
        });
      }

      function parseFlowRows(text, mode) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 4 || /^(group|sample|组名)$/i.test(parts[0])) return null;
          const secondIsNumber = isFinite(parseFloat(parts[1]));
          const group = parts[0] || `Group_${index + 1}`;
          const replicate = secondIsNumber ? `R${index + 1}` : parts[1];
          const values = (secondIsNumber ? parts.slice(1) : parts.slice(2)).map((value) => parseFloat(value)).filter((value) => isFinite(value));
          if (mode === "cycle") {
            if (values.length < 3) return null;
            return {
              group,
              replicate,
              g0g1: values[0],
              s: values[1],
              g2m: values[2],
              subg1: values.length >= 4 ? values[3] : NaN,
              raw: line
            };
          }
          if (values.length < 4) return null;
          const row = {
            group,
            replicate,
            q1: values[0],
            q2: values[1],
            q3: values[2],
            q4: values[3],
            raw: line
          };
          const earlyKey = $("flow-early-quadrant").value;
          const lateKey = $("flow-late-quadrant").value;
          row.early = row[earlyKey];
          row.late = row[lateKey];
          row.total = row.early + row.late;
          return row;
        }).filter(Boolean);
      }

      function flowGroupRows(rows, metric) {
        const map = new Map();
        rows.forEach((row) => {
          const value = row[metric];
          if (!isFinite(value)) return;
          if (!map.has(row.group)) map.set(row.group, []);
          map.get(row.group).push({ row, value });
        });
        return Array.from(map.entries()).map(([name, entries]) => {
          const values = entries.map((entry) => entry.value);
          return {
            name,
            entries,
            values,
            n: values.length,
            mean: mean(values),
            sd: sd(values),
            sem: qpaSem(values),
            p: NaN,
            stars: "n/a"
          };
        });
      }

      function flowBuildCsv(rows, summaries, mode, metric, controlName) {
        const metricLabel = flowMetricLabel(metric, mode);
        const csvRows = [["Flow cytometry analysis"], ["Mode", mode === "cycle" ? "Cell cycle" : "Apoptosis"], ["Metric", metricLabel], ["Control", controlName], []];
        if (mode === "cycle") {
          csvRows.push(["Raw"], ["Group", "Replicate", "G0/G1 %", "S %", "G2/M %", "Sub-G1 %"]);
          rows.forEach((row) => csvRows.push([row.group, row.replicate, row.g0g1, row.s, row.g2m, isFinite(row.subg1) ? row.subg1 : ""]));
        } else {
          csvRows.push(["Raw"], ["Group", "Replicate", "Q1 %", "Q2 %", "Q3 %", "Q4 %", "Early %", "Late %", "Total apoptosis %"]);
          rows.forEach((row) => csvRows.push([row.group, row.replicate, row.q1, row.q2, row.q3, row.q4, row.early, row.late, row.total]));
        }
        csvRows.push([], ["Summary"], ["Group", "n", "Mean", "SD", "SEM", "P value vs control", "Significance"]);
        summaries.forEach((summary) => csvRows.push([summary.name, summary.n, summary.mean, summary.sd, summary.sem, isFinite(summary.p) ? summary.p : "", summary.stars]));
        csvRows.push([], ["Prism column data"]);
        const maxN = Math.max(...summaries.map((summary) => summary.values.length));
        csvRows.push(summaries.map((summary) => summary.name));
        for (let i = 0; i < maxN; i += 1) {
          csvRows.push(summaries.map((summary) => isFinite(summary.values[i]) ? summary.values[i] : ""));
        }
        return rowsToCsv(csvRows);
      }

      function flowFormatP(p) {
        if (!isFinite(p)) return "对照";
        if (p < 0.0001) return "<0.0001";
        return fmt(p, 5);
      }

      function flowDrawChart(summaries, metricLabel) {
        const box = $("flow-chart-box");
        const canvas = $("flow-chart");
        if (!canvas || !summaries.length) return;
        const ctx = canvas.getContext("2d");
        box.style.display = "block";
        box.className = "result ok";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pad = { l: 72, r: 28, t: 44, b: 86 };
        const w = canvas.width - pad.l - pad.r;
        const h = canvas.height - pad.t - pad.b;
        const maxY = Math.max(10, ...summaries.map((summary) => summary.mean + (isFinite(summary.sem) ? summary.sem : 0))) * 1.28;
        const yFor = (value) => pad.t + h - (Math.max(0, value) / maxY) * h;
        const colors = ["#08766d", "#d99022", "#5279b7", "#d23f57", "#56a36c", "#b47cc7"];
        ctx.strokeStyle = "#cfd8d6";
        ctx.lineWidth = 1;
        ctx.font = "12px Arial";
        for (let i = 0; i <= 5; i += 1) {
          const yVal = maxY * i / 5;
          const y = yFor(yVal);
          ctx.beginPath();
          ctx.moveTo(pad.l, y);
          ctx.lineTo(pad.l + w, y);
          ctx.stroke();
          ctx.fillStyle = "#607177";
          ctx.textAlign = "right";
          ctx.fillText(fmt(yVal, 1), pad.l - 10, y + 4);
        }
        ctx.strokeStyle = "#172326";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad.l, pad.t);
        ctx.lineTo(pad.l, pad.t + h);
        ctx.lineTo(pad.l + w, pad.t + h);
        ctx.stroke();
        const slot = w / Math.max(1, summaries.length);
        const barW = Math.min(64, slot * 0.52);
        summaries.forEach((summary, index) => {
          const x = pad.l + slot * index + slot / 2;
          const y = yFor(summary.mean);
          const color = colors[index % colors.length];
          ctx.fillStyle = color;
          ctx.fillRect(x - barW / 2, y, barW, pad.t + h - y);
          const err = (isFinite(summary.sem) ? summary.sem : 0) / maxY * h;
          ctx.strokeStyle = "#172326";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x, y - err);
          ctx.lineTo(x, y + err);
          ctx.moveTo(x - 8, y - err);
          ctx.lineTo(x + 8, y - err);
          ctx.moveTo(x - 8, y + err);
          ctx.lineTo(x + 8, y + err);
          ctx.stroke();
          summary.values.forEach((value, dotIndex) => {
            const jitter = summary.values.length === 1 ? 0 : (dotIndex - (summary.values.length - 1) / 2) * Math.min(8, barW / summary.values.length);
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(x + jitter, yFor(value), 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "#172326";
            ctx.stroke();
          });
          ctx.save();
          ctx.translate(x, pad.t + h + 18);
          ctx.rotate(-Math.PI / 5);
          ctx.fillStyle = "#172326";
          ctx.textAlign = "right";
          ctx.font = "12px Arial";
          ctx.fillText(summary.name, 0, 0);
          ctx.restore();
          if (isFinite(summary.p)) {
            ctx.fillStyle = "#172326";
            ctx.textAlign = "center";
            ctx.font = "700 13px Arial";
            ctx.fillText(summary.stars, x, Math.max(18, y - err - 10));
          }
        });
        ctx.fillStyle = "#172326";
        ctx.textAlign = "center";
        ctx.font = "700 18px Arial";
        ctx.fillText(`流式 ${metricLabel}`, canvas.width / 2, 24);
        ctx.save();
        ctx.translate(20, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = "14px Arial";
        ctx.fillText(metricLabel, 0, 0);
        ctx.restore();
      }

      function calculateFlow() {
        try {
          const mode = $("flow-mode").value;
          const metric = $("flow-metric").value;
          const controlName = $("flow-control-group").value.trim() || "Control";
          const rows = parseFlowRows($("flow-data").value, mode);
          const testMode = $("flow-test-mode").value;
          if (!rows.length) throw new Error("没有解析到可用流式数据。");
          const summaries = flowGroupRows(rows, metric);
          if (!summaries.length) throw new Error("当前指标没有可用数值。");
          const control = summaries.find((summary) => qpaNorm(summary.name) === qpaNorm(controlName));
          if (!control) throw new Error("没有找到对照组，请检查对照组名。");
          summaries.forEach((summary) => {
            if (summary === control) {
              summary.p = NaN;
              summary.stars = "control";
              return;
            }
            const test = qpaTTest(summary.values, control.values, testMode);
            summary.p = test.p;
            summary.stars = qpaPStars(summary.p);
          });
          const metricLabel = flowMetricLabel(metric, mode);
          const rawRows = rows.map((row) => mode === "cycle"
            ? [escapeHtml(row.group), escapeHtml(row.replicate), fmt(row.g0g1, 3), fmt(row.s, 3), fmt(row.g2m, 3), fmt(row.subg1, 3)]
            : [escapeHtml(row.group), escapeHtml(row.replicate), fmt(row.q1, 3), fmt(row.q2, 3), fmt(row.q3, 3), fmt(row.q4, 3), fmt(row.early, 3), fmt(row.late, 3), fmt(row.total, 3)]
          );
          const summaryRows = summaries.map((summary) => [
            escapeHtml(summary.name),
            fmtInt(summary.n),
            fmt(summary.mean, 3),
            fmt(summary.sd, 3),
            fmt(summary.sem, 3),
            escapeHtml(flowFormatP(summary.p)),
            escapeHtml(summary.stars)
          ]);
          flowLastCsv = flowBuildCsv(rows, summaries, mode, metric, controlName);
          $("flow-download").disabled = !flowLastCsv;
          setResult("flow-result", `
            <p class="result-title">流式统计结果</p>
            <div class="metric-grid">
              <div class="metric"><strong>${escapeHtml(metricLabel)}</strong><span>当前指标</span></div>
              <div class="metric"><strong>${escapeHtml(control.name)}</strong><span>对照组</span></div>
              <div class="metric"><strong>${summaries.length}</strong><span>分组数</span></div>
            </div>
            <div class="section-title">汇总与检验</div>
            ${table(["组别", "n", "均值%", "SD", "SEM", "P value", "显著性"], summaryRows)}
            <div class="section-title">原始整理</div>
            ${mode === "cycle"
              ? table(["组别", "复孔", "G0/G1%", "S%", "G2/M%", "Sub-G1%"], rawRows)
              : table(["组别", "复孔", "Q1%", "Q2%", "Q3%", "Q4%", "早凋%", "晚凋%", "总凋亡%"], rawRows)}
          `, "ok");
          flowDrawChart(summaries, metricLabel);
          return true;
        } catch (error) {
          flowLastCsv = "";
          $("flow-download").disabled = true;
          $("flow-chart-box").style.display = "none";
          setResult("flow-result", `<p class="result-title">流式统计失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
          return false;
        }
      }

      function fillFlowExample() {
        if ($("flow-mode").value === "cycle") {
          $("flow-control-group").value = "Control";
          $("flow-data").value = "Control, R1, 60.2, 24.1, 15.7, 2.0\nControl, R2, 61.0, 23.8, 15.2, 1.8\nControl, R3, 59.6, 24.5, 15.9, 2.1\nTreat_1, R1, 48.5, 32.0, 19.5, 4.2\nTreat_1, R2, 47.8, 32.5, 19.7, 4.5\nTreat_1, R3, 49.0, 31.8, 19.2, 4.0\nTreat_2, R1, 38.2, 39.4, 22.4, 8.1\nTreat_2, R2, 37.5, 40.1, 22.4, 8.4\nTreat_2, R3, 38.8, 39.0, 22.2, 7.8";
          $("flow-metric").value = "s";
        } else {
          $("flow-control-group").value = "Control";
          $("flow-early-quadrant").value = "q4";
          $("flow-late-quadrant").value = "q2";
          $("flow-data").value = "Control, R1, 2.1, 3.4, 90.2, 4.3\nControl, R2, 2.4, 3.1, 90.0, 4.5\nControl, R3, 2.0, 3.6, 89.8, 4.6\nTreat_1, R1, 3.2, 9.8, 77.5, 9.5\nTreat_1, R2, 3.6, 10.4, 76.8, 9.2\nTreat_1, R3, 3.3, 9.9, 77.2, 9.6\nTreat_2, R1, 4.5, 18.2, 61.0, 16.3\nTreat_2, R2, 4.2, 17.5, 62.4, 15.9\nTreat_2, R3, 4.7, 18.8, 60.5, 16.0";
          $("flow-metric").value = "total";
        }
        calculateFlow();
      }

      function downloadFlowCsv() {
        downloadCsv("flow_cytometry_prism.csv", flowLastCsv);
      }

      function vaPlateRoleLabel(role) {
        return {
          blank: "空白",
          control: "对照",
          sample: "样本",
          standard: "标准",
          ignore: "忽略"
        }[role] || "";
      }

      function vaPlateEmptyWell(well) {
        return { well, value: NaN, role: "", group: "", dilution: NaN, standardConc: NaN, ic50Conc: NaN };
      }

      function vaPlateEnsureWells() {
        qmeAllWellKeys().forEach((well) => {
          if (!vaPlateWells.has(well)) vaPlateWells.set(well, vaPlateEmptyWell(well));
        });
      }

      function vaPlateWellValue(well) {
        return vaPlateWells.get(well)?.value;
      }

      function vaPlateRender() {
        const grid = $("va-plate-grid");
        if (!grid) return;
        vaPlateEnsureWells();
        const parts = [`<div class="plate-label"></div>`];
        for (let col = 1; col <= 12; col += 1) parts.push(`<div class="plate-label">${col}</div>`);
        for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
          const rowLetter = String.fromCharCode(65 + rowIndex);
          parts.push(`<div class="plate-label">${rowLetter}</div>`);
          for (let col = 1; col <= 12; col += 1) {
            const well = `${rowLetter}${col}`;
            const entry = vaPlateWells.get(well) || vaPlateEmptyWell(well);
            const classes = ["plate-cell"];
            if (!isFinite(entry.value)) classes.push("empty");
            if (entry.role) classes.push(entry.role);
            if (vaPlateSelectedWells.has(well)) classes.push("active");
            const doseText = isFinite(entry.ic50Conc) && (entry.role === "sample" || entry.role === "control") ? ` · ${fmt(entry.ic50Conc, 4)}` : "";
            const roleText = entry.role ? `${vaPlateRoleLabel(entry.role)}${entry.group ? ` · ${entry.group}` : ""}${doseText}` : "未标记";
            const valueText = isFinite(entry.value) ? fmt(entry.value, 3) : "空";
            parts.push(`<button class="${classes.join(" ")}" type="button" data-well="${well}"><strong>${well}</strong><span>${valueText}</span><small>${escapeHtml(roleText)}</small></button>`);
          }
        }
        grid.innerHTML = parts.join("");
        vaPlateUpdateSelection();
      }

      function vaPlateUpdateSelection() {
        const wells = Array.from(vaPlateSelectedWells);
        const status = $("va-plate-selection");
        if (!status) return;
        if (!wells.length) {
          status.className = "notice ok";
          status.textContent = "当前未选择孔位";
          return;
        }
        const values = wells.map((well) => vaPlateWellValue(well)).filter((value) => isFinite(value));
        status.className = "notice ok";
        status.textContent = `已选择 ${wells.length} 个孔：${wells.slice(0, 10).join(", ")}${wells.length > 10 ? "..." : ""}；有效读数 ${values.length} 个。`;
        const first = vaPlateWells.get(wells[0]);
        if (first) {
          if (first.role) $("va-plate-role").value = first.role;
          if (first.group) $("va-plate-group").value = first.group;
          if (isFinite(first.dilution)) $("va-plate-dilution").value = fmt(first.dilution, 4);
          if (isFinite(first.standardConc)) $("va-plate-standard").value = fmt(first.standardConc, 4);
          if (isFinite(first.ic50Conc)) $("va-plate-ic50-conc").value = fmt(first.ic50Conc, 4);
        }
      }

      function vaPlateSelectWell(well, additive) {
        if (!additive) vaPlateSelectedWells.clear();
        if (vaPlateSelectedWells.has(well) && additive) vaPlateSelectedWells.delete(well);
        else vaPlateSelectedWells.add(well);
        vaPlateRender();
      }

      function vaPlateNumbersFromLine(line) {
        const normalized = String(line || "")
          .replace(/[Oo](?=[\.,]?\d)/g, "0")
          .replace(/(?<=\d)[Oo]/g, "0")
          .replace(/\b([0-9])\s+(\d{3})\b/g, "$1.$2")
          .replace(/\b([0-9])[\.,]\s+(\d{2,3})\b/g, "$1.$2");
        return (normalized.match(/-?(?:\d+[\.,]\d+|\.\d+)/g) || [])
          .map((value) => parseFloat(value.replace(",", ".").replace(/^\./, "0.")))
          .filter((value) => isFinite(value));
      }

      function vaPlateParseText(text) {
        const values = new Map();
        const parsedRows = [];
        splitLines(text).forEach((line) => {
          const rowMatch = line.match(/^\s*(?:\d+)?\s*([A-Ha-h])(?:\b|\d)?/);
          const nums = vaPlateNumbersFromLine(line);
          if (rowMatch && nums.length >= 8) {
            parsedRows.push({ row: rowMatch[1].toUpperCase(), nums: nums.slice(0, 12) });
          } else if (nums.length >= 10) {
            parsedRows.push({ row: "", nums: nums.slice(0, 12) });
          }
        });
        const usedRows = new Set();
        parsedRows.forEach((entry) => {
          if (!entry.row || usedRows.has(entry.row)) return;
          usedRows.add(entry.row);
          entry.nums.forEach((value, index) => values.set(`${entry.row}${index + 1}`, value));
        });
        const missingRows = "ABCDEFGH".split("").filter((row) => !usedRows.has(row));
        parsedRows.filter((entry) => !entry.row).slice(0, missingRows.length).forEach((entry, index) => {
          const row = missingRows[index];
          usedRows.add(row);
          entry.nums.forEach((value, colIndex) => values.set(`${row}${colIndex + 1}`, value));
        });
        return values;
      }

      function vaPlateParseToGrid() {
        const values = vaPlateParseText($("va-plate-text").value);
        if (!values.size) {
          setResult("va-plate-status", "<strong>没有解析到 96 孔板读数。</strong> 解析器只接收 A-H 行，或连续 8 行且每行约 12 个小数的孔板表格数据；日期、450nm、按钮文字会被忽略。", "danger");
          return false;
        }
        vaPlateEnsureWells();
        values.forEach((value, well) => {
          const prev = vaPlateWells.get(well) || vaPlateEmptyWell(well);
          vaPlateWells.set(well, { ...prev, value });
        });
        vaPlateRender();
        setResult("va-plate-status", `<strong>已解析 ${values.size} 个孔位。</strong> 只保留孔板 A1-H12 数据；现在可以多选孔位并标记为空白、对照、实验组、BCA 标准品或样本。`, "ok");
        return true;
      }

      function vaPlateCropRect(width, height) {
        return {
          x: Math.round(width * 0.255),
          y: Math.round(height * 0.285),
          w: Math.round(width * 0.545),
          h: Math.round(height * 0.445)
        };
      }

      function vaCanvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片预处理失败。")), "image/png");
        });
      }

      async function vaPlateScanCanvas(file) {
        const bitmap = await createImageBitmap(file);
        const crop = vaPlateCropRect(bitmap.width, bitmap.height);
        const scale = Math.max(1.8, Math.min(3, 1900 / crop.w));
        const margin = 18;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(crop.w * scale) + margin * 2;
        canvas.height = Math.round(crop.h * scale) + margin * 2;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, margin, margin, canvas.width - margin * 2, canvas.height - margin * 2);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < data.data.length; i += 4) {
          const gray = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
          const scanned = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 142));
          data.data[i] = scanned;
          data.data[i + 1] = scanned;
          data.data[i + 2] = scanned;
        }
        ctx.putImageData(data, 0, 0);
        return canvas;
      }

      async function vaPlatePreparedOcrBlob(file) {
        return vaCanvasToBlob(await vaPlateScanCanvas(file));
      }

      async function vaPlateShowScanPreview() {
        const file = $("va-plate-image").files?.[0];
        if (!file) {
          setResult("va-plate-status", "<strong>请先上传照片。</strong>", "warn");
          return null;
        }
        try {
          const blob = await vaPlatePreparedOcrBlob(file);
          if (vaPlateScanUrl) URL.revokeObjectURL(vaPlateScanUrl);
          vaPlateScanUrl = URL.createObjectURL(blob);
          $("va-plate-preview").innerHTML = `<img alt="读板区域扫描增强预览" src="${vaPlateScanUrl}">`;
          setResult("va-plate-status", "<strong>已生成扫描增强预览。</strong> OCR 将只读取这块孔板数据区域。", "ok");
          return blob;
        } catch (error) {
          setResult("va-plate-status", `<strong>扫描增强失败：</strong>${escapeHtml(error.message)}`, "danger");
          return null;
        }
      }

      async function vaPlateTryOcr() {
        const file = $("va-plate-image").files?.[0];
        if (!file) {
          setResult("va-plate-status", "<strong>请先上传照片。</strong>", "warn");
          return false;
        }
        if (!("TextDetector" in window)) {
          return vaPlateTryTesseractOcr(file);
        }
        try {
          const blob = await vaPlatePreparedOcrBlob(file);
          const bitmap = await createImageBitmap(blob);
          const detector = new window.TextDetector();
          const blocks = await detector.detect(bitmap);
          const text = blocks.map((block) => block.rawValue || "").filter(Boolean).join("\n");
          $("va-plate-text").value = text;
          const parsedCount = vaPlateParseText(text).size;
          if (parsedCount >= 60) {
            setResult("va-plate-status", `<strong>原生 OCR 已识别到 ${parsedCount} 个孔位。</strong> 请核对文本后解析为孔板。`, "ok");
            vaPlateParseToGrid();
            return true;
          }
          setResult("va-plate-status", "<strong>原生 OCR 没有读出孔板表格。</strong> 正在切换到内置离线 OCR。", "warn");
          return vaPlateTryTesseractOcr(file);
        } catch (error) {
          setResult("va-plate-status", `<strong>原生 OCR 失败：</strong>${escapeHtml(error.message)}。正在切换到内置离线 OCR。`, "warn");
          return vaPlateTryTesseractOcr(file);
        }
      }

      function vaLoadScript(src) {
        return new Promise((resolve, reject) => {
          if (document.querySelector(`script[data-local-src="${src}"]`)) {
            resolve();
            return;
          }
          const script = document.createElement("script");
          script.src = src;
          script.dataset.localSrc = src;
          script.onload = resolve;
          script.onerror = () => reject(new Error(`无法加载 ${src}`));
          document.head.appendChild(script);
        });
      }

      async function vaEnsureTesseractWorker() {
        if (vaTesseractWorker) return vaTesseractWorker;
        if (!vaTesseractPromise) {
          vaTesseractPromise = (async () => {
            setResult("va-plate-status", "<strong>正在加载内置离线 OCR...</strong> 第一次会稍慢，所有文件都来自当前网站本地资源。", "ok");
            await vaLoadScript("./ocr/tesseract.min.js");
            if (!window.Tesseract?.createWorker) throw new Error("内置 OCR 引擎没有加载成功。");
            const worker = await window.Tesseract.createWorker("eng", 1, {
              workerPath: "./ocr/worker.min.js",
              corePath: "./ocr/tesseract-core-lstm.wasm.js",
              langPath: "./ocr",
              gzip: true,
              logger: (message) => {
                if (message.status) {
                  const pct = isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : "";
                  setResult("va-plate-status", `<strong>内置离线 OCR：</strong>${escapeHtml(message.status)}${pct}`, "ok");
                }
              }
            });
            await worker.setParameters({
              tessedit_char_whitelist: "ABCDEFGHabcdefgh0123456789. ",
              preserve_interword_spaces: "1",
              tessedit_pageseg_mode: window.Tesseract.PSM?.SINGLE_BLOCK || "6"
            });
            vaTesseractWorker = worker;
            return worker;
          })();
        }
        return vaTesseractPromise;
      }

      async function vaPlateTryTesseractOcr(file) {
        try {
          const worker = await vaEnsureTesseractWorker();
          setResult("va-plate-status", "<strong>正在用内置离线 OCR 识别孔板区域...</strong> 屏幕照片会受反光、倾斜和焦点影响，识别后请核对。", "ok");
          const canvas = await vaPlateScanCanvas(file);
          const { data } = await worker.recognize(canvas);
          const text = data?.text || "";
          $("va-plate-text").value = text;
          if (text.trim()) {
            setResult("va-plate-status", "<strong>内置离线 OCR 完成。</strong> 请核对右侧文本；如果 A-H 行错乱，可以手动修正后再解析。", "ok");
            vaPlateParseToGrid();
            return true;
          }
          setResult("va-plate-status", "<strong>内置离线 OCR 没有识别到有效文本。</strong> 可以换一张更清晰、正对屏幕的照片，或粘贴手机 OCR 结果。", "warn");
          return false;
        } catch (error) {
          setResult("va-plate-status", `<strong>内置离线 OCR 失败：</strong>${escapeHtml(error.message)}。仍可用手机/微信/系统相册 OCR 后粘贴文本。`, "warn");
          return false;
        }
      }

      function vaPlateHandleImage() {
        const file = $("va-plate-image").files?.[0];
        if (vaPlateImageUrl) URL.revokeObjectURL(vaPlateImageUrl);
        if (vaPlateScanUrl) {
          URL.revokeObjectURL(vaPlateScanUrl);
          vaPlateScanUrl = "";
        }
        if (!file) {
          vaPlateImageUrl = "";
          $("va-plate-preview").textContent = "上传照片后在这里预览。网页会先尝试浏览器原生 OCR，不支持时改用内置离线 OCR。";
          return;
        }
        vaPlateImageUrl = URL.createObjectURL(file);
        $("va-plate-preview").innerHTML = `<img alt="读板仪照片预览" src="${vaPlateImageUrl}">`;
        setResult("va-plate-status", "<strong>照片已载入。</strong> 可以尝试本地识别；如果识别不稳定，建议粘贴手机 OCR 文本或仪器导出文本。", "ok");
      }

      function vaPlateAssignSelected() {
        const wells = Array.from(vaPlateSelectedWells);
        if (!wells.length) {
          setResult("va-plate-status", "<strong>请先选择孔位。</strong>", "warn");
          return false;
        }
        const role = $("va-plate-role").value;
        const groupInput = $("va-plate-group").value.trim();
        const dilution = parseFloat($("va-plate-dilution").value);
        const standardConc = parseFloat($("va-plate-standard").value);
        const ic50Conc = parseFloat($("va-plate-ic50-conc").value);
        const group = role === "blank" ? "Blank" : role === "control" ? (groupInput || "Control") : groupInput;
        wells.forEach((well) => {
          const prev = vaPlateWells.get(well) || vaPlateEmptyWell(well);
          vaPlateWells.set(well, {
            ...prev,
            role,
            group: role === "ignore" ? "" : (group || role),
            dilution: isFinite(dilution) ? dilution : prev.dilution,
            standardConc: isFinite(standardConc) ? standardConc : prev.standardConc,
            ic50Conc: isFinite(ic50Conc) ? ic50Conc : (role === "control" ? 0 : prev.ic50Conc)
          });
        });
        vaPlateRender();
        setResult("va-plate-status", `<strong>已标记 ${wells.length} 个孔为 ${escapeHtml(vaPlateRoleLabel(role))}。</strong>`, "ok");
        return true;
      }

      function vaPlateCollectByRole() {
        const byRole = { blank: [], control: new Map(), sample: new Map(), standard: new Map() };
        vaPlateWells.forEach((entry) => {
          if (!isFinite(entry.value) || entry.role === "ignore") return;
          if (entry.role === "blank") byRole.blank.push(entry.value);
          if (entry.role === "control" || entry.role === "sample") {
            const map = entry.role === "control" ? byRole.control : byRole.sample;
            const key = entry.group || (entry.role === "control" ? "Control" : entry.well);
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(entry);
          }
          if (entry.role === "standard" && isFinite(entry.standardConc)) {
            const key = String(entry.standardConc);
            if (!byRole.standard.has(key)) byRole.standard.set(key, []);
            byRole.standard.get(key).push(entry);
          }
        });
        return byRole;
      }

      function vaPlateRowsFromMap(map, includeDilution = false) {
        return Array.from(map.entries()).map(([name, entries]) => {
          const values = entries.map((entry) => entry.value);
          if (includeDilution) {
            const dilution = entries.find((entry) => isFinite(entry.dilution))?.dilution || 1;
            return `${name}, ${fmtData(dilution, 4)}, ${values.map((value) => fmtData(value, 4)).join(", ")}`;
          }
          return `${name}, ${values.map((value) => fmtData(value, 4)).join(", ")}`;
        });
      }

      function vaPlateToViability() {
        const data = vaPlateCollectByRole();
        const lines = [];
        if (data.blank.length) lines.push(`Blank, ${data.blank.map((value) => fmtData(value, 4)).join(", ")}`);
        lines.push(...vaPlateRowsFromMap(data.control));
        lines.push(...vaPlateRowsFromMap(data.sample));
        if (!lines.length || (!data.control.size && !data.sample.size)) {
          setResult("va-plate-status", "<strong>没有可生成的活性分析组。</strong> 请至少标记一个对照组或实验组。", "warn");
          return false;
        }
        $("va-method").value = "viability";
        $("va-data").value = lines.join("\n");
        $("va-blank-group").value = data.blank.length ? "Blank" : "";
        $("va-control-group").value = data.control.keys().next().value || "";
        calculateViability();
        setResult("va-plate-status", "<strong>已生成到 CCK8 / MTT 相对存活率分析。</strong>", "ok");
        return true;
      }

      function vaPlateToIc50() {
        const data = vaPlateCollectByRole();
        const seriesMap = new Map();
        let missingDose = 0;

        data.sample.forEach((entries, group) => {
          const series = group || "Drug_1";
          if (!seriesMap.has(series)) seriesMap.set(series, new Map());
          const byConc = seriesMap.get(series);
          entries.forEach((entry) => {
            if (!isFinite(entry.ic50Conc)) {
              missingDose += 1;
              return;
            }
            if (!byConc.has(entry.ic50Conc)) byConc.set(entry.ic50Conc, []);
            byConc.get(entry.ic50Conc).push(entry.value);
          });
        });

        if (!seriesMap.size) {
          setResult("va-plate-status", "<strong>没有可生成 IC50 的样本孔。</strong> 请把药物处理孔标记为“实验组/样本”，并填写 IC50 药物浓度。", "warn");
          return false;
        }

        const controlGroups = Array.from(data.control.entries());
        const singleControl = controlGroups.length === 1 ? controlGroups[0][1] : null;
        const sharedControl = data.control.get("Control") || singleControl;
        const lines = [];

        seriesMap.forEach((byConc, series) => {
          const matchedControl = data.control.get(series) || sharedControl || [];
          const controlValues = matchedControl.map((entry) => entry.value).filter((value) => isFinite(value));
          if (controlValues.length && !byConc.has(0)) {
            lines.push(`${series}, 0, ${controlValues.map((value) => fmtData(value, 4)).join(", ")}`);
          }
          Array.from(byConc.entries())
            .sort((a, b) => a[0] - b[0])
            .forEach(([conc, values]) => {
              if (!values.length) return;
              lines.push(`${series}, ${fmtData(conc, 6)}, ${values.map((value) => fmtData(value, 4)).join(", ")}`);
            });
        });

        if (!lines.length) {
          setResult("va-plate-status", "<strong>IC50 数据为空。</strong> 请检查是否填写了药物浓度，并且读数已经解析到孔板。", "warn");
          return false;
        }

        $("ic-input-mode").value = "raw";
        $("ic-control-conc").value = "0";
        $("ic-blank").value = data.blank.length ? data.blank.map((value) => fmtData(value, 4)).join(", ") : "";
        $("ic-data").value = lines.join("\n");
        activateTab("ic50", true);
        calculateIc50();
        const note = missingDose ? ` 有 ${missingDose} 个样本孔未填写浓度，已跳过。` : "";
        setResult("va-plate-status", `<strong>已生成到 IC50 药敏曲线。</strong> 空白、0 浓度对照和各浓度复孔已自动整理。${note}`, missingDose ? "warn" : "ok");
        return true;
      }

      function vaPlateToElisa() {
        const data = vaPlateCollectByRole();
        const standardLines = Array.from(data.standard.entries())
          .map(([conc, entries]) => ({ conc: parseFloat(conc), values: entries.map((entry) => entry.value) }))
          .filter((row) => isFinite(row.conc) && row.values.length)
          .sort((a, b) => a.conc - b.conc)
          .map((row) => `${fmtData(row.conc, 6)}, ${row.values.map((value) => fmtData(value, 4)).join(", ")}`);
        const sampleLines = vaPlateRowsFromMap(data.sample, true).concat(vaPlateRowsFromMap(data.control, true));
        if (data.blank.length) $("elisa-blank").value = data.blank.map((value) => fmtData(value, 4)).join(", ");
        if (standardLines.length) $("elisa-standards").value = standardLines.join("\n");
        if (sampleLines.length) $("elisa-samples").value = sampleLines.join("\n");
        if (standardLines.length < 2 || !sampleLines.length) {
          setResult("va-plate-status", "<strong>没有足够数据生成 ELISA。</strong> 请至少标记 2 个标准品浓度和 1 个样本组；标准品孔需要填写 BCA / ELISA 标准浓度。", "warn");
          return false;
        }
        activateTab("elisa", true);
        calculateElisa();
        setResult("va-plate-status", `<strong>已生成到 ELISA。</strong> 已整理 ${standardLines.length} 个标准品浓度和 ${sampleLines.length} 个样本组。`, "ok");
        return true;
      }

      function vaLinearRegression(points) {
        const clean = points.filter((point) => isFinite(point.x) && isFinite(point.y));
        const n = clean.length;
        if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
        const sx = clean.reduce((sum, point) => sum + point.x, 0);
        const sy = clean.reduce((sum, point) => sum + point.y, 0);
        const sxx = clean.reduce((sum, point) => sum + point.x * point.x, 0);
        const sxy = clean.reduce((sum, point) => sum + point.x * point.y, 0);
        const denom = n * sxx - sx * sx;
        if (Math.abs(denom) < 1e-12) return { slope: NaN, intercept: NaN, r2: NaN };
        const slope = (n * sxy - sx * sy) / denom;
        const intercept = (sy - slope * sx) / n;
        const yMean = sy / n;
        const ssTot = clean.reduce((sum, point) => sum + Math.pow(point.y - yMean, 2), 0);
        const ssRes = clean.reduce((sum, point) => sum + Math.pow(point.y - (slope * point.x + intercept), 2), 0);
        return { slope, intercept, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot };
      }

      function vaPlateToBca() {
        const data = vaPlateCollectByRole();
        const sampleLines = vaPlateRowsFromMap(data.sample, true).concat(vaPlateRowsFromMap(data.control, true));
        if (data.blank.length) $("bca-blanks").value = data.blank.map((value) => fmtData(value, 4)).join(", ");
        if (sampleLines.length) $("bca-samples").value = sampleLines.join("\n");
        const blankMean = data.blank.length ? mean(data.blank) : 0;
        const stdPoints = Array.from(data.standard.entries()).map(([conc, entries]) => ({
          x: parseFloat(conc),
          y: mean(entries.map((entry) => entry.value)) - blankMean
        })).filter((point) => isFinite(point.x) && isFinite(point.y));
        const fit = vaLinearRegression(stdPoints);
        if (isFinite(fit.slope) && fit.slope !== 0 && isFinite(fit.intercept)) {
          $("bca-slope").value = fmt(fit.slope, 6);
          $("bca-intercept").value = fmt(fit.intercept, 6);
        }
        if (!sampleLines.length) {
          setResult("va-plate-status", "<strong>没有可生成的 BCA 样本。</strong> 请把样本孔标记为“实验组/样本”，标准品孔标记为“BCA 标准品”。", "warn");
          return false;
        }
        activateTab("bca", true);
        calculateBcaAll();
        setResult("va-plate-status", `<strong>已生成到 BCA/WB。</strong>${isFinite(fit.r2) ? ` 标准曲线 R²=${fmt(fit.r2, 4)}。` : " 未标记足够标准品，沿用当前标准曲线。"}`, isFinite(fit.r2) && fit.r2 < 0.98 ? "warn" : "ok");
        return true;
      }

      function vaPlateClear() {
        vaPlateWells.clear();
        vaPlateSelectedWells.clear();
        $("va-plate-text").value = "";
        vaPlateRender();
        setResult("va-plate-status", "<strong>读板数据已清空。</strong>", "ok");
      }

      function calculateRT(samples) {
        const targetRnaNg = getNumber("rt-target-rna");
        const rtTotalVol = getNumber("rt-total-vol");
        const gdnaVol = getNumber("rt-gdna-vol");
        const rtMixVol = getNumber("rt-mix-vol");
        const rtOtherVol = getNumber("rt-other-vol");
        const invalid = !isFinite(targetRnaNg) || targetRnaNg <= 0 ||
          !isFinite(rtTotalVol) || rtTotalVol <= 0 ||
          !isFinite(gdnaVol) || gdnaVol < 0 ||
          !isFinite(rtMixVol) || rtMixVol < 0 ||
          !isFinite(rtOtherVol) || rtOtherVol < 0 ||
          samples.length === 0;

        if (invalid) {
          setResult("rt-result", "<p class=\"result-title\">RT 参数或样本信息不完整。</p>", "danger");
          return false;
        }

        const fixedVol = gdnaVol + rtMixVol + rtOtherVol;
        let hasWarn = false;
        const rows = samples.map((sample) => {
          let status = "可配";
          let rnaVol = NaN;
          let waterVol = NaN;

          if (!isFinite(sample.conc) || sample.conc <= 0) {
            status = "RNA浓度无效";
            hasWarn = true;
          } else {
            rnaVol = targetRnaNg / sample.conc;
            waterVol = rtTotalVol - fixedVol - rnaVol;
            if (waterVol < 0) {
              status = "RNA体积过大，需要降低逆转录RNA量或浓缩RNA。";
              hasWarn = true;
            }
          }

          return [
            escapeHtml(sample.name),
            fmtFixed(sample.conc, 3),
            fmt(targetRnaNg, 1),
            fmtFixed(rnaVol, 3),
            fmt(gdnaVol, 3),
            fmt(rtMixVol, 3),
            fmt(rtOtherVol, 3),
            fmtFixed(waterVol, 3),
            fmt(rtTotalVol, 3),
            escapeHtml(status)
          ];
        });

        const header = `
          <p class="result-title">RT 逆转录配液结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(targetRnaNg, 1)} ng</strong><span>每个样本目标 RNA 量</span></div>
            <div class="metric"><strong>${fmt(rtTotalVol, 3)} µL</strong><span>RT 总体系</span></div>
            <div class="metric"><strong>${fmt(fixedVol, 3)} µL</strong><span>固定组分合计</span></div>
          </div>
        `;

        setResult(
          "rt-result",
          header + table(["样本", "RNA浓度 ng/µL", "目标RNA ng", "RNA体积 µL", "5×gDNA µL", "4×RT试剂 µL", "其他固定组分 µL", "无酶水 µL", "最终体系 µL", "判断"], rows),
          hasWarn ? "warn" : "ok"
        );
        return true;
      }

      function calculateQPCR(samples, genes) {
        const qpcrTotalVol = getNumber("qpcr-total-vol");
        const replicates = parseInt($("qpcr-replicates").value, 10);
        const extraReactions = parseInt($("qpcr-extra").value, 10);
        const qpcrMixVol = getNumber("qpcr-mix-vol");
        const forwardPrimerVol = getNumber("qpcr-forward-vol");
        const reversePrimerVol = getNumber("qpcr-reverse-vol");
        const cdnaVol = getNumber("qpcr-cdna-vol");
        const qpcrOtherVol = getNumber("qpcr-other-vol");

        const invalid = samples.length === 0 || genes.length === 0 ||
          !isFinite(qpcrTotalVol) || qpcrTotalVol <= 0 ||
          !Number.isInteger(replicates) || replicates <= 0 ||
          !Number.isInteger(extraReactions) || extraReactions < 0 ||
          !isFinite(qpcrMixVol) || qpcrMixVol < 0 ||
          !isFinite(forwardPrimerVol) || forwardPrimerVol < 0 ||
          !isFinite(reversePrimerVol) || reversePrimerVol < 0 ||
          !isFinite(cdnaVol) || cdnaVol < 0 ||
          !isFinite(qpcrOtherVol) || qpcrOtherVol < 0;

        if (invalid) {
          setResult("qpcr-result", "<p class=\"result-title\">qPCR 参数、样本或基因信息不完整。</p>", "danger");
          return false;
        }

        const perWellWater = qpcrTotalVol - qpcrMixVol - forwardPrimerVol - reversePrimerVol - cdnaVol - qpcrOtherVol;
        const reactionsPerGroup = replicates + extraReactions;
        const realWells = samples.length * genes.length * replicates;
        const preparedWells = samples.length * genes.length * reactionsPerGroup;

        const totalQpcrMix = qpcrMixVol * preparedWells;
        const totalWater = perWellWater * preparedWells;
        const totalForward = forwardPrimerVol * preparedWells;
        const totalReverse = reversePrimerVol * preparedWells;
        const totalCdna = cdnaVol * preparedWells;
        const totalOther = qpcrOtherVol * preparedWells;
        const hasWarn = perWellWater < 0;

        const totalsRows = [
          ["qPCR Mix", fmt(qpcrMixVol, 3), fmt(totalQpcrMix, 3)],
          ["无酶水", fmt(perWellWater, 3), fmt(totalWater, 3)],
          ["Forward primer", fmt(forwardPrimerVol, 3), fmt(totalForward, 3)],
          ["Reverse primer", fmt(reversePrimerVol, 3), fmt(totalReverse, 3)],
          ["cDNA", fmt(cdnaVol, 3), fmt(totalCdna, 3)],
          ["其他固定组分", fmt(qpcrOtherVol, 3), fmt(totalOther, 3)],
          ["<strong>实际上板孔数</strong>", "", `<strong>${fmtInt(realWells)} 孔</strong>`],
          ["<strong>实际配液总孔数</strong>", "", `<strong>${fmtInt(preparedWells)} 孔</strong>`]
        ];

        const splitRows = [
          [
            "qPCR Mix + 水",
            "qPCR Mix + 无酶水 + 其他固定组分",
            fmt(qpcrMixVol + perWellWater + qpcrOtherVol, 3),
            fmt(totalQpcrMix + totalWater + totalOther, 3),
            "若所有孔 qPCR Mix 和水用量一致，可先配成公共混合液。"
          ],
          [
            "引物 + cDNA",
            "Forward primer + Reverse primer + cDNA",
            fmt(forwardPrimerVol + reversePrimerVol + cdnaVol, 3),
            fmt(totalForward + totalReverse + totalCdna, 3),
            "通常按样本和基因分组。"
          ]
        ];

        const groupRows = [[
          fmtInt(replicates),
          fmtInt(reactionsPerGroup),
          fmt(qpcrMixVol * reactionsPerGroup, 3),
          fmt(perWellWater * reactionsPerGroup, 3),
          fmt(forwardPrimerVol * reactionsPerGroup, 3),
          fmt(reversePrimerVol * reactionsPerGroup, 3),
          fmt(cdnaVol * reactionsPerGroup, 3),
          fmt(qpcrOtherVol * reactionsPerGroup, 3),
          fmt(qpcrTotalVol * reactionsPerGroup, 3)
        ]];

        const listRows = [];
        samples.forEach((sample) => {
          genes.forEach((gene) => {
            listRows.push([escapeHtml(sample.name), escapeHtml(gene), fmtInt(replicates), fmtInt(reactionsPerGroup)]);
          });
        });

        let html = `
          <p class="result-title">qPCR 上机配液结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${samples.length}</strong><span>样本数</span></div>
            <div class="metric"><strong>${genes.length}</strong><span>基因数</span></div>
            <div class="metric"><strong>${fmtInt(realWells)} 孔</strong><span>实际上板孔数</span></div>
            <div class="metric"><strong>${fmtInt(preparedWells)} 孔</strong><span>实际配液总孔数</span></div>
          </div>
        `;

        if (hasWarn) {
          html += "<div class=\"notice danger\"><strong>警告：</strong>每孔各组分体积超过总体系，请检查 qPCR Mix、引物、cDNA 或其他组分体积。</div>";
        }

        html += table(["项目", "每孔 µL", "总量 µL"], totalsRows);
        html += `<div class="section-title">按你的习惯拆分成两类混合液</div>`;
        html += table(["混合液", "组成", "每孔 µL", "总量 µL", "说明"], splitRows);
        html += `<div class="section-title">每个样本 × 每个基因的单组配液量</div>`;
        html += table(["每组实际上板复孔数", "每组实际配液孔数", "qPCR Mix µL", "无酶水 µL", "F primer µL", "R primer µL", "cDNA µL", "其他 µL", "总量 µL"], groupRows);
        html += `<div class="section-title">样本 × 基因分组清单</div>`;
        html += table(["样本", "基因", "上板复孔", "配液孔数"], listRows);

        setResult("qpcr-result", html, hasWarn ? "warn" : "ok");
        return true;
      }

      function calculateQpcrAll() {
        const samples = parseRtSamples($("rt-samples").value);
        const genes = parseGeneLines($("qpcr-genes").value);
        calculateRT(samples);
        calculateQPCR(samples, genes);
      }

      function fillQpcrExample() {
        $("rt-samples").value = "Sample_1, 100\nSample_2, 80";
        $("rt-target-rna").value = "1000";
        $("rt-total-vol").value = "20";
        $("rt-gdna-vol").value = "4";
        $("rt-mix-vol").value = "5";
        $("rt-other-vol").value = "0";
        $("qpcr-genes").value = "GAPDH\nIFNG\nERBB2";
        $("qpcr-total-vol").value = "20";
        $("qpcr-replicates").value = "4";
        $("qpcr-extra").value = "1";
        $("qpcr-mix-vol").value = "10";
        $("qpcr-forward-vol").value = "0.4";
        $("qpcr-reverse-vol").value = "0.4";
        $("qpcr-cdna-vol").value = "2";
        $("qpcr-other-vol").value = "0";
        calculateQpcrAll();
      }

      function masterMixPreparedReactions(realReactions, extraPct, minExtra) {
        return Math.ceil(realReactions * (1 + extraPct / 100)) + minExtra;
      }

      function calculateMasterMix() {
        const samples = parseNameList($("mm-samples").value);
        const targets = parseNameList($("mm-targets").value);
        const totalVol = getNumber("mm-total-vol");
        const mixX = getNumber("mm-mix-x");
        const forwardStock = getNumber("mm-forward-stock");
        const forwardFinal = getNumber("mm-forward-final");
        const reverseStock = getNumber("mm-reverse-stock");
        const reverseFinal = getNumber("mm-reverse-final");
        const templateVol = getNumber("mm-template-vol");
        const otherVol = getNumber("mm-other-vol");
        const replicates = parseInt($("mm-replicates").value, 10);
        const extraPct = getNumber("mm-extra-pct");
        const minExtra = parseInt($("mm-min-extra").value, 10);
        const templateMode = $("mm-template-mode").value;

        const invalid = !samples.length || !targets.length ||
          !isFinite(totalVol) || totalVol <= 0 ||
          !isFinite(mixX) || mixX <= 0 ||
          !isFinite(forwardStock) || forwardStock <= 0 ||
          !isFinite(forwardFinal) || forwardFinal < 0 ||
          !isFinite(reverseStock) || reverseStock <= 0 ||
          !isFinite(reverseFinal) || reverseFinal < 0 ||
          !isFinite(templateVol) || templateVol < 0 ||
          !isFinite(otherVol) || otherVol < 0 ||
          !Number.isInteger(replicates) || replicates <= 0 ||
          !isFinite(extraPct) || extraPct < 0 ||
          !Number.isInteger(minExtra) || minExtra < 0;

        if (invalid) {
          mmLastCsv = "";
          $("mm-download").disabled = true;
          setResult("mm-result", "<p class=\"result-title\">Master Mix 参数不完整，请检查样本、目标、体系体积、引物浓度和复孔设置。</p>", "danger");
          return false;
        }

        const mixVol = totalVol / mixX;
        const forwardVol = forwardFinal * totalVol / forwardStock;
        const reverseVol = reverseFinal * totalVol / reverseStock;
        const waterVol = totalVol - mixVol - forwardVol - reverseVol - templateVol - otherVol;
        const masterPerReaction = templateMode === "separate" ? totalVol - templateVol : totalVol;
        const hasWarn = waterVol < -1e-9;
        const actualWells = samples.length * targets.length * replicates;

        const componentTotals = new Map([
          ["Master Mix", 0],
          ["无酶水", 0],
          ["Forward primer", 0],
          ["Reverse primer", 0],
          ["模板 / cDNA", 0],
          ["其他固定组分", 0]
        ]);
        const addTotal = (name, value) => componentTotals.set(name, componentTotals.get(name) + value);

        const groupRows = [];
        if (templateMode === "separate") {
          targets.forEach((target) => {
            const real = samples.length * replicates;
            const prepared = masterMixPreparedReactions(real, extraPct, minExtra);
            addTotal("Master Mix", mixVol * prepared);
            addTotal("无酶水", waterVol * prepared);
            addTotal("Forward primer", forwardVol * prepared);
            addTotal("Reverse primer", reverseVol * prepared);
            addTotal("其他固定组分", otherVol * prepared);
            addTotal("模板 / cDNA", templateVol * real);
            groupRows.push([
              escapeHtml(target),
              "按目标引物配公共 Master Mix",
              fmtInt(real),
              fmtInt(prepared),
              fmt(mixVol * prepared, 3),
              fmt(waterVol * prepared, 3),
              fmt(forwardVol * prepared, 3),
              fmt(reverseVol * prepared, 3),
              fmt(otherVol * prepared, 3),
              "不加入",
              fmt(masterPerReaction * prepared, 3)
            ]);
          });
        } else {
          samples.forEach((sample) => {
            targets.forEach((target) => {
              const real = replicates;
              const prepared = masterMixPreparedReactions(real, extraPct, minExtra);
              addTotal("Master Mix", mixVol * prepared);
              addTotal("无酶水", waterVol * prepared);
              addTotal("Forward primer", forwardVol * prepared);
              addTotal("Reverse primer", reverseVol * prepared);
              addTotal("模板 / cDNA", templateVol * prepared);
              addTotal("其他固定组分", otherVol * prepared);
              groupRows.push([
                `${escapeHtml(sample)} / ${escapeHtml(target)}`,
                "按样本 × 目标配完整体系",
                fmtInt(real),
                fmtInt(prepared),
                fmt(mixVol * prepared, 3),
                fmt(waterVol * prepared, 3),
                fmt(forwardVol * prepared, 3),
                fmt(reverseVol * prepared, 3),
                fmt(otherVol * prepared, 3),
                fmt(templateVol * prepared, 3),
                fmt(masterPerReaction * prepared, 3)
              ]);
            });
          });
        }

        const preparedWells = groupRows.reduce((sum, row) => sum + parseFloat(String(row[3]).replace(/,/g, "")), 0);
        const perReactionRows = [
          ["Master Mix", fmt(mixVol, 3)],
          ["无酶水", fmt(waterVol, 3)],
          ["Forward primer", fmt(forwardVol, 3)],
          ["Reverse primer", fmt(reverseVol, 3)],
          ["模板 / cDNA", fmt(templateVol, 3)],
          ["其他固定组分", fmt(otherVol, 3)],
          ["总体系", fmt(totalVol, 3)]
        ];
        const totalRows = Array.from(componentTotals.entries()).map(([name, value]) => [name, fmt(value, 3)]);

        const csvRows = [
          ["PCR/qPCR Master Mix 增强版"],
          ["样本数", samples.length, "目标数", targets.length, "实际上板反应数", actualWells, "配液反应数", preparedWells],
          [],
          ["单孔体系", "每孔 µL"],
          ...perReactionRows,
          [],
          ["总量", "µL"],
          ...totalRows,
          [],
          ["分组", "方式", "实际反应数", "配液反应数", "Master Mix µL", "无酶水 µL", "F primer µL", "R primer µL", "其他 µL", "模板 µL", "分组总体积 µL"],
          ...groupRows.map((row) => row.map((cell) => String(cell).replace(/<[^>]*>/g, "")))
        ];
        mmLastCsv = rowsToCsv(csvRows);
        $("mm-download").disabled = false;

        let html = `
          <p class="result-title">PCR / qPCR Master Mix 配液结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmtInt(samples.length)}</strong><span>样本数</span></div>
            <div class="metric"><strong>${fmtInt(targets.length)}</strong><span>目标 / 引物对数</span></div>
            <div class="metric"><strong>${fmtInt(actualWells)} 孔</strong><span>实际上板反应数</span></div>
            <div class="metric"><strong>${fmtInt(preparedWells)} 反应</strong><span>实际配液反应数</span></div>
          </div>
        `;

        if (hasWarn) {
          html += `<div class="notice danger"><strong>警告：</strong>单孔各组分体积超过总体系，当前无酶水为 ${fmt(waterVol, 3)} µL，请检查 Mix、引物、模板或其他组分。</div>`;
        } else {
          html += `<div class="notice ok"><strong>建议记录：</strong>${templateMode === "separate" ? "模板单独加；按每个目标引物对配公共 Master Mix。" : "模板混入；按样本 × 目标单独配完整体系。"} 每孔水 ${fmt(waterVol, 3)} µL。</div>`;
        }

        html += `<div class="section-title">单孔体系</div>`;
        html += table(["组分", "每孔 µL"], perReactionRows);
        html += `<div class="section-title">总量汇总</div>`;
        html += table(["组分", "总量 µL"], totalRows);
        html += `<div class="section-title">分组配液表</div>`;
        html += table(["分组", "方式", "实际反应数", "配液反应数", "Mix µL", "水 µL", "F µL", "R µL", "其他 µL", "模板 µL", "总量 µL"], groupRows);
        setResult("mm-result", html, hasWarn ? "danger" : "ok");
        return !hasWarn;
      }

      function fillMasterMixExample() {
        $("mm-samples").value = "Control\nTreat_1\nTreat_2";
        $("mm-targets").value = "GeneA\nGeneB\nACTB";
        $("mm-total-vol").value = "20";
        $("mm-mix-x").value = "2";
        $("mm-forward-stock").value = "10";
        $("mm-forward-final").value = "0.2";
        $("mm-reverse-stock").value = "10";
        $("mm-reverse-final").value = "0.2";
        $("mm-template-vol").value = "2";
        $("mm-other-vol").value = "0";
        $("mm-replicates").value = "3";
        $("mm-extra-pct").value = "10";
        $("mm-min-extra").value = "1";
        $("mm-template-mode").value = "separate";
        calculateMasterMix();
      }

      function downloadMasterMixCsv() {
        downloadCsv("pcr_qpcr_master_mix.csv", mmLastCsv);
      }

      function qpaNorm(value) {
        return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
      }

      function qpaMean(values) {
        return mean(values.filter((value) => isFinite(value)));
      }

      function qpaSd(values) {
        return sd(values.filter((value) => isFinite(value)));
      }

      function qpaSem(values) {
        const clean = values.filter((value) => isFinite(value));
        return clean.length ? qpaSd(clean) / Math.sqrt(clean.length) : NaN;
      }

      function qpaParseCsvLine(line, delimiter) {
        const out = [];
        let value = "";
        let quoted = false;
        for (let i = 0; i < line.length; i += 1) {
          const ch = line[i];
          if (ch === "\"") {
            if (quoted && line[i + 1] === "\"") {
              value += "\"";
              i += 1;
            } else {
              quoted = !quoted;
            }
          } else if (ch === delimiter && !quoted) {
            out.push(value);
            value = "";
          } else {
            value += ch;
          }
        }
        out.push(value);
        return out.map((cell) => cell.trim());
      }

      function qpaRowsToTsv(rows) {
        return rows.map((row) => row.map((cell) => String(cell ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ")).join("\t")).join("\n");
      }

      function qpaHeaderIndexes(headers) {
        const norm = headers.map(qpaNorm);
        const find = (tester) => norm.findIndex(tester);
        const sample = find((h) => h === "样本名" || h.includes("samplename") || h === "sample" || h === "样本");
        const gene = find((h) => h === "基因名称" || h.includes("targetname") || h === "gene" || h === "target" || h === "基因");
        const ct = find((h) => ["ct", "cт", "cq", "ct值", "cт值"].includes(h));
        const well = find((h) => h === "反应孔位置" || h === "well" || h === "wellposition");
        const amp = find((h) => h === "扩增状态" || h === "amplificationstatus" || h === "ampstatus");
        const tm = find((h) => h === "tm1" || h === "tm");
        const highsd = find((h) => h === "highsd" || h === "高sd");
        const ignored = find((h) => h === "忽略" || h === "omit" || h === "ignore");
        return { sample, gene, ct, well, amp, tm, highsd, ignored };
      }

      function qpaFindHeaderRow(rows) {
        for (let i = 0; i < rows.length; i += 1) {
          const idx = qpaHeaderIndexes(rows[i]);
          if (idx.sample >= 0 && idx.gene >= 0 && idx.ct >= 0) return i;
        }
        return -1;
      }

      function qpaParseTextTableRows(text, includeIgnored) {
        const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
        if (!lines.length) return [];
        const firstUseful = lines.find((line) => line.trim()) || "";
        const delimiter = firstUseful.includes("\t") ? "\t" : (firstUseful.includes(",") ? "," : ";");
        const rows = lines.map((line) => qpaParseCsvLine(line, delimiter));
        const headerRow = qpaFindHeaderRow(rows);
        if (headerRow < 0) {
          throw new Error("没有找到包含“样本名、基因名称、Ct/Cт”的表头。");
        }
        const headers = rows[headerRow];
        const idx = qpaHeaderIndexes(headers);
        return rows.slice(headerRow + 1).map((row, rowIndex) => {
          const ct = parseFloat(row[idx.ct]);
          const ignored = idx.ignored >= 0 ? qpaNorm(row[idx.ignored]) : "";
          return {
            sample: row[idx.sample] || "",
            gene: row[idx.gene] || "",
            ct,
            well: idx.well >= 0 ? row[idx.well] || "" : "",
            amp: idx.amp >= 0 ? row[idx.amp] || "" : "",
            tm: idx.tm >= 0 ? parseFloat(row[idx.tm]) : NaN,
            highsd: idx.highsd >= 0 ? row[idx.highsd] || "" : "",
            ignored,
            rowIndex: rowIndex + headerRow + 2
          };
        }).filter((row) => row.sample && row.gene && isFinite(row.ct) && (includeIgnored || !["true", "yes", "1"].includes(row.ignored)));
      }

      function qpaParseTextTable(text) {
        return qpaParseTextTableRows(text, false);
      }

      function qpaParseTextTableAll(text) {
        return qpaParseTextTableRows(text, true);
      }

      function qpaUniqueNames(rows, key) {
        const seen = new Set();
        return rows.map((row) => String(row[key] || "").trim()).filter((name) => {
          const norm = qpaNorm(name);
          if (!norm || norm === "20" || seen.has(norm)) return false;
          seen.add(norm);
          return true;
        });
      }

      function qpaPickReferenceGene(genes) {
        const priority = ["actin", "actb", "gapdh", "b2m", "hprt1", "rplp0", "18s", "rn18s", "18srna", "tbp"];
        const byNorm = new Map(genes.map((gene) => [qpaNorm(gene), gene]));
        const exact = priority.map((name) => byNorm.get(name)).find(Boolean);
        if (exact) return exact;
        return genes.find((gene) => ["actin", "gapdh", "tubulin"].some((marker) => qpaNorm(gene).includes(marker))) || genes[0] || "";
      }

      function qpaAutoFillGenes(genes) {
        if (!genes.length) return;
        const byNorm = new Map(genes.map((gene) => [qpaNorm(gene), gene]));
        const targetInput = $("qpa-target-gene");
        const refInput = $("qpa-ref-gene");
        const currentTargets = targetInput.value.split(/[,，;；\s]+/).map((x) => x.trim()).filter(Boolean);
        const targetsKnown = currentTargets.length > 0 && currentTargets.every((gene) => byNorm.has(qpaNorm(gene)));
        const refKnown = byNorm.has(qpaNorm(refInput.value));

        if (!refKnown) {
          refInput.value = qpaPickReferenceGene(genes);
        }

        const refNorm = qpaNorm(refInput.value);
        const targetCandidates = genes.filter((gene) => qpaNorm(gene) !== refNorm);
        if (!targetsKnown) {
          targetInput.value = targetCandidates.join(",") || genes.join(",");
        }
      }

      function qpaCurrentSamples() {
        return qpaRefreshSampleOptions.last?.samples || [];
      }

      function qpaDefaultComparisonPlans(samples) {
        const selected = $("qpa-control-sample").value;
        const control = samples.find((sample) => qpaNorm(sample) === qpaNorm(selected)) || samples[0] || "";
        return control ? [{
          control,
          treatments: samples.filter((sample) => qpaNorm(sample) !== qpaNorm(control))
        }] : [];
      }

      function qpaReadCustomBuilderRaw() {
        return Array.from(document.querySelectorAll("#qpa-custom-rows .comparison-row")).map((row) => {
          const control = row.querySelector(".qpa-row-control")?.value || "";
          const treatments = Array.from(row.querySelectorAll(".qpa-treatment:checked")).map((input) => input.value);
          return { control, treatments };
        }).filter((plan) => plan.control || plan.treatments.length);
      }

      function qpaCustomRowHtml(samples, plan, index) {
        const control = samples.find((sample) => qpaNorm(sample) === qpaNorm(plan.control)) || samples[0] || "";
        const treatmentSet = new Set((plan.treatments || []).map(qpaNorm));
        const options = samples.map((sample) => `<option value="${escapeHtml(sample)}"${qpaNorm(sample) === qpaNorm(control) ? " selected" : ""}>${escapeHtml(sample)}</option>`).join("");
        const checks = samples.filter((sample) => qpaNorm(sample) !== qpaNorm(control)).map((sample) => {
          const checked = treatmentSet.has(qpaNorm(sample)) || (!(plan.treatments || []).length && qpaNorm(sample) !== qpaNorm(control));
          return `
            <label class="sample-check">
              <input class="qpa-treatment" type="checkbox" value="${escapeHtml(sample)}"${checked ? " checked" : ""} />
              <span>${escapeHtml(sample)}</span>
            </label>
          `;
        }).join("") || `<div class="help">需要至少两个样本才能选择实验组。</div>`;
        return `
          <div class="comparison-row" data-index="${index}">
            <div>
              <label for="qpa-row-control-${index}">对照</label>
              <select id="qpa-row-control-${index}" class="qpa-row-control">${options}</select>
            </div>
            <div>
              <label>实验组</label>
              <div class="sample-checks">${checks}</div>
            </div>
            <div>
              <label>&nbsp;</label>
              <button class="action secondary small qpa-remove-comparison" type="button">删除</button>
            </div>
          </div>
        `;
      }

      function qpaSyncComparisonsText() {
        const lines = qpaReadCustomBuilderRaw().map((plan) => `${plan.control}: ${plan.treatments.join(", ")}`);
        $("qpa-comparisons").value = lines.join("\n");
      }

      function qpaRenderCustomBuilder(samples, plans) {
        const rows = $("qpa-custom-rows");
        if (!samples.length) {
          rows.innerHTML = `<div class="help">导入或粘贴数据后，会在这里生成样本选择。</div>`;
          $("qpa-comparisons").value = "";
          return;
        }
        const rawPlans = Array.isArray(plans) ? plans : qpaReadCustomBuilderRaw();
        const validPlans = rawPlans.map((plan) => ({
          control: samples.find((sample) => qpaNorm(sample) === qpaNorm(plan.control)) || "",
          treatments: (plan.treatments || []).filter((name) => samples.some((sample) => qpaNorm(sample) === qpaNorm(name)))
        })).filter((plan) => plan.control);
        const finalPlans = validPlans.length ? validPlans : qpaDefaultComparisonPlans(samples);
        rows.innerHTML = finalPlans.map((plan, index) => qpaCustomRowHtml(samples, plan, index)).join("");
        qpaSyncComparisonsText();
      }

      function qpaUpdateCompareModeUi() {
        const custom = $("qpa-compare-mode").value === "custom";
        $("qpa-custom-panel").style.display = custom ? "block" : "none";
        if (custom) qpaRenderCustomBuilder(qpaCurrentSamples());
      }

      function qpaAddComparisonRow() {
        const samples = qpaCurrentSamples();
        const plans = qpaReadCustomBuilderRaw();
        plans.push(qpaDefaultComparisonPlans(samples)[0] || { control: "", treatments: [] });
        qpaRenderCustomBuilder(samples, plans);
      }

      function qpaHandleCustomRowsClick(event) {
        const button = event.target.closest(".qpa-remove-comparison");
        if (!button) return;
        const row = button.closest(".comparison-row");
        const index = parseInt(row?.dataset.index || "-1", 10);
        const samples = qpaCurrentSamples();
        const plans = qpaReadCustomBuilderRaw().filter((_, planIndex) => planIndex !== index);
        qpaRenderCustomBuilder(samples, plans.length ? plans : qpaDefaultComparisonPlans(samples));
      }

      function qpaHandleCustomRowsChange(event) {
        if (event.target.classList.contains("qpa-row-control")) {
          qpaRenderCustomBuilder(qpaCurrentSamples(), qpaReadCustomBuilderRaw());
          return;
        }
        if (event.target.classList.contains("qpa-treatment")) {
          qpaSyncComparisonsText();
        }
      }

      function qpaRefreshSampleOptions() {
        const select = $("qpa-control-sample");
        const previous = select.value;
        try {
          const rows = qpaParseTextTable($("qpa-data").value);
          const samples = qpaUniqueNames(rows, "sample");
          const genes = qpaUniqueNames(rows, "gene");
          qpaRefreshSampleOptions.last = { samples, genes };
          qpaAutoFillGenes(genes);
          if (!samples.length) return [];
          select.innerHTML = samples.map((sample) => `<option value="${escapeHtml(sample)}">${escapeHtml(sample)}</option>`).join("");
          if (samples.includes(previous)) {
            select.value = previous;
          } else if (samples.some((sample) => qpaNorm(sample) === "control")) {
            select.value = samples.find((sample) => qpaNorm(sample) === "control");
          } else {
            select.value = samples[0];
          }
          qpaRenderCustomBuilder(samples);
          return samples;
        } catch (error) {
          qpaRefreshSampleOptions.last = { samples: [], genes: [] };
          qpaRenderCustomBuilder([]);
          return [];
        }
      }

      function qpaScheduleSampleRefresh() {
        clearTimeout(qpaScheduleSampleRefresh.timer);
        qpaScheduleSampleRefresh.timer = setTimeout(qpaRefreshSampleOptions, 180);
      }

      function qpaParseComparisons(samples) {
        const mode = $("qpa-compare-mode").value;
        const byNorm = new Map(samples.map((sample) => [qpaNorm(sample), sample]));
        if (mode !== "custom") {
          const control = byNorm.get(qpaNorm($("qpa-control-sample").value)) || $("qpa-control-sample").value;
          if (!byNorm.has(qpaNorm(control))) throw new Error("请先从样本名列选择一个有效的对照样本。");
          return [{
            label: `${control} vs others`,
            control,
            samples
          }];
        }
        const plans = qpaReadCustomBuilderRaw();
        if (!plans.length) throw new Error("请在自定义比较方案中至少新增一行比较。");
        return plans.map((plan, index) => {
          const control = byNorm.get(qpaNorm(plan.control));
          if (!control) throw new Error(`第 ${index + 1} 行没有选择有效的对照样本。`);
          const treatments = plan.treatments.map((name) => byNorm.get(qpaNorm(name))).filter(Boolean).filter((name) => qpaNorm(name) !== qpaNorm(control));
          const uniqueTreatments = Array.from(new Map(treatments.map((name) => [qpaNorm(name), name])).values());
          if (!uniqueTreatments.length) throw new Error(`第 ${index + 1} 行请至少勾选一个实验组。`);
          return {
            label: `${control} vs ${uniqueTreatments.join(", ")}`,
            control,
            samples: [control, ...uniqueTreatments]
          };
        });
      }

      function qpaLogGamma(z) {
        const coeff = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
        if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - qpaLogGamma(1 - z);
        z -= 1;
        let x = 0.9999999999998099;
        for (let i = 0; i < coeff.length; i += 1) x += coeff[i] / (z + i + 1);
        const t = z + coeff.length - 0.5;
        return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
      }

      function qpaBetaContinuedFraction(a, b, x) {
        const maxIter = 120;
        const eps = 3e-10;
        const fpmin = 1e-30;
        let qab = a + b;
        let qap = a + 1;
        let qam = a - 1;
        let c = 1;
        let d = 1 - qab * x / qap;
        if (Math.abs(d) < fpmin) d = fpmin;
        d = 1 / d;
        let h = d;
        for (let m = 1; m <= maxIter; m += 1) {
          const m2 = 2 * m;
          let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
          d = 1 + aa * d;
          if (Math.abs(d) < fpmin) d = fpmin;
          c = 1 + aa / c;
          if (Math.abs(c) < fpmin) c = fpmin;
          d = 1 / d;
          h *= d * c;
          aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
          d = 1 + aa * d;
          if (Math.abs(d) < fpmin) d = fpmin;
          c = 1 + aa / c;
          if (Math.abs(c) < fpmin) c = fpmin;
          d = 1 / d;
          const del = d * c;
          h *= del;
          if (Math.abs(del - 1) < eps) break;
        }
        return h;
      }

      function qpaRegularizedBeta(x, a, b) {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        const bt = Math.exp(qpaLogGamma(a + b) - qpaLogGamma(a) - qpaLogGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
        if (x < (a + 1) / (a + b + 2)) return bt * qpaBetaContinuedFraction(a, b, x) / a;
        return 1 - bt * qpaBetaContinuedFraction(b, a, 1 - x) / b;
      }

      function qpaTCdf(t, df) {
        if (!isFinite(t) || !isFinite(df) || df <= 0) return NaN;
        const x = df / (df + t * t);
        const ib = qpaRegularizedBeta(x, df / 2, 0.5);
        return t >= 0 ? 1 - ib / 2 : ib / 2;
      }

      function qpaTTest(a, b, mode) {
        const x = a.filter(isFinite);
        const y = b.filter(isFinite);
        if (x.length < 2 || y.length < 2) return { p: NaN, t: NaN, df: NaN };
        const mx = qpaMean(x);
        const my = qpaMean(y);
        const vx = Math.pow(qpaSd(x), 2);
        const vy = Math.pow(qpaSd(y), 2);
        let se;
        let df;
        if (mode === "student") {
          df = x.length + y.length - 2;
          const pooled = ((x.length - 1) * vx + (y.length - 1) * vy) / df;
          se = Math.sqrt(pooled * (1 / x.length + 1 / y.length));
        } else {
          const ax = vx / x.length;
          const by = vy / y.length;
          se = Math.sqrt(ax + by);
          df = Math.pow(ax + by, 2) / (Math.pow(ax, 2) / (x.length - 1) + Math.pow(by, 2) / (y.length - 1));
        }
        if (!isFinite(se) || se === 0) return { p: mx === my ? 1 : NaN, t: NaN, df };
        const t = (mx - my) / se;
        const p = Math.min(1, Math.max(0, 2 * (1 - qpaTCdf(Math.abs(t), df))));
        return { p, t, df };
      }

      function qpaPStars(p) {
        if (!isFinite(p)) return "n/a";
        if (p < 0.0001) return "****";
        if (p < 0.001) return "***";
        if (p < 0.01) return "**";
        if (p < 0.05) return "*";
        return "ns";
      }

      function qpaAnalyzeRows(rows, targetGene, comparison) {
        const target = qpaNorm(targetGene);
        const ref = qpaNorm($("qpa-ref-gene").value);
        const control = qpaNorm(comparison.control);
        const expectedReps = parseInt($("qpa-expected-reps").value, 10);
        const sdThreshold = getNumber("qpa-ct-sd-threshold");
        const testMode = $("qpa-test-mode").value;
        const geneRows = rows.filter((row) => [target, ref].includes(qpaNorm(row.gene)));
        const allowed = new Set(comparison.samples.map(qpaNorm));
        const samples = Array.from(new Set(geneRows.map((row) => row.sample))).filter((sample) => qpaNorm(sample) !== "20" && allowed.has(qpaNorm(sample)));
        const bySample = new Map();
        samples.forEach((sample) => bySample.set(sample, { sample, targetRows: [], refRows: [] }));
        geneRows.forEach((row) => {
          const entry = bySample.get(row.sample);
          if (!entry) return;
          if (qpaNorm(row.gene) === target) entry.targetRows.push(row);
          if (qpaNorm(row.gene) === ref) entry.refRows.push(row);
        });

        const controlEntry = Array.from(bySample.values()).find((entry) => qpaNorm(entry.sample) === control);
        if (!controlEntry) throw new Error("没有找到对照样本，请检查“对照样本”名称。");

        const summaries = Array.from(bySample.values()).map((entry) => {
          const targetCts = entry.targetRows.map((row) => row.ct);
          const refCts = entry.refRows.map((row) => row.ct);
          const pairN = Math.min(targetCts.length, refCts.length);
          const deltaCtReps = [];
          for (let i = 0; i < pairN; i += 1) deltaCtReps.push(targetCts[i] - refCts[i]);
          return {
            sample: entry.sample,
            targetCts,
            refCts,
            pairN,
            targetCtMean: qpaMean(targetCts),
            targetCtSd: qpaSd(targetCts),
            refCtMean: qpaMean(refCts),
            refCtSd: qpaSd(refCts),
            deltaCtReps,
            deltaCtMean: qpaMean(deltaCtReps),
            warnings: []
          };
        });

        const controlSummary = summaries.find((entry) => qpaNorm(entry.sample) === control);
        if (!controlSummary || controlSummary.pairN <= 0) throw new Error("对照样本缺少有效的目标/内参配对 Ct，请检查目标基因、内参基因和对照样本。");
        const controlDeltaMean = controlSummary.deltaCtMean;
        summaries.forEach((entry) => {
          entry.ddCtReps = entry.deltaCtReps.map((delta) => delta - controlDeltaMean);
          entry.rqReps = entry.ddCtReps.map((ddct) => Math.pow(2, -ddct));
          entry.ddCtMean = qpaMean(entry.ddCtReps);
          entry.rqMean = qpaMean(entry.rqReps);
          entry.rqSd = qpaSd(entry.rqReps);
          entry.rqSem = qpaSem(entry.rqReps);
        });

        summaries.forEach((entry) => {
          const p = qpaNorm(entry.sample) === control ? { p: 1, t: 0, df: entry.pairN - 1 } : qpaTTest(entry.rqReps, controlSummary.rqReps, testMode);
          entry.pValue = p.p;
          entry.pStars = qpaPStars(p.p);
          if (Number.isInteger(expectedReps) && expectedReps > 0 && entry.pairN !== expectedReps) entry.warnings.push(`有效配对复孔 ${entry.pairN}/${expectedReps}`);
          if (isFinite(sdThreshold) && sdThreshold > 0 && entry.targetCtSd > sdThreshold) entry.warnings.push(`目标基因 Ct SD ${fmt(entry.targetCtSd, 3)} 偏高`);
          if (isFinite(sdThreshold) && sdThreshold > 0 && entry.refCtSd > sdThreshold) entry.warnings.push(`内参 Ct SD ${fmt(entry.refCtSd, 3)} 偏高`);
          if (!entry.targetCts.length) entry.warnings.push("缺少目标基因 Ct");
          if (!entry.refCts.length) entry.warnings.push("缺少内参基因 Ct");
        });

        return { targetGene, comparisonLabel: comparison.label, control: comparison.control, summaries: summaries.filter((entry) => entry.pairN > 0), controlSummary };
      }

      function qpaBuildPrismCsv(analyses) {
        const blocks = [];
        analyses.forEach((analysis) => {
          const headers = analysis.summaries.map((entry) => entry.sample);
          const maxN = Math.max(...analysis.summaries.map((entry) => entry.rqReps.length));
          const lines = [];
          lines.push([`Target: ${analysis.targetGene}; ${analysis.comparisonLabel}`]);
          lines.push(headers);
          for (let i = 0; i < maxN; i += 1) {
            lines.push(analysis.summaries.map((entry) => isFinite(entry.rqReps[i]) ? entry.rqReps[i] : ""));
          }
          blocks.push(lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, "\"\"")}"`).join(",")).join("\n"));
        });
        return blocks.join("\n\n");
      }

      function qpaDrawChart(analysis) {
        const box = $("qpa-chart-box");
        const canvas = $("qpa-chart");
        const ctx = canvas.getContext("2d");
        const data = analysis.summaries;
        box.style.display = "block";
        box.className = "result ok";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pad = { l: 72, r: 28, t: 40, b: 86 };
        const w = canvas.width - pad.l - pad.r;
        const h = canvas.height - pad.t - pad.b;
        const maxY = Math.max(1.2, ...data.map((d) => d.rqMean + (isFinite(d.rqSem) ? d.rqSem : 0))) * 1.22;
        ctx.strokeStyle = "#cfd8d6";
        ctx.lineWidth = 1;
        ctx.fillStyle = "#607177";
        ctx.font = "14px Arial";
        for (let i = 0; i <= 5; i += 1) {
          const yVal = maxY * i / 5;
          const y = pad.t + h - yVal / maxY * h;
          ctx.beginPath();
          ctx.moveTo(pad.l, y);
          ctx.lineTo(pad.l + w, y);
          ctx.stroke();
          ctx.fillText(fmt(yVal, 2), 18, y + 4);
        }
        ctx.strokeStyle = "#172326";
        ctx.beginPath();
        ctx.moveTo(pad.l, pad.t);
        ctx.lineTo(pad.l, pad.t + h);
        ctx.lineTo(pad.l + w, pad.t + h);
        ctx.stroke();
        const gap = w / Math.max(data.length, 1);
        const barW = Math.min(72, gap * 0.48);
        data.forEach((entry, i) => {
          const x = pad.l + gap * i + gap / 2;
          const barH = entry.rqMean / maxY * h;
          const y = pad.t + h - barH;
          ctx.fillStyle = i === 0 ? "#08766d" : "#d99022";
          ctx.fillRect(x - barW / 2, y, barW, barH);
          if (isFinite(entry.rqSem)) {
            const err = entry.rqSem / maxY * h;
            ctx.strokeStyle = "#172326";
            ctx.beginPath();
            ctx.moveTo(x, y - err);
            ctx.lineTo(x, y + err);
            ctx.moveTo(x - 12, y - err);
            ctx.lineTo(x + 12, y - err);
            ctx.moveTo(x - 12, y + err);
            ctx.lineTo(x + 12, y + err);
            ctx.stroke();
          }
          ctx.fillStyle = "#172326";
          entry.rqReps.forEach((value, j) => {
            const px = x - barW * 0.28 + (j % 5) * (barW * 0.14);
            const py = pad.t + h - value / maxY * h;
            ctx.beginPath();
            ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.save();
          ctx.translate(x, pad.t + h + 24);
          ctx.rotate(-Math.PI / 7);
          ctx.textAlign = "right";
          ctx.font = "14px Arial";
          ctx.fillText(entry.sample, 0, 0);
          ctx.restore();
          ctx.textAlign = "center";
          ctx.font = "13px Arial";
          ctx.fillText(entry.pStars, x, Math.max(18, y - 20));
        });
        ctx.textAlign = "center";
        ctx.font = "700 18px Arial";
        ctx.fillStyle = "#172326";
        ctx.fillText(`${analysis.targetGene} ${analysis.comparisonLabel}`, canvas.width / 2, 24);
        ctx.save();
        ctx.translate(20, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = "14px Arial";
        ctx.fillText("2^-ΔΔCt", 0, 0);
        ctx.restore();
      }

      function qpaRenderAnalyses(analyses, rows) {
        const result = $("qpa-result");
        const targetBlocks = analyses.map((analysis) => {
          const summaryRows = analysis.summaries.map((entry) => [
            escapeHtml(entry.sample),
            fmt(entry.targetCtMean, 4),
            fmt(entry.targetCtSd, 4),
            fmt(entry.refCtMean, 4),
            fmt(entry.refCtSd, 4),
            fmt(entry.deltaCtMean, 4),
            fmt(entry.ddCtMean, 4),
            fmt(entry.rqMean, 4),
            fmt(entry.rqSd, 4),
            fmt(entry.rqSem, 4),
            fmt(entry.pValue, 4),
            escapeHtml(entry.pStars),
            escapeHtml(entry.warnings.join("；") || "OK")
          ]);
          return `
            <div class="section-title">${escapeHtml(analysis.targetGene)} · ${escapeHtml(analysis.comparisonLabel)}</div>
            ${table(["样本", "目标Ct均值", "目标Ct SD", "内参Ct均值", "内参Ct SD", "ΔCt均值", "ΔΔCt均值", "2^-ΔΔCt均值", "SD", "SEM", "P值", "显著性", "QC"], summaryRows)}
          `;
        }).join("");

        const totalWarnings = analyses.flatMap((analysis) => analysis.summaries.flatMap((entry) => entry.warnings));
        qpaLastAnalyses = analyses;
        qpaPopulateChartSelect(analyses);
        qpaLastPrismCsv = qpaBuildPrismCsv(analyses);
        $("qpa-download").disabled = !qpaLastPrismCsv;
        result.style.display = "block";
        result.className = totalWarnings.length ? "result warn" : "result ok";
        result.innerHTML = `
          <p class="result-title">qPCR 数据分析结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmtInt(rows.length)}</strong><span>有效孔级 Ct 记录</span></div>
            <div class="metric"><strong>${fmtInt(new Set(rows.map((row) => row.sample)).size)}</strong><span>样本数</span></div>
            <div class="metric"><strong>${fmtInt(analyses.length)}</strong><span>分析结果数</span></div>
          </div>
          ${targetBlocks}
          <div class="notice ${totalWarnings.length ? "warn" : "ok"}"><strong>QC：</strong>${totalWarnings.length ? escapeHtml(totalWarnings.slice(0, 8).join("；")) : "未发现明显复孔数量或 Ct SD 警告。"}</div>
        `;
        qpaDrawChart(analyses[0]);
      }

      function qpaPopulateChartSelect(analyses) {
        const select = $("qpa-chart-select");
        select.innerHTML = analyses.map((analysis, index) => `<option value="${index}">${escapeHtml(analysis.targetGene)} · ${escapeHtml(analysis.comparisonLabel)}</option>`).join("");
        select.disabled = analyses.length <= 1;
        select.value = "0";
      }

      function qpaDrawSelectedChart() {
        const index = parseInt($("qpa-chart-select").value, 10);
        if (qpaLastAnalyses[index]) qpaDrawChart(qpaLastAnalyses[index]);
      }

      function analyzeQpcrData() {
        try {
          const rows = qpaParseTextTable($("qpa-data").value);
          const samples = qpaRefreshSampleOptions();
          const targetGenes = $("qpa-target-gene").value.split(/[,，;；\s]+/).map((x) => x.trim()).filter(Boolean);
          const genes = qpaUniqueNames(rows, "gene");
          const byGene = new Map(genes.map((gene) => [qpaNorm(gene), gene]));
          if (!rows.length) throw new Error("没有可用 Ct 数据。");
          if (!targetGenes.length) throw new Error("请填写至少一个目标基因。");
          if (!samples.length) throw new Error("没有从样本名列识别到可用样本。");
          const missingGenes = [...targetGenes, $("qpa-ref-gene").value].filter((gene) => !byGene.has(qpaNorm(gene)));
          if (missingGenes.length) throw new Error(`没有在“基因名称”列找到：${missingGenes.join(", ")}。已识别基因：${genes.join(", ")}`);
          const comparisons = qpaParseComparisons(samples);
          const analyses = targetGenes.flatMap((gene) => comparisons.map((comparison) => qpaAnalyzeRows(rows, gene, comparison)));
          qpaRenderAnalyses(analyses, rows);
        } catch (error) {
          $("qpa-download").disabled = true;
          qpaLastAnalyses = [];
          setResult("qpa-result", `<p class="result-title">qPCR 数据分析失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
          $("qpa-chart-box").style.display = "none";
        }
      }

      function fillQpcrAnalysisExample() {
        $("qpa-target-gene").value = "GeneA";
        $("qpa-ref-gene").value = "ACTB";
        $("qpa-expected-reps").value = "3";
        $("qpa-ct-sd-threshold").value = "0.3";
        $("qpa-data").value = qpaRowsToTsv([
          ["样本名", "基因名称", "Cт", "扩增状态", "Tm1"],
          ["Control", "GeneA", 22.10, "Amp", 84.5],
          ["Control", "GeneA", 22.22, "Amp", 84.6],
          ["Control", "GeneA", 22.05, "Amp", 84.5],
          ["Control", "ACTB", 18.10, "Amp", 87.2],
          ["Control", "ACTB", 18.18, "Amp", 87.3],
          ["Control", "ACTB", 18.04, "Amp", 87.2],
          ["Treat_1", "GeneA", 20.40, "Amp", 84.5],
          ["Treat_1", "GeneA", 20.52, "Amp", 84.6],
          ["Treat_1", "GeneA", 20.47, "Amp", 84.6],
          ["Treat_1", "ACTB", 18.00, "Amp", 87.3],
          ["Treat_1", "ACTB", 18.09, "Amp", 87.2],
          ["Treat_1", "ACTB", 18.02, "Amp", 87.3],
          ["Treat_2", "GeneA", 23.10, "Amp", 84.5],
          ["Treat_2", "GeneA", 23.25, "Amp", 84.6],
          ["Treat_2", "GeneA", 23.02, "Amp", 84.5],
          ["Treat_2", "ACTB", 18.30, "Amp", 87.2],
          ["Treat_2", "ACTB", 18.24, "Amp", 87.3],
          ["Treat_2", "ACTB", 18.36, "Amp", 87.2]
        ]);
        $("qpa-file-status").textContent = "已填入通用示例数据。";
        qpaRefreshSampleOptions();
        $("qpa-control-sample").value = "Control";
        $("qpa-compare-mode").value = "custom";
        qpaUpdateCompareModeUi();
        qpaRenderCustomBuilder(qpaCurrentSamples(), [
          { control: "Control", treatments: ["Treat_1"] },
          { control: "Control", treatments: ["Treat_2"] }
        ]);
        analyzeQpcrData();
      }

      async function qpaInflateZipData(bytes, method) {
        if (method === 0) return bytes;
        if (method !== 8 || typeof DecompressionStream === "undefined") {
          throw new Error("当前浏览器无法直接解析该 xlsx，请改为复制粘贴“结果分析”表。");
        }
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }

      async function qpaReadZip(buffer) {
        const bytes = new Uint8Array(buffer);
        const view = new DataView(buffer);
        let eocd = -1;
        for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
          if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd < 0) throw new Error("不是有效的 xlsx/zip 文件。");
        const count = view.getUint16(eocd + 10, true);
        let ptr = view.getUint32(eocd + 16, true);
        const decoder = new TextDecoder("utf-8");
        const entries = new Map();
        for (let i = 0; i < count; i += 1) {
          if (view.getUint32(ptr, true) !== 0x02014b50) break;
          const method = view.getUint16(ptr + 10, true);
          const compSize = view.getUint32(ptr + 20, true);
          const nameLen = view.getUint16(ptr + 28, true);
          const extraLen = view.getUint16(ptr + 30, true);
          const commentLen = view.getUint16(ptr + 32, true);
          const localOffset = view.getUint32(ptr + 42, true);
          const name = decoder.decode(bytes.slice(ptr + 46, ptr + 46 + nameLen));
          const localNameLen = view.getUint16(localOffset + 26, true);
          const localExtraLen = view.getUint16(localOffset + 28, true);
          const dataStart = localOffset + 30 + localNameLen + localExtraLen;
          entries.set(name, { method, data: bytes.slice(dataStart, dataStart + compSize) });
          ptr += 46 + nameLen + extraLen + commentLen;
        }
        const text = async (name) => {
          const entry = entries.get(name);
          if (!entry) return "";
          return decoder.decode(await qpaInflateZipData(entry.data, entry.method));
        };
        return { entries, text };
      }

      function qpaXmlDoc(xml) {
        return new DOMParser().parseFromString(xml, "application/xml");
      }

      function qpaXmlAttr(node, name) {
        return node.getAttribute(name) || "";
      }

      function qpaColIndex(ref) {
        const letters = String(ref).match(/[A-Z]+/i)?.[0] || "A";
        let idx = 0;
        for (const ch of letters.toUpperCase()) idx = idx * 26 + ch.charCodeAt(0) - 64;
        return idx - 1;
      }

      async function qpaExtractXlsxRows(file) {
        const zip = await qpaReadZip(await file.arrayBuffer());
        const sharedXml = await zip.text("xl/sharedStrings.xml");
        const shared = sharedXml ? Array.from(qpaXmlDoc(sharedXml).getElementsByTagName("si")).map((si) => Array.from(si.getElementsByTagName("t")).map((t) => t.textContent || "").join("")) : [];
        const workbook = qpaXmlDoc(await zip.text("xl/workbook.xml"));
        const rels = qpaXmlDoc(await zip.text("xl/_rels/workbook.xml.rels"));
        const relMap = new Map(Array.from(rels.getElementsByTagName("Relationship")).map((rel) => [qpaXmlAttr(rel, "Id"), qpaXmlAttr(rel, "Target")]));
        const sheets = Array.from(workbook.getElementsByTagName("sheet")).map((sheet) => {
          const rid = qpaXmlAttr(sheet, "r:id") || qpaXmlAttr(sheet, "id");
          let target = relMap.get(rid) || "";
          if (target && !target.startsWith("/")) target = "xl/" + target.replace(/^xl\//, "");
          return { name: qpaXmlAttr(sheet, "name"), path: target.replace(/^\//, "") };
        });
        const preferred = sheets.find((sheet) => sheet.name === "结果分析") || sheets.find((sheet) => /result/i.test(sheet.name) || sheet.name.includes("分析")) || sheets[0];
        if (!preferred) throw new Error("xlsx 中没有找到工作表。");
        const sheetXml = qpaXmlDoc(await zip.text(preferred.path));
        const rows = Array.from(sheetXml.getElementsByTagName("row")).map((rowNode) => {
          const row = [];
          Array.from(rowNode.getElementsByTagName("c")).forEach((cell) => {
            const col = qpaColIndex(qpaXmlAttr(cell, "r"));
            const type = qpaXmlAttr(cell, "t");
            let value = "";
            if (type === "s") {
              const idx = parseInt(cell.getElementsByTagName("v")[0]?.textContent || "", 10);
              value = shared[idx] ?? "";
            } else if (type === "inlineStr") {
              value = Array.from(cell.getElementsByTagName("t")).map((t) => t.textContent || "").join("");
            } else {
              value = cell.getElementsByTagName("v")[0]?.textContent || "";
            }
            row[col] = value;
          });
          return row;
        });
        return { sheetName: preferred.name, rows };
      }

      async function handleQpcrAnalysisFile() {
        const file = $("qpa-file").files && $("qpa-file").files[0];
        if (!file) return;
        try {
          $("qpa-file-status").textContent = "正在读取文件...";
          if (/\.xlsx$/i.test(file.name)) {
            const parsed = await qpaExtractXlsxRows(file);
            const headerRow = qpaFindHeaderRow(parsed.rows);
            if (headerRow < 0) throw new Error("没有在 xlsx 中找到孔级结果表头。");
            $("qpa-data").value = qpaRowsToTsv(parsed.rows.slice(headerRow));
            const samples = qpaRefreshSampleOptions();
            const genes = qpaRefreshSampleOptions.last?.genes || [];
            $("qpa-file-status").textContent = `已读取 ${file.name} 的“${parsed.sheetName}”表。`;
            if (samples.length) $("qpa-file-status").textContent += ` 已识别 ${samples.length} 个样本。`;
            if (genes.length) $("qpa-file-status").textContent += ` 已识别 ${genes.length} 个基因。`;
          } else {
            $("qpa-data").value = await file.text();
            const samples = qpaRefreshSampleOptions();
            const genes = qpaRefreshSampleOptions.last?.genes || [];
            $("qpa-file-status").textContent = `已读取 ${file.name}。`;
            if (samples.length) $("qpa-file-status").textContent += ` 已识别 ${samples.length} 个样本。`;
            if (genes.length) $("qpa-file-status").textContent += ` 已识别 ${genes.length} 个基因。`;
          }
        } catch (error) {
          $("qpa-file-status").textContent = error.message;
        }
      }

      function downloadQpcrPrismCsv() {
        downloadCsv("qpcr_prism_column_data.csv", qpaLastPrismCsv);
      }

      function qmeRefGenes() {
        return parseNameList($("qme-ref-genes").value);
      }

      function qmeSelectedTargets() {
        return Array.from(document.querySelectorAll(".qme-target:checked")).map((input) => input.value);
      }

      function qmeParseRows() {
        return qpaParseTextTable($("qme-data").value);
      }

      function qmeParseAllRows() {
        try {
          return qpaParseTextTableAll($("qme-data").value);
        } catch (error) {
          return [];
        }
      }

      function qmeWellKey(well) {
        return String(well || "").trim().toUpperCase();
      }

      function qmeWellMeta(well) {
        const match = qmeWellKey(well).match(/^([A-H])\s*0?([1-9]|1[0-2])$/);
        if (!match) return null;
        return {
          row: match[1],
          rowIndex: match[1].charCodeAt(0) - 65,
          col: parseInt(match[2], 10),
          key: `${match[1]}${parseInt(match[2], 10)}`
        };
      }

      function qmeOffsetWell(well, offset) {
        const meta = qmeWellMeta(well);
        if (!meta) return "";
        const nextRow = meta.rowIndex + offset;
        if (nextRow < 0 || nextRow > 7) return "";
        return `${String.fromCharCode(65 + nextRow)}${meta.col}`;
      }

      function qmeWellSortValue(well) {
        const meta = qmeWellMeta(well);
        return meta ? meta.rowIndex * 12 + meta.col : 9999;
      }

      function qmeSelectedWellList() {
        return Array.from(qmeSelectedWells)
          .map((well) => qmeWellMeta(well)?.key)
          .filter(Boolean)
          .sort((a, b) => qmeWellSortValue(a) - qmeWellSortValue(b));
      }

      function qmeUpdateSelectionStatus() {
        const list = qmeSelectedWellList();
        const status = $("qme-selection-status");
        if (!status) return;
        if (list.length > 1) {
          status.className = "notice warn";
          status.innerHTML = `<strong>已多选 ${list.length} 个孔：</strong>${escapeHtml(list.join(", "))}<div class="help">批量保存会应用样本、基因、扩增状态、HIGHSD 和忽略状态；Ct 会保留每个孔原值。</div>`;
        } else {
          status.className = "notice ok";
          status.textContent = `当前孔：${list[0] || qmePrimaryWell}`;
        }
      }

      function qmeRowsToEditableTsv(rows) {
        const cleanRows = rows
          .filter((row) => qmeWellMeta(row.well))
          .sort((a, b) => qmeWellSortValue(a.well) - qmeWellSortValue(b.well));
        return qpaRowsToTsv([
          ["反应孔位置", "样本名", "基因名称", "Cт", "扩增状态", "HIGHSD", "忽略"],
          ...cleanRows.map((row) => [
            qmeWellMeta(row.well).key,
            row.sample,
            row.gene,
            row.ct,
            row.amp || "Amp",
            row.highsd || "N",
            row.ignored || "false"
          ])
        ]);
      }

      function qmeRowsByWell(rows) {
        const map = new Map();
        rows.forEach((row) => {
          const key = qmeWellMeta(row.well)?.key;
          if (!key) return;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(row);
        });
        return map;
      }

      function qmeAllWellKeys() {
        const wells = [];
        for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
          const row = String.fromCharCode(65 + rowIndex);
          for (let col = 1; col <= 12; col += 1) wells.push(`${row}${col}`);
        }
        return wells;
      }

      function qmeUniqueValues(values) {
        const seen = new Set();
        return values.map((value) => String(value || "").trim()).filter((value) => {
          const key = qpaNorm(value);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }

      function qmeSetSelectOptions(id, values, selected, emptyLabel) {
        const select = $(id);
        if (!select) return;
        const clean = qmeUniqueValues(values);
        const selectedValue = String(selected || select.value || "").trim();
        if (selectedValue && !clean.some((value) => qpaNorm(value) === qpaNorm(selectedValue))) clean.unshift(selectedValue);
        const empty = emptyLabel ? [`<option value="">${escapeHtml(emptyLabel)}</option>`] : [];
        select.innerHTML = empty.concat(clean.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)).join("");
        if (selectedValue && clean.some((value) => qpaNorm(value) === qpaNorm(selectedValue))) {
          select.value = clean.find((value) => qpaNorm(value) === qpaNorm(selectedValue));
        } else if (!emptyLabel && clean.length) {
          select.value = clean[0];
        } else {
          select.value = "";
        }
      }

      function qmeRefreshEditorChoices(samples, genes, rows) {
        qmeSetSelectOptions("qme-edit-well", qmeAllWellKeys(), $("qme-edit-well").value || "A1");
        qmeSetSelectOptions("qme-edit-sample", samples, $("qme-edit-sample").value, samples.length ? "选择样本" : "先导入数据");
        qmeSetSelectOptions("qme-edit-gene", genes, $("qme-edit-gene").value, genes.length ? "选择基因" : "先导入数据");
        const ampValues = ["Amp", "Inconclusive", "No Amp", "Undetermined", ...qmeUniqueValues((rows || []).map((row) => row.amp))];
        qmeSetSelectOptions("qme-edit-amp", ampValues, $("qme-edit-amp").value || "Amp");
      }

      function qmeRenderPlate(selectedWell) {
        const grid = $("qme-plate-grid");
        if (!grid) return;
        const rows = qmeParseAllRows();
        if (!rows.length) {
          grid.innerHTML = `<div class="help">导入数据后显示孔板布局。</div>`;
          qmeUpdateSelectionStatus();
          return;
        }
        const selected = qmeWellMeta(selectedWell || qmePrimaryWell || $("qme-edit-well").value)?.key || "A1";
        if (!qmeSelectedWells.size) qmeSelectedWells.add(selected);
        const byWell = qmeRowsByWell(rows);
        const refSet = new Set(qmeRefGenes().map(qpaNorm));
        const parts = [`<div class="plate-label"></div>`];
        for (let col = 1; col <= 12; col += 1) parts.push(`<div class="plate-label">${col}</div>`);
        for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
          const rowLetter = String.fromCharCode(65 + rowIndex);
          parts.push(`<div class="plate-label">${rowLetter}</div>`);
          for (let col = 1; col <= 12; col += 1) {
            const well = `${rowLetter}${col}`;
            const entry = (byWell.get(well) || [])[0];
            const classes = ["plate-cell"];
            if (!entry) classes.push("empty");
            if (entry && refSet.has(qpaNorm(entry.gene))) classes.push("ref");
            if (entry && (qpaNorm(entry.highsd) === "y" || ["true", "yes", "1"].includes(qpaNorm(entry.ignored)))) classes.push("warn");
            if (qmeSelectedWells.has(well)) classes.push("active");
            if (well === qmePrimaryWell) classes.push("primary");
            const body = entry
              ? `<strong>${escapeHtml(well)}</strong><span>${escapeHtml(entry.sample)}</span><small>${escapeHtml(entry.gene)} · Ct ${fmt(entry.ct, 2)}</small>`
              : `<strong>${escapeHtml(well)}</strong><small>空</small>`;
            parts.push(`<button class="${classes.join(" ")}" type="button" data-well="${well}">${body}</button>`);
          }
        }
        grid.innerHTML = parts.join("");
        qmeUpdateSelectionStatus();
      }

      function qmeLoadWellEditor(well) {
        const meta = qmeWellMeta(well);
        if (!meta) return;
        const rows = qmeParseAllRows();
        const samples = qpaUniqueNames(rows, "sample");
        const genes = qpaUniqueNames(rows, "gene");
        const entry = rows.find((row) => qmeWellMeta(row.well)?.key === meta.key);
        qmeRefreshEditorChoices(samples, genes, rows);
        $("qme-edit-well").value = meta.key;
        $("qme-edit-sample").value = entry?.sample || "";
        $("qme-edit-gene").value = entry?.gene || "";
        $("qme-edit-ct").value = isFinite(entry?.ct) ? entry.ct : "";
        $("qme-edit-amp").value = entry?.amp || "Amp";
        $("qme-edit-highsd").value = qpaNorm(entry?.highsd) === "y" ? "Y" : "N";
        $("qme-edit-ignore").checked = ["true", "yes", "1"].includes(qpaNorm(entry?.ignored));
      }

      function qmeSelectWell(well, additive = false) {
        const meta = qmeWellMeta(well);
        if (!meta) return;
        if (additive) {
          if (qmeSelectedWells.has(meta.key) && qmeSelectedWells.size > 1) {
            qmeSelectedWells.delete(meta.key);
          } else {
            qmeSelectedWells.add(meta.key);
            qmePrimaryWell = meta.key;
          }
        } else {
          qmeSelectedWells = new Set([meta.key]);
          qmePrimaryWell = meta.key;
        }
        if (!qmeSelectedWells.has(qmePrimaryWell)) {
          qmePrimaryWell = qmeSelectedWellList()[0] || meta.key;
        }
        qmeLoadWellEditor(qmePrimaryWell);
        qmeRenderPlate(meta.key);
      }

      function qmeApplyWellEdit() {
        const meta = qmeWellMeta($("qme-edit-well").value);
        if (!meta) {
          setResult("qme-result", `<p class="result-title">孔位格式不正确</p><div class="notice danger">请填写 A1 到 H12 范围内的孔位。</div>`, "danger");
          return;
        }
        if (!qmeSelectedWells.size) qmeSelectedWells.add(meta.key);
        const selectedWells = qmeSelectedWellList();
        const originalRows = qmeParseAllRows();
        const originalByWell = qmeRowsByWell(originalRows);
        const selectedSet = new Set(selectedWells);
        const rows = originalRows.filter((row) => !selectedSet.has(qmeWellMeta(row.well)?.key));
        const sample = $("qme-edit-sample").value;
        const gene = $("qme-edit-gene").value;
        const ctInput = parseFloat($("qme-edit-ct").value);
        selectedWells.forEach((well) => {
          const original = (originalByWell.get(well) || [])[0];
          const ct = selectedWells.length > 1 && isFinite(original?.ct) ? original.ct : ctInput;
          const nextSample = sample || original?.sample || "";
          const nextGene = gene || original?.gene || "";
          if (!nextSample || !nextGene || !isFinite(ct)) return;
          rows.push({
            well,
            sample: nextSample,
            gene: nextGene,
            ct,
            amp: $("qme-edit-amp").value || "Amp",
            highsd: $("qme-edit-highsd").value || "N",
            ignored: $("qme-edit-ignore").checked ? "true" : "false"
          });
        });
        $("qme-data").value = qmeRowsToEditableTsv(rows);
        qmeRefreshOptions();
        qmeSelectedWells = new Set(selectedWells);
        qmePrimaryWell = selectedWells.includes(qmePrimaryWell) ? qmePrimaryWell : selectedWells[0];
        qmeLoadWellEditor(qmePrimaryWell);
        qmeRenderPlate(qmePrimaryWell);
      }

      function qmeClearWellEdit() {
        const meta = qmeWellMeta($("qme-edit-well").value);
        if (!meta) return;
        if (!qmeSelectedWells.size) qmeSelectedWells.add(meta.key);
        const selectedWells = qmeSelectedWellList();
        const selectedSet = new Set(selectedWells);
        const rows = qmeParseAllRows().filter((row) => !selectedSet.has(qmeWellMeta(row.well)?.key));
        $("qme-data").value = qmeRowsToEditableTsv(rows);
        qmeRefreshOptions();
        qmeSelectedWells = new Set(selectedWells);
        qmePrimaryWell = selectedWells[0] || meta.key;
        qmeLoadWellEditor(qmePrimaryWell);
        qmeRenderPlate(qmePrimaryWell);
      }

      function qmeRefreshOptions() {
        const select = $("qme-control-sample");
        const checks = $("qme-target-checks");
        const previousControl = select.value;
        const previousTargets = new Set(qmeSelectedTargets().map(qpaNorm));
        try {
          const rows = qmeParseRows();
          const samples = qpaUniqueNames(rows, "sample");
          const genes = qpaUniqueNames(rows, "gene");
          qmeRefreshOptions.last = { rows, samples, genes };
          if (!samples.length || !genes.length) {
            qmeRefreshEditorChoices(samples, genes, rows);
            qmeRenderPlate();
            return [];
          }

          const refs = qmeRefGenes();
          const genesByNorm = new Map(genes.map((gene) => [qpaNorm(gene), gene]));
          if (!refs.length || !refs.some((gene) => genesByNorm.has(qpaNorm(gene)))) {
            $("qme-ref-genes").value = qpaPickReferenceGene(genes);
          }
          const refSet = new Set(qmeRefGenes().map(qpaNorm));
          const targets = genes.filter((gene) => !refSet.has(qpaNorm(gene)));

          select.innerHTML = samples.map((sample) => `<option value="${escapeHtml(sample)}">${escapeHtml(sample)}</option>`).join("");
          if (samples.some((sample) => qpaNorm(sample) === qpaNorm(previousControl))) {
            select.value = samples.find((sample) => qpaNorm(sample) === qpaNorm(previousControl));
          } else if (samples.some((sample) => qpaNorm(sample) === "control")) {
            select.value = samples.find((sample) => qpaNorm(sample) === "control");
          } else {
            select.value = samples[0];
          }

          const hasTargetMatch = targets.some((gene) => previousTargets.has(qpaNorm(gene)));
          checks.innerHTML = targets.map((gene) => {
            const checked = previousTargets.size && hasTargetMatch ? previousTargets.has(qpaNorm(gene)) : true;
            return `
              <label class="sample-check">
                <input class="qme-target" type="checkbox" value="${escapeHtml(gene)}"${checked ? " checked" : ""} />
                <span>${escapeHtml(gene)}</span>
              </label>
            `;
          }).join("") || `<div class="help">没有找到除内参外的目标基因，请检查内参设置。</div>`;
          qmeRefreshEditorChoices(samples, genes, rows);
          qmeRenderPlate();
          return samples;
        } catch (error) {
          qmeRefreshOptions.last = { rows: [], samples: [], genes: [] };
          checks.innerHTML = `<div class="help">导入或粘贴数据后，会在这里生成目标基因选择。</div>`;
          qmeRefreshEditorChoices([], [], []);
          qmeRenderPlate();
          return [];
        }
      }

      function qmeScheduleRefresh() {
        clearTimeout(qmeScheduleRefresh.timer);
        qmeScheduleRefresh.timer = setTimeout(qmeRefreshOptions, 180);
      }

      function qmeRowsFor(rows, sample, gene) {
        return rows.filter((row) => qpaNorm(row.sample) === qpaNorm(sample) && qpaNorm(row.gene) === qpaNorm(gene));
      }

      function qmePairForSample(rows, sample, targetGene, refGenes, settings) {
        const targetRows = qmeRowsFor(rows, sample, targetGene);
        const refRowsByGene = refGenes.map((gene) => qmeRowsFor(rows, sample, gene));
        const refSet = new Set(refGenes.map(qpaNorm));
        const warnings = [];
        const pairs = [];

        if (settings.pairMode === "plate") {
          const byWell = qmeRowsByWell(rows.filter((row) => qpaNorm(row.sample) === qpaNorm(sample)));
          targetRows.forEach((targetRow) => {
            const targetWell = qmeWellMeta(targetRow.well)?.key;
            const refWell = qmeOffsetWell(targetWell, settings.rowOffset);
            if (!targetWell || !refWell) {
              warnings.push(`${targetRow.well || "未知孔"} 无法计算配对孔`);
              return;
            }
            const refRow = (byWell.get(refWell) || []).find((row) => refSet.has(qpaNorm(row.gene)));
            if (!refRow) {
              warnings.push(`${targetWell} 未找到下方同列内参孔 ${refWell}`);
              return;
            }
            pairs.push({ targetRow, refRow });
          });
        } else {
          const refCtsByGene = refRowsByGene.map((geneRows) => geneRows.map((row) => row.ct));
          const pairN = Math.min(targetRows.length, ...refCtsByGene.map((cts) => cts.length));
          for (let i = 0; i < pairN; i += 1) {
            const pseudoRef = {
              ct: qpaMean(refCtsByGene.map((cts) => cts[i])),
              well: refRowsByGene.map((geneRows) => geneRows[i]?.well).filter(Boolean).join("/"),
              gene: refGenes.join("+"),
              highsd: refRowsByGene.some((geneRows) => qpaNorm(geneRows[i]?.highsd) === "y") ? "Y" : "N",
              amp: refRowsByGene.map((geneRows) => geneRows[i]?.amp).filter(Boolean).join("/")
            };
            pairs.push({ targetRow: targetRows[i], refRow: pseudoRef });
          }
        }

        return { targetRows, refRowsByGene, pairs, warnings };
      }

      function qmeAnalyzeTarget(rows, targetGene, refGenes, controlSample, samples, settings) {
        const summaries = samples.map((sample) => {
          const paired = qmePairForSample(rows, sample, targetGene, refGenes, settings);
          const targetRows = paired.targetRows;
          const refRowsByGene = paired.refRowsByGene;
          const targetCts = paired.pairs.map((pair) => pair.targetRow.ct);
          const refCtReps = paired.pairs.map((pair) => pair.refRow.ct);
          const deltaCtReps = paired.pairs.map((pair) => pair.targetRow.ct - pair.refRow.ct);
          const pairN = paired.pairs.length;
          const warnings = [];
          const pairedRows = paired.pairs.flatMap((pair) => [pair.targetRow, pair.refRow]);
          const highSdRows = pairedRows.filter((row) => qpaNorm(row.highsd) === "y");
          const ampWarn = pairedRows.filter((row) => row.amp && !/^amp$/i.test(String(row.amp).trim()));
          paired.warnings.forEach((text) => warnings.push(text));
          if (Number.isInteger(settings.expectedReps) && settings.expectedReps > 0 && pairN !== settings.expectedReps) warnings.push(`有效配对复孔 ${pairN}/${settings.expectedReps}`);
          if (isFinite(settings.sdThreshold) && settings.sdThreshold > 0 && qpaSd(targetCts) > settings.sdThreshold) warnings.push(`目标 Ct SD ${fmt(qpaSd(targetCts), 3)} 偏高`);
          if (isFinite(settings.sdThreshold) && settings.sdThreshold > 0 && qpaSd(refCtReps) > settings.sdThreshold) warnings.push(`内参 Ct SD ${fmt(qpaSd(refCtReps), 3)} 偏高`);
          if (!targetRows.length) warnings.push("缺少目标基因 Ct");
          if (targetRows.length && !targetCts.length) warnings.push("没有形成目标/内参孔位配对");
          refGenes.forEach((gene, index) => {
            if (!refRowsByGene[index].length) warnings.push(`缺少内参 ${gene} Ct`);
          });
          if (highSdRows.length) warnings.push(`HIGHSD 孔 ${highSdRows.length} 个`);
          if (ampWarn.length) warnings.push(`扩增状态提醒 ${ampWarn.length} 个`);
          return {
            sample,
            targetCts,
            refCtReps,
            pairN,
            targetCtMean: qpaMean(targetCts),
            targetCtSd: qpaSd(targetCts),
            refCtMean: qpaMean(refCtReps),
            refCtSd: qpaSd(refCtReps),
            deltaCtReps,
            deltaCtMean: qpaMean(deltaCtReps),
            warnings
          };
        });

        const control = summaries.find((entry) => qpaNorm(entry.sample) === qpaNorm(controlSample));
        if (!control || control.pairN <= 0) {
          throw new Error(`${targetGene}: 对照样本缺少有效的目标/内参配对 Ct。`);
        }
        const controlDeltaMean = control.deltaCtMean;
        summaries.forEach((entry) => {
          entry.ddCtReps = entry.deltaCtReps.map((delta) => delta - controlDeltaMean);
          entry.rqReps = entry.ddCtReps.map((ddct) => Math.pow(2, -ddct));
          entry.ddCtMean = qpaMean(entry.ddCtReps);
          entry.rqMean = qpaMean(entry.rqReps);
          entry.rqSd = qpaSd(entry.rqReps);
          entry.rqSem = qpaSem(entry.rqReps);
          const test = qpaNorm(entry.sample) === qpaNorm(control.sample) ? { p: 1, t: 0, df: entry.pairN - 1 } : qpaTTest(entry.rqReps, control.rqReps, settings.testMode);
          entry.pValue = test.p;
          entry.pStars = qpaPStars(test.p);
        });
        return { targetGene, refGenes, control: control.sample, summaries: summaries.filter((entry) => entry.pairN > 0) };
      }

      function qmeBuildSummaryCsv(analyses) {
        const rows = [["目标基因", "样本", "对照样本", "有效复孔", "目标Ct均值", "目标Ct SD", "内参Ct均值", "内参Ct SD", "ΔCt", "ΔΔCt", "2^-ΔΔCt mean", "SD", "SEM", "P value", "显著性", "提醒"]];
        analyses.forEach((analysis) => {
          analysis.summaries.forEach((entry) => {
            rows.push([
              analysis.targetGene,
              entry.sample,
              analysis.control,
              entry.pairN,
              fmt(entry.targetCtMean, 4),
              fmt(entry.targetCtSd, 4),
              fmt(entry.refCtMean, 4),
              fmt(entry.refCtSd, 4),
              fmt(entry.deltaCtMean, 4),
              fmt(entry.ddCtMean, 4),
              fmt(entry.rqMean, 6),
              fmt(entry.rqSd, 6),
              fmt(entry.rqSem, 6),
              isFinite(entry.pValue) ? entry.pValue : "",
              entry.pStars,
              entry.warnings.join("; ")
            ]);
          });
        });
        return rowsToCsv(rows);
      }

      function qmeBuildPrismCsv(analyses) {
        return analyses.map((analysis) => {
          const maxN = Math.max(...analysis.summaries.map((entry) => entry.rqReps.length));
          const rows = [[`Target: ${analysis.targetGene}; Control: ${analysis.control}`], analysis.summaries.map((entry) => entry.sample)];
          for (let i = 0; i < maxN; i += 1) {
            rows.push(analysis.summaries.map((entry) => isFinite(entry.rqReps[i]) ? entry.rqReps[i] : ""));
          }
          return rowsToCsv(rows);
        }).join("\n\n");
      }

      function qmeChartHtml(analyses) {
        return `
          <div class="mini-chart-grid">
            ${analyses.map((analysis) => {
              const max = Math.max(1, ...analysis.summaries.map((entry) => entry.rqMean));
              const bars = analysis.summaries.map((entry) => {
                const width = Math.max(2, Math.min(100, entry.rqMean / max * 100));
                return `
                  <div class="bar-line">
                    <span>${escapeHtml(entry.sample)}</span>
                    <span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span>
                    <span>${fmt(entry.rqMean, 3)} ${entry.pStars}</span>
                  </div>
                `;
              }).join("");
              return `<div class="gene-chart"><h4>${escapeHtml(analysis.targetGene)}</h4>${bars}</div>`;
            }).join("")}
          </div>
        `;
      }

      function analyzeQpcrMulti() {
        try {
          const rows = qmeParseRows();
          const samples = qpaUniqueNames(rows, "sample");
          const refGenes = qmeRefGenes();
          const targets = qmeSelectedTargets();
          const control = $("qme-control-sample").value;
          const settings = {
            expectedReps: parseInt($("qme-expected-reps").value, 10),
            sdThreshold: getNumber("qme-ct-sd-threshold"),
            testMode: $("qme-test-mode").value,
            pairMode: $("qme-pair-mode").value,
            rowOffset: parseInt($("qme-row-offset").value, 10)
          };
          if (!rows.length || !samples.length) throw new Error("请先导入或粘贴孔级 Ct 表。");
          if (!refGenes.length) throw new Error("请填写内参基因。");
          if (!targets.length) throw new Error("请至少勾选一个目标基因。");
          if (!samples.some((sample) => qpaNorm(sample) === qpaNorm(control))) throw new Error("请选择有效的对照样本。");
          if (settings.pairMode === "plate" && (!Number.isInteger(settings.rowOffset) || settings.rowOffset <= 0)) throw new Error("按孔位配对时，请填写有效的内参下移行数。");

          const failed = [];
          let analyses = targets.map((target) => {
            try {
              return qmeAnalyzeTarget(rows, target, refGenes, control, samples, settings);
            } catch (error) {
              failed.push(error.message);
              return null;
            }
          }).filter(Boolean);
          if (!analyses.length) throw new Error(failed.join("；") || "没有可计算的目标基因。");

          if ($("qme-output-mode").value === "changed") {
            analyses = analyses.map((analysis) => ({
              ...analysis,
              summaries: [...analysis.summaries].sort((a, b) => {
                const asig = isFinite(a.pValue) && a.pValue < 0.05 ? 0 : 1;
                const bsig = isFinite(b.pValue) && b.pValue < 0.05 ? 0 : 1;
                return asig - bsig || qpaNorm(a.sample).localeCompare(qpaNorm(b.sample));
              })
            }));
          }

          qmeLastSummaryCsv = qmeBuildSummaryCsv(analyses);
          qmeLastPrismCsv = qmeBuildPrismCsv(analyses);
          $("qme-summary-download").disabled = false;
          $("qme-prism-download").disabled = false;

          const tableRows = [];
          const warnings = [];
          analyses.forEach((analysis) => {
            analysis.summaries.forEach((entry) => {
              if (entry.warnings.length) warnings.push(`${analysis.targetGene}/${entry.sample}: ${entry.warnings.join("；")}`);
              tableRows.push([
                escapeHtml(analysis.targetGene),
                escapeHtml(entry.sample),
                fmtInt(entry.pairN),
                fmt(entry.targetCtMean, 3),
                fmt(entry.refCtMean, 3),
                fmt(entry.deltaCtMean, 3),
                fmt(entry.ddCtMean, 3),
                fmt(entry.rqMean, 4),
                fmt(entry.rqSd, 4),
                fmt(entry.rqSem, 4),
                isFinite(entry.pValue) ? fmt(entry.pValue, 5) : "n/a",
                escapeHtml(entry.pStars),
                escapeHtml(entry.warnings.join("；") || "OK")
              ]);
            });
          });

          let html = `
            <p class="result-title">qPCR 多基因结果增强版</p>
            <div class="metric-grid">
              <div class="metric"><strong>${fmtInt(rows.length)}</strong><span>有效孔级 Ct 记录</span></div>
              <div class="metric"><strong>${fmtInt(samples.length)}</strong><span>样本数</span></div>
              <div class="metric"><strong>${fmtInt(refGenes.length)}</strong><span>内参数</span></div>
              <div class="metric"><strong>${fmtInt(analyses.length)}</strong><span>成功计算目标基因数</span></div>
              <div class="metric"><strong>${settings.pairMode === "plate" ? "孔位" : "顺序"}</strong><span>Ct 配对方式</span></div>
            </div>
            <div class="notice ${warnings.length || failed.length ? "warn" : "ok"}"><strong>QC：</strong>${warnings.length || failed.length ? escapeHtml([...warnings.slice(0, 8), ...failed.slice(0, 4)].join("；")) : "未发现明显复孔数量、Ct SD 或 HIGHSD 警告。"}</div>
          `;
          html += qmeChartHtml(analyses);
          html += `<div class="section-title">多基因汇总表</div>`;
          html += table(["目标基因", "样本", "有效复孔", "目标Ct", "内参Ct", "ΔCt", "ΔΔCt", "2^-ΔΔCt", "SD", "SEM", "P value", "显著性", "提醒"], tableRows);
          setResult("qme-result", html, warnings.length || failed.length ? "warn" : "ok");
        } catch (error) {
          qmeLastSummaryCsv = "";
          qmeLastPrismCsv = "";
          $("qme-summary-download").disabled = true;
          $("qme-prism-download").disabled = true;
          setResult("qme-result", `<p class="result-title">qPCR 多基因分析失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
        }
      }

      async function handleQpcrMultiFile() {
        const file = $("qme-file").files && $("qme-file").files[0];
        if (!file) return;
        try {
          $("qme-file-status").textContent = "正在读取文件...";
          if (/\.xlsx$/i.test(file.name)) {
            const parsed = await qpaExtractXlsxRows(file);
            const headerRow = qpaFindHeaderRow(parsed.rows);
            if (headerRow < 0) throw new Error("没有在 xlsx 中找到孔级结果表头。");
            $("qme-data").value = qpaRowsToTsv(parsed.rows.slice(headerRow));
            const samples = qmeRefreshOptions();
            const genes = qmeRefreshOptions.last?.genes || [];
            $("qme-file-status").textContent = `已读取 ${file.name} 的“${parsed.sheetName}”表。`;
            if (samples.length) $("qme-file-status").textContent += ` 已识别 ${samples.length} 个样本。`;
            if (genes.length) $("qme-file-status").textContent += ` 已识别 ${genes.length} 个基因。`;
          } else {
            $("qme-data").value = await file.text();
            const samples = qmeRefreshOptions();
            const genes = qmeRefreshOptions.last?.genes || [];
            $("qme-file-status").textContent = `已读取 ${file.name}。`;
            if (samples.length) $("qme-file-status").textContent += ` 已识别 ${samples.length} 个样本。`;
            if (genes.length) $("qme-file-status").textContent += ` 已识别 ${genes.length} 个基因。`;
          }
        } catch (error) {
          $("qme-file-status").textContent = error.message;
        }
      }

      function fillQpcrMultiExample() {
        $("qme-data").value = [
          "反应孔\t反应孔位置\t忽略\t样本名\t基因名称\tCт\t扩增状态\tHIGHSD",
          "1\tA1\tfalse\tControl\tGeneA\t23.10\tAmp\tN",
          "2\tA2\tfalse\tControl\tGeneA\t23.02\tAmp\tN",
          "3\tA3\tfalse\tControl\tGeneA\t23.16\tAmp\tN",
          "4\tA4\tfalse\tTreat_1\tGeneA\t21.30\tAmp\tN",
          "5\tA5\tfalse\tTreat_1\tGeneA\t21.22\tAmp\tN",
          "6\tA6\tfalse\tTreat_1\tGeneA\t21.41\tAmp\tN",
          "7\tA7\tfalse\tTreat_2\tGeneA\t24.20\tAmp\tN",
          "8\tA8\tfalse\tTreat_2\tGeneA\t24.12\tAmp\tN",
          "9\tA9\tfalse\tTreat_2\tGeneA\t24.31\tAmp\tN",
          "10\tB1\tfalse\tControl\tACTB\t18.00\tAmp\tN",
          "11\tB2\tfalse\tControl\tACTB\t18.08\tAmp\tN",
          "12\tB3\tfalse\tControl\tACTB\t17.96\tAmp\tN",
          "13\tB4\tfalse\tTreat_1\tACTB\t18.12\tAmp\tN",
          "14\tB5\tfalse\tTreat_1\tACTB\t18.04\tAmp\tN",
          "15\tB6\tfalse\tTreat_1\tACTB\t18.17\tAmp\tN",
          "16\tB7\tfalse\tTreat_2\tACTB\t18.02\tAmp\tN",
          "17\tB8\tfalse\tTreat_2\tACTB\t18.11\tAmp\tN",
          "18\tB9\tfalse\tTreat_2\tACTB\t18.05\tAmp\tN",
          "19\tC1\tfalse\tControl\tGeneB\t26.10\tAmp\tN",
          "20\tC2\tfalse\tControl\tGeneB\t26.00\tAmp\tN",
          "21\tC3\tfalse\tControl\tGeneB\t26.16\tAmp\tN",
          "22\tC4\tfalse\tTreat_1\tGeneB\t25.20\tAmp\tN",
          "23\tC5\tfalse\tTreat_1\tGeneB\t25.28\tAmp\tN",
          "24\tC6\tfalse\tTreat_1\tGeneB\t25.31\tAmp\tN",
          "25\tC7\tfalse\tTreat_2\tGeneB\t22.40\tAmp\tN",
          "26\tC8\tfalse\tTreat_2\tGeneB\t22.52\tAmp\tN",
          "27\tC9\tfalse\tTreat_2\tGeneB\t22.43\tAmp\tN",
          "28\tD1\tfalse\tControl\tACTB\t18.00\tAmp\tN",
          "29\tD2\tfalse\tControl\tACTB\t18.08\tAmp\tN",
          "30\tD3\tfalse\tControl\tACTB\t17.96\tAmp\tN",
          "31\tD4\tfalse\tTreat_1\tACTB\t18.12\tAmp\tN",
          "32\tD5\tfalse\tTreat_1\tACTB\t18.04\tAmp\tN",
          "33\tD6\tfalse\tTreat_1\tACTB\t18.17\tAmp\tN",
          "34\tD7\tfalse\tTreat_2\tACTB\t18.02\tAmp\tN",
          "35\tD8\tfalse\tTreat_2\tACTB\t18.11\tAmp\tN",
          "36\tD9\tfalse\tTreat_2\tACTB\t18.05\tAmp\tN"
        ].join("\n");
        $("qme-ref-genes").value = "ACTB";
        $("qme-expected-reps").value = "3";
        $("qme-ct-sd-threshold").value = "0.3";
        $("qme-test-mode").value = "welch";
        $("qme-pair-mode").value = "plate";
        $("qme-row-offset").value = "1";
        qmeRefreshOptions();
        analyzeQpcrMulti();
      }

      function downloadQpcrMultiSummaryCsv() {
        downloadCsv("qpcr_multi_gene_summary.csv", qmeLastSummaryCsv);
      }

      function downloadQpcrMultiPrismCsv() {
        downloadCsv("qpcr_multi_gene_prism.csv", qmeLastPrismCsv);
      }

      function calculateBCA() {
        ["bca-slope", "bca-intercept", "bca-blanks", "bca-samples"].forEach((id) => clearFieldWarning($(id)));
        const slope = getNumber("bca-slope");
        const intercept = getNumber("bca-intercept");
        const blanks = parseNumbers($("bca-blanks").value);
        const blankMean = mean(blanks);
        const samples = parseBcaSamples($("bca-samples").value);
        const issues = [];

        if (!isFinite(slope)) issues.push({ id: "bca-slope", label: "标准曲线斜率", message: "请输入有效数字。" });
        else if (slope === 0) issues.push({ id: "bca-slope", label: "标准曲线斜率", message: "斜率不能为 0。" });
        if (!isFinite(intercept)) issues.push({ id: "bca-intercept", label: "标准曲线截距", message: "请输入有效数字。" });
        if (!blanks.length || !isFinite(blankMean)) issues.push({ id: "bca-blanks", label: "空孔 OD", message: "至少输入 1 个有效空孔 OD。" });
        if (!samples.length) issues.push({ id: "bca-samples", label: "样本信息", message: "至少输入 1 行样本：样本名, 稀释倍数, OD1, OD2。" });

        if (issues.length) {
          setResult("bca-result", `<p class="result-title">BCA 参数不完整</p>${inputIssueHtml(issues)}`, "danger");
          return { ok: false, rows: [] };
        }

        let hasWarn = false;
        const rows = samples.map((sample) => {
          const rawMean = mean(sample.ods);
          const rawCv = cvPercent(sample.ods);
          const correctedOd = rawMean - blankMean;
          const dilutedConc = (correctedOd - intercept) / slope;
          const originalConc = dilutedConc * sample.dilution;
          let status = "可用";

          if (!isFinite(sample.dilution) || sample.dilution <= 0) {
            status = "稀释倍数无效";
            hasWarn = true;
          } else if (!sample.ods.length) {
            status = "缺少OD";
            hasWarn = true;
          } else if (!isFinite(dilutedConc) || dilutedConc < 0) {
            status = "浓度为负或无法计算";
            hasWarn = true;
          } else if (rawCv > 10) {
            status = "复孔CV%大于10%，建议检查";
            hasWarn = true;
          }

          return {
            name: sample.name,
            dilution: sample.dilution,
            n: sample.ods.length,
            rawMean,
            rawCv,
            correctedOd,
            dilutedConc,
            originalConc,
            status
          };
        });

        const tableRows = rows.map((row) => [
          escapeHtml(row.name),
          fmtInt(row.n),
          fmtFixed(row.dilution, 3),
          fmtFixed(row.rawMean, 4),
          fmtFixed(row.rawCv, 2),
          fmtFixed(row.correctedOd, 4),
          fmtFixed(row.dilutedConc, 4),
          fmtFixed(row.originalConc, 4),
          escapeHtml(row.status)
        ]);

        const html = `
          <p class="result-title">BCA 计算结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(blankMean, 4)}</strong><span>平均空孔 OD</span></div>
            <div class="metric"><strong>y = ${fmt(slope, 4)}x + ${fmt(intercept, 4)}</strong><span>当前标准曲线</span></div>
          </div>
          ${table(["样本", "复孔数", "稀释倍数", "平均OD", "CV%", "扣空孔后OD", "稀释后浓度 µg/µL", "原液浓度 µg/µL", "判断"], tableRows)}
        `;

        setResult("bca-result", html, hasWarn ? "warn" : "ok");
        return { ok: !hasWarn, rows };
      }

      function calculateWB(bcaRows) {
        ["wb-final-lane-vol", "wb-loading-x", "bca-ripa-volume", "wb-boil-lysate-volume", "bca-assay-volume", "wb-target-protein"].forEach((id) => clearFieldWarning($(id)));
        const finalLaneVol = getNumber("wb-final-lane-vol");
        const loadingX = getNumber("wb-loading-x");
        const ripaVolume = getNumber("bca-ripa-volume");
        const boilLysateVolume = getNumber("wb-boil-lysate-volume");
        const bcaAssayVolume = getNumber("bca-assay-volume");
        const targetText = $("wb-target-protein").value.trim();
        const targetProtein = targetText === "" ? NaN : parseFloat(targetText);
        const validRows = bcaRows.filter((row) => isFinite(row.originalConc) && row.originalConc > 0);
        const issues = [];

        if (!validRows.length) issues.push({ id: "bca-samples", label: "BCA 可用浓度", message: "先完成 BCA 计算，并至少得到 1 个正值蛋白浓度。" });
        if (!isFinite(finalLaneVol) || finalLaneVol <= 0) issues.push({ id: "wb-final-lane-vol", label: "每泳道最终体积", message: "必须大于 0 µL。" });
        if (!isFinite(loadingX) || loadingX <= 1) issues.push({ id: "wb-loading-x", label: "Loading buffer 倍数", message: "必须大于 1，例如 5× 填 5。" });
        if (!isFinite(ripaVolume) || ripaVolume <= 0) issues.push({ id: "bca-ripa-volume", label: "RIPA 总体积", message: "必须大于 0 µL。" });
        if (!isFinite(boilLysateVolume) || boilLysateVolume <= 0) issues.push({ id: "wb-boil-lysate-volume", label: "煮蛋白取样量", message: "必须大于 0 µL。" });
        if (!isFinite(bcaAssayVolume) || bcaAssayVolume < 0) issues.push({ id: "bca-assay-volume", label: "BCA 取样量", message: "不能为负数；不预留可填 0。" });
        if (targetText !== "" && (!isFinite(targetProtein) || targetProtein <= 0)) issues.push({ id: "wb-target-protein", label: "指定上样蛋白量", message: "留空表示自动计算；填写时必须大于 0 µg。" });

        if (issues.length) {
          setResult("wb-result", `<p class="result-title">裂解或 WB 参数不完整</p>${inputIssueHtml(issues)}`, "danger");
          return false;
        }

        const allocatedLysateVolume = boilLysateVolume + bcaAssayVolume;
        const remainingLysateVolume = ripaVolume - allocatedLysateVolume;
        if (remainingLysateVolume < -1e-9) {
          const allocationIssues = [
            { id: "bca-ripa-volume", label: "RIPA 总体积", message: "当前小于煮蛋白和 BCA 分配量之和。" },
            { id: "wb-boil-lysate-volume", label: "煮蛋白取样量", message: "可减少该体积，或增加 RIPA 总量。" },
            { id: "bca-assay-volume", label: "BCA 取样量", message: "可减少该体积，或增加 RIPA 总量。" }
          ];
          setResult("wb-result", `<p class="result-title">样本分配体积超过 RIPA 裂解液总量。</p><div class="notice warn">煮蛋白与 BCA 共需 ${fmt(allocatedLysateVolume, 3)} µL，但每个样本只有 ${fmt(ripaVolume, 3)} µL 裂解液，请减少分配体积或增加 RIPA。</div>${inputIssueHtml(allocationIssues)}`, "danger");
          return false;
        }

        const proteinFractionAfterBoil = (loadingX - 1) / loadingX;
        const loadingStockVolume = boilLysateVolume / (loadingX - 1);
        const boiledTotalVolume = boilLysateVolume + loadingStockVolume;
        const enrichedRows = bcaRows.map((row) => ({
          ...row,
          boiledConc: row.originalConc * proteinFractionAfterBoil
        })).filter((row) => isFinite(row.boiledConc) && row.boiledConc > 0);

        const availableBoiledVolumePerLane = Math.min(finalLaneVol, boiledTotalVolume);
        const autoProtein = Math.min(...enrichedRows.map((row) => row.boiledConc * availableBoiledVolumePerLane));
        const useProtein = isFinite(targetProtein) && targetProtein > 0 ? targetProtein : autoProtein;
        const mode = isFinite(targetProtein) && targetProtein > 0 ? "指定蛋白量模式" : "自动最大统一蛋白量模式";
        let hasWarn = false;

        const rows = bcaRows.map((row) => {
          const boiledConc = row.originalConc * proteinFractionAfterBoil;
          let boiledSampleVol = NaN;
          let loading1xVol = NaN;
          let maxLanes = NaN;
          let status = "可上样";

          if (!isFinite(boiledConc) || boiledConc <= 0) {
            status = "无可用浓度";
            hasWarn = true;
          } else {
            boiledSampleVol = useProtein / boiledConc;
            loading1xVol = finalLaneVol - boiledSampleVol;
            maxLanes = boiledSampleVol > 0 ? Math.floor((boiledTotalVolume + 1e-9) / boiledSampleVol) : NaN;
            if (boiledSampleVol > finalLaneVol + 1e-9) {
              status = "已煮样体积超过最终上样体积，需降低蛋白量或浓缩样本。";
              hasWarn = true;
            } else if (boiledSampleVol > boiledTotalVolume + 1e-9) {
              status = "本次煮样总量不足 1 个泳道，需增加煮蛋白取样量或降低蛋白量。";
              hasWarn = true;
            } else if (loading1xVol < -1e-9) {
              status = "1× loading补足体积为负，需降低蛋白量或浓缩样本。";
              hasWarn = true;
            }
          }

          return [
            escapeHtml(row.name),
            fmtFixed(row.originalConc, 4),
            fmtFixed(boiledConc, 4),
            fmt(useProtein, 3),
            fmtFixed(boiledSampleVol, 3),
            fmtFixed(loading1xVol, 3),
            fmt(finalLaneVol, 3),
            isFinite(maxLanes) ? fmtInt(maxLanes) : "—",
            escapeHtml(status)
          ];
        });

        let html = `
          <p class="result-title">已煮样 WB 上样量计算结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(useProtein, 3)} µg</strong><span>统一每泳道蛋白量</span></div>
            <div class="metric"><strong>${fmt(finalLaneVol, 3)} µL</strong><span>每泳道最终体积</span></div>
            <div class="metric"><strong>${fmt(ripaVolume, 3)} µL</strong><span>每样本 RIPA 总量</span></div>
            <div class="metric"><strong>${fmt(boilLysateVolume, 3)} µL</strong><span>取去煮蛋白</span></div>
            <div class="metric"><strong>${fmt(bcaAssayVolume, 3)} µL</strong><span>取去做 BCA</span></div>
            <div class="metric"><strong>${fmt(Math.max(0, remainingLysateVolume), 3)} µL</strong><span>分配后剩余裂解液</span></div>
            <div class="metric"><strong>${fmt(loadingStockVolume, 3)} µL</strong><span>应加 ${fmt(loadingX, 2)}× Loading buffer</span></div>
            <div class="metric"><strong>${fmt(boiledTotalVolume, 3)} µL</strong><span>煮样后总体积</span></div>
          </div>
          <div class="small">模式：${escapeHtml(mode)}。如果指定蛋白量留空，统一蛋白量由最稀的已煮样决定。</div>
          ${table(["样本", "原液浓度 µg/µL", "已煮样浓度 µg/µL", "统一蛋白量 µg", "取已煮样体积 µL", "1× loading补足 µL", "最终体积 µL", "最多泳道数", "判断"], rows)}
        `;

        if (isFinite(targetProtein) && targetProtein > autoProtein + 1e-9) {
          html += `<div class="notice warn"><strong>提醒：</strong>你指定的 ${fmt(targetProtein, 3)} µg 高于当前所有已煮样都能满足的自动最大统一蛋白量 ${fmt(autoProtein, 3)} µg，表格中已标出需要调整的样本。</div>`;
          hasWarn = true;
        }

        html += `
          <div class="notice ok">
            <strong>建议记录：</strong>
            每样本加入 RIPA ${fmt(ripaVolume, 3)} µL；取 ${fmt(boilLysateVolume, 3)} µL 裂解液并加入 ${fmt(loadingStockVolume, 3)} µL 的 ${fmt(loadingX, 2)}× Loading buffer 煮样；预留 ${fmt(bcaAssayVolume, 3)} µL 做 BCA；统一蛋白量 ${fmt(useProtein, 3)} µg/lane。
          </div>
        `;

        setResult("wb-result", html, hasWarn ? "warn" : "ok");
        return true;
      }

      function calculateBcaAll() {
        const bca = calculateBCA();
        calculateWB(bca.rows || []);
      }

      function fillBcaExample() {
        $("bca-slope").value = "2.0352";
        $("bca-intercept").value = "-0.4435";
        $("bca-blanks").value = "0.050, 0.052, 0.051";
        $("bca-samples").value = "Sample_1, 10, 0.850, 0.862, 0.855\nSample_2, 10, 0.730, 0.742, 0.736\nSample_3, 5, 0.910, 0.918, 0.906";
        $("bca-ripa-volume").value = "100";
        $("wb-boil-lysate-volume").value = "80";
        $("bca-assay-volume").value = "10";
        $("wb-final-lane-vol").value = "20";
        $("wb-loading-x").value = "5";
        $("wb-target-protein").value = "";
        calculateBcaAll();
      }

      function wbgRoiStatus(message, tone = "ok") {
        const box = $("wbg-roi-status");
        if (!box) return;
        box.className = "notice " + tone;
        box.innerHTML = message;
      }

      function wbgRoiKindLabel(kind) {
        return {
          target: "目的条带",
          ref: "内参条带",
          "target-bg": "目的背景",
          "ref-bg": "内参背景"
        }[kind] || kind;
      }

      function wbgRoiShortLabel(kind) {
        return {
          target: "T",
          ref: "R",
          "target-bg": "T-bg",
          "ref-bg": "R-bg"
        }[kind] || kind;
      }

      function wbgRoiColor(kind) {
        if (kind === "target") return "#08766d";
        if (kind === "ref") return "#d97706";
        return "#6b7280";
      }

      function wbgRoiSignalClass(kind) {
        if (kind === "target") return "roi-kind-target";
        if (kind === "ref") return "roi-kind-ref";
        return "roi-kind-bg";
      }

      function wbgRoiCanvasPoint(event) {
        const canvas = $("wbg-roi-canvas");
        const rect = canvas.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(canvas.width, (event.clientX - rect.left) * canvas.width / rect.width)),
          y: Math.max(0, Math.min(canvas.height, (event.clientY - rect.top) * canvas.height / rect.height))
        };
      }

      function wbgRoiNormalizeRect(a, b) {
        const x = Math.round(Math.min(a.x, b.x));
        const y = Math.round(Math.min(a.y, b.y));
        const w = Math.round(Math.abs(a.x - b.x));
        const h = Math.round(Math.abs(a.y - b.y));
        return { x, y, w, h };
      }

      function wbgRoiSignal(gray, mode) {
        return mode === "raw" ? gray : 255 - gray;
      }

      function wbgRoiStats(rect, mode) {
        if (!wbgRoiImageData || rect.w <= 0 || rect.h <= 0) return null;
        const data = wbgRoiImageData.data;
        const imgW = wbgRoiImageData.width;
        const x0 = Math.max(0, Math.min(wbgRoiImageData.width - 1, rect.x));
        const y0 = Math.max(0, Math.min(wbgRoiImageData.height - 1, rect.y));
        const x1 = Math.max(x0 + 1, Math.min(wbgRoiImageData.width, rect.x + rect.w));
        const y1 = Math.max(y0 + 1, Math.min(wbgRoiImageData.height, rect.y + rect.h));
        let graySum = 0;
        let signalSum = 0;
        let area = 0;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const offset = (y * imgW + x) * 4;
            const gray = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
            graySum += gray;
            signalSum += wbgRoiSignal(gray, mode);
            area += 1;
          }
        }
        return {
          area,
          meanGray: area ? graySum / area : NaN,
          meanSignal: area ? signalSum / area : NaN,
          integrated: signalSum
        };
      }

      function wbgRoiBackgroundFor(item) {
        const bgKind = item.kind === "target" ? "target-bg" : item.kind === "ref" ? "ref-bg" : "";
        if (!bgKind) return null;
        const matches = wbgRoiItems.filter((roi) => roi.kind === bgKind && roi.group === item.group && roi.lane === item.lane && roi.mode === item.mode && roi.stats);
        if (!matches.length) return null;
        const area = matches.reduce((sum, roi) => sum + roi.stats.area, 0);
        const signal = matches.reduce((sum, roi) => sum + roi.stats.meanSignal * roi.stats.area, 0);
        return area > 0 ? { meanSignal: signal / area, count: matches.length } : null;
      }

      function wbgRoiCorrectedSignal(item) {
        if (!item.stats) return NaN;
        if (item.kind !== "target" && item.kind !== "ref") return NaN;
        const bg = wbgRoiBackgroundFor(item);
        return item.stats.integrated - (bg ? bg.meanSignal * item.stats.area : 0);
      }

      function wbgRoiDraw() {
        const canvas = $("wbg-roi-canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (wbgRoiSource) {
          ctx.drawImage(wbgRoiSource, 0, 0, canvas.width, canvas.height);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.65)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        wbgRoiItems.forEach((item, index) => {
          const color = wbgRoiColor(item.kind);
          ctx.save();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(2, canvas.width / 600);
          ctx.setLineDash(item.kind.includes("bg") ? [8, 5] : []);
          ctx.strokeRect(item.rect.x + 0.5, item.rect.y + 0.5, item.rect.w, item.rect.h);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.16;
          ctx.fillRect(item.rect.x, item.rect.y, item.rect.w, item.rect.h);
          ctx.globalAlpha = 0.92;
          const label = `${index + 1} ${wbgRoiShortLabel(item.kind)} ${item.group}/${item.lane}`;
          ctx.font = `${Math.max(12, Math.round(canvas.width / 70))}px Arial`;
          const labelW = ctx.measureText(label).width + 8;
          const labelY = Math.max(18, item.rect.y - 4);
          ctx.fillRect(item.rect.x, labelY - 16, labelW, 18);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, item.rect.x + 4, labelY - 3);
          ctx.restore();
        });
        if (wbgRoiDrag) {
          const rect = wbgRoiNormalizeRect(wbgRoiDrag.start, wbgRoiDrag.current);
          ctx.save();
          ctx.strokeStyle = wbgRoiColor(wbgRoiDrag.kind);
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
          ctx.restore();
        }
      }

      function wbgRoiRenderResult() {
        if (!wbgRoiItems.length) {
          const box = $("wbg-roi-result");
          if (box) {
            box.className = "result";
            box.innerHTML = "";
            box.style.display = "none";
          }
          wbgRoiStatus("已经清空框选。上传图片后拖框选择条带。", "ok");
          return;
        }
        const rows = wbgRoiItems.map((item, index) => {
          const bg = wbgRoiBackgroundFor(item);
          const corrected = wbgRoiCorrectedSignal(item);
          return [
            fmtInt(index + 1),
            escapeHtml(item.group),
            escapeHtml(item.lane),
            `<span class="${wbgRoiSignalClass(item.kind)}">${escapeHtml(wbgRoiKindLabel(item.kind))}</span>`,
            `${fmtInt(item.rect.x)}, ${fmtInt(item.rect.y)}, ${fmtInt(item.rect.w)}×${fmtInt(item.rect.h)}`,
            fmtInt(item.stats.area),
            fmt(item.stats.meanGray, 2),
            fmt(item.stats.integrated, 1),
            isFinite(corrected) ? fmt(corrected, 1) : "—",
            bg ? `已扣 ${bg.count} 个背景框` : (item.kind === "target" || item.kind === "ref" ? "未扣背景" : "背景框")
          ];
        });
        const bandCount = wbgRoiItems.filter((item) => item.kind === "target" || item.kind === "ref").length;
        setResult("wbg-roi-result", `
          <p class="result-title">WB 图片灰度读取结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmtInt(wbgRoiItems.length)}</strong><span>ROI 框总数</span></div>
            <div class="metric"><strong>${fmtInt(bandCount)}</strong><span>条带框数</span></div>
            <div class="metric"><strong>${$("wbg-roi-mode").value === "dark" ? "暗带积分" : "原始灰度"}</strong><span>当前算法</span></div>
          </div>
          ${table(["#", "组名", "泳道", "类型", "x,y,w×h", "面积", "平均灰度", "积分灰度", "扣背景积分", "背景状态"], rows)}
          <div class="notice ok"><strong>说明：</strong>暗带信号按 sum(255 - gray) 计算；扣背景积分 = 条带积分 - 背景平均信号 × 条带面积。</div>
        `, "ok");
        wbgRoiStatus(`已读取 ${fmtInt(wbgRoiItems.length)} 个 ROI。可继续框选，或点击“生成到灰度表”。`, "ok");
      }

      function wbgRoiAddRect(rect) {
        if (!wbgRoiImageData) {
          wbgRoiStatus("请先上传 WB 图片。", "warn");
          return;
        }
        if (rect.w < 3 || rect.h < 3) {
          wbgRoiStatus("框选区域太小，请重新拖拽一个覆盖条带的矩形。", "warn");
          return;
        }
        const mode = $("wbg-roi-mode").value || "dark";
        const stats = wbgRoiStats(rect, mode);
        if (!stats || !stats.area) {
          wbgRoiStatus("无法读取这个区域的像素，请重新框选。", "danger");
          return;
        }
        const item = {
          group: $("wbg-roi-group").value.trim() || "Group_1",
          lane: $("wbg-roi-lane").value.trim() || String(wbgRoiItems.length + 1),
          kind: $("wbg-roi-kind").value,
          mode,
          rect,
          stats
        };
        wbgRoiItems.push(item);
        wbgRoiDraw();
        wbgRoiRenderResult();
      }

      function wbgTiffTypeSize(type) {
        return { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] || 0;
      }

      function wbgTiffReadValues(view, little, entryOffset) {
        const type = view.getUint16(entryOffset + 2, little);
        const count = view.getUint32(entryOffset + 4, little);
        const size = wbgTiffTypeSize(type);
        const valueBytes = size * count;
        const valueOffset = valueBytes <= 4 ? entryOffset + 8 : view.getUint32(entryOffset + 8, little);
        const values = [];
        for (let i = 0; i < count; i += 1) {
          const offset = valueOffset + i * size;
          if (type === 1 || type === 2) values.push(view.getUint8(offset));
          else if (type === 3) values.push(view.getUint16(offset, little));
          else if (type === 4) values.push(view.getUint32(offset, little));
          else if (type === 5) {
            const num = view.getUint32(offset, little);
            const den = view.getUint32(offset + 4, little);
            values.push(den ? num / den : NaN);
          }
        }
        return count === 1 ? values[0] : values;
      }

      function wbgDecodeTiff(arrayBuffer) {
        const view = new DataView(arrayBuffer);
        const byteOrder = String.fromCharCode(view.getUint8(0), view.getUint8(1));
        const little = byteOrder === "II";
        if (!little && byteOrder !== "MM") throw new Error("不是标准 TIFF 字节序。");
        if (view.getUint16(2, little) !== 42) throw new Error("不是可识别的 TIFF 文件。");
        const ifdOffset = view.getUint32(4, little);
        const tagCount = view.getUint16(ifdOffset, little);
        const tags = new Map();
        for (let i = 0; i < tagCount; i += 1) {
          const entryOffset = ifdOffset + 2 + i * 12;
          tags.set(view.getUint16(entryOffset, little), wbgTiffReadValues(view, little, entryOffset));
        }
        const width = tags.get(256);
        const height = tags.get(257);
        const bits = Array.isArray(tags.get(258)) ? tags.get(258) : [tags.get(258) || 8];
        const compression = tags.get(259) || 1;
        const photometric = tags.get(262);
        const stripOffsets = Array.isArray(tags.get(273)) ? tags.get(273) : [tags.get(273)];
        const stripByteCounts = Array.isArray(tags.get(279)) ? tags.get(279) : [tags.get(279)];
        const samplesPerPixel = tags.get(277) || 1;
        if (!width || !height) throw new Error("TIFF 缺少宽高信息。");
        if (compression !== 1) throw new Error("当前网页只支持未压缩 TIFF；请导出 PNG/JPG 或未压缩 8-bit TIFF。");
        if (!bits.every((bit) => bit === 8)) throw new Error("当前网页只支持 8-bit TIFF；请先导出为 8-bit 灰度或 PNG。");
        if (![1, 3, 4].includes(samplesPerPixel)) throw new Error("当前网页只支持灰度、RGB 或 RGBA TIFF。");
        const rgba = new Uint8ClampedArray(width * height * 4);
        let pixelIndex = 0;
        stripOffsets.forEach((stripOffset, stripIndex) => {
          const byteCount = stripByteCounts[stripIndex] || 0;
          for (let offset = stripOffset; offset < stripOffset + byteCount && pixelIndex < width * height; offset += samplesPerPixel) {
            let r;
            let g;
            let b;
            if (samplesPerPixel === 1) {
              const sample = view.getUint8(offset);
              const gray = photometric === 0 ? 255 - sample : sample;
              r = gray;
              g = gray;
              b = gray;
            } else {
              r = view.getUint8(offset);
              g = view.getUint8(offset + 1);
              b = view.getUint8(offset + 2);
            }
            const out = pixelIndex * 4;
            rgba[out] = r;
            rgba[out + 1] = g;
            rgba[out + 2] = b;
            rgba[out + 3] = 255;
            pixelIndex += 1;
          }
        });
        if (pixelIndex < width * height) throw new Error("TIFF 像素数据不完整。");
        return new ImageData(rgba, width, height);
      }

      function wbgUseImageData(imageData, fileName) {
        const canvas = $("wbg-roi-canvas");
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const source = document.createElement("canvas");
        source.width = imageData.width;
        source.height = imageData.height;
        source.getContext("2d").putImageData(imageData, 0, 0);
        wbgRoiImage = null;
        wbgRoiSource = source;
        wbgRoiImageData = imageData;
        $("wbg-roi-stage").classList.add("has-image");
        wbgRoiItems = [];
        wbgRoiDrag = null;
        wbgRoiDraw();
        wbgRoiRenderResult();
        wbgRoiStatus(`已载入 ${escapeHtml(fileName)}，尺寸 ${fmtInt(canvas.width)} × ${fmtInt(canvas.height)} px。现在可以拖框选条带。`, "ok");
      }

      async function wbgRoiLoadImage() {
        const file = $("wbg-image-file").files && $("wbg-image-file").files[0];
        if (!file) return;
        try {
          if (/\.tiff?$/i.test(file.name)) {
            const imageData = wbgDecodeTiff(await file.arrayBuffer());
            wbgUseImageData(imageData, file.name);
            return;
          }
          const url = URL.createObjectURL(file);
          const image = new Image();
          image.onload = () => {
            URL.revokeObjectURL(url);
            wbgRoiImage = image;
            wbgRoiSource = image;
            const canvas = $("wbg-roi-canvas");
            canvas.width = image.naturalWidth || image.width;
            canvas.height = image.naturalHeight || image.height;
            $("wbg-roi-stage").classList.add("has-image");
            wbgRoiItems = [];
            wbgRoiDrag = null;
            wbgRoiDraw();
            wbgRoiImageData = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
            wbgRoiRenderResult();
            wbgRoiStatus(`已载入 ${escapeHtml(file.name)}，尺寸 ${fmtInt(canvas.width)} × ${fmtInt(canvas.height)} px。现在可以拖框选条带。`, "ok");
          };
          image.onerror = () => {
            URL.revokeObjectURL(url);
            wbgRoiStatus("图片读取失败，请换一张 PNG/JPG/JPEG，或未压缩 8-bit TIFF。", "danger");
          };
          image.src = url;
        } catch (error) {
          wbgRoiStatus(`图片读取失败：${escapeHtml(error.message)}`, "danger");
        }
      }

      function wbgRoiPointerDown(event) {
        if (!wbgRoiImageData) {
          wbgRoiStatus("请先上传 WB 图片。", "warn");
          return;
        }
        event.preventDefault();
        const start = wbgRoiCanvasPoint(event);
        wbgRoiDrag = {
          start,
          current: start,
          kind: $("wbg-roi-kind").value
        };
        $("wbg-roi-canvas").setPointerCapture?.(event.pointerId);
        wbgRoiDraw();
      }

      function wbgRoiPointerMove(event) {
        if (!wbgRoiDrag) return;
        event.preventDefault();
        wbgRoiDrag.current = wbgRoiCanvasPoint(event);
        wbgRoiDraw();
      }

      function wbgRoiPointerUp(event) {
        if (!wbgRoiDrag) return;
        event.preventDefault();
        wbgRoiDrag.current = wbgRoiCanvasPoint(event);
        const rect = wbgRoiNormalizeRect(wbgRoiDrag.start, wbgRoiDrag.current);
        wbgRoiDrag = null;
        wbgRoiAddRect(rect);
      }

      function wbgRoiUndo() {
        wbgRoiItems.pop();
        wbgRoiDraw();
        wbgRoiRenderResult();
      }

      function wbgRoiClear() {
        wbgRoiItems = [];
        wbgRoiDrag = null;
        wbgRoiDraw();
        wbgRoiRenderResult();
      }

      function wbgRoiGeneratedRows() {
        const map = new Map();
        wbgRoiItems.forEach((item) => {
          if (item.kind !== "target" && item.kind !== "ref") return;
          const key = `${item.group}\u0001${item.lane}`;
          if (!map.has(key)) map.set(key, { group: item.group, lane: item.lane, target: 0, ref: 0, targetN: 0, refN: 0 });
          const entry = map.get(key);
          const corrected = wbgRoiCorrectedSignal(item);
          if (!isFinite(corrected)) return;
          if (item.kind === "target") {
            entry.target += corrected;
            entry.targetN += 1;
          } else {
            entry.ref += corrected;
            entry.refN += 1;
          }
        });
        return Array.from(map.values()).filter((entry) => entry.targetN > 0 && entry.refN > 0 && entry.target > 0 && entry.ref > 0);
      }

      function wbgRoiToTable() {
        const rows = wbgRoiGeneratedRows();
        if (!rows.length) {
          wbgRoiStatus("还没有成对的目的条带和内参条带。请至少为同一组名/泳道各框选一个目的条带和一个内参条带。", "warn");
          return false;
        }
        $("wbg-data").value = rows.map((row) => `${row.group}, ${row.lane}, ${fmtData(row.target, 3)}, ${fmtData(row.ref, 3)}`).join("\n");
        $("wbg-bg-target").value = "0";
        $("wbg-bg-ref").value = "0";
        wbgRoiStatus(`已生成 ${fmtInt(rows.length)} 行到灰度表，并自动运行 WB 灰度分析。`, "ok");
        calculateWbGray();
        return true;
      }

      function parseWbGrayRows(text) {
        return splitLines(text).map((line, index) => {
          const parts = line.split(/[,，\t]+/).map((part) => part.trim()).filter(Boolean);
          if (parts.length < 4) return null;
          return {
            group: parts[0],
            lane: parts[1] || String(index + 1),
            target: parseFloat(parts[2]),
            ref: parseFloat(parts[3]),
            raw: line
          };
        }).filter((row) => row && row.group && isFinite(row.target) && isFinite(row.ref));
      }

      function wbgGroupRows(rows) {
        const map = new Map();
        rows.forEach((row) => {
          if (!map.has(row.group)) map.set(row.group, []);
          map.get(row.group).push(row);
        });
        return Array.from(map.entries()).map(([group, entries]) => ({ group, entries }));
      }

      function wbgBuildCsv(groups) {
        const maxN = Math.max(...groups.map((group) => group.relativeValues.length), 1);
        const rows = [
          ["Prism column data"],
          groups.map((group) => group.group),
          ...Array.from({ length: maxN }, (_, index) => groups.map((group) => isFinite(group.relativeValues[index]) ? group.relativeValues[index] : "")),
          [],
          ["Summary"],
          ["Group", "n", "Normalized mean", "Relative mean", "SD", "SEM", "P value", "Stars"]
        ];
        groups.forEach((group) => rows.push([
          group.group,
          group.relativeValues.length,
          fmt(group.normalizedMean, 6),
          fmt(group.relativeMean, 6),
          fmt(group.relativeSd, 6),
          fmt(group.relativeSem, 6),
          isFinite(group.pValue) ? group.pValue : "",
          group.pStars
        ]));
        return rowsToCsv(rows);
      }

      function drawWbGrayChart(groups, targetName, refName) {
        const box = $("wbg-chart-box");
        const canvas = $("wbg-chart");
        const ctx = canvas.getContext("2d");
        box.style.display = "block";
        box.className = "result ok";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const pad = { l: 72, r: 28, t: 42, b: 86 };
        const w = canvas.width - pad.l - pad.r;
        const h = canvas.height - pad.t - pad.b;
        const maxY = Math.max(1.2, ...groups.map((group) => group.relativeMean + group.relativeSem)) * 1.25;
        ctx.strokeStyle = "#cfd8d6";
        ctx.lineWidth = 1;
        ctx.fillStyle = "#607177";
        ctx.font = "14px Arial";
        ctx.textAlign = "left";
        for (let i = 0; i <= 5; i += 1) {
          const yVal = maxY * i / 5;
          const y = pad.t + h - yVal / maxY * h;
          ctx.beginPath();
          ctx.moveTo(pad.l, y);
          ctx.lineTo(pad.l + w, y);
          ctx.stroke();
          ctx.fillText(fmt(yVal, 2), 18, y + 4);
        }
        ctx.strokeStyle = "#172326";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pad.l, pad.t);
        ctx.lineTo(pad.l, pad.t + h);
        ctx.lineTo(pad.l + w, pad.t + h);
        ctx.stroke();
        const gap = w / Math.max(groups.length, 1);
        const barW = Math.min(74, gap * 0.5);
        groups.forEach((group, index) => {
          const x = pad.l + gap * index + gap / 2;
          const barH = group.relativeMean / maxY * h;
          const y = pad.t + h - barH;
          ctx.fillStyle = index === 0 ? "#08766d" : "#d99022";
          ctx.fillRect(x - barW / 2, y, barW, barH);
          const err = group.relativeSem / maxY * h;
          ctx.strokeStyle = "#172326";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x, y - err);
          ctx.lineTo(x, y + err);
          ctx.moveTo(x - 12, y - err);
          ctx.lineTo(x + 12, y - err);
          ctx.stroke();
          ctx.fillStyle = "#172326";
          group.relativeValues.forEach((value, repIndex) => {
            const jitter = (repIndex - (group.relativeValues.length - 1) / 2) * Math.min(9, barW / 6);
            ctx.beginPath();
            ctx.arc(x + jitter, pad.t + h - value / maxY * h, 3.5, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.save();
          ctx.translate(x, pad.t + h + 24);
          ctx.rotate(-Math.PI / 7);
          ctx.textAlign = "right";
          ctx.font = "14px Arial";
          ctx.fillText(group.group, 0, 0);
          ctx.restore();
          ctx.textAlign = "center";
          ctx.font = "13px Arial";
          ctx.fillText(group.pStars, x, Math.max(18, y - err - 14));
        });
        ctx.textAlign = "center";
        ctx.font = "700 18px Arial";
        ctx.fillStyle = "#172326";
        ctx.fillText(`${targetName} / ${refName} 相对灰度`, canvas.width / 2, 24);
        ctx.save();
        ctx.translate(20, canvas.height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.font = "14px Arial";
        ctx.fillText("Relative expression", 0, 0);
        ctx.restore();
      }

      function calculateWbGray() {
        try {
          const rows = parseWbGrayRows($("wbg-data").value);
          const targetBg = parseFloat($("wbg-bg-target").value) || 0;
          const refBg = parseFloat($("wbg-bg-ref").value) || 0;
          const controlName = $("wbg-control-group").value.trim();
          const testMode = $("wbg-test-mode").value;
          const targetName = $("wbg-target-name").value.trim() || "Target";
          const refName = $("wbg-ref-name").value.trim() || "Reference";
          if (!rows.length) throw new Error("没有可用 WB 灰度数据。");
          const processed = rows.map((row) => {
            const target = row.target - targetBg;
            const ref = row.ref - refBg;
            return {
              ...row,
              correctedTarget: target,
              correctedRef: ref,
              normalized: ref > 0 ? target / ref : NaN
            };
          }).filter((row) => isFinite(row.normalized) && row.normalized > 0);
          if (!processed.length) throw new Error("扣背景后没有有效的目的/内参比值。");
          const groupedRaw = wbgGroupRows(processed);
          const control = groupedRaw.find((group) => qpaNorm(group.group) === qpaNorm(controlName));
          if (!control) throw new Error("没有找到对照组，请检查对照组名称。");
          const controlMean = mean(control.entries.map((entry) => entry.normalized));
          if (!isFinite(controlMean) || controlMean <= 0) throw new Error("对照组归一化均值无效。");
          const controlRelativeValues = control.entries.map((entry) => entry.normalized / controlMean);
          const groups = groupedRaw.map((group) => {
            const normalizedValues = group.entries.map((entry) => entry.normalized);
            const relativeValues = normalizedValues.map((value) => value / controlMean);
            const p = qpaNorm(group.group) === qpaNorm(controlName) ? { p: 1 } : qpaTTest(relativeValues, controlRelativeValues, testMode);
            return {
              group: group.group,
              entries: group.entries,
              normalizedValues,
              relativeValues,
              normalizedMean: mean(normalizedValues),
              normalizedSd: sd(normalizedValues),
              relativeMean: mean(relativeValues),
              relativeSd: sd(relativeValues),
              relativeSem: qpaSem(relativeValues),
              pValue: p.p,
              pStars: qpaPStars(p.p)
            };
          });
          const tableRows = groups.map((group) => [
            escapeHtml(group.group),
            fmtInt(group.relativeValues.length),
            fmt(group.normalizedMean, 4),
            fmt(group.normalizedSd, 4),
            fmt(group.relativeMean, 4),
            fmt(group.relativeSd, 4),
            fmt(group.relativeSem, 4),
            isFinite(group.pValue) ? fmt(group.pValue, 5) : "n/a",
            escapeHtml(group.pStars)
          ]);
          wbgLastCsv = wbgBuildCsv(groups);
          $("wbg-download").disabled = !wbgLastCsv;
          setResult("wbg-result", `
            <p class="result-title">WB 灰度分析结果</p>
            <div class="metric-grid">
              <div class="metric"><strong>${fmtInt(processed.length)}</strong><span>有效泳道/重复</span></div>
              <div class="metric"><strong>${escapeHtml(controlName)}</strong><span>对照组设为 1</span></div>
              <div class="metric"><strong>${escapeHtml(targetName)}</strong><span>目的蛋白</span></div>
              <div class="metric"><strong>${escapeHtml(refName)}</strong><span>内参蛋白</span></div>
            </div>
            ${table(["组别", "n", "目的/内参均值", "目的/内参SD", "相对表达均值", "SD", "SEM", "P value", "显著性"], tableRows)}
            <div class="notice ok"><strong>QC：</strong>已完成目的/内参归一化、对照组归一化和 Prism column 数据导出。</div>
          `, "ok");
          drawWbGrayChart(groups, targetName, refName);
          return true;
        } catch (error) {
          wbgLastCsv = "";
          $("wbg-download").disabled = true;
          $("wbg-chart-box").style.display = "none";
          setResult("wbg-result", `<p class="result-title">WB 灰度分析失败</p><div class="notice danger">${escapeHtml(error.message)}</div>`, "danger");
          return false;
        }
      }

      function fillWbGrayExample() {
        $("wbg-target-name").value = "Target";
        $("wbg-ref-name").value = "ACTB / GAPDH";
        $("wbg-control-group").value = "Control";
        $("wbg-bg-target").value = "0";
        $("wbg-bg-ref").value = "0";
        $("wbg-data").value = "Control, 1, 12800, 9600\nControl, 2, 13250, 9900\nControl, 3, 12650, 9480\nTreat_1, 1, 20500, 10100\nTreat_1, 2, 19800, 9900\nTreat_1, 3, 21200, 10350\nTreat_2, 1, 8600, 9700\nTreat_2, 2, 9100, 10050\nTreat_2, 3, 8800, 9850";
        calculateWbGray();
      }

      function downloadWbGrayCsv() {
        downloadCsv("wb_density_prism.csv", wbgLastCsv);
      }

      function calculateLentivirus() {
        const totalDnaUg = getNumber("lv-total-dna");
        const transferRatio = getNumber("lv-transfer-ratio");
        const pax2Ratio = getNumber("lv-pax2-ratio");
        const md2gRatio = getNumber("lv-md2g-ratio");
        const transferConc = getNumber("lv-transfer-conc");
        const pax2Conc = getNumber("lv-pax2-conc");
        const md2gConc = getNumber("lv-md2g-conc");
        const peiPerUg = getNumber("lv-pei-per-ug");
        const optiRefDna = getNumber("lv-opti-ref-dna");
        const optiRefVol = getNumber("lv-opti-ref-vol");
        const ratioSum = transferRatio + pax2Ratio + md2gRatio;

        const invalid = !isFinite(totalDnaUg) || totalDnaUg <= 0 ||
          !isFinite(transferRatio) || transferRatio < 0 ||
          !isFinite(pax2Ratio) || pax2Ratio < 0 ||
          !isFinite(md2gRatio) || md2gRatio < 0 ||
          ratioSum <= 0 ||
          !isFinite(transferConc) || transferConc <= 0 ||
          !isFinite(pax2Conc) || pax2Conc <= 0 ||
          !isFinite(md2gConc) || md2gConc <= 0 ||
          !isFinite(peiPerUg) || peiPerUg < 0 ||
          !isFinite(optiRefDna) || optiRefDna <= 0 ||
          !isFinite(optiRefVol) || optiRefVol <= 0;

        if (invalid) {
          setResult("lv-result", "<p class=\"result-title\">慢病毒包装参数不完整，请检查总质粒量、比例、浓度、PEI 和 Opti-MEM 设置。</p>", "danger");
          return false;
        }

        const plasmids = [
          { name: "目的质粒", ratio: transferRatio, conc: transferConc },
          { name: "psPAX2", ratio: pax2Ratio, conc: pax2Conc },
          { name: "pMD2.G", ratio: md2gRatio, conc: md2gConc }
        ].map((plasmid) => {
          const massUg = totalDnaUg * plasmid.ratio / ratioSum;
          const volumeUl = massUg * 1000 / plasmid.conc;
          return { ...plasmid, massUg, volumeUl };
        });

        const totalPlasmidVol = plasmids.reduce((sum, plasmid) => sum + plasmid.volumeUl, 0);
        const peiVol = totalDnaUg * peiPerUg;
        const optiTotalVol = totalDnaUg / optiRefDna * optiRefVol;
        const optiTopUpVol = optiTotalVol - totalPlasmidVol - peiVol;
        const halfMixVol = optiTotalVol / 2;
        const dnaTubeOpti = halfMixVol - totalPlasmidVol;
        const peiTubeOpti = halfMixVol - peiVol;

        let hasWarn = false;
        const notices = [];
        if (optiTopUpVol < -1e-9) {
          hasWarn = true;
          notices.push(`当前质粒体积 + PEI 体积为 ${fmt(totalPlasmidVol + peiVol, 3)} µL，已经超过按比例换算的 Opti-MEM 总量 ${fmt(optiTotalVol, 3)} µL，请提高 Opti-MEM 体积或检查浓度/比例。`);
        }
        if (dnaTubeOpti < -1e-9 || peiTubeOpti < -1e-9) {
          hasWarn = true;
          notices.push("如果按 DNA 管和 PEI 管等体积预混，至少有一管的 Opti-MEM 补足量为负，建议改用总量补足或提高 Opti-MEM 总量。");
        }

        const plasmidRows = plasmids.map((plasmid) => [
          escapeHtml(plasmid.name),
          fmt(plasmid.ratio, 3),
          fmt(plasmid.massUg, 4),
          fmt(plasmid.conc, 3),
          fmt(plasmid.volumeUl, 3)
        ]);

        const summaryRows = [
          ["总质粒体积", `${fmt(totalPlasmidVol, 3)} µL`],
          ["PEI 体积", `${fmt(peiVol, 3)} µL`],
          ["Opti-MEM 总量", `${fmt(optiTotalVol, 3)} µL`],
          ["Opti-MEM 补足量", `${fmt(optiTopUpVol, 3)} µL`],
          ["最终混合体积", `${fmt(totalPlasmidVol + peiVol + Math.max(optiTopUpVol, 0), 3)} µL`]
        ];

        const splitRows = [
          ["DNA 管", `三种质粒合计 ${fmt(totalPlasmidVol, 3)} µL`, `${fmt(dnaTubeOpti, 3)} µL`, `${fmt(halfMixVol, 3)} µL`],
          ["PEI 管", `PEI ${fmt(peiVol, 3)} µL`, `${fmt(peiTubeOpti, 3)} µL`, `${fmt(halfMixVol, 3)} µL`]
        ];

        let html = `
          <p class="result-title">慢病毒包装配液计算结果</p>
          <div class="metric-grid">
            <div class="metric"><strong>${fmt(totalDnaUg, 3)} µg</strong><span>总质粒量</span></div>
            <div class="metric"><strong>${fmt(transferRatio, 3)}:${fmt(pax2Ratio, 3)}:${fmt(md2gRatio, 3)}</strong><span>目的质粒:psPAX2:pMD2.G</span></div>
            <div class="metric"><strong>${fmt(totalPlasmidVol, 3)} µL</strong><span>三质粒总体积</span></div>
            <div class="metric"><strong>${fmt(peiVol, 3)} µL</strong><span>PEI 体积</span></div>
            <div class="metric"><strong>${fmt(optiTotalVol, 3)} µL</strong><span>Opti-MEM 总量</span></div>
          </div>
          ${table(["质粒", "比例", "质量 µg", "浓度 ng/µL", "体积 µL"], plasmidRows)}
          <div class="section-title">总体积汇总</div>
          ${table(["项目", "结果"], summaryRows)}
          <div class="section-title">两管等体积预混参考</div>
          ${table(["管", "已有组分", "加入 Opti-MEM", "该管目标体积"], splitRows)}
        `;

        if (notices.length) {
          html += notices.map((text) => `<div class="notice warn"><strong>提醒：</strong>${escapeHtml(text)}</div>`).join("");
        } else {
          html += `<div class="notice ok"><strong>建议记录：</strong>总 DNA ${fmt(totalDnaUg, 3)} µg；三质粒比例 ${fmt(transferRatio, 3)}:${fmt(pax2Ratio, 3)}:${fmt(md2gRatio, 3)}；PEI ${fmt(peiVol, 3)} µL；Opti-MEM 总量 ${fmt(optiTotalVol, 3)} µL。</div>`;
        }

        setResult("lv-result", html, hasWarn ? "warn" : "ok");
        return true;
      }

      function fillLentivirusExample() {
        $("lv-total-dna").value = "5";
        $("lv-transfer-ratio").value = "5";
        $("lv-pax2-ratio").value = "3";
        $("lv-md2g-ratio").value = "2";
        $("lv-transfer-conc").value = "1000";
        $("lv-pax2-conc").value = "1000";
        $("lv-md2g-conc").value = "1000";
        $("lv-pei-per-ug").value = "3";
        $("lv-opti-ref-dna").value = "5";
        $("lv-opti-ref-vol").value = "400";
        calculateLentivirus();
      }

      function activateTab(name, shouldUpdateHash) {
        let activeTabButton = null;
        document.querySelectorAll(".tab-button").forEach((button) => {
          const active = button.dataset.tab === name;
          button.classList.toggle("active", active);
          button.setAttribute("aria-selected", active ? "true" : "false");
          if (active) activeTabButton = button;
        });
        document.querySelectorAll("[data-workbench-tab]").forEach((button) => {
          const active = button.dataset.workbenchTab === name;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", active ? "true" : "false");
        });
        document.querySelectorAll(".tool-panel").forEach((panel) => {
          panel.classList.toggle("active", panel.dataset.panel === name);
        });
        if (shouldUpdateHash) {
          history.replaceState(null, "", "#" + name);
          activeTabButton?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }

      function jumpToTool(name) {
        activateTab(name, true);
        const panel = $("panel-" + name);
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function bindEvents() {
        document.addEventListener("click", handleResultCopy);
        document.addEventListener("click", handleResultCollapse);
        document.addEventListener("click", handlePanelUtilityClick);
        document.addEventListener("click", handlePresetClick);

        document.querySelectorAll(".tab-button").forEach((button) => {
          button.addEventListener("click", () => activateTab(button.dataset.tab, true));
        });
        document.querySelectorAll("[data-workbench-tab]").forEach((button) => {
          button.addEventListener("click", () => jumpToTool(button.dataset.workbenchTab));
        });

        $("theme-toggle").addEventListener("click", toggleTheme);
        $("music-toggle").addEventListener("click", toggleMusic);
        $("music-file").addEventListener("change", handleMusicFile);
        $("bg-audio").addEventListener("error", () => {
          setMusicPlaying(false);
          setMusicStatus("未找到 dead-man.mp3，可选择本地音频");
        });
        $("app-install").addEventListener("click", promptAppInstall);
        $("cell-calc").addEventListener("click", calculateCell);
        $("cell-example").addEventListener("click", fillCellExample);
        $("seed-plate").addEventListener("change", handleSeedPlateChange);
        $("seed-calc").addEventListener("click", calculateSeeding);
        $("seed-example").addEventListener("click", fillSeedingExample);
        $("drug-calc").addEventListener("click", calculateDrugGradient);
        $("drug-example").addEventListener("click", fillDrugExample);
        $("va-calc").addEventListener("click", calculateViability);
        $("va-example").addEventListener("click", fillViabilityExample);
        $("va-download").addEventListener("click", downloadViabilityCsv);
        $("va-method").addEventListener("change", () => {
          vaLastCsv = "";
          $("va-download").disabled = true;
          $("va-result").className = "result";
          $("va-result").innerHTML = "";
        });
        $("va-plate-image").addEventListener("change", vaPlateHandleImage);
        $("va-plate-scan").addEventListener("click", vaPlateShowScanPreview);
        $("va-plate-ocr").addEventListener("click", vaPlateTryOcr);
        $("va-plate-parse").addEventListener("click", vaPlateParseToGrid);
        $("va-plate-clear").addEventListener("click", vaPlateClear);
        $("va-plate-grid").addEventListener("click", (event) => {
          const cell = event.target.closest(".plate-cell");
          if (cell?.dataset.well) vaPlateSelectWell(cell.dataset.well, event.ctrlKey || event.metaKey);
        });
        $("va-plate-assign").addEventListener("click", vaPlateAssignSelected);
        $("va-plate-to-viability").addEventListener("click", vaPlateToViability);
        $("va-plate-to-ic50").addEventListener("click", vaPlateToIc50);
        $("va-plate-to-elisa").addEventListener("click", vaPlateToElisa);
        $("va-plate-to-bca").addEventListener("click", vaPlateToBca);
        $("ic-calc").addEventListener("click", calculateIc50);
        $("ic-example").addEventListener("click", fillIc50Example);
        $("ic-download").addEventListener("click", downloadIc50Csv);
        $("elisa-calc").addEventListener("click", calculateElisa);
        $("elisa-example").addEventListener("click", fillElisaExample);
        $("elisa-download").addEventListener("click", downloadElisaCsv);
        flowUpdateMetricOptions();
        $("flow-mode").addEventListener("change", () => {
          flowUpdateMetricOptions();
          flowLastCsv = "";
          $("flow-download").disabled = true;
          $("flow-result").className = "result";
          $("flow-result").innerHTML = "";
          $("flow-chart-box").style.display = "none";
        });
        $("flow-calc").addEventListener("click", calculateFlow);
        $("flow-example").addEventListener("click", fillFlowExample);
        $("flow-download").addEventListener("click", downloadFlowCsv);
        $("qpcr-calc").addEventListener("click", calculateQpcrAll);
        $("qpcr-example").addEventListener("click", fillQpcrExample);
        $("mm-calc").addEventListener("click", calculateMasterMix);
        $("mm-example").addEventListener("click", fillMasterMixExample);
        $("mm-download").addEventListener("click", downloadMasterMixCsv);
        $("qpa-file").addEventListener("change", handleQpcrAnalysisFile);
        $("qpa-data").addEventListener("input", qpaScheduleSampleRefresh);
        $("qpa-control-sample").addEventListener("change", () => {
          if ($("qpa-compare-mode").value !== "custom") qpaRenderCustomBuilder(qpaCurrentSamples(), qpaDefaultComparisonPlans(qpaCurrentSamples()));
        });
        $("qpa-compare-mode").addEventListener("change", qpaUpdateCompareModeUi);
        $("qpa-add-comparison").addEventListener("click", qpaAddComparisonRow);
        $("qpa-custom-rows").addEventListener("click", qpaHandleCustomRowsClick);
        $("qpa-custom-rows").addEventListener("change", qpaHandleCustomRowsChange);
        $("qpa-analyze").addEventListener("click", analyzeQpcrData);
        $("qpa-example").addEventListener("click", fillQpcrAnalysisExample);
        $("qpa-chart-select").addEventListener("change", qpaDrawSelectedChart);
        $("qpa-download").addEventListener("click", downloadQpcrPrismCsv);
        $("qme-file").addEventListener("change", handleQpcrMultiFile);
        $("qme-data").addEventListener("input", qmeScheduleRefresh);
        $("qme-ref-genes").addEventListener("input", qmeScheduleRefresh);
        $("qme-render-plate").addEventListener("click", () => {
          qmeRefreshOptions();
          qmeRenderPlate();
        });
        $("qme-plate-grid").addEventListener("click", (event) => {
          const cell = event.target.closest(".plate-cell");
          if (cell?.dataset.well) qmeSelectWell(cell.dataset.well, event.ctrlKey || event.metaKey);
        });
        $("qme-edit-well").addEventListener("change", () => qmeSelectWell($("qme-edit-well").value));
        $("qme-apply-well").addEventListener("click", qmeApplyWellEdit);
        $("qme-clear-well").addEventListener("click", qmeClearWellEdit);
        $("qme-analyze").addEventListener("click", analyzeQpcrMulti);
        $("qme-example").addEventListener("click", fillQpcrMultiExample);
        $("qme-summary-download").addEventListener("click", downloadQpcrMultiSummaryCsv);
        $("qme-prism-download").addEventListener("click", downloadQpcrMultiPrismCsv);
        $("bca-calc").addEventListener("click", calculateBcaAll);
        $("bca-example").addEventListener("click", fillBcaExample);
        $("wbg-image-file").addEventListener("change", wbgRoiLoadImage);
        $("wbg-roi-canvas").addEventListener("pointerdown", wbgRoiPointerDown);
        $("wbg-roi-canvas").addEventListener("pointermove", wbgRoiPointerMove);
        $("wbg-roi-canvas").addEventListener("pointerup", wbgRoiPointerUp);
        $("wbg-roi-canvas").addEventListener("pointercancel", () => {
          wbgRoiDrag = null;
          wbgRoiDraw();
        });
        $("wbg-roi-undo").addEventListener("click", wbgRoiUndo);
        $("wbg-roi-clear").addEventListener("click", wbgRoiClear);
        $("wbg-roi-to-table").addEventListener("click", wbgRoiToTable);
        $("wbg-calc").addEventListener("click", calculateWbGray);
        $("wbg-example").addEventListener("click", fillWbGrayExample);
        $("wbg-download").addEventListener("click", downloadWbGrayCsv);
        $("lv-calc").addEventListener("click", calculateLentivirus);
        $("lv-example").addEventListener("click", fillLentivirusExample);
      }

      applyTheme(preferredTheme(), false);
      setupAppInstall();
      setupVersionUi();
      setupPanelUtilities();
      setupAssumptionNotes();
      setupPresetRows();
      setupLiveFieldValidation();
      setupAutoSave();
      setupTextareaAutosize();
      registerServiceWorker();
      bindEvents();
      qpaUpdateCompareModeUi();
      vaPlateRender();

      const initialTab = (location.hash || "").replace("#", "");
      const tabNames = Array.from(document.querySelectorAll(".tab-button")).map((button) => button.dataset.tab);
      if (tabNames.includes(initialTab)) {
        activateTab(initialTab, false);
      } else {
        activateTab("cell", false);
      }
    })();
