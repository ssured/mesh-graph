import { Core, Emit, PutMessage } from '../src/Core';
import { ObservableCore } from '../src/ObservableCore';
import { autorun } from 'mobx';
import { LRUSet } from '../src/utils';

describe('Observable core integrates mobx and core', () => {
  test('it works unobserved', async () => {
    let state = 'now';
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

    const observedKeys = new Set<string>();

    const observableCore = new ObservableCore(
      key => observedKeys.add(key),
      key => observedKeys.delete(key),
      core
    );
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
    expect(Array.from(observedKeys)).toEqual([]);
    expect(Object.keys(root.subject)).toEqual(['property']);

    emit(new PutMessage('subject', { property: { [state]: [0, 'value'] } }));
    expect(messages.splice(0)).toEqual([]);

    expect(root.subject.property).toBe('value');
    expect(Object.keys(root.subject)).toEqual(['property']);
  });

  test('it works observed', async () => {
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

    const observedKeys = new Set<string>();

    const observableCore = new ObservableCore(
      key => observedKeys.add(key),
      key => observedKeys.delete(key),
      core
    );
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
    expect(Array.from(observedKeys)).toEqual(['subject']);
    expect(Object.keys(root.subject)).toEqual(['toJSON', 'property']);

    emit(new PutMessage('subject', { property: { [state]: [0, 'value'] } }));
    expect(messages.splice(0)).toEqual([]);

    expect(values.splice(0).map(o => JSON.parse(o))).toEqual([
      {},
      { property: 'value' },
    ]);

    expect(root.subject.property).toBe('value');
    expect(Object.keys(root.subject)).toEqual(['toJSON', 'property']);

    disposer();
    expect(Array.from(observedKeys)).toEqual([]);
  });

  test('single value updates', async () => {
    let state = 'state';
    const core = new Core({
      getCurrentState: () => state,
    });

    let current = 1;
    const ids = new Map<string, string>();

    const Amessages: any[] = [];
    core.connect(emit => async message => {
      // record for testing
      const { msgId, ...body } = message;
      ids.set(msgId, String(current++));
      if (body.type === 'put' && body.payload.replyTo) {
        body.payload.replyTo = ids.get(body.payload.replyTo) || '???';
      }
      Amessages.push({ msgId: ids.get(msgId)!, ...body });

      // answer
      if (message.type === 'get') {
        await new Promise(res => setTimeout(res, 10));
        emit(
          new PutMessage(
            message.payload.key,
            {
              property: { [state]: [0, 'value'] },
            },
            message
          )
        );
      }
    });

    const Bmessages: any[] = [];
    core.connect(_emit => async message => {
      // record for testing
      const { msgId, ...body } = message;
      ids.set(msgId, String(current++));
      if (body.type === 'put' && body.payload.replyTo) {
        body.payload.replyTo = ids.get(body.payload.replyTo) || '???';
      }
      Bmessages.push({ msgId: ids.get(msgId)!, ...body });
    });

    const observedKeys = new Set<string>();

    const observableCore = new ObservableCore(
      key => observedKeys.add(key),
      key => observedKeys.delete(key),
      core
    );
    const { root } = observableCore;

    const values: any[] = [];

    {
      const stop = autorun(() => values.push(root.subject.property));

      expect(values.splice(0)).toEqual([undefined]);

      expect(Array.from(observedKeys)).toEqual(['subject']);
      expect(Amessages.splice(0)).toEqual([
        { msgId: '1', type: 'get', payload: { key: 'subject' } },
      ]);
      expect(Bmessages.splice(0)).toEqual([
        { msgId: '2', type: 'get', payload: { key: 'subject' } },
      ]);

      await new Promise(res => setTimeout(res, 10));

      expect(root.subject.property).toEqual('value');
      expect(values.splice(0)).toEqual(['value']);

      expect(Array.from(observedKeys)).toEqual(['subject']);
      expect(Amessages.splice(0)).toEqual([]);
      expect(Bmessages.splice(0)).toEqual([
        {
          msgId: '3',
          type: 'put',
          payload: {
            key: 'subject',
            value: {
              property: { [state]: [0, 'value'] },
            },
            replyTo: '???',
          },
        },
      ]);

      stop();
    }
  });

  test('linked objects updates', async () => {
    let state = 'state';
    const core = new Core({
      getCurrentState: () => state,
    });

    let current = 1;
    const ids = new Map<string, string>();

    const Amessages: any[] = [];
    core.connect(emit => async message => {
      // record for testing
      const { msgId, ...body } = message;
      ids.set(msgId, String(current++));
      if (body.type === 'put' && body.payload.replyTo) {
        body.payload.replyTo = ids.get(body.payload.replyTo) || '???';
      }
      Amessages.push({ msgId: ids.get(msgId)!, ...body });

      // answer
      if (message.type === 'get') {
        await new Promise(res => setTimeout(res, 10));
        switch (message.payload.key) {
          case 'subject':
            emit(
              new PutMessage(
                message.payload.key,
                {
                  linked: { [state]: [1, 'linkedsubject'] },
                },
                message
              )
            );
            break;
          case 'linkedsubject':
            emit(
              new PutMessage(
                message.payload.key,
                {
                  property: { [state]: [0, 'value'] },
                },
                message
              )
            );
            break;
        }
      }
    });

    const Bmessages: any[] = [];
    core.connect(_emit => async message => {
      // record for testing
      const { msgId, ...body } = message;
      ids.set(msgId, String(current++));
      if (body.type === 'put' && body.payload.replyTo) {
        body.payload.replyTo = ids.get(body.payload.replyTo) || '???';
      }
      Bmessages.push({ msgId: ids.get(msgId)!, ...body });
    });

    const observedKeys = new Set<string>();

    const observableCore = new ObservableCore(
      key => observedKeys.add(key),
      key => observedKeys.delete(key),
      core
    );
    const { root } = observableCore;

    const values: any[] = [];

    {
      const stop = autorun(() =>
        values.push(
          root.subject.linked && (root.subject.linked as any).property
        )
      );

      expect(values.splice(0)).toEqual([undefined]);

      expect(Array.from(observedKeys)).toEqual(['subject']);
      expect(Amessages.splice(0)).toEqual([
        { msgId: '1', type: 'get', payload: { key: 'subject' } },
      ]);
      expect(Bmessages.splice(0)).toEqual([
        { msgId: '2', type: 'get', payload: { key: 'subject' } },
      ]);

      await new Promise(res => setTimeout(res, 10));

      expect(root.subject.linked).toBeDefined();
      expect(values.splice(0)).toEqual([undefined]);

      expect(Array.from(observedKeys)).toEqual(['subject', 'linkedsubject']);
      expect(Amessages.splice(0)).toEqual([
        {
          msgId: '4',
          type: 'get',
          payload: {
            key: 'linkedsubject',
          },
        },
      ]);
      expect(Bmessages.splice(0)).toEqual([
        {
          msgId: '3',
          type: 'put',
          payload: {
            key: 'subject',
            value: {
              linked: { [state]: [1, 'linkedsubject'] },
            },
            replyTo: '???',
          },
        },
        {
          msgId: '5',
          type: 'get',
          payload: {
            key: 'linkedsubject',
          },
        },
      ]);

      await new Promise(res => setTimeout(res, 10));

      expect((root.subject.linked as any).property).toEqual('value');
      expect(values.splice(0)).toEqual(['value']);

      expect(Array.from(observedKeys)).toEqual(['subject', 'linkedsubject']);
      expect(Amessages.splice(0)).toEqual([]);
      expect(Bmessages.splice(0)).toEqual([
        {
          msgId: '6',
          type: 'put',
          payload: {
            key: 'linkedsubject',
            value: {
              property: { [state]: [0, 'value'] },
            },
            replyTo: '???',
          },
        },
      ]);

      stop();

      expect(Array.from(observedKeys)).toEqual([]);
    }
  });

  test('setters and linked objects', async () => {
    let state = 'state';
    const core = new Core({
      getCurrentState: () => state,
    });

    let current = 1;
    const ids = new Map<string, string>();

    const Amessages: any[] = [];
    core.connect(_emit => async message => {
      // record for testing
      const { msgId, ...body } = message;
      ids.set(msgId, String(current++));
      if (body.type === 'put' && body.payload.replyTo) {
        body.payload.replyTo = ids.get(body.payload.replyTo) || '???';
      }
      Amessages.push({ msgId: ids.get(msgId)!, ...body });

      // answer
      if (message.type === 'get') {
        await new Promise(res => setTimeout(res, 10));
        switch (message.payload.key) {
          case 'subject':
            break;
        }
      }
    });

    const observedKeys = new Set<string>();

    const observableCore = new ObservableCore(
      key => observedKeys.add(key),
      key => observedKeys.delete(key),
      core
    );
    const { root } = observableCore;

    const values: any[] = [];

    {
      root.subject.property = 'yo fuf';
      expect(Amessages.splice(0)).toEqual([
        {
          msgId: '1',
          type: 'get',
          payload: {
            key: 'subject',
          },
        },
        {
          msgId: '2',
          type: 'put',
          payload: {
            key: 'subject',
            value: { property: { [state]: [0, 'yo fuf'] } },
            replyTo: '???',
          },
        },
      ]);

      const stop = autorun(() => values.push(root.subject.property));

      expect(values.splice(0)).toEqual(['yo fuf']);

      stop();

      expect(Array.from(observedKeys)).toEqual([]);
    }
  });
});
