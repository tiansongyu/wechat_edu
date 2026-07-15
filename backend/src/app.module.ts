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
import { PreferencesModule } from "./modules/preferences/preferences.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { ReviewsModule } from "./modules/reviews/reviews.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { ReviewGovernanceModule } from "./modules/review-governance/review-governance.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        if (config.WECHAT_LOGIN_MOCK !== "true" && (!config.WECHAT_APP_ID || !config.WECHAT_APP_SECRET)) {
          throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required when WECHAT_LOGIN_MOCK is not true");
        }
        return config;
      }
    }),
    PrismaModule,
    AuthModule,
    ProfilesModule,
    JobsModule,
    ApplicationsModule,
    AdminModule,
    CommunicationsModule,
    FilesModule,
    PreferencesModule,
    AppointmentsModule,
    ReviewsModule,
    ReviewGovernanceModule,
    PlatformModule
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard }
  ]
})
export class AppModule {}
