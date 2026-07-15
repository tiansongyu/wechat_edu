import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { ApplicationsService } from "./applications.service";
import { ApplyJobDto, HandleApplicationDto } from "./dto/applications.dto";

@ApiTags("报名与录用")
@ApiBearerAuth()
@Controller("api/v1")
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Roles(RoleCode.TEACHER)
  @Post("jobs/:jobId/applications")
  apply(
    @CurrentUser() user: RequestUser,
    @Param("jobId", new ParseUUIDPipe()) jobId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: ApplyJobDto
  ) {
    return this.applications.apply(user.id, jobId, idempotencyKey, dto);
  }

  @Roles(RoleCode.TEACHER)
  @Get("teacher/applications")
  mine(@CurrentUser() user: RequestUser) {
    return this.applications.teacherApplications(user.id);
  }

  @Roles(RoleCode.PARENT)
  @Get("parent/applications")
  parentApplications(@CurrentUser() user: RequestUser) {
    return this.applications.parentApplications(user.id);
  }

  @Roles(RoleCode.PARENT)
  @Get("parent/jobs/:jobId/applications")
  forJob(@CurrentUser() user: RequestUser, @Param("jobId", new ParseUUIDPipe()) jobId: string) {
    return this.applications.jobApplications(user.id, jobId);
  }

  @Roles(RoleCode.PARENT)
  @Post("applications/:id/accept")
  accept(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: HandleApplicationDto) {
    return this.applications.accept(user.id, id, dto.note);
  }

  @Roles(RoleCode.PARENT)
  @Post("applications/:id/reject")
  reject(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: HandleApplicationDto) {
    return this.applications.reject(user.id, id, dto.note);
  }

  @Roles(RoleCode.TEACHER)
  @Post("applications/:id/cancel")
  cancel(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: HandleApplicationDto) {
    return this.applications.cancel(user.id, id, dto.note);
  }
}
