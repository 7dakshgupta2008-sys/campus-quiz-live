const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 3000;
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || path.join(__dirname, 'questions.json');
const QUESTIONS = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Tuned for many simultaneous phone connections on possibly weak wifi
  pingInterval: 10000,
  pingTimeout: 20000,
  maxHttpBufferSize: 1e6
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));

// ---------- Game state (single active session, kept in memory) ----------
const ROOM_CODE = String(Math.floor(1000 + Math.random() * 9000)); // 4-digit code

let hostSocketId = null;
let phase = 'lobby'; // lobby | question | results | ended
let questionIndex = -1;
let questionStartedAt = 0;
let questionTimer = null;

// players keyed by persistent playerId (survives phone reconnects/dropped wifi)
const players = new Map(); // playerId -> { name, score, socketId, answeredThisQuestion, lastAnswerIndex, lastAnswerMs, lastPoints }

function publicPlayerCount() {
  return players.size;
}

function currentQuestion() {
  return QUESTIONS[questionIndex] || null;
}

function leaderboard(limit = 10) {
  return Array.from(players.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(p => ({ name: p.name, score: p.score }));
}

function answerDistribution() {
  const q = currentQuestion();
  if (!q) return [];
  const counts = new Array(q.options.length).fill(0);
  for (const p of players.values()) {
    if (p.answeredThisQuestion && p.lastAnswerIndex !== null && p.lastAnswerIndex !== undefined) {
      counts[p.lastAnswerIndex]++;
    }
  }
  return counts;
}

function answeredCount() {
  let n = 0;
  for (const p of players.values()) if (p.answeredThisQuestion) n++;
  return n;
}

function broadcastLobby() {
  io.emit('lobby:update', { roomCode: ROOM_CODE, playerCount: publicPlayerCount() });
}

function broadcastLiveCount() {
  io.emit('question:liveCount', { answered: answeredCount(), total: publicPlayerCount() });
}

function startQuestion(idx) {
  questionIndex = idx;
  const q = currentQuestion();
  if (!q) {
    endGame();
    return;
  }
  phase = 'question';
  questionStartedAt = Date.now();

  for (const p of players.values()) {
    p.answeredThisQuestion = false;
    p.lastAnswerIndex = null;
    p.lastAnswerMs = null;
    p.lastPoints = 0;
  }

  io.emit('question:show', {
    index: questionIndex,
    total: QUESTIONS.length,
    question: q.question,
    options: q.options,
    duration: q.duration
  });
  broadcastLiveCount();

  clearTimeout(questionTimer);
  questionTimer = setTimeout(() => showResults(), q.duration * 1000 + 300);
}

function showResults() {
  if (phase !== 'question') return;
  clearTimeout(questionTimer);
  phase = 'results';
  const q = currentQuestion();

  // fastest correct answer
  let fastest = null;
  for (const p of players.values()) {
    if (p.lastAnswerIndex === q.correctIndex && p.answeredThisQuestion) {
      if (!fastest || p.lastAnswerMs < fastest.ms) {
        fastest = { name: p.name, ms: p.lastAnswerMs };
      }
    }
  }

  io.emit('results:show', {
    correctIndex: q.correctIndex,
    distribution: answerDistribution(),
    totalPlayers: publicPlayerCount(),
    fastestCorrect: fastest,
    leaderboard: leaderboard(10)
  });

  // send each player their personal result
  for (const [playerId, p] of players.entries()) {
    if (p.socketId) {
      io.to(p.socketId).emit('you:result', {
        correct: p.lastAnswerIndex === q.correctIndex,
        pointsEarned: p.lastPoints,
        totalScore: p.score
      });
    }
  }
}

function endGame() {
  phase = 'ended';
  io.emit('game:end', { leaderboard: leaderboard(20) });
}

function resetGame() {
  phase = 'lobby';
  questionIndex = -1;
  clearTimeout(questionTimer);
  for (const p of players.values()) {
    p.score = 0;
    p.answeredThisQuestion = false;
    p.lastAnswerIndex = null;
    p.lastAnswerMs = null;
    p.lastPoints = 0;
  }
  broadcastLobby();
}

// ---------- Socket handling ----------
io.on('connection', (socket) => {
  socket.on('host:join', async () => {
    hostSocketId = socket.id;
    socket.join('host');
    const joinUrl = getJoinUrl();
    const qrDataUrl = await QRCode.toDataURL(joinUrl, { margin: 1, scale: 6 });
    socket.emit('host:welcome', {
      roomCode: ROOM_CODE,
      joinUrl,
      qrDataUrl,
      phase,
      playerCount: publicPlayerCount()
    });
  });

  socket.on('player:join', ({ name, playerId, roomCode }) => {
    name = String(name || '').trim().slice(0, 24) || 'Player';
    if (String(roomCode).trim() !== ROOM_CODE) {
      socket.emit('player:joinError', { message: 'Wrong room code.' });
      return;
    }
    let pid = playerId;
    let existing = pid && players.has(pid) ? players.get(pid) : null;

    if (existing) {
      // Reconnect: rebind socket, keep score
      existing.socketId = socket.id;
      existing.name = name;
    } else {
      pid = playerId && playerId.length > 0 ? playerId : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      players.set(pid, {
        name,
        score: 0,
        socketId: socket.id,
        answeredThisQuestion: false,
        lastAnswerIndex: null,
        lastAnswerMs: null,
        lastPoints: 0
      });
    }

    socket.data.playerId = pid;
    socket.join('players');

    socket.emit('player:joined', { playerId: pid, name, phase });
    broadcastLobby();
    broadcastLiveCount();

    // If a question is already in progress (rejoin mid-question), send it
    if (phase === 'question') {
      const q = currentQuestion();
      const elapsed = (Date.now() - questionStartedAt) / 1000;
      const remaining = Math.max(0, q.duration - elapsed);
      socket.emit('question:show', {
        index: questionIndex,
        total: QUESTIONS.length,
        question: q.question,
        options: q.options,
        duration: remaining
      });
    }
  });

  socket.on('player:answer', ({ choiceIndex }) => {
    const pid = socket.data.playerId;
    if (!pid || !players.has(pid)) return;
    if (phase !== 'question') return;
    const p = players.get(pid);
    if (p.answeredThisQuestion) return; // one answer per question

    const q = currentQuestion();
    const elapsedMs = Date.now() - questionStartedAt;
    const durationMs = q.duration * 1000;

    p.answeredThisQuestion = true;
    p.lastAnswerIndex = choiceIndex;
    p.lastAnswerMs = elapsedMs;

    const isCorrect = choiceIndex === q.correctIndex;
    let points = 0;
    if (isCorrect) {
      const speedFactor = Math.max(0, (durationMs - elapsedMs) / durationMs);
      points = Math.round(500 + 500 * speedFactor);
    }
    p.lastPoints = points;
    p.score += points;

    socket.emit('player:answerAck', { received: true });
    broadcastLiveCount();

    // End early if everyone connected has answered
    if (answeredCount() >= publicPlayerCount() && publicPlayerCount() > 0) {
      showResults();
    }
  });

  socket.on('host:start', () => {
    if (socket.id !== hostSocketId) return;
    startQuestion(0);
  });

  socket.on('host:next', () => {
    if (socket.id !== hostSocketId) return;
    if (phase === 'question') {
      showResults();
    } else {
      startQuestion(questionIndex + 1);
    }
  });

  socket.on('host:reset', () => {
    if (socket.id !== hostSocketId) return;
    resetGame();
  });

  socket.on('disconnect', () => {
    if (socket.id === hostSocketId) {
      hostSocketId = null;
    }
    // Player disconnects keep their record (score persists) in case phone reconnects.
    // We just update lobby count for anyone still watching.
    broadcastLobby();
    broadcastLiveCount();
  });
});

function getJoinUrl() {
  if (process.env.PUBLIC_URL) {
    return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/?code=${ROOM_CODE}`;
  }
  const nets = os.networkInterfaces();
  let lanIp = null;
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        lanIp = net.address;
      }
    }
  }
  const host = lanIp || 'localhost';
  return `http://${host}:${PORT}/?code=${ROOM_CODE}`;
}

server.listen(PORT, () => {
  console.log(`Quiz server running.`);
  console.log(`Host screen (projector):  http://localhost:${PORT}/host`);
  console.log(`Player join URL for phones: ${getJoinUrl()}`);
  console.log(`Room code: ${ROOM_CODE}`);
});
