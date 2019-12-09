export enum PropTypes {
  Primitive,
  Reference,
}

export type Primitive = [PropTypes.Primitive, null | number | boolean | string];
export type Reference = [PropTypes.Reference, string];
export type Value = Primitive | Reference;

export type PropertyState = {
  [state: string]: Value;
};
export type SubjectPropertyState = {
  [property: string]: PropertyState;
};

export type StorableValue = Primitive[1] | StorableObject | undefined;
export interface StorableObject {
  [property: string]: StorableValue;
}
export interface Everything {
  [key: string]: StorableObject;
}

const lex = JSON.stringify;

function mergePropState(a: PropertyState, b: PropertyState): boolean {
  let changed = false;
  // TODO change detection fires too often now
  // should fire only if incoming state is newer than current state
  for (const keyB of Object.keys(b) /*.filter(state => state <= now())*/) {
    if (!(keyB in a) || lex(b[keyB]) > lex(a[keyB])) {
      changed = true;
      a[keyB] = b[keyB];
    }
  }
  return changed;
}

/**
 * returns changed keys
 */
export function mergeNodeState(
  a: SubjectPropertyState,
  b: SubjectPropertyState
): Set<string> {
  const changed = new Set<string>();
  for (const keyB of Object.keys(b)) {
    if (keyB in a) {
      if (mergePropState(a[keyB], b[keyB])) {
        changed.add(keyB);
      }
    } else {
      (a as any)[keyB] = JSON.parse(JSON.stringify(b[keyB]));
      changed.add(keyB);
    }
  }
  return changed;
}

// filter state
export const pickKeys = (
  state: SubjectPropertyState,
  keys: Set<string>
): SubjectPropertyState =>
  Object.fromEntries(Object.entries(state).filter(([key]) => keys.has(key)));

export function valueAt(
  state: string,
  stateMap: PropertyState
): undefined | Value {
  const mostRecent = Object.keys(stateMap)
    .filter(s => s <= state)
    .sort()
    .pop();
  return mostRecent === undefined ? undefined : stateMap[mostRecent];
}

function removeHistoryPropertyState(
  state: string,
  propMap: PropertyState
): PropertyState {
  const history: PropertyState = {};
  const historyKeys = Object.keys(propMap)
    .filter(s => s <= state)
    .sort();
  /*const currentKey =*/ historyKeys.pop();
  for (const key of historyKeys) {
    history[key] = propMap[key];
    delete propMap[key];
  }
  return history;
}

export function removeHistory(
  state: string,
  stateMap: SubjectPropertyState
): SubjectPropertyState {
  const history: SubjectPropertyState = {};
  for (const [key, propMap] of Object.entries(stateMap)) {
    history[key] = removeHistoryPropertyState(state, propMap);
  }
  return history;
}
