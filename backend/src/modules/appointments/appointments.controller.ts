import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { AppointmentsService } from "./appointments.service";
import { AppointmentCommandDto } from "./dto/appointments.dto";

@ApiTags("预约与履约")
@ApiBearerAuth()
@Controller("api/v1/appointments")
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.appointments.list(user.id, user.activeRole);
  }

  @Roles(RoleCode.TEACHER)
  @Post(":id/confirm")
  confirm(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: AppointmentCommandDto
  ) {
    return this.appointments.confirm(user.id, id, dto.reason, user.activeRole, idempotencyKey);
  }

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Post(":id/complete")
  complete(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: AppointmentCommandDto
  ) {
    return this.appointments.complete(user.id, id, dto.reason, user.activeRole, idempotencyKey);
  }

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Post(":id/cancel")
  cancel(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: AppointmentCommandDto
  ) {
    return this.appointments.cancel(user.id, id, dto.reason, user.activeRole, idempotencyKey);
  }

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Post(":id/dispute")
  dispute(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: AppointmentCommandDto
  ) {
    return this.appointments.dispute(user.id, id, dto.reason, user.activeRole, idempotencyKey);
  }
}
