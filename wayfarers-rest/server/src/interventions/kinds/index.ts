/**
 * Phase 6: register the five intervention kinds at module load.
 *
 * Note: `sway-thread`, `stir-world`, and `mark-npc` need runtime deps,
 * so they're exported as builders and registered explicitly by `index.ts`
 * (the server boot) rather than at import time. Only `plant-rumor` and
 * `beckon` self-register because they have no constructor deps.
 */
import './plant-rumor.ts';
import './beckon.ts';

export { buildSwayThread } from './sway-thread.ts';
export { buildStirWorld } from './stir-world.ts';
export { buildMarkNpc } from './mark-npc.ts';
export { buildRestockLarder } from './restock-larder.ts';
export { buildUpgradeHearth } from './upgrade-hearth.ts';
export { buildShiftFocus } from './shift-focus.ts';
export { buildEscalateScene } from './escalate-scene.ts';
export { buildDefuseScene } from './defuse-scene.ts';
