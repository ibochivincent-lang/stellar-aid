import { scoreMerchantVelocity, scoreRapidRedemption, scoreRecipientFanout } from './heuristics';

describe('scoreRapidRedemption', () => {
  it('returns null when redeemed well after the threshold', () => {
    expect(scoreRapidRedemption(0, 60_000, 30)).toBeNull();
  });

  it('returns null on out-of-order timestamps (redeemed before issued)', () => {
    expect(scoreRapidRedemption(10_000, 5_000, 30)).toBeNull();
  });

  it('scores near-instant redemption highest', () => {
    const instant = scoreRapidRedemption(0, 100, 30);
    const atThreshold = scoreRapidRedemption(0, 30_000, 30);
    expect(instant).not.toBeNull();
    expect(atThreshold).not.toBeNull();
    expect(instant!.score).toBeGreaterThan(atThreshold!.score);
    expect(instant!.reason).toBe('rapid_redemption');
  });

  it('reason code is Soroban Symbol-safe (<=32 chars, alphanumeric/underscore)', () => {
    const hit = scoreRapidRedemption(0, 1000, 30);
    expect(hit!.reason).toMatch(/^[A-Za-z0-9_]{1,32}$/);
  });
});

describe('scoreMerchantVelocity', () => {
  it('returns null below the threshold', () => {
    expect(scoreMerchantVelocity(5, 10)).toBeNull();
  });

  it('scores at and above the threshold, increasing with volume', () => {
    const atThreshold = scoreMerchantVelocity(10, 10);
    const wayOver = scoreMerchantVelocity(30, 10);
    expect(atThreshold).not.toBeNull();
    expect(wayOver!.score).toBeGreaterThan(atThreshold!.score);
    expect(wayOver!.score).toBeLessThanOrEqual(95);
  });
});

describe('scoreRecipientFanout', () => {
  it('returns null below the threshold', () => {
    expect(scoreRecipientFanout(2, 5)).toBeNull();
  });

  it('scores at and above the threshold, capped at 95', () => {
    const atThreshold = scoreRecipientFanout(5, 5);
    const wayOver = scoreRecipientFanout(50, 5);
    expect(atThreshold).not.toBeNull();
    expect(wayOver!.score).toBe(95);
  });
});
