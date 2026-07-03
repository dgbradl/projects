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
