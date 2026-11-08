# scriptable-fordpass

A Ford/Lincoln vehicle widget for [Scriptable](https://scriptable.app) (iOS). Single file,
no server, no account on anything — everything runs on your phone.

## What it does

Talks to the same private FordPass/Lincoln Way mobile-app API the official app uses
(reverse-engineered, ported from [ha-fordpass](https://github.com/marq24/ha-fordpass)). That
gets you both reads (doors, fuel/charge, range, odometer, outside temp, oil life/12V battery,
...) and writes (lock, unlock, remote start) — the official, supported FordConnect Query API is
read-only and can't do the last part.

This is unofficial and unsupported by Ford: it can break without notice, and there have been
reports of accounts drawing scrutiny for third-party API use — consider a secondary FordPass
account rather than your primary one.

## Why this is one file, and why it needs no server

Ford's hosted sign-in page finishes by redirecting to a **mobile-app deep link**
(`fordapp://userauthorized/?code=...`), not a web page. A plain website has no way to see that
redirect — browsers hide cross-origin/custom-scheme navigation targets from JavaScript, which is
exactly why other setups for this needed you to open devtools and manually copy a URL out of the
Network tab.

Scriptable's `WebView` class is different: its `shouldAllowRequest` hook gets to inspect *every*
navigation attempt, including that one, before it's followed. So the script opens the real Ford
sign-in page in a `WebView`, you sign in there yourself (this script never sees your Ford
password — it only watches the resulting HTTP redirect), and the script grabs the code the
instant Ford issues it. The token exchanges afterward run as plain on-device HTTP requests (no
browser, so no CORS to work around either). The resulting tokens are stored in Scriptable's
`Keychain`, encrypted, on your phone only.

Net effect: no website, no backend, nothing to host, nothing of yours ever sent anywhere except
directly to Ford's and Autonomic's own endpoints.

There's also no client *secret* anywhere in this script, by design — the `CLIENT_ID` and
per-region `app_id` values it hardcodes are public identifiers baked into Ford's own FordPass
app binary (not something you register, unlike the official FordConnect Query API), so there's
nothing sensitive to keep out of this repo. The only things that identify *your* account — the
refresh token from signing in, and your VIN — are never written to the script or committed
anywhere; they live only in Scriptable's on-device `Keychain`.

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
status, lock, unlock, remote start, cancel remote start, request a fresh report, configure the
widget (see below), or re-run setup (to change your VIN/region or sign in again).

## Configuring a widget

Each widget instance can show a different set of tiles, via its Parameter field (long-press the
widget → Edit Widget → Parameter) — a comma-separated list of item names (`doors`, `fuel`,
`range`, `odometer`, `temp`, `oil`, `battery12v`, `doorsVerbose`, `image`) plus an optional
`imperial`/`metric` override, e.g. `doors,fuel,odometer,metric`. See the full explanation and
defaults in the next section — but you don't have to type this by hand:

Run the script (tap it, don't just view the widget) → **Configure widget (tiles & units)**
opens a checklist: tap a row to toggle that tile on/off, tap Units to flip imperial/metric, then
either:

- **Save as default for blank-parameter widgets** — applies to every widget whose Parameter
  field is empty (the common case if you only have one widget).
- **Copy as Parameter text for one specific widget** — puts the right string on your clipboard
  to paste into one widget's Parameter field, for when you want that one to differ from the
  default (e.g. a small widget with just `doors,fuel` next to a large one with everything).

## Parameter field reference

A widget's Parameter field is a single text field, used as a comma-separated list mixing two
kinds of tokens — order doesn't matter except for item order:

- Tile names (each takes a third of a row, 3 to a row), in the order you want them shown:
  `doors` (collapsed, one line), `fuel` (fuel level or EV charge %), `range`, `odometer`,
  `temp` (outside temp), `oil` (oil life, ICE only), `battery12v` (12V battery), `tires` — a
  one-word summary ("OK", or e.g. "1 Low" / "2 issues") of Ford's own per-wheel verdict,
  `windows` — "CLOSED", "OPEN", or e.g. "1 OPEN" if some but not all are open, `alarm` (e.g.
  "DISARMED"), `ignition` (e.g. "OFF").
- Full-width block names, each always on its own row: `doorsVerbose` — an alternative to
  `doors`, a 2×2 table (front driver/passenger side correctly placed per your region's driving
  side, rear left/right, plus a tailgate row if present). `tiresVerbose` — an alternative to
  `tires`: all 4 wheel readings as a 2×2 grid laid out the way they'd sit on the actual vehicle
  (front pair on top, rear pair below — not overlaid on the `image` block, just arranged the
  same way), pressure plus Ford's status word, in orange when not normal. `windowsVerbose` — an
  alternative to `windows`, the same 2×2 layout as `doorsVerbose` (front driver/passenger per
  region, rear left/right), each cell OPEN (orange) or CLOSED. `image` — the vehicle's photo,
  as shown in the real FordPass app.
- `imperial` or `metric`, to pin that widget to a unit system regardless of the saved
  preference (see Units below).
- `notitle`, to hide the "FordPass" header entirely and reclaim that space.

Example: `doorsVerbose,fuel,odometer,metric,notitle` shows the door table, then fuel + odometer
on their own row below it, in metric, with no header. Leave it blank to get the saved default
(configured as above), or — if you've never opened the configurator — the built-in default
(small widgets show just doors + fuel; medium and large show all tiles, header shown). An
unrecognized token is silently ignored rather than erroring, so a typo just falls back to the
default rather than breaking the widget.

## Units

Ford's API always reports raw values in metric (km, °C, kPa) regardless of your vehicle's
region. The script defaults to converting these to imperial (mi, °F, psi) for display; switch to
metric from the in-script menu ("Units: ... (tap to switch)") — the preference is saved and
applies to every widget using this script, unless overridden per-widget as described above.

Fuel level, EV charge, oil life, and 12V battery are already percentages in Ford's API — no
conversion applies to those.

## Status

Ported and unit-tested for the crypto/protocol pieces (the vendored SHA-256 matches known test
vectors, and the token-exchange/refresh calls mirror an earlier Python implementation that was
verified live against Ford's real endpoints), and confirmed working end-to-end on a physical
device for sign-in, the core doors/fuel/odometer tiles, and the `image` block. `doorsVerbose`,
`tires`/`tiresVerbose`, and `windows`/`windowsVerbose` were all confirmed correct by running
their logic directly against real live telemetry (not just reasoned about): real values for
every door and every wheel, including the exact `vehicleWheel` enum names
(`FRONT_LEFT`/`FRONT_RIGHT`/`REAR_LEFT`/`REAR_RIGHT`) and that Ford computes its own per-wheel
tire status verdict (confirmed value: "NORMAL"; other values like "LOW" are handled
generically — anything not "NORMAL" counts as a problem, so severity is Ford's own
determination against the vehicle's placard spec, not a threshold this script invents); and for
windows, that the raw metric key is actually `windowStatus` (not `windowPosition`, which is
only `ha-fordpass`'s display name for it) and each entry's value is a numeric
`doubleRange`, not a status string — both bounds `0.0` means closed, anything else means open,
treated as binary rather than a percentage since nothing confirms finer meaning. This vehicle
only ever reports front windows; `REAR_LEFT`/`REAR_RIGHT` naming for a vehicle that does report
rear windows is an unconfirmed guess mirroring the (confirmed) door naming. If `doorsVerbose` or
`windowsVerbose` still appear to show nothing on a given widget, that's more likely the widget's
fixed, non-scrolling canvas clipping content than a logic bug; try it with fewer other items in
the same widget first. `alarm` and `ignition` are confirmed too (`alarmStatus.value`:
"DISARMED"; `ignitionStatus.value`: "OFF" on this vehicle, both plain single-value objects
rather than arrays — only other states, like "ARMED" or "ON"/"RUN", aren't something this
vehicle has been caught in yet to confirm the exact wording of).

The raw metric key names used for range, outside temp, oil life, and 12V battery come from
[ha-fordpass](https://github.com/marq24/ha-fordpass)'s own field mapping, not yet cross-checked
against this script's own live output — if any of those tiles come up blank, use the in-script
menu's "Refresh status" (which opens the full raw JSON via QuickLook) to find the right key and
adjust the `metricValue(...)` calls in `buildWidget()`.
