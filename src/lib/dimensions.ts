/** Shared edit dimensions. Lives here (not in report.ts) so the planner
 * (loop.ts), the renderer (render.ts) and the aggregator (report.ts) all
 * import from one leaf module instead of forming a value-level cycle. */

export const EDIT_DIMENSIONS: string[] = ['static', 'reliability', 'effectiveness', 'efficiency', 'mcp', 'lifecycle']
