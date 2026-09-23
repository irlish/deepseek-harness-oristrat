/**
 * Accessibility trees in the shape the browser's debug protocol returns.
 *
 * A suite declares the tree it wants as nested specs; this module flattens it
 * into the node list the protocol reports, so tests read as the page structure
 * a browser exposes instead of as protocol wiring.
 * @module
 */

/** Compact description of one accessibility node the scripted page exposes. */
export interface AxSpec {
  readonly role?: string
  readonly name?: string
  readonly value?: string
  readonly ignored?: boolean
  readonly properties?: readonly { readonly name: string; readonly value?: boolean | string | number }[]
  readonly children?: readonly AxSpec[]
  /** Child node ids the tree does not contain. */
  readonly missingChildren?: readonly string[]
  /** Parent id reported for this node, overriding its position in the tree. */
  readonly parentId?: string
  readonly backendNodeId?: number
}

/**
 * Flatten nested accessibility nodes into the shape the protocol returns,
 * assigning one node id per spec in pre-order.
 * @param roots - top-level nodes of the tree.
 * @returns the flat node list the browser would report.
 */
export function axTree(roots: readonly AxSpec[]): { nodes: Record<string, unknown>[] } {
  const nodes: Record<string, unknown>[] = []
  let next = 0
  const visit = (spec: AxSpec, parentId: string | undefined): string => {
    next += 1
    const nodeId = String(next)
    const childIds: string[] = []
    const wire: Record<string, unknown> = { nodeId }
    if (spec.ignored === true) wire.ignored = true
    if (spec.role !== undefined) wire.role = { value: spec.role }
    if (spec.name !== undefined) wire.name = { value: spec.name }
    if (spec.value !== undefined) wire.value = { value: spec.value }
    if (spec.properties !== undefined) {
      wire.properties = spec.properties.map(property => ({
        name: property.name,
        ...(property.value === undefined ? {} : { value: { value: property.value } }),
      }))
    }
    if (spec.backendNodeId !== undefined) wire.backendDOMNodeId = spec.backendNodeId
    const wireParent = spec.parentId ?? parentId
    if (wireParent !== undefined) wire.parentId = wireParent
    if (spec.children !== undefined || spec.missingChildren !== undefined) {
      wire.childIds = childIds
      childIds.push(...spec.missingChildren ?? [])
    }
    nodes.push(wire)
    for (const child of spec.children ?? []) childIds.push(visit(child, nodeId))
    return nodeId
  }
  for (const root of roots) visit(root, undefined)
  return { nodes }
}
