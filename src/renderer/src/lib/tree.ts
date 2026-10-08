import type { Note } from '../../../preload'

export type SortMode = 'manual' | 'name' | 'mtime'

export interface TreeNode {
  note: Note
  children: TreeNode[]
}

/** Build a nested tree from a flat list. Orphans (missing parent) go to root. */
export function buildTree(items: Note[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const note of items) byId.set(note.id, { note, children: [] })
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    const pid = node.note.parent_id
    const parent = pid ? byId.get(pid) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  sortTree(roots, 'manual') // stable default before caller re-sorts
  return roots
}

/** Sort a tree in place. Manual = sort_order; name/mtime put folders first. */
export function sortTree(nodes: TreeNode[], mode: SortMode): void {
  const isFolder = (n: TreeNode): number => (n.note.kind === 'folder' ? 0 : 1)
  nodes.sort((a, b) => {
    if (mode === 'manual') return a.note.sort_order - b.note.sort_order
    const f = isFolder(a) - isFolder(b)
    if (f !== 0) return f
    if (mode === 'name') return a.note.title.localeCompare(b.note.title, 'zh')
    return b.note.updated_at.localeCompare(a.note.updated_at) // mtime, newest first
  })
  for (const n of nodes) sortTree(n.children, mode)
}

/**
 * Filter a tree by a name query. Keeps matching nodes and all their ancestors;
 * returns the folder ids to force-expand and the set of directly-matched ids.
 */
export function filterTree(
  nodes: TreeNode[],
  query: string
): { nodes: TreeNode[]; expand: Set<string>; matched: Set<string> } {
  const q = query.trim().toLowerCase()
  const expand = new Set<string>()
  const matched = new Set<string>()
  if (!q) return { nodes, expand, matched }

  function walk(node: TreeNode): TreeNode | null {
    const selfMatch = node.note.title.toLowerCase().includes(q)
    if (selfMatch) matched.add(node.note.id)
    const kids = node.children.map(walk).filter((n): n is TreeNode => n !== null)
    if (selfMatch || kids.length > 0) {
      if (kids.length > 0) expand.add(node.note.id)
      return { note: node.note, children: kids }
    }
    return null
  }
  return {
    nodes: nodes.map(walk).filter((n): n is TreeNode => n !== null),
    expand,
    matched
  }
}

/** Ancestor ids of `id`, nearest first (for reveal-in-tree). */
export function ancestorIds(items: Note[], id: string): string[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const res: string[] = []
  let cur = byId.get(id)?.parent_id ?? null
  while (cur) {
    res.push(cur)
    cur = byId.get(cur)?.parent_id ?? null
  }
  return res
}

/** True if `targetId` is `rootId` or a descendant of it (for cycle rejection). */
export function isSelfOrDescendant(
  items: Note[],
  rootId: string,
  targetId: string | null
): boolean {
  const byId = new Map(items.map((i) => [i.id, i]))
  let cur: string | null = targetId
  const guard = new Set<string>()
  while (cur) {
    if (cur === rootId) return true
    if (guard.has(cur)) break
    guard.add(cur)
    cur = byId.get(cur)?.parent_id ?? null
  }
  return false
}

/** Count items due today within a subtree (for folder badges). */
export function countTodayDue(node: TreeNode, todayIds: Set<string>): number {
  let n = todayIds.has(node.note.id) ? 1 : 0
  for (const c of node.children) n += countTodayDue(c, todayIds)
  return n
}
