import { createAtom, IAtom } from 'mobx';
import { Core, Emit, PutMessage } from './Core';
import { Everything, PropTypes, StorableValue, Value, valueAt } from './crdt';
import { generateId } from './utils';

class SubjectHandler {
  constructor(protected graph: ObservableCore, public readonly uuid: string) {}

  private observedCount = 0;
  private addObserved = (): void => {
    if (this.observedCount === 0) {
      this.graph.onObserved(this.uuid);
    }
    this.observedCount += 1;
  };
  private removeObserved = (): void => {
    this.observedCount -= 1;
    if (this.observedCount === 0) {
      this.graph.onUnobserved(this.uuid);
    }
  };

  private thisAtom = createAtom(
    `[${this.uuid}]`,
    this.addObserved,
    this.removeObserved
  );
  private propertyAtoms = new Map<string, IAtom>();

  private getPropertyAtom(key: string): IAtom {
    const current = this.propertyAtoms.get(key);
    if (current) return current;

    const atom = createAtom(
      `[${this.uuid}]:${key}`,
      this.addObserved,
      this.removeObserved
    );
    this.propertyAtoms.set(key, atom);
    this.thisAtom.reportChanged();
    return atom;
  }

  public get observed() {
    return this.observedCount > 0;
  }

  public notifyChange(property: string) {
    if (!this.propertyAtoms.has(property)) return;
    this.getPropertyAtom(property).reportChanged();
  }

  private _proxy: any;
  public get proxy() {
    this.thisAtom.reportObserved();

    if (this._proxy) return this._proxy;
    this._proxy = new Proxy<any>(
      {},
      {
        get: (_: any, key: string | number | symbol) => {
          if (typeof key !== 'string') return Reflect.get(_, key);
          this.getPropertyAtom(key).reportObserved();
          return this.graph.get(this.uuid, key);
        },
        set: (_: any, key: string | number | symbol, value: any) => {
          if (typeof key !== 'string') return Reflect.set(_, key, value);
          if (value === undefined) return false;
          this.graph.set(this.uuid, key, value);
          this.notifyChange(key);
          return true;
        },
        has: (_: any, key: string) => {
          if (typeof key !== 'string') return Reflect.has(_, key);
          return this.propertyAtoms.has(key);
        },
        getOwnPropertyDescriptor,
        ownKeys: () => {
          return Array.from(this.propertyAtoms.keys());
        },
      }
    );
    return this._proxy;
  }
}

export class ObservableCore<Shape extends Everything = Everything> {
  private emit!: Emit;
  private uuidLookup = new WeakMap<object, string>();

  constructor(
    public onObserved: (key: string) => void,
    public onUnobserved: (key: string) => void,
    public readonly core: Core
  ) {
    core.connect(emit => {
      this.emit = emit;
      return message => {
        if (message.type === 'get') return; // we do not provide information

        const { key, value } = message.payload;

        if (!this.subjectCache.has(key)) return;
        const subject = this.getSubject(key);
        for (const property of Object.keys(value)) {
          subject.notifyChange(property);
        }
      };
    });
  }

  protected subjectCache = new Map<string, SubjectHandler>();
  protected getSubject(uuid: string): SubjectHandler {
    const current = this.subjectCache.get(uuid);
    if (current) return current;

    const handler: SubjectHandler = new SubjectHandler(this, uuid);
    this.subjectCache.set(uuid, handler);
    this.core.touch(uuid); // make sure core knows we are reading the subject
    this.uuidLookup.set(handler.proxy, uuid);
    return handler;
  }

  public get(subject: string, property: string): StorableValue {
    const value = valueAt(
      this.core.getCurrentState(),
      this.core.get(subject)[property] || {}
    );
    return value === undefined ? undefined : this.toStorableValue(value);
  }

  public set(subject: string, property: string, value: StorableValue) {
    this.emit(
      new PutMessage(subject, {
        [property]: { [this.core.getCurrentState()]: this.toValue(value) },
      })
    );
  }

  private toValue(storableValue: StorableValue): Value {
    if (storableValue === undefined) {
      throw new Error('cannot convert undefined value');
    }
    if (storableValue == null || typeof storableValue !== 'object') {
      return [PropTypes.Primitive, storableValue];
    }
    const id = this.uuidLookup.get(storableValue);
    if (id == null)
      throw new Error(`cannot convert ${JSON.stringify(storableValue)}`);

    return [PropTypes.Reference, id];
  }

  private toStorableValue(value: Value): Exclude<StorableValue, undefined> {
    return value[0] === PropTypes.Primitive ? value[1] : this.root[value[1]];
  }

  public node = <O extends object>(o: O): O => {
    return this.uuidLookup.get(o)
      ? o
      : Object.assign((this.root as Everything)[generateId()], o);
  };

  public root: Shape = new Proxy<Shape>({} as any, {
    get: (_: any, key: string | number | symbol) => {
      if (typeof key !== 'string') return;

      return this.getSubject(key).proxy;
    },
    set: () => {
      return false;
    },
    has: () => {
      return true;
    },
    getOwnPropertyDescriptor,
    ownKeys: () => {
      return Array.from(this.subjectCache.keys());
    },
  });
}

function getOwnPropertyDescriptor(
  object: any,
  key: string | number | symbol
): PropertyDescriptor | undefined {
  if (typeof key === 'string') {
    return {
      configurable: true,
      enumerable: true,
      writable: true,
    };
  }
  // Safari has a bug that we need to define getOwnPropertyDescriptor, otherwise it doesn't work
  return Reflect.getOwnPropertyDescriptor(object, key);
}
