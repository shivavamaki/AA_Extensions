import json
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch

import extension_manager as app


class ManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="bkn-manager-test-")
        self.root = Path(self.temp.name)
        self.install = self.root / "local folder"
        self.release = self.root / "releases"
        self.source = self.root / "source"

    def tearDown(self):
        self.temp.cleanup()

    def write_version(self, path, version):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"version": version}), encoding="utf-8")

    def test_versions_and_offline(self):
        self.write_version(self.install / "Extension" / "manifest.json", "3.62.4")
        result = app.inspect_versions(self.install, self.release, self.source)
        self.assertEqual(result["installed"], "3.62.4")
        self.assertIn("unavailable", result["summary"])
        self.write_version(self.release / "latest.json", "3.62.5")
        self.assertIn("update is available", app.inspect_versions(self.install, self.release, self.source)["summary"])
        self.write_version(self.release / "latest.json", "3.62.3")
        self.assertIn("downgrade is blocked", app.inspect_versions(self.install, self.release, self.source)["summary"])
        self.assertEqual(app.version_tuple("1.0"), app.version_tuple("1.0.0"))

    def test_commands_preserve_paths_as_single_arguments(self):
        special = self.root / "folder with spaces & literal"
        cmd = app.build_command("update", special, self.release, self.source)
        self.assertEqual(cmd[cmd.index("-InstallRoot") + 1], str(special))
        self.assertIn("-NonInteractive", cmd)
        rollback = app.build_command("rollback", special, self.release, self.source)
        self.assertIn("-Rollback", rollback)
        self.assertNotIn("-ReleaseRoot", rollback)
        for action in ("verify", "publish"):
            self.assertIn(str(self.release), app.build_command(action, special, self.release, self.source))
        with self.assertRaises(FileNotFoundError):
            app.build_command("update", special, self.release, self.source, self.root)

    def test_worker_exit_codes_and_output(self):
        events = queue.Queue()
        app.execute([sys.executable, "-c", "print('test output'); raise SystemExit(7)"], events)
        messages = []
        while not events.empty():
            messages.append(events.get_nowait())
        self.assertIn(("finished", 7), messages)
        self.assertTrue(any(kind == "log" and "test output" in value for kind, value in messages))

    def test_real_package_verification_through_worker(self):
        events = queue.Queue()
        app.execute(app.build_command("verify", self.install, app.HERE / "releases", self.source), events)
        messages = []
        while not events.empty():
            messages.append(events.get_nowait())
        self.assertIn(("finished", 0), messages, messages)
        self.assertTrue(any(kind == "log" and "Verified" in value for kind, value in messages))

    def test_chrome_launch_uses_normal_extensions_page(self):
        with patch.object(app, "find_chrome", return_value=Path("C:/Chrome/chrome.exe")), patch.object(app.subprocess, "Popen") as launch:
            app.open_chrome_extensions()
            command = launch.call_args.args[0]
            self.assertEqual(command[1:], ["--new-window", "chrome://extensions/"])
            self.assertNotIn("--load-extension", " ".join(command))
            self.assertNotIn("--user-data-dir", " ".join(command))

    def test_setup_requires_local_files_and_guides_without_false_success(self):
        root = tk.Tk()
        root.withdraw()
        manager = app.Manager(root, self.install, self.release, self.source, auto_refresh=False)
        def descendants(widget):
            for child in widget.winfo_children():
                yield child
                yield from descendants(child)
        try:
            with patch.object(app, "open_chrome_extensions") as launch:
                manager.chrome_help()
                launch.assert_not_called()
                self.assertIn("Install / Update first", manager.status.get())
                self.write_version(self.install / "Extension" / "manifest.json", "3.62.4")
                manager.chrome_help()
                launch.assert_called_once()
                wizard = manager.setup_window
                root.update()
                self.assertEqual(root.clipboard_get(), str(self.install / "Extension"))
                next_button = next(w for w in descendants(wizard) if isinstance(w, app.ttk.Button) and w["text"] == "Next")
                next_button.invoke()
                next_button.invoke()
                self.assertEqual(next_button["text"], "Done")
                next_button.invoke()
                self.assertFalse(wizard.winfo_exists())
                self.assertIn("Confirm Portal is enabled", manager.status.get())
        finally:
            manager.close()

    def test_gui_operation_feedback_and_lock(self):
        root = tk.Tk()
        root.withdraw()
        manager = app.Manager(root, self.install, self.release, self.source, auto_refresh=False)
        try:
            with patch.object(app, "execute") as execute, patch.object(manager, "refresh"):
                manager.run("update")
                self.assertTrue(manager.busy)
                self.assertTrue(all(str(widget["state"]) == "disabled" for widget in manager.controls))
                manager.events.put(("log", "Close Chrome before retrying.\n"))
                manager.events.put(("finished", 1))
                root.update()
                root.after_cancel(manager.after_id)
                manager.poll()
                self.assertFalse(manager.busy)
                self.assertTrue(manager.details_open)
                self.assertIn("did not complete", manager.status.get())
                self.assertIn("Close Chrome", manager.log.get("1.0", "end"))
                self.assertTrue(all(str(widget["state"]) == "normal" for widget in manager.controls))
                manager.run("verify")
                manager.events.put(("finished", 0))
                root.after_cancel(manager.after_id)
                manager.poll()
                self.assertIn("verified successfully", manager.status.get())
                execute.assert_called()
            manager.install.set("")
            manager.events.put(("versions", ({"installed": None}, False,
                                             (self.install, self.release, self.source), 0)))
            root.after_cancel(manager.after_id)
            manager.poll()  # Editing a path during a probe must not crash Tk.
        finally:
            manager.busy = False
            manager.close()


if __name__ == "__main__":
    unittest.main()
