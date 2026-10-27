// File adapter used for migration fixtures. Production uses MongoDB transactions.
import path from 'node:path';
import {
  caseContent,
  capturedCase,
  caseId,
  validateStoredCase,
} from './experience-case.mjs';
import {
  emptyExperience,
  captureLessons,
  searchLessons,
  visibleCase,
  manageLesson,
  invalidateGlobals,
  currentSupport,
  resolvedCase,
} from './experience-policy.mjs';
import {exists, readJSON, locked} from './io.mjs';
import {durableJSON} from './durable-json.mjs';
import {creativeSearch,manageCreative,visualMarker} from './team-creative.mjs';
export class ExperienceStore {
  constructor(directory) {
    this.directory = directory;
    this.file = path.join(directory, 'store.json');
    this.queue = Promise.resolve();
  }
  async read() {
    const s = (await exists(this.file))
      ? await readJSON(this.file)
      : emptyExperience();
    return {...s, version: 2, lessons: s.lessons || []};
  }
  mutate(action) {
    const result = this.queue.then(() => locked(this.directory, action));
    this.queue = result.catch(() => {});
    return result;
  }
  capture(input) {
    return this.mutate(async () => {
      const state = await this.read(),
        content = caseContent(input),
        old = state.cases.find((c) => c.id === caseId(content));
      if (old) return visibleCase(old, state.lessons);
      const {entry, updates} = captureLessons(
        capturedCase(content),
        state.lessons,
      );
      const lessons = [
        ...state.lessons.filter((l) => !updates.some((u) => u.id === l.id)),
        ...updates,
      ];
      await durableJSON(this.file, {
        ...state,
        cases: [...state.cases, entry],
        lessons,
      });
      return visibleCase(entry, lessons);
    });
  }
  async search(filter) {
    const state=await this.read();
    return creativeSearch(searchLessons(state.lessons, filter),state.cases,filter || {});
  }
  manage(input) {
    return this.mutate(async () => {
      const state = await this.read();
      if(input.id.startsWith('case-')) {
        const current=state.cases.find(c=>c.id===input.id);
        const prior=[current,...state.cases.filter(c=>c.id!==input.id).sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''))].find(c=>c?.evidence?.some(e=>e.source===visualMarker&&(e.parent===input.id||(e.parent==='self'&&c.id===input.id))));
        const result=manageCreative(current,input,prior);
        if(input.action==='inspect'||result.replayed)return result;
        const cases=state.cases.map(c=>c.id===input.id?result.reference:c);
        if(result.replacement&&!cases.some(c=>c.id===result.replacement.id))cases.push(result.replacement);
        await durableJSON(this.file,{...state,cases});return result;
      }
      const current = state.lessons.find((l) => l.id === input.id);
      if (!current) throw Error('Lesson is absent');
      if (input.action === 'inspect')
        return {
          ...current,
          relatedCases: state.cases.filter(
            (c) =>
              c.lessons?.some((l) => l.id === current.id) ||
              c.conflicts?.includes(current.id),
          ),
        };
      const replacement = input.case
        ? capturedCase(caseContent(input.case))
        : undefined;
      const result = manageLesson(
        current,
        input,
        replacement,
        currentSupport(
          state.cases.filter((c) => input.supportCaseIds?.includes(c.id)),
          state.lessons,
        ),
      );
      const updates = [
        result.lesson,
        ...(result.replayed
          ? []
          : invalidateGlobals(current, state.lessons, input)),
      ];
      let cases = state.cases;
      if (replacement && !result.replayed) {
        const old = state.cases.find((c) => c.id === replacement.id);
        const resolved = resolvedCase(
          old,
          replacement,
          result.lesson,
          result.operationId,
        );
        cases = old
          ? state.cases.map((c) => (c.id === replacement.id ? resolved : c))
          : [...state.cases, resolved];
      }
      await durableJSON(this.file, {
        ...state,
        cases,
        lessons: state.lessons.map(
          (l) => updates.find((u) => u.id === l.id) || l,
        ),
      });
      return {...result, operationId: result.operationId};
    });
  }
  async publish() {
    throw Error(
      'Legacy publishing is retired; capture a scoped verified lesson or correct it with experience_manage',
    );
  }
  async importCases(cases) {
    cases.forEach(validateStoredCase);
    return this.mutate(async () => {
      const s = await this.read(),
        fresh = cases.filter((c) => !s.cases.some((old) => old.id === c.id));
      await durableJSON(this.file, {...s, cases: [...s.cases, ...fresh]});
      return {inserted: fresh.length, total: cases.length};
    });
  }
}
