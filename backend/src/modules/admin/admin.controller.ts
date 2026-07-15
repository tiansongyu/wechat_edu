import { Body, Controller, Get, Param, Patch, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { AdminService } from "./admin.service";
import { AdminListDto, AuditDecisionDto, UpdateAccountStatusDto } from "./dto/admin.dto";

@ApiTags("管理后台")
@ApiBearerAuth()
@Roles(RoleCode.ADMIN)
@Controller("admin-api/v1")
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("dashboard")
  dashboard() {
    return this.admin.dashboard();
  }

  @Get("users")
  users(@Query() query: AdminListDto) {
    return this.admin.users(query);
  }

  @Patch("users/:id/status")
  updateUserStatus(
    @CurrentUser() actor: RequestUser,
    @Param("id") id: string,
    @Body() dto: UpdateAccountStatusDto
  ) {
    return this.admin.updateUserStatus(actor.id, id, dto);
  }

  @Get("teachers/audits")
  teacherAudits(@Query() query: AdminListDto) {
    return this.admin.teacherAudits(query);
  }

  @Patch("teachers/:id/audit")
  auditTeacher(
    @CurrentUser() actor: RequestUser,
    @Param("id") id: string,
    @Body() dto: AuditDecisionDto
  ) {
    return this.admin.auditTeacher(actor.id, id, dto);
  }

  @Get("jobs/audits")
  jobAudits(@Query() query: AdminListDto) {
    return this.admin.jobAudits(query);
  }

  @Patch("jobs/:id/audit")
  auditJob(
    @CurrentUser() actor: RequestUser,
    @Param("id") id: string,
    @Body() dto: AuditDecisionDto
  ) {
    return this.admin.auditJob(actor.id, id, dto);
  }

  @Get("audit-logs")
  auditLogs(@Query() query: AdminListDto) {
    return this.admin.auditLogs(query);
  }
}
