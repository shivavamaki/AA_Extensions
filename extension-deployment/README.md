# BKN Pharmacy local installation and updates

A portable desktop interface is available: run **Start-Manager.bat**, or extract **dist/BKN-Extension-Manager-portable.zip** to a local folder and run its launcher. See **README-PORTABLE.md**. Requires Python 3 with Tkinter; no pip packages or app installation.

## Staff: first installation (once per Windows user / Chrome profile)

1. Save your work and close Chrome completely.
2. From this shared folder, double-click **Install-or-Update.bat**.
3. Reopen Chrome with your usual profile. Open **chrome://extensions**, enable **Developer mode**, and choose **Load unpacked**.
4. Paste **%LOCALAPPDATA%\BKNPharmacy\Extension** in the folder picker.
5. Confirm BKN Pharmacy Portal is enabled and its Details > source path is the LOCAL folder. Pin it if desired.

The full installation folder is printed by the installer. There is no administrator requirement and no dependency on a D: drive.
If migrating from the share or an old D:\pharmacy installation, load the new local path in the same Chrome profile and verify the source path. Do not remove the old entry first: removing an extension can discard its local settings. The manifest key is preserved. The installer does not edit Chrome profile files or migrate another Windows user's profile.

## Staff: future updates

1. Save your work and close Chrome.
2. Double-click **Update BKN Pharmacy** on your Desktop.
3. Reopen Chrome. If it still shows the old version, click Reload for Portal in chrome://extensions and refresh Arcus tabs.

No network at update time? The existing installation stays in place. Use it and update later.
The local updater never downloads or executes a replacement script. To upgrade the updater itself, run Install-or-Update.bat from this shared folder again.
Only extension code is stored locally by this installer; application services still need their normal hospital network connections.

## Roll back

Close Chrome and run **%LOCALAPPDATA%\BKNPharmacy\Updater\Rollback.bat**.
This swaps the installed and previous versions; it works without the share.
One previous code version is retained. It does not roll back Chrome storage, patient data, or server databases.

## Maintainer: publish

1. Finish and test your extension changes in ../BKNPharmacyPortal.
2. Increment manifest.json version for each new release.
3. Run **Publish.bat** here.
4. Wait for "Published". Then tell staff to use their Desktop update shortcut.

The publisher creates an immutable releases/<version>/extension.zip and release.json, then atomically switches latest.json.
It refuses to overwrite an existing version. A failure before the pointer switch leaves the previous release advertised. If an orphan version folder remains after a failed pointer switch, inspect it and publish a new version number.
It checks the Manifest V3 entry points and preserves the stable extension key. Test/docs, scripts, archives and private signing-key files are excluded.
Release checksums and a per-file inventory detect incomplete copies and corruption. They are NOT a digital signature: IT must allow only release maintainers to write this directory and its scripts; staff need read access.
Batch launchers use -ExecutionPolicy Bypass for that PowerShell process only. They do not change machine execution policy or bypass enforced Group Policy. Where signed scripts are required, IT should sign these scripts and use the organization's approved launcher.
The legacy nested pharmacy_server/pharmacy_server batch files and retired HTTP endpoints are not used or modified.

## Safety behavior

- Download/copy and verify into a unique staging folder before switching.
- Reject path traversal, duplicate archive entries, reparse points, changed extension identity and automatic downgrades.
- Require Chrome closed in the current Windows session; never kill browser processes.
- Keep the previous extension folder and restore it if activation fails.
- Recover a missing Extension folder from Previous after an interrupted switch.
- Lock out simultaneous updates and simultaneous publishers.
- Never erase Chrome profiles, extension storage or server data.
- Installation is per Windows user. PCs that reset user profiles at reboot still need an IT-managed persistent installation.

## Tests

Run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Test-Deployment.ps1

Tests use isolated temporary directories, real package/hash/copy/rename operations, and a mocked Chrome process query. They do not modify installed extensions or live browser profiles.
