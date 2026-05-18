/**
 * ===== 簽名 canvas =====
 * 支援滑鼠與觸控（平板、手機）
 *
 * 用法：
 *   const pad = new SignaturePad(canvasElement);
 *   pad.clear();
 *   pad.isEmpty();
 *   pad.toDataURL();   // 'data:image/png;base64,...'
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
      // 處理 hidpi：canvas backing store 比 CSS 像素大
      const ratio = window.devicePixelRatio || 1;
      const rect = this.canvas.getBoundingClientRect();
      // 暫存目前畫面，resize 後重畫
      const prev = this.hasInk ? this.canvas.toDataURL() : null;
      this.canvas.width = rect.width * ratio;
      this.canvas.height = rect.height * ratio;
      this.ctx.scale(ratio, ratio);
      this.ctx.lineWidth = 2;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      this.ctx.strokeStyle = '#222';
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

    toDataURL() {
      return this.hasInk ? this.canvas.toDataURL('image/png') : '';
    }
  }

  window.SignaturePad = SignaturePad;
})();
