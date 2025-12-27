const container = document.getElementById('voice-container');
let users = {};

function connect() {
    const ws = new WebSocket('ws://localhost:3000');

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'state') {
            updateUsers(data.users);
        } else if (data.type === 'speaking') {
            console.log('Received speaking event:', data.userId, data.isSpeaking);
            updateSpeaking(data.userId, data.isSpeaking);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected. Reconnecting...');
        setTimeout(connect, 2000);
    };
}

function updateUsers(userList) {
    if (!userList) return;

    const currentIds = new Set(userList.map(u => u.id));

    for (let id in users) {
        if (!currentIds.has(id)) {
            users[id].element.remove();
            delete users[id];
        }
    }

    userList.forEach(user => {
        let entry = users[user.id];

        const displayImage = user.agentImage ? user.agentImage : user.avatar;

        if (!entry) {
            const el = document.createElement('div');
            el.className = 'voice-user';
            el.dataset.muted = user.isMuted;
            el.dataset.deafened = user.isDeaf;

            el.innerHTML = `
                <img class="avatar" src="${displayImage}">
                <div class="user-info">
                    <span class="username">${user.username}</span>
                    <div class="icons">
                        <div class="icon muted"></div>
                        <div class="icon deafened"></div>
                    </div>
                </div>
            `;
            container.appendChild(el);
            users[user.id] = { element: el, data: user };
        } else {
            const img = entry.element.querySelector('.avatar');
            if (img.src !== displayImage) {
                img.src = displayImage;
            }
            entry.element.dataset.muted = String(user.isMuted);
            entry.element.dataset.deafened = String(user.isDeaf);
        }
    });
}

function updateSpeaking(userId, isSpeaking) {
    if (users[userId]) {
        if (isSpeaking) {
            users[userId].element.classList.add('speaking');
            console.log('Added speaking class to', userId);
        } else {
            users[userId].element.classList.remove('speaking');
            console.log('Removed speaking class from', userId);
        }
    } else {
    }
}

connect();
