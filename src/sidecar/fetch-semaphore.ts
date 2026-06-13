export class FetchSemaphore {
  private available = 1;
  private waitQueue: Array<() => void> = [];

  private take(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waitQueue.push(resolve);
    });
  }

  private give(): void {
    const next = this.waitQueue.shift();
    if (next) {
      next();
    } else {
      this.available++;
    }
  }

  async withPermits<T>(work: () => Promise<T>): Promise<T> {
    await this.take();
    try {
      return await work();
    } finally {
      this.give();
    }
  }

  async withPermitsIfAvailable<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.available <= 0) {
      return null;
    }
    return this.withPermits(work);
  }
}

const fetchSemaphores = new Map<string, FetchSemaphore>();

export function fetchSemaphoreFor(repoPath: string): FetchSemaphore {
  let semaphore = fetchSemaphores.get(repoPath);
  if (!semaphore) {
    semaphore = new FetchSemaphore();
    fetchSemaphores.set(repoPath, semaphore);
  }
  return semaphore;
}

export function releaseFetchSemaphore(repoPath: string): boolean {
  return fetchSemaphores.delete(repoPath);
}

export function fetchSemaphoreSize(): number {
  return fetchSemaphores.size;
}
