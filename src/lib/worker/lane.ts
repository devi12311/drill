import "server-only";

/**
 * One kind of queued work the worker executes: a claim query, an executor, and
 * the housekeeping that recovers what a dead worker left behind. Monitoring runs
 * and chat turns are both lanes; they differ only in how many run at once and how
 * fast new work is noticed.
 */
export interface Lane<T> {
  name: string;
  /** Items executed at once by one worker process. */
  concurrency: number;
  /** How long an idle lane waits before asking the queue again. */
  pollMs: number;
  housekeepingMs: number;
  /** Claim up to `limit` queued items (FOR UPDATE SKIP LOCKED, so replicas are safe). */
  claim(limit: number): Promise<T[]>;
  /** Must settle the item itself, failure included; a throw is only logged. */
  execute(item: T, shutdown: AbortSignal): Promise<void>;
  housekeeping(): Promise<unknown>;
  /**
   * Optional push wake-up (Postgres LISTEN), for lanes a person is waiting on.
   * Polling stays the guarantee: a notification nobody heard is just lost.
   */
  subscribe?(wake: () => void): Promise<void>;
}

export interface RunningLane {
  /** Resolves once every item this lane started has settled. */
  drain(): Promise<void>;
}

export function runLane<T>(lane: Lane<T>, shutdown: AbortSignal): RunningLane {
  const tag = `[drill worker:${lane.name}]`;
  const active = new Set<Promise<void>>();
  // A wake that lands while the loop is busy claiming must not be lost, or new
  // work would wait a full poll interval: it is remembered until the next wait.
  let woken = false;
  let interruptWait: (() => void) | null = null;
  const wake = () => {
    woken = true;
    interruptWait?.();
  };
  shutdown.addEventListener("abort", wake, { once: true });

  const wait = () =>
    new Promise<void>((resolve) => {
      if (woken || shutdown.aborted) return resolve();
      const timer = setTimeout(done, lane.pollMs);
      interruptWait = done;
      function done() {
        clearTimeout(timer);
        interruptWait = null;
        resolve();
      }
    });

  lane.subscribe?.(wake).catch((err) =>
    console.error(`${tag} LISTEN failed — polling only`, err),
  );

  const loop = async () => {
    let lastHousekeeping = 0;
    while (!shutdown.aborted) {
      woken = false;
      try {
        if (Date.now() - lastHousekeeping >= lane.housekeepingMs) {
          lastHousekeeping = Date.now();
          await lane.housekeeping();
        }
        const free = lane.concurrency - active.size;
        if (free > 0) {
          for (const item of await lane.claim(free)) {
            const run: Promise<void> = lane
              .execute(item, shutdown)
              .catch((err) => console.error(tag, err))
              .finally(() => {
                active.delete(run);
                // A freed slot is a reason to look at the queue again right away.
                wake();
              });
            active.add(run);
          }
        }
      } catch (err) {
        // A database blip must not end the loop; the next poll tries again.
        console.error(tag, err);
      }
      await wait();
    }
  };

  void loop();
  return {
    drain: async () => {
      await Promise.all(active);
    },
  };
}
