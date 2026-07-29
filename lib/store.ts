import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { storage } from "@/lib/storage";

/**
 * Project + folder persistence, scoped per browser "owner".
 *
 * Each visitor gets an anonymous id (a `deck_uid` cookie set client-side) and
 * their data lives in its own document `stores/<owner>.json` in the storage
 * adapter (Vercel Blob when configured, else the filesystem). Sharding per owner
 * means users only see their own projects AND concurrent users never clobber
 * each other's document. No login — clearing the cookie starts a fresh space.
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

/** Resolve the workspace owner from the `deck_uid` cookie (falls back to a
 *  shared "public" space for requests without one). */
export function ownerFromRequest(req: NextRequest): string {
  return req.cookies.get("deck_uid")?.value?.trim() || "public";
}

const storeKey = (owner: string) => `stores/${safeOwner(owner)}.json`;
function safeOwner(owner: string): string {
  return (owner || "public").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "public";
}

async function load(owner: string): Promise<StoreData> {
  const d = await storage.getJson<StoreData>(storeKey(owner));
  return { projects: d?.projects ?? [], folders: d?.folders ?? [] };
}

async function persist(owner: string, d: StoreData): Promise<void> {
  await storage.putJson(storeKey(owner), d);
}

/* ---------------- folders ---------------- */
export async function listFolders(owner: string): Promise<Folder[]> {
  const d = await load(owner);
  return d.folders.slice().sort((a, b) => a.created_at - b.created_at);
}

export async function createFolder(owner: string, name: string): Promise<Folder> {
  const d = await load(owner);
  const folder: Folder = { id: randomUUID(), name: name.trim() || "새 폴더", created_at: Date.now() };
  d.folders.push(folder);
  await persist(owner, d);
  return folder;
}

export async function renameFolder(owner: string, id: string, name: string): Promise<Folder | null> {
  const d = await load(owner);
  const f = d.folders.find((x) => x.id === id);
  if (!f) return null;
  f.name = name.trim() || f.name;
  await persist(owner, d);
  return f;
}

/** Non-destructive: projects in the folder become ungrouped. */
export async function deleteFolder(owner: string, id: string): Promise<boolean> {
  const d = await load(owner);
  const before = d.folders.length;
  d.folders = d.folders.filter((x) => x.id !== id);
  if (d.folders.length === before) return false;
  for (const p of d.projects) if (p.folder_id === id) p.folder_id = null;
  await persist(owner, d);
  return true;
}

/* ---------------- projects ---------------- */
export async function listProjects(owner: string): Promise<Project[]> {
  const d = await load(owner);
  return d.projects.slice().sort((a, b) => b.updated_at - a.updated_at);
}

export async function getProject(owner: string, id: string): Promise<Project | null> {
  const d = await load(owner);
  return d.projects.find((p) => p.id === id) ?? null;
}

export async function createProject(
  owner: string,
  company_name: string,
  folder_id: string | null = null,
): Promise<Project> {
  const d = await load(owner);
  const now = Date.now();
  const project: Project = {
    id: randomUUID(),
    company_name: company_name.trim() || "새 덱",
    one_liner: "",
    folder_id: folder_id && d.folders.some((f) => f.id === folder_id) ? folder_id : null,
    created_at: now,
    updated_at: now,
    versions: 0,
    latest_job_id: null,
  };
  d.projects.push(project);
  await persist(owner, d);
  return project;
}

export async function moveProject(owner: string, id: string, folder_id: string | null): Promise<Project | null> {
  const d = await load(owner);
  const p = d.projects.find((x) => x.id === id);
  if (!p) return null;
  p.folder_id = folder_id && d.folders.some((f) => f.id === folder_id) ? folder_id : null;
  p.updated_at = Date.now();
  await persist(owner, d);
  return p;
}

export async function deleteProject(owner: string, id: string): Promise<boolean> {
  const d = await load(owner);
  const before = d.projects.length;
  d.projects = d.projects.filter((x) => x.id !== id);
  if (d.projects.length === before) return false;
  await persist(owner, d);
  return true;
}

/** Called when a generation finishes inside a project — bumps version + metadata. */
export async function recordGeneration(
  owner: string,
  id: string,
  info: { jobId: string; oneLiner?: string; companyName?: string },
): Promise<Project | null> {
  const d = await load(owner);
  const p = d.projects.find((x) => x.id === id);
  if (!p) return null;
  p.versions += 1;
  p.latest_job_id = info.jobId;
  if (info.oneLiner) p.one_liner = info.oneLiner;
  if (info.companyName && (!p.company_name || p.company_name === "새 덱")) p.company_name = info.companyName;
  p.updated_at = Date.now();
  await persist(owner, d);
  return p;
}
