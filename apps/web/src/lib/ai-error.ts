export function aiErrorText(error: unknown): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (error instanceof Error && error.message) return error.message;
  return 'AI request failed';
}

export function describeAiError(message: string, provider?: string) {
  // A 429 can mean either exhausted billing quota or a temporary rate limit.
  // Prefer the provider's explicit billing reason over the HTTP status.
  if (/no credits|insufficient_quota|insufficient.{0,20}(credit|balance)|credit balance|billing|quota.{0,20}exhaust|exceeded your current quota/i.test(message)) {
    return {
      title: 'AI credits exhausted',
      description: 'Add credits to your AI provider account, or choose another provider in Settings.',
      billingUrl: provider === 'openai' ? 'https://platform.openai.com/settings/organization/billing/' : undefined,
    };
  }
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) {
    return { title: 'AI is temporarily rate limited', description: 'Wait a moment, then send your request again.' };
  }
  if (/\b401\b|invalid.{0,15}(api.?key|authentication)|authentication|unauthorized/i.test(message)) {
    return { title: 'Check your AI API key', description: 'Update your provider credentials in AI settings, then try again.' };
  }
  if (/network|failed to fetch|connection|timed? out|timeout/i.test(message)) {
    return { title: 'Couldn’t reach the AI provider', description: 'Check your connection and try again.' };
  }
  return { title: 'AI couldn’t complete this request', description: 'Try again, or check your provider and model in AI settings.' };
}
