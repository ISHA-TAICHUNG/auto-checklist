#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('apps-script/AdminDashboard.gs', 'utf8');
const mirrorPath = 'apps-script/AdminDashboard.js';
const mirrorSource = fs.existsSync(mirrorPath) ? fs.readFileSync(mirrorPath, 'utf8') : '';
const start = source.indexOf('function dashboardMonthlyCategoryRank_');
const end = source.indexOf('\nfunction dashboardIncidentStatus_', start);
assert(start >= 0 && end > start, 'dashboard monthly helper source not found');

const context = {};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

assert.deepStrictEqual(
  [
    '忠明教室安全衛生量測設備及個人防護具',
    '堆高機',
    '復興教室安全衛生量測設備及個人防護具',
    '固定式起重機',
    '龍井教室安全衛生量測設備及個人防護具',
  ].sort(context.dashboardCompareMonthlyCategories_),
  [
    '固定式起重機',
    '堆高機',
    '龍井教室安全衛生量測設備及個人防護具',
    '復興教室安全衛生量測設備及個人防護具',
    '忠明教室安全衛生量測設備及個人防護具',
  ],
  'monthly categories should follow the operational order',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '堆高機',
    equipmentCount: 6,
    equipmentNames: [
      '堆高機 F 號', '堆高機 B 號', '堆高機 A 號',
      '堆高機 E 號', '堆高機 D 號', '堆高機 C 號',
    ],
  }),
  '堆高機 A、B、C、D、E、F 號（共用月檢）',
  'forklift monthly label should list A-F',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '固定式起重機',
    equipmentCount: 1,
    equipmentNames: ['龍井教室_天車場地'],
  }),
  '龍井教室_天車場地',
  'single-equipment category should retain its name',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '堆高機',
    equipmentCount: 2,
    equipmentNames: ['堆高機 A 號', '堆高機A號'],
  }),
  '堆高機 A 號（共用月檢）',
  'forklift labels should be de-duplicated after normalization',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '堆高機',
    equipmentCount: 2,
    equipmentNames: ['堆高機 A 號', '堆高機 F 號（3噸）'],
  }),
  '堆高機 A 號、堆高機 F 號（3噸）（共用月檢）',
  'non-standard forklift names must remain visible instead of being silently dropped',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '測試類別',
    equipmentCount: 3,
    equipmentNames: ['設備甲', '設備甲', '設備乙'],
  }),
  '設備乙、設備甲（共用月檢）',
  'generic shared categories should be de-duplicated and explicitly labelled',
);

assert.strictEqual(
  context.dashboardMonthlyEquipmentLabel_({
    category: '重複名稱類別',
    equipmentCount: 3,
    equipmentNames: ['共用場地', '共用場地', ''],
  }),
  '共用場地（共用月檢）',
  'multi-equipment categories remain explicit even when names repeat or are blank',
);

assert.strictEqual(
  /gid=\d{6,}/.test(source),
  false,
  'database tab gid must be resolved from the live sheet instead of hard-coded',
);

if (mirrorSource) {
  assert.strictEqual(
    /gid=\d{6,}/.test(mirrorSource),
    false,
    'generated mirror must not contain a hard-coded database tab gid',
  );

  const mirrorStart = mirrorSource.indexOf('function dashboardMonthlyCategoryRank_');
  const mirrorEnd = mirrorSource.indexOf('\nfunction dashboardIncidentStatus_', mirrorStart);
  assert.strictEqual(
    mirrorSource.slice(mirrorStart, mirrorEnd),
    source.slice(start, end),
    'Apps Script mirror must match the monthly equipment label helper',
  );
}

console.log('admin dashboard monthly equipment tests passed');
