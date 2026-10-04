/**
 * Rent bot: a WhatsApp Cloud API webhook that records a tenant's monthly electricity, water
 * and payment in the TenantTracker spreadsheet, one question at a time.
 *
 * A separate Apps Script project from google-api/ (a standalone web app that opens the sheet
 * by ID), so the two never share a global scope. Expected to be retired once the app takes
 * over; see ../README.md.
 */

// The live spreadsheet's ID comes from the SPREADSHEET_ID Script Property. This repository is
// public: never put the real ID in code. The placeholder only marks "not configured".
const SPREADSHEET_ID_PLACEHOLDER = "YOUR_SPREADSHEET_ID";

function getLiveSpreadsheetId() {
  const id = getScriptProperty("SPREADSHEET_ID");
  return id && id !== SPREADSHEET_ID_PLACEHOLDER ? id : "";
}

const CONFIG = {
  EXCLUDED_SHEETS: ["README", "Template", "Email Log"],

  // Keep true while testing.
  // Change to false when you're ready to actually write to the sheet.
  DRY_RUN: true,

  // An entry left unanswered this long is dropped, so a reply days later can't save
  // against a sheet that has changed since.
  SESSION_TTL_MINUTES: 30,

  // Row tag that asks google-api/src/ReceiptQueue.gs to email the receipt. Must match
  // RECEIPT_QUEUE_KEY_ there.
  RECEIPT_QUEUE_KEY: "rentbot:pending-receipt"
};

let spreadsheetIdOverride = null; // set only by withTestSpreadsheet()
let openedSpreadsheet = null;

function getSpreadsheet() {
  const id = spreadsheetIdOverride || getLiveSpreadsheetId();

  if (!id) {
    throw new Error(
      "The SPREADSHEET_ID Script Property isn't set. Add it in Project Settings → Script Properties."
    );
  }

  // Opened once per execution: the timezone and tenant lookups would otherwise reopen it.
  if (!openedSpreadsheet || openedSpreadsheet.getId() !== id) {
    openedSpreadsheet = SpreadsheetApp.openById(id);
  }

  return openedSpreadsheet;
}


function getScriptProperty(key) {
  const value =
    PropertiesService
      .getScriptProperties()
      .getProperty(key);

  return value == null ? "" : String(value).trim();
}


// Script Properties (DRY_RUN_OVERRIDE) is the source of truth once set,
// via the rentcheck-safe-mode-on / rentcheck-safe-mode-off commands.
// CONFIG.DRY_RUN only applies before either has ever been sent.
function isDryRunActive() {
  const override = getScriptProperty("DRY_RUN_OVERRIDE");

  if (override === "true") {
    return true;
  }

  if (override === "false") {
    return false;
  }

  return CONFIG.DRY_RUN;
}

const STEPS = {
  TENANT: "TENANT",
  MONTH_SELECT: "MONTH_SELECT",
  OVERWRITE_CONFIRM: "OVERWRITE_CONFIRM",
  ELECTRICITY: "ELECTRICITY",
  WATER: "WATER",
  PAID: "PAID",
  PAID_DATE: "PAID_DATE",
  AMOUNT_PAID: "AMOUNT_PAID",
  NOTES: "NOTES",
  EMAIL_PDF: "EMAIL_PDF",
  CONFIRM: "CONFIRM"
};


// ============================================================
// WHATSAPP WEBHOOK
// ============================================================

function doGet(e) {
  const verifyToken = getScriptProperty("WA_VERIFY_TOKEN");

  const mode = e.parameter["hub.mode"];
  const token = e.parameter["hub.verify_token"];
  const challenge = e.parameter["hub.challenge"];

  if (
    mode === "subscribe" &&
    verifyToken &&
    token === verifyToken
  ) {
    return ContentService
      .createTextOutput(challenge)
      .setMimeType(ContentService.MimeType.TEXT);
  }

  return ContentService
    .createTextOutput("Webhook verification failed.")
    .setMimeType(ContentService.MimeType.TEXT);
}


function doPost(e) {
  // Apps Script can't read Meta's X-Hub-Signature-256 header, so the web app URL itself
  // carries a secret. Without it, anyone with the /exec URL could post a forged message.
  if (!isAuthorisedWebhookCall(e)) {
    console.warn("Rejected a webhook call without a valid key.");

    return ContentService
      .createTextOutput("EVENT_RECEIVED")
      .setMimeType(ContentService.MimeType.TEXT);
  }

  try {
    const payload = JSON.parse(e.postData.contents);

    const entries = payload.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const messages = change.value?.messages || [];

        for (const message of messages) {
          processWhatsAppMessage(message);
        }
      }
    }

  } catch (error) {
    console.error(
      "WhatsApp webhook error:",
      error.stack || error
    );
  }

  return ContentService
    .createTextOutput("EVENT_RECEIVED")
    .setMimeType(ContentService.MimeType.TEXT);
}


function isAuthorisedWebhookCall(e) {
  const secret = getScriptProperty("WA_WEBHOOK_SECRET");

  if (!secret) {
    console.error("WA_WEBHOOK_SECRET is not set: every webhook call is rejected.");
    return false;
  }

  const key = e && e.parameter ? e.parameter.key : null;

  return typeof key === "string" && key === secret;
}


// Meta sends numbers as digits only (918341413827); the allow list may include "+" or spaces.
function normalisePhone(value) {
  return String(value || "").replace(/\D/g, "");
}


function isAllowedSender(phone) {
  const allowed =
    getScriptProperty("WA_ALLOWED_NUMBERS")
      .split(",")
      .map(normalisePhone)
      .filter(Boolean);

  return allowed.includes(normalisePhone(phone));
}


function processWhatsAppMessage(message) {
  if (!message || message.type !== "text") {
    return;
  }

  const phone = message.from;
  const text = message.text?.body;
  const messageId = message.id;

  if (!phone || !text) {
    return;
  }

  // Only the owners may use the bot. Meta's test-number allow list only limits who gets
  // replies, not who can make the bot write to the sheet.
  if (!isAllowedSender(phone)) {
    console.warn("Ignored a message from a number that isn't in WA_ALLOWED_NUMBERS.");
    return;
  }

  // One message at a time: two quick replies (or a redelivery) must not read and write the
  // same session at once, and the duplicate check below must be atomic.
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(20000)) {
    console.error(`Busy: message ${messageId} was not processed.`);
    sendWhatsAppText(phone, "I'm still working on your previous message. Please send that again.");
    return;
  }

  let reply;

  try {
    if (isDuplicateWhatsAppMessage(messageId)) {
      return;
    }

    reply = handleMessage(phone, text);
  } finally {
    lock.releaseLock();
  }

  if (reply) {
    sendWhatsAppText(phone, reply);
  }
}


function isDuplicateWhatsAppMessage(messageId) {
  if (!messageId) {
    return false;
  }

  const cache = CacheService.getScriptCache();

  const key = `wa_${messageId}`;

  if (cache.get(key)) {
    return true;
  }

  // 6 hours
  cache.put(key, "1", 21600);

  return false;
}


function getWhatsAppConfig() {
  const config = {
    accessToken: getScriptProperty("WA_ACCESS_TOKEN"),
    phoneNumberId: getScriptProperty("WA_PHONE_NUMBER_ID"),
    verifyToken: getScriptProperty("WA_VERIFY_TOKEN"),
    graphVersion: getScriptProperty("WA_GRAPH_VERSION")
  };

  const missing = [];

  if (!config.accessToken) {
    missing.push("WA_ACCESS_TOKEN");
  }

  if (!config.phoneNumberId) {
    missing.push("WA_PHONE_NUMBER_ID");
  }

  if (!config.verifyToken) {
    missing.push("WA_VERIFY_TOKEN");
  }

  if (!config.graphVersion) {
    missing.push("WA_GRAPH_VERSION");
  }

  if (missing.length > 0) {
    throw new Error(
      "Missing WhatsApp configuration: " +
      missing.join(", ")
    );
  }

  return config;
}


function sendWhatsAppText(phone, text) {
  const config = getWhatsAppConfig();

  const url =
    `https://graph.facebook.com/${config.graphVersion}/` +
    `${config.phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: {
      body: text
    }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `Bearer ${config.accessToken}`
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();

  if (responseCode < 200 || responseCode >= 300) {
    console.error(
      `WhatsApp send failed (${responseCode}): ${response.getContentText()}`
    );
  }
}


// ============================================================
// MAIN BOT HANDLER
// ============================================================

function handleMessage(phone, rawMessage) {
  const message = String(rawMessage || "").trim();

  if (!message) {
    return "Please send a message.";
  }

  const command = message.toLowerCase();

  // Global commands
  if (command === "rent.start") {
    return startRentEntry(phone);
  }

  if (command === "rent.cancel") {
    deleteSession(phone);
    return "Current rent entry cancelled.";
  }

  if (command === "rent.status") {
    return getCurrentStatus(phone);
  }

  if (command === "hint") {
    return buildHintMessage();
  }

  // Real on/off control for writes, listed in hint. Overrides
  // CONFIG.DRY_RUN once either command has been sent.
  if (command === "rentcheck-safe-mode-on") {
    PropertiesService
      .getScriptProperties()
      .setProperty("DRY_RUN_OVERRIDE", "true");

    return "Safe mode enabled. Writes are disabled until turned off.";
  }

  if (command === "rentcheck-safe-mode-off") {
    PropertiesService
      .getScriptProperties()
      .setProperty("DRY_RUN_OVERRIDE", "false");

    return "Safe mode disabled. Entries will now write to the sheet.";
  }

  // Get active conversation
  const session = getSession(phone);

  if (!session) {
    return (
      "No rent entry is in progress. Send rent.start to begin.\n\n" +
      "Didn't understand that? Send hint to see all commands."
    );
  }

  if (isSessionExpired(session)) {
    deleteSession(phone);

    return (
      `That entry expired after ${CONFIG.SESSION_TTL_MINUTES} minutes without a reply. ` +
      "Nothing was saved. Send rent.start to begin again."
    );
  }

  switch (session.step) {

    // --------------------------------------------------------
    // TENANT
    // --------------------------------------------------------
    case STEPS.TENANT: {
      // Numbers refer to the list this user was shown, even if tabs were reordered since.
      const choices = session.tenantChoices || [];
      const tenant = resolveTenant(message, choices);

      if (!tenant) {
        return buildTenantListMessage(
          "I couldn't find that tenant. Reply with the number or tenant tab name.",
          choices
        );
      }

      return selectTenant(phone, session, tenant);
    }


    // --------------------------------------------------------
    // MONTH SELECT
    // --------------------------------------------------------
    case STEPS.MONTH_SELECT: {
      const index = resolveMonthChoice(message);

      if (index === null) {
        return "Reply 1, 2, or 3 to choose a month.";
      }

      // The month shown in the menu, even if the reply arrives after the month has changed.
      const monthKey = session.monthChoices[index];

      const sheet = getSpreadsheet().getSheetByName(session.sheetName);

      if (!sheet) {
        deleteSession(phone);
        return "Tenant sheet could not be found. Send rent.start to try again.";
      }

      let layout;

      try {
        layout = getLayout(sheet);
      } catch (error) {
        deleteSession(phone);
        return error.message + "\n\nSend rent.start to try again.";
      }

      const row = findMonthRow(sheet, layout, monthKey);

      if (!row) {
        return (
          "I couldn't find " +
          formatMonthKey(monthKey) +
          " in the tenant sheet. Reply 1, 2, or 3 to choose a month."
        );
      }

      session.monthKey = monthKey;
      session.month = formatMonthKey(monthKey);

      return advancePastMonthSelection(phone, session, sheet, layout, row);
    }


    // --------------------------------------------------------
    // OVERWRITE CONFIRM
    // --------------------------------------------------------
    case STEPS.OVERWRITE_CONFIRM: {
      const overwrite = parseYesNo(message);

      if (overwrite === null) {
        return "Reply yes to continue or no to cancel.";
      }

      if (!overwrite) {
        deleteSession(phone);

        return "Entry cancelled. Existing data was not changed.";
      }

      session.step = STEPS.ELECTRICITY;

      saveSession(phone, session);

      return "Enter electricity units.";
    }


    // --------------------------------------------------------
    // ELECTRICITY
    // --------------------------------------------------------
    case STEPS.ELECTRICITY: {
      const units = parseNumber(message);

      if (units === null) {
        return "Enter valid electricity units, for example: 87";
      }

      session.electricityUnits = units;

      // Some tabs have no Water Bill column: don't ask for a value that can't be saved.
      if (session.hasWater) {
        session.step = STEPS.WATER;
        saveSession(phone, session);

        return "What is the water bill amount?";
      }

      session.waterBill = null;
      session.step = STEPS.PAID;
      saveSession(phone, session);

      return buildPaidQuestion(session);
    }


    // --------------------------------------------------------
    // WATER
    // --------------------------------------------------------
    case STEPS.WATER: {
      const waterBill = parseNumber(message, 2);

      if (waterBill === null) {
        return "Enter a valid water bill amount, for example: 120";
      }

      session.waterBill = waterBill;
      session.step = STEPS.PAID;

      saveSession(phone, session);

      return buildPaidQuestion(session);
    }


    // --------------------------------------------------------
    // PAID
    // --------------------------------------------------------
    case STEPS.PAID: {
      const paid = parseYesNo(message);

      if (paid === null) {
        return "Please reply yes or no.";
      }

      session.paid = paid;

      if (paid) {
        session.step = STEPS.PAID_DATE;

        saveSession(phone, session);

        return "What was the paid date?\n\nReply today or enter DD/MM/YYYY, e.g. 25/12/2026.";
      }

      // No new payment: whatever is already recorded is kept, never cleared.
      session.paidDate = null;
      session.amountPaid = null;
      session.step = STEPS.NOTES;

      saveSession(phone, session);

      return buildNotesQuestion(session);
    }


    // --------------------------------------------------------
    // PAID DATE
    // --------------------------------------------------------
    case STEPS.PAID_DATE: {
      const dateKey = parseDate(message);

      if (!dateKey) {
        return "Invalid date. Reply today or use DD/MM/YYYY, e.g. 25/12/2026.";
      }

      if (dateKey > getTodayKey()) {
        return "The paid date can't be in the future. Reply today or use DD/MM/YYYY.";
      }

      session.paidDate = dateKey;
      session.step = STEPS.AMOUNT_PAID;

      saveSession(phone, session);

      const rentHint = getRentAmountHint(session);
      const lines = ["How much was paid this time?"];

      if (session.existingTotalPaid > 0) {
        lines.push(
          "",
          `It's added to the ${formatRupees(session.existingTotalPaid)} already recorded.`
        );
      }

      if (rentHint) {
        lines.push("", `Rent due: ${rentHint}`);
      }

      return lines.join("\n");
    }


    // --------------------------------------------------------
    // AMOUNT PAID
    // --------------------------------------------------------
    case STEPS.AMOUNT_PAID: {
      const amount = parseNumber(message, 2);

      if (amount === null || amount <= 0) {
        return "Enter an amount greater than 0, with at most two decimals, for example: 17000";
      }

      session.amountPaid = amount;
      session.step = STEPS.NOTES;

      saveSession(phone, session);

      return buildNotesQuestion(session);
    }


    // --------------------------------------------------------
    // NOTES
    // --------------------------------------------------------
    case STEPS.NOTES: {
      // null = leave the Notes cell as it is.
      session.notes =
        command === "skip"
          ? null
          : message;

      session.step = STEPS.EMAIL_PDF;

      saveSession(phone, session);

      return "Email the PDF receipt for this entry?\n\nReply yes or no.";
    }


    // --------------------------------------------------------
    // EMAIL PDF
    // --------------------------------------------------------
    case STEPS.EMAIL_PDF: {
      const emailPdf = parseYesNo(message);

      if (emailPdf === null) {
        return "Please reply yes or no.";
      }

      session.emailPdf = emailPdf;
      session.step = STEPS.CONFIRM;

      saveSession(phone, session);

      return buildConfirmationMessage(session);
    }


    // --------------------------------------------------------
    // CONFIRM
    // --------------------------------------------------------
    case STEPS.CONFIRM: {
      const confirmed = parseYesNo(message);

      if (confirmed === null) {
        return "Reply yes to save or no to cancel.";
      }

      if (!confirmed) {
        deleteSession(phone);

        return "Entry cancelled. Nothing was changed.";
      }

      let result;

      try {
        result = saveRentEntry(session);
      } catch (error) {
        deleteSession(phone);

        const outcome = error.partialWrite
          ? "Some cells may already have been written. Check the row in the sheet before trying again."
          : "Nothing was changed.";

        return (
          "Something went wrong saving this entry: " +
          error.message +
          `\n\n${outcome} Send rent.start to try again.`
        );
      }

      deleteSession(phone);

      return buildSavedMessage(session, result);
    }


    default:
      deleteSession(phone);

      return "Conversation state was invalid. Send rent.start to begin again.";
  }
}


// ============================================================
// START WORKFLOW
// ============================================================

function startRentEntry(phone) {
  const tenants = getTenantSheetNames();

  if (tenants.length === 0) {
    return "No tenant sheets were found.";
  }

  const session = {
    step: STEPS.TENANT,
    tenantChoices: tenants
  };

  saveSession(phone, session);

  const banner = isDryRunActive()
    ? "⚠ DRY RUN MODE — nothing will be saved to the sheet.\n\n"
    : "";

  // Only one tenant? Don't make yourself select the obvious answer.
  if (tenants.length === 1) {
    return banner + selectTenant(
      phone,
      session,
      tenants[0]
    );
  }

  return banner + buildTenantListMessage(
    "Which tenant?",
    tenants
  );
}


// ============================================================
// TENANT SELECTION
// ============================================================

function selectTenant(phone, session, sheetName) {
  const sheet = getSpreadsheet().getSheetByName(sheetName);

  if (!sheet) {
    // The tab was renamed or removed since the list was sent: offer the current list.
    session.tenantChoices = getTenantSheetNames();
    saveSession(phone, session);

    return buildTenantListMessage(
      `The tab "${sheetName}" no longer exists. Which tenant?`,
      session.tenantChoices
    );
  }

  let layout;

  try {
    layout = getLayout(sheet);
  } catch (error) {
    deleteSession(phone);
    return error.message + "\n\nSend rent.start to try again.";
  }

  session.sheetName = sheetName;
  session.hasWater = layout.cols.water !== null;
  session.monthChoices = [-1, 0, 1].map(getMonthKeyFromToday);
  session.step = STEPS.MONTH_SELECT;

  saveSession(phone, session);

  return `Tenant: ${sheetName}\n\n` + buildMonthSelectMessage(session.monthChoices);
}


// ============================================================
// MONTH SELECTION
// ============================================================

function buildMonthSelectMessage(monthChoices) {
  return (
    "Which month?\n\n" +
    `1. ${formatMonthKey(monthChoices[0])}\n` +
    `2. ${formatMonthKey(monthChoices[1])} (current)\n` +
    `3. ${formatMonthKey(monthChoices[2])}`
  );
}


// Index into session.monthChoices, or null.
function resolveMonthChoice(message) {
  const choice = message.trim();

  if (choice === "1") return 0;
  if (choice === "2") return 1;
  if (choice === "3") return 2;

  return null;
}


function advancePastMonthSelection(phone, session, sheet, layout, row) {
  try {
    checkStatusFormula(sheet, layout, row);
  } catch (error) {
    deleteSession(phone);
    return error.message;
  }

  const existing = readExistingEntry(sheet, layout, row);

  if (existing.totalPaidAmount === null) {
    deleteSession(phone);

    return (
      `Total Paid for ${session.month} isn't a number ("${existing.totalPaid}"). ` +
      "Fix it in the sheet, then send rent.start again."
    );
  }

  // Saved so the write can check that nobody changed the row in the meantime.
  session.snapshot = existing.snapshot;
  session.existingTotalPaid = existing.totalPaidAmount;
  session.existingPaidDate = existing.paidDate;
  session.hasExistingNotes = existing.notes !== "";

  let response =
    `Tenant: ${session.sheetName}\n` +
    `Month: ${session.month}\n`;

  if (existing.hasData) {
    session.step = STEPS.OVERWRITE_CONFIRM;

    saveSession(phone, session);

    response +=
      "\n⚠ Existing data was found for this month:\n" +
      `Electricity: ${existing.electricity || "-"}\n` +
      (session.hasWater ? `Water: ${existing.water || "-"}\n` : "") +
      `Total Paid: ${existing.totalPaid || "-"}\n` +
      `Paid Date: ${existing.paidDate || "-"}\n` +
      `Notes: ${existing.notes || "-"}\n` +
      "\nThe units and water you enter will replace these. A payment you add is added to " +
      "Total Paid, not replacing it.\n" +
      "\nContinue?\nReply yes or no.";

    return response;
  }

  session.step = STEPS.ELECTRICITY;

  saveSession(phone, session);

  response += "\nEnter electricity units.";

  return response;
}


function buildPaidQuestion(session) {
  if (session.existingTotalPaid > 0) {
    return (
      `Already paid for ${session.month}: ${formatRupees(session.existingTotalPaid)}` +
      (session.existingPaidDate ? ` (last on ${session.existingPaidDate})` : "") +
      ".\n\nWas another payment received?\nReply yes or no."
    );
  }

  return "Has the rent been paid?\n\nReply yes or no.";
}


function buildNotesQuestion(session) {
  return session.hasExistingNotes
    ? "Any notes?\n\nReply skip to keep the existing notes."
    : "Any notes?\n\nReply skip if there are none.";
}


// ============================================================
// SAVE INTO YOUR EXISTING WORKBOOK
// ============================================================

function saveRentEntry(session) {
  if (isDryRunActive()) {
    return {
      dryRun: true
    };
  }

  const sheet = getSpreadsheet().getSheetByName(session.sheetName);

  if (!sheet) {
    throw new Error(
      `Tenant sheet not found: ${session.sheetName}`
    );
  }

  const layout = getLayout(sheet);
  const cols = layout.cols;

  // Found again rather than reusing a row number from earlier: rows may have been inserted.
  const row = findMonthRow(sheet, layout, session.monthKey);

  if (!row) {
    throw new Error(`${session.month} is no longer in the tenant sheet.`);
  }

  checkStatusFormula(sheet, layout, row);

  // What the user was shown (and confirmed overwriting) must still be what's there.
  const current = readExistingEntry(sheet, layout, row);

  if (current.snapshot !== session.snapshot) {
    throw new Error(`${session.month} was changed in the sheet after you started this entry.`);
  }

  const writes = [
    { col: cols.units, value: session.electricityUnits }
  ];

  if (cols.water && session.waterBill !== null && session.waterBill !== undefined) {
    writes.push({ col: cols.water, value: session.waterBill });
  }

  if (session.notes !== null && session.notes !== undefined) {
    writes.push({ col: cols.notes, value: session.notes });
  }

  if (session.paid) {
    // Added to what's already recorded: a second payment must not replace the first.
    writes.push({
      col: cols.totalPaid,
      value: addAmounts(current.totalPaidAmount, session.amountPaid)
    });

    // Paid Date holds the latest payment: an earlier payment logged late doesn't move it back.
    if (!current.paidDateKey || session.paidDate >= current.paidDateKey) {
      writes.push({
        col: cols.paidDate,
        // Midnight in the sheet's own time zone, so the sheet shows the day that was entered.
        value: Utilities.parseDate(session.paidDate, getTimezone(), "yyyy-MM-dd"),
        format: "dd/mm/yyyy"
      });
    }
  }

  writeRowCells(sheet, row, writes);

  // The entry is saved from here on: nothing below may throw, or the user would be told
  // that nothing was changed.
  const result = {
    dryRun: false,
    // Let your existing formulas calculate these.
    status: readDisplayValue(sheet, row, cols.status),
    electricityCharge: readDisplayValue(sheet, row, cols.elec),
    totalDue: readDisplayValue(sheet, row, cols.totalDue),
    receipt: null
  };

  if (session.emailPdf) {
    result.receipt = queueReceipt(sheet, row);
  }

  return result;
}


// Writes each cell, or puts back what was there if any write fails.
function writeRowCells(sheet, row, writes) {
  const originals = writes.map(write => {
    const range = sheet.getRange(row, write.col);

    return {
      range,
      formula: range.getFormula(),
      value: range.getValue(),
      format: range.getNumberFormat()
    };
  });

  try {
    writes.forEach((write, index) => {
      const range = originals[index].range;

      if (write.format) {
        range.setNumberFormat(write.format);
      }

      range.setValue(write.value);
    });

    SpreadsheetApp.flush();
  } catch (error) {
    let restored = true;

    try {
      originals.forEach(original => {
        original.range.setNumberFormat(original.format);

        if (original.formula) {
          original.range.setFormula(original.formula);
        } else {
          original.range.setValue(original.value);
        }
      });

      SpreadsheetApp.flush();
    } catch (restoreError) {
      restored = false;
      console.error("Could not restore the row after a failed write:", restoreError);
    }

    const failure = new Error(error.message);
    failure.partialWrite = !restored;
    throw failure;
  }
}


function readDisplayValue(sheet, row, col) {
  if (!col) {
    return "-";
  }

  try {
    return sheet.getRange(row, col).getDisplayValue() || "-";
  } catch (error) {
    return "-";
  }
}


// Installable on-edit triggers only fire for a person's edits, never a script's, so this
// bot's writes can't trigger the receipt email directly. It tags the row instead, and
// google-api/src/ReceiptQueue.gs emails tagged rows every few minutes. Row metadata moves
// with the row, so inserting rows above it can't send the wrong month.
function queueReceipt(sheet, row) {
  try {
    const rowRange = sheet.getRange(`${row}:${row}`);

    const alreadyQueued =
      rowRange
        .getDeveloperMetadata()
        .some(metadata => metadata.getKey() === CONFIG.RECEIPT_QUEUE_KEY);

    if (!alreadyQueued) {
      rowRange.addDeveloperMetadata(CONFIG.RECEIPT_QUEUE_KEY);
    }

    return { queued: true };
  } catch (error) {
    console.error("Could not queue the receipt:", error);

    return { queued: false, error: error.message };
  }
}


// ============================================================
// SHEET LAYOUT
// ============================================================

// Header row: the row with "Month" in column A, within the first 30 rows.
function findHeaderRow(sheet) {
  const last = Math.min(sheet.getLastRow(), 30);

  if (last < 1) {
    return null;
  }

  const columnA = sheet.getRange(1, 1, last, 1).getValues();

  for (let i = 0; i < columnA.length; i++) {
    if (String(columnA[i][0]).trim().toLowerCase() === "month") {
      return i + 1;
    }
  }

  return null;
}


// Columns found by header label, as google-api's receipts do: positions differ between tabs.
function getLayout(sheet) {
  const name = sheet.getName();
  const headerRow = findHeaderRow(sheet);

  if (!headerRow) {
    throw new Error(`No "Month" header was found in column A of ${name}.`);
  }

  const headers =
    sheet
      .getRange(headerRow, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(header => String(header).trim().toLowerCase());

  const find = label => {
    const index = headers.indexOf(label);
    return index === -1 ? null : index + 1;
  };

  const cols = {
    month: find("month"),
    rent: find("rent amount"),
    status: find("status"),
    units: find("units used"),
    elec: find("electricity charge"),
    water: find("water bill"),
    totalDue: find("total due"),
    totalPaid: find("total paid"),
    paidDate: find("paid date"),
    notes: find("notes")
  };

  const missing = [
    ["Units Used", cols.units],
    ["Total Paid", cols.totalPaid],
    ["Paid Date", cols.paidDate],
    ["Notes", cols.notes]
  ]
    .filter(([, col]) => !col)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(`${name} has no ${missing.join(", ")} column.`);
  }

  return { headerRow, cols };
}


// Some tabs had their header labels edited without the columns moving underneath. Status
// checks the real Paid Date column, so a mismatch means the headers can't be trusted.
function checkStatusFormula(sheet, layout, row) {
  if (!layout.cols.status) {
    return;
  }

  const formula = sheet.getRange(row, layout.cols.status).getFormula();
  const match = formula.match(/\$([A-Z]+)\d+<>""/);

  if (!match) {
    return;
  }

  if (columnLetterToIndex(match[1]) !== layout.cols.paidDate) {
    throw new Error(
      `The headers on ${sheet.getName()} don't match its formulas: Status checks column ` +
      `${match[1]}, but "Paid Date" is column ${columnIndexToLetter(layout.cols.paidDate)}. ` +
      "Fix the tab before saving from WhatsApp."
    );
  }
}


function columnLetterToIndex(letters) {
  let index = 0;

  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }

  return index;
}


function columnIndexToLetter(index) {
  let letters = "";
  let n = index;

  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }

  return letters;
}


// ============================================================
// FIND A MONTH
// ============================================================

function findMonthRow(sheet, layout, monthKey) {
  const firstRow = layout.headerRow + 1;
  const lastRow = sheet.getLastRow();

  if (lastRow < firstRow) {
    return null;
  }

  const dates =
    sheet
      .getRange(firstRow, layout.cols.month, lastRow - firstRow + 1, 1)
      .getValues();

  const timezone = getTimezone();

  for (let i = 0; i < dates.length; i++) {
    const value = dates[i][0];

    if (!(value instanceof Date)) {
      continue;
    }

    if (Utilities.formatDate(value, timezone, "yyyy-MM") === monthKey) {
      return firstRow + i;
    }
  }

  return null;
}


// Reads the sheet's own computed Rent Amount for the session's month, to show alongside
// the "how much was paid?" prompt. Returns null instead of throwing if anything is missing.
function getRentAmountHint(session) {
  try {
    const sheet = getSpreadsheet().getSheetByName(session.sheetName);

    if (!sheet) {
      return null;
    }

    const layout = getLayout(sheet);
    const row = findMonthRow(sheet, layout, session.monthKey);

    if (!row || !layout.cols.rent) {
      return null;
    }

    return sheet.getRange(row, layout.cols.rent).getDisplayValue() || null;
  } catch (error) {
    return null;
  }
}


// ============================================================
// EXISTING DATA CHECK
// ============================================================

function readExistingEntry(sheet, layout, row) {
  const cols = layout.cols;

  const display = col =>
    col ? sheet.getRange(row, col).getDisplayValue() : "";

  const electricity = display(cols.units);
  const water = display(cols.water);
  const totalPaid = display(cols.totalPaid);
  const paidDate = display(cols.paidDate);
  const notes = display(cols.notes);

  const totalPaidValue = sheet.getRange(row, cols.totalPaid).getValue();
  const paidDateValue = sheet.getRange(row, cols.paidDate).getValue();

  return {
    electricity,
    water,
    totalPaid,
    paidDate,
    notes,

    // 0 when blank; null when it holds something that isn't a number.
    totalPaidAmount:
      typeof totalPaidValue === "number"
        ? totalPaidValue
        : totalPaidValue === ""
          ? 0
          : null,

    // "yyyy-MM-dd" for a real date; null when blank or text.
    paidDateKey:
      paidDateValue instanceof Date
        ? Utilities.formatDate(paidDateValue, getTimezone(), "yyyy-MM-dd")
        : null,

    snapshot: JSON.stringify([electricity, water, totalPaid, paidDate, notes]),

    hasData:
      electricity !== "" ||
      water !== "" ||
      totalPaid !== "" ||
      paidDate !== "" ||
      notes !== ""
  };
}


// ============================================================
// TENANTS
// ============================================================

function getTenantSheetNames() {
  return getSpreadsheet()
    .getSheets()
    .map(sheet => sheet.getName())
    .filter(
      name =>
        !CONFIG.EXCLUDED_SHEETS.includes(name)
    );
}


function resolveTenant(message, tenants) {
  const number = Number(message);

  // Numeric selection
  if (
    Number.isInteger(number) &&
    number >= 1 &&
    number <= tenants.length
  ) {
    return tenants[number - 1];
  }

  // Exact name selection
  const normalised =
    message.trim().toLowerCase();

  return (
    tenants.find(
      tenant =>
        tenant.toLowerCase() === normalised
    ) || null
  );
}


function buildHintMessage() {
  const mode = isDryRunActive()
    ? "DRY RUN (nothing is saved to the sheet)"
    : "LIVE (entries are saved to the sheet)";

  return [
    "How this bot works:",
    "Send rent.start to log a tenant's electricity, water, and payment. You'll pick the tenant (if there's more than one) and the month (previous, current, or next), then I'll ask a few questions one at a time, show you a summary, and only save after you confirm.",
    "A payment is added to what's already recorded for that month. Receipts you ask for are emailed within about 5 minutes.",
    "",
    `Mode: ${mode}`,
    "",
    "Commands:",
    "rent.start - begin a new monthly entry",
    "rent.cancel - abort the entry in progress",
    "rent.status - show what's been entered so far",
    "hint - show this message",
    "rentcheck-safe-mode-on - switch to dry run (nothing saved)",
    "rentcheck-safe-mode-off - switch to live (entries saved)"
  ].join("\n");
}


function buildTenantListMessage(intro, tenants) {
  const choices =
    tenants
      .map(
        (tenant, index) =>
          `${index + 1}. ${tenant}`
      )
      .join("\n");

  return `${intro}\n\n${choices}`;
}


// ============================================================
// CONFIRMATION
// ============================================================

function describeNotes(session) {
  if (session.notes === null || session.notes === undefined) {
    return session.hasExistingNotes ? "(unchanged)" : "-";
  }

  return session.notes || "-";
}


function buildConfirmationMessage(session) {
  const lines = [
    "Please confirm:",
    "",
    `Tenant: ${session.sheetName}`,
    `Month: ${session.month}`,
    `Electricity units: ${session.electricityUnits}`
  ];

  if (session.hasWater) {
    lines.push(`Water bill: ${session.waterBill}`);
  }

  if (session.paid) {
    lines.push(
      `Payment received: ${formatRupees(session.amountPaid)} on ${formatDateKey(session.paidDate)}`
    );

    if (session.existingTotalPaid > 0) {
      lines.push(
        `Total paid after saving: ${formatRupees(
          addAmounts(session.existingTotalPaid, session.amountPaid)
        )}`
      );
    }
  } else if (session.existingTotalPaid > 0) {
    lines.push(
      `New payment: none (${formatRupees(session.existingTotalPaid)} already recorded is kept)`
    );
  } else {
    lines.push("Rent paid: No");
  }

  lines.push(
    `Notes: ${describeNotes(session)}`,
    `Email PDF: ${session.emailPdf ? "Yes" : "No"}`,
    "",
    "Save this entry?",
    "Reply yes or no."
  );

  return lines.join("\n");
}


function buildSavedMessage(session, result) {
  if (result.dryRun) {
    return [
      "DRY RUN complete.",
      "",
      "Nothing was written to the sheet.",
      "",
      `Tenant: ${session.sheetName}`,
      `Month: ${session.month}`,
      `Electricity: ${session.electricityUnits}`,
      `Water: ${session.hasWater ? session.waterBill : "-"}`,
      `Payment added: ${session.paid ? formatRupees(session.amountPaid) : "-"}`,
      `Email PDF: ${session.emailPdf ? "Yes" : "No"}`,
      "",
      "Send rentcheck-safe-mode-off to switch to live writes."
    ].join("\n");
  }

  const lines = [
    "Saved successfully.",
    "",
    `Tenant: ${session.sheetName}`,
    `Month: ${session.month}`,
    `Electricity charge: ${result.electricityCharge}`,
    `Total due: ${result.totalDue}`,
    `Status: ${result.status}`
  ];

  if (result.receipt) {
    lines.push(
      "",
      result.receipt.queued
        ? "Receipt: queued, it will be emailed within about 5 minutes."
        : `Receipt: couldn't be queued (${result.receipt.error}). ` +
          "Tick the Email Trigger box on the row to send it."
    );
  }

  return lines.join("\n");
}


// ============================================================
// STATUS
// ============================================================

function getCurrentStatus(phone) {
  const session = getSession(phone);

  if (!session || isSessionExpired(session)) {
    return "No rent entry is currently in progress.";
  }

  return [
    "Current entry:",
    "",
    `Tenant: ${session.sheetName || "-"}`,
    `Month: ${session.month || "-"}`,
    `Electricity: ${session.electricityUnits ?? "-"}`,
    `Water: ${session.waterBill ?? "-"}`,
    `Payment received: ${
      session.paid === undefined
        ? "-"
        : session.paid
          ? "Yes"
          : "No"
    }`,
    `Amount paid: ${session.amountPaid ?? "-"}`,
    `Current question: ${session.step}`
  ].join("\n");
}


// ============================================================
// SESSION STORAGE
// ============================================================

function saveSession(phone, session) {
  session.updatedAt = Date.now();

  PropertiesService
    .getScriptProperties()
    .setProperty(
      getSessionKey(phone),
      JSON.stringify(session)
    );
}


function getSession(phone) {
  const value = getScriptProperty(getSessionKey(phone));

  return value
    ? JSON.parse(value)
    : null;
}


function isSessionExpired(session) {
  return (
    typeof session.updatedAt !== "number" ||
    Date.now() - session.updatedAt > CONFIG.SESSION_TTL_MINUTES * 60 * 1000
  );
}


function deleteSession(phone) {
  PropertiesService
    .getScriptProperties()
    .deleteProperty(
      getSessionKey(phone)
    );
}


function getSessionKey(phone) {
  return `rent_session_${phone}`;
}


// ============================================================
// INPUT PARSING
// ============================================================

// A non-negative number, or null. Accepts plain digits or comma grouping (17,000 or
// 1,00,000) with an optional ₹, Rs or $ prefix. "1,5" is rejected rather than read as 15.
function parseNumber(value, maxDecimals) {
  const cleaned =
    String(value)
      .trim()
      .replace(/^(₹|rs\.?|inr|\$)\s*/i, "")
      .replace(/\s+/g, "");

  const match = cleaned.match(/^(\d+|\d{1,3}(?:,\d{2,3})+)(?:\.(\d+))?$/);

  if (!match) {
    return null;
  }

  if (maxDecimals !== undefined && match[2] && match[2].length > maxDecimals) {
    return null;
  }

  const number = Number(cleaned.replace(/,/g, ""));

  return Number.isFinite(number) ? number : null;
}


function parseYesNo(value) {
  const answer =
    String(value)
      .trim()
      .toLowerCase();

  const yes = [
    "yes",
    "y",
    "yep",
    "yeah",
    "paid"
  ];

  const no = [
    "no",
    "n",
    "nope",
    "unpaid",
    "not paid"
  ];

  if (yes.includes(answer)) {
    return true;
  }

  if (no.includes(answer)) {
    return false;
  }

  return null;
}


// "yyyy-MM-dd" for today, DD/MM/YYYY, DD-MM-YYYY or YYYY-MM-DD; null otherwise. Dates stay
// strings until they're written, so the script's and the sheet's time zones can't shift them.
function parseDate(value) {
  const input =
    String(value)
      .trim()
      .toLowerCase();

  if (input === "today") {
    return getTodayKey();
  }

  // DD/MM/YYYY or DD-MM-YYYY
  let match =
    input.match(
      /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/
    );

  if (match) {
    return toDateKey(
      Number(match[3]),
      Number(match[2]),
      Number(match[1])
    );
  }

  // YYYY-MM-DD
  match =
    input.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})$/
    );

  if (match) {
    return toDateKey(
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );
  }

  return null;
}


function toDateKey(year, month, day) {
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(year, month, 0).getDate();

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}


function pad2(number) {
  return String(number).padStart(2, "0");
}


// ============================================================
// MONEY
// ============================================================

// Added as whole paise, so 0.1 + 0.2 doesn't leave a stray balance.
function addAmounts(a, b) {
  return (Math.round(a * 100) + Math.round(b * 100)) / 100;
}


function formatRupees(amount) {
  return "₹" + Number(amount).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}


// ============================================================
// DATE HELPERS
// ============================================================

function getTimezone() {
  return (
    getSpreadsheet()
      .getSpreadsheetTimeZone() ||
    Session.getScriptTimeZone()
  );
}


// Today as "yyyy-MM-dd" in the SPREADSHEET's time zone (which can differ from the script's).
function getTodayKey() {
  return Utilities.formatDate(new Date(), getTimezone(), "yyyy-MM-dd");
}


// "yyyy-MM" for this month plus `offset` months, counted from today in the sheet's time zone.
function getMonthKeyFromToday(offset) {
  const [year, month] = getTodayKey().split("-").map(Number);
  const date = new Date(year, month - 1 + offset, 1);

  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}


// Built and formatted in the script's own time zone, so the label can't drift to a
// neighbouring month or day.
function formatMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);

  return Utilities.formatDate(
    new Date(year, month - 1, 15),
    Session.getScriptTimeZone(),
    "MMMM yyyy"
  );
}


function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return Utilities.formatDate(
    new Date(year, month - 1, day),
    Session.getScriptTimeZone(),
    "dd MMM yyyy"
  );
}


// ============================================================
// MANUAL TESTS (run from the editor)
// ============================================================

// Tests never touch the live sheet: they run against the copy in TEST_SPREADSHEET_ID.
function withTestSpreadsheet(run) {
  const id = getScriptProperty("TEST_SPREADSHEET_ID");

  if (!id) {
    throw new Error(
      "Set the TEST_SPREADSHEET_ID Script Property to a copy of the spreadsheet first."
    );
  }

  if (id === getLiveSpreadsheetId()) {
    throw new Error("TEST_SPREADSHEET_ID must be a copy, not the live spreadsheet.");
  }

  spreadsheetIdOverride = id;
  openedSpreadsheet = null;

  try {
    return run();
  } finally {
    spreadsheetIdOverride = null;
    openedSpreadsheet = null;
  }
}


function testMessage() {
  withTestSpreadsheet(() => {
    try {
      Logger.log(handleMessage("test-user", "rent.start"));
    } finally {
      deleteSession("test-user");
    }
  });
}


// Confirms Script Properties are set correctly.
// Do not log the actual access token.
function testWhatsAppConfig() {
  const config = getWhatsAppConfig();

  Logger.log(
    "Phone Number ID: " +
    config.phoneNumberId
  );

  Logger.log(
    "Graph version: " +
    config.graphVersion
  );

  Logger.log(
    "Access token exists: " +
    !!config.accessToken
  );

  Logger.log(
    "Verify token exists: " +
    !!config.verifyToken
  );

  Logger.log(
    "Spreadsheet ID exists: " +
    !!getLiveSpreadsheetId()
  );

  Logger.log(
    "Webhook secret exists: " +
    !!getScriptProperty("WA_WEBHOOK_SECRET")
  );

  Logger.log(
    "Allowed numbers: " +
    getScriptProperty("WA_ALLOWED_NUMBERS").split(",").filter(Boolean).length
  );
}


// Exercises the overwrite-confirmation flow end-to-end on the test copy.
// Plants a marker value only if the current month row is empty,
// and restores the original value afterwards either way.
function testOverwriteProtection() {
  withTestSpreadsheet(() => {
    const phone = "test-overwrite-user";
    deleteSession(phone);

    const tenants = getTenantSheetNames();

    if (tenants.length === 0) {
      Logger.log("No tenant sheets found.");
      return;
    }

    const sheetName = tenants[0];
    const sheet = getSpreadsheet().getSheetByName(sheetName);
    const layout = getLayout(sheet);
    const row = findMonthRow(sheet, layout, getMonthKeyFromToday(0));

    if (!row) {
      Logger.log("Could not find the current month row for " + sheetName);
      return;
    }

    const notesCell = sheet.getRange(row, layout.cols.notes);
    const originalNotes = notesCell.getValue();
    const existingBefore = readExistingEntry(sheet, layout, row);
    let plantedMarker = false;

    if (!existingBefore.hasData) {
      notesCell.setValue("TEST-OVERWRITE-MARKER");
      plantedMarker = true;
    }

    try {
      Logger.log("--- rent.start ---");
      Logger.log(handleMessage(phone, "rent.start"));

      if (tenants.length > 1) {
        Logger.log("--- select tenant ---");
        Logger.log(handleMessage(phone, sheetName));
      }

      Logger.log("--- select month (2 = current) ---");
      Logger.log(handleMessage(phone, "2"));

      Logger.log("--- reply 'no' (should cancel, not overwrite) ---");
      Logger.log(handleMessage(phone, "no"));

      Logger.log("--- rent.status after 'no' (should say nothing in progress) ---");
      Logger.log(handleMessage(phone, "rent.status"));

      Logger.log("--- rent.start again ---");
      Logger.log(handleMessage(phone, "rent.start"));

      if (tenants.length > 1) {
        Logger.log("--- select tenant ---");
        Logger.log(handleMessage(phone, sheetName));
      }

      Logger.log("--- select month (2 = current) ---");
      Logger.log(handleMessage(phone, "2"));

      Logger.log("--- reply 'yes' (should proceed to electricity units) ---");
      Logger.log(handleMessage(phone, "yes"));

    } finally {
      deleteSession(phone);

      if (plantedMarker) {
        notesCell.setValue(originalNotes);
      }
    }
  });
}
