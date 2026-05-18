import type { ThreadDefinition } from './types.ts';

const REGISTRY = new Map<string, ThreadDefinition>();

export function registerThread(def: ThreadDefinition): void {
  REGISTRY.set(def.type, def);
}

export function getThreadDefinition(type: string): ThreadDefinition | undefined {
  return REGISTRY.get(type);
}

export function listRegisteredTypes(): string[] {
  return [...REGISTRY.keys()];
}

/** For tests: clear registrations so an isolated set can be installed. */
export function clearRegistry(): void {
  REGISTRY.clear();
}
