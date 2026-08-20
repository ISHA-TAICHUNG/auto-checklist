#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const setupSource = fs.readFileSync('apps-script/Setup.gs', 'utf8');
const start = setupSource.indexOf('const FIXED_CRANE_DAILY_ITEMS_');
const end = setupSource.indexOf('/**\n * 一次性設定安全相關 Script Properties', start);
assert(start >= 0 && end > start, 'fixed-crane source definitions not found');

const context = {};
vm.createContext(context);
vm.runInContext(
  `${setupSource.slice(start, end)}\nthis.daily = getFixedCraneDailySourceDefinition_();\nthis.monthly = getFixedCraneMonthlySourceDefinition_();`,
  context,
);

const dailyItems = context.daily.items;
const monthlyItems = context.monthly.items;
const targetName = '緊急停止裝置正常作動';

assert.strictEqual(dailyItems.length, 8, 'fixed-crane daily checklist must contain 8 items');
assert.deepStrictEqual(
  Array.from(dailyItems, item => item[1]),
  [1, 2, 3, 4, 5, 6, 7, 8],
  'daily item order must remain contiguous',
);
assert.strictEqual(dailyItems.filter(item => item[2] === targetName).length, 1);
assert.deepStrictEqual(
  Array.from(dailyItems.find(item => item[2] === targetName).slice(0, 5)),
  ['F-CRANE-D', 8, targetName, '操作', true],
  'daily emergency-stop item must follow the daily checklist schema',
);

assert.strictEqual(monthlyItems.length, 16, 'fixed-crane monthly checklist must contain 16 items');
assert.deepStrictEqual(
  Array.from(monthlyItems, item => item[1]),
  Array.from({ length: 16 }, (_, index) => index + 1),
  'monthly item order must remain contiguous',
);
assert.strictEqual(monthlyItems.filter(item => item[2] === targetName).length, 1);
const monthlyEmergencyStop = monthlyItems.find(item => item[2] === targetName);
assert.strictEqual(monthlyEmergencyStop[0], 'F-CRANE-M');
assert.strictEqual(monthlyEmergencyStop[1], 16);
assert.match(monthlyEmergencyStop[3], /立即停止/);
assert.strictEqual(monthlyEmergencyStop[4], true);

assert(dailyItems.every(item => item[0] === 'F-CRANE-D'));
assert(monthlyItems.every(item => item[0] === 'F-CRANE-M'));

const templatesSource = fs.readFileSync('apps-script/Templates.gs', 'utf8');
assert.match(
  templatesSource,
  /template\.templateId === 'F-CRANE-D'[\s\S]*getFixedCraneDailySourceDefinition_\(\)/,
  'daily frontend must use the authoritative source definition',
);
assert.match(
  templatesSource,
  /template\.templateId === 'F-CRANE-M'[\s\S]*getFixedCraneMonthlySourceDefinition_\(\)/,
  'monthly frontend must keep using the authoritative source definition',
);

const mainSource = fs.readFileSync('apps-script/Main.gs', 'utf8');
assert.match(mainSource, /case "migrateFixedCraneChecklists"/);

console.log('fixed-crane daily/monthly checklist item test passed');
