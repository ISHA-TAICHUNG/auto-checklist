#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/Reminder.gs', 'utf8');

function createRuntime(expectedId, actualId) {
  let equipmentReads = 0;
  let triggerCreates = 0;
  let triggerDeletes = 0;
  const properties = new Map();
  const triggerBuilder = {
    timeBased() { return this; },
    everyDays() { return this; },
    atHour() { return this; },
    create() { triggerCreates += 1; return {}; },
  };
  const context = {
    CONFIG: {
      PRIMARY_SCRIPT_ID: expectedId,
      REMINDER_TRIGGER_HOUR: 9,
    },
    Logger: { log() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || '',
        setProperty: (key, value) => properties.set(key, String(value)),
      }),
    },
    Utilities: {
      formatDate: date => date.toISOString(),
    },
    ScriptApp: {
      getScriptId: () => actualId,
      getProjectTriggers: () => [],
      deleteTrigger: () => { triggerDeletes += 1; },
      newTrigger: () => triggerBuilder,
    },
    getEquipmentList_: () => { equipmentReads += 1; return []; },
    getTemplateCyclesByCategory_: () => ({}),
    todayStart_: () => new Date('2026-08-22T00:00:00+08:00'),
    tz_: () => 'Asia/Taipei',
    Set,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context,
    equipmentReads: () => equipmentReads,
    triggerCreates: () => triggerCreates,
    triggerDeletes: () => triggerDeletes,
    properties,
  };
}

for (const expectedId of ['', 'REPLACE_WITH_PRIMARY_SCRIPT_ID', 'another-project']) {
  const runtime = createRuntime(expectedId, 'formal-project');
  const result = runtime.context.dailyReminderJob_({ dryRun: true });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].action, 'skip');
  assert.match(result[0].reason, /非正式 Apps Script 專案/);
  assert.strictEqual(runtime.equipmentReads(), 0, 'identity guard must run before Sheet reads');
  assert.throws(
    () => runtime.context.installDailyReminderTrigger_(),
    /非正式 Apps Script 專案/,
  );
  assert.strictEqual(runtime.triggerCreates(), 0);
  assert.strictEqual(runtime.triggerDeletes(), 0);
}

const formal = createRuntime('formal-project', 'formal-project');
assert.deepStrictEqual(Array.from(formal.context.dailyReminderJob_({ dryRun: true })), []);
assert.strictEqual(formal.equipmentReads(), 1);
const successfulDryRun = formal.context.getDailyReminderRunStatus_().lastDryRun;
assert.equal(successfulDryRun.status, 'completed');
assert.equal(successfulDryRun.ok, true);
assert.equal(successfulDryRun.failedCount, 0);
formal.context.installDailyReminderTrigger_();
assert.strictEqual(formal.triggerCreates(), 1);

const isolated = createRuntime('formal-project', 'formal-project');
let pendingCalls = 0;
Object.assign(isolated.context, {
  getEquipmentList_: () => [{ equipmentId: 'FORK-A' }],
  getEquipmentById_: () => ({
    equipmentId: 'FORK-A',
    category: '堆高機',
    active: true,
  }),
  getTemplateCyclesByCategory_: () => ({ 堆高機: ['每日'] }),
  getVenueUsage_: () => ({ used: true, content: '測試場地使用' }),
  hasDailyRecordInCategory_: () => false,
  sendUnfilledReminder_: () => {
    throw new Error('LINE failed https://example.test/secret abcdefghijklmnopqrstuvwxyz123456');
  },
  monthlyReminderJob_: () => {
    throw new Error('monthly source unavailable');
  },
  pendingApprovalReminderJob_: () => {
    pendingCalls += 1;
    return { category: '主管待簽核', action: 'skip' };
  },
});
const isolatedResults = Array.from(isolated.context.dailyReminderJob_({ dryRun: false }));
assert.equal(pendingCalls, 1, '前一類提醒失敗不得阻斷待簽核提醒');
assert.equal(isolatedResults.filter(row => row.action === 'failed').length, 2);
assert.equal(isolatedResults.some(row => row.category === '主管待簽核'), true);
const isolatedStatus = isolated.context.getDailyReminderRunStatus_().lastRun;
assert.equal(isolatedStatus.status, 'completed_with_errors');
assert.equal(isolatedStatus.ok, false);
assert.equal(isolatedStatus.failedCount, 2);
assert.equal(JSON.stringify(isolatedStatus).includes('example.test'), false, '狀態不可保存 URL');
assert.equal(JSON.stringify(isolatedStatus).includes('abcdefghijklmnopqrstuvwxyz123456'), false, '狀態不可保存長憑證字串');

const fatal = createRuntime('formal-project', 'formal-project');
fatal.context.getEquipmentList_ = () => { throw new Error('database unavailable'); };
assert.throws(() => fatal.context.dailyReminderJob_({ dryRun: false }), /database unavailable/);
const fatalStatus = fatal.context.getDailyReminderRunStatus_().lastRun;
assert.equal(fatalStatus.status, 'failed');
assert.equal(fatalStatus.ok, false);
assert.equal(fatalStatus.failedCount, 1);

const dashboardSource = fs.readFileSync('apps-script/AdminDashboard.gs', 'utf8');
const helperStart = dashboardSource.indexOf('function dashboardDailyReminderHealth_');
const helperEnd = dashboardSource.indexOf('\nfunction dashboardDatabaseUrl_', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'dashboard reminder health helper not found');
let dashboardRun = null;
const dashboardContext = {
  Date,
  getDailyReminderRunStatus_: () => ({ lastRun: dashboardRun }),
};
vm.createContext(dashboardContext);
vm.runInContext(dashboardSource.slice(helperStart, helperEnd), dashboardContext);

dashboardRun = {
  status: 'completed',
  ok: true,
  completedAt: '2026-09-06T00:00:00.000Z',
  completedAtLabel: '2026-09-06 08:00:00',
  failedCount: 0,
};
let dashboardHealth = dashboardContext.dashboardDailyReminderHealth_(
  new Date('2026-09-06T06:00:00.000Z'),
);
assert.equal(dashboardHealth.ok, true);
assert.match(dashboardHealth.value, /完成/);

dashboardHealth = dashboardContext.dashboardDailyReminderHealth_(
  new Date('2026-09-08T00:00:00.000Z'),
);
assert.equal(dashboardHealth.ok, false);
assert.match(dashboardHealth.value, /36 小時/);

dashboardRun = {
  status: 'completed_with_errors',
  ok: false,
  completedAt: '2026-09-06T00:00:00.000Z',
  completedAtLabel: '2026-09-06 08:00:00',
  failedCount: 2,
};
dashboardHealth = dashboardContext.dashboardDailyReminderHealth_(
  new Date('2026-09-06T06:00:00.000Z'),
);
assert.equal(dashboardHealth.ok, false);
assert.match(dashboardHealth.value, /部分失敗（2 項）/);

const dashboardFrontend = fs.readFileSync('js/dashboard.js', 'utf8');
assert.match(
  dashboardFrontend,
  /loadDashboard\(sessionToken, \{ background: true \}\)/,
  '週期更新應先讀快照，避免每次都阻塞等待完整刷新',
);
assert.equal(
  dashboardFrontend.includes('每日提醒最近執行'),
  true,
  '中控台必須顯示每日提醒的實際執行狀態',
);

console.log('daily reminder runtime identity guard test passed');

const readFailure = createRuntime('formal-project', 'formal-project');
let independentMonthly = 0;
Object.assign(readFailure.context, {
  getEquipmentList_: () => [{ equipmentId: 'broken', category: 'broken' }, { equipmentId: 'good', category: 'good' }],
  getEquipmentById_: id => ({ equipmentId: id, category: id, active: true }),
  getTemplateCyclesByCategory_: () => ({ broken: ['每日'], good: ['每日'] }),
  getVenueUsage_: eq => { if (eq.equipmentId === 'broken') throw new Error('venue missing'); return { used: true }; },
  hasDailyRecordInCategory_: () => false,
  monthlyReminderJob_: () => { independentMonthly++; return []; },
});
const readResults = readFailure.context.dailyReminderJob_({ dryRun: true });
assert.equal(readResults.some(row => row.category === 'good' && row.action === 'wouldMail'), true);
assert.equal(independentMonthly, 1);
assert.equal(readFailure.context.getDailyReminderRunStatus_().lastDryRun.failedCount, 1);

const noStateStorage = createRuntime('formal-project', 'formal-project');
noStateStorage.context.PropertiesService.getScriptProperties = () => ({ setProperty() { throw new Error('quota'); } });
assert.throws(() => noStateStorage.context.dailyReminderJob_(), /保存失敗/);
assert.equal(noStateStorage.equipmentReads(), 0, 'never send if execution health cannot be recorded');

function ppeRuntime(expected, actual) {
  const r = createRuntime(expected, actual);
  vm.runInContext(fs.readFileSync('apps-script/DailyPpeAssignment.gs', 'utf8'), r.context);
  Object.assign(r.context, {
    getSetting_: (key, fallback) => fallback,
    isActiveValue_: v => v === '是',
    formatISODate_: () => '2026-09-08',
    dailyPpeAssignmentResolveDate_: () => new Date('2026-09-08T00:00:00+08:00'),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    dailyPpeCollectMissingConfirmations_: () => [{ equipmentId: 'VENUE-TEST' }],
    findLineSubscriberTargetsByName_: () => ({ ids: ['U-test'], ambiguous: false }),
    dailyPpePushMissingReminder_: () => { throw new Error('dry-run must never send'); },
  });
  return r;
}
const oldPpe = ppeRuntime('formal', 'old');
assert.equal(oldPpe.context.dailyPpeAssignmentJob_({ dryRun: true }).action, 'runtime_rejected');
assert.equal(oldPpe.context.getDailyReminderRunStatus_('dailyPpe').lastDryRun.status, 'runtime_rejected');
assert.throws(() => oldPpe.context.installDailyPpeAssignmentTrigger_(), /非正式/);

const newPpe = ppeRuntime('formal', 'formal');
assert.equal(newPpe.context.dailyPpeAssignmentJob_({ dryRun: 'true' }).ok, true);
assert.equal(newPpe.context.getDailyReminderRunStatus_('dailyPpe').lastRun, null);
assert.equal(newPpe.context.getDailyReminderRunStatus_('dailyPpe').lastDryRun.status, 'completed');
for (const dryRun of ['TRUE', 'True', 'true', '1', true]) {
  assert.equal(newPpe.context.dailyPpeAssignmentJob_({ dryRun }).action, 'wouldNotifyDailyPpeMissing');
}
let matches = 0;
newPpe.context.findLineSubscriberTargetsByName_ = (name, opts) => {
  assert.equal(opts.requireStaff, true);
  return ++matches === 1 ? { ids: ['U-test'], ambiguous: false } : { ids: ['U-wrong-1', 'U-wrong-2'], ambiguous: true };
};
const partial = newPpe.context.dailyPpeAssignmentJob_({ dryRun: true });
assert.equal(partial.ok, false); assert.equal(partial.targetCount, 1); assert.equal(partial.targetErrors.length, 1);
assert.equal(newPpe.context.getDailyReminderRunStatus_('dailyPpe').lastDryRun.status, 'completed_with_errors');
newPpe.context.findLineSubscriberTargetsByName_ = () => ({ ids: ['U-test'], ambiguous: false });
newPpe.context.dailyPpePushMissingReminder_ = () => ({ ok: false, code: 500 });
assert.equal(newPpe.context.dailyPpeAssignmentJob_({}).ok, false);
assert.equal(newPpe.context.getDailyReminderRunStatus_('dailyPpe').lastRun.status, 'completed_with_errors');
console.log('reminder/PPE source isolation, recipient resolution and execution-state fault tests passed');
