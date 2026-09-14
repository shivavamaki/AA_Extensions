# Arcus Toolkit

> Chrome Extension (Manifest V3) for **BKN Hospital Pharmacy Department**  
> Automates repetitive dispensing workflows on the Arcusair Pharmacy Management System.

![Version](https://img.shields.io/badge/version-4.7.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)

---


## Tab and PC behavior (4.7.0)

- Every Chrome tab has independent settings, panel visibility, ward selection, mode and running state. Changing or stopping one tab does not change another tab.
- Settings are saved in this PC's Chrome profile using local extension storage. They are not stored in the shared Automate folder, sent to the pharmacy server, or synchronized through Chrome Sync.
- Reloading the same tab preserves its settings. New and duplicated tabs start with independent defaults. A Chrome-restored tab recovers its settings when Chrome restores its session token. A completely new tab is a new workspace.
- Existing shared settings from older releases are not imported into new tab profiles. Configure each tab once after upgrading.
- Running panels stay expanded across Arcus route changes and DOM replacement, preserving controls, progress and Stop. Close and Minimize become available after the run stops.
- A full page reload or browser shutdown ends in-memory automation; it does not resume dispensing automatically. Settings persistence is separate from run persistence.
- Turbo remains an explicit per-page-session choice. Automatic override preferences belong only to their own tab.
- Image download requests carry their own filenames; simultaneous tabs cannot consume another tab's pending filename. If an image has no usable download URL, the item reports failure instead of assigning a name to an unrelated download.

After updating: reload Arcus Toolkit on chrome://extensions/, then reload each open Arcus tab. Each PC using the shared extension folder must reload its own extension.

Regression tests: `node --test Automate/tests/tab-behavior.test.cjs`.
Offline browser smoke test: `node Automate/tests/browser-panels.cjs` (optional Chrome executable path argument). The browser test uses a temporary profile and mocked services on localhost.

## Overview

Arcus Toolkit injects a floating control panel into Arcusair and provides one-click automation for the two most common pharmacy dispensing workflows: **Auto Dispense** (outpatient/inpatient dispense workbench) and **IP Fill** (inpatient fill queue). The popup allows navigating to each workflow and triggering the panel from outside the Arcusair tab.

---

## Turbo Mode (Chrome DevTools Protocol)

Turbo is an opt-in engine that replaces the extension's fixed delays with real
signals from the browser. Toggle it in the panel; the setting persists.

**What it changes**

| | Standard (DOM) | Turbo (CDP) |
|---|---|---|
| Clicks | Synthetic `MouseEvent` (`isTrusted: false`) | `Input.dispatchMouseEvent` — genuinely trusted |
| Step timing | Fixed `sleep(1500–1800)` after every action | Resumes when the step's XHR actually completes |
| Element waits | Poll every 250–400 ms | Resolves on the DOM mutation itself |
| Row scanning | Per-row `innerText` + `getBoundingClientRect` | One batched evaluation inside the page |

**Trade-offs**

- Chrome shows a *"Arcus Toolkit started debugging this browser"* banner on the
  tab while turbo is attached. This is unavoidable — it is Chrome's mandatory
  disclosure for the `debugger` permission.
- Turbo cannot attach if DevTools is already open on the same tab. The panel
  shows `unavailable` and the run proceeds in standard mode.
- If the debugger session drops mid-run, the driver downgrades to DOM mode and
  **the run continues**; it never aborts a batch.

Standard mode also benefits from this work: it uses MutationObserver-driven
waits and hooks `XMLHttpRequest`/`fetch` to detect settling, so it no longer
relies on blind fixed delays either.

---

## Features

### Auto Dispense Panel
- Floating side panel injected into the Arcusair Dispense Workbench
- Iterates through order rows and dispatches them automatically
- Configurable order filters (by pharmacy type, status, etc.)
- Live progress stats: processed / success / fail counts
- Step-by-step status display and action log

### IP Fill Panel (`ipfill_panel.js`)
- Floating panel for the IP Fill queue route
- Automates fill confirmation steps

### Popup Controls (`popup.html` / `popup.js`)
- **Open Workbench** — navigates the active Arcusair tab to the Dispense Workbench and shows the panel
- **Open IP Fill** — navigates to the IP Fill queue
- Uses hash-based Angular router navigation to avoid Chrome's back-navigation security alert

### Shared State (`content/shared.js`)
- `state` object shared across panel, automation, and boot scripts
- Order filter constants, `clamp`, `escapeHtml`, pharmacy-type detection utilities
- `PANEL_STORAGE_KEY` for persisting panel dismissed/visible state

---

## File Structure

```
Automate/
├── manifest.json           — Extension manifest (MV3)
├── popup.html              — Extension popup UI
├── popup.js                — Popup logic: navigate to workbench / IP fill
├── cdp-bridge.js           — Service-worker CDP layer: chrome.debugger sessions,
│                             network-idle tracking, trusted input dispatch
├── styles.css              — Injected styles for overlay panel
└── content/
    ├── driver.js           — Interaction layer used by every module: click,
    │                         type, waitFor, settle, harvest. Turbo or DOM.
    ├── shared.js           — Shared state, constants, and utilities
    ├── panel.js            — Floating dispense panel UI and rendering
    ├── automation.js       — Auto-dispense step logic and order iteration
    ├── ipfill_panel.js     — IP Fill panel UI and automation
    └── boot.js             — Entry point: initialises panel on route match
```

---

## Installation

This extension is for internal use only and is not published to the Chrome Web Store.

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `Automate/` folder

To update after source changes, click the **↻** refresh icon on the extension card.

---

## Usage

1. Open the extension popup by clicking the Arcus Toolkit icon in the Chrome toolbar.
2. Click **Open Workbench** to navigate to the Dispense Workbench — the automation panel appears automatically.
3. Click **Open IP Fill** to navigate to the IP Fill queue.
4. Use the panel controls inside Arcusair to start, pause, or reset the automation run.

---

## Permissions

| Permission | Reason |
|---|---|
| `activeTab` | Read the currently active tab URL |
| `scripting` | Inject panel and automation scripts |
| `storage` | Persist panel state (dismissed/visible) across sessions |
| `tabs` | Query and navigate Arcusair tabs |
| `debugger` | Turbo mode only: trusted input and network-idle detection via CDP |
| `host: arcusair.bdms.co.th` | Inject content scripts into Arcusair |

---

## Development Notes

- **Framework:** Vanilla JS, no bundler. Content scripts load in manifest order,
  `driver.js` first so every later module can rely on `window.ArcusDriver`.
- **Adding automation steps:** call `clickAndSettle(el)` rather than
  `clickLikeUser(el)` + `sleep(n)` whenever the click triggers a server request.
  Use `settle(maxMs)` to wait out a request you did not initiate with a click,
  and `harvest(fn, args)` to read many DOM values in one pass. All of these work
  in both modes, so no call site needs to know whether turbo is on.
- **SPA navigation:** The popup navigates via `location.hash` change rather than `tabs.update({ url })` to prevent Chrome's Angular SPA from triggering back-button security warnings.
- **Panel activation:** The panel can also be triggered programmatically via a `arcus-toolkit:show-panel` `CustomEvent` dispatched on `window` — used by the popup after navigating to the workbench.
- **Browser:** Chrome 109+ (MV3 service worker requirement)

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
