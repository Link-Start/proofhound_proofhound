import { expect, test } from '@playwright/test';

test('app pages expose language and theme color controls', async ({ page }) => {
  await page.goto('/prompts');

  await page.getByRole('button', { name: '切换主题色' }).click();
  await page.getByRole('menuitemradio', { name: /电光/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'electric');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'electric');

  await expect(page.getByRole('button', { name: '打开主题设置' })).toHaveCount(1);
  await page.getByRole('button', { name: '打开主题设置' }).first().click();
  await expect(page.getByRole('dialog', { name: '主题设置' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '跟随系统' })).toBeVisible();
  await expect(page.getByTestId('theme-option-card')).toHaveCount(5);
  await expect(page.getByTestId('theme-palette-preview')).toHaveCount(5);
  await page.getByRole('radio', { name: '深色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
  await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('radio', { name: '浅色' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'light');
  await expect(page.locator('html')).not.toHaveClass(/(^|\s)dark(\s|$)/);

  await page.getByRole('radio', { name: /暮色/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'twilight');
  await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'twilight');

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '切换语言' }).click();
  await page.getByRole('menuitemradio', { name: /English/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await expect(page.getByTestId('prompts-page').getByRole('heading', { name: 'Prompts' })).toBeVisible();
});
