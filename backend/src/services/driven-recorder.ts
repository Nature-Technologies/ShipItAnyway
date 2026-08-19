import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import { launchChromium } from '../utils/browser';
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
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  const steps: Step[] = [{ action: 'goto', value: input.url }];
  const id = randomUUID();
  sessions.set(id, { id, projectId: input.projectId, userId: input.userId, browser, context, page, steps });
  return { sessionId: id, steps, view: await captureView(page) };
}

export async function stopDrivenSession(id: string): Promise<{ steps: Step[] }> {
  const session = sessions.get(id);
  if (!session) return { steps: [] };
  sessions.delete(id);
  await session.browser.close().catch(() => undefined);
  return { steps: session.steps };
}
