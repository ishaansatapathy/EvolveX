export type ApprovalDefaults = {
  autoApproveEmail: boolean;
  autoApproveAgentEmail: boolean;
  autoApproveCalendar: boolean;
};

export interface SettingsService {
  getApprovalDefaults(userId: string): Promise<ApprovalDefaults>;
  updateApprovalDefaults(userId: string, input: ApprovalDefaults): Promise<ApprovalDefaults>;
}

let settingsService: SettingsService | null = null;

export function registerSettingsService(service: SettingsService) {
  settingsService = service;
}

export function getSettingsService(): SettingsService {
  if (!settingsService) {
    throw new Error("Settings service is not registered");
  }
  return settingsService;
}
