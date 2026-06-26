/**
 * ===== 日常異常事件通報模組（Phase A additive）=====
 *
 * 這條流程獨立於既有設備檢查與「機具設備異常事件」表：
 * - 公開 incident.html 建立事件
 * - GAS 內部 token 頁更新處理狀況 / 主管審核
 * - 填單即產 PDF；每次更新/送審/審核都重產目前階段 PDF 並保留流程時序
 */

const DAILY_INCIDENT_SHEET_NAME = '日常異常事件通報';
const DAILY_INCIDENT_LEGACY_SHEET_NAMES = ['日常事件通報'];
const DAILY_INCIDENT_ARCHIVE_DEFAULT = '日常異常事件通報';
const DAILY_INCIDENT_ARCHIVE_LEGACY_DEFAULT = '日常異常事件';
const DAILY_INCIDENT_MAX_PHOTOS = 8;
const DAILY_INCIDENT_SUBJECTS = ['環境設施', '場地使用', '安全衛生', '人員反映', '其他'];
const DAILY_INCIDENT_PROCESS_STATUSES = ['待處理', '處理中', '處理完成'];
const DAILY_INCIDENT_REVIEW_STATUSES = ['未送審', '待主管審核', '已結案', '退回補正'];
// 試算表實體欄位先維持舊名，避免影響既有資料/篩選器；對外 UI/PDF/LINE 顯示用「異常事項」。
const DAILY_INCIDENT_DESCRIPTION_HEADER = '異常事情';
const DAILY_INCIDENT_DESCRIPTION_DISPLAY_LABEL = '異常事項';
const DAILY_INCIDENT_DESCRIPTION_ALT_HEADER = '異常事項';

function dailyIncidentHeaders_(descriptionHeader) {
  const descHeader = descriptionHeader || DAILY_INCIDENT_DESCRIPTION_HEADER;
  return [
    '事件ID', '建立時間', '填報日期', '發生地點', '填報人', '承辦人',
    '填報事項', descHeader, '處理狀況', '處理說明', '處理完成日期',
    '陳核主管', '審核狀態', '主管審核意見', '主管審核時間',
    '照片數', '照片資料夾連結', 'PDF連結', '待審PDF檔案ID',
    '承辦更新Token', '主管審核Token', 'clientSubmissionId', '流程紀錄', '備註',
  ];
}

function setupDailyIncidentSheet_(ss) {
  migrateDailyIncidentSheetName_(ss);
  const existing = getDailyIncidentSheet_(ss);
  const descHeader = existing
    ? dailyIncidentDescriptionHeaderFor_(existing.getRange(1, 1, 1, Math.max(existing.getLastColumn(), 1)).getValues()[0].map(h => String(h || '').trim()))
    : DAILY_INCIDENT_DESCRIPTION_HEADER;
  setupSheet_(ss, DAILY_INCIDENT_SHEET_NAME, dailyIncidentHeaders_(descHeader), []);
  setupDailyIncidentValidations_(ss);
}

function migrateDailyIncidentSheetName_(ss) {
  const current = ss.getSheetByName(DAILY_INCIDENT_SHEET_NAME);
  if (current) return current;
  for (let i = 0; i < DAILY_INCIDENT_LEGACY_SHEET_NAMES.length; i++) {
    const legacy = ss.getSheetByName(DAILY_INCIDENT_LEGACY_SHEET_NAMES[i]);
    if (!legacy) continue;
    try {
      legacy.setName(DAILY_INCIDENT_SHEET_NAME);
      return legacy;
    } catch (err) {
      Logger.log('日常事件分頁改名失敗，沿用舊分頁：' + err);
      return legacy;
    }
  }
  return null;
}

function getDailyIncidentSheet_(ss) {
  return migrateDailyIncidentSheetName_(ss) || ss.getSheetByName(DAILY_INCIDENT_SHEET_NAME);
}

function dailyIncidentDescriptionHeaderFor_(headers) {
  if (headers.indexOf(DAILY_INCIDENT_DESCRIPTION_HEADER) >= 0) return DAILY_INCIDENT_DESCRIPTION_HEADER;
  if (headers.indexOf(DAILY_INCIDENT_DESCRIPTION_ALT_HEADER) >= 0) return DAILY_INCIDENT_DESCRIPTION_ALT_HEADER;
  return DAILY_INCIDENT_DESCRIPTION_HEADER;
}

function setupDailyIncidentValidations_(ss) {
  const sheet = getDailyIncidentSheet_(ss);
  if (!sheet) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const processCol = headers.indexOf('處理狀況') + 1;
  const reviewCol = headers.indexOf('審核狀態') + 1;
  const subjectCol = headers.indexOf('填報事項') + 1;
  const maxRows = Math.max(sheet.getMaxRows() - 1, 1);
  if (processCol > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(DAILY_INCIDENT_PROCESS_STATUSES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, processCol, maxRows, 1).setDataValidation(rule);
  }
  if (reviewCol > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(DAILY_INCIDENT_REVIEW_STATUSES, true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, reviewCol, maxRows, 1).setDataValidation(rule);
  }
  if (subjectCol > 0) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(DAILY_INCIDENT_SUBJECTS, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, subjectCol, maxRows, 1).setDataValidation(rule);
  }
}

function ensureDailyIncidentSettings_(ss) {
  ensureSystemSettingDefaults_(ss, [
    ['dailyIncidentGroupNotify', '是', '日常異常事件是否推播給承辦同仁與主管'],
    ['dailyIncidentSupervisorNotify', '是', '日常異常事件陳核時是否推播主管'],
    ['dailyIncidentArchiveFolderName', DAILY_INCIDENT_ARCHIVE_DEFAULT, '日常異常事件通報 Drive 子資料夾名稱'],
  ]);
  normalizeDailyIncidentArchiveSetting_(ss);
}

function normalizeDailyIncidentArchiveSetting_(ss) {
  const sheet = ss.getSheetByName('系統設定');
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0] || '').trim() !== 'dailyIncidentArchiveFolderName') continue;
    const value = String(values[i][1] || '').trim();
    if (!value || value === DAILY_INCIDENT_ARCHIVE_LEGACY_DEFAULT) {
      sheet.getRange(i + 2, 2).setValue(DAILY_INCIDENT_ARCHIVE_DEFAULT);
    }
    sheet.getRange(i + 2, 3).setValue('日常異常事件通報 Drive 子資料夾名稱');
    return;
  }
}

function handleDailyIncidentSubmission_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    setupDailyIncidentSheet_(ss);
    ensureDailyIncidentSettings_(ss);

    const clientId = sanitizeText_(payload.clientSubmissionId, 80);
    const existing = findDailyIncidentByClientId_(clientId);
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        incidentId: existing.incidentId,
        photoFolderUrl: existing.photoFolderUrl,
        pdfUrl: existing.pdfUrl || '',
        reviewStatus: existing.reviewStatus || '',
      };
    }

    const reportDate = parseISODate_(sanitizeText_(payload.reportDate, 20) || formatISODate_(new Date()));
    const reportDateStr = formatISODate_(reportDate);
    const createdAt = new Date();
    const incidentId = nextDailyIncidentId_(ss, reportDate);
    const data = {
      incidentId,
      createdAtStr: Utilities.formatDate(createdAt, tz_(), 'yyyy-MM-dd HH:mm:ss'),
      reportDate: reportDateStr,
      location: requiredText_(payload.location, '發生地點', 120),
      reporter: requiredText_(payload.reporter, '填報人', 80),
      owner: requiredText_(payload.owner || payload.reporter, '承辦人', 80),
      subject: requiredText_(payload.subject, '填報事項', 80),
      description: requiredText_(payload.description, DAILY_INCIDENT_DESCRIPTION_DISPLAY_LABEL, 1000),
      processStatus: sanitizeDailyIncidentProcessStatus_(payload.processStatus || '待處理'),
      processNote: sanitizeText_(payload.processNote, 1000),
      completedDate: sanitizeText_(payload.completedDate, 20),
      supervisor: sanitizeText_(payload.supervisor, 80),
      reviewStatus: '未送審',
      reviewComment: '',
      reviewTime: '',
      pdfUrl: '',
      pendingPdfFileId: '',
      updateToken: makeDailyIncidentToken_(),
      approvalToken: makeDailyIncidentToken_(),
      clientSubmissionId: clientId,
      note: sanitizeText_(payload.note, 500),
    };
    if (data.processStatus === '處理完成' && !data.completedDate) {
      data.completedDate = reportDateStr;
    }
    if (data.processStatus === '處理完成' && !data.supervisor) {
      throw new Error('處理完成時請填寫陳核主管');
    }

    const photoFolder = getOrCreateDailyIncidentPhotoFolder_(incidentId, reportDate);
    const savedPhotos = saveDailyIncidentPhotos_(photoFolder, incidentId, payload.photos || [], '通報照片');
    data.photoCount = savedPhotos.length;
    data.photoFolderUrl = photoFolder.getUrl();
    data.flowLog = appendDailyIncidentFlowLog_(
      '',
      '通報建立',
      data.reporter,
      `填報事項：${data.subject}；處理狀況：${data.processStatus}`,
      data.createdAtStr
    );

    appendDailyIncidentRow_(ss, data);
    let createdRecord = getDailyIncidentRecord_(incidentId);
    const initialPdf = createDailyIncidentPdf_(data, 'reported');
    updateDailyIncidentRow_(createdRecord, { 'PDF連結': initialPdf.fileUrl });
    data.pdfUrl = initialPdf.fileUrl;
    SpreadsheetApp.flush();
    let notify = null;
    let approval = null;
    let supervisorNotice = null;
    if (data.processStatus === '處理完成') {
      approval = submitDailyIncidentForApproval_({
        incidentId,
        token: data.updateToken,
        supervisor: data.supervisor,
      });
      notify = approval.approvalNotice;
    } else {
      notify = maybeNotifyDailyIncidentCreated_(data);
      if (data.processStatus === '處理中' && data.supervisor) {
        supervisorNotice = maybeNotifyDailyIncidentProcessingSupervisor_(data);
      }
    }

    return {
      ok: true,
      incidentId,
      photoCount: data.photoCount,
      photoFolderUrl: data.photoFolderUrl,
      lineNotice: notify,
      supervisorNotice,
      approvalNotice: approval ? approval.approvalNotice : null,
      pdfUrl: approval && approval.incident ? approval.incident.pdfUrl : data.pdfUrl,
      reviewStatus: approval && approval.incident ? approval.incident.reviewStatus : data.reviewStatus,
    };
  } finally {
    lock.releaseLock();
  }
}

function updateDailyIncident_(payload) {
  const incidentId = normalizeDailyIncidentId_(payload.incidentId);
  const token = sanitizeText_(payload.token, 120);
  const found = getDailyIncidentRecord_(incidentId);
  assertDailyIncidentUpdateToken_(found.data, token);
  if (found.data.reviewStatus === '已結案') throw new Error('此日常事件已結案，不能再更新');
  if (found.data.reviewStatus === '待主管審核') throw new Error('此日常事件已送主管審核，請等待主管審核或退回');

  const processStatus = sanitizeDailyIncidentProcessStatus_(payload.processStatus || found.data.processStatus || '待處理');
  const processNote = sanitizeText_(payload.processNote, 1000);
  const completedDate = processStatus === '處理完成'
    ? (sanitizeText_(payload.completedDate, 20) || formatISODate_(new Date()))
    : sanitizeText_(payload.completedDate, 20);
  if (completedDate) parseISODate_(completedDate);

  const supervisor = sanitizeText_(payload.supervisor, 80);
  const photos = normalizeDailyIncidentPhotos_(payload.photos || []);
  const currentCount = Number(found.data.photoCount || 0);
  if (currentCount + photos.length > DAILY_INCIDENT_MAX_PHOTOS) {
    throw new Error(`照片超過 ${DAILY_INCIDENT_MAX_PHOTOS} 張上限`);
  }
  if (photos.length > 0) {
    const date = parseISODate_(found.data.reportDate);
    const folder = getOrCreateDailyIncidentPhotoFolder_(incidentId, date);
    const photoStage = found.data.reviewStatus === '退回補正' ? '補正照片' : '處理照片';
    saveDailyIncidentPhotos_(folder, incidentId, photos, photoStage, currentCount);
    found.data.photoFolderUrl = folder.getUrl();
  }

  const updates = {
    '處理狀況': processStatus,
    '處理說明': processNote,
    '處理完成日期': completedDate,
    '陳核主管': supervisor || found.data.supervisor,
    '照片數': currentCount + photos.length,
    '照片資料夾連結': found.data.photoFolderUrl,
    '流程紀錄': appendDailyIncidentFlowLog_(
      found.data.flowLog,
      '承辦更新',
      found.data.owner || '',
      `處理狀況：${processStatus}；處理說明：${processNote || '未填寫'}`,
      dailyIncidentNow_()
    ),
  };
  if (found.data.reviewStatus === '退回補正') {
    updates['審核狀態'] = '未送審';
    updates['待審PDF檔案ID'] = '';
  }
  updateDailyIncidentRow_(found, updates);
  SpreadsheetApp.flush();
  let refreshed = getDailyIncidentRecord_(incidentId);
  const pdf = createDailyIncidentPdf_(refreshed.data, 'processing');
  updateDailyIncidentRow_(refreshed, { 'PDF連結': pdf.fileUrl });
  SpreadsheetApp.flush();
  refreshed = getDailyIncidentRecord_(incidentId);
  let supervisorNotice = null;
  if (refreshed.data.processStatus === '處理中' && refreshed.data.supervisor) {
    supervisorNotice = maybeNotifyDailyIncidentProcessingSupervisor_(refreshed.data);
  }
  return { ok: true, incident: publicDailyIncidentSummary_(refreshed.data), supervisorNotice };
}

function submitDailyIncidentForApproval_(payload) {
  const incidentId = normalizeDailyIncidentId_(payload.incidentId);
  const token = sanitizeText_(payload.token, 120);
  const found = getDailyIncidentRecord_(incidentId);
  if (token) assertDailyIncidentUpdateToken_(found.data, token);
  if (found.data.reviewStatus === '已結案') throw new Error('此日常事件已結案');
  if (found.data.reviewStatus === '待主管審核') {
    found.data.flowLog = appendDailyIncidentFlowLog_(
      found.data.flowLog,
      '重新通知主管',
      found.data.owner || '',
      `主管：${found.data.supervisor || ''}`,
      dailyIncidentNow_()
    );
    const pdf = createDailyIncidentPdf_(found.data, 'pending');
    updateDailyIncidentRow_(found, { '流程紀錄': found.data.flowLog, 'PDF連結': pdf.fileUrl, '待審PDF檔案ID': pdf.fileId });
    const refreshedPending = getDailyIncidentRecord_(incidentId);
    const notice = maybeNotifyDailyIncidentApproval_(refreshedPending.data);
    SpreadsheetApp.flush();
    return { ok: true, alreadyPending: true, incident: publicDailyIncidentSummary_(refreshedPending.data), approvalNotice: notice };
  }
  if (found.data.processStatus !== '處理完成') throw new Error('處理完成後才能陳核主管');
  const supervisor = sanitizeText_(payload.supervisor, 80) || found.data.supervisor;
  if (!supervisor) throw new Error('缺少陳核主管');

  found.data.supervisor = supervisor;
  found.data.reviewStatus = '待主管審核';
  found.data.flowLog = appendDailyIncidentFlowLog_(
    found.data.flowLog,
    '送主管審核',
    found.data.owner || '',
    `主管：${supervisor}`,
    dailyIncidentNow_()
  );
  const pdf = createDailyIncidentPdf_(found.data, 'pending');
  const updates = {
    '陳核主管': supervisor,
    '審核狀態': '待主管審核',
    'PDF連結': pdf.fileUrl,
    '待審PDF檔案ID': pdf.fileId,
    '流程紀錄': found.data.flowLog,
  };
  updateDailyIncidentRow_(found, updates);
  const refreshed = getDailyIncidentRecord_(incidentId);
  const notice = maybeNotifyDailyIncidentApproval_(refreshed.data);
  SpreadsheetApp.flush();
  return { ok: true, incident: publicDailyIncidentSummary_(refreshed.data), approvalNotice: notice };
}

function approveDailyIncident_(payload) {
  const incidentId = normalizeDailyIncidentId_(payload.incidentId);
  const token = sanitizeText_(payload.token, 120);
  const decision = sanitizeText_(payload.decision, 20) || 'approve';
  const comment = sanitizeText_(payload.reviewComment, 1000);
  const found = getDailyIncidentRecord_(incidentId);
  assertDailyIncidentApprovalToken_(found.data, token);
  if (found.data.reviewStatus === '已結案') {
    return { ok: true, alreadyClosed: true, incident: publicDailyIncidentSummary_(found.data) };
  }
  if (found.data.reviewStatus !== '待主管審核') {
    return {
      ok: true,
      invalidState: true,
      message: '此日常事件尚未送主管審核',
      incident: publicDailyIncidentSummary_(found.data),
    };
  }

  const reviewTime = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
  if (decision === 'return') {
    found.data.reviewStatus = '退回補正';
    found.data.reviewComment = comment || '退回補正';
    found.data.reviewTime = reviewTime;
    found.data.flowLog = appendDailyIncidentFlowLog_(
      found.data.flowLog,
      '主管退回補正',
      found.data.supervisor || '',
      found.data.reviewComment,
      reviewTime
    );
    const returnPdf = createDailyIncidentPdf_(found.data, 'returned');
    updateDailyIncidentRow_(found, {
      '審核狀態': '退回補正',
      '主管審核意見': comment || '退回補正',
      '主管審核時間': reviewTime,
      'PDF連結': returnPdf.fileUrl,
      '流程紀錄': found.data.flowLog,
    });
    SpreadsheetApp.flush();
    const refreshedReturn = getDailyIncidentRecord_(incidentId);
    const returnNotice = maybeNotifyDailyIncidentReturned_(refreshedReturn.data);
    return {
      ok: true,
      returned: true,
      incident: publicDailyIncidentSummary_(refreshedReturn.data),
      returnNotice,
    };
  }
  if (decision !== 'approve') throw new Error('審核決定不合法');

  found.data.reviewComment = comment;
  found.data.reviewTime = reviewTime;
  found.data.reviewStatus = '已結案';
  found.data.flowLog = appendDailyIncidentFlowLog_(
    found.data.flowLog,
    '主管同意結案',
    found.data.supervisor || '',
    comment || '同意結案',
    reviewTime
  );
  const pdf = createDailyIncidentPdf_(found.data, 'closed');
  updateDailyIncidentRow_(found, {
    '審核狀態': '已結案',
    '主管審核意見': comment,
    '主管審核時間': reviewTime,
    'PDF連結': pdf.fileUrl,
    '流程紀錄': found.data.flowLog,
  });
  SpreadsheetApp.flush();
  const refreshed = getDailyIncidentRecord_(incidentId);
  return { ok: true, fileUrl: pdf.fileUrl, incident: publicDailyIncidentSummary_(refreshed.data) };
}

function submitDailyIncidentSupervisorComment_(payload) {
  const incidentId = normalizeDailyIncidentId_(payload.incidentId);
  const token = sanitizeText_(payload.token, 120);
  const comment = requiredText_(payload.comment || payload.reviewComment, '主管處理意見', 1000);
  const found = getDailyIncidentRecord_(incidentId);
  assertDailyIncidentApprovalToken_(found.data, token);
  if (found.data.reviewStatus === '已結案') throw new Error('此日常事件已結案');
  if (found.data.reviewStatus === '待主管審核') throw new Error('此事件已送主管正式審核，請改用審核頁同意結案或退回補正');
  if (found.data.processStatus !== '處理中') throw new Error('只有處理中事件可填寫主管處理意見');

  const supervisor = sanitizeText_(payload.supervisor, 80) || found.data.supervisor || '主管';
  const reviewTime = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
  found.data.supervisor = supervisor;
  found.data.reviewComment = comment;
  found.data.reviewTime = reviewTime;
  found.data.flowLog = appendDailyIncidentFlowLog_(
    found.data.flowLog,
    '主管處理意見',
    supervisor,
    comment,
    reviewTime
  );
  updateDailyIncidentRow_(found, {
    '陳核主管': supervisor,
    '主管審核意見': comment,
    '主管審核時間': reviewTime,
    '流程紀錄': found.data.flowLog,
  });
  SpreadsheetApp.flush();

  let refreshed = getDailyIncidentRecord_(incidentId);
  const pdf = createDailyIncidentPdf_(refreshed.data, 'processing');
  updateDailyIncidentRow_(refreshed, { 'PDF連結': pdf.fileUrl });
  SpreadsheetApp.flush();

  refreshed = getDailyIncidentRecord_(incidentId);
  const commentNotice = maybeNotifyDailyIncidentSupervisorComment_(refreshed.data);
  return {
    ok: true,
    incident: publicDailyIncidentSummary_(refreshed.data),
    commentNotice,
  };
}

function getDailyIncidentForUpdatePage(incidentId, token) {
  try {
    const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(incidentId));
    assertDailyIncidentUpdateToken_(found.data, sanitizeText_(token, 120));
    return { ok: true, incident: publicDailyIncidentSummary_(found.data) };
  } catch (err) {
    Logger.log('getDailyIncidentForUpdatePage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function updateDailyIncidentFromPage(payload) {
  try {
    return updateDailyIncident_(payload || {});
  } catch (err) {
    Logger.log('updateDailyIncidentFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitDailyIncidentForApprovalFromPage(payload) {
  try {
    return submitDailyIncidentForApproval_(payload || {});
  } catch (err) {
    Logger.log('submitDailyIncidentForApprovalFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function getDailyIncidentForApprovalPage(incidentId, token) {
  try {
    const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(incidentId));
    assertDailyIncidentApprovalToken_(found.data, sanitizeText_(token, 120));
    return { ok: true, incident: publicDailyIncidentSummary_(found.data) };
  } catch (err) {
    Logger.log('getDailyIncidentForApprovalPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function approveDailyIncidentFromPage(payload) {
  try {
    return approveDailyIncident_(payload || {});
  } catch (err) {
    Logger.log('approveDailyIncidentFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function getDailyIncidentForSupervisorCommentPage(incidentId, token) {
  try {
    const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(incidentId));
    assertDailyIncidentApprovalToken_(found.data, sanitizeText_(token, 120));
    return { ok: true, incident: publicDailyIncidentSummary_(found.data) };
  } catch (err) {
    Logger.log('getDailyIncidentForSupervisorCommentPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitDailyIncidentSupervisorCommentFromPage(payload) {
  try {
    return submitDailyIncidentSupervisorComment_(payload || {});
  } catch (err) {
    Logger.log('submitDailyIncidentSupervisorCommentFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function listOpenDailyIncidents_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getDailyIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return { count: 0, incidents: [] };
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const incidents = data.map(row => dailyIncidentRowToObject_(headers, row))
    .filter(inc => inc.reviewStatus !== '已結案')
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .map(publicDailyIncidentSummary_);
  return { count: incidents.length, incidents };
}

function listOpenDailyIncidentsForLineUser_(userId) {
  const ctx = dailyIncidentLineAccessContext_(userId);
  const res = listOpenDailyIncidents_();
  const incidents = res.incidents || [];
  if (ctx.isSupervisor) return res;
  const filtered = incidents.filter(inc => dailyIncidentLineUserCanAccess_(inc, ctx));
  return { count: filtered.length, incidents: filtered };
}

function getDailyIncidentPublicDetail_(incidentId) {
  const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(incidentId));
  return publicDailyIncidentSummary_(found.data);
}

function getDailyIncidentPublicDetailForLineUser_(incidentId, userId) {
  const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(incidentId));
  assertDailyIncidentLineAccess_(found.data, userId);
  return publicDailyIncidentSummary_(found.data);
}

function submitDailyIncidentForApprovalFromLine_(payload, userId) {
  payload = payload || {};
  const found = getDailyIncidentRecord_(normalizeDailyIncidentId_(payload.incidentId));
  assertDailyIncidentLineAccess_(found.data, userId);
  return submitDailyIncidentForApproval_(payload);
}

function dailyIncidentLineAccessContext_(userId) {
  const profile = (typeof getLineSubscriberProfileByUserId_ === 'function')
    ? getLineSubscriberProfileByUserId_(userId)
    : null;
  return {
    userId: String(userId || '').trim(),
    name: profile && profile.name ? String(profile.name || '').trim() : '',
    isSupervisor: !!(profile && profile.isSupervisor),
    isStaff: !!(profile && profile.isStaff),
    isSubscriber: !!profile,
  };
}

function dailyIncidentLineUserCanAccess_(incident, ctx) {
  ctx = ctx || {};
  if (ctx.isSupervisor) return true;
  const name = String(ctx.name || '').trim();
  if (!name) return false;
  return [incident.owner, incident.reporter]
    .map(v => String(v || '').trim())
    .filter(Boolean)
    .indexOf(name) >= 0;
}

function assertDailyIncidentLineAccess_(incident, userId) {
  const ctx = dailyIncidentLineAccessContext_(userId);
  if (!dailyIncidentLineUserCanAccess_(incident, ctx)) {
    throw new Error('你沒有權限查看這筆日常事件');
  }
}

function findDailyIncidentByClientId_(clientId) {
  if (!clientId) return null;
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getDailyIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const clientCol = headers.indexOf('clientSubmissionId');
  if (clientCol < 0) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][clientCol] || '') === clientId) {
      const obj = dailyIncidentRowToObject_(headers, data[i]);
      return { incidentId: obj.incidentId, photoFolderUrl: obj.photoFolderUrl, pdfUrl: obj.pdfUrl, reviewStatus: obj.reviewStatus };
    }
  }
  return null;
}

function getDailyIncidentRecord_(incidentId) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getDailyIncidentSheet_(ss);
  if (!sheet) throw new Error('找不到日常異常事件通報表，請先執行 initializeDatabase');
  if (sheet.getLastRow() < 2) throw new Error('找不到日常事件：' + incidentId);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const idCol = headers.indexOf('事件ID');
  if (idCol < 0) throw new Error('日常異常事件通報表缺事件ID欄位');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idCol] || '').trim() === incidentId) {
      return {
        ss,
        sheet,
        headers,
        rowNo: i + 2,
        row: data[i],
        data: dailyIncidentRowToObject_(headers, data[i]),
      };
    }
  }
  throw new Error('找不到日常事件：' + incidentId);
}

function appendDailyIncidentRow_(ss, data) {
  const sheet = getDailyIncidentSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const row = new Array(headers.length).fill('');
  const set = (name, value) => {
    const i = headers.indexOf(name);
    if (i >= 0) row[i] = value;
  };
  set('事件ID', data.incidentId);
  set('建立時間', data.createdAtStr);
  set('填報日期', data.reportDate);
  set('發生地點', data.location);
  set('填報人', data.reporter);
  set('承辦人', data.owner);
  set('填報事項', data.subject);
  set(dailyIncidentDescriptionHeaderFor_(headers), data.description);
  set('處理狀況', data.processStatus);
  set('處理說明', data.processNote);
  set('處理完成日期', data.completedDate);
  set('陳核主管', data.supervisor);
  set('審核狀態', data.reviewStatus);
  set('主管審核意見', data.reviewComment);
  set('主管審核時間', data.reviewTime);
  set('照片數', data.photoCount);
  set('照片資料夾連結', data.photoFolderUrl);
  set('PDF連結', data.pdfUrl);
  set('待審PDF檔案ID', data.pendingPdfFileId);
  set('承辦更新Token', data.updateToken);
  set('主管審核Token', data.approvalToken);
  set('clientSubmissionId', data.clientSubmissionId);
  set('流程紀錄', data.flowLog);
  set('備註', data.note);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function updateDailyIncidentRow_(found, updates) {
  const row = found.row.slice();
  Object.keys(updates).forEach(name => {
    const i = found.headers.indexOf(name);
    if (i >= 0) row[i] = updates[name];
  });
  found.sheet.getRange(found.rowNo, 1, 1, found.headers.length).setValues([row]);
}

function dailyIncidentRowToObject_(headers, row) {
  const value = name => {
    const i = headers.indexOf(name);
    return i >= 0 ? row[i] : '';
  };
  return {
    incidentId: String(value('事件ID') || '').trim(),
    createdAt: String(value('建立時間') || ''),
    reportDate: value('填報日期') instanceof Date ? formatISODate_(value('填報日期')) : String(value('填報日期') || ''),
    location: String(value('發生地點') || ''),
    reporter: String(value('填報人') || ''),
    owner: String(value('承辦人') || ''),
    subject: String(value('填報事項') || ''),
    description: String(value(DAILY_INCIDENT_DESCRIPTION_HEADER) || value(DAILY_INCIDENT_DESCRIPTION_ALT_HEADER) || ''),
    processStatus: String(value('處理狀況') || ''),
    processNote: String(value('處理說明') || ''),
    completedDate: value('處理完成日期') instanceof Date ? formatISODate_(value('處理完成日期')) : String(value('處理完成日期') || ''),
    supervisor: String(value('陳核主管') || ''),
    reviewStatus: String(value('審核狀態') || ''),
    reviewComment: String(value('主管審核意見') || ''),
    reviewTime: String(value('主管審核時間') || ''),
    photoCount: Number(value('照片數') || 0),
    photoFolderUrl: String(value('照片資料夾連結') || ''),
    pdfUrl: String(value('PDF連結') || ''),
    pendingPdfFileId: String(value('待審PDF檔案ID') || ''),
    updateToken: String(value('承辦更新Token') || ''),
    approvalToken: String(value('主管審核Token') || ''),
    clientSubmissionId: String(value('clientSubmissionId') || ''),
    flowLog: String(value('流程紀錄') || ''),
    note: String(value('備註') || ''),
  };
}

function publicDailyIncidentSummary_(data) {
  return {
    incidentId: data.incidentId,
    createdAt: data.createdAt,
    reportDate: data.reportDate,
    location: data.location,
    reporter: data.reporter,
    owner: data.owner,
    subject: data.subject,
    description: data.description,
    processStatus: data.processStatus,
    processNote: data.processNote,
    completedDate: data.completedDate,
    supervisor: data.supervisor,
    reviewStatus: data.reviewStatus,
    reviewComment: data.reviewComment,
    reviewTime: data.reviewTime,
    photoCount: data.photoCount,
    photoFolderUrl: data.photoFolderUrl,
    pdfUrl: data.pdfUrl,
    updateUrl: buildDailyIncidentUpdateUrl_(data),
    approvalUrl: buildDailyIncidentApprovalUrl_(data),
    commentUrl: buildDailyIncidentSupervisorCommentUrl_(data),
  };
}

function nextDailyIncidentId_(ss, date) {
  const prefix = 'INC-' + formatROCDate_(date) + '-';
  const sheet = getDailyIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return prefix + '001';
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const idCol = headers.indexOf('事件ID');
  if (idCol < 0) return prefix + '001';
  const values = sheet.getRange(2, idCol + 1, sheet.getLastRow() - 1, 1).getValues();
  let maxNo = 0;
  values.forEach(r => {
    const id = String(r[0] || '');
    if (id.indexOf(prefix) !== 0) return;
    const n = Number(id.substring(prefix.length));
    if (n > maxNo) maxNo = n;
  });
  return prefix + String(maxNo + 1).padStart(3, '0');
}

function normalizeDailyIncidentId_(incidentId) {
  const id = sanitizeText_(incidentId, 40).toUpperCase();
  if (!/^INC-\d{7}-\d{3}$/.test(id)) throw new Error('日常事件ID格式錯誤');
  return id;
}

function requiredText_(value, label, maxLen) {
  const text = sanitizeText_(value, maxLen || CONFIG.MAX_TEXT_FIELD_LENGTH).trim();
  if (!text) throw new Error('缺少' + label);
  return text;
}

function sanitizeDailyIncidentProcessStatus_(value) {
  const s = sanitizeText_(value, 20) || '待處理';
  if (DAILY_INCIDENT_PROCESS_STATUSES.indexOf(s) < 0) throw new Error('處理狀況不合法');
  return s;
}

function makeDailyIncidentToken_() {
  return uuid_() + '-' + uuid_();
}

function dailyIncidentNow_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function cleanDailyIncidentFlowText_(value, maxLen) {
  return sanitizeText_(value, maxLen || 400).replace(/[\r\n]+/g, ' ').replace(/｜/g, '|').trim();
}

function appendDailyIncidentFlowLog_(existing, stage, actor, detail, at) {
  const time = cleanDailyIncidentFlowText_(at || dailyIncidentNow_(), 30);
  const line = [
    time,
    cleanDailyIncidentFlowText_(stage, 40),
    cleanDailyIncidentFlowText_(actor || '', 80),
    cleanDailyIncidentFlowText_(detail || '', 500),
  ].join('｜');
  return [String(existing || '').trim(), line].filter(Boolean).join('\n');
}

function buildDailyIncidentFlowRows_(data, stage) {
  const rows = [['階段', '日期/時間', '人員', '狀態/結果']];
  const log = String(data.flowLog || '').trim();
  if (log) {
    log.split(/\n+/).forEach(line => {
      const parts = String(line || '').split('｜');
      if (parts.length < 4) return;
      rows.push([parts[1] || '', parts[0] || '', parts[2] || '', parts.slice(3).join('｜') || '']);
    });
  }
  if (rows.length > 1) return rows;
  rows.push(['填報', data.createdAt || data.reportDate || '', data.reporter || '', data.subject || '已通報']);
  rows.push(['承辦處理', data.completedDate || '尚未完成', data.owner || '', data.processStatus || '待處理']);
  rows.push(['主管審核', data.reviewTime || '尚未審核', data.supervisor || '', stage === 'closed' ? '已結案' : (data.reviewStatus || '待審核')]);
  return rows;
}

function assertDailyIncidentUpdateToken_(data, token) {
  if (!token || token.length < 32 || token !== data.updateToken) throw new Error('日常事件更新連結已失效或不正確');
}

function assertDailyIncidentApprovalToken_(data, token) {
  if (!token || token.length < 32 || token !== data.approvalToken) throw new Error('日常事件審核連結已失效或不正確');
}

function normalizeDailyIncidentPhotos_(photos) {
  if (!Array.isArray(photos)) return [];
  if (photos.length > DAILY_INCIDENT_MAX_PHOTOS) throw new Error(`照片超過 ${DAILY_INCIDENT_MAX_PHOTOS} 張上限`);
  return photos.filter(p => p && typeof p === 'string').map((p, i) => {
    if (p.length > CONFIG.MAX_PHOTO_BYTES) throw new Error(`第 ${i + 1} 張照片過大`);
    if (!/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(p)) throw new Error(`第 ${i + 1} 張照片格式錯誤`);
    return p;
  });
}

function saveDailyIncidentPhotos_(folder, incidentId, photos, label, offset) {
  const normalized = normalizeDailyIncidentPhotos_(photos);
  const saved = [];
  normalized.forEach((p, i) => {
    const seq = (offset || 0) + i + 1;
    const blob = dataUrlToBlob_(p, `${incidentId}_${label}_${seq}.jpg`);
    if (!blob) throw new Error(`第 ${seq} 張照片格式錯誤`);
    const file = folder.createFile(blob).setName(`${incidentId}_${label}_${String(seq).padStart(2, '0')}.jpg`);
    saved.push({ fileId: file.getId(), url: file.getUrl() });
  });
  return saved;
}

function getOrCreateDailyIncidentRoot_() {
  const root = getArchiveRootFolder_();
  const folderName = getSetting_('dailyIncidentArchiveFolderName', '') || DAILY_INCIDENT_ARCHIVE_DEFAULT;
  return getOrCreateSubFolder_(root, cleanDriveFolderName_(folderName));
}

function getOrCreateDailyIncidentStageFolder_(date, stageName) {
  const root = getOrCreateDailyIncidentRoot_();
  const year = getOrCreateSubFolder_(root, formatROCYear_(date));
  const month = getOrCreateSubFolder_(year, formatROCMonth_(date));
  return getOrCreateSubFolder_(month, stageName);
}

function getOrCreateDailyIncidentPhotoFolder_(incidentId, date) {
  const root = getOrCreateDailyIncidentRoot_();
  const year = getOrCreateSubFolder_(root, formatROCYear_(date));
  const month = getOrCreateSubFolder_(year, formatROCMonth_(date));
  const photos = getOrCreateSubFolder_(month, '照片');
  return getOrCreateSubFolder_(photos, incidentId);
}

function createDailyIncidentPdf_(data, stage) {
  const date = parseISODate_(data.reportDate);
  const folder = getOrCreateDailyIncidentStageFolder_(date, dailyIncidentPdfStageFolderName_(data, stage));
  const blob = buildDailyIncidentPdfBlob_(data, stage);
  blob.setName(buildDailyIncidentPdfFilename_(data));
  const file = folder.createFile(blob);
  return { fileId: file.getId(), fileUrl: file.getUrl() };
}

function dailyIncidentPdfStageFolderName_(data, stage) {
  if (stage === 'closed') return '已結案';
  if (stage === 'pending') return '待主管審核';
  if (stage === 'returned') return '退回補正';
  if (stage === 'reported') return '通報紀錄';
  if (String(data.processStatus || '') === '處理完成') return '處理完成';
  if (String(data.processStatus || '') === '處理中') return '處理中';
  return '待處理';
}

function dailyIncidentPdfStageLabel_(data, stage) {
  return dailyIncidentPdfStageFolderName_(data, stage);
}

function buildDailyIncidentPdfBlob_(data, stage) {
  const doc = DocumentApp.create('tmp_daily_incident_' + data.incidentId);
  const docId = doc.getId();
  try {
    const body = doc.getBody();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

    const title = body.appendParagraph('日常異常事件處理單');
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    const orgP = body.appendParagraph(getOrgHeader_());
    orgP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    orgP.editAsText().setFontSize(11).setForegroundColor('#555555');
    body.appendParagraph('');

    const rows = [
      ['事件ID', data.incidentId, '填報日期', data.reportDate],
      ['發生地點', data.location, '填報事項', data.subject],
      ['填報人', data.reporter, '承辦人', data.owner],
      ['處理狀況', data.processStatus, '審核狀態', stage === 'closed' ? '已結案' : data.reviewStatus],
      ['處理完成日期', data.completedDate || '', '陳核主管', data.supervisor || ''],
      ['PDF階段', dailyIncidentPdfStageLabel_(data, stage), '產製時間', Utilities.formatDate(new Date(), tz_(), 'yyyy/MM/dd HH:mm')],
    ];
    const metaTable = body.appendTable(rows);
    styleMetaTable_(metaTable);

    body.appendParagraph('');
    const detailTitle = body.appendParagraph('日常異常事件處理單內容');
    detailTitle.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    detailTitle.editAsText().setFontSize(13).setBold(true).setForegroundColor('#1a73e8');

    const detailRows = [
      ['欄位', '內容'],
      [DAILY_INCIDENT_DESCRIPTION_DISPLAY_LABEL, data.description || ''],
      ['處理狀況', data.processStatus || '待處理'],
      ['處理說明', data.processNote || '尚未填寫'],
      ['照片附件', Number(data.photoCount || 0) > 0 ? `${data.photoCount} 張，詳後附照片頁` : '無'],
    ];
    if (data.reviewComment || stage === 'closed') {
      detailRows.push(['主管審核/處理意見', data.reviewComment || '同意結案']);
    }
    const detailTable = body.appendTable(detailRows);
    styleDailyIncidentDetailTable_(detailTable);

    body.appendParagraph('');
    const flowTitle = body.appendParagraph('處理與審核流程紀錄');
    flowTitle.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    flowTitle.editAsText().setFontSize(13).setBold(true).setForegroundColor('#1a73e8');

    const flowRows = buildDailyIncidentFlowRows_(data, stage);
    const flowTable = body.appendTable(flowRows);
    styleDailyIncidentFlowTable_(flowTable);

    const photoFolderId = parseDriveFolderId_(data.photoFolderUrl);
    if (photoFolderId) appendDailyIncidentPhotosToPdf_(body, photoFolderId);

    body.appendParagraph('');
    const footer = body.appendParagraph('系統自動產製時間：' + Utilities.formatDate(new Date(), tz_(), 'yyyy/MM/dd HH:mm'));
    footer.editAsText().setFontSize(9).setForegroundColor('#888888');
    footer.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

    doc.saveAndClose();
    return DriveApp.getFileById(docId).getAs('application/pdf');
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (e) { Logger.log('刪日常事件暫存 Doc 失敗：' + e); }
  }
}

function appendDailyIncidentPdfSection_(body, title, text) {
  body.appendParagraph('');
  const h = body.appendParagraph(title);
  h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  h.editAsText().setFontSize(13).setBold(true).setForegroundColor('#1a73e8');
  const p = body.appendParagraph(text || '');
  p.editAsText().setFontSize(11);
}

function styleDailyIncidentDetailTable_(table) {
  const HCenter = DocumentApp.HorizontalAlignment.CENTER;
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(7).setPaddingRight(7);
      const text = cell.editAsText();
      text.setFontSize(10);
      if (r === 0) {
        cell.setBackgroundColor('#1a73e8');
        text.setForegroundColor('#ffffff').setBold(true);
        try { cell.getChild(0).asParagraph().setAlignment(HCenter); } catch (_) {}
      } else if (c === 0) {
        cell.setBackgroundColor('#f0f0f0');
        cell.setWidth(92);
        text.setBold(true).setForegroundColor('#202124');
      } else {
        cell.setWidth(410);
        text.setForegroundColor('#202124');
      }
    }
  }
}

function styleDailyIncidentFlowTable_(table) {
  const HCenter = DocumentApp.HorizontalAlignment.CENTER;
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(6).setPaddingRight(6);
      const text = cell.editAsText();
      text.setFontSize(10);
      if (r === 0) {
        cell.setBackgroundColor('#1a73e8');
        text.setForegroundColor('#ffffff').setBold(true);
      }
      if (c === 0) cell.setWidth(80);
      if (c === 1) cell.setWidth(130);
      if (c === 2) cell.setWidth(95);
      if (c === 3) cell.setWidth(190);
      if (r === 0 || c !== 3) {
        try { cell.getChild(0).asParagraph().setAlignment(HCenter); } catch (_) {}
      }
    }
  }
}

function appendDailyIncidentPhotosToPdf_(body, folderId) {
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (_) { return; }
  const photoFiles = listDailyIncidentPhotoFiles_(folder);
  photoFiles.forEach((photo, i) => {
    const file = photo.file;
    if (i === 0) {
      body.appendPageBreak();
      const title = body.appendParagraph('照片附件');
      title.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    } else {
      body.appendPageBreak();
    }
    const index = i + 1;
    const label = body.appendParagraph(`照片 ${index} / ${photoFiles.length}`);
    label.editAsText().setFontSize(11).setBold(true).setForegroundColor('#1a73e8');
    const img = body.appendImage(file.getBlob());
    const maxW = 480, maxH = 600;
    const w = img.getWidth(), h = img.getHeight();
    if (w > maxW || h > maxH) {
      const scale = Math.min(maxW / w, maxH / h);
      img.setWidth(Math.round(w * scale));
      img.setHeight(Math.round(h * scale));
    }
    const caption = body.appendParagraph(`照片階段：${photo.stageLabel}｜檔名：${file.getName()}`);
    caption.editAsText().setFontSize(10).setForegroundColor('#555555');
    caption.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  });
}

function listDailyIncidentPhotoFiles_(folder) {
  const files = folder.getFiles();
  const photos = [];
  while (files.hasNext()) {
    const file = files.next();
    if (String(file.getMimeType() || '').indexOf('image/') !== 0) continue;
    const meta = parseDailyIncidentPhotoName_(file.getName());
    photos.push({
      file,
      seq: meta.seq,
      stageOrder: meta.stageOrder,
      stageLabel: meta.stageLabel,
      created: file.getDateCreated ? file.getDateCreated().getTime() : 0,
      name: file.getName(),
    });
  }
  photos.sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
    if (a.created !== b.created) return a.created - b.created;
    return a.name.localeCompare(b.name);
  });
  return photos;
}

function parseDailyIncidentPhotoName_(name) {
  const s = String(name || '');
  const m = s.match(/_(通報照片|處理照片|補正照片|退回補正照片|結案照片)_(\d+)\.[^.]+$/);
  const stageLabel = m ? m[1] : '未標示階段';
  const stageOrderMap = {
    '通報照片': 10,
    '處理照片': 20,
    '補正照片': 30,
    '退回補正照片': 40,
    '結案照片': 50,
  };
  return {
    stageLabel,
    stageOrder: stageOrderMap[stageLabel] || 99,
    seq: m ? Number(m[2]) : 999999,
  };
}

function buildDailyIncidentPdfFilename_(data) {
  const date = parseISODate_(data.reportDate);
  const location = cleanDriveFolderName_(data.location).replace(/\s+/g, '');
  return `${formatROCDate_(date)}_日常異常事件_${location}_${data.incidentId}.pdf`;
}

function parseDriveFolderId_(url) {
  const s = String(url || '');
  const m = s.match(/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : '';
}

function buildDailyIncidentPublicUrl_() {
  const base = getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL || '';
  if (!/^https?:\/\//.test(base)) return '';
  return String(base).replace(/\/$/, '') + '/incident.html';
}

function buildDailyIncidentUpdateUrl_(data) {
  const base = ScriptApp.getService().getUrl() || getSetting_('webAppUrl', '');
  if (!/^https?:\/\//.test(base)) return '';
  return `${base}?page=incident-update&incidentId=${encodeURIComponent(data.incidentId)}&token=${encodeURIComponent(data.updateToken || '')}`;
}

function buildDailyIncidentApprovalUrl_(data) {
  const base = ScriptApp.getService().getUrl() || getSetting_('webAppUrl', '');
  if (!/^https?:\/\//.test(base)) return '';
  return `${base}?page=incident-approve&incidentId=${encodeURIComponent(data.incidentId)}&token=${encodeURIComponent(data.approvalToken || '')}`;
}

function buildDailyIncidentSupervisorCommentUrl_(data) {
  const base = ScriptApp.getService().getUrl() || getSetting_('webAppUrl', '');
  if (!/^https?:\/\//.test(base)) return '';
  return `${base}?page=incident-comment&incidentId=${encodeURIComponent(data.incidentId)}&token=${encodeURIComponent(data.approvalToken || '')}`;
}

function maybeNotifyDailyIncidentCreated_(data) {
  if (!isActiveValue_(getSetting_('dailyIncidentGroupNotify', '是'))) return { ok: true, skipped: true };
  if (typeof sendDailyIncidentCreated_ !== 'function') return { ok: false, reason: 'missing_sendDailyIncidentCreated' };
  try { return sendDailyIncidentCreated_(publicDailyIncidentSummary_(data)); }
  catch (e) {
    Logger.log('[DailyIncident notify created] 失敗: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e) };
  }
}

function maybeNotifyDailyIncidentReturned_(data) {
  if (!isActiveValue_(getSetting_('dailyIncidentGroupNotify', '是'))) return { ok: true, skipped: true };
  if (typeof sendDailyIncidentReturned_ !== 'function') return { ok: false, reason: 'missing_sendDailyIncidentReturned' };
  try { return sendDailyIncidentReturned_(publicDailyIncidentSummary_(data)); }
  catch (e) {
    Logger.log('[DailyIncident notify returned] 失敗: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e) };
  }
}

function maybeNotifyDailyIncidentApproval_(data) {
  if (!isActiveValue_(getSetting_('dailyIncidentSupervisorNotify', '是'))) return { ok: true, skipped: true };
  if (typeof sendDailyIncidentApprovalRequest_ !== 'function') return { ok: false, reason: 'missing_sendDailyIncidentApprovalRequest' };
  try { return sendDailyIncidentApprovalRequest_(publicDailyIncidentSummary_(data)); }
  catch (e) {
    Logger.log('[DailyIncident notify approval] 失敗: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e) };
  }
}

function maybeNotifyDailyIncidentProcessingSupervisor_(data) {
  if (!isActiveValue_(getSetting_('dailyIncidentSupervisorNotify', '是'))) {
    return { ok: true, skipped: true, noticeType: 'processingSupervisor' };
  }
  if (typeof sendDailyIncidentProcessingReviewRequest_ !== 'function') {
    return { ok: false, reason: 'missing_sendDailyIncidentProcessingReviewRequest', noticeType: 'processingSupervisor' };
  }
  try {
    const res = sendDailyIncidentProcessingReviewRequest_(publicDailyIncidentSummary_(data));
    res.noticeType = 'processingSupervisor';
    return res;
  } catch (e) {
    Logger.log('[DailyIncident notify processing supervisor] 失敗: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e), noticeType: 'processingSupervisor' };
  }
}

function maybeNotifyDailyIncidentSupervisorComment_(data) {
  if (!isActiveValue_(getSetting_('dailyIncidentGroupNotify', '是'))) {
    return { ok: true, skipped: true, noticeType: 'supervisorComment' };
  }
  if (typeof sendDailyIncidentSupervisorComment_ !== 'function') {
    return { ok: false, reason: 'missing_sendDailyIncidentSupervisorComment', noticeType: 'supervisorComment' };
  }
  try {
    const res = sendDailyIncidentSupervisorComment_(publicDailyIncidentSummary_(data));
    res.noticeType = 'supervisorComment';
    return res;
  } catch (e) {
    Logger.log('[DailyIncident notify supervisor comment] 失敗: ' + e + '\n' + (e.stack || ''));
    return { ok: false, error: String(e.message || e), noticeType: 'supervisorComment' };
  }
}
