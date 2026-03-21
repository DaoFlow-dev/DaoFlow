import {
  getDestinationProviderMetadata,
  isOAuthProvider,
  type ProviderKey,
  usesRemoteConfig
} from "./add-destination-provider-config";
import type { AddDestinationFormState, DestinationFormData } from "./add-destination-types";

export function createInitialAddDestinationFormState(): AddDestinationFormState {
  return {
    name: "",
    provider: "s3",
    accessKey: "",
    secretKey: "",
    bucket: "",
    region: "",
    endpoint: "",
    s3Provider: "",
    localPath: "",
    rcloneConfig: "",
    rcloneRemotePath: ""
  };
}

export function getDefaultDestinationName(provider: ProviderKey): string {
  return getDestinationProviderMetadata(provider).defaultName;
}

export function getAuthorizeCommand(provider: ProviderKey): string | undefined {
  return getDestinationProviderMetadata(provider).authorizeCmd;
}

export function buildDestinationPayload(form: AddDestinationFormState): DestinationFormData {
  const { provider } = form;

  return {
    name: form.name,
    provider,
    accessKey: provider === "s3" ? form.accessKey : undefined,
    secretAccessKey: provider === "s3" ? form.secretKey : undefined,
    bucket: provider === "s3" ? form.bucket : undefined,
    region: provider === "s3" ? form.region : undefined,
    endpoint: provider === "s3" ? form.endpoint : undefined,
    s3Provider: provider === "s3" ? form.s3Provider : undefined,
    localPath: provider === "local" ? form.localPath : undefined,
    rcloneConfig: usesRemoteConfig(provider) ? form.rcloneConfig : undefined,
    rcloneRemotePath: usesRemoteConfig(provider) ? form.rcloneRemotePath : undefined,
    oauthToken: isOAuthProvider(provider) ? form.rcloneConfig : undefined
  };
}
