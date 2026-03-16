import React, { useReducer, useCallback, useState, useEffect } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import type { DiscoveredProject } from "../sessions/types.js";
import { ProjectListScreen } from "./screens/project-list.js";
import { ShareProjectScreen } from "./screens/share-project.js";
import { ConsentScreen } from "./screens/consent.js";
import { ReviewScreen } from "./screens/review.js";
import { ThankYouScreen } from "./screens/thank-you.js";
import { ManualEntryScreen } from "./screens/manual-entry.js";
import { LoadingScreen } from "./screens/loading.js";

// ─── Screen State Machine ───

export type Screen =
  | { kind: "loading" }
  | { kind: "project-list" }
  | { kind: "share-project"; projectPath: string }
  | { kind: "consent"; projectPath: string }
  | { kind: "review"; projectPath: string; activeTab: string }
  | { kind: "uploading"; projectPath: string }
  | { kind: "thank-you" }
  | { kind: "manual-entry"; gitRoot: string };

export type Action =
  | { type: "LOADED"; initialScreen: Screen }
  | { type: "GO_PROJECT_LIST" }
  | { type: "SELECT_PROJECT"; projectPath: string }
  | { type: "GO_CONSENT"; projectPath: string }
  | { type: "GO_REVIEW"; projectPath: string }
  | { type: "SWITCH_TAB"; tab: string }
  | { type: "GO_UPLOADING"; projectPath: string }
  | { type: "GO_THANK_YOU" }
  | { type: "GO_MANUAL_ENTRY"; gitRoot: string }
  | { type: "BACK" };

interface AppState {
  current: Screen;
  history: Screen[];
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "LOADED":
      return { current: action.initialScreen, history: [] };

    case "GO_PROJECT_LIST":
      return {
        current: { kind: "project-list" },
        history: [],
      };

    case "SELECT_PROJECT":
      return {
        current: { kind: "share-project", projectPath: action.projectPath },
        history: [...state.history, state.current],
      };

    case "GO_CONSENT":
      return {
        current: { kind: "consent", projectPath: action.projectPath },
        history: [...state.history, state.current],
      };

    case "GO_REVIEW":
      return {
        current: {
          kind: "review",
          projectPath: action.projectPath,
          activeTab: "code",
        },
        history: [...state.history, state.current],
      };

    case "SWITCH_TAB":
      if (state.current.kind !== "review") return state;
      return {
        ...state,
        current: { ...state.current, activeTab: action.tab },
      };

    case "GO_UPLOADING":
      return {
        current: { kind: "uploading", projectPath: action.projectPath },
        history: [...state.history, state.current],
      };

    case "GO_THANK_YOU":
      return {
        current: { kind: "thank-you" },
        // Clear history — after thank you, "back" goes to project list
        history: [],
      };

    case "GO_MANUAL_ENTRY":
      return {
        current: { kind: "manual-entry", gitRoot: action.gitRoot },
        history: [...state.history, state.current],
      };

    case "BACK": {
      if (state.history.length === 0) return state;
      const history = [...state.history];
      const prev = history.pop()!;
      return { current: prev, history };
    }

    default:
      return state;
  }
}

// ─── App Component ───

interface AppProps {
  initialScreen?: Screen;
  projects: DiscoveredProject[];
  onDiscoverProjects: () => Promise<DiscoveredProject[]>;
}

export function App({ initialScreen, projects: initialProjects, onDiscoverProjects }: AppProps) {
  const { exit } = useApp();
  const [state, dispatch] = useReducer(reducer, {
    current: initialScreen ?? { kind: "loading" },
    history: [],
  });
  const [projects, setProjects] = useState<DiscoveredProject[]>(initialProjects);
  const [sharedPaths, setSharedPaths] = useState<Set<string>>(new Set());

  const markShared = useCallback((projectPath: string) => {
    setSharedPaths((prev) => new Set([...prev, projectPath]));
  }, []);

  // Global Esc handler for screens that don't handle it themselves
  useInput((input, key) => {
    if (input === "q" || input === "Q") {
      if (state.current.kind === "project-list" || state.current.kind === "thank-you") {
        exit();
      }
    }
  });

  const screen = state.current;

  return (
    <Box flexDirection="column" padding={1}>
      {screen.kind === "loading" && (
        <LoadingScreen
          onDiscoverProjects={onDiscoverProjects}
          onDone={(discovered, route) => {
            setProjects(discovered);
            dispatch({ type: "LOADED", initialScreen: route });
          }}
        />
      )}

      {screen.kind === "project-list" && (
        <ProjectListScreen
          projects={projects}
          sharedPaths={sharedPaths}
          onSelect={(path) => dispatch({ type: "SELECT_PROJECT", projectPath: path })}
          onQuit={exit}
        />
      )}

      {screen.kind === "share-project" && (
        <ShareProjectScreen
          projectPath={screen.projectPath}
          projects={projects}
          showHeader={state.history.length === 0}
          onShare={() => dispatch({ type: "GO_CONSENT", projectPath: screen.projectPath })}
          onReview={() => dispatch({ type: "GO_REVIEW", projectPath: screen.projectPath })}
          onBack={() => dispatch({ type: "BACK" })}
          onAllProjects={() => dispatch({ type: "GO_PROJECT_LIST" })}
        />
      )}

      {screen.kind === "consent" && (
        <ConsentScreen
          projectPath={screen.projectPath}
          onConfirm={() => dispatch({ type: "GO_UPLOADING", projectPath: screen.projectPath })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      )}

      {screen.kind === "uploading" && (
        <ThankYouScreen
          projectPath={screen.projectPath}
          phase="uploading"
          onDone={() => {
            markShared(screen.projectPath);
            dispatch({ type: "GO_THANK_YOU" });
          }}
          onError={() => dispatch({ type: "BACK" })}
        />
      )}

      {screen.kind === "thank-you" && (
        <ThankYouScreen
          projectPath=""
          phase="done"
          onShareAnother={() => dispatch({ type: "GO_PROJECT_LIST" })}
          onQuit={exit}
        />
      )}

      {screen.kind === "review" && (
        <ReviewScreen
          projectPath={screen.projectPath}
          activeTab={screen.activeTab}
          projects={projects}
          onSwitchTab={(tab) => dispatch({ type: "SWITCH_TAB", tab })}
          onShare={() => dispatch({ type: "GO_CONSENT", projectPath: screen.projectPath })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      )}

      {screen.kind === "manual-entry" && (
        <ManualEntryScreen
          gitRoot={screen.gitRoot}
          onDone={(projectPath) => dispatch({ type: "SELECT_PROJECT", projectPath })}
          onBack={() => dispatch({ type: "BACK" })}
        />
      )}
    </Box>
  );
}

// ─── Entry Point ───

export function startApp(props: AppProps) {
  const instance = render(<App {...props} />);
  return instance;
}
