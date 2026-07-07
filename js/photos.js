/**
 * ===== 異常照片上傳 component =====
 *
 * 用法：
 *   const wrap = document.createElement('div');
 *   const pm = new PhotoManager(wrap, { max: 4 });
 *   // 送出時取 base64 陣列：
 *   const photos = pm.toDataURLs();  // ['data:image/jpeg;base64,...', ...]
 *
 * 設計：
 *   - 拍照（手機相機）或選圖
 *   - 自動壓縮到最大邊 1280px、JPEG quality 0.7（控制單張 < 600KB）
 *   - 縮圖預覽 + 刪除按鈕
 *   - 限制張數（預設 4 張）
 */
(function () {
  class PhotoManager {
    constructor(container, opts) {
      this.container = container;
      this.max = (opts && opts.max) || 4;
      this.photos = [];                                    // [{ dataURL, thumbEl }]
      this._buildUI();
    }

    _buildUI() {
      this.container.classList.add('photo-manager');

      const actions = document.createElement('div');
      actions.className = 'photo-actions';
      this.cameraBtn = this._createPicker('📷 拍照', true, false);
      this.uploadBtn = this._createPicker('🖼️ 上傳照片', false, true);
      actions.appendChild(this.cameraBtn);
      actions.appendChild(this.uploadBtn);
      this.container.appendChild(actions);
      this.addButtons = [this.cameraBtn, this.uploadBtn];

      const grid = document.createElement('div');
      grid.className = 'photo-grid';
      this.container.appendChild(grid);
      this.grid = grid;
    }

    _createPicker(labelText, useCamera, multiple) {
      const btn = document.createElement('label');
      btn.className = 'photo-add-btn';
      btn.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      if (useCamera) input.capture = 'environment';
      input.multiple = !!multiple;
      input.style.display = 'none';
      input.onchange = (e) => {
        this._onFile(e.target.files);
        e.target.value = '';
      };
      btn.appendChild(input);
      return btn;
    }

    async _onFile(files) {
      if (!files || !files.length) return;
      for (const file of files) {
        if (this.photos.length >= this.max) {
          alert('最多 ' + this.max + ' 張');
          break;
        }
        try {
          const dataURL = await compressImage_(file, 1280, 0.7);
          this._addThumb(dataURL);
        } catch (err) {
          alert('讀取照片失敗：' + err.message);
        }
      }
      this._refreshAddBtnState();
    }

    _addThumb(dataURL) {
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      const img = document.createElement('img');
      img.src = dataURL;
      img.className = 'photo-thumb';
      cell.appendChild(img);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'photo-del';
      del.textContent = '✕';
      del.onclick = () => {
        this.photos = this.photos.filter(p => p.thumbEl !== cell);
        cell.remove();
        this._refreshAddBtnState();
      };
      cell.appendChild(del);
      this.grid.appendChild(cell);
      this.photos.push({ dataURL, thumbEl: cell });
    }

    _refreshAddBtnState() {
      const hidden = this.photos.length >= this.max;
      (this.addButtons || []).forEach(btn => { btn.style.display = hidden ? 'none' : ''; });
    }

    toDataURLs() {
      return this.photos.map(p => p.dataURL);
    }

    isEmpty() { return this.photos.length === 0; }
  }

  /** 壓縮圖片：最大邊 maxDim、JPEG quality */
  function compressImage_(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = h * (maxDim / w); w = maxDim; }
          else if (h >= w && h > maxDim) { w = w * (maxDim / h); h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(w);
          canvas.height = Math.round(h);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataURL = canvas.toDataURL('image/jpeg', quality);
          resolve(dataURL);
        };
        img.onerror = () => reject(new Error('image load error'));
        img.src = reader.result;
      };
      reader.onerror = () => reject(new Error('file read error'));
      reader.readAsDataURL(file);
    });
  }

  window.PhotoManager = PhotoManager;
})();
