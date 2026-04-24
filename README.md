BKN Pharmacy Extension
> Chrome Extension (Manifest V3) for **BKN Hospital Pharmacy Department**  
> Quick links · Clinical tools · IV/Auxiliary label printing · IPD queue · Report generation
![Version](https://img.shields.io/badge/version-2.1-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)
---
Table of Contents
Overview
Features
File Structure
Installation
Usage
Permissions
Host Integrations
Configuration
Development Notes
---
Overview
BKN Pharmacy Extension is an internal Chrome extension developed for the Pharmacy Department at BKN Hospital. It integrates directly with the hospital's internal systems — Arcusair (clinical workbench) and Drug Delivery — to automate repetitive workflows and generate medication labels and reports without leaving the browser.
---
Features
💊 IV Sticker System (`iv_sticker.html`)
Generate IV medication labels for IPD patients
Supports drug types: HAD (High Alert Drugs), PFS (Pre-filled Syringe), ATB (Antibiotic), Cytotoxic, EYE
Auto-fills patient data scraped from Arcusair Dispense Workbench (via `💉` injected button)
Print formats: IPD label, PFS label, Succinyl label
Drug database: editable, stored in `localStorage`, exportable as JSON
Staff roster management with pharmacist/assistant roles
Label history tracking
🧪 Auxiliary Sticker System (`aux_sticker.html`)
Prepack Sticker: Labels for premixed/compounded medications (39 formulary items)
Mixing Label: Step-by-step preparation instruction labels for complex compounding
Print layout: 10×5 cm sheet (3×2 grid = 6 labels per sheet)
🏥 IPD Queue (`popup.html` → IPD Queue tab)
Loads active inpatient list from the Arcusair MRD page
Groups patients by ward/bed prefix
One-click Send ▶ button pushes Visit ID to the Drug Delivery system
Persists queue state across popup open/close sessions
Shows delivery result (success / error message) per patient row
📊 Reports (`popup.html` → Reports tab)
RT_COMMON_257: Medication dispensing report — URL builder, XLS parser, PDF summary + detail
RT_COMMON_917 (Stock Picking): Grouped sticker PDF sorted by store and department
🔗 Quick Links (`popup.html` → Links tab)
Curated internal links to hospital systems (Arcusair, SharePoint, etc.)
---
File Structure
```
rx_menu/
├── manifest.json             — Extension manifest (MV3)
├── background.js             — Service worker: message bus, CORS proxy, Drive upload
├── content_script.js         — Injected on all pages (MRD table, Drug Delivery, Dispense WB)
├── popup.html                — Extension popup UI
├── popup.js                  — Popup logic: tabs, IPD queue, reports
├── styles.css                — Popup styles
├── iv_sticker.html           — IV label standalone page
├── iv_sticker.js             — IV label logic, print, CRUD
├── iv_sticker.css            — IV sticker page styles
├── aux_sticker.html          — Auxiliary sticker standalone page
├── aux_sticker.js            — Premix/mixing label logic and print
├── aux_sticker.css           — Aux sticker page styles
├── welcome.html              — Onboarding page (shown on first install)
├── welcome.js                — Welcome page script
├── images/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   ├── footer.jpg            — Label footer image
│   └── footter_maprang.jpg   — Alternative label footer
└── cdnjs/
    ├── jspdf.umd.min.js      — jsPDF library (primary)
    └── jspdf.min.js          — jsPDF library (legacy, candidate for removal)
```
---
Installation
This extension is for internal use only and is not published to the Chrome Web Store.
Developer Mode (Recommended for internal deployment)
Download or clone this repository
Open Chrome and navigate to `chrome://extensions/`
Enable Developer mode (toggle, top-right)
Click Load unpacked
Select the `rx_menu/` folder
The BKN Pharmacy icon will appear in the toolbar
Updating
Make your changes to the source files
Go to `chrome://extensions/`
Click the ↻ refresh icon on the BKN Pharmacy card
---
Usage
Popup
Click the BKN Pharmacy icon in the Chrome toolbar to open the popup.
Tab	Description
IPD Queue	Load and manage active inpatient list from Arcusair MRD
IV Sticker	Open the IV label printing page
Aux Sticker	Open the auxiliary sticker printing page
Reports	Generate RT_COMMON_257 / RT_COMMON_917 reports
Links	Quick access to internal hospital systems
IV Labels (from Arcusair Dispense Workbench)
Open a patient order on `arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/...`
Click the 💉 button injected next to the allergy button in the patient banner
The IV Sticker page opens in a new tab with patient data pre-filled
Select drug, set date/time, assign staff, then click สร้าง Preview
Click 🖨 Print
IPD Queue → Drug Delivery
Navigate to the Arcusair MRD page (`#!/mrd/reopenvisit`)
Open the extension popup → IPD Queue tab
Click ↻ Refresh to load active patients
Click Send ▶ on any patient row to push their Visit ID to the Drug Delivery system
A green ✓ or red error message confirms the result
---
Permissions
Permission	Reason
`activeTab`	Interact with the current browser tab
`tabs`	Query and update tabs for Drug Delivery routing
`storage`	Persist IPD queue, IV drug database, staff roster, sent state
`contextMenus`	Reserved for side panel trigger (future use)
`scripting`	Execute scripts in tabs for sidebar toggle
---
Host Integrations
Host	Purpose
`arcusair.bdms.co.th`	Arcusair clinical workbench (MRD table, Dispense Workbench)
`bdmsgroup-my.sharepoint.com`	SharePoint document access
`script.google.com`	Med Rec Google Apps Script trigger
`10.134.10.91`	Internal Drug Delivery system (ipfill page)
---
Configuration
The following values are currently hardcoded and may need updating when the environment changes:
Value	Location	Description
`10.134.10.91:8809`	`background.js`, `content_script.js`, `manifest.json`	Drug Delivery internal IP
Google Apps Script URL	`background.js` line ~113	Med Rec trigger endpoint
Google Drive folder ID	`background.js` line ~152	Drive upload destination
> ⚠️ These should ideally be moved to a shared `config.js` file. See `REFACTORING_REPORT.md` for details.
---
Development Notes
Framework: Vanilla JS, no bundler. Each file is loaded directly by the extension.
PDF generation: Uses jsPDF (UMD build, bundled locally in `cdnjs/`)
Font: Sarabun (Google Fonts) loaded at print time for Thai character support
State persistence: `chrome.storage.local` for queue/sent state; `localStorage` for IV drug/staff data
SPA compatibility: `MutationObserver` + debounce is used to detect Angular SPA route changes on Arcusair
Browser Support
Chrome 109+ (Manifest V3 service worker requirement)
Known Limitations
The Drug Delivery auto-fill requires the ipfill tab to already be open in the browser
IV sticker data scraped from Arcusair depends on specific DOM selectors that may break if the hospital updates the Arcusair frontend
Reports depend on specific XLS column structures from Arcusair exports
---
Maintained by BKN Hospital Pharmacy Department · Internal use only
