/**
 * ===== 每日場地防護具未填提醒 =====
 *
 * 目的：
 *   - VENUE-CRANE / VENUE-FORK 對應機具當天場地有使用且尚未有人填防護具日檢時，
 *     於固定時段提醒指定窗口（目前為卓小媛、張家豪）人工催填。
 *   - 本流程只提醒，不建立指派、不產生 PDF；正式紀錄仍由同仁開啟每日檢點表手寫簽名後送出。
 */

const DAILY_PPE_ASSIGNMENT_EQUIPMENTS = [
  { id: 'VENUE-CRANE', label: '起重機防護具', usageCategory: '固定式起重機', usageEquipmentId: 'CRANE-LJ-001' },
  { id: 'VENUE-FORK', label: '堆高機防護具', usageCategory: '堆高機', usageEquipmentId: 'FORK-LJ-A' },
];
const DAILY_PPE_REMINDER_DEFAULT_RECIPIENTS = '卓小媛,張家豪';

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
  const targets = dailyPpeReminderTargets_();
  return {
    ok: true,
    date: formatISODate_(targetDate),
    missingCount: missing.length,
    missing: missing.map(dailyPpeSafeMissing_),
    reminderRecipientNames: dailyPpeReminderRecipientNames_(),
    reminderTargetCount: targets.ids.length,
    reminderTargets: targets.names,
    targetErrors: targets.errors,
    pendingCount: 0,
    pending: [],
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
  return {
    ok: true,
    mode: 'manual-signature-reminder',
    lookbackDays: 0,
    viewerIsSupervisor: opts.viewerIsSupervisor === true,
    resendMinAgeDays: 0,
    count: 0,
    items: [],
    truncatedCount: 0,
    resendEligibleCount: 0,
  };
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
    const missing = dailyPpeCollectMissingConfirmations_(targetDate);
    if (!missing.length) {
      return { ok: true, action: 'skip', reason: 'no_missing_used_venue', date: dateStr };
    }

    const targets = dailyPpeReminderTargets_();
    if (!targets.ids.length) {
      return {
        ok: false,
        action: 'failed',
        reason: 'no_reminder_target',
        date: dateStr,
        reminderRecipientNames: dailyPpeReminderRecipientNames_(),
        targetErrors: targets.errors,
        missing: missing.map(dailyPpeSafeMissing_),
      };
    }

    if (dryRun) {
      return {
        ok: true,
        action: 'wouldNotifyDailyPpeMissing',
        date: dateStr,
        targetCount: targets.ids.length,
        targets: targets.names,
        missing: missing.map(dailyPpeSafeMissing_),
      };
    }

    const pushed = dailyPpePushMissingReminder_(targets.ids, missing, targetDate);
    return {
      ok: pushed && pushed.ok !== false,
      action: pushed && pushed.ok !== false ? 'notifiedDailyPpeMissing' : 'push_failed',
      date: dateStr,
      targetCount: targets.ids.length,
      targets: targets.names,
      missing: missing.map(dailyPpeSafeMissing_),
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
    const usageProbe = dailyPpeUsageProbeEquipment_(def, equipment);
    const usage = getVenueUsage_(usageProbe, date);
    if (!usage || !usage.used) return;
    if (dailyPpeHasDailyRecordForEquipment_(def.id, date)) return;
    out.push({
      equipmentId: def.id,
      label: def.label,
      equipmentName: equipment.equipmentName || def.label,
      category: equipment.category || '防護具檢點',
      location: equipment.location || '',
      usageContent: usage.content || '',
      usageCategory: usageProbe.category || equipment.category || '',
      equipment,
    });
  });
  return out;
}

function dailyPpeUsageProbeEquipment_(def, ppeEquipment) {
  const usageCategory = String((def && def.usageCategory) || '').trim();
  const probe = Object.assign({}, ppeEquipment || {});
  if (usageCategory) probe.category = usageCategory;

  if (!String(probe.venueSheetTab || '').trim()) {
    const linkedId = String((def && def.usageEquipmentId) || '').trim();
    const linked = linkedId ? getEquipmentById_(linkedId) : null;
    if (linked && String(linked.venueSheetTab || '').trim()) {
      probe.venueSheetTab = linked.venueSheetTab;
    }
  }

  return probe;
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

function dailyPpeReminderRecipientNames_() {
  const raw = String(getSetting_('dailyPpeReminderRecipientNames', DAILY_PPE_REMINDER_DEFAULT_RECIPIENTS) || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,\uFF0C、;\n\r\t ]+/)
    .map(name => String(name || '').trim())
    .filter(Boolean);
}

function dailyPpeReminderTargets_() {
  const names = dailyPpeReminderRecipientNames_();
  const ids = [];
  const resolvedNames = [];
  const errors = [];
  names.forEach(name => {
    const found = findLineSubscriberTargetsByName_(name, {});
    if (found && found.ids && found.ids.length) {
      found.ids.forEach(id => {
        if (ids.indexOf(id) < 0) ids.push(id);
      });
      resolvedNames.push(name);
    } else {
      errors.push({ name, reason: (found && found.error) || 'not_found_or_unsubscribed' });
    }
  });
  return { ids, names: resolvedNames, configuredNames: names, errors };
}

function dailyPpePublicDailyUrl_(equipmentId) {
  const frontend = String(getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL || '')
    .replace(/\/+$/, '');
  const base = frontend || 'https://isha-taichung.github.io/auto-checklist';
  return `${base}/daily.html?eqp=${encodeURIComponent(equipmentId)}`;
}

function dailyPpePushMissingReminder_(targetIds, missing, date) {
  const ids = Array.from(new Set((targetIds || []).map(id => String(id || '').trim()).filter(Boolean)));
  if (!ids.length) return { ok: false, reason: 'no_target' };
  const message = dailyPpeBuildMissingReminderFlex_(missing, date);
  return ids.length > 1
    ? lineMulticast_(ids, withQuickReply_([message]))
    : linePushTo_(ids[0], withQuickReply_([message]), 'push');
}

function dailyPpeBuildMissingReminderFlex_(missing, date) {
  const safeMissing = (missing || []).map(dailyPpeSafeMissing_);
  const dateText = dailyPpeRocDateLabel_(formatISODate_(date));
  const rows = safeMissing.map(item => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'md',
    contents: [
      { type: 'text', text: item.equipmentName || item.label || item.equipmentId, size: 'sm', color: '#202124', weight: 'bold', wrap: true },
      { type: 'text', text: item.usageContent || '場地有使用', size: 'xs', color: '#5f6368', wrap: true },
    ],
  }));
  const buttons = safeMissing.slice(0, 2).map(item => ({
    type: 'button',
    style: 'primary',
    height: 'sm',
    color: '#F29900',
    action: {
      type: 'uri',
      label: `填寫${(item.label || '防護具').replace('防護具', '')}`.slice(0, 20),
      uri: dailyPpePublicDailyUrl_(item.equipmentId),
    },
  }));

  return {
    type: 'flex',
    altText: `🦺 ${dateText} 每日場地防護具未檢點 ${safeMissing.length} 項`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#F29900',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 每日場地防護具未檢點', color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: dateText, color: '#FFF3E0', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: `場地有使用，但尚有 ${safeMissing.length} 項每日防護具檢點未完成。請協助提醒現場同仁開表填寫並手寫簽名。`, size: 'sm', color: '#202124', wrap: true },
          { type: 'separator', margin: 'md' },
          ...rows,
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
            action: { type: 'message', label: 'QR 選單', text: 'QR選單' },
          },
        ],
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
  throw new Error('每日防護具待確認功能已停用，請改由 QR 選單開啟每日場地防護具檢點表並手寫簽名。');
}

function confirmDailyPpeAssignmentFromPage(payload) {
  return confirmDailyPpeAssignmentFromPage_(payload);
}

function confirmDailyPpeAssignmentFromPage_(payload) {
  throw new Error('每日防護具待確認功能已停用，請改由 QR 選單開啟每日場地防護具檢點表並手寫簽名。');
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
