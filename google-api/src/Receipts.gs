/**
 * TenantTracker – email a designed rent-receipt PDF to the owner(s) when a Paid Date is
 * entered, and log every paid<->unpaid transition to the execution log AND to a visible
 * "Email Log" sheet (so you don't have to open Apps Script > Executions to debug).
 *
 * Reads by header LABEL, not fixed cells (Paid Date is col H on most tabs but G on some
 * older tabs; Flat Number is F4 except on one tab where it's G4).
 *
 * Configuration lives in Config.gs (the only file that declares `CONFIG`); personal details
 * come from Script Properties. Logging helpers are in Logging.gs, one-off sheet maintenance
 * in Maintenance.gs. Apps Script shares one global scope across all of these files.
 *
 * Trigger: INSTALLABLE on-edit (not simple onEdit) – emailing needs auth.
 *   Extensions > Apps Script > Triggers (clock) > Add Trigger
 *     Function: onPaidDateEditV2 | Source: From spreadsheet | Type: On edit
 *
 * MANUAL FORCE-RESEND: check the box in the column immediately after "Notes" on any row
 * (that column's position is auto-detected per sheet — it's J on some tabs, I or K on
 * others, since Water Bill / Total Paid / Overdue Amount aren't the same across tabs) to
 * force a resend of that row's receipt, bypassing the "already emailed" guard. That column
 * needs actual checkboxes (select the cells > Insert > Checkbox, or Data > Data
 * validation > Checkbox) — a plain typed value won't behave the same way. The box
 * auto-unchecks itself once the resend completes. Logged as RESENT (not SENT) in the
 * Email Log so you can tell forced sends apart from normal ones.
 *
 * ---------------------------------------------------------------------------------
 * WHY "trigger shows success but no email" was happening
 * ---------------------------------------------------------------------------------
 * 1) MULTI-CELL EDITS WERE SILENTLY DROPPED (the main cause).
 *    onEdit(e) fires once per user action, and e.range covers EVERY cell touched —
 *    not just one. If you paste/drag-fill Paid Date into several rows at once, the
 *    old code only ever looked at e.range.getRow()/getColumn() (the top-left cell of
 *    the whole pasted block) and returned immediately for everything else. The
 *    function completes normally (so the Executions log shows "Completed", i.e.
 *    "success"), but most/all of the pasted rows never got processed.
 *    FIX: we now iterate every row that intersects the edited range AND the Paid
 *    Date column, and process each one independently.
 *
 * 2) SILENT EARLY RETURNS with no trace anywhere (wrong sheet, no header row found,
 *    lock timeout, already-sent guard, empty recipient list, etc.) — you'd have to
 *    dig through Stackdriver logs to know which branch fired.
 *    FIX: every return path now logs a reason to both console.log and the Email Log
 *    sheet.
 *
 * 3) NO try/catch around the actual send — a real error (Gmail daily quota hit,
 *    malformed HTML->PDF conversion, invalid address) does throw and does mark the
 *    execution "Failed", but nothing alerts you — you only see it if you happen to
 *    open Executions. FIX: wrapped in try/catch, logged to the sheet, and (optionally)
 *    emails you an alert so a failure doesn't go unnoticed.
 *
 * 4) No pre-flight validation: an empty/invalid recipient list, or MailApp quota
 *    already exhausted, used to fail deep inside sendEmail with a generic error.
 *    FIX: validated up front with a clear log message.
 * ---------------------------------------------------------------------------------
 */

/* =========================================================================
 * ENTRY POINT
 * ========================================================================= */

function onPaidDateEditV2(e) {
  if (!e || !e.range) {
    console.warn('[TenantTracker] onPaidDateEditV2 fired with no event/range — ignoring.')
    return
  }

  const sheet = e.range.getSheet()
  const sheetName = sheet.getName()

  if (CONFIG.skipSheets.indexOf(sheetName) !== -1) {
    console.log('[TenantTracker] Skipping "' + sheetName + '" (in skipSheets).')
    return
  }

  const headerRow = findHeaderRow_(sheet)
  if (!headerRow) {
    logEvent_(
      sheetName,
      '-',
      'SKIP',
      'No header row found (looked for a "Month" label in col A, rows 1-30). Check the sheet layout.',
    )
    return
  }

  const cols = mapColumns_(sheet, headerRow)
  if (!cols.paidDate) {
    logEvent_(
      sheetName,
      '-',
      'SKIP',
      'No "Paid Date" column header found on row ' + headerRow + '.',
    )
    return
  }

  const editStartRow = e.range.getRow()
  const editEndRow = e.range.getLastRow()
  const editStartCol = e.range.getColumn()
  const editEndCol = e.range.getLastColumn()

  // ---- manual force-resend checkbox (column right after Notes, position varies per sheet) ----
  const touchesResendCol = cols.resend && editStartCol <= cols.resend && cols.resend <= editEndCol
  if (touchesResendCol) {
    const resendRows = []
    for (let r = Math.max(editStartRow, headerRow + 1); r <= editEndRow; r++) resendRows.push(r)
    resendRows.forEach(function (row) {
      const flag = sheet.getRange(row, cols.resend).getValue()
      if (flag === true || String(flag).trim().toUpperCase() === 'TRUE') {
        processRow_(sheet, sheetName, cols, row, undefined, true) // force = true
        sheet.getRange(row, cols.resend).setValue(false) // reset checkbox — script-driven edits don't re-fire onEdit, safe
      }
    })
  }

  // ---- Paid Date column: normal flow ----
  const touchesPaidDateCol = editStartCol <= cols.paidDate && cols.paidDate <= editEndCol
  if (!touchesPaidDateCol) return // edit didn't touch Paid Date — nothing else to do

  const isSingleCell = e.range.getNumRows() === 1 && e.range.getNumColumns() === 1
  const rowsToProcess = []
  for (let r = Math.max(editStartRow, headerRow + 1); r <= editEndRow; r++) rowsToProcess.push(r)

  if (rowsToProcess.length > 1) {
    console.log(
      '[TenantTracker] Multi-row edit detected on "' +
        sheetName +
        '" (' +
        rowsToProcess.length +
        ' rows: ' +
        rowsToProcess[0] +
        '-' +
        rowsToProcess[rowsToProcess.length - 1] +
        "). Processing each row individually so pasted/filled dates aren't skipped.",
    )
  }

  rowsToProcess.forEach(function (row) {
    // oldValue is only meaningful for true single-cell edits; for pastes/fills we don't have it.
    const oldValue = isSingleCell ? e.oldValue : undefined
    processRow_(sheet, sheetName, cols, row, oldValue, false)
  })
}

/* =========================================================================
 * PER-ROW PROCESSING
 * ========================================================================= */
function processRow_(sheet, sheetName, cols, row, oldValue, force) {
  force = force === true
  const lock = LockService.getDocumentLock()
  if (!lock.tryLock(30000)) {
    logEvent_(
      sheetName,
      row,
      'SKIP',
      'Could not acquire document lock within 30s (concurrent edit?). Row was NOT processed — re-enter the Paid Date to retry.',
    )
    return
  }

  try {
    const props = PropertiesService.getDocumentProperties()
    const guardKey = sheetName + '!row' + row

    const nowPaid = sheet.getRange(row, cols.paidDate).getValue()
    const isPaid = !!nowPaid

    const monthVal = sheet.getRange(row, cols.month).getValue()
    const monthShort =
      monthVal instanceof Date
        ? Utilities.formatDate(monthVal, CONFIG.timezone, 'MMM yyyy')
        : String(monthVal)

    // ---- status transition log ----
    if (oldValue !== undefined) {
      const wasPaid = oldValue !== '' && oldValue != null
      if (wasPaid !== isPaid) {
        const from = wasPaid ? 'Paid' : 'Unpaid'
        const to = isPaid
          ? 'Paid'
          : cols.status
            ? String(sheet.getRange(row, cols.status).getValue())
            : 'Unpaid'
        console.log(
          '[TenantTracker] ' +
            sheetName +
            ' - row ' +
            row +
            ' - ' +
            monthShort +
            ' - ' +
            from +
            ' -> ' +
            to,
        )
      }
    }

    if (!isPaid && !force) {
      props.deleteProperty(guardKey)
      logEvent_(
        sheetName,
        row,
        'INFO',
        'Paid Date cleared for ' +
          monthShort +
          ' — guard reset, next date entered will email fresh.',
      )
      return
    }

    if (props.getProperty(guardKey) && !force) {
      logEvent_(
        sheetName,
        row,
        'SKIP',
        'Already emailed for this row (' +
          props.getProperty(guardKey) +
          '). Check the Resend box in column J to force a re-send.',
      )
      return
    }

    // ---- gather data (all label-based, position-independent) ----
    const tenantName = findLabelValue_(sheet, 'Name of Tenant') || sheetName
    const flatNumber = cleanNum_(findLabelValue_(sheet, 'Flat Number'))
    const mobile = findLabelValue_(sheet, 'Tenant Mobile Number')
    const email = findLabelValue_(sheet, 'Tenant Email')
    const deposit = findLabelValue_(sheet, 'Tenant Deposit Amount')
    const dueDay = findLabelValue_(sheet, 'Rent Due Day (of month)')
    const perUnit = findLabelValue_(sheet, 'Electricity Per Unit Cost')

    const rent = cols.rent ? sheet.getRange(row, cols.rent).getValue() : ''
    const units = cols.units ? sheet.getRange(row, cols.units).getValue() : ''
    const elec = cols.elec ? sheet.getRange(row, cols.elec).getValue() : ''
    const water = cols.water ? sheet.getRange(row, cols.water).getValue() : ''
    const total = cols.totalDue ? sheet.getRange(row, cols.totalDue).getValue() : ''
    const totalPaid = cols.totalPaid ? sheet.getRange(row, cols.totalPaid).getValue() : ''
    const overdueAmt = cols.overdue ? sheet.getRange(row, cols.overdue).getValue() : ''
    // Last month's leftover balance that got folded into THIS row's Total Due —
    // read straight off the row above's Overdue Amount cell (blank/header there just reads as 0).
    const lastMonthOverdue = cols.overdue ? sheet.getRange(row - 1, cols.overdue).getValue() : ''
    const rowNotes = cols.notes ? String(sheet.getRange(row, cols.notes).getValue()).trim() : ''

    const monthLabel =
      monthVal instanceof Date
        ? Utilities.formatDate(monthVal, CONFIG.timezone, 'MMMM yyyy')
        : String(monthVal)
    const monthCode =
      monthVal instanceof Date
        ? Utilities.formatDate(monthVal, CONFIG.timezone, 'yyyyMM')
        : 'XXXXXX'

    // Paid Date may be empty when this is a forced/checkbox send — fall back to today.
    const effectivePaidDate = nowPaid instanceof Date ? nowPaid : new Date()
    const paidLabel = Utilities.formatDate(effectivePaidDate, CONFIG.timezone, 'dd/MM/yyyy')

    const receiptDate = Utilities.formatDate(new Date(), CONFIG.timezone, 'dd/MM/yyyy')
    const receiptNo = 'RCP-' + (flatNumber || 'NA') + '-' + monthCode

    // ---- pre-flight validation (fail loud, before doing expensive work) ----
    const recipients = CONFIG.recipientEmails.filter(function (a) {
      return a && a.indexOf('@') !== -1
    })
    if (recipients.length === 0) {
      throw new Error(
        'No valid receipt recipients: set the RECIPIENT_EMAILS Script Property (comma-separated) and run checkConfig().',
      )
    }

    const remainingQuota = MailApp.getRemainingDailyQuota()
    if (remainingQuota <= 0) {
      throw new Error(
        'Gmail/MailApp daily sending quota is exhausted (0 remaining). Try again after quota reset (~midnight PT), or send from a Workspace account with a higher quota.',
      )
    }
    if (remainingQuota < 5) {
      console.warn('[TenantTracker] Low MailApp quota remaining: ' + remainingQuota)
    }

    let pdf
    try {
      const html = buildReceiptHtml_({
        receiptNo: receiptNo,
        receiptDate: receiptDate,
        issuer: CONFIG.issuer,
        tenantName: tenantName,
        flatNumber: flatNumber,
        mobile: mobile,
        email: email,
        deposit: deposit,
        billingMonth: monthLabel,
        dueDay: dueDay,
        paidDate: paidLabel,
        rent: rent,
        units: units,
        perUnit: perUnit,
        elec: elec,
        water: water,
        total: total,
        totalPaid: totalPaid,
        overdueAmount: overdueAmt,
        lastMonthOverdue: lastMonthOverdue,
        notes: rowNotes ? CONFIG.notes.concat([rowNotes]) : CONFIG.notes,
      })
      pdf = Utilities.newBlob(html, 'text/html', receiptNo + '.html')
        .getAs('application/pdf')
        .setName(receiptNo + '.pdf')
    } catch (pdfErr) {
      throw new Error('Failed to build/convert the receipt PDF: ' + pdfErr.message)
    }

    const mail = {
      subject: 'Rent Receipt - ' + tenantName + ' - Flat ' + flatNumber + ' - ' + monthLabel,
      body: [
        'Receipt for ' + tenantName + ', Flat ' + flatNumber + '.',
        '',
        'Month:        ' + monthLabel,
        'Amount Paid:  ' + inr_(total),
        'Paid Date:    ' + paidLabel,
        'Receipt No:   ' + receiptNo,
        '',
        'PDF attached.',
      ].join('\n'),
      attachments: [pdf],
    }
    if (CONFIG.useBcc) {
      mail.to = recipients[0]
      mail.bcc = recipients.slice(1).join(',')
    } else {
      mail.to = recipients.join(',')
    }

    // ---- dry-run switch: checked right before the actual send, after everything
    // else (validation, PDF build, mail object) has already run so you're testing
    // the real path minus the one irreversible step. ----
    if (CONFIG.dryRun) {
      console.log(
        '[TenantTracker] DRY RUN — would have emailed ' +
          receiptNo +
          ' to ' +
          recipients.join(', '),
      )
      logEvent_(
        sheetName,
        row,
        'DRY_RUN',
        receiptNo + ' -> ' + recipients.join(', ') + ' (not sent, dryRun=true)',
      )
      return // guard NOT set — a real send will still happen once dryRun is false
    }

    MailApp.sendEmail(mail)

    props.setProperty(guardKey, receiptNo + ' @ ' + new Date().toISOString())
    console.log(
      '[TenantTracker] emailed ' + receiptNo + ' to ' + recipients.length + ' recipient(s)',
    )
    logEvent_(
      sheetName,
      row,
      force ? 'RESENT' : 'SENT',
      receiptNo +
        ' -> ' +
        recipients.join(', ') +
        ' (quota remaining after send: ~' +
        (remainingQuota - 1) +
        ')',
    )
  } catch (err) {
    const msg = err && err.message ? err.message : String(err)
    console.error(
      '[TenantTracker] FAILED on ' +
        sheetName +
        ' row ' +
        row +
        ': ' +
        msg +
        (err && err.stack ? '\n' + err.stack : ''),
    )
    logEvent_(sheetName, row, 'ERROR', msg)
    notifyFailure_(sheetName, row, msg)
    // Not rethrown: one bad row in a multi-row paste shouldn't stop the rest from being tried.
  } finally {
    lock.releaseLock()
  }
}

/* ---------- sheet helpers ---------- */

function findHeaderRow_(sheet) {
  const last = Math.min(sheet.getLastRow(), 30)
  if (last < 1) return null
  const colA = sheet.getRange(1, 1, last, 1).getValues()
  for (let i = 0; i < colA.length; i++) {
    if (String(colA[i][0]).trim().toLowerCase() === 'month') return i + 1
  }
  return null
}

function mapColumns_(sheet, headerRow) {
  const headers = sheet.getRange(headerRow, 1, 1, sheet.getLastColumn()).getValues()[0]
  const find = function (label) {
    for (let c = 0; c < headers.length; c++) {
      if (String(headers[c]).trim().toLowerCase() === label) return c + 1
    }
    return null
  }
  const notesCol = find('notes')
  return {
    month: find('month'),
    rent: find('rent amount'),
    status: find('status'),
    units: find('units used'),
    elec: find('electricity charge'),
    water: find('water bill'),
    totalDue: find('total due'),
    paidDate: find('paid date'),
    notes: notesCol,
    totalPaid: find('total paid'),
    overdue: find('overdue amount'),
    // Force-resend checkbox has no header text on most tabs — it's always the
    // column immediately to the right of Notes.
    resend: notesCol ? notesCol + 1 : null,
  }
}

// First non-empty cell to the RIGHT of a label cell (handles F4 vs G4 for Flat Number).
function findLabelValue_(sheet, label) {
  const rows = Math.min(sheet.getLastRow(), 12)
  const cols = sheet.getLastColumn()
  if (rows < 1 || cols < 1) return null
  const grid = sheet.getRange(1, 1, rows, cols).getValues()
  const target = label.trim().toLowerCase()
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (String(grid[r][c]).trim().toLowerCase() === target) {
        for (let cc = c + 1; cc < cols; cc++) {
          const v = grid[r][cc]
          if (v !== '' && v !== null) return v
        }
      }
    }
  }
  return null
}

/* ---------- formatting helpers ---------- */

function isNum_(v) {
  return v !== '' && v !== null && v !== undefined && !isNaN(Number(v))
}
function money_(v) {
  return isNum_(v)
    ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''
}
function num_(v) {
  return isNum_(v)
    ? Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : String(v == null ? '' : v)
}
function inr_(v) {
  return isNum_(v)
    ? CONFIG.currency + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : String(v == null ? '' : v)
}
function cleanNum_(v) {
  return String(v == null ? '' : v).replace(/\.0$/, '')
}
function dueDayLabel_(v) {
  if (v == null || String(v).trim() === '') return '—'
  if (isNum_(v)) {
    const n = Number(v)
    const s = ['th', 'st', 'nd', 'rd'],
      m = n % 100
    return n + (s[(m - 20) % 10] || s[m] || s[0])
  }
  return String(v).trim()
}

/* ---------- receipt template ---------- */

function buildReceiptHtml_(d) {
  const C = CONFIG.currency

  // line items, built only from what exists
  const items = []
  if (isNum_(d.rent)) items.push(['Rent Amount', 'Monthly Rent', money_(d.rent)])
  if (isNum_(d.units)) items.push(['Electricity Units', 'Units Consumed', num_(d.units)])
  if (isNum_(d.perUnit)) items.push(['Electricity Per Unit', 'Rate per Unit', money_(d.perUnit)])
  if (isNum_(d.elec) && Number(d.elec) > 0) {
    const detail =
      isNum_(d.units) && isNum_(d.perUnit)
        ? num_(d.units) + ' Units × ' + C + num_(d.perUnit)
        : 'Electricity'
    items.push(['Electricity Charge', detail, money_(d.elec)])
  }
  if (isNum_(d.water) && Number(d.water) > 0)
    items.push(['Water Bill', 'Monthly Water Charges', money_(d.water)])

  const cellL = 'padding:6px 10px;border-bottom:1px solid #e5e5e5'
  const cellR = cellL + ';text-align:right'
  let itemRows = ''
  items.forEach(function (it, i) {
    itemRows +=
      '<tr><td style="' +
      cellL +
      '">' +
      (i + 1) +
      '</td>' +
      '<td style="' +
      cellL +
      '">' +
      it[0] +
      '</td>' +
      '<td style="' +
      cellL +
      ';color:#555">' +
      it[1] +
      '</td>' +
      '<td style="' +
      cellR +
      '">' +
      it[2] +
      '</td></tr>'
  })

  const tRow = function (label, val) {
    if (val == null || String(val).trim() === '') return ''
    return (
      '<tr><td style="color:#666;padding:2px 0" valign="top">' +
      label +
      '</td><td style="padding:2px 0">: ' +
      val +
      '</td></tr>'
    )
  }
  const box = function (label, val) {
    return (
      '<td width="33%" style="border:1px solid #ddd;padding:8px 12px" valign="top">' +
      '<div style="font-size:9px;color:#888;letter-spacing:1px">' +
      label +
      '</div>' +
      '<div style="font-size:15px;font-weight:700;margin-top:2px">' +
      val +
      '</div></td>'
    )
  }

  const issuer = d.issuer || {}
  const addr = Array.isArray(issuer.address) ? issuer.address.join(', ') : issuer.address || ''

  // Partial-payment support: only meaningful on sheets that have a "Total Paid" /
  // "Overdue Amount" column — on older sheets without them, fall back to the original
  // full-payment behavior (Amount Paid = Total Due, no balance line).
  const hasBalanceData = isNum_(d.overdueAmount)
  const amountPaidVal = isNum_(d.totalPaid) ? d.totalPaid : d.total
  const balanceVal = hasBalanceData ? Number(d.overdueAmount) : 0 // unpaid balance carrying to NEXT month
  const lastMonthOverdueVal = isNum_(d.lastMonthOverdue) ? Number(d.lastMonthOverdue) : 0 // balance carried in FROM last month
  const isPartial = hasBalanceData && balanceVal > 0

  const overdueRow = hasBalanceData
    ? '<tr style="background:#fff3f3"><td colspan="3" style="padding:9px 10px;text-align:right;font-weight:800;color:#9c0006">OVERDUE AMOUNT</td>' +
      '<td style="padding:9px 10px;text-align:right;font-weight:800;color:#9c0006">' +
      money_(balanceVal) +
      '</td></tr>'
    : ''
  const lastMonthOverdueRow = hasBalanceData
    ? '<tr><td colspan="3" style="padding:9px 10px;text-align:right;font-weight:700;color:#9c6500">LAST MONTH OVERDUE</td>' +
      '<td style="padding:9px 10px;text-align:right;font-weight:700;color:#9c6500">' +
      money_(lastMonthOverdueVal) +
      '</td></tr>'
    : ''

  return (
    '' +
    '<html><head><meta charset="utf-8">' +
    '<style>@page{size:Letter;margin:11mm}html,body{margin:0;padding:0}table{page-break-inside:avoid}</style></head>' +
    '<body style="font-family:Helvetica,Arial,sans-serif;color:#111;margin:0;padding:0;background:#fff">' +
    '<div style="border:2px solid #111;padding:18px">' +
    '<div style="text-align:center">' +
    '<div style="font-size:30px;font-weight:800;letter-spacing:3px">PAYMENT RECEIPT</div>' +
    '<div style="font-size:12px;color:#333;letter-spacing:2px;margin-top:1px">Rental / Tenant Payment Receipt</div>' +
    '</div>' +
    '<div style="border-top:1px solid #ccc;margin:10px 0"></div>' +
    '<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate"><tr>' +
    box('RECEIPT NO.', d.receiptNo) +
    '<td width="1%"></td>' +
    box('RECEIPT DATE', d.receiptDate) +
    '<td width="1%"></td>' +
    box('PAYMENT STATUS', isPartial ? '⚠ PARTIAL' : '✔ PAID') +
    '</tr></table>' +
    '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px"><tr>' +
    '<td width="50%" valign="top" style="padding-right:16px">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px">PROPERTY / ISSUER DETAILS</div>' +
    '<table width="100%" style="font-size:11px">' +
    tRow('Received By / Property Manager', issuer.managerName) +
    tRow('Property / Building Name', issuer.buildingName) +
    tRow('Address', addr) +
    tRow('Contact Number', issuer.contact) +
    tRow('Email', issuer.email) +
    '</table>' +
    '</td>' +
    '<td width="50%" valign="top" style="padding-left:16px;border-left:1px solid #eee">' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px">TENANT DETAILS</div>' +
    '<table width="100%" style="font-size:11px">' +
    tRow('Tenant Name', d.tenantName) +
    tRow('Flat Number', d.flatNumber) +
    tRow('Tenant Mobile Number', d.mobile) +
    tRow('Tenant Email', d.email) +
    tRow('Tenant Deposit Amount', isNum_(d.deposit) ? inr_(d.deposit) : d.deposit) +
    '</table>' +
    '</td>' +
    '</tr></table>' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;margin-top:14px;margin-bottom:6px">RENTAL DETAILS</div>' +
    '<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate"><tr>' +
    box('BILLING MONTH', d.billingMonth) +
    '<td width="1%"></td>' +
    box('RENT DUE DAY', dueDayLabel_(d.dueDay)) +
    '<td width="1%"></td>' +
    box('PAID DATE', d.paidDate) +
    '</tr></table>' +
    '<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:12px;font-size:12px">' +
    '<tr style="background:#111;color:#fff">' +
    '<td style="padding:8px 10px;width:6%">#</td>' +
    '<td style="padding:8px 10px;width:26%">DESCRIPTION</td>' +
    '<td style="padding:8px 10px">DETAILS</td>' +
    '<td style="padding:8px 10px;text-align:right;width:22%">AMOUNT (' +
    C +
    ')</td>' +
    '</tr>' +
    itemRows +
    '<tr><td colspan="3" style="padding:8px 10px;text-align:right;font-weight:700;border-bottom:1px solid #ccc">TOTAL DUE</td>' +
    '<td style="padding:8px 10px;text-align:right;font-weight:700;border-bottom:1px solid #ccc">' +
    money_(d.total) +
    '</td></tr>' +
    '<tr style="background:#efefef"><td colspan="3" style="padding:9px 10px;text-align:right;font-weight:800">AMOUNT PAID</td>' +
    '<td style="padding:9px 10px;text-align:right;font-weight:800">' +
    money_(amountPaidVal) +
    '</td></tr>' +
    overdueRow +
    lastMonthOverdueRow +
    '</table>' +
    '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:12px;border:1px solid #ddd"><tr>' +
    '<td width="58%" valign="middle" style="padding:11px 16px;border-right:1px solid #eee">' +
    '<span style="font-size:22px;vertical-align:middle">' +
    (isPartial ? '⚠' : '✔') +
    '</span>' +
    '<span style="font-size:18px;font-weight:700;margin-left:8px;vertical-align:middle">' +
    (isPartial ? 'Partial payment received.' : 'Payment received in full.') +
    '</span>' +
    '<div style="font-size:11px;color:#666;margin-top:4px">' +
    (isPartial
      ? 'The remaining balance of ' +
        inr_(balanceVal) +
        ' has been carried forward to next month’s Total Due.'
      : 'Thank you! Your payment has been received successfully.') +
    '</div>' +
    '</td>' +
    '<td width="42%" valign="middle" style="padding:11px 16px;text-align:center">' +
    '<div style="font-size:11px;color:#888;letter-spacing:1px">AMOUNT PAID</div>' +
    '<div style="font-size:26px;font-weight:800;margin-top:1px">' +
    inr_(amountPaidVal) +
    (isNum_(amountPaidVal) ? '.00' : '') +
    '</div>' +
    (isPartial
      ? '<div style="font-size:11px;color:#9c0006;font-weight:700;margin-top:4px">BALANCE DUE: ' +
        inr_(balanceVal) +
        '</div>'
      : '') +
    '</td>' +
    '</tr></table>' +
    '<div style="font-size:11px;font-weight:700;letter-spacing:1px;margin-top:14px;margin-bottom:5px">NOTES / REMARKS</div>' +
    '<div style="border:1px solid #ddd;padding:9px 12px;font-size:11px;color:#444;line-height:1.5">' +
    (d.notes || []).join('<br>') +
    '</div>' +
    '<table width="100%" cellspacing="0" cellpadding="0" style="margin-top:20px"><tr>' +
    '<td width="45%" style="border-top:1px solid #333;padding-top:5px;text-align:center;font-size:10px;letter-spacing:1px;color:#555">SIGNATURE</td>' +
    '<td width="10%"></td>' +
    '<td width="45%" style="border-top:1px solid #333;padding-top:5px;text-align:center;font-size:10px;letter-spacing:1px;color:#555">AUTHORIZED BY · ' +
    (issuer.managerName || '') +
    '</td>' +
    '</tr></table>' +
    '<div style="text-align:center;font-size:12px;color:#333;margin-top:12px">Thank you for your payment.</div>' +
    '</div></body></html>'
  )
}

/**
 * Utility: clear the "already sent" guard for the selected row so re-entering its
 * Paid Date emails a fresh receipt. (Clearing the Paid Date does this automatically.
 * The column J checkbox is usually a faster way to force a resend — this is here as
 * a manual fallback.)
 */
function resetActiveRowReceipt() {
  const sheet = SpreadsheetApp.getActiveSheet()
  const row = SpreadsheetApp.getActiveRange().getRow()
  PropertiesService.getDocumentProperties().deleteProperty(sheet.getName() + '!row' + row)
  logEvent_(sheet.getName(), row, 'INFO', 'Guard manually reset via resetActiveRowReceipt().')
}

/**
 * Utility: run manually from the Apps Script editor to sanity-check mail quota
 * and see today's remaining sends without waiting for an edit trigger.
 */
function checkMailQuota() {
  const remaining = MailApp.getRemainingDailyQuota()
  console.log('[TenantTracker] MailApp remaining daily quota: ' + remaining)
  return remaining
}
