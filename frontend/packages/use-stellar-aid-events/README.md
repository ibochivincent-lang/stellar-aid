# @stellar-aid/use-events

React hooks for stellar-aid's live voucher event stream — the citizen /
merchant / auditor frontend (tracked as its own Wave issue, still unbuilt as
of this package landing) is the intended consumer.

Scoped analog of [Orbital](https://github.com/determined-001/orbital_stellar)'s
`pulse-notify`: same shape (a hook that opens an `EventSource` and hands back
`{ event, events, connected, error }`), but reading stellar-aid's own decoded
`aid_voucher` contract events instead of generic Horizon operations.

## Usage

```tsx
import { useVoucherStream } from '@stellar-aid/use-events';

function RedemptionFeed() {
  const { events, connected } = useVoucherStream({
    baseUrl: process.env.NEXT_PUBLIC_STELLAR_AID_API!,
    eventTypes: ['redeemed'],
  });

  if (!connected) return <p>Connecting…</p>;
  return (
    <ul>
      {events.map((e) => (
        <li key={e.id}>
          voucher #{(e.data as { voucherId: number }).voucherId} redeemed for{' '}
          {(e.data as { amount: string }).amount}
        </li>
      ))}
    </ul>
  );
}
```

Backed by `GET /api/events/stream` (Server-Sent Events) on the backend —
see `backend/src/events/`. `EventSource` reconnects on its own, so there is
no manual retry loop here.
