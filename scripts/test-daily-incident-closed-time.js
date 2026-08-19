#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/DailyIncident.gs', 'utf8');
const start = source.indexOf('function approveDailyIncident_');
const end = source.indexOf('\nfunction submitDailyIncidentSupervisorComment_', start);
assert(start >= 0 && end > start, 'approveDailyIncident_ source not found');

let notifiedIncident = null;
let recordReadCount = 0;
const initialData = {
  incidentId: 'INC-1150707-001',
  reviewStatus: '待主管審核',
  supervisor: '莊宗良',
  flowLog: '',
};
const refreshedData = {
  ...initialData,
  reviewStatus: '已結案',
  // Reproduces a Sheets Date value already shifted by the spreadsheet timezone.
  reviewTime: '2026/08/20 05:28',
  pdfUrl: 'https://drive.google.com/example',
};

const context = {
  normalizeDailyIncidentId_: value => value,
  sanitizeText_: value => String(value || ''),
  assertDailyIncidentApprovalToken_: () => {},
  getDailyIncidentRecord_: () => {
    recordReadCount += 1;
    return recordReadCount === 1
      ? { data: { ...initialData } }
      : { data: { ...refreshedData } };
  },
  Utilities: {
    formatDate: () => '2026-08-19 14:28:50',
  },
  tz_: () => 'Asia/Taipei',
  appendDailyIncidentFlowLog_: value => value,
  createDailyIncidentPdf_: () => ({
    fileId: 'pdf-file-id',
    fileUrl: refreshedData.pdfUrl,
  }),
  updateDailyIncidentRow_: () => {},
  SpreadsheetApp: { flush: () => {} },
  formatDisplayDateTime_: value => {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    return match ? `${match[1]}/${match[2]}/${match[3]} ${match[4]}:${match[5]}` : String(value);
  },
  maybeNotifyDailyIncidentClosed_: incident => {
    notifiedIncident = incident;
    return { ok: true };
  },
  publicDailyIncidentSummary_: data => ({ ...data }),
  console,
};

vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const result = context.approveDailyIncident_({
  incidentId: initialData.incidentId,
  token: 'test-token',
  decision: 'approve',
  reviewComment: '可',
});

assert.strictEqual(result.ok, true);
assert(notifiedIncident, 'closure notification should be emitted');
assert.strictEqual(
  notifiedIncident.reviewTime,
  '2026/08/19 14:28',
  'LINE closure card must use the approval-time Taipei wall clock, not the shifted Sheets value',
);
assert.strictEqual(
  result.incident.reviewTime,
  '2026/08/20 05:28',
  'the narrow card fix must not rewrite persisted or returned incident data',
);

console.log('daily incident closure card timezone test passed');
