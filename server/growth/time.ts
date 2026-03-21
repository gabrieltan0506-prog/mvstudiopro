const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0");
}

export function toShanghaiIso(input: Date | number | string = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date input: ${String(input)}`);
  }
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return (
    `${shifted.getUTCFullYear()}-` +
    `${pad(shifted.getUTCMonth() + 1)}-` +
    `${pad(shifted.getUTCDate())}T` +
    `${pad(shifted.getUTCHours())}:` +
    `${pad(shifted.getUTCMinutes())}:` +
    `${pad(shifted.getUTCSeconds())}.` +
    `${pad(shifted.getUTCMilliseconds(), 3)}+08:00`
  );
}

export function nowShanghaiIso(input: Date | number | string = new Date()) {
  return toShanghaiIso(input);
}
