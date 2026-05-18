/**
 * ===== PDF 產生 =====
 *
 * 作法：用 HTML 模板套版 → Apps Script 內建的 HtmlService 渲染 → getAs(PDF)
 *
 * 為什麼用 HTML：純文字 PDF 醜，Doc 模板要先建立檔案副本，HTML 最直觀好維護。
 */

function buildPdf_(formType, ctx) {
  const tplName = formType === 'daily' ? 'pdf-daily' : 'pdf-monthly';
  const tpl = HtmlService.createTemplateFromFile(tplName);

  // 把所有要塞進模板的變數放上去
  tpl.org = CONFIG.ORGANIZATION_HEADER;
  tpl.equipment = ctx.equipment;
  tpl.payload = ctx.payload;
  tpl.checkDate = ctx.checkDate;
  tpl.rocDateStr = formatROCDate_(ctx.checkDate);
  tpl.submittedAt = Utilities.formatDate(
    ctx.submittedAt, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm'
  );
  tpl.escapeHtml = escapeHtml_;
  tpl.toROC = toROC_;

  const html = tpl.evaluate().getContent();
  const blob = Utilities.newBlob(html, 'text/html', 'tmp.html').getAs('application/pdf');
  return blob;
}
