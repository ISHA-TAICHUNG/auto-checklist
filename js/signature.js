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

    /** 把外部 dataURL 載入到此 canvas（用於從全螢幕回填）*/
    loadFromDataURL(dataUrl) {
      if (!dataUrl) return;
      const rect = this.canvas.getBoundingClientRect();
      const img = new Image();
      img.onload = () => {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0, rect.width, rect.height);
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
    const title = document.createElement('span');
    title.textContent = '✍ 全螢幕簽名（建議手機橫向）';
    const closeX = document.createElement('span');
    closeX.textContent = '✕ 取消';
    closeX.style.cursor = 'pointer';
    closeX.style.fontSize = '15px';
    closeX.onclick = () => cleanup();
    header.appendChild(title);
    header.appendChild(closeX);

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
    doneBtn.textContent = '完成';
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

    doneBtn.onclick = () => {
      if (fullPad && !fullPad.isEmpty()) {
        mainPad.loadFromDataURL(fullPad.toDataURL());
      }
      cleanup();
    };

    function cleanup() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.body.style.overflow = prevOverflow;
    }
  }

  window.SignaturePad = SignaturePad;
  window.openFullscreenSignature = openFullscreenSignature;
})();
