# Dashcam Player

A player for Zeekr 7X dashcam and sentry recordings. The car writes all four
cameras into a single frame; this splits them back apart, straightens the
fisheye, and exports any one camera as its own file.

Everything runs on your own machine. Nothing is uploaded, and the player has
no network access beyond the local helper that serves it.

![version](https://img.shields.io/badge/version-1.60.1-blue)

## What it does

- Plays the combined 2×2 recordings as a grid, or any single camera full-frame
- Straightens the fisheye on the GPU, with adjustable strength and zoom
- Trims the sky and the car's own bodywork off each view
- Lists recordings by day, with sentry alerts grouped separately and marked
- Opens a sentry alert at the moment it triggered, with the still, the time and
  a map link
- Rebuilds recordings the car never finalised — power lost, card pulled — from
  the decoder settings of a healthy file in the same folder
- Writes any single camera out as its own file with ffmpeg, whole or a marked clip, with draggable in and out points
- Deletes recordings from the card, a file or a whole day at a time

## Before you start

To view **dashcam** video you will need one of the dashcam apps installed on the
car's head unit — for example
[zeekr-shortcut-car](https://github.com/dts88/zeekr-shortcut-car/releases/latest).
The car app install process is shown in [this video](https://youtu.be/ve_rzkdrjZI).

If you only want to view **sentry** videos on your PC, you can skip the car app
install.

If you want both dashcam and sentry videos on the same USB drive — recommended —
make sure the drive is in the **sentry USB-A port** in the car.

## Installing

Once there are recordings on the USB drive, install the viewer on your Windows PC.

1. Go to the [latest release](https://github.com/daniellmnz/dashcam-player/releases)
   and download the file ending in `.msi`.
2. Double-click the downloaded file to install it. If Windows warns you about an
   unknown publisher, choose **More info** → **Run anyway**.
3. It installs per-user into `%LOCALAPPDATA%\Programs\DashcamPlayer`, needs no
   administrator rights, and takes only a few seconds.
4. **Do this once, before anything else:** open **Dashcam Player tools** — a
   shortcut the installer puts on your desktop — and double-click **Install as
   Edge app**. Edge opens at `http://localhost:8777/`; install the page as an app
   from the **App available** button at the right-hand end of the address bar.
   This step is what makes the folder permission stick: Edge only makes folder
   permissions permanent for installed apps. Without it you re-authorise the
   recording folder every session, and the single-camera export button never
   appears at all, because a plain browser page cannot start a program.
5. Run **Dashcam Player**, from the Start menu or the desktop shortcut.
6. Plug the car's USB drive into your PC and choose that drive in Dashcam Player.
   When it asks for permission to the folder, pick **Allow on every visit** so it
   reopens by itself next time. Your dashcam and sentry recordings should now be
   listed.

### ffmpeg

ffmpeg must be on your `PATH` for the export tools; everything else works
without it. The installer fetches it with winget when it is missing — after
the install finishes, in its own process, so a slow or failed download cannot
stall or undo the install — and the player fetches it again whenever it finds it
missing, at start-up or after an export fails for want of it. A button offers
to try again if an attempt failed. No restart is needed either way: the helper re-reads the `PATH` from
the registry rather than waiting for a new session.

## How it fits together

| | |
|---|---|
| `src/dashcam-player.html` | The whole player: one page, one inline script, no dependencies |
| `src/dashcam-server.ps1` | A local helper that serves the page and starts the tools |
| `src/DashcamPlayer.ps1` | The launcher — starts the helper, opens the browser |
| `src/Run-Tool.ps1` | Finds the recording and runs the right batch file |
| `src/Install-FFmpeg.ps1` | Fetches ffmpeg with winget when it is missing |
| `src/split-views.bat` | ffmpeg: one camera out as its own file |
| `src/rectify-fisheye.bat` | ffmpeg: straighten one camera view |
| `src/DashcamPlayer.md` | The user guide, installed alongside the app |
| `installer/` | The WiX source and build script for the `.msi` |
| `tests/` | The regression suite |
| `tools/repin-csp.py` | Re-pins the page's CSP hash after editing its script |
| `tools/msi-table-order.py` | Checks, and repairs, the row order inside a built `.msi` |

The page is served over `http://localhost:8777` rather than opened as a file,
because a browser only makes folder permissions permanent for an installed
app, and a `file://` page can never be installed. The helper shuts itself
down a few minutes after the page stops pinging it.

## Building the installer

Needs `wixl` and `msitools` (`apt install wixl msitools` on Debian/Ubuntu):

```sh
cd installer && ./build.sh
```

The version lives in exactly one place — `<?define Ver ?>` in
`DashcamPlayer.wxs` — and the ProductCode is derived from it, so rebuilding a
version reproduces its code. Both are checked by the suite.

`wixl` cannot parse `<RemoveFile>`, so those rows are added afterwards with
`msibuild` and then sorted into key order by `tools/msi-table-order.py`.
Windows Installer binary-searches a table's rows and refuses a package whose
rows are not stored sorted by primary key — with `Error 2211: Could not
create database table`, naming nothing useful. The sort key is a string's
index in the package's string pool, which the allocator hands out by reusing
freed slots, so the order cannot be arranged from the input. The suite checks
the built package.

## Editing the page

`src/dashcam-player.html` pins its Content-Security-Policy to the sha256 of
its own inline script, so the browser refuses to run the page if a byte
changes. After editing the script:

```sh
python3 tools/repin-csp.py
```

The suite fails loudly if you forget, and says this.

## Running the tests

```sh
npm install --prefix tests
tests/run-tests.sh
```

Seventy-six checks covering the page, the helper, the launcher and the
installer. Several need PowerShell, ffmpeg or a Chromium build and skip
themselves if those are absent; the rest run anywhere.

Three environment variables, all optional:

| Variable | What it does |
| --- | --- |
| `DCP_CHROMIUM` | The browser the pixel tests drive. The runner looks for one on the PATH and in Playwright's cache; set this to name another. Without a browser those checks skip. |
| `DCP_SAMPLES` | A folder of real `.mp4` recordings for the MP4 parser check. None are kept in this repository — they are large, and they are somebody's own driving — so that check skips unless you point it at some. |
| `DCP_SRC` | The folder to test instead of `src/`, so a built release can be checked rather than the working tree. |

They test the **shipped files**, not copies — patterns, filter graphs and
option lists are read out of the real scripts, so a test cannot quietly drift
from the code it checks. Where a layout question is being asked, the answer is
measured in a browser rather than reasoned about.

## Credits

Written by [daniellmnz](https://github.com/daniellmnz) with [Claude](https://claude.ai),
Anthropic's AI assistant, which co-authored the code, the tests and this document.

## Licence

GNU General Public License v3.0 — see [LICENSE](LICENSE).

Copyright (C) 2026 daniellmnz

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
A PARTICULAR PURPOSE. See the GNU General Public License for more details.
