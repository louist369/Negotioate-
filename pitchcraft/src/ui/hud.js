import { EV } from '../core/events.js';
import { Phase } from '../match/match.js';
import { TEAMS, HALF_LENGTH, HALF_WIDTH } from '../core/config.js';
import { clamp } from '../core/vec.js';

/**
 * Broadcast-style HUD, built from DOM rather than canvas so text stays crisp at
 * any resolution and the layout is responsive for free. The renderer never
 * touches these nodes — everything is driven from match state and the event bus.
 */
export class HUD {
  constructor({ root, match, bus, controller, audio, app }) {
    this.root = root;
    this.match = match;
    this.bus = bus;
    this.controller = controller;
    this.audio = audio;
    this.app = app;

    this.bannerTimer = 0;
    this.build();
    this.bindEvents();
  }

  build() {
    const home = TEAMS[0];
    const away = TEAMS[1];

    this.root.innerHTML = `
      <div class="hud">
        <div class="scorebug">
          <div class="team home">
            <span class="crest" style="--c1:${home.colors.primary};--c2:${home.colors.secondary}"></span>
            <span class="abbr">${home.short}</span>
          </div>
          <div class="score"><span data-score="0">0</span><i>–</i><span data-score="1">0</span></div>
          <div class="team away">
            <span class="abbr">${away.short}</span>
            <span class="crest" style="--c1:${away.colors.primary};--c2:${away.colors.secondary}"></span>
          </div>
          <div class="clock" data-clock>00:00</div>
          <div class="phase-pill" data-phase></div>
        </div>

        <div class="radar" data-radar>
          <canvas width="200" height="132"></canvas>
        </div>

        <div class="power" data-power hidden>
          <div class="power-label" data-power-label>SHOT</div>
          <div class="power-track"><div class="power-fill" data-power-fill></div></div>
        </div>

        <div class="banner" data-banner></div>

        <div class="hint" data-hint></div>

        <div class="corner-tips">
          <span><b>WASD</b> move</span>
          <span><b>Shift</b> sprint</span>
          <span><b>J</b> pass</span>
          <span><b>K</b> shoot</span>
          <span><b>L</b> lofted</span>
          <span><b>H</b> through</span>
          <span><b>Space</b> tackle</span>
          <span><b>Q</b> switch</span>
          <span><b>E</b> skill</span>
          <span><b>C</b> camera</span>
          <span><b>P</b> pause</span>
        </div>

        <div class="overlay" data-overlay hidden>
          <div class="panel" data-panel></div>
        </div>

        <div class="perf" data-perf hidden></div>
      </div>
    `;

    this.el = {
      score: [this.root.querySelector('[data-score="0"]'), this.root.querySelector('[data-score="1"]')],
      clock: this.root.querySelector('[data-clock]'),
      phase: this.root.querySelector('[data-phase]'),
      banner: this.root.querySelector('[data-banner]'),
      hint: this.root.querySelector('[data-hint]'),
      overlay: this.root.querySelector('[data-overlay]'),
      panel: this.root.querySelector('[data-panel]'),
      power: this.root.querySelector('[data-power]'),
      powerFill: this.root.querySelector('[data-power-fill]'),
      powerLabel: this.root.querySelector('[data-power-label]'),
      perf: this.root.querySelector('[data-perf]'),
      radar: this.root.querySelector('[data-radar] canvas'),
    };
    this.radarCtx = this.el.radar.getContext('2d');
  }

  bindEvents() {
    const bus = this.bus;

    bus.on(EV.GOAL, (e) => {
      const team = TEAMS[e.team];
      const scorer = e.scorer;
      this.showBanner(
        `<span class="big" style="color:${team.colors.primary}">GOAL!</span>` +
          `<span class="sub">${team.name}${scorer ? ` — #${scorer.number}` : ''}</span>`,
        3.2
      );
    });

    bus.on(EV.OUT_OF_PLAY, (e) => {
      const label = { throwIn: 'Throw-in', corner: 'Corner', goalKick: 'Goal kick' }[e.kind] || e.kind;
      this.showBanner(`<span class="mid">${label}</span><span class="sub">${TEAMS[e.team].name}</span>`, 1.6);
    });

    bus.on(EV.SAVE, (e) => {
      if (!e.attempt) this.showBanner(`<span class="mid">${e.caught ? 'Caught!' : 'Saved!'}</span>`, 1.2);
    });

    bus.on(EV.POST, (e) => {
      this.showBanner(`<span class="mid">Off the ${e.kind === 'bar' ? 'crossbar' : 'post'}!</span>`, 1.4);
    });

    bus.on(EV.FULL_TIME, (e) => this.showFullTime(e));
    bus.on(EV.KICKOFF, () => this.showBanner('<span class="mid">Kick-off</span>', 1.2));
  }

  showBanner(html, seconds) {
    this.el.banner.innerHTML = html;
    this.el.banner.classList.add('show');
    this.bannerTimer = seconds;
  }

  showFullTime(e) {
    const [a, b] = e.score;
    const result =
      a === b ? 'Draw' : `${TEAMS[a > b ? 0 : 1].name} win`;
    const s = this.match.stats;
    const pct = (v) => `${Math.round(v * 100)}%`;

    this.el.panel.innerHTML = `
      <h1>Full Time</h1>
      <div class="ft-score">
        <span>${TEAMS[0].short}</span>
        <strong>${a} – ${b}</strong>
        <span>${TEAMS[1].short}</span>
      </div>
      <p class="result">${result}</p>
      <table class="stats">
        <tr><td>${pct(s[0].possession)}</td><th>Possession</th><td>${pct(s[1].possession)}</td></tr>
        <tr><td>${s[0].shots}</td><th>Shots</th><td>${s[1].shots}</td></tr>
        <tr><td>${s[0].corners}</td><th>Corners</th><td>${s[1].corners}</td></tr>
        <tr><td>${s[0].tackles}</td><th>Tackles</th><td>${s[1].tackles}</td></tr>
      </table>
      <div class="actions">
        <button data-action="rematch">Play again</button>
      </div>
    `;
    this.el.overlay.hidden = false;
    this.wirePanel();
  }

  showPause() {
    this.el.panel.innerHTML = `
      <h1>Paused</h1>
      <div class="controls-grid">
        <div><b>WASD / Arrows</b><span>Move</span></div>
        <div><b>Shift</b><span>Sprint (hold)</span></div>
        <div><b>J</b><span>Short pass (hold for weight)</span></div>
        <div><b>H</b><span>Through ball</span></div>
        <div><b>L</b><span>Lofted pass / cross</span></div>
        <div><b>K</b><span>Shoot (hold to charge)</span></div>
        <div><b>Space</b><span>Tackle / press</span></div>
        <div><b>Q / Tab</b><span>Switch player</span></div>
        <div><b>E</b><span>Skill move</span></div>
        <div><b>C</b><span>Toggle camera</span></div>
        <div><b>P / Esc</b><span>Pause</span></div>
        <div><b>R</b><span>Restart match</span></div>
      </div>
      <p class="note">A gamepad is used automatically if one is connected.</p>
      <div class="difficulty">
        <span class="dl">Difficulty</span>
        ${['easy', 'normal', 'hard']
          .map(
            (d) =>
              `<button data-difficulty="${d}" class="chip${
                this.match.difficultyName === d ? ' on' : ''
              }">${d}</button>`
          )
          .join('')}
      </div>
      <div class="actions">
        <button data-action="resume">Resume</button>
        <button data-action="rematch" class="ghost">Restart match</button>
      </div>
    `;
    this.el.overlay.hidden = false;
    this.wirePanel();
  }

  hideOverlay() {
    this.el.overlay.hidden = true;
  }

  wirePanel() {
    for (const btn of this.el.panel.querySelectorAll('button')) {
      btn.addEventListener('click', () => {
        this.bus.emit(EV.UI, { tone: 720 });
        const level = btn.dataset.difficulty;
        if (level) {
          // Changing difficulty starts a fresh match at that level.
          this.app.setDifficulty(level);
          return;
        }
        const action = btn.dataset.action;
        if (action === 'resume') this.app.resume();
        else if (action === 'rematch') this.app.restart();
      });
    }
  }

  update(dt) {
    const m = this.match;

    this.el.score[0].textContent = m.score[0];
    this.el.score[1].textContent = m.score[1];

    const remaining = m.timeRemaining;
    const mm = Math.floor(remaining / 60);
    const ss = Math.floor(remaining % 60);
    this.el.clock.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    this.el.clock.classList.toggle('urgent', remaining < 30 && remaining > 0);

    // Phase pill.
    let phaseText = '';
    if (m.paused) phaseText = 'PAUSED';
    else if (m.phase === Phase.KICKOFF) phaseText = 'KICK-OFF';
    else if (m.phase === Phase.GOAL) phaseText = 'GOAL';
    else if (m.phase === Phase.FULL_TIME) phaseText = 'FULL TIME';
    else if (m.phase === Phase.RESTART && m.restart) {
      phaseText = { throwIn: 'THROW-IN', corner: 'CORNER', goalKick: 'GOAL KICK' }[m.restart.type] || '';
    }
    this.el.phase.textContent = phaseText;
    this.el.phase.classList.toggle('show', !!phaseText);

    // Banner lifetime.
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('show');
    }

    // Charge meter.
    const c = this.controller;
    if (c && c.charge > 0.02 && c.chargeAction) {
      this.el.power.hidden = false;
      this.el.powerFill.style.width = `${clamp(c.charge, 0, 1) * 100}%`;
      this.el.powerLabel.textContent =
        { shot: 'SHOT', loft: 'LOFTED', pass: 'PASS' }[c.chargeAction] || '';
    } else {
      this.el.power.hidden = true;
    }

    // Restart prompt.
    const r = m.restart;
    if (r && r.team === m.humanTeam && m.phase === Phase.RESTART) {
      const label = { throwIn: 'throw-in', corner: 'corner', goalKick: 'goal kick' }[r.type] || 'restart';
      this.el.hint.textContent = `Aim with WASD — press J to take the ${label}`;
      this.el.hint.classList.add('show');
    } else {
      this.el.hint.classList.remove('show');
    }

    this.drawRadar();
  }

  /** Small tactical radar so the player can read shape off-screen. */
  drawRadar() {
    const ctx = this.radarCtx;
    const w = this.el.radar.width;
    const h = this.el.radar.height;
    const m = this.match;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(6,20,12,0.72)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(2.5, 2.5, w - 5, h - 5);
    ctx.beginPath();
    ctx.moveTo(w / 2, 3);
    ctx.lineTo(w / 2, h - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, h * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    const toX = (x) => ((x + HALF_LENGTH) / (HALF_LENGTH * 2)) * (w - 8) + 4;
    const toY = (z) => ((z + HALF_WIDTH) / (HALF_WIDTH * 2)) * (h - 8) + 4;

    const controlled = this.controller ? this.controller.controlledPlayer : null;

    for (const p of m.world.players) {
      ctx.beginPath();
      ctx.arc(toX(p.pos.x), toY(p.pos.z), p.isKeeper ? 2.4 : 2.8, 0, Math.PI * 2);
      ctx.fillStyle = TEAMS[p.team].colors.primary;
      ctx.fill();
      if (p === controlled) {
        ctx.strokeStyle = '#ffe14d';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    const b = m.world.ball;
    ctx.beginPath();
    ctx.arc(toX(b.pos.x), toY(b.pos.z), 2, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  setPerf(text) {
    this.el.perf.hidden = !text;
    if (text) this.el.perf.textContent = text;
  }
}
