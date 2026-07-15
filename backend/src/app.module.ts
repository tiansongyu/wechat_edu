import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { HealthController } from "./health.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./modules/auth/auth.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { ProfilesModule } from "./modules/profiles/profiles.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { ApplicationsModule } from "./modules/applications/applications.module";
import { AdminModule } from "./modules/admin/admin.module";
import { CommunicationsModule } from "./modules/communications/communications.module";
import { FilesModule } from "./modules/files/files.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ProfilesModule,
    JobsModule,
    ApplicationsModule,
    AdminModule,
    CommunicationsModule,
    FilesModule
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule {}
