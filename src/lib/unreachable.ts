/**
 * The `default` of a switch that already handles every member of a union. The
 * `never` parameter makes a newly added member a type error at that switch.
 */
export function unreachable(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
