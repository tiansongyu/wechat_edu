import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { AddCertificationDto, UpdateParentProfileDto, UpdateTeacherProfileDto } from "./dto/profile.dto";
import { ProfilesService } from "./profiles.service";

@ApiTags("个人资料")
@ApiBearerAuth()
@Controller("api/v1/profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  @Roles(RoleCode.TEACHER)
  @Get("teacher")
  getTeacher(@CurrentUser() user: RequestUser) {
    return this.profiles.getTeacher(user.id);
  }

  @Roles(RoleCode.TEACHER)
  @Patch("teacher")
  updateTeacher(@CurrentUser() user: RequestUser, @Body() dto: UpdateTeacherProfileDto) {
    return this.profiles.updateTeacher(user.id, dto);
  }

  @Roles(RoleCode.TEACHER)
  @Post("teacher/certifications")
  addCertification(@CurrentUser() user: RequestUser, @Body() dto: AddCertificationDto) {
    return this.profiles.addCertification(user.id, dto);
  }

  @Roles(RoleCode.PARENT)
  @Patch("parent")
  updateParent(@CurrentUser() user: RequestUser, @Body() dto: UpdateParentProfileDto) {
    return this.profiles.updateParent(user.id, dto);
  }
}
