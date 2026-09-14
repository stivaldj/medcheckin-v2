import { test, expect } from '@playwright/test';
import { loginAsDoctor } from './helpers';

/**
 * Switch de tema: Sistema → Claro → Escuro. A escolha fica no aparelho (localStorage), vale antes
 * da pintura (theme-init.js, sem piscar) e "Sistema" volta a seguir o celular/computador.
 */
const isDark = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));

test.describe('tema claro/escuro', () => {
  test('médica: sistema claro → Escuro persiste no reload → Sistema volta a seguir o aparelho', async ({
    browser,
    baseURL,
  }) => {
    const ctx = await browser.newContext({ colorScheme: 'light' });
    await loginAsDoctor(ctx, baseURL!);
    const page = await ctx.newPage();
    await page.goto('/hoje');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAttribute('data-theme-pref', 'system');
    expect(await isDark(page)).toBe(false);

    await toggle.click(); // claro
    await expect(toggle).toHaveAttribute('data-theme-pref', 'light');
    expect(await isDark(page)).toBe(false);
    await toggle.click(); // escuro
    await expect(toggle).toHaveAttribute('data-theme-pref', 'dark');
    expect(await isDark(page)).toBe(true);

    await page.reload();
    expect(await isDark(page)).toBe(true); // aplicado antes da pintura, sem depender do React
    await page.screenshot({ path: 'test-results/tema-medica-escuro.png' });
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-theme-pref', 'dark');

    await page.getByTestId('theme-toggle').click(); // sistema
    await expect(page.getByTestId('theme-toggle')).toHaveAttribute('data-theme-pref', 'system');
    expect(await isDark(page)).toBe(false);
    await ctx.close();
  });

  test('paciente (PWA): sistema escuro → Claro força claro; o botão tem nome acessível', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto('/p/hoje');
    expect(await isDark(page)).toBe(true);
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toHaveAccessibleName(/Tema: sistema/);
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/Tema: claro/);
    expect(await isDark(page)).toBe(false);
    await page.setViewportSize({ width: 390, height: 500 });
    await page.screenshot({ path: 'test-results/tema-pwa-claro.png' });
    await ctx.close();
  });
});
