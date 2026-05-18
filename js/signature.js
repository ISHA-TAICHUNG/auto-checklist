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
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.isDrawing = false;
      this.hasInk = false;
      this._hintEl = (opts && opts.hintElement) || null;
      this._resize();
      this._bind();
      this._updateOrientationHint();
      window.addEventListener('resize', () => {
        this._resize();
        this._updateOrientationHint();
      });
      window.addEventListener('orientationchange', () => this._updateOrientationHint());
    }

    _updateOrientationHint() {
      if (!this._hintEl) return;
      const landscape = window.innerWidth > window.innerHeight;
      this._hintEl.textContent = landscape
        ? '✓ 已橫向 — 簽名空間最大化，直接簽即可'
        : '💡 可將手機橫向旋轉以獲得更大的簽名空間';
    }

    _resize() {
      const ratio = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      // 只在 portrait/landscape 之間切換時保留筆跡（用 trim 後置中）
      const prev = this.hasInk ? this.trimmedDataURL() : null;
      this.canvas.width = rect.width * ratio;
      this.canvas.height = rect.height * ratio;
      this.ctx.scale(ratio, ratio);
      this.ctx.lineWidth = 2.5;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = '#111';
      if (prev) {
        // 等比例置中重畫（避免橫向→直向或反向時變形）
        const img = new Image();
        img.onload = () => {
          const imgRatio = img.width / img.height;
          const cR = rect.width / rect.height;
          let dw, dh;
          if (imgRatio > cR) { dw = rect.width; dh = rect.width / imgRatio; }
          else { dh = rect.height; dw = rect.height * imgRatio; }
          const dx = (rect.width - dw) / 2;
          const dy = (rect.height - dh) / 2;
          this.ctx.drawImage(img, dx, dy, dw, dh);
        };
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

    /** 回傳「裁切空白」後的 dataURL — 只保留筆跡 bbox + 10px padding
     *  解決：全螢幕簽名後筆跡只佔小區，整張圖含大量留白導致回填不置中、PDF 變小 */
    trimmedDataURL() {
      if (!this.hasInk) return '';
      const w = this.canvas.width;
      const h = this.canvas.height;
      const pixels = this.ctx.getImageData(0, 0, w, h).data;
      let minX = w, minY = h, maxX = -1, maxY = -1;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (pixels[(y * w + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < 0) return this.canvas.toDataURL('image/png');
      const pad = 16;
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(w, maxX + pad);
      maxY = Math.min(h, maxY + pad);
      const tw = maxX - minX, th = maxY - minY;
      const tmp = document.createElement('canvas');
      tmp.width = tw;
      tmp.height = th;
      tmp.getContext('2d').drawImage(this.canvas, minX, minY, tw, th, 0, 0, tw, th);
      return tmp.toDataURL('image/png');
    }

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

  window.SignaturePad = SignaturePad;
})();
