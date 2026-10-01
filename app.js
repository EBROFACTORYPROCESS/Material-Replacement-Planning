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
      const rows = await fileToRows(f);
      const parsedList = parseBOM(rows, f.name);
      if (!parsedList.length) { alert(`No parts found in ${f.name}`); continue; }
      for (const parsed of parsedList) {
        const key = bomKeyOf(parsed);
        const existing = STATE.boms.findIndex(b => bomKeyOf(b) === key);
        if (existing >= 0) STATE.boms.splice(existing, 1);
        assignBomId(parsed);
        STATE.boms.push(parsed);
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
    const rows = await fileToRows(f);
    STATE.batches = parseBatches(rows);
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
  const tbl = $('#batchTable');
  if (!STATE.batches.length) {
    tbl.innerHTML = `<thead><tr><th>No batch data</th></tr></thead>`;
    return;
  }

  const searchText = ($('#batchSearch').value || '').trim().toLowerCase();

  let list = STATE.batches.map((b, i) => ({ b, i }));
  for (const [colId, allowedSet] of Object.entries(STATE.batchView.filters)) {
    if (!allowedSet) continue;
    list = list.filter(({ b }) => allowedSet.has(String(getBatchCellValue(b, colId))));
  }
  if (searchText) {
    list = list.filter(({ b }) => {
      const hay = `${b.batch} ${b.model} ${b.color} ${b.ship} ${b.production}`.toLowerCase();
      return hay.includes(searchText);
    });
  }

  const sortCol = Object.keys(STATE.batchView.sorts)[0];
  if (sortCol) {
    const dir = STATE.batchView.sorts[sortCol] === 'desc' ? -1 : 1;
    list.sort((x, y) => {
      const a = getBatchCellValue(x.b, sortCol);
      const b = getBatchCellValue(y.b, sortCol);
      if (sortCol === 'qty') return ((Number(a)||0) - (Number(b)||0)) * dir;
      return String(a).localeCompare(String(b), undefined, { numeric: true }) * dir;
    });
  }

  const header = BATCH_COLS.map(col => {
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
  }).join('');

  const whOpts = STATE.config.warehouses;
  const stages = STATE.config.stages;

  const body = list.map(({ b, i }) => {
    const s = stages[b._stage] || { label: b._stage, color: '#9ca3af' };

    const linkedKey  = resolveBomKeyForBatch(b);
    const linkedBom  = linkedKey ? STATE.boms.find(x => bomKeyOf(x) === linkedKey) : null;
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

    return `
      <tr data-i="${i}">
        <td>${escapeHtml(b.batch)}${unassignedFlag}</td>
        <td>${escapeHtml(b.model)}</td>
        <td>${escapeHtml(b.color)}</td>
        <td class="num">${fmt(b.qty)}</td>
        <td>${escapeHtml(b.ship)}</td>
        <td>${b.arrival   ? b.arrival.toLocaleDateString()   : '—'}</td>
        <td>${b.decanting ? b.decanting.toLocaleDateString() : '—'}</td>
        <td>${b.trimIn    ? b.trimIn.toLocaleDateString()    : '—'}</td>
        <td>${escapeHtml(b.production)}</td>
        <td><span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span></td>
        <td>${b._stage === 'warehouse' ? `
          <select data-role="wh" data-i="${i}">
            <option value="">—</option>
            ${whOpts.map(w => `<option value="${w.id}" ${b._warehouse===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
          </select>` : escapeHtml(whLabel)}</td>
        <td>${linkCell}</td>
      </tr>`;
  }).join('');

  tbl.innerHTML = `<thead><tr>${header}</tr></thead><tbody>${body || `<tr><td colspan="12" style="text-align:center;color:#6b7280;padding:16px">No batches match the current filters</td></tr>`}</tbody>`;

  tbl.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openFilterPopup(btn.dataset.col, btn);
    });
  });

  tbl.querySelectorAll('select[data-role=wh]').forEach(sel => {
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
  vinId:        ['vinid', 'vin id', 'vin'],
  sequence:     ['sequence'],
  batch:        ['batch'],
  description:  ['description'],
  color:        ['color'],           // exact match avoids 'colorCode'
  materialCode: ['materialcode', 'material code'],
  devanning:    ['005 devanning'],
  trimIn:       ['020 trim in'],
  offLine:      ['030 off line ok'],
  buyOff:       ['buy off ok'],
  compoundIn:   ['compound gate in in', 'compound gate in'],
  compoundOut:  ['compound gate out ok']
};

function lineOfSequence(seq) {
  if (!seq) return '—';
  return PROD_LINE_MAP[seq.charAt(0).toUpperCase()] || '—';
}

function formatProdTime(s) {
  if (!s) return '<span class="prod-empty">—</span>';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return escapeHtml(s);
  const [, , mo, d, h, mi] = m;
  return `<span title="${escapeHtml(s)}">${d}/${mo} ${h}:${mi}</span>`;
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
        const p = headerLower.findIndex(x => x.includes(h));
        if (p >= 0) { found = p; break; }
      }
    }
    idx[key] = found;
  }
  if (idx.vinId < 0) throw new Error('Required column "vinId" not found in CSV header');

  const maxIdx = Math.max(...Object.values(idx).filter(x => x >= 0));
  const records = [];

  /* -- 3. Parse data rows directly into lean objects -- */
  field = ''; row = []; inQ = false;

  const finalizeRow = () => {
    row.push(field); field = '';
    if (row.length > maxIdx) {
      const vinId = String(row[idx.vinId] ?? '').trim();
      if (vinId) {
        const rec = { vinId };
        for (const [key, ci] of Object.entries(idx)) {
          if (key === 'vinId' || ci < 0) continue;
          rec[key] = String(row[ci] ?? '').trim();
        }
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

    STATE.production.records = records;
    STATE.production.batches = computeProductionBatches(records);
    STATE.production.header  = header;
    STATE.production.loaded  = true;
    STATE.production.vinView.page = 1;
    STATE.production.batchView.search = '';
    STATE.production.vinView.search = '';
    STATE.production.vinView.stage = 'all';
    $('#prodBatchSearch').value = '';
    $('#prodVinSearch').value = '';
    $('#prodVinStage').value = 'all';

    fill.style.width = '100%';
    label.textContent = `Done — ${fmt(records.length)} VINs · ${fmt(STATE.production.batches.size)} batches`;

    renderProductionStats();
    renderProductionBatchTable();
    renderProductionVinTable();

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
    batchView: { search: '', filter: 'all' },
    vinView:   { page: 1, pageSize: 100, search: '', stage: 'all' }
  };
  $('#prodProgressWrap').classList.add('hidden');
  renderProductionStats();
  renderProductionBatchTable();
  renderProductionVinTable();
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
  const records = STATE.production.records;
  const total   = records.length;
  const batches = STATE.production.batches;

  const counts = {};
  for (const s of PROD_STAGES) counts[s.key] = 0;
  for (const r of records)
    for (const s of PROD_STAGES) if (r[s.key]) counts[s.key]++;

  const complete = counts.compoundOut;
  const inProg   = total - complete;

  const stageCards = PROD_STAGES.map(s => {
    const n = counts[s.key];
    const pct = total ? (n / total * 100) : 0;
    return `
      <div class="stat prod-stat">
        <div class="label"><span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span></div>
        <div class="value">${fmt(n)}<span class="unit">/ ${fmt(total)}</span></div>
        <div class="prod-bar"><div class="prod-bar-fill" style="width:${pct.toFixed(1)}%;background:${s.color}"></div></div>
        <div class="sub"><b>${pct.toFixed(1)}%</b> of VINs</div>
      </div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="stat prod-stat">
      <div class="label">Total VINs</div>
      <div class="value">${fmt(total)}</div>
      <div class="sub"><b>${fmt(batches.size)}</b> batches</div>
    </div>
    <div class="stat prod-stat">
      <div class="label">Complete (Gate-out OK)</div>
      <div class="value">${fmt(complete)}</div>
      <div class="sub"><b>${total ? (complete / total * 100).toFixed(1) : 0}%</b> shipped</div>
    </div>
    <div class="stat prod-stat">
      <div class="label">In progress</div>
      <div class="value">${fmt(inProg)}</div>
      <div class="sub"><b>${total ? (inProg / total * 100).toFixed(1) : 0}%</b> active</div>
    </div>
    ${stageCards}
  `;
}

/* =========================================================
   RENDER — Batch summary
   ========================================================= */
function renderProductionBatchTable() {
  const tbl = $('#prodBatchTable');
  if (!STATE.production.loaded) {
    tbl.innerHTML = `<thead><tr><th>No production data loaded</th></tr></thead>`;
    return;
  }
  const search = (STATE.production.batchView.search || '').toLowerCase();
  const filter = STATE.production.batchView.filter;

  let batches = Array.from(STATE.production.batches.values());
  if (search) batches = batches.filter(b => b.id.toLowerCase().includes(search));
  if (filter === 'completed')
    batches = batches.filter(b => (b.counts.compoundOut || 0) === b.vins.length);
  else if (filter === 'inProgress')
    batches = batches.filter(b => (b.counts.compoundOut || 0) < b.vins.length);

  batches.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

  const colCount = 3 + PROD_STAGES.length;

  const head = `
    <thead><tr>
      <th style="width:34px"></th>
      <th>Batch</th>
      <th class="num">VINs</th>
      ${PROD_STAGES.map(s => `<th class="num" title="${s.label}">${s.short}</th>`).join('')}
      <th>Status</th>
    </tr></thead>`;

  const body = batches.map(b => {
    const total = b.vins.length;
    const isOpen = PROD_BATCH_EXPANDED.has(b.id);

    const stageCells = PROD_STAGES.map(s => {
      const n = b.counts[s.key] || 0;
      const pct = total ? Math.round(n / total * 100) : 0;
      const cls = pct === 100 ? 'ok' : pct > 0 ? 'partial' : 'empty';
      return `<td class="num"><span class="prod-pct ${cls}">${n}/${total}</span><small style="color:var(--muted)">${pct}%</small></td>`;
    }).join('');

    let status;
    if ((b.counts.compoundOut || 0) === total && total > 0)
      status = '<span class="pill ok">COMPLETE</span>';
    else if ((b.counts.compoundIn || 0) === total && total > 0)
      status = '<span class="pill" style="background:#dbeafe;color:#1e40af">IN COMPOUND</span>';
    else
      status = '<span class="pill warn">IN PROGRESS</span>';

    const mainRow = `<tr class="prod-batch-row ${isOpen ? 'row-open' : ''}" data-batch="${escapeHtml(b.id)}">
      <td class="prod-batch-toggle-cell">
        <button class="btn tiny prod-batch-toggle"
                data-batch="${escapeHtml(b.id)}"
                title="${isOpen ? 'Hide VIN details' : 'Show VIN details'}">
          ${isOpen ? '▾' : '▸'}
        </button>
      </td>
      <td><b class="mono">${escapeHtml(b.id)}</b></td>
      <td class="num">${total}</td>
      ${stageCells}
      <td>${status}</td>
    </tr>`;

    if (!isOpen) return mainRow;

    /* --- Detail panel: VIN list for this batch --- */
    const vins = b.vins.slice().sort((x, y) => {
      const c = String(x.sequence || '').localeCompare(String(y.sequence || ''), undefined, { numeric: true });
      return c || String(x.vinId).localeCompare(String(y.vinId));
    });

    const vinHead = `
      <thead>
        <tr>
          <th>Seq</th>
          <th>VIN</th>
          <th>Line</th>
          <th>Color</th>
          ${PROD_STAGES.map(s => `<th class="prod-time-col" title="${s.label}">${s.label}</th>`).join('')}
          <th>Timeline</th>
        </tr>
      </thead>`;

    const vinBody = vins.map(r => {
      const line = lineOfSequence(r.sequence);
      const dots = PROD_STAGES.map(s =>
        r[s.key]
          ? `<span class="prod-dot" style="background:${s.color}" title="${s.label}: ${escapeHtml(r[s.key])}"></span>`
          : `<span class="prod-dot empty" title="${s.label}: —"></span>`
      ).join('');

      return `<tr>
        <td class="mono">${escapeHtml(r.sequence || '—')}</td>
        <td class="mono">${escapeHtml(r.vinId)}</td>
        <td>${escapeHtml(line)}</td>
        <td>${escapeHtml(r.color || '—')}</td>
        ${PROD_STAGES.map(s => `<td class="prod-time-col">${formatProdTime(r[s.key])}</td>`).join('')}
        <td><div class="prod-timeline">${dots}</div></td>
      </tr>`;
    }).join('');

    const detailRow = `<tr class="prod-batch-detail-row">
      <td colspan="${colCount}">
        <div class="prod-batch-detail">
          <div class="prod-batch-detail-title">
            VINs in <b>${escapeHtml(b.id)}</b> — ${vins.length} vehicle${vins.length === 1 ? '' : 's'}
          </div>
          <div class="table-wrap prod-batch-detail-scroll">
            <table class="prod-batch-detail-table">
              ${vinHead}
              <tbody>${vinBody}</tbody>
            </table>
          </div>
        </div>
      </td>
    </tr>`;

    return mainRow + detailRow;
  }).join('');

  tbl.innerHTML = head + `<tbody>${
    body || `<tr><td colspan="${colCount}" style="text-align:center;color:#6b7280;padding:16px">No batches match the current filters</td></tr>`
  }</tbody>`;

  /* Wire the expand/collapse toggle buttons */
  tbl.querySelectorAll('.prod-batch-toggle').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const id = btn.dataset.batch;
      if (PROD_BATCH_EXPANDED.has(id)) PROD_BATCH_EXPANDED.delete(id);
      else                             PROD_BATCH_EXPANDED.add(id);
      renderProductionBatchTable();
    });
  });
  tbl.querySelectorAll('.prod-batch-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      const id = row.dataset.batch;
      if (PROD_BATCH_EXPANDED.has(id)) PROD_BATCH_EXPANDED.delete(id);
      else                             PROD_BATCH_EXPANDED.add(id);
      renderProductionBatchTable();
    });
  }); 
}

/* =========================================================
   RENDER — VIN detail (paginated)
   ========================================================= */
function getFilteredProductionVins() {
  const v = STATE.production.vinView;
  const search = (v.search || '').toLowerCase();
  let rows = STATE.production.records;

  if (search) {
    rows = rows.filter(r =>
      `${r.vinId} ${r.batch} ${r.sequence} ${r.description} ${r.color} ${r.materialCode}`
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
    return c || a.vinId.localeCompare(b.vinId);
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
      <td class="mono">${escapeHtml(r.vinId)}</td>
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
      r.vinId, r.sequence, lineOfSequence(r.sequence), r.batch,
      r.description, r.color, r.materialCode,
      ...PROD_STAGES.map(s => r[s.key] || '')
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'VIN Tracking');
  downloadWorkbook(wb, `Production_VINs_${dateStamp()}.xlsx`);
}

/* =========================================================
   BIND — Production tab UI
   ========================================================= */
function bindProduction() {
  const dz    = $('#prodDrop');
  const input = $('#prodInput');
  if (!dz || !input) return;

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

  $('#prodBatchSearch').addEventListener('input', e => {
    STATE.production.batchView.search = e.target.value;
    renderProductionBatchTable();
  });
  $('#prodBatchFilter').addEventListener('change', e => {
    STATE.production.batchView.filter = e.target.value;
    renderProductionBatchTable();
  });
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
  $('#prodBatchExport').addEventListener('click', exportProductionBatches);
  $('#prodVinExport').addEventListener('click', exportProductionVins);
  $('#prodClear').addEventListener('click', clearProduction);
}
window.MRP = STATE;
