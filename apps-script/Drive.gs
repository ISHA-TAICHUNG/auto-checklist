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
 */

/**
 * 取得（或建立）某機具類別、某年某月的歸檔資料夾
 */
function getOrCreateArchiveFolder_(category, date) {
  const rootId = CONFIG.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId || rootId.startsWith('REPLACE_')) {
    throw new Error('尚未設定 ARCHIVE_ROOT_FOLDER_ID，請到 Config.gs 填入 Drive 資料夾 ID');
  }
  const root = DriveApp.getFolderById(rootId);

  const categoryFolder = getOrCreateSubFolder_(root, category);
  const yearFolder = getOrCreateSubFolder_(categoryFolder, formatROCYear_(date));
  const monthFolder = getOrCreateSubFolder_(yearFolder, formatROCMonth_(date));

  return monthFolder;
}

/**
 * 待主管簽核草稿放在歸檔根資料夾下方，避免尚未簽核的文件混入正式年月歸檔。
 */
function getOrCreatePendingApprovalFolder_() {
  const rootId = CONFIG.ARCHIVE_ROOT_FOLDER_ID;
  if (!rootId || rootId.startsWith('REPLACE_')) {
    throw new Error('尚未設定 ARCHIVE_ROOT_FOLDER_ID，請到 Config.gs 填入 Drive 資料夾 ID');
  }
  const root = DriveApp.getFolderById(rootId);
  return getOrCreateSubFolder_(root, '_待主管簽核');
}

/**
 * 在父資料夾中找子資料夾，沒有就建一個
 */
function getOrCreateSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
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
