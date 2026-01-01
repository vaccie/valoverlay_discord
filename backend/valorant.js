const fs = require('fs');
const path = require('path');
const https = require('https');
const fetch = require('node-fetch');
const os = require('os');

class ValorantClient {
    constructor() {
        this.client = null; // Stores base URL and auth headers
        this.puuid = null;
        this.agentMap = {};
        this.initialized = false;
        // Self-signed cert agent - Riot's local API uses a self-signed cert so we have to tell node to chill
        this.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    // Helper to mimic axios-like request behavior
    async request(endpoint, options = {}) {
        const url = endpoint.startsWith('http') ? endpoint : `${this.client.baseURL}${endpoint}`;

        const config = {
            method: options.method || 'GET',
            headers: {
                ...this.client.headers,
                ...options.headers
            },
            agent: this.httpsAgent
        };

        if (options.data) {
            config.body = JSON.stringify(options.data);
            config.headers['Content-Type'] = 'application/json';
        }

        const res = await fetch(url, config);

        if (!res.ok) {
            const error = new Error(`Request failed with status ${res.status}`);
            error.response = { status: res.status };
            throw error;
        }

        const data = await res.json();
        return { data };
    }

    async init() {
        try {
            const lockfilePath = path.join(os.homedir(), 'AppData', 'Local', 'Riot Games', 'Riot Client', 'Config', 'lockfile');

            if (Object.keys(this.agentMap).length === 0) {
                await this.fetchAgentData();
            }

            if (!fs.existsSync(lockfilePath)) {
                return false;
            }

            const content = fs.readFileSync(lockfilePath, 'utf8');
            const [name, pid, port, password, protocol] = content.split(':');

            const authHeader = `Basic ${Buffer.from(`riot:${password}`).toString('base64')}`;

            // Store config for requests. These headers mimic the real client to avoid getting blocked.
            this.client = {
                baseURL: `${protocol}://127.0.0.1:${port}`,
                headers: {
                    'Authorization': authHeader,
                    'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9',
                    'X-Riot-ClientVersion': 'release-05.04-shipping-9-752985'
                }
            };

            await this.fetchPUUID();
            await this.fetchRegion();
            await this.fetchClientVersion();
            await this.parseLogs();
            await this.fetchAgentData();

            this.initialized = true;
            this.port = port;
            console.log(`[Valorant] Connected to Local API on port ${port}`);
            return true;

        } catch (error) {
            console.error('[Valorant] Init Error:', error.message);
            return false;
        }
    }

    async fetchClientVersion() {
        try {
            // Public API call doesn't use local client auth
            const res = await fetch('https://valorant-api.com/v1/version');
            const json = await res.json();

            if (json && json.data) {
                const version = json.data.riotClientVersion;
                this.clientVersion = version;
                if (this.client) {
                    this.client.headers['X-Riot-ClientVersion'] = version;
                }
                console.log('[Valorant] Client Version set:', version);
            }
        } catch (e) {
            console.error('[Valorant] Failed to fetch Client Version:', e.message);
        }
    }

    async parseLogs() {
        try {
            const logPath = path.join(os.homedir(), 'AppData', 'Local', 'VALORANT', 'Saved', 'Logs', 'ShooterGame.log');
            if (!fs.existsSync(logPath)) return;

            const content = fs.readFileSync(logPath, 'utf8');
            const regex = /https:\/\/glz-(.+?)-1.(.+?).a.pvp.net/;
            const match = content.match(regex);

            if (match) {
                this.glzUrl = match[0];
                console.log('[Valorant] Found GLZ URL in logs:', this.glzUrl);
            }
        } catch (e) {
            console.log('[Valorant] Could not parse logs:', e.message);
        }
    }

    async fetchPUUID() {
        if (!this.client) return;
        try {
            const res = await this.request('/entitlements/v1/token');
            this.puuid = res.data.subject;

            this.accessToken = res.data.accessToken;
            const entitlements = res.data.token;

            if (entitlements) {
                this.entitlements = entitlements;
                this.client.headers['X-Riot-Entitlements-JWT'] = entitlements;
                console.log('[Valorant] Auth Tokens fetched');
            }

            console.log('[Valorant] PUUID:', this.puuid);
        } catch (e) {
            console.error('[Valorant] Failed to get PUUID:', e.message);
        }
    }

    async fetchRegion() {
        if (!this.client) return;
        try {
            const res = await this.request('/product-session/v1/external-sessions');
            const session = Object.values(res.data).find(x => x.productId === 'valorant');

            if (session && session.launchConfiguration) {
                const args = session.launchConfiguration.arguments;
                const deploymentArg = args.find(a => a.includes('-ares-deployment'));
                if (deploymentArg) {
                    this.region = deploymentArg.split('=')[1];
                    console.log('[Valorant] Region detected:', this.region);
                }
            }

            if (!this.region) {
                this.region = 'eu';
                console.log('[Valorant] Region defaulted to EU');
            }

            if (['na', 'latam', 'br'].includes(this.region)) {
                this.shard = 'na';
            } else if (['ap', 'kr'].includes(this.region)) {
                this.shard = this.region;
                if (this.region === 'ap') this.shard = 'ap';
            } else {
                this.shard = 'eu';
            }
            console.log(`[Valorant] Shard set to: ${this.shard}`);

        } catch (e) {
            console.error('[Valorant] Failed to fetch Region:', e.message);
            this.region = 'eu';
            this.shard = 'eu';
        }
    }

    async fetchAgentData() {
        try {
            const res = await fetch('https://valorant-api.com/v1/agents');
            const json = await res.json();

            if (json && json.data) {
                json.data.forEach(agent => {
                    this.agentMap[agent.uuid] = agent.displayIcon;
                });
                console.log(`[Valorant] Loaded ${Object.keys(this.agentMap).length} agents`);
            }
        } catch (e) {
            console.error('[Valorant] Failed to fetch agent assets');
        }
    }

    async fetchPlayerNames(puuids) {
        if (!puuids || puuids.length === 0) return {};
        try {
            const headers = this.getRemoteHeaders();
            const region = this.region || 'eu';
            const pdUrl = `https://pd.${region}.a.pvp.net/name-service/v2/players`;

            const res = await fetch(pdUrl, {
                method: 'PUT',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(puuids)
            });

            if (!res.ok) throw new Error(`Status ${res.status}`);
            const data = await res.json();

            const nameMap = {};
            if (data) {
                data.forEach(p => {
                    if (p.GameName && p.TagLine) {
                        nameMap[p.Subject] = `${p.GameName}#${p.TagLine}`;
                    }
                });
            }
            return nameMap;
        } catch (e) {
            console.log('[Valorant] Failed to fetch player names:', e.message);
            return {};
        }
    }

    async getMatchPlayers() {
        if (!this.initialized) return [];

        let loopState = null;
        try {
            const presences = await this.request('/chat/v4/presences');
            const myPresence = presences.data.presences.find(p => p.puuid === this.puuid);
            if (myPresence && myPresence.private) {
                const privateData = JSON.parse(Buffer.from(myPresence.private, 'base64').toString());
                if (privateData.sessionLoopState) loopState = privateData.sessionLoopState;
            }
        } catch (e) { }

        const extractPlayers = (resData, source) => {
            if (source === 'CORE') {
                return resData.Players.map(p => ({ puuid: p.Subject, agentId: p.CharacterID }));
            }
            if (source === 'PRE') {
                return resData.AllyTeam.Players.map(p => ({ puuid: p.Subject, agentId: p.CharacterID }));
            }
            if (source === 'PARTY') {
                return resData.Members.map(m => ({ puuid: m.Subject, agentId: m.CharacterID }));
            }
            return [];
        };

        if (loopState === 'INGAME') {
            const data = await this._getCoreGameData();
            if (data) return extractPlayers(data, 'CORE');
        } else if (loopState === 'PREGAME') {
            const data = await this._getPreGameData();
            if (data) return extractPlayers(data, 'PRE');
        } else if (loopState === 'MENUS') {
            const data = await this._getPartyData();
            if (data) return extractPlayers(data, 'PARTY');
        }

        const core = await this._getCoreGameData();
        if (core) return extractPlayers(core, 'CORE');

        const pre = await this._getPreGameData();
        if (pre) return extractPlayers(pre, 'PRE');

        const party = await this._getPartyData();
        if (party) return extractPlayers(party, 'PARTY');

        return [];
    }

    async fetchWithRetry(url) {
        let headers = this.getRemoteHeaders();
        let res = await fetch(url, { headers });

        if (res.status === 401 || res.status === 403) {
            console.log('[Valorant] Token expired for remote request. Refreshing...');
            await this.fetchPUUID();
            headers = this.getRemoteHeaders();
            res = await fetch(url, { headers });
        }

        if (!res.ok) throw new Error(`Status ${res.status}`);
        return await res.json();
    }

    async _getCoreGameData() {
        try {
            const res = await this.request(`/core-game/v1/players/${this.puuid}`);
            const matchId = res.data.MatchID;
            if (matchId) {
                const matchRes = await this.request(`/core-game/v1/matches/${matchId}`);
                return matchRes.data;
            }
        } catch (e) {
            try {
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;

                const json = await this.fetchWithRetry(`${baseUrl}/core-game/v1/players/${this.puuid}`);
                const matchId = json.MatchID;

                if (matchId) {
                    return await this.fetchWithRetry(`${baseUrl}/core-game/v1/matches/${matchId}`);
                }
            } catch (re) { }
        }
        return null;
    }

    async _getPreGameData() {
        try {
            const res = await this.request(`/pre-game/v1/players/${this.puuid}`);
            const matchId = res.data.MatchID;
            if (matchId) {
                const matchRes = await this.request(`/pre-game/v1/matches/${matchId}`);
                return matchRes.data;
            }
        } catch (e) {
            try {
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;

                const json = await this.fetchWithRetry(`${baseUrl}/pre-game/v1/players/${this.puuid}`);
                const matchId = json.MatchID;

                if (matchId) {
                    return await this.fetchWithRetry(`${baseUrl}/pre-game/v1/matches/${matchId}`);
                }
            } catch (re) { }
        }
        return null;
    }

    async _getPartyData() {
        try {
            const playerRes = await this.request(`/parties/v1/players/${this.puuid}`);
            const partyId = playerRes.data.PartyID;
            if (partyId) {
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;
                const remoteUrl = `${baseUrl}/parties/v1/parties/${partyId}`;

                return await this.fetchWithRetry(remoteUrl);
            }
        } catch (e) { }
        return null;
    }

    async getLocalPlayerAgent() {
        if (!this.initialized || !this.client || !this.puuid) {
            return null;
        }

        let loopState = null;
        try {
            const presences = await this.request('/chat/v4/presences');
            const myPresence = presences.data.presences.find(p => p.puuid === this.puuid);
            if (myPresence && myPresence.private) {
                const privateData = JSON.parse(Buffer.from(myPresence.private, 'base64').toString());
                if (privateData.sessionLoopState) {
                    loopState = privateData.sessionLoopState;
                }
            }
        } catch (e) {
        }

        if (loopState === 'INGAME') {
            return await this.checkCoreGame();
        } else if (loopState === 'PREGAME') {
            return await this.checkPreGame();
        } else if (loopState === 'MENUS') {
            return await this.checkParty();
        }

        const coreAgent = await this.checkCoreGame();
        if (coreAgent) return coreAgent;

        const preAgent = await this.checkPreGame();
        if (preAgent) return preAgent;

        return await this.checkParty();
    }

    async checkCoreGame() {
        try {
            const res = await this.request(`/core-game/v1/players/${this.puuid}`);
            const matchId = res.data.MatchID;
            if (matchId) {
                const matchRes = await this.request(`/core-game/v1/matches/${matchId}`);
                const player = matchRes.data.Players.find(p => p.Subject === this.puuid);
                if (player) {
                    return player.CharacterID;
                }
            }
        } catch (e) {
            try {
                const headers = this.getRemoteHeaders();
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;

                const res = await fetch(`${baseUrl}/core-game/v1/players/${this.puuid}`, { headers });
                if (!res.ok) throw new Error();
                const json = await res.json();

                const matchId = json.MatchID;
                if (matchId) {
                    const matchRes = await fetch(`${baseUrl}/core-game/v1/matches/${matchId}`, { headers });
                    if (!matchRes.ok) throw new Error();
                    const matchData = await matchRes.json();

                    const player = matchData.Players.find(p => p.Subject === this.puuid);
                    if (player) {
                        return player.CharacterID;
                    }
                }
            } catch (remoteErr) {
            }
        }
        return null;
    }

    async checkPreGame() {
        try {
            const res = await this.request(`/pre-game/v1/players/${this.puuid}`);
            const matchId = res.data.MatchID;
            if (matchId) {
                const matchRes = await this.request(`/pre-game/v1/matches/${matchId}`);
                const player = matchRes.data.AllyTeam.Players.find(p => p.Subject === this.puuid);
                if (player) return player.CharacterID;
            }
        } catch (e) {
            try {
                const headers = this.getRemoteHeaders();
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;

                const res = await fetch(`${baseUrl}/pre-game/v1/players/${this.puuid}`, { headers });
                if (!res.ok) throw new Error();
                const json = await res.json();

                const matchId = json.MatchID;
                if (matchId) {
                    const matchRes = await fetch(`${baseUrl}/pre-game/v1/matches/${matchId}`, { headers });
                    if (!matchRes.ok) throw new Error();
                    const matchData = await matchRes.json();
                    const player = matchData.AllyTeam.Players.find(p => p.Subject === this.puuid);
                    if (player) {
                        return player.CharacterID;
                    }
                }
            } catch (remoteErr) {
            }
        }
        return null;
    }

    getRemoteHeaders() {
        return {
            'Authorization': `Bearer ${this.accessToken}`,
            'X-Riot-Entitlements-JWT': this.entitlements,
            'X-Riot-ClientVersion': this.clientVersion,
            'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
        };
    }

    async checkParty(retry = true) {
        try {
            let partyId = null;

            try {
                const presences = await this.request('/chat/v4/presences');
                const myPresence = presences.data.presences.find(p => p.puuid === this.puuid);
                if (myPresence && myPresence.private) {
                    const privateData = JSON.parse(Buffer.from(myPresence.private, 'base64').toString());
                    if (privateData.partyPresenceData) {
                        partyId = privateData.partyPresenceData.partyId;
                    }
                }
            } catch (e) { }

            if (!partyId) {
                try {
                    const playerRes = await this.request(`/parties/v1/players/${this.puuid}`);
                    partyId = playerRes.data.PartyID;
                } catch (e) { }
            }

            if (partyId) {
                const baseUrl = this.glzUrl || `https://glz-${this.region}-1.${this.shard}.a.pvp.net`;
                const remoteUrl = `${baseUrl}/parties/v1/parties/${partyId}`;

                const headers = {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'X-Riot-Entitlements-JWT': this.entitlements,
                    'X-Riot-ClientVersion': this.clientVersion,
                    'X-Riot-ClientPlatform': 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9'
                };

                const partyRes = await fetch(remoteUrl, { headers });
                if (!partyRes.ok) throw new Error({ response: { status: partyRes.status } });
                const partyData = await partyRes.json();

                const member = partyData.Members.find(m => m.Subject === this.puuid);
                if (member) {
                    if (member.CharacterID) {
                        return member.CharacterID;
                    }
                }
            }
        } catch (e) {
            // e here might be a generic Error or our custom structure
            const status = e.response ? e.response.status : null;

            if (retry && (status === 400 || status === 401 || status === 403)) {
                console.log('[Valorant] Token might be expired. Refreshing tokens and retrying...');
                await this.fetchPUUID();
                return this.checkParty(false);
            }
        }
        return null;
    }

    async getAgentUrlOutput(characterId) {
        if (!characterId) return null;
        if (characterId === '00000000-0000-0000-0000-000000000000') return null;
        return this.agentMap[characterId.toLowerCase()] || null;
    }
}

module.exports = new ValorantClient();
