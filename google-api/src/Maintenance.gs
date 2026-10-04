/* =========================================================================
 * ONE-TIME MIGRATION: roll the test tab's column layout (Total Paid +
 * Overdue Amount, with carry-forward into next month's Total Due) out to
 * every other tenant tab.
 *
 * BEFORE RUNNING: File > Make a copy of the whole spreadsheet first. This
 * inserts columns and rewrites Total Due formulas on live data — not
 * something you want to be guessing about after the fact.
 *
 * HOW TO USE (from the Apps Script editor, function dropdown at the top):
 *   1. Run `previewMigration` first. Nothing on the sheet changes — it only
 *      writes a plan to the Email Log tab (what would be inserted, which
 *      Total Due cells would be updated, which ones would be SKIPPED
 *      because they're a hardcoded number instead of a formula).
 *   2. Read the Email Log. If a row says a Total Due cell was skipped
 *      because it's hardcoded, decide by hand whether that tenant's row
 *      needs the carry-forward term added manually.
 *   3. Run `runMigration` to actually apply it.
 *
 * Safe to re-run: any tab that already has a "Total Paid" header is left
 * alone (logged as SKIP, already migrated), and the Total Due carry-forward
 * term is only appended to a formula once (checked before adding).
 * ========================================================================= */

function previewMigration() { migrateSheetsToNewFormat_(true); }
function runMigration()     { migrateSheetsToNewFormat_(false); }

function migrateSheetsToNewFormat_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  sheets.forEach(function (sheet) {
    const sheetName = sheet.getName();
    if (CONFIG.skipSheets.indexOf(sheetName) !== -1) return;

    try {
      migrateOneSheet_(sheet, sheetName, dryRun);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      console.error('[TenantTracker][Migration] FAILED on "' + sheetName + '": ' + msg);
      logEvent_(sheetName, '-', 'ERROR', 'Migration failed: ' + msg + '. No partial changes assumed safe — re-check this tab by hand.');
    }
  });

  logEvent_('-', '-', 'INFO', (dryRun ? 'DRY RUN' : 'LIVE') + ' migration pass complete. See rows above for per-sheet detail.');
}

function migrateOneSheet_(sheet, sheetName, dryRun) {
  const headerRow = findHeaderRow_(sheet);
  if (!headerRow) {
    logEvent_(sheetName, '-', 'SKIP', 'Migration: no header row found (looked for "Month" in col A, rows 1-30).');
    return;
  }

  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = function (label) {
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === label) return c + 1;
    }
    return null;
  };

  if (findCol('total paid')) {
    logEvent_(sheetName, '-', 'SKIP', 'Migration: already has a "Total Paid" column — assumed already migrated.');
    return;
  }

  const paidDateCol = findCol('paid date');
  const notesCol = findCol('notes');
  const totalDueCol = findCol('total due');
  if (!paidDateCol || !notesCol || !totalDueCol) {
    logEvent_(sheetName, '-', 'SKIP', 'Migration: missing one of "Paid Date" / "Notes" / "Total Due" headers — layout too different to auto-migrate, do this tab by hand.');
    return;
  }

  const lastRow = sheet.getLastRow();
  const dataRows = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    if (sheet.getRange(r, 1).getValue() instanceof Date) dataRows.push(r);
  }
  if (dataRows.length === 0) {
    logEvent_(sheetName, '-', 'SKIP', 'Migration: no data rows found under the header (col A has no dates).');
    return;
  }

  if (dryRun) {
    logEvent_(sheetName, '-', 'DRY_RUN',
      'Would insert "Total Paid" before column ' + colLetter_(paidDateCol) + ' (Paid Date), ' +
      'append "Overdue Amount" as a new last column, and add carry-forward to Total Due (col ' +
      colLetter_(totalDueCol) + ') on ' + (dataRows.length - 1) + ' row(s) (all but the first).');
    dataRows.slice(1).forEach(function (r) {
      const f = sheet.getRange(r, totalDueCol).getFormula();
      if (!f) {
        logEvent_(sheetName, r, 'DRY_RUN', 'Total Due in this row is a hardcoded value, not a formula — carry-forward would be SKIPPED here. Review by hand.');
      }
    });
    return;
  }

  // ---- 1. insert "Total Paid" right before Paid Date ----
  sheet.insertColumnBefore(paidDateCol);
  const totalPaidCol = paidDateCol; // old Paid Date index is now Total Paid's index
  const headerCell = sheet.getRange(headerRow, totalPaidCol);
  headerCell.setValue('Total Paid');
  // copy header styling from the neighboring Total Due header so it matches
  sheet.getRange(headerRow, totalDueCol).copyFormatToRange(sheet, totalPaidCol, totalPaidCol, headerRow, headerRow);
  sheet.setColumnWidth(totalPaidCol, sheet.getColumnWidth(totalDueCol));

  // ---- 2. append "Overdue Amount" as the new last column ----
  const overdueCol = sheet.getLastColumn() + 1;
  const overdueHeaderCell = sheet.getRange(headerRow, overdueCol);
  overdueHeaderCell.setValue('Overdue Amount');
  sheet.getRange(headerRow, totalDueCol).copyFormatToRange(sheet, overdueCol, overdueCol, headerRow, headerRow);
  sheet.setColumnWidth(overdueCol, sheet.getColumnWidth(totalDueCol));

  const totalDueLetter = colLetter_(totalDueCol);
  const totalPaidLetter = colLetter_(totalPaidCol);
  const overdueLetter = colLetter_(overdueCol);

  let carryForwardApplied = 0;
  let carryForwardSkipped = 0;

  dataRows.forEach(function (r, i) {
    // Overdue Amount = Total Due - Total Paid (blank Total Paid reads as 0, so an
    // unpaid month's Overdue Amount naturally equals the full Total Due).
    sheet.getRange(r, overdueCol).setFormula('=SUM(' + totalDueLetter + r + '-' + totalPaidLetter + r + ')');

    if (i === 0) return; // first data row has no prior month to carry forward from

    const totalDueCell = sheet.getRange(r, totalDueCol);
    const existingFormula = totalDueCell.getFormula();
    if (!existingFormula) {
      carryForwardSkipped++;
      logEvent_(sheetName, r, 'WARN', 'Total Due is a hardcoded value here, not a formula — carry-forward was NOT added. Add manually if this month should include last month\'s overdue.');
      return;
    }
    const prevOverdueRef = '$' + overdueLetter + (r - 1);
    if (existingFormula.indexOf(prevOverdueRef) !== -1) return; // already carries forward (re-run safety)

    totalDueCell.setFormula(existingFormula + '+IF(' + prevOverdueRef + '="",0,' + prevOverdueRef + ')');
    carryForwardApplied++;
  });

  logEvent_(sheetName, '-', 'MIGRATED',
    'Inserted Total Paid (col ' + totalPaidLetter + ') and Overdue Amount (col ' + overdueLetter + '). ' +
    'Carry-forward added to ' + carryForwardApplied + ' row(s), skipped on ' + carryForwardSkipped + ' hardcoded row(s).');
}

function colLetter_(colIndex) {
  let s = '';
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* =========================================================================
 * DIAGNOSTIC: some tabs got their header row (row 10) hand-edited to the new
 * "Total Paid / Paid Date / Notes / Email Trigger / Overdue Amount" label
 * text WITHOUT the underlying columns actually being inserted — so the data
 * below never moved, and the header labels no longer point at what they say
 * they do. This tricked the migration's "already migrated" guard into
 * skipping those tabs entirely (see runMigration's SKIP log).
 *
 * This is READ-ONLY. It never writes anything to the sheet. For each tenant
 * tab it reads the Status column's formula (never touched by any of this,
 * so `$X11<>""` in it still points at the REAL Paid Date column) and
 * compares that against what the header row currently claims is at that
 * column and the one after it. Run this and share the Email Log output
 * before anything gets repaired — the actual repair needs to see this
 * report first, since some tabs genuinely have a Water Bill column and
 * some never did, and guessing wrong risks mislabeling a column that's
 * actually fine.
 * ========================================================================= */
function diagnoseHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sheet) {
    const sheetName = sheet.getName();
    if (CONFIG.skipSheets.indexOf(sheetName) !== -1) return;
    try {
      diagnoseOneSheetHeaders_(sheet, sheetName);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      logEvent_(sheetName, '-', 'ERROR', 'Header diagnosis failed: ' + msg);
    }
  });
  logEvent_('-', '-', 'INFO', 'Header diagnosis complete (read-only, nothing was changed).');
}

function diagnoseOneSheetHeaders_(sheet, sheetName) {
  const headerRow = findHeaderRow_(sheet);
  if (!headerRow) {
    logEvent_(sheetName, '-', 'SKIP', 'Diagnose: no header row found.');
    return;
  }

  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = function (label) {
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === label) return c + 1;
    }
    return null;
  };

  const statusCol = findCol('status');
  const totalDueCol = findCol('total due');
  if (!statusCol) {
    logEvent_(sheetName, '-', 'SKIP', 'Diagnose: no "Status" column header found.');
    return;
  }

  const firstDataRow = headerRow + 1;
  const statusFormula = sheet.getRange(firstDataRow, statusCol).getFormula();
  const match = statusFormula.match(/\$([A-Z]+)\d+<>""/);
  if (!match) {
    logEvent_(sheetName, '-', 'INFO', 'Diagnose: Status formula on row ' + firstDataRow + ' does not match the expected pattern (may already be fine, or structured differently). Formula: ' + statusFormula);
    return;
  }

  const truePaidDateLetter = match[1];
  const currentLabelAtTruePaidDate = String(headers[columnLetterToIndex_(truePaidDateLetter) - 1] || '').trim();

  // Report every header label from Total Due onward, so we can see exactly what
  // text is sitting where, real or leftover, without me guessing at the layout.
  const labelDump = [];
  const startCol = totalDueCol || 1;
  for (let c = startCol; c <= headers.length; c++) {
    const label = String(headers[c - 1] || '').trim();
    if (label) labelDump.push(colLetter_(c) + '=\"' + label + '\"');
  }

  const mismatch = currentLabelAtTruePaidDate.toLowerCase() !== 'paid date';
  logEvent_(sheetName, firstDataRow,
    mismatch ? 'MISMATCH' : 'OK',
    'Status formula says the REAL Paid Date column is ' + truePaidDateLetter +
    ' (current header there: "' + currentLabelAtTruePaidDate + '"). ' +
    'Full header row from Total Due onward: ' + labelDump.join(', '));
}

function columnLetterToIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

/* =========================================================================
 * REPAIR: after the header row was hand-edited into the new layout without
 * a real migration underneath, the columns/labels are now correct on every
 * tab, but the FORMULAS in Status / Overdue Amount / Total Due are still
 * wrong or missing on most rows (see diagnoseHeaders' findings — this fixes
 * what that only reported). Per data row, on every tenant tab:
 *
 *   - Rewrites Status to check the *actual* Paid Date column (found by
 *     header label, not assumed) instead of whatever it currently checks.
 *   - Rewrites Overdue Amount to `=SUM(<TotalDue row>-<TotalPaid row>)`
 *     referencing ITS OWN row (fixes rows that got stuck referencing an
 *     earlier row after a bad copy/fill-down).
 *   - Appends the carry-forward term onto Total Due (adds the previous
 *     row's Overdue Amount) on every row except the first, if it's not
 *     already there.
 *   - Does NOT touch Paid Date values that are text instead of a real date
 *     — those get logged as a WARN for you to fix by hand instead of me
 *     guessing at date parsing.
 *
 * Idempotent: a formula is only rewritten if it doesn't already match what
 * it should be, so re-running this is harmless.
 *
 * HOW TO USE: run `previewFormulaRepair` first (writes a per-sheet summary
 * to Email Log, changes nothing), then `runFormulaRepair` to actually apply.
 * ========================================================================= */

function previewFormulaRepair() { repairFormulas_(true); }
function runFormulaRepair()     { repairFormulas_(false); }

function repairFormulas_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(function (sheet) {
    const sheetName = sheet.getName();
    if (CONFIG.skipSheets.indexOf(sheetName) !== -1) return;
    try {
      repairOneSheetFormulas_(sheet, sheetName, dryRun);
    } catch (err) {
      const msg = (err && err.message) ? err.message : String(err);
      console.error('[TenantTracker][Repair] FAILED on "' + sheetName + '": ' + msg);
      logEvent_(sheetName, '-', 'ERROR', 'Formula repair failed: ' + msg);
    }
  });
  logEvent_('-', '-', 'INFO', (dryRun ? 'DRY RUN' : 'LIVE') + ' formula repair pass complete. See rows above for per-sheet detail.');
}

function repairOneSheetFormulas_(sheet, sheetName, dryRun) {
  const headerRow = findHeaderRow_(sheet);
  if (!headerRow) {
    logEvent_(sheetName, '-', 'SKIP', 'Repair: no header row found.');
    return;
  }

  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  const findCol = function (label) {
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === label) return c + 1;
    }
    return null;
  };

  const statusCol = findCol('status');
  const paidDateCol = findCol('paid date');
  const totalDueCol = findCol('total due');
  const totalPaidCol = findCol('total paid');
  const overdueCol = findCol('overdue amount');

  if (!statusCol || !paidDateCol || !totalDueCol || !totalPaidCol || !overdueCol) {
    logEvent_(sheetName, '-', 'SKIP', 'Repair: missing one of Status/Paid Date/Total Due/Total Paid/Overdue Amount headers — not on the new layout yet.');
    return;
  }

  const paidDateLetter = colLetter_(paidDateCol);
  const totalDueLetter = colLetter_(totalDueCol);
  const totalPaidLetter = colLetter_(totalPaidCol);
  const overdueLetter = colLetter_(overdueCol);

  const lastRow = sheet.getLastRow();
  const dataRows = [];
  for (let r = headerRow + 1; r <= lastRow; r++) {
    if (sheet.getRange(r, 1).getValue() instanceof Date) dataRows.push(r);
  }
  if (dataRows.length === 0) {
    logEvent_(sheetName, '-', 'SKIP', 'Repair: no data rows found under the header.');
    return;
  }

  let statusFixed = 0, overdueFixed = 0, carryFixed = 0, dateTextFlagged = 0;

  dataRows.forEach(function (r, i) {
    const wantStatus = '=IF($' + paidDateLetter + r + '<>"","Paid",' +
      'IF(TODAY()>DATE(YEAR($A' + r + '),MONTH($A' + r + '),' +
      'MIN($C$5,DAY(EOMONTH($A' + r + ',0)))),"Overdue","Unpaid"))';
    const statusCell = sheet.getRange(r, statusCol);
    if (statusCell.getFormula() !== wantStatus) {
      if (!dryRun) statusCell.setFormula(wantStatus);
      statusFixed++;
    }

    const wantOverdue = '=SUM(' + totalDueLetter + r + '-' + totalPaidLetter + r + ')';
    const overdueCell = sheet.getRange(r, overdueCol);
    if (overdueCell.getFormula() !== wantOverdue) {
      if (!dryRun) overdueCell.setFormula(wantOverdue);
      overdueFixed++;
    }

    if (i > 0) {
      const totalDueCell = sheet.getRange(r, totalDueCol);
      const existingFormula = totalDueCell.getFormula();
      const prevOverdueRef = '$' + overdueLetter + (r - 1);
      if (existingFormula && existingFormula.indexOf(prevOverdueRef) === -1) {
        if (!dryRun) totalDueCell.setFormula(existingFormula + '+IF(' + prevOverdueRef + '="",0,' + prevOverdueRef + ')');
        carryFixed++;
      }
    }

    const paidDateVal = sheet.getRange(r, paidDateCol).getValue();
    if (paidDateVal && !(paidDateVal instanceof Date)) {
      dateTextFlagged++;
      logEvent_(sheetName, r, 'WARN', 'Paid Date is text ("' + paidDateVal + '"), not a real date — Status and the receipt email both expect an actual date here. Re-enter it by hand (or retype so Sheets recognizes it as a date) rather than having this auto-converted.');
    }
  });

  logEvent_(sheetName, '-', dryRun ? 'DRY_RUN' : 'REPAIRED',
    'Status fixed: ' + statusFixed + ', Overdue Amount fixed: ' + overdueFixed +
    ', Total Due carry-forward added: ' + carryFixed + ', text Paid Dates flagged: ' + dateTextFlagged + '.');
}
