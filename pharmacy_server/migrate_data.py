#!/usr/bin/env python3
"""
migrate_data.py
Merges old-format KPI files into the new per-day YYYY-MM-DD.json format.

Old format (individual files):
  data/kpi/{type}_{date}_{timestamp}.json   e.g. opd-brief_2026-04-19_1776578528464.json
  data/kpi/{type}_{date}_reexport.json

New format (one file per day):
  data/kpi/YYYY-MM-DD.json
  { date, createdAt, updatedAt, opdBrief, ipdBrief, opdStat, ipdStat, medErrors: [] }

Run once from the pharmacy_server directory:
  python migrate_data.py

Old files are NOT deleted — rename/remove them manually after verifying.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

BASE   = Path(__file__).parent
KPI_DIR = BASE / "data" / "kpi"

DATE_RE    = re.compile(r"^\d{4}-\d{2}-\d{2}$")
OLD_FILE_RE = re.compile(
    r"^(opd-brief|ipd-brief|opd-stat|ipd-stat|med-error)_(\d{4}-\d{2}-\d{2})_(\d+|reexport)\.json$"
)

TYPE_TO_FIELD = {
    "opd-brief": "opdBrief",
    "ipd-brief": "ipdBrief",
    "opd-stat":  "opdStat",
    "ipd-stat":  "ipdStat",
    "med-error": "medErrors",
}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def empty_day(date: str) -> dict:
    ts = now_iso()
    return {
        "date":       date,
        "createdAt":  ts,
        "updatedAt":  ts,
        "opdBrief":   None,
        "ipdBrief":   None,
        "opdStat":    None,
        "ipdStat":    None,
        "medErrors":  [],
    }


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  WARN: cannot read {path.name}: {e}")
        return None


def save_json(path: Path, obj):
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def med_error_key(rec: dict) -> str:
    """Stable dedup key for a med-error record."""
    return rec.get("savedAt") or f"{rec.get('item','')}/{rec.get('errorType','')}/{rec.get('detail','')}"


def main():
    if not KPI_DIR.is_dir():
        print(f"ERROR: {KPI_DIR} does not exist — run from pharmacy_server/")
        sys.exit(1)

    # ── Collect old-format files ──────────────────────────────────────────────
    # Structure: { date: { type: [(timestamp_int, path), ...] } }
    by_date: dict[str, dict[str, list]] = {}

    skipped = []
    for f in sorted(KPI_DIR.iterdir()):
        m = OLD_FILE_RE.match(f.name)
        if not m:
            # Skip kpi.json, YYYY-MM-DD.json (new format), etc.
            skipped.append(f.name)
            continue
        ktype, date, ts_str = m.group(1), m.group(2), m.group(3)
        ts = int(ts_str) if ts_str != "reexport" else 0
        by_date.setdefault(date, {}).setdefault(ktype, []).append((ts, f))

    if skipped:
        print(f"Skipping {len(skipped)} non-migratable files: {', '.join(skipped)}")

    if not by_date:
        print("No old-format KPI files found — nothing to migrate.")
        return

    print(f"\nFound data for {len(by_date)} date(s): {', '.join(sorted(by_date))}\n")

    created = 0
    updated = 0

    for date in sorted(by_date):
        out_path = KPI_DIR / f"{date}.json"

        # Load existing new-format file if present (don't overwrite blindly)
        if out_path.exists():
            day = load_json(out_path)
            if not day or not isinstance(day, dict):
                day = empty_day(date)
            action = "update"
        else:
            day = empty_day(date)
            action = "create"

        existing_error_keys = {med_error_key(e) for e in day.get("medErrors", [])}
        changed = False

        for ktype, entries in by_date[date].items():
            field = TYPE_TO_FIELD[ktype]

            if ktype == "med-error":
                # Append all unique med-error records
                for _, path in sorted(entries):
                    rec = load_json(path)
                    if not rec:
                        continue
                    if isinstance(rec, list):
                        recs = rec
                    else:
                        recs = [rec]
                    for r in recs:
                        key = med_error_key(r)
                        if key not in existing_error_keys:
                            day["medErrors"].append(r)
                            existing_error_keys.add(key)
                            changed = True
            else:
                # Scalar fields: use the record with the highest timestamp
                # (reexport = 0, so real saves always win)
                best_ts, best_path = max(entries, key=lambda x: x[0])
                rec = load_json(best_path)
                if rec is None:
                    continue
                current = day.get(field)
                # Only overwrite if field is empty or this record is newer
                current_saved = current.get("savedAt", "") if isinstance(current, dict) else ""
                new_saved     = rec.get("savedAt", "") if isinstance(rec, dict) else ""
                if current is None or new_saved >= current_saved:
                    day[field] = rec
                    changed = True

        if changed:
            day["updatedAt"] = now_iso()
            save_json(out_path, day)
            marker = "CREATED" if action == "create" else "UPDATED"
            print(f"  [{marker}] {out_path.name}")
            if action == "create":
                created += 1
            else:
                updated += 1
        else:
            print(f"  [SKIP]    {out_path.name}  (no new data)")

    print(f"\nDone — {created} created, {updated} updated.")
    print("Old individual files are preserved. Delete them manually after verifying.")


if __name__ == "__main__":
    main()
