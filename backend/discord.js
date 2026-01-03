const RPC = require('discord-rpc');
const EventEmitter = require('events');

class DiscordClient extends EventEmitter {
    constructor() {
        super();
        const path = require('path');
        const fs = require('fs');

        // Locate config in AppData
        const APPDATA = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share");
        const DATA_DIR = path.join(APPDATA, 'ValorantOverlay');
        const configPath = path.join(DATA_DIR, 'config.json');

        try {
            if (!fs.existsSync(configPath)) {
                // If config doesn't exist, we just remain unconnected until user sets it up via Dashboard
                this.config = {};
                console.log('[INFO] No config found in AppData. Waiting for setup via Dashboard.');
            } else {
                const rawConfig = fs.readFileSync(configPath, 'utf8');
                this.config = JSON.parse(rawConfig);
            }
        } catch (e) {
            console.error('[ERROR] Failed to load config.json from AppData', e);
            this.config = {};
        }

        this.clientId = this.config.clientId;
        this.clientSecret = this.config.clientSecret;

        this.rpc = new RPC.Client({ transport: 'ipc' });
        this.currentChannelId = null;
        this.connected = false;

        this.speakingUsers = new Set();

        this.rpc.on('ready', () => {
            console.log(`Discord RPC Connected as ${this.rpc.user.username}`);
            this.connected = true;
            this.rpc.subscribe('VOICE_CHANNEL_SELECT').catch(e => console.error('[Discord] Subscription Error:', e));
            this.getInitialVoiceState();
        });

        this.rpc.transport.on('close', () => {
            console.log('[Discord] RPC Connection Closed. Reconnecting in 5s...');
            this.connected = false;
            setTimeout(() => this.connect(), 5000);
        });

        this.rpc.on('VOICE_CHANNEL_SELECT', (data) => {
            console.log('Channel Selected', data);
            if (data && data.channel_id) {
                this.subscribeToVoiceEvents(data.channel_id);
            }
            this.emit('update');
        });



        this.rpc.on('SPEAKING_START', (data) => {
            if (data && data.user_id) {
                this.speakingUsers.add(data.user_id);
                this.emit('speaking', { userId: data.user_id, isSpeaking: true });
            }
        });

        this.rpc.on('SPEAKING_STOP', (data) => {
            if (data && data.user_id) {
                this.speakingUsers.delete(data.user_id);
                this.emit('speaking', { userId: data.user_id, isSpeaking: false });
            }
        });
    }

    isUserSpeaking(userId) {
        return this.speakingUsers.has(userId);
    }

    async subscribeToVoiceEvents(channelId) {
        // Prevent re-subscribing to the same channel unless we just reconnected
        if (this.currentChannelId === channelId && this.connected) return;
        this.currentChannelId = channelId;

        const args = { channel_id: String(channelId) };

        try {
            this.rpc.subscribe('SPEAKING_START', args).catch(e => { });
            this.rpc.subscribe('SPEAKING_STOP', args).catch(e => { });
            this.rpc.subscribe('VOICE_STATE_CREATE', args).catch(e => { });
            this.rpc.subscribe('VOICE_STATE_DELETE', args).catch(e => { });

            console.log('[Discord] Subscribed to voice events.');
        } catch (e) {
            // console.error('[Discord] Subscription Warning:', e);
        }
    }

    async getInitialVoiceState(retryCount = 0) {
        try {
            const channel = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL');
            if (channel && channel.id) {
                this.subscribeToVoiceEvents(channel.id);
                this.emit('update');
            }
        } catch (e) {
            console.log(`[Discord] Initial voice state check failed (Attempt ${retryCount + 1}). Retrying in 1s...`);
            if (retryCount < 10) {
                setTimeout(() => this.getInitialVoiceState(retryCount + 1), 1000);
            }
        }
    }

    async connect() {
        console.log('Connecting to Discord RPC...');
        try {
            // Standard IPC connection. Needs the redirectUri to be set in the dev portal to work properly!
            await this.rpc.login({
                clientId: this.clientId,
                clientSecret: this.clientSecret,
                scopes: ['rpc', 'rpc.voice.read', 'rpc.activities.write'],
                redirectUri: this.config.redirectUri
            });
        } catch (e) {
            console.error('\n[ERROR] Discord RPC Connection Failed!');
            console.error('Possible causes:');
            console.error('1. "http://localhost" is NOT added to Redirects in Discord Dev Portal.');
            console.error('2. Application ID or Secret is incorrect.');
            console.error('3. Discord App is not running.');
            console.error('Original Error:', e.message || e);
        }
    }

    async getVoiceChannel() {
        try {
            const channel = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL');
            if (!channel) return null;
            return channel.voice_states;
        } catch (e) {
            return null;
        }
    }

    async getChannelUsers() {
        try {
            const channel = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL');
            if (!channel) return [];
            return channel.voice_states;
        } catch (e) {
            return [];
        }
    }
}

module.exports = new DiscordClient();
