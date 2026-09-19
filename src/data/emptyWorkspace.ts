import type { AppData } from '../types'
import { DATA_VERSION } from './seed'

/** Structural defaults for a new install. Real projects arrive from the
 * authoritative local or connected service; this object never invents them. */
export function createEmptyWorkspace(): AppData {
  return {
    version: DATA_VERSION,
    workspaceName: 'OpenSaddle',
    currentUserId: '',
    members: [], projects: [], chats: [], messages: [], agents: [], sites: [], apis: [],
    dashboards: [], interfaces: [], knowledge: [], services: [], capabilities: {}, tasks: [],
    environments: [], plugins: [], notifications: [], usageDays: [], budgets: [], wikiSummaries: [],
    wikiSettings: { individualSummariesEnabled: false, selectedProjectId: '', refreshCadence: 'manual' },
    permissionGrants: [], folders: [], sources: [], workflows: [], workflowRuns: [], agentSessions: [],
    settings: {
      theme: 'dark', displayName: '', email: '', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      routingPref: 'quality', askAboveCost: 0.5, enterpriseModelsOnly: false, keepDataLocal: true,
      notifications: { email: false, desktop: true, budgetAlerts: true, permissionRequests: true, runFailures: true },
      retentionDays: 365, toolRetentionDays: 90, region: '', trainingDisabled: true,
      approvedModels: [], ssoEnabled: false, scimEnabled: false, piiRestricted: false,
      networkPolicy: '', demoMode: false,
    },
    recentChatIds: [], pinnedArtifacts: [], activeProjectId: '', activeChatId: null,
  }
}
