import { describe, expect, it } from 'vitest';
import { aiErrorText, describeAiError } from './ai-error';

describe('AI error presentation', () => {
  it('distinguishes exhausted credits from transient 429 rate limits', () => {
    const billing = describeAiError('AI request failed (429 Too Many Requests): You have no credits remaining.', 'openai');
    expect(billing.title).toBe('AI credits exhausted');
    expect(billing.billingUrl).toBe('https://platform.openai.com/settings/organization/billing/');
    expect(describeAiError('429 Too Many Requests').title).toBe('AI is temporarily rate limited');
  });
  it('does not send another provider to OpenAI billing', () => {
    expect(describeAiError('Your credit balance is too low', 'anthropic').billingUrl).toBeUndefined();
  });
  it('preserves Tauri string errors as well as Error messages', () => {
    expect(aiErrorText('insufficient_quota')).toBe('insufficient_quota');
    expect(aiErrorText(new Error('Unauthorized'))).toBe('Unauthorized');
    expect(aiErrorText(null)).toBe('AI request failed');
  });
});
