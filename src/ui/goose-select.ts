/**
 * Custom select prompt with animated goose.
 * Based on @inquirer/select, with goose ASCII art rendered alongside.
 */
import {
  createPrompt,
  useState,
  useKeypress,
  usePrefix,
  usePagination,
  useRef,
  useMemo,
  useEffect,
  isBackspaceKey,
  isEnterKey,
  isUpKey,
  isDownKey,
  isNumberKey,
  Separator,
  ValidationError,
  makeTheme,
} from "@inquirer/core";
import type { Theme, Status } from "@inquirer/core";
import { cursorHide } from "@inquirer/ansi";
import colors from "yoctocolors-cjs";
import figures from "@inquirer/figures";
import { renderWithGoose, GOOSE_FRAMES } from "./goose.js";

type SelectTheme = {
  icon: { cursor: string };
  style: {
    disabled: (text: string) => string;
    description: (text: string) => string;
    keysHelpTip: (keys: ReadonlyArray<[string, string]>) => string;
  };
  helpMode: "always" | "never" | "auto";
  indexMode: "hidden" | "number";
  keybindings: ReadonlyArray<"emacs" | "vim">;
};

const selectTheme: SelectTheme = {
  icon: { cursor: figures.pointer },
  style: {
    disabled: (text: string) => colors.dim(`- ${text}`),
    description: (text: string) => colors.cyan(text),
    keysHelpTip: (keys) =>
      keys
        .map(([key, action]) => `${colors.bold(key)} ${colors.dim(action)}`)
        .join(colors.dim(" • ")),
  },
  helpMode: "always",
  indexMode: "hidden",
  keybindings: [],
};

type Choice<Value> = {
  value: Value;
  name?: string;
  short?: string;
  description?: string;
  disabled?: boolean | string;
};

type NormalizedChoice<Value> = {
  value: Value;
  name: string;
  short: string;
  description?: string;
  disabled: boolean | string;
};

type Config<Value> = {
  message: string;
  choices: ReadonlyArray<Choice<Value> | Separator>;
  pageSize?: number;
  loop?: boolean;
  default?: Value;
  instructions?: { pager: string; navigation: string };
  theme?: Partial<Theme<SelectTheme>>;
};

function isSelectable<V>(item: NormalizedChoice<V> | Separator): item is NormalizedChoice<V> {
  return !Separator.isSeparator(item) && !item.disabled;
}

function normalizeChoices<V>(
  choices: ReadonlyArray<Choice<V> | Separator>,
): (NormalizedChoice<V> | Separator)[] {
  return choices.map((choice) => {
    if (Separator.isSeparator(choice)) return choice;
    if (typeof choice === "string") {
      return {
        value: choice as V,
        name: choice as string,
        short: choice as string,
        disabled: false,
      };
    }
    const name = choice.name ?? String(choice.value);
    const normalizedChoice: NormalizedChoice<V> = {
      value: choice.value,
      name,
      short: choice.short ?? name,
      disabled: choice.disabled ?? false,
    };
    if (choice.description) {
      normalizedChoice.description = choice.description;
    }
    return normalizedChoice;
  });
}

export default createPrompt(
  <Value,>(config: Config<Value>, done: (value: Value) => void) => {
    const { loop = true, pageSize = 7 } = config;
    const theme = makeTheme<SelectTheme>(selectTheme, config.theme);
    const { keybindings } = theme;
    const [status, setStatus] = useState<Status>("idle");
    const prefix = usePrefix({ status, theme });
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
    const searchEnabled = !keybindings.includes("vim");
    const items = useMemo(
      () => normalizeChoices(config.choices),
      [config.choices],
    );
    const bounds = useMemo(() => {
      const first = items.findIndex(isSelectable);
      let last = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (isSelectable(items[i]!)) { last = i; break; }
      }
      if (first === -1) {
        throw new ValidationError(
          "[select prompt] No selectable choices. All choices are disabled.",
        );
      }
      return { first, last };
    }, [items]);
    const defaultItemIndex = useMemo(() => {
      if (!("default" in config)) return -1;
      return items.findIndex(
        (item) => isSelectable(item) && item.value === config.default,
      );
    }, [config.default, items]);
    const [active, setActive] = useState(
      defaultItemIndex === -1 ? bounds.first : defaultItemIndex,
    );
    const selectedChoice = items[active]! as NormalizedChoice<Value>;
    const [gooseFrame, setGooseFrame] = useState(0);

    useKeypress((key, rl) => {
      clearTimeout(searchTimeoutRef.current);
      if (isEnterKey(key)) {
        setStatus("done");
        done(selectedChoice.value);
      } else if (isUpKey(key, keybindings) || isDownKey(key, keybindings)) {
        rl.clearLine(0);
        if (
          loop ||
          (isUpKey(key, keybindings) && active !== bounds.first) ||
          (isDownKey(key, keybindings) && active !== bounds.last)
        ) {
          const offset = isUpKey(key, keybindings) ? -1 : 1;
          let next = active;
          do {
            next = (next + offset + items.length) % items.length;
          } while (!isSelectable(items[next]!));
          setActive(next);
        }
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
      } else if (isNumberKey(key) && !Number.isNaN(Number(rl.line))) {
        const selectedIndex = Number(rl.line) - 1;
        let selectableIndex = -1;
        const position = items.findIndex((item) => {
          if (Separator.isSeparator(item)) return false;
          selectableIndex++;
          return selectableIndex === selectedIndex;
        });
        const item = items[position];
        if (item != null && isSelectable(item)) {
          setActive(position);
        }
        setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
        searchTimeoutRef.current = setTimeout(() => {
          rl.clearLine(0);
        }, 700);
      } else if (isBackspaceKey(key)) {
        rl.clearLine(0);
      } else if (searchEnabled) {
        const searchTerm = rl.line.toLowerCase();
        const matchIndex = items.findIndex((item) => {
          if (Separator.isSeparator(item) || !isSelectable(item)) return false;
          return item.name.toLowerCase().startsWith(searchTerm);
        });
        if (matchIndex !== -1) {
          setActive(matchIndex);
          setGooseFrame((gooseFrame + 1) % GOOSE_FRAMES.length);
        }
        searchTimeoutRef.current = setTimeout(() => {
          rl.clearLine(0);
        }, 700);
      }
    });

    useEffect(
      () => () => {
        clearTimeout(searchTimeoutRef.current);
      },
      [],
    );

    const message = theme.style.message(config.message, status);

    let helpLine: string | undefined;
    if (theme.helpMode !== "never") {
      if (config.instructions) {
        const { pager, navigation } = config.instructions;
        helpLine = theme.style.help(
          items.length > pageSize ? pager : navigation,
        );
      } else {
        helpLine = theme.style.keysHelpTip([
          ["↑↓", "navigate"],
          ["⏎", "select"],
        ]);
      }
    }

    let separatorCount = 0;
    const page = usePagination({
      items,
      active,
      renderItem({
        item,
        isActive,
        index,
      }: {
        item: NormalizedChoice<Value> | Separator;
        index: number;
        isActive: boolean;
      }) {
        if (Separator.isSeparator(item)) {
          separatorCount++;
          return ` ${item.separator}`;
        }
        const indexLabel =
          theme.indexMode === "number"
            ? `${index + 1 - separatorCount}. `
            : "";
        if (item.disabled) {
          const disabledLabel =
            typeof item.disabled === "string" ? item.disabled : "(disabled)";
          return theme.style.disabled(
            `${indexLabel}${item.name} ${disabledLabel}`,
          );
        }
        const color = isActive ? theme.style.highlight : (x: string) => x;
        const cursor = isActive ? theme.icon.cursor : ` `;
        return color(`${cursor} ${indexLabel}${item.name}`);
      },
      pageSize,
      loop,
    });

    if (status === "done") {
      return [prefix, message, theme.style.answer(selectedChoice.short)]
        .filter(Boolean)
        .join(" ");
    }

    const { description } = selectedChoice;
    const lines = [
      [prefix, message].filter(Boolean).join(" "),
      page,
      " ",
      description ? theme.style.description(description) : "",
      helpLine,
    ]
      .filter(Boolean)
      .join("\n")
      .trimEnd();

    return `${renderWithGoose(lines, gooseFrame)}${cursorHide}`;
  },
);

export { Separator } from "@inquirer/core";
