import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import {
  CreateReviewReportDto,
  ReviewReportPaginationDto
} from "./dto/review-governance.dto";
import { ReviewGovernanceService } from "./review-governance.service";

@ApiTags("评价举报")
@ApiBearerAuth()
@Roles(RoleCode.PARENT, RoleCode.TEACHER)
@Controller("api/v1")
export class ReviewGovernanceController {
  constructor(private readonly governance: ReviewGovernanceService) {}

  @Post("reviews/:id/reports")
  report(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) reviewId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: CreateReviewReportDto
  ) {
    return this.governance.createReport(user, reviewId, idempotencyKey, dto);
  }

  @Get("me/review-reports")
  mine(@CurrentUser() user: RequestUser, @Query() query: ReviewReportPaginationDto) {
    return this.governance.listMyReports(user, query.cursor, query.limit);
  }
}
