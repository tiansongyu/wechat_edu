import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { RequestUser } from "../interfaces/request-user";

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestUser => context.switchToHttp().getRequest().user
);
