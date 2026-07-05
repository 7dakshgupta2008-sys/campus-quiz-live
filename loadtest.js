const { io } = require('socket.io-client');

const N = 500;
const URL = 'http://localhost:3000';
let joined = 0, joinErrors = 0, answersAcked = 0, results = 0;
const start = Date.now();

const sockets = [];

for (let i = 0; i < N; i++) {
  const s = io(URL, { transports: ['websocket'] });
  sockets.push(s);

  s.on('connect', () => {
    s.emit('player:join', { name: `Bot${i}`, playerId: '', roomCode: process.argv[2] });
  });

  s.on('player:joined', () => {
    joined++;
  });

  s.on('player:joinError', () => {
    joinErrors++;
  });

  s.on('question:show', () => {
    // simulate human reaction delay 0.2s - 3s
    const delay = 200 + Math.random() * 2800;
    setTimeout(() => {
      s.emit('player:answer', { choiceIndex: Math.floor(Math.random() * 4) });
    }, delay);
  });

  s.on('player:answerAck', () => { answersAcked++; });
  s.on('you:result', () => { results++; });
}

setInterval(() => {
  console.log(`t=${((Date.now()-start)/1000).toFixed(1)}s joined=${joined} joinErrors=${joinErrors} answersAcked=${answersAcked} results=${results}`);
}, 1000);

setTimeout(() => {
  console.log('--- Final ---');
  console.log(`joined=${joined}/${N} joinErrors=${joinErrors} answersAcked=${answersAcked} results=${results}`);
  process.exit(0);
}, 35000);
