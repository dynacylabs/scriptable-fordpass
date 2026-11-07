# fordconnect-js

A JavaScript client library for Ford's FordConnect Query API, built for the
[Scriptable](https://scriptable.app) iOS app runtime.

This library is meant to be imported (via Scriptable's `importModule`) into a Scriptable
script or widget rather than used standalone.

## What it does

- Handles the OAuth 2.0 authorization-code flow against Ford's Azure AD B2C tenant: opens the
  consent login in Safari, and resumes inside Scriptable via a custom URL scheme redirect
  handoff, storing tokens in Scriptable's `Keychain`.
- Provides a client for the FordConnect Query endpoints:
  - `GET /v1/garage`
  - `GET /v1/telemetry`
  - `GET /v1/vehicle-health/alerts`
  - `GET /v1/wallbox`
  - `GET /v1/electric/departure-times`
  - `GET /v1/electric/charge-schedules`
  - `GET /v1/fccs` (charging station activity)

## Status

Early scaffolding — API surface and auth flow are still being built out.

## Related

- [fordconnect-py](https://github.com/dynacylabs/fordconnect-py) — the equivalent library for
  Python / Home Assistant.
- [fordconnect-toolkit](https://github.com/dynacylabs/fordconnect-toolkit) — the parent repo
  tying both libraries together.
