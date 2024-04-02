export interface Location {
  line: number
  column: number
}

export interface Range {
  start: Location
  end: Location
}

export interface Mapping {
  source: Range | null
  destination: Range | null
}

export type Rule = {
  kind: 'rule'
  selector: string
  nodes: AstNode[]
  mappings: Mapping[]
}

export type Declaration = {
  kind: 'declaration'
  property: string
  value: string
  important: boolean
  mappings: Mapping[]
}

export type Comment = {
  kind: 'comment'
  value: string
  mappings: Mapping[]
}

export type AstNode = Rule | Declaration | Comment

export function rule(selector: string, nodes: AstNode[], mappings: Mapping[] = []): Rule {
  return {
    kind: 'rule',
    selector,
    nodes,
    mappings,
  }
}

export function decl(property: string, value: string, mappings: Mapping[] = []): Declaration {
  return {
    kind: 'declaration',
    property,
    value,
    important: false,
    mappings,
  }
}

export function comment(value: string, mappings: Mapping[] = []): Comment {
  return {
    kind: 'comment',
    value: value,
    mappings,
  }
}

export enum WalkAction {
  /** Continue walking, which is the default */
  Continue,

  /** Skip visiting the children of this node */
  Skip,

  /** Stop the walk entirely */
  Stop,
}

export function walk(
  ast: AstNode[],
  visit: (
    node: AstNode,
    utils: {
      replaceWith(newNode: AstNode | AstNode[]): void
    },
  ) => void | WalkAction,
) {
  for (let i = 0; i < ast.length; i++) {
    let node = ast[i]
    let status =
      visit(node, {
        replaceWith(newNode) {
          ast.splice(i, 1, ...(Array.isArray(newNode) ? newNode : [newNode]))
          // We want to visit the newly replaced node(s), which start at the
          // current index (i). By decrementing the index here, the next loop
          // will process this position (containing the replaced node) again.
          i--
        },
      }) ?? WalkAction.Continue

    // Stop the walk entirely
    if (status === WalkAction.Stop) return

    // Skip visiting the children of this node
    if (status === WalkAction.Skip) continue

    if (node.kind === 'rule') {
      walk(node.nodes, visit)
    }
  }
}

export function toCss(ast: AstNode[], { trackDestination }: { trackDestination?: boolean } = {}) {
  let atRoots: AstNode[] = []
  let seenAtProperties = new Set<string>()

  function stringifyAll(
    nodes: AstNode[],
    { depth, location }: { depth: number; location?: Location },
  ): string {
    let css = ''
    for (let child of nodes) {
      css += stringify(child, { depth, location })
    }
    return css
  }

  function stringify(
    node: AstNode,
    { depth, location }: { depth: number; location?: Location },
  ): string {
    let indent = '  '.repeat(depth)

    // Rule
    if (node.kind === 'rule') {
      // Pull out `@at-root` rules to append later
      if (node.selector === '@at-root') {
        atRoots = atRoots.concat(node.nodes)
        return ''
      }

      if (node.selector === '@tailwind utilities') {
        return stringifyAll(node.nodes, { depth, location })
      }

      // Print at-rules without nodes with a `;` instead of an empty block.
      //
      // E.g.:
      //
      // ```css
      // @layer base, components, utilities;
      // ```
      if (node.selector[0] === '@' && node.nodes.length === 0) {
        if (location) {
          node.mappings.push({
            source: null,
            destination: {
              start: { line: location.line, column: indent.length },
              end: { line: location.line, column: indent.length },
            },
          })
          location.line += 1
        }
        return `${indent}${node.selector};\n`
      }

      if (node.selector[0] === '@' && node.selector.startsWith('@property ') && depth === 0) {
        // Don't output duplicate `@property` rules
        if (seenAtProperties.has(node.selector)) {
          return ''
        }

        seenAtProperties.add(node.selector)
      }

      let css = `${indent}${node.selector} {\n`
      if (location) {
        node.mappings.push({
          source: null,
          destination: {
            start: { line: location.line, column: indent.length },
            end: { line: location.line, column: indent.length },
          },
        })
        location.line += 1
      }
      css += stringifyAll(node.nodes, { depth: depth + 1, location })
      css += `${indent}}\n`
      if (location) location.line += 1
      return css
    }

    // Comment
    else if (node.kind === 'comment') {
      if (location) {
        node.mappings.push({
          source: null,
          destination: {
            start: { line: location.line, column: indent.length },
            end: { line: location.line, column: indent.length },
          },
        })
        location.line += 1 + node.value.split('\n').length - 1
      }
      return `${indent}/*${node.value}*/\n`
    }

    // Declaration
    else if (node.property !== '--tw-sort' && node.value !== undefined && node.value !== null) {
      if (location) {
        node.mappings.push({
          source: null,
          destination: {
            start: { line: location.line, column: indent.length },
            end: { line: location.line, column: indent.length },
          },
        })
        location.line += 1 + node.value.split('\n').length - 1
      }
      return `${indent}${node.property}: ${node.value}${node.important ? '!important' : ''};\n`
    }

    return ''
  }

  let location = trackDestination ? { line: 1, column: 0 } : undefined
  let css = stringifyAll(ast, { depth: 0, location })
  css += stringifyAll(atRoots, { depth: 0, location })

  return css
}
