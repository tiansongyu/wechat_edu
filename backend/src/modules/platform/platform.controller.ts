import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { PlatformService } from "./platform.service";

@ApiTags("平台公开信息")
@Controller("api/v1/platform")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Public()
  @Get("overview")
  overview() {
    return this.platform.overview();
  }
}
