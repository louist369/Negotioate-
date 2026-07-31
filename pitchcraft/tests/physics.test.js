import { describe, it, expect } from 'vitest';
import { Ball } from '../src/sim/ball.js';
import { World } from '../src/sim/world.js';
import { EventBus } from '../src/core/events.js';
import { Rng } from '../src/core/rng.js';
import {
  groundPassSpeed,
  loftSpeed,
  rollDistance,
  laneSafety,
  containTarget,
  buildKick,
} from '../src/sim/kicks.js';
import { BALL, PITCH, KICK, HALF_LENGTH, HALF_WIDTH, HALF_GOAL } from '../src/core/config.js';

const STEP = 1 / 120;

function simulate(ball, seconds, onStep = null) {
  const n = Math.ceil(seconds / STEP);
  for (let i = 0; i < n; i++) {
    ball.step(STEP);
    if (onStep) onStep(ball, i);
  }
  return ball;
}

describe('ball integrator', () => {
  it('comes to rest rather than creeping forever', () => {
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = 12;
    simulate(b, 20);
    expect(b.groundSpeed).toBe(0);
  });

  it('conserves direction while rolling', () => {
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = 9;
    b.vel.z = 9;
    simulate(b, 1.5);
    expect(b.pos.x).toBeCloseTo(b.pos.z, 5);
  });

  it('launches a lofted ball instead of eating its lift on the first tick', () => {
    // Regression: a ball resting at exactly y == radius took the rolling branch
    // and had vel.y zeroed, so every lofted kick died instantly.
    const b = new Ball();
    b.reset(0, 0);
    expect(b.pos.y).toBeCloseTo(BALL.radius, 9);
    b.vel.x = 10;
    b.vel.y = 8;
    b.step(STEP);
    expect(b.vel.y).toBeGreaterThan(7);
    let apex = 0;
    simulate(b, 3, (ball) => (apex = Math.max(apex, ball.pos.y)));
    expect(apex).toBeGreaterThan(2);
  });

  it('bounces with decreasing height', () => {
    const b = new Ball();
    b.reset(0, 0);
    b.pos.y = 6;
    const peaks = [];
    let rising = false;
    let last = b.pos.y;
    simulate(b, 8, (ball) => {
      if (ball.pos.y > last && !rising) rising = true;
      if (ball.pos.y < last && rising) {
        peaks.push(last);
        rising = false;
      }
      last = ball.pos.y;
    });
    for (let i = 1; i < peaks.length; i++) {
      expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    }
  });

  it('never exceeds the configured maximum speed', () => {
    const b = new Ball();
    b.reset(0, 0);
    b.launch(null, { x: 500, y: 300, z: 200 });
    expect(b.speed).toBeLessThanOrEqual(BALL.maxSpeed + 1e-6);
  });
});

describe('pass and loft calibration', () => {
  it.each([4, 8, 12, 16, 20])('lands a %im ground pass at its target pace', (range) => {
    const arrival = 4.5;
    const v0 = groundPassSpeed(range, arrival);
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = v0;

    let speedAtTarget = null;
    simulate(b, 6, (ball) => {
      if (speedAtTarget === null && ball.pos.x >= range) speedAtTarget = ball.groundSpeed;
    });

    expect(speedAtTarget).not.toBeNull();
    // The whole point of inverting the rolling model: arrive at the requested
    // pace, not 3x it.
    expect(speedAtTarget).toBeGreaterThan(arrival - 1.2);
    expect(speedAtTarget).toBeLessThan(arrival + 1.2);
  });

  it('agrees with the closed-form roll distance', () => {
    const v0 = 14;
    const predicted = rollDistance(v0, 0);
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = v0;
    simulate(b, 25);
    // The integrator snaps sub-0.06 m/s to zero, so allow a small shortfall.
    expect(b.pos.x).toBeGreaterThan(predicted - 1.0);
    expect(b.pos.x).toBeLessThan(predicted + 0.5);
  });

  it.each([12, 20, 28, 36])('lands a %im lofted pass close to its target', (range) => {
    const v0 = loftSpeed(range);
    const ang = KICK.loftAngle;
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = Math.cos(ang) * v0;
    b.vel.y = Math.sin(ang) * v0;

    let landing = null;
    let prevY = b.pos.y;
    simulate(b, 6, (ball, i) => {
      if (landing === null && i > 5 && ball.pos.y <= BALL.radius + 1e-4 && prevY > BALL.radius + 1e-3) {
        landing = ball.pos.x;
      }
      prevY = ball.pos.y;
    });

    expect(landing).not.toBeNull();
    expect(Math.abs(landing - range)).toBeLessThan(1.5);
  });

  it('gives a lofted ball enough height to clear a defender', () => {
    const v0 = loftSpeed(24);
    const ang = KICK.loftAngle;
    const b = new Ball();
    b.reset(0, 0);
    b.vel.x = Math.cos(ang) * v0;
    b.vel.y = Math.sin(ang) * v0;
    let apex = 0;
    simulate(b, 4, (ball) => (apex = Math.max(apex, ball.pos.y)));
    expect(apex).toBeGreaterThan(2.2);
  });
});

describe('goal detection geometry', () => {
  it('detects a ball fully across the line between the posts', () => {
    const b = new Ball();
    b.reset(HALF_LENGTH + BALL.radius + 0.05, 0);
    b.pos.y = 1;
    expect(b.goalCheck(1)).toBe(true);
    expect(b.goalCheck(-1)).toBe(false);
  });

  it('rejects a ball outside the posts or over the bar', () => {
    const b = new Ball();
    b.reset(HALF_LENGTH + 0.3, HALF_GOAL + 0.5);
    expect(b.goalCheck(1)).toBe(false);

    b.reset(HALF_LENGTH + 0.3, 0);
    b.pos.y = PITCH.goalHeight + 0.5;
    expect(b.goalCheck(1)).toBe(false);
  });

  it('reports out of play only once the whole ball is past the line', () => {
    const b = new Ball();
    b.reset(0, HALF_WIDTH - 0.01);
    expect(b.outOfPlay()).toBeNull();
    b.reset(0, HALF_WIDTH + BALL.radius + 0.02);
    expect(b.outOfPlay()?.type).toBe('touchline');
    b.reset(HALF_LENGTH + BALL.radius + 0.02, 0);
    expect(b.outOfPlay()?.type).toBe('byline');
  });
});

describe('goal frame collisions', () => {
  function freshWorld() {
    const bus = new EventBus();
    const world = new World({ bus, rng: new Rng(7) });
    // Move every player far away so only the frame is in play.
    for (const p of world.players) {
      p.pos.x = -200;
      p.pos.z = -200;
    }
    return { world, bus };
  }

  it('rebounds off a post', () => {
    const { world, bus } = freshWorld();
    const posts = [];
    bus.on('post', (e) => posts.push(e));

    const b = world.ball;
    b.reset(HALF_LENGTH - 3, HALF_GOAL);
    b.pos.y = 0.6;
    b.vel.x = 20;

    for (let i = 0; i < 240; i++) world.step(STEP);

    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].kind).toBe('post');
    // Momentum must be redirected, not absorbed.
    expect(b.vel.x).toBeLessThan(20);
  });

  it('rebounds off the crossbar', () => {
    const { world, bus } = freshWorld();
    const hits = [];
    bus.on('post', (e) => hits.push(e));

    const b = world.ball;
    // Start close to the frame: over 4m of flight gravity drops the ball far
    // enough to slip under the bar, which tests the wrong thing.
    b.reset(HALF_LENGTH - 1.2, 0);
    b.pos.y = PITCH.goalHeight;
    b.vel.x = 18;
    b.vel.y = 0;

    for (let i = 0; i < 240; i++) world.step(STEP);
    expect(hits.some((h) => h.kind === 'bar')).toBe(true);
  });

  it('stops the ball inside the net rather than letting it escape', () => {
    const { world } = freshWorld();
    const b = world.ball;
    b.reset(HALF_LENGTH - 1, 0);
    b.pos.y = 1;
    b.vel.x = 30;

    for (let i = 0; i < 400; i++) world.step(STEP);
    expect(b.pos.x).toBeLessThan(HALF_LENGTH + PITCH.goalDepth + 0.2);
  });
});

describe('passing helpers', () => {
  it('reports a clear lane as safe and a blocked one as unsafe', () => {
    const from = { x: 0, z: 0 };
    const to = { x: 15, z: 0 };
    expect(laneSafety(from, to, [])).toBe(1);

    const blocker = [{ pos: { x: 7, z: 0 }, isKeeper: false }];
    expect(laneSafety(from, to, blocker)).toBeLessThan(0.35);

    const offLane = [{ pos: { x: 7, z: 12 }, isKeeper: false }];
    expect(laneSafety(from, to, offLane)).toBe(1);
  });

  it('keeps pass targets inside the field of play', () => {
    const t = containTarget(HALF_LENGTH + 20, HALF_WIDTH + 20, 5, 4);
    expect(t.x).toBeLessThanOrEqual(HALF_LENGTH - 4 + 1e-9);
    expect(t.z).toBeLessThanOrEqual(HALF_WIDTH - 5 + 1e-9);
  });

  it('produces a lofted kick with real vertical velocity', () => {
    const player = {
      heading: 0,
      attrs: { power: 1, control: 1 },
      attackDir: 1,
      pos: { x: 0, z: 0 },
    };
    const ball = { pos: { x: 0, y: BALL.radius, z: 0 } };
    const { vel } = buildKick(player, ball, 'loft', 0.7, 0, 1, { x: 0, z: 20 }, 0, new Rng(1));
    expect(vel.y).toBeGreaterThan(4);
    expect(Math.hypot(vel.x, vel.z)).toBeGreaterThan(6);
  });

  it('produces a ground pass with no lift', () => {
    const player = {
      heading: 0,
      attrs: { power: 1, control: 1 },
      attackDir: 1,
      pos: { x: 0, z: 0 },
    };
    const ball = { pos: { x: 0, y: BALL.radius, z: 0 } };
    const { vel } = buildKick(player, ball, 'pass', 0.5, 0, 1, { x: 0, z: 12 }, 0, new Rng(1));
    expect(vel.y).toBe(0);
  });
});
