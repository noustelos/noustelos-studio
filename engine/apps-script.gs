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
 *   { userMessage, botReply, model, at, who }   // who = "owner" | "guest" | ""
 */

var HEADERS = ["Timestamp", "User message", "Bot reply", "Model", "Who"];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

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

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
