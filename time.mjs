// Day/time in the feeder's local timezone (default Asia/Manila).
// Change it with a TZ_NAME environment variable on Netlify if needed.
export const tzName = () => process.env.TZ_NAME || "Asia/Manila";

const cache = new Map();
function formatter(tz) {
  if (!cache.has(tz)) {
    cache.set(
      tz,
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      })
    );
  }
  return cache.get(tz);
}

export function localParts(ms = Date.now()) {
  const o = Object.fromEntries(formatter(tzName()).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, time: `${o.hour}:${o.minute}` };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
