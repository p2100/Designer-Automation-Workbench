import {digest, requireText} from './io.mjs';

export function siteIdentity(value) {
  requireText(value, 'Source site');
  const text = value.trim().replace(/\\/g, '/');
  const ssh = text.match(/^[^/@]+@([^:]+):(.+)$/);
  if (ssh)
    return (ssh[1] + '/' + ssh[2])
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '')
      .toLowerCase();
  if (/^https?:\/\//.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch {
      throw Error('Invalid source site identity');
    }
    if (url.username || url.password || url.search || url.hash)
      throw Error('Use a credential-free source repository identity');
    return (url.host + url.pathname)
      .replace(/\.git\/?$/, '')
      .replace(/\/$/, '')
      .toLowerCase();
  }
  return text
    .replace(/\.git\/?$/, '')
    .replace(/\/$/, '')
    .toLowerCase();
}
export function caseContent(input) {
  for (const key of ['summary', 'cause', 'prevention', 'actor'])
    requireText(input[key], key);
  if (
    !['general', 'site-preference', 'hard-failure', 'local-reference', 'unclassified'].includes(
      input.classification,
    )
  )
    throw Error('Invalid experience classification');
  if (
    !Array.isArray(input.scope?.pages) ||
    !input.scope.pages.length ||
    input.scope.pages.some((p) => typeof p !== 'string' || !p)
  )
    throw Error('Experience requires page scope');
  if (input.scope.site !== undefined)
    requireText(input.scope.site, 'Site identity');
  if (input.classification === 'site-preference' && !input.scope.site)
    throw Error('Site preference needs site identity');
  if (input.classification === 'local-reference' &&
      (!input.source?.site?.startsWith('local:') || !input.learning?.transferable))
    throw Error('Local reference requires local source and transferable learning');
  if (input.classification === 'local-reference') {
    const families = (input.scope?.pages || []).map(page =>
      page.startsWith('app:') ? 'app' : page.startsWith('games:') ? 'games' :
      page !== '*' && !page.includes(':') ? 'coupon' : 'unknown');
    if (!families.length || families.includes('unknown') || new Set(families).size !== 1)
      throw Error('Local reference requires one explicit site type and its own page families');
  }
  if (
    !Array.isArray(input.evidence) ||
    !input.evidence.length ||
    input.evidence.some((e) => !/^[a-f0-9]{64}$/.test(e.candidate || ''))
  )
    throw Error('Experience needs exact candidate evidence');
  if (
    input.verification !== undefined &&
    (!input.verification ||
      typeof input.verification !== 'object' ||
      Array.isArray(input.verification) ||
      ['retested', 'designerApproved'].some(
        (key) =>
          input.verification[key] !== undefined &&
          typeof input.verification[key] !== 'boolean',
      ))
  )
    throw Error('Invalid experience verification');
  if (input.learning) {
    if (
      !/^[a-z][a-z0-9.-]{3,99}$/.test(input.learning.key || '') ||
      typeof input.learning.when !== 'string' ||
      !Array.isArray(input.learning.exceptions) ||
      input.learning.exceptions.some((x) => typeof x !== 'string') ||
      typeof input.learning.transferable !== 'boolean' ||
      typeof input.scope.component !== 'string' ||
      !input.scope.component.trim()
    )
      throw Error('Invalid reusable lesson metadata');
    if (
      !input.source ||
      typeof input.source.site !== 'string' ||
      typeof input.source.task !== 'string' ||
      !Array.isArray(input.source.checkIds) ||
      !input.source.checkIds.length ||
      input.source.checkIds.some((id) => typeof id !== 'string')
    )
      throw Error('Actual source site, task and checks are required');
  }
  if (input.approval) {
    const approval = input.approval;
    requireText(approval.actor, 'Actual designer');
    requireText(approval.text, 'Actual designer confirmation');
    if (
      approval.decision !== 'approve' ||
      !Number.isFinite(Date.parse(approval.at)) ||
      !/^[a-f0-9]{64}$/.test(approval.candidate || '')
    )
      throw Error('Exact designer confirmation is required');
    if (
      input.classification === 'unclassified' ||
      input.verification?.retested !== true ||
      input.verification?.designerApproved !== true ||
      input.verification?.candidate !== approval.candidate ||
      !input.evidence.some((e) => e.candidate === approval.candidate)
    )
      throw Error(
        'Confirmation must match the retested candidate and a classified lesson',
      );
  }
  // Reconstruct the same identity for local retries, MongoDB and old JSON imports.
  return {
    summary: input.summary,
    cause: input.cause,
    prevention: input.prevention,
    classification: input.classification,
    scope: input.learning
      ? {
          ...input.scope,
          ...(input.scope.site ? {site: siteIdentity(input.scope.site)} : {}),
        }
      : input.scope,
    evidence: input.evidence,
    verification: input.verification || {},
    actor: input.actor,
    ...(input.approval ? {approval: input.approval} : {}),
    ...(input.learning ? {learning: input.learning} : {}),
    ...(input.source
      ? {
          source: input.learning
            ? {...input.source, site: siteIdentity(input.source.site)}
            : input.source,
        }
      : {}),
  };
}
export const caseId = (content) => 'case-' + digest(content).slice(0, 32);
export function capturedCase(content, createdAt = new Date().toISOString()) {
  const entry = {
    ...content,
    id: caseId(content),
    status: 'candidate',
    revision: 1,
    createdAt,
  };
  return content.approval
    ? {
        ...entry,
        status: 'active',
        revision: 2,
        publishedBy: content.approval.actor,
        reason: content.approval.text,
        publishedAt: createdAt,
        activation: 'designer-confirmation',
      }
    : entry;
}
export function validatePublication(entry, {expectedRevision, actor, reason}) {
  requireText(actor, 'Maintainer');
  requireText(reason, 'Validation reason');
  if (!entry || entry.revision !== expectedRevision)
    throw Error('Experience revision is absent or stale');
  if (entry.classification === 'unclassified')
    throw Error(
      'Unclassified dialogue feedback must be investigated before activation',
    );
  if (
    entry.verification.retested !== true ||
    entry.verification.designerApproved !== true
  )
    throw Error(
      'Retest and designer approval are required before shared activation',
    );
}
export function validateStoredCase(entry) {
  if (caseId(caseContent(entry)) !== entry.id)
    throw Error('Stored case identity does not match its content');
  if (
    !['candidate', 'active', 'conflict'].includes(entry.status) ||
    !Number.isInteger(entry.revision) ||
    entry.revision < 1 ||
    !Number.isFinite(Date.parse(entry.createdAt))
  )
    throw Error('Invalid stored case lifecycle');
  if (entry.status === 'active') {
    validatePublication(entry, {
      expectedRevision: entry.revision,
      actor: entry.publishedBy,
      reason: entry.reason,
    });
    if (entry.revision < 2 || !Number.isFinite(Date.parse(entry.publishedAt)))
      throw Error('Invalid published case metadata');
  }
  return entry;
}

export function validateLessonSpecs(lessons) {
  if (!Array.isArray(lessons))
    throw Error('Agent lesson specifications must be an array');
  for (const lesson of lessons) {
    for (const key of ['summary', 'cause', 'prevention'])
      requireText(lesson[key], 'Confirmed ' + key);
    if (
      !lesson.learning?.key ||
      !lesson.learning?.when ||
      !lesson.component ||
      (!lesson.pages?.length && !lesson.checkIds?.length)
    )
      throw Error(
        'Each lesson needs a stable key, component, applicability and explicit pages or affected check IDs',
      );
    if (
      !['general', 'site-preference', 'hard-failure'].includes(
        lesson.classification || 'general',
      )
    )
      throw Error('Classify the verified correction before confirmation');
  }
  return lessons;
}
