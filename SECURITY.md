# Security

## Reporting a problem

Open a [private security advisory](../../security/advisories/new) rather than a
public issue. If that is not available to you, open an ordinary issue saying
only that you have found something and asking for a way to send the details.

This is a hobby project with one maintainer, so expect days rather than hours.

## What this program is, in security terms

It plays dashcam recordings off a card. Nothing is uploaded, there is no
account, and the only network listener is a local helper that exists so the
page can be installed as an app — Chromium only makes folder permissions
permanent for an installed app, and a `file://` page can never be installed.

That helper is the part worth looking at, and these are the rules it is
written to:

- **It listens on loopback only**, and checks the `Host` header against the
  three names loopback can have. Loopback is not the same as private: every
  website the browser has open can reach `http://localhost:8777/`, and with a
  correct `Host` header.
- **Anything with a side effect needs a token** — 32 bytes from the system
  random number generator, fresh for each run, substituted into the page as it
  is served and never written to disk. A page that cannot read the response
  cannot produce it, and no CORS headers are sent anywhere, which is what stops
  another site reading one.
- **The page never names a path, a process or a folder.** It cannot: the File
  System Access API never tells it where a file is. So `/reveal` takes nothing
  at all from the request and reads the folder back out of the status file the
  export tool itself wrote, and `/cancel-split` reads the process id the same
  way and then checks that the process really is the tool before killing it. A
  page that could name a process to kill could kill any of them.
- **Where a file name must be sent, it is allowlisted**, not merely scrubbed of
  path characters. An earlier filter rejected `\` and `/` and let cmd's own
  metacharacters through, and a recording called `a&calc.mp4` ran a command.
- **Deleting never recurses.** A folder is removed only when this program
  emptied it itself, one file at a time.

## Reports that will be closed

- That the helper's port can be reached by other local software. It can; that
  is what the token is for.
- That `script-src` uses a hash rather than a nonce. The page is one file with
  one inline script and no build step; the hash is pinned by
  `tools/repin-csp.py` and checked by the test suite.
- Anything that assumes recordings are uploaded somewhere. They are not.
