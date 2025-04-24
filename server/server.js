const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let games = {}; // Store game states by room ID

// Serve static files (optional, if you want to serve the frontend from the server)
app.use(express.static('../'));

// Handle socket connections
io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Join a game room
    socket.on('joinGame', (roomId) => {
        socket.join(roomId);
        if (!games[roomId]) {
            games[roomId] = { players: [], state: null };
        } else if (games[roomId].players.length == 2) {
            socket.emit("roomFull");
            socket.leave();
            return;
        }
        games[roomId].players.push(socket.id);

        // Notify players in the room
        io.to(roomId).emit('playerJoined', games[roomId].players);

        // Start the game if two players are connected
        if (games[roomId].players.length === 2) {
            io.to(roomId).emit('startGame', { state: games[roomId].state });
        }
    });

    // Handle moves
    socket.on('makeMove', ({ roomId, gameState }) => {
        games[roomId].state = gameState; // Update game state
        socket.to(roomId).emit('updateGame', gameState); // Notify the other player
    });

    socket.on('select', ({ roomId, selection }) => {
        io.to(roomId).emit('playerSelected', selection);
    });

    socket.on('playerLeave', roomId => {
        socket.leave(roomId);
        const index = games[roomId].players.indexOf(socket.id);
        if (index !== -1) {
            games[roomId].players.splice(index, 1);
            io.to(roomId).emit('playerLeft');
            if (games[roomId].players.length === 0) {
                delete games[roomId]; // Clean up empty games
            }
        }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('A user disconnected:', socket.id);
        for (const roomId in games) {
            const index = games[roomId].players.indexOf(socket.id);
            if (index !== -1) {
                games[roomId].players.splice(index, 1);
                io.to(roomId).emit('playerLeft');
                if (games[roomId].players.length === 0) {
                    delete games[roomId]; // Clean up empty games
                }
                break;
            }
        }
    });
});

// Start the server
const PORT = 11142;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
