import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from '../config/app-config';
import { DatabaseService } from './database.service';
import { DATABASE_EXECUTOR } from './database.types';

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => loadAppConfig(),
    },
    DatabaseService,
    {
      provide: DATABASE_EXECUTOR,
      useExisting: DatabaseService,
    },
  ],
  exports: [APP_CONFIG, DatabaseService, DATABASE_EXECUTOR],
})
export class DatabaseModule {}
