import { expect, test } from '@playwright/test';

test('opens first screen and switches modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /미팅 정보 설정/ })).toBeVisible();
  await page.getByRole('button', { name: /태블릿 테이블 모드/ }).click();
  await expect(page.getByRole('button', { name: /태블릿 테이블 모드/ })).toHaveClass(/selected/);
  await page.getByRole('button', { name: /세미나 모드/ }).click();
  await expect(page.getByRole('button', { name: /세미나 모드/ })).toHaveClass(/selected/);
});

test('translates with fallback text input and saves meeting', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /실시간 AI 통역 미팅 개시/ }).click();
  await page.getByLabel('음성 합성').uncheck();
  await page.getByPlaceholder('오류 확인용 텍스트 대체 입력').fill('안녕하세요 오늘 부산 세미나 일정 확인');
  await page.locator('form.manual').getByRole('button', { name: /번역/ }).click();
  await expect(page.locator('.caption.translated')).toContainText(/こんにちは|デモ翻訳|本日/);
  await page.getByRole('button', { name: /기록 보관소/ }).click();
  await expect(page.locator('.archive-list article').first()).toContainText(/1개 문장/);
});

test('shows microphone unsupported or permission error details without killing app', async ({ page, context }) => {
  await context.grantPermissions([]);
  await page.goto('/');
  await page.getByRole('button', { name: /실시간 AI 통역 미팅 개시/ }).click();
  await expect(page.locator('.status')).toContainText(/듣는 중|오류|대기 중/);
  await expect(page.getByText('오류/성능 진단')).toBeVisible();
});

test('creates event session and joins with local websocket demo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /행사 모드/ }).click();
  await page.getByRole('button', { name: /실시간 AI 통역 미팅 개시/ }).click();
  await page.getByRole('button', { name: /세션 생성/ }).click();
  await expect(page.locator('.event-box strong')).toContainText(/[A-Z0-9]{6}/, { timeout: 8000 });
});
