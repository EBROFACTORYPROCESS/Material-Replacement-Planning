/* =========================================================
   MRP Planner v1.5
   ========================================================= */
const STATE = {
  config: null,
  boms: [],
  batches: [],
  inventory: {},
  partIndex: {},
  scrap: [],
  plan: [],
  batchView: { sorts: {}, filters: {} },
  bomRegistry: new Map(),   // "specKey||color||signature" → "BOM N"
  bomCounter:  new Map(),    // "specKey||color"            → N
  production: {
    records: [],
    batches: new Map(),
    header: null,
    loaded: false,
    period:        { from: '', to: '' },
    pendingPeriod: { from: '', to: '' },
    periodStage:        '',   // '' = any milestone  ← ADD
    pendingPeriodStage: '',   // ← ADD 
    lines:         null,   // Set of selected lines, or null = all
    pendingLines:  null,
    models:        null,   // Set of selected models, or null = all
    pendingModels: null,
    batchView: { search: '', filter: 'all' },
    vinView:   { page: 1, pageSize: 100, search: '', stage: 'all' }
  }
};

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (n==null||isNaN(n)) ? '' : Number(n).toLocaleString(undefined,{maximumFractionDigits:3});
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const LS_CONFIG = 'mrp.configOverrides.v1';
const LS_SCRAP  = 'mrp.scrap.v2';

/* ---------------- BOM key helpers ---------------- */
function bomKeyOf(bom) {
  if (!bom) return '';
  return (bom.vehicleMatNo || '') + '||' + (bom.batchId || '');
}
function bomDisplayName(bom) {
  if (!bom) return '';
  const parts = [];
  if (bom.vehicleDesc) parts.push(bom.vehicleDesc);
  if (bom.batchId)     parts.push(bom.batchId);
  return parts.join(' — ') || bom.vehicleMatNo || 'BOM';
}

/* ---------------- Colour / spec helpers ---------------- */
function colorCodeOf(vehicleMatNo) {
  const v = (vehicleMatNo || '').trim();
  if (v.length < 9) return '';
  return v.substring(7, 9);          // chars 8–9, 1-based
}
function specKeyOf(vehicleMatNo) {
  const v = (vehicleMatNo || '').trim();
  if (v.length < 9) return v || '__no_matno__';
  return v.substring(0, 7) + '··' + v.substring(9);
}
function longestCommonPrefix(strs) {
  if (!strs.length) return '';
  let p = strs[0];
  for (const s of strs) {
    while (p && !s.startsWith(p)) p = p.slice(0, -1);
    if (!p) break;
  }
  return p;
}
function deriveSpecName(boms) {
  if (boms.length === 1) return boms[0].vehicleDesc || boms[0].vehicleMatNo || '—';
  const descs = boms.map(b => b.vehicleDesc || '').filter(Boolean);
  if (!descs.length) return boms[0].vehicleMatNo || '—';
  const lcp = longestCommonPrefix(descs)
    .replace(/[\s\-–—:_,]+$/, '').trim();
  return lcp || boms[0].vehicleMatNo || '—';
}
function deriveColorName(boms, specName) {
  const desc = boms[0].vehicleDesc || '';
  if (!desc) return '';
  if (specName && desc.startsWith(specName)) {
    const rest = desc.slice(specName.length)
      .replace(/^[\s\-–—:_,]+/, '').trim();
    if (rest && rest !== desc) return rest;
  }
  return '';
}
function colorBadgeStyle(code) {
  if (!code) return 'background:#f1f5f9;color:#64748b';
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `background:hsl(${hue},70%,92%);color:hsl(${hue},65%,32%)`;
}

/* ---------------- BOM-ID assignment (scoped per spec + colour) ---------------- */
function bomSignature(bom) {
  if (!bom || !bom.parts) return '';
  return bom.parts
    .slice()
    .sort((a, b) => {
      const p = String(a.partNo).localeCompare(String(b.partNo));
      if (p) return p;
      const q = (Number(a.qty) || 0) - (Number(b.qty) || 0);
      if (q) return q;
      return String(a.uom || '').localeCompare(String(b.uom || ''));
    })
    .map(p => `${p.partNo}|${Number(p.qty) || 0}|${(p.uom || '').trim()}`)
    .join(';');
}

function bomGroupKey(bom) {
  const spec = specKeyOf(bom.vehicleMatNo);
  const cc   = colorCodeOf(bom.vehicleMatNo);
  return spec + '||' + cc;
}

function assignBomId(bom) {
  if (!(STATE.bomRegistry instanceof Map)) STATE.bomRegistry = new Map();
  if (!(STATE.bomCounter  instanceof Map)) STATE.bomCounter  = new Map();

  const groupKey = bomGroupKey(bom);
  const sigKey   = groupKey + '||' + bomSignature(bom);

  if (STATE.bomRegistry.has(sigKey)) {
    bom.bomId = STATE.bomRegistry.get(sigKey);
  } else {
    const n = (STATE.bomCounter.get(groupKey) || 0) + 1;
    STATE.bomCounter.set(groupKey, n);
    bom.bomId = 'BOM ' + n;
    STATE.bomRegistry.set(sigKey, bom.bomId);
  }
  return bom.bomId;
}

/* Material List rows with their Where Used panel expanded */
const WHERE_USED_OPEN = new Set();
/* Production batches with their VIN detail panel expanded */
const PROD_BATCH_EXPANDED = new Set();
/* Batch table column definitions */
const BATCH_COLS = [
  { id:'batch',      label:'Batch' },
  { id:'model',      label:'Model' },
  { id:'color',      label:'Color' },
  { id:'qty',        label:'Qty', num:true, sortable:true },
  { id:'ship',       label:'Ship' },
  { id:'arrival',    label:'Arrival',   date:true },
  { id:'decanting',  label:'Decanting', date:true },
  { id:'trimIn',     label:'Trim-in',   date:true },
  { id:'production', label:'Production' },
  { id:'stage',      label:'Stage' },
  { id:'warehouse',  label:'Warehouse' },
  { id:'linkedBom',  label:'Linked BOM' }
];

/* =========================================================
   BOOT
   ========================================================= */
window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  loadPersistedOverrides();
  loadPersistedScrap();
  bindTabs();
  bindUploads();
  bindButtons();
  bindProduction();
  bindBomDisplayModal();
  bindFilterPopupGlobal();
  renderConversionTable();
  renderWarehouseEditor();
  renderWarehouseChecklist();
  renderScrapList();
  $('#todayBadge').textContent = new Date().toLocaleDateString();
  $('#c_safety').value          = STATE.config.shortageDefaults.safetyFactor;
  $('#c_factoryFloor').checked  = STATE.config.shortageDefaults.includeFactoryFloor;
  $('#c_edgeLine').checked      = STATE.config.shortageDefaults.includeEdgeLine;
  $('#c_inTransit').checked     = STATE.config.shortageDefaults.includeInTransit;
});

async function loadConfig() {
  const defaults = {
    defaultWarehouseId: 'CY',
    autoAssignDefaultWarehouse: true,
    warehouses: [
      {id:'CY',  name:'Container Yard', enabled:true},
      {id:'WH2', name:'Warehouse 2',    enabled:true},
      {id:'WH3', name:'Warehouse 3',    enabled:true},
      {id:'WH4', name:'Warehouse 4',    enabled:true}
    ],
    stages: {
      inTransit:{label:'In Transit',color:'#3b82f6'},
      warehouse:{label:'Warehouse',color:'#8b5cf6'},
      factoryFloor:{label:'Factory Floor',color:'#f59e0b'},
      edgeLine:{label:'Edge Line',color:'#10b981'},
      consumed:{label:'Consumed',color:'#9ca3af'}
    },
    shortageDefaults:{safetyFactor:1.0,includeInTransit:false,includeWarehouses:true,includeFactoryFloor:true,includeEdgeLine:true},
    conversionTable: []
  };
  try {
    const res = await fetch('config.json');
    STATE.config = Object.assign({}, defaults, await res.json());
    for (const k of Object.keys(defaults)) if (!(k in STATE.config)) STATE.config[k] = defaults[k];
  } catch (e) {
    console.warn('config.json not loaded — using defaults', e);
    STATE.config = defaults;
  }
}

function loadPersistedOverrides() {
  try {
    const raw = localStorage.getItem(LS_CONFIG);
    if (!raw) return;
    const o = JSON.parse(raw);
    if (o.warehouses) STATE.config.warehouses = o.warehouses;
    if (o.conversionTable) STATE.config.conversionTable = o.conversionTable;
  } catch(e){}
}
function savePersistedOverrides() {
  try {
    localStorage.setItem(LS_CONFIG, JSON.stringify({
      warehouses: STATE.config.warehouses,
      conversionTable: STATE.config.conversionTable
    }));
  } catch(e){}
}
function loadPersistedScrap() {
  try {
    const raw = localStorage.getItem(LS_SCRAP);
    if (raw) STATE.scrap = JSON.parse(raw) || [];
  } catch(e){ STATE.scrap = []; }
}
function savePersistedScrap() {
  try { localStorage.setItem(LS_SCRAP, JSON.stringify(STATE.scrap)); } catch(e){}
}

/* =========================================================
   TABS
   ========================================================= */
function bindTabs() {
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.remove('active'));
    $$('.tab-panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('#panel-' + t.dataset.tab).classList.add('active');
  }));
}

/* =========================================================
   UPLOADS
   ========================================================= */
function bindUploads() {
  wireDropzone('#bomDrop',   '#bomInput',   handleBomFiles);
  wireDropzone('#batchDrop', '#batchInput', handleBatchFiles);
}
function wireDropzone(dzSel, inputSel, handler) {
  const dz = $(dzSel), input = $(inputSel);
  if (!dz || !input) return;
  input.addEventListener('change', e => handler(Array.from(e.target.files)));
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', e => handler(Array.from(e.dataTransfer.files)));
}
function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}
function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    r.readAsText(file);
  });
}
async function fileToRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await readFileAsText(file);
    return parseCSV(text);
  }
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws  = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
/* Return every sheet of a workbook as { name, rows }.
   CSV files yield one pseudo-sheet named '(csv)'. */
async function fileToSheetRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv')) {
    const text = await readFileAsText(file);
    return [{ name: '(csv)', rows: parseCSV(text) }];
  }
  const buf = await readFileAsArrayBuffer(file);
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true });
  return wb.SheetNames.map(sn => ({
    name: sn,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' })
  }));
}

/* Backwards-compat single-sheet reader (BOM folder loader + scrap file). */
async function fileToRows(file) {
  const sheets = await fileToSheetRows(file);
  return sheets[0] ? sheets[0].rows : [];
}

/* Modal prompt. Resolves with an array of selected { name, rows }
   or null if the user cancelled. */
function promptSheetSelection(sheets, fileName) {
  return new Promise(resolve => {
    const modal = $('#sheetPickerModal');
    if (!modal) { resolve(sheets); return; }          // graceful fallback

    $('#sheetPickerFile').textContent = fileName;
    const list = $('#sheetPickerList');
    list.innerHTML = sheets.map((s, i) => `
      <label class="sheet-pick-item">
        <input type="checkbox" data-i="${i}" checked />
        <span class="sheet-name">${escapeHtml(s.name)}</span>
        <span class="sheet-dims">${s.rows.length} row${s.rows.length === 1 ? '' : 's'}</span>
      </label>`).join('');

    const cleanup = () => {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
      $('#sheetPickerConfirm').onclick = null;
      $('#sheetPickerClose').onclick   = null;
      $('#sheetPickerAll').onclick     = null;
      $('#sheetPickerNone').onclick    = null;
      modal.onclick = null;
    };

    $('#sheetPickerAll').onclick  = () => list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = true);
    $('#sheetPickerNone').onclick = () => list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.checked = false);

    $('#sheetPickerConfirm').onclick = () => {
      const picked = [];
      list.querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
        picked.push(sheets[+cb.dataset.i]);
      });
      if (!picked.length) { alert('Please select at least one sheet.'); return; }
      cleanup();
      resolve(picked);
    };

    $('#sheetPickerClose').onclick = () => { cleanup(); resolve(null); };
    modal.onclick = e => { if (e.target === modal) { cleanup(); resolve(null); } };

    document.addEventListener('keydown', function esc(ev) {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', esc);
        cleanup(); resolve(null);
      }
    });

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  });
}
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* =========================================================
   BOM FOLDER LOADER
   ========================================================= */
let _bomFolderHandle = null;
let _bomFolderFiles  = [];

function isBomFile(name) {
  return /\.(xlsx|xls|csv)$/i.test(name);
}
function yieldToUI() {
  return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function pickBomFolder() {
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      _bomFolderHandle = handle;
      $('#bomFolderPath').value = '/' + handle.name + '/';
      _bomFolderFiles = [];
      $('#bomFolderInfo').textContent = 'Scanning folder…';
      $('#bomFolderProcess').disabled = true;
      await walkDirectory(handle, '');
      updateFolderInfo();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('showDirectoryPicker failed, falling back', e);
    }
  }
  $('#bomFolderFallback').click();
}

async function walkDirectory(dirHandle, prefix) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      if (!isBomFile(entry.name)) continue;
      const file = await entry.getFile();
      _bomFolderFiles.push({ file, path: prefix + entry.name });
    } else if (entry.kind === 'directory') {
      if (entry.name.startsWith('.') || entry.name.startsWith('~')) continue;
      await walkDirectory(entry, prefix + entry.name + '/');
    }
  }
}

function updateFolderInfo() {
  const n = _bomFolderFiles.length;
  $('#bomFolderInfo').textContent = n
    ? `${n} BOM file${n===1?'':'s'} found — click “Process files”.`
    : 'No BOM files found in that folder.';
  $('#bomFolderProcess').disabled = n === 0;
}

async function processBomFolder() {
  const files = _bomFolderFiles;
  if (!files.length) return;

  // Deterministic order — first file becomes BOM 1
  files.sort((a, b) => a.path.localeCompare(b.path));

  const wrap   = $('#bomProgressWrap');
  const fill   = $('#bomProgressFill');
  const label  = $('#bomProgressLabel');
  const list   = $('#bomProgressList');
  const toggle = $('#bomProgressToggle');

  /* Show the panel; reset the summary + hide the file list & toggle */
  wrap.classList.remove('hidden');
  fill.style.width = '0%';
  label.textContent = 'Preparing…';
  list.classList.add('hidden');
  toggle.classList.add('hidden');
  toggle.textContent = '▸ Display batch list';

  list.innerHTML = files.map((f, i) => `
    <div class="progress-file" data-i="${i}">
      <span class="pf-status pending">◌</span>
      <span class="pf-name" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>
      <span class="pf-note">waiting…</span>
    </div>`).join('');

  let ok = 0, fail = 0;

  for (let i = 0; i < files.length; i++) {
    const { file, path } = files[i];
    const row = list.querySelector(`[data-i="${i}"]`);
    const st  = row.querySelector('.pf-status');
    const nt  = row.querySelector('.pf-note');

    st.className = 'pf-status working';
    st.textContent = '◐';
    nt.textContent = 'parsing…';
    row.classList.remove('fail-row');
    label.textContent = `Parsing ${i+1} / ${files.length} — ${path}`;
    await yieldToUI();

    try {
      const rows = await fileToRows(file);
      const parsedList = parseBOM(rows, path);
      if (!parsedList.length) throw new Error('no parts found');

      for (const parsed of parsedList) {
        const key = bomKeyOf(parsed);
        const existing = STATE.boms.findIndex(b => bomKeyOf(b) === key);
        if (existing >= 0) STATE.boms.splice(existing, 1);
        assignBomId(parsed);
        STATE.boms.push(parsed);
      }
      const partCount = parsedList.reduce((a, p) => a + p.parts.length, 0);

      st.className = 'pf-status done';
      st.textContent = '✓';
      nt.textContent = `${parsedList.length} BOM${parsedList.length===1?'':'s'}, ${partCount} parts`;
      ok++;
    } catch (e) {
      console.error(e);
      st.className = 'pf-status fail';
      st.textContent = '✕';
      nt.textContent = e.message || 'failed';
      row.classList.add('fail-row');
      fail++;
    }

    fill.style.width = (((i + 1) / files.length) * 100).toFixed(1) + '%';
    await yieldToUI();
  }

  /* Final summary — one line, with the toggle button */
  label.textContent = `Done — ${ok} succeeded, ${fail} failed`;
  toggle.classList.remove('hidden');
  if (fail > 0) toggle.classList.add('has-errors');

  rebuildPartIndex();
  renderBomList(); renderBomTable(); populatePlanModels(); populatePartDatalist();
  renderBatchTable(); renderBatchStats();
  computeInventory(); renderInventoryTable(); renderPlanning();
}
function bindFolderFallback() {
  const inp = $('#bomFolderFallback');
  if (!inp) return;
  inp.addEventListener('change', e => {
    const files = Array.from(e.target.files || []);
    _bomFolderFiles = files
      .filter(f => isBomFile(f.name))
      .map(f => ({ file: f, path: f.webkitRelativePath || f.name }));
    if (_bomFolderFiles.length) {
      const first = _bomFolderFiles[0].path;
      const root  = first.split('/')[0];
      $('#bomFolderPath').value = '/' + root + '/';
    } else {
      $('#bomFolderPath').value = '';
    }
    updateFolderInfo();
    e.target.value = '';
  });
}

/* =========================================================
   BOM
   ========================================================= */
async function handleBomFiles(files) {
  for (const f of files) {
    try {
      const sheets = await fileToSheetRows(f);

      let sheetsToProcess;
      if (sheets.length === 1) {
        sheetsToProcess = sheets;
      } else {
        const picked = await promptSheetSelection(sheets, f.name);
        if (!picked) continue;                           // user cancelled this file
        sheetsToProcess = picked;
      }

      for (const sheet of sheetsToProcess) {
        const label = sheets.length === 1 ? f.name : `${f.name} :: ${sheet.name}`;
        const parsedList = parseBOM(sheet.rows, label);
        if (!parsedList.length) {
          alert(`No parts found in ${label}`);
          continue;
        }
        for (const parsed of parsedList) {
          const key = bomKeyOf(parsed);
          const existing = STATE.boms.findIndex(b => bomKeyOf(b) === key);
          if (existing >= 0) STATE.boms.splice(existing, 1);
          assignBomId(parsed);
          STATE.boms.push(parsed);
        }
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to parse ${f.name}: ${e.message}`);
    }
  }
  rebuildPartIndex();
  renderBomList(); renderBomTable(); populatePlanModels(); populatePartDatalist();
  renderBatchTable(); renderBatchStats();
  computeInventory(); renderInventoryTable(); renderPlanning();
}
function parseBOM(rows, filename) {
  if (!rows || !rows.length) throw new Error('Empty file');

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const joined = (rows[i] || []).map(c => String(c)).join('|');
    if (joined.includes('Part NO') || joined.includes('Vehicle Matl')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Header row not found');

  const headers     = (rows[headerIdx] || []).map(h => String(h || '').split('\n')[0].trim());
  const headerLower = headers.map(h => h.toLowerCase());

  const findCol = (hints, exact = false) => {
    for (const h of hints) {
      const hl = h.toLowerCase();
      const i = headers.findIndex((_, idx) =>
        exact ? headerLower[idx] === hl : headerLower[idx].includes(hl));
      if (i >= 0) return i;
    }
    return -1;
  };

  let cVehMat = findCol(['vehicle matl', 'vehicle mat']); if (cVehMat < 0) cVehMat = 0;
  let cVehDesc= findCol(['vehi. desc', 'vehicle desc', 'vehicle description']); if (cVehDesc < 0) cVehDesc = 1;
  let cBatch  = findCol(['batch'], true);
  if (cBatch < 0) cBatch = findCol(['sales batch', 'batch id']);
  if (cBatch < 0) cBatch = 4;
  let cPartNo = findCol(['part no']); if (cPartNo < 0) cPartNo = 9;
  let cNameEN = findCol(['part name(en)', 'part name (en)', 'part name']); if (cNameEN < 0) cNameEN = 10;
  let cQty    = findCol(['qty'], true);
  if (cQty < 0) cQty = findCol(['quantity per', 'qty per']);
  if (cQty < 0) cQty = 19;
  let cUOM    = findCol(['uom'], true);
  if (cUOM < 0) cUOM = findCol(['unit of measure', 'uom']);
  if (cUOM < 0) cUOM = 20;

  let cMWO = findCol(['mwo'], true);
  if (cMWO < 0) cMWO = findCol(['mwo number', 'mwo no']);

  const groups = new Map();
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;

    const vehicleMatNo = String(r[cVehMat] || '').trim();
    const batchId      = String(r[cBatch]  || '').trim();
    const partNo       = String(r[cPartNo] || '').trim();
    if (!vehicleMatNo && !batchId) continue;
    if (!partNo) continue;

    const qty = Number(String(r[cQty]).replace(/[^0-9.\-]/g, ''));
    if (!qty || qty <= 0) continue;

    const key = vehicleMatNo + '||' + batchId;
    if (!groups.has(key)) {
      groups.set(key, {
        id: crypto.randomUUID ? crypto.randomUUID() : (key + '|' + Date.now() + '|' + Math.random()),
        vehicleMatNo,
        vehicleDesc: String(r[cVehDesc] || '').trim(),
        batchId,
        parts: []
      });
    }
    groups.get(key).parts.push({
      partNo,
      nameEN: String(r[cNameEN] ?? '').trim(),
      nameCN: '',
      qty,
      uom:    String(r[cUOM] ?? '').trim(),
      mwo:    cMWO >= 0 ? String(r[cMWO] ?? '').trim() : '',
      supplier: '',
      cpac: ''
    });
  }

  const out = [];
  for (const g of groups.values()) {
    g.label = g.batchId || g.vehicleMatNo || filename;
    out.push(g);
  }
  return out;
}

function rebuildPartIndex() {
  const idx = {};
  for (const bom of STATE.boms) {
    const key = bomKeyOf(bom);
    for (const p of bom.parts) {
      if (!idx[p.partNo]) {
        idx[p.partNo] = {
          partNo: p.partNo, nameCN: p.nameCN, nameEN: p.nameEN,
          uom: p.uom, supplier: p.supplier, cpac: p.cpac,
          bomKeys: new Set(), perBomQty: {}
        };
      }
      idx[p.partNo].bomKeys.add(key);
      idx[p.partNo].perBomQty[key] = (idx[p.partNo].perBomQty[key] || 0) + p.qty;
    }
  }
  const totalBoms = STATE.boms.length;
  for (const p of Object.values(idx)) {
    p.isCommon = p.bomKeys.size === totalBoms && totalBoms > 0;
  }
  STATE.partIndex = idx;
}

/* =========================================================
   BOM LIST TREE
   ========================================================= */
function renderBomList() {
  const wrap = $('#bomList');
  if (!STATE.boms.length) {
    wrap.innerHTML = '<div class="hint" style="margin:0">No BOMs loaded yet. Use the folder loader above to load BOM files.</div>';
    return;
  }

  /* --- spec → color → bomId → boms[] --- */
  const specMap = new Map();
  for (const b of STATE.boms) {
    const sk  = specKeyOf(b.vehicleMatNo);
    const cc  = colorCodeOf(b.vehicleMatNo);
    const bid = b.bomId || '(unassigned)';
    if (!specMap.has(sk)) specMap.set(sk, { specKey: sk, colors: new Map(), boms: [] });
    const sg = specMap.get(sk);
    sg.boms.push(b);
    if (!sg.colors.has(cc)) sg.colors.set(cc, new Map());
    const cg = sg.colors.get(cc);
    if (!cg.has(bid)) cg.set(bid, []);
    cg.get(bid).push(b);
  }
  for (const sg of specMap.values()) sg.specName = deriveSpecName(sg.boms);

  /* --- Render --- */
  wrap.innerHTML = Array.from(specMap.values()).map(sg => {
    /* spec counts */
    const specBomIds = new Set();
    for (const b of sg.boms) specBomIds.add(b.bomId);
    const specBomCount   = specBomIds.size;
    const specBatchCount = sg.boms.length;

    const colorHtml = Array.from(sg.colors.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([cc, bomGroupMap]) => {
        const allBomsInColor = Array.from(bomGroupMap.values()).flat();
        const colorName      = deriveColorName(allBomsInColor, sg.specName);
        const colorBomCount  = bomGroupMap.size;            // distinct BOM IDs
        const colorBatchCount = allBomsInColor.length;      // total batches

        const bomGroupsHtml = Array.from(bomGroupMap.entries())
          .sort((a, b) => {
            const na = parseInt(String(a[0]).replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(String(b[0]).replace(/\D/g, ''), 10) || 0;
            return na - nb;
          })
          .map(([bomId, boms]) => {
            const rep = boms[0];
            const partCount = rep.parts.length;

            const batchItems = boms
              .slice()
              .sort((a, b) => String(a.batchId || '').localeCompare(String(b.batchId || '')))
              .map(bomBatchItemHtml)
              .join('');

            return `
              <div class="bom-id-group" data-bomid="${escapeHtml(bomId)}">
                <div class="bom-id-header">
                  <span class="bom-id-badge">${escapeHtml(bomId)}</span>
                  <span class="bom-id-stats">
                    ${boms.length} batch${boms.length === 1 ? '' : 'es'} · ${partCount} parts
                  </span>
                  <button class="btn tiny" data-role="bom-display" data-bomid="${escapeHtml(bomId)}">
                    Display BOM
                  </button>
                </div>
                <details class="bom-batch-toggle">
                  <summary class="bom-batch-toggle-summary">
                    Show ${boms.length} batch${boms.length === 1 ? '' : 'es'}
                  </summary>
                  <div class="bom-batch-list">${batchItems}</div>
                </details>
              </div>`;
          }).join('');

        return `
          <details class="bom-color-group" open>
            <summary class="bom-color-header">
              <span class="color-code" style="${colorBadgeStyle(cc)}">${escapeHtml(cc || '??')}</span>
              ${colorName ? `<span class="color-name">${escapeHtml(colorName)}</span>` : ''}
              <span class="color-count">
                ${colorBomCount} BOM${colorBomCount === 1 ? '' : 's'} ·
                ${colorBatchCount} batch${colorBatchCount === 1 ? '' : 'es'}
              </span>
            </summary>
            <div class="bom-id-list">${bomGroupsHtml}</div>
          </details>`;
      }).join('');

    return `
      <details class="bom-spec-group" open>
        <summary class="bom-spec-header">
          <span class="spec-name">${escapeHtml(sg.specName)}</span>
          <span class="spec-count">
            ${specBomCount} BOM${specBomCount === 1 ? '' : 's'} ·
            ${specBatchCount} batch${specBatchCount === 1 ? '' : 'es'}
          </span>
        </summary>
        <div class="bom-color-list">${colorHtml}</div>
      </details>`;
  }).join('');

  /* --- Wire up Display BOM buttons --- */
  wrap.querySelectorAll('button[data-role=bom-display]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      openBomDisplay(btn.dataset.bomid);
    });
  });

  /* --- Re-apply active search (moved OUTSIDE the template string) --- */
  if ($('#bomListSearch') && $('#bomListSearch').value) handleBomListSearch();
}

function bomBatchItemHtml(b) {
  const bid = b.batchId || '—';
  return `<span class="bom-batch-chip" data-batchid="${escapeHtml(b.batchId || '')}" title="${escapeHtml(bid)}">${escapeHtml(bid)}</span>`;
}

/* =========================================================
   BOM LIST — SEARCH & EXPAND / COLLAPSE
   ========================================================= */
function handleBomListSearch() {
  const wrap      = $('#bomList');
  const resultBox = $('#bomListSearchResult');
  if (!wrap || !resultBox) return;

  const q = ($('#bomListSearch').value || '').trim().toLowerCase();

  wrap.querySelectorAll('.hidden-for-search').forEach(el => el.classList.remove('hidden-for-search'));
  wrap.querySelectorAll('.bom-search-hit').forEach(el => el.classList.remove('bom-search-hit'));

  if (!q) { resultBox.classList.add('hidden'); resultBox.innerHTML = ''; return; }

  const hits = [];
  wrap.querySelectorAll('.bom-spec-group').forEach(specEl => {
    const specName = specEl.querySelector('.spec-name')?.textContent || '';
    specEl.querySelectorAll('.bom-color-group').forEach(colorEl => {
      const cc = colorEl.querySelector('.color-code')?.textContent || '';
      const cn = colorEl.querySelector('.color-name')?.textContent || '';
      colorEl.querySelectorAll('.bom-id-group').forEach(bomEl => {
        const bomId = bomEl.querySelector('.bom-id-badge')?.textContent || '';
        bomEl.querySelectorAll('.bom-batch-chip').forEach(chip => {
          const bid = chip.dataset.batchid || '';
          if (bid.toLowerCase().includes(q)) {
            hits.push({ specName, cc, cn, bomId, bid, chipEl: chip, bomEl, colorEl, specEl });
          }
        });
      });
    });
  });

  wrap.querySelectorAll('.bom-spec-group, .bom-color-group, .bom-id-group, .bom-batch-chip')
    .forEach(el => el.classList.add('hidden-for-search'));

  for (const h of hits) {
    h.chipEl.classList.remove('hidden-for-search');
    h.chipEl.classList.add('bom-search-hit');
    h.bomEl.classList.remove('hidden-for-search');
    h.colorEl.classList.remove('hidden-for-search');
    h.specEl.classList.remove('hidden-for-search');
    const det = h.bomEl.querySelector('details.bom-batch-toggle');
    if (det) det.open = true;
  }

  resultBox.classList.remove('hidden');

  if (!hits.length) {
    resultBox.innerHTML =
      `<div class="bom-search-empty">No Sales Batch matches “${escapeHtml(q)}”.</div>`;
    return;
  }

  const rows = hits.map(h => `
    <div class="bom-search-row">
      <span class="bom-search-spec">${escapeHtml(h.specName)}</span>
      <span class="bom-search-arrow">›</span>
      <span class="bom-search-color">
        <span class="color-code" style="${colorBadgeStyle(h.cc)}">${escapeHtml(h.cc || '??')}</span>
        ${h.cn ? `<span class="bom-search-color-name">${escapeHtml(h.cn)}</span>` : ''}
      </span>
      <span class="bom-search-arrow">›</span>
      <span class="bom-search-bomid bom-id-badge">${escapeHtml(h.bomId)}</span>
      <span class="bom-search-arrow">›</span>
      <span class="bom-search-batch">${escapeHtml(h.bid)}</span>
    </div>`).join('');

  resultBox.innerHTML = `
    <div class="bom-search-summary">
      <b>${hits.length}</b> match${hits.length === 1 ? '' : 'es'} for “${escapeHtml(q)}”
    </div>
    <div class="bom-search-rows">${rows}</div>`;
}

function expandAllBomList() {
  document.querySelectorAll('#bomList details').forEach(d => { d.open = true; });
}

function collapseAllBomList() {
  document.querySelectorAll('#bomList details').forEach(d => { d.open = false; });
}

function bindBomListSearch() {
  const inp = $('#bomListSearch');
  if (!inp) return;
  inp.addEventListener('input', handleBomListSearch);
  $('#bomListExpandAll')?.addEventListener('click', expandAllBomList);
  $('#bomListCollapseAll')?.addEventListener('click', collapseAllBomList);
}

/* =========================================================
   MATERIAL LIST
   ========================================================= */
function renderBomTable() {
  const tbl  = $('#bomTable');
  const q    = ($('#bomSearch').value || '').toLowerCase();
  const mode = $('#bomFilter').value;

  const rows = Object.values(STATE.partIndex).filter(p => {
    if (mode === 'common'   && !p.isCommon) return false;
    if (mode === 'specific' &&  p.isCommon) return false;
    if (q) {
      const hay = `${p.partNo} ${p.nameEN} ${p.nameCN}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) {
    tbl.innerHTML = `<thead><tr><th>No material data</th></tr></thead>`;
    return;
  }

  rows.sort((a, b) => a.partNo.localeCompare(b.partNo, undefined, { numeric: true }));

  const head = `
    <thead><tr>
      <th class="c-type">Material Type</th>
      <th class="c-partno">Material Number</th>
      <th class="c-nameen">Material Description</th>
      <th class="c-action">Where Used</th>
    </tr></thead>`;

  const body = rows.map(p => {
    const isOpen = WHERE_USED_OPEN.has(p.partNo);
    const count  = p.bomKeys.size;

    const mainRow = `
      <tr class="mat-main-row ${isOpen ? 'row-open' : ''}" data-partno="${escapeHtml(p.partNo)}">
        <td class="c-type">${p.isCommon
          ? '<span class="pill common">COMMON</span>'
          : `<span class="pill specific" title="${escapeHtml([...p.bomKeys].join(', '))}">SPECIFIC</span>`}</td>
        <td class="c-partno" title="${escapeHtml(p.partNo)}">${escapeHtml(p.partNo)}</td>
        <td class="c-nameen" title="${escapeHtml(p.nameEN || p.nameCN || '')}">${escapeHtml(p.nameEN || p.nameCN || '')}</td>
        <td class="c-action">
          <button class="btn tiny where-used-btn" data-partno="${escapeHtml(p.partNo)}">
            ${isOpen ? '▾ Hide' : '▸ Where Used'} <span class="wu-count">${count}</span>
          </button>
        </td>
      </tr>`;

    if (!isOpen) return mainRow;

    /* ---- Build spec → colour → BOM ID → batches ---- */
    const bomsForPart = Array.from(p.bomKeys)
      .map(key => STATE.boms.find(b => bomKeyOf(b) === key))
      .filter(Boolean);

    const specMap = new Map();
    for (const bom of bomsForPart) {
      const sk  = specKeyOf(bom.vehicleMatNo);
      const cc  = colorCodeOf(bom.vehicleMatNo);
      const bid = bom.bomId || '(unassigned)';
      if (!specMap.has(sk)) specMap.set(sk, { specKey: sk, colors: new Map(), boms: [] });
      const sg = specMap.get(sk);
      sg.boms.push(bom);
      if (!sg.colors.has(cc)) sg.colors.set(cc, { colorCode: cc, bomIds: new Map(), boms: [] });
      const cg = sg.colors.get(cc);
      cg.boms.push(bom);
      if (!cg.bomIds.has(bid)) cg.bomIds.set(bid, []);
      cg.bomIds.get(bid).push(bom);
    }
    for (const sg of specMap.values()) sg.specName = deriveSpecName(sg.boms);

    /* ---- Render using the BOM List hierarchy classes ---- */
    const specList = Array.from(specMap.values())
      .sort((a, b) => a.specName.localeCompare(b.specName, undefined, { numeric: true }));

    const specHtml = specList.map(sg => {
      const specBomIds     = new Set(sg.boms.map(b => b.bomId));
      const specBomCount   = specBomIds.size;
      const specBatchCount = sg.boms.length;

      const colorList = Array.from(sg.colors.entries())
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

      const colorHtml = colorList.map(([cc, cg]) => {
        const colorName       = deriveColorName(cg.boms, sg.specName);
        const colorBomCount   = cg.bomIds.size;
        const colorBatchCount = cg.boms.length;

        const bomIdList = Array.from(cg.bomIds.entries())
          .sort((a, b) => {
            const na = parseInt(String(a[0]).replace(/\D/g, ''), 10) || 0;
            const nb = parseInt(String(b[0]).replace(/\D/g, ''), 10) || 0;
            return na - nb;
          });

        const bomHtml = bomIdList.map(([bomId, boms]) => {
          const rep = boms[0];
          const partCount = rep.parts.length;

          const batchList = boms.slice().sort((a, b) =>
            (a.batchId || '').localeCompare(b.batchId || '', undefined, { numeric: true }));

          const batchChips = batchList.map(bom => {
            const key = bomKeyOf(bom);
            const qty = p.perBomQty[key] || 0;
            const uom = p.uom || '';
            return `
              <span class="bom-batch-chip wu-chip" title="${escapeHtml(bom.batchId || '')}">
                ${escapeHtml(bom.batchId || '—')}
                <b class="wu-chip-qty">${fmt(qty)}</b>
                ${uom ? `<small class="wu-chip-uom">${escapeHtml(uom)}</small>` : ''}
              </span>`;
          }).join('');

          return `
            <div class="bom-id-group" data-bomid="${escapeHtml(bomId)}">
              <div class="bom-id-header">
                <span class="bom-id-badge">${escapeHtml(bomId)}</span>
                <span class="bom-id-stats">
                  ${boms.length} batch${boms.length === 1 ? '' : 'es'} · ${partCount} parts
                </span>
                <button class="btn tiny" data-role="wu-bom-display" data-bomid="${escapeHtml(bomId)}">
                  Display BOM
                </button>
              </div>
              <details class="bom-batch-toggle">
                <summary class="bom-batch-toggle-summary">
                  Show ${boms.length} batch${boms.length === 1 ? '' : 'es'}
                </summary>
                <div class="bom-batch-list">${batchChips}</div>
              </details>
            </div>`;
        }).join('');

        return `
          <details class="bom-color-group" open>
            <summary class="bom-color-header">
              <span class="color-code" style="${colorBadgeStyle(cc)}">${escapeHtml(cc || '??')}</span>
              ${colorName ? `<span class="color-name">${escapeHtml(colorName)}</span>` : ''}
              <span class="color-count">
                ${colorBomCount} BOM${colorBomCount === 1 ? '' : 's'} ·
                ${colorBatchCount} batch${colorBatchCount === 1 ? '' : 'es'}
              </span>
            </summary>
            <div class="bom-id-list">${bomHtml}</div>
          </details>`;
      }).join('');

      return `
        <details class="bom-spec-group" open>
          <summary class="bom-spec-header">
            <span class="spec-name">${escapeHtml(sg.specName)}</span>
            <span class="spec-count">
              ${specBomCount} BOM${specBomCount === 1 ? '' : 's'} ·
              ${specBatchCount} batch${specBatchCount === 1 ? '' : 'es'}
            </span>
          </summary>
          <div class="bom-color-list">${colorHtml}</div>
        </details>`;
    }).join('');

    return mainRow + `
      <tr class="where-used-row">
        <td colspan="4">
          <div class="where-used-panel">
            <div class="wu-title">
              Used in <b>${bomsForPart.length}</b> vehicle batch${bomsForPart.length === 1 ? '' : 'es'}
            </div>
            ${specHtml}
          </div>
        </td>
      </tr>`;
  }).join('');

  tbl.innerHTML = head + `<tbody>${body}</tbody>`;

  /* Wire the Where Used expand/collapse button */
  tbl.querySelectorAll('.where-used-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const pn = btn.dataset.partno;
      if (WHERE_USED_OPEN.has(pn)) WHERE_USED_OPEN.delete(pn);
      else                          WHERE_USED_OPEN.add(pn);
      renderBomTable();
    });
  });

  /* Wire the Display BOM button inside the Where Used panel */
  tbl.querySelectorAll('button[data-role=wu-bom-display]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      openBomDisplay(btn.dataset.bomid);
    });
  });
}

function populatePlanModels() {
  const sel = $('#planModel');
  sel.innerHTML = STATE.boms.length
    ? STATE.boms.map(b => `<option value="${escapeHtml(bomKeyOf(b))}">${escapeHtml(bomDisplayName(b))}</option>`).join('')
    : '<option value="">— upload BOMs first —</option>';
}

function populatePartDatalist() {
  const dl = $('#partList');
  if (!dl) return;
  dl.innerHTML = Object.keys(STATE.partIndex).sort()
    .map(p => `<option value="${escapeHtml(p)}">`).join('');
}

/* =========================================================
   BATCHES
   ========================================================= */
async function handleBatchFiles(files) {
  const f = files[0];
  if (!f) return;
  try {
    const sheets = await fileToSheetRows(f);

    let combinedRows;
    if (sheets.length === 1) {
      combinedRows = sheets[0].rows;
    } else {
      const picked = await promptSheetSelection(sheets, f.name);
      if (!picked) return;                              // user cancelled
      combinedRows = picked.flatMap(s => s.rows);
    }

    STATE.batches = parseBatches(combinedRows);
    STATE.batchView = { sorts: {}, filters: {} };
    classifyBatches();
    renderBatchStats();
    renderBatchTable();
    computeInventory();
    renderInventoryTable();
    renderPlanning();
  } catch (e) {
    console.error(e);
    alert(`Failed to parse batch file: ${e.message}`);
  }
}

function parseBatches(rows) {
  if (!rows.length) return [];
  const header = rows[0].map(h => String(h||'').trim().toLowerCase());
  const idx = names => {
    for (const n of names) {
      const i = header.findIndex(h => h === n.toLowerCase());
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    batch:      idx(['batch number','batch']),
    model:      idx(['modelo','model']),
    color:      idx(['color']),
    qty:        idx(['cantidad','quantity','qty']),
    trimIn:     idx(['trim in date']),
    ship:       idx(['name of ship','ship']),
    week:       idx(['week']),
    decanting:  idx(['decanting date']),
    arrival:    idx(['arrival date','arrival']),
    production: idx(['production']),
    colorCode:  idx(['color code']),
    carroceria: idx(['batch carroceria']),
    mwo:        idx(['mwo'])
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const model = String(r[c.model] || '').trim();
    const batch = String(r[c.batch] || '').trim();
    if (!model && !batch) continue;
    const qty = c.qty >= 0 ? Number(String(r[c.qty]).replace(/[^0-9.\-]/g,'')) : 0;
    out.push({
      batch, model,
      color:      String(r[c.color] || '').trim(),
      qty:        isNaN(qty) ? 0 : qty,
      trimIn:     parseDate(r[c.trimIn]),
      ship:       String(r[c.ship] || '').trim(),
      week:       r[c.week],
      decanting:  parseDate(r[c.decanting]),
      arrival:    parseDate(r[c.arrival]),
      production: String(r[c.production] || '').trim(),
      colorCode:  String(r[c.colorCode] || '').trim(),
      carroceria: String(r[c.carroceria] || '').trim(),
      mwo:        String(r[c.mwo] || '').trim(),
      _stage: 'unassigned',
      _warehouse: null
    });
  }
  return out;
}

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 60000) {
    return new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
  }
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1]-1, +m[2]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/* =========================================================
   CLASSIFY
   ========================================================= */
function classifyBatches() {
  const t = today();
  const defaultWh  = STATE.config.defaultWarehouseId || null;
  const autoAssign = STATE.config.autoAssignDefaultWarehouse === true;

  for (const b of STATE.batches) {
    if (b.trimIn && b.trimIn < t && /^DONE$/i.test(b.production || '')) {
      b._stage = 'consumed'; b._warehouse = null; continue;
    }
    if (b.arrival && b.arrival > t) {
      b._stage = 'inTransit'; b._warehouse = null; continue;
    }
    if (b.decanting && b.decanting <= t) {
      b._stage = 'factoryFloor'; b._warehouse = null; continue;
    }
    if (b.arrival && b.arrival <= t && (!b.decanting || b.decanting > t)) {
      b._stage = 'warehouse';
      if (autoAssign && !b._warehouse && defaultWh) b._warehouse = defaultWh;
      continue;
    }
    b._stage = 'unassigned'; b._warehouse = null;
  }
}

/* =========================================================
   CONVERSION TABLE
   ========================================================= */
function resolveBomKeyForBatch(batch) {
  if (!STATE.boms.length) return null;

  if (batch.batch) {
    const direct = STATE.boms.find(b => b.batchId === batch.batch);
    if (direct) return bomKeyOf(direct);
  }

  const ct = STATE.config.conversionTable || [];
  const modelo = (batch.model || '').toLowerCase();
  const color  = (batch.color || '').toLowerCase();
  let row = ct.find(r => (r.modelo||'').toLowerCase() === modelo && (r.color||'').toLowerCase() === color);
  if (!row) row = ct.find(r => (r.modelo||'').toLowerCase() === modelo && (!r.color || !r.color.trim()));

  if (row) {
    let candidates = [];
    if (row.vehicleMatNo) candidates = STATE.boms.filter(b => b.vehicleMatNo === row.vehicleMatNo);
    if (!candidates.length && row.batchId) candidates = STATE.boms.filter(b => b.batchId === row.batchId);
    if (candidates.length) return bomKeyOf(candidates[candidates.length - 1]);
  }

  const byDesc = STATE.boms.filter(b => b.vehicleDesc === batch.model);
  if (byDesc.length) return bomKeyOf(byDesc[byDesc.length - 1]);

  return null;
}

/* =========================================================
   BATCH CELL VALUE HELPERS
   ========================================================= */
function getBatchCellValue(b, colId) {
  switch (colId) {
    case 'batch':      return b.batch || '';
    case 'model':      return b.model || '';
    case 'color':      return b.color || '';
    case 'qty':        return b.qty || 0;
    case 'ship':       return b.ship || '';
    case 'arrival':    return b.arrival   ? isoDate(b.arrival)   : '';
    case 'decanting':  return b.decanting ? isoDate(b.decanting) : '';
    case 'trimIn':     return b.trimIn    ? isoDate(b.trimIn)    : '';
    case 'production': return b.production || '';
    case 'stage':      return b._stage || '';
    case 'warehouse':  return b._warehouse || '';
    case 'linkedBom':  return resolveBomKeyForBatch(b) || '';
  }
  return '';
}
function isoDate(d) {
  if (!d) return '';
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

function getBatchCellLabel(b, colId) {
  const v = getBatchCellValue(b, colId);
  if (colId === 'stage') {
    const s = STATE.config.stages[v];
    return s ? s.label : v;
  }
  if (colId === 'warehouse') {
    if (!v) return '—';
    const w = STATE.config.warehouses.find(x => x.id === v);
    return w ? w.name : v;
  }
  if (colId === 'arrival' || colId === 'decanting' || colId === 'trimIn') {
    return v ? new Date(v + 'T00:00:00').toLocaleDateString() : '—';
  }
  if (colId === 'linkedBom') {
    if (!v) return '—';
    const bom = STATE.boms.find(b => bomKeyOf(b) === v);
    return bom ? bomDisplayName(bom) : v;
  }
  if (colId === 'qty') return fmt(v);
  return v === '' ? '—' : String(v);
}

function getUniqueValues(colId) {
  const seen = new Map();
  for (const b of STATE.batches) {
    const key   = getBatchCellValue(b, colId);
    const label = getBatchCellLabel(b, colId);
    if (!seen.has(key)) seen.set(key, label);
  }
  return Array.from(seen.entries())
    .map(([key, label]) => ({ key: String(key), label }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
}

/* =========================================================
   BATCH STATS
   ========================================================= */
function renderBatchStats() {
  const stages = STATE.config.stages;
  const agg = {};
  for (const b of STATE.batches) {
    if (!agg[b._stage]) agg[b._stage] = { count: 0, qty: 0, byModel: {} };
    agg[b._stage].count += 1;
    agg[b._stage].qty   += (b.qty || 0);
    const m = b.model || '—';
    if (!agg[b._stage].byModel[m]) agg[b._stage].byModel[m] = { count: 0, qty: 0 };
    agg[b._stage].byModel[m].count += 1;
    agg[b._stage].byModel[m].qty   += (b.qty || 0);
  }
  const totalCount = STATE.batches.length;
  const totalQty   = STATE.batches.reduce((a,b) => a + (b.qty||0), 0);

  const rules = {
    inTransit:    'Arrival Date is in the future',
    warehouse:    'Arrived, not yet decanted',
    factoryFloor: 'Decanting Date already passed',
    edgeLine:     'Manual stage',
    consumed:     'TRIM IN DATE in the past and Production = DONE'
  };

  function breakdownHtml(byModel) {
    const entries = Object.entries(byModel || {})
      .sort((a,b) => b[1].qty - a[1].qty);
    if (!entries.length) return '';
    return `<div class="byModel">
      ${entries.map(([m, v]) => `
        <div class="byModel-row">
          <span class="m-name" title="${escapeHtml(m)}">${escapeHtml(shorten(m, 22))}</span>
          <span class="m-val">${fmt(v.qty)} <small>v · ${v.count} b</small></span>
        </div>
      `).join('')}
    </div>`;
  }

  $('#batchStats').innerHTML = `
    <div class="stat">
      <div class="label">All batches</div>
      <div class="value">${fmt(totalQty)}<span class="unit">vehicles</span></div>
      <div class="sub"><b>${fmt(totalCount)}</b> batches total</div>
    </div>
    ${Object.entries(stages).map(([k, s]) => {
      const a = agg[k] || { count:0, qty:0, byModel:{} };
      return `
        <div class="stat" title="${escapeHtml(rules[k]||'')}">
          <div class="label">
            <span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span>
          </div>
          <div class="value">${fmt(a.qty)}<span class="unit">vehicles</span></div>
          <div class="sub"><b>${fmt(a.count)}</b> batches</div>
          ${breakdownHtml(a.byModel)}
        </div>`;
    }).join('')}
    <div class="stat" title="Could not be classified automatically — missing dates">
      <div class="label">Unassigned</div>
      <div class="value">${fmt((agg.unassigned||{}).qty||0)}<span class="unit">vehicles</span></div>
      <div class="sub"><b>${fmt((agg.unassigned||{}).count||0)}</b> batches</div>
      ${breakdownHtml((agg.unassigned||{}).byModel)}
    </div>
  `;
}

/* =========================================================
   BATCH TABLE
   ========================================================= */
function renderBatchTable() {
  const tree = $('#batchTable');
  if (!STATE.batches.length) {
    tree.innerHTML = '<div class="hint" style="margin:0">No batch data</div>';
    return;
  }

  const searchText = ($('#batchSearch').value || '').trim().toLowerCase();

  /* --- 1. Column filters (flat) --- */
  let list = STATE.batches.map((b, i) => ({ b, i }));
  for (const [colId, allowedSet] of Object.entries(STATE.batchView.filters)) {
    if (!allowedSet) continue;
    list = list.filter(({ b }) => allowedSet.has(String(getBatchCellValue(b, colId))));
  }

  /* --- 2. Text search --- */
  if (searchText) {
    list = list.filter(({ b }) => {
      const hay = `${b.batch} ${b.model} ${b.color} ${b.ship} ${b.production}`.toLowerCase();
      return hay.includes(searchText);
    });
  }

  /* --- 3. Group: model → colour → batches --- */
  const modelMap = new Map();
  for (const item of list) {
    const b = item.b;
    const model = b.model || '(no model)';
    const color = b.color || '(no colour)';
    const cc    = b.colorCode || '';

    if (!modelMap.has(model)) modelMap.set(model, new Map());
    const colorMap = modelMap.get(model);
    const ckey = color + '||' + cc;
    if (!colorMap.has(ckey)) colorMap.set(ckey, { color, colorCode: cc, rows: [] });
    colorMap.get(ckey).rows.push(item);
  }

  const sortedModels = Array.from(modelMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  /* --- 4. Active sort (applied inside each colour group) --- */
  const sortCol = Object.keys(STATE.batchView.sorts)[0] || '';
  const sortDir = sortCol && STATE.batchView.sorts[sortCol] === 'desc' ? -1 : 1;
  const applySortToRows = (rows) => {
    const out = rows.slice();
    if (sortCol && sortCol !== 'model' && sortCol !== 'color') {
      out.sort((x, y) => {
        const a = getBatchCellValue(x.b, sortCol);
        const b = getBatchCellValue(y.b, sortCol);
        if (sortCol === 'qty') return ((Number(a) || 0) - (Number(b) || 0)) * sortDir;
        return String(a).localeCompare(String(b), undefined, { numeric: true }) * sortDir;
      });
    } else {
      out.sort((x, y) => x.b.batch.localeCompare(y.b.batch, undefined, { numeric: true }));
    }
    return out;
  };

  /* --- 5. Visible columns (model/color promoted to group headers) --- */
  const visibleCols = BATCH_COLS.filter(c => c.id !== 'model' && c.id !== 'color');

  /* --- 6. Render tree --- */
  let html = '';
  for (const [model, colorMap] of sortedModels) {
    const modelRows = Array.from(colorMap.values()).flatMap(c => c.rows);
    const modelQty  = modelRows.reduce((s, it) => s + (it.b.qty || 0), 0);

    html += `<details class="prod-spec-group" open>
      <summary class="prod-spec-header">
        <span class="spec-name">${escapeHtml(model)}</span>
        <span class="spec-count">
          ${modelRows.length} batch${modelRows.length === 1 ? '' : 'es'} ·
          ${colorMap.size} colour${colorMap.size === 1 ? '' : 's'} ·
          ${fmt(modelQty)} vehicles
        </span>
      </summary>
      <div class="prod-color-list">`;

    const sortedColors = Array.from(colorMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

    for (const [ckey, cg] of sortedColors) {
      const colorQty = cg.rows.reduce((s, it) => s + (it.b.qty || 0), 0);

      html += `<details class="prod-color-group" open>
        <summary class="prod-color-header">
          <span class="color-code" style="${colorBadgeStyle(cg.colorCode)}">${escapeHtml(cg.colorCode || '??')}</span>
          <span class="color-name">${escapeHtml(model)} ${escapeHtml(cg.color)}</span>
          <span class="color-count">
            ${cg.rows.length} batch${cg.rows.length === 1 ? '' : 'es'} ·
            ${fmt(colorQty)} vehicles
          </span>
        </summary>
        <div class="prod-batch-list">
          <table class="prod-batch-inner-table">
            <thead>
              <tr>
                ${visibleCols.map(col => {
                  const cls = [
                    'col-head',
                    col.num ? 'num' : '',
                    STATE.batchView.filters[col.id] ? 'filtered' : '',
                    STATE.batchView.sorts[col.id]   ? 'sorted'   : ''
                  ].filter(Boolean).join(' ');
                  const mark = STATE.batchView.sorts[col.id] === 'asc' ? '▲'
                             : STATE.batchView.sorts[col.id] === 'desc' ? '▼' : '';
                  return `<th class="${cls}" data-col="${col.id}">
                    ${escapeHtml(col.label)}${mark ? `<span class="sort-mark">${mark}</span>` : ''}
                    <button class="filter-btn" data-col="${col.id}" title="Sort / filter">▾</button>
                  </th>`;
                }).join('')}
              </tr>
            </thead>
            <tbody>`;

      const rows = applySortToRows(cg.rows);

      for (const { b, i } of rows) {
        const s = STATE.config.stages[b._stage] || { label: b._stage, color: '#9ca3af' };

        const linkedKey = resolveBomKeyForBatch(b);
        const linkedBom = linkedKey ? STATE.boms.find(x => bomKeyOf(x) === linkedKey) : null;
        const linkCell = linkedBom
          ? `<span title="${escapeHtml(bomDisplayName(linkedBom))}">${escapeHtml(shorten(bomDisplayName(linkedBom),18))}</span>`
          : (b.model
              ? `<span class="pill warn" title="No BOM match — check conversion table">⚠ no link</span>`
              : '—');

        const isUnassignedNoDate = b._stage === 'unassigned' && !b.arrival;
        const unassignedFlag = isUnassignedNoDate
          ? `<span class="pill warn" title="No Arrival Date — cannot be classified" style="margin-left:6px">⚠</span>`
          : '';

        const whLabel = b._warehouse
          ? (STATE.config.warehouses.find(w => w.id === b._warehouse)?.name || b._warehouse)
          : '—';

        const cells = {
          batch:      `<td>${escapeHtml(b.batch)}${unassignedFlag}</td>`,
          qty:        `<td class="num">${fmt(b.qty)}</td>`,
          ship:       `<td>${escapeHtml(b.ship)}</td>`,
          arrival:    `<td>${b.arrival   ? b.arrival.toLocaleDateString()   : '—'}</td>`,
          decanting:  `<td>${b.decanting ? b.decanting.toLocaleDateString() : '—'}</td>`,
          trimIn:     `<td>${b.trimIn    ? b.trimIn.toLocaleDateString()    : '—'}</td>`,
          production: `<td>${escapeHtml(b.production)}</td>`,
          stage:      `<td><span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span></td>`,
          warehouse:  `<td>${b._stage === 'warehouse'
                        ? `<select data-role="wh" data-i="${i}">
                             <option value="">—</option>
                             ${STATE.config.warehouses.map(w =>
                               `<option value="${w.id}" ${b._warehouse===w.id?'selected':''}>${escapeHtml(w.name)}</option>`
                             ).join('')}
                           </select>`
                        : escapeHtml(whLabel)}</td>`,
          linkedBom:  `<td>${linkCell}</td>`
        };

        html += `<tr data-i="${i}">${visibleCols.map(c => cells[c.id] || '<td></td>').join('')}</tr>`;
      }

      html += `</tbody></table></div></details>`;
    }

    html += `</div></details>`;
  }

  tree.innerHTML = html;

  /* --- 7. Wire interactions (same as before, just scoped to #batchTable) --- */
  tree.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openFilterPopup(btn.dataset.col, btn);
    });
  });

  tree.querySelectorAll('select[data-role=wh]').forEach(sel => {
    sel.addEventListener('change', e => {
      const i = +e.target.dataset.i;
      STATE.batches[i]._warehouse = e.target.value || null;
      computeInventory(); renderInventoryTable(); renderPlanning();
    });
  });
}
/* =========================================================
   FILTER POPUP
   ========================================================= */
function bindFilterPopupGlobal() {
  document.addEventListener('click', e => {
    const popup = $('#filterPopup');
    if (popup.classList.contains('hidden')) return;
    if (popup.contains(e.target)) return;
    if (e.target.closest('.filter-btn')) return;
    closeFilterPopup();
  });
  window.addEventListener('scroll', closeFilterPopup, true);
  window.addEventListener('resize', closeFilterPopup);
}

function closeFilterPopup() {
  const popup = $('#filterPopup');
  popup.classList.add('hidden');
  popup.innerHTML = '';
  popup._workingSet = null;
  popup._search = '';
}

function openFilterPopup(colId, anchor) {
  const popup = $('#filterPopup');
  popup.dataset.col = colId;
  const existingFilter = STATE.batchView.filters[colId];
  popup._workingSet = existingFilter ? new Set(existingFilter) : null;
  popup._search = '';
  popup.classList.remove('hidden');
  positionPopup(popup, anchor);
  paintFilterPopup(colId);
}

function positionPopup(popup, anchor) {
  const r = anchor.getBoundingClientRect();
  const pw = 270, ph = 420;
  let left = r.right - pw;
  if (left < 8) left = 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;

  let top = r.bottom + 6;
  if (top + ph > window.innerHeight - 8) {
    top = Math.max(8, r.top - ph - 6);
  }
  popup.style.left = left + 'px';
  popup.style.top  = top + 'px';
}

function paintFilterPopup(colId) {
  const popup = $('#filterPopup');
  const col = BATCH_COLS.find(c => c.id === colId);
  const allValues = getUniqueValues(colId);

  let ascLabel = '↑ Sort A → Z';
  let descLabel = '↓ Sort Z → A';
  if (col && col.date) { ascLabel = '↑ Sort oldest → newest'; descLabel = '↓ Sort newest → oldest'; }
  else if (col && col.num) { ascLabel = '↑ Sort low → high'; descLabel = '↓ Sort high → low'; }

  const currentSort = STATE.batchView.sorts[colId];
  const search = (popup._search || '').toLowerCase();
  const working = popup._workingSet;
  const visible = allValues.filter(v => !search || v.label.toLowerCase().includes(search));

  const valuesHtml = visible.length
    ? visible.map(v => {
        const checked = working === null ? true : working.has(v.key);
        return `<label class="fp-value">
          <input type="checkbox" data-key="${escapeHtml(v.key)}" ${checked ? 'checked' : ''}/>
          <span title="${escapeHtml(v.label)}">${escapeHtml(v.label)}</span>
        </label>`;
      }).join('')
    : `<div class="hint" style="margin:6px">No values</div>`;

  popup.innerHTML = `
    <div class="fp-sort">
      <button data-sort="asc"  class="${currentSort==='asc'?'primary':''}">${ascLabel}</button>
      <button data-sort="desc" class="${currentSort==='desc'?'primary':''}">${descLabel}</button>
      ${currentSort ? `<button data-sort="none" class="ghost">✕ Clear sort on this column</button>` : ''}
    </div>
    <div class="fp-search">
      <input type="text" id="fpSearchInput" placeholder="Search values…" value="${escapeHtml(popup._search||'')}"/>
    </div>
    <div class="fp-values" id="fpValues">${valuesHtml}</div>
    <div class="fp-actions">
      <button data-act="all">All</button>
      <button data-act="none">None</button>
      <button data-act="apply" class="primary">Apply</button>
    </div>
  `;

  popup.querySelectorAll('.fp-sort button').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const s = b.dataset.sort;
      if (s === 'none') delete STATE.batchView.sorts[colId];
      else              STATE.batchView.sorts[colId] = s;
      closeFilterPopup();
      renderBatchTable();
    });
  });

  const si = popup.querySelector('#fpSearchInput');
  si.addEventListener('input', e => {
    popup._search = e.target.value;
    const currentChecked = new Set();
    popup.querySelectorAll('.fp-value input[type=checkbox]:checked').forEach(c => currentChecked.add(c.dataset.key));
    const currentAll = popup.querySelectorAll('.fp-value input[type=checkbox]').length;
    if (currentChecked.size === currentAll) popup._workingSet = null;
    else popup._workingSet = currentChecked;

    paintFilterPopup(colId);
    const newSi = $('#filterPopup #fpSearchInput');
    if (newSi) { newSi.focus(); newSi.setSelectionRange(newSi.value.length, newSi.value.length); }
  });
  si.addEventListener('click', e => e.stopPropagation());

  popup.querySelectorAll('.fp-value input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', e => {
      e.stopPropagation();
      if (popup._workingSet === null) {
        popup._workingSet = new Set(allValues.map(v => v.key));
      }
      if (cb.checked) popup._workingSet.add(cb.dataset.key);
      else            popup._workingSet.delete(cb.dataset.key);
    });
  });
  popup.querySelectorAll('.fp-value').forEach(lbl => {
    lbl.addEventListener('click', e => e.stopPropagation());
  });

  popup.querySelectorAll('.fp-actions button').forEach(b => {
    b.addEventListener('click', e => {
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'all') {
        popup._workingSet = null;
        popup.querySelectorAll('.fp-value input[type=checkbox]').forEach(c => c.checked = true);
      } else if (act === 'none') {
        popup._workingSet = new Set();
        popup.querySelectorAll('.fp-value input[type=checkbox]').forEach(c => c.checked = false);
      } else if (act === 'apply') {
        if (popup._workingSet === null) delete STATE.batchView.filters[colId];
        else if (popup._workingSet.size === 0) STATE.batchView.filters[colId] = new Set();
        else STATE.batchView.filters[colId] = new Set(popup._workingSet);
        closeFilterPopup();
        renderBatchTable();
      }
    });
  });
}

/* =========================================================
   SCRAP
   ========================================================= */
function bindScrapForm() {
  $('#scrapAdd').addEventListener('click', () => {
    const partNo    = ($('#scrapPart').value || '').trim();
    const qty       = Number($('#scrapQty').value);
    const ubication = ($('#scrapUbi').value || '').trim();
    const note      = ($('#scrapNote').value || '').trim();
    if (!partNo) { alert('Enter a Part No.'); return; }
    if (!qty || qty <= 0) { alert('Enter a positive quantity.'); return; }
    if (!STATE.partIndex[partNo]) {
      if (!confirm(`Part "${partNo}" is not in any uploaded BOM. Add anyway?`)) return;
    }
    STATE.scrap.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()),
      partNo, qty, ubication, note,
      date: new Date().toISOString()
    });
    savePersistedScrap();
    $('#scrapPart').value = '';
    $('#scrapQty').value  = '';
    $('#scrapUbi').value  = '';
    $('#scrapNote').value = '';
    renderScrapList();
    renderInventoryTable();
    renderPlanning();
  });

  $('#scrapUploadBtn').addEventListener('click', () => $('#scrapFile').click());
  $('#scrapFile').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const rows = await fileToRows(f);
      const added = parseScrapFile(rows);
      if (!added) { alert('No valid scrap rows found.'); return; }
      savePersistedScrap();
      renderScrapList();
      renderInventoryTable();
      renderPlanning();
      alert(`Imported ${added} scrap row${added===1?'':'s'}.`);
    } catch (err) {
      console.error(err);
      alert(`Failed to parse scrap file: ${err.message}`);
    }
    e.target.value = '';
  });
}

function parseScrapFile(rows) {
  if (!rows.length) return 0;
  const header = rows[0].map(h => String(h||'').trim().toLowerCase());
  const idx = names => {
    for (const n of names) {
      const i = header.findIndex(h => h === n.toLowerCase());
      if (i >= 0) return i;
    }
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n.toLowerCase()));
      if (i >= 0) return i;
    }
    return -1;
  };
  const cPart = idx(['material number','material no','part number','part no','partno','matnr','material','零件号']);
  const cQty  = idx(['quantity','qty','cantidad','用量','数量']);
  const cUbi  = idx(['ubication','ubicación','ubicacion','location','warehouse','库位','库房']);

  if (cPart < 0 || cQty < 0) throw new Error('Columns "Material Number" and "Quantity" are required');

  let added = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const partNo = String(r[cPart] || '').trim();
    if (!partNo) continue;
    const qty = Number(String(r[cQty]).replace(/[^0-9.\-]/g,''));
    if (!qty || qty <= 0) continue;
    const ubication = cUbi >= 0 ? String(r[cUbi] || '').trim() : '';
    STATE.scrap.push({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()+Math.random()),
      partNo, qty, ubication, note: 'bulk upload',
      date: new Date().toISOString()
    });
    added++;
  }
  return added;
}

function renderScrapList() {
  const wrap = $('#scrapList');
  if (!wrap) return;
  if (!STATE.scrap.length) {
    wrap.innerHTML = '<span class="hint" style="margin:0">No scrap recorded yet.</span>';
    return;
  }
  const sorted = [...STATE.scrap].sort((a,b) => (b.date||'').localeCompare(a.date||''));
  wrap.innerHTML = sorted.map(s => `
    <div class="scrap-item" data-id="${s.id}">
      <span class="mono">${escapeHtml(s.partNo)}</span>
      <span>${escapeHtml(s.ubication || '—')}</span>
      <span class="num">−${fmt(s.qty)}</span>
      <span class="ts">${escapeHtml(s.note || '')}</span>
      <span class="ts">${new Date(s.date).toLocaleString()}</span>
      <button data-role="del" title="Delete">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('button[data-role=del]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.closest('.scrap-item').dataset.id;
      STATE.scrap = STATE.scrap.filter(x => x.id !== id);
      savePersistedScrap();
      renderScrapList();
      renderInventoryTable();
      renderPlanning();
    });
  });
}

function scrapByPartNo() {
  const out = {};
  for (const s of STATE.scrap) out[s.partNo] = (out[s.partNo] || 0) + s.qty;
  return out;
}

/* =========================================================
   INVENTORY
   ========================================================= */
function computeInventory() {
  const inv = {};
  for (const p of Object.keys(STATE.partIndex)) {
    inv[p] = { inTransit: 0, warehouses: {}, factoryFloor: 0, edgeLine: 0, total: 0 };
  }
  for (const b of STATE.batches) {
    if (!b.qty || b._stage === 'consumed' || b._stage === 'unassigned') continue;
    const key = resolveBomKeyForBatch(b);
    if (!key) continue;
    for (const [partNo, p] of Object.entries(STATE.partIndex)) {
      const q = p.perBomQty[key];
      if (!q) continue;
      const amount = q * b.qty;
      if (b._stage === 'inTransit')         inv[partNo].inTransit    += amount;
      else if (b._stage === 'factoryFloor') inv[partNo].factoryFloor += amount;
      else if (b._stage === 'edgeLine')     inv[partNo].edgeLine     += amount;
      else if (b._stage === 'warehouse') {
        const wh = b._warehouse || '__unassigned__';
        inv[partNo].warehouses[wh] = (inv[partNo].warehouses[wh] || 0) + amount;
      }
      inv[partNo].total += amount;
    }
  }
  STATE.inventory = inv;
}

function renderInventoryTable() {
  const tbl = $('#invTable');
  const q = ($('#invSearch').value || '').toLowerCase();
  const whEnabled = STATE.config.warehouses.filter(w => w.enabled);
  const scrapMap = scrapByPartNo();

  const rows = Object.values(STATE.partIndex).filter(p => {
    if (!q) return true;
    const hay = `${p.partNo} ${p.nameCN} ${p.nameEN}`.toLowerCase();
    return hay.includes(q);
  });

  if (!rows.length) {
    tbl.innerHTML = `<thead><tr><th>Upload BOM &amp; batch files first</th></tr></thead>`;
    return;
  }

  const head = `
    <thead><tr>
      <th>Part No.</th><th>Name</th><th>UOM</th>
      <th class="num">In Transit</th>
      ${whEnabled.map(w => `<th class="num">${escapeHtml(w.name)}</th>`).join('')}
      <th class="num">Factory Floor</th>
      <th class="num">Edge Line</th>
      <th class="num">Total</th>
      <th class="num">Scrap</th>
      <th class="num">Available</th>
    </tr></thead>`;

  const body = rows.map(p => {
    const inv = STATE.inventory[p.partNo] ||
      { inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0 };
    const scrap = scrapMap[p.partNo] || 0;
    const available = inv.total - scrap;
    return `
      <tr>
        <td><b>${escapeHtml(p.partNo)}</b></td>
        <td>${escapeHtml(p.nameCN || p.nameEN)}</td>
        <td>${escapeHtml(p.uom)}</td>
        <td class="num">${fmt(inv.inTransit)}</td>
        ${whEnabled.map(w => `<td class="num">${fmt(inv.warehouses[w.id] || 0)}</td>`).join('')}
        <td class="num">${fmt(inv.factoryFloor)}</td>
        <td class="num">${fmt(inv.edgeLine)}</td>
        <td class="num"><b>${fmt(inv.total)}</b></td>
        <td class="num" style="color:${scrap?'var(--danger)':'inherit'}">${scrap? '−'+fmt(scrap) : '—'}</td>
        <td class="num"><b>${fmt(available)}</b></td>
      </tr>`;
  }).join('');

  tbl.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* =========================================================
   BUTTONS
   ========================================================= */
function bindButtons() {
  $('#bomFolderPick').addEventListener('click', pickBomFolder);
  $('#bomFolderProcess').addEventListener('click', processBomFolder);
  bindFolderFallback();
  bindBomListSearch();
  $('#bomProgressToggle').addEventListener('click', () => {
    const list = $('#bomProgressList');
    const btn  = $('#bomProgressToggle');
    const nowHidden = list.classList.toggle('hidden');
    btn.textContent = nowHidden ? '▸ Display batch list' : '▾ Hide batch list';
  });
  $('#bomSearch').addEventListener('input', renderBomTable);
  $('#bomFilter').addEventListener('change', renderBomTable);
  $('#invSearch').addEventListener('input', renderInventoryTable);
  $('#planSearch').addEventListener('input', renderPlanning);
  $('#planOnlyShort').addEventListener('change', renderPlanning);
  $('#batchSearch').addEventListener('input', renderBatchTable);
  ['c_factoryFloor','c_edgeLine','c_inTransit','c_safety'].forEach(id =>
    $('#'+id).addEventListener('change', renderPlanning));

  $('#batchClearFilters').addEventListener('click', () => {
    STATE.batchView = { sorts: {}, filters: {} };
    $('#batchSearch').value = '';
    renderBatchTable();
  });

  $('#autoClassify').addEventListener('click', () => {
    classifyBatches(); renderBatchStats(); renderBatchTable();
    computeInventory(); renderInventoryTable(); renderPlanning();
  });

  $('#planAdd').addEventListener('click', () => {
    const bomKey = $('#planModel').value;
    const qty    = Number($('#planQty').value);
    if (!bomKey || !qty) return;
    STATE.plan.push({ bomKey, qty });
    $('#planQty').value = '';
    renderPlanList(); renderPlanning();
  });
  $('#planClear').addEventListener('click', () => { STATE.plan = []; renderPlanList(); renderPlanning(); });

  $('#exportBom').addEventListener('click', exportBom);
  $('#exportInv').addEventListener('click', exportInventory);
  $('#exportPlan').addEventListener('click', exportPlan);

  $('#whAdd').addEventListener('click', () => {
    STATE.config.warehouses.push({ id: 'WH'+(STATE.config.warehouses.length+1), name:'New warehouse', enabled:true });
    renderWarehouseEditor(); renderWarehouseChecklist(); renderBatchStats();
  });
  $('#whSave').addEventListener('click', saveWarehouses);

  $('#convAdd').addEventListener('click', () => {
    STATE.config.conversionTable.push({ modelo:'', color:'', vehicleMatNo:'' });
    renderConversionTable();
  });
  $('#convSave').addEventListener('click', saveConversionTable);

  $('#resetAll').addEventListener('click', () => {
    if (!confirm('Erase all uploaded data and local overrides?')) return;
    STATE.boms = []; STATE.batches = []; STATE.plan = []; STATE.scrap = [];
    STATE.inventory = {}; STATE.partIndex = {};
    STATE.batchView = { sorts: {}, filters: {} };
    STATE.bomRegistry = new Map();
    STATE.bomCounter  = new Map();
    WHERE_USED_OPEN.clear();
    savePersistedScrap();
    try { localStorage.removeItem(LS_CONFIG); } catch(e){}
    _bomFolderHandle = null;
    _bomFolderFiles  = [];
    $('#bomFolderPath').value = '';
    $('#bomFolderInfo').textContent = 'No folder selected yet.';
    $('#bomFolderProcess').disabled = true;
    $('#bomProgressWrap').classList.add('hidden');
    $('#bomListSearch').value = '';
    $('#bomListSearchResult').classList.add('hidden');
    $('#bomListSearchResult').innerHTML = '';
    $('#bomProgressToggle').classList.add('hidden');
    $('#bomProgressToggle').classList.remove('has-errors');
    $('#bomProgressList').classList.add('hidden');
    renderBomList(); renderBomTable(); renderBatchTable(); renderBatchStats();
    renderInventoryTable(); renderPlanList(); renderPlanning();
    renderScrapList(); renderConversionTable();
  });

  bindScrapForm();
}

/* =========================================================
   PLAN
   ========================================================= */
function renderPlanList() {
  const wrap = $('#planList');
  if (!STATE.plan.length) { wrap.innerHTML = '<span class="hint" style="margin:0">No plan items yet.</span>'; return; }
  wrap.innerHTML = STATE.plan.map((p, i) => {
    const bom = STATE.boms.find(b => bomKeyOf(b) === p.bomKey);
    const label = bom ? bomDisplayName(bom) : p.bomKey;
    return `
      <div class="file-item">
        <span class="tag" title="${escapeHtml(label)}">${escapeHtml(shorten(label, 40))}</span>
        <div class="grow">${fmt(p.qty)} vehicles</div>
        <button class="btn ghost" data-i="${i}">✕</button>
      </div>`;
  }).join('');
  wrap.querySelectorAll('button').forEach(b => b.addEventListener('click', e => {
    STATE.plan.splice(+e.target.dataset.i, 1);
    renderPlanList(); renderPlanning();
  }));
}

function renderWarehouseChecklist() {
  const wrap = $('#whChecklist');
  const active = STATE.config.warehouses.filter(w => w.enabled);
  wrap.innerHTML = active.map(w => `
    <label class="toggle">
      <input type="checkbox" data-wh="${w.id}" checked/>
      ${escapeHtml(w.name)}
    </label>
  `).join('');
  wrap.querySelectorAll('input[data-wh]').forEach(inp => {
    inp.addEventListener('change', renderPlanning);
  });
}

function renderWarehouseEditor() {
  const wrap = $('#whEditor');
  wrap.innerHTML = STATE.config.warehouses.map((w,i) => `
    <div class="wh-row">
      <input type="checkbox" data-i="${i}" data-role="enabled" ${w.enabled?'checked':''}/>
      <input type="text" data-i="${i}" data-role="name" value="${escapeHtml(w.name)}"/>
      <button data-i="${i}" data-role="del">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('input').forEach(inp => inp.addEventListener('change', e => {
    const i = +e.target.dataset.i;
    if (e.target.dataset.role === 'name')    STATE.config.warehouses[i].name = e.target.value;
    if (e.target.dataset.role === 'enabled') STATE.config.warehouses[i].enabled = e.target.checked;
  }));
  wrap.querySelectorAll('button[data-role=del]').forEach(b => b.addEventListener('click', e => {
    STATE.config.warehouses.splice(+e.target.dataset.i, 1);
    renderWarehouseEditor(); renderWarehouseChecklist();
  }));
}
function saveWarehouses() {
  savePersistedOverrides();
  renderWarehouseChecklist();
  renderBatchStats();
  renderBatchTable();
  computeInventory();
  renderInventoryTable();
  renderPlanning();
  alert('Warehouses updated.');
}

function renderConversionTable() {
  const wrap = $('#convTable');
  if (!wrap) return;
  const rows = STATE.config.conversionTable || [];
  wrap.innerHTML = `
    <div class="conv-head">
      <span>Modelo (batch)</span>
      <span>Color (batch)</span>
      <span>Vehicle Material No. (BOM)</span>
      <span></span>
    </div>
    ${rows.map((r,i) => `
      <div class="conv-row" data-i="${i}">
        <input type="text" data-role="modelo" value="${escapeHtml(r.modelo||'')}" placeholder="e.g. S400 HEV Excellence" />
        <input type="text" data-role="color"  value="${escapeHtml(r.color||'')}"  placeholder="blank = any color" />
        <input type="text" class="mono" data-role="vehno" value="${escapeHtml(r.vehicleMatNo||'')}" placeholder="e.g. LE60U5BWL01" />
        <button data-role="del" title="Delete">✕</button>
      </div>
    `).join('')}
  `;
  wrap.querySelectorAll('input').forEach(inp => inp.addEventListener('input', e => {
    const i = +e.target.closest('.conv-row').dataset.i;
    const r = STATE.config.conversionTable[i];
    if (e.target.dataset.role === 'modelo') r.modelo = e.target.value;
    if (e.target.dataset.role === 'color')  r.color  = e.target.value;
    if (e.target.dataset.role === 'vehno')  r.vehicleMatNo = e.target.value;
  }));
  wrap.querySelectorAll('button[data-role=del]').forEach(b => b.addEventListener('click', e => {
    const i = +e.target.closest('.conv-row').dataset.i;
    STATE.config.conversionTable.splice(i, 1);
    renderConversionTable();
  }));
}

function saveConversionTable() {
  savePersistedOverrides();
  renderBatchTable();
  renderBatchStats();
  computeInventory();
  renderInventoryTable();
  renderPlanning();
  alert('Conversion table saved.');
}

/* =========================================================
   PLANNING
   ========================================================= */
function renderPlanning() {
  const tbl = $('#planTable');
  if (!STATE.plan.length) {
    tbl.innerHTML = `<thead><tr><th>Add plan items above</th></tr></thead>`;
    $('#planStats').innerHTML = '';
    return;
  }
  if (!Object.keys(STATE.partIndex).length) {
    tbl.innerHTML = `<thead><tr><th>Upload BOM files first</th></tr></thead>`;
    return;
  }

  const useFF  = $('#c_factoryFloor').checked;
  const useEL  = $('#c_edgeLine').checked;
  const useIT  = $('#c_inTransit').checked;
  const safety = parseFloat($('#c_safety').value) || 1.0;
  const whOn = {};
  $$('#whChecklist input[data-wh]').forEach(i => whOn[i.dataset.wh] = i.checked);
  const scrapMap = scrapByPartNo();

  const required = {};
  for (const p of STATE.plan) {
    for (const [partNo, info] of Object.entries(STATE.partIndex)) {
      const q = info.perBomQty[p.bomKey];
      if (!q) continue;
      required[partNo] = (required[partNo] || 0) + q * p.qty * safety;
    }
  }

  const q = ($('#planSearch').value || '').toLowerCase();
  const onlyShort = $('#planOnlyShort').checked;
  const rows = [];

  for (const [partNo, req] of Object.entries(required)) {
    const info = STATE.partIndex[partNo];
    const inv  = STATE.inventory[partNo] ||
      {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    let avail = 0;
    if (useFF) avail += inv.factoryFloor;
    if (useEL) avail += inv.edgeLine;
    if (useIT) avail += inv.inTransit;
    for (const [whId, on] of Object.entries(whOn)) {
      if (on) avail += inv.warehouses[whId] || 0;
    }
    avail -= (scrapMap[partNo] || 0);
    const short = Math.max(0, req - avail);
    if (onlyShort && short <= 0) continue;
    if (q) {
      const hay = `${partNo} ${info.nameCN} ${info.nameEN}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ partNo, info, req, avail, short });
  }

  rows.sort((a,b) => (b.short - a.short) || a.partNo.localeCompare(b.partNo));
  const shortCount = rows.filter(r => r.short > 0).length;

  $('#planStats').innerHTML = `
    <div class="stat"><div class="label">Parts required</div><div class="value">${rows.length}</div></div>
    <div class="stat"><div class="label">Parts short</div><div class="value" style="color:${shortCount?'var(--danger)':'var(--ok)'}">${shortCount}</div></div>
    <div class="stat"><div class="label">Total vehicles</div><div class="value">${fmt(STATE.plan.reduce((a,p)=>a+p.qty,0))}</div></div>
  `;

  tbl.innerHTML = `
    <thead><tr>
      <th>Part No.</th><th>Name</th><th>UOM</th>
      <th class="num">Required</th>
      <th class="num">Available</th>
      <th class="num">Shortage</th>
      <th>Status</th>
    </tr></thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td><b>${escapeHtml(r.partNo)}</b></td>
          <td>${escapeHtml(r.info.nameCN || r.info.nameEN)}</td>
          <td>${escapeHtml(r.info.uom)}</td>
          <td class="num">${fmt(r.req)}</td>
          <td class="num">${fmt(r.avail)}</td>
          <td class="num" style="color:${r.short>0?'var(--danger)':'inherit'};font-weight:${r.short>0?'600':'400'}">${fmt(r.short)}</td>
          <td>${r.short > 0 ? '<span class="pill short">SHORT</span>' : '<span class="pill ok">OK</span>'}</td>
        </tr>`).join('')}
    </tbody>`;
}

/* =========================================================
   EXPORTS
   ========================================================= */
function downloadWorkbook(wb, filename) { XLSX.writeFile(wb, filename); }
function aoaToSheet(aoa) { return XLSX.utils.aoa_to_sheet(aoa); }

function exportBom() {
  const boms = STATE.boms;
  const aoa = [['Part No.','Name','UOM','Type','BOMs Used', ...boms.map(b => bomDisplayName(b))]];
  for (const p of Object.values(STATE.partIndex)) {
    aoa.push([
      p.partNo, p.nameEN || p.nameCN, p.uom,
      p.isCommon ? 'COMMON' : 'SPECIFIC',
      [...p.bomKeys].join(' | '),
      ...boms.map(b => p.perBomQty[bomKeyOf(b)] || '')
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'Material List');
  downloadWorkbook(wb, `Material_List_${dateStamp()}.xlsx`);
}

function exportInventory() {
  const whEnabled = STATE.config.warehouses.filter(w => w.enabled);
  const scrapMap = scrapByPartNo();
  const aoa = [['Part No.','Name','UOM','In Transit', ...whEnabled.map(w=>w.name),
                'Factory Floor','Edge Line','Total','Scrap','Available']];
  for (const p of Object.values(STATE.partIndex)) {
    const inv = STATE.inventory[p.partNo] ||
      {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    const scrap = scrapMap[p.partNo] || 0;
    aoa.push([
      p.partNo, p.nameCN || p.nameEN, p.uom,
      inv.inTransit,
      ...whEnabled.map(w => inv.warehouses[w.id] || 0),
      inv.factoryFloor, inv.edgeLine, inv.total,
      scrap, inv.total - scrap
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'Inventory');
  downloadWorkbook(wb, `Material_Inventory_${dateStamp()}.xlsx`);
}

function exportPlan() {
  const useFF  = $('#c_factoryFloor').checked;
  const useEL  = $('#c_edgeLine').checked;
  const useIT  = $('#c_inTransit').checked;
  const safety = parseFloat($('#c_safety').value) || 1.0;
  const whOn = {};
  $$('#whChecklist input[data-wh]').forEach(i => whOn[i.dataset.wh] = i.checked);
  const scrapMap = scrapByPartNo();

  const required = {};
  for (const p of STATE.plan) {
    for (const [partNo, info] of Object.entries(STATE.partIndex)) {
      const q = info.perBomQty[p.bomKey];
      if (!q) continue;
      required[partNo] = (required[partNo] || 0) + q * p.qty * safety;
    }
  }

  const aoa = [
    ['Plan:', ...STATE.plan.map(p => {
      const bom = STATE.boms.find(b => bomKeyOf(b) === p.bomKey);
      return `${bom ? bomDisplayName(bom) : p.bomKey} × ${p.qty}`;
    })],
    ['Safety factor:', safety],
    [],
    ['Part No.','Name','UOM','Required','Available','Shortage','Status']
  ];
  for (const [partNo, req] of Object.entries(required)) {
    const info = STATE.partIndex[partNo];
    const inv  = STATE.inventory[partNo] ||
      {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    let avail = 0;
    if (useFF) avail += inv.factoryFloor;
    if (useEL) avail += inv.edgeLine;
    if (useIT) avail += inv.inTransit;
    for (const [whId,on] of Object.entries(whOn)) if (on) avail += inv.warehouses[whId] || 0;
    avail -= (scrapMap[partNo] || 0);
    const short = Math.max(0, req - avail);
    aoa.push([
      partNo, info.nameCN || info.nameEN, info.uom,
      round3(req), round3(avail), round3(short), short > 0 ? 'SHORT' : 'OK'
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'Plan');
  downloadWorkbook(wb, `Production_Plan_${dateStamp()}.xlsx`);
}

/* =========================================================
   DISPLAY BOM MODAL
   ========================================================= */
function openBomDisplay(bomId) {
  const rep = STATE.boms.find(b => b.bomId === bomId);
  if (!rep) { alert(`BOM "${bomId}" not found.`); return; }

  const modal = $('#bomDisplayModal');
  modal.dataset.bomid = bomId;

  const linkedBoms = STATE.boms.filter(b => b.bomId === bomId);

  const linkedBatchIds = new Set(linkedBoms.map(b => b.batchId).filter(Boolean));
  const batchMwoSet = new Set();
  for (const batch of STATE.batches) {
    if (linkedBatchIds.has(batch.batch) && batch.mwo) batchMwoSet.add(batch.mwo);
  }
  const batchMwos = Array.from(batchMwoSet).sort();

  modal.querySelector('.bdm-title').textContent = `BOM Contents — ${bomId}`;
  const subtitleHtml =
    `<span class="bdm-meta">
       ${linkedBoms.length} sales batch${linkedBoms.length === 1 ? '' : 'es'}
     </span>`
    + (batchMwos.length
      ? ` <span class="bdm-mwo">MWO: ${batchMwos.map(escapeHtml).join(', ')}</span>`
      : '');
  modal.querySelector('.bdm-subtitle').innerHTML = subtitleHtml;

  const hasMwo = rep.parts.some(p => p.mwo);

  const partsRows = rep.parts
    .slice()
    .sort((a, b) => String(a.partNo).localeCompare(String(b.partNo), undefined, { numeric: true }))
    .map(p => `
      <tr>
        <td class="mono">${escapeHtml(p.partNo)}</td>
        <td>${escapeHtml(p.nameEN || p.nameCN || '')}</td>
        <td class="num">${fmt(p.qty)}</td>
        <td>${escapeHtml(p.uom || '')}</td>
        ${hasMwo ? `<td class="mono">${escapeHtml(p.mwo || '')}</td>` : ''}
      </tr>`)
    .join('');

  modal.querySelector('.bdm-body').innerHTML = `
    <table class="bdm-table">
      <thead>
        <tr>
          <th>Material Number</th>
          <th>Material Description</th>
          <th class="num">Qty per car</th>
          <th>UoM</th>
          ${hasMwo ? '<th>MWO</th>' : ''}
        </tr>
      </thead>
      <tbody>${partsRows}</tbody>
    </table>`;

  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeBomDisplay() {
  const modal = $('#bomDisplayModal');
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function exportBomDisplay() {
  const modal = $('#bomDisplayModal');
  const bomId = modal.dataset.bomid;
  const rep = STATE.boms.find(b => b.bomId === bomId);
  if (!rep) return;

  const hasMwo = rep.parts.some(p => p.mwo);

  const header = ['Material Number', 'Material Description', 'Qty per car', 'UoM'];
  if (hasMwo) header.push('MWO');

  const aoa = [header];
  rep.parts
    .slice()
    .sort((a, b) => String(a.partNo).localeCompare(String(b.partNo), undefined, { numeric: true }))
    .forEach(p => {
      const row = [p.partNo, p.nameEN || p.nameCN || '', p.qty, p.uom || ''];
      if (hasMwo) row.push(p.mwo || '');
      aoa.push(row);
    });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), (bomId || 'BOM').substring(0, 28));
  downloadWorkbook(wb, `${(bomId || 'BOM').replace(/\s+/g, '_')}_${dateStamp()}.xlsx`);
}

function bindBomDisplayModal() {
  $('#bdmClose')?.addEventListener('click', closeBomDisplay);
  $('#bdmExport')?.addEventListener('click', exportBomDisplay);
  $('#bomDisplayModal')?.addEventListener('click', e => {
    if (e.target.id === 'bomDisplayModal') closeBomDisplay();
  });
  document.addEventListener('keydown', e => {
    const m = $('#bomDisplayModal');
    if (e.key === 'Escape' && m && !m.classList.contains('hidden')) closeBomDisplay();
  });
}

/* =========================================================
   UTILITIES
   ========================================================= */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[c]);
}
function shorten(s, n) { s = String(s||''); return s.length > n ? s.slice(0, n-1) + '…' : s; }
function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function round3(n) { return Math.round(n * 1000) / 1000; }
/* =========================================================
   PRODUCTION MONITORING
   ========================================================= */
const PROD_STAGES = [
  { key: 'devanning',   label: '005 De-vanning',       short: 'DEV', color: '#94a3b8' },
  { key: 'trimIn',      label: '020 Trim-in',          short: 'TRM', color: '#3b82f6' },
  { key: 'offLine',     label: '030 Off-line OK',      short: 'OFF', color: '#8b5cf6' },
  { key: 'buyOff',      label: 'Buy-off OK',           short: 'BUY', color: '#f59e0b' },
  { key: 'compoundIn',  label: 'Compound Gate-in',     short: 'CIN', color: '#10b981' },
  { key: 'compoundOut', label: 'Compound Gate-out OK', short: 'COT', color: '#059669' }
];

/* Sequence first letter → production line */
const PROD_LINE_MAP = { A: 'A0', B: 'M1', D: 'M0' };

/* CSV column auto-detection hints (exact → fallback contains) */
const PROD_COL_HINTS = {
  code:         ['code'],
  sequence:     ['sequence'],
  batch:        ['batch'],
  description:  ['description'],
  color:        ['color'],
  colorCode:    ['colorcode', 'color code'],
  materialCode: ['materialcode', 'material code'],
  devanning:    ['005 devanning'],
  trimIn:       ['020 trim in'],
  offLine:      ['030 off line ok'],
  diverted:     ['025 diverted'],                          // ← NEW
  buyOff:       ['buy off ok'],
  compoundIn:   ['compound gate in in', 'compound gate in'],
  compoundOut:  ['compound gate out ok']
};
/* VIN normalisation: strip every non-alphanumeric separator */
function cleanVin(s) {
  if (!s) return '';
  return String(s).replace(/[^A-Za-z0-9]/g, '');
}

/* Displayed VIN — prefers the human-readable 'code' column,
   falls back to the raw vinId (dashes stripped). */
function displayVin(rec) {
  if (!rec || !rec.code) return '';
  return cleanVin(rec.code);
}
/* Most-frequent value of a field across a set of VIN records.
   Used to derive a batch's dominant model / colour. */
function dominantField(vins, field) {
  if (!vins || !vins.length) return '';
  const counts = {};
  for (const v of vins) {
    const val = v[field] || '';
    counts[val] = (counts[val] || 0) + 1;
  }
  let best = '', bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}
/* Most-frequent production line across a batch's VINs. */
function dominantLine(batch) {
  if (!batch || !batch.vins || !batch.vins.length) return '—';
  const counts = {};
  for (const r of batch.vins) {
    const l = lineOfSequence(r.sequence);
    counts[l] = (counts[l] || 0) + 1;
  }
  let best = '—', bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}
/* Distinct production lines present in the loaded file. */
function getAvailableLines() {
  const s = new Set();
  for (const r of STATE.production.records) s.add(lineOfSequence(r.sequence));
  return Array.from(s).sort();
}

/* Distinct model descriptions present in the loaded file. */
function getAvailableModels() {
  const s = new Set();
  for (const r of STATE.production.records) {
    if (r.description) s.add(r.description);
  }
  return Array.from(s).sort();
}

/* True if the record matches the currently applied line / model filters. */
function recordMatchesLineModel(rec) {
  const line = lineOfSequence(rec.sequence);
  if (STATE.production.lines  && !STATE.production.lines.has(line))            return false;
  const model = rec.description || '';
  if (STATE.production.models && !STATE.production.models.has(model))          return false;
  return true;
}

/* Combined: period + line + model. */
function recordMatchesFilters(rec) {
  return recordInPeriod(rec) && recordMatchesLineModel(rec);
}

/* Set equality that treats null/undefined as "all". */
function setsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
/* Track which spec / colour groups the user has collapsed.
   (Batch expansion already uses PROD_BATCH_EXPANDED.) */
const PROD_SPEC_COLLAPSED  = new Set();
const PROD_COLOR_COLLAPSED = new Set();
const PROD_LINE_COLLAPSED = new Set();

function lineOfSequence(seq) {
  if (!seq) return '—';
  return PROD_LINE_MAP[seq.charAt(0).toUpperCase()] || '—';
}

function formatProdTime(s) {
  if (!s) return '<span class="prod-empty">—</span>';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return escapeHtml(s);
  const [, y, mo, d, h, mi] = m;
  return `<span title="${escapeHtml(s)}">${d}/${mo}/${y} ${h}:${mi}</span>`;
}
/* Merge "030 OFF LINE OK" and "025 DIVERTED".
   Reads the first 10 characters of each value as YYYY-MM-DD and returns
   the full original string of whichever date is earlier. If neither cell
   contains a usable date, returns ''. */
function mergeOffLineDates(offLineVal, divertedVal) {
  const a = String(offLineVal || '').trim();
  const b = String(divertedVal || '').trim();
  const da = a.slice(0, 10);
  const db = b.slice(0, 10);
  const hasA = /^\d{4}-\d{2}-\d{2}$/.test(da);
  const hasB = /^\d{4}-\d{2}-\d{2}$/.test(db);
  if (!hasA && !hasB) return '';
  if (!hasA) return b;
  if (!hasB) return a;
  /* YYYY-MM-DD sorts lexically, so a simple string compare works */
  return da <= db ? a : b;
}
/* ---- Streaming CSV parser (chunked, yields to UI) ---- */
async function parseProductionCSV(text, onProgress) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const len = text.length;
  let i = 0, field = '', row = [], inQ = false;
  let lastYield = performance.now();

  /* -- 1. Parse header row -- */
  const header = [];
  let headerDone = false;
  while (i < len && !headerDone) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { header.push(field); field = ''; }
      else if (c === '\n') { header.push(field); field = ''; headerDone = true; }
      else if (c !== '\r') field += c;
    }
    i++;
  }

  /* -- 2. Map header names → column indices -- */
  const headerLower = header.map(h => String(h).trim().toLowerCase());
  const idx = {};
  for (const [key, hints] of Object.entries(PROD_COL_HINTS)) {
    let found = -1;
    for (const h of hints) {
      const p = headerLower.indexOf(h);
      if (p >= 0) { found = p; break; }
    }
    if (found < 0) {
      for (const h of hints) {
        if (h.length < 5) continue;              // ← skip short hints on fallback
        const p = headerLower.findIndex(x => x.includes(h));
        if (p >= 0) { found = p; break; }
      }
    }
    idx[key] = found;
  }
  if (idx.code < 0) throw new Error('Required column "code" not found in CSV header');

  const maxIdx = Math.max(...Object.values(idx).filter(x => x >= 0));
  const records = [];

  /* -- 3. Parse data rows directly into lean objects -- */
  field = ''; row = []; inQ = false;

  const finalizeRow = () => {
    row.push(field); field = '';
    if (row.length > maxIdx) {
      const code = String(row[idx.code] ?? '').trim();
      if (code) {
        const rec = { code };
        for (const [key, ci] of Object.entries(idx)) {
          if (key === 'code' || ci < 0) continue;
          rec[key] = String(row[ci] ?? '').trim();
        }

        /* Off-line OK = earlier of 030 OFF LINE OK and 025 DIVERTED */
        rec.offLine = mergeOffLineDates(rec.offLine, rec.diverted);
        delete rec.diverted;

        records.push(rec);
      }
    }
    row = [];
  };

  while (i < len) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { finalizeRow(); i++; continue; }
    if (c === '\r') { i++; continue; }
    field += c; i++;

    if (performance.now() - lastYield > 50) {
      lastYield = performance.now();
      onProgress && onProgress(i / len, records.length);
      await yieldToUI();
    }
  }
  if (field.length || row.length) finalizeRow();

  return { records, header };
}

function computeProductionBatches(records) {
  const map = new Map();
  for (const r of records) {
    const id = r.batch || '(no batch)';
    let b = map.get(id);
    if (!b) { b = { id, vins: [], counts: {} }; map.set(id, b); }
    b.vins.push(r);
    for (const s of PROD_STAGES) {
      if (r[s.key]) b.counts[s.key] = (b.counts[s.key] || 0) + 1;
    }
  }
  return map;
}

/* ---- File ingestion ---- */
async function handleProductionFiles(files) {
  const f = files[0];
  if (!f) return;

  const wrap  = $('#prodProgressWrap');
  const fill  = $('#prodProgressFill');
  const label = $('#prodProgressLabel');
  wrap.classList.remove('hidden');
  fill.style.width = '0%';
  label.textContent = `Reading ${f.name} (${fmt(f.size / 1048576)} MB)…`;
  await yieldToUI();

  try {
    const text = await readFileAsText(f);
    label.textContent = `Parsing ${fmt(text.length)} characters…`;
    await yieldToUI();

    const { records, header } = await parseProductionCSV(text, (p, n) => {
      fill.style.width = (p * 100).toFixed(1) + '%';
      label.textContent = `Parsing… ${(p * 100).toFixed(0)}% · ${fmt(n)} VINs extracted`;
    });

    if (!records.length) throw new Error('No valid VIN rows found');

    /* --- Reset state --- */
    STATE.production.records = records;
    STATE.production.batches = computeProductionBatches(records);
    STATE.production.header  = header;
    STATE.production.loaded  = true;
    STATE.production.vinView.page = 1;
    STATE.production.batchView.search = '';
    STATE.production.vinView.search = '';
    STATE.production.vinView.stage = 'all';
    STATE.production.periodStage        = '';   // ← ADD
    STATE.production.pendingPeriodStage = '';   // ← ADD
    $('#prodPeriodStage').value = '';           // ← ADD     
    $('#prodBatchSearch').value = '';
    $('#prodVinSearch').value = '';
    $('#prodVinStage').value = 'all';

     PROD_BATCH_EXPANDED.clear();
     PROD_LINE_COLLAPSED.clear();     // ← add
     PROD_SPEC_COLLAPSED.clear();
     PROD_COLOR_COLLAPSED.clear();

    /* --- Default monitoring period = entire file --- */
    const { min, max } = getFileDateBounds();
    STATE.production.period        = { from: min || '', to: max || '' };
    STATE.production.pendingPeriod = { from: min || '', to: max || '' };
    STATE.production.lines         = null;
    STATE.production.pendingLines  = null;
    STATE.production.models        = null;
    STATE.production.pendingModels = null;
    
     $('#prodPeriodFrom').value = min || '';
    $('#prodPeriodTo').value   = max || '';

    /* Highlight the "Full Range" button */
    $$('.prod-period-btn').forEach(b =>
      b.classList.toggle('primary', b.dataset.range === 'all'));

    /* --- Render --- */
    renderLineModelOptions();
    fill.style.width = '100%';
    label.textContent = `Done — ${fmt(records.length)} VINs · ${fmt(STATE.production.batches.size)} batches`;

    renderAllProductionViews();
    updateProductionPeriodHint();
    updateApplyButtonState();

    setTimeout(() => wrap.classList.add('hidden'), 3000);
  } catch (e) {
    console.error(e);
    label.textContent = `Failed: ${e.message}`;
    alert(`Failed to parse production file: ${e.message}`);
  }
}

function clearProduction() {
  if (!STATE.production.loaded) return;
  if (!confirm('Clear all loaded production tracking data?')) return;

  STATE.production = {
    records: [], batches: new Map(), header: null, loaded: false,
    period:        { from: '', to: '' },
    pendingPeriod: { from: '', to: '' },
    periodStage:        '',
    pendingPeriodStage: '',     
    lines:         null, pendingLines:  null,
    models:        null, pendingModels: null,
    batchView: { search: '', filter: 'all' },
    vinView:   { page: 1, pageSize: 100, search: '', stage: 'all' }
  };
  PROD_BATCH_EXPANDED.clear();
  PROD_LINE_COLLAPSED.clear();
  PROD_SPEC_COLLAPSED.clear();
  PROD_COLOR_COLLAPSED.clear();

  const fromEl = $('#prodPeriodFrom'); if (fromEl) fromEl.value = '';
  const toEl   = $('#prodPeriodTo');   if (toEl)   toEl.value   = '';
  $$('.prod-period-btn').forEach(b => b.classList.remove('primary'));
  
   const stageSel = $('#prodPeriodStage');
  if (stageSel) stageSel.value = '';
   
  const applyBtn = $('#prodPeriodApply');
  if (applyBtn) { applyBtn.disabled = true; applyBtn.classList.remove('pending'); }

  const lineValues  = $('#prodLineValues');  if (lineValues)  lineValues.innerHTML = '';
  const modelValues = $('#prodModelValues'); if (modelValues) modelValues.innerHTML = '';
  syncMultiselectUI();

  $('#prodProgressWrap').classList.add('hidden');
  renderAllProductionViews();
  updateProductionPeriodHint();
  updateApplyButtonState();
}
/* =========================================================
   MONITORING PERIOD
   ========================================================= */
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

/* Min/max date present in the loaded file across ALL stages. */
function getFileDateBounds() {
  let min = null, max = null;
  for (const r of STATE.production.records) {
    for (const s of PROD_STAGES) {
      const t = r[s.key];
      if (!t) continue;
      const m = String(t).match(/^(\d{4}-\d{2}-\d{2})/);
      if (!m) continue;
      const d = m[1];
      if (min === null || d < min) min = d;
      if (max === null || d > max) max = d;
    }
  }
  return { min, max };
}

/* Compute { from, to } for a named quick-range, using the system clock. */
function getPeriodRange(kind) {
  const t = new Date(); t.setHours(0,0,0,0);
  switch (kind) {
    case 'all': {
      const { min, max } = getFileDateBounds();
      return { from: min || '', to: max || '' };
    }
        case 'thisWeek': {
      // Monday → Sunday of the current week
      const day = t.getDay() || 7;                       // Sunday=7
      const mon = new Date(t); mon.setDate(t.getDate() - (day - 1));
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { from: ymdLocal(mon), to: ymdLocal(sun) };
    }
    case 'thisMonth': {
      const y = t.getFullYear(), m = t.getMonth();
      const first = new Date(y, m, 1);
      const last  = new Date(y, m + 1, 0);
      return { from: ymdLocal(first), to: ymdLocal(last) };
    }
    case 'thisYear': {
      const y = t.getFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }    
    case 'today': {
      const s = ymdLocal(t);
      return { from: s, to: s };
    }
    case 'yesterday': {
      const y = new Date(t); y.setDate(y.getDate()-1);
      const s = ymdLocal(y);
      return { from: s, to: s };
    }
    case 'lastWeek': {
      // Previous Monday → Sunday
      const day = t.getDay() || 7;
      const thisMon = new Date(t); thisMon.setDate(t.getDate() - (day - 1));
      const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
      const lastSun = new Date(lastMon); lastSun.setDate(lastMon.getDate() + 6);
      return { from: ymdLocal(lastMon), to: ymdLocal(lastSun) };
    }
    case 'lastMonth': {
      const y  = t.getFullYear();
      const m  = t.getMonth();
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      const first = new Date(py, pm, 1);
      const last  = new Date(py, pm + 1, 0);
      return { from: ymdLocal(first), to: ymdLocal(last) };
    }
    case 'lastYear': {
      const y = t.getFullYear() - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: '', to: '' };
  }
}

/* True if the given timestamp falls inside the current monitoring period. */
function stageInPeriod(ts) {
  const p = STATE.production.period || {};
  const from = p.from || '', to = p.to || '';
  if (!from && !to) return true;
  if (!ts) return false;
  const d = String(ts).slice(0, 10);
  if (from && d < from) return false;
  if (to   && d > to)   return false;
  return true;
}
/* As-of semantics: does this timestamp fall on or before period.to?
   Used for STAGE COUNTING (KPIs + batch columns).
   VIN SELECTION still uses the range-based stageInPeriod().
   - period.to set         → ts ≤ period.to
   - period.to empty, from → fall back to range (ts ≥ from)
   - both empty            → true */
function stageReachedByPeriod(ts) {
  if (!ts) return false;
  const d = String(ts).slice(0, 10);
  const p = STATE.production.period || {};
  if (!p.to) {
    if (!p.from) return true;
    return d >= p.from;
  }
  return d <= p.to;
}
/* True if the record is inside the current monitoring period,
   evaluated against the selected milestone (or any milestone if none chosen). */
function recordInPeriod(rec) {
  const p = STATE.production.period || {};
  const stage = STATE.production.periodStage || '';

  // No date range set → nothing to filter on
  if (!p.from && !p.to) return true;

  // Scoped to a specific milestone
  if (stage) {
    return !!(rec[stage] && stageInPeriod(rec[stage]));
  }

  // Any-milestone mode (current default)
  for (const s of PROD_STAGES) {
    if (rec[s.key] && stageInPeriod(rec[s.key])) return true;
  }
  return false;
}

function getFilteredProductionRecords() {
  if (!STATE.production.loaded) return [];
  const p = STATE.production.period || {};
  const noPeriodFilter = !p.from && !p.to;
  const noLineFilter   = !STATE.production.lines;
  const noModelFilter  = !STATE.production.models;
  if (noPeriodFilter && noLineFilter && noModelFilter) return STATE.production.records;
  return STATE.production.records.filter(recordMatchesFilters);
}
/* ---- Pending-state staging ---- */
function isProductionPeriodDirty() {
  const a = STATE.production.period        || { from: '', to: '' };
  const p = STATE.production.pendingPeriod || { from: '', to: '' };

  const datesDirty = (a.from || '') !== (p.from || '') ||
                     (a.to   || '') !== (p.to   || '');
  const linesDirty  = !setsEqual(STATE.production.lines,  STATE.production.pendingLines);
  const modelsDirty = !setsEqual(STATE.production.models, STATE.production.pendingModels);
  const stageDirty  = (STATE.production.periodStage || '') !==
                      (STATE.production.pendingPeriodStage || '');

  return datesDirty || linesDirty || modelsDirty || stageDirty;
}


function updateApplyButtonState() {
  const btn = $('#prodPeriodApply');
  if (!btn) return;
  if (!STATE.production.loaded) {
    btn.disabled = true;
    btn.classList.remove('pending');
    return;
  }
  const dirty = isProductionPeriodDirty();
  btn.disabled = !dirty;
  btn.classList.toggle('pending', dirty);
}

/* Commit pending → applied, re-render once. */
function applyProductionPeriod() {
  if (!STATE.production.loaded) return;
  STATE.production.period = { ...STATE.production.pendingPeriod };
  STATE.production.lines  = STATE.production.pendingLines
    ? new Set(STATE.production.pendingLines) : null;
  STATE.production.models = STATE.production.pendingModels
    ? new Set(STATE.production.pendingModels) : null;
  STATE.production.periodStage = STATE.production.pendingPeriodStage || '';   // ← commit stage
  renderAllProductionViews();
  updateProductionPeriodHint();
  updateApplyButtonState();
}


/* Set both applied + pending (used on file load / reset). */
function setProductionPeriod(from, to, lines = null, models = null, stage = '') {
  STATE.production.period        = { from: from || '', to: to || '' };
  STATE.production.pendingPeriod = { from: from || '', to: to || '' };
  STATE.production.lines         = lines  ? new Set(lines)  : null;
  STATE.production.pendingLines  = lines  ? new Set(lines)  : null;
  STATE.production.models        = models ? new Set(models) : null;
  STATE.production.pendingModels = models ? new Set(models) : null;
  STATE.production.periodStage        = stage || '';    // ← ADD
  STATE.production.pendingPeriodStage = stage || '';    // ← ADD

  const fromEl = $('#prodPeriodFrom');
  const toEl   = $('#prodPeriodTo');
  const stEl   = $('#prodPeriodStage');
  if (fromEl) fromEl.value = from || '';
  if (toEl)   toEl.value   = to   || '';
  if (stEl)   stEl.value   = stage || '';

  syncMultiselectUI();
  renderAllProductionViews();
  updateProductionPeriodHint();
  updateApplyButtonState();
}



function renderAllProductionViews() {
  renderProductionStats();
  renderProductionBatchTable();
  renderProductionVinTable();
  renderProductionChart();
}

function updateProductionPeriodHint() {
  const el = $('#prodPeriodHint');
  if (!el) return;
  if (!STATE.production.loaded) { el.textContent = ''; return; }

  const total    = STATE.production.records.length;
  const filtered = getFilteredProductionRecords().length;

  const p = STATE.production.period || {};
  let rangeStr = 'full data';
  if (p.from || p.to) {
    const fmtD = s => s ? s.split('-').reverse().join('/') : '…';
    rangeStr = `${fmtD(p.from)} → ${fmtD(p.to)}`;
  }

  /* Milestone scope */
  const stageKey = STATE.production.periodStage || '';
  const stageStr = stageKey
    ? (PROD_STAGES.find(s => s.key === stageKey)?.label || stageKey)
    : 'any milestone';

  const lineStr = !STATE.production.lines
    ? 'all lines'
    : STATE.production.lines.size === 0 ? 'no lines'
    : `${STATE.production.lines.size} line${STATE.production.lines.size === 1 ? '' : 's'}`;

  const modelStr = !STATE.production.models
    ? 'all models'
    : STATE.production.models.size === 0 ? 'no models'
    : `${STATE.production.models.size} model${STATE.production.models.size === 1 ? '' : 's'}`;

  const { min, max } = getFileDateBounds();
  const fileRangeStr = (min && max)
    ? ` · File range: <span style="color:var(--muted)">${min.split('-').reverse().join('/')} → ${max.split('-').reverse().join('/')}</span>`
    : '';

  let pendingStr = '';
  if (isProductionPeriodDirty()) {
    pendingStr = ` · <b style="color:#d97706">Pending changes — click Apply</b>`;
  }

  el.innerHTML =
    `Period: <b>${rangeStr}</b> (on <b>${escapeHtml(stageStr)}</b>) · <b>${lineStr}</b> · <b>${modelStr}</b> · ` +
    `Showing <b>${fmt(filtered)}</b> of ${fmt(total)} VINs${fileRangeStr}${pendingStr}`;
}
/* Rebuild the checkbox lists for Line and Model dropdowns. */
function renderLineModelOptions() {
  const lines  = getAvailableLines();
  const models = getAvailableModels();

  const linesEl  = $('#prodLineValues');
  const modelsEl = $('#prodModelValues');

  if (linesEl) {
    linesEl.innerHTML = lines.map(l => `
      <label class="prod-ms-value">
        <input type="checkbox" data-kind="line" value="${escapeHtml(l)}" checked />
        <span>${escapeHtml(l || '—')}</span>
      </label>`).join('');
  }
  if (modelsEl) {
    modelsEl.innerHTML = models.map(m => `
      <label class="prod-ms-value" data-model-label="${escapeHtml(m.toLowerCase())}">
        <input type="checkbox" data-kind="model" value="${escapeHtml(m)}" checked />
        <span>${escapeHtml(m)}</span>
      </label>`).join('');
  }
  syncMultiselectUI();
}

/* Reflect current *pending* sets on the checkboxes + button labels. */
function syncMultiselectUI() {
  const pl = STATE.production.pendingLines;
  const pm = STATE.production.pendingModels;

  // Lines
  const lineChecks = $$('#prodLineValues input[type=checkbox]');
  lineChecks.forEach(cb => {
    cb.checked = !pl || pl.has(cb.value);
  });
  const lineLabel = $('#prodLineMS .prod-ms-label');
  if (lineLabel) {
    const avail = lineChecks.length;
    const n = pl ? pl.size : avail;
    lineLabel.textContent =
      n === 0        ? 'No Lines'
      : (!pl || n === avail) ? 'All Lines'
      : n === 1      ? Array.from(pl)[0]
      : `${n} Lines`;
  }

  // Models
  const modelChecks = $$('#prodModelValues input[type=checkbox]');
  modelChecks.forEach(cb => {
    cb.checked = !pm || pm.has(cb.value);
  });
  const modelLabel = $('#prodModelMS .prod-ms-label');
  if (modelLabel) {
    const avail = modelChecks.length;
    const n = pm ? pm.size : avail;
    modelLabel.textContent =
      n === 0        ? 'No Models'
      : (!pm || n === avail) ? 'All Models'
      : n === 1      ? Array.from(pm)[0]
      : `${n} Models`;
  }
}
/* =========================================================
   RENDER — Overall KPIs
   ========================================================= */
function renderProductionStats() {
  const wrap = $('#prodStats');
  if (!STATE.production.loaded) {
    wrap.innerHTML = '<div class="hint" style="margin:0">No production data loaded yet.</div>';
    return;
  }
  const filtered = getFilteredProductionRecords();
  const total    = filtered.length;

  const batchSet = new Set();
  for (const r of filtered) batchSet.add(r.batch || '(no batch)');

  // Per-stage count = VINs whose stage timestamp falls inside the period
  const counts = {};
  for (const s of PROD_STAGES) {
    let n = 0;
    for (const r of filtered) if (stageReachedByPeriod(r[s.key])) n++;
    counts[s.key] = n;
  }
  const complete = counts.compoundOut;

  const kpis = [
    { label: 'VINs in period', value: fmt(total),
      sub: `${fmt(batchSet.size)} batches`, color: '#2563eb' },
    { label: 'Complete', value: fmt(complete),
      sub: `${total ? (complete / total * 100).toFixed(1) : 0}%`, color: '#059669' },
    ...PROD_STAGES.map(s => {
      const n = counts[s.key];
      const pct = total ? (n / total * 100) : 0;
      return { label: s.label, value: fmt(n), sub: `${pct.toFixed(1)}%`, color: s.color };
    })
  ];

  wrap.innerHTML = kpis.map(k => `
    <div class="kpi-compact" title="${escapeHtml(k.label)}">
      <div class="kpi-bar" style="background:${k.color}"></div>
      <div class="kpi-body">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-value">${k.value}<span class="kpi-sub">${k.sub}</span></div>
      </div>
    </div>`).join('');
}
function prodBatchExpandAll() {
  PROD_LINE_COLLAPSED.clear();
  PROD_SPEC_COLLAPSED.clear();
  PROD_COLOR_COLLAPSED.clear();
  if (STATE.production.loaded) renderProductionBatchTable();
}

function prodBatchCollapseAll() {
  if (!STATE.production.loaded) return;
  for (const b of STATE.production.batches.values()) {
    const line  = dominantLine(b);
    const model = dominantField(b.vins, 'description') || '(no model)';
    const color = dominantField(b.vins, 'color')       || '(no colour)';
    const ccode = dominantField(b.vins, 'colorCode')   || '';

    PROD_LINE_COLLAPSED.add(line);
    PROD_SPEC_COLLAPSED.add(line + '||' + model);
    PROD_COLOR_COLLAPSED.add(line + '||' + model + '||' + color + '||' + ccode);
  }
  renderProductionBatchTable();
}
/* ---- Capacity trend chart ---- */
function bucketKeyFor(dateStr, granularity) {
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (granularity === 'day')   return `${y}-${mo}-${d}`;
  if (granularity === 'month') return `${y}-${mo}`;
  if (granularity === 'week') {
    const dt = new Date(Date.UTC(+y, +mo - 1, +d));
    const day = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - day);
    const yStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((dt - yStart) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return null;
}

function shortBucketLabel(key, granularity) {
  if (granularity === 'day')   return key.slice(5);        // MM-DD
  if (granularity === 'month') return key;                 // YYYY-MM
  return key.replace('-W', ' W');                          // YYYY Wnn
}

function niceCeil(n) {
  if (n <= 10) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(n)));
  const r = n / mag;
  const step = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
  return step * mag;
}

function renderProductionChart() {
  const canvas = $('#prodChart');
  const empty  = $('#prodChartEmpty');
  if (!canvas) return;

  if (!STATE.production.loaded || !STATE.production.records.length) {
    canvas.style.display = 'none';
    empty.style.display = '';
    empty.textContent = 'No data to plot.';
    return;
  }

  const granularity = $('#prodChartGranularity').value;
  const stageKey    = $('#prodChartStage').value;


  const buckets = new Map();
  for (const r of STATE.production.records) {
    if (!recordMatchesLineModel(r)) continue;
    if (!recordInPeriod(r)) continue;              // ← scope filter (line+stage+dates)
    const t = r[stageKey];
    if (!t) continue;
    if (!stageInPeriod(t)) continue;               // ← keep: chart bar must fall in the date range
    const key = bucketKeyFor(t, granularity);
    if (!key) continue;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  if (!buckets.size) {
    canvas.style.display = 'none';
    empty.style.display = '';
    empty.textContent = 'No timestamps for this stage.';
    return;
  }

  canvas.style.display = '';
  empty.style.display = 'none';

  const entries = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const dpr  = window.devicePixelRatio || 1;
  const cssW = Math.max(320, canvas.parentElement.clientWidth - 16);
  const cssH = 180;
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padLeft = 48, padRight = 14, padTop = 14, padBottom = 52;
  const plotW = cssW - padLeft - padRight;
  const plotH = cssH - padTop - padBottom;

  const maxVal  = Math.max(...entries.map(e => e[1]));
  const niceMax = niceCeil(maxVal);
  const slot    = plotW / entries.length;
  const gap     = entries.length > 60 ? 1 : entries.length > 30 ? 2 : 4;
  const barW    = Math.max(1.5, slot - gap);

  /* grid + y-axis labels */
  ctx.strokeStyle = '#e5e7eb';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const gridN = 4;
  for (let i = 0; i <= gridN; i++) {
    const v = (niceMax / gridN) * i;
    const y = padTop + plotH - (v / niceMax) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y + 0.5);
    ctx.lineTo(padLeft + plotW, y + 0.5);
    ctx.stroke();
    ctx.fillText(fmt(Math.round(v)), padLeft - 6, y);
  }

  /* bars */
  entries.forEach(([, v], i) => {
    const x = padLeft + i * slot + (slot - barW) / 2;
    const h = (v / niceMax) * plotH;
    const y = padTop + plotH - h;
    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, '#3b82f6');
    grad.addColorStop(1, '#1d4ed8');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, h);
  });

  /* x-axis labels (rotated, sparse) */
  ctx.fillStyle = '#64748b';
  const maxLabels = Math.min(entries.length, 14);
  const labelEvery = Math.max(1, Math.ceil(entries.length / maxLabels));
  entries.forEach(([k], i) => {
    if (i % labelEvery !== 0 && i !== entries.length - 1) return;
    const cx = padLeft + i * slot + slot / 2;
    ctx.save();
    ctx.translate(cx, padTop + plotH + 8);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortBucketLabel(k, granularity), 0, 0);
    ctx.restore();
  });

  /* hover tooltip */
  canvas.onmousemove = ev => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const idx = Math.floor((mx - padLeft) / slot);
    if (idx < 0 || idx >= entries.length) { canvas.title = ''; return; }
    const [k, v] = entries[idx];
    canvas.title = `${shortBucketLabel(k, granularity)} — ${fmt(v)} VINs`;
  };
  canvas.onmouseleave = () => { canvas.title = ''; };
}
/* =========================================================
   RENDER — Batch summary
   ========================================================= */
function renderProductionBatchTable() {
  const tree = $('#prodBatchTable');
  if (!STATE.production.loaded) {
    tree.innerHTML = '<div class="hint" style="margin:0">No production data loaded.</div>';
    return;
  }

  const search = (STATE.production.batchView.search || '').toLowerCase().trim();
  const filter = STATE.production.batchView.filter;

  /* --- 1. Keep only batches with at least one VIN inside the period --- */
  let batches = Array.from(STATE.production.batches.values())
     .filter(b => b.vins.some(recordMatchesFilters));   // ← was recordInPeriod


  /* --- 2. Enrich with period counts + dominant line/model/colour --- */
  const enriched = [];
  for (const b of batches) {
    const periodVins = b.vins.filter(recordMatchesFilters);   // ← was recordInPeriod
    if (!periodVins.length) continue;
    enriched.push({
      id:           b.id,
      allVins:      b.vins,
      periodVins,
      periodCounts: batchCountsAsOfPeriod(periodVins),
      fullCounts:   b.counts,
      line:      dominantLine(b),
      model:     dominantField(b.vins, 'description') || '(no model)',
      color:     dominantField(b.vins, 'color')       || '(no colour)',
      colorCode: dominantField(b.vins, 'colorCode')   || ''
    });
  }
  batches = enriched;

  /* --- 3. Status filter (uses FULL-batch completion, not period) --- */
  if (filter === 'completed')
    batches = batches.filter(b => b.allVins.length > 0 &&
                                 (b.fullCounts.compoundOut || 0) === b.allVins.length);
  else if (filter === 'inProgress')
    batches = batches.filter(b => (b.fullCounts.compoundOut || 0) < b.allVins.length);

  /* --- 4. Text search --- */
  if (search) {
    batches = batches.filter(b => {
      if (b.id.toLowerCase().includes(search)) return true;
      return `${b.line} ${b.model} ${b.color}`.toLowerCase().includes(search);
    });
  }

  if (!batches.length) {
    tree.innerHTML = '<div class="hint" style="margin:16px 0 0">No batches match the current filters.</div>';
    return;
  }

  /* --- 5. Group: line → model → colour → batches --- */
  const lineMap = new Map();
  for (const b of batches) {
    if (!lineMap.has(b.line)) lineMap.set(b.line, new Map());
    const specMap = lineMap.get(b.line);

    if (!specMap.has(b.model)) specMap.set(b.model, new Map());
    const colorMap = specMap.get(b.model);

    const ckey = b.color + '||' + b.colorCode;
    if (!colorMap.has(ckey)) colorMap.set(ckey, { color: b.color, colorCode: b.colorCode, batches: [] });
    colorMap.get(ckey).batches.push(b);
  }

  const sortedLines = Array.from(lineMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

  /* --- 6. Render tree --- */
  let html = '';
  for (const [line, specMap] of sortedLines) {
    const lineBatches   = Array.from(specMap.values()).flatMap(cm =>
      Array.from(cm.values()).flatMap(cg => cg.batches));
    const lineVinTotal  = lineBatches.reduce((s, b) => s + b.periodVins.length, 0);
    const lineComplete  = lineBatches.reduce((s, b) => s + (b.periodCounts.compoundOut || 0), 0);
    const lineBatchCnt  = lineBatches.length;
    const lineModelCnt  = specMap.size;
    const lineOpen      = !PROD_LINE_COLLAPSED.has(line);

    html += `<details class="prod-line-group" data-line="${escapeHtml(line)}" ${lineOpen ? 'open' : ''}>
      <summary class="prod-line-header">
        <span class="line-name">${escapeHtml(line)}</span>
        <span class="line-count">
          ${lineModelCnt} model${lineModelCnt === 1 ? '' : 's'} ·
          ${lineBatchCnt} batch${lineBatchCnt === 1 ? '' : 'es'} ·
          ${fmt(lineVinTotal)} VINs ·
          <b>${fmt(lineComplete)}</b> complete
        </span>
      </summary>
      <div class="prod-spec-list">`;

    const sortedSpecs = Array.from(specMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

    for (const [model, colorMap] of sortedSpecs) {
      const allBatches   = Array.from(colorMap.values()).flatMap(c => c.batches);
      const specVinTotal = allBatches.reduce((s, b) => s + b.periodVins.length, 0);
      const specComplete = allBatches.reduce((s, b) => s + (b.periodCounts.compoundOut || 0), 0);
      const specBatchCnt = allBatches.length;
      const specColorCnt = colorMap.size;
      const specOpen     = !PROD_SPEC_COLLAPSED.has(line + '||' + model);

      html += `<details class="prod-spec-group" data-line="${escapeHtml(line)}" data-spec="${escapeHtml(model)}" ${specOpen ? 'open' : ''}>
        <summary class="prod-spec-header">
          <span class="spec-name">${escapeHtml(model)}</span>
          <span class="spec-count">
            ${specBatchCnt} batch${specBatchCnt === 1 ? '' : 'es'} ·
            ${specColorCnt} colour${specColorCnt === 1 ? '' : 's'} ·
            ${fmt(specVinTotal)} VINs ·
            <b>${fmt(specComplete)}</b> complete
          </span>
        </summary>
        <div class="prod-color-list">`;

      const sortedColors = Array.from(colorMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));

      for (const [ckey, cg] of sortedColors) {
        const colorVinTotal = cg.batches.reduce((s, b) => s + b.periodVins.length, 0);
        const colorComplete = cg.batches.reduce((s, b) => s + (b.periodCounts.compoundOut || 0), 0);
        const colorOpen     = !PROD_COLOR_COLLAPSED.has(line + '||' + model + '||' + ckey);

        html += `<details class="prod-color-group" data-line="${escapeHtml(line)}" data-spec="${escapeHtml(model)}" data-color="${escapeHtml(ckey)}" ${colorOpen ? 'open' : ''}>
          <summary class="prod-color-header">
            <span class="color-code" style="${colorBadgeStyle(cg.colorCode)}">${escapeHtml(cg.colorCode || '??')}</span>
            <span class="color-name">${escapeHtml(model)} ${escapeHtml(cg.color)}</span>
            <span class="color-count">
              ${cg.batches.length} batch${cg.batches.length === 1 ? '' : 'es'} ·
              ${fmt(colorVinTotal)} VINs ·
              <b>${fmt(colorComplete)}</b> complete
            </span>
          </summary>
          <div class="prod-batch-list">
            <table class="prod-batch-inner-table">
              <thead>
                <tr>
                  <th style="width:32px"></th>
                  <th>Batch</th>
                  <th class="num">VINs</th>
                  ${PROD_STAGES.map(s => `<th class="num" title="${s.label} — VINs that reached this stage as of period end">${s.short}</th>`).join('')}
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>`;

        const sortedBatches = cg.batches.slice()
          .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

        for (const b of sortedBatches) {
          const allTotal    = b.allVins.length;
          const periodTotal = b.periodVins.length;
          const isOpen      = PROD_BATCH_EXPANDED.has(b.id);

          const vinsCell = (periodTotal === allTotal)
            ? `${periodTotal}`
            : `${periodTotal}<small style="color:var(--muted)">/${allTotal}</small>`;

          const stageCells = PROD_STAGES.map(s => {
            const n   = b.periodCounts[s.key] || 0;
            const pct = periodTotal ? Math.round(n / periodTotal * 100) : 0;
            const cls = pct === 100 ? 'ok' : pct > 0 ? 'partial' : 'empty';
            return `<td class="num"><span class="prod-pct ${cls}">${n}/${periodTotal}</span><small style="color:var(--muted);margin-left:4px">${pct}%</small></td>`;
          }).join('');

          let status;
          if ((b.fullCounts.compoundOut || 0) === allTotal && allTotal > 0)
            status = '<span class="pill ok">COMPLETE</span>';
          else if ((b.fullCounts.compoundIn || 0) === allTotal && allTotal > 0)
            status = '<span class="pill" style="background:#dbeafe;color:#1e40af">IN COMPOUND</span>';
          else
            status = '<span class="pill warn">IN PROGRESS</span>';

          html += `<tr class="prod-batch-row ${isOpen ? 'row-open' : ''}" data-batch="${escapeHtml(b.id)}">
            <td class="prod-batch-toggle-cell">
              <button class="btn tiny prod-batch-toggle" data-batch="${escapeHtml(b.id)}"
                      title="${isOpen ? 'Hide VIN details' : 'Show VIN details'}">
                ${isOpen ? '▾' : '▸'}
              </button>
            </td>
            <td><b class="mono">${escapeHtml(b.id)}</b></td>
            <td class="num">${vinsCell}</td>
            ${stageCells}
            <td>${status}</td>
          </tr>`;

          if (isOpen) {
            const vins = b.periodVins.slice().sort((x, y) => {
              const c = String(x.sequence || '').localeCompare(String(y.sequence || ''), undefined, { numeric: true });
              return c || displayVin(x).localeCompare(displayVin(y));
            });

            const colspan = 4 + PROD_STAGES.length;

            html += `<tr class="prod-batch-detail-row">
              <td colspan="${colspan}">
                <div class="prod-batch-detail">
                  <div class="prod-batch-detail-title">
                    VINs in <b>${escapeHtml(b.id)}</b> — ${vins.length} vehicle${vins.length === 1 ? '' : 's'} in period
                  </div>
                  <div class="table-wrap prod-batch-detail-scroll">
                    <table class="prod-batch-detail-table">
                      <thead>
                        <tr>
                          <th>Seq</th>
                          <th>VIN</th>
                          <th>Line</th>
                          <th>Colour</th>
                          ${PROD_STAGES.map(s => `<th class="prod-time-col" title="${s.label}">${s.label}</th>`).join('')}
                          <th>Timeline</th>
                        </tr>
                      </thead>
                      <tbody>`;

            for (const r of vins) {
              const lineOf = lineOfSequence(r.sequence);
              const dots = PROD_STAGES.map(s =>
                r[s.key]
                  ? `<span class="prod-dot" style="background:${s.color}" title="${s.label}: ${escapeHtml(r[s.key])}"></span>`
                  : `<span class="prod-dot empty" title="${s.label}: —"></span>`
              ).join('');
              html += `<tr>
                <td class="mono">${escapeHtml(r.sequence || '—')}</td>
                <td class="mono">${escapeHtml(displayVin(r))}</td>
                <td>${escapeHtml(lineOf)}</td>
                <td>${escapeHtml(r.color || '—')}</td>
                ${PROD_STAGES.map(s => `<td class="prod-time-col">${formatProdTime(r[s.key])}</td>`).join('')}
                <td><div class="prod-timeline">${dots}</div></td>
              </tr>`;
            }

            html += `</tbody></table></div></div></td></tr>`;
          }
        }

        html += `</tbody></table></div></details>`;
      }

      html += `</div></details>`;
    }

    html += `</div></details>`;
  }

  tree.innerHTML = html;

  /* --- 7. Wire up interactions --- */

  tree.querySelectorAll('.prod-batch-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.batch;
      if (PROD_BATCH_EXPANDED.has(id)) PROD_BATCH_EXPANDED.delete(id);
      else                             PROD_BATCH_EXPANDED.add(id);
      renderProductionBatchTable();
    });
  });

  tree.querySelectorAll('.prod-batch-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const id = row.dataset.batch;
      if (PROD_BATCH_EXPANDED.has(id)) PROD_BATCH_EXPANDED.delete(id);
      else                             PROD_BATCH_EXPANDED.add(id);
      renderProductionBatchTable();
    });
  });

  tree.querySelectorAll('details.prod-line-group').forEach(d => {
    d.addEventListener('toggle', () => {
      const key = d.dataset.line;
      if (d.open) PROD_LINE_COLLAPSED.delete(key);
      else        PROD_LINE_COLLAPSED.add(key);
    });
  });

  tree.querySelectorAll('details.prod-spec-group').forEach(d => {
    d.addEventListener('toggle', () => {
      const key = d.dataset.line + '||' + d.dataset.spec;
      if (d.open) PROD_SPEC_COLLAPSED.delete(key);
      else        PROD_SPEC_COLLAPSED.add(key);
    });
  });

  tree.querySelectorAll('details.prod-color-group').forEach(d => {
    d.addEventListener('toggle', () => {
      const key = d.dataset.line + '||' + d.dataset.spec + '||' + d.dataset.color;
      if (d.open) PROD_COLOR_COLLAPSED.delete(key);
      else        PROD_COLOR_COLLAPSED.add(key);
    });
  });
}
/* =========================================================
   RENDER — VIN detail (paginated)
   ========================================================= */
function getFilteredProductionVins() {
  const v = STATE.production.vinView;
  const search = (v.search || '').toLowerCase();
  let rows = getFilteredProductionRecords();      // ← was STATE.production.records

  if (search) {
    rows = rows.filter(r =>
      `${r.code} ${r.batch} ${r.sequence} ${r.description} ${r.color} ${r.materialCode}`
        .toLowerCase().includes(search));
  }
  switch (v.stage) {
    case 'complete':       rows = rows.filter(r => r.compoundOut); break;
    case 'notDev':         rows = rows.filter(r => !r.devanning); break;
    case 'notTrim':        rows = rows.filter(r => !r.trimIn); break;
    case 'notOff':         rows = rows.filter(r => !r.offLine); break;
    case 'notBuyOff':      rows = rows.filter(r => !r.buyOff); break;
    case 'notCompoundIn':  rows = rows.filter(r => !r.compoundIn); break;
    case 'notCompoundOut': rows = rows.filter(r => !r.compoundOut); break;
  }
  return rows;
}

function renderProductionVinTable() {
  const tbl = $('#prodVinTable');
  const pg  = $('#prodVinPagination');
  if (!STATE.production.loaded) {
    tbl.innerHTML = `<thead><tr><th>No production data loaded</th></tr></thead>`;
    pg.innerHTML = '';
    $('#prodVinCount').textContent = '';
    return;
  }
  const v = STATE.production.vinView;

  const filtered = getFilteredProductionVins().slice().sort((a, b) => {
    const c = (a.batch || '').localeCompare(b.batch || '', undefined, { numeric: true });
    return c || (a.code || '').localeCompare(b.code || '');
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / v.pageSize));
  if (v.page > totalPages) v.page = totalPages;
  const start = (v.page - 1) * v.pageSize;
  const pageRows = filtered.slice(start, start + v.pageSize);

  $('#prodVinCount').innerHTML =
    `<b>${fmt(total)}</b> VIN${total === 1 ? '' : 's'} match · showing ${fmt(start + 1)}–${fmt(Math.min(start + v.pageSize, total))}`;

  const head = `
    <thead><tr>
      <th>VIN</th>
      <th>Seq</th>
      <th>Line</th>
      <th>Batch</th>
      <th>Model / Color</th>
      ${PROD_STAGES.map(s => `<th class="prod-time-col" title="${s.label}">${s.label}</th>`).join('')}
      <th>Timeline</th>
    </tr></thead>`;

  const body = pageRows.map(r => {
    const line = lineOfSequence(r.sequence);
    const timeline = PROD_STAGES.map(s =>
      r[s.key]
        ? `<span class="prod-dot" style="background:${s.color}" title="${s.label}: ${escapeHtml(r[s.key])}"></span>`
        : `<span class="prod-dot empty" title="${s.label}: —"></span>`
    ).join('');
    return `<tr>
      <td class="mono">${escapeHtml(displayVin(r))}</td>
      <td class="mono">${escapeHtml(r.sequence || '—')}</td>
      <td>${escapeHtml(line)}</td>
      <td class="mono">${escapeHtml(r.batch || '—')}</td>
      <td>${escapeHtml(r.description || '')}${r.color ? ` — <span style="color:var(--muted)">${escapeHtml(r.color)}</span>` : ''}</td>
      ${PROD_STAGES.map(s => `<td class="prod-time-col">${formatProdTime(r[s.key])}</td>`).join('')}
      <td><div class="prod-timeline">${timeline}</div></td>
    </tr>`;
  }).join('');

  tbl.innerHTML = head + `<tbody>${
    body || `<tr><td colspan="${6 + PROD_STAGES.length}" style="text-align:center;color:#6b7280;padding:16px">No VINs match the current filters</td></tr>`
  }</tbody>`;

  renderPagination(pg, v.page, totalPages, p => {
    v.page = p;
    renderProductionVinTable();
    tbl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function renderPagination(container, page, total, onChange) {
  if (total <= 1) { container.innerHTML = ''; return; }
  const btns = [];
  const win = 5;
  let start = Math.max(1, page - 2);
  let end = Math.min(total, start + win - 1);
  if (end - start < win - 1) start = Math.max(1, end - win + 1);

  btns.push(`<button class="btn tiny" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹ Prev</button>`);
  if (start > 1) {
    btns.push(`<button class="btn tiny" data-p="1">1</button>`);
    if (start > 2) btns.push(`<span class="pg-dots">…</span>`);
  }
  for (let i = start; i <= end; i++) {
    btns.push(`<button class="btn tiny ${i === page ? 'primary' : ''}" data-p="${i}">${i}</button>`);
  }
  if (end < total) {
    if (end < total - 1) btns.push(`<span class="pg-dots">…</span>`);
    btns.push(`<button class="btn tiny" data-p="${total}">${total}</button>`);
  }
  btns.push(`<button class="btn tiny" data-p="${page + 1}" ${page >= total ? 'disabled' : ''}>Next ›</button>`);

  container.innerHTML = btns.join('');
  container.querySelectorAll('button[data-p]').forEach(b => {
    b.addEventListener('click', () => {
      const p = parseInt(b.dataset.p, 10);
      if (p >= 1 && p <= total && p !== page) onChange(p);
    });
  });
}

/* =========================================================
   EXPORTS
   ========================================================= */
function exportProductionBatches() {
  if (!STATE.production.loaded) return;
  const aoa = [['Batch', 'VINs', ...PROD_STAGES.map(s => s.label), 'Status']];
  const batches = Array.from(STATE.production.batches.values())
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const b of batches) {
    const total = b.vins.length;
    const row = [b.id, total];
    for (const s of PROD_STAGES) row.push(b.counts[s.key] || 0);
    row.push((b.counts.compoundOut || 0) === total && total > 0 ? 'COMPLETE' : 'IN PROGRESS');
    aoa.push(row);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'Batch Progress');
  downloadWorkbook(wb, `Production_Batches_${dateStamp()}.xlsx`);
}

function exportProductionVins() {
  if (!STATE.production.loaded) return;
  const rows = getFilteredProductionVins();
  const aoa = [[
    'VIN', 'Sequence', 'Line', 'Batch', 'Description', 'Color', 'Material Code',
    ...PROD_STAGES.map(s => s.label)
  ]];
  for (const r of rows) {
    aoa.push([
      displayVin(r), r.sequence, lineOfSequence(r.sequence), r.batch,
      r.description, r.color, r.materialCode,
      ...PROD_STAGES.map(s => r[s.key] || '')
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'VIN Tracking');
  downloadWorkbook(wb, `Production_VINs_${dateStamp()}.xlsx`);
}
/* Count of period-selected VINs that had reached each stage as of period.to.
   Numerator and denominator share the same scope (periodVins), so percentages
   are always 0–100%. */
function batchCountsAsOfPeriod(periodVins) {
  const counts = {};
  for (const s of PROD_STAGES) counts[s.key] = 0;
  if (!periodVins || !periodVins.length) return counts;
  for (const r of periodVins) {
    for (const s of PROD_STAGES) {
      if (stageReachedByPeriod(r[s.key])) counts[s.key]++;
    }
  }
  return counts;
}
/* =========================================================
   XML EXPORT — one file per VIN in the current VIN detail list
   ========================================================= */
let _exportFolderHandle = null;
let _lastXmlErrors = [];

/* XML-safe text */
function escapeXml(s) {
  if (s == null) return '';
  return String(s).replace(/[<>&'"]/g, c => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  })[c]);
}

/* 'YYYY-MM-DD…' → 'YYYYMMDD' */
function toYmdCompact(dateStr) {
  if (!dateStr) return '';
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return `${m[1]}${m[2]}${m[3]}`;
}

/* Strip characters that are illegal in most filesystems */
function sanitizeFileName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

/* Build the XML string for one VIN, one <InventoryLine> per BOM part. */
function buildXMLForVin(rec, bom) {
  const zone         = lineOfSequence(rec.sequence);
  const deliveryNote = `${rec.sequence}-${displayVin(rec)}`;
  const order        = rec.batch || '';
  const stockDate    = toYmdCompact(rec.offLine);

  const lines = bom.parts.map(p => `    <InventoryLine>
        <Type>CONSUME</Type>
        <Zone>${escapeXml(zone)}</Zone>
        <Warehouse>EBR</Warehouse>
        <COResponsible>WH</COResponsible>
        <COInventoryReason>JC</COInventoryReason>
        <DeliveryNote>${escapeXml(deliveryNote)}</DeliveryNote>
        <CONotes>NOTES</CONotes>
        <Part>${escapeXml(p.partNo)}</Part>
        <StockAV>${Number(p.qty) || 0}</StockAV>
        <Order>${escapeXml(order)}</Order>
        <StockDate>${stockDate}</StockDate>
    </InventoryLine>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Inventory>
${lines}
</Inventory>
`;
}

/* Folder picker (File System Access API, write mode) */
async function pickExportFolder() {
  if (typeof window.showDirectoryPicker !== 'function') {
    alert('XML folder export requires Chrome or Edge (File System Access API).');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    _exportFolderHandle = handle;
    $('#exportFolderPath').value = '/' + handle.name + '/';
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.error(e);
    alert('Failed to select folder: ' + e.message);
  }
}

async function exportProductionXml() {
  /* ---- Pre-flight checks ---- */
  if (!STATE.production.loaded) {
    alert('Load production tracking data first.');
    return;
  }
  if (!STATE.boms.length) {
    alert('Please load BOM data first.');
    return;
  }
  const vins = getFilteredProductionVins();
  if (!vins.length) {
    alert('No VINs match the current filters.');
    return;
  }

  /* ---- Ensure a folder is selected + writable ---- */
  if (!_exportFolderHandle) {
    await pickExportFolder();
    if (!_exportFolderHandle) return;
  }
  try {
    let perm = await _exportFolderHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      perm = await _exportFolderHandle.requestPermission({ mode: 'readwrite' });
    }
    if (perm !== 'granted') {
      alert('Write permission to the folder was not granted.');
      return;
    }
  } catch (e) {
    console.error(e);
    alert('Could not verify folder permission: ' + e.message);
    return;
  }

  /* ---- Reset UI ---- */
  const wrap   = $('#xmlProgressWrap');
  const fill   = $('#xmlProgressFill');
  const label  = $('#xmlProgressLabel');
  const errBox = $('#xmlErrorLog');

  wrap.classList.remove('hidden');
  errBox.classList.add('hidden');
  errBox.innerHTML = '';
  fill.style.width = '0%';
  label.textContent = `Preparing 0 / ${vins.length}…`;

  _lastXmlErrors = [];

  /* ---- Live error-log helpers (nested — closure over errBox) ---- */
  const ensureErrorPanel = () => {
    if (errBox.dataset.built === '1') return;
    errBox.dataset.built = '1';
    errBox.classList.remove('hidden');
    errBox.innerHTML = `
      <div class="xml-err-title">
        <span id="xmlErrCount">⚠ 0 errors</span>
        <span class="xml-err-actions">
          <button type="button" id="xmlErrExport" title="Export errors to Excel">⤓ Export Errors</button>
          <button type="button" id="xmlErrClose" title="Dismiss">✕</button>
        </span>
      </div>
      <div class="xml-err-rows" id="xmlErrRows">
        <div class="xml-err-row xml-err-header">
          <span>VIN</span><span>Batch</span><span>Reason</span>
        </div>
      </div>`;
    $('#xmlErrExport').addEventListener('click', exportXmlErrors);
    $('#xmlErrClose').addEventListener('click', () => {
      errBox.classList.add('hidden');
      errBox.innerHTML = '';
      errBox.dataset.built = '';
    });
  };

  const appendErrorRow = (er) => {
    ensureErrorPanel();
    const rows = $('#xmlErrRows');
    const row = document.createElement('div');
    row.className = 'xml-err-row';
    row.innerHTML = `
      <span class="xml-err-vin">${escapeHtml(er.vin)}</span>
      <span class="xml-err-batch">${escapeHtml(er.batch)}</span>
      <span>${escapeHtml(er.reason)}</span>`;
    rows.appendChild(row);
    const countEl = $('#xmlErrCount');
    if (countEl) {
      const n = _lastXmlErrors.length;
      countEl.textContent = `⚠ ${n} error${n === 1 ? '' : 's'}`;
    }
  };

  /* ---- Process every VIN ---- */
  let successCount = 0;
  const total = vins.length;

  for (let i = 0; i < total; i++) {
    const rec = vins[i];

    /* --- Sequence + VIN required --- */
    const seq = String(rec.sequence || '').trim();
    const vin = displayVin(rec);
    if (!seq || !vin) {
      const missing = [];
      if (!seq) missing.push('Sequence');
      if (!vin) missing.push('VIN');
      const er = {
        vin:   vin || '(missing)',
        batch: rec.batch || '—',
        reason: `Missing ${missing.join(' and ')} field(s)`
      };
      _lastXmlErrors.push(er);
      appendErrorRow(er);
      await yieldToUI();
      continue;
    }

    /* --- BOM lookup by batch --- */
    const matches = STATE.boms.filter(b => b.batchId === rec.batch);
    if (matches.length === 0) {
      const er = {
        vin, batch: rec.batch || '—',
        reason: `No BOM loaded for sales batch ${rec.batch || '—'}`
      };
      _lastXmlErrors.push(er);
      appendErrorRow(er);
      await yieldToUI();
      continue;
    }
    if (matches.length > 1) {
      const er = {
        vin, batch: rec.batch || '—',
        reason: 'Multi BOM detected for the Batch, please check'
      };
      _lastXmlErrors.push(er);
      appendErrorRow(er);
      await yieldToUI();
      continue;
    }
    const bom = matches[0];
    if (!bom.parts || !bom.parts.length) {
      const er = { vin, batch: rec.batch || '—', reason: 'BOM has no parts' };
      _lastXmlErrors.push(er);
      appendErrorRow(er);
      await yieldToUI();
      continue;
    }

    /* --- Build XML + write --- */
    const xmlStr   = buildXMLForVin(rec, bom);
    const fileName = sanitizeFileName(`${seq}-${vin}`) + '.xml';

    try {
      const fh = await _exportFolderHandle.getFileHandle(fileName, { create: true });
      const w  = await fh.createWritable();
      await w.write(xmlStr);
      await w.close();
      successCount++;
    } catch (e) {
      console.error(e);
      const er = {
        vin, batch: rec.batch || '—',
        reason: `Write failed: ${e.message || e}`
      };
      _lastXmlErrors.push(er);
      appendErrorRow(er);
      await yieldToUI();
    }

    /* --- Throttled progress update --- */
    if (i % 5 === 0 || i === total - 1) {
      fill.style.width = (((i + 1) / total) * 100).toFixed(1) + '%';
      label.textContent = `Exporting ${i + 1} / ${total} — ${fileName}`;
      await yieldToUI();
    }
  }

  /* ---- Wrap-up ---- */
  fill.style.width = '100%';
  label.textContent =
    `Done — ${successCount} processed correctly, ${_lastXmlErrors.length} with error${_lastXmlErrors.length === 1 ? '' : 's'}.`;

  alert(
    `XML export complete.\n` +
    `${successCount} processed correctly, ${_lastXmlErrors.length} ended with error.\n` +
    (_lastXmlErrors.length ? 'Please check the error log for details.' : '')
  );

  setTimeout(() => wrap.classList.add('hidden'), 3000);
}

function exportXmlErrors() {
  if (!_lastXmlErrors || !_lastXmlErrors.length) {
    alert('No errors to export.');
    return;
  }
  const aoa = [['#', 'VIN', 'Batch', 'Reason']];
  _lastXmlErrors.forEach((er, i) => {
    aoa.push([i + 1, er.vin, er.batch, er.reason]);
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'XML Export Errors');
  downloadWorkbook(wb, `XML_Export_Errors_${dateStamp()}.xlsx`);
}
/* =========================================================
   BIND — Production tab UI
   ========================================================= */
function bindProduction() {
  const dz    = $('#prodDrop');
  const input = $('#prodInput');
  if (!dz || !input) return;

  /* --- File input --- */
  input.addEventListener('change', e => {
    handleProductionFiles(Array.from(e.target.files || []));
    e.target.value = '';
  });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', e => {
    handleProductionFiles(Array.from(e.dataTransfer.files || []));
  });

  /* --- Batch summary controls --- */
  $('#prodBatchSearch').addEventListener('input', e => {
    STATE.production.batchView.search = e.target.value;
    renderProductionBatchTable();
  });
  $('#prodBatchFilter').addEventListener('change', e => {
    STATE.production.batchView.filter = e.target.value;
    renderProductionBatchTable();
  });
  $('#prodBatchExpandAll').addEventListener('click', prodBatchExpandAll);
  $('#prodBatchCollapseAll').addEventListener('click', prodBatchCollapseAll);

  /* --- VIN detail controls --- */
  $('#prodVinSearch').addEventListener('input', e => {
    STATE.production.vinView.search = e.target.value;
    STATE.production.vinView.page = 1;
    renderProductionVinTable();
  });
  $('#prodVinStage').addEventListener('change', e => {
    STATE.production.vinView.stage = e.target.value;
    STATE.production.vinView.page = 1;
    renderProductionVinTable();
  });

  /* --- Exports --- */
  $('#prodBatchExport').addEventListener('click', exportProductionBatches);
  $('#prodVinExport').addEventListener('click', exportProductionVins);
  /* --- XML Export --- */
  $('#exportFolderPick').addEventListener('click', pickExportFolder);
  $('#prodXmlExport').addEventListener('click', exportProductionXml);
  /* --- Capacity chart selectors --- */
  $('#prodChartGranularity').addEventListener('change', renderProductionChart);
  $('#prodChartStage').addEventListener('change',       renderProductionChart);

  /* --- Monitoring period: quick-range buttons (stage only) --- */
  const periodCtrl = $('#prodPeriodControls');
  if (periodCtrl) {
    periodCtrl.addEventListener('click', e => {
      const btn = e.target.closest('button[data-range]');
      if (!btn || !periodCtrl.contains(btn)) return;

      const { from, to } = getPeriodRange(btn.dataset.range);

      const fromEl = $('#prodPeriodFrom');
      const toEl   = $('#prodPeriodTo');
      if (fromEl) fromEl.value = from || '';
      if (toEl)   toEl.value   = to   || '';
      STATE.production.pendingPeriod = { from: from || '', to: to || '' };

      periodCtrl.querySelectorAll('button[data-range]').forEach(b =>
        b.classList.remove('primary'));
      btn.classList.add('primary');

      updateApplyButtonState();
    });
  }

  /* --- Manual date edits: stage only --- */
  const stageFromInputs = () => {
    const fromEl = $('#prodPeriodFrom');
    const toEl   = $('#prodPeriodTo');
    STATE.production.pendingPeriod = {
      from: fromEl ? (fromEl.value || '') : '',
      to:   toEl   ? (toEl.value   || '') : ''
    };
    $$('.prod-period-btn').forEach(b => b.classList.remove('primary'));
    updateApplyButtonState();
  };
  $('#prodPeriodFrom').addEventListener('change', stageFromInputs);
  $('#prodPeriodTo').addEventListener('change', stageFromInputs);
   
  /* --- Milestone scope for the period (stage only) --- */
  $('#prodPeriodStage').addEventListener('change', e => {
    STATE.production.pendingPeriodStage = e.target.value || '';
    updateApplyButtonState();
  });
  /* --- Line / Model multi-select dropdowns --- */
  const closeAllMS = () => {
    $$('.prod-ms-panel').forEach(p => p.classList.add('hidden'));
  };
  ['#prodLineMS', '#prodModelMS'].forEach(sel => {
    const root = $(sel);
    if (!root) return;
    const btn   = root.querySelector('.prod-ms-btn');
    const panel = root.querySelector('.prod-ms-panel');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const wasHidden = panel.classList.contains('hidden');
      closeAllMS();
      if (wasHidden) panel.classList.remove('hidden');
    });
    panel.addEventListener('click', e => e.stopPropagation());
  });
  document.addEventListener('click', closeAllMS);

  /* Checkbox changes → update pending sets, no re-render */
  const onChangeMS = () => {
    const lineChecks  = $$('#prodLineValues input[type=checkbox]');
    const modelChecks = $$('#prodModelValues input[type=checkbox]');

    const selectedLines  = lineChecks.filter(c => c.checked).map(c => c.value);
    const selectedModels = modelChecks.filter(c => c.checked).map(c => c.value);

    STATE.production.pendingLines  = selectedLines.length  === lineChecks.length  ? null : new Set(selectedLines);
    STATE.production.pendingModels = selectedModels.length === modelChecks.length ? null : new Set(selectedModels);

    syncMultiselectUI();
    updateApplyButtonState();
  };
  $('#prodLineValues')?.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) onChangeMS();
  });
  $('#prodModelValues')?.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox]')) onChangeMS();
  });

  /* All / None quick buttons inside each panel */
  $$('.prod-ms-header').forEach(header => {
    header.addEventListener('click', e => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const root = header.closest('.prod-ms');
      const checks = root.querySelectorAll('input[type=checkbox]');
      const setAll = btn.dataset.act === 'all';
      checks.forEach(cb => { cb.checked = setAll; });
      onChangeMS();
    });
  });

  /* Model search input */
  const modelSearch = $('#prodModelMS .prod-ms-search input');
  if (modelSearch) {
    modelSearch.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      $$('#prodModelValues .prod-ms-value').forEach(lbl => {
        const hay = lbl.dataset.modelLabel || '';
        lbl.style.display = hay.includes(q) ? '' : 'none';
      });
    });
  }

  /* --- Apply button: commit all pending filters --- */
  $('#prodPeriodApply').addEventListener('click', () => {
    applyProductionPeriod();
    closeAllMS();
  });

  /* --- Clear button --- */
  $('#prodClear').addEventListener('click', clearProduction);

  /* --- Redraw chart on resize --- */
  window.addEventListener('resize', () => {
    if (STATE.production.loaded) renderProductionChart();
  });
}

window.MRP = STATE;
