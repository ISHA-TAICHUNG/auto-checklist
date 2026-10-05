#!/usr/bin/env node
'use strict';

// 以隔離的 Apps Script runtime 驗證移除入口，禁止碰正式服務。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const removedFunctions = [
  'generateMonthlyPpeSummary',
  'generateMonthlyPpeSummary_',
  'monthlyPpeSummaryReminderJob',
  'monthlyPpeSummaryReminderJob_',
  'getMonthlyPpeConfirmationPageData',
  'submitMonthlyPpeConfirmationFromPage',
];
const removedActions = [
  'generateMonthlyPpeSummary',
  'monthlyPpeSummaryReminder',
  'monthlyPpeConfirmationPreview',
];
const files = fs.readdirSync('apps-script').filter(name => name.endsWith('.gs'));
const context = vm.createContext({
  CONFIG: {},
  Logger: { log() {} },
  ContentService: {
    MimeType: { JSON: 'json' },
    createTextOutput: text => ({ text, setMimeType() { return this; } }),
  },
});
for (const name of files) {
  vm.runInContext(fs.readFileSync(`apps-script/${name}`, 'utf8'), context, { filename: name });
}

context.checkAdminToken_ = token => token === 'test-admin';
context.jsonResponse_ = value => value;
for (const name of ['SpreadsheetApp', 'DriveApp', 'MailApp', 'UrlFetchApp', 'PropertiesService']) {
  context[name] = new Proxy({}, { get() { throw new Error(`移除入口不得呼叫 ${name}`); } });
}

for (const name of removedFunctions) {
  assert.equal(typeof context[name], 'undefined', `${name} 應從 runtime 移除`);
}
for (const action of removedActions) {
  const result = context.doGet({ parameter: { api: 'admin', action, adminToken: 'test-admin' } });
  assert.equal(result.ok, false);
  assert.match(result.error, /未知 admin action/);
  assert.equal(context.doGet({ parameter: { api: 'admin', action } }).ok, false);
}

// 舊確認頁入口不再建立 HTML，也不會因遺留函式引用而失敗。
const oldPage = context.doGet({ parameter: { page: 'monthly-ppe-confirm' } });
assert.equal(oldPage.ok, true);
assert.equal(oldPage.name, 'auto-checklist-api');

const retainedPages = {
  approve: 'approvalPageResponse_',
  'incident-update': 'dailyIncidentUpdatePageResponse_',
  'incident-comment': 'dailyIncidentCommentPageResponse_',
  'incident-approve': 'dailyIncidentApprovalPageResponse_',
  'daily-ppe-confirm': 'dailyPpeConfirmPageResponse_',
  'machine-incident-handle': 'machineIncidentHandlingPageResponse_',
};
for (const [page, handler] of Object.entries(retainedPages)) {
  context[handler] = () => ({ retainedPage: page });
  assert.equal(context.doGet({ parameter: { page } }).retainedPage, page);
}

for (const name of ['MonthlyPpeSummary.gs', 'MonthlyPpeSummary.js', 'MonthlyPpeConfirmPage.html']) {
  assert.equal(fs.existsSync(`apps-script/${name}`), false, `${name} 不應留在部署檔案中`);
}
for (const name of ['dailyReminderJob_', 'dailyPpeAssignmentJob_', 'monthlyReminderJob_',
  'pendingApprovalReminderJob_', 'appendClassroomMonthlySafetyPpePdf_']) {
  assert.equal(typeof context[name], 'function', `${name} 必須保留`);
}

console.log('PASS 月度防護具入口與 RPC 已移除，其他頁面、提醒與教室月檢 PDF 保留');
