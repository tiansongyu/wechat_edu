import { IsOptional, IsString, IsUUID, Matches, MaxLength } from "class-validator";

export class ListMessagesDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export class StartConversationDto {
  @IsUUID()
  memberId: string;

  @IsUUID()
  jobId: string;
}

export class SendMessageDto {
  @IsUUID()
  clientMessageId: string;

  @IsString()
  @Matches(/\S/)
  @MaxLength(3000)
  content: string;
}
