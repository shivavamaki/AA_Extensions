"""Build the portable app bundle; does not install or publish an extension."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent
FILES = (
    "extension_manager.py", "Start-Manager.bat", "README-PORTABLE.md", "README.md",
    "Common.ps1", "Update.ps1", "Publish.ps1", "Verify-Release.ps1",
    "Install-or-Update.bat", "Rollback.bat",
)


def build():
    destination = ROOT / "dist"
    destination.mkdir(exist_ok=True)
    target = destination / "BKN-Extension-Manager-portable.zip"
    staging = target.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(staging, "w", zipfile.ZIP_DEFLATED) as archive:
            for name in FILES:
                archive.write(ROOT / name, "BKN-Extension-Manager/" + name)
        with zipfile.ZipFile(staging) as archive:
            if archive.testzip() is not None:
                raise RuntimeError("Portable archive verification failed")
        staging.replace(target)
    finally:
        staging.unlink(missing_ok=True)
    print(target)


if __name__ == "__main__":
    build()
