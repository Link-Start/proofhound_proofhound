import { expect, test } from '@playwright/test';

test('app pages expose language and theme color controls', async ({ page }) => {
  await page.goto('/prompts');

  await page.getByRole('button', { name: 'Change theme color' }).click();
  await page.getByRole('menuitemradio', { name: /Electric/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'electric');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'electric');

  await expect(page.getByRole('button', { name: 'Open theme settings' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Open theme settings' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Theme Settings' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'System' })).toBeVisible();
  await expect(page.getByTestId('theme-option-card')).toHaveCount(5);
  await expect(page.getByTestId('theme-palette-preview')).toHaveCount(5);
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('radio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('radio', { name: /Twilight/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'twilight');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'twilight');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Change language' }).click();
  await page.getByRole('menuitemradio', { name: /中文/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByTestId('prompts-page').getByRole('heading', { name: '提示词' })).toBeVisible();
});
