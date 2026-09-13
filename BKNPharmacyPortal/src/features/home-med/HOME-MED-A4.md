# Home Medication A4 layout

page-home-med.html loads the original page-home-med.js data controller, unchanged.
content-home-med.js and shared/shared-data-client.js are restored to their original versions.
Only page-home-med.html, page-home-med-a4.css and page-home-med-a4.js implement the active A4 layout.
The separate page-home-med-a4-data.js is no longer loaded.
Compact and meal-card settings are fixed through hidden presentation controls. No patient extraction, fetching, merging, caching, or launch logic is overridden by the A4 presentation script.
The TEST files and pre-A4 backup remain available.
Live data loading still needs verification in Chrome after extension reload and ArcusAir refresh.