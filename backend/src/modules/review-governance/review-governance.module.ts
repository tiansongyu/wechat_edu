import { Module } from "@nestjs/common";
import { ReviewGovernanceAdminController } from "./review-governance-admin.controller";
import { ReviewGovernanceController } from "./review-governance.controller";
import { ReviewGovernanceService } from "./review-governance.service";

@Module({
  controllers: [ReviewGovernanceController, ReviewGovernanceAdminController],
  providers: [ReviewGovernanceService]
})
export class ReviewGovernanceModule {}
