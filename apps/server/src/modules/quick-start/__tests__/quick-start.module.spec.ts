import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../../infrastructure/database/database.module';
import { QuickStartModule } from '../quick-start.module';

describe('QuickStartModule', () => {
  it('imports DatabaseModule for LocalActorGuard database dependencies', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, QuickStartModule) ?? [];

    expect(imports).toContain(DatabaseModule);
  });
});
