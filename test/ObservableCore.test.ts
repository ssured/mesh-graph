import { Core, Emit, PutMessage } from '../src/Core';
import { ObservableCore } from '../src/ObservableCore';
import { autorun } from 'mobx';
import { LRUSet } from '../src/utils';

describe('Observable core integrates mobx and core', () => {
  test('it works unobserved', () => {
    let state = 'state';
    const core = new Core({
      getCurrentState: () => state,
    });

    const messages: any[] = [];
    let emit!: Emit;
    core.connect(_emit => {
      emit = _emit;
      return ({ msgId, ...message }) => {
        messages.push(message);
      };
    });

    const observableCore = new ObservableCore(core);
    const { root } = observableCore;
    expect(root.subject.property).toBeUndefined();

    expect(messages.splice(0)).toEqual([
      {
        type: 'get',
        payload: { key: 'subject' },
      },
    ]);

    expect(root.subject.property).toBeUndefined();
    expect(Object.keys(root)).toEqual(['subject']);
    expect([...observableCore.observedKeys]).toEqual(['subject']);
    expect(Object.keys(root.subject)).toEqual([]);

    emit(new PutMessage('subject', { property: { [state]: [0, 'value'] } }));
    expect(messages.splice(0)).toEqual([]);

    expect(root.subject.property).toBe('value');
    expect(Object.keys(root.subject)).toEqual(['property']);
  });

  test('it works observed', () => {
    let state = 'state';
    const core = new Core({
      getCurrentState: () => state,
    });

    const messages: any[] = [];
    let emit!: Emit;
    core.connect(_emit => {
      const myPutMessageIds = new LRUSet(50);
      emit = message => {
        if (message.type === 'put') myPutMessageIds.add(message.msgId);
        _emit(message);
      };
      return ({ msgId, ...message }) => {
        if (
          message.type === 'put' &&
          message.payload.replyTo &&
          myPutMessageIds.has(message.payload.replyTo)
        ) {
          return;
        }

        messages.push(message);
      };
    });

    const observableCore = new ObservableCore(core);
    const { root } = observableCore;

    const values: any[] = [];
    const disposer = autorun(() => {
      values.push(JSON.stringify(root.subject));
    });

    expect(values.splice(0).map(o => JSON.parse(o))).toEqual([{}]);

    expect(messages.splice(0)).toEqual([
      {
        type: 'get',
        payload: { key: 'subject' },
      },
    ]);

    expect(root.subject.property).toBeUndefined();
    expect(Object.keys(root)).toEqual(['subject']);
    expect([...observableCore.observedKeys]).toEqual(['subject']);
    expect(Object.keys(root.subject)).toEqual([]);

    emit(new PutMessage('subject', { property: { [state]: [0, 'value'] } }));
    expect(messages.splice(0)).toEqual([]);

    expect(values.splice(0).map(o => JSON.parse(o))).toEqual([
      {},
      { property: 'value' },
    ]);

    expect(root.subject.property).toBe('value');
    expect(Object.keys(root.subject)).toEqual(['property']);

    disposer();
    expect([...observableCore.observedKeys]).toEqual([]);
  });
});