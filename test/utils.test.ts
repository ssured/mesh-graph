import { LRUSet } from '../src/utils';

describe('LRUSet', () => {
  it('remembers values', () => {
    const mem = new LRUSet(2);

    expect(mem.has('value')).toBeFalsy();

    mem.add('value');

    expect(mem.has('value')).toBeTruthy();

    mem.add('1');
    mem.add('2');
    mem.add('3');
    mem.add('4');

    expect(mem.has('value')).toBeFalsy();
  });
});
