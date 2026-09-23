/* =========================================================
   MRP Planner — main application logic
   ========================================================= */
const STATE = {
  config: null,
  boms: [],           // [{id, label, model, parts:[{partNo,nameCN,nameEN,qty,uom,supplier,cpac}]}]
  batches: [],        // [{...}]
  inventory: {},      // partNo -> {inTransit, warehouses:{whId:qty}, factoryFloor, edgeLine, total}
  partIndex: {},      // partNo -> {name, uom, supplier, models:Set, perModelQty:{model:qty}, isCommon}
  plan: [],
  filters: {}
};

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const fmt = n => (n==null||isNaN(n)) ? '' : Number(n).toLocaleString(undefined,{maximumFractionDigits:3});
const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };

/* =========================================================
   BOOT
   ========================================================= */
window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  bindTabs();
  bindUploads();
  bindButtons();
  renderWarehouseEditor();
  renderWarehouseChecklist();
  $('#todayBadge').textContent = new Date().toLocaleDateString();
  $('#c_safety').value = STATE.config.shortageDefaults.safetyFactor;
  $('#c_factoryFloor').checked = STATE.config.shortageDefaults.includeFactoryFloor;
  $('#c_edgeLine').checked = STATE.config.shortageDefaults.includeEdgeLine;
  $('#c_inTransit').checked = STATE.config.shortageDefaults.includeInTransit;
});

async function loadConfig() {
  try {
    const res = await fetch('config.json');
    STATE.config = await res.json();
  } catch (e) {
    console.warn('config.json not found — using defaults', e);
    STATE.config = {
      warehouses: [
        {id:'WH1',name:'Warehouse 1',enabled:true},
        {id:'WH2',name:'Warehouse 2',enabled:true},
        {id:'WH3',name:'Warehouse 3',enabled:true},
        {id:'WH4',name:'Warehouse 4',enabled:true}
      ],
      stages: {
        inTransit:{label:'In Transit',color:'#3b82f6'},
        warehouse:{label:'Warehouse',color:'#8b5cf6'},
        factoryFloor:{label:'Factory Floor',color:'#f59e0b'},
        edgeLine:{label:'Edge Line',color:'#10b981'},
        consumed:{label:'Consumed',color:'#9ca3af'}
      },
      shortageDefaults:{safetyFactor:1.0,includeInTransit:false,includeWarehouses:true,includeFactoryFloor:true,includeEdgeLine:true}
    };
  }
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
   UPLOAD HANDLERS
   ========================================================= */
function bindUploads() {
  wireDropzone('#bomDrop', '#bomInput', handleBomFiles);
  wireDropzone('#batchDrop', '#batchInput', handleBatchFiles);
}

function wireDropzone(dzSel, inputSel, handler) {
  const dz = $(dzSel), input = $(inputSel);
  input.addEventListener('change', e => handler(Array.from(e.target.files)));
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); dz.classList.remove('drag');
  }));
  dz.addEventListener('drop', e => handler(Array.from(e.dataTransfer.files)));
}

/* ---------- File reading ---------- */
function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}
function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsText(file);
  });
}

async function fileToRows(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await readFileAsText(file);
    return parseCSV(text);
  }
  // xlsx / xls
  const buf = await readFileAsArrayBuffer(file);
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}

/* ---------- CSV parser (handles quotes & BOM) ---------- */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i+1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* =========================================================
   BOM HANDLING
   ========================================================= */
async function handleBomFiles(files) {
  for (const f of files) {
    try {
      const rows = await fileToRows(f);
      const parsed = parseBOM(rows, f.name);
      if (!parsed.parts.length) { alert(`No parts found in ${f.name}`); continue; }
      // De-duplicate by keeping latest upload of same label
      const existing = STATE.boms.findIndex(b => b.label === parsed.label);
      if (existing >= 0) STATE.boms.splice(existing, 1);
      STATE.boms.push(parsed);
    } catch (e) {
      console.error(e);
      alert(`Failed to parse ${f.name}: ${e.message}`);
    }
  }
  rebuildPartIndex();
  renderBomList();
  renderBomTable();
  populatePlanModels();
}

function parseBOM(rows, filename) {
  // find header row (contains "零件号" or "Part NO")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const joined = (rows[i] || []).map(c => String(c)).join('|');
    if (joined.includes('零件号') || joined.includes('Part NO')) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Header row not found');

  const headers = (rows[headerIdx] || []).map(h => String(h || '').split('\n')[0].trim());

  // Find column indexes by fuzzy match
  const findCol = (hints) => {
    for (const h of hints) {
      const idx = headers.findIndex(x => x && x.toLowerCase().includes(h.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const colPartNo   = findCol(['零件号','Part NO']);
  const colNameCN   = findCol(['零件名称(中文)','Part Name(CN)']);
  const colNameEN   = findCol(['零件名称(英文)','Part Name(EN)']);
  const colQty      = findCol(['用量','Qty']);
  const colUOM      = findCol(['度量单位','UOM']);
  const colSupplier = findCol(['供应商名称','SupplierName']);
  const colCPAC     = findCol(['CPAC编码','CPAC']);

  if (colPartNo < 0 || colQty < 0) throw new Error('Required columns missing');

  const parts = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const partNo = String(r[colPartNo] || '').trim();
    if (!partNo || partNo === '零件号') continue;
    const qty = Number(String(r[colQty]).replace(/[^0-9.\-]/g,''));
    if (!qty) continue;
    parts.push({
      partNo,
      nameCN: String(r[colNameCN]  ?? '').trim(),
      nameEN: String(r[colNameEN]  ?? '').trim(),
      qty,
      uom:    String(r[colUOM]     ?? '').trim(),
      supplier: String(r[colSupplier] ?? '').trim(),
      cpac:   String(r[colCPAC]    ?? '').trim()
    });
  }

  // label / model: derive from filename or last header cell
  const lastHeader = headers[headers.length - 1] || '';
  const m = lastHeader.match(/([A-Z0-9]{8,})$/);
  const batchCode = m ? m[1] : '';
  const label = filename.replace(/\.(xlsx|xls|csv)$/i, '');

  return { id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random()),
           label, batchCode, model: label, parts };
}

function rebuildPartIndex() {
  const idx = {};
  for (const bom of STATE.boms) {
    // sum qty per partNo within this BOM
    const per = {};
    for (const p of bom.parts) {
      if (!per[p.partNo]) per[p.partNo] = { ...p, qty: 0 };
      per[p.partNo].qty += p.qty;
    }
    for (const [partNo, p] of Object.entries(per)) {
      if (!idx[partNo]) {
        idx[partNo] = {
          partNo,
          nameCN: p.nameCN, nameEN: p.nameEN,
          uom: p.uom, supplier: p.supplier, cpac: p.cpac,
          models: new Set(),
          perModelQty: {}
        };
      }
      idx[partNo].models.add(bom.model);
      idx[partNo].perModelQty[bom.model] = (idx[partNo].perModelQty[bom.model] || 0) + p.qty;
    }
  }
  const totalModels = STATE.boms.length;
  for (const p of Object.values(idx)) {
    p.isCommon = p.models.size === totalModels && totalModels > 0;
  }
  STATE.partIndex = idx;
}

function renderBomList() {
  const wrap = $('#bomList');
  if (!STATE.boms.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = STATE.boms.map(b => `
    <div class="file-item" data-id="${b.id}">
      <span class="tag">${b.parts.length} parts</span>
      <div class="grow">
        <input type="text" value="${escapeHtml(b.model)}" data-role="model" placeholder="Model name (must match batch file Modelo column)" />
      </div>
      <button class="btn ghost" data-role="remove">✕</button>
    </div>
  `).join('');
  wrap.querySelectorAll('input[data-role=model]').forEach(inp => {
    inp.addEventListener('change', e => {
      const id = e.target.closest('.file-item').dataset.id;
      const b = STATE.boms.find(x => x.id === id);
      if (b) { b.model = e.target.value.trim(); rebuildPartIndex(); renderBomTable(); populatePlanModels(); }
    });
  });
  wrap.querySelectorAll('button[data-role=remove]').forEach(btn => {
    btn.addEventListener('click', e => {
      const id = e.target.closest('.file-item').dataset.id;
      STATE.boms = STATE.boms.filter(x => x.id !== id);
      rebuildPartIndex(); renderBomList(); renderBomTable(); populatePlanModels();
    });
  });
}

function renderBomTable() {
  const tbl = $('#bomTable');
  const q = ($('#bomSearch').value || '').toLowerCase();
  const mode = $('#bomFilter').value;
  const rows = Object.values(STATE.partIndex).filter(p => {
    if (mode === 'common' && !p.isCommon) return false;
    if (mode === 'specific' && p.isCommon) return false;
    if (q) {
      const hay = `${p.partNo} ${p.nameCN} ${p.nameEN} ${p.supplier}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (!rows.length) {
    tbl.innerHTML = `<thead><tr><th>No BOM data</th></tr></thead>`;
    return;
  }

  const models = STATE.boms.map(b => b.model);
  const head = `
    <thead><tr>
      <th>Part No.</th>
      <th>Name (CN)</th>
      <th>Name (EN)</th>
      <th>UOM</th>
      <th>Supplier</th>
      <th>Type</th>
      ${models.map(m => `<th title="${escapeHtml(m)}">${escapeHtml(shorten(m,20))}</th>`).join('')}
    </tr></thead>`;

  const body = rows.map(p => `
    <tr>
      <td><b>${escapeHtml(p.partNo)}</b></td>
      <td>${escapeHtml(p.nameCN)}</td>
      <td>${escapeHtml(p.nameEN)}</td>
      <td>${escapeHtml(p.uom)}</td>
      <td>${escapeHtml(p.supplier)}</td>
      <td>${p.isCommon
          ? '<span class="pill common">COMMON</span>'
          : `<span class="pill specific" title="${escapeHtml([...p.models].join(', '))}">SPECIFIC (${p.models.size})</span>`}</td>
      ${models.map(m => `<td class="num">${p.perModelQty[m] ? fmt(p.perModelQty[m]) : '—'}</td>`).join('')}
    </tr>
  `).join('');

  tbl.innerHTML = head + `<tbody>${body}</tbody>`;
}

function populatePlanModels() {
  const sel = $('#planModel');
  const models = STATE.boms.map(b => b.model);
  sel.innerHTML = models.length
    ? models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')
    : '<option value="">— upload BOMs first —</option>';
}

/* =========================================================
   BATCH HANDLING
   ========================================================= */
async function handleBatchFiles(files) {
  const f = files[0];
  if (!f) return;
  try {
    const rows = await fileToRows(f);
    STATE.batches = parseBatches(rows);
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
  const idx = (names) => {
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
    batch:     idx(['batch number','batch']),
    model:     idx(['modelo','model']),
    color:     idx(['color']),
    qty:       idx(['cantidad','quantity','qty']),
    trimIn:    idx(['trim in date']),
    ship:      idx(['name of ship','ship']),
    week:      idx(['week']),
    decanting: idx(['decanting date']),
    arrival:   idx(['arrival date','arrival']),
    production:idx(['production']),
    colorCode: idx(['color code']),
    carroceria:idx(['batch carroceria'])
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
      batch,
      model,
      color:     String(r[c.color] || '').trim(),
      qty:       isNaN(qty) ? 0 : qty,
      trimIn:    parseDate(r[c.trimIn]),
      ship:      String(r[c.ship] || '').trim(),
      week:      r[c.week],
      decanting: parseDate(r[c.decanting]),
      arrival:   parseDate(r[c.arrival]),
      production:String(r[c.production] || '').trim(),
      colorCode: String(r[c.colorCode] || '').trim(),
      carroceria:String(r[c.carroceria] || '').trim(),
      _stage:    'unassigned',
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
  // handle serial excel number
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 60000) {
    return new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
  }
  // mm/dd/yyyy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[1]-1, +m[2]);
  // yyyy-mm-dd
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function classifyBatches() {
  const t = today();
  for (const b of STATE.batches) {

    // 1. CONSUMED — production finished and start date already in the past
    if (b.trimIn && b.trimIn < t && /^DONE$/i.test(b.production || '')) {
      b._stage = 'consumed';
      continue;
    }

    // 2. IN TRANSIT — estimated arrival still in the future
    if (b.arrival && b.arrival > t) {
      b._stage = 'inTransit';
      continue;
    }

    // 3. FACTORY FLOOR — decanting date already passed
    //    (covers: decanting past + trim-in future, and decanting past + trim-in past + not yet DONE)
    if (b.decanting && b.decanting <= t) {
      b._stage = 'factoryFloor';
      continue;
    }

    // 4. WAREHOUSE — arrived but decanting not yet occurred
    if (b.arrival && b.arrival <= t && (!b.decanting || b.decanting > t)) {
      b._stage = 'warehouse';
      // _warehouse stays as-is (user-selectable); defaults to null
      continue;
    }

    // 5. Fallback
    b._stage = 'unassigned';
  }
}

function renderBatchStats() {
  const stages = STATE.config.stages;
  const counts = {};
  for (const b of STATE.batches) {
    counts[b._stage] = (counts[b._stage] || 0) + (b.qty || 0);
  }
  const total = Object.values(counts).reduce((a,c) => a+c, 0);
  $('#batchStats').innerHTML = `
    <div class="stat"><div class="label">Batches</div><div class="value">${STATE.batches.length}</div></div>
    <div class="stat"><div class="label">Total vehicles</div><div class="value">${fmt(total)}</div></div>
    ${Object.entries(stages).map(([k,s]) => `
      <div class="stat">
        <div class="label"><span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span></div>
        <div class="value">${fmt(counts[k]||0)}</div>
      </div>
    `).join('')}
    <div class="stat"><div class="label">Unassigned</div><div class="value">${fmt(counts.unassigned||0)}</div></div>
  `;
}

function renderBatchTable() {
  const tbl = $('#batchTable');
  if (!STATE.batches.length) { tbl.innerHTML = `<thead><tr><th>No batch data</th></tr></thead>`; return; }
  const stages = STATE.config.stages;
  const whOpts = STATE.config.warehouses.filter(w => w.enabled);

  tbl.innerHTML = `
    <thead><tr>
      <th>Batch</th><th>Model</th><th>Color</th>
      <th class="num">Qty</th>
      <th>Ship</th>
      <th>Arrival</th><th>Decanting</th><th>Trim-in</th>
      <th>Production</th><th>Stage</th><th>Warehouse</th>
    </tr></thead>
    <tbody>
      ${STATE.batches.map((b,i) => {
        const s = stages[b._stage] || { label: b._stage, color:'#9ca3af' };
        return `
          <tr data-i="${i}">
            <td>${escapeHtml(b.batch)}</td>
            <td>${escapeHtml(b.model)}</td>
            <td>${escapeHtml(b.color)}</td>
            <td class="num">${fmt(b.qty)}</td>
            <td>${escapeHtml(b.ship)}</td>
            <td>${b.arrival ? b.arrival.toLocaleDateString() : '—'}</td>
            <td>${b.decanting ? b.decanting.toLocaleDateString() : '—'}</td>
            <td>${b.trimIn ? b.trimIn.toLocaleDateString() : '—'}</td>
            <td>${escapeHtml(b.production)}</td>
            <td>
              <span class="stage"><span class="dot" style="background:${s.color}"></span>${s.label}</span>
            </td>
            <td>
              ${b._stage === 'warehouse' ? `
                <select data-role="wh" data-i="${i}">
                  <option value="">—</option>
                  ${whOpts.map(w => `<option value="${w.id}" ${b._warehouse===w.id?'selected':''}>${escapeHtml(w.name)}</option>`).join('')}
                </select>` : '—'}
            </td>
          </tr>`;
      }).join('')}
    </tbody>
  `;

  tbl.querySelectorAll('select[data-role=wh]').forEach(sel => {
    sel.addEventListener('change', e => {
      const i = +e.target.dataset.i;
      STATE.batches[i]._warehouse = e.target.value || null;
      computeInventory(); renderInventoryTable(); renderPlanning();
    });
  });
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
    // get parts of the model
    for (const [partNo, p] of Object.entries(STATE.partIndex)) {
      const q = p.perModelQty[b.model];
      if (!q) continue;
      const amount = q * b.qty;
      if (b._stage === 'inTransit') inv[partNo].inTransit += amount;
      else if (b._stage === 'factoryFloor') inv[partNo].factoryFloor += amount;
      else if (b._stage === 'edgeLine') inv[partNo].edgeLine += amount;
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
  const showAll = $('#invShowAll').checked;
  const whEnabled = STATE.config.warehouses.filter(w => w.enabled);

  const rows = Object.values(STATE.partIndex).filter(p => {
    if (!q) return true;
    const hay = `${p.partNo} ${p.nameCN} ${p.nameEN}`.toLowerCase();
    return hay.includes(q);
  });

  if (!rows.length) { tbl.innerHTML = `<thead><tr><th>Upload BOM &amp; batch files first</th></tr></thead>`; return; }

  const head = `
    <thead><tr>
      <th>Part No.</th><th>Name</th><th>UOM</th>
      <th class="num">In Transit</th>
      ${whEnabled.map(w => `<th class="num">${escapeHtml(w.name)}</th>`).join('')}
      <th class="num">Factory Floor</th>
      <th class="num">Edge Line</th>
      <th class="num">Total</th>
    </tr></thead>`;

  const body = rows.map(p => {
    const inv = STATE.inventory[p.partNo] || { inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0 };
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
      </tr>`;
  }).join('');

  tbl.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* =========================================================
   PRODUCTION PLANNING
   ========================================================= */
function bindButtons() {
  $('#bomSearch').addEventListener('input', renderBomTable);
  $('#bomFilter').addEventListener('change', renderBomTable);
  $('#invSearch').addEventListener('input', renderInventoryTable);
  $('#planSearch').addEventListener('input', renderPlanning);
  $('#planOnlyShort').addEventListener('change', renderPlanning);
  ['c_factoryFloor','c_edgeLine','c_inTransit','c_safety'].forEach(id =>
    $('#'+id).addEventListener('change', renderPlanning));
  $('#autoClassify').addEventListener('click', () => {
    classifyBatches(); renderBatchStats(); renderBatchTable();
    computeInventory(); renderInventoryTable(); renderPlanning();
  });

  $('#planAdd').addEventListener('click', () => {
    const model = $('#planModel').value;
    const qty = Number($('#planQty').value);
    if (!model || !qty) return;
    STATE.plan.push({ model, qty });
    $('#planQty').value = '';
    renderPlanList();
    renderPlanning();
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

  $('#resetAll').addEventListener('click', () => {
    if (!confirm('Erase all uploaded data?')) return;
    STATE.boms = []; STATE.batches = []; STATE.plan = [];
    STATE.inventory = {}; STATE.partIndex = {};
    renderBomList(); renderBomTable(); renderBatchTable(); renderBatchStats();
    renderInventoryTable(); renderPlanList(); renderPlanning();
  });
}

function renderPlanList() {
  const wrap = $('#planList');
  if (!STATE.plan.length) { wrap.innerHTML = '<span class="hint" style="margin:0">No plan items yet.</span>'; return; }
  wrap.innerHTML = STATE.plan.map((p,i) => `
    <div class="file-item">
      <span class="tag">${escapeHtml(p.model)}</span>
      <div class="grow">${fmt(p.qty)} vehicles</div>
      <button class="btn ghost" data-i="${i}">✕</button>
    </div>
  `).join('');
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
      <input type="checkbox" data-wh="${w.id}" ${w.enabled ? 'checked' : ''}/>
      ${escapeHtml(w.name)}
    </label>
  `).join('');
  wrap.querySelectorAll('input[data-wh]').forEach(inp => {
    inp.addEventListener('change', renderPlanning);
  });
}

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

  const useFF = $('#c_factoryFloor').checked;
  const useEL = $('#c_edgeLine').checked;
  const useIT = $('#c_inTransit').checked;
  const safety = parseFloat($('#c_safety').value) || 1.0;
  const whOn = {};
  $$('#whChecklist input[data-wh]').forEach(i => whOn[i.dataset.wh] = i.checked);

  // required per part
  const required = {};
  for (const p of STATE.plan) {
    for (const [partNo, info] of Object.entries(STATE.partIndex)) {
      const q = info.perModelQty[p.model];
      if (!q) continue;
      required[partNo] = (required[partNo] || 0) + q * p.qty * safety;
    }
  }

  const q = ($('#planSearch').value || '').toLowerCase();
  const onlyShort = $('#planOnlyShort').checked;

  const rows = [];
  for (const [partNo, req] of Object.entries(required)) {
    const info = STATE.partIndex[partNo];
    const inv  = STATE.inventory[partNo] || {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    let avail = 0;
    if (useFF) avail += inv.factoryFloor;
    if (useEL) avail += inv.edgeLine;
    if (useIT) avail += inv.inTransit;
    for (const [whId, on] of Object.entries(whOn)) {
      if (on) avail += inv.warehouses[whId] || 0;
    }
    const short = Math.max(0, req - avail);
    if (onlyShort && short <= 0) continue;
    if (q) {
      const hay = `${partNo} ${info.nameCN} ${info.nameEN}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ partNo, info, req, avail, short });
  }

  // Sort: shortages first
  rows.sort((a,b) => (b.short - a.short) || a.partNo.localeCompare(b.partNo));

  const shortCount = rows.filter(r => r.short > 0).length;
  $('#planStats').innerHTML = `
    <div class="stat"><div class="label">Parts required</div><div class="value">${rows.length}</div></div>
    <div class="stat"><div class="label">Parts short</div><div class="value" style="color:${shortCount?'var(--danger)':'var(--ok)'}">${shortCount}</div></div>
    <div class="stat"><div class="label">Total vehicles</div><div class="value">${fmt(STATE.plan.reduce((a,p)=>a+p.qty,0))}</div></div>
  `;

  const head = `
    <thead><tr>
      <th>Part No.</th><th>Name</th><th>UOM</th>
      <th class="num">Required</th>
      <th class="num">Available</th>
      <th class="num">Shortage</th>
      <th>Status</th>
    </tr></thead>`;

  const body = rows.map(r => `
    <tr>
      <td><b>${escapeHtml(r.partNo)}</b></td>
      <td>${escapeHtml(r.info.nameCN || r.info.nameEN)}</td>
      <td>${escapeHtml(r.info.uom)}</td>
      <td class="num">${fmt(r.req)}</td>
      <td class="num">${fmt(r.avail)}</td>
      <td class="num" style="color:${r.short>0?'var(--danger)':'inherit'};font-weight:${r.short>0?'600':'400'}">${fmt(r.short)}</td>
      <td>${r.short > 0 ? '<span class="pill short">SHORT</span>' : '<span class="pill ok">OK</span>'}</td>
    </tr>
  `).join('');

  tbl.innerHTML = head + `<tbody>${body}</tbody>`;
}

/* =========================================================
   WAREHOUSE EDITOR
   ========================================================= */
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
    if (e.target.dataset.role === 'name') STATE.config.warehouses[i].name = e.target.value;
    if (e.target.dataset.role === 'enabled') STATE.config.warehouses[i].enabled = e.target.checked;
  }));
  wrap.querySelectorAll('button[data-role=del]').forEach(b => b.addEventListener('click', e => {
    STATE.config.warehouses.splice(+e.target.dataset.i, 1);
    renderWarehouseEditor(); renderWarehouseChecklist();
  }));
}

function saveWarehouses() {
  renderWarehouseChecklist();
  renderBatchStats();
  computeInventory();
  renderInventoryTable();
  renderPlanning();
  alert('Warehouses updated.');
}

/* =========================================================
   EXPORTS
   ========================================================= */
function downloadWorkbook(wb, filename) {
  XLSX.writeFile(wb, filename);
}
function aoaToSheet(aoa) { return XLSX.utils.aoa_to_sheet(aoa); }

function exportBom() {
  const models = STATE.boms.map(b => b.model);
  const aoa = [
    ['Part No.','Name CN','Name EN','UOM','Supplier','Type','Models Used', ...models]
  ];
  for (const p of Object.values(STATE.partIndex)) {
    aoa.push([
      p.partNo, p.nameCN, p.nameEN, p.uom, p.supplier,
      p.isCommon ? 'COMMON' : 'SPECIFIC',
      [...p.models].join(' | '),
      ...models.map(m => p.perModelQty[m] || '')
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'BOM Analysis');
  downloadWorkbook(wb, `BOM_Analysis_${dateStamp()}.xlsx`);
}

function exportInventory() {
  const whEnabled = STATE.config.warehouses.filter(w => w.enabled);
  const aoa = [['Part No.','Name','UOM','In Transit', ...whEnabled.map(w=>w.name), 'Factory Floor','Edge Line','Total']];
  for (const p of Object.values(STATE.partIndex)) {
    const inv = STATE.inventory[p.partNo] || {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    aoa.push([
      p.partNo, p.nameCN || p.nameEN, p.uom,
      inv.inTransit,
      ...whEnabled.map(w => inv.warehouses[w.id] || 0),
      inv.factoryFloor, inv.edgeLine, inv.total
    ]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, aoaToSheet(aoa), 'Inventory');
  downloadWorkbook(wb, `Material_Inventory_${dateStamp()}.xlsx`);
}

function exportPlan() {
  // Recompute rows (same logic as renderPlanning)
  const useFF = $('#c_factoryFloor').checked;
  const useEL = $('#c_edgeLine').checked;
  const useIT = $('#c_inTransit').checked;
  const safety = parseFloat($('#c_safety').value) || 1.0;
  const whOn = {};
  $$('#whChecklist input[data-wh]').forEach(i => whOn[i.dataset.wh] = i.checked);

  const required = {};
  for (const p of STATE.plan) {
    for (const [partNo, info] of Object.entries(STATE.partIndex)) {
      const q = info.perModelQty[p.model];
      if (!q) continue;
      required[partNo] = (required[partNo] || 0) + q * p.qty * safety;
    }
  }
  const aoa = [
    ['Plan:', ...STATE.plan.map(p => `${p.model} × ${p.qty}`)],
    ['Safety factor:', safety],
    [],
    ['Part No.','Name','UOM','Required','Available','Shortage','Status']
  ];
  for (const [partNo, req] of Object.entries(required)) {
    const info = STATE.partIndex[partNo];
    const inv  = STATE.inventory[partNo] || {inTransit:0, warehouses:{}, factoryFloor:0, edgeLine:0, total:0};
    let avail = 0;
    if (useFF) avail += inv.factoryFloor;
    if (useEL) avail += inv.edgeLine;
    if (useIT) avail += inv.inTransit;
    for (const [whId,on] of Object.entries(whOn)) if (on) avail += inv.warehouses[whId] || 0;
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

/* Expose for debugging in console */
window.MRP = STATE;
