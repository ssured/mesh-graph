import { Core, Emit, PutMessage } from '../src/Core';
import { Value } from 'crdt';

describe('Core', () => {
  it('works as a duplex', () => {
    const core = new Core();

    const aMsgs: any[] = [];
    let aEmit!: Emit;
    const a = core.connect(emit => {
      aEmit = emit;
      return ({ msgId, ...message }) => {
        aMsgs.push(message);
      };
    });

    const bMsgs: any[] = [];
    let bEmit!: Emit;
    const b = core.connect(emit => {
      bEmit = emit;
      return ({ msgId, ...message }) => {
        bMsgs.push(message);
      };
    });

    const subject = 'someuuid';
    const property = 'someprop';
    const state = 'somestate';
    const object: Value = [0, 'object'];

    core.get(subject);

    expect(aMsgs.splice(0)).toEqual([
      { type: 'get', payload: { key: subject } },
    ]);
    expect(bMsgs.splice(0)).toEqual([
      { type: 'get', payload: { key: subject } },
    ]);

    // putting new data responds with a message with proper reply to
    const put = new PutMessage(subject, { [property]: { [state]: object } });
    aEmit(put);

    expect(aMsgs.splice(0)).toEqual([]);
    expect(bMsgs.splice(0)).toEqual([
      {
        type: 'put',
        payload: {
          key: subject,
          value: { [property]: { [state]: object } },
          replyTo: put.msgId,
        },
      },
    ]);

    // nothing happens if we send the same data
    bEmit(put);
    expect(aMsgs.splice(0)).toEqual([]);
    expect(bMsgs.splice(0)).toEqual([]);

    a();
    b();
  });
});
