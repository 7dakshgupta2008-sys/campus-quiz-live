const { io } = require('socket.io-client');
const s = io('http://localhost:3000');
s.on('connect', () => {
  s.emit('host:join');
});
s.on('host:welcome', (data) => {
  console.log('Host connected. Room code:', data.roomCode);
  setTimeout(() => {
    console.log('Starting quiz...');
    s.emit('host:start');
  }, 6000);
});
setTimeout(() => process.exit(0), 40000);
