// ph_releases — shared schema object
// The same phReleases instance is imported by multiple table files under this schema, to avoid repeated pgSchema calls

import { pgSchema } from 'drizzle-orm/pg-core';

export const phReleases = pgSchema('ph_releases');
