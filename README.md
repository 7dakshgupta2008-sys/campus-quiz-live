# Campus Quiz Live

A real-time quiz game built for classroom/orientation events: project questions on a screen, students answer from their phones, and live polls + fastest-answer results show up instantly. Built with Node.js + Socket.io — load-tested at 500 simultaneous connections.

## How it works

- **`/host`** — open this on the laptop connected to the projector. Shows the room code + QR code, then each question, then live results and leaderboard.
- **`/`** (root) — this is what students open on their phones. They type their name + room code (or scan the QR code, which fills the code in automatically) and start answering.
- Answers are scored by **speed** — the faster a correct answer comes in, the more points (500–1000 pts per question). The fastest correct answer each round is called out on the projector.

## Quick start

You need [Node.js](https://nodejs.org) installed (v18+; you have v22 which is fine).

```bash
cd quiz-live
npm install
npm start
```

You'll see something like:

```
Host screen (projector):  http://localhost:3000/host
Player join URL for phones: http://192.168.1.42:3000/?code=4417
Room code: 4417
```

Open the `/host` URL on the projector laptop's browser (fullscreen it — F11). Students on the same WiFi open the printed player URL, or just scan the QR code shown on the `/host` screen.

## Running it on the day (LAN mode — recommended, no internet needed)

This is the simplest and most reliable setup for a classroom:

1. Connect your laptop to the **same WiFi** that students' phones will use (college WiFi or your own hotspot).
2. Run `npm start`. Note the "Player join URL" it prints — it auto-detects your laptop's LAN IP.
3. Open `/host` on the laptop, project it.
4. Tell students to join that WiFi and either scan the QR code or type the URL/room code manually.

**Important:** if your laptop's firewall blocks incoming connections, phones won't be able to reach it.
- **Windows:** when you first run `npm start`, Windows Firewall may prompt "Allow Node.js to communicate on... networks?" → click **Allow**.
- **Mac:** System Settings → Network → Firewall → allow Node.

**Capacity:** Socket.io on a single Node process comfortably handles 400–500 concurrent phone connections — this was load-tested with 500 simulated simultaneous players joining, answering, and receiving results with zero failures. Any laptop from the last 5 years is more than enough; this isn't CPU-heavy.

**College WiFi gotcha:** some campus WiFi networks put every device on an isolated VLAN (client isolation), so phones can't reach your laptop even though they're on the "same" network. If phones can't connect:
- Try your phone's personal hotspot instead, with the laptop connected to it, and everyone else joining that hotspot — works for ~30-50 people but not 500.
- Or use the cloud option below, which sidesteps this entirely.

## Alternative: deploy online (works from anywhere, no LAN issues)

If you'd rather not worry about campus WiFi quirks, deploy it to a free-tier host so students join over the internet instead:

1. Push this folder to a GitHub repo.
2. Sign up at [Render.com](https://render.com) (or Railway.app) → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Once deployed, you'll get a public URL like `https://your-quiz.onrender.com` — use that instead of the LAN address for both `/host` and player join.

Note: free tiers can be slower to "wake up" after inactivity — start it a few minutes before the event.

## Editing the questions

Open `questions.json` and edit freely:

```json
{
  "question": "Which data structure uses LIFO order?",
  "options": ["Queue", "Stack", "Linked List", "Graph"],
  "correctIndex": 1,
  "duration": 15
}
```

- `correctIndex` is 0-based (0 = first option).
- `duration` is in seconds — how long students get to answer.
- Add as many questions as you want; the host screen auto-shows "Question X / total".

## Host controls

- **Start Quiz** — begins question 1.
- **Reveal Answer** — ends the current question early and shows the results/leaderboard (also happens automatically once time runs out, or once everyone connected has answered).
- **Next Question** — advances after results are shown.
- **Reset Game** — wipes all scores and returns to the lobby, in case you want to run it again for a second batch of students.

## Reliability notes

- Player scores are tied to a persistent ID stored in the phone's browser (not the WiFi connection), so if someone's phone briefly drops WiFi and reconnects, they keep their score and can keep playing.
- If the host's laptop needs to refresh the `/host` page mid-game, it's safe — reconnecting picks up the current state.

## Optional: test at scale yourself before the event

Two small helper scripts are included (not needed for the actual event, just for your own confidence-testing beforehand):

```bash
npm install socket.io-client   # one-time, only needed for testing
node hostbot.js                # simulates the host starting the quiz
node loadtest.js <room-code>   # simulates 500 phones joining and answering
```
