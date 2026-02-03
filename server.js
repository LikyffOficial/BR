const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

// --- DADOS EM MEMÓRIA (Em produção, use Banco de Dados) ---
const users = {}; // { username: password }
const rooms = {}; // { roomId: { players: {}, mapSize: 500 } }

io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);
    
    let currentRoom = null;
    let currentUser = null;

    // --- AUTENTICAÇÃO ---
    socket.on('register', ({ user, pass }) => {
        if (users[user]) {
            socket.emit('authError', 'Usuário já existe.');
        } else {
            users[user] = pass;
            socket.emit('authSuccess', user);
            currentUser = user;
        }
    });

    socket.on('login', ({ user, pass }) => {
        if (users[user] && users[user] === pass) {
            currentUser = user;
            socket.emit('authSuccess', user);
            // Envia lista de salas disponíveis
            socket.emit('roomList', getPublicRooms());
        } else {
            socket.emit('authError', 'Credenciais inválidas.');
        }
    });

    // --- SISTEMA DE SALAS ---
    socket.on('createRoom', (roomName) => {
        if (!currentUser) return;
        
        const roomId = roomName || `Room_${Math.floor(Math.random() * 1000)}`;
        if (rooms[roomId]) {
            socket.emit('roomError', 'Sala já existe.');
            return;
        }

        rooms[roomId] = { players: {} }; // Estado da sala
        joinRoom(socket, roomId);
    });

    socket.on('joinRoom', (roomId) => {
        if (rooms[roomId]) {
            joinRoom(socket, roomId);
        }
    });

    socket.on('refreshRooms', () => {
        socket.emit('roomList', getPublicRooms());
    });

    // --- LÓGICA DE JOGO (ISOLADA POR SALA) ---
    socket.on('playerMove', (data) => {
        if (currentRoom && rooms[currentRoom] && rooms[currentRoom].players[socket.id]) {
            const p = rooms[currentRoom].players[socket.id];
            p.x = data.x;
            p.y = data.y;
            p.z = data.z;
            p.rotation = data.rotation;
            
            // Envia APENAS para quem está na mesma sala (menos para quem enviou)
            socket.to(currentRoom).emit('playerMoved', { id: socket.id, ...data });
        }
    });

    socket.on('disconnect', () => {
        if (currentRoom && rooms[currentRoom]) {
            delete rooms[currentRoom].players[socket.id];
            io.to(currentRoom).emit('playerDisconnect', socket.id);
            
            // Se sala vazia, deletar (opcional)
            if (Object.keys(rooms[currentRoom].players).length === 0) {
                delete rooms[currentRoom];
            }
        }
    });

    // Função Auxiliar de Join
    function joinRoom(socket, roomId) {
        currentRoom = roomId;
        socket.join(roomId);

        // Cria estado inicial do jogador na sala
        const startX = (Math.random() - 0.5) * 50;
        const startZ = (Math.random() - 0.5) * 50;
        
        rooms[roomId].players[socket.id] = {
            id: socket.id,
            username: currentUser,
            x: startX, y: 10, z: startZ, rotation: 0
        };

        socket.emit('joinSuccess', { 
            roomId, 
            initialPos: rooms[roomId].players[socket.id],
            players: rooms[roomId].players 
        });

        socket.to(roomId).emit('newPlayer', rooms[roomId].players[socket.id]);
    }
});

function getPublicRooms() {
    // Retorna array de salas { id, count }
    return Object.keys(rooms).map(id => ({
        id: id,
        count: Object.keys(rooms[id].players).length
    }));
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Servidor na porta ${PORT}`));
