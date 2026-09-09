const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

function createRoom(roomCode) {
  return {
    code: roomCode,
    players: [],
    board: Array(9).fill(null),
    currentTurn: 'X',
    status: 'waiting',
    winner: null,
    winLine: [],
    matchHistory: [],
    createdAt: Date.now()
  };
}

function checkWinner(board) {
  const lines = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  for (const [a,b,c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a,b,c] };
    }
  }
  if (board.every(cell => cell !== null)) return { winner: 'draw', line: [] };
  return null;
}

function getRoomState(room) {
  return {
    code: room.code,
    players: room.players.map(p => ({
      name: p.name,
      symbol: p.symbol,
      score: p.score,
      connected: p.connected
    })),
    board: room.board,
    currentTurn: room.currentTurn,
    status: room.status,
    winner: room.winner,
    winLine: room.winLine || [],
    matchHistory: room.matchHistory
  };
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[code]);
  return code;
}

// ─── BOT AI ─────────────────────────────────────────────────────────────────

function minimax(board, isMaximizing, botSymbol, humanSymbol, depth = 0) {
  const result = checkWinner(board);
  if (result) {
    if (result.winner === botSymbol)   return 10 - depth;
    if (result.winner === humanSymbol) return depth - 10;
    return 0;
  }
  if (isMaximizing) {
    let best = -Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = botSymbol;
        best = Math.max(best, minimax(board, false, botSymbol, humanSymbol, depth + 1));
        board[i] = null;
      }
    }
    return best;
  } else {
    let best = Infinity;
    for (let i = 0; i < 9; i++) {
      if (!board[i]) {
        board[i] = humanSymbol;
        best = Math.min(best, minimax(board, true, botSymbol, humanSymbol, depth + 1));
        board[i] = null;
      }
    }
    return best;
  }
}

// Perfect minimax move
function getBestMove(board, botSymbol, humanSymbol) {
  let bestScore = -Infinity, bestMove = -1;
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = botSymbol;
      const score = minimax(board, false, botSymbol, humanSymbol);
      board[i] = null;
      if (score > bestScore) { bestScore = score; bestMove = i; }
    }
  }
  return bestMove;
}

// Random empty cell
function getRandomMove(board) {
  const empty = board.map((v,i) => v === null ? i : -1).filter(i => i !== -1);
  return empty[Math.floor(Math.random() * empty.length)];
}

// Block human win if possible, else random
function getDefensiveMove(board, botSymbol, humanSymbol) {
  // Try to block
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = humanSymbol;
      const r = checkWinner(board);
      board[i] = null;
      if (r && r.winner === humanSymbol) return i;
    }
  }
  return getRandomMove(board);
}

// Win if can, block if must, else random
function getNormalMove(board, botSymbol, humanSymbol) {
  // Try to win
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = botSymbol;
      const r = checkWinner(board);
      board[i] = null;
      if (r && r.winner === botSymbol) return i;
    }
  }
  // Try to block
  for (let i = 0; i < 9; i++) {
    if (!board[i]) {
      board[i] = humanSymbol;
      const r = checkWinner(board);
      board[i] = null;
      if (r && r.winner === humanSymbol) return i;
    }
  }
  return getRandomMove(board);
}

// Pro: minimax but 30% chance of mistake
function getProMove(board, botSymbol, humanSymbol) {
  if (Math.random() < 0.3) return getNormalMove(board, botSymbol, humanSymbol);
  return getBestMove(board, botSymbol, humanSymbol);
}

/*
  Bot difficulty levels:
  baby   — pure random (😴 loses to everyone)
  noob   — blocks only if losing, else random
  normal — wins if can, blocks if must, else random
  pro    — minimax with 30% mistake chance
  ultra  — perfect minimax (unbeatable)
  chaos  — totally random (fun chaos)
  clown  — deliberately picks worst move (tries to lose)
*/
function getBotMove(board, botSymbol, humanSymbol, level = 'normal') {
  const b = [...board];
  switch (level) {
    case 'baby':
      return getRandomMove(b);

    case 'noob':
      return getDefensiveMove(b, botSymbol, humanSymbol);

    case 'normal':
      return getNormalMove(b, botSymbol, humanSymbol);

    case 'pro':
      return getProMove(b, botSymbol, humanSymbol);

    case 'ultra':
      return getBestMove(b, botSymbol, humanSymbol);

    case 'chaos':
      return getRandomMove(b);

    case 'clown': {
      // Pick the WORST move (minimax but inverted — tries to lose)
      let worstScore = Infinity, worstMove = -1;
      for (let i = 0; i < 9; i++) {
        if (!b[i]) {
          b[i] = botSymbol;
          const score = minimax(b, false, botSymbol, humanSymbol);
          b[i] = null;
          if (score < worstScore) { worstScore = score; worstMove = i; }
        }
      }
      return worstMove !== -1 ? worstMove : getRandomMove(b);
    }

    default:
      return getNormalMove(b, botSymbol, humanSymbol);
  }
}

// Bot name by level
function getBotName(level) {
  const names = {
    baby:   '🍼 Baby Bot',
    noob:   '🥔 Noob Bot',
    normal: '🧠 Normal Bot',
    pro:    '😤 Pro Bot',
    ultra:  '💀 Ultra Pro Max',
    chaos:  '🌀 Chaos Bot',
    clown:  '🤡 Clown Bot',
  };
  return names[level] || '🤖 Bot';
}

// Bot delay by level (smarter bots "think" longer)
function getBotDelay(level) {
  const delays = {
    baby:   200,
    noob:   400,
    normal: 600,
    pro:    900,
    ultra:  1100,
    chaos:  300,
    clown:  500,
  };
  return delays[level] || 600;
}

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log('Connected:', socket.id);

  // ── Create Room ──
  socket.on('createRoom', ({ playerName }) => {
    const name = (playerName || 'Player').trim().slice(0, 20);
    const code = generateRoomCode();
    rooms[code] = createRoom(code);
    const room = rooms[code];
    const player = { id: socket.id, name, symbol: 'X', score: 0, connected: true };
    room.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;
    socket.emit('roomCreated', { roomCode: code, symbol: 'X', playerName: name });
    socket.emit('gameState', getRoomState(room));
    console.log(`Room ${code} created by ${name}`);
  });

  // ── Join Room ──
  socket.on('joinRoom', ({ roomCode, playerName }) => {
    const code = (roomCode || '').trim().toUpperCase();
    const name = (playerName || 'Player').trim().slice(0, 20);

    if (!rooms[code]) {
      socket.emit('error', { message: 'Room not found. Check the code and try again.' });
      return;
    }
    const room = rooms[code];

    const existing = room.players.find(p => p.name === name);
    if (existing && !existing.connected) {
      existing.id = socket.id;
      existing.connected = true;
      socket.join(code);
      socket.roomCode = code;
      socket.playerName = name;
      socket.emit('roomJoined', { roomCode: code, symbol: existing.symbol, playerName: name, rejoined: true });
      socket.emit('gameState', getRoomState(room));
      io.to(code).emit('playerRejoined', { name, symbol: existing.symbol });
      io.to(code).emit('gameState', getRoomState(room));
      io.to(code).emit('chatMessage', { system: true, text: `${name} reconnected.`, ts: Date.now() });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit('error', { message: 'Room is full. Please try a different room.' });
      return;
    }
    if (room.players.find(p => p.name === name)) {
      socket.emit('error', { message: 'That name is taken in this room. Choose another.' });
      return;
    }

    const player = { id: socket.id, name, symbol: 'O', score: 0, connected: true };
    room.players.push(player);
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;
    room.status = 'playing';

    socket.emit('roomJoined', { roomCode: code, symbol: 'O', playerName: name });
    io.to(code).emit('gameState', getRoomState(room));
    io.to(code).emit('chatMessage', {
      system: true,
      text: `${name} joined! Game starts now. ${room.players[0].name} (X) goes first.`,
      ts: Date.now()
    });
    console.log(`${name} joined room ${code}`);
  });

  // ── Make Move (Multiplayer) ──
  socket.on('makeMove', ({ index }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (room.isBot) return;
    if (room.status !== 'playing') return;
    if (room.board[index] !== null) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.symbol !== room.currentTurn) return;

    room.board[index] = player.symbol;
    const result = checkWinner(room.board);

    if (result) {
      room.status = 'finished';
      room.winner = result.winner;
      room.winLine = result.line;
      if (result.winner !== 'draw') {
        const winner = room.players.find(p => p.symbol === result.winner);
        if (winner) winner.score += 1;
      }
      room.matchHistory.unshift({
        id: uuidv4(),
        winner: result.winner === 'draw' ? 'Draw' : room.players.find(p => p.symbol === result.winner)?.name,
        board: [...room.board],
        ts: Date.now()
      });
      if (room.matchHistory.length > 20) room.matchHistory.pop();
    } else {
      room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
    }
    io.to(code).emit('gameState', getRoomState(room));
  });

  // ── Rematch (Multiplayer) ──
  socket.on('requestRematch', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    if (!room.rematchVotes) room.rematchVotes = new Set();
    room.rematchVotes.add(socket.id);

    if (room.rematchVotes.size >= 2) {
      room.board = Array(9).fill(null);
      room.status = 'playing';
      room.winner = null;
      room.winLine = [];
      room.currentTurn = room.currentTurn === 'X' ? 'O' : 'X';
      room.rematchVotes = new Set();
      io.to(code).emit('gameState', getRoomState(room));
      io.to(code).emit('rematchStarted');
      io.to(code).emit('chatMessage', { system: true, text: 'Rematch started!', ts: Date.now() });
    } else {
      io.to(code).emit('rematchRequested', { from: player.name });
    }
  });

  // ── Chat ──
  socket.on('chatMessage', ({ text }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const msg = (text || '').trim().slice(0, 200);
    if (!msg) return;
    const player = rooms[code].players.find(p => p.id === socket.id);
    const name = player ? player.name : 'Unknown';
    io.to(code).emit('chatMessage', { from: name, symbol: player?.symbol, text: msg, ts: Date.now() });
  });

  // ── Typing ──
  socket.on('typing', ({ isTyping }) => {
    const code = socket.roomCode;
    if (!code) return;
    const player = rooms[code]?.players.find(p => p.id === socket.id);
    if (!player) return;
    socket.to(code).emit('opponentTyping', { name: player.name, isTyping });
  });

  // ── Create Bot Room ──
  socket.on('createBotRoom', ({ playerName, botLevel }) => {
    const name  = (playerName || 'Player').trim().slice(0, 20);
    const level = botLevel || 'normal';
    const code  = 'BOT_' + socket.id.slice(0, 8);
    const botName = getBotName(level);

    const room = {
      code,
      isBot: true,
      botLevel: level,
      players: [
        { id: socket.id, name, symbol: 'X', score: 0, connected: true },
        { id: 'BOT', name: botName, symbol: 'O', score: 0, connected: true }
      ],
      board: Array(9).fill(null),
      currentTurn: 'X',
      status: 'playing',
      winner: null,
      winLine: [],
      matchHistory: []
    };
    rooms[code] = room;
    socket.join(code);
    socket.roomCode = code;
    socket.playerName = name;
    socket.emit('roomJoined', { roomCode: code, symbol: 'X', playerName: name, isBot: true });
    socket.emit('gameState', getRoomState(room));

    const levelTaunts = {
      baby:   `${botName} aa gaya! Isse haara nahi toh game chhod de 😂`,
      noob:   `${botName} ready hai. Tera pehla match hai kya? 🥔`,
      normal: `${botName} se khel raha hai. All the best! 🧠`,
      pro:    `${botName} se panga? Soch le ek baar 😤`,
      ultra:  `${botName} se lad raha hai?? BHAI MAT KAR YE 💀`,
      chaos:  `${botName} aaya! Kuch bhi ho sakta hai 🌀`,
      clown:  `${botName} aaya! Ye khud haarna chahta hai... ya nahi? 🤡`,
    };
    socket.emit('chatMessage', {
      system: true,
      text: levelTaunts[level] || `Game vs ${botName} started! ${name} (X) goes first.`,
      ts: Date.now()
    });
    console.log(`Bot room created for ${name} vs ${botName} (level: ${level})`);
  });

  // ── Bot Move ──
  socket.on('makeBotMove', ({ index }) => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (!room.isBot) return;
    if (room.status !== 'playing') return;
    if (room.board[index] !== null) return;
    if (room.currentTurn !== 'X') return;

    // Human move
    room.board[index] = 'X';
    let result = checkWinner(room.board);

    if (result) {
      room.status = 'finished';
      room.winner = result.winner;
      room.winLine = result.line;
      if (result.winner === 'X') room.players[0].score += 1;
      else if (result.winner === 'O') room.players[1].score += 1;
      room.matchHistory.unshift({
        id: uuidv4(),
        winner: result.winner === 'draw' ? 'Draw' : result.winner === 'X' ? room.players[0].name : room.players[1].name,
        board: [...room.board],
        ts: Date.now()
      });
      socket.emit('gameState', getRoomState(room));
      return;
    }

    room.currentTurn = 'O';
    socket.emit('gameState', getRoomState(room));

    const delay = getBotDelay(room.botLevel || 'normal');

    setTimeout(() => {
      if (room.status !== 'playing') return;

      const botMove = getBotMove([...room.board], 'O', 'X', room.botLevel || 'normal');
      room.board[botMove] = 'O';
      result = checkWinner(room.board);

      if (result) {
        room.status = 'finished';
        room.winner = result.winner;
        room.winLine = result.line;
        if (result.winner === 'X') room.players[0].score += 1;
        else if (result.winner === 'O') room.players[1].score += 1;
        room.matchHistory.unshift({
          id: uuidv4(),
          winner: result.winner === 'draw' ? 'Draw' : result.winner === 'X' ? room.players[0].name : room.players[1].name,
          board: [...room.board],
          ts: Date.now()
        });
      } else {
        room.currentTurn = 'X';
      }
      socket.emit('gameState', getRoomState(room));
    }, delay);
  });

  // ── Bot Rematch ──
  socket.on('requestBotRematch', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    if (!room.isBot) return;
    room.board = Array(9).fill(null);
    room.status = 'playing';
    room.winner = null;
    room.winLine = [];
    room.currentTurn = 'X';
    socket.emit('gameState', getRoomState(room));
    socket.emit('rematchStarted');
    socket.emit('chatMessage', { system: true, text: 'New game started! You go first.', ts: Date.now() });
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];

    if (room.isBot) {
      delete rooms[code];
      return;
    }

    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.connected = false;
      io.to(code).emit('playerDisconnected', { name: player.name, symbol: player.symbol });
      io.to(code).emit('gameState', getRoomState(room));
      io.to(code).emit('chatMessage', { system: true, text: `${player.name} disconnected.`, ts: Date.now() });

      setTimeout(() => {
        if (rooms[code] && room.players.every(p => !p.connected)) {
          delete rooms[code];
          console.log(`Room ${code} cleaned up`);
        }
      }, 10 * 60 * 1000);
    }
    console.log('Disconnected:', socket.id);
  });
});

app.get('/health', (_, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
