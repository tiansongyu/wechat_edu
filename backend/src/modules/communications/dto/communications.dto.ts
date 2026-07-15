import { IsString, IsUUID, MaxLength } from "class-validator";

export class StartConversationDto {
  @IsUUID()
  memberId: string;
}

export class SendMessageDto {
  @IsUUID()
  clientMessageId: string;

  @IsString()
  @MaxLength(3000)
  content: string;
}
