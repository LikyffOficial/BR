const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const users = {}; 
const rooms = {}; 

io.on('connection', (socket) => {
    let currentRoom = null;
    let currentUser = null;

    // --- AUTH (Mantido igual) ---
    socket.on('register', ({ user, pass }) => {
        if (users[user]) socket.emit('authError', 'Usuário já existe.');
        else { users[user] = pass; socket.emit('authSuccess', user); currentUser = user; }
    });
    socket.on('login', ({ user, pass }) => {
        if (users[user] === pass) { currentUser = user; socket.emit('authSuccess', user); socket.emit('roomList', getPublicRooms()); }
        else socket.emit('authError', 'Credenciais inválidas.');
    });

    // --- ROOMS & GAMEPLAY ---
    socket.on('createRoom', (roomName) => {
        if (!currentUser) return;
        const roomId = roomName || `Room_${Math.floor(Math.random() * 1000)}`;
        if (rooms[roomId]) return;
        
        // Inicializa sala com LOOT
        rooms[roomId] = { players: {}, loot: generateLoot() };
        joinRoom(socket, roomId);
    });

    socket.on('joinRoom', (roomId) => { if (rooms[roomId]) joinRoom(socket, roomId); });
    socket.on('refreshRooms', () => socket.emit('roomList', getPublicRooms()));

    // MOVIMENTO
    socket.on('playerMove', (data) => {
        if (currentRoom && rooms[currentRoom]?.players[socket.id]) {
            const p = rooms[currentRoom].players[socket.id];
            // Atualiza posição no server
            Object.assign(p, data);
            socket.to(currentRoom).emit('playerMoved', { id: socket.id, ...data });
        }
    });

    // TIRO
    socket.on('playerShoot', () => {
        // Apenas avisa os outros para tocarem o som e verem o efeito
        socket.to(currentRoom).emit('remoteShoot', socket.id);
    });

    // DANO
    socket.on('playerHit', (targetId) => {
        if (currentRoom && rooms[currentRoom]?.players[targetId]) {
            const target = rooms[currentRoom].players[targetId];
            target.hp -= 10; // Dano fixo por enquanto
            
            io.to(currentRoom).emit('updateHealth', { id: targetId, hp: target.hp });

            if (target.hp <= 0) {
                // Matar jogador
                target.hp = 100;
                target.x = 0; target.y = 10; target.z = 0; // Respawn
                io.to(currentRoom).emit('playerRespawn', { id: targetId, x: 0, y: 10, z: 0 });
            }
        }
    });

    // PEGAR ARMA (LOOT)
    socket.on('pickupLoot', (lootId) => {
        if (currentRoom && rooms[currentRoom]) {
            const lootIndex = rooms[currentRoom].loot.findIndex(l => l.id === lootId);
            if (lootIndex !== -1) {
                // Remove do server e avisa a todos
                rooms[currentRoom].loot.splice(lootIndex, 1);
                io.to(currentRoom).emit('lootTaken', lootId);
            }
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[socket.id];
            io.to(currentRoom).emit('playerDisconnect', socket.id);
        }
    });

    function joinRoom(socket, roomId) {
        currentRoom = roomId;
        socket.join(roomId);
        const startX = (Math.random() - 0.5) * 50;
        
        rooms[roomId].players[socket.id] = {
            id: socket.id, username: currentUser,
            x: startX, y: 10, z: 0, rotation: 0, hp: 100
        };

        socket.emit('joinSuccess', { 
            roomId, 
            initialPos: rooms[roomId].players[socket.id],
            players: rooms[roomId].players,
            loot: rooms[roomId].loot
        });
        socket.to(roomId).emit('newPlayer', rooms[roomId].players[socket.id]);
    }
});

function generateLoot() {
    const items = [];
    for (let i = 0; i < 10; i++) {
        items.push({
            id: `loot_${i}_${Date.now()}`,
            x: (Math.random() - 0.5) * 400,
            z: (Math.random() - 0.5) * 400,
            type: 'rifle'
        });
    }
    return items;
}

function getPublicRooms() {
    return Object.keys(rooms).map(id => ({ id, count: Object.keys(rooms[id].players).length }));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
