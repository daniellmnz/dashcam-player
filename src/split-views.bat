@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------
rem  Split 7X Dashcam recordings into one file per camera view.
rem
rem  The layout is worked out from each file, so this handles the
rem  2x2 recordings with or without the status strip, and the older
rem  vertically stacked ones, without being edited.
rem
rem  Run it from the folder holding the .mp4 files, or start it from
rem  the Start menu entry, which asks what to work on.
rem    split-views.bat "file.mp4"        one file, all four views
rem    split-views.bat "file.mp4" 1,2    one file, Front and Rear only
rem ---------------------------------------------------------------

rem --- Decoding is expensive: these frames are large and HEVC is slow
rem     to decode in software. Let the GPU do it. "auto" falls back to
rem     the CPU by itself if no decoder is available; set it to nothing
rem     if a decode ever looks wrong.
set "HWDEC=-hwaccel auto"

rem --- The encoder is usually what sets the pace. A graphics card has
rem     ONE encoder block, so four views queue up on it however fast the
rem     rest of the machine is.
rem
rem     "auto" tries each hardware encoder in turn and uses the first that
rem     actually starts, ending at the processor, which always works. This
rem     used to name NVENC outright, so a machine without an Nvidia card
rem     could not split at all - it stopped with "Cannot load nvcuda.dll".
rem     Being compiled into ffmpeg says nothing about whether the hardware
rem     is there, so each one is tried for a fraction of a second rather
rem     than assumed. Name one yourself to skip the test.
set "ENC=auto"
rem set "ENC=-c:v h264_nvenc -preset p4 -tune hq -rc constqp -qp 20 -bf 0 -g 50"
rem set "ENC=-c:v h264_qsv -preset medium -global_quality 21"
rem set "ENC=-c:v libx264 -preset fast -crf 18"

rem --- How hard the encoder tries. Every encoder here is driven by a QUALITY
rem     number, never a bitrate: a bitrate would spend the same bits on a
rem     still car park as on rain at night, which is the wrong way round.
rem     Lower number, better picture, bigger file.
rem
rem     standard - what this wrote before. Smallest files.
rem     high     - the default. About a third more data than standard for a
rem                picture measurably closer to the recording.
rem     maximum  - roughly the same data per pixel as the recording itself.
rem
rem     Worth knowing when comparing an export against its source: one view
rem     is a QUARTER of the 2560x2660 frame, so a quarter of the recording's
rem     bitrate is the like-for-like figure, not the whole of it. A 20 Mb/s
rem     recording splits into views of about 5 Mb/s at "maximum".
rem
rem     The player sets this; run by hand, what is set here is used.
set "QUALITY=high"
if defined DCP_QUALITY set "QUALITY=%DCP_QUALITY%"

rem The preset matters as much as the number: on the same crf, x264 "fast"
rem makes a file the same size as "veryfast" and measurably better, so the
rem better quality levels move both together.
rem Flat gotos, not if/else blocks. These lines are full of quotes and cmd
rem mishandles quotes inside a parenthesised block - the same reason the
rem encoder choice below is written this way. An unknown level lands on
rem "high" rather than leaving every encoder unset, which would have handed
rem ffmpeg no -c:v at all and written whatever it felt like.
if /i "%QUALITY%"=="standard" goto :q_standard
if /i "%QUALITY%"=="maximum"  goto :q_maximum
set "QUALITY=high"
goto :q_high

:q_standard
set "ENCNV=-c:v h264_nvenc -preset p1 -tune hq -rc constqp -qp 23 -bf 0 -g 50"
set "ENCQS=-c:v h264_qsv -preset veryfast -global_quality 23"
set "ENCAM=-c:v h264_amf -quality speed -rc cqp -qp_i 23 -qp_p 23"
set "ENCSW=-c:v libx264 -preset veryfast -crf 21"
set "ENC2AUTO=-c:v h264_qsv -preset veryfast -global_quality 23"
goto :q_done

:q_maximum
set "ENCNV=-c:v h264_nvenc -preset p5 -tune hq -rc constqp -qp 17 -bf 0 -g 50"
set "ENCQS=-c:v h264_qsv -preset medium -global_quality 18"
set "ENCAM=-c:v h264_amf -quality quality -rc cqp -qp_i 18 -qp_p 18"
set "ENCSW=-c:v libx264 -preset fast -crf 16"
set "ENC2AUTO=-c:v h264_qsv -preset medium -global_quality 18"
goto :q_done

:q_high
set "ENCNV=-c:v h264_nvenc -preset p4 -tune hq -rc constqp -qp 20 -bf 0 -g 50"
set "ENCQS=-c:v h264_qsv -preset medium -global_quality 21"
set "ENCAM=-c:v h264_amf -quality balanced -rc cqp -qp_i 21 -qp_p 21"
set "ENCSW=-c:v libx264 -preset fast -crf 18"
set "ENC2AUTO=-c:v h264_qsv -preset medium -global_quality 21"
:q_done

rem --- A SECOND encoder, used for every other view. Most Intel desktop
rem     CPUs have Quick Sync built in, which is separate silicon from the
rem     graphics card's encoder, so running both at once roughly halves
rem     the time. "auto" tests whether Quick Sync really initialises and
rem     uses it if so. Set it to nothing to encode everything on ENC, or
rem     name an encoder yourself.
set "ENC2=auto"
rem set "ENC2="
rem set "ENC2=-c:v h264_qsv -preset veryfast -global_quality 23"

rem What "auto" uses when the test passes is set with the quality level
rem above, so the second encoder cannot quietly write to a different
rem standard from the first - which would make alternate views differ.

rem --- Which views to write: all, or any of 1=Front 2=Rear 3=Left
rem     4=Right. Fewer views means proportionally less work.
set "VIEWS=all"

rem --- Export only part of each recording. Leave empty for all of it.
rem     START is a position (12 or 0:12), DUR is a length in seconds.
set "START="
set "DUR="

rem --- Shrink each view to this width before encoding. Empty keeps the
rem     full size. Encoding cost falls with the pixel count, so 960
rem     takes roughly half as long as 1280.
set "VIEWW="

rem Set to 1 to stack the vehicle status strip under each view.
rem The player's export question carries a tick box for this, which arrives
rem here as DCP_STATUSSTRIP - "0" leaves the strip off. Anything else,
rem including nothing at all, keeps whatever is set on the line above, so
rem running this by hand behaves as it always did.
set "APPENDSTRIP=1"
if "%DCP_STATUSSTRIP%"=="0" set "APPENDSTRIP=0"
if "%DCP_STATUSSTRIP%"=="1" set "APPENDSTRIP=1"

rem --- Where the cameras are, for a recording whose frame is not a grid.
rem
rem     One recorder stacks its four cameras in a single 1280-wide strip 5140
rem     tall and then folds that strip into columns, because no encoder will
rem     take a picture that tall. What is in the file is 3840x1728, and a
rem     camera is no longer a rectangle in it: three of the four are split
rem     across two columns. There is nothing in the frame's shape for the
rem     geometry below to work out, and nothing in a .bat that can read the
rem     sidecar that describes it.
rem
rem     So the player sends the rectangles. Each camera is one or more pieces
rem     written exactly as ffmpeg's "crop" takes them - w:h:x:y - with the
rem     pieces of one camera joined by commas and the cameras by semicolons,
rem     in the order the player shows them, which is the order the views are
rem     numbered here. Stacked back up in the order given, the pieces are the
rem     camera.
rem
rem     Nothing here parses or calculates any of that: the pieces are spliced
rem     in whole. Run by hand there is nothing that could know them, so the
rem     frame's own shape is used as it always was.
set "LANES="
set "STRIPAT="
if defined DCP_LANES set "LANES=%DCP_LANES%"
if defined DCP_STRIPAT set "STRIPAT=%DCP_STRIPAT%"

rem --- The time of day, drawn into the picture itself.
rem
rem     The player has always painted a clock over the frame as it plays, but
rem     that lives in the player: an exported clip opened anywhere else, or
rem     sent to somebody, carried no time at all. This writes it INTO the
rem     file, which is the only form of it that travels.
rem
rem     ffmpeg is told the wall-clock instant of the FIRST exported frame, as
rem     a plain epoch second, and adds each frame's own timestamp to it - so a
rem     clip cut from the middle of a recording reads the real time, not a
rem     stopwatch. The player works that instant out (it knows the recording's
rem     start from the name or the sidecar) and sends it as DCP_CLOCKAT. Run
rem     by hand there is nothing that could know it, so there is no clock.
set "CLOCKAT="
if defined DCP_CLOCKAT set "CLOCKAT=%DCP_CLOCKAT%"

rem Set to 1 to keep any audio track rather than dropping it.
set "KEEPAUDIO=0"

set "OUT=split"
rem The player passes the folder it wants the exports in - one folder at
rem the top of whatever card or folder was opened, with a subfolder per
rem tool. Run by hand with nothing set, the output lands beside the
rem recordings as it always did.
if defined DCP_OUT set "OUT=%DCP_OUT%"

if "%KEEPAUDIO%"=="1" (set "AUD=-c:a aac -b:a 96k") else (set "AUD=-an")

rem The player sends a marked clip through the environment, the same way it
rem names the error file. Anything set at the top of this script still wins
rem when the player sends nothing.
if defined DCP_START if defined DCP_DUR set "START=%DCP_START%"
if defined DCP_START if defined DCP_DUR set "DUR=%DCP_DUR%"

set "RANGE="
if defined START set "RANGE=-ss %START%"
if defined DUR set "RANGE=%RANGE% -t %DUR%"
rem A clip gets its own name, so writing part of a recording can never
rem overwrite a whole one that is already there - and so you can tell them
rem apart afterwards. Seconds, zero-padded, which sorts properly.
set "CLIP="
if not defined START goto :noclip
if not defined DUR goto :noclip
rem Whole seconds only. The player recognises a single-camera file by the
rem view name plus at most one more "_word" before .mp4, and a decimal point
rem is not a word character - a name like "_Front_clip12.5.mp4" would be read
rem as a four-camera grid and carved into quarters.
for /f "delims=." %%a in ("%START%") do set "CLIP=_clip%%a"
:noclip


where ffmpeg >nul 2>nul
if errorlevel 1 goto :noffmpeg
where ffprobe >nul 2>nul
if errorlevel 1 goto :noffmpeg

rem A views list can also be given as the second argument, which is how
rem the player's "Split this recording" button passes on the views you
rem have switched on.
if not "%~2"=="" set "VIEWS=%~2"
set "SEL=,%VIEWS%,"
if /i "%VIEWS%"=="all" set "SEL=,1,2,3,4,"
set "SEL=!SEL: =!"

if "%~1"=="" dir /b *.mp4 >nul 2>nul || (
  echo No .mp4 files in this folder:
  echo   %CD%
  call :hold
  exit /b 1
)

echo.
echo Working in: %CD%
echo Output to : %OUT%
echo Views     : %VIEWS%
echo Quality   : %QUALITY%

rem Decide the main encoder. Flat gotos rather than if/else blocks for the
rem same reason as below: cmd mishandles quotes inside those.
set "ENCKIND=named"
set "ENCTEST=%TEMP%\dcp_enc_%RANDOM%%RANDOM%.mp4"
if /i not "%ENC%"=="auto" goto :enc_done
call :encprobe -c:v h264_nvenc
if defined ENCOK goto :enc_nv
call :encprobe -c:v h264_qsv -global_quality 30
if defined ENCOK goto :enc_qs
call :encprobe -c:v h264_amf
if defined ENCOK goto :enc_am
set "ENC=%ENCSW%"
set "ENCKIND=sw"
echo Encoder   : the processor ^(no hardware encoder started^)
goto :enc_done
:enc_nv
set "ENC=%ENCNV%"
set "ENCKIND=nv"
echo Encoder   : graphics card ^(NVENC^)
goto :enc_done
:enc_qs
set "ENC=%ENCQS%"
set "ENCKIND=qs"
echo Encoder   : Quick Sync
goto :enc_done
:enc_am
set "ENC=%ENCAM%"
set "ENCKIND=am"
echo Encoder   : graphics card ^(AMD AMF^)
goto :enc_done
:enc_done

rem Decide the second encoder. An encoder being compiled into this ffmpeg
rem build says nothing about whether the hardware will come up, so this
rem actually encodes a fraction of a second and sees what happens. Written
rem flat rather than as if/else blocks: cmd mishandles quotes inside those.
if /i not "%ENC2%"=="auto" goto :enc2_done
set "ENC2="
rem Quick Sync is one encoder block. If the main encoder is already using it,
rem a second stream on it would share the same silicon and gain nothing.
if /i "%ENCKIND%"=="qs" goto :enc2_none
rem One view is one encode, so a second encoder would sit idle - skip the test.
if /i "%VIEWS%"=="all" goto :enc2_probe
if "%VIEWS%"=="%VIEWS:,=%" goto :enc2_done
:enc2_probe
call :encprobe -c:v h264_qsv -global_quality 30
if not defined ENCOK goto :enc2_none
set "ENC2=%ENC2AUTO%"
echo Encoders  : graphics card, plus Quick Sync on alternate views
goto :enc2_done
:enc2_none
echo Encoders  : graphics card only ^(Quick Sync did not start^)
:enc2_done

rem --- Can the clock be drawn at all? Settled once, before any encoding.
rem
rem     Two things have to hold and neither can be assumed. drawtext needs a
rem     font FILE - there is no default worth having - and the filter itself
rem     is a thicket of escaping that this cannot test on the machine it was
rem     written on. So the font is looked for, and then the filter is actually
rem     run against a fraction of a second of black, exactly the way the
rem     encoders above are tried rather than trusted.
rem
rem     Either failure drops the clock and says so. A missing stamp is a small
rem     disappointment; an export that will not start because of one is not.
set "CLOCKFONT="
set "CLKTEST=%TEMP%\dcp_clk_%RANDOM%%RANDOM%.mp4"
if not defined CLOCKAT goto :clock_done
call :numonly "%CLOCKAT%" || set "CLOCKAT="
if not defined CLOCKAT goto :clock_done
set "FONTPATH=%WINDIR%\Fonts\consola.ttf"
if not exist "!FONTPATH!" set "FONTPATH=%WINDIR%\Fonts\arial.ttf"
if not exist "!FONTPATH!" goto :clock_nofont
rem A filter graph wants forward slashes, and the drive's colon escaped - an
rem unescaped one ends the option and ffmpeg then quietly draws in some other
rem font rather than complaining.
set "CLOCKFONT=!FONTPATH:\=/!"
set "CLOCKFONT=!CLOCKFONT::=\:!"
call :clockfilter 1000
if not defined CLK goto :clock_nofont
del /q "%CLKTEST%" >nul 2>nul
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=320x240:r=5:d=0.2 -vf "null!CLK!" -frames:v 1 -y "%CLKTEST%" >nul 2>nul
if not exist "%CLKTEST%" goto :clock_nofilter
for %%A in ("%CLKTEST%") do if %%~zA GTR 0 goto :clock_ok
:clock_nofilter
del /q "%CLKTEST%" >nul 2>nul
set "CLOCKAT="
echo Clock     : this ffmpeg would not draw text - exporting without the time
goto :clock_done
:clock_nofont
set "CLOCKAT="
echo Clock     : no font found in %WINDIR%\Fonts - exporting without the time
goto :clock_done
:clock_ok
del /q "%CLKTEST%" >nul 2>nul
echo Clock     : the time is drawn onto each view
:clock_done
set "CLK="

if not exist "%OUT%" mkdir "%OUT%"
if not exist "%OUT%" (
  echo.
  echo   Could not create the %OUT% folder here. The drive may be read-only
  echo   or full, or this folder may not allow writing.
  call :hold
  exit /b 1
)

rem One id per run, used to keep this run's temp files apart from any other.
set "RUNID=%RANDOM%%RANDOM%"

rem Folder mode skips a file it cannot split and carries on; a single named
rem file has to report failure, or the player would be told the run succeeded
rem and then go looking for output that was never written.
if not "%~1"=="" (
  set "FOLDERMODE=0"
  call :one "%~f1" || goto :failed
) else (
  set "FOLDERMODE=1"
  for %%F in (*.mp4) do call :one "%%~fF" || goto :failed
)

echo.
echo All done. Files are in the %OUT% folder.
exit /b 0


:encprobe
rem Does this encoder actually work? %* is its options.
rem
rem Not "if errorlevel": IF ERRORLEVEL n is true when the code is n OR MORE,
rem so a negative exit - which ffmpeg does return - makes "if not errorlevel 1"
rem TRUE, and the encoder that just failed gets chosen. That is exactly how a
rem machine with no Nvidia card still ended up on NVENC and stopped with
rem "Cannot load nvcuda.dll".
rem
rem Nor "if exist": a failed encoder still leaves a zero-byte file behind.
rem The test is whether anything was actually written, which is the same
rem thing this script already uses to judge the real run.
set "ENCOK="
del /q "%ENCTEST%" >nul 2>nul
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=640x480:r=25:d=0.2 %* -y "%ENCTEST%" >nul 2>nul
if not exist "%ENCTEST%" exit /b 0
for %%A in ("%ENCTEST%") do if %%~zA GTR 0 set "ENCOK=1"
del /q "%ENCTEST%" >nul 2>nul
exit /b 0

:firstwidth
rem How wide a camera is, read off the first piece of the first one. The
rem pieces are w:h:x:y, so the width is the first field of the first of them -
rem no arithmetic, just the number that was sent.
for /f "tokens=1 delims=:," %%w in ("%~1") do set "CELL=%%w"
call :numonly "!CELL!" || set "CELL="
if defined CELL set "GEOMOK=1"
exit /b 0

:laneset
rem This view's source chain, out of the pieces the player sent. %1 is the
rem view number, which is also its place in the list: the player sends the
rem cameras in the order it shows them, and that is the order they are
rem numbered here.
set "LANEPIECES="
for /f "tokens=%1 delims=;" %%a in ("!LANES!") do set "LANEPIECES=%%a"
if not defined LANEPIECES exit /b 1
call :lanechain "q%1_" "!LANEPIECES!" || exit /b 1
set "VPRE=!LPRE!"
set "VSRC=!LMAIN!"
if not "!USESTRIP!"=="1" exit /b 0
rem The strip is folded into the columns the same way the cameras are, so it
rem is rebuilt the same way - with labels of its own, or two views would both
rem try to name the same piece.
call :lanechain "s%1_" "!STRIPAT!" || exit /b 1
set "SBPRE=!LPRE!"
set "SB=!LMAIN!,scale=!CELL!:-2"
exit /b 0

:lanechain
rem A picture out of one or more pieces. %1 is a label prefix, unique per
rem view; %2 is the pieces, comma separated, each one exactly what ffmpeg's
rem crop takes. Leaves LPRE - the chains that must run first - and LMAIN, the
rem chain that yields the picture, ready for a filter to be appended to.
rem
rem Every piece reads from [0:v], which is an input and may be read as often
rem as it likes. A filter's own output may not, which is why the pieces are
rem labelled and stacked rather than split off something.
set "LPRE="
set "LLAB="
set "LONE="
set "LN=0"
for %%p in (%~2) do call :lanepiece "%~1" "%%p"
if "!LN!"=="0" exit /b 1
rem One piece is the whole camera: no stack, and no labels to leave dangling.
if "!LN!"=="1" set "LPRE="
if "!LN!"=="1" set "LMAIN=[0:v]crop=!LONE!"
if not "!LN!"=="1" set "LMAIN=!LLAB!vstack=inputs=!LN!"
exit /b 0

:lanepiece
set /a LN+=1
set "LONE=%~2"
set "LPRE=!LPRE![0:v]crop=%~2[%~1!LN!];"
set "LLAB=!LLAB![%~1!LN!]"
exit /b 0

:clockfilter
rem The drawtext that puts the time on a picture %1 pixels tall, as CLK - a
rem filter to append to a chain, so it begins with a comma. Empty when there
rem is no clock to draw, which is why every use of it is simply !CLK!.
rem
rem Where it sits and how big it is follow the player's own clock: bottom
rem right of the PICTURE, above the status strip rather than over it, about
rem a fiftieth of the picture's height. The same text, too - the format
rem string is the player's, so a clip does not stamp itself one way on screen
rem and another in the file.
rem
rem The escaping is the awkward part and it is not decoration. Each %% is one
rem per cent sign once cmd has read the line - a single one would be dropped,
rem taking the expansion with it. The colons inside the format have to survive
rem two parsers, the filter graph's and then the text expansion's, which is
rem what \\\: is for. The commas need nothing: the single quotes round the
rem text carry them through, which was checked rather than assumed, and an
rem escape that does nothing is one more thing to get wrong later.
rem
rem Written wrong this does not draw the wrong time, it stops the export -
rem which is why the block above runs it once against a test frame before any
rem real work is done, and why tests/clockfilter.sh takes this very line out
rem of this file, applies cmd's rules to it and hands it to a real ffmpeg.
set "CLK="
if not defined CLOCKAT exit /b 0
if not defined CLOCKFONT exit /b 0
set /a CFS=%~1*2/100
if !CFS! LSS 12 set "CFS=12"
set /a CPAD=!CFS!*3/5
set /a CBOR=!CFS!/4
if !CBOR! LSS 2 set "CBOR=2"
set "CLK=,drawtext=fontfile='!CLOCKFONT!':text='%%{pts\:localtime\:!CLOCKAT!\:%%a, %%b %%d, %%Y  %%H\\\:%%M\\\:%%S}':fontcolor=white:fontsize=!CFS!:x=w-tw-!CPAD!:y=h-th-!CPAD!:box=1:boxcolor=black@0.6:boxborderw=!CBOR!"
exit /b 0

:one
rem The name is captured with delayed expansion OFF, so a "!" in a file name
rem survives instead of being eaten, and everything below refers to !NAME!
rem rather than %NAME%. That distinction is the whole fix: %NAME% is
rem substituted before cmd scans the line for metacharacters, so a file called
rem "a&calc.mp4" terminated the set on the output line and ran what followed.
rem !NAME! is expanded after parsing and is inert to & ^ % ! ( ) alike.
rem Both callers only read the exit code, so the nested scope costs nothing.
setlocal disabledelayedexpansion
set "NAME=%~n1"
setlocal enabledelayedexpansion

rem Ask ffprobe for the picture size. The answer goes via a temp file:
rem reading it back needs no command-line escaping, which is where this
rem used to fall over silently.
rem Per-run names. These were fixed - and rectify-fisheye.bat used the very
rem same dcp_dims.txt - so two runs at once read each other's dimensions and
rem applied the wrong geometry, silently. Removed on the way out below.
set "DIMS=%TEMP%\dcp_dims_%RUNID%.txt"
set "SECSF=%TEMP%\dcp_secs_%RUNID%.txt"
rem Where ffmpeg's complaints are kept so the player can repeat them. Run
rem hidden there is no console for them to land in. Run-Tool.ps1 names the
rem file so it knows where to read it from; run from the Start menu nobody
rem has, and a temp name of our own does just as well.
set "ERRF=%DCP_ERRFILE%"
if not defined ERRF set "ERRF=%TEMP%\dcp_err_%RUNID%.txt"
if exist "%ERRF%" del /q "%ERRF%" 2>nul
if exist "%DIMS%" del /q "%DIMS%" 2>nul
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "%~1" > "%DIMS%" 2>&1
set "W="
set "H="
for /f "usebackq tokens=1,2 delims=," %%a in ("%DIMS%") do (
  set "W=%%a"
  set "H=%%b"
)
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "%~1" > "%SECSF%" 2>nul
set "SECS="
for /f "usebackq delims=" %%a in ("%SECSF%") do set "SECS=%%a"
rem "N/A" is an answer too, and it is the one some recorders produce: a file
rem written without a length in its header. It is a defined value, so it used
rem to sail through and leave the percentage with nothing to divide by.
rem Anything that is not digits and dots is thrown away here.
call :numonly "!SECS!" || set "SECS="
if not defined SECS (
  rem The container could not say. The video stream often can.
  ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=nw=1:nk=1 "%~1" > "%SECSF%" 2>nul
  for /f "usebackq delims=" %%a in ("%SECSF%") do set "SECS=%%a"
  call :numonly "!SECS!" || set "SECS="
)
rem Still nothing: the player measured the recording while playing it and
rem passed the figure down. Show-Progress.ps1 reads this itself, so there is
rem nothing to copy here - this only decides what the console shows.
if not defined SECS if defined DCP_SECS set "SECS=%DCP_SECS%"
if not defined SECS set "SECS=0"
rem With a clip, the run is the clip's length - using the whole recording
rem would leave the percentage stuck in the first few per cent.
if defined DUR set "SECS=%DUR%"
rem Deleted as soon as it has been read, so no exit path can leave it behind.
del /q "%SECSF%" 2>nul

if not defined H (
  echo.
  echo   Could not read the picture size of !NAME!.
  echo   ffprobe said:
  if exist "%DIMS%" type "%DIMS%"
  echo.
  del /q "%DIMS%" 2>nul
  call :hold
  exit /b 1
)
del /q "%DIMS%" 2>nul

rem Four square views: stacked in a column if the frame is about four
rem times as tall as it is wide, otherwise in a 2x2 grid.
rem Cell sizes are forced even: H.264 and HEVC both reject odd dimensions, and
rem W/2 is odd whenever the frame width is not a multiple of four.
rem Supplied geometry wins outright. The checks below are about a frame that
rem IS a grid - cell sizes, whether the grid fits, what is left for the strip -
rem and none of them mean anything for a frame that was folded into columns.
rem Jumped over rather than taught exceptions.
if defined LANES goto :given_geom

set /a TALL=W*35/10
if !H! GEQ !TALL! (
  set /a CELL=W/2*2
  set /a GRIDH=CELL*4
  set "P1=0:0"
  set "P2=0:!CELL!"
  set /a T3=CELL*2
  set "P3=0:!T3!"
  set /a T4=CELL*3
  set "P4=0:!T4!"
) else (
  set /a CELL=W/4*2
  set /a GRIDH=CELL*2
  set "P1=0:0"
  set "P2=!CELL!:0"
  set "P3=0:!CELL!"
  set "P4=!CELL!:!CELL!"
)
set /a STRIPH=H-GRIDH
set "CROP=crop=!CELL!:!CELL!:"

rem The chosen layout has to fit inside the frame, and nothing checked that.
rem An ordinary 1920x1080 clip takes the 2x2 branch, giving a 960 cell, a grid
rem 1920 lines tall and a strip of -840 - and views 3 and 4 then crop 960x960
rem at y=960 out of a frame only 1080 tall. ffmpeg does not refuse that: it
rem exits 0, the output probes cleanly, the verification below passes it, and
rem the run prints "written: Front Rear Left Right". Four files of nonsense,
rem reported as success. Anything between 1:1 and 2:1 hit this.
if !CELL! LSS 16 (
  echo.
  echo   !NAME! is !W!x!H! - too small to split into four views.
  if "!FOLDERMODE!"=="1" exit /b 0
  call :hold
  exit /b 1
)
if !GRIDH! GTR !H! (
  echo.
  echo   Not a four-view recording: !NAME! is !W!x!H!.
  echo   A !CELL!x!CELL! four-view grid needs !GRIDH! lines; this frame has !H!.
  echo   Only the 7X four-camera layout can be split.
  if "!FOLDERMODE!"=="1" exit /b 0
  call :hold
  exit /b 1
)
if !STRIPH! LSS 0 (
  echo.
  echo   Refusing !NAME!: the status strip works out negative ^(!STRIPH!^).
  if "!FOLDERMODE!"=="1" exit /b 0
  call :hold
  exit /b 1
)

set "USESTRIP=0"
if "%APPENDSTRIP%"=="1" if !STRIPH! GEQ 24 set "USESTRIP=1"
if "!USESTRIP!"=="1" set "SB=[0:v]crop=!W!:!STRIPH!:0:!GRIDH!,scale=!CELL!:-2"
goto :geom_done

:given_geom
rem The cameras as the player described them. CELL is still wanted - the strip
rem is scaled to the camera's width before it is stacked underneath, or vstack
rem refuses the two - so it is read off the first piece of the first camera
rem rather than guessed, which is the whole point of being told.
set "GEOMOK="
for /f "tokens=1 delims=;" %%a in ("!LANES!") do call :firstwidth "%%a"
if not defined GEOMOK (
  echo.
  echo   The camera positions sent with this recording could not be read.
  if "!FOLDERMODE!"=="1" exit /b 0
  call :hold
  exit /b 1
)
set "USESTRIP=0"
if "%APPENDSTRIP%"=="1" if defined STRIPAT set "USESTRIP=1"
:geom_done

set "RESIZE="
if defined VIEWW set "RESIZE=,scale=%VIEWW%:-2"

rem Sized to this recording's view, now that the cell is known.
call :clockfilter !CELL!

echo.
echo Splitting !NAME!


set "FC="
set "OUTS="
set "SELLABELS="
set "NSEL=0"
set "MISSING=0"
set "GEOMFAIL="
for %%V in (1 2 3 4) do call :addview %%V
rem A view that could not be described is not a view to leave out quietly: the
rem run would write the others, report success, and the missing camera would
rem be noticed days later by somebody looking for it. The loop cannot stop
rem itself - a FOR ignores what the thing it calls returns - so it leaves a
rem mark and this reads it.
if defined GEOMFAIL (
  echo.
  echo   The camera positions sent with this recording could not be used.
  exit /b 1
)
if "!NSEL!"=="0" (
  echo   No views selected - check the VIEWS setting.
  exit /b 1
)
if "!MISSING!"=="0" (
  echo   Skipping - those views are already split
  exit /b 0
)

rem Piping costs us ffmpeg's exit code - cmd reports the last command in a
rem pipeline - and ffmpeg writes "progress=end" even when it fails. So the
rem outputs themselves are checked instead, which is a firmer test anyway.
rem Errors still reach the console: only stdout is piped.
rem ffmpeg's own words are kept, not just its exit code. Run from the player
rem this window does not exist, so without this the only thing that reached
rem the screen on a failure was "exit 1" - true, and no help at all.
ffmpeg -hide_banner -loglevel error -nostats %HWDEC% -y %RANGE% -i "%~1" -filter_complex "!FC!" -progress pipe:1 !OUTS! 2>"!ERRF!" | powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Show-Progress.ps1" -Seconds "!SECS!" -Label "!NAME!"

set "RUNOK=1"
for %%V in (!SELLABELS!) do (
  if not exist "%OUT%\!NAME!_%%V!CLIP!.mp4" set "RUNOK=0"
)
if "!RUNOK!"=="1" for %%V in (!SELLABELS!) do (
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "%OUT%\!NAME!_%%V!CLIP!.mp4" >nul 2>nul
  if errorlevel 1 set "RUNOK=0"
)
if "!RUNOK!"=="0" (
  echo.
  echo   That did not produce usable files. ffmpeg said:
  if exist "!ERRF!" type "!ERRF!"
  echo   Encoder was: %ENC%
  rem And which encoder, with the exact options. "It fails at one quality and
  rem not another" cannot be acted on without them: the three quality levels
  rem differ only in numbers for most encoders, so the arguments that were
  rem actually used are the whole of the evidence. Appended, so a real message
  rem from ffmpeg still comes first and this is what is left when there is none.
  >>"!ERRF!" echo encoder %ENC%
  rem Only the labels this run asked for. It used to delete all four names,
  rem so splitting Front, then later splitting Rear and having it fail, took
  rem the perfectly good Front file with it.
  for %%V in (!SELLABELS!) do del /q "%OUT%\!NAME!_%%V!CLIP!.mp4" 2>nul
  exit /b 1
)
echo   written:!SELLABELS!
for %%V in (!SELLABELS!) do call :saybitrate "%OUT%\!NAME!_%%V!CLIP!.mp4" "%%V"
exit /b 0


rem Add one view to the filter graph and the output list. Views are
rem interleaved between the two encoders so both run at once.
:addview
set "IDX=%~1"
echo !SEL! | findstr /c:",%IDX%," >nul
if errorlevel 1 exit /b 0

if "%IDX%"=="1" set "VLAB=Front"
if "%IDX%"=="1" set "VP=!P1!"
if "%IDX%"=="2" set "VLAB=Rear"
if "%IDX%"=="2" set "VP=!P2!"
if "%IDX%"=="3" set "VLAB=Left"
if "%IDX%"=="3" set "VP=!P3!"
if "%IDX%"=="4" set "VLAB=Right"
if "%IDX%"=="4" set "VP=!P4!"

set "ENCX=%ENC%"
if defined ENC2 set /a ODD=NSEL%%2
if defined ENC2 if "!ODD!"=="1" set "ENCX=%ENC2%"
set /a NSEL+=1

rem The skip check used to ask only whether the output existed, so a truncated
rem file from an interrupted run satisfied it for ever - the ffprobe check
rem after a run only ever covered files that run had just produced. Verify a
rem pre-existing file too, and treat a failure as missing so it gets redone.
if not exist "%OUT%\!NAME!_!VLAB!!CLIP!.mp4" (
  set "MISSING=1"
) else (
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "%OUT%\!NAME!_!VLAB!!CLIP!.mp4" >nul 2>nul
  if errorlevel 1 set "MISSING=1"
)

rem Where this view's picture comes from. Normally one crop out of the frame;
rem for a recording whose cameras were folded into columns, the pieces the
rem player sent, stacked back up. VPRE and SBPRE carry the chains that have to
rem run before the stack - empty in the ordinary case, which is why the lines
rem below read the same either way.
set "VPRE="
set "SBPRE="
set "VSRC=[0:v]!CROP!!VP!"
if defined LANES call :laneset %IDX% || set "GEOMFAIL=1"
if defined GEOMFAIL exit /b 0

if defined FC set "FC=!FC!;"
rem The clock goes on the VIEW, before the strip is stacked under it, so it
rem lands on the picture and not across the vehicle data - which is where the
rem player puts it, and where it has to be for the two to agree.
if "!USESTRIP!"=="1" set "FC=!FC!!VPRE!!SBPRE!!VSRC!!CLK![a%IDX%];!SB![b%IDX%];[a%IDX%][b%IDX%]vstack!RESIZE![v%IDX%]"
if "!USESTRIP!"=="0" set "FC=!FC!!VPRE!!VSRC!!CLK!!RESIZE![v%IDX%]"
rem Not set "OUTS=...": that form put four quotes on the line, and the
rem parser's toggling left the file name in the UNQUOTED region. The unquoted
rem set form below is correct here precisely because every piece of the value
rem that could carry a metacharacter is delayed-expanded.
set OUTS=!OUTS! -map [v%IDX%] !ENCX! %AUD% "%OUT%\!NAME!_!VLAB!!CLIP!.mp4"
set "SELLABELS=!SELLABELS! !VLAB!"
exit /b 0


rem Succeeds only for a plain positive number - digits and dots, not all zeros.
rem ffprobe answers "N/A" for a recording that declares no length, and that is
rem a defined value: without this it passed straight through as a duration and
rem the percentage had nothing to divide by.
rem The bitrate the encoder actually achieved, said out loud. The quality
rem setting is a QP number, not a bitrate, so what comes out depends on the
rem footage as much as the setting - which makes "is this better than before?"
rem a question nobody could answer from the file list. One line per file
rem answers it. Integer arithmetic throughout: cmd has no other kind, so the
rem tenth is taken as a separate division rather than by rounding a float.
:saybitrate
setlocal
set "BRF=%TEMP%\dcp_br_%RANDOM%%RANDOM%.txt"
set "BR="
ffprobe -v error -show_entries format=bit_rate -of default=nw=1:nk=1 "%~1" > "%BRF%" 2>nul
for /f "usebackq delims=" %%a in ("%BRF%") do set "BR=%%a"
del /q "%BRF%" 2>nul
rem ffprobe answers "N/A" for a container that declares no rate, and that is a
rem defined value - it would sail straight into set /a and stop the script.
call :numonly "!BR!" || set "BR="
if not defined BR endlocal & exit /b 0
set /a "MB=!BR!/1000000, TENTH=(!BR!/100000) %%%% 10"
echo   %~2 !MB!.!TENTH! Mb/s
endlocal & exit /b 0

:numonly
setlocal
set "V=%~1"
set "BAD="
if not defined V set "BAD=1"
if not defined BAD for /f "delims=0123456789." %%x in ("!V!") do set "BAD=1"
if not defined BAD (
  set "Z=!V:0=!"
  set "Z=!Z:.=!"
  if not defined Z set "BAD=1"
)
if defined BAD (set "RC=1") else (set "RC=0")
endlocal & exit /b %RC%

:hold
if defined DCP_QUIET exit /b 0
pause
exit /b 0

:noffmpeg
echo ffmpeg was not found on your PATH.
echo Install it with:  winget install --id Gyan.FFmpeg -e
echo Then open a NEW Command Prompt and run this script again.
call :hold
exit /b 1

:failed
echo.
echo ffmpeg reported an error - stopping here.
echo Any part-written outputs for that segment have been removed.
call :hold
exit /b 1
