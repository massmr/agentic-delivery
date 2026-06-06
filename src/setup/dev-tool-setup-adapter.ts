export type DevToolReadinessState =
  | 'not_installed'
  | 'installed_not_authenticated'
  | 'installed_authenticated_no_model'
  | 'installed_ready'
  | 'installed_unsupported'
  | 'command_failed';

export type DevToolDoctorStatus = 'pass' | 'warn' | 'fail';

export interface DevToolCommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface DevToolSetupAdapterDependencies {
  readonly env: NodeJS.ProcessEnv;
  readonly homeDirectory: string;
  readonly workspaceRoot: string;
  readonly fileExists: (path: string) => boolean;
  readonly readFile: (path: string) => string | undefined;
  readonly commandExists: (command: string) => boolean;
  readonly runCommand?: ((command: string, args: readonly string[]) => DevToolCommandResult) | undefined;
}

export interface DevToolDetectionResult {
  readonly tool: string;
  readonly command: string;
  readonly state: DevToolReadinessState;
  readonly version?: string | undefined;
  readonly globalConfigPath: string;
  readonly globalConfigPresent: boolean;
  readonly projectConfigPath: string;
  readonly projectConfigPresent: boolean;
  readonly authPath: string;
  readonly authPresent: boolean;
  readonly authListChecked: boolean;
  readonly authListAuthenticated: boolean;
  readonly modelConfigured: boolean;
  readonly details: readonly string[];
  readonly nextSteps: readonly string[];
}

export interface DevToolDoctorCheck {
  readonly status: DevToolDoctorStatus;
  readonly label: string;
  readonly message: string;
  readonly nextStep?: string | undefined;
}

export interface DevToolConfigSummary {
  readonly tool: string;
  readonly command: string;
  readonly state: DevToolReadinessState;
  readonly configFilesPresent: readonly string[];
  readonly authConfigured: boolean;
  readonly modelConfigured: boolean;
}

export type DevToolSetupActionKind = 'install' | 'authenticate' | 'configure_model' | 'none';

export interface DevToolSetupAction {
  readonly kind: DevToolSetupActionKind;
  readonly label: string;
  readonly command?: string | undefined;
  readonly requiresExplicitConfirmation: boolean;
}

export interface DevToolLaunchSetupResult {
  readonly actions: readonly DevToolSetupAction[];
  readonly invoked: boolean;
  readonly message: string;
}

export interface DevToolSetupAdapter {
  detect(): DevToolDetectionResult;
  doctor(): readonly DevToolDoctorCheck[];
  launchSetup(options?: { readonly confirmed?: boolean | undefined }): DevToolLaunchSetupResult;
  getConfigSummary(): DevToolConfigSummary;
}
