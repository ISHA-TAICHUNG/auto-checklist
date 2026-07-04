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
  const docInfo = createChecklistDoc_(formType, ctx);
  try {
    return exportChecklistDocToPdf_(docInfo.docId);
  } finally {
    trashChecklistDoc_(docInfo.docId);
  }
}

function createChecklistDoc_(formType, ctx) {
  const isDaily = formType === 'daily';
  const isDigitalDailyConfirmation = isDaily && ctx && ctx.payload && ctx.payload.digitalConfirmation === true;
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

    if (isClassroomMonthlySafetyPpePdf_(formType, ctx)) {
      appendClassroomMonthlySafetyPpePdf_(body, ctx, rocDateStr, submittedAtStr);
      doc.saveAndClose();
      return { docId, docName };
    }

    // ----- 標題 -----
    // codex P2: 用 DB 模板的 templateName，未來新增機具不會錯
    const fallbackTitle = isDaily ? '每日作業前檢點表' : '每月定期檢查紀錄';
    const titleText = isDigitalDailyConfirmation
      ? '場地防護具每日線上確認紀錄'
      : ((ctx.template && ctx.template.templateName) || fallbackTitle);
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
    // A4 可用寬度 = 595pt - 2×36pt margin = 523pt
    // colWidths 總和不可超過 523，否則 DocumentApp 會自動壓縮造成「跑版」
    if (isDaily) {
      rows = isDigitalDailyConfirmation
        ? [['項次', '確認項目', '確認狀態', '同仁回覆 / 補充說明']]
        : [['項次', '檢查項目', '結果', '記事 / 異常說明']];
      colWidths = [30, 240, 55, 130];   // 共 455
      ctx.payload.items.forEach(it => {
        rows.push([String(it.order), it.name, it.result, it.note || '']);
      });
    } else {
      // 月檢按 monthlySchema 決定欄位
      const schema = (ctx.template && ctx.template.monthlySchema) || 'crane_full';
      if (schema === 'simple') {
        // 堆高機月檢樣式：項次/檢查部份/檢查方法/檢查結果/改善措施
        rows = [['項次', '檢查部份', '檢查方法', '檢查結果', '改善措施']];
        colWidths = [30, 160, 55, 90, 125];   // 共 460
        const hasSections = ctx.payload.items.some(it => getPdfItemSection_(it));
        let lastSection = '';
        ctx.payload.items.forEach(it => {
          const section = getPdfItemSection_(it);
          if (hasSections && section !== lastSection) {
            rows.push(['', section || '檢查項目', '', '', '']);
            lastSection = section;
          }
          rows.push([
            String(it.order),
            getPdfItemName_(it),
            it.method || (it.methods || []).join('/'),
            it.result || '',
            it.action || '',
          ]);
        });
      } else {
        // crane_full：固定式起重機月檢 7 欄
        rows = [['項次', '檢查部份', '檢查方法', '檢查結果', '風險評估', '改善措施', '定期檢討']];
        colWidths = [25, 120, 45, 90, 60, 60, 60];   // 共 460
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
      if (isDigitalDailyConfirmation) {
        ruleText = '確認方式：本紀錄為系統依場地使用情形指派同仁，並由指派同仁於 LINE 線上回覆確認後留存；內容表示指派同仁未回報防護具異常，非系統自動判定或現場逐項實測結果。';
        if (tplLegal) ruleText += '\n參考依據：' + tplLegal;
      } else {
        ruleText = '填寫規則：' + tplRule;
        if (tplLegal) ruleText += '\n依據：' + tplLegal;
      }
    } else {
      ruleText = isDigitalDailyConfirmation
        ? '確認方式：本紀錄為系統依場地使用情形指派同仁，並由指派同仁於 LINE 線上回覆確認後留存；內容表示指派同仁未回報防護具異常，非系統自動判定或現場逐項實測結果。'
        : isDaily
        ? '填寫規則：良好「V」/ 無此項「/」/ 不良「X」（不良需於記事欄註明）。\n依據「職業安全衛生管理辦法」第五十二條規定，發現異常應立即檢修或採取必要措施。'
        : '注意事項：檢查結果應詳細紀錄。風險評估：嚴重性危害「V」/ 可能性危害「?」/ 無危害「—」';
    }
    const ruleP = body.appendParagraph(ruleText);
    ruleP.editAsText().setFontSize(9).setForegroundColor('#555555');

    body.appendParagraph('');

    // ----- 簽名（圖 + 姓名）-----
    const sigLabel = body.appendParagraph(
      isDigitalDailyConfirmation ? '線上確認人員：' : (isDaily ? '檢點人員簽名：' : '檢查人員簽名：')
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
    if (!signatureInserted && ctx.payload.digitalConfirmation) {
      const confirmP = body.appendParagraph('確認方式：由指派同仁於 LINE 回覆確認，不使用手寫簽名；非系統自動判定。');
      confirmP.editAsText().setFontSize(10).setForegroundColor('#188038');
      if (ctx.payload.confirmedAt) {
        const timeP = body.appendParagraph('確認時間：' + formatDisplayDateTime_(ctx.payload.confirmedAt));
        timeP.editAsText().setFontSize(10).setForegroundColor('#555555');
      }
      if (ctx.payload.confirmationAssignmentId) {
        const idP = body.appendParagraph('確認編號：' + ctx.payload.confirmationAssignmentId);
        idP.editAsText().setFontSize(9).setForegroundColor('#777777');
      }
    } else if (!signatureInserted) {
      const noSig = body.appendParagraph('（無簽名）');
      noSig.editAsText().setFontSize(10).setForegroundColor('#c5221f');
    }

    const inspectorP = body.appendParagraph(ctx.payload.inspector || '');
    inspectorP.editAsText().setFontSize(11);

    // ----- 送出時間 -----
    body.appendParagraph('');
    const submitText = isDigitalDailyConfirmation
      ? '產製時間：' + submittedAtStr + '   本 PDF 由系統於同仁線上確認後產製'
      : '送出時間：' + submittedAtStr + '   系統自動產製';
    const submitP = body.appendParagraph(submitText);
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

      // 每張異常照片獨立一頁（避免項次與照片跨頁錯位）
      // 結構：每頁 = 異常照片附件 title（首頁）+ 第 N 項標題 + 異常說明 + 照片 + 計數
      let photoPageIdx = 0;
      itemsWithPhotos.forEach(it => {
        it.photos.forEach((p, pi) => {
          // 第 2 張起每張前面加 page break（第 1 張共用「異常照片附件」title 那一頁）
          if (photoPageIdx > 0) body.appendPageBreak();
          photoPageIdx++;

          // 項次 + 名稱
          const labelP = body.appendParagraph(`第 ${it.order} 項：${itemNameWithPdfSection_(it)}`);
          labelP.editAsText().setFontSize(12).setBold(true).setForegroundColor('#1a73e8');

          // 異常說明
          if (it.abnormalDesc || it.note) {
            const descP = body.appendParagraph('異常說明：' + (it.abnormalDesc || it.note));
            descP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
          }

          // 照片
          try {
            const photoBlob = dataUrlToBlob_(p, `item${it.order}_photo${pi + 1}.jpg`);
            if (photoBlob) {
              body.appendParagraph('');
              const photoImg = body.appendImage(photoBlob);
              // 限制寬度 480 + 高度 600（A4 可用高度 ~750，留空間給 heading/desc/caption）
              // 直拍照片若高度過高會被裁，這裡用「等比例縮放到較緊的那一邊」
              const maxW = 480, maxH = 600;
              const w = photoImg.getWidth(), h = photoImg.getHeight();
              if (w > maxW || h > maxH) {
                const scale = Math.min(maxW / w, maxH / h);
                photoImg.setWidth(Math.round(w * scale));
                photoImg.setHeight(Math.round(h * scale));
              }
              const cap = body.appendParagraph(`照片 ${pi + 1} / ${it.photos.length}`);
              cap.editAsText().setFontSize(9).setForegroundColor('#888888');
              cap.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
            } else {
              // dataUrlToBlob_ 回 null（dataURL 損壞）→ 至少給個 placeholder
              const errP = body.appendParagraph('（照片載入失敗，原始資料請查詢 DB 完整資料JSON）');
              errP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
            }
          } catch (e) {
            Logger.log(`第 ${it.order} 項照片 ${pi + 1} 嵌入失敗：` + e);
            const errP = body.appendParagraph('（照片嵌入時發生錯誤）');
            errP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
          }
        });
      });
    }

    doc.saveAndClose();
    return { docId, docName };

  } catch (err) {
    // 成功時交由呼叫端決定是否保留草稿；失敗才清暫時 Doc。
    try {
      DriveApp.getFileById(docId).setTrashed(true);
    } catch (e) {
      Logger.log('刪暫時 Doc 失敗：' + e);
    }
    throw err;
  }
}

function exportChecklistDocToPdf_(docId) {
  return DriveApp.getFileById(docId).getAs('application/pdf');
}

function trashChecklistDoc_(docId) {
  try {
    DriveApp.getFileById(docId).setTrashed(true);
  } catch (e) {
    Logger.log('刪暫時 Doc 失敗：' + e);
  }
}

function appendSupervisorApprovalToDoc_(docId, supervisorName, supervisorSignature, approvedAt) {
  const doc = DocumentApp.openById(docId);
  const body = doc.getBody();
  const approvedAtStr = Utilities.formatDate(approvedAt, tz_(), 'yyyy/MM/dd HH:mm');
  if (body.getText().indexOf('主管簽核時間：') >= 0) {
    doc.saveAndClose();
    return;
  }

  body.appendParagraph('');
  const label = body.appendParagraph('主管簽名：');
  label.editAsText().setFontSize(11).setBold(true);

  const sigBlob = dataUrlToBlob_(supervisorSignature, 'supervisor_sig.png');
  if (!sigBlob) throw new Error('主管簽名格式錯誤');
  const img = body.appendImage(sigBlob);
  const maxW = 260;
  if (img.getWidth() > maxW) {
    const ratio = img.getHeight() / img.getWidth();
    img.setWidth(maxW);
    img.setHeight(Math.round(maxW * ratio));
  }

  const nameP = body.appendParagraph(supervisorName || '');
  nameP.editAsText().setFontSize(11);

  const timeP = body.appendParagraph('主管簽核時間：' + approvedAtStr);
  timeP.editAsText().setFontSize(9).setForegroundColor('#888888');
  timeP.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  doc.saveAndClose();
}

function isClassroomMonthlySafetyPpePdf_(formType, ctx) {
  if (formType !== 'monthly' || !ctx || !ctx.equipment) return false;
  const id = String(ctx.equipment.equipmentId || '').trim().toUpperCase();
  return [
    'CLASSROOM-LJ-MEAS-PPE',
    'CLASSROOM-FX-MEAS-PPE',
    'CLASSROOM-ZM-MEAS-PPE',
  ].indexOf(id) >= 0;
}

function appendClassroomMonthlySafetyPpePdf_(body, ctx, rocDateStr, submittedAtStr) {
  const eq = ctx.equipment || {};
  const rocDateZh = `${rocDateStr.substring(0, 3)}年${rocDateStr.substring(3, 5)}月${rocDateStr.substring(5, 7)}日`;

  const orgP = body.appendParagraph(getOrgHeader_());
  orgP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  orgP.editAsText().setFontSize(12).setBold(true);

  const titleP = body.appendParagraph('置備之安全衛生量測設備及個人防護具每月檢核表');
  titleP.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  titleP.editAsText().setFontSize(15).setBold(true);

  body.appendParagraph('');

  const infoTable = body.appendTable([
    ['所在教室', eq.location || '', '檢查或校正日', rocDateZh],
  ]);
  styleClassroomMonthlyInfoTable_(infoTable);

  body.appendParagraph('');

  const regularItems = [];
  const scbaItems = [];
  (ctx.payload.items || []).forEach(it => {
    const section = getPdfItemSection_(it);
    if (section === 'SCBA 空氣呼吸器檢查') scbaItems.push(it);
    else regularItems.push(it);
  });

  const resultOptions = (ctx.template && ctx.template.resultOptions) || ['ˇ', 'X'];
  const regularRows = [[
    '序號',
    '量測設備或個人防護具名稱',
    '應備數量',
    '單位',
    '廠牌規格或型號',
    '檢核結果',
    '異常處理情形',
  ]];

  regularItems.forEach(it => {
    const parsed = parseMonthlySafetyPpeMethod_(getClassroomMonthlyMethodText_(it));
    regularRows.push([
      String(it.order || ''),
      getPdfItemName_(it),
      parsed.quantity,
      parsed.unit,
      parsed.spec,
      formatClassroomMonthlyResult_(it),
      formatClassroomMonthlyAction_(it),
    ]);
  });

  const regularTitle = body.appendParagraph('安全衛生量測設備及個人防護具');
  regularTitle.editAsText().setFontSize(11).setBold(true);
  const regularTable = body.appendTable(regularRows);
  styleClassroomMonthlyPpeTable_(regularTable, resultOptions);

  if (scbaItems.length > 0) {
    body.appendParagraph('');
    const scbaTitle = body.appendParagraph('SCBA 空氣呼吸器檢查');
    scbaTitle.editAsText().setFontSize(11).setBold(true);

    const scbaRows = [['項次', '檢查項目', '檢查方法', '檢查結果', '異常處理情形']];
    scbaItems.forEach(it => {
      scbaRows.push([
        String(it.order || ''),
        getPdfItemName_(it),
        getClassroomMonthlyMethodText_(it),
        it.result || '',
        formatClassroomMonthlyAction_(it),
      ]);
    });
    const scbaTable = body.appendTable(scbaRows);
    styleClassroomMonthlyScbaTable_(scbaTable, resultOptions);
  }

  body.appendParagraph('');
  const ruleText = (ctx.template && ctx.template.rule)
    ? '填寫規則：' + ctx.template.rule
    : '填寫規則：正常打「ˇ」/ 異常打「X」；異常需填寫說明與改善措施';
  const ruleP = body.appendParagraph(ruleText);
  ruleP.editAsText().setFontSize(9).setForegroundColor('#555555');

  body.appendParagraph('');
  const sigLabel = body.appendParagraph('檢查人員簽名：');
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

  body.appendParagraph('');
  const submitP = body.appendParagraph('送出時間：' + submittedAtStr + '   系統自動產製');
  submitP.editAsText().setFontSize(9).setForegroundColor('#888888');
  submitP.setAlignment(DocumentApp.HorizontalAlignment.RIGHT);

  appendPhotoAttachments_(body, ctx.payload.items || []);
}

function getClassroomMonthlyMethodText_(it) {
  return String((it && (it.method || (it.methods || [])[0])) || '').trim();
}

function parseMonthlySafetyPpeMethod_(methodText) {
  let text = String(methodText || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^數量\s*\/\s*外觀\s*\/\s*操作\s*[；;:：]?\s*/, '').trim();
  const parts = text.split(/[；;]/).map(s => s.trim()).filter(Boolean);
  let quantityUnit = '';
  let spec = text;
  if (parts.length > 0 && /^應備/.test(parts[0])) {
    quantityUnit = parts.shift();
    spec = parts.join('；').trim();
  }
  const m = quantityUnit.match(/^應備\s*([0-9０-９一二三四五六七八九十]+)\s*(.+)$/);
  return {
    quantity: m ? m[1] : '',
    unit: m ? m[2] : '',
    spec,
  };
}

function formatClassroomMonthlyResult_(it) {
  const fallback = String((it && it.result) || '').trim();
  const checks = (it && it.checkResults) || {};
  const quantity = String(checks.quantity || fallback || '').trim();
  const appearance = String(checks.appearance || fallback || '').trim();
  const operation = String(checks.operation || fallback || '').trim();
  return `數量：${quantity}\n外觀：${appearance}\n操作：${operation}`;
}

function formatClassroomMonthlyAction_(it) {
  const abnormalDesc = String((it && it.abnormalDesc) || '').trim();
  const action = String((it && it.action) || '').trim();
  if (abnormalDesc && action) return abnormalDesc + '\n' + action;
  return action || abnormalDesc || '';
}

function appendPhotoAttachments_(body, items) {
  const itemsWithPhotos = (items || []).filter(
    it => Array.isArray(it.photos) && it.photos.length > 0
  );
  if (itemsWithPhotos.length <= 0) return;

  body.appendPageBreak();
  const attachTitle = body.appendParagraph('異常照片附件');
  attachTitle.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  attachTitle.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  let photoPageIdx = 0;
  itemsWithPhotos.forEach(it => {
    it.photos.forEach((p, pi) => {
      if (photoPageIdx > 0) body.appendPageBreak();
      photoPageIdx++;

      const labelP = body.appendParagraph(`第 ${it.order} 項：${itemNameWithPdfSection_(it)}`);
      labelP.editAsText().setFontSize(12).setBold(true).setForegroundColor('#1a73e8');

      if (it.abnormalDesc || it.note) {
        const descP = body.appendParagraph('異常說明：' + (it.abnormalDesc || it.note));
        descP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
      }

      try {
        const photoBlob = dataUrlToBlob_(p, `item${it.order}_photo${pi + 1}.jpg`);
        if (photoBlob) {
          body.appendParagraph('');
          const photoImg = body.appendImage(photoBlob);
          const maxW = 480, maxH = 600;
          const w = photoImg.getWidth(), h = photoImg.getHeight();
          if (w > maxW || h > maxH) {
            const scale = Math.min(maxW / w, maxH / h);
            photoImg.setWidth(Math.round(w * scale));
            photoImg.setHeight(Math.round(h * scale));
          }
          const cap = body.appendParagraph(`照片 ${pi + 1} / ${it.photos.length}`);
          cap.editAsText().setFontSize(9).setForegroundColor('#888888');
          cap.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        } else {
          const errP = body.appendParagraph('（照片載入失敗，原始資料請查詢 DB 完整資料JSON）');
          errP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
        }
      } catch (e) {
        Logger.log(`第 ${it.order} 項照片 ${pi + 1} 嵌入失敗：` + e);
        const errP = body.appendParagraph('（照片嵌入時發生錯誤）');
        errP.editAsText().setFontSize(10).setForegroundColor('#c5221f');
      }
    });
  });
}

function getPdfItemSection_(it) {
  const explicit = String((it && it.section) || '').trim();
  if (explicit) return explicit;
  const rawName = String((it && it.name) || '');
  const match = rawName.match(/^【([^】]+)】\s*(.*)$/);
  return match ? match[1] : '';
}

function getPdfItemName_(it) {
  const rawName = String((it && it.name) || '');
  const match = rawName.match(/^【([^】]+)】\s*(.*)$/);
  return match ? (match[2] || rawName) : rawName;
}

function itemNameWithPdfSection_(it) {
  const section = getPdfItemSection_(it);
  const name = getPdfItemName_(it);
  if (!section || section === '安全衛生量測設備及個人防護具') return name;
  return `${section}：${name}`;
}

function styleClassroomMonthlyInfoTable_(table) {
  const row = table.getRow(0);
  for (let c = 0; c < row.getNumCells(); c++) {
    const cell = row.getCell(c);
    cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(8).setPaddingRight(8);
    const text = cell.editAsText();
    text.setFontSize(10);
    if (c === 0 || c === 2) {
      cell.setBackgroundColor('#f0f0f0');
      text.setBold(true);
      cell.setWidth(75);
    } else {
      cell.setWidth(c === 1 ? 165 : 190);
    }
  }
}

function styleClassroomMonthlyPpeTable_(table, resultOptions) {
  const widths = [25, 88, 38, 24, 135, 90, 105]; // total 505pt
  styleClassroomMonthlyGenericTable_(table, widths, resultOptions, 5);
}

function styleClassroomMonthlyScbaTable_(table, resultOptions) {
  const widths = [25, 220, 55, 70, 120]; // total 490pt
  styleClassroomMonthlyGenericTable_(table, widths, resultOptions, 3);
}

function styleClassroomMonthlyGenericTable_(table, widths, resultOptions, resultCol) {
  const HCenter = DocumentApp.HorizontalAlignment.CENTER;
  const opts = (resultOptions && resultOptions.length) ? resultOptions : ['ˇ', 'X'];
  const goodValue = opts[0];
  const badValue = opts[opts.length - 1];

  // 對齊「整個 cell 的所有段落」— 修正多行(數量/外觀/操作)只置中第一行造成的左右錯位
  const alignAllParagraphs = (cell, alignment) => {
    for (let i = 0; i < cell.getNumChildren(); i++) {
      const child = cell.getChild(i);
      if (child.getType() === DocumentApp.ElementType.PARAGRAPH) {
        try { child.asParagraph().setAlignment(alignment); } catch (_) {}
      }
    }
  };

  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      if (widths[c]) cell.setWidth(widths[c]);
      cell.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(4).setPaddingRight(4);
      const text = cell.editAsText();
      text.setFontSize(8);
      if (r === 0) {
        cell.setBackgroundColor('#e8eaed');
        text.setBold(true).setForegroundColor('#202124');
        alignAllParagraphs(cell, HCenter);
        continue;
      }
      if (c === 0 || c === 2 || c === 3 || c === resultCol) {
        alignAllParagraphs(cell, HCenter);
      }
      if (c === resultCol) {
        // 三指標逐行美化：ˇ/X 放大加粗、依結果各行上色，主管一眼可辨
        styleClassroomMonthlyResultCell_(cell, goodValue, badValue);
      }
    }
  }
}

/**
 * 教室月檢「檢核結果」儲存格符號美化
 *   - 把每個結果符號(ˇ/X)放大到 14pt 並加粗，解決主管看不清的問題
 *   - 良好(綠) / 不良(紅) 各自上色 — 單一指標不良時只有該符號紅，標籤(數量/外觀/操作：)不受影響
 *
 * codex P1 修正：原本以 Paragraph 為單位、從「：」套到段尾。但 DocumentApp 可能把
 * formatClassroomMonthlyResult_() 回傳的「數量：X\n外觀：ˇ\n操作：ˇ」放在「同一個」
 * Paragraph（\n 轉成 line-break），導致從第一個「：」一路套到整格尾端、後續行被一起放大染色。
 * 改為掃整格文字、只對每個 goodValue / badValue「字串本身」的精準 range 套樣式，
 * 不依賴三行是否被拆成多個 Paragraph，1 段或 3 段都正確。
 */
function styleClassroomMonthlyResultCell_(cell, goodValue, badValue) {
  const t = cell.editAsText();
  const full = t.getText();
  if (!full) return;
  // 只標符號本身（標籤「數量/外觀/操作：」不含 ˇ/X，不會被誤標）
  const paintAll = (token, color) => {
    if (!token) return;
    for (let idx = full.indexOf(token); idx >= 0; idx = full.indexOf(token, idx + token.length)) {
      const end = idx + token.length - 1;
      t.setFontSize(idx, end, 14).setBold(idx, end, true).setForegroundColor(idx, end, color);
    }
  };
  paintAll(goodValue, '#137333');
  paintAll(badValue, '#c5221f');
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
    const isSectionRow = !isDaily && r > 0 && row.getCell(0).editAsText().getText() === '';
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
      } else if (isSectionRow) {
        cell.setBackgroundColor('#e8f0fe');
        text.setForegroundColor('#174ea6').setBold(true);
        if (c !== 1) setCenter(cell);
      } else {
        if (c === 0) setCenter(cell);
        if (isDaily && c === 2) {
          const v = text.getText();
          setCenter(cell);
          if (v === badValue) text.setForegroundColor('#c5221f').setBold(true);
          else if (v === goodValue || v === '已確認') text.setForegroundColor('#137333').setBold(true);
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
