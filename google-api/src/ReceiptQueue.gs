/**
 * TenantTracker – receipts requested from the WhatsApp bot (whatsapp-bot/).
 *
 * The bot is a separate Apps Script project, and installable on-edit triggers only fire for a
 * person's edits, never a script's, so the bot's writes never reach onPaidDateEditV2. Instead,
 * when the user answers "Email PDF: yes", the bot tags the month's row with developer metadata
 * (RECEIPT_QUEUE_KEY_), and processPendingReceipts(), on a time-driven trigger, sends a receipt
 * for each tagged row. Row metadata moves with its row, so inserting rows above it can't send
 * the wrong month.
 *
 * Setup: run installReceiptQueueTrigger() once from the editor.
 */

// Must match CONFIG.RECEIPT_QUEUE_KEY in whatsapp-bot/src/RentBot.gs.
const RECEIPT_QUEUE_KEY_ = 'rentbot:pending-receipt';
const RECEIPT_QUEUE_HANDLER_ = 'processPendingReceipts';

function processPendingReceipts() {
  // A user lock, not the script or document lock: processRow_ takes the document lock and
  // logEvent_ the script lock. This only stops two queue runs overlapping.
  const lock = LockService.getUserLock();
  if (!lock.tryLock(0)) {
    console.log('[TenantTracker] Receipt queue is already being processed — skipping this run.');
    return;
  }

  try {
    SpreadsheetApp.getActiveSpreadsheet()
      .createDeveloperMetadataFinder()
      .withKey(RECEIPT_QUEUE_KEY_)
      .find()
      .forEach(sendQueuedReceipt_);
  } finally {
    lock.releaseLock();
  }
}

function sendQueuedReceipt_(metadata) {
  let sheetName = '-';
  let row = '-';

  try {
    const range = metadata.getLocation().getRow();
    const sheet = range.getSheet();
    sheetName = sheet.getName();
    row = range.getRow();

    // Removed before sending: a failure is logged and alerted once, not retried every run.
    metadata.remove();

    if (CONFIG.skipSheets.indexOf(sheetName) !== -1) {
      logEvent_(sheetName, row, 'SKIP', 'Queued receipt is on a skipped sheet.');
      return;
    }

    const headerRow = findHeaderRow_(sheet);
    if (!headerRow || row <= headerRow) {
      logEvent_(sheetName, row, 'SKIP', 'Queued receipt: no header row found above this row.');
      return;
    }

    const cols = mapColumns_(sheet, headerRow);
    if (!cols.paidDate) {
      logEvent_(sheetName, row, 'SKIP', 'Queued receipt: no "Paid Date" column header found on row ' + headerRow + '.');
      return;
    }

    // force = true: the bot's "Email PDF: yes" is an explicit request, like ticking Email Trigger.
    processRow_(sheet, sheetName, cols, row, undefined, true);
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('[TenantTracker] Queued receipt FAILED on ' + sheetName + ' row ' + row + ': ' + msg);
    logEvent_(sheetName, row, 'ERROR', 'Queued receipt failed: ' + msg);
    notifyFailure_(sheetName, row, msg);
  }
}

/**
 * Utility: run once from the Apps Script editor. Checks the queue every 5 minutes.
 * Safe to run again: it won't add a second trigger.
 */
function installReceiptQueueTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === RECEIPT_QUEUE_HANDLER_;
  });

  if (exists) {
    console.log('[TenantTracker] Receipt queue trigger is already installed.');
    return;
  }

  ScriptApp.newTrigger(RECEIPT_QUEUE_HANDLER_).timeBased().everyMinutes(5).create();
  console.log('[TenantTracker] Receipt queue trigger installed: every 5 minutes.');
}
