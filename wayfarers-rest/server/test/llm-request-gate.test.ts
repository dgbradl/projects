import { describe, expect, it } from 'vitest';
import { RequestGate } from '../src/llm/gate.ts';

function deferred() {
  let resolveFn!: () => void;
  const promise = new Promise<void>((r) => {
    resolveFn = r;
  });
  return { promise, resolve: resolveFn };
}

/** Drain the microtask queue completely. */
const drain = () => new Promise<void>((r) => setTimeout(r, 0));

describe('RequestGate', () => {
  it('serializes concurrent acquisitions FIFO at normal priority', async () => {
    const gate = new RequestGate();
    const order: number[] = [];
    const d1 = deferred();
    const d2 = deferred();
    const d3 = deferred();

    const task = async (n: number, done: { promise: Promise<void> }) => {
      const release = await gate.acquire('normal');
      order.push(n);
      await done.promise;
      release();
    };

    const p1 = task(1, d1);
    const p2 = task(2, d2);
    const p3 = task(3, d3);

    await drain();
    expect(order).toEqual([1]);

    d1.resolve();
    await drain();
    expect(order).toEqual([1, 2]);

    d2.resolve();
    await drain();
    expect(order).toEqual([1, 2, 3]);

    d3.resolve();
    await Promise.all([p1, p2, p3]);
  });

  it('high priority cuts ahead of pending normal-priority work', async () => {
    const gate = new RequestGate();
    const order: string[] = [];
    const dNormal1 = deferred();
    const dNormal2 = deferred();
    const dHigh = deferred();

    // Hold the gate.
    const releaseHold = await gate.acquire('normal');
    order.push('hold');

    const p1 = (async () => {
      const r = await gate.acquire('normal');
      order.push('normal-1');
      await dNormal1.promise;
      r();
    })();
    const p2 = (async () => {
      const r = await gate.acquire('normal');
      order.push('normal-2');
      await dNormal2.promise;
      r();
    })();
    const pHigh = (async () => {
      const r = await gate.acquire('high');
      order.push('high');
      await dHigh.promise;
      r();
    })();

    await drain();
    expect(order).toEqual(['hold']);

    releaseHold();
    await drain();
    expect(order).toEqual(['hold', 'high']);

    dHigh.resolve();
    await drain();
    expect(order).toEqual(['hold', 'high', 'normal-1']);

    dNormal1.resolve();
    await drain();
    expect(order).toEqual(['hold', 'high', 'normal-1', 'normal-2']);

    dNormal2.resolve();
    await Promise.all([p1, p2, pHigh]);
  });

  it('single-flight: only one task holds the gate at a time', async () => {
    const gate = new RequestGate();
    let active = 0;
    let maxActive = 0;
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < 5; i += 1) {
      tasks.push(
        (async () => {
          const release = await gate.acquire('normal');
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((r) => setTimeout(r, 5));
          active -= 1;
          release();
        })(),
      );
    }
    await Promise.all(tasks);
    expect(maxActive).toBe(1);
  });
});
