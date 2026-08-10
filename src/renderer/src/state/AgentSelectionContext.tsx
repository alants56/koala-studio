import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AgentAdapterId } from '@shared/acp'
import { acp, assertAcpApi } from '@/services/acp'

interface AgentSelectionContextValue {
  currentAgent: AgentAdapterId
  switching: boolean
  revision: number
  setAgent: (agentId: AgentAdapterId) => Promise<void>
}

const AgentSelectionContext = createContext<AgentSelectionContextValue | null>(null)

export function AgentSelectionProvider({ children }: { children: ReactNode }): ReactElement {
  const [currentAgent, setCurrentAgent] = useState<AgentAdapterId>('claude')
  const [switching, setSwitching] = useState(false)
  const [revision, setRevision] = useState(0)
  const currentAgentRef = useRef<AgentAdapterId>('claude')
  const switchingRef = useRef(false)

  useEffect(() => {
    let active = true
    assertAcpApi()

    const applyAgent = (agentId: AgentAdapterId | undefined): void => {
      if (!active || !agentId) return
      currentAgentRef.current = agentId
      setCurrentAgent(agentId)
    }

    void acp.getState().then((state) => applyAgent(state.currentAgent))
    const removeState = acp.onState((state) => applyAgent(state.currentAgent))
    return () => {
      active = false
      removeState()
    }
  }, [])

  const setAgent = useCallback(async (agentId: AgentAdapterId) => {
    if (agentId === currentAgentRef.current || switchingRef.current) return

    switchingRef.current = true
    currentAgentRef.current = agentId
    setCurrentAgent(agentId)
    setSwitching(true)
    try {
      await acp.setAgent(agentId)
      setRevision((value) => value + 1)
    } catch (error) {
      const state = await acp.getState().catch(() => undefined)
      if (state?.currentAgent) {
        currentAgentRef.current = state.currentAgent
        setCurrentAgent(state.currentAgent)
      }
      throw error
    } finally {
      switchingRef.current = false
      setSwitching(false)
    }
  }, [])

  const value = useMemo<AgentSelectionContextValue>(
    () => ({ currentAgent, switching, revision, setAgent }),
    [currentAgent, revision, setAgent, switching]
  )

  return <AgentSelectionContext.Provider value={value}>{children}</AgentSelectionContext.Provider>
}

export function useAgentSelection(): AgentSelectionContextValue {
  const context = useContext(AgentSelectionContext)
  if (!context) throw new Error('useAgentSelection 必须在 <AgentSelectionProvider> 内使用')
  return context
}
