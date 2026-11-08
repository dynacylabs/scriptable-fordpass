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
const KEYCHAIN_VIN_KEY = "fordconnect_vin";
const KEYCHAIN_REGION_KEY = "fordconnect_region";
const KEYCHAIN_UNITS_KEY = "fordconnect_units";
const KEYCHAIN_DEFAULT_TILES_KEY = "fordconnect_default_tiles";
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

function loadVin() {
  return Keychain.contains(KEYCHAIN_VIN_KEY) ? Keychain.get(KEYCHAIN_VIN_KEY) : null;
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

  const vin = await promptText("Vehicle VIN", "It's on your registration or door-jamb sticker.", "1FTxxxxxxxxxxxxxx", loadVin());
  if (!vin) return false;
  Keychain.set(KEYCHAIN_VIN_KEY, vin);

  const a = new Alert();
  a.title = "Sign in with Ford";
  a.message =
    "A sign-in window will open. Enter your Ford credentials there — this script never sees them, " +
    "it only watches for the redirect once you're signed in.";
  a.addAction("Continue");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;

  await interactiveSignIn(REGIONS[region]);

  const done = new Alert();
  done.title = "Connected";
  done.message = "FordPass is connected. Add a Scriptable widget on your home screen and pick this script.";
  done.addAction("OK");
  await done.presentAlert();
  return true;
}

// ===================== interactive menu =====================

async function runMenu() {
  const vin = loadVin();
  const region = loadRegion();
  const regionCfg = REGIONS[region];

  const menu = new Alert();
  menu.title = "FordPass";
  menu.message = vin ? `VIN: ${vin}  ·  Region: ${region}` : "Not set up yet.";
  menu.addAction("Refresh status");
  menu.addAction("Lock");
  menu.addAction("Unlock");
  menu.addAction("Remote start");
  menu.addAction("Cancel remote start");
  menu.addAction("Request fresh report");
  menu.addAction("Configure widget (tiles & units)");
  menu.addAction("Re-run setup / change VIN or region");
  menu.addAction("Export token (debug)");
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
      await runSetup();
    } else if (choice === 8) {
      const token = loadToken();
      const a = new Alert();
      if (!token) {
        a.title = "Not signed in";
        a.message = "No stored FordPass token yet.";
      } else {
        Pasteboard.copyString(JSON.stringify({ vin, region, token }, null, 2));
        a.title = "Copied (debug)";
        a.message =
          "VIN + region + the full stored token are on your clipboard. This is a " +
          "credential-equivalent value, same as a password for the account — only " +
          "paste it somewhere you trust, and remove this debug menu item once you're " +
          "done testing (see runMenu() in the script).";
      }
      a.addAction("OK");
      await a.presentAlert();
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

function doorEntries(status, metricKey) {
  const node = metric(status, metricKey);
  return Array.isArray(node) ? node : [];
}

function findDoorValue(entries, matcher) {
  const e = entries.find(matcher);
  return e ? e.value : null;
}

function buildDoorGrid(status, region) {
  const locks = doorEntries(status, "doorLockStatus");
  const opens = doorEntries(status, "doorStatus");
  const driverIsLeft = !RHD_REGIONS.has(region);

  const front = (role) => ({
    label: role,
    open: findDoorValue(opens, (d) => d.vehicleDoor === "UNSPECIFIED_FRONT" && d.vehicleOccupantRole === role),
    lock: findDoorValue(locks, (d) => d.vehicleDoor === "UNSPECIFIED_FRONT" && d.vehicleOccupantRole === role),
  });
  const rear = (side) => ({
    label: `REAR ${side}`,
    open: findDoorValue(opens, (d) => d.vehicleDoor === `REAR_${side}`),
    lock: findDoorValue(locks, (d) => d.vehicleDoor === `REAR_${side}`),
  });

  return {
    front: { left: front(driverIsLeft ? "DRIVER" : "PASSENGER"), right: front(driverIsLeft ? "PASSENGER" : "DRIVER") },
    rear: { left: rear("LEFT"), right: rear("RIGHT") },
    tailgate: findDoorValue(opens, (d) => d.vehicleDoor === "TAILGATE"),
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

// ===================== vehicle image =====================
//
// Unlike tonesto7/fordpass-scriptable's approach (a thumbnail URL built from
// VIN+year+country, against an endpoint that's now dead — see commit history),
// this ports ha-fordpass's current approach instead: Ford's own FordPass-private
// garage endpoint returns a ready-made image URL per vehicle, and fetching it needs
// no new auth — just our existing access_token, via a custom "auth-token" header
// (not "Authorization: Bearer") alongside Application-Id. Not yet verified against a
// live account this session (no cached token) — worth confirming once reconnected.
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

  const garageHeaders = {
    ...API_HEADERS,
    "auth-token": token.access_token,
    "Application-Id": regionCfg.app_id,
    countryCode: regionCfg.countrycode,
    locale: regionCfg.locale,
  };
  const garageReq = new Request(`${FORD_VEHICLE_API}/fpcpl-user-garage-service/v1/user/garage`);
  garageReq.headers = garageHeaders;
  let garage;
  try {
    garage = await garageReq.loadJSON();
  } catch (e) {
    return null;
  }
  if (!Array.isArray(garage)) return null;
  const vehicle = garage.find((v) => v.vin === vin);
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
    value: (status, units) => formatTempC(metricValue(status, "outsideTemp"), units),
  },
  oil: {
    label: () => "OIL LIFE",
    value: (status) => formatPercent(metricValue(status, "oilLifeRemaining")),
  },
  battery12v: {
    label: () => "12V BATT",
    value: (status) => formatPercent(metricValue(status, "batteryStateOfCharge")),
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
};

// A widget's own "Parameter" field (long-press widget -> Edit Widget) is a single text
// field, so it doubles as a tiny config language: a comma-separated list mixing item
// names (see TILE_DEFS/BLOCK_DEFS) with "imperial"/"metric". Order controls display
// order. Unrecognized tokens are ignored rather than erroring, so a typo just falls
// back to defaults instead of breaking the widget. Example: "doors,fuel,odometer,metric".
function parseWidgetParameter(paramStr) {
  const tokens = String(paramStr || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  let units = null;
  const items = [];
  for (const t of tokens) {
    if (t === "imperial" || t === "metric") units = t;
    else if (TILE_DEFS[t] || BLOCK_DEFS[t]) items.push(t);
  }
  return { units, items: items.length ? items : null };
}

// Interactive picker (run the script, not from a widget) so the Parameter mini-language
// doesn't have to be typed from memory. Lets you either save a default tile set used by
// any widget with a blank Parameter field, or copy a ready-made Parameter string to
// paste into one specific widget that should differ from the default.
async function runTileConfigurator() {
  const orderedItemKeys = [...Object.keys(TILE_DEFS), ...Object.keys(BLOCK_DEFS)];
  const selected = new Set(loadDefaultTiles() || DEFAULT_TILES_FULL);
  let units = loadUnits();

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
      const paramStr = [...selectedInOrder(), units].join(",");
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

  const vin = loadVin();
  const region = loadRegion();

  if (!vin || !loadToken()) {
    const t = widget.addText("Open this script in Scriptable to finish setup.");
    t.font = Font.systemFont(13);
    return widget;
  }

  const paramCfg = parseWidgetParameter(args.widgetParameter);
  const units = paramCfg.units || loadUnits();
  const compact = config.widgetFamily === "small";
  const itemKeys = paramCfg.items || loadDefaultTiles() || (compact ? DEFAULT_TILES_SMALL : DEFAULT_TILES_FULL);

  try {
    const status = await getStatus(vin, REGIONS[region]);

    const title = widget.addText("FordPass");
    title.font = Font.boldSystemFont(13);
    widget.addSpacer(8);

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
        await BLOCK_DEFS[key].render(widget, status, vin, region, units, isEv);
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
} else if (!loadVin() || !loadToken()) {
  await runSetup();
} else {
  await runMenu();
}
