import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import {
  AdminReviewListDto,
  AdminReviewReportListDto,
  ChangeReviewVisibilityDto,
  ResolveReviewReportDto
} from "./dto/review-governance.dto";
import { ReviewGovernanceService } from "./review-governance.service";

@ApiTags("管理后台-评价治理")
@ApiBearerAuth()
@Roles(RoleCode.ADMIN)
@Controller("admin-api/v1")
export class ReviewGovernanceAdminController {
  constructor(private readonly governance: ReviewGovernanceService) {}

  @Get("reviews")
  reviews(@Query() query: AdminReviewListDto) {
    return this.governance.listAdminReviews(query);
  }

  @Post("reviews/:id/hide")
  hide(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) reviewId: string,
    @Body() dto: ChangeReviewVisibilityDto
  ) {
    return this.governance.hideReview(actor.id, reviewId, dto);
  }

  @Post("reviews/:id/restore")
  restore(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) reviewId: string,
    @Body() dto: ChangeReviewVisibilityDto
  ) {
    return this.governance.restoreReview(actor.id, reviewId, dto);
  }

  @Get("review-reports")
  reports(@Query() query: AdminReviewReportListDto) {
    return this.governance.listAdminReports(query);
  }

  @Post("review-reports/:id/resolve")
  resolve(
    @CurrentUser() actor: RequestUser,
    @Param("id", new ParseUUIDPipe()) reportId: string,
    @Body() dto: ResolveReviewReportDto
  ) {
    return this.governance.resolveReport(actor.id, reportId, dto);
  }
}
