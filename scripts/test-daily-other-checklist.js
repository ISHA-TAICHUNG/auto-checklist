#!/usr/bin/env node
'use strict';

// 使用離線 Sheet；不讀正式帳號、不寫雲端、不發送通知。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const headers = ['表單ID', '項目順序', '項目名稱', '檢查方法', '啟用'];
let cases = 0;

function runtime(templateId, rows) {
  const context = vm.createContext({
    CONFIG: { DB_SHEET_ID: 'offline-test' },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: name => ({
          getDataRange: () => ({
            getValues: () => name === '檢查項目' ? [headers, ...rows] : [[]],
          }),
        }),
      }),
    },
    sanitizeText_: value => String(value || ''),
  });
  for (const name of ['Setup', 'Templates', 'Submission']) {
    vm.runInContext(fs.readFileSync(path.join(root, `apps-script/${name}.gs`), 'utf8'), context);
  }
  context.getEquipmentById_ = () => ({
    equipmentId: 'OFFLINE', category: '測試設備', active: true,
  });
  context.findTemplateMetaForEquipment_ = () => ({ templateId });
  context.isActiveValue_ = value => value === true || value === '是';
  return context;
}

function test(name, run) {
  run();
  cases++;
  console.log('✓', name);
}

const forkliftRows = Array.from({ length: 11 }, (_, index) => [
  'F-FORK-D', index + 1, `原項目 ${index + 1}`, '', true,
]);

test('舊堆高機 11 項 Sheet 自動補第 12 項「其他」且不改原項目', () => {
  const c = runtime('F-FORK-D', forkliftRows);
  const meta = c.getFormMeta_('daily', 'OFFLINE');
  assert.equal(meta.items.length, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(meta.items.at(-1))), {
    order: 12, name: '其他', method: '',
  });
  assert.deepEqual(Array.from(meta.items.slice(0, 11), item => item.name),
    forkliftRows.map(item => item[2]));
  assert.equal(forkliftRows.length, 11, '讀取 meta 不得改寫 Sheet');
});

test('Sheet 已有「其他」時沿用既有行且不重複新增', () => {
  const c = runtime('F-FORK-D', [...forkliftRows, ['F-FORK-D', 12, '其他', '目視', '是']]);
  const meta = c.getFormMeta_('daily', 'OFFLINE');
  assert.equal(meta.items.length, 12);
  assert.equal(meta.items.filter(item => item.name === '其他').length, 1);
  assert.equal(meta.items.at(-1).method, '目視');
});

test('堆高機既有自訂項目保留，「其他」接在最大項次之後', () => {
  const rows = [...forkliftRows, ['F-FORK-D', 15, '自訂安全檢查', '', true],
    ['F-FORK-D', 99, '停用項目', '', false], ['F-AWP-D', 20, '其他設備項目', '', true]];
  const c = runtime('F-FORK-D', rows);
  const items = c.getFormMeta_('daily', 'OFFLINE').items;
  assert.equal(items.length, 13);
  assert.equal(items.at(-2).name, '自訂安全檢查');
  assert.equal(items.at(-1).name, '其他');
  assert.equal(items.at(-1).order, 16);
  assert(!items.some(item => item.name === '停用項目' || item.name === '其他設備項目'));
});

test('既有「其他」之後有自訂項目時仍顯示在最後，保留異常追蹤項次', () => {
  const c = runtime('F-FORK-D', [...forkliftRows,
    ['F-FORK-D', 12, '其他', '目視', true], ['F-FORK-D', 15, '自訂安全檢查', '', true]]);
  const items = c.getFormMeta_('daily', 'OFFLINE').items;
  assert.equal(items.at(-2).name, '自訂安全檢查');
  assert.equal(items.at(-2).order, 15);
  assert.equal(items.at(-1).name, '其他');
  assert.equal(items.at(-1).order, 12);
  assert.equal(items.at(-1).method, '目視');
  assert.equal(items.filter(item => item.name === '其他').length, 1);
});

test('固定式起重機舊 Sheet 仍以新版 9 項來源提供最後一項「其他」', () => {
  const c = runtime('F-CRANE-D', [['F-CRANE-D', 1, '舊版項目', '', true]]);
  const items = c.getFormMeta_('daily', 'OFFLINE').items;
  assert.equal(items.length, 9);
  assert.equal(items.at(-2).name, '緊急停止裝置正常作動');
  assert.equal(items.at(-2).order, 8);
  assert.equal(items.at(-1).name, '其他');
  assert.equal(items.at(-1).order, 9);
});

test('堆高機月檢與其他機具日檢不加入補充項目', () => {
  for (const templateId of ['F-FORK-M', 'F-AWP-D', 'F-AWP-SD']) {
    const c = runtime(templateId, [[templateId, 1, '原項目', '檢點', true]]);
    const items = c.getFormMeta_(templateId.endsWith('-M') ? 'monthly' : 'daily', 'OFFLINE').items;
    assert.equal(items.length, 1);
    assert.equal(items[0].name, '原項目');
  }
});

test('新增項目通過送出驗證、保留異常說明；舊表單須重新載入', () => {
  for (const templateId of ['F-FORK-D', 'F-CRANE-D']) {
    const c = runtime(templateId, forkliftRows);
    const expected = c.getFormMeta_('daily', 'OFFLINE').items;
    const payloadItems = Array.from(expected, item => ({
      order: item.order, name: '前端名稱', result: 'X', note: '補充檢查發現異常',
    }));
    c.validateSubmissionItemsAgainstTemplate_(payloadItems, expected);
    assert.equal(payloadItems.at(-1).name, '其他');
    assert.equal(payloadItems.at(-1).note, '補充檢查發現異常');
    assert.throws(() => c.validateSubmissionItemsAgainstTemplate_(payloadItems.slice(0, -1), expected),
      /請重新載入表單/);
  }
});

console.log(`日檢「其他」離線驗證通過：${cases} 組。`);
