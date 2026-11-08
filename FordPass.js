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
  menu.addAction("Re-run setup / change VIN or region");
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
      await runSetup();
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

  try {
    const status = await getStatus(vin, REGIONS[region]);
    const title = widget.addText("FordPass");
    title.font = Font.boldSystemFont(14);
    widget.addSpacer(8);

    const row = widget.addStack();
    row.layoutHorizontally();
    addTile(row, "DOORS", metricValue(status, "doorLockStatus", (d) => d.vehicleDoor === "ALL_DOORS"));
    row.addSpacer(16);
    addTile(row, "FUEL/CHARGE", metricValue(status, "fuelLevel") ?? metricValue(status, "xevBatteryStateOfCharge"));
    row.addSpacer(16);
    addTile(row, "ODOMETER", metricValue(status, "odometer"));

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
