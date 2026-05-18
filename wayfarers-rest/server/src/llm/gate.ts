export type RequestPriority = 'high' | 'normal';

/**
 * Single-flight mutex with two FIFO priority queues. Used to serialize Ollama
 * calls across the flavor-cache worker and chronicle pipeline so we never
 * hammer the local model server. Chronicle code passes `'high'`; Phase 4
 * flavor slots pass `'normal'` (the default).
 */
export class RequestGate {
  private inFlight = false;
  private highQueue: Array<() => void> = [];
  private normalQueue: Array<() => void> = [];

  async acquire(priority: RequestPriority = 'normal'): Promise<() => void> {
    if (!this.inFlight) {
      this.inFlight = true;
      return () => this.releaseAndTriggerNext();
    }
    return new Promise<() => void>((resolve) => {
      const onTurn = () => resolve(() => this.releaseAndTriggerNext());
      if (priority === 'high') this.highQueue.push(onTurn);
      else this.normalQueue.push(onTurn);
    });
  }

  private releaseAndTriggerNext(): void {
    const next = this.highQueue.shift() ?? this.normalQueue.shift();
    if (next) next();
    else this.inFlight = false;
  }

  /** Test helper. */
  pendingCount(): { high: number; normal: number } {
    return { high: this.highQueue.length, normal: this.normalQueue.length };
  }
}
