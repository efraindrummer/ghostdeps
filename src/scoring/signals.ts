import { checkLicenseCompliance } from '../security/licenses.js';
import { detectTyposquatting } from '../security/typosquatting.js';
import type { GitHubInfo, HealthSignals, NpmInfo } from '../types.js';
import { daysBetween, daysSince } from '../utils.js';

export interface SignalOptions {
  allowedLicenses?: string[];
  deniedLicenses?: string[];
}

/** Convierte datos crudos de npm + GitHub en señales normalizadas para el scoring. */
export function buildSignals(
  npm: NpmInfo,
  gh: GitHubInfo,
  now: Date,
  options: SignalOptions = {},
): HealthSignals {
  const newPublisher =
    npm.latestPublisher !== null &&
    npm.previousPublishers.length > 0 &&
    !npm.previousPublishers.includes(npm.latestPublisher);

  const typo = detectTyposquatting(npm.name);
  const lic = checkLicenseCompliance(npm.license, options);

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
    typosquatting: typo,
    hasProvenance: npm.hasProvenance,
    license: npm.license,
    licenseDenied: lic.isDenied,
    licenseDeniedReason: lic.reason,
  };
}
