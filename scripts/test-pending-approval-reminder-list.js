#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps-script/LineNotify.gs'), 'utf8'),
  context);

function records(count) {
  return Array.from({ length: count }, (_, index) => ({
    equipmentName: `測試設備 ${index + 1}`,
    checkDateLabel: '1151103',
    inspector: `檢查員 ${index + 1}`,
  }));
}

function reminderRows(message) {
  return message.contents.body.contents.filter(item => /^\d+\. /.test(item.text || ''));
}

let total = 0;
function test(name, run) {
  run();
  total++;
  console.log('PASS', name);
}

test('9 筆提醒完整列出截圖缺少的第 9 筆，總數與清單一致', () => {
  const message = context.buildPendingApprovalReminderFlex_(records(9), { minAgeHours: 24 });
  const rows = reminderRows(message);
  assert.equal(message.type, 'flex');
  assert.equal(message.contents.type, 'bubble');
  assert.equal(rows.length, 9);
  for (let index = 0; index < 9; index++) {
    assert.equal(rows[index].text,
      `${index + 1}. 測試設備 ${index + 1}｜1151103｜檢查員 ${index + 1}`);
    assert.equal(rows[index].wrap, true);
  }
  assert.match(message.altText, /9 筆/);
  assert.match(message.contents.body.contents[0].text, /共有 9 筆/);
  assert.equal(message.contents.body.contents.some(item => /還有/.test(item.text || '')), false);
});

test('10 筆完整呈現；11 筆保留準確餘數及待簽核入口', () => {
  for (const count of [8, 10, 11]) {
    const message = context.buildPendingApprovalReminderFlex_(records(count), { minAgeHours: 48 });
    const rows = reminderRows(message);
    assert.equal(rows.length, Math.min(count, 10));
    assert.match(rows.at(-1).text, new RegExp(`^${Math.min(count, 10)}\\. `));
    const more = message.contents.body.contents.filter(item => /還有/.test(item.text || ''));
    assert.equal(more.length, count > 10 ? 1 : 0);
    if (count === 11) assert.equal(more[0].text, '... 還有 1 筆');
    assert.match(message.altText, new RegExp(`${count} 筆`));
    assert.match(message.contents.body.contents.at(-1).text, /請輸入「待簽核」/);
    assert.match(message.contents.header.contents[1].text, /2 天/);
  }
});

test('實際 sender 將完整 9 筆卡片交給原主管路由與 Quick Reply，空清單不推送', () => {
  const pushes = [];
  context.linePushToSupervisors_ = messages => {
    pushes.push(messages);
    return { ok: true };
  };
  const result = context.sendPendingApprovalReminder_(records(9), { minAgeHours: 24 });
  assert.equal(result.ok, true);
  assert.equal(pushes.length, 1);
  const messages = Array.isArray(pushes[0]) ? pushes[0] : [pushes[0]];
  assert.equal(messages.length, 1);
  assert.equal(reminderRows(messages[0]).length, 9);
  assert.ok(messages[0].quickReply.items.some(item => item.action.text === '待簽核'));
  for (const input of [[], undefined]) {
    const skipped = context.sendPendingApprovalReminder_(input);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, 'no_pending_approvals');
  }
  assert.equal(pushes.length, 1);
});

console.log(`${total} 組主管待簽核提醒測試通過；未連線或發送真實訊息`);
