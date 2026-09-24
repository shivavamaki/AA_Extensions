"""Synthetic regression checks for the HMQ network-share loader."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import bkn_ks_server as app

class HmqLoaderTests(unittest.TestCase):
    def test_precedence_dates_updates_and_copy_isolation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def save(name, value):
                (root / name).write_text(json.dumps(value), encoding="utf-8")
            live = {"id": "HMQ-test", "createdAt": "2026-09-21T18:00:00Z",
                    "startedAt": "2026-09-21T18:05:00Z",
                    "auditLog": [{"action": "Started", "user": "Synthetic"}]}
            archived = {"id": "archived", "createdAt": "2026-09-22T02:00:00Z"}
            save("HMQ-test.json", live)
            save("22092026_HM_queue.json", [dict(live, source="archive"), archived])
            save("DAY_2026-09-22.json", [dict(archived, source="legacy")])
            save("19092026_HM_queue.json", [{"id": "old", "createdAt": "2026-09-19T01:00:00Z"}])
            with patch.object(app, "HMQ_DIR", root):
                with patch.object(app, "_load_json_cached", wraps=app._load_json_cached) as read:
                    rows = app.load_all_hmq("2026-09-22", "2026-09-22")
                    self.assertEqual(read.call_count, 3)
                    self.assertTrue(all(call.args[1] is not None for call in read.call_args_list))
                self.assertEqual([r["id"] for r in rows], ["archived", "HMQ-test"])
                self.assertTrue(all("source" not in r for r in rows))
                self.assertEqual(rows[1]["startedBy"], "Synthetic")
                rows[1]["auditLog"].clear()
                self.assertEqual(len(app.load_all_hmq("2026-09-22", "2026-09-22")[1]["auditLog"]), 1)
                save("HMQ-test.json", dict(live, status="done"))
                self.assertEqual(app.load_all_hmq("2026-09-22", "2026-09-22")[1]["status"], "done")
                (root / "HMQ-test.json").unlink()
                self.assertEqual(app.load_all_hmq("2026-09-22", "2026-09-22")[1]["source"], "archive")
                self.assertEqual(len(app.load_all_hmq()), 3)

if __name__ == "__main__":
    unittest.main()
