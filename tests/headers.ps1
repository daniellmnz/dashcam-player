# The headers the helper puts on every reply.
#
# The page carries its own content policy in a meta tag, which covers what it
# may load. It cannot cover who may FRAME it: browsers ignore frame-ancestors
# when it arrives that way, so that one has to be a header. Without it any
# website can put this page in an invisible frame and steer a click onto a
# button - and the page has buttons that delete recordings off a card.
#
# Checked on both reply paths. The refusal path builds its own header string,
# and a header set only on the success path would leave every 403 unprotected.
$Src = if ($env:DCP_SRC) { $env:DCP_SRC } else { (Resolve-Path (Join-Path $PSScriptRoot '../src')).Path }
$srv = Get-Content "$Src/dashcam-server.ps1" -Raw

$bad = 0
function Bad([string]$m) { $script:bad++; "  $m" }

# Every place a response header block is built. Both must carry the set.
$blocks = [regex]::Matches($srv, '\$header\s*=\s*"HTTP/1\.1[^"]*"')
if ($blocks.Count -lt 2) {
  Bad "expected both reply paths to build a header; found $($blocks.Count)"
}
foreach ($b in $blocks) {
  if ($b.Value -notmatch 'secHeaders') {
    Bad 'a reply is built without the security headers'
  }
}

# And what that set has to contain.
$m = [regex]::Match($srv, '(?s)\$secHeaders\s*=\s*(.*?)\r?\n\r?\n')
if (-not $m.Success) { Bad 'the security headers are not defined' }
else {
  $set = $m.Groups[1].Value
  foreach ($want in @(
    @{ h = 'X-Frame-Options: DENY'
       why = 'any website could frame the page and steer a click onto a button' },
    @{ h = "frame-ancestors 'none'"
       why = 'the meta tag cannot say this - browsers ignore frame-ancestors there' },
    @{ h = 'X-Content-Type-Options: nosniff'
       why = 'a browser may second-guess the type of a status reply' },
    @{ h = 'Referrer-Policy: no-referrer'
       why = 'a link out of the page would carry the local address with it' })) {
    if ($set -notmatch [regex]::Escape($want.h)) {
      Bad "$($want.h) is not sent - $($want.why)"
    }
  }
}

# A request line of unbounded length is read into memory before anything has
# looked at a token, so there has to be a limit on it.
if ($srv -match '\$request\s*=\s*\$reader\.ReadLine\(\)') {
  Bad 'the request line is read without a limit on its length'
}
if ($srv -notmatch 'Read-CappedLine') {
  Bad 'there is no capped line reader, so a request may be any length'
}
$hdrRead = [regex]::Match($srv, '(?s)while \(\$true\) \{\s*\r?\n\s*\$line = ([^\r\n]+)')
if ($hdrRead.Success -and $hdrRead.Groups[1].Value -match 'ReadLine\(\)') {
  Bad 'header lines are read without a limit on their length'
}

if ($bad) { "FAIL: $bad problem(s)"; exit 1 }
'every reply carries the headers, and no line is read without a limit'
exit 0
