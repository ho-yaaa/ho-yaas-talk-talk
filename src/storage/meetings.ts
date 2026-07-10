import { openDB, type DBSchema } from 'idb';
import { DEFAULT_GLOSSARY } from '../constants';
import type { GlossaryTerm, MeetingRecord } from '../types';

interface InterpreterDb extends DBSchema {
  meetings: {
    key: string;
    value: MeetingRecord;
    indexes: { 'by-startedAt': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

let dbPromise: ReturnType<typeof openDB<InterpreterDb>> | undefined;

const memoryMeetings = new Map<string, MeetingRecord>();
let memoryGlossary: GlossaryTerm[] | undefined;

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined';
}

function getDb() {
  dbPromise ??= openDB<InterpreterDb>('ko-ja-interpreter', 1, {
    upgrade(db) {
      const meetings = db.createObjectStore('meetings', { keyPath: 'id' });
      meetings.createIndex('by-startedAt', 'startedAt');
      db.createObjectStore('settings');
    },
  });
  return dbPromise;
}

export async function saveMeeting(record: MeetingRecord): Promise<void> {
  if (!hasIndexedDb()) {
    memoryMeetings.set(record.id, record);
    return;
  }
  const db = await getDb();
  await db.put('meetings', record);
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  if (!hasIndexedDb()) {
    return [...memoryMeetings.values()].sort((a, b) => b.startedAt - a.startedAt);
  }
  const db = await getDb();
  const records = await db.getAllFromIndex('meetings', 'by-startedAt');
  return records.reverse();
}

export async function clearMeetings(): Promise<void> {
  if (!hasIndexedDb()) {
    memoryMeetings.clear();
    return;
  }
  const db = await getDb();
  await db.clear('meetings');
}

export async function getGlossary(): Promise<GlossaryTerm[]> {
  if (!hasIndexedDb()) return memoryGlossary ?? DEFAULT_GLOSSARY;
  const db = await getDb();
  return ((await db.get('settings', 'glossary')) as GlossaryTerm[] | undefined) ?? DEFAULT_GLOSSARY;
}

export async function saveGlossary(glossary: GlossaryTerm[]): Promise<void> {
  if (!hasIndexedDb()) {
    memoryGlossary = glossary;
    return;
  }
  const db = await getDb();
  await db.put('settings', glossary, 'glossary');
}
