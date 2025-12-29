# Valorant Discord Overlay

A clean, modern Discord voice overlay for streamers that automatically matches Discord users to their in-game Valorant Agents.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.1.0-green.svg)

## 🚀 Features

- **Auto-Sync**: Automatically detects who is speaking in Discord and links them to their current Valorant Agent locally.
- **Real-Time Updates**: Instantly updates when players lock in an agent or switch voice channels.
- **OBS Ready**: Designed with a transparent background for easy integration as a Browser Source in OBS/Streamlabs.
- **Dashboard**: Includes a configuration dashboard to manually map friends to agents or nicknames.
- **Zero Config Mode**: Works out of the box by pulling your local game data via the Riot Client API.
- **Mock Mode**: Built-in mock data generator for testing the layout without launching the game.

## 🛠️ Installation

### Option 1: Download Executable
1. Download the latest `ValorantOverlay.exe` from the [Releases](https://github.com/vaccie/valoverlay_discord/releases) page.
2. Run the executable. It will create a configuration folder in your `%APPDATA%/ValorantOverlay` directory.

### Option 2: Build from Source
1. Clone the repository:
   ```bash
   git clone https://github.com/vaccie/valoverlay_discord.git
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the application:
   ```bash
   npm start
   ```

## ⚙️ Configuration

1. Launch `ValorantOverlay.exe` (or `npm start`).
2. A dashboard will open at `http://localhost:3000/dashboard.html`.
3. Click on the **⚙️ SETUP** button.
4. Paste your **Discord Client ID** and **Client Secret** (see [Discord Developer Portal](https://discord.com/developers/applications)).
5. Ensure `http://localhost` is added to your Redirects in the Discord Developer Portal.

## 🎥 OBS Setup

1. Add a new **Browser Source** in OBS.
2. Set URL to `http://localhost:3000`.
3. Set Width to `300` and Height to `600` (adjustable based on your need).
4. Check "Refresh browser when scene becomes active".

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check [issues page](https://github.com/vaccie/valoverlay_discord/issues).

## 📝 Disclaimer

This project is not affiliated with Riot Games or Discord. Valorant and Riot Games are trademarks or registered trademarks of Riot Games, Inc.

---

<p align="center">
  Made with ❤️ by vaccie
</p>
