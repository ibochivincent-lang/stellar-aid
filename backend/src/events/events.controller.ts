import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventEngineService } from './event-engine.service';
import { AidVoucherEvent } from './event.types';

/**
 * Live voucher-lifecycle event stream. The stellar-aid-scoped equivalent of
 * Orbital's `pulse-notify` React hooks — this is the server side a hook
 * like `useVoucherEvents` (see frontend/packages/use-stellar-aid-events)
 * subscribes to over `EventSource`.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly engine: EventEngineService) {}

  @Sse('stream')
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const unsubscribe = this.engine.onEvent((event: AidVoucherEvent) => {
        subscriber.next({ type: event.type, data: event });
      });
      return () => unsubscribe();
    });
  }
}
