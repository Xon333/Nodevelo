import { AsyncLocalStorage } from "async_hooks";

interface PersistenceScope {
  active: boolean;
}

const scope = new AsyncLocalStorage<PersistenceScope>();
let activeShared = 0;
let queuedExclusive = 0;
let exclusiveTail: Promise<unknown> = Promise.resolve();
let sharedWaiters: Array<() => void> = [];
let idleWaiters: Array<() => void> = [];

function releaseIdleWaiters() {
  const waiters = idleWaiters;
  idleWaiters = [];
  for (const resolve of waiters) {
    resolve();
  }
}

function releaseSharedWaiters() {
  const waiters = sharedWaiters;
  sharedWaiters = [];
  for (const run of waiters) {
    run();
  }
}

function waitForIdle(): Promise<void> {
  if (activeShared === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    idleWaiters.push(resolve);
  });
}

export function withPersistenceAccess<T>(operation: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.active) {
    return operation();
  }

  return new Promise<T>((resolve, reject) => {
    const run = () => {
      const token: PersistenceScope = { active: true };
      activeShared++;

      void Promise.resolve()
        .then(() => scope.run(token, operation))
        .then(resolve, reject)
        .finally(() => {
          token.active = false;
          activeShared--;
          if (activeShared === 0) {
            releaseIdleWaiters();
          }
        });
    };

    if (queuedExclusive === 0) {
      run();
      return;
    }

    sharedWaiters.push(run);
  });
}

export function withExclusivePersistence<T>(operation: () => Promise<T>): Promise<T> {
  if (scope.getStore()?.active) {
    return Promise.reject(new Error("Exclusive persistence cannot be nested."));
  }

  queuedExclusive++;

  const run = exclusiveTail.catch(() => undefined).then(async () => {
    await waitForIdle();
    const token: PersistenceScope = { active: true };
    try {
      return await scope.run(token, operation);
    } finally {
      token.active = false;
    }
  });

  exclusiveTail = run;
  void run.catch(() => undefined).finally(() => {
    queuedExclusive--;
    if (queuedExclusive === 0) {
      releaseSharedWaiters();
    }
  });

  return run;
}
