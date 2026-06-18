/**
 * THE ARTIFACT // ENGINE  —  Google Apps Script archive
 * -----------------------------------------------------
 * Receives each chat exchange from the Worker and appends a row to a Sheet.
 *
 * Setup:
 *   1. Create a Google Sheet. First row headers (optional, auto-created):
 *        Timestamp | User message | Bot reply | Model | Who
 *   2. Extensions > Apps Script. Paste this file. Save.
 *   3. Deploy > New deployment > type "Web app".
 *        - Execute as: Me
 *        - Who has access: Anyone   (the Worker posts unauthenticated)
 *   4. Copy the web-app URL (ends in /exec) and set it on the Worker:
 *        npx wrangler secret put SHEETS_WEBHOOK_URL
 *
 *   To pick up the "Who" column on an EXISTING deployment: paste + Save, then
 *   Deploy > Manage deployments > (edit ✏️) > Version: "New version" > Deploy.
 *   Same /exec URL is kept, so SHEETS_WEBHOOK_URL stays valid.
 *
 * Payload from the Worker (JSON POST):
 *   { userMessage, botReply, model, at, who, persona }
 *   who = "owner" | "guest" | "" ;  persona = "gemma" (default tab) | "dion"
 *
 * Per-persona tabs: rows for persona "dion" land on a tab named "DION" (created
 * on first use with the same headers); everything else stays on the default
 * active sheet. Add more personas by extending PERSONA_TABS below.
 *
 * Owner long-term memory: a payload with { action: "mem-..." } is routed to the
 * "Memory" tab instead of logging — the durable "θυμήσου" facts the owner pins.
 *   mem-list                    -> { ok, memory:[fact,...] }
 *   mem-add    { fact }         -> append (dedupe); returns the list + status
 *   mem-import { facts:[...] }  -> bulk add with dedupe (one-time migration)
 *   mem-forget { index }        -> delete fact #index (1-based)
 *   mem-clear                   -> wipe all facts
 * Only the WORKER calls these (it holds the token + gates owner), so the list
 * stays private. OPTIONAL hardening: set a Script Property MEM_TOKEN (Project
 * Settings > Script Properties); when set, mem-* AND drive-* calls must carry a
 * matching token or are rejected. The Worker sends it from its own MEM_TOKEN
 * secret. Logging stays token-free.
 *
 * Owner Drive folder: { action: "drive-*" | "lib-*" } reads the owner's Drive
 * "Artifact" folder (this script runs AS the owner — no separate OAuth). The
 * folder has TWO subfolders:
 *   Artifact/Profile/ — always-on Global Context (folded into every owner turn).
 *   Artifact/Library/ — selective reference, loaded on demand with /read.
 *   drive-list -> { ok, folderFound, files:[{name,type}] }   (Profile files)
 *   drive-read -> { ok, folderFound, text }   (Profile text; Docs+text/md/csv/json; capped)
 *   lib-list   -> { ok, folderFound, files:[{name,type}] }   (Library files)
 *   lib-read   -> { ok, folderFound, text, read:[name] }     (only the named Library files)
 * Adding DriveApp/DocumentApp needs Drive + Documents scopes → the owner must
 * RE-AUTHORIZE on the next deploy (a one-time consent screen).
 */

var HEADERS = ["Timestamp", "User message", "Bot reply", "Model", "Who"];
// Map a persona -> its tab name. Personas not listed use the default sheet.
var PERSONA_TABS = { dion: "DION" };
var MEMORY_TAB = "Memory";
var MEMORY_HEADERS = ["Fact", "Added"];
var DRIVE_FOLDER = "Artifact";      // root folder in the owner's My Drive
var PROFILE_SUBFOLDER = "Profile";  // always-on Global Context (folded every turn)
var LIBRARY_SUBFOLDER = "Library";  // selective reference, loaded on demand (/read)
var DRIVE_MAX_CHARS = 12000;        // total text budget folded into the prompt

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    // Owner-memory actions are routed to the Memory tab, not the log.
    if (data.action && String(data.action).indexOf("mem-") === 0) {
      return handleMemory(data);
    }
    // Owner Drive-folder reads (the "Artifact" folder), not the log.
    if (data.action && (String(data.action).indexOf("drive-") === 0 ||
                        String(data.action).indexOf("lib-") === 0)) {
      return handleDrive(data);
    }
    var sheet = sheetForPersona(data.persona);

    // Add headers once, if the sheet is empty.
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(HEADERS);
    } else if (sheet.getLastColumn() < HEADERS.length) {
      // Older sheet without the "Who" column — add the missing header(s).
      sheet.getRange(1, HEADERS.length).setValue(HEADERS[HEADERS.length - 1]);
    }

    sheet.appendRow([
      data.at || new Date().toISOString(),
      data.userMessage || "",
      data.botReply || "",
      data.model || "",
      data.who || "",
    ]);

    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===== Owner long-term memory (Memory tab) ==============================

function handleMemory(data) {
  var required = "";
  try { required = PropertiesService.getScriptProperties().getProperty("MEM_TOKEN") || ""; } catch (e) {}
  if (required && String(data.token || "") !== required) {
    return jsonOut({ ok: false, error: "bad-token" });
  }
  try {
    switch (data.action) {
      case "mem-list":   return jsonOut(memList());
      case "mem-add":    return jsonOut(memAdd(data.fact));
      case "mem-import": return jsonOut(memImport(data.facts));
      case "mem-forget": return jsonOut(memForget(data.index));
      case "mem-clear":  return jsonOut(memClear());
      default:           return jsonOut({ ok: false, error: "unknown-action" });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function memorySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MEMORY_TAB);
  if (!sheet) { sheet = ss.insertSheet(MEMORY_TAB); sheet.appendRow(MEMORY_HEADERS); }
  else if (sheet.getLastRow() === 0) { sheet.appendRow(MEMORY_HEADERS); }
  return sheet;
}

// Non-blank facts in column A (rows 2..N) WITH their actual sheet row. Robust to
// manual edits: blank rows are skipped, and any extra columns the owner adds for
// their own notes (e.g. a "Notes" column) are ignored — the engine reads col A
// only, so those notes stay invisible to Gemma.
function memRows(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var fact = String(vals[i][0] || "").trim();
    if (fact) out.push({ fact: fact, row: i + 2 }); // data starts on row 2
  }
  return out;
}

function memFacts(sheet) {
  return memRows(sheet).map(function (r) { return r.fact; });
}

function memList() { return { ok: true, memory: memFacts(memorySheet()) }; }

function memAdd(fact) {
  var sheet = memorySheet();
  fact = String(fact || "").trim();
  var facts = memFacts(sheet);
  if (!fact) return { ok: true, memory: facts, status: "empty" };
  for (var i = 0; i < facts.length; i++) {
    if (facts[i].toLowerCase() === fact.toLowerCase()) return { ok: true, memory: facts, status: "dup" };
  }
  sheet.appendRow([fact, new Date().toISOString()]);
  return { ok: true, memory: memFacts(sheet), status: "added", fact: fact };
}

function memImport(facts) {
  var sheet = memorySheet();
  if (!Array.isArray(facts)) return { ok: true, memory: memFacts(sheet) };
  var have = {};
  memFacts(sheet).forEach(function (s) { have[s.toLowerCase()] = true; });
  var now = new Date().toISOString();
  facts.forEach(function (f) {
    f = String(f || "").trim();
    if (f && !have[f.toLowerCase()]) { sheet.appendRow([f, now]); have[f.toLowerCase()] = true; }
  });
  return { ok: true, memory: memFacts(sheet) };
}

function memForget(index) {
  var sheet = memorySheet();
  var rows = memRows(sheet);
  var i = parseInt(index, 10);
  if (!i || i < 1 || i > rows.length) {
    return { ok: true, memory: rows.map(function (r) { return r.fact; }), status: "notfound" };
  }
  var removed = rows[i - 1];
  sheet.deleteRow(removed.row); // the fact's ACTUAL row — gap-safe under hand-edits
  return { ok: true, memory: memFacts(sheet), status: "removed", fact: removed.fact };
}

function memClear() {
  var sheet = memorySheet();
  var last = sheet.getLastRow();
  if (last > 1) sheet.deleteRows(2, last - 1);
  return { ok: true, memory: [] };
}

// ===== Owner Drive folder ("Artifact") ==================================
// Reads files the owner drops in their Drive "Artifact" folder so Gemma can use
// them as reference (on /docs). Runs as the script owner, so it uses the owner's
// own Drive — no separate OAuth client. NOTE: adding DriveApp/DocumentApp means
// the script needs Drive + Documents scopes; the owner re-authorizes on the next
// deploy (consent screen). Only Google Docs + text/md/csv/json are extracted;
// PDFs/images/Office files are skipped (would need OCR/conversion).

function handleDrive(data) {
  var required = "";
  try { required = PropertiesService.getScriptProperties().getProperty("MEM_TOKEN") || ""; } catch (e) {}
  if (required && String(data.token || "") !== required) {
    return jsonOut({ ok: false, error: "bad-token" });
  }
  try {
    switch (data.action) {
      case "drive-list": return jsonOut(driveList());          // Profile files (listing)
      case "drive-read": return jsonOut(driveRead());          // Profile text (always-on)
      case "lib-list":   return jsonOut(libList());            // Library files (listing)
      case "lib-read":   return jsonOut(libRead(data.names));  // only the named Library files
      default:           return jsonOut({ ok: false, error: "unknown-action" });
    }
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function driveFolder() {
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  return it.hasNext() ? it.next() : null;
}

// A named subfolder ("Profile"/"Library") inside the "Artifact" root, or null.
function driveSubfolder(name) {
  var root = driveFolder();
  if (!root) return null;
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : null;
}

// Shared listing: [{name,type}] for every file directly in `folder`.
function listFiles(folder) {
  var files = [], it = folder.getFiles();
  while (it.hasNext()) {
    var f = it.next();
    files.push({ name: f.getName(), type: f.getMimeType() });
  }
  return files;
}

// Shared read: concatenated "### name\n<text>" for files in `folder`, capped at
// DRIVE_MAX_CHARS. When `wantNames` is given (Library /read), only those names
// are read; null reads them all (Profile). Returns { text, read:[names that
// actually yielded text] } so the caller can confirm what was loaded.
function readFiles(folder, wantNames) {
  var want = null;
  if (wantNames && wantNames.length) {
    want = {};
    wantNames.forEach(function (n) { want[String(n)] = true; });
  }
  var parts = [], read = [], total = 0, it = folder.getFiles();
  while (it.hasNext() && total < DRIVE_MAX_CHARS) {
    var f = it.next(), nm = f.getName();
    if (want && !want[nm]) continue;
    var text = extractFileText(f);
    if (!text) continue;  // PDF/image/Office → skipped (no extractable text)
    var chunk = "### " + nm + "\n" + text.trim();
    if (total + chunk.length > DRIVE_MAX_CHARS) {
      chunk = chunk.slice(0, Math.max(0, DRIVE_MAX_CHARS - total)) + "\n…(truncated)";
    }
    parts.push(chunk);
    read.push(nm);
    total += chunk.length;
  }
  return { text: parts.join("\n\n"), read: read };
}

// Profile = Artifact/Profile/ — the always-on Global Context.
function driveList() {
  var folder = driveSubfolder(PROFILE_SUBFOLDER);
  if (!folder) return { ok: true, folderFound: false, files: [] };
  return { ok: true, folderFound: true, files: listFiles(folder) };
}

function driveRead() {
  var folder = driveSubfolder(PROFILE_SUBFOLDER);
  if (!folder) return { ok: true, folderFound: false, text: "" };
  return { ok: true, folderFound: true, text: readFiles(folder, null).text };
}

// Library = Artifact/Library/ — selective reference, loaded by name on /read.
function libList() {
  var folder = driveSubfolder(LIBRARY_SUBFOLDER);
  if (!folder) return { ok: true, folderFound: false, files: [] };
  return { ok: true, folderFound: true, files: listFiles(folder) };
}

function libRead(names) {
  var folder = driveSubfolder(LIBRARY_SUBFOLDER);
  if (!folder) return { ok: true, folderFound: false, text: "", read: [] };
  var r = readFiles(folder, names);
  return { ok: true, folderFound: true, text: r.text, read: r.read };
}

// Extract plain text from a file, or "" if the type isn't supported.
function extractFileText(file) {
  var mime = file.getMimeType();
  try {
    if (mime === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(file.getId()).getBody().getText();
    }
    if (mime === MimeType.PLAIN_TEXT || mime === "text/markdown" ||
        mime === MimeType.CSV || mime === "application/json" ||
        String(mime).indexOf("text/") === 0) {
      return file.getBlob().getDataAsString();
    }
  } catch (e) { return ""; }
  return ""; // PDF / images / Office — skipped for now
}

// Returns the tab for a persona, creating a named tab on first use. Unknown or
// missing personas fall back to the spreadsheet's default active sheet.
function sheetForPersona(persona) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var key = persona ? String(persona).toLowerCase() : "";
  var tabName = PERSONA_TABS[key];
  if (!tabName) return ss.getActiveSheet();

  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
    sheet.appendRow(HEADERS);
  }
  return sheet;
}
