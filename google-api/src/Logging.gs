/* =========================================================================
 * LOGGING
 * ========================================================================= */

// Writes one row to a visible "Email Log" sheet: Timestamp | Sheet | Row | Status | Detail
function logEvent_(sheetName, row, status, detail) {
  const lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000); // wait up to 10s for another execution to finish creating/writing the log
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let log = ss.getSheetByName(CONFIG.logSheetName);
    if (!log) {
      log = ss.insertSheet(CONFIG.logSheetName);
      log.appendRow(['Timestamp', 'Sheet', 'Row', 'Status', 'Detail']);
      log.setFrozenRows(1);
      log.getRange(1, 1, 1, 5).setFontWeight('bold');
    }
    log.appendRow([new Date(), sheetName, row, status, detail]);
  } catch (logErr) {
    // Logging must never break the main flow.
    console.error('[TenantTracker] Failed to write to Email Log sheet: ' + logErr.message);
  } finally {
    lock.releaseLock();
  }
}

// Optional: email the admin when a row fails outright, so failures aren't only visible
// in Executions or the log sheet. Leave the ALERT_EMAIL Script Property unset to disable.
function notifyFailure_(sheetName, row, msg) {
  if (!CONFIG.alertEmailOnFailure) return;
  try {
    MailApp.sendEmail({
      to: CONFIG.alertEmailOnFailure,
      subject: 'TenantTracker: receipt email FAILED (' + sheetName + ' row ' + row + ')',
      body: 'Sheet: ' + sheetName + '\nRow: ' + row + '\nError: ' + msg +
        '\n\nCheck the "Email Log" tab and Extensions > Apps Script > Executions for details.',
    });
  } catch (alertErr) {
    // If we're here because quota is exhausted, this send will also fail — that's expected,
    // just make sure it doesn't throw further.
    console.error('[TenantTracker] Could not send failure alert email: ' + alertErr.message);
  }
}
