const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Estado do Jogo (Armazenamento em memória)
// Em produção real, considerar Redis para escalar
const players = {};

io.on('connection', (socket) => {
    console.log(`Jogador conectado: ${socket.id}`);

    // Cria o estado inicial do jogador
    players[socket.id] = {
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        id: socket.id
    };

    // 1. Envia a lista de jogadores atuais para o novo jogador
    socket.emit('currentPlayers', players);

    // 2. Avisa os outros jogadores que alguém entrou
    socket.broadcast.emit('newPlayer', players[socket.id]);

    // 3. Gerencia movimento
    socket.on('playerMove', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = data.x;
            players[socket.id].y = data.y;
            players[socket.id].z = data.z;
            players[socket.id].rotation = data.rotation; // Rotação do corpo (Y-axis)

            // Otimização: Em jogos complexos, usaríamos buffers binários ou compressão.
            // Aqui, fazemos broadcast direto para simplificar.
            socket.broadcast.emit('playerMoved', {
                id: socket.id,
                x: data.x,
                y: data.y,
                z: data.z,
                rotation: data.rotation
            });
        }
    });

    // 4. Gerencia desconexão
    socket.on('disconnect', () => {
        console.log(`Jogador desconectou: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnect', socket.id);
    });
});

// Porta dinâmica para o Railway ou 3000 local
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Servidor rodando na porta: ${PORT}`);
});
