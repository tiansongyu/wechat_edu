import { Body, Controller, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { CreateUploadUrlDto } from "./dto/files.dto";
import { FilesService } from "./files.service";

@ApiTags("文件")
@ApiBearerAuth()
@Controller("api/v1/files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post("upload-url")
  createUploadUrl(@CurrentUser() user: RequestUser, @Body() dto: CreateUploadUrlDto) {
    return this.files.createUploadUrl(user.id, dto);
  }
}
