export class RepositoryHistoryEpoch {
  #requestId: string | undefined;

  begin(requestId: string) {
    const superseded = this.#requestId;
    this.#requestId = requestId;
    return superseded;
  }

  cancel() {
    const canceled = this.#requestId;
    this.#requestId = undefined;
    return canceled;
  }

  finish(requestId: string) {
    if (!this.isCurrent(requestId)) {
      return false;
    }
    this.#requestId = undefined;
    return true;
  }

  isCurrent(requestId: string) {
    return requestId === this.#requestId;
  }
}
