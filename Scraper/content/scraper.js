(() => {
  if (window.__ARCUS_SCRAPER_LOADED__) return;
  window.__ARCUS_SCRAPER_LOADED__ = true;

  const {
    CONFIG,
    ORDER_FILTERS,
    state,
    syncScraperState,
    getRowSnapshots,
    findRowBySnapshot,
    scrollMainContainerToLoadMore,
    clickLikeUser,
    findOpenDialog,
    isAlertDialog,
    acknowledgeAlertRowsIfPresent,
    closeAlertDialogIfPresent,
    waitForDetailPaneText,
    closeDetailPaneIfPresent,
    waitForSelectorVisible,
    waitForWorkbenchReady,
    isVisible,
    sleep,
  } = window.ArcusShared;

  // ── PDPA cleansing ────────────────────────────────────────────────────────
  // Patterns for identifiers that must be redacted under Thai PDPA
  const HN_RE        = /\b\d{2}-\d{2}-\d{6}\b/g;
  const ENC_RE       = /\b[IO]\d{2}-\d{2}-\d{6}\b/g;
  const ORDER_ID_RE  = /\b[OI]\d{10}\b/g;
  // DOB appears after MALE/FEMALE gender word in summary
  const DOB_GENDER_RE = /(MALE|FEMALE)\s+\d{2}-\d{2}-\d{4}/g;
  // Thai patient title + name words (Thai Unicode block ฀-๿)
  const THAI_NAME_RE = /(ด\.ช\.|ด\.ญ\.|นาย|นางสาว|น\.ส\.|นาง|นพ\.|พญ\.|ทพ\.|ทพญ\.|ภก\.|ภญ\.)\s*[฀-๿]+(?:\s+[฀-๿]+)*/g;
  // English patient title + UPPERCASE name (stops before MALE/FEMALE/digits)
  const ENG_NAME_RE  = /(MR\.|MRS\.|MISS|MS\.)\s+[A-Z][A-Z\s\-\.]+?(?=\s+(?:MALE|FEMALE|\d{2}-\d{2}))/g;
  // Insurance/payer names: between [ORDER] and datetime, or to end-of-line if truncated
  const PAYER_RE     = /(\[ORDER\])\s+(?:.+?(?=\s+\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})|.+$)/gm;
  // Staff (nurse/doctor) name in summary: Thai name after datetime, before ward/location
  const STAFF_RE     = /(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})\s+[฀-๿][^,\n]+(?:,\s*(?:RN\.|PN\.|พญ\.|นพ\.|MD\.|(?:ผศ\.|รศ\.|อ\.)\s+นพ\.))?/g;
  // Doctor/nurse name in detail Order Details: after DAILY/CONTINUOUS/DISCHARGE ORDER|MEDICATION
  const DOCTOR_RE    = /((?:DAILY|CONTINUOUS|DISCHARGE)\s+(?:ORDER|MEDICATION))\s+[฀-๿][^,]+,\s*(?:(?:ผศ\.|รศ\.|อ\.)\s+)?(?:พญ\.|นพ\.|RN\.|PN\.|MD\.)/g;

  function cleanseSummary(text) {
    if (!text) return text;
    return text
      .replace(THAI_NAME_RE, (_, title) => title + " [NAME]")
      .replace(ENG_NAME_RE,  (_, title) => title + " [NAME]")
      .replace(HN_RE,        "[HN]")
      .replace(ENC_RE,       "[ENC]")
      .replace(ORDER_ID_RE,  "[ORDER]")
      .replace(DOB_GENDER_RE, (_, gender) => gender + " [DOB]")
      .replace(PAYER_RE,     (_, ord) => ord + " [PAYER]")
      .replace(STAFF_RE,     (_, dt)  => dt  + " [STAFF]");
  }

  function cleanseDetail(text) {
    if (!text) return text;
    // Strip the personal header block ("Details …" up to the first vital sign "WT :").
    // This removes: name, HN, gender word, exact DOB, encounter ID, doctor name, payer info.
    let s = text.replace(/^Details[\s\S]*?(?=WT\s*:)/, "[PATIENT INFO REDACTED] ");
    // Redact any order/encounter IDs remaining in medication / Order Details section
    s = s.replace(ENC_RE, "[ENC]").replace(ORDER_ID_RE, "[ORDER]");
    // Redact doctor name in Order Details (DAILY/CONTINUOUS/DISCHARGE ORDER <name>, <title>.)
    s = s.replace(DOCTOR_RE, (_, orderType) => orderType + " [DOCTOR]");
    return s;
  }

  // ── Content tagging ──────────────────────────────────────────────────────
  function tagItem(detail, _summary) {
    const tags = [];
    const d = detail || "";
    if (d.length < 50) {
      tags.push("incomplete");
    } else {
      if (/\[PATIENT INFO REDACTED\]/i.test(d)) tags.push("patient_info");
      if (/\bWT\s*:\s*[\d.]+/.test(d)) tags.push("vitals");
      if (/No Known Drug Allerg/i.test(d)) tags.push("nkda");
      else if (/Allergy\b/i.test(d)) tags.push("allergy");
      else if (/⚠️/.test(d)) tags.push("allergy_unknown");
      if (/Primary Diagnosis|Comorbidity/i.test(d)) tags.push("dx");
      const rxCount = (d.match(/\d{10,}/g) || []).length;
      if (rxCount > 0) tags.push("rx:" + rxCount);
    }
    return tags;
  }

  function cleanseItem(item) {
    return {
      ID:      item.ID,
      ROWTYPE: item.ROWTYPE,
      SUMMARY: cleanseSummary(item.SUMMARY),
      DETAIL:  cleanseDetail(item.DETAIL),
      TAGS:    item.TAGS || [],
    };
  }

  // ── Date utilities ────────────────────────────────────────────────────────
  function parseDDMMYYYY(str) {
    const parts = String(str || "").split("-");
    if (parts.length !== 3) return null;
    const [d, m, y] = parts.map(Number);
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
  }

  function dateToDDMMYYYY(d) {
    return [
      String(d.getDate()).padStart(2, "0"),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getFullYear()),
    ].join("-");
  }

  function dateToYYYYMMDD(d) {
    return (
      String(d.getFullYear()) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0")
    );
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function countDays(startDate, endDate) {
    let count = 0;
    let d = new Date(startDate);
    while (d <= endDate) { count++; d = addDays(d, 1); }
    return count;
  }

  // ── Calendar UI date selection ────────────────────────────────────────────
  // The Arcus date picker opens a floating calendar on click; typing into the
  // input alone does not update the model. We must:
  //   1. Click the calendar trigger to open the floating panel
  //   2. Navigate prev/next to reach the target month/year
  //   3. Click the target day cell
  const CAL_MONTH_NAMES = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  // Thai month names (short and full) mapped to 1-12
  const CAL_THAI_MONTHS = [
    ["มกราคม","ม.ค."],["กุมภาพันธ์","ก.พ."],["มีนาคม","มี.ค."],
    ["เมษายน","เม.ย."],["พฤษภาคม","พ.ค."],["มิถุนายน","มิ.ย."],
    ["กรกฎาคม","ก.ค."],["สิงหาคม","ส.ค."],["กันยายน","ก.ย."],
    ["ตุลาคม","ต.ค."],["พฤศจิกายน","พ.ย."],["ธันวาคม","ธ.ค."],
  ];

  // Dismiss any open calendar by pressing Escape then a body click
  async function closeAnyOpenCalendar() {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, keyCode: 27 }));
    document.body.click();
    await sleep(350);
  }

  // Find the currently visible floating calendar panel.
  // Arcus uses a custom directive: <div class="dateselector-calendar"> with
  // <li role="button"> day cells (not <td>).
  function findOpenCalendarPanel() {
    // Arcus-specific selector — fastest path
    const arcusCal = document.querySelector('[class*="dateselector-calendar"]');
    if (arcusCal && isVisible(arcusCal)) return arcusCal;

    // Generic fallback: abs/fixed element containing ≥20 day cells
    // Count <td>, gridcell roles, AND li[role='button'] to cover all picker types
    const candidates = Array.from(document.querySelectorAll("div, table, ul"))
      .filter((el) => {
        if (!isVisible(el)) return false;
        const pos = window.getComputedStyle(el).position;
        if (pos !== "absolute" && pos !== "fixed") return false;
        return el.querySelectorAll("td, [role='gridcell'], li[role='button']").length >= 20;
      })
      .sort((a, b) => {
        const area = (e) => { const r = e.getBoundingClientRect(); return r.width * r.height; };
        return area(a) - area(b);
      });

    return candidates[0] || null;
  }

  // Parse the current month/year from the calendar panel header.
  // Arcus uses: <span class="dateselector-centered-heading">May 2026</span>
  // Also handles Thai month names and Buddhist Era years (> 2500 → subtract 543).
  function parseCalendarMonthYear(panel) {
    // Fast path: Arcus-specific heading element
    const heading = panel.querySelector('[class*="centered-heading"], [class*="dateselector-head"]');
    if (heading) {
      const txt = (heading.textContent || "").trim();
      const m = txt.match(/([A-Za-z]+)\s+(\d{4})/);
      if (m) {
        const idx = CAL_MONTH_NAMES.findIndex(
          (n) => n.toLowerCase().startsWith(m[1].toLowerCase().slice(0, 3))
        );
        if (idx >= 0) {
          let year = parseInt(m[2]);
          if (year > 2500) year -= 543;
          return { month: idx + 1, year };
        }
      }
    }

    // Generic fallback: scan all leaf-ish elements
    const els = Array.from(panel.querySelectorAll("*"));
    for (const el of els) {
      if (el.children.length > 3) continue;
      const txt = (el.textContent || "").trim();

      // English: "March 2025" or "March 2568"
      const engM = txt.match(/^([A-Za-z]+)\s+(\d{4})$/);
      if (engM) {
        const idx = CAL_MONTH_NAMES.findIndex(
          (n) => n.toLowerCase().startsWith(engM[1].toLowerCase().slice(0, 3))
        );
        if (idx >= 0) {
          let year = parseInt(engM[2]);
          if (year > 2500) year -= 543;
          return { month: idx + 1, year };
        }
      }

      // Thai: "มีนาคม 2568" or "มี.ค. 2568"
      const thaiM = txt.match(/^([฀-๿.]+)\s+(\d{4})$/);
      if (thaiM) {
        const idx = CAL_THAI_MONTHS.findIndex(
          (pair) => pair[0] === thaiM[1] || pair[1] === thaiM[1]
        );
        if (idx >= 0) {
          let year = parseInt(thaiM[2]);
          if (year > 2500) year -= 543;
          return { month: idx + 1, year };
        }
      }
    }
    return null;
  }

  // Find prev (←) or next (→) navigation button inside the calendar panel.
  // Handles text chars, aria-labels, glyphicon/fa icon classes, and sr-only text.
  function findCalNavBtn(panel, direction) {
    const els = Array.from(panel.querySelectorAll("button, a, th, td, span, i"));
    return (
      els.find((el) => {
        if (!isVisible(el)) return false;
        const txt   = (el.textContent || "").trim().toLowerCase();
        const label = (el.getAttribute("aria-label") || "").toLowerCase();
        const cls   = (el.className || "").toLowerCase();
        const hasChildIcon = (pat) => el.querySelector(`[class*='${pat}']`) !== null;
        if (direction === "prev") {
          return txt === "←" || txt === "<" || txt === "‹" || txt === "«" || txt === "previous" ||
                 /prev|previous|back/i.test(label) ||
                 /chevron.left|arrow.left|angle.left/i.test(cls) ||
                 hasChildIcon("chevron-left") || hasChildIcon("arrow-left") || hasChildIcon("angle-left");
        }
        return txt === "→" || txt === ">" || txt === "›" || txt === "»" || txt === "next" ||
               /next|forward/i.test(label) ||
               /chevron.right|arrow.right|angle.right/i.test(cls) ||
               hasChildIcon("chevron-right") || hasChildIcon("arrow-right") || hasChildIcon("angle-right");
      }) || null
    );
  }

  // Navigate the open calendar to the target month/year
  async function navigateCalendarToMonth(panel, targetMonth, targetYear) {
    for (let step = 0; step < 40; step++) {
      const cur = parseCalendarMonthYear(panel);
      if (!cur) return false;
      if (cur.month === targetMonth && cur.year === targetYear) return true;

      const diff = (targetYear - cur.year) * 12 + (targetMonth - cur.month);
      const btn  = findCalNavBtn(panel, diff < 0 ? "prev" : "next");
      if (!btn) return false;

      await clickLikeUser(btn);
      await sleep(350);
    }
    return false;
  }

  // Click a specific day number inside the open calendar panel.
  // Arcus uses <li role="button" class="…dateselector-enabled…"> for day cells.
  async function clickCalendarDay(panel, day) {
    const dayStr = String(day);

    // Collect all candidate day cells: Arcus li[role='button'] + generic td/gridcell
    const cells = Array.from(
      panel.querySelectorAll("li[role='button'], td, [role='gridcell']")
    );

    // First pass: prefer cells that are explicitly enabled (Arcus class or no disabled flag)
    for (const cell of cells) {
      if (!isVisible(cell)) continue;
      if ((cell.textContent || "").trim() !== dayStr) continue;
      const cls = (cell.className || "").toLowerCase();

      // Skip if explicitly disabled
      if (/dateselector-disabled|disabled|inactive/i.test(cls)) continue;
      if (/old|new|muted|other.month/i.test(cls)) continue;
      if (cell.getAttribute("disabled") !== null) continue;
      if (cell.getAttribute("aria-disabled") === "true") continue;

      // For Arcus li cells: require dateselector-enabled
      if (cell.tagName === "LI" && !/dateselector-enabled/i.test(cls)) continue;

      await clickLikeUser(cell);
      await sleep(500);
      return true;
    }

    // Fallback: first visible cell with matching text regardless of class
    const fallback = cells.find(
      (c) => isVisible(c) && (c.textContent || "").trim() === dayStr
    );
    if (fallback) {
      await clickLikeUser(fallback);
      await sleep(500);
      return true;
    }

    console.warn("[Arcus] clickCalendarDay: day", day, "not found. cells:",
      cells.map(c => (c.textContent || "").trim()).filter(Boolean));
    return false;
  }

  // Find the calendar trigger button that belongs to a given date input.
  // Searches by walking up the DOM from the input and finding a button whose
  // aria-label or ng-click indicates it opens the date picker.
  function findCalBtnNearInput(inputEl) {
    let node = inputEl.parentElement;
    for (let depth = 0; depth < 10 && node; depth++) {
      const btn = Array.from(node.querySelectorAll("button")).find((b) => {
        if (!isVisible(b)) return false;
        const label   = (b.getAttribute("aria-label") || "").toLowerCase();
        const ngClick = b.getAttribute("ng-click") || "";
        return (
          label.includes("selector") || label.includes("calendar") ||
          ngClick.includes("showDateSelector") || ngClick.includes("showCalendar") ||
          b.querySelector("[class*='calendar'], [class*='fa-calendar'], .fa-calendar")
        );
      });
      if (btn) return btn;
      node = node.parentElement;
    }
    return null;
  }

  // High-level: find the date input by aria-label ("From" or "To"), click its
  // calendar trigger button, navigate to the target month, and click the day.
  async function selectDateViaCalendar(inputAriaLabel, dateStr) {
    const parts = dateStr.split("-");
    if (parts.length !== 3) return false;
    const targetDay   = parseInt(parts[0]);
    const targetMonth = parseInt(parts[1]);
    const targetYear  = parseInt(parts[2]);

    // Wait up to 8s for the input to be in the DOM (Angular lazy-renders)
    const inputEl = await waitForSelectorVisible(`input[aria-label="${inputAriaLabel}"]`, 8000);
    if (!inputEl) {
      panel().pushLog("fail", `Date input "${inputAriaLabel}" not found in DOM`, "Date Scraper");
      console.warn("[Arcus] input[aria-label='" + inputAriaLabel + "'] not found");
      return false;
    }

    // Find the calendar icon button next to this input
    const calBtn = findCalBtnNearInput(inputEl);
    if (!calBtn) {
      panel().pushLog("fail", `Calendar button not found near "${inputAriaLabel}" input`, "Date Scraper");
      console.warn("[Arcus] calendar button not found. Input:", inputEl,
        "parent HTML:", inputEl.parentElement?.outerHTML?.slice(0, 300));
      return false;
    }
    // Close any already-open calendar first
    await closeAnyOpenCalendar();

    // Click the calendar icon button to open the picker
    await clickLikeUser(calBtn);
    await sleep(600);

    // Wait up to 5 s for the floating calendar panel to appear
    let calPanel = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      calPanel = findOpenCalendarPanel();
      if (calPanel) break;
      await sleep(200);
    }

    if (!calPanel) {
      panel().pushLog("fail", `Calendar panel did not open for "${inputAriaLabel}"`, "Date Scraper");
      console.warn("[Arcus] calendar panel not found after click. Visible abs/fixed divs:",
        Array.from(document.querySelectorAll("div")).filter(e => {
          const p = window.getComputedStyle(e).position;
          return (p === "absolute" || p === "fixed") && e.offsetWidth > 50;
        }).length);
      return false;
    }

    // Navigate to target month/year
    await navigateCalendarToMonth(calPanel, targetMonth, targetYear);

    // Click the target day
    const clicked = await clickCalendarDay(calPanel, targetDay);
    if (!clicked) {
      panel().pushLog("fail", `Could not click day ${targetDay} for ${dateStr}`, "Date Scraper");
      return false;
    }

    // Allow the calendar to close and Angular model to update
    await sleep(500);
    return true;
  }

  // ── Date range progress storage ───────────────────────────────────────────
  const DATE_RANGE_PROGRESS_KEY = "arcusDateRangeProgress";

  function loadDateRangeProgress() {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.get(DATE_RANGE_PROGRESS_KEY, (data) =>
          resolve(data?.[DATE_RANGE_PROGRESS_KEY] || null)
        );
      } catch (_) { resolve(null); }
    });
  }

  function saveDateRangeProgress(startStr, endStr, completedDates) {
    return new Promise((resolve) => {
      try {
        chrome.storage?.local?.set({
          [DATE_RANGE_PROGRESS_KEY]: {
            startDate: startStr,
            endDate: endStr,
            completedDates: Array.from(completedDates),
            updatedAt: Date.now(),
          },
        }, resolve);
      } catch (_) { resolve(); }
    });
  }

  function clearDateRangeProgress() {
    return new Promise((resolve) => {
      try { chrome.storage?.local?.remove(DATE_RANGE_PROGRESS_KEY, resolve); }
      catch (_) { resolve(); }
    });
  }

  // ── Current date context for file naming ──────────────────────────────────
  // Set to "YYYYMMDD" during date-range scraping, null otherwise
  let currentScrapeDate = null;

  // ── Milestone save ────────────────────────────────────────────────────────
  function saveMilestone(data, label) {
    try {
      const toSave = state.scraper.pdpa ? data.map(cleanseItem) : data;
      const suffix = state.scraper.pdpa ? "_pdpa" : "";
      const json = JSON.stringify(toSave, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      const filename = currentScrapeDate
        ? `${currentScrapeDate}_${toSave.length}${suffix}.json`
        : `arcus_scrape_${label}${suffix}_${Date.now()}.json`;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      panel().pushLog("info", `Saved ${toSave.length} rows → ${filename}`, "Scraper • save");
    } catch (err) {
      panel().pushLog("fail", `Save failed: ${err?.message || "unknown"}`, "Scraper • save");
    }
  }

  // Helper: always route panel calls to the scraper-specific panel
  function panel() {
    return window.ArcusScraperPanel || {
      setStatus: () => {},
      pushLog:   () => {},
      renderStats: () => {},
      updateButtonState: () => {},
      setDateProgress: () => {},
    };
  }

  // ── Row highlight ─────────────────────────────────────────────────────────
  function clearHighlight() {
    document.querySelectorAll(".arcus-row-highlight").forEach((el) =>
      el.classList.remove("arcus-row-highlight")
    );
  }

  function highlightRow(el) {
    clearHighlight();
    if (el) el.classList.add("arcus-row-highlight");
  }

  // ── Single-row scrape ─────────────────────────────────────────────────────
  async function scrapeSingleRow(snapshot, index, total) {
    const row = findRowBySnapshot(snapshot);
    if (!row) return { ok: false, reason: "row not found" };

    highlightRow(row);
    await clickLikeUser(row);
    await sleep(CONFIG.settleAfterRowClickMs);

    const meta = `Scraper • row ${index + 1}/${total}`;
    if (findOpenDialog() && isAlertDialog()) {
      await acknowledgeAlertRowsIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      await sleep(500);
    }

    const paneText = (await waitForDetailPaneText()) || "";
    if (!paneText) panel().pushLog("info", "No detail pane text captured", meta);

    // Do NOT close the pane here — the next row click overwrites it automatically,
    // saving ~650ms per row. The finally block closes it after the last row.
    return {
      ok: true,
      item: { ID: String(index + 1), ROWTYPE: snapshot.rowType, SUMMARY: snapshot.text, DETAIL: paneText, TAGS: tagItem(paneText, snapshot.text) },
    };
  }

  // ── Scrape all visible rows for one date (called by runDateRangeScraper) ───
  async function scrapeDateRows(dateLabel, daysDone, totalDays) {
    const dateData = [];
    const seenKeys = new Set();
    let processedIndex = 0;
    let emptyScrollAttempts = 0;

    while (!state.scraperStopRequested) {
      const snapshots = getRowSnapshots();
      const nextSnapshot = snapshots.find((s) => !seenKeys.has(s.key || s.text));

      if (!nextSnapshot) {
        if (emptyScrollAttempts >= CONFIG.maxEmptyScrollAttempts) break;
        emptyScrollAttempts++;
        panel().setDateProgress(`Day ${daysDone}/${totalDays}  •  ${dateLabel}  •  ${dateData.length} rows  •  loading…`);
        panel().setStatus(
          `Scraping ${dateLabel}\n${dateData.length} rows captured\nLoading more… ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`
        );
        await scrollMainContainerToLoadMore();
        await sleep(CONFIG.loopDelayMs);
        continue;
      }

      emptyScrollAttempts = 0;
      seenKeys.add(nextSnapshot.key || nextSnapshot.text);
      processedIndex++;

      panel().setDateProgress(`Day ${daysDone}/${totalDays}  •  ${dateLabel}  •  row ${dateData.length + 1}`);
      panel().setStatus(
        `Scraping ${dateLabel}\nRow ${processedIndex}: ${window.ArcusShared.shortText(nextSnapshot.text, 60)}`
      );

      const result = await scrapeSingleRow(nextSnapshot, processedIndex - 1, processedIndex);
      state.stats.processed++;

      if (result.ok) {
        state.stats.success++;
        dateData.push(result.item);
        panel().pushLog("success", `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`, "Date Scraper");

        const every = CONFIG.milestoneSaveEvery || 100;
        if (dateData.length % every === 0) {
          saveMilestone(dateData, `milestone_${dateData.length}`);
        }
      } else {
        state.stats.fail++;
        panel().pushLog(
          "fail",
          `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`,
          `Date Scraper • ${result.reason}`
        );
      }

      // Throttle heavy DOM/state ops — every 5 rows is plenty for live feedback
      if (processedIndex % 5 === 0) {
        panel().renderStats();
        syncScraperState();
      }

      // Only scroll when the visible unseen queue is nearly empty (avoids ~1200ms penalty every row)
      const unseenCount = getRowSnapshots().filter((s) => !seenKeys.has(s.key || s.text)).length;
      if (unseenCount < (CONFIG.scrollTriggerThreshold || 3)) {
        await scrollMainContainerToLoadMore();
      }
      await sleep(CONFIG.loopDelayMs);
    }

    // Save final rows for this date (only if not stopped mid-date)
    if (dateData.length > 0 && !state.scraperStopRequested) {
      saveMilestone(dateData, `final_${dateData.length}`);
    }

    return state.scraperStopRequested ? null : dateData;
  }

  // ── Date range scraper ────────────────────────────────────────────────────
  async function runDateRangeScraper({ startDateStr, endDateStr, pdpa = true, resume = false } = {}) {
    const onWorkbench = window.ArcusShared.isWorkbenchPage();
    if (!onWorkbench) {
      panel().setStatus("Error: not on workbench page.");
      panel().pushLog("fail", `Not on workbench page. URL: ${location.href}`, "Date Scraper");
      return;
    }

    if (state.isRunning || state.scraper.state === "running") {
      panel().setStatus("Another task is already running.");
      panel().pushLog("fail", `Already running: isRunning=${state.isRunning} state=${state.scraper.state}`, "Date Scraper");
      return;
    }

    const startDate = parseDDMMYYYY(startDateStr);
    const endDate   = parseDDMMYYYY(endDateStr);
    if (!startDate || !endDate || startDate > endDate) {
      panel().setStatus("Invalid date range. Use DD-MM-YYYY format.");
      panel().pushLog("fail", `Invalid dates: "${startDateStr}" → "${endDateStr}"`, "Date Scraper");
      return;
    }

    const totalDays = countDays(startDate, endDate);
    let completedDates = new Set();

    if (resume) {
      const saved = await loadDateRangeProgress();
      if (saved && saved.startDate === startDateStr && saved.endDate === endDateStr) {
        completedDates = new Set(saved.completedDates || []);
        panel().pushLog("info", `Resuming: ${completedDates.size}/${totalDays} dates already done`, "Date Scraper");
      }
    } else {
      await clearDateRangeProgress();
      // Also reset state so a previous "done" run doesn't interfere
      state.scraper.data = [];
    }

    // Wait for the workbench to be fully rendered before starting
    panel().setStatus(`Waiting for workbench to be ready…`);
    await waitForWorkbenchReady();
    // Extra wait for Angular to finish rendering date inputs
    await sleep(1000);

    // Verify that the date inputs are present before starting the loop
    const testInput = document.querySelector('input[aria-label="From"]');
    if (!testInput) {
      const msg = "Date input (From) not found on page. Open the workbench dispense page first.";
      panel().setStatus(msg);
      panel().pushLog("fail", msg, "Date Scraper");
      console.error("[Arcus]", msg, "Total buttons:", document.querySelectorAll("button").length,
        "All inputs:", Array.from(document.querySelectorAll("input")).map(i => i.getAttribute("aria-label")));
      return;
    }
    const testBtn = findCalBtnNearInput(testInput);
    if (!testBtn) {
      const msg = "Calendar button not found near From input. Page may not be fully loaded.";
      panel().setStatus(msg);
      panel().pushLog("fail", msg, "Date Scraper");
      console.error("[Arcus]", msg, "From input parent HTML:", testInput.parentElement?.outerHTML?.slice(0, 400));
      return;
    }
    state.scraper.pdpa         = pdpa;
    state.scraper.state        = "running";
    state.scraper.data         = [];
    state.scraper.reason       = "";
    state.scraper.progressText = `0/${totalDays} dates`;
    state.scraperStopRequested = false;
    state.isRunning            = true;
    state.stats = { processed: 0, success: 0, fail: 0 };
    syncScraperState();
    panel().renderStats();
    panel().updateButtonState();

    const pdpaNote = pdpa ? " • PDPA ON" : " • PDPA OFF";
    panel().setStatus(`Date range scraper\n${startDateStr} → ${endDateStr}${pdpaNote}`);
    panel().pushLog(
      "info",
      `Start: ${startDateStr} → ${endDateStr}. ${completedDates.size} done, ${totalDays} total.${pdpaNote}`,
      "Date Scraper"
    );

    let currentDate = new Date(startDate);

    try {
      while (currentDate <= endDate) {
        if (state.scraperStopRequested) break;

        const dateInputStr = dateToDDMMYYYY(currentDate);
        const dateFileStr  = dateToYYYYMMDD(currentDate);
        const daysDone     = completedDates.size;

        panel().setDateProgress(`${daysDone}/${totalDays} days  •  Now: ${dateInputStr}`);

        if (completedDates.has(dateFileStr)) {
          currentDate = addDays(currentDate, 1);
          continue;
        }

        panel().setStatus(`Date range scraper\nSetting date: ${dateInputStr}\n${daysDone}/${totalDays} days done`);
        panel().pushLog("info", `Setting date: ${dateInputStr}`, "Date Scraper");

        // Select From date via the calendar picker next to the "From" input
        const fromOk = await selectDateViaCalendar("From", dateInputStr);
        if (!fromOk) {
          panel().pushLog("fail", `Could not set From date ${dateInputStr}`, "Date Scraper");
          currentDate = addDays(currentDate, 1);
          continue;
        }

        // Select To date via the calendar picker next to the "To" input
        const toOk = await selectDateViaCalendar("To", dateInputStr);
        if (!toOk) {
          panel().pushLog("fail", `Could not set To date ${dateInputStr}`, "Date Scraper");
          currentDate = addDays(currentDate, 1);
          continue;
        }

        const searchBtn = await waitForSelectorVisible("#searchdispense", 8000);
        if (!searchBtn) {
          panel().pushLog("fail", `Search button not found for ${dateInputStr}`, "Date Scraper");
          currentDate = addDays(currentDate, 1);
          continue;
        }

        await clickLikeUser(searchBtn);
        await sleep(1800);
        await waitForWorkbenchReady();

        currentScrapeDate = dateFileStr;
        const dateData = await scrapeDateRows(dateInputStr, completedDates.size, totalDays);
        currentScrapeDate = null;

        if (dateData !== null) {
          completedDates.add(dateFileStr);
          await saveDateRangeProgress(startDateStr, endDateStr, completedDates);
          panel().pushLog(
            "info",
            `Date ${dateInputStr}: ${dateData.length} rows saved. ${completedDates.size}/${totalDays} dates done.`,
            "Date Scraper"
          );
        }

        state.scraper.progressText = `${completedDates.size}/${totalDays} dates`;
        syncScraperState();
        currentDate = addDays(currentDate, 1);
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.scraperStopRequested) {
        state.scraper.state  = "stopped";
        state.scraper.reason = "Stopped by user.";
        panel().setStatus(`Date scraper stopped.\n${completedDates.size}/${totalDays} dates done.`);
        panel().pushLog("info", `Stopped by user. ${completedDates.size}/${totalDays} dates done.`, "Date Scraper");
      } else {
        state.scraper.state        = "done";
        state.scraper.progressText = `${completedDates.size}/${totalDays} dates done`;
        panel().setStatus(`Date scraper done.\n${completedDates.size}/${totalDays} dates completed.`);
        panel().pushLog("info", `Completed. ${completedDates.size}/${totalDays} dates done.`, "Date Scraper");
        await clearDateRangeProgress();
      }
    } catch (error) {
      currentScrapeDate = null;
      state.scraper.state  = "error";
      state.scraper.reason = error?.message || "Unknown error";
      syncScraperState();
      panel().setStatus(`Date scraper error:\n${state.scraper.reason}`);
      panel().pushLog("fail", state.scraper.reason, "Date Scraper • error");
    } finally {
      state.isRunning            = false;
      state.scraperStopRequested = false;
      currentScrapeDate          = null;
      clearHighlight();
      syncScraperState();
      panel().updateButtonState();
      panel().setDateProgress(`Done: ${completedDates.size}/${totalDays} days`);
    }
  }

  // ── Main scraper loop ─────────────────────────────────────────────────────
  async function runSharedScraper({ pdpa = true } = {}) {
    if (!window.ArcusShared.isWorkbenchPage()) {
      state.scraper.state  = "error";
      state.scraper.reason = "Scraper works only on the Arcus dispense workbench route.";
      syncScraperState();
      panel().setStatus("Error: wrong page.");
      return;
    }

    if (state.isRunning || state.scraper.state === "running") {
      panel().setStatus("Another task is already running.");
      return;
    }

    let snapshots = getRowSnapshots();
    if (!snapshots.length) {
      state.scraper.state  = "error";
      state.scraper.reason = `No order rows found for ${ORDER_FILTERS[state.settings.rowFilter]}.`;
      syncScraperState();
      panel().setStatus(`No rows found.`);
      panel().pushLog("fail", "No order rows found", "Scraper");
      return;
    }

    // Initialise run
    state.scraper.pdpa         = pdpa;
    state.scraper.state        = "running";
    state.scraper.data         = [];
    state.scraper.reason       = "";
    state.scraper.progressText = `0/${snapshots.length}`;
    state.scraperStopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0, skipped: 0 };
    syncScraperState();
    panel().renderStats();
    panel().updateButtonState();

    const pdpaNote = pdpa ? " • PDPA cleanse ON" : " • PDPA cleanse OFF";
    panel().setStatus(`Scraper started\nFilter: ${ORDER_FILTERS[state.settings.rowFilter]}${pdpaNote}\n${snapshots.length} rows visible`);
    panel().pushLog("info", `Start. ${snapshots.length} rows visible.${pdpaNote}`, "Scraper");

    const seenKeys = new Set();
    let processedIndex = 0;
    let emptyScrollAttempts = 0;

    try {
      while (!state.scraperStopRequested) {
        snapshots = getRowSnapshots();
        const nextSnapshot = snapshots.find((s) => !seenKeys.has(s.key || s.text));

        if (!nextSnapshot) {
          if (emptyScrollAttempts >= CONFIG.maxEmptyScrollAttempts) break;
          emptyScrollAttempts += 1;
          state.scraper.progressText = `${state.scraper.data.length} captured • loading more ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`;
          syncScraperState();
          panel().setStatus(`Scraper\n${state.scraper.data.length} captured\nLooking for more… ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`);
          await scrollMainContainerToLoadMore();
          await sleep(CONFIG.loopDelayMs);
          continue;
        }

        emptyScrollAttempts = 0;
        seenKeys.add(nextSnapshot.key || nextSnapshot.text);
        processedIndex += 1;
        state.scraper.progressText = `${processedIndex} processed • ${state.scraper.data.length} captured`;
        syncScraperState();
        panel().setStatus(`Scraper\n${ORDER_FILTERS[state.settings.rowFilter]}\nRow ${processedIndex}: ${window.ArcusShared.shortText(nextSnapshot.text, 80)}\nCaptured: ${state.scraper.data.length}`);

        const result = await scrapeSingleRow(nextSnapshot, processedIndex - 1, processedIndex);
        state.stats.processed += 1;

        if (result.ok) {
          state.stats.success += 1;
          state.scraper.data.push(result.item);
          const tagStr = result.item.TAGS.join(" | ") || "—";
          panel().pushLog("success", `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)} [${tagStr}]`, "Scraper");
          panel().renderStats();

          const every = CONFIG.milestoneSaveEvery || 100;
          if (state.scraper.data.length % every === 0) {
            saveMilestone(state.scraper.data, `milestone_${state.scraper.data.length}`);
          }
        } else {
          state.stats.fail += 1;
          panel().pushLog("fail", `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`, `Scraper • ${result.reason}`);
        }

        panel().renderStats();
        syncScraperState();

        // Only scroll when the unseen queue is running low — avoids ~1800ms penalty on every row
        const unseenCount = snapshots.filter((s) => !seenKeys.has(s.key || s.text)).length;
        if (unseenCount < (CONFIG.scrollTriggerThreshold || 3)) {
          await scrollMainContainerToLoadMore();
        }
        await sleep(CONFIG.loopDelayMs);
      }

      // ── Normal end ────────────────────────────────────────────────────────
      if (state.scraperStopRequested) {
        state.scraper.state  = "stopped";
        state.scraper.reason = "Stopped by user.";
        syncScraperState();
        panel().pushLog("info", "Stopped by user", "Scraper");
        panel().setStatus(`Scraper stopped.\n${state.scraper.data.length} captured.`);
      } else {
        state.scraper.state        = "done";
        state.scraper.progressText = `${state.scraper.data.length} captured`;
        syncScraperState();
        panel().setStatus(`Scraper done.\n${state.scraper.data.length} captured.`);
        panel().pushLog("info", `Completed – ${state.scraper.data.length} captured`, "Scraper");
      }

      // Final save (covers both stopped and done)
      if (state.scraper.data.length > 0) {
        const finalLabel = state.scraperStopRequested ? "stopped" : "final";
        saveMilestone(state.scraper.data, `${finalLabel}_${state.scraper.data.length}`);
      }

    } catch (error) {
      // ── Error: save immediately before anything else ───────────────────────
      if (state.scraper.data.length > 0) {
        saveMilestone(state.scraper.data, `error_${state.scraper.data.length}`);
      }
      state.scraper.state  = "error";
      state.scraper.reason = error?.message || "Unknown error";
      syncScraperState();
      panel().setStatus(`Scraper error:\n${state.scraper.reason}`);
      panel().pushLog("fail", state.scraper.reason, "Scraper • error");

    } finally {
      state.scraperStopRequested = false;
      clearHighlight();
      await closeDetailPaneIfPresent();   // close pane once at the very end
      panel().updateButtonState();
    }
  }

  window.ArcusScraper = { runSharedScraper, runDateRangeScraper, saveMilestone, cleanseItem };
})();
