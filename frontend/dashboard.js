const mappingTable = document.querySelector('#mapping-table tbody');
const statusBadge = document.getElementById('status-badge');
const modal = document.getElementById('modal');
const discordInput = document.getElementById('discord-input');
const valorantInput = document.getElementById('valorant-input');

let currentMapping = {};
let editKey = null;

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        const badge = document.getElementById('status-badge');
        const discordBadge = document.getElementById('discord-badge');

        // Valorant Status
        if (data.mockMode) {
            badge.textContent = "MOCK MODE ACTIVE";
            badge.className = "badge disconnected";
        } else if (data.valorant) {
            badge.textContent = "VALORANT: CONNECTED";
            badge.className = "badge connected";
        } else {
            badge.textContent = "VALORANT: WAITING...";
            badge.className = "badge disconnected";
        }

        // Discord Status
        if (data.discord) {
            discordBadge.textContent = "DISCORD: CONNECTED";
            discordBadge.className = "badge connected";
        } else {
            discordBadge.textContent = "DISCORD: DISCONNECTED";
            discordBadge.className = "badge disconnected";
        }

    } catch (e) {
        console.error(e);
        // Fallback for server offline, update both badges if they exist
        const badge = document.getElementById('status-badge');
        const discordBadge = document.getElementById('discord-badge');
        if (badge) {
            badge.textContent = 'SERVER OFFLINE';
            badge.className = 'badge disconnected';
        }
        if (discordBadge) {
            discordBadge.textContent = 'SERVER OFFLINE';
            discordBadge.className = 'badge disconnected';
        }
    }
}

async function fetchMapping() {
    const res = await fetch('/api/mapping');
    currentMapping = await res.json();
    renderTable();
}

async function saveMapping(newMapping) {
    await fetch('/api/mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMapping)
    });
    currentMapping = newMapping;
    renderTable();
}

function renderTable() {
    mappingTable.innerHTML = '';
    const keys = Object.keys(currentMapping);

    if (keys.length === 0) {
        mappingTable.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 2rem; opacity: 0.5;">No manual mappings. Auto-match is active.</td></tr>';
        return;
    }

    keys.forEach(key => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${key}</td>
            <td>${currentMapping[key]}</td>
            <td>
                <button class="action-btn edit-btn" onclick="openEdit('${key}')">✏️</button>
                <button class="action-btn delete-btn" onclick="deleteItem('${key}')">🗑️</button>
            </td>
        `;
        mappingTable.appendChild(tr);
    });
}

window.deleteItem = async (key) => {
    if (confirm(`Remove mapping for ${key}?`)) {
        const newMap = { ...currentMapping };
        delete newMap[key];
        await saveMapping(newMap);
    }
};

window.openEdit = (key) => {
    editKey = key;
    discordInput.value = key;
    valorantInput.value = currentMapping[key];
    modal.classList.remove('hidden');
};

document.getElementById('add-btn').onclick = () => {
    editKey = null;
    discordInput.value = '';
    valorantInput.value = '';
    modal.classList.remove('hidden');
};

document.getElementById('cancel-btn').onclick = () => {
    modal.classList.add('hidden');
};

document.getElementById('save-btn').onclick = async () => {
    const dName = discordInput.value.trim();
    const vName = valorantInput.value.trim();

    if (!dName || !vName) {
        alert('Both fields are required');
        return;
    }

    const newMap = { ...currentMapping };

    if (editKey && editKey !== dName) {
        delete newMap[editKey];
    }

    newMap[dName] = vName;
    await saveMapping(newMap);
    modal.classList.add('hidden');
};

// Config Logic
const configModal = document.getElementById('config-modal');
const clientIdInput = document.getElementById('client-id-input');
const clientSecretInput = document.getElementById('client-secret-input');

document.getElementById('settings-btn').onclick = async () => {
    configModal.classList.remove('hidden');
    // Fetch current config to populate
    try {
        const res = await fetch('/api/config');
        const data = await res.json();
        if (data.clientId) clientIdInput.value = data.clientId;
        if (data.clientSecret) clientSecretInput.value = data.clientSecret;
    } catch (e) {
        console.error(e);
    }
};

document.getElementById('config-cancel-btn').onclick = () => {
    configModal.classList.add('hidden');
};

window.toggleSecretVisibility = () => {
    if (clientSecretInput.type === 'password') {
        clientSecretInput.type = 'text';
    } else {
        clientSecretInput.type = 'password';
    }
};

document.getElementById('config-save-btn').onclick = async () => {
    const cid = clientIdInput.value.trim();
    const csec = clientSecretInput.value.trim();

    if (!cid || !csec) {
        alert('Client ID and Secret are required.');
        return;
    }

    const newConfig = {
        clientId: cid,
        clientSecret: csec,
        redirectUri: 'http://localhost'
    };

    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newConfig)
        });
        alert('Configuration Saved! Please restart the application (close the black window and run start.bat again) for changes to take effect.');
        configModal.classList.add('hidden');
    } catch (e) {
        alert('Error saving config: ' + e.message);
    }
};

// Init
fetchMapping();
fetchStatus();
setInterval(fetchStatus, 3000);
