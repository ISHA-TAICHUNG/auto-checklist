#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const notifySource = fs.readFileSync('apps-script/LineNotify.gs', 'utf8');
let frontendSetting = 'https://isha-taichung.github.io/auto-checklist/';
const notifyContext = {
  CONFIG: { DEFAULT_WEB_FRONTEND_URL: '' },
  getSetting_: () => frontendSetting,
  formatROCDate_: () => '1150814',
};
vm.createContext(notifyContext);
vm.runInContext(notifySource, notifyContext);

const dashboardUrl = notifyContext.buildOperationsDashboardUrl_();
assert.strictEqual(
  dashboardUrl,
  'https://isha-taichung.github.io/auto-checklist/dashboard.html',
  'dashboard URL should be derived from the configured frontend root',
);

const regularQuickReply = notifyContext.defaultQuickReply_();
assert.strictEqual(
  regularQuickReply.items.some(item => item.action && item.action.label === '📊 營運中控台'),
  false,
  'regular quick reply must not expose the supervisor dashboard entry',
);

const supervisorQuickReply = notifyContext.defaultQuickReply_({
  viewerIsSupervisor: true,
  dashboardUrl,
});
const dashboardAction = supervisorQuickReply.items.find(
  item => item.action && item.action.label === '📊 營運中控台',
);
assert(dashboardAction, 'supervisor quick reply should include the dashboard entry');
assert.strictEqual(dashboardAction.action.type, 'uri');
assert.strictEqual(dashboardAction.action.uri, dashboardUrl);
assert.strictEqual(supervisorQuickReply.items.length <= 13, true, 'LINE quick reply must stay within 13 items');

frontendSetting = 'https://isha-taichung.github.io/auto-checklist/work-check.html?token=must-not-leak#fragment';
assert.strictEqual(
  notifyContext.buildOperationsDashboardUrl_(),
  dashboardUrl,
  'dashboard URL should strip an existing page, query, and fragment',
);
frontendSetting = 'http://isha-taichung.github.io/auto-checklist/';
assert.strictEqual(notifyContext.buildOperationsDashboardUrl_(), '', 'non-HTTPS frontend URL must fail closed');
frontendSetting = '';
assert.strictEqual(notifyContext.buildOperationsDashboardUrl_(), '', 'blank frontend URL must fail closed');
frontendSetting = 'https://isha-taichung.github.io/auto-checklist/';

const supervisorFlex = notifyContext.buildChecklistStatusFlex_([], {
  viewerIsSupervisor: true,
  dashboardUrl,
});
const regularFlex = notifyContext.buildChecklistStatusFlex_([], {
  viewerIsSupervisor: false,
  dashboardUrl,
});
assert(
  JSON.stringify(supervisorFlex).includes('開啟營運中控台'),
  'supervisor status card should include the dashboard button',
);
assert.strictEqual(
  JSON.stringify(regularFlex).includes('開啟營運中控台'),
  false,
  'regular status card must not include the dashboard button',
);
assert.strictEqual(
  /(?:admin|api)[_-]?token|actual-admin-secret|docs\.google\.com\/spreadsheets/i.test(JSON.stringify(supervisorFlex)),
  false,
  'LINE dashboard entry must not contain admin credentials or the private database URL',
);

const webhookSource = fs.readFileSync('apps-script/LineWebhook.gs', 'utf8');
const cmdStart = webhookSource.indexOf('function cmdStatus_');
const cmdEnd = webhookSource.indexOf('\n// 舊版每日作業檢核', cmdStart);
assert(cmdStart >= 0 && cmdEnd > cmdStart, 'cmdStatus_ source not found');

let capturedStatusOptions = null;
let capturedQuickReplyOptions = null;
const webhookContext = {
  dailyReminderJob: () => [],
  getLineSubscriberProfileByUserId_: userId => ({ isSupervisor: userId === 'U-supervisor' }),
  buildOperationsDashboardUrl_: () => dashboardUrl,
  buildChecklistStatusFlex_: (_results, opts) => {
    capturedStatusOptions = opts;
    return { type: 'text', text: 'status' };
  },
  withQuickReply_: (messages, opts) => {
    capturedQuickReplyOptions = opts;
    return messages;
  },
  lineReply_: (_replyToken, messages) => messages,
};
vm.createContext(webhookContext);
vm.runInContext(webhookSource.slice(cmdStart, cmdEnd), webhookContext);
webhookContext.cmdStatus_('reply-token', 'U-supervisor', { isDirectChat: true });

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedStatusOptions)),
  { viewerIsSupervisor: true, dashboardUrl },
  'status command should pass the verified supervisor role and dashboard URL to the card',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedQuickReplyOptions)),
  { viewerIsSupervisor: true, dashboardUrl },
  'status command should add the dashboard URI only to the supervisor quick reply',
);

capturedStatusOptions = null;
capturedQuickReplyOptions = null;
webhookContext.cmdStatus_('reply-token', 'U-staff', { isDirectChat: true });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedStatusOptions)),
  { viewerIsSupervisor: false, dashboardUrl: '' },
  'regular staff status command must not receive a dashboard URL',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedQuickReplyOptions)),
  { viewerIsSupervisor: false, dashboardUrl: '' },
  'regular staff quick reply must not receive a dashboard URL',
);

capturedStatusOptions = null;
capturedQuickReplyOptions = null;
webhookContext.cmdStatus_('reply-token', 'U-supervisor', { isDirectChat: false });
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedStatusOptions)),
  { viewerIsSupervisor: false, dashboardUrl: '' },
  'a supervisor command from a group or room must not expose the dashboard entry',
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(capturedQuickReplyOptions)),
  { viewerIsSupervisor: false, dashboardUrl: '' },
  'a group or room reply must not expose the supervisor dashboard quick reply',
);
assert(
  /cmdStatus_\(replyToken, userId, \{ isDirectChat: source\.type === 'user' \}\)/.test(webhookSource),
  'the LINE dispatcher must pass the direct-chat boundary into cmdStatus_',
);

console.log('LINE supervisor dashboard entry tests passed');
