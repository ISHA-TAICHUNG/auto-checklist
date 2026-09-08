#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const header = ['LINE_USER_ID', '是否訂閱', '機具設備日檢點未填'];
const uid = n => 'U' + n.toString(16).padStart(32, '0');
function setup() {
  let rows = [header, ...Array.from({ length: 16 }, (_, i) => [uid(i + 1), '是', i < 4 ? '是' : '否'])];
  let code = 200, failStore = false, failTransport = false, primary = true;
  const sent = [], props = {};
  const c = vm.createContext({
    CONFIG: { DB_SHEET_ID: 'test' }, Logger: { log() {} },
    SpreadsheetApp: { openById: () => ({ getSheetByName: () => ({ getDataRange: () => ({ getValues: () => rows }) }) }) },
    PropertiesService: { getScriptProperties: () => ({
      setProperty(k, v) { if (failStore) throw Error('store'); props[k] = v; },
      getProperties: () => ({ ...props }), deleteProperty: k => delete props[k],
    }) },
    ScriptApp: { getScriptId: () => 'test-primary' },
    Utilities: { getUuid: () => crypto.randomUUID() },
    sha256Hex_: s => crypto.createHash('sha256').update(s).digest('hex'),
    isPrimaryDailyReminderRuntime_: () => primary,
    UrlFetchApp: { fetch(url, options) {
      sent.push({ url, payload: JSON.parse(options.payload) });
      if (failTransport) throw Error('network');
      return { getResponseCode: () => code, getAllHeaders: () => ({ 'X-Line-Request-Id': 'test-request' }) };
    } },
  });
  vm.runInContext(fs.readFileSync('apps-script/LineNotify.gs', 'utf8'), c);
  c.getLineConfig_ = () => ({ token: 'test-not-a-real-token' });
  c.buildReminderFlex_ = () => ({ type: 'flex' });
  c.withQuickReply_ = x => [x];
  c.linePush_ = () => { throw Error('general-list path must not run'); };
  c.getLineSubscriberUserIds_ = () => { throw Error('cached list must not run'); };
  return { c, sent, props, setRows: v => rows = v, setCode: v => code = v,
    storeFail: () => failStore = true, transportFail: () => failTransport = true, oldProject: () => primary = false };
}
let total = 0;
function test(name, fn) { fn(); total++; console.log('PASS', name); }
test('16 subscribers: omitted options selects exactly 4 explicit recipients', () => {
  const t = setup();
  assert.equal(t.c.getDailyReminderRecipientPreview_().targetCount, 4);
  assert.equal(t.sent.length, 0); assert.equal(Object.keys(t.props).length, 0);
  const r = t.c.sendReminder_('test-equipment', [], '');
  assert.equal(r.targetCount, 4); assert.equal(t.sent.length, 1);
  assert.deepEqual(t.sent[0].payload.to, [1, 2, 3, 4].map(uid));
  const audit = JSON.parse(Object.values(t.props)[0]);
  assert.equal(audit.status, 'accepted'); assert.equal(audit.requestId, 'test-request');
  assert.equal(audit.targetHashes.length, 4); assert.ok(!JSON.stringify(t.props).includes(uid(1)));
  assert.equal(t.c.getDailyReminderDeliveryAudits_()[0].status, 'accepted');
});
test('changes read immediately; same ID deduplicates and one recipient uses push', () => {
  const t = setup(); t.c.sendReminder_('test', [], '');
  t.setRows([header, [uid(5), '是', '是'], [uid(5), '是', '是']]);
  t.c.sendReminder_('test', [], '');
  assert.equal(t.sent[1].payload.to, uid(5)); assert.ok(t.sent[1].url.endsWith('/push'));
});
test('missing/duplicate columns, conflicting IDs, group IDs and empty lists block', () => {
  for (const rows of [
    [['LINE_USER_ID', '機具設備日檢點未填'], [uid(1), '是']],
    [[...header, '是否訂閱'], [uid(1), '是', '是', '是']],
    [header, [uid(1), '是', '是'], [uid(1), '是', '否']],
    [header, ['C' + '1'.repeat(32), '是', '是']],
    [header, [uid(1), '否', '是']],
    [header, [uid(1), 'TRUE', 'TRUE']],
  ]) {
    const t = setup(); t.setRows(rows);
    assert.throws(() => t.c.sendReminder_('test', [], ''), e => e.notificationPolicyBlocked === true);
    assert.equal(t.sent.length, 0);
  }
});
test('primary guard and audit persistence failure block before transport', () => {
  for (const fail of ['oldProject', 'storeFail']) {
    const t = setup(); t[fail]();
    assert.throws(() => t.c.sendReminder_('test', [], ''), e => e.notificationPolicyBlocked === true);
    assert.equal(t.sent.length, 0);
  }
});
test('HTTP failure and uncertain delivery are not marked successful', () => {
  const t = setup(); t.setCode(400);
  assert.equal(t.c.sendReminder_('test', [], '').ok, false);
  assert.equal(JSON.parse(Object.values(t.props)[0]).status, 'rejected');
  for (const code of [500, 502, 503]) {
    const server = setup(); server.setCode(code);
    assert.throws(() => server.c.sendReminder_('test', [], ''), e => e.notificationPolicyBlocked === true);
    assert.equal(JSON.parse(Object.values(server.props)[0]).status, 'delivery_unknown');
    assert.equal(server.sent.length, 1);
  }
  const u = setup(); u.transportFail();
  assert.throws(() => u.c.sendReminder_('test', [], ''), e => e.notificationPolicyBlocked === true);
  assert.equal(JSON.parse(Object.values(u.props)[0]).status, 'delivery_unknown');
  assert.equal(u.sent.length, 1);
});
test('monthly notices retain existing routing', () => {
  const t = setup(); let routed;
  t.c.linePush_ = (messages, opts) => { routed = opts.notificationColumn; return { ok: true }; };
  assert.equal(t.c.sendReminder_('test', [], '', { notificationColumn: '機具設備月檢點未填' }).ok, true);
  assert.equal(routed, '機具設備月檢點未填'); assert.equal(t.sent.length, 0);
});
test('audits stay bounded to latest 20 attempts', () => {
  const t = setup(); for (let i = 0; i < 25; i++) t.c.sendReminder_('test', [], '');
  assert.equal(Object.keys(t.props).length, 20);
});
test('policy denial cannot fall back to email from the daily job', () => {
  const t = setup(); let emails = 0;
  vm.runInContext(fs.readFileSync('apps-script/Reminder.gs', 'utf8'), t.c);
  Object.assign(t.c, {
    dateParts_: () => ({ y: 2026, m: 9, d: 7 }),
    getSetting_: () => '', escapeHtml_: value => String(value || ''),
    getOrgHeader_: () => 'test', getEquipmentList_: () => [],
    getReminderEmail_: () => 'nobody@example.test',
    MailApp: { sendEmail() { emails++; } },
    sendReminder_: () => { throw t.c.dailyReminderPolicyError_('blocked'); },
  });
  assert.throws(() => t.c.sendUnfilledReminder_({ category: 'test' }, new Date(), {}),
    error => error.notificationPolicyBlocked === true);
  assert.equal(emails, 0); assert.equal(t.sent.length, 0);
});
console.log(`${total} policy tests passed; no network or real recipients used`);
