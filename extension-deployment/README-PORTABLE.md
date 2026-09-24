# Portable Extension Manager

Double-click **Start-Manager.bat** to open the desktop app.
Alternatively run: **python extension_manager.py**

Requires Windows and Python 3.10 or later with Tkinter (included with the usual python.org Windows installation).
No pip packages, application installer, administrator rights, browser-profile editing, or background service.

## Keep it on the workstation

Extract the entire ZIP into a local folder, such as Documents\BKN-Extension-Manager.
Keep the Python file and PowerShell files together. You can create a Windows shortcut to Start-Manager.bat.
The app itself is portable. Installing extension files is a separate action that only happens when you click Install / Update.

## Workstation tab

- **Check versions**: compare the local, published and previous versions.
- **Install / Update**: verify and stage the published package, then replace the local extension. Close Chrome first.
- **Restore previous**: restore the retained local version without contacting the share. Close Chrome first.
- **Set up Chrome**: opens Chrome Extensions, copies the LOCAL folder path, and shows a small guide beside Chrome.
  1. Enable **Developer mode** (top right).
  2. Click **Load unpacked** (top left). In the folder picker press **Ctrl+L**, **Ctrl+V**, **Enter**, then **Select Folder**.
  3. Confirm Portal appears and is enabled. Check Details for the local source path.
- **Copy folder path / Open local folder**: repeat these actions whenever needed.

The guide does not claim to detect Chrome installation or choose a profile automatically. Use your usual Chrome profile. Chrome requires the manual Load unpacked confirmation. For fully automatic installation, hospital IT can use supported managed extension deployment.

Default Chrome extension folder: %LOCALAPPDATA%\BKNPharmacy\Extension
Release folder: \\10.134.10.70\Pharmacy\EXT\extension-deployment\releases

Changing the local folder does not move an existing Chrome installation. After a path change, select the new folder in Chrome's Load unpacked dialog.

## Maintainer tab

Select the tested extension source and release folder.
Use **Verify published package** to check the existing release.
Increment manifest.json version before clicking **Publish release**.
The button publishes immediately; source version and selected folders should be checked first.
Maintainer is a grouping of tools, not an access-control system: Windows share permissions enforce who may publish.

## Progress and errors

Operations run without freezing the window. Action controls are locked while one is running.
Details open automatically after an error. The app never forcibly closes Chrome.
Wait for an operation to finish before closing the app.
Reading the release share can take time if the network is unavailable; the existing extension files stay local.

The app starts no scheduled task and makes no changes to machine-wide PowerShell policy.
Existing batch update shortcuts continue to work. The GUI runs the same verified deployment scripts.
See README.md for migration, rollback, publishing and release-folder permission details.

## Optional command line

python extension_manager.py --install-root "C:\Users\your-user\AppData\Local\BKNPharmacy" --release-root "\\server\share\releases" --source "\\server\share\BKNPharmacyPortal"

Folder choices apply to this session. The next launch uses the defaults or supplied arguments.
The existing batch Desktop shortcut uses the standard local and shared paths; use this GUI with the same arguments for custom paths.
