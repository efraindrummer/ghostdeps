import type { GitHubInfo, HealthSignals, NpmInfo } from '../types.js';
import { daysBetween, daysSince } from '../utils.js';

/** Convierte datos crudos de npm + GitHub en señales normalizadas para el scoring. */
export function buildSignals(npm: NpmInfo, gh: GitHubInfo, now: Date): HealthSignals {
  const newPublisher =
    npm.latestPublisher !== null &&
    npm.previousPublishers.length > 0 &&
    !npm.previousPublishers.includes(npm.latestPublisher);

  return {
    daysSinceLastCommit: daysSince(gh.lastCommitAt, now),
    daysSinceLastPublish: daysSince(npm.latestPublishedAt, now),
    publishGapDays: daysBetween(npm.previousPublishedAt, npm.latestPublishedAt),
    archived: gh.archived,
    deprecated: npm.deprecated !== null,
    activeMaintainers: gh.activeMaintainers,
    unansweredIssues: gh.unansweredIssues,
    repoRedirected: gh.redirected,
    maintainersAdded: npm.maintainersChange?.added ?? [],
    newPublisher,
    installScripts: npm.installScripts,
  };
}
