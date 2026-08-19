import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { expect } from '@playwright/test';
import { launchChromium } from '../utils/browser';
import { resolveLocator } from '../utils/locator';
import { deriveSelectorCandidates } from '../utils/selector-variants';
import { resolveBrowserUrl } from '../utils/runtime-url';
import { resolveFixturePath } from '../routes/fixtures';
import prisma from '../prisma';
import type { Step } from '../types/step';

export interface DrivenSession {
  id: string; projectId: string; userId: string;
  browser: Browser; context: BrowserContext; page: Page; steps: Step[];
}
export interface PageView { screenshot: string; snapshot: string; url: string; title: string }
// ponytail: in-memory, lost on restart, no cap. Add a Recording table only if sessions must survive.
const sessions = new Map<string, DrivenSession>();

export function getDrivenSession(id: string): DrivenSession | undefined { return sessions.get(id); }

export async function captureView(page: Page): Promise<PageView> {
  const [screenshotBuf, snapshot, title] = await Promise.all([
    page.screenshot({ fullPage: true }),
    page.locator('body').ariaSnapshot(),   // structured role+name tree for selector picking
    page.title()
  ]);
  return { screenshot: screenshotBuf.toString('base64'), snapshot, url: page.url(), title };
}

export async function startDrivenSession(input: {
  projectId: string; userId: string; url: string; device?: string;
}): Promise<{ sessionId: string; steps: Step[]; view: PageView }> {
  const browser = await launchChromium();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: 'domcontentloaded' });
    const steps: Step[] = [{ action: 'goto', value: input.url }];
    const id = randomUUID();
    sessions.set(id, { id, projectId: input.projectId, userId: input.userId, browser, context, page, steps });
    return { sessionId: id, steps, view: await captureView(page) };
  } catch (err) {
    await browser.close().catch(() => undefined);
    throw err;
  }
}

export async function stopDrivenSession(id: string): Promise<{ steps: Step[] }> {
  const session = sessions.get(id);
  if (!session) return { steps: [] };
  sessions.delete(id);
  await session.browser.close().catch(() => undefined);
  return { steps: session.steps };
}

export class DrivenActionError extends Error {
  constructor(message: string) { super(message); this.name = 'DrivenActionError'; }
}

export async function performDrivenAction(
  sessionId: string,
  action: Step
): Promise<{ step: Step; view: PageView }> {
  const session = sessions.get(sessionId);
  if (!session) throw new DrivenActionError('Session not found');
  const { page } = session;

  try {
    switch (action.action) {
      case 'goto':
        await page.goto(resolveBrowserUrl(action.value!), { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await resolveLocator(page, action.selector!).first().click();
        break;
      case 'fill':
        await resolveLocator(page, action.selector!).first().fill(action.value ?? '');
        break;
      case 'press':
        await resolveLocator(page, action.selector!).first().press(action.value ?? '');
        break;
      case 'keyboardPress':
        await page.keyboard.press(action.value ?? '');
        break;
      case 'selectOption':
        await resolveLocator(page, action.selector!).first().selectOption(action.value ?? '');
        break;
      case 'upload': {
        // R5: project-scoped findFirst to prevent IDOR (same fix as worker.ts upload case)
        if (!action.value) throw new DrivenActionError('Fixture id required for upload step');
        const fx = await prisma.fixture.findFirst({ where: { id: action.value, projectId: session.projectId } });
        if (!fx) throw new DrivenActionError(`Fixture not found or not accessible: ${action.value}`);
        await resolveLocator(page, action.selector!).first().setInputFiles(resolveFixturePath(fx.storedName));
        break;
      }
      case 'assertVisible': {
        const loc = resolveLocator(page, action.selector!);
        const target = action.options?.nth !== undefined ? loc.nth(action.options.nth) : loc.first();
        await expect(target).toBeVisible({ timeout: action.options?.timeout ?? 5000 });
        break;
      }
      case 'assertHidden': {
        const loc = resolveLocator(page, action.selector!);
        const target = action.options?.nth !== undefined ? loc.nth(action.options.nth) : loc.first();
        await expect(target).toBeHidden({ timeout: action.options?.timeout ?? 5000 });
        break;
      }
      case 'assertText': {
        const loc = resolveLocator(page, action.selector!);
        const target = action.options?.nth !== undefined ? loc.nth(action.options.nth) : loc.first();
        // ponytail: always toContainText; worker's exact→toHaveText variant skipped — add if exact matching needed
        await expect(target).toContainText(action.expected ?? '', { timeout: action.options?.timeout ?? 5000 });
        break;
      }
      case 'assertValue': {
        const loc = resolveLocator(page, action.selector!);
        const target = action.options?.nth !== undefined ? loc.nth(action.options.nth) : loc.first();
        await expect(target).toHaveValue(action.expected ?? '', { timeout: action.options?.timeout ?? 5000 });
        break;
      }
      case 'assertURL':
        if (action.options?.exact) {
          await expect(page).toHaveURL(action.expected!, { timeout: action.options?.timeout ?? 5000 });
        } else {
          await expect(page).toHaveURL(new RegExp(action.expected!), { timeout: action.options?.timeout ?? 5000 });
        }
        break;
      case 'assertTitle':
        if (action.options?.exact) {
          await expect(page).toHaveTitle(action.expected!, { timeout: action.options?.timeout ?? 5000 });
        } else {
          await expect(page).toHaveTitle(new RegExp(action.expected!), { timeout: action.options?.timeout ?? 5000 });
        }
        break;
      case 'assertChecked': {
        const loc = resolveLocator(page, action.selector!);
        const target = action.options?.nth !== undefined ? loc.nth(action.options.nth) : loc.first();
        await expect(target).toBeChecked({ timeout: action.options?.timeout ?? 5000 });
        break;
      }
      case 'assertCount':
        // bare locator (no .first()) per worker.ts pattern
        await expect(resolveLocator(page, action.selector!)).toHaveCount(Number(action.expected!), {
          timeout: action.options?.timeout ?? 5000
        });
        break;
      case 'waitForSelector':
        await resolveLocator(page, action.selector!).first().waitFor({ timeout: action.options?.timeout ?? 5000 });
        break;
      default:
        throw new DrivenActionError(`Unsupported action: ${(action as Step).action}`);
    }
  } catch (err) {
    // Re-throw DrivenActionError as-is; wrap everything else
    if (err instanceof DrivenActionError) throw err;
    throw new DrivenActionError((err as Error).message ?? String(err));
  }

  const step: Step = { ...action };
  if (action.selector) {
    step.selectorCandidates = deriveSelectorCandidates(action.selector);
    try {
      const meta = await resolveLocator(page, action.selector).first()
        .evaluate((el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 120) }));
      step.elementTag = meta.tag;
      step.elementText = meta.text || undefined;
    } catch { /* enrichment optional */ }
  }
  session.steps.push(step);
  return { step, view: await captureView(page) };
}

export async function observeDrivenSession(sessionId: string): Promise<{ view: PageView }> {
  const session = sessions.get(sessionId);
  if (!session) throw new DrivenActionError('Session not found');
  return { view: await captureView(session.page) };
}
