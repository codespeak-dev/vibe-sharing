import React from "react";
import { Box, Text, useInput } from "ink";

interface Tab {
  id: string;
  label: string;
}

interface TabBarProps {
  tabs: Tab[];
  activeTab: string;
  onSwitch: (tabId: string) => void;
  active?: boolean;
}

export function TabBar({ tabs, activeTab, onSwitch, active = true }: TabBarProps) {
  useInput(
    (input, key) => {
      if (!active) return;
      if (key.rightArrow) {
        const idx = tabs.findIndex((t) => t.id === activeTab);
        const next = (idx + 1) % tabs.length;
        onSwitch(tabs[next]!.id);
      } else if (key.leftArrow) {
        const idx = tabs.findIndex((t) => t.id === activeTab);
        const prev = (idx - 1 + tabs.length) % tabs.length;
        onSwitch(tabs[prev]!.id);
      }
    },
    { isActive: active },
  );

  return (
    <Box>
      {tabs.map((tab, i) => {
        const isActive = tab.id === activeTab;
        return (
          <React.Fragment key={tab.id}>
            {i > 0 && <Text dimColor>  </Text>}
            {isActive && active ? (
              <Text bold color="cyan" inverse>
                {" "}{tab.label}{" "}
              </Text>
            ) : isActive ? (
              <Text bold color="cyan">
                {" "}{tab.label}{" "}
              </Text>
            ) : (
              <Text dimColor>
                {" "}{tab.label}{" "}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
