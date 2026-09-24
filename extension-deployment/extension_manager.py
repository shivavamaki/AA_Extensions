"""Portable BKN extension manager. Python standard library only; no app installation."""
from __future__ import annotations

import argparse
import json
import locale
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

HERE = Path(__file__).resolve().parent
SHARE = Path(r"\\10.134.10.70\Pharmacy\EXT")
DEFAULT_RELEASE = SHARE / "extension-deployment" / "releases"
DEFAULT_SOURCE = SHARE / "BKNPharmacyPortal"
DEFAULT_INSTALL = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "BKNPharmacy"
BG, WHITE, BLUE, INK, MUTED, LINE = "#f3f6fb", "#ffffff", "#365a91", "#203653", "#63748b", "#dce4ef"


def read_version(path: Path) -> str:
    with path.open(encoding="utf-8-sig") as stream:
        value = json.load(stream)["version"]
    if not isinstance(value, str):
        raise ValueError("Invalid version")
    parts = value.split(".")
    if not 2 <= len(parts) <= 4 or any(not p.isascii() or not p.isdigit() for p in parts):
        raise ValueError("Invalid version")
    return value


def version_tuple(value: str) -> tuple[int, ...]:
    parts = tuple(map(int, value.split(".")))
    return parts + (0,) * (4 - len(parts))


def inspect_versions(install: Path, releases: Path, source: Path) -> dict:
    result = {}
    for name, path in {
        "installed": install / "Extension" / "manifest.json",
        "previous": install / "Previous" / "manifest.json",
        "release": releases / "latest.json",
        "source": source / "manifest.json",
    }.items():
        try:
            result[name] = read_version(path)
        except (OSError, ValueError, KeyError) as exc:
            result[name] = None
            result[name + "_error"] = str(exc)
    if result["release"] is None:
        result["summary"] = "Release share unavailable. Your local extension is unchanged."
    elif result["installed"] is None:
        result["summary"] = "Ready to install a local copy. Chrome setup is required once."
    elif version_tuple(result["installed"]) < version_tuple(result["release"]):
        result["summary"] = "An update is available. Save your work and close Chrome first."
    elif version_tuple(result["installed"]) > version_tuple(result["release"]):
        result["summary"] = "Local version is newer than the release. Automatic downgrade is blocked."
    else:
        result["summary"] = "Version is current. Install / Update can also verify and repair files."
    return result


def build_command(action: str, install: Path, releases: Path, source: Path,
                  script_root: Path = HERE) -> list[str]:
    executable = str(Path(os.environ.get("SystemRoot", r"C:\Windows")) /
                     "System32" / "WindowsPowerShell" / "v1.0" / "powershell.exe")
    script, args = {
        "update": ("Update.ps1", ["-InstallRoot", str(install), "-ReleaseRoot", str(releases)]),
        "rollback": ("Update.ps1", ["-InstallRoot", str(install), "-Rollback"]),
        "verify": ("Verify-Release.ps1", ["-ReleaseRoot", str(releases)]),
        "publish": ("Publish.ps1", ["-Source", str(source), "-ReleaseRoot", str(releases)]),
    }[action]
    if not (script_root / script).is_file():
        raise FileNotFoundError(f"Keep {script} beside this app. Extract the complete portable ZIP.")
    return [executable, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", str(script_root / script), *args]


def execute(command: list[str], events: queue.Queue) -> None:
    """No shell interpolation. Only the shipped PowerShell scripts are executed."""
    try:
        env = {key: value for key, value in os.environ.items() if key.upper() != "PSMODULEPATH"}
        # Let Windows PowerShell build its own module path, even when launched from PowerShell 7.
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              env=env,
                              stdin=subprocess.DEVNULL,
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)) as process:
            assert process.stdout is not None
            for raw in iter(process.stdout.readline, b""):
                events.put(("log", raw.decode(locale.getpreferredencoding(False), errors="replace")))
            events.put(("finished", process.wait()))
    except Exception as exc:
        events.put(("log", str(exc) + "\n"))
        events.put(("finished", -1))


def find_chrome() -> Path:
    candidates = []
    if os.name == "nt":
        import winreg
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe") as key:
                    candidates.append(Path(winreg.QueryValue(key, None).strip('"')))
            except OSError:
                pass
    for variable in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / "Google/Chrome/Application/chrome.exe")
    executable = shutil.which("chrome.exe")
    if executable:
        candidates.append(Path(executable))
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError("Google Chrome was not found. Open Chrome yourself and enter chrome://extensions.")


def open_chrome_extensions():
    # A normal Chrome window: no profile changes, debugger, or extension-loading flags.
    return subprocess.Popen([str(find_chrome()), "--new-window", "chrome://extensions/"],
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))


class Manager:
    def __init__(self, root: tk.Tk, install: Path = DEFAULT_INSTALL,
                 releases: Path = DEFAULT_RELEASE, source: Path = DEFAULT_SOURCE,
                 auto_refresh: bool = True):
        self.root, self.events = root, queue.Queue()
        self.busy = False
        self.checking = False
        self.action = ""
        self.status_epoch = 0
        self.refresh_pending = False
        self.closed = False
        self.controls = []
        self.install = tk.StringVar(value=str(install))
        self.releases = tk.StringVar(value=str(releases))
        self.source = tk.StringVar(value=str(source))
        self.status = tk.StringVar(value="Check versions to connect to the release folder.")
        self.versions = {name: tk.StringVar(value="—") for name in ("installed", "release", "previous", "source")}
        self.details_open = False
        self.setup_window = None
        root.title("BKN Pharmacy · Extension Manager")
        root.geometry("820x740")
        root.minsize(760, 720)
        root.configure(bg=BG)
        root.protocol("WM_DELETE_WINDOW", self.close)
        self.styles()
        header = tk.Frame(root, bg=BLUE, padx=24, pady=18)
        header.pack(fill="x")
        tk.Label(header, text="BKN Pharmacy", bg=BLUE, fg=WHITE,
                 font=("Segoe UI", 19, "bold")).pack(anchor="w")
        tk.Label(header, text="Extension Manager  •  Portable", bg=BLUE, fg="#dce8fc",
                 font=("Segoe UI", 10)).pack(anchor="w", pady=(3, 0))
        body = ttk.Frame(root, padding=18)
        body.pack(fill="both", expand=True)
        self.tabs = ttk.Notebook(body)
        self.tabs.pack(fill="x")
        staff, admin = ttk.Frame(self.tabs, padding=16), ttk.Frame(self.tabs, padding=16)
        self.tabs.add(staff, text="  Workstation  ")
        self.tabs.add(admin, text="  Maintainer  ")
        cards = ttk.Frame(staff)
        cards.pack(fill="x", pady=(0, 12))
        for col, (key, title) in enumerate((("installed", "Installed"), ("release", "Published"), ("previous", "Previous"))):
            card = tk.Frame(cards, bg=WHITE, padx=14, pady=10,
                            highlightbackground=LINE, highlightthickness=1)
            card.grid(row=0, column=col, sticky="nsew", padx=(0, 8 if col < 2 else 0))
            cards.columnconfigure(col, weight=1)
            tk.Label(card, text=title, bg=WHITE, fg=MUTED, font=("Segoe UI", 9)).pack(anchor="w")
            tk.Label(card, textvariable=self.versions[key], bg=WHITE, fg=INK,
                     font=("Segoe UI", 18, "bold")).pack(anchor="w")
        ttk.Label(staff, text="Save your work and close Chrome before updating or rolling back.",
                  wraplength=690).pack(anchor="w", pady=(0, 10))
        row = ttk.Frame(staff)
        row.pack(fill="x")
        self.button(row, "Install / Update", lambda: self.run("update"), primary=True).pack(side="left", padx=(0, 8))
        self.button(row, "Restore previous", lambda: self.run("rollback")).pack(side="left", padx=(0, 8))
        self.button(row, "Check versions", self.refresh).pack(side="left")
        self.path_field(staff, "Local installation", self.install)
        setup = ttk.LabelFrame(staff, text="First-time Chrome setup", padding=10)
        setup.pack(fill="x", pady=(8, 0))
        ttk.Label(setup, text="Open chrome://extensions → Developer mode → Load unpacked.\n"
                             "Select the local extension folder below, in your usual Chrome profile.",
                  wraplength=660).pack(anchor="w")
        actions = ttk.Frame(setup)
        actions.pack(fill="x", pady=(8, 0))
        self.button(actions, "Set up Chrome", self.chrome_help, primary=True).pack(side="left", padx=(0, 6))
        self.button(actions, "Copy folder path", self.copy_path).pack(side="left", padx=(0, 6))
        self.button(actions, "Open local folder", self.open_folder).pack(side="left", padx=(0, 6))

        ttk.Label(admin, text="Publish a tested release", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(admin, text="Increment manifest.json version before publishing. Existing releases are never overwritten.",
                  wraplength=680).pack(anchor="w", pady=(5, 10))
        self.path_field(admin, "Extension source", self.source)
        self.path_field(admin, "Release folder (also used by Workstation)", self.releases)
        ttk.Label(admin, textvariable=self.versions["source"], style="Heading.TLabel").pack(anchor="w", pady=6)
        admin_actions = ttk.Frame(admin)
        admin_actions.pack(fill="x", pady=8)
        self.button(admin_actions, "Verify published package", lambda: self.run("verify")).pack(side="left", padx=(0, 8))
        self.button(admin_actions, "Publish release", lambda: self.run("publish"), primary=True).pack(side="left")
        ttk.Label(admin, text="Publishing requires write access. Staff only need read access to releases.",
                  wraplength=670).pack(anchor="w", pady=8)
        self.progress = ttk.Progressbar(body, mode="indeterminate")
        self.progress.pack(fill="x", pady=(14, 8))
        ttk.Label(body, textvariable=self.status, wraplength=735).pack(anchor="w")
        self.details_button = ttk.Button(body, text="Show details", command=self.toggle_details)
        self.details_button.pack(anchor="w", pady=(8, 4))
        self.details = ttk.Frame(body)
        self.log = tk.Text(self.details, height=7, wrap="word", font=("Consolas", 9),
                           bg=WHITE, fg=INK, relief="flat", state="disabled")
        scroll = ttk.Scrollbar(self.details, command=self.log.yview)
        self.log.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.log.pack(side="left", fill="both", expand=True)
        self.after_id = root.after(100, self.poll)
        if auto_refresh:
            self.refresh()

    def styles(self):
        style = ttk.Style(self.root)
        style.theme_use("clam")
        style.configure(".", font=("Segoe UI", 10))
        style.configure("TFrame", background=BG)
        style.configure("TLabel", background=BG, foreground=INK)
        style.configure("Heading.TLabel", font=("Segoe UI", 12, "bold"))
        style.configure("TButton", padding=(12, 8), background=WHITE, foreground=INK)
        style.configure("Primary.TButton", background=BLUE, foreground=WHITE)
        style.map("Primary.TButton", background=[("active", "#284775"), ("disabled", "#aabbd3")])
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(12, 8), background=WHITE, foreground=MUTED)
        style.map("TNotebook.Tab", background=[("selected", BG)], foreground=[("selected", BLUE)])
        style.configure("Horizontal.TProgressbar", background=BLUE, troughcolor=LINE, borderwidth=0)
        style.configure("TLabelframe", background=BG)
        style.configure("TLabelframe.Label", background=BG, foreground=MUTED)

    def button(self, parent, text, command, primary=False):
        button = ttk.Button(parent, text=text, command=command,
                            style="Primary.TButton" if primary else "TButton")
        self.controls.append(button)
        return button

    def path_field(self, parent, title, variable):
        ttk.Label(parent, text=title, foreground=MUTED).pack(anchor="w", pady=(10, 3))
        row = ttk.Frame(parent)
        row.pack(fill="x")
        entry = ttk.Entry(row, textvariable=variable)
        entry.pack(side="left", fill="x", expand=True)
        self.controls.append(entry)
        self.button(row, "Browse", lambda: self.browse(variable)).pack(side="left", padx=(6, 0))

    def browse(self, variable):
        selected = filedialog.askdirectory(parent=self.root, title="Select folder", mustexist=True)
        if selected:
            variable.set(selected)
            self.refresh()

    def paths(self):
        values = [self.install.get().strip(), self.releases.get().strip(), self.source.get().strip()]
        if not all(values):
            raise ValueError("Please select all folder paths.")
        return tuple(Path(value) for value in values)

    def lock(self, locked):
        for control in self.controls:
            control.configure(state="disabled" if locked else "normal")
        if locked:
            self.progress.start(12)
        else:
            self.progress.stop()

    def refresh(self, preserve_status=False):
        if self.busy or self.checking:
            return
        try:
            paths = self.paths()
        except ValueError as exc:
            self.status.set(str(exc))
            return
        self.checking = True
        epoch = self.status_epoch
        if not preserve_status:
            self.status.set("Checking local and published versions…")
        # Network reads stay off the UI thread. They never hold up window closure.
        def inspect():
            result = inspect_versions(*paths)
            self.events.put(("versions", (result, preserve_status, paths, epoch)))
        threading.Thread(target=inspect, daemon=True).start()

    def run(self, action):
        if self.busy:
            return
        try:
            command = build_command(action, *self.paths())
        except (ValueError, OSError, KeyError) as exc:
            self.status.set(str(exc))
            return
        if self.setup_window is not None and self.setup_window.winfo_exists():
            self.setup_window.destroy()
        self.busy, self.action = True, action
        self.status_epoch += 1
        self.lock(True)
        self.log.configure(state="normal")
        self.log.delete("1.0", "end")
        self.log.configure(state="disabled")
        self.status.set({"update": "Verifying and installing the local extension…",
                         "rollback": "Restoring the previous local version…",
                         "verify": "Verifying the published package…",
                         "publish": "Building and publishing the release…"}[action])
        threading.Thread(target=execute, args=(command, self.events), daemon=True).start()

    def append_log(self, text):
        self.log.configure(state="normal")
        self.log.insert("end", text)
        self.log.see("end")
        self.log.configure(state="disabled")

    def poll(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == "log":
                    self.append_log(value)
                elif kind == "versions":
                    result, preserve, paths, epoch = value
                    self.checking = False
                    try:
                        paths_match = paths == self.paths()
                    except ValueError:
                        paths_match = False
                    if not paths_match:
                        if self.refresh_pending:
                            self.refresh_pending = False
                            self.refresh(preserve_status=True)
                        continue
                    for key, variable in self.versions.items():
                        variable.set(result[key] or ("Unavailable" if key in ("release", "source") else "Not found"))
                    if not self.busy and not preserve and epoch == self.status_epoch:
                        self.status.set(result["summary"])
                    if self.refresh_pending:
                        self.refresh_pending = False
                        self.refresh(preserve_status=True)
                elif kind == "finished":
                    self.busy = False
                    self.lock(False)
                    if value == 0:
                        self.status.set({"update": "Local extension is ready. Reopen Chrome; complete setup if this is your first install.",
                                         "rollback": "Previous version restored. You can reopen Chrome.",
                                         "verify": "Published package verified successfully.",
                                         "publish": "Release published. Staff can now run Install / Update."}[self.action])
                    else:
                        self.status.set("Operation did not complete. Read the details below before retrying.")
                        if not self.details_open:
                            self.toggle_details()
                    if self.checking:
                        self.refresh_pending = True
                    else:
                        self.refresh(preserve_status=True)
        except queue.Empty:
            pass
        if not self.closed:
            self.after_id = self.root.after(100, self.poll)

    def toggle_details(self):
        self.details_open = not self.details_open
        if self.details_open:
            self.details.pack(fill="both", expand=True)
            if self.root.winfo_height() < 860:
                self.root.geometry("820x860")
        else:
            self.details.pack_forget()
        self.details_button.configure(text="Hide details" if self.details_open else "Show details")

    def copy_path(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(str(Path(self.install.get()) / "Extension"))
        self.status.set("Local extension path copied. Paste it in Chrome's Load unpacked folder picker.")

    def open_folder(self):
        path = Path(self.install.get()) / "Extension"
        if not path.is_dir():
            self.status.set("Install the extension first to create its local folder.")
            return
        os.startfile(str(path))

    def chrome_help(self):
        if self.setup_window is not None and self.setup_window.winfo_exists():
            self.setup_window.lift()
            return
        folder = (Path(self.install.get()) / "Extension").resolve()
        if str(folder).startswith("\\\\"):
            self.status.set("Choose a LOCAL installation folder before setting up Chrome.")
            return
        try:
            read_version(folder / "manifest.json")
        except (OSError, ValueError, KeyError):
            self.status.set("Click Install / Update first. The local extension files are not ready yet.")
            return
        self.copy_path()
        launch_error = ""
        try:
            open_chrome_extensions()
        except OSError as exc:
            launch_error = str(exc)
        wizard = tk.Toplevel(self.root)
        self.setup_window = wizard
        wizard.title("BKN · Chrome setup")
        wizard.configure(bg=BG)
        wizard.resizable(False, False)
        width, height = 470, 520
        x = max(0, wizard.winfo_screenwidth() - width - 30)
        y = max(0, wizard.winfo_screenheight() - height - 90)
        wizard.geometry(f"{width}x{height}+{x}+{y}")
        wizard.attributes("-topmost", True)
        frame = ttk.Frame(wizard, padding=18)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="Add BKN to Chrome", style="Heading.TLabel").pack(anchor="w")
        ttk.Label(frame, text="One-time setup · use your usual Chrome profile",
                  wraplength=410).pack(anchor="w", pady=(4, 14))
        step_title, instructions = tk.StringVar(), tk.StringVar()
        ttk.Label(frame, textvariable=step_title, style="Heading.TLabel").pack(anchor="w")
        ttk.Label(frame, textvariable=instructions, wraplength=410, justify="left").pack(anchor="w", pady=10)
        path_entry = ttk.Entry(frame)
        path_entry.insert(0, str(folder))
        path_entry.configure(state="readonly")
        path_entry.pack(fill="x", pady=(2, 6))
        note = tk.StringVar(value=launch_error or "Local folder path is already copied.")
        ttk.Label(frame, textvariable=note, wraplength=410).pack(anchor="w", pady=5)
        utilities = ttk.Frame(frame)
        utilities.pack(fill="x", pady=5)

        def copy_folder():
            self.root.clipboard_clear()
            self.root.clipboard_append(str(folder))
            note.set("Folder path copied. Use Ctrl+V in Chrome's folder picker.")

        def reopen():
            try:
                open_chrome_extensions()
                note.set("Chrome Extensions opened. Check that this is your usual profile.")
            except OSError as exc:
                note.set(str(exc))

        ttk.Button(utilities, text="Copy folder path", command=copy_folder).pack(side="left", padx=(0, 6))
        ttk.Button(utilities, text="Open Extensions", command=reopen).pack(side="left")
        pin = tk.BooleanVar(value=True)
        ttk.Checkbutton(frame, text="Keep this guide visible", variable=pin,
                        command=lambda: wizard.attributes("-topmost", pin.get())).pack(anchor="w", pady=8)
        navigation = ttk.Frame(frame)
        navigation.pack(side="bottom", fill="x")
        steps = [
            ("1 / 3 · Enable Developer mode",
             "In Chrome's Extensions page, turn on Developer mode at the TOP RIGHT.\n\n"
             "If Chrome did not open, enter chrome://extensions in its address bar."),
            ("2 / 3 · Select the local folder",
             "Click Load unpacked at the TOP LEFT.\n\n"
             "In the folder picker: press Ctrl+L, then Ctrl+V, then Enter. "
             "Click Select Folder. The path below is already copied."),
            ("3 / 3 · Check the extension",
             "Confirm BKN Pharmacy Portal appears and its switch is ON.\n\n"
             "Open Details and check that its source is the local folder below. "
             "Refresh your Arcus tabs. Future updates use Install / Update in this app."),
        ]
        position = [0]
        back = ttk.Button(navigation, text="Back")
        back.pack(side="left")
        forward = ttk.Button(navigation, text="Next")
        forward.pack(side="right")

        def show_step():
            title, body = steps[position[0]]
            step_title.set(title)
            instructions.set(body)
            back.configure(state="normal" if position[0] else "disabled")
            forward.configure(text="Done" if position[0] == len(steps)-1 else "Next")

        def advance():
            if position[0] == len(steps)-1:
                wizard.destroy()
                self.status.set("Setup guide closed. Confirm Portal is enabled in your Chrome profile.")
            else:
                position[0] += 1
                show_step()

        def retreat():
            position[0] = max(0, position[0]-1)
            show_step()

        back.configure(command=retreat)
        forward.configure(command=advance)
        show_step()
        wizard.lift()

    def close(self):
        if self.busy:
            messagebox.showinfo("Operation in progress", "Please wait for the operation to finish before closing.",
                                parent=self.root)
            return
        self.closed = True
        self.root.after_cancel(self.after_id)
        self.root.destroy()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install-root", type=Path, default=DEFAULT_INSTALL)
    parser.add_argument("--release-root", type=Path, default=DEFAULT_RELEASE)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    root = tk.Tk()
    Manager(root, args.install_root, args.release_root, args.source)
    root.mainloop()


if __name__ == "__main__":
    main()
