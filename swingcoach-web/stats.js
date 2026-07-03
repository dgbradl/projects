/* Pure helpers for sessions, fix tracking, and practice plans.
 * No DOM access — loaded after engine.js (uses its option lists and DRILLS),
 * kept separate so the logic is unit-testable.
 */

/* ----------------------------------------------------------- sessions
 * Sessions are derived, not stored: shots within 3 hours of each other are
 * one range session / round. Zero extra taps, and it works retroactively.
 */

const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/** Returns sessions newest-first: {start, end, shots (newest-first)} */
function computeSessions(shots) {
  const sorted = [...shots].sort((a, b) => new Date(b.date) - new Date(a.date));
  const sessions = [];
  for (const shot of sorted) {
    const t = new Date(shot.date).getTime();
    const cur = sessions[sessions.length - 1];
    if (cur && cur.start - t <= SESSION_GAP_MS) {
      cur.shots.push(shot);
      cur.start = t; // earliest shot in the session so far
    } else {
      sessions.push({ start: t, end: t, shots: [shot] });
    }
  }
  return sessions;
}

function isFlushStraight(shot) {
  return shot.contact === 'flush' && shot.curve === 'straight' && shot.startLine === 'straight';
}

function flushPct(shots) {
  if (!shots.length) return 0;
  return Math.round(100 * shots.filter(isFlushStraight).length / shots.length);
}

/* -------------------------------------------------------- miss patterns */

/** Does this shot exhibit the tracked miss pattern? */
function matchesPattern(shot, pattern) {
  const dot = pattern.indexOf('.');
  const kind = pattern.slice(0, dot);
  const value = pattern.slice(dot + 1);
  switch (kind) {
    case 'contact': return shot.contact === value;
    case 'curve': return shot.curve === value;
    // A "start" miss is a clean, straight shot that just went the wrong way.
    case 'start': return shot.startLine === value && shot.curve === 'straight' && shot.contact === 'flush';
    default: return false;
  }
}

function patternLabel(pattern) {
  const dot = pattern.indexOf('.');
  const kind = pattern.slice(0, dot);
  const value = pattern.slice(dot + 1);
  switch (kind) {
    case 'contact': return labelFor(CONTACTS, value);
    case 'curve': return labelFor(CURVES, value);
    case 'start': return 'Straight miss ' + value;
    default: return pattern;
  }
}

/** The dominant trackable miss in a shot, or null if there's nothing to fix. */
function trackablePattern(shot) {
  if (shot.contact !== 'flush') {
    return { pattern: 'contact.' + shot.contact, label: labelFor(CONTACTS, shot.contact) };
  }
  if (shot.curve === 'slice' || shot.curve === 'hook') {
    return { pattern: 'curve.' + shot.curve, label: labelFor(CURVES, shot.curve) };
  }
  if (shot.startLine !== 'straight' && shot.curve === 'straight') {
    return { pattern: 'start.' + shot.startLine, label: 'Straight miss ' + shot.startLine };
  }
  return null;
}

/* ---------------------------------------------------------- fix tracking */

/** Before/after miss rates for a focus: {beforeCount, beforeRate, afterCount, afterRate} — rates 0–100 or null. */
function focusStats(shots, focus) {
  const started = new Date(focus.startedAt).getTime();
  const ended = focus.endedAt ? new Date(focus.endedAt).getTime() : Infinity;
  const before = [];
  const after = [];
  for (const shot of shots) {
    const t = new Date(shot.date).getTime();
    if (t < started) before.push(shot);
    else if (t < ended) after.push(shot);
  }
  // Baseline on the most recent shots before the focus started.
  before.sort((a, b) => new Date(b.date) - new Date(a.date));
  const baseline = before.slice(0, 100);
  const rate = arr => arr.length
    ? Math.round(100 * arr.filter(s => matchesPattern(s, focus.pattern)).length / arr.length)
    : null;
  return {
    beforeCount: baseline.length,
    beforeRate: rate(baseline),
    afterCount: after.length,
    afterRate: rate(after),
  };
}

/* ------------------------------------------------------------ chart data */

/** Per-session series for the progress chart, oldest-first, capped at maxSessions.
 * [{label, flushPct, focusPct|null}] */
function sessionSeries(sessions, focusPattern, maxSessions = 12) {
  const recent = sessions.slice(0, maxSessions).reverse();
  return recent.map(session => {
    const d = new Date(session.end);
    return {
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      count: session.shots.length,
      flushPct: flushPct(session.shots),
      focusPct: focusPattern
        ? Math.round(100 * session.shots.filter(s => matchesPattern(s, focusPattern)).length / session.shots.length)
        : null,
    };
  });
}

/* ---------------------------------------------------------- ball flight
 * The flight picker works in OBSERVED geometry — what the golfer saw:
 *   s: start direction, -1 left / 0 straight / +1 right
 *   c: curve, -2 big left / -1 small left / 0 none / +1 small right / +2 big right
 * Golf vocabulary (slice/hook/fade/draw) is handedness-relative, so these
 * two helpers translate between observed shape and shot fields.
 */

function observedToFields(s, c, handedness) {
  const startLine = s < 0 ? 'left' : (s > 0 ? 'right' : 'straight');
  let curve = 'straight';
  if (c !== 0) {
    const big = Math.abs(c) === 2;
    // Curving right is a slice for a right-hander, a hook for a left-hander.
    const sliceSide = handedness === 'left' ? -1 : 1;
    if (Math.sign(c) === sliceSide) curve = big ? 'slice' : 'fade';
    else curve = big ? 'hook' : 'draw';
  }
  return { startLine, curve };
}

function fieldsToObserved(startLine, curve, handedness) {
  const s = startLine === 'left' ? -1 : (startLine === 'right' ? 1 : 0);
  if (curve === 'straight') return { s, c: 0 };
  const sliceSide = handedness === 'left' ? -1 : 1;
  const big = curve === 'slice' || curve === 'hook';
  const dir = (curve === 'slice' || curve === 'fade') ? sliceSide : -sliceSide;
  return { s, c: dir * (big ? 2 : 1) };
}

/** SVG path for an observed flight shape inside a 320×216 viewBox:
 * tee at bottom center, launch along the start line, bending with the curve. */
function flightPathD(s, c) {
  const x0 = 160, y0 = 196;
  const cx = x0 + s * 38, cy = 108;
  const ex = x0 + s * 70 + c * 35, ey = 34;
  return `M ${x0} ${y0} Q ${cx} ${cy} ${ex} ${ey}`;
}

/* ------------------------------------------------------------- quick log
 * One-tap outcomes for on-course logging. Each maps to full shot fields so
 * quick-logged shots feed the same diagnosis engine, trends, and charts.
 * "Pull"/"Push" depend on handedness: a pull starts left for a righty and
 * right for a lefty.
 */

const QUICK_OUTCOMES = [
  { id: 'flush',  label: 'Flush ✓' },
  { id: 'pull',   label: 'Pull' },
  { id: 'push',   label: 'Push' },
  { id: 'slice',  label: 'Slice' },
  { id: 'hook',   label: 'Hook' },
  { id: 'fat',    label: 'Fat' },
  { id: 'thin',   label: 'Thin' },
  { id: 'topped', label: 'Top' },
  { id: 'shank',  label: 'Shank' },
];

/** Shot field overrides for a quick outcome. */
function quickShotFields(outcomeId, handedness) {
  const pullSide = handedness === 'left' ? 'right' : 'left';
  const pushSide = handedness === 'left' ? 'left' : 'right';
  const base = { contact: 'flush', startLine: 'straight', curve: 'straight', trajectory: 'normal' };
  switch (outcomeId) {
    case 'flush':  return base;
    case 'pull':   return Object.assign(base, { startLine: pullSide });
    case 'push':   return Object.assign(base, { startLine: pushSide });
    case 'slice':  return Object.assign(base, { curve: 'slice' });
    case 'hook':   return Object.assign(base, { curve: 'hook' });
    case 'fat':    return Object.assign(base, { contact: 'fat' });
    case 'thin':   return Object.assign(base, { contact: 'thin' });
    case 'topped': return Object.assign(base, { contact: 'topped' });
    case 'shank':  return Object.assign(base, { contact: 'shank' });
    default:       return base;
  }
}

/* ---------------------------------------------------------------- rounds
 * A round is a digital scorecard: {id, date, course, holes: [{par, strokes}],
 * finished}. Totals only count holes with strokes entered; the to-par number
 * appears only when every played hole also has a par set.
 */

function newRound(course, holeCount) {
  return {
    id: crypto.randomUUID(),
    date: new Date().toISOString(),
    course: course.trim(),
    holes: Array.from({ length: holeCount }, () => ({ par: null, strokes: null })),
    finished: false,
  };
}

function roundTotals(round) {
  let holesPlayed = 0, strokes = 0, par = 0, allParsKnown = true;
  for (const hole of round.holes) {
    if (hole.strokes === null || hole.strokes === undefined) continue;
    holesPlayed += 1;
    strokes += hole.strokes;
    if (hole.par === null || hole.par === undefined) allParsKnown = false;
    else par += hole.par;
  }
  return {
    holesPlayed,
    strokes,
    par: allParsKnown && holesPlayed ? par : null,
    toPar: allParsKnown && holesPlayed ? strokes - par : null,
  };
}

function formatToPar(n) {
  if (n === null || n === undefined) return '';
  if (n === 0) return 'E';
  return n > 0 ? '+' + n : String(n);
}

/** Unique course names from past rounds, most recent first. */
function knownCourses(rounds) {
  const seen = new Set();
  const names = [];
  for (const round of [...rounds].sort((a, b) => new Date(b.date) - new Date(a.date))) {
    const key = round.course.toLowerCase();
    if (round.course && !seen.has(key)) {
      seen.add(key);
      names.push(round.course);
    }
  }
  return names;
}

/** Best (lowest) finished-round score per course: [{course, best, rounds}] */
function courseBests(rounds) {
  const byCourse = new Map();
  for (const round of rounds) {
    if (!round.finished) continue;
    const totals = roundTotals(round);
    if (!totals.holesPlayed) continue;
    const key = round.course.toLowerCase();
    const cur = byCourse.get(key) || { course: round.course, best: Infinity, rounds: 0 };
    cur.rounds += 1;
    if (totals.strokes < cur.best) cur.best = totals.strokes;
    byCourse.set(key, cur);
  }
  return [...byCourse.values()].sort((a, b) => b.rounds - a.rounds);
}

/* ---------------------------------------------------------- practice plan */

const TRACKED_FINISHER = {
  name: 'Tracked shots',
  dose: '10 balls',
  howTo: 'Finish by hitting 10 normal shots at a real target and logging every one in the app — this is how the charts know the work is paying off.',
};

/** A range-session prescription for a miss pattern. */
function generatePlan(pattern) {
  const rx = (drill, dose) => ({ name: drill.name, dose, howTo: drill.howTo });
  let title;
  let items;

  switch (pattern) {
    case 'contact.fat':
    case 'contact.thin':
    case 'contact.topped':
      title = 'Strike: move the low point forward';
      items = [
        rx(DRILLS.towelBehind, '15 balls'),
        rx(DRILLS.divotForward, '10 swings, then 10 balls'),
        rx(DRILLS.feetTogether, '10 balls at half speed'),
      ];
      break;
    case 'contact.toe':
    case 'contact.heel':
    case 'contact.shank':
      title = 'Strike: find the center of the face';
      items = [
        rx(DRILLS.teeGate, '15 balls'),
        rx(DRILLS.wallButt, '10 slow practice swings'),
        rx(DRILLS.brushGrass, '10 swings, then 5 balls'),
      ];
      break;
    case 'curve.slice':
      title = 'Tame the slice: grip and path';
      items = [
        rx(DRILLS.gripCheck, '5 minutes before hitting'),
        rx(DRILLS.headcover, '15 balls at 75% speed'),
        rx(DRILLS.splitHand, '10 slow swings, then 5 balls'),
      ];
      break;
    case 'curve.hook':
      title = 'Tame the hook: quiet hands, keep turning';
      items = [
        rx(DRILLS.gripCheck, '5 minutes before hitting'),
        rx(DRILLS.holdFinish, '10 balls'),
        rx(DRILLS.feetTogether, '10 balls at half speed'),
      ];
      break;
    case 'start.left':
    case 'start.right':
      title = 'Start line: aim and alignment';
      items = [
        rx(DRILLS.alignmentSticks, 'set up for the whole session'),
        rx(DRILLS.gate, '15 balls'),
        rx(DRILLS.holdFinish, '10 balls'),
      ];
      break;
    default:
      title = 'Maintenance: keep the good swing grooved';
      items = [
        rx(DRILLS.gate, '10 balls'),
        rx(DRILLS.feetTogether, '10 balls at half speed'),
        rx(DRILLS.holdFinish, '10 balls, change club every shot'),
      ];
  }

  return {
    pattern,
    title,
    createdAt: new Date().toISOString(),
    items: items.concat([Object.assign({}, TRACKED_FINISHER)])
      .map(item => Object.assign({ done: false }, item)),
  };
}
