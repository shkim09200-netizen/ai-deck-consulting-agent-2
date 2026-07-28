import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Project + folder persistence for the SparkDeck dashboard.
 *
 * Plain JSON under `.data/store.json` — inspectable, no DB. Pinned to
 * globalThis so every API route bundle shares ONE in-memory copy (Next dev
 * gives each route its own module scope otherwise — the same trap the job
 * store hit). Writes go through to disk so folders/projects survive restarts.
 */
export interface Folder {
  id: string;
  name: string;
  created_at: number;
}

export interface Project {
  id: string;
  company_name: string;
  one_liner: string;
  folder_id: string | null;
  created_at: number;
  updated_at: number;
  versions: number;
  latest_job_id: string | null;
}

interface StoreData {
  projects: Project[];
  folders: Folder[];
}

// Defaults to `<cwd>/.data`; override with DECK_DATA_DIR to use a mounted
// volume (e.g. Railway /app/.data) so projects/folders survive redeploys.
const DATA_ROOT = process.env.DECK_DATA_DIR
  ? path.resolve(process.env.DECK_DATA_DIR)
  : path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_ROOT, "store.json");

const g = globalThis as unknown as { __deckStore?: StoreData };

async function load(): Promise<StoreData> {
  if (g.__deckStore) return g.__deckStore;
  try {
    const raw = await readFile(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoreData;
    g.__deckStore = { projects: parsed.projects ?? [], folders: parsed.folders ?? [] };
  } catch {
    g.__deckStore = { projects: [], folders: [] };
  }
  return g.__deckStore!;
}

async function persist(d: StoreData): Promise<void> {
  await mkdir(DATA_ROOT, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(d, null, 2), "utf8");
}

/* ---------------- folders ---------------- */
export async function listFolders(): Promise<Folder[]> {
  const d = await load();
  return d.folders.slice().sort((a, b) => a.created_at - b.created_at);
}

export async function createFolder(name: string): Promise<Folder> {
  const d = await load();
  const folder: Folder = { id: randomUUID(), name: name.trim() || "새 폴더", created_at: Date.now() };
  d.folders.push(folder);
  await persist(d);
  return folder;
}

export async function renameFolder(id: string, name: string): Promise<Folder | null> {
  const d = await load();
  const f = d.folders.find((x) => x.id === id);
  if (!f) return null;
  f.name = name.trim() || f.name;
  await persist(d);
  return f;
}

/** Non-destructive: projects in the folder become ungrouped. */
export async function deleteFolder(id: string): Promise<boolean> {
  const d = await load();
  const before = d.folders.length;
  d.folders = d.folders.filter((x) => x.id !== id);
  if (d.folders.length === before) return false;
  for (const p of d.projects) if (p.folder_id === id) p.folder_id = null;
  await persist(d);
  return true;
}

/* ---------------- projects ---------------- */
export async function listProjects(): Promise<Project[]> {
  const d = await load();
  return d.projects.slice().sort((a, b) => b.updated_at - a.updated_at);
}

export async function getProject(id: string): Promise<Project | null> {
  const d = await load();
  return d.projects.find((p) => p.id === id) ?? null;
}

export async function createProject(company_name: string, folder_id: string | null = null): Promise<Project> {
  const d = await load();
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    company_name: company_name.trim() || "새 프로젝트",
    one_liner: "",
    folder_id: folder_id && d.folders.some((f) => f.id === folder_id) ? folder_id : null,
    created_at: now,
    updated_at: now,
    versions: 0,
    latest_job_id: null,
  };
  d.projects.push(project);
  await persist(d);
  return project;
}

export async function moveProject(id: string, folder_id: string | null): Promise<Project | null> {
  const d = await load();
  const p = d.projects.find((x) => x.id === id);
  if (!p) return null;
  p.folder_id = folder_id && d.folders.some((f) => f.id === folder_id) ? folder_id : null;
  p.updated_at = Date.now();
  await persist(d);
  return p;
}

export async function deleteProject(id: string): Promise<boolean> {
  const d = await load();
  const before = d.projects.length;
  d.projects = d.projects.filter((x) => x.id !== id);
  if (d.projects.length === before) return false;
  await persist(d);
  return true;
}

/** Called when a generation finishes inside a project — bumps version + metadata. */
export async function recordGeneration(
  id: string,
  info: { jobId: string; oneLiner?: string; companyName?: string },
): Promise<Project | null> {
  const d = await load();
  const p = d.projects.find((x) => x.id === id);
  if (!p) return null;
  p.versions += 1;
  p.latest_job_id = info.jobId;
  if (info.oneLiner) p.one_liner = info.oneLiner;
  if (info.companyName && (!p.company_name || p.company_name === "새 프로젝트")) p.company_name = info.companyName;
  p.updated_at = Date.now();
  await persist(d);
  return p;
}
