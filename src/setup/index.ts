export {
  defaultSetupSelections,
  getDeploymentMonitors,
  getRequiredEnvPlaceholders,
  getSetupCapabilities,
  getSetupCapabilitiesForSelections
} from './provider-capability.js';
export type {
  DeploymentMonitorSelection,
  SetupDetectionInput,
  SetupDetectionResult,
  SetupGeneratedConfigMetadata,
  SetupProviderCapability,
  SetupSelections,
  SetupValidationResult
} from './provider-capability.js';
export { createOnboardingFiles, renderEnvExample, renderOnboardingWorkspaceConfig } from './onboarding-config.js';
export type { OnboardingFiles } from './onboarding-config.js';
export { runLocalDoctor } from './doctor.js';
export type { DoctorIssue, DoctorReport } from './doctor.js';
