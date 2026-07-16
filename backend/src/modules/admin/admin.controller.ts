import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { AdminService } from "./admin.service";
import {
  AdminApplicationListDto,
  AdminApplicationStatusDto,
  AdminAppointmentListDto,
  AdminAppointmentStatusDto,
  AdminListDto,
  AuditDecisionDto,
  UpdateAccountStatusDto
} from "./dto/admin.dto";

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
    @Param("id", new ParseUUIDPipe()) id: string,
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
    @Param("id", new ParseUUIDPipe()) id: string,
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
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AuditDecisionDto
  ) {
    return this.admin.auditJob(actor.id, id, dto);
  }

  @Get("job-revisions/audits")
  jobRevisionAudits(@Query() query: AdminListDto) {
    return this.admin.jobRevisionAudits(query);
  }

  @Patch("job-revisions/:id/audit")
  auditJobRevision(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AuditDecisionDto
  ) {
    return this.admin.auditJobRevision(actor.id, id, dto);
  }

  @Get("applications")
  applications(@Query() query: AdminApplicationListDto) {
    return this.admin.applications(query);
  }

  @Patch("applications/:id/status")
  updateApplicationStatus(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AdminApplicationStatusDto
  ) {
    return this.admin.updateApplicationStatus(actor.id, id, dto);
  }

  @Get("appointments")
  appointments(@Query() query: AdminAppointmentListDto) {
    return this.admin.appointments(query);
  }

  @Patch("appointments/:id/status")
  updateAppointmentStatus(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() dto: AdminAppointmentStatusDto
  ) {
    return this.admin.updateAppointmentStatus(actor.id, id, dto);
  }

  @Get("audit-logs")
  auditLogs(@Query() query: AdminListDto) {
    return this.admin.auditLogs(query);
  }
}
