import AuthService from "@repo/services/auth";
import InvestigationService from "@repo/services/investigation";
import UserService from "@repo/services/user";

export const userService = new UserService();
export const authService = new AuthService();
export const investigationService = new InvestigationService();

export { invalidateBriefCache } from "../routes/ai/route";
