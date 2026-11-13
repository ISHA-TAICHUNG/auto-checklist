/**
 * ===== 機具設備異常輕量處理回報 =====
 *
 * 同一次檢查產生的多筆異常，以「紀錄ID」整併為一張處理表。
 * LINE 先以 source.userId 驗證同仁/主管，再核發綁定該人員的限時連結。
 */

const MACHINE_INCIDENT_HANDLING_STATUSES = ['待處理', '處理中', '待重檢', '已完成'];
const MACHINE_INCIDENT_HANDLING_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MACHINE_INCIDENT_ADMIN_TOKEN_TTL_SECONDS = 30 * 60;
const MACHINE_INCIDENT_HANDLING_COLUMNS = [
  '處理更新時間',
  '處理紀錄PDF',
  '處理簽核狀態',
  '處理簽核主管',
  '處理簽核時間',
  '處理照片數',
  '處理照片資料夾',
  '指定主管',
  '指定主管Key',
  '處理人Key',
  '主管核判意見',
];
// 處理後照片上限與日常異常相同，避免單次送出超過 Apps Script 傳輸負荷。
const MACHINE_INCIDENT_MAX_PHOTOS = 8;
const MACHINE_INCIDENT_REVIEW_PENDING = '待主管簽核';
const MACHINE_INCIDENT_REVIEW_APPROVED = '已簽核歸檔';
const MACHINE_INCIDENT_REVIEW_RETURNED = '退回補正';

function machineIncidentHandlingPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('MachineIncidentHandlingPage');
  tpl.recordIdJson = scriptSafeJson_(params.recordId);
  tpl.handlingTokenJson = scriptSafeJson_(params.token);
  return tpl
    .evaluate()
    .setTitle('機具設備異常處理回報')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function getMachineIncidentHandlingPageData(recordId, token) {
  try {
    const auth = assertMachineIncidentHandlingToken_(recordId, token);
    const group = getMachineIncidentGroupByRecordId_(recordId);
    const people = getDailyIncidentPeopleOptions_();
    return {
      ok: true,
      actor: { name: auth.actorName || auth.person.name },
      canReview: machineIncidentViewerCanReview_(group, auth),
      reviewerNoticeFailed: machineIncidentReviewerNoticeFailed_(group),
      supervisors: (people.supervisors || []).map(p => ({ key: p.key, label: p.label })),
      // Drive 照片資料夾未對同仁公開，改內嵌照片；只在完成後的唯讀檢視（含主管核判）才需要，
      // 編輯中不載入以免手機每次開頁都多傳數 MB。
      photos: group.allCompleted ? listMachineIncidentPhotoDataUrls_(group) : [],
      group: publicMachineIncidentHandlingGroup_(group),
    };
  } catch (err) {
    Logger.log('getMachineIncidentHandlingPageData 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitMachineIncidentHandlingFromPage(payload) {
  try {
    return submitMachineIncidentHandling_(payload || {});
  } catch (err) {
    Logger.log('submitMachineIncidentHandlingFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitMachineIncidentHandling_(payload) {
  const recordId = sanitizeText_(payload.recordId, 100).trim();
  const auth = assertMachineIncidentHandlingToken_(recordId, payload.token);
  const actorName = auth.actorName || auth.person.name;
  const updates = normalizeMachineIncidentHandlingUpdates_(payload.items);
  const completedDate = payload.completedDate
    ? formatISODate_(parseISODate_(String(payload.completedDate)))
    : '';
  // 照片與主管在進鎖前先驗證，壞資料不必佔用全域鎖。
  const photos = Array.isArray(payload.photos) && payload.photos.length
    ? normalizeDailyIncidentPhotos_(payload.photos)
    : [];
  const chosenSupervisor = resolveMachineIncidentSupervisor_(payload.supervisorKey);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const group = getMachineIncidentGroupByRecordId_(recordId);
    if (group.allCompleted && machineIncidentCompletionDetailsValid_(group)) {
      if (!machineIncidentFinalizationComplete_(group)) {
        // 改版前已全部完成、但收尾未成功的舊案件：補記處理人這次選的主管，每日檢沒有主管就無人可核判。
        if (chosenSupervisor && !group.supervisorKey) {
          writeMachineIncidentSupervisor_(group, chosenSupervisor);
        }
        if (group.formType !== '每月' && !group.supervisorKey) {
          throw new Error('全部項目完成時，請選擇核判主管');
        }
        const finalized = finalizeMachineIncidentHandling_(group, machineIncidentCompletionMeta_(group, actorName));
        persistMachineIncidentHandlingFinalization_(group, finalized);
      }
      return {
        ok: true,
        alreadyCompleted: true,
        group: publicMachineIncidentHandlingGroup_(getMachineIncidentGroupByRecordId_(recordId)),
      };
    }

    const updateById = {};
    updates.forEach(update => { updateById[update.incidentId] = update; });
    const expectedIds = group.items.map(item => item.incidentId);
    if (updates.length !== expectedIds.length || expectedIds.some(id => !updateById[id])) {
      throw new Error('異常項目已變更，請重新從 LINE 開啟最新處理頁');
    }

    const hasCompleted = expectedIds.some(id => updateById[id].status === '已完成');
    const allCompleted = expectedIds.every(id => updateById[id].status === '已完成');
    if (hasCompleted && !completedDate) throw new Error('有項目完成時請填寫處理完成日期');
    updates.forEach(update => {
      if (update.status === '已完成' && !update.note) {
        throw new Error(`第 ${update.order || '—'} 項標記完成前，請填寫處理說明`);
      }
    });
    const supervisor = chosenSupervisor ||
      (group.supervisorKey ? { name: group.supervisorName, key: group.supervisorKey } : null);
    if (allCompleted && !supervisor) throw new Error('全部項目完成時，請選擇核判主管');
    const existingPhotoCount = Number(group.photoCount) || 0;
    if (existingPhotoCount + photos.length > MACHINE_INCIDENT_MAX_PHOTOS) {
      throw new Error(`處理後照片最多 ${MACHINE_INCIDENT_MAX_PHOTOS} 張，目前已有 ${existingPhotoCount} 張`);
    }

    const sheet = group.sheet;
    const headers = ensureMachineIncidentHandlingColumns_(sheet);
    const col = machineIncidentHandlingColumnMap_(headers);
    const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    let photoFolderUrl = group.photoFolderUrl || '';
    if (photos.length) {
      const folder = getMachineIncidentPhotoFolder_(group);
      const photoPrefix = String(recordId).replace(/[^A-Za-z0-9]/g, '').substring(0, 8) || 'machine';
      saveDailyIncidentPhotos_(folder, photoPrefix, photos, '處理照片', existingPhotoCount);
      photoFolderUrl = folder.getUrl();
    }
    group.items.forEach(item => {
      const update = updateById[item.incidentId];
      const range = sheet.getRange(item.rowNo, 1, 1, headers.length);
      const row = range.getValues()[0];
      row[col.status] = update.status;
      // 中控台代填只記錄本次操作人，不覆寫原負責人，
      // 避免後續 LINE 提醒找不到原承辦同仁。
      if (!auth.isAdmin) {
        row[col.owner] = auth.person.name;
        row[col.ownerKey] = String(auth.payload.p || '');
      }
      row[col.note] = update.note;
      row[col.completedDate] = update.status === '已完成' ? completedDate : '';
      row[col.updatedAt] = now;
      row[col.photoCount] = existingPhotoCount + photos.length;
      row[col.photoFolder] = photoFolderUrl;
      if (supervisor) {
        row[col.supervisorName] = supervisor.name;
        row[col.supervisorKey] = supervisor.key;
      }
      if (!allCompleted) {
        row[col.handlingPdf] = '';
        // 主管退回後，處理人只是暫存進度時保留「退回補正」，讓圖卡與頁面仍看得到退回意見。
        row[col.handlingApprovalStatus] = group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_RETURNED
          ? MACHINE_INCIDENT_REVIEW_RETURNED
          : '處理中';
        row[col.handlingSupervisor] = '';
        row[col.handlingApprovedAt] = '';
      }
      range.setValues([row]);
    });
    SpreadsheetApp.flush();

    let handlingPdfUrl = '';
    if (allCompleted) {
      const refreshed = getMachineIncidentGroupByRecordId_(recordId);
      const finalized = finalizeMachineIncidentHandling_(refreshed, {
        actorName,
        completedDate,
        updatedAt: now,
      });
      handlingPdfUrl = finalized.fileUrl || '';
      persistMachineIncidentHandlingFinalization_(refreshed, finalized);
    }

    const resultGroup = getMachineIncidentGroupByRecordId_(recordId);
    return {
      ok: true,
      reviewerNoticeFailed: machineIncidentReviewerNoticeFailed_(resultGroup),
      allCompleted,
      handlingPdfUrl: handlingPdfUrl || resultGroup.handlingPdfUrl || '',
      group: publicMachineIncidentHandlingGroup_(resultGroup),
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeMachineIncidentHandlingUpdates_(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) {
    throw new Error('處理項目內容不正確');
  }
  const seen = {};
  return items.map(item => {
    const incidentId = sanitizeText_(item && item.incidentId, 100).trim();
    const status = sanitizeText_(item && item.status, 20).trim();
    const note = sanitizeText_(item && item.note, 600).trim();
    if (!incidentId || seen[incidentId]) throw new Error('處理項目重複或缺少事件ID');
    if (MACHINE_INCIDENT_HANDLING_STATUSES.indexOf(status) < 0) throw new Error('處理狀態不合法');
    seen[incidentId] = true;
    return {
      incidentId,
      order: Number(item && item.order) || 0,
      status,
      note,
    };
  });
}

/**
 * 補齊處理相關欄位。只能在已持有 script lock 的寫入流程呼叫：
 * 讀取流程（開頁、LINE 查詢）改用 readMachineIncidentHeaders_，不寫表，
 * 避免多人同時首次開頁時重複追加同名欄位。
 */
function ensureMachineIncidentHandlingColumns_(sheet) {
  const headers = readMachineIncidentHeaders_(sheet);
  MACHINE_INCIDENT_HANDLING_COLUMNS.forEach(name => {
    if (headers.indexOf(name) >= 0) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
    headers.push(name);
  });
  return headers;
}

function readMachineIncidentHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
}

function machineIncidentHandlingColumnMap_(headers) {
  const required = {
    incidentId: '事件ID',
    reportDate: '通報日期',
    equipmentId: '設備代號',
    equipmentName: '設備名稱',
    category: '設備類別',
    formType: '表單類型',
    order: '項次',
    itemName: '項目名稱',
    result: '結果代號',
    description: '異常說明',
    originalPdf: 'PDF連結',
    recordId: '紀錄ID',
    status: '狀態',
    completedDate: '實際完成日',
    owner: '負責人',
    note: '備註',
    updatedAt: '處理更新時間',
    handlingPdf: '處理紀錄PDF',
    handlingApprovalStatus: '處理簽核狀態',
    handlingSupervisor: '處理簽核主管',
    handlingApprovedAt: '處理簽核時間',
    photoCount: '處理照片數',
    photoFolder: '處理照片資料夾',
    supervisorName: '指定主管',
    supervisorKey: '指定主管Key',
    ownerKey: '處理人Key',
    reviewComment: '主管核判意見',
  };
  // 這次新增的欄位在尚未有人寫入前可能不存在；讀取時視為空值，寫入流程會先補欄位。
  const optional = ['photoCount', 'photoFolder', 'supervisorName', 'supervisorKey', 'ownerKey', 'reviewComment'];
  const out = {};
  Object.keys(required).forEach(key => {
    out[key] = headers.indexOf(required[key]);
    if (out[key] < 0 && optional.indexOf(key) < 0) throw new Error('機具設備異常事件缺少欄位：' + required[key]);
  });
  return out;
}

function machineIncidentCell_(row, col, key) {
  return col[key] >= 0 ? row[col[key]] : '';
}

function getMachineIncidentGroupByReference_(reference) {
  const ref = sanitizeText_(reference, 100).trim();
  if (!ref || ref.length < 8) throw new Error('事件ID或紀錄ID至少需 8 碼');
  const sheet = getMachineIncidentSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
  if (!sheet || sheet.getLastRow() < 2) throw new Error('找不到機具設備異常事件');
  const headers = readMachineIncidentHeaders_(sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const recordIds = {};
  values.forEach(row => {
    const recordId = String(row[col.recordId] || '').trim();
    const incidentId = String(row[col.incidentId] || '').trim();
    if (recordId === ref || incidentId.indexOf(ref) === 0) recordIds[recordId] = true;
  });
  const matches = Object.keys(recordIds).filter(Boolean);
  if (!matches.length) throw new Error('找不到符合的機具設備異常');
  if (matches.length > 1) throw new Error('事件ID命中多筆檢查，請使用完整事件ID');
  return getMachineIncidentGroupByRecordId_(matches[0]);
}

function getMachineIncidentGroupByRecordId_(recordId) {
  const target = sanitizeText_(recordId, 100).trim();
  if (!target) throw new Error('缺少檢查紀錄ID');
  const sheet = getMachineIncidentSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
  if (!sheet || sheet.getLastRow() < 2) throw new Error('找不到機具設備異常事件');
  const headers = readMachineIncidentHeaders_(sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const items = [];
  values.forEach((row, index) => {
    if (String(row[col.recordId] || '').trim() !== target) return;
    items.push({
      rowNo: index + 2,
      incidentId: String(row[col.incidentId] || '').trim(),
      order: Number(row[col.order]) || 0,
      itemName: String(row[col.itemName] || '').trim(),
      result: String(row[col.result] || '').trim(),
      description: String(row[col.description] || '').trim(),
      status: String(row[col.status] || '').trim() || '待處理',
      completedDate: machineIncidentDateCell_(row[col.completedDate]),
      owner: String(row[col.owner] || '').trim(),
      note: String(row[col.note] || '').trim(),
      updatedAt: machineIncidentDateTimeCell_(row[col.updatedAt]),
      handlingPdfUrl: String(row[col.handlingPdf] || '').trim(),
      handlingApprovalStatus: String(row[col.handlingApprovalStatus] || '').trim(),
      handlingSupervisor: String(row[col.handlingSupervisor] || '').trim(),
      handlingApprovedAt: machineIncidentDateTimeCell_(row[col.handlingApprovedAt]),
      photoCount: Number(machineIncidentCell_(row, col, 'photoCount')) || 0,
      photoFolderUrl: String(machineIncidentCell_(row, col, 'photoFolder') || '').trim(),
      supervisorName: String(machineIncidentCell_(row, col, 'supervisorName') || '').trim(),
      supervisorKey: String(machineIncidentCell_(row, col, 'supervisorKey') || '').trim(),
      ownerKey: String(machineIncidentCell_(row, col, 'ownerKey') || '').trim(),
      reviewComment: String(machineIncidentCell_(row, col, 'reviewComment') || '').trim(),
    });
  });
  if (!items.length) throw new Error('找不到這次檢查的機具設備異常');
  items.sort((a, b) => a.order - b.order);
  const anchorRow = values[items[0].rowNo - 2];
  const group = {
    sheet,
    recordId: target,
    reportDate: machineIncidentDateCell_(anchorRow[col.reportDate]),
    equipmentId: String(anchorRow[col.equipmentId] || '').trim(),
    equipmentName: String(anchorRow[col.equipmentName] || '').trim(),
    category: String(anchorRow[col.category] || '').trim(),
    formType: String(anchorRow[col.formType] || '').trim(),
    originalPdfUrl: String(anchorRow[col.originalPdf] || '').trim(),
    handlingPdfUrl: items.map(item => item.handlingPdfUrl).filter(Boolean)[0] || '',
    handlingApprovalStatus: items.map(item => item.handlingApprovalStatus).filter(Boolean)[0] || '',
    handlingSupervisor: items.map(item => item.handlingSupervisor).filter(Boolean)[0] || '',
    handlingApprovedAt: items.map(item => item.handlingApprovedAt).filter(Boolean)[0] || '',
    // 照片、主管與處理人是「整組」層級資料，寫入時每列同步；讀取取第一個非空值。
    photoCount: Math.max.apply(null, items.map(item => item.photoCount || 0)),
    photoFolderUrl: items.map(item => item.photoFolderUrl).filter(Boolean)[0] || '',
    supervisorName: items.map(item => item.supervisorName).filter(Boolean)[0] || '',
    supervisorKey: items.map(item => item.supervisorKey).filter(Boolean)[0] || '',
    ownerKey: items.map(item => item.ownerKey).filter(Boolean)[0] || '',
    reviewComment: items.map(item => item.reviewComment).filter(Boolean)[0] || '',
    items,
  };
  group.allCompleted = items.every(item => item.status === '已完成');
  return group;
}

function publicMachineIncidentHandlingGroup_(group) {
  return {
    recordId: group.recordId,
    reportDate: group.reportDate,
    equipmentName: group.equipmentName,
    category: group.category,
    formType: group.formType,
    originalPdfUrl: /^https?:\/\//.test(group.originalPdfUrl || '') ? group.originalPdfUrl : '',
    handlingPdfUrl: /^https?:\/\//.test(group.handlingPdfUrl || '') ? group.handlingPdfUrl : '',
    handlingApprovalStatus: group.handlingApprovalStatus || '',
    awaitingApproval: group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_PENDING,
    approved: group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_APPROVED,
    returned: group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_RETURNED,
    supervisorName: group.supervisorName || '',
    supervisorKey: group.supervisorKey || '',
    progress: machineIncidentFlowProgress_(group),
    handlingSupervisor: group.handlingSupervisor || '',
    handlingApprovedAt: group.handlingApprovedAt || '',
    reviewComment: group.reviewComment || '',
    photoCount: Number(group.photoCount) || 0,
    maxPhotos: MACHINE_INCIDENT_MAX_PHOTOS,
    allCompleted: !!group.allCompleted && machineIncidentFinalizationComplete_(group),
    finalizationPending: !!group.allCompleted && !machineIncidentFinalizationComplete_(group),
    items: group.items.map(item => ({
      incidentId: item.incidentId,
      order: item.order,
      itemName: item.itemName,
      description: item.description,
      status: item.status,
      completedDate: item.completedDate,
      owner: item.owner,
      note: item.note,
      updatedAt: item.updatedAt,
    })),
  };
}

function machineIncidentCompletionDetailsValid_(group) {
  return !!(group.items && group.items.length) && group.items.every(item => {
    if (item.status !== '已完成' || !String(item.note || '').trim() || !item.completedDate) return false;
    try { parseISODate_(item.completedDate); return true; } catch (_) { return false; }
  });
}

function machineIncidentFinalizationComplete_(group) {
  if (!machineIncidentCompletionDetailsValid_(group)) return false;
  if (group.formType === '每月') {
    return ['待主管簽核', '已簽核歸檔'].indexOf(group.handlingApprovalStatus) >= 0 &&
      group.items.every(item => item.handlingApprovalStatus === group.handlingApprovalStatus);
  }
  // 每日檢：改版後須送指定主管核判；舊資料的「簽核略過＋處理PDF」仍視為已結案。
  if (group.handlingApprovalStatus === '簽核略過') {
    return !!group.handlingPdfUrl &&
      group.items.every(item => item.handlingApprovalStatus === '簽核略過' && item.handlingPdfUrl === group.handlingPdfUrl);
  }
  return [MACHINE_INCIDENT_REVIEW_PENDING, MACHINE_INCIDENT_REVIEW_APPROVED].indexOf(group.handlingApprovalStatus) >= 0 &&
    group.items.every(item => item.handlingApprovalStatus === group.handlingApprovalStatus);
}

/**
 * 機具異常目前流程位置，供 LINE 圖卡進度條與處理頁共用。
 * @param {{handlingApprovalStatus?: string, allCompleted?: boolean, supervisorName?: string,
 *   formType?: string, items?: Array<{owner?: string}>}} group
 * @return {{steps: string[], current: number, holder: string, note: string}}
 *   current 為目前步驟索引；等於 steps.length 代表全部完成。
 */
function machineIncidentFlowProgress_(group) {
  group = group || {};
  const steps = ['通報', '處理', '主管核判', '歸檔'];
  const status = String(group.handlingApprovalStatus || '');
  const owner = (group.items || []).map(item => item.owner).filter(Boolean)[0] || '';
  if (status === MACHINE_INCIDENT_REVIEW_APPROVED || (status === '簽核略過' && group.allCompleted)) {
    return { steps, current: steps.length, holder: '已完成歸檔', note: '' };
  }
  if (status === MACHINE_INCIDENT_REVIEW_PENDING && group.allCompleted) {
    return { steps, current: 2, holder: '核判主管：' + (group.supervisorName || '全部主管'), note: '' };
  }
  return {
    steps,
    current: 1,
    holder: '處理人：' + (owner || '尚未認領'),
    note: status === MACHINE_INCIDENT_REVIEW_RETURNED ? '主管退回補正' : '',
  };
}

/**
 * 解析處理人選的核判主管。只接受訂閱者清單中標記為主管的人，
 * 避免前端偽造 key 把案件送給非主管。
 * @param {string} key 前端下拉選單送來的主管 personKey
 * @return {{name: string, key: string}|null}
 */
function resolveMachineIncidentSupervisor_(key) {
  const target = sanitizeText_(key, 120).trim();
  if (!target) return null;
  const person = findLineSubscriberPersonByKey_(target, { requireSupervisor: true });
  if (!person) throw new Error('選擇的核判主管不在主管名單中，請重新選擇');
  return { name: person.name, key: person.key };
}

function writeMachineIncidentSupervisor_(group, supervisor) {
  const headers = ensureMachineIncidentHandlingColumns_(group.sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  group.items.forEach(item => {
    const range = group.sheet.getRange(item.rowNo, 1, 1, headers.length);
    const row = range.getValues()[0];
    row[col.supervisorName] = supervisor.name;
    row[col.supervisorKey] = supervisor.key;
    range.setValues([row]);
  });
  SpreadsheetApp.flush();
  group.supervisorName = supervisor.name;
  group.supervisorKey = supervisor.key;
}

function getMachineIncidentPhotoFolder_(group) {
  const equipment = getEquipmentById_(group.equipmentId) || {
    equipmentId: group.equipmentId,
    equipmentName: group.equipmentName,
    category: group.category,
    location: '',
  };
  const formType = group.formType === '每日' ? 'daily' : 'monthly';
  const archive = getOrCreateArchiveFolderForSubmission_(formType, equipment, parseISODate_(group.reportDate));
  const handling = getOrCreateSubFolder_(archive, '異常處理紀錄');
  const photos = getOrCreateSubFolder_(handling, '照片');
  return getOrCreateSubFolder_(photos, cleanDriveFolderName_(group.recordId));
}

/**
 * 讀出已上傳的處理後照片給處理頁顯示（上傳時已壓縮到單張 600KB 內，最多 8 張）。
 * @return {Array<{name: string, dataUrl: string}>}
 */
function listMachineIncidentPhotoDataUrls_(group) {
  const folderId = parseDriveFolderId_(group.photoFolderUrl);
  if (!folderId || !(Number(group.photoCount) > 0)) return [];
  try {
    const files = DriveApp.getFolderById(folderId).getFiles();
    const photos = [];
    while (files.hasNext() && photos.length < MACHINE_INCIDENT_MAX_PHOTOS) {
      const file = files.next();
      const mime = String(file.getMimeType() || '');
      if (mime.indexOf('image/') !== 0) continue;
      photos.push({
        name: file.getName(),
        dataUrl: `data:${mime};base64,${Utilities.base64Encode(file.getBlob().getBytes())}`,
      });
    }
    return photos.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    Logger.log('讀取機具異常處理照片失敗：' + err);
    return [];
  }
}

function appendMachineIncidentPhotosToBody_(body, group) {
  const folderId = parseDriveFolderId_(group.photoFolderUrl);
  if (folderId && Number(group.photoCount) > 0) appendDailyIncidentPhotosToPdf_(body, folderId);
}

function machineIncidentDateCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return formatISODate_(value);
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
  return match
    ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
    : text;
}

function machineIncidentDateTimeCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value || '').trim();
}

function createMachineIncidentHandlingLink_(recordId, userId) {
  const profile = getLineSubscriberProfileByUserId_(userId);
  if (!profile || !(profile.isStaff || profile.isSupervisor)) {
    throw new Error('只有訂閱者清單中的同仁或主管可以處理設備異常');
  }
  const personKey = lineSubscriberPersonKey_(userId);
  const token = createMachineIncidentHandlingToken_(recordId, personKey);
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('尚未設定 Web App 網址');
  return {
    url: `${base}?page=machine-incident-handle&recordId=${encodeURIComponent(recordId)}&token=${encodeURIComponent(token)}`,
    profile,
  };
}

/**
 * 由已通過 ADMIN_TOKEN 驗證的營運中控台核發短效管理連結。
 * 這個 token 不綁定 LINE 身分，本次操作人會記為「管理者代填」，
 * 但不覆寫原異常負責人，且連結僅存活 30 分鐘。
 */
function createMachineIncidentHandlingAdminLink_(recordId) {
  const target = sanitizeText_(recordId, 100).trim();
  if (!target) throw new Error('缺少檢查紀錄ID');
  // 先確認紀錄存在，避免替任意字串核發有效 token。
  getMachineIncidentGroupByRecordId_(target);
  const token = createMachineIncidentHandlingAdminToken_(target);
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('尚未設定 Web App 網址');
  return {
    url: `${base}?page=machine-incident-handle&recordId=${encodeURIComponent(target)}&token=${encodeURIComponent(token)}`,
    actorName: '管理者代填',
  };
}

function createMachineIncidentHandlingAdminToken_(recordId) {
  const payload = {
    v: 1,
    r: String(recordId || ''),
    p: '',
    a: 1,
    e: Math.floor(Date.now() / 1000) + MACHINE_INCIDENT_ADMIN_TOKEN_TTL_SECONDS,
  };
  const encoded = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload),
    Utilities.Charset.UTF_8,
  ).replace(/=+$/g, '');
  return encoded + '.' + machineIncidentHandlingSignature_(encoded);
}

function createMachineIncidentHandlingToken_(recordId, personKey) {
  const payload = {
    v: 1,
    r: String(recordId || ''),
    p: String(personKey || ''),
    e: Math.floor(Date.now() / 1000) + MACHINE_INCIDENT_HANDLING_TOKEN_TTL_SECONDS,
  };
  const encoded = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload),
    Utilities.Charset.UTF_8,
  ).replace(/=+$/g, '');
  return encoded + '.' + machineIncidentHandlingSignature_(encoded);
}

function assertMachineIncidentHandlingToken_(recordId, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !machineIncidentConstantTimeEqual_(parts[1], machineIncidentHandlingSignature_(parts[0]))) {
    throw new Error('處理回報連結無效，請從 LINE 重新開啟');
  }
  let payload;
  try {
    let encoded = parts[0];
    while (encoded.length % 4) encoded += '=';
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8'));
  } catch (_) {
    throw new Error('處理回報連結格式錯誤');
  }
  if (payload.v !== 1 || String(payload.r || '') !== String(recordId || '')) {
    throw new Error('處理回報連結與檢查紀錄不符');
  }
  if (!payload.e || Number(payload.e) < Math.floor(Date.now() / 1000)) {
    throw new Error('處理回報連結已逾期，請從 LINE 重新開啟');
  }
  if (Number(payload.a || 0) === 1) {
    return {
      payload,
      isAdmin: true,
      actorName: '管理者代填',
      person: {
        name: '',
        isSupervisor: false,
        isStaff: false,
      },
    };
  }
  const person = findLineSubscriberPersonByKey_(payload.p, { requireStaff: true });
  if (!person) throw new Error('你目前沒有處理這筆設備異常的權限');
  return { payload, person, isAdmin: false, actorName: person.name };
}

function machineIncidentHandlingSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('MACHINE_INCIDENT_HANDLING_SECRET') || '';
  if (!secret) {
    secret = uuid_() + '-' + uuid_();
    props.setProperty('MACHINE_INCIDENT_HANDLING_SECRET', secret);
  }
  return secret;
}

function machineIncidentHandlingSignature_(encoded) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(encoded || ''),
    machineIncidentHandlingSecret_(),
    Utilities.Charset.UTF_8,
  );
  return bytes.map(value => ((value + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function machineIncidentConstantTimeEqual_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function buildMachineIncidentHandlingLinkFlex_(group, url, actorName) {
  return {
    type: 'flex',
    altText: `機具設備異常處理回報｜${group.equipmentName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#B3261E',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🛠 機具設備異常處理回報', color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: `${group.formType || '檢查'}｜${group.items.length} 項`, color: '#FCE8E6', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildFlowProgressBox_(machineIncidentFlowProgress_(group)),
          dailyIncidentFlexField_('設備', group.equipmentName, { weight: 'bold' }),
          dailyIncidentFlexField_('日期', group.reportDate),
          dailyIncidentFlexField_('處理人', actorName),
          dailyIncidentFlexField_('待處理', `${group.items.filter(item => item.status !== '已完成').length} 項`, { color: '#B3261E', weight: 'bold' }),
          ...(group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_RETURNED && group.reviewComment
            ? [dailyIncidentFlexField_('退回原因', group.reviewComment, { color: '#B3261E', maxLen: 200 })]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#B3261E',
          action: { type: 'uri', label: '開啟處理回報', uri: url },
        }],
      },
    },
  };
}

function machineIncidentCompletionMeta_(group, fallbackActorName) {
  const owners = Array.from(new Set((group.items || []).map(item => item.owner).filter(Boolean)));
  const completedDates = (group.items || []).map(item => item.completedDate).filter(Boolean).sort();
  const updatedTimes = (group.items || []).map(item => item.updatedAt).filter(Boolean).sort();
  return {
    actorName: owners.join('、') || fallbackActorName || '',
    completedDate: completedDates.length ? completedDates[completedDates.length - 1] : '',
    updatedAt: updatedTimes.length ? updatedTimes[updatedTimes.length - 1] : Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
  };
}

function finalizeMachineIncidentHandling_(group, meta) {
  if (!machineIncidentCompletionDetailsValid_(group)) throw new Error('異常處理說明或完成日期不完整，請補齊後再送出');
  if (group.formType !== '每月') {
    // 每日檢異常：處理完先送指定主管核判，核准時才產正式 PDF（含主管與照片）。
    return {
      fileUrl: '',
      approvalStatus: MACHINE_INCIDENT_REVIEW_PENDING,
      approvalNotice: notifyMachineIncidentReviewerOnce_(group, meta),
    };
  }

  const rec = getApprovalRecordById_(group.recordId);
  if (rec.status === '已簽核歸檔') {
    throw new Error('這份月檢已完成主管簽核，無法再把處理附件併入原檔');
  }
  if (['待異常處理', '待主管簽核'].indexOf(rec.status) < 0) {
    throw new Error('這份月檢目前不可送主管簽核：' + (rec.status || '未設定'));
  }
  if (!rec.draftDocId) throw new Error('找不到這份月檢的待簽核草稿');
  if (!rec.approvalToken || rec.approvalToken.length < 32) throw new Error('這份月檢缺少主管簽核 Token');

  appendMachineIncidentHandlingToApprovalDoc_(rec.draftDocId, group, meta);
  if (rec.status !== '待主管簽核') {
    updateApprovalRecord_(rec.sheet, rec.headers, rec.rowNo, { 簽核狀態: '待主管簽核' });
  }
  const equipment = getEquipmentById_(rec.equipmentId) || {
    equipmentId: rec.equipmentId,
    equipmentName: rec.equipmentName,
    category: rec.category,
  };
  const approvalUrl = buildApprovalUrl_(rec.recordId, rec.approvalToken);
  const props = PropertiesService.getScriptProperties();
  const noticeKey = 'MACHINE_HANDLING_NOTICE_V1_' + sha256Hex_(group.recordId);
  const previous = props.getProperty(noticeKey);
  let approvalNotice;
  if (previous) {
    try { approvalNotice = JSON.parse(previous); }
    catch (_) { approvalNotice = { ok: false, reason: 'delivery_unknown' }; }
  } else {
  props.setProperty(noticeKey, JSON.stringify({ ok: false, reason: 'delivery_unknown' }));
  try {
    approvalNotice = notifySupervisorApprovalRequest_({
      recordId: rec.recordId,
      submittedAt: rec.submittedAt,
      checkDate: parseISODate_(rec.checkDate),
      formType: rec.formType,
      equipment,
      inspector: rec.inspector,
      incidentCount: rec.incidentCount,
      approvalUrl,
      // 有指定主管時只通知該主管；舊資料沒有指定時維持通知全部主管。
      supervisorName: group.supervisorName || '',
      supervisorKey: group.supervisorKey || '',
    });
  } catch (err) {
    Logger.log('異常處理完成後主管簽核通知失敗：' + err + '\n' + (err.stack || ''));
    approvalNotice = { ok: false, reason: 'line_error' };
  }
  props.setProperty(noticeKey, JSON.stringify({ ok: !!(approvalNotice && approvalNotice.ok),
    reason: approvalNotice && approvalNotice.ok ? 'accepted' : 'delivery_unknown' }));
  }
  return {
    fileUrl: '',
    approvalStatus: '待主管簽核',
    approvalNotice,
  };
}

function machineIncidentHandlingUrl_(recordId, token) {
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('尚未設定 Web App 網址');
  return `${base}?page=machine-incident-handle&recordId=${encodeURIComponent(recordId)}&token=${encodeURIComponent(token)}`;
}

function machineIncidentReviewerNoticeKey_(group, meta) {
  return 'MACHINE_HANDLING_REVIEW_NOTICE_V1_' +
    sha256Hex_(group.recordId + '|' + ((meta && meta.updatedAt) || ''));
}

/** 每日檢待主管核判、但這一輪的主管通知沒有成功送出（失敗時不留紀錄）。 */
function machineIncidentReviewerNoticeFailed_(group) {
  if (group.formType === '每月' || group.handlingApprovalStatus !== MACHINE_INCIDENT_REVIEW_PENDING) return false;
  const key = machineIncidentReviewerNoticeKey_(group, machineIncidentCompletionMeta_(group, ''));
  return !PropertiesService.getScriptProperties().getProperty(key);
}

/** 每日檢異常處理完成後，只通知被指定的核判主管一次（以完成時間區分退回後的再次送審）。 */
function notifyMachineIncidentReviewerOnce_(group, meta) {
  const props = PropertiesService.getScriptProperties();
  const noticeKey = machineIncidentReviewerNoticeKey_(group, meta);
  const previous = props.getProperty(noticeKey);
  if (previous) {
    try { return JSON.parse(previous); } catch (_) { return { ok: false, reason: 'delivery_unknown' }; }
  }
  props.setProperty(noticeKey, JSON.stringify({ ok: false, reason: 'delivery_unknown' }));
  let notice;
  try {
    if (!group.supervisorKey && !group.supervisorName) {
      notice = { ok: false, reason: 'no_supervisor' };
    } else {
      const url = machineIncidentHandlingUrl_(
        group.recordId,
        createMachineIncidentHandlingToken_(group.recordId, group.supervisorKey),
      );
      notice = linePushToSupervisorName_(
        group.supervisorName,
        withQuickReply_(buildMachineIncidentReviewRequestFlex_(group, url, meta || {})),
        { personKey: group.supervisorKey },
      );
    }
  } catch (err) {
    Logger.log('每日檢異常送主管核判通知失敗：' + err + '\n' + (err.stack || ''));
    notice = { ok: false, reason: 'line_error' };
  }
  if (notice && notice.ok) {
    props.setProperty(noticeKey, JSON.stringify({ ok: true, reason: 'accepted' }));
  } else {
    // 失敗不留紀錄，處理人可在頁面按「重新通知主管」重試，避免案件靜默卡在待核判。
    props.deleteProperty(noticeKey);
  }
  return notice;
}

function resendMachineIncidentReviewNoticeFromPage(payload) {
  try {
    payload = payload || {};
    const recordId = sanitizeText_(payload.recordId, 100).trim();
    assertMachineIncidentHandlingToken_(recordId, payload.token);
    const group = getMachineIncidentGroupByRecordId_(recordId);
    if (group.formType === '每月' || group.handlingApprovalStatus !== MACHINE_INCIDENT_REVIEW_PENDING ||
        !machineIncidentFinalizationComplete_(group)) {
      throw new Error('這筆異常目前不在待主管核判狀態');
    }
    const notice = notifyMachineIncidentReviewerOnce_(group, machineIncidentCompletionMeta_(group, ''));
    if (!notice || !notice.ok) {
      return { ok: false, error: '仍無法送出 LINE 通知，請確認核判主管在訂閱者清單中且已加入 LINE 好友' };
    }
    return { ok: true, reviewerNoticeFailed: false };
  } catch (err) {
    Logger.log('resendMachineIncidentReviewNoticeFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

/** 只有被指定的主管（舊資料未指定時為任一主管）能核判每日檢異常；月檢走原簽核頁。 */
function machineIncidentViewerCanReview_(group, auth) {
  if (!auth || auth.isAdmin || group.formType === '每月') return false;
  if (group.handlingApprovalStatus !== MACHINE_INCIDENT_REVIEW_PENDING) return false;
  if (!auth.person || !auth.person.isSupervisor) return false;
  return group.supervisorKey ? String((auth.payload && auth.payload.p) || '') === group.supervisorKey : true;
}

function reviewMachineIncidentHandlingFromPage(payload) {
  try {
    return reviewMachineIncidentHandling_(payload || {});
  } catch (err) {
    Logger.log('reviewMachineIncidentHandlingFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

/**
 * 主管核判每日檢機具異常處理結果。
 * @param {{recordId: string, token: string, decision: 'approve'|'return', comment?: string}} payload
 */
function reviewMachineIncidentHandling_(payload) {
  const recordId = sanitizeText_(payload.recordId, 100).trim();
  const auth = assertMachineIncidentHandlingToken_(recordId, payload.token);
  const decision = ['approve', 'return'].indexOf(payload.decision) >= 0 ? payload.decision : '';
  if (!decision) throw new Error('核判動作不正確');
  const comment = sanitizeText_(payload.comment, 600).trim();
  if (decision === 'return' && !comment) throw new Error('退回時請填寫退回原因');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let group;
  try {
    group = getMachineIncidentGroupByRecordId_(recordId);
    if (group.handlingApprovalStatus === MACHINE_INCIDENT_REVIEW_APPROVED) {
      return { ok: true, alreadyApproved: true, group: publicMachineIncidentHandlingGroup_(group) };
    }
    if (group.formType === '每月') throw new Error('月檢異常請從「主管簽核」圖卡進行簽核');
    if (group.handlingApprovalStatus !== MACHINE_INCIDENT_REVIEW_PENDING || !machineIncidentFinalizationComplete_(group)) {
      throw new Error('這筆異常目前不在待主管核判狀態');
    }
    if (!machineIncidentViewerCanReview_(group, auth)) throw new Error('你不是這筆異常指定的核判主管');

    const headers = ensureMachineIncidentHandlingColumns_(group.sheet);
    const col = machineIncidentHandlingColumnMap_(headers);
    const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    let fileUrl = '';
    if (decision === 'approve') {
      const meta = Object.assign(machineIncidentCompletionMeta_(group, ''), {
        supervisorName: auth.person.name,
        approvedAt: now,
        reviewComment: comment,
      });
      fileUrl = createMachineIncidentHandlingPdf_(group, meta).fileUrl;
    }
    group.items.forEach(item => {
      const range = group.sheet.getRange(item.rowNo, 1, 1, headers.length);
      const row = range.getValues()[0];
      row[col.reviewComment] = comment;
      if (decision === 'approve') {
        row[col.handlingPdf] = fileUrl;
        row[col.handlingApprovalStatus] = MACHINE_INCIDENT_REVIEW_APPROVED;
        row[col.handlingSupervisor] = auth.person.name;
        row[col.handlingApprovedAt] = now;
      } else {
        // 退回：項目改回處理中，處理人補正後重新送出才會再次通知主管。
        row[col.status] = '處理中';
        row[col.completedDate] = '';
        row[col.handlingPdf] = '';
        row[col.handlingApprovalStatus] = MACHINE_INCIDENT_REVIEW_RETURNED;
        row[col.handlingSupervisor] = auth.person.name;
        row[col.handlingApprovedAt] = now;
      }
      range.setValues([row]);
    });
    SpreadsheetApp.flush();
    group = getMachineIncidentGroupByRecordId_(recordId);
  } finally {
    lock.releaseLock();
  }
  const handlerNotice = notifyMachineIncidentHandler_(group, decision);
  return { ok: true, decision, handlerNotice, group: publicMachineIncidentHandlingGroup_(group) };
}

/** 核判結果通知原處理人；找不到 LINE 對象只記 log，不影響核判結果。 */
function notifyMachineIncidentHandler_(group, decision) {
  try {
    const ownerName = (group.items || []).map(item => item.owner).filter(Boolean)[0] || '';
    let ids = [];
    let personKey = group.ownerKey || '';
    if (personKey) ids = findLineSubscriberTargetsByPersonKey_(personKey, { requireStaff: true }).ids || [];
    if (!ids.length && ownerName) {
      const byName = findLineSubscriberTargetsByName_(ownerName, { requireStaff: true });
      if (!byName.ambiguous) ids = byName.ids || [];
      personKey = ids.length ? lineSubscriberPersonKey_(ids[0]) : '';
    }
    if (!ids.length) return { ok: false, reason: 'handler_not_found' };
    let flex;
    if (decision === 'return') {
      const url = machineIncidentHandlingUrl_(group.recordId, createMachineIncidentHandlingToken_(group.recordId, personKey));
      flex = buildMachineIncidentHandlingLinkFlex_(group, url, ownerName);
    } else {
      flex = buildMachineIncidentReviewResultFlex_(group);
    }
    return linePushTo_(ids[0], withQuickReply_(flex), 'push');
  } catch (err) {
    Logger.log('機具異常核判結果通知處理人失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, reason: 'line_error' };
  }
}

function persistMachineIncidentHandlingFinalization_(group, finalized) {
  const headers = ensureMachineIncidentHandlingColumns_(group.sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  (group.items || []).forEach(item => {
    const range = group.sheet.getRange(item.rowNo, 1, 1, headers.length);
    const row = range.getValues()[0];
    row[col.handlingPdf] = finalized.fileUrl || '';
    row[col.handlingApprovalStatus] = finalized.approvalStatus || '';
    row[col.handlingSupervisor] = '';
    row[col.handlingApprovedAt] = '';
    range.setValues([row]);
  });
  SpreadsheetApp.flush();
}

function appendMachineIncidentHandlingToApprovalDoc_(docId, group, meta) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const marker = `機具設備異常處理附件｜${group.recordId}`;
  if (body.getText().indexOf(marker) >= 0) {
    doc.saveAndClose();
    return { appended: false };
  }

  body.appendPageBreak();
  body.appendParagraph('機具設備異常處理紀錄')
    .setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(getOrgHeader_())
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .editAsText().setFontSize(11).setForegroundColor('#555555');
  body.appendParagraph(marker)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .editAsText().setFontSize(8).setForegroundColor('#888888');
  body.appendParagraph('');
  const metaTable = body.appendTable([
    ['設備名稱', group.equipmentName, '表單類型', group.formType],
    ['檢查日期', group.reportDate, '異常項數', `${group.items.length} 項`],
    ['處理人', meta.actorName || '', '完成日期', meta.completedDate || ''],
    ['處理時間', meta.updatedAt || '', '檢查紀錄ID', group.recordId],
    ['指定核判主管', group.supervisorName || '未指定', '處理後照片', `${Number(group.photoCount) || 0} 張`],
  ]);
  styleMetaTable_(metaTable);
  body.appendParagraph('');
  const rows = [['項次', '異常項目', '原異常說明', '處理狀態', '處理說明']];
  group.items.forEach(item => rows.push([
    String(item.order || ''),
    item.itemName || '',
    item.description || '',
    item.status || '',
    item.note || '',
  ]));
  styleMachineIncidentHandlingTable_(body.appendTable(rows));
  body.appendParagraph('');
  body.appendParagraph('本處理紀錄隨原月檢表送主管簽核，核准後合併為同一份正式 PDF 歸檔。')
    .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
    .editAsText().setFontSize(9).setForegroundColor('#666666');
  appendMachineIncidentPhotosToBody_(body, group);
  doc.saveAndClose();
  return { appended: true };
}

function ensureMachineIncidentHandlingReadyForApproval_(rec) {
  const group = getMachineIncidentGroupByRecordId_(rec.recordId);
  if (!group.allCompleted || !machineIncidentCompletionDetailsValid_(group)) {
    throw new Error('異常項目處理說明或日期尚未完整，暫時不能簽核歸檔');
  }
  appendMachineIncidentHandlingToApprovalDoc_(
    rec.draftDocId,
    group,
    machineIncidentCompletionMeta_(group, ''),
  );
  return group;
}

function machineIncidentHandlingApprovalSummary_(recordId) {
  const group = getMachineIncidentGroupByRecordId_(recordId);
  return {
    allCompleted: !!group.allCompleted && machineIncidentCompletionDetailsValid_(group),
    approvalStatus: group.handlingApprovalStatus || '',
    items: group.items.map(item => ({
      order: item.order,
      itemName: item.itemName,
      description: item.description,
      status: item.status,
      owner: item.owner,
      completedDate: item.completedDate,
      note: item.note,
    })),
  };
}

function markMachineIncidentHandlingApproved_(recordId, fileUrl, supervisorName, approvedAt) {
  let group;
  try {
    group = getMachineIncidentGroupByRecordId_(recordId);
  } catch (_) {
    return { ok: true, skipped: true, reason: 'no_machine_incidents' };
  }
  const headers = ensureMachineIncidentHandlingColumns_(group.sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  const approvedAtText = Utilities.formatDate(approvedAt || new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
  group.items.forEach(item => {
    group.sheet.getRange(item.rowNo, col.handlingPdf + 1).setValue(fileUrl || '');
    group.sheet.getRange(item.rowNo, col.handlingApprovalStatus + 1).setValue('已簽核歸檔');
    group.sheet.getRange(item.rowNo, col.handlingSupervisor + 1).setValue(supervisorName || '');
    group.sheet.getRange(item.rowNo, col.handlingApprovedAt + 1).setValue(approvedAtText);
  });
  SpreadsheetApp.flush();
  return { ok: true, updated: group.items.length };
}

function createMachineIncidentHandlingPdf_(group, meta) {
  const equipment = getEquipmentById_(group.equipmentId) || {
    equipmentId: group.equipmentId,
    equipmentName: group.equipmentName,
    category: group.category,
    location: '',
  };
  const formType = group.formType === '每日' ? 'daily' : 'monthly';
  const date = parseISODate_(group.reportDate);
  const archive = getOrCreateArchiveFolderForSubmission_(formType, equipment, date);
  const folder = getOrCreateSubFolder_(archive, '異常處理紀錄');
  const shortRecord = String(group.recordId || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 8);
  const fileName = `${formatROCDate_(date)}_${cleanDriveFolderName_(group.equipmentName)}_機具設備異常處理紀錄_${shortRecord}.pdf`;
  const doc = DocumentApp.create('tmp_machine_incident_' + shortRecord + '_' + Date.now());
  const docId = doc.getId();
  try {
    const body = doc.getBody();
    body.clear();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
    body.appendParagraph('機具設備異常處理紀錄')
      .setHeading(DocumentApp.ParagraphHeading.TITLE)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph(getOrgHeader_())
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(11).setForegroundColor('#555555');
    body.appendParagraph('');
    const metaTable = body.appendTable([
      ['設備名稱', group.equipmentName, '表單類型', group.formType],
      ['檢查日期', group.reportDate, '異常項數', `${group.items.length} 項`],
      ['處理人', meta.actorName, '完成日期', meta.completedDate],
      ['處理時間', meta.updatedAt, '檢查紀錄ID', group.recordId],
      ['核判主管', meta.supervisorName || group.supervisorName || '', '核判時間', meta.approvedAt || ''],
      ['主管意見', meta.reviewComment || '—', '處理後照片', `${Number(group.photoCount) || 0} 張`],
    ]);
    styleMetaTable_(metaTable);
    body.appendParagraph('');
    const rows = [['項次', '異常項目', '原異常說明', '處理狀態', '處理說明']];
    group.items.forEach(item => rows.push([
      String(item.order || ''),
      item.itemName || '',
      item.description || '',
      item.status || '',
      item.note || '',
    ]));
    const table = body.appendTable(rows);
    styleMachineIncidentHandlingTable_(table);
    if (group.originalPdfUrl) {
      body.appendParagraph('');
      body.appendParagraph('原檢查紀錄 PDF：' + group.originalPdfUrl)
        .editAsText().setFontSize(9).setForegroundColor('#555555');
    }
    body.appendParagraph('');
    body.appendParagraph(meta.supervisorName ? '本紀錄經核判主管核准後產製。' : '本紀錄由處理人完成回報後產製。')
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(9).setForegroundColor('#888888');
    appendMachineIncidentPhotosToBody_(body, group);
    doc.saveAndClose();
    const blob = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(fileName);
    const file = folder.createFile(blob);
    sharePdfFileForLinkView_(file, 'machine-incident-handling');
    return { fileId: file.getId(), fileUrl: file.getUrl(), fileName };
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (err) { Logger.log('刪除設備異常暫存 Doc 失敗：' + err); }
  }
}

function styleMachineIncidentHandlingTable_(table) {
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(5).setPaddingRight(5);
      const text = cell.editAsText().setFontSize(9);
      if (r === 0) {
        cell.setBackgroundColor('#1A73E8');
        text.setForegroundColor('#FFFFFF').setBold(true);
      } else if (c === 3) {
        text.setForegroundColor(row.getCell(c).getText() === '已完成' ? '#137333' : '#B3261E').setBold(true);
      }
    }
  }
}
