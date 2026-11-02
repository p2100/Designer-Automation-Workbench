import {siteIdentity} from './experience-case.mjs';
import path from 'node:path';

// A task's stable site is separate from the path of its isolated checkout.
// Omission keeps historical tasks usable; an explicitly empty identity is an error.
export function optionalExperienceSite(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 || /[\u0000-\u001f\u007f]/.test(value) ||
      (/\s/.test(value.trim()) && !path.isAbsolute(value.trim()) && !/^[a-z]:[\\/]/i.test(value.trim())))
    throw Error('Site identity must be a nonempty stable identifier or repository path without control characters');
  return siteIdentity(value);
}

export function resolveExperienceSite({site, boundSite, fallback} = {}) {
  const declared = optionalExperienceSite(site), bound = optionalExperienceSite(boundSite);
  if (declared !== undefined && bound !== undefined && declared !== bound) throw Error('Site identity conflicts with the bound site');
  return declared ?? bound ?? (fallback === undefined ? undefined : siteIdentity(fallback));
}

export function taskExperienceSite(task) {
  return resolveExperienceSite({site:task.config?.site, boundSite:task.libraryProjectId, fallback:task.repo});
}

export function experienceMatchesSite(entry, site) {
  if (!entry.scope?.site) return entry.classification !== 'site-preference';
  return site !== undefined && siteIdentity(entry.scope.site) === optionalExperienceSite(site);
}
