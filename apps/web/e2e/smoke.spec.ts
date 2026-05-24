import { expect, test } from '@playwright/test';

test('home page opens the local dashboard workspace', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/dashboard');
  const sidebar = page.locator('[data-sidebar="sidebar"]');
  await expect(sidebar).toBeVisible();
  await expect(page.getByText('观测')).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '看板' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '监控' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '提示词' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '发布' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '设置' })).toBeVisible();
  await expect(sidebar.getByRole('link', { name: '对比' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '快速开始' })).toBeVisible();
  await expect(page.getByTestId('dashboard-page')).toBeVisible();
  await expect(page.getByTestId('dashboard-page').getByRole('heading', { name: 'Default Project' })).toBeVisible();
  await expect(page.getByTestId('dashboard-events')).toBeVisible();
  await expect(page.getByTestId('overview-side-rail')).toBeVisible();
  await expect(page.getByTestId('dashboard-asset-summary')).toBeVisible();
  await expect(page.getByText('资产数量')).toBeVisible();
  await expect(page.getByRole('button', { name: /全部/ })).toBeVisible();
  await expect(page.getByTestId('dashboard-events').getByRole('button', { name: /灰度/ })).toHaveCount(0);
  await expect(page.getByText('请求数量')).toHaveCount(0);
});

test('monitoring page renders usage overview', async ({ page }) => {
  await page.goto('/monitoring');
  await expect(page.getByTestId('monitoring-page')).toBeVisible();
  await expect(page.getByTestId('monitoring-page').getByRole('heading', { name: '监控' })).toBeVisible();
  await expect(page.getByText('请求数量')).toBeVisible();
  await expect(page.getByText('提示词排行')).toBeVisible();
  await expect(page.getByText('模型排行')).toBeVisible();
});

test('core app routes render their pages', async ({ page }) => {
  const routes = [
    { path: '/dashboard', testId: 'dashboard-page' },
    { path: '/comparisons', testId: 'comparisons-page' },
    { path: '/quick-start', testId: 'quick-start-page' },
    { path: '/releases', testId: 'releases-page' },
    { path: '/releases/new', testId: 'release-new-page' },
    { path: '/annotations', testId: 'annotations-page' },
    { path: '/annotations/new', testId: 'annotation-new-page' },
    { path: '/settings', testId: 'settings-page' },
  ];

  for (const route of routes) {
    await page.goto(route.path);
    await expect(page.getByTestId(route.testId)).toBeVisible();
  }
});
