# fordconnect-js

A Ford/Lincoln vehicle widget for [Scriptable](https://scriptable.app) (iOS). Single file,
no server, no account on anything — everything runs on your phone.

## What it does

Talks to the same private FordPass/Lincoln Way mobile-app API the official app uses (reverse-
engineered, ported from [fordconnect-py](https://github.com/dynacylabs/fordconnect-py)'s
`fordconnect.fordpass`, itself ported from
[ha-fordpass](https://github.com/marq24/ha-fordpass)). That gets you both reads (doors, fuel/
charge, odometer, ...) and writes (lock, unlock, remote start) — the official, supported
FordConnect Query API is read-only and can't do the last part.

This is unofficial and unsupported by Ford: it can break without notice, and there have been
reports of accounts drawing scrutiny for third-party API use — consider a secondary FordPass
account rather than your primary one.

## Why this is one file, and why it needs no server

Ford's hosted sign-in page finishes by redirecting to a **mobile-app deep link**
(`fordapp://userauthorized/?code=...`), not a web page. A plain website has no way to see that
redirect — browsers hide cross-origin/custom-scheme navigation targets from JavaScript, which is
exactly why other setups for this (including an earlier iteration of this project) needed you to
open devtools and manually copy a URL out of the Network tab.

Scriptable's `WebView` class is different: its `shouldAllowRequest` hook gets to inspect *every*
navigation attempt, including that one, before it's followed. So the script opens the real Ford
sign-in page in a `WebView`, you sign in there yourself (this script never sees your Ford
password — it only watches the resulting HTTP redirect), and the script grabs the code the
instant Ford issues it. The token exchanges afterward run as plain on-device HTTP requests (no
browser, so no CORS to work around either). The resulting tokens are stored in Scriptable's
`Keychain`, encrypted, on your phone only.

Net effect: no website, no backend, nothing to host, nothing of yours ever sent anywhere except
directly to Ford's and Autonomic's own endpoints.

## Setup

1. Install [Scriptable](https://apps.apple.com/app/scriptable/id1405459188) from the App Store.
2. Add `FordPass.js` as a new script (paste its contents, or download it directly from this
   repo via Scriptable's "+" menu → import from URL).
3. Run the script once (tap it — don't add it as a widget yet). It'll ask for your region
   (leave as `usa` unless you're outside North America — see the `REGIONS` table in the script
   for the full list) and your VIN, then open a sign-in window. Sign in with your real Ford
   account there.
4. Once it says "Connected", long-press your home screen, add a widget, choose Scriptable, and
   pick this script.

Running the script again later (instead of just viewing the widget) opens a menu: refresh
status, lock, unlock, remote start, cancel remote start, request a fresh report, or re-run setup
(to change your VIN/region or sign in again).

## Status

New — ported and unit-tested for the crypto/protocol pieces (the vendored SHA-256 matches known
test vectors, and the token-exchange/refresh calls mirror fordconnect-py's already-verified-live
implementation), but not yet exercised end-to-end on a physical device. The widget's field names
for fuel/charge level and odometer are a best guess at the raw telemetry shape — if they come up
blank, compare against your own vehicle's raw JSON (fordconnect-py's `/fordpass/status` page is
useful for this) and adjust the `metricValue(...)` calls in `buildWidget()`.

## Related

- [fordconnect-py](https://github.com/dynacylabs/fordconnect-py) — the Python client (both the
  official FordConnect Query API and this same FordPass backend), with a small Flask demo app.
  Not required for this widget — it's a separate, optional way to use the same APIs from a
  desktop/server instead of a phone.
- [fordconnect-toolkit](https://github.com/dynacylabs/fordconnect-toolkit) — the parent repo
  tying both libraries together.
