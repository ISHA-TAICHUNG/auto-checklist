#!/usr/bin/env node
'use strict';

// 離線測試：機具異常「處理後照片、指定核判主管、每日檢主管核判、LINE 進度條」。
// 只用記憶體假資料，不連 Google、不寫正式資料、不發 LINE。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'apps-script');
let cases = 0;
function test(name, run) {
  run();
  cases += 1;
  console.log('PASS', name);
}

const HEADERS = [
  '事件ID', '通報日期', '設備代號', '設備名稱', '設備類別', '表單類型', '項次', '項目名稱', '結果代號',
  '異常說明', 'PDF連結', '紀錄ID', '狀態', '實際完成日', '負責人', '備註', '處理更新時間', '處理紀錄PDF',
  '處理簽核狀態', '處理簽核主管', '處理簽核時間', '處理照片數', '處理照片資料夾', '指定主管', '指定主管Key',
  '處理人Key', '主管核判意見',
];

function fakeSheet(rows) {
  return {
    rows,
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(row, column, numRows, numColumns) {
      numRows = numRows || 1;
      numColumns = numColumns || 1;
      return {
        getValues: () => rows.slice(row - 1, row - 1 + numRows)
          .map(values => values.slice(column - 1, column - 1 + numColumns)),
        setValues: values => values.forEach((value, i) => {
          value.forEach((cell, j) => { rows[row - 1 + i][column - 1 + j] = cell; });
        }),
        setValue: value => { rows[row - 1][column - 1] = value; },
      };
    },
  };
}

function incidentRow(id, order, formType) {
  const row = HEADERS.map(() => '');
  const set = (name, value) => { row[HEADERS.indexOf(name)] = value; };
  set('事件ID', id);
  set('通報日期', '2026-11-13');
  set('設備代號', 'EQP-1');
  set('設備名稱', '測試堆高機');
  set('表單類型', formType);
  set('項次', order);
  set('項目名稱', `第 ${order} 項`);
  set('異常說明', '煞車異音');
  set('紀錄ID', 'REC-0001');
  set('狀態', '待處理');
  return row;
}

const PEOPLE = {
  'key-staff': { name: '王同仁', key: 'key-staff', userId: 'U-staff', isStaff: true, isSupervisor: false },
  'key-boss': { name: '李主管', key: 'key-boss', userId: 'U-boss', isStaff: false, isSupervisor: true },
  'key-boss2': { name: '陳主管', key: 'key-boss2', userId: 'U-boss2', isStaff: false, isSupervisor: true },
};

function setup(formType) {
  const sheet = fakeSheet([HEADERS.slice(), incidentRow('INC-1', 1, formType), incidentRow('INC-2', 2, formType)]);
  const world = { pushes: [], supervisorPushes: [], pdfs: 0, savedPhotos: 0, props: {} };
  const c = vm.createContext({
    console, Date, Math, JSON, Set, Map, Object, Array, String, Number,
    CONFIG: { DB_SHEET_ID: 'TEST', MAX_PHOTO_BYTES: 600 * 1024 },
    Logger: { log() {} },
    Utilities: { formatDate: () => '2026-11-14 09:00:00', base64Encode: () => 'AQI=' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { openById: () => ({}), flush() {} },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => world.props[key] || null,
        setProperty: (key, value) => { world.props[key] = value; },
        deleteProperty: key => { delete world.props[key]; },
      }),
    },
    DriveApp: {
      getFolderById: () => {
        const files = [{ getName: () => 'REC0001_處理照片_01.jpg', getMimeType: () => 'image/jpeg', getBlob: () => ({ getBytes: () => [1, 2] }) }];
        return { getFiles: () => ({ hasNext: () => files.length > 0, next: () => files.shift() }) };
      },
    },
  });
  ['MachineIncidentHandling.gs', 'LineNotify.gs'].forEach(name => {
    vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), c, { filename: name });
  });
  Object.assign(c, {
    parseDriveFolderId_: url => (String(url || '').includes('folder') ? 'FOLDER' : ''),
    sanitizeText_: (value, max) => String(value == null ? '' : value).substring(0, max || 9999),
    tz_: () => 'Asia/Taipei',
    formatISODate_: d => d.toISOString().substring(0, 10),
    parseISODate_: value => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error('bad date');
      return new Date(value + 'T00:00:00Z');
    },
    friendlyError_: err => String((err && err.message) || err),
    getMachineIncidentSheet_: () => sheet,
    findLineSubscriberPersonByKey_: (key, opts) => {
      const person = PEOPLE[key];
      if (!person) return null;
      if (opts && opts.requireSupervisor && !person.isSupervisor) return null;
      return person;
    },
    findLineSubscriberTargetsByPersonKey_: key => ({ ids: PEOPLE[key] ? [PEOPLE[key].userId] : [] }),
    findLineSubscriberTargetsByName_: () => ({ ids: [], ambiguous: false }),
    getDailyIncidentPeopleOptions_: () => ({
      supervisors: Object.values(PEOPLE).filter(p => p.isSupervisor).map(p => ({ key: p.key, label: p.name })),
    }),
    normalizeDailyIncidentPhotos_: photos => {
      if (photos.length > 8) throw new Error('照片超過 8 張上限');
      return photos;
    },
    saveDailyIncidentPhotos_: (folder, prefix, photos, label, offset) => {
      assert.equal(label, '處理照片');
      world.savedPhotos += photos.length;
      world.lastPhotoOffset = offset;
      return photos.map(() => ({}));
    },
    getMachineIncidentPhotoFolder_: () => ({ getUrl: () => 'https://drive.example.test/folder' }),
    getWebAppBaseUrl_: () => 'https://script.example.test/exec',
    sha256Hex_: text => 'h' + String(text).length + String(text).replace(/\W/g, '').slice(-12),
    createMachineIncidentHandlingToken_: (recordId, key) => `tok:${key}`,
    assertMachineIncidentHandlingToken_: (recordId, token) => {
      const key = String(token).replace(/^tok:/, '');
      if (key === 'admin') return { isAdmin: true, actorName: '管理者代填', person: { name: '' }, payload: { a: 1 } };
      const person = PEOPLE[key];
      if (!person) throw new Error('連結無效');
      return { isAdmin: false, person, actorName: person.name, payload: { p: key } };
    },
    createMachineIncidentHandlingPdf_: (group, meta) => {
      world.pdfs += 1;
      world.lastPdfMeta = meta;
      return { fileUrl: 'https://drive.example.test/handling.pdf' };
    },
    linePushToSupervisorName_: (name, messages, opts) => {
      world.supervisorPushes.push({ name, messages, opts });
      return { ok: true, targetMode: 'keyed' };
    },
    linePushToSupervisors_: messages => {
      world.supervisorPushes.push({ name: '*all*', messages });
      return { ok: true, targetMode: 'supervisors' };
    },
    linePushTo_: (to, messages) => { world.pushes.push({ to, messages }); return { ok: true }; },
    withQuickReply_: messages => messages,
  });
  const col = name => HEADERS.indexOf(name);
  const cell = (rowIndex, name) => sheet.rows[rowIndex][col(name)];
  return { c, sheet, world, cell };
}

function completeAll(supervisorKey, extra) {
  return Object.assign({
    recordId: 'REC-0001',
    token: 'tok:key-staff',
    completedDate: '2026-11-13',
    supervisorKey,
    items: [
      { incidentId: 'INC-1', order: 1, status: '已完成', note: '更換煞車來令片' },
      { incidentId: 'INC-2', order: 2, status: '已完成', note: '調整並試車正常' },
    ],
  }, extra || {});
}

test('全部完成卻沒選核判主管會被擋下，資料不變', () => {
  const r = setup('每日');
  assert.throws(() => r.c.submitMachineIncidentHandling_(completeAll('')), /請選擇核判主管/);
  assert.equal(r.cell(1, '狀態'), '待處理');
});

test('核判主管必須是主管名單中的人（擋偽造 key 與非主管）', () => {
  const r = setup('每日');
  assert.throws(() => r.c.submitMachineIncidentHandling_(completeAll('key-staff')), /不在主管名單/);
  assert.throws(() => r.c.submitMachineIncidentHandling_(completeAll('forged')), /不在主管名單/);
});

test('處理後照片超過 8 張上限會被擋，累計已上傳張數', () => {
  const r = setup('每日');
  r.sheet.rows[1][HEADERS.indexOf('處理照片數')] = 6;
  r.sheet.rows[2][HEADERS.indexOf('處理照片數')] = 6;
  const partial = completeAll('key-boss', { photos: ['a', 'b', 'c'] });
  partial.items[1].status = '處理中';
  assert.throws(() => r.c.submitMachineIncidentHandling_(partial), /最多 8 張/);
  assert.equal(r.world.savedPhotos, 0);
});

test('每日檢全部完成：存照片、記指定主管、狀態待主管核判、不產 PDF、只通知指定主管一次', () => {
  const r = setup('每日');
  const res = r.c.submitMachineIncidentHandling_(completeAll('key-boss', { photos: ['p1', 'p2'] }));
  assert.equal(res.ok, true);
  assert.equal(r.world.savedPhotos, 2);
  assert.equal(r.world.lastPhotoOffset, 0);
  assert.equal(r.world.pdfs, 0, '核准前不產正式 PDF');
  [1, 2].forEach(i => {
    assert.equal(r.cell(i, '處理簽核狀態'), '待主管簽核');
    assert.equal(r.cell(i, '指定主管'), '李主管');
    assert.equal(r.cell(i, '指定主管Key'), 'key-boss');
    assert.equal(r.cell(i, '處理人Key'), 'key-staff');
    assert.equal(r.cell(i, '處理照片數'), 2);
  });
  assert.equal(r.world.supervisorPushes.length, 1);
  assert.equal(r.world.supervisorPushes[0].opts.personKey, 'key-boss');
  const json = JSON.stringify(r.world.supervisorPushes[0].messages);
  assert.match(json, /查看並核判/);
  assert.match(json, /tok%3Akey-boss/, '核判連結綁定指定主管');
  assert.equal(res.group.allCompleted, true);
  assert.equal(res.group.awaitingApproval, true);
  assert.equal(res.group.progress.current, 2);
  assert.match(res.group.progress.holder, /李主管/);
  // 重送同一份完成資料不會重複通知
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.equal(r.world.supervisorPushes.length, 1);
});

test('主管核判頁拿得到已上傳照片（Drive 未公開也能看）', () => {
  const r = setup('每日');
  r.c.submitMachineIncidentHandling_(completeAll('key-boss', { photos: ['p1'] }));
  const data = r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-boss');
  assert.equal(data.ok, true);
  assert.equal(data.photos.length, 1);
  assert.match(data.photos[0].dataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(data.group.items[0].note, '更換煞車來令片');
});

test('主管通知失敗：不留已通知紀錄，頁面標示失敗，可重新通知成功', () => {
  const r = setup('每日');
  r.c.linePushToSupervisorName_ = () => { throw new Error('LINE 逾時'); };
  const res = r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.equal(res.reviewerNoticeFailed, true);
  assert.equal(Object.keys(r.world.props).length, 0);
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-staff').reviewerNoticeFailed, true);
  r.c.linePushToSupervisorName_ = () => ({ ok: true });
  const resend = r.c.resendMachineIncidentReviewNoticeFromPage({ recordId: 'REC-0001', token: 'tok:key-staff' });
  assert.equal(resend.ok, true);
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-staff').reviewerNoticeFailed, false);
});

test('舊表缺新欄位：開頁只讀不寫表，第一次送出才在鎖內補欄位且不重複', () => {
  const r = setup('每日');
  const legacyLength = HEADERS.indexOf('處理照片數');
  r.sheet.rows.forEach((row, i) => { r.sheet.rows[i] = row.slice(0, legacyLength); });
  let lockDepth = 0;
  let ensureOutsideLock = 0;
  r.c.LockService = { getScriptLock: () => ({ waitLock() { lockDepth++; }, releaseLock() { lockDepth--; } }) };
  const ensure = r.c.ensureMachineIncidentHandlingColumns_;
  r.c.ensureMachineIncidentHandlingColumns_ = sheet => { if (lockDepth < 1) ensureOutsideLock++; return ensure(sheet); };
  const page = r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-staff');
  assert.equal(page.ok, true);
  assert.equal(page.group.supervisorName, '');
  assert.equal(r.sheet.rows[0].length, legacyLength, '開頁不寫表');
  r.sheet.rows.slice(1).forEach(row => { while (row.length < HEADERS.length) row.push(''); });
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.deepEqual(r.sheet.rows[0], HEADERS);
  assert.equal(r.cell(1, '指定主管'), '李主管');
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.equal(r.sheet.rows[0].length, HEADERS.length, '第二次不再追加');
  assert.equal(ensureOutsideLock, 0, '補欄位只發生在持鎖流程');
  assert.equal(lockDepth, 0, '鎖有正確釋放');
});

test('非指定主管與處理人不能核判；頁面 canReview 只對指定主管為真', () => {
  const r = setup('每日');
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-boss').canReview, true);
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-boss2').canReview, false);
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-staff').canReview, false);
  assert.throws(() => r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:key-boss2', decision: 'approve' }), /指定的核判主管/);
  assert.throws(() => r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:admin', decision: 'approve' }), /指定的核判主管/);
  assert.equal(r.world.pdfs, 0);
});

test('主管退回：必填原因，項目改回處理中並通知處理人補正連結', () => {
  const r = setup('每日');
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  assert.throws(() => r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:key-boss', decision: 'return' }), /退回原因/);
  const res = r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:key-boss', decision: 'return', comment: '請補拍零件照片' });
  assert.equal(res.ok, true);
  [1, 2].forEach(i => {
    assert.equal(r.cell(i, '狀態'), '處理中');
    assert.equal(r.cell(i, '實際完成日'), '', '退回後清除完成日');
    assert.equal(r.cell(i, '處理簽核狀態'), '退回補正');
    assert.equal(r.cell(i, '主管核判意見'), '請補拍零件照片');
  });
  assert.equal(res.group.returned, true);
  assert.equal(res.group.progress.current, 1);
  assert.equal(res.group.progress.note, '主管退回補正');
  assert.equal(r.world.pushes.length, 1);
  assert.equal(r.world.pushes[0].to, 'U-staff');
  assert.match(JSON.stringify(r.world.pushes[0].messages), /請補拍零件照片/);
  // 補正後重新送出：完成時間不同，會再次通知主管；暫存進度時保留「退回補正」
  const partial = completeAll('', {});
  partial.items[1].status = '處理中';
  r.c.submitMachineIncidentHandling_(partial);
  assert.equal(r.cell(1, '處理簽核狀態'), '退回補正');
  const before = r.world.supervisorPushes.length;
  r.c.Utilities.formatDate = () => '2026-11-14 10:30:00';
  r.c.submitMachineIncidentHandling_(completeAll(''));
  assert.equal(r.cell(1, '處理簽核狀態'), '待主管簽核');
  assert.equal(r.world.supervisorPushes.length, before + 1);
});

test('主管核准：產正式 PDF（含主管與意見）、狀態已簽核歸檔、通知處理人；重複核准不重產', () => {
  const r = setup('每日');
  r.c.submitMachineIncidentHandling_(completeAll('key-boss'));
  const res = r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:key-boss', decision: 'approve', comment: '確認修復' });
  assert.equal(res.ok, true);
  assert.equal(r.world.pdfs, 1);
  assert.equal(r.world.lastPdfMeta.supervisorName, '李主管');
  assert.equal(r.world.lastPdfMeta.reviewComment, '確認修復');
  [1, 2].forEach(i => {
    assert.equal(r.cell(i, '處理簽核狀態'), '已簽核歸檔');
    assert.equal(r.cell(i, '處理簽核主管'), '李主管');
    assert.equal(r.cell(i, '處理紀錄PDF'), 'https://drive.example.test/handling.pdf');
  });
  assert.equal(res.group.approved, true);
  assert.equal(res.group.progress.current, 4);
  assert.match(JSON.stringify(r.world.pushes[0].messages), /已核判歸檔/);
  const again = r.c.reviewMachineIncidentHandling_({ recordId: 'REC-0001', token: 'tok:key-boss', decision: 'approve' });
  assert.equal(again.alreadyApproved, true);
  assert.equal(r.world.pdfs, 1);
});

test('改版前已全部完成但收尾未成功的每日檢：重送時補記新選主管才送核判', () => {
  const r = setup('每日');
  [1, 2].forEach(i => {
    r.sheet.rows[i][HEADERS.indexOf('狀態')] = '已完成';
    r.sheet.rows[i][HEADERS.indexOf('備註')] = '已修復';
    r.sheet.rows[i][HEADERS.indexOf('實際完成日')] = '2026-11-10';
    r.sheet.rows[i][HEADERS.indexOf('處理簽核狀態')] = '處理中';
  });
  assert.throws(() => r.c.submitMachineIncidentHandling_(completeAll('')), /請選擇核判主管/);
  const res = r.c.submitMachineIncidentHandling_(completeAll('key-boss2'));
  assert.equal(res.alreadyCompleted, true);
  assert.equal(r.cell(1, '指定主管'), '陳主管');
  assert.equal(r.cell(2, '處理簽核狀態'), '待主管簽核');
  assert.equal(r.world.supervisorPushes[0].opts.personKey, 'key-boss2');
});

test('舊資料「簽核略過＋處理PDF」仍視為已完成，不被新規則卡住', () => {
  const r = setup('每日');
  const group = {
    formType: '每日', handlingApprovalStatus: '簽核略過', handlingPdfUrl: 'https://x.test/a.pdf', allCompleted: true,
    items: [{ status: '已完成', note: 'ok', completedDate: '2026-11-01', handlingApprovalStatus: '簽核略過', handlingPdfUrl: 'https://x.test/a.pdf' }],
  };
  assert.equal(r.c.machineIncidentFinalizationComplete_(group), true);
  assert.equal(r.c.machineIncidentFlowProgress_(group).current, 4);
});

test('月檢有指定主管時只推給該主管（找不到才退回全部主管）；舊資料仍推全部主管', () => {
  const r = setup('每月');
  const base = { approvalUrl: 'https://example.test/approve', formType: 'monthly', checkDate: new Date(), equipment: { equipmentName: '測試' } };
  r.c.buildApprovalRequestFlex_ = () => ({ type: 'flex' });
  r.c.sendApprovalRequest_(Object.assign({ supervisorName: '李主管', supervisorKey: 'key-boss' }, base));
  assert.equal(r.world.supervisorPushes[0].name, '李主管');
  assert.equal(r.world.supervisorPushes[0].opts.personKey, 'key-boss');
  assert.equal(r.world.supervisorPushes[0].opts.allowFallback, true);
  r.c.sendApprovalRequest_(base);
  assert.equal(r.world.supervisorPushes[1].name, '*all*');
});

test('月檢異常處理完成：主管通知帶入指定主管', () => {
  const r = setup('每月');
  let record = null;
  Object.assign(r.c, {
    getApprovalRecordById_: () => ({ recordId: 'REC-0001', status: '待異常處理', draftDocId: 'doc', approvalToken: 'x'.repeat(32), checkDate: '2026-11-13' }),
    appendMachineIncidentHandlingToApprovalDoc_: () => ({ appended: true }),
    updateApprovalRecord_: () => {},
    getEquipmentById_: () => ({}),
    buildApprovalUrl_: () => 'https://example.test/approve',
    notifySupervisorApprovalRequest_: rec => { record = rec; return { ok: true }; },
  });
  r.c.submitMachineIncidentHandling_(completeAll('key-boss2'));
  assert.equal(record.supervisorName, '陳主管');
  assert.equal(record.supervisorKey, 'key-boss2');
  assert.equal(r.cell(1, '處理簽核狀態'), '待主管簽核');
  assert.equal(r.c.getMachineIncidentHandlingPageData('REC-0001', 'tok:key-boss2').canReview, false, '月檢走原簽核頁');
});

test('進度條元件：✓／●／○ 與目前負責人', () => {
  const r = setup('每日');
  const box = r.c.buildFlowProgressBox_({ steps: ['通報', '處理', '主管核判', '歸檔'], current: 1, holder: '處理人：王同仁' });
  const marks = box.contents[0].contents.map(step => step.contents[0].text);
  assert.deepEqual(marks, ['✓', '●', '○', '○']);
  assert.match(box.contents[1].text, /處理人：王同仁/);
  assert.equal(r.c.buildFlowProgressBox_({ steps: [] }).type, 'filler', '空步驟不產生非法空 box');
  const done = r.c.buildFlowProgressBox_({ steps: ['a', 'b'], current: 2, holder: '已完成歸檔' });
  assert.deepEqual(done.contents[0].contents.map(step => step.contents[0].text), ['✓', '✓']);
});

test('日常異常進度：處理中／退回／待主管審核／已結案', () => {
  const r = setup('每日');
  const p = incident => r.c.dailyIncidentFlowProgress_(incident);
  assert.equal(p({ reviewStatus: '未送審', owner: '王同仁', processStatus: '處理中' }).current, 1);
  assert.match(p({ reviewStatus: '未送審', owner: '王同仁', processStatus: '處理中' }).holder, /王同仁（處理中）/);
  assert.equal(p({ reviewStatus: '退回補正', owner: '王同仁' }).note, '主管退回補正');
  const pending = p({ reviewStatus: '待主管審核', supervisor: '李主管' });
  assert.equal(pending.current, 2);
  assert.match(pending.holder, /李主管/);
  assert.equal(p({ reviewStatus: '已結案' }).current, 4);
  const flex = r.c.buildDailyIncidentCreatedFlex_({ incidentId: 'D-1', reviewStatus: '待主管審核', supervisor: '李主管' });
  assert.match(JSON.stringify(flex), /審核主管：李主管/);
});

console.log(`\n${cases} cases passed`);
