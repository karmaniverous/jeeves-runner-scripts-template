/**
 * @module calendar/lib/calendar-api
 *
 * Google Calendar REST API helpers for listing calendars and events.
 *
 * Pure HTTP wrappers consumed by calendar/poll. Handles pagination
 * transparently; callers supply an OAuth access token and receive
 * typed results. No dependency on project constants or config.
 */

const CAL_BASE = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEntry {
  id: string;
  summary?: string;
  accessRole?: string;
}

export interface CalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  status?: string;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  recurrence?: string[];
  updated?: string;
  [key: string]: unknown;
}

export async function listCalendars(
  accessToken: string,
): Promise<CalendarEntry[]> {
  const resp = await fetch(`${CAL_BASE}/users/me/calendarList`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    throw new Error(`calendarList failed: ${String(resp.status)}`);
  }
  const data = (await resp.json()) as { items?: CalendarEntry[] };
  return data.items ?? [];
}

async function listEventsPage(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
  pageToken: string | null,
): Promise<{ items?: CalendarEvent[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    maxResults: '250',
    singleEvents: 'true',
    orderBy: 'startTime',
  });
  if (pageToken) params.set('pageToken', pageToken);

  const url = `${CAL_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(
      `events.list failed (${calendarId}): ${String(resp.status)} ${body}`,
    );
  }
  return (await resp.json()) as {
    items?: CalendarEvent[];
    nextPageToken?: string;
  };
}

export async function getAllEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<CalendarEvent[]> {
  const events: CalendarEvent[] = [];
  let pageToken: string | null = null;
  do {
    const page = await listEventsPage(
      accessToken,
      calendarId,
      timeMin,
      timeMax,
      pageToken,
    );
    if (page.items) events.push(...page.items);
    pageToken = page.nextPageToken ?? null;
  } while (pageToken);
  return events;
}
