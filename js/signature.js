/**
 * ===== 簽名 canvas =====
 * 支援滑鼠與觸控（平板、手機）
 *
 * 用法：
 *   const pad = new SignaturePad(canvasElement);
 *   pad.clear();
 *   pad.isEmpty();
 *   pad.toDataURL();   // 'data:image/png;base64,...'
 *
 * 全螢幕簽名（橫向友善，給老花使用）：
 *   openFullscreenSignature(mainSigPad)
 *     → 開全螢幕 overlay，含大 canvas + 「請橫向使用」提示
 *     → 簽完點完成，內容回填到 mainSigPad
 */
(function () {
  class SignaturePad {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.isDrawing = false;
      this.hasInk = false;
      this._resize();
      this._bind();
      window.addEventListener('resize', () => this._resize());
    }

    _resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      const prev = this.hasInk ? this.canvas.toDataURL() : null;
      this.canvas.width = rect.width * ratio;
      this.canvas.height = rect.height * ratio;
      this.ctx.scale(ratio, ratio);
      this.ctx.lineWidth = 2.5;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = '#111';
      if (prev) {
        const img = new Image();
        img.onload = () => this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
        img.src = prev;
      }
    }

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      if (e.touches && e.touches[0]) {
        return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      }
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _start(e) {
      e.preventDefault();
      this.isDrawing = true;
      this.hasInk = true;
      const p = this._pos(e);
      this.ctx.beginPath();
      this.ctx.moveTo(p.x, p.y);
    }
    _move(e) {
      if (!this.isDrawing) return;
      e.preventDefault();
      const p = this._pos(e);
      this.ctx.lineTo(p.x, p.y);
      this.ctx.stroke();
    }
    _end(e) {
      if (!this.isDrawing) return;
      e.preventDefault();
      this.isDrawing = false;
      this.ctx.closePath();
    }

    _bind() {
      this.canvas.addEventListener('mousedown', e => this._start(e));
      this.canvas.addEventListener('mousemove', e => this._move(e));
      this.canvas.addEventListener('mouseup', e => this._end(e));
      this.canvas.addEventListener('mouseleave', e => this._end(e));
      this.canvas.addEventListener('touchstart', e => this._start(e), { passive: false });
      this.canvas.addEventListener('touchmove', e => this._move(e), { passive: false });
      this.canvas.addEventListener('touchend', e => this._end(e), { passive: false });
    }

    clear() {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.hasInk = false;
    }
    isEmpty() { return !this.hasInk; }
    toDataURL() { return this.hasInk ? this.canvas.toDataURL('image/png') : ''; }

    /** 把外部 dataURL 載入到此 canvas（用於從全螢幕回填）
     *  等比例縮放 + 置中（避免變形或集中左上）*/
    loadFromDataURL(dataUrl) {
      if (!dataUrl) return;
      const rect = this.canvas.getBoundingClientRect();
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        // 算等比例 fit
        const imgRatio = img.width / img.height;
        const canvasRatio = rect.width / rect.height;
        let dw, dh, dx, dy;
        if (imgRatio > canvasRatio) {
          // image 比 canvas 寬：fit width
          dw = rect.width;
          dh = rect.width / imgRatio;
        } else {
          dh = rect.height;
          dw = rect.height * imgRatio;
        }
        dx = (rect.width - dw) / 2;
        dy = (rect.height - dh) / 2;
        this.ctx.drawImage(img, dx, dy, dw, dh);
        this.hasInk = true;
      };
      img.src = dataUrl;
    }
  }

  /**
   * 開啟全螢幕簽名 overlay
   * @param {SignaturePad} mainPad - 主 canvas pad，完成後內容回填到這
   */
  function openFullscreenSignature(mainPad) {
    const overlay = document.createElement('div');
    overlay.className = 'sig-overlay show';

    const header = document.createElement('div');
    header.className = 'sig-overlay-header';

    const cancelLink = document.createElement('span');
    cancelLink.textContent = '✕ 取消';
    cancelLink.style.cursor = 'pointer';
    cancelLink.style.padding = '6px 10px';
    cancelLink.style.fontSize = '16px';
    cancelLink.onclick = () => cleanup();

    const title = document.createElement('span');
    title.textContent = '簽名';

    const doneTopBtn = document.createElement('span');
    doneTopBtn.textContent = '✓ 完成';
    doneTopBtn.style.cursor = 'pointer';
    doneTopBtn.style.padding = '8px 14px';
    doneTopBtn.style.background = '#fff';
    doneTopBtn.style.color = '#1a73e8';
    doneTopBtn.style.borderRadius = '6px';
    doneTopBtn.style.fontSize = '16px';
    doneTopBtn.style.fontWeight = '700';

    header.appendChild(cancelLink);
    header.appendChild(title);
    header.appendChild(doneTopBtn);

    const wrap = document.createElement('div');
    wrap.className = 'sig-overlay-canvas-wrap';
    const fullCanvas = document.createElement('canvas');
    wrap.appendChild(fullCanvas);

    // 旋轉提示（portrait 時顯示，landscape 時 CSS 隱藏）
    const hint = document.createElement('div');
    hint.className = 'sig-overlay-rotate-hint';
    const hintLine1 = document.createElement('div');
    hintLine1.textContent = '請將手機橫向旋轉';
    const hintLine2 = document.createElement('div');
    hintLine2.textContent = '以獲得更大的簽名空間';
    hintLine2.style.marginTop = '6px';
    hint.appendChild(hintLine1);
    hint.appendChild(hintLine2);
    wrap.appendChild(hint);

    const footer = document.createElement('div');
    footer.className = 'sig-overlay-footer';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn-danger';
    clearBtn.textContent = '清除重簽';
    const doneBtn = document.createElement('button');
    doneBtn.className = 'btn-primary';
    doneBtn.textContent = '✓ 完成';
    footer.appendChild(clearBtn);
    footer.appendChild(doneBtn);

    overlay.appendChild(header);
    overlay.appendChild(wrap);
    overlay.appendChild(footer);
    document.body.appendChild(overlay);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    let fullPad;
    setTimeout(() => {
      fullPad = new SignaturePad(fullCanvas);
      if (!mainPad.isEmpty()) {
        fullPad.loadFromDataURL(mainPad.toDataURL());
      }
    }, 50);

    clearBtn.onclick = () => fullPad && fullPad.clear();

    const onDone = () => {
      if (fullPad && !fullPad.isEmpty()) {
        mainPad.loadFromDataURL(fullPad.toDataURL());
      }
      cleanup();
    };
    doneBtn.onclick = onDone;
    doneTopBtn.onclick = onDone;

    function cleanup() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
    }
  }

  window.SignaturePad = SignaturePad;
  window.openFullscreenSignature = openFullscreenSignature;
})();
