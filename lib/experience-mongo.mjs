import {MongoClient} from 'mongodb';
import {
  caseContent,
  caseId,
  capturedCase,
  validateStoredCase,
  siteIdentity,
} from './experience-case.mjs';
import {
  captureLessons,
  searchLessons,
  visibleCase,
  manageLesson,
  validateStoredLesson,
  principleHash,
  invalidateGlobals,
  currentSupport,
  resolvedCase,
  lessonDedupKey,
} from './experience-policy.mjs';
import {digest} from './io.mjs';
import {creativeSearch,marker} from './team-creative.mjs';
const name = (value, label) => {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,100}$/.test(value || ''))
    throw Error('Invalid ' + label);
  return value;
};
const plain = ({_id, _kind, dedupeKey, ...entry}) => entry;
const caseFilter = {_kind: {$ne: 'lesson'}};
export class MongoExperienceStore {
  static async connect({uri, database, collection = 'cases'}) {
    if (typeof uri !== 'string' || !uri.startsWith('mongodb'))
      throw Error('Shared experience requires an explicit MongoDB connection');
    name(database, 'experience database');
    name(collection, 'experience collection');
    const client = new MongoClient(uri, {
      appName: 'designer-automation-experience',
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      maxPoolSize: 10,
      readPreference: 'primary',
      writeConcern: {w: 'majority', journal: true, wtimeoutMS: 10000},
    });
    try {
      await client.connect();
      if (!(await client.db('admin').command({hello: 1})).setName)
        throw Error('A replica set is required');
      const store = new MongoExperienceStore(client, database, collection);
      await store.ensureIndexes();
      return store;
    } catch (error) {
      await client.close();
      throw Error(
        'MongoDB initialization did not succeed (' +
          (error.code || error.name) +
          '). Check the private configuration and replica set.',
      );
    }
  }
  constructor(client, database, collection) {
    this.client = client;
    this.database = database;
    this.collectionName = collection;
    this.collection = client.db(database).collection(collection);
  }
  async ensureIndexes() {
    await this.collection.createIndex(
      {_kind: 1, aliases: 1},
      {name: 'lesson_aliases'},
    );
    await this.collection.createIndex(
      {_kind: 1, 'history.principleHash': 1},
      {name: 'lesson_history_principle'},
    );
    await this.collection.createIndex(
      {dedupeKey: 1},
      {
        name: 'lesson_dedup',
        unique: true,
        partialFilterExpression: {_kind: 'lesson', dedupeKey: {$exists: true}},
      },
    );
    await this.collection.createIndex(
      {_kind: 1, 'learning.key': 1, 'scope.site': 1},
      {name: 'lesson_key_site'},
    );
    await this.collection.createIndex(
      {_kind: 1, principleHash: 1},
      {name: 'lesson_principle'},
    );
    await this.collection.createIndex(
      {status: 1, 'scope.pages': 1},
      {name: 'status_pages'},
    );
  }
  async close() {
    await this.client.close();
  }
  async health() {
    await this.client.db(this.database).command({ping: 1});
    return {
      backend: 'mongodb',
      database: this.database,
      collection: this.collectionName,
    };
  }
  async transaction(action) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const session = this.client.startSession();
      try {
        return await session.withTransaction(() => action(session), {
          readConcern: {level: 'snapshot'},
          writeConcern: {w: 'majority', journal: true},
          readPreference: 'primary',
        });
      } catch (error) {
        if (error.code !== 11000 || attempt === 9) throw error;
      } finally {
        await session.endSession();
      }
    }
  }
  async related(content, session) {
    if (!content.learning) return [];
    return (
      await this.collection
        .find(
          {
            _kind: 'lesson',
            $or: [
              {aliases: content.learning.key},
              {principleHash: principleHash(content)},
              {'history.principleHash': principleHash(content)},
            ],
          },
          {session},
        )
        .toArray()
    ).map(plain);
  }
  async capture(input) {
    const content = caseContent(input),
      id = caseId(content);
    return this.transaction(async (session) => {
      const old = await this.collection.findOne({_id: id}, {session});
      if (old) {
        const refs = old.lessons?.map((l) => l.id) || [];
        return visibleCase(
          plain(old),
          (
            await this.collection
              .find({_id: {$in: refs}, _kind: 'lesson'}, {session})
              .toArray()
          ).map(plain),
        );
      }
      const {entry, updates} = captureLessons(
        capturedCase(content),
        await this.related(content, session),
      );
      for (const lesson of updates)
        await this.collection.replaceOne(
          {_id: lesson.id},
          {
            _id: lesson.id,
            _kind: 'lesson',
            ...lesson,
            dedupeKey: lessonDedupKey(lesson),
          },
          {upsert: true, session},
        );
      await this.collection.insertOne(
        {_id: entry.id, _kind: 'case', ...entry},
        {session},
      );
      return visibleCase(entry, updates);
    });
  }
  async search(filter = {}) {
    filter = {
      ...filter,
      ...(filter.site ? {site: siteIdentity(filter.site)} : {}),
    };
    const query = {
      _kind: 'lesson',
      ...(filter.includePending
        ? {}
        : {status: {$in: ['active', 'retracted']}}),
      $or: [
        {'scope.site': {$exists: false}},
        {'scope.site': null},
        ...(filter.site ? [{'scope.site': filter.site}] : []),
      ],
    };
    if (filter.pages?.length) query['scope.pages'] = {$in: filter.pages};
    if (filter.component) query['scope.component'] = filter.component;
    if (filter.key) query.aliases = filter.key;
    const result=searchLessons((await this.collection.find(query).toArray()).map(plain),filter);
    if(!filter.includeCreative)return result;
    creativeSearch(result,[],filter);
    const entries=(await this.collection.find({...caseFilter,classification:'unclassified','evidence.source':marker,'scope.pages':{$in:filter.pages}}).toArray()).map(plain);
    return creativeSearch(result,entries,filter);
  }
  async manage(input) {
    return this.transaction(async (session) => {
      const found = await this.collection.findOne(
        {_id: input.id, _kind: 'lesson'},
        {session},
      );
      if (!found) throw Error('Lesson is absent');
      const current = plain(found);
      if (input.action === 'inspect')
        return {
          ...current,
          relatedCases: (
            await this.collection
              .find(
                {
                  ...caseFilter,
                  $or: [{'lessons.id': current.id}, {conflicts: current.id}],
                },
                {session},
              )
              .limit(100)
              .toArray()
          ).map(plain),
        };
      const replacement = input.case
        ? capturedCase(caseContent(input.case))
        : undefined;
      const support = input.supportCaseIds
        ? (
            await this.collection
              .find(
                {...caseFilter, _id: {$in: input.supportCaseIds}},
                {session},
              )
              .toArray()
          ).map(plain)
        : [];
      const sourceLessons = support.length
        ? (
            await this.collection
              .find(
                {
                  _kind: 'lesson',
                  status: 'active',
                  caseIds: {$in: support.map((c) => c.id)},
                },
                {session},
              )
              .toArray()
          ).map(plain)
        : [];
      const result = manageLesson(
        current,
        input,
        replacement,
        currentSupport(support, sourceLessons),
      );
      if (result.replayed) return result;
      const globals = await this.related(
        {...current, learning: current.learning},
        session,
      );
      for (const lesson of [
        result.lesson,
        ...invalidateGlobals(current, globals, input),
      ])
        await this.collection.replaceOne(
          {_id: lesson.id},
          {
            _id: lesson.id,
            _kind: 'lesson',
            ...lesson,
            dedupeKey: lessonDedupKey(lesson),
          },
          {session},
        );
      if (replacement) {
        const old = await this.collection.findOne(
          {_id: replacement.id},
          {session},
        );
        const resolved = resolvedCase(
          old ? plain(old) : undefined,
          replacement,
          result.lesson,
          result.operationId,
        );
        await this.collection.replaceOne(
          {_id: replacement.id},
          {_id: replacement.id, _kind: 'case', ...resolved},
          {upsert: true, session},
        );
      }
      return result;
    });
  }
  async publish() {
    throw Error(
      'Legacy publishing is retired; use capture or experience_manage',
    );
  }
  async read() {
    return this.transaction(async (session) => {
      const all = await this.collection
        .find({}, {session})
        .sort({_id: 1})
        .toArray();
      return {
        version: 2,
        revision: all.reduce((n, c) => n + (c.revision || 0), 0),
        cases: all.filter((c) => c._kind !== 'lesson').map(plain),
        lessons: all.filter((c) => c._kind === 'lesson').map(plain),
      };
    });
  }
  async importCases(cases) {
    cases.forEach(validateStoredCase);
    let inserted = 0;
    for (const entry of cases) {
      const old = await this.collection.findOne({_id: entry.id});
      if (old && digest(plain(old)) !== digest(entry))
        throw Error('Import conflicts with existing case ' + entry.id);
      const result = await this.collection.updateOne(
        {_id: entry.id},
        {$setOnInsert: {_kind: 'case', ...entry}},
        {upsert: true},
      );
      inserted += result.upsertedCount;
    }
    return {inserted, total: cases.length};
  }
  async restoreInto(collection, input) {
    name(collection, 'restore collection');
    if (
      !collection.startsWith('restore_') ||
      collection === this.collectionName
    )
      throw Error(
        'Restore requires a new restore_ collection; live collection is preserved',
      );
    const state = Array.isArray(input) ? {cases: input, lessons: []} : input;
    state.cases.forEach(validateStoredCase);
    (state.lessons || []).forEach(validateStoredLesson);
    await this.client.db(this.database).createCollection(collection);
    const target = new MongoExperienceStore(
      this.client,
      this.database,
      collection,
    );
    await target.ensureIndexes();
    const docs = [
      ...state.cases.map((c) => ({_id: c.id, _kind: 'case', ...c})),
      ...(state.lessons || []).map((l) => ({
        _id: l.id,
        _kind: 'lesson',
        ...l,
        dedupeKey: lessonDedupKey(l),
      })),
    ];
    if (docs.length) await target.collection.insertMany(docs, {ordered: true});
    const actual = await target.read();
    const sort = (items) => [...items].sort((a, b) => a.id.localeCompare(b.id));
    const expectedHash = digest({
      cases: sort(state.cases),
      lessons: sort(state.lessons || []),
    });
    if (
      digest({cases: sort(actual.cases), lessons: sort(actual.lessons)}) !==
      expectedHash
    )
      throw Error('Restore checksum mismatch; live collection preserved');
    return {
      database: this.database,
      collection,
      count: state.cases.length,
      lessonCount: (state.lessons || []).length,
      hash: expectedHash,
      liveCollectionUnchanged: this.collectionName,
    };
  }
}
