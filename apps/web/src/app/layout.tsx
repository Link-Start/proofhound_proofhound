import type { Metadata } from 'next';
import Script from 'next/script';
import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { I18nProvider } from '@/i18n';
import { ProjectContextProvider } from '@/providers/project-context-provider';
import { RefineProvider } from '@/providers/refine-provider';
import '@xyflow/react/dist/style.css';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'ProofHound',
  description: '提示词全生命周期治理平台',
};

const preferenceInitScript = `
try {
  var theme = window.localStorage.getItem('proofhound.theme');
  var language = window.localStorage.getItem('proofhound.language');
  var themeOptions = ['system', 'light', 'dark', 'twilight', 'electric'];
  var themePreference = themeOptions.indexOf(theme) >= 0 ? theme : 'system';
  var systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var resolvedTheme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = themePreference;
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  if (['zh-CN', 'en-US'].indexOf(language) >= 0) {
    document.documentElement.lang = language;
  }
} catch (_) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <Script
          id="proofhound-preferences"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: preferenceInitScript }}
        />
      </head>
      <body>
        <Suspense fallback={null}>
          <I18nProvider>
            <ProjectContextProvider>
              <RefineProvider>
                <AppShell>{children}</AppShell>
              </RefineProvider>
            </ProjectContextProvider>
          </I18nProvider>
        </Suspense>
      </body>
    </html>
  );
}
