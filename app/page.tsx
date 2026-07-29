"use client";

import { useState } from "react";
import Landing from "./Landing";
import { SparkWordmark } from "./SparkLogo";
import Projects from "./Projects";
import InputScreen from "./InputScreen";
import EditWorkspace from "./EditWorkspace";
import type { ChatMsg, JobResult } from "./types";

const EDIT_INTRO: ChatMsg = {
  role: "system",
  text: '자연어로 수정을 요청하세요. 예: "Traction을 앞으로 배치해줘", "Slide 5를 지표 카드 레이아웃으로 바꿔줘". 이전 요청을 기억하니 "방금 거 되돌려줘" 같은 후속 요청도 됩니다.',
};
const ASK_INTRO: ChatMsg = {
  role: "system",
  text: '결과물에 대해 물어보세요. 예: "슬라이드 구성을 설명해줘", "시장 규모 정보는 어느 슬라이드에 있어?", "Traction은 몇 번째로 나와?" · 이 챗봇은 설명만 하고 문서를 바꾸지 않습니다.',
};

/**
 * 세 화면을 상단 탭으로 오간다.
 *   덱  — 목록/새로 만들기 + 폴더. 언제나 이동 가능.
 *   입력·생성 — 열어둔 덱의 자료 업로드·생성. 덱이 있어야 활성.
 *   편집기    — Script/Skeleton 편집. 생성된 결과가 있어야 활성.
 */
type View = "projects" | "input" | "editor";
const TABS: Array<{ key: View; label: string }> = [
  { key: "projects", label: "덱" },
  { key: "input", label: "입력 · 생성" },
  { key: "editor", label: "편집기" },
];

export default function App() {
  // Give this browser an anonymous workspace id (once, before any child fetch)
  // so every API request carries the deck_uid cookie and data is scoped to this
  // browser — each visitor sees only their own projects, no login needed.
  useState(() => {
    if (typeof document !== "undefined" && !/(^|;\s*)deck_uid=/.test(document.cookie)) {
      document.cookie = `deck_uid=${crypto.randomUUID()}; path=/; max-age=31536000; SameSite=Lax`;
    }
    return null;
  });
  const [entered, setEntered] = useState(false);
  const [view, setView] = useState<View>("projects");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ jobId: string; result: JobResult } | null>(null);
  // Chat histories live here (not in EditWorkspace) so switching tabs keeps the
  // conversation; they reset only when a different deck (jobId) is opened.
  const [editChat, setEditChat] = useState<ChatMsg[]>([EDIT_INTRO]);
  const [askChat, setAskChat] = useState<ChatMsg[]>([ASK_INTRO]);

  const openEditor = (jobId: string, result: JobResult) => {
    if (editor?.jobId !== jobId) {
      setEditChat([EDIT_INTRO]);
      setAskChat([ASK_INTRO]);
    }
    setEditor({ jobId, result });
    setView("editor");
  };

  if (!entered) {
    return (
      <Landing
        onStart={() => {
          setView("projects");
          setEntered(true);
        }}
      />
    );
  }

  const enabled: Record<View, boolean> = {
    projects: true,
    input: projectId != null,
    editor: editor != null,
  };
  const go = (key: View) => {
    if (enabled[key]) setView(key);
  };

  return (
    <>
      <nav className="tabbar" role="tablist" aria-label="화면 이동">
        <button className="tabbar-brand" onClick={() => setEntered(false)} title="랜딩 화면으로">
          <SparkWordmark fontSize={18} />
        </button>
        <div className="tabbar-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={view === t.key}
              className={`navtab ${view === t.key ? "active" : ""}`}
              disabled={!enabled[t.key]}
              title={enabled[t.key] ? "" : t.key === "input" ? "덱을 먼저 여세요" : "먼저 생성하세요"}
              onClick={() => go(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {view === "editor" && editor ? (
        <div className="wrap wide">
          <EditWorkspace
            jobId={editor.jobId}
            result={editor.result}
            onBack={() => setView("input")}
            chat={editChat}
            setChat={setEditChat}
            askChat={askChat}
            setAskChat={setAskChat}
          />
        </div>
      ) : view === "input" && projectId ? (
        <InputScreen
          key={projectId}
          projectId={projectId}
          onOpenEditor={openEditor}
        />
      ) : (
        <Projects
          onOpenProject={(id) => {
            setProjectId(id);
            setEditor(null);
            setView("input");
          }}
          onDeleteProject={(id) => {
            if (id === projectId) {
              setProjectId(null);
              setEditor(null);
              setView("projects");
            }
          }}
        />
      )}
    </>
  );
}
