import ast
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import hm_report_cache as c

def ts(day, hour=0, minute=0):
    return datetime(2026, 9, day, hour, minute, tzinfo=c.THAILAND).timestamp()

class CacheRetentionTests(unittest.TestCase):
    def test_calendar_expiry_and_cleanup(self):
        ctx = {'patientuid':'synthetic', 'patientvisituid':'visit'}
        data = {'dose':1}
        with tempfile.TemporaryDirectory() as d:
            c.save(d, ctx, data, {'ok':True}, ts(13,23,59))
            self.assertIsNotNone(c.load(d, ctx, data, ts(16,23,59)))
            self.assertIsNone(c.load(d, ctx, data, ts(17)))
            self.assertEqual(c.cleanup(d, ts(16,23)), 0)
            unrelated = Path(d) / 'unrelated.json'
            unrelated.write_text('{}')
            self.assertEqual(c.cleanup(d, ts(17,23)), 1)
            self.assertTrue(unrelated.exists())

    def test_refresh_and_fingerprint(self):
        ctx = {'patientuid':'synthetic', 'patientvisituid':'visit'}
        with tempfile.TemporaryDirectory() as d:
            c.save(d, ctx, {'dose':1}, {'ok':True}, ts(13))
            self.assertIsNone(c.load(d, ctx, {'dose':2}, ts(14)))
            c.save(d, ctx, {'dose':2}, {'ok':True}, ts(17,22))
            self.assertEqual(c.cleanup(d, ts(17,23)), 0)
            self.assertIsNotNone(c.load(d, ctx, {'dose':2}, ts(17,23)))

    def test_schedule(self):
        self.assertEqual(c.next_cleanup(ts(13,22)), ts(13,23))
        self.assertEqual(c.next_cleanup(ts(13,23)), ts(14,23))
        self.assertEqual(c.thai_date(ts(13)), datetime(2026,9,13).date())

if __name__ == '__main__':
    unittest.main()
