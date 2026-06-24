/**
 * ===== 同仁每日作業檢核 =====
 *
 * 上班日由同仁回填 15 天後課程報備、1 天後異動、公文系統發送狀態。
 * 本模組只保留短期檢核紀錄，不產 PDF，不混入設備日檢/月檢資料。
 */

const DAILY_WORK_CHECK_SHEET_NAME = '每日作業檢核';
const DAILY_WORKDAY_EXCEPTION_SHEET_NAME = '工作日例外';
const DAILY_WORK_CHECK_OPTIONS = ['是', '否', '不適用'];
const DAILY_WORK_OFFICE_SYSTEM_URL = 'https://member.gsscloud.com/cas/login?service=https%3A%2F%2Fod.vitalyun.com%2Fsignin-cas%3Fstate%3DyL-MS4c6hquehs4K_hG8jC6R1xRwT6Zmt5tVHePQzqctjosBnm0yiz-wRVSXrXAooaEfz-UhsmamOn1ShR40xYysxjBS6gG9LhjoS62Hz5jVMw1_f33VuB-k6fS8g35pKPVaCUsNxvS_2oHFM_cbN3q4rzjvIQSdLgSc8Axhr1U2KbCSqLNb5xeBA1USDcVScQrOsaFELw9WftUd7tFa7w';

function dailyWorkCheckHeaders_() {
  return [
    '檢核日期', '填報時間', '同仁姓名',
    '15天後課程是否報備', '15天後課程備註',
    '1天後異動是否完成', '1天後異動備註',
    '公文系統是否成功發送', '公文系統備註',
    '整體備註',
  ];
}

function setupDailyWorkCheckSheets_(ss) {
  setupSheet_(ss, DAILY_WORK_CHECK_SHEET_NAME, dailyWorkCheckHeaders_(), []);
  setupSheet_(ss, DAILY_WORKDAY_EXCEPTION_SHEET_NAME,
    ['日期', '類型', '名稱', '是否上班', '備註'],
    []
  );
}

function getDailyWorkCheckSheet_(ss) {
  return ss.getSheetByName(DAILY_WORK_CHECK_SHEET_NAME);
}

function getStaffFlagColumnIndex_(headers) {
  return headers.indexOf('是否為同仁');
}

function getDailyWorkStaffUsers_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getLineSubscriberSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const staffCol = getStaffFlagColumnIndex_(headers);
  const idCol = headers.indexOf('LINE_USER_ID');
  if (nameCol < 0 || staffCol < 0) return [];

  const users = [];
  data.slice(1).forEach(row => {
    const name = String(row[nameCol] || '').trim();
    const isStaff = isActiveValue_(row[staffCol]);
    const userId = idCol >= 0 ? String(row[idCol] || '').trim() : '';
    if (name && isStaff) users.push({ name, userId });
  });

  const seen = new Set();
  return users.filter(user => {
    const key = user.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getDailyWorkStaffNames_() {
  return getDailyWorkStaffUsers_().map(u => u.name);
}

function getDailyWorkStaffByUserId_(userId) {
  const id = String(userId || '').trim();
  if (!id) return null;
  return getDailyWorkStaffUsers_().find(u => u.userId === id) || null;
}

function getDailyWorkMeta_() {
  const today = todayStart_();
  return {
    ok: true,
    date: formatISODate_(today),
    dateLabel: formatDailyWorkDateLabel_(today),
    isBusinessDay: isBusinessDay_(today),
    staffNames: getDailyWorkStaffNames_(),
    officeSystemUrl: DAILY_WORK_OFFICE_SYSTEM_URL,
  };
}

function submitDailyWorkCheck_(payload) {
  payload = payload || {};
  const today = todayStart_();
  if (!isBusinessDay_(today)) throw new Error('每日作業檢核：今日非上班日，不需填寫');

  const staffName = sanitizeText_(payload.staffName, 80).trim();
  if (!staffName) throw new Error('每日作業檢核：請選擇同仁姓名');

  const staffNames = getDailyWorkStaffNames_();
  if (staffNames.indexOf(staffName) < 0) {
    throw new Error('每日作業檢核：同仁姓名不在「訂閱者清單」的同仁名單內');
  }

  const courseReported = sanitizeDailyWorkOption_(payload.courseReported, '15天後課程是否報備');
  const changeUpdated = sanitizeDailyWorkOption_(payload.changeUpdated, '1天後異動是否完成');
  const officeSent = sanitizeDailyWorkOption_(payload.officeSent, '公文系統是否成功發送');
  const record = {
    '檢核日期': formatISODate_(today),
    '填報時間': Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
    '同仁姓名': staffName,
    '15天後課程是否報備': courseReported,
    '15天後課程備註': sanitizeText_(payload.courseNote, 500),
    '1天後異動是否完成': changeUpdated,
    '1天後異動備註': sanitizeText_(payload.changeNote, 500),
    '公文系統是否成功發送': officeSent,
    '公文系統備註': sanitizeText_(payload.officeNote, 500),
    '整體備註': sanitizeText_(payload.overallNote, 500),
  };

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  setupDailyWorkCheckSheets_(ss);
  const sheet = getDailyWorkCheckSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const existingRowNo = findDailyWorkRecordRow_(sheet, headers, record['檢核日期'], staffName);
  const row = headers.map(h => record[h] !== undefined ? record[h] : '');
  if (existingRowNo > 0) {
    sheet.getRange(existingRowNo, 1, 1, headers.length).setValues([row]);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  }
  SpreadsheetApp.flush();

  return {
    ok: true,
    updated: existingRowNo > 0,
    staffName,
    date: record['檢核日期'],
    dateLabel: formatDailyWorkDateLabel_(today),
  };
}

function sanitizeDailyWorkOption_(value, label) {
  const s = sanitizeText_(value, 20).trim();
  if (DAILY_WORK_CHECK_OPTIONS.indexOf(s) < 0) {
    throw new Error('每日作業檢核：' + label + ' 請選擇「是、否、不適用」');
  }
  return s;
}

function findDailyWorkRecordRow_(sheet, headers, dateStr, staffName) {
  if (!sheet || sheet.getLastRow() < 2) return -1;
  const dateCol = headers.indexOf('檢核日期');
  const nameCol = headers.indexOf('同仁姓名');
  if (dateCol < 0 || nameCol < 0) return -1;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < values.length; i++) {
    const rowDate = normalizeSheetDateString_(values[i][dateCol]);
    const rowName = String(values[i][nameCol] || '').trim();
    if (rowDate === dateStr && rowName === staffName) return i + 2;
  }
  return -1;
}

function getDailyWorkCheckStatus_(opts) {
  opts = opts || {};
  const date = opts.date || todayStart_();
  const dateStr = formatISODate_(date);
  const staff = getDailyWorkStaffUsers_();
  const businessDay = isBusinessDay_(date);
  const completedBy = {};
  const submittedAtBy = {};

  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    const sheet = getDailyWorkCheckSheet_(ss);
    if (sheet && sheet.getLastRow() >= 2) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h || '').trim());
      const dateCol = headers.indexOf('檢核日期');
      const nameCol = headers.indexOf('同仁姓名');
      const timeCol = headers.indexOf('填報時間');
      if (dateCol >= 0 && nameCol >= 0) {
        data.slice(1).forEach(row => {
          const rowDate = normalizeSheetDateString_(row[dateCol]);
          const name = String(row[nameCol] || '').trim();
          if (rowDate === dateStr && name) {
            completedBy[name] = true;
            submittedAtBy[name] = timeCol >= 0 ? String(row[timeCol] || '').trim() : '';
          }
        });
      }
    }
  } catch (err) {
    Logger.log('[DailyWork] 讀取每日作業檢核狀態失敗：' + err);
  }

  const completed = staff.filter(u => completedBy[u.name]);
  const pending = staff.filter(u => !completedBy[u.name]);
  const current = opts.userId ? getDailyWorkStaffByUserId_(opts.userId) : null;
  return {
    date: dateStr,
    dateLabel: formatDailyWorkDateLabel_(date),
    isBusinessDay: businessDay,
    total: staff.length,
    completedCount: completed.length,
    pendingCount: pending.length,
    completedNames: completed.map(u => u.name),
    pendingNames: pending.map(u => u.name),
    submittedAtBy,
    currentUserName: current ? current.name : '',
    currentUserIsStaff: !!current,
    currentUserCompleted: current ? !!completedBy[current.name] : false,
    reminders: getDailyWorkReminderState_(dateStr),
  };
}

function getDailyWorkReminderState_(dateStr) {
  const props = PropertiesService.getScriptProperties();
  return {
    reminder1630: props.getProperty('DAILY_WORK_REMINDER_1630_' + dateStr) === 'sent',
    reminder1700: props.getProperty('DAILY_WORK_REMINDER_1700_' + dateStr) === 'sent',
  };
}

function markDailyWorkReminderSent_(dateStr, slot) {
  const key = slot === '17:00' ? 'DAILY_WORK_REMINDER_1700_' : 'DAILY_WORK_REMINDER_1630_';
  PropertiesService.getScriptProperties().setProperty(key + dateStr, 'sent');
}

function dailyWorkCheckReminder1630Job() {
  return sendDailyWorkCheckReminder_('16:30');
}

function dailyWorkCheckReminder1700Job() {
  return sendDailyWorkCheckReminder_('17:00');
}

function sendDailyWorkCheckReminder_(slot) {
  const status = getDailyWorkCheckStatus_();
  if (!status.isBusinessDay) return { ok: true, skipped: true, reason: 'non_business_day', slot };
  if (status.total <= 0) return { ok: false, reason: 'no_staff', slot };
  if (status.pendingCount <= 0) return { ok: true, skipped: true, reason: 'all_done', slot, status };

  const flex = buildDailyWorkReminderFlex_(status, slot);
  const result = linePushToSupervisors_(withQuickReply_(flex));
  if (result && result.ok) markDailyWorkReminderSent_(status.date, slot);
  return Object.assign({ slot, status }, result || {});
}

function dailyWorkCheckCleanupJob() {
  return cleanupDailyWorkChecks_();
}

function cleanupDailyWorkChecks_(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const today = todayStart_();
  const cutoff = parseISODate_(formatISODate_(today));
  cutoff.setDate(cutoff.getDate() - 2);
  const cutoffStr = formatISODate_(cutoff);

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getDailyWorkCheckSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, deleted: 0, cutoff: cutoffStr };

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const dateCol = headers.indexOf('檢核日期');
  if (dateCol < 0) throw new Error('每日作業檢核：找不到檢核日期欄位');

  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const rowDate = normalizeSheetDateString_(data[i][dateCol]);
    if (rowDate && rowDate < cutoffStr) rowsToDelete.push(i + 1);
  }
  if (!dryRun) {
    rowsToDelete.reverse().forEach(rowNo => sheet.deleteRow(rowNo));
    SpreadsheetApp.flush();
  }
  return { ok: true, dryRun, deleted: rowsToDelete.length, cutoff: cutoffStr };
}

function installDailyWorkCheckTriggers() {
  const handlers = [
    'dailyWorkCheckReminder1630Job',
    'dailyWorkCheckReminder1700Job',
    'dailyWorkCheckCleanupJob',
  ];
  ScriptApp.getProjectTriggers()
    .filter(t => handlers.indexOf(t.getHandlerFunction()) >= 0)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('dailyWorkCheckReminder1630Job')
    .timeBased()
    .everyDays(1)
    .atHour(16)
    .nearMinute(30)
    .create();
  ScriptApp.newTrigger('dailyWorkCheckReminder1700Job')
    .timeBased()
    .everyDays(1)
    .atHour(17)
    .nearMinute(0)
    .create();
  ScriptApp.newTrigger('dailyWorkCheckCleanupJob')
    .timeBased()
    .everyDays(1)
    .atHour(0)
    .nearMinute(30)
    .create();
  return { ok: true, installed: handlers };
}

function isBusinessDay_(date) {
  const target = formatISODate_(date || todayStart_());
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    const sheet = ss.getSheetByName(DAILY_WORKDAY_EXCEPTION_SHEET_NAME);
    if (sheet && sheet.getLastRow() >= 2) {
      const data = sheet.getDataRange().getValues();
      const headers = data[0].map(h => String(h || '').trim());
      const dateCol = headers.indexOf('日期');
      const workCol = headers.indexOf('是否上班');
      if (dateCol >= 0 && workCol >= 0) {
        for (let i = 1; i < data.length; i++) {
          const rowDate = normalizeSheetDateString_(data[i][dateCol]);
          if (rowDate === target) return isActiveValue_(data[i][workCol]);
        }
      }
    }
  } catch (err) {
    Logger.log('[DailyWork] 工作日例外讀取失敗，改用週一至週五：' + err);
  }
  const day = (date || todayStart_()).getDay();
  return day >= 1 && day <= 5;
}

function normalizeSheetDateString_(value) {
  if (value instanceof Date) return formatISODate_(value);
  const s = String(value || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return s;
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`;
}

function formatDailyWorkDateLabel_(date) {
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const p = dateParts_(date);
  return `${p.y - 1911}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}（${weekdays[date.getDay()]}）`;
}

function buildDailyWorkCheckPublicUrl_() {
  const frontend = String(getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL || '')
    .replace(/\/$/, '');
  return frontend ? `${frontend}/work-check.html` : 'https://isha-taichung.github.io/auto-checklist/work-check.html';
}
