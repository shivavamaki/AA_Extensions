# Jasper Sticker Rebuilder Prototype

Prototype Chrome Extension MV3 for capturing JasperServer `/BDMS/Pharmacy/ipdsticker` Excel output and rebuilding a printable sticker layout with custom text and QR code.

## What it does

1. Detects Jasper report URLs for `/BDMS/Pharmacy/ipdsticker`.
2. Converts the report URL to `output=xls`.
3. Fetches the Excel file using the current logged-in browser session.
4. Parses the workbook locally using bundled local libraries: JSZip + XLSX-Lite parser.
5. Stores captured data in `chrome.storage.local`.
6. Opens a custom sticker renderer page.
7. Adds custom text and QR codes.
8. Supports print/save PDF and JSON export.

## Install

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select this project folder.

## Use

1. Login to Jasper/Arcus normally.
2. Open an IPD sticker Jasper report page or a page that contains an Excel download link.
3. Click **Capture + Rebuild Sticker** next to the Jasper link.
4. The custom render page will open.
5. Review, print, or export JSON.

## Files

- `manifest.json` - Chrome extension config.
- `src/content/jasper_capture.js` - detects/fetches/parses Jasper Excel output.
- `src/background/index.js` - opens renderer tab and status.
- `src/pages/sticker_render.html` - printable sticker page.
- `src/pages/sticker_render.js` - renderer logic and QR generation.
- `src/pages/sticker_render.css` - A4/sticker layout.
- `src/pages/popup.*` - extension popup.
- `src/libs/jszip.min.js` - bundled real JSZip library used for `.xlsx` zip parsing.
- `src/libs/xlsx.full.min.js` - bundled local XLSX-Lite parser for HTML-table XLS, CSV/TSV text, and `.xlsx`.
- `src/libs/qrcode.min.js` - bundled real QR generator based on the Kazuhiko Arase QR core with DOM canvas wrapper.

## Library note

This package now includes local library files instead of mock placeholders. It does not load code from CDN at runtime.

Included:

- JSZip for `.xlsx` zip reading.
- XLSX-Lite local parser for HTML-table XLS, CSV/TSV text, and `.xlsx`.
- QRCode canvas generator based on the Kazuhiko Arase QR core.

Important limitation: XLSX-Lite is not a full BIFF8 binary `.xls` parser. Many Jasper `output=xls` exports are actually HTML-table XLS and are supported. If your Jasper server returns true binary BIFF `.xls`, replace `src/libs/xlsx.full.min.js` with the full SheetJS browser build.

Do not load libraries from CDN inside the hospital network if policy requires fully local operation.

## Prototype limitation

Jasper Excel exports may be layout-based instead of clean table-based. The parser uses best-effort detection and keeps raw rows visible/exportable. After seeing a real exported XLS, adjust `normalizeBlock()` inside `src/content/jasper_capture.js` to map exact fields.


## Update 0.1.1

If you do not see the inline button beside the Excel link, the extension now also shows a floating green **Capture + Rebuild Sticker** button at the bottom-right when it detects an `ipdsticker` Jasper URL on either ArcusAir or JasperServer pages.

Supported pages now include:
- `https://arcusair.bdms.co.th/*`
- `https://aa-report.bdms.co.th/jasperserver/*`
- `https://aa-report-uat.bdms.co.th/jasperserver/*`


## v0.1.3 update

- Confirmed target Arcus page: `https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench`
- Content script still uses Chrome match pattern `https://arcusair.bdms.co.th/*`; Chrome ignores the `#!` fragment for matching, so this covers the dispenseworkbench route.
- Added an always-visible floating panel on Arcus/Jasper pages. The button is disabled until an `ipdsticker` Jasper URL is detected.
- Added fallback scanning for Jasper report URLs stored in non-`href` attributes.
- Added support for both `aa-report.bdms.co.th` and `aa-report-uat.bdms.co.th`.


## v0.1.3 fix

If the Arcus page shows `Capture failed: Failed to fetch`, the cause is usually CORS: the content script runs on `arcusair.bdms.co.th` but tries to fetch `aa-report.bdms.co.th`.

This version fixes that by sending the XLS URL to the extension background service worker. The background worker has `host_permissions` for Jasper and fetches the XLS response there, then returns the file data to the content script for parsing and rendering.

If the next error says `SheetJS library is missing`, replace `src/libs/xlsx.full.min.js` with the real SheetJS browser build. Jasper sometimes returns HTML-table XLS, which this prototype can parse without SheetJS; true binary `.xls` still requires SheetJS.


## v0.1.4 update

- Floating capture panel is hidden by default and appears only after an `ipdsticker` Jasper URL is detected.
- Capture button text now shows live status: fetching XLS, parsing workbook, rebuilding sticker data, and saving capture.
- Added local real library files instead of mock placeholders: `jszip.min.js`, `xlsx.full.min.js` local parser, and `qrcode.min.js` QR generator.
- Content script library load order updated to load JSZip before the XLSX parser.
