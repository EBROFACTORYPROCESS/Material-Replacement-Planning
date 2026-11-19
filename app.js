// ============================================================
// app.js - Complete Core Logic (Bug Fixes Applied)
// ============================================================

console.log('✅ app.js loaded');

// ============================v
// 1. Constants & State
// ============================

const REPO_OWNER = 'ebrofactoryprocess';
const REPO_NAME = 'ebrofactoryprocess.github.io';
const DATA_PATH = 'data.json';

let isConnectingMode = false;
let selectedNodeId = null;
let selectedArrowIndex = null;
let appData = null;
let currentSha = null;
let isSaving = false;
let currentMode = 'display';
let currentView = 'sequence';
let searchKeyword = '';
let activeFilters = [];
let collapseState = new Map();
let pendingDeleteCallback = null;
let pendingAddSubCallback = null;
let pendingImportCallback = null;
let currentEditingProcess = null;
let lastSnapshot = null;
let eventsBound = false;
let workflowEventsBound = false;
let arrowUpdatePending = false; // ✅ declared only once

// ============================
// 2. Column Definitions
// ============================

const columnPaths = {
    seq: p => p.seq,
    name: p => p.name,
    description: p => p.description || '',
    r: p => p.raci.r.join(', '),
    a: p => p.raci.a.join(', '),
    c: p => p.raci.c.join(', '),
    i: p => p.raci.i.join(', '),
    businessStatus: p => p.businessStatus,
    sysName: p => p.system.name,
    sysStatus: p => p.system.status,
    sysResp: p => p.system.responsible,
    businessDoc: p => p.businessDoc || '',
    userManual: p => p.userManual || '',
    notes: p => p.notes || ''
};

const columnNames = {
    seq: 'Seq',
    name: 'Process Name',
    description: 'Description',
    r: 'Responsible (R)',
    a: 'Accountable (A)',
    c: 'Consulted (C)',
    i: 'Informed (I)',
    businessStatus: 'Business Status',
    sysName: 'System Name',
    sysStatus: 'System Status',
    sysResp: 'System Responsible',
    businessDoc: 'Business Doc',
    userManual: 'User Manual',
    notes: 'Notes'
};

// ============================
// 3. Utility Functions
// ============================

function genId() {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 8);
}
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        if (m === '"') return '&quot;';
        return m;
    });
}
function generateNodeDiff(oldData, newData) {
    const diff = {};
    
    // ============================================================
    // NEW: Compare Master Data (root-level properties)
    // ============================================================
    const masterKeys = ['departments', 'sysNameList', 'sysStatusList', 'sysRespList', 'businessStatuses', 'importanceList', 'urgencyList'];
    const masterDiff = {};
    
    for (const key of masterKeys) {
        const oldVal = oldData[key] || [];
        const newVal = newData[key] || [];
        
        // Compare arrays
        if (Array.isArray(oldVal) && Array.isArray(newVal)) {
            const oldSet = new Set(oldVal.map(item => JSON.stringify(item)));
            const newSet = new Set(newVal.map(item => JSON.stringify(item)));
            
            const added = [];
            const removed = [];
            
            // Find added items
            newVal.forEach(item => {
                const stringified = JSON.stringify(item);
                if (!oldSet.has(stringified)) {
                    added.push(item);
                }
            });
            
            // Find removed items
            oldVal.forEach(item => {
                const stringified = JSON.stringify(item);
                if (!newSet.has(stringified)) {
                    removed.push(item);
                }
            });
            
            if (added.length > 0 || removed.length > 0) {
                masterDiff[key] = {};
                if (added.length > 0) masterDiff[key]._added = added;
                if (removed.length > 0) masterDiff[key]._removed = removed;
            }
        } else if (typeof oldVal === 'object' && typeof newVal === 'object') {
            // For objects, compare as JSON
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
                masterDiff[key] = { _updated: newVal };
            }
        } else {
            // For primitive values
            if (oldVal !== newVal) {
                masterDiff[key] = { _updated: newVal };
            }
        }
    }
    
    if (Object.keys(masterDiff).length > 0) {
        diff._master = masterDiff;
        console.log('📊 Master data changes detected:', Object.keys(masterDiff));
    }
    
    // ============================================================
    // YOUR EXISTING LOGIC BELOW (UNCHANGED)
    // ============================================================
    const oldMap = {};
    (oldData.scenarios || []).forEach(s => { oldMap[s.id] = s; });

    // Check for DELETED scenarios (in old but not in new)
    const newIds = new Set((newData.scenarios || []).map(s => s.id));
    for (const oldId in oldMap) {
        if (!newIds.has(oldId)) {
            diff[oldId] = { _deleted: true };
            console.log(`Scenario ${oldId} was deleted`);
        }
    }

    // Process new scenarios (added or updated)
    (newData.scenarios || []).forEach(newSc => {
        const oldSc = oldMap[newSc.id];
        if (!oldSc) {
            // New scenario – send full data
            diff[newSc.id] = { _full: true, data: newSc };
            return;
        }

        const scenarioDiff = {};

        // ============================================================
        // Compare scenario-level properties (name, etc.)
        // ============================================================
        const scenarioChanges = {};
        
        // Log the values for debugging
        console.log(`Comparing scenario "${newSc.id}": old name="${oldSc.name}", new name="${newSc.name}"`);
        
        if (newSc.name !== oldSc.name) {
            scenarioChanges.name = newSc.name;
            console.log(`✅ Scenario ${newSc.id} name changed: "${oldSc.name}" → "${newSc.name}"`);
        }
        
        // Add other scenario-level properties if needed (e.g., description, etc.)
        // if (newSc.description !== oldSc.description) scenarioChanges.description = newSc.description;

        if (Object.keys(scenarioChanges).length > 0) {
            scenarioDiff._scenario = scenarioChanges;
            console.log(`Added scenario changes for ${newSc.id}:`, scenarioChanges);
        }

        // ----- Compare processes -----
        const oldProcesses = oldSc.processes || [];
        const newProcesses = newSc.processes || [];

        const oldProcMap = {};
        oldProcesses.forEach(p => { if (p.id) oldProcMap[p.id] = p; });

        const newProcMap = {};
        newProcesses.forEach(p => { if (p.id) newProcMap[p.id] = p; });

        const procChanges = {};
        for (const id in newProcMap) {
            const oldProc = oldProcMap[id];
            const newProc = newProcMap[id];
            if (!oldProc) {
                procChanges[id] = { _added: true, proc: newProc };
                continue;
            }
            if (JSON.stringify(oldProc) !== JSON.stringify(newProc)) {
                procChanges[id] = { _updated: true, proc: newProc };
            }
        }
        for (const id in oldProcMap) {
            if (!newProcMap[id]) {
                procChanges[id] = { _deleted: true };
            }
        }
        if (Object.keys(procChanges).length > 0) {
            scenarioDiff.processes = procChanges;
        }

        // ----- Compare workflow nodes -----
        const newNodes = newSc.workflow?.nodes || [];
        const oldNodes = oldSc.workflow?.nodes || [];

        const oldNodeMap = {};
        oldNodes.forEach(n => { if (n.id) oldNodeMap[n.id] = n; });

        const newNodeMap = {};
        newNodes.forEach(n => { if (n.id) newNodeMap[n.id] = n; });

        const nodeChanges = {};
        for (const id in newNodeMap) {
            const oldNode = oldNodeMap[id];
            const newNode = newNodeMap[id];
            if (!oldNode) {
                nodeChanges[id] = { _added: true, node: newNode };
                continue;
            }
            const changes = {};
            if (newNode.x !== oldNode.x) changes.x = newNode.x;
            if (newNode.y !== oldNode.y) changes.y = newNode.y;
            if (newNode.hidden !== oldNode.hidden) changes.hidden = newNode.hidden;
            if (newNode.type !== oldNode.type) changes.type = newNode.type;
            if (newNode.label !== oldNode.label) changes.label = newNode.label;
            if (newNode.processId !== oldNode.processId) changes.processId = newNode.processId;

            if (Object.keys(changes).length > 0) {
                nodeChanges[id] = changes;
            }
        }
        for (const id in oldNodeMap) {
            if (!newNodeMap[id]) {
                nodeChanges[id] = { _deleted: true };
            }
        }
        if (Object.keys(nodeChanges).length > 0) {
            scenarioDiff.nodes = nodeChanges;
        }

        // ----- Compare workflow connections -----
        const newConnections = newSc.workflow?.connections || [];
        const oldConnections = oldSc.workflow?.connections || [];

        const oldConnMap = {};
        oldConnections.forEach(c => { if (c.id) oldConnMap[c.id] = c; });

        const newConnMap = {};
        newConnections.forEach(c => { if (c.id) newConnMap[c.id] = c; });

        const connChanges = {};
        for (const id in newConnMap) {
            const oldConn = oldConnMap[id];
            const newConn = newConnMap[id];
            if (!oldConn) {
                connChanges[id] = { _added: true, conn: newConn };
                continue;
            }
            const changes = {};
            if (newConn.from !== oldConn.from) changes.from = newConn.from;
            if (newConn.to !== oldConn.to) changes.to = newConn.to;
            if (newConn.type !== oldConn.type) changes.type = newConn.type;
            if (newConn.label !== oldConn.label) changes.label = newConn.label;
            if (Object.keys(changes).length > 0) {
                connChanges[id] = changes;
            }
        }
        for (const id in oldConnMap) {
            if (!newConnMap[id]) {
                connChanges[id] = { _deleted: true };
            }
        }
        if (Object.keys(connChanges).length > 0) {
            scenarioDiff.connections = connChanges;
        }

        if (Object.keys(scenarioDiff).length > 0) {
            diff[newSc.id] = scenarioDiff;
            console.log(`✅ Diff created for scenario ${newSc.id} with changes:`, Object.keys(scenarioDiff));
        } else {
            console.log(`ℹ️ No changes detected for scenario ${newSc.id}`);
        }
    });

    console.log('📊 Final diff:', JSON.stringify(diff, null, 2));
    return diff;
}
function ensureUniqueNodeIds(workflow) {
    if (!workflow || !workflow.nodes) return;
    let counter = 0;
    for (let node of workflow.nodes) {
        // Generate a new unique ID based on the existing nodeIdCounter
        // or simply use a sequential ID.
        node.id = 'node-' + (workflow.nodeIdCounter || 0) + '-' + (counter++);
    }
    // Update the workflow's counter
    if (workflow.nodes.length > 0) {
        workflow.nodeIdCounter = (workflow.nodeIdCounter || 0) + workflow.nodes.length;
    }
}
function enforceSimpleNodeIds(workflow) {
    if (!workflow || !workflow.nodes || !Array.isArray(workflow.nodes)) return;
    const nodes = workflow.nodes;
    const connections = workflow.connections || [];

    // Check if any ID already contains a dash or is not of the form 'node-X'
    let needsRenumber = false;
    for (const n of nodes) {
        if (!n.id || !/^node-\d+$/.test(n.id)) {
            needsRenumber = true;
            break;
        }
    }
    if (!needsRenumber) return; // already simple

    // Renumber all nodes
    const idMap = {};
    const newNodes = [];
    let counter = 0;
    nodes.forEach(n => {
        const oldId = n.id;
        const newId = 'node-' + counter++;
        idMap[oldId] = newId;
        n.id = newId;
        newNodes.push(n);
    });

    // Update connections
    const validIds = new Set(newNodes.map(n => n.id));
    const newConnections = connections
        .map(c => {
            const from = idMap[c.from] || c.from;
            const to = idMap[c.to] || c.to;
            return { ...c, from, to };
        })
        .filter(c => validIds.has(c.from) && validIds.has(c.to));

    workflow.nodes = newNodes;
    workflow.connections = newConnections;
    // Update counter to the max
    workflow.nodeIdCounter = counter;
}

function compareSeq(a, b) {
    const strA = String(a || '0');
    const strB = String(b || '0');
    let pa = strA.split('.');
    let pb = strB.split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        let na = i < pa.length ? parseInt(pa[i]) : 0;
        let nb = i < pb.length ? parseInt(pb[i]) : 0;
        if (isNaN(na)) na = 0;
        if (isNaN(nb)) nb = 0;
        if (na !== nb) return na - nb;
    }
    return 0;
}

function sortProcesses(procs) {
    if (!procs || !Array.isArray(procs)) {
        console.warn('⚠️ sortProcesses: input is not an array, returning empty array');
        return [];
    }
    const validProcs = procs.filter(p => p && typeof p === 'object' && p.seq !== undefined);
    return [...validProcs].sort((a, b) => {
        const seqA = a.seq || '0';
        const seqB = b.seq || '0';
        return compareSeq(String(seqA), String(seqB));
    });
}

function isSeqUnique(scenario, seq, excludeId) {
    return !scenario.processes.some(p => p.seq === seq && p.id !== excludeId);
}

// ============================
// 4. Data Normalization
// ============================

function normalizeData(data) {
    console.log('📊 normalizeData called');

    if (!data || typeof data !== 'object') {
        console.warn('⚠️ normalizeData: data is not an object, creating default');
        return getDefaultData();
    }

    if (!data.scenarios || !Array.isArray(data.scenarios)) {
        console.warn('⚠️ normalizeData: scenarios is not an array, creating default');
        data.scenarios = [{
            id: 'default',
            name: 'Manufacturing',
            processes: []
        }];
        data.currentScenarioId = 'default';
    }

    for (let sc of data.scenarios) {
        if (!sc || typeof sc !== 'object') {
            console.warn('⚠️ Skipping invalid scenario:', sc);
            continue;
        }

        if (!sc.processes || !Array.isArray(sc.processes)) {
            console.warn('⚠️ Scenario missing processes array, creating empty:', sc.id || 'unknown');
            sc.processes = [];
        }

        for (let p of sc.processes) {
            if (!p || typeof p !== 'object') {
                console.warn('⚠️ Skipping invalid process:', p);
                continue;
            }

            if (!p.raci || typeof p.raci !== 'object') {
                p.raci = { r: [], a: [], c: [], i: [] };
            }

            if (typeof p.raci.r === 'string') {
                p.raci.r = p.raci.r.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.a === 'string') {
                p.raci.a = p.raci.a.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.c === 'string') {
                p.raci.c = p.raci.c.split(',').filter(s => s && s.trim());
            }
            if (typeof p.raci.i === 'string') {
                p.raci.i = p.raci.i.split(',').filter(s => s && s.trim());
            }

            if (!Array.isArray(p.raci.r)) p.raci.r = [];
            if (!Array.isArray(p.raci.a)) p.raci.a = [];
            if (!Array.isArray(p.raci.c)) p.raci.c = [];
            if (!Array.isArray(p.raci.i)) p.raci.i = [];

            if (!p.system || typeof p.system !== 'object') {
                p.system = { name: '', status: '', responsible: '' };
            }

            if (!p.businessDoc) p.businessDoc = '';
            if (!p.userManual) p.userManual = '';
            if (!p.notes) p.notes = '';
            if (!p.id) p.id = genId();

            if (p.seq !== undefined && p.seq !== null) {
                p.seq = String(p.seq);
            } else {
                p.seq = '0';
            }
        }

        sc.processes = sortProcesses(sc.processes);

        if (!sc.workflow) {
            sc.workflow = { nodes: [], connections: [] };
        }
        normalizeWorkflowData(sc.workflow);
        if (sc.workflow && sc.workflow.nodes) {
            enforceSimpleNodeIds(sc.workflow);
            //ensureUniqueNodeIds(sc.workflow);
            sortWorkflowNodes(sc.workflow);
        }
        if (sc.workflow && sc.workflow.nodeIdCounter !== undefined) {
            if (Array.isArray(sc.workflow.nodeIdCounter)) {
                sc.workflow.nodeIdCounter = sc.workflow.nodeIdCounter[0] || 0;
            }
            if (typeof sc.workflow.nodeIdCounter !== 'number') {
                sc.workflow.nodeIdCounter = parseInt(sc.workflow.nodeIdCounter) || 0;
            }
        }
        if (!sc.workflow.nodes || !Array.isArray(sc.workflow.nodes)) {
            sc.workflow.nodes = [];
        }
        if (!sc.workflow.connections || !Array.isArray(sc.workflow.connections)) {
            sc.workflow.connections = [];
        }
    }

    if (!data.currentScenarioId && data.scenarios.length > 0) {
        data.currentScenarioId = data.scenarios[0].id || 'default';
    }

    if (!data.departments || !Array.isArray(data.departments)) {
        data.departments = ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'];
    }

    if (!data.sysNameList || !Array.isArray(data.sysNameList)) {
        data.sysNameList = ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'];
    }

    if (!data.sysStatusList || !Array.isArray(data.sysStatusList)) {
        data.sysStatusList = [
            { value: 'Operational', color: 'green' },
            { value: 'Completed', color: 'green' },
            { value: 'Offline', color: 'red' },
            { value: 'To Be Implemented', color: 'red' },
            { value: 'Work in Progress', color: 'yellow' }
        ];
    }

    if (!data.businessStatuses || !Array.isArray(data.businessStatuses)) {
        data.businessStatuses = [
            { value: 'Not Defined', color: 'red' },
            { value: 'In Progress', color: 'yellow' },
            { value: 'Completed', color: 'green' }
        ];
    }

    if (!data.sysRespList || !Array.isArray(data.sysRespList)) {
        data.sysRespList = [];
    }

    console.log('✅ Data normalized successfully, scenarios:', data.scenarios.length);
    return data;
}

// ============================
// Sort the workflow nodes array 
// ============================


function sortWorkflowNodes(workflow) {
    if (!workflow || !workflow.nodes || !Array.isArray(workflow.nodes)) return;
    workflow.nodes.sort((a, b) => {
        // Sort by id – this is stable and unique (if duplicates are fixed)
        return (a.id || '').localeCompare(b.id || '');
    });
}
function syncWorkflowNodesWithProcesses(scenario) {
    if (!scenario || !scenario.processes || !scenario.workflow) return 0;
    const processes = scenario.processes;
    const nodes = scenario.workflow.nodes || [];
    const connections = scenario.workflow.connections || [];

    // Get set of valid process IDs
    const processIds = new Set(processes.map(p => p.id));
    const specialTypes = new Set(['start', 'end', 'decision', 'parallel']);

    // Filter out orphan nodes (remove nodes whose processId no longer exists)
    const originalCount = nodes.length;
    const filteredNodes = nodes.filter(n => {
        // If node has no processId, keep it ONLY if it's a special type
        if (!n.processId) {
            return specialTypes.has(n.type);
        }
        // If node has a processId, keep it only if that process still exists
        return processIds.has(n.processId);
    });
    const removedCount = originalCount - filteredNodes.length;

    // Build map of kept nodes
    const keptProcessNodeMap = {};
    filteredNodes.forEach(n => { if (n.processId) keptProcessNodeMap[n.processId] = n; });

    // Determine max counter for new node IDs
    let maxCounter = 0;
    filteredNodes.forEach(n => {
        const match = n.id.match(/node-(\d+)/);
        if (match) maxCounter = Math.max(maxCounter, parseInt(match[1]) + 1);
    });
    let counter = maxCounter;

    // Add missing nodes for processes that don't have one
    const cols = 6, spacingX = 160, spacingY = 110;
    let idx = 0;
    const newNodes = [...filteredNodes];
    processes.forEach(p => {
        if (!keptProcessNodeMap[p.id]) {
            const isSub = p.seq && p.seq.includes('.');
            const node = {
                id: 'node-' + counter++,
                processId: p.id,
                type: isSub ? 'sub' : 'main',
                x: 100 + (idx % cols) * spacingX,
                y: 100 + Math.floor(idx / cols) * spacingY,
                label: p.name || 'Unnamed',
                hidden: false
            };
            newNodes.push(node);
            idx++;
        }
    });

    // Update scenario
    scenario.workflow.nodes = newNodes;
    scenario.workflow.nodeIdCounter = counter;

    // Clean up connections that reference deleted nodes
    const validNodeIds = new Set(newNodes.map(n => n.id));
    scenario.workflow.connections = (scenario.workflow.connections || [])
        .filter(c => validNodeIds.has(c.from) && validNodeIds.has(c.to));

    // Return the count of removed nodes
    return removedCount;
}
// ============================
// 5. Token Management
// ============================

function getGitHubToken() {
    return localStorage.getItem('github_token');
}

function setGitHubToken(token) {
    if (token && token.trim()) {
        localStorage.setItem('github_token', token.trim());
        return true;
    }
    return false;
}

function clearGitHubToken() {
    localStorage.removeItem('github_token');
}

function showTokenSetup() {
    const currentToken = getGitHubToken() || '';
    const newToken = prompt(
        '🔑 Enter your GitHub Personal Access Token\n\n' +
        'How to get one:\n' +
        '1. GitHub Settings → Developer settings\n' +
        '2. Personal access tokens → Tokens (classic)\n' +
        '3. Check "repo" (all permissions)\n\n' +
        'The token will be saved in your browser.',
        currentToken
    );
    if (newToken !== null && newToken.trim()) {
        setGitHubToken(newToken);
        alert('✅ Token saved to browser local storage');
        loadData();
    } else if (newToken === '') {
        clearGitHubToken();
        alert('Token cleared');
    }
}
function syncNodesForCurrentScenario() {
    if (currentMode !== 'edit') {
        alert('Please enter Edit Mode first.');
        return;
    }
    const sc = getCurrentScenario();
    if (!sc) {
        alert('No scenario selected.');
        return;
    }
    const processes = sc.processes || [];
    if (processes.length === 0) {
        alert('No processes in this scenario.');
        return;
    }
    let nodes = sc.workflow?.nodes || [];
    // Map existing processId -> node
    const processNodeMap = {};
    nodes.forEach(n => { if (n.processId) processNodeMap[n.processId] = n; });
    const cols = 6, spacingX = 160, spacingY = 110;
    let addedCount = 0;
    // Determine starting index for new node IDs
    let maxCounter = 0;
    nodes.forEach(n => {
        const match = n.id.match(/^node-(\d+)$/);
        if (match) maxCounter = Math.max(maxCounter, parseInt(match[1]) + 1);
    });
    let counter = maxCounter || 0;

    processes.forEach((p, idx) => {
        if (!processNodeMap[p.id]) {
            const isSub = p.seq && p.seq.includes('.');
            const node = {
                id: 'node-' + counter++,
                processId: p.id,
                type: isSub ? 'sub' : 'main',
                x: 100 + (idx % cols) * spacingX,
                y: 100 + Math.floor(idx / cols) * spacingY,
                label: p.name || 'Unnamed',
                hidden: false
            };
            nodes.push(node);
            addedCount++;
        }
    });

    if (addedCount === 0) {
        alert('All processes already have nodes.');
        return;
    }

    sc.workflow.nodes = nodes;
    // Update the counter in workflow
    if (!sc.workflow) sc.workflow = {};
    sc.workflow.nodeIdCounter = counter;

    // Save the updated data
    saveWorkflowData(sc.workflow);
    // Also update snapshot? saveWorkflowData already calls renderWorkflow, but we may need to save to GitHub.
    // We'll prompt the user to save manually or auto-save.
    alert(`✅ Added ${addedCount} nodes. Please click "Save to GitHub" to persist the changes.`);
    renderWorkflow();
}
// ============================
// 6. Snapshot Management
// ============================

function loadSnapshot() {
    try {
        const saved = localStorage.getItem('bpo_snapshot');
        if (saved) {
            lastSnapshot = JSON.parse(saved);
            return true;
        }
    } catch (e) {
        console.warn('Failed to load snapshot:', e);
    }
    return false;
}

function saveSnapshot(data) {
    try {
        localStorage.setItem('bpo_snapshot', JSON.stringify(data));
        lastSnapshot = JSON.parse(JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('Failed to save snapshot:', e);
        return false;
    }
}

function initializeSnapshot(data) {
    if (!loadSnapshot()) {
        lastSnapshot = JSON.parse(JSON.stringify(data));
        saveSnapshot(lastSnapshot);
        console.log('📸 Initial snapshot created');
        return true;
    }
    return true;
}

function generateDiff(oldData, newData) {
    if (typeof jsondiffpatch !== 'undefined' && jsondiffpatch.diff) {
        try {
            const delta = jsondiffpatch.diff(oldData, newData);
            return delta || null;
        } catch (e) {
            console.warn('jsondiffpatch diff failed, using simple diff:', e.message);
            return generateSimpleDiff(oldData, newData);
        }
    }
    return generateSimpleDiff(oldData, newData);
}

function generateSimpleDiff(oldData, newData) {
    const diff = generateNodeDiff(lastSnapshot, data);
    if (!diff || Object.keys(diff).length === 0) {
        alert('ℹ️ No changes detected. Nothing to save.');
        // ... cleanup
        return;
    }
    let hasChanges = false;
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
    for (const key of allKeys) {
        const oldVal = JSON.stringify(oldData[key]);
        const newVal = JSON.stringify(newData[key]);
        if (oldVal !== newVal) {
            diff[key] = newData[key];
            hasChanges = true;
        }
    }
    return hasChanges ? diff : null;
}

// ============================
// Save data to GitHub (with Gist for large data)
// ============================

// ============================
// Save data to GitHub (with Gist for large data)
// ============================

async function saveDataToGitHub(data) {
    if (isSaving) return;
    isSaving = true;

    const saveBtn = document.getElementById('saveDataBtn');
    if (saveBtn) {
        saveBtn.textContent = '⏳ Saving...';
        saveBtn.disabled = true;
    }

    try {
        let token = getGitHubToken();
        if (!token) {
            token = prompt(
                '🔑 A GitHub Token is required to save data\n\n' +
                'Please enter your GitHub Token. It will be saved in your browser.'
            );
            if (token && token.trim()) {
                setGitHubToken(token);
                alert('✅ Token saved to browser local storage');
            } else {
                throw new Error('No Token provided, save cancelled');
            }
        }

        token = token.trim();

        // Sort workflow nodes for consistency
        if (data.scenarios) {
            data.scenarios.forEach(sc => {
                if (sc.workflow && sc.workflow.nodes) sortWorkflowNodes(sc.workflow);
            });
        }
        if (lastSnapshot && lastSnapshot.scenarios) {
            lastSnapshot.scenarios.forEach(sc => {
                if (sc.workflow && sc.workflow.nodes) sortWorkflowNodes(sc.workflow);
            });
        }

        if (!lastSnapshot) {
            console.log('📸 No snapshot found, creating baseline...');
            lastSnapshot = JSON.parse(JSON.stringify(data));
            saveSnapshot(lastSnapshot);
            alert('ℹ️ Baseline snapshot created. Please make another change to save.');
            isSaving = false;
            if (saveBtn) {
                saveBtn.textContent = '💾 Save to GitHub';
                saveBtn.disabled = false;
            }
            return;
        }
        console.log('🔍 Snapshot scenarios:', lastSnapshot.scenarios.map(s => s.id));
        console.log('🔍 Current scenarios:', data.scenarios.map(s => s.id));
        
        // Check first node in snapshot and current data
        if (lastSnapshot.scenarios.length > 0 && data.scenarios.length > 0) {
            const snapNode = lastSnapshot.scenarios[0].workflow?.nodes?.[0];
            const currNode = data.scenarios[0].workflow?.nodes?.[0];
            console.log('📌 Snapshot first node:', snapNode);
            console.log('📌 Current first node:', currNode);
        }
        // Generate custom diff using node IDs (stable)
        const diff = generateNodeDiff(lastSnapshot, data);
        if (!diff || Object.keys(diff).length === 0) {
            alert('ℹ️ No changes detected. Nothing to save.');
            isSaving = false;
            if (saveBtn) {
                saveBtn.textContent = '💾 Save to GitHub';
                saveBtn.disabled = false;
            }
            return;
        }

        const jsonStr = JSON.stringify(diff);
        console.log(`📊 Diff size: ${jsonStr.length} bytes (${(jsonStr.length/1024).toFixed(1)} KB)`);

        let gistId = null;
        let payloadData = jsonStr;
        let payloadType = 'node-diff';

        // Optional: use Gist for very large diffs (>30KB)
        if (jsonStr.length > 30000) {
            console.log('📤 Data is large, uploading to Gist...');
            const gistPayload = {
                description: `BPO node-diff - ${new Date().toISOString()}`,
                public: false,
                files: {
                    'diff.json': {
                        content: jsonStr
                    }
                }
            };

            try {
                const gistResponse = await fetch('https://api.github.com/gists', {
                    method: 'POST',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/vnd.github.v3+json'
                    },
                    body: JSON.stringify(gistPayload)
                });

                if (!gistResponse.ok) {
                    const errorData = await gistResponse.json();
                    console.error('Gist API error:', errorData);
                    console.log('⚠️ Gist creation failed, falling back to direct payload');
                } else {
                    const gistData = await gistResponse.json();
                    gistId = gistData.id;
                    payloadType = 'gist';
                    payloadData = '';
                    console.log(`✅ Gist created: ${gistId}`);
                }
            } catch (gistError) {
                console.error('Gist creation failed:', gistError);
                console.log('⚠️ Falling back to direct payload');
                payloadType = 'diff';
                payloadData = jsonStr;
                gistId = null;
            }
        }

        const payload = {
            event_type: 'update-data',
            client_payload: {
                type: payloadType,              // 'node-diff' or 'gist' (but gist still contains node-diff data)
                gist_id: gistId || '',
                data: payloadData,              // if gist, this is empty; if not, it's the diff JSON
                snapshot_id: Date.now()
            }
        };

        console.log(`📤 Sending payload with type: ${payloadType}, gist_id: ${gistId || 'none'}`);
        console.log(`📤 Payload data length: ${payloadData.length} bytes`);

        const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/dispatches`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Dispatch API error:', errorData);
            if (response.status === 401) {
                clearGitHubToken();
                throw new Error('Token is invalid or expired. Please re-enter your Token.');
            }
            throw new Error(errorData.message || `HTTP ${response.status}`);
        }

        saveSnapshot(data);
        console.log('✅ Snapshot updated');

        const sizeMsg = (jsonStr.length > 30000 && gistId)
            ? `📤 Uploaded to Gist (temporary)\n   Gist ID: ${gistId}`
            : `📊 Size: ${(jsonStr.length/1024).toFixed(1)} KB`;

        alert(`✅ Changes saved successfully!\n\n${sizeMsg}\n\nGitHub Actions is applying the changes.`);

        setTimeout(() => {
            if (confirm('Refresh page to see the latest data?')) {
                location.reload();
            }
        }, 10000);

    } catch (error) {
        console.error('Save failed:', error);
        alert(`❌ Save failed: ${error.message}`);
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.textContent = '💾 Save to GitHub';
            saveBtn.disabled = false;
        }
    }
}
async function saveDataToFile() {
    if (isSaving) return;
    isSaving = true;

    const saveBtn = document.getElementById('saveDataBtn');
    if (saveBtn) {
        saveBtn.textContent = '⏳ Saving...';
        saveBtn.disabled = true;
    }

    try {
        // Keep workflow nodes sorted for consistent output (same as old save path).
        if (appData.scenarios) {
            appData.scenarios.forEach(sc => {
                if (sc.workflow && sc.workflow.nodes) sortWorkflowNodes(sc.workflow);
            });
        }

        // Provenance stamp. Ask once, reuse thereafter; empty is allowed.
        let savedBy = '';
        try {
            savedBy = localStorage.getItem('bpo_savedBy') || '';
        } catch (e) { /* ignore */ }

        if (!savedBy) {
            const answer = prompt('Name for provenance (optional):', '');
            if (answer === null) {
                // User cancelled the prompt — proceed without savedBy.
                savedBy = '';
            } else if (answer.trim()) {
                savedBy = answer.trim();
                try { localStorage.setItem('bpo_savedBy', savedBy); } catch (e) { /* ignore */ }
            }
        }

        // Clone + stamp.
        const saveCopy = JSON.parse(JSON.stringify(appData));
        saveCopy._meta = {
            savedAt: new Date().toISOString()
        };
        if (savedBy) saveCopy._meta.savedBy = savedBy;

        const jsonStr = JSON.stringify(saveCopy, null, 2);

        // Try File System Access API first; fall back to Blob download.
        let wroteToDisk = false;
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: 'data.json',
                    types: [
                        { description: 'JSON', accept: { 'application/json': ['.json'] } }
                    ]
                });
                const writable = await handle.createWritable();
                await writable.write(jsonStr);
                await writable.close();
                wroteToDisk = true;
            } catch (e) {
                if (e && e.name === 'AbortError') {
                    // User cancelled the OS save dialog — silently no-op.
                    return;
                }
                console.warn('showSaveFilePicker failed, falling back to Blob:', e);
            }
        }

        if (!wroteToDisk) {
            // Fallback path (non-Chromium or picker error).
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            wroteToDisk = true;
        }

        // Persist to localStorage for next visit (quota-guarded).
        try {
            localStorage.setItem('bpo_data', jsonStr);
        } catch (e) {
            console.warn('localStorage.setItem(bpo_data) failed after save:', e);
            if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                alert(
                    'Browser storage is full — data was saved to disk but will not ' +
                    'auto-load next time. Please pick the file again on next visit.'
                );
            }
        }

        // Keep dead snapshot machinery coherent.
        try { saveSnapshot(saveCopy); } catch (e) { /* ignore */ }

        console.log('✅ Data saved to file.');

    } catch (error) {
        console.error('Save failed:', error);
        alert(`❌ Save failed: ${error.message}`);
    } finally {
        isSaving = false;
        if (saveBtn) {
            saveBtn.textContent = '💾 Save data.json';
            saveBtn.disabled = false;
        }
    }
}
function normalizeWorkflowData(workflow) {
    if (!workflow) return;

    if (workflow.nodeIdCounter !== undefined) {
        let counter = workflow.nodeIdCounter;
        if (Array.isArray(counter)) counter = counter[0] || 0;
        if (typeof counter !== 'number') counter = parseInt(counter) || 0;
        workflow.nodeIdCounter = counter;
    }

    if (Array.isArray(workflow.nodes)) {
        workflow.nodes = workflow.nodes.filter(n => n && typeof n === 'object');

        for (let node of workflow.nodes) {
            if (node.id !== undefined) {
                if (Array.isArray(node.id)) node.id = node.id[0] || 'node-' + Date.now();
                if (typeof node.id !== 'string') node.id = String(node.id);
            }
            if (node.processId !== undefined && Array.isArray(node.processId)) {
                node.processId = node.processId[0] || '';
            }
            if (node.x !== undefined && Array.isArray(node.x)) node.x = node.x[0] || 100;
            if (node.y !== undefined && Array.isArray(node.y)) node.y = node.y[0] || 100;
            if (node.hidden !== undefined && Array.isArray(node.hidden)) node.hidden = node.hidden[0] || false;
            if (node.label !== undefined) {
                if (Array.isArray(node.label)) node.label = node.label[0] || 'Unnamed';
                if (typeof node.label !== 'string' || node.label.trim() === '') {
                    node.label = 'Unnamed';
                }
            } else {
                node.label = 'Unnamed';
            }
            if (node.type !== undefined && Array.isArray(node.type)) node.type = node.type[0] || '';
        }

        const seen = new Map();
        const specialNodes = [];

        for (let node of workflow.nodes) {
            if (!node.processId) {
                if (node.type && ['start', 'end', 'decision', 'parallel'].includes(node.type)) {
                    specialNodes.push(node);
                } else {
                    if (node.label !== 'Unnamed') {
                        specialNodes.push(node);
                    }
                }
                continue;
            }

            const key = node.processId;
            if (!seen.has(key)) {
                seen.set(key, node);
            } else {
                const existing = seen.get(key);
                if (existing.label === 'Unnamed' && node.label !== 'Unnamed') {
                    seen.set(key, node);
                }
            }
        }

        const dedupedNodes = [...specialNodes, ...Array.from(seen.values())];

        workflow.nodes = dedupedNodes.filter(n => {
            if (n.label === 'Unnamed' && !n.type) return false;
            return true;
        });
    }

    if (Array.isArray(workflow.connections)) {
        workflow.connections = workflow.connections.filter(c => c && typeof c === 'object');
        const validNodeIds = new Set(workflow.nodes.map(n => n.id));
        for (let conn of workflow.connections) {
            if (conn.from !== undefined && Array.isArray(conn.from)) conn.from = conn.from[0] || '';
            if (conn.to !== undefined && Array.isArray(conn.to)) conn.to = conn.to[0] || '';
            if (typeof conn.from !== 'string') conn.from = String(conn.from);
            if (typeof conn.to !== 'string') conn.to = String(conn.to);
            if (!conn.id) {
                conn.id = 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
            }
        }
        workflow.connections = workflow.connections.filter(c =>
            validNodeIds.has(c.from) && validNodeIds.has(c.to)
        );
    }
}

// ============================
// 8. Load Data
// ============================
async function loadData() {
    console.log('📊 loadData() called');
    const loading = document.getElementById('app-loading');
    const root = document.getElementById('app-root');

    if (loading) loading.style.display = 'flex';
    if (root) root.style.display = 'none';

    // --------------------------------------------------------------
    // Source 1: previously-picked data stored in localStorage
    // --------------------------------------------------------------
    let stored = null;
    try {
        stored = localStorage.getItem('bpo_data');
    } catch (e) {
        console.warn('localStorage read failed:', e);
    }

    if (stored) {
        let parsed = null;
        let ok = false;
        try {
            parsed = JSON.parse(stored);
            ok = isDataShapeValid(parsed);
        } catch (e) {
            console.warn('Stored bpo_data is not valid JSON:', e);
            ok = false;
        }
        if (ok) {
            applyLoadedData(parsed, loading, root);
            return;
        }
        console.warn('Stored bpo_data failed validation — requesting file pick.');
        showDataFilePicker(
            'Invalid loaded data. Please choose the correct data file. ' +
            'In case of questions, please reach out to the Key User of the tool.'
        );
        return;
    }

    // --------------------------------------------------------------
    // Source 2: first visit — request file
    // --------------------------------------------------------------
    showDataFilePicker(null);
}

/**
 * Minimal shape check for data.json.
 * Only enforces: scenarios is an array of objects, each with a processes array.
 * Everything else is repaired by normalizeData().
 */
function isDataShapeValid(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    if (!Array.isArray(data.scenarios)) return false;
    for (const sc of data.scenarios) {
        if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return false;
        if (!Array.isArray(sc.processes)) return false;
    }
    return true;
}

/**
 * Finalize a successful load: normalize, snapshot, render.
 * Mirrors the previous success branch of loadData() exactly.
 */
function applyLoadedData(rawData, loading, root) {
    console.log('📊 Raw data parsed, scenarios:', rawData.scenarios?.length || 0);

    appData = normalizeData(rawData);

    // Keep snapshot machinery coherent (dead code stays coherent per Q6).
    localStorage.removeItem('bpo_snapshot');
    lastSnapshot = JSON.parse(JSON.stringify(appData));
    saveSnapshot(lastSnapshot);
    console.log('📸 Baseline snapshot set to loaded data (scenarios: ' + lastSnapshot.scenarios?.length + ')');

    if (lastSnapshot && lastSnapshot.scenarios) {
        lastSnapshot.scenarios.forEach(sc => {
            if (sc.workflow && sc.workflow.nodes) sortWorkflowNodes(sc.workflow);
        });
    }

    if (loading) loading.style.display = 'none';
    if (root) root.style.display = 'block';
    renderApp();
    console.log('✅ Data loaded and rendered successfully');
}
// ============================
// File Picker & Reader
// ============================

function showDataFilePicker(options) {
    // Backward compatible: allow a plain string (boot error path) or an options object.
    let opts = options;
    if (typeof options === 'string' || options === null || options === undefined) {
        opts = { errorMessage: options || null, mode: 'boot' };
    }
    const mode = opts.mode === 'reselect' ? 'reselect' : 'boot';
    const errorMessage = opts.errorMessage || null;

    // Boot mode hides the app; re-select mode keeps it visible behind the modal.
    if (mode === 'boot') {
        const loading = document.getElementById('app-loading');
        const root = document.getElementById('app-root');
        if (loading) loading.style.display = 'none';
        if (root) root.style.display = 'none';
    }

    const prior = document.getElementById('dataFilePickerOverlay');
    if (prior) prior.remove();

    const subtitle = mode === 'reselect'
        ? 'This will replace the currently loaded data in this browser. Choose a <strong>data.json</strong> file.'
        : 'Choose the shared <strong>data.json</strong> file to load the process data.';

    const overlay = document.createElement('div');
    overlay.id = 'dataFilePickerOverlay';
    overlay.className = 'custom-modal-overlay active';
    overlay.innerHTML = `
        <div class="custom-modal">
            <h3>📂 ${mode === 'reselect' ? 'Re-select data.json' : 'Select data.json'}</h3>
            <p style="margin:0.75rem 0;color:#475569;">${subtitle}</p>
            ${errorMessage ? `<p style="margin:0.75rem 0;color:#dc2626;font-weight:600;">${escapeHtml(errorMessage)}</p>` : ''}
            <div class="modal-buttons">
                ${mode === 'reselect' ? '<button id="dataFileCancelBtn" class="cancel-btn">Cancel</button>' : ''}
                <button id="dataFileSelectBtn" class="save-btn">Select file</button>
            </div>
            <input type="file" id="dataFileInput" accept=".json,application/json" style="display:none;">
        </div>
    `;
    document.body.appendChild(overlay);

    const selectBtn = document.getElementById('dataFileSelectBtn');
    const fileInput = document.getElementById('dataFileInput');

    selectBtn.onclick = () => fileInput.click();

    if (mode === 'reselect') {
        const cancelBtn = document.getElementById('dataFileCancelBtn');
        if (cancelBtn) {
            cancelBtn.onclick = () => {
                overlay.remove();
                // Nothing was touched — previous appData and localStorage remain intact.
            };
        }
    }

    fileInput.onchange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        readDataFile(
            file,
            () => {
                overlay.remove();
                if (mode === 'reselect') {
                    refreshScenarioDropdown();
                    rebuildFilterUI();
                    updateUIVisibility();
                    renderCurrentView();
                }
            },
            (msg) => {
                // Re-open picker with error, preserving mode and previous data.
                showDataFilePicker({ errorMessage: msg, mode: mode });
            }
        );
    };
}

function readDataFile(file, onSuccess, onError) {
    const FAIL_MSG =
        'Invalid loaded data. Please choose the correct data file. ' +
        'In case of questions, please reach out to the Key User of the tool.';

    const reader = new FileReader();

    reader.onerror = () => {
        console.error('FileReader error:', reader.error);
        onError(FAIL_MSG);
    };

    reader.onload = (ev) => {
        const text = ev.target.result;

        let rawData = null;
        try {
            rawData = JSON.parse(text);
        } catch (e) {
            console.error('File is not valid JSON:', e);
            onError(FAIL_MSG);
            return;
        }

        if (!isDataShapeValid(rawData)) {
            console.error('File shape check failed:', rawData && Object.keys(rawData));
            onError(FAIL_MSG);
            return;
        }

        // Persist first so next visit auto-loads, but a quota failure
        // must not block the current session.
        try {
            localStorage.setItem('bpo_data', text);
        } catch (e) {
            console.warn('localStorage.setItem(bpo_data) failed:', e);
            if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
                alert(
                    'Browser storage is full — data was saved to disk but will not ' +
                    'auto-load next time. Please pick the file again on next visit.'
                );
            } else {
                alert(
                    'Browser storage unavailable — data was loaded for this session only. ' +
                    'You may need to pick the file again on next visit.'
                );
            }
        }

        const loading = document.getElementById('app-loading');
        const root = document.getElementById('app-root');
        applyLoadedData(rawData, loading, root);

        if (typeof onSuccess === 'function') onSuccess();
    };

    reader.readAsText(file);
}
// ============================
// 9. Default Data
// ============================

function getDefaultData() {
    return {
        departments: ['Sales', 'Production Planning', 'Material Planning', 'Material Handling', 'Purchase', 'Production Execution', 'Parts Quality', 'Vehicle Quality', 'Finance', 'Trade & Compliance'],
        sysNameList: ['SAP', 'LES', 'MES', 'KAPTURE', 'WMS', 'To Be Determined'],
        sysStatusList: [
            { value: 'Operational', color: 'green' },
            { value: 'Completed', color: 'green' },
            { value: 'Offline', color: 'red' },
            { value: 'To Be Implemented', color: 'red' },
            { value: 'Work in Progress', color: 'yellow' }
        ],
        sysRespList: [],
        businessStatuses: [
            { value: 'Not Defined', color: 'red' },
            { value: 'In Progress', color: 'yellow' },
            { value: 'Completed', color: 'green' }
        ],
        scenarios: [
            {
                id: 'default',
                name: 'Manufacturing',
                processes: [
                    {
                        id: genId(),
                        seq: '10',
                        name: 'Sample Process',
                        description: 'This is a sample process. Please import your data.',
                        raci: { r: ['Sales'], a: [], c: [], i: [] },
                        businessStatus: 'Not Defined',
                        system: { name: 'To Be Determined', status: 'Offline', responsible: '' },
                        businessDoc: '',
                        userManual: '',
                        notes: ''
                    }
                ]
            }
        ],
        currentScenarioId: 'default'
    };
}

// ============================
// 10. Get Current Scenario
// ============================

function getCurrentScenario() {
    if (!appData) return null;
    return appData.scenarios.find(s => s.id === appData.currentScenarioId);
}

function getScenarioById(id) {
    if (!appData) return null;
    return appData.scenarios.find(s => s.id === id);
}
function toggleNodeType(nodeId, type) {
    const workflow = getWorkflowData();
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) {
        alert('No node selected');
        return;
    }

    // If already this type, remove it and revert to 'main' or 'sub'
    if (node.type === type) {
        // Determine the default type based on process
        const sc = getCurrentScenario();
        const process = sc.processes.find(p => p.id === node.processId);
        if (process && process.seq && process.seq.includes('.')) {
            node.type = 'sub';
        } else {
            node.type = 'main';
        }
    } else {
        node.type = type;
    }

    saveWorkflowData(workflow);
    selectedNodeId = null;
    renderWorkflow();
}
// ============================
// 11. Filter and Search
// ============================

function matchesFilters(proc) {
    if (activeFilters.length > 0) {
        for (let f of activeFilters) {
            if (f.values.length === 0) continue;
            let val = columnPaths[f.column](proc);
            let match = f.values.some(v => val.toLowerCase().includes(v.toLowerCase()));
            if (!match) return false;
        }
        return true;
    } else {
        if (!searchKeyword.trim()) return true;
        let kw = searchKeyword.toLowerCase();
        return columnPaths.seq(proc).toLowerCase().includes(kw) ||
            columnPaths.name(proc).toLowerCase().includes(kw) ||
            columnPaths.description(proc).toLowerCase().includes(kw) ||
            columnPaths.r(proc).toLowerCase().includes(kw) ||
            columnPaths.businessStatus(proc).toLowerCase().includes(kw) ||
            columnPaths.sysName(proc).toLowerCase().includes(kw) ||
            columnPaths.sysStatus(proc).toLowerCase().includes(kw);
    }
}

function getProcessesForDisplay(scenario) {
    let all = scenario.processes;
    if (activeFilters.length > 0) {
        return sortProcesses(all.filter(p => matchesFilters(p)));
    } else {
        let matching = all.filter(p => matchesFilters(p));
        if (!searchKeyword.trim()) return sortProcesses(all);
        let ancestorIds = new Set();
        for (let p of matching) {
            ancestorIds.add(p.id);
            let parts = p.seq.split('.');
            for (let i = 1; i < parts.length; i++) {
                let parentSeq = parts.slice(0, i).join('.');
                let parent = all.find(pp => pp.seq === parentSeq);
                if (parent) ancestorIds.add(parent.id);
            }
        }
        return sortProcesses(all.filter(p => ancestorIds.has(p.id)));
    }
}

function buildTree(processes) {
    let nodeMap = new Map();
    for (let p of processes) nodeMap.set(p.seq, { process: p, children: [] });
    for (let p of processes) {
        if (p.seq.includes('.')) {
            let parentSeq = p.seq.substring(0, p.seq.lastIndexOf('.'));
            if (nodeMap.has(parentSeq)) nodeMap.get(parentSeq).children.push(p);
        }
    }
    let roots = Array.from(nodeMap.values()).filter(n => !n.process.seq.includes('.'));
    roots.sort((a, b) => compareSeq(a.process.seq, b.process.seq));
    for (let root of roots) {
        root.children.sort((a, b) => compareSeq(a.seq, b.seq));
    }
    return { nodeMap, roots };
}

function getParentProcess(proc, scenario) {
    if (!proc.seq.includes('.')) return null;
    let parentSeq = proc.seq.substring(0, proc.seq.lastIndexOf('.'));
    return scenario.processes.find(p => p.seq === parentSeq);
}

function toggleCollapse(id) {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    collapseState.set(id, !(collapseState.get(id) || false));
    renderCurrentView();
}

function collapseAllParents() {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    const sc = getCurrentScenario();
    if (sc) {
        for (let p of sc.processes) {
            if (!p.seq.includes('.')) collapseState.set(p.id, true);
        }
    }
    renderCurrentView();
}

function expandAllParents() {
    if (activeFilters.length > 0 || searchKeyword || currentMode === 'edit') return;
    const sc = getCurrentScenario();
    if (sc) {
        for (let p of sc.processes) {
            if (!p.seq.includes('.')) collapseState.set(p.id, false);
        }
    }
    renderCurrentView();
}

// ============================
// 12. Render: Table View
// ============================

function renderTable() {
    let tbody = document.getElementById('tableBody');
    let noResult = document.getElementById('noResultMsg');
    let scenario = getCurrentScenario();
    if (!scenario) {
        if (tbody) tbody.innerHTML = '<tr><td colspan="8">No scenario</td></tr>';
        if (noResult) noResult.style.display = 'none';
        return;
    }
    let processes = getProcessesForDisplay(scenario);
    if (processes.length === 0) {
        if (tbody) tbody.innerHTML = '';
        if (noResult) noResult.style.display = 'block';
        return;
    }
    if (noResult) noResult.style.display = 'none';

    let isEdit = (currentMode === 'edit');
    let actionsHeader = document.getElementById('actionsHeader');
    if (actionsHeader) actionsHeader.style.display = isEdit ? 'table-cell' : 'none';

    if (!tbody) return;
    tbody.innerHTML = '';

    for (let proc of processes) {
        let row = tbody.insertRow();

        let tdCollapse = row.insertCell();
        let isParent = !proc.seq.includes('.');
        let hasChildren = isParent && scenario.processes.some(p => p.seq.startsWith(proc.seq + '.'));
        if (isParent && hasChildren && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
            let collapsed = collapseState.get(proc.id) || false;
            let btn = document.createElement('button');
            btn.textContent = collapsed ? '▶' : '▼';
            btn.className = 'collapse-row-btn';
            btn.onclick = (e) => { e.stopPropagation(); toggleCollapse(proc.id); };
            tdCollapse.appendChild(btn);
        }

        let tdSeq = row.insertCell();
        if (isEdit) {
            let inp = document.createElement('input');
            inp.type = 'text';
            inp.value = proc.seq;
            inp.className = 'seq-input';
            inp.addEventListener('change', (e) => {
                let ns = e.target.value.trim();
                if (ns && isSeqUnique(scenario, ns, proc.id)) {
                    proc.seq = ns;
                    renderCurrentView();
                } else if (ns) alert('Sequence exists');
            });
            tdSeq.appendChild(inp);
        } else {
            tdSeq.innerText = proc.seq;
        }

        let tdName = row.insertCell();
        let span = document.createElement('span');
        span.className = 'clickable-name';
        span.innerText = proc.name;
        span.onclick = () => openProcessDetail(proc.id);
        tdName.appendChild(span);

        let tdR = row.insertCell();
        tdR.innerHTML = proc.raci.r.map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('');

        let tdStatus = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'status-select';
            appData.businessStatuses.forEach(s => {
                let op = document.createElement('option');
                op.value = s.value;
                op.textContent = s.value;
                if (s.value === proc.businessStatus) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.businessStatus = sel.value; renderCurrentView(); };
            tdStatus.appendChild(sel);
        } else {
            let color = appData.businessStatuses.find(s => s.value === proc.businessStatus)?.color || 'default';
            tdStatus.innerHTML = `<span class="status-badge ${color}">🏢 ${escapeHtml(proc.businessStatus)}</span>`;
        }

        let tdSysName = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'sysname-select';
            appData.sysNameList.forEach(opt => {
                let op = document.createElement('option');
                op.value = opt;
                op.textContent = opt;
                if (opt === proc.system.name) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.system.name = sel.value; renderCurrentView(); };
            tdSysName.appendChild(sel);
        } else {
            tdSysName.innerText = proc.system.name;
        }

        let tdSysStat = row.insertCell();
        if (isEdit) {
            let sel = document.createElement('select');
            sel.className = 'sysstatus-select';
            appData.sysStatusList.forEach(opt => {
                let op = document.createElement('option');
                op.value = opt.value;
                op.textContent = opt.value;
                if (opt.value === proc.system.status) op.selected = true;
                sel.appendChild(op);
            });
            sel.onchange = () => { proc.system.status = sel.value; renderCurrentView(); };
            tdSysStat.appendChild(sel);
        } else {
            let color = appData.sysStatusList.find(s => s.value === proc.system.status)?.color || 'default';
            tdSysStat.innerHTML = `<span class="sys-status-badge ${color}">${escapeHtml(proc.system.status)}</span>`;
        }

        let tdAction = row.insertCell();
        if (isEdit) {
            let delBtn = document.createElement('button');
            delBtn.textContent = '✖';
            delBtn.className = 'delete-row-btn';
            delBtn.onclick = () => confirmDelete(proc, scenario);
            let subBtn = document.createElement('button');
            subBtn.textContent = '+ Sub';
            subBtn.className = 'add-sub-btn';
            subBtn.onclick = () => autoIncrementSubprocess(proc);
            tdAction.appendChild(delBtn);
            tdAction.appendChild(subBtn);
        }
    }

    if (activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
        for (let proc of processes) {
            if (proc.seq.includes('.')) {
                let parent = getParentProcess(proc, scenario);
                if (parent && collapseState.get(parent.id) === true) {
                    let rows = tbody.querySelectorAll('tr');
                    for (let row of rows) {
                        if (row.cells[1] && row.cells[1].innerText === proc.seq) {
                            row.style.display = 'none';
                        }
                    }
                }
            }
        }
    }
}

// ============================
// 13. Render: Tree View
// ============================

function renderSequence() {
    let container = document.getElementById('sequenceFullView');
    let scenario = getCurrentScenario();
    if (!scenario) {
        if (container) container.innerHTML = '<div>No scenario</div>';
        return;
    }
    let processes = getProcessesForDisplay(scenario);
    if (processes.length === 0) {
        if (container) container.innerHTML = '<div>🔍 No matches</div>';
        return;
    }
    let { nodeMap, roots } = buildTree(processes);

    function renderTree(node, level) {
        let wrapper = document.createElement('div');
        wrapper.className = 'process-tree-root';
        let card = document.createElement('div');
        card.className = level === 0 ? 'main-card' : 'sub-card';
        let proc = node.process;
        let businessColor = appData.businessStatuses.find(s => s.value === proc.businessStatus)?.color || 'default';
        let sysColor = appData.sysStatusList.find(s => s.value === proc.system.status)?.color || 'default';
        let hasChildren = node.children.length > 0;
        let collapseBtn = '';
        if (level === 0 && hasChildren && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit') {
            let isCollapsed = collapseState.get(proc.id) || false;
            collapseBtn = `<button class="collapse-icon" onclick="event.stopPropagation();toggleCollapse('${proc.id}')">${isCollapsed ? '▶' : '▼'}</button>`;
        }
        let addSubIcon = (currentMode === 'edit') ? `<div class="add-sub-icon" data-parent-id="${proc.id}" data-parent-seq="${proc.seq}">+</div>` : '';
        let docIcon = (proc.businessDoc && proc.businessDoc.trim()) ? '<span class="doc-icon">📄</span>' : '';
        let manualIcon = (proc.userManual && proc.userManual.trim()) ? '<span class="manual-icon">📘</span>' : '';

        card.innerHTML = `${addSubIcon}
            <div class="card-top-row"><span class="seq-badge">${level === 0 ? 'Step ' : ''}${escapeHtml(proc.seq)}</span><span class="status-badge ${businessColor}">🏢 ${escapeHtml(proc.businessStatus)}</span></div>
            <div class="card-content"><div class="seq-name">${collapseBtn}<span>${escapeHtml(proc.name)} ${docIcon}</span></div>
            <div class="seq-meta">👤 ${proc.raci.r.map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('')}</div>
            <div class="seq-meta">🖥️ ${escapeHtml(proc.system.name)} ${manualIcon} <span class="sys-status-badge ${sysColor}">${escapeHtml(proc.system.status)}</span></div></div>`;

        card.onclick = (e) => {
            if (!e.target.classList.contains('add-sub-icon') && !e.target.classList.contains('collapse-icon')) {
                openProcessDetail(proc.id);
            }
        };

        let collapseIcon = card.querySelector('.collapse-icon');
        if (collapseIcon) {
            collapseIcon.onclick = (e) => { e.stopPropagation(); toggleCollapse(proc.id); };
        }

        wrapper.appendChild(card);

        let isCollapsedParent = (level === 0 && collapseState.get(proc.id) === true);
        if (node.children.length > 0 && !(isCollapsedParent && activeFilters.length === 0 && !searchKeyword && currentMode !== 'edit')) {
            let childrenDiv = document.createElement('div');
            childrenDiv.className = 'process-tree-children';
            for (let child of node.children) {
                let childNode = nodeMap.get(child.seq);
                if (childNode) childrenDiv.appendChild(renderTree(childNode, level + 1));
            }
            wrapper.appendChild(childrenDiv);
        }
        return wrapper;
    }

    if (container) {
        container.innerHTML = '';
        for (let root of roots) {
            container.appendChild(renderTree(root, 0));
        }
    }

    if (currentMode === 'edit') {
        document.querySelectorAll('.add-sub-icon').forEach(icon => {
            icon.onclick = (e) => {
                e.stopPropagation();
                let parentId = icon.getAttribute('data-parent-id');
                let parentProc = scenario.processes.find(p => p.id === parentId);
                if (!parentProc) return;
                document.getElementById('newSubSeq').value = '';
                document.getElementById('newSubName').value = '';
                document.getElementById('addSubModal').classList.add('active');
                pendingAddSubCallback = (seq, name) => {
                    if (seq && seq.trim()) {
                        addSubprocessWithInsertion(parentProc, seq.trim(), name.trim() || 'New Sub');
                    } else {
                        autoIncrementSubprocess(parentProc);
                    }
                    document.getElementById('addSubModal').classList.remove('active');
                    pendingAddSubCallback = null;
                };
            };
        });
    }
}

// ============================
// 14. Subprocess Operations
// ============================

function addSubprocessWithInsertion(parent, seq, name) {
    let sc = getCurrentScenario();
    if (!sc) return false;
    if (!seq.startsWith(parent.seq + '.')) {
        alert(`Must start with ${parent.seq}.`);
        return false;
    }
    let existing = sc.processes.find(p => p.seq === seq);
    if (existing) {
        let siblings = sc.processes.filter(p => p.seq.startsWith(parent.seq + '.') && p.seq !== parent.seq);
        let childNum = parseInt(seq.split('.')[1]);
        let toShift = siblings.filter(p => {
            let n = parseInt(p.seq.split('.')[1]);
            return n >= childNum;
        }).sort((a, b) => parseFloat(b.seq.split('.')[1]) - parseFloat(a.seq.split('.')[1]));
        for (let s of toShift) {
            let old = parseInt(s.seq.split('.')[1]);
            s.seq = parent.seq + '.' + (old + 1);
        }
    }
    let newProc = {
        id: genId(),
        seq: seq,
        name: name || 'New Sub',
        description: '',
        raci: { r: [...parent.raci.r], a: [], c: [], i: [] },
        businessStatus: 'Not Started',
        system: { name: parent.system.name, status: parent.system.status, responsible: parent.system.responsible },
        notes: '',
        businessDoc: '',
        userManual: ''
    };
    sc.processes.push(newProc);
    sc.processes = sortProcesses(sc.processes);
    renderCurrentView();
    return true;
}

function autoIncrementSubprocess(parent) {
    let sc = getCurrentScenario();
    let children = sc.processes.filter(p => p.seq.startsWith(parent.seq + '.'));
    let max = 0;
    children.forEach(c => {
        let parts = c.seq.split('.');
        if (parts.length === 2 && parts[0] === parent.seq) {
            max = Math.max(max, parseInt(parts[1]));
        }
    });
    let newSeq = parent.seq + '.' + (max + 1);
    let newProc = {
        id: genId(),
        seq: newSeq,
        name: parent.name + ' (sub)',
        description: '',
        raci: { r: [...parent.raci.r], a: [], c: [], i: [] },
        businessStatus: 'Not Started',
        system: { name: parent.system.name, status: parent.system.status, responsible: parent.system.responsible },
        notes: '',
        businessDoc: '',
        userManual: ''
    };
    sc.processes.push(newProc);
    sc.processes = sortProcesses(sc.processes);
    renderCurrentView();
}

function confirmDelete(proc, scenario) {
    let sub = scenario.processes.filter(p => p.seq.startsWith(proc.seq + '.') && p.id !== proc.id);
    document.getElementById('deleteModalMessage').innerText = `Delete "${proc.name}" (${proc.seq})?` + (sub.length ? `\nAlso ${sub.length} subprocess(es).` : '');
    document.getElementById('deleteConfirmModal').classList.add('active');

    pendingDeleteCallback = () => {
        scenario.processes = scenario.processes.filter(p => p.id !== proc.id && !sub.map(s => s.id).includes(p.id));
        scenario.processes = sortProcesses(scenario.processes);
        if (!proc.seq.includes('.')) collapseState.delete(proc.id);
        renderCurrentView();
        document.getElementById('deleteConfirmModal').classList.remove('active');
        pendingDeleteCallback = null;
    };
}

// ============================
// 15. RACI Rendering
// ============================

function renderRaciCheckboxes(proc) {
    let container = document.getElementById('raciCheckboxGrid');
    if (!container) return;
    let raciTypes = [
        { key: 'r', label: 'Responsible (R)' },
        { key: 'a', label: 'Accountable (A)' },
        { key: 'c', label: 'Consulted (C)' },
        { key: 'i', label: 'Informed (I)' }
    ];
    container.innerHTML = '';
    let isEdit = (currentMode === 'edit');

    for (let rt of raciTypes) {
        let section = document.createElement('div');
        section.className = 'raci-section';
        section.innerHTML = `<h4>${rt.label}</h4>`;
        let displayDiv = document.createElement('div');
        displayDiv.className = 'raci-display-section';
        displayDiv.id = `raci-display-${rt.key}`;
        let checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'checkbox-group';
        checkboxDiv.id = `raci-checkbox-${rt.key}`;
        section.appendChild(displayDiv);
        section.appendChild(checkboxDiv);
        container.appendChild(section);

        for (let dept of appData.departments) {
            let chk = document.createElement('input');
            chk.type = 'checkbox';
            chk.value = dept;
            chk.checked = proc.raci[rt.key].includes(dept);
            let label = document.createElement('label');
            label.textContent = dept;
            let item = document.createElement('div');
            item.className = 'checkbox-item';
            item.appendChild(chk);
            item.appendChild(label);
            checkboxDiv.appendChild(item);
            if (isEdit) {
                chk.onchange = () => {
                    if (chk.checked) {
                        if (!proc.raci[rt.key].includes(dept)) proc.raci[rt.key].push(dept);
                    } else {
                        proc.raci[rt.key] = proc.raci[rt.key].filter(d => d !== dept);
                    }
                    updateRaciDisplay(proc);
                };
            }
        }
        if (isEdit) {
            displayDiv.style.display = 'none';
            checkboxDiv.style.display = 'block';
        } else {
            displayDiv.style.display = 'block';
            checkboxDiv.style.display = 'none';
        }
    }
    updateRaciDisplay(proc);
}

function updateRaciDisplay(proc) {
    for (let key of ['r', 'a', 'c', 'i']) {
        let div = document.getElementById(`raci-display-${key}`);
        if (div) {
            div.innerHTML = proc.raci[key].length ?
                proc.raci[key].map(d => `<span class="raci-tag">${escapeHtml(d)}</span>`).join('') :
                '<div style="color:#94a3b8;">No selections</div>';
        }
    }
}

function updateDocumentLinkIcon(inputId, linkIconId) {
    let input = document.getElementById(inputId);
    let icon = document.getElementById(linkIconId);
    if (!input || !icon) return;
    let url = input.value.trim();
    if (url) {
        icon.style.display = 'inline-block';
        icon.onclick = (e) => { e.stopPropagation(); window.open(url, '_blank'); };
    } else {
        icon.style.display = 'none';
        icon.onclick = null;
    }
}

// ============================
// 16. Process Detail Modal
// ============================

function openProcessDetail(procId) {
    let scenario = getCurrentScenario();
    let proc = scenario.processes.find(p => p.id === procId);
    if (!proc) return;
    currentEditingProcess = { scenarioId: scenario.id, processId: proc.id };

    document.getElementById('modalSeq').value = proc.seq;
    document.getElementById('modalName').value = proc.name;
    document.getElementById('modalDescription').value = proc.description || '';
    renderRaciCheckboxes(proc);

    let statusSel = document.getElementById('modalStatus');
    statusSel.innerHTML = '';
    appData.businessStatuses.forEach(s => {
        let op = document.createElement('option');
        op.value = s.value;
        op.textContent = s.value;
        if (s.value === proc.businessStatus) op.selected = true;
        statusSel.appendChild(op);
    });

    let sysNameSel = document.getElementById('modalSysName');
    sysNameSel.innerHTML = '';
    appData.sysNameList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        if (opt === proc.system.name) op.selected = true;
        sysNameSel.appendChild(op);
    });

    let sysStatSel = document.getElementById('modalSysStatus');
    sysStatSel.innerHTML = '';
    appData.sysStatusList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt.value;
        op.textContent = opt.value;
        if (opt.value === proc.system.status) op.selected = true;
        sysStatSel.appendChild(op);
    });

    let sysRespSel = document.getElementById('modalSysResp');
    sysRespSel.innerHTML = '';
    appData.sysRespList.forEach(opt => {
        let op = document.createElement('option');
        op.value = opt;
        op.textContent = opt;
        if (opt === proc.system.responsible) op.selected = true;
        sysRespSel.appendChild(op);
    });

    document.getElementById('modalBusinessDoc').value = proc.businessDoc || '';
    document.getElementById('modalUserManual').value = proc.userManual || '';
    document.getElementById('modalNotes').value = proc.notes || '';

    updateDocumentLinkIcon('modalBusinessDoc', 'businessDocLink');
    updateDocumentLinkIcon('modalUserManual', 'userManualLink');

    let isEdit = (currentMode === 'edit');
    ['modalSeq', 'modalName', 'modalDescription', 'modalStatus', 'modalSysName', 'modalSysStatus', 'modalSysResp', 'modalBusinessDoc', 'modalUserManual', 'modalNotes'].forEach(id => {
        let el = document.getElementById(id);
        if (el) el.disabled = !isEdit;
    });

    document.getElementById('processDetailModal').classList.add('active');
}

function closeModal() {
    document.getElementById('processDetailModal').classList.remove('active');
    currentEditingProcess = null;
}

function saveModal() {
    if (currentMode !== 'edit' || !currentEditingProcess) return;
    let scenario = getScenarioById(currentEditingProcess.scenarioId);
    let proc = scenario.processes.find(p => p.id === currentEditingProcess.processId);
    if (!proc) return;

    let newSeq = document.getElementById('modalSeq').value.trim();
    if (newSeq !== proc.seq && !isSeqUnique(scenario, newSeq, proc.id)) {
        alert('Sequence exists');
        return;
    }
    proc.seq = newSeq || '0';
    proc.name = document.getElementById('modalName').value;
    proc.description = document.getElementById('modalDescription').value;
    proc.businessStatus = document.getElementById('modalStatus').value;
    proc.system = {
        name: document.getElementById('modalSysName').value,
        status: document.getElementById('modalSysStatus').value,
        responsible: document.getElementById('modalSysResp').value
    };
    proc.businessDoc = document.getElementById('modalBusinessDoc').value;
    proc.userManual = document.getElementById('modalUserManual').value;
    proc.notes = document.getElementById('modalNotes').value;

    scenario.processes = sortProcesses(scenario.processes);
    renderCurrentView();
    closeModal();
}

// ============================
// 17. Master Data UI
// ============================

function refreshMasterUI() {
    let isEdit = (currentMode === 'edit');
    let html = `
        <div class="master-section"><h3>🏢 Departments / Roles</h3><div>${appData.departments.map((d, i) => `<div class="list-tag">${escapeHtml(d)} ${isEdit ? `<button data-type="dept" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newDept" placeholder="New department"><button id="addDeptBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>🖥️ System Name</h3><div>${appData.sysNameList.map((v, i) => `<div class="list-tag">${escapeHtml(v)} ${isEdit ? `<button data-type="sysname" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysName" placeholder="New system"><button id="addSysNameBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>📊 System Status</h3><div>${appData.sysStatusList.map((item, idx) => `<div class="list-tag">${escapeHtml(item.value)} ${isEdit ? `<select class="sysstatus-color" data-idx="${idx}"><option value="default">default</option><option value="red">red</option><option value="yellow">yellow</option><option value="green" ${item.color === 'green' ? 'selected' : ''}>green</option></select> <button data-type="sysstatus" data-idx="${idx}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysStatus" placeholder="New status"><button id="addSysStatusBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>👤 System Responsible</h3><div>${appData.sysRespList.map((v, i) => `<div class="list-tag">${escapeHtml(v)} ${isEdit ? `<button data-type="sysresp" data-idx="${i}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newSysResp" placeholder="New responsible"><button id="addSysRespBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>
        <div class="master-section"><h3>📌 Business Status</h3><div>${appData.businessStatuses.map((item, idx) => `<div class="list-tag">${escapeHtml(item.value)} ${isEdit ? `<select class="busstatus-color" data-idx="${idx}"><option value="default">default</option><option value="red">red</option><option value="yellow">yellow</option><option value="green" ${item.color === 'green' ? 'selected' : ''}>green</option></select> <button data-type="busstatus" data-idx="${idx}" class="master-del">✖</button>` : ''}</div>`).join('')}</div>${isEdit ? `<div class="add-item"><input type="text" id="newBusinessStatus" placeholder="New status"><button id="addBusinessStatusBtn" class="icon-btn-small">+ Add</button></div>` : ''}</div>`;

    if (isEdit) {
        html += `<div class="modal-buttons" style="justify-content: space-between; margin-top:1rem;"><div><button id="exportMasterBtn" class="icon-btn">📤 Export CSV</button><button id="importMasterBtn" class="icon-btn">📥 Import CSV</button></div></div>`;
    }

    document.getElementById('masterContent').innerHTML = html;
    if (!isEdit) return;

    document.querySelectorAll('.master-del').forEach(btn => {
        btn.onclick = () => {
            let type = btn.getAttribute('data-type');
            let idx = parseInt(btn.getAttribute('data-idx'));
            if (type === 'dept') appData.departments.splice(idx, 1);
            else if (type === 'sysname') appData.sysNameList.splice(idx, 1);
            else if (type === 'sysstatus') appData.sysStatusList.splice(idx, 1);
            else if (type === 'sysresp') appData.sysRespList.splice(idx, 1);
            else if (type === 'busstatus') appData.businessStatuses.splice(idx, 1);
            refreshMasterUI();
            renderCurrentView();
        };
    });

    document.querySelectorAll('.sysstatus-color').forEach(sel => {
        sel.onchange = () => {
            let idx = parseInt(sel.getAttribute('data-idx'));
            if (appData.sysStatusList[idx]) {
                appData.sysStatusList[idx].color = sel.value;
                refreshMasterUI();
                renderCurrentView();
            }
        };
    });
    document.querySelectorAll('.busstatus-color').forEach(sel => {
        sel.onchange = () => {
            let idx = parseInt(sel.getAttribute('data-idx'));
            if (appData.businessStatuses[idx]) {
                appData.businessStatuses[idx].color = sel.value;
                refreshMasterUI();
                renderCurrentView();
            }
        };
    });

    document.getElementById('addDeptBtn').onclick = () => {
        let v = document.getElementById('newDept').value.trim();
        if (v) { appData.departments.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysNameBtn').onclick = () => {
        let v = document.getElementById('newSysName').value.trim();
        if (v) { appData.sysNameList.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysStatusBtn').onclick = () => {
        let v = document.getElementById('newSysStatus').value.trim();
        if (v) { appData.sysStatusList.push({ value: v, color: 'default' }); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addSysRespBtn').onclick = () => {
        let v = document.getElementById('newSysResp').value.trim();
        if (v) { appData.sysRespList.push(v); refreshMasterUI(); renderCurrentView(); }
    };
    document.getElementById('addBusinessStatusBtn').onclick = () => {
        let v = document.getElementById('newBusinessStatus').value.trim();
        if (v) { appData.businessStatuses.push({ value: v, color: 'default' }); refreshMasterUI(); renderCurrentView(); }
    };

    document.getElementById('exportMasterBtn').onclick = exportMasterCSV;
    document.getElementById('importMasterBtn').onclick = () => document.getElementById('masterImportFile').click();
}

// ============================
// 18. CSV Import/Export
// ============================

const CSV_SEP = '|';

function csvEscape(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (s.includes(CSV_SEP) || s.includes('"') || s.includes('\n') || s.includes('=')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

async function saveFilePicker(content, name) {
    if (window.showSaveFilePicker) {
        try {
            const h = await window.showSaveFilePicker({
                suggestedName: name,
                types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }]
            });
            const w = await h.createWritable();
            await w.write(content);
            await w.close();
            return;
        } catch (e) {
            if (e.name === 'AbortError') return;
        }
    }
    let a = document.createElement('a');
    let url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function exportMasterCSV() {
    let lines = [];
    appData.departments.forEach(d => lines.push(['dept', d].map(csvEscape).join(CSV_SEP)));
    appData.sysNameList.forEach(v => lines.push(['sysname', v].map(csvEscape).join(CSV_SEP)));
    appData.sysStatusList.forEach(s => lines.push(['sysstatus', s.value, s.color].map(csvEscape).join(CSV_SEP)));
    appData.sysRespList.forEach(v => lines.push(['sysresp', v].map(csvEscape).join(CSV_SEP)));
    appData.businessStatuses.forEach(b => lines.push(['busstatus', b.value, b.color].map(csvEscape).join(CSV_SEP)));
    saveFilePicker(lines.join('\n'), `master_${new Date().toISOString().slice(0, 10)}.csv`);
}

function handleMasterImport(e) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = ev => {
        let lines = ev.target.result.split(/\r?\n/);
        let newDepts = [], newSysNames = [], newSysStatuses = [], newSysResps = [], newBusStatuses = [];
        for (let line of lines) {
            let parts = line.split(CSV_SEP);
            if (parts[0] === 'dept' && parts[1]) newDepts.push(parts[1]);
            else if (parts[0] === 'sysname' && parts[1]) newSysNames.push(parts[1]);
            else if (parts[0] === 'sysstatus' && parts[1] && parts[2]) newSysStatuses.push({ value: parts[1], color: parts[2] });
            else if (parts[0] === 'sysresp' && parts[1]) newSysResps.push(parts[1]);
            else if (parts[0] === 'busstatus' && parts[1] && parts[2]) newBusStatuses.push({ value: parts[1], color: parts[2] });
        }
        if (newDepts.length) appData.departments = newDepts;
        if (newSysNames.length) appData.sysNameList = newSysNames;
        if (newSysStatuses.length) appData.sysStatusList = newSysStatuses;
        if (newSysResps.length) appData.sysRespList = newSysResps;
        if (newBusStatuses.length) appData.businessStatuses = newBusStatuses;
        refreshMasterUI();
        renderCurrentView();
    };
    reader.readAsText(file);
    e.target.value = '';
}

async function exportProcesses() {
    let sc = getCurrentScenario();
    if (!sc) { alert('No scenario selected'); return; }
    let headers = ['Seq', 'Name', 'Description', 'R_Responsible', 'A_Accountable', 'C_Consulted', 'I_Informed', 'BusinessStatus', 'SystemName', 'SystemStatus', 'SystemResponsible', 'BusinessDoc', 'UserManual', 'Notes'];
    let lines = [headers.map(csvEscape).join(CSV_SEP)];
    for (let p of sortProcesses(sc.processes)) {
        const makeHyperlink = (url) => url && url.trim() ? `=HYPERLINK("${url.replace(/"/g, '""')}","${url}")` : '';
        let row = [
            p.seq, p.name, p.description || '',
            p.raci.r.join(';'), p.raci.a.join(';'), p.raci.c.join(';'), p.raci.i.join(';'),
            p.businessStatus, p.system.name || '', p.system.status || '', p.system.responsible || '',
            makeHyperlink(p.businessDoc), makeHyperlink(p.userManual), p.notes || ''
        ];
        lines.push(row.map(csvEscape).join(CSV_SEP));
    }
    saveFilePicker(lines.join('\n'), `${sc.name.replace(/\s+/g, '_')}_processes_${new Date().toISOString().slice(0, 10)}.csv`);
}

function importProcesses() {
    if (currentMode !== 'edit') return;
    document.getElementById('processImportFile').click();
}

function handleProcessImport(e) {
    let file = e.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = ev => {
        let lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return;
        let headers = lines[0].split(CSV_SEP).map(h => h.replace(/^"|"$/g, '').trim());
        let processes = [];
        for (let i = 1; i < lines.length; i++) {
            let parts = lines[i].split(CSV_SEP);
            let obj = {};
            headers.forEach((h, idx) => {
                obj[h] = parts[idx] ? parts[idx].replace(/^"|"$/g, '').trim() : '';
            });
            if (!obj.Seq) continue;
            processes.push({
                id: genId(),
                seq: obj.Seq,
                name: obj.Name || 'Unnamed',
                description: obj.Description || '',
                raci: {
                    r: obj.R_Responsible ? obj.R_Responsible.split(';') : [],
                    a: obj.A_Accountable ? obj.A_Accountable.split(';') : [],
                    c: obj.C_Consulted ? obj.C_Consulted.split(';') : [],
                    i: obj.I_Informed ? obj.I_Informed.split(';') : []
                },
                businessStatus: obj.BusinessStatus || appData.businessStatuses[0]?.value || 'Not Defined',
                system: { name: obj.SystemName || '', status: obj.SystemStatus || '', responsible: obj.SystemResponsible || '' },
                businessDoc: obj.BusinessDoc || '',
                userManual: obj.UserManual || '',
                notes: obj.Notes || ''
            });
        }
        showImportPreview('Processes', `Found ${processes.length} valid processes.`, headers, processes.map(p => [
            p.seq, p.name, p.description,
            p.raci.r.join(';'), p.raci.a.join(';'), p.raci.c.join(';'), p.raci.i.join(';'),
            p.businessStatus, p.system.name, p.system.status, p.system.responsible,
            p.businessDoc, p.userManual, p.notes
        ]), () => {
            let sc = getCurrentScenario();
            if (sc) {
                sc.processes = processes;
                sc.processes = sortProcesses(sc.processes);
                // Sync workflow nodes (remove orphans, add missing)
                const removed = syncWorkflowNodesWithProcesses(sc);
                console.log(`✅ Synced workflow: ${removed} orphan nodes removed`);
                renderCurrentView();
            }
            closeImportPreview();
        });
    };
    reader.readAsText(file);
    e.target.value = '';
}
function showImportPreview(title, summary, headers, rows, cb) {
    let modal = document.getElementById('importPreviewModal');
    document.getElementById('previewSummary').innerText = summary;
    let container = document.getElementById('previewTableContainer');
    container.innerHTML = '';
    if (rows.length) {
        let table = document.createElement('table');
        table.className = 'preview-table';
        let thead = document.createElement('thead');
        let headerRow = document.createElement('tr');
        headers.forEach(h => {
            let th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        let tbody = document.createElement('tbody');
        rows.forEach(row => {
            let tr = document.createElement('tr');
            row.forEach(cell => {
                let td = document.createElement('td');
                td.textContent = cell || '';
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        container.appendChild(table);
    } else {
        container.innerHTML = '<p>No data</p>';
    }
    pendingImportCallback = cb;
    modal.classList.add('active');
}

function closeImportPreview() {
    document.getElementById('importPreviewModal').classList.remove('active');
    pendingImportCallback = null;
}

// ============================
// 19. Filter Functions
// ============================

function openFilterColumnsModal() {
    let container = document.getElementById('filterColumnsList');
    container.innerHTML = '';
    for (let [key, label] of Object.entries(columnNames)) {
        container.innerHTML += `<div class="checkbox-item"><input type="checkbox" value="${key}" id="col_${key}"> <label for="col_${key}">${label}</label></div>`;
    }
    document.getElementById('filterColumnsModal').classList.add('active');
}

function addFiltersFromSelection() {
    let selected = Array.from(document.querySelectorAll('#filterColumnsList input:checked')).map(cb => cb.value);
    if (selected.length === 0) return;
    for (let col of selected) {
        if (!activeFilters.some(f => f.column === col)) {
            activeFilters.push({ column: col, values: [] });
        }
    }
    rebuildFilterUI();
    applyFiltersAndRender();
    document.getElementById('filterColumnsModal').classList.remove('active');
}

function rebuildFilterUI() {
    let container = document.getElementById('filterConditions');
    container.innerHTML = '';
    activeFilters.forEach((f, idx) => {
        let div = document.createElement('div');
        div.className = 'filter-row';
        let span = document.createElement('span');
        span.textContent = columnNames[f.column] || f.column;
        let input = document.createElement('input');
        input.placeholder = 'Values (comma separated)';
        input.value = f.values.join(',');
        input.onchange = () => {
            f.values = input.value.split(',').map(v => v.trim()).filter(v => v);
            applyFiltersAndRender();
        };
        let delBtn = document.createElement('button');
        delBtn.textContent = '✖';
        delBtn.onclick = () => {
            activeFilters.splice(idx, 1);
            rebuildFilterUI();
            applyFiltersAndRender();
        };
        div.appendChild(span);
        div.appendChild(input);
        div.appendChild(delBtn);
        container.appendChild(div);
    });
}

function applyFiltersAndRender() {
    renderCurrentView();
}

function clearFilters() {
    activeFilters = [];
    rebuildFilterUI();
    document.getElementById('searchInput').value = '';
    searchKeyword = '';
    renderCurrentView();
}

// ============================
// 20. Scenario Management
// ============================

function refreshScenarioDropdown() {
    let sel = document.getElementById('scenarioSelect');
    if (!sel) return;
    sel.innerHTML = '';
    appData.scenarios.forEach(sc => {
        let opt = document.createElement('option');
        opt.value = sc.id;
        opt.textContent = sc.name;
        if (sc.id === appData.currentScenarioId) opt.selected = true;
        sel.appendChild(opt);
    });
}

// ============================
// 21. Main Render Function
// ============================

function renderApp() {
    console.log('🎨 renderApp() called');
    const root = document.getElementById('app-root');
    if (!root) {
        console.error('❌ app-root not found');
        return;
    }

    if (!root.innerHTML) {
        root.innerHTML = `
            <div class="glass-dashboard edit-mode" id="appRoot">
                <div class="top-header">
                    <div class="title-section"><h1>📊 Business Process Orchestrator</h1><p>EBRO Factory Repository for all business processes details</p></div>
                    <div>
                        <button id="saveDataBtn" class="save-html-btn" style="display:inline-flex;">💾 Save data.json</button>
                        <button id="reselectDataFileBtn" class="settings-btn" style="display:none;">📂 Re-select data.json</button>
                        <button id="settingsBtn" class="settings-btn" style="display:inline-flex;">⚙️ Master Data</button>
                        <button id="modeToggleBtn" class="mode-toggle-btn">👁️ Display Mode</button>
                    </div>
                </div>
                <div class="scenario-panel">
                    <span class="scenario-label">📁 Business Scenario:</span>
                    <select id="scenarioSelect"></select>
                    <div class="scenario-actions">
                        <button id="newScenarioBtn" class="icon-btn">+ New</button>
                        <button id="renameScenarioBtn" class="icon-btn">✎ Rename</button>
                        <button id="deleteScenarioBtn" class="icon-btn danger-btn">🗑 Delete</button>
                    </div>
                </div>
                <div class="action-bar">
                    <div class="search-wrapper"><span>🔍</span><input type="text" id="searchInput" placeholder="Search..."></div>
                    <div style="display:flex;gap:0.5rem;">
                        <button id="collapseAllBtn" class="collapse-all-btn">📁 Collapse All</button>
                        <button id="expandAllBtn" class="expand-all-btn">📂 Expand All</button>
                        <button class="btn-add" id="addRowBtn" style="display:inline-flex;">➕ Add Process</button>
                        <button class="icon-btn" id="exportProcessesBtn">📤 Export Processes</button>
                        <button class="icon-btn" id="importProcessesBtn" style="display:inline-flex;">📥 Import Processes</button>
                    </div>
                </div>
                <div class="view-tabs">
                    <button id="tableViewTab" class="tab-btn active">📋 Process Table</button>
                    <button id="sequenceViewTab" class="tab-btn">🌳 Process Tree</button>
                    <button id="workflowViewTab" class="tab-btn">🔀 Workflow</button>
                </div>
                <div class="filter-panel">
                    <div class="filter-conditions" id="filterConditions"></div>
                    <div class="filter-actions">
                        <button id="addFilterBtn" class="icon-btn">+ Add Filter</button>
                        <button id="clearFiltersBtn" class="icon-btn">Clear Filters</button>
                    </div>
                </div>
                <div id="tableViewPanel" style="display:none;">
                    <div class="table-container">
                        <table class="flow-table">
                            <thead><tr>
                                <th style="width:40px"></th><th>Seq</th><th>Process Name</th><th>Responsible (R)</th>
                                <th>Business Status</th><th>System Name</th><th>System Status</th>
                                <th id="actionsHeader" style="display:table-cell;">Actions</th>
                            </tr></thead>
                            <tbody id="tableBody"></tbody>
                        </table>
                    </div>
                    <div id="noResultMsg" class="no-result" style="display:none;">📭 No matching processes</div>
                </div>
                <div id="sequenceViewPanel" style="display:block;">
                    <div class="sequence-fullview" id="sequenceFullView">Loading sequence...</div>
                </div>
                <div id="workflowViewPanel" style="display:none;">
                    <div class="workflow-toolbar" id="workflowToolbar">
                        <div class="btn-group">
                            <button class="workflow-btn" id="wfConnectBtn">🔗 Start to Connect</button>
                            <button class="workflow-btn" id="wfClearArrowsBtn">🗑 Clear Arrows</button>
                        </div>
                        <div class="btn-group">
                            <button class="workflow-btn" id="wfAutoLayoutBtn">📐 Auto Layout</button>
                            <button class="workflow-btn danger" id="wfClearAllBtn">🗑 Clear All</button>
                        </div>
                         <div class="btn-group">
                            <button class="workflow-btn" id="wfMarkStartBtn">🏁 Mark as Start</button>
                            <button class="workflow-btn" id="wfMarkEndBtn">🏁 Mark as End</button>
                        </div>
                        <div class="btn-group">
                            <button class="workflow-btn" id="wfSyncNodesBtn">🔄 Sync Nodes</button>
                            <button class="icon-btn" id="cleanupOrphanNodesBtn">🧹 Cleanup Nodes</button>
                            <button class="workflow-btn" id="wfDeleteNodeBtn">🗑 Delete Node</button>
                            <button class="workflow-btn" id="wfToggleHideBtn">👁️ Hide Node</button>
                        </div>                        
                        <div class="btn-group workflow-zoom-controls">
                            <button id="wfZoomIn" title="Zoom In">➕</button>
                            <button id="wfZoomOut" title="Zoom Out">➖</button>
                            <button id="wfResetView" title="Reset View">⟲</button>
                        </div>
                    </div>
                    <div class="workflow-container" id="workflowContainer">
                        <div class="workflow-canvas" id="workflowCanvas">
                        </div>
                    </div>
                </div>
            </div>
            <div id="deleteConfirmModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>⚠️ Confirm Deletion</h3><p id="deleteModalMessage"></p>
                <div class="modal-buttons"><button id="deleteAcceptBtn" class="save-btn">Accept</button><button id="deleteCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="addSubModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>➕ Add Subprocess</h3>
                <div class="field-group"><label>Sequence (empty = auto)</label><input type="text" id="newSubSeq"></div>
                <div class="field-group"><label>Process Name</label><input type="text" id="newSubName"></div>
                <div class="modal-buttons"><button id="addSubAcceptBtn" class="save-btn">Add</button><button id="addSubCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="masterModal" class="master-modal">
                <div class="master-container"><h2>📋 Master Data</h2><div id="masterContent"></div>
                <div class="modal-buttons"><button id="closeMasterBtn" class="cancel-btn">Close</button></div></div>
            </div>
            <div id="processDetailModal" class="modal-overlay">
                <div class="modal-container"><h2>📄 Process Details</h2>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>Sequence</label><input type="text" id="modalSeq"></div>
                    <div class="field-group"><label>Process Name</label><input type="text" id="modalName"></div>
                </div>
                <div class="field-group"><label>📝 Description</label><textarea id="modalDescription" rows="3"></textarea></div>
                <div class="raci-grid" id="raciCheckboxGrid"></div>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>Business Status</label><select id="modalStatus"></select></div>
                    <div class="field-group"><label>📄 Business Doc</label><div class="field-group-with-icon"><input type="text" id="modalBusinessDoc"><span id="businessDocLink" class="link-icon" style="display:inline-block;">🔗</span></div></div>
                </div>
                <div class="form-row" style="display:flex;gap:1rem;">
                    <div class="field-group"><label>System Name</label><select id="modalSysName"></select></div>
                    <div class="field-group"><label>System Status</label><select id="modalSysStatus"></select></div>
                    <div class="field-group"><label>System Responsible</label><select id="modalSysResp"></select></div>
                    <div class="field-group"><label>📘 User Manual</label><div class="field-group-with-icon"><input type="text" id="modalUserManual"><span id="userManualLink" class="link-icon" style="display:none;">🔗</span></div></div>
                </div>
                <div class="field-group"><label>📝 Notes</label><textarea id="modalNotes" rows="2"></textarea></div>
                <div class="modal-buttons"><button id="cancelModalBtn" class="cancel-btn">Cancel</button><button id="saveModalBtn" class="save-btn">Save</button></div></div>
            </div>
            <div id="filterColumnsModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>Select filter columns</h3>
                <div id="filterColumnsList" style="max-height:300px;overflow-y:auto;margin:1rem 0;"></div>
                <div class="modal-buttons"><button id="filterColumnsConfirm" class="save-btn">Add Filters</button><button id="filterColumnsCancel" class="cancel-btn">Cancel</button></div></div>
            </div>
            <div id="importPreviewModal" class="custom-modal-overlay">
                <div class="custom-modal"><h3>📋 Import Preview</h3>
                <div id="previewSummary"></div>
                <div id="previewTableContainer"></div>
                <div class="modal-buttons"><button id="importConfirmBtn" class="save-btn">Confirm</button><button id="importCancelBtn" class="cancel-btn">Cancel</button></div></div>
            </div>
            <input type="file" id="masterImportFile" accept=".csv" style="display:none">
            <input type="file" id="processImportFile" accept=".csv" style="display:none">
        `;
    }

    updateUIVisibility();
    refreshScenarioDropdown();
    rebuildFilterUI();
    bindEvents();
    renderCurrentView();
    console.log('✅ renderApp() completed');
}

// ============================
// 22. Event Binding
// ============================

function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.getElementById('workflowViewTab').onclick = () => setView('workflow');
    document.getElementById('scenarioSelect').onchange = (e) => {
        appData.currentScenarioId = e.target.value;
        collapseState.clear();
        renderCurrentView();
        // ===== IMPORTANT: Update the snapshot =====
        lastSnapshot = JSON.parse(JSON.stringify(appData));
        saveSnapshot(lastSnapshot);
        // =========================================
    };
    document.getElementById('cleanupOrphanNodesBtn').addEventListener('click', function() {
        if (currentMode !== 'edit') return;
        const sc = getCurrentScenario();
        if (!sc) return;
        const removed = syncWorkflowNodesWithProcesses(sc);
        if (removed > 0) {
            renderCurrentView();
            alert(`✅ Removed orphan nodes. ${removed} nodes kept.`);
        } else {
            alert('ℹ️ No orphan nodes found.');
        }
    });
    document.getElementById('newScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let name = prompt('Scenario name:', 'New');
        if (name) {
            let id = genId();
            appData.scenarios.push({ 
                id, 
                name, 
                processes: [], 
                workflow: { nodes: [], connections: [] } 
            });
            appData.currentScenarioId = id;
            // ===== IMPORTANT: Update the snapshot =====
            //lastSnapshot = JSON.parse(JSON.stringify(appData));
            //saveSnapshot(lastSnapshot);
            // =========================================
            refreshScenarioDropdown();
            renderCurrentView();
            alert(`✅ Scenario "${name}" created. Click "Save to GitHub" to persist it.`);
        }
    };

    document.getElementById('renameScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let sc = getCurrentScenario();
        if (sc) {
            let nn = prompt('Rename:', sc.name);
            if (nn) sc.name = nn;
            refreshScenarioDropdown();
            renderCurrentView();
            // ===== IMPORTANT: Update the snapshot =====
            //lastSnapshot = JSON.parse(JSON.stringify(appData));
            //saveSnapshot(lastSnapshot);
            // =========================================
            console.log(`✅ Scenario renamed to "${nn.trim()}". Click "Save to GitHub" to persist.`);
        }
    };

    document.getElementById('deleteScenarioBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        if (appData.scenarios.length <= 1) {
            alert('❌ Cannot delete the last scenario.');
            return;
        }
    
        const sc = getCurrentScenario();
        if (!sc) return;
    
        const confirmMsg = `⚠️ Delete scenario "${sc.name}"?\n\nThis will permanently delete ALL processes within this scenario.`;
        if (!confirm(confirmMsg)) return;
    
        appData.scenarios = appData.scenarios.filter(s => s.id !== appData.currentScenarioId);
        appData.currentScenarioId = appData.scenarios[0].id;
    
        collapseState.clear();
        refreshScenarioDropdown();
        renderCurrentView();
    
        // ===== IMPORTANT: Update the snapshot =====
        //lastSnapshot = JSON.parse(JSON.stringify(appData));
        //saveSnapshot(lastSnapshot);
        // =========================================
    
        const saveBtn = document.getElementById('saveDataBtn');
        if (saveBtn) {
            saveBtn.style.animation = 'pulse 0.5s ease 3';
            setTimeout(() => { saveBtn.style.animation = ''; }, 2000);
        }
        alert('✅ Scenario deleted locally!\n\nClick "Save to GitHub" to persist changes.');
    };

    document.getElementById('addRowBtn').onclick = () => {
        if (currentMode !== 'edit') return;
        let sc = getCurrentScenario();
        if (!sc) return;
        let max = 0;
        sc.processes.forEach(p => {
            if (!p.seq.includes('.')) max = Math.max(max, parseFloat(p.seq));
        });
        let newSeq = (max + 10).toString();
        sc.processes.push({
            id: genId(),
            seq: newSeq,
            name: 'New Step',
            description: '',
            raci: { r: [], a: [], c: [], i: [] },
            businessStatus: appData.businessStatuses[0]?.value || 'Not Defined',
            system: { name: appData.sysNameList[0] || '', status: appData.sysStatusList[0]?.value || 'Operational', responsible: '' },
            notes: '',
            businessDoc: '',
            userManual: ''
        });
        sc.processes = sortProcesses(sc.processes);
        renderCurrentView();
    };

    document.getElementById('modeToggleBtn').onclick = function() {
        if (currentMode === 'display') {
            const pwd = prompt('Enter edit password:');
            if (pwd !== 'admin') {
                alert('Incorrect password');
                return;
            }
            currentMode = 'edit';
            collapseState.clear();
            const token = getGitHubToken();
            if (!token) {
                const newToken = prompt(
                    '🔑 Enter your GitHub Token to enable saving\n\n' +
                    'The Token will be saved in your browser.',
                    ''
                );
                if (newToken && newToken.trim()) {
                    setGitHubToken(newToken);
                    alert('✅ Token saved to browser local storage');
                } else {
                    alert('⚠️ No Token provided. You can still edit data, but saving to GitHub will not work.');
                }
            }
            renderCurrentView();
            updateUIVisibility();
        } else {
            currentMode = 'display';
            const sc = getCurrentScenario();
            if (sc) {
                for (let p of sc.processes) {
                    if (!p.seq.includes('.')) collapseState.set(p.id, true);
                }
            }
            renderCurrentView();
            updateUIVisibility();
        }
    };

    document.getElementById('saveDataBtn').onclick = () => {
        saveDataToFile();
    };

    const reselectBtn = document.getElementById('reselectDataFileBtn');
    if (reselectBtn) {
        reselectBtn.onclick = () => {
            showDataFilePicker({ errorMessage: null, mode: 'reselect' });
        };
    }

    document.getElementById('settingsBtn').onclick = () => {
        refreshMasterUI();
        document.getElementById('masterModal').classList.add('active');
    };
    document.getElementById('closeMasterBtn').onclick = () => document.getElementById('masterModal').classList.remove('active');

    document.getElementById('tableViewTab').onclick = () => setView('table');
    document.getElementById('sequenceViewTab').onclick = () => setView('sequence');

    document.getElementById('searchInput').oninput = (e) => {
        searchKeyword = e.target.value;
        renderCurrentView();
    };

    document.getElementById('collapseAllBtn').onclick = collapseAllParents;
    document.getElementById('expandAllBtn').onclick = expandAllParents;

    document.getElementById('addFilterBtn').onclick = openFilterColumnsModal;
    document.getElementById('clearFiltersBtn').onclick = clearFilters;
    document.getElementById('filterColumnsConfirm').onclick = addFiltersFromSelection;
    document.getElementById('filterColumnsCancel').onclick = () => document.getElementById('filterColumnsModal').classList.remove('active');

    document.getElementById('exportProcessesBtn').onclick = exportProcesses;
    document.getElementById('importProcessesBtn').onclick = importProcesses;

    document.getElementById('cancelModalBtn').onclick = closeModal;
    document.getElementById('saveModalBtn').onclick = saveModal;

    document.getElementById('deleteAcceptBtn').onclick = () => {
        if (pendingDeleteCallback) pendingDeleteCallback();
        document.getElementById('deleteConfirmModal').classList.remove('active');
    };
    document.getElementById('deleteCancelBtn').onclick = () => document.getElementById('deleteConfirmModal').classList.remove('active');

    document.getElementById('addSubAcceptBtn').onclick = () => {
        if (pendingAddSubCallback) {
            pendingAddSubCallback(document.getElementById('newSubSeq').value, document.getElementById('newSubName').value);
        } else {
            document.getElementById('addSubModal').classList.remove('active');
        }
    };
    document.getElementById('addSubCancelBtn').onclick = () => {
        document.getElementById('addSubModal').classList.remove('active');
        pendingAddSubCallback = null;
    };

    document.getElementById('importConfirmBtn').onclick = () => {
        if (pendingImportCallback) pendingImportCallback();
        closeImportPreview();
    };
    document.getElementById('importCancelBtn').onclick = closeImportPreview;

    document.getElementById('masterImportFile').onchange = handleMasterImport;
    document.getElementById('processImportFile').onchange = handleProcessImport;

    document.getElementById('modalBusinessDoc').addEventListener('input', () => updateDocumentLinkIcon('modalBusinessDoc', 'businessDocLink'));
    document.getElementById('modalUserManual').addEventListener('input', () => updateDocumentLinkIcon('modalUserManual', 'userManualLink'));
}

// ============================
// 23. View Control
// ============================

function setView(view) {
    currentView = view;
    // Hide/show the filter panel based on current view
    const filterPanel = document.querySelector('.filter-panel');
    if (filterPanel) {
        filterPanel.style.display = (view === 'workflow') ? 'none' : 'block';
    } 
    document.getElementById('tableViewPanel').style.display = view === 'table' ? 'block' : 'none';
    document.getElementById('sequenceViewPanel').style.display = view === 'sequence' ? 'block' : 'none';
    document.getElementById('workflowViewPanel').style.display = view === 'workflow' ? 'block' : 'none';
    document.getElementById('tableViewTab').classList.toggle('active', view === 'table');
    document.getElementById('sequenceViewTab').classList.toggle('active', view === 'sequence');
    document.getElementById('workflowViewTab').classList.toggle('active', view === 'workflow');
    renderCurrentView();
}

function renderCurrentView() {
    if (window.workflowSvgLayer) {
        window.workflowSvgLayer.innerHTML = '';
        window.workflowSvgLayer = null;
    }

    if (currentView === 'table') {
        renderTable();
        document.getElementById('tableViewPanel').style.display = 'block';
        document.getElementById('sequenceViewPanel').style.display = 'none';
        document.getElementById('workflowViewPanel').style.display = 'none';
    } else if (currentView === 'sequence') {
        renderSequence();
        document.getElementById('tableViewPanel').style.display = 'none';
        document.getElementById('sequenceViewPanel').style.display = 'block';
        document.getElementById('workflowViewPanel').style.display = 'none';
    } else if (currentView === 'workflow') {
        document.getElementById('tableViewPanel').style.display = 'none';
        document.getElementById('sequenceViewPanel').style.display = 'none';
        document.getElementById('workflowViewPanel').style.display = 'block';

        renderWorkflow();

        resetConnectionState();

        setTimeout(function() {
            bindWorkflowEvents();
        }, 200);
    }
    updateUIVisibility();
}

function updateUIVisibility() {
    const isEdit = currentMode === 'edit';
    const root = document.getElementById('appRoot');
    if (!root) return;

    root.classList.toggle('display-mode', !isEdit);
    root.classList.toggle('edit-mode', isEdit);

    const addBtn = document.getElementById('addRowBtn');
    const importBtn = document.getElementById('importProcessesBtn');
    const saveBtn = document.getElementById('saveDataBtn');
    const reselectBtn = document.getElementById('reselectDataFileBtn');
    const modeBtn = document.getElementById('modeToggleBtn');

    if (addBtn) addBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (importBtn) importBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (saveBtn) saveBtn.style.display = isEdit ? 'inline-flex' : 'none';
    if (reselectBtn) reselectBtn.style.display = 'inline-flex';
    if (modeBtn) modeBtn.innerHTML = isEdit ? '👁️ Display Mode' : '✏️ Edit Mode';

    const token = getGitHubToken();
    let statusDiv = document.getElementById('tokenStatus');

    if (isEdit) {
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 'tokenStatus';
            statusDiv.style.marginLeft = '1rem';
            statusDiv.style.fontSize = '0.85rem';
            const titleSection = document.querySelector('.title-section');
            if (titleSection) titleSection.appendChild(statusDiv);
        }
        statusDiv.style.display = 'block';
        if (token) {
            statusDiv.innerHTML = '🟢 Token configured';
            statusDiv.style.color = '#16a34a';
        } else {
            statusDiv.innerHTML = '🔴 No Token - Cannot save to GitHub';
            statusDiv.style.color = '#dc2626';
        }
    } else if (statusDiv) {
        statusDiv.style.display = 'none';
    }
}

// ============================
// 26. Workflow View
// ============================

let workflowNodes = {};
let workflowLines = [];
let workflowConnections = [];
let connectionStartNode = null;
let nodeIdCounter = 0;
let workflowScale = 1;

function getWorkflowData() {
    const sc = getCurrentScenario();
    if (!sc) return { nodes: [], connections: [] };

    if (!sc.workflow) {
        sc.workflow = { nodes: [], connections: [] };
        console.log('Created new workflow for scenario:', sc.name);
    }
    normalizeWorkflowData(sc.workflow);
    if (sc.workflow.nodes) {
        sc.workflow.nodes.forEach(function(node) {
            if (node.hidden === undefined) {
                node.hidden = false;
            }
        });
    }

    if (sc.workflow.nodeIdCounter !== undefined) {
        let counter = sc.workflow.nodeIdCounter;
        if (Array.isArray(counter)) {
            counter = counter[0] || 0;
        }
        nodeIdCounter = typeof counter === 'number' ? counter : parseInt(counter) || 0;
    }

    return sc.workflow;
}

function saveWorkflowData(workflow) {
    const sc = getCurrentScenario();
    if (!sc) return;

    workflow.nodeIdCounter = nodeIdCounter;
    sc.workflow = workflow;

    // ✅ Update snapshot after workflow change
    //if (lastSnapshot) {
    //    lastSnapshot = JSON.parse(JSON.stringify(appData));
    //    saveSnapshot(lastSnapshot);
    //}

    renderWorkflow();
}

// ✅ Arrow update with requestAnimationFrame (no duplicate declaration)
function updateWorkflowArrows() {
    if (arrowUpdatePending) return;
    arrowUpdatePending = true;

    requestAnimationFrame(function() {
        arrowUpdatePending = false;
        const svgLayer = window.workflowSvgLayer;
        if (!svgLayer) return;

        svgLayer.querySelectorAll('.workflow-arrow-group').forEach(el => el.remove());

        const workflow = getWorkflowData();
        const canvasWrapper = document.querySelector('.workflow-canvas-wrapper');
        if (!canvasWrapper) return;

        const visibleNodeIds = new Set();
        workflow.nodes.forEach(function(n) {
            if (!n.hidden) visibleNodeIds.add(n.id);
        });

        workflow.connections.forEach(function(conn) {
            if (!visibleNodeIds.has(conn.from) || !visibleNodeIds.has(conn.to)) return;
            const fromEl = document.getElementById('wf-node-' + conn.from);
            const toEl = document.getElementById('wf-node-' + conn.to);
            if (fromEl && toEl) {
                drawArrowSVG(
                    svgLayer,
                    fromEl,
                    toEl,
                    canvasWrapper,
                    '#475569',
                    conn.type === 'decision' ? { len: 8, gap: 4 } : undefined,
                    conn.id
                );
            }
        });
    });
}

function renderWorkflow() {
    console.log('🔄 renderWorkflow called');
    const canvas = document.getElementById('workflowCanvas');
    if (!canvas) {
        console.warn('Canvas not found!');
        return;
    }

    const workflow = getWorkflowData();
    const isEdit = currentMode === 'edit';

    // Clear previous content
    canvas.querySelectorAll('.workflow-node').forEach(el => el.remove());
    canvas.querySelectorAll('.workflow-arrow-svg').forEach(el => el.remove());
    canvas.querySelectorAll('.workflow-arrow-line').forEach(el => el.remove());

    connectionStartNode = null;
    document.querySelectorAll('.workflow-node.active').forEach(function(el) {
        if (el) el.classList.remove('active');
    });

    const sc = getCurrentScenario();
    const processes = sc ? sc.processes : [];

    // Auto-create nodes if none exist
    if (workflow.nodes.length === 0 && processes.length > 0) {
        console.log('Creating workflow nodes from processes...');
        const nodeMap = {};
        const cols = Math.min(6, processes.length);
        const sortedProcs = sortProcesses(processes);

        sortedProcs.forEach((p, index) => {
            const id = 'node-' + (nodeIdCounter++);
            const isSub = p.seq && p.seq.includes('.');
            const node = {
                id: id,
                processId: p.id,
                type: isSub ? 'sub' : 'main',
                x: 100 + (index % cols) * 160,
                y: 100 + Math.floor(index / cols) * 110,
                label: p.name || 'Unnamed'
            };
            nodeMap[p.id] = node;
            workflow.nodes.push(node);
        });

        const topLevel = sortedProcs.filter(p => !p.seq || !p.seq.includes('.'));
        for (let i = 0; i < topLevel.length - 1; i++) {
            const from = topLevel[i];
            const to = topLevel[i + 1];
            if (from && to && nodeMap[from.id] && nodeMap[to.id]) {
                const connId = 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
                workflow.connections.push({
                    id: connId,
                    from: nodeMap[from.id].id,
                    to: nodeMap[to.id].id,
                    type: 'arrow'
                });
            }
        }

        saveWorkflowData(workflow);
        console.log('Created', workflow.nodes.length, 'nodes and', workflow.connections.length, 'connections');
    }

    // Build the canvas wrapper (large scrollable area)
    const canvasWrapper = document.createElement('div');
    canvasWrapper.className = 'workflow-canvas-wrapper';
    canvasWrapper.style.position = 'relative';
    canvasWrapper.style.width = '5000px';
    canvasWrapper.style.height = '5000px';
    canvasWrapper.style.overflow = 'visible';
    canvasWrapper.style.pointerEvents = 'auto';
    const zoomControls = canvas.querySelector('.workflow-zoom-controls');
    if (zoomControls) {
        canvasWrapper.appendChild(zoomControls);
    }

    canvas.innerHTML = '';
    canvas.appendChild(canvasWrapper);
    canvas.style.position = 'relative';
    canvas.style.overflow = 'auto';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.minHeight = '700px';

    // Node container (scaled)
    const nodeContainer = document.createElement('div');
    nodeContainer.className = 'workflow-node-container';
    nodeContainer.style.position = 'absolute';
    nodeContainer.style.top = '0';
    nodeContainer.style.left = '0';
    nodeContainer.style.width = '100%';
    nodeContainer.style.height = '100%';
    nodeContainer.style.transformOrigin = 'top left';
    nodeContainer.style.transform = 'scale(' + workflowScale + ')';
    nodeContainer.style.pointerEvents = 'auto';
    canvasWrapper.appendChild(nodeContainer);

    // SVG layer for arrows
    const svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgLayer.setAttribute('class', 'workflow-arrow-svg');
    svgLayer.style.position = 'absolute';
    svgLayer.style.top = '0';
    svgLayer.style.left = '0';
    svgLayer.style.width = '100%';
    svgLayer.style.height = '100%';
    svgLayer.style.pointerEvents = 'none';
    svgLayer.style.overflow = 'visible';
    canvasWrapper.appendChild(svgLayer);

    // Render nodes
    workflow.nodes.forEach(node => {
        if (!isEdit && node.hidden) {
            return;
        }
        const nodeEl = document.createElement('div');
        nodeEl.className = 'workflow-node';
        if (node.hidden) nodeEl.classList.add('hidden');
        nodeEl.id = 'wf-node-' + node.id;
        nodeEl.dataset.nodeId = node.id;
        nodeEl.dataset.x = node.x || 100;
        nodeEl.dataset.y = node.y || 100;

        // Selection highlighting
        if (selectedNodeId === node.id) {
            nodeEl.classList.add('selected');
            nodeEl.style.borderColor = '#2a5298';
            nodeEl.style.boxShadow = '0 0 0 3px rgba(42, 82, 152, 0.4)';
        } else {
            nodeEl.classList.remove('selected');
            nodeEl.style.borderColor = '';
            nodeEl.style.boxShadow = '';
        }

        let process = null;
        if (node.processId) {
            process = processes.find(p => p.id === node.processId);
        }

        let typeClass = '';
        let statusColor = 'default';
        let seqLabel = '';
        let nameLabel = node.label || 'Unnamed';

        // Set type class but preserve label for start/end
        if (node.type === 'start') {
            typeClass = 'type-start';
            // label will come from process or node.label
        } else if (node.type === 'end') {
            typeClass = 'type-end';
        } else if (node.type === 'decision') {
            typeClass = 'type-decision';
            nameLabel = '⚡ Decision';
        } else if (node.type === 'parallel') {
            typeClass = 'type-parallel';
            nameLabel = '📋 Parallel';
        }

        // For process-linked nodes (not decision/parallel), use process info
        if (process && !['decision', 'parallel'].includes(node.type)) {
            seqLabel = process.seq || '';
            nameLabel = process.name || 'Unnamed';
            const status = appData.businessStatuses.find(s => s.value === process.businessStatus);
            statusColor = status ? status.color : 'default';
        } else if (!process && !['decision', 'parallel'].includes(node.type)) {
            // For start/end without process, keep the node's label
            nameLabel = node.label || 'Unnamed';
        }

        if (typeClass) {
            nodeEl.classList.add(typeClass);
        }

        const statusHtml = process ? `<span class="node-status ${statusColor}">${escapeHtml(process.businessStatus || 'Not Defined')}</span>` : '';
        const seqDisplay = seqLabel ? `<span class="node-seq">${escapeHtml(seqLabel)}</span>` : (node.type ? `<span class="node-seq">${escapeHtml(node.type)}</span>` : '');

        let decisionHtml = '';
        if (node.type === 'decision') {
            const decisionText = node.decisionText || 'Decision?';
            decisionHtml = `<div class="node-decision-text">❓ ${escapeHtml(decisionText)}</div>`;
        }

        // System info: only hide for decision/parallel
        let sysName = '';
        let raciResponsible = '';
        if (process) {
            sysName = process.system?.name || '';
            if (process.raci && process.raci.r && process.raci.r.length > 0) {
                raciResponsible = process.raci.r.join(', ');
            }
        }
        if (node.type && ['decision', 'parallel'].includes(node.type)) {
            sysName = '';
            raciResponsible = '';
        }
        const metaHtml = (sysName || raciResponsible) ? `
            <div class="node-meta">
                ${sysName ? `<span class="node-sysname">🖥️ ${escapeHtml(sysName)}</span>` : ''}
                ${raciResponsible ? `<span class="node-raci">👤 ${escapeHtml(raciResponsible)}</span>` : ''}
            </div>
        ` : '';

        // Build node HTML – NO delete button, NO toggle button
        nodeEl.innerHTML = `
            <div class="node-header">
                ${seqDisplay}
                ${statusHtml}
            </div>
            <div class="node-name">${escapeHtml(nameLabel)}</div>
            ${decisionHtml}
            ${metaHtml}
        `;

        const xPos = node.x || 100;
        const yPos = node.y || 100;
        nodeEl.style.left = xPos + 'px';
        nodeEl.style.top = yPos + 'px';

        if (isEdit) {
            nodeEl.style.cursor = 'grab';
        } else {
            nodeEl.style.cursor = 'default';
        }

        // Click handling
        if (isEdit) {
            nodeEl.addEventListener('click', function(e) {
                e.stopPropagation();
                if (e.target.classList.contains('node-edit-btn')) return;
                handleNodeConnectionClick(node.id);
            });
        }

        if (!isEdit) {
            nodeEl.addEventListener('dblclick', function(e) {
                e.stopPropagation();
                let processId = node.processId;
                if (processId) {
                    openProcessDetail(processId);
                }
            });
        }

        // Keep decision edit button
        if (node.type === 'decision' && isEdit) {
            const editBtn = document.createElement('button');
            editBtn.className = 'node-edit-btn';
            editBtn.textContent = '✏️';
            editBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                editDecisionNode(node.id);
            });
            nodeEl.appendChild(editBtn);
        }

        nodeContainer.appendChild(nodeEl);
    });

    window.workflowNodeElements = {};
    nodeContainer.querySelectorAll('.workflow-node').forEach(function(el) {
        const id = el.dataset.nodeId;
        if (id) window.workflowNodeElements[id] = el;
    });

    // Draw arrows
    workflow.connections.forEach(function(conn) {
        if (isConnectionHidden(conn)) {
            return;
        }
        const fromEl = document.getElementById('wf-node-' + conn.from);
        const toEl = document.getElementById('wf-node-' + conn.to);
        if (fromEl && toEl) {
            drawArrowSVG(
                svgLayer,
                fromEl,
                toEl,
                canvasWrapper,
                '#475569',
                conn.type === 'decision' ? { len: 8, gap: 4 } : undefined,
                conn.id
            );
        }
    });

    window.workflowSvgLayer = svgLayer;

    if (isEdit) {
        setupWorkflowDrag(nodeContainer);
    }

    // Click on canvas background to deselect
    canvas.addEventListener('click', function(e) {
        if (e.target === canvas || e.target === canvasWrapper) {
            selectedNodeId = null;
            renderWorkflow();
        }
    });
    if (isConnectingMode) {
        canvas.classList.add('workflow-connecting');
    } else {
        canvas.classList.remove('workflow-connecting');
    }
    console.log('✅ renderWorkflow completed, nodes:', nodeContainer.querySelectorAll('.workflow-node').length);
}
function setupWorkflowDrag(container) {
    if (typeof interact === 'undefined') {
        console.warn('Interact.js not loaded');
        return;
    }

    const nodeContainer = container || document.querySelector('.workflow-node-container');
    if (!nodeContainer) return;

    try {
        interact('.workflow-node').unset();
    } catch(e) {}

    interact('.workflow-node').draggable({
        inertia: false,
        modifiers: [],
        autoScroll: true,
        onstart: function(event) {
            const target = event.target;
            target.classList.add('dragging');
            target.style.zIndex = 100;
        },
        onmove: function(event) {
            const target = event.target;
            const scale = workflowScale;
            const dx = event.dx / scale;
            const dy = event.dy / scale;

            const x = (parseFloat(target.dataset.x) || 100) + dx;
            const y = (parseFloat(target.dataset.y) || 100) + dy;

            target.style.left = x + 'px';
            target.style.top = y + 'px';

            target.dataset.x = x;
            target.dataset.y = y;

            const nodeId = target.dataset.nodeId;
            const workflow = getWorkflowData();
            const node = workflow.nodes.find(n => n.id === nodeId);
            if (node) {
                node.x = x;
                node.y = y;
            }

            updateWorkflowArrows();
        },
        onend: function(event) {
            const target = event.target;
            target.classList.remove('dragging');
            target.style.zIndex = 10;

            const nodeId = target.dataset.nodeId;
            const workflow = getWorkflowData();
            const node = workflow.nodes.find(n => n.id === nodeId);
            if (node) {
                node.x = parseFloat(target.dataset.x) || 100;
                node.y = parseFloat(target.dataset.y) || 100;
                saveWorkflowData(workflow);
            }

            updateWorkflowArrows();
        }
    });
}

// ✅ Connection handling with validation
function validateConnection(workflow, fromId, toId) {
    if (fromId === toId) {
        alert('❌ Cannot connect a node to itself');
        return false;
    }

    const exists = workflow.connections.some(function(c) {
        return (c.from === fromId && c.to === toId) ||
               (c.from === toId && c.to === fromId);
    });
    if (exists) {
        alert('⚠️ Connection already exists between these nodes');
        return false;
    }

    function canReach(start, target, visited) {
        if (start === target) return true;
        if (visited.has(start)) return false;
        visited.add(start);

        const outgoing = workflow.connections.filter(c => c.from === start);
        for (const c of outgoing) {
            if (canReach(c.to, target, visited)) {
                return true;
            }
        }
        return false;
    }

    if (canReach(toId, fromId, new Set())) {
        alert('⚠️ This would create a cycle in the workflow');
        return false;
    }

    return true;
}

function handleNodeConnectionClick(nodeId) {
    if (currentMode !== 'edit') return;

    // If we are NOT in connection mode, handle selection
    if (!isConnectingMode) {
        // Toggle selection: if already selected, deselect; else select
        if (selectedNodeId === nodeId) {
            selectedNodeId = null;
        } else {
            selectedNodeId = nodeId;
        }
        // Re-render to update the highlight
        renderWorkflow();
        return;
    }

    // --- Connection mode (isConnectingMode === true) ---
    if (!connectionStartNode) {
        // Start connection
        connectionStartNode = nodeId;
        const el = document.getElementById('wf-node-' + nodeId);
        if (el) {
            el.classList.add('connecting-start');
            el.style.borderColor = '#2a5298';
            el.style.boxShadow = '0 0 0 3px rgba(42, 82, 152, 0.4)';
        }
        return;
    }

    if (connectionStartNode === nodeId) {
        // Cancel connection
        const el = document.getElementById('wf-node-' + nodeId);
        if (el) {
            el.classList.remove('connecting-start');
            el.style.borderColor = '';
            el.style.boxShadow = '';
        }
        connectionStartNode = null;
        return;
    }

    const workflow = getWorkflowData();

    if (!validateConnection(workflow, connectionStartNode, nodeId)) {
        const el = document.getElementById('wf-node-' + connectionStartNode);
        if (el) {
            el.classList.remove('connecting-start');
            el.style.borderColor = '';
            el.style.boxShadow = '';
        }
        connectionStartNode = null;
        return;
    }

    const label = prompt('Enter arrow description (optional):', '');
    const connId = 'conn-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    workflow.connections.push({
        id: connId,
        from: connectionStartNode,
        to: nodeId,
        type: 'arrow',
        label: label && label.trim() ? label.trim() : undefined
    });

    saveWorkflowData(workflow);

    // Clear connection start highlight
    const el1 = document.getElementById('wf-node-' + connectionStartNode);
    if (el1) {
        el1.classList.remove('connecting-start');
        el1.style.borderColor = '';
        el1.style.boxShadow = '';
    }
    connectionStartNode = null;
    renderWorkflow();
}
// ✅ Use connection ID instead of index
function drawArrowSVG(svg, fromEl, toEl, wrapper, color, dash, connectionId) {
    if (!fromEl || !toEl || !wrapper) return;

    const fromRect = fromEl.getBoundingClientRect();
    const toRect = toEl.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    const fromX = fromRect.left + fromRect.width / 2 - wrapperRect.left;
    const fromY = fromRect.top + fromRect.height / 2 - wrapperRect.top;
    const toX = toRect.left + toRect.width / 2 - wrapperRect.left;
    const toY = toRect.top + toRect.height / 2 - wrapperRect.top;

    const dx = toX - fromX;
    const dy = toY - fromY;

    let startX = fromX;
    let startY = fromY;
    let endX = toX;
    let endY = toY;

    if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) {
            startX = fromRect.right - wrapperRect.left;
            endX = toRect.left - wrapperRect.left;
        } else {
            startX = fromRect.left - wrapperRect.left;
            endX = toRect.right - wrapperRect.left;
        }
        startY = fromRect.top + fromRect.height / 2 - wrapperRect.top;
        endY = toRect.top + toRect.height / 2 - wrapperRect.top;
    } else {
        if (dy > 0) {
            startY = fromRect.bottom - wrapperRect.top;
            endY = toRect.top - wrapperRect.top;
        } else {
            startY = fromRect.top - wrapperRect.top;
            endY = toRect.bottom - wrapperRect.top;
        }
        startX = fromRect.left + fromRect.width / 2 - wrapperRect.left;
        endX = toRect.left + toRect.width / 2 - wrapperRect.left;
    }

    const offsetX = Math.abs(endX - startX) * 0.3;
    const offsetY = Math.abs(endY - startY) * 0.3;

    let pathData = '';
    if (Math.abs(dx) > Math.abs(dy)) {
        const cp1x = startX + offsetX * (dx > 0 ? 1 : -1);
        const cp2x = endX - offsetX * (dx > 0 ? 1 : -1);
        pathData = `M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`;
    } else {
        const cp1y = startY + offsetY * (dy > 0 ? 1 : -1);
        const cp2y = endY - offsetY * (dy > 0 ? 1 : -1);
        pathData = `M ${startX} ${startY} C ${startX} ${cp1y}, ${endX} ${cp2y}, ${endX} ${endY}`;
    }

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'workflow-arrow-group');
    g.dataset.connectionId = connectionId;
    g.style.cursor = 'pointer';
    g.style.pointerEvents = 'all';
    g.style.zIndex = '1000';

    if (selectedArrowIndex !== null && selectedArrowIndex === connectionId) {
        g.classList.add('selected');
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', color || '#475569');
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    if (dash) {
        path.setAttribute('stroke-dasharray', dash.len + ',' + dash.gap);
    }
    path.setAttribute('class', 'workflow-arrow-line');
    g.appendChild(path);

    const angle = Math.atan2(endY - startY, endX - startX);
    const headLen = 10;
    const headAngle = Math.PI / 6;

    const arrowHead = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const tipX = endX;
    const tipY = endY;
    const leftX = endX - headLen * Math.cos(angle - headAngle);
    const leftY = endY - headLen * Math.sin(angle - headAngle);
    const rightX = endX - headLen * Math.cos(angle + headAngle);
    const rightY = endY - headLen * Math.sin(angle + headAngle);

    arrowHead.setAttribute('points', `${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`);
    arrowHead.setAttribute('fill', color || '#475569');
    arrowHead.setAttribute('class', 'workflow-arrow-head');
    g.appendChild(arrowHead);

    // --- Add interactive hit area (if in edit mode) ---
    if (currentMode === 'edit') {
        const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        hitArea.setAttribute('d', pathData);
        hitArea.setAttribute('stroke', 'transparent');
        hitArea.setAttribute('stroke-width', '15');
        hitArea.setAttribute('fill', 'none');
        hitArea.setAttribute('class', 'workflow-arrow-hit');
        hitArea.style.pointerEvents = 'all';
        g.appendChild(hitArea);

        g.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();

            const connId = this.dataset.connectionId;
            if (!connId) return;

            if (selectedArrowIndex === connId) {
                selectedArrowIndex = null;
                renderWorkflow();
                return;
            }

            selectedArrowIndex = connId;
            renderWorkflow();

            setTimeout(function() {
                if (selectedArrowIndex === connId) {
                    if (confirm('Delete this arrow?')) {
                        deleteWorkflowConnection(connId);
                        selectedArrowIndex = null;
                    } else {
                        if (confirm('Edit arrow label instead?')) {
                            editWorkflowConnectionLabel(connId);
                            selectedArrowIndex = null;
                        } else {
                            selectedArrowIndex = null;
                            renderWorkflow();
                        }
                    }
                }
            }, 300);
        });

        g.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            const connId = this.dataset.connectionId;
            if (connId) {
                editWorkflowConnectionLabel(connId);
                selectedArrowIndex = null;
            }
        });

        g.addEventListener('mouseenter', function() {
            if (!this.classList.contains('selected')) {
                this.querySelector('.workflow-arrow-line').setAttribute('stroke', '#8b5cf6');
                this.querySelector('.workflow-arrow-head').setAttribute('fill', '#8b5cf6');
            }
        });

        g.addEventListener('mouseleave', function() {
            if (!this.classList.contains('selected')) {
                this.querySelector('.workflow-arrow-line').setAttribute('stroke', color || '#475569');
                this.querySelector('.workflow-arrow-head').setAttribute('fill', color || '#475569');
            }
        });
    }

    // --- Add label with background (improved readability) ---
    if (connectionId) {
        const workflow = getWorkflowData();
        const conn = workflow.connections.find(c => c.id === connectionId);
        if (conn && conn.label) {
            const midX = (startX + endX) / 2;
            const midY = (startY + endY) / 2 - 20; // offset above the line

            // Create a group for label + background
            const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            labelGroup.setAttribute('class', 'workflow-arrow-label-group');

            // Rough text size estimation
            const fontSize = 11;
            const text = conn.label || '';
            const textLength = text.length * fontSize * 0.6; // approximate width
            const textHeight = fontSize * 1.2;

            // Background rectangle
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', midX - textLength/2 - 6);
            rect.setAttribute('y', midY - textHeight/2 - 3);
            rect.setAttribute('width', textLength + 12);
            rect.setAttribute('height', textHeight + 6);
            rect.setAttribute('fill', 'white');
            rect.setAttribute('rx', '4');
            rect.setAttribute('ry', '4');
            rect.setAttribute('opacity', '0.92');
            rect.setAttribute('stroke', '#e2e8f0');
            rect.setAttribute('stroke-width', '0.5');
            labelGroup.appendChild(rect);

            // Label text
            const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            textEl.setAttribute('x', midX);
            textEl.setAttribute('y', midY + fontSize * 0.35); // adjust baseline
            textEl.setAttribute('text-anchor', 'middle');
            textEl.setAttribute('font-size', fontSize);
            textEl.setAttribute('fill', '#475569');
            textEl.setAttribute('font-weight', '500');
            textEl.setAttribute('class', 'workflow-arrow-label');
            textEl.textContent = conn.label;
            labelGroup.appendChild(textEl);

            g.appendChild(labelGroup);
        }
    }

    svg.appendChild(g);
}
// ✅ Delete connection by ID
function deleteWorkflowConnection(connectionId) {
    if (currentMode !== 'edit') return;
    if (!confirm('Delete this connection?')) return;

    const workflow = getWorkflowData();
    const idx = workflow.connections.findIndex(c => c.id === connectionId);
    if (idx !== -1) {
        workflow.connections.splice(idx, 1);
        saveWorkflowData(workflow);
        renderWorkflow();
    }
}

// ✅ Edit connection label by ID
function editWorkflowConnectionLabel(connectionId) {
    if (currentMode !== 'edit') return;

    const workflow = getWorkflowData();
    const conn = workflow.connections.find(c => c.id === connectionId);
    if (!conn) return;

    const currentLabel = conn.label || '';
    const newLabel = prompt('Enter arrow description:', currentLabel);
    if (newLabel !== null) {
        conn.label = newLabel.trim() || undefined;
        saveWorkflowData(workflow);
        renderWorkflow();
    }
}

function deleteWorkflowNode(nodeId) {
    if (currentMode !== 'edit') return;
    if (!confirm('Delete this workflow node?')) return;

    const workflow = getWorkflowData();
    workflow.nodes = workflow.nodes.filter(n => n.id !== nodeId);
    workflow.connections = workflow.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    saveWorkflowData(workflow);
    renderWorkflow();
}

function toggleWorkflowNodeVisibility(nodeId) {
    if (currentMode !== 'edit') return;

    const workflow = getWorkflowData();
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) return;

    node.hidden = !node.hidden;

    if (node.hidden) {
        const connected = workflow.connections.filter(c => c.from === nodeId || c.to === nodeId);
        if (connected.length > 0) {
            if (confirm(`Hide "${node.label || node.type || 'Node'}"?\n\nThis will remove ${connected.length} connected arrow(s).`)) {
                workflow.connections = workflow.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
            } else {
                node.hidden = false;
                saveWorkflowData(workflow);
                renderWorkflow();
                return;
            }
        }
    }

    saveWorkflowData(workflow);
    renderWorkflow();
}

function isConnectionHidden(conn) {
    const workflow = getWorkflowData();
    const fromNode = workflow.nodes.find(n => n.id === conn.from);
    const toNode = workflow.nodes.find(n => n.id === conn.to);
    return (fromNode && fromNode.hidden) || (toNode && toNode.hidden);
}

function editDecisionNode(nodeId) {
    if (currentMode !== 'edit') return;

    const workflow = getWorkflowData();
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node || node.type !== 'decision') return;

    const currentText = node.decisionText || '';
    const newText = prompt('Enter decision description:', currentText);
    if (newText !== null) {
        node.decisionText = newText.trim() || 'Decision?';
        saveWorkflowData(workflow);
        renderWorkflow();
    }
}

function clearWorkflowArrows() {
    if (!confirm('Clear all connections?')) return;
    const workflow = getWorkflowData();
    workflow.connections = [];
    saveWorkflowData(workflow);
    renderWorkflow();
}

function clearAllWorkflow() {
    if (!confirm('Clear ALL workflow nodes and connections?')) return;
    const workflow = getWorkflowData();
    workflow.nodes = [];
    workflow.connections = [];
    saveWorkflowData(workflow);
    renderWorkflow();
}

function autoLayoutWorkflow() {
    const workflow = getWorkflowData();
    if (workflow.nodes.length === 0) return;

    // Hierarchical layout
    const adj = {};
    workflow.nodes.forEach(function(n) { adj[n.id] = []; });
    workflow.connections.forEach(function(c) {
        if (adj[c.from]) adj[c.from].push(c.to);
    });

    const hasIncoming = new Set();
    workflow.connections.forEach(function(c) { hasIncoming.add(c.to); });
    const roots = workflow.nodes.filter(function(n) { return !hasIncoming.has(n.id); });

    if (roots.length === 0) {
        // Fallback to grid
        const cols = Math.ceil(Math.sqrt(workflow.nodes.length));
        const spacingX = 160;
        const spacingY = 110;
        const startX = 50;
        const startY = 50;
        workflow.nodes.forEach(function(node, index) {
            const col = index % cols;
            const row = Math.floor(index / cols);
            node.x = startX + col * spacingX;
            node.y = startY + row * spacingY;
        });
        saveWorkflowData(workflow);
        renderWorkflow();
        return;
    }

    const levels = {};
    const visited = new Set();
    let queue = roots.map(function(r) { return { id: r.id, level: 0 }; });

    while (queue.length > 0) {
        const current = queue.shift();
        if (visited.has(current.id)) continue;
        visited.add(current.id);
        levels[current.id] = current.level;

        const children = adj[current.id] || [];
        for (const child of children) {
            if (!visited.has(child)) {
                queue.push({ id: child, level: current.level + 1 });
            }
        }
    }

    workflow.nodes.forEach(function(n) {
        if (!visited.has(n.id)) {
            levels[n.id] = 0;
        }
    });

    const levelGroups = {};
    workflow.nodes.forEach(function(n) {
        const l = levels[n.id] || 0;
        if (!levelGroups[l]) levelGroups[l] = [];
        levelGroups[l].push(n);
    });

    const levelKeys = Object.keys(levelGroups).map(Number).sort((a, b) => a - b);
    const spacingX = 160;
    const spacingY = 140;
    const startX = 50;
    const startY = 50;

    levelKeys.forEach(function(level, lIdx) {
        const nodes = levelGroups[level];
        const totalHeight = (nodes.length - 1) * spacingY;
        const startYOffset = -totalHeight / 2;

        nodes.forEach(function(node, idx) {
            node.x = startX + lIdx * spacingX;
            node.y = startY + startYOffset + idx * spacingY + 50;
        });
    });

    saveWorkflowData(workflow);
    renderWorkflow();
}

// ============================
// 27. Workflow Event Binding
// ============================

function bindWorkflowEvents() {
    if (workflowEventsBound) {
        resetConnectionState();
        return;
    }
    workflowEventsBound = true;
    const wfSyncNodesBtn = document.getElementById('wfSyncNodesBtn');
    const wfConnectBtn = document.getElementById('wfConnectBtn');
    const wfClearArrowsBtn = document.getElementById('wfClearArrowsBtn');
    const wfClearAllBtn = document.getElementById('wfClearAllBtn');
    const wfAutoLayoutBtn = document.getElementById('wfAutoLayoutBtn');
    const wfZoomIn = document.getElementById('wfZoomIn');
    const wfZoomOut = document.getElementById('wfZoomOut');
    const wfResetView = document.getElementById('wfResetView');
    
    if (wfSyncNodesBtn) {
        wfSyncNodesBtn.addEventListener('click', function() {
            syncNodesForCurrentScenario();
        });
    }
    if (wfConnectBtn) {
        wfConnectBtn.addEventListener('click', function() {
            // Toggle connection mode
            isConnectingMode = !isConnectingMode;
            if (isConnectingMode) {
                connectionStartNode = null;
                this.classList.add('active');
                this.textContent = '🔗 Cancel Connection';
                alert('💡 Connection mode enabled. Click a node to start, then click another node to connect. Click this button again to cancel.');
            } else {
                this.classList.remove('active');
                this.textContent = '🔗 Start to Connect';
                // Reset connection state
                if (connectionStartNode) {
                    const el = document.getElementById('wf-node-' + connectionStartNode);
                    if (el) {
                        el.classList.remove('connecting-start');
                        el.style.borderColor = '';
                        el.style.boxShadow = '';
                    }
                    connectionStartNode = null;
                }
                // Deselect any selected node? Not necessary.
            }
            renderWorkflow();
        });
    }
    
    if (wfClearArrowsBtn) {
        wfClearArrowsBtn.addEventListener('click', clearWorkflowArrows);
    }
    if (wfClearAllBtn) {
        wfClearAllBtn.addEventListener('click', clearAllWorkflow);
    }
    if (wfAutoLayoutBtn) {
        wfAutoLayoutBtn.addEventListener('click', autoLayoutWorkflow);
    }
    if (wfZoomIn) {
        wfZoomIn.addEventListener('click', function() {
            workflowScale = Math.min(workflowScale + 0.1, 2);
            renderWorkflow();
        });
    }
    if (wfZoomOut) {
        wfZoomOut.addEventListener('click', function() {
            workflowScale = Math.max(workflowScale - 0.1, 0.5);
            renderWorkflow();
        });
    }
    if (wfResetView) {
        wfResetView.addEventListener('click', function() {
            workflowScale = 1;
            renderWorkflow();
        });
    }
    const wfMarkStartBtn = document.getElementById('wfMarkStartBtn');
    const wfMarkEndBtn = document.getElementById('wfMarkEndBtn');
    
    if (wfMarkStartBtn) {
        wfMarkStartBtn.addEventListener('click', function() {
            if (!selectedNodeId) {
                alert('Please select a node first (click on it).');
                return;
            }
            toggleNodeType(selectedNodeId, 'start');
        });
    }
    
    if (wfMarkEndBtn) {
        wfMarkEndBtn.addEventListener('click', function() {
            if (!selectedNodeId) {
                alert('Please select a node first (click on it).');
                return;
            }
            toggleNodeType(selectedNodeId, 'end');
        });
    }
    // ===== NEW: Delete Node =====
    const wfDeleteNodeBtn = document.getElementById('wfDeleteNodeBtn');
    if (wfDeleteNodeBtn) {
        wfDeleteNodeBtn.addEventListener('click', function() {
            if (!selectedNodeId) {
                alert('Please select a node first (click on it).');
                return;
            }
            if (confirm('Delete the selected workflow node?')) {
                deleteWorkflowNode(selectedNodeId);
                selectedNodeId = null; // clear selection
            }
        });
    }
    
    // ===== NEW: Hide/Unhide Node =====
    const wfToggleHideBtn = document.getElementById('wfToggleHideBtn');
    if (wfToggleHideBtn) {
        wfToggleHideBtn.addEventListener('click', function() {
            if (!selectedNodeId) {
                alert('Please select a node first (click on it).');
                return;
            }
            toggleWorkflowNodeVisibility(selectedNodeId);
            // Keep selection on the node (it stays selected)
        });
    }


    
    resetConnectionState();
}

function resetConnectionState() {
    if (connectionStartNode) {
        const el = document.getElementById('wf-node-' + connectionStartNode);
        if (el) {
            el.classList.remove('connecting-start');
            el.style.borderColor = '';
            el.style.boxShadow = '';
        }
        connectionStartNode = null;
    }
    document.querySelectorAll('.workflow-node.connecting-start').forEach(el => {
        el.classList.remove('connecting-start');
        el.style.borderColor = '';
        el.style.boxShadow = '';
    });
}

// ============================
// 24. Page Startup
// ============================

console.log('🚀 Starting app...');

document.addEventListener('DOMContentLoaded', function() {
    console.log('📄 DOMContentLoaded event');
    // No token prompt on load – just load data in read‑only mode.
    loadData();
});


// ============================
// 25. Expose Global Functions
// ============================

window.toggleCollapse = toggleCollapse;
window.openProcessDetail = openProcessDetail;
window.saveDataToGitHub = saveDataToGitHub;
window.setupToken = showTokenSetup;
window.loadData = loadData;
window.renderApp = renderApp;

console.log('✅ app.js initialization complete');
