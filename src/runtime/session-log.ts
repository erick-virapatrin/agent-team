import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'

/**
 * Read the full event log of one loaded Session.
 *
 * Harness 0.2.0 removed the `Session.events` accessor; `snapshotEvents()` is the
 * remaining synchronous reader of the append-only log (the same call the Harness
 * Agent Team implementation uses), and it returns a stable frozen snapshot.
 * @param session - a loaded session.
 * @returns every event of the session, inherited prefix included.
 */
export function liveSessionEvents(session: Session): readonly SessionEvent[] {
  return session.snapshotEvents()
}

/**
 * Read the full event log of one persisted Session through a short-lived read handle.
 *
 * Replaces `sessionPersistence.inspect()`, removed in Harness 0.2.0.
 * @param persistence - the durable session store.
 * @param id - the stored session to read.
 * @param signal - optional cancellation observed by open and read.
 * @returns every committed event of the stored session.
 */
export async function readPersistedSessionEvents(
  persistence: SessionPersistence,
  id: SessionId,
  signal?: AbortSignal,
): Promise<readonly SessionEvent[]> {
  const options = signal === undefined ? {} : { signal }
  const handle = await persistence.open(id, 'read', options)
  try {
    const { events } = await handle.read(0, void 0, options)
    return events
  } finally {
    await handle.close()
  }
}
