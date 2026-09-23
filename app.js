// ============================================================
//  EBRO Form Extractor - Application Logic
//  Depends on: config.js (must be loaded first)
// ============================================================

// ---- DOM references ----
const autoProcessToggle = document.getElementById('autoProcessToggle');
const autoProcessToggleLocal = document.getElementById('autoProcessToggleLocal');
const platformSelect = document.getElementById('platformSelect');
const apiKeyInput = document.getElementById('apiKey');
const apiKeyBadge = document.getElementById('apiKeyBadge');
const platformHint = document.getElementById('platformHint');
const apiKeyHint = document.getElementById('apiKeyHint');
const balancePanel = document.getElementById('balancePanel');
const balanceContent = document.getElementById('balanceContent');
const refreshBalanceBtn = document.getElementById('refreshBalanceBtn');
const maxSizeInput = document.getElementById('maxSize');
const uploadArea = document.getElementById('uploadArea');
const fileInput = document.getElementById('fileInput');
const extractBtn = document.getElementById('extractBtn');
const retryAllBtn = document.getElementById('retryAllBtn');
const clearBtn = document.getElementById('clearBtn');
const statusEl = document.getElementById('status');
const queueList = document.getElementById('queueList');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const summaryEl = document.getElementById('summary');
const resultSection = document.getElementById('resultSection');
const issuesBanner = document.getElementById('issuesBanner');
const resultTable = document.getElementById('resultTable');
const downloadExcelBtn = document.getElementById('downloadExcelBtn');
const geminiModelRow = document.getElementById('geminiModelRow');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const geminiModelHint = document.getElementById('geminiModelHint');
const errorSummary = document.getElementById('errorSummary');
const rotateLeftBtn = document.getElementById('rotateLeftBtn');
const rotateRightBtn = document.getElementById('rotateRightBtn');
const rateLimitsPanel = document.getElementById('rateLimitsPanel');
const limitRPM = document.getElementById('limitRPM');
const limitTPM = document.getElementById('limitTPM');
const limitRPD = document.getElementById('limitRPD');
const resetRateLimitsBtn = document.getElementById('resetRateLimitsBtn');
const rateLimitsHint = document.getElementById('rateLimitsHint');

// Local mode elements
const imsFolderBtn = document.getElementById('imsFolderBtn');
const imsUploadBtn = document.getElementById('imsUploadBtn');
const uploadPanel = document.getElementById('uploadPanel');
const localModePanel = document.getElementById('localModePanel');
const localStatus = document.getElementById('localStatus');
const localInputLabel = document.getElementById('localInputLabel');
const localReadedLabel = document.getElementById('localReadedLabel');
const localErrorLabel = document.getElementById('localErrorLabel');
const localPickInputBtn = document.getElementById('localPickInputBtn');
const localPickReadedBtn = document.getElementById('localPickReadedBtn');
const localPickErrorBtn = document.getElementById('localPickErrorBtn');
const localLoadBtn = document.getElementById('localLoadBtn');
const localProcessBtn = document.getElementById('localProcessBtn');
const errorPanel = document.getElementById('errorPanel');
const errorList = document.getElementById('errorList');
const errorCount = document.getElementById('errorCount');
const downloadErrorListBtn = document.getElementById('downloadErrorListBtn');

// Scrap submission elements
const downloadTemplateBtn = document.getElementById('downloadTemplateBtn');
const uploadScrapBtn = document.getElementById('uploadScrapBtn');
const scrapFileInput = document.getElementById('scrapFileInput');
const exportFilteredScrapBtn = document.getElementById('exportFilteredScrapBtn');
const clearScrapBtn = document.getElementById('clearScrapBtn');
const scrapPanel = document.getElementById('scrapPanel');
const scrapTable = document.getElementById('scrapTable');
const scrapStatus = document.getElementById('scrapStatus');

// Filter bars
const queueFilterBar = document.getElementById('queueFilterBar');
const errorFilterBar = document.getElementById('errorFilterBar');
const resultFilterBar = document.getElementById('resultFilterBar');
const scrapFilterBar = document.getElementById('scrapFilterBar');

// Modal
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalFileLabel = document.getElementById('modalFileLabel');
const modalImage = document.getElementById('modalImage');
const modalFields = document.getElementById('modalFields');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalSaveBtn = document.getElementById('modalSaveBtn');
const modalResetBtn = document.getElementById('modalResetBtn');
const imageScroll = document.getElementById('imageScroll');
const imageRotator = document.getElementById('imageRotator');
const zoomLabel = document.getElementById('zoomLabel');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomFitBtn = document.getElementById('zoomFitBtn');
const zoomFitHBtn = document.getElementById('zoomFitHBtn');

// ---- State ----
let autoProcessEnabled = true;
let queue = [];
let isRunning = false;
let idCounter = 0;
let editingTaskId = null;
let editingDraft = null;
let localHandles = { input: null, readed: null, error: null };
let inputMethod = 'folder';
let modalRotation = 0;
let _producerActive = false;
let _consumerRunning = false;
let wakeLock = null;

const zoomState = { scale: 1, naturalW: 0, naturalH: 0, fitMode: null };

// Filter states (loaded at init, but declared here)
let queueFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
let errorFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
let resultFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };

// Scrap submission state
const SCRAP_TEMPLATE_COLUMNS = [
  'material_code',
  'quantity',
  'area',
  'location',
  'impact_type',
  'comments',
  'date'
];
let scrapRows = [];
let scrapFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };

// ============================================================
//  Bootstrap
// ============================================================
(async function init() {
  const supportsFS = typeof window.showDirectoryPicker === 'function';
  if (!supportsFS) {
    imsFolderBtn.disabled = true;
    imsFolderBtn.title = 'Your browser does not support the File System Access API. Use Chrome, Edge, or Opera.';
  }

  const savedMethod = localStorage.getItem(INPUT_METHOD_STORAGE);
  if (savedMethod === 'folder' || savedMethod === 'upload') {
    inputMethod = savedMethod;
  } else {
    inputMethod = supportsFS ? 'folder' : 'upload';
  }
  applyInputMethod(inputMethod);

  await restoreLocalHandles();

  const savedPlatform = localStorage.getItem(PLATFORM_STORAGE);
  if (savedPlatform && PLATFORMS[savedPlatform]) {
    platformSelect.value = savedPlatform;
  }
  updatePlatformUI();

  const savedMaxSize = localStorage.getItem(MAX_SIZE_STORAGE);
  if (savedMaxSize) maxSizeInput.value = savedMaxSize;

  // Restore filter states
  queueFilters = loadFilterState('queue', queueFilters);
  errorFilters = loadFilterState('errors', errorFilters);
  resultFilters = loadFilterState('results', resultFilters);
  scrapFilters = loadFilterState('scrap', scrapFilters);

  attachEventListeners();
})();

function attachEventListeners() {
  if (autoProcessToggle) {
    autoProcessToggle.addEventListener('change', () => {
      autoProcessEnabled = autoProcessToggle.checked;
      if (autoProcessToggleLocal) autoProcessToggleLocal.checked = autoProcessEnabled;
    });
  }
  if (autoProcessToggleLocal) {
    autoProcessToggleLocal.addEventListener('change', () => {
      autoProcessEnabled = autoProcessToggleLocal.checked;
      if (autoProcessToggle) autoProcessToggle.checked = autoProcessEnabled;
    });
  }

  platformSelect.addEventListener('change', () => {
    localStorage.setItem(PLATFORM_STORAGE, platformSelect.value);
    updatePlatformUI();
  });

  geminiModelSelect.addEventListener('change', () => {
    localStorage.setItem(GEMINI_MODEL_STORAGE, geminiModelSelect.value);
    updateGeminiModelHint();
    updatePlatformUI();
  });

  apiKeyInput.addEventListener('input', () => {
    const platform = getCurrentPlatform();
    localStorage.setItem(getKeyStorageKey(platform), apiKeyInput.value.trim());
    updateButtonState();

    if (platform === 'deepseek' && apiKeyInput.value.trim()) {
      clearTimeout(window._balanceTimer);
      window._balanceTimer = setTimeout(fetchDeepSeekBalance, 800);
    }
  });

  refreshBalanceBtn.addEventListener('click', fetchDeepSeekBalance);

  if (limitRPM) limitRPM.addEventListener('change', onRateLimitChanged);
  if (limitTPM) limitTPM.addEventListener('change', onRateLimitChanged);
  if (limitRPD) limitRPD.addEventListener('change', onRateLimitChanged);
  if (resetRateLimitsBtn) resetRateLimitsBtn.addEventListener('click', onResetRateLimits);

  maxSizeInput.addEventListener('input', () => {
    localStorage.setItem(MAX_SIZE_STORAGE, maxSizeInput.value);
  });

  // Upload
  uploadArea.addEventListener('click', () => fileInput.click());
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.classList.add('dragover');
  });
  uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.classList.remove('dragover');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length) {
      addFiles(e.target.files);
      fileInput.value = '';
    }
  });

  // Buttons
  extractBtn.addEventListener('click', onExtractClick);
  retryAllBtn.addEventListener('click', onRetryAllClick);
  clearBtn.addEventListener('click', onClearClick);
  downloadExcelBtn.addEventListener('click', onDownloadExcel);

  if (downloadErrorListBtn) {
    downloadErrorListBtn.addEventListener('click', onDownloadErrorList);
  }

  // Scrap submission
  if (downloadTemplateBtn) downloadTemplateBtn.addEventListener('click', downloadScrapTemplate);
  if (uploadScrapBtn) uploadScrapBtn.addEventListener('click', () => scrapFileInput.click());
  if (scrapFileInput) {
    scrapFileInput.addEventListener('change', (e) => {
      if (e.target.files.length) {
        handleScrapUpload(e.target.files[0]);
        scrapFileInput.value = '';
      }
    });
  }
  if (exportFilteredScrapBtn) exportFilteredScrapBtn.addEventListener('click', exportFilteredScrap);
  if (clearScrapBtn) clearScrapBtn.addEventListener('click', clearScrap);

  // Zoom
  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  zoomResetBtn.addEventListener('click', zoomReset);
  rotateLeftBtn.addEventListener('click', () => rotateModalImage(-90));
  rotateRightBtn.addEventListener('click', () => rotateModalImage(90));
  zoomFitBtn.addEventListener('click', zoomFitWidth);
  zoomFitHBtn.addEventListener('click', zoomFitHeight);

  imageScroll.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (-e.deltaY > 0) zoomIn(); else zoomOut();
    }
  }, { passive: false });

  // Drag to pan
  let isPanning = false, panStartX = 0, panStartY = 0, panScrollLeft = 0, panScrollTop = 0;
  modalImage.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX; panStartY = e.clientY;
    panScrollLeft = imageScroll.scrollLeft; panScrollTop = imageScroll.scrollTop;
    modalImage.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    imageScroll.scrollLeft = panScrollLeft - (e.clientX - panStartX);
    imageScroll.scrollTop = panScrollTop - (e.clientY - panStartY);
  });
  document.addEventListener('mouseup', () => {
    if (isPanning) { isPanning = false; modalImage.classList.remove('dragging'); }
  });

  // Modal buttons
  modalSaveBtn.addEventListener('click', onModalSave);
  modalResetBtn.addEventListener('click', onModalReset);
  modalCloseBtn.addEventListener('click', closeEditModal);
  modalCancelBtn.addEventListener('click', closeEditModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeEditModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeEditModal();
  });

  // Input method selector
  imsFolderBtn.addEventListener('click', () => switchInputMethod('folder'));
  imsUploadBtn.addEventListener('click', () => switchInputMethod('upload'));

  // Local folder mode
  if (typeof window.showDirectoryPicker === 'function') {
    localPickInputBtn.addEventListener('click', () => pickLocalFolder('input'));
    localPickReadedBtn.addEventListener('click', () => pickLocalFolder('readed'));
    localPickErrorBtn.addEventListener('click', () => pickLocalFolder('error'));
    localLoadBtn.addEventListener('click', loadLocalFiles);
    localProcessBtn.addEventListener('click', processLocalBatch);
  }
}

// ============================================================
//  Platform / API key / Balance
// ============================================================
function getCurrentPlatform() { return platformSelect.value; }
function getKeyStorageKey(platform) { return API_KEY_STORAGE_PREFIX + platform; }

function getCurrentGeminiModel() {
  const stored = localStorage.getItem(GEMINI_MODEL_STORAGE);
  const models = PLATFORMS.gemini.models || [];
  if (stored && models.some(m => m.id === stored)) return stored;
  return PLATFORMS.gemini.defaultModel;
}

function buildGeminiModelDropdown() {
  const models = PLATFORMS.gemini.models || [];
  geminiModelSelect.innerHTML = '';
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    geminiModelSelect.appendChild(opt);
  });
  geminiModelSelect.value = getCurrentGeminiModel();
  updateGeminiModelHint();
}

function updateGeminiModelHint() {
  const selected = geminiModelSelect.value;
  const model = (PLATFORMS.gemini.models || []).find(m => m.id === selected);
  geminiModelHint.textContent = model ? model.note : '';
}

function updatePlatformUI() {
  const platform = getCurrentPlatform();
  const cfg = PLATFORMS[platform];
  apiKeyBadge.textContent = cfg.name;
  apiKeyBadge.className = `platform-badge ${cfg.badgeClass}`;
  apiKeyInput.placeholder = cfg.placeholder;
  apiKeyHint.innerHTML = cfg.keyHint;
  platformHint.textContent = `Model: ${platform === 'gemini' ? getCurrentGeminiModel() : cfg.defaultModel}`;

  balancePanel.style.display = (platform === 'deepseek') ? 'block' : 'none';

  if (platform === 'gemini') {
    geminiModelRow.style.display = 'flex';
    buildGeminiModelDropdown();
  } else {
    geminiModelRow.style.display = 'none';
  }

  const stored = localStorage.getItem(getKeyStorageKey(platform));
  apiKeyInput.value = stored || '';
  updateButtonState();

  if (platform === 'deepseek' && stored) {
    fetchDeepSeekBalance();
  } else if (platform === 'deepseek') {
    balanceContent.innerHTML = 'Enter your API Key to check balance.';
  }

  renderRateLimitsPanel();
}

async function fetchDeepSeekBalance() {
  if (getCurrentPlatform() !== 'deepseek') return;
  const apiKey = localStorage.getItem(getKeyStorageKey('deepseek'));
  if (!apiKey) {
    balanceContent.innerHTML = '<span style="color: #999;">Please enter your DeepSeek API Key first.</span>';
    return;
  }
  refreshBalanceBtn.disabled = true;
  balanceContent.innerHTML = '<span style="color: #1976d2;">Loading balance...</span>';
  try {
    const response = await fetch('https://api.deepseek.com/user/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    renderDeepSeekBalance(data);
  } catch (err) {
    console.error('Balance fetch error:', err);
    balanceContent.innerHTML =
      `<span style="color: #d32f2f;">Failed to fetch balance: ${escapeHtml(err.message)}</span>`;
  } finally {
    refreshBalanceBtn.disabled = false;
  }
}

function renderDeepSeekBalance(data) {
  if (!data.is_available) {
    balanceContent.innerHTML = '<span style="color: #d32f2f;">⚠️ Balance insufficient for API calls. Please top up.</span>';
    return;
  }
  if (!data.balance_infos || !data.balance_infos.length) {
    balanceContent.innerHTML = '<span style="color: #999;">No balance information available.</span>';
    return;
  }
  const usd = data.balance_infos.find(b => b.currency === 'USD');
  const cny = data.balance_infos.find(b => b.currency === 'CNY');
  const info = usd || cny;
  const symbol = usd ? '$' : '¥';

  balanceContent.innerHTML = `
    <div class="balance-row"><span class="label">Total Balance:</span><span class="value">${symbol}${info.total_balance}</span></div>
    <div class="balance-row sub"><span class="label">Granted (promo):</span><span class="value">${symbol}${info.granted_balance}</span></div>
    <div class="balance-row sub"><span class="label">Topped-up (paid):</span><span class="value">${symbol}${info.topped_up_balance}</span></div>
    <div class="balance-row sub" style="margin-top: 6px; border-top: 1px solid #d4e8dc; padding-top: 6px;">
      <span class="label">Status:</span><span class="value" style="color: #0f5132;">✓ Available</span>
    </div>`;
}

// ============================================================
//  Rate Limits
// ============================================================
function loadRateLimitsOverride() {
  try {
    const raw = localStorage.getItem(RATE_LIMITS_OVERRIDE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

function saveRateLimitsOverride(obj) {
  try { localStorage.setItem(RATE_LIMITS_OVERRIDE_KEY, JSON.stringify(obj)); }
  catch (e) { console.warn('Failed to save rate limits override:', e); }
}

function getEffectiveLimits() {
  const modelId = getCurrentGeminiModel();
  const model = (PLATFORMS.gemini.models || []).find(m => m.id === modelId);
  const defaults = (model && model.limits) ? model.limits : { rpm: 15, tpm: 1000000, rpd: 1500 };
  const overrides = loadRateLimitsOverride();
  const o = overrides[modelId] || {};
  return {
    rpm: o.rpm || defaults.rpm,
    tpm: o.tpm || defaults.tpm,
    rpd: o.rpd || defaults.rpd,
    defaults
  };
}

function renderRateLimitsPanel() {
  if (!rateLimitsPanel) return;
  const platform = getCurrentPlatform();
  if (platform !== 'gemini') {
    rateLimitsPanel.style.display = 'none';
    return;
  }
  rateLimitsPanel.style.display = 'block';
  const { rpm, tpm, rpd, defaults } = getEffectiveLimits();
  limitRPM.value = rpm;
  limitTPM.value = tpm;
  limitRPD.value = rpd;
  const overridden = (rpm !== defaults.rpm) || (tpm !== defaults.tpm) || (rpd !== defaults.rpd);
  rateLimitsHint.textContent = overridden
    ? `⚠️ Custom limits in use. Model defaults: ${defaults.rpm} RPM / ${defaults.tpm.toLocaleString()} TPM / ${defaults.rpd} RPD.`
    : `These limits are enforced locally to prevent API errors. Raise them if you upgrade your tier.`;
}

function onRateLimitChanged() {
  const modelId = getCurrentGeminiModel();
  const overrides = loadRateLimitsOverride();
  overrides[modelId] = {
    rpm: parseInt(limitRPM.value, 10) || null,
    tpm: parseInt(limitTPM.value, 10) || null,
    rpd: parseInt(limitRPD.value, 10) || null
  };
  saveRateLimitsOverride(overrides);
  renderRateLimitsPanel();
  if (typeof smartRateLimiter !== 'undefined' && smartRateLimiter.reset) {
    smartRateLimiter.reset();
  }
}

function onResetRateLimits() {
  const modelId = getCurrentGeminiModel();
  const overrides = loadRateLimitsOverride();
  delete overrides[modelId];
  saveRateLimitsOverride(overrides);
  renderRateLimitsPanel();
}

// ============================================================
//  Image helpers
// ============================================================
async function readExifOrientation(file) {
  try {
    if (!/image\/jpe?g/i.test(file.type)) return 1;
    const buf = await file.slice(0, 128 * 1024).arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0, false) !== 0xFFD8) return 1;

    const length = view.byteLength;
    let offset = 2;

    while (offset < length) {
      if (view.getUint16(offset, false) === 0xFFE1) {
        offset += 2;
        const exifHeader = view.getUint32(offset, false);
        if (exifHeader !== 0x45786966) return 1;
        offset += 6;
        const tiffStart = offset;
        const bigEndian = view.getUint16(tiffStart, false) === 0x4D4D;
        const endian = !bigEndian;
        if (view.getUint16(tiffStart + 2, endian) !== 0x002A) return 1;
        const ifdOffset = view.getUint32(tiffStart + 4, endian);
        const dirStart = tiffStart + ifdOffset;
        const entries = view.getUint16(dirStart, endian);
        for (let i = 0; i < entries; i++) {
          const entryOffset = dirStart + 2 + i * 12;
          const tag = view.getUint16(entryOffset, endian);
          if (tag === 0x0112) {
            return view.getUint16(entryOffset + 8, endian);
          }
        }
        return 1;
      }
      offset += 2 + view.getUint16(offset + 2, false);
    }
    return 1;
  } catch (e) {
    console.warn('EXIF read failed:', e);
    return 1;
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

function canvasToImage(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) return reject(new Error('canvas.toBlob failed'));
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    }, 'image/jpeg', 0.95);
  });
}

async function loadImageOriented(file) {
  const orientation = await readExifOrientation(file);
  const img = await loadImage(file);
  if (orientation === 1) return { img, orientation };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const swap = orientation >= 5 && orientation <= 8;
  canvas.width = swap ? img.height : img.width;
  canvas.height = swap ? img.width : img.height;

  switch (orientation) {
    case 2: ctx.translate(canvas.width, 0); ctx.scale(-1, 1); break;
    case 3: ctx.translate(canvas.width, canvas.height); ctx.rotate(Math.PI); break;
    case 4: ctx.translate(0, canvas.height); ctx.scale(1, -1); break;
    case 5: ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
    case 6: ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); break;
    case 7: ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;
    case 8: ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); break;
  }
  ctx.drawImage(img, 0, 0);
  const orientedImg = await canvasToImage(canvas);
  return { img: orientedImg, orientation };
}

function getMaxSize() {
  const v = parseInt(maxSizeInput.value, 10);
  if (!v || v < 200) return 1600;
  return v;
}

async function resizeImage(file) {
  const maxDim = getMaxSize();
  const { img, orientation } = await loadImageOriented(file);
  let { width, height } = img;
  const longest = Math.max(width, height);
  let scale = 1;
  if (longest > maxDim) scale = maxDim / longest;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(img, 0, 0, targetW, targetH);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return {
    blob, width: targetW, height: targetH,
    originalWidth: width, originalHeight: height,
    originalSize: file.size,
    resizedSize: blob ? blob.size : 0,
    dataUrl: canvas.toDataURL('image/jpeg', 0.85),
    orientation
  };
}

async function normalizeImageFormat(file) {
  try {
    const name = (file.name || '').toLowerCase();
    const looksLikeHeic = name.endsWith('.heic') || name.endsWith('.heif');
    if (!looksLikeHeic) return file;
    if (typeof window.normalizeHeicFile !== 'function') {
      console.warn('[HEIC] heic-normalize not loaded yet. Skipping conversion.');
      return file;
    }
    console.log(`[HEIC] Converting ${file.name} to JPEG...`);
    const convertedFile = await window.normalizeHeicFile(file);
    console.log(`[HEIC] Converted ${file.name} → ${convertedFile.name} (${Math.round(convertedFile.size / 1024)} KB)`);
    return convertedFile;
  } catch (err) {
    console.warn(`[HEIC] Conversion failed for ${file.name}:`, err);
    return file;
  }
}

function showCompressProgress(current, total, fileName) {
  const wrap = document.getElementById('compressProgressWrap');
  const label = document.getElementById('compressProgressLabel');
  const bar = document.getElementById('compressProgressBar');
  if (!wrap || !label || !bar) return;
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  wrap.style.display = 'block';
  bar.style.width = `${pct}%`;
  label.textContent = `Compressing ${current} / ${total} (${pct}%) — ${fileName}`;
}

function hideCompressProgress() {
  const wrap = document.getElementById('compressProgressWrap');
  if (wrap) wrap.style.display = 'none';
}

async function addFiles(files) {
  const imageFiles = Array.from(files).filter(f =>
    f.type.startsWith('image/') ||
    /\.(heic|heif)$/i.test(f.name)
  );
  if (!imageFiles.length) {
    showStatus('Please select image files.', 'error');
    return;
  }

  const heicCount = imageFiles.filter(f => /\.(heic|heif)$/i.test(f.name)).length;
  const msg = heicCount > 0
    ? `Converting ${heicCount} HEIC file(s) and resizing ${imageFiles.length} image(s)...`
    : `Resizing ${imageFiles.length} image(s)...`;
  showStatus(msg, 'loading');

  const apiKey = apiKeyInput.value.trim();
  const platform = getCurrentPlatform();
  if (apiKey && autoProcessEnabled && !_consumerRunning) {
    _producerActive = true;
    startConsumer(apiKey, platform);
  } else {
    _producerActive = true;
  }

  const total = imageFiles.length;
  let current = 0;

  for (const originalFile of imageFiles) {
    current++;
    showCompressProgress(current, total, originalFile.name);
    const file = await normalizeImageFormat(originalFile);

    const task = {
      id: ++idCounter, file, previewUrl: null,
      status: 'waiting', json: null, originalJson: null, edited: false, error: null,
      resizedBlob: null, resizedDataUrl: null, resizeInfo: null,
    };

    try {
      const resized = await resizeImage(file);
      task.resizedBlob = resized.blob;
      task.resizedDataUrl = resized.dataUrl;
      task.resizeInfo = {
        original: `${resized.originalWidth}×${resized.originalHeight}`,
        resized: `${resized.width}×${resized.height}`,
        originalKB: Math.round(resized.originalSize / 1024),
        resizedKB: Math.round(resized.resizedSize / 1024),
      };
      task.previewUrl = resized.dataUrl;
    } catch (err) {
      console.error('Resize failed:', file.name, err);
      task.previewUrl = URL.createObjectURL(file);
      task.resizeInfo = { error: 'Resize failed, using original' };
    }
    queue.push(task);
    renderQueueThrottled();
    updateButtonState();
    await new Promise(r => setTimeout(r, 0));
  }

  _producerActive = false;
  hideCompressProgress();
  renderQueue();
  updateButtonState();

  const totalOrigKB = queue.filter(t => t.resizeInfo && t.resizeInfo.originalKB)
    .reduce((s, t) => s + t.resizeInfo.originalKB, 0);
  const totalNewKB = queue.filter(t => t.resizeInfo && t.resizeInfo.resizedKB)
    .reduce((s, t) => s + t.resizeInfo.resizedKB, 0);

  showStatus(
    `Added ${imageFiles.length} image(s). Queue: ${queue.length}. ` +
    `Total size: ${totalOrigKB} KB → ${totalNewKB} KB.`,
    'success'
  );
}

function updateButtonState() {
  const hasPending = queue.some(t => t.status === 'waiting');
  const hasFailed = queue.some(t => t.status === 'error');
  const hasKey = !!apiKeyInput.value.trim();
  const busy = isRunning || _consumerRunning;
  extractBtn.disabled = busy || !hasPending || !hasKey;
  retryAllBtn.disabled = busy || !hasFailed || !hasKey;
  clearBtn.disabled = busy || queue.length === 0;
}

function showStatus(msg, type = '') {
  statusEl.textContent = msg;
  statusEl.className = 'status ' + type;
}

function statusLabel(s) {
  return {
    waiting: 'Waiting', processing: 'Processing', success: 'Success',
    error: 'Failed', cancelled: 'Cancelled', retrying: 'Retrying',
  }[s] || s;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
//  Filter & Sort helpers
// ============================================================
function saveFilterState(key, state) {
  try { localStorage.setItem('filter_' + key, JSON.stringify(state)); }
  catch (e) { console.warn('Could not save filter state:', e); }
}

function loadFilterState(key, defaultValue) {
  try {
    const raw = localStorage.getItem('filter_' + key);
    return raw ? JSON.parse(raw) : defaultValue;
  } catch (e) { return defaultValue; }
}

function applyTableFilter(rows, filters, columns) {
  let result = rows.slice();

  if (filters.search && filters.search.trim() !== '') {
    const q = filters.search.toLowerCase();
    result = result.filter(row =>
      columns.some(c => String(row[c] ?? '').toLowerCase().includes(q))
    );
  }

  Object.keys(filters.columns || {}).forEach(col => {
    const allowed = filters.columns[col];
    if (!Array.isArray(allowed) || allowed.length === 0) return;
    result = result.filter(row => {
      const v = String(row[col] ?? '').trim();
      return allowed.includes(v);
    });
  });

  if (filters.sort && filters.sort.column) {
    const col = filters.sort.column;
    const dir = filters.sort.direction === 'desc' ? -1 : 1;
    result.sort((a, b) => {
      const va = String(a[col] ?? '');
      const vb = String(b[col] ?? '');
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) return (na - nb) * dir;
      return va.localeCompare(vb) * dir;
    });
  }

  return result;
}

function openColumnFilterDropdown(anchorEl, columnName, values, viewKey) {
  document.querySelectorAll('.filter-dropdown').forEach(el => el.remove());

  const dd = document.createElement('div');
  dd.className = 'filter-dropdown';

  const stateMap = {
    scrap: scrapFilters,
    queue: queueFilters,
    errors: errorFilters,
    results: resultFilters
  };
  const state = stateMap[viewKey] || { columns: {} };
  const allowed = state.columns[columnName];
  const isAllAllowed = !allowed || allowed.length === 0;

  values.forEach(v => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = v;
    cb.checked = isAllAllowed || allowed.includes(v);
    label.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = v === '' ? '(empty)' : v;
    label.appendChild(span);
    dd.appendChild(label);
  });

  const actions = document.createElement('div');
  actions.className = 'fd-actions';
  const applyBtn = document.createElement('button');
  applyBtn.className = 'fd-apply';
  applyBtn.textContent = 'Apply';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'fd-clear';
  clearBtn.textContent = 'Clear';
  actions.appendChild(applyBtn);
  actions.appendChild(clearBtn);
  dd.appendChild(actions);
  document.body.appendChild(dd);

  const rect = anchorEl.getBoundingClientRect();
  dd.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  dd.style.left = (rect.left + window.scrollX) + 'px';

  const applyFilter = (filterValues) => {
    if (!filterValues || filterValues.length === 0) {
      delete state.columns[columnName];
    } else {
      state.columns[columnName] = filterValues;
    }
    saveFilterState(viewKey, state);
    dd.remove();
    if (viewKey === 'scrap') renderScrapTable();
    else if (viewKey === 'queue') renderQueue();
    else if (viewKey === 'errors') renderErrorList();
    else if (viewKey === 'results') rerenderResults();
  };

  applyBtn.addEventListener('click', () => {
    const checked = Array.from(dd.querySelectorAll('input[type="checkbox"]:checked'))
      .map(cb => cb.value);
    const allBoxes = dd.querySelectorAll('input[type="checkbox"]').length;
    if (checked.length === allBoxes) applyFilter([]);
    else applyFilter(checked);
  });

  clearBtn.addEventListener('click', () => applyFilter([]));

  setTimeout(() => {
    document.addEventListener('click', function closeDD(ev) {
      if (!dd.contains(ev.target) && ev.target !== anchorEl) {
        dd.remove();
        document.removeEventListener('click', closeDD);
      }
    });
  }, 0);
}

// ============================================================
//  Queue rendering (with filters)
// ============================================================
function renderQueue() {
  if (!queueList) return;
  queueList.innerHTML = '';

  // Prepare rows with _status for filtering
  const rows = queue.map(t => ({
    ...t,
    _status: t.status,
    _name: t.file ? t.file.name : ''
  }));

  const filtered = applyTableFilter(rows, queueFilters, ['_name', '_status', 'error', 'movedTo']);

  filtered.forEach(task => {
    const el = document.createElement('div');
    el.className = 'queue-item';

    const sizeInfo = task.resizeInfo && !task.resizeInfo.error
      ? `${task.resizeInfo.original} → ${task.resizeInfo.resized} · ${task.resizeInfo.originalKB}KB → ${task.resizeInfo.resizedKB}KB`
      : `${(task.file.size / 1024).toFixed(0)} KB`;

    const errorLine = task.error
      ? `<div class="meta" style="color:#b02a37; font-weight:${task.invalidImage ? '600' : '400'};">
           ${task.invalidImage ? '🚫 ' : ''}${escapeHtml(task.error)}
         </div>` : '';

    const editedLine = task.edited
      ? `<div class="meta" style="color:#217346;">✏️ Manually edited</div>` : '';

    const movedLine = task.movedTo
      ? `<div class="meta" style="color:#0f5132;">📁 Moved → ${escapeHtml(task.movedTo)}</div>` : '';

    const retryBtn = task.status === 'error'
      ? `<button class="btn btn-retry" data-retry-id="${task.id}">🔁 Retry</button>` : '';

    el.innerHTML = `
      <img src="${task.previewUrl || ''}" alt="" />
      <div class="info">
        <div class="name">${escapeHtml(task.file.name)}</div>
        <div class="meta">${escapeHtml(sizeInfo)}</div>
        ${errorLine}
        ${editedLine}
        ${movedLine}
      </div>
      <span class="state state-${task.status}">${statusLabel(task.status)}</span>
      ${retryBtn}
    `;
    queueList.appendChild(el);
  });

  queueList.querySelectorAll('[data-retry-id]').forEach(btn => {
    btn.addEventListener('click', () => retryOne(parseInt(btn.dataset.retryId, 10)));
  });

  renderErrorList();
  renderQueueFilterBar();
}

function renderQueueFilterBar() {
  if (!queueFilterBar) return;
  queueFilterBar.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'filter-search';
  search.placeholder = '🔍 Search filename...';
  search.value = queueFilters.search || '';
  search.addEventListener('input', () => {
    queueFilters.search = search.value;
    saveFilterState('queue', queueFilters);
    renderQueue();
  });
  queueFilterBar.appendChild(search);

  const statuses = ['waiting', 'processing', 'success', 'error', 'cancelled', 'retrying'];
  const statusBtn = document.createElement('button');
  statusBtn.className = 'filter-select';
  statusBtn.textContent = 'status ▾';
  statusBtn.style.cursor = 'pointer';
  statusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openColumnFilterDropdown(statusBtn, '_status', statuses, 'queue');
  });
  queueFilterBar.appendChild(statusBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = '↻ Reset';
  clearBtn.addEventListener('click', () => {
    queueFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
    saveFilterState('queue', queueFilters);
    renderQueue();
  });
  queueFilterBar.appendChild(clearBtn);
}

let _renderQueueThrottle = null;
function renderQueueThrottled() {
  if (_renderQueueThrottle) return;
  _renderQueueThrottle = setTimeout(() => {
    renderQueue();
    _renderQueueThrottle = null;
  }, 300);
}

// ============================================================
//  Error Files List (with filters)
// ============================================================
function renderErrorList() {
  if (!errorList || !errorPanel || !errorCount) return;

  const failedTasks = queue.filter(t => t.status === 'error');
  if (failedTasks.length === 0) {
    errorPanel.style.display = 'none';
    errorCount.textContent = '(0)';
    errorList.innerHTML = '';
    return;
  }

  errorPanel.style.display = 'flex';
  errorCount.textContent = `(${failedTasks.length})`;

  const rows = failedTasks.map(t => ({
    ...t,
    _name: t.file ? t.file.name : '',
    _error: t.error || ''
  }));

  const filtered = applyTableFilter(rows, errorFilters, ['_name', '_error']);

  errorList.innerHTML = '';
  filtered.forEach(task => {
    const el = document.createElement('div');
    el.className = 'error-item';

    const sizeInfo = task.resizeInfo && !task.resizeInfo.error
      ? `${task.resizeInfo.originalKB}KB → ${task.resizeInfo.resizedKB}KB` : '';
    const reason = task.error || 'Unknown error';

    el.innerHTML = `
      <img src="${task.previewUrl || ''}" alt="" />
      <div class="info">
        <div class="name">${escapeHtml(task.file.name)}</div>
        <div class="meta">${escapeHtml(sizeInfo)}${sizeInfo ? ' · ' : ''}${escapeHtml(reason)}</div>
      </div>
      <button class="retry-btn" data-error-retry-id="${task.id}">🔁 Retry</button>
    `;
    errorList.appendChild(el);
  });

  errorList.querySelectorAll('[data-error-retry-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.errorRetryId, 10);
      retryOne(id);
    });
  });

  renderErrorFilterBar();
}

function renderErrorFilterBar() {
  if (!errorFilterBar) return;
  errorFilterBar.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'filter-search';
  search.placeholder = '🔍 Search filename or error...';
  search.value = errorFilters.search || '';
  search.addEventListener('input', () => {
    errorFilters.search = search.value;
    saveFilterState('errors', errorFilters);
    renderErrorList();
  });
  errorFilterBar.appendChild(search);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = '↻ Reset';
  clearBtn.addEventListener('click', () => {
    errorFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
    saveFilterState('errors', errorFilters);
    renderErrorList();
  });
  errorFilterBar.appendChild(clearBtn);
}

// ============================================================
//  Wake Lock
// ============================================================
async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator)) return;
    if (wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      console.log('[wakeLock] released');
      wakeLock = null;
    });
    console.log('[wakeLock] acquired');
  } catch (err) {
    console.warn(`[wakeLock] request failed: ${err.name} — ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (!wakeLock) return;
  try { await wakeLock.release(); }
  catch (err) { console.warn(`[wakeLock] release failed: ${err.message}`); wakeLock = null; }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && _consumerRunning) {
    await requestWakeLock();
  }
});

// ============================================================
//  Smart Rate Limiter
// ============================================================
const smartRateLimiter = {
  requestTimestamps: [],
  tokenUsage: [],
  dailyRequestCount: 0,
  dailyResetDate: null,

  async wait(estimatedTokens = 5000) {
    const limits = getEffectiveLimits();
    const now = Date.now();
    const oneMinuteAgo = now - 60_000;

    const today = new Date().toDateString();
    if (this.dailyResetDate !== today) {
      this.dailyRequestCount = 0;
      this.dailyResetDate = today;
    }

    if (this.dailyRequestCount >= limits.rpd) {
      throw new Error(`DAILY_LIMIT_REACHED: ${this.dailyRequestCount}/${limits.rpd} requests today.`);
    }

    this.requestTimestamps = this.requestTimestamps.filter(t => t > oneMinuteAgo);
    this.tokenUsage = this.tokenUsage.filter(u => u.timestamp > oneMinuteAgo);

    if (this.requestTimestamps.length >= limits.rpm) {
      const oldest = this.requestTimestamps[0];
      const waitMs = oldest + 60_000 - now + 500;
      console.log(`[rate] RPM limit reached. Waiting ${Math.round(waitMs / 1000)}s...`);
      await sleep(waitMs);
      return this.wait(estimatedTokens);
    }

    const currentTokens = this.tokenUsage.reduce((sum, u) => sum + u.tokens, 0);
    if (currentTokens + estimatedTokens > limits.tpm) {
      const oldestToken = this.tokenUsage[0];
      if (oldestToken) {
        const waitMs = oldestToken.timestamp + 60_000 - now + 500;
        console.log(`[rate] TPM limit reached. Waiting ${Math.round(waitMs / 1000)}s...`);
        await sleep(waitMs);
        return this.wait(estimatedTokens);
      }
    }

    this.requestTimestamps.push(now);
    this.tokenUsage.push({ timestamp: now, tokens: estimatedTokens });
    this.dailyRequestCount++;
  },

  reset() {
    this.requestTimestamps = [];
    this.tokenUsage = [];
    this.dailyRequestCount = 0;
    this.dailyResetDate = null;
    console.log('[rate] Counter reset');
  }
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
//  Extract / batch flow
// ============================================================
async function onExtractClick() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus('Please enter your API Key first.', 'error'); return; }
  if (_consumerRunning) { showStatus('Processing is already running.', 'warning'); return; }
  const hasPending = queue.some(t => t.status === 'waiting');
  if (!hasPending) { showStatus('No pending files to process.', 'error'); return; }

  const platform = getCurrentPlatform();
  _producerActive = false;
  startConsumer(apiKey, platform);
}

async function startConsumer(apiKey, platform) {
  if (_consumerRunning) return;
  _consumerRunning = true;

  await requestWakeLock();
  console.log('[consumer] started');

  resultSection.style.display = 'none';
  progressWrap.style.display = 'block';
  summaryEl.style.display = 'none';

  let lastProgressUpdate = 0;

  while (true) {
    const task = queue.find(t => t.status === 'waiting');

    if (!task) {
      if (_producerActive) { await sleep(300); continue; }
      await sleep(500);
      const stillWaiting = queue.some(t => t.status === 'waiting');
      if (!stillWaiting) break;
      else continue;
    }

    task.status = 'processing';
    renderQueueThrottled();

    let stopBatch = false;

    try {
      const json = await extractOneWithRetry(task, apiKey, platform);
      if (json._signatureWarning) {
        task.signatureWarning = json._signatureWarning;
        delete json._signatureWarning;
      }
      if (json._autoCorrections) {
        task.autoCorrections = json._autoCorrections;
        delete json._autoCorrections;
      }
      task.json = json;
      task.originalJson = JSON.parse(JSON.stringify(json));
      task.status = 'success';
      task.error = null;
    } catch (err) {
      console.error(task.file.name, err);
      if (err.message && err.message.includes('DAILY_LIMIT_REACHED')) {
        task.error = 'Daily API limit reached';
        task.status = 'waiting';
        stopBatch = true;
      } else if (err.invalidImage) {
        task.error = 'Invalid image — not an EBRO Control Calidad form';
        task.status = 'error';
        task.invalidImage = true;
      } else {
        task.error = err.message || 'Unknown error';
        task.status = 'error';
      }
    }

    if (stopBatch) {
      showStatus('🛑 Daily API limit reached. Batch stopped.', 'error');
      break;
    }

    if (inputMethod === 'folder' && task.localHandle && task.localName) {
      try {
        const targetHandle = task.status === 'success' ? localHandles.readed : localHandles.error;
        const movedName = await moveLocalFile(task, targetHandle);
        task.movedTo = movedName;
        task.currentLocation = task.status === 'success' ? 'readed' : 'error';
        console.log(`[move] ${task.localName} → ${task.currentLocation}/${movedName}`);
      } catch (moveErr) {
        console.error('Move failed:', task.localName, moveErr);
        task.error = (task.error ? task.error + ' | ' : '') + 'Move failed: ' + moveErr.message;
      }
    }

    renderQueueThrottled();

    const successTasks = queue.filter(t => t.status === 'success' && t.json);
    if (successTasks.length) {
      renderResultTable(successTasks);
      resultSection.style.display = 'block';
    }

    const now = Date.now();
    if (now - lastProgressUpdate > 500) {
      lastProgressUpdate = now;
      const processed = queue.filter(t => t.status === 'success' || t.status === 'error').length;
      if (queue.length > 0) progressBar.style.width = `${Math.round((processed / queue.length) * 100)}%`;
      const successCount = queue.filter(t => t.status === 'success').length;
      const failedCount = queue.filter(t => t.status === 'error').length;
      const waitingCount = queue.filter(t => t.status === 'waiting').length;
      summaryEl.style.display = 'block';
      summaryEl.innerHTML = `✅ Succeeded: ${successCount} · ❌ Failed: ${failedCount} · ⏳ Waiting: ${waitingCount}`;
    }

    updateButtonState();
  }

  _consumerRunning = false;
  console.log('[consumer] stopped');
  await releaseWakeLock();

  if (platform === 'deepseek') fetchDeepSeekBalance();

  renderQueue();
  progressBar.style.width = '100%';

  const successCount = queue.filter(t => t.status === 'success').length;
  const failedCount = queue.filter(t => t.status === 'error').length;
  const waitingCount = queue.filter(t => t.status === 'waiting').length;

  summaryEl.style.display = 'block';
  summaryEl.innerHTML = `✅ Succeeded: ${successCount} · ❌ Failed: ${failedCount} · ⏳ Waiting: ${waitingCount} · Total: ${queue.length}`;

  const successTasks = queue.filter(t => t.status === 'success' && t.json);
  if (successTasks.length) {
    renderResultTable(successTasks);
    resultSection.style.display = 'block';
    showStatus(
      `🎉 Done. Succeeded: ${successCount}, Failed: ${failedCount}.` +
      (waitingCount ? ` ${waitingCount} still waiting.` : '') +
      (failedCount ? ' Use "Retry Failed".' : ''),
      successCount ? 'success' : 'error'
    );
  } else if (waitingCount > 0) {
    showStatus(`⏸️ Paused. ${waitingCount} task(s) waiting.`, 'warning');
  } else {
    showStatus('❌ All failed. Check your API Key or network.', 'error');
  }
  updateButtonState();
}

async function onRetryAllClick() {
  if (_consumerRunning) return;
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return;
  const failed = queue.filter(t => t.status === 'error');
  if (!failed.length) return;

  failed.forEach(t => {
    t.status = 'waiting';
    t.error = null;
    t.json = null;
    t.originalJson = null;
    t.edited = false;
    t.invalidImage = false;
  });
  renderQueue();
  updateButtonState();

  const platform = getCurrentPlatform();
  _producerActive = false;
  startConsumer(apiKey, platform);
}

async function retryOne(id) {
  if (_consumerRunning) { showStatus('Consumer is running.', 'warning'); return; }
  if (isRunning) return;
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus('Please enter your API Key first.', 'error'); return; }
  const task = queue.find(t => t.id === id);
  if (!task || task.status !== 'error') return;

  isRunning = true;
  await requestWakeLock();
  updateButtonState();
  updateLocalModeButtons();

  if (inputMethod === 'folder' && task.currentLocation === 'error' && task.movedTo) {
    try {
      const pulledBack = await pullFileBackFromFolder(localHandles.error, localHandles.input, task.movedTo);
      task.localHandle = pulledBack.handle;
      task.localName = pulledBack.name;
      task.movedTo = null;
      task.currentLocation = 'input';
    } catch (pullErr) {
      task.error = 'Pull back failed: ' + pullErr.message;
      task.status = 'error';
      isRunning = false;
      renderQueue();
      updateButtonState();
      updateLocalModeButtons();
      showStatus(`❌ Could not pull back ${task.localName}.`, 'error');
      return;
    }
  }

  task.status = 'processing';
  task.error = null;
  task.invalidImage = false;
  renderQueue();
  updateButtonState();

  const platform = getCurrentPlatform();

  try {
    await smartRateLimiter.wait(5000);
    const json = await extractOneWithRetry(task, apiKey, platform);
    if (json._signatureWarning) { task.signatureWarning = json._signatureWarning; delete json._signatureWarning; }
    if (json._autoCorrections) { task.autoCorrections = json._autoCorrections; delete json._autoCorrections; }
    task.json = json;
    task.originalJson = JSON.parse(JSON.stringify(json));
    task.status = 'success';
    task.error = null;
  } catch (err) {
    console.error(task.file.name, err);
    if (err.invalidImage) {
      task.error = 'Invalid image — not an EBRO Control Calidad form';
      task.invalidImage = true;
    } else {
      task.error = err.message || 'Unknown error';
    }
    task.status = 'error';
  }

  if (inputMethod === 'folder' && task.localHandle && task.localName) {
    try {
      const targetHandle = task.status === 'success' ? localHandles.readed : localHandles.error;
      const movedName = await moveLocalFile(task, targetHandle);
      task.movedTo = movedName;
      task.currentLocation = task.status === 'success' ? 'readed' : 'error';
    } catch (moveErr) {
      task.error = (task.error ? task.error + ' | ' : '') + 'Move failed: ' + moveErr.message;
    }
  }

  isRunning = false;
  await releaseWakeLock();
  renderQueue();
  updateButtonState();
  updateLocalModeButtons();

  if (platform === 'deepseek') fetchDeepSeekBalance();

  showStatus(
    task.status === 'success' ? `✅ Retried successfully: ${task.file.name}` : `❌ Retry failed: ${task.file.name}`,
    task.status === 'success' ? 'success' : 'error'
  );

  const successTasks = queue.filter(t => t.status === 'success' && t.json);
  if (successTasks.length) {
    renderResultTable(successTasks);
    resultSection.style.display = 'block';
  }

  const successCount = queue.filter(t => t.status === 'success').length;
  const failedCount = queue.filter(t => t.status === 'error').length;
  const pendingCount = queue.filter(t => t.status === 'waiting').length;
  summaryEl.style.display = 'block';
  summaryEl.innerHTML = `✅ Succeeded: ${successCount} · ❌ Failed: ${failedCount} · ⏳ Pending: ${pendingCount}`;
}

function onClearClick() {
  if (isRunning || _consumerRunning) {
    queue.forEach(t => { if (t.status === 'waiting') t.status = 'cancelled'; });
    renderQueue();
    updateButtonState();
    return;
  }
  queue.forEach(t => {
    if (t.previewUrl && t.previewUrl.startsWith('blob:')) URL.revokeObjectURL(t.previewUrl);
  });
  queue = [];
  renderQueue();
  renderErrorList();
  progressWrap.style.display = 'none';
  progressBar.style.width = '0%';
  summaryEl.style.display = 'none';
  resultSection.style.display = 'none';
  showStatus('');
  updateButtonState();
}

// ============================================================
//  File path helpers
// ============================================================
function buildFilePath(file) {
  if (file.webkitRelativePath) return file.webkitRelativePath.replace(/\\/g, '/');
  return file.name;
}

function buildFilePathForTask(task) {
  if (inputMethod === 'folder' && task && task.movedTo) {
    const destFolder = task.currentLocation || (task.status === 'success' ? 'readed' : 'error');
    return `${destFolder}/${task.movedTo}`;
  }
  if (inputMethod === 'folder' && task && task.localName) {
    return `input/${task.localName}`;
  }
  return buildFilePath(task.file);
}

// ============================================================
//  AI dispatch
// ============================================================
async function extractOneWithRetry(task, apiKey, platform) {
  const MAX_ATTEMPTS = 3;
  const delays = [5000, 10000, 20000];
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callAI(task, apiKey, platform);
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || '').toLowerCase();
      if (err.invalidImage) throw err;
      if (err.message && err.message.includes('DAILY_LIMIT_REACHED')) throw err;

      const isTransient = err.transient === true ||
        /high demand|overloaded|temporarily|try again|rate limit|503|502|504|429|insufficient/i.test(msg);
      if (!isTransient || attempt === MAX_ATTEMPTS) throw err;

      const waitMs = delays[attempt - 1] || 10000;
      task.status = 'retrying';
      task.error = `Attempt ${attempt} failed (${err.message}). Retrying in ${Math.round(waitMs / 1000)}s...`;
      renderQueue();
      await sleep(waitMs);
      task.status = 'processing';
      renderQueue();
    }
  }
  throw lastErr || new Error('Unknown error');
}

async function callAI(task, apiKey, platform) {
  const sourceBlob = task.resizedBlob || task.file;
  const base64 = await blobToBase64(sourceBlob);
  const mimeType = sourceBlob.type || 'image/jpeg';
  const prompt = buildPromptText();

  if (platform === 'gemini') {
    return await callGemini({ base64, mimeType, prompt, apiKey });
  } else if (platform === 'deepseek') {
    return await callDeepSeek({ base64, mimeType, prompt, apiKey });
  } else {
    throw new Error('Unknown platform: ' + platform);
  }
}

async function callGemini({ base64, mimeType, prompt, apiKey }) {
  const cfg = PLATFORMS.gemini;
  const modelId = getCurrentGeminiModel();
  const url = `${cfg.endpoint(modelId)}?key=${apiKey}`;
  const estimatedTokens = 5000;

  await smartRateLimiter.wait(estimatedTokens);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: buildJsonSchema(),
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 3000
        }
      })
    });
  } catch (netErr) {
    const e = new Error('Network error: ' + netErr.message);
    e.transient = true;
    throw e;
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const apiMsg = errBody.error?.message || `HTTP ${response.status}`;
    const e = new Error(apiMsg);
    if ([429, 503, 502, 504].includes(response.status)) e.transient = true;
    throw e;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const e = new Error('Gemini returned no content.');
    e.transient = true;
    throw e;
  }

  let parsed;
  try { parsed = JSON.parse(stripFences(text)); }
  catch (parseErr) {
    const e = new Error('Invalid JSON from Gemini: ' + parseErr.message);
    e.transient = true;
    throw e;
  }

  if (parsed.header && parsed.header._validity === 'invalid') {
    const e = new Error('INVALID_IMAGE');
    e.invalidImage = true;
    throw e;
  }

  return postProcess(parsed);
}

async function callDeepSeek({ base64, mimeType, prompt, apiKey }) {
  const cfg = PLATFORMS.deepseek;
  const url = cfg.endpoint();

  const body = {
    model: cfg.defaultModel,
    messages: [
      { role: 'system', content: 'You are a strict data extraction assistant. Always reply with a single valid JSON object only, no markdown, no explanations.' },
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
      ]}
    ],
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 3000,
    stream: false
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    });
  } catch (netErr) {
    const e = new Error('Network error: ' + netErr.message);
    e.transient = true;
    throw e;
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    const apiMsg = errBody.error?.message || errBody.message || `HTTP ${response.status}`;
    const e = new Error(apiMsg);
    if ([429, 503, 502, 504].includes(response.status)) e.transient = true;
    throw e;
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    const e = new Error('DeepSeek returned no content.');
    e.transient = true;
    throw e;
  }

  let parsed;
  try { parsed = JSON.parse(stripFences(text)); }
  catch (parseErr) {
    const e = new Error('Invalid JSON from DeepSeek: ' + parseErr.message);
    e.transient = true;
    throw e;
  }

  if (parsed.header && parsed.header._validity === 'invalid') {
    const e = new Error('INVALID_IMAGE');
    e.invalidImage = true;
    throw e;
  }

  return postProcess(parsed);
}

function stripFences(text) {
  return text.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');
}

// ============================================================
//  Post-processing
// ============================================================
function postProcess(parsed) {
  parsed = unwrapSchemaEcho(parsed);
  parsed = coerceNullStrings(parsed);
  parsed = normalizeSignatures(parsed);
  parsed = sanitizeSignatures(parsed);
  parsed = normalizeTicketCategory(parsed);
  parsed = normalizeCodigoConjunto(parsed);
  parsed = dedupeFields(parsed);
  parsed = flagSuspiciousSignatures(parsed);
  parsed = removeHiddenFields(parsed);
  parsed = applyLearnedCorrections(parsed);
  if (parsed.header && typeof parsed.header === 'object') {
    delete parsed.header._validity;
  }
  return parsed;
}

function flagSuspiciousSignatures(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  if (!parsed.signatures || typeof parsed.signatures !== 'object') return parsed;
  const sig = parsed.signatures;
  const signed = ['inspector', 'visto_bueno_calidad', 'encargado_linea']
    .filter(k => /^Signed$/i.test(String(sig[k] || '')));
  if (signed.length === 3) {
    parsed._signatureWarning = 'All three signatures marked as Signed — please verify';
  }
  return parsed;
}

function dedupeFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const dedupeConfig = {
    section_1: ['codigo_conjunto','codigo_componente','codigo_rechaz','cantidad','origen_area_zona'],
    section_2: ['motivo_rechace','fecha','operario','observaciones'],
    header: ['ticket_category','ticket_id']
  };

  Object.keys(dedupeConfig).forEach(sectionKey => {
    const section = obj[sectionKey];
    if (!section || typeof section !== 'object') return;
    const fields = dedupeConfig[sectionKey];
    const seen = new Map();

    fields.forEach(fieldKey => {
      const raw = section[fieldKey];
      if (raw === null || raw === undefined) return;
      const s = String(raw).trim();
      if (s === '') return;
      const norm = s.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(norm)) {
        section[fieldKey] = null;
      } else {
        seen.set(norm, fieldKey);
      }
    });
  });
  return obj;
}

function unwrapSchemaEcho(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(unwrapSchemaEcho);
  if ('value' in obj && ('type' in obj || 'description' in obj)) return obj.value;
  const out = {};
  for (const key of Object.keys(obj)) out[key] = unwrapSchemaEcho(obj[key]);
  return out;
}

function normalizeSignatures(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.signatures || typeof obj.signatures !== 'object') return obj;
  const sig = obj.signatures;
  ['inspector', 'visto_bueno_calidad', 'encargado_linea'].forEach(key => {
    const raw = sig[key];
    if (raw === null || raw === undefined) { sig[key] = 'Not Signed'; return; }
    const s = String(raw).trim().toLowerCase();
    if (['signed', 'yes', 'true', 'signature', 'signed.'].includes(s)) sig[key] = 'Signed';
    else if (['not signed', 'no', 'false', 'empty', 'unsigned'].includes(s)) sig[key] = 'Not Signed';
    else if (/sign/i.test(s) && !/not|no |empty|blank/i.test(s)) sig[key] = 'Signed';
    else sig[key] = 'Not Signed';
  });
  return obj;
}

function sanitizeSignatures(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.signatures || typeof obj.signatures !== 'object') return obj;
  const sig = obj.signatures;
  ['inspector', 'visto_bueno_calidad', 'encargado_linea'].forEach(key => {
    const raw = sig[key];
    if (raw === null || raw === undefined) { sig[key] = 'Not Signed'; return; }
    const s = String(raw).trim();
    if (/^not\s*signed$/i.test(s)) { sig[key] = 'Not Signed'; return; }
    if (/^signed$/i.test(s)) { sig[key] = 'Signed'; return; }
    sig[key] = 'Not Signed';
  });
  return obj;
}

function normalizeTicketCategory(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.header || typeof obj.header !== 'object') return obj;

  const raw = obj.header.ticket_category ?? obj.header.part_category;
  delete obj.header.part_category;

  if (raw === null || raw === undefined || String(raw).trim() === '') {
    obj.header.ticket_category = 'Unknown';
    return obj;
  }
  const s = String(raw).trim();
  if (/^Process Scrap Parts$/i.test(s)) { obj.header.ticket_category = 'Process Scrap Parts'; return obj; }
  if (/^Supplier Claim Parts$/i.test(s)) { obj.header.ticket_category = 'Supplier Claim Parts'; return obj; }
  const lower = s.toLowerCase();
  if (/green|scrap|proceso|process|rechazo interno|internal/.test(lower)) {
    obj.header.ticket_category = 'Process Scrap Parts';
  } else if (/orange|supplier|proveedor|claim|reclamaci/.test(lower)) {
    obj.header.ticket_category = 'Supplier Claim Parts';
  } else {
    obj.header.ticket_category = 'Unknown';
  }
  return obj;
}

function normalizeCodigoConjunto(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (!obj.section_1 || typeof obj.section_1 !== 'object') return obj;
  const val = obj.section_1.codigo_conjunto;
  if (val === null || val === undefined || String(val).trim() === '') return obj;
  let s = String(val).replace(/\s+/g, '');
  s = s.replace(/\s*([\/\-.])\s*/g, '$1');
  obj.section_1.codigo_conjunto = s;
  return obj;
}

function removeHiddenFields(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.header && typeof obj.header === 'object') {
    delete obj.header.company;
    delete obj.header.document_type;
  }
  return obj;
}

function coerceNullStrings(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    if (/^null$/i.test(obj.trim())) return null;
    return obj;
  }
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(coerceNullStrings);
  const out = {};
  for (const key of Object.keys(obj)) out[key] = coerceNullStrings(obj[key]);
  return out;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ============================================================
//  Result table + Summary + Quality
// ============================================================
function flattenJson(obj) {
  const flat = {};
  function walk(node, path) {
    if (node === null || node === undefined) {
      flat[path] = '';
    } else if (typeof node === 'object' && !Array.isArray(node)) {
      for (const key of Object.keys(node)) walk(node[key], path ? `${path}.${key}` : key);
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
    } else {
      flat[path] = node;
    }
  }
  walk(obj, '');
  return flat;
}

function evaluateCell(value) {
  if (value === null || value === undefined) return 'missing';
  const s = String(value).trim();
  if (s === '') return 'missing';
  if (s.length === 1 && !/\d/.test(s)) return 'suspicious';
  if (/[?□■�]/.test(s)) return 'suspicious';
  if (/^[\-_.·]+$/.test(s)) return 'suspicious';
  return 'ok';
}

function isValueMissing(path, value) {
  if (OPTIONAL_FIELDS.includes(path)) return false;
  if (value === null || value === undefined) return true;
  const s = String(value).trim();
  if (s === '') return true;
  if (path.startsWith('signatures.')) {
    return !/^Signed$/i.test(s);
  }
  return false;
}

function buildKeyParameterSummary(tasks) {
  const keyStats = {};
  KEY_PARAMETERS.forEach(kp => {
    keyStats[kp.path] = { label: kp.label, missingCount: 0, total: tasks.length };
  });
  const statuses = {};

  tasks.forEach(task => {
    const flat = flattenJson(task.json || {});
    const reasons = [];
    let keyMissing = 0;
    let otherMissing = 0;
    let otherFormatIssue = 0;

    Object.keys(flat).forEach(path => {
      const value = flat[path];
      if (path === '_file' || path === '_taskId' || path === '_edited') return;
      const isKey = KEY_PARAMETERS.some(kp => kp.path === path);

      if (isValueMissing(path, value)) {
        if (isKey) {
          keyMissing++;
          const label = KEY_PARAMETERS.find(kp => kp.path === path)?.label || path;
          reasons.push(`Missing key parameter: ${label}`);
          keyStats[path].missingCount++;
        } else {
          otherMissing++;
          reasons.push(`Missing: ${getDisplayHeader(path)}`);
        }
        return;
      }

      const fStatus = checkFormat(path, value);
      if (fStatus === 'format-mismatch') {
        if (isKey) {
          keyMissing++;
          const label = KEY_PARAMETERS.find(kp => kp.path === path)?.label || path;
          reasons.push(`Invalid format on key parameter: ${label}`);
          keyStats[path].missingCount++;
        } else {
          otherFormatIssue++;
          reasons.push(`Format issue: ${getDisplayHeader(path)}`);
        }
      }
    });

    let level = 'green';
    if (keyMissing > 0) level = 'red';
    else if (otherMissing > 0 || otherFormatIssue > 0) level = 'yellow';
    if (task.signatureWarning) {
      reasons.push(task.signatureWarning);
      if (level === 'green') level = 'yellow';
    }
    statuses[task.id] = { level, reasons };
  });

  return { keyStats, statuses };
}

function computeQualityScore(tasks) {
  let keyPresent = 0, keyTotal = 0;
  let otherPresent = 0, otherTotal = 0;
  const keyPathSet = new Set(KEY_PARAMETERS.map(kp => kp.path));

  tasks.forEach(task => {
    const flat = flattenJson(task.json || {});
    Object.keys(flat).forEach(path => {
      if (path === '_file' || path === '_taskId' || path === '_edited') return;
      const value = flat[path];
      const missing = isValueMissing(path, value);
      let formatBad = false;
      if (!missing) {
        const fStatus = checkFormat(path, value);
        if (fStatus === 'format-mismatch') formatBad = true;
      }
      const isPresent = !missing && !formatBad;
      const isKey = keyPathSet.has(path);
      if (isKey) { keyTotal++; if (isPresent) keyPresent++; }
      else { otherTotal++; if (isPresent) otherPresent++; }
    });
  });

  const keyRatio = keyTotal > 0 ? keyPresent / keyTotal : 1;
  const otherRatio = otherTotal > 0 ? otherPresent / otherTotal : 1;
  const raw = keyRatio * 0.7 + otherRatio * 0.3;
  const score = Math.round(raw * 1000) / 10;

  let level = 'bad';
  if (score >= 90) level = 'good';
  else if (score >= 70) level = 'warn';
  return { score, keyPresent, keyTotal, otherPresent, otherTotal, level };
}

function groupIssuesByType(tasks) {
  const groups = {
    missing: { total: 0, fields: {} },
    format: { total: 0, fields: {} },
    suspicious: { total: 0, fields: {} },
    edited: { total: 0, fields: {} }
  };

  tasks.forEach(task => {
    const flat = flattenJson(task.json || {});
    Object.keys(flat).forEach(path => {
      if (path === '_file' || path === '_taskId' || path === '_edited') return;
      const value = flat[path];
      const displayName = getDisplayHeader(path);

      if (isValueMissing(path, value)) {
        groups.missing.total++;
        groups.missing.fields[displayName] = (groups.missing.fields[displayName] || 0) + 1;
        return;
      }
      const suspicious = evaluateCell(value) === 'suspicious';
      if (suspicious) {
        groups.suspicious.total++;
        groups.suspicious.fields[displayName] = (groups.suspicious.fields[displayName] || 0) + 1;
        return;
      }
      const fStatus = checkFormat(path, value);
      if (fStatus === 'format-mismatch') {
        groups.format.total++;
        groups.format.fields[displayName] = (groups.format.fields[displayName] || 0) + 1;
        return;
      }
      if (task.edited) {
        groups.edited.total++;
        groups.edited.fields[displayName] = (groups.edited.fields[displayName] || 0) + 1;
      }
    });
  });

  return groups;
}

function renderErrorSummary(tasks) {
  const container = document.getElementById('errorSummary');
  if (!container) return;
  const groups = groupIssuesByType(tasks);
  const totalIssues = groups.missing.total + groups.format.total + groups.suspicious.total;

  if (totalIssues === 0 && groups.edited.total === 0) {
    container.classList.add('all-good');
    container.innerHTML = `<div class="es-title">✅ No issues detected · ${tasks.length} form(s) processed</div>`;
    container.style.display = 'block';
    return;
  }

  container.classList.remove('all-good');

  function renderGroup(key, label, icon) {
    const g = groups[key];
    if (g.total === 0) return '';
    const fieldEntries = Object.entries(g.fields).sort((a, b) => b[1] - a[1]);
    const fieldHTML = fieldEntries.length
      ? fieldEntries.map(([name, count]) =>
          `<li class="es-field-item"><span class="es-field-name">${escapeHtml(name)}</span><span class="es-field-count">${count}</span></li>`
        ).join('')
      : '<li class="es-empty">No fields</li>';
    return `
      <div class="es-group ${key}">
        <div class="es-group-header"><span>${icon} ${label}</span><span class="es-count">${g.total}</span></div>
        <ul class="es-field-list">${fieldHTML}</ul>
      </div>`;
  }

  const titleText = totalIssues > 0
    ? `⚠️ ${totalIssues} issue(s) detected across ${tasks.length} form(s)`
    : `✏️ ${groups.edited.total} manually edited cell(s)`;

  container.innerHTML = `
    <div class="es-title">${titleText}${groups.edited.total && totalIssues ? ` · ${groups.edited.total} manually edited` : ''}</div>
    <div class="es-groups">
      ${renderGroup('missing', 'Missing / null', '🔴')}
      ${renderGroup('format', 'Format mismatch', '🔴')}
      ${renderGroup('suspicious', 'Suspicious value', '🟡')}
      ${renderGroup('edited', 'Manually edited', '✏️')}
    </div>`;
  container.style.display = 'block';
}

function renderSummaryReport(keyStats, totalRows, tasks) {
  const container = document.getElementById('summaryReport');
  if (!container) return;
  const quality = computeQualityScore(tasks);

  const scoreHTML = `
    <div class="sr-score ${quality.level}">
      <div class="score-main">
        <span class="score-value">${quality.score.toFixed(1)}%</span>
        <span class="score-label">Data Quality</span>
      </div>
      <div class="score-bar"><div class="score-bar-fill" style="width: ${quality.score}%"></div></div>
      <div class="score-detail">
        Key parameters: <b>${quality.keyPresent}/${quality.keyTotal}</b> present<br>
        Other fields: <b>${quality.otherPresent}/${quality.otherTotal}</b> present
      </div>
    </div>`;

  const items = KEY_PARAMETERS.map(kp => {
    const stat = keyStats[kp.path];
    const missing = stat.missingCount;
    const present = stat.total - missing;
    let cls = 'ok';
    if (missing > 0) cls = missing === stat.total ? 'err' : 'warn';
    const countDisplay = missing === 0 ? `${present}/${stat.total}` : `${missing} missing`;
    return `<div class="sr-item ${cls}"><span class="sr-label">${escapeHtml(kp.label)}</span><span class="sr-count">${countDisplay}<small>${missing === 0 ? 'complete' : 'of ' + stat.total}</small></span></div>`;
  }).join('');

  container.innerHTML = `
    <div class="sr-title">📊 Data Quality Audit · ${totalRows} form(s) processed</div>
    ${scoreHTML}
    <div class="sr-grid">${items}</div>`;
  container.style.display = 'block';
}

function renderResultTable(tasks) {
  const { keyStats, statuses } = buildKeyParameterSummary(tasks);
  renderSummaryReport(keyStats, tasks.length, tasks);
  renderErrorSummary(tasks);

  const rows = tasks.map(t => ({
    _taskId: t.id,
    _file: buildFilePathForTask(t),
    _edited: !!t.edited,
    _signatureWarning: t.signatureWarning || null,
    ...flattenJson(t.json)
  }));

  const headerSet = new Set(['_file']);
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (k === '_taskId' || k === '_edited' || k === '_signatureWarning') return;
    if (k === 'header._validity') return;
    if (HIDDEN_FIELDS.includes(k)) return;
    headerSet.add(k);
  }));
  const headers = Array.from(headerSet);

  // Apply filters
  const filteredRows = applyTableFilter(
    rows,
    resultFilters,
    headers.filter(h => !h.startsWith('_'))
  );

  let missingCount = 0, suspiciousCount = 0, formatCount = 0;

  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');
  let headerHTML = `<th class="row-num">#</th>` +
    `<th class="status-col" title="Row status">●</th>`;

  headers.forEach(h => {
    const display = getDisplayHeader(h);
    const isSorted = resultFilters.sort.column === h;
    const sortClass = isSorted ? (resultFilters.sort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc') : '';
    headerHTML += `<th class="sortable ${sortClass}" data-sort-column="${escapeHtml(h)}" title="${escapeHtml(h)}">
      ${escapeHtml(display)} <span class="sort-indicator"></span>
    </th>`;
  });
  headerHTML += `<th class="action-cell">Action</th>`;
  headTr.innerHTML = headerHTML;
  thead.appendChild(headTr);

  const tbody = document.createElement('tbody');

  filteredRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cells = [];
    cells.push(`<td class="row-num">${i + 1}</td>`);

    const statusInfo = statuses[r._taskId] || { level: 'green', reasons: [] };
    if (r._signatureWarning) {
      statusInfo.reasons.push(r._signatureWarning);
      if (statusInfo.level === 'green') statusInfo.level = 'yellow';
    }
    const reasonsText = statusInfo.reasons.length ? statusInfo.reasons.join(' · ') : 'All fields present and valid';
    cells.push(`<td class="status-col" title="${escapeHtml(reasonsText)}"><span class="status-light ${statusInfo.level}"></span></td>`);

    headers.forEach(h => {
      const raw = r[h];
      let status = evaluateCell(raw);
      let hint = '';

      if (status === 'missing' && OPTIONAL_FIELDS.includes(h)) status = 'ok';

      if (status === 'ok') {
        const fStatus = checkFormat(h, raw);
        if (fStatus === 'format-mismatch') {
          status = 'format-mismatch';
          hint = FORMAT_RULES[h]?.hint || 'Format does not match expected pattern';
        } else if (fStatus === 'missing') {
          status = 'missing';
        }
        if (status === 'ok' && h === 'section_1.cantidad') {
          const cantMsg = validateCantidad(raw);
          if (cantMsg) { status = 'suspicious'; hint = cantMsg; }
        }
      }

      if (r._edited && status === 'ok') status = 'edited';

      let cls = '', badge = '';

      if (h === 'header.ticket_category' && status === 'ok') {
        const v = String(raw).toLowerCase();
        if (v.includes('process scrap')) {
          cls = 'cell-category-scrap';
          badge = '<span class="cell-badge" style="background:#a3cfbb;color:#0f5132;">green</span>';
        } else if (v.includes('supplier claim')) {
          cls = 'cell-category-supplier';
          badge = '<span class="cell-badge" style="background:#ffc99a;color:#8a4b00;">orange</span>';
        }
      } else if (status === 'missing') {
        missingCount++;
        cls = 'cell-missing';
        badge = '<span class="cell-badge">missing</span>';
        hint = hint || 'Missing or null value';
      } else if (status === 'suspicious') {
        suspiciousCount++;
        cls = 'cell-suspicious';
        badge = '<span class="cell-badge">check</span>';
        hint = hint || 'Suspicious value — please verify';
      } else if (status === 'format-mismatch') {
        formatCount++;
        cls = 'cell-format-mismatch';
        badge = '<span class="cell-badge">format</span>';
        hint = hint || 'Value format does not match this field';
      } else if (status === 'edited') {
        cls = 'cell-edited';
        badge = '<span class="cell-badge">edited</span>';
        hint = 'Manually corrected';
      }

      const display = (raw === null || raw === undefined || String(raw).trim() === '') ? '—' : String(raw);
      const extraClass = h === '_file' ? ' file-cell' : '';
      cells.push(`<td class="${cls}${extraClass}" title="${escapeHtml(hint)}">${escapeHtml(display)}${badge}</td>`);
    });

    const editBtnCls = r._edited ? 'btn-edit-row edited' : 'btn-edit-row';
    const editBtnText = r._edited ? '✏️ Edited' : '✏️ Edit';
    cells.push(`<td class="action-cell"><button class="${editBtnCls}" data-edit-id="${r._taskId}">${editBtnText}</button></td>`);

    tr.innerHTML = cells.join('');
    tbody.appendChild(tr);
  });

  resultTable.innerHTML = '';
  resultTable.appendChild(thead);
  resultTable.appendChild(tbody);

  resultTable.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => openEditModal(parseInt(btn.dataset.editId, 10)));
  });

  // Sort handlers on header cells
  resultTable.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', (e) => {
      // If click came from a filter button inside the header, don't sort
      if (e.target.closest('.filter-dropdown')) return;
      const col = th.dataset.sortColumn;
      if (!col) return;
      if (resultFilters.sort.column === col) {
        resultFilters.sort.direction = resultFilters.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        resultFilters.sort.column = col;
        resultFilters.sort.direction = 'asc';
      }
      saveFilterState('results', resultFilters);
      rerenderResults();
    });
  });

  // Update issues banner
  const totalCells = filteredRows.length * headers.length;
  const totalIssues = missingCount + suspiciousCount + formatCount;
  const editedCount = filteredRows.filter(r => r._edited).length;
  const scrapCount = filteredRows.filter(r => String(r['header.ticket_category'] || '').includes('Process Scrap')).length;
  const supplierCount = filteredRows.filter(r => String(r['header.ticket_category'] || '').includes('Supplier Claim')).length;

  if (totalIssues === 0) {
    issuesBanner.classList.add('all-good');
    issuesBanner.textContent =
      `✅ All ${totalCells} fields look good. ` +
      `Categories — Process Scrap: ${scrapCount}, Supplier Claim: ${supplierCount}.` +
      (editedCount ? ` ${editedCount} row(s) manually edited.` : '');
  } else {
    issuesBanner.classList.remove('all-good');
    issuesBanner.textContent =
      `⚠️ ${totalIssues} of ${totalCells} fields need review — ` +
      `${missingCount} missing, ${suspiciousCount} suspicious, ${formatCount} format mismatch. ` +
      `Categories — Process Scrap: ${scrapCount}, Supplier Claim: ${supplierCount}.` +
      (editedCount ? ` ${editedCount} row(s) manually edited.` : '') +
      ` Click "Edit" to correct.`;
  }

  // Render the result filter bar
  renderResultFilterBar(headers);
}

function renderResultFilterBar(headers) {
  if (!resultFilterBar) return;
  resultFilterBar.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'filter-search';
  search.placeholder = '🔍 Search all columns...';
  search.value = resultFilters.search || '';
  search.addEventListener('input', () => {
    resultFilters.search = search.value;
    saveFilterState('results', resultFilters);
    rerenderResults();
  });
  resultFilterBar.appendChild(search);

  // Add a filter button for each column
  headers.forEach(col => {
    if (col.startsWith('_')) return;
    const btn = document.createElement('button');
    btn.className = 'filter-select';
    btn.textContent = `${getDisplayHeader(col)} ▾`;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const values = Array.from(new Set(
        queue.filter(t => t.json).map(t => String(flattenJson(t.json)[col] ?? '').trim())
      )).sort();
      openColumnFilterDropdown(btn, col, values, 'results');
    });
    resultFilterBar.appendChild(btn);
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = '↻ Reset';
  clearBtn.addEventListener('click', () => {
    resultFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
    saveFilterState('results', resultFilters);
    rerenderResults();
  });
  resultFilterBar.appendChild(clearBtn);
}

function rerenderResults() {
  const successTasks = queue.filter(t => t.status === 'success' && t.json);
  if (successTasks.length) renderResultTable(successTasks);
}

function getDisplayHeader(path) {
  const parts = String(path).split('.');
  return parts[parts.length - 1];
}

// ============================================================
//  Zoom
// ============================================================
function applyZoom() {
  const s = zoomState.scale;
  if (zoomState.naturalW > 0) {
    modalImage.style.width = `${zoomState.naturalW * s}px`;
    modalImage.style.maxWidth = 'none';
    modalImage.style.height = 'auto';
  } else {
    modalImage.style.width = '100%';
    modalImage.style.maxWidth = 'none';
    modalImage.style.height = 'auto';
  }
  applyModalRotation();
  zoomLabel.textContent = `${Math.round(s * 100)}%`;
}

function setZoom(newScale, fitMode = null) {
  const clamped = Math.max(0.1, Math.min(8, newScale));
  zoomState.scale = clamped;
  zoomState.fitMode = fitMode;
  applyZoom();
}

function zoomIn() { setZoom(zoomState.scale * 1.25); }
function zoomOut() { setZoom(zoomState.scale / 1.25); }
function zoomReset() { modalRotation = 0; setZoom(1); }
function zoomFitWidth() {
  if (!zoomState.naturalW) return;
  const containerW = imageScroll.clientWidth - 32;
  setZoom(containerW / zoomState.naturalW, 'width');
}
function zoomFitHeight() {
  if (!zoomState.naturalH) return;
  const containerH = imageScroll.clientHeight - 32;
  setZoom(containerH / zoomState.naturalH, 'height');
}

function rotateModalImage(degrees) {
  modalRotation = (modalRotation + degrees + 360) % 360;
  applyZoom();
}

function applyModalRotation() {
  if (!imageRotator) return;
  const w = modalImage.offsetWidth;
  const h = modalImage.offsetHeight;
  let tx = 0, ty = 0;
  if (modalRotation === 90) { tx = h; }
  else if (modalRotation === 180) { tx = w; ty = h; }
  else if (modalRotation === 270) { ty = w; }
  imageRotator.style.transform = `translate(${tx}px, ${ty}px) rotate(${modalRotation}deg)`;
}

// ============================================================
//  Edit modal
// ============================================================
function openEditModal(taskId) {
  const task = queue.find(t => t.id === taskId);
  if (!task || !task.json) return;

  editingTaskId = taskId;
  editingDraft = JSON.parse(JSON.stringify(task.json));

  modalTitle.textContent = `Edit: ${task.file.name}`;
  modalFileLabel.textContent = buildFilePathForTask(task);

  zoomState.scale = 1; zoomState.naturalW = 0; zoomState.naturalH = 0; zoomState.fitMode = null;
  modalRotation = 0;
  zoomLabel.textContent = '100%';
  if (imageRotator) imageRotator.style.transform = 'none';

  modalImage.onload = () => {
    zoomState.naturalW = modalImage.naturalWidth;
    zoomState.naturalH = modalImage.naturalHeight;
    applyZoom();
    setTimeout(zoomFitWidth, 50);
  };
  modalImage.src = task.previewUrl || task.resizedDataUrl || '';

  renderEditFields(task);
  modalOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  modalOverlay.classList.remove('open');
  document.body.style.overflow = '';
  editingTaskId = null;
  editingDraft = null;
  zoomState.scale = 1; zoomState.naturalW = 0; zoomState.naturalH = 0; zoomState.fitMode = null;
  modalRotation = 0;
  if (imageRotator) imageRotator.style.transform = 'none';
}

function getFieldHint(path) {
  const rule = FORMAT_RULES[path];
  return rule ? rule.hint : '';
}

function renderEditFields(task) {
  modalFields.innerHTML = '';
  const sections = Object.keys(editingDraft);
  sections.forEach(section => {
    const sectionEl = document.createElement('div');
    sectionEl.style.marginBottom = '18px';
    const sectionTitle = document.createElement('div');
    sectionTitle.style.cssText = 'font-size:13px; font-weight:600; color:#333; margin-bottom:8px; padding-bottom:4px; border-bottom:1px solid #eee;';
    sectionTitle.textContent = section;
    sectionEl.appendChild(sectionTitle);

    const fields = editingDraft[section];
    if (!fields || typeof fields !== 'object') {
      sectionEl.appendChild(document.createTextNode(String(fields)));
      modalFields.appendChild(sectionEl);
      return;
    }

    Object.keys(fields).forEach(fieldKey => {
      const path = `${section}.${fieldKey}`;
      const originalValue = task.originalJson?.[section]?.[fieldKey];
      const currentValue = fields[fieldKey];

      const fieldEl = document.createElement('div');
      fieldEl.className = 'edit-field';
      fieldEl.dataset.path = path;

      const isSignature = section === 'signatures';
      const isTicketCategory = path === 'header.ticket_category';
      const hint = getFieldHint(path);

      const label = document.createElement('label');
      label.htmlFor = `edit-${path}`;
      label.title = path;
      label.innerHTML = escapeHtml(getDisplayHeader(path)) +
        (hint ? `<span class="field-hint">${escapeHtml(hint)}</span>` : '');
      fieldEl.appendChild(label);

      let input;
      if (isSignature) {
        input = document.createElement('select');
        ['Signed', 'Not Signed'].forEach(opt => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          if (String(currentValue) === opt) o.selected = true;
          input.appendChild(o);
        });
      } else if (isTicketCategory) {
        input = document.createElement('select');
        ['Process Scrap Parts', 'Supplier Claim Parts', 'Unknown'].forEach(opt => {
          const o = document.createElement('option');
          o.value = opt; o.textContent = opt;
          if (String(currentValue) === opt) o.selected = true;
          input.appendChild(o);
        });
      } else {
        const strVal = currentValue === null || currentValue === undefined ? '' : String(currentValue);
        if (strVal.length > 60) {
          input = document.createElement('textarea');
          input.rows = 2;
        } else {
          input = document.createElement('input');
          input.type = 'text';
        }
        input.value = strVal;
      }

      input.id = `edit-${path}`;
      input.dataset.path = path;
      input.addEventListener('input', onEditInput);
      input.addEventListener('change', onEditInput);
      fieldEl.appendChild(input);

      if (path === 'section_1.cantidad') {
        const cantMsg = validateCantidad(currentValue);
        if (cantMsg) {
          const warn = document.createElement('div');
          warn.style.cssText = 'font-size: 11px; color: #997404; margin-top: 4px; font-weight: 600;';
          warn.textContent = '⚠️ ' + cantMsg;
          fieldEl.appendChild(warn);
        }
      }

      if (originalValue !== undefined && originalValue !== null &&
          String(originalValue) !== String(currentValue)) {
        const orig = document.createElement('div');
        orig.className = 'original-value';
        orig.textContent = `AI original: ${originalValue === '' ? '(empty)' : originalValue}`;
        fieldEl.appendChild(orig);
      }

      if (String(originalValue ?? '') !== String(currentValue ?? '')) {
        fieldEl.classList.add('changed');
      }

      sectionEl.appendChild(fieldEl);
    });

    modalFields.appendChild(sectionEl);
  });
}

function onEditInput(e) {
  const input = e.target;
  const path = input.dataset.path;
  if (!path || !editingDraft) return;
  const [section, fieldKey] = path.split('.');
  if (!editingDraft[section]) return;

  let newVal = input.value;
  if (newVal === '') newVal = null;
  editingDraft[section][fieldKey] = newVal;

  const fieldEl = input.closest('.edit-field');
  const task = queue.find(t => t.id === editingTaskId);
  const orig = task?.originalJson?.[section]?.[fieldKey];
  const origStr = orig === null || orig === undefined ? '' : String(orig);
  const newStr = newVal === null ? '' : String(newVal);

  if (origStr !== newStr) fieldEl.classList.add('changed');
  else fieldEl.classList.remove('changed');

  const note = fieldEl.querySelector('.original-value');
  if (note) {
    if (origStr !== newStr) note.textContent = `AI original: ${origStr === '' ? '(empty)' : origStr}`;
    else note.remove();
  } else if (origStr !== newStr) {
    const div = document.createElement('div');
    div.className = 'original-value';
    div.textContent = `AI original: ${origStr === '' ? '(empty)' : origStr}`;
    fieldEl.appendChild(div);
  }
}

function onModalSave() {
  if (editingTaskId === null || !editingDraft) return;
  const task = queue.find(t => t.id === editingTaskId);
  if (!task) return;

  const orig = JSON.stringify(task.originalJson || {});
  const curr = JSON.stringify(editingDraft || {});
  task.json = editingDraft;
  task.edited = orig !== curr;

  if (task.edited) recordCorrectionsFromEdit(task.originalJson, editingDraft);

  closeEditModal();
  renderQueue();

  const successTasks = queue.filter(t => t.status === 'success' && t.json);
  if (successTasks.length) renderResultTable(successTasks);

  showStatus(`💾 Saved edits for ${task.file.name}${task.edited ? ' (marked as edited)' : ''}.`, 'success');
  if (document.getElementById('correctionPanel')?.style.display === 'block') {
    renderCorrectionLibrary();
  }
}

function onModalReset() {
  if (editingTaskId === null) return;
  const task = queue.find(t => t.id === editingTaskId);
  if (!task || !task.originalJson) return;
  editingDraft = JSON.parse(JSON.stringify(task.originalJson));
  renderEditFields(task);
}

// ============================================================
//  Excel export
// ============================================================
function onDownloadExcel() {
  const successTasks = queue.filter(t => t.status === 'success' && t.json);
  if (!successTasks.length) { showStatus('No successful results to export.', 'error'); return; }

  const wb = XLSX.utils.book_new();

  const rows = successTasks.map(t => {
    const flat = flattenJson(t.json);
    HIDDEN_FIELDS.forEach(f => { delete flat[f]; });
    return { _file: buildFilePathForTask(t), ...flat };
  });

  const headerSet = new Set(['_file']);
  rows.forEach(r => Object.keys(r).forEach(k => {
    if (HIDDEN_FIELDS.includes(k)) return;
    headerSet.add(k);
  }));
  const headers = Array.from(headerSet);

  const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  const wsMain = XLSX.utils.aoa_to_sheet(aoa);
  wsMain['!cols'] = headers.map(h => ({ wch: h === '_file' ? 40 : 22 }));
  XLSX.utils.book_append_sheet(wb, wsMain, 'EBRO Merged');

  const { keyStats, statuses } = buildKeyParameterSummary(successTasks);
  const erHeader = ['#', 'Status', 'Judgement Reason', ...headers];
  const erRows = successTasks.map((t, i) => {
    const flat = flattenJson(t.json);
    const statusInfo = statuses[t.id] || { level: 'green', reasons: [] };
    const statusLetter = { green: 'GREEN', yellow: 'YELLOW', red: 'RED' }[statusInfo.level] || 'GREEN';
    const reasonText = statusInfo.reasons.length ? statusInfo.reasons.join(' | ') : 'All fields present and valid';
    return [i + 1, statusLetter, reasonText, ...headers.map(h => flat[h] ?? '')];
  });

  const wsER = XLSX.utils.aoa_to_sheet([erHeader, ...erRows]);
  wsER['!cols'] = [{ wch: 5 }, { wch: 10 }, { wch: 60 }, ...headers.map(h => ({ wch: h === '_file' ? 40 : 22 }))];
  XLSX.utils.book_append_sheet(wb, wsER, 'Extraction Results');

  const quality = computeQualityScore(successTasks);
  const psAoa = [
    ['Data Quality Audit'], [],
    ['Overall Quality Score', `${quality.score.toFixed(1)}%`],
    ['Key Parameters Present', `${quality.keyPresent} / ${quality.keyTotal}`],
    ['Other Fields Present', `${quality.otherPresent} / ${quality.otherTotal}`],
    ['Total Forms Processed', successTasks.length], [],
    ['Key Parameter', 'Missing Count', 'Present Count', 'Total Forms', 'Status']
  ];

  KEY_PARAMETERS.forEach(kp => {
    const stat = keyStats[kp.path];
    const present = stat.total - stat.missingCount;
    let status = 'COMPLETE';
    if (stat.missingCount > 0) status = stat.missingCount === stat.total ? 'ALL MISSING' : 'PARTIAL';
    psAoa.push([kp.label, stat.missingCount, present, stat.total, status]);
  });

  const wsPS = XLSX.utils.aoa_to_sheet(psAoa);
  wsPS['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsPS, 'Parameter Summary');

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `ebro-batch-${timestamp}.xlsx`);

  const editedCount = successTasks.filter(t => t.edited).length;
  showStatus(`📊 Exported ${rows.length} row(s) across 3 sheets` +
    (editedCount ? ` (${editedCount} with manual edits).` : '.'), 'success');
}

function onDownloadErrorList() {
  const failedTasks = queue.filter(t => t.status === 'error');
  if (!failedTasks.length) { showStatus('No error files to export.', 'error'); return; }

  const wb = XLSX.utils.book_new();
  const rows = failedTasks.map((t, i) => {
    const flat = t.json ? flattenJson(t.json) : {};
    return {
      '#': i + 1,
      _file: buildFilePathForTask(t),
      _error: t.error || 'Unknown error',
      _invalidImage: t.invalidImage ? 'YES' : 'no',
      _sizeOriginalKB: t.resizeInfo?.originalKB ?? '',
      _sizeResizedKB: t.resizeInfo?.resizedKB ?? '',
      _status: t.status,
      _movedTo: t.movedTo || '',
      ...flat
    };
  });

  const fixedCols = ['#', '_file', '_error', '_invalidImage', '_sizeOriginalKB', '_sizeResizedKB', '_status', '_movedTo'];
  const extraCols = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => { if (!fixedCols.includes(k)) extraCols.add(k); }));
  const headers = [...fixedCols, ...Array.from(extraCols)];
  const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(h => ({ wch: h === '_file' || h === '_error' ? 50 : 18 }));
  XLSX.utils.book_append_sheet(wb, ws, 'Error Files');

  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `ebro-errors-${timestamp}.xlsx`);
  showStatus(`📊 Exported ${rows.length} error row(s).`, 'success');
}

// ============================================================
//  Scrap Submission
// ============================================================
function downloadScrapTemplate() {
  const exampleRow = {
    material_code: '555001255AA',
    quantity: 1,
    area: 'Warehouse',
    location: 'M1M3',
    impact_type: 'Material',
    comments: '',
    date: ''
  };

  const aoa = [
    SCRAP_TEMPLATE_COLUMNS,
    SCRAP_TEMPLATE_COLUMNS.map(c => exampleRow[c])
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 20 }, { wch: 10 }, { wch: 15 }, { wch: 15 },
    { wch: 12 }, { wch: 30 }, { wch: 12 }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Scrap Submission');
  XLSX.writeFile(wb, 'ebro-scrap-template.xlsx');
  showScrapStatus('📥 Template downloaded.', 'success');
}

async function handleScrapUpload(file) {
  try {
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(ws, { defval: '' });

    if (!json.length) {
      showScrapStatus('⚠️ The uploaded file is empty.', 'error');
      return;
    }

    scrapRows = json.map((row, i) => ({
      _rowNum: i + 1,
      material_code: String(row.material_code ?? '').trim(),
      quantity: String(row.quantity ?? '').trim(),
      area: String(row.area ?? '').trim(),
      location: String(row.location ?? '').trim(),
      impact_type: String(row.impact_type ?? '').trim() || 'Material',
      comments: String(row.comments ?? '').trim(),
      date: String(row.date ?? '').trim()
    }));

    scrapFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
    saveFilterState('scrap', scrapFilters);

    renderScrapTable();
    if (scrapPanel) scrapPanel.style.display = 'block';
    showScrapStatus(`✅ Loaded ${scrapRows.length} row(s) from ${file.name}.`, 'success');
  } catch (err) {
    console.error(err);
    showScrapStatus('❌ Failed to read file: ' + err.message, 'error');
  }
}

function showScrapStatus(msg, type = '') {
  if (!scrapStatus) return;
  scrapStatus.textContent = msg;
  scrapStatus.className = 'status ' + type;
}

function renderScrapTable() {
  if (!scrapTable) return;
  const filtered = applyTableFilter(scrapRows, scrapFilters, SCRAP_TEMPLATE_COLUMNS);

  const thead = document.createElement('thead');
  const headTr = document.createElement('tr');

  const numTh = document.createElement('th');
  numTh.textContent = '#';
  numTh.style.cursor = 'default';
  headTr.appendChild(numTh);

  SCRAP_TEMPLATE_COLUMNS.forEach(col => {
    const th = document.createElement('th');
    th.dataset.column = col;
    th.classList.add('sortable');
    if (scrapFilters.sort.column === col) {
      th.classList.add(scrapFilters.sort.direction === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
    th.innerHTML = `${escapeHtml(col)} <span class="sort-indicator"></span>`;
    th.addEventListener('click', () => {
      if (scrapFilters.sort.column === col) {
        scrapFilters.sort.direction = scrapFilters.sort.direction === 'asc' ? 'desc' : 'asc';
      } else {
        scrapFilters.sort.column = col;
        scrapFilters.sort.direction = 'asc';
      }
      saveFilterState('scrap', scrapFilters);
      renderScrapTable();
    });
    headTr.appendChild(th);
  });
  thead.appendChild(headTr);

  const tbody = document.createElement('tbody');
  filtered.forEach(row => {
    const tr = document.createElement('tr');
    if (row.impact_type.toLowerCase() === 'vehicle') tr.classList.add('scrap-row-vehicle');
    const numTd = document.createElement('td');
    numTd.textContent = row._rowNum;
    tr.appendChild(numTd);
    SCRAP_TEMPLATE_COLUMNS.forEach(col => {
      const td = document.createElement('td');
      td.textContent = row[col] ?? '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  scrapTable.innerHTML = '';
  scrapTable.appendChild(thead);
  scrapTable.appendChild(tbody);

  renderScrapFilterBar();
}

function renderScrapFilterBar() {
  if (!scrapFilterBar) return;
  scrapFilterBar.innerHTML = '';

  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'filter-search';
  search.placeholder = '🔍 Search all columns...';
  search.value = scrapFilters.search || '';
  search.addEventListener('input', () => {
    scrapFilters.search = search.value;
    saveFilterState('scrap', scrapFilters);
    renderScrapTable();
  });
  scrapFilterBar.appendChild(search);

  SCRAP_TEMPLATE_COLUMNS.forEach(col => {
    const values = Array.from(new Set(scrapRows.map(r => String(r[col] ?? '').trim()))).sort();
    if (values.length < 2) return;
    const btn = document.createElement('button');
    btn.className = 'filter-select';
    btn.textContent = `${col} ▾`;
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openColumnFilterDropdown(btn, col, values, 'scrap');
    });
    scrapFilterBar.appendChild(btn);
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'filter-clear-btn';
  clearBtn.textContent = '↻ Reset';
  clearBtn.addEventListener('click', () => {
    scrapFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
    saveFilterState('scrap', scrapFilters);
    renderScrapTable();
  });
  scrapFilterBar.appendChild(clearBtn);
}

function exportFilteredScrap() {
  if (!scrapRows.length) { showScrapStatus('⚠️ No rows to export.', 'error'); return; }
  const filtered = applyTableFilter(scrapRows, scrapFilters, SCRAP_TEMPLATE_COLUMNS);

  const aoa = [
    SCRAP_TEMPLATE_COLUMNS,
    ...filtered.map(r => SCRAP_TEMPLATE_COLUMNS.map(c => r[c] ?? ''))
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = SCRAP_TEMPLATE_COLUMNS.map(() => ({ wch: 20 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Filtered Scrap');
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  XLSX.writeFile(wb, `ebro-scrap-filtered-${timestamp}.xlsx`);

  showScrapStatus(`📊 Exported ${filtered.length} filtered row(s).`, 'success');
}

function clearScrap() {
  scrapRows = [];
  scrapFilters = { search: '', columns: {}, sort: { column: null, direction: 'asc' } };
  saveFilterState('scrap', scrapFilters);
  if (scrapPanel) scrapPanel.style.display = 'none';
  if (scrapTable) scrapTable.innerHTML = '';
  showScrapStatus('Cleared.', '');
}

// ============================================================
//  Input Method switching
// ============================================================
function applyInputMethod(method) {
  inputMethod = method;
  localStorage.setItem(INPUT_METHOD_STORAGE, method);
  imsFolderBtn.classList.toggle('active', method === 'folder');
  imsUploadBtn.classList.toggle('active', method === 'upload');
  localModePanel.style.display = method === 'folder' ? 'block' : 'none';
  uploadPanel.style.display = method === 'upload' ? 'block' : 'none';
  if (method === 'upload') {
    localStatus.textContent = '';
    localStatus.className = 'local-status';
  } else {
    updateLocalStatusFromHandles();
  }
  updateLocalModeButtons();
  updateButtonState();
}

function updateLocalStatusFromHandles() {
  if (inputMethod !== 'folder') return;
  const hasInput = !!localHandles.input;
  const hasReaded = !!localHandles.readed;
  const hasError = !!localHandles.error;
  if (hasInput && hasReaded && hasError) {
    localStatus.textContent = '✅ All folders authorized';
    localStatus.className = 'local-status connected';
  } else if (hasInput) {
    localStatus.textContent = `⚠️ ${hasReaded ? '' : 'readed '}${hasError ? '' : 'error '}folder(s) missing`;
    localStatus.className = 'local-status error';
  } else {
    localStatus.textContent = 'Not authorized';
    localStatus.className = 'local-status';
  }
}

function switchInputMethod(method) {
  if (method === inputMethod) return;
  applyInputMethod(method);
}

function updateLocalModeButtons() {
  if (typeof window.showDirectoryPicker !== 'function') return;
  const hasInput = !!localHandles.input;
  const hasReaded = !!localHandles.readed;
  const hasError = !!localHandles.error;
  localLoadBtn.disabled = inputMethod !== 'folder' || !hasInput;
  localProcessBtn.disabled = inputMethod !== 'folder' || !hasReaded || !hasError || queue.length === 0;
}

// ============================================================
//  Local Folder Mode
// ============================================================
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_HANDLE_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('handles'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function verifyHandlePermission(handle) {
  if (!handle) return false;
  const opts = { mode: 'readwrite' };
  if (await handle.queryPermission(opts) === 'granted') return true;
  if (await handle.requestPermission(opts) === 'granted') return true;
  return false;
}

async function restoreLocalHandles() {
  if (typeof window.showDirectoryPicker !== 'function') return;
  for (const key of ['input', 'readed', 'error']) {
    try {
      const handle = await idbGet(key);
      if (handle) {
        localHandles[key] = handle;
        updateLocalFolderLabel(key, handle.name, false);
      }
    } catch (e) {
      console.warn('Failed to restore handle', key, e);
    }
  }
  updateLocalModeButtons();
  updateLocalStatusFromHandles();
}

async function pickLocalFolder(key) {
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    localHandles[key] = handle;
    await idbSet(key, handle);
    updateLocalFolderLabel(key, handle.name, true);
    updateLocalModeButtons();
    updateLocalStatusFromHandles();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('pickLocalFolder error:', err);
    localStatus.textContent = `❌ ${err.message}`;
    localStatus.className = 'local-status error';
  }
}

function updateLocalFolderLabel(key, name, authorized) {
  const labelMap = { input: localInputLabel, readed: localReadedLabel, error: localErrorLabel };
  const btnMap = { input: localPickInputBtn, readed: localPickReadedBtn, error: localPickErrorBtn };
  labelMap[key].value = name || '';
  if (authorized) btnMap[key].classList.add('authorized');
}

async function loadLocalFiles() {
  if (!localHandles.input) {
    localStatus.textContent = '❌ Please select the input folder first.';
    localStatus.className = 'local-status error';
    return;
  }

  try {
    const ok = await verifyHandlePermission(localHandles.input);
    if (!ok) {
      localStatus.textContent = '❌ Permission denied for input folder.';
      localStatus.className = 'local-status error';
      return;
    }

    localStatus.textContent = 'Reading folder...';
    localStatus.className = 'local-status';

    const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif'];
    const files = [];

    for await (const [name, handle] of localHandles.input.entries()) {
      if (handle.kind !== 'file') continue;
      const lower = name.toLowerCase();
      if (!imageExts.some(ext => lower.endsWith(ext))) continue;
      const file = await handle.getFile();
      files.push({ name, handle, file, size: file.size, mtime: file.lastModified });
    }

    if (!files.length) {
      localStatus.textContent = '⚠️ No image files found in the input folder.';
      localStatus.className = 'local-status error';
      return;
    }

    queue = [];
    idCounter = 0;

    const apiKey = apiKeyInput.value.trim();
    const platform = getCurrentPlatform();
    if (apiKey && autoProcessEnabled && !_consumerRunning) {
      _producerActive = true;
      startConsumer(apiKey, platform);
    } else {
      _producerActive = true;
    }

    const total = files.length;
    let current = 0;

    for (const f of files) {
      current++;
      showCompressProgress(current, total, f.name);
      const normalizedFile = await normalizeImageFormat(f.file);

      const task = {
        id: ++idCounter,
        file: normalizedFile,
        previewUrl: null,
        status: 'waiting',
        json: null,
        originalJson: null,
        edited: false,
        error: null,
        localHandle: f.handle,
        localName: f.name,
        resizedBlob: null,
        resizedDataUrl: null,
        resizeInfo: null
      };

      try {
        const resized = await resizeImage(normalizedFile);
        task.resizedBlob = resized.blob;
        task.resizedDataUrl = resized.dataUrl;
        task.resizeInfo = {
          original: `${resized.originalWidth}×${resized.originalHeight}`,
          resized: `${resized.width}×${resized.height}`,
          originalKB: Math.round(resized.originalSize / 1024),
          resizedKB: Math.round(resized.resizedSize / 1024),
        };
        task.previewUrl = resized.dataUrl;
      } catch (err) {
        console.error('Resize failed:', f.name, err);
        task.previewUrl = await fileToDataUrl(normalizedFile);
        task.resizeInfo = { error: 'Resize failed, using original' };
      }

      queue.push(task);
      renderQueueThrottled();
      updateButtonState();
      await new Promise(r => setTimeout(r, 0));
    }

    _producerActive = false;
    hideCompressProgress();
    renderQueue();
    updateButtonState();
    updateLocalModeButtons();

    const totalOrigKB = queue.filter(t => t.resizeInfo && t.resizeInfo.originalKB)
      .reduce((s, t) => s + t.resizeInfo.originalKB, 0);
    const totalNewKB = queue.filter(t => t.resizeInfo && t.resizeInfo.resizedKB)
      .reduce((s, t) => s + t.resizeInfo.resizedKB, 0);

    localStatus.textContent =
      `✅ Loaded ${queue.length} image(s) from "${localHandles.input.name}" · ` +
      `${totalOrigKB} KB → ${totalNewKB} KB`;
    localStatus.className = 'local-status connected';

  } catch (err) {
    console.error('loadLocalFiles error:', err);
    localStatus.textContent = `❌ ${err.message}`;
    localStatus.className = 'local-status error';
    _producerActive = false;
  }
}

async function processLocalBatch() {
  if (_consumerRunning) { showStatus('Processing is already running.', 'warning'); return; }
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) { showStatus('Please enter your API Key first.', 'error'); return; }
  if (!localHandles.readed || !localHandles.error) {
    showStatus('Please select both readed and error folders first.', 'error'); return;
  }

  const hasPending = queue.some(t => t.status === 'waiting');
  if (!hasPending) { showStatus('No pending files to process.', 'error'); return; }

  const okReaded = await verifyHandlePermission(localHandles.readed);
  const okError = await verifyHandlePermission(localHandles.error);
  if (!okReaded || !okError) {
    showStatus('Permission denied for target folders. Please re-select them.', 'error'); return;
  }

  const platform = getCurrentPlatform();
  _producerActive = false;
  startConsumer(apiKey, platform);
}

async function moveLocalFile(task, targetDirHandle) {
  if (!task.localHandle || !task.localName) throw new Error('Missing local handle or name');

  const originalName = task.localName;
  const dot = originalName.lastIndexOf('.');
  const base = dot > 0 ? originalName.slice(0, dot) : originalName;
  let finalName = `${base}.jpg`;

  let attempts = 0;
  while (attempts < 3) {
    try {
      await targetDirHandle.getFileHandle(finalName, { create: false });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      finalName = `${base}_${ts}.jpg`;
      attempts++;
    } catch (e) { break; }
  }

  let sourceBlob;
  if (task.resizedBlob) {
    sourceBlob = task.resizedBlob;
  } else {
    const sourceFile = await task.localHandle.getFile();
    sourceBlob = sourceFile;
    console.warn(`[move] No resized blob for ${originalName}, falling back to original file`);
  }

  const destHandle = await targetDirHandle.getFileHandle(finalName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(sourceBlob);
  await writable.close();

  try {
    await task.localHandle.remove();
  } catch (removeErr) {
    console.warn(`[move] Could not delete original ${originalName}:`, removeErr);
  }

  console.log(`[move] Saved ${finalName} (${Math.round(sourceBlob.size / 1024)} KB)`);
  return finalName;
}

async function pullFileBackFromFolder(sourceDirHandle, targetDirHandle, fileName) {
  if (!sourceDirHandle || !targetDirHandle || !fileName) throw new Error('Missing arguments');

  const sourceFileHandle = await sourceDirHandle.getFileHandle(fileName, { create: false });
  let finalName = fileName;
  let attempts = 0;
  while (attempts < 3) {
    try {
      await targetDirHandle.getFileHandle(finalName, { create: false });
      const dot = finalName.lastIndexOf('.');
      const base = dot > 0 ? finalName.slice(0, dot) : finalName;
      const ext = dot > 0 ? finalName.slice(dot) : '';
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      finalName = `${base}_${ts}${ext}`;
      attempts++;
    } catch (e) { break; }
  }

  const srcFile = await sourceFileHandle.getFile();
  const destHandle = await targetDirHandle.getFileHandle(finalName, { create: true });
  const writable = await destHandle.createWritable();
  await writable.write(srcFile);
  await writable.close();

  await sourceDirHandle.removeEntry(fileName);
  return { handle: destHandle, name: finalName };
}

// ============================================================
//  Validation helpers
// ============================================================
function validateCantidad(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === '') return null;
  if (!/^[0-9]+$/.test(s)) return null;
  const n = parseInt(s, 10);
  if (isNaN(n)) return null;
  if (n > 1) return `Quantity is ${n} — usually should be 1. Please verify.`;
  return null;
}

// ============================================================
//  Correction Library
// ============================================================
const CORRECTION_LIBRARY_KEY = 'correction_library';
const CORRECTION_MIN_COUNT = 2;

function loadCorrectionLibrary() {
  try {
    const raw = localStorage.getItem(CORRECTION_LIBRARY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveCorrectionLibrary(lib) {
  try { localStorage.setItem(CORRECTION_LIBRARY_KEY, JSON.stringify(lib)); }
  catch (e) { console.warn('[correction] Failed to save library:', e); }
}

function recordCorrection(path, aiValue, userValue) {
  const aiNorm = aiValue === null || aiValue === undefined ? null : String(aiValue).trim();
  const userNorm = userValue === null || userValue === undefined ? null : String(userValue).trim();
  if (aiNorm === userNorm) return;

  const lib = loadCorrectionLibrary();
  const existing = lib.find(r => r.path === path && r.aiValue === aiNorm && r.userValue === userNorm);

  if (existing) {
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
  } else {
    lib.push({ path, aiValue: aiNorm, userValue: userNorm, count: 1, lastSeen: new Date().toISOString() });
  }
  saveCorrectionLibrary(lib);
}

function recordCorrectionsFromEdit(originalJson, currentJson) {
  const origFlat = flattenJson(originalJson || {});
  const currFlat = flattenJson(currentJson || {});
  const allPaths = new Set([...Object.keys(origFlat), ...Object.keys(currFlat)]);

  allPaths.forEach(path => {
    if (path.startsWith('_')) return;
    const origVal = origFlat[path];
    const currVal = currFlat[path];
    const origStr = origVal === null || origVal === undefined || String(origVal).trim() === '' ? null : String(origVal).trim();
    const currStr = currVal === null || currVal === undefined || String(currVal).trim() === '' ? null : String(currVal).trim();
    if (origStr !== currStr) recordCorrection(path, origStr, currStr);
  });
}

function applyLearnedCorrections(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const lib = loadCorrectionLibrary();
  if (!lib.length) return parsed;

  let appliedCount = 0;
  const appliedLog = [];

  lib.forEach(record => {
    if (record.count < CORRECTION_MIN_COUNT) return;
    const [section, field] = record.path.split('.');
    if (!section || !field) return;
    if (!parsed[section] || typeof parsed[section] !== 'object') return;

    const currentValue = parsed[section][field];
    const currentNorm = currentValue === null || currentValue === undefined ? null : String(currentValue).trim();

    if (currentNorm === record.aiValue) {
      parsed[section][field] = record.userValue;
      appliedCount++;
      appliedLog.push(`${record.path}: "${record.aiValue}" → "${record.userValue}" (learned ${record.count}x)`);
    }
  });

  if (appliedCount > 0) {
    if (!parsed._autoCorrections) parsed._autoCorrections = [];
    parsed._autoCorrections.push(...appliedLog);
  }
  return parsed;
}

function showCorrectionLibrary() {
  const lib = loadCorrectionLibrary();
  if (!lib.length) { console.log('[correction] Library is empty'); return; }
  console.table(lib.map(r => ({
    path: r.path, aiValue: r.aiValue, userValue: r.userValue, count: r.count,
    active: r.count >= CORRECTION_MIN_COUNT ? 'YES' : 'no', lastSeen: r.lastSeen
  })));
}

function clearCorrectionLibrary() {
  localStorage.removeItem(CORRECTION_LIBRARY_KEY);
  console.log('[correction] Library cleared');
}

function deleteCorrection(path, aiValue, userValue) {
  const lib = loadCorrectionLibrary();
  const before = lib.length;
  const filtered = lib.filter(r => !(r.path === path && r.aiValue === aiValue && r.userValue === userValue));
  if (filtered.length < before) {
    saveCorrectionLibrary(filtered);
    console.log(`[correction] deleted: ${path} "${aiValue}" → "${userValue}"`);
    return true;
  }
  return false;
}

function renderCorrectionLibrary() {
  const list = document.getElementById('correctionList');
  if (!list) return;
  const lib = loadCorrectionLibrary();
  if (!lib.length) {
    list.innerHTML = '<p class="hint">No corrections recorded yet.</p>';
    return;
  }

  const sorted = [...lib].sort((a, b) => b.count - a.count);
  const html = sorted.map(r => {
    const active = r.count >= CORRECTION_MIN_COUNT;
    const badge = active
      ? '<span style="background:#d1e7dd;color:#0f5132;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">ACTIVE</span>'
      : '<span style="background:#fff3cd;color:#664d03;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">pending</span>';
    return `
      <div style="display:flex; align-items:center; gap:12px; padding:8px 10px; border:1px solid #eee; border-radius:6px; margin-bottom:6px; font-size:12px;">
        <span style="font-family: ui-monospace, monospace; color:#0b5ed7; min-width:220px;">${escapeHtml(r.path)}</span>
        <span style="color:#b02a37; text-decoration:line-through;">"${escapeHtml(r.aiValue ?? 'null')}"</span>
        <span style="color:#666;">→</span>
        <span style="color:#0f5132; font-weight:600;">"${escapeHtml(r.userValue ?? 'null')}"</span>
        <span style="margin-left:auto; color:#666;">×${r.count}</span>
        ${badge}
        <button class="correction-delete-btn" data-path="${escapeHtml(r.path)}" data-ai="${escapeHtml(r.aiValue ?? '')}" data-user="${escapeHtml(r.userValue ?? '')}" style="background:#dc3545; color:#fff; border:none; border-radius:4px; padding:3px 8px; font-size:11px; cursor:pointer;">✕</button>
      </div>`;
  }).join('');

  list.innerHTML = html;
  list.querySelectorAll('.correction-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const path = btn.dataset.path;
      const ai = btn.dataset.ai || null;
      const user = btn.dataset.user || null;
      if (!confirm(`Delete this correction?\n\n${path}\n"${ai}" → "${user}"`)) return;
      deleteCorrection(path, ai, user);
      renderCorrectionLibrary();
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleCorrectionsBtn');
  const clearBtn = document.getElementById('clearCorrectionsBtn');
  const panel = document.getElementById('correctionPanel');

  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', () => {
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
      if (!visible) renderCorrectionLibrary();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (!confirm('Clear the entire correction library?')) return;
      clearCorrectionLibrary();
      renderCorrectionLibrary();
    });
  }
});

window.showCorrectionLibrary = showCorrectionLibrary;
window.clearCorrectionLibrary = clearCorrectionLibrary;
window.deleteCorrection = deleteCorrection;
