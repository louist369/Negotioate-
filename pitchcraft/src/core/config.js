/**
 * Central tuning file. Everything gameplay-tunable lives here so the simulation
 * can be rebalanced without touching system code.
 *
 * Units: metres, seconds, radians. Pitch is x = length, z = width, y = height.
 * Team 0 (Home) defends -x and attacks +x. Team 1 (Away) is the mirror.
 */

export const PITCH = {
  // 7v7 on an adult pitch. Swap to 105 x 68 for an 11v11 build — everything
  // below derives from these. Enlarged from 78x50: seven players on a small
  // pitch with small goals is exactly the composition of a junior match.
  length: 88,
  width: 57,
  // Space beyond the touchline before the stands begin.
  margin: 9,

  // Regulation goal. Undersized posts are the fastest way to make a pitch read
  // as youth football: a player should stand about 4.0 goal-widths tall.
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.0,
  postRadius: 0.06,

  // Markings are proportioned off the regulation goal rather than off the pitch:
  // a six-yard box narrower than `goalWidth + 2 * goalAreaDepth` is the single
  // most obvious "this is a junior pitch" tell, and the old 13m box was.
  centreCircleRadius: 8.0,
  penaltyAreaDepth: 13.5,
  penaltyAreaWidth: 31,
  goalAreaDepth: 5.5,
  goalAreaWidth: 18.32,
  cornerArcRadius: 1,
  penaltySpot: 10,
  lineWidth: 0.14,
};

export const BALL = {
  radius: 0.113,
  mass: 0.43,
  // Rolling friction as an exponential decay per second plus a constant drag term.
  groundDecay: 0.62,
  groundStop: 0.55,
  airDrag: 0.06,
  gravity: 9.81,
  // A match ball bounces to roughly 60-70% of drop height on turf.
  restitution: 0.7,
  // Fraction of horizontal speed retained on a bounce.
  bounceFriction: 0.82,
  spinDecay: 0.85,
  // Magnus-style lateral acceleration per unit spin per unit speed.
  magnus: 0.021,
  maxSpeed: 42,
  postRestitution: 0.62,
};

export const PLAYER = {
  radius: 0.42,
  height: 1.82,

  // Locomotion is set from human athletic data rather than picked for feel.
  // The previous values (accel 26 m/s^2, decel 34, 774 deg/s standing turn)
  // put a player at top speed in 0.32s against a real 1.6-2.2s, which is what
  // made the game read as weightless and childlike. These sit at the brisk end
  // of the real band — a footballer, not a physics lesson.
  walkSpeed: 3.2,
  runSpeed: 7.0,
  sprintSpeed: 9.7,
  // Speed penalty applied while actively dribbling the ball.
  dribbleSpeedFactor: 0.86,

  accel: 8.6,
  sprintAccel: 7.4,
  decel: 10.5,
  // Extra deceleration applied when input direction opposes velocity.
  reverseBrake: 1.8,

  // Turn rate falls off as speed rises, which is what stops "sliding on ice"
  // feel. ~500 deg/s standing down to ~150 deg/s at a full sprint.
  turnRateStill: 8.7,
  turnRateFull: 2.6,

  staminaMax: 1,
  staminaDrainSprint: 0.085,
  staminaRegen: 0.055,
  // Below this the player cannot sprint until recovered past `staminaRecoverAt`.
  staminaExhausted: 0.05,
  staminaRecoverAt: 0.25,

  controlRadius: 1.05,
  // Distance at which a player can first influence a loose ball. This is a
  // stretch — a standing leg extension from the body centre, not an arm's
  // length — so 1.7m is the honest figure for a 1.82m player.
  //
  // It matters more than it looks. Dropping acceleration from 26 m/s^2 to a
  // human 8.6 cost 12 points of possession outright, because players simply
  // could not reach loose balls any more and the game turned scrappy. The fix
  // is not to give the acceleration back: it is to let a player who *does*
  // arrive actually win the ball, which is what a real footballer does.
  reachRadius: 1.7,
  // Relative ball speed (m/s) at which control quality falls to zero.
  controlPace: 34,
  // A player can only stretch so far in the time a fast ball gives them.
  // Effective reach shrinks with the ball's relative speed: without this, a
  // defender standing beside the passer simply took every pass off his foot —
  // 73% of "interceptions" happened in the first 10% of the pass.
  interceptSpeedLimit: 30,
  minReachFraction: 0.75,
  // Ball height (m) at which a player can still bring the ball down.
  controlHeight: 0.85,
  tackleRange: 2.05,
  tackleCooldown: 0.75,
  tackleDuration: 0.42,
  tackleLungeSpeed: 9.5,

  // Stride length in metres at a walk and at full sprint. Animation cadence is
  // derived from these (cadence = speed / stepLength) so feet stay planted.
  stepLengthWalk: 0.62,
  stepLengthSprint: 2.45,

  // Seconds a player is stumbling after a lost duel.
  stumbleTime: 0.65,
  // Time after being dispossessed before the same player may re-tackle.
  possessionLockout: 0.28,
};

export const KICK = {
  passMinSpeed: 9,
  passMaxSpeed: 21,
  passHeightGain: 0.0,

  throughMinSpeed: 12,
  throughMaxSpeed: 25,
  // Lead distance scales with the pitch: a through ball played 7.5m ahead on an
  // 88m pitch is a short pass, not a ball in behind.
  throughLead: 8.5,

  loftMinSpeed: 12,
  loftMaxSpeed: 24,
  loftAngle: 0.52,

  shotMinSpeed: 17,
  shotMaxSpeed: 31,
  shotLoftBase: 0.055,
  shotLoftPerPower: 0.11,

  maxChargeTime: 1.15,
  // Directional input authority vs. assisted target. 0 = full assist, 1 = full manual.
  assistBlendPass: 0.28,
  // Low for shots: the player's intent is expressed by *where in the goal* they
  // aim (see shotAimManual), so the launch direction should track that target
  // rather than being pulled back toward the raw stick vector.
  assistBlendShot: 0.16,
  // How far the player's lateral input moves the aim across the goal mouth.
  shotAimManual: 0.6,
  // Cone (radians) inside which the assist looks for a receiver.
  passCone: 1.15,
  passMaxRange: 38,

  // Random error injected per kick, scaled by pressure and power.
  baseError: 0.012,
  pressureError: 0.05,
  powerError: 0.03,

  kickCooldown: 0.22,
  // Seconds after receiving before a first-time pass counts as a controlled touch.
  firstTouchWindow: 0.35,
};

export const KEEPER = {
  lineDepth: 1.35,
  maxAdvance: 9.5,
  // How far across goal the keeper shifts per metre of ball offset.
  angleFactor: 0.34,
  reactionTime: 0.09,
  diveSpeed: 10.2,
  diveDuration: 0.55,
  diveRecover: 0.7,
  // A regulation goal is 7.7% wider than the one this was tuned against, so the
  // keeper needs the extra span and the extra base save rate simply to hold the
  // old save percentage. Without it, conversion ran at 50%.
  reach: 2.8,
  highReach: 2.85,
  catchChance: 0.62,
  // Save probability scaling: harder shots and tighter angles are harder to stop.
  baseSave: 1.14,
  speedPenalty: 0.011,
  distanceBonus: 0.012,
  rushThreshold: 13,
  distributeDelay: 1.4,
};

export const AI = {
  // Formation shape is defined in normalised pitch space then scaled.
  lineHeightAttack: 0.24,
  lineHeightDefend: -0.2,
  compactness: 0.82,

  // Every radius here was calibrated against a 78x50 pitch. They are scaled with
  // it — a press radius that does not grow with the pitch turns a bigger pitch
  // into a passive one.
  pressRadius: 15.5,
  pressersMax: 2,
  supportRadius: 20,
  markRadius: 12.5,

  // Utility weights for pass selection.
  wProgress: 1.0,
  wSafety: 1.35,
  wSpace: 0.7,
  wGoalThreat: 1.5,

  decisionInterval: 0.12,
  // Seconds a carrier keeps the ball before looking to pass (unless pressed).
  minCarryTime: 1.05,
  // Utility a pass must beat to be played.
  passThreshold: 0.95,
  passThresholdPressed: 0.42,
  // Pressure at which a carrier abandons its dwell time and releases early.
  pressureRelease: 1.45,
  runTriggerChance: 0.55,
  // Minimum spacing AI teammates try to keep from one another.
  spacing: 7.3,
  spacingForce: 1.1,

  shootRangeBase: 24,
  shootConfidence: 0.29,

  // Pass-type preference. The simple ground pass is the baseline; the ambitious
  // options start negative and have to earn their selection.
  passBias: 0.4,
  throughBias: -0.75,
  loftBias: -0.95,

  // Expected AI tackle attempts per second while in range and committed.
  tackleRate: 2.2,
  // Base probability a committed tackle wins the ball from a carrier.
  tackleWinBase: 0.5,

  // Baseline difficulty; see DIFFICULTY below for the tiers that override it.
  difficulty: {
    reaction: 0.16,
    passAccuracy: 0.9,
    aggression: 1.0,
    tackleRate: 2.2,
    shootConfidence: 0.29,
    keeperSkill: 0,
    errorScale: 1,
    speed: 1,
  },
};

/**
 * Difficulty tiers, applied to the *opponent* only — the player's own AI
 * team-mates always play at full strength, because being let down by your own
 * side is not a difficulty setting, it's a bug.
 *
 * `reaction` is extra goalkeeper reaction delay in seconds (higher = slower),
 * `keeperSkill` shifts save probability, and the rest scale the field players'
 * aggression, tackling frequency, willingness to shoot and passing precision.
 */
export const DIFFICULTY = {
  easy: {
    reaction: 0.45,
    passAccuracy: 0.62,
    aggression: 0.42,
    tackleRate: 0.8,
    shootConfidence: 0.52,
    keeperSkill: -0.75,
    // The levers that actually decide matches: execution precision and pace.
    errorScale: 4.2,
    speed: 0.8,
  },
  normal: {
    reaction: 0.3,
    passAccuracy: 0.74,
    aggression: 0.62,
    tackleRate: 1.3,
    shootConfidence: 0.42,
    keeperSkill: -0.4,
    errorScale: 2.5,
    speed: 0.91,
  },
  hard: {
    reaction: 0.15,
    passAccuracy: 0.92,
    aggression: 1.0,
    tackleRate: 2.2,
    shootConfidence: 0.29,
    keeperSkill: 0.05,
    errorScale: 1.0,
    speed: 1.0,
  },
};

/**
 * Squad surnames, one list per team.
 *
 * Invented, not borrowed: no real player's name appears here, in keeping with
 * the rest of the project's original-content rule. Each list is given a faint
 * regional flavour so a squad reads as a squad rather than as a random draw —
 * Harbour Vale coastal-British, Ironmoor industrial-northern.
 */
export const SQUAD_NAMES = [
  ['Marrow', 'Calder', 'Venn', 'Ashby', 'Rourke', 'Pell', 'Trevane', 'Locke', 'Danby', 'Wren', 'Sable'],
  ['Kessel', 'Brandt', 'Fowley', 'Stroud', 'Ingram', 'Hask', 'Merrick', 'Dunlow', 'Varn', 'Colt', 'Reave'],
];

/** Strength the player's own team-mates always play at. */
export const TEAMMATE_SKILL = DIFFICULTY.hard;

export const MATCH = {
  durationSeconds: 300,
  // Sim seconds per real second — the clock runs at 1:1 for a 5 minute match.
  clockScale: 1,
  halves: 1,
  restartDelay: 1.1,
  celebrationTime: 3.4,
  kickoffFreeze: 0.75,
  // Radius opponents must respect at a restart.
  restartClearance: 6.5,
  // Team-mates may stand close, but never on top of the ball.
  restartMateClearance: 3.2,
  // Ball must travel this far from a restart before it is live for the taker again.
  restartOwnTouchDistance: 0.6,
};

export const SIM = {
  fixedStep: 1 / 120,
  maxSubSteps: 8,
  // Wall-clock seconds of simulation allowed to accumulate before we drop frames.
  maxAccumulator: 0.25,
};

export const TEAMS = [
  {
    id: 0,
    name: 'Harbour Vale',
    short: 'HVL',
    nick: 'The Tide',
    colors: {
      primary: '#1b4fd8',
      secondary: '#0d1f45',
      accent: '#f2d24b',
      shorts: '#101b33',
      socks: '#1b4fd8',
      keeper: '#2fd18b',
      keeperShorts: '#0d2a1e',
      skinPalette: ['#f0c49a', '#d79f6f', '#a9713f', '#7a4a24', '#523018'],
    },
    attackDir: 1,
  },
  {
    id: 1,
    name: 'Ironmoor',
    short: 'IRN',
    nick: 'The Forge',
    colors: {
      primary: '#e2512c',
      secondary: '#2a1108',
      accent: '#ffd9a8',
      shorts: '#241009',
      socks: '#e2512c',
      keeper: '#b64bd6',
      keeperShorts: '#2a1030',
      skinPalette: ['#f0c49a', '#d79f6f', '#a9713f', '#7a4a24', '#523018'],
    },
    attackDir: -1,
  },
];

/**
 * Formation templates in normalised space: x is depth (-1 own goal, +1 opponent goal),
 * z is width (-1 left touchline, +1 right touchline). Index 0 is always the keeper.
 * `roles` drive AI behaviour selection.
 */
export const FORMATIONS = {
  '7v7': [
    { role: 'GK', x: -0.94, z: 0.0 },
    { role: 'CB', x: -0.62, z: -0.26 },
    { role: 'CB', x: -0.62, z: 0.26 },
    { role: 'WM', x: -0.1, z: -0.66 },
    { role: 'CM', x: -0.14, z: 0.0 },
    { role: 'WM', x: -0.1, z: 0.66 },
    { role: 'ST', x: 0.36, z: 0.0 },
  ],
  '11v11': [
    { role: 'GK', x: -0.94, z: 0.0 },
    { role: 'FB', x: -0.66, z: -0.62 },
    { role: 'CB', x: -0.74, z: -0.2 },
    { role: 'CB', x: -0.74, z: 0.2 },
    { role: 'FB', x: -0.66, z: 0.62 },
    { role: 'CM', x: -0.3, z: -0.34 },
    { role: 'CM', x: -0.36, z: 0.0 },
    { role: 'CM', x: -0.3, z: 0.34 },
    { role: 'WM', x: 0.14, z: -0.66 },
    { role: 'ST', x: 0.4, z: 0.0 },
    { role: 'WM', x: 0.14, z: 0.66 },
  ],
};

/** Per-role attribute multipliers — small differences, but enough to read on the pitch. */
export const ROLE_ATTRS = {
  GK: { speed: 0.94, accel: 1.0, control: 1.0, power: 1.05, aggression: 0.2 },
  CB: { speed: 0.96, accel: 0.95, control: 0.9, power: 1.06, aggression: 0.85 },
  FB: { speed: 1.03, accel: 1.02, control: 0.95, power: 0.98, aggression: 0.8 },
  CM: { speed: 1.0, accel: 1.0, control: 1.06, power: 1.0, aggression: 0.7 },
  WM: { speed: 1.05, accel: 1.05, control: 1.0, power: 0.96, aggression: 0.65 },
  ST: { speed: 1.04, accel: 1.03, control: 1.02, power: 1.04, aggression: 0.55 },
};

/**
 * Camera placement is chosen to mimic a real main broadcast gantry: elevated in
 * the near stand, set back beyond the touchline, looking down at roughly 25deg.
 * `distance` is measured from the point of interest, so the camera always sits
 * outside the field of play (HALF_WIDTH = 25) rather than hovering over it.
 */
export const CAMERA = {
  broadcast: {
    height: 19,
    distance: 40,
    lookAhead: 3.2,
    fov: 38,
    followLag: 3.4,
    zoomNear: 34,
    zoomFar: 47,
    maxLateral: 0.62,
  },
  close: {
    height: 11,
    distance: 24,
    lookAhead: 4.5,
    fov: 50,
    followLag: 5.2,
    maxLateral: 0.8,
  },
};

export const GRAPHICS = {
  crowdRows: 14,
  crowdDensity: 1,
  shadowMapSize: 2048,
  grassStripeCount: 14,
};

/** Derived helpers used all over the sim. */
export const HALF_LENGTH = PITCH.length / 2;
export const HALF_WIDTH = PITCH.width / 2;
export const HALF_GOAL = PITCH.goalWidth / 2;
