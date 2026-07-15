import { Body, Controller, Get, Patch } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { UpdatePreferencesDto } from "./dto/preferences.dto";
import { PreferencesService } from "./preferences.service";

@ApiTags("用户偏好")
@ApiBearerAuth()
@Controller("api/v1/preferences")
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  get(@CurrentUser() user: RequestUser) {
    return this.preferences.get(user.id);
  }

  @Patch()
  update(@CurrentUser() user: RequestUser, @Body() dto: UpdatePreferencesDto) {
    return this.preferences.update(user.id, dto);
  }
}
