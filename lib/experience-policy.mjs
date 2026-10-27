import {digest, requireText} from './io.mjs';
import {siteIdentity} from './experience-case.mjs';

const normalized = (value) =>
  value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
// Local paths are installation-specific and cannot establish independent sites.
const verifiedSource = site => typeof site === 'string' && !site.startsWith('local:');
const scopeIdentity = (scope) => ({
  site: scope.site || null,
  pages: [...scope.pages].sort(),
  component: scope.component,
});
export const principleHash = (entry) =>
  digest({
    guidance: normalized(entry.prevention),
    when: normalized(entry.learning.when),
    exceptions: (entry.learning.exceptions || []).map(normalized).sort(),
  });
export const lessonIdentity = (entry, scope) =>
  'lesson-' +
  digest({key: entry.learning.key, ...scopeIdentity(scope)}).slice(0, 32);
export const managementId = (input) => 'op-' + digest(input).slice(0, 32);
export const emptyExperience = () => ({version: 2, cases: [], lessons: []});
export function learningGaps(entry) {
  const gaps = [];
  if (entry.scope.pages.includes('*'))
    gaps.push('Explicit verified page families are required');
  if (!entry.approval) gaps.push('No exact designer confirmation');
  if (!entry.learning?.key || !entry.learning?.when || !entry.scope.component)
    gaps.push(
      'A stable principle key, component and applicability condition are required',
    );
  if (
    !entry.source?.site ||
    !entry.source?.task ||
    !entry.source?.checkIds?.length
  )
    gaps.push('Source site, task and actual checks are required');
  if (
    entry.learning &&
    (entry.summary.trim().length < 6 ||
      entry.cause.trim().length < 8 ||
      entry.prevention.trim().length < 12 ||
      entry.learning.when.trim().length < 8)
  )
    gaps.push(
      'Describe a concrete problem, confirmed cause, actionable prevention and applicability',
    );
  if (
    /pending investigation|pending verified|待调查|待验证|原因未知/i.test(
      entry.cause + ' ' + entry.prevention,
    )
  )
    gaps.push('Unresolved feedback is a case, not an applicable lesson');
  if (
    entry.approval &&
    (!entry.verification?.pages?.length ||
      entry.scope.pages.some(
        (page) => !entry.verification.pages.includes(page),
      ))
  )
    gaps.push('Every applicable page must have actual retest coverage');
  if (
    entry.scope.site &&
    entry.source?.site &&
    entry.scope.site !== entry.source.site
  )
    gaps.push('A case cannot claim a different source site');
  if (entry.classification === 'unclassified')
    gaps.push('Raw dialogue is not a reusable principle');
  return gaps;
}
export const lessonDedupKey = (lesson) =>
  digest({principle: lesson.principleHash, ...scopeIdentity(lesson.scope)});
const sameArea = (a, b) =>
  a.component === b.component && a.pages.some((page) => b.pages.includes(page));
const remember = (lesson, action, actor, reason, at, operationId) => ({
  ...lesson,
  history: [
    ...(lesson.history || []),
    {
      revision: lesson.revision,
      status: lesson.status,
      summary: lesson.summary,
      cause: lesson.cause,
      prevention: lesson.prevention,
      learning: lesson.learning,
      scope: lesson.scope,
      principleHash: lesson.principleHash,
      action,
      actor,
      reason,
      at,
      ...(operationId ? {operationId} : {}),
    },
  ],
});
function newLesson(entry, scope, status) {
  return {
    id: lessonIdentity(entry, scope),
    status,
    revision: 1,
    summary: entry.summary,
    cause: entry.cause,
    prevention: entry.prevention,
    classification: entry.classification,
    scope,
    learning: entry.learning,
    principleHash: principleHash(entry),
    aliases: [entry.learning.key],
    sites: [],
    siteEvidence: [],
    supportCount: 0,
    caseIds: [],
    history: [],
    approval: entry.approval,
    createdAt: entry.createdAt,
  };
}
function support(lesson, entry) {
  const sites = [...new Set([...lesson.sites, entry.source.site])].sort();
  const siteEvidence = [
    ...(lesson.siteEvidence || []).filter((e) => e.site !== entry.source.site),
    {site: entry.source.site, caseId: entry.id},
  ];
  return {
    ...lesson,
    sites,
    siteEvidence,
    supportCount: lesson.supportCount + 1,
    caseIds: [
      ...new Set([
        ...lesson.caseIds.slice(-98),
        entry.id,
        ...siteEvidence.map((e) => e.caseId),
      ]),
    ],
    aliases: [...new Set([...lesson.aliases, entry.learning.key])],
    updatedAt: entry.createdAt,
  };
}

export function captureLessons(entry, lessons) {
  const gaps = learningGaps(entry);
  if (gaps.length)
    return {
      entry: {
        ...entry,
        status: 'candidate',
        review: {
          required: Boolean(entry.approval),
          reasons: gaps,
          disposition:
            entry.classification === 'unclassified'
              ? 'feedback-only'
              : 'unverified',
        },
      },
      updates: [],
    };
  const updates = [],
    targets = [],
    conflicts = [];
  const siteScope = {...entry.scope, site: entry.source.site};
  const scopes = [
    siteScope,
    ...(entry.learning.transferable &&
    entry.classification !== 'site-preference'
      ? [{...entry.scope, site: undefined}]
      : []),
  ];
  for (const scope of scopes) {
    if (
      !scope.site &&
      !updates.some((l) => l.scope.site && l.status === 'active')
    )
      continue;
    const related = lessons.filter(
      (l) =>
        (l.scope.site || null) === (scope.site || null) &&
        sameArea(l.scope, scope) &&
        (l.aliases.includes(entry.learning.key) ||
          l.principleHash === principleHash(entry) ||
          l.history.some((h) => h.principleHash === principleHash(entry))),
    );
    let current = related.find(
      (l) =>
        l.scope.pages.length === scope.pages.length &&
        l.scope.pages.every((p) => scope.pages.includes(p)),
    );
    if (
      related.some(
        (l) =>
          l.status === 'retracted' || l.principleHash !== principleHash(entry),
      ) ||
      (related.length && !current)
    ) {
      conflicts.push(...related.map((l) => l.id));
      continue;
    }
    current ||= newLesson(entry, scope, scope.site ? 'active' : 'candidate');
    let next = support(current, entry);
    if (!scope.site && next.sites.filter(verifiedSource).length >= 2 && next.status === 'candidate')
      next = {
        ...remember(
          next,
          'promote',
          entry.approval.actor,
          'Same principle independently confirmed on at least two sites',
          entry.createdAt,
        ),
        status: 'active',
        revision: next.revision + 1,
      };
    updates.push(next);
    targets.push({id: next.id, status: next.status, revision: next.revision});
  }
  const siteActive = targets.some(
    (l) =>
      l.status === 'active' && updates.find((u) => u.id === l.id)?.scope.site,
  );
  return {
    entry: {
      ...entry,
      status: siteActive ? 'active' : 'conflict',
      lessons: targets,
      conflicts: [...new Set(conflicts)],
      review: conflicts.length
        ? {
            required: true,
            reasons: [
              'A related principle was withdrawn or differs; inspect and explicitly replace it',
            ],
          }
        : {required: false, reasons: []},
    },
    updates,
  };
}
export function visibleCase(entry, lessons) {
  const targets = (entry.lessons || [])
    .map((ref) => lessons.find((l) => l.id === ref.id))
    .filter(Boolean)
    .map((l) => ({
      id: l.id,
      status: l.status,
      revision: l.revision,
      scope: l.scope,
    }));
  return {
    ...entry,
    lessons: targets,
    shared: targets.some((l) => l.status === 'active'),
  };
}
export function searchLessons(
  lessons,
  {
    pages = [],
    site,
    query = '',
    key,
    component,
    includePending = false,
    limit = 30,
  } = {},
) {
  if (site) site = siteIdentity(site);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw Error('Lesson limit must be between 1 and 100');
  const blockers = lessons.filter(
    (l) => l.status === 'retracted' && l.scope.site === site,
  );
  let applicable = lessons.filter(
    (l) =>
      (includePending || l.status === 'active') &&
      (!l.scope.site || l.scope.site === site) &&
      (!pages.length || l.scope.pages.some((p) => pages.includes(p))) &&
      (!component || l.scope.component === component) &&
      (!key || l.aliases.includes(key)) &&
      (!query ||
        normalized(
          l.summary +
            ' ' +
            l.cause +
            ' ' +
            l.prevention +
            ' ' +
            l.learning.when,
        ).includes(normalized(query))),
  );
  applicable = applicable.filter(
    (l) =>
      l.scope.site ||
      !blockers.some(
        (b) =>
          sameArea(b.scope, l.scope) &&
          (b.aliases.some((k) => l.aliases.includes(k)) ||
            b.principleHash === l.principleHash),
      ),
  );
  // A specific site conclusion wins over its identical global projection.
  applicable = applicable.filter(
    (l) =>
      l.scope.site ||
      !applicable.some(
        (other) =>
          other.scope.site &&
          other.learning.key === l.learning.key &&
          sameArea(other.scope, l.scope),
      ),
  );
  const total = applicable.length;
  const cases = applicable
    .sort(
      (a, b) =>
        Number(Boolean(b.scope.site)) - Number(Boolean(a.scope.site)) ||
        (b.updatedAt || b.createdAt).localeCompare(
          a.updatedAt || a.createdAt,
        ) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
  return {
    revision: cases.reduce((n, l) => n + l.revision, 0),
    cases,
    total,
    truncated: total > cases.length,
    hash: digest(cases),
  };
}
export function manageLesson(current, input, replacement, supportCases = []) {
  if (input.action === 'inspect') return {lesson: current};
  const op = managementId(input),
    prior = current.history.find((h) => h.operationId === op);
  if (prior) return {lesson: current, operationId: op, replayed: true};
  requireText(input.actor, 'Actual designer');
  requireText(input.reason, 'Actual correction or withdrawal reason');
  if (
    !Number.isInteger(input.expectedRevision) ||
    current.revision !== input.expectedRevision
  )
    throw Error('Lesson revision is stale; inspect before correcting it');
  if (input.action === 'retract')
    return {
      lesson: {
        ...remember(
          current,
          'retract',
          input.actor,
          input.reason,
          new Date().toISOString(),
          op,
        ),
        status: 'retracted',
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      },
      operationId: op,
    };
  if (
    input.action !== 'replace' ||
    !replacement ||
    learningGaps(replacement).length
  )
    throw Error(
      'Replacement needs an exact approved, retested and scoped lesson',
    );
  if (!current.scope.site)
    supportCases = supportCases.filter(
      (c) =>
        c.currentSourceActive === true &&
        !learningGaps(c).length &&
        principleHash(c) === principleHash(replacement) &&
        current.aliases.includes(c.learning.key) &&
        sameArea(c.scope, current.scope) &&
        replacement.scope.pages.every((p) => c.scope.pages.includes(p)),
    );
  if (
    !current.scope.site &&
    new Set(
      supportCases
        .filter(
          (c) =>
            c.currentSourceActive === true &&
            !learningGaps(c).length &&
            principleHash(c) === principleHash(replacement) &&
            current.aliases.includes(c.learning.key) &&
            sameArea(c.scope, current.scope) &&
            replacement.scope.pages.every((p) => c.scope.pages.includes(p)),
        )
        .map((c) => c.source.site).filter(verifiedSource),
    ).size < 2
  )
    throw Error(
      'Global replacement requires two independently approved matching source cases',
    );
  if (
    (current.scope.site && replacement.source.site !== current.scope.site) ||
    replacement.scope.component !== current.scope.component ||
    !replacement.scope.pages.every((p) => current.scope.pages.includes(p)) ||
    !current.aliases.includes(replacement.learning.key)
  )
    throw Error(
      'Replacement must preserve the target site, component, principle key and page scope',
    );
  const next = {
    ...remember(
      current,
      'replace',
      input.actor,
      input.reason,
      replacement.createdAt,
      op,
    ),
    summary: replacement.summary,
    cause: replacement.cause,
    prevention: replacement.prevention,
    learning: replacement.learning,
    principleHash: principleHash(replacement),
    approval: replacement.approval,
    scope: {...replacement.scope, site: current.scope.site},
    status: 'active',
    revision: current.revision + 1,
    sites: current.scope.site
      ? [replacement.source.site]
      : [...new Set(supportCases.map((c) => c.source.site))],
    siteEvidence: current.scope.site
      ? [{site: replacement.source.site, caseId: replacement.id}]
      : supportCases.map((c) => ({site: c.source.site, caseId: c.id})),
    supportCount: current.scope.site ? 1 : supportCases.length,
    caseIds: current.scope.site
      ? [replacement.id]
      : supportCases.map((c) => c.id),
    updatedAt: replacement.createdAt,
  };
  return {lesson: next, operationId: op};
}
export function validateStoredLesson(lesson) {
  if (
    !/^lesson-[a-f0-9]{32}$/.test(lesson.id || '') ||
    !['active', 'candidate', 'retracted'].includes(lesson.status) ||
    !Number.isInteger(lesson.revision) ||
    lesson.revision < 1 ||
    !Array.isArray(lesson.history) ||
    !Array.isArray(lesson.scope?.pages) ||
    !lesson.scope.pages.length ||
    !Array.isArray(lesson.caseIds) ||
    !Array.isArray(lesson.sites)
  )
    throw Error('Invalid stored lesson');
  if (principleHash(lesson) !== lesson.principleHash)
    throw Error('Lesson principle checksum does not match');
  return lesson;
}

export function invalidateGlobals(current, lessons, input) {
  if (!current.scope.site || input.action === 'inspect') return [];
  return lessons
    .filter(
      (l) =>
        !l.scope.site &&
        l.sites.includes(current.scope.site) &&
        l.status !== 'retracted' &&
        l.principleHash === current.principleHash &&
        l.aliases.some((k) => current.aliases.includes(k)) &&
        sameArea(l.scope, current.scope),
    )
    .map((l) => ({
      ...remember(
        l,
        'source-invalidated',
        input.actor,
        input.reason,
        new Date().toISOString(),
        managementId(input),
      ),
      status: 'retracted',
      revision: l.revision + 1,
      updatedAt: new Date().toISOString(),
    }));
}

export function currentSupport(cases, lessons) {
  return cases.map((c) => ({
    ...c,
    currentSourceActive: Boolean(
      c.learning &&
        lessons.some(
          (l) =>
            l.status === 'active' &&
            l.scope.site === c.source?.site &&
            l.principleHash === principleHash(c) &&
            l.caseIds.includes(c.id),
        ),
    ),
  }));
}
export function resolvedCase(old, replacement, lesson, operationId) {
  const prior = old || replacement;
  return {
    ...prior,
    status: 'active',
    lessons: [
      ...(prior.lessons || []).filter((l) => l.id !== lesson.id),
      {id: lesson.id, status: lesson.status, revision: lesson.revision},
    ],
    conflicts: (prior.conflicts || []).filter((id) => id !== lesson.id),
    review: {required: false, reasons: []},
    resolution: {operationId, lesson: lesson.id},
  };
}
