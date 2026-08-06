# medrecon-comment — Med Reconcile "Comments" dropdown

Turns the **Comments** field on ArcusAir's Med Reconcile page into an
**editable dropdown** (combobox): three preset choices plus free-text typing.

- **Route:** `arcusair.bdms.co.th/#!/emr/emrview/emr/medreconcile`
- **Target field:** `<input ng-model="vm.selectedmedreconcile.comments" name="comments">`
  (rendered as `#commentstxt1`, `#commentstxt2`, … inside `md-input-container`)

## Presets

- `BKN's Medicines`
- `Non BKN's Medicines`
- `ไม่ได้ส่งยามาห้องยา`

The blank state is simply the empty input (no forced default).

## How it works

Instead of replacing the Angular-bound `<input>` (which would risk breaking
`ng-model` / ArcusAir's save), the script **attaches a `<datalist>`** to the
existing input via `list="…"`. This makes the native input an **editable
combobox**: the browser shows the preset options on focus, and the pharmacist
can still type any value. Because it is the *same* input element, the
`ng-model="vm.selectedmedreconcile.comments"` binding and ArcusAir's save logic
are untouched — no value mirroring or synthetic events needed.

## Robustness

- **Guard:** `document[Symbol.for("__BKN_MEDRECON_COMMENT__")]` — a
  Symbol-keyed document property survives Angular's `window.*` wipe.
- **Targeting:** by stable attributes (`ng-model` / `name="comments"`), **not**
  the numeric id, so every reconciliation row gets the dropdown.
- **Idempotent:** each input is flagged `data-bkn-medrecon-list="1"`; the shared
  `<datalist id="bkn-medrecon-comment-options">` is created once.
- **SPA re-render:** a debounced (`requestAnimationFrame`-gated)
  `MutationObserver` on `document.body` re-attaches the list whenever Angular
  recreates the form (navigation / record selection).
- **MV3 CSP:** no inline handlers — a `<datalist>` needs none.

## Files

| File | Role |
|---|---|
| `content-medrecon-comment.js` | Content script — attaches the datalist to the Comments input(s) |

Registered in `manifest.json` `content_scripts` for `arcusair.bdms.co.th`,
before `content_script.js` (per the load-order invariant).
