export { PROVIDER_DEFAULTS } from "../../shared/provider-defaults";

/** Everything a provider needs to talk to its endpoint. */
export interface ProviderHttpConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  organization: string;
  extraHeaders: Record<string, string>;
}
