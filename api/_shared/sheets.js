const crypto = require("crypto");

// Hand-rolled Google service-account auth (JWT -> OAuth2 access token) using
// only Node's built-in crypto module, so no npm dependency is needed.

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let cachedToken = null; // { token, expires } — reused while the function stays warm

async function getAccessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.token;

  const email = process.env.GOOGLE_SA_EMAIL;
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error("Missing GOOGLE_SA_EMAIL or GOOGLE_SA_PRIVATE_KEY");
  }

  // Vercel env vars store "\n" as literal backslash-n; convert back to real newlines.
  const privateKey = rawKey.includes("\\n") ? rawKey.replace(/\\n/g, "\n") : rawKey;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claimSet = {
    iss: email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = base64url(JSON.stringify(header)) + "." + base64url(JSON.stringify(claimSet));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer
    .sign(privateKey)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const jwt = unsigned + "." + signature;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error("Token exchange failed: " + text);
  }

  const data = await res.json();
  cachedToken = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return data.access_token;
}

function sheetsBase() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error("Missing GOOGLE_SHEET_ID");
  return "https://sheets.googleapis.com/v4/spreadsheets/" + sheetId;
}

async function sheetsFetch(path, options) {
  const accessToken = await getAccessToken();
  const res = await fetch(sheetsBase() + path, {
    ...options,
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error("Sheets API " + res.status + ": " + text);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

// Append one row to the main results tab.
async function appendRow(values) {
  // IMPORTANT: Google's append "finds a table" inside this range and starts the
  // new row at that table's first column. Column A is filled on every row, so
  // pointing at A:A makes it always append a fresh row starting at column A
  // (the row itself can still be as wide as we like).
  const range = "Sheet1!A:A";
  const out = await sheetsFetch(
    "/values/" + encodeURIComponent(range) + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
    { method: "POST", body: JSON.stringify({ values: [values] }) }
  );
  console.log("Sheets row appended at:", out && out.updates && out.updates.updatedRange);
  return out;
}

// ---- "Started" tab: one row for every test start --------------------------

const STARTED = "Started";
const STARTED_HEADERS = ["Started (KSA time)", "Name", "Agency", "Set no.", "Test ID", "Start (sheet time)", "Status"];
const NOT_SUBMITTED_AFTER_MIN = 25;
let tzCache = null;

async function getSheetTimeZone() {
  if (tzCache) return tzCache;
  const meta = await sheetsFetch("?fields=properties.timeZone");
  tzCache = (meta && meta.properties && meta.properties.timeZone) || "UTC";
  return tzCache;
}

// Spreadsheet serial number (days since 1899-12-30) of "now" in the sheet's own
// time zone, so NOW() inside the Sheet can be compared with it directly.
function sheetSerialNow(tz) {
  const parts = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
  const hour = parts.hour === "24" ? 0 : +parts.hour;
  const ms = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hour, +parts.minute, +parts.second);
  return ms / 86400000 + 25569;
}

function ksaNowText() {
  const now = new Date();
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(now);
  return d + " " + t;
}

async function createStartedTab() {
  let sheetId;
  try {
    const r = await sheetsFetch(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: STARTED, gridProperties: { frozenRowCount: 1 } } } }],
      }),
    });
    sheetId = r.replies[0].addSheet.properties.sheetId;
  } catch (e) {
    // Another request may have created it a moment ago — that is fine.
    if (!/already exists/i.test(String(e.body || e.message))) throw e;
    return;
  }
  await sheetsFetch("/values/" + encodeURIComponent(STARTED + "!A1:G1") + "?valueInputOption=RAW", {
    method: "PUT",
    body: JSON.stringify({ values: [STARTED_HEADERS] }),
  });
  await sheetsFetch(":batchUpdate", {
    method: "POST",
    body: JSON.stringify({
      requests: [
        { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: "userEnteredFormat.textFormat.bold" } },
        { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm:ss" } } }, fields: "userEnteredFormat.numberFormat" } },
        { addConditionalFormatRule: { index: 0, rule: { ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 6, endColumnIndex: 7 }], booleanRule: { condition: { type: "TEXT_CONTAINS", values: [{ userEnteredValue: "Not submitted" }] }, format: { backgroundColor: { red: 0.96, green: 0.8, blue: 0.8 }, textFormat: { bold: true } } } } } },
        { updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 7 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
      ],
    }),
  });
}

// Writes one "Started" row and returns which of the `setCount` sets this
// candidate should get. The row number Google returns is an atomic counter, so
// two people starting at the same moment can never get the same set.
async function logStart({ name, agency, testId, setCount }) {
  const tz = await getSheetTimeZone();
  const statusFormula =
    '=IF(COUNTIF(Sheet1!$G:$G,INDEX($E:$E,ROW()))>0,"Submitted",IF((NOW()-INDEX($F:$F,ROW()))*1440>' +
    NOT_SUBMITTED_AFTER_MIN +
    ',"Not submitted - FAIL","In progress"))';
  const row = [ksaNowText(), name, agency, "", testId, sheetSerialNow(tz), statusFormula];
  const url = "/values/" + encodeURIComponent(STARTED + "!A:A") + ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS";

  let out;
  try {
    out = await sheetsFetch(url, { method: "POST", body: JSON.stringify({ values: [row] }) });
  } catch (e) {
    if (e.status === 400 && /Unable to parse range|not found/i.test(String(e.body || ""))) {
      await createStartedTab();
      out = await sheetsFetch(url, { method: "POST", body: JSON.stringify({ values: [row] }) });
    } else {
      throw e;
    }
  }
  const range = out && out.updates && out.updates.updatedRange;
  const m = range && range.match(/!\$?[A-Z]+\$?(\d+)/);
  if (!m) return null;
  const rowNo = parseInt(m[1], 10);
  const setIndex = Math.max(0, rowNo - 2) % setCount; // row 1 = header, row 2 = candidate 1
  // Show the set number next to the candidate (display only).
  try {
    await sheetsFetch(
      "/values/" + encodeURIComponent(STARTED + "!D" + rowNo) + "?valueInputOption=RAW",
      { method: "PUT", body: JSON.stringify({ values: [[setIndex + 1]] }) }
    );
  } catch (e) {
    console.error("Could not write set number:", String(e));
  }
  return { rowNo, setIndex };
}

module.exports = { appendRow, logStart };
