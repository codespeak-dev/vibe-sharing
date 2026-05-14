/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import React from "react";
import { cleanup, render, fireEvent } from "@testing-library/react";

/**
 * BDD scenario: "Clicking elsewhere on session card navigates to session page".
 *
 * SessionCard.tsx wires the outer wrapper's onClick to router.push(sessionHref).
 * The embedded plan badge is an anchor with its own onClick that calls
 * stopPropagation, so clicks on the badge alone must not also trigger router
 * push from the parent.
 */

const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => {
      pushed.push(href);
    },
    replace: () => {},
    back: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  pushed.length = 0;
});

describe("Feature: Session Viewer — Session Card click targets", () => {
  test("Clicking elsewhere on session card navigates to the session page", async () => {
    const { SessionCard } = await import("../../src/components/session-card.js");
    const { getByText } = render(
      <SessionCard
        sessionId="11111111-1111-1111-1111-111111111111"
        projectHref="/project/abc"
        agentName="Claude Code"
        aiTitle="Refactor module"
        summary={null}
        firstPrompt={null}
        messageCount={5}
        created={null}
        modified={null}
        sizeBytes={1024}
        hasPlans={true}
        firstPlanLineIndex={7}
        userPromptCount={3}
      />,
    );

    fireEvent.click(getByText("Refactor module"));
    expect(pushed).toContain(
      "/project/abc/session/11111111-1111-1111-1111-111111111111",
    );
  });

  test("Clicking the plan badge does not navigate to the session page (stopPropagation)", async () => {
    const { SessionCard } = await import("../../src/components/session-card.js");
    const { container } = render(
      <SessionCard
        sessionId="22222222-2222-2222-2222-222222222222"
        projectHref="/project/abc"
        agentName="Claude Code"
        aiTitle="Some title"
        summary={null}
        firstPrompt={null}
        messageCount={1}
        created={null}
        modified={null}
        sizeBytes={1}
        hasPlans={true}
        firstPlanLineIndex={9}
        userPromptCount={1}
      />,
    );

    const planBadge = container.querySelector("a[href*='entry-9']");
    expect(planBadge).not.toBeNull();
    if (planBadge) fireEvent.click(planBadge);
    // Outer card's router.push must not have fired.
    expect(pushed).toEqual([]);
  });
});
