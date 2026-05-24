import type { BrowserContext, Page } from '@playwright/test';

export async function seedAuthenticatedSession(context: BrowserContext, _baseURL: string) {
  await context.addInitScript(() => {
    window.localStorage.setItem('proofhound.language', 'zh-CN');
    window.localStorage.setItem('proofhound.theme', 'light');
  });
}

export async function stubCurrentUser(_page: Page) {
  // Self-hosted OSS has a single local actor and no browser login flow.
}
