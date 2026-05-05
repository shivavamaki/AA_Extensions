# BKN Medication Database

Generated from `ITEM MASTER_BKN_2026.xlsx` sheet `Clean` and linked with medicine pictures from `pic.zip`.

## Files
- `medication_db.json` — full database with metadata and item list
- `medication_items.json` — item array only
- `medication_by_code.json` — object keyed by item code for fast lookup
- `medication_db.csv` — CSV version, UTF-8 with BOM for Excel
- `medication_db.js` — browser-ready variable `window.BKN_MEDICATION_DB`
- `images/` — medicine pictures, renamed by item code with normalized extension where needed

## Summary
- Total medication items: 2342
- Pictures found in zip: 22
- Items matched with image: 22
- Unmatched image codes: 0

## Example lookup in JavaScript
```js
const item = window.BKN_MEDICATION_DB.items.find(x => x.code === "51001060102004");
console.log(item.name, item.image_path);
```

## Main fields
`code`, `name`, `base_uom`, `itemimage_name`, `files_status`, `has_image`, `image_path`, `image_file`, `original_image_file`
