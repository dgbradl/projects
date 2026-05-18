// Centralized re-exports of slot schemas. Each slot module owns its own
// schema + validator pair; this barrel exists so tests can find them all
// from one import.
export { ARRIVAL_FORMAT, arrivalValidator } from './slots/arrival.ts';
export { RUMOR_FORMAT, rumorValidator } from './slots/rumor.ts';
export { FRAGMENT_FORMAT, fragmentValidator } from './slots/fragment.ts';
export { NAME_FORMAT, nameValidator } from './slots/name.ts';
