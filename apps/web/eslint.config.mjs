import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';

import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  ...nextVitals,
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
      },
    },
  },
];
