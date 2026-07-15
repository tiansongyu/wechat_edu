import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { RequestUser } from "../../common/interfaces/request-user";
import { CommunicationsService } from "./communications.service";
import { ListMessagesDto, SendMessageDto, StartConversationDto } from "./dto/communications.dto";

@ApiTags("消息与通知")
@ApiBearerAuth()
@Controller("api/v1")
export class CommunicationsController {
  constructor(private readonly communications: CommunicationsService) {}

  @Get("notifications")
  notifications(@CurrentUser() user: RequestUser) {
    return this.communications.notifications(user.id);
  }

  @Post("notifications/read-all")
  readAll(@CurrentUser() user: RequestUser) {
    return this.communications.readAllNotifications(user.id);
  }

  @Post("notifications/:id/read")
  read(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.communications.readNotification(user.id, id);
  }

  @Get("conversations")
  conversations(@CurrentUser() user: RequestUser) {
    return this.communications.conversations(user.id);
  }

  @Post("conversations")
  startConversation(@CurrentUser() user: RequestUser, @Body() dto: StartConversationDto) {
    return this.communications.startConversation(user, dto.memberId, dto.jobId);
  }

  @Get("conversations/:id/messages")
  messages(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string, @Query() query: ListMessagesDto) {
    return this.communications.messages(user.id, id, query.cursor);
  }

  @Post("conversations/:id/messages")
  sendMessage(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() dto: SendMessageDto) {
    return this.communications.sendMessage(user.id, id, dto);
  }

  @Post("conversations/:id/read")
  readConversation(@CurrentUser() user: RequestUser, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.communications.readConversation(user.id, id);
  }
}
