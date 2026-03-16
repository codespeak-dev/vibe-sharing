import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface ActionBarAction {
  label: string;
  onAction: () => void;
  primary?: boolean;
}

interface ActionBarProps {
  actions: ActionBarAction[];
  active?: boolean;
  onEsc?: () => void;
}

export function ActionBar({ actions, active = true, onEsc }: ActionBarProps) {
  const [focused, setFocused] = useState(0);

  useInput(
    (input, key) => {
      if (key.leftArrow) {
        setFocused((f) => Math.max(0, f - 1));
      } else if (key.rightArrow) {
        setFocused((f) => Math.min(actions.length - 1, f + 1));
      } else if (key.return) {
        actions[focused]?.onAction();
      } else if (key.escape) {
        onEsc?.();
      }
    },
    { isActive: active },
  );

  return (
    <Box marginTop={1}>
      {actions.map((action, i) => {
        const isFocused = i === focused && active;
        return (
          <React.Fragment key={i}>
            {i > 0 && <Text>  </Text>}
            {isFocused ? (
              <Text
                inverse
                bold
                color={action.primary ? "green" : undefined}
              >
                {" "}{action.label}{" "}
              </Text>
            ) : action.primary && active ? (
              <Text bold color="green">
                {" "}{action.label}{" "}
              </Text>
            ) : (
              <Text dimColor>
                {" "}{action.label}{" "}
              </Text>
            )}
          </React.Fragment>
        );
      })}
    </Box>
  );
}
