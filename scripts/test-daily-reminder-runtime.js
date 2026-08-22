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
    ScriptApp: {
      getScriptId: () => actualId,
      getProjectTriggers: () => [],
      deleteTrigger: () => { triggerDeletes += 1; },
      newTrigger: () => triggerBuilder,
    },
    getEquipmentList_: () => { equipmentReads += 1; return []; },
    getTemplateCyclesByCategory_: () => ({}),
    todayStart_: () => new Date('2026-08-22T00:00:00+08:00'),
    Set,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return {
    context,
    equipmentReads: () => equipmentReads,
    triggerCreates: () => triggerCreates,
    triggerDeletes: () => triggerDeletes,
  };
}

for (const expectedId of ['', 'REPLACE_WITH_PRIMARY_SCRIPT_ID', 'another-project']) {
  const runtime = createRuntime(expectedId, 'formal-project');
  const result = runtime.context.dailyReminderJob({ dryRun: true });
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].action, 'skip');
  assert.match(result[0].reason, /非正式 Apps Script 專案/);
  assert.strictEqual(runtime.equipmentReads(), 0, 'identity guard must run before Sheet reads');
  assert.throws(
    () => runtime.context.installDailyReminderTrigger(),
    /非正式 Apps Script 專案/,
  );
  assert.strictEqual(runtime.triggerCreates(), 0);
  assert.strictEqual(runtime.triggerDeletes(), 0);
}

const formal = createRuntime('formal-project', 'formal-project');
assert.deepStrictEqual(Array.from(formal.context.dailyReminderJob({ dryRun: true })), []);
assert.strictEqual(formal.equipmentReads(), 1);
formal.context.installDailyReminderTrigger();
assert.strictEqual(formal.triggerCreates(), 1);

console.log('daily reminder runtime identity guard test passed');
