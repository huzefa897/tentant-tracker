/**
 * TenantTracker – configuration.
 *
 * This file is the ONLY place in the project that declares `CONFIG`. Apps Script shares one
 * global scope across every file, so a second `const CONFIG` throws "Identifier 'CONFIG' has
 * already been declared" (or, worse, makes some functions read the wrong object).
 *
 * Personal details (owner emails, phone number, address) are NOT kept in code: this file is in
 * a public repository. They're read from Script Properties
 * (Apps Script editor > Project Settings > Script Properties). See google-api/README.md for
 * the keys, and run `checkConfig()` to see which are missing.
 */

const PROPERTY_KEYS_ = {
  recipientEmails: 'RECIPIENT_EMAILS', // comma-separated; receipts go to all of them
  alertEmail: 'ALERT_EMAIL', // failures are reported here; leave unset to disable
  managerName: 'ISSUER_MANAGER_NAME',
  buildingName: 'ISSUER_BUILDING_NAME',
  address: 'ISSUER_ADDRESS', // one line per address line, separated by "|"
  contact: 'ISSUER_CONTACT',
  issuerEmail: 'ISSUER_EMAIL',
};

function scriptProperty_(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  return value == null ? '' : String(value).trim();
}

function listProperty_(key, separator) {
  return scriptProperty_(key)
    .split(separator)
    .map(function (part) { return part.trim(); })
    .filter(function (part) { return part !== ''; });
}

const CONFIG = {
  dryRun: false,   // true = build everything and log it, but skip MailApp.sendEmail entirely

  // (No fixed resendColumn: the force-resend checkbox is auto-detected as the column
  // immediately after "Notes" on each sheet — see mapColumns_ / cols.resend.)

  // Receipts are emailed to ALL of these (at least one).
  recipientEmails: listProperty_(PROPERTY_KEYS_.recipientEmails, ','),
  useBcc: false,            // true = recipients can't see each other

  // Where failures get reported so they don't go unnoticed. Unset ('') disables it.
  alertEmailOnFailure: scriptProperty_(PROPERTY_KEYS_.alertEmail),

  // Name of the sheet tab used as a human-readable log (created automatically).
  logSheetName: 'Email Log',

  // Your (landlord/manager) details — printed in the PROPERTY / ISSUER block.
  issuer: {
    managerName:  scriptProperty_(PROPERTY_KEYS_.managerName),
    buildingName: scriptProperty_(PROPERTY_KEYS_.buildingName),
    address:      listProperty_(PROPERTY_KEYS_.address, '|'),
    contact:      scriptProperty_(PROPERTY_KEYS_.contact),
    email:        scriptProperty_(PROPERTY_KEYS_.issuerEmail),
  },

  notes: [
    'Thank you for your timely payment.',
    'Please retain this receipt for your records.',
  ],

  skipSheets: ['README', 'Template', 'Email Log'],
  currency: '₹',       // Rupee symbol
  timezone: Session.getScriptTimeZone(),
};

/**
 * Utility: run manually from the Apps Script editor after setting Script Properties.
 * Logs which keys are set and which are missing. Values are never logged.
 */
function checkConfig() {
  const props = PropertiesService.getScriptProperties();
  const missing = [];
  Object.keys(PROPERTY_KEYS_).forEach(function (name) {
    const key = PROPERTY_KEYS_[name];
    const set = String(props.getProperty(key) || '').trim() !== '';
    console.log('[TenantTracker] ' + key + ': ' + (set ? 'set' : 'MISSING'));
    if (!set) missing.push(key);
  });
  if (CONFIG.recipientEmails.length === 0) {
    console.warn('[TenantTracker] No receipt recipients: receipts will fail until ' +
      PROPERTY_KEYS_.recipientEmails + ' is set.');
  }
  return missing;
}
