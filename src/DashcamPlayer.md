# Dashcam Player

**Version 1.60.1 · 18 October 2026**

Plays 7X Dashcam recordings, splits the combined frame back into its separate
camera views, and generates the ffmpeg commands to export them.

This release is version 1.56.0's player again. Versions 1.57 and 1.58 read the
latitude and longitude out of the burnt-in status strip, to show where a frame
was taken and to save a drive as a GPX route. Reading digits off a compressed
picture proved too unreliable across different recordings — the strip's layout
and contents change with what the car app is set to show — and the feature was
withdrawn rather than left to be half-trusted. Nothing else differs from
1.56.0; the version number is higher only so this installs over 1.58.1 in the
ordinary way.

---

## Starting it

A **Dashcam Player** shortcut is placed on the desktop as well as in the Start
menu, and both are refreshed by every upgrade. Shortcuts you copy or pin
yourself keep working too: their icon points at the installed `DashcamPlayer.ico`,
whose path never changes between versions. If an icon ever does go blank, run
**Fix shortcut icons** from the Start-menu folder — it repairs every Dashcam
Player shortcut it can find, including pinned ones.

**Single view into separate file** and **Rectify fisheye view** in the
Start-menu folder run the two ffmpeg scripts for you. Each asks whether to work
on a whole folder or a single recording, then on which, and runs there — so
there is nothing to copy about. The split script reads each file's own picture
size, so it handles the 2x2 recordings with or without the status strip, and
the older stacked ones, with no editing. Both need ffmpeg on your PATH, and say
so plainly if it is missing — see *Installing ffmpeg* below.

The two are meant to be used in that order: split the camera you want out of
the four-camera frame, then straighten that file.

**Open install folder** in the Start-menu folder opens
`%LOCALAPPDATA%\Programs\DashcamPlayer`, where the two ffmpeg scripts live.
Edit them there if you want to change the encoder, quality or
whether the status strip is stacked under each view. A second desktop shortcut, **Dashcam Player
tools**, opens the Start-menu folder with every entry in it.

**Start menu → Dashcam Player.** That starts a small local server and opens the
player in its own window. Close the window and the server stops on its own.

## One thing worth doing once

Run **Install as Edge app** from the Start-menu folder. Edge opens a normal
window; click the **App available** button at the right-hand end of the address
bar, then **Install**.

This matters for one reason: Edge only makes folder permissions permanent for
*installed* apps. Once installed, choose your recording folder and pick
**Allow on every visit**, and the player reopens that folder by itself every
time. Without it you re-authorise the folder each session.

---

## Using it

Choose the recording folder, or drag it onto the window. If the folder you pick
contains **DCIM** or **SentryMode**, only those are scanned; everything else on
the drive is left alone, including the recycle bin and anything beginning with a
`$`. Pick one of those folders directly and it is scanned as it stands. Everything is read on
your own machine; nothing is uploaded.

**The control bar** sits above the video rather than below it, so that
cropping, zooming or switching camera never moves it. Below the video it
followed the picture's height, which slid the buttons up and down as you
adjusted the trim and, with a tall grid, pushed them off the bottom of the
window. The picture starts directly beneath the bar rather than floating in
the middle of the frame, and **Play** and the scrub bar sit under the picture,
exactly its width — they belong to what you are watching rather than to the
settings.

**The segment list** shows the time each recording started and its size, newest
first. Only the most recent day is open to begin with — both its video and its sentry
alerts — and every earlier day is folded away. Click any heading to open or
close it; the state lasts until the folder is reloaded.
Tick **Oldest first** to reverse it, or **Show file names** to add the
filename under each one. Next and Previous follow whichever order is on screen.

**Rebuilding in bulk.** When a folder holds recordings the recorder never
finished writing, a **Rebuild N incomplete files** button appears under the
folder buttons. It rebuilds each one and writes it back into the same folder as the
original, named `…_rebuilt.mp4`, showing how far through each file it is. The result — how many were written, and
anything that could not be — waits for **OK** before the folder is reloaded,
since reloading clears the panel and that summary is the only record of what
happened. Edge will
ask once for permission to write to the folder. Tick **Rebuild incomplete files
automatically** to have it happen whenever a folder is opened; the button then
stays out of the way, since the work is already in hand. It reappears only if
that automatic pass finishes with something still unrebuilt, which means it
failed and is worth a deliberate retry. The automatic pass runs once per
folder: rebuilding re-reads the folder when it finishes, so without that limit
a file that cannot be rebuilt would start the whole pass again on every
reload. Recordings that
already have a rebuilt copy are left alone, so running it again costs nothing.

Writing back needs the card or folder to have been opened with **Choose
recording drive or folder**; picking individual files gives no write access, and the single-file
rebuild offers a download instead.

**Sentry events.** Alerts recorded in sentry mode are picked up from the
`SentryMode` folder, where each event has its own folder holding the clip, a
still and `info_inner.txt`. They are listed under their own **Sentry alerts**
heading, and a panel shows when the alert triggered, where it happened as a
link to a map, the still that was captured, and how far into the recording the
alert sits, with a button to jump straight back to it.
A sentry clip opens with the playhead already two seconds before the trigger,
rather than at the start of the recording — on these cars the event is around
a minute in, with the minute before it kept as the lead-up. Untick **Include sentry events** to leave
them out of the list.

**Skipped files.** Each file is checked before it is listed, and anything that
cannot play is left out and counted in the line under the buttons; tick
**Show incomplete files** to see them and why. The test is structural rather than
size-based — a short recording can be perfectly sound. A file with no index was
cut off before the recorder could finish writing it: power lost, card removed,
or the app closed mid-recording. The frames are usually intact, so the player offers to
rebuild it: click the file, then **Rebuild this recording**. It reads the frames
straight out of the file, takes the decoder settings from a healthy recording by the
same camera, and writes a complete MP4 around them — no re-encoding, so the
picture is bit-for-bit the original. Each playable recording is tried in turn until one
supplies matching settings, and the result is checked for playability before it
is offered, so a wrong reference cannot produce a dud file. Files that were
converted to H.264 or split into single views cannot serve as references — they
are a different codec or a different picture size. Save the result into the
recording folder and choose the folder again.

What is lost is the frame timing table, which went with the index; timings are
rebuilt at the reference recording's average frame rate, so the clip plays at the right
speed with evenly spaced frames. Anything after the last complete frame is left
off.

**Views.** The player works out how the cameras are packed into the frame and
cuts them apart. Front, rear, left and right can be viewed one at a time or as a
grid, and the **In grid** checkboxes choose which appear. A vehicle status strip,
if the recording has one, is drawn beneath the views in every mode.

**Settings**, at the right-hand end of the bar, holds everything you set
once and then leave alone: trim, lens correction, the whole frame's size, the
three tick boxes, the folders to scan and **Reset settings**. What an export
will contain is asked at the moment of exporting instead, beside the frame it
decides. The bar itself
carries only what you reach for while watching. A setting that cannot act on
what is on screen is dimmed rather than hidden, and the panel says why — but
the button itself never dims, because most of what is behind it applies
whatever is on screen.

**Trim** removes a percentage from the top and bottom of each view — useful for
cutting a bonnet reflection or an expanse of sky.

**Lens** corrects the fisheye curvature on the GPU. Raise it until straight
lines look straight; around 20–35% suits most surround cameras. Correcting
always crops, so **zoom** below 1.0 to pull more of the frame back into view.

### Export quality

**Quality**, in the export question, chooses how hard the encoder tries when
writing a clip: **Standard**, **High** or **Maximum**. High is the default.

The tools encode by *quality*, never by a fixed bitrate. A bitrate target would
spend the same number of bits on a still car park as on rain at night, which is
the wrong way round; a quality target spends what the picture needs. So the
bitrate that comes out depends on the footage as much as on the setting, and
each export now prints the figure it achieved.

One thing is worth knowing before comparing an export against its source. A
single view is a **quarter** of the 2560×2660 recorded frame, so a quarter of
the recording's bitrate is the like-for-like figure, not the whole of it. A
20 Mb/s recording that splits into 5 Mb/s views has lost nothing to the split.

Measured on a synthetic 20 Mb/s recording, cutting one view and comparing each
result against a lossless cut of the same crop:

| Level | Bitrate | Quality vs the source |
| --- | --- | --- |
| Standard | ~3.3 Mb/s | 47.6 dB — what this wrote before |
| High | ~4.6 Mb/s | 51.2 dB |
| Maximum | ~5.5 Mb/s | 52.7 dB — about the recording's own bits per pixel |

Some of that is free. On the same quality number, x264's `fast` preset produces
a file the same size as `veryfast` and measurably better, so the higher levels
move the preset as well as the number.

Frame rate is not a setting and never was: nothing in either tool resamples it,
so an export runs at the recording's own rate with the same number of frames.

### Whole frame size

**Whole frame · size** draws the whole-frame view smaller, from 100% down to
50% in tens. It is the tallest thing the player shows — four cameras and the
status strip stacked, 2560×2660 — and on a wide window it will take all the
height it is given.

A frame more than twice as tall as it is wide is *folded* first: it is cut into
equal bands and the bands are laid out the way the grid lays out cameras, which
for four of them is a square. The OpenAVM recorder's 1280×5140 strip would
otherwise be a ribbon down the middle of the stage, with the width of the
window wasted either side of it and every camera too small to see. Nothing is
left out — the bands cover every row of the picture, gaps between the cameras
included, which is what still tells this view apart from the grid. A frame that
is already about as wide as it is tall, like the 2560×2660 above, is shown as
it is. This is the one setting that applies *only* to the whole
frame, so it is live exactly where trim, lens and the status strip are dimmed.

It changes how large the picture is drawn and nothing else. The frame behind it
is still at full resolution, so a snapshot taken at 50% is the same size and
sharpness as one taken at 100%, and an export is untouched — the same bargain
as trim, lens and zoom.

**Snapshot** saves the frame on screen as a JPEG. The dialog opens in
`Dashcam and Sentry exports\snapshots`, alongside the split and rectified
files, making the folder the first time it is needed — you can still save
anywhere you like. It asks where to put it,
suggesting a name taken from the recording and the position within it — for
instance `20261010_140247_surround_Front_2m33s.jpg` — so successive snapshots
of one recording do not land on top of each other. Whatever is on screen is
what is saved: the current view or grid, the trim, the fisheye correction and,
if **Show time on frame** is ticked, the time.

### Keys

The **?** in the bar opens a summary of everything the player does, with
this list at the end of it.


| | |
|---|---|
| `space` | play / pause |
| `←` `→` | back or forward 5 seconds |
| `shift` + `←` `→` | one frame |
| `1` – `4` | front, rear, left, right |
| `g` | grid |
| `a` | whole frame |
| `n` / `p` | next / previous segment |
| `i` / `o` | clip in / out point |
| `c` | clear the clip |

### What is shown

A **Sentry alert** panel appears for sentry recordings, with the trigger time,
position, alert window and the still that was saved. The still carries the
name of its camera in the corner, the way each pane of the grid does.

Which camera comes from the `az` field in `info_inner.txt` — the recorder's
own numbering, which is **not** the order the grid uses:

| `az` | Camera |
| --- | --- |
| 1 | Rear |
| 2 | Left |
| 3 | Right |
| 4 | Front |

All four seen on real alerts. The order follows no pattern — it is not the
grid's, and it is not back/front then right/left either, which is what it was
first taken for and what it turned out not to be. A still that says nothing
about its camera — and the
recording's own name, `..._alert_360`, says only that the clip holds all four —
is left unlabelled rather than given a guess.

**Jump to the alert** goes to the moment — two seconds before it — and switches
to the camera the alert fired on, so what set it off is on screen rather than
somewhere off it. The camera is matched by name, never by position: the panes
are ordered by the recording's own layout, so the left camera is not reliably
the third of them. An alert that does not say which camera leaves the view
alone. Everything else about a
recording — its time, size and filename — is in the list on the left.

---

## The recorders

Two systems are in use here and they do not agree about anything much: where
the files go, what they are called, or how the four cameras are packed into a
frame. The player works all three out from what it finds rather than being
told.

**Folders.** `DCIM` and `SentryMode` for one recorder, and `Download/OpenAVM`
for the other — which until recently wrote to `Movies`. All four are in the
**Folders** setting, and an entry may be a path rather than a single top-level
name, because that is what the move required.

The setting is stored, so a stored one would normally win over a new default —
which would have meant that adding `Download/OpenAVM` reached nobody who
already had the player installed. A stored list that is exactly one this player
has shipped as its default was never chosen by anybody, so it is brought up to
date on the next launch. A list that has actually been edited is left alone.
If nothing turns up, the message says which folders were looked in. A card opened at its
root is scanned only in those folders; a folder opened from inside the
recordings is read as it stands.

**The column layout.** OpenAVM 5.1 stacks its four cameras in one 1280-wide
strip 5140 pixels tall, and then — no encoder will take a picture that tall —
cuts the strip into three 1728-row chunks and lays them side by side. What is
in the file is 3840×1728. What the sidecar describes is still the tall
picture, which is the right way round: that is what was recorded.

The consequence is that a camera is no longer a rectangle in the file. Only
the first survives whole, in the top of the first column; the second is 440
rows at the bottom of column one and 840 at the top of column two, and so on
down. So the player puts the tall picture back together once per frame and
everything downstream — the lanes, the status strip, the trim, the lens
correction — carries on working in the coordinates the sidecar uses.

It does that only when the file agrees with the description: if a sidecar
claims a layout the video does not have, or one whose own figures do not add
up, the picture is left exactly as it is. Taking a good frame apart on the
strength of a bad description would be the worse failure of the two.

Exporting works too, and it has to be told how. The tools work the four
cameras out from the frame's own shape for every other recorder, and there is
nothing in this frame's shape to work out — nor can a `.bat` read the sidecar
that describes it. So the player sends the rectangles with the request: each
camera as ffmpeg's own `crop` takes it, `w:h:x:y`, with the pieces of one
camera joined by commas and the cameras by semicolons, in the order the player
shows them. The two that straddle a column join have two pieces each; stacked
back up in the order given, they are the camera.

The tools splice those pieces in whole. They parse none of it and calculate
nothing from it — which is why the numbers are in ffmpeg's order rather than
the player's, and why the test that covers this takes the filter strings out of
the batch files and runs them against a real recording rather than reading
them. Run by hand, with nothing to send them, both tools fall back to the
frame's own shape exactly as before.

## Where the file is

Under the picture, the player shows the full path of the recording on screen,
followed by its bitrate and frame rate. Clicking the path opens File Explorer
with that file selected; the figures beside it are not part of the link.

The bitrate is the whole file over its own length — the container's rate,
audio and all, which is the same measurement ffprobe reports and the same one
the export tool prints when it finishes. Comparing an export against its
source is the reason it is on screen, so the two have to be the same
measurement. One view is a quarter of a 2560×2660 frame, so a quarter of the
recording's figure is the like-for-like comparison, not the whole of it.

The frame rate comes from the sidecar where there is one, and otherwise is
read out of the file's own index — properly, walking to the video track rather
than taking the first media header in the file, because a recording with sound
has two and the audio one would read as tens of thousands of frames a second.
It is the average across the track, since these recorders vary the interval
between frames. Either figure is left out when nothing can say, rather than
estimated.

Strictly, the player does not know that path. The File System Access API hands
a web page a name and a handle and never a location, which is the root of
every awkward thing in the next section. What it does have is the helper's
answer: the helper searches for the mark the page leaves in the folder that
was opened, and writes down where it found it. The player reads that back and
hangs the file's own path within the folder off the end of it.

So until the helper has answered, the line shows only the path *within* the
folder you opened, followed by **finding full file path**. It never invents the rest.
A page opened straight off the disk rather than served by the helper has
nothing to wait for, and says *inside the folder you opened* instead. If the
search came up empty, the **Tell the exporter where this folder is** button
described below settles it, and the line fills in.

The link sends the helper a file name and a folder relative to the one it
located for itself, never a path: the page has none to send, and the helper
will not take one. It is the same pair of values an export already sends.

## Exporting

Choosing a folder leaves a small file in it — `.dcp-folder` inside
`Dashcam and Sentry exports`, holding a random number — and tells the helper
to go and find it there and then, while nothing is waiting. That is the only
moment the page has the folder in its hands, and the number lets the helper
be certain which folder it has found rather than trusting a name two cards
might share. By the time an export is pressed, the answer is usually already
known.

The page can never tell the tool a full path — the browser does not expose
one — so the tool searches: the folder the last export used, then the same
relative path on every drive, then a hunt for the opened folder by name
across every drive, the home directory and everything in it, and OneDrive.

If even that comes up empty, a button appears under the folder hint:
**Tell the exporter where this folder is**. It opens one folder dialog, at a
moment of your choosing, and remembers the answer for good. Settling it there
is worth doing, because the alternative is meeting the same question
halfway through the first export, as a file dialog headed **Confirm the
recording to split** — which is where this used to turn up unannounced.

While a clip is being written the panel shows how far along it is and offers
**Cancel**. That really does stop it — the whole tool, ffmpeg included, rather
than just leaving the page to stop watching. A part-written file may be left in
the folder; it is written over next time, because both tools now check that an
output already there is actually usable before deciding there is nothing to do.

Before anything runs, the player shows one frame of what it is about to write,
with **OK** and **Cancel** — Enter and Escape answer it too. The frame is the
camera as the export tool will cut it, with the status strip beneath it if the
recording has one, and *without* the trim, lens correction or zoom: those are
ways of looking at a recording and none of them reach the file.

Several boxes sit in the question, and each one redraws the frame and changes
what gets written — together. That is the point of having a last look: "it is
still bent" and "I do not want that band of vehicle data" are the things the
last look catches, and fixing one should not mean cancelling and starting
again.

**Rectify fisheye** straightens the lens curve on the way out. On a recording
that is already one camera the box is absent, because straightening is the only
thing left to do to it. It used to live on the control bar, where it could be
ticked minutes before the preview that would have shown it was the wrong choice.

**Include the vehicle status strip** decides whether the band of vehicle data is
stacked under the exported picture. It appears only when the recording has one.

**Apply the top and bottom trim** appears only when straightening, and only
when there is a trim set to carry. It is the one deliberate exception to the
rule that the way you look at a recording never reaches the file: straightening
leaves sky above and bonnet below that there is usually no reason to keep. It is
off unless you ask for it, and the crop happens *after* the correction, the same
way the player does it on screen — cropping the fisheye circle first would feed
the correction a different picture from the one it was measured for and bend
what was left.

**Draw the time onto the picture** burns the date and time into the exported
file. The clock the player paints over the picture while it plays stays in the
player: a clip opened in anything else, or sent to somebody, carried no time at
all. This writes it in, bottom right of the picture and above the status strip,
in the player's own wording — `Wed, Oct 14, 2026  14:03:13`, without the tenth
of a second, which ffmpeg cannot count.

The tool is told one number, the instant the first exported frame was recorded,
and ffmpeg adds each frame's own timestamp to it as it goes — so a marked clip
reads the time it was really recorded at rather than starting from the top of
the recording. A time-lapse recording is the one case where the box is not
offered at all: its wall clock advances faster than it plays, there is no way
to tell ffmpeg that, and a stamp that is quietly wrong is worse than none.

Two things have to hold for it to be drawn, and the tools check both rather
than assuming them: a font file has to exist in `C:\Windows\Fonts`, and the
filter has to run on whichever ffmpeg is installed — tested once against a
fraction of a second of black before any real work. Either failure prints a
line and exports without the clock. A missing stamp is a small disappointment;
an export that will not start because of one is not.

**Quality** is here too, rather than in Settings, because it belongs with the
frame it decides. Every answer is remembered for the next export.

With **Rectify fisheye** ticked the previewed frame is straightened as well,
using the same fisheye-to-flat mapping ffmpeg will use and the `IFOV` and
`DFOV` at the top of `rectify-fisheye.bat`. It is worked out one pixel at a
time in the page rather than by ffmpeg, so it is an approximation — measured
against ffmpeg's own output it agrees to about 1% per pixel, which is close
enough to judge the framing by. Change `IFOV` or `DFOV` in the batch and the
preview no longer matches what the tool will write.

The quickest route is **Export clip** on the player's control bar: it
hands the recording you are watching to the split tool, and that camera is
written to `Dashcam and Sentry exports\split`, at the top of the drive or
folder you opened. Nothing to confirm: the page
cannot know a file's full path, but it does know the path relative to the
folder you opened, and the tool finds the file from that plus the folder the
last run used. It only asks for the file when that fails — the card is
unplugged, or two drives hold the same path, where guessing would split the
wrong one. The button appears only while you are watching **one
camera** — not in Grid or Whole frame, where there is no single view to write,
and not on a file that is already a single view. It also only appears when the
page is served by the installed app,
because a plain file opened in a browser cannot start a program, and the page is
only ever given a file's name, never its path, so the file picker is there to
supply the folder.


When it finishes, the panel names the folder the file went to and that path is
a link: clicking it opens the folder in File Explorer. The page cannot do that
itself — a browser will not open a folder, and will not follow a `file://` link
from a served page at all — so the installed helper opens it. The helper is
sent nothing: it reads the folder back out of the status file the tool itself
wrote, rather than taking a path from a web page and handing it to Explorer.
If it cannot be opened for any reason, the path is still there to read.

If a run fails, the panel repeats what ffmpeg itself said rather than only the
exit code. The tool runs hidden when the player starts it, so there is no
console for those messages to appear in; they are captured and carried back
instead, with the hardware-probe noise and the final summary line skipped so
that what you see is the line that names the problem.

### Writing part of a recording

**In** and **Out** appear beside the Play button on a four-camera recording.
They mark a clip. Press **In** where you
want it to start and **Out** where it should end — keys `i` and `o` — and the
marked span appears on the timeline: a pointer at each mark and a bar between
them, with the exact range beside it. The in pointer shows as soon as you set
it, before there is an out point to pair it with. The button reads **Export clip** whatever it is about to write — which kind of clip, and whether it is the whole recording or only the marked part, are settled in the question that follows and said in the tooltip.
`c`, or the `×` next to the range, clears the marks and goes back to the whole
recording.

Either pointer can be dragged along the timeline to adjust where the clip
starts or ends, and the picture follows as you drag, so you can see the frame
you are landing on. Click a pointer and the arrow keys nudge it a tenth of a
second at a time, or a whole second with `Shift` held. The two cannot be
dragged past each other: whichever you are moving stops just short of the
other.

They are not offered on a recording that is already a single camera: there is
nothing left to split out of it, so there would be nothing to write the marked
range to.

The marks belong to the recording on screen and are cleared when you open
another, so a clip can never be cut from the wrong file. An out point set
before the in point moves the in point rather than refusing.

A clip is written as `..._Front_clip12.mp4`, the number being the second it
starts at, so it never overwrites a full export of the same camera and you can
tell the two apart afterwards.

The run reports itself in the main window, as a rebuild does: the camera and
file being written, then a percentage, then the result with an **OK** button.
Nothing else appears on screen — the tool runs hidden, and the percentage
comes from ffmpeg itself. Opening any recording dismisses the panel, so a long run never traps
the viewer.

Split and rectified output is listed under its own **Single view video** heading, the
way sentry alerts are, with each row naming the camera. When the run finishes,
the folder is re-read and the new files appear in the list by themselves, with
whatever you were watching restored at the same position. Groups keep whatever
you had open: a refresh after a split is not a fresh open, so it does not go
back to collapsing everything but the newest day, and the group the new files
landed in is opened even if it was shut.

A file whose name ends in the view — `..._Front.mp4` — is shown as
that single camera rather than being carved into a grid, with the status strip
kept beneath it if the tool stacked one there.

The same tools are in the Start-menu folder as **Single view into separate
file** and **Rectify fisheye view**. Split always works on one recording.
Rectify asks whether to do one file or a whole folder.

Everything the tools write goes to one place: a **Dashcam and Sentry
exports** folder at the top of whatever card or folder you opened, with
`split`, `rectified` and `snapshots` inside it. Run from the Start menu on a folder you
pick yourself, that folder is the top.

The player runs the same tool on the recording you are watching without leaving
the page: **Export clip**, then **Rectify fisheye** in the question that
follows. The answer is remembered, so the next export opens the same way. On a
file that is already one camera there is no choice to make, so the box is
absent and the export straightens it: split first, straighten what you kept. It
takes the same In and Out marks either way, and the tooltip says what it will
write. A clip is named for where it starts, so straightening part of a
recording never overwrites the whole one beside it.

Playing one, the only view offered is **Whole frame**. It holds a single camera
that is already flat, so there is no grid to break up and no second camera to
switch to; a lane button beside it was a choice between a picture and the same
picture. Opening one puts the player in whole frame without making that the
remembered view, so the next four-camera recording opens as it always did.

A straightened file is 1280×960 — 4:3, not square, because straightening maps
the fisheye circle onto a flat plane of its own proportions — with the status
strip stacked under that. Trimmed, the picture is whatever height the trim
leaves, and the player cannot then work out where the strip starts by
proportion, so the tool writes the picture's height into the name:
`..._pic604_rectified.mp4`. Without it the strip is read as part of the
picture and the burnt-in clock sits on top of the vehicle data. The player works the picture's height out from the
file's width for exactly this reason: it assumed square for both kinds of
export once, which made the strip under a straightened file read as part of the
picture and put the burnt-in clock on top of the vehicle data.

A straightened file carries `_rectified` on the end of its name, and the player
reads that. Such a file is listed under its own **Rectified video** heading
rather than among the plain split ones, and the **Lens** correction is not
applied to it a second time — the slider says "already straightened" and is
disabled while one is open. Trim and zoom still apply: those are framing, not
lens correction.

Files written before version 1.43.4 carry the older `_dewarped` mark and sit
in a `dewarped` folder. Nothing renames them, and nothing needs to: the player
still reads that mark, still lists those files as rectified, and still declines
to straighten them twice.

**Rectify fisheye view** in the Start menu straightens one camera and writes one file, into a
`Dashcam and Sentry exports\rectified` folder, at the top of the drive or
folder you opened. Give it a file the split tool wrote — one whose name ends
with `_Front`, `_Rear`, `_Left` or `_Right` — and it straightens that view as
it stands. Given a whole four-camera recording it takes a single view out of
the grid rather than writing all four; which one is the `VIEW` setting at the
top of `rectify-fisheye.bat`, 1 for Front through 4 for Right, and Front to
begin with.

The name matters, and not only for tidiness: a single 1280×1330 view and a 2×2
grid with a status strip are the same shape, so nothing in the picture can tell
them apart. Rename a split file and lose the `_Front` on the end, and the tool
has no way to know it is not a grid.

The rectified file comes out 1280×960, which is 4:3. The shape is the `OW` and
`OH` pair at the top of the batch file, and changing it does not stretch the
picture: it maps angles to pixels, so for a given `DFOV` a wider frame
shows more to the left and right and less sky and bonnet, while a car stays the
shape a car is. `1280×800` is 16:10 and `1280×720` is 16:9, each wider and
shorter than the last. 4:3 was kept after trying the others against real
footage.

If you want the picture genuinely stretched — everything in the frame wider than
life — that is the separate `STRETCH` setting, a percentage of the width, `100`
and therefore off to begin with. `115` is a noticeable stretch and writes a
1472×800 file. It is geometrically wrong by design, which is the whole point of
keeping it apart from the frame shape above.

While a split runs it shows one percentage rather than ffmpeg's running
statistics. Because the progress is piped, ffmpeg's exit code is lost — and
ffmpeg reports "progress=end" even when it fails — so the script judges a run
by checking that every requested file exists and that ffprobe can read a video
stream from it. Any real error still prints above the percentage.

Both scripts pick their encoder by trying one: the graphics card first, then
Quick Sync, then AMD's, ending at the processor, which always works. They used
to name NVENC outright, which meant a machine without an Nvidia card could not
export at all — it stopped with "Cannot load nvcuda.dll". The line it prints
as it starts says which one it settled on. Set `ENC` at the top of either
script to name one yourself and skip the test.

Both scripts read each file's own picture size, so they handle the 2x2
recordings with or without the status strip, and the older stacked ones, with no
editing. Each run prints the frame size, the view size and whether the status
strip is being stacked, so it is clear what was detected.

### Making a split faster

A graphics card has **one** encoder block. Four views are four separate encodes
queued on that one block, so the card — not the CPU, the disk or the decoder —
is what sets the pace. On a 10-minute recording, one view runs at about 22×
realtime and all four at about 5×: almost exactly proportional, which is the
signature of a saturated encoder.

Two things follow from that, and both are already set up:

**Two encoders at once.** `ENC2=auto` tests whether the Intel Quick Sync
encoder — separate silicon from the graphics card — actually starts, and if it
does, every other view is encoded on it. The two engines then work in parallel
instead of queueing, which roughly halves a four-view split. The startup lines
say which way it went. An encoder appearing in `ffmpeg -encoders` proves only
that the build includes it, so this runs a fraction of a second of real encoding
rather than trusting the list. Set `ENC2=` to go back to one encoder.

**Fewer views.** The player's button exports only what is on screen, so watching
one camera and splitting it is about four times faster than splitting all four.

The rest, all at the top of `split-views.bat`:

| Setting | Effect |
| --- | --- |
| `VIEWS` | `1,2` writes Front and Rear only. 1=Front 2=Rear 3=Left 4=Right. The player's button sets this to the camera you are watching. |
| `QUALITY` | `standard`, `high` or `maximum`. The player's **Export quality** sets this; run by hand, what is in the file is used. |
| `ENC` | Named outright, skipping the auto-detection. The three quality levels set this for you. |
| `VIEWW` | Shrink each view before encoding. `960` instead of the full `1280` is roughly half the pixels, so roughly half the encoding. |
| `START`, `DUR` | Export only the part you care about. Cost is proportional to length. |

`HWDEC` is already `-hwaccel auto`, which puts the HEVC decode on the GPU.
Clearing it, or swapping `h264_nvenc` for `libx264`, makes things markedly
slower again. More CPU cores and a faster disk will not help: all the views
share a single decode, and the encoders are the constraint.

Both are plain batch files in the install folder. Open them to change any of the
above, whether the status strip is stacked under each view, and whether audio is
kept.

### Installing ffmpeg

ffmpeg is the only thing the player needs that does not come with it, and only
the export tools need it.

**The installer fetches it for you.** When the `.msi` finishes it checks
whether ffmpeg is already on your PATH, and if not it quietly asks winget for
the package winget calls *FFmpeg (Essentials Build)*. That runs on its own
after the install has closed, taking a minute or two, so the installer never
sits waiting and a download that fails cannot undo the install. Open the
player while it is still going and it says so.

**The player fetches it whenever it finds it missing** — when it starts, and
again if an export fails for want of it, which is what happens if ffmpeg is
removed while the player is open. Finding it gone is reason enough; nothing
has to be pressed. Only one fetch runs at a time, so opening the player while
one is under way follows that one rather than starting a second.

An attempt that fails is not repeated on its own — a PC without winget would
otherwise be asked again every time anything looked. An **Install ffmpeg**
button then appears beside **Export clip**, and pressing it tries
again and reports what happened.

Nothing has to be restarted afterwards — not the player, not Windows. winget
writes the new folder into your PATH in the registry, and the helper reads the
PATH back from there, so the tools it starts next can see ffmpeg straight
away. (A Command Prompt you already had open is a different matter: that
window keeps the PATH it was started with, so open a new one.)

It needs no administrator rights. The package is a zip, unpacked into your own
AppData with winget's link folder added to your PATH.

Nothing is installed behind your back on uninstall or repair: the fetch is
skipped when ffmpeg is already there, and never runs when you are removing
the app.

To do it by hand instead:

    winget install --id Gyan.FFmpeg.Essentials -e

If winget itself is missing — Windows 10 before 1809, or a PC where App
Installer has been removed — the button will say so. Install App Installer
from the Microsoft Store, or download a build from ffmpeg.org and put the
folder on your PATH yourself.

---

## If something does not play

**Nothing plays, and the panel says your browser has no H.265 support.** Check
`edge://gpu` — or `chrome://gpu` — and look under *Video Acceleration
Information* for a line reading **Decode hevc main**. If it is absent, or Video
Decode reads "Software only", graphics acceleration is off: turn on **Use
graphics acceleration when available** in `edge://settings/system` (or
`chrome://settings/system`) and restart the browser completely. Chromium has no
software H.265 decoder at all, so with acceleration off these recordings cannot
play whatever else is installed — which is also why the browser reports no
H.265 support rather than merely failing to play a file.

Paste those addresses into the address bar rather than expecting a link to
them: a web page is not allowed to open a browser's settings page.

On Edge there is a second requirement — the **HEVC Video Extensions** from the
Microsoft Store. Chrome decodes HEVC without it. Firefox does not decode HEVC
on Windows at all. There are fuller instructions for both browsers at
<https://github.com/StaZhu/enable-chromium-hevc-hardware-decoding>.

**It plays but stutters.** Very tall frames exceed what GPU decoders accept
(usually 4096 pixels), forcing software decoding. Splitting the recording into
separate files fixes it permanently.

**The folder is asked for every time.** The app is not installed in Edge — see
*One thing worth doing once* above.

---

## Deleting recordings

With a folder open, each file in the list has a tick-box, and so does each
group heading. The heading's box covers every file under it, so a whole day
goes in one tick rather than nine; it works whether the group is open or
collapsed. Tick some of a group's files by hand and its heading shows
part-ticked, so it never claims more than is true. Tick what you no
longer want and a **Delete n selected files** button appears at the foot of the
sidebar. Its space is held from the moment a folder is open, so the button
appearing never shifts the list — above the list it used to shorten it, which
could slide the row you had just ticked out of sight. It
names what it is about to remove and asks once; there is no undo, and nothing
goes to the Recycle Bin — these are removed from the card itself. The browser
will ask for permission to change the folder the first time.

A recording's `.json` sidecar is deleted with it, by the name it was found
under or, if it never paired with the recording, by the name derived from it.
That matters more than it sounds: left behind, the next scan lists the sidecar
as a recording whose video file is missing — so the row you just deleted comes
straight back, and opening it says there is no video, which is quite true. The
deletion worked and the list looked as though it had not.

If a sidecar genuinely cannot be removed, the message says so and says that
those recordings are still listed with no video, rather than reporting a clean
delete and leaving the row to be puzzled over.

A sentry alert is a folder rather than a single file — the clip, the still
captured when it fired, and `info_inner.txt` — so deleting the clip takes the
other two and the folder with it, and the confirmation says so before it does.
The folder is only ever removed once it is empty: another `.mp4` in there, or
a subfolder, and the whole thing is left untouched rather than guessed at.

The browser gives the page no way to reach a folder except through **Choose
recording folder**, so that is the only way in.

## The background helper

The page is served by a small helper that also runs the ffmpeg tools for it.
The page pings it every few seconds and the helper closes itself a few minutes
after those pings stop — which is how it disappears when you close the window.

A browser throttles timers in a window that is hidden or minimised to roughly
one a minute, so the helper has to tolerate a page that has gone quiet while
still being open. It waits three minutes. At twenty-five seconds it shut down
while the player was merely in the background, and the next thing you clicked
reported nothing more useful than "Failed to fetch".

If the helper has gone anyway, the player says so and tells you to close the
window and open Dashcam Player again, which starts a fresh one.

---

## Network

The player makes no network requests of its own. Fonts come from Windows rather than a web
font service, so it works with no connection at all. Two links lead outside, and neither is
followed unless you click it: the project link beside the version number, and
a Sentry alert's **Where** row, where the coordinates open OpenStreetMap at
that spot in your browser.

---

## Where things live

Installed to `%LOCALAPPDATA%\Programs\DashcamPlayer`. Settings and the
remembered folder are held by the browser against `http://localhost:8777`, not
in a file.

Uninstalling from Settings → Apps removes the program. **Remove data** in the
Start-menu folder clears anything an older version left in the registry and explains the two
browser-side items only you can clear.
