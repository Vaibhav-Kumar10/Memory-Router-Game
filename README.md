# Memory Router 🔴 Network Sequence Game

A cyberpunk-themed browser memory puzzle game. Memorize the sequence. Route the data. Stay online.

## 🚀 Quick Start

```bash
cd memory-router
npm start
# → Open http://localhost:5500
```

Or simply open `index.html` directly in your browser — it works purely offline.

## 🎮 How to Play

1. Press **INITIALIZE** to start
2. Watch the sequence of network codes appear one-by-one
3. After they disappear, **type the sequence** back in the input field (separated by spaces)
4. Press **Enter** or **SUBMIT**
5. Correct → next level, wrong → game over!

## ⚙️ Game Modes

| Mode | Description |
|------|-------------|
| **Normal** | Standard gameplay |
| **Strict** | Instant fail on any wrong character |
| **Speed** | Sequence grows faster, timer shorter |
| **Practice** | No game over — learn freely |

## 🔧 Settings

- **Sequence Type**: Numbers / Alpha / Hex / Mixed
- **Difficulty**: Easy / Medium / Hard / Insane
- **Sound**: Toggle Web Audio FX

## ⚡ Power-ups

Every 5 correct rounds earns a **Memory Boost** — freezes the timer for 8 seconds.

## 🏆 Scoring

- Base: `100 × level`
- Multiplied by streak multiplier (×1 → ×8)
- Speed bonus for fast submissions
- High scores saved to localStorage
