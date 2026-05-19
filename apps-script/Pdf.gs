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

  // 在這層自己算 rocDateStr 與 submittedAt 字串，不依賴外部傳入
  const rocDateStr = formatROCDate_(ctx.checkDate);
  const submittedAtStr = Utilities.formatDate(ctx.submittedAt, tz_(), 'yyyy/MM/dd HH:mm');

  try {
    const body = doc.getBody();

    // ----- 頁面設定（A4，邊界小一點容納內容）-----
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

    // ----- 標題 -----
    // codex P2: 用 DB 模板的 templateName，未來新增機具不會錯
    const fallbackTitle = isDaily ? '每日作業前檢點表' : '每月定期檢查紀錄';
    const titleText = (ctx.template && ctx.template.templateName) || fallbackTitle;
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
    const rocDate = `${rocDateStr.substring(0,3)}/${rocDateStr.substring(3,5)}/${rocDateStr.substring(5,7)}`;
    const metaTable = body.appendTable([
      ['設備名稱', eq.equipmentName, '設備類別', eq.category],
      ['機械編號', eq.machineSerial, '型式規格', eq.machineType],
      ['所在位置', eq.location, '檢查日期', rocDate],
    ]);
    styleMetaTable_(metaTable);

    body.appendParagraph('');

    // ----- 檢查項目表 -----
    let rows, colWidths;
    const tplOptions = (ctx.template && ctx.template.resultOptions) || [];
    if (isDaily) {
      rows = [['項次', '檢查項目', '結果', '記事 / 異常說明']];
      colWidths = [40, 280, 60, 140];
      ctx.payload.items.forEach(it => {
        rows.push([String(it.order), it.name, it.result, it.note || '']);
      });
    } else {
      // 月檢按 monthlySchema 決定欄位
      const schema = (ctx.template && ctx.template.monthlySchema) || 'crane_full';
      if (schema === 'simple') {
        // 堆高機月檢樣式：項次/檢查部份/檢查方法/檢查結果/改善措施
        rows = [['項次', '檢查部份', '檢查方法', '檢查結果', '改善措施']];
        colWidths = [40, 200, 80, 100, 180];
        ctx.payload.items.forEach(it => {
          rows.push([
            String(it.order),
            it.name,
            it.method || (it.methods || []).join('/'),
            it.result || '',
            it.action || '',
          ]);
        });
      } else {
        // crane_full：固定式起重機月檢 7 欄
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
    }
    const itemsTable = body.appendTable(rows);
    styleItemsTable_(itemsTable, colWidths, isDaily, tplOptions);

    body.appendParagraph('');

    // ----- 填寫規則（優先用 DB 模板的 rule + legalBasis）-----
    const tpl = ctx.template || {};
    const tplRule = tpl.rule;
    const tplLegal = tpl.legalBasis;
    let ruleText;
    if (tplRule) {
      ruleText = '填寫規則：' + tplRule;
      if (tplLegal) ruleText += '\n依據：' + tplLegal;
    } else {
      ruleText = isDaily
        ? '填寫規則：良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）。\n依據「職業安全衛生管理辦法」第五十二條規定，發現異常應立即檢修或採取必要措施。'
        : '注意事項：檢查結果應詳細紀錄。風險評估：嚴重性危害「V」/ 可能性危害「?」/ 無危害「—」';
    }
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
      const sigBlob = dataUrlToBlob_(ctx.payload.signature, 'sig.png');
      if (!sigBlob) throw new Error('dataUrlToBlob_ 回 null，signature 開頭: ' + ctx.payload.signature.substring(0, 50));
      const img = body.appendImage(sigBlob);
      const maxW = 260;
      if (img.getWidth() > maxW) {
        const ratio = img.getHeight() / img.getWidth();
        img.setWidth(maxW);
        img.setHeight(Math.round(maxW * ratio));
      }
      signatureInserted = true;
    }
    if (!signatureInserted) {
      const noSig = body.appendParagraph('（無簽名）');
      noSig.editAsText().setFontSize(10).setForegroundColor('#c5221f');
    }

    const inspectorP = body.appendParagraph(ctx.payload.inspector || '');
    inspectorP.editAsText().setFontSize(11);

    // ----- 送出時間 -----
    body.appendParagraph('');
    const submitP = body.appendParagraph('送出時間：' + submittedAtStr + '   系統自動產製');
    submitP.editAsText().setFontSize(9).setForegroundColor('#888888');
    submitP.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

    // ----- 異常照片附件（如果有任何項目附了照片）-----
    const itemsWithPhotos = (ctx.payload.items || []).filter(
      it => Array.isArray(it.photos) && it.photos.length > 0
    );
    if (itemsWithPhotos.length > 0) {
      body.appendPageBreak();
      const attachTitle = body.appendParagraph('異常照片附件');
      attachTitle.setHeading(DocumentApp.ParagraphHeading.HEADING1);
      attachTitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

      itemsWithPhotos.forEach(it => {
        body.appendParagraph('');                                                                  // 間距
        const labelP = body.appendParagraph(`第 ${it.order} 項：${it.name}`);
        labelP.editAsText().setFontSize(12).setBold(true).setForegroundColor('#1a73e8');

        if (it.abnormalDesc || it.note) {
          const descP = body.appendParagraph('異常說明：' + (it.abnormalDesc || it.note));
          descP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
        }

        it.photos.forEach((p, pi) => {
          try {
            const photoBlob = dataUrlToBlob_(p, `item${it.order}_photo${pi + 1}.jpg`);
            if (photoBlob) {
              body.appendParagraph('');
              const photoImg = body.appendImage(photoBlob);
              const maxW = 480;
              if (photoImg.getWidth() > maxW) {
                const ratio = photoImg.getHeight() / photoImg.getWidth();
                photoImg.setWidth(maxW);
                photoImg.setHeight(Math.round(maxW * ratio));
              }
              const cap = body.appendParagraph(`照片 ${pi + 1} / ${it.photos.length}`);
              cap.editAsText().setFontSize(9).setForegroundColor('#888888');
              cap.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
            }
          } catch (e) {
            Logger.log(`第 ${it.order} 項照片 ${pi + 1} 嵌入失敗：` + e);
          }
        });
      });
    }

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

/** 檢查項目表樣式：header 藍底白字、欄寬控制、字 10pt、good/bad 顏色
 *
 *  動態結果顏色：根據 resultOptions 陣列位置
 *    - 第 1 個值 = good（綠）
 *    - 最後 1 個值 = bad（紅）
 *    - 中間 = neutral（灰）
 *  例：['V','/','X'] → V=綠、/=灰、X=紅
 *      ['○','△','X'] → ○=綠、△=灰、X=紅
 *      ['ˇ','X']      → ˇ=綠、X=紅
 */
function styleItemsTable_(table, colWidths, isDaily, resultOptions) {
  const numRows = table.getNumRows();
  const HCenter = DocumentApp.HorizontalAlignment.CENTER;
  const setCenter = (cell) => {
    try { cell.getChild(0).asParagraph().setAlignment(HCenter); } catch (_) {}
  };

  const opts = (resultOptions && resultOptions.length) ? resultOptions : ['V', '/', 'X'];
  const goodValue = opts[0];
  const badValue = opts[opts.length - 1];

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
        cell.setBackgroundColor('#1a73e8');
        text.setForegroundColor('#ffffff').setBold(true);
        setCenter(cell);
      } else {
        if (c === 0) setCenter(cell);
        if (isDaily && c === 2) {
          const v = text.getText();
          setCenter(cell);
          if (v === badValue) text.setForegroundColor('#c5221f').setBold(true);
          else if (v === goodValue) text.setForegroundColor('#137333').setBold(true);
          else text.setForegroundColor('#666666');
        }
        // 月檢結果欄（crane_full 在 c=3、simple 也在 c=3）
        if (!isDaily && c === 3) {
          const v = text.getText();
          // crane_full 用「正常 / 異常：xxx」格式
          if (v.indexOf('異常') === 0) text.setForegroundColor('#c5221f').setBold(true);
          else if (v === '正常') text.setForegroundColor('#137333');
          // simple 用結果代號（ˇ / X）
          else if (v === badValue) text.setForegroundColor('#c5221f').setBold(true);
          else if (v === goodValue) text.setForegroundColor('#137333').setBold(true);
        }
      }
    }
  }
}
