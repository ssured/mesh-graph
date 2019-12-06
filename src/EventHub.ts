export class EventHub<Message> {
  constructor(
    private intercept: (
      source: (message: Message) => void,
      message: Message
    ) => (listener: (message: Message) => void) => boolean
  ) {}

  private _listeners = new Set<(message: Message) => void>();
  private _subscribe = (listener: (message: Message) => void): (() => void) => {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  };
  private _emit = (
    source: (message: Message) => void,
    message: Message
  ): void => {
    for (const listener of [...this._listeners]
      .filter(listener => listener !== source)
      .filter(this.intercept(source, message))) {
      listener(message);
    }
  };

  public connect(
    createListener: (
      emit: (message: Message) => void
    ) => (message: Message) => void
  ): () => void {
    const listener = createListener((message: Message): void =>
      this._emit(listener, message)
    );
    return this._subscribe(listener);
  }
}
