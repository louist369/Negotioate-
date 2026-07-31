# Play-testing Pitchcraft

Everything in this project was verified by instrumentation. A scripted bot drives
the real control path and caught several genuine defects, but **nobody has
actually held the controls**. This is the guide for doing that.

---

## 1. Get it running

### On a phone or tablet — nothing to install

The game builds to a single self-contained HTML file with no external
references, so it can be opened from anywhere:

```bash
npm run single      # writes dist-single/pitchcraft.html
```

Host that file, or open it directly. Touch controls appear automatically.
**Hold the phone in landscape** — a portrait prompt will tell you if you forget.

### On a computer

Node 18+ and any recent Chrome, Edge, Firefox or Safari.

```bash
git clone <this repo>
cd <repo>/pitchcraft
git checkout claude/pitchcraft-football-sim-izejuz
npm install
npm run dev
```

Open the URL Vite prints (usually <http://localhost:5173>). Click once on the
page — browsers block audio until you interact.

To play from a phone or another machine on your network:

```bash
npm run dev -- --host      # then open the Network URL it prints
```

**Start on `?difficulty=easy`.** `normal` is genuinely hard and you will spend
your first match losing rather than learning the controls.

```
http://localhost:5173/?difficulty=easy
```

---

## 2. Controls

### Touch

- **Left thumb** — drag anywhere on the left half to steer. The stick appears
  where you touch, so you never have to find it. **Push to the edge to sprint.**
- **Right thumb** — PASS and SHOOT are the big buttons; LOB and THRU sit above.
  **Hold SHOOT to charge it.**
- **TACKLE** and **SWITCH** are always available; the ball actions dim when you
  don't have the ball.
- **II** (top right) pauses — that's also where the difficulty picker lives.

### Keyboard

Full table is in the README, and the pause screen (`P`) lists them in-game. The
six that matter:

| | |
|---|---|
| `WASD` | move (camera-relative) |
| `Shift` | sprint (hold) |
| `J` | pass — hold longer for a firmer one |
| `K` | shoot — **hold to charge**, release to strike |
| `Space` | tackle |
| `Q` | switch player |

`F3` toggles a frame-rate / draw-call overlay. `C` switches camera. `R` restarts.

---

## 3. What to actually look for

These are the things measurement could not settle. Ranked by how much I'd like
an answer.

### Movement feel — the highest-value question
- Does your player respond immediately, or is there a lag before he moves?
- Can you turn when you want to, or does sprinting feel like driving a bus?
- Does stopping feel deliberate, or slidey?
- Is sprinting worth it, or does it just cost you the ball?

The whole anti-slide model is speed-dependent turn rate. If turning at pace
feels wrong, that's `PLAYER.turnRateFull`.

### Shooting
- When you press `K`, does a shot happen *every time*?
- Does the charge meter match what comes out — does a short tap feel weak and a
  full hold feel powerful?
- Can you aim? Push left while shooting: does it go left?

(Shots were being silently cancelled and the aim was skewing wide. Both are
fixed, but fixed-by-measurement, not fixed-by-feel.)

### Passing
- Do passes go where you're pointing?
- Does the assist ever pick someone you obviously didn't mean?
- Do your team-mates offer themselves, or do you run out of options?

### Player switching
- After you pass, does control end up on a sensible player?
- Does `Q` ever switch to someone useless?
- Do you ever lose track of who you're controlling?

### Camera
- Can you see enough to make decisions, or are you passing blind off-screen?
- Any nausea, jitter or snapping?
- Is the close camera (`C`) better or worse for actually playing?

### Difficulty
- Is `easy` winnable but not boring?
- Is `normal` a fair challenge once you know the controls?
- Does the AI ever do something obviously stupid or obviously unfair?

### Performance
Press `F3` and tell me the numbers. This is the one hard measurement I could not
take — this build has only ever run on a software rasteriser.
- Steady 60 fps? What's the 1% low?
- Does it drop during goal celebrations (confetti) or corners?
- Try `?quality=medium` and `?quality=low` and note the difference.

---

## 4. Tune it live while you play

Every tuning constant is exposed on `window.tune` and read fresh each tick, so
edits in the browser console take effect on the **next frame** — no reload.

Open the console (F12) and try:

```js
tune.PLAYER.sprintSpeed        // 9.7  — what is it now?
tune.PLAYER.accel = 14         // arcadey; feel the difference immediately
```

The knobs most likely to need your hands:

| Feels wrong | Try |
|---|---|
| Sluggish to get going | `tune.PLAYER.accel` (8.6) |
| Can't turn at speed | `tune.PLAYER.turnRateFull` (2.6) |
| Turns too sharply / arcadey | lower `tune.PLAYER.turnRateStill` (8.7) |
| Ball too far ahead when sprinting | `tune.PLAYER.controlRadius` (1.05) |
| Can't win a loose ball | `tune.PLAYER.reachRadius` (1.7) |
| Shots too weak / too wild | `tune.KICK.shotMinSpeed` / `shotMaxSpeed` (17 / 31) |
| Charge takes too long | `tune.KICK.maxChargeTime` (1.15) |
| Aim assist too strong | raise `tune.KICK.shotAimManual` (0.6) toward 1 |
| Passes over/under hit | `tune.KICK.passMaxSpeed` (21) |
| AI presses too hard | `tune.DIFFICULTY.normal.tackleRate` (1.3) |
| Camera too far out | `tune.CAMERA.broadcast.zoomNear` / `zoomFar` (34 / 47) |
| Camera too twitchy | lower `tune.CAMERA.broadcast.followLag` (3.4) |

Locomotion is deliberately set from human athletic data, not for feel:
acceleration 8.6 m/s², top sprint 9.7 m/s, ~500 deg/s standing turn falling to
~150 deg/s at a sprint. A player takes about 1.6s to reach top speed. If that
reads as sluggish to you rather than as weight, say so — the previous values
(26 m/s², 0.32s to top speed) were what made the game feel childlike, and the
right answer is somewhere between the two.

Graphics knobs are live too:

```js
tune.GRAPHICS.crowdRows            // stand density
__pitchcraft.scene.post.bloom.strength = 0.8    // more glare
__pitchcraft.scene.post.grade.uniforms.uVignette.value = 0    // no vignette
__pitchcraft.scene.scene.environmentIntensity = 1.2           // more indirect
__pitchcraft.scene.keyLight.intensity = 5                     // harder shadows
```

Note the values that felt right and send them to me — I'll fold them into
`src/core/config.js`, which is where all of these live permanently.

Other useful console handles:

```js
__pitchcraft.match.score           // live score
__pitchcraft.match.stats           // possession, shots, tackles
__pitchcraft.setDifficulty('hard') // switch tier, starts a fresh match
__pitchcraft.setAutoPlay(true)     // hand your team to the AI and just watch
__pitchcraft.match.world.ball      // poke the ball directly
```

`setAutoPlay(true)` is worth a couple of minutes on its own — watching AI vs AI
is the fastest way to judge whether the team behaviour reads as football.

---

## 5. Reporting back

Most useful, in order:

1. **A short screen recording** of anything that felt wrong. One clip beats a
   paragraph.
2. **The `F3` numbers** and your GPU.
3. **Any tuning values you changed** and what they fixed.
4. **Anything you expected to be able to do and couldn't.** That's usually a
   missing feature rather than a bug, and it's the most valuable feedback.

Console errors would also be worth knowing about — there are currently zero in
the automated runs, so any you see are new.
