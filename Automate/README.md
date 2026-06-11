# Arcus Toolkit

> Chrome Extension (Manifest V3) for **BKN Hospital Pharmacy Department**  
> Automates repetitive dispensing workflows on the Arcusair Pharmacy Management System.

![Version](https://img.shields.io/badge/version-4.0.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Overview

Arcus Toolkit injects a floating control panel into Arcusair and provides one-click automation for the two most common pharmacy dispensing workflows: **Auto Dispense** (outpatient/inpatient dispense workbench) and **IP Fill** (inpatient fill queue). The popup allows navigating to each workflow and triggering the panel from outside the Arcusair tab.

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
├── styles.css              — Injected styles for overlay panel
└── content/
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
| `host: arcusair.bdms.co.th` | Inject content scripts into Arcusair |

---

## Development Notes

- **Framework:** Vanilla JS, no bundler. All content scripts are loaded in order by the manifest: `shared.js` → `panel.js` → `automation.js` → `boot.js` → `ipfill_panel.js`.
- **SPA navigation:** The popup navigates via `location.hash` change rather than `tabs.update({ url })` to prevent Chrome's Angular SPA from triggering back-button security warnings.
- **Panel activation:** The panel can also be triggered programmatically via a `arcus-toolkit:show-panel` `CustomEvent` dispatched on `window` — used by the popup after navigating to the workbench.
- **Browser:** Chrome 109+ (MV3 service worker requirement)

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
