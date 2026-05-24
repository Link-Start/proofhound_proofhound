import { expect, type Page } from '@playwright/test';

export async function expectTooltipOnTop(page: Page, text: string) {
  const tooltip = page.locator('[role="tooltip"]').filter({ hasText: text });
  await expect(tooltip).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate((tooltipText) => {
        const tooltipElement = Array.from(document.querySelectorAll('[role="tooltip"]')).find((element) =>
          element.textContent?.includes(tooltipText),
        );
        if (!tooltipElement) return false;
        const rect = tooltipElement.getBoundingClientRect();
        const wrapperElement = tooltipElement.parentElement;
        const previousPointerEvents = (tooltipElement as HTMLElement).style.pointerEvents;
        const previousWrapperPointerEvents = wrapperElement?.style.pointerEvents;
        (tooltipElement as HTMLElement).style.pointerEvents = 'auto';
        if (wrapperElement) wrapperElement.style.pointerEvents = 'auto';
        const topElement = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        (tooltipElement as HTMLElement).style.pointerEvents = previousPointerEvents;
        if (wrapperElement && previousWrapperPointerEvents !== undefined) {
          wrapperElement.style.pointerEvents = previousWrapperPointerEvents;
        }
        return Boolean(
          topElement && (tooltipElement.contains(topElement) || topElement.contains(tooltipElement)),
        );
      }, text),
    )
    .toBe(true);
}
