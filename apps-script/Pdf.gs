/**
 * ===== PDF 產生 =====
 *
 * 作法：HTML 模板套版 → HtmlService 渲染 → getAs(PDF)
 *
 * 簽名處理（重要）：
 *   Apps Script 的 HTML→PDF 引擎「不支援」base64 data URL 內嵌圖片，
 *   會 render 出破圖 icon。解決方法：
 *     1. 把簽名 base64 解碼成 PNG blob
 *     2. 存到 Drive 暫存（任何人有連結可看，但連結含長 ID 不易猜）
 *     3. 取 Drive 的「uc?id=」URL 餵給 PDF 引擎
 *     4. PDF 產生完成後刪掉暫存 PNG（PDF 已 embed 圖片，外部 URL 不再需要）
 *
 * 為什麼用 HTML：純文字 PDF 醜，Doc 模板要先建檔副本，HTML 最直觀好維護。
 */

function buildPdf_(formType, ctx) {
  const tplName = formType === 'daily' ? 'pdf-daily' : 'pdf-monthly';
  const tpl = HtmlService.createTemplateFromFile(tplName);

  // 簽名：存 Drive 暫存 → 取 URL
  let signatureUrl = '';
  let signatureFile = null;
  if (ctx.payload.signature) {
    try {
      const sigBlob = dataUrlToBlob_(ctx.payload.signature, 'sig.png');
      if (sigBlob) {
        const tempFolder = getOrCreateSignatureTempFolder_();
        signatureFile = tempFolder.createFile(sigBlob);
        signatureFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
        signatureUrl = 'https://drive.google.com/uc?id=' + signatureFile.getId();
      }
    } catch (e) {
      Logger.log('簽名暫存失敗：' + e);
    }
  }

  // 把所有要塞進模板的變數放上去
  tpl.org = CONFIG.ORGANIZATION_HEADER;
  tpl.equipment = ctx.equipment;
  tpl.payload = ctx.payload;
  tpl.checkDate = ctx.checkDate;
  tpl.rocDateStr = formatROCDate_(ctx.checkDate);
  tpl.submittedAt = Utilities.formatDate(ctx.submittedAt, tz_(), 'yyyy/MM/dd HH:mm');
  tpl.signatureUrl = signatureUrl;
  tpl.escapeHtml = escapeHtml_;
  tpl.toROC = toROC_;

  const html = tpl.evaluate().getContent();
  const blob = Utilities.newBlob(html, 'text/html', 'tmp.html').getAs('application/pdf');

  // PDF 已 embed 簽名，可安全刪 Drive 暫存
  if (signatureFile) {
    try {
      signatureFile.setTrashed(true);
    } catch (e) {
      Logger.log('刪簽名暫存失敗：' + e);
    }
  }

  return blob;
}

/**
 * 取得簽名暫存資料夾（在歸檔根資料夾下的 _signature_tmp）
 *
 * 用「_」開頭命名，讓它在 Drive 列表中沉到下面，
 * 也代表這是系統內部使用、不要被誤刪
 */
function getOrCreateSignatureTempFolder_() {
  const root = DriveApp.getFolderById(CONFIG.ARCHIVE_ROOT_FOLDER_ID);
  return getOrCreateSubFolder_(root, '_signature_tmp');
}
