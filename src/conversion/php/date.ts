// date() do PHP calculado na requisição (ex.: ano do copyright), no fuso do site. Copiado para src/settings/date.ts do projeto gerado.
const timeZone = "America/Sao_Paulo";
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function phpDate(format: string, date: Date = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23", weekday: "short" })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day), hour = Number(parts.hour) % 24;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const pad = (value: number) => String(value).padStart(2, "0");
  const values: Record<string, string> = {
    d: pad(day), j: String(day), m: pad(month), n: String(month), Y: String(year), y: String(year).slice(-2),
    H: pad(hour), G: String(hour), i: pad(Number(parts.minute)), s: pad(Number(parts.second)),
    D: days[weekday].slice(0, 3), l: days[weekday], N: String(weekday || 7), w: String(weekday),
    M: months[month - 1].slice(0, 3), F: months[month - 1],
  };
  let out = "";
  for (let i = 0; i < format.length; i++) {
    const char = format[i];
    if (char === "\\") { out += format[++i] ?? ""; continue; }
    out += values[char] ?? char;
  }
  return out;
}
