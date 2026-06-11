# BKN Pharmacy Portal

BKN Pharmacy Portal is a unified Chrome extension and local pharmacy server for moving daily pharmacy work from paper-based handoffs into a shared digital workflow.

The project combines the previous **BKN Pharmacy** extension and **Discharge Process Checklist** overlay into one portal. It adds a shared data layer so patient context, labels, ADR timeline work, KPI records, schedules, and pharmacy master data can be reused across tools instead of being retyped or printed repeatedly.

## Main Idea: Paperless Pharmacy Workflow

The portal is designed around one goal: **less paper, faster workflow, safer pharmacy operation**.

Instead of relying on separate printed forms, manual copying, and repeated data entry, the portal lets pharmacy staff work from a central browser workspace connected to ArcusAir and the pharmacy server.

Key outcomes:

- Reduce repeated printing and handwritten tracking.
- Reuse patient and medication data across pharmacy tools.
- Standardize labels, stickers, reports, and documentation.
- Keep pharmacy master data in one server-backed source.
- Support faster review, preparation, dispensing, and follow-up.
- Preserve important patient context for later visits or checks.

## What The Portal Includes

| Area | Features |
| --- | --- |
| Popup workspace | Main Chrome extension popup with Workspace, IPD Queue, Report, and Knowledge tabs |
| ArcusAir integration | Injected action buttons inside ArcusAir pages for labels, stickers, medication tools, and ADR workflow |
| IV and auxiliary labels | IV bag labels, high-alert drug labels, prefilled syringe labels, premix labels, and mixing labels |
| Medication stickers | Printable medication labels from ArcusAir order tables and POM lists |
| Patient stickers | Patient ID stickers, address stickers, medication reconcile sticker sets, allergy cards, and related patient labels |
| ADR Timeline | Visual drug and ADR history timeline with editable events and server persistence |
| Home medication tools | Home medication sheet and medication journey support using ArcusAir order data |
| KPI and reporting | Daily KPI documents, OPD/IPD summaries, medication-error records, Jasper/report support, and Beedee report export |
| Knowledge hub | Pharmacy knowledge items, FAQs, videos, files, and shared references |
| Pharmacy master data | Medication database, extra label instructions, IV drug data, staff data, premix drugs, and mixing protocols |
| Schedule management | Pharmacy staff schedule state, booking page, shift templates, and booking rules |
| Specialty modules | Formulary tools and vaccine pages |
| Shared data layer | `window.BKNData` connects features through Chrome session storage and the pharmacy server |

## Why It Matters

Pharmacy work often crosses many screens and many printed documents. A single patient may need order review, IV preparation, medication labels, discharge medication support, ADR review, and documentation. When each step is separate, staff may need to copy the same details many times.

BKN Pharmacy Portal reduces that friction by letting each feature share the same patient context and server-backed data.

Example paperless flow:

```text
ArcusAir patient/order page
  -> BKN Pharmacy Portal button
  -> shared patient context
  -> label, sticker, ADR timeline, home med sheet, or report
  -> print only when a physical label is truly required
```

## Core Workflow

1. Staff open a patient, order, report, or pharmacy page in the browser.
2. The portal injects pharmacy action buttons where they are needed.
3. Patient and medication context is extracted from the current page.
4. The data is saved to Chrome session storage and, when persistent, to the pharmacy server.
5. Other portal features can reuse the same context without re-entering patient details.
6. Final output is digital whenever possible, with printing reserved for labels, stickers, or required documents.

## System Architecture

```text
BKNPharmacyPortal Chrome extension
  |
  |-- popup.html / popup.js
  |     Main 4-tab pharmacy workspace
  |
  |-- content_script.js
  |     ArcusAir and drug-delivery page integration
  |
  |-- src/features/
  |     home-med, med-sticker, patient-sticker, ADR timeline
  |
  |-- iv_sticker.html, aux_sticker.html
  |     IV, PFS, premix, and mixing label tools
  |
  |-- formulary/, knowledge/, kpi/, schedule/, vaccine/
  |     Supporting pharmacy modules
  |
  |-- background.js
  |     Message routing and BKN_SERVER_PROXY
  |       |
  |       v
Pharmacy Server
  http://10.134.10.5:8765
  |
  |-- /api/kpi
  |-- /api/ks
  |-- /api/rx
  |-- /api/schedule
  |-- /api/report
  |-- /api/patients/{patientuid}
```

## Shared Patient Data

`BKNData` is the shared client-side data bus used by the merged portal. It helps features pass patient context to each other without scraping the same page again.

Typical flow:

1. A user opens an ArcusAir patient page or ADR Timeline.
2. The content script extracts patient context such as patient UID, HN, name, visit, room, and order data.
3. `BKNData.setPatientContext(ctx)` stores the context in `chrome.storage.session`.
4. Persistent patient data is sent through `BKN_SERVER_PROXY` to the pharmacy server.
5. IV Sticker, Aux Sticker, ADR Timeline, medication reconcile, and other tools can call `BKNData.getPatientContext()`.

Server-backed patient data is stored under:

```text
pharmacy_server/data/patients/{patientuid}.json
```

Patient endpoints:

- `GET /api/patients/{patientuid}`
- `PUT /api/patients/{patientuid}`
- `GET /api/patients/{patientuid}/context`
- `PUT /api/patients/{patientuid}/context`
- `GET /api/patients/{patientuid}/adr-timeline`
- `PUT /api/patients/{patientuid}/adr-timeline`
- `GET /api/patients/{patientuid}/medication-cache/{patientvisituid}`
- `PUT /api/patients/{patientuid}/medication-cache/{patientvisituid}`

## Pharmacy Server Data

The local pharmacy server is the persistent source for portal data.

Important data areas:

| Data | Purpose |
| --- | --- |
| `data/kpi/` | Daily KPI records, OPD/IPD summaries, and medication-error tracking |
| `data/ks/` | Knowledge system data, FAQs, items, videos, and files |
| `data/rx/` | Medication database, IV drugs, IV staff, premix drugs, and mixing protocols |
| `data/schedule/` | Schedule state, monthly schedule files, booking rules, and bookings |
| `data/patients/` | Per-patient context, ADR timeline data, and medication cache |

Main server endpoints:

- `GET/PUT /api/kpi/...`
- `GET/PUT /api/faqs`
- `GET/PUT /api/items`
- `GET/PUT /api/vdos`
- `GET/PUT /api/medication-db`
- `GET/PUT /api/iv-drugs`
- `GET/PUT /api/iv-staff`
- `GET/PUT /api/premix-drugs`
- `GET/PUT /api/mixing-protocols`
- `GET/PUT /api/schedule/state`
- `GET/PUT /api/schedule/bookings`
- `POST /api/report/fetch`
- `POST /api/report/home-med-api`
- `POST /api/report/med-journey`

## Installation

1. Open Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select:

```text
\\10.134.10.5\BKNinfo\24 Pharmacy\EXT\BKNPharmacyPortal
```

Important: for trusted extension writes, the extension ID must be listed in `TRUSTED_EXTENSION_ORIGINS` inside `pharmacy_server/bkn_ks_server.py`.

After loading the unpacked extension, copy the extension ID from `chrome://extensions` and add it to `TRUSTED_EXTENSION_ORIGINS` if it is not already listed.

## File Layout

```text
BKNPharmacyPortal/
|-- manifest.json
|-- background.js
|-- content_script.js
|-- popup.html
|-- popup.js
|-- styles.css
|-- iv_sticker.html / iv_sticker.js / iv_sticker.css
|-- aux_sticker.html / aux_sticker.js / aux_sticker.css
|-- formulary/
|-- knowledge/
|-- kpi/
|-- schedule/
|-- vaccine/
|-- db/
|-- images/
|-- cdnjs/
`-- src/
    |-- core/
    |-- shared/
    |   `-- shared-data-client.js
    |-- features/
    |   |-- home-med/
    |   |-- med-sticker/
    |   |-- patient-sticker/
    |   `-- adrtimeline/
    |-- styles/
    `-- vendor/
```

## Migration Notes

This portal replaces two older extensions:

- **BKN Pharmacy** (`rx_menu`)
- **Discharge Process Checklist** (`AAOverlay`)

Migration checklist:

1. Load `BKNPharmacyPortal` as an unpacked extension.
2. Confirm the popup workspace opens correctly.
3. Confirm ArcusAir action buttons appear on supported pages.
4. Test key workflows: IV label, medication sticker, patient sticker, ADR Timeline, KPI, schedule, and knowledge pages.
5. Confirm server-backed writes work from the trusted extension origin.
6. Disable the two old extensions after the merged portal is verified.
7. Keep the old extensions available for short-term rollback if needed.

## Rollback

If the merged portal has a problem:

1. Disable **BKN Pharmacy Portal** in `chrome://extensions`.
2. Re-enable the old BKN Pharmacy and Discharge Process Checklist extensions.
3. Keep the pharmacy server running as before.
4. Existing server data remains available because the merge is additive.

The merged portal does not intentionally remove existing data. New per-patient records are stored separately under `data/patients/`.

## Project Summary

BKN Pharmacy Portal is the central digital workspace for BKN pharmacy operations. It connects browser-based hospital workflows, pharmacy labels, patient tools, KPI tracking, scheduling, knowledge management, and medication master data into one server-backed system.

The main value is not only more tools in one extension. The main value is a more paperless pharmacy workflow: fewer repeated prints, less duplicate typing, better shared context, and a clearer path from medication order to pharmacy action.
