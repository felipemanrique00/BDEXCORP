'use client'

import {
  AlarmClock,
  BadgeCheck,
  Braces,
  CirclePlay,
  CircleStop,
  Clock3,
  CodeXml,
  Command,
  GitBranch,
  GitFork,
  Layers3,
  Link2,
  Merge,
  Network,
  RefreshCw,
  RotateCcw,
  Route,
  ServerCog,
  ShieldAlert,
  Split,
  TimerReset,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'
import type {
  EnterpriseWorkflowEdge,
  EnterpriseWorkflowNode,
  EnterpriseWorkflowNodeType,
} from '@/lib/workflows/types'

const NODE_WIDTH = 184
const NODE_HEIGHT = 76
const CANVAS_PADDING = 32

const NODE_META: Record<EnterpriseWorkflowNodeType, {
  label: string
  icon: LucideIcon
  tone: string
}> = {
  start: { label: 'Evento inicial', icon: CirclePlay, tone: 'border-emerald-300 bg-emerald-50 text-emerald-800' },
  sequence: { label: 'Sequência', icon: Route, tone: 'border-slate-300 bg-slate-50 text-slate-800' },
  human_task: { label: 'Tarefa humana', icon: UserRound, tone: 'border-sky-300 bg-sky-50 text-sky-900' },
  automatic_task: { label: 'Tarefa automática', icon: ServerCog, tone: 'border-cyan-300 bg-cyan-50 text-cyan-900' },
  condition: { label: 'Condição', icon: GitBranch, tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  decision: { label: 'Decisão', icon: GitFork, tone: 'border-amber-300 bg-amber-50 text-amber-900' },
  domain_command: { label: 'Comando de domínio', icon: Command, tone: 'border-indigo-300 bg-indigo-50 text-indigo-900' },
  service_call: { label: 'Chamada de serviço', icon: CodeXml, tone: 'border-blue-300 bg-blue-50 text-blue-900' },
  integration_call: { label: 'Integração', icon: Link2, tone: 'border-blue-300 bg-blue-50 text-blue-900' },
  timer: { label: 'Temporizador', icon: Clock3, tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  wait: { label: 'Espera', icon: AlarmClock, tone: 'border-orange-300 bg-orange-50 text-orange-900' },
  parallel_split: { label: 'Paralelismo', icon: Split, tone: 'border-violet-300 bg-violet-50 text-violet-900' },
  parallel_join: { label: 'Junção paralela', icon: Merge, tone: 'border-violet-300 bg-violet-50 text-violet-900' },
  quorum: { label: 'Quórum', icon: Layers3, tone: 'border-fuchsia-300 bg-fuchsia-50 text-fuchsia-900' },
  sla: { label: 'SLA', icon: TimerReset, tone: 'border-rose-300 bg-rose-50 text-rose-900' },
  escalation: { label: 'Escalonamento', icon: ShieldAlert, tone: 'border-rose-300 bg-rose-50 text-rose-900' },
  fallback: { label: 'Fallback', icon: RotateCcw, tone: 'border-red-300 bg-red-50 text-red-900' },
  retry: { label: 'Retry', icon: RefreshCw, tone: 'border-red-300 bg-red-50 text-red-900' },
  compensation: { label: 'Compensação', icon: RotateCcw, tone: 'border-red-300 bg-red-50 text-red-900' },
  subworkflow: { label: 'Subworkflow', icon: Network, tone: 'border-teal-300 bg-teal-50 text-teal-900' },
  approval: { label: 'Aprovação', icon: BadgeCheck, tone: 'border-green-300 bg-green-50 text-green-900' },
  fault_handler: { label: 'Tratamento de falha', icon: ShieldAlert, tone: 'border-red-300 bg-red-50 text-red-900' },
  end: { label: 'Encerramento', icon: CircleStop, tone: 'border-slate-400 bg-slate-100 text-slate-900' },
}

const EDGE_TONE: Record<EnterpriseWorkflowEdge['kind'], string> = {
  success: '#2563eb',
  condition: '#d97706',
  default: '#64748b',
  failure: '#dc2626',
  timeout: '#ea580c',
  parallel: '#7c3aed',
  compensation: '#be123c',
}

interface WorkflowVisualCanvasProps {
  nodes: EnterpriseWorkflowNode[]
  edges: EnterpriseWorkflowEdge[]
  selectedNodeId: string | null
  readOnly?: boolean
  onSelectNode: (nodeId: string) => void
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void
}

interface DragState {
  nodeId: string
  pointerId: number
  offsetX: number
  offsetY: number
}

export function WorkflowVisualCanvas({
  nodes,
  edges,
  selectedNodeId,
  readOnly = false,
  onSelectNode,
  onMoveNode,
}: WorkflowVisualCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const dimensions = useMemo(() => {
    const width = Math.max(960, ...nodes.map((node) => node.position.x + NODE_WIDTH + CANVAS_PADDING))
    const height = Math.max(520, ...nodes.map((node) => node.position.y + NODE_HEIGHT + CANVAS_PADDING))
    return { width, height }
  }, [nodes])

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>, node: EnterpriseWorkflowNode) {
    onSelectNode(node.id)
    if (readOnly || !canvasRef.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      offsetX: event.clientX - bounds.left + canvasRef.current.parentElement!.scrollLeft - node.position.x,
      offsetY: event.clientY - bounds.top + canvasRef.current.parentElement!.scrollTop - node.position.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId || !canvasRef.current) return
    const bounds = canvasRef.current.getBoundingClientRect()
    const scrollParent = canvasRef.current.parentElement
    const x = event.clientX - bounds.left + (scrollParent?.scrollLeft || 0) - drag.offsetX
    const y = event.clientY - bounds.top + (scrollParent?.scrollTop || 0) - drag.offsetY
    onMoveNode(drag.nodeId, {
      x: Math.max(CANVAS_PADDING, Math.round(x / 8) * 8),
      y: Math.max(CANVAS_PADDING, Math.round(y / 8) * 8),
    })
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="relative overflow-auto rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <div
        ref={canvasRef}
        className="relative bg-[radial-gradient(circle,#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(circle,#334155_1px,transparent_1px)]"
        style={{ width: dimensions.width, height: dimensions.height }}
        aria-label="Editor visual do workflow"
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
          aria-hidden="true"
        >
          <defs>
            {Object.entries(EDGE_TONE).map(([kind, color]) => (
              <marker
                key={kind}
                id={`workflow-arrow-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
              </marker>
            ))}
          </defs>
          {edges.map((edge) => {
            const source = nodesById.get(edge.sourceNodeId)
            const target = nodesById.get(edge.targetNodeId)
            if (!source || !target) return null
            const x1 = source.position.x + NODE_WIDTH
            const y1 = source.position.y + NODE_HEIGHT / 2
            const x2 = target.position.x
            const y2 = target.position.y + NODE_HEIGHT / 2
            const bend = Math.max(72, Math.abs(x2 - x1) / 2)
            const path = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={EDGE_TONE[edge.kind]}
                  strokeWidth="2"
                  strokeDasharray={edge.kind === 'default' ? '6 5' : undefined}
                  markerEnd={`url(#workflow-arrow-${edge.kind})`}
                />
                {edge.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 8}
                    textAnchor="middle"
                    className="fill-slate-600 text-[11px] font-semibold dark:fill-slate-300"
                  >
                    {edge.label.slice(0, 36)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {nodes.map((node) => {
          const meta = NODE_META[node.type]
          const Icon = meta.icon
          const selected = selectedNodeId === node.id
          return (
            <button
              key={node.id}
              type="button"
              className={cn(
                'absolute flex h-[76px] w-[184px] touch-none items-start gap-2 rounded-md border-2 p-3 text-left shadow-sm transition-shadow',
                meta.tone,
                selected && 'ring-2 ring-bbt-accent ring-offset-2 dark:ring-offset-slate-950',
                !readOnly && 'cursor-grab active:cursor-grabbing',
              )}
              style={{ left: node.position.x, top: node.position.y }}
              onPointerDown={(event) => beginDrag(event, node)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-pressed={selected}
              title={readOnly ? node.name : `${node.name}. Arraste para reposicionar.`}
            >
              <span className="mt-0.5 rounded bg-white/70 p-1 dark:bg-slate-900/40">
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold">{node.name}</span>
                <span className="mt-1 block truncate text-[10px] font-semibold uppercase text-current/70">
                  {meta.label}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[9px] text-current/60">
                  {node.key}
                </span>
              </span>
            </button>
          )
        })}

        {!nodes.length && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
            Adicione o evento inicial para começar o fluxo.
          </div>
        )}
      </div>
    </div>
  )
}

export function workflowNodeTypeLabel(type: EnterpriseWorkflowNodeType): string {
  return NODE_META[type].label
}
