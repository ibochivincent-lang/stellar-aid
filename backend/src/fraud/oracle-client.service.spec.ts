import { Keypair } from '@stellar/stellar-sdk';
import { StellarService } from '../stellar/stellar.service';
import { OracleClientService } from './oracle-client.service';

describe('OracleClientService', () => {
  const ORIGINAL_ENV = process.env;
  const oracleKeypair = Keypair.random();

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function fakeStellar(): jest.Mocked<Pick<StellarService, 'signAndSubmitAs'>> {
    return { signAndSubmitAs: jest.fn() } as unknown as jest.Mocked<Pick<StellarService, 'signAndSubmitAs'>>;
  }

  it('is not configured when the oracle secret or contract id is missing', () => {
    delete process.env.AID_ORACLE_SIGNING_SECRET;
    delete process.env.AID_VOUCHER_CONTRACT_ID;
    const svc = new OracleClientService(fakeStellar() as unknown as StellarService);
    expect(svc.isConfigured).toBe(false);

    process.env.AID_ORACLE_SIGNING_SECRET = oracleKeypair.secret();
    expect(svc.isConfigured).toBe(false); // still missing AID_VOUCHER_CONTRACT_ID

    process.env.AID_VOUCHER_CONTRACT_ID = 'CCONTRACT';
    expect(svc.isConfigured).toBe(true);
  });

  it('throws rather than silently no-op-ing when flagMerchant is called unconfigured', async () => {
    delete process.env.AID_ORACLE_SIGNING_SECRET;
    const svc = new OracleClientService(fakeStellar() as unknown as StellarService);
    await expect(svc.flagMerchant('GMERCHANT', 'sybil')).rejects.toThrow(
      'AID_ORACLE_SIGNING_SECRET is not configured',
    );
  });

  it('signs flag_merchant as the oracle keypair, not the treasury one', async () => {
    process.env.AID_ORACLE_SIGNING_SECRET = oracleKeypair.secret();
    process.env.AID_VOUCHER_CONTRACT_ID = 'CCONTRACT';
    const stellar = fakeStellar();
    stellar.signAndSubmitAs.mockResolvedValue({ hash: 'deadbeef', status: 'PENDING' } as never);

    const svc = new OracleClientService(stellar as unknown as StellarService);
    const result = await svc.flagMerchant('GMERCHANT', 'sybil');

    expect(result).toEqual({ hash: 'deadbeef', status: 'PENDING' });
    expect(stellar.signAndSubmitAs).toHaveBeenCalledWith(
      expect.objectContaining({ publicKey: expect.any(Function) }),
      'CCONTRACT',
      'flag_merchant',
      [oracleKeypair.publicKey(), 'GMERCHANT', 'sybil'],
    );
    // The signing keypair passed through is the oracle one, not any treasury key.
    const signedAs = stellar.signAndSubmitAs.mock.calls[0][0] as Keypair;
    expect(signedAs.publicKey()).toBe(oracleKeypair.publicKey());
  });

  it('signs post_anomaly with the oracle public key as the caller argument', async () => {
    process.env.AID_ORACLE_SIGNING_SECRET = oracleKeypair.secret();
    process.env.AID_VOUCHER_CONTRACT_ID = 'CCONTRACT';
    const stellar = fakeStellar();
    stellar.signAndSubmitAs.mockResolvedValue({ hash: 'abc', status: 'PENDING' } as never);

    const svc = new OracleClientService(stellar as unknown as StellarService);
    await svc.postAnomaly(42, 87, 'rapid_redemption');

    expect(stellar.signAndSubmitAs).toHaveBeenCalledWith(
      expect.anything(),
      'CCONTRACT',
      'post_anomaly',
      [oracleKeypair.publicKey(), 42, 87, 'rapid_redemption'],
    );
  });
});
