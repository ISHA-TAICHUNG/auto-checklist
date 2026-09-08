#!/usr/bin/env node
'use strict';

// Offline fault injection only. No network, real credentials, or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
let cases = 0;
function test(name, run) { run(); cases++; console.log('PASS', name); }
function runtime(files, extra = {}) {
  const ctx = vm.createContext({
    Date, Set, Map, console, CONFIG: {}, Logger: { log() {} },
    Utilities: { formatDate(d, tz, pattern) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
      const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
      return pattern === 'd' ? String(Number(p.day)) : `${p.year}-${p.month}-${p.day}`;
    } },
    ...extra,
  });
  files.forEach(file => vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file }));
  return ctx;
}

test('maintenance RPC wrappers reject anonymous and non-owner callers before any work', () => {
  const files = fs.readdirSync('apps-script').filter(f => f.endsWith('.gs') && f !== 'Config.gs').map(f => 'apps-script/' + f);
  let active = '', calls = 0;
  const c = runtime(files, { Session: { getActiveUser: () => ({ getEmail: () => active }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) } });
  const names = files.flatMap(f => Array.from(fs.readFileSync(f, 'utf8').matchAll(/function (\w+)\([^)]*\) \{\s*assertScriptEditorAccess_\(\);/g), m => m[1]));
  assert.equal(names.length, 28);
  for (const name of names) {
    c[name + '_'] = () => { calls++; return 'owner-only'; };
    for (active of ['', 'other@example.test']) assert.throws(() => c[name](), /僅限/);
  }
  assert.equal(calls, 0);
  active = 'owner@example.test';
  for (const name of names) assert.equal(c[name](), 'owner-only');
  assert.equal(calls, names.length);
});

test('dates reject rollover and invalid Date while retaining leap days', () => {
  const c = runtime(['apps-script/Utils.gs']);
  for (const value of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', new Date(NaN)]) {
    assert.throws(() => c.parseISODate_(value));
  }
  assert.equal(c.parseISODate_('2028-02-29').toISOString(), '2028-02-28T16:00:00.000Z');
});

test('group/room cannot receive sensitive command credentials or perform actions', () => {
  let auth = 0, replies = [];
  const c = runtime(['apps-script/LineWebhook.gs'], {
    lineReply_: (token, message) => replies.push(message),
    isLineSubscriberUser_: () => { auth++; return true; },
    cmdPendingApprovals_: () => { throw new Error('must not expose credentials'); },
  });
  for (const type of ['group', 'room']) {
    for (const text of ['/待簽核', '/更新 INC-1150908-001', '/陳核 INC-1150908-001', '/處理 abcdefgh', '/待發文', '/狀態']) {
      c.dispatchLineEvent_({ type: 'message', source: { type, userId: 'supervisor-test' }, message: { type: 'text', text }, replyToken: 'mock' });
      assert.match(replies.at(-1).text, /私訊/);
    }
  }
  assert.equal(auth, 0);
});

test('supervisor recipients fail closed on missing role/subscription columns', () => {
  let rows;
  const c = runtime(['apps-script/LineNotify.gs'], { CONFIG: { DB_SHEET_ID: 'test' }, SpreadsheetApp: { openById: () => ({}) } });
  Object.assign(c, {
    getLineSubscriberSheet_: () => ({ getLastRow: () => rows.length, getDataRange: () => ({ getValues: () => rows }) }),
    isActiveValue_: value => value === '是',
  });
  rows = [['姓名', 'LINE_USER_ID', '是否訂閱'], ['Test', 'U-test', '是']];
  assert.equal(c.getSupervisorUserIds_().length, 0);
  assert.equal(c.getSupervisorUserIdsByName_('Test').length, 0);
  rows[0].push('是否為主管'); rows[1].push('否');
  assert.equal(c.getSupervisorUserIds_().length, 0);
  rows[1][3] = '是';
  assert.deepEqual(Array.from(c.getSupervisorUserIds_()), ['U-test']);
  rows = [['姓名', 'LINE_USER_ID', '是否為同仁', '是否為主管'], ['Test', 'U-test', '是', '否']];
  assert.equal(c.findLineSubscriberTargetsByName_('Test', { requireStaff: true }).ids.length, 0);
});

test('template rejects omitted, duplicate and unknown inspection items', () => {
  const c = runtime(['apps-script/Submission.gs'], { sanitizeText_: value => String(value || '') });
  const expected = [{ order: 1, name: 'Emergency stop', method: 'Test' }, { order: 2, name: 'Brake', method: 'Check' }];
  for (const items of [[{ order: 2 }], [{ order: 1 }, { order: 1 }], [{ order: 2 }, { order: 3 }]]) {
    assert.throws(() => c.validateSubmissionItemsAgainstTemplate_(items, expected));
  }
  const items = [{ order: 1, name: 'tampered' }, { order: 2 }];
  c.validateSubmissionItemsAgainstTemplate_(items, expected);
  assert.equal(items[0].name, 'Emergency stop');
});

function incidentRuntime(initial) {
  let data = { incidentId: 'INC-1150908-001', updateToken: 'u'.repeat(40), approvalToken: 'a'.repeat(40),
    reportDate: '2026-09-08', processStatus: '處理完成', reviewStatus: '未送審', supervisor: 'Test',
    creationState: JSON.stringify({ version: 1, status: 'pending', notices: {} }), pdfUrl: '', ...initial };
  let held = false, writes = 0, pdfs = 0, notices = 0, failPdf = 0;
  const c = runtime(['apps-script/DailyIncident.gs'], {
    LockService: { getScriptLock: () => ({ waitLock() { if (held) throw new Error('lock busy'); held = true; }, releaseLock() { held = false; } }) },
    SpreadsheetApp: { flush() {} },
    sanitizeText_: value => String(value || ''), friendlyError_: error => error.message,
    tz_: () => 'Asia/Taipei',
  });
  Object.assign(c, {
    getDailyIncidentRecord_: () => ({ data: { ...data }, row: [] }),
    updateDailyIncidentRow_: (found, updates) => {
      writes++;
      const map = { PDF連結: 'pdfUrl', 建立流程狀態: 'creationState', 審核狀態: 'reviewStatus', 流程紀錄: 'flowLog', 待審PDF檔案ID: 'pendingPdfFileId' };
      for (const key of Object.keys(updates)) data[map[key] || key] = updates[key];
    },
    createDailyIncidentPdf_: () => { pdfs++; if (failPdf > 0 && pdfs === failPdf) throw new Error('injected PDF failure'); return { fileId: 'test-pdf', fileUrl: 'https://example.test/pdf' }; },
    resolveDailyIncidentPersonInput_: () => ({ name: 'Test', key: '' }),
    maybeNotifyDailyIncidentApproval_: () => { notices++; return { ok: true }; },
    maybeNotifyDailyIncidentCreated_: () => { notices++; return { ok: true }; },
    maybeNotifyDailyIncidentProcessingSupervisor_: () => { notices++; return { ok: true }; },
    maybeNotifyDailyIncidentClosed_: () => ({ ok: true }),
    maybeNotifyDailyIncidentReturned_: () => ({ ok: true }),
    formatDisplayDateTime_: value => value,
  });
  return { c, data: () => data, counts: () => ({ writes, pdfs, notices }), failPdf(n) { failPdf = n; }, held: () => held };
}

test('approval submission requires a token before any write or PDF generation', () => {
  const r = incidentRuntime();
  for (const token of [undefined, '', 'bad', 'x'.repeat(40)]) {
    assert.throws(() => r.c.submitDailyIncidentForApproval_({ incidentId: r.data().incidentId, token }), /失效|不正確/);
  }
  assert.deepEqual(r.counts(), { writes: 0, pdfs: 0, notices: 0 });
  assert.equal(r.held(), false);
});

test('update and approval pages expose no action tokens, including dashboard short-lived access', () => {
  const r = incidentRuntime();
  r.c.isValidAdminDashboardActionToken_ = () => true;
  for (const response of [r.c.getDailyIncidentForUpdatePage(r.data().incidentId, 's'.repeat(40)),
    r.c.getDailyIncidentForApprovalPage(r.data().incidentId, 's'.repeat(40))]) {
    assert.equal(response.ok, true);
    for (const key of ['updateUrl', 'approvalUrl', 'commentUrl', 'updateToken', 'approvalToken']) assert.equal(response.incident[key], undefined);
  }
});

test('creation resumes after reported/pending PDF failures without recreating or re-notifying', () => {
  for (const failAt of [1, 2]) {
    const r = incidentRuntime(); r.failPdf(failAt);
    assert.throws(() => r.c.withDailyIncidentLock_(() => r.c.resumeDailyIncidentCreation_(r.data().incidentId)), /PDF failure/);
    assert.equal(r.counts().notices, 0);
    r.failPdf(0);
    const recovered = r.c.withDailyIncidentLock_(() => r.c.resumeDailyIncidentCreation_(r.data().incidentId));
    assert.equal(recovered.reviewStatus, '待主管審核');
    assert.equal(recovered.lineNotice.ok, true);
    const count = r.counts();
    r.c.withDailyIncidentLock_(() => r.c.resumeDailyIncidentCreation_(r.data().incidentId));
    assert.deepEqual(r.counts(), count);
    assert.equal(count.notices, 1);
  }
});

test('ambiguous notification attempts are reported without duplicate sending', () => {
  const r = incidentRuntime({ processStatus: '待處理' });
  r.c.maybeNotifyDailyIncidentCreated_ = () => { throw new Error('transport uncertain'); };
  assert.throws(() => r.c.resumeDailyIncidentCreation_(r.data().incidentId), /transport uncertain/);
  r.c.maybeNotifyDailyIncidentCreated_ = () => { throw new Error('must not resend'); };
  const result = r.c.resumeDailyIncidentCreation_(r.data().incidentId);
  assert.equal(result.lineNotice.ok, false);
  assert.equal(result.lineNotice.reason, 'delivery_unknown');
});

test('approve/return are serialized so a stale return cannot overwrite closure', () => {
  const r = incidentRuntime({ reviewStatus: '待主管審核' });
  let attempted = false;
  const pdf = r.c.createDailyIncidentPdf_;
  r.c.createDailyIncidentPdf_ = () => {
    if (!attempted) {
      attempted = true;
      assert.throws(() => r.c.approveDailyIncident_({ incidentId: r.data().incidentId, token: r.data().approvalToken, decision: 'return' }), /lock busy/);
    }
    return pdf();
  };
  assert.equal(r.c.approveDailyIncident_({ incidentId: r.data().incidentId, token: r.data().approvalToken }).ok, true);
  assert.equal(r.data().reviewStatus, '已結案');
  assert.equal(r.c.approveDailyIncident_({ incidentId: r.data().incidentId, token: r.data().approvalToken, decision: 'return' }).alreadyClosed, true);
});

test('completed handling with unfinished finalization remains retryable', () => {
  const group = { allCompleted: true, formType: '每月', handlingApprovalStatus: '處理中', handlingPdfUrl: '',
    items: [{ status: '已完成', note: 'repaired', completedDate: '2026-09-07', handlingApprovalStatus: '處理中' }] };
  let finalized = 0;
  const c = runtime(['apps-script/MachineIncidentHandling.gs'], {
    sanitizeText_: value => String(value || ''), LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    parseISODate_: value => new Date(value),
  });
  Object.assign(c, {
    assertMachineIncidentHandlingToken_: () => ({ person: { name: 'Test' } }),
    normalizeMachineIncidentHandlingUpdates_: () => [],
    getMachineIncidentGroupByRecordId_: () => group,
    machineIncidentCompletionMeta_: () => ({}),
    finalizeMachineIncidentHandling_: () => { finalized++; if (finalized === 1) throw new Error('doc failure'); return { approvalStatus: '待主管簽核' }; },
    persistMachineIncidentHandlingFinalization_: (g, result) => {
      g.handlingApprovalStatus = result.approvalStatus;
      g.items.forEach(item => { item.handlingApprovalStatus = result.approvalStatus; });
    },
  });
  assert.equal(c.publicMachineIncidentHandlingGroup_(group).finalizationPending, true);
  assert.equal(c.publicMachineIncidentHandlingGroup_(group).allCompleted, false);
  assert.throws(() => c.submitMachineIncidentHandling_({ recordId: 'test' }), /doc failure/);
  assert.equal(c.submitMachineIncidentHandling_({ recordId: 'test' }).group.allCompleted, true);
  c.submitMachineIncidentHandling_({ recordId: 'test' });
  assert.equal(finalized, 2);
});

test('partial finalization rows retry without repeating the supervisor notice', () => {
  const rows = [['', '處理中', '', ''], ['', '處理中', '', '']];
  let failSecond = true, notices = 0;
  const props = {};
  const sheet = { getRange(row) { return {
    getValues: () => [rows[row - 2].slice()],
    setValues(values) { if (row === 3 && failSecond) throw Error('second row failure'); rows[row - 2] = values[0].slice(); },
  }; } };
  const group = { recordId: 'test', formType: '每月', allCompleted: true, sheet,
    items: [2, 3].map(rowNo => ({ rowNo, status: '已完成', note: 'repaired', completedDate: '2026-09-07' })) };
  const c = runtime(['apps-script/MachineIncidentHandling.gs'], {
    parseISODate_: value => new Date(value), sha256Hex_: () => 'test-hash',
    SpreadsheetApp: { flush() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k], setProperty: (k, v) => { props[k] = v; } }) },
    getApprovalRecordById_: () => ({ status: '待主管簽核', draftDocId: 'test', approvalToken: 'x'.repeat(32) }),
    getEquipmentById_: () => ({}), buildApprovalUrl_: () => 'https://example.test/approval',
    notifySupervisorApprovalRequest_: () => { notices++; return { ok: true }; },
  });
  Object.assign(c, {
    ensureMachineIncidentHandlingColumns_: () => ['pdf', 'status', 'supervisor', 'approved'],
    machineIncidentHandlingColumnMap_: () => ({ handlingPdf: 0, handlingApprovalStatus: 1, handlingSupervisor: 2, handlingApprovedAt: 3 }),
    appendMachineIncidentHandlingToApprovalDoc_: () => ({}),
  });
  const refresh = () => {
    group.handlingApprovalStatus = rows[0][1];
    group.items.forEach((item, i) => { item.handlingApprovalStatus = rows[i][1]; });
  };
  const result = c.finalizeMachineIncidentHandling_(group, {});
  assert.throws(() => c.persistMachineIncidentHandlingFinalization_(group, result), /second row/);
  refresh(); assert.equal(c.machineIncidentFinalizationComplete_(group), false);
  failSecond = false;
  c.persistMachineIncidentHandlingFinalization_(group, c.finalizeMachineIncidentHandling_(group, {}));
  refresh(); assert.equal(c.machineIncidentFinalizationComplete_(group), true); assert.equal(notices, 1);
  group.items[0].note = '';
  assert.equal(c.machineIncidentFinalizationComplete_(group), false);
  assert.throws(() => c.finalizeMachineIncidentHandling_(group, {}), /不完整/);
});

test('approval entry blocks incomplete handling before document/signature/archive writes', () => {
  let writes = 0;
  const group = { allCompleted: true, items: [{ status: '已完成', note: '', completedDate: '' }] };
  const c = runtime(['apps-script/Utils.gs', 'apps-script/Submission.gs', 'apps-script/MachineIncidentHandling.gs'], {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  });
  Object.assign(c, {
    validateSignature_: () => {},
    getApprovalRecord_: () => ({ recordId: 'test', status: '待主管簽核', incidentCount: 1, draftDocId: 'test', checkDate: '2026-09-07' }),
    findArchivedApprovalSibling_: () => null, tz_: () => 'Asia/Taipei',
    getMachineIncidentGroupByRecordId_: () => group,
    appendMachineIncidentHandlingToApprovalDoc_: () => { writes++; },
    getEquipmentById_: () => ({}),
    appendSupervisorApprovalToDoc_: () => { writes++; throw Error('valid-signature-stage'); },
    exportChecklistDocToPdf_: () => { writes++; throw Error('unexpected PDF'); },
  });
  const payload = { recordId: 'test', token: 'x'.repeat(32), supervisorName: 'test', supervisorSignature: 'test' };
  for (const [note, completedDate] of [['', '2026-09-07'], ['fixed', ''], ['fixed', '2026-02-30']]) {
    Object.assign(group.items[0], { note, completedDate });
    assert.equal(c.machineIncidentHandlingApprovalSummary_('test').allCompleted, false);
    assert.throws(() => c.handleApprovalSubmission_(payload), /尚未完整/);
    assert.equal(writes, 0);
  }
  Object.assign(group.items[0], { note: 'fixed', completedDate: '2026-09-07' });
  assert.throws(() => c.handleApprovalSubmission_(payload), /valid-signature-stage/);
  assert.equal(writes, 2);
});

test('saved client retry precedes new template and locked-item checks', () => {
  let existing = true, lockedReads = 0;
  const c = runtime(['apps-script/Utils.gs', 'apps-script/Submission.gs'], {
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  });
  Object.assign(c, {
    validateSignature_: () => {}, getEquipmentById_: () => ({ active: true, category: 'test' }),
    getTemplateForCategoryCycle_: () => ({ resultOptions: ['V', 'X'] }),
    findRecordByClientId_: () => existing ? { recordId: 'saved-test' } : null,
    getLockedItemsForEquipment_: () => { lockedReads++; return [{ order: 2 }]; },
    getFormMeta_: () => { throw Error('new template not needed for saved retry'); },
  });
  const payload = () => ({ formType: 'daily', equipmentId: 'test', checkDate: '2026-09-07',
    inspector: 'test', clientSubmissionId: 'test-client', signature: 'test', items: [{ order: 1, result: 'V' }] });
  assert.equal(c.handleSubmission_(payload()).recordId, 'saved-test'); assert.equal(lockedReads, 0);
  existing = false;
  assert.throws(() => c.handleSubmission_(payload()), /缺少未處理異常項/); assert.equal(lockedReads, 1);
});

test('signature tap/zero-distance movement stays empty; real stroke and clear work', () => {
  let strokes = 0;
  const canvas = { getContext: () => ({ scale() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, clearRect() {}, stroke() { strokes++; } }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }), addEventListener() {}, toDataURL: () => 'mock-ink' };
  const c = runtime(['js/signature.js'], { window: { addEventListener() {} } });
  const pad = new c.window.SignaturePad(canvas);
  const event = (x, y) => ({ preventDefault() {}, clientX: x, clientY: y });
  pad._start(event(1, 1)); pad._move(event(1, 1)); pad._end(event(1, 1));
  assert.equal(pad.isEmpty(), true); assert.equal(strokes, 0); assert.equal(pad.toDataURL(), '');
  pad._start(event(1, 1)); pad._move(event(10, 10)); pad._end(event(10, 10));
  assert.equal(pad.isEmpty(), false); assert.equal(strokes, 1);
  pad.clear(); assert.equal(pad.isEmpty(), true);
});

test('unreadable venue data is an error, while empty/holiday/nonmatching dates are unused', () => {
  let header = ['9月', '內容'], days = [[8]], content = '堆高機課程', missing = false;
  const sheet = { getLastColumn: () => header.length, getLastRow: () => days.length + 2,
    getRange: (row) => ({ getValues: () => row === 1 ? [header] : days, getValue: () => content }) };
  const c = runtime(['apps-script/Calendar.gs'], {
    getVenueSheetId_: () => 'mock', SpreadsheetApp: { openById: () => ({}) },
    dateParts_: () => ({ y: 2026, m: 9, d: 8 }),
    cellStr_: v => String(v || ''), getSetting_: () => '', getHolidayKeywords_: () => ['停班'],
    CONFIG: { VENUE_USAGE_REQUIRED_KEYWORDS_DEFAULT: { 堆高機: ['堆'] } },
  });
  c.getVenueSheetByRef_ = () => missing ? null : sheet;
  const eq = { category: '堆高機' };
  assert.equal(c.getVenueUsage_(eq, new Date()).used, true);
  for (content of ['', '停班', '起重機']) assert.equal(c.getVenueUsage_(eq, new Date()).used, false);
  missing = true; assert.throws(() => c.getVenueUsage_(eq, new Date()), /分頁不存在/);
  missing = false; header = ['8月', '內容']; assert.throws(() => c.getVenueUsage_(eq, new Date()), /月份欄位不存在/);
  header = ['9月', '內容']; days = [[7]]; assert.throws(() => c.getVenueUsage_(eq, new Date()), /找不到該日/);
});

test('public document snapshot never initializes or formats Sheets', () => {
  const c = runtime(['apps-script/OfficialDocumentMonitor.gs'], { SpreadsheetApp: { openById: () => ({}) } });
  Object.assign(c, {
    setupOfficialDocumentMonitorSheets_: () => { throw new Error('unexpected mutation'); },
    getOfficialDocumentQueueSheet_: () => ({ getLastRow: () => 1 }),
    sanitizeOfficialDocumentDate_: () => '2026-09-08',
  });
  assert.equal(c.getOfficialDocumentSnapshot_({}).count, 0);
});

console.log(`${cases} project health regression scenarios passed`);
