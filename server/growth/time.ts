export function toShanghaiIso(input: Date | number | string = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }
  return date.toISOString();
}

export function nowShanghaiIso(input: Date | number | string = new Date()) {
  return toShanghaiIso(input);
}
