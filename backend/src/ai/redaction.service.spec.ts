import { RedactionService } from './redaction.service';

describe('RedactionService', () => {
  const redaction = new RedactionService();

  describe('redactText', () => {
    it('redacts a Stellar secret key', () => {
      const secret = 'S' + 'A'.repeat(55);
      const result = redaction.redactText(`my key is ${secret} keep it safe`);
      expect(result).not.toContain(secret);
      expect(result).toContain('[redacted:stellar-secret-key]');
    });

    it('redacts an email address', () => {
      const result = redaction.redactText('contact me at citizen@example.com please');
      expect(result).not.toContain('citizen@example.com');
      expect(result).toContain('[redacted:email]');
    });

    it('redacts a long digit run (national-ID-shaped)', () => {
      const result = redaction.redactText('my id number is 123456789012');
      expect(result).not.toContain('123456789012');
    });

    it('leaves ordinary text untouched', () => {
      const text = 'When does my food voucher expire?';
      expect(redaction.redactText(text)).toBe(text);
    });
  });

  describe('stripFinancialFields', () => {
    it('removes top-level financial keys', () => {
      const input = { voucherId: 1, amount: '500', spent: '100', category: 'food' };
      const result = redaction.stripFinancialFields(input);
      expect(result).toEqual({ voucherId: 1, category: 'food' });
    });

    it('removes financial keys nested inside arrays and objects', () => {
      const input = {
        vouchers: [
          { voucherId: 1, amount: '500', region: 'lagos' },
          { voucherId: 2, spent: '10', region: 'abuja' },
        ],
        program: { name: 'Default', totalBudget: '1000000', spentBudget: '500' },
      };
      const result = redaction.stripFinancialFields(input);
      expect(result).toEqual({
        vouchers: [
          { voucherId: 1, region: 'lagos' },
          { voucherId: 2, region: 'abuja' },
        ],
        program: { name: 'Default' },
      });
    });

    it('leaves non-financial data completely unchanged', () => {
      const input = { category: 'food', region: 'lagos', merchants: ['a', 'b'] };
      expect(redaction.stripFinancialFields(input)).toEqual(input);
    });
  });
});
