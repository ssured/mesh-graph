import { Core, Emit, PutMessage } from './Core';
import {
  observable,
  IObservableValue,
  onBecomeObserved,
  action,
  onBecomeUnobserved,
  runInAction,
} from 'mobx';
import {
  StorableValue,
  Everything,
  StorableObject,
  PropTypes,
  Value,
  valueAt,
  PropertyState,
} from './crdt';

class ObservableSubject<Shape extends StorableObject> {
  constructor(
    protected notifyPropertyChange: (key: string, value: StorableValue) => void,
    protected getProperty: (key: string) => StorableValue
  ) {}

  private propertyBoxes = new Map<string, IObservableValue<StorableValue>>();
  private getPropertyBox(key: string): IObservableValue<StorableValue> {
    const current = this.propertyBoxes.get(key);
    if (current) return current;

    const propertyBox = observable.box<StorableValue>(this.getProperty(key));
    this.propertyBoxes.set(key, propertyBox);
    return propertyBox;
  }

  set(
    key: string,
    value: Exclude<StorableValue, undefined>,
    notify: boolean = false
  ) {
    const box = this.getPropertyBox(key);
    if (box.get() !== value) {
      runInAction(() => this.ownKeys.add(key));
      box.set(value);
      if (notify) {
        this.notifyPropertyChange(key, value);
      }
    }
  }

  private ownKeys = observable.set<string>();
  public proxy = new Proxy<Shape>({} as any, {
    get: (_: any, key: string | number | symbol) => {
      if (typeof key !== 'string') return Reflect.get(_, key);
      return this.getPropertyBox(key).get();
    },
    set: (_: any, key: string | number | symbol, value: any) => {
      if (typeof key !== 'string') return Reflect.set(_, key, value);
      if (value === undefined) return false;
      this.set(key, value, true);
      return true;
    },
    getOwnPropertyDescriptor,
    ownKeys: () => {
      return [...this.ownKeys];
    },
  });
}

export class ObservableCore<Shape extends Everything = Everything> {
  public readonly observedKeys = observable.set<string>();

  protected emit!: Emit;
  constructor(public readonly core: Core) {
    core.connect(emit => {
      this.emit = emit;
      return message => {
        if (message.type !== 'put') return;
        const { key, value } = message.payload;

        if (!this.subjectBoxes.has(key)) return;

        const subject = this.getSubject(key);
        const coreSubject = core.get(key);
        const now = core.getCurrentState();

        for (const property of Object.keys(value)) {
          const value = valueAt(now, coreSubject[property] || {});
          if (value === undefined) continue;
          subject.set(property, this.toStorableValue(value), false);
        }
      };
    });
  }

  private subjectBoxes = new Map<
    string,
    IObservableValue<ObservableSubject<Shape[string]>>
  >();

  private idForProxyMap = new WeakMap<StorableObject, string>();

  public getId(object: StorableObject): string | undefined {
    return this.idForProxyMap.get(object);
  }

  private toValue(storableValue: StorableValue): Value {
    if (storableValue === undefined) {
      throw new Error('cannot convert undefined value');
    }
    if (typeof storableValue !== 'object' || storableValue === null) {
      return [PropTypes.Primitive, storableValue];
    }
    const id = this.getId(storableValue);
    if (id == null)
      throw new Error(`cannot convert ${JSON.stringify(storableValue)}`);

    return [PropTypes.Reference, id];
  }
  private toStorableValue(value: Value): Exclude<StorableValue, undefined> {
    return value[0] === PropTypes.Primitive ? value[1] : this.root[value[1]];
  }

  protected getSubjectBox(
    key: string
  ): IObservableValue<ObservableSubject<Shape[string]>> {
    const current = this.subjectBoxes.get(key);
    if (current) return current;

    const onPropertyChange = (
      property: string,
      storableValue: StorableValue
    ): void => {
      if (storableValue === undefined) return;

      this.emit(
        new PutMessage(key, {
          [property]: {
            [this.core.getCurrentState()]: this.toValue(storableValue),
          },
        })
      );
    };

    const getStorableValueOfProperty = (property: string): StorableValue => {
      const propState: PropertyState | undefined = this.core.get(key)[property];
      if (propState === undefined) return undefined;

      const value = valueAt(this.core.getCurrentState(), propState);
      return value === undefined ? value : this.toStorableValue(value);
    };

    const subjectBox = observable.box(
      new ObservableSubject<Shape[string]>(
        onPropertyChange,
        getStorableValueOfProperty
      )
    );

    this.idForProxyMap.set(subjectBox.get().proxy, key);

    const setPropIsObserved = () =>
      setTimeout(
        action(() => this.observedKeys.add(key)),
        0
      );
    setPropIsObserved(); // default to assume we are in an observable context
    onBecomeObserved(subjectBox, setPropIsObserved);
    const setPropIsUnobserved = () =>
      setTimeout(
        action(() => this.observedKeys.delete(key)),
        0
      );
    onBecomeUnobserved(subjectBox, setPropIsUnobserved);

    this.subjectBoxes.set(key, subjectBox);
    return subjectBox;
  }

  public getSubject = (key: string): ObservableSubject<Shape[string]> => {
    return this.getSubjectBox(key).get();
  };

  public root: Shape = new Proxy<Shape>({} as any, {
    get: (_: any, key: string | number | symbol) => {
      if (typeof key !== 'string') return;

      return this.getSubject(key).proxy;
    },
    set: () => {
      return false;
    },
    getOwnPropertyDescriptor,
    ownKeys: () => {
      return [...this.subjectBoxes.keys()];
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
