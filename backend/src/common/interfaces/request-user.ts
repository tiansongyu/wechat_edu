import { RoleCode } from "../../generated/prisma/enums";

export interface RequestUser {
  id: string;
  roles: RoleCode[];
  activeRole: RoleCode;
}
