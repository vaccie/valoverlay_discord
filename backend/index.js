const fs = require('fs');
const path = require('path');

// DEBUG FILE LOGGER (INITIALIZED FIRST)
const USE_MOCK_DATA = false;
const LOG_FILE = path.join(process.cwd(), 'debug_log.txt');
function logToFile(msg) {
    if (!USE_MOCK_DATA) return;
    try {
        const timestamp = new Date().toISOString();
        fs.appendFileSync(LOG_FILE, `[${timestamp}] ${msg} \n`);
    } catch (e) { }
}

logToFile('Booting application...');

process.on('uncaughtException', (err) => {
    logToFile('UNCAUGHT EXCEPTION: ' + err.stack);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logToFile('UNHANDLED REJECTION: ' + reason);
});

let express, http, WebSocket, valorant, discord;
try {
    logToFile('Loading dependencies...');
    express = require('express');
    http = require('http');
    WebSocket = require('ws');
    logToFile('Core dependencies loaded.');

    logToFile('Loading local modules...');
    valorant = require('./valorant');
    discord = require('./discord');
    logToFile('Local modules loaded.');
} catch (e) {
    logToFile('CRITICAL ERROR LOADING MODULES: ' + e.message + '\n' + e.stack);
    process.exit(1);
}

const app = express();
const server = http.createServer(app);
const isPkg = typeof process.pkg !== 'undefined';
const wss = new WebSocket.Server({ server }); // pure websocket server, no socket.io overhead

// Static files (bundled inside exe)
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/ignore', express.static(path.join(__dirname, '../website'))); // Landing page available at /ignore if needed
app.use(express.json());

// Set up data directory for persistence (AppData)
// We use APPDATA so the config survives even if the user moves the exe around
const APPDATA = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
const DATA_DIR = path.join(APPDATA, 'ValorantOverlay');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Mutable files (in AppData)
const MAPPING_FILE = path.join(DATA_DIR, 'mapping.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Ensure empty mapping exists
if (!fs.existsSync(MAPPING_FILE)) {
    fs.writeFileSync(MAPPING_FILE, '{}');
}

// Ensure default config sample exists
if (!fs.existsSync(CONFIG_FILE)) {
    // We don't write defaults here to avoid overwriting invalid files, 
    // but the API handles missing files gracefully.
}

app.get('/api/mapping', (req, res) => {
    const mappingPath = MAPPING_FILE;
    if (fs.existsSync(mappingPath)) {
        try {
            const data = fs.readFileSync(mappingPath, 'utf8');
            res.json(JSON.parse(data));
        } catch (e) {
            res.json({});
        }
    } else {
        res.json({});
    }
});

app.post('/api/mapping', (req, res) => {
    const newMapping = req.body;
    const mappingPath = MAPPING_FILE;
    try {
        fs.writeFileSync(mappingPath, JSON.stringify(newMapping, null, 4));
        sendUpdate();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({
        valorant: valorant.initialized,
        discord: discord.connected,
        mockMode: USE_MOCK_DATA,
        connections: connectedClients.size
    });
});

// GET /api/config
app.get('/api/config', (req, res) => {
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            res.json(JSON.parse(data));
        } catch (e) {
            res.json({});
        }
    } else {
        res.json({ clientId: '', clientSecret: '', redirectUri: 'http://localhost' });
    }
});

// POST /api/config
app.post('/api/config', (req, res) => {
    const newConfig = req.body;
    // Basic validation
    if (!newConfig.clientId || !newConfig.clientSecret) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    // Ensure redirectUri is set
    if (!newConfig.redirectUri) newConfig.redirectUri = 'http://localhost';

    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 4));
        res.json({ success: true, message: 'Saved. Restart required.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

let connectedClients = new Set();
let userAgentMap = {};



const broadcast = (data) => {
    const payload = JSON.stringify(data);
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
};

wss.on('connection', (ws) => {
    connectedClients.add(ws);
    sendUpdate();

    ws.on('close', () => {
        connectedClients.delete(ws);
    });
});

discord.on('update', () => sendUpdate());
discord.on('speaking', (data) => {
    broadcast({ type: 'speaking', ...data });
});

async function sendUpdate() {
    const voiceStates = await Promise.race([
        discord.getChannelUsers(),
        new Promise(resolve => setTimeout(() => resolve(null), 2000))
    ]);

    if (!voiceStates) {
        return;
    }

    const localAgentId = await valorant.getLocalPlayerAgent();

    const matchPlayers = await valorant.getMatchPlayers();
    const matchPuuids = matchPlayers.map(p => p.puuid);
    const playerNames = await valorant.fetchPlayerNames(matchPuuids);

    const nameToAgentMap = {};
    matchPlayers.forEach(p => {
        const fullName = playerNames[p.puuid];
        if (fullName) {
            nameToAgentMap[fullName.toLowerCase()] = p.agentId;
            const justName = fullName.split('#')[0].toLowerCase();
            nameToAgentMap[justName] = p.agentId;
        }
    });

    const enrichedUsers = await Promise.all(voiceStates.map(async (member) => {
        const discordId = member.user.id;
        let agentId = null;

        const discordName = member.user.username.toLowerCase();
        const discordNick = member.nick ? member.nick.toLowerCase() : null;

        const myDiscordId = discord.rpc.user ? discord.rpc.user.id : null;
        if (myDiscordId && discordId === myDiscordId) {
            agentId = localAgentId;
        }

        if (!agentId) {
            try {
                const mappingPath = MAPPING_FILE;
                if (fs.existsSync(mappingPath)) {
                    const mappingData = fs.readFileSync(mappingPath, 'utf8');
                    const mapping = JSON.parse(mappingData);

                    let mappedValName = null;
                    Object.keys(mapping).forEach(key => {
                        if (key.toLowerCase() === discordName) {
                            mappedValName = mapping[key];
                        }
                    });

                    if (mappedValName) {
                        const targetValName = mappedValName.toLowerCase();
                        if (nameToAgentMap[targetValName]) {
                            agentId = nameToAgentMap[targetValName];
                        } else {
                            for (const [knownVal, knownAgent] of Object.entries(nameToAgentMap)) {
                                if (knownVal.includes(targetValName)) {
                                    agentId = knownAgent;
                                    break;
                                }
                            }
                        }
                    }
                }
            } catch (e) { }

            if (!agentId && USE_MOCK_DATA) {
                const agents = Object.keys(valorant.agentMap);
                if (agents.length > 0) {
                    const hash = discordId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    agentId = agents[hash % agents.length];
                }
            }

            if (!agentId) {
                if (nameToAgentMap[discordName]) agentId = nameToAgentMap[discordName];
                else if (discordNick && nameToAgentMap[discordNick]) agentId = nameToAgentMap[discordNick];

                if (!agentId) {
                    for (const [valName, valAgent] of Object.entries(nameToAgentMap)) {
                        if (valName.includes(discordName) || discordName.includes(valName)) {
                            agentId = valAgent;
                            break;
                        }
                        if (discordNick && (valName.includes(discordNick) || discordNick.includes(valName))) {
                            agentId = valAgent;
                            break;
                        }
                    }
                }
            }
        }

        const imageUrl = await valorant.getAgentUrlOutput(agentId);

        const vs = member.voice_state || {};
        const isMuted = !!(vs.mute || vs.self_mute);
        const isDeaf = !!(vs.deaf || vs.self_deaf);

        return {
            id: discordId,
            username: member.nick || member.user.username,
            avatar: `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png`,
            agentImage: imageUrl,
            isMuted: isMuted,
            isDeaf: isDeaf
        };
    }));

    broadcast({ type: 'state', users: enrichedUsers });
}

const { exec } = require('child_process');

(async () => {
    await valorant.init();
    await discord.connect();

    server.listen(3000, () => {
        console.log('\n==================================================');
        console.log('      VALORANT DISCORD OVERLAY IS RUNNING');
        console.log('      Made with ❤️ by vaccie');
        console.log('==================================================');
        console.log('-> Dashboard: http://localhost:3000/dashboard.html');
        console.log('-> Overlay:   http://localhost:3000');
        console.log('\n[INFO] Keep this window OPEN.');
        console.log('[INFO] To close the application, just close this window.');
        console.log('==================================================\n');

        // Auto-open browser
        exec('start http://localhost:3000/dashboard.html');
    });

    wss.on('connection', () => {
    });

    setInterval(async () => {
        if (!valorant.port) {
            await valorant.init();
        }

        await sendUpdate();

    }, 1000);

})();
