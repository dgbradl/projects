import type { InterventionKind } from '@shared/types';
import type { InterventionDefinition } from './types.ts';

const REGISTRY = new Map<InterventionKind, InterventionDefinition>();

export function register<TPayload>(def: InterventionDefinition<TPayload>): void {
  REGISTRY.set(def.kind, def as InterventionDefinition);
}

export function get(kind: InterventionKind): InterventionDefinition | undefined {
  return REGISTRY.get(kind);
}

export function listKinds(): InterventionKind[] {
  return [...REGISTRY.keys()];
}

export function listDefinitions(): InterventionDefinition[] {
  return [...REGISTRY.values()];
}

/** Tests reset registrations and re-import the kinds they want. */
export function clearRegistry(): void {
  REGISTRY.clear();
}
