/** iCalendar (.ics) for one event: Google Calendar, iPhone/Mac Calendar and Outlook import it. */
export function eventIcs(e: { uid: string; title: string; description: string; startsAt: number; url: string; durationMin?: number }): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  // RFC 5545 text escaping + line folding at 75 octets (approximated by characters).
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line: string) => {
    const out: string[] = [];
    for (let i = 0; i < line.length; i += 70) out.push((i ? " " : "") + line.slice(i, i + 70));
    return out.join("\r\n");
  };
  const end = e.startsAt + (e.durationMin ?? 120) * 60_000;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AllOnline//Su kien//VI",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}@allonline`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(e.startsAt)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `DESCRIPTION:${esc((e.description ? e.description + "\n\n" : "") + "Vào phòng: " + e.url)}`,
    `URL:${e.url}`,
    `LOCATION:${esc(e.url)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT30M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${esc(e.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** "Add to Google Calendar" link (opens the browser form pre-filled). */
export function googleCalendarUrl(e: { title: string; description: string; startsAt: number; url: string; durationMin?: number }): string {
  const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const end = e.startsAt + (e.durationMin ?? 120) * 60_000;
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(e.startsAt)}/${stamp(end)}`, details: `${e.description ? e.description + "\n\n" : ""}Vào phòng: ${e.url}`, location: e.url });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
