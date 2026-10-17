#!/usr/bin/env bash
# The helper shuts itself down when the page stops pinging. The page pings
# every five seconds - but a browser throttles timers in a hidden or minimised
# window to about one a minute, and at a 25-second timeout that killed the
# helper while the player was merely in the background. The next click on
# "Make single view file" then reported "Failed to fetch" and nothing else.
#
# So: a once-a-minute ping must keep it alive, and silence must still close it.
set -u
D="$(cd "$(dirname "$0")" && pwd)"
P="${DCP_SRC:-$(cd "$(dirname "$0")/../src" && pwd)}"
[ -x /opt/ps/pwsh ] || { echo "no pwsh"; exit 77; }

IDLE=$(sed -n 's/.*\[int\]\$IdleSeconds = \([0-9]*\).*/\1/p' "$P/dashcam-server.ps1" | head -1)
[ -n "$IDLE" ] || { echo "could not read IdleSeconds"; exit 1; }
# A throttled page pings about once a minute; the timeout must clear that with
# room for a miss or two.
if [ "$IDLE" -lt 150 ]; then
  echo "IdleSeconds is $IDLE - a backgrounded window pings once a minute and would be cut off"
  exit 1
fi

# And the shutdown must still work, or the helper would linger for ever.
W="$D/idlerun"; rm -rf "$W"; mkdir -p "$W/appdata/DashcamPlayer"
cp "$P"/* "$W"/ 2>/dev/null
export LOCALAPPDATA="$W/appdata"
PORT=8788
# Run with a short timeout of its own, so the test does not take four minutes
# to prove a mechanism that is independent of the number.
( cd "$W" && setsid /opt/ps/pwsh -NoProfile -File dashcam-server.ps1 \
    -Port $PORT -IdleSeconds 6 > "$W/srv.log" 2>&1 & )
sleep 4
curl -s --max-time 3 "http://127.0.0.1:$PORT/version" >/dev/null || { echo "helper did not start"; exit 1; }

# Past the 45-second grace, pinging throughout.
for i in $(seq 1 11); do curl -s --max-time 3 "http://127.0.0.1:$PORT/ping" >/dev/null; sleep 5; done
curl -s --max-time 3 "http://127.0.0.1:$PORT/version" >/dev/null \
  || { echo "the helper died while being pinged"; exit 1; }

# Now silence: it must go.
sleep 12
if curl -s --max-time 3 "http://127.0.0.1:$PORT/version" >/dev/null 2>&1; then
  echo "the helper did not shut down when the pings stopped"
  pkill -f "pwsh.*$PORT" 2>/dev/null
  exit 1
fi
rm -rf "$W"
echo "idle timeout $IDLE s: survives a once-a-minute ping, still closes on silence"
exit 0
