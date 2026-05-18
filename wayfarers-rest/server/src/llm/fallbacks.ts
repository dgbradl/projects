/**
 * Re-exports Phase 3 placeholder generators so call sites can opt out of
 * caching entirely (e.g. when wiring a brand-new pool). The cache module
 * already calls these via PlaceholderProvider; this barrel exists for the
 * occasional direct-import use case in tests and for clarity.
 */
export { arrivalPlaceholder } from './slots/arrival.ts';
export { rumorPlaceholder } from './slots/rumor.ts';
export { fragmentPlaceholder } from './slots/fragment.ts';
export { namePlaceholder } from './slots/name.ts';
