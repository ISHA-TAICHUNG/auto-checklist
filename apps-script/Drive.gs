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
 * 在父資料夾中找子資料夾，沒有就建一個
 */
function getOrCreateSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}
