import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PlatformService } from "./platform.service";

@ApiTags("平台公开信息")
@ApiBearerAuth()
@Controller("api/v1/platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("overview")
  overview() {
    return this.platform.overview();
  }
}
