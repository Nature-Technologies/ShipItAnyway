type WrightTestRuntimeConfig = {
  VITE_BACKEND_URL?: string;
  VITE_NOVNC_URL?: string;
  VITE_ENABLE_NOVNC?: string;
};

declare global {
  interface Window {
    __WRIGHTTEST_CONFIG__?: WrightTestRuntimeConfig;
  }
}

function readRuntimeValue(key: keyof WrightTestRuntimeConfig, fallback?: string) {
  return window.__WRIGHTTEST_CONFIG__?.[key]?.trim() || fallback || '';
}

export const BACKEND_URL = readRuntimeValue(
  'VITE_BACKEND_URL',
  import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000'
);

export const NOVNC_URL = readRuntimeValue(
  'VITE_NOVNC_URL',
  import.meta.env.VITE_NOVNC_URL ?? 'http://localhost:6080'
);

export const ENABLE_NOVNC =
  readRuntimeValue('VITE_ENABLE_NOVNC', import.meta.env.VITE_ENABLE_NOVNC ?? 'true') !== 'false';
