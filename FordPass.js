// FordPass widget for Scriptable (https://scriptable.app).
//
// Single-file by design — Scriptable users install by pasting/downloading one script.
// Talks to Ford's private FordPass/Lincoln Way mobile-app API (reverse-engineered,
// ported from fordconnect-py's `fordconnect.fordpass`, itself ported from
// https://github.com/marq24/ha-fordpass). Unofficial, unsupported by Ford, can break
// or draw account scrutiny — consider a secondary FordPass account rather than your
// primary one.
//
// Everything runs on-device: sign-in, all three token exchanges, and storage (in
// Scriptable's Keychain). No server is involved and nothing is ever sent anywhere
// except directly to Ford's and Autonomic's own endpoints — the same ones the real
// FordPass app talks to.
//
// Setup: run this script once (tap it in the Scriptable app, not as a widget) and
// follow the prompts. After that, add a widget, choose Scriptable, and pick this
// script as its script.

// ===================== region config (ported from fordconnect-py) =====================

const CLIENT_ID = "09852200-05fd-41f6-8c21-d36d3497dc64";
const OAUTH_ID = "4566605f-43a7-400a-946e-89cc9fdb0bd7";

const FORD_FOUNDATIONAL_API = "https://api.foundational.ford.com/api";
const FORD_VEHICLE_API = "https://api.vehicle.ford.com/api";
const AUTONOMIC_URL = "https://api.autonomic.ai/v1";
const AUTONOMIC_ACCOUNT_URL = "https://accounts.autonomic.ai/v1";

// Mimics the FordPass Android app's own HTTP client (okhttp), not a browser — Ford
// has been observed rejecting requests that look browser- or script-originated.
const API_HEADERS = {
  "Accept-Encoding": "gzip",
  Connection: "keep-alive",
  "User-Agent": "okhttp/4.12.0",
  "Content-Type": "application/json",
};
const LOGIN_HEADERS = {
  "Accept-Encoding": "gzip",
  Connection: "keep-alive",
  "Content-Type": "application/x-www-form-urlencoded",
  "User-Agent": "okhttp/4.12.0",
};

const NORTH_AMERICA_APP_ID = "BFE8C5ED-D687-4C19-A5DD-F92CDFC4503A";
const EUROPE_APP_ID = "667D773E-1BDC-4139-8AD0-2B16474E8DC7";
const ASIA_PACIFIC_APP_ID = "39CD6590-B1B9-42CB-BEF9-0DC1FDB96260";
const AFRICA_APP_ID = "71AA9ED7-B26B-4C15-835E-9F35CC238561";

const REGIONS = {
  usa: { app_id: NORTH_AMERICA_APP_ID, locale: "en-US", login_url: "https://login.ford.com", countrycode: "USA" },
  can: { app_id: NORTH_AMERICA_APP_ID, locale: "en-CA", login_url: "https://login.ford.com", countrycode: "CAN" },
  mex: { app_id: NORTH_AMERICA_APP_ID, locale: "es-MX", login_url: "https://login.ford.com", countrycode: "MEX" },
  gbr: { app_id: EUROPE_APP_ID, locale: "en-GB", login_url: "https://login.ford.co.uk", countrycode: "GBR" },
  deu: { app_id: EUROPE_APP_ID, locale: "de-DE", login_url: "https://login.ford.de", countrycode: "DEU" },
  fra: { app_id: EUROPE_APP_ID, locale: "fr-FR", login_url: "https://login.ford.com", countrycode: "FRA" },
  ita: { app_id: EUROPE_APP_ID, locale: "it-IT", login_url: "https://login.ford.com", countrycode: "ITA" },
  esp: { app_id: EUROPE_APP_ID, locale: "es-ES", login_url: "https://login.ford.com", countrycode: "ESP" },
  nld: { app_id: EUROPE_APP_ID, locale: "nl-NL", login_url: "https://login.ford.com", countrycode: "NLD" },
  aus: { app_id: ASIA_PACIFIC_APP_ID, locale: "en-AU", login_url: "https://login.ford.com", countrycode: "AUS" },
  nzl: { app_id: ASIA_PACIFIC_APP_ID, locale: "en-NZ", login_url: "https://login.ford.com", countrycode: "NZL" },
  zaf: { app_id: AFRICA_APP_ID, locale: "en-ZA", login_url: "https://login.ford.com", countrycode: "ZAF" },
  rest_of_world: { app_id: NORTH_AMERICA_APP_ID, locale: "en-US", login_url: "https://login.ford.com", countrycode: "USA" },
  lincoln_usa: {
    app_id: "45133B88-0671-4AAF-B8D1-99E684ED4E45",
    locale: "en-US",
    login_url: "https://login.lincoln.com",
    sign_up_addon: "Lincoln_",
    redirect_schema: "lincolnapp",
    countrycode: "USA",
  },
};

const KEYCHAIN_TOKEN_KEY = "fordconnect_fordpass_token";
const KEYCHAIN_VIN_KEY = "fordconnect_vin"; // legacy single-VIN storage, read only for migration
const KEYCHAIN_VEHICLES_KEY = "fordconnect_vehicles";
const KEYCHAIN_ACTIVE_VIN_KEY = "fordconnect_active_vin";
const KEYCHAIN_REGION_KEY = "fordconnect_region";
const KEYCHAIN_UNITS_KEY = "fordconnect_units";
const KEYCHAIN_DEFAULT_TILES_KEY = "fordconnect_default_tiles";
const KEYCHAIN_TITLE_MODE_KEY = "fordconnect_title_mode";
const KEYCHAIN_MAP_PROVIDER_KEY = "fordconnect_map_provider";
const KEYCHAIN_GO_HOME_ENABLED_KEY = "fordconnect_go_home_enabled";
const EXPIRY_SKEW_MS = 60 * 1000;

// ===================== small helpers (no Web APIs in Scriptable's JS runtime) =====================

function formEncode(obj) {
  return Object.keys(obj)
    .map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]))
    .join("&");
}

function base64url(bytes) {
  return Data.fromBytes(bytes)
    .toBase64String()
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomVerifier(byteLen = 64) {
  const bytes = [];
  for (let i = 0; i < byteLen; i++) bytes.push(Math.floor(Math.random() * 256));
  return base64url(bytes);
}

// Pure-JS SHA-256 (FIPS 180-4) — Scriptable has no built-in crypto/digest API, so
// this is vendored rather than imported. Only used for the PKCE code_challenge.
function sha256Bytes(message) {
  function rrot(v, n) {
    return (v >>> n) | (v << (32 - n));
  }
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const utf8 = unescape(encodeURIComponent(message));
  const bytes = [];
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);

  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(Math.floor(bitLen / Math.pow(2, i * 8)) & 0xff);

  for (let chunk = 0; chunk < bytes.length; chunk += 64) {
    const w = new Array(64).fill(0);
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[chunk + i * 4] << 24) |
        (bytes[chunk + i * 4 + 1] << 16) |
        (bytes[chunk + i * 4 + 2] << 8) |
        bytes[chunk + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rrot(w[i - 15], 7) ^ rrot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rrot(w[i - 2], 17) ^ rrot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const out = [];
  for (const word of [h0, h1, h2, h3, h4, h5, h6, h7]) {
    out.push((word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff);
  }
  return out;
}

// ===================== token storage =====================

function loadToken() {
  if (!Keychain.contains(KEYCHAIN_TOKEN_KEY)) return null;
  return JSON.parse(Keychain.get(KEYCHAIN_TOKEN_KEY));
}

function saveToken(token) {
  Keychain.set(KEYCHAIN_TOKEN_KEY, JSON.stringify(token));
}

// Multi-vehicle storage: a list of {vin, label} plus which one is "active" (used by the
// menu and by any widget whose Parameter field doesn't name a specific vehicle). Older
// installs only ever had a single VIN in KEYCHAIN_VIN_KEY -- migrated transparently into
// a one-item list the first time loadVehicles() runs after this update.
function loadVehicles() {
  if (Keychain.contains(KEYCHAIN_VEHICLES_KEY)) {
    try {
      return JSON.parse(Keychain.get(KEYCHAIN_VEHICLES_KEY));
    } catch (e) {
      return [];
    }
  }
  if (Keychain.contains(KEYCHAIN_VIN_KEY)) {
    const migrated = [{ vin: Keychain.get(KEYCHAIN_VIN_KEY), label: Keychain.get(KEYCHAIN_VIN_KEY) }];
    saveVehicles(migrated);
    return migrated;
  }
  return [];
}

function saveVehicles(vehicles) {
  Keychain.set(KEYCHAIN_VEHICLES_KEY, JSON.stringify(vehicles));
}

function loadActiveVin() {
  const vehicles = loadVehicles();
  if (Keychain.contains(KEYCHAIN_ACTIVE_VIN_KEY)) {
    const vin = Keychain.get(KEYCHAIN_ACTIVE_VIN_KEY);
    if (vehicles.some((v) => v.vin === vin)) return vin;
  }
  return vehicles.length ? vehicles[0].vin : null;
}

function saveActiveVin(vin) {
  Keychain.set(KEYCHAIN_ACTIVE_VIN_KEY, vin);
}

// Alias kept for existing call sites throughout the script -- "the VIN" now means "the
// active vehicle's VIN" rather than the only one that could ever exist.
function loadVin() {
  return loadActiveVin();
}

function loadRegion() {
  return Keychain.contains(KEYCHAIN_REGION_KEY) ? Keychain.get(KEYCHAIN_REGION_KEY) : "usa";
}

function loadUnits() {
  return Keychain.contains(KEYCHAIN_UNITS_KEY) ? Keychain.get(KEYCHAIN_UNITS_KEY) : "imperial";
}

function saveUnits(units) {
  Keychain.set(KEYCHAIN_UNITS_KEY, units);
}

// "fordpass" (the literal word) or "hidden" (no header at all).
function loadTitleMode() {
  return Keychain.contains(KEYCHAIN_TITLE_MODE_KEY) ? Keychain.get(KEYCHAIN_TITLE_MODE_KEY) : "fordpass";
}

function saveTitleMode(mode) {
  Keychain.set(KEYCHAIN_TITLE_MODE_KEY, mode);
}

// "apple" or "google" -- which maps app the location block's link opens.
function loadMapProvider() {
  return Keychain.contains(KEYCHAIN_MAP_PROVIDER_KEY) ? Keychain.get(KEYCHAIN_MAP_PROVIDER_KEY) : "apple";
}

function saveMapProvider(provider) {
  Keychain.set(KEYCHAIN_MAP_PROVIDER_KEY, provider);
}

// Scriptable has no API to check whether a named Shortcut actually exists -- Shortcuts
// is a separate app with nothing shared, and even a "probe" would have to open it to
// find out, defeating the point. This is the practical substitute: a local yes/no you
// confirm once (after actually creating the "Go Home" shortcut), checked before
// attempting the handoff, instead of blindly opening Shortcuts on every command.
// Defaults to false so nothing happens until you've confirmed it's set up.
function loadGoHomeEnabled() {
  return Keychain.contains(KEYCHAIN_GO_HOME_ENABLED_KEY) && Keychain.get(KEYCHAIN_GO_HOME_ENABLED_KEY) === "true";
}

function saveGoHomeEnabled(enabled) {
  Keychain.set(KEYCHAIN_GO_HOME_ENABLED_KEY, enabled ? "true" : "false");
}

// The default item set (tiles and/or full-width blocks) used by any widget whose own
// Parameter field is blank — set via the in-script "Configure widget" picker rather
// than typed by hand. null means "no preference saved yet", so buildWidget falls back
// to its own small/full tile defaults.
function loadDefaultTiles() {
  if (!Keychain.contains(KEYCHAIN_DEFAULT_TILES_KEY)) return null;
  const items = Keychain.get(KEYCHAIN_DEFAULT_TILES_KEY)
    .split(",")
    .map((s) => s.trim())
    .filter((t) => TILE_DEFS[t] || BLOCK_DEFS[t]);
  return items.length ? items : null;
}

function saveDefaultTiles(items) {
  Keychain.set(KEYCHAIN_DEFAULT_TILES_KEY, items.join(","));
}

function isExpired(timestampMs) {
  return Date.now() >= timestampMs - EXPIRY_SKEW_MS;
}

// ===================== sign-in (on-device, no server) =====================
//
// Ford's hosted sign-in page redirects to a mobile-app deep link
// (fordapp://userauthorized/?code=... or lincolnapp://...) that no normal web page
// can observe (same-origin policy hides cross-origin/custom-scheme navigation
// targets from JS). Scriptable's WebView is different: `shouldAllowRequest` gets to
// inspect every navigation attempt — including that one — before it's followed, so
// we can grab the code ourselves instead of asking the user to use devtools.

function buildLoginUrl(regionCfg, codeChallenge) {
  const signUp = "B2C_1A_SignInSignUp_" + (regionCfg.sign_up_addon || "");
  const redirectSchema = regionCfg.redirect_schema || "fordapp";
  const base = `${regionCfg.login_url}/${OAUTH_ID}/${signUp}${regionCfg.locale}/oauth2/v2.0/authorize`;
  const params = {
    redirect_uri: `${redirectSchema}://userauthorized`,
    response_type: "code",
    max_age: "3600",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: ` ${CLIENT_ID} openid`,
    client_id: CLIENT_ID,
    ui_locales: regionCfg.locale,
    language_code: regionCfg.locale,
    ford_application_id: regionCfg.app_id,
    country_code: regionCfg.countrycode,
  };
  return `${base}?${formEncode(params)}`;
}

async function interactiveSignIn(regionCfg, timeoutSec = 300) {
  const verifier = randomVerifier(64);
  const challenge = base64url(sha256Bytes(verifier));
  const url = buildLoginUrl(regionCfg, challenge);

  const wv = new WebView();
  let resolveCapture, rejectCapture;
  const captured = new Promise((res, rej) => {
    resolveCapture = res;
    rejectCapture = rej;
  });

  wv.shouldAllowRequest = (request) => {
    if (/^(fordapp|lincolnapp):\/\/userauthorized\/\?code=/.test(request.url)) {
      resolveCapture(request.url);
      wv.loadHTML(
        '<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding:3rem;color:#1a1a1a">' +
          "<h2>Signed in</h2><p>You can close this window now.</p></body></html>"
      );
      return false;
    }
    return true;
  };

  wv.loadURL(url);
  wv.present(true); // not awaited — the exchange below proceeds while the sheet stays open

  const timeout = new Promise((_, rej) => {
    Timer.schedule(timeoutSec * 1000, false, () => rej(new Error("Timed out waiting for sign-in.")));
  });

  const redirectUrl = await Promise.race([captured, timeout]);
  const match = /[?&]code=([^&]+)/.exec(redirectUrl);
  if (!match) throw new Error("No 'code' parameter found in the captured redirect URL.");
  const code = decodeURIComponent(match[1]);

  return exchangeCode(code, verifier, regionCfg);
}

async function exchangeCode(code, verifier, regionCfg) {
  const signUp = "B2C_1A_SignInSignUp_" + (regionCfg.sign_up_addon || "");
  const redirectSchema = regionCfg.redirect_schema || "fordapp";
  const tokenUrl = `${regionCfg.login_url}/${OAUTH_ID}/${signUp}${regionCfg.locale}/oauth2/v2.0/token`;

  const req = new Request(tokenUrl);
  req.method = "POST";
  req.headers = LOGIN_HEADERS;
  req.body = formEncode({
    client_id: CLIENT_ID,
    scope: `${CLIENT_ID} openid`,
    redirect_uri: `${redirectSchema}://userauthorized`,
    grant_type: "authorization_code",
    resource: "",
    code,
    code_verifier: verifier,
  });
  const idpToken = await req.loadJSON();
  if (!idpToken.access_token) {
    throw new Error(`FordPass sign-in token exchange failed: ${JSON.stringify(idpToken)}`);
  }
  return exchangeIdpToken(idpToken.access_token, regionCfg);
}

async function exchangeIdpToken(idpAccessToken, regionCfg) {
  const req = new Request(`${FORD_FOUNDATIONAL_API}/token/v2/cat-with-b2c-access-token`);
  req.method = "POST";
  req.headers = { ...API_HEADERS, "Application-Id": regionCfg.app_id };
  req.body = JSON.stringify({ idpToken: idpAccessToken });
  const data = await req.loadJSON();
  if (!data.access_token) {
    throw new Error(`FordPass token exchange (foundational) failed: ${JSON.stringify(data)}`);
  }
  const token = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    auto_access_token: null,
    auto_expires_at: null,
  };
  saveToken(token);
  return token;
}

// ===================== refresh =====================

async function refreshToken(token, regionCfg) {
  const req = new Request(`${FORD_FOUNDATIONAL_API}/token/v2/cat-with-refresh-token`);
  req.method = "POST";
  req.headers = { ...API_HEADERS, "Application-Id": regionCfg.app_id };
  req.body = JSON.stringify({ refresh_token: token.refresh_token });
  const data = await req.loadJSON();
  if (!data.access_token) {
    throw new Error(`FordPass token refresh failed: ${JSON.stringify(data)}`);
  }
  const newToken = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || token.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    auto_access_token: token.auto_access_token,
    auto_expires_at: token.auto_expires_at,
  };
  saveToken(newToken);
  return newToken;
}

async function refreshAutoToken(token) {
  const req = new Request(`${AUTONOMIC_ACCOUNT_URL}/auth/oidc/token`);
  req.method = "POST";
  req.headers = { Accept: "*/*", "Content-Type": "application/x-www-form-urlencoded" };
  req.body = formEncode({
    subject_token: token.refresh_token,
    subject_issuer: "fordpass",
    client_id: "fordpass-prod",
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  });
  const data = await req.loadJSON();
  if (!data.access_token) {
    throw new Error(`FordPass 'auto' token exchange failed: ${JSON.stringify(data)}`);
  }
  token.auto_access_token = data.access_token;
  token.auto_expires_at = Date.now() + (data.expires_in || 300) * 1000;
  saveToken(token);
  return token;
}

async function getValidToken(regionCfg) {
  let token = loadToken();
  if (!token) throw new Error("Not signed in yet. Run this script and choose Sign in.");
  if (isExpired(token.expires_at)) token = await refreshToken(token, regionCfg);
  if (!token.auto_access_token || isExpired(token.auto_expires_at)) token = await refreshAutoToken(token);
  return token;
}

// ===================== vehicle data / commands =====================

async function getStatus(vin, regionCfg) {
  const token = await getValidToken(regionCfg);
  const req = new Request(
    `${AUTONOMIC_URL}/telemetry/sources/fordpass/vehicles/${vin}?lrdt=01-01-1970%2000%3A00%3A00`
  );
  req.headers = { ...API_HEADERS, Authorization: `Bearer ${token.auto_access_token}` };
  const data = await req.loadJSON();
  if (req.response.statusCode >= 400) throw new Error(`Status fetch failed: ${JSON.stringify(data)}`);
  return data;
}

async function sendCommand(vin, regionCfg, commandType) {
  const token = await getValidToken(regionCfg);
  const req = new Request(`${AUTONOMIC_URL}/command/vehicles/${vin}/commands`);
  req.method = "POST";
  req.headers = { ...API_HEADERS, Authorization: `Bearer ${token.auto_access_token}` };
  req.body = JSON.stringify({ tags: {}, type: commandType, wakeUp: true });
  const data = await req.loadJSON();
  if (req.response.statusCode >= 400) throw new Error(`${commandType} failed: ${JSON.stringify(data)}`);
  return data;
}

function metric(status, path) {
  const parts = path.split(".");
  let node = status && status.metrics;
  for (const p of parts) {
    if (!node) return null;
    node = node[p];
  }
  return node;
}

function metricValue(status, path, arrayFind) {
  let node = metric(status, path);
  if (Array.isArray(node)) {
    node = arrayFind ? node.find(arrayFind) : node[0];
  }
  return node ? node.value : null;
}

// Ford's telemetry API always reports in these raw units regardless of vehicle
// region — confirmed against ha-fordpass's unit handling (fordpass_handler.py),
// the reference project this client is ported from — so "imperial" always means
// converting away from these, never the other direction.
function formatDistanceKm(km, units) {
  if (km == null || typeof km !== "number") return null;
  return units === "imperial" ? `${Math.round(km * 0.621371)} mi` : `${Math.round(km)} km`;
}

function formatTempC(c, units) {
  if (c == null || typeof c !== "number") return null;
  return units === "imperial" ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

function formatPressureKpa(kpa, units) {
  if (kpa == null || typeof kpa !== "number") return null;
  return units === "imperial" ? `${(kpa * 0.145038).toFixed(1)} psi` : `${Math.round(kpa)} kPa`;
}

function formatPercent(v) {
  if (v == null || typeof v !== "number") return null;
  return `${Math.round(v)}%`;
}

// ===================== setup (interactive only — run the script, don't just add the widget) =====================

async function promptText(title, message, placeholder, defaultValue) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addTextField(placeholder, defaultValue || "");
  alert.addAction("Continue");
  alert.addCancelAction("Cancel");
  const idx = await alert.presentAlert();
  if (idx === -1) return null;
  return alert.textFieldValue(0).trim();
}

async function runSetup() {
  const region = (await promptText(
    "Region",
    "Region code — leave as usa unless you're outside North America. See REGIONS in this script for the full list (gbr, deu, fra, aus, lincoln_usa, ...).",
    "usa",
    loadRegion()
  ))?.toLowerCase();
  if (!region) return false;
  if (!REGIONS[region]) {
    const a = new Alert();
    a.title = "Unknown region";
    a.message = `"${region}" isn't in this script's REGIONS table.`;
    a.addAction("OK");
    await a.presentAlert();
    return false;
  }
  Keychain.set(KEYCHAIN_REGION_KEY, region);

  // Only force a fresh sign-in if not already signed in -- this same function also runs
  // automatically whenever no vehicle is selected yet (see the entry point), and
  // shouldn't force a redundant re-login just because vehicle picking hasn't happened.
  if (!loadToken()) {
    const a = new Alert();
    a.title = "Sign in with Ford";
    a.message =
      "A sign-in window will open. Enter your Ford credentials there — this script never sees them, " +
      "it only watches for the redirect once you're signed in.";
    a.addAction("Continue");
    a.addCancelAction("Cancel");
    if ((await a.presentAlert()) === -1) return false;

    await interactiveSignIn(REGIONS[region]);
  }

  // Vehicle(s) are picked from the account's garage rather than typed in -- no VIN typos,
  // and it's how multi-vehicle accounts add more than one.
  await runVehicleManager();

  if (!loadActiveVin()) {
    const none = new Alert();
    none.title = "No vehicle selected";
    none.message = 'Run this script again and choose "Manage vehicles" from the menu whenever you\'re ready to add one.';
    none.addAction("OK");
    await none.presentAlert();
    return true;
  }

  const done = new Alert();
  done.title = "Connected";
  done.message = "FordPass is connected. Add a Scriptable widget on your home screen and pick this script.";
  done.addAction("OK");
  await done.presentAlert();
  return true;
}

// Add/remove vehicles from the account's garage, and pick which one is "active" (used
// by the menu, and by any widget whose Parameter field doesn't name a specific vehicle
// — see the vin token handling in parseWidgetParameter). Each row's own tap opens an
// action Alert rather than mixing a row-level onSelect with an embedded button cell,
// since that combination isn't used (or confirmed safe) anywhere else in this script.
async function runVehicleManager() {
  const region = loadRegion();
  if (!loadToken()) {
    const a = new Alert();
    a.title = "Not signed in";
    a.message = "Sign in to FordPass first.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  const token = await getValidToken(REGIONS[region]);
  const garage = await fetchGarage(token, REGIONS[region]);

  const table = new UITable();
  table.showSeparators = true;

  function render() {
    table.removeAllRows();
    const stored = loadVehicles();
    const activeVin = loadActiveVin();

    const header = new UITableRow();
    header.isHeader = true;
    header.addText("Tap a vehicle to set it active or remove it.");
    table.addRow(header);

    for (const v of stored) {
      const row = new UITableRow();
      row.dismissOnSelect = false;
      row.addText((v.vin === activeVin ? "●  " : "○  ") + v.label, v.vin);
      row.onSelect = async () => {
        const a = new Alert();
        a.title = v.label;
        a.message = v.vin;
        a.addAction("Set as active");
        a.addAction("Remove");
        a.addCancelAction("Cancel");
        const choice = await a.presentAlert();
        if (choice === 0) {
          saveActiveVin(v.vin);
        } else if (choice === 1) {
          const updated = loadVehicles().filter((x) => x.vin !== v.vin);
          saveVehicles(updated);
          if (loadActiveVin() === v.vin && updated.length) saveActiveVin(updated[0].vin);
        } else {
          return;
        }
        render();
      };
      table.addRow(row);
    }

    if (garage) {
      const storedVins = new Set(stored.map((v) => v.vin));
      const addable = garage.filter((g) => !storedVins.has(g.vin));
      if (addable.length) {
        const addHeader = new UITableRow();
        addHeader.isHeader = true;
        addHeader.addText("Add from your account");
        table.addRow(addHeader);

        for (const gv of addable) {
          const label = vehicleLabelFromGarage(gv, gv.vin);
          const row = new UITableRow();
          row.dismissOnSelect = false;
          row.addText(`+  ${label}`, gv.vin);
          row.onSelect = () => {
            saveVehicles([...loadVehicles(), { vin: gv.vin, label }]);
            if (!loadActiveVin()) saveActiveVin(gv.vin);
            render();
          };
          table.addRow(row);
        }
      } else if (stored.length) {
        const allAdded = new UITableRow();
        allAdded.addText("All vehicles on your account are already added.");
        table.addRow(allAdded);
      }
    } else {
      const errRow = new UITableRow();
      errRow.addText("Couldn't load your account's vehicle list right now — check your connection and reopen this menu to try again.");
      table.addRow(errRow);
    }

    table.reload();
  }

  render();
  await table.present(false);
}

// ===================== interactive menu =====================

async function runMenu() {
  const vin = loadVin();
  const region = loadRegion();
  const regionCfg = REGIONS[region];
  const vehicles = loadVehicles();
  const activeLabel = vin ? (vehicles.find((v) => v.vin === vin) || {}).label || vin : null;

  const menu = new Alert();
  menu.title = "FordPass";
  menu.message = vin
    ? `${activeLabel}  ·  Region: ${region}${vehicles.length > 1 ? ` (${vehicles.length} vehicles)` : ""}`
    : "Not set up yet.";
  menu.addAction("Refresh status");
  menu.addAction("Lock");
  menu.addAction("Unlock");
  menu.addAction("Remote start");
  menu.addAction("Cancel remote start");
  menu.addAction("Request fresh report");
  menu.addAction("Configure widget (tiles & units)");
  menu.addAction("Manage vehicles");
  menu.addAction("Re-run setup / change region");
  menu.addAction("Export token (debug)");
  menu.addAction(`"Go Home" after widget commands: ${loadGoHomeEnabled() ? "On" : "Off"} (tap to toggle)`);
  menu.addCancelAction("Close");
  const choice = await menu.presentSheet();

  try {
    if (choice === 0) {
      const status = await getStatus(vin, regionCfg);
      QuickLook.present(status);
    } else if (choice >= 1 && choice <= 5) {
      const commandByChoice = {
        1: "lock",
        2: "unlock",
        3: "remoteStart",
        4: "cancelRemoteStart",
        5: "statusRefresh",
      };
      await sendCommand(vin, regionCfg, commandByChoice[choice]);
      const a = new Alert();
      a.title = "Sent";
      a.message = "Command sent — commands are fire-and-forget, check status again in a few seconds.";
      a.addAction("OK");
      await a.presentAlert();
    } else if (choice === 6) {
      await runTileConfigurator();
    } else if (choice === 7) {
      await runVehicleManager();
    } else if (choice === 8) {
      await runSetup();
    } else if (choice === 9) {
      const token = loadToken();
      const a = new Alert();
      if (!token) {
        a.title = "Not signed in";
        a.message = "No stored FordPass token yet.";
      } else {
        Pasteboard.copyString(JSON.stringify({ vin, region, vehicles, token }, null, 2));
        a.title = "Copied (debug)";
        a.message =
          "VIN + region + the full stored token are on your clipboard. This is a " +
          "credential-equivalent value, same as a password for the account — only " +
          "paste it somewhere you trust, and remove this debug menu item once you're " +
          "done testing (see runMenu() in the script).";
      }
      a.addAction("OK");
      await a.presentAlert();
    } else if (choice === 10) {
      const enabling = !loadGoHomeEnabled();
      const a = new Alert();
      if (enabling) {
        a.title = "Before you turn this on";
        a.message =
          `Have you created a Shortcut named exactly "${GO_HOME_SHORTCUT_NAME}" containing ` +
          'just Apple\'s "Go to Home Screen" action? If not, do that first in the Shortcuts ' +
          "app (see the README) — otherwise commands sent from the widget will open the " +
          "Shortcuts app to an error instead of going home.";
        a.addAction("Yes, I've created it — turn on");
        a.addCancelAction("Not yet — cancel");
        if ((await a.presentAlert()) === -1) return;
        saveGoHomeEnabled(true);
      } else {
        saveGoHomeEnabled(false);
        a.title = "Turned off";
        a.message = "Widget commands will no longer try to go home afterward.";
        a.addAction("OK");
        await a.presentAlert();
      }
    }
  } catch (err) {
    const a = new Alert();
    a.title = "Error";
    a.message = String(err);
    a.addAction("OK");
    await a.presentAlert();
  }
}

// ===================== widget =====================

function addTile(stack, label, value) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label);
  l.font = Font.systemFont(10);
  l.textColor = Color.gray();
  const v = col.addText(value == null ? "—" : String(value));
  v.font = Font.boldSystemFont(15);
}

// ===================== doors (verbose layout) =====================
//
// Ford labels front doors explicitly ("UNSPECIFIED_FRONT" + occupant role DRIVER/
// PASSENGER), so those map cleanly to driver/passenger sides via each region's
// driving side. Rear doors come back as plain "REAR_LEFT"/"REAR_RIGHT" with no
// reliable role data in what we've seen live, so those are labeled literally as
// left/right (vehicle-frame geometry) rather than guessed as driver/passenger.
const RHD_REGIONS = new Set(["gbr", "aus", "nzl", "zaf"]);

function metricArray(status, metricKey) {
  const node = metric(status, metricKey);
  return Array.isArray(node) ? node : [];
}

function findMetricValue(entries, matcher) {
  const e = entries.find(matcher);
  return e ? e.value : null;
}

function buildDoorGrid(status, region) {
  const locks = metricArray(status, "doorLockStatus");
  const opens = metricArray(status, "doorStatus");
  const driverIsLeft = !RHD_REGIONS.has(region);

  const front = (role) => ({
    label: role,
    open: findMetricValue(opens, (d) => d.vehicleDoor === "UNSPECIFIED_FRONT" && d.vehicleOccupantRole === role),
    lock: findMetricValue(locks, (d) => d.vehicleDoor === "UNSPECIFIED_FRONT" && d.vehicleOccupantRole === role),
  });
  const rear = (side) => ({
    label: `REAR ${side}`,
    open: findMetricValue(opens, (d) => d.vehicleDoor === `REAR_${side}`),
    lock: findMetricValue(locks, (d) => d.vehicleDoor === `REAR_${side}`),
  });

  return {
    front: { left: front(driverIsLeft ? "DRIVER" : "PASSENGER"), right: front(driverIsLeft ? "PASSENGER" : "DRIVER") },
    rear: { left: rear("LEFT"), right: rear("RIGHT") },
    tailgate: findMetricValue(opens, (d) => d.vehicleDoor === "TAILGATE"),
  };
}

function addDoorCell(stack, label, openVal, lockVal) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label);
  l.font = Font.systemFont(9);
  l.textColor = Color.gray();
  const o = col.addText(openVal || "—");
  o.font = Font.boldSystemFont(12);
  if (lockVal) {
    const k = col.addText(lockVal);
    k.font = Font.systemFont(9);
    k.textColor = Color.gray();
  }
}

function renderDoorsVerbose(widget, status, region) {
  const grid = buildDoorGrid(status, region);

  const title = widget.addText("DOORS");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(3);

  const row1 = widget.addStack();
  row1.layoutHorizontally();
  addDoorCell(row1, grid.front.left.label, grid.front.left.open, grid.front.left.lock);
  row1.addSpacer(16);
  addDoorCell(row1, grid.front.right.label, grid.front.right.open, grid.front.right.lock);

  widget.addSpacer(6);
  const row2 = widget.addStack();
  row2.layoutHorizontally();
  addDoorCell(row2, grid.rear.left.label, grid.rear.left.open, grid.rear.left.lock);
  row2.addSpacer(16);
  addDoorCell(row2, grid.rear.right.label, grid.rear.right.open, grid.rear.right.lock);

  if (grid.tailgate) {
    widget.addSpacer(6);
    const row3 = widget.addStack();
    addDoorCell(row3, "TAILGATE", grid.tailgate, null);
  }
}

// ===================== tire pressure =====================
//
// Confirmed live: tirePressure gives raw pressure in kPa, and tirePressureStatus gives
// Ford's own per-wheel verdict (e.g. "NORMAL", confirmed; other values unconfirmed but
// treated generically — anything that isn't "NORMAL" counts as a problem). So severity
// is Ford's own determination against the vehicle's actual placard spec, not a
// threshold this script invents.
const TIRE_WHEELS = [
  { key: "FRONT_LEFT", label: "FRONT LEFT" },
  { key: "FRONT_RIGHT", label: "FRONT RIGHT" },
  { key: "REAR_LEFT", label: "REAR LEFT" },
  { key: "REAR_RIGHT", label: "REAR RIGHT" },
];

function humanizeStatus(status) {
  return status
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function buildTireGrid(status, units) {
  const pressures = metricArray(status, "tirePressure");
  const statuses = metricArray(status, "tirePressureStatus");

  return TIRE_WHEELS.map((wheel) => {
    const pressureEntry = pressures.find((p) => p.vehicleWheel === wheel.key);
    const statusValue = findMetricValue(statuses, (s) => s.vehicleWheel === wheel.key);
    return {
      label: wheel.label,
      pressure: pressureEntry ? formatPressureKpa(pressureEntry.value, units) : null,
      status: statusValue,
      normal: statusValue == null || statusValue === "NORMAL",
    };
  });
}

function tireSummaryText(status) {
  const statuses = metricArray(status, "tirePressureStatus");
  if (statuses.length === 0) return null;
  const bad = statuses.filter((s) => s.value !== "NORMAL").map((s) => s.value);
  if (bad.length === 0) return "OK";
  const distinct = [...new Set(bad)];
  return distinct.length === 1 ? `${bad.length} ${humanizeStatus(distinct[0])}` : `${bad.length} issues`;
}

function addTireCell(stack, tire) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(tire.label);
  l.font = Font.systemFont(9);
  l.textColor = Color.gray();
  const p = col.addText(tire.pressure || "—");
  p.font = Font.boldSystemFont(12);
  if (!tire.normal) p.textColor = Color.orange();
  if (tire.status && !tire.normal) {
    const s = col.addText(humanizeStatus(tire.status));
    s.font = Font.systemFont(9);
    s.textColor = Color.orange();
  }
}

function renderTiresVerbose(widget, status, units) {
  const [fl, fr, rl, rr] = buildTireGrid(status, units);

  const title = widget.addText("TIRE PRESSURE");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(3);

  const row1 = widget.addStack();
  row1.layoutHorizontally();
  addTireCell(row1, fl);
  row1.addSpacer(16);
  addTireCell(row1, fr);

  widget.addSpacer(6);
  const row2 = widget.addStack();
  row2.layoutHorizontally();
  addTireCell(row2, rl);
  row2.addSpacer(16);
  addTireCell(row2, rr);
}

// ===================== window position =====================
//
// Confirmed live: raw key is "windowStatus" (not "windowPosition" — that's just the
// ha-fordpass-assigned display key), and each entry's value is a doubleRange
// (lowerBound/upperBound), not a status string — both 0.0 means closed, anything else
// means open (exact magnitude/meaning beyond that isn't exposed, so like ha-fordpass
// this treats it as binary open/closed rather than guessing a percentage). This
// vehicle only reports front windows (UNSPECIFIED_FRONT + driver/passenger role, same
// shape as front doors) — no rear entries at all, so the rear grid cells will show "—"
// here; REAR_LEFT/REAR_RIGHT is a best guess at how a vehicle that does report rear
// windows would name them, mirroring doors, unconfirmed.
function windowIsOpen(value) {
  if (!value || !value.doubleRange) return null;
  const { lowerBound, upperBound } = value.doubleRange;
  return (lowerBound || 0) !== 0 || (upperBound || 0) !== 0;
}

function windowLabel(value) {
  const open = windowIsOpen(value);
  return open == null ? null : open ? "OPEN" : "CLOSED";
}

function buildWindowGrid(status, region) {
  const windows = metricArray(status, "windowStatus");
  const driverIsLeft = !RHD_REGIONS.has(region);

  const front = (role) => {
    const entry = windows.find((w) => w.vehicleWindow === "UNSPECIFIED_FRONT" && w.vehicleOccupantRole === role);
    return { label: role, value: entry ? windowLabel(entry.value) : null };
  };
  const rear = (side) => {
    const entry = windows.find((w) => w.vehicleWindow === `REAR_${side}`);
    return { label: `REAR ${side}`, value: entry ? windowLabel(entry.value) : null };
  };

  return {
    front: { left: front(driverIsLeft ? "DRIVER" : "PASSENGER"), right: front(driverIsLeft ? "PASSENGER" : "DRIVER") },
    rear: { left: rear("LEFT"), right: rear("RIGHT") },
  };
}

function windowSummaryText(status) {
  const windows = metricArray(status, "windowStatus");
  if (windows.length === 0) return null;
  const openCount = windows.filter((w) => windowIsOpen(w.value)).length;
  if (openCount === 0) return "CLOSED";
  return openCount === windows.length ? "OPEN" : `${openCount} OPEN`;
}

function addWindowCell(stack, label, value) {
  const col = stack.addStack();
  col.layoutVertically();
  const l = col.addText(label);
  l.font = Font.systemFont(9);
  l.textColor = Color.gray();
  const v = col.addText(value || "—");
  v.font = Font.boldSystemFont(12);
  if (value === "OPEN") v.textColor = Color.orange();
}

function renderWindowsVerbose(widget, status, region) {
  const grid = buildWindowGrid(status, region);

  const title = widget.addText("WINDOWS");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(3);

  const row1 = widget.addStack();
  row1.layoutHorizontally();
  addWindowCell(row1, grid.front.left.label, grid.front.left.value);
  row1.addSpacer(16);
  addWindowCell(row1, grid.front.right.label, grid.front.right.value);

  widget.addSpacer(6);
  const row2 = widget.addStack();
  row2.layoutHorizontally();
  addWindowCell(row2, grid.rear.left.label, grid.rear.left.value);
  row2.addSpacer(16);
  addWindowCell(row2, grid.rear.right.label, grid.rear.right.value);
}

// ===================== vehicle health alerts =====================
//
// Confirmed live: "metrics.indicators" (not a top-level "messages" field, which
// ha-fordpass also references but came back null/absent for this vehicle via this
// endpoint) is a dict of ~45 named warning lights (checkEngineLight-style:
// lowEngineOilPressure, tirePressureMonitorSystemWarning, airbagWarning, etc.), each
// with a plain boolean .value. All false on this vehicle right now, i.e. no active
// alerts — matches the old official-API dashboard's "No active alerts" case exactly.
function activeHealthIndicators(status) {
  const indicators = metric(status, "indicators");
  if (!indicators || typeof indicators !== "object") return null;
  return Object.keys(indicators)
    .filter((key) => indicators[key] && indicators[key].value === true)
    .map((key) => key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()));
}

function healthAlertsSummaryText(status) {
  const active = activeHealthIndicators(status);
  if (active == null) return null;
  return active.length === 0 ? "OK" : `${active.length} ALERT${active.length > 1 ? "S" : ""}`;
}

function renderHealthAlertsVerbose(widget, status) {
  const active = activeHealthIndicators(status);

  const title = widget.addText("VEHICLE HEALTH");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(3);

  if (!active || active.length === 0) {
    const t = widget.addText("No active alerts");
    t.font = Font.systemFont(11);
    t.textColor = Color.gray();
    return;
  }

  for (const label of active) {
    const t = widget.addText(label);
    t.font = Font.boldSystemFont(11);
    t.textColor = Color.orange();
  }
}

// ===================== location =====================
//
// Confirmed live: "metrics.position.value.location" is {lat, lon, alt}, plus a bonus
// "metrics.compassDirection.value" (e.g. "SOUTHWEST"). WidgetText.url (tap to open) is
// only supported on medium/large widgets per Scriptable's docs — a small widget's only
// tap target is the whole widget itself, which already opens this script's menu, so
// this just renders as plain (non-tappable) text there instead of fighting that.
function mapsUrl(provider, lat, lon) {
  return provider === "google"
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://maps.apple.com/?ll=${lat},${lon}&q=Vehicle`;
}

function renderLocation(widget, status, mapProvider) {
  const loc = metric(status, "position.value.location");
  if (!loc || loc.lat == null || loc.lon == null) return;

  const title = widget.addText("LOCATION");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(3);

  const direction = metricValue(status, "compassDirection");
  const coords = `${loc.lat.toFixed(5)}, ${loc.lon.toFixed(5)}`;
  const text = widget.addText(direction ? `${coords} (${direction.toLowerCase()})` : coords);
  text.font = Font.boldSystemFont(12);
  if (config.widgetFamily !== "small") {
    text.url = mapsUrl(mapProvider, loc.lat, loc.lon);
    text.textColor = Color.blue();
  }
}

// ===================== write commands (widget buttons) =====================
//
// Same WidgetStack.url mechanism as location/the (reverted) tap-to-detail — tapping a
// button opens scriptable:///run/<script>?cmd=<key>, which launches the script outside
// the widget. Unlike tap-to-detail, a confirm/cancel Alert runs before the command
// actually sends (see runCommandFromWidget), so a stray tap can only open a dialog the
// user dismisses, not fire a real command. Medium/large widgets only, same reason as
// everywhere else this session — small widgets' only tap target is the whole widget.
// vin is embedded in the URL (not just cmd) so the command acts on whichever vehicle
// *this* widget is showing, even if it's not the account's active one -- the relaunched
// script has no other way to know which widget's button was tapped.
function addCommandButton(row, cmdKey, vin) {
  const def = WRITE_COMMANDS[cmdKey];
  const btn = row.addStack();
  btn.layoutVertically();
  btn.centerAlignContent();
  btn.setPadding(6, 10, 6, 10);
  btn.cornerRadius = 8;
  btn.backgroundColor = Color.dynamic(new Color("#eef1f6"), new Color("#242831"));
  if (config.widgetFamily !== "small") {
    btn.url = `scriptable:///run/${encodeURIComponent(Script.name())}?cmd=${cmdKey}&vin=${encodeURIComponent(vin)}`;
  }
  const t = btn.addText(def.label.toUpperCase());
  t.font = Font.boldSystemFont(11);
}

function renderCommands(widget, vin) {
  const title = widget.addText("COMMANDS");
  title.font = Font.systemFont(10);
  title.textColor = Color.gray();
  widget.addSpacer(4);

  const keys = Object.keys(WRITE_COMMANDS);
  for (let i = 0; i < keys.length; i += 3) {
    if (i > 0) widget.addSpacer(6);
    const row = widget.addStack();
    row.layoutHorizontally();
    const rowKeys = keys.slice(i, i + 3);
    rowKeys.forEach((key, idx) => {
      addCommandButton(row, key, vin);
      if (idx < rowKeys.length - 1) row.addSpacer(8);
    });
  }

  if (config.widgetFamily === "small") {
    const note = widget.addText("Open the app to use commands");
    note.font = Font.systemFont(8);
    note.textColor = Color.gray();
  }
}

// Name of a Shortcut (created by you in the Shortcuts app) containing nothing but
// Apple's own "Go to Home Screen" action — see the README for setup. Triggering it via
// URL is the only way to land back on the home screen after a command sends; Apple
// deliberately doesn't let any third-party app (Scriptable included) do that itself.
const GO_HOME_SHORTCUT_NAME = "Go Home";

// vinOverride comes from the tapped button's own URL (addCommandButton embeds it) so
// the command acts on whichever vehicle that specific widget was showing, not whatever
// happens to be the account's current "active" vehicle.
async function runCommandFromWidget(cmdKey, vinOverride) {
  const def = WRITE_COMMANDS[cmdKey];
  if (!def) return;

  const vin = vinOverride || loadVin();
  const region = loadRegion();
  if (!vin || !loadToken()) return;

  const confirm = new Alert();
  confirm.title = "Confirm";
  confirm.message = def.confirm;
  confirm.addAction(def.label);
  confirm.addCancelAction("Cancel");
  if ((await confirm.presentAlert()) === -1) return;

  try {
    await sendCommand(vin, REGIONS[region], def.apiType);

    // cancelRemoteStart specifically: live-tested twice against a real vehicle, and both
    // times Ford's own command tracking got stuck at "queued", never confirming success
    // — unlike every other command here, which do reliably confirm. Worth a heads-up
    // instead of silently assuming it worked, since the truck may just keep running
    // until the remote start times out on its own regardless of this tap.
    if (cmdKey === "cancelRemoteStart") {
      const a = new Alert();
      a.title = "Sent";
      a.message =
        "The cancel command was sent, but there's no confirmation it reached the vehicle " +
        "— it may not actually stop until the remote start times out on its own.";
      a.addAction("OK");
      await a.presentAlert();
    }

    // Skip going home otherwise (no popup for the other commands either) unless the
    // "Go Home" shortcut has been confirmed set up — see loadGoHomeEnabled().
    if (loadGoHomeEnabled()) {
      Safari.open(`shortcuts://run-shortcut?name=${encodeURIComponent(GO_HOME_SHORTCUT_NAME)}`);
    }
  } catch (err) {
    const a = new Alert();
    a.title = "Error";
    a.message = String(err);
    a.addAction("OK");
    await a.presentAlert();
  }
}

// ===================== vehicle garage data (image) =====================
//
// Ford's FordPass-private garage endpoint returns a per-vehicle object including a
// ready-made image URL, and needs no new auth — just our existing access_token, via a
// custom "auth-token" header (not "Authorization: Bearer") alongside Application-Id.
// Ported from ha-fordpass's current approach, not tonesto7/fordpass-scriptable's (a
// thumbnail URL built from VIN+year+country, against an endpoint that's now dead —
// see commit history). Confirmed working live for the image this session.
// All vehicles on the account, cached together (one fetch serves every vehicle lookup,
// not one cache file per VIN). Cache is intentionally short-lived (not re-checked within
// a single script run beyond this) since it's keyed off FileManager's cache directory,
// which "the OS may delete at any time" per Scriptable's docs — fine for this, since a
// stale vehicle list just means re-fetching, not wrong data shown anywhere lasting.
async function fetchGarage(token, regionCfg) {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), "fordconnect_garage_all.json");
  if (fm.fileExists(cachePath)) {
    try {
      return JSON.parse(fm.readString(cachePath));
    } catch (e) {
      // fall through and re-fetch
    }
  }

  const garageReq = new Request(`${FORD_VEHICLE_API}/fpcpl-user-garage-service/v1/user/garage`);
  garageReq.headers = {
    ...API_HEADERS,
    "auth-token": token.access_token,
    "Application-Id": regionCfg.app_id,
    countryCode: regionCfg.countrycode,
    locale: regionCfg.locale,
  };
  let garage;
  try {
    garage = await garageReq.loadJSON();
  } catch (e) {
    return null;
  }
  if (!Array.isArray(garage)) return null;

  fm.writeString(cachePath, JSON.stringify(garage));
  return garage;
}

async function fetchGarageVehicle(token, vin, regionCfg) {
  const garage = await fetchGarage(token, regionCfg);
  return (garage && garage.find((v) => v.vin === vin)) || null;
}

// "2021 Ford F-150" style label from the garage profile, falling back to a locally
// stored label (e.g. from before the garage was reachable), then the bare VIN.
function vehicleLabelFromGarage(garageVehicle, vin) {
  if (garageVehicle && garageVehicle.profile) {
    const p = garageVehicle.profile;
    const parts = [p.year, p.make, p.model].filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const stored = loadVehicles().find((v) => v.vin === vin);
  return (stored && stored.label) || vin;
}

async function fetchVehicleImage(token, vin, regionCfg) {
  const fm = FileManager.local();
  const cachePath = fm.joinPath(fm.cacheDirectory(), `fordconnect_vehicle_${vin}.png`);
  if (fm.fileExists(cachePath)) {
    try {
      return fm.readImage(cachePath);
    } catch (e) {
      // fall through and re-fetch
    }
  }

  const vehicle = await fetchGarageVehicle(token, vin, regionCfg);
  const imageUrl = vehicle && vehicle.profile && vehicle.profile.vehicleImage;
  if (!imageUrl) return null;

  const imgReq = new Request(imageUrl);
  imgReq.headers = { ...API_HEADERS, "auth-token": token.access_token, "Application-Id": regionCfg.app_id };
  imgReq.timeoutInterval = 15;
  try {
    const img = await imgReq.loadImage();
    if (imgReq.response.statusCode === 200) {
      fm.writeImage(cachePath, img);
      return img;
    }
  } catch (e) {
    // No bundled placeholder — the image block is just skipped on failure.
  }
  return null;
}

// ListWidget has a fixed pixel canvas per family and doesn't scroll — content past the
// edge is silently clipped, not an error. A fixed image size was by far the biggest
// contributor to that (90pt tall eats most of a small/medium widget's ~155pt height),
// so it's sized down per family here. These are the standard iPhone widget point
// sizes; real sizes vary slightly by device but this is close enough to budget by.
const IMAGE_SIZE_BY_FAMILY = {
  small: new Size(120, 40),
  medium: new Size(260, 55),
  large: new Size(290, 90),
};

async function renderVehicleImage(widget, vin, regionCfg) {
  const token = await getValidToken(regionCfg);
  const img = await fetchVehicleImage(token, vin, regionCfg);
  if (!img) return;
  const wi = widget.addImage(img);
  wi.imageSize = IMAGE_SIZE_BY_FAMILY[config.widgetFamily] || IMAGE_SIZE_BY_FAMILY.medium;
  wi.applyFittingContentMode();
  wi.centerAlignImage();
  widget.addSpacer(6);
}

// Every write command Ford's API supports with no extra properties payload (confirmed
// against ha-fordpass's KNOWN_COMMANDS). Shared by the in-script menu and the optional
// "commands" widget block below, so both stay in sync with one definition.
const WRITE_COMMANDS = {
  lock: { label: "Lock", apiType: "lock", confirm: "Lock the truck?" },
  unlock: { label: "Unlock", apiType: "unlock", confirm: "Unlock the truck?" },
  remoteStart: { label: "Start", apiType: "remoteStart", confirm: "Start the engine remotely?" },
  cancelRemoteStart: { label: "Stop", apiType: "cancelRemoteStart", confirm: "Cancel remote start?" },
  statusRefresh: { label: "Refresh", apiType: "statusRefresh", confirm: "Request a fresh status report?" },
};

// Each tile is keyed by the token a widget's Parameter field uses to request it (see
// parseWidgetParameter). label/value may depend on units and whether the vehicle is
// an EV (fuelLevel vs. xevBatteryStateOfCharge, oil life vs. 12V battery).
const TILE_DEFS = {
  doors: {
    label: () => "DOORS",
    value: (status) => metricValue(status, "doorLockStatus", (d) => d.vehicleDoor === "ALL_DOORS"),
  },
  fuel: {
    label: (isEv) => (isEv ? "CHARGE" : "FUEL"),
    value: (status) => formatPercent(metricValue(status, "fuelLevel") ?? metricValue(status, "xevBatteryStateOfCharge")),
  },
  range: {
    label: () => "RANGE",
    value: (status, units) =>
      formatDistanceKm(metricValue(status, "fuelRange") ?? metricValue(status, "xevBatteryRange"), units),
  },
  odometer: {
    label: () => "ODOMETER",
    value: (status, units) => formatDistanceKm(metricValue(status, "odometer"), units),
  },
  temp: {
    label: () => "OUTSIDE",
    value: (status, units) => formatTempC(metricValue(status, "outsideTemperature"), units),
  },
  oil: {
    label: () => "OIL LIFE",
    value: (status) => formatPercent(metricValue(status, "oilLifeRemaining")),
  },
  battery12v: {
    label: () => "12V BATT",
    value: (status) => formatPercent(metricValue(status, "batteryStateOfCharge")),
  },
  tires: {
    label: () => "TIRES",
    value: (status) => tireSummaryText(status),
  },
  windows: {
    label: () => "WINDOWS",
    value: (status) => windowSummaryText(status),
  },
  alarm: {
    label: () => "ALARM",
    value: (status) => metricValue(status, "alarmStatus"),
  },
  panicAlarm: {
    label: () => "PANIC ALARM",
    // Ford's own raw value for "no panic event" is literally the string "UNDEFINED" —
    // real data, not a bug, but not worth showing verbatim; treat it like no-data.
    value: (status) => {
      const v = metricValue(status, "panicAlarmStatus");
      return v === "UNDEFINED" ? null : v;
    },
  },
  ignition: {
    label: () => "IGNITION",
    value: (status) => metricValue(status, "ignitionStatus"),
  },
  health: {
    label: () => "HEALTH",
    value: (status) => healthAlertsSummaryText(status),
  },
};

const DEFAULT_TILES_SMALL = ["doors", "fuel"];
const DEFAULT_TILES_FULL = ["doors", "fuel", "range", "odometer", "temp", "oil", "battery12v"];
const TILES_PER_ROW = 3;

// Full-width elements — unlike TILE_DEFS entries, these render themselves (not as a
// 1/3-width grid cell), so they get their own row whenever they appear in the
// selected item list. "doors" (collapsed, the single-line version) stays in
// TILE_DEFS; "doorsVerbose" is the per-door table alternative.
const BLOCK_DEFS = {
  image: {
    label: () => "VEHICLE IMAGE",
    render: async (widget, status, vin, region) => renderVehicleImage(widget, vin, REGIONS[region]),
  },
  doorsVerbose: {
    label: () => "DOORS (VERBOSE)",
    render: async (widget, status, vin, region) => renderDoorsVerbose(widget, status, region),
  },
  tiresVerbose: {
    label: () => "TIRES (VERBOSE)",
    render: async (widget, status, vin, region, units) => renderTiresVerbose(widget, status, units),
  },
  windowsVerbose: {
    label: () => "WINDOWS (VERBOSE)",
    render: async (widget, status, vin, region) => renderWindowsVerbose(widget, status, region),
  },
  healthVerbose: {
    label: () => "VEHICLE HEALTH (VERBOSE)",
    render: async (widget, status) => renderHealthAlertsVerbose(widget, status),
  },
  location: {
    label: () => "LOCATION",
    render: async (widget, status, vin, region, units, isEv, mapProvider) => renderLocation(widget, status, mapProvider),
  },
  commands: {
    label: () => "COMMANDS (LOCK/UNLOCK/START/STOP)",
    render: async (widget, status, vin) => renderCommands(widget, vin),
  },
};

// A widget's own "Parameter" field (long-press widget -> Edit Widget) is a single text
// field, so it doubles as a tiny config language: a comma-separated list mixing item
// names (see TILE_DEFS/BLOCK_DEFS) with "imperial"/"metric". Order controls display
// order. Unrecognized tokens are ignored rather than erroring, so a typo just falls
// back to defaults instead of breaking the widget. Example: "doors,fuel,odometer,metric".
// Case-insensitive lookup from a lowercased token back to the real (possibly camelCase,
// e.g. "doorsVerbose") key in TILE_DEFS/BLOCK_DEFS — matching tokens were lowercased
// below (needed for "imperial"/"metric"/"notitle"), which silently dropped any item
// whose own key wasn't already all-lowercase, with no error, just a missing item.
const ITEM_KEYS_BY_LOWER = Object.fromEntries(
  [...Object.keys(TILE_DEFS), ...Object.keys(BLOCK_DEFS)].map((k) => [k.toLowerCase(), k])
);

function parseWidgetParameter(paramStr) {
  const tokens = String(paramStr || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let units = null;
  let titleMode = null;
  let mapProvider = null;
  let vin = null;
  const items = [];
  const vehicleVinsByLower = Object.fromEntries(loadVehicles().map((v) => [v.vin.toLowerCase(), v.vin]));
  for (const t of tokens) {
    if (t === "imperial" || t === "metric") units = t;
    else if (t === "notitle") titleMode = "hidden";
    else if (t === "applemaps") mapProvider = "apple";
    else if (t === "googlemaps") mapProvider = "google";
    else if (vehicleVinsByLower[t]) vin = vehicleVinsByLower[t];
    else if (ITEM_KEYS_BY_LOWER[t]) items.push(ITEM_KEYS_BY_LOWER[t]);
  }
  return { units, titleMode, mapProvider, vin, items: items.length ? items : null };
}

// Interactive picker (run the script, not from a widget) so the Parameter mini-language
// doesn't have to be typed from memory. Lets you either save a default tile set used by
// any widget with a blank Parameter field, or copy a ready-made Parameter string to
// paste into one specific widget that should differ from the default.
async function runTileConfigurator() {
  const orderedItemKeys = [...Object.keys(TILE_DEFS), ...Object.keys(BLOCK_DEFS)];
  const selected = new Set(loadDefaultTiles() || DEFAULT_TILES_FULL);
  let units = loadUnits();
  let titleMode = loadTitleMode();
  let mapProvider = loadMapProvider();
  let selectedVehicleVin = loadActiveVin();
  const vehicles = loadVehicles();
  const TITLE_MODE_LABELS = { fordpass: '"FordPass"', hidden: "hidden" };
  const TITLE_MODE_CYCLE = ["fordpass", "hidden"];
  const MAP_PROVIDER_LABELS = { apple: "Apple Maps", google: "Google Maps" };
  const MAP_PROVIDER_CYCLE = ["apple", "google"];

  const table = new UITable();
  table.showSeparators = true;

  function selectedInOrder() {
    return orderedItemKeys.filter((k) => selected.has(k));
  }

  function render() {
    table.removeAllRows();

    const header = new UITableRow();
    header.isHeader = true;
    header.addText("Tap a row to toggle it, then save or copy below.");
    table.addRow(header);

    const unitsRow = new UITableRow();
    unitsRow.dismissOnSelect = false;
    unitsRow.addText("Units", units === "imperial" ? "imperial (mi / °F / psi)" : "metric (km / °C / kPa)");
    unitsRow.onSelect = () => {
      units = units === "imperial" ? "metric" : "imperial";
      render();
    };
    table.addRow(unitsRow);

    const titleRow = new UITableRow();
    titleRow.dismissOnSelect = false;
    titleRow.addText("Title", TITLE_MODE_LABELS[titleMode]);
    titleRow.onSelect = () => {
      titleMode = TITLE_MODE_CYCLE[(TITLE_MODE_CYCLE.indexOf(titleMode) + 1) % TITLE_MODE_CYCLE.length];
      render();
    };
    table.addRow(titleRow);

    const mapRow = new UITableRow();
    mapRow.dismissOnSelect = false;
    mapRow.addText("Map", MAP_PROVIDER_LABELS[mapProvider]);
    mapRow.onSelect = () => {
      mapProvider = MAP_PROVIDER_CYCLE[(MAP_PROVIDER_CYCLE.indexOf(mapProvider) + 1) % MAP_PROVIDER_CYCLE.length];
      render();
    };
    table.addRow(mapRow);

    if (vehicles.length > 1) {
      const vehicleRow = new UITableRow();
      vehicleRow.dismissOnSelect = false;
      const current = vehicles.find((v) => v.vin === selectedVehicleVin);
      vehicleRow.addText("Vehicle (for Copy below)", current ? current.label : "Account default");
      vehicleRow.onSelect = () => {
        const idx = vehicles.findIndex((v) => v.vin === selectedVehicleVin);
        selectedVehicleVin = vehicles[(idx + 1) % vehicles.length].vin;
        render();
      };
      table.addRow(vehicleRow);
    }

    for (const key of orderedItemKeys) {
      const row = new UITableRow();
      row.dismissOnSelect = false;
      const def = TILE_DEFS[key] || BLOCK_DEFS[key];
      const label = def.label(false);
      row.addText(selected.has(key) ? `✓  ${label}` : `　  ${label}`);
      row.onSelect = () => {
        if (selected.has(key)) selected.delete(key);
        else selected.add(key);
        render();
      };
      table.addRow(row);
    }

    const saveRow = new UITableRow();
    const saveBtn = saveRow.addButton("Save as default for blank-parameter widgets");
    saveBtn.onTap = async () => {
      saveDefaultTiles(selectedInOrder());
      saveUnits(units);
      saveTitleMode(titleMode);
      saveMapProvider(mapProvider);
      const a = new Alert();
      a.title = "Saved";
      a.message = "Widgets with a blank Parameter field will use this set next refresh.";
      a.addAction("OK");
      await a.presentAlert();
    };
    table.addRow(saveRow);

    const copyRow = new UITableRow();
    const copyBtn = copyRow.addButton("Copy as Parameter text for one specific widget");
    copyBtn.onTap = async () => {
      const titleToken = titleMode === "hidden" ? "notitle" : null;
      const mapToken = mapProvider === "google" ? "googlemaps" : null;
      const vehicleToken = vehicles.length > 1 && selectedVehicleVin !== loadActiveVin() ? selectedVehicleVin : null;
      const paramStr = [...selectedInOrder(), units, titleToken, mapToken, vehicleToken].filter(Boolean).join(",");
      Pasteboard.copyString(paramStr);
      const a = new Alert();
      a.title = "Copied";
      a.message = `"${paramStr}" is on your clipboard — paste it into that widget's Parameter field (long-press the widget → Edit Widget).`;
      a.addAction("OK");
      await a.presentAlert();
    };
    table.addRow(copyRow);
    table.reload(); // rows were rebuilt above — without this the presented table never visually updates
  }

  render();
  await table.present(false);
}

async function buildWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1f26"));

  const paramCfg = parseWidgetParameter(args.widgetParameter);
  const vin = paramCfg.vin || loadVin();
  const region = loadRegion();

  if (!vin || !loadToken()) {
    const t = widget.addText("Open this script in Scriptable to finish setup.");
    t.font = Font.systemFont(13);
    return widget;
  }

  const units = paramCfg.units || loadUnits();
  const titleMode = paramCfg.titleMode || loadTitleMode();
  const mapProvider = paramCfg.mapProvider || loadMapProvider();
  const compact = config.widgetFamily === "small";
  const itemKeys = paramCfg.items || loadDefaultTiles() || (compact ? DEFAULT_TILES_SMALL : DEFAULT_TILES_FULL);

  try {
    const status = await getStatus(vin, REGIONS[region]);

    if (titleMode !== "hidden") {
      const title = widget.addText("FordPass");
      title.font = Font.boldSystemFont(13);
      widget.addSpacer(8);
    }

    const isEv = metric(status, "xevBatteryStateOfCharge") != null;

    // Tiles (TILE_DEFS) accumulate into rows of up to 3; a block (BLOCK_DEFS) is
    // full-width, so it flushes whatever tiles were pending first, then renders itself.
    let pendingTiles = [];
    let needsSpacer = false;

    const flushTiles = () => {
      for (let i = 0; i < pendingTiles.length; i += TILES_PER_ROW) {
        if (needsSpacer) widget.addSpacer(10);
        needsSpacer = true;
        const rowKeys = pendingTiles.slice(i, i + TILES_PER_ROW);
        const row = widget.addStack();
        row.layoutHorizontally();
        rowKeys.forEach((key, idx) => {
          const def = TILE_DEFS[key];
          addTile(row, def.label(isEv), def.value(status, units, isEv));
          if (idx < rowKeys.length - 1) row.addSpacer(16);
        });
      }
      pendingTiles = [];
    };

    for (const key of itemKeys) {
      if (TILE_DEFS[key]) {
        pendingTiles.push(key);
      } else if (BLOCK_DEFS[key]) {
        flushTiles();
        if (needsSpacer) widget.addSpacer(10);
        needsSpacer = true;
        await BLOCK_DEFS[key].render(widget, status, vin, region, units, isEv, mapProvider);
      }
    }
    flushTiles();

    widget.addSpacer(8);
    const updatedAt = metric(status, "doorLockStatus.0.updateTime") || metric(status, "odometer.updateTime");
    if (updatedAt) {
      const u = widget.addText(`Updated ${new Date(updatedAt).toLocaleString()}`);
      u.font = Font.systemFont(9);
      u.textColor = Color.gray();
    }
  } catch (err) {
    const t = widget.addText(`Error: ${String(err)}`);
    t.font = Font.systemFont(11);
    t.textColor = Color.red();
  }

  return widget;
}

// ===================== entry point =====================

if (config.runsInWidget) {
  const widget = await buildWidget();
  Script.setWidget(widget);
  Script.complete();
} else if (args.queryParameters && args.queryParameters.cmd) {
  await runCommandFromWidget(args.queryParameters.cmd, args.queryParameters.vin);
} else if (!loadVin() || !loadToken()) {
  await runSetup();
} else {
  await runMenu();
}
