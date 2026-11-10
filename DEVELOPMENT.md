# Development notes

Implementation-verification and layout-debugging notes for contributors/maintainers — what's been
confirmed against a real vehicle vs. assumed, and the history of UI fixes. None of this is needed
to just use the widget; see [README.md](README.md) for that.

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

`alarm` vs. `panicAlarm`: "DISARMED" reads as security-system arm-state terminology (a
*triggered* alarm wouldn't typically use that word), and `ha-fordpass`'s own code treats
`alarmStatus` and a separate `panicAlarmStatus` field as two different concepts — the latter
specifically for panic/triggered events, kept as its own attribute rather than merged into the
former. That's reasonably strong evidence `alarm` (armed/disarmed) is already correct, but
rather than guess, `panicAlarm` exposes the dedicated field too (confirmed live:
`panicAlarmStatus.value`: "UNDEFINED", i.e. no panic event right now) so both can be compared
against real values over time to settle it for sure.

`health`/`healthVerbose` are confirmed live too: `metrics.indicators` (not a top-level
`messages` field, which `ha-fordpass` also references but came back `null` for this vehicle via
this endpoint) is a dict of ~45 named warning lights, each a plain boolean — all `false` right
now, matching the old official-API dashboard's "No active alerts" exactly. Verified the
summary/list logic directly against the real data plus two simulated active faults
(`lowEngineOilPressure`, `tirePressureMonitorSystemWarning`) before shipping, same as the other
features here — correct pluralization and camelCase→Title Case humanization confirmed, not just
reasoned about.

`panicAlarm` displays as "—" rather than the literal word "UNDEFINED" when there's no panic
event — that's Ford's own real raw value for the no-event case (confirmed live), not a bug;
just not worth showing verbatim.

`location` is confirmed live too: `metrics.position.value.location` is `{lat, lon, alt}`, plus a
bonus `metrics.compassDirection.value` (e.g. "SOUTHWEST"). Verified the coordinate formatting
and the generated Apple Maps URL directly against real data before shipping.

The raw metric key names used for range, outside temp, oil life, and 12V battery come from
[ha-fordpass](https://github.com/marq24/ha-fordpass)'s own field mapping, not yet cross-checked
against this script's own live output — if any of those tiles come up blank, use the in-script
menu's "Refresh status" (which opens the full raw JSON via QuickLook) to find the right key and
adjust the `metricValue(...)` calls in `buildWidget()`.

Tap-to-detail (tapping a tile to jump straight to its verbose view) was tried and reverted: it
worked mechanically, but opening the Scriptable app to show a sheet felt disjointed rather than
part of the widget — and that's not fixable here. True in-place interactive widgets (iOS 17+)
need a native `AppIntent` the widget extension runs without leaving the home screen; Scriptable's
widget API doesn't expose anything like that (`WidgetStack.url`/`WidgetText.url`, the full
extent of its tap support, can only open a URL, which for `scriptable:///` means foregrounding
the app) — a hard platform limitation, not something this script could route around. The
always-visible verbose blocks (`doorsVerbose`, etc.) and the in-script menu's "Refresh status"
remain the ways to get more detail.

The `commands` widget block reuses the exact same `scriptable:///run/...` + `args.queryParameters`
mechanism as that reverted tap-to-detail feature, so the same caveat applies: the underlying
`sendCommand()` call is already proven live (used it directly against the real truck earlier
this session — "Request Fresh Report command sent" actually worked), but the tap → app-opens →
confirm-dialog → send round-trip specifically needs a real tap on a real device to confirm it
behaves as documented. Unlike tap-to-detail, this one was kept rather than reverted on the same
app-switch grounds, since sending a command is a deliberate action rather than passive viewing,
and the added confirm step means a stray tap can only open a dialog, not fire anything.

The go-home handoff (`Safari.open("shortcuts://run-shortcut?name=...")` after a successful
send) is a well-established community pattern for this exact problem, not something invented
here, but it's equally unverified live for the same reason — needs a real device with the "Go
Home" shortcut actually created to confirm it lands cleanly on the home screen rather than
stalling on the Shortcuts app.

Two corrections found during a full raw-telemetry inventory pass: the `outside` tile (then still
named `temp`) had been reading a metric key called `outsideTemp`, which doesn't exist — the real
key is `outsideTemperature` — so it had been silently showing `—` since the tile was added; fixed
and confirmed against real data (9.25°C). Separately, the vehicle's `nickName` field (the thing
the earlier, reverted nickname-title-mode attempt was looking for) does exist, but at the garage
vehicle object's **top level**, not nested inside `profile` like every guess that attempt tried
— it just happens to be `null` for this account's vehicle (never set via whatever channel
populates it), which is why re-adding that feature wasn't prioritized here, not because the
field doesn't exist.

Multi-vehicle support (adding, removing, setting active, and the per-widget VIN override) was
verified directly: ran the real garage-fetch and migration logic through Node against the
actual API response shape and a simulated pre-existing single-VIN install, not just reasoned
about. What's unverified live, same as everywhere else UI-interaction-dependent: the actual
"Manage vehicles" screen's taps and the Parameter-field VIN matching end-to-end on a real
device — the account used for testing only has one vehicle, so the multi-vehicle *picker* list
itself couldn't be exercised against a real 2+-vehicle account.

`hood`, `parkingBrake`, `remoteStartTimer`, and `ambientTemp` are all confirmed live:
`hoodStatus.value`: "CLOSED"; `parkingBrakeStatus.value`: "OFF" (plus an unused
`parkingBrakeType`: "MECHANICAL"); `remoteStartCountdownTimer.value`: raw seconds, confirmed via
the earlier live remote-start test (900 right after a successful start, i.e. Ford's 15-minute
window) — shown as minutes, "OFF" when 0. `ambientTemp` itself reads 0.0°C/32°F on this vehicle
right now, clearly distinct from `outsideTemperature`'s 9.25°C — but *what* makes them different
(cabin vs. engine-bay sensor, or something else) isn't confirmed; shown as-is either way.

`seatBelt`/`seatBeltVerbose` are confirmed live: `seatBeltStatus` is an array of
`{value, vehicleOccupantRole}` entries (`PASSENGER: UNBUCKLED` seen on this vehicle at the time
of testing), unlike doors/windows/tires it carries no door-side geometry, so the verbose view
lists whatever occupant roles the vehicle actually reports rather than a fixed grid — this
vehicle has never reported a rear entry, so rear belts are unconfirmed.

`xevPlugCharger` is confirmed present and live, but its value is suspect: it reads "CONNECTED"
on this vehicle, which is a non-plug-in ICE F-150 with no charge port at all. Either Ford
returns a meaningless default for this field on vehicles it doesn't apply to, or it means
something else entirely here — unconfirmed either way. Shown as-is (opt-in) since it should be
meaningful for plug-in hybrid/EV owners even though it clearly isn't here.

The remaining driving-telemetry fields (`speed`, `accelPedal`, `brakePedal`, `brakeTorque`,
`engineSpeed`, `engineCoolantTemp`, `gear`, `transTorque`, `wheelTorque`, `yawRate`,
`tripEconomy`, `tripEvDistance`, `acceleration`, `customMetrics`) are all confirmed present and
live, but every numeric one was only ever observed at rest (vehicle parked the whole time this
was tested) — `speed: 0`, `engineSpeed: 0`, `torqueAtTransmission: 0`, `tripFuelEconomy: 0`,
etc. — so a resting zero confirms the field exists and the key name is right, but can't confirm
unit or scale for anything that would only move off zero while actually driving:
- `speed` is assumed km/h, by analogy with every other distance-based field (odometer,
  fuelRange) always reporting raw km regardless of region — not independently confirmed.
- `accelPedal` is assumed a 0-100 percentage, by analogy with fuelLevel/oilLifeRemaining —
  likewise not independently confirmed.
- `brakeTorque`, `transTorque` (Nm), and `yawRate` (deg/s) have no confirmed unit at all —
  shown as bare numbers rather than guessing a label that might be wrong.
- `tripEconomy` (raw `tripFuelEconomy`) could be L/100km, km/L, or mpg-style — also shown
  as a bare number for the same reason.
- `tripEvDistance` (raw `tripXevBatteryDistanceAccumulated`) is assumed km, same reasoning as
  `speed`.
- `acceleration` is a 3-axis accelerometer reading (`{x, y, z}`), not a simple scalar; the
  tile shows the combined magnitude (√(x²+y²+z²), ~1.18 at rest) and `accelerationVerbose`
  shows the raw per-axis values — whether the unit is g, m/s², or something else is
  unconfirmed; 1.18 being close to (but not exactly) 1g while parked is suggestive, not proof.
- `brakePedal`, `gear`, `wheelTorque` are plain Ford status strings (confirmed `"ON"`,
  `"PARK"`, `"OFF"` respectively) shown verbatim, same treatment as `hood`/`ignition`/etc.
- `customMetrics` keys are per-vehicle signal UUIDs
  (`aui:signal:<uuid>:custom:<name>`), not stable field names — `customMetricsVerbose` lists
  whatever the vehicle happens to report, labeled by the readable suffix after the last `:`.
  This vehicle currently reports 5 (acceleration/deceleration/cruising coaching scores, trip
  length, trip fuel consumption) — a different vehicle may report a completely different set.

## Visual layout notes

Found via a real-device screenshot review pass (15 screenshots across widget sizes and every
verbose block/image/location/commands combination), not just reasoned about:

- The 2-column verbose grids (`doorsVerbose`, `tiresVerbose`, `windowsVerbose`,
  `seatBeltVerbose`) and the 3-tile rows used a fixed-width gap between columns regardless of
  widget size, which left the whole layout clustered on the left with a visible unused strip on
  the right of a medium/large widget — not just the verbose grids, every tile row had this too.
  A first pass tried a wider, per-family-tuned fixed gap for the verbose grids, which helped but
  still didn't reach the right edge. Replaced that with a flexible spacer (`stack.addSpacer()`
  with no argument — a spring that fills whatever space is left, same as a UIStackView spacer)
  between every column in both the tile rows and the verbose grids: the first column now sits at
  the left edge, the last at the right edge, with equal spacing for anything in between,
  regardless of widget width — no per-family tuning needed.
- `seatBeltVerbose` originally put each occupant on its own full-width row with a flexible
  spacer pushing the buckled/unbuckled value to the far right edge — fine with 1 occupant, but
  an oddly large gap with the label. Redesigned to match the doors/tires/windows cell style
  (label above, bold value below), 2 occupants per row.
- `image` (the full-width vehicle photo block) was bumped up in a first pass to fill a large
  widget's otherwise-empty space when used alone, but that made it dominate the widget when
  combined with other content — reverted back to its original size. Added `imageTile` instead:
  a small version of the same photo sized to sit in a tile row next to 2 other tiles, for
  "the photo doesn't need its own row" cases.
- A widget's canvas size is fixed by iOS per family with no scrolling, so selecting more content
  than fits (confirmed live with a "kitchen sink" large widget selecting everything) just clips
  silently at the bottom — there's no way around this in Scriptable's widget API, so it's a
  "don't over-select for the widget size you're using" guideline rather than a bug to fix.
- `location` alone on a large widget is sparse (two lines of text, no map preview) — left as-is
  for now rather than adding a static map image, since that would mean depending on a map
  provider's snapshot API (and likely an API key) that doesn't exist on-device in Scriptable.

A second review round (after the fixes above) confirmed those fixes live and surfaced one more
case of the same underlying "fixed canvas, no scrolling" limitation: a medium widget packed with
4 full rows of tiles (12 tiles) fits fine with the title hidden, but with the title shown it
clips at both ends — the header text itself gets cut off at the top and the "Updated" timestamp
disappears off the bottom. Same guidance as the kitchen-sink case: `notitle`, or fewer tiles,
for a widget that's already packing 3+ full rows.

A third round added actual layout control in response to feedback that the ordering-only model
(select items, they wrap at a fixed 3 per row) wasn't enough say over where things land: tiles
per row is now configurable (`cols2`/`cols3`/`cols4`, or the Columns row in either configurator),
and `newrow` lets a Parameter field force a row break early instead of only ever auto-wrapping at
that column count. Together with `imageTile` from the round above, this covers the two concrete
asks (full-width layout, a non-dominant inline image) plus general placement control, without
building a full drag-and-drop layout editor, which felt like more complexity than a single-file
widget config warrants.

`commands` originally split its 5 buttons into two rows (3, then 2) defensively, from before it
was clear how many commands there'd ever be -- with only 5 fixed buttons that never grows, and
confirmed room to spare on a medium/large widget, that split served no purpose. Now a single row
of all 5, same flexible-spacer approach as everything else.

A fourth round replaced the flexible-spacer approach (from the first two rounds) with actual
fixed-width columns, after feedback that things still "weren't aligned" -- a flexible spacer
fills a *single* row's leftover width fine, but each row's column boundaries end up wherever
that row's own content happens to end, so one row's 2nd column doesn't line up with another
row's 2nd column (e.g. DOORS' front-row cell 2 starting at a different x than its rear-row cell
2, since "DRIVER"/"PASSENGER" and "REAR LEFT"/"REAR RIGHT" aren't the same width). Every
multi-column row (tile rows, `doorsVerbose`/`tiresVerbose`/`windowsVerbose`/`seatBeltVerbose`,
`commands`) now divides an approximate per-family content-width budget (`columnWidth()` in the
script) into equal, fixed-width columns with a consistent gap, so columns genuinely line up into
a grid regardless of what each row's own content happens to be. The budget itself is an estimate
(same "close enough, real widths vary by device" caveat as `IMAGE_SIZE_BY_FAMILY`) -- if a future
screenshot round shows columns too narrow or too wide, that's the number to retune. One place
this got tight: 5 equal-width `commands` buttons leaves ~52pt each on a medium/large widget,
likely too narrow for "REFRESH" at the original font/padding -- tightened the button padding and
font size and added `minimumScaleFactor` (shrink-to-fit) as a safety net, but this one in
particular is worth a close look in the next screenshot round.

`customMetricsVerbose`'s label-left/value-right rows were left alone -- with only one flexible
spacer per row (not multiple competing columns like the grids above), the value already lands
flush against the same right edge on every row regardless of label length, so there was no actual
misalignment there to fix.

A fifth round made the configurator reorderable in response to feedback that hand-editing the
Parameter field was the only way to control item order. Checked Scriptable's own docs first:
`UITable`/`UITableRow` has no drag-and-drop or move API at all -- rows render in whatever order
`addRow()` was called, with no documented way to change that afterward. So reordering is ↑/↓
buttons per row instead (the practical equivalent given the platform), and the configurator's
"which items" and "what order" are now the same single list (Selected) rather than order being
implicitly whatever TILE_DEFS/BLOCK_DEFS happened to declare -- see Configuring a widget above.

A sixth round fixed three things found in that round's screenshots:
- `commands`' 5 buttons had visibly inconsistent text sizes -- `minimumScaleFactor` was doing
  the actual sizing work, and it shrinks each button only as much as *that button's own* label
  needs, so short labels ("LOCK") stayed full-size while long ones ("REFRESH") shrank
  noticeably smaller. Replaced with one shared, fixed font size (8pt) picked to fit the longest
  label without shrinking at all, so every button is now the same size; `minimumScaleFactor` is
  still set as a safety net but shouldn't actually need to trigger.
- `imageTile`'s photo was left-aligned inside its now-fixed-width cell from the earlier grid
  rework, which looked off-center since the photo's own aspect ratio rarely fills the cell
  exactly -- switched to centered.
- `newrow` had quietly become impossible to set up via the configurator: the in-app header text
  that used to explain it was Parameter-field-only got dropped when the configurator was
  rewritten to be reorderable, leaving no way to discover or add one short of hand-typing the
  Parameter field from memory. Added a "+ Add a row break" button (adds a `— new row —` entry
  to Selected, moved into position with the same ↑/↓ buttons as everything else). This also
  surfaced a related bug: `loadDefaultTiles()`'s filter only kept known TILE_DEFS/BLOCK_DEFS
  keys, so a `newrow` saved via "Save as default" would've silently vanished the next time it
  loaded (fine for "Copy as Parameter text", which doesn't round-trip through that filter) --
  fixed to keep `newrow` through that filter too.

A seventh round tried to fix the sixth round's `commands`/`imageTile` centering (`t.centerAlignText()`
and `col.centerAlignContent()`), but both guesses were still wrong -- confirmed still off in
another screenshot round. Went to Scriptable's own docs instead of guessing a third time:
`WidgetText`'s reference page says outright, in so many words, "alignment doesn't apply to text
inside stacks -- for centered text in a horizontal stack, add a spacer both before and after the
text." That's not a style choice, it's the documented (if unintuitive) mechanism -- alignment
methods on a stack's direct children are a no-op; centering requires wrapping the child in its
own horizontal sub-stack with a flexible `addSpacer()` on each side. Fixed both `commands`
(button text) and `imageTile` (the image only -- the label next to/above it stays left-aligned,
matching every other tile's label) using that pattern. `image`'s existing `wi.centerAlignImage()`
call was left alone despite being the same method -- it's a direct child of the `ListWidget`
itself, not of a `WidgetStack`, and was already visually centered correctly in earlier rounds, so
that specific docs caveat about stacks doesn't apply to it.

An eighth round found the seventh round's spacer-wrap fix made `commands` *worse*, not better:
button labels started truncating ("UN...", "ST...", "RE..."). Root cause: the nested
`spacer-text-spacer` stack (`textRow`) had no explicit `.size` of its own, and a `WidgetStack`
with no explicit size hugs its own content rather than stretching to fill its parent's fixed
width -- so the two spacers had no actual leftover space to claim, and the wrapped text ended up
with *less* real width than the same text had as an unwrapped direct child of `btn` before any of
this, triggering `lineLimit`'s truncation where it hadn't before. Fix: give the nested stack an
explicit width matching its parent's own budget (`btn`'s fixed width minus `btn`'s own padding,
since that padding insets everything laid out inside it, `textRow` included) so the spacers have
a real, known amount of space to work with -- restoring the same effective text width the
original unwrapped version had, while now actually achieving centering too. Bumped
`minimumScaleFactor` back down to a real safety net (0.7, same as the very first version) rather
than the prior round's token 0.95, given how little margin ~40pt of actual text width leaves.
Applied the identical explicit-size fix to `imageTile`'s equivalent `imageRow` wrapper
proactively, even though it hadn't been reported broken, since it has the exact same unsized-
nested-stack shape and so the same latent risk -- `col` has no padding, so its full width budget
applies to `imageRow` directly, no subtraction needed there.

A ninth round (not previously written up here) found `commands` still truncated "UNLOCK"/
"REFRESH" even after the eighth round's sizing fix -- the real text budget genuinely wasn't
enough at 8pt, not just a width-computation mismatch. Rather than guess a third exact point
size (character-width-per-point estimates for this font had now been wrong twice), that round
leaned on the actual guarantee instead of the arithmetic above it: tightened `commands`' own gap
and button padding for a bit more real width, dropped the font to 7pt, and lowered
`minimumScaleFactor` to 0.5 (a genuine 3.5pt floor) -- `lineLimit(1)` + `minimumScaleFactor` is
the standard "shrink, never truncate" combination, so a low enough floor prevents truncation
regardless of whether the budget math above it is exactly right.

A tenth round found the same underlying problem (text wrapping inside a fixed-width column) was
never actually fixed for anything *except* `commands` -- a fresh 21-screenshot pass turned up
label wrapping at `cols4` ("REMOTE START" -> "REMOTE"/"START", "PANIC ALARM", "BRAKE TORQUE",
etc. -- confirmed on both a medium and a large widget) and, more importantly, *value* wrapping on
the most basic possible case: the default `doors` tile's "UNLOCKED" value wrapped to "UNLOC"/
"KED" on a small widget at the user's saved 2-column setting. Every other tile/cell (`addTile`/
`addTileLabel`, and the doors/tires/windows/seatBelt verbose cells) had no `lineLimit` or
`minimumScaleFactor` at all before this -- they just wrapped by default the moment text didn't
fit, which also throws off row-height alignment against neighboring cells that didn't wrap.
Applied the same `lineLimit(1)` + `minimumScaleFactor` shrink-to-fit pattern from the
ninth-round `commands` fix universally, via a shared `fitTextToWidth()` helper, to every tile
label/value and every verbose-grid cell's label/value/sub-label. Floors are deliberately
generous (0.7 for labels, 0.5-0.6 for values) given how unreliable this font's character-width
estimates have proven to be all session -- the floor itself, not precise arithmetic above it, is
what's meant to guarantee no more wrapping regardless of column count or label length.

An eleventh round found the tenth round's floors (0.7/0.5-0.6) still weren't low enough -- a
follow-up screenshot pass showed "REMOTE START"/"PANIC ALARM" now fit fine at `cols2`, but
"BRAKE TORQUE"/"TRIP ECONOMY" at the *identical* column width still wrapped, and every `cols4`
case (medium and large alike) still wrapped across the board. The real lesson: this font's
character widths vary enough by which letters are in a word (wide round glyphs -- O, Q, C, M --
vs narrow ones -- I, T, L, R) that a floor rescuing one word of a given length can still be too
high for another word of the same length. Worse, once `minimumScaleFactor`'s floor is exhausted,
a plain `WidgetText` (unlike the `commands` buttons' text, which truncates) falls back to
*wrapping* again rather than truncating -- so an insufficient floor fails exactly the same way
as having no floor at all, with no visible partial credit for trying. Rather than tune the
numbers a third time, dropped the floors much further than the arithmetic says should be
necessary (0.4 for labels, 0.35 for values) specifically to survive being wrong about character
widths yet again -- worst case this renders some words quite small, which is still strictly
better than wrapping (and the misaligned row heights that come with it).

Confirmed via a follow-up screenshot round: all of "BRAKE TORQUE"/"TRIP ECONOMY" (cols2),
"REMOTE START"/"PANIC ALARM"/"PARK BRAKE"/"BRAKE TORQUE" (cols4, medium), and
"ACCEL PEDAL"/"BRAKE PEDAL"/"TRANS TORQUE"/"WHEEL TORQUE"/"TRIP ECONOMY" (cols4, large) now fit
on one line. No regressions in the doors/tires/windows/seatBelt verbose grids.
