/**
 * ===== PDF 產生（DocumentApp 版本）=====
 *
 * 為何改用 DocumentApp：
 *   HtmlService.getAs('application/pdf') 對圖片支援有限——
 *     - 不支援 base64 data URL（會變破圖）
 *     - 對 drive.google.com/uc?id= 或 lh3.googleusercontent.com URL 也不穩
 *   DocumentApp.appendImage(blob) 是 Google 原生 API，圖片支援最可靠。
 *
 * 流程：
 *   1. 建立暫時 Google Doc
 *   2. 寫入標題、機構抬頭、設備資訊、檢查項目表、規則、簽名（圖+姓名）、送出時間
 *   3. saveAndClose → getAs('application/pdf')
 *   4. 把暫時 Doc 移到垃圾桶（PDF 已產出，Doc 不再需要）
 */

function buildPdf_(formType, ctx) {
  const isDaily = formType === 'daily';
  const docName = 'tmp_pdf_' + ctx.recordId;
  const doc = DocumentApp.create(docName);
  const docId = doc.getId();

  try {
    const body = doc.getBody();

    // ----- 頁面設定（A4，邊界小一點容納內容）-----
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

    // ----- 標題 -----
    const titleText = isDaily ? '固定式起重機每日作業前檢點表' : '固定式起重機每月定期檢查紀錄';
    const titleP = body.appendParagraph(titleText);
    titleP.setHeading(DocumentApp.ParagraphHeading.TITLE);
    titleP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    // ----- 機構抬頭 -----
    const orgP = body.appendParagraph(getOrgHeader_());
    orgP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    orgP.editAsText().setFontSize(11).setForegroundColor('#555555');

    body.appendParagraph(''); // 空行

    // ----- 設備資訊表 -----
    const eq = ctx.equipment;
    const rocDate = `${ctx.rocDateStr.substring(0,3)}/${ctx.rocDateStr.substring(3,5)}/${ctx.rocDateStr.substring(5,7)}`;
    const metaTable = body.appendTable([
      ['設備名稱', eq.equipmentName, '設備類別', eq.category],
      ['機械編號', eq.machineSerial, '型式規格', eq.machineType],
      ['所在位置', eq.location, '檢查日期', rocDate],
    ]);
    styleMetaTable_(metaTable);

    body.appendParagraph('');

    // ----- 檢查項目表 -----
    let rows, colWidths;
    if (isDaily) {
      rows = [['項次', '檢查項目', '結果', '記事 / 異常說明']];
      colWidths = [40, 280, 60, 140];
      ctx.payload.items.forEach(it => {
        rows.push([String(it.order), it.name, it.result, it.note || '']);
      });
    } else {
      rows = [['項次', '檢查部份', '檢查方法', '檢查結果', '風險評估', '改善措施', '定期檢討']];
      colWidths = [30, 130, 60, 120, 50, 90, 90];
      ctx.payload.items.forEach(it => {
        const methods = (it.methods || []).join('/');
        const resultText = it.result === 'abnormal'
          ? '異常：' + (it.abnormalDesc || '')
          : '正常';
        const riskMap = { severe: 'V 嚴重', possible: '? 可能', none: '— 無' };
        rows.push([
          String(it.order),
          it.name,
          methods,
          resultText,
          riskMap[it.risk] || '',
          it.action || '',
          it.review || '',
        ]);
      });
    }
    const itemsTable = body.appendTable(rows);
    styleItemsTable_(itemsTable, colWidths, isDaily);

    body.appendParagraph('');

    // ----- 填寫規則 -----
    const ruleText = isDaily
      ? '填寫規則：良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）。\n依據「職業安全衛生管理辦法」第五十二條規定，發現異常應立即檢修或採取必要措施。'
      : '注意事項：檢查結果應詳細紀錄。風險評估：嚴重性危害「V」/ 可能性危害「?」/ 無危害「—」';
    const ruleP = body.appendParagraph(ruleText);
    ruleP.editAsText().setFontSize(9).setForegroundColor('#555555');

    body.appendParagraph('');

    // ----- 簽名（圖 + 姓名）-----
    const sigLabel = body.appendParagraph(
      isDaily ? '檢點人員簽名：' : '檢查人員簽名：'
    );
    sigLabel.editAsText().setFontSize(11).setBold(true);

    let signatureInserted = false;
    if (ctx.payload.signature) {
      try {
        const sigBlob = dataUrlToBlob_(ctx.payload.signature, 'sig.png');
        if (sigBlob) {
          const img = body.appendImage(sigBlob);
          // 限制簽名圖寬度，高度自動依比例
          const maxW = 260;
          if (img.getWidth() > maxW) {
            const ratio = img.getHeight() / img.getWidth();
            img.setWidth(maxW);
            img.setHeight(Math.round(maxW * ratio));
          }
          signatureInserted = true;
          Logger.log('簽名圖已嵌入 PDF');
        }
      } catch (e) {
        Logger.log('插入簽名失敗：' + e + '\n' + (e.stack || ''));
      }
    }
    if (!signatureInserted) {
      const noSig = body.appendParagraph('（無簽名）');
      noSig.editAsText().setFontSize(10).setForegroundColor('#c5221f');
    }

    const inspectorP = body.appendParagraph(ctx.payload.inspector || '');
    inspectorP.editAsText().setFontSize(11);

    // ----- 送出時間 -----
    body.appendParagraph('');
    const submitP = body.appendParagraph('送出時間：' + ctx.submittedAt + '   系統自動產製');
    submitP.editAsText().setFontSize(9).setForegroundColor('#888888');
    submitP.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

    doc.saveAndClose();

    // ----- 匯出 PDF -----
    const pdfBlob = DriveApp.getFileById(docId).getAs('application/pdf');
    return pdfBlob;

  } finally {
    // 不論成功失敗，刪暫時 Doc
    try {
      DriveApp.getFileById(docId).setTrashed(true);
    } catch (e) {
      Logger.log('刪暫時 Doc 失敗：' + e);
    }
  }
}

/** 設備資訊表樣式：label 灰底、border、字 10pt */
function styleMetaTable_(table) {
  const numRows = table.getNumRows();
  for (let r = 0; r < numRows; r++) {
    const row = table.getRow(r);
    const numCols = row.getNumCells();
    for (let c = 0; c < numCols; c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(8).setPaddingRight(8);
      const text = cell.editAsText();
      text.setFontSize(10);
      // 第 0、2 欄是 label
      if (c === 0 || c === 2) {
        cell.setBackgroundColor('#f0f0f0');
        text.setBold(true);
        cell.setWidth(70);
      }
    }
  }
}

/** 檢查項目表樣式：header 藍底白字、欄寬控制、字 10pt、異常紅字 */
function styleItemsTable_(table, colWidths, isDaily) {
  const numRows = table.getNumRows();
  for (let r = 0; r < numRows; r++) {
    const row = table.getRow(r);
    const numCols = row.getNumCells();
    for (let c = 0; c < numCols; c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(6).setPaddingRight(6);
      const text = cell.editAsText();
      text.setFontSize(10);

      if (colWidths && colWidths[c]) cell.setWidth(colWidths[c]);

      if (r === 0) {
        // header
        cell.setBackgroundColor('#1a73e8');
        text.setForegroundColor('#ffffff').setBold(true);
        cell.setHorizontalAlignment(DocumentApp.HorizontalAlignment.CENTER);
      } else {
        // body：項次、結果欄置中；結果為 X 或 異常 用紅字
        if (c === 0) {
          cell.setHorizontalAlignment(DocumentApp.HorizontalAlignment.CENTER);
        }
        if (isDaily && c === 2) {
          const v = text.getText();
          cell.setHorizontalAlignment(DocumentApp.HorizontalAlignment.CENTER);
          if (v === 'X') text.setForegroundColor('#c5221f').setBold(true);
          else if (v === 'V') text.setForegroundColor('#137333').setBold(true);
          else text.setForegroundColor('#666666');
        }
        if (!isDaily && c === 3) {
          const v = text.getText();
          if (v.indexOf('異常') === 0) text.setForegroundColor('#c5221f').setBold(true);
          else if (v === '正常') text.setForegroundColor('#137333');
        }
      }
    }
  }
}
