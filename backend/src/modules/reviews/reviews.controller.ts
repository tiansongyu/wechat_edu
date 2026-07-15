import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { RoleCode } from "../../generated/prisma/enums";
import { CreateReviewDto, ListReviewsDto, ReviewPaginationDto } from "./dto/reviews.dto";
import { ReviewsService } from "./reviews.service";

@ApiTags("合作评价")
@ApiBearerAuth()
@Controller("api/v1")
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Post("appointments/:id/reviews")
  create(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) appointmentId: string,
    @Headers("idempotency-key") idempotencyKey: string,
    @Body() dto: CreateReviewDto
  ) {
    return this.reviews.create(user, appointmentId, idempotencyKey, dto);
  }

  @Get("teachers/:teacherId/reviews")
  listTeacher(
    @Param("teacherId", new ParseUUIDPipe()) teacherId: string,
    @Query() query: ReviewPaginationDto
  ) {
    return this.reviews.listTeacherReviews(teacherId, query.cursor, query.limit);
  }

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Get("me/reviews/received")
  listReceived(@CurrentUser() user: RequestUser, @Query() query: ReviewPaginationDto) {
    return this.reviews.listReceivedReviews(user, query.cursor, query.limit);
  }

  @Roles(RoleCode.PARENT, RoleCode.TEACHER)
  @Get("appointments/:id/counterpart-reputation")
  counterpartReputation(
    @CurrentUser() user: RequestUser,
    @Param("id", new ParseUUIDPipe()) appointmentId: string
  ) {
    return this.reviews.getCounterpartReputation(user, appointmentId);
  }

  @Get("accounts/:accountId/reviews")
  listLegacy(@Param("accountId", new ParseUUIDPipe()) accountId: string, @Query() query: ListReviewsDto) {
    return this.reviews.listForAccount(accountId, query.role, query.cursor, query.limit);
  }
}
