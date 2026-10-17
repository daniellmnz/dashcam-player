@echo off
setlocal enabledelayedexpansion

rem ---------------------------------------------------------------
rem  Fisheye rectification for 7X Dashcam recordings.
rem  Rectifies ONE camera view and writes one normal-looking file.
rem
rem  Give it a file the split tool wrote - one whose name ends with
rem  _Front, _Rear, _Left or _Right - and it straightens that view as
rem  it stands. That is what this is for, and the useful order of
rem  work: split the camera you want out first, then rectify it.
rem
rem  Given a whole four-camera recording instead, it takes one view
rem  out of the grid - the one named in VIEW below - rather than
rem  writing all four.
rem
rem  Run it from the folder holding the .mp4 files, or start it from
rem  the Start menu entry, which asks what to work on.
rem  Pass one file name to process just that file, and optionally a
rem  view (1-4, or Front/Rear/Left/Right) as the second argument.
rem ---------------------------------------------------------------

rem --- Set PREVIEW=1 to write one still per view and stop. Use it to
rem     tune IFOV and DFOV cheaply, then set it back to 0.
set "PREVIEW=0"

rem --- Input lens field of view. 180 suits these cameras. Raise it if
rem     straight lines still bow outward, lower it if they bow inward.
set "IFOV=180"

rem --- Output field of view. 120 is a good balance. 100 is tighter and
rem     flatter, 140 keeps more of the scene but stretches the corners.
set "DFOV=120"

rem --- Output size per view, and resampling quality.
rem     interp=lanczos is sharpest; interp=line is about twice as fast.
rem
rem     The shape of the frame is set here, and it is not a stretch: the
rem     rectification maps angles to pixels, so for a given DFOV above, a wider
rem     frame shows more to the left and right and less above and below.
rem     Objects keep their proportions whichever you choose - a car that
rem     is twice as long as it is tall measures that way in all of them.
rem
rem       1280x960   4:3    the default, and the one that reads best on
rem                         this footage - tried against 16:10 and kept.
rem       1280x800   16:10  wider, shorter: more road, less sky and bonnet.
rem       1280x720   16:9   wider still, and the shortest of the three.
set "OW=1280"
set "OH=960"
set "INTERP=lanczos"

rem --- A deliberate stretch, as a percentage of the width above. 100 is
rem     off, and off is geometrically true. Higher widens everything in
rem     the frame, cars included - which is wrong, but some people prefer
rem     the look. 115 is a noticeable stretch and writes a wider file:
rem     1280x800 at 115 comes out 1472x800. Whole numbers only.
set "STRETCH=100"

rem --- Which camera to take out of a four-camera recording:
rem     1 Front, 2 Rear, 3 Left, 4 Right. Ignored for a file that is
rem     already one camera, which is rectified as it stands.
set "VIEW=1"

rem --- A clip rather than the whole recording: where to start and how long
rem     for, both in seconds. The player sets these from the In and Out
rem     marks; set them here to do it by hand. Both or neither - a start on
rem     its own would run to the end, which is not what a marked clip means.
set "START="
set "DUR="
if defined DCP_START if defined DCP_DUR set "START=%DCP_START%"
if defined DCP_START if defined DCP_DUR set "DUR=%DCP_DUR%"
set "RANGE="
if defined START set "RANGE=-ss %START%"
if defined DUR set "RANGE=%RANGE% -t %DUR%"
rem A clip gets its own name, so writing part of a recording can never
rem overwrite a whole one already there. Whole seconds: the player reads a
rem single-camera file by its view name plus at most one more "_word", and a
rem decimal point is not a word character.
set "CLIP="
if defined START if defined DUR for /f "delims=." %%a in ("%START%") do set "CLIP=_clip%%a"

rem Set to 1 to stack the vehicle status strip under each view.
rem The player's export question carries a tick box for this, which arrives
rem here as DCP_STATUSSTRIP - "0" leaves the strip off. Anything else,
rem including nothing at all, keeps whatever is set on the line above, so
rem running this by hand behaves as it always did.
set "APPENDSTRIP=1"
if "%DCP_STATUSSTRIP%"=="0" set "APPENDSTRIP=0"
if "%DCP_STATUSSTRIP%"=="1" set "APPENDSTRIP=1"

rem --- The time of day, drawn into the picture itself. The wall-clock
rem     instant of the first exported frame arrives as a plain epoch second
rem     and ffmpeg adds each frame's own timestamp to it, so a clip cut from
rem     the middle of a recording reads the real time rather than a stopwatch.
rem     Only the player can know that instant; run by hand there is no clock.
rem     See split-views.bat for the longer note.
set "CLOCKAT="
if defined DCP_CLOCKAT set "CLOCKAT=%DCP_CLOCKAT%"

rem --- Where the cameras are, for a recording whose frame is not a grid.
rem     One recorder folds its four cameras into columns, so a camera is not a
rem     rectangle in the file and there is nothing in the frame's shape to work
rem     one out from. The player sends the rectangles instead: w:h:x:y, as
rem     ffmpeg's crop takes them, the pieces of one camera joined by commas and
rem     the cameras by semicolons, in the order the player shows them. Nothing
rem     here parses or calculates any of it. See split-views.bat for the longer
rem     note. Run by hand there is nothing that could know them, so the frame's
rem     own shape is used as it always was.
set "LANES="
set "STRIPAT="
if defined DCP_LANES set "LANES=%DCP_LANES%"
if defined DCP_STRIPAT set "STRIPAT=%DCP_STRIPAT%"

rem --- Set to 1 to keep any audio track rather than dropping it.
set "KEEPAUDIO=0"

rem --- Decoding is the slow part: these frames are large and HEVC is
rem     expensive to decode in software. Let the GPU do it. "auto" falls
rem     back to the CPU by itself if no decoder is available; set it to
rem     nothing if a decode ever looks wrong.
set "HWDEC=-hwaccel auto"

rem "auto" tries each hardware encoder in turn and uses the first that
rem actually starts, ending at the processor, which always works. Naming
rem NVENC outright meant a machine without an Nvidia card could not run this
rem at all. Name one yourself to skip the test.
set "ENC=auto"
rem set "ENC=-c:v h264_nvenc -preset p5 -rc vbr -cq 20 -b:v 0"
rem set "ENC=-c:v libx264 -preset fast -crf 18"
rem set "ENC=-c:v h264_qsv -global_quality 21"

rem --- How hard the encoder tries: standard, high or maximum. Lower QP,
rem     better picture, bigger file. The player sets this; run by hand,
rem     what is set here is used. See split-views.bat for the longer note.
set "QUALITY=high"
if defined DCP_QUALITY set "QUALITY=%DCP_QUALITY%"

rem     -b:v 0 on the NVENC lines is NOT decoration, and leaving it off was
rem     a real fault: with "-rc vbr -cq N" and no bitrate given, NVENC falls
rem     back on ffmpeg's default target of 2 Mb/s and quietly rate-limits to
rem     it, so -cq did close to nothing and every rectified file came out at
rem     about 2 Mb/s however the quality was set. Zero means "no target -
rem     obey the quality number", which is what was always intended.
rem
rem Flat gotos rather than if/else: cmd mishandles quotes inside a
rem parenthesised block, and these lines are nothing but quotes.
if /i "%QUALITY%"=="standard" goto :q_standard
if /i "%QUALITY%"=="maximum"  goto :q_maximum
set "QUALITY=high"
goto :q_high

:q_standard
set "ENCNV=-c:v h264_nvenc -preset p5 -rc vbr -cq 23 -b:v 0"
set "ENCQS=-c:v h264_qsv -global_quality 23"
set "ENCAM=-c:v h264_amf -quality balanced -rc cqp -qp_i 23 -qp_p 23"
set "ENCSW=-c:v libx264 -preset fast -crf 21"
goto :q_done

:q_maximum
set "ENCNV=-c:v h264_nvenc -preset p6 -rc vbr -cq 17 -b:v 0"
set "ENCQS=-c:v h264_qsv -preset medium -global_quality 18"
set "ENCAM=-c:v h264_amf -quality quality -rc cqp -qp_i 18 -qp_p 18"
set "ENCSW=-c:v libx264 -preset fast -crf 16"
goto :q_done

:q_high
set "ENCNV=-c:v h264_nvenc -preset p5 -rc vbr -cq 20 -b:v 0"
set "ENCQS=-c:v h264_qsv -preset medium -global_quality 21"
set "ENCAM=-c:v h264_amf -quality balanced -rc cqp -qp_i 21 -qp_p 21"
set "ENCSW=-c:v libx264 -preset fast -crf 18"
:q_done

rem A view may also be given on the command line, the same way
rem split-views.bat takes one, so the Start-menu entry can pass it on.
if not "%~2"=="" set "VIEW=%~2"
if /i "%VIEW%"=="front" set "VIEW=1"
if /i "%VIEW%"=="rear"  set "VIEW=2"
if /i "%VIEW%"=="left"  set "VIEW=3"
if /i "%VIEW%"=="right" set "VIEW=4"
if "%VIEW%"=="1" set "VLABEL=Front"
if "%VIEW%"=="2" set "VLABEL=Rear"
if "%VIEW%"=="3" set "VLABEL=Left"
if "%VIEW%"=="4" set "VLABEL=Right"
if not defined VLABEL (
  echo.
  echo   VIEW must be 1-4, or Front, Rear, Left or Right. Got: %VIEW%
  call :hold
  exit /b 1
)

set "OUT=rectified"
rem The player passes the folder it wants the exports in - one folder at
rem the top of whatever card or folder was opened, with a subfolder per
rem tool. Run by hand with nothing set, the output lands beside the
rem recordings as it always did.
if defined DCP_OUT set "OUT=%DCP_OUT%"

if "%KEEPAUDIO%"=="1" (set "AUD=-c:a aac -b:a 96k") else (set "AUD=-an")
set "V=v360=fisheye:flat:ih_fov=%IFOV%:iv_fov=%IFOV%:d_fov=%DFOV%:w=%OW%:h=%OH%:interp=%INTERP%"
rem The stretch, if one was asked for. Worked out here rather than left to
rem an ffmpeg expression: an even width is required by the encoder, and the
rem status strip underneath has to be scaled to the very same width or the
rem two will not stack. Integer arithmetic throughout - cmd has no other
rem kind - so the width is rounded down to an even number.
set "SW=%OW%"
if not "%STRETCH%"=="100" (
  set /a SW=%OW%*%STRETCH%/100
  set /a SW=!SW!/2*2
  set "V=!V!,scale=!SW!:%OH%:flags=%INTERP%"
  echo Stretch   : %STRETCH%%% - the picture is deliberately wider than life
)

rem --- Trim, as percentages off the top and bottom of the STRAIGHTENED
rem     picture. Normally an export carries none of the player's framing -
rem     trim, lens and zoom are ways of looking at a recording - but
rem     straightening leaves sky at the top and bonnet at the bottom that
rem     there is often no reason to keep, so the export question offers it as
rem     a tick box and sends the figures here.
rem
rem     AFTER the v360, not before. Cropping the fisheye circle first would
rem     feed the correction a different picture from the one it was measured
rem     for and bend what is left; cropping the flat result just takes bands
rem     off it, which is what the player does on screen and so what the
rem     preview shows.
rem How tall the PICTURE is, before the status strip goes under it. The
rem player cannot work this out from the file: an untrimmed straightened
rem picture is always 4:3, so the strip is whatever is left over - but a
rem TRIMMED one is any height at all, and "whatever is left over" then comes
rem out negative. The strip is read as part of the picture, and the clock
rem burned onto the frame lands on top of the vehicle data.
rem
rem So the height is written into the name when the trim has changed it, and
rem the player subtracts. The STRIP's height is deliberately not the thing
rem recorded: ffmpeg's "scale=W:-2" rounds to the nearest even number, and
rem guessing which way it went would be wrong about half the time. The
rem picture's height is known here exactly, which is why it is this one.
set "PICH=%OH%"
set "TRIMTOP=0"
set "TRIMBOT=0"
if defined DCP_TRIMTOP set "TRIMTOP=%DCP_TRIMTOP%"
if defined DCP_TRIMBOT set "TRIMBOT=%DCP_TRIMBOT%"
call :numonly "%TRIMTOP%" || set "TRIMTOP=0"
call :numonly "%TRIMBOT%" || set "TRIMBOT=0"
rem Nothing beyond 45 each, matching the player's own limit, and never enough
rem between them to leave no picture at all.
if %TRIMTOP% GTR 45 set "TRIMTOP=45"
if %TRIMBOT% GTR 45 set "TRIMBOT=45"
if %TRIMTOP% LSS 0 set "TRIMTOP=0"
if %TRIMBOT% LSS 0 set "TRIMBOT=0"
set /a TRIMSUM=TRIMTOP+TRIMBOT
if !TRIMSUM! GTR 0 (
  rem Even numbers: yuv420p has half-resolution chroma, so an odd height or
  rem offset is rejected outright by the encoder.
  set /a TY=%OH%*%TRIMTOP%/100
  set /a TY=!TY!/2*2
  set /a TB=%OH%*%TRIMBOT%/100
  set /a TH=%OH%-!TY!-!TB!
  set /a TH=!TH!/2*2
  if !TH! GEQ 16 (
    set "V=!V!,crop=!SW!:!TH!:0:!TY!"
    set "PICH=!TH!"
    echo Trim      : %TRIMTOP%%% off the top, %TRIMBOT%%% off the bottom - !SW!x!TH!
  )
)

where ffmpeg >nul 2>nul
if errorlevel 1 goto :noffmpeg
where ffprobe >nul 2>nul
if errorlevel 1 goto :noffmpeg

rem Pick the encoder. Flat gotos: cmd mishandles quotes inside if/else blocks.
set "ENCTEST=%TEMP%\dcp_enc_%RANDOM%%RANDOM%.mp4"
if /i not "%ENC%"=="auto" goto :enc_done
call :encprobe -c:v h264_nvenc
if defined ENCOK goto :enc_nv
call :encprobe -c:v h264_qsv -global_quality 30
if defined ENCOK goto :enc_qs
call :encprobe -c:v h264_amf
if defined ENCOK goto :enc_am
set "ENC=%ENCSW%"
echo Encoder   : the processor ^(no hardware encoder started^)
goto :enc_done
:enc_nv
set "ENC=%ENCNV%"
echo Encoder   : graphics card ^(NVENC^)
goto :enc_done
:enc_qs
set "ENC=%ENCQS%"
echo Encoder   : Quick Sync
goto :enc_done
:enc_am
set "ENC=%ENCAM%"
echo Encoder   : graphics card ^(AMD AMF^)
goto :enc_done
:enc_done

rem --- Can the clock be drawn at all? Settled once, before any encoding: the
rem     font has to exist, and the filter has to parse on THIS ffmpeg. Both
rem     are tried rather than assumed, the way the encoders above are, and
rem     either failure drops the clock rather than stopping the export.
set "CLOCKFONT="
set "CLKTEST=%TEMP%\dcp_clk_%RANDOM%%RANDOM%.mp4"
if not defined CLOCKAT goto :clock_done
call :numonly "%CLOCKAT%" || set "CLOCKAT="
if not defined CLOCKAT goto :clock_done
set "FONTPATH=%WINDIR%\Fonts\consola.ttf"
if not exist "!FONTPATH!" set "FONTPATH=%WINDIR%\Fonts\arial.ttf"
if not exist "!FONTPATH!" goto :clock_nofont
rem Forward slashes, and the drive's colon escaped - an unescaped one ends
rem the option and ffmpeg then quietly draws in some other font.
set "CLOCKFONT=!FONTPATH:\=/!"
set "CLOCKFONT=!CLOCKFONT::=\:!"
call :clockfilter !PICH!
if not defined CLK goto :clock_nofont
del /q "%CLKTEST%" >nul 2>nul
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=320x240:r=5:d=0.2 -vf "null!CLK!" -frames:v 1 -y "%CLKTEST%" >nul 2>nul
if not exist "%CLKTEST%" goto :clock_nofilter
for %%A in ("%CLKTEST%") do if %%~zA GTR 0 goto :clock_ok
:clock_nofilter
del /q "%CLKTEST%" >nul 2>nul
set "CLOCKAT="
set "CLK="
echo Clock     : this ffmpeg would not draw text - exporting without the time
goto :clock_done
:clock_nofont
set "CLOCKAT="
set "CLK="
echo Clock     : no font found in %WINDIR%\Fonts - exporting without the time
goto :clock_done
:clock_ok
del /q "%CLKTEST%" >nul 2>nul
echo Clock     : the time is drawn onto the straightened picture
:clock_done

if "%~1"=="" dir /b *.mp4 >nul 2>nul || (
  echo No .mp4 files in this folder:
  echo   %CD%
  call :hold
  exit /b 1
)

echo.
echo Working in: %CD%
echo Output to : %OUT%
echo Quality   : %QUALITY%
if not exist "%OUT%" mkdir "%OUT%"
if not exist "%OUT%" (
  echo.
  echo   Could not create the %OUT% folder here. The drive may be read-only
  echo   or full, or this folder may not allow writing.
  call :hold
  exit /b 1
)

rem One id per run, to keep this run's temp files apart from any other's.
set "RUNID=%RANDOM%%RANDOM%"

if not "%~1"=="" (
  call :one "%~f1" || goto :failed
) else (
  for %%F in (*.mp4) do call :one "%%~fF" || goto :failed
)

echo.
if "%PREVIEW%"=="1" (
  echo Stills are in %OUT%. Adjust IFOV and DFOV at the top, run again.
  echo When happy, set PREVIEW=0.
) else (
  echo All done. Files are in the %OUT% folder.
)
call :hold
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
rem pieces are w:h:x:y, so the width is the first field of the first of them.
for /f "tokens=1 delims=:," %%w in ("%~1") do set "CELL=%%w"
call :numonly "!CELL!" || set "CELL="
if defined CELL set "GEOMOK=1"
exit /b 0

:laneset
rem This view's source chain, out of the pieces the player sent. %1 is the
rem view number, which is also its place in the list.
set "LANEPIECES="
for /f "tokens=%1 delims=;" %%a in ("!LANES!") do set "LANEPIECES=%%a"
if not defined LANEPIECES exit /b 1
call :lanechain "q%1_" "!LANEPIECES!" || exit /b 1
set "VPRE=!LPRE!"
set "VSRC=!LMAIN!"
if not "!USESTRIP!"=="1" exit /b 0
call :lanechain "s%1_" "!STRIPAT!" || exit /b 1
set "SBPRE=!LPRE!"
set "SB=!LMAIN!,scale=!SW!:-2"
exit /b 0

:lanechain
rem A picture out of one or more pieces. %1 is a label prefix, %2 the pieces,
rem comma separated, each exactly what ffmpeg's crop takes. Leaves LPRE - the
rem chains that must run first - and LMAIN, the chain that yields the picture.
rem
rem Every piece reads from [0:v], which is an input and may be read as often as
rem it likes. A filter's own output may not, which is why the pieces are
rem labelled and stacked rather than split off something.
set "LPRE="
set "LLAB="
set "LONE="
set "LN=0"
for %%p in (%~2) do call :lanepiece "%~1" "%%p"
if "!LN!"=="0" exit /b 1
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

:badgeom
echo.
echo   The camera positions sent with this recording could not be used.
call :hold
exit /b 1

:clockfilter
rem The drawtext that puts the time on a picture %1 pixels tall, as CLK - a
rem filter to append to a chain, so it begins with a comma. Empty when there
rem is no clock to draw, which is why every use of it is simply !CLK!.
rem
rem Position, size and wording follow the player's own clock: bottom right of
rem the picture, about a fiftieth of its height, the same format string. A
rem clip that stamped itself one way on screen and another in the file would
rem be worse than one that did not stamp itself at all.
rem
rem The escaping is not decoration. Each %% is one per cent sign once cmd has
rem read the line - a single one would be dropped, taking the expansion with
rem it. The colons inside the format have to survive two parsers, the filter
rem graph's and then the text expansion's, which is what \\\: is for. The
rem commas need nothing: the single quotes round the text carry them through,
rem which was checked rather than assumed.
rem
rem Written wrong this does not draw the wrong time, it stops the export -
rem hence the test frame above, run before any real work, and
rem tests/clockfilter.sh, which puts this very line through a real ffmpeg.
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
rem Captured with delayed expansion off so a "!" in the name survives, then
rem switched back on. Everything below uses !NAME!, never %NAME%: a percent
rem expansion is substituted before cmd scans the line for metacharacters, so
rem a file called "a&calc.mp4" would run a command. Same reasoning as
rem split-views.bat. This tool is only ever started by hand, but the names it
rem meets come off the card just the same.
setlocal disabledelayedexpansion
set "NAME=%~n1"
setlocal enabledelayedexpansion
rem A file the split tool wrote is already one camera, and its name says
rem which. That matters more than it sounds: a single 1280x1330 view and a
rem 2x2 grid with a status strip are the same shape, so nothing in the
rem picture can tell them apart - carve one of those up and you get four
rem quarters of one camera. The name is the only thing that knows.
set "SVIEW="
for %%V in (Front Rear Left Right) do if /i not "!NAME:_%%V=!"=="!NAME!" set "SVIEW=%%V"
rem The name says it has been straightened, and the player reads that: such a
rem file must not have the lens correction applied to it a second time, and it
rem belongs in its own part of the list rather than among the split files.
rem Never doubled - rectifying a rectified file would otherwise write
rem "_rectified_rectified", and the second pass is wrong anyway. The old
rem "_dewarped" mark is still recognised: files written before the rename
rem are straightened already and must not be put through it again.
set "FLAT="
if /i not "!NAME:_rectified=!"=="!NAME!" set "FLAT=1"
if /i not "!NAME:_dewarped=!"=="!NAME!" set "FLAT=1"
if defined FLAT (set "MARK=") else (set "MARK=_rectified")
rem Only when the trim has made the picture something other than its usual
rem height: an ordinary straightened file keeps the name it always had, and
rem the player falls back to the 4:3 rule for those.
set "PICT="
if not "%PICH%"=="%OH%" set "PICT=_pic%PICH%"
if defined SVIEW (set "OUTNAME=!NAME!!CLIP!!PICT!!MARK!") else (set "OUTNAME=!NAME!_%VLABEL%!CLIP!!PICT!!MARK!")

rem Already done - but only if it is a USABLE file.
rem
rem "exists" is not "finished". A run that was stopped part way, by the
rem player's Cancel or by anything else, leaves a file of some length behind,
rem and this check was perfectly happy with it: the export was then skipped
rem as done for ever and the recording could never be written again.
rem split-views.bat has verified a pre-existing file for a while; this did
rem not. ffprobe refusing it is the same test used on a file this run writes.
if "%PREVIEW%"=="0" if exist "%OUT%\!OUTNAME!.mp4" (
  ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "%OUT%\!OUTNAME!.mp4" >nul 2>nul
  if errorlevel 1 (
    echo Part-written file found - writing it again.
    del /q "%OUT%\!OUTNAME!.mp4" 2>nul
  ) else (
    echo Skipping !NAME! - already done
    exit /b 0
  )
)

rem Picture size via a temp file - no command-line escaping to get wrong.
rem Per-run name: this was a fixed dcp_dims.txt, the very same path
rem split-views.bat used, so two runs read each other's dimensions.
rem Where ffmpeg's complaints are kept so the player can repeat them. Run
rem hidden from the player there is no console for them to land in, so
rem without this a failed encode could only ever report "exit 1" - which is
rem exactly what it did, and exactly no help. split-views.bat has captured
rem them since it was written; this tool never did. Run-Tool.ps1 names the
rem file so it knows where to read it back from; run from the Start menu
rem nobody has, and a temp name of our own does as well.
set "ERRF=%DCP_ERRFILE%"
if not defined ERRF set "ERRF=%TEMP%\dcp_err_%RUNID%.txt"
if exist "%ERRF%" del /q "%ERRF%" 2>nul
set "DIMS=%TEMP%\dcp_dims_%RUNID%.txt"
set "SECSF=%TEMP%\dcp_secs_%RUNID%.txt"
if exist "%DIMS%" del /q "%DIMS%" 2>nul
ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "%~1" > "%DIMS%" 2>&1
set "W="
set "H="
for /f "usebackq tokens=1,2 delims=," %%a in ("%DIMS%") do (
  set "W=%%a"
  set "H=%%b"
)
rem How long the run will be, which is what the percentage divides by.
rem Same reasoning as split-views.bat: "N/A" is a defined value and would
rem otherwise sail through as a duration, and the player sends its own
rem figure for the recordings ffprobe cannot measure.
ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "%~1" > "%SECSF%" 2>nul
set "SECS="
for /f "usebackq delims=" %%a in ("%SECSF%") do set "SECS=%%a"
call :numonly "!SECS!" || set "SECS="
if not defined SECS (
  ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=nw=1:nk=1 "%~1" > "%SECSF%" 2>nul
  for /f "usebackq delims=" %%a in ("%SECSF%") do set "SECS=%%a"
  call :numonly "!SECS!" || set "SECS="
)
if not defined SECS if defined DCP_SECS set "SECS=%DCP_SECS%"
if not defined SECS set "SECS=0"
rem With a clip, the run is the clip's length - the whole recording would
rem leave the percentage stuck in the first few per cent.
if defined DUR set "SECS=%DUR%"
del /q "%SECSF%" 2>nul

if not defined H (
  echo.
  echo   Could not read the picture size of !NAME!.
  echo   ffprobe said:
  if exist "%DIMS%" type "%DIMS%"
  echo.
  call :hold
  exit /b 1
)

rem Supplied geometry wins outright: the shapes below describe a frame that is
rem a grid, and a frame folded into columns is not one.
if defined LANES goto :given_geom

set /a TALLTEST=W*35/10
rem Where the chosen view sits, and how much is left underneath it for the
rem status strip. A file that is already one camera is the whole frame, bar
rem any strip; a four-camera frame is stacked 1x4 when it is tall, else 2x2.
if defined SVIEW (
  set /a CELL=W
  set /a GRIDH=W
  set "PV=0:0"
) else if !H! GEQ !TALLTEST! (
  set /a CELL=W
  set /a GRIDH=CELL*4
  if "%VIEW%"=="1" set "PV=0:0"
  if "%VIEW%"=="2" set /a TOP=W
  if "%VIEW%"=="3" set /a TOP=W*2
  if "%VIEW%"=="4" set /a TOP=W*3
  if not "%VIEW%"=="1" set "PV=0:!TOP!"
) else (
  set /a CELL=W/2
  set /a GRIDH=CELL*2
  if "%VIEW%"=="1" set "PV=0:0"
  if "%VIEW%"=="2" set "PV=!CELL!:0"
  if "%VIEW%"=="3" set "PV=0:!CELL!"
  if "%VIEW%"=="4" set "PV=!CELL!:!CELL!"
)
set /a STRIPH=H-GRIDH
set "CROP=crop=!CELL!:!CELL!:"

set "USESTRIP=0"
if "%APPENDSTRIP%"=="1" if !STRIPH! GEQ 24 set "USESTRIP=1"
rem The strip is scaled to the rectified picture's width, stretch included,
rem because vstack refuses two inputs of different widths.
set "SB=[0:v]crop=!W!:!STRIPH!:0:!GRIDH!,scale=!SW!:-2"
goto :geom_done

:given_geom
rem The cameras as the player described them. CELL is read off the first piece
rem of the first camera rather than guessed - it is only wanted for the echo
rem below, since the straightening fixes the output size itself.
set "GEOMOK="
for /f "tokens=1 delims=;" %%a in ("!LANES!") do call :firstwidth "%%a"
if not defined GEOMOK (
  echo.
  echo   The camera positions sent with this recording could not be read.
  call :hold
  exit /b 1
)
set "STRIPH=0"
set "PV=sent"
set "USESTRIP=0"
if "%APPENDSTRIP%"=="1" if defined STRIPAT set "USESTRIP=1"
:geom_done

echo.
echo Rectifying !NAME!
if defined SVIEW (
  echo   frame !W!x!H!  already one camera ^(!SVIEW!^)  strip !STRIPH!  strip stacked: !USESTRIP!
) else (
  echo   frame !W!x!H!  taking %VLABEL% at !PV!  view !CELL!x!CELL!  strip stacked: !USESTRIP!
)

if "%PREVIEW%"=="1" (
  if defined SVIEW ( call :still "%~1" "!SVIEW!" "!PV!" "!USESTRIP!" ) ^
  else ( call :still "%~1" "%VLABEL%" "!PV!" "!USESTRIP!" )
  exit /b 0
)

rem The clock goes AFTER the straightening, never before it: run through the
rem lens correction the text would bend along with everything else. And on the
rem picture rather than the stacked result, so it sits above the vehicle data
rem instead of across it - which is where the player draws it.
rem Where this view's picture comes from: one crop out of the frame, or the
rem pieces the player sent stacked back up. VPRE and SBPRE carry the chains
rem that have to run before the stack, and are empty in the ordinary case.
set "VPRE="
set "SBPRE="
set "VSRC=[0:v]!CROP!!PV!"
if defined LANES call :laneset %VIEW% || goto :badgeom

rem The straightening goes on AFTER the pieces are back together: it is the
rem whole camera that was through the lens, not two parts of it.
if "!USESTRIP!"=="1" (
  set "FC=!VPRE!!SBPRE!!VSRC!,%V%!CLK![a];!SB![b];[a][b]vstack[out]"
) else (
  set "FC=!VPRE!!VSRC!,%V%!CLK![out]"
)

rem Piped into the progress reader, so the player gets a percentage rather
rem than "working" for the length of the run. The cost of the pipe is
rem ffmpeg's exit code - cmd reports the last command in a pipeline - so the
rem output file is checked instead, which is a firmer test anyway.
ffmpeg -hide_banner -loglevel error -nostats %HWDEC% -y %RANGE% -i "%~1" -filter_complex "!FC!" -map "[out]" -progress pipe:1 %ENC% %AUD% "%OUT%\!OUTNAME!.mp4" 2>"!ERRF!" | powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Show-Progress.ps1" -Seconds "!SECS!" -Label "!NAME!"
if not exist "%OUT%\!OUTNAME!.mp4" (
  echo.
  echo   ffmpeg wrote nothing. It said:
  if exist "!ERRF!" type "!ERRF!"
  echo   Encoder was: %ENC%
  rem And which encoder, with the exact options. "It fails at one quality and
  rem not another" cannot be acted on without them: the three quality levels
  rem differ only in numbers for most encoders, so the arguments that were
  rem actually used are the whole of the evidence. Appended, so a real message
  rem from ffmpeg still comes first and this is what is left when there is none.
  >>"!ERRF!" echo encoder %ENC%
  exit /b 1
)
rem A failed encode leaves a file of no length behind, which "exist" is
rem perfectly happy with.
ffprobe -v error -select_streams v:0 -show_entries stream=codec_type -of csv=p=0 "%OUT%\!OUTNAME!.mp4" >nul 2>nul
if errorlevel 1 (
  echo.
  echo   That did not produce a usable file. ffmpeg said:
  if exist "!ERRF!" type "!ERRF!"
  echo   Encoder was: %ENC%
  >>"!ERRF!" echo encoder %ENC%
  del /q "%OUT%\!OUTNAME!.mp4" 2>nul
  exit /b 1
)
call :saybitrate "%OUT%\!OUTNAME!.mp4" "written:"
exit /b 0


:still
if "%~4"=="1" (
  ffmpeg -hide_banner -v error %HWDEC% -y -ss 2 -i "%~1" -filter_complex "[0:v]crop=!CELL!:!CELL!:%~3,%V%[a];!SB![b];[a][b]vstack" -frames:v 1 "%OUT%\preview_%~2.png"
) else (
  ffmpeg -hide_banner -v error %HWDEC% -y -ss 2 -i "%~1" -vf "crop=!CELL!:!CELL!:%~3,%V%" -frames:v 1 "%OUT%\preview_%~2.png"
)
exit /b 0


rem Wait for a keypress only when there is somebody to press one. Started
rem from the player this runs hidden, with no console and no taskbar entry -
rem so a bare "pause" here sat forever on a window nobody could see. The file
rem was written, the tool never exited, and the player showed "working" until
rem it was closed. split-views.bat has had this since it grew a button; this
rem one got its button later and did not.
rem Succeeds only for a plain positive number - digits and dots, not all
rem zeros. ffprobe answers "N/A" for a recording that declares no length,
rem and that is a defined value: without this it passes straight through as
rem a duration and the percentage has nothing to divide by.
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
echo ffmpeg and ffprobe were not both found on your PATH.
echo Install them with:  winget install --id Gyan.FFmpeg -e
echo Then open a NEW Command Prompt and run this script again.
call :hold
exit /b 1

:failed
echo.
echo ffmpeg reported an error - stopping here.
echo Any part-written outputs for that segment have been removed.
call :hold
exit /b 1
