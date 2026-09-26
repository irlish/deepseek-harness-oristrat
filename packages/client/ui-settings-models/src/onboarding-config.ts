/** Public page-bootstrap options shared by the Host and Client halves. */

import z from '@deepseek-ai/schemastery'

/** Onboarding and provider-page options after schema defaults are applied. */
export interface Config {
  /** Offer the browser API-key step when no native shell owns credential onboarding. */
  credentialOnboarding: boolean
  /**
   * Offer adding and removing providers on the Models page. A product that ships one fixed
   * provider turns this off, which leaves that provider's models readable and unremovable.
   */
  providerEditing: boolean
}

/** Validate Host configuration and its public page-bootstrap payload. */
export const Config: z<Partial<Config>, Config> = z.object({
  credentialOnboarding: z.boolean().default(true),
  providerEditing: z.boolean().default(true),
})

/** Page-global key carrying only the public page-bootstrap options. */
export const ONBOARDING_CONFIG_GLOBAL = '__DSH_MODELS_ONBOARDING__'
