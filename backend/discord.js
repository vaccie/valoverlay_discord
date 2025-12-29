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

        this.rpc.on('ready', () => {
            console.log(`Discord RPC Connected as ${this.rpc.user.username}`);
            this.connected = true;
            this.rpc.subscribe('VOICE_CHANNEL_SELECT').catch(console.error);
            this.getInitialVoiceState();
        });

        this.rpc.on('VOICE_CHANNEL_SELECT', (data) => {
            console.log('Channel Selected', data);
            if (data && data.channel_id) {
                this.subscribeToVoiceEvents(data.channel_id);
            }
            this.emit('update');
        });

        // Basic event mapping
        this.rpc.on('VOICE_STATE_UPDATE', (data) => {
            // Failsafe: If user is muted/deafened, force stop speaking
            const vs = data.voice_state || {};
            const isMuted = vs.mute || vs.self_mute || vs.suppress;

            if (isMuted && data.user && data.user.id) {
                this.emit('speaking', { userId: data.user.id, isSpeaking: false });
            }

            this.emit('update');
        });

        this.rpc.on('SPEAKING_START', (data) => {
            this.emit('speaking', { userId: data.user_id, isSpeaking: true });
        });

        this.rpc.on('SPEAKING_STOP', (data) => {
            this.emit('speaking', { userId: data.user_id, isSpeaking: false });
        });
    }

    async subscribeToVoiceEvents(channelId) {
        if (this.currentChannelId === channelId) return;
        this.currentChannelId = channelId;

        console.log(`Subscribing to voice events for channel ${channelId}`);
        const args = { channel_id: channelId };

        try {
            await this.rpc.subscribe('VOICE_STATE_CREATE', args);
            await this.rpc.subscribe('VOICE_STATE_UPDATE', args);
            await this.rpc.subscribe('VOICE_STATE_DELETE', args);
            await this.rpc.subscribe('SPEAKING_START', args);
            await this.rpc.subscribe('SPEAKING_STOP', args);
        } catch (e) {
            console.error('Failed to subscribe to voice events:', e);
        }
    }

    async getInitialVoiceState() {
        try {
            const channel = await this.rpc.request('GET_SELECTED_VOICE_CHANNEL');
            if (channel && channel.id) {
                this.subscribeToVoiceEvents(channel.id);
                this.emit('update');
            }
        } catch (e) {
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
