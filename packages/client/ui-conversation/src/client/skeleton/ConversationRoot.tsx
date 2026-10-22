/** Default main-panel occupant, composed from the shared conversation factory. */
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contract/slots.ts'

/** Full props supplied by the optional-Session slot. */
export type ConversationRootProps = PropsRuntime<'main.conversation'> & PropsRenderFactories

/**
 * Render the complete main conversation.
 * @param props - Session-bound factory renderer.
 * @returns the conversation header, transcript, and composer.
 */
export function ConversationRoot({ renderFactorySlot }: ConversationRootProps) {
  return renderFactorySlot('conversation.main', {})
}
