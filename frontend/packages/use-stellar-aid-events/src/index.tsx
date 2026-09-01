import { useEffect, useRef, useState } from 'react';

/**
 * Mirrors the backend's `AidVoucherEvent` union (backend/src/events/event.types.ts).
 * Duplicated here rather than imported so this package has no build-time
 * dependency on the NestJS backend — keep the two in sync by hand, same as
 * any client SDK generated from a server it doesn't share a build with.
 */
export type AidVoucherEventType =
  | 'initialize'
  | 'merchant'
  | 'issued'
  | 'redeemed'
  | 'burned'
  | 'delegate'
  | 'frozen'
  | 'unknown';

export interface AidVoucherEvent<Data = Record<string, unknown>> {
  id: string;
  type: AidVoucherEventType;
  ledger: number;
  ledgerClosedAt: string;
  txHash: string;
  contractId: string;
  data: Data;
}

export interface UseVoucherStreamOptions {
  /** Base URL of the stellar-aid backend, e.g. "https://api.example.org". */
  baseUrl: string;
  /** Only keep this many events client-side (default 50). */
  historyLimit?: number;
  /** Restrict to these event types; omit for all. */
  eventTypes?: AidVoucherEventType[];
}

export interface UseVoucherStreamResult {
  /** Most recent matching event, or null before the first one arrives. */
  event: AidVoucherEvent | null;
  /** Rolling history, newest first, capped at `historyLimit`. */
  events: AidVoucherEvent[];
  connected: boolean;
  error: string | null;
}

/**
 * Subscribes to `${baseUrl}/api/events/stream` (Server-Sent Events) and
 * keeps the latest voucher lifecycle events in state. The stellar-aid
 * equivalent of Orbital's `useStellarEvent` / `useStellarActivity`, scoped
 * to this project's own event shape instead of raw Horizon operations.
 *
 * Reconnects automatically — `EventSource` does this natively on a dropped
 * connection, so no manual backoff loop is needed here.
 */
export function useVoucherStream(options: UseVoucherStreamOptions): UseVoucherStreamResult {
  const { baseUrl, historyLimit = 50, eventTypes } = options;
  const [event, setEvent] = useState<AidVoucherEvent | null>(null);
  const [events, setEvents] = useState<AidVoucherEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const filterRef = useRef(eventTypes);
  filterRef.current = eventTypes;

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setError('EventSource is not available in this environment');
      return;
    }

    const source = new EventSource(`${baseUrl.replace(/\/$/, '')}/api/events/stream`);

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };
    source.onerror = () => {
      // EventSource retries on its own; just reflect the current state.
      setConnected(false);
    };
    source.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as AidVoucherEvent;
        const allow = filterRef.current;
        if (allow && allow.length > 0 && !allow.includes(parsed.type)) return;
        setEvent(parsed);
        setEvents((prev) => [parsed, ...prev].slice(0, historyLimit));
      } catch {
        // Ignore malformed frames rather than tearing down the connection.
      }
    };

    return () => source.close();
  }, [baseUrl, historyLimit]);

  return { event, events, connected, error };
}

/** Convenience wrapper for a single event type, e.g. `useVoucherEvent(base, 'redeemed')`. */
export function useVoucherEvent(
  baseUrl: string,
  type: AidVoucherEventType,
): UseVoucherStreamResult {
  return useVoucherStream({ baseUrl, eventTypes: [type] });
}
