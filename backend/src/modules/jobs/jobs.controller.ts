import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { CreateJobDto, ListJobsDto, NearbyJobsDto, UpdateJobDto } from "./dto/jobs.dto";
import { JobsService } from "./jobs.service";

@ApiTags("家教需求")
@ApiBearerAuth()
@Controller("api/v1/jobs")
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query() query: ListJobsDto, @CurrentUser() user: RequestUser) {
    return this.jobs.list(query, user.id);
  }

  @Get("nearby")
  nearby(@Query() query: NearbyJobsDto) {
    return this.jobs.nearby(query);
  }

  @Get("mine")
  mine(@CurrentUser() user: RequestUser) {
    return this.jobs.mine(user.id);
  }

  @Get(":id")
  detail(@Param("id") id: string, @CurrentUser() user: RequestUser) {
    return this.jobs.detail(id, user.id);
  }

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateJobDto) {
    return this.jobs.create(user, dto);
  }

  @Patch(":id")
  update(@CurrentUser() user: RequestUser, @Param("id") id: string, @Body() dto: UpdateJobDto) {
    return this.jobs.update(user.id, id, dto);
  }

  @Post(":id/favorite")
  favorite(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.jobs.favorite(user.id, id);
  }

  @Delete(":id/favorite")
  unfavorite(@CurrentUser() user: RequestUser, @Param("id") id: string) {
    return this.jobs.unfavorite(user.id, id);
  }
}
