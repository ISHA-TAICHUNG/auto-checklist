/**
 * ===== Google Drive 雲端歸檔 =====
 *
 * 歸檔結構：
 *   [根資料夾]
 *     └─ 固定式起重機/
 *         └─ 115年/
 *             └─ 05月/
 *                 ├─ 1150501_<設備名稱>_日檢.pdf
 *                 ├─ 1150502_<設備名稱>_日檢.pdf
 *                 └─ 1150531_<設備名稱>_月檢.pdf
 *     └─ 堆高機/             ← 未來新增機具時自動建立
 *         └─ 115年/05月/
 *     └─ 置備之安全衛生量測設備及個人防護具每月檢核表/
 *         └─ 115年/06月/龍井教室/
 */

/**
 * 取得（或建立）某機具類別、某年某月的歸檔資料夾
 */
function getOrCreateArchiveFolder_(category, date) {
  const root = getArchiveRootFolder_();

  const categoryFolder = getOrCreateSubFolder_(root, category);
  const yearFolder = getOrCreateSubFolder_(categoryFolder, formatROCYear_(date));
  const monthFolder = getOrCreateSubFolder_(yearFolder, formatROCMonth_(date));

  return monthFolder;
}

/**
 * 取得正式 PDF 歸檔資料夾。
 * 三間教室月檢集中在同一個表單資料夾，再依「年份 / 月份 / 教室」分類。
 * 其他機具沿用原本「設備類別 / 年 / 月」結構。
 */
function getOrCreateArchiveFolderForSubmission_(formType, equipment, date) {
  if (isClassroomMonthlySafetyPpeArchive_(formType, equipment)) {
    return getOrCreateClassroomMonthlySafetyPpeArchiveFolder_(equipment, date);
  }
  return getOrCreateArchiveFolder_(equipment.category, date);
}

function getOrCreateClassroomMonthlySafetyPpeArchiveFolder_(equipment, date) {
  const root = getArchiveRootFolder_();
  const formFolder = getOrCreateSubFolder_(root, '置備之安全衛生量測設備及個人防護具每月檢核表');
  const yearFolder = getOrCreateSubFolder_(formFolder, formatROCYear_(date));
  const monthFolder = getOrCreateSubFolder_(yearFolder, formatROCMonth_(date));
  return getOrCreateSubFolder_(monthFolder, classroomArchiveName_(equipment));
}

function isClassroomMonthlySafetyPpeArchive_(formType, equipment) {
  if (formType !== 'monthly') return false;
  const id = String((equipment && equipment.equipmentId) || '').trim().toUpperCase();
  return [
    'CLASSROOM-LJ-MEAS-PPE',
    'CLASSROOM-FX-MEAS-PPE',
    'CLASSROOM-ZM-MEAS-PPE',
  ].indexOf(id) >= 0;
}

function classroomArchiveName_(equipment) {
  const location = String((equipment && equipment.location) || '').trim();
  if (location) return cleanDriveFolderName_(location);
  const id = String((equipment && equipment.equipmentId) || '').trim().toUpperCase();
  if (id.indexOf('CLASSROOM-LJ-') === 0) return '龍井教室';
  if (id.indexOf('CLASSROOM-FX-') === 0) return '復興教室';
  if (id.indexOf('CLASSROOM-ZM-') === 0) return '忠明教室';
  return '未指定教室';
}

/**
 * 待主管簽核草稿放在歸檔根資料夾下方，避免尚未簽核的文件混入正式年月歸檔。
 */
function getOrCreatePendingApprovalFolder_() {
  const root = getArchiveRootFolder_();
  return getOrCreateSubFolder_(root, '_待主管簽核');
}

function getArchiveRootFolder_() {
  const rootId = CONFIG.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId || rootId.startsWith('REPLACE_')) {
    throw new Error('尚未設定 ARCHIVE_ROOT_FOLDER_ID，請到 Config.gs 填入 Drive 資料夾 ID');
  }
  return DriveApp.getFolderById(rootId);
}

/**
 * 在父資料夾中找子資料夾，沒有就建一個
 */
function getOrCreateSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function cleanDriveFolderName_(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '／').trim() || '未命名';
}

/**
 * 驗證一個 file 是否在 ARCHIVE_ROOT_FOLDER_ID 之下（含深層子資料夾）
 * 用於 admin fetchPdf 限制範圍（防止讀其他 Drive 檔案）
 */
function isUnderArchiveRoot_(fileId) {
  const rootId = CONFIG.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId || rootId.startsWith('REPLACE_')) return false;
  let file;
  try { file = DriveApp.getFileById(fileId); } catch (_) { return false; }
  // 遞迴往上找 parent；最多 5 層（年/月/類別/根）
  const seen = new Set();
  let parents = file.getParents();
  for (let depth = 0; depth < 10; depth++) {
    if (!parents.hasNext()) return false;
    const p = parents.next();
    if (p.getId() === rootId) return true;
    if (seen.has(p.getId())) return false;  // 避免迴圈
    seen.add(p.getId());
    parents = p.getParents();
  }
  return false;
}

function isFolderUnderArchiveRoot_(folderId) {
  const rootId = CONFIG.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId || rootId.startsWith('REPLACE_')) return false;
  let folder;
  try { folder = DriveApp.getFolderById(folderId); } catch (_) { return false; }
  if (folder.getId() === rootId) return true;

  const seen = new Set();
  let parents = folder.getParents();
  for (let depth = 0; depth < 10; depth++) {
    if (!parents.hasNext()) return false;
    const p = parents.next();
    if (p.getId() === rootId) return true;
    if (seen.has(p.getId())) return false;
    seen.add(p.getId());
    parents = p.getParents();
  }
  return false;
}

function diagnoseDriveFolder_(opts) {
  opts = opts || {};
  const folderId = sanitizeText_(opts.folderId || opts.id, 120);
  if (!folderId) throw new Error('需提供 folderId');
  if (!isFolderUnderArchiveRoot_(folderId)) {
    throw new Error('該資料夾非系統歸檔範圍');
  }

  const folder = DriveApp.getFolderById(folderId);
  const files = [];
  const fileIt = folder.getFiles();
  while (fileIt.hasNext() && files.length < 200) {
    const file = fileIt.next();
    files.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      createdAt: Utilities.formatDate(file.getDateCreated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      updatedAt: Utilities.formatDate(file.getLastUpdated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      url: file.getUrl(),
    });
  }

  const folders = [];
  const folderIt = folder.getFolders();
  while (folderIt.hasNext() && folders.length < 100) {
    const child = folderIt.next();
    folders.push({
      id: child.getId(),
      name: child.getName(),
      createdAt: Utilities.formatDate(child.getDateCreated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      updatedAt: Utilities.formatDate(child.getLastUpdated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      url: child.getUrl(),
    });
  }

  return {
    folder: {
      id: folder.getId(),
      name: folder.getName(),
      createdAt: Utilities.formatDate(folder.getDateCreated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      updatedAt: Utilities.formatDate(folder.getLastUpdated(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
      url: folder.getUrl(),
    },
    fileCount: files.length,
    folderCount: folders.length,
    files,
    folders,
  };
}
