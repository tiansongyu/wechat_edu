import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { FilesModule } from "../files/files.module";
import { AuthController, AdminAuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Global()
@Module({
  imports: [JwtModule.register({ global: true }), FilesModule],
  controllers: [AuthController, AdminAuthController],
  providers: [AuthService],
  exports: [AuthService, JwtModule]
})
export class AuthModule {}
