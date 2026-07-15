import { IsOptional, IsString, MaxLength } from "class-validator";

export class ApplyJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  coverLetter?: string;
}

export class HandleApplicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
