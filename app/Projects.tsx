"use client";

import { useEffect, useRef, useState } from "react";
import SparkLogo from "./SparkLogo";

interface Folder {
  id: string;
  name: string;
}
interface Project {
  id: string;
  company_name: string;
  one_liner: string;
  folder_id: string | null;
  versions: number;
}

const jf = async (res: Response) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.json();
};
const api = {
  listProjects: (): Promise<Project[]> => fetch("/api/projects").then(jf),
  listFolders: (): Promise<Folder[]> => fetch("/api/folders").then(jf),
  createProject: (company_name: string): Promise<Project> =>
    fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name }),
    }).then(jf),
  deleteProject: (id: string) => fetch(`/api/projects/${id}`, { method: "DELETE" }).then(jf),
  moveProject: (id: string, folder_id: string | null) =>
    fetch(`/api/projects/${id}/folder`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_id }),
    }).then(jf),
  createFolder: (name: string) =>
    fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(jf),
  renameFolder: (id: string, name: string) =>
    fetch(`/api/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).then(jf),
  deleteFolder: (id: string) => fetch(`/api/folders/${id}`, { method: "DELETE" }).then(jf),
};

/**
 * 프로젝트 화면 — 새 프로젝트 만들기 + 폴더로 묶어 보기.
 * 폴더에 넣거나 뺄 수 있고, 폴더를 지워도 프로젝트는 미분류로 남는다.
 */
export default function Projects({
  onOpenProject,
  onDeleteProject,
}: {
  onOpenProject: (id: string) => void;
  onDeleteProject?: (id: string) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [confirmFolder, setConfirmFolder] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; name: string } | null>(null);
  const overRef = useRef<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    const [ps, fs] = await Promise.all([api.listProjects(), api.listFolders()]);
    setProjects(ps);
    setFolders(fs);
  }
  useEffect(() => {
    refresh().catch((e) => setError((e as Error).message));
  }, []);

  async function create() {
    setError("");
    try {
      const p = await api.createProject(companyName.trim());
      setCompanyName("");
      onOpenProject(p.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addFolder() {
    const name = newFolder.trim();
    if (!name) return;
    try {
      await api.createFolder(name);
      setNewFolder("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeFolder(f: Folder) {
    try {
      setError("");
      await api.deleteFolder(f.id);
      setConfirmFolder(null);
      await refresh();
    } catch (e) {
      setError(`폴더를 삭제하지 못했습니다: ${(e as Error).message}`);
    }
  }

  async function renameFolder(f: Folder) {
    const name = window.prompt("폴더 이름", f.name);
    if (name == null || !name.trim()) return;
    await api.renameFolder(f.id, name.trim()).catch((e) => setError((e as Error).message));
    await refresh();
  }

  async function move(project: Project, folderId: string | null) {
    await api.moveProject(project.id, folderId).catch((e) => setError((e as Error).message));
    await refresh();
  }

  async function remove(p: Project) {
    const detail = p.versions
      ? `버전 ${p.versions}개와 업로드한 자료가 모두 사라지며, 되돌릴 수 없습니다.`
      : `업로드한 자료가 사라지며, 되돌릴 수 없습니다.`;
    if (!window.confirm(`'${p.company_name}' 프로젝트를 삭제할까요?\n${detail}`)) return;
    setBusyId(p.id);
    try {
      await api.deleteProject(p.id);
      onDeleteProject?.(p.id);
      await refresh();
    } catch (e) {
      setError(`삭제하지 못했습니다: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  const ungrouped = projects.filter((p) => p.folder_id == null);
  const inFolder = (fid: string) => projects.filter((p) => p.folder_id === fid);

  // ---- 드래그 앤 드롭 (포인터 기반: 누르는 즉시 끌린다) ----
  function startDrag(e: React.PointerEvent, p: Project) {
    e.preventDefault();
    document.body.style.userSelect = "none";
    setDragId(p.id);
    setGhost({ x: e.clientX, y: e.clientY, name: p.company_name });
    overRef.current = null;

    const onPointerMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const zone = el && (el as HTMLElement).closest("[data-drop]");
      const target = zone ? zone.getAttribute("data-drop") : null;
      overRef.current = target;
      setOverTarget(target);
      setGhost({ x: ev.clientX, y: ev.clientY, name: p.company_name });
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.style.userSelect = "";
      const target = overRef.current;
      setDragId(null);
      setOverTarget(null);
      setGhost(null);
      overRef.current = null;
      if (target == null) return;
      const folderId = target === "ungrouped" ? null : target;
      if (p.folder_id === folderId) return;
      move(p, folderId);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  const ProjectRow = ({ p }: { p: Project }) => (
    <div
      className={`fileitem ${dragId === p.id ? "dragging" : ""} ${selectedId === p.id ? "selected" : ""}`}
      style={{ marginBottom: 6 }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button, select")) return;
        setSelectedId(p.id);
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button, select")) return;
        onOpenProject(p.id);
      }}
      title="한 번 클릭하면 선택, 더블클릭하면 열립니다"
    >
      <span
        className="drag-handle"
        title="끌어서 폴더로 옮기거나 폴더에서 빼기"
        aria-label="끌기 손잡이"
        onPointerDown={(e) => startDrag(e, p)}
      >
        <span style={{ display: "inline-flex", transform: "rotate(270deg)" }}>
          <SparkLogo size={35} />
        </span>
      </span>
      <span className="name">
        {p.company_name}
        {p.one_liner ? ` — ${p.one_liner}` : ""}
      </span>
      <span className="muted">{p.versions}개 버전</span>
      <button className="small" onClick={() => onOpenProject(p.id)}>
        열기
      </button>
      <button className="danger small" disabled={busyId === p.id} onClick={() => remove(p)}>
        {busyId === p.id ? "삭제 중…" : "삭제"}
      </button>
    </div>
  );

  return (
    <div className="wrap narrow">
      <div className="card">
        <h2 className="h2plain">새 프로젝트</h2>
        <div className="field">
          <label>회사명</label>
          <input
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && companyName.trim() && create()}
            placeholder="예: (주)스파크컴퍼니"
          />
        </div>
        <button className="primary" style={{ width: "auto", marginTop: 0 }} disabled={!companyName.trim()} onClick={create}>
          시작하기
        </button>
        {error && <p className="err">{error}</p>}
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 14 }}>
          <h2 className="h2plain" style={{ margin: 0, flex: 1 }}>
            프로젝트
          </h2>
          <input
            style={{ maxWidth: 200 }}
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addFolder()}
            placeholder="새 폴더 이름"
          />
          <button className="small" disabled={!newFolder.trim()} onClick={addFolder}>
            폴더 추가
          </button>
        </div>

        {projects.length === 0 && <p className="muted">아직 프로젝트가 없습니다. 위에서 새로 만드세요.</p>}

        {folders.map((f) => {
          const rows = inFolder(f.id);
          const open = !collapsed[f.id];
          return (
            <div
              className={`folder ${dragId != null ? "drop-target" : ""} ${overTarget === f.id ? "drop-over" : ""}`}
              key={f.id}
              data-drop={f.id}
            >
              <div className="folder-head">
                <button className="folder-toggle" onClick={() => setCollapsed((c) => ({ ...c, [f.id]: open }))} aria-expanded={open}>
                  <span className="folder-caret">{open ? "▾" : "▸"}</span>
                  <span className="folder-icon" aria-hidden="true">
                    📁
                  </span>
                  <span className="folder-name">{f.name}</span>
                  <span className="muted">{rows.length}</span>
                </button>
                <button className="icon-btn" onClick={() => renameFolder(f)} title="폴더 이름 수정" aria-label="폴더 이름 수정">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path d="M13.5 6.5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </button>
                {confirmFolder === f.id ? (
                  <>
                    <button className="small danger" onClick={() => removeFolder(f)} title="안의 프로젝트는 미분류로 남습니다">
                      정말 삭제
                    </button>
                    <button className="small" onClick={() => setConfirmFolder(null)}>
                      취소
                    </button>
                  </>
                ) : (
                  <button className="small danger" onClick={() => setConfirmFolder(f.id)} title="폴더만 삭제 (안의 프로젝트는 미분류로 남음)">
                    폴더 삭제
                  </button>
                )}
              </div>
              {open && (
                <div className="folder-body">
                  {rows.length === 0 ? (
                    <p className="muted" style={{ margin: "4px 0 8px" }}>
                      비어 있음 — 프로젝트를 여기로 끌어다 놓으세요.
                    </p>
                  ) : (
                    rows.map((p) => <ProjectRow key={p.id} p={p} />)
                  )}
                </div>
              )}
            </div>
          );
        })}

        {(ungrouped.length > 0 || folders.length > 0) && (
          <div
            className={`folder ungrouped-zone ${dragId != null ? "drop-target" : ""} ${overTarget === "ungrouped" ? "drop-over" : ""}`}
            data-drop="ungrouped"
          >
            {folders.length > 0 && (
              <div className="folder-head">
                <span className="folder-name muted" style={{ paddingLeft: 4 }}>
                  미분류 <span style={{ fontWeight: 400 }}>(여기로 끌어다 놓으면 폴더에서 빠집니다)</span>
                </span>
              </div>
            )}
            <div className="folder-body">
              {ungrouped.length === 0 ? (
                <p className="muted" style={{ margin: "4px 0 8px" }}>
                  {folders.length > 0 ? "폴더에서 빼낸 프로젝트가 여기에 놓입니다." : "프로젝트가 없습니다."}
                </p>
              ) : (
                ungrouped.map((p) => <ProjectRow key={p.id} p={p} />)
              )}
            </div>
          </div>
        )}
      </div>

      {ghost && (
        <div className="drag-ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>
          {ghost.name}
        </div>
      )}
    </div>
  );
}
