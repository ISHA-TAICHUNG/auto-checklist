/**
 * ===== 每日場地防護具隨機指派確認 =====
 *
 * 目的：
 *   - VENUE-CRANE / VENUE-FORK 當天場地有使用且尚未有人填防護具日檢時，
 *     系統隨機指派一位「同仁且非主管」確認。
 *   - 同一天若兩個場地都需確認，只推同一則 LINE 給同一人，節省額度。
 *   - 正式填報紀錄與 PDF 必須在被指派同仁按下確認後才產生。
 *   - 即使隔天才確認，檢查日期仍使用指派日期。
 */

const DAILY_PPE_ASSIGNMENT_SHEET_NAME = '每日防護具待確認';
const DAILY_PPE_ASSIGNMENT_EQUIPMENTS = [
  { id: 'VENUE-CRANE', label: '起重機防護具' },
  { id: 'VENUE-FORK', label: '堆高機防護具' },
];
const DAILY_PPE_ASSIGNMENT_STATUS_PENDING = '待確認';
const DAILY_PPE_ASSIGNMENT_STATUS_CONFIRMED = '已確認';
const DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED = '通知失敗';

function dailyPpeAssignmentHeaders_() {
  return [
    '指派ID', '指派日期', '建立時間', '指定同仁', 'LINE_USER_ID',
    '狀態', '確認時間', '場地代號清單', '場地名稱清單', '場地使用摘要',
    '確認項目JSON', '紀錄ID清單', 'PDF連結清單', 'Token', '通知結果', '備註',
    '最後補發時間', '補發次數', '最後補發者', '最後補發結果',
  ];
}

function setupDailyPpeAssignmentSheet_(ss) {
  ss = ss || SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  setupSheet_(ss, DAILY_PPE_ASSIGNMENT_SHEET_NAME, dailyPpeAssignmentHeaders_(), []);
  return ss.getSheetByName(DAILY_PPE_ASSIGNMENT_SHEET_NAME);
}

function installDailyPpeAssignmentTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'dailyPpeAssignmentJob') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  const hour = Number(getSetting_('dailyPpeAssignmentTriggerHour', '17')) || 17;
  const minute = Number(getSetting_('dailyPpeAssignmentNearMinute', '15')) || 15;
  ScriptApp.newTrigger('dailyPpeAssignmentJob')
    .timeBased()
    .everyDays(1)
    .atHour(Math.max(0, Math.min(23, Math.floor(hour))))
    .nearMinute(Math.max(0, Math.min(59, Math.floor(minute))))
    .create();

  return dailyPpeAssignmentTriggerStatus_();
}

function dailyPpeAssignmentTriggerStatus_() {
  const triggers = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyPpeAssignmentJob')
    .map(t => ({
      handler: t.getHandlerFunction(),
      type: String(t.getEventType()),
    }));
  return {
    expectedHour: Number(getSetting_('dailyPpeAssignmentTriggerHour', '17')) || 17,
    expectedNearMinute: Number(getSetting_('dailyPpeAssignmentNearMinute', '15')) || 15,
    count: triggers.length,
    triggers,
  };
}

function dailyPpeAssignmentStatus(opts) {
  opts = opts || {};
  const targetDate = dailyPpeAssignmentResolveDate_(opts.date || opts.today);
  const missing = dailyPpeCollectMissingConfirmations_(targetDate);
  const pending = dailyPpeListAssignments_({
    date: formatISODate_(targetDate),
    statuses: [DAILY_PPE_ASSIGNMENT_STATUS_PENDING],
  });
  return {
    ok: true,
    date: formatISODate_(targetDate),
    missingCount: missing.length,
    missing: missing.map(dailyPpeSafeMissing_),
    candidateNames: dailyPpeAssignmentConfiguredNames_(),
    candidateCount: dailyPpeAssignmentCandidateStaff_().length,
    pendingCount: pending.length,
    pending: pending.map(dailyPpeSafeAssignment_),
    trigger: dailyPpeAssignmentTriggerStatus_(),
  };
}

function dailyPpeStatusLookbackDays_() {
  const raw = Number(getSetting_('dailyPpeStatusLookbackDays', '14'));
  if (!raw || raw < 1) return 14;
  return Math.max(1, Math.min(31, Math.floor(raw)));
}

function dailyPpeResendMinAgeDays_() {
  const raw = Number(getSetting_('dailyPpeResendMinAgeDays', '1'));
  if (isNaN(raw) || raw < 0) return 1;
  return Math.max(0, Math.min(7, Math.floor(raw)));
}

function dailyPpeListRecentUnconfirmedForLine_(opts) {
  opts = opts || {};
  const viewerId = String(opts.viewerId || '').trim();
  const viewerIsSupervisor = opts.viewerIsSupervisor === true;
  const lookbackDays = Math.max(1, Math.min(31, Math.floor(Number(opts.days || dailyPpeStatusLookbackDays_()) || 14)));
  const targetDate = dailyPpeAssignmentResolveDate_(opts.today || opts.date || null);
  const startDate = new Date(targetDate.getTime());
  startDate.setDate(startDate.getDate() - lookbackDays + 1);
  const limitCap = Math.max(1, Math.min(100, Math.floor(Number(opts.limitCap || 10) || 10)));
  const limit = Math.max(1, Math.min(limitCap, Math.floor(Number(opts.limit || 8) || 8)));
  const rawResendMinAgeDays = opts.resendMinAgeDays !== undefined && opts.resendMinAgeDays !== null && opts.resendMinAgeDays !== ''
    ? opts.resendMinAgeDays
    : dailyPpeResendMinAgeDays_();
  const resendMinAgeDays = Math.max(0, Math.min(7, Math.floor(Number(rawResendMinAgeDays) || 0)));
  const dailyRecordIndex = dailyPpeDailyRecordIndex_(startDate, targetDate);
  const assignments = dailyPpeListAssignments_({
    statuses: [DAILY_PPE_ASSIGNMENT_STATUS_PENDING, DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED],
  });
  const items = [];

  assignments.forEach(assignment => {
    if (!assignment || !assignment.date) return;
    let assignmentDate;
    try {
      assignmentDate = parseISODate_(assignment.date);
    } catch (_) {
      return;
    }
    if (assignmentDate < startDate || assignmentDate > targetDate) return;

    const pendingItems = (assignment.items || []).filter(item => {
      return !dailyRecordIndex.has(`${assignment.date}|${String(item.equipmentId || '').trim()}`);
    });
    if (!pendingItems.length) return;

    const isMine = !!viewerId && String(assignment.userId || '') === viewerId;
    const resendInfo = dailyPpeResendEligibility_(assignment, pendingItems, targetDate, {
      viewerIsSupervisor,
      minAgeDays: resendMinAgeDays,
    });
    const safe = dailyPpeSafeAssignment_(
      Object.assign({}, assignment, { items: pendingItems }),
      {
        includeUrl: isMine || opts.includeUrlForResend === true,
        includeTargetUserId: opts.includeTargetUserId === true,
      }
    );
    safe.isMine = isMine;
    safe.itemCount = pendingItems.length;
    safe.resendEligible = resendInfo.resendEligible;
    safe.resendBlockedReason = resendInfo.resendBlockedReason;
    safe.assignmentAgeDays = resendInfo.assignmentAgeDays;
    safe.lastResentDate = resendInfo.lastResentDate;
    items.push(safe);
  });

  items.sort((a, b) => {
    if (a.isMine !== b.isMine) return a.isMine ? -1 : 1;
    const dateCompare = String(b.date || '').localeCompare(String(a.date || ''));
    if (dateCompare !== 0) return dateCompare;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return {
    ok: true,
    lookbackDays,
    viewerIsSupervisor,
    resendMinAgeDays,
    count: items.length,
    items: items.slice(0, limit),
    truncatedCount: Math.max(0, items.length - limit),
    resendEligibleCount: items.filter(item => item && item.resendEligible).length,
  };
}

function dailyPpeResendEligibility_(assignment, pendingItems, targetDate, opts) {
  opts = opts || {};
  if (!opts.viewerIsSupervisor) {
    return { resendEligible: false, resendBlockedReason: 'not_supervisor', assignmentAgeDays: 0, lastResentDate: '' };
  }
  if (!assignment || !assignment.userId) {
    return { resendEligible: false, resendBlockedReason: 'missing_target', assignmentAgeDays: 0, lastResentDate: '' };
  }
  if (!pendingItems || !pendingItems.length) {
    return { resendEligible: false, resendBlockedReason: 'no_pending_items', assignmentAgeDays: 0, lastResentDate: '' };
  }

  const assignmentAgeDays = dailyPpeAssignmentAgeDays_(assignment.date, targetDate);
  const minAgeDays = Math.max(0, Math.floor(Number(opts.minAgeDays || 0) || 0));
  if (assignmentAgeDays < minAgeDays) {
    return { resendEligible: false, resendBlockedReason: 'too_new', assignmentAgeDays, lastResentDate: '' };
  }

  const todayKey = formatISODate_(targetDate);
  const lastResentDate = dailyPpeDateKeyFromDateTime_(assignment.lastResentAt);
  if (lastResentDate && lastResentDate === todayKey) {
    return { resendEligible: false, resendBlockedReason: 'resent_today', assignmentAgeDays, lastResentDate };
  }

  return { resendEligible: true, resendBlockedReason: '', assignmentAgeDays, lastResentDate };
}

function dailyPpeAssignmentAgeDays_(assignmentDate, targetDate) {
  try {
    const assigned = parseISODate_(String(assignmentDate || '').trim());
    const today = dailyPpeAssignmentResolveDate_(targetDate || null);
    return Math.max(0, Math.floor((today.getTime() - assigned.getTime()) / (24 * 60 * 60 * 1000)));
  } catch (_) {
    return 0;
  }
}

function dailyPpeDateKeyFromDateTime_(value) {
  if (!value) return '';
  if (value instanceof Date) return formatISODate_(value);
  const text = String(value || '').trim();
  const m = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}

function dailyPpeDailyRecordIndex_(startDate, endDate) {
  const index = new Set();
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return index;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const dateCol = headers.indexOf('檢查日期');
  const typeCol = headers.indexOf('表單類型');
  const eqpCol = headers.indexOf('設備代號');
  if (dateCol < 0 || typeCol < 0 || eqpCol < 0) return index;

  const startKey = formatISODate_(startDate);
  const endKey = formatISODate_(endDate);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  values.forEach(row => {
    let rowDate = row[dateCol];
    rowDate = rowDate instanceof Date ? formatISODate_(rowDate) : String(rowDate || '').trim();
    if (!rowDate || rowDate < startKey || rowDate > endKey) return;
    if (String(row[typeCol] || '').trim() !== '每日') return;
    const equipmentId = String(row[eqpCol] || '').trim();
    if (!equipmentId) return;
    index.add(`${rowDate}|${equipmentId}`);
  });
  return index;
}

function dailyPpeAssignmentJob(opts) {
  opts = opts || {};
  const dryRun = opts.dryRun === true || String(opts.dryRun || '').toLowerCase() === 'true' || opts.dryRun === '1';
  const targetDate = dailyPpeAssignmentResolveDate_(opts.date || opts.today);
  const dateStr = formatISODate_(targetDate);

  if (!isActiveValue_(getSetting_('dailyPpeAssignmentEnabled', '是'))) {
    return { ok: true, action: 'skip', reason: 'dailyPpeAssignmentEnabled=否', date: dateStr };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    setupDailyPpeAssignmentSheet_();

    const existingAssignments = dailyPpeListAssignments_({
      date: dateStr,
      statuses: [DAILY_PPE_ASSIGNMENT_STATUS_PENDING, DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED],
    });
    const alreadyPending = existingAssignments.filter(a => a.status === DAILY_PPE_ASSIGNMENT_STATUS_PENDING);
    if (alreadyPending.length) {
      return {
        ok: true,
        action: 'skip',
        reason: 'already_pending',
        date: dateStr,
        assignment: dailyPpeSafeAssignment_(alreadyPending[0]),
      };
    }

    const missing = dailyPpeCollectMissingConfirmations_(targetDate);
    if (!missing.length) {
      return { ok: true, action: 'skip', reason: 'no_missing_used_venue', date: dateStr };
    }

    const retryFailed = existingAssignments.find(a => a.status === DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED);
    if (retryFailed) {
      if (dryRun) {
        return {
          ok: true,
          action: 'wouldRetryNotice',
          date: dateStr,
          assignee: retryFailed.assigneeName,
          missing: missing.map(dailyPpeSafeMissing_),
          assignment: dailyPpeSafeAssignment_(retryFailed),
        };
      }
      const retryPush = dailyPpeSafePushAssignment_(retryFailed);
      dailyPpeUpdateAssignmentNotice_(
        retryFailed.assignmentId,
        retryPush,
        retryPush && retryPush.ok !== false
          ? DAILY_PPE_ASSIGNMENT_STATUS_PENDING
          : DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED
      );
      const refreshed = dailyPpeFindAssignment_(retryFailed.assignmentId);
      return {
        ok: retryPush && retryPush.ok !== false,
        action: retryPush && retryPush.ok !== false ? 'noticeRetried' : 'push_failed',
        date: dateStr,
        assignee: retryFailed.assigneeName,
        targetCount: 1,
        missing: missing.map(dailyPpeSafeMissing_),
        assignment: dailyPpeSafeAssignment_(refreshed || retryFailed),
        push: retryPush,
      };
    }

    const candidates = dailyPpeAssignmentCandidateStaff_();
    if (!candidates.length) {
      return {
        ok: false,
        action: 'failed',
        reason: 'no_staff_target',
        date: dateStr,
        candidateNames: dailyPpeAssignmentConfiguredNames_(),
        missing: missing.map(dailyPpeSafeMissing_),
      };
    }

    const selected = candidates[Math.floor(Math.random() * candidates.length)];
    if (dryRun) {
      return {
        ok: true,
        action: 'wouldAssign',
        date: dateStr,
        assignee: selected.name,
        candidateCount: candidates.length,
        missing: missing.map(dailyPpeSafeMissing_),
      };
    }

    const assignment = dailyPpeCreateAssignment_(targetDate, missing, selected);
    const pushed = dailyPpeSafePushAssignment_(assignment);
    dailyPpeUpdateAssignmentNotice_(
      assignment.assignmentId,
      pushed,
      pushed && pushed.ok !== false
        ? DAILY_PPE_ASSIGNMENT_STATUS_PENDING
        : DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED
    );
    const refreshed = dailyPpeFindAssignment_(assignment.assignmentId);
    return {
      ok: pushed && pushed.ok !== false,
      action: pushed && pushed.ok !== false ? 'assigned' : 'push_failed',
      date: dateStr,
      assignee: selected.name,
      candidateCount: candidates.length,
      targetCount: 1,
      missing: missing.map(dailyPpeSafeMissing_),
      assignment: dailyPpeSafeAssignment_(refreshed || assignment),
      push: pushed,
    };
  } finally {
    lock.releaseLock();
  }
}

function dailyPpeAssignmentResolveDate_(value) {
  if (!value) return todayStart_();
  if (value instanceof Date) return parseISODate_(formatISODate_(value));
  return parseISODate_(String(value || '').trim());
}

function dailyPpeCollectMissingConfirmations_(date) {
  const out = [];
  DAILY_PPE_ASSIGNMENT_EQUIPMENTS.forEach(def => {
    const equipment = getEquipmentById_(def.id);
    if (!equipment || !equipment.active) return;
    const usage = getVenueUsage_(equipment, date);
    if (!usage || !usage.used) return;
    if (dailyPpeHasDailyRecordForEquipment_(def.id, date)) return;
    out.push({
      equipmentId: def.id,
      label: def.label,
      equipmentName: equipment.equipmentName || def.label,
      category: equipment.category || '防護具檢點',
      location: equipment.location || '',
      usageContent: usage.content || '',
      equipment,
    });
  });
  return out;
}

function dailyPpeHasDailyRecordForEquipment_(equipmentId, date) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return false;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const dateCol = headers.indexOf('檢查日期');
  const typeCol = headers.indexOf('表單類型');
  const eqpCol = headers.indexOf('設備代號');
  if (dateCol < 0 || typeCol < 0 || eqpCol < 0) return false;
  const targetDate = formatISODate_(date);
  const targetEqp = String(equipmentId || '').trim();
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < values.length; i++) {
    let rowDate = values[i][dateCol];
    rowDate = rowDate instanceof Date ? formatISODate_(rowDate) : String(rowDate || '').trim();
    if (
      rowDate === targetDate &&
      String(values[i][typeCol] || '').trim() === '每日' &&
      String(values[i][eqpCol] || '').trim() === targetEqp
    ) {
      return true;
    }
  }
  return false;
}

function dailyPpeAssignmentCandidateStaff_() {
  const people = [];
  const configuredNames = dailyPpeAssignmentConfiguredNames_();
  const allowedNames = configuredNames.length ? new Set(configuredNames) : null;
  if (!CONFIG.DB_SHEET_ID || CONFIG.DB_SHEET_ID.startsWith('REPLACE_')) return people;
  const sheet = getLineSubscriberSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
  if (!sheet || sheet.getLastRow() < 2) return people;

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const idCol = headers.indexOf('LINE_USER_ID');
  const activeCol = getLineSubscriberActiveColumnIndex_(headers);
  const staffCol = headers.indexOf('是否為同仁');
  const supervisorCol = getLineSupervisorFlagColumnIndex_(headers);
  if (nameCol < 0 || idCol < 0 || staffCol < 0 || supervisorCol < 0) return people;

  data.slice(1).forEach((row, index) => {
    const name = String(row[nameCol] || '').trim();
    const userId = String(row[idCol] || '').trim();
    if (allowedNames && !allowedNames.has(name)) return;
    const active = activeCol < 0 ? true : isActiveValue_(row[activeCol]);
    const isStaff = isActiveValue_(row[staffCol]);
    const isSupervisor = isActiveValue_(row[supervisorCol]);
    if (!name || !userId || !active || !isStaff || isSupervisor) return;
    people.push({ name, userId, rowNo: index + 2 });
  });
  return people;
}

function dailyPpeAssignmentConfiguredNames_() {
  const raw = String(getSetting_('dailyPpeAssignmentCandidateNames', '卓小媛,林耿暉,葉邵諭,林幸音') || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,\uFF0C、;\n\r\t ]+/)
    .map(name => String(name || '').trim())
    .filter(Boolean);
}

function dailyPpeCreateAssignment_(date, missing, selected) {
  const sheet = setupDailyPpeAssignmentSheet_();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const assignmentId = 'DPPE-' + formatROCDate_(date) + '-' + Utilities.getUuid().substring(0, 8).toUpperCase();
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const createdAt = new Date();
  const items = missing.map(item => ({
    equipmentId: item.equipmentId,
    label: item.label,
    equipmentName: item.equipmentName,
    location: item.location,
    usageContent: item.usageContent,
  }));
  const values = {
    '指派ID': assignmentId,
    '指派日期': formatISODate_(date),
    '建立時間': Utilities.formatDate(createdAt, tz_(), 'yyyy-MM-dd HH:mm:ss'),
    '指定同仁': selected.name,
    'LINE_USER_ID': selected.userId,
    '狀態': DAILY_PPE_ASSIGNMENT_STATUS_PENDING,
    '場地代號清單': items.map(i => i.equipmentId).join('\n'),
    '場地名稱清單': items.map(i => i.equipmentName).join('\n'),
    '場地使用摘要': items.map(i => `${i.label}：${i.usageContent || '有使用'}`).join('\n'),
    '確認項目JSON': JSON.stringify(items),
    'Token': token,
  };
  const row = new Array(headers.length).fill('');
  Object.keys(values).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) row[col] = values[key];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  return dailyPpeFindAssignment_(assignmentId);
}

function dailyPpeUpdateAssignmentNotice_(assignmentId, notice, status) {
  const found = dailyPpeFindAssignment_(assignmentId);
  if (!found) return;
  const safeNotice = Object.assign({}, notice || {});
  if (safeNotice.body) safeNotice.body = String(safeNotice.body).substring(0, 500);
  const updates = {
    '通知結果': JSON.stringify(safeNotice).substring(0, 2000),
  };
  if (status) updates['狀態'] = status;
  setSheetRowValues_(found.sheet, found.headers, found.rowNo, updates);
}

function dailyPpeBuildAssignmentUrl_(assignment) {
  return getWebAppBaseUrl_()
    + '?page=daily-ppe-confirm'
    + '&assignmentId=' + encodeURIComponent(assignment.assignmentId)
    + '&token=' + encodeURIComponent(assignment.token);
}

function dailyPpePushAssignment_(assignment) {
  if (!assignment || !assignment.userId) return { ok: false, reason: 'missing_target' };
  const url = dailyPpeBuildAssignmentUrl_(assignment);
  const dateText = dailyPpeRocDateLabel_(assignment.date);
  const contents = [
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        { type: 'text', text: dateText, size: 'sm', color: '#E8F0FE' },
        { type: 'text', text: assignment.assigneeName, size: 'sm', color: '#E8F0FE' },
      ],
    },
    { type: 'separator', margin: 'md' },
  ];
  assignment.items.forEach(item => {
    contents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'xs',
      contents: [
        { type: 'text', text: item.label || item.equipmentName, weight: 'bold', size: 'sm', color: '#202124', wrap: true },
        { type: 'text', text: item.equipmentName || item.equipmentId, size: 'xs', color: '#5f6368', wrap: true },
        { type: 'text', text: item.usageContent || '場地有使用', size: 'xs', color: '#5f6368', wrap: true },
      ],
    });
  });

  const message = {
    type: 'flex',
    altText: `🦺 ${dateText} 場地防護具待確認`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#137333',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 場地防護具待確認', color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: assignment.assignmentId, color: '#E8F0FE', size: 'xs', wrap: true },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#137333',
            action: { type: 'uri', label: '確認並產生 PDF', uri: url },
          },
        ],
      },
    },
  };
  return linePushTo_(assignment.userId, withQuickReply_([message]), 'push');
}

function dailyPpeSafePushAssignment_(assignment) {
  try {
    return dailyPpePushAssignment_(assignment);
  } catch (err) {
    return {
      ok: false,
      reason: 'push_exception',
      message: String(err && err.message ? err.message : err).substring(0, 500),
    };
  }
}

function dailyPpeResendAllForSupervisor_(userId, opts) {
  opts = opts || {};
  const profile = (typeof getLineSubscriberProfileByUserId_ === 'function')
    ? getLineSubscriberProfileByUserId_(userId)
    : null;
  if (!profile || !profile.isSupervisor) {
    return buildDailyPpeResendResultMessage_({
      ok: false,
      title: '無法補發',
      detail: '此功能限訂閱者清單內「是否為主管=是」的人使用。',
      color: '#D32F2F',
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const summary = dailyPpeListRecentUnconfirmedForLine_({
      viewerId: userId,
      viewerIsSupervisor: true,
      includeTargetUserId: true,
      includeUrlForResend: true,
      limit: 100,
      limitCap: 100,
      days: opts.days || dailyPpeStatusLookbackDays_(),
      resendMinAgeDays: opts.resendMinAgeDays !== undefined && opts.resendMinAgeDays !== null && opts.resendMinAgeDays !== ''
        ? opts.resendMinAgeDays
        : dailyPpeResendMinAgeDays_(),
    });
    const eligible = (summary.items || [])
      .filter(item => item && item.resendEligible && item.targetUserId && item.confirmUrl);

    if (!eligible.length) {
      return buildDailyPpeResendResultMessage_({
        ok: true,
        title: '目前沒有可補發項目',
        detail: `只補發近 ${summary.lookbackDays || dailyPpeStatusLookbackDays_()} 天、已超過 ${summary.resendMinAgeDays || dailyPpeResendMinAgeDays_()} 天且今天尚未補發的待確認。`,
        color: '#137333',
      });
    }

    const groups = {};
    eligible.forEach(item => {
      const id = String(item.targetUserId || '').trim();
      if (!id) return;
      if (!groups[id]) groups[id] = [];
      groups[id].push(item);
    });

    let sentRecipients = 0;
    let sentAssignments = 0;
    const failures = [];
    Object.keys(groups).forEach(targetUserId => {
      const assignments = groups[targetUserId];
      const pushResult = dailyPpeSafePushResendDigest_(targetUserId, assignments);
      const ok = pushResult && pushResult.ok !== false;
      if (ok) {
        sentRecipients += 1;
        sentAssignments += assignments.length;
      } else {
        failures.push({
          targetUserId,
          count: assignments.length,
          reason: (pushResult && (pushResult.reason || pushResult.code || pushResult.message)) || 'push_failed',
        });
      }
      assignments.forEach(item => {
        dailyPpeUpdateAssignmentResend_(
          item.assignmentId,
          pushResult,
          profile.name || profile.userId || userId,
          ok ? DAILY_PPE_ASSIGNMENT_STATUS_PENDING : DAILY_PPE_ASSIGNMENT_STATUS_NOTICE_FAILED
        );
      });
    });

    return buildDailyPpeResendResultMessage_({
      ok: failures.length === 0,
      title: failures.length ? '補發完成，部分失敗' : '補發完成',
      detail: `已補發 ${sentRecipients} 位同仁、${sentAssignments} 筆待確認。LINE 主動推播約扣 ${sentRecipients} 則額度。`,
      failures,
      color: failures.length ? '#F29900' : '#137333',
    });
  } finally {
    lock.releaseLock();
  }
}

function dailyPpeSafePushResendDigest_(targetUserId, assignments) {
  try {
    return linePushTo_(
      targetUserId,
      withQuickReply_([dailyPpeBuildResendDigestMessage_(assignments)]),
      'push'
    );
  } catch (err) {
    return {
      ok: false,
      reason: 'push_exception',
      message: String(err && err.message ? err.message : err).substring(0, 500),
    };
  }
}

function dailyPpeBuildResendDigestMessage_(assignments) {
  assignments = assignments || [];
  const first = assignments[0] || {};
  const rows = assignments.slice(0, 8).map(item => {
    const itemNames = (item.items || [])
      .map(i => i.label || i.equipmentName || i.equipmentId)
      .filter(Boolean)
      .join('、') || '防護具';
    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      margin: 'md',
      contents: [
        { type: 'text', text: item.rocDate || item.date || '未定日期', size: 'sm', color: '#202124', weight: 'bold' },
        { type: 'text', text: trimLineText_(itemNames, 90), size: 'xs', color: '#5f6368', wrap: true },
      ],
    };
  });
  const buttons = assignments
    .filter(item => item.confirmUrl)
    .slice(0, 4)
    .map(item => ({
      type: 'button',
      style: 'primary',
      height: 'sm',
      color: '#137333',
      action: {
        type: 'uri',
        label: `確認 ${item.rocDate || item.date || ''}`.trim().slice(0, 20),
        uri: item.confirmUrl,
      },
    }));

  return {
    type: 'flex',
    altText: `🦺 每日防護具待確認補發 ${assignments.length} 筆`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#137333',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 每日防護具待確認', color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: first.assigneeName || '指定同仁', color: '#E8F0FE', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `尚有 ${assignments.length} 筆場地防護具待確認，請開啟下方連結補確認。`, size: 'sm', color: '#202124', wrap: true },
          { type: 'separator', margin: 'md' },
          ...rows,
          ...(assignments.length > rows.length ? [{
            type: 'text',
            text: `... 還有 ${assignments.length - rows.length} 筆`,
            size: 'xs',
            color: '#5f6368',
            margin: 'sm',
          }] : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: buttons.length ? buttons : [
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'message', label: '查詢狀態', text: '狀態' },
          },
        ],
      },
    },
  };
}

function dailyPpeUpdateAssignmentResend_(assignmentId, pushResult, actorName, status) {
  const found = dailyPpeFindAssignment_(assignmentId);
  if (!found) return;
  const nowText = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
  const safeResult = Object.assign({}, pushResult || {});
  if (safeResult.body) safeResult.body = String(safeResult.body).substring(0, 500);
  const updates = {
    '最後補發時間': nowText,
    '補發次數': Math.max(0, Number(found.resendCount || 0) || 0) + 1,
    '最後補發者': actorName || '',
    '最後補發結果': JSON.stringify(safeResult).substring(0, 2000),
    '通知結果': JSON.stringify(Object.assign({ resend: true }, safeResult)).substring(0, 2000),
  };
  if (status) updates['狀態'] = status;
  setSheetRowValues_(found.sheet, found.headers, found.rowNo, updates);
}

function buildDailyPpeResendResultMessage_(result) {
  result = result || {};
  const failures = result.failures || [];
  const body = [
    { type: 'text', text: result.title || '補發結果', size: 'md', color: result.color || '#137333', weight: 'bold', wrap: true },
    { type: 'separator', margin: 'md' },
    { type: 'text', text: result.detail || '', size: 'sm', color: '#202124', wrap: true, margin: 'md' },
  ];
  if (failures.length) {
    body.push({ type: 'text', text: `失敗 ${failures.length} 位，請稍後再試或查看 LINE 額度。`, size: 'xs', color: '#D32F2F', wrap: true, margin: 'sm' });
  }
  return {
    type: 'flex',
    altText: result.title || '每日防護具補發結果',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: result.color || '#137333',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 防護具補發結果', color: '#ffffff', weight: 'bold', size: 'lg' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: body,
      },
    },
  };
}

function dailyPpeConfirmPageResponse_(e) {
  const template = HtmlService.createTemplateFromFile('DailyPpeConfirmPage');
  template.initialParamsJson = JSON.stringify({
    assignmentId: e.parameter.assignmentId || '',
    token: e.parameter.token || '',
  });
  return template.evaluate()
    .setTitle('每日防護具確認')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDailyPpeAssignmentPageData(payload) {
  return getDailyPpeAssignmentPageData_(payload);
}

function getDailyPpeAssignmentPageData_(payload) {
  payload = payload || {};
  const assignment = dailyPpeRequireAssignment_(payload.assignmentId, payload.token);
  return {
    ok: true,
    assignment: dailyPpeSafeAssignment_(assignment, { includeUrl: true }),
  };
}

function confirmDailyPpeAssignmentFromPage(payload) {
  return confirmDailyPpeAssignmentFromPage_(payload);
}

function confirmDailyPpeAssignmentFromPage_(payload) {
  payload = payload || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const assignment = dailyPpeRequireAssignment_(payload.assignmentId, payload.token);
    if (assignment.status === DAILY_PPE_ASSIGNMENT_STATUS_CONFIRMED) {
      return {
        ok: true,
        alreadyConfirmed: true,
        assignment: dailyPpeSafeAssignment_(assignment, { includeUrl: true }),
      };
    }
    if (assignment.status !== DAILY_PPE_ASSIGNMENT_STATUS_PENDING) {
      throw new Error('每日防護具確認連結狀態不可確認：' + assignment.status);
    }

    const date = parseISODate_(assignment.date);
    const confirmedAt = new Date();
    const remark = sanitizeText_(payload.remark || '', 500);
    const recordIds = [];
    const pdfUrls = [];

    assignment.items.forEach(item => {
      if (dailyPpeHasDailyRecordForEquipment_(item.equipmentId, date)) return;
      const created = dailyPpeCreateDailyRecord_(item.equipmentId, date, assignment, {
        confirmedAt,
        remark,
      });
      recordIds.push(created.recordId);
      pdfUrls.push(created.fileUrl);
    });

    const found = dailyPpeFindAssignment_(assignment.assignmentId);
    setSheetRowValues_(found.sheet, found.headers, found.rowNo, {
      '狀態': DAILY_PPE_ASSIGNMENT_STATUS_CONFIRMED,
      '確認時間': Utilities.formatDate(confirmedAt, tz_(), 'yyyy-MM-dd HH:mm:ss'),
      '紀錄ID清單': recordIds.join('\n'),
      'PDF連結清單': pdfUrls.join('\n'),
      '備註': remark,
    });

    const refreshed = dailyPpeFindAssignment_(assignment.assignmentId);
    return {
      ok: true,
      recordCount: recordIds.length,
      recordIds,
      pdfUrls,
      assignment: dailyPpeSafeAssignment_(refreshed, { includeUrl: true }),
    };
  } finally {
    lock.releaseLock();
  }
}

function dailyPpeCreateDailyRecord_(equipmentId, date, assignment, opts) {
  opts = opts || {};
  const equipment = getEquipmentById_(equipmentId);
  if (!equipment || !equipment.active) throw new Error('找不到啟用中的防護具場地：' + equipmentId);
  const meta = getFormMeta_('daily', equipmentId);
  const template = getTemplateForCategoryCycle_(equipment.category, 'daily', equipment);
  const normalResult = dailyPpeNormalResult_(meta.template || template);
  const recordId = uuid_();
  const submittedAt = opts.confirmedAt || new Date();
  const payload = {
    formType: 'daily',
    equipmentId,
    checkDate: formatISODate_(date),
    inspector: assignment.assigneeName,
    signature: '',
    digitalConfirmation: true,
    digitalConfirmationMode: 'LINE 指派確認',
    confirmationAssignmentId: assignment.assignmentId,
    assignedAt: assignment.createdAt,
    confirmedAt: Utilities.formatDate(submittedAt, tz_(), 'yyyy-MM-dd HH:mm:ss'),
    usageContent: dailyPpeAssignmentUsageForEquipment_(assignment, equipmentId),
    clientSubmissionId: 'daily-ppe-assignment:' + assignment.assignmentId + ':' + equipmentId,
    items: (meta.items || []).map(it => ({
      order: it.order,
      name: it.name,
      method: it.method || '',
      result: normalResult,
      note: opts.remark || 'LINE 指派確認：未接獲異常',
      abnormalDesc: '',
      photos: [],
    })),
  };

  const pdfBlob = buildPdf_('daily', {
    recordId,
    submittedAt,
    checkDate: date,
    equipment,
    payload,
    template: template || meta.template,
  });
  const folder = getOrCreateArchiveFolderForSubmission_('daily', equipment, date);
  const file = folder.createFile(pdfBlob.setName(buildPdfFilename_('daily', date, equipment)));
  const fileUrl = file.getUrl();

  writeRecord_({
    recordId,
    submittedAt,
    checkDate: date,
    formType: 'daily',
    equipment,
    payload,
    fileUrl,
    incidentCount: 0,
    approval: { status: '簽核略過' },
  });

  return { recordId, fileUrl };
}

function dailyPpeNormalResult_(template) {
  const options = (template && template.resultOptions) || [];
  if (options.length) return options[0];
  return 'V';
}

function dailyPpeAssignmentUsageForEquipment_(assignment, equipmentId) {
  const found = (assignment.items || []).find(item => String(item.equipmentId) === String(equipmentId));
  return found ? (found.usageContent || '') : '';
}

function dailyPpeRequireAssignment_(assignmentId, token) {
  const assignment = dailyPpeFindAssignment_(assignmentId);
  if (!assignment) throw new Error('每日防護具確認連結無效');
  if (String(assignment.token || '') !== String(token || '')) {
    throw new Error('每日防護具確認連結無效');
  }
  return assignment;
}

function dailyPpeFindAssignment_(assignmentId) {
  const id = String(assignmentId || '').trim();
  if (!id) return null;
  const sheet = setupDailyPpeAssignmentSheet_();
  if (sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const idCol = headers.indexOf('指派ID');
  if (idCol < 0) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][idCol] || '').trim() !== id) continue;
    return dailyPpeAssignmentFromRow_(sheet, headers, values[i], i + 2);
  }
  return null;
}

function dailyPpeListAssignments_(opts) {
  opts = opts || {};
  const sheet = setupDailyPpeAssignmentSheet_();
  if (sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const targetDate = String(opts.date || '').trim();
  const statuses = opts.statuses || [];
  return values.map((row, i) => dailyPpeAssignmentFromRow_(sheet, headers, row, i + 2))
    .filter(a => !targetDate || a.date === targetDate)
    .filter(a => !statuses.length || statuses.indexOf(a.status) >= 0);
}

function dailyPpeAssignmentFromRow_(sheet, headers, row, rowNo) {
  const get = name => {
    const i = headers.indexOf(name);
    return i >= 0 ? row[i] : '';
  };
  const rawItems = String(get('確認項目JSON') || '').trim();
  let items = [];
  try {
    items = rawItems ? JSON.parse(rawItems) : [];
  } catch (_) {
    items = [];
  }
  return {
    sheet,
    headers,
    rowNo,
    assignmentId: String(get('指派ID') || '').trim(),
    date: dailyPpeNormalizeSheetDate_(get('指派日期')),
    createdAt: formatDisplayDateTime_(get('建立時間')),
    assigneeName: String(get('指定同仁') || '').trim(),
    userId: String(get('LINE_USER_ID') || '').trim(),
    status: String(get('狀態') || '').trim(),
    confirmedAt: formatDisplayDateTime_(get('確認時間')),
    equipmentIds: String(get('場地代號清單') || '').split(/\n/).map(s => s.trim()).filter(Boolean),
    equipmentNames: String(get('場地名稱清單') || '').split(/\n/).map(s => s.trim()).filter(Boolean),
    usageSummary: String(get('場地使用摘要') || '').trim(),
    items,
    recordIds: String(get('紀錄ID清單') || '').split(/\n/).map(s => s.trim()).filter(Boolean),
    pdfUrls: String(get('PDF連結清單') || '').split(/\n/).map(s => s.trim()).filter(Boolean),
    token: String(get('Token') || '').trim(),
    noticeResult: String(get('通知結果') || '').trim(),
    remark: String(get('備註') || '').trim(),
    lastResentAt: formatDisplayDateTime_(get('最後補發時間')),
    resendCount: Math.max(0, Number(get('補發次數') || 0) || 0),
    lastResentBy: String(get('最後補發者') || '').trim(),
    lastResendResult: String(get('最後補發結果') || '').trim(),
  };
}

function dailyPpeNormalizeSheetDate_(value) {
  if (value instanceof Date) return formatISODate_(value);
  const text = String(value || '').trim();
  if (!text) return '';
  const m = text.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return text;
}

function dailyPpeRocDateLabel_(dateStr) {
  const date = parseISODate_(dateStr);
  const p = dateParts_(date);
  return `${p.y - 1911}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
}

function dailyPpeSafeMissing_(item) {
  return {
    equipmentId: item.equipmentId,
    label: item.label,
    equipmentName: item.equipmentName,
    location: item.location,
    usageContent: item.usageContent,
  };
}

function dailyPpeSafeAssignment_(assignment, opts) {
  opts = opts || {};
  if (!assignment) return null;
  const safe = {
    assignmentId: assignment.assignmentId,
    date: assignment.date,
    rocDate: assignment.date ? dailyPpeRocDateLabel_(assignment.date) : '',
    createdAt: assignment.createdAt,
    assigneeName: assignment.assigneeName,
    status: assignment.status,
    confirmedAt: assignment.confirmedAt,
    items: (assignment.items || []).map(item => ({
      equipmentId: item.equipmentId,
      label: item.label,
      equipmentName: item.equipmentName,
      location: item.location,
      usageContent: item.usageContent,
    })),
    recordIds: assignment.recordIds || [],
    pdfUrls: assignment.pdfUrls || [],
    remark: assignment.remark || '',
    lastResentAt: assignment.lastResentAt || '',
    resendCount: Math.max(0, Number(assignment.resendCount || 0) || 0),
    lastResentBy: assignment.lastResentBy || '',
  };
  if (opts.includeUrl) safe.confirmUrl = dailyPpeBuildAssignmentUrl_(assignment);
  if (opts.includeTargetUserId) safe.targetUserId = assignment.userId || '';
  return safe;
}
