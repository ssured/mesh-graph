import {
  mergeNodeState as defaultMerge,
  SubjectPropertyState as State,
  pickKeys,
} from './crdt';
import {
  generateId as defaultGenerateId,
  getCurrentState as defaultGetCurrentState,
  LRUSet,
} from './utils';
import { EventHub } from './EventHub';

export type Lambda = () => void;

type MessageTypes = {
  get: {
    key: string;
  };
  put: {
    key: string;
    value: State;
    replyTo?: string;
  };
};

class Message<MessageType extends keyof MessageTypes> {
  public readonly msgId = defaultGenerateId();
  constructor(
    public readonly type: MessageType,
    public readonly payload: MessageTypes[MessageType]
  ) {}
}

export class GetMessage extends Message<'get'> {
  constructor(key: string) {
    super('get', { key });
  }
}

export class PutMessage extends Message<'put'> {
  constructor(key: string, value: State, replyTo?: CRDTNodeMessage) {
    super('put', { key, value, replyTo: replyTo && replyTo.msgId });
  }
}

export const defaultCoreConfig = {
  merge: defaultMerge,
  generateId: defaultGenerateId,
  getCurrentState: defaultGetCurrentState,
  createNewState: (_id: string): State => ({}),
};

interface CRDT {
  has(id: string): boolean;
  get(id: string): State;
  isReady(id: string): boolean;
  notifyReady(id: string): void;
  merge(id: string, state: State): Set<string>;
}

type CRDTNodeMessage = GetMessage | PutMessage;
export type Emit = (message: CRDTNodeMessage) => void;
export type Listener = (message: CRDTNodeMessage) => void;

export class Core implements CRDT {
  protected config: typeof defaultCoreConfig;
  protected emit!: Emit;
  private listener!: Listener;

  protected touchedIds = new Set<string>();

  private _getMsgIdsCache: (listener: Listener) => LRUSet = (() => {
    const wm = new WeakMap<Listener, LRUSet>();
    return (listener: Listener): LRUSet => {
      const current = wm.get(listener);
      if (current) return current;
      wm.set(listener, new LRUSet(10));
      return wm.get(listener)!;
    };
  })();

  protected hub = new EventHub<CRDTNodeMessage>((source, message) => {
    const messageSentByCore = source === this.listener;

    if (!messageSentByCore) {
      this._getMsgIdsCache(source).add(message.msgId);
    }

    if (message.type === 'put') {
      if (Object.keys(message.payload.value).length === 0) {
        return () => false; // skip all further processing
      }

      if (messageSentByCore) {
        // do not send our put messages to their original source
        const { replyTo } = message.payload;
        return listener => !this._getMsgIdsCache(listener).has(replyTo!);
      } else {
        // intercept put messages from others
        // don't forward these messages to everybody, but handle it ourselves
        return listener => listener === this.listener;
      }
    }

    // Just an idea, maybe it's ok to have a dominant core, which wont propagate
    // get messages if it knows the correct value
    // if (
    //   message.type === 'get' &&
    //   source !== this.listener &&
    //   this.isReady(message.payload.key)
    // ) {
    //   // reply with the data and do not propagate the get request
    //   source(
    //     new PutMessage(
    //       message.payload.key,
    //       this.get(message.payload.key)!,
    //       message
    //     )
    //   );
    //   return () => false;
    // }

    return () => true;
  });
  public connect = this.hub.connect.bind(this.hub);

  constructor(options: Partial<typeof defaultCoreConfig> = {}) {
    this.config = { ...defaultCoreConfig, ...options };
    this.connect(emit => {
      this.emit = emit;
      this.listener = message => {
        if (message.type === 'get') return; // we do not provide information

        if (!this.has(message.payload.key)) {
          return; // we only collect data of known keys
        }

        this.merge(message.payload.key, message.payload.value, message);
      };
      return this.listener;
    });
  }
  public get getCurrentState() {
    return this.config.getCurrentState;
  }

  protected pendingIds = new Map<string, Lambda>();
  protected stateMap = new Map<string, State>();

  public has(id: string): boolean {
    return this.stateMap.has(id) || this.touchedIds.has(id);
  }

  public get(id: string): State {
    if (!this.stateMap.has(id)) {
      if (this.touchedIds.has(id)) {
        this.touchedIds.delete(id);
      }

      const state = this.config.createNewState(id);
      this.stateMap.set(id, state);

      const request = new GetMessage(id);
      this.emit(request);

      // listen on the wire until we get a response with data
      this.setPending(
        id,
        this.connect(_emit => message => {
          if (
            message.type === 'put' &&
            message.payload.replyTo === request.msgId
          ) {
            this.notifyReady(id);
          }
        })
      );
    }
    return this.stateMap.get(id)!;
  }

  /**
   * Notify the Core that it should record put messages with the provided id.
   * @param id
   */
  public touch(id: string): void {
    if (!this.stateMap.has(id)) {
      this.touchedIds.add(id);
    }
  }

  public isReady(id: string) {
    return this.has(id) && this.pendingIds.has(id);
  }

  protected setPending(id: string, disposer: Lambda) {
    const current = this.pendingIds.get(id);
    if (current) current();
    this.pendingIds.set(id, disposer);
  }

  public notifyReady(id: string) {
    const current = this.pendingIds.get(id);
    if (current) current();
    this.pendingIds.delete(id);
  }

  public merge(id: string, incoming: State, message?: PutMessage): Set<string> {
    const current = this.get(id);
    const changes = this.config.merge(current, incoming);
    if (changes.size > 0) {
      this.emit(new PutMessage(id, pickKeys(incoming, changes), message));
    }
    return changes;
  }
}
