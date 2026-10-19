"use client";

import {
  isPendingScore,
  type PendingScore,
} from "./records";

const DATABASE_NAME = "ausgcon-2026-gurumi";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-scores";
const FALLBACK_STORAGE_KEY = "ausgcon-2026-gurumi-pending-semantic-v2";

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionFinished(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("IndexedDB could not be opened."));
    };
  });
  return databasePromise;
}

function readFallbackScores() {
  try {
    const stored = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isPendingScore) : [];
  } catch {
    return [];
  }
}

function writeFallbackScores(scores: PendingScore[]) {
  if (scores.length === 0) {
    window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(scores));
}

function orderedPendingScores(scores: Iterable<PendingScore>) {
  return [...scores].sort((first, second) =>
    first.record.createdAt.localeCompare(second.record.createdAt),
  );
}

async function migrateFallbackScores(database: IDBDatabase, fallbackScores: PendingScore[]) {
  if (fallbackScores.length === 0) return;
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const finished = transactionFinished(transaction);
  const store = transaction.objectStore(STORE_NAME);
  fallbackScores.forEach((score) => store.put(score));
  await finished;
  window.localStorage.removeItem(FALLBACK_STORAGE_KEY);
}

export async function listPendingGurumiScores() {
  const fallbackScores = readFallbackScores();

  try {
    const database = await openDatabase();
    await migrateFallbackScores(database, fallbackScores);
    const transaction = database.transaction(STORE_NAME, "readonly");
    const stored = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    const validScores = Array.isArray(stored) ? stored.filter(isPendingScore) : [];
    return orderedPendingScores(validScores);
  } catch {
    return orderedPendingScores(fallbackScores);
  }
}

export async function savePendingGurumiScore(score: PendingScore) {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(STORE_NAME).put(score);
    await finished;

    const remainingFallback = readFallbackScores().filter((candidate) => candidate.id !== score.id);
    writeFallbackScores(remainingFallback);
    return;
  } catch {
    const fallbackById = new Map(
      readFallbackScores().map((candidate) => [candidate.id, candidate]),
    );
    fallbackById.set(score.id, score);
    writeFallbackScores(orderedPendingScores(fallbackById.values()));
  }
}

export async function deletePendingGurumiScore(id: string) {
  try {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const finished = transactionFinished(transaction);
    transaction.objectStore(STORE_NAME).delete(id);
    await finished;
  } catch {
    // The localStorage fallback is still cleaned below.
  }

  try {
    writeFallbackScores(readFallbackScores().filter((candidate) => candidate.id !== id));
  } catch {
    // A later synchronization can safely retry deleting the same id.
  }
}
