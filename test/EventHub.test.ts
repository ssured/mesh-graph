import { EventHub } from '../src/EventHub';

describe('DeduplicatingHub', () => {
  it('works as a duplex', () => {
    const hub = new EventHub<string>((_source, _message) => _listener => {
      return true;
    });

    const aMsgs: string[] = [];
    let aEmit!: (message: string) => void;
    const a = hub.connect(emit => {
      aEmit = emit;
      return message => {
        aMsgs.push(message);
      };
    });

    const bMsgs: string[] = [];
    let bEmit!: (message: string) => void;
    const b = hub.connect(emit => {
      bEmit = emit;
      return message => {
        bMsgs.push(message);
      };
    });

    aEmit('hi');
    expect(aMsgs.splice(0)).toEqual([]);
    expect(bMsgs.splice(0)).toEqual(['hi']);

    bEmit('yo');
    expect(aMsgs.splice(0)).toEqual(['yo']);
    expect(bMsgs.splice(0)).toEqual([]);

    a();
    b();
  });
});
